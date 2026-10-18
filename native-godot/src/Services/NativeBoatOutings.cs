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
        foreach (var b in boats())
        {
            var m = b?["mooring"];
            string id = S(b, "id"), owner = S(b, "owner");
            if (m == null || owner == "" || have.Contains(id) || S(m["board"], "kind") != "steps" || !residents.TryGetValue(owner, out var r)) continue;
            var home = new JsonArray(N(b!["x"]), N(b["z"]), N(b["yaw"]));
            string kind = S(b, "kind"), noun = kind switch { "rowboat" => "rowing boat", "workboat" => "work boat", "shipsboat" => "ship's boat", "eelboat" => "eel boat", "oldboat" => "old boat", _ => kind };
            vehicles.Add(new JsonObject
            {
                ["id"] = id, ["kind"] = "boat", ["owner"] = owner, ["household"] = r["household"]!.DeepClone(), ["home"] = home,
                ["parks"] = new JsonObject { ["home"] = home.DeepClone() }, ["label"] = S(r, "name") + "'s " + noun,
                ["boat"] = new JsonObject { ["kind"] = kind, ["landing"] = m["board"]!["at"]!.DeepClone(), ["flight"] = m["board"]!["top"]!.DeepClone() },
            });
        }
        return record;
    }

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
