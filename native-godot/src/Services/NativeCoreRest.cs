using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Chosen sleep, physical bench/doss checks, need accumulators and wake state from rest.ts.</summary>
public sealed partial class NativeCoreRest : INativeServiceModule
{
    private sealed class Rest
    {
        public int Player, Planned, Slept, FromHour, FromMinute;
        public string Kind="",Label="",Home="";
        public JsonObject? Bench,Night,Robbed;
        public JsonObject? At;
        public bool Acked = true;
        public bool Turned,RobRolled;
        public long LastStep;
        public readonly double[] Acc=new double[4];
        public readonly JsonArray Lines=new();
    }
    private readonly NativeServiceHost host;
    private NativeServiceContext C=>host.Context;
    private readonly Dictionary<int,Rest> rests=new();
    private readonly Dictionary<int,(double x,double z,long ms)> seen=new();
    public NativeCoreRest(NativeServiceHost host)=>this.host=host;
    public void Clear(){rests.Clear();seen.Clear();woken.Clear();}
    public void ReportPosition(int id,JsonNode? node)
    {
        if(node is JsonObject p&&Try(p,"x",out double x)&&Try(p,"z",out double z))seen[id]=(x,z,C.Now);
    }
    private static bool Try(JsonObject p,string key,out double value)
    {
        value=0;if(p[key] is not JsonValue node)return false;
        if(node.TryGetValue<double>(out value))return double.IsFinite(value);
        if(node.TryGetValue<int>(out int integer)){value=integer;return true;}
        return false;
    }
    private static double Val(JsonObject node,string key)=>Try(node,key,out double value)?value:0;
    public JsonObject? Bench(string id)
    {
        var found=C.Rules["benches"]!.AsArray().FirstOrDefault(b=>b?["id"]?.GetValue<string>()==id);
        if(found!=null)return found.DeepClone().AsObject();
        var match=Regex.Match(id,@"^door:(-?\d{1,4}(?:\.\d)?),(-?\d{1,4}(?:\.\d)?)$");
        return match.Success?new JsonObject{["id"]=id,["label"]="a bench by a house door",["x"]=double.Parse(match.Groups[1].Value,System.Globalization.CultureInfo.InvariantCulture),["z"]=double.Parse(match.Groups[2].Value,System.Globalization.CultureInfo.InvariantCulture),["y"]=0,["fine"]=false}:null;
    }
    public void RegisterBench(JsonObject bench)
    {
        string id=bench["id"]!.GetValue<string>();var list=C.Rules["benches"]!.AsArray();var old=list.FirstOrDefault(b=>b?["id"]?.GetValue<string>()==id);if(old!=null)list.Remove(old);list.Add(bench.DeepClone());
    }
    private static bool Near(JsonObject a,JsonObject b,double reach)=>Math.Sqrt(Math.Pow(Val(a,"x")-Val(b,"x"),2)+Math.Pow(Val(a,"z")-Val(b,"z"),2))<=reach;
    public JsonObject Start(NativeServiceRequest request)
    {
        int id=request.PlayerId; if(C.PlayerState(id,"ending")!=null)throw new NativeServiceException("the week is over",409);
        string kind=request.Text("place");var body=request.Body;var position=body["pos"] as JsonObject;
        bool morning=body["hours"] is JsonValue value&&value.TryGetValue<string>(out string? text)&&text=="morning";
        if(kind is not ("home" or "doss" or "bench")||(!morning&&!Try(body,"hours",out _)))throw new NativeServiceException("place must be home, doss or bench, with hours 1 to 12 or morning",400);
        if(rests.ContainsKey(id))throw new NativeServiceException("you are asleep already",409);
        if(position!=null&&(!Try(position,"x",out _)||!Try(position,"z",out _)))throw new NativeServiceException("place must be home, doss or bench, with hours 1 to 12 or morning",400);
        if(position!=null&&seen.TryGetValue(id,out var last)&&C.Now-last.ms<25000){var previous=new JsonObject{["x"]=last.x,["z"]=last.z};if(!Near(position,previous,40+8*(C.Now-last.ms)/1000.0))throw new NativeServiceException("you are not there",409);}
        var clock=host.Clock.View();int hour=N(clock,"hour"),minute=N(clock,"minute");int until=360-(hour*60+minute);if(until<=0)until+=1440;
        var rest=new Rest{Player=id,Kind=kind,Planned=morning?until:Math.Clamp((int)Math.Floor(Val(body,"hours")+.5),1,12)*60,FromHour=hour,FromMinute=minute};
        if(kind=="home"){
            if(host.HomeBed==null)throw new NativeServiceException("Native home lease/comfort service is not implemented",501);
            var bed=host.HomeBed(id);var home=bed["home"]!.AsObject();rest.Home=home["id"]!.GetValue<string>();rest.Label=home["label"]!.GetValue<string>();rest.Night=bed["night"]!.DeepClone().AsObject();
            if(host.Clock.Where(id)["place"]?.GetValue<string>()!="home:"+rest.Home)throw new NativeServiceException("you are not in your room",409);
        }else if(kind=="doss"){
            if(N(clock,"day")>=7&&!host.Clock.RentPaid(id))throw new NativeServiceException("The landlady will not open the door. \"No rent, no bed. Sunday is Sunday.\"",409);
            if(position==null||!Near(position,C.Rules["dossStep"]!.AsObject(),4))throw new NativeServiceException("you are not at the doss house",409);rest.Label="the doss house, Sint-Andries";
        }else{
            string benchId=request.Text("bench");rest.Bench=Bench(benchId)??throw new NativeServiceException("no such bench",400);
            bool up=Val(rest.Bench,"y")>1&&(position?["y"]==null||Math.Abs(Val(position!,"y")-Val(rest.Bench,"y"))>1.5);
            if(position==null||!Near(position,rest.Bench,2)||up)throw new NativeServiceException("that bench is too far off",409);
            if(rests.Values.Any(r=>r.Bench?["id"]?.GetValue<string>()==benchId))throw new NativeServiceException("someone is asleep on that bench",409);
            rest.Label=rest.Bench["label"]!.GetValue<string>();
        }
        C.Atomic(()=>{foreach(var hook in host.StopTransportHooks)hook(id);if(kind=="bench")C.Execute("UPDATE player SET warmth=MIN(warmth,1) WHERE id=$p0",id);});rests[id]=rest;return View(rest);
    }
    public JsonObject? View(int id)=>rests.TryGetValue(id,out var rest)?View(rest):null;
    private JsonObject View(Rest rest)
    {
        var now=host.Clock.View();now.Remove("weather");var view=new JsonObject{["place"]=rest.Kind,["label"]=rest.Label,["planned_min"]=rest.Planned,["slept_min"]=rest.Slept,["from"]=new JsonObject{["hour"]=rest.FromHour,["minute"]=rest.FromMinute},["now"]=now};
        if(rest.Bench!=null)view["bench"]=rest.Bench["id"]!.DeepClone();if(rest.Home!="")view["home"]=rest.Home;if(rest.At!=null)view["at"]=rest.At.DeepClone();return view;
    }
    private void Needs(Rest rest,int minutes)
    {
        if(rest.Kind=="cell")return;
        var n=host.Player(rest.Player);double hours=minutes/60.0;bool bed=rest.Kind!="bench";int cap=bed?10:6;
        if(N(n,"sleep")<cap)rest.Acc[0]+=(bed?1.25:.6)*hours;rest.Acc[1]+=hours/8;
        if(bed){rest.Acc[2]+=(rest.Night==null?3:Val(rest.Night,"warmth"))/8*hours;rest.Acc[3]+=(N(n,"food")>=3?(rest.Night==null?1:Val(rest.Night,"healthFed")):(rest.Night==null?0:Val(rest.Night,"healthHungry")))/8*hours;}
        int take(int i){int whole=(int)Math.Floor(rest.Acc[i]+1e-9);rest.Acc[i]-=whole;return whole;}
        int sleep=N(n,"sleep")>=cap?N(n,"sleep"):Math.Min(cap,N(n,"sleep")+take(0));int food=Math.Max(0,N(n,"food")-take(1));int warmth=Math.Min(10,N(n,"warmth")+take(2));int health=Math.Min(10,N(n,"health")+take(3));
        C.Execute("UPDATE player SET sleep=$p0,food=$p1,warmth=$p2,health=$p3 WHERE id=$p4",sleep,food,warmth,health,rest.Player);
    }
    private void Hour(Rest rest,int hour)
    {
        var n=host.Player(rest.Player);int warmth=N(n,"warmth"),health=N(n,"health");if(rest.Kind=="bench"&&hour%((hour>=20||hour<7)?3:5)==0)warmth=Math.Max(0,warmth-1);
        if((N(n,"food")==0||warmth==0||N(n,"sleep")==0)&&hour%3==0)health=Math.Max(0,health-1);C.Execute("UPDATE player SET warmth=$p0,health=$p1 WHERE id=$p2",warmth,health,rest.Player);host.RumourRound?.Invoke(hour);if(!host.MultiplayerEnabled())foreach(var hook in host.HourHooks)hook(hour);
    }
    public JsonObject? Step(NativeServiceRequest request)
    {
        if(!rests.TryGetValue(request.PlayerId,out var rest))return null;
        if(!request.Bool("asleep"))return new JsonObject{["advanced"]=false,["woke"]=End(rest,"up")};
        bool fast=host.OnlinePlayers().All(id=>rests.ContainsKey(id));if(C.Now-rest.LastStep<(fast?300:9000))return new JsonObject{["advanced"]=false,["rest"]=View(rest)};
        rest.LastStep=C.Now;int left=Math.Min(fast?30:5,rest.Planned-rest.Slept);var result=new JsonObject{["advanced"]=true};string? why=null;JsonObject? ending=null;
        C.Atomic(()=>{
            while(left>0&&why==null){int toHour=60-N(host.Clock.View(),"minute"),piece=Math.Min(left,toHour);var passed=host.Clock.PassTime(rest.Player,piece);rest.Slept+=piece;left-=piece;
                if(passed["turned"]?.GetValue<bool>()==true){rest.Turned=true;foreach(var line in passed["lines"]!.AsArray())rest.Lines.Add(line?.DeepClone());result["turned"]=new JsonObject{["day"]=N(host.Clock.View(),"day"),["lines"]=passed["lines"]!.DeepClone()};}
                if(passed["ended"] is JsonObject end){ending=end;why="ended";break;}Needs(rest,piece);
                if(piece==toHour){int hour=N(host.Clock.View(),"hour");Hour(rest,hour);if(rest.Bench?["fine"]?.GetValue<bool>()==true&&(hour>=22||hour<5)&&C.Roll()<.3){rest.Lines.Add("A policeman taps your boots with his stick. \"Not here, friend. The benches are for the day. Move along.\"");why="police";}}
                if(N(host.Player(rest.Player),"health")==0){ending=host.Clock.End(rest.Player,"health");why="ended";}
            }
            if(why==null&&!rest.RobRolled&&rest.Slept*2>=rest.Planned){rest.RobRolled=true;foreach(var hook in host.SleepHooks){var got=hook(rest.Player,rest.Kind=="bench"?"rough":rest.Kind=="home"?"home":"bed",false,N(host.Clock.View(),"hour"));if(got==null)continue;foreach(var line in got["lines"]!.AsArray())rest.Lines.Add(line?.DeepClone());if(got["robbed"] is JsonObject robbed){rest.Robbed=robbed.DeepClone().AsObject();why="robbed";}}}
        });
        if(why==null&&rest.Slept>=rest.Planned)why="rested";if(ending!=null)result["ended"]=ending.DeepClone();if(why!=null)result["woke"]=End(rest,why,ending);else result["rest"]=View(rest);return result;
    }
    public JsonObject? Wake(int id)=>rests.TryGetValue(id,out var rest)&&rest.Kind!="cell"?End(rest,"up"):null;
    private JsonObject End(Rest rest,string reason,JsonObject? ending=null)
    {
        rests.Remove(rest.Player);var clock=host.Clock.View();clock.Remove("weather");bool longSleep=rest.Slept>=240;
        if(rest.Kind=="cell"){
            var cellLines=rest.Lines.DeepClone().AsArray();if(ending==null)cellLines.Add("At dawn the door is unlocked. \"Out. And keep your hands to yourself.\"");
            CellEnded?.Invoke(rest.Player,cellLines.DeepClone().AsArray(),ending?.DeepClone().AsObject());
            var cell=new JsonObject{["place"]="cell",["label"]=rest.Label,["reason"]=reason,["slept_min"]=rest.Slept,["planned_min"]=rest.Planned,["lines"]=cellLines,["wake"]=clock,["turned"]=rest.Turned};
            if(ending!=null)cell["ended"]=ending.DeepClone();return cell;
        }
        string lasted(int min){int h=min/60,m=min%60;return h==0?$"{m} minutes":$"{h} hour{(h>1?"s":"")}{(m>0?" and "+m+" minutes":"")}";}
        var lines=new JsonArray();lines.Add(rest.Kind=="home"?longSleep&&rest.Night!=null?rest.Night["text"]!.GetValue<string>():$"You doze on your own bed in {rest.Label}.":rest.Kind=="doss"?longSleep?"You sleep on the straw in the doss house, six men to the room. It is warm enough.":"You doze on the straw in the doss house among the snorers.":$"You sleep on {rest.Label} in your coat, and the cold gets into your bones.");
        foreach(var line in rest.Lines)lines.Add(line?.DeepClone());if(ending==null)lines.Add(rest.Slept>0?$"You slept {lasted(rest.Slept)}. It is {N(clock,"hour")}:{N(clock,"minute"):00}, {clock["weekday"]!.GetValue<string>()}.":"You get up again before you are asleep.");
        if(rest.Slept>0)C.Log(rest.Player,rest.Kind=="home"?"slept_home":rest.Kind=="doss"?"slept":"slept_rough",rest.Kind=="home"?rest.Home:rest.Bench?["id"]?.GetValue<string>(),rest.Kind=="home"?$"Jef slept {lasted(rest.Slept)} in his own room, {rest.Label}.":rest.Kind=="doss"?$"Jef slept {lasted(rest.Slept)} in the doss house.":$"Jef slept {lasted(rest.Slept)} on {rest.Label}.");
        if(longSleep){C.SetPlayerState(rest.Player,"nights_slept",(C.PlayerState(rest.Player,"nights_slept")?.GetValue<int>()??0)+1);foreach(var hook in host.SleepEndedHooks)hook(rest.Player);}
        var result=new JsonObject{["place"]=rest.Kind,["label"]=rest.Label,["reason"]=reason,["slept_min"]=rest.Slept,["planned_min"]=rest.Planned,["lines"]=lines,["wake"]=clock,["turned"]=rest.Turned};
        if(rest.Home!="")result["home"]=rest.Home;if(rest.Bench!=null)result["bench"]=rest.Bench["id"]!.DeepClone();if(ending!=null)result["ended"]=ending.DeepClone();if(rest.Robbed!=null)result["robbed"]=rest.Robbed.DeepClone();return result;
    }
    public void Register(NativeServiceHost service)
    {
        service.NewGame+=Clear;service.Loaded+=Clear;
        service.Register("GET","/api/sleep",r=>new JsonObject{["rest"]=View(r.PlayerId)});
        service.Register("POST","/api/sleep",r=>{var result=Start(r);host.PublishState(r.PlayerId);return NativeCoreClock.Join(new JsonObject{["rest"]=result},host.Payload(r.PlayerId));});
        service.Register("POST","/api/sleep/wake",r=>{var result=Wake(r.PlayerId);host.PublishState(r.PlayerId);return NativeCoreClock.Join(new JsonObject{["woke"]=result},host.Payload(r.PlayerId));});
    }
    private static int N(JsonObject obj,string key)=>NativeCoreClock.Number(obj,key);
}
