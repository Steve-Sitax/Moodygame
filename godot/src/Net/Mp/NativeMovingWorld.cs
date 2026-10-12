using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Play;

namespace Scheldemist.Net.Mp;

/// <summary>One world owner runs native simulations; the other clients apply buffered physical mover state.</summary>
[GamePart(131)]
public partial class NativeMovingWorld : Node
{
    public static NativeMovingWorld? I {get;private set;}
    private Together? hooked;
    private NativeMovingWorldBuffer buffer=null!;
    private int snapshotBytes,wireBytes,oversize,invalid;
    private JsonObject sizes=new();
    public bool Remote=>hooked?.On==true&&buffer.Remote;
    public override void _Ready(){I=this;ProcessPriority=-95;buffer=new(()=>Together.I?.PlayerId??0,()=>Together.I?.ServerNow??0,SendWorld);}
    public override void _ExitTree(){Unhook();if(I==this)I=null;}
    private void Unhook(){if(hooked==null)return;hooked.OtherText-=OnText;hooked.OtherBatch-=OnBinary;}
    private bool SendWorld(JsonObject message){if(message["d"] is not JsonObject state)return false;var frame=NativeWorldPacket.Encode(NativeWorldFields.N(message,"t"),state);if(frame==null){if(oversize++==0)GD.PushError("native moving world exceeds bounded wire packet");return false;}wireBytes=frame.Length;return Together.I?.SendBinary(frame)==true;}
    private void OnBinary(byte kind,byte[] data,double received){if(kind!=NativeWorldPacket.Kind)return;if(!NativeWorldPacket.TryDecode(data,out double time,out var state)){invalid++;return;}buffer.Receive(time,state!,hooked?.ServerNow??received);}
    private void Ask(string what,JsonArray args)=>hooked?.SendText(new JsonObject{["type"]="ask",["what"]=what,["args"]=args.DeepClone()});
    private void SetRemote(bool on){if(Omnibus.I!=null){Omnibus.I.NetRemote=on;Omnibus.I.NetAsk=Ask;}if(Bridges.I!=null){Bridges.I.NetRemote=on;Bridges.I.NetAsk=Ask;}if(Lock.I!=null){Lock.I.NetRemote=on;Lock.I.NetAsk=Ask;}if(River.I!=null)River.I.NetRemote=on;if(Railway.I!=null)Railway.I.NetRemote=on;if(Traffic.I!=null){Traffic.I.NetRemote=on;Traffic.I.NetAsk=Ask;}if(GoodsDrays.I!=null)GoodsDrays.I.NetRemote=on;if(Rowing.I!=null){Rowing.I.ResidentRemote=on;Rowing.I.ResidentCommand=Ask;}}
    private JsonObject Snapshot(){var result=new JsonObject();if(Omnibus.I?.Buses.Count>0)result["omnibus"]=Omnibus.I.NetState();if(Bridges.I?.List.Count>0)result["bridges"]=Bridges.I.NetState();if(Lock.I!=null)result["lock"]=Lock.I.NetState();if(River.I!=null)result["river"]=River.I.NetState();if(Railway.I?.Running==true)result["railway"]=Railway.I.NetState();if(Traffic.I?.Vehicles.Count>0)result["traffic"]=Traffic.I.NetState();if(GoodsDrays.I?.Rigs.Count>0)result["goodsDrays"]=GoodsDrays.I.NetState();if(Rowing.I!=null)result["rowing"]=Rowing.I.ResidentNetState();sizes=new JsonObject();snapshotBytes=0;foreach(var entry in result){int bytes=JsonSerializer.SerializeToUtf8Bytes(entry.Value).Length;sizes[entry.Key]=bytes;snapshotBytes+=bytes;}return result;}
    private JsonNode? Interpolate(string key,JsonNode a,JsonNode b,double u)=>key switch{"omnibus"=>Omnibus.I?.NetLerp(a,b,u),"river"=>River.I?.NetLerp(a,b,u),"traffic"=>Traffic.I?.NetLerp(a,b,u),"railway"=>Railway.I?.NetLerp(a,b,u),_=>null};
    private void Apply(JsonObject state,double dt){if(state["omnibus"] is JsonObject bus)Omnibus.I?.NetApply(bus,dt);if(state["bridges"] is JsonObject bridge)Bridges.I?.NetApply(bridge,dt);if(state["lock"] is JsonObject sluice)Lock.I?.NetApply(sluice,dt);if(state["river"] is JsonObject river)River.I?.NetApply(river,dt);if(state["railway"] is JsonObject train)Railway.I?.NetApply(train,dt);if(state["traffic"] is JsonObject traffic)Traffic.I?.NetApply(traffic,dt);if(state["goodsDrays"] is JsonObject goods)GoodsDrays.I?.NetApply(goods,dt);if(state["rowing"] is JsonObject rowing)Rowing.I?.ResidentNetApply(rowing,dt);}
    private void OnText(string type,JsonElement message){
        if(type=="worldpc"&&message.TryGetProperty("id",out var id)&&id.TryGetInt32(out int pc))buffer.SetPc(pc);
        else if(type=="world"&&message.TryGetProperty("t",out var time)&&time.TryGetDouble(out double t)&&double.IsFinite(t)&&message.TryGetProperty("d",out var data)&&data.ValueKind==JsonValueKind.Object)buffer.Receive(t,JsonNode.Parse(data.GetRawText())!.AsObject(),hooked?.ServerNow??0);
        else if(type=="asked"&&JsonNode.Parse(message.GetRawText()) is JsonObject ask)Asked(ask);
    }
    private void Asked(JsonObject message){
        if(Remote||buffer.Pc==0||buffer.Pc!=hooked?.PlayerId)return;string what=NativeWorldFields.S(message,"what");var args=NativeWorldFields.A(message["args"]);int from=(int)NativeWorldFields.N(message,"from");
        double Num(int i)=>i<args.Count?NativeWorldFields.N(new JsonObject{["v"]=args[i]?.DeepClone()},"v",double.NaN):double.NaN;
        string Str(int i,int max)=>i<args.Count&&args[i] is JsonValue v&&v.TryGetValue<string>(out var text)?text[..Math.Min(text.Length,max)]:"";
        bool? Bool(int i)=>i<args.Count&&args[i] is JsonValue v&&v.TryGetValue<bool>(out bool value)?value:null;
        if(what=="bus_hold"&&double.IsFinite(Num(0))&&Bool(1) is bool held){var bus=Omnibus.I?.Buses.FirstOrDefault(b=>b.Index==Num(0));if(bus!=null)Omnibus.I!.HoldPlayer(bus,held);buffer.Asked++;}
        else if(what=="bus_board"&&double.IsFinite(Num(0))&&Str(1,40)!=""&&Str(2,20)!=""&&Str(3,40)!=""){int owner=NativeStreet.I?.OwnerOf(Str(1,40))??0;if(owner<=0||owner==from)Omnibus.I?.NetBoard((int)Num(0),Str(1,40),Str(2,20),Str(3,40));buffer.Asked++;}
        else if(what=="bridge"&&Str(0,40)!=""&&Bool(1) is bool opened){Bridges.I?.Request(Str(0,40),"rower:"+from,opened);buffer.Asked++;}
        else if(what=="lock"&&Bool(0) is bool requested){Vector2? Where(){var point=hooked?.PlayerAt(from);return point==null?null:new Vector2(point.Value.X,point.Value.Z);}Lock.I?.RowRequest(requested,Where()!=null?()=>Where()??Vector2.Zero:null);buffer.Asked++;}
        else if(what is "town_boat_out" or "town_boat_end"){Rowing.I?.ResidentAsked(what,args,from);buffer.Asked++;}
        else if(what=="traffic_away"&&Bool(1) is bool away){var vehicle=ResidentJourneys.I?.Transport?.Vehicles.FirstOrDefault(v=>v.Route==Str(0,40));int owner=vehicle==null?-1:NativeStreet.I?.OwnerOf(vehicle.Owner)??0;if(vehicle!=null&&(owner<=0||owner==from))Traffic.I?.ResidentAway(vehicle.Route!,away);buffer.Asked++;}
    }
    public override void _Process(double delta){
        var together=Together.I;if(hooked!=together){Unhook();hooked=together;if(hooked!=null){hooked.OtherText+=OnText;hooked.OtherBatch+=OnBinary;}}
        if(hooked?.On!=true){buffer.SetPc(0);SetRemote(false);return;}SetRemote(buffer.Remote);if(buffer.Frame(Math.Min(delta,.1),Snapshot,Interpolate) is JsonObject state)Apply(state,Math.Min(delta,.1));
    }
    public JsonObject Report(){var report=buffer.Report();report["snapshotBytes"]=snapshotBytes;report["wireBytes"]=wireBytes;report["subsystems"]=sizes.DeepClone();report["oversize"]=oversize;report["invalid"]=invalid;return report;}
    public JsonObject State()=>Snapshot();
}
