using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// Copies of one mesh that a mover writes every frame (the browser's InstancedMesh): the bake's MultiMesh, written
/// as one buffer. Put is three's compose of a place, an Euler "YXZ" turn (pitch, yaw, roll) and a scale.
/// </summary>
public sealed class Copies
{
    public readonly MultiMesh Mm;
    public readonly MultiMeshInstance3D Node;
    private float[] buf;
    private readonly int stride;
    private bool dirty;
    public int Count => Mm.InstanceCount;

    public Copies(MultiMeshInstance3D node, int atLeast = 0)
    {
        Node = node;
        Mm = node.Multimesh;
        if (Mm.InstanceCount < atLeast) Mm.InstanceCount = atLeast;
        stride = 12 + (Mm.UseColors ? 4 : 0) + (Mm.UseCustomData ? 4 : 0);
        buf = Mm.InstanceCount > 0 ? Mm.Buffer : Array.Empty<float>();
        if (buf.Length != Mm.InstanceCount * stride) buf = new float[Mm.InstanceCount * stride];
        if (Mm.UseColors)
            for (int i = 0; i < Mm.InstanceCount; i++)
                if (buf[i * stride + 12] == 0 && buf[i * stride + 13] == 0 && buf[i * stride + 14] == 0 && buf[i * stride + 15] == 0)
                    buf[i * stride + 12] = buf[i * stride + 13] = buf[i * stride + 14] = buf[i * stride + 15] = 1;
        // written anywhere in town: no fixed box for the culler (the browser's frustumCulled = false)
        node.ExtraCullMargin = 4000;
        node.Visible = true;
    }

    /// <summary>The copies under `group` whose baked name ends in this (INST153_wagonwheels_mm: "wagonwheels").</summary>
    public static Copies? Find(Node group, string name, int atLeast = 0)
    {
        foreach (var c in group.GetChildren())
            if (c is MultiMeshInstance3D mmi && mmi.Multimesh != null)
            {
                string n = mmi.Name.ToString();
                int u = n.IndexOf('_');
                if (n.StartsWith("INST") && u > 0 && n.EndsWith("_mm") && n[(u + 1)..^3] == name) return new Copies(mmi, atLeast);
            }
        return null;
    }

    public void Set(int i, in Transform3D x)
    {
        if (i < 0 || i >= Mm.InstanceCount) return;
        int o = i * stride;
        buf[o] = x.Basis.X.X; buf[o + 1] = x.Basis.Y.X; buf[o + 2] = x.Basis.Z.X; buf[o + 3] = x.Origin.X;
        buf[o + 4] = x.Basis.X.Y; buf[o + 5] = x.Basis.Y.Y; buf[o + 6] = x.Basis.Z.Y; buf[o + 7] = x.Origin.Y;
        buf[o + 8] = x.Basis.X.Z; buf[o + 9] = x.Basis.Y.Z; buf[o + 10] = x.Basis.Z.Z; buf[o + 11] = x.Origin.Z;
        dirty = true;
    }

    public void Put(int i, float x, float y, float z, float yaw, float pitch = 0, float sx = 1, float sy = 1, float sz = 1, float roll = 0)
    {
        var b = new Basis(Vector3.Up, yaw);
        if (pitch != 0) b *= new Basis(Vector3.Right, pitch);
        if (roll != 0) b *= new Basis(Vector3.Back, roll);
        if (sx != 1 || sy != 1 || sz != 1) b = b.Scaled(Vector3.One) * Basis.FromScale(new Vector3(sx, sy, sz));
        Set(i, new Transform3D(b, new Vector3(x, y, z)));
    }

    /// <summary>A piece from a to b: the mesh's +z along it, stretched to its length (railway.ts linkBetween).</summary>
    public void Between(int i, Vector3 a, Vector3 b, float thick = 1)
    {
        var d = b - a;
        float len = Math.Max(0.05f, d.Length());
        var q = new Quaternion(Vector3.Back, d.Normalized());
        Set(i, new Transform3D(new Basis(q) * Basis.FromScale(new Vector3(thick, thick, len)), (a + b) / 2));
    }

    /// <summary>Copy i is not drawn (scale 0).</summary>
    public void Zero(int i)
    {
        if (i < 0 || i >= Mm.InstanceCount) return;
        int o = i * stride;
        if (buf[o] == 0 && buf[o + 5] == 0 && buf[o + 10] == 0 && buf[o + 1] == 0 && buf[o + 2] == 0) return;
        for (int k = 0; k < 12; k++) buf[o + k] = 0;
        dirty = true;
    }

