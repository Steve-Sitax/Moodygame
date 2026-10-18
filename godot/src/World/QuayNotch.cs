using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// Cuts a flight's footprint out of a baked ground mesh (issue 68). The Werf's ground chunk (city/city_-4_0_3) has a kerb
/// and an apron that hang 0.7 to 1.0 m out over the water beyond the quay wall and its edge stones. Every other quay stops at
/// the wall line, where the stone flights start, so there the flat strip lay over the flight's inner treads: the walk stood on
/// it, a body on the treads overlapped it, and the treads were hidden under it. The triangles are clipped against the
/// footprint (a box in the flight's own frame: s down the flight, u out from the wall line), so the visible stone and the
/// collision built from it agree with the steps. Everything outside the box is as it was.
/// </summary>
public static class QuayNotch
{
    /// <summary>Clip the named mesh of the world at the box; returns the triangles that were cut or dropped (0: nothing to do).</summary>
    public static int Cut(Node3D world, string meshName, QuayExits.Frame f, float s0, float s1, float u0, float u1)
    {
        int changed = 0;
        foreach (var node in BakedWorld.All(world))
        {
            if (node is not MeshInstance3D { Mesh: ArrayMesh mesh } mi || mi.Name.ToString() != meshName) continue;
            var xf = Transform3D.Identity;
            for (Node? n = mi; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
            var cut = new ArrayMesh { ResourceName = mesh.ResourceName };
            // (its metadata too: Solid's stand-in faces and skipped surfaces live there, issues #157 #163)
            foreach (var key in mesh.GetMetaList()) cut.SetMeta(key, mesh.GetMeta(key));
            int here = 0;
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                var arrays = mesh.SurfaceGetArrays(s);
                int done = mesh.SurfaceGetPrimitiveType(s) == Mesh.PrimitiveType.Triangles ? CutSurface(arrays, xf, f, s0, s1, u0, u1) : 0;
                here += done;
                cut.AddSurfaceFromArrays(mesh.SurfaceGetPrimitiveType(s), arrays, null, null, mesh.SurfaceGetFormat(s));
                cut.SurfaceSetMaterial(s, mesh.SurfaceGetMaterial(s));
            }
            if (here == 0) continue;
            mi.Mesh = cut;
            changed += here;
        }
        return changed;
    }

    /// <summary>
    /// Cut a convex opening through a wall of the world (a Ruien gate in a quay wall, docs/ruien-native.md): in the named
    /// meshes, every face that stands across the wall (facing out or in, not a floor) and lies within the wall's thickness
    /// (from `n0` to `n1` metres into the wall from its face, against `outward`) loses the part inside `opening`, given as (along
    /// the face from `origin`, height) points. Returns the triangles cut or dropped. Collision and navigation made from
    /// the meshes afterwards follow.
    /// </summary>
    public static int CutConvex(Node3D world, ICollection<string> meshNames, Vector2 origin, Vector2 outward, Vector2[] opening, float n0, float n1)
    {
        int changed = 0;
        var poly = opening.ToList();
        float area2 = 0;
        for (int i = 0; i < poly.Count; i++) area2 += poly[i].X * poly[(i + 1) % poly.Count].Y - poly[(i + 1) % poly.Count].X * poly[i].Y;
        if (area2 < 0) poly.Reverse();
        var along = new Vector2(-outward.Y, outward.X);
        float smin = poly.Min(p => p.X), smax = poly.Max(p => p.X), ymin = poly.Min(p => p.Y), ymax = poly.Max(p => p.Y);
        foreach (var node in BakedWorld.All(world))
        {
            if (node is not MeshInstance3D { Mesh: ArrayMesh mesh } mi || !meshNames.Contains(mi.Name.ToString())) continue;
            var xf = Transform3D.Identity;
            for (Node? n = mi; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
            var cut = new ArrayMesh { ResourceName = mesh.ResourceName };
            foreach (var key in mesh.GetMetaList()) cut.SetMeta(key, mesh.GetMeta(key));
            int here = 0;
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                var arrays = mesh.SurfaceGetArrays(s);
                if (mesh.SurfaceGetPrimitiveType(s) == Mesh.PrimitiveType.Triangles)
                {
                    float S(Vector3 w) => (w.X - origin.X) * along.X + (w.Z - origin.Y) * along.Y;
                    float N(Vector3 w) => -((w.X - origin.X) * outward.X + (w.Z - origin.Y) * outward.Y);
                    here += CutSurfaceWith(arrays, xf, tri =>
                    {
                        var (a, b, c) = tri;
                        float na = N(a), nb = N(b), nc = N(c);
                        if (Math.Min(na, Math.Min(nb, nc)) < n0 || Math.Max(na, Math.Max(nb, nc)) > n1) return false;
                        var fn = (b - a).Cross(c - a);
                        if (fn.LengthSquared() < 1e-12f || MathF.Abs(fn.Normalized().Dot(new Vector3(outward.X, 0, outward.Y))) < 0.35f) return false;
                        float s0 = Math.Min(S(a), Math.Min(S(b), S(c))), s1 = Math.Max(S(a), Math.Max(S(b), S(c)));
                        float y0 = Math.Min(a.Y, Math.Min(b.Y, c.Y)), y1 = Math.Max(a.Y, Math.Max(b.Y, c.Y));
                        return s1 > smin && s0 < smax && y1 > ymin && y0 < ymax;
                    }, poly.Select((p, i) => (p, poly[(i + 1) % poly.Count])).Select(e => (Func<Vector3, float>)(w =>
                    {
                        var q = new Vector2(S(w), w.Y);
                        var d = e.Item2 - e.Item1;
                        return d.X * (q.Y - e.Item1.Y) - d.Y * (q.X - e.Item1.X);
                    })).ToList());
                }
                cut.AddSurfaceFromArrays(mesh.SurfaceGetPrimitiveType(s), arrays, null, null, mesh.SurfaceGetFormat(s));
                cut.SurfaceSetMaterial(s, mesh.SurfaceGetMaterial(s));
            }
            if (here == 0) continue;
            mi.Mesh = cut;
            changed += here;
        }
        return changed;
    }

