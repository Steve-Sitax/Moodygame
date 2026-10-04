using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Nonempty, frozen rendered pictures: original uploads versus exact cached uploads, with a positive control.</summary>
public static class PixelComparison
{
    private static int Different(Image a, Image b)
    {
        a.Convert(Image.Format.Rgba8); b.Convert(Image.Format.Rgba8);
        if (a.GetSize() != b.GetSize()) throw new InvalidOperationException("picture dimensions changed");
        var x = a.GetData(); var y = b.GetData(); int n = 0; long sum = 0;
        for (int i = 0; i < x.Length; i += 4)
        {
            sum += x[i] + x[i + 1] + x[i + 2];
            if (x[i] != y[i] || x[i + 1] != y[i + 1] || x[i + 2] != y[i + 2] || x[i + 3] != y[i + 3]) n++;
        }
        if (sum == 0) throw new InvalidOperationException("black readback: no picture compared");
        return n;
    }
    private static async Task Draw(Checks check)
    {
        Mirrors? mirrors = Main.I.GetNodeOrNull<Mirrors>("Mirrors");
        for (int i = 0; i < 4; i++)
        {
            mirrors?._Process(0);
            await check.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        }
    }
    public static async Task<object> Run(Checks check)
    {
        var rows = new List<object>(); int total = 0, controlPixels = 0;
        foreach (var (hour, weather) in new[] { (13.0, "clear"), (22.0, "mist") })
        foreach (string place in new[] { "grote markt", "cathedral", "handschoenmarkt", "vismarkt", "rijnkaai" })
        {
            await Kit.I.Light(hour, weather); check.At(place); await check.Frames(120);
            bool cached = UniformUpdates.Cached;
            check.ProcessMode = Node.ProcessModeEnum.Always;
            Main.I.PictureTime(12); Main.I.GetTree().Paused = true;
            try
            {
                string name = place.Replace(' ', '_') + (hour == 13 ? "_day" : "_night");
                UniformUpdates.Cached = false;
                Daylight.I.RepeatLight(); Lights.I._Process(0); Play.Jobs.I._Process(0); UniformUpdates.Replay(); NodeUpdates.Replay(); await Draw(check);
                using var a = Main.I.GetViewport().GetTexture().GetImage();
                string before = check.Picture(name + "_before");
                UniformUpdates.Cached = true;
                Daylight.I.RepeatLight(); Lights.I._Process(0); Play.Jobs.I._Process(0); UniformUpdates.Replay(); NodeUpdates.Replay(); await Draw(check);
                using var b = Main.I.GetViewport().GetTexture().GetImage();
                string after = check.Picture(name + "_after");
                int different = Different(a, b); total += different;
                // A deliberately wrong fog colour must be detected by the same readback and comparison.
                var fog = RenderingServer.GlobalShaderParameterGet("psx_fog_color");
                Psx.Set("psx_fog_color", new Vector4(1, 0, 1, 1)); await Draw(check);
                using var wrong = Main.I.GetViewport().GetTexture().GetImage();
                int control = Different(b, wrong); controlPixels += control;
                Psx.Set("psx_fog_color", fog);
                rows.Add(new { place, hour, weather, different, control, before, after, size = new[] { a.GetWidth(), a.GetHeight() } });
                GD.Print($"pixelcheck: {name}, {different} pixels differ, control {control}");
            }
            finally { UniformUpdates.Cached = cached; Main.I.PictureTime(-1); Main.I.GetTree().Paused = false; }
        }
        return new { ok = total == 0 && controlPixels > 0, differentPixels = total, controlPixels, comparisons = rows,
            method = "RGBA8 full screen including retro grain, paused scene and fixed grain; uncached/cached uniform and unchanged-node-pose replay, live spill/far buffers; deliberately wrong fog colour as positive control" };
    }
}
