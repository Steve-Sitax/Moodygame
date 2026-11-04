using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.Ui;
using Scheldemist.Native.Characters;
using Scheldemist.Native.Services;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

/// <summary>
/// Bounded native proof of the folding footbridges (#286, #283): `--ruien-bridge-proof <out> --ruien-bridge-spec <json>`
/// with isolated data and an external `--ruien-areas`. For each bridge in the spec: the kit model checks (metric UVs,
/// closed meshes, materials), Jef crosses while it is down, the leaf waits while he stands on it and the giant waits short
/// of the mouth, the leaves rise once he steps off, collision follows the leaf part way and standing, a raised leaf
/// stops Jef and clears the masonry, the giant wades through upright, the leaves come down after him and Jef crosses
/// again; close views down, part way and up (inspection light, midday, rain, night) and a short frame-cost sample.
/// </summary>
public static class NativeRuienBridgeProof
{
    private sealed record Light(string Name, int Hour, string Weather, float Fill);
    private static readonly Light[] Lights = { new("inspect", 13, "clear", 1.2f), new("midday", 13, "clear", 0), new("rain", 13, "rain", 0), new("night", 23, "clear", 0) };

    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        var checks = new List<object>(); var findings = new List<object>(); int failures = 0;
        void Check(string name, bool ok, string detail = "") { checks.Add(new { name, ok, detail }); if (!ok) failures++; GD.Print($"RUIEN_BRIDGE {name}: {(ok ? "PASS" : "FAIL")} {detail}"); }
        // the area's own geometry where it stops the giant (not the bridge): recorded for an issue, not a bridge failure
        void Find(string name, bool clear, string detail) { findings.Add(new { name, clear, detail }); GD.Print($"RUIEN_BRIDGE_AREA {name}: {(clear ? "clear" : "FINDING")} {detail}"); }
        static bool OfBridge(Godot.Collections.Dictionary h) => (h["collider"].AsGodotObject() as Node)?.Name.ToString().StartsWith("ruien_bridge_") == true;
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.PhysicsFrame); }
        async Task Seconds(float s) { ulong end = Time.GetTicksMsec() + (ulong)(s * 1000); while (Time.GetTicksMsec() < end) await Frames(1); }
        try
        {
            if (!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !game.Flag("no-ai"))
                throw new Exception("needs an isolated --db inside the output folder and --no-ai");
            var spec = JsonDocument.Parse(File.ReadAllText(game.Arg("ruien-bridge-spec"))).RootElement;
            var deadline = DateTime.UtcNow.AddSeconds(900);
            while (!game.Loaded || Loading.Busy || ServerLink.I?.Up != true || !GameState.I.Live)
            { if (DateTime.UtcNow > deadline) throw new TimeoutException("Native town not ready"); await Frames(1); }
            MainMenu.I?.Start(); Jef.I.TestInput = true; Pause.Clear();
            var api = ServerLink.I!.Api!;
            async Task SetLight(Light l)
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour = l.Hour, minute = 0, weather = l.Weather }));
                Ruien.I!.Data.Fill = l.Fill > 0 ? new Color(.55f, .50f, .42f) * l.Fill : authoredFill;
            }
            authoredFill = Ruien.I!.Data.Fill;
            Scheldemist.World.Tide.Hold(-4.95f);
            await SetLight(Lights[1]);
            var j = Jef.I!; if (j.Fly) j.ToggleFly(); j.Frozen = false; j.Drive = null;
            var actor = new AntigoonActor { Name = "AntigoonBridgeWitness", TownLighting = true }; game.View.AddChild(actor);
            actor.Snapshot(new Vector3(0, -40, 0), 0, "idle", 0, 0, false);
            var space = game.View.FindWorld3D().DirectSpaceState;
            var camera = new Camera3D { Name = "BridgeProofCamera", Near = .05f, Far = 400, Fov = 62 };
            camera.CullMask &= ~Scheldemist.Player.Arms.BodyLayer;
            game.View.AddChild(camera);
            async Task Shot(string name, JsonElement view)
            {
                var keep = game.View.GetCamera3D();
                camera.Fov = view.TryGetProperty("fov", out var fv) ? fv.GetSingle() : 62;
                camera.GlobalPosition = V3(view.GetProperty("at")); camera.LookAt(V3(view.GetProperty("look")));
                camera.Current = true;
                var huds = game.GetTree().Root.FindChildren("*", "CanvasLayer", true, false).OfType<CanvasLayer>().Where(c => c.Visible).ToList();
                foreach (var h in huds) h.Visible = false;
                await Frames(40);
                await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, name + ".png"));
                foreach (var h in huds) h.Visible = true;
                camera.Current = false; keep?.MakeCurrent();
            }
            async Task Views(string tag, JsonElement b)
            {
                foreach (var l in Lights)
                {
                    await SetLight(l);
                    foreach (var v in b.GetProperty("views").EnumerateArray()) await Shot($"{v.GetProperty("name").GetString()}-{tag}-{l.Name}", v);
                }
                await SetLight(Lights[1]);
            }
            async Task<bool> WalkTo(Vector2 target, string name, float y, float tol = .06f, bool expect = true)
            {
                ulong until = Time.GetTicksMsec() + 20000; float low = j.Y, high = j.Y;
                while (new Vector2(j.X, j.Z).DistanceTo(target) > .1f && Time.GetTicksMsec() < until && !j.Swimming)
                {
                    var d = target - new Vector2(j.X, j.Z); j.Yaw = MathF.Atan2(-d.X, -d.Y); j.SetKey(Key.W, true);
                    await Frames(1);
                    if (j.Grounded) { low = MathF.Min(low, j.Y); high = MathF.Max(high, j.Y); }
                }
                j.ClearKeys(); await Seconds(.3f);
                bool ok = new Vector2(j.X, j.Z).DistanceTo(target) < .2f && j.Grounded && !j.Swimming && low > y - tol && high < y + .04f + tol;
                if (expect) Check(name, ok, $"at {j.X:0.00},{j.Y:0.000},{j.Z:0.00}, feet {low:0.000} to {high:0.000}: {j.LastShove}");
                return ok;
            }
            async Task<JsonElement> Server() => await api.Get<JsonElement>("api/ruien/bridges");
            foreach (var b in spec.GetProperty("bridges").EnumerateArray())
            {
                string id = b.GetProperty("id").GetString()!;
                if (!RuienFoldBridge.All.TryGetValue(id, out var bridge)) { Check(id + " is built", false, "no such bridge"); continue; }
                Check(id + " is built from the area's markers", true, $"span {bridge.Span:0.000} m, leaves {bridge.LeafLength:0.000} m");
                float walkY = b.GetProperty("walkY").GetSingle(), deckY = walkY + bridge.Kit.DeckAbove;
                var bodies = new Godot.Collections.Array<Rid>(bridge.FindChildren("*", "StaticBody3D", true, false).OfType<StaticBody3D>().Select(s => s.GetRid()));
                bodies.Add(actor.BodyRid);
                var frame = bridge.GlobalTransform;
                Vector3 OnSpan(float t, float s = 0, float y = 0) => frame * new Vector3(t, y, s);
                // --- the kit model: metric UVs on every face, closed meshes, the shared materials, its size
                string meshes = Path.Combine(output, id + "-meshes"); Directory.CreateDirectory(meshes);
                int k = 0, tris = 0, open = 0; var mats = new HashSet<string>();
                foreach (var mi in bridge.FindChildren("*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
                {
                    var m = (ArrayMesh)mi.Mesh; tris += m.GetFaces().Length / 3;
                    mats.Add(m.SurfaceGetMaterial(0)?.ResourceName ?? m.SurfaceGetName(0) ?? "none");
                    open += OpenEdges(m.GetFaces());
                    ResourceSaver.Save(m, Path.Combine(meshes, $"mesh_{k++}.res"));
                }
                RuienUv.Audit(meshes, Path.Combine(output, id + "-uv.json"));
                double bad = JsonDocument.Parse(File.ReadAllText(Path.Combine(output, id + "-uv.json"))).RootElement.EnumerateArray().Sum(a => a.GetProperty("badArea").GetDouble());
                Check(id + " kit: metric UVs, no stretched faces", bad < .0001, $"stretched {bad:0.000000} m2 over {k} meshes");
                Check(id + " kit: closed meshes (no see-through faces)", open == 0, $"{open} open edges, {tris} triangles");
                Check(id + " kit: shared Ruien materials only", mats.All(n => n.StartsWith("ruien_iron") || n.StartsWith("ruien_bluestone")), string.Join(",", mats));
                // --- rest: down; the deck is solid where it looks solid
                ulong until = Time.GetTicksMsec() + 15000;
                while (!bridge.Known && Time.GetTicksMsec() < until) await Frames(1);
                Check(id + " rests down", bridge.Known && bridge.Phase == 0, $"phase {bridge.Phase}");
                float DeckHit(float t)
                {
                    var p = OnSpan(t, .1f);
                    var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(p + Vector3.Up * .8f, p + Vector3.Down * 1.4f, Scheldemist.World.Solid.Layer));
                    return hit.Count > 0 ? hit["position"].AsVector3().Y : float.NegativeInfinity;
                }
                float tA = bridge.Span * .25f;
                Check(id + " deck solid when down", MathF.Abs(DeckHit(tA) - deckY) < .012f && MathF.Abs(DeckHit(bridge.Span * .75f) - deckY) < .012f, $"hit {DeckHit(tA):0.000} / {DeckHit(bridge.Span * .75f):0.000}, deck {deckY:0.000}");
                var wait = V2(b.GetProperty("wait"));
                j.Place(wait.X, wait.Y, 0, 0, walkY + .05f); await Seconds(1);
                await Views("down", b);
                // --- Jef crosses
                var cross = b.GetProperty("cross").EnumerateArray().Select(V2).ToArray();
                async Task Cross(string tag)
                {
                    var d0 = cross[1] - cross[0]; j.Place(cross[0].X, cross[0].Y, MathF.Atan2(-d0.X, -d0.Y), 0, walkY + .05f); await Seconds(1);
                    for (int i = 1; i < cross.Length; i++) await WalkTo(cross[i], $"{id} Jef crosses {tag}, point {i}", walkY, .05f);
                }
                await Cross("down");
                // --- Jef stands on leaf A: the giant comes, waits short of the mouth; the leaf waits for Jef
                var stand = V2(b.GetProperty("stand"));
                j.Place(stand.X, stand.Y, 0, 0, deckY + .05f); await Seconds(1);
                Check(id + " Jef stands on leaf A", j.Grounded && MathF.Abs(j.Y - deckY) < .02f, $"feet {j.Y:0.000}");
                object Path3(string key) => new { path = b.GetProperty(key).EnumerateArray().Select(p => new[] { p[0].GetDouble(), p[1].GetDouble(), p[2].GetDouble() }).ToArray(), speed = b.GetProperty("giantSpeed").GetDouble() };
                await api.Post<JsonElement>("api/dev/ruien/giant", Path3("giantIn"));
                // the witness model follows the server's giant on the bed below it
                bool follow = true;
                (float y, bool built) Bed(Vector3 g)
                {
                    var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(g.X, g.Y + 1.0f, g.Z), new Vector3(g.X, g.Y - 1.5f, g.Z), Scheldemist.World.Solid.Layer, bodies));
                    return hit.Count > 0 ? (hit["position"].AsVector3().Y, true) : (g.Y, false);
                }
                var blocked = new List<string>(); var touched = new List<string>(); int samples = 0;
                async void Follow()
                {
                    while (follow)
                    {
                        if (RuienFoldBridge.Giants.FirstOrDefault(x => x.id == "proof") is { id: "proof" } g)
                        {
                            var (bed, built) = Bed(g.at); var feet = new Vector3(g.at.X, bed, g.at.Z);
                            actor.Snapshot(feet, g.yaw, g.waiting ? "idle" : "walk", Time.GetTicksMsec() / 1000.0, 0, true); actor.GlobalPosition = feet; actor.Rotation = new Vector3(0, g.yaw, 0);
                            // the upright envelope wherever a bed is built (the unbuilt rui beyond the export is skipped)
                            if (built)
                            {
                                // the 1d route checks' upright envelope: 3.86 m by 0.464 m, its foot 1 cm over the bed
                                var q = new PhysicsShapeQueryParameters3D { Shape = new CapsuleShape3D { Height = 3.86f, Radius = .464f },
                                    Transform = new Transform3D(Basis.Identity, feet + Vector3.Up * 1.94f), CollisionMask = Scheldemist.World.Solid.Layer, Exclude = new Godot.Collections.Array<Rid> { actor.BodyRid }, Margin = 0 };
                                var hits = space.IntersectShape(q);
                                samples++;
                                foreach (var h in hits.Where(OfBridge)) if (touched.Count < 40) touched.Add($"{feet.X:0.00},{feet.Z:0.00} {(h["collider"].AsGodotObject() as Node)?.Name} (phase {bridge.Phase:0.00})");
                                // the area: only what his body meets above his step (he steps up giant steps and sills)
                                var body = new PhysicsShapeQueryParameters3D { Shape = new CapsuleShape3D { Height = 3.86f - AntigoonSize.Step, Radius = .464f },
                                    Transform = new Transform3D(Basis.Identity, feet + Vector3.Up * (AntigoonSize.Step + (3.86f - AntigoonSize.Step) / 2)), CollisionMask = Scheldemist.World.Solid.Layer, Exclude = new Godot.Collections.Array<Rid> { actor.BodyRid }, Margin = 0 };
                                if (space.IntersectShape(body).Any(h => !OfBridge(h)))
                                {
                                    q = body;
                                    var rest = space.GetRestInfo(q);
                                    string at = rest.Count > 0 ? $" touching {rest["point"].AsVector3().X:0.00},{rest["point"].AsVector3().Y:0.00},{rest["point"].AsVector3().Z:0.00}" : "";
                                    string key = $"{feet.X:0.0},{feet.Z:0.0}";
                                    if (!blocked.Any(x => x.StartsWith(key + " "))) blocked.Add($"{key} bed {feet.Y:0.00} {(hits[0]["collider"].AsGodotObject() as Node)?.Name}{at} (phase {bridge.Phase:0.00})");
                                }
                            }
                        }
                        await game.ToSignal(game.GetTree(), SceneTree.SignalName.PhysicsFrame);
                    }
                }
                Follow();
                until = Time.GetTicksMsec() + 60000;
                JsonElement st = await Server();
                bool Waiting(JsonElement s) => s.GetProperty("giants").EnumerateArray().Any(g => g.GetProperty("waiting").GetBoolean());
                while (!(Waiting(st) && bridge.Held) && Time.GetTicksMsec() < until) { await Seconds(.25f); st = await Server(); }
                await Seconds(3); st = await Server();
                Check(id + " leaf waits while Jef stands on it", bridge.Held && bridge.Phase == 0 && bridge.Raising, $"phase {bridge.Phase}, held {bridge.Held}, raising {bridge.Raising}");
                Check(id + " Antigoon waits short of the mouth", Waiting(st), st.GetProperty("giants").ToString());
                // Jef steps off to the waiting place: the leaves rise; collision follows the leaf part way up
                foreach (var o in b.GetProperty("off").EnumerateArray().Select(V2)) await WalkTo(o, id + " Jef steps off the leaf to " + o, walkY, .05f);
                await WalkTo(wait, id + " Jef waits clear of the sweep", walkY, .05f);
                until = Time.GetTicksMsec() + 30000;
                while (bridge.Phase < .45f && Time.GetTicksMsec() < until) await Frames(1);
                {
                    float angle = bridge.Angle, tt = .8f;
                    // a deck point 0.8 m out from hinge A, turned with the leaf
                    var local = new Basis(Vector3.Back, angle) * new Vector3(tt, RuienFoldBridge.AxisDrop, .1f) + new Vector3(0, -RuienFoldBridge.AxisDrop, 0);
                    var p = frame * local;
                    var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(p + Vector3.Up * .6f, p + Vector3.Down * .6f, Scheldemist.World.Solid.Layer));
                    float y = hit.Count > 0 ? hit["position"].AsVector3().Y : float.NaN;
                    Check(id + " collision follows the leaf part way up", hit.Count > 0 && MathF.Abs(y - p.Y) < .04f, $"phase {bridge.Phase:0.00}, angle {Mathf.RadToDeg(angle):0.0} deg, deck point y {p.Y:0.000}, hit {y:0.000}");
                    Check(id + " leaves rise once Jef is off", !bridge.Held && bridge.Phase > 0, $"phase {bridge.Phase:0.00}");
                }
                until = Time.GetTicksMsec() + (ulong)(bridge.Kit.RaiseSeconds * 1000 + 6000);
                while (bridge.Phase < 1 && Time.GetTicksMsec() < until) await Frames(1);
                Check(id + " both leaves stand", bridge.Phase >= 1, $"phase {bridge.Phase:0.00}");
                Check(id + " deck open over the channel when up", DeckHit(tA) < deckY - .5f && DeckHit(bridge.Span * .75f) < deckY - .5f, $"hits {DeckHit(tA):0.00} / {DeckHit(bridge.Span * .75f):0.00}");
                {
                    // a raised leaf stands across the walk at its hinge; Jef walking at it is stopped on the walk
                    var from = OnSpan(-.9f, 0, .8f); var to = OnSpan(.5f, 0, .8f);
                    var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(from, to, Scheldemist.World.Solid.Layer));
                    float at = hit.Count > 0 ? (frame.AffineInverse() * hit["position"].AsVector3()).X : float.NaN;
                    Check(id + " raised leaf A stands across the walk at its hinge", hit.Count > 0 && at > -.2f && at < .1f, $"hit at {at:0.000} m from the hinge");
                    var push = b.GetProperty("push"); var pf = V2(push.GetProperty("from")); var pt = V2(push.GetProperty("to"));
                    j.Place(pf.X, pf.Y, MathF.Atan2(-(pt - pf).X, -(pt - pf).Y), 0, walkY + .05f); await Seconds(1);
                    var start = new Vector2(j.X, j.Z); j.SetKey(Key.W, true); await Seconds(3); j.ClearKeys(); await Seconds(.5f);
                    float reached = (frame.AffineInverse() * new Vector3(j.X, j.Y, j.Z)).X;
                    Check(id + " Jef cannot walk onto a raised leaf", j.Grounded && !j.Swimming && MathF.Abs(j.Y - walkY) < .06f && reached < -.15f, $"stopped {reached:0.00} m before hinge A, feet {j.Y:0.000}");
                    await WalkTo(wait, id + " Jef back to the waiting place", walkY, .06f);
                }
                Check(id + " raised leaves clear the masonry", Clear(space, bridge, bodies, out var touch), touch);
                // the giant comes through: wait until he reaches the mouth, pictures with him in it, then on and away
                until = Time.GetTicksMsec() + 90000; st = await Server();
                while (!st.GetProperty("giants")[0].GetProperty("done").GetBoolean() && Time.GetTicksMsec() < until) { await Seconds(.25f); st = await Server(); }
                Check(id + " Antigoon reaches the mouth with both leaves up", st.GetProperty("giants")[0].GetProperty("done").GetBoolean() && bridge.Phase >= 1, st.GetProperty("giants").ToString());
                foreach (var g in b.GetProperty("giantChecks").EnumerateArray())
                {
                    var at = V2(g.GetProperty("at"));
                    var floor = space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(at.X, walkY - .25f, at.Y), new Vector3(at.X, walkY - 3.5f, at.Y), Scheldemist.World.Solid.Layer, bodies));
                    float bed = floor.Count > 0 ? floor["position"].AsVector3().Y : -9;
                    var hits = space.IntersectShape(new PhysicsShapeQueryParameters3D { Shape = new CapsuleShape3D { Height = 3.86f, Radius = .464f }, Transform = new Transform3D(Basis.Identity, new Vector3(at.X, bed + 1.94f, at.Y)), CollisionMask = Scheldemist.World.Solid.Layer, Exclude = new Godot.Collections.Array<Rid> { actor.BodyRid }, Margin = 0 });
                    var up = space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(at.X, bed + .2f, at.Y), new Vector3(at.X, 0, at.Y), Scheldemist.World.Solid.Layer, new Godot.Collections.Array<Rid> { actor.BodyRid }));
                    float head = up.Count > 0 ? up["position"].AsVector3().Y - (bed + 3.86f) : 99;
                    string what = $"bed {bed:0.000}, clearance over the head {head:0.000} m, {string.Join(",", hits.Select(h => (h["collider"].AsGodotObject() as Node)?.Name.ToString()).Distinct())}";
                    Check($"{id} giant at {g.GetProperty("name").GetString()} clear of the raised leaves", bed > walkY - 3.2f && !hits.Any(OfBridge), what);
                    if (b.TryGetProperty("giantStrict", out var strict) && strict.GetBoolean()) Check($"{id} giant upright at {g.GetProperty("name").GetString()} (leaves up)", hits.Count == 0, what);
                    else Find($"{id} giant upright at {g.GetProperty("name").GetString()} (leaves up)", hits.Count == 0, what);
                }
                await Seconds(1.5f);
                await Views("up", b);
                await api.Post<JsonElement>("api/dev/ruien/giant", Path3("giantOut"));
                until = Time.GetTicksMsec() + 120000; st = await Server();
                while (!st.GetProperty("giants")[0].GetProperty("done").GetBoolean() && Time.GetTicksMsec() < until) { await Seconds(.25f); st = await Server(); }
                Check(id + " Antigoon passes the leaves without touching them", touched.Count == 0 && samples > 20, $"{samples} samples; {touched.Count} contacts {string.Join("; ", touched.Take(8))}");
                Find(id + " Antigoon's body above his step on the route", blocked.Count == 0, $"{samples} samples; blocked at {blocked.Count} places: {string.Join("; ", blocked.Take(12))}");
                until = Time.GetTicksMsec() + (ulong)(bridge.Kit.RaiseSeconds * 1000 + 8000);
                while (bridge.Phase > 0 && Time.GetTicksMsec() < until) await Frames(1);
                Check(id + " leaves come down after he has passed", bridge.Phase <= 0, $"phase {bridge.Phase:0.00}");
                follow = false; await Frames(2);
                await api.Post<JsonElement>("api/dev/ruien/giant", new { path = Array.Empty<double[]>() });
                actor.Snapshot(new Vector3(0, -40, 0), 0, "idle", 0, 0, false);
                await Seconds(.5f);
                Check(id + " deck solid again", MathF.Abs(DeckHit(tA) - deckY) < .012f, $"hit {DeckHit(tA):0.000}");
                await Cross("again");
                // part way: the drawn phase held at a half for pictures (collision turns with it)
                j.Place(wait.X, wait.Y, 0, 0, walkY + .05f); await Seconds(.5f);
                RuienFoldBridge.ProofPhase = .5f; await Frames(4);
                Check(id + " half-raised leaves clear the masonry", Clear(space, bridge, bodies, out var touch2), touch2);
                await Views("mid", b);
                RuienFoldBridge.ProofPhase = null; await Seconds(.5f);
                // frame cost: the bridge shown and hidden in turn at its first view, midday
                var v0 = b.GetProperty("views")[0];
                camera.GlobalPosition = V3(v0.GetProperty("at")); camera.LookAt(V3(v0.GetProperty("look"))); camera.Current = true;
                var cost = new List<object>();
                for (int round = 0; round < 3; round++)
                    foreach (bool shown in new[] { true, false })
                    {
                        bridge.Visible = shown; await Frames(30);
                        var ms = new List<double>(); var calls = new List<long>();
                        for (int f = 0; f < 120; f++)
                        {
                            ulong t0 = Time.GetTicksUsec(); await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                            ms.Add((Time.GetTicksUsec() - t0) / 1000.0); calls.Add((long)RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame));
                        }
                        ms.Sort();
                        cost.Add(new { round, shown, medianMs = ms[ms.Count / 2], p95Ms = ms[(int)(ms.Count * .95)], drawCalls = calls.Average() });
                    }
                bridge.Visible = true; camera.Current = false;
                File.WriteAllText(Path.Combine(output, id + "-cost.json"), JsonSerializer.Serialize(new { view = v0.GetProperty("name").GetString(), triangles = tris, cost }, new JsonSerializerOptions { WriteIndented = true }));
            }
            File.WriteAllText(Path.Combine(output, "bridges.json"), JsonSerializer.Serialize(checks, new JsonSerializerOptions { WriteIndented = true }));
            File.WriteAllText(Path.Combine(output, "area-findings.json"), JsonSerializer.Serialize(findings, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"RUIEN_BRIDGE done: {checks.Count - failures}/{checks.Count} passed; {findings.Count(f => !(bool)f.GetType().GetProperty("clear")!.GetValue(f)!)} area findings");
            actor.QueueFree();
            game.GetTree().Quit(failures == 0 ? 0 : 2);
        }
        catch (Exception e)
        {
            File.WriteAllText(Path.Combine(output, "failure.txt"), e.ToString()); GD.PrintErr(e);
            File.WriteAllText(Path.Combine(output, "bridges.json"), JsonSerializer.Serialize(checks, new JsonSerializerOptions { WriteIndented = true }));
            game.GetTree().Quit(1);
        }
    }
    private static Color authoredFill;
    private static Vector3 V3(JsonElement e) => new(e[0].GetSingle(), e[1].GetSingle(), e[2].GetSingle());
    private static Vector2 V2(JsonElement e) => new(e[0].GetSingle(), e[1].GetSingle());

    /// <summary>Edges used an odd number of times (after welding positions to 0.05 mm): open, see-through seams.</summary>
    private static int OpenEdges(Vector3[] f)
    {
        var count = new Dictionary<(long, long, long, long, long, long), int>();
        (long, long, long) Q(Vector3 p) => ((long)MathF.Round(p.X * 20000), (long)MathF.Round(p.Y * 20000), (long)MathF.Round(p.Z * 20000));
        for (int i = 0; i + 2 < f.Length; i += 3)
            for (int e = 0; e < 3; e++)
            {
                var a = Q(f[i + e]); var b = Q(f[i + (e + 1) % 3]);
                if (a == b) continue;
                var key = a.CompareTo(b) < 0 ? (a.Item1, a.Item2, a.Item3, b.Item1, b.Item2, b.Item3) : (b.Item1, b.Item2, b.Item3, a.Item1, a.Item2, a.Item3);
                count[key] = count.GetValueOrDefault(key) + 1;
            }
        return count.Values.Count(c => c % 2 == 1);
    }

    /// <summary>The leaves' solid envelope (deck and girders, both rail slabs) at their drawn angle, shrunk 5 mm,
    /// tested against every other solid: a standing or turning leaf must not pass into the vault, a wall or a coping.</summary>
    private static bool Clear(PhysicsDirectSpaceState3D space, RuienFoldBridge bridge, Godot.Collections.Array<Rid> own, out string detail)
    {
        var hits = new List<string>();
        float L = bridge.LeafLength;
        foreach (var leaf in new[] { "leaf_a", "leaf_b" })
        {
            var hinge = bridge.GetNode<Node3D>(leaf);
            var boxes = new (Vector3 c, Vector3 s)[] {
                (new Vector3((.03f + L) / 2, RuienFoldBridge.AxisDrop - .015f, 0), new Vector3(L - .04f, .02f, .72f)),
                (new Vector3((RuienFoldBridge.Heel + L) / 2, RuienFoldBridge.AxisDrop - .11f, 0), new Vector3(L - RuienFoldBridge.Heel - .02f, .18f, .64f)),
                (new Vector3((.09f + L - .03f) / 2, RuienFoldBridge.AxisDrop + .55f, bridge.Kit.RailHalf), new Vector3(L - .13f, 1.08f, .03f)),
                (new Vector3((.09f + L - .03f) / 2, RuienFoldBridge.AxisDrop + .55f, -bridge.Kit.RailHalf), new Vector3(L - .13f, 1.08f, .03f)) };
            string[] names = { "deck", "girders", "rail +z", "rail -z" };
            for (int i = 0; i < boxes.Length; i++)
            {
                var (c, s) = boxes[i];
                var q = new PhysicsShapeQueryParameters3D { Shape = new BoxShape3D { Size = s - Vector3.One * .01f }, Transform = hinge.GlobalTransform * new Transform3D(Basis.Identity, c), CollisionMask = Scheldemist.World.Solid.Layer, Exclude = own, Margin = 0 };
                var r = space.IntersectShape(q);
                if (r.Count == 0) continue;
                var rest = space.GetRestInfo(q);
                hits.Add($"{leaf} {names[i]} {(r[0]["collider"].AsGodotObject() as Node)?.Name}" + (rest.Count > 0 ? $" at {rest["point"].AsVector3().X:0.00},{rest["point"].AsVector3().Y:0.00},{rest["point"].AsVector3().Z:0.00}" : ""));
            }
        }
        detail = hits.Count == 0 ? $"phase {bridge.Phase:0.00}: no contact" : string.Join("; ", hits.Distinct().Take(8));
        return hits.Count == 0;
    }
}
