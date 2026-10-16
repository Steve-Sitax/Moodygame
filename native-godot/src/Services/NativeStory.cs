using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>
/// The Antigoon story for the single player: one entry beside the three wage jobs, one current objective, and the
/// clues kept as journal facts so a lost prop never loses what Jef learned. Chapter 1, the missing lamplighter: the
/// last two lamps of the west round are Pieter's, and they stay dark until Jef lights them with the lamplighter's
/// loaned pole. Pieter's bent ladder and route book lie at the last one. Jef reports to the round's lamplighter
/// (Lowie in the draft), or leaves a note under his door when he is home. Lamps pay the ordinary lamp rate.
/// Multiplayer has no story: the view is empty and the routes refuse.
/// </summary>
public sealed partial class NativeStory : INativeServiceModule
{
    private const string Key = "story:antigoon";
    private const int Solo = 1;
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private JsonObject? cache;
    private bool cached;
    /// <summary>A resident's record by id (the town's own).</summary>
    public Func<string, JsonObject?> Resident = _ => null;
    /// <summary>What a resident is doing now by his schedule: "home", "work", "tavern"...</summary>
    public Func<string, string> Doing = _ => "";
    /// <summary>The nearest open walking ground within a radius, for the props at Pieter's last stop.</summary>
    public Func<double, double, double, (double X, double Z)?> Open = (x, z, _) => (x, z);
    /// <summary>Words for where a point lies ("down by the river"), for the lamplighter's directions.</summary>
    public Func<double, double, string> Where = (_, _) => "at the end of my round";
    public NativeStory(NativeServiceHost host) => this.host = host;
    private static JsonArray A(JsonNode? n) => n as JsonArray ?? new();
    private static double N(JsonNode? n, string key) => NativeGoods.Number(n?[key]);
    private static string S(JsonNode? n, string key) => NativeGoods.S(n, key);
    private static bool B(JsonNode? n, string key) => NativeGoods.B(n, key);
    private JsonObject Clock => host.Clock.View();
    private int Day => (int)N(Clock, "day");
    private double Hour => N(Clock, "hour") + N(Clock, "minute") / 60;
    private double Absolute => (Day - 1) * 24 + Hour;
    private bool Single => !host.MultiplayerEnabled();
    private static string Time(double h) => NativeLampJobs.Time(h);

    // ------------------------------------------------------------------ state

    private JsonObject? State
    {
        get
        {
            if (!cached) { cache = C.PlayerState(Solo, Key) as JsonObject; cached = true; }
            if (cache == null && Bind() is { } made) { Save(made); }
            return cache;
        }
    }
    private void Save(JsonObject state) { C.SetPlayerState(Solo, Key, state); cache = state; cached = true; }
    private void Forget() { cache = null; cached = false; }
    private JsonObject? Round(JsonObject s) => A(C.World("townlife_lamps")?["rounds"]).FirstOrDefault(r => S(r, "id") == S(s, "round")) as JsonObject;
    private string First(JsonObject s) => S(Resident(S(s, "lowie")), "first") is { Length: > 0 } f ? f : "the lamplighter";
    private string Lowie(JsonObject s) => S(Resident(S(s, "lowie")), "name") is { Length: > 0 } n ? n : First(s);
    private static string Helper(JsonObject s) => S(s, "helper");
    private static bool Inspected(JsonObject s) => B(s["clues"], "ladder") && B(s["clues"], "book");

