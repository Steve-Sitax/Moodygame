using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issue #201: the vlieten's and the canal's foul water mirrored a bright, milky sky. The two stored water shaders (r001377: the
// river, canals and vlieten; r001104: the calm low-water sheets, the tide pools and the park pond) get Psx.MurkLines in place:
// two kinds changed in place, no new kind. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/murk-repair.tscn -- --backup <folder> [--find]
// --find only checks the old texts. The originals are copied to --backup first and never overwritten.
public partial class MurkRepair : Node
{
    static readonly string[] ShaderPaths = { "res://world/town/resources/r001377.res", "res://world/town/resources/r001104.res" };
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Kind(string code) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code)))[..16];
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Murk repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        foreach (string path in ShaderPaths)
        {
            var shader = ResourceLoader.Load<Shader>(path, null, ResourceLoader.CacheMode.Ignore);
            string old = N(shader.Code);
            if (old.Contains("murk_f")) { GD.Print($"murk: {path} has the murk lines already"); continue; }
            string code = Psx.WithMurk(old);
            GD.Print($"murk: {path}: {Psx.MurkLines.Length} places found, {code.Length - old.Length} characters more");
            if (args.Contains("--find")) continue;
            int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
            Directory.CreateDirectory(backup);
            string to = Path.Combine(backup, Path.GetFileName(path));
            if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
            GD.Print($"murk: original {path} {Hash(path)}");
            File.Copy(ProjectSettings.GlobalizePath(path), to, false);
            shader.Code = code;
            shader.TakeOverPath(path);
            if (ResourceSaver.Save(shader, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            var back = ResourceLoader.Load<Shader>(path, null, ResourceLoader.CacheMode.Ignore);
            if (N(back.Code) != code) throw new IOException("Reload differs: " + path);
            GD.Print($"murk: installed {path} {Hash(path)}; kind shader:{Kind(old)} -> shader:{Kind(code)}");
        }
    }
}
