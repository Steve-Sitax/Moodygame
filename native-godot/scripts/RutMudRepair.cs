using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issue #249: deep ruts where the cart tracks cross the street mud. The ruts' stored decal kind (r004014: the town's rut
// strips and the opening bridges' decks) gets Psx.RutMudLines at their anchors; off unless a material sets rut_mud
// (NativeDirt: the town's rut strips alone). Changed in place: no new kind. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/rut-mud-repair.tscn -- --backup <folder> [--find] [--redo]
// --find only checks the anchors. The original is copied to --backup first and never overwritten; --redo puts the original
// back first and the current lines in (while tuning).
public partial class RutMudRepair : Node
{
    const string ShaderPath = "res://world/town/resources/r004014.res";
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Kind(string code) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code)))[..16];
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Rut mud repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        bool find = args.Contains("--find"), redo = args.Contains("--redo");
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : find ? "" : throw new ArgumentException("--backup");
        string to = find ? "" : Path.Combine(backup, Path.GetFileName(ShaderPath));
        if (redo && !find && File.Exists(to)) File.Copy(to, ProjectSettings.GlobalizePath(ShaderPath), true);
        var shader = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        string old = N(shader.Code);
        if (Psx.WithoutRutMud(old) != old) { GD.Print("ruts: the resource has the rut mud lines already"); return; }
        if (!(old.Contains("uniform sampler2D bump_map") && old.Contains("blend_mix") && old.Contains("depth_bias"))) throw new InvalidOperationException("Not the ruts' decal kind: " + ShaderPath);
        string code = Psx.WithRutMud(old);
        if (Psx.WithoutRutMud(code) != old) throw new InvalidOperationException("The rut mud lines do not come out again cleanly.");
        GD.Print($"ruts: {Psx.RutMudLines.Length} places found, {code.Length - old.Length} characters to add");
        if (find) return;
        Directory.CreateDirectory(backup);
        if (!File.Exists(to))
        {
            GD.Print($"ruts: original {ShaderPath} {Hash(ShaderPath)}");
            File.Copy(ProjectSettings.GlobalizePath(ShaderPath), to, false);
        }
        else if (!redo) throw new IOException("A backup exists already: " + to);
        shader.Code = code;
        shader.TakeOverPath(ShaderPath);
        if (ResourceSaver.Save(shader, ShaderPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(ShaderPath);
        var back = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        if (N(back.Code) != code) throw new IOException("Reload differs: " + ShaderPath);
        GD.Print($"ruts: installed {ShaderPath} {Hash(ShaderPath)}; kind shader:{Kind(old)} -> shader:{Kind(code)}");
    }
}
