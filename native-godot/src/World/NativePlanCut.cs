using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Cuts convex plan polygons (world x, z) out of the town's baked meshes at load, before collision and the walk map read
/// them: each triangle wholly under a height that reaches into a polygon keeps only its parts outside it (Sutherland-
/// Hodgman, one edge's outer half-plane inside the edges before it; a point on an edge is outside; every per-vertex
/// attribute carried with the corners' weights, the custom channels too). scripts/paving/pavement_mends.py cuts its dump
/// of the town the same way.
/// - #247/#242: the pavement joins take the old flags', kerbs' and gutters' triangles away where a corner is built anew
///   (NativeSquareDressing.Mend), their solid stand-ins with them.
/// - The street's ground drawn under something that lies lower than its setts' relief reaches (the relief is drawn
///   pulled toward the eye and showed through): a join's new gutter stones, a tree pit's sunken earth (#235). The ground's
///   drawn triangles go there, its stand-in stays (what is walked on and collides is unchanged). These are queued
///   (<see cref="QueueGround"/>) and cut together in one pass (<see cref="CutQueuedGround"/>): the ground is one large mesh.
/// </summary>
public static class NativePlanCut
{
    private static readonly List<Vector2[]> GroundQueue = new();

    /// <summary>Polygons of the street's ground to cut away, drawn only, in the one pass after the town is dressed.</summary>
    public static void QueueGround(IEnumerable<Vector2[]> polygons) => GroundQueue.AddRange(polygons.Where(p => p.Length >= 3));

    /// <summary>The queued ground cuts (the ground_* meshes' drawn triangles under 5 cm); returns the triangles cut.</summary>
    public static int CutQueuedGround(Node3D town)
    {
        if (GroundQueue.Count == 0) return 0;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        int cut = Cut(town, GroundQueue, 0.05f, m => m.Name.ToString().StartsWith("ground_", StringComparison.Ordinal), null, false).Drawn;
        GD.Print($"plan cut: the street's ground drawn under {GroundQueue.Count} pieces (joins' gutters, sunken pit earth): {cut} triangles cut in {clock.ElapsedMilliseconds} ms");
        GroundQueue.Clear();
        return cut;
    }

    // the polygons' grid: a triangle is tried only against the polygons in the cells its box covers
    private const float Cell = 4f;

    private sealed class Grid
    {
        public readonly List<Vector2[]> Polygons;
        public readonly List<Rect2> Boxes;
        private readonly Dictionary<(int, int), List<int>> cells = new();
        public Grid(IEnumerable<Vector2[]> polygons)
        {
            // (each polygon turned counter-clockwise in x, z: inside is left of every edge)
            Polygons = polygons.Select(p =>
            {
                float a = 0;
                for (int i = 0; i < p.Length; i++) { var q = p[(i + p.Length - 1) % p.Length]; a += q.X * p[i].Y - p[i].X * q.Y; }
                return a < 0 ? p.Reverse().ToArray() : p;
            }).ToList();
            Boxes = Polygons.Select(p => { var b = new Rect2(p[0], Vector2.Zero); foreach (var q in p) b = b.Expand(q); return b; }).ToList();
            for (int i = 0; i < Boxes.Count; i++)
                for (int x = (int)MathF.Floor(Boxes[i].Position.X / Cell); x <= (int)MathF.Floor(Boxes[i].End.X / Cell); x++)
                    for (int z = (int)MathF.Floor(Boxes[i].Position.Y / Cell); z <= (int)MathF.Floor(Boxes[i].End.Y / Cell); z++)
                    {
                        if (!cells.TryGetValue((x, z), out var list)) cells[(x, z)] = list = new List<int>();
                        list.Add(i);
                    }
        }
        /// <summary>The polygons whose boxes a triangle's box (wholly under the top) reaches; null when none.</summary>
        public List<Vector2[]>? Near(Vector3 a, Vector3 b, Vector3 c, float top)
        {
            if (a.Y > top || b.Y > top || c.Y > top) return null;
            float x0 = Math.Min(a.X, Math.Min(b.X, c.X)), x1 = Math.Max(a.X, Math.Max(b.X, c.X)), z0 = Math.Min(a.Z, Math.Min(b.Z, c.Z)), z1 = Math.Max(a.Z, Math.Max(b.Z, c.Z));
            List<Vector2[]>? found = null;
            HashSet<int>? seen = null;
            for (int x = (int)MathF.Floor(x0 / Cell); x <= (int)MathF.Floor(x1 / Cell); x++)
                for (int z = (int)MathF.Floor(z0 / Cell); z <= (int)MathF.Floor(z1 / Cell); z++)
                {
                    if (!cells.TryGetValue((x, z), out var list)) continue;
                    foreach (int i in list)
                    {
                        var box = Boxes[i];
                        if (x1 <= box.Position.X || x0 >= box.End.X || z1 <= box.Position.Y || z0 >= box.End.Y) continue;
                        seen ??= new HashSet<int>();
                        if (!seen.Add(i)) continue;
                        (found ??= new List<Vector2[]>()).Add(Polygons[i]);
                    }
                }
            return found;
        }
    }

