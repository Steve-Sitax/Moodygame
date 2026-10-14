using System;
using System.IO;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Native.Services;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;

namespace Scheldemist.Native.Characters;

internal static class AntigoonServiceProof
{
    public static async Task Run()
    {
        long now=1000;bool multiplayer=false;
        string data=ProjectSettings.GlobalizePath("res://services/data");
        using var host=new NativeServiceHost(new NativeServiceOptions(":memory:",data,Path.Combine(Path.GetTempPath(),"antigoon-proof-unused"),()=>now));
        host.MultiplayerEnabled=()=>multiplayer;host.Saves.EnsurePlayer(2,"Second player");host.OnlinePlayers=()=>multiplayer?new[]{1,2}:new[]{1};
        host.Clock.SetTime(1,22,0);
        var position=new P(0,2);
        var service=new NativeAntigoon(host){PositionOf=_=>position,Clear=_=>true,Light=_=>0,Ground=_=>0,Sight=(_,_)=>true,Path=(_,b)=>new[]{b}};
        host.AddModule(service);
        async Task<JsonObject> Call(string method,string path,int player=1)=>JsonNode.Parse(await host.Call(method,"/api/antigoon"+path,"{}",player))!.AsObject();
        int checks=0;void Check(bool yes,string title){if(!yes)throw new Exception("Antigoon service: "+title);checks++;GD.Print("PASS "+title);}
        var initial=await Call("GET","");Check(initial["active"]!.GetValue<bool>()==false,"visible spawn candidates are rejected");
        host.Context.SetWorld("antigoon",new JsonObject{["x"]=0,["z"]=0,["hx"]=0,["hz"]=0,["health"]=120});
        await Call("POST","/investigate");now+=100;var first=await Call("GET","");Check(first["state"]!.GetValue<string>()=="attack","saved enemy restores into authoritative encounter");
        var again=await Call("GET","");Check(again["state_time"]!.GetValue<double>()==first["state_time"]!.GetValue<double>(),"extra polls cannot accelerate simulation");
        host.Saves.SetPausedAll(true);now+=500;
        var paused=await Call("GET","");Check(paused["state_time"]!.GetValue<double>()==first["state_time"]!.GetValue<double>(),"host pause freezes enemy");
        bool refused=false;try{await Call("POST","/strike");}catch(NativeServiceException e){refused=e.Status==409;}Check(refused,"combat rejected while paused");host.Saves.SetPausedAll(false);
        multiplayer=true;refused=false;try{await Call("POST","/investigate",2);}catch(NativeServiceException e){refused=e.Status==409;}Check(refused,"scripted quest unavailable in multiplayer");
        now+=100;var peer=await Call("GET","",2);var owner=await Call("GET","");Check(peer["state_time"]!.ToJsonString()==owner["state_time"]!.ToJsonString()&&peer["attack_serial"]!.ToJsonString()==owner["attack_serial"]!.ToJsonString(),"both players receive the same giant state");
        position=new(0,20);var far=await Call("POST","/strike",2);Check(!far["hit"]!.GetValue<bool>()&&far["health"]!.GetValue<int>()==120,"server rejects distant player hit");
        position=new(0,2);var hit=await Call("POST","/strike",2);Check(hit["hit"]!.GetValue<bool>()&&hit["health"]!.GetValue<int>()==105,"server applies valid player damage");
        var repeated=await Call("POST","/strike",2);Check(!repeated["hit"]!.GetValue<bool>(),"server rate limits repeated strikes");
        Check(host.Context.World("antigoon")!["health"]!.GetValue<int>()==105,"enemy health persisted immediately");
        host.Context.SetWorld("townlife_lamps",new JsonObject{["rounds"]=new JsonArray()});
        var lights=new NativeStreetLighting(host,()=>new JsonArray(new JsonObject{["id"]="test-lamp",["x"]=0,["z"]=0,["y"]=4}));
        host.Clock.SetTime(3,22,0);Check(lights.At(0,0)>.8,"working lamp protects its street");lights.Extinguish("test-lamp");
        Check(lights.At(0,0)==0&&lights.Disabled().Contains("test-lamp"),"broken lamp removes authoritative illumination");
        host.Clock.SetTime(4,0,30);Check(lights.Disabled().Contains("test-lamp"),"lamp outage survives midnight");
        host.Clock.SetTime(4,19,59);Check(lights.Disabled().Contains("test-lamp"),"lamp remains disabled until following night");
        host.Clock.SetTime(4,20,0);Check(!lights.Disabled().Contains("test-lamp")&&lights.At(0,0)>.8,"following night restores lamp");
        host.Clock.SetTime(5,2,0);lights.Extinguish("test-lamp");host.Clock.SetTime(5,20,0);Check(!lights.Disabled().Contains("test-lamp"),"after-midnight damage expires at that evening");
        using var autoHost=new NativeServiceHost(new NativeServiceOptions(":memory:",data,Path.Combine(Path.GetTempPath(),"antigoon-auto-proof-unused"),()=>now));
        autoHost.Clock.SetTime(1,22,0);
        var automatic=new NativeAntigoon(autoHost){PositionOf=_=>new P(0,0),Clear=_=>true,BackAlley=_=>true,Light=_=>0,Sight=(_,_)=>true,SpawnVisible=(_,_)=>false,Path=(_,b)=>new[]{b},HumanClear=_=>true,HumanPath=(_,b)=>new[]{b},MayObserve=(p,id)=>p==1&&id=="witness",ResidentHome=_=>new P(0,90)};
        autoHost.AddModule(automatic);await autoHost.Call("GET","/api/antigoon",null);now+=100;
        var automaticView=JsonNode.Parse(await autoHost.Call("GET","/api/antigoon",null))!;
        Check(automaticView["active"]!.GetValue<bool>()&&automaticView["quest"]==null,"night street event starts without investigation quest");
        autoHost.Saves.EnsurePlayer(2,"Observer");
        string observation=new JsonObject{["people"]=new JsonArray(new JsonObject{["id"]="witness",["x"]=0,["z"]=31})}.ToJsonString();
        now+=100;var denied=JsonNode.Parse(await autoHost.Call("POST","/api/antigoon/observe",observation,2))!;
        Check(denied["residents"]!.AsArray().Count==0,"peer cannot submit a resident it does not own");
        now+=100;var panic=JsonNode.Parse(await autoHost.Call("POST","/api/antigoon/observe",observation,1))!;
        Check(panic["residents"]!.AsArray().Count==1,"owned outdoor witness enters host panic simulation");
        var shared=JsonNode.Parse(await autoHost.Call("GET","/api/antigoon",null,2))!;
        Check(shared["residents"]!.ToJsonString()==panic["residents"]!.ToJsonString(),"both peers receive identical resident panic state");
        automatic.DevelopmentStage=_=>(new P(0,28),new P(0,18));autoHost.Clock.SetTime(1,13,0);autoHost.Saves.SetPausedAll(true);
        var selected=JsonNode.Parse(await autoHost.Call("POST","/api/dev/antigoon","{}",1))!;
        Check(selected["active"]!.GetValue<bool>()&&selected["health"]!.GetValue<int>()==120,"development event starts fresh while Events panel pauses the town");
        Check(NativeGoods.Number(autoHost.Clock.View()["hour"])==22&&selected["watch_z"]!.GetValue<double>()==18&&selected["world"]!=null,"development event sets night and returns viewing position and current world");
        refused=false;try{await autoHost.Call("POST","/api/dev/antigoon","{}",2);}catch(NativeServiceException ex){refused=ex.Status==403;}Check(refused,"only the multiplayer host can start development encounter");
        autoHost.Clock.SetTime(1,14,12);automatic.DevelopmentStage=_=>null;
        refused=false;try{await autoHost.Call("POST","/api/dev/antigoon","{}",1);}catch(NativeServiceException ex){refused=ex.Status==409;}
        Check(refused&&NativeGoods.Number(autoHost.Clock.View()["hour"])==14&&NativeGoods.Number(autoHost.Clock.View()["minute"])==12,"unavailable development stage reports failure and preserves clock");
        GD.Print($"ANTIGOON_SERVICE_PASS {checks} checks");
    }
}
