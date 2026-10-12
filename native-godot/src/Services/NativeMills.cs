using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Wind, flour/grain carts, bakery lofts and actual mill jobs; all state belongs to the native save.</summary>
public sealed partial class NativeMills : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C=>host.Context;
    public JsonObject Data {get;}
    private static string S(JsonNode? n,string key,string fallback="")=>n?[key]is JsonValue v&&v.TryGetValue<string>(out var s)?s:fallback;
    private static double V(JsonNode? n){if(n is JsonValue v){if(v.TryGetValue<double>(out var d))return d;if(v.TryGetValue<int>(out var i))return i;if(v.TryGetValue<long>(out var l))return l;}return 0;}
    private static double N(JsonNode? n,string key)=>V(n?[key]);
    private static JsonArray A(JsonNode? n)=>n as JsonArray??new();
    private static JsonObject O(JsonNode? n)=>n as JsonObject??new();
    private static int Round(double n)=>(int)Math.Floor(n+.5);
    private static int Round5(double n)=>Round(n/5)*5;
    private static uint Hash(string text){uint h=2166136261;foreach(char ch in text)h=unchecked((h^ch)*16777619);return h;}
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    private JsonArray Mills=>A(Data["mills"]);
    public readonly List<Action<JsonArray>> StockEventHooks=new();
    public NativeMills(NativeServiceHost host){this.host=host;Data=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-mills.json")))!.AsObject();}
    public static double Turning(string weather,int day,double hour)=>day%7==0||(hour%24+24)%24<6||(hour%24+24)%24>=18.5?0:weather switch{"mist"=>.5,"clear"=>1,"rain"=>1.15,_=>0};
    public static double LegHours(double metres)=>metres/1.15/120;
    public static JsonArray Runs(JsonObject mill,int day)
    {
        var result=new JsonArray();if(day%7==0)return result;void Run(string kind,double start,double leg,string[] stages){var phases=new JsonArray();double t=start;foreach(string phase in stages){double end=t+(phase is"load"or"unload"or"store"?1/3.0:leg);phases.Add(new JsonObject{["phase"]=phase,["from"]=t,["to"]=end});t=end;}result.Add(new JsonObject{["mill"]=S(mill,"id"),["kind"]=kind,["from"]=start,["to"]=t,["phases"]=phases});}
        Run("flour",4.5,LegHours(N(mill["way"],"bakery")),new[]{"load","go","unload","back"});Run("grain",13.5,LegHours(N(mill["way"],"grain")),new[]{"go","load","back","store"});return result;
    }
    public static JsonObject? RunNow(JsonObject mill,int day,double hour)
    {
        foreach(var run in Runs(mill,day))foreach(var p in A(run?["phases"]))if(hour>=N(p,"from")&&hour<N(p,"to"))return new(){["run"]=run!.DeepClone(),["phase"]=S(p,"phase"),["since"]=hour-N(p,"from"),["left"]=N(p,"to")-hour};return null;
    }
    public JsonObject FreshStocks(double at)
    {
        var mills=new JsonObject();var bakeries=new JsonObject();var carts=new JsonObject();foreach(var m in Mills){mills[S(m,"id")]=new JsonObject{["grain"]=6,["flour"]=6,["ground"]=0};bakeries[S(m,"bakery")]=new JsonObject{["flour"]=5};carts[S(m,"id")]=0;}return new(){["at"]=at,["mills"]=mills,["bakeries"]=bakeries,["carts"]=carts};
    }
    public JsonArray StepStocks(JsonObject stocks,double to,Func<int,string> weatherOf)
    {
        var events=new JsonArray();if(to<=N(stocks,"at"))return events;double t=Math.Floor(Math.Max(N(stocks,"at"),to-4320)/5)*5;
        while(t+5<=to){double next=t+5;int day=(int)Math.Floor(t/1440)+1;double fromHour=t%1440/60,toHour=fromHour+5/60.0;bool Crossed(double h)=>fromHour<h&&toHour>=h;
            foreach(var m in Mills){string id=S(m,"id");var mill=stocks["mills"]![id]!.AsObject();var bakery=stocks["bakeries"]![S(m,"bakery")]!.AsObject();void Add(string what,double n)=>events.Add(new JsonObject{["at"]=next,["mill"]=id,["what"]=what,["n"]=n});
                if(Crossed(3)){int need=day%7==0?1:3;double used=Math.Min(need,N(bakery,"flour"));bakery["flour"]=N(bakery,"flour")-used;Add(used<need?"short":"bake",used);}
                foreach(var run in Runs(m!.AsObject(),day)){var load=A(run?["phases"]).First(p=>S(p,"phase")=="load")!;if(Crossed(N(load,"to"))){double n=S(run,"kind")=="flour"?Math.Max(0,Math.Min(3,Math.Min(N(mill,"flour"),8-N(bakery,"flour")))):3;if(S(run,"kind")=="flour")mill["flour"]=N(mill,"flour")-n;stocks["carts"]![id]=n;Add("loaded",n);}var drop=A(run?["phases"]).First(p=>S(p,"phase")==(S(run,"kind")=="flour"?"unload":"store"))!;if(Crossed(N(drop,"to"))){double n=V(stocks["carts"]?[id]);if(S(run,"kind")=="flour")bakery["flour"]=Math.Min(8,N(bakery,"flour")+n);else mill["grain"]=Math.Min(12,N(mill,"grain")+n);stocks["carts"]![id]=0;Add(S(run,"kind")=="flour"?"delivered":"grain_in",n);}}
                double wind=Turning(weatherOf(day),day,fromHour);if(wind>0){mill["ground"]=Math.Min(1,N(mill,"ground")+wind*.5*5/60);if(N(mill,"ground")>=1&&N(mill,"grain")>0&&N(mill,"flour")<10){mill["ground"]=N(mill,"ground")-1;mill["grain"]=N(mill,"grain")-1;mill["flour"]=N(mill,"flour")+1;Add("ground",1);}}
            }t=next;
        }stocks["at"]=Math.Max(N(stocks,"at"),t);return events;
    }
    public static int BreadExtra(double flour)=>flour<=0?2:flour<=1?1:0;
    public static double Pay(double sacks,double way,bool cart,(double Min,double Max) band)
    {
        double raw=cart?40+sacks*50*way/300:25+sacks*50*way/180,low=cart?Round5(band.Min+(band.Max-band.Min)*.5):band.Min;return Math.Max(low,Math.Min(band.Max,Round5(raw)));
    }
    public JsonObject Stocks()
    {
        int now=host.Clock.GameMinute();var stocks=C.World("mills")as JsonObject;if(stocks==null||now<N(stocks,"at")-5||!Mills.All(m=>stocks["mills"]?[S(m,"id")]!=null&&stocks["bakeries"]?[S(m,"bakery")]!=null))stocks=FreshStocks(now);string weather=S(host.Clock.View(),"weather");var events=StepStocks(stocks,now,_=>weather);C.SetWorld("mills",stocks);if(events.Count>0)foreach(var hook in StockEventHooks)hook(events.DeepClone().AsArray());return stocks;
    }
    public JsonObject Adjust(Action<JsonObject> change)
    {
        var stocks=Stocks();change(stocks);foreach(var m in O(stocks["mills"]).Select(p=>p.Value!.AsObject())){m["grain"]=Math.Max(0,Round(N(m,"grain")));m["flour"]=Math.Max(0,Round(N(m,"flour")));}foreach(var b in O(stocks["bakeries"]).Select(p=>p.Value!.AsObject()))b["flour"]=Math.Max(0,Round(N(b,"flour")));C.SetWorld("mills",stocks);return stocks;
    }
}
