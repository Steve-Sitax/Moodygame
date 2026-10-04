using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.People;
using Scheldemist.World;

namespace Scheldemist.Town;

/// <summary>
/// The town (the browser's game/town.ts): the residents the server made (homes, families, trades, schedules) living
/// by the game clock. Everyone is simulated cheaply by schedule: where they should be now, and a walk there along
/// the way on foot the server found (Whereabouts.cs: the same sum the server's town map and the browser use). Only
/// those near the viewer become people in the street: puppets of the crowd (Crowd.cs), which walks them on its grid.
/// Here each one gets told what to do: come out of their door, walk to work, stand at the stall, walk between the
/// quay and the door, walk the beat, play tag, stand at the tavern door, walk home and go in.
///
/// Options: --server http://127.0.0.1:PORT (the town comes from its /api/town, the ways from /api/town/ways),
/// --hour 13.5 and --day 1 (the clock, until the game state part sets it: SetClock), --walk file (the bake's walk
/// dump, town_walk.json; else beside the town, else baked/town_walk.json).
///
/// The great storm's shelter (SetStorm), the calls at the shops (ShopCalls.cs) and the mill's man with his cart are in.
/// StreetLife supplies the back streets, door routines, children's games and market browsing; Animals supplies
/// dogs at heel; MarketStalls opens and covers the displays. HallPeople and HomeVisitors supply room figures.
/// Still separate: vehicle journeys and horses, the dispatcher's trade runs, thieves at Jef's pocket, event
/// scenes and director actions, and shared animal states when playing together.
/// </summary>
[GamePart(200)]
public partial class Townspeople : Node
{
    private const double SpawnR = 55;
    /// <summary>A person due in the street in view steps in at once beyond this (m), nearer after a wait.</summary>
    private const double DueFar = 40;
    /// <summary>A running townsperson seen in the street hurries at most this fast (m/s): the walk cycle, sped up, still reads.</summary>
    private const double SeenRunMax = 2.0;
    private const double DueWaitMs = 2500;
    private const double DueNear = 20;
    private const double DueNearWaitMs = 8000;
    /// <summary>With the street full, someone due this much nearer (m) than the farthest drawn one takes his place.</summary>
    private const double SwapGap = 12;
    private const double DespawnR = 68;
    /// <summary>Unseen and off their plan, people cross town at this pace (m/s).</summary>
    private const double HiddenSpeed = 6;
    /// <summary>The unseen take a coarse step every this many frames, in turns.</summary>
    private const int CoarseEvery = 4;
    /// <summary>A way not sent by the server after this many seconds: an unseen walker goes straight on meanwhile.</summary>
    private const double WayWaitS = 20;

    public sealed class Goal
    {
        /// <summary>home, inside, church, stand, haul, patrol, roam, play, market, loiter, tavern, stroll, thief, guard, inspect.</summary>
        public string Mode = "home";
        public double X, Z;
        public double? Yaw;
        public string? Motion;
        /// <summary>Spread over this radius (market, play, loiter, stroll).</summary>
        public double? R;
        public Pt[]? Route;
        public Pt? A, B;
        public string? Place;
        public double[]? Faces;
    }

    public sealed class Sim
    {
        public Resident R = null!;
        public string Kind = "";
        public double X, Z;
        public bool Inside;
        /// <summary>The door they went in at (to come out of it again).</summary>
        public Pt Door;
        public string Key = "";
        public Goal Goal = new();
        public Puppet? P;
        public int Step;
        public double Wait;
        public bool ToB;
        /// <summary>The last walk has ended and the pause there has begun.</summary>
        public bool Arrived;
        public int Tries;
        public string Tav = "";
        public double OutAt;
        /// <summary>0-1, stable per person (spread, who talks when).</summary>
        public double H;
        public int Ph;
        public double? Face;
        /// <summary>His goal is his day plan's own, so unseen he walks the shared sum (Whereabouts.cs).</summary>
        public bool Plain;
        public double? DueAt;
        public double DueLast;
        /// <summary>How far behind his day he is (game hours), held up in view (Whereabouts.ReportLag).</summary>
        public double Lag;
        public double CoarseDt;
        /// <summary>A lantern in his hand now.</summary>
        public bool Lamp;
        /// <summary>The great storm: where he runs to in it ("stay", "home", "tavern", "under"; null: no storm), and the tavern.</summary>
        public string? Shelter;
        public string ShelterPlace = "";
        /// <summary>On a run with the mill's cart (the game minute of his last order).</summary>
        public bool MillRun;
        /// <summary>An action owns this resident until it releases him; his day must not pull him away.</summary>
        public bool ActionHeld;
        public object? ActionOwner;
        internal string GamePlace = "", GameKind = "", PropBase = "", PropGame = "", PropKey = "";
        internal int GameDay = -1, GameSlice = -1, ScheduleStorm = -1;
        internal string ScheduleAct = "", SchedulePlace = "", ScheduleLife = "", ScheduleShelter = "", ScheduleRun = "";
        internal Pt? ScheduleCall;
        internal bool ScheduleStormOn;
        internal HiddenWay? Hw;
        internal readonly HiddenWay HiddenBuffer = new();
        internal Station? Round;
    }

    internal sealed class HiddenWay
    {
        public double Tx, Tz, Asked;
        public string Key = "";
        public Pt[]? Pts;
        public int I = 1;
        public bool Straight;
    }

    internal sealed class Station
    {
        public string Key = "";
        public double X, Z, Wait;
        public string Phase = "rest";
    }

    private sealed class Game
    {
        public Sim? It, Last;
        public double Frozen;
    }

    /// <summary>The town as the server gave it; null until it is in.</summary>
    public TownData? Data { get; private set; }
    /// <summary>How many townspeople walk in the street round the viewer at once (the browser's Settings, "People in the street").</summary>
    public int MaxPuppets = 50;
    /// <summary>Is this tavern or shop ("shop:id") open in the world, so its people go in at the door? The rooms' part sets it; until then they stand before the door.</summary>
    public Func<string, bool> TavernInside = _ => false;
    /// <summary>The doors' part: does this house's door ("tavern:x", "shop:id") stand open now? Not set (or null): open while its keeper is at work. People pass a door's place whatever its state.</summary>
    public Func<string, bool?>? DoorAt;
    /// <summary>The people inside the houses that stand in the world with their rooms (Indoors.cs).</summary>
    public Indoors? Indoors { get; private set; }
    /// <summary>The player's body on the ground (walkers stop for it and go round); null: Jef, while he walks (not the free camera).</summary>
    public Func<(double x, double z)?>? PlayerBody;
    public Crowd? Crowd { get; private set; }
    public WalkMap? Walk { get; private set; }
    public IReadOnlyList<Sim> Sims => sims;
    /// <summary>The board's employers: residents who stand at their post like Sooi (the browser's people.ts; People/PostedPeople.cs stands them).</summary>
    public IReadOnlyList<Resident> EmployerResidents => employers;
    public string Status { get; private set; } = "off";
    public int BakedHidden { get; private set; }

    private readonly Whereabouts.WayOf wayOf;
    public Townspeople() { wayOf = WayOf; }
    public long AllocatedBytesLastFrame { get; private set; }
    public readonly long[] AllocationParts = new long[5];
    private readonly List<Sim> sims = new();
    private readonly Dictionary<string, Sim> byId = new();
    private readonly Dictionary<string, Resident> peopleInfo = new();
    private readonly List<Resident> employers = new();
    private readonly Dictionary<string, string> shopPlaces = new();
    private string ShopPlace(string id) { if (!shopPlaces.TryGetValue(id, out var value)) shopPlaces[id] = value = "shop:" + id; return value; }
    private readonly Dictionary<string, (double x, double z, double yaw)> sellerSpots = new();
    private readonly Dictionary<string, Game> games = new();
    private readonly Dictionary<string, Pt[]?> ways = new();
    private readonly HashSet<string> planWaysPending = new();
    private readonly Dictionary<(long, long, long, long), string> wayNames = new();
    private string WayName(double ax, double az, double bx, double bz)
    {
        var key = ((long)Whereabouts.JsRound(ax), (long)Whereabouts.JsRound(az), (long)Whereabouts.JsRound(bx), (long)Whereabouts.JsRound(bz));
        if (!wayNames.TryGetValue(key, out var name)) wayNames[key] = name = Whereabouts.WayKey(ax, az, bx, bz);
        return name;
    }
    private readonly HashSet<string> wayAsk = new();
    /// <summary>Asked for, the answer not in yet.</summary>
    private readonly HashSet<string> wayAsked = new();
    private readonly ConcurrentQueue<Action> inbox = new();
    private readonly Random rng = new();
    private LanternPool? lanterns;
    private readonly ShopCalls shopCalls = new();
    private double stormLevel;
    private int stormEvent;
    private List<string>? taverns;
    private List<(double x, double z, double sx, double sz)>? doorList;

    /// <summary>The great storm: how fast they run for shelter (m/s), the walk cycle sped up as far as it still reads as a run.</summary>
    private const double StormRun = 2.3;
    /// <summary>A doorway farther than this (m) is no shelter; they run home. Within the second of the cathedral, they go in there.</summary>
    private const double StormDoorM = 70, StormChurchM = 80;

    /// <summary>
    /// The great storm (world/tempest.ts, shared/tempest.ts): while its level is over 0 everyone out in it runs for
    /// shelter (home, the nearest tavern, the cathedral, under a doorway), nobody calls at a shop, and the park
    /// empties. 0 ends it and the day goes on. A new storm is a new roll of who goes where (`storm`: its number;
    /// by default the next one).
    /// </summary>
    public void SetStorm(double level, int storm = -1)
    {
        bool was = stormLevel > 0, on = level > 0;
        stormLevel = Math.Max(0, level);
        if (on && !was) stormEvent = storm >= 0 ? storm : stormEvent + 1;
        else if (on && storm >= 0) stormEvent = storm;
    }

    public double StormLevel => stormLevel;

