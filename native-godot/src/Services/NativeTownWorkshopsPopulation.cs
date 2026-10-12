using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

/// <summary>Velocipede maker and wheelwright, chosen from native free house fronts with physical room for their displays.</summary>
public sealed class NativeTownWorkshopsPopulation
{
    private readonly NativeTownPopulation population;
    public NativeTownWorkshopsPopulation(NativeTownPopulation population) => this.population = population;
    public List<JsonObject> FreeDoors(JsonObject town)
    {
        var c = population.Host.Context; var residents = A(town["residents"]); var houses = residents.Select(r => (int)N(r?["home"]?["house"])).ToHashSet(); var taken = new List<(double x, double z)>();
        foreach (var r in residents) { taken.Add((N(r?["home"]?["sx"]), N(r?["home"]?["sz"]))); if (r?["work"]?["door"] is { } d) taken.Add((N(d[0]), N(d[1]))); }
        foreach (var place in town["places"]!.AsObject()) if (place.Value?["door"] is { } d) taken.Add((N(d[0]), N(d[1]))); foreach (var shop in A(town["shops"])) taken.Add((N(shop?["door"]?[0]), N(shop?["door"]?[1])));
        foreach (string key in new[] { "homes", "poesje:door", "press" }) { var state = c.World(key); if (state == null) continue;
            foreach (var home in A(state["homes"])) taken.Add((N(home?["step"]?[0]), N(home?["step"]?[1]))); if (state["dealer"] is { } dealer) taken.Add((N(dealer["step"]?[0]), N(dealer["step"]?[1]))); if (state["sx"] != null && state["sz"] != null) taken.Add((N(state["sx"]), N(state["sz"]))); if (state["post"] is { } post) taken.Add((N(post["step"]?[0]), N(post["step"]?[1]))); foreach (var corner in A(state["corners"])) taken.Add((N(corner?["x"]), N(corner?["z"])));
        }
        return population.Doors.Where(d => !houses.Contains((int)N(d["house"])) && !taken.Any(q => NativeTownBackGeometry.D(q.x, q.z, N(d["sx"]), N(d["sz"])) < 5)).ToList();
    }
    public JsonObject? Generate(uint seed, JsonObject town, bool cart)
    {
        var velo = population.Host.Context.World("veloshop"); var candidates = new List<(JsonObject door, List<(double x, double z, double yaw)> points, double distance)>();
        foreach (var d in FreeDoors(town)) {
            if (N(d["storeys"]) < 2 || (cart && velo != null && NativeTownBackGeometry.D(N(velo["step"]?[0]), N(velo["step"]?[1]), N(d["sx"]), N(d["sz"])) <= 12)) continue;
            double outX = N(d["out"]?[0]), outZ = N(d["out"]?[1]), alongX = -outZ, alongZ = outX; var points = new List<(double x, double z, double yaw)>();
            foreach (double offset in cart ? new[] { -2.6, 2.6, -3.4, 3.4 } : new[] { -1.9, 1.9, -2.7, 2.7 }) {
                double x = N(d["x"]) + outX * (cart ? 1.9 : 1) + alongX * offset, z = N(d["z"]) + outZ * (cart ? 1.9 : 1) + alongZ * offset, dirX = cart && offset < 0 ? -alongX : alongX, dirZ = cart && offset < 0 ? -alongZ : alongZ;
                if (!population.Open(x, z, cart ? 1 : .5) || (cart && !population.Open(x - dirX * 1.8, z - dirZ * 1.8, .6)) || !population.Reachable(x, z) || (cart && points.Any(q => NativeTownBackGeometry.D(q.x, q.z, x, z) < 3))) continue;
                // Source velo displays use decimal-toFixed, while carts use half-up millimetres.
                double yaw = Math.Atan2(dirX, dirZ); yaw = cart ? Round(yaw * 1000) / 1000 : double.Parse(yaw.ToString("F3", System.Globalization.CultureInfo.InvariantCulture), System.Globalization.CultureInfo.InvariantCulture);
                points.Add((NativeTownBackGeometry.R1(x), NativeTownBackGeometry.R1(z), yaw));
            }
            if (points.Count >= 2 && population.Open(N(d["sx"]) + outX * .9, N(d["sz"]) + outZ * .9, .4)) candidates.Add((d, points, NativeTownBackGeometry.D(N(d["sx"]), N(d["sz"]), cart ? -20 : -150, cart ? 62 : 96)));
        }
        if (candidates.Count == 0) return null; var selected = candidates.OrderBy(q => q.distance).First(); var door = selected.door; var random = NativeTownPopulation.Random(seed ^ (cart ? 0x3a71c0u : 0x7e10c1u));
        string first = (cart ? new[] { "Staf", "Jan", "Pieter", "Lode", "Frans" } : new[] { "Remi", "Achiel", "Florent", "Jules", "Cornelis" })[(int)Math.Floor(random() * 5)]; var surnames = A(town["residents"]).Select(r => S(r, "surname")).ToHashSet(); string surname = (cart ? new[] { "Wagemans", "Van Dyck", "Wielemans", "De Wit", "Verbruggen" } : new[] { "Deschepper", "Smeets", "Van Tilt", "De Ridder", "Vanhecke" }).FirstOrDefault(s => !surnames.Contains(s)) ?? (cart ? "Wagemans" : "De Ridder");
        double facing = Math.Atan2(N(door["out"]?[0]), N(door["out"]?[1])); facing = cart ? Round(facing * 1000) / 1000 : double.Parse(facing.ToString("F3", System.Globalization.CultureInfo.InvariantCulture), System.Globalization.CultureInfo.InvariantCulture); var at = new JsonArray(NativeTownBackGeometry.R1(N(door["sx"]) + N(door["out"]?[0]) * .9), NativeTownBackGeometry.R1(N(door["sz"]) + N(door["out"]?[1]) * .9), facing);
        string id = cart ? "wheelwright" : "velo_maker", place = cart ? "cart_shop" : "velo_shop", name = first + " " + surname, label = name + (cart ? "'s wheelwright's shop" : "'s velocipede workshop"); int hh = A(town["residents"]).Select(r => (int)N(r?["household"])).Append(0).Max() + 1;
        var person = new JsonObject { ["id"] = id, ["first"] = first, ["surname"] = surname, ["name"] = name, ["age"] = (cart ? 38 : 34) + Math.Floor(random() * (cart ? 16 : 14)), ["sex"] = "m", ["household"] = hh, ["family_role"] = "single", ["trade"] = id, ["faction"] = population.Facts["TRADES"]![id]!["faction"]?.DeepClone(), ["kind"] = "shopkeeper", ["home"] = Home(door), ["work"] = new JsonObject { ["place"] = place, ["kind"] = "post", ["at"] = at.DeepClone() }, ["sched"] = new JsonObject { ["day"] = cart ? new JsonArray(Seg(7.5, 12, "work"), Seg(13, 18.5, "work")) : new JsonArray(Seg(8, 12.5, "work"), Seg(13.5, 18.5, "work")), ["sunday"] = new JsonArray(Seg(8.75, 11, "church", "church")) }, ["stats"] = new JsonObject { ["honesty"] = 6, ["temper"] = cart ? 5 : 4, ["piety"] = cart ? 5 : 4, ["warmth"] = 5, ["greed"] = cart ? 4 : 5, ["courage"] = 6, ["gossip"] = 4, ["wealth"] = cart ? 4 : 5 }, ["dog"] = null };
        var shop = new JsonObject { ["id"] = id, ["label"] = label, ["step"] = new JsonArray(N(door["sx"]), N(door["sz"])), ["wall"] = new JsonArray(N(door["x"]), N(door["z"])), ["out"] = door["out"]!.DeepClone(), ["at"] = at, ["show"] = new JsonArray(selected.points.Take(2).Select(q => (JsonNode)new JsonArray(q.x, q.z, q.yaw)).ToArray()) };
        return new JsonObject { ["resident"] = person, ["shop"] = shop, ["place"] = new JsonObject { [place] = new JsonObject { ["label"] = label, ["x"] = N(door["sx"]), ["z"] = N(door["sz"]), ["r"] = 3, ["district"] = "town", ["door"] = new JsonArray(N(door["sx"]), N(door["sz"])), ["out"] = door["out"]!.DeepClone() } } };
    }
    private bool Ensure(uint seed, bool cart)
    {
        var c = population.Host.Context; string id = cart ? "wheelwright" : "velo_maker", key = cart ? "cartshop" : "veloshop"; if (c.Scalar<long>("SELECT COUNT(*) FROM resident") == 0 || c.World(key) != null || c.One("SELECT 1 FROM npc WHERE id=$p0", id) != null) return false;
        var made = Generate(seed, population.Snapshot(), cart); if (made == null) return false; c.Atomic(() => { population.AddResident(made["resident"]!.AsObject(), district: "town"); population.AddPlaces(made["place"]!.AsObject()); c.SetWorld(key, made["shop"]); }); return true;
    }
    public bool EnsureBike(uint seed) => Ensure(seed, false);
    public bool EnsureCart(uint seed) => Ensure(seed, true);
}
