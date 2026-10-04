using System;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// three.js's CatmullRomCurve3 ("centripetal") on the ground plan, with its arc length table (200 steps): the
/// browser's water routes and loops are these curves, so a boat at distance s is where the browser has it.
/// </summary>
public sealed class Spline
{
    public readonly Vector2[] Points;
    public readonly bool Closed;
    public readonly double Length;
    private readonly double[] arc;
    private const int Divisions = 200;

    public Spline((double X, double Z)[] pts, bool closed = false)
    {
        Points = new Vector2[pts.Length];
        for (int i = 0; i < pts.Length; i++) Points[i] = new Vector2((float)pts[i].X, (float)pts[i].Z);
        Closed = closed;
        arc = new double[Divisions + 1];
        var last = Point(0);
        double sum = 0;
        for (int p = 1; p <= Divisions; p++)
        {
            var cur = Point(p / (double)Divisions);
            sum += Math.Sqrt((cur.X - last.X) * (cur.X - last.X) + (cur.Z - last.Z) * (cur.Z - last.Z));
            arc[p] = sum;
            last = cur;
        }
        Length = sum;
    }

    private static double Cubic(double x0, double x1, double x2, double x3, double dt0, double dt1, double dt2, double t)
    {
        double t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
        double t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
        t1 *= dt1;
        t2 *= dt1;
        double c0 = x1, c1 = t1, c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
        return c0 + c1 * t + c2 * t * t + c3 * t * t * t;
    }

    /// <summary>The curve at parameter t (0..1, not even along its length).</summary>
    public (double X, double Z) Point(double t)
    {
        int l = Points.Length;
        double p = (l - (Closed ? 0 : 1)) * t;
        int ip = (int)Math.Floor(p);
        double w = p - ip;
        if (Closed) ip += ip > 0 ? 0 : (Math.Abs(ip) / l + 1) * l;
        else if (w == 0 && ip == l - 1)
        {
            ip = l - 2;
            w = 1;
        }
        (double X, double Z) P(int i) => (Points[i].X, Points[i].Y);
        (double X, double Z) p0, p1, p2, p3;
        if (Closed || ip > 0) p0 = P((ip - 1) % l);
        else p0 = (2 * (double)Points[0].X - Points[1].X, 2 * (double)Points[0].Y - Points[1].Y);
        p1 = P(ip % l);
        p2 = P((ip + 1) % l);
        if (Closed || ip + 2 < l) p3 = P((ip + 2) % l);
        else p3 = (2 * (double)Points[l - 1].X - Points[l - 2].X, 2 * (double)Points[l - 1].Y - Points[l - 2].Y);
        static double D(( double X, double Z) a, (double X, double Z) b) => Math.Pow((a.X - b.X) * (a.X - b.X) + (a.Z - b.Z) * (a.Z - b.Z), 0.25);
        double dt0 = D(p0, p1), dt1 = D(p1, p2), dt2 = D(p2, p3);
        if (dt1 < 1e-4) dt1 = 1.0;
        if (dt0 < 1e-4) dt0 = dt1;
        if (dt2 < 1e-4) dt2 = dt1;
        return (Cubic(p0.X, p1.X, p2.X, p3.X, dt0, dt1, dt2, w), Cubic(p0.Z, p1.Z, p2.Z, p3.Z, dt0, dt1, dt2, w));
    }

    /// <summary>three's getUtoTmapping: the parameter at the share u of the length.</summary>
    public double UtoT(double u)
    {
        int il = arc.Length;
        double target = u * arc[il - 1];
        int low = 0, high = il - 1, i;
        while (low <= high)
        {
            i = low + (high - low) / 2;
            double cmp = arc[i] - target;
            if (cmp < 0) low = i + 1;
            else if (cmp > 0) high = i - 1;
            else
            {
                high = i;
                break;
            }
        }
        i = Math.Max(0, high);
        if (arc[i] == target) return i / (double)(il - 1);
        double before = arc[i], after = arc[Math.Min(il - 1, i + 1)];
        double frac = after > before ? (target - before) / (after - before) : 0;
        return (i + frac) / (il - 1);
    }

    /// <summary>The point at the share u (0..1) of the length.</summary>
    public (double X, double Z) PointAt(double u) => Point(UtoT(u));

    /// <summary>The direction at the share u of the length (a unit vector).</summary>
    public (double X, double Z) TangentAt(double u)
    {
        double t = UtoT(u);
        double t1 = Math.Max(0, t - 0.0001), t2 = Math.Min(1, t + 0.0001);
        var a = Point(t1);
        var b = Point(t2);
        double dx = b.X - a.X, dz = b.Z - a.Z, l = Math.Sqrt(dx * dx + dz * dz);
        return l > 0 ? (dx / l, dz / l) : (0, 1);
    }
}

/// <summary>
/// A water route for moving boats (the browser's world/route.ts Route): a smoothed line through (x, z) points; a
/// boat at distance s from its start, heading along it.
/// </summary>
public sealed class Route
{
    public readonly Spline Curve;
    public double Length => Curve.Length;

    public Route((double X, double Z)[] pts) => Curve = new Spline(pts);

    /// <summary>Place and heading at distance s from the start; dir +1: travelling toward the end.</summary>
    public (double X, double Z, double Yaw) Pose(double s, int dir)
    {
        double u = Mv.Clamp(s / Length, 0, 1);
        var p = Curve.PointAt(u);
        var t = Curve.TangentAt(u);
        return (p.X, p.Z, Math.Atan2(t.X * dir, t.Z * dir));
    }

    /// <summary>Distances along the route where it is inside a rectangle (grown by pad): enter and leave, or null.</summary>
    public (double A, double B)? Span(double minX, double maxX, double minZ, double maxZ, double pad = 0, int steps = 600)
    {
        double a = -1, b = -1;
        for (int i = 0; i <= steps; i++)
        {
            var p = Curve.PointAt(i / (double)steps);
            if (p.X > minX - pad && p.X < maxX + pad && p.Z > minZ - pad && p.Z < maxZ + pad)
            {
                double s = i / (double)steps * Length;
                if (a < 0) a = s;
                b = s;
            }
        }
        return a < 0 ? null : (a, b);
    }
}
