using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issue #250: the paving's mud and dung and its muddy holes were colour only. The town's stored setts kinds (relief ground
// with stone ids: the streets', squares' and wall walks' setts) get Psx.MudLines at their anchors: mud in the joints and in
// patches over the stones, every hole where a stone is gone full of it, its own lumps, prints and dung for the lights, the
// lowest ground for the puddles. Changed in place: no new kind. Four are stored shaders, three are embedded in their
// material. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/mud-relief-repair.tscn -- --backup <folder> [--find] [--redo]
// --find only checks the anchors. The originals are copied to --backup first and never overwritten; --redo puts the
// original back first and the current lines in (while tuning).
public partial class MudReliefRepair : Node
{
    // (Relief 2, Ground: every stored kind with the dirt mask's mud and the stones' holes; found by the code, not the name)
    static readonly string[] Shaders = { "r000009", "r000545", "r000650", "r001277" };
    static readonly string[] Embedded = { "r000016", "r000024", "r000657" };
    // (#251: the market's mud stains' decal kind, shared with the chalk marks; Psx.DecalMudLines, off unless mud_relief)
    const string Decal = "r004626";
    const string Dir = "res://world/town/resources/";
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Mud relief repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        bool find = args.Contains("--find"), redo = args.Contains("--redo");
        int bi = Array.IndexOf(args, "--backup"); string backup = bi >= 0 ? args[bi + 1] : find ? "" : throw new ArgumentException("--backup");
        foreach (var id in Shaders.Concat(Embedded).Append(Decal))
        {
            string path = Dir + id + ".res";
            bool embedded = Embedded.Contains(id);
            // (--redo: back to the original first, so changed lines never stack)
            if (redo && !find && File.Exists(Path.Combine(backup, Path.GetFileName(path)))) File.Copy(Path.Combine(backup, Path.GetFileName(path)), ProjectSettings.GlobalizePath(path), true);
            Resource res = embedded ? ResourceLoader.Load<ShaderMaterial>(path, null, ResourceLoader.CacheMode.Ignore) : ResourceLoader.Load<Shader>(path, null, ResourceLoader.CacheMode.Ignore);
            var shader = res as Shader ?? ((ShaderMaterial)res).Shader;
            string old = N(shader.Code);
            bool decal = id == Decal;
            Func<string, string> with = decal ? Psx.WithDecalMud : Psx.WithMud, without = decal ? Psx.WithoutDecalMud : Psx.WithoutMud;
            if (without(old) != old)
            {
                if (!redo) { GD.Print($"mud: {id} has the mud lines already"); continue; }
                old = without(old);
            }
            if (!decal && !old.Contains("// each stone its own tone; a stone gone is a hole of mud")) throw new InvalidOperationException("Not a setts kind: " + path);
            if (decal && !(old.Contains("uniform sampler2D bump_map") && old.Contains("render_mode") && old.Contains("blend_mix"))) throw new InvalidOperationException("Not the market mud's decal kind: " + path);
            string code = with(old);
            if (without(code) != old) throw new InvalidOperationException("The mud lines do not come out again cleanly: " + path);
            GD.Print($"mud: {id}{(embedded ? " (in its material)" : "")}{(decal ? " (the market mud's decal)" : "")}: {code.Length - old.Length} characters to add");
            if (find) continue;
            Directory.CreateDirectory(backup);
            string to = Path.Combine(backup, Path.GetFileName(path));
            if (!File.Exists(to))
            {
                GD.Print($"mud: original {path} {Hash(path)}");
                File.Copy(ProjectSettings.GlobalizePath(path), to, false);
            }
            else if (!redo) throw new IOException("A backup exists already: " + to);
            shader.Code = code;
            res.TakeOverPath(path);
            if (ResourceSaver.Save(res, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            var back = embedded ? ResourceLoader.Load<ShaderMaterial>(path, null, ResourceLoader.CacheMode.Ignore).Shader : ResourceLoader.Load<Shader>(path, null, ResourceLoader.CacheMode.Ignore);
            if (N(back.Code) != code) throw new IOException("Reload differs: " + path);
            GD.Print($"mud: installed {path} {Hash(path)}");
        }
    }
}
