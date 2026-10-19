using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Bridges = Scheldemist.Movers.Bridges;
using Scheldemist.People;

namespace Scheldemist.Town;

/// <summary>A square window of 1 m cells round a point: open or not, plus A* (the browser's game/crowd.ts NavGrid).</summary>
public sealed class NavGrid
{
    public readonly int N;
    public readonly int Half;
    public int X0, Z0, Cx, Cz;
    public bool Built;
    private readonly byte[] open;
    private WalkMap? map;
    private readonly List<(double x, double z)> pathCells = new(512);
    private readonly record struct RouteKey(double Sx, double Sz, double Tx, double Tz, int Limit, bool Stand);
    private sealed class RouteAnswer { public bool Found; public readonly List<(double x, double z)> Points = new(32); }
    private readonly Dictionary<RouteKey, int> routeCache = new();
    private readonly RouteAnswer[] routeAnswers = new RouteAnswer[32];
    private ulong routeFrame = ulong.MaxValue, routeBodies, routeTopology;
    public int RouteCacheHits { get; private set; }

    /// <summary>One A* search's working state: the frame's synchronous search, or one carried over frames (#133).</summary>
    private sealed class Work
    {
        public readonly float[] G, F;
        public readonly int[] From, Stamp, Closed, Heap;
        public int Id, Size, Expanded, S, T, Revision;
        public bool Running;
        public RouteKey Key;
        public Func<double, double, bool>? StandAt;
        public Work(int n2) { G = new float[n2]; F = new float[n2]; From = new int[n2]; Stamp = new int[n2]; Closed = new int[n2]; Heap = new int[n2]; }
    }
    private Work now, carried;
    private int revision;
    private ulong searchTopology;
    /// <summary>
    /// The cells all route searches together may look at in one frame (#133); 0: no limit (proofs). A cell costs about
    /// a microsecond: one 9,000-cell search took up to 8 ms, and several in one frame stalled it. A search that runs out
    /// of the frame's cells keeps its state and goes on in the next frames (at least CarriedSlice cells a frame); its
    /// caller is told to ask again (Deferred) and keeps its old way meanwhile. Asked again, it gets the same answer the
    /// whole search would have given in one go (the grid unchanged; the grid or the walk map changing starts it again).
    /// </summary>
    public static int FrameBudget = 3000;
    private sealed class Restore(int budget) : IDisposable { public void Dispose() => FrameBudget = budget; }
    /// <summary>For proofs and fixtures that compare whole searches: no frame budget until disposed.</summary>
    public static IDisposable Unbudgeted() { var restore = new Restore(FrameBudget); FrameBudget = 0; return restore; }
    public const int CarriedSlice = 1500;
    private ulong budgetFrame = ulong.MaxValue;
    private int spent;
    private readonly RouteAnswer carriedAnswer = new();
    private RouteKey carriedAnswerKey;
    private bool carriedAnswerReady;
    private ulong carriedAnswerFrame;
    /// <summary>The last Path call was put off: no answer yet (not "no way"); ask the same again next frame.</summary>
    public bool Deferred { get; private set; }
    /// <summary>For checks: the most cells looked at in one frame, searches put off, answers given after frames.</summary>
    public int MostSpent { get; private set; }
    public int DeferredSearches { get; private set; }
    public int CarriedAnswers { get; private set; }
    public bool Carrying => carried.Running;

    private void ClearRoutes()
    {
        routeCache.Clear(); routeFrame = ulong.MaxValue;
        // the grid changed: a search carried over frames starts again on the new cells, a finished one is void
        revision++; carriedAnswerReady = false;
    }

    public NavGrid(int half)
    {
        Half = half;
        N = half * 2;
        int n2 = N * N;
        open = new byte[n2];
        now = new Work(n2);
        carried = new Work(n2);
    }

    /// <summary>Rebuild round (cx, cz): the cells of the baked walk map (WalkMap.Open is the browser's own test per cell).</summary>
    public void Build(WalkMap m, double cx, double cz)
    {
        using var cost = Scheldemist.Dev.FrameCost.Track("NavGrid.Build");
        ClearRoutes();
        map = m;
        Cx = (int)Whereabouts.JsRound(cx);
        Cz = (int)Whereabouts.JsRound(cz);
        X0 = Cx - Half;
        Z0 = Cz - Half;
        for (int iz = 0; iz < N; iz++)
            for (int ix = 0; ix < N; ix++)
                open[iz * N + ix] = m.Open(X0 + ix + 0.5, Z0 + iz + 0.5) ? (byte)1 : (byte)0;
        Built = true;
    }

    public int Cell(double x, double z)
    {
        int ix = (int)Math.Floor(x - X0), iz = (int)Math.Floor(z - Z0);
        return ix < 0 || iz < 0 || ix >= N || iz >= N ? -1 : iz * N + ix;
    }

    public bool IsOpen(double x, double z)
    {
        int c = Cell(x, z);
        return c >= 0 && open[c] == 1;
    }

    /// <summary>Someone bumped into something the walk map does not know: close the cell (until the next build).</summary>
    public void Block(double x, double z)
    {
        int c = Cell(x, z);
        if (c >= 0) { open[c] = 0; ClearRoutes(); }
    }

    public bool Inside(double x, double z, double margin = 2) => x > X0 + margin && z > Z0 + margin && x < X0 + N - margin && z < Z0 + N - margin;

    /// <summary>The nearest open cell centre within r cells (and where `ok` says yes), or null.</summary>
    public (double x, double z)? NearestOpen(double x, double z, int r = 3, Func<double, double, bool>? ok = null)
    {
        int c = Cell(x, z);
        if (c >= 0 && open[c] == 1 && (ok == null || ok(x, z))) return (x, z);
        int ix0 = (int)Math.Floor(x - X0), iz0 = (int)Math.Floor(z - Z0);
        for (int d = 1; d <= r; d++)
            for (int dz = -d; dz <= d; dz++)
                for (int dx = -d; dx <= d; dx++)
                {
                    if (Math.Max(Math.Abs(dx), Math.Abs(dz)) != d) continue;
                    int ix = ix0 + dx, iz = iz0 + dz;
                    if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
                    if (open[iz * N + ix] == 1 && (ok == null || ok(X0 + ix + 0.5, Z0 + iz + 0.5))) return (X0 + ix + 0.5, Z0 + iz + 0.5);
                }
        return null;
    }

    /// <summary>
    /// Is the straight line from a to b open all the way? The browser also keeps a straightened way a body's width
    /// off the solids near it (their boxes are not in the bake): here every sample must be ground a body fits on.
    /// </summary>
    public bool LineOpen(double ax, double az, double bx, double bz)
    {
        if (map != null && !map.CanStep(ax, az, bx, bz)) return false;
        double len = Whereabouts.Hypot(bx - ax, bz - az);
        int steps = Math.Max(1, (int)Math.Ceiling(len / 0.35));
        for (int i = 1; i <= steps; i++)
        {
            double t = (double)i / steps;
            double x = ax + (bx - ax) * t, z = az + (bz - az) * t;
            if (!IsOpen(x, z)) return false;
            if (i < steps && map != null && !map.Free(x, z)) return false;
        }
        return true;
    }

    /// <summary>
    /// A* over the open cells, straightened into a few waypoints. Null if there is no way, or, with Deferred set, when
    /// the frame's budget of cells is spent (FrameBudget): then the output is left as it was. The way ends on the target
    /// itself, or where the target is off the grid and `standAt` says no body stands there, on the open cell nearest.
    /// </summary>
    public List<(double x, double z)>? Path(double sx, double sz, double tx, double tz, int maxExpand = 9000, Func<double, double, bool>? standAt = null, List<(double x, double z)>? output = null)
    {
        using var cost = Scheldemist.Dev.FrameCost.Track("NavGrid.Path");
        Deferred = false;
        var key = new RouteKey(sx, sz, tx, tz, maxExpand, standAt != null);
        // Caller predicates may depend on bridges or people changed later in this same frame.
        bool cache = WalkMap.CachedRouteLinks && standAt == null;
        if (cache) {
            ulong frame = Engine.GetProcessFrames(), bodies = map?.BodySnapshot ?? 0, topology = map?.TopologyRevision ?? 0;
            if (routeFrame != frame || routeBodies != bodies || routeTopology != topology) { routeCache.Clear(); routeFrame = frame; routeBodies = bodies; routeTopology = topology; }
            if (routeCache.TryGetValue(key, out int saved)) {
                RouteCacheHits++;
                return Give(routeAnswers[saved], output);
            }
        }
        CheckTopology();
        StartFrame();
        // a search carried over the last frames: its answer, or it goes on now with what is left of this frame
        if (carriedAnswerReady && carriedAnswerKey == key && budgetFrame - carriedAnswerFrame <= 2) {
            carriedAnswerReady = false; CarriedAnswers++;
            return Remember(key, cache, Give(carriedAnswer, output));
        }
        if (carried.Running && carried.Key == key) {
            if (carried.Revision == revision && Allowance() > 0 && Run(carried, Allowance(), out bool done)) {
                carried.Running = false; CarriedAnswers++;
                var o = done ? Finish(carried, sx, sz, tx, tz, standAt, output ?? new List<(double x, double z)>()) : null;
                if (!done) output?.Clear();
                return Remember(key, cache, o);
            }
            Deferred = true; return null;
        }
        if (Allowance() <= 0) { Deferred = true; DeferredSearches++; return null; }
        if (!Begin(now, key, standAt)) { output?.Clear(); return Remember(key, cache, null); }
        if (!Run(now, Allowance(), out bool found)) {
            // out of this frame's cells: carried on over the next frames when nothing else is, else asked again
            if (!carried.Running) (now, carried) = (carried, now);
            now.Running = false;
            Deferred = true; DeferredSearches++; return null;
        }
        now.Running = false;
        if (!found) { output?.Clear(); return Remember(key, cache, null); }
        return Remember(key, cache, Finish(now, sx, sz, tx, tz, standAt, output ?? new List<(double x, double z)>()));
    }

    private static List<(double x, double z)>? Give(RouteAnswer answer, List<(double x, double z)>? output)
    {
        if (!answer.Found) { output?.Clear(); return null; }
        var result = output ?? new List<(double x, double z)>(answer.Points.Count);
        result.Clear(); result.AddRange(answer.Points); return result;
    }

    private List<(double x, double z)>? Remember(RouteKey key, bool cache, List<(double x, double z)>? answer)
    {
        if (cache && routeCache.Count < routeAnswers.Length && !routeCache.ContainsKey(key)) {
            int index = routeCache.Count;
            var saved = routeAnswers[index] ??= new RouteAnswer();
            saved.Found = answer != null; saved.Points.Clear();
            if (answer != null) saved.Points.AddRange(answer);
            routeCache.Add(key, index);
        }
        return answer;
    }

    private int Allowance() => FrameBudget > 0 ? FrameBudget - spent : int.MaxValue;

    private void StartFrame()
    {
        ulong frame = Engine.GetProcessFrames() + proofFrames;
        if (budgetFrame == frame) return;
        budgetFrame = frame; spent = 0;
        // an answer carried over frames that nobody asked for again within two frames is dropped
        if (carriedAnswerReady && frame - carriedAnswerFrame > 2) carriedAnswerReady = false;
    }

