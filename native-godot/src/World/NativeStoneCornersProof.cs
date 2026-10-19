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
    /// <summary>The clock of a view's weather: 13:00 by day and in rain, 19:45 in the evening (#174: the shops' lamps burn), 22:00 at night.</summary>
    static int Hour(string weather) => weather == "night" ? 22 : weather == "evening" ? 19 : 13;

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
            // --stone-corners-hide a,b,...: every drawn thing whose path holds one of these is hidden (what draws that?)
            if (Option("stone-corners-hide") is { Length: > 0 } hide)
                foreach (var g in BakedWorld.All(game.GetTree().Root).OfType<GeometryInstance3D>().ToArray())
                    if (hide.Split(',').Any(h => g.GetPath().ToString().Contains(h, StringComparison.Ordinal)))
                    { g.Visible = false; notes.Add(new { mode = "hidden", node = g.GetPath().ToString() }); }
            // issue #163: a town mesh rebuilt at load (a razed house cut out, a step cut) must keep Solid's stand-in and skip lists
            foreach (var m in BakedWorld.All(game.World).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh && m.Name.ToString().StartsWith("city_", StringComparison.Ordinal) && m.IsVisibleInTree()))
                if (m.Mesh!.GetSurfaceCount() > 1 && !m.Mesh.HasMeta("native_solid_skip"))
                    notes.Add(new { mode = "collision-meta", node = m.Name.ToString(), mesh = m.Mesh.ResourcePath, surfaces = m.Mesh.GetSurfaceCount() });
            notes.Add(new { mode = "memory", stage = "before candidate", bufferMemMB = Performance.GetMonitor(Performance.Monitor.RenderBufferMemUsed) / 1048576.0, videoMemMB = Performance.GetMonitor(Performance.Monitor.RenderVideoMemUsed) / 1048576.0 });
            var swaps = candidateFolder == "" ? new List<(MeshInstance3D node, Mesh before, Mesh after)>() : Candidate(game, Paths.Absolute(candidateFolder), notes);
            if (candidateFolder != "") Check("candidate meshes found in the town", swaps.Count > 0);
            // issue #188: --stone-corners-detail-toggle compares the town without its near-only detail (before) and with it
            if (OS.GetCmdlineUserArgs().Contains("--stone-corners-detail-toggle"))
                foreach (var m in BakedWorld.All(game.World).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.VisibilityRangeEnd > 0 && System.Text.RegularExpressions.Regex.IsMatch(m.Name.ToString(), "^city_-?\\d+_-?\\d+_d_\\d+$")).ToArray())
                    swaps.Add((m, new ArrayMesh(), m.Mesh!));
            await Frames(10);
            notes.Add(new { mode = "memory", stage = "candidate built", bufferMemMB = Performance.GetMonitor(Performance.Monitor.RenderBufferMemUsed) / 1048576.0, videoMemMB = Performance.GetMonitor(Performance.Monitor.RenderVideoMemUsed) / 1048576.0 });
            // --stone-corners-toggle-node a,b: nodes of these names show only with the candidate (issue #176: the new shutters)
            var toggled = Option("stone-corners-toggle-node") is { Length: > 0 } tn ? BakedWorld.All(game.World).OfType<Node3D>().Where(n => tn.Split(',').Contains(n.Name.ToString())).ToArray() : Array.Empty<Node3D>();
            void Use(bool candidate) { foreach (var s in swaps) s.node.Mesh = candidate ? s.after : s.before; foreach (var n in toggled) n.Visible = candidate; }
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
            foreach (var weather in new[] { "day", "rain", "evening", "night" })
            {
                var chosen = views.Where(v => v.Weathers.Contains(weather)).ToArray();
                if (chosen.Length == 0) continue;
                var state = await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = Hour(weather), minute = weather == "evening" ? 45 : 0, weather = weather == "rain" ? "rain" : "clear" });
                GameState.I.Apply(state); Scheldemist.Movers.MoverClock.Hold(Hour(weather), 1);
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
                    // (#184) the clock, the weather and the light are this view's before the picture (the game's own clock
                    // sync could still be on the last one), and a night view waits until the street lamps and the lit
                    // windows burn: a picture in a paused game (another window took the focus) had them all dark
                    Daylight.I.SetTime(Hour(weather) + (weather == "evening" ? 0.75f : 0f)); Daylight.I.SetWeather(weather == "rain" ? "rain" : "clear");
                    if (Pause.Paused) { notes.Add(new { mode = "pause", view = view.Name, weather, reasons = Pause.Reasons }); Pause.Clear(); }
                    Daylight.I.Settle(); await Frames(90);
                    if (weather is "night" or "evening") Check($"{view.Name}: night lights on before the picture", await Until(() => !Pause.Paused && Lights.I?.NightReady == true, 30));
                    // --stone-corners-pick fx,fy (0..1 of the picture): which drawn thing makes that pixel? Each one whose
                    // box the pixel's ray meets is hidden in turn; the ones that change the pixel are listed.
                    if (Option("stone-corners-pick") is { Length: > 0 } pick && weather == "day")
                    {
                        Use(swaps.Count > 0); // (the candidate's pixel, when there is one)
                        var f = pick.Split(',').Select(v => float.Parse(v, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                        var size = capture.GetViewport().GetVisibleRect().Size; var at = new Vector2(f[0] * size.X, f[1] * size.Y);
                        Vector3 o = capture.ProjectRayOrigin(at), d = capture.ProjectRayNormal(at);
                        async Task<Color> Pixel() { await Frames(4); await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw); using var img = game.GetViewport().GetTexture().GetImage(); int px = (int)(f[0] * img.GetWidth()), py = (int)(f[1] * img.GetHeight()); var sum = new Color(0, 0, 0, 0); for (int dy = -7; dy <= 7; dy++) for (int dx = -7; dx <= 7; dx++) sum += img.GetPixel(Math.Clamp(px + dx, 0, img.GetWidth() - 1), Math.Clamp(py + dy, 0, img.GetHeight() - 1)); return sum / 225f; }
                        var basePixel = await Pixel();
                        foreach (var g in BakedWorld.All(game.GetTree().Root).OfType<VisualInstance3D>().Where(g => g.IsVisibleInTree()).ToArray())
                        {
                            if (!GodotObject.IsInstanceValid(g) || !g.IsVisibleInTree()) continue;
                            var box = g.GlobalTransform * g.GetAabb();
                            if (box.Size.LengthSquared() > 1e6f || !box.IntersectsSegment(o, o + d * 2000)) continue;
                            g.Visible = false; var c = await Pixel(); g.Visible = true;
                            float diff = Math.Abs(c.R - basePixel.R) + Math.Abs(c.G - basePixel.G) + Math.Abs(c.B - basePixel.B);
                            notes.Add(new { mode = "pick", view = view.Name, node = g.GetPath().ToString(), mesh = (g as MeshInstance3D)?.Mesh?.ResourcePath ?? "", diff, before = basePixel.ToHtml(false), after = c.ToHtml(false) });
                        }
                    }
                    foreach (bool candidate in swaps.Count > 0 || toggled.Length > 0 ? new[] { false, true } : new[] { false })
                    {
                        Use(candidate); await Frames(12);
                        await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                        string name = $"{view.Name}-{weather}-{(candidate ? "candidate" : "before")}.png";
                        using var picture = game.GetViewport().GetTexture().GetImage();
                        if (picture.SavePng(Path.Combine(output, name)) == Error.Ok) pictures.Add(name); else Check(name + " written", false);
                    }
                    if (measure && view.Measure && weather == "day")
                        // back and forth, so a slow first pass does not count against either state
                        foreach (bool candidate in swaps.Count > 0 || toggled.Length > 0 ? new[] { false, true, false, true } : new[] { false })
                        { Use(candidate); notes.Add(new { mode = "frame", view = view.Name, result = await Measure(candidate ? "candidate" : "before") }); }
                    Use(false);
                }
            }
            capture?.QueueFree(); game.Cam.MakeCurrent();
            Check("clock and weather follow the proof", GameState.I.Hour == Hour(new[] { "night", "evening", "rain", "day" }.First(w => views.Any(v => v.Weathers.Contains(w)))));
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
                // issue #163: a surface marked "keep" stays as it is (the mesh's own surfaces come first); new ones follow
                if (list.EnumerateArray().Any(s => s.TryGetProperty("keep", out _))) mesh = (ArrayMesh)old.Duplicate();
                foreach (var surface in list.EnumerateArray())
                {
                    if (surface.TryGetProperty("keep", out _) || surface.GetProperty("vertices").GetInt32() == 0) continue;
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
