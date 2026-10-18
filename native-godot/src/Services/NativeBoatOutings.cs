using System;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

/// <summary>
/// Issue 154 (Steve 2026-10-17: fewer small boats is all right; the small boats that stay should be used more): the
/// households' boat trips beyond the three family boats of the original transport stage. Every small boat moored at a
/// flight of steps whose owner is a resident becomes her household's boat too (her owner rows her out from her own
/// steps, as the family boats are), and every boat of a household goes out twice a working day: the original
/// morning errand and one in the afternoon. The original generation (NativeTownTransportPopulation, compared with the
/// browser's by its proof) is unchanged; this is laid over it where the game wires the transport service. The
/// moored boats come as the game has them now (Scheldemist.Movers.MooredRespace: moved off the ladders, or gone).
/// #195: one boat moored at a ladder in each water is her household's boat too; her people go down and up the ladder.
/// </summary>
public sealed class NativeBoatOutings
{
    private readonly NativeTownPopulation population;
    private readonly NativeTownTransportPopulation transport;
    private readonly Func<JsonArray> boats;
    private System.Collections.Generic.Dictionary<string, JsonNode> residents = new();
    private long cachedFor = -1;
    public NativeBoatOutings(NativeTownPopulation population, NativeTownTransportPopulation transport, Func<JsonArray> boats) => (this.population, this.transport, this.boats) = (population, transport, boats);

    /// <summary>The transport record with the steps-moored boats of residents added as their households' boats.</summary>
    public JsonObject Record()
    {
        var record = Scheldemist.Movers.MooredRespace.Transport(transport.Record());
        if (record["vehicles"] is not JsonArray vehicles) return record;
        var have = vehicles.Select(v => S(v, "id")).ToHashSet();
        if (cachedFor != population.Town.Revision) { residents = A(population.Snapshot()["residents"]).ToDictionary(r => S(r, "id"), r => r!); cachedFor = population.Town.Revision; }
        var flights = A(population.Facts["possession"]?["FLIGHTS"]);
        var ladderWaters = new System.Collections.Generic.HashSet<string>();
        foreach (var b in boats().OrderBy(b => S(b?["mooring"]?["board"], "kind") == "steps" ? 0 : 1).ThenBy(b => LadderOrder(S(b, "id"))))
        {
            var m = b?["mooring"];
            string id = S(b, "id"), owner = S(b, "owner"), board = S(m?["board"], "kind");
            if (m == null || owner == "" || have.Contains(id) || board is not ("steps" or "ladder") || !residents.TryGetValue(owner, out var r)) continue;
            // (#195) one boat moored at a ladder in each open water (the river, the Petit Bassin): a resident's own boat, her
            // owner climbs down her ladder into her and up it again. Only one lying within 35 m of a flight of her water (so
            // in that water, not up the canal or the Vliet behind their bridges) with another of its flights to row to.
            if (board == "ladder")
            {
                double lx = N(m["board"]?["top"]?[0]), lz = N(m["board"]?["top"]?[1]);
                double D(JsonNode? f) => NativeTownBackGeometry.D(N(f?["top"]?[0]), N(f?["top"]?[1]), lx, lz);
                var nearest = flights.OrderBy(D).FirstOrDefault();
                string water = S(nearest, "water");
                if (S(m["owner"], "kind") != "person" || nearest == null || D(nearest) > 35 || ladderWaters.Contains(water) || !flights.Any(f => S(f, "water") == water && D(f) > 40)) continue;
                ladderWaters.Add(water);
            }
            var home = new JsonArray(N(b!["x"]), N(b["z"]), N(b["yaw"]));
            string kind = S(b, "kind"), noun = kind switch { "rowboat" => "rowing boat", "workboat" => "work boat", "shipsboat" => "ship's boat", "eelboat" => "eel boat", "oldboat" => "old boat", _ => kind };
            vehicles.Add(new JsonObject
            {
                ["id"] = id, ["kind"] = "boat", ["owner"] = owner, ["household"] = r["household"]!.DeepClone(), ["home"] = home,
                ["parks"] = new JsonObject { ["home"] = home.DeepClone() }, ["label"] = S(r, "name") + "'s " + noun,
                ["boat"] = board == "ladder"
                    ? new JsonObject { ["kind"] = kind, ["landing"] = m["board"]!["top"]!.DeepClone(), ["flight"] = m["board"]!["top"]!.DeepClone(), ["board"] = "ladder" }
                    : new JsonObject { ["kind"] = kind, ["landing"] = m["board"]!["at"]!.DeepClone(), ["flight"] = m["board"]!["top"]!.DeepClone() },
            });
        }
        return record;
    }

    /// <summary>The order the ladder boats are taken in (one per water): the same in every town and on every PC.</summary>
    private static uint LadderOrder(string id) { uint h = 2166136261; foreach (char c in id + ":ladder") h = unchecked((h ^ c) * 16777619); return h; }

    /// <summary>The day's errands: the original ones for every household boat (the added ones too), and each boat out a
    /// second time in the afternoon, back before dusk.</summary>
    public JsonArray Errands(int day)
    {
        var list = transport.GenerateErrands(population.Snapshot(), Record(), day);
        foreach (var e in list.ToArray())
        {
            if (S(e, "kind") != "boat") continue;
            double hour = Math.Min(16.5, N(e!["hour"]) + 5.5);
            var pm = e.DeepClone().AsObject();
            pm["id"] = S(e, "id") + ":pm"; pm["hour"] = hour; pm["back"] = hour + 2;
            list.Add(pm);
        }
        return list;
    }
}
