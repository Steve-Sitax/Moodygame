using System;
using Godot;
using Bridges = Scheldemist.Movers.Bridges;

namespace Scheldemist.Town;

/// <summary>
/// Going round bodies that stay put (issue 120). A goods crate dropped on a route, a posted figure who came on shift, a parked cart:
/// they appear after a route was planned (the grid is only rebuilt now and then, a native window is planned from static ground),
/// and a walker whose next step they refuse would stand until the safety net lifted it over. He takes a short way round their
/// box instead, by the corners, and goes on to the way point he was walking to.
/// </summary>
public sealed partial class Crowd
{
    /// <summary>How far outside a standing body's box the way round runs: its margin (0.3 m) and the 0.35 m by which a walker cuts a corner short.</summary>
    private const double StandingPad = 0.75;
    /// <summary>A planned route is given this many ways round standing bodies before the older rules (replan, next way point, safety net) apply.</summary>
    private const int StandingDetoursPerRoute = 3;
    private readonly (double x, double z)[] standCorners = new (double, double)[4];

    /// <summary>Can this body walk the straight line (every 0.2 m is ground it fits on, the static support holds, no bridge bars it)?
    /// A cart's or barrow's pusher walks behind its nose: that point, straight ahead on the line, must be free too.</summary>
    private bool LineWalkable(Puppet p, double ax, double az, double bx, double bz)
    {
        if (Bridges.Barred(ax, az, bx, bz) || !map.SupportsStep(ax, az, bx, bz)) return false;
        double len = Hyp(bx - ax, bz - az), fx = len > 1e-6 ? (bx - ax) / len : 0, fz = len > 1e-6 ? (bz - az) / len : 0;
        int n = Math.Max(1, (int)Math.Ceiling(len / 0.2));
        for (int i = 1; i <= n; i++)
        {
            double x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
            if (!map.FreeFor(p, x, z)) return false;
            if (p.Nose > 0 && !map.FreeFor(p, x + fx * p.Nose, z + fz * p.Nose)) return false;
        }
        return true;
    }

    /// <summary>The shortest way from the body to (rx, rz) by one corner or two of the box in standCorners; false when none is free.</summary>
    private bool RoundCorners(Puppet p, double rx, double rz, out int first, out int second, out double best)
    {
        best = double.MaxValue;
        first = second = -1;
        for (int i = 0; i < 4; i++)
        {
            var c = standCorners[i];
            if (!LineWalkable(p, p.X, p.Z, c.x, c.z)) continue;
            double lead = Hyp(c.x - p.X, c.z - p.Z);
            double direct = lead + Hyp(rx - c.x, rz - c.z);
            if (direct < best && LineWalkable(p, c.x, c.z, rx, rz)) { best = direct; first = i; second = -1; }
            for (int k = 1; k <= 3; k += 2)
            {
                int j = (i + k) & 3;
                var d = standCorners[j];
                double cost = lead + Hyp(d.x - c.x, d.z - c.z) + Hyp(rx - d.x, rz - d.z);
                if (cost < best && LineWalkable(p, c.x, c.z, d.x, d.z) && LineWalkable(p, d.x, d.z, rx, rz)) { best = cost; first = i; second = j; }
            }
        }
        return first >= 0;
    }

