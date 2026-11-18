using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// A simpler solid for the physics than the drawn surface (docs/startup.md, "Collision proxies"): the same walls,
/// floors, steps and openings with far fewer triangles. The drawn bricks and bevels are a few millimetres of relief
/// in triangles a few centimetres wide; a body that walks or a ray that looks needs the surface, not each brick.
/// The proxy is the engine's own edge-collapse (its corners are corners of the original) to <see cref="Error"/>,
/// then checked both ways against the original: a proxy triangle that strays from the original is dropped, and every
/// original triangle left without a proxy near it comes back as it was (with its neighbours, so no gap opens at the
/// patch's rim). So no opening closes by more than <see cref="Stray"/> and no wall opens by more than
/// <see cref="Uncovered"/>, whatever the simplifier did.
/// </summary>
public static class CollisionProxy
{
    /// <summary>The edge-collapse's own error, metres.</summary>
    public const float Error = 0.01f;
    /// <summary>A proxy triangle not certified entirely within this distance of the original is dropped.</summary>
    public const float Stray = 0.025f;
    /// <summary>An original triangle not certified entirely within this distance of the proxy is kept as it was.</summary>
    public const float Uncovered = 0.02f;
    /// <summary>Below this many triangles a shape stays as it is: nothing to win.</summary>
    public const int Least = 3000;

    public readonly record struct Result(Vector3[] Faces, int Before, int Collapsed, int Dropped, int Restored)
    {
        public int After => Faces.Length / 3;
        public override string ToString() => $"{Before} -> {After} triangles (collapse {Collapsed}, strayed {Dropped}, restored {Restored})";
    }

    /// <summary>A solid shape of these triangles: their proxy (dev: --full-collision with --no-startup-cache keeps them all,
    /// for a before-and-after; a cached shape stays what it was when it was made).</summary>
    public static ConcavePolygonShape3D Shape(Vector3[] faces) =>
        new() { Data = Main.I?.Flag("full-collision") == true ? faces : Simplify(faces).Faces, BackfaceCollision = true };

    /// <summary>The proxy of a triangle soup (three corners a triangle). Any thread: no node, no server call.</summary>
    public static Result Simplify(Vector3[] faces, float error = Error, float stray = Stray, float uncovered = Uncovered)
    {
        int before = faces.Length / 3;
        if (before < Least) return new(faces, before, before, 0, 0);
        // one corner for all the triangles that meet there (the collapse works on the joined surface)
        var slot = new Dictionary<Vector3, int>(before);
        var verts = new List<Vector3>(before);
        var index = new int[before * 3];
        var box = new Aabb(faces[0], Vector3.Zero);
        for (int i = 0; i < index.Length; i++)
        {
            var p = faces[i] + Vector3.Zero; // (-0 and 0 are one corner)
            if (!slot.TryGetValue(p, out int at)) { slot[p] = at = verts.Count; verts.Add(p); box = box.Expand(p); }
            index[i] = at;
        }
        // a triangle with two corners in one place has no surface
        var solid = new List<int>(index.Length);
        for (int i = 0; i < index.Length; i += 3)
            if (index[i] != index[i + 1] && index[i + 1] != index[i + 2] && index[i] != index[i + 2]) { solid.Add(index[i]); solid.Add(index[i + 1]); solid.Add(index[i + 2]); }
        index = solid.ToArray();
        var v = verts.ToArray();
        float extent = Math.Max(box.Size.X, Math.Max(box.Size.Y, box.Size.Z));
        if (extent <= 0 || index.Length < 9) return new(faces, before, before, 0, 0);

        int[] lod;
        using (var arrays = new Godot.Collections.Array())
        using (var tool = new SurfaceTool())
        {
            arrays.Resize((int)Mesh.ArrayType.Max);
            arrays[(int)Mesh.ArrayType.Vertex] = v;
            arrays[(int)Mesh.ArrayType.Index] = index;
            tool.CreateFromArrays(arrays);
#pragma warning disable CS0618 // (the engine's plain edge-collapse: positions only, which is all a solid has)
            lod = tool.GenerateLod(error / extent);
#pragma warning restore CS0618
        }
        if (lod.Length < 3 || lod.Length >= index.Length) return new(faces, before, before, 0, 0);
        int collapsed = lod.Length / 3;

        // 1. proxy triangles that left the original surface (bridged a recess, crossed an opening) go
        var original = new Grid(v, index, 0.125f, stray);
        var keep = new bool[collapsed];
        Parallel.For(0, collapsed, t =>
        {
            Vector3 a = v[lod[t * 3]], b = v[lod[t * 3 + 1]], c = v[lod[t * 3 + 2]];
            keep[t] = Covered(a, b, c, original, stray, 8192);
        });
        var kept = new List<int>(lod.Length);
        for (int t = 0; t < collapsed; t++) if (keep[t]) { kept.Add(lod[t * 3]); kept.Add(lod[t * 3 + 1]); kept.Add(lod[t * 3 + 2]); }
        int dropped = collapsed - kept.Count / 3;
        var proxyIndex = kept.ToArray();

        // 2. original triangles the proxy no longer covers come back as they were
        var proxy = new Grid(v, proxyIndex, 0.25f, uncovered);
        int tris = index.Length / 3;
        var far = new bool[tris];
        Parallel.For(0, tris, t =>
        {
            Vector3 a = v[index[t * 3]], b = v[index[t * 3 + 1]], c = v[index[t * 3 + 2]];
            far[t] = !Covered(a, b, c, proxy, uncovered, 512);
        });
        // ... with the triangles that touch them, so the patch laps over the proxy round it
        var touched = new bool[v.Length];
        bool any = false;
        for (int t = 0; t < tris; t++)
            if (far[t]) { any = true; touched[index[t * 3]] = touched[index[t * 3 + 1]] = touched[index[t * 3 + 2]] = true; }
        var result = new List<Vector3>(proxyIndex.Length + 1024);
        foreach (int i in proxyIndex) result.Add(v[i]);
        int restored = 0;
        if (any)
            for (int t = 0; t < tris; t++)
                if (touched[index[t * 3]] || touched[index[t * 3 + 1]] || touched[index[t * 3 + 2]])
                { result.Add(v[index[t * 3]]); result.Add(v[index[t * 3 + 1]]); result.Add(v[index[t * 3 + 2]]); restored++; }
        if (result.Count >= faces.Length) return new(faces, before, collapsed, dropped, restored);
        return new(result.ToArray(), before, collapsed, dropped, restored);
    }