    private ulong proofFrames;
    /// <summary>
    /// For a proof (#133): the same search whole, then under a budget of `slice` cells a frame over simulated frames
    /// (asked again each frame, the carried search going on between), on the same unchanged grid. True when both give
    /// the same answer; `frames` is how many frames the sliced one took.
    /// </summary>
    internal bool SlicedEqualsWhole(double sx, double sz, double tx, double tz, int maxExpand, Func<double, double, bool>? standAt, int slice, out int frames, out bool found)
    {
        int budget = FrameBudget;
        var whole = new List<(double x, double z)>(); var sliced = new List<(double x, double z)>();
        try
        {
            carried.Running = false; carriedAnswerReady = false;
            FrameBudget = 0; routeCache.Clear(); routeFrame = ulong.MaxValue;
            found = Path(sx, sz, tx, tz, maxExpand, standAt, whole) != null;
            FrameBudget = slice; frames = 1;
            List<(double x, double z)>? answer = null;
            for (; frames < 1000; frames++)
            {
                routeCache.Clear(); routeFrame = ulong.MaxValue;
                proofFrames++;
                answer = Path(sx, sz, tx, tz, maxExpand, standAt, sliced);
                if (!Deferred) break;
                Pump();
            }
            if (Deferred || (answer != null) != found) return false;
            if (answer == null) return true;
            if (whole.Count != sliced.Count) return false;
            for (int i = 0; i < whole.Count; i++) if (whole[i] != sliced[i]) return false;
            return true;
        }
        finally { FrameBudget = budget; proofFrames++; routeCache.Clear(); routeFrame = ulong.MaxValue; carried.Running = false; carriedAnswerReady = false; }
    }

    private void CheckTopology()
    {
        ulong topology = map?.TopologyRevision ?? 0;
        if (topology != searchTopology) { searchTopology = topology; revision++; carriedAnswerReady = false; }
    }

    /// <summary>
    /// The search carried over frames goes on: with what is left of the frame's budget, at least CarriedSlice cells.
    /// Called once a frame by the crowd, after its people thought; its answer waits for its caller's next ask.
    /// </summary>
    public void Pump()
    {
        if (!Built || !carried.Running) return;
        CheckTopology();
        StartFrame();
        if (carried.Revision != revision) { var k = carried.Key; if (!Begin(carried, k, carried.StandAt)) { carried.Running = false; return; } }
        int allowance = FrameBudget > 0 ? Math.Max(CarriedSlice, FrameBudget - spent) : int.MaxValue;
        if (!Run(carried, allowance, out bool found)) return;
        carried.Running = false;
        var key = carried.Key;
        carriedAnswer.Found = found;
        if (found) Finish(carried, key.Sx, key.Sz, key.Tx, key.Tz, carried.StandAt, carriedAnswer.Points);
        carriedAnswerKey = key; carriedAnswerReady = true; carriedAnswerFrame = budgetFrame;
    }

    /// <summary>Sets a search up in w; false when either end has no open cell (no way).</summary>
    private bool Begin(Work w, RouteKey key, Func<double, double, bool>? standAt)
    {
        var s0 = NearestOpen(key.Sx, key.Sz, 2, standAt);
        var t0 = NearestOpen(key.Tx, key.Tz, 2, standAt);
        if (s0 == null || t0 == null) return false;
        w.Key = key; w.StandAt = standAt; w.Revision = revision;
        w.S = Cell(s0.Value.x, s0.Value.z); w.T = Cell(t0.Value.x, t0.Value.z);
        w.Id++; w.Size = 0; w.Expanded = 0; w.Running = true;
        w.Stamp[w.S] = w.Id;
        w.G[w.S] = 0;
        w.F[w.S] = H(w, w.S);
        w.From[w.S] = -1;
        Push(w, w.S);
        return true;
    }

    /// <summary>Step with the cells it used taken from the frame's budget.</summary>
    private bool Run(Work w, int allowance, out bool found)
    {
        int before = w.Expanded;
        bool over = Step(w, allowance, out found);
        spent += w.Expanded - before;
        if (spent > MostSpent) MostSpent = spent;
        return over;
    }

    private float H(Work w, int c)
    {
        int n = N, dx = Math.Abs(c % n - w.T % n), dz = Math.Abs(c / n - w.T / n);
        return Math.Max(dx, dz) + 0.4142f * Math.Min(dx, dz);
    }

    private static void Push(Work w, int c)
    {
        var heap = w.Heap; var f = w.F;
        int i = w.Size++;
        heap[i] = c;
        while (i > 0)
        {
            int p = (i - 1) >> 1;
            if (f[heap[p]] <= f[heap[i]]) break;
            (heap[p], heap[i]) = (heap[i], heap[p]);
            i = p;
        }
    }

    private static int Pop(Work w)
    {
        var heap = w.Heap; var f = w.F;
        int top = heap[0];
        heap[0] = heap[--w.Size];
        int i = 0, size = w.Size;
        for (;;)
        {
            int l = i * 2 + 1, r = l + 1, m = i;
            if (l < size && f[heap[l]] < f[heap[m]]) m = l;
            if (r < size && f[heap[r]] < f[heap[m]]) m = r;
            if (m == i) break;
            (heap[m], heap[i]) = (heap[i], heap[m]);
            i = m;
        }
        return top;
    }

    /// <summary>
    /// A* in w for at most `allowance` more cells (its key's limit in all). True when the search is over: found, or no
    /// way (nothing left to look at, or the limit reached). False: out of allowance, its open set kept for later.
    /// </summary>
    private bool Step(Work w, int allowance, out bool found)
    {
        found = false;
        int n = N, id = w.Id, t = w.T, maxExpand = w.Key.Limit;
        var g = w.G; var f = w.F; var from = w.From; var stamp = w.Stamp; var closed = w.Closed;
        long stop = Math.Min((long)w.Expanded + allowance, maxExpand);
        while (w.Size > 0 && w.Expanded < maxExpand)
        {
            int c = w.Heap[0];
            if (closed[c] == id) { Pop(w); continue; }
            if (c == t) { Pop(w); closed[c] = id; found = true; return true; }
            // the next cell would be one more than this frame allows: stop, the open set as it is
            if (w.Expanded >= stop) return false;
            Pop(w);
            closed[c] = id;
            w.Expanded++;
            int cx = c % n, cz = c / n;
            for (int dz = -1; dz <= 1; dz++)
                for (int dx = -1; dx <= 1; dx++)
                {
                    if (dx == 0 && dz == 0) continue;
                    int nx = cx + dx, nz = cz + dz;
                    if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
                    int nc = nz * n + nx;
                    if (open[nc] == 0 || closed[nc] == id) continue;
                    if (map != null && !map.GridStep(X0 + cx + 0.5, Z0 + cz + 0.5, X0 + nx + 0.5, Z0 + nz + 0.5)) continue;
                    // no cutting corners past a wall
                    if (dx != 0 && dz != 0 && (open[cz * n + nx] == 0 || open[nz * n + cx] == 0)) continue;
                    float ng = g[c] + (dx != 0 && dz != 0 ? 1.4142f : 1);
                    if (stamp[nc] == id && ng >= g[nc]) continue;
                    stamp[nc] = id;
                    g[nc] = ng;
                    f[nc] = ng + H(w, nc);
                    from[nc] = c;
                    Push(w, nc);
                }
        }
        return true;
    }

    /// <summary>The way found in w, straightened into its corners, written to o.</summary>
    private List<(double x, double z)> Finish(Work w, double sx, double sz, double tx, double tz, Func<double, double, bool>? standAt, List<(double x, double z)> o)
    {
        int n = N;
        var cells = pathCells;
        cells.Clear();
        for (int c = w.T; c != -1; c = w.From[c]) cells.Add((X0 + c % n + 0.5, Z0 + c / n + 0.5));
        cells.Reverse();
        if (standAt != null ? standAt(tx, tz) : IsOpen(tx, tz)) cells[^1] = (tx, tz);
        // string pulling: keep only the corners
        o.Clear();
        var anchor = (x: sx, z: sz);
        for (int i = 1; i < cells.Count; i++)
        {
            if (!LineOpen(anchor.x, anchor.z, cells[i].x, cells[i].z))
            {
                o.Add(cells[i - 1]);
                anchor = cells[i - 1];
            }
        }
        o.Add(cells[^1]);
        return o;
    }
}

/// <summary>A townsperson walked by the crowd for Townspeople (crowd.ts Person, the puppet's part of it).</summary>
public sealed class Puppet
{
    public int Id;
    public string Kind = "";
    public Human Human = null!;
    public Node3D Group = null!;
    public double X, Z, Yaw;
    /// <summary>Walking pace, m/s.</summary>
    public double Pace;
    /// <summary>This person's height against the model's (a little taller or shorter than the next).</summary>
    public float Size = 1;
    /// <summary>puppet: the town says where to go; follow: at another's side.</summary>
    public string Role = "puppet";
    /// <summary>walk, pause, stand, sit, wait, blocked.</summary>
    public string State = "stand";
    public double Timer;
    internal List<(double x, double z)> Path = new();
    internal int Pi;
    internal (double x, double z)? Dest;
    internal int Replans;
    internal double Held, SinceDetour = 99;
    public Puppet? Lead, Follower;
    internal bool TownFollow;
    internal double Drop;
    /// <summary>Kneeling or crouched (people2): how far to lower the body so its knees and toes rest on the real
    /// ground under each (#169), and when that was last measured.</summary>
    internal double KneelLift, KneelClock;
    public bool Shown;
    public bool Remote;
    public bool Conversing;
    internal double AnimAcc;
    internal double BestD = double.PositiveInfinity, StuckT;
    /// <summary>Standing at the end of a bridge that is up, until it is down (Walk).</summary>
    public bool BridgeWait;
    internal string PMotion = "idle";
    /// <summary>Why this body gave way to a moving vehicle in the last step ("" when it did not); read by the stuck check.</summary>
    public string Yield = "";
    internal double YieldHold;
    /// <summary>The way this body last stepped out of a vehicle's lane (a unit vector) and how long ago: a step straight back, from
    /// between two lanes, is never taken at once (it was a body walking to and fro).</summary>
    internal double PushX, PushZ, PushAge = 9;
    /// <summary>Seconds in a row the walk could take no step at all.</summary>
    internal double Failed;
    /// <summary>Ways round bodies that stay put taken on this route, and the way point index before which the way points are those ways round (issue 120).</summary>
    internal int StandDetours, DetourEnd;
    /// <summary>Why the last way round a standing body was not taken, for the stuck check's report.</summary>
    internal string DetourWhy = "";
    /// <summary>The next route is planned round the ground standing bodies hold: one of them left no way round (issue 120).</summary>
    internal bool RoundStanding;
    internal double? PYaw;
    internal bool Repath;
    internal bool NativeRouting;
    internal NativeCrowdRoute? NativeRoute;
    internal double? VehicleStepYaw;
    /// <summary>Carrying a load (the wider berth; in the hands when HandCarry).</summary>
    public bool Loaded;
    /// <summary>Dockers who pick up and put down a load at each end (the others carry by their build: the shoulder sack, the truck).</summary>
    public bool HandCarry;
    /// <summary>How far ahead of him his cart reaches, and how wide it is (0: no cart).</summary>
    public double Nose, Reach = 0.25;
    internal Node3D? LoadNode;
    internal string LoadKind = "sack";
    internal Node3D? Lantern;
    internal LanternPool.Source? Light;
    internal PushCart? Cart;
    public string? Bought;
    internal Node3D? BoughtNode;
    /// <summary>Pushes a handcart (the mill's man on a run): the cart on its own wheels before him, the push clips.</summary>
    public bool Pushes;
    public int NetworkVehicle,NetworkLoad,NetworkGoods;
    internal NativePersonVehicle? Vehicle;
    /// <summary>Seconds a pushed handcart has waited for someone standing where its next step would bring it (#192).</summary>
    internal double CartWait;
    /// <summary>Pushes the knife grinder's barrow out before him now (StreetTrades): it must not come onto anyone either.</summary>
    internal bool Barrow;
    /// <summary>The knife grinder, whose barrow stands where he sets it down: he does not walk into it (StreetTrades).</summary>
    internal bool Grinder;
    internal (double x,double z)? WayHome;
    /// <summary>The way home after a lane: the distance left at best, and how long no ground was gained on it (another rule,
    /// a street game's place, holding the body where it is).</summary>
    internal double WayHomeLeft = double.PositiveInfinity, WayHomeStall;
    /// <summary>The body's last route changes (new goal, plan, refused step, no gain, way round), kept only while
    /// Crowd.TraceRoutes is on, for the stuck check's report.</summary>
    internal readonly List<string> RouteNotes = new();
}

