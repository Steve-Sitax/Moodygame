using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

// Issue #157: saves a reviewed corner-stone candidate into the town's resources. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/stone-corners-promote.tscn -- --candidate <folder> --record <folder>
// The candidate is the repair's manifest.json and rows (world space, 16 floats per vertex). Every mesh must still be the
// one the candidate was made from (its SHA-256); originals are copied to <record>/original-resources first and never
// overwritten. Scene nodes, transforms and permanent ids are untouched: only the listed mesh resources and the new
// dressed-stone material are written. promotion.json records every hash.
public partial class StoneCornersPromote : Node
{
    const string Material = "res://assets/materials/stone-corners-20261017/dressed-stone.tres";
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();
    static IEnumerable<Node> All(Node n) { yield return n; foreach (var c in n.GetChildren()) foreach (var d in All(c)) yield return d; }

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Stone corners promotion stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        if (DisplayServer.GetName() == "headless") throw new InvalidOperationException("Run the promotion in Forward+, not headless.");
        var args = OS.GetCmdlineUserArgs();
        string Opt(string name) { int i = Array.IndexOf(args, "--" + name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : throw new ArgumentException("--" + name); }
        string candidate = Opt("candidate"), record = Opt("record");
        var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(candidate, "manifest.json"))).RootElement;
        var entries = manifest.EnumerateObject().Where(e => e.Name.StartsWith("res://", StringComparison.Ordinal)).ToArray();
        // every source must still be what the candidate was made from
        foreach (var e in entries)
            if (Hash(e.Name) != e.Value.GetProperty("sourceHash").GetString()) throw new IOException("Changed since the candidate was made: " + e.Name);
        if (ResourceLoader.Exists(Material)) throw new IOException("The dressed-stone material exists already: " + Material);
        string backup = Path.Combine(record, "original-resources"); Directory.CreateDirectory(backup);
        foreach (var e in entries)
        {
            string target = Path.Combine(backup, Path.GetFileName(e.Name));
            if (File.Exists(target)) throw new IOException("A backup exists already (an earlier promotion?): " + target);
        }
        // the material: the house stone's settings with the dressed-stone shader and the 1.2 m stone picture
        var def = manifest.GetProperty("materials").GetProperty("candidate:dressed_stone");
        var material = (ShaderMaterial)ResourceLoader.Load<ShaderMaterial>(def.GetProperty("base").GetString()!).Duplicate();
        material.Shader = ResourceLoader.Load<Shader>(def.GetProperty("shader").GetString()!);
        foreach (var p in def.GetProperty("params").EnumerateObject()) material.SetShaderParameter(p.Name, ResourceLoader.Load<Texture2D>(p.Value.GetString()!));
        material.ResourceName = "dressed_stone";
        if (ResourceSaver.Save(material, Material) != Error.Ok) throw new IOException(Material);
        var dressed = ResourceLoader.Load<Material>(Material, null, ResourceLoader.CacheMode.Replace);
        // the nodes' transforms: rows are world space
        var city = ResourceLoader.Load<PackedScene>("res://world/town/roots/node-00004.scn").Instantiate<Node3D>(); AddChild(city);
        var nodes = All(city).OfType<MeshInstance3D>().ToDictionary(m => m.Name.ToString());
        var installed = new Dictionary<string, string>(); var originals = new Dictionary<string, string>(); var counts = new Dictionary<string, object>();
        var made = new List<(string path, ArrayMesh mesh)>();
        foreach (var e in entries)
        {
            var node = nodes[e.Value.GetProperty("node").GetString()!];
            var old = ResourceLoader.Load<ArrayMesh>(e.Name);
            var mesh = new ArrayMesh { ResourceName = old.ResourceName };
            foreach (var key in old.GetMetaList()) mesh.SetMeta(key, old.GetMeta(key));
            int vertices = 0, triangles = 0, dressedSurface = -1;
            foreach (var s in e.Value.GetProperty("surfaces").EnumerateArray())
            {
                if (s.GetProperty("vertices").GetInt32() == 0) continue;
                bool custom = s.GetProperty("custom0").GetBoolean();
                var (arrays, v, t) = Rows(Path.Combine(candidate, s.GetProperty("file").GetString()!), custom, node.GlobalTransform);
                // the town's meshes keep compressed attributes (16-bit positions in the surface's box, octahedral normals)
                var flags = (custom ? (Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.RgFloat << (int)Mesh.ArrayFormat.FormatCustom0Shift) : 0) | Mesh.ArrayFormat.FlagCompressAttributes;
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, flags);
                string mp = s.GetProperty("material").GetString()!;
                mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, mp == "candidate:dressed_stone" ? dressed : ResourceLoader.Load<Material>(mp));
                if (mp == "candidate:dressed_stone") dressedSurface = mesh.GetSurfaceCount() - 1;
                vertices += v; triangles += t;
            }
            int standIn = 0;
            if (e.Value.TryGetProperty("standIn", out var stand) && dressedSurface >= 0)
            {
                // collision keeps the simple boxes the dressed stones replaced (Solid reads these two)
                var raw = File.ReadAllBytes(Path.Combine(candidate, stand.GetString()!)); var f = new float[raw.Length / 4]; Buffer.BlockCopy(raw, 0, f, 0, raw.Length);
                var inv = node.GlobalTransform.AffineInverse(); var faces = new Vector3[f.Length / 3];
                for (int i = 0; i < faces.Length; i++) faces[i] = inv * new Vector3(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]);
                mesh.SetMeta("native_solid_stand_in", faces); mesh.SetMeta("native_solid_skip", new int[] { dressedSurface });
                standIn = faces.Length / 3;
            }
            made.Add((e.Name, mesh)); counts[e.Name] = new { surfaces = mesh.GetSurfaceCount(), vertices, triangles, oldSurfaces = old.GetSurfaceCount(), standInTriangles = standIn };
        }
        foreach (var (path, mesh) in made)
        {
            originals[path] = Hash(path);
            File.Copy(ProjectSettings.GlobalizePath(path), Path.Combine(backup, Path.GetFileName(path)), false);
            if (ResourceSaver.Save(mesh, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            installed[path] = Hash(path);
            // read it back: the saved mesh must have what was built
            var back = ResourceLoader.Load<ArrayMesh>(path, null, ResourceLoader.CacheMode.Ignore);
            if (back.GetSurfaceCount() != mesh.GetSurfaceCount()) throw new IOException("Reload differs: " + path);
            for (int i = 0; i < mesh.GetSurfaceCount(); i++)
                if (back.SurfaceGetArrayIndexLen(i) != mesh.SurfaceGetArrayIndexLen(i) || back.SurfaceGetArrayLen(i) != mesh.SurfaceGetArrayLen(i)) throw new IOException("Reload differs: " + path);
        }
        installed[Material] = Hash(Material);
        File.WriteAllText(Path.Combine(record, "promotion.json"), JsonSerializer.Serialize(new { date = DateTime.UtcNow.ToString("u"), candidate, resources = made.Select(m => m.path), originalHashes = originals, installedHashes = installed, counts },
            new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Stone corners promoted: {made.Count} meshes and the dressed-stone material; originals in {backup}");
    }

    // rows -> indexed arrays in the node's space: identical rows share one vertex
    static (Godot.Collections.Array, int, int) Rows(string file, bool custom0, Transform3D transform)
    {
        var bytes = File.ReadAllBytes(file); int count = bytes.Length / 64;
        var index = new Dictionary<string, int>(); var order = new List<int>(); var indices = new int[count];
        for (int i = 0; i < count; i++)
        {
            string key = Convert.ToBase64String(bytes, i * 64, 64);
            if (!index.TryGetValue(key, out int at)) { at = order.Count; index[key] = at; order.Add(i); }
            indices[i] = at;
        }
        var data = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, data, 0, bytes.Length);
        int n = order.Count; var inv = transform.AffineInverse();
        var pos = new Vector3[n]; var norm = new Vector3[n]; var uv = new Vector2[n]; var uv2 = new Vector2[n]; var col = new Color[n]; var custom = new float[n * 2];
        for (int k = 0; k < n; k++)
        {
            int j = order[k] * 16; pos[k] = inv * new Vector3(data[j], data[j + 1], data[j + 2]);
            norm[k] = (transform.Basis.Transposed() * new Vector3(data[j + 3], data[j + 4], data[j + 5])).Normalized();
            uv[k] = new(data[j + 6], data[j + 7]); uv2[k] = new(data[j + 8], data[j + 9]); col[k] = new(data[j + 10], data[j + 11], data[j + 12], data[j + 13]);
            custom[k * 2] = data[j + 14]; custom[k * 2 + 1] = data[j + 15];
        }
        var a = new Godot.Collections.Array(); a.Resize((int)Mesh.ArrayType.Max);
        a[(int)Mesh.ArrayType.Vertex] = pos; a[(int)Mesh.ArrayType.Normal] = norm; a[(int)Mesh.ArrayType.TexUV] = uv; a[(int)Mesh.ArrayType.TexUV2] = uv2;
        a[(int)Mesh.ArrayType.Color] = col; a[(int)Mesh.ArrayType.Index] = indices;
        if (custom0) a[(int)Mesh.ArrayType.Custom0] = custom;
        return (a, n, count / 3);
    }
}