    /// <summary>Partition the entire triangle into certified patches, never accepting from samples alone.
    /// Each patch must fit in the convex reach-neighbourhood of a single target triangle.
    /// Depth/work limits fail closed: uncertain proxy triangles are dropped; uncertain originals restored.</summary>
    private static bool Covered(Vector3 a, Vector3 b, Vector3 c, Grid other, float reach, int budget)
    {
        return Patch(a, b, c, 0);
        bool Patch(Vector3 x, Vector3 y, Vector3 z, int depth)
        {
            if (--budget < 0) return false;
            if (other.CoversTriangle(x, y, z, reach)) return true;
            if (depth >= 24 || !other.Within(x, reach) || !other.Within(y, reach) || !other.Within(z, reach)) return false;
            // Bisect the longest edge; the children cover exactly the parent's full surface.
            float xy = x.DistanceSquaredTo(y), yz = y.DistanceSquaredTo(z), zx = z.DistanceSquaredTo(x);
            if (yz > xy && yz >= zx) (x, y, z) = (y, z, x);
            else if (zx > xy) (x, y, z) = (z, x, y);
            var mid = (x + y) * .5f;
            if (mid == x || mid == y) return false;
            return Patch(x, mid, z, depth + 1) && Patch(mid, y, z, depth + 1);
        }
    }

    /// <summary>Triangles by the cells their boxes (grown by the reach asked for) lie in: a point's own cell holds every triangle within that reach of it.</summary>
    private sealed class Grid
    {
        private readonly Vector3[] v;
        private readonly int[] index;
        private readonly float cell;
        private readonly Dictionary<long, (int Start, int Count)> cells = new();
        private readonly int[] items;