/// <summary>
/// The people in the street (the browser's game/crowd.ts, the part the town's residents use): Townspeople says where
/// each one goes and what they do there; the crowd walks them on its grid (A*, keep right, go round the player, stuck
/// checks, bodies keep apart), draws and animates them and keeps the bodies in a pool.
/// Loads in the hands, the carter's handcart and lanterns: People/Carried.cs.
/// Resident journeys supply bicycles, carts and horse drays; live-body lanes and opening-bridge gates govern
/// their shared street movement. The named town replaces the initial nameless crowd once its people arrive.
/// </summary>
public sealed partial class Crowd
{
    private const double BodyGap = 0.6, BodyShove = 1.2, LoadGap = 0.15, MaxGap = BodyGap + 2 * LoadGap;
    private const double AnimNear = 25, AnimFar = 45;
    /// <summary>Seconds a refused walker stands before going round a standing body or planning anew, and how long he waits for a
    /// passing one (#197).</summary>
    private const double RefusedWait = 0.25, PassingWait = 2;
    /// <summary>A body's radius against live boxes (the stuck check's body is 0.25 m round).</summary>
    private const double BodyRoom = 0.26;
    /// <summary>Keep each body's route changes in Puppet.RouteNotes (the stuck check turns it on, and sets the clock to its own).</summary>
    public static bool TraceRoutes;
    public static double TraceClock;
    private void RouteNote(Puppet p, string what)
    {
        if (!TraceRoutes) return;
        if (p.RouteNotes.Count >= 24) p.RouteNotes.RemoveAt(0);
        p.RouteNotes.Add($"{TraceClock:0.00} {p.X:0.00},{p.Z:0.00} {what}");
    }
    /// <summary>What refused a step, for the route notes: the bodies at the step and at the nose, and anyone a pushed cart would come onto.</summary>
    private string RefusedNote(Puppet p, (double x, double z) t, double ux, double uz, double step)
    {
        double nx = p.X + ux * step, nz = p.Z + uz * step;
        var nose = p.Nose == 0 ? (x: nx, z: nz) : NosePoint(p, nx, nz, ux, uz);
        string onto = PushedOnSomeone(p, nx, nz, Math.Atan2(ux, uz)) ? $", cart onto puppet {cartOnWho?.Id} {cartOnWho?.State}" : "";
        return $"step refused towards {t.x:0.0},{t.z:0.0}: stepFree {StepFree(p, nx, nz)}, bodies at step [{map.BlockedBy(p, nx, nz)}], nose {nose.x:0.0},{nose.z:0.0} free {p.Nose == 0 || map.FreeFor(p, nose.x, nose.z)} [{(p.Nose == 0 ? "" : map.BlockedBy(p, nose.x, nose.z))}]{onto}, passing {PassingHolds(p, ux, uz, step)}";
    }
    private static string Points(List<(double x, double z)> path, int from = 0) =>
        string.Join(" ", path.Skip(from).Take(6).Select(q => $"{q.x:0.0},{q.z:0.0}")) + (path.Count - from > 6 ? $" .. {path[^1].x:0.0},{path[^1].z:0.0}" : "");
    private static readonly HashSet<string> Children = new() { "boy", "girl" };
    /// <summary>People whose load is part of their build: the sack truck, the shoulder sack, the handcart.</summary>
    public static readonly HashSet<string> Laden = new() { "porter", "docker_sack", "carter" };
    private static readonly HashSet<string> WalkClips = new() { "walk", "carry", "push", "ride" };
    /// <summary>A townsperson standing in one of these may be eased aside; any other pose is a task on its spot.</summary>
    private static readonly HashSet<string> FreePoses = new() { "idle", "fold", "talk", "walk", "carry", "behind", "pockets", "smoke" };

    private readonly List<Puppet> people = new();
    private readonly Dictionary<string, List<Human>> pool = new();
    private readonly NavGrid grid;
    private readonly Node parent;
    private readonly WalkMap map;
    private readonly Random rng = new();
    private double gridAge;
    private int pathBudget;
    private int nextId = 1;
    private double viewX, viewZ;
    /// <summary>The player's body on the ground, when there is one (a walker stops for it and goes round).</summary>
    private (double x, double z)? body;
    private readonly Plane[] frustum = new Plane[6];
    private bool hasFrustum;
    private readonly Func<double, double, bool> standFree, noPerson;
    private readonly Func<Bridges.Rect, bool> onDeck;

    /// <summary>How far the fog lets one see (the browser's scene.fog.far).</summary>
    public double FogDistance = 40;
    public int Drawn { get; private set; }
    public int Animated { get; private set; }
    public IReadOnlyList<Puppet> Walking => people;

    public Crowd(Node parent, WalkMap map, int radius = 70)
    {
        this.parent = parent;
        this.map = map;
        standFree = (x, z) => map.Free(x, z) && !Bridges.OnRaised(x, z);
        noPerson = NoPersonAt;
        grid = new NavGrid(radius + 12);
        // the route budget (#133): `--route-budget 0` turns it off for A/B timing
        if (int.TryParse(Main.I?.Arg("route-budget", "") ?? "", out int routeBudget) && routeBudget >= 0) NavGrid.FrameBudget = routeBudget;
        // a bridge does not go up while anyone is on its deck (the browser's peopleOn); those waiting at its ends do not count
        onDeck = PeopleOn;
        Bridges.Busy.Add(onDeck);
    }

    private double Rnd(double a, double b) => a + rng.NextDouble() * (b - a);
    private static double AngDiff(double a, double b) => Math.Atan2(Math.Sin(a - b), Math.Cos(a - b));
    /// <summary>A new permanent prop changed the walk map: use its footprint before taking another step.</summary>
    public void RebuildGrid(double x, double z) { grid.Build(map, x, z); gridAge = 0; foreach (var p in people) p.NativeRoute?.Clear(); }
    private static double Hyp(double a, double b) => Math.Sqrt(a * a + b * b);

    public void Update(double dt, double vx, double vz, (double x, double z)? playerBody, Camera3D? camera)
    {
        using var profileCost = Scheldemist.Dev.FrameCost.Track("Town.Crowd");
        using (Scheldemist.Dev.FrameCost.Track("Crowd.Bodies")) map.RefreshBodies();
        viewX = vx;
        viewZ = vz;
        body = playerBody;
        gridAge += dt;
        // rebuild when the viewer has moved on, and now and then (cells closed by a bump open again)
        if (!grid.Built || Hyp(vx - grid.Cx, vz - grid.Cz) > 20 || gridAge > 60)
        {
            grid.Build(map, vx, vz);
            gridAge = 0;
        }
        hasFrustum = camera != null;
        if (camera != null)
        {
            var projection = camera.GetCameraProjection();
            var transform = camera.GetCameraTransform();
            for (int i = 0; i < 6; i++) frustum[i] = transform * projection.GetProjectionPlane((Projection.Planes)i);
        }
        pathBudget = 3;
        using (Scheldemist.Dev.FrameCost.Track("Crowd.Lanes")) VehicleLanes(dt);
        using (Scheldemist.Dev.FrameCost.Track("Crowd.Think")) foreach (var p in people) if (!p.Remote) Think(p, dt);
        using (Scheldemist.Dev.FrameCost.Track("Crowd.Apart")) KeepApart(dt);
        grid.Pump();
        int drawn = 0, animated = 0;
        using var drawCost = Scheldemist.Dev.FrameCost.Track("Crowd.Draw");
        foreach (var p in people)
        {
            double d = Hyp(p.X - vx, p.Z - vz);
            double ground = map.BaseAt(p.X, p.Z);
            bool inView = d < FogDistance + 4 && InFrustum(p.X, p.Z, 1.3 * p.Size, ground);
            p.Shown = inView;
            p.Group.Visible = inView;
            double y = 0;
            if (inView)
            {
                drawn++;
                // Body motion stays at the frame rate. Bones need no hundreds of updates a second:
                // close figures at 120 Hz, the nearby crowd at 60, far ones at 15 and the farthest at 8.
                p.AnimAcc += dt;
                if (p.AnimAcc >= (d < 8 ? 1.0 / 120 : d < AnimNear ? 1.0 / 60 : d < AnimFar ? 1.0 / 15 : 1.0 / 8))
                {
                    using (Scheldemist.Dev.FrameCost.Track("Crowd.Animate")) p.Human.Update((float)p.AnimAcc);
                    p.AnimAcc = 0;
                    animated++;
                }
            }
            // down on the knees, on a chair, crouched (eased), or a hop (at once)
            double lift = p.State == "sit" ? 0 : p.Human.IsPeople2 ? KneelLift(p, ground, dt) : p.Human.MotionLift() * p.Size;
            double want = p.State == "sit" ? p.Human.SitDrop() * p.Size : Math.Min(0, lift);
            p.Drop += (want - p.Drop) * Math.Min(1, dt * 4);
            if (inView) y = p.Drop + Math.Max(0, lift) + (p.State == "sit" ? 0 : p.Human.Bob() * p.Size);
            p.Group.Position = new Vector3((float)p.X, (float)(y + ground), (float)p.Z);
            p.Group.Rotation = new Vector3(0, (float)p.Yaw, 0);
            if (p.Vehicle != null) { MoveVehicle(p, dt, inView, ground); CartShove(p); }
            else if (p.Kind == "carter" || p.Pushes) PushTheCart(p, dt, inView, ground);
            else if (p.Cart != null)
            {
                p.Cart.Dispose();
                p.Cart = null;
            }
            if (p.Barrow) CartShove(p);
            if (p.Lantern != null) PlaceLantern(p, d, ground, camera);
            PlaceBought(p);
        }
        Drawn = drawn;
        Animated = animated;
    }

    private readonly PhysicsRayQueryParameters3D kneelRay = new() { CollisionMask = World.Solid.Layer };

    /// <summary>A people2 body kneeling or crouched: lowered (or raised) until the lowest of its knees and toes
    /// rests on the ground under it, a step, the pavement or the cobbles (#169). Measured four times a second.</summary>
    private double KneelLift(Puppet p, double ground, double dt)
    {
        Span<Vector3> points = stackalloc Vector3[6];
        if (!p.Human.KneelContacts(points)) { p.KneelLift = 0; p.KneelClock = 0; return 0; }
        if ((p.KneelClock -= dt) > 0) return p.KneelLift;
        p.KneelClock = 0.25;
        var space = p.Group.GetWorld3D()?.DirectSpaceState;
        var frame = new Transform3D(new Basis(Vector3.Up, (float)p.Yaw).Scaled(Vector3.One * (float)p.Size), new Vector3((float)p.X, (float)ground, (float)p.Z));
        double lowest = double.MaxValue;
        foreach (var local in points)
        {
            var at = frame * local;
            double under = map.BaseAt(at.X, at.Z);
            if (space != null)
            {
                kneelRay.From = at + Vector3.Up * 0.7f; kneelRay.To = at + Vector3.Down * 1.2f;
                var hit = space.IntersectRay(kneelRay);
                if (hit.Count > 0) under = ((Vector3)hit["position"]).Y;
            }
            lowest = Math.Min(lowest, at.Y - under);
        }
        p.KneelLift = Math.Clamp(-lowest, -0.7, 0.3);
        return p.KneelLift;
    }

