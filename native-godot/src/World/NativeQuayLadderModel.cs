using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// The one wrought-iron quay ladder (issue 85), built in code so every quay ladder shares the design: two flat-bar
/// stiles, round rungs riveted through them, wall brackets with bolted plates, and grab hoops of round bar that rise
/// over the coping and come down onto the quay on cast foot plates. The fit to a wall comes from the stone measured at
/// each ladder (<see cref="NativeQuayLadders"/>); the parts and their sizes never change.
///
/// Local frame: x along the wall, y up (world height), z out over the water from the quay line. Every exposed edge
/// has a geometric chamfer at wrought-iron size (2-3 mm on bar, 4 mm on castings, AGENTS.md); round bar is round.
/// The colour is the quay iron's own vertex tint, with light rust through the tide range and dark weed below low
/// water, as the browser shaded its quay iron (quaysteps.ts tideShade), so it uses the existing quay-iron material.
/// </summary>
public static class NativeQuayLadderModel
{
    /// <summary>Clear width between the stiles; stile section (deep along z, thick along x); rung pitch and size.</summary>
    public const float Inner = 0.44f, StileDeep = 0.065f, StileThick = 0.016f, Pitch = 0.29f, RungR = 0.014f;
    /// <summary>Hoop bar radius, how high the hoop's straight part rises over the top rung, its offset to the stile's outer face.</summary>
    public const float HoopR = 0.016f, HoopRise = 0.62f;
    /// <summary>Where the stiles stand, measured from the quay line: their feet, below the lowest spring tide.</summary>
    public const float FootY = Tide.LwMin - 0.7f;
    public static float StileX => Inner / 2 + StileThick / 2;
    public static float HoopX => Inner / 2 + StileThick + HoopR;

    /// <summary>One wall's fit: all numbers in the ladder's frame, rounded to a centimetre so walls alike share a mesh.</summary>
    /// <summary>Brackets: height, and the wall behind the left and the right stile (NaN: nothing there to fix to).</summary>
    public readonly record struct Fit(float TopRung, float RungZ, float LegZ, float LegY, bool Dock, float CopeZ, (float Y, float Left, float Right)[] Brackets)
    {
        public string Key => FormattableString.Invariant($"{TopRung:0.00}|{RungZ:0.00}|{LegZ:0.00}|{LegY:0.00}|{Dock}|{CopeZ:0.00}|") + string.Join(",", Array.ConvertAll(Brackets, b => FormattableString.Invariant($"{b.Y:0.00}:{b.Left:0.00}:{b.Right:0.00}")));
    }

    private sealed class Builder
    {
        public readonly List<Vector3> V = new(), N = new();
        public readonly List<Vector2> Uv = new();
        public readonly List<Color> C = new();
        public bool Dock;

        private void Vert(Vector3 p, Vector3 n)
        {
            V.Add(p); N.Add(n);
            // box projection at a metre a picture, as the browser's quay iron (Geo, tile 1)
            float ax = Math.Abs(n.X), ay = Math.Abs(n.Y), az = Math.Abs(n.Z);
            Uv.Add(ay >= ax && ay >= az ? new Vector2(p.X, p.Z) : ax >= az ? new Vector2(p.Z, p.Y) : new Vector2(p.X, p.Y));
            C.Add(Tint(p.Y, Dock));
        }

        /// <summary>A triangle facing `face`; Godot's front faces wind clockwise.</summary>
        public void Tri(Vector3 a, Vector3 b, Vector3 c, Vector3 na, Vector3 nb, Vector3 nc, Vector3 face)
        {
            if ((b - a).Cross(c - a).Dot(face) > 0) { (b, c) = (c, b); (nb, nc) = (nc, nb); }
            Vert(a, na); Vert(b, nb); Vert(c, nc);
        }

        public void Flat(Vector3 a, Vector3 b, Vector3 c, Vector3 n) => Tri(a, b, c, n, n, n, n);
        public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 n) { Flat(a, b, c, n); Flat(a, c, d, n); }

