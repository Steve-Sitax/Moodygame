using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

public sealed class NativeTownStandingPopulation
{
    private readonly NativeTownPopulation population;
    public NativeTownStandingPopulation(NativeTownPopulation population) => this.population = population;
    public int Ensure(uint seed) => Install(population, "wu", () => Generate(seed, population.Snapshot()), "quays");
    public static string PoliceShift(JsonObject r) { var first = A(r["sched"]?["day"]).FirstOrDefault(); return first != null ? N(first[0]) >= 17 ? "night" : "day" : S(r, "id")[^1] % 2 == 0 ? "night" : "day"; }
    public JsonObject Generate(uint seed, JsonObject town)
    {
        var k = new NativeTownRoleSeed(population, seed ^ 0x3a1c0926, "standing", town); var output = new JsonArray(); int next = k.Residents.Count(r => System.Text.RegularExpressions.Regex.IsMatch(S(r, "id"), "^wu\\d+$"));
        (double x, double z)? Snap(double x, double z) { var q = population.Snap(x, z, 12); return q == null ? null : (NativeTownBackGeometry.R1(q.Value.x), NativeTownBackGeometry.R1(q.Value.z)); }
        List<(double x, double z)> RouteOf(JsonArray points) => points.Select(q => Snap(N(q?[0]), N(q?[1]))).Where(q => q != null).Select(q => q!.Value).ToList();
        void Add(string trade, string kind, int age, (double x, double z) near, JsonObject work, JsonArray day, JsonArray sunday) { var name = k.Name(() => next.ToString()); string id = "wu" + (++next).ToString("D2"); int hh = ++k.Household; var home = Home(k.DoorNear(near.x, near.z)); output.Add(k.Person(id, trade, kind, "m", age, home, hh, "single", name, work, day, sunday)); }
        var customs = k.Residents.Where(r => S(r, "trade") == "customs").ToArray();
        void Customs(string place, JsonArray points, (double x, double z) middle, bool night) {
            var route = RouteOf(points); if (route.Count < 2 || customs.Any(r => S(r["work"], "place") == place && (PoliceShift(r) == "night") == night)) return;
            var day = night ? new JsonArray(Seg(k.J(17.75), 31.25, "work")) : new JsonArray(Seg(k.J(6.75), 11.5, "work"), Seg(12.25, k.J(18.25), "work")); int age = k.Int(28, 55); var work = new JsonObject { ["place"] = place, ["kind"] = "inspect", ["route"] = Route(route), ["faces"] = new JsonArray(route.Select(q => (JsonNode)JsonValue.Create(Round(Math.Atan2(q.x - middle.x, q.z - middle.z) * 100) / 100)!).ToArray()) }; var sunday = night ? day.DeepClone().AsArray() : new JsonArray(Seg(k.J(8), 12, "work")); Add("customs", "customs", age, middle, work, day, sunday);
        }
        if (k.Places["entrepot"] != null) Customs("entrepot", A(k.Facts["ENTREPOT_ROUTE"]), (N(k.Places["entrepot"]?["x"]), N(k.Places["entrepot"]?["z"])), false); Customs("lock", A(k.Facts["LOCK_ROUTE"]), (110, 24), false); Customs("rijnkaai", A(k.Facts["RIJNKAAI_NIGHT"]), (0, 30), true);
        var agents = k.Residents.Where(r => S(r, "trade") == "police").ToArray(); foreach (var beat in k.Facts["BEATS"]!.AsObject()) {
            var route = RouteOf(A(beat.Value)); if (route.Count < 2) continue; foreach (string shift in new[] { "day", "night" }) {
                if (agents.Any(r => S(r["work"], "place") == beat.Key && PoliceShift(r) == shift)) continue; var day = shift == "night" ? new JsonArray(Seg(k.J(18), 30, "work")) : new JsonArray(Seg(6, 12, "work"), Seg(12.75, k.J(19), "work")); int age = k.Int(24, 50); Add("police", "police", age, route[0], new() { ["place"] = beat.Key, ["kind"] = "patrol", ["route"] = Route(route) }, day, day.DeepClone().AsArray());
            }
        }
        var thieves = k.Residents.Where(r => S(r, "trade") == "thief" && A(r["sched"]?["day"]).Any(s => s?[2]?.GetValue<string>() == "loiter" && s?[3]?.GetValue<string>() is "rijnkaai" or "werf")).ToArray();
        foreach (string quay in new[] { "rijnkaai", "werf" }) {
            if (thieves.Any(r => A(r["sched"]?["day"]).Any(s => s?[3]?.GetValue<string>() == quay)) || k.Places[quay] == null) continue; var at = (x: N(k.Places[quay]?["x"]), z: N(k.Places[quay]?["z"]));
            var haunts = A(population.Facts["HAUNTS"]).Select(q => (point: Snap(N(q?[0]), N(q?[1])), distance: NativeTownBackGeometry.D(N(q?[0]), N(q?[1]), at.x, at.z))).Where(q => q.point != null).OrderBy(q => q.distance).Take(4).Select(q => q.point!.Value).ToArray();
            string? tavern = k.Places.Where(q => q.Key.StartsWith("tavern:", StringComparison.Ordinal)).OrderBy(q => NativeTownBackGeometry.D(N(q.Value?["x"]), N(q.Value?["z"]), at.x, at.z)).Select(q => q.Key).FirstOrDefault();
            var day = new JsonArray(Seg(k.J(10), k.J(17), "loiter", quay)); if (tavern != null) day.Add(Seg(k.J(18), 21, "tavern", tavern)); day.Add(Seg(21, k.J(28, .5), "work")); int age = k.Int(17, 32); Add("thief", "thief", age, at, new() { ["place"] = "night", ["kind"] = "roam", ["route"] = Route(haunts) }, day, day.DeepClone().AsArray());
        }
        return new JsonObject { ["residents"] = output };
    }
}