        public Grid(Vector3[] v, int[] index, float cell, float reach)
        {
            this.v = v; this.index = index; this.cell = cell;
            int tris = index.Length / 3;
            var count = new Dictionary<long, int>();
            void Each(int t, Action<long> f)
            {
                Vector3 a = v[index[t * 3]], b = v[index[t * 3 + 1]], c = v[index[t * 3 + 2]];
                int x0 = At(Math.Min(a.X, Math.Min(b.X, c.X)) - reach), x1 = At(Math.Max(a.X, Math.Max(b.X, c.X)) + reach);
                int y0 = At(Math.Min(a.Y, Math.Min(b.Y, c.Y)) - reach), y1 = At(Math.Max(a.Y, Math.Max(b.Y, c.Y)) + reach);
                int z0 = At(Math.Min(a.Z, Math.Min(b.Z, c.Z)) - reach), z1 = At(Math.Max(a.Z, Math.Max(b.Z, c.Z)) + reach);
                // (a long slanted triangle's box holds many cells it never comes near: only those within reach of it)
                bool big = (long)(x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 64;
                float slack = reach + cell * 0.8661f; // (half a cell's diagonal)
                for (int x = x0; x <= x1; x++)
                    for (int y = y0; y <= y1; y++)
                        for (int z = z0; z <= z1; z++)
                        {
                            if (big && Distance(new Vector3((x + .5f) * cell, (y + .5f) * cell, (z + .5f) * cell), a, b, c) > slack) continue;
                            f(Key(x, y, z));
                        }
            }
            for (int t = 0; t < tris; t++) Each(t, k => count[k] = count.GetValueOrDefault(k) + 1);
            int total = 0;
            foreach (var (k, n) in count) { cells[k] = (total, 0); total += n; }
            items = new int[total];
            for (int t = 0; t < tris; t++)
            {
                int tri = t;
                Each(t, k => { var e = cells[k]; items[e.Start + e.Count] = tri; cells[k] = (e.Start, e.Count + 1); });
            }
        }

        private int At(float x) => (int)MathF.Floor(x / cell);
        private static long Key(int x, int y, int z) => ((long)(x & 0x1FFFFF) << 42) | ((long)(y & 0x1FFFFF) << 21) | (long)(z & 0x1FFFFF);

        public bool Within(Vector3 p, float reach)
        {
            if (!cells.TryGetValue(Key(At(p.X), At(p.Y), At(p.Z)), out var e)) return false;
            float r2 = reach * reach;
            for (int i = e.Start; i < e.Start + e.Count; i++)
            {
                int t = items[i] * 3;
                if (DistanceSquared(p, v[index[t]], v[index[t + 1]], v[index[t + 2]]) <= r2) return true;
            }
            return false;
        }

        public bool CoversTriangle(Vector3 a, Vector3 b, Vector3 c, float reach)
        {
            if (!cells.TryGetValue(Key(At(a.X), At(a.Y), At(a.Z)), out var e)) return false;
            float r2 = Math.Max(0, reach - .0001f); r2 *= r2;
            for (int i = e.Start; i < e.Start + e.Count; i++)
            {
                int t = items[i] * 3;
                Vector3 x = v[index[t]], y = v[index[t + 1]], z = v[index[t + 2]];
                if (DistanceSquared(a, x, y, z) <= r2 && DistanceSquared(b, x, y, z) <= r2 &&
                    DistanceSquared(c, x, y, z) <= r2) return true;
            }
            return false;
        }
    }

    private static float Distance(Vector3 p, Vector3 a, Vector3 b, Vector3 c) => MathF.Sqrt(DistanceSquared(p, a, b, c));

    /// <summary>The squared distance from a point to a triangle (Ericson, Real-Time Collision Detection, 5.1.5).</summary>
    private static float DistanceSquared(Vector3 p, Vector3 a, Vector3 b, Vector3 c)
    {
        Vector3 ab = b - a, ac = c - a, ap = p - a;
        float d1 = ab.Dot(ap), d2 = ac.Dot(ap);
        if (d1 <= 0 && d2 <= 0) return ap.LengthSquared();
        var bp = p - b;
        float d3 = ab.Dot(bp), d4 = ac.Dot(bp);
        if (d3 >= 0 && d4 <= d3) return bp.LengthSquared();
        float vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) return (ap - ab * (d1 / (d1 - d3))).LengthSquared();
        var cp = p - c;
        float d5 = ab.Dot(cp), d6 = ac.Dot(cp);
        if (d6 >= 0 && d5 <= d6) return cp.LengthSquared();
        float vb = d5 * d2 - d1 * d6;
        if (vb <= 0 && d2 >= 0 && d6 <= 0) return (ap - ac * (d2 / (d2 - d6))).LengthSquared();
        float va = d3 * d6 - d5 * d4;
        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return (bp - (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)))).LengthSquared();
        float denom = va + vb + vc;
        if (denom == 0) return ap.LengthSquared(); // (no surface: a point or a line, its nearest corner is close enough here)
        float s = vb / denom, w = vc / denom;
        return (ap - ab * s - ac * w).LengthSquared();
    }
}
