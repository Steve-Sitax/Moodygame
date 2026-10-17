using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Issue #157: pictures and frame times of town-house corner stones and stone door surrounds in the real native
/// town, in a disposable proof save. Views come from <c>--stone-corners-views</c> (JSON: name, eye, focus, fov,
/// weathers). With <c>--stone-corners-candidate</c> the repaired meshes are built in memory from the candidate's
/// world-space rows (16 floats per vertex, as the wall-circuit repair writes them) and swapped in for the second
/// picture and the second measurement; no resource file is written. Writes stone-corners.json and the pictures.
/// </summary>
public static class NativeStoneCornersProof
{
    record View(string Name, float[] Eye, float[] Focus, float Fov, string[] Weathers, bool Measure = false);

    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        var checks = new List<object>(); var notes = new List<object>(); var pictures = new List<string>(); string error = "";
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task<bool> Until(Func<bool> ready, double seconds) { var end = DateTime.UtcNow.AddSeconds(seconds); while (DateTime.UtcNow < end) { if (ready()) return true; await Frames(3); } return ready(); }
        void Check(string name, bool passed) { checks.Add(new { name, passed }); if (!passed) error += name + "; "; }
        string Option(string name) { var a = OS.GetCmdlineUserArgs(); int i = Array.IndexOf(a, "--" + name); return i >= 0 && i + 1 < a.Length ? a[i + 1] : ""; }
        bool measure = OS.GetCmdlineUserArgs().Contains("--stone-corners-measure");
        try
        {
            var views = JsonSerializer.Deserialize<View[]>(File.ReadAllText(Paths.Absolute(Option("stone-corners-views"))), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
            string candidateFolder = Option("stone-corners-candidate");
            Check("stone corners proof uses its own disposable database", Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && game.Flag("no-ai"));
            Check("native town and services become ready", await Until(() => game.Loaded && !Loading.Busy && ServerLink.I?.Up == true && GameState.I.Live, 900));
            var api = ServerLink.I!.Api!; MainMenu.I!.Start(); Jef.I.TestInput = true; Pause.Clear(); game.Ui.Visible = false;
            for (int attempt = 1; ; attempt++)
                try { GameState.I.Apply(await api.NewGame()); break; }
                catch (ApiException) when (attempt < 4) { await Frames(30); }
            if (Jef.I is { Fly: false } player) player.ToggleFly();
            // --stone-corners-probe x,y,z: every drawn thing whose box holds that point (what covers a stone?)
            if (Option("stone-corners-probe") is { Length: > 0 } probe)
            {
                var q = probe.Split(',').Select(v => float.Parse(v, System.Globalization.CultureInfo.InvariantCulture)).ToArray(); var at = new Vector3(q[0], q[1], q[2]);
                foreach (var g in BakedWorld.All(game.GetTree().Root).OfType<GeometryInstance3D>())
                    if (g.IsVisibleInTree() && (g.GlobalTransform * g.GetAabb()).Grow(0.01f).HasPoint(at))
                        notes.Add(new { mode = "probe", node = g.GetPath().ToString(), type = g.GetClass(), mesh = (g as MeshInstance3D)?.Mesh?.ResourcePath ?? "", size = (g.GlobalTransform * g.GetAabb()).Size.ToString() });
            }
            notes.Add(new { mode = "memory", stage = "before candidate", bufferMemMB = Performance.GetMonitor(Performance.Monitor.RenderBufferMemUsed) / 1048576.0, videoMemMB = Performance.GetMonitor(Performance.Monitor.RenderVideoMemUsed) / 1048576.0 });
            var swaps = candidateFolder == "" ? new List<(MeshInstance3D node, Mesh before, Mesh after)>() : Candidate(game, Paths.Absolute(candidateFolder), notes);
            if (candidateFolder != "") Check("candidate meshes found in the town", swaps.Count > 0);
            await Frames(10);
            notes.Add(new { mode = "memory", stage = "candidate built", bufferMemMB = Performance.GetMonitor(Performance.Monitor.RenderBufferMemUsed) / 1048576.0, videoMemMB = Performance.GetMonitor(Performance.Monitor.RenderVideoMemUsed) / 1048576.0 });
            void Use(bool candidate) { foreach (var s in swaps) s.node.Mesh = candidate ? s.after : s.before; }
            // the town is drawn in its own SubViewport; the window's viewport only shows that picture
            var viewport = game.World.GetViewport().GetViewportRid();
            RenderingServer.ViewportSetMeasureRenderTime(viewport, true);
            async Task<object> Measure(string state)
            {
                var gpu = new List<double>(); var cpu = new List<double>(); var frame = new List<double>(); var interval = new List<double>(); long calls = 0, primitives = 0;
                await Frames(30);
                ulong last = Time.GetTicksUsec();
                for (int i = 0; i < 150; i++)
                {
                    await Frames(1);
                    ulong now = Time.GetTicksUsec(); interval.Add((now - last) / 1000.0); last = now;
                    gpu.Add(RenderingServer.ViewportGetMeasuredRenderTimeGpu(viewport)); cpu.Add(RenderingServer.ViewportGetMeasuredRenderTimeCpu(viewport));
                    frame.Add(Performance.GetMonitor(Performance.Monitor.TimeProcess) * 1000);
                    calls = Math.Max(calls, (long)RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame));
                    primitives = Math.Max(primitives, (long)RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalPrimitivesInFrame));
                }
                double P95(List<double> v) { var s = v.OrderBy(x => x).ToArray(); return s[(int)(s.Length * .95)]; }
                return new { state, videoMemMB = Performance.GetMonitor(Performance.Monitor.RenderVideoMemUsed) / 1048576.0, bufferMemMB = Performance.GetMonitor(Performance.Monitor.RenderBufferMemUsed) / 1048576.0, gpuMean = gpu.Average(), gpuP95 = P95(gpu), cpuMean = cpu.Average(), processMean = frame.Average(), frameMean = interval.Average(), frameP95 = P95(interval), drawCalls = calls, primitives };
            }
            Camera3D? capture = null;
            foreach (var weather in new[] { "day", "rain", "night" })
            {
                var chosen = views.Where(v => v.Weathers.Contains(weather)).ToArray();
                if (chosen.Length == 0) continue;
                var state = await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = weather == "night" ? 22 : 13, minute = 0, weather = weather == "rain" ? "rain" : "clear" });
                GameState.I.Apply(state); Scheldemist.Movers.MoverClock.Hold(weather == "night" ? 22 : 13, 1);
                foreach (var view in chosen)
                {
                    var eye = new Vector3(view.Eye[0], view.Eye[1], view.Eye[2]); var focus = new Vector3(view.Focus[0], view.Focus[1], view.Focus[2]);
                    // the game's camera goes there too (whatever follows the player follows it); a capture camera
                    // keeps the view's own field of view, which the fly camera would reset
                    game.Cam.GlobalPosition = eye;
                    var rotation = new Transform3D(Basis.Identity, eye).LookingAt(focus, Vector3.Up).Basis.GetRotationQuaternion();
                    if (game.Cam is FlyCam fly) fly.Face(rotation); else game.Cam.Quaternion = rotation;
                    capture?.QueueFree();
                    capture = new Camera3D { Name = "StoneCornersCapture", Fov = view.Fov > 0 ? view.Fov : 62, Near = .05f, Far = game.Cam.Far, CullMask = game.Cam.CullMask, Environment = game.Cam.Environment };
                    game.Cam.GetParent().AddChild(capture);
                    capture.GlobalTransform = new Transform3D(Basis.Identity, eye).LookingAt(focus, Vector3.Up); capture.MakeCurrent();
                    Daylight.I.Settle(); await Frames(90);
                    foreach (bool candidate in swaps.Count > 0 ? new[] { false, true } : new[] { false })
                    {
                        Use(candidate); await Frames(12);
                        await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                        string name = $"{view.Name}-{weather}-{(candidate ? "candidate" : "before")}.png";
                        using var picture = game.GetViewport().GetTexture().GetImage();
                        if (picture.SavePng(Path.Combine(output, name)) == Error.Ok) pictures.Add(name); else Check(name + " written", false);
                    }
                    if (measure && view.Measure && weather == "day")
                        // back and forth, so a slow first pass does not count against either state
                        foreach (bool candidate in swaps.Count > 0 ? new[] { false, true, false, true } : new[] { false })
                        { Use(candidate); notes.Add(new { mode = "frame", view = view.Name, result = await Measure(candidate ? "candidate" : "before") }); }
                    Use(false);
                }
            }
            capture?.QueueFree(); game.Cam.MakeCurrent();
            Check("clock and weather follow the proof", GameState.I.Hour == (views.Any(v => v.Weathers.Contains("night")) ? 22 : 13));
        }
        catch (Exception ex) { error += ex.ToString(); GD.PushError("stone corners proof: " + ex); }
        finally
        {
            try
            {
                File.WriteAllText(Path.Combine(output, "stone-corners.json"), JsonSerializer.Serialize(new { ok = error == "", error, checks, notes, pictures }, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
                if (error != "") File.WriteAllText(Path.Combine(output, "failure.txt"), error);
            }
            catch (Exception ex) { File.WriteAllText(Path.Combine(output, "failure.txt"), error + " report: " + ex.Message); }
            game.GetTree().Quit();
        }
    }

    // manifest.json: { "res://world/town/resources/rNNNNNN.res": [ { file, material, custom0, vertices } ] }, rows in world space.
    static List<(MeshInstance3D node, Mesh before, Mesh after)> Candidate(NativeTownGame game, string folder, List<object> notes)
    {
        var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(folder, "manifest.json"))).RootElement;
        var swaps = new List<(MeshInstance3D node, Mesh before, Mesh after)>();
        // candidate materials: a copy of a game material with the candidate's shader and pictures
        var materials = new Dictionary<string, Material>();
        if (manifest.TryGetProperty("materials", out var defs))
            foreach (var def in defs.EnumerateObject())
            {
                var material = (ShaderMaterial)ResourceLoader.Load<ShaderMaterial>(def.Value.GetProperty("base").GetString()!).Duplicate();
                material.Shader = ResourceLoader.Load<Shader>(def.Value.GetProperty("shader").GetString()!, null, ResourceLoader.CacheMode.Ignore);
                foreach (var param in def.Value.GetProperty("params").EnumerateObject())
                    material.SetShaderParameter(param.Name, ResourceLoader.Load<Texture2D>(param.Value.GetString()!));
                material.ResourceName = def.Name; materials[def.Name] = material;
            }
        var instances = BakedWorld.All(game.World).Concat(BakedWorld.All(game.View)).OfType<MeshInstance3D>().Where(m => m.Mesh != null).Distinct().ToArray();
        foreach (var entry in manifest.EnumerateObject().Where(e => e.Name.StartsWith("res://", StringComparison.Ordinal)))
            foreach (var instance in instances.Where(m => m.Mesh!.ResourcePath == entry.Name))
            {
                var old = instance.Mesh!; var mesh = new ArrayMesh { ResourceName = old.ResourceName };
                // (an entry is the surface list, or an object with it under "surfaces")
                var list = entry.Value.ValueKind == JsonValueKind.Object ? entry.Value.GetProperty("surfaces") : entry.Value;
                foreach (var surface in list.EnumerateArray())
                {
                    if (surface.GetProperty("vertices").GetInt32() == 0) continue;
                    bool custom = surface.TryGetProperty("custom0", out var c) && c.GetBoolean();
                    // the same vertex format as the town's meshes and the promotion: compressed attributes
                    var flags = (custom ? (Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.RgFloat << (int)Mesh.ArrayFormat.FormatCustom0Shift) : 0) | (OS.GetCmdlineUserArgs().Contains("--stone-corners-raw") ? 0 : Mesh.ArrayFormat.FlagCompressAttributes);
                    mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, Rows(Path.Combine(folder, surface.GetProperty("file").GetString()!), custom, instance.GlobalTransform), null, null, flags);
                    string materialPath = surface.GetProperty("material").GetString()!;
                    mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, materials.TryGetValue(materialPath, out var made) ? made : ResourceLoader.Load<Material>(materialPath));
                }
                swaps.Add((instance, old, mesh));
                notes.Add(new { mode = "candidate", mesh = entry.Name, node = instance.GetPath().ToString(), surfaces = mesh.GetSurfaceCount() });
            }
        return swaps;
    }

    static Godot.Collections.Array Rows(string file, bool custom0, Transform3D transform)
    {
        var bytes = File.ReadAllBytes(file); var data = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, data, 0, bytes.Length); int count = data.Length / 16;
        var pos = new Vector3[count]; var norm = new Vector3[count]; var uv = new Vector2[count]; var uv2 = new Vector2[count]; var col = new Color[count]; var custom = new float[count * 2]; var inv = transform.AffineInverse();
        for (int i = 0; i < count; i++)
        {
            int j = i * 16; pos[i] = inv * new Vector3(data[j], data[j + 1], data[j + 2]);
            norm[i] = (transform.Basis.Transposed() * new Vector3(data[j + 3], data[j + 4], data[j + 5])).Normalized();
            uv[i] = new(data[j + 6], data[j + 7]); uv2[i] = new(data[j + 8], data[j + 9]); col[i] = new(data[j + 10], data[j + 11], data[j + 12], data[j + 13]);
            custom[i * 2] = data[j + 14]; custom[i * 2 + 1] = data[j + 15];
        }
        var a = new Godot.Collections.Array(); a.Resize((int)Mesh.ArrayType.Max);
        a[(int)Mesh.ArrayType.Vertex] = pos; a[(int)Mesh.ArrayType.Normal] = norm; a[(int)Mesh.ArrayType.TexUV] = uv; a[(int)Mesh.ArrayType.TexUV2] = uv2; a[(int)Mesh.ArrayType.Color] = col;
        if (custom0) a[(int)Mesh.ArrayType.Custom0] = custom;
        return a;
    }
}
