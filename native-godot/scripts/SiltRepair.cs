using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issue #252: the river's mud gets Codex's tidal silt, its water laid in world space. The mud's stored shader (r001384: the
// tide band's relief ground, used by town/tide_mud alone) gets the silt lines (Psx.SiltLines) at their anchors rather than
// being generated again: one kind, changed in place, no new kind. The lines are off unless a material sets `silt`.
// Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/silt-repair.tscn -- --backup <folder> [--find]
// --find only checks the anchors. The original is copied to --backup first and never overwritten.
public partial class SiltRepair : Node
{
    const string ShaderPath = "res://world/town/resources/r001384.res";
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Kind(string code) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code)))[..16];
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Silt repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        var shader = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        string old = N(shader.Code);
        if (Psx.WithoutSilt(old) != old) { GD.Print("silt: the resource has the silt lines already"); return; }
        string code = Psx.WithSilt(old);
        if (Psx.WithoutSilt(code) != old) throw new InvalidOperationException("The silt lines do not come out again cleanly.");
        GD.Print($"silt: {Psx.SiltLines.Length} places found, {code.Length - old.Length} characters to add");
        if (args.Contains("--find")) return;
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
        Directory.CreateDirectory(backup);
        string to = Path.Combine(backup, Path.GetFileName(ShaderPath));
        if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
        GD.Print($"silt: original {ShaderPath} {Hash(ShaderPath)}");
        File.Copy(ProjectSettings.GlobalizePath(ShaderPath), to, false);
        shader.Code = code;
        shader.TakeOverPath(ShaderPath);
        if (ResourceSaver.Save(shader, ShaderPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(ShaderPath);
        var back = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        if (N(back.Code) != code) throw new IOException("Reload differs: " + ShaderPath);
        GD.Print($"silt: installed {ShaderPath} {Hash(ShaderPath)}; kind shader:{Kind(old)} -> shader:{Kind(code)}");
    }
}
