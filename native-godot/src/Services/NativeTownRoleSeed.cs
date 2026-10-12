using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Common authored name/stat/home rules for native standing, mill and rampart populations.</summary>
internal sealed class NativeTownRoleSeed
{
    public readonly NativeTownPopulation Population;
    public readonly JsonObject Places, Facts;
    public readonly List<JsonObject> Residents;
    public readonly HashSet<string> UsedNames, Have;
    public readonly HashSet<int> UsedHouses;
    public readonly Func<double> Rng;
    public int Household;
    private readonly HashSet<string> forbidden;
    public NativeTownRoleSeed(NativeTownPopulation population, uint seed, string facts, JsonObject town)
    {
        Population = population; Facts = population.Facts[facts]!.AsObject(); Places = town["places"]!.AsObject(); Residents = A(town["residents"]).Select(r => r!.AsObject()).ToList(); Rng = NativeTownPopulation.Random(seed);
        UsedNames = Residents.Select(r => S(r, "name")).ToHashSet(); Have = Residents.Select(r => S(r, "id")).ToHashSet(); UsedHouses = Residents.Select(r => (int)N(r["home"]?["house"])).Where(h => h >= 0).ToHashSet(); foreach (var h in A(population.Kept["houses"])) UsedHouses.Add((int)N(h?["house"])); Household = Residents.Select(r => (int)N(r["household"])).DefaultIfEmpty(0).Max(); forbidden = A(Facts["TAKEN"]).Select(s => s!.GetValue<string>()).ToHashSet();
    }
    public static double N(JsonNode? node) => NativeTown.N(node);
    public static string S(JsonNode? node, string key, string fallback = "") => NativeTown.S(node, key, fallback);
    public static JsonArray A(JsonNode? node) => NativeTownPopulation.A(node);
    public static double Round(double value) => Math.Floor(value + .5);
    public int Int(int a, int b) => (int)Math.Floor(a + Rng() * (b + 1 - a));
    public double J(double hour, double spread = .25) => Round((hour + (Rng() * 2 - 1) * spread) * 4) / 4;
    public string Pick(JsonArray items) => items[(int)Math.Floor(Rng() * items.Count)]!.GetValue<string>();
    public JsonObject DoorNear(double x, double z, double maximum = 220)
    {
        var sorted = Population.Doors.Select(d => (d, distance: NativeTownBackGeometry.D(N(d["sx"]), N(d["sz"]), x, z))).OrderBy(q => q.distance).ToArray(); var selected = sorted.FirstOrDefault(q => q.distance <= maximum && !UsedHouses.Contains((int)N(q.d["house"]))); var door = selected.d ?? sorted[0].d; UsedHouses.Add((int)N(door["house"])); return door;
    }
    public static JsonObject Home(JsonObject door) => new() { ["house"] = N(door["house"]), ["x"] = N(door["x"]), ["z"] = N(door["z"]), ["sx"] = N(door["sx"]), ["sz"] = N(door["sz"]) };
    public (string first, string surname) Name(Func<string> fallback, string? surname = null, string firstKey = "FIRST")
    {
        for (int i = 0; i < 80; i++) { string first = Pick(A(Facts[firstKey])), sur = surname ?? Pick(A(Facts["SUR"])); if (forbidden.Contains(first) || forbidden.Contains(sur) || UsedNames.Contains(first + " " + sur)) continue; UsedNames.Add(first + " " + sur); return (first, sur); }
        return (Pick(A(Facts[firstKey])), Pick(A(Facts["SUR"])) + "-" + fallback());
    }
    public JsonObject Stats(string trade, int? age = null)
    {
        var definition = Population.Facts["TRADES"]![trade]!; var result = new JsonObject(); foreach (var field in A(Population.Facts["STATS"])) { string key = field!.GetValue<string>(); double v = 5 + (Rng() + Rng() + Rng() - 1.5) * 4 + N(definition["bias"]?[key]); if (age >= 55 && key is "piety" or "gossip") v++; if (age < 25 && key == "courage") v++; if (age < 15 && key == "gossip") v -= 2; result[key] = Math.Clamp(Round(v), 0, 10); } result["wealth"] = Int((int)N(definition["wealth"]?[0]), (int)N(definition["wealth"]?[1])); return result;
    }
    public JsonObject Person(string id, string trade, string kind, string sex, int age, JsonObject home, int household, string role, (string first, string surname) name, JsonObject work, JsonArray day, JsonArray sunday, bool ageBonuses = false)
        => new() { ["id"] = id, ["first"] = name.first, ["surname"] = name.surname, ["name"] = name.first + " " + name.surname, ["age"] = age, ["sex"] = sex, ["household"] = household, ["family_role"] = role, ["trade"] = trade, ["faction"] = Population.Facts["TRADES"]![trade]!["faction"]?.DeepClone(), ["kind"] = kind, ["home"] = home.DeepClone(), ["work"] = work.DeepClone(), ["sched"] = new JsonObject { ["day"] = NativeTownPopulation.Tidy(day), ["sunday"] = NativeTownPopulation.Tidy(sunday) }, ["stats"] = Stats(trade, ageBonuses ? age : null), ["dog"] = null };
    public static JsonArray Seg(double from, double to, string act, string? place = null) => place == null ? new(from, to, act) : new(from, to, act, place);
    public static JsonArray Route(IEnumerable<(double x, double z)> points) => new(points.Select(q => (JsonNode)new JsonArray(q.x, q.z)).ToArray());
    public static int Install(NativeTownPopulation population, string prefix, Func<JsonObject> generate, string defaultDistrict = "town")
    {
        var c = population.Host.Context; if (c.Scalar<long>("SELECT COUNT(*) FROM resident") == 0 || c.Scalar<long>("SELECT COUNT(*) FROM resident WHERE id LIKE $p0", prefix + "%") > 0 || c.World("town") == null) return 0; var made = generate(); int count = 0;
        c.Atomic(() => { if (made["places"] is JsonObject places) population.AddPlaces(places); foreach (var r in A(made["residents"])) { if (c.One("SELECT 1 FROM npc WHERE id=$p0", S(r, "id")) != null) continue; var place = c.World("town")?["places"]?[S(r?["work"], "place")]; population.AddResident(r!.AsObject(), district: S(place, "district", defaultDistrict)); count++; } }); return count;
    }
}
