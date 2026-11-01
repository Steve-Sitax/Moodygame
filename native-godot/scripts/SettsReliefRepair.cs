using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;

// Issue #238: the town's street setts (city/ground_cobble: the town's r000024, material_2) read swollen and too big up
// close. Their 3 m relief tile drew stones of about 29 x 17 cm with 6 to 7 cm joints, domed crowns lit as hard as the
// sun, and a 2.5 cm parallax. 1873 Antwerp setts (Quenast and Lessines porphyry) are about 14 to 16 cm wide and 18 to
// 22 cm long, close-jointed, their crowns worn flat. Only the material's numbers change (uv scale, relief light, crown
// dome, parallax depth): same shader, so no new kind; meshes, ids and placements untouched. Run in Forward+:
//   godot --rendering-method forward_plus --path . res://scripts/setts-relief-repair.tscn -- --backup <folder>
// The original is copied to --backup first and never overwritten.
public partial class SettsReliefRepair : Node
{
    const string MatPath = "res://world/town/resources/r000024.res";
    // the numbers before: uv_xform (1, 1, 0, 0), relief_bump 2.6, relief_dome 2.5, relief_depth 0.025, relief_holes 1
    // (holes: a stone gone or sunk is drawn per stone; at 1.4 there are about twice as many stones a square metre, and
    // the lighter stone shows each hole: 0.35 leaves about two thirds of the holes a square metre there were)
    static readonly (string Name, Variant Value)[] Values =
    {
        ("uv_xform", new Vector4(1.4f, 1.4f, 0, 0)),
        ("relief_bump", 1.6f),
        ("relief_dome", 1.0f),
        ("relief_depth", 0.014f),
        ("relief_holes", 0.35f),
    };
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Setts relief repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
        var m = ResourceLoader.Load<ShaderMaterial>(MatPath, null, ResourceLoader.CacheMode.Ignore);
        if (m.ResourceName != "material_2" || m.GetShaderParameter("relief_h").VariantType == Variant.Type.Nil) throw new IOException("Not the street setts' material: " + MatPath);
        string code = m.Shader.Code;
        foreach (var (n, v) in Values) GD.Print($"setts: {n} {m.GetShaderParameter(n)} -> {v}");
        if (args.Contains("--find")) return;
        Directory.CreateDirectory(backup);
        string to = Path.Combine(backup, Path.GetFileName(MatPath));
        if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
        GD.Print($"setts: original {MatPath} {Hash(MatPath)}");
        File.Copy(ProjectSettings.GlobalizePath(MatPath), to, false);
        foreach (var (n, v) in Values) m.SetShaderParameter(n, v);
        m.TakeOverPath(MatPath);
        if (ResourceSaver.Save(m, MatPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(MatPath);
        var back = ResourceLoader.Load<ShaderMaterial>(MatPath, null, ResourceLoader.CacheMode.Ignore);
        if (back.Shader.Code != code) throw new IOException("The shader's code changed: " + MatPath);
        foreach (var (n, v) in Values) if (!back.GetShaderParameter(n).Equals(v)) throw new IOException($"Reload differs: {n}");
        GD.Print($"setts: installed {MatPath} {Hash(MatPath)}");
    }
}
