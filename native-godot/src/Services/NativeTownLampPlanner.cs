using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

/// <summary>Lamplighter feet, wickets and tours built exclusively on the current native routing support.</summary>
public sealed partial class NativeTownLampPlanner
{
    private readonly NativeTownPopulation population;
    private readonly NativeTownWalkPath paths;
    private readonly Dictionary<(double ax, double az, double bx, double bz), List<(double x, double z)>?> legs = new();
    private readonly Dictionary<(double ax, double az, double bx, double bz), double> legLengths = new();
    public NativeTownLampPlanner(NativeTownPopulation population) { this.population = population; paths = new(population); }
    private JsonNode? Rampart => population.City["decor"]?["rampart"];
    private static double D((double x, double z) a, (double x, double z) b) => NativeTownBackGeometry.D(a.x, a.z, b.x, b.z);
    private static bool IsWall(string id) => System.Text.RegularExpressions.Regex.IsMatch(id, "^d\\d+$") && int.TryParse(id[1..], out int value) && value >= 1000;
    public double WallAlong(double x, double z)
    {
        double total = 0, best = double.PositiveInfinity, along = 0; foreach (var segment in A(Rampart?["segments"])) { double dx = x - N(segment?["o"]?[0]), dz = z - N(segment?["o"]?[1]), length = N(segment?["len"]), s = Math.Clamp(dx * N(segment?["t"]?[0]) + dz * N(segment?["t"]?[1]), 0, length), distance = Math.Sqrt(Math.Pow(dx - N(segment?["t"]?[0]) * s, 2) + Math.Pow(dz - N(segment?["t"]?[1]) * s, 2)); if (distance < best) { best = distance; along = total + s; } total += length; } return NativeTownBackGeometry.R1(along);
    }
    public string RoundOf(JsonObject lamp)
    {
        double x = N(lamp["x"]), z = N(lamp["z"]); if (IsWall(S(lamp, "id"))) {
            double Gate(string id) { var gate = A(Rampart?["gates"]).FirstOrDefault(g => S(g, "id") == id); return gate == null ? double.PositiveInfinity : WallAlong((N(gate["posts"]?[0]?[0]) + N(gate["posts"]?[1]?[0])) / 2, (N(gate["posts"]?[0]?[1]) + N(gate["posts"]?[1]?[1])) / 2); }
            double along = WallAlong(x, z); return along < Gate("rode_poort") + 12 ? "wall_rode" : along < Gate("keizerspoort") - 9 ? "wall_north" : along < Gate("kipdorppoort") - 9 ? "wall_keizer" : along < Gate("sint_jorispoort") - 9 ? "wall_kipdorp" : "wall_joris";
        }
        return (z > 250 && x > -60) || (x < -60 && x > -155 && z > 55) ? "north" : x < -145 && ((x < -205 && z > 55) || z > 120) ? "market" : x < -145 || (z < 50 && x < -100) ? "west" : "east";
    }
    public (string gate, double x, double z)? WicketFoot(double x, double z)
    {
        foreach (var gate in A(Rampart?["gates"])) {
            double cx = (N(gate?["posts"]?[0]?[0]) + N(gate?["posts"]?[1]?[0])) / 2, cz = (N(gate?["posts"]?[0]?[1]) + N(gate?["posts"]?[1]?[1])) / 2, outX = N(gate?["out"]?[0]), outZ = N(gate?["out"]?[1]), along = (x - cx) * outX + (z - cz) * outZ, signed = (x - cx) * -outZ + (z - cz) * outX, side = Math.Abs(signed);
            if (along < 0 || along > 60 || side > 6) continue; double last = -1;
            for (double d = 0; d <= 40; d += .25) { if (!population.Reachable(cx + outX * d, cz + outZ * d)) break; last = d; }
            if (last < 0 || along <= last + .5) return null; double back = along > last + 8 ? .6 : 0;
            for (double d = last - back; d >= 0; d -= .25) for (double s = Math.Min(1.2, side); s >= 0; s -= .2) { double fx = cx + outX * d - outZ * s * Math.Sign(signed), fz = cz + outZ * d + outX * s * Math.Sign(signed); if (population.Reachable(fx, fz) && population.Open(fx, fz, .35)) return (S(gate, "id"), NativeTownBackGeometry.R1(fx), NativeTownBackGeometry.R1(fz)); }
        } return null;
    }
    public (double x, double z)? Foot(double x, double z)
    {
        foreach (double distance in new[] { .9, 1.2, 1.6 }) for (int i = 0; i < 8; i++) { double angle = i / 8.0 * Math.PI * 2 + Math.PI / 2, fx = NativeTownBackGeometry.R1(x + Math.Cos(angle) * distance), fz = NativeTownBackGeometry.R1(z + Math.Sin(angle) * distance); if (population.Reachable(fx, fz) && population.Open(fx, fz, .35)) return (fx, fz); } return population.Snap(x, z, 6);
    }
    private List<(double x, double z)>? Leg((double x, double z) a, (double x, double z) b)
    {
        var key = (a.x, a.z, b.x, b.z); if (!legs.TryGetValue(key, out var result)) legs[key] = result = paths.Path(a.x, a.z, b.x, b.z); return result;
    }
    private static double Length(IReadOnlyList<(double x, double z)> points) { double value = 0; for (int i = 1; i < points.Count; i++) value += D(points[i - 1], points[i]); return value; }
    private double LegLength((double x, double z) a, (double x, double z) b)
    {
        var key = a.x < b.x || a.x == b.x && a.z <= b.z ? (a.x, a.z, b.x, b.z) : (b.x, b.z, a.x, a.z);
        if (legLengths.TryGetValue(key, out double cached)) return cached;
        // The source canonicalizes only the memo key. The first requested direction owns the walked length;
        // A* tie-breaking and string-pulling can produce a different polyline when traversed backward.
        var path = Leg(a, b); return legLengths[key] = path == null ? double.PositiveInfinity : Length(path);
    }
    private static List<int> Order(IReadOnlyList<(double x, double z)> points, (double x, double z) start)
    {
        if (points.Count == 0) return new(); var left = Enumerable.Range(0, points.Count).ToList(); int first = left.OrderBy(i => D(points[i], start)).First(); var tour = new List<int> { first }; left.Remove(first); int current = first;
        while (left.Count > 0) { int best = -1; double distance = double.PositiveInfinity; foreach (int i in left) if (D(points[current], points[i]) < distance) { distance = D(points[current], points[i]); best = i; } tour.Add(best); left.Remove(best); current = best; }
        for (int pass = 0; pass < 8; pass++) { bool better = false; for (int i = 1; i < points.Count - 1; i++) for (int j = i + 1; j < points.Count; j++) { int a = tour[i - 1], b = tour[i], c = tour[j], e = j + 1 < points.Count ? tour[j + 1] : -1; double before = D(points[a], points[b]) + (e >= 0 ? D(points[c], points[e]) : 0), after = D(points[a], points[c]) + (e >= 0 ? D(points[b], points[e]) : 0); if (after < before - .01) { tour.Reverse(i, j - i + 1); better = true; } } if (!better) break; } return tour;
    }
    private List<int> WalkedOrder(IReadOnlyList<(double x, double z)> points, List<int> tour)
    {
        var result = tour.ToList(); for (int pass = 0; pass < 6; pass++) { bool better = false; for (int i = 1; i < result.Count - 1; i++) for (int j = i + 1; j < result.Count; j++) {
            int a = result[i - 1], b = result[i], c = result[j], e = j + 1 < result.Count ? result[j + 1] : -1; double before = LegLength(points[a], points[b]) + (e >= 0 ? LegLength(points[c], points[e]) : 0);
            if (D(points[a], points[c]) + (e >= 0 ? D(points[b], points[e]) : 0) >= before - .5) continue; double after = LegLength(points[a], points[c]) + (e >= 0 ? LegLength(points[b], points[e]) : 0); if (after < before - .5) { result.Reverse(i, j - i + 1); better = true; }
        } if (!better) break; } return result;
    }
}
