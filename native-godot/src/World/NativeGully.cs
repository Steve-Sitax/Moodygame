using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// A street gully sunk into the paving (#226: "the gully sunk with stones sloping to it"). The street kit's gully (its
/// cast-iron grate over the gully pot, recovered/street-props-20261015 gutter-grate: one model everywhere) sat on the
/// setts with the street's ground running on under it. Here:
/// - the street's ground is cut away (drawn and solid stand-in) over a square round the grate;
/// - the same ground is laid again in that square, finer (8 cm cells), each corner taking the ground's own picture,
///   relief, colour and custom channels where it stood (the cut ground's triangle and weights: no seam, no new kind),
///   and lowered toward the grate: 40 mm at the grate's frame, rising over 0.8 m to the street's level as the square
///   of a gully is laid (steepest by the grate, so the water runs to it);
/// - the grate sits at the bottom of the dish, a hair proud of the setts round it; the ground no longer runs under its
///   bars, so the gully pot shows through them;
/// - collision: the dish's own triangles and the grate's top, so a foot follows the stones down.
/// </summary>
public static class NativeGully
{
    public const float Dip = 0.04f, Reach = 0.8f;
    /// <summary>The kit grate's half sizes (its frame: 0.53 by 0.45 m).</summary>
    public const float HalfU = 0.265f, HalfV = 0.225f;
    private const float Step = 0.08f, Top = 0.05f;

    private sealed class Source
    {
        public MeshInstance3D Mesh = null!;
        public int Surface;
        public Godot.Collections.Array Arrays = null!;
        public Transform3D Xf;
        public Vector3[] V = Array.Empty<Vector3>();
        public int[] Index = Array.Empty<int>();
        public int Count;
        /// <summary>The triangles (their first index) that reach into the gully's square in plan, in mesh order.</summary>
        public int[] Near = Array.Empty<int>();
        public long Format;
        // (each attribute converted from the surface's arrays once: a conversion copies the whole array)
        private readonly Dictionary<Mesh.ArrayType, object?> converted = new();
        public T? Get<T>(Mesh.ArrayType type, Variant.Type kind, Func<Variant, T> convert) where T : class
        {
            if (converted.TryGetValue(type, out var known)) return (T?)known;
            var value = Arrays[(int)type];
            var result = value.VariantType == kind ? convert(value) : null;
            converted[type] = result;
            return result;
        }
        public Variant.Type KindOf(Mesh.ArrayType type) => Arrays[(int)type].VariantType;
        public Material? Material;
    }

    private sealed class Out
    {
        public readonly List<Vector3> V = new(), N = new();
        public readonly List<Color> C = new();
        public readonly List<Vector2> Uv = new(), Uv2 = new();
        public readonly Dictionary<int, List<float>> F = new();
        public readonly Dictionary<int, List<byte>> B = new();
        public readonly List<int> I = new();
    }

