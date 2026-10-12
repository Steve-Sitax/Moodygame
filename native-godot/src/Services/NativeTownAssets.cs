using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

/// <summary>Objects and boat owners selected from the current native town, including fresh populations.</summary>
public sealed class NativeTownAssets
{
    private readonly NativeTownPopulation population;
    private long revision = -1;
    private JsonObject? assets, rowing;
    public NativeTownAssets(NativeTownPopulation population) => this.population = population;
    private void Refresh()
    {
        if (revision == population.Town.Revision && assets != null) return;
        var town = population.Snapshot(); assets = Generate(town, A(population.Host.Context.World("transport")?["extraVelos"])); rowing = GenerateRowing(town); revision = population.Town.Revision;
    }
    public void Clear() { revision = -1; assets = rowing = null; }
    public JsonObject Stealables() { Refresh(); return assets!.DeepClone().AsObject(); }
    public JsonArray Boats() { Refresh(); return rowing!["boats"]!.DeepClone().AsArray(); }
    public string Waterman(string landing) { Refresh(); return S(rowing!["watermen"], landing); }
    private (double x, double z) Open(double x, double z, double maximum)
        => population.Snap(x, z, maximum) ?? (x, z);
    private (double x, double z, double yaw)? ByDoor(JsonNode person)
    {
        var home = person["home"]!; var d = population.Doors.FirstOrDefault(q => N(q["house"]) == N(home["house"]));
        double ox = d != null ? N(d["out"]?[0]) : N(home["sx"]) - N(home["x"]), oz = d != null ? N(d["out"]?[1]) : N(home["sz"]) - N(home["z"]);
        if (d == null) { double length = Math.Sqrt(ox * ox + oz * oz); if (length == 0) length = 1; ox /= length; oz /= length; }
        double wx = N(d?["x"] ?? home["x"]), wz = N(d?["z"] ?? home["z"]);
        foreach (double outward in new[] { 1.0, 1.25 }) foreach (double side in new[] { 1.7, -1.7, 2.4, -2.4 }) {
            double x = wx + ox * outward - oz * side, z = wz + oz * outward + ox * side;
            if (population.Open(x, z, .3) && population.Reachable(x, z)) return (NativeTownBackGeometry.R1(x), NativeTownBackGeometry.R1(z), Math.Atan2(-oz, ox));
        }
        return null;
    }
    public JsonObject Generate(JsonObject town, JsonArray? extraVelos = null)
    {
        var residents = A(town["residents"]); var places = town["places"]!; var velos = new JsonArray();
        void AddVelo(JsonNode? person, string where, (double x, double z, double yaw)? at = null) {
            if (person == null || velos.Count >= 6 || velos.Any(v => S(v, "owner") == S(person, "id"))) return; var p = at ?? ByDoor(person); if (p == null) return;
            velos.Add(new JsonObject { ["id"] = "velo:" + (velos.Count + 1), ["owner"] = S(person, "id"), ["x"] = p.Value.x, ["z"] = p.Value.z, ["yaw"] = p.Value.yaw, ["where"] = where });
        }
        foreach (var person in residents.Where(r => S(r, "trade") == "merchant").Take(2)) AddVelo(person, "from outside his house");
        AddVelo(residents.FirstOrDefault(r => S(r, "id") == "brouwer"), "from outside his house");
        AddVelo(residents.FirstOrDefault(r => S(r, "trade") is "draper" or "pawnbroker" && S(r, "family_role") == "head"), "from outside his house");
        foreach (string key in new[] { "tavern:engel", "tavern:bassin", "tavern:ankere" }) {
            var place = places[key]; var person = residents.FirstOrDefault(r => S(r, "trade") == "publican" && S(r?["work"], "place") == key); if (place?["door"] == null || person == null) continue;
            double ox = place["out"] == null ? 0 : N(place["out"]?[0]), oz = place["out"] == null ? -1 : N(place["out"]?[1]); var p = Open(N(place["door"]?[0]) - oz * 2.2, N(place["door"]?[1]) + ox * 2.2, 2);
            AddVelo(person, "from outside " + S(place, "label"), (NativeTownBackGeometry.R1(p.x), NativeTownBackGeometry.R1(p.z), Math.Atan2(-oz, ox))); break;
        }
        var clerk = residents.FirstOrDefault(r => S(r, "trade") == "clerk" && S(r?["work"], "place") == "entrepot") ?? residents.FirstOrDefault(r => S(r, "id") == "katoen");
        if (clerk != null && population.City["designedDoors"]?["entrepot"] is { } ed) { double ox = N(ed[2]), oz = N(ed[3]); var p = Open(N(ed[0]) + ox * 1.2 + oz * 3.2, N(ed[1]) + oz * 1.2 - ox * 3.2, 2); AddVelo(clerk, "from outside the Entrepot office", (NativeTownBackGeometry.R1(p.x), NativeTownBackGeometry.R1(p.z), Math.Atan2(-oz, ox))); }
        foreach (var velo in extraVelos ?? new JsonArray()) if (!velos.Any(q => S(q, "id") == S(velo, "id") || S(q, "owner") == S(velo, "owner"))) velos.Add(velo!.DeepClone());
        var lamps = new JsonArray();
        void AddLamp(string id, string owner, double x, double z, string where, double y = 0) { if (owner == "") return; var p = y > 0 ? (x, z) : Open(x, z, 2.5); lamps.Add(new JsonObject { ["id"] = "lamp:" + id, ["owner"] = owner, ["x"] = NativeTownBackGeometry.R1(p.Item1), ["z"] = NativeTownBackGeometry.R1(p.Item2), ["y"] = y, ["where"] = where }); }
        var hd = population.City["designedDoors"]?["hessenatie"] ?? new JsonArray(14, 46, 0, -1); AddLamp("hessenatie", "sooi", N(hd[0]) + N(hd[2]) * 2.6 + 2.6, N(hd[1]) + N(hd[3]) * 2.6, "by the Hessenatie door");
        var rk = residents.FirstOrDefault(r => S(r?["work"], "place") == "rijnkaai" && S(r?["work"], "kind") == "haul" && r?["work"]?["a"] != null); if (rk != null) AddLamp("rijnkaai", S(rk, "id"), N(rk["work"]?["a"]?[0]) + 1.6, N(rk["work"]?["a"]?[1]) + 1.2, "on the Rijnkaai, where the dockers work");
        var kato = population.Spot("katoen_door"); AddLamp("entrepot", "katoen", N(kato["x"]) - 2.2, N(kato["z"]) - 2.5, "by the Entrepot door");
        var wf = residents.FirstOrDefault(r => S(r?["work"], "place") == "werf" && S(r?["work"], "kind") == "haul" && r?["work"]?["a"] != null); if (wf != null) AddLamp("werf", S(wf, "id"), N(wf["work"]?["a"]?[0]) + 1.6, N(wf["work"]?["a"]?[1]) + 1.5, "on the Werf, where the dock gang works");
        AddLamp("lock", S(residents.FirstOrDefault(r => S(r?["work"], "place") == "bassin" && S(r?["work"], "kind") == "haul" && N(r?["age"]) >= 18), "id"), 99, 24.5, "by the lock of the Petit Bassin");
        var brewery = population.Spot("brewery_yard"); AddLamp("brewery", "brouwer", N(brewery["x"]) + 1.5, N(brewery["z"]) - 2.2, "by the brewery door");
        foreach (string place in new[] { "vismarkt", "grote_markt" }) { var stall = A(town["stalls"]).FirstOrDefault(q => S(q, "place") == place && S(q, "keeper") != ""); if (stall != null) AddLamp("stall_" + place, S(stall, "keeper"), N(stall["x"]) - N(stall["face"]?[1]), N(stall["z"]) + N(stall["face"]?[0]), "on a stall at " + (place == "vismarkt" ? "the Vismarkt" : "the Grote Markt"), .86); }
        var food = new JsonArray(); string Item(string goods) => goods switch { "fish" => "herring", "bread" => "bread", "veg" => "apple", _ => "" }; string First(string id) => S(residents.FirstOrDefault(r => S(r, "id") == id), "first", System.Text.RegularExpressions.Regex.Replace(population.Host.Context.Scalar<string>("SELECT name FROM npc WHERE id=$p0", id) ?? "someone", "^(Widow|Agent|Pastoor|Meneer) ", ""));
        int index = 0; foreach (var stall in A(town["stalls"])) { string item = Item(S(stall, "goods")), keeper = S(stall, "keeper"); if (item != "" && keeper != "") food.Add(new JsonObject { ["id"] = "stall:" + index, ["keeper"] = keeper, ["x"] = N(stall?["x"]), ["z"] = N(stall?["z"]), ["item"] = item, ["where"] = First(keeper) + "'s stall" }); index++; }
        foreach (var shop in A(town["shops"])) { string item = Item(S(shop, "goods")); if (item == "") continue; var p = NativeTownHouseDoors.ShopFood(A(population.Buildings["houses"]), shop!.AsObject()); if (p == null) continue; food.Add(new JsonObject { ["id"] = "shop:" + S(shop, "id"), ["keeper"] = shop["keeper"]?.DeepClone(), ["x"] = NativeTownBackGeometry.R1(p.Value.x), ["z"] = NativeTownBackGeometry.R1(p.Value.z), ["item"] = item, ["where"] = S(shop, "label") }); }
        return new JsonObject { ["velos"] = velos, ["lamps"] = lamps, ["food"] = food };
    }
    public JsonObject GenerateRowing(JsonObject town)
    {
        var residents = A(town["residents"]); var boatmen = residents.Where(r => S(r, "trade") == "boatman" && N(r?["age"]) >= 18).ToArray(); var used = new HashSet<string>();
        string? Pick(string place) { var r = boatmen.FirstOrDefault(q => S(q?["work"], "place") == place && !used.Contains(S(q, "id"))) ?? boatmen.FirstOrDefault(q => !used.Contains(S(q, "id"))); if (r == null) return null; used.Add(S(r, "id")); return S(r, "id"); }
        var watermen = new JsonObject { ["rijnkaai"] = Pick("werf"), ["vismarkt"] = Pick("vismarkt"), ["bassin"] = Pick("canal") }; var boats = new JsonArray();
        var quay = residents.Where(r => S(r, "trade") is "sailor" or "docker" or "natie" or "porter" && S(r, "sex") == "m" && N(r?["age"]) >= 20 && N(r?["age"]) < 65).ToArray();
        foreach (var b in A(population.Facts["row"]?["LOOSE"])) {
            var r = boatmen.FirstOrDefault(q => S(q?["work"], "place") == S(b, "place") && !used.Contains(S(q, "id"))) ?? boatmen.FirstOrDefault(q => !used.Contains(S(q, "id"))) ?? quay.FirstOrDefault(q => S(q?["work"], "place") == S(b, "place") && !used.Contains(S(q, "id"))) ?? quay.FirstOrDefault(q => !used.Contains(S(q, "id"))); if (r == null) continue; used.Add(S(r, "id"));
            boats.Add(new JsonObject { ["id"] = S(b, "id"), ["kind"] = S(b, "kind"), ["owner"] = S(r, "id"), ["label"] = null, ["x"] = b!["berth"]!["x"]!.DeepClone(), ["z"] = b["berth"]!["z"]!.DeepClone(), ["yaw"] = b["berth"]!["yaw"]!.DeepClone(), ["landing"] = b["berth"]!["landing"]!.DeepClone(), ["where"] = S(b, "where"), ["family"] = true, ["mooring"] = null });
        }
        foreach (var m in A(population.Facts["row"]?["MOORINGS"])) {
            var rule = m!["owner"]!; string kind = S(rule, "kind"); string? owner = null, label = null;
            if (kind == "npc") { if (population.Host.Context.One("SELECT 1 FROM npc WHERE id=$p0", S(rule, "id")) != null) { owner = S(rule, "id"); label = S(rule, "label"); } }
            else if (kind != "none") {
                var trades = A(rule["trades"]).Select(t => t!.GetValue<string>()).ToArray(); double Score(JsonNode r) => Array.IndexOf(trades, S(r, "trade")) * 4 + (S(rule, "place") != "" && S(r["work"], "place") == S(rule, "place") ? 0 : 2) + (used.Contains(S(r, "id")) ? 1 : 0);
                var r = residents.Where(q => trades.Contains(S(q, "trade")) && N(q?["age"]) >= 16 && N(q?["age"]) < 70 && (S(rule, "sex") == "" || S(q, "sex") == S(rule, "sex"))).OrderBy(q => Score(q!)).FirstOrDefault() ?? residents.FirstOrDefault(q => S(q, "trade") is "sailor" or "docker" or "boatman" && N(q?["age"]) >= 18 && !used.Contains(S(q, "id")));
                if (r != null) { owner = S(r, "id"); if (kind == "service") label = S(rule, "label"); }
            }
            if (owner != null) used.Add(owner);
            boats.Add(new JsonObject { ["id"] = S(m, "id"), ["kind"] = S(m, "kind"), ["owner"] = owner, ["label"] = label, ["x"] = m["x"]!.DeepClone(), ["z"] = m["z"]!.DeepClone(), ["yaw"] = m["yaw"]!.DeepClone(), ["landing"] = (S(m["board"], "kind") == "ladder" ? m["board"]!["top"] : m["board"]!["at"])!.DeepClone(), ["where"] = S(m, "where"), ["family"] = false, ["mooring"] = m.DeepClone() });
        }
        return new JsonObject { ["boats"] = boats, ["watermen"] = watermen };
    }
    public JsonArray PublicBoats()
    {
        var result = new JsonArray(); foreach (var b in Boats()) { string owner = S(b, "owner"), full = owner == "" ? "" : population.Host.Context.Scalar<string>("SELECT name FROM npc WHERE id=$p0", owner) ?? "", label = S(b, "label"), kind = S(b, "kind"), noun = kind == "rowboat" ? "boat" : S(population.Facts["row"]?["HULLS"]?[kind], "noun"); var m = b!["mooring"];
            result.Add(new JsonObject { ["id"] = S(b, "id"), ["kind"] = kind, ["owner"] = b["owner"]?.DeepClone(), ["owner_name"] = full.Split(' ')[0], ["prompt"] = "take " + (owner == "" ? "the " + noun : label != "" ? label + " " + noun : full != "" ? full + "'s " + noun : "the " + noun), ["home"] = new JsonObject { ["x"] = b["x"]!.DeepClone(), ["z"] = b["z"]!.DeepClone(), ["yaw"] = b["yaw"]!.DeepClone() }, ["board"] = m != null ? S(m["board"], "kind") : "steps", ["rings"] = m?["rings"]?.DeepClone(), ["landing"] = b["landing"]!.DeepClone(), ["where"] = S(b, "where"), ["x"] = b["x"]!.DeepClone(), ["z"] = b["z"]!.DeepClone(), ["yaw"] = b["yaw"]!.DeepClone(), ["ridden"] = false, ["mine"] = false, ["lost"] = false, ["missed"] = 0 });
        } return result;
    }
}
