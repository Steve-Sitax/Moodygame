using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Player;

/// <summary>
/// A smooth move through key points (2026-10-11, Steve: "not a smooth transition"; "it seems scripted"): one curve
/// through all of them (a cubic Hermite spline in time), so the body never stops at a key and never jumps. It starts
/// with the speed he had (a run into a vault, a climb up the rungs) and ends with the speed given (none: he comes to
/// rest). The corners are rounded by the tangents, a little short of a Catmull-Rom's so a lift over a rail stays a
/// lift and does not cut through the rail.
/// </summary>
public sealed class Glide
{
    private readonly Vector3[] p, m;
    private readonly float[] t;
    public float Duration => t[^1];
    public int Count => p.Length;

    /// <param name="from">Where he is now.</param>
    /// <param name="keys">The points and the seconds to each from the last.</param>
    /// <param name="v0">His speed now (m/s).</param>
    /// <param name="v1">His speed at the end.</param>
    /// <param name="round">How round the corners are: 1 a Catmull-Rom spline, 0 a stop at each key.</param>
    /// <param name="maxSpeed">No part of the move faster than this (m/s): a key too far for its seconds gets more.</param>
    public Glide(Vector3 from, IReadOnlyList<(Vector3 p, float dur)> keys, Vector3 v0 = default, Vector3 v1 = default, float round = 0.8f, float maxSpeed = float.PositiveInfinity)
    {
        int n = keys.Count + 1;
        p = new Vector3[n];
        m = new Vector3[n];
        t = new float[n];
        p[0] = from;
        for (int i = 1; i < n; i++)
        {
            p[i] = keys[i - 1].p;
            // a smooth step's top speed is about 1.5 times its mean
            float need = 1.5f * p[i].DistanceTo(p[i - 1]) / maxSpeed;
            t[i] = t[i - 1] + Math.Max(Math.Max(0.02f, keys[i - 1].dur), need);
        }
        m[0] = v0;
        m[n - 1] = v1;
        for (int i = 1; i < n - 1; i++)
        {
            var a = (p[i] - p[i - 1]) / (t[i] - t[i - 1]);
            var b = (p[i + 1] - p[i]) / (t[i + 1] - t[i]);
            // no overshoot where the way turns back on itself in height (up onto a rail, then down)
            var mid = (a + b) * 0.5f * round;
            if (a.Y * b.Y <= 0) mid.Y = 0;
            m[i] = mid;
        }
    }

    /// <summary>The segment at time s: its index and the fraction through it.</summary>
    private (int i, float u, float h) Seg(float s)
    {
        s = Math.Clamp(s, 0, Duration);
        int i = 0;
        while (i < t.Length - 2 && s > t[i + 1]) i++;
        float h = t[i + 1] - t[i];
        return (i, h > 0 ? (s - t[i]) / h : 1, h);
    }

    public Vector3 At(float s)
    {
        var (i, u, h) = Seg(s);
        float u2 = u * u, u3 = u2 * u;
        float h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        return p[i] * h00 + m[i] * (h10 * h) + p[i + 1] * h01 + m[i + 1] * (h11 * h);
    }

    public Vector3 Velocity(float s)
    {
        var (i, u, h) = Seg(s);
        float u2 = u * u;
        float d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
        return (p[i] * d00 + p[i + 1] * d01) / h + m[i] * d10 + m[i + 1] * d11;
    }

    /// <summary>Which key he is heading for at time s (0: the first).</summary>
    public int KeyAt(float s) => Seg(s).i;
}
