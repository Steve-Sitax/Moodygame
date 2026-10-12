using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeBallads
{
    public static readonly string[] Corners = { "grote_markt", "vismarkt", "handschoenmarkt", "steenplein" };
    private IEnumerable<JsonObject> Candidates()
    {
        var all = Residents().ToArray();
        return all.Where(r => S(r, "trade") == "beggar" && N(r, "age") >= 18).OrderBy(r => S(r, "sex") == "m" ? 0 : 1).ThenBy(r => Hash(S(r, "id")))
            .Concat(all.Where(r => S(r, "sex") == "m" && N(r, "age") >= 40 && N(r["stats"], "wealth") <= 2 && S(r, "trade") is "retired" or "docker" or "boatman" or "sailor").OrderBy(r => Hash(S(r, "id"))));
    }
    public JsonObject? Singer()
    {
        if (C.World("ballad:singer") is JsonValue saved && Person(saved.GetValue<string>()) is {} kept) return kept;
        var pick = Candidates().FirstOrDefault(); if (pick != null) C.SetWorld("ballad:singer", S(pick, "id")); return pick;
    }
    public JsonObject? EveningTavern(int day)
    {
        var places = C.World("town")?["places"] as JsonObject ?? new(); var residents = Residents().ToArray();
        var open = places.Select(p => p.Key).Where(p => p.StartsWith("tavern:", StringComparison.Ordinal)).Order(StringComparer.Ordinal)
            .Where(p => residents.FirstOrDefault(r => S(r, "trade") == "publican" && S(r["work"], "place") == p) is {} keeper && NativeShops.Activity(keeper, day, 20).act == "work").ToArray();
        if (open.Length == 0) return null; string place = open[Hash("tavern:" + day) % open.Length];
        return new() { ["place"] = place, ["label"] = S(places[place], "label", "the tavern") };
    }
    private JsonArray TodayEvents() => C.Rows("SELECT * FROM town_event WHERE template='ballad' AND day=$p0 AND status<>'cancelled' ORDER BY id", Day);
    public JsonObject? Singing()
    {
        var today = TodayEvents(); var ev = today.FirstOrDefault(e => S(e, "status") == "running") ?? today.FirstOrDefault(e => S(e, "status") == "planned");
        if (ev != null) return new() { ["kind"] = "street", ["event"] = ev["id"]!.DeepClone(), ["place"] = S(ev, "place"), ["label"] = S(A(JsonNode.Parse(S(ev, "stages_json", "[]"))).FirstOrDefault(), "label", S(ev, "place")), ["x"] = N(ev, "x"), ["z"] = N(ev, "z"), ["from"] = Hour < 13 ? 9.5 : 14, ["to"] = Hour < 13 ? 12.5 : 17, ["status"] = S(ev, "status") };
        if (Hour >= 19 && Hour < 21.5 && EveningTavern(Day) is {} tavern) return new() { ["kind"] = "tavern", ["event"] = null, ["place"] = S(tavern, "place"), ["label"] = S(tavern, "label"), ["x"] = null, ["z"] = null, ["from"] = 19.5, ["to"] = 21.5, ["status"] = Hour >= 19.5 ? "running" : "planned" };
        return null;
    }
    private JsonArray TavernGuest(string place)
    {
        var now = Singing(); var singer = Singer();
        if (S(now, "kind") != "tavern" || S(now, "place") != place || S(now, "status") != "running" || singer == null || actions.Of(S(singer, "id")) != null) return new();
        var guest = new JsonObject(); foreach (string key in new[] { "id", "name", "first", "kind", "sex", "age" }) guest[key] = singer[key]?.DeepClone();
        guest["stand"] = true; guest["role"] = "ballad_singer"; return new JsonArray(guest);
    }
    public void PlanDay()
    {
        int have = TodayEvents().Count; double now = Hour * 60;
        for (int i = 0; i < 2; i++) {
            double start = i == 0 ? 570 : 840, end = i == 0 ? 750 : 1020;
            if (have > i || now < start - 60 || now >= end - 60) continue;
            Plan(Corners[(Day + i * 2) % Corners.Length], Math.Max(0, (int)(start - now))); return;
        }
    }
    public JsonObject Plan(string corner = "", int startIn = 0, bool dev = false)
    {
        var template = A(events.Data["templates"]).FirstOrDefault(t => S(t, "id") == "ballad");
        if (template == null) return new() { ["ok"] = false, ["why"] = "no ballad template" };
        IEnumerable<string> order = corner == "" ? Corners : new[] { corner }.Concat(Corners.Where(c => c != corner)); string why = "";
        foreach (string place in order) {
            var plan = template.DeepClone().AsObject(); plan["template"] = "ballad"; plan["source"] = "engine"; plan["place"] = place;
            plan["start_in_min"] = startIn; plan["why"] = "the ballad singer's round";
            var result = events.Plan(plan, dev);
            if (B(result, "ok")) { var ev = result["event"]!.AsObject(); CallSinging(ev); result["event"] = events.Row((int)N(ev, "id")); return result; }
            why = S(result, "why");
        }
        return new() { ["ok"] = false, ["why"] = why };
    }
    private JsonArray? CallSinging(JsonObject ev)
    {
        int eventId = (int)N(ev, "id"); ev = events.Row(eventId) ?? ev;
        var stage = A(JsonNode.Parse(S(ev, "stages_json", "[]"))).FirstOrDefault(); double x = N(stage, "x", N(ev, "x")), z = N(stage, "z", N(ev, "z"));
        var leads = A(JsonNode.Parse(S(ev, "leads_json", "[]"))); var people = A(JsonNode.Parse(S(ev, "people_json", "[]")));
        if (!leads.Any(l => S(l, "role") == "ballad_singer")) {
            var occupied = events.Live().Where(e => N(e, "id") != eventId).SelectMany(e => A(JsonNode.Parse(S(e, "people_json", "[]"))).Select(p => p!.GetValue<string>()).Concat(A(JsonNode.Parse(S(e, "leads_json", "[]"))).Select(p => S(p, "id")))).ToHashSet();
            foreach (var action in actions.Active().Where(a => N(a, "event_id", -1) != eventId)) occupied.Add(S(action, "npc_id"));
            var main = Singer(); var candidates = main == null ? Candidates() : new[] { main }.Concat(Candidates().Where(c => S(c, "id") != S(main, "id")));
            var singer = candidates.FirstOrDefault(c => !occupied.Contains(S(c, "id"))); if (singer == null) return null;
            string id = S(singer, "id"); var at = actions.NearestOpen?.Invoke(x, z, 4) ?? new JsonObject { ["x"] = x, ["z"] = z };
            if (actions.Of(id) is {} old) actions.End((int)N(old, "id"), "done", "a part in it");
            actions.Start(new() { ["npc_id"] = id, ["kind"] = "attend", ["target"] = S(ev, "title"), ["target_x"] = N(at, "x"), ["target_z"] = N(at, "z"), ["source"] = "event", ["event_id"] = eventId, ["minutes"] = Math.Max(5, N(ev, "end_m") - host.Clock.GameMinute()), ["data"] = new JsonObject { ["order"] = people.Count, ["about"] = S(ev, "place"), ["role"] = "lead", ["lead"] = "ballad_singer" } }, null);
            leads.Add(new JsonObject { ["role"] = "ballad_singer", ["id"] = id, ["name"] = S(singer, "name"), ["stage"] = Math.Max(0, N(ev, "stage")) });
            if (!people.Any(p => p!.GetValue<string>() == id)) people.Add(id);
            C.Execute("UPDATE town_event SET leads_json=$p0,people_json=$p1 WHERE id=$p2", leads.ToJsonString(), people.ToJsonString(), eventId);
        }
        if (people.Count - 1 < 10) events.Attend(events.Row(eventId)!, new JsonObject { ["role"] = "crowd", ["count"] = 10 - (people.Count - 1), ["x"] = x, ["z"] = z });
        string lead = S(leads.FirstOrDefault(l => S(l, "role") == "ballad_singer"), "id");
        return new JsonArray(A(JsonNode.Parse(S(events.Row(eventId), "people_json", "[]"))).Where(p => p!.GetValue<string>() != lead).Select(p => p!.DeepClone()).ToArray());
    }
    private void Sing(JsonObject ev, JsonObject stage)
    {
        var crowd = CallSinging(ev); var current = events.Row((int)N(ev, "id"))!;
        var lead = A(JsonNode.Parse(S(current, "leads_json", "[]"))).FirstOrDefault(l => S(l, "role") == "ballad_singer"); var singer = Person(S(lead, "id"));
        if (crowd == null || singer == null) { events.Finish((int)N(ev, "id"), "cancelled"); return; }
        var ballad = C.World("ballad:" + Day); string title = ballad == null ? "the day's new ballad" : "\"" + S(ballad["text"], "title") + "\"";
        long record = host.Interiors.WriteEvent("event", "ballad_sung", $"The ballad singer {S(singer, "name")} sang {title} at {S(stage, "label", S(ev, "place"))}, and sold his sheets.", 2, actor: S(singer, "id"), place: S(ev, "place"), who: new[] { S(singer, "id") });
        C.Execute("UPDATE world_event SET x=$p0,z=$p1,ref_type='town_event',ref_id=$p2 WHERE id=$p3", N(stage, "x", N(ev, "x")), N(stage, "z", N(ev, "z")), (int)N(ev, "id"), record);
        if (B(ballad, "aboutJef")) foreach (var id in crowd.Take(4)) host.Trade.Remember(1, id!.GetValue<string>(), $"A ballad singer sang about Jef, the farm boy, at {S(stage, "label", "the corner")}: \"{S(ballad?["text"], "title")}\".", 3);
    }
    public JsonObject View(int player)
    {
        var b = C.World("ballad:" + Day); var s = Singer(); var singer = s == null ? null : new JsonObject();
        if (singer != null) foreach (string key in new[] { "id", "name", "first", "sex", "age", "kind" }) singer[key] = s![key]?.DeepClone();
        var corners = new JsonArray(); foreach (string id in Corners) if (actions.FindPlace(id) is {} p) corners.Add(new JsonObject { ["id"] = S(p, "id", id), ["label"] = S(p, "label"), ["x"] = N(p, "x"), ["z"] = N(p, "z") });
        return new() { ["day"] = Day, ["price_c"] = 1, ["ballad"] = b == null ? null : new JsonObject { ["title"] = TextFor(player, S(b["text"], "title")), ["verses"] = b["text"]!["verses"]!.DeepClone(), ["chorus"] = b["text"]!["chorus"]!.DeepClone(), ["source"] = S(b, "source") }, ["writing"] = writing.Keys.Any(k => k.StartsWith("ballad:", StringComparison.Ordinal)), ["singer"] = singer, ["singing"] = Singing(), ["have_sheet"] = C.Scalar<int>("SELECT COUNT(*) FROM item WHERE kind='ballad' AND ref=$p0 AND player_id=$p1", Day, player) != 0, ["corners"] = corners };
    }
    public JsonObject Buy(int player) => C.Atomic(() => {
        var b = C.World("ballad:" + Day); if (b == null || S(Singing(), "status") != "running") throw new NativeServiceException("the ballad singer is not selling now", 409);
        if (C.Scalar<int>("SELECT COUNT(*) FROM item WHERE kind='ballad' AND ref=$p0 AND player_id=$p1", Day, player) != 0) throw new NativeServiceException("you have today's sheet already", 409);
        if (C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0", player) < 1) throw new NativeServiceException("not enough money: a sheet is a centime", 409);
        if (C.Scalar<int>("SELECT COUNT(*) FROM item WHERE player_id=$p0", player) >= 6) throw new NativeServiceException("your pockets are full", 409);
        C.Execute("UPDATE player SET money_c=money_c-1 WHERE id=$p0", player); C.Execute("INSERT INTO item(kind,job_id,ref,player_id) VALUES('ballad',NULL,$p0,$p1)", Day, player);
        string title = S(b["text"], "title"); C.Log(player, "bought_ballad", "ballad", $"Jef bought a ballad sheet, \"{title}\", from the ballad singer for 1 centime.");
        return new JsonObject { ["paid_c"] = 1, ["text"] = $"You give {S(Singer(), "first", "the singer")} a centime. He licks his thumb, peels a sheet off the sheaf: \"{title}\". (I to read it.)" };
    });
    public JsonObject Sheet(int player, int day)
    {
        if (C.Scalar<int>("SELECT COUNT(*) FROM item WHERE kind='ballad' AND ref=$p0 AND player_id=$p1", day, player) == 0) throw new NativeServiceException("you have no such sheet", 404);
        var b = C.World("ballad:" + day) ?? throw new NativeServiceException("the print has run: nothing to read", 404);
        return new() { ["day"] = day, ["title"] = S(b["text"], "title"), ["verses"] = b["text"]!["verses"]!.DeepClone(), ["chorus"] = b["text"]!["chorus"]!.DeepClone(), ["weekday"] = new[] { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" }[(day - 1) % 7] };
    }
}
