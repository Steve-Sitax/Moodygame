using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;

// Rebuilds stored ImageTextures from reworked pictures, into the same resources (their ids and every material that uses
// them unchanged; no shader changes): each keeps its stored format (BC7 sRGB stays BC7, RGBA8 stays RGBA8) and mipmaps.
//   #246: the bark atlas's fissured half lifted (art-source/plan-84/lift_fissured_bark.py)
//   #238, #223: the street setts' colour, relief and stone ids with tight joints (art-source/street-setts-20261101)
// Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/texture-repair.tscn -- --backup <folder> --set <res>=<png> [--set ...]
// Originals are copied to --backup first and never overwritten.
public partial class TextureRepair : Node
{
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Texture repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        if (DisplayServer.GetName() == "headless") throw new InvalidOperationException("Run in Forward+, not headless.");
        var args = OS.GetCmdlineUserArgs();
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
        var sets = args.Select((a, i) => (a, i)).Where(p => p.a == "--set").Select(p => args[p.i + 1].Split('=', 2)).ToArray();
        if (sets.Length == 0) throw new ArgumentException("--set <res>=<png>");
        Directory.CreateDirectory(backup);
        foreach (var s in sets)
        {
            string texPath = s[0], png = s[1];
            string to = Path.Combine(backup, Path.GetFileName(texPath));
            if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
            var tex = ResourceLoader.Load<ImageTexture>(texPath, null, ResourceLoader.CacheMode.Ignore);
            var old = tex.GetImage();
            var fmt = old.GetFormat();
            bool bc7 = fmt is Image.Format.BptcRgba;
            var img = Image.LoadFromFile(Path.IsPathRooted(png) ? png : ProjectSettings.GlobalizePath(png));
            if (bc7) img.Convert(img.DetectAlpha() != Image.AlphaMode.None ? Image.Format.Rgba8 : Image.Format.Rgb8);
            else if (old.IsCompressed()) throw new IOException("Unhandled stored format " + fmt + ": " + texPath);
            else img.Convert(fmt);
            if (old.HasMipmaps()) img.GenerateMipmaps();
            if (bc7 && img.Compress(Image.CompressMode.Bptc, Image.CompressSource.Srgb) != Error.Ok) throw new IOException("BC7 compression failed: " + png);
            GD.Print($"texture: {texPath} {old.GetSize()} {fmt} {Hash(texPath)} <- {png} {img.GetSize()}");
            File.Copy(ProjectSettings.GlobalizePath(texPath), to, false);
            tex.SetImage(img);
            tex.TakeOverPath(texPath);
            if (ResourceSaver.Save(tex, texPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(texPath);
            var back = ResourceLoader.Load<ImageTexture>(texPath, null, ResourceLoader.CacheMode.Ignore).GetImage();
            if (back.GetFormat() != img.GetFormat() || back.HasMipmaps() != old.HasMipmaps() || back.GetSize() != img.GetSize()) throw new IOException("Reload differs: " + texPath);
            GD.Print($"texture: installed {texPath} {back.GetSize()} {back.GetFormat()} {Hash(texPath)}");
        }
    }
}
