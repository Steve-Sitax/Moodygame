using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Scheldemist.Net.Mp;

namespace Scheldemist.Native.Services.Multiplayer;

public sealed partial class NativeMultiplayer
{
    private sealed class Seat {
        public required int Id; public required NativeMpPlausible Plausible; public NativeMpState? State; public readonly List<NativeMpState> Recent=new();
        public long At,PosedAt,BytesIn; public NativeMpConnection? Connection; public readonly List<long> Times=new(); public long? GoneAt;
        public readonly NativeMpSeatLimiter Limits=new();
    }
    private readonly Dictionary<int,Seat> seats=new();
    private readonly HashSet<NativeMpConnection> connections=new();
    private readonly NativeMpOwners owners=new();
    private readonly NativeMpWorldPc world=new();
    private readonly Dictionary<int,long> puppetsAt=new(),figHeldAt=new();
    private readonly Dictionary<int,(long Start,int Count)> figRate=new();
    private IReadOnlyDictionary<string,int> pins=new Dictionary<string,int>();private long pinsAt=-1000;
    private string pinsKey="[]",rosterKey="";private string? lastWorld;
    private byte[]? lastCompressedWorld;
    private readonly Dictionary<int,NativeMpBucket> worldPacketRate=new();
    private int pinTick,mapTick;private bool mapHadSeats;
    private readonly JsonObject streetStats=new(){["puppetBatches"]=0,["puppetsIn"]=0,["worldChanges"]=0,["skipped"]=0,["figBatches"]=0,["figDropped"]=0,["limitDropped"]=0,["floodClosed"]=0,["deadClosed"]=0};
    private void Count(string key,int n=1)=>streetStats[key]=(streetStats[key]?.GetValue<int>()??0)+n;
    public NativeMpConnection OpenPeer(NativeMpPeer peer,string remoteAddress) { var conn=new NativeMpConnection(peer,remoteAddress,C.Now);connections.Add(conn);if(!AllowRemote(remoteAddress))Close(conn,4001,"network not open");return conn; }
    public void ReceiveText(NativeMpConnection conn,string text) {
        if(conn.Closed||!conn.Peer.IsOpen())return;if(Encoding.UTF8.GetByteCount(text)>65536){Close(conn,1009,"message too large");return;}conn.Alive=true;
        JsonObject? message;try{message=JsonNode.Parse(text) as JsonObject;}catch(JsonException){return;}if(message==null)return;
        if(conn.Identity==null) { if(Text(message,"type")!="hello")return;Hello(conn,message);return; }
        if(!seats.TryGetValue(conn.PlayerId,out var seat)||seat.Connection!=conn)return;
        if(!Limited(conn,seat,text.StartsWith("{\"type\":\"world\"",StringComparison.Ordinal)?"world":"text"))return;
        string type=Text(message,"type");
        if(type=="ping"&&message["c"]!=null&&double.IsFinite(Number(message,"c",double.NaN)))Send(conn,new JsonObject{["type"]="pong",["c"]=message["c"]!.DeepClone(),["s"]=C.Now});
        else if(type=="claim"&&message["ids"] is JsonArray requested) {
            var current=PinsNow();var result=owners.Claim(seat.Id,Strings(requested),Bool(message,"steal"),id=>current.TryGetValue(id,out int p)?p:null);
            if(result.Changes.Count>0){if(!puppetsAt.ContainsKey(seat.Id))puppetsAt[seat.Id]=C.Now;SendAll(new JsonObject{["type"]="owners",["list"]=result.Changes});}if(result.Denied.Count>0)Send(conn,new JsonObject{["type"]="owners",["list"]=result.Denied});
        }
        else if(type=="release"&&message["ids"] is JsonArray released) { var changes=owners.Release(seat.Id,Strings(released),Strings(message["gone"] as JsonArray));if(changes.Count>0)SendAll(new JsonObject{["type"]="owners",["list"]=changes}); }
        else if(type=="ask"&&message["what"] is JsonValue what&&what.TryGetValue<string>(out string? request)&&message["args"] is JsonArray args&&args.Count<=4) {
            var target=connections.FirstOrDefault(c=>c.PlayerId==world.Id&&!c.Closed);if(target!=null&&target!=conn)Send(target,new JsonObject{["type"]="asked",["from"]=seat.Id,["what"]=request[..Math.Min(20,request.Length)],["args"]=args.DeepClone()});
        }
        else if(type=="world"&&double.IsFinite(Number(message,"t",double.NaN))&&message["d"] is JsonObject data&&seat.Id==world.Id) {
            world.Heard(C.Now);MapWorld?.Invoke(Number(message,"t"),data.DeepClone().AsObject());lastWorld=text;lastCompressedWorld=null;seat.BytesIn+=Encoding.UTF8.GetByteCount(text);foreach(var receiver in connections)if(receiver!=conn&&!Lagging(receiver))SendRaw(receiver,text);
        }
    }
    private static IEnumerable<string> Strings(JsonArray? values)=>values?.Take(200).OfType<JsonValue>().Select(v=>v.TryGetValue<string>(out var s)?s:null).Where(s=>s!=null).Cast<string>()??Array.Empty<string>();
    private void Hello(NativeMpConnection conn,JsonObject hello) {
        if(Number(hello,"protocol")!=Protocol||Text(hello,"fingerprint")!=Fingerprint) { Send(conn,new JsonObject{["type"]="old",["protocol"]=Protocol,["fingerprint"]=Fingerprint});Close(conn,4002,"old version");return; }
        if(!Enabled) { Send(conn,new JsonObject{["type"]="refused",["why"]="The host is playing alone now."});Close(conn,4004,"not together");return; }
        var who=Identity(Text(hello,"token"));if(who==null) { Send(conn,new JsonObject{["type"]="refused",["why"]="Join the game first."});Close(conn,4001,"who");return; }
        if(!seats.ContainsKey(who.Id)&&seats.Values.Count(s=>s.GoneAt==null&&s.Connection!=null)>=6) { Send(conn,new JsonObject{["type"]="refused",["why"]="The town is full: 6 players at most."});Close(conn,4004,"full");return; }
        (EnsurePlayer??host.Saves.EnsurePlayer)(who.Id,NameOf(who.Id));conn.Identity=who;
        if(!seats.TryGetValue(who.Id,out var seat))seats[who.Id]=seat=new Seat{Id=who.Id,Plausible=new(who.Host)};
        var previous=seat.Connection;seat.Connection=conn;seat.GoneAt=null;
        if(previous!=null&&previous!=conn)Close(previous,4005,"taken over");
        seat.Plausible=new(who.Host);seat.Recent.Clear();
        Send(conn,new JsonObject{["type"]="welcome",["id"]=who.Id,["host"]=who.Host,["name"]=NameOf(who.Id),["pose"]=who.Host?null:SavedPose(who.Id),["serverNow"]=C.Now,["protocol"]=Protocol,["fingerprint"]=Fingerprint});SendRoster(true);
        Send(conn,new JsonObject{["type"]="owners",["full"]=true,["list"]=owners.List()});Send(conn,new JsonObject{["type"]="worldpc",["id"]=world.Id});Send(conn,PinsMessage());
        if(host.Saves.PausedAll)Send(conn,new JsonObject{["type"]="pause_all",["on"]=true});if(world.Id!=who.Id){if(lastCompressedWorld!=null)SendBinary(conn,lastCompressedWorld);else if(lastWorld!=null)SendRaw(conn,lastWorld);}
    }
    private bool Limited(NativeMpConnection conn,Seat seat,string kind) {
        if(conn.Identity!.Host)return true;string result=seat.Limits.Message(kind,C.Now);if(result=="ok")return true;if(result=="drop"){Count("limitDropped");return false;}
        Count("floodClosed");Send(conn,new JsonObject{["type"]="refused",["why"]="The host's game closed the line: this PC sent far more than the game ever sends. Reconnect to come back."});Close(conn,4006,"flood");return false;
    }
    public void ReceiveBinary(NativeMpConnection conn,byte[] data) {
        if(conn.Closed||!conn.Peer.IsOpen()||conn.Identity==null)return;conn.Alive=true;if(data.Length>65536){Close(conn,1009,"message too large");return;}if(data.Length==0||!seats.TryGetValue(conn.PlayerId,out var seat)||seat.Connection!=conn)return;
        byte type=data[0];
        if(type==NativeWorldPacket.Kind){
            // Refuse unauthorized senders and excess frequency before allocating/decompressing anything.
            if(seat.Id!=world.Id||!Limited(conn,seat,"world"))return;
            if(!worldPacketRate.TryGetValue(seat.Id,out var bucket))worldPacketRate[seat.Id]=bucket=new(18,30,C.Now);
            if(!bucket.Take(C.Now)){Count("worldRateDropped");return;}
            if(!NativeWorldPacket.TryDecode(data,out double time,out var scene)){Count("worldInvalid");return;}
            world.Heard(C.Now);lastCompressedWorld=(byte[])data.Clone();lastWorld=null;seat.BytesIn+=data.Length;MapWorld?.Invoke(time,scene!);BroadcastBinary(conn,lastCompressedWorld);Count("worldPackets");return;
        }
        if(!Limited(conn,seat,type==3?"puppets":type==4?"figs":type==5?"animals":"state"))return;seat.BytesIn+=data.Length;
        if(type==4) {
            if(!NativeMpProtocol.ValidBatch(data,4)||!FiguresOkay(seat.Id,data[1]==0))return;byte[] output=(byte[])data.Clone();BinaryPrimitives.WriteUInt16LittleEndian(output.AsSpan(2),(ushort)seat.Id);Count("figBatches");BroadcastBinary(conn,output);return;
        }
        if(type==3||type==5) {
            if(!NativeMpProtocol.ValidBatch(data,type))return;puppetsAt[seat.Id]=C.Now;byte[] output=NativeMpProtocol.KeepOwned(data,n=>owners.Owns(seat.Id,n));if(output[1]==0)return;
            if(type==3){Count("puppetBatches");Count("puppetsIn",output[1]);MapPuppets?.Invoke(seat.Id,output);}BroadcastBinary(conn,output);return;
        }
        var state=NativeMpProtocol.DecodeState(data);if(state==null)return;var verdict=seat.Plausible.Check(state,C.Now);if(!verdict.Ok)return;
        if(verdict.Anchored||(seat.State!=null&&seat.Plausible.Stats["accepted"]!.GetValue<int>()==1))state=state with{Flags=state.Flags|32};
        bool first=seat.State==null,awayWas=(seat.State?.Flags&16)!=0;seat.State=state;seat.Recent.Add(state);if(seat.Recent.Count>8)seat.Recent.RemoveAt(0);seat.At=C.Now;seat.Times.Add(C.Now);seat.Times.RemoveAll(t=>C.Now-t>2000);
        if(first||((state.Flags&16)!=0)!=awayWas)SendRoster(true);Forward(seat,state);
        if(C.Now-seat.PosedAt>5000){seat.PosedAt=C.Now;if(seat.Id!=1)C.Execute("UPDATE mp_player SET pose_json=$p0,seen_at=$p1 WHERE id=$p2",Pose(state,true).ToJsonString(),Stamp,seat.Id);}
    }
    private static JsonObject Pose(NativeMpState state,bool round=false)=>new(){["x"]=round?Math.Round(state.X,2,MidpointRounding.AwayFromZero):state.X,["y"]=round?Math.Round(state.Y,2,MidpointRounding.AwayFromZero):state.Y,["z"]=round?Math.Round(state.Z,2,MidpointRounding.AwayFromZero):state.Z,["yaw"]=round?Math.Round(state.Yaw,3,MidpointRounding.AwayFromZero):state.Yaw};
    private static JsonObject? PosePoint(NativeMpState? state)=>state==null?null:new(){["x"]=state.X,["z"]=state.Z};
    private JsonObject? SavedPose(int player) { string? value=C.Scalar<string>("SELECT pose_json FROM mp_player WHERE id=$p0",player);try {var pose=string.IsNullOrEmpty(value)?null:JsonNode.Parse(value) as JsonObject;return pose!=null&&new[]{"x","y","z","yaw"}.All(k=>double.IsFinite(Number(pose,k,double.NaN)))?pose:null;}catch(JsonException){return null;} }
    public void Closed(NativeMpConnection conn) {
        if(conn.Closed)return;conn.Closed=true;connections.Remove(conn);if(conn.PlayerId==0)return;
        if(seats.TryGetValue(conn.PlayerId,out var seat)&&seat.Connection==conn) { seat.Connection=null;seat.GoneAt=C.Now;var changes=owners.DropAll(seat.Id);if(changes.Count>0)SendAll(new JsonObject{["type"]="owners",["list"]=changes});ChooseWorld(); }
    }
    private void Close(NativeMpConnection conn,int code,string reason) { if(conn.Closed)return;Closed(conn);conn.Peer.Close(code,reason); }
    public void Pong(NativeMpConnection conn)=>conn.Alive=true;
    public void Heartbeat(long now) {
        foreach(var conn in connections.ToArray()) { if(conn.Identity==null) { if(now>=conn.HelloBy)Close(conn,4001,"no hello");continue; }
            if(!conn.Alive){Count("deadClosed");Close(conn,4000,"no heartbeat");continue;}conn.Alive=false;conn.Peer.Ping?.Invoke(); }
    }
    public void Heartbeat()=>Heartbeat(C.Now);
    private void Send(NativeMpConnection conn,JsonObject value)=>SendRaw(conn,value.ToJsonString());
    private void SendRaw(NativeMpConnection conn,string value) { if(conn.Closed||!conn.Peer.IsOpen())return;conn.BytesOut+=Encoding.UTF8.GetByteCount(value);conn.Peer.SendText(value); }
    private void SendBinary(NativeMpConnection conn,byte[] value) { if(conn.Closed||!conn.Peer.IsOpen())return;conn.BytesOut+=value.Length;conn.Peer.SendBinary(value); }
    private void SendAll(JsonObject message) { foreach(var conn in connections)if(conn.Identity!=null)Send(conn,message);if(Text(message,"type")=="owners"&&message["list"] is JsonArray list)MapOwners?.Invoke(list.DeepClone().AsArray(),Bool(message,"full")); }
    private bool Lagging(NativeMpConnection conn) { if(conn.Peer.BufferedBytes()<=65536)return false;Count("skipped");return true; }
    private void BroadcastBinary(NativeMpConnection from,byte[] data) { foreach(var conn in connections)if(conn!=from&&conn.Identity!=null&&!Lagging(conn))SendBinary(conn,data); }
    private void Forward(Seat seat,NativeMpState state) { foreach(var conn in connections) { if(conn.Identity==null||conn.PlayerId==seat.Id||Lagging(conn))continue;var mine=seats.GetValueOrDefault(conn.PlayerId)?.State;if(mine!=null&&Distance(state,mine)>150)continue;SendBinary(conn,NativeMpProtocol.EncodeBatch(C.Now,new[]{(seat.Id,state)}));conn.Sent[seat.Id]=(state.Seq,C.Now); } }
    private static double Distance(NativeMpState a,NativeMpState b)=>Math.Sqrt(Math.Pow(a.X-b.X,2)+Math.Pow(a.Z-b.Z,2));
    public int[] OnlineIds()=>Enabled?seats.Values.Where(s=>s.GoneAt==null&&s.Connection!=null&&s.State!=null&&C.Now-s.At<30000).Select(s=>s.Id).ToArray():new[]{1};
    public JsonObject? Position(int player) { if(!Enabled)return null;var seat=seats.GetValueOrDefault(player);return seat?.State!=null&&seat.GoneAt==null&&C.Now-seat.At<5000?PosePoint(seat.State):null; }
    public int? Walker(string npc) { if(!Enabled)return null;int? number=owners.NumberOf(npc);return number==null?0:owners.OwnerOf(number.Value); }
    private IReadOnlyDictionary<string,int> PinsNow() { if(C.Now-pinsAt>=250) { pinsAt=C.Now;pins=Pins?.Invoke(OnlineIds())??DefaultPins(OnlineIds());foreach(int id in FigureHolders?.Invoke()??DefaultFigureHolders())figHeldAt[id]=C.Now; }return pins; }
    private JsonObject PinsMessage()=>new(){["type"]="pins",["list"]=new JsonArray(PinsNow().OrderBy(x=>x.Key,StringComparer.Ordinal).Select(x=>(JsonNode)new JsonArray(x.Key,x.Value)).ToArray())};
    private bool FiguresOkay(int player,bool empty) { if(!figRate.TryGetValue(player,out var rate)||C.Now-rate.Start>=1000)rate=(C.Now,1);else rate.Count++;figRate[player]=rate;if(rate.Count>15){Count("figDropped");return false;}if(empty)return true;PinsNow();if(figHeldAt.TryGetValue(player,out long at)&&C.Now-at<=10000)return true;Count("figDropped");return false; }
    private void ChooseWorld() { int? id=world.Choose(seats.Values.Select(s=>new NativeMpWorldSeat(s.Id,s.Id==1,s.GoneAt==null&&s.Connection!=null,s.At,s.Times.Count(x=>C.Now-x<=2000)/2.0)).ToArray(),C.Now);if(id==null)return;Count("worldChanges");SendAll(new JsonObject{["type"]="worldpc",["id"]=id.Value}); }
    public JsonArray Roster() { var ids=new[]{1}.Concat(C.Rows("SELECT id FROM mp_player ORDER BY id").Select(r=>(int)Number(r!.AsObject(),"id"))).Distinct();return new JsonArray(ids.Select(id=>{var seat=seats.GetValueOrDefault(id);bool online=seat!=null&&(seat.GoneAt==null||C.Now-seat.GoneAt<30000);return (JsonNode)new JsonObject{["id"]=id,["name"]=NameOf(id),["code"]=Profile==null?"":Text(Profile(id),"code"),["host"]=id==1,["admin"]=id==1||IdentityFor(id)?.Admin==true,["away"]=seat?.State!=null&&(seat.State.Flags&16)!=0,["online"]=online&&seat!.State!=null};}).ToArray()); }
    public void SendRoster(bool force=false) { var list=Roster();string key=list.ToJsonString();if(!force&&key==rosterKey)return;rosterKey=key;SendAll(new JsonObject{["type"]="roster",["players"]=list}); }
    public void Relay(long now) {
        foreach(var conn in connections.ToArray()) { if(conn.Identity==null){if(now>=conn.HelloBy)Close(conn,4001,"no hello");continue;}if(!conn.Peer.IsOpen()||Lagging(conn))continue;var mine=seats.GetValueOrDefault(conn.PlayerId)?.State;var list=new List<(int,NativeMpState)>();
            foreach(var seat in seats.Values) { if(seat.Id==conn.PlayerId||seat.State==null||seat.GoneAt!=null)continue;bool have=conn.Sent.TryGetValue(seat.Id,out var last),far=mine!=null&&Distance(seat.State,mine)>150,fresh=!have||last.Seq!=seat.State.Seq;if(have&&now-last.At<(far?500:fresh?0:1000))continue;
                var since=fresh&&!far&&have?seat.Recent.Where(s=>s.Seq>last.Seq).TakeLast(4).ToArray():Array.Empty<NativeMpState>();foreach(var state in since.Length>0?since:new[]{seat.State})list.Add((seat.Id,state));conn.Sent[seat.Id]=(seat.State.Seq,now);
            }
            if(list.Count>0)SendBinary(conn,NativeMpProtocol.EncodeBatch(now,list));
        }
        foreach(var pair in puppetsAt.ToArray())if(now-pair.Value>=3000) { puppetsAt.Remove(pair.Key);var changes=owners.DropAll(pair.Key);if(changes.Count>0)SendAll(new JsonObject{["type"]="owners",["list"]=changes}); }
        ChooseWorld();if(connections.Count>0&&++pinTick%10==0){var message=PinsMessage();string key=message["list"]!.ToJsonString();if(key!=pinsKey){pinsKey=key;SendAll(message);}}
        foreach(var seat in seats.Values.ToArray())if(seat.GoneAt!=null&&now-seat.GoneAt>30000){seats.Remove(seat.Id);PlayerLeft?.Invoke(seat.Id,PosePoint(seat.State));SendAll(new JsonObject{["type"]="went",["id"]=seat.Id,["name"]=NameOf(seat.Id)});SendRoster(true);}
        if(MapPlayers!=null&&++mapTick%5==0) { if(!Enabled||seats.Count==0){if(mapHadSeats)MapPlayers(new());mapHadSeats=false;}else{mapHadSeats=true;MapPlayers(new JsonArray(seats.Values.Where(s=>s.State!=null).Select(s=>(JsonNode)new JsonObject{["id"]=s.Id,["name"]=NameOf(s.Id),["host"]=s.Id==1,["x"]=s.State!.X,["y"]=s.State.Y,["z"]=s.State.Z,["yaw"]=s.State.Yaw,["vx"]=s.State.Vx,["vz"]=s.State.Vz,["mode"]=new[]{"walk","crouch","swim","climb","ladder","ride","bike","row","fly","sit"}[s.State.Mode],["away"]=(s.State.Flags&16)!=0,["online"]=s.GoneAt==null}).ToArray()));} }
    }
    public void Relay()=>Relay(C.Now);
    public JsonObject Stats() { var result=streetStats.DeepClone().AsObject();result["corrections"]=0;result["worldPc"]=world.Id;result["http429"]=httpTotal;result["players"]=new JsonArray(seats.Values.Select(s=>{var row=s.Plausible.Stats.DeepClone().AsObject();row["id"]=s.Id;row["name"]=NameOf(s.Id);row["online"]=s.GoneAt==null;row["bytesIn"]=s.BytesIn;row["bytesOut"]=s.Connection?.BytesOut??0;row["walks"]=owners.Count(s.Id);row["limited"]=s.Limits.Dropped.DeepClone();row["http429"]=httpRefused.GetValueOrDefault(s.Id);return (JsonNode)row;}).ToArray());return result; }
    private void ResetWorld() { owners.Clear();world.Reset();lastWorld=null;lastCompressedWorld=null;puppetsAt.Clear();figHeldAt.Clear();figRate.Clear();pinsAt=-1000;pins=new Dictionary<string,int>();pinsKey="[]";foreach(var seat in seats.Values){seat.State=null;seat.Recent.Clear();seat.Plausible=new(seat.Id==1);seat.Times.Clear();seat.Connection?.Sent.Clear();}SendAll(new JsonObject{["type"]="owners",["full"]=true,["list"]=new JsonArray()});SendAll(new JsonObject{["type"]="worldpc",["id"]=0});SendRoster(true); }
    public void Stop() { foreach(var conn in connections.ToArray())Close(conn,1001,"game closing");moves.Clear(); }
}