    /// <summary>Is it raining hard enough to empty the park? (the weather part may set it; else the store's weather says)</summary>
    public Func<bool> Raining = () => Scheldemist.Game.GameState.I.Weather is "rain" or "storm";
    private System.Net.Http.HttpClient? http;
    private string server = "";
    private double wayAskT, thinkT, spawnT, lagT, lagAt = -1;
    private int coarseTurn;
    private bool filled, waysIn;
    private double px, pz;
    private int day = 1;
    private double hour = 13;
    /// <summary>The clock runs on by itself at the game's rate (a game hour is two real minutes: shared/clock.ts).</summary>
    public bool ClockRuns = true;

    /// <summary>A check: the town stands still (no steps, no clips), to time a frame without its logic.</summary>
    public bool Paused;
    /// <summary>What the town's and the crowd's logic took in the last frame (ms): the plan, the walking, the clips.</summary>
    public double LogicMs { get; private set; }

    public int Day => day;
    public double Hour => hour;

    /// <summary>Set the game clock (day 1 = Monday; hour with its fraction). The game state part calls this once it is in.</summary>
    public void SetClock(int day, double hour)
    {
        this.day = day;
        this.hour = hour;
    }

    /// <summary>The viewer was moved by a jump (a test, a fast travel): the street round him fills at once, as at the start.</summary>
    public void Refill() => filled = false;

    private double Rnd(double a, double b) => a + rng.NextDouble() * (b - a);
    private static double Dist(double ax, double az, double bx, double bz) => Math.Sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
    private static double NowMs => Time.GetTicksMsec();
    private static double Hash01(string s) => Whereabouts.HashId(s) / 4294967296.0;

    /// <summary>Fallbacks if people.glb is older than the town (it should not be).</summary>
    private static readonly Dictionary<string, string> KindFallback = new()
    {
        ["baker"] = "docker_c", ["shopkeeper"] = "recipient", ["publican"] = "foreman", ["clerk"] = "gentleman", ["old_man"] = "docker_b", ["beggar"] = "thief",
        ["wife_a"] = "fishwife_a", ["wife_b"] = "fishwife_b", ["shopwife"] = "maid", ["old_woman"] = "fishwife_b", ["urchin"] = "boy", ["girl_b"] = "girl",
        ["soldier"] = "police", ["soldier_b"] = "police", ["sentry"] = "police", ["customs"] = "police",
    };

    public override void _Ready()
    {
        var main = Main.I;
        // the lanterns' materials in the scene from the first frame (no new shader kind when the first is handed out)
        Carried.Prepare();
        var warmLantern = Carried.Lantern();
        warmLantern.Name = "lantern_warm";
        warmLantern.Visible = false;
        AddChild(warmLantern);
        server = main.Arg("server", "").TrimEnd('/');
        hour = double.TryParse(main.Arg("hour", "13"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var h) ? h : 13;
        day = int.TryParse(main.Arg("day", "1"), out var d) ? d : 1;
        if (!Humans.Ready)
        {
            Status = "no people.glb (node tools/godot/models.mjs)";
            GD.PrintErr("townspeople: " + Status);
            return;
        }
        string[] tries = { main.Arg("walk", ""), Paths.TownSide("_walk.json"), Path.Combine(Paths.Baked, "town_walk.json") };
        foreach (var t in tries)
        {
            if (t == "" || (Walk = WalkMap.Load(t)) == null) continue;
            break;
        }
        if (Walk == null)
        {
            Status = "no walk dump (node tools/godot/export-scene.mjs --walk-only)";
            GD.PrintErr("townspeople: " + Status);
            return;
        }
        Crowd = new Crowd(main.View, Walk);
        lanterns = new LanternPool(main.View);
        var facts = main.World.Facts.RootElement.GetProperty("facts");
        if (facts.TryGetProperty("fog", out var fog) && fog.ValueKind == JsonValueKind.Object && fog.TryGetProperty("far", out var far) && far.ValueKind == JsonValueKind.Number) Crowd.FogDistance = far.GetDouble();
        if (server == "")
        {
            // the server the game started itself (Net/ServerLink.cs)
            if (Scheldemist.Net.ServerLink.I is { } link)
            {
                Status = "waiting for the server";
                link.WhenUp(() =>
                {
                    server = link.Api!.Url.TrimEnd('/');
                    http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(30) };
                    Status = "loading";
                    _ = LoadTown();
                });
                return;
            }
            Status = "no server (--server http://127.0.0.1:PORT): no townspeople";
            GD.Print("townspeople: " + Status);
            return;
        }
        http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        Status = "loading";
        _ = LoadTown();
    }

    /// <summary>
    /// The people frozen into the bake whom the game now draws live (whoever the browser's crowd and its people.ts
    /// drew at that moment: an unnamed group at the scene's root holding the model's root, named after its kind):
    /// hidden. Figures of other parts stay as they are until those parts are ported: the people on the omnibuses and
    /// drays, at the Steen, aboard the ships, at the trades (they hang under their part's own node).
    /// </summary>
    private void HideBaked()
    {
        var scene = Main.I.World.GetChildCount() > 0 ? Main.I.World.GetChild(0) : null;
        foreach (var n in BakedWorld.All(Main.I.World).ToList())
        {
            if (n is not Skeleton3D) continue;
            Node? a = n.GetParent();
            for (int up = 0; up < 3 && a != null; up++, a = a.GetParent())
            {
                string kind = a.Name.ToString().TrimEnd('0', '1', '2', '3', '4', '5', '6', '7', '8', '9');
                // (the dogs and cats too: People/Animals.cs draws them live; the pigs of the drove stay)
                if (!Humans.IsKind(kind) && !kind.StartsWith("dog_") && !kind.StartsWith("cat_")) continue;
                if (a.GetParent() is Node3D group && group.GetParent() == scene)
                {
                    if (group.Visible) BakedHidden++;
                    group.Visible = false;
                }
                break;
            }
        }
    }

    public override void _ExitTree()
    {
        http?.Dispose();
        Scheldemist.Play.Folk.Forget();
        Crowd?.Dispose();
        Indoors?.Dispose();
        Humans.Forget();
        Animal.Forget();
        Whereabouts.Forget();
        Models.ModelLibrary.FreeAll();
    }

    // ------------------------------------------------------------------ the server (never waited for in a frame)

    private async Task LoadTown()
    {
        // the server may still be starting: ask again, waiting longer each time
        for (int wait = 2000; ; wait = Math.Min(wait * 2, 30_000))
        {
            try
            {
                string json = await http!.GetStringAsync(server + "/api/town").ConfigureAwait(false);
                var d = TownData.Parse(json);
                using var life = JsonDocument.Parse(await http.GetStringAsync(server + "/api/lively").ConfigureAwait(false));
                var plan = life.RootElement.Clone();
                inbox.Enqueue(() => ReadDoorLife(plan));
                inbox.Enqueue(() => TownIn(d));
                break;
            }
            catch (Exception e)
            {
                GD.Print($"townspeople: the town did not load ({e.Message}); again in {wait / 1000} s");
                await Task.Delay(wait).ConfigureAwait(false);
            }
        }
        for (int wait = 2000; ; wait = Math.Min(wait * 2, 30_000))
        {
            try
            {
                string json = await http!.GetStringAsync(server + "/api/town/ways").ConfigureAwait(false);
                var got = ParseWays(json);
                inbox.Enqueue(() =>
                {
                    foreach (var (k, w) in got)
                    {
                        ways[k] = w;
                        wayAsk.Remove(k);
                    }
                    waysIn = true;
                    Whereabouts.WaysLearnt();
                });
                break;
            }
            catch (Exception e)
            {
                GD.Print($"townspeople: the town's ways did not load ({e.Message}); again in {wait / 1000} s");
                await Task.Delay(wait).ConfigureAwait(false);
            }
        }
    }

    private static Dictionary<string, Pt[]?> ParseWays(string json)
    {
        var o = new Dictionary<string, Pt[]?>();
        using var doc = JsonDocument.Parse(json);
        foreach (var e in doc.RootElement.GetProperty("ways").EnumerateObject())
            o[e.Name] = e.Value.ValueKind == JsonValueKind.Array ? e.Value.EnumerateArray().Select(p => new Pt(p[0].GetDouble(), p[1].GetDouble())).ToArray() : null;
        return o;
    }

    private void TownIn(TownData d)
    {
        Data = d;
        HideBaked();
        foreach (var r in d.Residents)
        {
            peopleInfo[r.Id] = r;
            // the kind is checked against people.glb when they first step out
            var s = new Sim { R = r, Kind = r.Kind, X = r.HomeSx, Z = r.HomeSz, Inside = true, Door = new Pt(r.HomeSx, r.HomeSz), Goal = new Goal { Mode = "home", X = r.HomeSx, Z = r.HomeSz }, H = Hash01(r.Id) };
            sims.Add(s);
            byId[r.Id] = s;
        }
        // the board's employers stand at their post like Sooi (People/PostedPeople.cs), not in the crowd
        foreach (var (id, _) in d.Employers)
        {
            if (!byId.TryGetValue(id, out var s)) continue;
            employers.Add(s.R);
            byId.Remove(id);
            sims.Remove(s);
        }
        // where the keepers stand (game/stalls.ts): behind the stall; by the shop's table (the bake's spots), else on the step
        foreach (var st in d.Stalls)
            if (st.Keeper != null) sellerSpots[st.Keeper] = (st.X - st.Face.X * 1.15, st.Z - st.Face.Z * 1.15, Math.Atan2(st.Face.X, st.Face.Z));
        foreach (var sh in d.Shops)
        {
            if (sh.Goods == null) continue;
            if (Walk!.Sellers.TryGetValue(sh.Keeper, out var v)) sellerSpots[sh.Keeper] = (v[0], v[1], v[2]);
            else sellerSpots[sh.Keeper] = (sh.Wall.X + sh.Out.X * 0.9, sh.Wall.Z + sh.Out.Z * 0.9, Math.Atan2(sh.Out.X, sh.Out.Z));
        }
        Indoors = new Indoors(this);
        TavernInside = Indoors.Open;
        // the other parts' hooks: where someone stands (the bubbles over a talk in the street, the map's marks of people with work)
        if (Scheldemist.Talks.Bubbles.I is { } bubbles)
        {
            bubbles.PositionOf ??= id => HomeVisitors.I?.PositionOf(id) ?? HallPeople.I?.PositionOf(id) ?? Indoors.PositionOf(id) ?? (PositionOf(id) is { } q ? new Vector3((float)q.x, (float)Walk!.BaseAt(q.x, q.z), (float)q.z) : null);
            bubbles.InfoOf ??= id => peopleInfo.TryGetValue(id, out var r) ? (r.Sex, r.Age) : null;
        }
        if (Scheldemist.Game.TownMap.I is { } map) map.PersonAt ??= id => PositionOf(id) is { } q ? new Vector2((float)q.x, (float)q.z) : null;
        Status = "in";
        GD.Print($"townspeople: {d.Residents.Count} residents, {employers.Count} of them employers at their posts, {d.Places.Count} places");
    }

