using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

// A repeatable snap exhibit, independent of which residents happen to be in the market that minute.
[GamePart(899)]
internal partial class People2Proof : Node
{
    private readonly List<Human> people = new();
    private readonly List<object> figures = new();
    private readonly List<World.Blobs.Spot> shadows = new();
    private bool written;
    private int measuredFrames;
    private long updateBytes, maxUpdateBytes;
    private int expectedPeople;
    public override async void _Ready()
    {
        if ((!Main.I.Flag("people2-proof") && Main.I.Arg("people2-captures") == "") || !People2.Enabled) { SetProcess(false); return; }
        var p = Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray().First(p => p.GetProperty("place").GetString() == "vismarkt").GetProperty("pos");
        var origin = new Vector3(p[0].GetSingle(), 0, p[2].GetSingle());
        bool lightProof = Main.I.Flag("people2-light-proof");
        if (lightProof && World.Lights.I is { } lamps)
        {
            var nearest = lamps.Lamps.OrderBy(l => new Vector2(l.at.X - origin.X, l.at.Z - origin.Z).LengthSquared()).First();
            // This market lamp borders a building: keep figures and front cameras on the square side.
            origin = nearest.at - new Vector3(0, nearest.at.Y, 5f);
        }
        string[] kinds = { "docker_a", "fishwife_a", "police", "sooi" };
        bool crowdProof = Main.I.Flag("people2-crowd-proof");
        if (Main.I.Flag("people2-picture-proof"))
            kinds = kinds.Concat(People2.Kinds.Where(k => !new[] { "p2:docker_a", "p2:fishwife_a", "p2:police", "p2:sooi" }.Contains(k))).ToArray();
        if (crowdProof)
            kinds = new[] { "docker_a", "fishwife_a", "police", "docker_a", "p2:man_middling", "p2:woman_middling", "fishwife_a", "police",
                            "p2:old_man", "p2:man_stout", "docker_a", "p2:woman_slight", "p2:child_middling", "sooi", "p2:old_woman", "p2:man_slight" };
        expectedPeople = kinds.Length;
        for (int i = 0; i < kinds.Length; i++)
        {
            var human = Humans.Make(kinds[i]); if (human == null) continue;
            // a mixed crowd: every person their own face from their own id (as the town's residents get theirs)
            if (crowdProof) human.SetIdentity("crowd-proof:" + i);
            var at = crowdProof ? origin + new Vector3((i % 4 - 1.5f) * 0.95f + (i / 4 % 2) * 0.45f, 0, 3 + i / 4 * 1.1f)
                : origin + new Vector3((i - 1.5f) * 1.25f, 0, 3 + (lightProof ? 0 : i * 0.7f));
            float ground = World.Lights.I?.GroundAt(at.X, at.Z) ?? 0;
            if (float.IsFinite(ground)) at.Y = ground;
            human.Root.Position = at;
            human.Root.Rotation = new Vector3(0, MathF.PI, 0);
            Main.I.View.AddChild(human.Root); human.Start(); human.Play(i == 1 ? "talk" : "idle", 0);
            people.Add(human);
            shadows.Add(new World.Blobs.Spot(at.X, at.Z, at.Y, 0.4f));
            var meshes = World.BakedWorld.All(human.Root).OfType<MeshInstance3D>().ToArray();
            figures.Add(new { kind = kinds[i], body = human.Root.Name.ToString(), height = Height(human), bones = human.Root.GetNode<Skeleton3D>("Skeleton3D").GetBoneCount(), materials = meshes.SelectMany(m => Enumerable.Range(0, m.Mesh.GetSurfaceCount()).Select(s => m.Mesh.SurfaceGetMaterial(s).GetInstanceId())).Distinct().Count(), shadows = meshes.All(m => m.CastShadow == GeometryInstance3D.ShadowCastingSetting.Off), lod = meshes.Select(m => new { mesh = m.Name.ToString(), begin = m.VisibilityRangeBegin, end = m.VisibilityRangeEnd, morphs = (m.Mesh as ArrayMesh)?.GetBlendShapeCount(), clothesLayer = m.GetInstanceShaderParameter("clothes_layer").AsInt32(), faceLayer = m.GetInstanceShaderParameter("face_layer").AsInt32(), headVertices = m.Mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Color].AsColorArray().Count(c => c.G > 0.5f), eyes = m.Mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Color].AsColorArray().Count(c => c.R > 0.5f) }).ToArray() });
        }
        World.Blobs.I?.Set("people2-proof", shadows);
        // Switching never replaces an existing figure. New copies go through the old routing again.
        string off = await Dev.DevConsole.Run("people2 off");
        var old = Humans.Make("docker_a");
        string? fallback = old?.Root.Name.ToString(); int fallbackBones = old?.Root.GetNode<Skeleton3D>("Skeleton3D").GetBoneCount() ?? 0; old?.Dispose();
        string on = await Dev.DevConsole.Run("people2 on");
        var next = Humans.Make("docker_a"); string? optedIn = next?.Root.Name.ToString(); int optedInBones = next?.Root.GetNode<Skeleton3D>("Skeleton3D").GetBoneCount() ?? 0; next?.Dispose();
        var bodyHeights = new List<object>();
        foreach (string body in People2.Kinds)
        {
            var h = Humans.Make(body); if (h == null) continue;
            bodyHeights.Add(new { kind = body, height = Height(h) }); h.Dispose();
        }
        var defaultRouting = new List<object>();
        foreach (var (kind, bones) in new[] { ("old_man", 16), ("docker_b", 16), ("old_woman", 64), ("maid", 64), ("p2:girl", 64), ("p2:girl_b", 64) })
        {
            var h = Humans.Make(kind) ?? throw new InvalidOperationException("Missing default kind: " + kind);
            int actual = h.Root.GetNode<Skeleton3D>("Skeleton3D").GetBoneCount();
            bool female = h.Root.HasMeta("people2_female") && h.Root.GetMeta("people2_female").AsBool();
            defaultRouting.Add(new { kind, expectedBones = bones, actualBones = actual, female });
            if (kind.StartsWith("p2:girl", StringComparison.Ordinal) && !female) throw new InvalidOperationException("Girl exhibit lost female identity: " + kind);
            h.Dispose();
            if (actual != bones) throw new InvalidOperationException("Default dressed/fallback route: " + kind);
        }
        string dir = Output;
        if (dir != "")
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "people2-proof.json"), JsonSerializer.Serialize(new { figures, bodyHeights, defaultRouting, faceSetter = await FaceProof(), textureBytes = People2Material.TextureBytes, projectionBytes = People2Material.ProjectionBytes, gpuBefore = People2Material.GpuBefore, gpuAfter = People2Material.GpuAfter, off, on, fallback, fallbackBones, optedIn, optedInBones, switchOkay = fallbackBones == 16 && optedInBones == 64, retained = people[0].Root.Name.ToString(), motions = Humans.Motions }, new JsonSerializerOptions { WriteIndented = true }));
        }
        if (Main.I.Arg("people2-captures") != "") await Capture(dir);
    }
    private static string Output => Main.I.Arg("people2-captures") is { Length: > 0 } captures ? Paths.Absolute(captures) : Paths.TestOutput("snap");
    private async System.Threading.Tasks.Task Capture(string dir)
    {
        try
        {
            var town = Main.I.GetNode<Town.Townspeople>("Townspeople");
            for (int i = 0; town.Data == null && i < 1800; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            if (town.Data == null || people.Count != expectedPeople) throw new InvalidOperationException("People2 capture did not load every requested part.");
            town.ClockRuns = false;
            Game.GameState.I.PlayingWhen = () => false;
            for (int i = 0; !Dev.Kit.I.IsReady && i < 1800; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            if (!Dev.Kit.I.IsReady) throw new InvalidOperationException("Native dev API did not become ready.");
            if (Main.I.Flag("people2-crowd-proof")) { await CrowdCapture(dir, town); return; }
            if (Main.I.Flag("people2-dress-proof") || Main.I.Flag("people2-picture-proof"))
            {
                // Keep live residents from crossing the close inspection cameras. The four
                // exhibit humans still use the real sampler, and the town/light resources stay intact.
                town.SetProcess(false);
                if (town.Crowd is { } crowd)
                    foreach (var resident in crowd.Walking) resident.Group.Visible = false;
            }
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true;
            Main.I.Cam.SetProcess(false);
            Input.MouseMode = Input.MouseModeEnum.Visible;
            var pictures = new List<object>();
            var wideExhibit = people[0].Root.GlobalPosition - new Vector3(0, 0, 4);
            bool integration = Main.I.Flag("people2-integration-proof");
            Node3D? stool = integration ? Models.ModelLibrary.Get("stalls")?.Copy("mk2_stool") : null;
            float seatHeight = 0.45f;
            if (integration && stool == null) throw new InvalidOperationException("Integration sitting proof needs the shared market stool.");
            if (stool != null)
            {
                Main.I.View.AddChild(stool);
                seatHeight = World.BakedWorld.All(stool).OfType<MeshInstance3D>().Max(mi => (mi.GlobalTransform * mi.GetAabb()).End.Y);
                stool.Visible = false;
            }
            foreach (var (label, hour, weather) in new[] { ("day", 13.0, "clear"), ("rain", 13.0, "rain"), ("lamps", 19.5, "clear") })
            {
                await Dev.Kit.I.Light(hour, weather);
                for (int settle = 0; settle < 90; settle++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                foreach (var human in people)
                {
                    var originalPosition = human.Root.GlobalPosition;
                    if (Main.I.Flag("people2-distance-proof") || integration)
                    {
                        foreach (var other in people) other.Root.Visible = other == human;
                        var spot = wideExhibit;
                        float ground = World.Lights.I?.GroundAt(spot.X, spot.Z) ?? spot.Y;
                        if (float.IsFinite(ground)) spot.Y = ground;
                        human.Root.GlobalPosition = spot;
                        human.Play("talk", 0); human.Play("idle", 0); // release old stance contacts after relocation
                        World.Blobs.I?.Set("people2-proof", new List<World.Blobs.Spot> { new(spot.X, spot.Z, spot.Y, 0.4f) });
                    }
                    var standingPosition = human.Root.GlobalPosition;
                    foreach (string motion in integration ? new[] { "idle", "talk", "walk", "sit" } : Main.I.Flag("people2-dress-proof") ? new[] { "idle", "walk", "talk" } : new[] { "current" })
                    {
                    human.Root.GlobalPosition = standingPosition;
                    if (stool != null)
                    {
                        stool.Position = standingPosition;
                        stool.Visible = motion == "sit";
                        if (motion == "sit") human.Root.GlobalPosition += Vector3.Up * human.SitDrop(seatHeight);
                    }
                    if (motion != "current") human.Play(motion, 0);
                    if (integration) for (int settle = 0; settle < 60; settle++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                    foreach (var (distance, angle) in integration
                        ? motion == "idle" ? new[] { (1f, "front"), (3f, "front"), (8f, "front"), (1f, "side"), (3f, "back-low"), (1f, "feet-low"), (1f, "top") }
                            : motion == "sit" ? new[] { (1f, "front"), (3f, "front"), (3f, "side") }
                            : new[] { (1f, "front"), (3f, "front") }
                        : Main.I.Flag("people2-dress-proof")
                        ? new[] { (1f, "front"), (3f, "front"), (1f, "back-low"), (3f, "back-low"), (1f, "feet-low"), (1f, "top"), (3f, "far-front") }
                        : Main.I.Flag("people2-distance-proof")
                            ? new[] { (8f, "front"), (8f, "back-low"), (1f, "side"), (3f, "side"), (1f, "feet-low") }
                            : new[] { (1f, "front"), (3f, "front"), (1f, "back-low"), (3f, "back-low"), (1f, "top") })
                    {
                        foreach (var mesh in World.BakedWorld.All(human.Root).OfType<MeshInstance3D>())
                        {
                            if (mesh.Name.ToString().EndsWith("_lod0", StringComparison.Ordinal)) mesh.Visible = angle != "far-front";
                            if (mesh.Name.ToString().EndsWith("_lod1", StringComparison.Ordinal)) mesh.VisibilityRangeBegin = angle == "far-front" ? 0 : 15;
                        }
                        var at = human.Root.GlobalPosition;
                        bool front = angle is "front" or "far-front";
                        var from = at + (front ? new Vector3(0, distance == 1 ? 1.55f : 1.3f, -distance)
                            : angle == "side" ? new Vector3(distance, distance == 1 ? 1.55f : 1.3f, 0)
                            : angle == "feet-low" ? new Vector3(0.6f, 0.12f, -0.8f)
                            : angle == "top" ? new Vector3(0.75f, 2.2f, -0.65f)
                            : new Vector3(distance * 0.8f, 0.35f, distance * 0.6f));
                        var target = at + new Vector3(0, angle == "feet-low" ? 0.2f : angle == "top" ? 1.0f : (angle == "front" || angle == "side") && distance == 1 ? 1.5f : 0.85f, 0);
                        if (integration && (front || angle == "side"))
                        {
                            var skeleton = human.Root.GetNode<Skeleton3D>("Skeleton3D");
                            var headAt = skeleton.GlobalTransform * skeleton.GetBoneGlobalPose(skeleton.FindBone("head")).Origin;
                            target.Y = distance == 1 ? headAt.Y + 0.08f : at.Y + (headAt.Y - at.Y) * 0.6f;
                            from.Y = distance == 1 ? target.Y + 0.05f : at.Y + 1.3f;
                        }
                        Main.I.Cam.LookAtFromPosition(from, target);
                        if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
                        for (int settle = 0; settle < 12; settle++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                        string name = $"{label}-{human.Kind.Replace(':', '_')}-{distance:0}m" + (angle == "front" ? "" : "-" + angle) + (motion == "current" ? "" : "-" + motion) + ".png";
                        Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name));
                        var daylight = World.Daylight.I;
                        if (Math.Abs(daylight.Hour - hour) > 0.02 || daylight.Weather != weather)
                            throw new InvalidOperationException($"Capture {name} has wrong live clock/weather: {daylight.Hour} {daylight.Weather}");
                        if (Main.I.Cam.GlobalPosition.DistanceTo(from) > 0.01f) throw new InvalidOperationException("Capture camera moved: " + name);
                        pictures.Add(new { name, hour = daylight.Hour, weather = daylight.Weather, daylight.Night, daylight.Rain, distance, angle, motion, clip = human.AnimationState.Clip, phase = human.AnimationState.Cycle, forcedFar = angle == "far-front", x = at.X, y = at.Y, z = at.Z });
                        foreach (var mesh in World.BakedWorld.All(human.Root).OfType<MeshInstance3D>())
                        {
                            if (mesh.Name.ToString().EndsWith("_lod0", StringComparison.Ordinal)) mesh.Visible = true;
                            if (mesh.Name.ToString().EndsWith("_lod1", StringComparison.Ordinal)) mesh.VisibilityRangeBegin = 15;
                        }
                    }
                    }
                    if (Main.I.Flag("people2-distance-proof") || integration) human.Root.GlobalPosition = originalPosition;
                }
            }
            stool?.QueueFree();
            foreach (var human in people) human.Root.Visible = true;
            World.Blobs.I?.Set("people2-proof", shadows);
            File.WriteAllText(Path.Combine(dir, "captures.json"), JsonSerializer.Serialize(new { ok = true, place = "vismarkt", fingerprint = Main.I.WorldFingerprint, pictures }, new JsonSerializerOptions { WriteIndented = true }));
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
    private async System.Threading.Tasks.Task<object> FaceProof()
    {
        using var root = new Node3D();
        using var mesh = new ArrayMesh { BlendShapeMode = Mesh.BlendShapeMode.Relative };
        mesh.AddBlendShape("nose");
        var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = new[] { Vector3.Zero, Vector3.Right, Vector3.Up };
        var morph = new Godot.Collections.Array(); morph.Resize((int)Mesh.ArrayType.Max);
        morph[(int)Mesh.ArrayType.Vertex] = new[] { new Vector3(0, 0, 0.01f), Vector3.Zero, Vector3.Zero };
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, new Godot.Collections.Array<Godot.Collections.Array> { morph });
        var near = new MeshInstance3D { Name = "test_lod0", Mesh = mesh }; root.AddChild(near);
        int assigned = People2Faces.SetFace(root, new Dictionary<string, float> { ["nose"] = 1.25f });
        float actual = near.GetBlendShapeValue(0);
        People2Faces.SetFace(root, new Dictionary<string, float>());
        float reset = near.GetBlendShapeValue(0);
        int id1 = People2Faces.SetIdentity(root, "fixture:42"), id2 = People2Faces.SetIdentity(root, "fixture:42");
        root.Free();
        // the face recipe against face_types.py's own answers, and a baked person the same twice over
        var (testsOk, tests) = People2Faces.SelfTest();
        var (youngBald, wrongAge) = People2Faces.YoungBaldTest();
        var bakeSamples = new List<object>();
        long eyeAllocationBytes = 0;
        async System.Threading.Tasks.Task<string> Bake(string id)
        {
            var h = Humans.Make("docker_a")!;
            h.SetIdentity(id);
            h.Root.Visible = false; h.Root.Position = Main.I.Cam.GlobalPosition;
            Main.I.View.AddChild(h.Root);
            bool built = false;
            for (int f = 0; f < 600; f++)
            {
                h.Root.GlobalPosition = Main.I.Cam.GlobalPosition; // loading can hand the camera to Jef
                var nearMesh = World.BakedWorld.All(h.Root).OfType<MeshInstance3D>().First(m => m.Name.ToString().EndsWith("_lod0", StringComparison.Ordinal));
                if ((nearMesh.Mesh as ArrayMesh)?.GetBlendShapeCount() == 3) { built = true; break; }
                await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            }
            if (!built) throw new InvalidDataException("Identity near build did not finish: " + id);
            var mesh = World.BakedWorld.All(h.Root).OfType<MeshInstance3D>().First(m => m.Name.ToString().EndsWith("_lod0", StringComparison.Ordinal)).Mesh;
            var v = mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            string sig = v.Length + ":" + v.Sum(q => q.X * 3.1f + q.Y * 7.7f + q.Z * 1.3f).ToString("F5") + ":" + h.Root.GetMeta("face_cell").AsString() + ":" + h.Root.GetMeta("face_hair").AsString();
            eyeAllocationBytes += h.EyeAllocationProof();
            bakeSamples.Add(new { id, meshId = mesh.GetInstanceId(), signature = sig });
            h.Dispose();
            return sig;
        }
        string a1 = await Bake("fixture:7"), a2 = await Bake("fixture:7"), b1 = await Bake("fixture:8");
        return new { assigned, actual, reset, id1, id2, testsOk, tests, youngBald, wrongAge, eyeAllocationCalls = 3000, eyeAllocationBytes, bakeSamples, bakeSame = a1 == a2, bakeDiffers = a1 != b1, sample = a1, repeated = a2, other = b1, bakes = People2Faces.BakeCount, bakeMeanMs = People2Faces.BakeCount > 0 ? People2Faces.BakeMs / People2Faces.BakeCount : 0, bakeMaxMs = People2Faces.MaxBakeMs,
            ok = assigned == 1 && actual == 1.25f && reset == 0 && id1 == id2 && testsOk == tests && youngBald > 0 && wrongAge == 0 && eyeAllocationBytes == 0 && a1 == a2 && a1 != b1 };
    }
    private async System.Threading.Tasks.Task CrowdCapture(string dir, Town.Townspeople town)
    {
        town.SetProcess(false);
        if (town.Crowd is { } crowd) foreach (var resident in crowd.Walking) resident.Group.Visible = false;
        if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
        Player.Jef.I.TestInput = true;
        Main.I.Cam.SetProcess(false);
        var pictures = new List<object>();
        var centre = people.Aggregate(Vector3.Zero, (a, h) => a + h.Root.GlobalPosition) / people.Count;
        Main.I.Cam.LookAtFromPosition(centre + new Vector3(0, 1.5f, -3), centre + Vector3.Up*1.25f);
        bool ready = false;
        for (int f = 0; f < 900; f++)
        {
            ready = people.All(h => World.BakedWorld.All(h.Root).OfType<MeshInstance3D>().Any(m => m.Name.ToString().EndsWith("_lod0") && (m.Mesh as ArrayMesh)?.GetBlendShapeCount() == 3));
            if (ready) break;
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        }
        if (!ready) throw new InvalidDataException("Crowd near meshes did not finish.");
        var faces = people.Select(h => new
        {
            kind = h.Kind,
            type = h.Root.HasMeta("face_type") ? h.Root.GetMeta("face_type").AsString() : "",
            cell = h.Root.HasMeta("face_cell") ? h.Root.GetMeta("face_cell").AsString() : "",
            hair = h.Root.HasMeta("face_hair") ? h.Root.GetMeta("face_hair").AsString() : "",
        }).ToArray();
        foreach (var (label, hour, weather) in new[] { ("day", 13.0, "clear"), ("rain", 13.0, "rain"), ("lamps", 19.5, "clear") })
        {
            await Dev.Kit.I.Light(hour, weather);
            for (int settle = 0; settle < 90; settle++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            var shots = new List<(string name, Vector3 from, Vector3 to)>
            {
                ("8m", centre + new Vector3(0, 1.6f, -8f), centre + new Vector3(0, 1.0f, 0)),
                ("3m", centre + new Vector3(0.3f, 1.55f, -3.4f), centre + new Vector3(0, 1.25f, 0)),
                ("3m-side", centre + new Vector3(3.2f, 1.5f, -1.0f), centre + new Vector3(0, 1.2f, 0)),
            };
            foreach (int k in new[] { 0, 1, 4, 5, 8, 12, 14 })
            {
                var at = people[k].Root.GlobalPosition;
                var eyes = people[k].Socket("eyeL") ?? at + Vector3.Up*1.5f;
                shots.Add(("1m-" + k, new Vector3(at.X + .1f, eyes.Y + .01f, at.Z - 1), new Vector3(at.X, eyes.Y - .025f, at.Z)));
                shots.Add(("2m-" + k, new Vector3(at.X + .1f, eyes.Y + .01f, at.Z - 2), new Vector3(at.X, eyes.Y - .025f, at.Z)));
            }
            foreach (var (name, from, to) in shots)
            {
                Main.I.Cam.LookAtFromPosition(from, to);
                if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
                for (int settle = 0; settle < 12; settle++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                string file = "crowd-" + label + "-" + name + ".png";
                Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, file));
                var daylight = World.Daylight.I;
                if (Math.Abs(daylight.Hour - hour) > 0.02 || daylight.Weather != weather) throw new InvalidOperationException("Crowd capture has the wrong clock or weather: " + file);
                pictures.Add(new { name = file, hour = daylight.Hour, weather = daylight.Weather });
            }
        }
        var blinkProof = new List<object>();
        await Dev.Kit.I.Light(13, "clear");
        foreach (int k in new[] { 0, 5, 12, 8, 14 })
        {
            var h = people[k]; var at = h.Root.GlobalPosition;
            var eye = h.Socket("eyeL") ?? at+Vector3.Up*1.5f;
            Main.I.Cam.LookAtFromPosition(new Vector3(at.X+.08f, eye.Y+.01f, at.Z-1), new Vector3(at.X, eye.Y-.02f, at.Z));
            if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
            var near = World.BakedWorld.All(h.Root).OfType<MeshInstance3D>().First(m => m.Name.ToString().EndsWith("_lod0"));
            int key = near.FindBlendShapeByName("blink");
            if (key < 0 || (near.Mesh as ArrayMesh)?.GetBlendShapeCount() != 3) throw new InvalidDataException("Near face needs three live expressions.");
            bool found = false;
            for (int f = 0; f < 900; f++)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                if (near.GetBlendShapeValue(key) > .01f) { found = true; break; }
            }
            if (!found) throw new InvalidDataException("Natural blink was not observed: " + k);
            for (int f = 0; f < 14; f++)
            {
                await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                string file = $"blink-{k}-{f:D2}.png";
                Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, file));
                blinkProof.Add(new { file, subject = k, closure = near.GetBlendShapeValue(key) });
                await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            }
        }
        var shapeBench = await ShapeBench(centre);
        File.WriteAllText(Path.Combine(dir, "captures.json"), JsonSerializer.Serialize(new
        {
            ok = true, place = "vismarkt", crowd = faces, blinkProof, bakes = People2Faces.BakeCount, shapeBench,
            bakeMeanMs = People2Faces.BakeCount > 0 ? People2Faces.BakeMs / People2Faces.BakeCount : 0, bakeMaxMs = People2Faces.MaxBakeMs,
            fingerprint = Main.I.WorldFingerprint, pictures,
        }, new JsonSerializerOptions { WriteIndented = true }));
        GetTree().Quit();
    }
    /// <summary>The sliders' cost as Godot blend shapes, for the record (docs/people.md "Cost"): 50 static copies of
    /// man_middling's near mesh in view, with 8, 24 and all 51 sliders live and moving, against the same 50 with none
    /// (0: baked, as the game draws people). Per setting, 90 frames: the process time, the render thread's CPU
    /// time and the GPU time of the main view.</summary>
    private async System.Threading.Tasks.Task<object> ShapeBench(Vector3 centre)
    {
        var vp = Main.I.View.GetViewportRid();
        RenderingServer.ViewportSetMeasureRenderTime(vp, true);
        Main.I.Cam.LookAtFromPosition(centre + new Vector3(0, 1.6f, -9f), centre + new Vector3(0, 1.0f, 0));
        foreach (var h in people) h.Root.Visible = false;
        var holder = new Node3D { Name = "people2_shape_bench" };
        AddChild(holder);
        var results = new List<object>();
        foreach (int n in new[] { 0, 8, 24, 51 })
        {
            foreach (var c in holder.GetChildren()) { holder.RemoveChild(c); c.QueueFree(); }
            var mesh = People2Faces.BenchMesh("man_middling_lod0", n);
            if (mesh == null) return new { ok = false, reason = "no man_middling_lod0 template" };
            int shapes = mesh.GetBlendShapeCount();
            var copies = new List<MeshInstance3D>();
            for (int i = 0; i < 50; i++)
            {
                var mi = new MeshInstance3D { Mesh = mesh, Position = centre + new Vector3((i % 10 - 4.5f) * 0.7f, 0, (i / 10) * 1.2f) };
                holder.AddChild(mi);
                copies.Add(mi);
            }
            for (int f = 0; f < 30; f++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            double proc = 0, cpu = 0, gpu = 0;
            for (int f = 0; f < 90; f++)
            {
                // every live slider moves a little each frame (a blend shape set once costs the same per frame)
                for (int i = 0; i < copies.Count; i++)
                    for (int k = 0; k < shapes; k++) copies[i].SetBlendShapeValue(k, 0.5f + 0.4f * Mathf.Sin(0.05f * f + i + k));
                await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                proc += Performance.GetMonitor(Performance.Monitor.TimeProcess) * 1000.0;
                cpu += RenderingServer.ViewportGetMeasuredRenderTimeCpu(vp);
                gpu += RenderingServer.ViewportGetMeasuredRenderTimeGpu(vp);
            }
            results.Add(new { liveSliders = n, baked = n == 0, blendShapes = shapes, people = copies.Count, processMs = proc / 90, renderCpuMs = cpu / 90, gpuMs = gpu / 90 });
        }
        holder.QueueFree();
        foreach (var h in people) h.Root.Visible = true;
        return new { ok = true, mesh = "man_middling_lod0", results };
    }

    private static float Height(Human human)
    {
        float low = float.MaxValue, high = float.MinValue;
        foreach (var mi in World.BakedWorld.All(human.Root).OfType<MeshInstance3D>().Where(m => m.Name.ToString().EndsWith("_lod0", StringComparison.Ordinal)))
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
                foreach (var v in mi.Mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array()) { low = Math.Min(low, v.Y); high = Math.Max(high, v.Y); }
        return high - low; // Corrupt source morphs expand the AABB; measure the resting mesh instead.
    }
    public override void _ExitTree() => World.Blobs.I?.Set("people2-proof", null);
    public override void _Process(double delta)
    {
        long before = GC.GetAllocatedBytesForCurrentThread();
        foreach (var h in people) h.Update((float)delta);
        long bytes = GC.GetAllocatedBytesForCurrentThread() - before;
        if (people.Count > 0 && measuredFrames < 120)
        {
            measuredFrames++; updateBytes += bytes; maxUpdateBytes = Math.Max(maxUpdateBytes, bytes);
            if (measuredFrames == 120)
            {
                string dir = Output;
                if (dir != "") File.WriteAllText(Path.Combine(dir, "people2-updates.json"), JsonSerializer.Serialize(new { frames = measuredFrames, bodies = people.Count, updateBytes, maxUpdateBytes }));
            }
        }
        if (!written && people.Count > 0)
        {
            written = true;
            GD.Print("people2 proof: four mapped figures at 3–6 metres; routing and body measures written beside snaps");
        }
    }
}
