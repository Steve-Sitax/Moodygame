using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Authoritative street-light contribution to visibility, from current native rounds/fog/player help.</summary>
public sealed class NativeStreetLighting
{
    private readonly NativeServiceHost host;
    private readonly Func<JsonArray> nativeLampFacts;
    private IReadOnlyList<AntigoonNightEvent.Lamp>? targetCache;
    private long targetCacheAt;
    private double targetCacheHour;
    public NativeStreetLighting(NativeServiceHost host, Func<JsonArray> nativeLampFacts) { this.host = host; this.nativeLampFacts = nativeLampFacts;host.NewGame+=()=>targetCache=null;host.Loaded+=()=>targetCache=null; }
    private static JsonArray A(JsonNode? node) => node as JsonArray ?? new();
    private static double N(JsonNode? node) => NativeGoods.Number(node);
    private static string S(JsonNode? node, string key) => NativeGoods.S(node, key);
    private static bool B(JsonNode? node, string key) => NativeGoods.B(node, key);
    private static double Hour(double hour) => (hour % 24 + 24) % 24;
    public static double Daylight(double hour) { double h = Hour(hour); return h >= 20 || h < 6 ? 0 : h >= 18 || h < 7 ? .5 : 1; }
    public static double LampLight(double distance) => distance <= 3 ? .85 : distance >= 13 ? 0 : .85 * (1 - (distance - 3) / 10);
    public sealed record Window(string Kind, double Start, double Span, double End, double Last, bool Fog)
    {
        public JsonObject Json() => new() { ["kind"] = Kind, ["start"] = Start, ["span"] = Span, ["end"] = End, ["last"] = Last, ["fog"] = Fog };
    }
    public static bool FogAt(JsonObject? fog, double hour)
    {
        if (fog == null) return false; bool on = B(fog, "start"); foreach (var turn in A(fog["turns"])) if (N(turn?["h"]) <= hour) on = B(turn, "fog"); return on;
    }
    public static IReadOnlyList<Window> WindowsOf(JsonObject round, JsonObject? fog)
    {
        const double span = 3.7; double dusk = N(round["dusk"]); var candidates = new List<Window>();
        if (!FogAt(fog, 5)) candidates.Add(new("dawn", 5, span, 0, 9, false));
        foreach (var turn in A(fog?["turns"])) { double hour = N(turn?["h"]); if (hour <= 5 || hour >= dusk) continue; if (B(turn, "fog")) candidates.Add(new("dusk", hour, span, 0, hour + span + .5, true)); else if (hour + span <= dusk) candidates.Add(new("dawn", hour, span, 0, hour + span + .5, true)); }
        var kept = new List<Window>(); foreach (var window in candidates.OrderBy(w => w.Start)) if ((kept.Count == 0 ? "dusk" : kept[^1].Kind) != window.Kind) kept.Add(window);
        if (kept.Count > 0 && kept[^1].Kind == "dawn") kept.Add(new("dusk", dusk, span, 0, 21, false));
        return kept.Select((w, i) => { double next = i + 1 < kept.Count ? kept[i + 1].Start : 24; return w with { End = Math.Min(w.Start + w.Span, next), Last = Math.Min(w.Last, next) }; }).ToArray();
    }
    public static bool LampLit(JsonObject round, int index, double hour, JsonObject? fog)
    {
        double h = Hour(hour), eff = N(round["len"]) + A(round["lamps"]).Count * 14; if (eff == 0) eff = 1; var stops = A(round["at"]); double at = index >= 0 && index < stops.Count ? N(stops[index]) : double.NaN, done = (at + index * 14 + 14 * .6) / eff;
        bool lit = true; foreach (var window in WindowsOf(round, fog)) { double time = window.Start + done * window.Span; if (time > h || time >= window.End + 1e-9) continue; lit = window.Kind == "dusk"; } return lit;
    }
    public static bool HelpHolds(JsonObject round, JsonObject? help, int day, double hour, JsonObject? fog)
    {
        if (help == null || S(help, "round") != S(round, "id") || N(help["day"]) != day) return false; double h = Hour(hour); if (h < 12 || h >= N(help["until"])) return false; return WindowsOf(round, fog).Any(w => w.Kind == "dusk" && !w.Fog);
    }
    public static bool LampLitHelped(JsonObject round, int index, double hour, JsonObject? fog, JsonObject? help, int day)
    {
        if (help != null && S(help, "round") == S(round, "id") && N(help["day"]) == day && index >= N(help["from"])) {
            double h = Hour(hour); string id = S(A(round["lamps"]).ElementAtOrDefault(index), "id"); if (h >= 12 && A(help["lit"]).Any(l => l?.GetValue<string>() == id)) return true;
            if (HelpHolds(round, help, day, hour, fog)) return false;
        }
        return LampLit(round, index, hour, fog);
    }
    public static double At(JsonArray rounds, JsonArray fallback, double x, double z, double hour, JsonObject? fog, JsonObject? help, int day, Func<string,bool>? broken=null)
    {
        if (Daylight(hour) >= 1) return 0; double best = 0;
        if (rounds.Count > 0) foreach (var round in rounds) { int index = 0; foreach (var lamp in A(round?["lamps"])) { double dx = N(lamp?["x"]) - x, dz = N(lamp?["z"]) - z, distance = Math.Sqrt(dx * dx + dz * dz); if (broken?.Invoke(S(lamp,"id"))!=true && distance < 13 && LampLight(distance) > best && LampLitHelped(round!.AsObject(), index, hour, fog, help, day)) best = LampLight(distance); index++; } }
        else foreach (var lamp in fallback) { if(broken?.Invoke(S(lamp,"id"))==true)continue;double dx = N(lamp?["x"]) - x, dz = N(lamp?["z"]) - z; best = Math.Max(best, LampLight(Math.Sqrt(dx * dx + dz * dz))); }
        return best;
    }
    public double At(double x, double z)
    {
        var clock=host.Clock.View();if(Daylight(N(clock["hour"])+N(clock["minute"])/60)>=1)return 0;
        double best=0;foreach(var lamp in Targets()){double dx=lamp.At.X-x,dz=lamp.At.Z-z;if(Math.Abs(dx)<13&&Math.Abs(dz)<13)best=Math.Max(best,LampLight(Math.Sqrt(dx*dx+dz*dz)));}return best;
    }
    public static double NextNight(int day,double hour)=>(day-1)*24+(hour<20?20:44);
    private double AbsoluteHour {get{var c=host.Clock.View();return (N(c["day"])-1)*24+N(c["hour"])+N(c["minute"])/60;}}
    public HashSet<string> Disabled()
    {
        double time=AbsoluteHour;var data=host.Context.World("antigoon_lamps") as JsonObject;
        return data==null?new():data.Where(p=>N(p.Value)>time).Select(p=>p.Key).ToHashSet();
    }
    public void Extinguish(string id)
    {
        var data=(host.Context.World("antigoon_lamps") as JsonObject)?.DeepClone().AsObject()??new();
        foreach(var key in data.Where(p=>N(p.Value)<=AbsoluteHour).Select(p=>p.Key).ToArray())data.Remove(key);
        var c=host.Clock.View();data[id]=NextNight((int)N(c["day"]),N(c["hour"])+N(c["minute"])/60);host.Context.SetWorld("antigoon_lamps",data);targetCache=null;
    }
    public IReadOnlyList<AntigoonNightEvent.Lamp> Targets()
    {
        double absolute=AbsoluteHour;
        if(targetCache!=null&&host.Context.Now-targetCacheAt<500&&absolute==targetCacheHour)return targetCache;
        var c=host.Clock.View();int day=(int)N(c["day"]);double hour=N(c["hour"])+N(c["minute"])/60;var disabled=Disabled();
        var rounds=A(host.Context.World("townlife_lamps")?["rounds"]);var result=new List<AntigoonNightEvent.Lamp>();
        var heights=nativeLampFacts().Where(l=>l?["y"]!=null).ToDictionary(l=>S(l,"id"),l=>N(l?["y"]));
        void Add(JsonNode? l){string id=S(l,"id");if(!disabled.Contains(id))result.Add(new(id,new(N(l?["x"]),N(l?["z"])),heights.GetValueOrDefault(id,3.6)));}
        if(rounds.Count==0){foreach(var l in nativeLampFacts())Add(l);}
        else foreach(var r in rounds){int i=0;foreach(var l in A(r?["lamps"])){if(LampLitHelped(r!.AsObject(),i++,hour,host.Clock.FogView(),host.Context.World("lamps_help") as JsonObject,day))Add(l);}}
        targetCache=result;targetCacheAt=host.Context.Now;targetCacheHour=absolute;return result;
    }
}
