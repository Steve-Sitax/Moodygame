using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// Portal cranes that do not run into each other: the browser's shared/cranes.ts, the same numbers. Pure geometry: a
/// crane is a handful of capsules (a segment with a radius): the jib, the hoist fall with its hook and load, the
/// turning deck and cabin, the portal's top and its four legs. Before a crane slews, hoists or travels, the railway
/// puts the crane where the step would leave it and asks for the room to every other crane; the step is taken only
/// if it keeps the margin, or at least does not make things worse.
/// </summary>
public static class CraneGeo
{
    public const double JibGap = 1.0, PortalGap = 2.0, PortalTop = 5.8;
    private const double JibHeelR = 1.65, JibHeelY = PortalTop + 0.7, JibEndR = 11.6, JibR = 0.55;
    private static readonly double JibSlope = Math.Tan(40 * Math.PI / 180);
    public const double HookR = 11.51, TipY = PortalTop + 8.62;
    private const double BodyY0 = 6.6, BodyY1 = 9.4, BodyR = 2.2, DeckY = 6.4, DeckR = 3.0, LegR = 0.75, PortalTopR = 1.6;
    private static readonly double[][] LegsAt = { new[] { 2.2, 2.6, 1.15, 2.35 }, new[] { -2.2, 2.6, -1.15, 2.35 }, new[] { 2.2, -2.6, 1.15, -2.35 }, new[] { -2.2, -2.6, -1.15, -2.35 } };
    public const double PortalHalfX = 2.95, PortalHalfZ = 2.9;
    public const double Reach = 2 * (JibEndR + 1) + JibGap;

    /// <summary>0 jib, 1 fall, 2 body, 3 deck (they turn); 4 portal, 5 leg, 6 mast, 7 car.</summary>
    public struct Capsule
    {
        public double Ax, Ay, Az, Bx, By, Bz, R;
        public int Kind;
        public Capsule(double ax, double ay, double az, double bx, double by, double bz, double r, int kind)
        {
            Ax = ax; Ay = ay; Az = az; Bx = bx; By = by; Bz = bz; R = r; Kind = kind;
        }
    }

    public struct Pose
    {
        public double X, Z, Yaw, A, Hy, Load;
    }

    public static double JibY(double r) => JibHeelY + (Math.Max(r, JibHeelR) - JibHeelR) * JibSlope;

    /// <summary>The crane's parts in the world: jib, fall, body, deck (they turn), portal top and legs (they do not).</summary>
    public static void Parts(in Pose p, Capsule[] o)
    {
        double h = p.Yaw + p.A, s = Math.Sin(h), c = Math.Cos(h), co = Math.Cos(p.Yaw), si = Math.Sin(p.Yaw);
        double X = p.X, Z = p.Z;
        double Wx(double lx, double lz) => X + lx * co + lz * si;
        double Wz(double lx, double lz) => Z - lx * si + lz * co;
        o[0] = new Capsule(X + s * JibHeelR, JibHeelY, Z + c * JibHeelR, X + s * JibEndR, JibY(JibEndR), Z + c * JibEndR, JibR, 0);
        o[1] = new Capsule(X + s * HookR, p.Hy - p.Load, Z + c * HookR, X + s * HookR, TipY, Z + c * HookR, p.Load > 0 ? 0.75 : 0.35, 1);
        o[2] = new Capsule(X, BodyY0, Z, X, BodyY1, Z, BodyR, 2);
        o[3] = new Capsule(X, DeckY, Z, X, DeckY, Z, DeckR, 3);
        o[4] = new Capsule(Wx(0, -2.5), PortalTop - 0.5, Wz(0, -2.5), Wx(0, 2.5), PortalTop - 0.5, Wz(0, 2.5), PortalTopR, 4);
        for (int i = 0; i < 4; i++)
        {
            var l = LegsAt[i];
            o[5 + i] = new Capsule(Wx(l[0], l[1]), 0.55, Wz(l[0], l[1]), Wx(l[2], l[3]), PortalTop - 0.7, Wz(l[2], l[3]), LegR, 5);
        }
    }

