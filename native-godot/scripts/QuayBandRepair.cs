using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issue #201: the town's quay walls (town/city/quay_walls and quay_steps, material quay_wall) read as one flat tile repeated,
// one tone top to bottom. The quay wall's stored shader (r000047) gets Psx.QuayBandLines at their anchors (one kind changed in
// place, no new kind; off unless a material sets `quay_band`), and the quay_wall material (r000052) sets quay_band 1.
// Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/quay-band-repair.tscn -- --backup <folder> [--find]
// The second pass (#201: the blocks shuffled at their joints, their arrises and joints) takes the first pass's lines out first.
// --find only checks the anchors. The originals are copied to --backup first and never overwritten.
public partial class QuayBandRepair : Node
{
    const string ShaderPath = "res://world/town/resources/r000047.res";
    const string MaterialPath = "res://world/town/resources/r000052.res";
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Kind(string code) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code)))[..16];
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Quay band repair stopped: " + e); GetTree().Quit(1); }
    }

    static void Backup(string path, string backup)
    {
        Directory.CreateDirectory(backup);
        string to = Path.Combine(backup, Path.GetFileName(path));
        if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
        GD.Print($"quay band: original {path} {Hash(path)}");
        File.Copy(ProjectSettings.GlobalizePath(path), to, false);
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        bool find = args.Contains("--find");
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : find ? "" : throw new ArgumentException("--backup");
        var shader = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        string old = N(shader.Code);
        if (old.Contains("qb_shuffle")) GD.Print("quay band: the shader has the second pass's lines already");
        else
        {
            string code = Psx.WithQuayBand(old);
            GD.Print($"quay band: {Psx.QuayBandLines.Length} places found, {code.Length - old.Length} characters to add");
            if (!find)
            {
                Backup(ShaderPath, backup);
                shader.Code = code;
                shader.TakeOverPath(ShaderPath);
                if (ResourceSaver.Save(shader, ShaderPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(ShaderPath);
                var back = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
                if (N(back.Code) != code) throw new IOException("Reload differs: " + ShaderPath);
                GD.Print($"quay band: installed {ShaderPath} {Hash(ShaderPath)}; kind shader:{Kind(old)} -> shader:{Kind(code)}");
            }
        }
        if (find) return;
        var material = ResourceLoader.Load<ShaderMaterial>(MaterialPath, null, ResourceLoader.CacheMode.Ignore);
        if (material.ResourceName != "quay_wall") throw new InvalidOperationException("Not the quay wall material: " + material.ResourceName);
        if (material.GetShaderParameter("quay_band").VariantType != Variant.Type.Nil && material.GetShaderParameter("quay_band").AsSingle() > 0) { GD.Print("quay band: the material sets it already"); return; }
        Backup(MaterialPath, backup);
        material.SetShaderParameter("quay_band", 1.0f);
        if (ResourceSaver.Save(material, MaterialPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(MaterialPath);
        var again = ResourceLoader.Load<ShaderMaterial>(MaterialPath, null, ResourceLoader.CacheMode.Ignore);
        if (again.GetShaderParameter("quay_band").AsSingle() != 1f || again.Shader.ResourcePath != ShaderPath) throw new IOException("Material reload differs: " + MaterialPath);
        GD.Print($"quay band: material {MaterialPath} sets quay_band 1, {Hash(MaterialPath)}");
    }
}
