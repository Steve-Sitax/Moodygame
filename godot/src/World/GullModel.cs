using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The herring gull (and the town's pigeon) made in code, in eight parts on a few joints so that one MultiMesh a part
/// draws every bird and the wings, the head and the legs move without a new shader: the body with its tail, the head
/// with its neck and bill, each wing's arm (shoulder to wrist) and hand (wrist to tip), each leg with its foot.
/// Bird frame: +Z forward, +Y up, wings along X; metres. The gull: about 0.6 m long, 1.45 m across the wings, in
/// autumn plumage: white head with grey streaks on the nape, silver-grey back and wings, black wing tips with white
/// "mirrors" and white tips, white tail, yellow bill with the red spot, pale eye, pink legs and webbed feet.
/// </summary>
public static class GullModel
{
    public const int Body = 0, Head = 1, ArmL = 2, HandL = 3, ArmR = 4, HandR = 5, LegL = 6, LegR = 7, Parts = 8;

    /// <summary>The meshes and the joints of one kind of bird (in its body frame).</summary>
    public sealed class Rig
    {
        public readonly ArrayMesh[] Mesh = new ArrayMesh[Parts];
        public Vector3 Neck, Shoulder, ShoulderFolded, Hip;
        /// <summary>Shoulder to wrist (m); the body's origin over the feet when standing (m).</summary>
        public float Arm, Stand;
        public int Triangles;
    }

    private static Color C(float r, float g, float b) => new Color(r, g, b).SrgbToLinear();

    // ------------------------------------------------------------------ the mesh maker

    private sealed class Mk
    {
        private readonly List<Vector3> v = new(), n = new();
        private readonly List<Color> c = new();
        private readonly List<int> ix = new();

        /// <summary>A grid of points (rows x cols, row-major), smooth normals turned to the hint; wrap: the columns close round.</summary>
        public void Grid(Vector3[] p, Color[] col, int rows, int cols, bool wrap, Func<int, int, Vector3> hint)
        {
            int b = v.Count;
            for (int r = 0; r < rows; r++)
                for (int k = 0; k < cols; k++)
                {
                    int kp = wrap ? (k + 1) % cols : Math.Min(k + 1, cols - 1), km = wrap ? (k - 1 + cols) % cols : Math.Max(k - 1, 0);
                    int rp = Math.Min(r + 1, rows - 1), rm = Math.Max(r - 1, 0);
                    var nn = (p[r * cols + kp] - p[r * cols + km]).Cross(p[rp * cols + k] - p[rm * cols + k]);
                    var h = hint(r, k);
                    if (nn.LengthSquared() < 1e-14f) nn = h;
                    nn = nn.Normalized();
                    if (nn.Dot(h) < 0) nn = -nn;
                    v.Add(p[r * cols + k]);
                    n.Add(nn);
                    c.Add(col[r * cols + k]);
                }
            int kc = wrap ? cols : cols - 1;
            for (int r = 0; r < rows - 1; r++)
                for (int k = 0; k < kc; k++)
                {
                    int k1 = (k + 1) % cols;
                    int a = b + r * cols + k, bb = b + r * cols + k1, cc = b + (r + 1) * cols + k1, d = b + (r + 1) * cols + k;
                    Add(a, bb, cc);
                    Add(a, cc, d);
                }
        }

        /// <summary>A loose triangle with its own (flat) normal turned to the hint.</summary>
        public void Tri(Vector3 a, Vector3 b, Vector3 cc, Color ca, Color cb, Color c3, Vector3 hint)
        {
            var nn = (b - a).Cross(cc - a);
            if (nn.LengthSquared() < 1e-16f) return;
            nn = nn.Normalized();
            if (nn.Dot(hint) < 0) nn = -nn;
            int i = v.Count;
            v.Add(a); v.Add(b); v.Add(cc);
            n.Add(nn); n.Add(nn); n.Add(nn);
            c.Add(ca); c.Add(cb); c.Add(c3);
            Add(i, i + 1, i + 2);
        }

        /// <summary>Godot's front face winds clockwise seen from outside: against the normals.</summary>
        private void Add(int a, int b, int cc)
        {
            var nrm = n[a] + n[b] + n[cc];
            if ((v[b] - v[a]).Cross(v[cc] - v[a]).Dot(nrm) > 0) (b, cc) = (cc, b);
            ix.Add(a); ix.Add(b); ix.Add(cc);
        }

        public int Triangles => ix.Count / 3;

        public ArrayMesh Commit()
        {
            var arrays = new Godot.Collections.Array();
            arrays.Resize((int)Mesh.ArrayType.Max);
            arrays[(int)Mesh.ArrayType.Vertex] = v.ToArray();
            arrays[(int)Mesh.ArrayType.Normal] = n.ToArray();
            arrays[(int)Mesh.ArrayType.Color] = c.ToArray();
            arrays[(int)Mesh.ArrayType.Index] = ix.ToArray();
            var m = new ArrayMesh();
            m.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            return m;
        }

        /// <summary>
        /// A tube along a path in the bird's middle plane (x = 0): each ring a super-ellipse w across, h up, square-ish
        /// by the exponent; colour(ring, angle, point).
        /// </summary>
        public void Loft(Vector3[] path, float[] w, float[] h, int seg, float ex, Func<int, float, Vector3, Color> colour, float side = 0)
        {
            int rows = path.Length;
            var p = new Vector3[rows * seg];
            var col = new Color[rows * seg];
            var hints = new Vector3[rows * seg];
            for (int i = 0; i < rows; i++)
            {
                var t = (path[Math.Min(i + 1, rows - 1)] - path[Math.Max(i - 1, 0)]).Normalized();
                var s = Vector3.Right;
                var u = t.Cross(s).Normalized();
                for (int k = 0; k < seg; k++)
                {
                    float a = k * MathF.Tau / seg;
                    float ca = MathF.Cos(a), sa = MathF.Sin(a);
                    float ce = MathF.Sign(ca) * MathF.Pow(MathF.Abs(ca), 2 / ex), se = MathF.Sign(sa) * MathF.Pow(MathF.Abs(sa), 2 / ex);
                    var q = path[i] + s * (w[i] * ce + side) + u * h[i] * se;
                    p[i * seg + k] = q;
                    col[i * seg + k] = colour(i, a, q);
                    hints[i * seg + k] = s * ca + u * sa;
                }
            }
            Grid(p, col, rows, seg, true, (r, k) => hints[r * seg + k]);
        }
    }

    // ------------------------------------------------------------------ the kinds

    /// <summary>The gull (pigeon false) or the pigeon.</summary>
    public static Rig Make(bool pigeon)
    {
        var rig = new Rig();
        if (!pigeon)
        {
            rig.Neck = new Vector3(0, 0.03f, 0.12f);
            rig.Shoulder = new Vector3(0.045f, 0.04f, 0.06f);
            rig.ShoulderFolded = new Vector3(0.066f, -0.036f, 0.075f);
            rig.Hip = new Vector3(0.028f, -0.04f, -0.005f);
            rig.Arm = 0.30f;
            rig.Stand = 0.177f;
        }
        else
        {
            rig.Neck = new Vector3(0, 0.022f, 0.068f);
            rig.Shoulder = new Vector3(0.03f, 0.028f, 0.035f);
            rig.ShoulderFolded = new Vector3(0.046f, -0.022f, 0.045f);
            rig.Hip = new Vector3(0.018f, -0.03f, -0.0f);
            rig.Arm = 0.13f;
            rig.Stand = 0.092f;
        }
        int tris = 0;
        ArrayMesh Done(Mk m) { tris += m.Triangles; return m.Commit(); }
        rig.Mesh[Body] = Done(BodyMesh(pigeon));
        rig.Mesh[Head] = Done(HeadMesh(pigeon));
        rig.Mesh[ArmL] = Done(ArmMesh(pigeon, 1));
        rig.Mesh[ArmR] = Done(ArmMesh(pigeon, -1));
        rig.Mesh[HandL] = Done(HandMesh(pigeon, 1));
        rig.Mesh[HandR] = Done(HandMesh(pigeon, -1));
        rig.Mesh[LegL] = Done(LegMesh(pigeon));
        rig.Mesh[LegR] = Done(LegMesh(pigeon));
        rig.Triangles = tris;
        return rig;
    }

    private static readonly Color White = C(0.82f, 0.82f, 0.80f), Belly = C(0.84f, 0.84f, 0.83f), Mantle = C(0.55f, 0.59f, 0.63f),
        Black = C(0.07f, 0.07f, 0.08f), Bill = C(0.95f, 0.78f, 0.22f), Spot = C(0.82f, 0.13f, 0.08f), Pink = C(0.86f, 0.64f, 0.60f),
        Streak = C(0.70f, 0.67f, 0.63f), Under = C(0.78f, 0.79f, 0.80f), TipUnder = C(0.24f, 0.24f, 0.26f);
    private static readonly Color PBody = C(0.52f, 0.55f, 0.62f), PDark = C(0.36f, 0.38f, 0.45f), PNeck = C(0.34f, 0.46f, 0.43f),
        PNeck2 = C(0.44f, 0.36f, 0.48f), PBar = C(0.12f, 0.12f, 0.14f), PBill = C(0.25f, 0.23f, 0.23f), PCere = C(0.86f, 0.86f, 0.84f),
        PLeg = C(0.74f, 0.30f, 0.30f), PWing = C(0.60f, 0.63f, 0.69f), PTip = C(0.26f, 0.27f, 0.31f);

    private static float Hash(Vector3 p) => MathF.Abs(MathF.Sin(p.X * 12.9898f * 97 + p.Y * 78.233f * 97 + p.Z * 37.719f * 97) * 43758.545f) % 1;

    private static Mk BodyMesh(bool pig)
    {
        var m = new Mk();
        // (z, half width, half height, centre height): breast to rump
        float[,] st =
        {
            { 0.165f, 0.010f, 0.012f, 0.036f }, { 0.150f, 0.032f, 0.036f, 0.031f }, { 0.125f, 0.054f, 0.058f, 0.018f },
            { 0.090f, 0.069f, 0.071f, 0.006f }, { 0.045f, 0.077f, 0.076f, -0.002f }, { 0.000f, 0.078f, 0.072f, -0.005f },
            { -0.045f, 0.073f, 0.065f, -0.003f }, { -0.090f, 0.061f, 0.053f, 0.003f }, { -0.130f, 0.044f, 0.037f, 0.010f },
            { -0.160f, 0.028f, 0.022f, 0.015f }, { -0.180f, 0.012f, 0.010f, 0.017f }, { -0.188f, 0.002f, 0.002f, 0.018f },
        };
        int rows = st.GetLength(0);
        var path = new Vector3[rows];
        var w = new float[rows];
        var h = new float[rows];
        for (int i = 0; i < rows; i++)
        {
            float fz = pig ? 0.6f : 1, fw = pig ? 0.68f * (st[i, 0] > 0.04f ? 1.12f : 1) : 1, fh = pig ? 0.74f * (st[i, 0] > 0.04f ? 1.1f : 1) : 1;
            path[i] = new Vector3(0, st[i, 3] * (pig ? 0.7f : 1), st[i, 0] * fz);
            w[i] = st[i, 1] * fw;
            h[i] = st[i, 2] * fh;
        }
        m.Loft(path, w, h, 18, 2.2f, (i, a, q) =>
        {
            float up = MathF.Sin(a);
            if (pig) return q.Z > 0.045f && up > -0.4f ? (Hash(q) < 0.5f ? PNeck : PNeck2).Lerp(PBody, Math.Clamp((0.075f - q.Z) * 30, 0, 1)) : up > 0.3f ? PBody : PBody.Lerp(PDark, 0.25f);
            // the grey mantle between the wings on the back; the rest white
            return up > 0.42f && q.Z < 0.105f && q.Z > -0.115f ? Mantle : up < -0.3f ? Belly : White;
        });
        // the tail: a flat fan, white (the pigeon's grey with a dark band at its end)
        float L = pig ? 0.6f : 1;
        var tp = new[] { new Vector3(0, 0.016f * L, -0.135f * L), new Vector3(0, 0.020f * L, -0.20f * L), new Vector3(0, 0.024f * L, -0.26f * L), new Vector3(0, 0.026f * L, -0.30f * L), new Vector3(0, 0.026f * L, -0.305f * L) };
        var tw = new[] { 0.034f * L, 0.044f * L, 0.052f * L, 0.055f * L, 0.050f * L };
        var th = new[] { 0.014f * L, 0.009f * L, 0.007f * L, 0.005f * L, 0.001f * L };
        m.Loft(tp, tw, th, 12, 3.2f, (i, a, q) => pig ? (i >= 3 ? PBar : PDark) : White);
        return m;
    }

    private static Mk HeadMesh(bool pig)
    {
        var m = new Mk();
        float S = pig ? 0.62f : 1;
        // the neck from inside the body up to the head, the head, the forehead into the bill (relative to the neck joint)
        var path = new[]
        {
            new Vector3(0, -0.015f, -0.012f), new Vector3(0, 0.012f, 0.0f), new Vector3(0, 0.040f, 0.012f), new Vector3(0, 0.062f, 0.030f),
            new Vector3(0, 0.073f, 0.052f), new Vector3(0, 0.073f, 0.073f), new Vector3(0, 0.068f, 0.089f), new Vector3(0, 0.064f, 0.097f),
        };
        var w = new[] { 0.036f, 0.031f, 0.029f, 0.032f, 0.034f, 0.030f, 0.020f, 0.008f };
        var h = new[] { 0.036f, 0.031f, 0.030f, 0.034f, 0.037f, 0.032f, 0.021f, 0.009f };
        if (pig)
        {
            // a short neck and a small round head
            w = new[] { 0.040f, 0.034f, 0.030f, 0.029f, 0.030f, 0.026f, 0.017f, 0.007f };
            h = new[] { 0.040f, 0.034f, 0.031f, 0.031f, 0.033f, 0.028f, 0.018f, 0.008f };
        }
        for (int i = 0; i < path.Length; i++) { path[i] *= S; w[i] *= S; h[i] *= S; }
        m.Loft(path, w, h, 16, 2.0f, (i, a, q) =>
        {
            if (pig) return i <= 2 ? (Hash(q) < 0.5f ? PNeck : PNeck2) : PDark.Lerp(PBody, 0.4f);
            // autumn: fine grey streaks on the nape and the back of the head
            bool nape = i >= 1 && i <= 4 && MathF.Sin(a) > -0.2f && q.Z < 0.06f;
            return nape && Hash(q * 1.7f) < 0.45f ? White.Lerp(Streak, 0.4f + 0.5f * Hash(q)) : White;
        });
        // the bill: deep, with the gonys (the bulge under it) and the red spot there, hooked at the tip
        var bp = new[]
        {
            new Vector3(0, 0.066f, 0.090f), new Vector3(0, 0.065f, 0.104f), new Vector3(0, 0.064f, 0.118f), new Vector3(0, 0.0625f, 0.128f),
            new Vector3(0, 0.0632f, 0.138f), new Vector3(0, 0.062f, 0.146f), new Vector3(0, 0.0585f, 0.1515f), new Vector3(0, 0.055f, 0.153f),
        };
        var bw = new[] { 0.0100f, 0.0085f, 0.0072f, 0.0064f, 0.0050f, 0.0036f, 0.0020f, 0.0006f };
        var bh = new[] { 0.0120f, 0.0104f, 0.0098f, 0.0106f, 0.0084f, 0.0058f, 0.0030f, 0.0008f };
        float BL = pig ? 0.38f : 1;
        for (int i = 0; i < bp.Length; i++)
        {
            float z0 = 0.090f;
            bp[i] = new Vector3(0, bp[i].Y, z0 + (bp[i].Z - z0) * BL) * S;
            bw[i] *= S * (pig ? 0.8f : 1);
            bh[i] *= S * (pig ? 0.75f : 1);
        }
        m.Loft(bp, bw, bh, 10, 2.0f, (i, a, q) =>
        {
            if (pig) return i <= 1 && MathF.Sin(a) > 0.1f ? PCere : PBill;
            return i >= 2 && i <= 4 && MathF.Sin(a) < -0.35f ? Spot : Bill;
        });
        // the eyes: pale iris round a black pupil (the pigeon's orange)
        var iris = pig ? C(0.85f, 0.45f, 0.15f) : C(0.92f, 0.86f, 0.55f);
        foreach (float s in new[] { -1f, 1f })
        {
            var centre = new Vector3(s * 0.0305f, 0.0795f, 0.0735f) * S;
            if (pig) centre = new Vector3(s * 0.0285f, 0.0780f, 0.0700f) * S;
            var nrm = new Vector3(s, 0.15f, 0.35f).Normalized();
            var e1 = nrm.Cross(Vector3.Up).Normalized();
            var e2 = nrm.Cross(e1).Normalized();
            float r = 0.0062f * S, rp = 0.0026f * S;
            for (int k = 0; k < 8; k++)
            {
                float a0 = k * MathF.Tau / 8, a1 = (k + 1) * MathF.Tau / 8;
                var o0 = centre + (e1 * MathF.Cos(a0) + e2 * MathF.Sin(a0)) * r;
                var o1 = centre + (e1 * MathF.Cos(a1) + e2 * MathF.Sin(a1)) * r;
                var i0 = centre + (e1 * MathF.Cos(a0) + e2 * MathF.Sin(a0)) * rp + nrm * 0.0006f;
                var i1 = centre + (e1 * MathF.Cos(a1) + e2 * MathF.Sin(a1)) * rp + nrm * 0.0006f;
                m.Tri(centre + nrm * 0.0008f, i0, i1, Black, Black, Black, nrm);
                m.Tri(i0, o0, o1, iris, iris, iris, nrm);
                m.Tri(i0, o1, i1, iris, iris, iris, nrm);
            }
            // (the gull's red-orange eye ring)
            if (!pig)
                for (int k = 0; k < 10; k++)
                {
                    float a0 = k * MathF.Tau / 10, a1 = (k + 1) * MathF.Tau / 10;
                    var ring = C(0.85f, 0.35f, 0.12f);
                    var o0 = centre + (e1 * MathF.Cos(a0) + e2 * MathF.Sin(a0)) * r * 1.35f - nrm * 0.0004f;
                    var o1 = centre + (e1 * MathF.Cos(a1) + e2 * MathF.Sin(a1)) * r * 1.35f - nrm * 0.0004f;
                    var i0 = centre + (e1 * MathF.Cos(a0) + e2 * MathF.Sin(a0)) * r;
                    var i1 = centre + (e1 * MathF.Cos(a1) + e2 * MathF.Sin(a1)) * r;
                    m.Tri(i0, o0, o1, ring, ring, ring, nrm);
                    m.Tri(i0, o1, i1, ring, ring, ring, nrm);
                }
        }
        return m;
    }

    /// <summary>An airfoil's top (up) or underside along the chord u 0..1 at thickness k.</summary>
    private static float Foil(float u, float k, bool top) => top
        ? k * (0.022f * MathF.Sqrt(u) * (1 - u) * 2.2f + 0.008f * MathF.Sin(MathF.PI * u))
        : k * (-0.004f * MathF.Sqrt(u) * (1 - u) * 2.2f + 0.006f * MathF.Sin(MathF.PI * u));

    private static readonly float[] ChordU = { 0, 0.04f, 0.12f, 0.25f, 0.42f, 0.6f, 0.76f, 0.88f, 0.95f, 1 };

    /// <summary>The arm: shoulder (0) to wrist (Arm) along s X; grey above with the white trailing edge, white below.</summary>
    private static Mk ArmMesh(bool pig, float s)
    {
        var m = new Mk();
        float L = pig ? 0.13f : 0.30f, S = pig ? 0.5f : 1;
        float[] xs = { 0, 0.07f, 0.17f, 0.30f, 0.43f, 0.55f, 0.66f, 0.76f, 0.85f, 0.93f, 1 };
        int rows = xs.Length, cols = ChordU.Length;
        foreach (bool top in new[] { true, false })
        {
            var p = new Vector3[rows * cols];
            var col = new Color[rows * cols];
            for (int j = 0; j < rows; j++)
            {
                float f = xs[j], x = f * L;
                float le = (0.035f - 0.02f * f) * S, te = (-0.165f + 0.02f * f + (j % 2 == 1 && f > 0.1f ? 0.007f : 0)) * S;
                float k = (1 - 0.45f * f) * S;
                for (int i = 0; i < cols; i++)
                {
                    float u = ChordU[i];
                    p[j * cols + i] = new Vector3(s * x, Foil(u, k, top), le + (te - le) * u);
                    Color cc;
                    if (pig) cc = top ? (u > 0.5f && u < 0.6f || u > 0.76f && u < 0.88f) && f > 0.3f ? PBar : PWing : PWing.Lerp(White, 0.4f);
                    else cc = top ? u > 0.86f ? White : u < 0.05f ? Mantle.Lerp(White, 0.35f) : Mantle : Under;
                    col[j * cols + i] = cc;
                }
            }
            m.Grid(p, col, rows, cols, false, (r, k) => top ? Vector3.Up : Vector3.Down);
        }
        return m;
    }

    /// <summary>The hand: wrist (0) to the pointed tip; grey, then black with the white mirrors and tips (the pigeon: grey to dark).</summary>
    private static Mk HandMesh(bool pig, float s)
    {
        var m = new Mk();
        float L = pig ? 0.17f : 0.40f, S = pig ? 0.5f : 1;
        float[] xs = { 0, 0.12f, 0.25f, 0.37f, 0.48f, 0.56f, 0.63f, 0.69f, 0.75f, 0.8f, 0.845f, 0.885f, 0.92f, 0.95f, 0.975f, 1 };
        int rows = xs.Length, cols = ChordU.Length;
        foreach (bool top in new[] { true, false })
        {
            var p = new Vector3[rows * cols];
            var col = new Color[rows * cols];
            for (int j = 0; j < rows; j++)
            {
                float f = xs[j], x = f * L;
                float le = (0.035f - 0.155f * MathF.Pow(f, 1.8f)) * S;
                float te = (-0.145f + 0.012f * f) * S;
                // the primaries' ends: a feather's tip, then the notch to the next
                if (f > 0.3f && j % 2 == 1) te += 0.012f * S * (1 - f * 0.5f);
                if (j == rows - 1) te = le - 0.002f * S;
                float k = (0.55f - 0.4f * f) * S;
                for (int i = 0; i < cols; i++)
                {
                    float u = ChordU[i];
                    p[j * cols + i] = new Vector3(s * x, Foil(u, k, top), le + (te - le) * u);
                    Color cc;
                    if (pig) cc = f > 0.55f ? (top ? PTip : PTip.Lerp(White, 0.2f)) : top ? PWing : PWing.Lerp(White, 0.4f);
                    else
                    {
                        bool black = f > 0.5f;
                        bool mirror = f > 0.82f && f < 0.93f && u > 0.25f && u < 0.8f;
                        bool tip = f > 0.5f && j % 2 == 0 && u > 0.9f;
                        cc = mirror || tip ? White : black ? (top ? Black : TipUnder) : top ? (u > 0.9f ? White.Lerp(Mantle, 0.4f) : Mantle) : Under;
                    }
                    col[j * cols + i] = cc;
                }
            }
            m.Grid(p, col, rows, cols, false, (r, k) => top ? Vector3.Up : Vector3.Down);
        }
        return m;
    }

    /// <summary>A leg from the hip joint: the feathered thigh in the body, the bare shank, the webbed foot (the pigeon's red toes).</summary>
    private static Mk LegMesh(bool pig)
    {
        var m = new Mk();
        float S = pig ? 0.52f : 1;
        var path = new[] { new Vector3(0, 0.02f, -0.004f), new Vector3(0, -0.035f, 0), new Vector3(0, -0.06f, 0.001f), new Vector3(0, -0.10f, 0.003f), new Vector3(0, -0.128f, 0.005f), new Vector3(0, -0.133f, 0.006f) };
        var w = new[] { 0.016f, 0.009f, 0.0046f, 0.0040f, 0.0042f, 0.0036f };
        for (int i = 0; i < path.Length; i++) { path[i] *= S; w[i] *= S * (pig ? 1.3f : 1); }
        var leg = pig ? PLeg : Pink;
        m.Loft(path, w, w, 8, 2.0f, (i, a, q) => i == 0 ? (pig ? PDark : Belly) : leg);
        // toes: three forward, webbed between them (the pigeon: three thin toes and one behind)
        var ank = new Vector3(0, -0.133f, 0.006f) * S;
        float y = ank.Y - 0.004f * S;
        var tips = new Vector3[3];
        float[] ang = { -0.45f, 0, 0.45f };
        float[] len = { 0.047f, 0.056f, 0.047f };
        for (int t = 0; t < 3; t++) tips[t] = new Vector3(MathF.Sin(ang[t]) * len[t] * S, y, ank.Z + MathF.Cos(ang[t]) * len[t] * S);
        var dn = leg.Lerp(Black, 0.15f);
        for (int t = 0; t < 3; t++)
        {
            // the toe: a thin ridge
            var dir = (tips[t] - ank).Normalized();
            var side = dir.Cross(Vector3.Up).Normalized() * 0.003f * S;
            var lift = Vector3.Up * 0.0035f * S;
            m.Tri(ank + side, tips[t], ank - side, leg, dn, leg, Vector3.Up);
            m.Tri(ank + lift, tips[t], ank + side, leg, dn, leg, side + lift);
            m.Tri(ank + lift, ank - side, tips[t], leg, leg, dn, -side + lift);
            // a dark claw
            m.Tri(tips[t] + side * 0.6f, tips[t] + dir * 0.006f * S - Vector3.Up * 0.002f * S, tips[t] - side * 0.6f, Black, Black, Black, Vector3.Up);
        }
        if (!pig)
            for (int t = 0; t < 2; t++)
            {
                // the web, a little slack between the toes
                var mid = (tips[t] + tips[t + 1]) * 0.5f;
                var sag = ank + (mid - ank) * 0.82f + Vector3.Down * 0.002f;
                m.Tri(ank, tips[t], sag, leg, leg, leg, Vector3.Up);
                m.Tri(ank, sag, tips[t + 1], leg, leg, leg, Vector3.Up);
                m.Tri(tips[t], tips[t + 1], sag, leg, leg, leg, Vector3.Up);
            }
        else
        {
            var back = ank + new Vector3(0, -0.004f, -0.028f) * S;
            var sd = Vector3.Right * 0.003f * S;
            m.Tri(ank + sd, back, ank - sd, leg, dn, leg, Vector3.Up);
        }
        return m;
    }
}
