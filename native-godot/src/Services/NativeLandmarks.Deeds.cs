using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public sealed partial class NativeLandmarks
{
    private string Mine(int player, string key) => player == 1 ? key : key + ":p" + player;
    private double StateNumber(string key, double fallback = 0) => C.World(key) is { } value ? N(value) : fallback;
    private int AbsoluteMinute => Day * 1440 + (int)Math.Round(Hour * 60);
    public bool Barred(int player = 1) => StateNumber(Mine(player, "hush:barred")) > AbsoluteMinute;
    public JsonObject HushToday(int player = 1) => new() { ["strikes"] = StateNumber(Mine(player, "hush:strikes:" + Day)), ["lost"] = StateNumber(Mine(player, "hush:lost:" + Day)) };
    private JsonNode? Profile(int player) => JsonNode.Parse(C.Scalar<string>("SELECT profile_json FROM player_profile WHERE player_id=$p0", player) ?? "null");
    private string Addressed(int player, string text)
    {
        var profile = Profile(player); if (profile == null) return text; bool young = N(profile["age"]) <= 30;
        if (S(profile, "sex") != "woman") return young ? text : Regex.Replace(Regex.Replace(text, @"\byoung man\b", "man"), @"\bYoung man\b", "Man");
        string yw = young ? "young woman" : "woman";
        foreach (var pair in new[] { ("lad", "lass"), ("Lad", "Lass"), ("farm boy", "farm girl"), ("Kempen boy", "Kempen girl"), ("errand boy", "errand girl"), ("young man", yw), ("Young man", char.ToUpperInvariant(yw[0]) + yw[1..]), ("my son", "my daughter"), ("mister", "missus"), ("Mister", "Missus"), ("sir", "missus"), ("Sir", "Missus"), ("a man who", "a woman who"), ("a better man", "a better woman"), ("Listen to him!", "Listen to her!"), ("his own", "her own") }) text = Regex.Replace(text, @"\b" + Regex.Escape(pair.Item1) + (pair.Item1.EndsWith('!') ? "" : @"\b"), pair.Item2);
        return text;
    }
    public JsonObject Candle(int player = 1)
    {
        if (!Open("cathedral", Day, Hour)) throw new NativeServiceException("the cathedral is shut", 409);
        if (C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0", player) < 2) throw new NativeServiceException("not enough money: a candle is 2 centimes", 409);
        C.Atomic(() => { C.Execute("UPDATE player SET money_c=money_c-2 WHERE id=$p0", player); C.Log(player, "lit_candle", "cathedral", "Jef lit a candle at the Lady altar in the cathedral."); });
        return new JsonObject { ["paid_c"] = 2, ["text"] = "You drop 2 centimes in the box, light a candle from another and set it on the iron stand. The small flame leans and settles." };
    }
    public JsonObject Chair(int player = 1)
    {
        var mass = Mass(Day, Hour); var none = new JsonObject { ["paid_c"] = 0, ["text"] = "" }; if (mass == null) return none;
        string key = Mine(player, $"chair:{Day}:{N(mass["from"])}"); if (C.World(key)?.GetValue<bool>() == true) return none; C.SetWorld(key, true);
        if (C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0", player) < 1) { none["text"] = "The chair woman holds out her hand, looks at your coat, and moves on without a word."; return none; }
        C.Execute("UPDATE player SET money_c=money_c-1 WHERE id=$p0", player); return new JsonObject { ["paid_c"] = 1, ["text"] = "The chair woman comes along the row with her bag. You give her 1 centime for the chair." };
    }
    public JsonObject Ran(int player, JsonNode? witnesses)
    {
        var none = new JsonObject { ["counted"] = false, ["strike"] = 0, ["line"] = "", ["speaker"] = "churchgoer", ["delta"] = 0, ["leave"] = false, ["text"] = "" };
        double number = 0;
        if (witnesses is JsonValue v) { if (v.TryGetValue<double>(out var value) && double.IsFinite(value)) number = value; else if (v.TryGetValue<int>(out var integer)) number = integer; else if (v.TryGetValue<long>(out var wide)) number = wide; }
        int count = (int)Math.Clamp(Math.Floor(number), 0, 60);
        if (count < 1 || Inside(player) != "cathedral" || !Open("cathedral", Day, Hour)) return none;
        int now = AbsoluteMinute; string lastKey = Mine(player, "hush:last"); if (now - StateNumber(lastKey, -1e9) < 15) return none; C.SetWorld(lastKey, now);
        string strikesKey = Mine(player, "hush:strikes:" + Day), lostKey = Mine(player, "hush:lost:" + Day); int strike = (int)StateNumber(strikesKey) + 1; C.SetWorld(strikesKey, strike);
        bool mass = Mass(Day, Hour) != null, leave = strike >= 3; int lost = (int)StateNumber(lostKey), step = Math.Max(0, Math.Min(mass || count >= 3 ? 1 : 0, 2 - lost)), delta = 0;
        C.Atomic(() => {
            if (step > 0) { int before = C.Scalar<int>("SELECT trust FROM faction_trust WHERE faction='kerk' AND player_id=$p0", player); C.Execute("UPDATE faction_trust SET trust=MAX(-5,MIN(10,trust-$p0)) WHERE faction='kerk' AND player_id=$p1", step, player); delta = C.Scalar<int>("SELECT trust FROM faction_trust WHERE faction='kerk' AND player_id=$p0", player) - before; if (delta != 0) C.SetWorld(lostKey, lost - delta); }
            if (leave) { C.SetWorld(Mine(player, "hush:barred"), now + 60); C.Log(player, "put_out", "kerk", "The beadle put Jef out of the cathedral for running in the church."); }
            else if (delta != 0) C.Log(player, "ran_in_church", "kerk", mass ? "Jef ran in the cathedral during mass; the beadle hissed at him." : "Jef ran in the cathedral; people hissed at him.");
        });
        var massLines = new[] { ("beadle", "No running in the house of God!"), ("churchgoer", "Shh! There is a mass on!"), ("beadle", "Walk, young man. The Lord is not in a hurry."), ("churchgoer", "Have you no shame? During the mass!") };
        var quietLines = new[] { ("churchgoer", "Shh! Walk! This is a church, not the quay."), ("beadle", "Slowly in here. This is a church."), ("churchgoer", "Mind your feet. People are praying.") }; var second = new[] { ("beadle", "I told you once. Walk, or you go out."), ("beadle", "Again? One more time and you are out of here.") };
        var pool = strike >= 2 ? second : mass ? massLines : quietLines; var hiss = leave ? ("beadle", "That is enough. Out you go, and come back when you can walk like a Christian.") : pool[(strike + (int)N(host.Clock.View()["minute"])) % pool.Length];
        return new JsonObject { ["counted"] = true, ["strike"] = strike, ["line"] = Addressed(player, hiss.Item2), ["speaker"] = hiss.Item1, ["delta"] = delta, ["leave"] = leave, ["text"] = leave ? "The beadle takes you by the elbow, his staff in the other hand, and walks you down the nave and out of the west door. Nobody says a word. The door is shut to you for an hour." : delta != 0 ? "Heads turn along the rows. The church will remember that." : "Heads turn. You slow down." };
    }
    private void RegisterDeeds()
    {
        host.Register("POST", "/api/landmark/candle", r => { var result = Candle(r.PlayerId); host.PublishState(r.PlayerId); return NativeCoreClock.Join(result, host.Payload(r.PlayerId)); });
        host.Register("POST", "/api/landmark/chair", r => { var result = Chair(r.PlayerId); if (N(result["paid_c"]) != 0) host.PublishState(r.PlayerId); return NativeCoreClock.Join(result, host.Payload(r.PlayerId)); });
        host.Register("POST", "/api/landmark/ran", r => { var result = Ran(r.PlayerId, r.Body["witnesses"]); if (N(result["delta"]) != 0) host.PublishState(r.PlayerId); return NativeCoreClock.Join(result, host.Payload(r.PlayerId)); });
    }
}
