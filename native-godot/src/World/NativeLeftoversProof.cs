using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// `--leftovers-proof &lt;dir&gt;` (issues #187, #186, #182): the leftovers found by the earlier bundles, in the real town at 13:00 clear.
/// `--leftovers-only a,b` picks stages: `figures` (no frozen baked person on or by a bench), `rond` (the Sint-Jansplein is open in
/// the walk map and its benches are reached from the street), `theatre` (Jef climbs the Vleeshuis stair), `audience` (the theatre
/// audience climbs it to its seats), `river` (the far river is water), `ropes` (the mooring ropes follow the tide), `works` (the
/// wall works' basket moves with the winch), `fish` (the fish tables' fish models), `fireplace` (the taverns' new hearths).
/// Writes leftovers.json and pictures; exit 1 on a failed check.
/// </summary>
public static class NativeLeftoversProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output); string? error = null; var checks = new List<object>(); var facts = new Dictionary<string, object>();
        void Check(bool pass, string name) { checks.Add(new { name, pass }); GD.Print($"leftovers: {(pass ? "PASS" : "FAIL")} {name}"); }
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Wait(Func<bool> ok, int seconds) { var until = DateTime.UtcNow.AddSeconds(seconds); while (!ok()) { if (DateTime.UtcNow > until) throw new TimeoutException("leftovers wait"); await Frames(1); } }
        async Task Shot(string name, Vector3 eye, Vector3 target)
        {
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            game.Cam.GlobalPosition = eye; var q = new Transform3D(Basis.Identity, eye).LookingAt(target).Basis.GetRotationQuaternion();
            if (game.Cam is FlyCam fly) fly.Face(q); else game.Cam.Quaternion = q;
            await Frames(25); await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            using var image = game.GetViewport().GetTexture().GetImage(); image.SavePng(Path.Combine(output, name + ".png"));
        }
        string only = Main.I.Arg("leftovers-only"); bool Stage(string s) => only == "" || only.Split(',').Contains(s);
        try
        {
            Engine.MaxFps = 30; await Wait(() => game.Loaded && ServerLink.I?.Up == true && GameState.I.Live && !Scheldemist.Menu.Loading.Busy, 160);
            Jef.I.TestInput = true; var api = ServerLink.I!.Api!; var people = game.GetNode<Townspeople>("Townspeople"); await Wait(() => people.Data != null, 60);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle();
            await Frames(30);
            var benches = BakedWorld.All(game.World).OfType<Node3D>().Where(n => n.HasMeta(NativeBenches.SleepMeta)).Select(n => (Id: n.GetMeta(NativeBenches.SleepMeta).AsString(), At: n.GlobalPosition)).ToArray();
            facts["benches"] = benches.Length;
            if (Stage("figures"))
            {
                // every person the bake drew that still shows: a frozen figure (live people are drawn by the crowd, outside the town scene)
                // (the bus stops' live waiters are the omnibus's own people, not the bake's)
                bool Live(Node n) { for (Node? p = n; p != null; p = p.GetParent()) if (p.Name == "live_waiters") return true; return false; }
                var figures = BakedWorld.All(game.World).OfType<Skeleton3D>().Where(s => !Live(s) && BakedWorld.All(s.GetParent()).OfType<GeometryInstance3D>().Any(m => m.IsVisibleInTree()))
                    .Select(s => { var model = (Node3D)s.GetParent(); var at = model.GlobalPosition; var near = benches.Length == 0 ? (Id: "", At: at) : benches.MinBy(b => new Vector2(b.At.X - at.X, b.At.Z - at.Z).Length());
                        return (Path: model.GetPath().ToString(), At: at, Bench: near.Id, BenchDistance: new Vector2(near.At.X - at.X, near.At.Z - at.Z).Length()); }).ToArray();
                facts["figures"] = figures.Select(f => new { f.Path, at = new[] { f.At.X, f.At.Y, f.At.Z }, f.Bench, benchDistance = MathF.Round(f.BenchDistance, 2) }).ToArray();
                var onBench = figures.Where(f => f.BenchDistance < 1.6f).ToArray();
                Check(onBench.Length == 0, $"no frozen baked person sits on or stands at a bench ({onBench.Length} found of {figures.Length} frozen figures shown)");
                int n = 0;
                foreach (var f in onBench.Take(8)) await Shot("frozen-" + (++n) + "-" + f.Bench.Replace(':', '-'), f.At + new Vector3(2.2f, 1.7f, 2.2f), f.At + Vector3.Up * .8f);
                foreach (string id in new[] { "steen:0", "steen:1", "stop:vismarkt_kaaien", "stop:steen" })
                    if (benches.FirstOrDefault(b => b.Id == id) is { Id: not null } b) await Shot("bench-" + id.Replace(':', '-'), b.At + new Vector3(2.4f, 1.7f, 2.4f), b.At + Vector3.Up * .6f);
            }
            if (Stage("rond"))
            {
                // the Sint-Jansplein (townplaces "rond", centre 20, 296): open ground in the walk map and a route from its benches to the street
                var walk = people.Walk!; int open = 0, cells = 0;
                for (float z = 284; z <= 308; z += .5f) for (float x = 8; x <= 32; x += .5f) { if (new Vector2(x - 20, z - 296).Length() > 11) continue; cells++; if (walk.Free(x, z)) open++; }
                facts["rondOpen"] = new { open, cells };
                Check(open > cells / 2, $"the Sint-Jansplein is open in the walk map ({open} of {cells} half-metre cells)");
                var grid = new System.Text.StringBuilder();
                for (float z = 284; z <= 308; z += .5f) { for (float x = 8; x <= 32; x += .5f) grid.Append(walk.Free(x, z) ? '.' : '#'); grid.AppendLine(); }
                File.WriteAllText(Path.Combine(output, "rond-walk.txt"), grid.ToString());
                int routed = 0; var rond = benches.Where(b => b.Id.StartsWith("rond:")).ToArray();
                // a flood over the walk map's free half-metre cells from the ground before each bench: it must get out of the square
                bool Out(Vector3 at)
                {
                    var seen = new HashSet<(int, int)>(); var queue = new Queue<(int x, int z)>();
                    for (int dz = -3; dz <= 3; dz++) for (int dx = -3; dx <= 3; dx++) { var c = ((int)MathF.Round(at.X * 2) + dx, (int)MathF.Round(at.Z * 2) + dz); if (walk.Free(c.Item1 / 2.0, c.Item2 / 2.0) && seen.Add(c)) queue.Enqueue(c); }
                    while (queue.Count > 0)
                    {
                        var (x, z) = queue.Dequeue();
                        if (new Vector2(x / 2f - 20, z / 2f - 296).Length() > 16) return true;
                        foreach (var (nx, nz) in new[] { (x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1) })
                            if (new Vector2(nx / 2f - 20, nz / 2f - 296).Length() < 30 && walk.Free(nx / 2.0, nz / 2.0) && seen.Add((nx, nz))) queue.Enqueue((nx, nz));
                    }
                    return false;
                }
                foreach (var b in rond) if (Out(b.At)) routed++;
                Check(rond.Length > 0 && routed == rond.Length, $"every Sint-Jansplein bench is joined to the streets round the square ({routed} of {rond.Length})");
                // what the square's ground is drawn with: every mesh whose box covers a point of the square, with its names
                string Names(Node n) { var chain = new List<string>(); for (Node? p = n; p != null && p != game.World; p = p.GetParent()) chain.Add(p.Name + (p.HasMeta("source_name") ? "[" + p.GetMeta("source_name").AsString() + "]" : "")); chain.Reverse(); return string.Join("/", chain.TakeLast(4)); }
                facts["rondMeshes"] = BakedWorld.All(game.World).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.IsVisibleInTree()).Select(m => (m, box: m.GlobalTransform * m.GetAabb()))
                    .Where(p => p.box.Size.Length() < 400 && p.box.Position.X < 26 && p.box.End.X > 14 && p.box.Position.Z < 302 && p.box.End.Z > 290 && p.box.Position.Y < 1.5f)
                    .Select(p => new { path = Names(p.m), min = new[] { p.box.Position.X, p.box.Position.Y, p.box.Position.Z }, size = new[] { p.box.Size.X, p.box.Size.Y, p.box.Size.Z }, nav = p.m.HasMeta("native_nav_surface") ? p.m.GetMeta("native_nav_surface").AsBool().ToString() : "" }).ToArray();
                await Shot("rond-above", new Vector3(20.01f, 24, 296.01f), new Vector3(20, 0, 296));
                await Shot("rond-street", new Vector3(20, 1.7f, 284), new Vector3(20, 1, 296));
            }
            if (Stage("theatre"))
            {
                // #186: the Vleeshuis's theatre floor (9.84 m over the hall's floor) by the hall plan's stair (HallPeopleData:
                // hall frame x 26 -> 11 at z 12.3-14.1, origin -121.95, 92.4, floor 0.16): Jef walks it with his own body.
                Doors.I.Held = true; foreach (var d in Doors.I.All) Doors.I.Force(d, true); await Frames(6);
                float hx = -121.95f, hz = 92.4f, floor = .16f;
                // inside the hall, from the floor: the stair along the north wall, its foot at hall x 26 and its head at x 11
                // (the stair is boarded underneath: the pictures look along its treads, from its foot up and from its head down)
                await Shot("theatre-stair-foot", new Vector3(hx + 27.8f, floor + 1.7f, hz + 13.2f), new Vector3(hx + 20f, floor + 5.6f, hz + 13.2f));
                await Shot("theatre-stair-mid", new Vector3(hx + 21f, floor + 3.3f + 1.6f, hz + 13.2f), new Vector3(hx + 14f, floor + 8.2f, hz + 13.2f));
                await Shot("theatre-stair-head", new Vector3(hx + 10.2f, floor + 9.84f + 1.7f, hz + 13.2f), new Vector3(hx + 19f, floor + 4.5f, hz + 13.2f));
                await Shot("theatre-stair-hall", new Vector3(hx + 19f, floor + 3.5f, hz + 1f), new Vector3(hx + 19f, floor + 5f, hz + 13.2f));
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 20, minute = 0, weather = "clear" })); Daylight.I.Settle(); await Frames(60);
                await Shot("theatre-stair-foot-night", new Vector3(hx + 27.8f, floor + 1.7f, hz + 13.2f), new Vector3(hx + 20f, floor + 5.6f, hz + 13.2f));
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle(); await Frames(30);
                await Shot("theatre-floor", new Vector3(hx + 10f, floor + 9.84f + 1.7f, hz + 9f), new Vector3(hx - 6f, floor + 9.84f + .8f, hz + 7f));
                if (Jef.I.Fly) Jef.I.ToggleFly();
                Jef.I.Place(hx + 26.6f, hz + 13.2f, MathF.PI / 2, 0, floor); await Frames(20);
                var climb = new List<float[]>(); float top = Jef.I.Y; Jef.I.SetKey(Key.W, true);
                var until = DateTime.UtcNow.AddSeconds(25);
                while (DateTime.UtcNow < until && Jef.I.X > hx + 9.5f)
                {
                    Jef.I.Yaw = MathF.PI / 2; await Frames(1); top = MathF.Max(top, Jef.I.Y);
                    if (climb.Count == 0 || MathF.Abs(climb[^1][0] - Jef.I.X) > .5f) climb.Add(new[] { Jef.I.X, Jef.I.Y, Jef.I.Z });
                }
                Jef.I.ClearKeys(); facts["theatreClimb"] = climb; facts["theatreTop"] = top;
                Check(top > floor + 9.5f, $"Jef climbs the Vleeshuis stair to the theatre floor on foot (reached {top - floor:0.00} m of 9.84)");
                await Shot("theatre-climbed", new Vector3(Jef.I.X + 3, Jef.I.Y + 1.8f, Jef.I.Z - 3), new Vector3(Jef.I.X, Jef.I.Y + .9f, Jef.I.Z));
            }
            if (Stage("audience"))
            {
                // #186: the theatre's audience walks in at the door and climbs the stair to its seats when the player is in the hall
                var hall = Scheldemist.People.HallPeople.I!.Halls.First(h => h.Id == "vleeshuis");
                float hx = -121.95f, hz = 92.4f, floor = .16f;
                Doors.I.Held = true; foreach (var d in Doors.I.All) Doors.I.Force(d, true);
                if (Jef.I.Fly) Jef.I.ToggleFly();
                Jef.I.Place(hx + 20f, hz + 6f, MathF.PI / 2, 0, floor); await Frames(10);
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 7, hour = 18, minute = 5, weather = "clear" })); Daylight.I.Settle();
                float highest = 0; int climbers = 0, seated = 0; bool shot = false; var until = DateTime.UtcNow.AddSeconds(150);
                var seen = new List<object>();
                while (DateTime.UtcNow < until)
                {
                    await Frames(10);
                    var walkers = hall.Figures.Values.Where(f => f.Role is "audience" or "prompter").ToArray();
                    if (seen.Count < 40 && (walkers.Length > 0 || seen.Count < 20 && DateTime.UtcNow.Second % 10 == 0)) seen.Add(new { t = DateTime.UtcNow.ToString("HH:mm:ss"), game = $"{GameState.I.Hour}:{GameState.I.Minute:00} day {GameState.I.Day}", roles = string.Join(",", hall.Figures.Values.Select(f => f.Role).Distinct()), n = hall.Figures.Count, walkers = walkers.Take(3).Select(f => new { f.Role, f.StairWay, f.Moving, f.Ceremony, at = new[] { f.Group.GlobalPosition.X, f.Group.GlobalPosition.Y, f.Group.GlobalPosition.Z } }).ToArray() });
                    climbers = Math.Max(climbers, walkers.Count(f => f.StairWay && f.Moving));
                    seated = walkers.Count(f => f.StairWay && !f.Moving && f.Group.GlobalPosition.Y > floor + 9);
                    foreach (var f in walkers.Where(f => f.StairWay)) highest = MathF.Max(highest, f.Group.GlobalPosition.Y - floor);
                    var mid = walkers.FirstOrDefault(f => f.StairWay && f.Moving && f.Group.GlobalPosition.Y - floor is > 2.5f and < 6f);
                    if (mid != null && !shot)
                    {
                        shot = true; var at = mid.Group.GlobalPosition;
                        await Shot("audience-on-stair", new Vector3(at.X + 3.2f, at.Y + .3f, at.Z), at + Vector3.Up * 1f);
                        if (Jef.I.Fly) Jef.I.ToggleFly();
                        Jef.I.Place(hx + 20f, hz + 6f, MathF.PI / 2, 0, floor);
                    }
                    if (seated >= 3 && shot) break;
                }
                var door = Scheldemist.People.HallPeople.I.DoorOf("vleeshuis");
                facts["audience"] = new { climbers, seated, highest, entered = Scheldemist.People.HallPeople.I.CeremonyEntered, figures = hall.Figures.Count, seen,
                    stairWay = door is { } dw ? Scheldemist.People.HallPeople.I.StairWayLength("vleeshuis", dw, new Vector3(hx - 2f, floor + 9.84f, hz + 4f)) : -2, note = Scheldemist.People.HallPeople.StairNote, door = door?.ToString() };
                Check(highest > 9.5f && seated > 0, $"the theatre's audience climbs the Vleeshuis stair to its seats (highest {highest:0.0} m, {seated} seated by the stair, {climbers} on it at once)");
                await Shot("audience-seated", new Vector3(hx + 10f, floor + 9.84f + 1.7f, hz + 9f), new Vector3(hx - 6f, floor + 9.84f + .8f, hz + 7f));
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle();
            }
            if (Stage("river"))
            {
                // #182: far out on the river, beyond the town's map (z under -80), is water: Jef swims there
                int rescued = Jef.I.Rescued;
                if (Jef.I.Fly) Jef.I.ToggleFly();
                Jef.I.Place(-150f, -95f, 0f); await Frames(150);
                bool swimming = Jef.I.Swimming, water = Water.In(-150f, -95f);
                facts["farRiver"] = new { swimming, water, rescued = Jef.I.Rescued - rescued, at = new[] { Jef.I.X, Jef.I.Y, Jef.I.Z }, far = Water.FarRiver is { } r ? new[] { r.Position.X, r.Position.Y, r.End.X, r.End.Y } : null };
                Check(water && swimming && Jef.I.Rescued == rescued, $"Jef falling in far out on the river swims there (water {water}, swimming {swimming}, put back {Jef.I.Rescued - rescued} times)");
                await Shot("far-river-swim", new Vector3(Jef.I.X + 3f, Jef.I.Y + 2.2f, Jef.I.Z + 4f), new Vector3(Jef.I.X, Jef.I.Y, Jef.I.Z));
            }
            if (Stage("berths"))
            {
                // #182: where a resident boat ties up at each flight, and whether her people step out onto its landing there; a boat
                // whose own berth is out of reach comes alongside the landing first (BoatsWaitingAtLanding: taken on once nobody is near)
                var report = Scheldemist.Play.ResidentJourneys.I!.BerthReport().Select(b => new { b.Flight, b.Near, at = new[] { b.At.X, b.At.Y }, fromLanding = b.FromLanding }).ToArray();
                facts["berths"] = report; facts["berthWhy"] = Scheldemist.Play.ResidentJourneys.I.BerthWhy().ToArray(); facts["familyBoatHalf"] = Scheldemist.Play.ResidentJourneys.FamilyHalf;
                Check(report.Length > 0 && report.All(b => b.Near), $"a boat coming in to any flight can land her people at its landing ({report.Count(b => b.Near)} of {report.Length} flights)");
            }
            if (Stage("ropes"))
            {
                // #182: the small boats' mooring ropes follow the tide: their boat ends rise and fall with her, the coping ends stay
                var boats = Scheldemist.Movers.Boats.I!;
                var spot = boats.MooredSpots().Where(m => !m.Gone && boats.Dims(m.Kind).Length < 9).OrderBy(m => new Vector2(m.X + 4, m.Z - 1).Length()).First();
                var bow = new Vector3(spot.X + MathF.Sin(spot.Yaw) * boats.Dims(spot.Kind).Length * .4f, 0, spot.Z + MathF.Cos(spot.Yaw) * boats.Dims(spot.Kind).Length * .4f);
                var outward = new Vector3(0, 0, -1f); // (the quays face the river at -z; the pictures look back at the wall from over the water)
                var eye = bow + outward * 6f + new Vector3(2.5f, 2.2f, 0); var look = bow + new Vector3(0, -1.0f, 0);
                var rises = new List<object>();
                foreach (var (name, level) in new[] { ("low", Tide.LwMin + .2f), ("high", Tide.HwMax - .2f) })
                {
                    Tide.Hold(level); await Frames(400);
                    rises.Add(new { name, level, river = Tide.River, rope = boats.RopeRise.Count > 0 ? boats.RopeRise.Average() : float.NaN, rebuilds = boats.RopeRebuilds });
                    await Shot("ropes-" + name, eye, look);
                }
                Tide.Hold(null);
                facts["ropes"] = rises;
                float lo = (float)rises[0].GetType().GetProperty("rope")!.GetValue(rises[0])!, hi = (float)rises[1].GetType().GetProperty("rope")!.GetValue(rises[1])!;
                Check(boats.RopeRise.Count > 0 && hi - lo > 3f, $"the small boats' mooring ropes follow the tide ({boats.RopeRise.Count} boats, their ends {lo:0.00} m at low water and {hi:0.00} m at high)");
            }
            if (Stage("works"))
            {
                // #180: the town wall works' fall winds in as the navvy cranks, the basket rises with it
                var works = Scheldemist.Town.WallWorks.I!;
                if (works.Crank is { } crank)
                {
                    GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 10, minute = 0, weather = "clear" })); Daylight.I.Settle();
                    if (Jef.I.Fly) Jef.I.ToggleFly();
                    Jef.I.Place((float)crank.X + 3f, (float)crank.Z + 3f, 0f);
                    // the navvy comes to the winch and cranks (the carry check's own wait: up to three minutes)
                    var cranking = DateTime.UtcNow.AddSeconds(180);
                    while (DateTime.UtcNow < cranking && !people.Sims.Any(x => x.P is { } q && q.Human.Motion == "pull" && Math.Abs(q.X - crank.X) + Math.Abs(q.Z - crank.Z) < 0.4)) await Frames(10);
                    float before = works.Lift; var at0 = works.Load?.GlobalPosition ?? Vector3.Zero;
                    // from along the wall, level with the middle of the fall: the block, the fall, the basket on its hook
                    var middle = (works.Block + works.Hook) / 2; var eye = middle + works.Along * 7f + Vector3.Up * 0.5f;
                    await Shot("works-start", eye, middle);
                    var until = DateTime.UtcNow.AddSeconds(25); while (DateTime.UtcNow < until) await Frames(10);
                    float after = works.Lift; var at1 = works.Load?.GlobalPosition ?? Vector3.Zero;
                    await Shot("works-later", eye, middle);
                    facts["works"] = new { before, after, lowering = works.Lowering, load0 = new[] { at0.X, at0.Y, at0.Z }, load1 = new[] { at1.X, at1.Y, at1.Z }, crank = works.CrankAngle };
                    Check(works.Load != null && MathF.Abs(after - before) > 0.2f && MathF.Abs(at1.Y - at0.Y) > 0.2f, $"the works' basket moves with the winch ({before:0.00} -> {after:0.00} m)");
                    GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle();
                }
                else Check(false, "the town wall works have a winch");
            }
            if (Stage("fish"))
            {
                // #180: the fish market's tables carry the herring, cod and plaice models (the table's own coarse fish are out)
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 10, minute = 0, weather = "clear" })); Daylight.I.Settle();
                if (Jef.I.Fly) Jef.I.ToggleFly();
                Jef.I.Place(-104f, 24f, 0f); await Frames(200);
                MultiMeshInstance3D? cod = null;
                foreach (var mm in BakedWorld.All(game.GetTree().Root).OfType<MultiMeshInstance3D>())
                    if (mm.Multimesh?.Mesh?.ResourceName.StartsWith("smallgoods_cod") == true && Enumerable.Range(0, mm.Multimesh.VisibleInstanceCount).Any(i => MathF.Abs((mm.Multimesh.GetInstanceTransform(i).Basis * Vector3.Right).Normalized().Y) < .5f)) { cod = mm; break; }
                int kinds = BakedWorld.All(game.GetTree().Root).OfType<MultiMeshInstance3D>().Where(mm => mm.Multimesh?.VisibleInstanceCount > 0).Select(mm => mm.Multimesh!.Mesh?.ResourceName ?? "")
                    .Count(n => n.StartsWith("smallgoods_cod") || n.StartsWith("smallgoods_plaice") || n.StartsWith("workgoods_held_fish"));
                var drawn = BakedWorld.All(game.GetTree().Root).OfType<MultiMeshInstance3D>().Where(mm => (mm.Multimesh?.Mesh?.ResourceName ?? "").Contains("fish"))
                    .Select(mm => new { mesh = mm.Multimesh!.Mesh!.ResourceName, rows = mm.Multimesh.InstanceCount, shown = mm.Multimesh.VisibleInstanceCount }).ToArray();
                facts["fish"] = new { kinds, taken = Scheldemist.People.NativeMarket.FishTrianglesTaken, models = Scheldemist.People.NativeMarket.FishModelsNote, drawn };
                Check(cod != null && Scheldemist.People.NativeMarket.FishTrianglesTaken > 0, $"the fish tables lay the cod, plaice and herring models ({kinds} fish batches; {Scheldemist.People.NativeMarket.FishTrianglesTaken} of the table's own fish triangles out)");
                if (cod != null)
                {
                    // (a cod lying on a table: the dried cod hung on the fixed stalls' rails hang head down)
                    int lying = Enumerable.Range(0, cod.Multimesh!.VisibleInstanceCount).FirstOrDefault(i => MathF.Abs((cod.Multimesh.GetInstanceTransform(i).Basis * Vector3.Right).Normalized().Y) < .5f);
                    var t = cod.GlobalTransform * cod.Multimesh!.GetInstanceTransform(lying);
                    var at = t.Origin; var toward = (t.Basis * Vector3.Right).Normalized();
                    await Shot("fish-table-close", at + new Vector3(0, 0.9f, 0) - toward.Cross(Vector3.Up) * 0.9f, at);
                    await Shot("fish-table", at + new Vector3(0, 1.6f, 0) - toward.Cross(Vector3.Up) * 2.2f, at);
                    foreach (var (name, hour, weather) in new[] { ("rain", 10, "rain"), ("night", 21, "clear") })
                    {
                        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour, minute = 0, weather })); Daylight.I.Settle(); await Frames(90);
                        await Shot("fish-table-" + name, at + new Vector3(0, 1.6f, 0) - toward.Cross(Vector3.Up) * 2.2f, at);
                    }
                }
                // #190: every fish of the market is the herring or the cod model, and every heap of fish lies on the crushed ice
                // (the crates, baskets, barrows, the fixed fish stalls and the carried fish box); pictures of each at 10:00 clear
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 10, minute = 0, weather = "clear" })); Daylight.I.Settle();
                var market = Scheldemist.People.NativeMarket.I!;
                var until = DateTime.UtcNow.AddSeconds(150);
                while (DateTime.UtcNow < until && market.PitchState().Count(p => p!["level"]!.GetValue<int>() == 2) < 14) await Frames(15);
                facts["catch"] = new { tradeFishCell = Scheldemist.People.MarketCatch.TradeCell, taken = Scheldemist.People.MarketCatch.Taken, wholeFish = Scheldemist.People.MarketCatch.WholeFish, heaps = Scheldemist.People.MarketCatch.Heaps,
                    pitchesUp = market.PitchState().Count(p => p!["level"]!.GetValue<int>() == 2) };
                Check(Scheldemist.People.MarketCatch.WholeFish > 0 && Scheldemist.People.MarketCatch.Heaps > 0, $"the stalls' painted fish are out: {Scheldemist.People.MarketCatch.WholeFish} whole fish became the herring or cod model, {Scheldemist.People.MarketCatch.Heaps} heaps the crushed ice with herring ({Scheldemist.People.MarketCatch.Taken} triangles out)");
                int ice = BakedWorld.All(game.GetTree().Root).OfType<MultiMeshInstance3D>().Where(mm => mm.IsVisibleInTree() && (mm.Multimesh?.Mesh?.ResourceName ?? "").StartsWith("smallgoods_ice")).Sum(mm => mm.Multimesh!.VisibleInstanceCount);
                Check(ice > 0, $"the market's fish lie on the crushed ice ({ice} beds drawn)");
                var shown = new HashSet<string>();
                foreach (var it in market.LaidOut.Where(i => i.Goods == "fish").OrderBy(i => i.Pitch < 0 ? 1 : 0))
                {
                    string kind = it.Kind is "fishtable" ? "crates" : it.Kind;
                    if (!shown.Add(kind)) continue;
                    var mid = new Vector3((float)it.X, (float)people.Walk!.BaseAt(it.X, it.Z), (float)it.Z);
                    var front = new Vector3((float)it.Front.X, mid.Y, (float)it.Front.Z); var toward = (front - mid) with { Y = 0 };
                    if (toward.LengthSquared() < .01f) toward = Vector3.Forward;
                    // (a fish table's crates stand behind it: look at them from the seller's side)
                    if (kind == "crates") { var back = mid - toward.Normalized() * 1.0f; await Shot("catch-crates", back - toward.Normalized() * 1.4f + Vector3.Up * 1.5f, back + Vector3.Up * .3f); }
                    else await Shot("catch-" + kind, mid + toward.Normalized() * 1.1f + Vector3.Up * 2.0f, mid + Vector3.Up * .4f);
                }
                facts["catchShots"] = shown.ToArray();
                if (Scheldemist.People.MarketStalls.I?.List.FirstOrDefault(st => st.Sells("fish")) is { } fixedStall)
                {
                    var mid = new Vector3((float)fixedStall.X, 0, (float)fixedStall.Z); var face = new Vector3(MathF.Sin((float)fixedStall.Yaw), 0, MathF.Cos((float)fixedStall.Yaw));
                    await Shot("catch-fixed-stall", mid + face * 1.8f + Vector3.Up * 1.6f, mid + Vector3.Up * .8f);
                    await Shot("catch-fixed-stall-b", mid - face * 1.8f + Vector3.Up * 1.6f, mid + Vector3.Up * .8f);
                }
                if (Scheldemist.People.Carried.Load("fishbox", 1) is { } box)
                {
                    var at = new Vector3(Jef.I.X + 2, 0, Jef.I.Z + 2); at.Y = (float)people.Walk!.BaseAt(at.X, at.Z); box.Position = at;
                    Main.I.View.AddChild(box); await Frames(5);
                    await Shot("catch-fishbox", at + new Vector3(.9f, 1.1f, .9f), at + Vector3.Up * .1f);
                    box.QueueFree();
                }
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle();
            }
            if (Stage("cathedral"))
            {
                // #192: the cathedral's west end, where the organist sits at 7.25 m (hall plan origin -262, 145.53, yaw 0, floor 0.3),
                // and the confessional in the south aisle: pictures and what is built there
                Doors.I.Held = true; foreach (var d in Doors.I.All) Doors.I.Force(d, true);
                float hx = -262f, hz = 145.53f, floor = .3f;
                if (Jef.I.Fly) Jef.I.ToggleFly();
                Jef.I.Place(hx, hz + 24f, MathF.PI, 0, floor); await Frames(60);
                string Names(Node n) { var chain = new List<string>(); for (Node? q = n; q != null && q != game.World; q = q.GetParent()) chain.Add(q.Name.ToString()); chain.Reverse(); return string.Join("/", chain.TakeLast(5)); }
                facts["westEnd"] = BakedWorld.All(game.GetTree().Root).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.IsVisibleInTree()).Select(m => (m, box: m.GlobalTransform * m.GetAabb()))
                    .Where(q => q.box.Size.Length() < 80 && q.box.End.X > hx - 9 && q.box.Position.X < hx + 9 && q.box.Position.Z < hz + 16 && q.box.End.Z > hz - 1 && q.box.End.Y > floor + 3 && q.box.Position.Y < floor + 13)
                    .Select(q => new { path = Names(q.m), min = new[] { MathF.Round(q.box.Position.X - hx, 2), MathF.Round(q.box.Position.Y - floor, 2), MathF.Round(q.box.Position.Z - hz, 2) }, size = new[] { MathF.Round(q.box.Size.X, 2), MathF.Round(q.box.Size.Y, 2), MathF.Round(q.box.Size.Z, 2) } }).Take(120).ToArray();
                await Shot("cathedral-west-nave", new Vector3(hx, floor + 1.7f, hz + 24f), new Vector3(hx, floor + 6.5f, hz + 4f));
                await Shot("cathedral-west-high", new Vector3(hx + 3f, floor + 9f, hz + 16f), new Vector3(hx, floor + 7f, hz + 4f));
                await Shot("cathedral-west-side", new Vector3(hx + 8f, floor + 2f, hz + 12f), new Vector3(hx - 2f, floor + 6f, hz + 4f));
                await Shot("cathedral-confessional", new Vector3(hx + 19f, floor + 1.7f, hz + 43f), new Vector3(hx + 24.25f, floor + 1f, hz + 40.55f));
                Jef.I.Place(hx, hz + 6f, MathF.PI, 0, floor); await Frames(40);
                facts["underLoft"] = new { ground = Jef.I.GroundAt(hx, hz + 6f, floor + 9f), at7 = Jef.I.GroundAt(hx, hz + 9.25f, floor + 7.6f) };
                // the loft's floor: its top at every half metre (hall frame), from 8.2 m down
                var loft = new System.Text.StringBuilder();
                for (float lz = 0f; lz <= 11.5f; lz += .5f) { loft.Append($"{lz,5:0.0}"); for (float lx = -8f; lx <= 12f; lx += .5f) { Solid.I.Ensure(new Vector3(hx + lx, floor + 7, hz + lz), 4); float g = Jef.I.GroundAt(hx + lx, hz + lz, floor + 7.9f) - floor; loft.Append(g > 6.8f && g < 7.9f ? ((int)MathF.Round((g - 7f) * 10)).ToString()[^1] : g > 0.6f ? '+' : '.'); } loft.AppendLine(); }
                File.WriteAllText(Path.Combine(output, "cathedral-loft-floor.txt"), loft.ToString());
                // what holds a body standing at 7.2 m (hall frame x from -8 to 12, z 0 to 22): '#' held, '.' free
                var room = new System.Text.StringBuilder();
                foreach (float h in new[] { 7.25f, 4.0f })
                {
                    room.AppendLine($"feet at {h} m");
                    for (float lz = 0f; lz <= 22f; lz += .5f) { room.Append($"{lz,5:0.0}"); for (float lx = -8f; lx <= 12f; lx += .5f) { Solid.I.Ensure(new Vector3(hx + lx, floor + h, hz + lz), 4); room.Append(Jef.I.BodyFree(hx + lx, floor + h, hz + lz) ? '.' : '#'); } room.AppendLine(); }
                }
                File.WriteAllText(Path.Combine(output, "cathedral-body.txt"), room.ToString());
                // the loft's stair (#192): its model stands in the south aisle; Jef climbs it from its foot with his own body and walks
                // the gallery into the loft to the organist's chair
                bool stairDrawn = BakedWorld.All(game.GetTree().Root).OfType<Node3D>().Any(n => n.Name == "cathedral_loft_stair" && n.IsVisibleInTree());
                Check(stairDrawn, "the cathedral's loft stair and gallery stand in the south aisle");
                if (Jef.I.Fly) Jef.I.ToggleFly();
                Jef.I.Place(hx + 10f, hz + 21.8f, 0, 0, floor); await Frames(30);
                var climb = new List<float[]>(); float top = Jef.I.Y - floor; Jef.I.SetKey(Key.W, true);
                var until = DateTime.UtcNow.AddSeconds(30);
                while (DateTime.UtcNow < until && Jef.I.Z > hz + 8.75f) { Jef.I.Yaw = 0; await Frames(1); top = MathF.Max(top, Jef.I.Y - floor); if (climb.Count == 0 || MathF.Abs(climb[^1][2] - Jef.I.Z) > .5f) climb.Add(new[] { Jef.I.X, Jef.I.Y, Jef.I.Z }); }
                until = DateTime.UtcNow.AddSeconds(20);
                while (DateTime.UtcNow < until && Jef.I.X > hx + 1.2f) { Jef.I.Yaw = MathF.PI / 2; await Frames(1); if (MathF.Abs(climb[^1][0] - Jef.I.X) > .5f) climb.Add(new[] { Jef.I.X, Jef.I.Y, Jef.I.Z }); }
                Jef.I.ClearKeys(); await Frames(10);
                var end = new Vector3(Jef.I.X - hx, Jef.I.Y - floor, Jef.I.Z - hz);
                facts["loftClimb"] = new { top, end = new[] { end.X, end.Y, end.Z }, climb };
                Check(top > 7.1f && end.Y > 7.1f && end.X < 1.5f, $"Jef climbs the loft stair and walks the gallery into the organ loft (reached {top:0.00} m of 7.3, stands at x {end.X:0.0} on the loft at {end.Y:0.00} m)");
                await Shot("cathedral-loft-from-gallery", new Vector3(hx + 7.5f, floor + 7.3f + 1.6f, hz + 8.8f), new Vector3(hx - 1f, floor + 7.6f, hz + 9f));
                await Shot("cathedral-loft-stair-aisle", new Vector3(hx + 8.6f, floor + 1.7f, hz + 25f), new Vector3(hx + 10f, floor + 4f, hz + 12f));
                await Shot("cathedral-loft-stair-nave", new Vector3(hx - 1f, floor + 2.2f, hz + 19f), new Vector3(hx + 9f, floor + 5f, hz + 11f));
                await Shot("cathedral-loft-stair-foot", new Vector3(hx + 8.7f, floor + 1.6f, hz + 23.5f), new Vector3(hx + 10f, floor + 1f, hz + 20f));
                // the organist's walk in from the door, up the stair, to his chair; the confessor's to his box's door, and his step in
                var organist = Scheldemist.People.HallPeople.I!.WalkIn("cathedral", "organist");
                var confessor = Scheldemist.People.HallPeople.I.WalkIn("cathedral", "confessor");
                facts["walkIn"] = new { organist = organist.Points, confessor = confessor.Points, confessorStep = confessor.StepIn, note = Scheldemist.People.HallPeople.StairNote };
                Check(organist.Points > 0, $"the organist walks in from the door and up the loft stair to his chair ({organist.Points} points)");
                Check(confessor.Points > 0 && confessor.StepIn < 1.6f, $"the confessor walks in from the door to his box and steps in ({confessor.Points} points, a last step of {confessor.StepIn:0.00} m)");
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 21, minute = 0, weather = "clear" })); Daylight.I.Settle(); await Frames(60);
                await Shot("cathedral-loft-stair-aisle-night", new Vector3(hx + 8.6f, floor + 1.7f, hz + 25f), new Vector3(hx + 10f, floor + 4f, hz + 12f));
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "rain" })); Daylight.I.Settle(); await Frames(60);
                await Shot("cathedral-loft-stair-aisle-rain", new Vector3(hx + 8.6f, floor + 1.7f, hz + 25f), new Vector3(hx + 10f, floor + 4f, hz + 12f));
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle();
            }
            if (Stage("fireplace"))
            {
                // #187: the Ankere's, the Schipke's and the Zwarte Kat's hearth: the fittings' fireplace, by day and lit at night
                Doors.I.Held = true; foreach (var d in Doors.I.All) Doors.I.Force(d, true);
                var places = BakedWorld.All(game.World).OfType<Scheldemist.Native.Interiors.FurnitureVisual>().Where(v => v.ModelScene != "").ToArray();
                Check(places.Length == 3 && places.All(v => v.KitFit == "model"), $"the three taverns' fireplaces draw the fittings' model ({places.Count(v => v.KitFit == "model")} of {places.Length})");
                // #190: the room hearths draw no sparks (3.5 cm discs that hung in the fireplaces as pale dots); the fires outdoors keep theirs
                var sparks = Fires.I!.SparkCount; facts["fireSparks"] = new { sparks.roomFires, sparks.roomSparks, sparks.outdoorFires, sparks.outdoorSparks };
                Check(sparks.roomFires > 0 && sparks.roomSparks == 0 && sparks.outdoorSparks > 0, $"no spark dots in the room hearths ({sparks.roomSparks} spark points in {sparks.roomFires} room fires; {sparks.outdoorSparks} in {sparks.outdoorFires} outdoors)");
                foreach (int hour in new[] { 13, 20 })
                {
                    GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour, minute = 0, weather = "clear" })); Daylight.I.Settle(); await Frames(60);
                    foreach (var v in places)
                    {
                        var xf = v.GlobalTransform * new Transform3D(new Basis(Vector3.Up, v.ModelYaw), v.SceneOffset); string room = (v.GetParent() as Scheldemist.Native.Authoring.AuthoredObject)?.ObjectId.Split("-source")[0] ?? "fireplace";
                        await Shot(room + "-fireplace-" + hour, xf * new Vector3(0.6f, 1.55f, 3.4f), xf * new Vector3(0, 1.0f, 0.5f));
                        if (hour == 13) await Shot(room + "-fireplace-close", xf * new Vector3(-0.5f, 0.8f, 1.9f), xf * new Vector3(0, 0.45f, 0.5f));
                    }
                }
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle();
            }
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr(error); }
        File.WriteAllText(Path.Combine(output, "leftovers.json"), JsonSerializer.Serialize(new { checks, error, facts }, new JsonSerializerOptions { WriteIndented = true, IncludeFields = true }));
        game.GetTree().Quit(error == null && checks.All(c => (bool)c.GetType().GetProperty("pass")!.GetValue(c)!) ? 0 : 1);
    }
}