    /// <summary>
    /// Chapter 1 bound to this town: the west round (or the first long enough), its lamplighter, its last two lamps,
    /// and the ladder and book at the last one. Null until the town has its lamp rounds and residents.
    /// </summary>
    private JsonObject? Bind()
    {
        var rounds = A(C.World("townlife_lamps")?["rounds"]);
        var round = (rounds.FirstOrDefault(r => S(r, "id") == "west" && A(r?["lamps"]).Count >= 3) ?? rounds.FirstOrDefault(r => A(r?["lamps"]).Count >= 3)) as JsonObject;
        if (round == null || Resident(S(round, "lamplighter")) is not { } lowie) return null;
        var lamps = A(round["lamps"]); var at = A(round["at"]); int n = lamps.Count;
        var mine = new JsonArray();
        for (int i = n - 2; i < n; i++)
        {
            var l = lamps[i]!;
            mine.Add(new JsonObject { ["id"] = S(l, "id"), ["i"] = i, ["x"] = N(l, "x"), ["z"] = N(l, "z"), ["sx"] = N(l, "sx"), ["sz"] = N(l, "sz"), ["lit"] = false });
        }
        var last = mine[1]!;
        double lx = N(last, "x"), lz = N(last, "z"), sx = N(last, "sx"), sz = N(last, "sz"), dx = sx - lx, dz = sz - lz, len = Math.Max(.01, Math.Sqrt(dx * dx + dz * dz));
        dx /= len; dz /= len;
        // The ladder lies along the kerb beside the lamp's foot, the book a stride the other way, both on open ground.
        var ladder = Open(sx - dz * 1.2 + dx * .5, sz + dx * 1.2 + dz * .5, 2) ?? (sx - dz * 1.2, sz + dx * 1.2);
        var book = Open(sx + dz * .9 + dx * .6, sz - dx * .9 + dz * .6, 2) ?? (sx + dz * .9, sz - dx * .9);
        double walk = NativeGoods.Number(at[n - 1]) - NativeGoods.Number(at[n - 2]);
        return new JsonObject
        {
            ["v"] = 1, ["chapter"] = 1, ["status"] = "offered", ["round"] = S(round, "id"), ["lowie"] = S(lowie, "id"),
            // The draft's missing man is Pieter; a lamplighter of that name would make it ambiguous.
            ["helper"] = S(lowie, "first") == "Pieter" ? "Staf" : "Pieter",
            ["lamps"] = mine, ["walk"] = Math.Round(walk, 1), ["open"] = Math.Ceiling(N(round, "dusk") * 60 - 1e-6) / 60,
            ["ladder"] = new JsonObject { ["x"] = ladder.X, ["z"] = ladder.Z, ["yaw"] = Math.Atan2(-dz, dx) },
            ["book"] = new JsonObject { ["x"] = book.X, ["z"] = book.Z, ["yaw"] = Math.Atan2(dx, dz) + .5, ["taken"] = false },
            ["clues"] = new JsonObject(), ["witness"] = new JsonObject(), ["facts"] = new JsonArray(),
        };
    }

    private void Fact(JsonObject s, string id, string kind, string text)
    {
        var facts = A(s["facts"]); if (facts.Any(f => S(f, "id") == id)) return;
        facts.Add(new JsonObject { ["id"] = id, ["kind"] = kind, ["day"] = Day, ["at"] = Time(Hour), ["text"] = text });
        s["facts"] = facts;
    }
    private JsonObject Active(int who)
    {
        if (!Single || who != Solo) throw new NativeServiceException("The story is played alone; it waits while the town is shared.", 409);
        var s = State ?? throw new NativeServiceException("The story has not begun in this town.", 409);
        if (S(s, "status") != "active") throw new NativeServiceException(S(s, "status") == "offered" ? $"Talk to {First(s)} first." : "That part of the story is done.", 409);
        return s;
    }
    private static bool Within(double x, double z, double px, double pz, double r) => (x - px) * (x - px) + (z - pz) * (z - pz) <= r * r;

    // ------------------------------------------------------------------ the lamps

