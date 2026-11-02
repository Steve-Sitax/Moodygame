using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;

// Issue #199: the Stadspark's path gravel (park_nature/park_ground_gravel: the town's r001150, park_gravel) drew 3 to 8 cm
// pebbles with a 3 cm parallax, lit as domes: from eye height the paths read as dark cobbles. Its pictures are redrawn as
// fine rolled gravel in a sandy binder (art-source/park-gravel-20261102, installed by texture-repair.tscn); here only the
// material's relief numbers follow them (parallax, relief light, dome): same shader, so no new kind; meshes untouched.
//   godot --rendering-method forward_plus --path . res://scripts/park-gravel-repair.tscn -- --backup <folder>
// The original is copied to --backup first and never overwritten.
public partial class ParkGravelRepair : Node
{
    const string MatPath = "res://world/town/resources/r001150.res";
    // the numbers before: relief_depth 0.03, relief_bump 2.8, relief_dome 2.5 (the stones in the new picture stand 2 to 6
    // mm out of the binder, rolled flat)
    static readonly (string Name, Variant Value)[] Values =
    {
        ("relief_depth", 0.009f),
        ("relief_bump", 2.0f),
        ("relief_dome", 0.8f),
    };
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Park gravel repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
        var m = ResourceLoader.Load<ShaderMaterial>(MatPath, null, ResourceLoader.CacheMode.Ignore);
        if (m.ResourceName != "park_gravel" || m.GetShaderParameter("relief_h").VariantType == Variant.Type.Nil) throw new IOException("Not the park gravel's material: " + MatPath);
        string code = m.Shader.Code;
        foreach (var (n, v) in Values) GD.Print($"park gravel: {n} {m.GetShaderParameter(n)} -> {v}");
        if (args.Contains("--find")) return;
        Directory.CreateDirectory(backup);
        string to = Path.Combine(backup, Path.GetFileName(MatPath));
        if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
        GD.Print($"park gravel: original {MatPath} {Hash(MatPath)}");
        File.Copy(ProjectSettings.GlobalizePath(MatPath), to, false);
        foreach (var (n, v) in Values) m.SetShaderParameter(n, v);
        m.TakeOverPath(MatPath);
        if (ResourceSaver.Save(m, MatPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(MatPath);
        var back = ResourceLoader.Load<ShaderMaterial>(MatPath, null, ResourceLoader.CacheMode.Ignore);
        if (back.Shader.Code != code) throw new IOException("The shader's code changed: " + MatPath);
        foreach (var (n, v) in Values) if (!back.GetShaderParameter(n).Equals(v)) throw new IOException($"Reload differs: {n}");
        GD.Print($"park gravel: installed {MatPath} {Hash(MatPath)}");
    }
}
