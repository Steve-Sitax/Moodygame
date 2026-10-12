using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Native back-town households, parish rounds, doorstep groups, watchmen and Sunday walks.</summary>
public sealed partial class NativeTownBackPopulation
{
    private readonly NativeTownPopulation population;
    public NativeTownBackPopulation(NativeTownPopulation population) => this.population = population;
    public JsonObject Generate(uint seed, JsonObject town, IReadOnlyCollection<int>? kept = null) => new Builder(population, seed, town, kept ?? Array.Empty<int>()).Make();
    public int Ensure(uint seed)
    {
        var c = population.Host.Context;
        if (c.Scalar<long>("SELECT COUNT(*) FROM resident") == 0 || c.Scalar<long>("SELECT COUNT(*) FROM resident WHERE id LIKE 'bk%'") > 0 || c.World("town") == null) return 0;
        var kept = NativeTownPopulation.A(c.World("homes")?["homes"]).Select(h => (int)NativeTown.N(h?["house"])).ToArray(); var made = Generate(seed, population.Snapshot(), kept); int count = 0;
        c.Atomic(() => { population.AddPlaces(made["places"]!.AsObject()); foreach (var r in made["residents"]!.AsArray()) { if (c.One("SELECT 1 FROM npc WHERE id=$p0", NativeTown.S(r, "id")) != null) continue; population.AddResident(r!.AsObject()); count++; } }); return count;
    }
    private sealed partial class Builder
    {
        private readonly NativeTownPopulation p;
        private readonly NativeTownBackGeometry g;
        private readonly NativeTownRoundPlanner rounds;
        private readonly Func<double> rng;
        private readonly JsonObject places;
        private readonly List<JsonObject> residents;
        private readonly JsonObject outPlaces = new();
        private readonly List<JsonObject> output = new();
        private readonly HashSet<string> usedNames;
        private readonly HashSet<int> usedHouses;
        private readonly Dictionary<(int x, int z), List<(double x, double z)>> taken = new();
        private readonly JsonObject names;
        private readonly HashSet<string> forbidden;
        private readonly List<JsonObject> doors, backDoors;
        private readonly string[] markets;
        private readonly double scale;
        private int nextId, household;
        private static double N(JsonNode? n) => NativeTown.N(n);
        private static string S(JsonNode? n, string key, string fallback = "") => NativeTown.S(n, key, fallback);
        private static JsonArray A(JsonNode? n) => NativeTownPopulation.A(n);
        private static double R(double n) => Math.Floor(n + .5);
        private static JsonArray Pt(double x, double z) => new(x, z);
        private static JsonArray Route(IEnumerable<(double x, double z)> points) => new(points.Select(q => (JsonNode)Pt(q.x, q.z)).ToArray());
        private static JsonObject Work(string place, string kind) => new() { ["place"] = place, ["kind"] = kind };
        private static (double x, double z) At(JsonObject obj) => (N(obj["x"]), N(obj["z"]));
        private static (double x, double z) Step(JsonObject obj) => (N(obj["sx"]), N(obj["sz"]));
        private static double D((double x, double z) a, (double x, double z) b) => NativeTownBackGeometry.D(a.x, a.z, b.x, b.z);
        private static bool Alley(JsonObject d) => d["alley"]?.GetValue<bool>() == true;
        private double J(double hour, double spread = .25) => R((hour + (rng() * 2 - 1) * spread) * 4) / 4;
        private int Int(int a, int b) => (int)Math.Floor(a + rng() * (b + 1 - a));
        private bool Chance(double chance) => rng() < chance;
        private string Pick(JsonArray items) => items[(int)Math.Floor(rng() * items.Count)]!.GetValue<string>();
        private T Pick<T>(IReadOnlyList<T> items) => items[(int)Math.Floor(rng() * items.Count)];
        private JsonObject All(string id) => (outPlaces[id] ?? places[id])!.AsObject();
        private string Nearest(IEnumerable<string> keys, (double x, double z) at) { var list = keys.ToArray(); if (list.Length == 0) throw new InvalidOperationException("A native back-town place has no eligible destinations"); string best = list[0]; foreach (string key in list.Skip(1)) if (D(At(All(key)), at) < D(At(All(best)), at)) best = key; return best; }
        private static JsonObject Home(JsonObject d) => new() { ["house"] = N(d["house"]), ["x"] = N(d["x"]), ["z"] = N(d["z"]), ["sx"] = N(d["sx"]), ["sz"] = N(d["sz"]) };
        private string District(double x, double z) { var authored = A(p.Facts["PLACES"]); var best = authored[0]!.AsObject(); foreach (var q in authored.Skip(1)) if (D(At(q!.AsObject()), (x, z)) < D(At(best), (x, z))) best = q.AsObject(); return S(best, "district"); }
        private string Place(string id, string label, double x, double z, double radius, JsonObject? extra = null) { var place = new JsonObject { ["label"] = label, ["x"] = NativeTownBackGeometry.R1(x), ["z"] = NativeTownBackGeometry.R1(z), ["r"] = radius, ["district"] = District(x, z) }; if (extra != null) foreach (var field in extra) place[field.Key] = field.Value?.DeepClone(); outPlaces[id] = place; return id; }
        private static (int x, int z) Cell(double x, double z) => ((int)Math.Floor(x / 3), (int)Math.Floor(z / 3));
        private void Take((double x, double z) at) { var key = Cell(at.x, at.z); if (!taken.TryGetValue(key, out var points)) taken[key] = points = new(); points.Add(at); }
        private bool TakenNear(double x, double z) { var key = Cell(x, z); for (int i = -1; i <= 1; i++) for (int k = -1; k <= 1; k++) if (taken.GetValueOrDefault((key.x + i, key.z + k))?.Any(q => D(q, (x, z)) < 2.5) == true) return true; return false; }
        private JsonObject? FreeDoor(double x, double z, double maximum, Func<JsonObject, bool>? predicate = null) {
            JsonObject? best = null; double distance = maximum; foreach (var d in backDoors) { if (usedHouses.Contains((int)N(d["house"])) || predicate?.Invoke(d) == false) continue; double value = D(Step(d), (x, z)); if (value >= distance || TakenNear(N(d["sx"]), N(d["sz"]))) continue; best = d; distance = value; }
            if (best != null) { usedHouses.Add((int)N(best["house"])); Take(Step(best)); } return best;
        }
        private string Surname() { for (int i = 0; i < 30; i++) { string s = Pick(A(names["SURNAMES"])); if (!forbidden.Contains(s)) return s; } return Pick(A(names["SURNAMES"])); }
        private (string first, string surname) Name(string sex, string surname) { for (int i = 0; i < 60; i++) { string first = Pick(A(names[sex == "m" ? "MEN" : "WOMEN"])); if (!forbidden.Contains(first) && !usedNames.Contains(first + " " + surname)) return (first, surname); } return (Pick(A(names[sex == "m" ? "MEN" : "WOMEN"])), surname + " " + nextId); }
        private JsonObject Stats(string trade, int age) { var def = p.Facts["TRADES"]![trade]!; var result = new JsonObject(); foreach (var field in A(p.Facts["STATS"])) { string key = field!.GetValue<string>(); double value = 5 + (rng() + rng() + rng() - 1.5) * 4 + N(def["bias"]?[key]); if (age >= 55 && (key == "piety" || key == "gossip")) value++; if (age < 25 && key == "courage") value++; if (age < 15 && key == "gossip") value -= 2; result[key] = Math.Clamp(R(value), 0, 10); } result["wealth"] = Int((int)N(def["wealth"]?[0]), (int)N(def["wealth"]?[1])); return result; }
        private JsonObject Add(string trade, string kind, string sex, int age, JsonObject home, int hh, string role, string surname, JsonObject work, JsonArray day, JsonArray sunday) {
            var name = Name(sex, surname); string full = name.first + " " + name.surname; usedNames.Add(full); var result = new JsonObject { ["id"] = "bk" + (nextId++).ToString("D3"), ["first"] = name.first, ["surname"] = name.surname, ["name"] = full, ["age"] = age, ["sex"] = sex, ["household"] = hh, ["family_role"] = role, ["trade"] = trade, ["faction"] = p.Facts["TRADES"]![trade]!["faction"]?.DeepClone(), ["kind"] = kind, ["home"] = home.DeepClone(), ["work"] = work.DeepClone(), ["sched"] = new JsonObject { ["day"] = NativeTownPopulation.Tidy(day), ["sunday"] = NativeTownPopulation.Tidy(sunday) }, ["stats"] = Stats(trade, age), ["dog"] = null }; output.Add(result); return result;
        }
        private static JsonArray Seg(double from, double to, string act, string? place = null) => place == null ? new(from, to, act) : new(from, to, act, place);
        private void ChurchOf(JsonArray list, JsonObject r, double from, double to, string place) { if (N(r["stats"]?["piety"]) >= 5) list.Add(Seg(J(from), J(to), "church", place)); }
        private static void MinStat(JsonObject r, string key, double value) => r["stats"]![key] = Math.Min(N(r["stats"]?[key]), value);
        private static void MaxStat(JsonObject r, string key, double value) => r["stats"]![key] = Math.Max(N(r["stats"]?[key]), value);
        public Builder(NativeTownPopulation population, uint seed, JsonObject town, IReadOnlyCollection<int> kept) {
            p = population; g = new(p); rounds = new(p); rng = NativeTownPopulation.Random(seed ^ 0x0bac7011); places = town["places"]!.AsObject(); residents = A(town["residents"]).Select(r => r!.AsObject()).ToList(); names = p.Facts["back"]!.AsObject(); forbidden = A(names["TAKEN"]).Select(n => n!.GetValue<string>()).ToHashSet();
            scale = Math.Clamp(residents.Count / 290.0, .55, 1.5); usedNames = residents.Select(r => S(r, "name")).ToHashSet(); usedHouses = residents.Select(r => (int)N(r["home"]?["house"])).Where(h => h >= 0).ToHashSet(); foreach (var h in A(p.Kept["houses"])) usedHouses.Add((int)N(h?["house"])); foreach (int h in kept) usedHouses.Add(h);
            foreach (var r in residents) { Take(Step(r["home"]!.AsObject())); if (r["work"]?["door"] is { } d) Take((N(d[0]), N(d[1]))); } foreach (var place in places) if (place.Value?["door"] is { } d) Take((N(d[0]), N(d[1])));
            nextId = residents.Select(r => S(r, "id") is string id && System.Text.RegularExpressions.Regex.IsMatch(id, "^bk\\d+$") ? int.Parse(id[2..]) : 0).DefaultIfEmpty(0).Max() + 1; household = residents.Select(r => (int)N(r["household"])).DefaultIfEmpty(0).Max();
            doors = p.Doors.Where(d => p.Reachable(N(d["sx"]), N(d["sz"]))).ToList(); backDoors = doors.Where(d => NativeTownBackGeometry.InBack(N(d["sx"]), N(d["sz"]))).ToList(); markets = places.Select(q => q.Key).Where(k => k.StartsWith("market:", StringComparison.Ordinal)).ToArray();
        }
        public JsonObject Make() { MakePlaces(); MakeTaverns(); MakePoor(); MakeBetter(); MakeTrades(); MakeLovers(); return new JsonObject { ["residents"] = new JsonArray(output.Select(r => (JsonNode)r).ToArray()), ["places"] = outPlaces }; }
    }
}
