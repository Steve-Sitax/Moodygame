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
/// the walk map and its benches are reached from the street). Writes leftovers.json and pictures; exit 1 on a failed check.
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
                await Shot("theatre-stair-foot", new Vector3(hx + 30.5f, floor + 1.7f, hz + 9.5f), new Vector3(hx + 18, floor + 3.5f, hz + 13.2f));
                await Shot("theatre-stair-side", new Vector3(hx + 18.5f, floor + 1.7f, hz + 7f), new Vector3(hx + 18.5f, floor + 4f, hz + 13.2f));
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
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr(error); }
        File.WriteAllText(Path.Combine(output, "leftovers.json"), JsonSerializer.Serialize(new { checks, error, facts }, new JsonSerializerOptions { WriteIndented = true, IncludeFields = true }));
        game.GetTree().Quit(error == null && checks.All(c => (bool)c.GetType().GetProperty("pass")!.GetValue(c)!) ? 0 : 1);
    }
}
