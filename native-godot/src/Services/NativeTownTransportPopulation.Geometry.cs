using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownTransportPopulation
{
    private List<(double x, double z, double radius)> KeepOff(JsonObject town)
    {
        var circles = new List<(double, double, double)>();
        foreach (var q in A(town["stalls"])) circles.Add((N(q?["x"]), N(q?["z"]), 3.2));
        foreach (var q in A(town["shops"])) circles.Add((N(q?["wall"]?[0]), N(q?["wall"]?[1]), 3.2));
        foreach (var p in town["places"]!.AsObject()) if (p.Value?["door"] is { } d) circles.Add((N(d[0]), N(d[1]), 1.8));
        foreach (var p in town["places"]!.AsObject()) if (p.Key.StartsWith("tavern:", StringComparison.Ordinal) && p.Value?["door"] is { } d) circles.Add((N(d[0]), N(d[1]), 3));
        foreach (var lamp in A(population.City["decor"]?["lamps"])) circles.Add((N(lamp?[0]), N(lamp?[1]), 1.2));
        foreach (var r in A(town["residents"])) { circles.Add((N(r?["home"]?["sx"]), N(r?["home"]?["sz"]), 1.7)); if (r?["work"]?["door"] is { } d) circles.Add((N(d[0]), N(d[1]), 1.7)); }
        return circles;
    }
    public bool OffLanes(double x, double z, double margin = .9)
    {
        foreach (var lane in A(population.Facts["LANES"])) { var s = lane!["s"]!; double dx = N(s[2]) - N(s[0]), dz = N(s[3]) - N(s[1]), length = dx * dx + dz * dz; if (length == 0) length = 1;
            double t = Math.Clamp(((x - N(s[0])) * dx + (z - N(s[1])) * dz) / length, 0, 1); if (NativeTownBackGeometry.D(x, z, N(s[0]) + dx * t, N(s[1]) + dz * t) < N(lane["half"]) + margin) return false;
        } return true;
    }
    public bool OnDoorway(double x, double z, double margin = .6)
    {
        return A(population.Facts["possession"]?["DOOR_KEEP"]).Any(r => x > N(r?["minX"]) - margin && x < N(r?["maxX"]) + margin && z > N(r?["minZ"]) - margin && z < N(r?["maxZ"]) + margin)
            || A(population.Facts["possession"]?["FLIGHTS"]).Any(f => NativeTownBackGeometry.D(x, z, N(f?["top"]?[0]), N(f?["top"]?[1])) < 4.5 + margin);
    }
    private bool FreeSpot(double x, double z, double room, List<JsonArray> taken, List<(double x, double z, double radius)> keep)
        => population.Open(x, z, room) && population.Reachable(x, z) && OffLanes(x, z) && !taken.Any(t => NativeTownBackGeometry.D(N(t[0]), N(t[1]), x, z) < 2.4) && !keep.Any(q => NativeTownBackGeometry.D(q.x, q.z, x, z) < q.radius) && !OnDoorway(x, z);
    private static JsonArray Spot(double x, double z, double yaw) => new(NativeTownBackGeometry.R1(x), NativeTownBackGeometry.R1(z), Round(yaw * 1000) / 1000);
    private JsonArray? SpotNear(double x, double z, double room, List<JsonArray> taken, List<(double x, double z, double radius)> keep, double maximum = 9, double yaw = 0, double minimum = 0)
    {
        for (double radius = minimum; radius <= maximum; radius += .5) { int count = radius == 0 ? 1 : Math.Max(8, (int)Round(radius * 5)); for (int k = 0; k < count; k++) { double angle = k / (double)count * Math.PI * 2 + radius, px = x + Math.Cos(angle) * radius, pz = z + Math.Sin(angle) * radius; if (FreeSpot(px, pz, room, taken, keep)) return Spot(px, pz, yaw); } } return null;
    }
    private JsonArray? BesideDoor(JsonNode person, int side, double room, List<JsonArray> taken, List<(double x, double z, double radius)> keep, bool cart = false)
    {
        var home = person["home"]!; var d = population.Doors.FirstOrDefault(q => N(q["house"]) == N(home["house"])); double ox = d != null ? N(d["out"]?[0]) : N(home["sx"]) - N(home["x"]), oz = d != null ? N(d["out"]?[1]) : N(home["sz"]) - N(home["z"]);
        if (d == null) { double length = Math.Sqrt(ox * ox + oz * oz); if (length == 0) length = 1; ox /= length; oz /= length; } double ax = -oz * side, az = ox * side, wx = N(d?["x"] ?? home["x"]), wz = N(d?["z"] ?? home["z"]), yaw = cart ? Math.Atan2(-ox, -oz) : Math.Atan2(ax, az);
        if (Math.Sqrt(ox * ox + oz * oz) >= .5) foreach (double outward in cart ? new[] { 1.4, 1.8, 2.2 } : new[] { 1.0, 1.25 }) foreach (double along in new[] { 2.0, 2.8, 3.6, 4.4 }) {
            double x = wx + ox * outward + ax * along, z = wz + oz * outward + az * along; if (FreeSpot(x, z, room, taken, keep)) return Spot(x, z, yaw);
        }
        return SpotNear(N(home["sx"]) + ox * 1.5, N(home["sz"]) + oz * 1.5, room, taken, keep, 8, yaw);
    }
    public static (double x, double z)? KeyPoint(JsonNode person, string key, JsonNode places)
    {
        if (key == "home") return (N(person["home"]?["sx"]), N(person["home"]?["sz"])); int colon = key.IndexOf(':'); string act = colon < 0 ? key : key[..colon], place = colon < 0 ? "" : key[(colon + 1)..];
        if (act == "work") { var work = person["work"]!; foreach (string field in new[] { "at", "door", "a" }) if (work[field] is { } p) return (N(p[0]), N(p[1])); if (A(work["route"]).Count > 0) return (N(work["route"]?[0]?[0]), N(work["route"]?[0]?[1])); place = S(work, "place"); }
        else if (act == "church") place = "church"; var location = places[place]; return location == null ? null : (N(location["x"]), N(location["z"]));
    }
    public static List<(double from, double to, string key)> DayKeys(JsonNode person, int day)
    {
        var result = new List<(double from, double to, string key)>(); double time = 0;
        foreach (var s in A(person["sched"]?[day % 7 == 0 ? "sunday" : "day"]).OrderBy(s => N(s?[0]))) { double from = N(s?[0]), to = N(s?[1]); if (from > time) result.Add((time, from, "home")); string act = s![2]!.GetValue<string>(), place = s.AsArray().Count > 3 ? s[3]?.GetValue<string>() ?? (act == "work" ? "work" : act) : act == "work" ? "work" : act; result.Add((from, to, act == "home" ? "home" : act + ":" + place)); time = to; }
        if (time < 24) result.Add((time, 24, "home")); return result;
    }
    private static List<string> WeekKeys(JsonNode person) => new[] { 1, 7 }.SelectMany(day => DayKeys(person, day)).Select(k => k.key).Where(k => k != "home").Distinct().ToList();
    private static bool GoesFar(JsonNode person, JsonNode places)
    {
        foreach (int day in new[] { 1, 7 }) { string previous = "home"; foreach (var key in DayKeys(person, day)) { var a = KeyPoint(person, previous, places); var b = KeyPoint(person, key.key, places); if (previous != key.key && a != null && b != null && NativeTownBackGeometry.D(a.Value.x, a.Value.z, b.Value.x, b.Value.z) > 300) return true; previous = key.key; } } return false;
    }
    private static uint Hash(string text) { uint hash = 2166136261; foreach (char c in text) hash = unchecked((hash ^ c) * 16777619); return hash; }
}