    /// <summary>Where someone is now, by id: a townsperson in the street or indoors (his door), or one of the people at their posts. Null: not known.</summary>
    public (double x, double z)? PositionOf(string id)
    {
        if (HomeVisitors.I?.PositionOf(id) is { } visitor) return (visitor.X, visitor.Z);
        if (HallPeople.I?.PositionOf(id) is { } hall) return (hall.X, hall.Z);
        if (Indoors?.PositionOf(id) is { } room) return (room.X, room.Z);
        if (byId.TryGetValue(id, out var s)) return s.P != null ? (s.P.X, s.P.Z) : (s.X, s.Z);
        return PostedPeople.I?.Get(id) is { } n ? (n.X, n.Z) : null;
    }

    /// <summary>The way on foot for the sum (not known until the server sent it; null and known: there is none, he is simply there).</summary>
    private Pt[]? WayOf(double ax, double az, double bx, double bz, out bool known)
    {
        string k = WayName(ax, az, bx, bz);
        known = ways.TryGetValue(k, out var w);
        if (!known) { planWaysPending.Add(k); if (!wayAsked.Contains(k)) wayAsk.Add(k); }
        return w;
    }

    private void AskWays(double dt)
    {
        wayAskT -= dt;
        if (wayAskT > 0 || wayAsk.Count == 0 || !waysIn) return;
        // (every 3 s; every second while many wait)
        wayAskT = wayAsk.Count > 60 ? 1 : 3;
        wayAsk.RemoveWhere(k => ways.ContainsKey(k));
        var keys = wayAsk.Take(60).ToList();
        foreach (var k in keys)
        {
            wayAsk.Remove(k);
            wayAsked.Add(k);
        }
        if (keys.Count == 0) return;
        RequestWays(keys);
    }

