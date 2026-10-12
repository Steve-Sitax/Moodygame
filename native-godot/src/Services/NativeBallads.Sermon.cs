using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeBallads
{
    public JsonObject SermonView(int player, JsonObject sermon)
    {
        var flock = A(CathedralView?.Invoke(player)["people"]).Where(p => S(p, "role") == "worshipper").ToArray();
        var gossip = flock.Where(p => Person(S(p, "id")) != null).OrderByDescending(p => N(Person(S(p, "id"))?["stats"], "gossip")).FirstOrDefault();
        string kind = S(sermon["hint"], "kind") == "warn" ? "hint" : A(sermon["kinds"]).Select(k => k!.GetValue<string>()).FirstOrDefault(k => data["sermon"]!["WHISPERS"]![k] != null) ?? "";
        string words = kind == "hint" ? "A young man on the quays? Everybody knows who he means." : kind == "" ? "Short today. The roast will not be burnt." : S(data["sermon"]!["WHISPERS"], kind);
        var neighbour = flock.FirstOrDefault(p => S(p, "id") != S(gossip, "id") && S(p, "sex") == "f") ?? flock.FirstOrDefault(p => S(p, "id") != S(gossip, "id"));
        return new() {
            ["day"] = N(sermon, "day"), ["lines"] = sermon["lines"]!.DeepClone(), ["source"] = S(sermon, "source"), ["hint"] = sermon["hint"]?["kind"]?.DeepClone(),
            ["gossip"] = gossip == null ? null : new JsonObject { ["id"] = S(gossip, "id"), ["name"] = S(gossip, "first"), ["to"] = neighbour?["id"]?.DeepClone(), ["text"] = words },
            ["nodders"] = Strings(flock.Where(p => N(Person(S(p, "id"))?["stats"], "piety") >= 6 && S(p, "id") != S(gossip, "id")).Take(8).Select(p => S(p, "id"))),
            ["heard"] = C.PlayerState(player, "sermon:heard:" + (int)N(sermon, "day")) != null
        };
    }
    public JsonObject Hear(int player) => C.Atomic(() => {
        var sermon = C.World("sermon:" + Day);
        if (sermon == null || Day % 7 != 0 || Hour < 9 || Hour >= 11.5 || Inside?.Invoke(player) != "cathedral" || C.PlayerState(player, "sermon:heard:" + Day) != null) return new JsonObject { ["delta"] = 0, ["text"] = "" };
        C.SetPlayerState(player, "sermon:heard:" + Day, true); int delta = S(sermon["hint"], "kind") == "warn" ? -1 : 1;
        C.Execute("UPDATE faction_trust SET trust=MAX(-5,MIN(10,trust+$p0)) WHERE player_id=$p1 AND faction='kerk'", delta, player);
        C.Log(player, "heard_sermon", "kerk", delta < 0 ? "Jef was at high mass when the priest warned of a young man on the quays; heads turned." : "Jef heard the Sunday sermon at high mass in the cathedral.");
        return new JsonObject { ["delta"] = delta, ["text"] = delta < 0 ? "Heads turn along the rows toward you. Somebody tuts. The church will remember that you were here, and what was said." : "The priest's eye rests on you a moment from the pulpit, and he nods. The church takes note of a new face at mass." };
    });
    public void LogSermon()
    {
        if (Day % 7 != 0 || Hour < 11 || C.World("sermon:" + Day) is not {} sermon || C.World("sermon:logged:" + Day) != null) return;
        C.SetWorld("sermon:logged:" + Day, true);
        string Word(string kind) => kind switch { "robbery" => "theft", "scuffle" => "quarrels", "drink" => "drink", "fire" => "the fire", "liner" => "the emigrants leaving", "emigrants" => "the strangers on the quays", "rumour" => "gossip", "funeral" => "death", "wedding" => "marriage", "event" => "the Sabbath", _ => "" };
        var topics = A(sermon["kinds"]).Select(k => Word(k!.GetValue<string>())).Where(t => t != "").Distinct().ToArray();
        host.Interiors.WriteEvent("event", "sermon", "At high mass the parish priest preached " + (topics.Length == 0 ? "on keeping the Sabbath" : "on " + string.Join(", ", topics)) + (S(sermon["hint"], "kind") == "warn" ? ", and warned of a young man on the quays" : "") + ".", 3, place: "cathedral");
    }
}