    /// <summary>
    /// Sinks the gully at <paramref name="at"/> (turned by <paramref name="yawDeg"/>): the dish laid under
    /// <paramref name="holder"/>, the ground cut. Returns the street's level at the grate's middle before the sink (null
    /// when no ground was found: then nothing is changed) and the dish's triangles.
    /// </summary>
    public static (float? Level, int Triangles) Sink(Node3D town, Node3D holder, string id, Vector2 at, float yawDeg)
    {
        float yaw = Mathf.DegToRad(yawDeg), cs = MathF.Cos(yaw), sn = MathF.Sin(yaw);
        // (an object turned by yaw: its x runs (cos, -sin) in plan, its z (sin, cos))
        Vector2 W(float u, float v) => at + new Vector2(u * cs + v * sn, -u * sn + v * cs);
        float hu = HalfU + Reach, hv = HalfV + Reach;
        var square = new[] { W(-hu, -hv), W(hu, -hv), W(hu, hv), W(-hu, hv) };
        var box = new Rect2(square[0], Vector2.Zero); foreach (var p in square) box = box.Expand(p);
        box = box.Grow(0.2f);
        // the ground's drawn triangles round the square
        var sources = new List<Source>();
        foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh && m.Name.ToString().StartsWith("ground_", StringComparison.Ordinal)))
        {
            var xf = WorldOf(mesh);
            var aabb = xf * mesh.GetAabb();
            if (!box.Intersects(new Rect2(aabb.Position.X, aabb.Position.Z, aabb.Size.X, aabb.Size.Z))) continue;
            var am = (ArrayMesh)mesh.Mesh;
            for (int s = 0; s < am.GetSurfaceCount(); s++)
            {
                if (am.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles) continue;
                var arrays = am.SurfaceGetArrays(s);
                if (arrays[(int)Mesh.ArrayType.Bones].VariantType != Variant.Type.Nil) continue;
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var ix = arrays[(int)Mesh.ArrayType.Index];
                var index = ix.VariantType == Variant.Type.PackedInt32Array && ix.AsInt32Array().Length > 0 ? ix.AsInt32Array() : Enumerable.Range(0, v.Length).ToArray();
                sources.Add(new Source { Mesh = mesh, Surface = s, Arrays = arrays, Xf = xf, V = v.Select(q => xf * q).ToArray(), Count = v.Length, Index = index, Format = (long)am.SurfaceGetFormat(s), Material = mesh.GetActiveMaterial(s) });
            }
        }
        // (only the triangles reaching into the square can lie under a point in it: kept in their order, so ties go as before)
        foreach (var src in sources)
        {
            var near = new List<int>();
            for (int t = 0; t + 2 < src.Index.Length; t += 3)
            {
                Vector3 a = src.V[src.Index[t]], b = src.V[src.Index[t + 1]], c = src.V[src.Index[t + 2]];
                if (Math.Max(a.X, Math.Max(b.X, c.X)) + 1e-3f < box.Position.X || Math.Min(a.X, Math.Min(b.X, c.X)) - 1e-3f > box.End.X
                    || Math.Max(a.Z, Math.Max(b.Z, c.Z)) + 1e-3f < box.Position.Y || Math.Min(a.Z, Math.Min(b.Z, c.Z)) - 1e-3f > box.End.Y) continue;
                near.Add(t);
            }
            src.Near = near.ToArray();
        }
        // the triangle under a point (the highest drawn one under the top) and its corners' weights
        (Source S, int T, float A, float B, float C, float Y)? Under(Vector2 p)
        {
            (Source, int, float, float, float, float)? best = null;
            // (a point outside the square: every triangle, as before)
            bool inside = box.HasPoint(p);
            foreach (var src in sources)
                for (int k = 0, n = inside ? src.Near.Length : src.Index.Length / 3; k < n; k++)
                {
                    int t = inside ? src.Near[k] : k * 3;
                    if (t + 2 >= src.Index.Length) continue;
                    Vector3 a = src.V[src.Index[t]], b = src.V[src.Index[t + 1]], c = src.V[src.Index[t + 2]];
                    if (a.Y > Top || b.Y > Top || c.Y > Top) continue;
                    if (p.X < Math.Min(a.X, Math.Min(b.X, c.X)) - 1e-4f || p.X > Math.Max(a.X, Math.Max(b.X, c.X)) + 1e-4f || p.Y < Math.Min(a.Z, Math.Min(b.Z, c.Z)) - 1e-4f || p.Y > Math.Max(a.Z, Math.Max(b.Z, c.Z)) + 1e-4f) continue;
                    float d = (b.Z - c.Z) * (a.X - c.X) + (c.X - b.X) * (a.Z - c.Z);
                    if (Math.Abs(d) < 1e-9f) continue;
                    float wa = ((b.Z - c.Z) * (p.X - c.X) + (c.X - b.X) * (p.Y - c.Z)) / d, wb = ((c.Z - a.Z) * (p.X - c.X) + (a.X - c.X) * (p.Y - c.Z)) / d, wc = 1 - wa - wb;
                    if (wa < -1e-4f || wb < -1e-4f || wc < -1e-4f) continue;
                    float y = a.Y * wa + b.Y * wb + c.Y * wc;
                    if (best == null || y > best.Value.Item6) best = (src, t, wa, wb, wc, y);
                }
            return best;
        }
        var middle = Under(at);
        if (middle == null) { GD.Print($"gully {id}: no street ground under it"); return (null, 0); }
        // the grid's lines: from the square's edge to the grate's frame, and across the frame
        static float[] Lines(float half, float outer)
        {
            int n = (int)MathF.Round((outer - half) / Step);
            var list = new List<float>();
            for (int i = 0; i <= n; i++) list.Add(-outer + (outer - half) * i / n);
            int m = (int)MathF.Max(2, MathF.Round(2 * half / Step));
            for (int i = 1; i < m; i++) list.Add(-half + 2 * half * i / m);
            for (int i = 0; i <= n; i++) list.Add(half + (outer - half) * i / n);
            return list.ToArray();
        }
        float[] us = Lines(HalfU, hu), vs = Lines(HalfV, hv);
        // the dish: 40 mm at the frame, steepest there, up to the street's level 0.8 m off (rounded at the corners)
        static float Depth(float u, float v)
        {
            float du = Math.Max(Math.Abs(u) - HalfU, 0), dv = Math.Max(Math.Abs(v) - HalfV, 0);
            float t = Math.Clamp(MathF.Sqrt(du * du + dv * dv) / Reach, 0, 1);
            return Dip * (1 - t) * (1 - t);
        }
        static (float, float) Slope(float u, float v)
        {
            const float e = 0.005f;
            return ((Depth(u + e, v) - Depth(u - e, v)) / (2 * e), (Depth(u, v + e) - Depth(u, v - e)) / (2 * e));
        }
        // each corner sampled once a surface (a corner's own triangle gives its values; the cell takes the surface under
        // its middle)
        var outs = new Dictionary<Source, Out>();
        var corner = new Dictionary<(Source, int, int), int>();
        int Corner(Source src, int i, int j)
        {
            if (corner.TryGetValue((src, i, j), out int k)) return k;
            var o = outs[src];
            var p = W(us[i], vs[j]);
            var hit = Under(p);
            // (a corner of the cell whose surface is not the one under it: that surface's nearest triangle, the weights clamped)
            if (hit == null || hit.Value.S != src) hit = Nearest(src, p);
            var (s, t, wa, wb, wc, y) = hit!.Value;
            int i0 = s.Index[t], i1 = s.Index[t + 1], i2 = s.Index[t + 2];
            float d = Depth(us[i], vs[j]);
            var (gu, gv) = Slope(us[i], vs[j]);
            // (the slope in plan: d grows toward the grate; the surface's height is the ground's less d)
            var gx = gu * cs + gv * sn; var gz = -gu * sn + gv * cs;
            o.V.Add(new Vector3(p.X, y - d, p.Y));
            if (s.KindOf(Mesh.ArrayType.Normal) != Variant.Type.Nil)
            {
                var n = s.Get(Mesh.ArrayType.Normal, s.KindOf(Mesh.ArrayType.Normal), v => v.AsVector3Array())!;
                var nw = (s.Xf.Basis * (n[i0] * wa + n[i1] * wb + n[i2] * wc)).Normalized();
                o.N.Add((nw + new Vector3(gx, 0, gz)).Normalized());
            }
            if (s.KindOf(Mesh.ArrayType.Color) != Variant.Type.Nil) { var c = s.Get(Mesh.ArrayType.Color, s.KindOf(Mesh.ArrayType.Color), v => v.AsColorArray())!; o.C.Add(c[i0] * wa + c[i1] * wb + c[i2] * wc); }
            if (s.KindOf(Mesh.ArrayType.TexUV) != Variant.Type.Nil) { var a = s.Get(Mesh.ArrayType.TexUV, s.KindOf(Mesh.ArrayType.TexUV), v => v.AsVector2Array())!; o.Uv.Add(a[i0] * wa + a[i1] * wb + a[i2] * wc); }
            if (s.KindOf(Mesh.ArrayType.TexUV2) != Variant.Type.Nil) { var a = s.Get(Mesh.ArrayType.TexUV2, s.KindOf(Mesh.ArrayType.TexUV2), v => v.AsVector2Array())!; o.Uv2.Add(a[i0] * wa + a[i1] * wb + a[i2] * wc); }
            // (the vertex count: the surface's own vertices, as converted when the source was read)
            int count = s.Count;
            foreach (var type in new[] { Mesh.ArrayType.Tangent, Mesh.ArrayType.Custom0, Mesh.ArrayType.Custom1, Mesh.ArrayType.Custom2, Mesh.ArrayType.Custom3 })
            {
                var kind = s.KindOf(type);
                if (kind == Variant.Type.PackedFloat32Array)
                {
                    var f = s.Get(type, kind, v => v.AsFloat32Array())!; int stride = f.Length / count;
                    if (!o.F.TryGetValue((int)type, out var list)) o.F[(int)type] = list = new List<float>();
                    for (int q = 0; q < stride; q++) list.Add(f[i0 * stride + q] * wa + f[i1 * stride + q] * wb + f[i2 * stride + q] * wc);
                    if (type == Mesh.ArrayType.Tangent && stride == 4)
                    {
                        // (the tangent turned as the mesh is, its sign kept)
                        var tw = (s.Xf.Basis * new Vector3(list[^4], list[^3], list[^2])).Normalized();
                        list[^4] = tw.X; list[^3] = tw.Y; list[^2] = tw.Z;
                    }
                }
                else if (kind == Variant.Type.PackedByteArray)
                {
                    var b = s.Get(type, kind, v => v.AsByteArray())!; int stride = b.Length / count;
                    if (!o.B.TryGetValue((int)type, out var list)) o.B[(int)type] = list = new List<byte>();
                    for (int q = 0; q < stride; q++) list.Add((byte)Math.Clamp(Math.Round(b[i0 * stride + q] * wa + b[i1 * stride + q] * wb + b[i2 * stride + q] * wc), 0, 255));
                }
            }
            k = o.V.Count - 1;
            corner[(src, i, j)] = k;
            return k;
        }
        (Source S, int T, float A, float B, float C, float Y)? Nearest(Source src, Vector2 p)
        {
            (Source, int, float, float, float, float)? best = null; float bestD = float.MaxValue;
            for (int t = 0; t + 2 < src.Index.Length; t += 3)
            {
                Vector3 a = src.V[src.Index[t]], b = src.V[src.Index[t + 1]], c = src.V[src.Index[t + 2]];
                if (a.Y > Top || b.Y > Top || c.Y > Top) continue;
                var m = (a + b + c) / 3; float dd = new Vector2(m.X - p.X, m.Z - p.Y).LengthSquared();
                if (dd > bestD) continue;
                float d = (b.Z - c.Z) * (a.X - c.X) + (c.X - b.X) * (a.Z - c.Z);
                if (Math.Abs(d) < 1e-9f) continue;
                float wa = ((b.Z - c.Z) * (p.X - c.X) + (c.X - b.X) * (p.Y - c.Z)) / d, wb = ((c.Z - a.Z) * (p.X - c.X) + (a.X - c.X) * (p.Y - c.Z)) / d;
                wa = Math.Clamp(wa, 0, 1); wb = Math.Clamp(wb, 0, 1 - wa); float wc = 1 - wa - wb;
                bestD = dd; best = (src, t, wa, wb, wc, a.Y * wa + b.Y * wb + c.Y * wc);
            }
            return best;
        }
        // the ground's up side: which way its triangles turn in plan
        bool clockwise;
        {
            var (s0, t0, _, _, _, _) = middle.Value;
            Vector3 a = s0.V[s0.Index[t0]], b = s0.V[s0.Index[t0 + 1]], c = s0.V[s0.Index[t0 + 2]];
            clockwise = (b - a).Cross(c - a).Y < 0;
        }
        int tris = 0;
        var collision = new List<Vector3>();
        for (int i = 0; i + 1 < us.Length; i++)
            for (int j = 0; j + 1 < vs.Length; j++)
            {
                float mu = (us[i] + us[i + 1]) / 2, mv = (vs[j] + vs[j + 1]) / 2;
                if (Math.Abs(mu) < HalfU && Math.Abs(mv) < HalfV) continue;
                var under = Under(W(mu, mv));
                if (under == null) continue;
                var src = under.Value.S;
                if (!outs.ContainsKey(src)) outs[src] = new Out();
                int a = Corner(src, i, j), b = Corner(src, i + 1, j), c = Corner(src, i + 1, j + 1), d = Corner(src, i, j + 1);
                var o = outs[src];
                void Tri(int x, int y, int z)
                {
                    bool cw = (o.V[y] - o.V[x]).Cross(o.V[z] - o.V[x]).Y < 0;
                    if (cw != clockwise) (y, z) = (z, y);
                    o.I.Add(x); o.I.Add(y); o.I.Add(z);
                    collision.Add(o.V[x]); collision.Add(o.V[y]); collision.Add(o.V[z]);
                    tris++;
                }
                // (each cell split on the diagonal that follows the dish)
                Tri(a, b, c); Tri(a, c, d);
            }
        // the dish laid: one surface a ground surface, its material and channels
        var dish = new ArrayMesh { ResourceName = "gully_dish_" + id };
        foreach (var (src, o) in outs)
        {
            var arr = new Godot.Collections.Array(); arr.Resize((int)Mesh.ArrayType.Max);
            arr[(int)Mesh.ArrayType.Vertex] = o.V.ToArray();
            if (o.N.Count == o.V.Count) arr[(int)Mesh.ArrayType.Normal] = o.N.ToArray();
            if (o.C.Count == o.V.Count) arr[(int)Mesh.ArrayType.Color] = o.C.ToArray();
            if (o.Uv.Count == o.V.Count) arr[(int)Mesh.ArrayType.TexUV] = o.Uv.ToArray();
            if (o.Uv2.Count == o.V.Count) arr[(int)Mesh.ArrayType.TexUV2] = o.Uv2.ToArray();
            foreach (var (t, list) in o.F) arr[t] = list.ToArray();
            foreach (var (t, list) in o.B) arr[t] = list.ToArray();
            arr[(int)Mesh.ArrayType.Index] = o.I.ToArray();
            // (the source's channel formats; positions laid in the world, uncompressed)
            long format = src.Format & ~(long)Mesh.ArrayFormat.FlagCompressAttributes;
            dish.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arr, null, null, (Mesh.ArrayFormat)format);
            dish.SurfaceSetMaterial(dish.GetSurfaceCount() - 1, src.Material);
        }
        var node = new MeshInstance3D { Name = "gully_dish_" + id.Replace('-', '_'), Mesh = dish };
        node.SetMeta(NativeSquareDressing.Meta, true);
        holder.AddChild(node);
        // the ground cut over the square (its drawn triangles and its solid stand-in)
        var (drawn, standIn) = NativePlanCut.Cut(town, new[] { square }, Top, m => m.Name.ToString().StartsWith("ground_", StringComparison.Ordinal), null, true);
        // collision: the dish and the grate's top
        float level = middle.Value.Y;
        var body = new StaticBody3D { Name = "gully_solid_" + id.Replace('-', '_'), CollisionLayer = Solid.Layer, CollisionMask = 0 };
        body.SetMeta(NativeSquareDressing.Meta, true);
        body.AddChild(new CollisionShape3D { Name = "Dish", Shape = new ConcavePolygonShape3D { Data = collision.ToArray(), BackfaceCollision = true } });
        body.AddChild(new CollisionShape3D { Name = "Grate", Shape = new BoxShape3D { Size = new Vector3(2 * HalfU, 0.06f, 2 * HalfV) }, Position = new Vector3(at.X, level - Dip - 0.03f, at.Y), Rotation = new Vector3(0, yaw, 0) });
        holder.AddChild(body);
        GD.Print($"gully {id}: sunk {Dip * 1000:0} mm, the dish {tris} triangles in {outs.Count} surfaces, the ground cut {drawn} drawn and {standIn} stand-in triangles");
        return (level, tris);
    }

    private static Transform3D WorldOf(Node3D node)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
        return xf;
    }
}
