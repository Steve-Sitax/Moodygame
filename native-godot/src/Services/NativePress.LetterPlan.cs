using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativePress
{
    private static readonly string[] TelegraphCities = { "Brussels", "Ghent", "Liege", "Mechelen", "Rotterdam", "London", "Cologne", "Paris", "Bruges", "Ostend" };
    private static readonly string[] StrangerSigns = { "V.", "A friend of your late father", "M. de B.", "One who watches the river", "The lady in grey", "A well-wisher", "L. H., of Brussels" };
    public bool LetterDue(int who, Func<double>? random = null)
    {
        if (Day < 2) return false;
        var all = C.Rows("SELECT day FROM letter WHERE kind<>'reply' AND player_id=$p0", who);
        if (all.Any(l => N(l, "day") == Day) || all.Count >= 4) return false;
        if (all.Count == 0 && Day >= 3) return true;
        return (random ?? C.Roll)() < (all.Any(l => N(l, "day") == Day - 1) ? .35 : .6);
    }
    public JsonArray LetterCandidates(int who)
    {
        var wrote = C.Rows("SELECT sender FROM letter WHERE player_id=$p0", who).Select(l => S(l, "sender")).ToHashSet();
        bool Fits(string id) => Resident(id) is { } r && N(r, "age") >= 16 && S(r, "trade") != "thief" && !wrote.Contains(id);
        var result = new JsonArray(); var seen = new HashSet<string>();
        foreach (var m in C.Rows("SELECT npc_id,text,tone,weight FROM npc_memory WHERE source='seen' AND tone<>0 AND weight>=3 AND day>=$p0 AND COALESCE(about_player,1)=$p1 ORDER BY weight DESC,id DESC LIMIT 40", Day - 3, who))
        {
            string id = S(m, "npc_id"); if (!Fits(id) || !seen.Add(id)) continue;
            result.Add(new JsonObject { ["why"] = N(m, "tone") < 0 ? "wronged" : "helped", ["id"] = id, ["fact"] = TextFor(who, S(m, "text")), ["w"] = 3 });
        }
        foreach (var m in C.Rows("SELECT npc_id,times_met,view_of_player,last_seen_day FROM npc_relationship WHERE times_met>=1 AND player_id=$p0 ORDER BY last_seen_day DESC LIMIT 30", who))
        {
            string id = S(m, "npc_id"); if (!Fits(id) || !seen.Add(id)) continue;
            string fact = "Jef talked with them " + (N(m, "times_met") == 1 ? "once" : N(m, "times_met") + " times")
                + (N(m, "last_seen_day") != 0 ? ", last on day " + N(m, "last_seen_day") : "") + "."
                + (S(m, "view_of_player") != "" ? " How they see him: " + S(m, "view_of_player") : "");
            result.Add(new JsonObject { ["why"] = "met", ["id"] = id, ["fact"] = fact, ["w"] = 2 });
        }
        result.Add(new JsonObject { ["why"] = "stranger", ["id"] = "", ["fact"] = "A stranger. Jef has never met them.", ["w"] = 1.5 });
        return result;
    }
    public JsonObject PlanLetter(int who, Func<double>? random = null)
    {
        random ??= C.Roll; var candidates = LetterCandidates(who); var chosen = candidates.Last()!;
        double roll = random() * candidates.Sum(c => N(c, "w"));
        foreach (var c in candidates) { roll -= N(c, "w"); if (roll <= 0) { chosen = c!; break; } }
        string why = S(chosen, "why"), sender = why == "stranger" ? PostClerk : S(chosen, "id");
        var resident = why == "stranger" ? null : Resident(sender)!;
        string signature = why == "stranger" ? StrangerSigns[(int)Math.Floor(random() * StrangerSigns.Length)] : S(resident, "name");
        string senderName = why == "stranger" ? $"a stranger who signs \"{signature}\"" : S(resident, "name");
        int Between(int low, int high) => (int)Math.Floor((low + random() * (high - low)) / 5 + .5) * 5;
        JsonObject? LetterTo(int pay)
        {
            var home = resident == null ? PostCounter() ?? Point(0, 0) : HomePoint(resident);
            var pool = Addressees().Where(p => (resident == null || N(p, "household") != N(resident, "household")) && Distance(home, HomePoint(p)) is >= 25 and <= 260).ToArray();
            if (pool.Length == 0) return null;
            var to = pool[(int)Math.Floor(random() * pool.Length)];
            return new JsonObject { ["kind"] = "letter", ["pay_c"] = pay, ["fee_c"] = 0, ["to"] = S(to, "id"), ["to_name"] = S(to, "name") };
        }
        JsonObject Wire(int tip) => new() { ["kind"] = "telegram", ["pay_c"] = 50 + tip, ["fee_c"] = 50, ["city"] = TelegraphCities[(int)Math.Floor(random() * TelegraphCities.Length)] };
        var offer = new JsonObject { ["kind"] = "none", ["pay_c"] = 0, ["fee_c"] = 0 }; string kind;
        switch (why)
        {
            case "wronged": { var o = random() < .5 ? LetterTo(0) : null; kind = o != null ? "make_right" : "complaint"; if (o != null) offer = o; break; }
            case "helped": { var o = random() < .5 ? LetterTo(Between(20, 40)) : null; kind = o != null ? "errand" : "thanks"; if (o != null) offer = o; break; }
            case "met":
                if (random() < .6)
                {
                    if (PostCounter() != null && random() < .4) { kind = "telegram"; offer = Wire(Between(20, 30)); }
                    else { var o = LetterTo(Between(25, 40)); kind = o != null ? "errand" : "news"; if (o != null) offer = o; }
                }
                else kind = "news";
                break;
            default:
                if (PostCounter() != null && random() < .5) { kind = "strange_telegram"; offer = Wire(Between(30, 60)); }
                else { var o = LetterTo(Between(40, 70)); kind = o != null ? "strange_errand" : "strange_telegram"; offer = o ?? Wire(Between(30, 60)); }
                break;
        }
        var facts = new JsonArray(S(chosen, "fact"));
        if (kind == "news")
        {
            var e = C.One("SELECT text FROM world_event WHERE day>=$p0 AND weight>=4 AND kind IN('event','rumour','police','theft') ORDER BY id DESC LIMIT 1", Day - 2);
            if (e != null) facts.Add("News they could pass on (from the town): " + S(e, "text"));
        }
        return new JsonObject { ["sender"] = sender, ["sender_name"] = senderName, ["signature"] = signature, ["why"] = why, ["kind"] = kind, ["facts"] = facts, ["offer"] = offer };
    }
    public int? ErrandJob(JsonObject plan)
    {
        var offer = plan["offer"]!; if (S(offer, "kind") == "none") return null;
        var resident = S(plan, "why") == "stranger" ? null : Resident(S(plan, "sender")); var counter = PostCounter();
        var from = resident == null ? counter?.DeepClone().AsObject() : new JsonObject { ["x"] = N(resident["home"], "sx"), ["z"] = N(resident["home"], "sz"), ["label"] = "the door of " + S(resident, "name") };
        if (from == null) return null;
        string who = S(plan, "why") == "stranger" ? "\"" + S(plan, "signature") + "\"" : S(plan, "sender_name");
        JsonObject Task(JsonObject stop, int fee) => new() { ["kind"] = "letters", ["goods"] = "letters", ["from"] = from.DeepClone(), ["stops"] = new JsonArray(stop), ["fee_c"] = fee, ["twist"] = "none", ["limit_s"] = null };
        int pay = (int)N(offer, "pay_c");
        if (S(offer, "kind") == "letter")
        {
            var to = Resident(S(offer, "to")); if (to == null) return null;
            var task = Task(new JsonObject { ["id"] = S(to, "id"), ["name"] = S(to, "name"), ["x"] = N(to["home"], "sx"), ["z"] = N(to["home"], "sz"), ["what"] = "door" }, 0);
            string fetch = resident != null ? $"Fetch it at {S(resident, "first")}'s door." : "It waits at the post office counter.";
            return InsertLetterJob("A letter for " + S(to, "name"), S(plan, "sender"), pay, $"{who} asks you to carry a letter to the door of {S(to, "name")}. {fetch}" + (pay != 0 ? $" {pay} centimes when it is done." : " No pay."), task, "letter");
        }
        if (counter == null) return null;
        int fee = (int)N(offer, "fee_c"); string city = S(offer, "city");
        var telegram = Task(new JsonObject { ["id"] = "telegraph", ["name"] = "the telegraph counter", ["x"] = counter["x"]!.DeepClone(), ["z"] = counter["z"]!.DeepClone(), ["what"] = "telegraph" }, fee);
        telegram["city"] = city;
        string words = resident != null ? $"Fetch the words at {S(resident, "first")}'s door." : "The words wait at the post office counter.";
        return InsertLetterJob("A telegram to " + city, S(plan, "sender"), pay, $"{who} asks you to send a telegram to {city}. {words} You pay the {fee} centimes at the counter; {pay} centimes back when it is sent.", telegram, "letter");
    }
}
