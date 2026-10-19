using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Scheldemist.Render;

// Issues #170 and #91: installs a reviewed paving candidate (scripts/pave_town.py) into the town's resources. Run in Forward+:
//   godot --rendering-method forward_plus --path . res://scripts/paving-promote.tscn -- --candidate <folder> --record <folder> --backup <folder>
// Every file must still be the one the candidate was made from (its SHA-256). Originals are copied to --backup first and never
// overwritten. Then:
// - the ground meshes (ground_cobble, ground_flags, ground_quay) are laid again from the candidate's rows: the same flat ground,
//   cut along the setts' joints, every corner with its patch's uv (uncompressed, as the bake stored them). Their collision stays
//   the old triangles to the bit: those are the mesh's stand-in and the new surface is skipped by Solid;
// - the town blocks' old stone (r000209: pavements, kerb tops, steps) keeps its triangles; each flat low triangle's corners take
//   the way its flags run (tangent), a corner shared by triangles that run two ways split in two. Only that surface is stored
//   again (in its old box: every corner to the bit, as FacadesPromote); the mesh's other surfaces are copied as stored;
// - the relief shaders and the slab shader get the generator's new code (scripts/relief-repair.tscn checks which), and the old
//   stone's material turns its flags (slab_turn 1).
// Scene nodes, transforms and permanent ids are untouched. promotion.json records every hash and count.
public partial class PavingPromote : Node
{
    static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)))).ToLowerInvariant();
    static IEnumerable<Node> All(Node n) { yield return n; foreach (var c in n.GetChildren()) foreach (var d in All(c)) yield return d; }
    static string N(string code) => code.Replace("\r\n", "\n");
    const string OldStone = "res://world/town/resources/r000209.res";

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Paving promotion stopped: " + e); GetTree().Quit(1); }
    }

    void Run()
    {
        if (DisplayServer.GetName() == "headless") throw new InvalidOperationException("Run the promotion in Forward+, not headless.");
        var args = OS.GetCmdlineUserArgs();
        string Opt(string name) { int i = Array.IndexOf(args, "--" + name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : throw new ArgumentException("--" + name); }
        string candidate = Opt("candidate"), record = Opt("record"), backup = Opt("backup");
        Directory.CreateDirectory(record); Directory.CreateDirectory(backup);
        var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(candidate, "promote.json"))).RootElement;
        var sources = manifest.GetProperty("sourceHashes").EnumerateObject().ToArray();
        foreach (var s in sources)
        {
            if (Hash(s.Name) != s.Value.GetString()) throw new IOException("Changed since the candidate was made: " + s.Name);
            if (File.Exists(Path.Combine(backup, Path.GetFileName(s.Name)))) throw new IOException("A backup exists already (an earlier promotion?): " + s.Name);
        }
        var city = ResourceLoader.Load<PackedScene>("res://world/town/roots/node-00004.scn").Instantiate<Node3D>(); AddChild(city);
        var nodes = All(city).OfType<MeshInstance3D>().ToDictionary(m => m.Name.ToString());
        var made = new List<(string path, Resource res)>(); var counts = new Dictionary<string, object>();

        // the ground
        foreach (var g in manifest.GetProperty("ground").EnumerateArray())
        {
            string path = g.GetProperty("mesh").GetString()!; var node = nodes[g.GetProperty("node").GetString()!];
            var old = ResourceLoader.Load<ArrayMesh>(path);
            var mesh = new ArrayMesh { ResourceName = old.ResourceName };
            foreach (var key in old.GetMetaList()) mesh.SetMeta(key, old.GetMeta(key));
            var (arrays, verts, tris) = Rows(Path.Combine(candidate, g.GetProperty("file").GetString()!), node.GlobalTransform);
            // the old mesh's own format (no compression: positions to the float)
            var flags = (Mesh.ArrayFormat)((long)old.SurfaceGetFormat(0) & (long)Mesh.ArrayFormat.FlagCompressAttributes);
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, flags);
            mesh.SurfaceSetMaterial(0, old.SurfaceGetMaterial(0));
            // collision: the old ground's triangles, to the bit
            // (in the surface's own corner order: GetFaces turns them, and the stair holes would cut them another way)
            var oa = old.SurfaceGetArrays(0); var ov = oa[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            mesh.SetMeta("native_solid_stand_in", oa[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? ov : oa[(int)Mesh.ArrayType.Index].AsInt32Array().Select(i => ov[i]).ToArray());
            mesh.SetMeta("native_solid_skip", new[] { 0 });
            made.Add((path, mesh));
            counts[path] = new { node = node.Name.ToString(), oldTriangles = old.SurfaceGetArrayIndexLen(0) > 0 ? old.SurfaceGetArrayIndexLen(0) / 3 : old.SurfaceGetArrayLen(0) / 3, triangles = tris, vertices = verts };
        }

        // the town blocks' old stone: the flags' way in the tangents
        var dirs = JsonDocument.Parse(File.ReadAllText(Path.Combine(candidate, "slab-dirs.json"))).RootElement;
        foreach (var e in dirs.EnumerateArray())
        {
            string path = e.GetProperty("mesh").GetString()!; int si = e.GetProperty("surface").GetInt32();
            var old = ResourceLoader.Load<ArrayMesh>(path);
            if (old.SurfaceGetMaterial(si)?.ResourcePath != OldStone) throw new IOException("Not the old stone's surface: " + path + " " + si);
            var a = old.SurfaceGetArrays(si);
            var pos = a[(int)Mesh.ArrayType.Vertex].AsVector3Array().ToList();
            var idx = a[(int)Mesh.ArrayType.Index].AsInt32Array();
            if (idx.Length / 3 != e.GetProperty("tris").GetInt32() || pos.Count != e.GetProperty("verts").GetInt32()) throw new IOException("Surface differs from the candidate's: " + path);
            var tan = a[(int)Mesh.ArrayType.Tangent].VariantType == Variant.Type.Nil ? new float[pos.Count * 4] : a[(int)Mesh.ArrayType.Tangent].AsFloat32Array();
            var tanL = tan.ToList();
            var want = new Dictionary<int, Vector2>();
            foreach (var d in e.GetProperty("dirs").EnumerateArray()) want[d[0].GetInt32()] = new Vector2(d[1].GetSingle(), d[2].GetSingle());
            // a corner's way: the first of its triangles to ask; another way gets its own copy of the corner
            var given = new Dictionary<(int v, int wx, int wz), int>(); var has = new Dictionary<int, Vector2>();
            var copies = new List<int>();
            var xfInv = nodes[e.GetProperty("node").GetString()!].GlobalTransform.Basis.Inverse();
            foreach (var (t, w) in want)
                for (int k = 0; k < 3; k++)
                {
                    int v = idx[t * 3 + k];
                    var key = (v, (int)Math.Round(w.X * 1e4), (int)Math.Round(w.Y * 1e4));
                    if (!has.TryGetValue(v, out var hv)) { has[v] = w; given[key] = v; SetTan(tanL, v, xfInv * new Vector3(w.X, 0, w.Y)); continue; }
                    if ((hv - w).LengthSquared() < 1e-8f) continue;
                    if (!given.TryGetValue(key, out int nv)) { nv = pos.Count; Copy(a, v); pos.Add(pos[v]); tanL.AddRange(new float[4]); SetTan(tanL, nv, xfInv * new Vector3(w.X, 0, w.Y)); given[key] = nv; copies.Add(v); }
                    idx[t * 3 + k] = nv;
                }
            a[(int)Mesh.ArrayType.Vertex] = pos.ToArray(); a[(int)Mesh.ArrayType.Tangent] = tanL.ToArray(); a[(int)Mesh.ArrayType.Index] = idx;
            var box = RenderingServer.MeshGetSurface(old.GetRid(), si)["aabb"].AsAabb();
            bool custom = a[(int)Mesh.ArrayType.Custom0].VariantType != Variant.Type.Nil;
            if (!KeepBox(a, box, custom)) throw new IOException("A corner left its box: " + path);
            var temp = new ArrayMesh();
            long of = (long)old.SurfaceGetFormat(si);
            var keep = (Mesh.ArrayFormat)(of & ((long)Mesh.ArrayFormat.FlagCompressAttributes | ((long)Mesh.ArrayFormat.FormatCustomMask << (int)Mesh.ArrayFormat.FormatCustom0Shift)));
            temp.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, a, null, null, keep);
            if (temp.SurfaceGetFormat(0) != old.SurfaceGetFormat(si)) throw new IOException($"Format differs: {path} {temp.SurfaceGetFormat(0)} {old.SurfaceGetFormat(si)}");
            // the mesh again: its other surfaces as stored, this one new
            var surfaces = (Godot.Collections.Array)old.Get("_surfaces");
            var newSurf = ((Godot.Collections.Array)temp.Get("_surfaces"))[0].AsGodotDictionary();
            var oldSurf = surfaces[si].AsGodotDictionary();
            foreach (var k in new[] { "material", "name" }) if (oldSurf.ContainsKey(k)) newSurf[k] = oldSurf[k];
            var list = new Godot.Collections.Array(surfaces); list[si] = newSurf;
            var mesh = new ArrayMesh { ResourceName = old.ResourceName };
            foreach (var key in old.GetMetaList()) mesh.SetMeta(key, old.GetMeta(key));
            mesh.Set("_surfaces", list);
            if (mesh.GetSurfaceCount() != old.GetSurfaceCount()) throw new IOException("Surfaces lost: " + path);
            for (int i = 0; i < mesh.GetSurfaceCount(); i++) mesh.SurfaceSetMaterial(i, old.SurfaceGetMaterial(i));
            made.Add((path, mesh));
            counts[path] = new { node = e.GetProperty("node").GetString(), surface = si, turned = want.Count, copiedCorners = copies.Count };
        }

        // the shaders: the generator's new code for each kind (relief: the ones relief-repair finds untouched; the merged ones
        // given as files), and the old stone turns its flags
        foreach (var s in manifest.GetProperty("shaders").EnumerateArray())
        {
            string holder = s.GetProperty("holder").GetString()!;
            var res = ResourceLoader.Load<Resource>(holder, null, ResourceLoader.CacheMode.Ignore);
            var sh = res as Shader ?? (res as ShaderMaterial)!.Shader;
            if (Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(N(sh.Code)))) != s.GetProperty("codeHash").GetString()) throw new IOException("Shader changed since the candidate: " + holder);
            string code = s.TryGetProperty("file", out var f) ? N(File.ReadAllText(Path.Combine(candidate, f.GetString()!))) : N(Psx.ShaderOf(JsonSerializer.Deserialize<Psx.Kind>(sh.GetMeta("native_psx_kind").AsString())).Code);
            sh.Code = code;
            made.Add((holder, res));
            counts[holder] = new { shader = sh.ResourcePath, from = s.TryGetProperty("file", out _) ? "merged" : "generator" };
        }

        var originals = new Dictionary<string, string>(); var installed = new Dictionary<string, string>();
        foreach (var (path, res) in made)
        {
            originals[path] = Hash(path);
            File.Copy(ProjectSettings.GlobalizePath(path), Path.Combine(backup, Path.GetFileName(path)), false);
            if (res is Shader) res.TakeOverPath(path);
            if (ResourceSaver.Save(res, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            installed[path] = Hash(path);
            var back = ResourceLoader.Load<Resource>(path, null, ResourceLoader.CacheMode.Ignore);
            if (back is ArrayMesh bm && res is ArrayMesh rm)
            {
                if (bm.GetSurfaceCount() != rm.GetSurfaceCount()) throw new IOException("Reload differs: " + path);
                for (int i = 0; i < rm.GetSurfaceCount(); i++)
                    if (bm.SurfaceGetArrayIndexLen(i) != rm.SurfaceGetArrayIndexLen(i) || bm.SurfaceGetArrayLen(i) != rm.SurfaceGetArrayLen(i)) throw new IOException("Reload differs: " + path);
            }
        }
        // the old stone turns its flags (after its shader is stored: a material keeps only the uniforms its shader has)
        originals[OldStone] = Hash(OldStone);
        File.Copy(ProjectSettings.GlobalizePath(OldStone), Path.Combine(backup, Path.GetFileName(OldStone)), false);
        var stone = ResourceLoader.Load<ShaderMaterial>(OldStone, null, ResourceLoader.CacheMode.Ignore);
        stone.SetShaderParameter("slab_turn", 1.0f);
        if (ResourceSaver.Save(stone, OldStone, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(OldStone);
        if (ResourceLoader.Load<ShaderMaterial>(OldStone, null, ResourceLoader.CacheMode.Ignore).GetShaderParameter("slab_turn").AsSingle() != 1f) throw new IOException("slab_turn not kept: " + OldStone);
        installed[OldStone] = Hash(OldStone);
        File.WriteAllText(Path.Combine(record, "promotion.json"), JsonSerializer.Serialize(new { date = DateTime.UtcNow.ToString("u"), candidate, backup, resources = made.Select(m => m.path).Append(OldStone), originalHashes = originals, installedHashes = installed, counts },
            new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Paving promoted: {made.Count} files; originals in {backup}");
    }

    static void SetTan(List<float> t, int v, Vector3 d)
    {
        d = d.LengthSquared() > 1e-12f ? d.Normalized() : Vector3.Right;
        t[v * 4] = d.X; t[v * 4 + 1] = d.Y; t[v * 4 + 2] = d.Z; t[v * 4 + 3] = 1f;
    }

    // a copy of corner v's attributes at the end of each per-vertex array (positions and tangents are added by the caller)
    static void Copy(Godot.Collections.Array a, int v)
    {
        void V2(Mesh.ArrayType t) { if (a[(int)t].VariantType == Variant.Type.Nil) return; var x = a[(int)t].AsVector2Array(); a[(int)t] = x.Append(x[v]).ToArray(); }
        if (a[(int)Mesh.ArrayType.Normal].VariantType != Variant.Type.Nil) { var n = a[(int)Mesh.ArrayType.Normal].AsVector3Array(); a[(int)Mesh.ArrayType.Normal] = n.Append(n[v]).ToArray(); }
        V2(Mesh.ArrayType.TexUV); V2(Mesh.ArrayType.TexUV2);
        if (a[(int)Mesh.ArrayType.Color].VariantType != Variant.Type.Nil) { var c = a[(int)Mesh.ArrayType.Color].AsColorArray(); a[(int)Mesh.ArrayType.Color] = c.Append(c[v]).ToArray(); }
        if (a[(int)Mesh.ArrayType.Custom0].VariantType != Variant.Type.Nil) { var c = a[(int)Mesh.ArrayType.Custom0].AsFloat32Array(); a[(int)Mesh.ArrayType.Custom0] = c.Append(c[v * 2]).Append(c[v * 2 + 1]).ToArray(); }
    }

    // FacadesPromote's: the old box kept (two unused corners at its ends), each corner in the middle of its packing step
    static bool KeepBox(Godot.Collections.Array a, Aabb box, bool custom0)
    {
        var pos = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        if (pos.Length == 0 || box.Size == Vector3.Zero) return false;
        var grown = box.Grow(1e-4f);
        if (pos.Any(p => !grown.HasPoint(p))) return false;
        float Mid(float v, float lo, float size)
        {
            if (size <= 0) return v;
            double q = Math.Clamp(Math.Round((v - lo) / (double)size * 65535.0), 0, 65535);
            return q >= 65535 ? lo + size : (float)(lo + (q + 0.5) / 65535.0 * size);
        }
        for (int i = 0; i < pos.Length; i++)
            pos[i] = new Vector3(Mid(pos[i].X, box.Position.X, box.Size.X), Mid(pos[i].Y, box.Position.Y, box.Size.Y), Mid(pos[i].Z, box.Position.Z, box.Size.Z));
        a[(int)Mesh.ArrayType.Vertex] = pos.Append(box.Position).Append(box.End).ToArray();
        void Two(Mesh.ArrayType t)
        {
            var x = a[(int)t]; if (x.VariantType == Variant.Type.Nil) return;
            if (t is Mesh.ArrayType.Normal) { var n = x.AsVector3Array(); a[(int)t] = n.Append(n[0]).Append(n[0]).ToArray(); }
            else if (t is Mesh.ArrayType.Tangent) { var n = x.AsFloat32Array(); a[(int)t] = n.Concat(n.Take(4)).Concat(n.Take(4)).ToArray(); }
            else if (t is Mesh.ArrayType.Color) { var n = x.AsColorArray(); a[(int)t] = n.Append(n[0]).Append(n[0]).ToArray(); }
            else { var n = x.AsVector2Array(); a[(int)t] = n.Append(n[0]).Append(n[0]).ToArray(); }
        }
        Two(Mesh.ArrayType.Normal); Two(Mesh.ArrayType.Tangent); Two(Mesh.ArrayType.TexUV); Two(Mesh.ArrayType.TexUV2); Two(Mesh.ArrayType.Color);
        if (custom0) { var c = a[(int)Mesh.ArrayType.Custom0].AsFloat32Array(); a[(int)Mesh.ArrayType.Custom0] = c.Append(c[0]).Append(c[1]).Append(c[0]).Append(c[1]).ToArray(); }
        return true;
    }

    // world-space rows (16 floats a corner) -> indexed arrays in the node's space; identical rows share one vertex
    static (Godot.Collections.Array, int, int) Rows(string file, Transform3D transform)
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
        var pos = new Vector3[n]; var norm = new Vector3[n]; var uv = new Vector2[n]; var col = new Color[n];
        for (int k = 0; k < n; k++)
        {
            int j = order[k] * 16; pos[k] = inv * new Vector3(data[j], data[j + 1], data[j + 2]);
            norm[k] = (transform.Basis.Transposed() * new Vector3(data[j + 3], data[j + 4], data[j + 5])).Normalized();
            uv[k] = new(data[j + 6], data[j + 7]); col[k] = new(data[j + 10], data[j + 11], data[j + 12], data[j + 13]);
        }
        var a = new Godot.Collections.Array(); a.Resize((int)Mesh.ArrayType.Max);
        a[(int)Mesh.ArrayType.Vertex] = pos; a[(int)Mesh.ArrayType.Normal] = norm; a[(int)Mesh.ArrayType.TexUV] = uv;
        a[(int)Mesh.ArrayType.Color] = col; a[(int)Mesh.ArrayType.Index] = indices;
        return (a, n, count / 3);
    }
}
