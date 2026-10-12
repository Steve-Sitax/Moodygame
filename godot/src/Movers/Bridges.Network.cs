using System;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.Net.Mp;

namespace Scheldemist.Movers;

public partial class Bridges
{
    public bool NetRemote {get;set;}
    public Action<string,JsonArray>? NetAsk;
    public JsonObject NetState()=>new(){["b"]=new JsonArray(ctls.Select(c=>(JsonNode)new JsonObject{["id"]=c.Key,["amount"]=c.Amount,["_want"]=c.Want,["_boats"]=new JsonArray(c.Boats.Select(x=>(JsonNode)JsonValue.Create(x)!).ToArray())}).ToArray()),["p"]=new JsonArray(passages.Values.Select(p=>{var q=NativeWorldFields.Read(p,"Name","Kind","State","S","Wait","Speed","V");q["id"]=p.Name;q["_asked"]=new JsonArray(p.Asked.Select(x=>(JsonNode)JsonValue.Create(x)!).ToArray());return(JsonNode)q;}).ToArray())};
    public void NetApply(JsonObject state,double dt){
        foreach(var row in NativeWorldFields.A(state["b"]).OfType<JsonObject>()){var c=ctls.FirstOrDefault(c=>c.Key==NativeWorldFields.S(row,"id"));if(c==null)continue;c.Amount=(float)Math.Clamp(NativeWorldFields.N(row,"amount"),0,1);c.Want=(int)NativeWorldFields.N(row,"_want");c.Boats.Clear();foreach(var who in NativeWorldFields.A(row["_boats"]))if(who is JsonValue v&&v.TryGetValue<string>(out var name))c.Boats.Add(name);c.Draw?.Set(Mv.Smooth(c.Amount));}
        foreach(var row in NativeWorldFields.A(state["p"]).OfType<JsonObject>()){if(!passages.TryGetValue(NativeWorldFields.S(row,"id"),out var p))continue;NativeWorldFields.Apply(p,row,"Kind","State","S","Wait","Speed","V");p.Asked.Clear();foreach(var key in NativeWorldFields.A(row["_asked"]))if(key is JsonValue v&&v.TryGetValue<string>(out var k))p.Asked.Add(k);
            foreach(var boat in p.Boats.Values)boat.Boat.Outer.Visible=false;if(p.Kind.Length==0){p.Part=null;continue;}p.Part=BoatFor(p,p.Kind);if(p.Part==null)continue;Boats.I.Activate(p.Part.Boat);p.Part.Boat.Outer.Visible=p.State!="river";Put(p,p.S,p.State=="out"?-1:1);}
    }
}
