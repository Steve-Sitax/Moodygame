using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

// Issue #163: saves a reviewed gutter candidate (repair-gutters.py, merged by merge-gutters.py) into the town's
// resources. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/gutters-promote.tscn -- --candidate <folder> --record <folder> --backup <folder>
// Every mesh must still be the one the candidate was made from (its SHA-256). Originals are copied to --backup first and
// never overwritten. A surface marked "keep" stays as it is (the mesh is duplicated, its own surfaces and metadata
// intact) and the new iron and decal surfaces are added after it; a mesh given as rows (the hidden near-detail stone, its
// old gutter boxes taken out) is rebuilt from them. Collision: the new iron's surface is skipped by Solid and plain
// boxes stand in for it (native_solid_skip / native_solid_stand_in, added to what the mesh had); the rebuilt mesh's
// stand-in is the candidate's (the old boxes without the gutter boxes). The new Ruien inlets join
// world/town/drainage/ruien-inlets.json (its original is backed up too). Scene nodes, transforms and permanent ids are
// untouched. promotion.json records every hash and count.
public partial class GuttersPromote : Node
{
    const string Inlets = "res://world/town/drainage/ruien-inlets.json";
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();
    static IEnumerable<Node> All(Node n) { yield return n; foreach (var c in n.GetChildren()) foreach (var d in All(c)) yield return d; }

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Gutters promotion stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        if (DisplayServer.GetName() == "headless") throw new InvalidOperationException("Run the promotion in Forward+, not headless.");
        var args = OS.GetCmdlineUserArgs();
        string Opt(string name) { int i = Array.IndexOf(args, "--" + name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : throw new ArgumentException("--" + name); }
        string candidate = Opt("candidate"), record = Opt("record"), backup = Opt("backup");
        Directory.CreateDirectory(record); Directory.CreateDirectory(backup);
        var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(candidate, "manifest.json"))).RootElement;
        var entries = manifest.EnumerateObject().Where(e => e.Name.StartsWith("res://", StringComparison.Ordinal)).ToArray();
        foreach (var e in entries)
        {
            if (Hash(e.Name) != e.Value.GetProperty("sourceHash").GetString()) throw new IOException("Changed since the candidate was made: " + e.Name);
            if (File.Exists(Path.Combine(backup, Path.GetFileName(e.Name)))) throw new IOException("A backup exists already (an earlier promotion?): " + e.Name);
        }
        if (File.Exists(Path.Combine(backup, "ruien-inlets.json"))) throw new IOException("A backup of the inlets exists already");
        var city = ResourceLoader.Load<PackedScene>("res://world/town/roots/node-00004.scn").Instantiate<Node3D>(); AddChild(city);
        var nodes = All(city).OfType<MeshInstance3D>().ToDictionary(m => m.Name.ToString());
        var made = new List<(string path, ArrayMesh mesh)>(); var counts = new Dictionary<string, object>();
        foreach (var e in entries)
        {
            var node = nodes[e.Value.GetProperty("node").GetString()!];
            var xf = node.GlobalTransform; var inv = xf.AffineInverse();
            var old = ResourceLoader.Load<ArrayMesh>(e.Name);
            var surfaces = e.Value.GetProperty("surfaces").EnumerateArray().ToArray();
            bool keep = surfaces.Any(s => s.TryGetProperty("keep", out _));
            ArrayMesh mesh;
            if (keep) mesh = (ArrayMesh)old.Duplicate();
            else { mesh = new ArrayMesh { ResourceName = old.ResourceName }; foreach (var key in old.GetMetaList()) mesh.SetMeta(key, old.GetMeta(key)); }
            int added = 0;
            foreach (var s in surfaces)
            {
                if (s.TryGetProperty("keep", out _) || s.GetProperty("vertices").GetInt32() == 0) continue;
                bool custom = s.GetProperty("custom0").GetBoolean();
                var (arrays, _, t) = Rows(Path.Combine(candidate, s.GetProperty("file").GetString()!), custom, xf);
                // the town's meshes keep compressed attributes (16-bit positions in the surface's box, octahedral normals)
                var flags = (custom ? (Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.RgFloat << (int)Mesh.ArrayFormat.FormatCustom0Shift) : 0) | Mesh.ArrayFormat.FlagCompressAttributes;
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, flags);
                mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, ResourceLoader.Load<Material>(s.GetProperty("material").GetString()!));
                added += t;
            }
            Vector3[] Faces(string file)
            {
                var raw = File.ReadAllBytes(Path.Combine(candidate, file)); var f = new float[raw.Length / 4]; Buffer.BlockCopy(raw, 0, f, 0, raw.Length);
                var faces = new Vector3[f.Length / 3];
                for (int i = 0; i < faces.Length; i++) faces[i] = inv * new Vector3(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]);
                return faces;
            }
            int standIn = 0;
            if (e.Value.TryGetProperty("standIn", out var stand))
            {
                // the rebuilt mesh: its stand-in replaced (the old boxes without the gutter boxes)
                var faces = Faces(stand.GetString()!); mesh.SetMeta("native_solid_stand_in", faces); standIn = faces.Length / 3;
                mesh.SetMeta("native_solid_skip", e.Value.GetProperty("skip").EnumerateArray().Select(x => x.GetInt32()).ToArray());
            }
            if (e.Value.TryGetProperty("standInAdd", out var add))
            {
                // the new iron: plain boxes stand in for it, added to the mesh's own stand-in; its surface skipped
                var had = mesh.HasMeta("native_solid_stand_in") ? mesh.GetMeta("native_solid_stand_in").AsVector3Array() : Array.Empty<Vector3>();
                var faces = Faces(add.GetString()!); mesh.SetMeta("native_solid_stand_in", had.Concat(faces).ToArray()); standIn = faces.Length / 3;
                var skip = mesh.HasMeta("native_solid_skip") ? mesh.GetMeta("native_solid_skip").AsInt32Array() : Array.Empty<int>();
                mesh.SetMeta("native_solid_skip", skip.Concat(e.Value.GetProperty("skipAdd").EnumerateArray().Select(x => x.GetInt32())).Distinct().ToArray());
            }
            made.Add((e.Name, mesh));
            counts[e.Name] = new { surfaces = mesh.GetSurfaceCount(), oldSurfaces = old.GetSurfaceCount(), addedTriangles = added, standInTriangles = standIn, kept = keep };
        }
        var originals = new Dictionary<string, string>(); var installed = new Dictionary<string, string>();
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
        // the inlets: the candidate's new ones after the ones there already (ids must not repeat)
        string inletsFile = ProjectSettings.GlobalizePath(Inlets);
        originals[Inlets] = Hash(Inlets);
        File.Copy(inletsFile, Path.Combine(backup, "ruien-inlets.json"), false);
        var list = JsonNode.Parse(File.ReadAllText(inletsFile))!.AsArray();
        var ids = list.Select(x => x!["id"]!.GetValue<string>()).ToHashSet();
        int newInlets = 0;
        foreach (var x in JsonNode.Parse(File.ReadAllText(Path.Combine(candidate, "ruien.json")))!.AsArray())
        {
            string id = x!["id"]!.GetValue<string>();
            if (!ids.Add(id)) throw new IOException("Inlet id already there: " + id);
            list.Add(x.DeepClone()); newInlets++;
        }
        File.WriteAllText(inletsFile, list.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n");
        installed[Inlets] = Hash(Inlets);
        File.WriteAllText(Path.Combine(record, "promotion.json"), JsonSerializer.Serialize(new { date = DateTime.UtcNow.ToString("u"), candidate, backup, resources = made.Select(m => m.path), newInlets, originalHashes = originals, installedHashes = installed, counts },
            new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Gutters promoted: {made.Count} meshes, {newInlets} inlets; originals in {backup}");
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
