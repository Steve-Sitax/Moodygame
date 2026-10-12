using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World;

/// <summary>Landing places from actual bollard meshes, including authored names and merged quay geometry.</summary>
public static class GullPerches
{
    public sealed record Perch(Vector3 Top, float Height);
    public sealed record Geometry(Vector3[] Positions, Vector2[] Uv, int[] Indices);
    private sealed record Triangle(Vector3 A, Vector3 B, Vector3 C, Vector3 Top, float Height, Vector3[] Probes);
    private readonly record struct UvPoint(int X, int Y) : IComparable<UvPoint>
    {
        public int CompareTo(UvPoint other) { int x = X.CompareTo(other.X); return x != 0 ? x : Y.CompareTo(other.Y); }
    }
    private readonly record struct UvTriangle(UvPoint A, UvPoint B, UvPoint C);
    private const float Tolerance = .008f;
    private static bool Bollard(string name) => name.StartsWith("bollard", StringComparison.OrdinalIgnoreCase);
    private static string SourceName(Node node) => node.HasMeta("source_name") ? node.GetMeta("source_name").AsString() : node.Name.ToString();
    private static bool IsBollard(Node node) => Bollard(node.Name.ToString()) || Bollard(SourceName(node))
        || node.HasMeta("native_perch_kind") && node.GetMeta("native_perch_kind").AsString() == "bollard";