    // ---------------------------------------------------------------- puppets

    /// <summary>A resident appears at (x, z); null when the models are not there.</summary>
    public Puppet? AddPuppet(string kind, double x, double z, double yaw = 0, double pace = 1.3, float? size = null)
    {
        Human? human = null;
        if (pool.TryGetValue(kind, out var list) && list.Count > 0)
        {
            human = list[^1];
            list.RemoveAt(list.Count - 1);
        }
        human ??= Humans.Make(kind);
        if (human == null) return null;
        var group = new Node3D { Name = kind };
        group.AddChild(human.Root);
        parent.AddChild(group);
        // a body from the pool still plays what its last owner did: stand idle first
        human.Start();
        float sz = size ?? (float)(Children.Contains(kind) ? Rnd(0.9, 1.08) : Rnd(0.95, 1.05));
        group.Scale = new Vector3(sz, sz, sz);
        group.Position = new Vector3((float)x, (float)map.BaseAt(x, z), (float)z);
        group.Rotation = new Vector3(0, (float)yaw, 0);
        group.Visible = false;
        var p = new Puppet { Id = nextId++, Kind = kind, Human = human, Group = group, X = x, Z = z, Yaw = yaw, Pace = pace, Size = sz, Loaded = Laden.Contains(kind) };
        // a cart goes before its man: its front must fit too (crowd.ts CART: how far ahead, how wide)
        if (kind == "porter") (p.Nose, p.Reach) = (0.9, 0.35);
        else if (kind == "carter") (p.Nose, p.Reach) = (3.3, 0.6);
        people.Add(p);
        return p;
    }

    /// <summary>Walk there on the grid; the way is worked out over the next frames.</summary>
    public void PuppetGo(Puppet p, double x, double z, double? pace = null)
    {
        if(p.Conversing)return;
        if (pace is > 0) p.Pace = pace.Value;
        double tx = x, tz = z;
        if (!map.IsNative && grid.Built && !grid.Inside(x, z, 4))
        {
            // beyond the walk grid round the viewer: head for its edge that way; the town sends them on from there
            for (double t = 1; t > 0.02; t -= 0.04)
            {
                double qx = p.X + (x - p.X) * t, qz = p.Z + (z - p.Z) * t;
                if (!grid.Inside(qx, qz, 4)) continue;
                var q = grid.NearestOpen(qx, qz, 4);
                if (q != null)
                {
                    (tx, tz) = q.Value;
                    break;
                }
            }
        }
        bool walking = p.State == "walk" && p.Pi < p.Path.Count;
        // the same goal while on the way there: keep the way (a new one each time made them stutter)
        if (walking && p.Dest != null && Hyp(p.Dest.Value.x - tx, p.Dest.Value.z - tz) < 0.5) return;
        if (TraceRoutes) RouteNote(p, $"goal {tx:0.0},{tz:0.0} (was {(p.Dest is { } was ? $"{was.x:0.0},{was.z:0.0}" : "none")}, {p.State})");
        p.Replans = 0;
        p.Held = 0;
        // no way can be worked out this frame: walk on the old one, change over when one can
        if (walking && pathBudget <= 0)
        {
            p.Dest = (tx, tz);
            p.Repath = true;
            return;
        }
        GoTo(p, (tx, tz));
    }

    /// <summary>What a person carries for a goods kind or a carry kind: "sack" (the shoulder), "keg", "fishbox", or
    /// "crate" (anything else boxed or bundled is held in both arms like a crate).</summary>
    public static string CarryKindOf(string kind) => kind switch
    {
        "sack" or "sacks" => "sack",
        "keg" or "barrels" or "barrel" => "keg",
        "fishbox" or "fish" => "fishbox",
        "cask" => "cask",
        _ => "crate",
    };

    /// <summary>A load in the arms: a sack, a crate, a box of fish, a keg (crowd.ts puppetLoad); off: put down.
    /// One load per person (#148): a new load replaces the old one, which goes. `node`: the goods item's own model
    /// (a job's crate with its stencil), held instead of a made one; the caller gives it up.</summary>
    public void PuppetLoad(Puppet p, bool on, string kind = "sack", int crate = 0, Node3D? node = null)
    {
        p.HandCarry = true;
        kind = CarryKindOf(kind);
        bool same = on && p.Loaded && p.LoadKind == kind && (node == null || node == p.LoadNode) && (kind == "sack" || p.LoadNode != null);
        if (same) return;
        // the old load goes (people2: a sack let go is set down from the shoulder by Human2)
        if (p.LoadNode != null && p.LoadNode != node)
        {
            if (p.Human.IsPeople2) p.Human.CarryNode(null);
            if (GodotObject.IsInstanceValid(p.LoadNode)) p.LoadNode.QueueFree();
            p.LoadNode = null;
        }
        p.LoadKind = kind;
        p.Loaded = on;
        // a purchase is put away while both arms carry (one load at a time)
        if (p.BoughtNode != null) p.BoughtNode.Visible = !on;
        if (p.Human.IsPeople2)
        {
            // people2 (package D3): the sack rides the shoulder (the kit's one sack, set down when let go); other
            // loads are the game's node held against the belly with the hold clips. A local choice: the wire still says "loaded"
            // (a cask is rolled along the ground before him: the kit's quay cask, no node in the arms)
            if (on && kind is not ("sack" or "cask"))
            {
                if (node != null) { node.Visible = true; node.Scale = Vector3.One; p.LoadNode = node; }
                else p.LoadNode ??= Carried.Load(kind, p.Human.Scale, crate);
                p.Human.CarryNode(p.LoadNode);
            }
            p.Human.CarryLoad(on ? kind : null);
            return;
        }
        if (!on) return;
        if (kind == "cask") kind = "keg"; // (the old kit has no rolled cask: a keg in the arms)
        if (node != null)
        {
            // the item's own model where the made one would be held
            var at = Carried.Load(kind, p.Human.Scale, crate);
            if (node.GetParent() != p.Group) { if (node.GetParent() is { } old) old.RemoveChild(node); p.Group.AddChild(node); }
            node.Position = at?.Position ?? new Vector3(0, 0.74f * p.Human.Scale, 0.36f * p.Human.Scale);
            node.Rotation = Vector3.Zero; node.Scale = Vector3.One; node.Visible = true;
            at?.Free();
            p.LoadNode = node;
        }
        else if (p.LoadNode == null && (p.LoadNode = Carried.Load(kind, p.Human.Scale, crate)) != null) p.Group.AddChild(p.LoadNode);
    }

    /// <summary>Everything a person holds goes before the body returns to the pool (#148: a load left on a pooled
    /// body came back on the next person who used it).</summary>
    private static void EmptyHands(Puppet p)
    {
        if (p.LoadNode != null)
        {
            if (p.Human.IsPeople2) p.Human.CarryNode(null);
            if (GodotObject.IsInstanceValid(p.LoadNode)) p.LoadNode.QueueFree();
            p.LoadNode = null;
        }
        p.Human.ClearLoad();
        p.BoughtNode?.QueueFree();
        p.BoughtNode = null; p.Bought = null;
        p.Loaded = false; p.HandCarry = false;
    }

    /// <summary>A lantern in hand (police at night, people going home after dark).</summary>
    public void PuppetLantern(Puppet p, bool on)
    {
        if (on && p.Lantern == null)
        {
            p.Lantern = Carried.Lantern();
            parent.AddChild(p.Lantern);
            p.Light = LanternPool.I?.Add();
        }
        else if (!on && p.Lantern != null) DropLantern(p);
    }

    private static void DropLantern(Puppet p)
    {
        p.Lantern?.QueueFree();
        p.Lantern = null;
        LanternPool.I?.Remove(p.Light);
        p.Light = null;
    }

    private void PlaceLantern(Puppet p, double d, double ground, Camera3D? camera)
    {
        var l = p.Lantern!;
        // a light carries further in the fog than the one who carries it; the lantern itself is drawn with its carrier only
        bool near = d < FogDistance * 1.8;
        l.Visible = p.Shown;
        if (p.Light != null) p.Light.On = near;
        if (!near) return;
        var hand = p.Shown ? p.Human.Hand(true) : null;
        l.Position = hand != null
            ? new Vector3(hand.Value.X, hand.Value.Y - 0.1f * p.Size, hand.Value.Z)
            : new Vector3((float)(p.X + Math.Cos(p.Yaw) * -0.25), (float)(ground + 0.75 * p.Size), (float)(p.Z - Math.Sin(p.Yaw) * -0.25));
        // the flame, in the middle of the glass
        if (p.Light != null) p.Light.Pos = l.Position - new Vector3(0, 0.08f, 0);
        if (p.Shown && camera != null) Carried.FaceHalo(l, camera.GlobalPosition);
    }

    /// <summary>A carter's handcart in place of the one in his model: on its own wheels, tipped up to his grip, swinging round behind him on a bend.</summary>
    private void PushTheCart(Puppet p, double dt, bool shown, double ground)
    {
        if (p.Human.OwnPushedVehicle) return;
        if (p.Cart == null)
        {
            if (!PushCart.Has) return;
            p.Cart = new PushCart(parent);
        }
        bool walking = p.Human.Motion is "walk" or "carry" or "push";
        double hx = p.X + Math.Sin(p.Yaw) * 0.5, hz = p.Z + Math.Cos(p.Yaw) * 0.5, hy = 0.9;
        if (shown && p.Human.Hand(false) is { } hl && p.Human.Hand(true) is { } hr)
        {
            // only the reach ahead of the body is taken from the pose (the hands sway; the cart does not)
            var mid = (hl + hr) * 0.5f;
            double ahead = Math.Clamp((mid.X - p.X) * Math.Sin(p.Yaw) + (mid.Z - p.Z) * Math.Cos(p.Yaw), 0.25, 0.75);
            hx = p.X + Math.Sin(p.Yaw) * ahead;
            hz = p.Z + Math.Cos(p.Yaw) * ahead;
            hy = Math.Clamp(mid.Y - ground, 0.7, 1.1);
        }
        p.Cart.Push(dt, hx, hz, hy, p.Yaw, walking ? 1 : 0, ground);
        p.Cart.Root.Visible = shown;
    }

    /// <summary>Is (x, z) inside the walk grid round the viewer (a puppet can be sent straight there)?</summary>
    public bool OnGrid(double x, double z) => grid.Built && grid.Inside(x, z, 4);

    /// <summary>Stand here, face this way (null: keep facing), play this.</summary>
    public void PuppetStand(Puppet p, string motion = "idle", double? yaw = null)
    {
        p.Path.Clear();
        p.Failed = 0;
        p.Pi = 0;
        p.Dest = null;
        p.Repath = false;
        p.State = "stand";
        p.PMotion = motion;
        p.PYaw = yaw;
        p.Human.Play(motion, 0.35f);
    }

    /// <summary>Still on the way (walking, waiting for a path, held up)?</summary>
    public bool PuppetBusy(Puppet p) => p.State is "walk" or "wait" or "blocked" || (p.State == "pause" && p.Dest != null);

    public void PuppetSit(Puppet p, double? yaw = null)
    {
        PuppetStand(p, "sit", yaw);
        if (p.Human.CanSit) p.State = "sit";
    }

