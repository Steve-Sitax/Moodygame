using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Add the fixed landmark staff with newly selected native homes, preserving all existing identities.</summary>
public sealed class NativeTownLandmarksPopulation
{
    private readonly NativeTownPopulation population;
    private NativeServiceContext C => population.Host.Context;
    private static double N(JsonNode? n) => NativeTown.N(n);
    private static string S(JsonNode? n, string key, string fallback = "") => NativeTown.S(n, key, fallback);
    private static JsonArray A(JsonNode? n) => n as JsonArray ?? new JsonArray();
    private static double D(double x, double z, double bx, double bz) => Math.Sqrt((x - bx) * (x - bx) + (z - bz) * (z - bz));
    private static string District(double x, double z) => x > 40 ? "eilandje" : x > -40 ? "rijnkaai" : x > -150 ? z > 60 ? "canal" : "vismarkt" : z > 60 ? "grote-markt" : "steenplein";
    public NativeTownLandmarksPopulation(NativeTownPopulation population) => this.population = population;
    private JsonObject? FreeHouse(double x, double z, HashSet<int> skip)
    {
        var state = population.Snapshot(); var people = A(state["residents"]); var used = people.Select(r => (int)N(r?["home"]?["house"])).ToHashSet(); var taken = new List<(double x, double z)>();
        foreach (var r in people) { taken.Add((N(r?["home"]?["sx"]), N(r?["home"]?["sz"]))); if (r?["work"]?["door"] is JsonArray door) taken.Add((N(door[0]), N(door[1]))); }
        foreach (var place in state["places"]!.AsObject()) if (place.Value?["door"] is JsonArray door) taken.Add((N(door[0]), N(door[1]))); foreach (var shop in A(state["shops"])) taken.Add((N(shop?["door"]?[0]), N(shop?["door"]?[1])));
        foreach (string key in new[] { "homes", "poesje:door", "press" }) {
            var record = C.World(key); if (record == null) continue; if (record["sx"] != null && record["sz"] != null) taken.Add((N(record["sx"]), N(record["sz"])));
            foreach (var home in A(record["homes"])) { taken.Add((N(home?["step"]?[0]), N(home?["step"]?[1]))); skip.Add((int)N(home?["house"])); }
            foreach (string person in new[] { "dealer", "post" }) if (record[person] is { } at) taken.Add((N(at["step"]?[0]), N(at["step"]?[1]))); foreach (var corner in A(record["corners"])) taken.Add((N(corner?["x"]), N(corner?["z"])));
        }
        var picked = population.Doors.Where(d => !used.Contains((int)N(d["house"])) && !skip.Contains((int)N(d["house"])) && !taken.Any(p => D(p.x, p.z, N(d["sx"]), N(d["sz"])) < 4)).OrderBy(d => D(x, z, N(d["sx"]), N(d["sz"]))).FirstOrDefault();
        return picked != null && D(x, z, N(picked["sx"]), N(picked["sz"])) < 220 ? picked : null;
    }
    public void Ensure(uint seed)
    {
        var people = population.Town.Residents; if (people.Count == 0) return; var newcomers = A(population.Facts["NEWCOMERS"]); var record = C.World("landmarks")?.AsObject() ?? new JsonObject { ["v"] = 1, ["added"] = new JsonArray() };
        var places = C.World("town")!["places"]!.AsObject(); if (newcomers.All(n => people.ContainsKey(S(n, "id"))) && population.Facts["LANDMARK_PLACE"]!.AsObject().All(p => places.ContainsKey(p.Value!.GetValue<string>())) && N(record["v"]) == 1 && C.World("landmarks") != null) return;
        C.Atomic(() => {
            var extra = new JsonObject(); foreach (var entry in population.Facts["LANDMARK_PLACE"]!.AsObject()) { if (places.ContainsKey(entry.Value!.GetValue<string>())) continue; string id = entry.Key; var door = A(population.Facts["LANDMARK_DOORS"]).First(d => S(d, "landmark") == id)!; extra[entry.Value.GetValue<string>()] = new JsonObject { ["label"] = population.Facts["LANDMARK_LABEL"]![id]!.DeepClone(), ["x"] = N(door["step"]?[0]), ["z"] = N(door["step"]?[1]), ["r"] = 3, ["district"] = District(N(door["step"]?[0]), N(door["step"]?[1])), ["door"] = door["step"]!.DeepClone(), ["out"] = door["out"]!.DeepClone() }; }
            population.AddPlaces(extra); int hh = population.Town.Residents.Values.Select(r => (int)N(r["household"])).DefaultIfEmpty(0).Max(); var skip = new HashSet<int>(); var added = new List<string>();
            foreach (var newcomer in newcomers) {
                string id = S(newcomer, "id"); if (people.ContainsKey(id) || C.Scalar<int>("SELECT COUNT(*) FROM npc WHERE id=$p0", id) > 0) continue;
                string landmark = S(newcomer, "landmark"); var step = A(population.Facts["LANDMARK_DOORS"]).First(d => S(d, "landmark") == landmark)!["step"]!; double x = N(step[0]), z = N(step[1]); var door = FreeHouse(x, z, skip); var home = new JsonObject(); string family = "single";
                if (door != null) { skip.Add((int)N(door["house"])); foreach (string key in new[] { "house", "x", "z", "sx", "sz" }) home[key] = door[key]!.DeepClone(); }
                else { var lodger = population.Town.Residents.Values.Where(r => N(r["age"]) >= 40 && S(r["work"], "kind") != "wait" && !S(r, "id").StartsWith("stranger_", StringComparison.Ordinal) && S(r, "id") != "fortune").OrderBy(r => D(x, z, N(r["home"]?["sx"]), N(r["home"]?["sz"]))).FirstOrDefault() ?? throw new NativeServiceException("No native home is available for the landmark staff.", 409); home = lodger["home"]!.DeepClone().AsObject(); family = "lodger"; }
                var person = new JsonObject { ["id"] = id, ["first"] = newcomer!["first"]!.DeepClone(), ["surname"] = newcomer["surname"]!.DeepClone(), ["name"] = S(newcomer, "name", S(newcomer, "first") + " " + S(newcomer, "surname")), ["age"] = newcomer["age"]!.DeepClone(), ["sex"] = newcomer["sex"]!.DeepClone(), ["household"] = ++hh, ["family_role"] = family, ["trade"] = newcomer["trade"]!.DeepClone(), ["faction"] = population.Facts["TRADES"]![S(newcomer, "trade")]!["faction"]?.DeepClone(), ["kind"] = newcomer["kind"]!.DeepClone(), ["home"] = home, ["work"] = new JsonObject { ["place"] = population.Facts["LANDMARK_PLACE"]![landmark]!.DeepClone(), ["kind"] = "inside", ["door"] = step.DeepClone() }, ["sched"] = new JsonObject { ["day"] = NativeTownPopulation.Tidy(A(newcomer["day"])), ["sunday"] = NativeTownPopulation.Tidy(A(newcomer["sunday"])) }, ["stats"] = newcomer["stats"]!.DeepClone(), ["dog"] = null };
                double sx = N(home["sx"]), sz = N(home["sz"]); string district = District(sx, sz);
                population.AddResident(person, S(newcomer, "role"), district); added.Add(id);
            }
            record["v"] = 1; record["added"] = new JsonArray(A(record["added"]).Select(n => n!.GetValue<string>()).Concat(added).Distinct().Select(id => (JsonNode)JsonValue.Create(id)!).ToArray()); C.SetWorld("landmarks", record);
        }); population.Town.Clear();
    }
}