    public static IReadOnlyList<Perch> Find(Node3D world)
    {
        var result = new List<Perch>();
        var merged = new List<Geometry>();
        foreach (var node in BakedWorld.All(world).OfType<Node3D>())
        {
            if (!node.IsVisibleInTree()) continue;
            if (IsBollard(node))
            {
                // A recovered asset has the identity both on its wrapper and mesh: visit it once.
                bool nested = false;
                for (var p = node.GetParent(); p != null && p != world; p = p.GetParent())
                    if (IsBollard(p)) { nested = true; break; }
                if (nested) continue;
                if (node is MultiMeshInstance3D { Multimesh: { Mesh: not null } } copies)
                {
                    int count = copies.Multimesh.VisibleInstanceCount < 0 ? copies.Multimesh.InstanceCount : copies.Multimesh.VisibleInstanceCount;
                    for (int i = 0; i < count; i++) AddBox(result, copies.GlobalTransform * copies.Multimesh.GetInstanceTransform(i) * copies.Multimesh.Mesh.GetAabb());
                }
                else
                {
                    Aabb? bounds = null;
                    foreach (var mesh in BakedWorld.All(node).OfType<MeshInstance3D>())
                    {
                        if (mesh.Mesh == null || !mesh.IsVisibleInTree()) continue;
                        var b = mesh.GlobalTransform * mesh.GetAabb(); bounds = bounds is { } old ? old.Merge(b) : b;
                    }
                    if (bounds is { } box) AddBox(result, box);
                }
            }
            if (node is MeshInstance3D { Mesh: not null } chunk && SourceName(node).StartsWith("quayfurniture", StringComparison.Ordinal))
                merged.AddRange(Surfaces(chunk.Mesh, chunk.GlobalTransform));
        }
        if (merged.Count == 0) return result;
        // Source chunks retain prototype UVs. Match those and three edge lengths, then verify distributed
        // vertices of the whole solid model. A stain, a similar cylinder or a removed bollard cannot qualify.
        var prototypes = new List<(Geometry shape, Vector3 top, float height)>();
        if (ModelLibrary.Get("quayfurniture") is { } model)
            foreach (var pair in model.Roots.Where(p => Bollard(p.Key)))
            {
                var shapes = BakedWorld.All(pair.Value).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.Visible)
                    .SelectMany(m => Surfaces(m.Mesh!, RelativePose(m, model.Scene))).ToArray();
                if (shapes.Length == 0) continue;
                var solid = shapes.OrderByDescending(s => s.Indices.Length).First();
                var bounds = Bounds(solid.Positions);
                prototypes.Add((solid, new(bounds.GetCenter().X, bounds.End.Y, bounds.GetCenter().Z), bounds.Size.Y));
            }
        foreach (var perch in Match(merged, prototypes)) AddUnique(result, perch);
        return result;
    }

    private static Transform3D RelativePose(Node3D node, Node root)
    {
        var pose = node.Transform;
        for (var p = node.GetParent(); p != null && p != root; p = p.GetParent()) if (p is Node3D n) pose = n.Transform * pose;
        return pose;
    }
    private static IEnumerable<Geometry> Surfaces(Mesh mesh, Transform3D pose)
    {
        for (int s = 0; s < mesh.GetSurfaceCount(); s++)
        {
            if (mesh is ArrayMesh arrayMesh && arrayMesh.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles) continue;
            var a = mesh.SurfaceGetArrays(s);
            var points = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var uv = a[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.Nil ? Array.Empty<Vector2>() : a[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            if (points.Length == 0 || uv.Length != points.Length) continue;
            var indices = a[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, points.Length).ToArray() : a[(int)Mesh.ArrayType.Index].AsInt32Array();
            yield return new(points.Select(p => pose * p).ToArray(), uv, indices);
        }
    }
    private static Aabb Bounds(Vector3[] positions)
    {
        var box = new Aabb(positions[0], Vector3.Zero); foreach (var point in positions) box = box.Expand(point); return box;
    }
    private static void AddBox(List<Perch> output, Aabb box)
    {
        if (box.Size.Y <= .1f || box.Size.Y > 2 || box.Size.X > 1.5f || box.Size.Z > 1.5f) return;
        AddUnique(output, new(new(box.GetCenter().X, box.End.Y, box.GetCenter().Z), box.Size.Y));
    }
    private static void AddUnique(List<Perch> output, Perch perch)
    {
        if (!perch.Top.IsFinite() || output.Any(p => p.Top.DistanceSquaredTo(perch.Top) < .04f)) return;
        output.Add(perch);
    }
    private static (int X, int Y, int Z) Cell(Vector3 point) => ((int)MathF.Floor(point.X / Tolerance), (int)MathF.Floor(point.Y / Tolerance), (int)MathF.Floor(point.Z / Tolerance));
    private static UvTriangle Key(Geometry geometry, int offset, out int[] order)
    {
        order = new[] { geometry.Indices[offset], geometry.Indices[offset + 1], geometry.Indices[offset + 2] };
        UvPoint U(int i) => new((int)MathF.Round(geometry.Uv[i].X * 100000), (int)MathF.Round(geometry.Uv[i].Y * 100000));
        Array.Sort(order, (a, b) => U(a).CompareTo(U(b)));
        return new(U(order[0]), U(order[1]), U(order[2]));
    }

    /// <summary>Pure mesh matching also used by the fixture. All target positions are world coordinates.</summary>
    public static IReadOnlyList<Perch> Match(IReadOnlyList<Geometry> target, IReadOnlyList<(Geometry shape, Vector3 top, float height)> prototypes)
    {
        var candidates = new Dictionary<UvTriangle, List<Triangle>>();
        foreach (var prototype in prototypes)
        {
            var g = prototype.shape; var choices = new List<(float area, UvTriangle key, int[] order)>();
            for (int i = 0; i + 2 < g.Indices.Length; i += 3)
            {
                var key = Key(g, i, out var order);
                if (key.A == key.B || key.A == key.C || key.B == key.C) continue;
                var a = g.Positions[order[0]]; var b = g.Positions[order[1]]; var c = g.Positions[order[2]];
                float area = (b - a).Cross(c - a).LengthSquared();
                if (area > .000001f) choices.Add((area, key, order));
            }
            var probes = Enumerable.Range(0, Math.Min(24, g.Positions.Length)).Select(i => g.Positions[i * (g.Positions.Length - 1) / Math.Max(1, Math.Min(24, g.Positions.Length) - 1)]).ToArray();
            foreach (var choice in choices.OrderByDescending(c => c.area).Take(6))
            {
                if (!candidates.TryGetValue(choice.key, out var list)) candidates[choice.key] = list = new();
                var q = choice.order;
                list.Add(new(g.Positions[q[0]], g.Positions[q[1]], g.Positions[q[2]], prototype.top, prototype.height, probes));
            }
        }
        var grid = new Dictionary<(int, int, int), List<Vector3>>();
        foreach (var g in target) foreach (var p in g.Positions)
        {
            var key = Cell(p); if (!grid.TryGetValue(key, out var list)) grid[key] = list = new(); list.Add(p);
        }
        bool Contains(Vector3 p)
        {
            var cell = Cell(p);
            for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++)
                if (grid.TryGetValue((cell.X + x, cell.Y + y, cell.Z + z), out var list) && list.Any(q => q.DistanceSquaredTo(p) <= Tolerance * Tolerance)) return true;
            return false;
        }
        var result = new List<Perch>();
        foreach (var g in target) for (int i = 0; i + 2 < g.Indices.Length; i += 3)
        {
            if (!candidates.TryGetValue(Key(g, i, out var q), out var list)) continue;
            var a = g.Positions[q[0]]; var b = g.Positions[q[1]]; var c = g.Positions[q[2]];
            foreach (var source in list)
            {
                if (MathF.Abs(a.DistanceTo(b) - source.A.DistanceTo(source.B)) > .002f || MathF.Abs(a.DistanceTo(c) - source.A.DistanceTo(source.C)) > .002f || MathF.Abs(b.DistanceTo(c) - source.B.DistanceTo(source.C)) > .002f) continue;
                var local = new Basis(source.B - source.A, source.C - source.A, (source.B - source.A).Cross(source.C - source.A).Normalized());
                var world = new Basis(b - a, c - a, (b - a).Cross(c - a).Normalized());
                if (MathF.Abs(local.Determinant()) < .00001f || MathF.Abs(world.Determinant()) < .00001f) continue;
                var rotation = world * local.Inverse();
                // Bollards stand upright; rejects a differently oriented panel with the same atlas coordinates.
                if ((rotation * Vector3.Up).Dot(Vector3.Up) < .98f) continue;
                var pose = new Transform3D(rotation, a - rotation * source.A);
                var perch = new Perch(pose * source.Top, source.Height);
                if (result.Any(p => p.Top.DistanceSquaredTo(perch.Top) < .04f) || source.Probes.Any(p => !Contains(pose * p))) continue;
                AddUnique(result, perch);
            }
        }
        return result;
    }
}