    /// <summary>
    /// Cut a hole through the street (a Ruien grate's shaft, a hatch over a stair, docs/ruien-native.md): every level face
    /// between y0 and y1 of every mesh whose box reaches the rectangle (x, z) loses the part inside it. Returns the
    /// triangles cut or dropped.
    /// </summary>
    public static int CutFloor(Node3D world, Rect2 hole, float y0, float y1)
    {
        int changed = 0;
        var box = new Aabb(new Vector3(hole.Position.X, y0, hole.Position.Y), new Vector3(hole.Size.X, y1 - y0, hole.Size.Y));
        var edges = new List<Func<Vector3, float>>
        {
            w => w.X - hole.Position.X, w => hole.End.X - w.X, w => w.Z - hole.Position.Y, w => hole.End.Y - w.Z,
        };
        foreach (var node in BakedWorld.All(world))
        {
            if (node is not MeshInstance3D { Mesh: ArrayMesh mesh } mi) continue;
            var xf = Transform3D.Identity;
            for (Node? n = mi; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
            if (!(xf * mesh.GetAabb()).Intersects(box)) continue;
            var cut = new ArrayMesh { ResourceName = mesh.ResourceName };
            foreach (var key in mesh.GetMetaList()) cut.SetMeta(key, mesh.GetMeta(key));
            int here = 0;
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                var arrays = mesh.SurfaceGetArrays(s);
                if (mesh.SurfaceGetPrimitiveType(s) == Mesh.PrimitiveType.Triangles)
                    here += CutSurfaceWith(arrays, xf, tri =>
                    {
                        var (a, b, c) = tri;
                        if (Math.Min(a.Y, Math.Min(b.Y, c.Y)) < y0 || Math.Max(a.Y, Math.Max(b.Y, c.Y)) > y1) return false;
                        var fn = (b - a).Cross(c - a);
                        if (fn.LengthSquared() < 1e-12f || MathF.Abs(fn.Normalized().Y) < 0.7f) return false;
                        return Math.Max(a.X, Math.Max(b.X, c.X)) > hole.Position.X && Math.Min(a.X, Math.Min(b.X, c.X)) < hole.End.X
                            && Math.Max(a.Z, Math.Max(b.Z, c.Z)) > hole.Position.Y && Math.Min(a.Z, Math.Min(b.Z, c.Z)) < hole.End.Y;
                    }, edges);
                cut.AddSurfaceFromArrays(mesh.SurfaceGetPrimitiveType(s), arrays, null, null, mesh.SurfaceGetFormat(s));
                cut.SurfaceSetMaterial(s, mesh.SurfaceGetMaterial(s));
            }
            if (here == 0) continue;
            mi.Mesh = cut;
            changed += here;
        }
        return changed;
    }