    /// <summary>Walk at another puppet's side, at their pace (two soldiers walking out); null lets go.</summary>
    public void PuppetFollow(Puppet p, Puppet? lead)
    {
        if (lead != null && lead != p)
        {
            if (p.Lead == lead && p.Role == "follow") return;
            if (p.Lead != null && p.Lead.Follower == p) p.Lead.Follower = null;
            p.Role = "follow";
            p.TownFollow = true;
            p.Lead = lead;
            lead.Follower = p;
            p.Path.Clear();
            p.Dest = null;
            p.Repath = false;
            p.State = "stand";
        }
        else if (p.TownFollow)
        {
            if (p.Lead != null && p.Lead.Follower == p) p.Lead.Follower = null;
            p.Lead = null;
            p.TownFollow = false;
            p.Role = "puppet";
            p.Path.Clear();
            p.Dest = null;
            p.Repath = false;
            p.State = "stand";
            p.PMotion = "idle";
            p.Human.Play(StillMotion(p), 0.3f);
        }
    }

    public bool PuppetFollowing(Puppet p) => p.TownFollow;

    public void RemovePuppet(Puppet p)
    {
        if (!people.Remove(p)) return;
        if (p.Follower != null) p.Follower.Lead = null;
        if (p.Lead != null) p.Lead.Follower = null;
        if (p.Lantern != null) DropLantern(p);
        DropVehicle(p);
        p.Cart?.Dispose();
        p.Cart = null;
        EmptyHands(p);
        p.Group.RemoveChild(p.Human.Root);
        p.Group.QueueFree();
        if (!pool.TryGetValue(p.Kind, out var list)) pool[p.Kind] = list = new List<Human>();
        list.Add(p.Human);
    }

    public bool Alive(Puppet p) => people.Contains(p);

    /// <summary>At the game's end: everyone out of the street, the pooled bodies given back.</summary>
    public void Dispose()
    {
        Bridges.Busy.Remove(onDeck);
        foreach (var p in people.ToArray()) RemovePuppet(p);
        foreach (var list in pool.Values)
            foreach (var h in list) h.Root.Free();
        pool.Clear();
    }

    /// <summary>Out of the viewer's sight (in the fog, behind him)?</summary>
    public bool IsHidden(double x, double z)
    {
        double d = Hyp(x - viewX, z - viewZ);
        if (d < 10) return false;
        if (d > FogDistance + 3) return true;
        return !InFrustum(x, z, 1.5, map.BaseAt(x, z));
    }

    /// <summary>Can someone stand here (walk map, colliders, the grid)?</summary>
    public bool CanStand(double x, double z) => grid.Built && grid.IsOpen(x, z) && map.Free(x, z) && !Bridges.OnRaised(x, z);

    private bool PeopleOn(Bridges.Rect r)
    {
        foreach (var p in people)
            if (r.Has((float)p.X, (float)p.Z)) return true;
        return false;
    }

    /// <summary>The nearest open grid point, for a puppet that would appear in a wall.</summary>
    public (double x, double z)? OpenNear(double x, double z) => grid.Built ? grid.NearestOpen(x, z, 4, standFree) : null;

    /// <summary>Does someone stand or walk within a body's gap of (x, z)?</summary>
    private bool NoPersonAt(double x, double z) => map.Free(x, z) && !Bridges.OnRaised(x, z) && !SomeoneAt(x, z);
    public bool SomeoneAt(double x, double z)
    {
        foreach (var q in people)
            if (Math.Abs(q.X - x) < BodyGap && Math.Abs(q.Z - z) < BodyGap && Hyp(q.X - x, q.Z - z) < BodyGap) return true;
        return false;
    }

    /// <summary>
    /// A solid has just appeared or grown (a cart parked for the player coming near, a grinder's barrow set down): whoever stands,
    /// waits or walks inside its footprint, or within a body's clearance of it, is eased out onto the nearest free ground. A walker
    /// caught there by a cart drawn round him stood inside its box until he had walked out (stuck check, 2026-10-18).
    /// </summary>
    public void MoveOutOf(Aabb world, double clearance = 0.3)
    {
        map.RefreshBodies();
        double x0 = world.Position.X - clearance, x1 = world.End.X + clearance, z0 = world.Position.Z - clearance, z1 = world.End.Z + clearance;
        foreach (var p in people)
        {
            if (p.Remote || p.Vehicle != null || p.State is "sit" || p.X < x0 || p.X > x1 || p.Z < z0 || p.Z > z1 || map.FreeFor(p, p.X, p.Z)) continue;
            (double x, double z)? best = null;
            for (double r = 0.25; r <= 3 && best == null; r += 0.25)
                for (int k = 0; k < 24 && best == null; k++)
                {
                    double a = k * Math.PI / 12, qx = p.X + Math.Cos(a) * r, qz = p.Z + Math.Sin(a) * r;
                    if (map.FreeFor(p, qx, qz) && !SomeoneAt(qx, qz)) best = (qx, qz);
                }
            if (best == null) continue;
            if (MoveOutLog.Count < 200) MoveOutLog.Add($"puppet {p.Id} {p.State}{(p.Conversing ? " talking" : "")} from {p.X:0.00},{p.Z:0.00} to {best.Value.x:0.00},{best.Value.z:0.00} out of {world.Position.X:0.00},{world.Position.Z:0.00} size {world.Size.X:0.00}x{world.Size.Z:0.00}");
            p.X = best.Value.x;
            p.Z = best.Value.z;
        }
    }
    /// <summary>For checks: every body MoveOutOf has set aside (bounded).</summary>
    public readonly List<string> MoveOutLog = new();

    /// <summary>The nearest open grid point where nobody is yet, or null.</summary>
    public (double x, double z)? OpenNearFree(double x, double z) => grid.Built ? grid.NearestOpen(x, z, 4, noPerson) : null;

    /// <summary>The walk on the grid round the viewer from a to b (corner points), or null. `maxExpand` bounds the
    /// search (cells looked at): a caller with a frame budget (the animals) gives a small one and tries again later.</summary>
    public List<(double x, double z)>? PathOn(double ax, double az, double bx, double bz, List<(double x, double z)>? output = null, int maxExpand = 6000)
    {
        PathDeferred = false;
        if (!grid.Built || !grid.Inside(bx, bz, 2)) return null;
        var a = grid.NearestOpen(ax, az, 6);
        var way = a != null ? grid.Path(a.Value.x, a.Value.z, bx, bz, maxExpand, null, output) : null;
        PathDeferred = grid.Deferred;
        return way;
    }
    /// <summary>The last PathOn was put off by the frame's route budget (#133): no answer yet, ask the same again later.</summary>
    public bool PathDeferred { get; private set; }
    /// <summary>For checks: the route budget's most cells in a frame, searches put off, answers given after frames.</summary>
    public object RouteBudget => new { NavGrid.FrameBudget, mostCellsInAFrame = grid.MostSpent, deferred = grid.DeferredSearches, carriedAnswers = grid.CarriedAnswers, bodies = WalkMap.BodyCount, stillBodies = WalkMap.StillBodyCount };

