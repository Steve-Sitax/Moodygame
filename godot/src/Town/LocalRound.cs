using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.Town;

/// <summary>
/// Small working rounds (shared/localRound.ts): someone at a post takes a few steps to a spot near by, stands
/// there a moment and comes back. Routes are checked once, not searched every frame.
/// </summary>
public sealed class LocalRound
{
    public static bool ClearWalk((double x, double z) from, (double x, double z) to, Func<double, double, bool> free)
    {
        int n = Math.Max(1, (int)Math.Ceiling(Whereabouts.Hypot(to.x - from.x, to.z - from.z) / 0.15));
        for (int i = 0; i <= n; i++)
        {
            double k = (double)i / n;
            if (!free(from.x + (to.x - from.x) * k, from.z + (to.z - from.z) * k)) return false;
        }
        return true;
    }

    /// <summary>A bounded aisle search, including checked diagonals; never crosses a blocked corner.</summary>
    public static List<(double x, double z)>? LocalWalk((double x, double z) from, (double x, double z) to, Func<double, double, bool> free, double radius = 10)
    {
        if (!free(from.x, from.z) || !free(to.x, to.z)) return null;
        if (ClearWalk(from, to, free)) return new List<(double, double)> { to };
        const double cell = 0.35;
        int n = (int)Math.Ceiling(radius / cell);
        (double x, double z) Pt(int x, int z) => (from.x + x * cell, from.z + z * cell);
        var queue = new List<(int x, int z)> { (0, 0) };
        var prev = new Dictionary<(int, int), (int, int)?> { [(0, 0)] = null };
        (int, int)? end = null;
        var steps = new[] { (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1) };
        for (int i = 0; i < queue.Count && i < 3600; i++)
        {
            var (x, z) = queue[i];
            var p = Pt(x, z);
            if (Whereabouts.Hypot(p.x - to.x, p.z - to.z) < 0.55 && ClearWalk(p, to, free))
            {
                end = (x, z);
                break;
            }
            foreach (var (dx, dz) in steps)
            {
                int nx = x + dx, nz = z + dz;
                if (Math.Abs(nx) > n || Math.Abs(nz) > n || prev.ContainsKey((nx, nz))) continue;
                if (!ClearWalk(p, Pt(nx, nz), free)) continue;
                prev[(nx, nz)] = (x, z);
                queue.Add((nx, nz));
            }
        }
        if (end == null) return null;
        var path = new List<(double x, double z)> { to };
        for ((int, int)? k = end; k != null && prev[k.Value] != null; k = prev[k.Value]) path.Insert(0, Pt(k.Value.Item1, k.Value.Item2));
        // pull straight sections taut without cutting furniture or corners
        var o = new List<(double x, double z)>();
        var at = from;
        for (int i = 0; i < path.Count;)
        {
            int j = path.Count - 1;
            while (j > i && !ClearWalk(at, path[j], free)) j--;
            at = path[j];
            o.Add(at);
            i = j + 1;
        }
        return o;
    }

    /// <summary>Only reachable stops are kept.</summary>
    public static List<List<(double x, double z)>> RoundRoutes((double x, double z) home, Func<double, double, bool> free, int seed = 0, double distance = 3)
    {
        var routes = new List<List<(double x, double z)>>();
        for (int i = 0; i < 12 && routes.Count < 3; i++)
        {
            double a = (i / 12.0 + (seed % 17) / 17.0) * Math.PI * 2;
            var route = LocalWalk(home, (home.x + Math.Sin(a) * distance, home.z + Math.Cos(a) * distance), free, distance + 1);
            if (route != null) routes.Add(route);
        }
        return routes;
    }

    public readonly (double x, double z) Home;
    public readonly List<List<(double x, double z)>> Routes;
    public readonly double Speed, Rest;
    public double X, Z, Yaw;
    public bool Walking { get; private set; }
    private List<(double x, double z)> path = new();
    private List<(double x, double z)> returnPath = new();
    private bool outbound;
    private int next;
    private double wait;

    public LocalRound((double x, double z) home, List<List<(double x, double z)>> routes, int seed = 0, double speed = 0.75, double rest = 22)
    {
        Home = home;
        Routes = routes;
        Speed = speed;
        Rest = rest;
        (X, Z) = home;
        wait = 4 + seed % 19;
    }

    public void Update(double dt, bool paused = false, Func<double, double, bool>? free = null)
    {
        Walking = false;
        if (paused || Routes.Count == 0) return;
        dt = Math.Min(dt, 0.15);
        if (path.Count == 0)
        {
            if ((wait -= dt) > 0) return;
            if (outbound)
            {
                path = returnPath.ToList();
                outbound = false;
            }
            else
            {
                var route = Routes[next++ % Routes.Count];
                if (free != null)
                    for (int i = 0; i < route.Count; i++)
                        if (!ClearWalk(i > 0 ? route[i - 1] : Home, route[i], free))
                        {
                            wait = 3;
                            return;
                        }
                returnPath = route.Take(route.Count - 1).Reverse().Append(Home).ToList();
                path = route.ToList();
                outbound = true;
            }
        }
        double step = Speed * dt;
        while (step > 0 && path.Count > 0)
        {
            var (tx, tz) = path[0];
            double dx = tx - X, dz = tz - Z, d = Whereabouts.Hypot(dx, dz);
            if (d < 0.001)
            {
                path.RemoveAt(0);
                continue;
            }
            double k = Math.Min(step / d, 1), nx = X + dx * k, nz = Z + dz * k;
            if (free != null && !ClearWalk((X, Z), (nx, nz), free)) return;
            Walking = true;
            X = nx;
            Z = nz;
            Yaw = Math.Atan2(dx, dz);
            step -= d;
            if (k == 1) path.RemoveAt(0);
        }
        if (path.Count == 0) wait = outbound ? 5 + next % 7 : Rest + next % 13;
    }
}
