using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Street sellers' native door stops and tours. All path legs retain the cart's required clearance.</summary>
public sealed class NativeTownRoundPlanner
{
    private readonly NativeTownPopulation population;
    private readonly NativeTownBackGeometry geometry;
    private readonly NativeTownWalkPath paths;
    public NativeTownRoundPlanner(NativeTownPopulation population) { this.population = population; geometry = new(population); paths = new(population); }
    private static double N(JsonNode? n) => NativeTown.N(n);
    public double Across(JsonObject door) { for (double s = 1; s <= 24; s += .5) if (population.Flags(N(door["x"]) + N(door["out"]?[0]) * s, N(door["z"]) + N(door["out"]?[1]) * s) != 0) return s; return 24; }
    public bool BackStreet(JsonObject door) => N(door["sz"]) > 14 && Across(door) < 14;
    public (double x, double z, double yaw)? StopBy(JsonObject d, int side, double room)
    {
        double outX = N(d["out"]?[0]), outZ = N(d["out"]?[1]);
        foreach (double along in new[] { 1.3, 1.7, 2.1 }) foreach (double away in new[] { 1.1, 1.5, 1.9 }) {
            double x = NativeTownBackGeometry.R1(N(d["x"]) + outX * away - outZ * side * along), z = NativeTownBackGeometry.R1(N(d["z"]) + outZ * away + outX * side * along);
            if (population.Reachable(x, z) && population.Open(x, z, room) && geometry.OffLanes(x, z, .3)) return (x, z, Math.Floor(Math.Atan2(N(d["x"]) - x, N(d["z"]) - z) * 1000 + .5) / 1000);
        } return null;
    }
    public sealed record Round(List<(double x, double z)> Route, List<double> Faces, List<int> Houses, double Length);
    private sealed record Stop(int House, double X, double Z, double Yaw);
    public Round Build((double x, double z) at, double reach, int count, (double x, double z) start, Func<double> rng, HashSet<int> used, double room, IReadOnlyList<(double x, double z)>? usedStops = null)
    {
        var candidates = population.Doors.Where(d => !used.Contains((int)N(d["house"])) && NativeTownBackGeometry.D(N(d["sx"]), N(d["sz"]), at.x, at.z) < reach && !(room > .6 && d["alley"]?.GetValue<bool>() == true) && BackStreet(d)).Select(d => (d, k: rng())).OrderBy(p => p.k).Select(p => p.d);
        var picked = new List<Stop>(); var info = population.MapInfo();
        foreach (var d in candidates) {
            if (picked.Count >= count) break; var s = StopBy(d, rng() < .5 ? 1 : -1, room) ?? StopBy(d, 1, room) ?? StopBy(d, -1, room);
            if (s == null || picked.Any(p => NativeTownBackGeometry.D(p.X, p.Z, s.Value.x, s.Value.z) < 9)) continue;
            if (room > .6 && !population.Open(info.X0 + (Math.Floor((s.Value.x - info.X0) / info.Res) + .5) * info.Res, info.Z0 + (Math.Floor((s.Value.z - info.Z0) / info.Res) + .5) * info.Res, room)) continue;
            if (usedStops?.Any(p => NativeTownBackGeometry.D(p.x, p.z, s.Value.x, s.Value.z) < 2.5) == true || population.Doors.Any(o => N(o["house"]) != N(d["house"]) && NativeTownBackGeometry.D(N(o["sx"]), N(o["sz"]), s.Value.x, s.Value.z) < 1.1)) continue;
            picked.Add(new((int)N(d["house"]), s.Value.x, s.Value.z, s.Value.yaw));
        }
        var tour = new List<Stop>(); var cur = start;
        while (picked.Count > 0) { int best = 0; for (int i = 1; i < picked.Count; i++) if (NativeTownBackGeometry.D(picked[i].X, picked[i].Z, cur.x, cur.z) < NativeTownBackGeometry.D(picked[best].X, picked[best].Z, cur.x, cur.z)) best = i; var p = picked[best]; picked.RemoveAt(best); tour.Add(p); cur = (p.X, p.Z); }
        static double D(Stop a, Stop b) => NativeTownBackGeometry.D(a.X, a.Z, b.X, b.Z);
        for (int pass = 0; pass < 8; pass++) { bool better = false; for (int i = 1; i < tour.Count - 1; i++) for (int j = i + 1; j < tour.Count; j++) { var a = tour[i - 1]; var b = tour[i]; var c = tour[j]; var e = tour[(j + 1) % tour.Count]; if (D(a, c) + D(b, e) < D(a, b) + D(c, e) - .01) { tour.Reverse(i, j - i + 1); better = true; } } if (!better) break; }
        var kept = new List<Stop>(); var walked = new List<(double x, double z)>();
        foreach (var p in tour) { if (kept.Count > 0) { var from = kept[^1]; var leg = paths.Path(from.X, from.Z, p.X, p.Z, 400000, room > .6 ? room : 0); if (leg == null) continue; walked.AddRange(leg.Skip(1)); } else walked.Add((p.X, p.Z)); kept.Add(p); }
        if (kept.Count > 1) { var back = paths.Path(kept[^1].X, kept[^1].Z, kept[0].X, kept[0].Z, 400000, room > .6 ? room : 0); if (back != null) walked.AddRange(back.Skip(1)); }
        double length = 0; for (int i = 1; i < walked.Count; i++) length += NativeTownBackGeometry.D(walked[i - 1].x, walked[i - 1].z, walked[i].x, walked[i].z);
        return new(kept.Select(p => (p.X, p.Z)).ToList(), kept.Select(p => p.Yaw).ToList(), kept.Select(p => p.House).ToList(), Math.Floor(length + .5));
    }
}
