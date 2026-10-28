using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>
/// An old dressed stone's surface (Codex on #237: the tree pits' kerbs and the old fronts' plinth stones read as new, their
/// edges razor-sharp): the top edge a worn round whose radius wanders along the stone and grows toward its ends, where the
/// joints wore it most; its corners rounded in plan; its top a millimetre or two uneven; its sides down to its foot. The
/// normals follow the round (no hard line along the arris). Each triangle goes to the caller with what its corners are, to
/// colour and place in its picture.
/// </summary>
public static class WornStone
{
    /// <summary>
    /// A corner: where (world), its normal, how much it faces up (1 the top, 0 a side, between on the arris), where in the
    /// stone (A along, C across, metres from its middle), how near a short end (0-1), its height over the paving, and
    /// whether it is the dirt round the stone's foot (Dirt: 0 at the stone, 1 at the dirt's outer edge; -1 the stone).
    /// </summary>
    public readonly record struct Corner(Vector3 P, Vector3 N, float Up, float A, float C, float End, float Over, float Dirt = -1);

    /// <summary>
    /// The stone at <paramref name="at"/>, its length along <paramref name="along"/> (unit), half sizes ha x hc, its top and
    /// foot heights, the arris's mean radius, how much wider it wears at the ends, the paving's height round it, and how
    /// far the dirt packed against its foot reaches out over the paving at most (0: none; a ragged band, its width
    /// wandering from a third of that to all of it). Triangles come wound clockwise as seen from outside (Godot's front
    /// face).
    /// </summary>
    public static void Build(Vector2 at, Vector2 along, float ha, float hc, float top, float foot, float arris, Random rng, Action<Corner, Corner, Corner> tri, float endWear = 0.8f, float ground = 0, float tilt = 0.003f, float dirt = 0)
    {
        var ac = new Vector2(-along.Y, along.X);
        float tiltA = ((float)rng.NextDouble() - 0.5f) * 2 * tilt, tiltC = ((float)rng.NextDouble() - 0.5f) * 2 * tilt;
        float ph = (float)rng.NextDouble() * 100, ph2 = (float)rng.NextDouble() * 100;
        // the arris's radius: wandering along the stone, up to (1 + endWear) times wider at its ends; never more than a
        // third of the stone's width or half its height over the foot
        float rMax = Math.Min(arris * 1.45f * (1 + endWear), Math.Min(Math.Min(ha, hc) * 0.33f, (top - foot) * 0.5f));
        // each plan corner its own round, at least the arris's widest (so the inset rings never turn inside out)
        var rc = new float[4];
        for (int k = 0; k < 4; k++) rc[k] = Math.Min(rMax + 0.002f + 0.008f * (float)rng.NextDouble(), Math.Min(ha, hc) * 0.9f);
        // the outline, round from the +A +C corner: (plan place, outward way, distance round)
        var ring = new List<(Vector2 Q, Vector2 N, float S)>();
        var signs = new[] { (1, 1), (-1, 1), (-1, -1), (1, -1) };
        float s = 0;
        Vector2? last = null;
        void Add(Vector2 q, Vector2 n) { if (last is { } l) s += l.DistanceTo(q); ring.Add((q, n, s)); last = q; }
        for (int k = 0; k < 4; k++)
        {
            var (sa, sc) = signs[k];
            var centre = new Vector2(sa * (ha - rc[k]), sc * (hc - rc[k]));
            // the corner's round, a quarter turn in four steps
            float a0 = MathF.Atan2(sc, sa) - MathF.PI / 4;
            for (int i = 0; i <= 4; i++)
            {
                float a = a0 + MathF.PI / 2 * i / 4;
                var n = new Vector2(MathF.Cos(a), MathF.Sin(a));
                Add(centre + n * rc[k], n);
            }
            // the straight side to the next corner, every 5 cm or so
            var (na, nc) = signs[(k + 1) % 4];
            var next = new Vector2(na * (ha - rc[(k + 1) % 4]), nc * (hc - rc[(k + 1) % 4]));
            float a1 = a0 + MathF.PI / 2;
            var sideN = new Vector2(MathF.Cos(a1), MathF.Sin(a1));
            var from = centre + sideN * rc[k];
            var to = next + sideN * rc[(k + 1) % 4];
            int steps = Math.Max(1, (int)MathF.Ceiling(from.DistanceTo(to) / 0.05f));
            for (int i = 1; i < steps; i++) Add(from.Lerp(to, (float)i / steps), sideN);
        }
        int m = ring.Count;
        float Wander(float x) => Noise1(x / 0.07f + ph) * 0.65f + Noise1(x / 0.023f + ph2) * 0.35f;
        float EndNear(Vector2 q) => SmoothStep(ha - 0.09f, ha, Math.Abs(q.X));
        var r = new float[m];
        var topAt = new float[m];
        for (int i = 0; i < m; i++)
        {
            var q = ring[i].Q;
            r[i] = Math.Min(rMax, arris * (0.55f + 0.9f * Wander(ring[i].S)) * (1 + endWear * EndNear(q)));
            topAt[i] = top + (Noise1(ring[i].S / 0.11f + ph2 * 1.7f) - 0.5f) * 0.0016f - 0.0012f * EndNear(q);
        }
        float Lift(Vector2 q) => q.X / Math.Max(ha, 0.01f) * tiltA + q.Y / Math.Max(hc, 0.01f) * tiltC;
        Corner Make(Vector2 q, float y, Vector2 n2, float up, bool lift = true)
        {
            var w = at + along * q.X + ac * q.Y;
            float side = MathF.Sqrt(Math.Max(0, 1 - up * up));
            var n = new Vector3((along.X * n2.X + ac.X * n2.Y) * side, up, (along.Y * n2.X + ac.Y * n2.Y) * side).Normalized();
            float yy = y + (lift && y > foot + 0.0005f ? Lift(q) : 0);
            return new Corner(new Vector3(w.X, yy, w.Y), n, up, q.X, q.Y, EndNear(q), yy - ground);
        }
        void Tri(Corner a, Corner b, Corner c)
        {
            var nm = a.N + b.N + c.N;
            if ((b.P - a.P).Cross(c.P - a.P).Dot(nm) > 0) (b, c) = (c, b);
            tri(a, b, c);
        }
        void Quad(Corner a, Corner b, Corner c, Corner d) { Tri(a, b, c); Tri(a, c, d); }
        // the rows: the top's inner ring, the arris's quarter round in four steps, then down the side (at the paving, and
        // the foot)
        const int J = 4;
        var rows = new List<Corner[]>();
        var inner = new Corner[m];
        for (int i = 0; i < m; i++) inner[i] = Make(ring[i].Q * 0.5f, top + (topAt[i] - top) * 0.5f, ring[i].N, 1);
        rows.Add(inner);
        for (int j = 0; j <= J; j++)
        {
            float phi = MathF.PI / 2 * j / J;
            var row = new Corner[m];
            for (int i = 0; i < m; i++)
                row[i] = Make(ring[i].Q - ring[i].N * r[i] * (1 - MathF.Sin(phi)), topAt[i] - r[i] * (1 - MathF.Cos(phi)), ring[i].N, MathF.Cos(phi));
            rows.Add(row);
        }
        float lowest = top - rMax;
        foreach (float y in new[] { ground + 0.006f, foot })
        {
            if (y >= lowest - 0.001f || (y > foot && y < foot + 0.004f)) continue;
            var row = new Corner[m];
            for (int i = 0; i < m; i++) row[i] = Make(ring[i].Q, y, ring[i].N, 0);
            rows.Add(row);
        }
        // the dirt at its foot: from the side just over the paving out over it, its outer edge just over the paving
        if (dirt > 0)
        {
            float ph3 = (float)rng.NextDouble() * 100;
            var at0 = new Corner[m];
            var at1 = new Corner[m];
            for (int i = 0; i < m; i++)
            {
                float wd = dirt * (0.3f + 0.7f * Noise1(ring[i].S / 0.05f + ph3)) * (1 + 0.5f * EndNear(ring[i].Q));
                at0[i] = Make(ring[i].Q - ring[i].N * 0.002f, ground + 0.0025f, ring[i].N, 1, false) with { Dirt = 0 };
                at1[i] = Make(ring[i].Q + ring[i].N * wd, ground + 0.0008f, ring[i].N, 1, false) with { Dirt = 1 };
            }
            for (int i = 0; i < m; i++)
            {
                int i2 = (i + 1) % m;
                Quad(at0[i], at0[i2], at1[i2], at1[i]);
            }
        }
        // the top's middle
        var mid = Make(Vector2.Zero, top, Vector2.Zero, 1);
        for (int i = 0; i < m; i++) Tri(mid, inner[i], inner[(i + 1) % m]);
        for (int k = 0; k + 1 < rows.Count; k++)
            for (int i = 0; i < m; i++)
            {
                int i2 = (i + 1) % m;
                Quad(rows[k][i], rows[k][i2], rows[k + 1][i2], rows[k + 1][i]);
            }
    }

    private static float SmoothStep(float a, float b, float x) { float t = Math.Clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

    private static float Noise1(float x)
    {
        static float H(int i) { uint h = (uint)(i * 374761393 + 668265263); h = (h ^ (h >> 13)) * 1274126177; return (h ^ (h >> 16)) / (float)uint.MaxValue; }
        int ix = (int)MathF.Floor(x);
        float f = x - ix, u = f * f * (3 - 2 * f);
        return H(ix) + (H(ix + 1) - H(ix)) * u;
    }
}