    public void ZeroAll()
    {
        for (int i = 0; i < Mm.InstanceCount; i++) Zero(i);
    }

    public void Commit()
    {
        if (!dirty || buf.Length == 0) return;
        dirty = false;
        RenderingServer.MultimeshSetBuffer(Mm.GetRid(), buf);
    }

    public void Tint(int i, Color color)
    {
        if (!Mm.UseColors || i<0 || i>=Count) return;
        int o=i*stride+12;
        buf[o]=color.R; buf[o+1]=color.G; buf[o+2]=color.B; buf[o+3]=color.A;
        dirty=true;
    }
}

/// <summary>
/// The horse's walk and trot (the browser's world/horseGait.ts, same numbers): where the four hooves go through a
/// step, each leg solved from its hoof (a knee or a hock), the body's height smooth through the cycle.
/// </summary>
public static class HorseGait
{
    private sealed class Rig
    {
        public float X, Pz, Py, Jz, Jy, Sz, Toe = 0.11f, Heel = 0.08f, L1, L2, Rest1, Rest2, Bend;
        public Rig(float x, float pz, float py, float jz, float jy, float sole, float bend)
        {
            X = x; Pz = pz; Py = py; Jz = jz; Jy = jy; Sz = sole; Bend = bend;
            L1 = MathF.Sqrt((jz - pz) * (jz - pz) + (jy - py) * (jy - py));
            L2 = MathF.Sqrt((sole - jz) * (sole - jz) + jy * jy);
            Rest1 = MathF.Atan2(jz - pz, py - jy);
            Rest2 = MathF.Atan2(sole - jz, jy);
        }
    }

    private static readonly Rig Front = new(0.19f, 0.62f, 1.4f, 0.645f, 0.5f, 0.67f, 1);
    private static readonly Rig Hind = new(0.2f, -0.62f, 1.38f, -0.76f, 0.58f, -0.67f, -1);
    private static readonly (Rig Rig, int Side, float Walk, float Trot)[] Legs = { (Front, 1, 0.25f, 0), (Front, -1, 0.75f, 0.5f), (Hind, 1, 0, 0.5f), (Hind, -1, 0.5f, 0) };
    private static readonly (float Stance, float LiftF, float LiftH, float Body) Walk = (0.62f, 0.16f, 0.12f, 0), Trot = (0.38f, 0.26f, 0.2f, 0.03f);
    public const float WalkStride = 1.42f, TrotStride = 2.8f;

    public struct LegPose
    {
        public float X, Uy, Uz, Up, Ly, Lz, Lp;
    }

    public sealed class Pose
    {
        public float Bob;
        public readonly LegPose[] Legs = new LegPose[4];
    }

    private static float ikA1, ikJz, ikJy, ikA2;
    private static void Solve(Rig r, float py, float tz, float ty)
    {
        float dz = tz - r.Pz, dy = ty - py;
        float D = Math.Min(Math.Max(MathF.Sqrt(dz * dz + dy * dy), Math.Abs(r.L1 - r.L2) + 1e-4f), r.L1 + r.L2 - 1e-5f);
        float a = MathF.Acos(Math.Clamp((r.L1 * r.L1 + D * D - r.L2 * r.L2) / (2 * r.L1 * D), -1, 1));
        ikA1 = MathF.Atan2(dz, -dy) + r.Bend * a;
        ikJz = r.Pz + r.L1 * MathF.Sin(ikA1);
        ikJy = py - r.L1 * MathF.Cos(ikA1);
        ikA2 = MathF.Atan2(tz - ikJz, ikJy - ty);
    }

    private static readonly float[] tz = new float[4], ty = new float[4], tw = new float[4];

