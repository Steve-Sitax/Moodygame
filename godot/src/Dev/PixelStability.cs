using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Opt-in diagnosis of the strict pixel check; no tolerance or player rendering changes.</summary>
public static class PixelStability
{
    private static string V(Variant v) => v.VariantType switch
    {
        Variant.Type.Float => v.AsDouble().ToString("R", CultureInfo.InvariantCulture),
        Variant.Type.Vector2 => string.Join(",", new[] { v.AsVector2().X, v.AsVector2().Y }.Select(F)),
        Variant.Type.Vector3 => string.Join(",", new[] { v.AsVector3().X, v.AsVector3().Y, v.AsVector3().Z }.Select(F)),
        Variant.Type.Vector4 => string.Join(",", new[] { v.AsVector4().X, v.AsVector4().Y, v.AsVector4().Z, v.AsVector4().W }.Select(F)),
        Variant.Type.Color => string.Join(",", new[] { v.AsColor().R, v.AsColor().G, v.AsColor().B, v.AsColor().A }.Select(F)),
        Variant.Type.Projection => string.Join(";", new[] { v.AsProjection().X, v.AsProjection().Y, v.AsProjection().Z, v.AsProjection().W }.Select(x => V(Variant.From(x)))),
        _ => v.ToString()
    };
    private static string F(float f) => f.ToString("R", CultureInfo.InvariantCulture);
    private static Dictionary<string, string> State()
    {
        var s = new Dictionary<string, string>();
        const BindingFlags flags = BindingFlags.Static | BindingFlags.NonPublic;
        var globals = (Dictionary<string, Variant>)typeof(UniformUpdates).GetField("globals", flags)!.GetValue(null)!;
        foreach (var p in globals) s["global/" + p.Key] = V(p.Value);
        var materials = (Dictionary<(ShaderMaterial material, string name), Variant>)typeof(UniformUpdates).GetField("materials", flags)!.GetValue(null)!;
        foreach (var p in materials)
            if (GodotObject.IsInstanceValid(p.Key.material)) s[$"material/{p.Key.material.GetInstanceId()}/{p.Key.name}"] = V(p.Key.material.GetShaderParameter(p.Key.name));
        foreach (var n in BakedWorld.All(Main.I.View))
        {
            string key = n.GetPath().ToString();
            if (n is Node3D node)
            {
                var t = node.GlobalTransform;
                s[key + "/pose"] = string.Join(";", new[] { t.Basis.X, t.Basis.Y, t.Basis.Z, t.Origin }.Select(x => V(Variant.From(x))));
                s[key + "/visible"] = node.IsVisibleInTree().ToString();
            }
            if (n is Camera3D camera) s[key + "/camera"] = string.Join(",", F(camera.Fov), F(camera.Near), F(camera.Far), camera.CullMask);
            if (n is Light3D light) s[key + "/light"] = V(Variant.From(light.LightColor)) + ";" + F(light.LightEnergy);
        }
        return s;
    }
    private static object Difference(Image a, Image b)
    {
        a.Convert(Image.Format.Rgba8); b.Convert(Image.Format.Rgba8);
        if (a.GetSize() != b.GetSize()) throw new InvalidOperationException("image dimensions changed");
        var x = a.GetData(); var y = b.GetData(); int pixels = 0, max = 0; long light = 0;
        var examples = new List<object>();
        for (int i = 0; i < x.Length; i += 4)
        {
            light += x[i] + x[i + 1] + x[i + 2];
            if (x.AsSpan(i, 4).SequenceEqual(y.AsSpan(i, 4))) continue;
            pixels++;
            for (int c = 0; c < 4; c++) max = Math.Max(max, Math.Abs(x[i + c] - y[i + c]));
            if (examples.Count < 32) examples.Add(new { x = (i / 4) % a.GetWidth(), y = (i / 4) / a.GetWidth(), before = x.Skip(i).Take(4).ToArray(), after = y.Skip(i).Take(4).ToArray() });
        }
        if (light == 0) throw new InvalidOperationException("empty black capture");
        return new { pixels, maxChannelDelta = max, examples };
    }
    public static async Task<object> Run(Checks check)
    {
        string output = Main.I.Arg("pixelcheck"); Directory.CreateDirectory(output);
        var rows = new List<object>();
        bool oldCached = UniformUpdates.Cached, oldSpeed = SpeedComparison.Cached;
        check.ProcessMode = Node.ProcessModeEnum.Always;
        async Task Draw()
        {
            for (int i = 0; i < 4; i++)
            {
                Main.I.GetNodeOrNull<Mirrors>("Mirrors")?._Process(0);
                await check.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            }
        }
        void Apply(bool cached)
        {
            UniformUpdates.Cached = cached; SpeedComparison.Cached = cached; Town.WalkMap.CachedRouteLinks = cached;
            Daylight.I.RepeatLight(); Lights.I._Process(0); Rooms.I.RepeatVisibility(); Play.Jobs.I._Process(0); Play.Interact.I.RepeatPrompt(); UniformUpdates.Replay(); NodeUpdates.Replay(); Movers.Copies.Replay();
        }
        try
        {
            foreach (var (hour, weather) in new[] { (13.0, "clear"), (22.0, "mist") })
            {
                Main.I.GetTree().Paused = false; Main.I.PictureTime(-1);
                foreach (string place in new[] { "grote markt", "cathedral", "handschoenmarkt" }) { await Kit.I.Light(hour, weather); check.At(place); await check.Frames(120); }
                Main.I.PictureTime(12); Main.I.GetTree().Paused = true;
                string label = hour == 13 ? "day" : "night";
                var shots = new Dictionary<string, (Image raw, Image final)>();
                Dictionary<string, string>? previous = null;
                try
                {
                    foreach (var (name, apply, cached) in new[] { ("A0", true, false), ("Bearly", true, true), ("Aearly", true, false), ("A1", false, false), ("A2", true, false), ("B0", true, true), ("B1", false, true), ("B2", true, true), ("A3", true, false) })
                    {
                        if (apply) Apply(cached);
                        await Draw();
                        var raw = Main.I.View.GetTexture().GetImage(); var final = Main.I.GetViewport().GetTexture().GetImage();
                        raw.SavePng(Path.Combine(output, label + "-" + name + "-raw.png")); final.SavePng(Path.Combine(output, label + "-" + name + "-final.png"));
                        shots[name] = (raw, final);
                        var state = State();
                        File.WriteAllText(Path.Combine(output, label + "-" + name + "-state.json"), JsonSerializer.Serialize(state));
                        if (previous != null) rows.Add(new { label, name, changes = state.Where(p => !previous.TryGetValue(p.Key, out var v) || v != p.Value).ToArray(), removed = previous.Keys.Except(state.Keys).ToArray() });
                        previous = state;
                    }
                    foreach (var (a, b) in new[] { ("A0", "Bearly"), ("Bearly", "Aearly"), ("A0", "Aearly"), ("Aearly", "A1"), ("A1", "A2"), ("A2", "B0"), ("B0", "B1"), ("B1", "B2"), ("B2", "A3"), ("A0", "A3") })
                        rows.Add(new { label, a, b, raw = Difference(shots[a].raw, shots[b].raw), final = Difference(shots[a].final, shots[b].final) });
                    var fog = UniformUpdates.LatestGlobal("psx_fog_color");
                    Psx.Set("psx_fog_color", new Vector4(1, 0, 1, 1)); await Draw();
                    using var wrong = Main.I.GetViewport().GetTexture().GetImage();
                    rows.Add(new { label, positiveControl = Difference(shots["A3"].final, wrong) });
                    Psx.Set("psx_fog_color", fog);
                }
                finally { foreach (var shot in shots.Values) { shot.raw.Dispose(); shot.final.Dispose(); } }
            }
        }
        finally { UniformUpdates.Cached = oldCached; SpeedComparison.Cached = oldSpeed; Town.WalkMap.CachedRouteLinks = !Main.I.Flag("route-original"); Main.I.PictureTime(-1); Main.I.GetTree().Paused = false; }
        // Diagnostic completion is not a pixel acceptance pass.
        return new { ok = false, diagnosticComplete = true, rows };
    }
}
