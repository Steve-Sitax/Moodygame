using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Net.Mp;

public static class NativeWorldInterpolation
{
    private static double? Numeric(JsonNode? node) => node is JsonValue v && v.GetValueKind()==System.Text.Json.JsonValueKind.Number&&double.TryParse(node.ToJsonString(),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out double n)&&double.IsFinite(n)?n:null;
    public static JsonNode? Lerp(JsonNode? a,JsonNode? b,double u,string key="") {
        double? na=Numeric(a),nb=Numeric(b);if(na!=null&&nb!=null){if(key.StartsWith("_",StringComparison.Ordinal))return(u<.5?a:b)?.DeepClone();double diff=nb.Value-na.Value;if(key=="a"||key.EndsWith("yaw",StringComparison.OrdinalIgnoreCase))diff=Math.Atan2(Math.Sin(diff),Math.Cos(diff));return JsonValue.Create(na.Value+diff*u);}
        if(a is JsonArray aa&&b is JsonArray ba){
            if(ba.Count>0&&ba[0] is JsonObject first&&first.ContainsKey("id")){var old=new Dictionary<string,JsonNode?>();foreach(var node in aa)if(node is JsonObject obj)old[Id(obj["id"])]=node;return new JsonArray(ba.Select(node=>node is JsonObject obj&&old.TryGetValue(Id(obj["id"]),out var was)?Lerp(was,node,u,key):node?.DeepClone()).ToArray());}
            if(aa.Count!=ba.Count)return(u<.5?a:b)?.DeepClone();return new JsonArray(ba.Select((node,i)=>Lerp(aa[i],node,u,key)).ToArray());
        }
        if(a is JsonObject ao&&b is JsonObject bo){var output=new JsonObject();foreach(var pair in bo)output[pair.Key]=ao.ContainsKey(pair.Key)?Lerp(ao[pair.Key],pair.Value,u,pair.Key):pair.Value?.DeepClone();return output;}
        return(u<.5?a:b)?.DeepClone();
    }
    private static string Id(JsonNode? value)=>Numeric(value) is double n?"number:"+n.ToString("R",System.Globalization.CultureInfo.InvariantCulture):value?.ToJsonString()??"null";
}

/// <summary>world.ts buffering and adaptive delay, independent of Godot nodes and network transport.</summary>
public sealed class NativeMovingWorldBuffer
{
    private readonly Func<int> me;private readonly Func<double> serverNow;private readonly Func<JsonObject,bool> send;
    private readonly List<(double Time,JsonObject Data)> frames=new();private readonly List<double> late=new();private double delay=220,acc;private int sends;
    public int Pc {get;private set;}public bool Remote=>Pc!=0&&Pc!=me();
    public int Sent,BytesSent,Received,Starved,Takeovers,Asked;
    public NativeMovingWorldBuffer(Func<int> me,Func<double> serverNow,Func<JsonObject,bool> send)=>(this.me,this.serverNow,this.send)=(me,serverNow,send);
    public void SetPc(int id){bool was=Remote;Pc=id;if(was&&!Remote)Takeovers++;if(!Remote)frames.Clear();}
    public void Receive(double time,JsonObject data,double arrived){if(!Remote)return;Received++;if(frames.Count>0&&time<=frames[^1].Time)return;frames.Add((time,data.DeepClone().AsObject()));if(frames.Count>30)frames.RemoveAt(0);late.Add(arrived-time);if(late.Count>50)late.RemoveAt(0);}
    public JsonObject? Frame(double dt,Func<JsonObject> snapshot,Func<string,JsonNode,JsonNode,double,JsonNode?>? interpolate=null){
        if(!Remote){if(Pc!=0&&Pc==me()){acc+=dt;if(acc>=.1){acc=0;var message=new JsonObject{["type"]="world",["t"]=serverNow(),["d"]=snapshot()};sends++;if(send(message)){Sent++;BytesSent+=message.ToJsonString().Length;}}}return null;}
        if(late.Count>=10){var sorted=late.Order().ToArray();double wanted=Math.Clamp(sorted[(int)Math.Floor(sorted.Length*.95)]+110,200,400),step=dt*1000*.05;delay+=Math.Clamp(wanted-delay,-step,step);}
        if(frames.Count==0)return null;double time=serverNow()-delay;while(frames.Count>2&&frames[1].Time<=time)frames.RemoveAt(0);var from=frames[0];var to=from;double u=0;if(frames.Count>1&&time>from.Time){to=frames[1];u=Math.Min(1,(time-from.Time)/Math.Max(1,to.Time-from.Time));if(time>to.Time)Starved++;}
        var shown=new JsonObject();foreach(var pair in to.Data){if(pair.Value==null){shown[pair.Key]=null;continue;}var old=from.Data[pair.Key];shown[pair.Key]=old==null||from.Time==to.Time?pair.Value.DeepClone():interpolate?.Invoke(pair.Key,old,pair.Value,u)??NativeWorldInterpolation.Lerp(old,pair.Value,u);}return shown;
    }
    public JsonObject Report()=>new(){["pc"]=Pc,["remote"]=Remote,["delay"]=(int)Math.Floor(delay+.5),["buffered"]=frames.Count,["sent"]=Sent,["bytesSent"]=BytesSent,["received"]=Received,["starved"]=Starved,["takeovers"]=Takeovers,["asked"]=Asked};
}
