using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownPopulation
{
    public JsonObject Schedule(JsonObject resident, JsonObject places, string[] taverns, Func<double> rng)
    {
        double J(double h, double spread = .5) => Math.Floor((h + (rng() * 2 - 1) * spread) * 4 + .5) / 4;
        string Near(IEnumerable<string> keys, double x, double z)
        {
            string? best = null; double distance = double.PositiveInfinity;
            foreach (string key in keys) { var p = places[key]; if (p == null) continue; double d = Math.Pow(N(p["x"]) - x, 2) + Math.Pow(N(p["z"]) - z, 2); if (d < distance) { distance = d; best = key; } }
            return best ?? throw new NativeServiceException("The native town has no usable place for this journey.", 409);
        }
        static JsonArray Seg(double from, double to, string act, string? where = null) { var result = new JsonArray(from, to, act); if (where != null) result.Add(where); return result; }
        double homeX = N(resident["home"]?["sx"]), homeZ = N(resident["home"]?["sz"]); var work = resident["work"]!; var wp = places[S(work, "place")] ?? places["rijnkaai"]!; var at = work["at"] ?? work["a"];
        double workX = at == null ? N(wp["x"]) : N(at[0]), workZ = at == null ? N(wp["z"]) : N(at[1]);
        string tavernWork = Near(taverns, workX, workZ), tavernHome = Near(taverns, homeX, homeZ), play = Near(A(Facts["PLAY"]).Select(p => "play:" + p!.GetValue<string>()), homeX, homeZ), market = Near(A(Facts["MARKETS"]).Select(p => "market:" + p!.GetValue<string>()), homeX, homeZ);
        bool pious = N(resident["stats"]?["piety"]) >= 5 && rng() < .8, drinker = N(resident["stats"]?["piety"]) <= 5 && rng() < .6;
        var church = pious ? new List<JsonArray> { Seg(J(8.75, .25), J(11, .25), "church", "church") } : new List<JsonArray>();
        var day = new List<JsonArray>(); var sunday = church.Concat(new[] { Seg(J(14.5), J(17), "stroll", play) }).ToList();
        void Add(params JsonArray[] segments) => day.AddRange(segments);
        switch (S(resident, "trade")) {
            case "docker": case "natie": case "boatman": Add(Seg(J(6, .25), 12, "work"), drinker ? Seg(12, 13, "tavern", tavernWork) : Seg(12, 13, "home"), Seg(13, J(18.5), "work")); if (drinker) Add(Seg(J(19), J(21.5, 1), "tavern", tavernHome)); break;
            case "porter": case "carter": case "errand_boy": Add(Seg(J(6.5), 12, "work"), Seg(13, J(18), "work")); if (drinker && N(resident["age"]) > 16) Add(Seg(J(19), J(21), "tavern", tavernHome)); break;
            case "sailor": Add(Seg(J(8), 12, "loiter", S(work, "place")), Seg(12, J(17), "work"), Seg(J(17.5), J(23.5, .5), "tavern", tavernWork)); sunday = new() { Seg(J(10), 13, "loiter", S(work, "place")), Seg(J(16), J(23.5, .5), "tavern", tavernWork) }; break;
            case "fishwife": case "market_woman": Add(Seg(J(6, .25), J(17), "work")); if (N(resident["stats"]?["gossip"]) >= 6) Add(Seg(J(18), J(19.5), "loiter", play)); break;
            case "baker": Add(Seg(J(5.5, .25), 13, "work"), Seg(14, J(18.5), "work")); break;
            case "grocer": case "chandler": case "tobacconist": case "pawnbroker": case "cobbler": case "draper": case "shopwife": Add(Seg(J(7, .25), 12.5, "work"), Seg(13.5, J(19), "work")); if (drinker && S(resident, "sex") == "m") Add(Seg(J(20), J(22), "tavern", tavernHome)); break;
            case "publican": Add(Seg(J(9.5), 26, "work")); sunday = church.Concat(new[] { Seg(J(12), 26, "work") }).ToList(); break;
            case "clerk": case "merchant": Add(Seg(J(8), 12.5, "work"), Seg(13.5, J(18), "work")); if (S(resident, "trade") == "merchant") Add(Seg(J(19), J(20.5), "stroll", "play:grote_markt")); else if (drinker) Add(Seg(J(18.5), J(20.5), "tavern", tavernHome)); break;
            case "maid": Add(Seg(J(6.5), 9, "work"), Seg(9, J(10.5), "market", market), Seg(10.5, J(20), "work")); sunday = church.Concat(new[] { Seg(J(15), J(17.5), "stroll", play) }).ToList(); break;
            case "laundress": Add(Seg(J(7), 12, "work"), Seg(13, J(16.5), "work"), Seg(J(17), J(18), "market", market)); break;
            case "seamstress": case "housewife": Add(Seg(J(9, .75), J(10.5), "market", market)); if (N(resident["stats"]?["gossip"]) >= 5 || rng() < .4) Add(Seg(J(16.5), J(18), "loiter", play)); break;
            case "police": if (S(resident, "id")[^1] % 2 == 0) Add(Seg(J(18, .25), 30, "work")); else Add(Seg(6, 13, "work"), Seg(14, J(19, .25), "work")); sunday = day.ToList(); break;
            case "priest": Add(Seg(7, 12, "work"), Seg(14, 18, "work")); sunday = new() { Seg(6.5, 13, "work"), Seg(15, 18, "work") }; break;
            case "sexton": case "foreman": case "fish_merchant": case "water_bailiff": case "brewer": Add(Seg(6, 22, "work")); sunday = S(resident, "trade") == "sexton" ? new() { Seg(6, 22, "work") } : church.Concat(new[] { Seg(11, 22, "work") }).ToList(); break;
            case "lamplighter": Add(Seg(5.5, 7, "work"), Seg(J(17, .25), 19.5, "work")); sunday = day.ToList(); break;
            case "beggar": Add(Seg(J(8), J(19), "work")); sunday = new() { Seg(7.5, 13, "work"), Seg(14, 19, "work") }; break;
            case "thief": Add(Seg(J(11), J(17), "loiter", market), Seg(J(18), 21, "tavern", tavernHome), Seg(21, J(28, .5), "work")); sunday = day.ToList(); break;
            case "retired": Add(Seg(J(9), J(11.5), "loiter", play), Seg(J(14), J(16.5), "loiter", Near(new[] { "play:steenplein", "play:vismarkt", "play:bassin_south", "play:back_lane" }, homeX, homeZ))); if (drinker) Add(Seg(J(19), J(21), "tavern", tavernHome)); break;
            case "child": case "street_child":
                if (S(resident, "trade") == "street_child") Add(Seg(J(7), 12, "play", S(work, "place")), Seg(12, J(17), "loiter", market), Seg(J(17), J(20.5), "play", S(work, "place")));
                else Add(Seg(J(8.5), 12, "play", play), Seg(J(13.5), J(17.5), "play", play));
                sunday = S(resident, "trade") == "street_child" ? day.ToList() : church.Concat(new[] { Seg(J(14), J(17.5), "play", play) }).ToList(); break;
            case "infant": sunday.Clear(); break;
        }
        return new JsonObject { ["day"] = Tidy(new JsonArray(day.Select(s => (JsonNode)s.DeepClone()).ToArray())), ["sunday"] = Tidy(new JsonArray(sunday.Select(s => (JsonNode)s.DeepClone()).ToArray())) };
    }
}
