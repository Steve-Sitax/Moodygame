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
        ("choir-west", new[] { -268.2f, -265.8f, 0f, 6.0f, 228.6f, 246.3f }, new(-261.0f, 2.4f, 232.0f), new(-267.0f, 2.2f, 238.0f)),
        ("choir-east", new[] { -258.2f, -255.8f, 0f, 6.0f, 228.6f, 246.3f }, new(-263.0f, 2.4f, 232.0f), new(-257.0f, 2.2f, 238.0f)),
        ("high-altar", new[] { -268.0f, -256.0f, 0f, 15.0f, 250.8f, 256.0f }, new(-262.0f, 4.0f, 238.0f), new(-262.0f, 7.5f, 254.0f)),
        ("transept-altar-east", new[] { -243.8f, -235.6f, 0f, 11.5f, 224.0f, 227.0f }, new(-239.7f, 3.4f, 216.5f), new(-239.7f, 5.4f, 226.0f)),
        ("transept-altar-west", new[] { -288.4f, -280.2f, 0f, 11.5f, 224.0f, 227.0f }, new(-284.3f, 3.4f, 216.5f), new(-284.3f, 5.4f, 226.0f)),
        ("organ", new[] { -267.4f, -256.6f, 7.0f, 21.5f, 151.0f, 154.3f }, new(-262.0f, 9.5f, 168.0f), new(-262.0f, 13.5f, 152.5f)),
        ("epitaph-w157", new[] { -287.3f, -285.8f, 1.5f, 7.0f, 156.0f, 159.0f }, new(-282.2f, 3.6f, 157.5f), new(-286.9f, 4.2f, 157.5f)),
        ("epitaph-e157", new[] { -238.2f, -236.7f, 1.5f, 7.0f, 156.0f, 159.0f }, new(-241.8f, 3.6f, 157.5f), new(-237.1f, 4.2f, 157.5f)),
        ("pillar-w186", new[] { -273.8f, -272.6f, 3.0f, 6.0f, 185.0f, 187.2f }, new(-269.2f, 3.4f, 186.1f), new(-273.2f, 4.5f, 186.1f)),
        ("crossing-altar-east", new[] { -242.6f, -238.4f, 0f, 8.0f, 211.4f, 213.6f }, new(-240.5f, 2.6f, 206.0f), new(-240.5f, 3.6f, 212.8f)),
        ("crossing-altar-west", new[] { -286.0f, -281.0f, 0f, 8.0f, 211.4f, 213.6f }, new(-283.5f, 2.6f, 206.0f), new(-283.5f, 3.6f, 212.8f)),
        ("ambulatory-north", new[] { -273.4f, -269.2f, 0f, 7.6f, 263.4f, 267.0f }, new(-266.0f, 2.8f, 261.0f), new(-271.0f, 3.6f, 265.4f)),
        ("ambulatory-rail", new[] { -263.2f, -246.0f, 0f, 3.0f, 256.0f, 269.0f }, new(-252.0f, 2.6f, 260.0f), new(-258.0f, 1.6f, 264.0f)),
        ("choir-throne", new[] { -267.6f, -265.8f, 0f, 5.4f, 247.0f, 249.0f }, new(-262.8f, 2.4f, 246.0f), new(-266.7f, 2.2f, 247.9f)),
        ("font", new[] { -272.4f, -270.6f, 0f, 3.0f, 152.8f, 154.8f }, new(-269.0f, 2.2f, 156.6f), new(-271.5f, 1.8f, 153.8f)),
        ("doors-west", new[] { -276.0f, -272.4f, 0f, 4.0f, 150.6f, 152.0f }, new(-274.2f, 2.0f, 157.0f), new(-274.2f, 1.9f, 151.2f)),
        ("doors-north", new[] { -295.6f, -294.4f, 0f, 5.2f, 217.8f, 222.4f }, new(-289.0f, 2.4f, 220.1f), new(-295.0f, 2.4f, 220.1f)),
    };
    /// <summary>The pieces whose boxes hold no coarse old furniture any more (the rest are only looked at: the crossing's east
    /// altar keeps its Our Lady, the ambulatory's altars and the doors are not rebuilt yet).</summary>
    public static readonly HashSet<string> Replaced = new() { "confessional-e186", "confessional-e168", "confessional-w177", "altar-e177", "altar-w186", "altar-w168", "pulpit",
        "choir-west", "choir-east", "high-altar", "transept-altar-east", "transept-altar-west", "organ", "epitaph-w157", "epitaph-e157", "pillar-w186",
        "crossing-altar-west", "choir-throne", "font" };
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
        ("altar-e177-soffit-side", new(-238.1f, 4.5f, 174.5f), new(-237.3f, 4.95f, 175.8f)),
        ("altar-e177-soffit-under", new(-238.0f, 4.2f, 176.0f), new(-237.4f, 4.9f, 176.0f)),
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
        ("choir-overview", new(-262.0f, 2.6f, 225.0f), new(-262.0f, 3.2f, 240.0f)),
        ("choir-west-seats", new(-264.0f, 1.6f, 236.0f), new(-267.2f, 1.2f, 237.5f)),
        ("choir-west-canopy", new(-264.4f, 3.6f, 236.4f), new(-267.0f, 4.3f, 237.6f)),
        ("choir-west-end", new(-264.8f, 1.5f, 227.4f), new(-266.7f, 1.3f, 229.4f)),
        ("choir-east-desk", new(-259.8f, 1.2f, 233.6f), new(-256.6f, 0.9f, 232.8f)),
        ("high-altar-tabernacle", new(-262.0f, 3.3f, 248.6f), new(-262.0f, 3.0f, 252.2f)),
        ("high-altar-frame", new(-260.2f, 6.4f, 250.6f), new(-260.9f, 7.4f, 254.9f)),
        ("high-altar-top", new(-262.0f, 10.6f, 247.6f), new(-262.0f, 11.8f, 254.7f)),
        ("high-altar-saint", new(-258.6f, 3.0f, 251.4f), new(-256.9f, 3.0f, 254.6f)),
        ("transept-east-wing", new(-236.9f, 3.6f, 221.2f), new(-237.0f, 5.0f, 225.3f)),
        ("transept-east-top", new(-239.7f, 7.6f, 220.4f), new(-239.7f, 9.8f, 226.2f)),
        ("epitaph-w157-close", new(-284.4f, 3.9f, 156.6f), new(-286.8f, 3.9f, 157.5f)),
        ("pillar-w186-close", new(-270.9f, 4.3f, 185.2f), new(-273.2f, 4.5f, 186.1f)),
        ("organ-towers", new(-262.0f, 12.4f, 161.0f), new(-262.0f, 13.4f, 152.5f)),
        ("organ-loft", new(-259.4f, 9.0f, 155.4f), new(-261.2f, 10.6f, 152.9f)),
        ("organ-loft-panels", new(-266.0f, 7.0f, 158.6f), new(-265.0f, 7.2f, 155.85f)),
        ("transept-east-dressing", new(-239.7f, 2.1f, 223.0f), new(-239.7f, 1.8f, 225.9f)),
        ("transept-east-votive", new(-234.9f, 1.6f, 223.6f), new(-236.1f, 1.2f, 225.5f)),
        ("crossing-west-frame", new(-283.5f, 2.6f, 210.2f), new(-283.5f, 2.8f, 212.85f)),
        ("sanctuary-lamp", new(-260.6f, 5.6f, 246.2f), new(-262.0f, 5.4f, 247.7f)),
        ("choir-throne-close", new(-264.4f, 2.0f, 246.4f), new(-266.6f, 2.0f, 247.9f)),
        ("choir-lectern", new(-260.6f, 1.6f, 231.2f), new(-262.0f, 1.3f, 232.5f)),
        ("font-close", new(-270.0f, 2.3f, 155.4f), new(-271.5f, 2.0f, 153.8f)),
        ("choir-screen", new(-264.6f, 1.9f, 247.6f), new(-268.0f, 1.0f, 249.6f)),
        ("choir-back-aisle", new(-271.5f, 2.0f, 233.0f), new(-268.0f, 2.2f, 238.5f)),
        ("chandelier-nave", new(-259.4f, 8.6f, 177.8f), new(-262.0f, 9.8f, 181.5f)),
        ("choir-footing-low", new(-265.0f, .85f, 231.0f), new(-267.0f, .52f, 233.0f)),
        ("high-altar-base-low", new(-260.2f, 1.1f, 248.8f), new(-262.0f, 1.0f, 252.0f)),
        ("high-altar-rear-west", new(-265.0f, 5.0f, 256.2f), new(-261.0f, 5.0f, 255.2f)),
        ("high-altar-rear-east", new(-259.0f, 5.0f, 256.2f), new(-263.0f, 5.0f, 255.2f)),
        ("high-altar-rear-high", new(-262.0f, 13.0f, 256.2f), new(-262.0f, 10.0f, 254.8f)),
        ("organ-back", new(-268.0f, 12.0f, 152.2f), new(-265.0f, 12.0f, 153.2f)),
        ("epitaph-under", new(-284.9f, 2.1f, 157.5f), new(-286.5f, 3.0f, 157.5f)),
        ("communion-rail", new(-262.0f, 1.6f, 225.2f), new(-262.0f, 0.9f, 227.4f)),
        ("communion-rail-back", new(-262.0f, 1.7f, 229.1f), new(-262.0f, 1.0f, 227.43f)),
        ("communion-rail-front-low", new(-264.0f, .82f, 226.2f), new(-263.4f, 1.04f, 227.43f)),
        ("communion-rail-back-low", new(-264.0f, .85f, 228.45f), new(-263.4f, 1.05f, 227.43f)),
        ("communion-rail-west-end", new(-265.8f, 1.65f, 226.2f), new(-267f, 1.25f, 227.43f)),
        ("communion-rail-east-end", new(-258.2f, 1.65f, 226.2f), new(-257f, 1.25f, 227.43f)),
        ("communion-rail-gate-close", new(-261.25f, 1.5f, 226.3f), new(-262.0f, 1.05f, 227.43f)),
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
            if (name.StartsWith("altar-e177-capital-") && Main.I.Arg("cathedral-burst") == "yes")
                for (int i = 0; i < 6; i++)
                {
                    // Fixed camera, two actual render completions between samples; no timing measurement.
                    await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    using var frame = game.GetViewport().GetTexture().GetImage();
                    frame.SavePng(Path.Combine(output, $"{name}-burst-{i:00}.png"));
                }
        }
        string only = Main.I.Arg("cathedral-only"); bool Stage(string s) => only == "" || only.Split(',').Contains(s);
        // `--cathedral-pick a,b`: only the pieces and close looks whose names start with one of these
        string pick = Main.I.Arg("cathedral-pick"); bool Pick(string n) => pick == "" || pick.Split(',').Any(p => n.StartsWith(p));
        string F(float v) => v.ToString("0.###", CultureInfo.InvariantCulture);
        try
        {
            if (!int.TryParse(Main.I.Arg("check-timeout-seconds", "200"), out int startupSeconds) || startupSeconds is < 30 or > 900)
                throw new ArgumentException("check-timeout-seconds must be 30..900");
            Engine.MaxFps = 30;
            try { await Wait(() => game.Loaded && ServerLink.I?.Up == true && GameState.I.Live && !Scheldemist.Menu.Loading.Busy, startupSeconds); }
            catch (TimeoutException e)
            {
                throw new TimeoutException($"cathedral startup: loaded={game.Loaded}, server={ServerLink.I?.Up}, live={GameState.I?.Live}, loading={Scheldemist.Menu.Loading.Busy}, world={game.World?.GetType().Name}, stage={(game.World is NativeTown native ? native.Stage : "unassigned")}", e);
            }
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
                foreach (var piece in Pieces.Where(p => Pick(p.Name)))
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
                Check(survey.Count >= Pieces.Count(p => Pick(p.Name)), "every piece surveyed");
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
                Check(retable != null && retable.GetChildren().OfType<Node3D>().Count(n => n.Name.ToString().StartsWith("ModelPart")) == 3, "the west altar's own retable draws its frame, dressing and marble");
                int marbleParts = BakedWorld.All(game.GetTree().Root).OfType<Native.Interiors.FurnitureVisual>().Sum(v => v.ModelParts.Count(p => p.StartsWith("church/altar_marble ")));
                Check(marbleParts == 5, $"five cut marble altars draw their replacements ({marbleParts} of 5)");
                // round two: the choir stalls and the throne, the high altar's fittings and its lamp, the organ and its loft's panels, the
                // transept and crossing altars' fittings, the alms boxes, the font's cover and the lectern draw their models
                string[] round2 = { "8915-83", "8915-84", "8915-85", "8915-86", "8903-8", "8914-28", "8914-29", "8914-30", "8914-31", "8914-32", "8914-33", "8914-34",
                                    "8914-35", "8914-36", "8919-91", "8919-92", "8919-93", "8919-94", "8914-38", "8914-39", "8914-41", "8914-42", "8919-95", "8919-96",
                                    "8919-97", "8919-98", "8919-100", "8919-101", "8914-26", "8914-22", "8914-23", "8914-24", "8914-25", "8916-87", "8916-88", "8916-89",
                                    "8916-90", "8914-68", "8914-69", "8914-70", "8914-71", "8914-72", "8920-110", "8920-111", "8919-102", "8914-73", "8921-116" };
                using var planDocument = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://recovery/cathedral-198-r2.json")));
                var expectedModels = planDocument.RootElement.GetProperty("plans").EnumerateArray()
                    .Where(p => p.TryGetProperty("props", out var props) && props.TryGetProperty("ModelScene", out _))
                    .ToDictionary(p => Path.GetFileNameWithoutExtension(p.GetProperty("scene").GetString()!), p => p.GetProperty("props").GetProperty("ModelScene").GetString()!);
                bool DrawsExpected(string id)
                {
                    string key = "room-cathedral-source-" + id;
                    if (Piece(key) is not { } v || v.KitFit != "model" || !expectedModels.TryGetValue(key, out var expected) || v.ModelScene != expected) return false;
                    var model = v.GetChildren().OfType<Node3D>().FirstOrDefault(n => n.Name == expected.Split('/')[1]);
                    if (model == null || !model.Transform.IsEqualApprox(new Transform3D(new Basis(Vector3.Up, v.ModelYaw) * Basis.FromScale(Vector3.One * v.ModelScale), v.SceneOffset))) return false;
                    return BakedWorld.All(model).OfType<MeshInstance3D>().Any(m => !m.HasMeta(Native.Interiors.FurnitureVisual.HullMeta) && m.IsVisibleInTree() && m.Mesh != null && m.Mesh.GetFaces().Length > 0);
                }
                var notR2 = round2.Where(id => !DrawsExpected(id)).ToArray();
                facts["round2Models"] = round2.Select(id => new { id, expected = expectedModels.GetValueOrDefault("room-cathedral-source-" + id), drawn = DrawsExpected(id) }).ToArray();
                Check(notR2.Length == 0, $"the stalls, throne, high altar, organ, loft, transept and crossing fittings, lamp, font cover and lectern draw their models ({round2.Length - notR2.Length} of {round2.Length}; not: {string.Join(", ", notR2)})");
                string[] railModels = { "8921-113", "8921-114", "8921-115" };
                var missingRail = railModels.Where(id => !DrawsExpected(id)).ToArray();
                facts["communionRailModels"] = railModels.Select(id => new { id, expected = expectedModels.GetValueOrDefault("room-cathedral-source-" + id), drawn = DrawsExpected(id) }).ToArray();
                Check(missingRail.Length == 0, $"the two communion rail posts and closed gate draw their expected models ({railModels.Length - missingRail.Length} of {railModels.Length}; not: {string.Join(", ", missingRail)})");
                // Exact original local boxes: dressing the brass must not change the closed gate's authored support.
                var railBoxes = new (string Id, Vector3 Size, Vector3 At)[] {
                    ("8921-113", new(.05969429f, .85991853f, .06023407f), new(-1.04904175e-05f, .84995925f, -3.8146973e-06f)),
                    ("8921-114", new(.059696198f, .85991853f, .06023407f), new(-1.1444092e-05f, .84995925f, -3.8146973e-06f)),
                    ("8921-115", new(.90070534f, .04996109f, .04f), new(-1.2397766e-05f, 1.0999117f, -3.8146973e-06f)) };
                bool OriginalRailBox((string Id, Vector3 Size, Vector3 At) box)
                {
                    if (Piece("room-cathedral-source-" + box.Id) is not { GeometryCollision: false } v) return false;
                    var body = v.GetNodeOrNull<StaticBody3D>("Solid"); var shape = body?.GetNodeOrNull<CollisionShape3D>("Shape");
                    return body != null && body.Transform == Transform3D.Identity && body.CollisionLayer == Solid.Layer && body.CollisionMask == 0
                        && shape != null && !shape.Disabled && shape.Shape is BoxShape3D b && b.Size == box.Size
                        && shape.Transform == new Transform3D(Basis.Identity, box.At);
                }
                facts["communionRailSupport"] = railBoxes.Select(b => new { id = b.Id, original = OriginalRailBox(b) }).ToArray();
                Check(railBoxes.All(OriginalRailBox), "the communion posts and closed gate retain their original local collision boxes and transforms");
                // the pictures keep their paintings, in their new frames and triptychs
                string[] framed = { "8914-27", "8914-37", "8914-40", "8914-60", "8914-61", "8914-62", "8914-63", "8914-64", "8914-65", "8914-66", "8914-67" };
                var unframed = framed.Where(id => Piece("room-cathedral-source-" + id) is not { } v || v.ModelParts.Length == 0
                    || v.GetChildren().OfType<Node3D>().Count(n => n.Name.ToString().StartsWith("ModelPart") && BakedWorld.All(n).OfType<MeshInstance3D>().Any(m => m.IsVisibleInTree())) != v.ModelParts.Length
                    || !v.GetChildren().OfType<MeshInstance3D>().Any(m => m.Mesh != null && m.IsVisibleInTree())).ToArray();
                Check(unframed.Length == 0, $"the high altar's, transept altars', epitaphs' and pillars' paintings stand in their new frames ({framed.Length - unframed.Length} of {framed.Length}; not: {string.Join(", ", unframed)})");
                string[] hulled = { "8915-83", "8915-84", "8915-85", "8915-86", "8914-26" };
                bool HasHullCollision(string id)
                {
                    if (Piece("room-cathedral-source-" + id) is not { GeometryCollision: true } v) return false;
                    var body = v.GetNodeOrNull<StaticBody3D>("GeometrySolid");
                    if (body?.GetNodeOrNull<CollisionShape3D>("Shape")?.Shape is not ConcavePolygonShape3D shape || shape.GetFaces().Length == 0) return false;
                    var collision = shape.GetFaces().ToHashSet();
                    var hullMeshes = BakedWorld.All(v).OfType<MeshInstance3D>().Where(m => m.HasMeta(Native.Interiors.FurnitureVisual.HullMeta) && m.Mesh != null).ToArray();
                    if (hullMeshes.Length == 0) return false;
                    return hullMeshes.All(m => { var transform = v.GlobalTransform.AffineInverse() * m.GlobalTransform;
                        return m.Mesh!.GetFaces().All(p => collision.Contains(transform * p)); });
                }
                var unhulled = hulled.Where(id => !HasHullCollision(id)).ToArray();
                Check(unhulled.Length == 0, $"the stalls, the throne and the organ take their collision from their hulls ({hulled.Length - unhulled.Length} of {hulled.Length}; not: {string.Join(", ", unhulled)})");
                // the stalls hold a body where they stand (seat, desk), the choir between them and the gaps at the piers stay open
                var stallAt = new (string Name, float X, float Z, bool Free)[] { ("west seat", -267.45f, 239.5f, false), ("west desk", -266.45f, 239.5f, false), ("east seat", -256.55f, 231.0f, false),
                                                                                ("east desk", -257.55f, 231.0f, false), ("choir middle", -262.0f, 238.0f, true), ("before the west desk", -265.4f, 239.5f, true),
                                                                                ("before the east desk", -258.6f, 231.0f, true) };
                foreach (var a in stallAt) Solid.I.Ensure(new Vector3(a.X, 1f, a.Z), 4);
                await Frames(5);
                var stallFree = stallAt.Select(a => (a.Name, free: Jef.I.BodyFree(a.X, .66f, a.Z), a.Free)).ToArray();
                facts["stalls"] = stallFree.Select(a => new { a.Name, a.free }).ToArray();
                Check(stallFree.All(a => a.free == a.Free), $"the choir stalls are solid at their seats and desks, the choir between them free ({string.Join(", ", stallFree.Select(a => a.Name + (a.free ? " free" : " held")))})");
                // Use Jef's actual movement and step handling: the closed front gate holds him; the authored east screen gate gives access.
                // This is a bounded walk along known aisle waypoints, not a second navigation implementation.
                if (Jef.I.Fly) Jef.I.ToggleFly();
                foreach (float x in new[] { -268.65f, -262f, -255.35f }) Solid.I.Ensure(new Vector3(x, .66f, 227.5f), 5);
                await Frames(5);
                var railSolid = new[] { -262.5f, -262f, -261.5f }.Select(x => new { x, held = !Jef.I.BodyFree(x, .66f, 227.43f) }).ToArray();
                Jef.I.Place(-262f, 225.7f, MathF.PI, 0, .3f); await Frames(20);
                float gateFurthest = Jef.I.Z;
                try
                {
                    Jef.I.SetKey(Key.W, true);
                    var gateUntil = DateTime.UtcNow.AddSeconds(4);
                    while (DateTime.UtcNow < gateUntil)
                    {
                        Jef.I.Yaw = MathF.PI; await Frames(1); gateFurthest = MathF.Max(gateFurthest, Jef.I.Z);
                    }
                }
                finally { Jef.I.ClearKeys(); }
                facts["communionGateHeld"] = new { probes = railSolid, furthestZ = gateFurthest, at = new[] { Jef.I.X, Jef.I.Y, Jef.I.Z } };
                Check(railSolid.All(p => p.held) && gateFurthest > 226.5f && gateFurthest < 227.43f,
                    $"the closed communion gate and its posts hold Jef approaching from the nave (furthest z {gateFurthest:0.00})");
                // The choir screens continue behind the front piers. Their actual east opening is z=236.829..239.429.
                // Cross its midpoint, then keep east of the central lectern while returning toward the communion rail.
                var waypoints = new[] { new Vector2(-262f, 224f), new Vector2(-253.5f, 224f), new Vector2(-253.5f, 238.13f),
                    new Vector2(-260.5f, 238.13f), new Vector2(-260.5f, 229.1f), new Vector2(-262f, 229.1f) };
                var samples = new List<Vector2>(); var previous = new Vector2(-262f, 225.7f);
                foreach (var point in waypoints)
                {
                    int steps = (int)MathF.Ceiling(previous.DistanceTo(point) / .125f);
                    for (int i = 1; i <= steps; i++) samples.Add(previous.Lerp(point, (float)i / steps));
                    previous = point;
                }
                foreach (var point in samples) Solid.I.Ensure(new Vector3(point.X, .66f, point.Y), 3);
                await Frames(5);
                var clearance = new List<object>(); bool clear = true; float feet = .3f;
                foreach (var point in samples)
                {
                    float ground = Jef.I.GroundAt(point.X, point.Y, feet);
                    bool free = float.IsFinite(ground) && MathF.Abs(ground - feet) <= .38f && Jef.I.BodyFree(point.X, ground, point.Y);
                    if (!free) { clearance.Add(new { x = point.X, z = point.Y, ground = float.IsFinite(ground) ? ground : (float?)null, feet }); clear = false; }
                    if (float.IsFinite(ground)) feet = ground;
                }
                facts["communionChoirClearance"] = new { samples = samples.Count, clear, blocked = clearance };
                Jef.I.Place(-262f, 225.7f, 0, 0, .3f); await Frames(20);
                var reached = new List<float[]>(); var trace = new List<float[]>(); bool walked = clear;
                try
                {
                    foreach (var point in waypoints)
                    {
                        if (!walked) break;
                        var walkUntil = DateTime.UtcNow.AddSeconds(10);
                        Jef.I.SetKey(Key.W, true);
                        while (new Vector2(Jef.I.X, Jef.I.Z).DistanceTo(point) > .15f && DateTime.UtcNow < walkUntil)
                        {
                            Jef.I.Yaw = MathF.Atan2(Jef.I.X - point.X, Jef.I.Z - point.Y);
                            await Frames(1);
                            if (trace.Count == 0 || new Vector2(trace[^1][0] - Jef.I.X, trace[^1][2] - Jef.I.Z).Length() > .25f)
                                trace.Add(new[] { Jef.I.X, Jef.I.Y, Jef.I.Z });
                        }
                        Jef.I.ClearKeys();
                        reached.Add(new[] { Jef.I.X, Jef.I.Y, Jef.I.Z });
                        if (new Vector2(Jef.I.X, Jef.I.Z).DistanceTo(point) > .15f) { walked = false; break; }
                    }
                }
                finally { Jef.I.ClearKeys(); }
                walked &= Jef.I.Y is > .60f and < .80f && Jef.I.BodyFree(Jef.I.X, Jef.I.Y, Jef.I.Z);
                facts["communionChoirWalk"] = new { entrance = "east screen gate", walked, reached, trace };
                Check(walked, $"Jef walks from the nave through the authored east screen gate into the choir (clearance {clear}; at {Jef.I.X:0.00}, {Jef.I.Y:0.00}, {Jef.I.Z:0.00})");
                var organist = Scheldemist.People.HallPeople.I!.WalkIn("cathedral", "organist");
                Solid.I.Ensure(new Vector3(-262f, 8f, 154.78f), 4); await Frames(5);
                var loftWay = new[] { -265.0f, -263.4f, -260.6f, -259.0f }.Select(x => Jef.I.BodyFree(x, 7.57f, 155.0f)).ToArray();
                Check(organist.Points > 0 && loftWay.All(f => f), $"the organist's way up to his chair is open and the loft clear before the new console ({organist.Points} points, loft {string.Join(" ", loftWay.Select(f => f ? "free" : "held"))})");
                // no coarse old geometry left where the new pieces stand: the old oak boxes, figures, gilt crests and statues
                string[] coarse = { "ct_oak", "ct_oak_d", "ct_oak_carved", "ct_red", "ct_black", "ct_statue", "ct_brass", "ct_wax", "ct_linen" };
                var left = new Dictionary<string, int>();
                var meshes = BakedWorld.All(game.GetTree().Root).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.IsVisibleInTree()).ToList();
                foreach (var piece in Pieces.Where(p => Replaced.Contains(p.Name)))
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
            if (Stage("debug"))
            {
                foreach (var v in BakedWorld.All(game.GetTree().Root).OfType<Native.Interiors.FurnitureVisual>().Where(v => v.GetParent() is Node3D o && (o.Name.ToString().EndsWith("8919-92") || o.Name.ToString().EndsWith("8914-33"))))
                    foreach (var mi in BakedWorld.All(v).OfType<GeometryInstance3D>())
                        GD.Print($"cathedral: debug {v.GetParent().Name} {mi.Name} vis={mi.Visible}/{mi.IsVisibleInTree()} scale={mi.GlobalTransform.Basis.Scale} at={mi.GlobalPosition} aabb={(mi as MeshInstance3D)?.GetAabb()} range={mi.VisibilityRangeEnd} meta={string.Join(",", mi.GetMetaList())} mat={(mi as MeshInstance3D)?.Mesh?.SurfaceGetMaterial(0)?.ResourceName}");
            }
            if (Stage("pictures"))
            {
                foreach (var (when, hour, weather) in new[] { ("day", 13, "clear"), ("rain", 13, "rain"), ("night", 22, "clear") })
                {
                    GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour, minute = 0, weather })); Daylight.I.Settle(); await Frames(60);
                    foreach (var piece in Pieces.Where(p => Pick(p.Name))) await Shot($"{piece.Name}-{when}", piece.Eye, piece.At);
                    foreach (var look in Close.Where(c => Pick(c.Name)))
                    {
                        await Shot($"{look.Name}-{when}", look.Eye, look.At);
                        if (look.Name == "altar-e177-capital" && Main.I.Arg("cathedral-isolate-marble") == "yes")
                        {
                            var hidden = new List<MeshInstance3D>();
                            foreach (var v in BakedWorld.All(game.GetTree().Root).OfType<Native.Interiors.FurnitureVisual>())
                                foreach (var child in v.GetChildren().OfType<Node3D>())
                                {
                                    bool marble = child.Name.ToString().StartsWith("ModelPart") && int.TryParse(child.Name.ToString()[9..], out int index) && index < v.ModelParts.Length && v.ModelParts[index].StartsWith("church/altar_marble ");
                                    if (marble) continue;
                                    foreach (var mesh in BakedWorld.All(child).OfType<MeshInstance3D>().Where(m => m.Visible)) { hidden.Add(mesh); mesh.Visible = false; }
                                }
                            try { await Shot($"isolated-marble-{when}", look.Eye, look.At); }
                            finally { foreach (var mesh in hidden) mesh.Visible = true; }
                        }
                    }
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
