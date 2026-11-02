using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>
/// The squares the razing opened round Sint-Paulus, Sint-Jacob and Sint-Carolus (#221: "for little shops, trees, people
/// gathering, events"): each becomes a place of the town (the town's places: its own id, market:id for its small market),
/// and the neighbours who lived nearer to it than to their old square meet there now: their gossip, loitering, Sunday
/// strolls and the children's play (and, the housewives and maids, their morning's marketing at its stalls) move to the
/// church square. Added once after the original town was made (which stays as it was made), on a new game and on a load
/// that has not had it yet; the markets' sellers are NativeTownMarketPopulation's (native-extras.json fields).
/// </summary>
public sealed class NativeTownSquaresPopulation : INativeServiceModule
{
    private const string Key = "church-squares-v1";
    /// <summary>Each square: id (also its market's place in native-extras.json), label, middle (open paving) and reach.</summary>
    public static readonly (string Id, string Label, double X, double Z, double R)[] Squares =
    {
        ("sint_paulusplaats", "the Sint-Paulusplaats", 84, 292.6, 12),
        ("sint_jacobsmarkt", "the Sint-Jacobsmarkt", -54, 305, 12),
        ("conscienceplein", "the Conscienceplein", -118, 159.5, 10),
    };
    /// <summary>How near home a neighbour lives to take a square as theirs, and how many take it.</summary>
    private const double Reach = 85;
    private const int Gatherers = 12, Shoppers = 10;
    private static readonly HashSet<string> Gathering = new() { "loiter", "play", "stroll" };
    private readonly NativeTownPopulation population;
    public NativeTownSquaresPopulation(NativeTownPopulation population) => this.population = population;

    public void Register(NativeServiceHost host)
    {
        host.NewGame += () => Ensure();
        host.Loaded += () => Ensure();
        Ensure();
    }

    private static double N(JsonNode? n) => NativeTown.N(n);
    private static string S(JsonNode? n, string key) => NativeTown.S(n, key);
    private static double D(double ax, double az, double bx, double bz) => Math.Sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

    /// <summary>The squares as places and their neighbours' gatherings. Returns the residents whose day changed.</summary>
    public int Ensure()
    {
        var c = population.Host.Context;
        var town = c.World("town");
        if (town?["places"] is not JsonObject places || c.World(Key) != null && Squares.All(q => places[q.Id] != null)) return 0;
        var facts = NativeTownPopulation.A(population.Facts["PLACES"]);
        var add = new JsonObject();
        foreach (var q in Squares)
        {
            var (x, z) = population.Snap(q.X, q.Z, 6) ?? (q.X, q.Z);
            // (the district of the nearest of the town's own places, as the back streets' places take it)
            var near = facts.OrderBy(f => D(N(f?["x"]), N(f?["z"]), x, z)).FirstOrDefault();
            var place = new JsonObject { ["label"] = q.Label, ["x"] = Math.Round(x, 2), ["z"] = Math.Round(z, 2), ["r"] = q.R, ["district"] = S(near, "district") };
            add[q.Id] = place;
            add["market:" + q.Id] = place.DeepClone();
        }
        population.AddPlaces(add);
        int changed = 0;
        var moved = new JsonObject();
        var all = population.Town.Residents.Values.Select(r => r.DeepClone().AsObject()).ToList();
        var taken = new HashSet<string>();
        foreach (var q in Squares)
        {
            // the neighbours nearest the square, of those whose old square is farther off than this one
            double Home(JsonObject r) => D(N(r["home"]?["sx"]), N(r["home"]?["sz"]), q.X, q.Z);
            var near = all.Where(r => !taken.Contains(S(r, "id")) && Home(r) < Reach && r["sched"] is JsonObject).OrderBy(Home).ToList();
            int gather = 0, shop = 0;
            var ids = new JsonArray();
            foreach (var r in near)
            {
                double hx = N(r["home"]?["sx"]), hz = N(r["home"]?["sz"]);
                bool any = false;
                foreach (string part in new[] { "day", "sunday" })
                    foreach (var seg in NativeTownPopulation.A(r["sched"]?[part]).OfType<JsonArray>())
                    {
                        if (seg.Count < 4) continue;
                        string act = seg[2]?.GetValue<string>() ?? "", where = seg[3]?.GetValue<string>() ?? "";
                        var old = places[where];
                        double oldD = old == null ? double.PositiveInfinity : D(N(old["x"]), N(old["z"]), hx, hz);
                        if (oldD <= Home(r)) continue;
                        if (Gathering.Contains(act) && where.StartsWith("play:", StringComparison.Ordinal) && gather < Gatherers) { seg[3] = q.Id; any = true; }
                        else if (act == "market" && part == "day" && where.StartsWith("market:", StringComparison.Ordinal) && shop < Shoppers) { seg[3] = "market:" + q.Id; any = true; }
                    }
                if (!any) continue;
                if (NativeTownPopulation.A(r["sched"]?["day"]).Concat(NativeTownPopulation.A(r["sched"]?["sunday"])).OfType<JsonArray>().Any(s => s.Count > 3 && s[3]?.GetValue<string>() == q.Id)) gather++;
                if (NativeTownPopulation.A(r["sched"]?["day"]).OfType<JsonArray>().Any(s => s.Count > 3 && s[3]?.GetValue<string>() == "market:" + q.Id)) shop++;
                taken.Add(S(r, "id"));
                c.Execute("UPDATE resident SET data_json=$p0 WHERE id=$p1", r.ToJsonString(), S(r, "id"));
                ids.Add(S(r, "id"));
                changed++;
                if (gather >= Gatherers && shop >= Shoppers) break;
            }
            moved[q.Id] = ids;
        }
        if (changed > 0) population.Town.Clear();
        c.SetWorld(Key, new JsonObject { ["squares"] = new JsonArray(Squares.Select(q => (JsonNode)q.Id).ToArray()), ["moved"] = moved });
        Godot.GD.Print($"church squares: {Squares.Length} squares in the town's places, {changed} neighbours meet or market there");
        return changed;
    }
}
