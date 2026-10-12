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
        for (int i = 0; i < kinds.Length; i++)
        {
            var human = Humans.Make(kinds[i]); if (human == null) continue;
            var at = origin + new Vector3((i - 1.5f) * 1.25f, 0, 3 + (lightProof ? 0 : i * 0.7f));
            float ground = World.Lights.I?.GroundAt(at.X, at.Z) ?? 0;
            if (float.IsFinite(ground)) at.Y = ground;
            human.Root.Position = at;
            human.Root.Rotation = new Vector3(0, MathF.PI, 0);
            Main.I.View.AddChild(human.Root); human.Start(); human.Play(i == 1 ? "talk" : "idle", 0);
            people.Add(human);
            shadows.Add(new World.Blobs.Spot(at.X, at.Z, at.Y, 0.4f));
            var meshes = World.BakedWorld.All(human.Root).OfType<MeshInstance3D>().ToArray();
            figures.Add(new { kind = kinds[i], body = human.Root.Name.ToString(), height = Height(human), bones = human.Root.GetNode<Skeleton3D>("Skeleton3D").GetBoneCount(), materials = meshes.SelectMany(m => Enumerable.Range(0, m.Mesh.GetSurfaceCount()).Select(s => m.Mesh.SurfaceGetMaterial(s).GetInstanceId())).Distinct().Count(), shadows = meshes.All(m => m.CastShadow == GeometryInstance3D.ShadowCastingSetting.Off), lod = meshes.Select(m => new { mesh = m.Name.ToString(), begin = m.VisibilityRangeBegin, end = m.VisibilityRangeEnd, morphs = (m.Mesh as ArrayMesh)?.GetBlendShapeCount(), eyes = m.Mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Color].AsColorArray().Count(c => c.R > 0.5f) }).ToArray() });
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
        string dir = Output;
        if (dir != "")
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "people2-proof.json"), JsonSerializer.Serialize(new { figures, bodyHeights, faceSetter = FaceProof(), textureBytes = People2Material.TextureBytes, off, on, fallback, fallbackBones, optedIn, optedInBones, switchOkay = fallbackBones == 16 && optedInBones == 64, retained = people[0].Root.Name.ToString(), motions = Humans.Motions }, new JsonSerializerOptions { WriteIndented = true }));
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
            if (town.Data == null || people.Count != 4) throw new InvalidOperationException("People2 capture needs the native town and four dressed figures.");
            town.ClockRuns = false;
            Game.GameState.I.PlayingWhen = () => false;
            for (int i = 0; !Dev.Kit.I.IsReady && i < 1800; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            if (!Dev.Kit.I.IsReady) throw new InvalidOperationException("Native dev API did not become ready.");
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true;
            Main.I.Cam.SetProcess(false);
            Input.MouseMode = Input.MouseModeEnum.Visible;
            var pictures = new List<object>();
            foreach (var (label, hour, weather) in new[] { ("day", 13.0, "clear"), ("rain", 13.0, "rain"), ("lamps", 19.5, "clear") })
            {
                await Dev.Kit.I.Light(hour, weather);
                for (int settle = 0; settle < 90; settle++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                foreach (var human in people)
                    foreach (var (distance, angle) in new[] { (1f, "front"), (3f, "front"), (3f, "back-low") })
                    {
                        var at = human.Root.GlobalPosition;
                        var from = at + (angle == "front" ? new Vector3(0, distance == 1 ? 1.55f : 1.3f, -distance) : new Vector3(2.4f, 0.35f, 1.8f));
                        var target = at + new Vector3(0, angle == "front" && distance == 1 ? 1.5f : 0.85f, 0);
                        Main.I.Cam.LookAtFromPosition(from, target);
                        if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
                        for (int settle = 0; settle < 12; settle++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                        string name = $"{label}-{human.Kind}-{distance:0}m" + (angle == "front" ? "" : "-" + angle) + ".png";
                        Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name));
                        var daylight = World.Daylight.I;
                        if (Math.Abs(daylight.Hour - hour) > 0.02 || daylight.Weather != weather)
                            throw new InvalidOperationException($"Capture {name} has wrong live clock/weather: {daylight.Hour} {daylight.Weather}");
                        if (Main.I.Cam.GlobalPosition.DistanceTo(from) > 0.01f) throw new InvalidOperationException("Capture camera moved: " + name);
                        pictures.Add(new { name, hour = daylight.Hour, weather = daylight.Weather, daylight.Night, daylight.Rain, distance, angle, x = at.X, y = at.Y, z = at.Z });
                    }
            }
            File.WriteAllText(Path.Combine(dir, "captures.json"), JsonSerializer.Serialize(new { ok = true, place = "vismarkt", fingerprint = Main.I.WorldFingerprint, pictures }, new JsonSerializerOptions { WriteIndented = true }));
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
    private static object FaceProof()
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
        return new { assigned, actual, reset, id1, id2, ok = assigned == 1 && actual == 1.25f && reset == 0 && id1 == id2 };
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
