using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist;

// The port's first proof (docs/godot-port.md): the town as the browser game builds it (tools/godot/export-scene.mjs:
// one glb, the InstancedMesh copies and the places' cameras in a json), drawn by Godot at the same places, with the
// frame time written next to the browser's. Run:
//   godot --path godot -- --town <path to town.glb> --out <result.json>
// Per place: once without mirrors, once with the two mirror views (puddles and river, 320 x 180) the game draws.
public partial class Spike : Node3D
{
    private const int Warm = 60;
    private const int Frames = 180;

    private Camera3D cam = null!;
    private readonly List<Camera3D> mirrorCams = new();
    private readonly List<SubViewport> mirrors = new();
    private readonly List<Skeleton3D> skeletons = new();
    private JsonElement places;
    private string outPath = "";
    private string shotDir = "";

    private int place;
    private int pass; // 0: no mirrors, 1: mirrors
    private int frame;
    private ulong last;
    private Quaternion baseQuat;
    private readonly List<double> times = new();
    private double calls;
    private double prims;
    private readonly List<Dictionary<string, object>> rows = new();
    private readonly Dictionary<string, object> load = new();

    public override void _Ready()
    {
        var args = OS.GetCmdlineUserArgs();
        string Arg(string k, string d)
        {
            int i = Array.IndexOf(args, "--" + k);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : d;
        }
        string town = Arg("town", ProjectSettings.GlobalizePath("res://spike/data/town.glb"));
        outPath = Arg("out", ProjectSettings.GlobalizePath("res://spike/data/result.json"));
        shotDir = System.IO.Path.GetDirectoryName(outPath) ?? ".";

        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        Engine.MaxFps = 0;

        ulong t0 = Time.GetTicksMsec();
        using var json = JsonDocument.Parse(System.IO.File.ReadAllText(System.IO.Path.ChangeExtension(town, ".json")));
        var facts = json.RootElement.GetProperty("facts");
        places = json.RootElement.GetProperty("places").Clone();

        var doc = new GltfDocument();
        var state = new GltfState();
        var err = doc.AppendFromFile(town, state);
        if (err != Error.Ok)
        {
            GD.PrintErr($"town glb: {err}");
            GetTree().Quit(1);
            return;
        }
        var scene = doc.GenerateScene(state);
        AddChild(scene);
        load["glbMs"] = (double)(Time.GetTicksMsec() - t0);

        // the look: no metal, matt, nearest pixels, lit per vertex (the PS1 look); the game's own lights go, one
        // sun and the sky's light stand in for them
        int meshes = 0, lights = 0, copies = 0, multi = 0;
        var seen = new HashSet<Material>();
        var instances = json.RootElement.GetProperty("instances");
        foreach (var n in All(scene).ToList())
        {
            if (n is Light3D l)
            {
                lights++;
                l.QueueFree();
            }
            else if (n is Skeleton3D s) skeletons.Add(s);
            else if (n is MeshInstance3D mi && mi.Mesh != null)
            {
                meshes++;
                for (int i = 0; i < mi.Mesh.GetSurfaceCount(); i++)
                    if (mi.Mesh.SurfaceGetMaterial(i) is BaseMaterial3D m && seen.Add(m))
                    {
                        m.Metallic = 0;
                        m.Roughness = 1;
                        m.TextureFilter = BaseMaterial3D.TextureFilterEnum.NearestWithMipmaps;
                        m.ShadingMode = BaseMaterial3D.ShadingModeEnum.PerVertex;
                    }
                string name = mi.Name.ToString();
                if (name.StartsWith("INST") && instances.TryGetProperty(name, out var inst))
                {
                    int count = inst.GetProperty("count").GetInt32();
                    var m = inst.GetProperty("m");
                    var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = mi.Mesh, InstanceCount = count };
                    var v = new float[16];
                    int k = 0, c = 0;
                    foreach (var e in m.EnumerateArray())
                    {
                        v[k++] = e.GetSingle();
                        if (k < 16) continue;
                        k = 0;
                        mm.SetInstanceTransform(c++, new Transform3D(new Basis(new Vector3(v[0], v[1], v[2]), new Vector3(v[4], v[5], v[6]), new Vector3(v[8], v[9], v[10])), new Vector3(v[12], v[13], v[14])));
                    }
                    var mmi = new MultiMeshInstance3D { Multimesh = mm, Transform = mi.Transform, Name = name + "_mm" };
                    mi.GetParent().AddChild(mmi);
                    mi.QueueFree();
                    copies += count;
                    multi++;
                }
            }
        }
        load["meshes"] = meshes;
        load["materials"] = seen.Count;
        load["lightsRemoved"] = lights;
        load["multiMeshes"] = multi;
        load["copies"] = copies;
        load["skeletons"] = skeletons.Count;

