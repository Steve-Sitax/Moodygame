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

    /// <summary>Can this body walk the straight line (every 0.2 m is ground it fits on, the static support holds, no bridge bars it)?</summary>
    private bool LineWalkable(Puppet p, double ax, double az, double bx, double bz)
    {
        if (Bridges.Barred(ax, az, bx, bz) || !map.SupportsStep(ax, az, bx, bz)) return false;
        int n = Math.Max(1, (int)Math.Ceiling(Hyp(bx - ax, bz - az) / 0.2));
        for (int i = 1; i <= n; i++)
            if (!map.FreeFor(p, ax + (bx - ax) * i / n, az + (bz - az) * i / n)) return false;
        return true;
    }

    /// <summary>
    /// The step ahead is refused by a body that stays put: put the corner (or two) of its box that gives the shortest free way round
    /// in front of the route. False when a moving body also holds the step (it is waited for), when the way point is itself taken,
    /// or when no way round the corners is free. Called only after a refused step, never in the steady walk.
    /// </summary>
    private bool DetourStanding(Puppet p, double nx, double nz, double ux, double uz, double step)
    {
        if (p.Pi >= p.Path.Count || p.StandDetours >= StandingDetoursPerRoute) return false;
        if (!map.StandingBodyAt(p, nx, nz, out var w)) return false;
        // the way point itself may lie in the body's margin (it came after the route was planned): aim at the next one, and drop it
        int ti = p.Pi;
        var t = p.Path[ti];
        if (!map.FreeFor(p, t.x, t.z))
        {
            if (ti + 1 >= p.Path.Count) return false;
            t = p.Path[++ti];
            if (!map.FreeFor(p, t.x, t.z)) return false;
        }
        double x0 = w.Position.X - StandingPad, x1 = w.End.X + StandingPad, z0 = w.Position.Z - StandingPad, z1 = w.End.Z + StandingPad;
        standCorners[0] = (x0, z0); standCorners[1] = (x1, z0); standCorners[2] = (x1, z1); standCorners[3] = (x0, z1);
        double best = double.MaxValue;
        int first = -1, second = -1;
        for (int i = 0; i < 4; i++)
        {
            var c = standCorners[i];
            if (!LineWalkable(p, p.X, p.Z, c.x, c.z)) continue;
            double lead = Hyp(c.x - p.X, c.z - p.Z);
            double direct = lead + Hyp(t.x - c.x, t.z - c.z);
            if (direct < best && LineWalkable(p, c.x, c.z, t.x, t.z)) { best = direct; first = i; second = -1; }
            for (int k = 1; k <= 3; k += 2)
            {
                int j = (i + k) & 3;
                var d = standCorners[j];
                double cost = lead + Hyp(d.x - c.x, d.z - c.z) + Hyp(t.x - d.x, t.z - d.z);
                if (cost < best && LineWalkable(p, c.x, c.z, d.x, d.z) && LineWalkable(p, d.x, d.z, t.x, t.z)) { best = cost; first = i; second = j; }
            }
        }
        if (first < 0) return false;
        if (WedgeLog.Count < 200) WedgeLog.Add(WedgeNote(p, "went round a standing body", ux, uz, step) + $" | its box {w.Position.X:0.00},{w.Position.Z:0.00} to {w.End.X:0.00},{w.End.Z:0.00}, via {standCorners[first].x:0.00},{standCorners[first].z:0.00}" + (second >= 0 ? $" and {standCorners[second].x:0.00},{standCorners[second].z:0.00}" : ""));
        if (ti > p.Pi) p.Path.RemoveAt(p.Pi);
        if (second >= 0) p.Path.Insert(p.Pi, standCorners[second]);
        p.Path.Insert(p.Pi, standCorners[first]);
        p.DetourEnd = p.Pi + (second >= 0 ? 2 : 1);
        p.StandDetours++;
        p.Failed = 0;
        p.StuckT = 0;
        p.BestD = double.PositiveInfinity;
        return true;
    }
}
