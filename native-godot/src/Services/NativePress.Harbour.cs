using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public sealed partial class NativePress
{
    public Action<int, JsonObject?>? RollNews;
    private static readonly string[] Masters = { "Maes", "Verbeke", "Jansen", "Smit", "Olsen", "De Vries", "Petersen", "Brown", "Hansen", "Claessens", "Roberts", "Lindqvist" };
    private static readonly (string Port, string Cargo)[] Ports = {
        ("London", "general goods"), ("Hull", "coal"), ("Riga", "timber"), ("Odessa", "grain"), ("Rio de Janeiro", "coffee"),
        ("Buenos Aires", "hides"), ("Bordeaux", "wine"), ("Liverpool", "cotton"), ("New York", "petroleum"), ("Rotterdam", "sugar"),
        ("Hamburg", "general goods"), ("Swansea", "coal"), ("Santos", "coffee"), ("Philadelphia", "petroleum"), ("Archangel", "tar and timber")
    };
    private static readonly string[] OutPorts = { "New York", "Philadelphia", "London", "Hull", "Leith", "Bordeaux", "Lisbon", "Riga", "Buenos Aires" };
    private static readonly string[] Berths = { "the Rijnkaai", "the Petit Bassin", "the Werf" };
    private static readonly Dictionary<string, string> CargoFor = new() { ["crates"] = "coffee", ["sacks"] = "grain", ["barrels"] = "wine", ["hides"] = "hides", ["rope"] = "hemp", ["parcel"] = "general goods" };
    private static Func<double> Seeded(uint seed) => () => {
        seed = unchecked(seed + 0x6d2b79f5); uint t = unchecked((seed ^ (seed >> 15)) * (seed | 1));
        t ^= unchecked(t + (t ^ (t >> 7)) * (t | 61)); return (t ^ (t >> 14)) / 4294967296.0;
    };
    // The original sorts twelve ships with a seeded comparator. Keep its short-run insertion
    // ordering/consumption so the same saved seed still produces the same harbour master's list.
    private static void SortShort<T>(List<T> list, Func<double> random)
    {
        if (list.Count < 2) return;
        int end = 2; bool descending = random() < .5;
        while (end < list.Count) { bool less = random() < .5; if (descending ? !less : less) break; end++; }
        if (descending) list.Reverse(0, end);
        for (int i = end; i < list.Count; i++)
        {
            T value = list[i]; int low = 0, high = i;
            while (low < high) { int middle = low + ((high - low) >> 1); if (random() < .5) high = middle; else low = middle + 1; }
            for (int j = i; j > low; j--) list[j] = list[j - 1]; list[low] = value;
        }
    }
    public JsonArray PricesNow()
    {
        var best = new Dictionary<string, int>();
        foreach (var row in C.Rows("SELECT data_json FROM resident ORDER BY id"))
        {
            var resident = JsonNode.Parse(S(row, "data_json"))!;
            if (resident["work"]?["stall"] == null && resident["work"]?["shop"] == null && S(resident, "trade") != "publican") continue;
            foreach (var ware in host.Trade.Wares(S(resident, "id")))
            {
                string kind = S(ware, "kind"); if (S(host.Trade.Item(kind), "use") is not ("eat" or "drink")) continue;
                best[kind] = Math.Min(best.GetValueOrDefault(kind, int.MaxValue), (int)N(ware, "price_c"));
            }
        }
        return new JsonArray(new[] { "herring", "eel", "bread", "apple", "beer", "jenever" }.Where(best.ContainsKey).Select(k => (JsonNode)new JsonObject {
            ["kind"] = k, ["name"] = Regex.Replace(ItemName(k), "^(a|an) (pot of |loaf of |nip of )?", ""), ["price_c"] = best[k]
        }).ToArray());
    }
    public JsonArray WriteHarbour(int day)
    {
        if (Value(C.World("press_harbour")) == day) return new JsonArray();
        C.SetWorld("press_harbour", day);
        var random = Seeded(unchecked((uint)(N(C.World("town"), "seed", 1873) * 31 + day * 977)));
        T Pick<T>(IReadOnlyList<T> list) => list[(int)Math.Floor(random() * list.Count)];
        var lately = C.Rows("SELECT data_json FROM world_event WHERE day=$p0 AND verb IN('ship_in','ship_out')", day - 1).Select(r => S(JsonNode.Parse(S(r, "data_json")), "name")).ToHashSet();
        var names = A(Definitions["ships"]).Where(s => !lately.Contains(s![0]!.GetValue<string>())).ToList(); SortShort(names, random);
        var jobs = host.Jobs.List(1).Where(j => S(j, "status") == "offered" && S(j?["task"], "kind") == "carry").ToArray();
        var quay = jobs.FirstOrDefault(j => S(j, "employer_npc") is "sooi" or "peeters" or "tuur"); var bassin = jobs.FirstOrDefault(j => S(j, "employer_npc") == "katoen");
        int incoming = 2 + (int)Math.Floor(random() * 2), outgoing = 1 + (int)Math.Floor(random() * 2); var ships = new JsonArray();
        for (int i = 0; i < incoming + outgoing; i++)
        {
            var name = names[i % names.Count]!; var (port, cargo) = Pick(Ports); string berth = Pick(Berths), dir = i < incoming ? "in" : "out";
            var job = i == 0 ? quay : i == 1 ? bassin : null;
            if (job != null) { cargo = CargoFor.GetValueOrDefault(S(job["task"], "goods"), cargo); berth = i == 0 ? "the Rijnkaai" : "the Petit Bassin"; }
            if (dir == "out") port = Pick(OutPorts);
            var ship = new JsonObject { ["name"] = name[0]!.DeepClone(), ["type"] = name[1]!.DeepClone(), ["master"] = "Captain " + Pick(Masters), ["port"] = port, ["cargo"] = cargo, ["berth"] = berth, ["dir"] = dir };
            ships.Add(ship);
            string text = dir == "in" ? $"The {S(ship, "type")} {S(ship, "name")} ({S(ship, "master")}) came in from {port} with {cargo}; she lies at {berth}." : $"The {S(ship, "type")} {S(ship, "name")} ({S(ship, "master")}) sailed from {berth} for {port}.";
            host.Interiors.WriteEvent("log", dir == "in" ? "ship_in" : "ship_out", text, 3, place: berth, extra: ship);
        }
        var firstIn = ships.FirstOrDefault(s => S(s, "dir") == "in");
        RollNews?.Invoke(day, firstIn == null ? null : new JsonObject { ["name"] = firstIn["name"]!.DeepClone(), ["type"] = firstIn["type"]!.DeepClone() });
        string weather = S(host.Clock.View(), "weather", "fog");
        host.Interiors.WriteEvent("log", "weather_day", $"The day came up with {S(Definitions["weather"], weather)}.", 2);
        host.Interiors.WriteEvent("log", "prices", "Prices at the stalls and counters this morning: " + string.Join(", ", PricesNow().Select(p => $"{S(p, "name")} {N(p, "price_c")} c")) + ".", 2);
        return ships;
    }
}
