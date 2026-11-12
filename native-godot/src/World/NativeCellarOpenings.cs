using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Open the drawn paving over cellar treads, as Solid does for the player's collision.</summary>
public static class NativeCellarOpenings
{
    // Merge only convex unions: a single clipping region then has exactly the same footprint,
    // without cutting across an L-shaped stair's inside corner or bridging separate flights.
    private static List<Vector2[]> Merge(List<Vector2[]> polygons)
    {
        for (int i = 0; i < polygons.Count; i++)
            for (int j = i + 1; j < polygons.Count; j++)
            {
                var union = Geometry2D.MergePolygons(polygons[i], polygons[j]);
                if (union.Count != 1) continue;
                var p = union[0];
                if (Enumerable.Range(0, p.Length).Any(k => (p[(k + 1) % p.Length] - p[k]).Cross(p[(k + 2) % p.Length] - p[(k + 1) % p.Length]) < -1e-7f)) continue;
                polygons[i] = p; polygons.RemoveAt(j);
                i = -1; break; // a larger footprint can now join an earlier neighbour
            }
        return polygons;
    }

    private static Transform3D Frame(Node3D node)
    {
        var frame = Transform3D.Identity;
        for (Node? n = node; n is Node3D part; n = n.GetParent()) frame = part.Transform * frame;
        return frame;
    }

    public static void Cut(Node3D town, Action<string> note)
    {
        if (Scheldemist.Main.I?.Flag("no-stair-holes") == true) return;
        using var timing = Scheldemist.Dev.StartupTiming.Measure("cellar paving openings");
        var nodes = BakedWorld.All(town).ToArray();
        var linings = nodes.OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.Name.ToString().StartsWith("house_lining_"))
            .ToDictionary(m => m.Name.ToString(), StringComparer.Ordinal);
        var faces = new Dictionary<Mesh, Vector3[]>();
        Vector3[] Read(Mesh mesh)
        {
            if (faces.TryGetValue(mesh, out var result)) return result;
            var points = new List<Vector3>();
            var skip = mesh.HasMeta("native_solid_skip") ? mesh.GetMeta("native_solid_skip").AsInt32Array() : Array.Empty<int>();
            if (mesh.HasMeta("native_solid_stand_in")) points.AddRange(mesh.GetMeta("native_solid_stand_in").AsVector3Array());
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                if (Array.IndexOf(skip, s) >= 0 || mesh is ArrayMesh am && am.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles) continue;
                if (mesh.SurfaceGetMaterial(s) is ShaderMaterial { Shader: { } shader })
                {
                    string code = shader.Code;
                    int end = code.IndexOf(';', Math.Max(0, code.IndexOf("render_mode", StringComparison.Ordinal)));
                    string modes = end > 0 ? code[..end] : "";
                    if (modes.Contains("blend_add") || modes.Contains("depth_draw_never")) continue;
                }
                var arrays = mesh.SurfaceGetArrays(s);
                var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var indices = arrays[(int)Mesh.ArrayType.Index];
                if (indices.VariantType == Variant.Type.Nil) points.AddRange(vertices.Take(vertices.Length - vertices.Length % 3));
                else foreach (int index in indices.AsInt32Array()) points.Add(vertices[index]);
            }
            return faces[mesh] = points.ToArray();
        }
        using var batch = QuayNotch.BeginCutBatch(town);
        foreach (var room in nodes.OfType<Node3D>().Where(n => n.Name.ToString().StartsWith("ROOM_")))
        {
            string name = room.Name.ToString();
            if (!linings.TryGetValue("house_lining_" + name[5..], out var lining)) continue;
            float floor = (Frame(lining) * lining.Mesh!.GetAabb()).Position.Y;
            var meshes = BakedWorld.All(room).OfType<MeshInstance3D>().Where(m => m.Mesh != null).ToArray();
            if (meshes.Length == 0) continue;
            float lowest = meshes.Min(m => (Frame(m) * m.Mesh!.GetAabb()).Position.Y);
            if (lowest >= floor - 1) continue;
            // Capture world triangles once; both passes use managed arrays, with no repeated engine reads.
            var triangles = meshes.SelectMany(m => { var xf = Frame(m); return Read(m.Mesh!).Select(p => xf * p); }).ToArray();
            float level = float.PositiveInfinity;
            for (int i = 0; i + 2 < triangles.Length; i += 3)
            {
                var a = triangles[i]; var b = triangles[i + 1]; var c = triangles[i + 2];
                var normal = (b - a).Cross(c - a); float length = normal.Length();
                if (length * .5f >= 1 && MathF.Abs(normal.Y) >= length * .9f) level = Math.Min(level, (a.Y + b.Y + c.Y) / 3);
            }
            if (!float.IsFinite(level)) level = lowest + .2f;
            float reach = Math.Min(lowest + .3f, level + .15f);
            var polygons = new List<Vector2[]>();
            for (int i = 0; i + 2 < triangles.Length; i += 3)
            {
                var a = triangles[i]; var b = triangles[i + 1]; var c = triangles[i + 2];
                var normal = (b - a).Cross(c - a); float length = normal.Length(), y = (a.Y + b.Y + c.Y) / 3;
                if (MathF.Abs(normal.Y) < length * .9f || length * .5f < .08f || y > floor - .1f || y < reach) continue;
                var poly = new[] { new Vector2(a.X, a.Z), new Vector2(b.X, b.Z), new Vector2(c.X, c.Z) };
                if ((poly[1] - poly[0]).Cross(poly[2] - poly[0]) < 0) (poly[1], poly[2]) = (poly[2], poly[1]);
                polygons.Add(poly);
            }
            int treads = polygons.Count;
            var regions = new List<QuayNotch.Region>();
            foreach (var footprint in Merge(polygons))
            {
                // The Poesje's metre-wide flight has an open railing beside it: its well is wider
                // than the treads. Clear that side gap too, beneath the existing house-floor lining.
                // Other cellar flights only need the 40 mm overlap into their enclosing masonry.
                float overlap = name == "ROOM_poesje" ? .30f : .04f;
                var expanded = Geometry2D.OffsetPolygon(footprint, overlap, Geometry2D.PolyJoinType.Miter);
                var poly = expanded.Count == 1 ? expanded[0] : footprint;
                var lo = poly.Aggregate((a,b) => a.Min(b)); var hi = poly.Aggregate((a,b) => a.Max(b));
                var edges = new List<Func<Vector3, float>>();
                for (int e = 0; e < poly.Length; e++)
                {
                    var p = poly[e]; var d = poly[(e + 1) % poly.Length] - p;
                    edges.Add(v => d.Cross(new Vector2(v.X, v.Z) - p));
                }
                regions.Add(new QuayNotch.Region(new Aabb(new Vector3(lo.X, floor - .12f, lo.Y), new Vector3(hi.X - lo.X, .24f, hi.Y - lo.Y)), edges));
            }
            if (regions.Count == 0) continue;
            int changed = QuayNotch.CutRegions(town, m =>
            {
                string source = m.HasMeta("source_name") ? m.GetMeta("source_name").AsString() : m.Name.ToString();
                return source.StartsWith("ground_", StringComparison.Ordinal) || m == lining;
            }, tri =>
            {
                var (a, b, c) = tri; var normal = (b - a).Cross(c - a);
                return MathF.Abs(normal.Y) > normal.Length() * .9f && MathF.Abs((a.Y + b.Y + c.Y) / 3 - floor) < .12f;
            }, regions);
            note($"cellar {name}: {treads} tread triangles merged into {regions.Count} footprints, {changed} paving/lining triangles cut");
        }
    }
}