    /// <summary>
    /// The step ahead is refused by a body that stays put: put the corner (or two) of its box that gives the shortest free way round
    /// in front of the route, then a point back on the old line just past the body, and go on to the way point from there. False when
    /// a moving body also holds the step (it is waited for), when the way point is itself taken and none follows, or when no way round
    /// the corners is free. Called only after a refused step, never in the steady walk.
    /// </summary>
    private bool DetourStanding(Puppet p, double nx, double nz, double ux, double uz, double step)
    {
        if (p.Pi >= p.Path.Count) { p.DetourWhy = "no way point"; return false; }
        if (p.StandDetours >= StandingDetoursPerRoute) { p.DetourWhy = "ways round used up"; return false; }
        // what refuses the step: a body at the walker's own next step, or (for a cart or barrow) at its nose ahead
        if (!map.StandingBodyAt(p, nx, nz, out var w))
        {
            var nose = p.Nose > 0 ? NosePoint(p, nx, nz, ux, uz) : (x: nx, z: nz);
            if (p.Nose <= 0 || !map.StandingBodyAt(p, nose.x, nose.z, out w)) { p.DetourWhy = "no standing body (or a moving one)"; return false; }
        }
        // the way point itself may lie in the body's margin (it came after the route was planned): aim at the next one, and drop it
        int ti = p.Pi;
        var t = p.Path[ti];
        if (!map.FreeFor(p, t.x, t.z))
        {
            if (ti + 1 >= p.Path.Count) { p.DetourWhy = "the last way point is taken"; return false; }
            t = p.Path[++ti];
            if (!map.FreeFor(p, t.x, t.z)) { p.DetourWhy = "the next way point is taken too"; return false; }
        }
        // a pushed cart is wider than its pusher: its corners go round with the cart's half-width more room
        double pad = StandingPad + (p.Nose > 0 ? p.Reach : 0);
        double x0 = w.Position.X - pad, x1 = w.End.X + pad, z0 = w.Position.Z - pad, z1 = w.End.Z + pad;
        standCorners[0] = (x0, z0); standCorners[1] = (x1, z0); standCorners[2] = (x1, z1); standCorners[3] = (x0, z1);
        // where the old line (body to way point) leaves the padded box: the way back to it starts just past there
        double dx = t.x - p.X, dz = t.z - p.Z, len = Hyp(dx, dz), exit = 0;
        if (len > 1e-6)
        {
            double lo = 0, hi = len, ex = dx / len, ez = dz / len;
            bool hit = true;
            if (Math.Abs(ex) < 1e-9) hit &= p.X > x0 && p.X < x1;
            else { double a = (x0 - p.X) / ex, b = (x1 - p.X) / ex; lo = Math.Max(lo, Math.Min(a, b)); hi = Math.Min(hi, Math.Max(a, b)); }
            if (Math.Abs(ez) < 1e-9) hit &= p.Z > z0 && p.Z < z1;
            else { double a = (z0 - p.Z) / ez, b = (z1 - p.Z) / ez; lo = Math.Max(lo, Math.Min(a, b)); hi = Math.Min(hi, Math.Max(a, b)); }
            if (hit && lo <= hi) exit = hi;
        }
        double ux2 = len > 1e-6 ? dx / len : 0, uz2 = len > 1e-6 ? dz / len : 0;
        int first = -1, second = -1;
        double rx = t.x, rz = t.z;
        bool found = false, viaPoint = false;
        // rejoin 0.6 m, then 1.6 m past the body; failing both, go on to the way point itself
        for (int attempt = 0; attempt < 3 && !found; attempt++)
        {
            double s = attempt == 0 ? exit + 0.6 : attempt == 1 ? exit + 1.6 : len;
            if (attempt < 2 && s >= len - 0.35) continue;
            rx = attempt < 2 ? p.X + ux2 * s : t.x;
            rz = attempt < 2 ? p.Z + uz2 * s : t.z;
            if (attempt < 2 && !map.FreeFor(p, rx, rz)) continue;
            found = RoundCorners(p, rx, rz, out first, out second, out _);
            viaPoint = attempt < 2;
        }
        if (!found) { p.DetourWhy = $"no free corner way round the box {w.Position.X:0.00},{w.Position.Z:0.00} to {w.End.X:0.00},{w.End.Z:0.00}"; return false; }
        p.DetourWhy = "";
        if (WedgeLog.Count < 200) WedgeLog.Add(WedgeNote(p, "went round a standing body", ux, uz, step) + $" | its box {w.Position.X:0.00},{w.Position.Z:0.00} to {w.End.X:0.00},{w.End.Z:0.00}, via {standCorners[first].x:0.00},{standCorners[first].z:0.00}" + (second >= 0 ? $" and {standCorners[second].x:0.00},{standCorners[second].z:0.00}" : "") + (viaPoint ? $" back to the line at {rx:0.00},{rz:0.00}" : ""));
        if (ti > p.Pi) p.Path.RemoveAt(p.Pi);
        int added = 1 + (second >= 0 ? 1 : 0) + (viaPoint ? 1 : 0);
        if (viaPoint) p.Path.Insert(p.Pi, (rx, rz));
        if (second >= 0) p.Path.Insert(p.Pi, standCorners[second]);
        p.Path.Insert(p.Pi, standCorners[first]);
        p.DetourEnd = p.Pi + added;
        p.StandDetours++;
        p.Failed = 0;
        p.StuckT = 0;
        p.BestD = double.PositiveInfinity;
        return true;
    }
}