    /// <summary>Pieter's lamps that stay dark tonight: the chapter is under way and Jef has not lit them.</summary>
    public IEnumerable<string> Dark()
    {
        var s = Single ? State : null; if (s == null || S(s, "status") != "active") yield break;
        foreach (var l in A(s["lamps"])) if (!B(l, "lit")) yield return S(l, "id");
    }
    /// <summary>Pieter's lamps that Jef lit, burning until the next dawn round puts them out.</summary>
    public IEnumerable<string> Lit()
    {
        var s = Single ? State : null; if (s == null) yield break;
        foreach (var l in A(s["lamps"])) if (B(l, "lit") && Absolute < N(l, "until")) yield return S(l, "id");
    }
    /// <summary>The lamp held back for the story: the lamplighter's own walk stops before it.</summary>
    public int? Cut(string round)
    {
        var s = Single ? State : null;
        return s != null && S(s, "status") == "active" && S(s, "round") == round ? (int)A(s["lamps"]).Min(l => N(l, "i")) : null;
    }
    private bool LampTime(JsonObject s) => Hour >= N(s, "open") || Hour < 5 || NativeStreetLighting.FogAt(host.Clock.FogView(), Hour);
    public JsonObject Light(int who, string lamp, double x, double z)
    {
        var s = Active(who);
        var l = A(s["lamps"]).FirstOrDefault(l => S(l, "id") == lamp) as JsonObject ?? throw new NativeServiceException($"That is not one of {Helper(s)}'s lamps.", 404);
        if (B(l, "lit")) return new JsonObject { ["text"] = "That one burns already." };
        if (!Within(x, z, N(l, "sx"), N(l, "sz"), 3.2)) throw new NativeServiceException("You cannot reach that lamp from here.", 409);
        if (!LampTime(s)) throw new NativeServiceException($"Too early: the lamps are lit from {Time(N(s, "open"))}, when the light goes.", 409);
        // It burns until the dawn round: 5:00 next morning, or this morning when lit after midnight.
        l["lit"] = true; l["until"] = (Day - 1) * 24 + (Hour < 5 ? 5 : 29);
        int left = A(s["lamps"]).Count(q => !B(q, "lit"));
        Fact(s, "lamp:" + lamp, "work", left == 0 ? $"Lit the last of {Helper(s)}'s lamps." : $"Lit one of {Helper(s)}'s two dark lamps.");
        C.Atomic(() => { Save(s); C.Log(who, "lit_lamp", lamp, $"Jef lit a street lamp ({lamp}) that {Helper(s)} never lit, on {Lowie(s)}'s round."); });
        host.PublishState(who);
        return new JsonObject { ["text"] = left == 0 ? $"The gas catches. Both of {Helper(s)}'s lamps are burning." : "The gas catches. One more." };
    }

    // ------------------------------------------------------------------ the last stop

    public JsonObject Inspect(int who, string what, double x, double z)
    {
        var s = Active(who); var clues = s["clues"]!.AsObject(); string helper = Helper(s);
        JsonObject result;
        if (what == "ladder")
        {
            if (!Within(x, z, N(s["ladder"], "x"), N(s["ladder"], "z"), 2.6)) throw new NativeServiceException("The ladder is not here.", 409);
            clues["ladder"] = true;
            Fact(s, "ladder", "evidence", $"{helper}'s ladder lies by the last lamp of the round. One rail is bent near the top, as if something heavy came down on it. It did not bend by falling.");
            result = new JsonObject { ["text"] = $"{helper}'s ladder. The top half of one rail is bent right over, and two rungs are split. A ladder does not do that by falling." };
        }
        else if (what == "book")
        {
            if (B(s["book"], "taken")) return new JsonObject { ["text"] = "You have the book already." };
            if (!Within(x, z, N(s["book"], "x"), N(s["book"], "z"), 2.4)) throw new NativeServiceException("The book is not here.", 409);
            clues["book"] = true; s["book"]!["taken"] = true;
            Fact(s, "book", "evidence", $"{helper}'s route book was lying open on the stones. The last line, in a shaking hand: \"Something standing in the outlet. Taller than\" and nothing after. On the page before: the fishwife on the quay saw it first.");
            result = new JsonObject { ["text"] = $"You pick up {helper}'s route book and put it in your coat.", ["paper"] = new JsonObject { ["title"] = $"{helper}'s route book", ["text"] = BookText(s) } };
        }
        else throw new NativeServiceException("Nothing like that here.", 404);
        if (Inspected(s)) Fact(s, "next:report", "lead", $"Tell {First(s)} what you found. If he is asleep, a note under his door will do.");
        C.Atomic(() => { Save(s); C.Log(who, "story_clue", what, $"Jef looked over {helper}'s last stop on {Lowie(s)}'s round: the {what}."); });
        host.PublishState(who);
        return result;
    }
    private string BookText(JsonObject s)
    {
        string first = First(s);
        return $"A lamplighter's route book in oilcloth, the pencil tied to it with string.\n\nThe round's lamps are ticked in columns, night after night, in a careful hand: the stretch {first} gives him at the end of the west round, the last two lamps to the river.\n\n"
            + "Three nights back, beside the last lamp: \"Glass cracked. Bring the ladder.\"\n\n"
            + "On the next page: \"Fishwife on the quay says she saw it first. Laughed at her.\"\n\n"
            + "The last line runs off the page, pressed so hard the pencil tore it: \"Something standing in the outlet. Taller than\"";
    }

