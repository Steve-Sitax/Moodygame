using System;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Net.Mp;

namespace Scheldemist.Movers;

public partial class Railway
{
    private bool netRemote,networkFresh=true;
    public bool NetRemote {get=>netRemote;set{if(netRemote==value)return;netRemote=value;networkFresh=true;}}
    private static readonly string[] CraneNetworkFields={"X","Z","Yaw","A","Hy","Carry","OpT","Idle","IdleTo","ShipA","Goods","Pos","Speed","Stay","NextA","Along","Stuck","Roll","BlockT","Target","Mode","Reserved","Blocked","Lifts","Trips","Yields","YieldT","Lend","AwayX","AwayZ","MoveOn"};
    private static readonly string[] PileNetworkFields={"X","Z","Tx","Tz","Kind","N","Cap"};
    private static readonly string[] StopNetworkFields={"Head","Wagon","Row","In","Queued"};
    private static readonly string[] OpNetworkFields={"T","V","Src","W","Slot"};
    public JsonObject NetState()=>new(){
        ["_st"]=state,["head"]=head,["v"]=v,["_shed"]=shedT,["roll"]=roll,["gait"]=gait,["_stop"]=stopI,["_working"]=working==null?-1:stops.IndexOf(working),["_wait"]=waitWhy,["_keeper"]=keeperTime,
        ["gate"]=new JsonObject{["amount"]=gate?.Amount??0,["_want"]=gate?.WantOpen??false},
        ["_wagons"]=new JsonArray(wagons.Select((w,i)=>(JsonNode)new JsonObject{["id"]=i,["goods"]=w.Goods,["slots"]=new JsonArray(w.Slots.Select(x=>(JsonNode)JsonValue.Create(x)!).ToArray())}).ToArray()),
        ["_stops"]=new JsonArray(stops.Select((s,i)=>{var row=NativeWorldFields.Read(s,StopNetworkFields);row["id"]=i;row["_crane"]=s.Crane.Index;return(JsonNode)row;}).ToArray()),
        ["cranes"]=new JsonArray(cranes.Select(c=>{var row=NativeWorldFields.Read(c,CraneNetworkFields);row["id"]=c.Index;row["_ops"]=new JsonArray(c.Ops.Select(op=>(JsonNode)NativeWorldFields.Read(op,OpNetworkFields)).ToArray());row["_pile"]=c.Pile==null?null:NativeWorldFields.Read(c.Pile,PileNetworkFields);if(craneFeeds.TryGetValue(c,out var feed)){row["_feed"]=NativeWorldFields.Read(feed,"Wait","Count","Fed","OldGoods");row["_feed"]!["_current"]=feed.Current?.Route;}return(JsonNode)row;}).ToArray())};
    public void NetApply(JsonObject value,double dt){
        if(!ok||gate==null||line==null)return;state=NativeWorldFields.S(value,"_st","shed");head=(float)NativeWorldFields.N(value,"head");v=(float)NativeWorldFields.N(value,"v");shedT=(float)NativeWorldFields.N(value,"_shed");roll=(float)NativeWorldFields.N(value,"roll");gait=(float)NativeWorldFields.N(value,"gait");stopI=(int)NativeWorldFields.N(value,"_stop");waitWhy=NativeWorldFields.S(value,"_wait");keeperTime=NativeWorldFields.N(value,"_keeper");
        if(value["gate"] is JsonObject g){gate.WantOpen=NativeWorldFields.B(g,"_want");gate.NetworkSet((float)Math.Clamp(NativeWorldFields.N(g,"amount"),0,1));}
        foreach(var row in NativeWorldFields.A(value["_wagons"]).OfType<JsonObject>()){int id=(int)NativeWorldFields.N(row,"id",-1);if(id<0||id>=wagons.Count)continue;var w=wagons[id];string goods=NativeWorldFields.S(row,"goods");w.Goods=Goods.Contains(goods)?goods:null;var slots=NativeWorldFields.A(row["slots"]);for(int i=0;i<Math.Min(slots.Count,w.Slots.Length);i++)w.Slots[i]=slots[i] is JsonValue b&&b.TryGetValue<bool>(out bool on)&&on;}
        foreach(var row in NativeWorldFields.A(value["cranes"]).OfType<JsonObject>()){var c=cranes.FirstOrDefault(c=>c.Index==NativeWorldFields.N(row,"id",-1));if(c==null)continue;NativeWorldFields.Apply(c,row,CraneNetworkFields);if(c.Carry!=null&&!Goods.Contains(c.Carry))c.Carry=null;if(!Goods.Contains(c.Goods))c.Goods="sacks";c.PartsPos=float.NaN;
            c.Ops.Clear();foreach(var q in NativeWorldFields.A(row["_ops"]).OfType<JsonObject>().Take(100)){object boxed=new Op();NativeWorldFields.Apply(boxed,q,OpNetworkFields);var op=(Op)boxed;if(!Enum.IsDefined(op.T)||op.Src<0||op.Src>3||op.W<0||op.W>=wagons.Count||op.Slot<0||op.Slot>5)continue;c.Ops.Add(op);}
            if(row["_pile"] is JsonObject pile){c.Pile??=new Pile{Body=NewBox("network_pile_"+c.Index,new Vector3(2.2f,1.6f,2.2f))};NativeWorldFields.Apply(c.Pile,pile,PileNetworkFields);if(Goods.Contains(c.Pile.Kind))PileOn(c.Pile);}else if(c.Pile!=null){c.Pile.N=0;PileOn(c.Pile);}
            if(row["_feed"] is JsonObject f&&craneFeeds.TryGetValue(c,out var feed)){NativeWorldFields.Apply(feed,f,"Wait","Count","Fed","OldGoods");feed.Current=feeds.FirstOrDefault(x=>x.Route==NativeWorldFields.S(f,"_current"));}
            PlaceCrane(c);
        }
        stops.Clear();foreach(var row in NativeWorldFields.A(value["_stops"]).OfType<JsonObject>().Take(100)){var crane=cranes.FirstOrDefault(c=>c.Index==NativeWorldFields.N(row,"_crane",-1));if(crane==null)continue;var stop=new Stop{Crane=crane};NativeWorldFields.Apply(stop,row,StopNetworkFields);if(stop.Wagon<0||stop.Wagon>=wagons.Count)continue;stops.Add(stop);}int wi=(int)NativeWorldFields.N(value,"_working",-1);working=wi>=0&&wi<stops.Count?stops[wi]:null;
        if(networkFresh){networkFresh=false;soundGate=gate.WantOpen;for(int i=0;i<soundAxles.Length;i++)soundAxles[i]=head-wagons[i/2].Front-LBuf/2+(i%2==0?Wb/2:-Wb/2);foreach(var c in cranes)if(craneSounds.TryGetValue(c,out var audio))craneSounds[c]=(audio.At,c.Ops.Count>0&&c.Ops[0].T==OpT.Hoist&&Math.Abs(c.Ops[0].V-c.Hy)>.5f,c.Mode=="travel");}
        PlaceTrain();Draw();
    }
    public JsonNode? NetLerp(JsonNode a,JsonNode b,double u){var result=NativeWorldInterpolation.Lerp(a,b,u)!.AsObject();if(Math.Abs(NativeWorldFields.N(a,"head")-NativeWorldFields.N(b,"head"))>10)result["head"]=(u<.5?a:b)["head"]?.DeepClone();return result;}
}