    private static float Reach(float gait, float amp, bool trot, float? stride)
    {
        var g = trot ? Trot : Walk;
        float S = (stride ?? (trot ? TrotStride : WalkStride)) * g.Stance * amp;
        for (int k = 0; k < 4; k++)
        {
            var L = Legs[k];
            float p = ((gait + (trot ? L.Trot : L.Walk)) % 1 + 1) % 1;
            float n = L.Rig.Sz;
            if (p < g.Stance)
            {
                tz[k] = n + S * (0.5f - p / g.Stance);
                ty[k] = 0;
                tw[k] = 1;
            }
            else
            {
                float q = (p - g.Stance) / (1 - g.Stance);
                tz[k] = n - S / 2 + S * q * q * (3 - 2 * q);
                ty[k] = (L.Rig == Front ? g.LiftF : g.LiftH) * amp * MathF.Sin(MathF.PI * q);
                tw[k] = Math.Max(0, Math.Max(1 - q / 0.14f, (q - 0.86f) / 0.14f));
            }
        }
        float off = g.Body * amp;
        for (int k = 0; k < 4; k++)
        {
            var L = Legs[k];
            Solve(L.Rig, L.Rig.Py + off, tz[k], ty[k]);
            float d = ikA2 - L.Rig.Rest2;
            ty[k] += (d > 0 ? L.Rig.Heel : L.Rig.Toe) * MathF.Sin(Math.Abs(d)) * tw[k];
        }
        for (int k = 0; k < 4; k++)
        {
            var L = Legs[k];
            float Lr = (L.Rig.L1 + L.Rig.L2) * 0.9995f;
            float dz = tz[k] - L.Rig.Pz;
            float c = MathF.Sqrt(Math.Max(0, Lr * Lr - dz * dz)) - L.Rig.Py + ty[k];
            off = Math.Min(off, c + (1 - tw[k]) * 0.5f);
        }
        return off;
    }

    private const int BobN = 240, BobW = BobN / 8, AmpSteps = 10;
    private static readonly Dictionary<long, float[]> bobCache = new();

    private static float[] BobCurve(bool trot, int a, float? stride)
    {
        long key = (trot ? 1L : 0) | ((long)a << 1) | ((long)(stride == null ? 0 : (int)MathF.Round(stride.Value * 50) + 1) << 8);
        if (bobCache.TryGetValue(key, out var c)) return c;
        float amp = a / (float)AmpSteps;
        float? st = stride == null ? null : MathF.Round(stride.Value * 50) / 50;
        var env = new float[BobN];
        for (int i = 0; i < BobN; i++) env[i] = Reach(i / (float)BobN, amp, trot, st);
        var low = new float[BobN];
        for (int i = 0; i < BobN; i++)
        {
            float m = float.MaxValue;
            for (int d = -BobW; d <= BobW; d++) m = Math.Min(m, env[(i + d + BobN) % BobN]);
            low[i] = m;
        }
        float[] Blur(float[] src, int r)
        {
            var o = new float[BobN];
            for (int i = 0; i < BobN; i++)
            {
                float s = 0;
                for (int d = -r; d <= r; d++) s += src[(i + d + BobN) % BobN];
                o[i] = s / (2 * r + 1);
            }
            return o;
        }
        c = Blur(Blur(low, BobW / 2), BobW / 2);
        bobCache[key] = c;
        return c;
    }

    private static float SmoothBob(float gait, float amp, bool trot, float? stride)
    {
        float x = Math.Clamp(amp, 0, 1) * AmpSteps;
        int a0 = (int)MathF.Floor(x), a1 = Math.Min(a0 + 1, AmpSteps);
        float t = x - a0;
        float u = ((gait % 1 + 1) % 1) * BobN % BobN;
        int i0 = (int)MathF.Floor(u) % BobN, i1 = (i0 + 1) % BobN;
        float f = u - MathF.Floor(u);
        float At(int a)
        {
            var c = BobCurve(trot, a, stride);
            return c[i0] + (c[i1] - c[i0]) * f;
        }
        float v0 = At(a0);
        return v0 + (At(a1) - v0) * t;
    }

    private static float BodyAt(float gait, float amp, bool trot, float? stride)
    {
        float wave = SmoothBob(gait, amp, trot, stride);
        return Math.Min(wave, Reach(gait, amp, trot, stride));
    }

    private static readonly float[] wz = new float[4], wy = new float[4];

    /// <summary>The pose at `gait` 0..1 through the step cycle, `amp` 0 (standing) .. 1 (full stride); `mix` 0 walk .. 1 trot.</summary>
    public static Pose PoseAt(Pose o, float gait, float amp, float mix = 0, float? stride = null)
    {
        float m = Math.Clamp(mix, 0, 1), off;
        if (m <= 0) off = BodyAt(gait, amp, false, stride);
        else if (m >= 1) off = BodyAt(gait, amp, true, stride);
        else
        {
            float offW = BodyAt(gait, amp, false, null);
            for (int k = 0; k < 4; k++)
            {
                wz[k] = tz[k];
                wy[k] = ty[k];
            }
            float offT = BodyAt(gait, amp, true, stride);
            float e = m * m * (3 - 2 * m);
            for (int k = 0; k < 4; k++)
            {
                tz[k] = wz[k] + (tz[k] - wz[k]) * e;
                ty[k] = wy[k] + (ty[k] - wy[k]) * e;
            }
            off = offW + (offT - offW) * e;
        }
        o.Bob = off;
        for (int k = 0; k < 4; k++)
        {
            var L = Legs[k];
            Solve(L.Rig, L.Rig.Py + off, tz[k], ty[k]);
            o.Legs[k] = new LegPose { X = L.Side * L.Rig.X, Uy = L.Rig.Py + off, Uz = L.Rig.Pz, Up = -(ikA1 - L.Rig.Rest1), Ly = ikJy, Lz = ikJz, Lp = -(ikA2 - L.Rig.Rest2) };
        }
        return o;
    }
}