    // Keep the request closure out of the per-frame AskWays call.
    private void RequestWays(List<string> keys)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                var body = new StringContent(JsonSerializer.Serialize(new { keys }), Encoding.UTF8, "application/json");
                var res = await http!.PostAsync(server + "/api/town/ways", body).ConfigureAwait(false);
                var got = ParseWays(await res.Content.ReadAsStringAsync().ConfigureAwait(false));
                inbox.Enqueue(() =>
                {
                    bool planChanged = false;
                    foreach (var k in keys)
                    {
                        wayAsked.Remove(k);
                        ways[k] = got.GetValueOrDefault(k);
                        planChanged |= planWaysPending.Remove(k);
                    }
                    if (planChanged) Whereabouts.WaysLearnt();
                });
            }
            catch (Exception)
            {
                inbox.Enqueue(() =>
                {
                    foreach (var k in keys)
                    {
                        wayAsked.Remove(k);
                        wayAsk.Add(k);
                    }
                });
            }
        });
    }

    /// <summary>For a check: a resident's day as he keeps it, one stop after the other.</summary>
    public string DescribeDay(Resident r, int day) => Whereabouts.DescribeDay(r, Data!, day, wayOf);

    /// <summary>Ways still asked for or on their way here (a check waits for none); -1: the town's ways are not in yet.</summary>
    public int PlanWaysWaiting => planWaysPending.Count;
    public int WaysWaiting => waysIn ? wayAsk.Count + wayAsked.Count : -1;

    /// <summary>The shared sum now, late by progress reports; borrowed until the next query for this resident. Null for a goal outside the plan.</summary>
    public Whereabouts.Where? WhereNow(Sim s)
    {
        if (Data == null) return null;
        if (!s.Plain)
        {
            // the mill's man on the way with his cart, and at the stops of the run (the cart's timetable, as the town map has it)
            if (!s.MillRun) return null;
            var w = Whereabouts.WhereAt(s.R, Data, day, hour, wayOf, s.R.WhereValue);
            return w.Cart != null ? w : null;
        }
        return Whereabouts.WhereLate(s.R, Data, day, hour, wayOf, s.Lag, s.R.WhereValue);
    }

    /// <summary>The plain sum for anyone (a check against the server's own).</summary>
    public Whereabouts.Where? WhereOf(Resident r, int day, double hour) => Data == null ? null : Whereabouts.WhereAt(r, Data, day, hour, wayOf);

    private double GameMin => (day - 1) * 1440 + hour * 60;

    /// <summary>Twice a second: the people walked here on their way keep how far behind the sum they are; a lag no longer needed goes.</summary>
    private void Progress(double dt)
    {
        lagT -= dt;
        if (lagT > 0) return;
        lagT = 0.5;
        double now = GameMin;
        // the clock jumped (sleep, a skip, a test): nobody is late across a jump
        bool jumped = lagAt >= 0 && Math.Abs(now - lagAt) > 30;
        double ranH = jumped || lagAt < 0 ? 0 : Math.Max(0, now - lagAt) / 60 + 0.02;
        lagAt = now;
        foreach (var s in sims)
        {
            if (jumped) s.Lag = 0;
            if (s.P != null && s.Plain) s.Lag = Math.Min(Whereabouts.ReportLag(s.R, Data!, day, hour, wayOf, s.Lag, s.P.X, s.P.Z), s.Lag + ranH);
            else if (s.Lag > 0) s.Lag = Whereabouts.SettleLag(s.R, Data!, day, hour, wayOf, s.Lag);
        }
    }

    // ------------------------------------------------------------------ per frame

    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Town.Townspeople");
        while (inbox.TryDequeue(out var a)) a();
        if (Data == null || Crowd == null) return;
        if (ClockRuns)
        {
            hour += delta / 120;
            if (hour >= 24)
            {
                hour -= 24;
                day = day % 7 + 1;
            }
        }
        var cam = Main.I.Cam;
        var cp = cam.GlobalPosition;
        (double x, double z)? body = null;
        // Jef's body: walkers stop short of him and go round, the standing step aside when he walks into them
        // (the browser's rule, crowd.ts: nobody is solid for him but the people at their posts, PostedPeople.cs)
        if (PlayerBody != null) body = PlayerBody();
        else if (Scheldemist.Player.Jef.I is { Fly: false, Swimming: false } jef) body = (jef.X, jef.Z);
        if (Paused) return;
        // how far the fog lets one see now (the sky's part)
        if (Scheldemist.World.Daylight.I is { } sky) Crowd.FogDistance = sky.FogFar;
        ulong t0 = Time.GetTicksUsec();
        long allocatedAt = GC.GetAllocatedBytesForCurrentThread();
        Step(delta, cp.X, cp.Z, body);
        long mark = GC.GetAllocatedBytesForCurrentThread(); AllocationParts[0] = mark - allocatedAt;
        Crowd.Update(delta, cp.X, cp.Z, body, cam);
        long next = GC.GetAllocatedBytesForCurrentThread(); AllocationParts[1] = next - mark; mark = next;
        lanterns?.Update(delta, cp, hour);
        next = GC.GetAllocatedBytesForCurrentThread(); AllocationParts[2] = next - mark; mark = next;
        Indoors?.Update(delta, cp);
        next = GC.GetAllocatedBytesForCurrentThread(); AllocationParts[3] = next - mark; mark = next;
        Carried.LanternLook(hour, Time.GetTicksMsec() / 1000.0);
        next = GC.GetAllocatedBytesForCurrentThread(); AllocationParts[4] = next - mark;
        AllocatedBytesLastFrame = GC.GetAllocatedBytesForCurrentThread() - allocatedAt;
        LogicMs = (Time.GetTicksUsec() - t0) / 1000.0;
    }

    private void Step(double dt, double vx, double vz, (double x, double z)? body)
    {
        px = vx;
        pz = vz;
        AskWays(dt);
        Progress(dt);
        thinkT -= dt;
        if (thinkT <= 0)
        {
            thinkT = 0.25;
            foreach (var s in sims) Reschedule(s, !filled);
        }
        foreach (var g in games.Values) g.Frozen -= dt;
        coarseTurn = (coarseTurn + 1) % CoarseEvery;
        int n = 0;
        // (a list of its own: a person who goes in at a door leaves the crowd inside the loop)
        for (int i = 0; i < sims.Count; i++)
        {
            var s = sims[i];
            n++;
            if (s.P != null && !Crowd!.Alive(s.P)) Lose(s);
            if (s.P != null)
            {
                s.X = s.P.X;
                s.Z = s.P.Z;
                Behave(s, dt, body);
                if (s.P != null && Dist(s.X, s.Z, vx, vz) > DespawnR) Lose(s, true);
            }
            else if (!s.Inside)
            {
                if (s.ActionHeld) continue;
                // the unseen take turns, each one every CoarseEvery frames with the time since; where the shared sum
                // puts him comes from the clock, so he is where he would have been
                s.CoarseDt += dt;
                if (n % CoarseEvery == coarseTurn)
                {
                    Coarse(s, s.CoarseDt);
                    s.CoarseDt = 0;
                }
                continue;
            }
            s.CoarseDt = 0;
        }
        spawnT -= dt;
        if (spawnT <= 0)
        {
            spawnT = 0.3;
            Spawn(!filled);
            filled = true;
        }
    }

    // ------------------------------------------------------------------ the schedule

    private void Reschedule(Sim s, bool first)
    {
        if (s.ActionHeld) return;
        var now = PlanNow(s);
        // the great storm: no calls at the shops, everyone out of it
        bool storm = stormLevel > 0;
        if (now.Place == "park" && (stormLevel > 0.3 || Raining())) now = now with { Act = "home", Place = "home" };
        (s.Shelter, s.ShelterPlace) = storm ? ShelterFor(s.R, now) : (null, "");
        bool sheltered = s.Shelter != null && s.Shelter != "stay";
        // a call at a shop this hour (the engine's roll): in at its door, out at the hour's end
        var call = storm ? null : shopCalls.CallOf(Data!, s.R, day, hour);
        // the mill's man with the cart (flour to the bakery at dawn, grain from the dock after dinner)
        var run = storm || s.R.Trade != "miller_man" ? null : Whereabouts.WhereAt(s.R, Data!, day, hour, wayOf, s.R.WhereValue).Cart;
        string life = storm ? "" : LifeKey(s, now);
        string tavPlace = s.Shelter == "tavern" ? s.ShelterPlace : now.Act == "tavern" ? now.Place : now.Act == "work" && s.R.Work.Kind == "tavern" ? s.R.Work.Place : now.Act == "work" && s.R.Work.Kind == "shop" && s.R.Work.Shop != null ? ShopPlace(s.R.Work.Shop) : "";
        string tav = tavPlace != "" ? (TavernInside(tavPlace) ? "in" : "out") : "";
        string runKind = run?.kind ?? "";
        if (!first && s.Key.Length > 0 && s.ScheduleAct == now.Act && s.SchedulePlace == now.Place && s.ScheduleCall == call
            && s.ScheduleLife == life && s.ScheduleStormOn == storm && s.ScheduleStorm == stormEvent
            && s.ScheduleShelter == (s.Shelter ?? "") && s.ScheduleRun == runKind && s.Tav == tav)
        { Lanterns(s); return; }
        s.ScheduleAct = now.Act; s.SchedulePlace = now.Place; s.ScheduleCall = call; s.ScheduleLife = life;
        s.ScheduleStormOn = storm; s.ScheduleStorm = stormEvent; s.ScheduleShelter = s.Shelter ?? ""; s.ScheduleRun = runKind;
        string key = sheltered
            ? $"storm{stormEvent}:{s.Shelter}{(s.Shelter == "tavern" ? $":{s.ShelterPlace}" : "")}"
            : FormattableString.Invariant($"{now.Act}:{now.Place}{(call != null ? $"|shop@{call.Value.X},{call.Value.Z}" : "")}{(storm ? $"|storm{stormEvent}" : life)}{(run != null ? $"|mill:{run.Value.kind}" : "")}");
        // a publican (or a drinker) whose tavern opens or shuts gets his goal again, the key unchanged
        if (key == s.Key && tav == s.Tav)
        {
            Lanterns(s);
            return;
        }
        s.Tav = tav;
        s.Key = key;
        s.Goal = call != null ? new Goal { Mode = "inside", X = call.Value.X, Z = call.Value.Z } : GoalFor(s, now);
        if (call != null) s.Plain = false;
        s.MillRun = run != null && !sheltered;
        if (s.MillRun)
        {
            s.Goal = new Goal { Mode = "millrun", X = s.X, Z = s.Z };
            s.Plain = false;
        }
        if (s.P != null && !s.MillRun) s.P.Pushes = false;
        s.Step = 0;
        s.Tries = 0;
        s.Wait = 0;
        bool goesIn = s.Goal.Mode is "home" or "inside" or "church";
        var on = first ? WhereNow(s) : null;
        if (on != null && on.Walked < on.Total)
        {
            // the start, and he is on his way (where the town map has him too)
            s.Inside = false;
            s.X = on.X;
            s.Z = on.Z;
        }
        else if (first)
        {
            // the start: everyone is where the clock says, no walking
            if (goesIn)
            {
                s.Inside = true;
                s.Door = new Pt(s.Goal.X, s.Goal.Z);
            }
            else
            {
                var a = Anchor(s);
                s.Inside = false;
                s.X = a.X;
                s.Z = a.Z;
            }
        }
        else if (s.Inside && !(goesIn && s.Door.X == s.Goal.X && s.Door.Z == s.Goal.Z))
        {
            // out of the door they went in at
            s.Inside = false;
            s.X = s.Door.X;
            s.Z = s.Door.Z;
            s.OutAt = NowMs;
        }
        if (s.P != null) Direct(s);
        Lanterns(s);
    }

    private static bool IsNight(double h) => h >= 19 || h < 6.5;
    /// <summary>The garrison and the customs: no lanterns (a rifle, a book).</summary>
    private static readonly HashSet<string> Garrison = new() { "soldier", "sentry", "corporal", "customs" };

    /// <summary>After dark the police and the lamplighters carry a lantern, half of those going home, and some of the others (town.ts lanterns).</summary>
    private void Lanterns(Sim s)
    {
        if (s.P == null) return;
        bool carrier = s.R.Trade is "police" or "lamplighter";
        bool on = IsNight(hour) && s.R.Age >= 14 && s.R.Trade != "thief" && !Garrison.Contains(s.R.Trade)
            && (carrier || s.Goal.Mode == "home" ? s.H < 0.5 || carrier : s.H < 0.3);
        if (on == s.Lamp) return;
        s.Lamp = on;
        Crowd!.PuppetLantern(s.P, on);
    }

    private TownPlace? Place(string? id) => id != null && Data!.Places.TryGetValue(id, out var p) ? p : null;

    /// <summary>A point in a place, the same for the same person (no jumping about).</summary>
    private static Pt Spot(TownPlace pl, Sim s, double spread = 0.65)
    {
        double a = s.H * Math.PI * 2 * 7;
        double d = Math.Sqrt(Hash01(s.R.Id + "d")) * pl.R * spread;
        return new Pt(pl.X + Math.Cos(a) * d, pl.Z + Math.Sin(a) * d);
    }

    private Goal GoalFor(Sim s, Now now)
    {
        // (only a goal of the plan's own is walked by the shared sum unseen; the mills', the back streets' and lively's goals come with their parts)
        s.Plain = false;
        // the great storm: out of it, running (and nobody stands about at a door, in the park or at the mill)
        if (StormGoal(s) is { } stormGoal) return stormGoal;
        if (LifeGoal(s, now) is { } lifeGoal) return lifeGoal;
        // (the mill's people: the man goes with the mill's own cart, off the plan's sum)
        s.Plain = s.R.Trade is not ("miller" or "miller_man");
        var r = s.R;
        var w = r.Work;
        Goal Home() => new() { Mode = "home", X = r.HomeSx, Z = r.HomeSz };
        switch (now.Act)
        {
            case "home":
                return Home();
            case "church":
            {
                var c = Place("church");
                return new Goal { Mode = "church", X = c?.X ?? -262, Z = c?.Z ?? 142 };
            }
            case "tavern":
            {
                var t = Place(now.Place);
                if (t == null) return Home();
                // in at the open door: inside they drink at the tables, seen through the windows
                if (TavernInside(now.Place)) return new Goal { Mode = "inside", X = t.X, Z = t.Z };
                double ox = t.Out?.X ?? 0, oz = t.Out?.Z ?? -1;
                // a half ring before the door, facing it
                double a = (s.H - 0.5) * 2.4;
                double x = t.X + ox * 2.2 + (Math.Cos(a) * ox - Math.Sin(a) * oz) * 0.8 - oz * (s.H - 0.5) * 3;
                double z = t.Z + oz * 2.2 + (Math.Sin(a) * ox + Math.Cos(a) * oz) * 0.8 + ox * (s.H - 0.5) * 3;
                return new Goal { Mode = "tavern", X = x, Z = z, Yaw = Math.Atan2(t.X - x, t.Z - z), Motion = "idle" };
            }
            case "play":
            case "market":
            case "stroll":
            case "loiter":
            {
                // soldiers walking out: their round of the town, the pair side by side (Pair)
                if (now.Act == "stroll" && r.Trade == "soldier" && w.Route is { Length: > 0 }) return new Goal { Mode = "roam", X = w.Route[0].X, Z = w.Route[0].Z, Route = w.Route, Place = now.Place };
                var pl = Place(now.Place) ?? Place(w.Place) ?? Place("rijnkaai")!;
                var q = Spot(pl, s);
                if (Data!.Anchors.TryGetValue(r.Id, out var points) && points.TryGetValue((now.Act, now.Place), out var fixedPoint)) q = fixedPoint;
                return new Goal { Mode = now.Act, X = q.X, Z = q.Z, R = pl.R, Place = now.Place };
            }
        }
        switch (w.Kind)
        {
            case "stall":
            case "shop":
            {
                // the keeper and his wife serve inside while the shop's room stands open in the world
                var sp = w.Kind == "shop" && w.Shop != null ? Place(w.Shop) : null;
                if (sp != null && TavernInside($"shop:{w.Shop}")) return new Goal { Mode = "inside", X = sp.Door?.X ?? sp.X, Z = sp.Door?.Z ?? sp.Z };
                if (sellerSpots.TryGetValue(r.Id, out var at)) return new Goal { Mode = "stand", X = at.x, Z = at.z, Yaw = at.yaw, Motion = "idle" };
                break;
            }
            case "haul":
                if (w.A != null && w.B != null) return new Goal { Mode = "haul", X = w.A.Value.X, Z = w.A.Value.Z, A = w.A, B = w.B };
                break;
            case "patrol":
                if (w.Route is { Length: > 0 }) return new Goal { Mode = "patrol", X = w.Route[0].X, Z = w.Route[0].Z, Route = w.Route };
                break;
            case "roam":
                if (r.Trade == "thief" && w.Route is { Length: > 0 }) return new Goal { Mode = "thief", X = w.Route[0].X, Z = w.Route[0].Z, Route = w.Route };
                if (r.Trade is "child" or "street_child")
                {
                    var pl = Place(w.Place) ?? Place("play:vismarkt")!;
                    var q = Spot(pl, s);
                    return new Goal { Mode = "play", X = q.X, Z = q.Z, R = pl.R, Place = w.Place };
                }
                if (w.Route is { Length: > 0 }) return new Goal { Mode = "roam", X = w.Route[0].X, Z = w.Route[0].Z, Route = w.Route };
                break;
            case "inside":
                return w.Door != null ? new Goal { Mode = "inside", X = w.Door.Value.X, Z = w.Door.Value.Z } : Home();
            case "tavern":
            {
                // the publican stands behind his counter while the tavern is open
                var t = Place(w.Place);
                if (t != null && TavernInside(w.Place)) return new Goal { Mode = "inside", X = t.X, Z = t.Z };
                break;
            }
            case "guard":
                // a sentry at his post, rifle at the shoulder; the corporal in front, watching his men
                if (w.At != null) return new Goal { Mode = "guard", X = w.At[0], Z = w.At[1], Yaw = w.At[2], Motion = r.Trade == "corporal" ? "fold" : "idle" };
                break;
            case "inspect":
                if (w.Route is { Length: > 0 }) return new Goal { Mode = "inspect", X = w.Route[0].X, Z = w.Route[0].Z, Route = w.Route, Faces = w.Faces };
                break;
            case "wait":
                // emigrants: on the family's chest (men), or standing beside it
                if (w.At != null) return new Goal { Mode = "stand", X = w.At[0], Z = w.At[1], Yaw = w.At[2], Motion = w.Seat ? "sit" : "idle" };
                break;
        }
        if (w.At != null) return new Goal { Mode = "stand", X = w.At[0], Z = w.At[1], Yaw = w.At[2], Motion = w.Motion ?? (w.Kind == "post" ? "fold" : "idle") };
        {
            var pl = Place(w.Place) ?? Place("rijnkaai")!;
            var q = Spot(pl, s);
            return new Goal { Mode = "loiter", X = q.X, Z = q.Z, R = pl.R, Place = w.Place };
        }
    }

    // ------------------------------------------------------------------ the great storm

    private static readonly HashSet<string> StayWork = new() { "tavern", "inside", "guard" };
    private const double TavernRunM = 260;

    /// <summary>
    /// Where a resident goes when the storm breaks (shared/tempest.ts shelterFor): fixed per person and per storm.
    /// Those under a roof stay; children run home; of the rest four in ten run home, three into the nearest tavern,
    /// the others press into a doorway.
    /// </summary>
    private (string kind, string place) ShelterFor(Resident r, Now now)
    {
        taverns ??= Data!.Places.Keys.Where(id => id.StartsWith("tavern:")).ToList();
        if (r.Work.Kind == "tavern" && r.Work.Place.StartsWith("tavern:") && r.Age >= 14) return now.Act == "work" ? ("stay", "") : ("tavern", r.Work.Place);
        if (now.Act == "tavern" && now.Place.StartsWith("tavern:")) return ("tavern", now.Place);
        if (now.Act is "home" or "church" or "tavern") return ("stay", "");
        if (now.Act == "work" && StayWork.Contains(r.Work.Kind)) return ("stay", "");
        if (r.Age < 14 || r.Trade is "child" or "street_child") return ("home", "");
        double h = Hash01($"{r.Id}:tempest:{stormEvent}");
        if (h < 0.42) return ("home", "");
        if (h < 0.74)
        {
            Data!.Places.TryGetValue(now.Act == "work" ? r.Work.Place : now.Place, out var from);
            double fx = from?.X ?? r.HomeSx, fz = from?.Z ?? r.HomeSz;
            string best = "";
            double bd = TavernRunM;
            foreach (var id in taverns)
            {
                var p = Data.Places[id];
                double d = Dist(p.X, p.Z, fx, fz);
                if (d < bd)
                {
                    bd = d;
                    best = id;
                }
            }
            return best != "" ? ("tavern", best) : ("home", "");
        }
        return ("under", "");
    }

    /// <summary>The storm's goal: home, into the nearest tavern (or the cathedral, near it), or pressed into the nearest doorway. Null: under a roof already, or no storm.</summary>
    private Goal? StormGoal(Sim s)
    {
        if (s.Shelter == null || s.Shelter == "stay") return null;
        var r = s.R;
        var home = new Goal { Mode = "home", X = r.HomeSx, Z = r.HomeSz };
        if (s.Shelter == "home") return home;
        if (s.Shelter == "tavern")
        {
            var t = Place(s.ShelterPlace);
            if (t == null) return home;
            if (TavernInside(s.ShelterPlace)) return new Goal { Mode = "inside", X = t.X, Z = t.Z };
            return UnderDoor(s, t.Door ?? new Pt(t.X, t.Z), t.Out ?? new Pt(0, -1));
        }
        // under: the cathedral when it is near, else the nearest door
        var c = Place("church");
        if (c != null && Dist(s.X, s.Z, c.X, c.Z) < StormChurchM) return new Goal { Mode = "church", X = c.X, Z = c.Z };
        if (doorList == null)
        {
            // every front door in town with its step (the residents' homes, one per house)
            doorList = new List<(double, double, double, double)>();
            var seen = new HashSet<(double, double)>();
            foreach (var q in sims)
                if (seen.Add((q.R.HomeX, q.R.HomeZ))) doorList.Add((q.R.HomeX, q.R.HomeZ, q.R.HomeSx, q.R.HomeSz));
        }
        (double x, double z, double sx, double sz)? best = null;
        double bd = StormDoorM;
        foreach (var d in doorList)
        {
            double dd = Dist(s.X, s.Z, d.sx, d.sz);
            if (dd < bd)
            {
                bd = dd;
                best = d;
            }
        }
        if (best == null) return home;
        var b = best.Value;
        double L = Dist(b.sx, b.sz, b.x, b.z);
        if (L == 0) L = 1;
        return UnderDoor(s, new Pt(b.x, b.z), new Pt((b.sx - b.x) / L, (b.sz - b.z) / L));
    }

    private static readonly string[] StormPoses = { "fold", "wall", "pockets", "fold", "behind" };

    /// <summary>Close in under a door's lintel, a little to one side, facing out into the rain.</summary>
    private static Goal UnderDoor(Sim s, Pt door, Pt o)
    {
        // (along the front either side of the door, and a second rank a little out when the first is full)
        double side = (Hash01(s.R.Id + "door") - 0.5) * 2.4;
        double off = 0.55 + (Hash01(s.R.Id + "rank") < 0.3 ? 0.55 : 0);
        return new Goal { Mode = "stand", X = door.X + o.X * off - o.Z * side, Z = door.Z + o.Z * off + o.X * side, Yaw = Math.Atan2(o.X, o.Z), Motion = StormPoses[(int)Math.Floor(Hash01(s.R.Id + "storm") * StormPoses.Length)] };
    }

    /// <summary>Where their goal is (a trip's end): the stand, the door, the first point of a round.</summary>
    public Pt Anchor(Sim s)
    {
        var g = s.Goal;
        if (g.Mode == "haul" && g.A != null) return g.A.Value;
        if (g.Route is { Length: > 0 }) return g.Route[s.Step % g.Route.Length];
        return new Pt(g.X, g.Z);
    }

    /// <summary>Nobody sees them: a walk to where they should be, along the way on foot (the last steps straight).</summary>
    private void Coarse(Sim s, double dt)
    {
        // on the way between two places of his plan, or on his round, the shared sum has him (as the town map does)
        var on = WhereNow(s);
        if (on != null && (on.Walked < on.Total || on.Leg != null || on.Cart != null))
        {
            s.X = on.X;
            s.Z = on.Z;
            if (on.Leg != null)
            {
                s.Step = on.Leg.Value;
                s.ToB = on.Leg == 1;
            }
            else s.ToB = false; // (on his way to work he comes empty-handed to where he takes the loads up)
            return;
        }
        // (the pairs on a round keep together unseen too)
        var lead = s.Goal.Mode is "roam" or "patrol" ? LeadOf(s) : null;
        if (lead != null) s.Step = lead.Step;
        var t = lead != null ? new Pt(lead.X + 0.6, lead.Z) : Anchor(s);
        double d = Dist(s.X, s.Z, t.X, t.Z);
        if (d < 0.5)
        {
            s.Hw = null;
            if (s.Goal.Mode is "home" or "inside" or "church")
            {
                s.Inside = true;
                s.Door = t;
            }
            else if (s.Goal.Route is { Length: > 0 } && s.Goal.Mode != "thief") s.Step++;
            return;
        }
        // along the streets, never through a house (a partner keeping up with his lead: straight on)
        if (lead != null)
        {
            double k = Math.Min(1, HiddenSpeed * dt / d);
            s.X += (t.X - s.X) * k;
            s.Z += (t.Z - s.Z) * k;
        }
        else HiddenStep(s, t.X, t.Z, HiddenSpeed, dt);
    }

    /// <summary>One step of an unseen walk to (tx, tz) along the way on foot the server found, at `speed`; the last metres straight.</summary>
    private void HiddenStep(Sim s, double tx, double tz, double speed, double dt)
    {
        var hw = s.Hw;
        if (hw == null || Math.Abs(hw.Tx - tx) > 1 || Math.Abs(hw.Tz - tz) > 1)
        {
            hw = s.Hw = s.HiddenBuffer;
            hw.Tx = tx; hw.Tz = tz; hw.Key = WayName(s.X, s.Z, tx, tz); hw.Asked = NowMs;
            hw.Pts = null; hw.I = 1; hw.Straight = false;
        }
        if (hw.Pts == null && !hw.Straight)
        {
            // (one way asked for per walk, by where it began: he waits for it where he stands)
            bool known = ways.TryGetValue(hw.Key, out var w);
            if (w != null)
            {
                hw.Pts = w;
                // (from the point of the way nearest him on)
                int best = 0;
                for (int i = 0; i < w.Length; i++)
                    if (Dist(w[i].X, w[i].Z, s.X, s.Z) < Dist(w[best].X, w[best].Z, s.X, s.Z)) best = i;
                hw.I = Math.Min(w.Length - 1, best + 1);
            }
            else if (!known && NowMs - hw.Asked < WayWaitS * 1000)
            {
                wayAsk.Add(hw.Key);
                return;
            }
            else hw.Straight = true;
        }
        double left = speed * dt;
        var pts = hw.Pts;
        while (left > 0)
        {
            bool onWay = pts != null && hw.I < pts.Length;
            double qx = onWay ? pts![hw.I].X : tx, qz = onWay ? pts![hw.I].Z : tz;
            double d = Dist(s.X, s.Z, qx, qz);
            if (d <= left)
            {
                s.X = qx;
                s.Z = qz;
                left -= d;
                if (pts == null || hw.I >= pts.Length) return;
                hw.I++;
            }
            else
            {
                s.X += (qx - s.X) / d * left;
                s.Z += (qz - s.Z) / d * left;
                return;
            }
        }
    }

    // ------------------------------------------------------------------ into the street and out

    private readonly List<Sim> spawnWanted = new(1024), spawnGone = new(64), playKids = new(64);
    private readonly SpawnOrder spawnOrder = new();
    private sealed class SpawnOrder : IComparer<Sim>
    {
        public double X, Z; public bool FarFirst;
        public int Compare(Sim? a, Sim? b)
        {
            int order = Dist(a!.X, a.Z, X, Z).CompareTo(Dist(b!.X, b.Z, X, Z));
            return FarFirst ? -order : order;
        }
    }
    private void Spawn(bool anywhere)
    {
        var crowd = Crowd!;
        int alive = 0;
        foreach (var person in sims) if (person.P != null) alive++;
        spawnOrder.X = px; spawnOrder.Z = pz;
        if (alive > MaxPuppets)
        {
            // the setting went down: the farthest go back to their schedule, out of sight
            spawnGone.Clear();
            foreach (var person in sims) if (person.P != null && crowd.IsHidden(person.X, person.Z)) spawnGone.Add(person);
            spawnOrder.FarFirst = true; spawnGone.Sort(spawnOrder);
            for (int i = 0; i < Math.Min(spawnGone.Count, Math.Min(4, alive - MaxPuppets)); i++) Lose(spawnGone[i], true);
            return;
        }
        var want = spawnWanted; want.Clear();
        foreach (var person in sims) if (person.P == null && !person.Inside && Dist(person.X, person.Z, px, pz) < SpawnR) want.Add(person);
        spawnOrder.FarFirst = false; want.Sort(spawnOrder);
        if (alive >= MaxPuppets)
        {
            // Full: the nearest who is due in the street takes the place of the farthest drawn one out of sight.
            // A couple a turn, and only for someone clearly nearer.
            if (want.Count == 0) return;
            double near = Dist(want[0].X, want[0].Z, px, pz);
            var gone = spawnGone; gone.Clear();
            foreach (var person in sims) if (person.P != null && Dist(person.X, person.Z, px, pz) > near + SwapGap && (crowd.IsHidden(person.X, person.Z) || Dist(person.X, person.Z, px, pz) > DueFar)) gone.Add(person);
            spawnOrder.FarFirst = true; gone.Sort(spawnOrder);
            if (gone.Count > 2) gone.RemoveRange(2, gone.Count - 2);
            foreach (var s in gone) Lose(s, true);
            alive -= gone.Count;
            if (alive >= MaxPuppets) return;
        }
        foreach (var s in want)
        {
            if (alive >= MaxPuppets) break;
            double d = Dist(s.X, s.Z, px, pz);
            bool fresh = NowMs - s.OutAt < 4000;
            // people appear out of sight, or step out of their own door
            if (!anywhere && !fresh && !crowd.IsHidden(s.X, s.Z))
            {
                // nobody stays unseen for ever because the viewer looks at his spot. Far off he steps in at once
                // (small, in the haze); nearer after a moment of looking.
                double t = NowMs;
                if (s.DueAt == null || t - s.DueLast > 1000) s.DueAt = t;
                s.DueLast = t;
                if (d < DueFar && t - s.DueAt < (d < DueNear ? DueNearWaitMs : DueWaitMs)) continue;
            }
            s.DueAt = null;
            if (!anywhere && d < 3) continue;
            // two soldiers walking out: the second appears at his comrade's side
            var lead = s.Goal.Mode is "roam" or "patrol" ? LeadOf(s) : null;
            (double x, double z)? side = lead?.P != null ? (lead.P.X - Math.Cos(lead.P.Yaw) * 0.62, lead.P.Z + Math.Sin(lead.P.Yaw) * 0.62) : null;
            (double x, double z)? at = side != null && crowd.CanStand(side.Value.x, side.Value.z) ? side : crowd.CanStand(s.X, s.Z) ? (s.X, s.Z) : crowd.OpenNear(s.X, s.Z);
            // never inside someone already there: the nearest open point nobody stands on
            if (at != null && crowd.SomeoneAt(at.Value.x, at.Value.z)) at = crowd.OpenNearFree(at.Value.x, at.Value.z);
            if (at == null) continue;
            if (!Humans.IsKind(s.Kind)) s.Kind = KindFallback.GetValueOrDefault(s.Kind, "docker_a");
            var a = Anchor(s);
            var p = crowd.AddPuppet(s.Kind, at.Value.x, at.Value.z, Math.Atan2(a.X - at.Value.x, a.Z - at.Value.z), PaceOf(s));
            if (p == null) return;
            s.P = p;
            s.X = at.Value.x;
            s.Z = at.Value.z;
            s.Tries = 0;
            s.Wait = 0;
            alive++;
            if (!s.ActionHeld) Direct(s);
            Lanterns(s);
        }
    }

    /// <summary>Back to the schedule only (out of range, or in at the door).</summary>
    private void Lose(Sim s, bool remove = false)
    {
        if (s.P != null && remove) Crowd!.RemovePuppet(s.P);
        s.P = null;
        // (the lantern went with the puppet: drawn again, he takes it up again)
        s.Lamp = false;
    }

    /// <summary>His pace in the street: his own (the same the sum walks him by unseen). On a leg the sum has him running he hurries, as fast as the walk can look.</summary>
    private double PaceOf(Sim s)
    {
        // the great storm: anyone out in it runs for his door, also one whose day had him on his way home anyway
        if (s.Shelter != null && (s.Shelter != "stay" || s.Goal.Mode is "home" or "inside" or "church")) return Math.Max(Whereabouts.PaceOf(s.R).mps, StormRun);
        var on = WhereNow(s);
        if (on is { Run: true } && on.Walked < on.Total) return Math.Min(on.Mps, SeenRunMax);
        return Whereabouts.PaceOf(s.R).mps;
    }

    /// <summary>The part of his day he is at or walking to now: the day as he keeps it, late by his progress reports.</summary>
    private Now PlanNow(Sim s)
    {
        var w = Whereabouts.WhereLate(s.R, Data!, day, hour, wayOf, s.Lag, s.R.WhereValue);
        return new Now(w.Act, w.Place, w.Since, w.Left);
    }

    /// <summary>Tell a puppet where to go for its goal.</summary>
    private void Direct(Sim s)
    {
        var p = s.P!;
        var g = s.Goal;
        var crowd = Crowd!;
        double pace = PaceOf(s);
        if (g.Mode != "haul" && p.HandCarry) crowd.PuppetLoad(p, false);
        switch (g.Mode)
        {
            case "haul":
            {
                // (drawn where the sum has him, he walks on the way he was going; at first, to the quay end)
                var q = s.ToB ? g.B!.Value : g.A!.Value;
                // (drawn on his way in, he carries what he took up unseen: a sack, a crate, a box of fish)
                var hr = HaulRoute.Of(g.A, g.B, 1);
                crowd.PuppetLoad(p, s.ToB && !Crowd.Laden.Contains(s.Kind), hr?.CarryKind ?? "sack");
                crowd.PuppetGo(p, q.X, q.Z, pace);
                break;
            }
            case "patrol":
            case "roam":
            case "thief":
            case "inspect":
            {
                var q = g.Route![s.Step % g.Route.Length];
                // soldiers walking out take it easy
                crowd.PuppetGo(p, q.X, q.Z, g.Mode == "thief" ? 0.9 : s.R.Trade == "soldier" && g.Mode == "roam" ? pace * 0.8 : pace);
                s.Ph = 0;
                break;
            }
            case "millrun":
                s.Wait = 0;
                break;
            case "guard":
            {
                // the relief: to the waiting spot while the old sentry still stands at the post
                var w = ReliefWait(s);
                crowd.PuppetGo(p, w?.X ?? g.X, w?.Z ?? g.Z, pace);
                break;
            }
            default:
                crowd.PuppetGo(p, g.X, g.Z, pace);
                break;
        }
    }

    // ------------------------------------------------------------------ what they do there

    private void Behave(Sim s, double dt, (double x, double z)? body)
    {
        if (s.ActionHeld) return;
        var p = s.P!;
        var g = s.Goal;
        var crowd = Crowd!;
        if (Pair(s, dt)) return;
        if (stormLevel == 0 && LifeStep(s, dt)) return;
        bool busy = crowd.PuppetBusy(p);
        bool At(double x, double z, double r = 1.0) => Dist(p.X, p.Z, x, z) < r;
        switch (g.Mode)
        {
            case "home":
            case "inside":
            case "church":
                if (busy) return;
                if (At(g.X, g.Z, 1.3))
                {
                    // in at the door, and gone
                    s.Inside = true;
                    s.Door = new Pt(g.X, g.Z);
                    Lose(s, true);
                }
                else Retry(s);
                return;
            case "stand":
            case "tavern":
                if (StationRound(s, dt, body)) return;
                if (busy) return;
                if (!At(g.X, g.Z, 1.4) && s.Tries < 3)
                {
                    Retry(s);
                    return;
                }
                if (g.Motion == "sit")
                {
                    // emigrants: sit down on the chest (the last step onto the seat itself), and stay sat
                    if (p.State != "sit")
                    {
                        p.X = g.X;
                        p.Z = g.Z;
                        crowd.PuppetSit(p, g.Yaw);
                    }
                    return;
                }
                if ((s.Wait -= dt) <= 0)
                {
                    // sellers call out now and then; drinkers take turns talking; the emigrant women talk among themselves
                    bool talky = g.Mode == "tavern" || s.R.Work.Kind is "stall" or "shop" or "wait";
                    bool talking = talky && rng.NextDouble() < (g.Mode == "tavern" ? 0.4 : 0.25);
                    crowd.PuppetStand(p, talking ? "talk" : g.Motion ?? "idle", g.Yaw);
                    s.Wait = talking ? Rnd(2.5, 5) : Rnd(4, 10);
                }
                return;
            case "haul":
            {
                if (busy)
                {
                    s.Arrived = false;
                    return;
                }
                var a = g.A!.Value;
                var b = g.B!.Value;
                // (the load comes off a pile and goes in at a door or onto a pile: HaulRoutes.cs; the piles' own
                // loads, taken off and put on for real, come with the goods)
                var route = HaulRoute.Of(g.A, g.B, 1);
                string carry = route?.CarryKind ?? "sack";
                bool bare = Crowd.Laden.Contains(s.Kind);
                if (!s.Arrived)
                {
                    // at an end: face the pile or the door, and take up or put down the load
                    s.Arrived = true;
                    s.Wait = Rnd(1.5, 3.5);
                    bool nearA = At(a.X, a.Z, 2.5), nearB = !nearA && At(b.X, b.Z, 2.5);
                    double? yaw = null;
                    bool bend = false;
                    if (route != null && nearA)
                    {
                        yaw = route.AYaw;
                        bend = true;
                    }
                    else if (route != null && nearB)
                    {
                        var to = route.Door ?? route.Drop;
                        yaw = to != null ? Math.Atan2(to.Value.X - route.B.X, to.Value.Z - route.B.Z) : null;
                        bend = route.Into == "pile";
                        // set down: in at the door, onto the pile, at the fish bank
                        crowd.PuppetLoad(p, false, carry);
                    }
                    crowd.PuppetStand(p, bend ? "crouch" : "idle", yaw);
                    return;
                }
                if ((s.Wait -= dt) > 0) return;
                bool atA = At(a.X, a.Z, 2.5), atB = At(b.X, b.Z, 2.5);
                if (!atA && !atB)
                {
                    var q = s.ToB ? b : a;
                    if (s.Tries++ < 3) crowd.PuppetGo(p, q.X, q.Z);
                    else Retry(s);
                    return;
                }
                // loaded from the pile to the door, back empty
                s.ToB = atA;
                s.Tries = 0;
                crowd.PuppetLoad(p, s.ToB && !bare, carry);
                var dest = s.ToB ? b : a;
                crowd.PuppetGo(p, dest.X, dest.Z);
                return;
            }
            case "patrol":
            case "roam":
            case "thief":
            {
                if (busy)
                {
                    s.Arrived = false;
                    return;
                }
                if (!s.Arrived)
                {
                    s.Arrived = true;
                    s.Wait = g.Mode == "patrol" ? Rnd(1, 4) : Rnd(3, 12);
                    // two soldiers walking out stop and talk, the one at his side listening
                    var mate = s.R.Trade == "soldier" && s.R.Mate != null ? byId.GetValueOrDefault(s.R.Mate) : null;
                    bool talk = mate?.P != null && Dist(mate.P.X, mate.P.Z, p.X, p.Z) < 2 && rng.NextDouble() < 0.6;
                    crowd.PuppetStand(p, s.R.Trade == "police" ? "behind" : talk ? "talk" : "idle", talk ? Math.Atan2(mate!.P!.X - p.X, mate.P.Z - p.Z) : null);
                    return;
                }
                if ((s.Wait -= dt) > 0) return;
                s.Step++;
                var q = g.Route![s.Step % g.Route.Length];
                crowd.PuppetGo(p, q.X, q.Z);
                return;
            }
            case "millrun":
            {
                // with the mill's cart: along its way at the cart's pace, standing by it while it is loaded and unloaded
                // (the north mill's handcart he pushes himself; the Kipdorp mill's dray and its horse are the movers' part)
                if ((s.Wait -= dt) > 0) return;
                s.Wait = 0.5;
                var w = WhereNow(s);
                if (w?.Cart == null) return;
                p.Pushes = w.Cart.Value.mill.Cart == "handcart";
                if (w.Moving && w.Way != null)
                {
                    var ahead = Whereabouts.PointAlong(w.Way, Math.Min(w.Total, w.Walked + 6));
                    crowd.PuppetGo(p, ahead.x, ahead.z, SharedData.CartPace);
                }
                else if (!busy || At(w.X, w.Z, 1.5)) crowd.PuppetStand(p, "idle", null);
                else crowd.PuppetGo(p, w.X, w.Z, SharedData.CartPace);
                return;
            }
            case "guard":
                Guard(s, dt, busy, body);
                return;
            case "inspect":
                Inspect(s, dt, busy);
                return;
            case "play":
                Play(s, dt);
                return;
            case "market":
            case "stroll":
            case "loiter":
                if (busy) return;
                if ((s.Wait -= dt) > 0) return;
                if (rng.NextDouble() < 0.45 || g.Mode == "stroll")
                {
                    double a = rng.NextDouble() * Math.PI * 2;
                    double d = rng.NextDouble() * (g.R ?? 8) * 0.7;
                    var pl = Place(g.Place);
                    crowd.PuppetGo(p, (pl?.X ?? g.X) + Math.Cos(a) * d, (pl?.Z ?? g.Z) + Math.Sin(a) * d, g.Mode == "stroll" ? 0.9 : null);
                    s.Wait = Rnd(2, 6);
                }
                else
                {
                    // stop and talk to someone near, or just stand
                    Sim? other = null;
                    foreach (var person in sims) if (person != s && person.P != null && Dist(person.X, person.Z, p.X, p.Z) < 2.2) { other = person; break; }
                    double? yaw = other != null ? Math.Atan2(other.X - p.X, other.Z - p.Z) : null;
                    crowd.PuppetStand(p, other != null && rng.NextDouble() < 0.5 ? "talk" : "idle", yaw);
                    s.Wait = Rnd(4, 12);
                }
                return;
        }
    }

    // ---- the garrison and the customs (server town/garrison.ts)

    /// <summary>Two soldiers walking out: the one with the higher id walks at his comrade's side.</summary>
    private Sim? LeadOf(Sim s)
    {
        string? m = s.R.Mate;
        if (m == null || (s.R.Trade != "soldier" && s.R.Work.Kind != "round") || string.CompareOrdinal(m, s.R.Id) > 0) return null;
        return byId.TryGetValue(m, out var l) && !l.Inside && l.Key == s.Key ? l : null;
    }

    /// <summary>Keep with the comrade (true: the crowd walks him now). Lets go when they part.</summary>
    private bool Pair(Sim s, double dt)
    {
        var p = s.P!;
        var crowd = Crowd!;
        var l = s.Goal.Mode == "roam" ? LeadOf(s) : null;
        if (l?.P != null)
        {
            double d = Dist(l.P.X, l.P.Z, p.X, p.Z);
            if (d < 14)
            {
                crowd.PuppetFollow(p, l.P);
                s.Step = l.Step;
                return true;
            }
            // too far to fall in beside him: catch up first
            if (crowd.PuppetFollowing(p)) crowd.PuppetFollow(p, null);
            if ((s.Wait -= dt) <= 0)
            {
                s.Wait = 1;
                crowd.PuppetGo(p, l.P.X, l.P.Z, 1.8); // a quick step to catch up
            }
            return true;
        }
        if (crowd.PuppetFollowing(p))
        {
            crowd.PuppetFollow(p, null);
            s.Wait = 0;
            s.Arrived = false;
            Direct(s);
        }
        return false;
    }

    /// <summary>A sentry at his post. The relief waits a step in front of the old man, facing him, until he marches in; then takes the post.</summary>
    private void Guard(Sim s, double dt, bool busy, (double x, double z)? body)
    {
        var p = s.P!;
        var g = s.Goal;
        var crowd = Crowd!;
        if (ReliefWait(s) == null && StationRound(s, dt, body)) return;
        if (busy) return;
        if (Dist(p.X, p.Z, g.X, g.Z) > 0.7)
        {
            var wait = ReliefWait(s);
            if (wait != null)
            {
                if (Dist(p.X, p.Z, wait.Value.X, wait.Value.Z) > 0.7 && s.Tries < 3)
                {
                    s.Tries++;
                    crowd.PuppetGo(p, wait.Value.X, wait.Value.Z);
                    return;
                }
                if ((s.Wait -= dt) <= 0)
                {
                    crowd.PuppetStand(p, rng.NextDouble() < 0.5 ? "talk" : "idle", Math.Atan2(g.X - p.X, g.Z - p.Z));
                    s.Wait = Rnd(1.5, 3);
                }
                return;
            }
            if (s.Tries < 5)
            {
                s.Tries++;
                s.Wait = 0;
                crowd.PuppetGo(p, g.X, g.Z);
                return;
            }
        }
        if ((s.Wait -= dt) <= 0)
        {
            crowd.PuppetStand(p, g.Motion ?? "idle", g.Yaw);
            s.Wait = Rnd(6, 14);
        }
    }

    /// <summary>Shop posts, beggars, waiting travellers and sentries take a few steps and return to their work.</summary>
    private bool StationRound(Sim s, double dt, (double x, double z)? body)
    {
        var p = s.P!;
        var g = s.Goal;
        var crowd = Crowd!;
        string key = s.Key;
        var r = s.Round;
        if (r == null || r.Key != key || r.X != g.X || r.Z != g.Z) r = s.Round = new Station { Key = key, X = g.X, Z = g.Z, Wait = 18 + s.H * 24 };
        if (crowd.PuppetBusy(p)) return r.Phase != "rest";
        if (r.Phase == "out")
        {
            r.Phase = "pause";
            r.Wait = 4 + s.H * 5;
            crowd.PuppetStand(p, "behind", null);
            return true;
        }
        if (r.Phase == "back")
        {
            if (Dist(p.X, p.Z, g.X, g.Z) > 0.8)
            {
                crowd.PuppetGo(p, g.X, g.Z);
                return true;
            }
            r.Phase = "rest";
            r.Wait = 22 + s.H * 20;
            s.Wait = 0;
            return false;
        }
        if ((r.Wait -= dt) > 0) return r.Phase == "pause";
        if (r.Phase == "pause")
        {
            r.Phase = "back";
            crowd.PuppetGo(p, g.X, g.Z);
            return true;
        }
        // do not leave while answering the player or before reaching the post
        if (Dist(p.X, p.Z, g.X, g.Z) > 1 || (body != null && Dist(p.X, p.Z, body.Value.x, body.Value.z) < 2))
        {
            r.Wait = 3;
            return false;
        }
        for (int i = 0; i < 8; i++)
        {
            double a = (s.H + i / 8.0) * Math.PI * 2, d = s.R.Work.Kind == "stall" ? 1.5 : 2.5;
            double x = g.X + Math.Sin(a) * d, z = g.Z + Math.Cos(a) * d;
            if (!crowd.CanStand(x, z)) continue;
            r.X = x;
            r.Z = z;
            r.Phase = "out";
            crowd.PuppetGo(p, x, z, 0.8);
            return true;
        }
        r.Wait = 5;
        return false;
    }

    /// <summary>The old sentry still stands at this man's post: where the relief waits for him, a step in front and a step to the side, facing him. null: the post is free.</summary>
    private Pt? ReliefWait(Sim s)
    {
        var g = s.Goal;
        if (g.Mode != "guard" || s.R.Trade != "sentry") return null;
        bool occupied = false;
        foreach (var other in sims) if (other != s && other.P != null && other.Goal.Mode == "guard" && other.R.Trade == s.R.Trade && Dist(other.P.X, other.P.Z, g.X, g.Z) < 0.9) { occupied = true; break; }
        if (!occupied) return null;
        double yaw = g.Yaw ?? 0;
        return new Pt(g.X + Math.Sin(yaw) * 1.2 - Math.Cos(yaw) * 1.2, g.Z + Math.Cos(yaw) * 1.2 + Math.Sin(yaw) * 1.2);
    }

    /// <summary>A customs officer: at each landing he writes in his book, looks the goods over, goes on. (Walking up to the nearest goods comes with the goods.)</summary>
    private void Inspect(Sim s, double dt, bool busy)
    {
        var p = s.P!;
        var g = s.Goal;
        var crowd = Crowd!;
        if (busy) return;
        switch (s.Ph)
        {
            case 0:
                s.Face = g.Faces != null && g.Faces.Length > 0 ? g.Faces[s.Step % g.Route!.Length % g.Faces.Length] : null;
                s.Ph = 2;
                s.Wait = 0;
                return;
            case 2:
                if (s.Wait <= 0)
                {
                    crowd.PuppetStand(p, "write", s.Face);
                    s.Wait = Rnd(7, 14);
                }
                if ((s.Wait -= dt) <= 0)
                {
                    // look the goods over, then write again or go on
                    crowd.PuppetStand(p, rng.NextDouble() < 0.5 ? "behind" : "idle", s.Face);
                    s.Wait = Rnd(3, 6);
                    s.Ph = 3;
                }
                return;
            default:
                if ((s.Wait -= dt) > 0) return;
                if (rng.NextDouble() < 0.3)
                {
                    s.Ph = 2;
                    return;
                }
                s.Step++;
                Direct(s);
                return;
        }
    }

    /// <summary>The way did not work out: try again, then give up and stand.</summary>
    private void Retry(Sim s)
    {
        // far off (beyond the grid round the viewer): they are on their way, not stuck
        var a = Anchor(s);
        if (!Crowd!.OnGrid(a.X, a.Z))
        {
            Direct(s);
            return;
        }
        if (++s.Tries > 3)
        {
            // they cannot get there from here: once nobody sees them, they simply are there
            if (Crowd.IsHidden(s.X, s.Z))
            {
                Lose(s, true);
                s.X = a.X;
                s.Z = a.Z;
            }
            return;
        }
        Direct(s);
    }

    // ---- children: they look for each other, then play tag

    private static readonly double[] PlayEscapeAngles = { 0, 0.8, -0.8, 1.6, -1.6 };
    private void Play(Sim s, double dt)
    {
        var p = s.P!;
        var crowd = Crowd!;
        string key = s.Goal.Place ?? "";
        if (!games.TryGetValue(key, out var game)) games[key] = game = new Game();
        if ((s.Wait -= dt) > 0) return;
        s.Wait = 0.5;
        // everyone at tag on this square; not a girl or boy of fifteen dressed as grown (only watches)
        var kids = playKids; kids.Clear(); int near = 0;
        foreach (var kid in sims) if (kid.P != null && kid.P.Human.Scale < 0.9 && kid.Goal.Mode == "play" && kid.Goal.Place == key && !kid.Inside)
        { kids.Add(kid); if (Dist(kid.X, kid.Z, p.X, p.Z) < 30) near++; }
        if (near < 2)
        {
            // alone: go and find the others (the nearest child out playing anywhere near)
            Sim? other = null; double nearest = double.PositiveInfinity;
            foreach (var kid in sims) if (kid != s && kid.Goal.Mode == "play" && !kid.Inside && (kid.P == null || kid.P.Human.Scale < 0.9))
            { double distance = Dist(kid.X, kid.Z, p.X, p.Z); if (distance < nearest) { nearest = distance; other = kid; } }
            double od = other != null ? Dist(other.X, other.Z, p.X, p.Z) : 0;
            if (other != null && od < 45 && od > 2) crowd.PuppetGo(p, other.X, other.Z, 1.4);
            else if (!crowd.PuppetBusy(p))
            {
                crowd.PuppetStand(p, "idle", null);
                s.Wait = Rnd(2, 4);
            }
            return;
        }
        if (game.It?.P == null || !kids.Contains(game.It)) game.It = kids[rng.Next(kids.Count)];
        if (s == game.It)
        {
            if (game.Frozen > 0)
            {
                crowd.PuppetStand(p, "idle", null);
                return;
            }
            // no tagging back the one who just caught you (unless there is nobody else)
            Sim? prey = null; double nearest = double.PositiveInfinity;
            foreach (var kid in kids) if (kid != s && (kid != game.Last || kids.Count == 2))
            { double distance = Dist(kid.X, kid.Z, p.X, p.Z); if (distance < nearest) { nearest = distance; prey = kid; } }
            if (prey == null) return;
            if (Dist(prey.X, prey.Z, p.X, p.Z) < 0.95)
            {
                // tag! within arm's reach, a hand out to the other one, who is it now and counts to three
                game.Last = s;
                game.It = prey;
                game.Frozen = 1.5;
                crowd.PuppetStand(p, "talk", Math.Atan2(prey.X - p.X, prey.Z - p.Z));
                s.Wait = 1.2;
                return;
            }
            crowd.PuppetGo(p, prey.X, prey.Z, 2.4);
        }
        else
        {
            var it = game.It;
            double d = Dist(it.X, it.Z, p.X, p.Z);
            // they keep to the play place
            double R = Math.Max(6, Math.Min(14, s.Goal.R ?? 10));
            (double, double) Inside(double x, double z)
            {
                double dx = x - s.Goal.X, dz = z - s.Goal.Z, k = Math.Sqrt(dx * dx + dz * dz);
                return k > R ? (s.Goal.X + dx / k * R, s.Goal.Z + dz / k * R) : (x, z);
            }
            if (d < 6)
            {
                double L = d == 0 ? 1 : d;
                // away from it; cornered (a wall or a house that way), off to one side instead of running on the spot
                double ax = (p.X - it.X) / L, az = (p.Z - it.Z) / L;
                double jx = Rnd(-1.5, 1.5), jz = Rnd(-1.5, 1.5);
                (double x, double z)? to = null;
                foreach (double turn in PlayEscapeAngles)
                {
                    double c = Math.Cos(turn), sn = Math.Sin(turn);
                    var q = Inside(p.X + (ax * c - az * sn) * 4 + jx, p.Z + (ax * sn + az * c) * 4 + jz);
                    if (crowd.CanStand(q.Item1, q.Item2) && Dist(q.Item1, q.Item2, p.X, p.Z) > 1.5)
                    {
                        to = q;
                        break;
                    }
                }
                if (to != null) crowd.PuppetGo(p, to.Value.x, to.Value.z, 2.2);
                else if (!crowd.PuppetBusy(p)) crowd.PuppetStand(p, "idle", Math.Atan2(it.X - p.X, it.Z - p.Z));
            }
            else if (!crowd.PuppetBusy(p))
            {
                if (rng.NextDouble() < 0.5)
                {
                    // skip about near where they are, keeping an eye on it
                    double a = rng.NextDouble() * Math.PI * 2;
                    var (fx, fz) = Inside(p.X + Math.Cos(a) * Rnd(2, 4), p.Z + Math.Sin(a) * Rnd(2, 4));
                    crowd.PuppetGo(p, fx, fz, Rnd(1.3, 2));
                }
                else crowd.PuppetStand(p, rng.NextDouble() < 0.5 ? "talk" : "idle", Math.Atan2(it.X - p.X, it.Z - p.Z));
                s.Wait = Rnd(0.8, 2);
            }
        }
    }
}
