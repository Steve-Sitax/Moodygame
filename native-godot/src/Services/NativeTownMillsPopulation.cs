using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

public sealed class NativeTownMillsPopulation
{
    private readonly NativeTownPopulation population;
    public NativeTownMillsPopulation(NativeTownPopulation population) => this.population = population;
    public int Ensure(uint seed) => Install(population, "ml", () => Generate(seed, population.Snapshot()));
    public JsonObject Generate(uint seed, JsonObject town)
    {
        var k = new NativeTownRoleSeed(population, seed ^ 0x6d111526, "mills", town); var people = new JsonArray(); var places = new JsonObject(); var taverns = k.Places.Select(q => q.Key).Where(key => key.StartsWith("tavern:", StringComparison.Ordinal)).ToList();
        string? TavernNear(double x, double z) { taverns = taverns.OrderBy(key => NativeTownBackGeometry.D(N(k.Places[key]?["x"]), N(k.Places[key]?["z"]), x, z)).ToList(); return taverns.FirstOrDefault(); }
        void Add(string id, string trade, string kind, int age, JsonObject home, int hh, (string first, string surname) name, JsonObject work, JsonArray day, JsonArray sunday, string role) { if (!k.Have.Contains(id)) people.Add(k.Person(id, trade, kind, "m", age, home, hh, role, name, work, day, sunday)); }
        foreach (var mill in A(k.Facts["MILLS"])) {
            string id = S(mill, "id"); var ids = k.Facts["MILL_PEOPLE"]![id]!; var door = mill!["door"]!; var yard = population.Spot(S(mill, "yard"));
            if (k.Places[id] == null) places[id] = new JsonObject { ["label"] = S(mill, "label"), ["x"] = N(door[0]), ["z"] = N(door[1]), ["r"] = 5, ["district"] = id == "mill_mid" ? "canal" : "eilandje" };
            var b = new JsonArray(NativeTownBackGeometry.R1(N(yard["x"]) - N(yard["dir"]?[1]) * 1.2), NativeTownBackGeometry.R1(N(yard["z"]) + N(yard["dir"]?[0]) * 1.2)); double face = Round(Math.Atan2(N(door[0]) - N(mill["tower"]?[0]), N(door[1]) - N(mill["tower"]?[1])) * 100) / 100;
            {
                var name = k.Name(() => k.UsedNames.Count.ToString()); var home = Home(k.DoorNear(N(yard["x"]), N(yard["z"]))); string? tavern = TavernNear(N(home["sx"]), N(home["sz"]));
                var day = new JsonArray(Seg(k.J(5.75), 12, "work"), Seg(12.75, 18.5, "work")); if (tavern != null) day.Add(Seg(k.J(19), k.J(21.25), "tavern", tavern)); var sunday = new JsonArray(Seg(k.J(8.75), k.J(11), "church", "church")); if (tavern != null) sunday.Add(Seg(k.J(16), k.J(19), "tavern", tavern));
                int age = k.Int(42, 60), hh = ++k.Household; Add(ids[0]!.GetValue<string>(), "miller", "baker", age, home, hh, name, new() { ["place"] = id, ["kind"] = "post", ["at"] = new JsonArray(N(door[0]), N(door[1]), face) }, day, sunday, "head");
            }
            {
                var name = k.Name(() => k.UsedNames.Count.ToString()); var home = Home(k.DoorNear(N(yard["x"]) + 12, N(yard["z"]) - 12)); string? tavern = TavernNear(N(home["sx"]), N(home["sz"])); var runs = A(k.Facts["runs"]![id]); var flour = runs.First(run => run?[2]?.GetValue<string>() == "flour")!; var grain = runs.First(run => run?[2]?.GetValue<string>() == "grain")!;
                var day = new JsonArray(Seg(N(flour[0]) - .25, N(flour[1]), "work", "flour"), Seg(N(flour[1]), 12, "work"), Seg(12.75, N(grain[0]), "work"), Seg(N(grain[0]), N(grain[1]), "work", "grain")); if (N(grain[1]) < 18.5) day.Add(Seg(N(grain[1]), 18.5, "work")); if (tavern != null) day.Add(Seg(Math.Max(19, N(grain[1]) + .5), k.J(21.5), "tavern", tavern));
                var sunday = new JsonArray(); if (tavern != null) { sunday.Add(Seg(k.J(11), k.J(13), "tavern", tavern)); sunday.Add(Seg(k.J(17), k.J(20), "tavern", tavern)); }
                int age = k.Int(19, 34), hh = ++k.Household; Add(ids[1]!.GetValue<string>(), "miller_man", "docker_b", age, home, hh, name, new() { ["place"] = id, ["kind"] = "haul", ["a"] = door.DeepClone(), ["b"] = b }, day, sunday, "single");
            }
        }
        return new JsonObject { ["residents"] = people, ["places"] = places };
    }
}
