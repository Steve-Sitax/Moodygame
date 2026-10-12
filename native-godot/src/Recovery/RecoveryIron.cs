using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Native.Recovery;

/// <summary>The mounting flange and body share worn iron; the paving stain stays separate.</summary>
public static class RecoveryIron
{
    public static ArrayMesh Build(Mesh source)
    {
        var mesh = new ArrayMesh { ResourceName = source.ResourceName };
        var casting = Enumerable.Range(0, source.GetSurfaceCount()).Select(source.SurfaceGetMaterial).OfType<ShaderMaterial>()
            .FirstOrDefault(m => m.HasMeta("native_surface_kind") && m.GetMeta("native_surface_kind").AsString() == "cast_iron")
            ?? new ShaderMaterial { ResourceName = "native_cast_iron", Shader = ResourceLoader.Load<Shader>("res://shaders/cast_iron.gdshader") };
        casting.SetMeta("native_surface_kind", "cast_iron");
        if (casting.GetShaderParameter("surface_depth").VariantType == Variant.Type.Nil) casting.SetShaderParameter("surface_depth", 1f);
        for (int surface = 0; surface < source.GetSurfaceCount(); surface++)
        {
            var arrays = source.SurfaceGetArrays(surface); var positions = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var material = source.SurfaceGetMaterial(surface);
            if (material is BaseMaterial3D standard && standard.ResourceName == "qf_solid")
            {
                var indices = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Array.Empty<int>() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                if (indices.Length == 0) indices = Enumerable.Range(0, positions.Length).ToArray();
                var stone = new List<int>(); var iron = new List<int>();
                for (int i = 0; i < indices.Length; i += 3)
                {
                    var group = Math.Max(positions[indices[i]].Y, Math.Max(positions[indices[i + 1]].Y, positions[indices[i + 2]].Y)) > 0.064f ? iron : stone;
                    group.AddRange(indices.Skip(i).Take(3));
                }
                void Add(List<int> selected, Material mat)
                {
                    if (selected.Count == 0) return;
                    var copy = arrays.Duplicate(); copy[(int)Mesh.ArrayType.Index] = selected.ToArray();
                    mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, copy); mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, mat);
                }
                if (stone.Count > 0)
                {
                    var used = stone.Select(i => positions[i]).ToArray();
                    var bounds = new Aabb(used[0], Vector3.Zero); foreach (var p in used) bounds = bounds.Expand(p);
                    mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, Flange(bounds)); mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, casting);
                }
                Add(iron, casting);
            }
            else
            {
                if (material is BaseMaterial3D decal && decal.ResourceName == "qf_decal")
                {
                    // The rust stain lies on the paving below the mounting flange.
                    for (int i = 0; i < positions.Length; i++) positions[i].Y = 0.002f;
                    arrays[(int)Mesh.ArrayType.Vertex] = positions;
                }
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays); mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, material);
            }
        }
        mesh.SetMeta("native_iron_detail", 2);
        mesh.SetMeta("native_flange_edge_bevel", 0.002f); mesh.SetMeta("native_flange_corner_radius", 0.006f);
        return mesh;
    }

    private static Godot.Collections.Array Flange(Aabb bounds)
    {
        float half = Math.Min(bounds.Size.X, bounds.Size.Z) / 2, height = bounds.Size.Y;
        var centre = bounds.GetCenter(); centre.Y = bounds.Position.Y;
        var profile = new[] { new Vector2(half - 0.002f, 0), new Vector2(half, 0.002f), new Vector2(half, height * 0.53f),
            new Vector2(half - 0.002f, height * 0.60f), new Vector2(half * 0.918f, height - 0.002f), new Vector2(half * 0.91f, height) };
        const int steps = 4, count = 4 * (steps + 1); const float radius = 0.006f;
        var vertices = new List<Vector3>(); var normals = new List<Vector3>();
        (Vector3 p, Vector3 n) Point(int ring, int index)
        {
            int corner = index / (steps + 1), step = index % (steps + 1);
            float angle = (corner + step / (float)steps) * Mathf.Pi / 2;
            var direction = new Vector3(Mathf.Cos(angle), 0, Mathf.Sin(angle));
            float x = corner is 0 or 3 ? 1 : -1, z = corner is 0 or 1 ? 1 : -1;
            var p = centre + new Vector3(x * (profile[ring].X - radius), profile[ring].Y, z * (profile[ring].X - radius)) + direction * radius;
            var slope = ring == profile.Length - 1 ? new Vector2(0, 1) : ring == 0 ? new Vector2(0.7071f, -0.7071f)
                : new Vector2(profile[ring + 1].Y - profile[ring - 1].Y, profile[ring - 1].X - profile[ring + 1].X).Normalized();
            return (p, direction * slope.X + Vector3.Up * slope.Y);
        }
        void Triangle((Vector3 p, Vector3 n) a, (Vector3 p, Vector3 n) b, (Vector3 p, Vector3 n) c)
        {
            if ((b.p - a.p).Cross(c.p - a.p).Dot(a.n + b.n + c.n) > 0) (b, c) = (c, b);
            foreach (var p in new[] { a, b, c }) { vertices.Add(p.p); normals.Add(p.n); }
        }
        for (int ring = 0; ring < profile.Length - 1; ring++)
            for (int i = 0; i < count; i++)
            {
                int next = (i + 1) % count;
                Triangle(Point(ring, i), Point(ring, next), Point(ring + 1, next)); Triangle(Point(ring, i), Point(ring + 1, next), Point(ring + 1, i));
            }
        for (int i = 0; i < count; i++)
        {
            int next = (i + 1) % count;
            Triangle((centre, Vector3.Down), (Point(0, i).p, Vector3.Down), (Point(0, next).p, Vector3.Down));
            Triangle((centre + Vector3.Up * height, Vector3.Up), (Point(profile.Length - 1, i).p, Vector3.Up), (Point(profile.Length - 1, next).p, Vector3.Up));
        }
        var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = vertices.ToArray(); arrays[(int)Mesh.ArrayType.Normal] = normals.ToArray();
        return arrays;
    }

    public static ConcavePolygonShape3D Collider(Mesh mesh)
    {
        using var solid = new ArrayMesh();
        for (int surface = 0; surface < mesh.GetSurfaceCount(); surface++)
        {
            var material = mesh.SurfaceGetMaterial(surface);
            if (material?.ResourceName == "qf_decal" || material != null && material.HasMeta("legacy_no_collision") && material.GetMeta("legacy_no_collision").AsBool()) continue;
            solid.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, mesh.SurfaceGetArrays(surface));
        }
        var shape = solid.CreateTrimeshShape(); shape.BackfaceCollision = true; return shape;
    }
}
