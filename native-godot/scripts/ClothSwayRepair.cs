using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issue #164: the washing on the lines sways in the wind. Its cloth is the town's wet-paint kind (Psx.WetPaint: the solid
// lit shader r000211, shared with the shaders the game generates for that kind); Psx now adds the sway to that kind, off
// unless a material sets `cloth_sway`. This writes the same generated code into the stored resource, so the two stay one
// kind (changed in place: no new shader kind). Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/cloth-sway-repair.tscn -- --backup <folder> [--find]
// --find only prints the kinds whose generated code (without the sway) is the resource's. The original is copied to --backup
// first and never overwritten.
public partial class ClothSwayRepair : Node
{
    const string ShaderPath = "res://world/town/resources/r000211.res";
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Cloth sway repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        var shader = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        string old = shader.Code;
        var kinds = Enumerable.Range(0, 1 << 10).Select(m => new Psx.Kind((m & 1) != 0, (m & 2) != 0, (m & 4) != 0, (m & 8) != 0, (m & 16) != 0, (m & 32) != 0, 0, (m & 64) != 0, (m & 128) != 0, (m & 256) != 0, Bump: (m & 512) != 0));
        var found = kinds.Where(k => N(Psx.WithoutClothSway(Psx.ShaderOf(k).Code)) == N(old) || N(Psx.ShaderOf(k).Code) == N(old)).ToArray();
        foreach (var k in found) GD.Print("cloth sway: the resource's kind: " + k + (Psx.WetPaint(k) ? " (wet paint)" : ""));
        if (args.Contains("--find")) return;
        if (found.Length == 0 || !found.All(Psx.WetPaint)) throw new InvalidOperationException("The resource is not the wet-paint kind's code; review Psx.WetPaint.");
        string code = Psx.ShaderOf(found[0]).Code;
        if (N(code) == N(old)) { GD.Print("cloth sway: the resource has the sway already"); return; }
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
        Directory.CreateDirectory(backup);
        string to = Path.Combine(backup, Path.GetFileName(ShaderPath));
        if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
        GD.Print($"cloth sway: original {ShaderPath} {Hash(ShaderPath)}");
        File.Copy(ProjectSettings.GlobalizePath(ShaderPath), to, false);
        shader.Code = code;
        shader.TakeOverPath(ShaderPath);
        if (ResourceSaver.Save(shader, ShaderPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(ShaderPath);
        var back = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        if (back.Code != code) throw new IOException("Reload differs: " + ShaderPath);
        GD.Print($"cloth sway: installed {ShaderPath} {Hash(ShaderPath)}");
    }
}
