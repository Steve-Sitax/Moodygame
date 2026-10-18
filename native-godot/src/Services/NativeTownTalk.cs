using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.Town;

namespace Scheldemist.Native.Services;

/// <summary>The town's hand-written conversation engine and durable meeting/witness facts.
/// AI providers can answer through the explicit hook; engine choices never manufacture money or goods.</summary>
public sealed partial class NativeTownTalk : INativeServiceModule
{
    private sealed class Session
    {
        public long At;
        public readonly HashSet<string> Used = new();
        public readonly Dictionary<string, string> Offered = new();
        public bool Met;
        public int Calls;
        public bool Speaking;
        public bool Typed;
        public int Trust;
        public readonly List<string> Turns = new();
    }
    private readonly NativeServiceHost host;
    private readonly NativeTown town;
    private NativeServiceContext C => host.Context;
    private readonly Dictionary<(int Player, string Npc), Session> sessions = new();
    public Func<int, string, double>? Reputation;
    public Func<NativeServiceRequest, JsonObject, JsonObject?>? Provider;
    public readonly List<Func<NativeServiceRequest, JsonObject, JsonObject?>> FullTalkOverrides = new();
    public readonly List<Func<NativeServiceRequest, JsonObject, string?>> OpeningOverrides = new();
    public readonly List<Func<int, JsonObject, IEnumerable<string>>> ChoiceAdditions = new();
    public readonly List<Func<string, JsonObject, string?>> ChoiceLabels = new();
    public readonly List<Func<NativeServiceRequest, JsonObject, string?, JsonObject?>> ReplyOverrides = new();
    private static readonly Dictionary<string, string[]> Greetings = new()
    {
        ["warm"] = new[] { "Good day to you.", "Well now, a new face. Good day.", "Morning. You look like you could use a hot meal." },
        ["neutral"] = new[] { "Good day.", "Yes?", "What is it?" },
        ["cold"] = new[] { "I'm busy.", "What now?", "Make it quick." },
        ["suspicious"] = new[] { "I know your face. What do you want?", "Keep your hands where I can see them.", "What are you after?" },
        ["angry"] = new[] { "You've got some nerve, coming up to me.", "Clear off, you.", "Not you again." },
        ["afraid"] = new[] { "Who's that? Oh. You gave me a start.", "Stay back a step, will you.", "It's late to be creeping up on folk." },
        ["amused"] = new[] { "Ha. And who might you be?", "Evening! Or is it? I've lost count.", "Look at this one." },
    };
    private static readonly Dictionary<string, string> Posted = new()
    {
        ["sooi"] = "Sooi grunts and looks past you at the river. \"Not now, lad.\"",
        ["peeters"] = "\"I have the books to do,\" the widow says, and does not look up.",
        ["tuur"] = "Tuur taps his cold pipe. \"Later, friend. The river is talking.\"",
        ["fientje"] = "\"Oh, love, I've herring to sell. Come back when I'm not shouting!\"",
    };
    public NativeTownTalk(NativeServiceHost host, NativeTown town) => (this.host, this.town) = (host, town);
    private static string S(JsonNode? value, string key, string fallback = "") => NativeTown.S(value, key, fallback);
    private static double N(JsonNode? value) => NativeTown.N(value);
    private double Hour => NativeCoreClock.Number(host.Clock.View(), "hour") + NativeCoreClock.Number(host.Clock.View(), "minute") / 60.0;
    private string Leave => Hour >= 20 || Hour < 5 ? "Good night to you." : "Good day to you.";
    private static string Pick(string seed, IEnumerable<string> lines)
    {
        var values = lines.ToArray(); return values[Whereabouts.HashId(seed) % (uint)values.Length];
    }
    private IEnumerable<string> FitHour(IEnumerable<string> lines)
    {
        var all = lines.ToArray(); var fit = all.Where(line => line.Contains("Morning") ? Hour >= 5 && Hour < 12 : line.Contains("Evening") ? Hour >= 17 || Hour < 3 : line.Contains("Good day") ? Hour < 20 && Hour >= 5 : line.Contains("late to be") ? Hour >= 18 || Hour < 5 : true).ToArray();
        return fit.Length > 0 ? fit : all;
    }
    public string Mood(int player, JsonObject resident)
    {
        int trust = C.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1", S(resident, "id"), player);
        double rep = Reputation?.Invoke(player, S(resident, "id")) ?? host.Rumours.ReputationWith(S(resident, "id"), player);
        double temper = N(resident["stats"]?["temper"]), courage = N(resident["stats"]?["courage"]), warmth = N(resident["stats"]?["warmth"]);
        bool late = Hour >= 21 || Hour < 6;
        if (N(resident["age"]) < 13) return rep < -1 ? "afraid" : "amused";
        if (S(resident, "trade") == "thief") return late ? "amused" : "suspicious";
        if (trust <= -3) return temper >= 6 ? "angry" : "cold";
        if (trust < 0 && rep < 1) return courage <= 3 ? "suspicious" : "cold";
        if (rep <= -1.2 && temper >= 7) return "angry";
        if (rep <= -0.8) return courage <= 3 ? "afraid" : "suspicious";
        if (late && courage <= 3) return "afraid";
        if (rep >= 1 || trust >= 4) return warmth >= 4 ? "warm" : "neutral";
        if (late && temper >= 6) return "cold";
        var now = town.Activity(S(resident, "id"));
        if (now.Act == "work" && N(resident["stats"]?["greed"]) >= 7) return "cold";
        if (now.Act == "tavern" && warmth >= 5) return "amused";
        return warmth >= 7 ? "warm" : temper >= 8 ? "cold" : "neutral";
    }
    private string Choice(string topic, JsonObject person)
    {
        var own = ChoiceLabels.Select(callback => callback(topic, person)).FirstOrDefault(text => text != null); if (own != null) return own;
        bool child = N(person["age"]) < 13;
        return topic switch
        {
            "work" => "Is there any work going?", "rumour" => "What do people say about me?",
            "family" => child ? "Where do you live?" : "Have you family here?", "town" => "What's the news?",
            "theft" => "I've been robbed. Will you help me?", "bye" => Leave,
            _ => child ? "What are you playing?" : S(person["work"], "kind") is "stall" or "shop" ? "How is trade today?" : S(person, "trade") switch
            { "police" => "Anything I should know about?", "beggar" => "How do you get by?", "sentry" or "corporal" => "What are you guarding here?", "soldier" => "Where are you stationed?", "customs" => "What are you writing down?", _ => "What do you do here?" }
        };
    }
    private JsonArray Choices(int player, JsonObject person, Session session)
    {
        string[] order = N(person["age"]) < 13 ? new[] { "self", "family", "rumour", "bye" } : S(person, "trade") is "sentry" or "corporal" or "soldier" or "customs" ? new[] { "self", "theft", "rumour", "work", "family", "town", "bye" } : new[] { "work", "rumour", "self", "family", "town", "bye" };
        session.Offered.Clear();
        foreach (string extra in ChoiceAdditions.SelectMany(callback => callback(player, person)).Where(choice => !session.Used.Contains("extra:" + choice)).Take(2)) session.Offered[extra] = "extra:" + extra;
        foreach (string topic in order.Where(t => t != "bye" && !session.Used.Contains(t)).Take(2 - session.Offered.Count).Append("bye")) session.Offered[Choice(topic, person)] = topic;
        var choices = session.Offered.Keys.ToList(); while (choices.Count < 3) choices.Add(Leave);
        return new JsonArray(choices.Select(choice => (JsonNode)JsonValue.Create(choice)!).ToArray());
    }
    private string Label(string place) => S(C.World("town")?["places"]?[place], "label", "the quays");
    private string Family(JsonObject person)
    {
        var family = town.Residents.Values.Where(other => N(other["household"]) == N(person["household"]) && S(other, "id") != S(person, "id")).ToArray();
        if (N(person["age"]) < 15)
        {
            var parents = family.Where(r => N(r["age"]) >= 18).Select(r => (S(r, "sex") == "f" ? "mother " : "father ") + S(r, "first"));
            return "With my " + string.Join("; ", parents.DefaultIfEmpty("family")) + ". Over there.";
        }
        var spouse = family.FirstOrDefault(r => S(r, "family_role") is "wife" or "husband" || S(person, "family_role") != "head" && S(r, "family_role") == "head" && S(r, "sex") != S(person, "sex") && N(r["age"]) > 17);
        var kids = family.Where(r => S(r, "family_role") is "son" or "daughter").ToArray();
        var bits = new List<string>();
        if (spouse != null) bits.Add((S(spouse, "sex") == "f" ? "wife " : "husband ") + S(spouse, "first"));
        if (kids.Length > 0) bits.Add($"{kids.Length} children: " + string.Join(", ", kids.Select(r => $"{S(r, "first")} ({N(r["age"]):0})")));
        if (bits.Count == 0) return N(person["stats"]?["warmth"]) >= 6 ? "Nobody. Just me and the four walls." : "That's my business.";
        return "My " + string.Join("; ", bits) + ".";
    }
    private string Reply(int player, JsonObject person, string? topic, string said)
    {
        string id = S(person, "id"), seed = id + ":" + said;
        switch (topic)
        {
            case "work":
                if (N(person["age"]) < 13) return "Work? Ask the grown-ups. Or the man with the board on the Rijnkaai.";
                var own = C.One("SELECT title,pay_c FROM job WHERE employer_npc=$p0 AND status='offered' ORDER BY id LIMIT 1", id);
                if (own != null) return $"I've work, if you want it: {S(own, "title").ToLowerInvariant()}, {N(own["pay_c"]):0} centimes. Say the word.";
                var job = C.One("SELECT title,employer_npc FROM job WHERE status='offered' ORDER BY id LIMIT 1");
                if (job == null) return Pick(seed, new[] { "Not today. The board's bare, and so are my pockets.", "Nothing I know of. Try the board at dawn." });
                string employer = S(job, "employer_npc");
                return $"Try {C.Scalar<string>("SELECT name FROM npc WHERE id=$p0", employer)} at {Label(S(C.Rules["employers"]?[employer], "door"))}. Wanted a hand this morning: {S(job, "title").ToLowerInvariant()}.";
            case "rumour":
                var memory = host.Rumours.Of(id, player, 4).FirstOrDefault();
                return memory == null ? N(person["stats"]?["gossip"]) >= 7 ? "Nothing yet. And I hear everything, so you've done nothing worth telling." : "Nobody talks about you. Nobody knows you yet." : S(memory, "source") == "seen" ? "I saw it myself. " + NativeCoreRumours.ToYou(S(memory, "gist")) + "." : "People say " + NativeCoreRumours.ToYou(S(memory, "gist")) + ".";
            case "family": return Family(person);
            case "self":
                if (N(person["age"]) < 13) return Pick(seed, new[] { "Tag. The big ones always win.", "Hide and seek, round the carts. Don't tell where I hide.", "Chasing. You're it! No, you're too slow." });
                return S(person, "trade") switch
                {
                    "thief" => "Me? I help people carry their purses. It's a kindness, at night.",
                    "beggar" => "On what the good people give, and the soup at the church door.",
                    "navvy" => "Pulling down the old wall for the town. Every brick knocked clean and stacked; they sell them on. Dust in your throat from seven till dark.",
                    "works_foreman" => "Foreman of the town's works. The old Spanish wall comes down a stretch at a time, and the boulevards go where it stood. Keep off the rubble.",
                    "corporal" => "Corporal of the guard. I bring the relief out every two hours and see my men stay awake.",
                    "customs" => "What comes off the ships: casks, bales, crates. I count them against the papers and write it down. Nothing leaves the quay till the duty's paid.",
                    _ => C.Scalar<string>("SELECT role FROM npc WHERE id=$p0", id) + ", on " + Label(S(person["work"], "place")) + ". It's work."
                };
            case "town": return Pick(seed, new[] { "The Red Star Line starts sailing for America. The quays are full of people who want to go.", "The Katoennatie wants more men for the new ships, they say.", "Nobody drinks canal water since the cholera of 'sixty-six.", "The toll's gone these ten years, and the ships keep coming." });
            case "theft": return "Go to the police post on the Grote Markt, by the town hall.";
            case "bye": return Pick(seed, FitHour(new[] { "Good day, then.", "Go on, then.", "God keep you.", "Mind how you go." }));
            default: return N(person["stats"]?["temper"]) >= 7 ? "If you say so. I've work to do." : N(person["stats"]?["warmth"]) >= 6 ? "Could be. You'd know better than me." : "I wouldn't know about that.";
        }
    }
    public JsonObject Talk(NativeServiceRequest request)
    {
        string id = request.Param("id");
        var npc = C.One("SELECT id,name,role FROM npc WHERE id=$p0", id) ?? throw new NativeServiceException("nobody by that name here", 404);
        var person = town.Resident(id);
        foreach (var callback in FullTalkOverrides) if (callback(request, person ?? npc) is { } own) return own;
        if (person == null)
            return new JsonObject { ["npc_line"] = Posted.GetValueOrDefault(id, "They shrug and turn away."), ["mood"] = "neutral", ["choices"] = new JsonArray("All right. Later, then.", "It won't take long.", "I'll leave you be."), ["end"] = true, ["free"] = Provider != null, ["wares"] = host.Trade.PersonalWares(request.PlayerId,id) };
        var key = (request.PlayerId, id);
        if (!sessions.TryGetValue(key, out var session) || C.Now - session.At > 90000) sessions[key] = session = new Session();
        session.At = C.Now;
        C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) VALUES($p0,$p1)", id, request.PlayerId);
        string text; bool end = false;
        string kind = request.Text("kind"), said = request.Text("text");
        if (kind is "choice" or "free")
        {
            string? topic = session.Offered.GetValueOrDefault(said);
            if (topic != null) session.Used.Add(topic);
            foreach (var callback in ReplyOverrides) if (callback(request, person, topic) is { } own) return own;
            if (topic == null && Provider?.Invoke(request, person) is { } answer) return answer;
            if (topic == null && Provider == null) return new JsonObject { ["gated"] = "AI is off", ["free"] = false };
            end = topic == "bye";
            text = Reply(request.PlayerId, person, topic, said);
        }
        else
        {
            if (!session.Met)
            {
                session.Met = true;
                C.Execute("UPDATE npc_relationship SET times_met=times_met+1,last_seen_day=$p0,last_place=$p1 WHERE npc_id=$p2 AND player_id=$p3", NativeCoreClock.Number(host.Clock.View(), "day"), S(person["work"], "place"), id, request.PlayerId);
                host.Trade.Remember(request.PlayerId, id, "A new person in town stopped me to talk.", 2);
            }
            int met = C.Scalar<int>("SELECT times_met FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1", id, request.PlayerId);
            text = OpeningOverrides.Select(callback => callback(request, person)).FirstOrDefault(value => !string.IsNullOrEmpty(value)) ?? (N(person["age"]) < 13 ? Pick(id + ":" + met, new[] { "What do you want, mister?", "You're not from round here.", "Are you the one from the Kempen?", "We're playing. You can't join, you're too big." }) : Pick($"{id}:{met}:{NativeCoreClock.Number(host.Clock.View(), "day")}:{NativeCoreClock.Number(host.Clock.View(), "hour")}", FitHour(Greetings[Mood(request.PlayerId, person)])));
        }
        var choices = end ? new JsonArray(Leave, Leave, Leave) : Choices(request.PlayerId, person, session);
        if (end) sessions.Remove(key);
        return new JsonObject { ["npc_line"] = text, ["mood"] = Mood(request.PlayerId, person), ["choices"] = choices, ["end"] = end, ["free"] = Provider != null, ["wares"] = host.Trade.PersonalWares(request.PlayerId,id) };
    }
    public JsonObject Line(NativeServiceRequest request, JsonObject person, string text, bool end = false)
    {
        var key = (request.PlayerId, S(person, "id"));
        if (!sessions.TryGetValue(key, out var session)) sessions[key] = session = new Session { At = C.Now };
        var choices = end ? new JsonArray(Leave, Leave, Leave) : Choices(request.PlayerId, person, session);
        if (end) sessions.Remove(key);
        return new JsonObject { ["npc_line"] = text, ["mood"] = Mood(request.PlayerId, person), ["choices"] = choices, ["end"] = end, ["free"] = Provider != null, ["wares"] = host.Trade.PersonalWares(request.PlayerId,S(person, "id")) };
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("POST", "/api/npc/:id/near", r => { if (C.Scalar<long>("SELECT COUNT(*) FROM npc WHERE id=$p0", r.Param("id")) == 0) throw new NativeServiceException("nobody by that name here", 404); return new JsonObject { ["ok"] = true }; });
        service.RegisterAsync("POST", "/api/npc/:id/talk", TalkAsync);
        service.Register("POST", "/api/talk/hold", HoldTalk);
        service.TalkHolds = TalkPins;
        service.Register("POST", "/api/npc/:id/witness", r => {
            string id = r.Param("id"), action = r.Text("event");
            if (action is not ("took" or "returned")) throw new NativeServiceException("bad event");
            var npc = C.One("SELECT name FROM npc WHERE id=$p0", id) ?? throw new NativeServiceException("nobody by that name here", 404);
            if (action == "took") {
                C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) VALUES($p0,$p1)", id, r.PlayerId);
                host.Rumours.ApplyTrust(id, r.PlayerId, -1, 0);
                host.Trade.Remember(r.PlayerId, id, "Jef lifted my goods off the quay without asking, right in front of me.", 6, $"Jef lifted {S(npc, "name")}'s goods off the quay without asking", -2);
                C.Log(r.PlayerId, "took_goods", id, $"Jef picked up goods that belong to {S(npc, "name")}, and {S(npc, "name")} saw it.");
            } else host.Trade.Remember(r.PlayerId, id, "Jef put my goods back when I shouted. Maybe just clumsy.", 3);
            return new JsonObject { ["ok"] = true };
        });
        service.NewGame += ResetTalks; service.Loaded += ResetTalks;
    }
}

