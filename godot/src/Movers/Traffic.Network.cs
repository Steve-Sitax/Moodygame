using System;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.Net.Mp;

namespace Scheldemist.Movers;

public partial class Traffic
{
    public bool NetRemote {get;set;}
    public Action<string,JsonArray>? NetAsk;
    private static readonly string[] NetworkFields={"S","V","Pace","Gait","RearRoll","FrontRoll","Timer","Off","Want","Wait","Gone","Stuck","BackM","LastStop","Backs","State","ThingsAhead"};
    public JsonObject NetState()=>new(){["_seed"]=seed,["_away"]=new JsonArray(residentAway.Select(s=>(JsonNode)JsonValue.Create(s)!).ToArray()),["v"]=new JsonArray(vehicles.Select(v=>{var row=NativeWorldFields.Read(v,NetworkFields);row["id"]=v.Route+":"+v.Index;return(JsonNode)row;}).ToArray())};
    public void NetApply(JsonObject state,double dt){seed=(uint)NativeWorldFields.N(state,"_seed",seed);residentAway.Clear();foreach(var x in NativeWorldFields.A(state["_away"]))if(x is JsonValue a&&a.TryGetValue<string>(out var id))residentAway.Add(id);foreach(var row in NativeWorldFields.A(state["v"]).OfType<JsonObject>()){var v=vehicles.FirstOrDefault(v=>v.Route+":"+v.Index==NativeWorldFields.S(row,"id"));if(v==null)continue;NativeWorldFields.Apply(v,row,NetworkFields);Place(v,(float)Math.Min(dt,.1),0,true);}bed?.Commit();fore?.Commit();rear?.Commit();front?.Commit();horse?.Commit();foreach(var m in legs)m?.Commit();foreach(var m in loads.Values)m?.Commit();}
    public JsonNode? NetLerp(JsonNode a,JsonNode b,double u){var result=NativeWorldInterpolation.Lerp(a,b,u)!.AsObject();foreach(var row in NativeWorldFields.A(result["v"]).OfType<JsonObject>()){var v=vehicles.FirstOrDefault(v=>v.Route+":"+v.Index==NativeWorldFields.S(row,"id"));var old=NativeWorldFields.A(a["v"]).FirstOrDefault(x=>NativeWorldFields.S(x,"id")==NativeWorldFields.S(row,"id"));var next=NativeWorldFields.A(b["v"]).FirstOrDefault(x=>NativeWorldFields.S(x,"id")==NativeWorldFields.S(row,"id"));if(v==null||old==null||next==null)continue;double x=NativeWorldFields.N(old,"s"),y=NativeWorldFields.N(next,"s"),length=v.Path.Length;double diff=y-x;if(diff>length*.5)diff-=length;if(diff< -length*.5)diff+=length;row["s"]=v.Path.Wrap((float)(x+diff*u));}return result;}
}

public partial class GoodsDrays
{
    public bool NetRemote {get;set;}
    private static readonly string[] NetworkFields={"Leg","S","Moving","Gait","RearRoll","FrontRoll"};
    public JsonObject NetState()=>new(){["r"]=new JsonArray(rigs.Select(r=>{var row=NativeWorldFields.Read(r,NetworkFields);row["id"]=r.Id;return(JsonNode)row;}).ToArray())};
    public void NetApply(JsonObject state,double dt){foreach(var row in NativeWorldFields.A(state["r"]).OfType<JsonObject>()){var r=rigs.FirstOrDefault(r=>r.Id==NativeWorldFields.S(row,"id"));if(r==null)continue;NativeWorldFields.Apply(r,row,NetworkFields);r.Leg=Math.Clamp(r.Leg,0,r.Legs.Length-1);Place(r,(float)Math.Min(dt,.1),true);}}
}
