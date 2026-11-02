using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

/// <summary>#227: lay the church vaults' rebuilt webs (scripts/vault_webs.py) into their stored meshes.
/// Run vault-web-repair.tscn -- --root node-09897 --plan &lt;vault_webs.py output&gt; --record &lt;dir outside the checkout&gt;.
/// For each mesh in the plan: the listed triangles leave the surface, the new ones (world space in the plan) join it in
/// the mesh's own space, with every attribute the surface has (tangents from the uv, the rest zero). Refuses a surface
/// whose triangle count is not the plan's source (so it never lays the webs twice).</summary>
public partial class VaultWebRepair : Node
{
    public override void _Ready()
    {
        try { Lay(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }

    static string Arg(string name)
    {
        var args = OS.GetCmdlineUserArgs(); int at = Array.IndexOf(args, "--" + name);
        return at >= 0 && at + 1 < args.Length ? args[at + 1] : "";
    }

    void Lay()
    {
        string root = Arg("root"), planFile = Arg("plan"), output = Arg("record");
        if (root == "" || planFile == "" || output == "") throw new ArgumentException("--root, --plan and --record are required");
        Directory.CreateDirectory(output);
        var scene = ResourceLoader.Load<PackedScene>($"res://world/town/roots/{root}.scn").Instantiate<Node3D>(); AddChild(scene);
        using var plan = JsonDocument.Parse(File.ReadAllText(planFile));
        var records = new List<object>();
        foreach (var m in plan.RootElement.GetProperty("meshes").EnumerateArray())
        {
            var node = scene.GetNode<MeshInstance3D>(m.GetProperty("node").GetString()!);
            var source = (ArrayMesh)node.Mesh;
            string path = source.ResourcePath;
            if (path != m.GetProperty("resource").GetString()) throw new InvalidDataException($"{node.Name}: mesh {path}, plan {m.GetProperty("resource").GetString()}");
            int surface = m.GetProperty("surface").GetInt32();
            var removed = m.GetProperty("removed").EnumerateArray().Select(e => e.GetInt32()).ToHashSet();
            if (removed.Count == 0) { GD.Print($"Vault webs: {node.Name}: nothing rebuilt"); continue; }
            var inv = node.GlobalTransform.AffineInverse();
            var result = new ArrayMesh { ResourceName = source.ResourceName };
            foreach (var key in source.GetMetaList()) result.SetMeta(key, source.GetMeta(key));
            int before = 0, after = 0, added = 0;
            for (int s = 0; s < source.GetSurfaceCount(); s++)
            {
                var arrays = source.SurfaceGetArrays(s);
                if (s == surface)
                {
                    var ix = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                    before = ix.Length / 3;
                    if (before != m.GetProperty("sourceTriangles").GetInt32()) throw new InvalidDataException($"{node.Name}: {before} triangles, the plan was made from {m.GetProperty("sourceTriangles").GetInt32()} (laid already?)");
                    if (removed.Max() >= before) throw new InvalidDataException($"{node.Name}: the plan removes triangle {removed.Max()} of {before}");
                    var keep = new List<int>();
                    for (int t = 0; t < before; t++) if (!removed.Contains(t)) keep.AddRange(new[] { ix[3 * t], ix[3 * t + 1], ix[3 * t + 2] });
                    var tris = m.GetProperty("triangles").EnumerateArray().ToArray();
                    int baseV = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length;
                    var pos = new List<Vector3>(arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array());
                    var nor = new List<Vector3>(arrays[(int)Mesh.ArrayType.Normal].AsVector3Array());
                    bool hasTan = arrays[(int)Mesh.ArrayType.Tangent].VariantType != Variant.Type.Nil;
                    var tan = hasTan ? new List<float>(arrays[(int)Mesh.ArrayType.Tangent].AsFloat32Array()) : null;
                    bool hasCol = arrays[(int)Mesh.ArrayType.Color].VariantType != Variant.Type.Nil;
                    var col = hasCol ? new List<Color>(arrays[(int)Mesh.ArrayType.Color].AsColorArray()) : null;
                    var uv = new List<Vector2>(arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array());
                    bool hasUv2 = arrays[(int)Mesh.ArrayType.TexUV2].VariantType != Variant.Type.Nil;
                    var uv2 = hasUv2 ? new List<Vector2>(arrays[(int)Mesh.ArrayType.TexUV2].AsVector2Array()) : null;
                    foreach (int other in new[] { (int)Mesh.ArrayType.Custom0, (int)Mesh.ArrayType.Custom1, (int)Mesh.ArrayType.Custom2, (int)Mesh.ArrayType.Custom3, (int)Mesh.ArrayType.Bones, (int)Mesh.ArrayType.Weights })
                        if (arrays[other].VariantType != Variant.Type.Nil) throw new InvalidDataException($"{node.Name}: surface carries array {other}");
                    var basisInv = inv.Basis;
                    foreach (var t in tris)
                    {
                        var p = t.GetProperty("p").EnumerateArray().Select(e => e.GetSingle()).ToArray();
                        var n = t.GetProperty("n").EnumerateArray().Select(e => e.GetSingle()).ToArray();
                        var u = t.GetProperty("uv").EnumerateArray().Select(e => e.GetSingle()).ToArray();
                        var c = t.GetProperty("c").EnumerateArray().Select(e => e.GetSingle()).ToArray();
                        var P = new Vector3[3]; var U = new Vector2[3];
                        for (int k = 0; k < 3; k++) { P[k] = inv * new Vector3(p[3 * k], p[3 * k + 1], p[3 * k + 2]); U[k] = new Vector2(u[2 * k], u[2 * k + 1]); }
                        // the tangent: the way u grows across the triangle, in the mesh's space
                        Vector3 e1 = P[1] - P[0], e2 = P[2] - P[0]; Vector2 d1 = U[1] - U[0], d2 = U[2] - U[0];
                        float det = d1.X * d2.Y - d2.X * d1.Y;
                        var tg = Math.Abs(det) > 1e-12f ? ((e1 * d2.Y - e2 * d1.Y) / det) : e1;
                        for (int k = 0; k < 3; k++)
                        {
                            var nn = (basisInv * new Vector3(n[3 * k], n[3 * k + 1], n[3 * k + 2])).Normalized();
                            pos.Add(P[k]); nor.Add(nn); uv.Add(U[k]);
                            if (hasTan) { var tt = (tg - nn * nn.Dot(tg)).Normalized(); tan!.AddRange(new[] { tt.X, tt.Y, tt.Z, 1f }); }
                            if (hasCol) col!.Add(new Color(c[0], c[1], c[2], c[3]));
                            if (hasUv2) uv2!.Add(Vector2.Zero);
                            keep.Add(baseV + added * 3 + k);
                        }
                        added++;
                    }
                    arrays[(int)Mesh.ArrayType.Vertex] = pos.ToArray();
                    arrays[(int)Mesh.ArrayType.Normal] = nor.ToArray();
                    if (hasTan) arrays[(int)Mesh.ArrayType.Tangent] = tan!.ToArray();
                    if (hasCol) arrays[(int)Mesh.ArrayType.Color] = col!.ToArray();
                    arrays[(int)Mesh.ArrayType.TexUV] = uv.ToArray();
                    if (hasUv2) arrays[(int)Mesh.ArrayType.TexUV2] = uv2!.ToArray();
                    arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
                    after = keep.Count / 3;
                }
                var flags = (Mesh.ArrayFormat)((long)source.SurfaceGetFormat(s) & (long)Mesh.ArrayFormat.FlagCompressAttributes);
                result.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), arrays, null, null, flags);
                result.SurfaceSetMaterial(result.GetSurfaceCount() - 1, source.SurfaceGetMaterial(s));
                if (result.SurfaceGetFormat(result.GetSurfaceCount() - 1) != source.SurfaceGetFormat(s)) throw new InvalidDataException($"{node.Name} surface {s}: format {result.SurfaceGetFormat(result.GetSurfaceCount() - 1)} was {source.SurfaceGetFormat(s)}");
            }
            if (before - removed.Count + added != after) throw new InvalidDataException($"{node.Name}: count {before} - {removed.Count} + {added} != {after}");
            string file = ProjectSettings.GlobalizePath(path);
            var bytes = File.ReadAllBytes(file);
            string backup = Path.Combine(output, Path.GetFileName(file));
            if (File.Exists(backup)) throw new IOException("Backup exists; use a fresh record directory");
            File.WriteAllBytes(backup, bytes);
            if (ResourceSaver.Save(result, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
            records.Add(new { mesh = path, node = m.GetProperty("node").GetString(), before, removed = removed.Count, added, after, beforeHash = Convert.ToHexString(SHA256.HashData(bytes)), afterHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))) });
            GD.Print($"Vault webs: {node.Name} ({path}): {before} triangles, {removed.Count} out, {added} in, {after} now");
        }
        File.AppendAllText(Path.Combine(output, "vault-webs.json"), JsonSerializer.Serialize(records, new JsonSerializerOptions { WriteIndented = true }) + "\n");
    }
}
