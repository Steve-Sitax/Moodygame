using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

/// <summary>Apply a reviewed fitted-junction plan. Original mesh channels remain unchanged.
/// Plan and backups must be outside the project; no collision or scene nodes are rewritten.</summary>
public partial class GroundJunctionRepair : Node
{
    public override void _Ready()
    {
        try
        {
            var args = OS.GetCmdlineUserArgs(); int at = Array.IndexOf(args, "--record");
            if (at < 0 || at + 1 >= args.Length) throw new ArgumentException("--record <outside-project directory>");
            string output = Path.GetFullPath(args[at + 1]);
            string project = Path.GetFullPath(ProjectSettings.GlobalizePath("res://"));
            if (output.StartsWith(project, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Backups must be outside the project.");
            Directory.CreateDirectory(output);
            bool apply = args.Contains("--apply");
            int planAt = Array.IndexOf(args, "--plan");
            if (planAt < 0 || planAt + 1 >= args.Length) throw new ArgumentException("--plan <reviewed JSON>");
            using var plan = JsonDocument.Parse(File.ReadAllText(args[planAt + 1]));

            var rows = new List<object>();
            foreach (var group in plan.RootElement.EnumerateArray().GroupBy(p => p.GetProperty("resource").GetString()!))
            {
                if (!new[] { "r000008", "r000017", "r000025", "r000031", "r000039" }.Any(id => group.Key == $"res://world/town/resources/{id}.res"))
                    throw new InvalidDataException("Plan refers to a resource outside the five ground meshes.");
                string originalHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(group.Key))));
                if (group.Any(p => p.GetProperty("source_sha256").GetString() != originalHash)) throw new InvalidDataException("Plan source hash mismatch.");
                var mesh = ResourceLoader.Load<ArrayMesh>(group.Key);
                if (mesh.GetSurfaceCount() != 1) throw new InvalidDataException("Expected original one-surface ground mesh.");
                if (mesh.HasMeta("ground_fitted_junctions") || mesh.HasMeta("ground_joint_overlap")) throw new InvalidOperationException("Use original resources, not accumulated repairs.");
                var result = apply ? (ArrayMesh)mesh.Duplicate() : null;
                if (result != null) foreach (var key in mesh.GetMetaList()) result.SetMeta(key, mesh.GetMeta(key));
                for (int s = 0; s < mesh.GetSurfaceCount(); s++)
                {
                    var arrays = mesh.SurfaceGetArrays(s);
                    var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var ix = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                    int plannedTriangles = group.Sum(p => p.TryGetProperty("points", out var points) ? points.GetArrayLength() - 2 : 2);
                    if (result == null)
                    {
                        rows.Add(new { mesh = mesh.ResourcePath, sourceSha256 = originalHash, originalTriangles = ix.Length / 3, plannedTriangles });
                        continue;
                    }
                    int collapsedTriangles = 0;
                    var addedNormals = new List<Vector3>(); var sourceNormals = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                    var weights = new List<(int A, int B, int C, float U, float W)>(); var copies = new List<int>(); var addedPositions = new List<Vector3>(); var addedUvs = new List<Vector2>(); var indices = new List<int>();
                    var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                    foreach (var patch in group)
                    {
                        var tri = patch.GetProperty("triangle").EnumerateArray().Select(x => x.GetInt32()).ToArray();
                        var edge = (A: tri[0], B: tri[1], C: tri[2]);
                        var a = v[edge.A]; var b = v[edge.B]; var c = v[edge.C];
                        bool spatial = patch.TryGetProperty("xyz", out var xyz);
                        var coordinates = spatial ? xyz.EnumerateArray().ToArray() : patch.TryGetProperty("points", out var points) ? points.EnumerateArray().ToArray() : new[] { "a", "b", "c", "d" }.Select(key => patch.GetProperty(key)).ToArray();
                        var p = coordinates.Select(point => {
                            var xy = point.EnumerateArray().Select(x => x.GetSingle()).ToArray();
                            return spatial ? new Vector3(xy[0], xy[1], xy[2]) : new Vector3(xy[0], a.Y, xy[1]);
                        }).ToArray();
                        if (p.Any(x => !x.IsFinite()) || p.Length is not (3 or 4) || patch.GetProperty("width").GetSingle() > 0.0201f)
                            throw new InvalidDataException("Invalid fitted junction");
                        int first = copies.Count;
                        var e1 = b - a; var e2 = c - a; float det = e1.X * e2.Z - e1.Z * e2.X;
                        for (int k = 0; k < p.Length; k++)
                        {
                            int copied = k is 0 or 3 ? edge.A : edge.B;
                            copies.Add(copied); addedPositions.Add(p[k]);
                            if (patch.TryGetProperty("normal", out var normal))
                            {
                                var n = normal.EnumerateArray().Select(x => x.GetSingle()).ToArray();
                                addedNormals.Add(new Vector3(n[0], n[1], n[2]).Normalized());
                            }
                            else addedNormals.Add(sourceNormals[copied]);
                            var d = p[k] - a;
                            float u = Math.Abs(det) > 1e-10f ? (d.X * e2.Z - d.Z * e2.X) / det : 0;
                            float w = Math.Abs(det) > 1e-10f ? (e1.X * d.Z - e1.Z * d.X) / det : 0;
                            weights.Add((edge.A, edge.B, edge.C, u, w)); addedUvs.Add(uv[edge.A] + (uv[edge.B] - uv[edge.A]) * u + (uv[edge.C] - uv[edge.A]) * w);
                        }
                        for (int k = 1; k + 1 < p.Length; k++)
                        {
                            // An end of a fitted quad can collapse to a point at native float precision.
                            // Check each triangle independently: the other half can remain valid.
                            var cross = (p[k] - p[0]).Cross(p[k + 1] - p[0]);
                            if (cross.LengthSquared() == 0) { collapsedTriangles++; continue; }
                            bool flip = cross.Y > 0;
                            indices.AddRange(flip ? new[] { first, first + k + 1, first + k } : new[] { first, first + k, first + k + 1 });
                        }
                    }
                    for (int attr = 0; attr < (int)Mesh.ArrayType.Max; attr++)
                    {
                        if (attr == (int)Mesh.ArrayType.Index || arrays[attr].VariantType == Variant.Type.Nil) continue;
                        if (attr == (int)Mesh.ArrayType.Normal) { arrays[attr] = addedNormals.ToArray(); continue; }
                        if (attr == (int)Mesh.ArrayType.Vertex) { arrays[attr] = addedPositions.ToArray(); continue; }
                        if (attr == (int)Mesh.ArrayType.TexUV) { arrays[attr] = addedUvs.ToArray(); continue; }
                        arrays[attr] = arrays[attr].VariantType switch
                        {
                            Variant.Type.PackedVector3Array => Extend(arrays[attr].AsVector3Array(), copies, 1),
                            Variant.Type.PackedVector2Array => Interpolate(arrays[attr].AsVector2Array(), weights),
                            Variant.Type.PackedColorArray => Interpolate(arrays[attr].AsColorArray(), weights),
                            Variant.Type.PackedFloat32Array => Extend(arrays[attr].AsFloat32Array(), copies, arrays[attr].AsFloat32Array().Length / v.Length),
                            Variant.Type.PackedByteArray => Extend(arrays[attr].AsByteArray(), copies, arrays[attr].AsByteArray().Length / v.Length),
                            _ => throw new InvalidDataException("Unsupported ground attribute " + attr)
                        };
                    }
                    arrays[(int)Mesh.ArrayType.Index] = indices.ToArray();
                    long custom = 0;
                    foreach (int shift in new[] { (int)Mesh.ArrayFormat.FormatCustom0Shift, (int)Mesh.ArrayFormat.FormatCustom1Shift, (int)Mesh.ArrayFormat.FormatCustom2Shift, (int)Mesh.ArrayFormat.FormatCustom3Shift }) custom |= (long)Mesh.ArrayFormat.FormatCustomMask << shift;
                    if (group.Any(p => p.TryGetProperty("xyz", out _)))
                    {
                        // Generate a tangent frame for the sloped bedding returns, without rewriting originals.
                        using var temporary = new ArrayMesh();
                        temporary.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, (Mesh.ArrayFormat)((long)mesh.SurfaceGetFormat(s) & custom));
                        using var surface = new SurfaceTool(); surface.CreateFrom(temporary, 0); surface.GenerateTangents();
                        arrays[(int)Mesh.ArrayType.Tangent] = surface.CommitToArrays()[(int)Mesh.ArrayType.Tangent];
                    }
                    result.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, (Mesh.ArrayFormat)((long)mesh.SurfaceGetFormat(s) & custom));
                    result.SurfaceSetMaterial(result.GetSurfaceCount() - 1, mesh.SurfaceGetMaterial(s));
                    rows.Add(new { mesh = mesh.ResourcePath, sourceSha256 = originalHash, originalTriangles = ix.Length / 3, plannedTriangles, addedTriangles = indices.Count / 3, collapsedTriangles });
                }
                if (result == null) continue;
                string file = ProjectSettings.GlobalizePath(mesh.ResourcePath), backup = Path.Combine(output, Path.GetFileName(file));
                if (File.Exists(backup)) throw new IOException("Backup exists: " + backup);
                File.Copy(file, backup);
                result.SetMeta("ground_fitted_junctions", group.Count());
                if (ResourceSaver.Save(result, mesh.ResourcePath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(mesh.ResourcePath);
                GD.Print($"Ground saved: {mesh.ResourcePath} {Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)))}");
            }
            File.WriteAllText(Path.Combine(output, "junction-receipts.json"), JsonSerializer.Serialize(rows));
            GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
    private static Vector2[] Interpolate(Vector2[] data, List<(int A, int B, int C, float U, float W)> weights) =>
        weights.Select(w => data[w.A] + (data[w.B] - data[w.A]) * w.U + (data[w.C] - data[w.A]) * w.W).ToArray();
    private static Color[] Interpolate(Color[] data, List<(int A, int B, int C, float U, float W)> weights) =>
        weights.Select(w => data[w.A] + (data[w.B] - data[w.A]) * w.U + (data[w.C] - data[w.A]) * w.W).ToArray();
    private static T[] Extend<T>(T[] data, List<int> copies, int stride)
    {
        var result = new T[copies.Count * stride];
        for (int i = 0; i < copies.Count; i++) Array.Copy(data, copies[i] * stride, result, i * stride, stride);
        return result;
    }
}
