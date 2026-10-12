using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.Town;

namespace Scheldemist.Native.Services;

/// <summary>Pure native port of doorlife.ts doorPlan and livelyRoutes.ts public scene facts.</summary>
public sealed class NativeLively : INativeServiceModule
{
    private readonly NativeTown town;
    public NativeLively(NativeTown town) => this.town = town;
    public static double Hash01(string value)
    {
        uint hash = Whereabouts.HashId(value); hash ^= hash >> 13; hash = unchecked(hash * 0x5bd1e995u); hash ^= hash >> 15;
        return hash / 4294967296.0;
    }
    public static JsonArray DoorPlan(Resident person, JsonObject privatePerson)
    {
        string id = person.Id, trade = person.Trade;
        bool woman = person.Sex == "f" && person.Age >= 16;
        bool atHome = trade is "housewife" or "seamstress" or "retired" or "shopwife" or "laundress" || woman && person.Age >= 55;
        string? lace = !woman ? null : trade == "seamstress" || person.Age >= 50 && atHome ? "lace" : atHome && Hash01(id + ":lace") < 0.35 ? "knit" : null;
        bool scrub = woman && person.Age < 70 && (atHome || trade == "maid");
        bool window = person.Age >= 14 && NativeTown.N(privatePerson["stats"]?["gossip"]) >= 6;
        double piety = NativeTown.N(privatePerson["stats"]?["piety"]);
        bool flowers = woman && piety >= 7;
        bool near = Whereabouts.Hypot(person.HomeSx + 262, person.HomeSz - 144) < 110;
        var result = new JsonArray();
        void Add(int day, double start, double end, string act, string place)
        {
            start = Math.Floor(start * 4 + 0.5) / 4; end = Math.Floor(end * 4 + 0.5) / 4;
            if (end - start < 0.5) return;
            for (double time = start; time < end; time += 0.25)
                if (Whereabouts.ActivityAt(person.Sched, day, time).Act != (place == "home" ? "home" : "work")) return;
            if (result.Any(segment => NativeTown.N(segment?[0]) == day && NativeTown.N(segment?[1]) < end && start < NativeTown.N(segment?[2]))) return;
            result.Add(new JsonArray(day, start, end, act, place));
        }
        for (int day = 1; day <= 7; day++)
        {
            double Roll(string tag) => Hash01($"{id}:{day}:{tag}");
            if (day == 7) { if (flowers && Roll("fl") < 0.35) Add(day, 11.5 + Roll("flh") * 0.75, 13 + Roll("flh") * 0.75, near ? "flowers_church" : "flowers", "home"); continue; }
            if (scrub && Roll("sc") < (day == 6 ? 0.85 : 0.22)) {
                bool maid = trade == "maid"; double start = maid ? 6.75 + Roll("sca") * 0.75 : 7 + Roll("sca") * 2.25;
                Add(day, start, start + (day == 6 ? 1.25 : 1) + Roll("scb") * 0.5, "scrub", maid ? "work" : "home");
            }
            if (lace != null && Roll("la") < (trade == "seamstress" ? 0.8 : 0.5)) {
                double start = 13.25 + Roll("laa") * 1.25; Add(day, start, start + 1.5 + Roll("lab") * 1.5, lace, "home");
            }
            if (window && Roll("wi") < 0.45) {
                double start = Roll("wit") < 0.5 ? 10.25 + Roll("wia") * 1.25 : 17 + Roll("wia") * 1.5;
                Add(day, start, start + 0.5 + Roll("wib") * 0.75, "window", "home");
            }
            if (flowers && (Roll("fl") < 0.18 || day == 6 && piety >= 9)) {
                double start = 11 + Roll("fla") * 0.75; Add(day, start, start + 1.5, near ? "flowers_church" : "flowers", "home");
            }
        }
        return result;
    }
    public JsonObject View()
    {
        var doors = new JsonObject();
        foreach (var person in town.Model.Residents) {
            var privatePerson = town.Resident(person.Id)!; var plan = DoorPlan(person, privatePerson);
            if (plan.Count > 0) doors[person.Id] = plan;
        }
        var stalls = new JsonArray();
        foreach (var stall in new[] { ("stall_gp1", -302.2, 181.5, -Math.PI / 2, "candles", "groenplaats"), ("stall_gp2", -302.2, 188.0, -Math.PI / 2, "rosaries", "groenplaats"), ("stall_gp3", -302.2, 194.5, -Math.PI / 2, "prints", "groenplaats"), ("stall_bm1", -222.3, 172.0, Math.PI / 2, "candles", "blauwmoezel") })
            stalls.Add(new JsonObject { ["id"] = stall.Item1, ["x"] = stall.Item2, ["z"] = stall.Item3, ["yaw"] = stall.Item4, ["goods"] = stall.Item5, ["side"] = stall.Item6 });
        return new JsonObject {
            ["door"] = doors, ["stalls"] = stalls,
            ["beggars"] = new JsonArray(new JsonArray(-259.0, 144.2, Math.PI), new JsonArray(-265.0, 144.2, Math.PI), new JsonArray(-302.3, 219.0, -Math.PI / 2)),
            ["carts"] = new JsonArray("ragman", "coalman", "mussel_seller"),
            ["dogcarts"] = new JsonArray("milk_woman", "baker_boy"),
            ["criers"] = new JsonArray("milk_woman", "baker_boy", "grinder", "ragman", "coalman", "sweep", "mussel_seller", "broom_seller")
        };
    }
    public void Register(NativeServiceHost host) => host.Register("GET", "/api/lively", _ => View());
}
