using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Authoritative prison custody, restored resident schedules, visiting/exercise hours and warder roster.</summary>
public sealed class NativePrison : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeTown town;
    private readonly HashSet<int> keptHouses;
    private NativeServiceContext C => host.Context;
    private static readonly HashSet<string> StandingTrades = new() { "docker", "porter", "carter", "boatman", "sailor" };
    public NativePrison(NativeServiceHost host, NativeTown town, IEnumerable<int>? inWorldHouses = null)
    {
        this.host = host; this.town = town;
        keptHouses = inWorldHouses?.ToHashSet() ?? JsonNode.Parse(File.ReadAllText(Scheldemist.Paths.Shared("inworld_houses.json")))!["houses"]!.AsArray().Select(h => (int)NativeTown.N(h?["house"])).ToHashSet();
    }
    private JsonObject State() => C.World("prison")?.AsObject() ?? new JsonObject { ["v"] = 1, ["standing"] = false, ["inmates"] = new JsonArray(), ["out"] = new JsonArray() };
    public static bool Visiting(int day, double hour) => day % 7 == 0 ? hour >= 14 && hour < 16 : hour >= 9 && hour < 12 || hour >= 14 && hour < 17;
    public static bool Exercise(int day, double hour) => day % 7 == 0 ? hour >= 10.5 && hour < 11.5 : hour >= 10 && hour < 11.5 || hour >= 15 && hour < 16.5;
    public static bool DayShift(double hour) => hour >= 6 && hour < 18;
    private static string S(JsonNode? value, string key, string fallback = "") => NativeTown.S(value, key, fallback);
    private static double N(JsonNode? value) => NativeTown.N(value);
    public JsonObject? Held(string id) => State()["inmates"]!.AsArray().FirstOrDefault(m => S(m, "id") == id)?.DeepClone().AsObject();
    private static double RandomFrom(uint seed)
    {
        uint a = unchecked(seed + 0x6d2b79f5u), t = unchecked((a ^ (a >> 15)) * (a | 1));
        t ^= unchecked(t + (t ^ (t >> 7)) * (t | 61));
        return (t ^ (t >> 14)) / 4294967296.0;
    }
    public bool Jail(string id, int days, string crime)
    {
        var person = town.Resident(id); var state = State();
        if (person == null || state["inmates"]!.AsArray().Any(m => S(m, "id") == id)) return false;
        var clock = host.Clock.View(); int day = NativeCoreClock.Number(clock, "day");
        double sx = Math.Round(-354.996 - 2.2 * Math.Sin(1.541087), 2), sz = Math.Round(199.5 - 2.2 * Math.Cos(1.541087), 2);
        var before = new JsonObject { ["home"] = person["home"]!.DeepClone(), ["sched"] = person["sched"]!.DeepClone() };
        var updated = person.DeepClone().AsObject();
        updated["home"] = new JsonObject { ["house"] = -1, ["x"] = sx, ["z"] = sz, ["sx"] = sx, ["sz"] = sz };
        updated["sched"] = new JsonObject { ["day"] = new JsonArray(new JsonArray(0, 24, "home")), ["sunday"] = new JsonArray(new JsonArray(0, 24, "home")) };
        C.Atomic(() => {
            C.Execute("UPDATE resident SET data_json=$p0 WHERE id=$p1", updated.ToJsonString(), id);
            state["inmates"]!.AsArray().Add(new JsonObject { ["id"] = id, ["crime"] = crime, ["since"] = day, ["until"] = day + Math.Max(1, days), ["before"] = before });
            state["out"] = new JsonArray(state["out"]!.AsArray().Where(o => S(o, "id") != id).Select(o => o!.DeepClone()).ToArray());
            C.SetWorld("prison", state); C.Log(1, "jailed", id, $"{S(person, "name")} was taken to the prison in the Begijnenstraat for {crime}.", "police");
        });
        town.Clear(); return true;
    }
    public IReadOnlyList<string> ReleaseDue()
    {
        var state = State(); var clock = host.Clock.View(); int day = NativeCoreClock.Number(clock, "day"), hour = NativeCoreClock.Number(clock, "hour");
        var due = state["inmates"]!.AsArray().Where(m => day > N(m?["until"]) || day == N(m?["until"]) && hour >= 7).Select(m => m!.DeepClone().AsObject()).ToArray();
        if (due.Length == 0) return Array.Empty<string>();
        C.Atomic(() => {
            foreach (var inmate in due)
            {
                string id = S(inmate, "id"); var person = town.Resident(id);
                if (person != null) {
                    var updated = person.DeepClone().AsObject(); updated["home"] = inmate["before"]!["home"]!.DeepClone(); updated["sched"] = inmate["before"]!["sched"]!.DeepClone();
                    C.Execute("UPDATE resident SET data_json=$p0 WHERE id=$p1", updated.ToJsonString(), id);
                    C.Log(1, "released", id, $"{S(person, "name")} came out of the prison in the Begijnenstraat.", "prison");
                }
                state["out"]!.AsArray().Add(new JsonObject { ["id"] = id, ["day"] = day });
            }
            var ids = due.Select(m => S(m, "id")).ToHashSet();
            state["inmates"] = new JsonArray(state["inmates"]!.AsArray().Where(m => !ids.Contains(S(m, "id"))).Select(m => m!.DeepClone()).ToArray());
            state["out"] = new JsonArray(state["out"]!.AsArray().TakeLast(12).Select(m => m!.DeepClone()).ToArray()); C.SetWorld("prison", state);
        });
        town.Clear(); return due.Select(m => S(m, "id")).ToArray();
    }
    public void Ensure()
    {
        ReleaseDue(); var state = State(); if (state["standing"]?.GetValue<bool>() == true) return;
        var pool = town.Residents.Values.Where(r => Regex.IsMatch(S(r, "id"), @"^r\d+$") && S(r, "sex") == "m" && N(r["age"]) >= 20 && N(r["age"]) <= 50 && StandingTrades.Contains(S(r, "trade")) && S(r, "family_role") is "single" or "lodger" && N(r["home"]?["house"]) >= 0 && !keptHouses.Contains((int)N(r["home"]?["house"])) && r["work"]?["door"] == null).OrderBy(r => S(r, "id"), StringComparer.Ordinal).ToArray();
        state["standing"] = true; C.SetWorld("prison", state);
        if (pool.Length > 0) Jail(S(pool[(int)(RandomFrom(unchecked((uint)N(C.World("town")?["seed"]) ^ 0x1855u)) * pool.Length)], "id"), 16, "a knife drawn in a tavern brawl on the Rijnkaai");
    }
    public JsonObject View()
    {
        Ensure(); var clock = host.Clock.View(); int day = NativeCoreClock.Number(clock, "day"); double hour = NativeCoreClock.Number(clock, "hour") + NativeCoreClock.Number(clock, "minute") / 60.0;
        bool daytime = DayShift(hour); var state = State();
        var warders = new JsonArray();
        foreach (var warder in new[] { ("chief", "Chief warder Verstraeten", true, true), ("gate", "Warder Maes", true, false), ("gate_night", "Warder De Wolf", false, true), ("yard", "Warder Peeters", true, false), ("visits", "Warder Janssens", true, false), ("guard", "Warder Claes", true, true) })
            if (daytime ? warder.Item3 : warder.Item4) warders.Add(new JsonObject { ["role"] = warder.Item1, ["name"] = warder.Item2 });
        var inmates = new JsonArray();
        foreach (var inmate in state["inmates"]!.AsArray()) { var row = inmate!.DeepClone().AsObject(); row.Remove("before"); row["name"] = town.Resident(S(inmate, "id"))?["name"]?.DeepClone() ?? JsonValue.Create(S(inmate, "id")); inmates.Add(row); }
        return new JsonObject { ["visiting"] = Visiting(day, hour), ["exercise"] = Exercise(day, hour), ["dayShift"] = daytime, ["warders"] = warders, ["inmates"] = inmates, ["ring"] = Exercise(day, hour) ? 7 + Math.Min(3, inmates.Count) : 0 };
    }
    public JsonObject Visit(int player, string? wanted = null)
    {
        var view = View();
        if (view["visiting"]!.GetValue<bool>() == false) return new JsonObject { ["ok"] = false, ["text"] = "The warder shakes his head: visiting hours are nine to twelve and two to five, Sundays two to four." };
        var inmates = view["inmates"]!.AsArray();
        if (inmates.Count == 0) return new JsonObject { ["ok"] = false, ["text"] = "The warder looks in his book: nobody here for you today." };
        var picked = inmates.FirstOrDefault(m => S(m, "id") == wanted) ?? inmates.OrderByDescending(m => C.Scalar<int>("SELECT times_met FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1", S(m, "id"), player)).First();
        return new JsonObject { ["ok"] = true, ["id"] = picked!["id"]!.DeepClone(), ["name"] = picked["name"]!.DeepClone(), ["text"] = $"The warder unlocks the far door. {S(picked, "name")} is brought to the grille." };
    }
    public string WarderLine(string role)
    {
        var view = View();
        if (role is "gate" or "gate_night") return view["dayShift"]!.GetValue<bool>() == false ? "The night warder raises his lantern. \"Nobody goes in at night. Come back in visiting hours.\"" : view["visiting"]!.GetValue<bool>() ? "\"Visitors to the right, the grille room. Hats off inside, and nothing passed through the bars.\"" : "\"Visiting hours are nine to twelve and two to five, Sundays two to four. Come back then.\"";
        return role switch {
            "yard" => view["exercise"]!.GetValue<bool>() ? "\"Keep walking, you lot. No talking in the ring.\" He does not look at you." : "\"The yard is empty till the next hour of exercise.\"",
            "visits" => "\"One visitor at a time, and a quarter of an hour. I hear every word.\"",
            "chief" => "\"The cellular system, sir: every man alone with his conscience. It works, most of the time.\"",
            _ => "The warder looks up from his book and says nothing."
        };
    }
    public string ThiefCaught(int player, string id)
    {
        var person = town.Resident(id);
        if (person == null || Held(id) != null || !Jail(id, 3, "picking pockets at night")) return "";
        host.Trade.Remember(player, id, "The police came for me after Jef caught me. Three days in the Begijnenstraat.", 6);
        return $" Later that night the police pick {S(person, "first")} up: {(S(person, "sex") == "f" ? "she" : "he")} is held three days in the prison in the Begijnenstraat.";
    }
    public void AttachTalk(NativeTownTalk talk)
    {
        talk.OpeningOverrides.Add((_, person) => {
            string id = S(person, "id"); var held = Held(id); if (held == null) return null;
            int day = NativeCoreClock.Number(host.Clock.View(), "day");
            string[] lines = { "You came. Nobody else does, in here.", "Keep your voice down. The warder writes down every word.", "Did you bring word from outside? They tell us nothing.", $"{Math.Max(0, (int)N(held["until"]) - day)} more days of oakum and silence. Then I'm out." };
            return lines[(day + id.Length) % lines.Length];
        });
    }
    public void Register(NativeServiceHost service)
    {
        Ensure(); // Custody schedules must exist before the client first requests the town.
        service.NewGame += Ensure; service.Loaded += Ensure;
        service.Register("GET", "/api/prison", _ => View());
        service.Register("POST", "/api/prison/visit", r => Visit(r.PlayerId, r.Text("id", "")));
        service.Register("POST", "/api/prison/ask", r => new JsonObject { ["text"] = WarderLine(r.Text("role", "gate")) });
        service.TickHooks.Add((_, _) => ReleaseDue());
    }
}
