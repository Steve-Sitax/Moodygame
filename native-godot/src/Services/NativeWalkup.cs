using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace Scheldemist.Native.Services;

/// <summary>The single source responder picker and persistent calls, using NativeActions' perception/executor.</summary>
public sealed partial class NativeWalkup : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeActions actions;
    private NativeServiceContext C=>host.Context;
    private static string S(JsonNode? n,string k,string f="")=>NativeGoods.S(n,k,f);
    private static double N(JsonNode? n,string k,double f=0)=>NativeGoods.N(n,k,f);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static bool B(JsonNode? n,string k)=>NativeGoods.B(n,k);
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    private static readonly Dictionary<string,string[]> Roles=new(){{"customs",new[]{"customs"}},{"police",new[]{"police"}},{"thief",new[]{"thief"}},{"gang",new[]{"thief"}},{"hand",new[]{"natie","docker","porter"}},{"rival",new[]{"docker","natie"}}};
    private static readonly string[] Whys={"trouble","twist","crime","contraband","gang","shadow"};
    public Func<int,int,JsonObject,JsonObject>? CallTrouble;
    public Func<int,int,JsonObject,int?>? CustomsTrouble;
    public NativeWalkup(NativeServiceHost host,NativeActions actions)=>(this.host,this.actions)=(host,actions);
    public bool OnDuty(JsonObject r,string role)
    {
        if(!Roles.TryGetValue(role,out var trades)||!trades.Contains(S(r,"trade"))||N(r,"age")<16||N(r,"age")>66)return false;var now=NativeShops.Activity(r,Day,Hour).act;return role switch{"police"or"customs"=>now=="work","thief"=>now is not("home"or"church"),"gang"=>S(r,"sex")=="m"&&now is not("home"or"church"),_=>N(r,"age")>=18&&now is "work"or"loiter"or"tavern"};
    }
    public JsonArray Candidates(string role,JsonObject at,double maxM=320,IEnumerable<string>? exclude=null)
    {
        if(!Roles.ContainsKey(role))return new();var skipped=(exclude??Array.Empty<string>()).ToHashSet();var rows=new List<JsonObject>();foreach(var row in C.Rows("SELECT data_json FROM resident ORDER BY id")){
            var person=JsonNode.Parse(S(row,"data_json"))!.AsObject();string id=S(person,"id");if(skipped.Contains(id)||!OnDuty(person,role)||actions.Of(id)!=null||actions.Reserved?.Invoke(id)==true)continue;var point=actions.Position(id);if(point==null||B(point,"indoors")&&role is not("thief"or"gang"))continue;double d=NativeGoods.Distance(N(point,"x"),N(point,"z"),N(at,"x"),N(at,"z"));if(d>maxM)continue;if(actions.NearestOpen!=null&&(actions.NearestOpen(N(point,"x"),N(point,"z"),4)==null||actions.NearestOpen(N(at,"x"),N(at,"z"),12)==null))continue;rows.Add(new(){["r"]=person,["x"]=N(point,"x"),["z"]=N(point,"z"),["d"]=d});
        }return new JsonArray(rows.OrderBy(p=>N(p,"d")).Select(p=>(JsonNode)p).ToArray());
    }
    public JsonObject? PickResponder(string role,JsonObject at,double maxM=320,IEnumerable<string>? exclude=null)=>Candidates(role,at,maxM,exclude).FirstOrDefault()as JsonObject;
    public JsonArray Comings()=>new(actions.Active().Where(a=>S(a,"kind")=="come").Select(a=>a!.DeepClone()).ToArray());
    private static JsonObject Data(JsonNode? a){try{return JsonNode.Parse(S(a,"data_json","{}"))!.AsObject();}catch{return new();}}
    public int Holder(JsonNode row){var d=Data(row);if(N(d,"pid")>=1)return(int)N(d,"pid");var job=Regex.Match(S(d,"ref"),@"^job:(\d+):");return job.Success?C.Scalar<int>("SELECT COALESCE(taken_by,1) FROM job WHERE id=$p0",int.Parse(job.Groups[1].Value)):1;}
    public JsonObject CallResponder(int player,string role,string why,string reference,JsonObject at,double maxM=320,IEnumerable<string>? exclude=null)
    {
        if(!Roles.ContainsKey(role)||!Whys.Contains(why))return new(){["ok"]=false,["wait"]=true,["why"]="no such role"};reference=reference[..Math.Min(60,reference.Length)];var had=Comings().FirstOrDefault(a=>S(Data(a),"ref")==reference&&Holder(a!)==player);if(had!=null)return new(){["ok"]=true,["npc"]=S(had,"npc_id"),["name"]=S(actions.Resident(S(had,"npc_id")),"name",S(had,"npc_id")),["action"]=N(had,"id"),["urgent"]=B(Data(had),"urgent"),["d"]=0,["again"]=true};var candidate=PickResponder(role,at,maxM,exclude);if(candidate==null)return new(){["ok"]=false,["wait"]=true,["why"]="no "+role+" near enough"};bool urgent=why=="gang"||role=="police"&&why=="crime"||role=="customs"&&why=="contraband";var person=candidate["r"]!;
        var row=actions.Start(new(){["npc_id"]=S(person,"id"),["kind"]="come",["target"]="Jef",["target_x"]=Math.Round(N(at,"x"),1,MidpointRounding.AwayFromZero),["target_z"]=Math.Round(N(at,"z"),1,MidpointRounding.AwayFromZero),["source"]="engine",["minutes"]=120,["reason"]=why=="shadow"?"an eye on Jef's load":why=="gang"?"a purse in a dark street":why=="crime"?"trouble reported":"a load to check",["data"]=new JsonObject{["role"]=role,["why"]=why,["ref"]=reference,["urgent"]=urgent,["pid"]=player}},player);return new(){["ok"]=true,["npc"]=S(person,"id"),["name"]=S(person,"name"),["action"]=N(row,"id"),["urgent"]=urgent,["d"]=(int)Math.Floor(N(candidate,"d")+.5)};
    }
    public JsonArray CallGang(int player,string reference,JsonObject at,int count=3){var prior=Comings().Where(row=>S(Data(row),"ref").StartsWith(reference+":",StringComparison.Ordinal)&&Holder(row!)==player).ToArray();if(prior.Length>0)return new JsonArray(prior.Select(row=>row!["npc_id"]!.DeepClone()).ToArray());var ids=new List<string>();for(int i=0;i<Math.Clamp(count,1,6);i++){var answer=CallResponder(player,"gang","gang",reference+":"+i,at,220,ids);if(!B(answer,"ok"))break;ids.Add(S(answer,"npc"));}return new JsonArray(ids.Select(id=>(JsonNode)JsonValue.Create(id)!).ToArray());}
    public bool EndCall(int player,int id,string outcome="done"){var row=actions.Row(id);if(row==null||S(row,"kind")!="come"||S(row,"status")!="active"||Holder(row)!=player)return false;actions.End(id,"done",outcome);return true;}
    private JsonObject Point(NativeServiceRequest r)
    {
        double x=N(r.Body,"x",double.NaN),z=N(r.Body,"z",double.NaN);if(!double.IsFinite(x)||!double.IsFinite(z))throw new NativeServiceException("bad place");return new(){["x"]=Math.Clamp(x,-2000,2000),["z"]=Math.Clamp(z,-2000,2000)};
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/walkup",r=>new JsonObject{["coming"]=new JsonArray(Comings().Select(a=>(JsonNode)new JsonObject{["id"]=N(a,"id"),["npc"]=S(a,"npc_id"),["name"]=S(actions.Resident(S(a,"npc_id")),"name"),["phase"]=S(a,"phase"),["x"]=a?["target_x"]?.DeepClone(),["z"]=a?["target_z"]?.DeepClone(),["data"]=Data(a)}).ToArray())});
        service.Register("POST","/api/walkup/call",r=>{var at=Point(r);string role=r.Text("role"),why=r.Text("why"),reference=r.Text("ref");if(!Roles.ContainsKey(role)||!Whys.Contains(why)||!Regex.IsMatch(reference,@"^(job|gang|quest):[\w:-]+$"))throw new NativeServiceException("bad call");var job=Regex.Match(reference,@"^job:(\d+)(?::|$)");if(job.Success&&C.One("SELECT COALESCE(taken_by,1) AS player FROM job WHERE id=$p0 AND status='taken'",int.Parse(job.Groups[1].Value))is {} own&&N(own,"player")!=r.PlayerId)return new JsonObject{["ok"]=false,["wait"]=true,["why"]="not your job"};return CallResponder(r.PlayerId,role,why,reference,at);});
        service.Register("POST","/api/walkup/:id/done",r=>new JsonObject{["ok"]=EndCall(r.PlayerId,int.Parse(r.Param("id")),r.Text("outcome","done"))});
        service.Register("POST","/api/walkup/trouble/:id",r=>CallTrouble?.Invoke(r.PlayerId,int.Parse(r.Param("id")),Point(r))??throw new NativeServiceException("Native trouble authority is unavailable",501));
        RegisterShadow(service);
    }
}
