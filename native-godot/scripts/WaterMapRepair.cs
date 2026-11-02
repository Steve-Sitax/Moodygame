using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issue #269: the river's sheet lay under the whole map, so a cellar, a light well, a Ruien gallery or a stair below high
// water showed the river through its floor. The stored river shaders get Psx.WaterMapLines in place (the water map's
// globals and its discard, the river's sheet alone): r001377, the town's river sheet (world/town); game/rijnkaai/river.res,
// the Rijnkaai district's river material (its shader is stored inside it). One kind changed in place each, no new kind.
// Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/water-map-repair.tscn -- --backup <folder> [--find]
// --find only checks the old texts. The originals are copied to --backup first and never overwritten.
public partial class WaterMapRepair : Node
{
    static readonly string[] Targets = { "res://world/town/resources/r001377.res", "res://game/rijnkaai/river.res" };
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Kind(string code) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code)))[..16];
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Water map repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        foreach (string path in Targets)
        {
            var res = ResourceLoader.Load(path, null, ResourceLoader.CacheMode.Ignore);
            var shader = res as Shader ?? (res as ShaderMaterial)?.Shader ?? throw new IOException("No shader in " + path);
            string old = N(shader.Code);
            if (old.Contains("psx_water_map")) { GD.Print($"water map: {path} has the water map already"); continue; }
            string code = Psx.WithWaterMap(old);
            GD.Print($"water map: {path}: {Psx.WaterMapLines.Length} places found, {code.Length - old.Length} characters more");
            if (args.Contains("--find")) continue;
            int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
            Directory.CreateDirectory(backup);
            string to = Path.Combine(backup, Path.GetFileName(Path.GetDirectoryName(ProjectSettings.GlobalizePath(path))) + "_" + Path.GetFileName(path));
            if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
            GD.Print($"water map: original {path} {Hash(path)}");
            File.Copy(ProjectSettings.GlobalizePath(path), to, false);
            shader.Code = code;
            if (res is Shader) shader.TakeOverPath(path);
            else res.TakeOverPath(path);
            if (ResourceSaver.Save(res, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            var back = ResourceLoader.Load(path, null, ResourceLoader.CacheMode.Ignore);
            var backShader = back as Shader ?? (back as ShaderMaterial)?.Shader;
            if (backShader == null || N(backShader.Code) != code) throw new IOException("Reload differs: " + path);
            GD.Print($"water map: installed {path} {Hash(path)}; kind shader:{Kind(old)} -> shader:{Kind(code)}");
        }
    }
}
