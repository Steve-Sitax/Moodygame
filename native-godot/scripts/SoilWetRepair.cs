using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issue #244: the town's bare earth gets a real soil, wet and dry. The park's relief ground shader (r000002: the park's lawn,
// gravel and mud, the churchyard's gravel) is an older stored copy of the psx generator's ground code, so the soil lines
// (Psx.SoilLines) are put into the stored code at their anchors rather than generating it again (which would also bring
// the newer puddle hollows to the park): one kind, changed in place, no new kind. The lines are off unless a material sets
// `soil`, so the park and the churchyard draw as before. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/soil-wet-repair.tscn -- --backup <folder> [--find]
// --find only checks the anchors. The original is copied to --backup first and never overwritten.
public partial class SoilWetRepair : Node
{
    const string ShaderPath = "res://world/town/resources/r000002.res";
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Soil wet repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        var shader = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        string old = N(shader.Code);
        if (Psx.WithoutSoil(old) != old) { GD.Print("soil: the resource has the soil lines already"); return; }
        string code = Psx.WithSoil(old);
        if (Psx.WithoutSoil(code) != old) throw new InvalidOperationException("The soil lines do not come out again cleanly.");
        GD.Print($"soil: {Psx.SoilLines.Length} places found, {code.Length - old.Length} characters to add");
        if (args.Contains("--find")) return;
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
        Directory.CreateDirectory(backup);
        string to = Path.Combine(backup, Path.GetFileName(ShaderPath));
        if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
        GD.Print($"soil: original {ShaderPath} {Hash(ShaderPath)}");
        File.Copy(ProjectSettings.GlobalizePath(ShaderPath), to, false);
        shader.Code = code;
        shader.TakeOverPath(ShaderPath);
        if (ResourceSaver.Save(shader, ShaderPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(ShaderPath);
        var back = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        if (N(back.Code) != code) throw new IOException("Reload differs: " + ShaderPath);
        GD.Print($"soil: installed {ShaderPath} {Hash(ShaderPath)}");
    }
}
