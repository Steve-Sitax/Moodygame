using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Rendered street/boat washing, weather transitions and restored clothes, using a disposable real town.</summary>
public static partial class NativeWashingProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output); string? error = null; int failures = 0; var checks = new List<object>(); var facts = new List<object>();
        void Check(bool pass, string name) { if (!pass) failures++; checks.Add(new { pass, name }); GD.Print($"washing: {(pass ? "PASS" : "FAIL")} {name}"); }
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Shot(string name, Vector3 eye, Vector3 at)
        {
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            game.Cam.GlobalPosition = eye;
            var q = new Transform3D(Basis.Identity, eye).LookingAt(at).Basis.GetRotationQuaternion();
            if (game.Cam is FlyCam fly) fly.Face(q); else game.Cam.Quaternion = q;
            await Frames(30); await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            using var image = game.GetViewport().GetTexture().GetImage(); image.SavePng(Path.Combine(output, name + ".png"));
        }
        Vector3 Centre(Node3D node)
        {
            if (node is MeshInstance3D mi) return mi.GlobalTransform * mi.Mesh.GetAabb().GetCenter();
            var mm = (MultiMeshInstance3D)node;
            for (int i = 0; i < mm.Multimesh.InstanceCount; i++)
            {
                var t = mm.Multimesh.GetInstanceTransform(i); if (MathF.Abs(t.Basis.Determinant()) < 1e-8f) continue;
                return mm.GlobalTransform * t * mm.Multimesh.Mesh.GetAabb().GetCenter();
            }
            return mm.GlobalPosition;
        }
        async Task BoatShot(string name, Node3D boat, float side)
        {
            for (int i = 0; i < 30; i++)
            {
                var frame = boat.GlobalTransform;
                if (boat is MultiMeshInstance3D row)
                {
                    var instance = Enumerable.Range(0, row.Multimesh.InstanceCount).Select(row.Multimesh.GetInstanceTransform)
                        .First(t => MathF.Abs(t.Basis.Determinant()) > 1e-8f);
                    frame *= instance;
                }
                Vector3 at = frame * boat.GetMeta("native_washing_first_at").AsVector3() - Vector3.Up * .35f;
                Vector3 normal = (frame.Basis * boat.GetMeta("native_washing_first_normal").AsVector3()).Normalized();
                Vector3 eye = at + normal * (2.3f * side) + Vector3.Up * .2f;
                game.Cam.GlobalPosition = eye;
                var q = new Transform3D(Basis.Identity, eye).LookingAt(at).Basis.GetRotationQuaternion();
                if (game.Cam is FlyCam fly) fly.Face(q); else game.Cam.Quaternion = q;
                await Frames(1);
            }
            await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            using var image = game.GetViewport().GetTexture().GetImage(); image.SavePng(Path.Combine(output, name + ".png"));
        }
        try
        {
            Engine.MaxFps = 30; var end = DateTime.UtcNow.AddSeconds(600);
            while (!(game.Loaded && ServerLink.I?.Up == true && GameState.I.Live && !Scheldemist.Menu.Loading.Busy))
            { if (DateTime.UtcNow > end) throw new TimeoutException("washing startup"); await Frames(1); }
            Jef.I.TestInput = true; var api = ServerLink.I!.Api!;
            Node3D[] Clothing() => BakedWorld.All(game.World).OfType<Node3D>().Where(n => n.HasMeta("native_washing")).ToArray();
            var boatMeshes = Scheldemist.Movers.Boats.I.Floats.SelectMany(f => BakedWorld.All(f.Inner).OfType<MeshInstance3D>()).Where(n => n.Mesh != null).Select(n => n.Mesh)
                .Concat(Scheldemist.Movers.Boats.I.MooredDrawn().SelectMany(b => b.Parts.Select(p => p.Mesh))).Distinct();
            facts.Add(new { boatMaterials = boatMeshes.SelectMany(m => Enumerable.Range(0, m.GetSurfaceCount()).Select(s => m.SurfaceGetMaterial(s)?.ResourceName)).Distinct().OrderBy(n => n).ToArray() });
            foreach (var (name, hour, weather, expected) in new[] { ("day", 13, "clear", true), ("rain", 13, "rain", false), ("night", 22, "clear", false), ("restored", 13, "clear", true) })
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour, minute = 0, weather }));
                Daylight.I.Settle(); await Frames(45);
                var nodes = Clothing(); var boats = nodes.Where(n => n.HasMeta("native_boat_washing_pieces")).ToArray();
                var streets = nodes.Except(boats).ToArray();
                Check(streets.Length > 0 && boats.Length > 0, "street and boat cloth groups exist: " + name);
                Check(nodes.All(n => n.Visible == expected), "all washing follows weather and hour: " + name);
                facts.Add(new { name, streetGroups = streets.Length, boatGroups = boats.Length,
                    boatPieces = boats.Sum(n => n.GetMeta("native_boat_washing_pieces").AsInt32()), visible = nodes.Count(n => n.Visible) });
                await Shot("street-" + name, new Vector3(-203.5079f, 4.5f, 100.4160f), new Vector3(-204.3153f, 4.25f, 97.8183f));
                var boat = boats.FirstOrDefault(n => n.GetParent<Node3D>().IsVisibleInTree()) ?? boats.First();
                var at = Centre(boat); facts.Add(new { name = "boat-view-" + name, node = boat.GetPath().ToString(), x = at.X, y = at.Y, z = at.Z });
                await BoatShot("boat-" + name, boat, 1);
                await BoatShot("boat-back-" + name, boat, -1);
            }
            if (game.Flag("washing-motion")) await RunMotion(game, output, Check, facts);
            // Population rebuilding clears these records. They must be recreated before the
            // first route request, rather than lazily changing schedules underneath that request.
            var host = game.ServiceHost!;
            var ready = await host.WithState(_ => {
                host.Reset();
                return (Prison: host.Context.World("prison")?["standing"]?.GetValue<bool>() == true,
                    Park: host.Context.World("stadspark-dog-walkers-v1") != null);
            });
            Check(ready.Prison && ready.Park, "fresh week prepares prison and park schedules before routing");
            string before = await api.GetJson("api/town");
            var planned = api.Ways();
            await api.GetJson("api/prison"); await api.GetJson("api/park");
            string after = await api.GetJson("api/town");
            Check(before == after, "first prison and park views preserve the published town");
            var routes = await planned;
            Check(routes.Ways.Count > 0, "route plan completes across the first prison and park views");
        }
        catch (Exception e) { error = e.ToString(); GD.PushError(e.ToString()); }
        finally
        {
            bool ok = error == null && failures == 0;
            File.WriteAllText(Path.Combine(output, "washing.json"), JsonSerializer.Serialize(new { ok, error, checks, facts }, new JsonSerializerOptions { WriteIndented = true }));
            game.GetTree().Quit(ok ? 0 : 1);
        }
    }
}
