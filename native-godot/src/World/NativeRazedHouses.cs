using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Houses pulled down after the bake: city_build.json marks them <c>"gone": true, "razed": true</c>. "gone" alone means the bake never
/// built the house; the rest of the game (doors, routing, gutters, gulls, market stalls) already leaves both kinds out. A razed house
/// is still in the town's merged chunks, so its triangles are cut out of them here, before collision and navigation are built from
/// the meshes. The merged chunks give every vertex of one house the same colour alpha; the house's own alpha is the one that covers
/// most of its footprint, and only triangles with that alpha near the footprint go, so a neighbour's wall, cornice or roof that
/// touches it stays. The night window glows carry no house alpha: there a glow goes when it lies on the footprint and does not face
/// out of a standing neighbour (the neighbour's own front on the shared line).
/// </summary>
public static class NativeRazedHouses
{
    public sealed record Result(int Houses, int Triangles, int WindowGlows, IReadOnlyList<string> Notes);

    private sealed record House(int Index, Vector2[] Outline, bool Razed);

    // the house's own parts reach this far past its outline (cornices, sills, eaves, drainpipes)
    private const float Reach = 1.2f;
    // the triangles that name a house's alpha lie at least this far inside its outline
    private const float Inset = 0.4f;

    public static Result Cut(Node3D town, string cityBuildPath)
    {
        var notes = new List<string>();
        var houses = Read(cityBuildPath);
        var razed = houses.Where(h => h.Razed).ToList();
        if (razed.Count == 0) return new(0, 0, 0, notes);
        var meshes = BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh).ToList();
        var chunks = meshes.Where(m => m.Name.ToString().StartsWith("city_", StringComparison.Ordinal)).ToList();
        var glows = meshes.Where(m => m.Name.ToString().StartsWith("ambient_windows", StringComparison.Ordinal) || m.GetParent()?.Name.ToString().StartsWith("ambient_windows", StringComparison.Ordinal) == true).ToList();
        var standing = houses.Where(h => !h.Razed && razed.Any(r => Near(h.Outline, r.Outline, Reach + 1))).ToList();

