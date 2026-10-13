using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Town;

public sealed partial class Crowd
{
    /// <summary>Controlled lane conflicts, using the real GiveWay step and a clear native walk map.</summary>
    internal static Dictionary<string, bool> CheckVehicleLanes(Node parent)
    {
        const double centre = 10016.5;
        var cells = new byte[32 * 32 * 16];
        Array.Fill(cells, (byte)1);
        var map = WalkMap.FromNativeData(new Rect2(10000, 10000, 32, 32), cells,
            new short[32 * 32 * 4], new short[cells.Length]);
        var crowd = new Crowd(parent, map, 12);
        var results = new Dictionary<string, bool>();
        try
        {
            crowd.grid.Build(map, centre, centre);
            var p = crowd.AddPuppet("milk_woman", centre, centre, size: 1)
                ?? throw new InvalidOperationException("milk woman model missing for lane check");
            Lane Box(double x, double z = centre, double ux = 0, double uz = 1) => new()
                { X = x, Z = z, Ux = ux, Uz = uz, Rx = -uz, Rz = ux,
                    HalfWidth = .3, HalfLength = 1, Look = 3, Rank = 2 };
            void Reset()
            {
                p.X = p.Z = centre; p.State = "walk"; p.Path.Clear(); p.Pi = 0;
                p.YieldHold = 0; p.PushAge = 9; p.WayHome = null; crowd.lanes.Clear();
            }
            foreach (double dt in new[] { .01, .05, .2 })
                foreach (bool reverse in new[] { false, true })
                {
                    Reset();
                    crowd.lanes.Add(Box(centre + (reverse ? -.7 : .7)));
                    crowd.lanes.Add(Box(centre + (reverse ? .7 : -.7)));
                    double lastSide = 0; int reversals = 0;
                    for (int i = 0; i < Math.Ceiling(6 / dt); i++)
                    {
                        double before = p.X;
                        crowd.GiveWay(p, dt);
                        double side = p.X - before;
                        if (Math.Abs(side) > 1e-6)
                        {
                            if (lastSide * side < 0) reversals++;
                            lastSide = side;
                        }
                    }
                    results[$"overlapping_boxes_{dt}_{reverse}"] = reversals == 0
                        && (Math.Abs(p.X - centre) >= 1.675 || p.Z - centre >= 4);
                }
            foreach (bool reverse in new[] { false, true })
            {
                Reset(); p.Path.Add((centre + 10, centre));
                crowd.lanes.Add(Box(centre + (reverse ? -1.1 : 1.1)));
                crowd.lanes.Add(Box(centre + (reverse ? 1.1 : -1.1)));
                results[$"crossing_checks_every_lane_{reverse}"] = crowd.GiveWay(p, .05)
                    && p.Yield == "waits for a lane" && p.Human.Motion == "idle" && p.X == centre;
            }
            Reset();
            var hit = Box(centre, centre - 1.3);
            var other = Box(centre, centre + 1.3);
            crowd.lanes.Add(hit); crowd.lanes.Add(other);
            int left = 66 * 128 + 64, right = 66 * 128 + 67;
            cells[left] = cells[right] = 0; // both lateral steps blocked, longitudinal step physically free
            results["fallback_cannot_enter_another_lane"] = crowd.GiveWay(p, .2)
                && p.X == centre && p.Z == centre && p.Human.Motion == "idle";
            cells[left] = cells[right] = 1;
            Reset(); crowd.lanes.Add(Box(centre));
            for (int i = 0; i < 40; i++) crowd.GiveWay(p, .05);
            results["single_lane_still_clears"] = Math.Abs(p.X - centre) >= .975;
            foreach (double dt in new[] { .01, .05, .2 })
            {
                Reset(); crowd.lanes.Add(Box(centre + .5)); crowd.lanes.Add(Box(centre + .5));
                for (int z = 0; z < 128; z++) for (int x = 0; x < 66; x++) cells[z * 128 + x] = 0;
                for (int i = 0; i < Math.Ceiling(4 / dt); i++) crowd.GiveWay(p, dt);
                results[$"rail_side_escape_across_overlapping_boxes_{dt}"] = p.X - centre > 1.475;
                Array.Fill(cells, (byte)1);
            }
            Reset(); crowd.lanes.Add(Box(centre)); crowd.lanes[0].Owner = p;
            results["own_vehicle_is_ignored"] = !crowd.GiveWay(p, .05);
            Reset(); crowd.lanes.Add(Box(centre)); crowd.lanes[0].Rank = 0;
            results["equal_rank_is_ignored"] = !crowd.GiveWay(p, .05);
            Reset(); p.YieldHold = 1.2;
            results["departed_vehicle_releases_walker"] = !crowd.GiveWay(p, .05) && p.YieldHold == 0;
            return results;
        }
        finally { crowd.Dispose(); }
    }
}
