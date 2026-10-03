using System;
using System.Collections.Generic;

namespace Scheldemist.Player;

/// <summary>
/// Vaulting: a short, checked lift and step over a railing, a ledge, a crate (the browser's shared/mantle.ts, line
/// by line). No unknown-height walls and no blind jumps over a drop, open water and a fall onto ground excepted.
/// </summary>
public static class Mantle
{
    public record struct Point(float X, float Y, float Z, bool Water = false, bool Fall = false);

    public interface IWorld
    {
        /// <summary>The highest top at (x, z) not above the ceiling.</summary>
        float Floor(float x, float z, float ceiling);
        /// <summary>A body with its feet at y fits here.</summary>
        bool Clear(float x, float y, float z);
        /// <summary>He can stand here with both feet.</summary>
        bool Stand(float x, float y, float z);
        /// <summary>The water's surface when he can drop in and swim there, else null.</summary>
        float? Water(float x, float z);
    }

    public const float Reach = 1.65f;
    /// <summary>The deepest drop into water a vault may end in (a quay wall at low tide).</summary>
    public const float WaterDrop = 6;
    /// <summary>The deepest drop onto ground a vault may end in.</summary>
    public const float FallDrop = 25;

    public static Point[]? Find(IWorld w, Point from, float dx, float dz, float @base)
    {
        float len = MathF.Sqrt(dx * dx + dz * dz);
        if (len < .01f) return null;
        dx /= len;
        dz /= len;
        float max = @base + Reach;
        bool ClearLine(Point a, Point b)
        {
            float dist = MathF.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y) + (b.Z - a.Z) * (b.Z - a.Z));
            int n = Math.Max(1, (int)MathF.Ceiling(dist / .12f));
            for (int i = 0; i <= n; i++)
            {
                float t = (float)i / n;
                if (!w.Clear(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t)) return false;
            }
            return true;
        }
        // the highest top on the way out to e metres
        float TopTo(float e)
        {
            float top = from.Y;
            for (float s = .2f; s <= e + 1e-6f; s += .12f)
            {
                float t = w.Floor(from.X + dx * s, from.Z + dz * s, max);
                if (float.IsFinite(t)) top = Math.Max(top, t);
            }
            return top;
        }
        for (float d = .45f; d <= 1.25f; d += .16f)
        {
            float x = from.X + dx * d, z = from.Z + dz * d, y = w.Floor(x, z, max);
            if (!float.IsFinite(y) || y < @base + .42f || y > max || !w.Clear(x, y + .06f, z)) continue;
            // Prefer stepping over a narrow obstacle; otherwise stand on its broad top.
            var candidates = new List<Point>();
            for (float e = d + .35f; e <= 2.6f; e += .15f)
            {
                float tx = from.X + dx * e, tz = from.Z + dz * e, ty = w.Floor(tx, tz, max);
                if (ty >= @base - .45f && ty < y - .3f && w.Stand(tx, ty, tz))
                {
                    candidates.Add(new Point(tx, ty, tz));
                    break;
                }
                if (ty < @base - .45f)
                {
                    // a jump carries him out from the quay's face: the first spots out over the water, nearest first
                    for (float f = e; f <= e + .9f; f += .3f)
                    {
                        float fx = from.X + dx * f, fz = from.Z + dz * f;
                        float? lv = w.Water(fx, fz);
                        if (lv != null && lv < @base - .3f && lv > @base - WaterDrop) candidates.Add(new Point(fx, lv.Value, fz, Water: true));
                    }
                    if (candidates.Count > 0) break;
                }
                // over the edge of a height onto ground below (it may hurt): only onto ground he can stand on
                if (ty < @base - .45f && ty > @base - FallDrop && w.Stand(tx, ty, tz))
                {
                    candidates.Add(new Point(tx, ty, tz, Fall: true));
                    break;
                }
            }
            if (w.Stand(x, y, z)) candidates.Add(new Point(x, y, z));
            foreach (var end in candidates)
            {
                float reach = MathF.Sqrt((end.X - from.X) * (end.X - from.X) + (end.Z - from.Z) * (end.Z - from.Z));
                float lift = Math.Min(max, Math.Max(y, TopTo(reach))) + .10f;
                var up = new Point(from.X, lift, from.Z);
                if (!ClearLine(from, up)) continue;
                var over = new Point(end.X, lift, end.Z);
                if (!ClearLine(up, over)) continue;
                // into the water: the drop must be free down to just over the surface (no boat, no pontoon)
                if (end.Water)
                {
                    if (ClearLine(over, new Point(end.X, end.Y + .3f, end.Z))) return new[] { up, over, end };
                    continue;
                }
                if (end.Fall)
                {
                    if (ClearLine(over, new Point(end.X, end.Y + .06f, end.Z))) return new[] { up, over, end };
                    continue;
                }
                if (ClearLine(over, end)) return new[] { up, over, end };
            }
        }
        return null;
    }
}
