using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Patch the existing native water shaders without rebuilding the town or changing object IDs.
// Originals are backed up before saving; shader text is checked again after reloading.
// godot --headless --path . res://scripts/natural-water-repair.tscn -- --backup <folder> [--find]
public partial class NaturalWaterRepair : Node
{
    static readonly string[] ShaderPaths = { "res://world/town/resources/r001377.res", "res://world/town/resources/r001104.res" };
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Kind(string code) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code)))[..16];
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Natural water repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        foreach (string path in ShaderPaths)
        {
            var shader = ResourceLoader.Load<Shader>(path, null, ResourceLoader.CacheMode.Ignore);
            string old = N(shader.Code);
            if (old.Contains("natural-water-v3")) {
                int backupArg = Array.IndexOf(args, "--backup");
                if (backupArg >= 0) {
                    string originalPath = Path.Combine(args[backupArg + 1], Path.GetFileName(path));
                    var original = ResourceLoader.Load<Shader>(originalPath, null, ResourceLoader.CacheMode.Ignore);
                    if (old != N(Psx.WithNaturalWater(original.Code))) throw new IOException("Stored shader differs from expected patch: " + path);
                }
                GD.Print($"natural water: {path} already updated and verified"); continue;
            }
            string code = N(Psx.WithNaturalWater(old));
            GD.Print($"natural water: {path}: {code.Length - old.Length} characters more");
            if (args.Contains("--find")) continue;
            int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
            Directory.CreateDirectory(backup);
            string to = Path.Combine(backup, Path.GetFileName(path));
            if (File.Exists(to)) {
                var original=ResourceLoader.Load<Shader>(to,null,ResourceLoader.CacheMode.Ignore);
                if (N(Psx.WithNaturalWater(original.Code)) != code) throw new IOException("Existing backup does not reproduce this repair: " + to);
            }
            GD.Print($"natural water: original {path} {Hash(path)}");
            if (!File.Exists(to)) File.Copy(ProjectSettings.GlobalizePath(path), to, false);
            shader.Code = code;
            shader.TakeOverPath(path);
            if (ResourceSaver.Save(shader, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            var back = ResourceLoader.Load<Shader>(path, null, ResourceLoader.CacheMode.Ignore);
            if (N(back.Code) != code) throw new IOException("Reload differs: " + path);
            GD.Print($"natural water: installed {path} {Hash(path)}; kind shader:{Kind(old)} -> shader:{Kind(code)}");
        }
    }
}
