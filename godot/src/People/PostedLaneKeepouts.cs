using System;
using System.Collections.Generic;
using System.Linq;
using Scheldemist.Movers;

namespace Scheldemist.People;

/// <summary>Standing employers use the same sampled lanes as the native omnibus and street vehicles.</summary>
public static class PostedLaneKeepouts
{
    public sealed record Box(double MinX, double MaxX, double MinZ, double MaxZ);
    public static IReadOnlyList<Box> Current()
    {
        var result = new List<Box>();
        void Add(float[] x, float[] z, double half)
        {
            for (int i = 0; i < x.Length; i += 8) result.Add(new(x[i] - half, x[i] + half, z[i] - half, z[i] + half));
        }
        foreach (var line in OmnibusLines.Lines)
        {
            var loop = OmnibusLines.LoopOf(line); Add(loop.X, loop.Z, 1.9);
        }
        if (Traffic.I is { } traffic)
            foreach (var group in traffic.Vehicles.GroupBy(vehicle => vehicle.Path))
                Add(group.Key.X, group.Key.Z, group.Any(vehicle => vehicle.Kind == "dray") ? 1.9 : 1.4);
        return result;
    }
    public static bool Clear(IReadOnlyList<Box> lanes, double x, double z, double padding = .4) =>
        !lanes.Any(box => x > box.MinX - padding && x < box.MaxX + padding && z > box.MinZ - padding && z < box.MaxZ + padding);

    /// <summary>Source candidate order, including lateral moves out of north/south lanes.</summary>
    public static (double X, double Z) Position(IReadOnlyList<Box> lanes, double x, double z, Func<double, double, bool> groundFree)
    {
        bool Free(double dx, double dz) => Clear(lanes, x + dx, z + dz) && groundFree(x + dx, z + dz);
        foreach (var (dx, dz) in new[] { (0d, 0d), (0d, 1.4), (0d, 2.2), (-1.2, 1.4), (1.2, 1.4), (0d, -2.2) })
            if (Free(dx, dz)) return (x + dx, z + dz);
        for (double radius = 2; radius <= 12; radius += .5)
            for (int k = 0; k < 16; k++)
            {
                double dx = Math.Cos(k * Math.PI / 8) * radius, dz = Math.Sin(k * Math.PI / 8) * radius;
                if (Free(dx, dz)) return (x + dx, z + dz);
            }
        return (x, z);
    }
}
