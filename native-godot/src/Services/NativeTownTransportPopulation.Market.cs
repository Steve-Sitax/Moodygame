using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownTransportPopulation
{
    /// <summary>A pitched market's sellers' handcarts (#150 the Vismarkt, #192 the Grote Markt), added to the town's transport after the fresh town is made:
    /// each cart stands by its seller's door, and at work at her pitch's cart place. Anyone else's cart or velocipede
    /// parked on a pitch (its stall, its seller's place or its cart's place) moves to open ground nearby. Sellers
    /// who have a cart already are left as they are. Returns the carts added.</summary>
    public int AddMarketCarts(JsonObject pitches, string place = "vismarkt")
    {
        var c = population.Host.Context;
        if (c.World("transport") is not JsonObject had) return 0;
        var record = had.DeepClone().AsObject();
        var town = population.Snapshot();
        var vehicles = A(record["vehicles"]);
        var sellers = A(town["residents"]).Where(r => r?["work"]?["pitch"] != null && S(r["work"], "place") == place).Select(r => r!).ToList();
        if (sellers.Count == 0) { population.Town.Clear(); return 0; }
        var list = A(pitches["list"]);
        var keep = KeepOff(town);
        foreach (var q in list) { keep.Add((N(q?["x"]), N(q?["z"]), N(q?["length"]) / 2 + 1)); keep.Add((N(q?["seller"]?[0]), N(q?["seller"]?[1]), 1.5)); }
        var taken = new List<JsonArray>();
        foreach (var v in vehicles) { if (v?["home"] is JsonArray home) taken.Add(home); foreach (var p in v?["parks"] as JsonObject ?? new JsonObject()) if (p.Value is JsonArray park) taken.Add(park); }
        foreach (var q in list) if (q?["cart"] is JsonArray own) taken.Add(own);
        bool OnPitch(JsonArray p) => list.Any(q => NativeTownBackGeometry.D(N(p[0]), N(p[1]), N(q?["x"]), N(q?["z"])) < N(q?["length"]) / 2 + 1
            || NativeTownBackGeometry.D(N(p[0]), N(p[1]), N(q?["seller"]?[0]), N(q?["seller"]?[1])) < 1.5
            || q?["cart"] is JsonArray cart && NativeTownBackGeometry.D(N(p[0]), N(p[1]), N(cart[0]), N(cart[1])) < 2.4);
        var owners = sellers.Select(r => S(r, "id")).ToHashSet();
        int moved = 0, made = 0;
        foreach (var v in vehicles)
        {
            if (owners.Contains(S(v, "owner")) || S(v, "kind") is not ("handcart" or "velocipede")) continue;
            foreach (var key in (v?["parks"] as JsonObject ?? new JsonObject()).Select(p => p.Key).ToArray())
            {
                if (v!["parks"]![key] is not JsonArray park || key == "home" || !OnPitch(park)) continue;
                var spot = SpotNear(N(park[0]), N(park[1]), S(v, "kind") == "handcart" ? 1.25 : .45, taken, keep, 16, N(park[2]), 2.5);
                if (spot == null) continue;
                taken.Add(spot); v["parks"]![key] = spot; moved++;
            }
        }
        foreach (var r in sellers)
        {
            if (vehicles.Any(v => S(v, "kind") == "handcart" && S(v, "owner") == S(r, "id")) || r["work"]?["cart"] is not JsonArray work) continue;
            var home = BesideDoor(r, -1, 1.25, taken, keep, true) ?? SpotNear(N(r["home"]?["sx"]), N(r["home"]?["sz"]), 1.25, taken, keep, 20);
            if (home == null) continue;
            taken.Add(home);
            var parks = new JsonObject { ["home"] = home.DeepClone() };
            foreach (string key in WeekKeys(r)) if (key.StartsWith("work", StringComparison.Ordinal)) parks[key] = new JsonArray(N(work[0]), N(work[1]), N(work[2]));
            string household = N(r["household"]).ToString(System.Globalization.CultureInfo.InvariantCulture);
            vehicles.Add(new JsonObject { ["id"] = "cart:" + household, ["kind"] = "handcart", ["owner"] = S(r, "id"), ["household"] = r["household"]!.DeepClone(), ["home"] = home, ["parks"] = parks, ["label"] = "the " + S(r, "surname") + " family's handcart" });
            made++;
        }
        if (made > 0 || moved > 0) c.SetWorld("transport", record);
        population.Town.Clear(); assets.Clear();
        return made;
    }
}
