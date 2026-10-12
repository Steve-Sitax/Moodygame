using System;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.Net.Mp;

namespace Scheldemist.Movers;

public partial class River
{
    public bool NetRemote {get;set;}
    public JsonObject NetState()=>new(){["_n"]=serial,["w"]=wait,["m"]=new JsonArray(movers.Select(m=>new JsonObject{["id"]=m.Id,["_lane"]=m.Lane,["_parts"]=new JsonArray(m.K.Parts.Select(p=>(JsonNode)JsonValue.Create(p)!).ToArray()),["_scale"]=m.K.Scale,["s"]=m.S,["v"]=m.V,["sp"]=m.Speed}).Cast<JsonNode>().ToArray()),["anc"]=Anchorage?.NetState()};
    public void NetApply(JsonObject value,double dt){
        if(group==null||hawsers==null)return;serial=(int)NativeWorldFields.N(value,"_n",serial);wait=NativeWorldFields.N(value,"w",wait);var wanted=NativeWorldFields.A(value["m"]).OfType<JsonObject>().Take(8).ToArray();
        string Signature(JsonObject row)=>NativeWorldFields.S(row,"_lane")+":"+NativeWorldFields.A(row["_parts"]).ToJsonString()+":"+NativeWorldFields.N(row,"_scale",1);
        foreach(var m in movers.ToArray()){var row=wanted.FirstOrDefault(x=>NativeWorldFields.N(x,"id")==m.Id);if(row!=null&&Signature(row)==m.Lane+":"+new JsonArray(m.K.Parts.Select(p=>(JsonNode)JsonValue.Create(p)!).ToArray()).ToJsonString()+":"+m.K.Scale)continue;m.Parts.ForEach(Give);movers.Remove(m);}
        foreach(var row in wanted){int id=(int)NativeWorldFields.N(row,"id");var m=movers.FirstOrDefault(x=>x.Id==id);if(m==null){string lane=NativeWorldFields.S(row,"_lane");if(!routes.TryGetValue(lane,out var route))continue;string[] names=NativeWorldFields.A(row["_parts"]).OfType<JsonValue>().Select(v=>v.TryGetValue<string>(out var name)?name:"").Where(n=>n.Length>0).Take(8).ToArray();if(names.Length==0)continue;float scale=(float)Math.Clamp(NativeWorldFields.N(row,"_scale",1),.1,3);var parts=names.Select(n=>Take(n,scale)).ToList();if(parts.Any(p=>p==null)){foreach(var p in parts)if(p!=null)Give(p);continue;}
                var actual=parts.Select(p=>p!).ToList();m=new Mover{Id=id,K=new Kind_{Parts=names,Scale=scale,Speed=NativeWorldFields.N(row,"sp")},Route=route,Lane=lane,Parts=actual,Len=TrainLength(actual,Gap),Beam=names.Max(n=>Boats.I.Dims(n).Beam)*scale,Lead=names[0]};movers.Add(m);}
            m.S=NativeWorldFields.N(row,"s");m.V=NativeWorldFields.N(row,"v");m.Speed=NativeWorldFields.N(row,"sp");}
        Heads();Lay();if(value["anc"] is JsonObject anchor)Anchorage?.NetApply(anchor);
    }
    public JsonNode? NetLerp(JsonNode a,JsonNode b,double u){var result=NativeWorldInterpolation.Lerp(a,b,u)!.AsObject();if(a["anc"] is JsonObject old&&b["anc"] is JsonObject next&&Anchorage!=null)result["anc"]=Anchorage.NetLerp(old,next,u);return result;}
}

public sealed partial class Anchorage
{
    private static readonly string[] NetworkFields={"S","V","Dwell","Crab","Waited","Blocked","Back","Hold","Backs","Stop","Committed","Phase","Why"};
    private double networkClock;
    public JsonObject NetState()=>new(){["sc"]=networkClock,["t"]=new JsonArray(Tows.Select((tow,i)=>{var row=NativeWorldFields.Read(tow,NetworkFields);row["id"]=i;return(JsonNode)row;}).ToArray())};
    public void NetApply(JsonObject value){if(!ok)return;networkClock=NativeWorldFields.N(value,"sc");foreach(var row in NativeWorldFields.A(value["t"]).OfType<JsonObject>()){int id=(int)NativeWorldFields.N(row,"id",-1);if(id<0||id>=Tows.Count)continue;NativeWorldFields.Apply(Tows[id],row,NetworkFields);}PlaceLiner(networkClock);PlaceTows();}
    public JsonNode? NetLerp(JsonObject a,JsonObject b,double u){var result=NativeWorldInterpolation.Lerp(a,b,u)!.AsObject();foreach(var row in NativeWorldFields.A(result["t"]).OfType<JsonObject>()){int id=(int)NativeWorldFields.N(row,"id",-1);var old=NativeWorldFields.A(a["t"]).FirstOrDefault(x=>NativeWorldFields.N(x,"id",-2)==id);var next=NativeWorldFields.A(b["t"]).FirstOrDefault(x=>NativeWorldFields.N(x,"id",-2)==id);if(old==null||next==null)continue;double s0=NativeWorldFields.N(old,"s"),s1=NativeWorldFields.N(next,"s"),diff=s1-s0;if(diff>LEN/2)diff-=LEN;if(diff< -LEN/2)diff+=LEN;row["s"]=Wrap(s0+diff*u);}return result;}
}
