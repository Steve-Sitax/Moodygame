using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issue #193: painted wood gets wet in the rain. The town's solid lit shader (r000211: its wood, shop boards and shutters, and
// stone vaults and dados indoors) is the psx generator's code for one kind (Psx.WetPaint), shared with the shaders the game
// generates for that kind (goods, models). Psx now adds the wet term to that kind; this writes the same generated code into the
// resource, so the two stay one kind (changed in place: no new shader kind). The wet term is off unless a material asks for
// it (`wet_paint`); WET below sets it on the painted wood. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/wood-wet-repair.tscn -- --backup <folder> [--find]
// --find only prints the kinds whose generated code (without the wet term) is the resource's. Originals are copied to
// --backup first and never overwritten.
public partial class WoodWetRepair : Node
{
    const string ShaderPath = "res://world/town/resources/r000211.res";
    static readonly (string Path, float Wet)[] Wet =
    {
        ("res://world/town/resources/r000216.res", 1.0f),  // city_wood: the bake's wooden fronts and loading doors
        ("res://assets/materials/town-facades-20261018/shutter-paint-kept.tres", 1.0f),
        ("res://assets/materials/town-facades-20261018/shutter-paint-worn.tres", 1.35f),  // (bare grey wood drinks more)
        ("res://assets/materials/town-facades-20261018/signs.tres", 0.8f),  // shop boards (the glazed enamel plates share it)
    };
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Wood wet repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        var shader = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        string old = shader.Code;
        // the kinds that generate this code (DepthWrite does not change the code of a kind that does not blend)
        var bools = new[] { "Unlit", "Blend", "Scissor", "TwoSided", "DepthWrite", "Snap", "VertexColor", "Add", "Fog", "Bump" };
        var found = Enumerable.Range(0, 1 << bools.Length).Select(m => new Psx.Kind((m & 1) != 0, (m & 2) != 0, (m & 4) != 0, (m & 8) != 0, (m & 16) != 0, (m & 32) != 0, 0, (m & 64) != 0, (m & 128) != 0, (m & 256) != 0, Bump: (m & 512) != 0))
            .Where(k => N(Psx.WithoutWetPaint(Psx.ShaderOf(k).Code)) == N(old)).ToArray();
        if (found.Length == 0)
        {
            // (the nearest kind, and where its code parts from the resource's, to review)
            string o = N(old);
            var best = Enumerable.Range(0, 1 << bools.Length).Select(m => new Psx.Kind((m & 1) != 0, (m & 2) != 0, (m & 4) != 0, (m & 8) != 0, (m & 16) != 0, (m & 32) != 0, 0, (m & 64) != 0, (m & 128) != 0, (m & 256) != 0, Bump: (m & 512) != 0))
                .Select(k => (k, c: N(Psx.WithoutWetPaint(Psx.ShaderOf(k).Code))))
                .Select(t => (t.k, t.c, at: Enumerable.Range(0, Math.Min(t.c.Length, o.Length)).FirstOrDefault(i => t.c[i] != o[i], Math.Min(t.c.Length, o.Length))))
                .OrderByDescending(t => t.at).First();
            int from = Math.Max(0, best.at - 120);
            GD.Print($"wood wet: no kind; nearest {best.k} parts at {best.at} of {o.Length}:\n--- generated\n{best.c.Substring(from, Math.Min(260, best.c.Length - from))}\n--- resource\n{o.Substring(from, Math.Min(260, o.Length - from))}");
        }
        foreach (var k in found) GD.Print("wood wet: the resource's kind: " + k + (Psx.WetPaint(k) ? " (wet paint)" : ""));
        if (args.Contains("--find")) return;
        if (found.Length == 0 || !found.All(Psx.WetPaint)) throw new InvalidOperationException("The resource is not the wet-paint kind's code; review Psx.WetPaint.");
        string code = Psx.ShaderOf(found[0]).Code;
        if (code == old) { GD.Print("wood wet: the resource has the wet term already"); }
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : throw new ArgumentException("--backup");
        Directory.CreateDirectory(backup);
        foreach (var p in new[] { ShaderPath }.Concat(Wet.Select(w => w.Path)))
        {
            string to = Path.Combine(backup, Path.GetFileName(p));
            if (File.Exists(to)) throw new IOException("A backup exists already: " + to);
        }
        foreach (var p in new[] { ShaderPath }.Concat(Wet.Select(w => w.Path)))
        {
            GD.Print($"wood wet: original {p} {Hash(p)}");
            File.Copy(ProjectSettings.GlobalizePath(p), Path.Combine(backup, Path.GetFileName(p)), false);
        }
        shader.Code = code;
        shader.TakeOverPath(ShaderPath);
        if (ResourceSaver.Save(shader, ShaderPath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(ShaderPath);
        foreach (var (p, wet) in Wet)
        {
            var m = ResourceLoader.Load<ShaderMaterial>(p, null, ResourceLoader.CacheMode.Ignore);
            m.Shader = shader; m.SetShaderParameter("wet_paint", wet);
            if (ResourceSaver.Save(m, p, p.EndsWith(".res") ? ResourceSaver.SaverFlags.Compress : ResourceSaver.SaverFlags.None) != Error.Ok) throw new IOException(p);
        }
        var back = ResourceLoader.Load<Shader>(ShaderPath, null, ResourceLoader.CacheMode.Ignore);
        if (back.Code != code) throw new IOException("Reload differs: " + ShaderPath);
        foreach (var p in new[] { ShaderPath }.Concat(Wet.Select(w => w.Path))) GD.Print($"wood wet: installed {p} {Hash(p)}");
    }
}
