using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

// Issues #176 #175: saves a reviewed town-fronts candidate (repair-shutters.py, repair-signs.py) into the town's
// resources. Run in Forward+ (not headless):
//   godot --rendering-method forward_plus --path . res://scripts/facades-promote.tscn -- --candidate <folder> --record <folder> --backup <folder> [--root streetlife | --root city,streetlife]
// Every mesh must still be the one the candidate was made from (its SHA-256). Originals are copied to --backup first and
// never overwritten. Each mesh in the manifest is rebuilt from its rows (world space; the bake's flat shutters or plates
// taken out), keeping the old mesh's metadata; "standInAdd" adds plain collision boxes (world space) to its stand-in.
// The candidate's "install" list copies new data files into the project (e.g. world/town/facades/shutters.json).
// Scene nodes, transforms and permanent ids are untouched. promotion.json records every hash and count.
// (#174) A rebuilt surface keeps the old one's box: its compressed positions are stored on a grid in that box, so a
// different box moves every corner by up to half a step (1 mm in a 130 m chunk) and faces cut apart can meet again. Two
// unused vertices (no triangle uses them: nothing draws or collides) at the old box's corners keep the grid, and each
// corner is put in the middle of its grid step (Godot packs a position by cutting off, not rounding: a corner read back
// exactly on a step would drop to the step below), so an unchanged corner is stored as it was, to the bit.
public partial class FacadesPromote : Node
{
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();
    static IEnumerable<Node> All(Node n) { yield return n; foreach (var c in n.GetChildren()) foreach (var d in All(c)) yield return d; }

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Facades promotion stopped: " + e); GetTree().Quit(1); }
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
        var installs = manifest.TryGetProperty("install", out var inst) ? inst.EnumerateObject().ToArray() : Array.Empty<JsonProperty>();
        foreach (var e in entries)
        {
            if (Hash(e.Name) != e.Value.GetProperty("sourceHash").GetString()) throw new IOException("Changed since the candidate was made: " + e.Name);
            if (File.Exists(Path.Combine(backup, Path.GetFileName(e.Name)))) throw new IOException("A backup exists already (an earlier promotion?): " + e.Name);
        }
        // the roots the meshes are in (--root, default city; several comma-separated: #174 changes city and streetlife
        // meshes in one promotion), by their names in the town's roots list
        int ri = Array.IndexOf(args, "--root"); string rootNames = ri >= 0 && ri + 1 < args.Length ? args[ri + 1] : "city";
        var roots = JsonDocument.Parse(Godot.FileAccess.GetFileAsString("res://world/town/roots.json")).RootElement.EnumerateArray().ToArray();
        var nodes = new Dictionary<string, MeshInstance3D>();
        foreach (string rootName in rootNames.Split(','))
        {
            string rootPath = roots.First(r => r.GetProperty("godotName").GetString() == rootName).GetProperty("path").GetString()!;
            var root = ResourceLoader.Load<PackedScene>(rootPath).Instantiate<Node3D>(); AddChild(root);
            foreach (var m in All(root).OfType<MeshInstance3D>()) nodes.Add(m.Name.ToString(), m);
        }
        var made = new List<(string path, ArrayMesh mesh)>(); var counts = new Dictionary<string, object>();
        foreach (var e in entries)
        {
            var node = nodes[e.Value.GetProperty("node").GetString()!];
            var xf = node.GlobalTransform; var inv = xf.AffineInverse();
            var old = ResourceLoader.Load<ArrayMesh>(e.Name);
            var mesh = new ArrayMesh { ResourceName = old.ResourceName };
            foreach (var key in old.GetMetaList()) mesh.SetMeta(key, old.GetMeta(key));
            int triangles = 0;
            int si = -1, boxesKept = 0;
            foreach (var s in e.Value.GetProperty("surfaces").EnumerateArray())
            {
                si++;
                if (s.GetProperty("vertices").GetInt32() == 0) continue;
                bool custom = s.GetProperty("custom0").GetBoolean();
                var (arrays, t) = Rows(Path.Combine(candidate, s.GetProperty("file").GetString()!), custom, xf);
                // (the old surface of the same place and material: its box, if every new corner is in it)
                if (si < old.GetSurfaceCount() && old.SurfaceGetMaterial(si)?.ResourcePath == s.GetProperty("material").GetString()
                    && RenderingServer.MeshGetSurface(old.GetRid(), si)["aabb"].AsAabb() is var box && KeepBox(arrays, box, custom)) boxesKept++;
                // the town's meshes keep compressed attributes (16-bit positions in the surface's box, octahedral normals)
                var flags = (custom ? (Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.RgFloat << (int)Mesh.ArrayFormat.FormatCustom0Shift) : 0) | Mesh.ArrayFormat.FlagCompressAttributes;
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, flags);
                mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, ResourceLoader.Load<Material>(s.GetProperty("material").GetString()!));
                triangles += t;
                // a surface marked noCollision (a sign over head height) is skipped by Solid
                if (s.TryGetProperty("noCollision", out var nc) && nc.GetBoolean())
                {
                    var skip = mesh.HasMeta("native_solid_skip") ? mesh.GetMeta("native_solid_skip").AsInt32Array() : Array.Empty<int>();
                    mesh.SetMeta("native_solid_skip", skip.Append(mesh.GetSurfaceCount() - 1).Distinct().ToArray());
                }
            }
            int standIn = 0;
            if (e.Value.TryGetProperty("standInAdd", out var add))
            {
                var raw = File.ReadAllBytes(Path.Combine(candidate, add.GetString()!)); var f = new float[raw.Length / 4]; Buffer.BlockCopy(raw, 0, f, 0, raw.Length);
                var faces = new Vector3[f.Length / 3];
                for (int i = 0; i < faces.Length; i++) faces[i] = inv * new Vector3(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]);
                var had = mesh.HasMeta("native_solid_stand_in") ? mesh.GetMeta("native_solid_stand_in").AsVector3Array() : Array.Empty<Vector3>();
                mesh.SetMeta("native_solid_stand_in", had.Concat(faces).ToArray()); standIn = faces.Length / 3;
            }
            made.Add((e.Name, mesh));
            counts[e.Name] = new { node = node.Name.ToString(), surfaces = mesh.GetSurfaceCount(), boxesKept, oldTriangles = Enumerable.Range(0, old.GetSurfaceCount()).Sum(i => old.SurfaceGetArrayIndexLen(i) > 0 ? old.SurfaceGetArrayIndexLen(i) / 3 : old.SurfaceGetArrayLen(i) / 3), triangles, standInTriangles = standIn };
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
        // new data files: copied in (an existing one is backed up first)
        foreach (var i in installs)
        {
            string target = ProjectSettings.GlobalizePath(i.Name), source = Path.Combine(candidate, i.Value.GetString()!);
            if (File.Exists(target)) { originals[i.Name] = Hash(i.Name); File.Copy(target, Path.Combine(backup, Path.GetFileName(target)), false); }
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(source, target, true);
            installed[i.Name] = Hash(i.Name);
        }
        File.WriteAllText(Path.Combine(record, "promotion.json"), JsonSerializer.Serialize(new { date = DateTime.UtcNow.ToString("u"), candidate, backup, resources = made.Select(m => m.path), installs = installs.Select(i => i.Name), originalHashes = originals, installedHashes = installed, counts },
            new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Facades promoted: {made.Count} meshes, {installs.Length} files; originals in {backup}");
    }

    // two unused vertices at the box's corners (a copy of vertex 0's other attributes), when every vertex lies in the box
    static bool KeepBox(Godot.Collections.Array a, Aabb box, bool custom0)
    {
        var pos = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        if (pos.Length == 0 || box.Size == Vector3.Zero) return false;
        var grown = box.Grow(1e-4f);
        if (pos.Any(p => !grown.HasPoint(p))) return false;
        Vector3[] P(Vector3[] v, Vector3 x, Vector3 y) => v.Append(x).Append(y).ToArray();
        T[] Two<T>(T[] v) => v.Append(v[0]).Append(v[0]).ToArray();
        float Mid(float v, float lo, float size)
        {
            if (size <= 0) return v;
            double q = Math.Clamp(Math.Round((v - lo) / (double)size * 65535.0), 0, 65535);
            return q >= 65535 ? lo + size : (float)(lo + (q + 0.5) / 65535.0 * size);
        }
        for (int i = 0; i < pos.Length; i++)
            pos[i] = new Vector3(Mid(pos[i].X, box.Position.X, box.Size.X), Mid(pos[i].Y, box.Position.Y, box.Size.Y), Mid(pos[i].Z, box.Position.Z, box.Size.Z));
        a[(int)Mesh.ArrayType.Vertex] = P(pos, box.Position, box.End);
        a[(int)Mesh.ArrayType.Normal] = Two(a[(int)Mesh.ArrayType.Normal].AsVector3Array());
        a[(int)Mesh.ArrayType.TexUV] = Two(a[(int)Mesh.ArrayType.TexUV].AsVector2Array());
        a[(int)Mesh.ArrayType.TexUV2] = Two(a[(int)Mesh.ArrayType.TexUV2].AsVector2Array());
        a[(int)Mesh.ArrayType.Color] = Two(a[(int)Mesh.ArrayType.Color].AsColorArray());
        if (custom0) { var c = a[(int)Mesh.ArrayType.Custom0].AsFloat32Array(); a[(int)Mesh.ArrayType.Custom0] = c.Append(c[0]).Append(c[1]).Append(c[0]).Append(c[1]).ToArray(); }
        return true;
    }

    // rows -> indexed arrays in the node's space: identical rows share one vertex
    static (Godot.Collections.Array, int) Rows(string file, bool custom0, Transform3D transform)
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
        return (a, count / 3);
    }
}
