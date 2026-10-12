using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Physical shops, opening schedules, helpers and deterministic hourly customers.</summary>
public sealed class NativeShops : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly JsonObject data;
    private NativeServiceContext C => host.Context;
    private static string S(JsonNode? n,string k,string fallback="") => NativeGoods.S(n,k,fallback);
    private static double N(JsonNode? n,string k,double fallback=0) => NativeGoods.N(n,k,fallback);
    private static JsonArray A(JsonNode? n) => NativeGoods.A(n);
    public NativeShops(NativeServiceHost host) { this.host=host; data=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-assets.json")))!.AsObject(); }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/shops",r=>new JsonObject { ["shops"]=new JsonArray(A(data["shops"]).Select(n=>{var s=n!.DeepClone().AsObject();string keeper=S(s,"keeper");s["place"]=s["id"]!.DeepClone();s.Remove("id");s["open"]=host.Trade.AtWork(keeper);s["keeper"]=Person(Resident(keeper),false);s["wares"]=host.Trade.Wares(keeper);return (JsonNode)s;}).ToArray()),["record"]=C.World("shops_m7")?.DeepClone() });
        service.Register("GET","/api/shop/:place",r=>Now(r.Param("place")));
    }
    private JsonObject? Resident(string id) {var row=C.One("SELECT data_json FROM resident WHERE id=$p0",id);return row==null?null:JsonNode.Parse(S(row,"data_json"))!.AsObject();}
    private static JsonObject? Person(JsonObject? r,bool age=true) {if(r==null)return null;var result=new JsonObject();foreach(string key in new[]{"id","name","first","kind","sex"})result[key]=r[key]?.DeepClone();if(age)result["age"]=r["age"]?.DeepClone();return result;}
    internal static (string act,string place,double left) Activity(JsonObject r,int day,double hour)
    {
        foreach(var seg in A(r["sched"]?[day%7==0?"sunday":"day"])) {var a=A(seg);double from=NativeGoods.Number(a.ElementAtOrDefault(0)),to=NativeGoods.Number(a.ElementAtOrDefault(1));foreach(double h in new[]{hour,hour+24})if(h>=from&&h<to){string act=a.ElementAtOrDefault(2)?.GetValue<string>()??"home";return(act,a.ElementAtOrDefault(3)?.GetValue<string>()??(act=="work"?"work":"home"),to-h);}}
        return("home","home",1);
    }
    private static uint Hash(string text) {uint h=2166136261;foreach(char ch in text)h=unchecked((h^ch)*16777619);return h;}
    private bool Eligible(JsonObject p,string trade,string act)
    {
        if(N(p,"age")<12 || S(data["shopLook"]?[trade],"who")=="men"&&S(p,"sex")!="m")return false;
        if(act=="market")return true;
        if(act=="stroll")return new[]{"tobacconist","bookseller","hatter","clockmaker","roaster","apothecary","draper","colonial"}.Contains(trade);
        bool idle=S(p,"sex")=="m"&&(act=="loiter" || act=="work"&&S(p,"trade")is "sailor"or"retired");
        return idle&&new[]{"tobacconist","barber","roaster","butcher","cobbler","chandler","pawnbroker","hatter","printer","bookseller"}.Contains(trade);
    }
    public Dictionary<string,string> Callers(int day,int hour)
    {
        var residents=C.Rows("SELECT data_json FROM resident ORDER BY rowid").Select(n=>JsonNode.Parse(S(n,"data_json"))!.AsObject()).ToArray();var places=C.World("town")?["places"] as JsonObject;var outMap=new Dictionary<string,string>();
        foreach(var shop in A(data["shops"]).OrderBy(n=>S(n,"id"),StringComparer.Ordinal)) {
            string id=S(shop,"id"),trade=S(shop,"trade");var keeper=residents.FirstOrDefault(r=>S(r,"id")==S(shop,"keeper"));if(trade==""||keeper==null||Activity(keeper,day,hour).act!="work")continue;
            double busy=hour>=8&&hour<11||hour>=16&&hour<18?1.5:1,mean=Math.Min(2.6,(.45+.3*N(data["shopLook"]?[trade],"weight"))*busy);int want=(int)Math.Floor(mean+(Hash($"{id}:{day}:{hour}:n")%1000)/1000.0);var door=A(shop?["door"]);
            var candidates=residents.Select(r=>{var act=Activity(r,day,hour);var pl=places?[act.act=="work"?S(r["work"],"place"):act.place];double x=pl==null?N(r["home"],"sx"):N(pl,"x"),z=pl==null?N(r["home"],"sz"):N(pl,"z");return(r,act,dist:NativeGoods.Distance(x,z,NativeGoods.Number(door.ElementAtOrDefault(0)),NativeGoods.Number(door.ElementAtOrDefault(1))));})
                .Where(c=>c.act.left>=1-1e-6&&!outMap.ContainsKey(S(c.r,"id"))&&Eligible(c.r,trade,c.act.act)&&c.dist<140)
                .OrderBy(c=>c.dist+Hash($"{S(c.r,"id")}:{id}:{day}:{hour}")%60);
            foreach(var c in candidates){if(want--<=0)break;outMap[S(c.r,"id")]=id;}
        }
        return outMap;
    }
    public JsonObject Now(string id)
    {
        var shop=A(data["shops"]).FirstOrDefault(s=>S(s,"id")==id)??throw new NativeServiceException("no such shop",404);bool open=host.Trade.AtWork(S(shop,"keeper"));var helpers=new JsonArray();var customers=new JsonArray();var clock=host.Clock.View();int day=(int)N(clock,"day"),hour=(int)N(clock,"hour");
        if(open){foreach(var row in C.Rows("SELECT data_json FROM resident")){var r=JsonNode.Parse(S(row,"data_json"))!.AsObject();if(S(r,"id")!=S(shop,"keeper")&&S(r["work"],"shop")==id&&host.Trade.AtWork(S(r,"id")))helpers.Add(Person(r));}if(N(clock,"minute")>=20)foreach(var c in Callers(day,hour))if(c.Value==id)customers.Add(Person(Resident(c.Key)));}
        return new(){["place"]=id,["label"]=shop["label"]!.DeepClone(),["trade"]=shop["trade"]?.DeepClone(),["open"]=open,["keeper"]=open?Person(Resident(S(shop,"keeper"))):null,["helpers"]=helpers,["customers"]=customers,["smell"]=S(data["shopLook"]?[S(shop,"trade")],"smell")};
    }
}
