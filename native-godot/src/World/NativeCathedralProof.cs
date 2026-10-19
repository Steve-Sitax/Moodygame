using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
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
/// `--cathedral-proof &lt;dir&gt;` (#198): the cathedral's furniture in the real town. `--cathedral-only a,b` picks stages:
/// `survey` (every drawn triangle round each confessional, side altar and the pulpit, by mesh, as OBJ files with a list),
/// `pictures` (close pictures of each piece by day, in rain and at night). Writes cathedral.json; exit 1 on a failed check.
/// </summary>
public static class NativeCathedralProof
{
    /// <summary>The pieces (world boxes, x0 x1 y0 y1 z0 z1) and where they are looked at from.</summary>
    public static readonly (string Name, float[] Box, Vector3 Eye, Vector3 At)[] Pieces =
    {
        ("confessional-e186", new[] { -239.6f, -236.5f, 0f, 5.2f, 183.6f, 188.6f }, new(-243.6f, 2.1f, 187.4f), new(-237.6f, 2.2f, 186.08f)),
        ("confessional-e168", new[] { -239.6f, -236.5f, 0f, 5.2f, 165.4f, 171.2f }, new(-243.2f, 2.0f, 169.6f), new(-237.8f, 2.0f, 168.25f)),
        ("confessional-w177", new[] { -287.6f, -284.4f, 0f, 5.2f, 174.2f, 180.0f }, new(-280.8f, 2.0f, 175.8f), new(-286.2f, 2.0f, 177.16f)),
        ("altar-e177", new[] { -239.6f, -236.2f, 0f, 7.4f, 173.4f, 181.0f }, new(-243.0f, 2.6f, 177.16f), new(-237.3f, 3.2f, 177.16f)),
        ("altar-w186", new[] { -288.0f, -284.5f, 0f, 7.4f, 182.2f, 190.0f }, new(-281.0f, 2.6f, 186.08f), new(-286.7f, 3.2f, 186.08f)),
        ("altar-w168", new[] { -288.0f, -284.5f, 0f, 7.4f, 164.4f, 172.2f }, new(-281.0f, 2.6f, 168.25f), new(-286.7f, 3.2f, 168.25f)),
        ("pulpit", new[] { -269.6f, -263.8f, 0f, 9.6f, 182.4f, 188.6f }, new(-259.8f, 3.4f, 181.4f), new(-266.6f, 3.8f, 185.6f)),
    };
    /// <summary>Close looks: carving, mouldings, the stair, the night lamps (eye, target).</summary>
    public static readonly (string Name, Vector3 Eye, Vector3 At)[] Close =
    {
        ("confessional-e186-crest", new(-240.2f, 3.6f, 186.6f), new(-237.9f, 3.7f, 186.08f)),
        ("confessional-e186-bay", new(-239.6f, 1.5f, 186.9f), new(-237.6f, 1.2f, 186.0f)),
        ("confessional-e186-pilaster", new(-239.0f, 1.8f, 185.8f), new(-238.3f, 1.6f, 185.5f)),
        ("confessional-e186-end", new(-239.7f, 1.6f, 183.2f), new(-237.6f, 1.5f, 184.6f)),
        ("confessional-e186-low", new(-239.2f, 0.45f, 187.9f), new(-238.2f, 0.25f, 186.9f)),
        ("altar-e177-frame", new(-238.9f, 3.0f, 176.3f), new(-237.2f, 3.4f, 176.2f)),
        ("altar-e177-candles", new(-238.7f, 1.9f, 177.6f), new(-237.4f, 1.65f, 177.16f)),
        ("altar-e177-capital", new(-238.4f, 4.9f, 176.4f), new(-237.3f, 5.0f, 175.76f)),
        ("altar-e177-crown", new(-239.0f, 5.9f, 177.6f), new(-237.4f, 6.0f, 177.16f)),
        ("altar-e177-saint", new(-239.0f, 2.2f, 175.8f), new(-237.4f, 2.0f, 175.06f)),
        ("pulpit-tub", new(-263.8f, 3.6f, 185.0f), new(-266.6f, 3.3f, 186.1f)),
        ("pulpit-stair", new(-272.0f, 2.2f, 181.6f), new(-268.8f, 1.7f, 184.4f)),
        ("pulpit-landing", new(-264.6f, 3.9f, 182.6f), new(-266.9f, 3.2f, 184.6f)),
        ("pulpit-foot", new(-264.2f, 1.2f, 187.6f), new(-266.6f, 1.4f, 186.1f)),
        ("pulpit-board", new(-263.6f, 5.4f, 187.0f), new(-266.6f, 6.4f, 186.1f)),
        ("lamp-east", new(-239.8f, 2.6f, 180.8f), new(-237.6f, 2.8f, 182.0f)),
        ("lamp-west", new(-284.2f, 2.6f, 180.0f), new(-286.4f, 2.8f, 181.3f)),
        ("aisle-east", new(-240.2f, 1.8f, 160.5f), new(-238.0f, 1.8f, 190.0f)),
    };

    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output); string? error = null; var checks = new List<object>(); var facts = new Dictionary<string, object>();
        void Check(bool pass, string name) { checks.Add(new { name, pass }); GD.Print($"cathedral: {(pass ? "PASS" : "FAIL")} {name}"); }
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Wait(Func<bool> ok, int seconds) { var until = DateTime.UtcNow.AddSeconds(seconds); while (!ok()) { if (DateTime.UtcNow > until) throw new TimeoutException("cathedral wait"); await Frames(1); } }
        async Task Shot(string name, Vector3 eye, Vector3 target)
        {
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            game.Cam.GlobalPosition = eye; var q = new Transform3D(Basis.Identity, eye).LookingAt(target).Basis.GetRotationQuaternion();
            if (game.Cam is FlyCam fly) fly.Face(q); else game.Cam.Quaternion = q;
            await Frames(25); await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            using var image = game.GetViewport().GetTexture().GetImage(); image.SavePng(Path.Combine(output, name + ".png"));
        }
        string only = Main.I.Arg("cathedral-only"); bool Stage(string s) => only == "" || only.Split(',').Contains(s);
        string F(float v) => v.ToString("0.###", CultureInfo.InvariantCulture);
        try
        {
            Engine.MaxFps = 30; await Wait(() => game.Loaded && ServerLink.I?.Up == true && GameState.I.Live && !Scheldemist.Menu.Loading.Busy, 200);
            Jef.I.TestInput = true; var api = ServerLink.I!.Api!; var people = game.GetNode<Townspeople>("Townspeople"); await Wait(() => people.Data != null, 60);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle();
            Doors.I.Held = true; foreach (var d in Doors.I.All) Doors.I.Force(d, true);
            if (Jef.I.Fly) Jef.I.ToggleFly();
            Jef.I.Place(-262f, 175f, 0, 0, .3f); await Frames(90);
            if (Stage("survey"))
            {
                // every visible mesh's triangles whose centre lies in a piece's box, by mesh (its path from the world)
                string Names(Node n) { var chain = new List<string>(); for (Node? q = n; q != null && q != game.World; q = q.GetParent()) chain.Add(q.Name.ToString()); chain.Reverse(); return string.Join("/", chain.TakeLast(6)); }
                var meshes = BakedWorld.All(game.GetTree().Root).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.IsVisibleInTree()).Select(m => (m, box: m.GlobalTransform * m.GetAabb())).ToList();
                var survey = new Dictionary<string, object>();
                foreach (var piece in Pieces)
                {
                    var b = piece.Box; var area = new Aabb(new Vector3(b[0], b[2], b[4]), new Vector3(b[1] - b[0], b[3] - b[2], b[5] - b[4]));
                    var obj = new StringBuilder(); int v = 0; var list = new List<object>();
                    foreach (var (m, box) in meshes.Where(q => q.box.Intersects(area)))
                    {
                        var faces = m.Mesh!.GetFaces(); var xf = m.GlobalTransform; int n = 0; var group = new StringBuilder();
                        for (int i = 0; i + 2 < faces.Length; i += 3)
                        {
                            var p0 = xf * faces[i]; var p1 = xf * faces[i + 1]; var p2 = xf * faces[i + 2];
                            if (!area.HasPoint((p0 + p1 + p2) / 3)) continue;
                            foreach (var p in new[] { p0, p1, p2 }) group.Append("v ").Append(F(p.X)).Append(' ').Append(F(p.Y)).Append(' ').Append(F(p.Z)).Append('\n');
                            group.Append("f ").Append(v + 1).Append(' ').Append(v + 2).Append(' ').Append(v + 3).Append('\n'); v += 3; n++;
                        }
                        if (n == 0) continue;
                        string name = Names(m); string mat = m.Mesh.GetSurfaceCount() == 0 ? "" : m.GetActiveMaterial(0)?.ResourceName ?? m.Mesh.SurfaceGetMaterial(0)?.ResourceName ?? "";
                        obj.Append("g ").Append(name.Replace(' ', '_')).Append('\n').Append(group);
                        list.Add(new { mesh = name, material = mat, triangles = n, size = new[] { MathF.Round(box.Size.X, 2), MathF.Round(box.Size.Y, 2), MathF.Round(box.Size.Z, 2) } });
                    }
                    File.WriteAllText(Path.Combine(output, piece.Name + ".obj"), obj.ToString());
                    survey[piece.Name] = list;
                }
                // `--survey-mesh name,name`: those meshes whole (every triangle wherever it is)
                foreach (string want in Main.I.Arg("survey-mesh").Split(',', StringSplitOptions.RemoveEmptyEntries))
                    foreach (var (m, box) in meshes.Where(q => q.m.Name == want))
                    {
                        var obj = new StringBuilder(); var faces = m.Mesh!.GetFaces(); var xf = m.GlobalTransform;
                        for (int i = 0; i < faces.Length; i++) { var p = xf * faces[i]; obj.Append("v ").Append(F(p.X)).Append(' ').Append(F(p.Y)).Append(' ').Append(F(p.Z)).Append('\n'); }
                        for (int i = 0; i + 2 < faces.Length; i += 3) obj.Append("f ").Append(i + 1).Append(' ').Append(i + 2).Append(' ').Append(i + 3).Append('\n');
                        File.WriteAllText(Path.Combine(output, "mesh-" + want + ".obj"), "g " + Names(m) + "\n" + obj);
                        survey["mesh-" + want] = new { mesh = Names(m), triangles = faces.Length / 3, index = m.HasMeta("source_node_index") ? m.GetMeta("source_node_index").AsInt32() : -1, parentIndex = m.GetParent()?.HasMeta("source_node_index") == true ? m.GetParent().GetMeta("source_node_index").AsInt32() : -1 };
                    }
                facts["survey"] = survey;
                Check(survey.Count >= Pieces.Length, "every piece surveyed");
            }
            if (Stage("furniture"))
            {
                var visuals = BakedWorld.All(game.GetTree().Root).OfType<Native.Interiors.FurnitureVisual>().ToList();
                Native.Interiors.FurnitureVisual? Piece(string id) => visuals.FirstOrDefault(v => v.GetParent() is Node3D o && o.Name.ToString().EndsWith(id));
                // every stored part of the batch drawn, with meshes; the confessionals' and the pulpit's collision from their hulls
                var batch = Piece("room-cathedral-source-8902-4");
                var parts = batch == null ? new List<Node3D>() : batch.GetChildren().OfType<Node3D>().Where(n => n.Name.ToString().StartsWith("ModelPart")).ToList();
                int drawn = parts.Count(n => n.IsVisibleInTree() && BakedWorld.All(n).OfType<MeshInstance3D>().Any(m => m.Mesh != null && m.IsVisibleInTree()));
                int hulls = parts.Count(n => n.HasMeta(Native.Interiors.FurnitureVisual.HulledMeta));
                facts["batchParts"] = new { parts = parts.Count, drawn, hulls, wanted = batch?.ModelParts.Length ?? 0 };
                Check(batch != null && parts.Count == batch.ModelParts.Length && drawn == parts.Count, $"the cathedral batch draws all its stored parts ({drawn} of {batch?.ModelParts.Length ?? 0})");
                Check(hulls == 6, $"the five confessionals and the pulpit take their collision from their hulls ({hulls} of 6)");
                string[] small = { "8914-43", "8914-44", "8914-45", "8914-46", "8914-47", "8914-48", "8914-49", "8914-51", "8914-52", "8914-53", "8914-54", "8914-55", "8914-56",
                                   "8914-57", "8914-58", "8914-59", "8920-105", "8920-106", "8920-107", "8920-108", "8920-109", "8919-99", "8931-121" };
                var models = small.Select(id => (id, v: Piece("room-cathedral-source-" + id))).ToArray();
                var notDrawn = models.Where(m => m.v == null || m.v.KitFit != "model").Select(m => m.id).ToArray();
                Check(notDrawn.Length == 0, $"the altars' capitals, crowns, cloths and saint, the pulpit's dove and urn draw their new models ({small.Length - notDrawn.Length} of {small.Length}; not: {string.Join(", ", notDrawn)})");
                var retable = Piece("room-cathedral-source-8914-50");
                Check(retable != null && retable.GetChildren().OfType<Node3D>().Count(n => n.Name.ToString().StartsWith("ModelPart")) == 2, "the west altar's own retable draws its frame and its cross and candlesticks");
                // no coarse old geometry left where the new pieces stand: the old oak boxes, figures, gilt crests and statues
                string[] coarse = { "ct_oak", "ct_oak_d", "ct_oak_carved", "ct_red", "ct_black", "ct_statue", "ct_brass", "ct_wax", "ct_linen" };
                var left = new Dictionary<string, int>();
                var meshes = BakedWorld.All(game.GetTree().Root).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.IsVisibleInTree()).ToList();
                foreach (var piece in Pieces)
                {
                    var b = piece.Box; var area = new Aabb(new Vector3(b[0], b[2] + 0.15f, b[4]), new Vector3(b[1] - b[0], b[3] - b[2] - 0.15f, b[5] - b[4]));
                    int n = 0;
                    foreach (var m in meshes)
                    {
                        if (m.Mesh!.GetSurfaceCount() == 0) continue;
                        string mat = m.GetActiveMaterial(0)?.ResourceName ?? m.Mesh!.SurfaceGetMaterial(0)?.ResourceName ?? "";
                        if (!coarse.Contains(mat) || !(m.GlobalTransform * m.GetAabb()).Intersects(area)) continue;
                        var faces = m.Mesh!.GetFaces(); var xf = m.GlobalTransform;
                        for (int i = 0; i + 2 < faces.Length; i += 3) if (area.HasPoint(xf * ((faces[i] + faces[i + 1] + faces[i + 2]) / 3))) n++;
                    }
                    left[piece.Name] = n;
                }
                facts["coarseLeft"] = left;
                Check(left.Values.All(n => n == 0), $"no coarse old furniture is drawn where the new pieces stand ({string.Join(", ", left.Select(kv => kv.Key + " " + kv.Value))})");
                // solid where drawn: a body walked from the nave toward each confessional's ends is held by them, before the wall;
                // the middle bay is open to the confessor's chair
                var conf = new (string Name, float Z, float Front, float Dir)[] { ("e168", 168.249f, -238.325f, 1), ("e186", 186.08f, -238.325f, 1), ("e204", 203.909f, -238.325f, 1),
                                                                                   ("w177", 177.16f, -285.676f, -1), ("w195", 194.999f, -285.676f, -1) };
                var held = new List<object>(); bool solid = true;
                foreach (var c in conf)
                    foreach (float dz in new[] { -1.40f, 1.40f, 0f })
                    {
                        float z = c.Z + dz, x0 = c.Front - c.Dir * 1.6f, stop = float.NaN;
                        Solid.I.Ensure(new Vector3(c.Front, 1f, z), 4);
                        for (float t = 0; t < 2.4f; t += .04f) { float x = x0 + c.Dir * t; if (!Jef.I.BodyFree(x, .32f, z)) { stop = x; break; } }
                        held.Add(new { c.Name, dz, stop = float.IsNaN(stop) ? (float?)null : stop });
                        // the ends (their kneeling steps, figures and pilasters) hold a body before the front; the open middle bay lets it in
                        // past the front, to the back or to within reach of the confessor's chair (e186)
                        bool fine = dz != 0 ? !float.IsNaN(stop) && (c.Front - stop) * c.Dir is > .25f and < 1.0f : float.IsNaN(stop) || (stop - c.Front) * c.Dir > .1f || c.Name == "e186" && MathF.Abs(stop + 237.75f) < .75f;
                        solid &= fine;
                    }
                facts["confessionalHeld"] = held;
                Check(solid, "each confessional holds a body at its ends' fronts and lets it into its open middle bay");
                var confessor = Scheldemist.People.HallPeople.I!.WalkIn("cathedral", "confessor");
                Check(confessor.Points > 0 && confessor.StepIn < 1.6f, $"the confessor walks in from the door to his box and steps in ({confessor.Points} points, a last step of {confessor.StepIn:0.00} m)");
                var preacher = (wait: new Vector3(-267.2f, .3f, 183.48f), foot: new Vector3(-267.35f, .3f, 184.73f));
                Solid.I.Ensure(preacher.wait, 4);
                Check(Jef.I.BodyFree(preacher.wait.X, .32f, preacher.wait.Z) && Jef.I.BodyFree(preacher.foot.X, .32f, preacher.foot.Z), "the preacher's waiting place and the pulpit's foot are clear of the new stair");
                // Jef climbs the pulpit's stair with his own body from its foot to the landing behind the tub (floor 3.1 m)
                if (Jef.I.Fly) Jef.I.ToggleFly();
                Jef.I.Place(-270.65f, 184.42f, -MathF.PI / 2, 0, .3f); await Frames(30);
                float top = Jef.I.Y; Jef.I.SetKey(Key.W, true);
                var until = DateTime.UtcNow.AddSeconds(20);
                var climb = new List<float[]>();
                while (DateTime.UtcNow < until && Jef.I.X < -267.0f) { Jef.I.Yaw = -MathF.PI / 2; await Frames(1); top = MathF.Max(top, Jef.I.Y); if (climb.Count == 0 || MathF.Abs(climb[^1][0] - Jef.I.X) > .2f) climb.Add(new[] { Jef.I.X, Jef.I.Y, Jef.I.Z }); }
                GD.Print($"cathedral: pulpit climb ended at {Jef.I.X:0.00} {Jef.I.Y:0.00} {Jef.I.Z:0.00}");
                Jef.I.ClearKeys(); await Frames(10);
                facts["pulpitClimb"] = new { top, at = new[] { Jef.I.X, Jef.I.Y, Jef.I.Z }, climb };
                Check(top > 3.0f, $"Jef climbs the pulpit's stair to its landing (reached {top:0.00} m of 3.10)");
                // the night lamps: a room lamp at each lamp stand's flame, lit at night, out by day
                var stands = parts.Where(n => batch!.ModelParts[int.Parse(n.Name.ToString()[9..])].StartsWith("church/lamp_stand")).Select(n => n.GlobalTransform * new Vector3(0, 1.97f, 0)).ToArray();
                var lamps = Scheldemist.World.Rooms.ExtraLamps["cathedral"];
                Check(stands.Length == 2 && lamps.All(l => stands.Any(s => s.DistanceTo(l) < .03f)), $"the cathedral's two added lamps stand at their lamp stands' flames ({string.Join("; ", stands.Select(s => s.ToString("0.00")))})");
                float Energy(Vector3 at) => BakedWorld.All(Main.I.View).OfType<OmniLight3D>().Where(o => o.GlobalPosition.DistanceTo(at) < .05f).Sum(o => o.LightEnergy);
                float dayE = lamps.Sum(Energy);
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 22, minute = 0, weather = "clear" })); Daylight.I.Settle();
                Jef.I.Place(-262f, 175f, 0, 0, .3f); await Frames(90);
                float nightE = lamps.Sum(Energy);
                int omni = BakedWorld.All(game.GetTree().Root).OfType<OmniLight3D>().Count();
                facts["lamps"] = new { dayE, nightE, omniLights = omni };
                Check(nightE > 1f && dayE < .05f, $"the confessionals' lamps are lit at night and out by day (energy {nightE:0.00} at 22:00, {dayE:0.00} at 13:00)");
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle(); await Frames(30);
                GD.Print("cathedral: furniture stage done");
            }
            if (Stage("pictures"))
            {
                foreach (var (when, hour, weather) in new[] { ("day", 13, "clear"), ("rain", 13, "rain"), ("night", 22, "clear") })
                {
                    GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour, minute = 0, weather })); Daylight.I.Settle(); await Frames(60);
                    foreach (var piece in Pieces) await Shot($"{piece.Name}-{when}", piece.Eye, piece.At);
                    foreach (var look in Close) await Shot($"{look.Name}-{when}", look.Eye, look.At);
                }
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" })); Daylight.I.Settle();
            }
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr(e); }
        bool ok = error == null && checks.All(c => (bool)c.GetType().GetProperty("pass")!.GetValue(c)!);
        File.WriteAllText(Path.Combine(output, "cathedral.json"), JsonSerializer.Serialize(new { ok, error, checks, facts }, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"cathedral: {(ok ? "PASS" : "FAIL")} {Path.Combine(output, "cathedral.json")}");
        game.GetTree().Quit(ok ? 0 : 1);
    }
}