        Color fogColor = new Color(0.6f, 0.62f, 0.62f);
        float fogNear = 20, fogFar = 160;
        if (facts.GetProperty("fog").ValueKind == JsonValueKind.Object)
        {
            var f = facts.GetProperty("fog");
            fogColor = Hex(f.GetProperty("color").GetInt32());
            if (f.TryGetProperty("near", out var a) && a.ValueKind == JsonValueKind.Number) fogNear = a.GetSingle();
            if (f.TryGetProperty("far", out var b) && b.ValueKind == JsonValueKind.Number) fogFar = b.GetSingle();
        }
        var env = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Color,
            BackgroundColor = fogColor,
            AmbientLightSource = Godot.Environment.AmbientSource.Color,
            AmbientLightColor = new Color(0.75f, 0.78f, 0.8f),
            AmbientLightEnergy = 0.9f,
            FogEnabled = true,
            FogMode = Godot.Environment.FogModeEnum.Depth,
            FogLightColor = fogColor,
            FogDepthBegin = fogNear,
            FogDepthEnd = fogFar,
            FogDensity = 1,
            TonemapMode = Godot.Environment.ToneMapper.Linear,
        };
        AddChild(new WorldEnvironment { Environment = env });
        var sun = new DirectionalLight3D { LightEnergy = 1.1f, LightColor = new Color(1f, 0.96f, 0.88f), ShadowEnabled = false };
        sun.RotationDegrees = new Vector3(-52, 35, 0);
        AddChild(sun);

        var c0 = facts.GetProperty("camera");
        cam = new Camera3D { Fov = c0.GetProperty("fov").GetSingle(), Near = Math.Max(0.05f, c0.GetProperty("near").GetSingle()), Far = Math.Min(c0.GetProperty("far").GetSingle(), fogFar * 1.05f), Current = true };
        AddChild(cam);

        // the two mirror views the game draws (world/mirror.ts): the puddles' (what stands within 50 m) and the
        // river's. Same world, a camera mirrored in the ground: the cost of a second and third look at the scene.
        foreach (float reach in new[] { 50f, cam.Far })
        {
            var vp = new SubViewport { Size = new Vector2I(320, 180), RenderTargetUpdateMode = SubViewport.UpdateMode.Disabled, World3D = GetViewport().World3D };
            var mc = new Camera3D { Fov = cam.Fov, Near = cam.Near, Far = reach, Current = true };
            vp.AddChild(mc);
            AddChild(vp);
            mirrors.Add(vp);
            mirrorCams.Add(mc);
        }
        load["readyMs"] = (double)(Time.GetTicksMsec() - t0);
        GD.Print($"town in: {JsonSerializer.Serialize(load)}");
        Begin();
    }

    private static IEnumerable<Node> All(Node n)
    {
        yield return n;
        foreach (var c in n.GetChildren())
            foreach (var d in All(c))
                yield return d;
    }

    private static Color Hex(int h) => new Color(((h >> 16) & 255) / 255f, ((h >> 8) & 255) / 255f, (h & 255) / 255f);

    private void Begin()
    {
        var p = places[place];
        var pos = p.GetProperty("pos");
        var q = p.GetProperty("quat");
        cam.Position = new Vector3(pos[0].GetSingle(), pos[1].GetSingle(), pos[2].GetSingle());
        baseQuat = new Quaternion(q[0].GetSingle(), q[1].GetSingle(), q[2].GetSingle(), q[3].GetSingle());
        cam.Quaternion = baseQuat;
        foreach (var vp in mirrors) vp.RenderTargetUpdateMode = pass == 1 ? SubViewport.UpdateMode.Always : SubViewport.UpdateMode.Disabled;
        frame = 0;
        times.Clear();
        calls = prims = 0;
    }

    public override void _Process(double delta)
    {
        if (cam == null) return;
        ulong now = Time.GetTicksUsec();
        // every person's bones move every frame, as a walking crowd's do
        float t = now / 1e6f;
        foreach (var s in skeletons)
        {
            int n = Math.Min(s.GetBoneCount(), 24);
            for (int b = 1; b < n; b++)
                s.SetBonePoseRotation(b, s.GetBoneRest(b).Basis.GetRotationQuaternion() * new Quaternion(Vector3.Right, 0.25f * MathF.Sin(t * 6 + b)));
        }
        if (frame >= Warm)
        {
            times.Add((now - last) / 1000.0);
            calls += RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame);
            prims += RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalPrimitivesInFrame);
            // a whole turn over the measured frames
            cam.Quaternion = new Quaternion(Vector3.Up, Mathf.Tau * (frame - Warm) / Frames) * baseQuat;
        }
        last = now;
        for (int i = 0; i < mirrorCams.Count; i++)
        {
            var g = cam.GlobalTransform;
            var o = g.Origin;
            var f = -g.Basis.Z;
            mirrorCams[i].LookAtFromPosition(new Vector3(o.X, -o.Y, o.Z), new Vector3(o.X + f.X, -o.Y - f.Y, o.Z + f.Z), Vector3.Up);
        }
        frame++;
        if (frame == Warm - 5 && pass == 0)
            GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(shotDir, $"godot_{places[place].GetProperty("place").GetString()!.Replace(' ', '_')}.png"));
        if (frame < Warm + Frames + 1) return;

        times.RemoveAt(0);
        times.Sort();
        var row = new Dictionary<string, object>
        {
            ["place"] = places[place].GetProperty("place").GetString()!,
            ["mirrors"] = pass == 1,
            ["mean"] = Math.Round(times.Average(), 3),
            ["p95"] = Math.Round(times[(int)(times.Count * 0.95)], 3),
            ["max"] = Math.Round(times[^1], 3),
            ["drawCalls"] = Math.Round(calls / Frames),
            ["ktris"] = Math.Round(prims / Frames / 1000),
            ["browserFrameMean"] = places[place].GetProperty("browser").GetProperty("frameMean").GetDouble(),
            ["browserRender"] = places[place].GetProperty("browser").GetProperty("render").GetDouble(),
            ["browserCalls"] = places[place].GetProperty("browser").GetProperty("calls").GetDouble(),
        };
        rows.Add(row);
        GD.Print(JsonSerializer.Serialize(row));
        if (++pass > 1)
        {
            pass = 0;
            place++;
        }
        if (place >= places.GetArrayLength())
        {
            System.IO.File.WriteAllText(outPath, JsonSerializer.Serialize(new Dictionary<string, object>
            {
                ["made"] = DateTime.UtcNow.ToString("o"),
                ["renderer"] = RenderingServer.GetVideoAdapterName() + " / " + ProjectSettings.GetSetting("rendering/renderer/rendering_method", "forward_plus").AsString(),
                ["window"] = $"{GetViewport().GetVisibleRect().Size} at 3D scale {GetViewport().Scaling3DScale}",
                ["load"] = load,
                ["rows"] = rows,
            }, new JsonSerializerOptions { WriteIndented = true }));
            cam = null!;
            GetTree().Quit();
            return;
        }
        Begin();
    }
}