    /// <summary>
    /// The triangles `consider` picks lose their part inside every `inside` (a convex region: key >= 0 inside each); the
    /// rest of each is kept, new corners mixed in proportion. The arrays are changed in place; the triangles cut.
    /// </summary>
    private static int CutSurfaceWith(Godot.Collections.Array arrays, Transform3D xf, Func<(Vector3, Vector3, Vector3), bool> consider, List<Func<Vector3, float>> inside)
    {
        var positions = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var indexV = arrays[(int)Mesh.ArrayType.Index];
        var index = indexV.VariantType == Variant.Type.Nil ? Enumerable.Range(0, positions.Length).ToArray() : indexV.AsInt32Array();
        if (positions.Length == 0 || index.Length < 3) return 0;
        int count = positions.Length;
        var channels = new List<Channel>();
        for (int k = 0; k < (int)Mesh.ArrayType.Index; k++)
        {
            var v = arrays[k];
            if (v.VariantType == Variant.Type.Nil) continue;
            var c = new Channel { Index = k, Kind = v.VariantType };
            switch (v.VariantType)
            {
                case Variant.Type.PackedVector3Array: c.Stride = 3; c.Data = v.AsVector3Array().SelectMany(p => new[] { p.X, p.Y, p.Z }).ToArray(); break;
                case Variant.Type.PackedVector2Array: c.Stride = 2; c.Data = v.AsVector2Array().SelectMany(p => new[] { p.X, p.Y }).ToArray(); break;
                case Variant.Type.PackedColorArray: c.Stride = 4; c.Data = v.AsColorArray().SelectMany(p => new[] { p.R, p.G, p.B, p.A }).ToArray(); break;
                case Variant.Type.PackedFloat32Array:
                    c.Data = v.AsFloat32Array();
                    c.Stride = c.Data.Length / count;
                    if (c.Stride * count != c.Data.Length) return 0;
                    break;
                default: return 0;
            }
            channels.Add(c);
        }
        int rowLength = channels.Sum(c => c.Stride);
        float[] Row(int vertex)
        {
            var row = new float[rowLength];
            int at = 0;
            foreach (var c in channels) { Array.Copy(c.Data, vertex * c.Stride, row, at, c.Stride); at += c.Stride; }
            return row;
        }
        Vector3 W(float[] r) => xf * new Vector3(r[0], r[1], r[2]);
        var kept = new List<int>(index.Length);
        var made = new List<float[]>();
        var fresh = new List<int>();
        int cutTriangles = 0;
        for (int t = 0; t + 2 < index.Length; t += 3)
        {
            var tri = new List<float[]> { Row(index[t]), Row(index[t + 1]), Row(index[t + 2]) };
            if (!consider((W(tri[0]), W(tri[1]), W(tri[2]))))
            {
                kept.Add(index[t]); kept.Add(index[t + 1]); kept.Add(index[t + 2]);
                continue;
            }
            // nothing of it inside one of the half planes: kept as it is
            if (inside.Any(f => tri.All(r => f(W(r)) <= 0)))
            {
                kept.Add(index[t]); kept.Add(index[t + 1]); kept.Add(index[t + 2]);
                continue;
            }
            cutTriangles++;
            var rest = tri;
            foreach (var f in inside)
            {
                float Key(float[] r) => f(W(r));
                var outside = Clip(rest, Key, 0, false);
                rest = Clip(rest, Key, 0, true);
                for (int i = 1; i + 1 < outside.Count; i++)
                {
                    if (Area(outside[0], outside[i], outside[i + 1]) < 1e-9f) continue;
                    foreach (var p in new[] { outside[0], outside[i], outside[i + 1] }) { fresh.Add(count + made.Count); made.Add(p); }
                }
                if (rest.Count < 3) break;
            }
        }
        if (cutTriangles == 0) return 0;
        foreach (var row in made)
        {
            int at = 0;
            foreach (var c in channels) { for (int i = 0; i < c.Stride; i++) c.Added.Add(row[at + i]); at += c.Stride; }
        }
        foreach (var c in channels)
        {
            var all = c.Data.Concat(c.Added).ToArray();
            switch (c.Kind)
            {
                case Variant.Type.PackedVector3Array:
                    var v3 = new Vector3[all.Length / 3];
                    for (int i = 0; i < v3.Length; i++) v3[i] = new Vector3(all[i * 3], all[i * 3 + 1], all[i * 3 + 2]);
                    if (c.Index == (int)Mesh.ArrayType.Normal) for (int i = count; i < v3.Length; i++) v3[i] = v3[i].LengthSquared() > 1e-12f ? v3[i].Normalized() : v3[i];
                    arrays[c.Index] = v3;
                    break;
                case Variant.Type.PackedVector2Array:
                    var v2 = new Vector2[all.Length / 2];
                    for (int i = 0; i < v2.Length; i++) v2[i] = new Vector2(all[i * 2], all[i * 2 + 1]);
                    arrays[c.Index] = v2;
                    break;
                case Variant.Type.PackedColorArray:
                    var cols = new Color[all.Length / 4];
                    for (int i = 0; i < cols.Length; i++) cols[i] = new Color(all[i * 4], all[i * 4 + 1], all[i * 4 + 2], all[i * 4 + 3]);
                    arrays[c.Index] = cols;
                    break;
                default: arrays[c.Index] = all; break;
            }
        }
        kept.AddRange(fresh);
        arrays[(int)Mesh.ArrayType.Index] = kept.ToArray();
        return cutTriangles;
    }

