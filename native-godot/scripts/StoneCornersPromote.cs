using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

// Issue #157: saves a reviewed corner-stone candidate into the town's resources. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/stone-corners-promote.tscn -- --candidate <folder> --record <folder>
//     [--reuse-material] [--backup <folder>]
// A later pass (#171, #173) rebuilt from the originals reuses the dressed-stone material (--reuse-material) and keeps its
// backups where --backup says (the replaced meshes are the earlier pass's, kept in git; the originals in its record).
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
        bool reuse = args.Contains("--reuse-material");
        var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(candidate, "manifest.json"))).RootElement;
        if (manifest.TryGetProperty("surfaceRepairs", out var repairs))
        {
            PromoteSurfaces(candidate, record, Opt("backup"), repairs);
            return;
        }
        var entries = manifest.EnumerateObject().Where(e => e.Name.StartsWith("res://", StringComparison.Ordinal)).ToArray();
        // every source must still be what the candidate was made from
        foreach (var e in entries)
            if (Hash(e.Name) != e.Value.GetProperty("sourceHash").GetString()) throw new IOException("Changed since the candidate was made: " + e.Name);
        if (ResourceLoader.Exists(Material) && !reuse) throw new IOException("The dressed-stone material exists already: " + Material);
        string backup = Array.IndexOf(args, "--backup") >= 0 ? Opt("backup") : Path.Combine(record, "original-resources"); Directory.CreateDirectory(backup);
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
        if (!(reuse && ResourceLoader.Exists(Material)) && ResourceSaver.Save(material, Material) != Error.Ok) throw new IOException(Material);
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

    // Landmark/paving pass: replace only explicitly listed surfaces, copying all other packed surfaces verbatim.
    // Preserve existing support stand-ins, and move each newly replaced surface's ORIGINAL local faces into them.
    // This also permits a candidate rebuilt from an original dump after an earlier visual-only promotion.
    void PromoteSurfaces(string candidate, string record, string backup, JsonElement repairs)
    {
        Directory.CreateDirectory(record); Directory.CreateDirectory(backup);
        var scene = ResourceLoader.Load<PackedScene>("res://world/town/scene.tscn").Instantiate<Node3D>(); AddChild(scene);
        var made = new List<(string path, ArrayMesh mesh, string before, int triangles)>();
        foreach (var e in repairs.EnumerateArray())
        {
            string path = e.GetProperty("mesh").GetString()!;
            if (Hash(path) != e.GetProperty("sourceHash").GetString()) throw new IOException("Source changed: " + path);
            if (File.Exists(Path.Combine(backup, Path.GetFileName(path)))) throw new IOException("Backup exists: " + path);
            var node = scene.GetNode<MeshInstance3D>(e.GetProperty("nodePath").GetString()!);
            var old = ResourceLoader.Load<ArrayMesh>(path);
            string before = SupportHash(old);
            // (#199 corners) new solid faces: world-space rows (16 floats a corner) added to the stand-in, so collision
            // and the walk map get exactly the old faces and these
            var added = new List<Vector3>();
            if (e.TryGetProperty("solid", out var solid))
            {
                var inv = node.GlobalTransform.AffineInverse(); var bytes = File.ReadAllBytes(Path.Combine(candidate, solid.GetString()!));
                var data = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, data, 0, bytes.Length);
                for (int j = 0; j < data.Length; j += 16) added.Add(inv * new Vector3(data[j], data[j + 1], data[j + 2]));
            }
            string expected = added.Count == 0 ? before : SupportHashOf(SupportList(old).Concat(added).ToList());
            var mesh = new ArrayMesh { ResourceName = old.ResourceName };
            foreach (var key in old.GetMetaList()) mesh.SetMeta(key, old.GetMeta(key));
            var surfaces = new Godot.Collections.Array((Godot.Collections.Array)old.Get("_surfaces"));
            var skip = old.HasMeta("native_solid_skip") ? old.GetMeta("native_solid_skip").AsInt32Array().ToList() : new List<int>();
            var stand = old.HasMeta("native_solid_stand_in") ? old.GetMeta("native_solid_stand_in").AsVector3Array().ToList() : new List<Vector3>();
            int triangles = 0;
            foreach (var s in e.GetProperty("surfaces").EnumerateArray())
            {
                int si = s.GetProperty("index").GetInt32();
                if (!skip.Contains(si)) { if (si < old.GetSurfaceCount()) stand.AddRange(SurfaceFaces(old, si)); skip.Add(si); }
                bool tangent = s.TryGetProperty("tangent", out var tg) && tg.GetBoolean();
                // (custom0Rgba: four floats of custom0 a corner, as the park plants' foot: x, z, foot height, spare)
                bool rgba = s.TryGetProperty("custom0Rgba", out var cr) && cr.GetBoolean();
                var (arrays, _, tris) = Rows(Path.Combine(candidate, s.GetProperty("file").GetString()!), s.GetProperty("custom0").GetBoolean(), node.GlobalTransform, tangent, rgba);
                // Full float positions retain millimetre arrises on large combined landmark meshes.
                var temp = new ArrayMesh();
                var flags = s.GetProperty("custom0").GetBoolean() ? (Mesh.ArrayFormat)((long)(rgba ? Mesh.ArrayCustomFormat.RgbaFloat : Mesh.ArrayCustomFormat.RgFloat) << (int)Mesh.ArrayFormat.FormatCustom0Shift) : 0;
                temp.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, flags);
                temp.SurfaceSetMaterial(0, ResourceLoader.Load<Material>(s.GetProperty("material").GetString()!));
                if (si == surfaces.Count) surfaces.Add(((Godot.Collections.Array)temp.Get("_surfaces"))[0]);
                else surfaces[si] = ((Godot.Collections.Array)temp.Get("_surfaces"))[0];
                triangles += tris;
            }
            mesh.Set("_surfaces", surfaces);
            stand.AddRange(added);
            mesh.SetMeta("native_solid_skip", skip.ToArray()); mesh.SetMeta("native_solid_stand_in", stand.ToArray());
            if (SupportHash(mesh) != expected) throw new IOException("Collision/support faces changed: " + path);
            made.Add((path, mesh, expected, triangles));
        }
        var report = new List<object>();
        foreach (var (path, mesh, before, triangles) in made)
        {
            string source = Hash(path);
            File.Copy(ProjectSettings.GlobalizePath(path), Path.Combine(backup, Path.GetFileName(path)), false);
            if (ResourceSaver.Save(mesh, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            var back = ResourceLoader.Load<ArrayMesh>(path, null, ResourceLoader.CacheMode.Ignore);
            if (back.GetSurfaceCount() != mesh.GetSurfaceCount() || SupportHash(back) != before) throw new IOException("Reload/support differs: " + path);
            report.Add(new { path, sourceHash = source, installedHash = Hash(path), supportHash = before, triangles });
        }
        File.WriteAllText(Path.Combine(record, "promotion.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Surface repairs promoted: {made.Count} meshes; support faces identical before and after reload.");
    }

    static Vector3[] SurfaceFaces(ArrayMesh m, int s)
    {
        var a = m.SurfaceGetArrays(s); var p = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        return a[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? p : a[(int)Mesh.ArrayType.Index].AsInt32Array().Select(i => p[i]).ToArray();
    }

    static List<Vector3> SupportList(ArrayMesh m)
    {
        var skip = m.HasMeta("native_solid_skip") ? m.GetMeta("native_solid_skip").AsInt32Array() : Array.Empty<int>();
        var all = m.HasMeta("native_solid_stand_in") ? m.GetMeta("native_solid_stand_in").AsVector3Array().ToList() : new List<Vector3>();
        for (int s = 0; s < m.GetSurfaceCount(); s++) if (!skip.Contains(s)) all.AddRange(SurfaceFaces(m, s));
        return all;
    }

    static string SupportHash(ArrayMesh m) => SupportHashOf(SupportList(m));

    static string SupportHashOf(List<Vector3> all)
    {
        // Sort whole triangles, never their corners: surface order may change, winding and every float must not.
        var keys = new List<string>();
        for (int i = 0; i < all.Count; i += 3)
        {
            var bytes = new byte[36];
            for (int k = 0; k < 3; k++)
            {
                Buffer.BlockCopy(BitConverter.GetBytes(all[i + k].X), 0, bytes, k * 12, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(all[i + k].Y), 0, bytes, k * 12 + 4, 4);
                Buffer.BlockCopy(BitConverter.GetBytes(all[i + k].Z), 0, bytes, k * 12 + 8, 4);
            }
            keys.Add(Convert.ToBase64String(bytes));
        }
        keys.Sort(StringComparer.Ordinal);
        return Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(string.Join("\n", keys))));
    }

    // rows -> indexed arrays in the node's space: identical rows share one vertex
    // tangent: 20 floats a corner, the last four the tangent (world xyz and its sign), as the slab path turns its flags by it
    // rgba: 2 more floats of custom0 after the first two (18 floats a corner, 22 with the tangent after them)
    static (Godot.Collections.Array, int, int) Rows(string file, bool custom0, Transform3D transform, bool tangent = false, bool rgba = false)
    {
        int cn = rgba ? 4 : 2, toff = 14 + cn;
        int stride = toff + (tangent ? 4 : 0);
        var bytes = File.ReadAllBytes(file); int count = bytes.Length / (stride * 4);
        var index = new Dictionary<string, int>(); var order = new List<int>(); var indices = new int[count];
        for (int i = 0; i < count; i++)
        {
            string key = Convert.ToBase64String(bytes, i * stride * 4, stride * 4);
            if (!index.TryGetValue(key, out int at)) { at = order.Count; index[key] = at; order.Add(i); }
            indices[i] = at;
        }
        var data = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, data, 0, bytes.Length);
        int n = order.Count; var inv = transform.AffineInverse();
        var pos = new Vector3[n]; var norm = new Vector3[n]; var uv = new Vector2[n]; var uv2 = new Vector2[n]; var col = new Color[n]; var custom = new float[n * cn];
        var tan = new float[tangent ? n * 4 : 0];
        for (int k = 0; k < n; k++)
        {
            int j = order[k] * stride;
            if (tangent)
            {
                var t = (transform.Basis.Inverse() * new Vector3(data[j + toff], data[j + toff + 1], data[j + toff + 2])).Normalized();
                tan[k * 4] = t.X; tan[k * 4 + 1] = t.Y; tan[k * 4 + 2] = t.Z; tan[k * 4 + 3] = data[j + toff + 3] < 0 ? -1f : 1f;
            } pos[k] = inv * new Vector3(data[j], data[j + 1], data[j + 2]);
            norm[k] = (transform.Basis.Transposed() * new Vector3(data[j + 3], data[j + 4], data[j + 5])).Normalized();
            uv[k] = new(data[j + 6], data[j + 7]); uv2[k] = new(data[j + 8], data[j + 9]); col[k] = new(data[j + 10], data[j + 11], data[j + 12], data[j + 13]);
            for (int q = 0; q < cn; q++) custom[k * cn + q] = data[j + 14 + q];
        }
        var a = new Godot.Collections.Array(); a.Resize((int)Mesh.ArrayType.Max);
        a[(int)Mesh.ArrayType.Vertex] = pos; a[(int)Mesh.ArrayType.Normal] = norm; a[(int)Mesh.ArrayType.TexUV] = uv; a[(int)Mesh.ArrayType.TexUV2] = uv2;
        a[(int)Mesh.ArrayType.Color] = col; a[(int)Mesh.ArrayType.Index] = indices;
        if (custom0) a[(int)Mesh.ArrayType.Custom0] = custom;
        if (tangent) a[(int)Mesh.ArrayType.Tangent] = tan;
        return (a, n, count / 3);
    }
}
