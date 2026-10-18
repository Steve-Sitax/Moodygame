using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

/// <summary>The market-day sellers of the pitched markets (native-extras.json fields with `pitches`): the Vismarkt's (#150)
/// and the Grote Markt's (#192). One seller for each pitch, each with her own home near the market, her family's handcart
/// (parked by her door, and at work at her pitch's cart place) and the market's hours, Monday to Saturday. She pushes the
/// cart from home, sets her stall up, sells, packs up and goes home. Ids are the field's pitches.prefix and the pitch
/// number (vm_seller_N, gm_seller_N); the pitch number is work.pitch, the market work.place. Added after the original
/// nineteen-stage fresh town (which stays as the original made it), on a new game and on a load or a start that has no
/// sellers yet.</summary>
public sealed class NativeTownMarketPopulation : INativeServiceModule
{
    public const string Prefix = "vm_seller_";
    private readonly NativeTownPopulation population;
    private readonly NativeTownTransportPopulation transport;
    public NativeTownMarketPopulation(NativeTownPopulation population, NativeTownTransportPopulation transport) => (this.population, this.transport) = (population, transport);

    public void Register(NativeServiceHost host)
    {
        host.NewGame += () => Ensure();
        host.Loaded += () => Ensure();
        Ensure();
    }

    /// <summary>The sellers (when a market has none yet) and their carts. Returns the sellers added.</summary>
    public int Ensure()
    {
        var c = population.Host.Context;
        if (c.World("town") == null) return 0;
        uint seed = (uint)N(c.World("town")?["seed"]);
        int all = 0;
        foreach (var (place, rules, sellers) in Markets(c.Options.DataDirectory))
        {
            var clock = System.Diagnostics.Stopwatch.StartNew();
            string prefix = S(rules, "prefix") is { Length: > 0 } own ? own : Prefix;
            int made = Install(population, prefix, () => Generate(seed, population.Snapshot(), rules, place, prefix, sellers), place);
            int carts = transport.AddMarketCarts(rules, place);
            if (made > 0 || carts > 0) Godot.GD.Print($"market sellers: {made} sellers and {carts} handcarts for the pitches of {place} in {clock.ElapsedMilliseconds} ms");
            all += made;
        }
        return all;
    }

    /// <summary>The vismarkt field's pitch rules (hours and the pitches), or null. (Every market keeps the same hours.)</summary>
    public static JsonObject? Pitches(string dataDirectory) => Markets(dataDirectory).Where(m => m.Place == "vismarkt").Select(m => m.Rules).FirstOrDefault();

    /// <summary>Every market with pitches: its place, its pitch rules and the seller kinds by goods.</summary>
    public static List<(string Place, JsonObject Rules, JsonObject Sellers)> Markets(string dataDirectory)
    {
        string path = Path.Combine(dataDirectory, "native-extras.json");
        var list = new List<(string, JsonObject, JsonObject)>();
        if (!File.Exists(path)) return list;
        var extras = JsonNode.Parse(File.ReadAllText(path))!;
        foreach (var f in A(extras["fields"])) if (f?["pitches"] is JsonObject rules) list.Add((S(f, "place"), rules, extras["sellers"] as JsonObject ?? new JsonObject()));
        return list;
    }

    // the women who keep a market-day stall (a seller is a woman of the town, as on the Vismarkt, #150)
    private static readonly string[] Women = { "fishwife_a", "fishwife_b", "wife_a", "wife_b", "old_woman", "shopwife" };

    public JsonObject Generate(uint seed, JsonObject town, JsonObject rules, string place = "vismarkt", string prefix = Prefix, JsonObject? sellers = null)
    {
        var people = new JsonArray();
        // (the Vismarkt's dice as before #192, so its sellers stay who they were)
        var k = new NativeTownRoleSeed(population, seed ^ (place == "vismarkt" ? 0x5f1a7e15u : 0x6b2c9d31u), "market", town);
        int n = 0;
        foreach (var pitch in A(rules["list"]))
        {
            int number = n++;
            string goods = S(pitch, "goods"), trade = goods == "fish" ? "fishwife" : "market_woman";
            var seller = pitch!["seller"]!;
            double sx = N(seller[0]), sz = N(seller[1]);
            var home = Home(k.DoorNear(sx, sz, 160));
            int age = k.Int(24, 63);
            string kind;
            if (place == "vismarkt") kind = goods == "fish" ? (k.Rng() < .5 ? "fishwife_a" : "fishwife_b") : age >= 58 ? "old_woman" : k.Rng() < .5 ? "wife_a" : "wife_b";
            else
            {
                // the market's own kinds of seller for these goods (native-extras.json sellers), the women among them
                var kinds = A(sellers?[goods]).Select(v => v!.GetValue<string>()).Where(v => Women.Contains(v)).ToArray();
                kind = age >= 58 ? "old_woman" : kinds.Length > 0 ? kinds[(int)Math.Floor(k.Rng() * kinds.Length) % kinds.Length] : k.Rng() < .5 ? "wife_a" : "wife_b";
            }
            var name = k.Name(() => number.ToString());
            // her stall's hours: at her pitch for the market's set-up, and home again after she has packed up. A day's
            // part is the hour she is at it: she sets off early by her walk (about 2 m a game minute, the way half as
            // long again as the straight line), so the walk home is added to the packed hour.
            double walk = Math.Sqrt(Math.Pow(N(home["sx"]) - sx, 2) + Math.Pow(N(home["sz"]) - sz, 2)) * 1.5 / 2.0 / 60;
            var day = new JsonArray(Seg(Math.Round((N(rules["setup"]) + k.Rng() * .25) * 12) / 12, Math.Round((N(rules["packed"]) + walk + .05 + k.Rng() * .15) * 12) / 12, "work"));
            var sunday = new JsonArray(Seg(k.J(8.75), k.J(11), "church", "church"));
            var work = new JsonObject
            {
                ["place"] = place, ["kind"] = "stall", ["pitch"] = number, ["goods"] = goods,
                ["at"] = new JsonArray(sx, sz, N(pitch["yaw"])), ["cart"] = pitch["cart"]?.DeepClone(),
            };
            people.Add(k.Person(prefix + number, trade, kind, "f", age, home, ++k.Household, "head", name, work, day, sunday, true));
        }
        return new JsonObject { ["residents"] = people };
    }
}