    // ------------------------------------------------------------------ reporting

    /// <summary>What Jef may truthfully tell the lamplighter, by what he found, saw and heard.</summary>
    private IEnumerable<string> Reports(JsonObject s)
    {
        yield return FoundReport;
        if (B(s["witness"], "figure")) yield return SeenReport;
        else if (B(s["witness"], "scrape") || B(s["witness"], "steps")) yield return HeardReport;
    }
    private const string FoundReport = "I found his ladder bent at the last lamp, and his book on the stones.";
    private const string SeenReport = "Something crossed the street ahead of me in the dark. Taller than the doors.";
    private const string HeardReport = "Something heavy scraped the stones out there, then walked off towards the river.";
    private int Pay(JsonObject s)
    {
        int lit = A(s["lamps"]).Count(l => B(l, "lit"));
        return lit == 0 ? 0 : NativeLampJobs.Pay(lit, lit == A(s["lamps"]).Count ? N(s, "walk") : 0);
    }
    private string PayWords(JsonObject s, int pay)
    {
        int lit = A(s["lamps"]).Count(l => B(l, "lit"));
        return lit == A(s["lamps"]).Count ? $"Both of his lamps burning. {pay} centimes, my rate for them." : lit > 0 ? $"One of the two lit. {pay} centimes for that one; I'll do the other myself." : "I'll light his lamps myself tonight.";
    }
    /// <summary>Close chapter 1: pay once, return the pole, remember it, and write the next lead.</summary>
    private void Close(int who, JsonObject s, string how, int pay)
    {
        string lowie = S(s, "lowie"), helper = Helper(s);
        s["status"] = "done"; s["report"] = how; s["closed_day"] = Day;
        if (how == "door") s["owed_c"] = pay; else s["paid_c"] = pay;
        Fact(s, "next:fishwife", "lead", $"{helper}'s book says a fishwife on the quay saw it first. Ask on the quay.");
        C.Atomic(() =>
        {
            if (how != "door" && pay > 0) C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1", pay, who);
            Save(s);
            C.Log(who, "story_chapter", "antigoon:1", $"Jef told {Lowie(s)} what he found at {helper}'s last lamp: the bent ladder and the route book{(how == "door" ? ", in a note under his door" : "")}.");
        });
        host.Rumours.ApplyTrust(lowie, who, 1, 0);
        host.Trade.Remember(who, lowie, $"Jef, the new man, finished {helper}'s lamps for me and found his ladder bent at the last one. {helper} has not come home.", 6, $"Jef went looking for {helper} on the lamp round", 1);
        host.PublishState(who);
    }
    public JsonObject Door(int who, double x, double z)
    {
        var s = Active(who);
        if (!Inspected(s)) throw new NativeServiceException($"Look over {Helper(s)}'s last stop first.", 409);
        var home = Resident(S(s, "lowie"))?["home"];
        if (home == null || !Within(x, z, N(home, "sx"), N(home, "sz"), 3.5)) throw new NativeServiceException($"This is not {First(s)}'s door.", 409);
        if (Doing(S(s, "lowie")) != "home") throw new NativeServiceException($"{First(s)} is not at home. Find him on his round.", 409);
        int pay = Pay(s); Close(who, s, "door", pay);
        return new JsonObject { ["text"] = $"You lean the pole by {First(s)}'s door and push a note under it: which lamps you lit, the bent ladder, the book in your coat." };
    }
    /// <summary>The lamplighter reads the note at his door: the pay is his to give, once.</summary>
    private string? PayOwed(int who, JsonObject s)
    {
        int owed = (int)N(s, "owed_c"); if (S(s, "report") != "door" || s["paid_c"] != null) return null;
        s["paid_c"] = owed; s.Remove("owed_c");
        C.Atomic(() => { if (owed > 0) C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1", owed, who); Save(s); });
        host.PublishState(who);
        return owed > 0 ? $"I found your note under the door. Here: {owed} centimes for {Helper(s)}'s lamps." : $"I found your note under the door. I lit {Helper(s)}'s lamps myself after.";
    }

    // ------------------------------------------------------------------ the sighting (Antigoon's staged crossing)

    /// <summary>The authored junction of the chapter's sighting: a dark, quiet crossing on the way (null: none chosen yet).</summary>
    /// Chosen 2026-10-16 from the candidates of scripts/antigoon-story-map.ps1: the mouth of the narrow lane behind
    /// the Werf quay houses, washing lines overhead, the street beyond it lamplit. The lane is too narrow for him.
    public AntigoonBrain.Point? Junction = new(-308, 48);
    /// <summary>Where the chapter's one sighting may play now, and where he walks off to: after dark, not in fog, once.</summary>
    public (AntigoonBrain.Point Junction, AntigoonBrain.Point Goal)? SightingWanted(int who)
    {
        var s = Single && who == Solo ? State : null;
        if (Junction is not { } junction || s == null || S(s, "status") != "active" || B(s["witness"], "staged")) return null;
        if (!(Hour >= 18 || Hour < 6) || NativeStreetLighting.FogAt(host.Clock.FogView(), Hour)) return null;
        var last = A(s["lamps"])[^1]!; return (junction, new(N(last, "x"), N(last, "z")));
    }
    /// <summary>The encounter reports what happened: "staged", then "scrape", "figure", "steps" as Jef met them.</summary>
    public void Witness(int who, string what)
    {
        var s = Single && who == Solo ? State : null; if (s == null || S(s, "status") != "active") return;
        var w = s["witness"]!.AsObject(); if (B(w, what)) return;
        w[what] = true;
        if (what == "scrape") Fact(s, "heard:scrape", "sound", "A long scrape of stone on stone somewhere ahead in the dark, as if something heavy brushed a wall.");
        else if (what == "figure") Fact(s, "seen:figure", "sight", "A figure crossed the junction ahead, lit by nothing. Its head was up at the first-floor windows. It went behind the far houses without looking round.");
        else if (what == "steps") Fact(s, "heard:steps", "sound", "Slow, heavy footsteps going away towards the river, long after it was out of sight.");
        Save(s);
        if (what != "staged") host.PublishState(who);
    }

    // ------------------------------------------------------------------ the view

    private JsonObject? View(int who)
    {
        var s = Single && who == Solo ? State : null; if (s == null) return null;
        string status = S(s, "status"), first = First(s), helper = Helper(s);
        var lamps = A(s["lamps"]); int lit = lamps.Count(l => B(l, "lit"));
        var steps = new JsonArray();
        void Step(string text, bool done) => steps.Add(new JsonObject { ["text"] = text, ["done"] = done });
        JsonObject? goal = null; string objective;
        var home = Resident(S(s, "lowie"))?["home"];
        if (status == "offered")
        {
            objective = $"{first}, the lamplighter of the west round, is asking after his helper {helper}. Talk to him.";
            goal = new JsonObject { ["kind"] = "person", ["id"] = S(s, "lowie"), ["label"] = Lowie(s) };
        }
        else if (status == "active")
        {
            bool time = LampTime(s);
            Step(time || lit > 0 ? $"Light {helper}'s two dark lamps ({lit} of {lamps.Count})" : $"Light {helper}'s two dark lamps, from {Time(N(s, "open"))}", lit == lamps.Count);
            Step($"Look over {helper}'s last stop: the ladder and the book", Inspected(s));
            Step($"Tell {first} what you found", false);
            var next = lamps.FirstOrDefault(l => !B(l, "lit"));
            if (time && next != null) { objective = $"Light {helper}'s lamps."; goal = new JsonObject { ["kind"] = "spot", ["x"] = N(next, "sx"), ["z"] = N(next, "sz"), ["label"] = lit == 0 ? $"{helper}'s first dark lamp" : $"{helper}'s last lamp" }; }
            else if (!Inspected(s)) { objective = $"Look over {helper}'s last stop."; goal = new JsonObject { ["kind"] = "spot", ["x"] = N(s["ladder"], "x"), ["z"] = N(s["ladder"], "z"), ["label"] = $"{helper}'s last stop" }; }
            else
            {
                bool asleep = Doing(S(s, "lowie")) == "home" && home != null;
                objective = asleep ? $"{first} is at home. Talk to him, or push a note under his door." : $"Tell {first} what you found.";
                goal = asleep ? new JsonObject { ["kind"] = "spot", ["x"] = N(home, "sx"), ["z"] = N(home, "sz"), ["label"] = $"{first}'s door" } : new JsonObject { ["kind"] = "person", ["id"] = S(s, "lowie"), ["label"] = Lowie(s) };
            }
        }
        else objective = $"Chapter 1 is done. {helper}'s book says a fishwife on the quay saw it first. (The next chapter is not in the game yet.)";
        return new JsonObject
        {
            ["chapter"] = N(s, "chapter"), ["title"] = "The Missing Lamplighter", ["status"] = status, ["objective"] = objective, ["steps"] = steps, ["goal"] = goal,
            ["lowie"] = S(s, "lowie"), ["lowie_name"] = Lowie(s), ["helper"] = helper, ["round"] = S(s, "round"), ["open"] = N(s, "open"), ["lamp_time"] = LampTime(s),
            ["lamps"] = new JsonArray(lamps.Select(l => (JsonNode)new JsonObject { ["id"] = S(l, "id"), ["x"] = N(l, "x"), ["z"] = N(l, "z"), ["sx"] = N(l, "sx"), ["sz"] = N(l, "sz"), ["lit"] = B(l, "lit"), ["until"] = N(l, "until") }).ToArray()),
            ["ladder"] = s["ladder"]!.DeepClone(), ["book"] = s["book"]!.DeepClone(),
            ["door"] = home == null ? null : new JsonObject { ["x"] = N(home, "sx"), ["z"] = N(home, "sz") },
            ["inspected"] = Inspected(s), ["facts"] = s["facts"]!.DeepClone(), ["owed_c"] = N(s, "owed_c"), ["paid_c"] = N(s, "paid_c"),
        };
    }

    private static double Position(NativeServiceRequest r, string field)
    {
        if (r.Body[field] is not JsonValue value || !value.TryGetValue<double>(out var n) || !double.IsFinite(n)) throw new NativeServiceException("bad position", 400);
        return n;
    }
    private JsonObject WithPayload(int who, JsonObject result) { foreach (var p in host.Payload(who)) result[p.Key] = p.Value?.DeepClone(); return result; }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET", "/api/story", r => new JsonObject { ["story"] = View(r.PlayerId) });
        service.Register("POST", "/api/story/light", r => WithPayload(r.PlayerId, Light(r.PlayerId, r.Text("lamp"), Position(r, "x"), Position(r, "z"))));
        service.Register("POST", "/api/story/inspect", r => WithPayload(r.PlayerId, Inspect(r.PlayerId, r.Text("what"), Position(r, "x"), Position(r, "z"))));
        service.Register("POST", "/api/story/door", r => WithPayload(r.PlayerId, Door(r.PlayerId, Position(r, "x"), Position(r, "z"))));
        // Proof aid: start the chapter again from the lamplighter's offer, or take it up as if he had been asked.
        service.Register("POST", "/api/dev/story", r =>
        {
            if (r.PlayerId != Solo) throw new NativeServiceException("Only the host changes the story.", 403);
            C.Execute("DELETE FROM player_state WHERE player_id=$p0 AND key=$p1", Solo, Key); Forget();
            var s = State ?? throw new NativeServiceException("The town has no lamp rounds yet.", 409);
            if (r.Text("status") == "active") { s["status"] = "active"; Save(s); }
            host.PublishState(r.PlayerId);
            return new JsonObject { ["story"] = View(r.PlayerId) };
        });
        service.PayloadParts.Add(who => new JsonObject { ["story"] = View(who) });
        service.NewGame += Forget; service.Loaded += Forget;
    }
}
