using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownLampPlanner
{
    private (double forward, double back) BridgeEnds(IReadOnlyList<(double x, double z)> path)
    {
        var bridges = (population.City["designedBridges"] as JsonObject ?? new()).Select(b => b.Value).Where(b => S(b, "kind") == "draw").Select(b => b!["rect"]!).ToArray(); double length = Length(path); if (length == 0) length = 1; double first = -1, last = -1, total = 0;
        for (int i = 1; i < path.Count; i++) { var a = path[i - 1]; var b = path[i]; double segment = D(a, b); int n = Math.Max(1, (int)Math.Ceiling(segment / .5));
            for (int j = 0; j <= n; j++) { double x = a.x + (b.x - a.x) * j / n, z = a.z + (b.z - a.z) * j / n; if (bridges.Any(rect => x > N(rect[0]) && x < N(rect[2]) && z > N(rect[1]) && z < N(rect[3]))) { double along = total + segment * j / n; if (first < 0) first = along; last = along; } } total += segment;
        } return first < 0 ? (-1, -1) : (last / length, (length - first) / length);
    }
    private static (double distance, double along) NearPath(IReadOnlyList<(double x, double z)> path, double x, double z)
    {
        double best = double.PositiveInfinity, along = 0, total = 0; for (int i = 1; i < path.Count; i++) { var a = path[i - 1]; var b = path[i]; double dx = b.x - a.x, dz = b.z - a.z, squared = dx * dx + dz * dz, t = squared > 0 ? Math.Clamp(((x - a.x) * dx + (z - a.z) * dz) / squared, 0, 1) : 0, distance = NativeTownBackGeometry.D(a.x + dx * t, a.z + dz * t, x, z);
            if (distance < best) { best = distance; along = total + Math.Sqrt(squared) * t; } total += Math.Sqrt(squared);
        } return (best, along);
    }
    private List<int> OnTheWay(IReadOnlyList<JsonObject> lamps, List<int> tour)
    {
        var result = tour.ToList(); for (int i = 1; i < result.Count; i++) {
            var a = lamps[result[i - 1]]; var b = lamps[result[i]]; var leg = Leg((N(a["sx"]), N(a["sz"])), (N(b["sx"]), N(b["sz"]))); if (leg == null || leg.Count < 2) continue; int pick = -1; double first = double.PositiveInfinity;
            for (int j = i + 1; j < result.Count; j++) { var lamp = lamps[result[j]]; var foot = NearPath(leg, N(lamp["sx"]), N(lamp["sz"])); var post = lamp["wicket"] != null ? (double.PositiveInfinity, 0.0) : NearPath(leg, N(lamp["x"]), N(lamp["z"])); var near = foot.distance <= post.Item1 ? foot : post;
                if (near.Item1 <= 1.5 && near.Item2 < first) { first = near.Item2; pick = j; }
            } if (pick >= 0) { int value = result[pick]; result.RemoveAt(pick); result.Insert(i, value); }
        } return result;
    }
    public JsonObject Build(string id, string lamplighter, IReadOnlyList<JsonObject> lamps, (double x, double z) home, double dusk, bool inOrder = false)
    {
        var withFoot = new List<JsonObject>(); foreach (var lamp in lamps) {
            var wicket = IsWall(S(lamp, "id")) ? WicketFoot(N(lamp["x"]), N(lamp["z"])) : null; var foot = wicket == null ? Foot(N(lamp["x"]), N(lamp["z"])) : (wicket.Value.x, wicket.Value.z); if (foot == null) continue;
            var record = new JsonObject { ["id"] = S(lamp, "id"), ["x"] = N(lamp["x"]), ["z"] = N(lamp["z"]), ["sx"] = foot.Value.Item1, ["sz"] = foot.Value.Item2 }; if (wicket != null) record["wicket"] = wicket.Value.gate; withFoot.Add(record);
        }
        var points = withFoot.Select(l => (x: N(l["sx"]), z: N(l["sz"]))).ToArray(); var best = new List<int>();
        if (inOrder) best = Enumerable.Range(0, points.Length).ToList(); else { double length = double.PositiveInfinity; foreach (var p in points) { var tour = Order(points, p); double current = Length(tour.Select(i => points[i]).ToArray()); if (current < length - .01) { length = current; best = tour; } } best = WalkedOrder(points, best); }
        (JsonObject round, List<(double x, double z)> path) Walk(List<int> order) {
            var tour = order.Select(i => withFoot[i]).ToArray(); var path = tour.Length > 0 ? new List<(double x, double z)> { (N(tour[0]["sx"]), N(tour[0]["sz"])) } : new(); var distances = new List<double> { 0 }; var kept = tour.Length > 0 ? new List<JsonObject> { tour[0] } : new();
            foreach (var b in tour.Skip(1)) { var a = kept[^1]; var leg = Leg((N(a["sx"]), N(a["sz"])), (N(b["sx"]), N(b["sz"]))); if (leg == null) continue; path.AddRange(leg.Skip(1)); distances.Add(Length(path)); kept.Add(b); }
            return (new JsonObject { ["id"] = id, ["lamplighter"] = lamplighter, ["lamps"] = new JsonArray(kept.Select(l => (JsonNode)l.DeepClone()).ToArray()), ["path"] = Route(path), ["at"] = new JsonArray(distances.Take(kept.Count).Select(d => (JsonNode)JsonValue.Create(d)!).ToArray()), ["len"] = Length(path), ["dusk"] = dusk }, path);
        }
        if (best.Count < 2) return Walk(best).round; var round = Walk(best); var bridges = BridgeEnds(round.path); int gateAt = best.FindIndex(i => withFoot[i]["wicket"] != null); bool back;
        if (inOrder && gateAt >= 0) back = gateAt >= best.Count / 2.0; else if (bridges.forward >= 0 && Math.Abs(bridges.forward - bridges.back) > .05) back = bridges.back < bridges.forward; else back = D(points[best[^1]], home) < D(points[best[0]], home);
        if (back) best.Reverse(); return Walk(OnTheWay(withFoot, best)).round;
    }
}
