using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Real press-town setup: convert existing household boys and select a native post office/clerk.</summary>
public sealed class NativeTownPressPopulation
{
    private readonly NativeTownPopulation population;
    private NativeServiceContext C => population.Host.Context;
    private static double N(JsonNode? n) => NativeTown.N(n);
    private static string S(JsonNode? n, string key, string fallback = "") => NativeTown.S(n, key, fallback);
    private static JsonArray A(JsonNode? n) => n as JsonArray ?? new JsonArray();
    private static double D(double x, double z, double bx, double bz) => Math.Sqrt((x - bx) * (x - bx) + (z - bz) * (z - bz));
    private static uint Hash(string text) { uint h = 2166136261; foreach (char c in text) h = unchecked((h ^ c) * 16777619); return h; }
    public NativeTownPressPopulation(NativeTownPopulation population) => this.population = population;
    private JsonObject? FreeDoor(JsonArray residents, JsonObject places)
    {
        var houses = residents.Select(r => (int)N(r?["home"]?["house"])).Concat(A(population.Kept["houses"]).Select(h => (int)N(h?["house"]))).ToHashSet(); var taken = new List<(double x, double z)>();
        foreach (var r in residents) { taken.Add((N(r?["home"]?["sx"]), N(r?["home"]?["sz"]))); if (r?["work"]?["door"] is JsonArray door) taken.Add((N(door[0]), N(door[1]))); }
        foreach (var place in places) if (place.Value?["door"] is JsonArray door) taken.Add((N(door[0]), N(door[1])));
        return population.Doors.Where(d => !houses.Contains((int)N(d["house"])) && !taken.Any(p => D(p.x, p.z, N(d["sx"]), N(d["sz"])) < 4)).OrderBy(d => D(-210, 112, N(d["sx"]), N(d["sz"]))).FirstOrDefault();
    }
    public void Ensure(uint seed)
    {
        if (population.Town.Residents.Count == 0) return; var before = C.World("press")?.AsObject(); if (N(before?["v"]) == 1 && before?["post"] != null && A(before["newsboys"]).Count > 0) return;
        var town = population.Snapshot(); var residents = A(town["residents"]); var places = town["places"]!.AsObject(); var rng = NativeTownPopulation.Random(seed ^ 0x5eed0873);
        var press = before ?? new JsonObject { ["v"] = 1, ["newsboys"] = new JsonArray(), ["corners"] = new JsonArray(), ["post"] = null, ["berg"] = null, ["medal"] = "owned" };
        C.Atomic(() => {
            if (A(press["newsboys"]).Count == 0) {
                var pool = residents.Select(r => r!.AsObject()).Where(r => S(r, "sex") == "m" && N(r["age"]) >= 10 && N(r["age"]) <= 14 && S(r, "trade") is "child" or "errand_boy" or "street_child").OrderBy(r => Hash(S(r, "id") + seed)).ToArray(); var used = new HashSet<int>();
                var corners = new[] { ("rijnkaai", "the Rijnkaai, by the hiring board", 3.0, 36.0, 0.0, 18.0), ("vismarkt", "the corner of the Vismarkt", -103.0, 44.0, -116.0, 26.0), ("grote_markt", "the Grote Markt", -238.0, 110.0, -254.0, 94.0) };
                foreach (var corner in corners) {
                    var point = population.Snap(corner.Item3, corner.Item4, 8) ?? (corner.Item3, corner.Item4); double x = point.Item1, z = point.Item2;
                    var boy = pool.Where(r => !used.Contains((int)N(r["household"]))).OrderBy(r => D(N(r["home"]?["sx"]), N(r["home"]?["sz"]), x, z)).FirstOrDefault(); if (boy == null) continue; used.Add((int)N(boy["household"])); double yaw = Math.Atan2(corner.Item5 - x, corner.Item6 - z);
                    string play = A(population.Facts["PLAY"]).Select(p => "play:" + p!.GetValue<string>()).Where(places.ContainsKey).OrderBy(k => D(N(places[k]?["x"]), N(places[k]?["z"]), N(boy["home"]?["sx"]), N(boy["home"]?["sz"]))).FirstOrDefault() ?? "play:" + A(population.Facts["PLAY"])[0]!.GetValue<string>();
                    boy["trade"] = "newsboy"; boy["faction"] = population.Facts["TRADES"]!["newsboy"]!["faction"]?.DeepClone(); boy["work"] = new JsonObject { ["place"] = corner.Item1, ["kind"] = "post", ["at"] = new JsonArray(x, z, yaw) }; var day = new JsonArray(new JsonArray(6.25, 11.5, "work"), new JsonArray(13.5, 17.5, "play", play)); boy["sched"] = new JsonObject { ["day"] = day, ["sunday"] = day.DeepClone() };
                    C.Execute("UPDATE resident SET trade='newsboy',data_json=$p0 WHERE id=$p1", boy.ToJsonString(), S(boy, "id")); C.Execute("UPDATE npc SET role=$p0 WHERE id=$p1", S(population.Facts["TRADES"]!["newsboy"], "label"), S(boy, "id"));
                    press["newsboys"]!.AsArray().Add(boy["id"]!.DeepClone()); press["corners"]!.AsArray().Add(new JsonObject { ["id"] = corner.Item1, ["label"] = corner.Item2, ["x"] = x, ["z"] = z, ["yaw"] = yaw, ["boy"] = boy["id"]!.DeepClone() });
                }
            }
            if (press["post"] == null && FreeDoor(residents, places) is { } door) {
                var point = population.Snap(N(door["sx"]) + N(door["out"]?[0]) * .6, N(door["sz"]) + N(door["out"]?[1]) * .6, 8) ?? (N(door["sx"]) + N(door["out"]?[0]) * .6, N(door["sz"]) + N(door["out"]?[1]) * .6);
                int hh = residents.Select(r => (int)N(r?["household"])).DefaultIfEmpty(0).Max() + 1; string first = new[] { "Prosper", "Emiel", "Isidoor", "Florimond", "Gommaar" }[(int)Math.Floor(rng() * 5)]; var names = residents.Select(r => S(r, "surname")).ToHashSet(); string surname = new[] { "Van Laer", "Moens", "Verbist", "Schuermans", "Dockx", "Van Geel" }.FirstOrDefault(s => !names.Contains(s)) ?? "Van Laer";
                var home = new JsonObject(); foreach (string key in new[] { "house", "x", "z", "sx", "sz" }) home[key] = door[key]!.DeepClone();
                var clerk = new JsonObject { ["id"] = "postclerk", ["first"] = first, ["surname"] = surname, ["name"] = first + " " + surname, ["age"] = 44 + (int)Math.Floor(rng() * 14), ["sex"] = "m", ["household"] = hh, ["family_role"] = "single", ["trade"] = "post_clerk", ["faction"] = population.Facts["TRADES"]!["post_clerk"]!["faction"]?.DeepClone(), ["kind"] = "clerk", ["home"] = home, ["work"] = new JsonObject { ["place"] = "post_office", ["kind"] = "post", ["at"] = new JsonArray(point.Item1, point.Item2, Math.Atan2(N(door["out"]?[0]), N(door["out"]?[1]))) }, ["sched"] = new JsonObject { ["day"] = new JsonArray(new JsonArray(8, 12.5, "work"), new JsonArray(13.5, 19, "work")), ["sunday"] = new JsonArray(new JsonArray(8.75, 11, "church", "church")) }, ["stats"] = new JsonObject { ["honesty"] = 7, ["temper"] = 4, ["piety"] = 6, ["warmth"] = 4, ["greed"] = 3, ["courage"] = 3, ["gossip"] = 6, ["wealth"] = 4 }, ["dog"] = null };
                if (C.Scalar<int>("SELECT COUNT(*) FROM npc WHERE id='postclerk'") == 0) population.AddResident(clerk, district: "grote-markt");
                press["post"] = new JsonObject { ["house"] = door["house"]!.DeepClone(), ["step"] = new JsonArray(N(door["sx"]), N(door["sz"])), ["wall"] = new JsonArray(N(door["x"]), N(door["z"])), ["out"] = door["out"]!.DeepClone(), ["label"] = "the post and telegraph office", ["clerk"] = "postclerk" };
            }
            if (press["berg"] == null && A(town["shops"]).FirstOrDefault(s => S(s, "id") == "pawn_vis") is { } berg) press["berg"] = new JsonObject { ["shop"] = berg["id"]!.DeepClone(), ["clerk"] = berg["keeper"]!.DeepClone(), ["label"] = "the Berg van Barmhartigheid", ["door"] = berg["door"]!.DeepClone(), ["wall"] = berg["wall"]!.DeepClone(), ["out"] = berg["out"]!.DeepClone() };
            var state = C.World("town")!.AsObject(); if (press["post"] is { } post) state["places"]!["post_office"] = new JsonObject { ["label"] = "the post and telegraph office", ["x"] = N(post["step"]?[0]), ["z"] = N(post["step"]?[1]), ["r"] = 3, ["district"] = "grote-markt", ["door"] = post["step"]!.DeepClone(), ["out"] = post["out"]!.DeepClone() };
            foreach (var shop in A(state["shops"])) if (S(shop, "id") == "pawn_vis") shop!["label"] = "the Berg van Barmhartigheid by the Vleeshuis"; if (state["places"]?["pawn_vis"] is { } pawn) pawn["label"] = "the Berg van Barmhartigheid by the Vleeshuis";
            C.SetWorld("town", state); C.SetWorld("press", press);
        }); population.Town.Clear();
    }
}