        /// <summary>A box between lo and hi with every edge chamfered by `b`: 6 faces, 12 chamfer strips, 8 corner facets.</summary>
        public void Box(Vector3 lo, Vector3 hi, float b)
        {
            var c = (lo + hi) / 2; var h = (hi - lo) / 2;
            b = Math.Min(b, Math.Min(h.X, Math.Min(h.Y, h.Z)) * 0.45f);
            Vector3 P(float sx, float sy, float sz, int axis)
            {
                // the corner (sx, sy, sz) pulled in by the chamfer on the two axes other than `axis`
                var p = new Vector3(sx * h.X, sy * h.Y, sz * h.Z);
                if (axis != 0) p.X -= sx * b;
                if (axis != 1) p.Y -= sy * b;
                if (axis != 2) p.Z -= sz * b;
                return c + p;
            }
            for (int axis = 0; axis < 3; axis++)
                foreach (float s in new[] { -1f, 1f })
                {
                    var n = axis == 0 ? new Vector3(s, 0, 0) : axis == 1 ? new Vector3(0, s, 0) : new Vector3(0, 0, s);
                    Vector3 Q(float u, float v) => axis == 0 ? P(s, u, v, 0) : axis == 1 ? P(u, s, v, 1) : P(u, v, s, 2);
                    Quad(Q(-1, -1), Q(1, -1), Q(1, 1), Q(-1, 1), n);
                }
            if (b <= 0) return; // (a plain box: the collision's)
            // chamfer strips along each edge, and the corner facets
            foreach (float sx in new[] { -1f, 1f })
                foreach (float sy in new[] { -1f, 1f })
                {
                    // edges along z (between the x face and the y face)
                    var n = new Vector3(sx, sy, 0).Normalized();
                    Quad(P(sx, sy, -1, 0), P(sx, sy, 1, 0), P(sx, sy, 1, 1), P(sx, sy, -1, 1), n);
                    foreach (float sz in new[] { -1f, 1f })
                        Flat(P(sx, sy, sz, 0), P(sx, sy, sz, 1), P(sx, sy, sz, 2), new Vector3(sx, sy, sz).Normalized());
                }
            foreach (float sx in new[] { -1f, 1f })
                foreach (float sz in new[] { -1f, 1f })
                {
                    var n = new Vector3(sx, 0, sz).Normalized();
                    Quad(P(sx, -1, sz, 0), P(sx, 1, sz, 0), P(sx, 1, sz, 2), P(sx, -1, sz, 2), n);
                }
            foreach (float sy in new[] { -1f, 1f })
                foreach (float sz in new[] { -1f, 1f })
                {
                    var n = new Vector3(0, sy, sz).Normalized();
                    Quad(P(-1, sy, sz, 1), P(1, sy, sz, 1), P(1, sy, sz, 2), P(-1, sy, sz, 2), n);
                }
        }

        /// <summary>A short round head (a rivet or a bolt) from `c` out along `axis`: six sides and a flat end.</summary>
        public void Stud(Vector3 c, Vector3 axis, float r, float length)
        {
            var side = Math.Abs(axis.Dot(Vector3.Up)) < 0.9f ? axis.Cross(Vector3.Up).Normalized() : axis.Cross(Vector3.Right).Normalized();
            var up = axis.Cross(side);
            var end = c + axis * length;
            for (int k = 0; k < 6; k++)
            {
                float a0 = Mathf.Tau * k / 6, a1 = Mathf.Tau * (k + 1) / 6;
                Vector3 n0 = side * MathF.Cos(a0) + up * MathF.Sin(a0), n1 = side * MathF.Cos(a1) + up * MathF.Sin(a1);
                var face = (n0 + n1).Normalized();
                Tri(c + n0 * r, c + n1 * r, end + n1 * r * 0.8f, n0, n1, n1, face);
                Tri(c + n0 * r, end + n1 * r * 0.8f, end + n0 * r * 0.8f, n0, n1, n0, face);
                Flat(end, end + n0 * r * 0.8f, end + n1 * r * 0.8f, axis);
            }
        }

