using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public sealed partial class NativePress
{
    private static JsonObject Fact(string kind, string text, int weight, string reference) => new() { ["kind"] = kind, ["text"] = text, ["weight"] = weight, ["ref"] = reference };
    private static string Initials(string name)
    {
        var parts = Regex.Split(name, @"\s+"); return $"one {parts[0][0]}. {(parts.Length > 1 ? parts[1][0].ToString() : "")}.".Replace(" .", "");
    }
    private JsonObject? FactOf(JsonObject e)
    {
        string verb = S(e, "verb"), reference = "we:" + N(e, "id"), text = S(e, "text");
        JsonObject F(string kind, string line, int weight) => Fact(kind, line, weight, reference);
        string? Named(string id) => Resident(id)?["name"]?.GetValue<string>();
        string? thief = Named(S(e, "target")) ?? Named(S(e, "actor"));
        string coins = Regex.Match(text, @"(\d+) centimes").Groups[1].Value;
        switch (verb)
        {
            case "started": return S(e, "kind") != "event" ? null : F("event", "Yesterday: " + Regex.Replace(text, @"\.$", "") + ".", Math.Max(5, (int)N(e, "weight")));
            case "cancelled": return S(e, "kind") == "event" ? F("event", text, 3) : null;
            case "robbed":
                string where = S(e, "place") switch { "rijnkaai" => "on the Rijnkaai", "vismarkt" => "by the Vismarkt", "grote-markt" => "on the Grote Markt", "werf" => "on the Werf", "steenplein" => "on the Steenplein", _ => "on the quays" };
                return F("theft", $"A day labourer had his pocket picked in the dark {where}{(coins != "" ? "; " + coins + " centimes gone" : "")}. Nobody saw the thief.", 7);
            case "caught_thief": return F("theft", $"A day labourer caught a pickpocket{(thief != null ? ", " + Initials(thief) + "," : "")} by the collar and took his money back.", 7);
            case "restitution": return F("police", $"A pickpocket{(thief != null ? ", " + Initials(thief) + "," : "")} gave back {(coins != "" ? "the " + coins + " centimes" : "the money")} he had taken from a day labourer.", 6);
            case "police_warning": return F("police", "The police gave Jef, a day labourer new to the town, a warning over a theft.", 6);
            case "police_fine": return F("police", "The police fined Jef, a day labourer new to the town, over a theft.", 7);
            case "arrested": return F("police", "The police took Jef, a day labourer new to the town, to the prison in the Begijnenstraat for theft.", 9);
            case "cell": return F("police", "Jef, a day labourer, spent the night in the prison in the Begijnenstraat; all he had went for the fine.", 8);
            case "caught_stealing": return F("theft", Regex.Replace(Regex.Replace(text, @"^Jef\b", "Jef, a day labourer new to the town,"), @"\.$", "") + ".", 7);
            case "police_search": return F("police", "An agent of the police is looking into a robbery on the quays.", 4);
            case "rumour": case "town_rumour": return N(e, "weight") < 4 ? null : F("talk", "Talk in the town: " + Regex.Replace(text, @"\.$", "") + ".", (int)N(e, "weight"));
            default: return null;
        }
    }
    public JsonArray PaperFacts(int day)
    {
        var facts = new List<JsonObject>(); var seen = new HashSet<string>();
        void Add(JsonObject? fact) { if (fact != null && seen.Add(S(fact, "text"))) facts.Add(fact); }
        foreach (var node in C.Rows("SELECT * FROM world_event WHERE day=$p0 AND verb IN('ship_in','ship_out','weather_day','prices','planned','news_abroad') ORDER BY id", day))
        {
            var e = node!.AsObject(); string reference = "we:" + N(e, "id"), verb = S(e, "verb");
            if (verb is "ship_in" or "ship_out") { var fact = Fact("ship", S(e, "text"), 3, reference); fact["ship"] = JsonNode.Parse(S(e, "data_json")); Add(fact); }
            else if (verb == "weather_day") Add(Fact("weather", S(e, "text"), 3, reference));
            else if (verb == "news_abroad") Add(Fact("abroad", S(e, "text"), 6, reference));
            else if (verb == "prices") Add(Fact("market", S(e, "text"), 3, reference));
            else if (verb == "planned" && S(e, "ref_type") == "town_event" && N(e, "ref_id") != 0)
            {
                var ev = C.One("SELECT title,place,start_m,notice,status,stages_json FROM town_event WHERE id=$p0", (int)N(e, "ref_id"));
                if (ev == null || S(ev, "status") == "cancelled") continue;
                int minute = (int)Math.Floor((N(ev, "start_m") % 1440) / 15 + .5) * 15;
                string label = S(JsonNode.Parse(S(ev, "stages_json"))!.AsArray().FirstOrDefault(), "label", S(ev, "place"));
                string text = $"Today, from about {minute / 60}:{minute % 60:00}: {S(ev, "title")} at {label}." + (S(ev, "notice") != "" ? " " + S(ev, "notice") : "");
                Add(Fact("coming", text, 6, reference));
            }
        }
        var past = new List<JsonObject>(); var pastSeen = new HashSet<string>();
        foreach (var e in C.Rows("SELECT * FROM world_event WHERE day=$p0 ORDER BY weight DESC,id", day - 1))
        {
            var fact = FactOf(e!.AsObject()); if (fact != null && pastSeen.Add(S(fact, "text"))) past.Add(fact);
        }
        foreach (var fact in past.Take(7)) Add(fact);
        foreach (var job in host.Jobs.List(1).Where(j => S(j, "status") == "offered" && j?["playable"]?.GetValue<bool>() == true).OrderByDescending(j => N(j, "pay_c")).Take(3))
            Add(Fact("work", $"Wanted today: {S(job, "title")} for {S(job, "employer_name")}, {N(job, "pay_c")} centimes.", 4, "job:" + N(job, "id")));
        for (int i = 0; i < facts.Count; i++) facts[i]["n"] = i + 1;
        return new JsonArray(facts.Cast<JsonNode>().ToArray());
    }
    public static JsonObject EngineArticle(JsonObject fact)
    {
        string headline = S(fact, "kind") switch { "ship" => "SHIPPING", "weather" => "THE WEATHER", "market" => "THE MARKETS", "coming" => "TODAY IN THE TOWN", "work" => "WORK WANTED", "police" => "POLICE", "theft" => "THEFT ON THE QUAYS", "talk" => "SAID ON THE QUAYS", "event" => "YESTERDAY", "abroad" => "NEWS FROM ABROAD", _ => "THE MORNING PAPER" };
        return new JsonObject { ["fact"] = fact["n"]!.DeepClone(), ["kind"] = S(fact, "kind"), ["headline"] = headline, ["text"] = S(fact, "text") };
    }
    public static string EngineShipLine(JsonObject fact)
    {
        var ship = fact["ship"]!;
        string lead = $"{S(ship, "name")}, {S(ship, "type")}, {S(ship, "master").Replace("Captain", "Capt.")}";
        return S(ship, "dir") == "in" ? lead + $", from {S(ship, "port")}, {S(ship, "cargo")}; at {Regex.Replace(S(ship, "berth"), "^the ", "")}." : lead + $", sailed for {S(ship, "port")}.";
    }
    private const string PaperName = "Het Handelsblad";
    private static string Cry(string headline) { string lower = headline.ToLowerInvariant(); return "Handelsblad, five centimes! " + (lower.Length == 0 ? "" : char.ToUpperInvariant(lower[0]) + lower[1..]) + "!"; }
    public static JsonObject EnginePaper(int day, JsonArray facts)
    {
        var articles = new JsonArray(facts.Where(f => S(f, "kind") != "ship").OrderByDescending(f => N(f, "weight")).ThenBy(f => N(f, "n")).Take(6).Select(f => (JsonNode)EngineArticle(f!.AsObject())).ToArray());
        string headline = S(articles.FirstOrDefault(), "headline", "THE MORNING PAPER");
        return new JsonObject { ["day"] = day, ["name"] = PaperName, ["date"] = DateLine(day), ["price_c"] = 5, ["cry"] = Cry(headline), ["headline"] = headline,
            ["articles"] = articles, ["shipping"] = new JsonArray(facts.Where(f => S(f, "kind") == "ship").Select(f => (JsonNode)new JsonObject { ["ship"] = f!["n"]!.DeepClone(), ["dir"] = S(f["ship"], "dir"), ["line"] = EngineShipLine(f.AsObject()) }).ToArray()), ["source"] = "engine" };
    }
    public static JsonObject CleanPaper(int day, JsonArray facts, JsonObject output)
    {
        var byNumber = facts.ToDictionary(f => N(f, "n")); var used = new HashSet<double>(); var articles = new List<JsonObject>();
        static HashSet<string> Digits(string text) => Regex.Matches(text, @"\d+").Select(m => m.Value).ToHashSet();
        foreach (var a in A(output["articles"]))
        {
            if (!byNumber.TryGetValue(N(a, "fact"), out var f) || S(f, "kind") == "ship" || !used.Add(N(f, "n"))) continue;
            string text = NativeCoreInteriors.PlainEnglish(S(a, "text")), headline = NativeCoreInteriors.PlainEnglish(S(a, "headline")).ToUpperInvariant(); headline = headline[..Math.Min(60, headline.Length)];
            bool numbers = Digits(text + " " + headline).IsSubsetOf(Digits(S(f, "text")));
            articles.Add(numbers && text.Length >= 15 ? new JsonObject { ["fact"] = f!["n"]!.DeepClone(), ["kind"] = S(f, "kind"), ["headline"] = headline, ["text"] = text } : EngineArticle(f!.AsObject()));
        }
        var abroad = facts.FirstOrDefault(f => S(f, "kind") == "abroad" && !used.Contains(N(f, "n")));
        if (abroad != null) { used.Add(N(abroad, "n")); articles.Insert(Math.Min(1, articles.Count), EngineArticle(abroad.AsObject())); }
        foreach (var f in facts.Where(f => S(f, "kind") != "ship" && !used.Contains(N(f, "n"))).OrderByDescending(f => N(f, "weight")))
        {
            if (articles.Count >= 4) break; used.Add(N(f, "n")); articles.Add(EngineArticle(f!.AsObject()));
        }
        var shipping = new JsonArray();
        foreach (var f in facts.Where(f => S(f, "kind") == "ship"))
        {
            var mine = A(output["shipping"]).FirstOrDefault(s => N(s, "ship") == N(f, "n")); string line = mine == null ? "" : NativeCoreInteriors.PlainEnglish(S(mine, "line"));
            bool ok = line != "" && line.Contains(S(f?["ship"], "name"), StringComparison.OrdinalIgnoreCase) && Digits(line).Count == 0;
            shipping.Add(new JsonObject { ["ship"] = f!["n"]!.DeepClone(), ["dir"] = S(f["ship"], "dir"), ["line"] = ok ? line : EngineShipLine(f.AsObject()) });
        }
        string title = S(articles.FirstOrDefault(), "headline", "THE MORNING PAPER"), cry = Regex.Replace(NativeCoreInteriors.PlainEnglish(S(output, "cry")), @"\s+", " ").Trim();
        if (cry == "" || Digits(cry).Count > 0 || cry.Length > 80) cry = Cry(title);
        return new JsonObject { ["day"] = day, ["name"] = PaperName, ["date"] = DateLine(day), ["price_c"] = 5, ["cry"] = cry, ["headline"] = title,
            ["articles"] = new JsonArray(articles.Take(6).Cast<JsonNode>().ToArray()), ["shipping"] = shipping, ["source"] = "claude" };
    }
}
