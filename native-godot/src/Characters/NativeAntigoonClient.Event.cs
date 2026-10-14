using Godot;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Net.Mp;
using Scheldemist.Town;
using Scheldemist.World;
namespace Scheldemist.Native.Characters;

public partial class NativeAntigoonClient
{
    private Townspeople town=null!;
    private readonly Dictionary<string,(Townspeople.Sim Person,JsonObject State,Vector3 Origin)> frightened=new();
    private readonly Dictionary<string,int> heard=new();
    private readonly Dictionary<int,(MeshInstance3D Mesh,JsonObject State,Vector3? Launch)> stones=new();
    private readonly HashSet<int> landedStones=new();
    private double eventTime,snapshotAge;
    private static double Num(JsonNode? n)=>n?.GetValue<double>()??0;
    private void StartStreetEvent()
    {
        town=Main.I.GetNode<Townspeople>("Townspeople");town.BeforeCrowd+=MoveFrightened;town.AfterCrowd+=PoseFrightened;town.PopulationChanged+=ClearStreetEvent;
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=WorldChanged;
    }
    private void WorldChanged(string reason,ClientState? state)=>ClearStreetEvent();
    private object ObserveStreet()=>new {people=town.Sims.Where(p=>p.P!=null&&!p.Inside&&!p.ActionHeld&&!p.InTrip&&!p.Aboard&&(NativeStreet.I==null||NativeStreet.I.Owns(p.R.Id)))
        .OrderBy(p=>actor==null?0:new Vector2((float)p.X,(float)p.Z).DistanceSquaredTo(new(actor.GlobalPosition.X,actor.GlobalPosition.Z)))
        .Take(60).Select(p=>new {id=p.R.Id,x=p.P!.X,z=p.P!.Z}).ToArray()};
    private void ApplyStreetEvent(JsonObject state)
    {
        snapshotAge=0;eventTime=Num(state["event_time"]);
        Lights.I?.SetEventExtinguished((state["extinguished"] as JsonArray??new()).Select(p=>p!.GetValue<string>()));
        var present=new HashSet<string>();int cried=0;
        foreach(var data in (state["residents"] as JsonArray??new()).OfType<JsonObject>())
        {
            string id=data["id"]!.GetValue<string>();present.Add(id);
            if(!frightened.TryGetValue(id,out var row))
            {
                var p=town.ActionPerson(id);if(p==null||p.Aboard||p.InTrip||!town.ActionHold(p,this))continue;
                p.ServerEventDriven=true;row=(p,data,p.P?.Human.Root.Position??Vector3.Zero);
            }
            frightened[id]=(row.Person,data,row.Origin);
            int scream=(int)Num(data["scream"]);
            if(heard.GetValueOrDefault(id)!=scream){heard[id]=scream;if(cried++<3)AntigoonEventAudio.Scream(Main.I.View,new((float)Num(data["x"]),(float)(town.Walk?.BaseAt(Num(data["x"]),Num(data["z"]))??0)+1.5f,(float)Num(data["z"])),scream);}
        }
        foreach(var id in frightened.Keys.Where(id=>!present.Contains(id)).ToArray())ReleaseResident(id);
        var presentRocks=new HashSet<int>();
        foreach(var data in (state["rocks"] as JsonArray??new()).OfType<JsonObject>())
        {
            int serial=(int)Num(data["serial"]);
            presentRocks.Add(serial);
            if(landedStones.Contains(serial))continue;
            if(!stones.TryGetValue(serial,out var r))
            {
                var mesh=new MeshInstance3D {Name="AntigoonThrownStone",Mesh=new SphereMesh{Radius=.17f,Height=.32f,RadialSegments=12,Rings=7},Scale=new(.85f,1.15f,1.2f),MaterialOverride=AntigoonTownMaterials.Convert(new StandardMaterial3D{AlbedoColor=new(.19f,.17f,.14f),Roughness=.97f})};
                Main.I.View.AddChild(mesh);r=(mesh,data,null);
            }
            stones[serial]=(r.Mesh,data,r.Launch);
        }
        foreach(var pair in stones.Where(p=>!presentRocks.Contains(p.Key)&&eventTime<Num(p.Value.State["impact"])).ToArray()){pair.Value.Mesh.QueueFree();stones.Remove(pair.Key);}
    }
    private void MoveFrightened(double dt)
    {
        if(!GameState.I.Playing||ServerLink.I?.Paused!=false)return;
        // Hold the latest authority during a network stall; never relight a broken lamp on timeout.
        snapshotAge+=dt;if(snapshotAge>2)return;
        foreach(var row in frightened.Values)
        {
            var p=row.Person;var s=row.State;string phase=s["phase"]!.GetValue<string>();
            if(phase=="home"){town.ActionInside(p,Num(s["x"]),Num(s["z"]));p.Door=new(Num(s["x"]),Num(s["z"]));continue;}
            town.ActionOutside(p);double tx=Num(s["x"]),tz=Num(s["z"]);
            if(phase=="flee"&&p.P is {} current&&new Vector2((float)(current.X-tx),(float)(current.Z-tz)).LengthSquared()<4)
            {
                double blend=1-Math.Exp(-dt*18),x=current.X+(tx-current.X)*blend,z=current.Z+(tz-current.Z)*blend;
                if(town.Walk?.PathFree(x,z)==true){tx=x;tz=z;}
            }
            p.X=tx;p.Z=tz;var puppet=town.ActionClaim(p);if(puppet==null)continue;
            var pose=new Pose {X=(float)p.X,Z=(float)p.Z,Yaw=(float)Num(s["yaw"]),Mode=phase=="flee"?1:0,Speed=phase=="flee"?3.2f:1};
            town.RemotePose(p,pose,puppet.Size);
        }
        double now=eventTime+Math.Min(.3,snapshotAge);
        foreach(var pair in stones.ToArray())
        {
            var (mesh,s,launch)=pair.Value;double release=Num(s["release"]),impact=Num(s["impact"]);
            if(now>=impact){AntigoonEventAudio.Impact(Main.I.View,new((float)Num(s["tx"]),(float)Num(s["ty"]),(float)Num(s["tz"])));mesh.QueueFree();stones.Remove(pair.Key);landedStones.Add(pair.Key);continue;}
            mesh.Visible=now>=release;float t=(float)Math.Clamp((now-release)/(impact-release),0,1);
            if(mesh.Visible&&launch==null&&actor!=null){launch=actor.ThrowOrigin();stones[pair.Key]=(mesh,s,launch);}
            var start=launch??new Vector3((float)Num(s["x"]),(float)Num(s["y"]),(float)Num(s["z"]));var end=new Vector3((float)Num(s["tx"]),(float)Num(s["ty"]),(float)Num(s["tz"]));
            mesh.GlobalPosition=start.Lerp(end,t)+Vector3.Up*(4*t*(1-t)*2);mesh.RotateX((float)dt*8);mesh.RotateZ((float)dt*5);
        }
    }
    private void PoseFrightened(double dt)
    {
        foreach(var row in frightened.Values)if(row.Person.P is {} p)
        {
            string phase=row.State["phase"]!.GetValue<string>();double time=Num(row.State["time"])+snapshotAge;
            float down=phase=="down"?(float)Math.Clamp(time/.35,0,1):phase=="rise"?1-(float)Math.Clamp(time/1.4,0,1):0;
            p.Human.Root.Rotation=new(phase=="flee"?.12f:Mathf.Pi*.5f*down,0,0);p.Human.Root.Position=row.Origin+Vector3.Up*(.18f*down);
        }
    }
    private void ReleaseResident(string id)
    {
        var row=frightened[id];row.Person.ServerEventDriven=false;
        if(row.Person.P is {} p){p.Human.Root.Position=row.Origin;p.Human.Root.Rotation=Vector3.Zero;p.Remote=false;}
        town.ActionRelease(row.Person,this);frightened.Remove(id);
    }
    private void ClearStreetEvent()
    {
        foreach(var id in frightened.Keys.ToArray())ReleaseResident(id);
        foreach(var r in stones.Values)if(IsInstanceValid(r.Mesh))r.Mesh.QueueFree();stones.Clear();landedStones.Clear();heard.Clear();Lights.I?.SetEventExtinguished(Array.Empty<string>());
    }
    private void StopStreetEvent()
    {
        town.BeforeCrowd-=MoveFrightened;town.AfterCrowd-=PoseFrightened;town.PopulationChanged-=ClearStreetEvent;
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=WorldChanged;
        ClearStreetEvent();
    }
}