        /// <summary>Round bar along a path, `sides` round, smooth; `caps`: closed ends with a small chamfer ring.</summary>
        public void Tube(IReadOnlyList<Vector3> path, float r, int sides, bool caps)
        {
            var rings = new List<Vector3[]>(); var norms = new List<Vector3[]>();
            Vector3 side = Vector3.Zero;
            for (int i = 0; i < path.Count; i++)
            {
                var tan = (path[Math.Min(i + 1, path.Count - 1)] - path[Math.Max(i - 1, 0)]).Normalized();
                // a frame carried along the path (parallel transport): no twist in the bends
                if (i == 0) side = Math.Abs(tan.Dot(Vector3.Right)) < 0.9f ? tan.Cross(Vector3.Right).Normalized() : tan.Cross(Vector3.Up).Normalized();
                else side = (side - tan * side.Dot(tan)).Normalized();
                var up = tan.Cross(side);
                var ring = new Vector3[sides]; var nr = new Vector3[sides];
                for (int k = 0; k < sides; k++)
                {
                    float a = Mathf.Tau * k / sides;
                    nr[k] = side * MathF.Cos(a) + up * MathF.Sin(a);
                    ring[k] = path[i] + nr[k] * r;
                }
                rings.Add(ring); norms.Add(nr);
            }
            for (int i = 0; i + 1 < rings.Count; i++)
                for (int k = 0; k < sides; k++)
                {
                    int k1 = (k + 1) % sides;
                    var face = (norms[i][k] + norms[i][k1] + norms[i + 1][k] + norms[i + 1][k1]).Normalized();
                    Tri(rings[i][k], rings[i][k1], rings[i + 1][k1], norms[i][k], norms[i][k1], norms[i + 1][k1], face);
                    Tri(rings[i][k], rings[i + 1][k1], rings[i + 1][k], norms[i][k], norms[i + 1][k1], norms[i + 1][k], face);
                }
            if (!caps) return;
            foreach (int end in new[] { 0, path.Count - 1 })
            {
                var dir = end == 0 ? (path[0] - path[1]).Normalized() : (path[^1] - path[^2]).Normalized();
                var centre = path[end] + dir * r * 0.18f;
                // a chamfer ring, then the flat end
                var inner = new Vector3[sides];
                for (int k = 0; k < sides; k++) inner[k] = path[end] + norms[end][k] * r * 0.75f + dir * r * 0.18f;
                for (int k = 0; k < sides; k++)
                {
                    int k1 = (k + 1) % sides;
                    var n = (norms[end][k] + dir).Normalized();
                    Quad(rings[end][k], rings[end][k1], inner[k1], inner[k], n);
                    Flat(centre, inner[k], inner[k1], dir);
                }
            }
        }