        var tags = new Dictionary<int, int>();
        foreach (var house in razed)
        {
            int? tag = OwnAlpha(chunks, house.Outline);
            if (tag == null) { notes.Add($"house {house.Index}: no own alpha found, left as baked"); continue; }
            // a standing neighbour with the same alpha would lose its edge: leave the house rather than cut a neighbour
            var near = standing.Where(n => Near(n.Outline, house.Outline, Reach + 1)).Where(n => OwnAlpha(chunks, n.Outline) == tag).Select(n => n.Index).ToList();
            if (near.Count > 0) { notes.Add($"house {house.Index}: alpha {tag} also on neighbour {string.Join(",", near)}, left as baked"); continue; }
            tags[house.Index] = tag.Value;
        }
        var cut = razed.Where(h => tags.ContainsKey(h.Index)).ToList();
        bool Touches(MeshInstance3D m) => cut.Any(h => Overlaps(WorldOf(m) * m.GetAabb(), h.Outline, Reach));
        chunks = chunks.Where(Touches).ToList(); glows = glows.Where(Touches).ToList();
        int triangles = 0, glowTriangles = 0;
        foreach (var mesh in chunks)
            triangles += Filter(mesh, (a, b, c, alpha) => cut.Any(h => alpha == tags[h.Index] && Within(h.Outline, Centre(a, b, c), Reach)));
        foreach (var mesh in glows)
            glowTriangles += Filter(mesh, (a, b, c, _) =>
            {
                var centre = Centre(a, b, c);
                if (!cut.Any(h => Within(h.Outline, centre, 0.3f))) return false;
                var normal = (b - a).Cross(c - a);
                var flat = new Vector2(normal.X, normal.Z);
                if (flat.LengthSquared() < 1e-8f) return true;
                // a glow on a standing neighbour's front: its window looks out of that neighbour, into the cleared ground
                foreach (var n in standing)
                    if (Within(n.Outline, centre, 0.3f) && !Inside(n.Outline, new Vector2(centre.X, centre.Z) + flat.Normalized() * 0.5f)) return false;
                return true;
            });
        foreach (var h in cut) notes.Add($"house {h.Index}: razed (alpha {tags[h.Index]})");
        return new(cut.Count, triangles, glowTriangles, notes);
    }

    private static List<House> Read(string path)
    {
        var result = new List<House>();
        if (!File.Exists(path)) return result;
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        int index = 0;
        foreach (var h in doc.RootElement.GetProperty("houses").EnumerateArray())
        {
            int i = index++;
            bool gone = h.TryGetProperty("gone", out var g) && g.ValueKind == JsonValueKind.True;
            bool razed = h.TryGetProperty("razed", out var r) && r.ValueKind == JsonValueKind.True;
            if (gone && !razed) continue;
            if (!h.TryGetProperty("fp", out var fp) || fp.GetArrayLength() < 3) continue;
            result.Add(new House(i, fp.EnumerateArray().Select(q => new Vector2((float)q[0].GetDouble(), (float)q[1].GetDouble())).ToArray(), razed));
        }
        return result;
    }

    /// <summary>The alpha byte that covers most of a footprint's inner part (by the triangles' plan area and height).</summary>
    private static int? OwnAlpha(List<MeshInstance3D> chunks, Vector2[] outline)
    {
        var area = new Dictionary<int, float>();
        foreach (var mesh in chunks)
        {
            var xf = WorldOf(mesh);
            var box = xf * mesh.GetAabb();
            if (!Overlaps(box, outline, 0)) continue;
            var m = (ArrayMesh)mesh.Mesh;
            for (int s = 0; s < m.GetSurfaceCount(); s++)
            {
                var arrays = m.SurfaceGetArrays(s);
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var colours = arrays[(int)Mesh.ArrayType.Color];
                if (colours.VariantType != Variant.Type.PackedColorArray) continue;
                var col = colours.AsColorArray();
                var index = Indices(arrays, v.Length);
                for (int t = 0; t + 2 < index.Length; t += 3)
                {
                    Vector3 a = xf * v[index[t]], b = xf * v[index[t + 1]], c = xf * v[index[t + 2]];
                    var centre = Centre(a, b, c);
                    var p = new Vector2(centre.X, centre.Z);
                    if (!Inside(outline, p) || EdgeDistance(outline, p) < Inset) continue;
                    int alpha = (int)MathF.Round(col[index[t]].A * 255);
                    area[alpha] = area.GetValueOrDefault(alpha) + (b - a).Cross(c - a).Length() * 0.5f;
                }
            }
        }
        if (area.Count == 0) return null;
        var best = area.MaxBy(kv => kv.Value);
        return best.Value >= area.Values.Sum() * 0.5f ? best.Key : null;
    }

    /// <summary>Drops the triangles a test picks; returns how many went.</summary>
    private static int Filter(MeshInstance3D mesh, Func<Vector3, Vector3, Vector3, int, bool> drop)
    {
        var xf = WorldOf(mesh);
        var source = (ArrayMesh)mesh.Mesh;
        var rebuilt = new ArrayMesh { ResourceName = source.ResourceName };
        int dropped = 0;
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var arrays = source.SurfaceGetArrays(s);
            var type = source.SurfaceGetPrimitiveType(s);
            if (type == Mesh.PrimitiveType.Triangles)
            {
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var colours = arrays[(int)Mesh.ArrayType.Color];
                var col = colours.VariantType == Variant.Type.PackedColorArray ? colours.AsColorArray() : null;
                var index = Indices(arrays, v.Length);
                var kept = new List<int>(index.Length);
                for (int t = 0; t + 2 < index.Length; t += 3)
                {
                    int alpha = col != null ? (int)MathF.Round(col[index[t]].A * 255) : -1;
                    if (drop(xf * v[index[t]], xf * v[index[t + 1]], xf * v[index[t + 2]], alpha)) { dropped++; continue; }
                    kept.Add(index[t]); kept.Add(index[t + 1]); kept.Add(index[t + 2]);
                }
                arrays[(int)Mesh.ArrayType.Index] = kept.ToArray();
            }
            rebuilt.AddSurfaceFromArrays(type, arrays, null, null, source.SurfaceGetFormat(s));
            rebuilt.SurfaceSetMaterial(s, source.SurfaceGetMaterial(s));
        }
        if (dropped > 0) mesh.Mesh = rebuilt;
        return dropped;
    }

    private static int[] Indices(Godot.Collections.Array arrays, int count)
    {
        var index = arrays[(int)Mesh.ArrayType.Index];
        return index.VariantType == Variant.Type.PackedInt32Array && index.AsInt32Array().Length > 0 ? index.AsInt32Array() : Enumerable.Range(0, count).ToArray();
    }

    private static Transform3D WorldOf(Node3D node)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
        return xf;
    }

    private static Vector3 Centre(Vector3 a, Vector3 b, Vector3 c) => (a + b + c) / 3;

    private static bool Within(Vector2[] outline, Vector3 p, float margin)
    {
        var q = new Vector2(p.X, p.Z);
        return Inside(outline, q) || EdgeDistance(outline, q) <= margin;
    }

    private static bool Inside(Vector2[] p, Vector2 q)
    {
        bool inside = false;
        for (int i = 0, j = p.Length - 1; i < p.Length; j = i++)
            if ((p[i].Y > q.Y) != (p[j].Y > q.Y) && q.X < (p[j].X - p[i].X) * (q.Y - p[i].Y) / (p[j].Y - p[i].Y) + p[i].X) inside = !inside;
        return inside;
    }

    private static float EdgeDistance(Vector2[] p, Vector2 q)
    {
        float best = float.MaxValue;
        for (int i = 0, j = p.Length - 1; i < p.Length; j = i++)
        {
            var ab = p[i] - p[j];
            float t = ab.LengthSquared() < 1e-9f ? 0 : Math.Clamp((q - p[j]).Dot(ab) / ab.LengthSquared(), 0, 1);
            best = Math.Min(best, q.DistanceTo(p[j] + ab * t));
        }
        return best;
    }

    private static bool Near(Vector2[] a, Vector2[] b, float distance) => a.Any(p => Inside(b, p) || EdgeDistance(b, p) <= distance) || b.Any(p => Inside(a, p) || EdgeDistance(a, p) <= distance);

    private static bool Overlaps(Aabb box, Vector2[] outline, float margin)
    {
        float x0 = outline.Min(p => p.X) - margin, x1 = outline.Max(p => p.X) + margin, z0 = outline.Min(p => p.Y) - margin, z1 = outline.Max(p => p.Y) + margin;
        return box.Position.X <= x1 && box.End.X >= x0 && box.Position.Z <= z1 && box.End.Z >= z0;
    }
}
