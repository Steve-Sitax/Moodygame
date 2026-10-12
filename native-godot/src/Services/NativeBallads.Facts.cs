using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public sealed partial class NativeBallads
{
    public static string? KindOf(JsonObject e)
    {
        string verb = S(e, "verb"), template = S(e, "template");
        if (new[] { "ballad_sung", "sermon", "heard_sermon", "bought_ballad" }.Contains(verb) || template is "hiring" or "ballad") return null;
        bool jef = S(e, "actor") == "player" || Regex.IsMatch(S(e, "text"), @"^Jef\b");
        string? kind = verb switch {
            "fire" or "fire_out" => "fire", "street_robbery" or "robbery_caught" or "robbery_escaped" or "robbery_solved" => "robbery",
            "robbed" or "caught_thief" => jef ? "jef" : "robbery", "scuffle" or "scuffle_parted" => "scuffle",
            "emigrants_boarded" => "liner", "emigrants_arrived" => "emigrants", "ship_in" or "ship_out" => "ship", "tide_day" => "tide",
            "rumour" => Regex.IsMatch(S(e, "text"), @"^Jef\b") ? "jef" : null, "town_rumour" => "rumour",
            "started" => template switch { "wedding" => "wedding", "funeral" => "funeral", "house_fire" => "fire", "emigrant_ship" => "liner", "quarrel" => "scuffle", _ => "event" }, _ => null
        };
        if (kind != null || verb == "rumour") return kind;
        if (S(e, "kind") == "police" && jef) return "jef";
        return verb is "bought" or "drank" && S(e, "target") is "beer" or "jenever" ? "drink" : null;
    }
    public static string TideLine(int day)
    {
        const double period = 12 + 25 / 60.0; double start = (day - 1) * 24;
        var highs = new List<double>();
        for (int k = (int)Math.Floor((start - 9.6) / period); k <= Math.Ceiling((start + 24 - 9.6) / period); k++) {
            double t = 9.6 + k * period; if (t >= start && t < start + 24) highs.Add(t - start);
        }
        string Words(double h) {
            int hour = (int)Math.Floor(h + .5) % 24;
            var names = new[] { "midnight", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "noon" };
            return hour is 0 or 12 ? names[hour] : hour < 12 ? names[hour] + " in the morning" : names[hour - 12] + (hour >= 18 ? " at night" : " in the afternoon");
        }
        double c = Math.Cos(2 * Math.PI * (start + 12 - 30) / (14.765 * 24));
        string kind = c > .5 ? "a spring tide, the river up near the edge stones of the quays" : c < -.5 ? "a neap tide, the river lazy and low" : "an ordinary tide";
        return "High water at the quays came at " + string.Join(" and at ", highs.Select(Words)) + "; " + kind + ".";
    }
    private JsonArray FactRows(int from) => C.Rows("SELECT e.*,t.template AS template FROM world_event e LEFT JOIN town_event t ON e.ref_type='town_event' AND t.id=e.ref_id WHERE e.day >= $p0 ORDER BY e.id DESC LIMIT 400", from);
    private static JsonObject Fact(JsonNode row, string kind) => new() {
        ["id"] = N(row, "id"), ["day"] = N(row, "day"), ["kind"] = kind, ["text"] = S(row, "text").Trim(),
        ["jef"] = kind == "jef" || Regex.IsMatch(S(row, "text"), @"\bJef\b"), ["weight"] = N(row, "weight")
    };
    public JsonArray Facts(int maximum = 3)
    {
        if (C.Scalar<int>("SELECT COUNT(*) FROM world_event WHERE verb='tide_day' AND day=$p0", Day) == 0)
            host.Interiors.WriteEvent("log", "tide_day", TideLine(Day), 2);
        string[] order = { "fire", "robbery", "jef", "wedding", "funeral", "scuffle", "liner", "emigrants", "police", "event", "ship", "tide" };
        var bonus = new Dictionary<string, int> { ["fire"] = 5, ["robbery"] = 4, ["jef"] = 4, ["wedding"] = 3, ["funeral"] = 2, ["scuffle"] = 2, ["liner"] = 2, ["emigrants"] = 1 };
        var all = new List<JsonObject>();
        foreach (var row in FactRows(Day - 2)) {
            string? kind = KindOf(row!.AsObject()); if (kind == null || kind is "drink" or "rumour" || kind != "tide" && N(row, "weight") < 3) continue;
            all.Add(Fact(row, kind));
        }
        double Score(JsonObject f) => N(f, "weight") + bonus.GetValueOrDefault(S(f, "kind")) + (N(f, "day") == Day ? 1 : 0) - (S(f, "kind") == "tide" ? 20 : 0);
        var chosen = new List<JsonObject>(); var kinds = new HashSet<string>();
        foreach (var f in all.OrderByDescending(Score).ThenByDescending(f => N(f, "id"))) {
            if (chosen.Count >= maximum) break;
            if (kinds.Contains(S(f, "kind")) || S(f, "kind") == "tide" && chosen.Count >= 2) continue;
            kinds.Add(S(f, "kind")); chosen.Add(f);
        }
        return new JsonArray(chosen.OrderBy(f => Array.IndexOf(order, S(f, "kind"))).Select(f => (JsonNode)f).ToArray());
    }
    public JsonObject? Hint()
    {
        int from = Day - (Day - 1) % 7;
        var r = C.One("SELECT gist,tone,weight FROM npc_memory WHERE gist LIKE 'Jef%' AND day >= $p0 AND weight >= 3 AND tone <> 0 ORDER BY weight*ABS(tone) DESC,id DESC LIMIT 1", from);
        if (r == null) return null;
        string said = Regex.Replace(S(r, "gist"), @"^Jef's\b", "the young man's");
        said = Regex.Replace(said, @"^Jef\b", "a young man on the quays");
        said = Regex.Replace(Regex.Replace(Regex.Replace(said, @"\bJef's\b", "his"), @"\bJef\b", "he"), @"\.$", "");
        return new() { ["kind"] = N(r, "tone") < 0 ? "warn" : "praise", ["said"] = said };
    }
    public JsonArray SermonFacts(int maximum = 5)
    {
        int from = Day - (Day - 1) % 7, drinks = 0; var kinds = new Dictionary<string, JsonObject>();
        foreach (var row in FactRows(from)) {
            string? kind = KindOf(row!.AsObject());
            if (kind == null || kind is "tide" or "ship" or "jef" or "police") continue;
            if (kind == "drink") { drinks++; continue; }
            if (Regex.IsMatch(S(row, "text"), @"\bJef\b") || N(row, "weight") < 3 && kind != "rumour") continue;
            if (!kinds.TryGetValue(kind, out var old) || N(row, "weight") > N(old, "weight")) kinds[kind] = Fact(row, kind);
        }
        drinks += C.Scalar<int>("SELECT COUNT(*) FROM town_event WHERE day >= $p0 AND status IN ('running','done') AND leads_json LIKE '%\"drunkard\"%'", from);
        if (drinks > 0) kinds["drink"] = new() { ["id"] = 0, ["day"] = Day, ["kind"] = "drink", ["text"] = drinks >= 3 ? "The taverns did a roaring trade this week: jenever and beer went over the counters again and again, and men were seen unsteady in the street." : "Drink went over the tavern counters this week, as it does every week.", ["jef"] = false, ["weight"] = 3 };
        return new JsonArray(new[] { "robbery", "scuffle", "drink", "fire", "liner", "emigrants", "funeral", "wedding", "rumour", "event" }.Where(kinds.ContainsKey).Take(maximum).Select(k => (JsonNode)kinds[k]).ToArray());
    }
}