    public const int PartCount = 9;
    private static bool Turns(int k) => k <= 3;
    private static double C01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

    /// <summary>The shortest distance between two segments in 3D (a point is a segment of length 0).</summary>
    public static double SegDist(in Capsule p, in Capsule q)
    {
        double d1x = p.Bx - p.Ax, d1y = p.By - p.Ay, d1z = p.Bz - p.Az;
        double d2x = q.Bx - q.Ax, d2y = q.By - q.Ay, d2z = q.Bz - q.Az;
        double rx = p.Ax - q.Ax, ry = p.Ay - q.Ay, rz = p.Az - q.Az;
        double a = d1x * d1x + d1y * d1y + d1z * d1z;
        double e = d2x * d2x + d2y * d2y + d2z * d2z;
        double f = d2x * rx + d2y * ry + d2z * rz;
        double s, t;
        if (a < 1e-9 && e < 1e-9) s = t = 0;
        else if (a < 1e-9)
        {
            s = 0;
            t = C01(f / e);
        }
        else
        {
            double c = d1x * rx + d1y * ry + d1z * rz;
            if (e < 1e-9)
            {
                t = 0;
                s = C01(-c / a);
            }
            else
            {
                double b = d1x * d2x + d1y * d2y + d1z * d2z;
                double den = a * e - b * b;
                s = den > 1e-9 ? C01((b * f - c * e) / den) : 0;
                t = (b * s + f) / e;
                if (t < 0)
                {
                    t = 0;
                    s = C01(-c / a);
                }
                else if (t > 1)
                {
                    t = 1;
                    s = C01((b - c) / a);
                }
            }
        }
        double dx = rx + d1x * s - d2x * t, dy = ry + d1y * s - d2y * t, dz = rz + d1z * s - d2z * t;
        return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }

    /// <summary>The free room between two cranes: every pair of parts where at least one turns with the slew.</summary>
    public static double CraneGap(Capsule[] a, Capsule[] b)
    {
        double gap = double.PositiveInfinity;
        for (int i = 0; i < PartCount; i++)
            for (int j = 0; j < PartCount; j++)
            {
                if (!Turns(a[i].Kind) && !Turns(b[j].Kind)) continue;
                double g = SegDist(a[i], b[j]) - a[i].R - b[j].R;
                if (g < gap) gap = g;
            }
        return gap;
    }

    /// <summary>The free room between a crane's jib and fall and some other things (the train's cars).</summary>
    public static double ThingsGap(Capsule[] a, List<Capsule> things)
    {
        double gap = double.PositiveInfinity;
        for (int i = 0; i < 2; i++)
            foreach (var q in things)
            {
                double g = SegDist(a[i], q) - a[i].R - q.R;
                if (g < gap) gap = g;
            }
        return gap;
    }

    /// <summary>The free room between two portals in plan: their footprints (yaws are quarter turns).</summary>
    public static double PortalRoom(in Pose a, in Pose b)
    {
        static (double, double) Ext(in Pose p)
        {
            double c = Math.Abs(Math.Cos(p.Yaw)), s = Math.Abs(Math.Sin(p.Yaw));
            return (PortalHalfX * c + PortalHalfZ * s, PortalHalfX * s + PortalHalfZ * c);
        }
        var (ax, az) = Ext(a);
        var (bx, bz) = Ext(b);
        double gx = Math.Abs(a.X - b.X) - ax - bx, gz = Math.Abs(a.Z - b.Z) - az - bz;
        if (gx > 0 && gz > 0) return Math.Sqrt(gx * gx + gz * gz);
        return Math.Max(gx, gz);
    }

    /// <summary>A goods wagon (or a horse) as a capsule along its length at (x, z) facing yaw.</summary>
    public static Capsule Car(double x, double z, double yaw, double half, double y, double r)
    {
        double s = Math.Sin(yaw) * half, c = Math.Cos(yaw) * half;
        return new Capsule(x - s, y, z - c, x + s, y, z + c, r, 7);
    }

    /// <summary>a - b, wrapped to -pi..pi.</summary>
    public static double AngDiff(double a, double b)
    {
        double d = (a - b) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        return d;
    }
}