    /// <summary>Same-snapshot A/B proof: every open directed edge, plus whole routes in both caller forms.</summary>
    public object CompareRouteLinks()
    {
        bool enabled = WalkMap.CachedRouteLinks;
        using var whole = NavGrid.Unbudgeted();
        int edges = 0, differences = 0, routes = 0;
        for (int z = 1; z < grid.N - 1; z++) for (int x = 1; x < grid.N - 1; x++) {
            double ax = grid.X0 + x + .5, az = grid.Z0 + z + .5;
            if (!grid.IsOpen(ax, az)) continue;
            for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++) {
                if (dx == 0 && dz == 0) continue;
                edges++;
                WalkMap.CachedRouteLinks = false;
                bool reference = map.CanStep(ax, az, ax + dx, az + dz);
                WalkMap.CachedRouteLinks = true;
                if (reference != map.GridStep(ax, az, ax + dx, az + dz)) differences++;
            }
        }
        var original = new List<(double x, double z)>();
        var cached = new List<(double x, double z)>();
        double oldMax = 0, newMax = 0, oldTotal = 0, newTotal = 0;
        try {
            for (int i = 0; i < people.Count && i < 24; i++) {
                var p = people[i]; var to = p.Dest ?? (grid.Cx + Math.Sin(i * 2.4) * 30, grid.Cz + Math.Cos(i * 2.4) * 30);
                for (int pass = 0; pass < 2; pass++) {
                    // Reverse A/B order on the second pass; neither path can read changing bodies in between.
                    bool firstFound = false, secondFound = false;
                    for (int order = 0; order < 2; order++) {
                        bool useCache = (order == 1) == (pass == 0);
                        WalkMap.CachedRouteLinks = useCache;
                        var began = System.Diagnostics.Stopwatch.GetTimestamp();
                        bool found = grid.Path(p.X, p.Z, to.Item1, to.Item2, pass == 0 ? 6000 : 9000, pass == 0 ? null : standFree, useCache ? cached : original) != null;
                        double ms = System.Diagnostics.Stopwatch.GetElapsedTime(began).TotalMilliseconds;
                        if (useCache) { newMax = Math.Max(newMax, ms); newTotal += ms; secondFound = found; }
                        else { oldMax = Math.Max(oldMax, ms); oldTotal += ms; firstFound = found; }
                    }
                    routes++;
                    if (firstFound != secondFound || original.Count != cached.Count) differences++;
                    else for (int k = 0; k < original.Count; k++) if (original[k] != cached[k]) differences++;
                }
            }
        } finally { WalkMap.CachedRouteLinks = enabled; }
        return new { edges, routes, differences, cachedLinks = map.HasCachedRouteLinks, originalMaxMs = oldMax, cachedMaxMs = newMax, originalTotalMs = oldTotal, cachedTotalMs = newTotal, ok = differences == 0 && map.HasCachedRouteLinks };
    }

    /// <summary>
    /// The route budget's proof (#133): the routes CompareRouteLinks asks, each whole and in 300-cell slices over
    /// frames; every answer must be the same.
    /// </summary>
    public object CompareRouteBudget()
    {
        int routes = 0, differences = 0, sliced = 0, mostFrames = 0, found = 0;
        for (int i = 0; i < people.Count && i < 24; i++) {
            var p = people[i]; var to = p.Dest ?? (grid.Cx + Math.Sin(i * 2.4) * 30, grid.Cz + Math.Cos(i * 2.4) * 30);
            for (int pass = 0; pass < 2; pass++) {
                bool same = grid.SlicedEqualsWhole(p.X, p.Z, to.Item1, to.Item2, pass == 0 ? 6000 : 9000, pass == 0 ? null : standFree, 300, out int frames, out bool way);
                routes++; if (!same) differences++; if (frames > 1) sliced++; if (way) found++;
                mostFrames = Math.Max(mostFrames, frames);
            }
        }
        return new { routes, found, sliced, mostFrames, differences, ok = differences == 0 && routes > 0 && sliced > 0 };
    }

    /// <summary>The overlap check (the browser's `__scheldemist.overlaps()`): pairs whose middles are nearer than `min` m.</summary>
    public int Overlaps(double min = 0.45)
    {
        int n = 0;
        for (int i = 0; i < people.Count; i++)
            for (int j = i + 1; j < people.Count; j++)
                if (people[i].Lead != people[j] && people[j].Lead != people[i] && Hyp(people[i].X - people[j].X, people[i].Z - people[j].Z) < min) n++;
        return n;
    }

    private bool InFrustum(double x, double z, double r, double ground)
    {
        if (!hasFrustum) return true;
        var c = new Vector3((float)x, (float)(ground + 0.9), (float)z);
        foreach (var pl in frustum)
            if (pl.DistanceTo(c) > r) return false;
        return true;
    }

    // ---------------------------------------------------------------- per person

    private void Think(Puppet p, double dt)
    {
        if(p.Conversing){if(p.PYaw is {} a)Face(p,a,dt);return;}
        p.SinceDetour += dt;
        string yieldWas = p.Yield;
        bool gaveWay = GiveWay(p, dt);
        if (TraceRoutes && p.Yield != yieldWas && p.Yield != "") RouteNote(p, $"{p.Yield} ({p.State})");
        if (gaveWay) return;
        if (p.Role == "follow")
        {
            Follow(p, dt);
            return;
        }
        switch (p.State)
        {
            case "walk":
                // a goal from PuppetGo that waited for a path budget: take the new way now
                if (p.Repath && pathBudget > 0 && p.Dest != null)
                {
                    GoTo(p, p.Dest.Value);
                    if (p.State != "walk") break;
                }
                Walk(p, dt);
                break;
            case "wait":
                if (p.Dest != null) GoTo(p, p.Dest.Value);
                break;
            case "blocked":
                // the player in the way: face him, wait, then find a way round
                p.Human.Play(StillMotion(p), 0.3f);
                if (body == null)
                {
                    p.State = "walk";
                    break;
                }
                Face(p, Math.Atan2(body.Value.x - p.X, body.Value.z - p.Z), dt);
                p.Held += dt;
                if (Hyp(body.Value.x - p.X, body.Value.z - p.Z) > 1.4) p.State = "walk";
                else if (p.Held > 0.8 && p.Held - dt <= 0.8)
                {
                    if (p.SinceDetour < 5 || !Detour(p))
                    {
                        p.Held = 0;
                        Next(p);
                    }
                }
                else if (p.Held > 3)
                {
                    p.Held = 0;
                    Next(p);
                }
                break;
            case "pause":
                p.Timer -= dt;
                if (p.Timer <= 0)
                {
                    if (p.Dest != null) GoTo(p, p.Dest.Value);
                    else p.State = "stand";
                }
                break;
            default:
                Shoo(p, dt);
                if (p.PYaw != null) Face(p, p.PYaw.Value, dt);
                break;
        }
    }

    /// <summary>The one at a leader's side: keep to their right, at their pace; catch up by path if lost.</summary>
    private void Follow(Puppet p, double dt)
    {
        var l = p.Lead;
        if (l == null)
        {
            // a townsperson whose companion went in or out of range: the town directs them again
            p.TownFollow = false;
            p.Role = "puppet";
            p.State = "stand";
            p.PMotion = "idle";
            p.Human.Play(StillMotion(p), 0.3f);
            return;
        }
        if (p.State == "walk" && p.Path.Count > 0)
        {
            // lost them earlier: on the way back to their side
            Walk(p, dt);
            if (Hyp(l.X - p.X, l.Z - p.Z) < 1.5) p.Path.Clear();
            return;
        }
        if (p.State == "wait" && p.Dest != null)
        {
            GoTo(p, p.Dest.Value);
            return;
        }
        // at the lead's side; where that is in a wall, a step behind them
        double tx = l.X - Math.Cos(l.Yaw) * 0.62, tz = l.Z + Math.Sin(l.Yaw) * 0.62;
        if (!map.Free(tx, tz))
        {
            tx = l.X - Math.Sin(l.Yaw) * 0.9;
            tz = l.Z - Math.Cos(l.Yaw) * 0.9;
        }
        double dx = tx - p.X, dz = tz - p.Z, d = Hyp(dx, dz);
        bool walking = l.State == "walk";
        if (d > 0.12)
        {
            double sp = Math.Min(d * 3, (walking ? l.Pace : 0.8) * (d > 0.6 ? 1.3 : 1));
            double step = Math.Min(d, sp * dt);
            double nx = p.X + dx / d * step, nz = p.Z + dz / d * step;
            if (StepFree(p, nx, nz))
            {
                p.X = nx;
                p.Z = nz;
                p.Held = 0;
            }
            else p.Held += dt;
            if (p.Held > 2 && d > 2.5)
            {
                p.Held = 0;
                GoTo(p, (l.X, l.Z));
                return;
            }
            Face(p, walking ? l.Yaw : Math.Atan2(dx, dz), dt);
            if (p.Held > 0)
            {
                // held up by a wall or a thing: stand and wait for the lead to move on, never walk on the spot
                p.Human.Play(StillMotion(p), 0.3f);
                return;
            }
            p.Human.Play(p.Vehicle!=null?WalkMotion(p):"walk", 0.25f);
            p.Human.SetPace((float)(sp / p.Size));
        }
        else
        {
            p.State = "stand";
            if (walking)
            {
                Face(p, l.Yaw, dt);
                p.Human.Play(p.Vehicle!=null?WalkMotion(p):"walk", 0.25f);
                p.Human.SetPace((float)(l.Pace / p.Size));
            }
            else p.Human.Play(StillMotion(p), 0.35f);
            if (!walking && l.State != "pause") Face(p, l.Yaw, dt);
            if (!walking && l.State == "pause") Face(p, Math.Atan2(l.X - p.X, l.Z - p.Z), dt);
        }
    }

    private static void Face(Puppet p, double yaw, double dt) => p.Yaw += AngDiff(yaw, p.Yaw) * Math.Min(1, dt * 5);

    /// <summary>What someone plays while not moving: a townsperson's own pose (never a walk), or a stand.</summary>
    private static string StillMotion(Puppet p) => VehicleMotion.Waiting(p.Vehicle?.Kind??0,p.PMotion);
    private static string WalkMotion(Puppet p) => VehicleMotion.Walking(p.Vehicle?.Kind??0,p.Kind,p.Pushes,p.Loaded,p.HandCarry);

    /// <summary>
    /// May this body step to (x, z)? Where the colliders let it. Someone already standing where that does not hold
    /// (put there by a layer, a follower at a wall) may still step on, so they walk out instead of walking on the spot.
    /// </summary>
    private bool StepFree(Puppet p, double x, double z)
    {
        if (Bridges.Barred(p.X, p.Z, x, z)) return false;
        // (nor may a pusher be shoved or stepped so that his handcart or barrow comes onto someone, nor anyone walk into his own
        // barrow set down: the walk map lets him through his own things, #192)
        if (PushedOnSomeone(p, x, z, p.Yaw) || !OwnClear(p, x, z) && OwnClear(p, p.X, p.Z)) return false;
        foreach (var q in people)
        {
            if (q == p) continue;
            // A hard body boundary, inside the wider soft spacing used by KeepApart. Making the soft
            // load/height allowance impassable makes two walkers repeatedly reject each other's escape step.
            const double gap = 0.5;
            double qx = x - q.X, qz = z - q.Z;
            if (Math.Abs(qx) >= gap || Math.Abs(qz) >= gap) continue;
            double distance = qx * qx + qz * qz;
            // Do not step into a body. An existing overlap may still separate, including an exact coincidence.
            if (distance < gap * gap && distance <= (p.X - q.X) * (p.X - q.X) + (p.Z - q.Z) * (p.Z - q.Z)) return false;
        }
        if (map.FreeFor(p, x, z)) return true;
        if (map.FreeFor(p, p.X, p.Z)) return false;
        // (but not into a live body's own room: walking out past a cart's or barrow's corner, the step on came into it, #197)
        if (!map.BodyRoomFor(p, x, z, BodyRoom) && map.BodyRoomFor(p, p.X, p.Z, BodyRoom)) return false;
        // (the browser lets a thinner body through there; the bake has one body's width: towards ground a body fits on within a metre)
        double dx = x - p.X, dz = z - p.Z, d = Hyp(dx, dz);
        if (d < 1e-6) return false;
        // (out towards the free ground nearest to him only: beyond a stall's thin board the ground is free too, and a child at play
        // was shoved on through it, into the board, #197)
        if (NearestFreeWay(p) is { } way && dx * way.x + dz * way.z <= 0) return false;
        for (int k = 1; k <= 4; k++)
            if (map.FreeFor(p, p.X + dx / d * 0.25 * k, p.Z + dz / d * 0.25 * k)) return true;
        return false;
    }

    /// <summary>The way (a unit vector) to the free ground nearest to a body standing where it does not fit, within a metre, every
    /// sixteenth of a turn; null when there is none.</summary>
    private (double x, double z)? NearestFreeWay(Puppet p)
    {
        for (int k = 1; k <= 4; k++)
        {
            double sx = 0, sz = 0;
            for (int a = 0; a < 16; a++)
            {
                double c = Math.Cos(a * Math.PI / 8), s = Math.Sin(a * Math.PI / 8);
                if (map.FreeFor(p, p.X + c * 0.25 * k, p.Z + s * 0.25 * k)) { sx += c; sz += s; }
            }
            double l = Hyp(sx, sz);
            if (l > 1e-6) return (sx / l, sz / l);
        }
        return null;
    }

    /// <summary>Standing people step aside when the player walks into them.</summary>
    private void Shoo(Puppet p, double dt)
    {
        if (body == null) return;
        double dx = p.X - body.Value.x, dz = p.Z - body.Value.z, d = Hyp(dx, dz);
        if (d > 0.8 || d < 0.01) return;
        double step = 1.2 * dt;
        double nx = p.X + dx / d * step, nz = p.Z + dz / d * step;
        if (StepFree(p, nx, nz) && grid.IsOpen(nx, nz))
        {
            p.X = nx;
            p.Z = nz;
        }
    }

    // ---------------------------------------------------------------- bodies keep apart

    /// <summary>
    /// Nobody stands in someone else. Every frame, two bodies nearer than BodyGap are eased apart onto free ground,
    /// the one on the move more than the one standing. Not moved: a body held on its spot (sat, at a task), and a
    /// couple walking side by side (the follower keeps its own 0.62 m).
    /// </summary>
    private void KeepApart(double dt)
    {
        int n = people.Count;
        if (n < 2) return;
        double cap = BodyShove * dt;
        for (int i = 0; i < n; i++)
        {
            var p = people[i];
            double wp = ShoveWeight(p);
            for (int j = i + 1; j < n; j++)
            {
                var q = people[j];
                double dx = q.X - p.X, dz = q.Z - p.Z;
                if (dx > MaxGap || dx < -MaxGap || dz > MaxGap || dz < -MaxGap) continue;
                double gap = BodyGap * Math.Min(1, (p.Size + q.Size) / 2) + (p.Loaded ? LoadGap : 0) + (q.Loaded ? LoadGap : 0);
                double d = Hyp(dx, dz);
                if (d >= gap || p.Lead == q || q.Lead == p) continue;
                double wq = ShoveWeight(q);
                if (wp + wq == 0) continue;
                if (d < 1e-3)
                {
                    // on the very same spot: apart in a way of their own
                    double a = ((p.Id * 7 + q.Id * 13) % 360) * (Math.PI / 180);
                    dx = Math.Sin(a);
                    dz = Math.Cos(a);
                }
                else
                {
                    dx /= d;
                    dz /= d;
                }
                double over = gap - Math.Min(d, gap);
                double mp = Math.Min(cap, over * wp / (wp + wq)), mq = Math.Min(cap, over * wq / (wp + wq));
                if (mp > 0 && StepFree(p, p.X - dx * mp, p.Z - dz * mp))
                {
                    p.X -= dx * mp;
                    p.Z -= dz * mp;
                }
                if (mq > 0 && StepFree(q, q.X + dx * mq, q.Z + dz * mq))
                {
                    q.X += dx * mq;
                    q.Z += dz * mq;
                }
            }
        }
    }

    /// <summary>Does someone other than p stand (not walk) on this spot?</summary>
    private bool SpotTaken(Puppet p, double x, double z)
    {
        foreach (var q in people)
        {
            if (q == p || q.State == "walk" || q.Lead == p || p.Lead == q) continue;
            double dx = q.X - x, dz = q.Z - z;
            if (dx * dx + dz * dz < BodyGap * BodyGap) return true;
        }
        return false;
    }

    /// <summary>How readily a body is eased aside: 0 held on its spot, a little when standing, most when walking.</summary>
    private static double ShoveWeight(Puppet p)
    {
        if (p.Remote||p.Vehicle!=null) return 0;
        // held in a talk with the player: he stands his ground, a passer-by goes round or is eased aside (#185: one in body
        // contact shoved the talker 0.13 m in three seconds, and the talk check saw him leave his spot)
        if (p.Conversing) return 0;
        if (p.State == "sit" || p.Kind == "carter") return 0;
        if (p.Role == "puppet" && p.State != "walk" && !FreePoses.Contains(p.PMotion)) return 0;
        return p.State == "walk" ? 1 : 0.4;
    }

    // ---------------------------------------------------------------- walking

    private void Walk(Puppet p, double dt)
    {
        if (p.Pi >= p.Path.Count)
        {
            Arrive(p);
            return;
        }
        var t = p.Path[p.Pi];
        double dx = t.x - p.X, dz = t.z - p.Z, len = Hyp(dx, dz);
        // A native route may squeeze through gaps a quarter metre wide, and its way points lie on the edge of the free squares: from a
        // spot 0.35 m short of one, the straight line to the next may graze a wall the map refuses. Close in on the way point first.
        bool closeIn = len > 0.05 && p.NativeRouting && p.Pi + 1 < p.Path.Count
            && !map.SupportsStep(p.X, p.Z, p.Path[p.Pi + 1].x, p.Path[p.Pi + 1].z);
        if (len < 0.35 && !closeIn)
        {
            p.Pi++;
            p.BestD = double.PositiveInfinity;
            p.StuckT = 0;
            if (p.Pi >= p.Path.Count) Arrive(p);
            return;
        }
        // the spot itself taken by someone standing there: this near is there
        if (len < 1 && p.Pi == p.Path.Count - 1 && SpotTaken(p, t.x, t.z))
        {
            Arrive(p);
            return;
        }
        // no closer to the next waypoint for a while: close the cell ahead and find another way
        if (len < p.BestD - 0.25)
        {
            p.BestD = len;
            p.StuckT = 0;
        }
        else if ((p.StuckT += dt) > 2.5)
        {
            p.StuckT = 0;
            p.BestD = double.PositiveInfinity;
            p.Human.Play(StillMotion(p), 0.3f);
            grid.Block(p.X + dx / len * 0.8, p.Z + dz / len * 0.8);
            if (TraceRoutes) RouteNote(p, $"no gain 2.5 s towards {t.x:0.0},{t.z:0.0} (leg {p.Pi}/{p.Path.Count}); closed {p.X + dx / len * 0.8:0.0},{p.Z + dz / len * 0.8:0.0}");
            p.Replans++;
            if (p.Replans > 3 || p.Dest == null) Next(p);
            else GoTo(p, p.Dest.Value);
            return;
        }
        double ux = dx / len, uz = dz / len;
        // the right hand of the walking direction (x is the body's left, facing +z)
        double rx = -uz, rz = ux;
        double side = 0;
        // --- the player: stop short, or go round on the far side
        if (body != null)
        {
            double px = body.Value.x - p.X, pz = body.Value.z - p.Z, pd = Hyp(px, pz);
            if (pd < 2.4 && pd > 0.01)
            {
                double ahead = (px * ux + pz * uz) / pd;
                if (ahead > 0.2)
                {
                    if (pd < 1.0)
                    {
                        p.State = "blocked";
                        p.Held = 0;
                        p.Human.Play(StillMotion(p), 0.3f);
                        return;
                    }
                    double lat = (px * rx + pz * rz) / pd; // > 0: the player is on our right
                    side += (lat > 0.15 ? -1 : 1) * ((2.4 - pd) / 2.4) * 1.3;
                }
            }
        }
        // --- the others: keep right
        foreach (var q in people)
        {
            if (q == p) continue;
            double qx = q.X - p.X, qz = q.Z - p.Z;
            if (Math.Abs(qx) > 2 || Math.Abs(qz) > 2) continue;
            double qd = Hyp(qx, qz);
            if (qd < 0.01 || qd > 1.8) continue;
            double ahead = (qx * ux + qz * uz) / qd;
            if (ahead > 0.3 && qd < 1.4)
            {
                double lat = (qx * rx + qz * rz) / qd;
                side += (lat > 0.2 ? -1 : 1) * ((1.4 - qd) / 1.4) * (q.State == "walk" ? 0.9 : 1.4);
            }
        }
        // (the last metre to a waypoint straight in: steered aside there, they circled it)
        side = Math.Max(-1.2, Math.Min(1.2, side)) * Math.Min(1, len);
        double mx = ux + rx * side, mz = uz + rz * side;
        double ml = Hyp(mx, mz);
        mx /= ml;
        mz /= ml;
        var fl = p.Follower;
        double lag = fl != null && fl.State != "walk" ? Hyp(fl.X - p.X, fl.Z - p.Z) : 0;
        double step = Math.Min(len, p.Pace * dt * (lag > 2 ? 0.3 : 1));
        // a bridge ahead that is up or going up: wait at its end until it is down again (not while already on it)
        double look = Math.Max(step, 0.5);
        if (Bridges.Barred(p.X, p.Z, p.X + mx * look, p.Z + mz * look) || Bridges.Barred(p.X, p.Z, p.X + ux * look, p.Z + uz * look))
        {
            p.StuckT = 0;
            p.BridgeWait = true;
            Face(p, Math.Atan2(ux, uz), dt * 1.4);
            p.Human.Play(StillMotion(p), 0.3f);
            return;
        }
        p.BridgeWait = false;
        // a pushed handcart (or barrow) whose next step would roll it onto someone who has not got out of its way waits for him, standing; after
        // a while the step is refused below and the usual rules find another way (#192: carts at the Grote Markt's pitches rolled
        // over a seller at her stall, a man standing and a child at a street game who had no room to step aside)
        if ((p.Vehicle?.Cart != null || p.Barrow) && CartOnSomeone(p, mx * step, mz * step, Math.Atan2(mx, mz)) && CartOnSomeone(p, ux * step, uz * step, Math.Atan2(ux, uz)))
        {
            if (TraceRoutes && p.CartWait == 0) RouteNote(p, $"cart waits for puppet {cartOnWho?.Id} {cartOnWho?.State} at {cartOnWho?.X:0.00},{cartOnWho?.Z:0.00}");
            if ((p.CartWait += dt) < CartPatience)
            {
                p.StuckT = 0;
                p.Human.Play(StillMotion(p), 0.3f);
                return;
            }
        }
        else p.CartWait = 0;
        // the last leg may leave the grid (it keeps half a metre off the walls) for a spot the colliders allow:
        // a doorstep, a corner, a bench by a wall
        bool lastLeg = p.Pi == p.Path.Count - 1;
        // a way round a standing body may cross the grid cells it closed; the colliders still decide every step
        bool offGrid = lastLeg || (p.Pi < p.DetourEnd && p.DetourEnd <= p.Path.Count);
        if (TryMove(p, p.X + mx * step, p.Z + mz * step, offGrid, ux, uz,dt))
        {
            p.X += mx * step;
            p.Z += mz * step;
        }
        else if (TryMove(p, p.X + ux * step, p.Z + uz * step, offGrid, ux, uz,dt))
        {
            p.X += ux * step;
            p.Z += uz * step;
            mx = ux;
            mz = uz;
        }
        else if (Slide(p, ux, uz, step, offGrid,dt) is { } slid)
        {
            // a wall's corner the grid rounds too tightly: along the wall instead of giving up the way
            mx = slid.x;
            mz = slid.z;
        }
        else if (lastLeg && len < 1.2)
        {
            // the spot itself cannot be stood on (in a wall's berth, a thing on it): this near is there
            Arrive(p);
            return;
        }
        else
        {
            if(map.IsNative&&p.Vehicle?.Kind==1&&TryBicycleStep(p,p.X,p.Z,Math.Min(1,dt*7),out double turnYaw)
                && Math.Abs(NativeBicycleTurn.Angle(turnYaw-p.Yaw))>.001){p.Yaw=turnYaw;p.StuckT=0;return;}
            // something the walk map does not know: remember it and find another way; stand while it is worked out
            p.Human.Play(StillMotion(p), 0.3f);
            // Held at the same corner for seconds, however many ways were tried: go on to the next way point, so that
            // nobody stands for ever at a place the walk map and the colliders never agreed on.
            double heldBefore = p.Failed;
            if ((p.Failed += dt) > 1 && heldBefore <= 1 && WedgeLog.Count < 200) WedgeLog.Add(WedgeNote(p, "first step refused", ux, uz, step));
            if (TraceRoutes && heldBefore == 0) RouteNote(p, RefusedNote(p, t, ux, uz, step));
            // a pusher held by something passing (another cart, someone in his cart's way) waits for it a while, standing, rather than
            // planning a new way every frame: carts going home from the Grote Markt met in the narrow streets west of it and pushed
            // to and fro on the spot (#192)
            if ((p.Vehicle?.Cart != null || p.Barrow) && p.Failed < CartPatience && PassingHolds(p, ux, uz, step)) { p.StuckT = 0; return; }
            // a moment's standing before a new plan (#197: a walker whose step a cart just parked in his lane refused planned a new way
            // at once, round the block, and turned back the way he came: a body walking to and fro; a way round it comes first)
            if (p.Failed <= RefusedWait) { p.StuckT = 0; return; }
            // a body that stays put holds the step: go round its corners (a passing one is waited for)
            if (DetourStanding(p, p.X + ux * step, p.Z + uz * step, ux, uz, step)) return;
            // one passing (a cart, a cyclist): wait for it to go by, a while, rather than turn back on a new way
            if (p.Failed < PassingWait && p.DetourWhy.StartsWith("no standing body", StringComparison.Ordinal) && PassingHolds(p, ux, uz, step)) { p.StuckT = 0; return; }
            // a standing body with no way round its corners (a cart parked across a lane): the next plan goes another way
            if (p.DetourWhy.StartsWith("no free corner", StringComparison.Ordinal))
            {
                p.RoundStanding = true;
                // a pusher waits a while for it before he turns his cart round for another way (#197: a cart parked across the lane
                // home; turned back at once, the cart that met it went to and fro)
                if ((p.Vehicle?.Cart != null || p.Barrow) && p.Failed < CartPatience) { p.StuckT = 0; return; }
            }
            if (p.Failed > (p.Shown ? 6 : 3) && Unwedge(p, ux, uz, step)) return;
            grid.Block(p.X + ux * 0.6, p.Z + uz * 0.6);
            if (TraceRoutes) RouteNote(p, $"step refused towards {t.x:0.0},{t.z:0.0} (leg {p.Pi}/{p.Path.Count}, failed {p.Failed:0.00}, bodies [{map.BlockedBy(p, p.X + ux * step, p.Z + uz * step)}], round: {p.DetourWhy}); closed {p.X + ux * 0.6:0.0},{p.Z + uz * 0.6:0.0}");
            p.Replans++;
            if (p.Replans > 3 || p.Dest == null) Next(p);
            else GoTo(p, p.Dest.Value);
            return;
        }
        p.Failed = 0;
        if(p.VehicleStepYaw is double vehicleYaw){p.Yaw=vehicleYaw;p.VehicleStepYaw=null;if(p.Vehicle!=null)p.Vehicle.InitialHeading=false;}
        else Face(p, Math.Atan2(mx, mz), dt * 1.4);
        // no nearer for a second (someone in the way pushes him back): he waits, standing
        if (p.StuckT > 1)
        {
            p.Human.Play(StillMotion(p), 0.3f);
            return;
        }
        p.Human.Play(WalkMotion(p), 0.25f);
        p.Human.SetPace((float)(p.Pace / p.Size));
    }

    /// <summary>Everything that can refuse a body's step, for the stuck check's report (what held it, and where).</summary>
    public readonly List<string> WedgeLog = new(), WedgeMaps = new();
    private string WedgeNote(Puppet p, string what, double ux, double uz, double step)
    {
        var t = p.Pi < p.Path.Count ? p.Path[p.Pi] : (x: p.X, z: p.Z);
        double nx = p.X + ux * step, nz = p.Z + uz * step;
        var nose = p.Nose == 0 ? (x: nx, z: nz) : NosePoint(p, nx, nz, ux, uz);
        if (what.StartsWith("first") && WedgeMaps.Count < 24) WedgeMaps.Add($"puppet {p.Id} at {p.X:0.00},{p.Z:0.00} (x from {p.X - 6:0.00}), P body, T target, N nose, # not free:\n"
            + string.Join("\n", map.DumpCells(p.X, p.Z, 6, ('P', p.X, p.Z), ('T', t.x, t.z), ('N', nose.x, nose.z))));
        return $"{what}: puppet {p.Id} {p.Role} nose {p.Nose} at {p.X:0.00},{p.Z:0.00} yaw {p.Yaw:0.00} to {t.x:0.00},{t.z:0.00} (leg {p.Pi}/{p.Path.Count}, native {p.NativeRouting}, shown {p.Shown}); "
            + $"standHere {map.FreeFor(p, p.X, p.Z)}, bodyFreeStep {StepFree(p, nx, nz)}, supportsStep {map.SupportsStep(p.X, p.Z, nx, nz)}, supportsLeg {map.SupportsStep(p.X, p.Z, t.x, t.z)}, "
            + $"noseFree {p.Nose == 0 || map.FreeFor(p, nose.x, nose.z)}, noseStatic {p.Nose == 0 || map.SupportsStep(nose.x, nose.z, nose.x, nose.z)}, "
            + $"noseAt {nose.x:0.00},{nose.z:0.00}, gridOpen {grid.IsOpen(nx, nz)}, bodiesAtNose [{(p.Nose == 0 ? "" : map.BlockedBy(p, nose.x, nose.z))}], bodiesAtStep [{map.BlockedBy(p, nx, nz)}]" + (p.DetourWhy != "" ? $", no way round: {p.DetourWhy}" : "");
    }

    /// <summary>Blocked straight on: a step turned up to 70 degrees either way, if one is free (the way it went).</summary>
    private static readonly double[] SlideAngles = { 0.6, -0.6, 1.2, -1.2 };
    /// <summary>
    /// A body that has not been able to take a single step for seconds: set it on its next way point (or the nearest free ground
    /// to it) when that is close, and go on from there. False when there is nowhere free to put it.
    /// </summary>
    private bool Unwedge(Puppet p, double ux, double uz, double step)
    {
        if (p.Pi >= p.Path.Count) return false;
        var t = p.Path[p.Pi];
        if (Hyp(t.x - p.X, t.z - p.Z) > (p.Shown ? 3 : 12)) return false;
        (double x, double z)? to = map.FreeFor(p, t.x, t.z) && !SomeoneAt(t.x, t.z) && OwnClear(p, t.x, t.z) ? t : OpenNearFree(t.x, t.z);
        if (to == null || !OwnClear(p, to.Value.x, to.Value.z)) return false;
        // (a pusher set on: his handcart or barrow comes with him, and must not come down on anyone)
        if (PushedOnSomeone(p, to.Value.x, to.Value.z, Math.Atan2(to.Value.x - p.X, to.Value.z - p.Z))) return false;
        if (WedgeLog.Count < 200) WedgeLog.Add(WedgeNote(p, "safety net used", ux, uz, step));
        if (TraceRoutes) RouteNote(p, $"safety net to {to.Value.x:0.0},{to.Value.z:0.0}");
        p.X = to.Value.x;
        p.Z = to.Value.z;
        p.Pi++;
        p.Failed = 0;
        p.StuckT = 0;
        p.BestD = double.PositiveInfinity;
        if (p.Pi >= p.Path.Count) Arrive(p);
        return true;
    }

    private bool TryMove(Puppet p, double x, double z, bool lastLeg, double ux, double uz,double dt)
    {
        if(!StepFree(p,x,z)||p.NativeRouting&&!map.SupportsStep(p.X,p.Z,x,z)
            ||!(p.NativeRouting||lastLeg||grid.IsOpen(x,z)||!grid.IsOpen(p.X,p.Z)))return false;
        if(map.IsNative&&p.Vehicle?.Kind==1){if(!TryBicycleStep(p,x,z,Math.Min(1,dt*7),out double yaw))return false;p.VehicleStepYaw=yaw;return true;}
        if (PushedOnSomeone(p, x, z, Math.Atan2(x - p.X, z - p.Z))) return false;
        if (p.Nose == 0) return true;
        var nose = NosePoint(p, x, z, ux, uz);
        return map.FreeFor(p, nose.x, nose.z);
    }

    /// <summary>
    /// Where the front of a long vehicle (a dray's nose, 3.3 m) will be when its body is at (x, z): that far ahead along the route,
    /// round the corners it still has, not straight on towards the next way point. Straight on, a way point half a metre off
    /// across a lane's corner pointed the nose into the wall and the cart never started (issue 105).
    /// </summary>
    private (double x, double z) NosePoint(Puppet p, double x, double z, double ux, double uz)
    {
        if (!p.NativeRouting) return (x + ux * p.Nose, z + uz * p.Nose);
        double left = p.Nose, cx = x, cz = z, dirX = ux, dirZ = uz;
        for (int i = p.Pi; i < p.Path.Count; i++)
        {
            double sx = p.Path[i].x - cx, sz = p.Path[i].z - cz, l = Hyp(sx, sz);
            if (l < 1e-6) continue;
            dirX = sx / l; dirZ = sz / l;
            if (l >= left) return (cx + dirX * left, cz + dirZ * left);
            left -= l; cx = p.Path[i].x; cz = p.Path[i].z;
        }
        // the route ends short of the nose: on in the last direction
        return (cx + dirX * left, cz + dirZ * left);
    }
    private (double x, double z)? Slide(Puppet p, double ux, double uz, double step, bool lastLeg,double dt)
    {
        foreach (double a in SlideAngles)
        {
            double c = Math.Cos(a), sn = Math.Sin(a);
            double x = ux * c - uz * sn, z = ux * sn + uz * c;
            if (TryMove(p, p.X + x * step, p.Z + z * step, lastLeg, ux, uz,dt))
            {
                p.X += x * step;
                p.Z += z * step;
                return (x, z);
            }
        }
        return null;
    }

    /// <summary>A way round the player (right first, as on the street), put in front of the path.</summary>
    private bool Detour(Puppet p)
    {
        if (body == null) return false;
        var t = p.Pi < p.Path.Count ? p.Path[p.Pi] : body.Value;
        double fx0 = t.x - p.X, fz0 = t.z - p.Z, fl = Hyp(fx0, fz0);
        if (fl == 0) fl = 1;
        double fx = fx0 / fl, fz = fz0 / fl;
        for (int s = 1; s >= -1; s -= 2)
        {
            double rx = -fz * s, rz = fx * s;
            var a = (x: p.X + rx * 1.2, z: p.Z + rz * 1.2);
            var b = (x: body.Value.x + rx * 1.3 + fx * 1.2, z: body.Value.z + rz * 1.3 + fz * 1.2);
            bool Ok((double x, double z) q) => grid.IsOpen(q.x, q.z) && map.Free(q.x, q.z);
            if (Ok(a) && Ok(b) && grid.LineOpen(a.x, a.z, b.x, b.z))
            {
                p.Path.Insert(p.Pi, b);
                p.Path.Insert(p.Pi, a);
                if (TraceRoutes) RouteNote(p, $"round the player by {a.x:0.0},{a.z:0.0} and {b.x:0.0},{b.z:0.0}");
                p.State = "walk";
                p.SinceDetour = 0;
                return true;
            }
        }
        return false;
    }

    private void Arrive(Puppet p)
    {
        p.Path.Clear();
        p.Pi = 0;
        p.Replans = 0;
        p.Failed = 0;
        if (p.Repath && p.Dest != null)
        {
            // the old way is walked out and a new goal waits: on there as soon as a way is found
            p.Repath = false;
            p.State = "wait";
            return;
        }
        p.Dest = null;
        p.State = "stand";
        // (never a walk clip left from a layer's own steps: they would stand walking on the spot)
        p.Human.Play(StillMotion(p), 0.3f);
    }

    /// <summary>The way is blocked: the town decides where; the crowd only tries the way again (or gives up and stands).</summary>
    private void Next(Puppet p)
    {
        if (p.Role == "follow")
        {
            if (p.Lead != null) GoTo(p, (p.Lead.X, p.Lead.Z));
            return;
        }
        if (p.Dest != null && p.Replans <= 4) GoTo(p, p.Dest.Value);
        else
        {
            p.Dest = null;
            p.State = "stand";
            p.Human.Play(StillMotion(p), 0.3f);
        }
    }

    private void GoTo(Puppet p, (double x, double z) dest)
    {
        p.Dest = dest;
        p.Repath = false;
        if (pathBudget <= 0)
        {
            p.State = "wait";
            p.Human.Play(StillMotion(p), 0.3f);
            return;
        }
        pathBudget--;
        // (a resident's pushed handcart takes the native way with room for it, #196, not the crowd grid's)
        bool wide = map.IsNative && p.Vehicle?.Cart != null;
        var path = !wide && (grid.Inside(dest.x, dest.z, 4) || !map.IsNative)
            ? grid.Path(p.X, p.Z, dest.x, dest.z, 9000, standFree, p.Path) : null;
        if (path == null && grid.Deferred)
        {
            // the frame's route cells are spent (#133): walk on the old way, or wait, and ask again next frame
            // (from where the body then is: a way from an older place could start through someone)
            if (p.State == "walk" && p.Pi < p.Path.Count) p.Repath = true;
            else { p.State = "wait"; p.Human.Play(StillMotion(p), 0.3f); }
            return;
        }
        p.StandDetours = 0;
        p.DetourEnd = 0;
        p.NativeRouting = false;
        if (path is not { Count: > 0 } && map.IsNative) {
            p.NativeRoute ??= new NativeCrowdRoute(map);
            bool round = p.RoundStanding; p.RoundStanding = false;
            if (p.NativeRoute.Window(new Vector2((float)p.X, (float)p.Z), new Vector2((float)dest.x, (float)dest.z), p.Path, round, wide)) {
                p.NativeRouting = true; path = p.Path;
            }
        }
        if (path is { Count: > 0 })
        {
            if (TraceRoutes) RouteNote(p, $"{(p.NativeRouting ? "native" : "grid")} way to {dest.x:0.0},{dest.z:0.0} (replans {p.Replans}): {Points(path)}");
            p.Path = path;
            p.Pi = 0;
            p.BestD = double.PositiveInfinity;
            p.StuckT = 0;
            p.State = "walk";
        }
        else
        {
            p.Replans++;
            if (TraceRoutes) RouteNote(p, $"no way to {dest.x:0.0},{dest.z:0.0} (replans {p.Replans})");
            p.State = "pause";
            p.Timer = Rnd(1, 3);
            if (p.Replans > 3) p.Dest = null;
            // no way there now: stand while waiting to try again
            p.Human.Play(StillMotion(p), 0.3f);
        }
    }
}
