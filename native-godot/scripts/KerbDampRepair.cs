using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issues #245 and #233: the town's stone (r000204: the town blocks' kerbs, door steps, sills, plinths and quoins) laid
// two rising damps and a muck band on every low face, so a kerb face drew near black. Psx.KerbLines keep both damps for
// a face with a house right behind or before it and give a stone standing free of a house only the street's dirt at
// its foot. The lines go into the stored code at their anchors (one kind, changed in place, no new kind). Run in
// Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/kerb-damp-repair.tscn -- --backup <folder> [--find]
// --find only checks the anchors. The original is copied to --backup first and never overwritten.
public partial class KerbDampRepair : Node
{
    const string ShaderPath = "res://world/town/resources/r000204.res";
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Kerb damp repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        var shader = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        string old = N(shader.Code);
        if (Psx.WithoutKerbs(old) != old) { GD.Print("kerbs: the resource has the kerb lines already"); return; }
        string code = Psx.WithKerbs(old);
        if (Psx.WithoutKerbs(code) != old) throw new InvalidOperationException("The kerb lines do not come out again cleanly.");
        GD.Print($"kerbs: {Psx.KerbLines.Length} places found, {code.Length - old.Length} characters to add");
        if (args.Contains("--find")) return;
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
        Directory.CreateDirectory(backup);
        string to = Path.Combine(backup, Path.GetFileName(ShaderPath));
        if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
        GD.Print($"kerbs: original {ShaderPath} {Hash(ShaderPath)}");
        File.Copy(ProjectSettings.GlobalizePath(ShaderPath), to, false);
        shader.Code = code;
        shader.TakeOverPath(ShaderPath);
        if (ResourceSaver.Save(shader, ShaderPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(ShaderPath);
        var back = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        if (N(back.Code) != code) throw new IOException("Reload differs: " + ShaderPath);
        GD.Print($"kerbs: installed {ShaderPath} {Hash(ShaderPath)}");
    }
}
