using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

/// <summary>Native lamplighter assignment and native graph tours; existing saved men keep their identities.</summary>
public sealed class NativeTownLampsPopulation
{
    private readonly NativeTownPopulation population;
    private readonly NativeTownLampPlanner planner;
    public NativeTownLampsPopulation(NativeTownPopulation population) { this.population = population; planner = new(population); }
    private JsonObject Facts => population.Facts["lamp"]!.AsObject();
    private JsonArray Topology() => new(A(population.Facts["LAMPS"]).OrderBy(l => S(l, "id"), StringComparer.Ordinal).Select(l => (JsonNode)new JsonArray(S(l, "id"), N(l?["x"]), N(l?["z"]), l?["hung"]?.GetValue<bool>() == true)).ToArray());
    private bool LegacyTopologyMatches(JsonObject previous)
    {
        var lamps = A(previous["rounds"]).SelectMany(r => A(r?["lamps"])).ToArray(); var expected = A(population.Facts["LAMPS"]);
        return lamps.Length == expected.Count && lamps.Select(l => S(l, "id")).Distinct().Count() == expected.Count && expected.All(l => lamps.Any(p => S(p, "id") == S(l, "id") && N(p?["x"]) == N(l?["x"]) && N(p?["z"]) == N(l?["z"])));
    }
    public JsonObject? Generate(JsonObject town, JsonObject? previous = null)
    {
        var residents = A(town["residents"]).Select(r => r!.AsObject()).ToArray(); if (residents.Length == 0) return null; var specs = A(Facts["ROUNDS"]).Select(s => s!.AsObject()).ToArray(); var lamps = A(population.Facts["LAMPS"]).Select(l => l!.AsObject()).ToArray(); var lighters = residents.Where(r => S(r, "trade") == "lamplighter").OrderBy(r => S(r, "id"), StringComparer.Ordinal).ToArray(); var who = new Dictionary<string, JsonObject>();
        bool Taken(JsonObject r) => who.Values.Contains(r); JsonObject? Near(IEnumerable<JsonObject> candidates, JsonObject spec) => candidates.OrderBy(r => NativeTownBackGeometry.D(N(r["home"]?["sx"]), N(r["home"]?["sz"]), N(spec["start"]?[0]), N(spec["start"]?[1]))).FirstOrDefault();
        foreach (var spec in specs) { string? id = A(previous?["rounds"]).FirstOrDefault(round => S(round, "id") == S(spec, "id"))?["lamplighter"]?.GetValue<string>(); var r = id == null ? null : lighters.FirstOrDefault(l => S(l, "id") == id); if (r != null && !Taken(r)) who[S(spec, "id")] = r; }
        foreach (var spec in specs) { if (who.ContainsKey(S(spec, "id"))) continue; var r = Near(lighters.Where(r => !Taken(r)), spec); if (r != null) who[S(spec, "id")] = r; }
        foreach (var spec in specs) { if (who.ContainsKey(S(spec, "id"))) continue; var r = Near(residents.Where(r => !Taken(r) && !System.Text.RegularExpressions.Regex.IsMatch(S(r, "id"), "^bk[0-9]+$") && S(r, "sex") == "m" && N(r["age"]) >= 24 && N(r["age"]) <= 58 && S(r, "trade") is "docker" or "porter" && S(r, "family_role") is "head" or "single" or "lodger" or "widower" or "son"), spec); if (r != null) who[S(spec, "id")] = r; }
        var picks = specs.Where(s => who.ContainsKey(S(s, "id"))).ToArray(); if (picks.Length == 0) return null; var sets = picks.ToDictionary(s => S(s, "id"), _ => new List<JsonObject>());
        foreach (var lamp in lamps) { string own = planner.RoundOf(lamp); if (!sets.ContainsKey(own)) own = S(picks.OrderBy(s => NativeTownBackGeometry.D(N(s["start"]?[0]), N(s["start"]?[1]), N(lamp["x"]), N(lamp["z"]))).First(), "id"); sets[own].Add(lamp); }
        var rounds = new JsonArray(); var changed = new JsonArray(); int turn = 0;
        foreach (var spec in picks) {
            string id = S(spec, "id"); var r = who[id]; double dusk = N(Facts["DUSK_START"]) + turn++ % (int)N(Facts["DUSK_SLOTS"]) * N(Facts["DUSK_STAGGER_H"]); bool wall = id.StartsWith("wall_", StringComparison.Ordinal); var mine = sets[id]; if (wall) mine = mine.OrderBy(l => planner.WallAlong(N(l["x"]), N(l["z"]))).ToList();
            var round = planner.Build(id, S(r, "id"), mine, (N(r["home"]?["sx"]), N(r["home"]?["sz"])), dusk, wall); rounds.Add(round); var rec = r.DeepClone().AsObject(); rec["trade"] = "lamplighter"; rec["faction"] = population.Facts["TRADES"]!["lamplighter"]!["faction"]?.DeepClone(); rec["work"] = new JsonObject { ["place"] = "lamps", ["kind"] = "patrol", ["route"] = new JsonArray(A(round["lamps"]).Select(l => (JsonNode)new JsonArray(N(l?["sx"]), N(l?["sz"]))).ToArray()) };
            JsonArray Schedule(string day) { var list = new JsonArray(A(r["sched"]?[day]).Where(s => s?[2]?.GetValue<string>() != "work" && N(s?[1]) <= dusk - .25 && !(N(s?[0]) < N(Facts["DAWN_LAST"]) && N(s?[1]) > N(Facts["DAWN_START"]) - .1)).Select(s => s!.DeepClone()).ToArray()); list.Add(Seg(N(Facts["DAWN_START"]) - .1, N(Facts["DAWN_LAST"]), "work")); list.Add(Seg(dusk - .1, N(Facts["DUSK_LAST"]), "work")); return NativeTownPopulation.Tidy(list); }
            rec["sched"] = new JsonObject { ["day"] = Schedule("day"), ["sunday"] = Schedule("sunday") }; changed.Add(rec);
        }
        return new JsonObject { ["state"] = new JsonObject { ["v"] = N(Facts["LAMPS_VERSION"]), ["rounds"] = rounds }, ["residents"] = changed };
    }
    public JsonObject? Ensure(uint seed)
    {
        var c = population.Host.Context; if (c.Scalar<long>("SELECT COUNT(*) FROM resident") == 0) return null; var previous = c.World("townlife_lamps") as JsonObject; var topology = Topology(); var savedTopology = c.World("townlife_lamps:topology");
        if (N(previous?["v"]) == N(Facts["LAMPS_VERSION"]) && A(previous?["rounds"]).Count > 0 && (savedTopology != null ? JsonNode.DeepEquals(savedTopology, topology) : LegacyTopologyMatches(previous!))) { if (savedTopology == null) c.SetWorld("townlife_lamps:topology", topology); return previous; }
        var made = Generate(population.Snapshot(), previous); if (made == null) return null;
        c.Atomic(() => { foreach (var r in A(made["residents"])) { c.Execute("UPDATE resident SET trade='lamplighter',data_json=$p0 WHERE id=$p1", r!.ToJsonString(), S(r, "id")); c.Execute("UPDATE npc SET role=$p0 WHERE id=$p1", S(population.Facts["TRADES"]?["lamplighter"], "label"), S(r, "id")); } c.SetWorld("townlife_lamps", made["state"]); c.SetWorld("townlife_lamps:topology", topology); }); population.Town.Clear(); return made["state"]!.DeepClone().AsObject();
    }
}
