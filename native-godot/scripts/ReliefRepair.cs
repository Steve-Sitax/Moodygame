using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Scheldemist.Render;

// Issues #91 and #170: the paving's relief takes the mip of the surface's own uv and lights its stones from one direction
// in the world, whichever way the uv runs (Psx.ReliefGlsl, the parallax). The town's relief shaders are the psx generator's
// code for their kinds, stored in the bake's resources (a shader of its own, or inside its material); this writes the
// generator's new code into each, so every one stays its kind (changed in place: no new shader kind). Run in Forward+:
//   godot --rendering-method forward_plus --path . res://scripts/relief-repair.tscn -- --list | --dump <folder> | --write <backup folder>
// --list prints each relief shader's holder and kind and whether it is the generator's code (old and new); --dump writes the
// new code of each into <folder> (for an in-memory candidate); --write copies every holder to the backup folder first (never
// overwriting a backup) and stores the new code. A shader whose code is not its kind's generated code is left alone.
public partial class ReliefRepair : Node
{
    static string N(string code) => code.Replace("\r\n", "\n");
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();
    static IEnumerable<Node> All(Node n) { yield return n; foreach (var c in n.GetChildren()) foreach (var d in All(c)) yield return d; }

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Relief repair stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        var args = OS.GetCmdlineUserArgs();
        string Opt(string name) { int i = Array.IndexOf(args, "--" + name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : ""; }
        var town = ResourceLoader.Load<PackedScene>("res://world/town/scene.tscn").Instantiate(); AddChild(town);
        // every relief shader the town draws, with the file that holds it (its own, or its material's)
        var found = new Dictionary<ulong, (Shader Shader, string Holder, string Material, List<string> Users)>();
        foreach (var g in All(town).OfType<GeometryInstance3D>())
        {
            var mesh = (g as MeshInstance3D)?.Mesh ?? (g as MultiMeshInstance3D)?.Multimesh?.Mesh;
            if (mesh == null) continue;
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                var m = (g as MeshInstance3D)?.GetActiveMaterial(s) ?? mesh.SurfaceGetMaterial(s);
                if (m is not ShaderMaterial sm || sm.Shader == null || !(sm.Shader.Code.Contains("float relief_light(") || sm.Shader.Code.Contains("uniform sampler2D slab_map"))) continue;
                var sh = sm.Shader; ulong id = sh.GetInstanceId();
                string holder = sh.ResourcePath.Contains("::") || sh.ResourcePath == "" ? sm.ResourcePath : sh.ResourcePath;
                if (!found.TryGetValue(id, out var f)) found[id] = f = (sh, holder, sm.ResourcePath, new List<string>());
                if (f.Users.Count < 4) f.Users.Add(g.Name);
            }
        }
        // the generator as it was (a copy of the old Psx, only while repairing: optional), to tell untouched code
        var old = Type.GetType("Scheldemist.Render.PsxOld");
        var rows = new List<object>();
        string dump = Opt("dump"), backup = Opt("write");
        var writes = new List<(string Holder, Shader Shader, string Code)>();
        foreach (var (sh, holder, material, users) in found.Values.OrderBy(v => v.Holder))
        {
            string kindJson = sh.HasMeta("native_psx_kind") ? sh.GetMeta("native_psx_kind").AsString() : "";
            string code = N(sh.Code), made = "", was = "";
            if (kindJson != "")
            {
                var kind = JsonSerializer.Deserialize<Psx.Kind>(kindJson);
                made = N(Psx.ShaderOf(kind).Code);
                if (old != null)
                {
                    var okind = JsonSerializer.Deserialize(kindJson, old.GetNestedType("Kind")!);
                    was = N(((Shader)old.GetMethod("ShaderOf")!.Invoke(null, new[] { okind })!).Code);
                }
            }
            bool isOld = was != "" && was == code, isNew = made != "" && made == code;
            rows.Add(new { holder, material, shader = sh.ResourcePath, kind = kindJson, users, generatedOld = isOld, generatedNew = isNew, codeHash = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code))) });
            GD.Print($"relief: {holder} ({sh.ResourcePath}) kind {(kindJson == "" ? "none" : "yes")} old-generator {isOld} new {isNew} users {string.Join(",", users)}");
            if (made != "" && !isNew && (isOld || old == null)) writes.Add((holder, sh, made));
            if (dump != "" && made != "")
            {
                Directory.CreateDirectory(ProjectSettings.GlobalizePath(dump));
                string name = Path.GetFileNameWithoutExtension(holder.Replace("::", "_")) + ".gdshader";
                File.WriteAllText(Path.Combine(ProjectSettings.GlobalizePath(dump), name), made);
                if (args.Contains("--dump-all")) { File.WriteAllText(Path.Combine(ProjectSettings.GlobalizePath(dump), name + ".stored"), code); if (was != "") File.WriteAllText(Path.Combine(ProjectSettings.GlobalizePath(dump), name + ".old"), was); }
            }
        }
        File.WriteAllText(ProjectSettings.GlobalizePath("res://proof/relief-repair.json"), JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true }));
        if (backup == "") return;
        Directory.CreateDirectory(backup);
        foreach (var w in writes)
            if (File.Exists(Path.Combine(backup, Path.GetFileName(w.Holder)))) throw new IOException("A backup exists already: " + w.Holder);
        var record = new List<object>();
        foreach (var w in writes)
        {
            string before = Hash(w.Holder);
            File.Copy(ProjectSettings.GlobalizePath(w.Holder), Path.Combine(backup, Path.GetFileName(w.Holder)), false);
            var res = ResourceLoader.Load<Resource>(w.Holder, null, ResourceLoader.CacheMode.Ignore);
            Shader target = res as Shader ?? (res as ShaderMaterial)!.Shader;
            target.Code = w.Code;
            if (ResourceSaver.Save(res, w.Holder, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(w.Holder);
            var back = ResourceLoader.Load<Resource>(w.Holder, null, ResourceLoader.CacheMode.Ignore);
            string got = N(((back as Shader) ?? (back as ShaderMaterial)!.Shader).Code);
            if (got != w.Code) throw new IOException("Reload differs: " + w.Holder);
            record.Add(new { holder = w.Holder, originalHash = before, installedHash = Hash(w.Holder) });
            GD.Print("relief: written " + w.Holder);
        }
        File.WriteAllText(Path.Combine(backup, "relief-promotion.json"), JsonSerializer.Serialize(new { date = DateTime.UtcNow.ToString("u"), backup, record }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