    // one channel of a vertex (position, normal, tangent, colour, the uvs, the customs), flattened: Stride floats a vertex
    private sealed class Channel
    {
        public int Index, Stride;
        public Variant.Type Kind;
        public float[] Data = Array.Empty<float>();
        public readonly List<float> Added = new();
    }

    // the height under which a triangle belongs to the ground the flight is cut into
    private const float Ground = 1.5f;

    private static int CutSurface(Godot.Collections.Array arrays, Transform3D xf, QuayExits.Frame f, float s0, float s1, float u0, float u1)
    {
        var positions = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var index = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        if (positions.Length == 0 || index.Length < 3) return 0;
        int count = positions.Length;
        var channels = new List<Channel>();
        for (int k = 0; k < (int)Mesh.ArrayType.Index; k++)
        {
            var v = arrays[k];
            if (v.VariantType == Variant.Type.Nil) continue;
            var c = new Channel { Index = k, Kind = v.VariantType };
            switch (v.VariantType)
            {
                case Variant.Type.PackedVector3Array:
                    c.Stride = 3;
                    c.Data = v.AsVector3Array().SelectMany(p => new[] { p.X, p.Y, p.Z }).ToArray();
                    break;
                case Variant.Type.PackedVector2Array:
                    c.Stride = 2;
                    c.Data = v.AsVector2Array().SelectMany(p => new[] { p.X, p.Y }).ToArray();
                    break;
                case Variant.Type.PackedColorArray:
                    c.Stride = 4;
                    c.Data = v.AsColorArray().SelectMany(p => new[] { p.R, p.G, p.B, p.A }).ToArray();
                    break;
                case Variant.Type.PackedFloat32Array:
                    c.Data = v.AsFloat32Array();
                    c.Stride = c.Data.Length / count;
                    if (c.Stride * count != c.Data.Length) return 0;
                    break;
                default:
                    return 0; // a channel that cannot be mixed: leave this surface alone
            }
            channels.Add(c);
        }
        int rowLength = channels.Sum(c => c.Stride);
        float[] Row(int vertex)
        {
            var row = new float[rowLength];
            int at = 0;
            foreach (var c in channels)
            {
                Array.Copy(c.Data, vertex * c.Stride, row, at, c.Stride);
                at += c.Stride;
            }
            return row;
        }
        var origin = f.On(0, 0);
        float S(float[] row) => Along(xf * new Vector3(row[0], row[1], row[2]), origin, f.Tx, f.Tz);
        float U(float[] row) => Along(xf * new Vector3(row[0], row[1], row[2]), origin, f.Nx, f.Nz);

        var kept = new List<int>(index.Length);
        var made = new List<float[]>();
        var fresh = new List<int>();
        int cutTriangles = 0;
        for (int t = 0; t + 2 < index.Length; t += 3)
        {
            var tri = new List<float[]> { Row(index[t]), Row(index[t + 1]), Row(index[t + 2]) };
            var ss = tri.Select(S).ToArray();
            var uu = tri.Select(U).ToArray();
            // (the whole triangle outside the box, or above the ground (a gutter on the house over the flight, issue #163):
            // kept as it is)
            bool high = tri.All(r => (xf * new Vector3(r[0], r[1], r[2])).Y > Ground);
            if (high || ss.Max() <= s0 || ss.Min() >= s1 || uu.Max() <= u0 || uu.Min() >= u1)
            {
                kept.Add(index[t]); kept.Add(index[t + 1]); kept.Add(index[t + 2]);
                continue;
            }
            cutTriangles++;
            // the parts outside the box: beyond each of its four sides in turn, the rest carried on
            var rest = tri;
            foreach (var (key, bound, greater) in new (Func<float[], float>, float, bool)[] { (U, u0, false), (U, u1, true), (S, s0, false), (S, s1, true) })
            {
                var outside = Clip(rest, key, bound, greater);
                rest = Clip(rest, key, bound, !greater);
                for (int i = 1; i + 1 < outside.Count; i++)
                {
                    if (Area(outside[0], outside[i], outside[i + 1]) < 1e-9f) continue;
                    foreach (var p in new[] { outside[0], outside[i], outside[i + 1] })
                    {
                        fresh.Add(count + made.Count);
                        made.Add(p);
                    }
                }
            }
        }
        if (cutTriangles == 0) return 0;
        // the new vertices go on the end of every channel
        foreach (var row in made)
        {
            int at = 0;
            foreach (var c in channels)
            {
                for (int i = 0; i < c.Stride; i++) c.Added.Add(row[at + i]);
                at += c.Stride;
            }
        }
        foreach (var c in channels)
        {
            var all = c.Data.Concat(c.Added).ToArray();
            switch (c.Kind)
            {
                case Variant.Type.PackedVector3Array:
                    var v3 = new Vector3[all.Length / 3];
                    for (int i = 0; i < v3.Length; i++) v3[i] = new Vector3(all[i * 3], all[i * 3 + 1], all[i * 3 + 2]);
                    // (a normal stays a unit vector)
                    if (c.Index == (int)Mesh.ArrayType.Normal) for (int i = count; i < v3.Length; i++) v3[i] = v3[i].LengthSquared() > 1e-12f ? v3[i].Normalized() : v3[i];
                    arrays[c.Index] = v3;
                    break;
                case Variant.Type.PackedVector2Array:
                    var v2 = new Vector2[all.Length / 2];
                    for (int i = 0; i < v2.Length; i++) v2[i] = new Vector2(all[i * 2], all[i * 2 + 1]);
                    arrays[c.Index] = v2;
                    break;
                case Variant.Type.PackedColorArray:
                    var cols = new Color[all.Length / 4];
                    for (int i = 0; i < cols.Length; i++) cols[i] = new Color(all[i * 4], all[i * 4 + 1], all[i * 4 + 2], all[i * 4 + 3]);
                    arrays[c.Index] = cols;
                    break;
                default:
                    arrays[c.Index] = all;
                    break;
            }
        }
        kept.AddRange(fresh);
        arrays[(int)Mesh.ArrayType.Index] = kept.ToArray();
        return cutTriangles;
    }

