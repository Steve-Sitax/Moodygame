using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>The four people of the Rijnkaai who are not town residents (Sooi, Widow Peeters, Tuur, Fientje) talk again
/// (fix 6, 2026-11-02): at their post in their hours they open with their own line, offer work/news/goodbye, and with AI
/// answer typed words in character, as the browser's `dialogue` hook did. They take no actions (M4). Outside their hours
/// they keep the short brush-off. Trust, memories and money stay engine rules, as for residents.</summary>
public sealed partial class NativeTownTalk
{
    /// <summary>Their character, from the browser game's hand-written personas (server/src/npcs.ts FALLBACK_PERSONA and PLACED).</summary>
    private static readonly JsonObject QuayPeople = NativeNorthNarration.Parse("""
    {
      "sooi": { "first": "Sooi", "age": 54, "trade": "foreman", "hours": [5, 20], "place": "hessenatie",
        "stats": { "warmth": 4, "greed": 3, "honesty": 7, "temper": 7, "courage": 6, "gossip": 4 },
        "story": "Foreman of the Hessenatie on the Rijnkaai, in his fifties. Gruff and fair. Hires day men at dawn at the board by the Hessenatie door. Hates slackers, thieves and men who talk to the police.",
        "wants": ["a crew that works without being watched", "the Hessenatie to beat the Katoennatie to the new ships"],
        "fears": ["his knees giving out before his sons are grown", "a cargo lost on his watch"],
        "secret": "He once let a smuggler's barrels through the Hessenatie shed for a month's wages.",
        "tics": ["Right.", "Out with it.", "I don't pay for talk."], "speech": "short",
        "look": "Broad, grey stubble, a docker's cap and a coat gone shiny at the elbows.",
        "self": "Foreman of the Hessenatie. I hire at dawn, at the board by our door. Slackers need not come.",
        "open": ["Right. Out with it.", "You again. What is it?", "Make it quick, the tide won't wait."] },
      "peeters": { "first": "Widow Peeters", "age": 58, "trade": "ship chandler", "hours": [7, 19], "place": "rijnkaai",
        "stats": { "warmth": 5, "greed": 7, "honesty": 6, "temper": 4, "courage": 5, "gossip": 6 },
        "story": "Widow who has run a ship chandlery on the Rijnkaai since her husband drowned. Careful with money, sharp with figures, remembers every favour and every slight.",
        "wants": ["to keep the chandlery out of debt", "a son who comes home sober"],
        "fears": ["the bank", "dying alone above the shop"],
        "secret": "Her husband did not drown by accident; she knows who pushed him.",
        "tics": ["Count it twice.", "We shall see.", "Hm."], "speech": "mid",
        "look": "Small, in black, a ledger under her arm and spectacles on a ribbon.",
        "self": "Rope, tar, lamp oil and biscuit for the ships, since my husband was taken by the river. Count it twice, I always say.",
        "open": ["Hm. Good day. You want something, I suppose.", "Wipe your feet. What can I do for you?", "We shall see what you want. Good day."] },
      "tuur": { "first": "Tuur", "age": 41, "trade": "ferryman", "hours": [7, 26], "place": "rijnkaai",
        "stats": { "warmth": 6, "greed": 6, "honesty": 3, "temper": 5, "courage": 7, "gossip": 3 },
        "story": "Ferryman on the Scheldt and a night lighter. Rows people to Sint-Anna by day and moves goods nobody asks about by night. Pays for silence. Friendly until he is not.",
        "wants": ["a bigger boat", "the police looking the other way"],
        "fears": ["the river at night when the fog is thick", "prison in the Steen"],
        "secret": "He owes money to men from Rotterdam who are losing patience.",
        "tics": ["Ask nothing.", "The river keeps quiet, so do I.", "Ha."], "speech": "short",
        "look": "Lean, tar on his hands, a sailor's jersey and a pipe that is never lit.",
        "self": "I row folk over to Sint-Anna, and back if they pay. What else I carry is the river's business.",
        "open": ["Ha. Wanting a crossing, friend?", "Evening comes early on the water. What is it?", "Ask nothing, and I'll tell you no lies. Well?"] },
      "fientje": { "first": "Fientje", "age": 46, "trade": "fishwife", "hours": [6, 18], "place": "rijnkaai",
        "stats": { "warmth": 8, "greed": 5, "honesty": 5, "temper": 5, "courage": 6, "gossip": 10 },
        "story": "Fishwife from the Vismarkt who sells from a cart on the Rijnkaai in the mornings. Knows everyone's business and tells it, often wrong in the details. Loud, warm, never quiet for long.",
        "wants": ["to know everything first", "a proper stall at the Vismarkt"],
        "fears": ["being the one people talk about", "cholera coming back"],
        "secret": "She cannot read, and hides it by making people tell her everything.",
        "tics": ["You didn't hear it from me!", "Listen, listen.", "Mark my words."], "speech": "mid",
        "look": "Big red hands, a shawl, a basket of herring on her hip, a voice that carries.",
        "self": "Herring, love, and whatever the Vismarkt says before the bells. Listen, listen: nobody hears it before me.",
        "open": ["Listen, listen! Fresh herring, love, and news for nothing.", "Oh, it's you! Come here, I've heard things.", "Mark my words, it'll rain by noon. What'll it be, love?"] }
    }
    """);
    private static readonly string QuayRules = "You are one of the four known people of the Rijnkaai, not a stranger. Use your verbal tics now and then. Keep your secret unless trust is very high, and even then only hint at it. Memories marked heard are gossip; you may doubt them. You never hand out money or goods in talk; only work and your stall do that. Use the numbers of the work on offer as given. Never take an action: leave action out.";
    public static bool IsQuay(string id) => QuayPeople.ContainsKey(id);
    private bool QuayOnDuty(string id)
    {
        var hours = QuayPeople[id]!["hours"]!.AsArray(); double from = N(hours[0]), to = N(hours[1]), now = Hour;
        return to > 24 ? now >= from || now < to - 24 : now >= from && now < to;
    }
    /// <summary>One of the four as a talk person: the same fields the resident talk reads (id, name, first, age, trade, stats, work).</summary>
    private JsonObject QuayPerson(string id, JsonObject npc)
    {
        var data = QuayPeople[id]!;
        return new JsonObject { ["id"] = id, ["name"] = S(npc, "name"), ["first"] = S(data, "first"), ["age"] = N(data["age"]), ["trade"] = S(data, "trade"),
            ["role"] = S(npc, "role"), ["household"] = -1, ["stats"] = data["stats"]!.DeepClone(), ["work"] = new JsonObject { ["place"] = S(data, "place"), ["kind"] = "post" }, ["quay"] = true };
    }
    private static JsonObject QuayCharacter(string id)
    {
        var data = QuayPeople[id]!;
        return new JsonObject { ["story"] = S(data, "story"), ["wants"] = data["wants"]!.DeepClone(), ["fears"] = data["fears"]!.DeepClone(), ["secret_never_tell_easily"] = S(data, "secret"),
            ["verbal_tics"] = data["tics"]!.DeepClone(), ["speech_length"] = S(data, "speech"), ["look"] = S(data, "look") };
    }
    private string QuayOpening(string id, int met) => Pick($"{id}:{met}:{NativeCoreClock.Number(host.Clock.View(), "day")}", FitHour(QuayPeople[id]!["open"]!.AsArray().Select(n => n!.GetValue<string>())));
    /// <summary>The work this person offers on the board (Sooi hires, the widow and Tuur sometimes have a job), for the prompt and the "work" answer.</summary>
    private JsonArray QuayJobs(string id) => C.Rows("SELECT title,pay_c,status FROM job WHERE employer_npc=$p0 AND status='offered' ORDER BY id LIMIT 3", id);
}
