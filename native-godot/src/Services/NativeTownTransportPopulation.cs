using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

/// <summary>Fresh household vehicles, physically clear parking and deterministic family errands in native Godot.</summary>
public sealed partial class NativeTownTransportPopulation
{
    private readonly NativeTownPopulation population;
    private readonly NativeTownAssets assets;
    public NativeTownTransportPopulation(NativeTownPopulation population, NativeTownAssets assets) { this.population = population; this.assets = assets; }
    /// <summary>The original game's handcart spots (square out from the door's wall) and record version 5, for the parity
    /// proof (NativeTransportPopulationProof); the game puts carts aside along the wall (version 6).</summary>
    public bool OriginalCartSpots { get; init; }
    private int Version => OriginalCartSpots ? 5 : 6;
    public JsonObject Record() => population.Host.Context.World("transport")?.DeepClone().AsObject() ?? new JsonObject { ["vehicles"] = new JsonArray(), ["extraVelos"] = new JsonArray() };
    public JsonObject Generate(JsonObject town)
    {
        var residents = A(town["residents"]); var places = town["places"]!; string seed = N(town["seed"]).ToString(System.Globalization.CultureInfo.InvariantCulture); var wealth = residents.GroupBy(r => N(r?["household"])).ToDictionary(g => g.Key, g => g.Max(r => N(r?["stats"]?["wealth"]))); var taken = new List<JsonArray>(); var keep = KeepOff(town);
        var basic = A(assets.Generate(town)["velos"]); var owners = basic.Select(v => S(v, "owner")).ToHashSet(); foreach (var v in basic) taken.Add(new JsonArray(N(v?["x"]), N(v?["z"]), N(v?["yaw"])));
        var extras = new JsonArray(); var employers = A(population.Facts["TOWN_EMPLOYERS"]).Concat(A(population.Facts["NIGHT_GIVERS"])).Select(r => S(r, "id")).ToHashSet();
        void AddExtra(JsonNode person) { string id = S(person, "id"); if (owners.Contains(id) || employers.Contains(id) || extras.Any(v => S(v, "owner") == id)) return; var spot = BesideDoor(person, 1, .45, taken, keep); if (spot == null) return; taken.Add(spot); extras.Add(new JsonObject { ["id"] = "velo:x" + (extras.Count + 1), ["owner"] = id, ["x"] = spot[0]!.DeepClone(), ["z"] = spot[1]!.DeepClone(), ["yaw"] = spot[2]!.DeepClone(), ["where"] = "from outside his house" }); }
        var excluded = new HashSet<string> { "thief", "soldier", "sentry", "corporal", "police", "priest", "beggar", "emigrant", "runner", "child", "street_child", "errand_boy" };
        foreach (var r in residents.Where(r => S(r, "sex") == "m" && N(r?["age"]) >= 17 && N(r?["age"]) <= 52 && wealth.GetValueOrDefault(N(r?["household"])) >= 3 && !excluded.Contains(S(r, "trade")) && GoesFar(r!, places)).OrderBy(r => N(r?["age"])).ThenBy(r => Hash(S(r, "id") + seed))) if (extras.Count < 3) AddExtra(r!);
        var bikeTrades = new HashSet<string> { "clerk", "post_clerk", "registrar", "customs", "cellar_master", "painter" };
        foreach (var r in residents.Where(r => S(r, "sex") == "m" && N(r?["age"]) >= 18 && N(r?["age"]) < 55 && bikeTrades.Contains(S(r, "trade")) && GoesFar(r!, places)).OrderBy(r => Hash(S(r, "id") + seed))) if (extras.Count < 5) AddExtra(r!);
        var vehicles = new JsonArray(); var byId = residents.ToDictionary(r => S(r, "id"), r => r!);
        JsonObject Vehicle(string id, string kind, JsonNode r, JsonArray home, JsonObject parks, string label) => new() { ["id"] = id, ["kind"] = kind, ["owner"] = S(r, "id"), ["household"] = r["household"]!.DeepClone(), ["home"] = home.DeepClone(), ["parks"] = parks, ["label"] = label };
        foreach (var v in A(assets.Generate(town, extras)["velos"])) { if (!byId.TryGetValue(S(v, "owner"), out var r)) continue; var home = new JsonArray(N(v?["x"]), N(v?["z"]), N(v?["yaw"])); var parks = new JsonObject { ["home"] = home.DeepClone() };
            foreach (string key in GoesFar(r, places) ? WeekKeys(r) : new List<string>()) { var point = KeyPoint(r, key, places); if (point == null) continue; var spot = SpotNear(point.Value.x, point.Value.z, .45, taken, keep, 16); if (spot == null) continue; taken.Add(spot); parks[key] = spot.DeepClone(); }
            vehicles.Add(Vehicle(S(v, "id"), "velocipede", r, home, parks, S(r, "name") + "'s velocipede"));
        }
        var cartTrades = new HashSet<string> { "carter", "market_woman", "fishwife", "grocer", "dealer", "chandler" }; var carts = new Dictionary<double, JsonNode>();
        foreach (var r in residents.OrderBy(r => Hash(S(r, "id") + seed))) { double hh = N(r?["household"]); if (!cartTrades.Contains(S(r, "trade")) || N(r?["age"]) < 16 || carts.ContainsKey(hh) || wealth.GetValueOrDefault(hh) < 1 && S(r, "trade") != "carter") continue; carts[hh] = r!; }
        foreach (var pair in carts) { var r = pair.Value; var home = BesideDoor(r, -1, 1.25, taken, keep, true); if (home == null) continue; taken.Add(home); var parks = new JsonObject { ["home"] = home.DeepClone() };
            foreach (string key in WeekKeys(r)) { if (!key.StartsWith("work", StringComparison.Ordinal)) continue; var point = KeyPoint(r, key, places); if (point == null) continue; var spot = SpotNear(point.Value.x, point.Value.z, 1.25, taken, keep, 12, r["work"]?["at"] != null ? N(r["work"]?["at"]?[2]) + Math.PI / 2 : 0, 2.5); if (spot == null) continue; taken.Add(spot); parks[key] = spot.DeepClone(); }
            vehicles.Add(Vehicle("cart:" + pair.Key.ToString(System.Globalization.CultureInfo.InvariantCulture), "handcart", r, home, parks, "the " + S(r, "surname") + " family's handcart"));
        }
        var carters = residents.Where(r => S(r, "trade") == "carter" && N(r?["age"]) >= 20).OrderBy(r => Hash(S(r, "id") + seed)).ToArray(); var merchants = residents.Where(r => S(r, "trade") == "merchant").OrderBy(r => Hash(S(r, "id") + seed)).ToArray();
        var yards = new[] { ("rijnkaai_back", carters.ElementAtOrDefault(0), new JsonArray(14, 106.8, Math.PI / 2)), ("eilandje", merchants.ElementAtOrDefault(0) ?? carters.ElementAtOrDefault(2), new JsonArray(137.5, 43, Math.PI / 2)), ("werf", carters.ElementAtOrDefault(1) ?? merchants.ElementAtOrDefault(1), new JsonArray(-249, 8.3, Math.PI / 2)) };
        foreach (var (route, r, yard) in yards) { if (r == null) continue; var v = Vehicle("dray:" + route, "dray", r, yard, new JsonObject { ["home"] = yard.DeepClone() }, S(r, "name") + "'s dray"); v["route"] = route; vehicles.Add(v); }
        foreach (var b in A(assets.GenerateRowing(town)["boats"])) { if (b?["family"]?.GetValue<bool>() != true || !byId.TryGetValue(S(b, "owner"), out var r)) continue; var home = new JsonArray(N(b["x"]), N(b["z"]), N(b["yaw"])); var v = Vehicle(S(b, "id"), "boat", r, home, new JsonObject { ["home"] = home.DeepClone() }, S(r, "name") + "'s " + (S(b, "kind") == "punt" ? "punt" : "rowing boat"));
            v["boat"] = new JsonObject { ["kind"] = S(b, "kind"), ["landing"] = b["landing"]!.DeepClone(), ["flight"] = S(b, "id") switch { "boat:canal" => new JsonArray(-70, 38), "boat:cartstand" => new JsonArray(50, 0), "boat:north" => new JsonArray(186, 0), _ => b["landing"]!.DeepClone() } }; vehicles.Add(v);
        }
        return new JsonObject { ["v"] = Version, ["seed"] = town["seed"]!.DeepClone(), ["extraVelos"] = extras, ["vehicles"] = vehicles };
    }
    public JsonObject Ensure(uint seed)
    {
        var c = population.Host.Context; if (c.Scalar<long>("SELECT COUNT(*) FROM resident") == 0) return new JsonObject { ["made"] = false, ["vehicles"] = 0 }; var town = population.Snapshot(); var had = c.World("transport"); if (had != null && N(had["v"]) == Version && N(had["seed"]) == N(town["seed"])) { population.Town.Clear(); return new JsonObject { ["made"] = false, ["vehicles"] = A(had["vehicles"]).Count }; }
        var record = Generate(town); c.SetWorld("transport", record); population.Town.Clear(); assets.Clear(); return new JsonObject { ["made"] = true, ["vehicles"] = A(record["vehicles"]).Count };
    }
    public JsonObject TripPoints(string vehicleId)
    {
        var record = Record(); var v = A(record["vehicles"]).FirstOrDefault(v => S(v, "id") == vehicleId); var r = population.Town.Resident(S(v, "owner")); var result = new JsonObject(); if (r == null) return result; var places = population.Host.Context.World("town")!["places"]!;
        foreach (string key in new[] { "home" }.Concat(WeekKeys(r))) { var p = KeyPoint(r, key, places); if (p != null) result[key] = new JsonArray(p.Value.x, p.Value.z); } return result;
    }
    public JsonArray Errands(int day) => GenerateErrands(population.Snapshot(), Record(), day);
    public JsonArray GenerateErrands(JsonObject town, JsonObject record, int day)
    {
        var result = new JsonArray(); if (day % 7 == 0) return result; var residents = A(town["residents"]); var flights = A(population.Facts["possession"]?["FLIGHTS"]); string seed = N(town["seed"]).ToString(System.Globalization.CultureInfo.InvariantCulture);
        bool Home(JsonNode person, double hour) => NativeShops.Activity(person.AsObject(), day, hour).act == "home";
        foreach (var v in A(record["vehicles"])) { var r = residents.FirstOrDefault(r => S(r, "id") == S(v, "owner")); if (r == null) continue; string id = S(v, "id"), kind = S(v, "kind"); double hour = 7.5 + Hash(id + ":" + day + ":" + seed) % 7 * .5;
            JsonObject Errand(JsonNode to, string label, JsonArray who, double from, double back, int items) => new() { ["id"] = "errand:" + id + ":" + day, ["kind"] = kind, ["vehicle"] = id, ["who"] = who, ["hour"] = from, ["back"] = back, ["to"] = to.DeepClone(), ["toLabel"] = label, ["load"] = new JsonObject { ["what"] = "sacks", ["items"] = items } };
            if (kind == "boat") { double fx = v?["boat"]?["flight"]?[0] == null ? 1e9 : N(v["boat"]?["flight"]?[0]), fz = v?["boat"]?["flight"]?[1] == null ? 1e9 : N(v["boat"]?["flight"]?[1]); var mine = flights.FirstOrDefault(f => NativeTownBackGeometry.D(N(f?["top"]?[0]), N(f?["top"]?[1]), fx, fz) < 1);
                // (#195) a boat moored at a ladder (NativeBoatOutings): her ladder's head is her start, in the water of the nearest flight
                if (mine == null && S(v?["boat"], "board") == "ladder" && flights.OrderBy(f => NativeTownBackGeometry.D(N(f?["top"]?[0]), N(f?["top"]?[1]), fx, fz)).FirstOrDefault() is { } nearest) mine = new JsonObject { ["id"] = "ladder:" + id, ["top"] = new JsonArray(fx, fz), ["water"] = S(nearest, "water") };
                if (mine == null) continue;
                var others = flights.Where(f => S(f, "water") == S(mine, "water") && S(f, "id") != S(mine, "id") && NativeTownBackGeometry.D(N(f?["top"]?[0]), N(f?["top"]?[1]), N(mine["top"]?[0]), N(mine["top"]?[1])) > 40).ToArray(); if (others.Length == 0) continue; var to = others[Hash(id + ":to:" + day) % others.Length]!;
                var who = new JsonArray(S(r, "id")); foreach (var crew in residents.Where(q => N(q?["household"]) == N(r["household"]) && S(q, "id") != S(r, "id") && N(q?["age"]) >= 12 && Home(q!, hour) && Home(q!, hour + 1.5)).Take(2)) who.Add(S(crew, "id")); result.Add(Errand(to["top"]!, S(to, "label"), who, hour, hour + 2.5, 2));
            } else if (kind == "dray") { var shops = A(town["shops"]).OrderBy(q => NativeTownBackGeometry.D(N(q?["door"]?[0]), N(q?["door"]?[1]), N(v?["home"]?[0]), N(v?["home"]?[1]))).ToArray(); if (shops.Length == 0) continue; var shop = shops[Hash(id + ":" + day) % Math.Min(3, shops.Length)]!; result.Add(Errand(shop["door"]!, S(shop, "label"), new JsonArray(S(r, "id")), hour + 2, hour + 3.5, 3)); }
        } return result;
    }
}
