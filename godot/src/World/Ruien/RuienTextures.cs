using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The Ruien's material families as game textures (docs/ruien-native.md). The Blender export writes one tiling set per
/// family (export/textures/texture_sets.json: albedo, normal, 16-bit height, roughness, AO, and for the brick its slimed
/// and limed colours); the game keeps, per family, the albedo (and the brick's two), the normal's two slopes and one
/// packed picture (R height, G roughness, B AO), mipmapped and compressed as the card reads them, in
/// res://world/ruien/textures (family.json says which and how big a tile is). Made once by
/// `-- --ruien-textures &lt;export/textures&gt;` (it writes and quits); the game only loads them.
/// </summary>
public static class RuienTextures
{
    public const string Dir = "res://world/ruien/textures";

    public sealed record Family(string Name, float TileU, float TileV, float Relief, bool Variants);

    private static readonly Dictionary<string, Texture2D?> Loaded = new();

    public static Texture2D? Get(string family, string part)
    {
        string path = $"{Dir}/{family}_{part}.res";
        if (Loaded.TryGetValue(path, out var t)) return t;
        t = ResourceLoader.Exists(path) ? ResourceLoader.Load<Texture2D>(path) : null;
        Loaded[path] = t;
        return t;
    }

    public static Dictionary<string, Family> Families()
    {
        var map = new Dictionary<string, Family>();
        string file = Dir + "/families.json";
        if (!Godot.FileAccess.FileExists(file)) return map;
        foreach (var f in JsonDocument.Parse(Godot.FileAccess.GetFileAsString(file)).RootElement.EnumerateObject())
            map[f.Name] = new Family(f.Name, f.Value.GetProperty("tile")[0].GetSingle(), f.Value.GetProperty("tile")[1].GetSingle(), f.Value.GetProperty("relief").GetSingle(), f.Value.GetProperty("variants").GetBoolean());
        return map;
    }

    /// <summary>Convert an export's texture sets (absolute folder) into the game's; the families converted.</summary>
    public static List<string> Convert(string src)
    {
        var done = new List<string>();
        string dst = ProjectSettings.GlobalizePath(Dir);
        Directory.CreateDirectory(dst);
        var sets = JsonDocument.Parse(File.ReadAllText(Path.Combine(src, "texture_sets.json"))).RootElement;
        var families = new Dictionary<string, object>();
        foreach (var fam in sets.EnumerateObject())
        {
            string name = fam.Name;
            var files = fam.Value.GetProperty("files").EnumerateArray().Select(f => f.GetString()!).ToList();
            string Of(string suffix) => Path.Combine(src, files.First(f => f.EndsWith("_" + suffix + ".png")));
            bool variants = files.Any(f => f.EndsWith("_albedo_slime.png"));
            var t0 = Time.GetTicksMsec();
            limit = WidthFor(name);
            Save(Colour(Of("albedo")), $"{dst}/{name}_albedo.res");
            if (variants)
            {
                Save(Colour(Of("albedo_slime")), $"{dst}/{name}_slime.res");
                Save(Colour(Of("albedo_lime")), $"{dst}/{name}_lime.res");
            }
            Save(Normal(Of("normal")), $"{dst}/{name}_normal.res");
            Save(Packed(Of("height"), Of("roughness"), Of("ao")), $"{dst}/{name}_hra.res");
            var tile = fam.Value.GetProperty("tile_m");
            families[name] = new { tile = new[] { tile[0].GetSingle(), tile[1].GetSingle() }, relief = fam.Value.GetProperty("relief_m").GetSingle(), variants };
            GD.Print($"ruien textures: {name} in {Time.GetTicksMsec() - t0} ms");
            done.Add(name);
        }
        File.WriteAllText(Path.Combine(dst, "families.json"), JsonSerializer.Serialize(families, new JsonSerializerOptions { WriteIndented = true }) + "\n");
        return done;
    }

    /// <summary>
    /// How wide a family's pictures are kept (px): the brick, which fills most of every view, at its full 2048; the rest
    /// at 1024 (2 to 4 mm a pixel on their tiles), so the area's resources stay within the repository's budget.
    /// </summary>
    public static int WidthFor(string family) => family.StartsWith("brick") ? 2048 : 1024;
    private static int limit = 2048;

    private static Image Load(string file)
    {
        var im = Image.LoadFromFile(file);
        if (im.IsCompressed()) im.Decompress();
        if (im.GetWidth() > limit) im.Resize(limit, Math.Max(1, (int)MathF.Round(im.GetHeight() * (float)limit / im.GetWidth())), Image.Interpolation.Lanczos);
        return im;
    }

    private static Image Colour(string file)
    {
        var im = Load(file);
        im.Convert(Image.Format.Rgb8);
        im.GenerateMipmaps();
        im.Compress(Image.CompressMode.Bptc, Image.CompressSource.Srgb);
        return im;
    }

    private static Image Normal(string file)
    {
        var im = Load(file);
        im.Convert(Image.Format.Rgb8);
        im.GenerateMipmaps(true);
        im.Compress(Image.CompressMode.S3Tc, Image.CompressSource.Normal);
        return im;
    }

    private static Image Packed(string height, string rough, string ao)
    {
        var h = Load(height); h.Convert(Image.Format.L8);
        var r = Load(rough); r.Convert(Image.Format.L8);
        var a = Load(ao); a.Convert(Image.Format.L8);
        int w = h.GetWidth(), hh = h.GetHeight();
        if (r.GetWidth() != w || r.GetHeight() != hh) r.Resize(w, hh, Image.Interpolation.Cubic);
        if (a.GetWidth() != w || a.GetHeight() != hh) a.Resize(w, hh, Image.Interpolation.Cubic);
        byte[] hd = h.GetData(), rd = r.GetData(), ad = a.GetData();
        var o = new byte[w * hh * 3];
        for (int i = 0; i < w * hh; i++) { o[i * 3] = hd[i]; o[i * 3 + 1] = rd[i]; o[i * 3 + 2] = ad[i]; }
        var im = Image.CreateFromData(w, hh, false, Image.Format.Rgb8, o);
        im.GenerateMipmaps();
        im.Compress(Image.CompressMode.Bptc, Image.CompressSource.Generic);
        return im;
    }

    private static void Save(Image im, string file)
    {
        var tex = ImageTexture.CreateFromImage(im);
        var err = ResourceSaver.Save(tex, file, ResourceSaver.SaverFlags.Compress);
        if (err != Error.Ok) throw new IOException($"ruien textures: could not write {file}: {err}");
    }
}
