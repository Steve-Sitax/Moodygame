using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services.Multiplayer;

public sealed partial class NativeMultiplayer
{
    private NativeMpResponse HandleWho(string method,string path,NativeMpIdentity? who,JsonObject body,string address) {
        method=method.ToUpperInvariant();path=path.Split('?')[0];string route=method+" "+path;
        if(route=="GET /api/mp/info")return new(200,Info(who));
        if(route=="POST /api/mp/join") {
            if(!Enabled)return Fail(409,"The host is playing alone now. Ask him to open the game to the house.");
            if(!MayTry(address))return Fail(429,"Too many tries. Wait a minute and try again.");
            if(!SameCode(Text(settings,"code"),Text(body,"code"))){CountTry(address);return Fail(403,"That is not the code on the host's screen.");}
            if(Text(body,"fingerprint")!=Fingerprint||Number(body,"protocol")!=Protocol)return new(409,new JsonObject{["error"]="The host has another version of the native game. Both need the same download.",["protocol"]=Protocol,["fingerprint"]=Fingerprint});
            if(seats.Values.Count(s=>s.GoneAt==null&&s.Connection!=null)>=6)return Fail(409,"The town is full: 6 players at most.");
            string name=CleanGuestName(Text(body,"name"))??"Visitor";int? id=AddGuest(name,out string token);if(id==null)return Fail(409,"No room for another player.");
            CreateProfile?.Invoke(id.Value,name);SendRoster(true);return new(200,new JsonObject{["id"]=id.Value,["token"]=token,["name"]=name,["protocol"]=Protocol,["fingerprint"]=Fingerprint});
        }
        if(route=="POST /api/mp/move") {
            if(!MayTry(address))return Fail(429,"Too many tries. Wait a minute and try again.");
            string code=Text(body,"code");string hash=Hash(code);moves.Remove(hash,out var move);
            if(code.Length!=32||move.Id==0||move.Until<=C.Now||IdentityFor(move.Id)==null){CountTry(address);return Fail(403,"That link was used already or is too old (it works once, for a minute). Join with the code again.");}
            string token=RandomToken();C.Execute("UPDATE mp_player SET token_hash=$p0 WHERE id=$p1",Hash(token),move.Id);
            foreach(var conn in connections.Where(c=>c.PlayerId==move.Id).ToArray())Close(conn,4005,"moved");ClosePush?.Invoke(move.Id);
            return new(200,new JsonObject{["id"]=move.Id,["token"]=token,["name"]=NameOf(move.Id)});
        }
        if(who==null)return Fail(401,"Join the game first.");
        if(route=="POST /api/mp/transfer") {
            if(!who.Guest)return Fail(403,"Only a guest moves to another address: the host plays on his own PC.");
            foreach(string key in moves.Where(x=>x.Value.Id==who.Id||x.Value.Until<=C.Now).Select(x=>x.Key).ToArray())moves.Remove(key);
            string code=RandomToken();moves[Hash(code)]=(who.Id,C.Now+60000);return new(200,new JsonObject{["code"]=code,["ttl_s"]=60});
        }
        bool settingsRight=who.Host||who.Admin;
        if(route=="GET /api/mp/host") { if(!settingsRight)return Fail(403,"Only the host sees this.");var result=HouseView();result["code"]=settings["code"]!.DeepClone();result["players"]=Roster();result["pausedAll"]=host.Saves.PausedAll;return new(200,result); }
        if(route=="GET /api/mp/stats")return settingsRight?new(200,Stats()):Fail(403,"Only the host sees this.");
        if(route=="POST /api/mp/config") {
            if(!settingsRight)return Fail(403,"Only the host may change this.");bool wasEnabled=Enabled;foreach(string key in new[]{"multiplayer","lan","vpn"})if(body[key] is JsonValue v&&v.TryGetValue<bool>(out bool value))settings[key]=value;
            if(Bool(settings,"lan")||Bool(settings,"vpn"))settings["multiplayer"]=true;if(wasEnabled!=Enabled)host.Saves.MultiplayerModeChanged(Enabled);SaveSettings();SettingsChanged?.Invoke(settings.DeepClone().AsObject());
            if(!Enabled) { host.Saves.SetPausedAll(false);foreach(var conn in connections.ToArray())Close(conn,4004,"not together"); }
            host.Publish("mp",new JsonObject{["multiplayer"]=Enabled});var result=HouseView();result["code"]=settings["code"]!.DeepClone();return new(200,result);
        }
        if(route=="POST /api/mp/code") { if(!settingsRight)return Fail(403,"Only the host may change this.");settings["code"]=NewCode();SaveSettings();return new(200,new JsonObject{["code"]=settings["code"]!.DeepClone()}); }
        if(route=="POST /api/mp/kick") {
            if(!settingsRight)return Fail(403,"Only the host may remove a player.");double raw=Number(body,"id",double.NaN);if(!double.IsFinite(raw)||raw!=Math.Truncate(raw)||raw<=1||raw>65535)return Fail(400,"no such player");int id=(int)raw;
            if(seats.TryGetValue(id,out var seat)&&seat.Connection!=null) { Send(seat.Connection,new JsonObject{["type"]="kicked"});Close(seat.Connection,4003,"removed by the host"); }
            PlayerLeft?.Invoke(id,PosePoint(seat?.State));seats.Remove(id);http.Remove(id);ClosePush?.Invoke(id);
            foreach(string key in moves.Where(x=>x.Value.Id==id).Select(x=>x.Key).ToArray())moves.Remove(key);
            bool okay=C.Execute("DELETE FROM mp_player WHERE id=$p0",id)>0;SendRoster(true);return new(200,new JsonObject{["ok"]=okay});
        }
        if(route=="POST /api/mp/admin") {
            if(!who.Host)return Fail(403,"Only the host may do this.");double raw=Number(body,"id",double.NaN);if(!double.IsFinite(raw)||raw!=Math.Truncate(raw)||raw<2||raw>65535||IdentityFor((int)raw)==null||body["on"] is not JsonValue v||!v.TryGetValue<bool>(out bool on))return Fail(400,"no such player");
            C.Execute("UPDATE mp_player SET admin=$p0 WHERE id=$p1",on?1:0,(int)raw);SendRoster(true);return new(200,new JsonObject{["ok"]=true});
        }
        if(route=="POST /api/mp/pause-all") {
            if(!who.Host)return Fail(403,"Only the host may pause the town.");if(body["on"] is not JsonValue v||!v.TryGetValue<bool>(out bool on))return Fail(400,"on must be true or false");host.Saves.SetPausedAll(on);
            SendAll(new JsonObject{["type"]="pause_all",["on"]=on});host.Publish("mp_pause_all",new JsonObject{["on"]=on});return new(200,new JsonObject{["pausedAll"]=on});
        }
        return Fail(404,"no such multiplayer route");
    }
}
