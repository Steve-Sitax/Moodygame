using System;
using System.Collections.Generic;
using Godot;
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
    private readonly float[] g, f;
    private readonly int[] from, stamp, closed, heap;
    private int search;
    private WalkMap? map;
    private readonly List<(double x, double z)> pathCells = new(512);

    public NavGrid(int half)
    {
        Half = half;
        N = half * 2;
        int n2 = N * N;
        open = new byte[n2];
        g = new float[n2];
        f = new float[n2];
        from = new int[n2];
        stamp = new int[n2];
        closed = new int[n2];
        heap = new int[n2];
    }

    /// <summary>Rebuild round (cx, cz): the cells of the baked walk map (WalkMap.Open is the browser's own test per cell).</summary>
    public void Build(WalkMap m, double cx, double cz)
    {
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
        if (c >= 0) open[c] = 0;
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
    /// A* over the open cells, straightened into a few waypoints. Null if there is no way. The way ends on the target
    /// itself, or where the target is off the grid and `standAt` says no body stands there, on the open cell nearest.
    /// </summary>
    public List<(double x, double z)>? Path(double sx, double sz, double tx, double tz, int maxExpand = 9000, Func<double, double, bool>? standAt = null, List<(double x, double z)>? output = null)
    {
        output?.Clear();
        var s0 = NearestOpen(sx, sz, 2, standAt);
        var t0 = NearestOpen(tx, tz, 2, standAt);
        if (s0 == null || t0 == null) return null;
        int s = Cell(s0.Value.x, s0.Value.z), t = Cell(t0.Value.x, t0.Value.z);
        int n = N, tix = t % n, tiz = t / n;
        float H(int c)
        {
            int dx = Math.Abs(c % n - tix), dz = Math.Abs(c / n - tiz);
            return Math.Max(dx, dz) + 0.4142f * Math.Min(dx, dz);
        }
        int id = ++search;
        int size = 0;
        void Push(int c)
        {
            int i = size++;
            heap[i] = c;
            while (i > 0)
            {
                int p = (i - 1) >> 1;
                if (f[heap[p]] <= f[heap[i]]) break;
                (heap[p], heap[i]) = (heap[i], heap[p]);
                i = p;
            }
        }
        int Pop()
        {
            int top = heap[0];
            heap[0] = heap[--size];
            int i = 0;
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
        stamp[s] = id;
        g[s] = 0;
        f[s] = H(s);
        from[s] = -1;
        Push(s);
        bool found = false;
        int expanded = 0;
        while (size > 0 && expanded < maxExpand)
        {
            int c = Pop();
            if (closed[c] == id) continue;
            closed[c] = id;
            if (c == t)
            {
                found = true;
                break;
            }
            expanded++;
            int cx = c % n, cz = c / n;
            for (int dz = -1; dz <= 1; dz++)
                for (int dx = -1; dx <= 1; dx++)
                {
                    if (dx == 0 && dz == 0) continue;
                    int nx = cx + dx, nz = cz + dz;
                    if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
                    int nc = nz * n + nx;
                    if (open[nc] == 0 || closed[nc] == id) continue;
                    // no cutting corners past a wall
                    if (dx != 0 && dz != 0 && (open[cz * n + nx] == 0 || open[nz * n + cx] == 0)) continue;
                    float ng = g[c] + (dx != 0 && dz != 0 ? 1.4142f : 1);
                    if (stamp[nc] == id && ng >= g[nc]) continue;
                    stamp[nc] = id;
                    g[nc] = ng;
                    f[nc] = ng + H(nc);
                    from[nc] = c;
                    Push(nc);
                }
        }
        if (!found) return null;
        var cells = pathCells;
        cells.Clear();
        for (int c = t; c != -1; c = from[c]) cells.Add((X0 + c % n + 0.5, Z0 + c / n + 0.5));
        cells.Reverse();
        if (standAt != null ? standAt(tx, tz) : IsOpen(tx, tz)) cells[^1] = (tx, tz);
        // string pulling: keep only the corners
        var o = output ?? new List<(double x, double z)>();
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
    public bool Shown;
    internal double AnimAcc;
    internal double BestD = double.PositiveInfinity, StuckT;
    internal string PMotion = "idle";
    internal double? PYaw;
    internal bool Repath;
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
    /// <summary>Pushes a handcart (the mill's man on a run): the cart on its own wheels before him, the push clips.</summary>
    public bool Pushes;
}

/// <summary>
/// The people in the street (the browser's game/crowd.ts, the part the town's residents use): Townspeople says where
/// each one goes and what they do there; the crowd walks them on its grid (A*, keep right, go round the player, stuck
/// checks, bodies keep apart), draws and animates them and keeps the bodies in a pool.
/// Loads in the hands, the carter's handcart and lanterns: People/Carried.cs.
/// Not ported yet: the nameless crowd (it stays home once the town is in), vehicles and giving way to them, the
/// opening bridges' gate, the groups sitting on crates.
/// </summary>
public sealed class Crowd
{
    private const double BodyGap = 0.6, BodyShove = 1.2, LoadGap = 0.15, MaxGap = BodyGap + 2 * LoadGap;
    private const double AnimNear = 25, AnimFar = 45;
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

    /// <summary>How far the fog lets one see (the browser's scene.fog.far).</summary>
    public double FogDistance = 40;
    public int Drawn { get; private set; }
    public int Animated { get; private set; }
    public IReadOnlyList<Puppet> Walking => people;

    public Crowd(Node parent, WalkMap map, int radius = 70)
    {
        this.parent = parent;
        this.map = map;
        standFree = map.Free;
        noPerson = NoPersonAt;
        grid = new NavGrid(radius + 12);
    }

    private double Rnd(double a, double b) => a + rng.NextDouble() * (b - a);
    private static double AngDiff(double a, double b) => Math.Atan2(Math.Sin(a - b), Math.Cos(a - b));
    /// <summary>A new permanent prop changed the walk map: use its footprint before taking another step.</summary>
    public void RebuildGrid(double x, double z) { grid.Build(map, x, z); gridAge = 0; }
    private static double Hyp(double a, double b) => Math.Sqrt(a * a + b * b);

    public void Update(double dt, double vx, double vz, (double x, double z)? playerBody, Camera3D? camera)
    {
        using var profileCost = Scheldemist.Dev.FrameCost.Track("Town.Crowd");
        map.RefreshBodies();
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
        foreach (var p in people) Think(p, dt);
        KeepApart(dt);
        int drawn = 0, animated = 0;
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
                    p.Human.Update((float)p.AnimAcc);
                    p.AnimAcc = 0;
                    animated++;
                }
            }
            // down on the knees, on a chair, crouched (eased), or a hop (at once)
            double lift = p.State == "sit" ? 0 : p.Human.MotionLift() * p.Size;
            double want = p.State == "sit" ? p.Human.SitDrop() * p.Size : Math.Min(0, lift);
            p.Drop += (want - p.Drop) * Math.Min(1, dt * 4);
            if (inView) y = p.Drop + Math.Max(0, lift) + (p.State == "sit" ? 0 : p.Human.Bob() * p.Size);
            p.Group.Position = new Vector3((float)p.X, (float)(y + ground), (float)p.Z);
            p.Group.Rotation = new Vector3(0, (float)p.Yaw, 0);
            if (p.Kind == "carter" || p.Pushes) PushTheCart(p, dt, inView, ground);
            else if (p.Cart != null)
            {
                p.Cart.Dispose();
                p.Cart = null;
            }
            if (p.Lantern != null) PlaceLantern(p, d, ground, camera);
        }
        Drawn = drawn;
        Animated = animated;
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
        if (pace is > 0) p.Pace = pace.Value;
        double tx = x, tz = z;
        if (grid.Built && !grid.Inside(x, z, 4))
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

    /// <summary>A load in the arms: a sack, a crate, a box of fish, a keg (crowd.ts puppetLoad); off: put down.</summary>
    public void PuppetLoad(Puppet p, bool on, string kind = "sack")
    {
        p.HandCarry = true;
        if (p.LoadNode != null && (!on || p.LoadKind != kind))
        {
            p.LoadNode.QueueFree();
            p.LoadNode = null;
        }
        p.LoadKind = kind;
        p.Loaded = on;
        if (on && p.LoadNode == null && (p.LoadNode = Carried.Load(kind, p.Human.Scale)) != null) p.Group.AddChild(p.LoadNode);
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
            p.Human.Play("idle", 0.3f);
        }
    }

    public bool PuppetFollowing(Puppet p) => p.TownFollow;

    public void RemovePuppet(Puppet p)
    {
        if (!people.Remove(p)) return;
        if (p.Follower != null) p.Follower.Lead = null;
        if (p.Lead != null) p.Lead.Follower = null;
        if (p.Lantern != null) DropLantern(p);
        p.Cart?.Dispose();
        p.Cart = null;
        p.Group.RemoveChild(p.Human.Root);
        p.Group.QueueFree();
        if (!pool.TryGetValue(p.Kind, out var list)) pool[p.Kind] = list = new List<Human>();
        list.Add(p.Human);
    }

    public bool Alive(Puppet p) => people.Contains(p);

    /// <summary>At the game's end: everyone out of the street, the pooled bodies given back.</summary>
    public void Dispose()
    {
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
    public bool CanStand(double x, double z) => grid.Built && grid.IsOpen(x, z) && map.Free(x, z);

    /// <summary>The nearest open grid point, for a puppet that would appear in a wall.</summary>
    public (double x, double z)? OpenNear(double x, double z) => grid.Built ? grid.NearestOpen(x, z, 4, standFree) : null;

    /// <summary>Does someone stand or walk within a body's gap of (x, z)?</summary>
    private bool NoPersonAt(double x, double z) => map.Free(x, z) && !SomeoneAt(x, z);
    public bool SomeoneAt(double x, double z)
    {
        foreach (var q in people)
            if (Math.Abs(q.X - x) < BodyGap && Math.Abs(q.Z - z) < BodyGap && Hyp(q.X - x, q.Z - z) < BodyGap) return true;
        return false;
    }

    /// <summary>The nearest open grid point where nobody is yet, or null.</summary>
    public (double x, double z)? OpenNearFree(double x, double z) => grid.Built ? grid.NearestOpen(x, z, 4, noPerson) : null;

    /// <summary>The walk on the grid round the viewer from a to b (corner points), or null.</summary>
    public List<(double x, double z)>? PathOn(double ax, double az, double bx, double bz, List<(double x, double z)>? output = null)
    {
        if (!grid.Built || !grid.Inside(bx, bz, 2)) return null;
        var a = grid.NearestOpen(ax, az, 6);
        return a != null ? grid.Path(a.Value.x, a.Value.z, bx, bz, 6000, null, output) : null;
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
        p.SinceDetour += dt;
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
                p.Human.Play("idle", 0.3f);
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
            p.Human.Play("idle", 0.3f);
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
            p.Human.Play("walk", 0.25f);
            p.Human.SetPace((float)(sp / p.Size));
        }
        else
        {
            p.State = "stand";
            if (walking)
            {
                Face(p, l.Yaw, dt);
                p.Human.Play("walk", 0.25f);
                p.Human.SetPace((float)(l.Pace / p.Size));
            }
            else p.Human.Play("idle", 0.35f);
            if (!walking && l.State != "pause") Face(p, l.Yaw, dt);
            if (!walking && l.State == "pause") Face(p, Math.Atan2(l.X - p.X, l.Z - p.Z), dt);
        }
    }

    private static void Face(Puppet p, double yaw, double dt) => p.Yaw += AngDiff(yaw, p.Yaw) * Math.Min(1, dt * 5);

    /// <summary>What someone plays while not moving: a townsperson's own pose (never a walk), or a stand.</summary>
    private static string StillMotion(Puppet p) => !WalkClips.Contains(p.PMotion) ? p.PMotion : "idle";

    /// <summary>
    /// May this body step to (x, z)? Where the colliders let it. Someone already standing where that does not hold
    /// (put there by a layer, a follower at a wall) may still step on, so they walk out instead of walking on the spot.
    /// </summary>
    private bool StepFree(Puppet p, double x, double z)
    {
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
        // (the browser lets a thinner body through there; the bake has one body's width: towards ground a body fits on within a metre)
        double dx = x - p.X, dz = z - p.Z, d = Hyp(dx, dz);
        if (d < 1e-6) return false;
        for (int k = 1; k <= 4; k++)
            if (map.FreeFor(p, p.X + dx / d * 0.25 * k, p.Z + dz / d * 0.25 * k)) return true;
        return false;
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
        if (len < 0.35)
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
        // the last leg may leave the grid (it keeps half a metre off the walls) for a spot the colliders allow:
        // a doorstep, a corner, a bench by a wall
        bool lastLeg = p.Pi == p.Path.Count - 1;
        if (TryMove(p, p.X + mx * step, p.Z + mz * step, lastLeg, ux, uz))
        {
            p.X += mx * step;
            p.Z += mz * step;
        }
        else if (TryMove(p, p.X + ux * step, p.Z + uz * step, lastLeg, ux, uz))
        {
            p.X += ux * step;
            p.Z += uz * step;
            mx = ux;
            mz = uz;
        }
        else if (Slide(p, ux, uz, step, lastLeg) is { } slid)
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
            // something the walk map does not know: remember it and find another way; stand while it is worked out
            p.Human.Play(StillMotion(p), 0.3f);
            grid.Block(p.X + ux * 0.6, p.Z + uz * 0.6);
            p.Replans++;
            if (p.Replans > 3 || p.Dest == null) Next(p);
            else GoTo(p, p.Dest.Value);
            return;
        }
        Face(p, Math.Atan2(mx, mz), dt * 1.4);
        // no nearer for a second (someone in the way pushes him back): he waits, standing
        if (p.StuckT > 1)
        {
            p.Human.Play(StillMotion(p), 0.3f);
            return;
        }
        p.Human.Play(p.Pushes ? "push" : p.Loaded && p.HandCarry ? "carry" : "walk", 0.25f);
        p.Human.SetPace((float)(p.Pace / p.Size));
    }

    /// <summary>Blocked straight on: a step turned up to 70 degrees either way, if one is free (the way it went).</summary>
    private static readonly double[] SlideAngles = { 0.6, -0.6, 1.2, -1.2 };
    private bool TryMove(Puppet p, double x, double z, bool lastLeg, double ux, double uz) => StepFree(p, x, z)
        && (lastLeg || grid.IsOpen(x, z) || !grid.IsOpen(p.X, p.Z))
        && (p.Nose == 0 || map.FreeFor(p, x + ux * p.Nose, z + uz * p.Nose));
    private (double x, double z)? Slide(Puppet p, double ux, double uz, double step, bool lastLeg)
    {
        foreach (double a in SlideAngles)
        {
            double c = Math.Cos(a), sn = Math.Sin(a);
            double x = ux * c - uz * sn, z = ux * sn + uz * c;
            if (TryMove(p, p.X + x * step, p.Z + z * step, lastLeg, ux, uz))
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
            p.Human.Play("idle", 0.3f);
            return;
        }
        pathBudget--;
        var path = grid.Path(p.X, p.Z, dest.x, dest.z, 9000, standFree, p.Path);
        if (path is { Count: > 0 })
        {
            p.Path = path;
            p.Pi = 0;
            p.BestD = double.PositiveInfinity;
            p.StuckT = 0;
            p.State = "walk";
        }
        else
        {
            p.Replans++;
            p.State = "pause";
            p.Timer = Rnd(1, 3);
            if (p.Replans > 3) p.Dest = null;
            // no way there now: stand while waiting to try again
            p.Human.Play(StillMotion(p), 0.3f);
        }
    }
}
