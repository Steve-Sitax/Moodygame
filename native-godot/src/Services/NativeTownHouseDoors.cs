using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Native house-door geometry queried against the current authored scene; no baked walk image.</summary>
public static class NativeTownHouseDoors
{
    private static double N(JsonNode? node) => NativeTown.N(node);
    private static double H(double x, double z) => Math.Sqrt(x * x + z * z);
    private static double Round(double n, double scale)
    {
        double value = Math.Floor(n * scale + .5) / scale;
        // JavaScript Math.round preserves negative zero; side-of-door atan2 needs its direction at ±pi.
        return value == 0 && BitConverter.DoubleToInt64Bits(n) < 0 ? -0.0 : value;
    }
    private static bool Inside(JsonArray polygon, double px, double pz)
    {
        bool inside = false;
        for (int i = 0, j = polygon.Count - 1; i < polygon.Count; j = i++) {
            double xi = N(polygon[i]?[0]), zi = N(polygon[i]?[1]), xj = N(polygon[j]?[0]), zj = N(polygon[j]?[1]);
            if ((zi > pz) != (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) inside = !inside;
        }
        return inside;
    }
    public static List<JsonObject> Build(JsonArray houses, Func<double, double, double, bool> open, Func<double, double, bool> reachable, bool stores = false)
    {
        var result = new List<JsonObject>();
        for (int index = 0; index < houses.Count; index++) {
            var h = houses[index]!; if (h["gone"]?.GetValue<bool>() == true || h["store"] != null && !stores) continue;
            double ax, az, bx, bz; var street = h["street"]!.AsArray();
            if (h["rect"]?.GetValue<bool>() == true) {
                if (street.Count == 0 || N(street[0]) == 0) continue; double ox = N(h["o"]?[0]), oz = N(h["o"]?[1]), ux = N(h["u"]?[0]), uz = N(h["u"]?[1]), nx = N(h["n"]?[0]), nz = N(h["n"]?[1]), t = N(h["t"]?[0]);
                ax = ox + ux * N(h["s"]?[0]) + nx * t; az = oz + uz * N(h["s"]?[0]) + nz * t; bx = ox + ux * N(h["s"]?[1]) + nx * t; bz = oz + uz * N(h["s"]?[1]) + nz * t;
            } else {
                var fp = h["fp"]!.AsArray(); int best = -1; double bestLength = 2; for (int k = 0; k < fp.Count; k++) { double length = H(N(fp[(k + 1) % fp.Count]?[0]) - N(fp[k]?[0]), N(fp[(k + 1) % fp.Count]?[1]) - N(fp[k]?[1])) * (k < street.Count ? N(street[k]) : 0); if (length > bestLength) { bestLength = length; best = k; } }
                if (best < 0) continue; ax = N(fp[best]?[0]); az = N(fp[best]?[1]); bx = N(fp[(best + 1) % fp.Count]?[0]); bz = N(fp[(best + 1) % fp.Count]?[1]);
            }
            double span = H(bx - ax, bz - az); int bays = Math.Max(1, (int)Math.Floor(span / 3 + .5)); double fraction = (Math.Floor(bays / 2.0) + .5) / bays;
            double x = ax + (bx - ax) * fraction, z = az + (bz - az) * fraction, ex = (bx - ax) / span, ez = (bz - az) / span, outX = -ez, outZ = ex;
            // Which side is the street: the side that is not the house. The footprint decides, never the walk map: a house
            // whose floor the native map leaves open (a room that fills its shell) used to keep its inward normal and lose
            // its door (issue 112). Only a house with no footprint falls back on which side is open ground.
            if (h["fp"] is JsonArray outline && outline.Count >= 3) { if (Inside(outline, x + outX * .4, z + outZ * .4)) { outX = ez; outZ = -ex; } }
            else if (!open(x + outX * 1.2, z + outZ * 1.2, .3)) { outX = ez; outZ = -ex; }
            foreach (double step in new[] { .9, 1.2, 1.6, 2.0 }) { double sx = x + outX * step, sz = z + outZ * step; if (!reachable(sx, sz)) continue;
                var door = new JsonObject { ["house"] = index, ["x"] = Round(x, 10), ["z"] = Round(z, 10), ["out"] = new JsonArray(Round(outX, 100), Round(outZ, 100)), ["sx"] = Round(sx, 10), ["sz"] = Round(sz, 10), ["storeys"] = h["st"]?.DeepClone() };
                if (h["alley"]?.GetValue<bool>() == true) door["alley"] = true; if (h["store"] != null) door["store"] = h["store"]!.DeepClone(); result.Add(door); break;
            }
        }
        return result;
    }
    public static (double x, double z)? ShopSeller(JsonArray houses, JsonObject door)
        => ShopPositions(houses, door) is { } points ? (points.sx, points.sz) : null;
    public static (double x, double z)? ShopFood(JsonArray houses, JsonObject shop)
    {
        var door = new JsonObject { ["x"] = N(shop["wall"]?[0]), ["z"] = N(shop["wall"]?[1]), ["out"] = shop["out"]?.DeepClone() };
        return ShopPositions(houses, door) is { } points ? (points.fx, points.fz) : null;
    }
    private static (double sx, double sz, double fx, double fz)? ShopPositions(JsonArray houses, JsonObject door)
    {
        double wallX = N(door["x"]), wallZ = N(door["z"]), outX = N(door["out"]?[0]), outZ = N(door["out"]?[1]), sideX = -outZ, sideZ = outX, plus = 4.5, minus = 4.5, best = double.PositiveInfinity;
        foreach (var h in houses) { if (h?["gone"]?.GetValue<bool>() == true) continue; var fp = h!["fp"]!.AsArray(); for (int k = 0; k < fp.Count; k++) {
            double ax = N(fp[k]?[0]), az = N(fp[k]?[1]), bx = N(fp[(k + 1) % fp.Count]?[0]), bz = N(fp[(k + 1) % fp.Count]?[1]), ex = bx - ax, ez = bz - az, length = H(ex, ez); if (length < 1 || Math.Abs((ex * outX + ez * outZ) / length) > .1) continue;
            double t = Math.Clamp(((wallX - ax) * ex + (wallZ - az) * ez) / (length * length), 0, 1), distance = H(wallX - ax - ex * t, wallZ - az - ez * t); if (distance > .25 || t <= 0 || t >= 1 || distance >= best) continue;
            best = distance; double pa = (ax - wallX) * sideX + (az - wallZ) * sideZ, pb = (bx - wallX) * sideX + (bz - wallZ) * sideZ; plus = Math.Max(pa, pb); minus = -Math.Min(pa, pb);
        } }
        (double scale, bool awning, double centre)? Layout(double room) { double span = room - .9; return span >= 2.6 ? (1, true, 2) : span >= 1.8 ? (span / 2.6, true, .7 + span / 2) : span >= 1.2 ? (Math.Min(1, span / 1.6), false, .7 + span / 2) : null; }
        var a = Layout(plus); var b = Layout(minus); double Score((double scale, bool awning, double centre)? value) => value == null ? -1 : value.Value.scale + (value.Value.awning ? 1 : 0); int sign = a is { scale: 1, awning: true } || Score(a) >= Score(b) ? 1 : -1; var layout = sign > 0 ? a : b; if (layout == null) return null;
        double along = Math.Max(.6, layout.Value.centre - .8 * layout.Value.scale - .25); return (wallX + sideX * sign * along + outX * .9, wallZ + sideZ * sign * along + outZ * .9, wallX + sideX * sign * layout.Value.centre + outX * .6, wallZ + sideZ * sign * layout.Value.centre + outZ * .6);
    }
}
