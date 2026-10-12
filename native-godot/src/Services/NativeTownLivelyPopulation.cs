using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownLivelyPopulation
{
    private readonly NativeTownPopulation population;
    public NativeTownLivelyPopulation(NativeTownPopulation population) => this.population = population;
    public JsonObject Generate(uint seed, JsonObject town, IReadOnlyCollection<int>? kept = null) => new Builder(population, seed, town, kept ?? Array.Empty<int>()).Make();
    public int FixSights()
    {
        var sights = A(population.Facts["lively"]?["SIGHTS"]); var last = sights[^1]!; int count = 0; var c = population.Host.Context;
        foreach (var row in c.Rows("SELECT id,data_json FROM resident WHERE trade='tourist'")) {
            var r = System.Text.Json.Nodes.JsonNode.Parse(S(row, "data_json"))!.AsObject(); var route = r["work"]?["route"] as JsonArray; if (route == null) continue; bool hit = false;
            for (int i = 0; i < route.Count; i++) { if (NativeTownBackGeometry.D(N(route[i]?[0]), N(route[i]?[1]), -305.5, 204) > 1) continue; route[i] = new JsonArray(N(last[0]), N(last[1])); if (r["work"]?["faces"] is JsonArray faces) faces[i] = Round(Math.Atan2(N(last[2]) - N(last[0]), N(last[3]) - N(last[1])) * 1000) / 1000; hit = true; }
            if (hit) { c.Execute("UPDATE resident SET data_json=$p0 WHERE id=$p1", r.ToJsonString(), S(row, "id")); count++; }
        } if (count > 0) population.Town.Clear(); return count;
    }
    public int Ensure(uint seed)
    {
        var c = population.Host.Context; if (c.Scalar<long>("SELECT COUNT(*) FROM resident") == 0) return 0; FixSights(); var trades = A(population.Facts["lively"]?["LIVELY_TRADES"]).Select(t => t!.GetValue<string>()).ToHashSet(); if (population.Town.Residents.Values.Any(r => !S(r, "id").StartsWith("bk", StringComparison.Ordinal) && trades.Contains(S(r, "trade")))) return 0;
        var kept = A(c.World("homes")?["homes"]).Select(h => (int)N(h?["house"])).ToArray(); var made = Generate(seed, population.Snapshot(), kept); int count = 0;
        c.Atomic(() => { population.AddPlaces(made["places"]!.AsObject()); foreach (var r in A(made["residents"])) { if (c.One("SELECT 1 FROM npc WHERE id=$p0", S(r, "id")) != null) continue; population.AddResident(r!.AsObject()); count++; } }); return count;
    }
    private sealed partial class Builder
    {
        private readonly NativeTownPopulation p;
        private readonly NativeTownRoleSeed k;
        private readonly NativeTownRoundPlanner rounds;
        private readonly JsonObject outPlaces = new();
        private readonly JsonArray output = new();
        private readonly HashSet<int> kept, inWorld;
        private readonly HashSet<string> forbidden;
        private readonly List<(double x, double z)> taken = new();
        private readonly string[] taverns, plays, markets;
        private int next;
        private JsonObject? All(string id) => (outPlaces[id] ?? k.Places[id]) as JsonObject;
        private string Nearest(IEnumerable<string> keys, (double x, double z) at) { var list = keys.Where(key => All(key) != null).ToArray(); if (list.Length == 0) throw new InvalidOperationException("Native lively destination is missing"); string best = list[0]; foreach (string key in list.Skip(1)) if (NativeTownBackGeometry.D(N(All(key)?["x"]), N(All(key)?["z"]), at.x, at.z) < NativeTownBackGeometry.D(N(All(best)?["x"]), N(All(best)?["z"]), at.x, at.z)) best = key; return best; }
        private (double x, double z) Snap(double x, double z, double maximum) => p.Snap(x, z, maximum) ?? (x, z);
        private JsonObject FreeHome(double x, double z) {
            var selected = p.Doors.Where(d => !k.UsedHouses.Contains((int)N(d["house"])) && !taken.Any(q => NativeTownBackGeometry.D(q.x, q.z, N(d["sx"]), N(d["sz"])) < 4)).OrderBy(d => NativeTownBackGeometry.D(N(d["sx"]), N(d["sz"]), x, z)).FirstOrDefault()
                ?? p.Doors.Where(d => !kept.Contains((int)N(d["house"])) && !inWorld.Contains((int)N(d["house"]))).OrderBy(d => NativeTownBackGeometry.D(N(d["sx"]), N(d["sz"]), x, z)).FirstOrDefault()
                ?? p.Doors.OrderBy(d => NativeTownBackGeometry.D(N(d["sx"]), N(d["sz"]), x, z)).First();
            k.UsedHouses.Add((int)N(selected["house"])); taken.Add((N(selected["sx"]), N(selected["sz"]))); return Home(selected);
        }
        private (string first, string surname) Name(string sex, string? surname = null) {
            for (int i = 0; i < 80; i++) { string first = k.Pick(A(k.Facts[sex == "m" ? "MEN" : "WOMEN"])), sur = surname ?? k.Pick(A(k.Facts["SURNAMES"])); if (forbidden.Contains(first) || forbidden.Contains(sur) || k.UsedNames.Contains(first + " " + sur)) continue; k.UsedNames.Add(first + " " + sur); return (first, sur); }
            string extra = k.Pick(A(k.Facts["SURNAMES"])) + " " + next; return (k.Pick(A(k.Facts[sex == "m" ? "MEN" : "WOMEN"])), extra);
        }
        private JsonObject Add(string trade, string kind, string sex, int age, JsonObject home, int household, string role, JsonObject work, (string first, string surname)? name = null, string? full = null) {
            var nm = name ?? Name(sex); k.UsedNames.Add(full ?? nm.first + " " + nm.surname); var r = k.Person("lv" + (next++).ToString("D3"), trade, kind, sex, age, home, household, role, nm, work, new(), new(), true); if (full != null) r["name"] = full; output.Add(r); return r;
        }
        private static void Schedule(JsonObject r, JsonArray day, JsonArray sunday) => r["sched"] = new JsonObject { ["day"] = NativeTownPopulation.Tidy(day), ["sunday"] = NativeTownPopulation.Tidy(sunday) };
        private void Church(JsonArray day, JsonObject r, double from, double to) { if (N(r["stats"]?["piety"]) >= 4) day.Add(Seg(k.J(from), k.J(to), "church", "church")); }
        public Builder(NativeTownPopulation population, uint seed, JsonObject town, IReadOnlyCollection<int> preserved) {
            p = population; k = new(p, seed ^ 0x11fe1873, "lively", town); rounds = new(p); kept = preserved.ToHashSet(); inWorld = A(p.Kept["houses"]).Select(h => (int)N(h?["house"])).ToHashSet(); k.UsedHouses.UnionWith(kept); forbidden = A(k.Facts["TAKEN"]).Select(t => t!.GetValue<string>()).ToHashSet();
            foreach (var r in k.Residents) { taken.Add((N(r["home"]?["sx"]), N(r["home"]?["sz"]))); if (r["work"]?["door"] is { } d) taken.Add((N(d[0]), N(d[1]))); } foreach (var place in k.Places) if (place.Value?["door"] is { } d) taken.Add((N(d[0]), N(d[1])));
            next = k.Residents.Select(r => System.Text.RegularExpressions.Regex.IsMatch(S(r, "id"), "^lv\\d+$") ? int.Parse(S(r, "id")[2..]) : 0).DefaultIfEmpty(0).Max() + 1;
            taverns = A(p.Facts["TAVERNS"]).Select(t => "tavern:" + S(t, "id")).Where(key => All(key) != null).ToArray(); plays = k.Places.Select(q => q.Key).Where(key => key.StartsWith("play:", StringComparison.Ordinal)).ToArray(); markets = k.Places.Select(q => q.Key).Where(key => key.StartsWith("market:", StringComparison.Ordinal)).ToArray();
        }
        public JsonObject Make() { MakeRounds(); MakeStalls(); MakeBeggars(); MakeBeguines(); MakeTravellers(); return new JsonObject { ["residents"] = output, ["places"] = outPlaces }; }
    }
}