    private static float Along(Vector3 p, (float x, float z) origin, float dx, float dz) => (p.X - origin.x) * dx + (p.Z - origin.z) * dz;

    /// <summary>The part of a convex polygon on one side of a bound (rows are mixed in proportion where an edge crosses it).</summary>
    private static List<float[]> Clip(List<float[]> poly, Func<float[], float> key, float bound, bool keepGreater)
    {
        var result = new List<float[]>();
        for (int i = 0; i < poly.Count; i++)
        {
            var a = poly[i];
            var b = poly[(i + 1) % poly.Count];
            float da = (key(a) - bound) * (keepGreater ? 1 : -1), db = (key(b) - bound) * (keepGreater ? 1 : -1);
            bool ina = da >= 0, inb = db >= 0;
            if (ina) result.Add(a);
            if (ina != inb)
            {
                float t = da / (da - db);
                var m = new float[a.Length];
                for (int k = 0; k < m.Length; k++) m[k] = a[k] + (b[k] - a[k]) * t;
                result.Add(m);
            }
        }
        return result;
    }

    private static float Area(float[] a, float[] b, float[] c)
    {
        var p = new Vector3(a[0], a[1], a[2]);
        return (new Vector3(b[0], b[1], b[2]) - p).Cross(new Vector3(c[0], c[1], c[2]) - p).Length() * 0.5f;
    }
}