    /// <summary>
    /// Cuts the polygons out of the meshes <paramref name="which"/> picks: the triangles of their surfaces in the
    /// <paramref name="materials"/> (all when null) wholly under <paramref name="top"/>, and their solid stand-in faces
    /// under it when <paramref name="standIns"/>. A mesh nothing of which is cut is left as it is. Returns the drawn and the
    /// stand-in triangles cut.
    /// </summary>
    public static (int Drawn, int StandIn) Cut(Node3D town, IEnumerable<Vector2[]> polygons, float top, Func<MeshInstance3D, bool> which, HashSet<string>? materials, bool standIns)
    {
        var grid = new Grid(polygons);
        if (grid.Polygons.Count == 0) return (0, 0);
        var all = grid.Boxes.Aggregate((a, b) => a.Merge(b));
        int drawn = 0, standIn = 0;
        foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh && which(m)).ToList())
        {
            var xf = WorldOf(mesh);
            var aabb = xf * mesh.GetAabb();
            if (!all.Intersects(new Rect2(aabb.Position.X, aabb.Position.Z, aabb.Size.X, aabb.Size.Z))) continue;
            var source = (ArrayMesh)mesh.Mesh;
            // (first only the surfaces that may be cut, and only whether a triangle reaches a polygon's box)
            var arrays = new Godot.Collections.Array?[source.GetSurfaceCount()];
            bool any = false;
            for (int s = 0; s < source.GetSurfaceCount(); s++)
            {
                var material = mesh.GetActiveMaterial(s);
                if (source.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles || materials != null && (material == null || !materials.Contains(material.ResourcePath))) continue;
                arrays[s] = source.SurfaceGetArrays(s);
                if (Reaches(arrays[s]!, xf, grid, top)) any = true; else arrays[s] = null;
            }
            Vector3[]? faces = standIns && source.HasMeta("native_solid_stand_in") ? source.GetMeta("native_solid_stand_in").AsVector3Array() : null;
            bool facesReach = false;
            if (faces != null)
                for (int i = 0; i + 2 < faces.Length && !facesReach; i += 3)
                    facesReach = grid.Near(xf * faces[i], xf * faces[i + 1], xf * faces[i + 2], top) != null;
            if (!any && !facesReach) continue;
            var rebuilt = new ArrayMesh { ResourceName = source.ResourceName };
            foreach (var key in source.GetMetaList()) rebuilt.SetMeta(key, source.GetMeta(key));
            int before = drawn;
            for (int s = 0; s < source.GetSurfaceCount(); s++)
            {
                var surface = arrays[s] ?? source.SurfaceGetArrays(s);
                if (arrays[s] != null) drawn += CutSurface(surface, xf, grid, top);
                rebuilt.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), surface, null, null, source.SurfaceGetFormat(s));
                rebuilt.SurfaceSetMaterial(s, source.SurfaceGetMaterial(s));
                rebuilt.SurfaceSetName(s, source.SurfaceGetName(s));
            }
            bool facesCut = false;
            if (faces != null && facesReach)
            {
                var inv = xf.AffineInverse();
                var kept = new List<Vector3>(faces.Length);
                for (int i = 0; i + 2 < faces.Length; i += 3)
                {
                    Vector3 a = xf * faces[i], b = xf * faces[i + 1], c = xf * faces[i + 2];
                    var near = grid.Near(a, b, c, top);
                    var pieces = near == null ? null : Outside(new[] { new Corner(a, 1, 0, 0), new Corner(b, 0, 1, 0), new Corner(c, 0, 0, 1) }, near);
                    if (pieces == null) { kept.Add(faces[i]); kept.Add(faces[i + 1]); kept.Add(faces[i + 2]); continue; }
                    foreach (var piece in pieces) foreach (var k in piece) kept.Add(inv * k.W);
                    standIn++; facesCut = true;
                }
                if (facesCut) rebuilt.SetMeta("native_solid_stand_in", kept.ToArray());
            }
            if (drawn > before || facesCut) mesh.Mesh = rebuilt;
        }
        return (drawn, standIn);
    }

    private readonly record struct Corner(Vector3 W, float A, float B, float C);

    private static int[] Index(Godot.Collections.Array arrays, int count)
    {
        var index = arrays[(int)Mesh.ArrayType.Index];
        return index.VariantType == Variant.Type.PackedInt32Array && index.AsInt32Array().Length > 0 ? index.AsInt32Array() : Enumerable.Range(0, count).ToArray();
    }

    /// <summary>Whether any of a surface's triangles may be cut (its box reaches a polygon's).</summary>
    private static bool Reaches(Godot.Collections.Array arrays, Transform3D xf, Grid grid, float top)
    {
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var index = Index(arrays, v.Length);
        for (int t = 0; t + 2 < index.Length; t += 3)
            if (grid.Near(xf * v[index[t]], xf * v[index[t + 1]], xf * v[index[t + 2]], top) != null) return true;
        return false;
    }

    /// <summary>The parts of a triangle outside every polygon, as weight triangles; null when no part of it lies in any
    /// (keep it whole).</summary>
    private static List<Corner[]>? Outside(Corner[] tri, List<Vector2[]> polygons)
    {
        var pieces = new List<Corner[]> { tri };
        bool any = false;
        foreach (var poly in polygons)
        {
            var next = new List<Corner[]>();
            foreach (var piece in pieces)
            {
                var outside = OutsideOne(piece, poly);
                if (outside == null) next.Add(piece); else { next.AddRange(outside); any = true; }
            }
            pieces = next;
        }
        return any ? pieces : null;
    }

    private const float Eps = 1e-7f;

    private static List<Corner[]>? OutsideOne(Corner[] tri, Vector2[] poly)
    {
        float Side(int k, Vector3 p)
        {
            Vector2 a = poly[k], b = poly[(k + 1) % poly.Length];
            return (b.X - a.X) * (p.Z - a.Y) - (b.Y - a.Y) * (p.X - a.X) - Eps;
        }
        static List<Corner> Clip(List<Corner> rows, Func<Vector3, float> f)
        {
            var output = new List<Corner>(rows.Count + 2);
            for (int i = 0; i < rows.Count; i++)
            {
                var p = rows[i]; var q = rows[(i + 1) % rows.Count];
                float sp = f(p.W), sq = f(q.W);
                if (sp >= 0) output.Add(p);
                if ((sp >= 0) != (sq >= 0))
                {
                    float t = sp / (sp - sq);
                    output.Add(new Corner(p.W.Lerp(q.W, t), Mathf.Lerp(p.A, q.A, t), Mathf.Lerp(p.B, q.B, t), Mathf.Lerp(p.C, q.C, t)));
                }
            }
            return output;
        }
        static float Area(Corner a, Corner b, Corner c) => 0.5f * (b.W - a.W).Cross(c.W - a.W).Length();
        var rest = tri.ToList(); var pieces = new List<Corner[]>();
        for (int k = 0; k < poly.Length; k++)
        {
            int edge = k;
            var part = Clip(rest, p => -Side(edge, p) - 2 * Eps);
            for (int i = 1; i + 1 < part.Count; i++)
                if (Area(part[0], part[i], part[i + 1]) > 1e-10f) pieces.Add(new[] { part[0], part[i], part[i + 1] });
            rest = Clip(rest, p => Side(edge, p));
            if (rest.Count < 3) return null;
        }
        float inside = 0;
        for (int i = 1; i + 1 < rest.Count; i++) inside += Area(rest[0], rest[i], rest[i + 1]);
        return inside > 1e-9f ? pieces : null;
    }

    /// <summary>One surface's triangles cut (its arrays changed in place, every per-vertex attribute carried); returns how many.</summary>
    private static int CutSurface(Godot.Collections.Array arrays, Transform3D xf, Grid grid, float top)
    {
        if (arrays[(int)Mesh.ArrayType.Bones].VariantType != Variant.Type.Nil) return 0;
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        if (v.Length == 0) return 0;
        var index = Index(arrays, v.Length);
        // (the pieces' corners, appended after the surface's own; its own arrays copied only once a triangle is cut)
        List<Vector3>? vs = null, normals = null; List<Color>? colours = null; List<Vector2>? uv = null, uv2 = null;
        var floats = new Dictionary<int, (List<float> Data, int Stride)>();
        var bytes = new Dictionary<int, (List<byte> Data, int Stride)>();
        void Open()
        {
            vs = new List<Vector3>(v);
            if (arrays[(int)Mesh.ArrayType.Color].VariantType != Variant.Type.Nil) colours = new List<Color>(arrays[(int)Mesh.ArrayType.Color].AsColorArray());
            if (arrays[(int)Mesh.ArrayType.Normal].VariantType != Variant.Type.Nil) normals = new List<Vector3>(arrays[(int)Mesh.ArrayType.Normal].AsVector3Array());
            if (arrays[(int)Mesh.ArrayType.TexUV].VariantType != Variant.Type.Nil) uv = new List<Vector2>(arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array());
            if (arrays[(int)Mesh.ArrayType.TexUV2].VariantType != Variant.Type.Nil) uv2 = new List<Vector2>(arrays[(int)Mesh.ArrayType.TexUV2].AsVector2Array());
            // (the tangents and the custom channels: their values per vertex, carried with the weights; bytes stay bytes)
            foreach (var t in new[] { Mesh.ArrayType.Tangent, Mesh.ArrayType.Custom0, Mesh.ArrayType.Custom1, Mesh.ArrayType.Custom2, Mesh.ArrayType.Custom3 })
            {
                var a = arrays[(int)t];
                if (a.VariantType == Variant.Type.PackedFloat32Array) { var f = a.AsFloat32Array(); floats[(int)t] = (new List<float>(f), f.Length / v.Length); }
                else if (a.VariantType == Variant.Type.PackedByteArray) { var b = a.AsByteArray(); bytes[(int)t] = (new List<byte>(b), b.Length / v.Length); }
            }
        }
        var kept = new List<int>(index.Length);
        int cut = 0;
        for (int t = 0; t + 2 < index.Length; t += 3)
        {
            int i0 = index[t], i1 = index[t + 1], i2 = index[t + 2];
            Vector3 w0 = xf * v[i0], w1 = xf * v[i1], w2 = xf * v[i2];
            var near = grid.Near(w0, w1, w2, top);
            var pieces = near == null ? null : Outside(new[] { new Corner(w0, 1, 0, 0), new Corner(w1, 0, 1, 0), new Corner(w2, 0, 0, 1) }, near);
            if (pieces == null) { kept.Add(i0); kept.Add(i1); kept.Add(i2); continue; }
            if (vs == null) Open();
            cut++;
            // (a piece keeps its corners' order, so it turns as the triangle did)
            foreach (var piece in pieces)
                foreach (var k in piece)
                {
                    kept.Add(vs!.Count);
                    vs.Add(v[i0] * k.A + v[i1] * k.B + v[i2] * k.C);
                    normals?.Add((normals[i0] * k.A + normals[i1] * k.B + normals[i2] * k.C).Normalized());
                    colours?.Add(colours[i0] * k.A + colours[i1] * k.B + colours[i2] * k.C);
                    uv?.Add(uv[i0] * k.A + uv[i1] * k.B + uv[i2] * k.C);
                    uv2?.Add(uv2[i0] * k.A + uv2[i1] * k.B + uv2[i2] * k.C);
                    foreach (var (data, stride) in floats.Values)
                        for (int j = 0; j < stride; j++) data.Add(data[i0 * stride + j] * k.A + data[i1 * stride + j] * k.B + data[i2 * stride + j] * k.C);
                    foreach (var (data, stride) in bytes.Values)
                        for (int j = 0; j < stride; j++) data.Add((byte)Math.Clamp(Math.Round(data[i0 * stride + j] * k.A + data[i1 * stride + j] * k.B + data[i2 * stride + j] * k.C), 0, 255));
                }
        }
        if (cut == 0) return 0;
        if (kept.Count == 0) { kept.Add(0); kept.Add(0); kept.Add(0); }
        arrays[(int)Mesh.ArrayType.Vertex] = vs!.ToArray();
        if (normals != null) arrays[(int)Mesh.ArrayType.Normal] = normals.ToArray();
        if (colours != null) arrays[(int)Mesh.ArrayType.Color] = colours.ToArray();
        if (uv != null) arrays[(int)Mesh.ArrayType.TexUV] = uv.ToArray();
        if (uv2 != null) arrays[(int)Mesh.ArrayType.TexUV2] = uv2.ToArray();
        foreach (var (t, (data, _)) in floats) arrays[t] = data.ToArray();
        foreach (var (t, (data, _)) in bytes) arrays[t] = data.ToArray();
        arrays[(int)Mesh.ArrayType.Index] = kept.ToArray();
        return cut;
    }

    private static Transform3D WorldOf(Node3D node)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
        return xf;
    }
}
