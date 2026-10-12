using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.World;

namespace Scheldemist.Native.Services;

/// <summary>Shared native generation facts, current native door/navigation queries and persistent resident intake.</summary>
public sealed partial class NativeTownPopulation
{
    public NativeServiceHost Host { get; }
    public NativeTown Town { get; }
    public JsonObject Facts { get; }
    public JsonObject City { get; }
    public JsonObject Buildings { get; }
    public JsonObject Kept { get; }
    public JsonObject Spots { get; }
    private NativeServiceContext C => Host.Context;
    public readonly List<Action<uint>> Augment = new();
    public Func<double, double, double, bool> Open = Ways.Open;
    public Func<double, double, bool> Reachable = Ways.Reachable;
    public Func<double, double, int> Flags = Ways.Flags;
    public Func<(double X0, double Z0, double Res, int W, int H)> MapInfo = () => Ways.MapInfo;
    public Func<double, double, double, double, bool> CanStep = Ways.CanStep;
    public Func<double, double, double, (double x, double z)?> Snap = (x, z, max) => Ways.NearestOpen(x, z, max) is { } p ? (p.X, p.Y) : null;
    private List<JsonObject>? doors;
    public IReadOnlyList<JsonObject> Doors => doors ??= NativeTownHouseDoors.Build(Buildings["houses"]!.AsArray(), Open, Reachable);
    public NativeTownPopulation(NativeServiceHost host, NativeTown town, JsonObject? facts = null, JsonObject? city = null, JsonObject? buildings = null, JsonObject? kept = null, JsonObject? spots = null, IReadOnlyList<JsonObject>? houseDoors = null)
    {
        Host = host; Town = town; Facts = facts ?? JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory, "native-population-facts.json")))!.AsObject();
        City = city ?? JsonNode.Parse(File.ReadAllText(Scheldemist.Paths.Shared("city.json")))!.AsObject(); Buildings = buildings ?? JsonNode.Parse(File.ReadAllText(Scheldemist.Paths.Shared("city_build.json")))!.AsObject(); Kept = kept ?? JsonNode.Parse(File.ReadAllText(Scheldemist.Paths.Shared("inworld_houses.json")))!.AsObject();
        Spots = spots ?? JsonNode.Parse(File.ReadAllText(Scheldemist.Paths.Shared("spots.json")))!.AsObject();
        doors = houseDoors?.ToList();
        town.AnchorOpen = (x, z, radius) => Open(x, z, radius); town.AnchorReachable = (x, z) => Reachable(x, z); town.AnchorSnap = (x, z, maximum) => Snap(x, z, maximum);
    }
    public JsonObject Spot(string id) => Spots[id]!.AsObject();
    internal static double N(JsonNode? node) => NativeTown.N(node);
    internal static string S(JsonNode? node, string key, string fallback = "") => NativeTown.S(node, key, fallback);
    internal static JsonArray A(JsonNode? node) => node as JsonArray ?? new JsonArray();
    public static Func<double> Random(uint seed)
    {
        uint a = seed; return () => { a = unchecked(a + 0x6d2b79f5); uint t = unchecked((a ^ (a >> 15)) * (a | 1)); t ^= unchecked(t + (t ^ (t >> 7)) * (t | 61)); return (t ^ (t >> 14)) / 4294967296.0; };
    }
    public static JsonArray Tidy(JsonArray source)
    {
        var result = new JsonArray(); foreach (var original in source.OrderBy(s => N(s?[0]))) { double from = result.Count > 0 ? Math.Max(N(original?[0]), N(result[^1]?[1])) : N(original?[0]); if (N(original?[1]) - from < .25) continue; var segment = original!.DeepClone().AsArray(); segment[0] = from; result.Add(segment); } return result;
    }
    public JsonObject Snapshot()
    {
        return Town.PrivateTown();
    }
    public string TradeLabel(JsonObject r) => S(r["visitor"], "role") == "fortune" ? "fortune teller" : S(r, "trade") == "thief" ? "day labourer" : S(Facts["TRADES"]?[S(r, "trade")], "label", S(r, "trade").Replace('_', ' '));
    public void AddResident(JsonObject person, string? role = null, string? district = null)
    {
        string id = S(person, "id"), trade = S(person, "trade"); var place = C.World("town")?["places"]?[S(person["work"], "place")];
        C.Execute("INSERT INTO npc(id,name,role,district,faction,persona_json,spot_id,active) VALUES($p0,$p1,$p2,$p3,$p4,'{}',NULL,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,district=excluded.district,faction=excluded.faction", id, S(person, "name"), role ?? TradeLabel(person), district ?? S(place, "district", "town"), person["faction"] == null ? null : S(person, "faction"));
        C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) VALUES($p0,1)", id);
        C.Execute("INSERT INTO resident(id,household,trade,data_json) VALUES($p0,$p1,$p2,$p3) ON CONFLICT(id) DO UPDATE SET household=excluded.household,trade=excluded.trade,data_json=excluded.data_json", id, (int)N(person["household"]), trade, person.ToJsonString()); Town.Clear();
    }
    public void AddPlaces(JsonObject additions)
    {
        var state = C.World("town")!.AsObject(); foreach (var place in additions) state["places"]![place.Key] = place.Value?.DeepClone(); C.SetWorld("town", state); Town.Clear();
    }
    public void InvalidateDoors() => doors = null;
}
