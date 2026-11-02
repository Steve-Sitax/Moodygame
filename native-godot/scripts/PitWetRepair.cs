using Godot;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Scheldemist.Render;

// Issues #235 and #257: the tree pits in the rain. The pits' fallen leaves (r004441) and weeds (r004447, shared with the
// pit straw and the posters) take Psx.WetLeafLines, off unless a material sets `wet_dark`; the soil's water lines in the
// park's relief ground kind (r000002, Psx.SoilLines) are laid again from the code before #244 (git: 4057c0a58), so the
// changed lines never stack. Changed in place: no new kind. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/pit-wet-repair.tscn -- --backup <folder>
//         --soil-original <r000002.res before #244> [--find]
// The current files are copied to --backup first (once, never overwritten); a second run starts from those copies.
public partial class PitWetRepair : Node
{
    const string Dir = "res://world/town/resources/";
    static readonly string[] Leaves = { "r004441", "r004447" };
    const string SoilKind = "r000002";
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Pit wet repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        bool find = args.Contains("--find");
        string Arg(string name) { int i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : throw new ArgumentException(name); }
        string backup = Arg("--backup"), soilOriginal = Arg("--soil-original");
        Directory.CreateDirectory(backup);
        foreach (var id in Leaves.Append(SoilKind))
        {
            string path = Dir + id + ".res", file = ProjectSettings.GlobalizePath(path), kept = Path.Combine(backup, id + ".res");
            if (!find && !File.Exists(kept)) { GD.Print($"pit wet: kept {path} {Hash(path)}"); File.Copy(file, kept, false); }
            bool soil = id == SoilKind;
            // (start from the code before these lines: the kept copy, or for the soil kind the code before #244)
            string from = soil ? soilOriginal : kept;
            if (!find) File.Copy(from, file, true);
            var shader = ResourceLoader.Load<Shader>(path, null, ResourceLoader.CacheMode.Ignore);
            string old = N(shader.Code);
            Func<string, string> with = soil ? Psx.WithSoil : Psx.WithWetLeaf, without = soil ? Psx.WithoutSoil : Psx.WithoutWetLeaf;
            if (!find && without(old) != old) throw new InvalidOperationException("The starting code has the lines already: " + from);
            if (find) old = without(old);
            string code = with(old);
            if (without(code) != old) throw new InvalidOperationException("The lines do not come out again cleanly: " + path);
            GD.Print($"pit wet: {id}: {code.Length - old.Length} characters to add");
            if (find) continue;
            shader.Code = code;
            shader.TakeOverPath(path);
            if (ResourceSaver.Save(shader, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            var back = ResourceLoader.Load<Shader>(path, null, ResourceLoader.CacheMode.Ignore);
            if (N(back.Code) != code) throw new IOException("Reload differs: " + path);
            GD.Print($"pit wet: installed {path} {Hash(path)}");
        }
    }
}
