using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Port of server day.ts and warmth.ts hourly numbers, gates and per-player limits.</summary>
public sealed partial class NativeCoreClock : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private long lastTick;
    private readonly Dictionary<int, long> swims = new();
    private readonly Dictionary<int, (string? at, bool lantern, long ms)> reports = new();
    private static readonly string[] Days = { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" };
    public NativeCoreClock(NativeServiceHost host) => this.host = host;
    public void ResetLimits() { lastTick = 0; swims.Clear(); reports.Clear(); }
    public JsonObject View()
    {
        var clock = C.World("clock")as JsonObject;
        static bool Valid(JsonObject? c,string key,int min,int max)=>c?[key]is JsonValue v&&v.TryGetValue<double>(out var n)&&double.IsFinite(n)&&n==Math.Floor(n)&&n>=min&&n<=max;
        if(!Valid(clock,"day",1,9999)||!Valid(clock,"hour",0,23)||!Valid(clock,"minute",0,59)){
            clock=C.One("SELECT day,hour,minute FROM player WHERE id=1")??new JsonObject{["day"]=1,["hour"]=6,["minute"]=0};
            C.SetWorld("clock",clock);
        }
        clock ??= new JsonObject{["day"]=1,["hour"]=6,["minute"]=0};
        clock["weekday"] = Days[(Number(clock, "day") - 1) % 7];
        clock["weather"] = C.World("weather")?.GetValue<string>() ?? "fog";
        return clock;
    }
    public JsonObject FogView()
    {
        int day = Number(View(), "day");
        if (C.World("fog_day") is JsonObject fog && Number(fog, "day") == day) return fog;
        return new JsonObject { ["day"] = day, ["start"] = View()["weather"]!.GetValue<string>() == "fog", ["turns"] = new JsonArray() };
    }
    public void SetWeather(string weather, double? at = null)
    {
        if (weather is not ("fog" or "mist" or "clear" or "rain" or "storm")) throw new NativeServiceException("bad weather");
        var fog = FogView();
        if (at == null) { fog["start"] = weather == "fog"; fog["turns"] = new JsonArray(); }
        else {
            var turns = fog["turns"]!.AsArray();
            bool previous = turns.Count == 0 ? fog["start"]!.GetValue<bool>() : turns.Last()!["fog"]!.GetValue<bool>();
            if (previous != (weather == "fog")) turns.Add(new JsonObject { ["h"] = Math.Clamp(at.Value, 0, 24), ["fog"] = weather == "fog" });
            while (turns.Count > 8) turns.RemoveAt(0);
        }
        C.SetWorld("fog_day", fog); C.SetWorld("weather", weather);
    }
    public bool RentPaid(int id) => C.Scalar<long>("SELECT rent_paid_until FROM player WHERE id=$p0", id) >= 7;
    public int MinuteNow() { var c = View(); return Number(c, "day") * 1440 + Number(c, "hour") * 60 + Number(c, "minute"); }
    public int GameMinute() => MinuteNow()-1440;
    public void SetTime(int day, int hour, int minute) => C.Atomic(()=>{C.SetWorld("clock",new JsonObject{["day"]=day,["hour"]=hour,["minute"]=minute});C.Execute("UPDATE player SET day=$p0,hour=$p1,minute=$p2 WHERE id=1", day, hour, minute);});
    public JsonObject End(int id, string kind)
    {
        var ending = new JsonObject { ["kind"] = kind, ["day"] = Number(View(), "day"), ["epilogue"] = C.Rules["epilogues"]?[kind]?.DeepClone() };
        C.SetPlayerState(id, "ending", ending);
        C.Log(id, kind == "health" ? "collapsed" : "week_over", null, kind == "health" ? "Jef's body gave out." : "The week is over.");
        return ending;
    }
    public JsonObject Where(int id)
    {
        var outside = new JsonObject { ["shelter"] = "outside", ["place"] = null, ["label"] = "outside", ["lantern"] = false };
        if (!reports.TryGetValue(id, out var report) || C.Now - report.ms > 25000 || C.Now < report.ms - 1000) return outside;
        var room = report.at == null ? null : host.ResolveRoom?.Invoke(id, report.at);
        int hourNow = Number(View(), "hour");
        if (room != null) { room["lantern"] = false; room["warming"] = Warming(id); room["fires"] = BasketsLit(hourNow); return room; }
        outside["warming"] = Warming(id); outside["fires"] = BasketsLit(hourNow);
        string weather = View()["weather"]!.GetValue<string>();
        int? swam = C.PlayerState(id, "swam_at")?.GetValue<int>();
        bool wet = weather is "rain" or "storm" || swam != null && MinuteNow() - swam < 120;
        outside["lantern"] = report.lantern && !wet && C.Scalar<long>("SELECT COUNT(*) FROM item WHERE kind='lantern' AND player_id=$p0", id) > 0;
        return outside;
    }
    public bool ApplyHour(int id, int hour)
    {
        var player = host.Player(id);
        int food = Number(player, "food"), warmth = Number(player, "warmth"), sleep = Number(player, "sleep"), health = Number(player, "health");
        if (hour % 6 == 0) food--;
        if (hour % 3 == 0) sleep--;
        food -= host.RowFood?.Invoke(id, hour) ?? 0;
        bool cold = hour >= 20 || hour < 7;
        var at = Where(id);
        string shelter = at["shelter"]!.GetValue<string>();
        (int? chill, int? gain, int cap) rule = host.TransportWarmth?.Invoke(id, cold) ??
            (shelter == "heated" ? (null, 2, 7) : shelter == "sheltered" ? (cold ? 6 : 10, null, 10) :
             at["lantern"]!.GetValue<bool>() ? (cold ? 4 : 6, null, 10) : (cold ? 3 : 5, null, 10));
        var (heatGain, noChill) = TakeHeat(id);
        if (rule.chill != null && hour % rule.chill == 0 && !noChill) warmth--;
        if (rule.gain != null && hour % rule.gain == 0 && warmth < rule.cap) warmth++;
        else if (heatGain > 0 && warmth < HeatCap) warmth += heatGain;
        food = Math.Clamp(food, 0, 10); warmth = Math.Clamp(warmth, 0, 10); sleep = Math.Clamp(sleep, 0, 10);
        if (food == 0 || warmth == 0 || sleep == 0) { if (hour % 3 == 0) health--; }
        else if (food >= 4 && warmth >= 4 && sleep >= 4 && hour % 4 == 0) health++;
        health = Math.Clamp(health, 0, 10);
        C.Execute("UPDATE player SET food=$p0,warmth=$p1,sleep=$p2,health=$p3 WHERE id=$p4", food, warmth, sleep, health, id);
        return health == 0;
    }
    public JsonObject TurnDay(int id)
    {
        int day = Number(View(), "day"); var lines = new JsonArray(); var ids=host.OnlinePlayers().Distinct().Where(p=>C.Scalar<int>("SELECT COUNT(*) FROM player WHERE id=$p0",p)>0).ToArray();
        dayLines.Clear();
        C.Atomic(() => {
            foreach (var hook in host.MidnightHooks) hook(day);
            foreach(var hook in host.MidnightLines)foreach(var line in hook(day))lines.Add(line?.DeepClone());
            foreach(int player in ids)host.ForPlayer(player,()=>{
                var own=new JsonArray();
                foreach(var hook in host.PlayerMidnightHooks)hook(player,day);
                foreach(var hook in host.PlayerMidnightLines)foreach(var line in hook(player,day))own.Add(line?.DeepClone());
                dayLines[player]=own;
            });
            C.Execute("UPDATE npc_memory SET weight=MAX(1,weight-1)"); C.Execute("UPDATE world_fact SET weight=MAX(1,weight-1)");
            C.Execute("DELETE FROM npc_memory WHERE weight=1 AND day<=$p0", day - 3); C.Execute("DELETE FROM world_fact WHERE weight=1 AND day<=$p0", day - 3);
            for(int round=0;round<3;round++)host.RumourRound?.Invoke(Number(View(),"hour"));
        });
        commonDayLines=lines.DeepClone().AsArray();if(dayLines.TryGetValue(id,out var mine))foreach(var line in mine)lines.Add(line?.DeepClone());
        var turn = new JsonObject { ["day"] = day, ["lines"] = lines };
        if (day >= 7) { foreach(int player in ids)host.ForPlayer(player,()=>{if(player==id||C.PlayerState(player,"ending")==null)End(player,"week");});turn["ended"] = C.PlayerState(id,"ending")?.DeepClone()??host.ForPlayer(id,()=>End(id,"week"));return turn; }
        SetTime(day + 1, 0, 0); turn["day"] = day + 1;
        foreach(int player in ids)C.SetPlayerState(player,"day_start_money",Number(host.Player(player),"money_c"));
        double roll = C.Roll(); SetWeather(roll < .35 ? "fog" : roll < .65 ? "mist" : roll < .83 ? "clear" : roll < .95 ? "rain" : "storm");
        host.Jobs.MakeBoard();
        return turn;
    }
    public JsonObject Tick(NativeServiceRequest request)
    {
        var result = new JsonObject { ["advanced"] = false };
        int id = request.PlayerId;
        ReportPresence(request);
        if(host.MultiplayerEnabled())return Heartbeat(request);
        if (C.PlayerState(id, "ending") != null || host.Saves.Paused || host.Saves.Busy) { if (host.Saves.Paused) result["paused"] = true; return Join(result, host.Payload(id)); }
        var rest = host.Rest.Step(request);
        if (rest != null) { if (rest["advanced"]?.GetValue<bool>() == true) { foreach(var hook in host.TickHooks)hook(request,true);foreach(var hook in host.PlayerTickHooks)hook(request,true);host.PublishState(id); } return Join(rest,host.Payload(id)); }
        if (C.Now - lastTick < 9000) return Join(result, host.Payload(id));
        lastTick = C.Now;
        var clock = View(); int day = Number(clock, "day"), hour = Number(clock, "hour"), minute = Number(clock, "minute") + 5;
        result["advanced"] = true;
        if (minute >= 60) {
            minute -= 60; hour++;
            if (hour >= 24) { var turned = TurnDay(id); result["turned"] = turned; if (turned["ended"] != null) { result["ended"] = turned["ended"]!.DeepClone(); return Join(result, host.Payload(id)); } hour = 0; day = Number(View(), "day"); }
            SetTime(day, hour, minute);
            host.RumourRound?.Invoke(hour);foreach(var hook in host.HourHooks)hook(hour);
            if (ApplyHour(id, hour)) result["ended"] = End(id, "health");
            else if (Number(host.Player(id), "sleep") <= 0) result["night"] = CollapseSleep(id);
        } else SetTime(day, hour, minute);
        foreach (var hook in host.TickHooks) hook(request, true);
        foreach (var hook in host.PlayerTickHooks) hook(request, true);
        host.PublishState(id); result["where"] = Where(id);
        return Join(result, host.Payload(id));
    }
    public void ReportPresence(NativeServiceRequest request)
    {
        int id=request.PlayerId;
        var where = request.Body["where"] as JsonObject;
        string? at = where?["at"] is JsonValue value && value.TryGetValue<string>(out var text) && text.Length <= 80 && Regex.IsMatch(text, "^[a-z0-9_:-]+$", RegexOptions.IgnoreCase) ? text : null;
        reports[id] = (at, where?["lantern"]is JsonValue lamp&&lamp.TryGetValue<bool>(out bool on)&&on, C.Now);
        host.Rest.ReportPosition(id, request.Body["pos"]);
        AddHeat(id);
        foreach(var hook in host.PresenceHooks)hook(request);
    }
    public JsonObject CollapseSleep(int id)
    {
        var player = host.Player(id); var start = View();
        int minutes = (int)Math.Floor((420 + (10 - Number(player, "sleep")) * 6) / 5.0 + .5) * 5;
        C.Execute("UPDATE player SET sleep=6,food=MAX(0,food-2),warmth=MAX(0,warmth-3),health=MAX(0,health-2) WHERE id=$p0", id);
        C.Log(id, "collapsed_asleep", null, "Jef dropped from tiredness in the street and slept where he fell.");
        C.SetPlayerState(id, "nights_slept", (C.PlayerState(id, "nights_slept")?.GetValue<int>() ?? 0) + 1);
        foreach(var hook in host.SleepEndedHooks)hook(id);
        bool turned = false; JsonObject? ending = null;
        int left = minutes;
        while (left > 0) { var c = View(); int toMidnight = (24 - Number(c, "hour")) * 60 - Number(c, "minute");
            if (left < toMidnight) { int t = Number(c, "hour") * 60 + Number(c, "minute") + left; SetTime(Number(c, "day"), t / 60, t % 60); break; }
            left -= toMidnight; var turn = TurnDay(id); turned = true; if (turn["ended"] is JsonObject e) { ending = e; break; }
        }
        if (Number(host.Player(id), "health") == 0) ending ??= End(id, "health");
        var wake = View(); wake.Remove("weather");
        var result = new JsonObject { ["where"] = "rough", ["turnedAway"] = false, ["collapsed"] = true,
            ["day"] = Number(wake, "day"), ["slept_min"] = minutes, ["wake"] = wake, ["turned"] = turned,
            ["summary"] = new JsonArray($"At {Number(start, "hour")}:{Number(start, "minute"):00} your legs give way. You sleep where you drop.", "You sleep on the cold stones in your coat, and the damp gets into your bones.") };
        if (ending != null) result["ended"] = ending.DeepClone();
        return result;
    }
    public JsonObject PassTime(int id,int minutes)
    {
        int left=Math.Max(0,minutes);var result=new JsonObject{["lines"]=new JsonArray(),["turned"]=false};
        if(host.MultiplayerEnabled())return result;
        while(left>0){var c=View();int toMidnight=(24-Number(c,"hour"))*60-Number(c,"minute");
            if(left<toMidnight){int t=Number(c,"hour")*60+Number(c,"minute")+left;SetTime(Number(c,"day"),t/60,t%60);break;}
            left-=toMidnight;var turn=TurnDay(id);result["turned"]=true;foreach(var line in turn["lines"]!.AsArray())result["lines"]!.AsArray().Add(line?.DeepClone());if(turn["ended"]!=null){result["ended"]=turn["ended"]!.DeepClone();break;}}
        return result;
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("POST", "/api/tick", r=>{var result=Tick(r);if(!host.MultiplayerEnabled())foreach(var hook in host.TickAfterHooks)hook(r);return result;});
        service.Register("POST", "/api/rent", r => {
            bool paid = false; string line;
            int money = Number(host.Player(r.PlayerId), "money_c");
            if (RentPaid(r.PlayerId)) line = "The landlady waves you off. \"Paid till Sunday. Go and work.\"";
            else if (money < 150) line = $"\"150 centimes for the week, lad, and you have {money}. Sunday is Sunday.\"";
            else { paid = true; C.Atomic(() => { C.Execute("UPDATE player SET money_c=money_c-150,rent_paid_until=7 WHERE id=$p0", r.PlayerId); C.Log(r.PlayerId, "paid_rent", null, "Jef paid the week's rent at the doss house, 150 centimes."); }); line = "The landlady counts it twice and bites one coin. \"Your bed till Sunday.\""; }
            host.PublishState(r.PlayerId); return Join(new JsonObject { ["paid"] = paid, ["text"] = line }, host.Payload(r.PlayerId));
        });
        service.Register("POST", "/api/swim", r => {
            bool cold = C.PlayerState(r.PlayerId, "ending") == null && (!swims.TryGetValue(r.PlayerId, out var last) || C.Now - last >= 60000);
            if (cold) { swims[r.PlayerId] = C.Now; C.Execute("UPDATE player SET warmth=MAX(0,warmth-1) WHERE id=$p0", r.PlayerId); C.SetPlayerState(r.PlayerId, "swam_at", MinuteNow()); host.PublishState(r.PlayerId); }
            return Join(new JsonObject { ["cold"] = cold }, host.Payload(r.PlayerId));
        });
    }
    public static int Number(JsonObject obj, string key)
    {
        if (obj[key] is not JsonValue value) return 0;
        if (value.TryGetValue<int>(out var integer)) return integer;
        if (value.TryGetValue<long>(out var wide)) return (int)wide;
        return value.TryGetValue<double>(out var number) && double.IsFinite(number) ? (int)number : 0;
    }
    public static JsonObject Join(JsonObject first, JsonObject second) { foreach (var pair in second) first[pair.Key] = pair.Value?.DeepClone(); return first; }
}
