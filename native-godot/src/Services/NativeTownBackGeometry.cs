using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Back-street groups, courts and rampart walking points from current native geometry.</summary>
public sealed class NativeTownBackGeometry
{
    private readonly NativeTownPopulation population;
    private List<(double x, double z, double wall)>? corners;
    private List<(double x, double z)>? walk;
    public NativeTownBackGeometry(NativeTownPopulation population) => this.population = population;
    private static double N(JsonNode? n) => NativeTown.N(n);
    private static JsonArray A(JsonNode? n) => n as JsonArray ?? new JsonArray();
    public static double D(double x, double z, double bx, double bz) => Math.Sqrt((x - bx) * (x - bx) + (z - bz) * (z - bz));
    public static double R1(double value) => Math.Floor(value * 10 + .5) / 10;
    public static bool InBack(double x, double z) => z >= 145 || x <= -300;
    public bool OffLanes(double x, double z, double margin = .9)
    {
        foreach (var lane in A(population.Facts["LANES"])) { var s = lane!["s"]!; double ax = N(s[0]), az = N(s[1]), dx = N(s[2]) - ax, dz = N(s[3]) - az, length = dx * dx + dz * dz; if (length == 0) length = 1; double t = Math.Clamp(((x - ax) * dx + (z - az) * dz) / length, 0, 1); if (D(x, z, ax + dx * t, az + dz * t) < N(lane["half"]) + margin) return false; } return true;
    }
    public bool Standable(double x, double z, double room) => population.Reachable(x, z) && population.Open(x, z, room) && OffLanes(x, z, .2);
    public double Run(double x, double z, double angle, double max)
    {
        double sx = Math.Sin(angle), sz = Math.Cos(angle); for (double s = .5; s <= max; s += .5) if (population.Flags(x + sx * s, z + sz * s) != 0) return s - .5; return max;
    }
    public (double x, double z)? RoomNear(double x, double z, double room, double max = 8, IReadOnlyList<(double x, double z)>? avoid = null, double keep = 0)
    {
        for (double radius = 0; radius <= max; radius += .5) { int count = Math.Max(1, (int)Math.Floor(radius * 4 + .5)); for (int i = 0; i < count; i++) { double angle = i / (double)count * Math.PI * 2, px = R1(x + Math.Sin(angle) * radius), pz = R1(z + Math.Cos(angle) * radius); if (!Standable(px, pz, room) || avoid?.Any(p => D(p.x, p.z, px, pz) < keep) == true) continue; return (px, pz); } } return null;
    }
    public IReadOnlyList<(double x, double z, double wall)> Corners()
    {
        if (corners != null) return corners; var candidates = new List<(double x, double z, int arms, double total)>();
        for (double x = -366; x <= 232; x += 3) for (double z = 60; z <= 356; z += 3) {
            if (!InBack(x, z) || !Standable(x, z, .9)) continue; var runs = Enumerable.Range(0, 16).Select(i => Run(x, z, i / 16.0 * Math.PI * 2, 22)).ToArray(); if (runs.Count(r => r >= 5) >= 14) continue;
            int arms = Enumerable.Range(0, 16).Count(i => runs[i] >= 14 && runs[(i + 15) % 16] < 14); if (arms >= 3) candidates.Add((x, z, arms, runs.Sum()));
        }
        corners = new(); foreach (var c in candidates.OrderByDescending(c => c.arms).ThenByDescending(c => c.total)) {
            if (corners.Any(p => D(p.x, p.z, c.x, c.z) < 42)) continue; int best = -1; double distance = 99; for (int i = 0; i < 16; i++) { double d = Run(c.x, c.z, i / 16.0 * Math.PI * 2, 8); if (d < distance) { distance = d; best = i; } }
            double angle = best / 16.0 * Math.PI * 2, back = Math.Max(0, distance - 1.3), x = R1(c.x + Math.Sin(angle) * back), z = R1(c.z + Math.Cos(angle) * back); if (!Standable(x, z, .8)) continue; corners.Add((x, z, Math.Floor(angle * 1000 + .5) / 1000));
        } return corners;
    }
    public IReadOnlyList<(double x, double z)> WallWalk()
    {
        if (walk != null) return walk; walk = new(); var trace = new[] { (215.0, 0.0), (230.0, 92.0), (236.0, 205.0), (222.0, 318.0), (118.0, 352.0), (-60.0, 360.0), (-245.0, 352.0), (-360.0, 318.0), (-372.0, 215.0), (-364.0, 105.0), (-355.0, 0.0) };
        var gates = population.City["places"]!.AsObject().Where(p => NativeTown.S(p.Value, "kind") == "gate").Select(p => (x: N(p.Value?["x"]), z: N(p.Value?["z"]))).ToArray();
        for (int i = 0; i < trace.Length - 1; i++) { var a = trace[i]; var b = trace[i + 1]; double length = D(a.Item1, a.Item2, b.Item1, b.Item2); for (double s = 12; s < length - 8; s += 26) {
            double x = a.Item1 + (b.Item1 - a.Item1) * s / length, z = a.Item2 + (b.Item2 - a.Item2) * s / length, toward = Math.Atan2(-60 - x, 170 - z);
            for (double distance = -6; distance <= 16; distance += .5) { double px = R1(x + Math.Sin(toward) * distance), pz = R1(z + Math.Cos(toward) * distance); if (gates.Any(g => D(g.x, g.z, px, pz) < 16)) break; if (population.Flags(px, pz) == 0 && population.Reachable(px, pz) && population.Open(px, pz, .6)) { walk.Add((px, pz)); break; } }
        } } return walk;
    }
    public (double x, double z, double face)? ChurchDoor(string key)
    {
        var frame = population.City["landmarks"]?[key]?["frame"]; if (frame == null) return null; double sign = N(frame["open"]) >= 0 ? 1 : -1, outX = N(frame["n"]?[0]) * sign, outZ = N(frame["n"]?[1]) * sign, distance = N(frame["W"]) / 2 + 2.5;
        var p = RoomNear(N(frame["c"]?[0]) + outX * distance, N(frame["c"]?[1]) + outZ * distance, .6, 10); return p == null ? null : (p.Value.x, p.Value.z, Math.Floor(Math.Atan2(-outX, -outZ) * 1000 + .5) / 1000);
    }
    public double Across(JsonObject door) => Run(N(door["sx"]), N(door["sz"]), Math.Atan2(N(door["out"]?[0]), N(door["out"]?[1])), 24) + D(N(door["x"]), N(door["z"]), N(door["sx"]), N(door["sz"]));
    public void Invalidate() { corners = null; walk = null; }
}
