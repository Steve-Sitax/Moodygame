using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Town;

/// <summary>Short windows of an authored native route when a doorway or a long detour does not fit the crowd's 1m grid.</summary>
public sealed class NativeCrowdRoute
{
    public const float WindowLength = 32;
    /// <summary>A roomy street for a handcart: free this far all round (WalkMap.WideOpen; it just fits at 0.78 m), and what a
    /// half-metre cell that is not costs the cart's way over its length, in cells: a roomy way up to three times as long is taken first.</summary>
    private const double RoomyRadius = 1.1;
    private const float TightCost = 2;
    private readonly WalkMap map;
    private List<Vector2>? way;
    private Vector2 goal;
    private int next;
    private bool wideWay;
    public int Searches { get; private set; }

    public NativeCrowdRoute(WalkMap map) { this.map = map; }

    public void Clear() { way = null; next = 0; }

    /// <summary>The static route is cached; live bodies, bridge gates and vehicle clearance still govern every actual step.</summary>
    /// <summary>`roundStanding`: plan afresh, round the ground live standing bodies hold (a parked cart across a lane, issue 120).
    /// `wide`: a pushed handcart's way, through streets with room for the cart (WalkMap.WideOpen), or the ordinary way when
    /// there is none (#196: the narrow lanes west of the Grote Markt, where a cart went to and fro).</summary>
    public bool Window(Vector2 from, Vector2 to, List<(double x, double z)> output, bool roundStanding = false, bool wide = false)
    {
        using var cost = Scheldemist.Dev.FrameCost.Track("Crowd.NativeRoute");
        output.Clear();
        if (!map.IsNative) return false;
        if (roundStanding || way == null || wide != wideWay || goal.DistanceSquaredTo(to) > .25f || !Advance(from)) {
            Func<double, double, bool>? taken = roundStanding ? (x, z) => !map.NoStandingBody(x, z) : null;
            Searches++; goal = to; next = 0; wideWay = wide; way = null;
            // (within 3 m of its ends the cart may stand where it is or where it goes: by a door, at a stall)
            // (and keeps to roomy streets: through a gap that just lets a cart by, between a gas lamp and a crate stack west of the
            // Grote Markt, the carts going home bent round in an S, slowly, one behind the other, while the street beside it was free, #197)
            if (wide) way = Ways.NativePath(map, from, to, (x, z) => !map.WideOpen(x, z) && from.DistanceSquaredTo(new((float)x, (float)z)) > 9 && to.DistanceSquaredTo(new((float)x, (float)z)) > 9 || taken?.Invoke(x, z) == true,
                (x, z) => from.DistanceSquaredTo(new((float)x, (float)z)) > 9 && to.DistanceSquaredTo(new((float)x, (float)z)) > 9 && !map.WideOpen(x, z, RoomyRadius) ? TightCost : 0);
            if (way is not { Count: > 0 }) way = Ways.NativePath(map, from, to, taken);
            if (way == null || way.Count == 0) return false;
            // Nearest-cell snapping must never move a body across a wall or a ledge.
            if (!map.SupportsStep(from.X, from.Y, way[0].X, way[0].Y)) { Clear(); return false; }
            if (map.SupportsStep(way[^1].X, way[^1].Y, to.X, to.Y) && way[^1].DistanceSquaredTo(to) > .001f) way.Add(to);
        }
        while (next + 1 < way.Count && from.DistanceSquaredTo(way[next]) < .25f
            && map.SupportsStep(from.X, from.Y, way[next + 1].X, way[next + 1].Y)) next++;
        float left = WindowLength; var at = from;
        for (int i = next; i < way.Count; i++) {
            var point = way[i]; float length = at.DistanceTo(point);
            if (length > left) { point = at.Lerp(point, left / length); output.Add((point.X, point.Y)); break; }
            if (length > .01f) output.Add((point.X, point.Y));
            left -= length; at = point;
            if (left < .01f) break;
        }
        return output.Count > 0;
    }

    /// <summary>The way still to go along the cached route from a point on it (metres), or null without one to that goal: progress on a way
    /// round, where the straight distance first grows (#196).</summary>
    public float? Left(Vector2 at, Vector2 to)
    {
        if (way == null || way.Count == 0 || goal.DistanceSquaredTo(to) > .25f) return null;
        // (counted from the leg the body is on now: the nearest within the window walked since the way was last asked for. From the
        // window's first way point, a cart that had passed it seemed to lose ground with every metre and was taken on out of sight
        // a few metres past each corner, #197)
        int i = Math.Min(next, way.Count - 1);
        float nearest = at.DistanceSquaredTo(way[i]), walked = 0;
        for (int k = Math.Max(0, next - 1); k + 1 < way.Count && walked < WindowLength; k++) {
            var a = way[k]; var d = way[k + 1] - a;
            float t = d.LengthSquared() == 0 ? 0 : Math.Clamp((at - a).Dot(d) / d.LengthSquared(), 0, 1);
            float gap = at.DistanceSquaredTo(a + d * t);
            if (gap < nearest) { nearest = gap; i = k + 1; }
            if (k >= next) walked += d.Length();
        }
        float sum = at.DistanceTo(way[i]);
        for (; i + 1 < way.Count; i++) sum += way[i].DistanceTo(way[i + 1]);
        return sum;
    }

    private bool Advance(Vector2 point)
    {
        if (way == null || way.Count == 0) return false;
        if (point.DistanceSquaredTo(way[next]) < .25f) return true;
        // The whole local window may have been walked since the previous ask. Find the earliest supported
        // remaining leg containing this body, without skipping across a nearby later section of a loop.
        for (int i = Math.Max(0, next - 1); i + 1 < way.Count; i++) {
            var a = way[i]; var d = way[i + 1] - a;
            float t = d.LengthSquared() == 0 ? 0 : Math.Clamp((point - a).Dot(d) / d.LengthSquared(), 0, 1);
            if (point.DistanceSquaredTo(a + d * t) > 1 || !map.SupportsStep(point.X, point.Y, way[i + 1].X, way[i + 1].Y)) continue;
            next = Math.Max(next, i + 1); return true;
        }
        return false;
    }
}