/// <summary>
/// Horses for the quay railway and the omnibuses (the browser's world/horses.ts HorsePool): all horses of the pool
/// in five sets of copies (the body and the four leg parts, each leg split at the knee or hock), in the bake's
/// "horses" group. A four-beat walk or a trot.
/// </summary>
[GamePart(35)]
public partial class HorsePool : Node
{
    public static HorsePool I { get; private set; } = null!;
    private const float TrotEase = 0.5f;
    private Copies? body;
    private readonly Copies?[] legs = new Copies?[4];
    private readonly HorseGait.Pose pose = new();
    private float[] bobs = Array.Empty<float>(), mixes = Array.Empty<float>();
    private double[] setAt = Array.Empty<double>();
    public int Count { get; private set; }
    public bool Ok => body != null;

    public override void _Ready()
    {
        I = this;
        var g = Mv.Top("horses");
        if (g == null) return;
        body = Copies.Find(g, "horsebody");
        string[] names = { "horselegfront", "horselegfrontlo", "horseleghind", "horseleghindlo" };
        for (int i = 0; i < 4; i++) legs[i] = Copies.Find(g, names[i]);
        Count = body?.Count ?? 0;
        bobs = new float[Count];
        mixes = new float[Count];
        setAt = new double[Count];
        Array.Fill(setAt, -1);
        for (int i = 0; i < Count; i++) Hide(i);
        Commit();
        ProcessPriority = 50; // after the train and the omnibuses have set their horses
        GD.Print($"horses: a pool of {Count}");
    }

    /// <summary>Horse i at (x, z) looking along yaw (0 = +z), `gait` 0..1 through its step, `amp` 0 standing .. 1 full stride.</summary>
    public void Set(int i, float x, float z, float yaw, float gait, float amp, bool trot = false, float? stride = null, float y = 0)
    {
        if (body == null || i < 0 || i >= Count) return;
        double now = MoverClock.T;
        double since = now - setAt[i];
        setAt[i] = now;
        float want = trot ? 1 : 0;
        if (since < 0 || since > 0.5) mixes[i] = want;
        else mixes[i] += Math.Sign(want - mixes[i]) * Math.Min(Math.Abs(want - mixes[i]), (float)since / TrotEase);
        float mix = mixes[i];
        HorseGait.PoseAt(pose, gait, amp, mix, mix <= 0 || mix >= 1 || trot ? stride : null);
        bobs[i] = pose.Bob;
        body.Put(i, x, y + pose.Bob, z, yaw);
        float cy = MathF.Cos(yaw), sy = MathF.Sin(yaw);
        for (int k = 0; k < 4; k++)
        {
            var L = pose.Legs[k];
            int j = i * 2 + k % 2;
            int up = k < 2 ? 0 : 2;
            legs[up]?.Put(j, x + L.X * cy + L.Uz * sy, y + L.Uy, z - L.X * sy + L.Uz * cy, yaw, L.Up);
            legs[up + 1]?.Put(j, x + L.X * cy + L.Lz * sy, y + L.Ly, z - L.X * sy + L.Lz * cy, yaw, L.Lp);
        }
    }

    /// <summary>Horse i's body height over the ground (as last set).</summary>
    public float Bob(int i) => i >= 0 && i < Count ? bobs[i] : 0;

    public void Hide(int i)
    {
        body?.Zero(i);
        foreach (var m in legs)
        {
            m?.Zero(i * 2);
            m?.Zero(i * 2 + 1);
        }
    }

    public void Commit()
    {
        body?.Commit();
        foreach (var m in legs) m?.Commit();
    }

    public override void _Process(double delta)
    {
        MoverCost.Begin("horse_buffers"); Commit(); MoverCost.End("horse_buffers");
    }
}
