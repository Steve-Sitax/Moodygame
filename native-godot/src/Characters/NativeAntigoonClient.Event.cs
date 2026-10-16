using Godot;
using System;
using Scheldemist.Native.Services;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
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
    // Residents in his fist or thrown: a physics body on their own skeleton, and the street spot it is anchored to.
    private readonly Dictionary<string,(HumanRagdoll Body,Vector2 Anchor,int Throw)> limp=new();
    private static Skeleton3D? SkeletonOf(Townspeople.Sim s)=>s.P?.Human.Root.FindChildren("*","Skeleton3D",true,false).OfType<Skeleton3D>().FirstOrDefault();
    /// <summary>The neck of the resident he is after (his target id is negative), for his reaching fist.</summary>
    private Vector3? ResidentNeck(int target)
    {
        foreach(var row in frightened.Values)
            if((int)Num(row.State["target"])==target&&SkeletonOf(row.Person) is {} skeleton&&skeleton.FindBone("neck") is var neck&&neck>=0)
                return skeleton.GlobalTransform*skeleton.GetBoneGlobalRest(neck).Origin;
        return null;
    }
    private static double Num(JsonNode? n)=>n?.GetValue<double>()??0;
    private void StartStreetEvent()
    {
        town=Main.I.GetNode<Townspeople>("Townspeople");town.BeforeCrowd+=MoveFrightened;town.AfterCrowd+=PoseFrightened;town.PopulationChanged+=ClearStreetEvent;
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=WorldChanged;
    }
    private void WorldChanged(string reason,ClientState? state)=>ClearStreetEvent();
    private object ObserveStreet()=>new {yaw=Jef.I?.Yaw??0,people=town.Sims.Where(p=>p.P!=null&&!p.Inside&&!p.ActionHeld&&!p.InTrip&&!p.Aboard&&(NativeStreet.I==null||NativeStreet.I.Owns(p.R.Id)))
        .OrderBy(p=>actor==null?0:new Vector2((float)p.X,(float)p.Z).DistanceSquaredTo(new(actor.GlobalPosition.X,actor.GlobalPosition.Z)))
        .Take(60).Select(p=>new {id=p.R.Id,x=p.P!.X,z=p.P!.Z}).ToArray(),
        // The strays and cats this machine runs, near the giant: he hunts them.
        animals=actor==null||Scheldemist.People.Animals.I==null?Array.Empty<object>():Scheldemist.People.Animals.I.Wild
            .Where(a=>new Vector2((float)a.X-actor.GlobalPosition.X,(float)a.Z-actor.GlobalPosition.Z).Length()<30).Take(30)
            .Select(a=>(object)new {id=a.Id,species=a.Species,x=a.X,z=a.Z}).ToArray()};
    // The cat or dog in his fist, while he eats it.
    private (string Id,Node3D Body)? meal;
    private void Feast(JsonObject state)
    {
        var animals=Scheldemist.People.Animals.I;if(animals==null)return;
        animals.Terror=actor is {Visible:true}&&actor.State is not ("hidden" or "death")?actor.GlobalPosition:null;
        string? eating=state["meal"]?.GetValue<string>() is {} m&&m.StartsWith("beast:")&&actor?.State=="eat"?m[6..]:null;
        if(meal is {} held&&held.Id!=eating){animals.Eaten(held.Id);meal=null;}
        if(eating!=null&&meal==null&&animals.Seize(eating) is {} body)meal=(eating,body);
        foreach(var id in (state["eaten"] as JsonArray??new()).Select(n=>n!.GetValue<string>()))if(id!=eating)animals.Eaten(id);
        if(actor!=null)actor.MealAt=meal is {} hold?()=>hold.Body.GlobalPosition:null;
    }
    private void ApplyStreetEvent(JsonObject state)
    {
        Feast(state);
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
            // A body in physics stays where its skeleton was when it went limp: moving it would teleport the bones.
            if(limp.TryGetValue(p.R.Id,out var body)){tx=body.Anchor.X;tz=body.Anchor.Y;}
            if(phase=="flee"&&p.P is {} current&&new Vector2((float)(current.X-tx),(float)(current.Z-tz)).LengthSquared()<4)
            {
                double blend=1-Math.Exp(-dt*18),x=current.X+(tx-current.X)*blend,z=current.Z+(tz-current.Z)*blend;
                if(town.Walk?.PathFree(x,z)==true){tx=x;tz=z;}
            }
            p.X=tx;p.Z=tz;var puppet=town.ActionClaim(p);if(puppet==null)continue;
            var pose=new Pose {X=(float)p.X,Z=(float)p.Z,Yaw=(float)Num(s["yaw"]),Mode=phase=="flee"?1:0,Speed=phase=="flee"?3.2f:1};
            town.RemotePose(p,pose,puppet.Size);
        }
        // A caught animal hangs from his fist once he has it up.
        if(meal is {} carried&&actor!=null&&actor.HoldsMeal){carried.Body.GlobalPosition=actor.MealHand()-Vector3.Up*.25f;carried.Body.Rotation=new Vector3(Mathf.Pi*.5f,actor.Rotation.Y,0);}
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
            if(Limp(row.Person,row.State,phase))continue;
            float down=phase=="down"?(float)Math.Clamp(time/.35,0,1):phase=="rise"?1-(float)Math.Clamp(time/1.4,0,1):0;
            p.Human.Root.Rotation=new(phase=="flee"?.12f:Mathf.Pi*.5f*down,0,0);p.Human.Root.Position=row.Origin+Vector3.Up*(.18f*down);
        }
    }
    /// <summary>
    /// Held: the resident hangs by the neck from his fist under its own weight. Thrown: the body flies along the
    /// host's flight and lands as it falls. Down: it lies where it came to rest. Rising: physics lets go there.
    /// </summary>
    private bool Limp(Townspeople.Sim person,JsonObject state,string phase)
    {
        string id=person.R.Id;bool has=limp.TryGetValue(id,out var body);
        if(phase is "held" or "thrown" or "down"&&!has&&actor!=null&&SkeletonOf(person) is {} skeleton)
        {
            var human=person.P!.Human;human.Root.Rotation=Vector3.Zero;human.Root.Position=Vector3.Zero;
            var ragdoll=HumanRagdoll.Attach(skeleton,HumanRagdoll.People2,72*human.Root.Scale.Y,1);
            var hold=actor;ragdoll.Hang("neck",()=>hold.Fist()-Vector3.Up*.08f);
            body=(ragdoll,new((float)person.X,(float)person.Z),0);limp[id]=body;has=true;
        }
        if(!has)return false;
        int serial=(int)Num(state["throw"]);
        if(phase is "thrown" or "down"&&serial!=body.Throw)
        {
            // Out of the fist at the speed that reaches the host's landing spot in the flight time.
            float time=(float)Services.AntigoonNightEvent.FlightTime;var from=actor?.Fist()??body.Body.Centre;
            var to=new Vector3((float)Num(state["tx"]),(float)(town.Walk?.BaseAt(Num(state["tx"]),Num(state["tz"]))??0),(float)Num(state["tz"]));
            var velocity=(to-from)/time;velocity.Y=(to.Y-from.Y+.5f*9.8f*time*time)/time;
            body.Body.Fling(velocity,new Vector3((float)GD.RandRange(-2,2),(float)GD.RandRange(-1,1),(float)GD.RandRange(-2,2)));
            limp[id]=body with {Throw=serial};
        }
        if(phase is "rise" or "flee" or "home")
        {
            // Stand up from where the body came to rest, not from where it was anchored.
            var rest=body.Body.Centre;body.Body.Remove();limp.Remove(id);person.X=rest.X;person.Z=rest.Z;
            return false;
        }
        return true;
    }
    private void ReleaseResident(string id)
    {
        if(limp.Remove(id,out var body))body.Body.Remove();
        var row=frightened[id];row.Person.ServerEventDriven=false;
        if(row.Person.P is {} p){p.Human.Root.Position=row.Origin;p.Human.Root.Rotation=Vector3.Zero;p.Remote=false;}
        town.ActionRelease(row.Person,this);frightened.Remove(id);
    }
    private int storySound;
    /// <summary>The story's sounds: the scrape at the junction before he is seen, his steps after he is gone.</summary>
    private void StorySound(JsonObject state)
    {
        if(state["story_sound"] is not JsonObject s)return;
        int serial=(int)Num(s["serial"]);if(serial==storySound)return;storySound=serial;
        var at=new Vector3((float)Num(s["x"]),(float)Num(s["y"]),(float)Num(s["z"]));
        if(s["kind"]?.GetValue<string>()=="scrape")AntigoonEventAudio.Scrape(Main.I.View,at);else AntigoonEventAudio.Step(Main.I.View,at);
    }
    private void ClearStreetEvent()
    {
        foreach(var id in frightened.Keys.ToArray())ReleaseResident(id);
        foreach(var r in stones.Values)if(IsInstanceValid(r.Mesh))r.Mesh.QueueFree();stones.Clear();landedStones.Clear();heard.Clear();Lights.I?.SetEventExtinguished(Array.Empty<string>());
        if(meal is {} m)Scheldemist.People.Animals.I?.Eaten(m.Id);meal=null;if(Scheldemist.People.Animals.I is {} animals)animals.Terror=null;
    }
    private void StopStreetEvent()
    {
        town.BeforeCrowd-=MoveFrightened;town.AfterCrowd-=PoseFrightened;town.PopulationChanged-=ClearStreetEvent;
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=WorldChanged;
        ClearStreetEvent();
    }
}
