using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

/// <summary>Audit native ground boundaries; --apply adds a 25 mm buried overlap to their bedding.
/// Walkable faces stay exactly where they were. No sheet is added beneath cellars or the Ruien.</summary>
public partial class GroundSeamRepair : Node
{
    private readonly record struct Point(int X, int Y, int Z) : IComparable<Point>
    {
        public int CompareTo(Point other) { int n = X.CompareTo(other.X); if (n == 0) n = Y.CompareTo(other.Y); return n == 0 ? Z.CompareTo(other.Z) : n; }
    }
    private static Point Key(Vector3 p) => new((int)MathF.Round(p.X * 10000), (int)MathF.Round(p.Y * 10000), (int)MathF.Round(p.Z * 10000));
    private readonly record struct Edge(Point A, Point B);
    public override void _Ready()
    {
        try
        {
            var args = OS.GetCmdlineUserArgs(); int at = Array.IndexOf(args, "--record");
            if (at < 0 || at + 1 >= args.Length) throw new ArgumentException("--record <outside-project directory>");
            string output = args[at + 1]; Directory.CreateDirectory(output);
            bool apply = args.Contains("--apply");
            var scene = ResourceLoader.Load<PackedScene>("res://world/town/roots/node-00004.scn").Instantiate<Node3D>(); AddChild(scene);
            var rows = new List<object>();
            foreach (var mi in scene.FindChildren("ground_*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
            {
                if (mi.Name.ToString() is not ("ground_earth" or "ground_grass" or "ground_flags" or "ground_cobble" or "ground_quay") || mi.Mesh is not ArrayMesh mesh) continue;
                if (mesh.HasMeta("ground_joint_overlap")) throw new InvalidOperationException("Ground bedding overlap is already present: " + mesh.ResourcePath);
                var result = apply ? new ArrayMesh { ResourceName = mesh.ResourceName } : null;
                if (result != null) foreach (var key in mesh.GetMetaList()) result.SetMeta(key, mesh.GetMeta(key));
                for (int s = 0; s < mesh.GetSurfaceCount(); s++)
                {
                    var arrays = mesh.SurfaceGetArrays(s);
                    var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var ix = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                    var edges = new Dictionary<Edge, (int Count, int A, int B, int C)>();
                    for (int t = 0; t < ix.Length; t += 3)
                        for (int k = 0; k < 3; k++)
                        {
                            int ai = ix[t + k], bi = ix[t + (k + 1) % 3];
                            Point a = Key(v[ai]), b = Key(v[bi]); if (a == b) continue;
                            var key = a.CompareTo(b) < 0 ? new Edge(a, b) : new Edge(b, a);
                            if (edges.TryGetValue(key, out var old)) edges[key] = (old.Count + 1, old.A, old.B, old.C);
                            else edges[key] = (1, ai, bi, ix[t + (k + 2) % 3]);
                        }
                    var boundary = edges.Values.Where(e => e.Count == 1).ToArray();
                    var lines = boundary.Select(e => new { a = new[] { v[e.A].X, v[e.A].Y, v[e.A].Z }, b = new[] { v[e.B].X, v[e.B].Y, v[e.B].Z } }).ToArray();
                    rows.Add(new { node = mi.Name.ToString(), mesh = mesh.ResourcePath, surface = s, triangles = ix.Length / 3, edges = boundary.Length, metres = boundary.Sum(e => v[e.A].DistanceTo(v[e.B])), lines });
                    GD.Print($"Ground boundaries: {mi.Name}: {boundary.Length} edges, {boundary.Sum(e => v[e.A].DistanceTo(v[e.B])):0.0} m");
                    if (result == null) continue;
                    var copies = new List<int>(); var addedPositions = new List<Vector3>(); var addedUvs = new List<Vector2>(); var indices = new List<int>(ix);
                    var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                    foreach (var edge in boundary)
                    {
                        var a = v[edge.A]; var b = v[edge.B]; var c = v[edge.C];
                        var along = b - a;
                        if (along.Length() < 0.001f || Math.Abs(along.Y) > 0.001f) continue;
                        var outward = Vector3.Up.Cross(along).Normalized();
                        if (outward.Dot(c - a) > 0) outward = -outward;
                        var down = Vector3.Down * 0.004f;
                        var p = new[] { a + down, b + down, b + down + outward * 0.025f, a + down + outward * 0.025f };
                        int first = v.Length + copies.Count;
                        var e1 = b - a; var e2 = c - a; float det = e1.X * e2.Z - e1.Z * e2.X;
                        for (int k = 0; k < 4; k++)
                        {
                            copies.Add(k is 0 or 3 ? edge.A : edge.B); addedPositions.Add(p[k]);
                            var d = p[k] - a;
                            float u = Math.Abs(det) > 1e-10f ? (d.X * e2.Z - d.Z * e2.X) / det : 0;
                            float w = Math.Abs(det) > 1e-10f ? (e1.X * d.Z - e1.Z * d.X) / det : 0;
                            addedUvs.Add(uv[edge.A] + (uv[edge.B] - uv[edge.A]) * u + (uv[edge.C] - uv[edge.A]) * w);
                        }
                        bool flip = (p[1] - p[0]).Cross(p[2] - p[0]).Y > 0;
                        indices.AddRange(flip ? new[] { first, first + 2, first + 1, first, first + 3, first + 2 } : new[] { first, first + 1, first + 2, first, first + 2, first + 3 });
                    }
                    for (int attr = 0; attr < (int)Mesh.ArrayType.Max; attr++)
                    {
                        if (attr == (int)Mesh.ArrayType.Index || arrays[attr].VariantType == Variant.Type.Nil) continue;
                        if (attr == (int)Mesh.ArrayType.Vertex) { arrays[attr] = v.Concat(addedPositions).ToArray(); continue; }
                        if (attr == (int)Mesh.ArrayType.TexUV) { arrays[attr] = uv.Concat(addedUvs).ToArray(); continue; }
                        arrays[attr] = arrays[attr].VariantType switch
                        {
                            Variant.Type.PackedVector3Array => Extend(arrays[attr].AsVector3Array(), copies, 1),
                            Variant.Type.PackedVector2Array => Extend(arrays[attr].AsVector2Array(), copies, 1),
                            Variant.Type.PackedColorArray => Extend(arrays[attr].AsColorArray(), copies, 1),
                            Variant.Type.PackedFloat32Array => Extend(arrays[attr].AsFloat32Array(), copies, arrays[attr].AsFloat32Array().Length / v.Length),
                            Variant.Type.PackedByteArray => Extend(arrays[attr].AsByteArray(), copies, arrays[attr].AsByteArray().Length / v.Length),
                            _ => throw new InvalidDataException("Unsupported ground attribute " + attr)
                        };
                    }
                    arrays[(int)Mesh.ArrayType.Index] = indices.ToArray();
                    long custom = 0;
                    foreach (int shift in new[] { (int)Mesh.ArrayFormat.FormatCustom0Shift, (int)Mesh.ArrayFormat.FormatCustom1Shift, (int)Mesh.ArrayFormat.FormatCustom2Shift, (int)Mesh.ArrayFormat.FormatCustom3Shift }) custom |= (long)Mesh.ArrayFormat.FormatCustomMask << shift;
                    result.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, (Mesh.ArrayFormat)((long)mesh.SurfaceGetFormat(s) & custom));
                    result.SurfaceSetMaterial(s, mesh.SurfaceGetMaterial(s));
                }
                if (result == null) continue;
                string file = ProjectSettings.GlobalizePath(mesh.ResourcePath), backup = Path.Combine(output, Path.GetFileName(file));
                if (File.Exists(backup)) throw new IOException("Backup exists: " + backup);
                File.Copy(file, backup);
                result.SetMeta("ground_joint_overlap", 0.025f);
                if (ResourceSaver.Save(result, mesh.ResourcePath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(mesh.ResourcePath);
                GD.Print($"Ground saved: {mesh.ResourcePath} {Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)))}");
            }
            File.WriteAllText(Path.Combine(output, "ground-boundaries.json"), JsonSerializer.Serialize(rows));
            GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
    private static T[] Extend<T>(T[] data, List<int> copies, int stride)
    {
        var result = new T[data.Length + copies.Count * stride]; Array.Copy(data, result, data.Length);
        for (int i = 0; i < copies.Count; i++) Array.Copy(data, copies[i] * stride, result, data.Length + i * stride, stride);
        return result;
    }
}
