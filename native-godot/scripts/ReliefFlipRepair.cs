using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

/// <summary>#225: flip the relief pictures the bake stored upside down against their colour pictures
/// (recovery/relief-flip-20261102.json). Run relief-flip-repair.tscn -- --record &lt;dir outside the checkout&gt;.
/// Refuses a relief whose bytes are not the recorded "before" (so it never flips one twice).</summary>
public partial class ReliefFlipRepair : Node
{
    public override void _Ready()
    {
        try { Flip(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }

    void Flip()
    {
        var args = OS.GetCmdlineUserArgs(); int at = Array.IndexOf(args, "--record");
        if (at < 0 || at + 1 >= args.Length) throw new ArgumentException("--record is required");
        string output = args[at + 1]; Directory.CreateDirectory(output);
        using var plan = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://recovery/relief-flip-20261102.json")));
        var reliefs = plan.RootElement.GetProperty("reliefs").EnumerateArray().Select(r => (Path: r.GetProperty("relief").GetString()!, Before: r.GetProperty("before").GetString()!, Fade: r.TryGetProperty("fadeFar", out var f) && f.GetBoolean())).ToArray();
        foreach (var r in reliefs)
        {
            string file = ProjectSettings.GlobalizePath(r.Path);
            if (Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))) != r.Before) throw new InvalidDataException($"{r.Path} is not the recorded original (already flipped?)");
        }
        var records = new List<object>();
        foreach (var r in reliefs)
        {
            string file = ProjectSettings.GlobalizePath(r.Path);
            var before = File.ReadAllBytes(file);
            File.WriteAllBytes(Path.Combine(output, Path.GetFileName(file)), before);
            var texture = ResourceLoader.Load<ImageTexture>(r.Path, null, ResourceLoader.CacheMode.Ignore) ?? throw new InvalidDataException(r.Path);
            var image = texture.GetImage();
            bool mips = image.HasMipmaps();
            if (image.IsCompressed()) throw new InvalidDataException($"{r.Path}: compressed relief");
            image.ClearMipmaps(); image.FlipY();
            if (mips && r.Fade) image = FadedMips(image);
            else if (mips) image.GenerateMipmaps();
            var flipped = ImageTexture.CreateFromImage(image); flipped.ResourceName = texture.ResourceName;
            if (ResourceSaver.Save(flipped, r.Path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(r.Path);
            records.Add(new { relief = r.Path, fadeFar = r.Fade, before = r.Before, after = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))) });
        }
        File.WriteAllText(Path.Combine(output, "flip.json"), JsonSerializer.Serialize(records, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Relief flip: {records.Count} reliefs turned top to bottom ({reliefs.Count(r => r.Fade)} with their far mip levels flattened); originals in {output}");
    }

    /// <summary>The relief's mip chain built level by level, each level's relief flattened toward its mean by
    /// FadeAt[level] (what a pixel cannot resolve far off then does not sparkle).</summary>
    static readonly float[] FadeAt = { 1f, 1f, 0.6f, 0.35f, 0.2f, 0.1f };
    static Image FadedMips(Image top)
    {
        if (top.GetFormat() != Image.Format.Rgba8) top.Convert(Image.Format.Rgba8);
        var data = new List<byte>(); var level = (Image)top.Duplicate();
        int w = top.GetWidth(), h = top.GetHeight(), n = 0;
        while (true)
        {
            var bytes = level.GetData();
            float k = FadeAt[Math.Min(n, FadeAt.Length - 1)];
            if (k < 1f)
            {
                var mean = new double[3];
                for (int i = 0; i < bytes.Length; i += 4) for (int c = 0; c < 3; c++) mean[c] += bytes[i + c];
                for (int c = 0; c < 3; c++) mean[c] /= bytes.Length / 4;
                for (int i = 0; i < bytes.Length; i += 4) for (int c = 0; c < 3; c++) bytes[i + c] = (byte)Math.Clamp(Math.Round(mean[c] + (bytes[i + c] - mean[c]) * k), 0, 255);
            }
            data.AddRange(bytes);
            if (w == 1 && h == 1) break;
            w = Math.Max(1, w / 2); h = Math.Max(1, h / 2); n++;
            // each level from the last unflattened one, so the flattening does not compound
            level = (Image)top.Duplicate(); level.Resize(w, h, Image.Interpolation.Lanczos);
        }
        var made = Image.CreateFromData(top.GetWidth(), top.GetHeight(), true, Image.Format.Rgba8, data.ToArray());
        return made;
    }
}
