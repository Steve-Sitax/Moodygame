using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using static Scheldemist.Native.Services.NativeTownRoleSeed;

namespace Scheldemist.Native.Services;

/// <summary>The Vismarkt's market-day sellers (#150): one woman for each pitch in native-extras.json (the
/// vismarkt field's pitches), each with her own home near the market, her family's handcart (parked by her door,
/// and at work at her pitch's cart place) and her market hours, Monday to Saturday. She pushes the cart from home,
/// sets her stall up, sells, packs up and goes home. Ids vm_seller_N; the pitch number is work.pitch.
/// Added after the original nineteen-stage fresh town (which stays as the original made it), on a new game and
/// on a load or a start that has no sellers yet.</summary>
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

    /// <summary>The sellers (when the town has none yet) and their carts. Returns the sellers added.</summary>
    public int Ensure()
    {
        var c = population.Host.Context;
        var rules = Pitches(c.Options.DataDirectory);
        if (rules == null || c.World("town") == null) return 0;
        uint seed = (uint)N(c.World("town")?["seed"]);
        var clock = System.Diagnostics.Stopwatch.StartNew();
        int made = Install(population, Prefix, () => Generate(seed, population.Snapshot(), rules), "vismarkt");
        int carts = transport.AddMarketCarts(rules);
        if (made > 0 || carts > 0) Godot.GD.Print($"market sellers: {made} sellers and {carts} handcarts for the Vismarkt's pitches in {clock.ElapsedMilliseconds} ms");
        return made;
    }

    /// <summary>The vismarkt field's pitch rules (hours and the pitches), or null.</summary>
    public static JsonObject? Pitches(string dataDirectory)
    {
        string path = Path.Combine(dataDirectory, "native-extras.json");
        if (!File.Exists(path)) return null;
        var extras = JsonNode.Parse(File.ReadAllText(path))!;
        return A(extras["fields"]).FirstOrDefault(f => S(f, "place") == "vismarkt")?["pitches"] as JsonObject;
    }

    public JsonObject Generate(uint seed, JsonObject town, JsonObject rules)
    {
        var people = new JsonArray();
        var k = new NativeTownRoleSeed(population, seed ^ 0x5f1a7e15, "market", town);
        int n = 0;
        foreach (var pitch in A(rules["list"]))
        {
            int number = n++;
            string goods = S(pitch, "goods"), trade = goods == "fish" ? "fishwife" : "market_woman";
            var seller = pitch!["seller"]!;
            double sx = N(seller[0]), sz = N(seller[1]);
            var home = Home(k.DoorNear(sx, sz, 160));
            int age = k.Int(24, 63);
            string kind = goods == "fish" ? (k.Rng() < .5 ? "fishwife_a" : "fishwife_b") : age >= 58 ? "old_woman" : k.Rng() < .5 ? "wife_a" : "wife_b";
            var name = k.Name(() => number.ToString());
            // her stall's hours: at her pitch for the market's set-up, and home again after she has packed up. A day's
            // part is the hour she is at it: she sets off early by her walk (about 2 m a game minute, the way half as
            // long again as the straight line), so the walk home is added to the packed hour.
            double walk = Math.Sqrt(Math.Pow(N(home["sx"]) - sx, 2) + Math.Pow(N(home["sz"]) - sz, 2)) * 1.5 / 2.0 / 60;
            var day = new JsonArray(Seg(Math.Round((N(rules["setup"]) + k.Rng() * .25) * 12) / 12, Math.Round((N(rules["packed"]) + walk + .05 + k.Rng() * .15) * 12) / 12, "work"));
            var sunday = new JsonArray(Seg(k.J(8.75), k.J(11), "church", "church"));
            var work = new JsonObject
            {
                ["place"] = "vismarkt", ["kind"] = "stall", ["pitch"] = number, ["goods"] = goods,
                ["at"] = new JsonArray(sx, sz, N(pitch["yaw"])), ["cart"] = pitch["cart"]?.DeepClone(),
            };
            people.Add(k.Person(Prefix + number, trade, kind, "f", age, home, ++k.Household, "head", name, work, day, sunday, true));
        }
        return new JsonObject { ["residents"] = people };
    }
}