        public ArrayMesh Mesh(Material material)
        {
            var arrays = new Godot.Collections.Array();
            arrays.Resize((int)Godot.Mesh.ArrayType.Max);
            arrays[(int)Godot.Mesh.ArrayType.Vertex] = V.ToArray();
            arrays[(int)Godot.Mesh.ArrayType.Normal] = N.ToArray();
            arrays[(int)Godot.Mesh.ArrayType.TexUV] = Uv.ToArray();
            arrays[(int)Godot.Mesh.ArrayType.Color] = C.ToArray();
            var mesh = new ArrayMesh { ResourceName = "quay_ladder" };
            mesh.AddSurfaceFromArrays(Godot.Mesh.PrimitiveType.Triangles, arrays);
            mesh.SurfaceSetMaterial(0, material);
            return mesh;
        }
    }

    /// <summary>
    /// The iron's tint by height (world y): dry quay iron above the springs, a light rust band where the tide wets it
    /// daily (round the high-water mark), darker wet rust through the range, black weed below low water. The Petit
    /// Bassin stands at one level: its band is narrow, round the dock's water.
    /// </summary>
    public static Color Tint(float y, bool dock)
    {
        var dry = new Color(0.9f, 0.86f, 0.82f);
        var rust = new Color(1.0f, 0.62f, 0.42f);
        var wet = new Color(0.62f, 0.46f, 0.34f);
        var weed = new Color(0.34f, 0.35f, 0.28f);
        (float, Color)[] stops = dock
            ? new[] { (Tide.DockY - 0.9f, weed), (Tide.DockY - 0.35f, wet), (Tide.DockY + 0.05f, rust), (Tide.DockY + 0.45f, dry) }
            : new[] { (Tide.LwMin - 0.2f, weed), (Tide.MidY - 1.2f, wet), (Tide.HwMax - 0.35f, rust), (Tide.HwMax + 0.05f, rust), (Tide.HwMax + 0.4f, dry) };
        if (y <= stops[0].Item1) return stops[0].Item2;
        for (int i = 1; i < stops.Length; i++)
            if (y <= stops[i].Item1)
                return stops[i - 1].Item2.Lerp(stops[i].Item2, (y - stops[i - 1].Item1) / (stops[i].Item1 - stops[i - 1].Item1));
        return dry;
    }

    /// <summary>
    /// The ladder for one fit, in its own frame, and its collision: the same stiles, rungs, brackets and hoops as plain
    /// boxes and four-sided bar (no bolts or rivets), one shape shared by every ladder of that fit. `rungs` lists the
    /// rung heights (for the climb and the checks).
    /// </summary>
    public static ArrayMesh Build(Fit fit, Material material, out ConcavePolygonShape3D collision, out float[] rungs)
    {
        var b = new Builder { Dock = fit.Dock };
        var solid = new Builder { Dock = fit.Dock };
        float zr = fit.RungZ, top = fit.TopRung;
        float stileTop = top + 0.1f, back = zr - StileDeep / 2;
        var rungList = new List<float>();
        for (float y = top; y >= FootY + 0.15f; y -= Pitch) rungList.Add(y);
        rungs = rungList.ToArray();
        foreach (float s in new[] { -1f, 1f })
        {
            float x = s * StileX;
            // the stile: wrought flat bar on edge, 2.5 mm chamfers
            var lo = new Vector3(x - StileThick / 2, FootY, zr - StileDeep / 2); var hi = new Vector3(x + StileThick / 2, stileTop, zr + StileDeep / 2);
            b.Box(lo, hi, 0.0025f); solid.Box(lo, hi, 0);
            // the grab hoop: round bar lapped and riveted to the stile's outer face, up, over the coping and down onto
            // the ground behind it, where a cast plate is bolted down
            float hx = s * HoopX, yA = top + HoopRise, zc = (zr + fit.LegZ) / 2, rad = (zr - fit.LegZ) / 2;
            var path = new List<Vector3> { new(hx, top - 0.32f, zr), new(hx, top + 0.1f, zr), new(hx, yA, zr) };
            var coarse = new List<Vector3> { new(hx, top - 0.32f, zr), new(hx, yA, zr) };
            for (int k = 1; k < 20; k++)
            {
                float a = MathF.PI * k / 20;
                var p = new Vector3(hx, yA + rad * MathF.Sin(a), zc + rad * MathF.Cos(a));
                path.Add(p);
                if (k % 4 == 0) coarse.Add(p);
            }
            foreach (var list in new[] { path, coarse }) { list.Add(new Vector3(hx, yA, fit.LegZ)); list.Add(new Vector3(hx, fit.LegY + 0.016f, fit.LegZ)); }
            b.Tube(path, HoopR, 10, false);
            solid.Tube(coarse, HoopR, 4, false);
            // rivets through the lap
            foreach (float y in new[] { top - 0.24f, top + 0.02f })
                b.Stud(new Vector3(hx + s * (HoopR - 0.002f), y, zr), new Vector3(s, 0, 0), 0.009f, 0.008f);
            // the cast foot plate (4 mm edges) and its two bolt heads
            b.Box(new Vector3(hx - 0.045f, fit.LegY, fit.LegZ - 0.065f), new Vector3(hx + 0.045f, fit.LegY + 0.018f, fit.LegZ + 0.065f), 0.004f);
            foreach (float dz in new[] { -0.042f, 0.042f })
                b.Stud(new Vector3(hx, fit.LegY + 0.017f, fit.LegZ + dz), Vector3.Up, 0.011f, 0.01f);
            // wall brackets: flat bar from a bolted plate on the wall to the stile's back edge
            foreach (var (y, left, right) in fit.Brackets)
            {
                float wallZ = s < 0 ? left : right;
                if (!float.IsFinite(wallZ)) continue;
                lo = new Vector3(x - 0.006f, y - 0.025f, wallZ + 0.014f); hi = new Vector3(x + 0.006f, y + 0.025f, back + 0.004f);
                b.Box(lo, hi, 0.002f); solid.Box(lo, hi, 0);
                b.Box(new Vector3(x - 0.05f, y - 0.07f, wallZ), new Vector3(x + 0.05f, y + 0.07f, wallZ + 0.016f), 0.003f);
                foreach (float dy in new[] { -0.045f, 0.045f })
                    b.Stud(new Vector3(x, y + dy, wallZ + 0.015f), Vector3.Back, 0.012f, 0.01f);
            }
        }
        // a short bracket from each stile into the coping's face holds the head clear of it
        if (fit.CopeZ > 0)
            foreach (float s in new[] { -1f, 1f })
            {
                float x = s * StileX, y = top - 0.15f;
                var lo = new Vector3(x - 0.006f, y - 0.025f, fit.CopeZ - 0.01f); var hi = new Vector3(x + 0.006f, y + 0.025f, back + 0.004f);
                b.Box(lo, hi, 0.002f); solid.Box(lo, hi, 0);
            }
        // the rungs: round bar through both stiles, the ends riveted over outside them
        float through = StileX + StileThick / 2;
        foreach (float y in rungs)
        {
            b.Tube(new[] { new Vector3(-through, y, zr), new Vector3(through, y, zr) }, RungR, 8, false);
            solid.Box(new Vector3(-through, y - RungR, zr - RungR), new Vector3(through, y + RungR, zr + RungR), 0);
            if (y > top - 0.35f) continue; // (by the top the hoop's lap covers the rivet)
            foreach (float s in new[] { -1f, 1f })
                b.Stud(new Vector3(s * (through - 0.001f), y, zr), new Vector3(s, 0, 0), RungR + 0.005f, 0.008f);
        }
        collision = new ConcavePolygonShape3D { Data = solid.V.ToArray(), BackfaceCollision = true };
        return b.Mesh(material);
    }
}
