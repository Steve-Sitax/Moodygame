using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Windows;
namespace Scheldemist.Play;
public partial class Poesje
{
    private sealed class Bench { public Vector3 At; public Human? Human; public Node3D? Group; public string Id=""; }
    private readonly List<Bench> benches=new();
    private readonly List<Bench> standingAudience=new();
    private readonly List<InsidePerson> waitingAudience=new();
    private double audiencePoll;
    private readonly List<Interact.Entry> audiencePrompts=new();
    private Bench? sitting;
    private Scheldemist.Town.Townspeople? audienceTown;
    private readonly List<Scheldemist.Town.Townspeople.Sim> audienceClaims=new();
    private Vector3 returnAt;
    private float seatYaw,seatPitch;
    private readonly Offers benchOffers=new(){Only=new()};
    public int AudienceCount { get; private set; }
    public int ReservedAudience { get; private set; }
    public bool Seated=>sitting!=null;
    public Vector3? FreeBench {get {foreach(var b in benches)if(b.Human==null)return b.At;return null;}}
    private void PrepareAudience()
    {
        audienceTown=GetParent().GetNodeOrNull<Scheldemist.Town.Townspeople>("Townspeople");
        float aisle=maxX-.55f, left=minX+.25f, right=aisle-.45f;
        for(float z=bz-1.24f;z>foot+.6f;z-=1){int count=Math.Max(2,(int)Math.Floor((right-left)/.85f));for(int i=0;i<count;i++){var seat=new Bench{At=World(left+(i+.5f)*(right-left)/count,z-.02f,floor)};benches.Add(seat);audiencePrompts.Add(Interact.I.Add(seat.At+Vector3.Up*.44f,1,()=>Inside&&sitting==null&&seat.Human==null?"sit on the Poesje bench":null,()=>SitBench(seat)));}}
        benchOffers.Only!.Add(Act.Me(Key.E,"stand up",StandBench));Interact.I.AddProvider((_,_)=>sitting!=null?benchOffers:null);
    }
    private void SitBench(Bench seat){if(sitting!=null||seat.Human!=null)return;sitting=seat;returnAt=new(Jef.I.X,Jef.I.Y,Jef.I.Z);seatYaw=yaw+MathF.PI;seatPitch=0;Jef.I.X=seat.At.X;Jef.I.Z=seat.At.Z;Jef.I.Frozen=true;}
    private void StandBench(){if(sitting==null)return;sitting=null;Jef.I.Frozen=false;Jef.I.Place(returnAt.X,returnAt.Z,seatYaw,seatPitch,returnAt.Y);}
    private void SyncAudience(PoesjeView info)
    {
        ClearAudience();foreach(var person in info.Audience)if(!AddAudience(person))waitingAudience.Add(person);ReservedAudience=waitingAudience.Count;
    }
    private bool AddAudience(InsidePerson person)
    {
        var sim=audienceTown?.ActionPerson(person.Id);
        if(sim!=null&&!audienceTown!.ActionHold(sim,this))return false;
        var human=Humans.Make(Humans.IsKind(person.Kind)?person.Kind:person.Sex=="f"?"wife_a":person.Age<16?"boy":"docker_a");
        if(human==null){if(sim!=null)audienceTown!.ActionRelease(sim,this);return false;}
        bool sit=human.CanSit&&!person.Stand;Bench? seat=null;
        if(sit)foreach(var bench in benches)if(bench.Human==null){seat=bench;break;}
        int n=standingAudience.Count%5;float aisle=maxX-.55f,left=minX+.25f,right=aisle-.45f;
        if(seat==null){sit=false;seat=new Bench{At=n<3?World(aisle,bz-(n==0?1.2f:n==1?2.4f:3.4f),floor):World((left+right)/2+(n==3?-.5f:.5f),foot+(n==3?.25f:.3f),floor)};standingAudience.Add(seat);}
        seat.Id=person.Id;seat.Human=human;
        if(sim!=null){audienceTown!.ActionInside(sim,seat.At.X,seat.At.Z);audienceClaims.Add(sim);}
        seat.Group=new Node3D{Position=seat.At,Rotation=new(0,yaw+(sit?0:n==0?-.3f:n==1?-.2f:0),0)};seat.Group.AddChild(human.Root);Main.I.View.AddChild(seat.Group);human.Start();human.Play(sit?"sit":"idle");human.Root.Position=Vector3.Up*(sit?human.SitDrop(.44f):0);AudienceCount++;return true;
    }

    private void UpdateAudience(double dt)
    {
        if(Inside&&(audiencePoll-=dt)<=0){audiencePoll=1;for(int i=waitingAudience.Count-1;i>=0;i--)if(AddAudience(waitingAudience[i]))waitingAudience.RemoveAt(i);ReservedAudience=waitingAudience.Count;}
        UpdateAudienceGroup(benches,dt);UpdateAudienceGroup(standingAudience,dt);
        if(sitting is {} s){Jef.I.Frozen=true;Main.I.Cam.GlobalPosition=s.At+Vector3.Up*1.16f;Main.I.Cam.GlobalRotation=new(seatPitch,seatYaw,0);}
    }
    private void UpdateAudienceGroup(List<Bench> seats,double dt){foreach(var seat in seats)if(seat.Group!=null){seat.Group.Visible=Inside;if(Inside)seat.Human?.Update((float)dt);}}
    private static void ClearAudienceGroup(List<Bench> seats){foreach(var seat in seats){seat.Human?.Dispose();seat.Group?.QueueFree();seat.Human=null;seat.Group=null;seat.Id="";}}
    private void ClearAudience(){StandBench();foreach(var sim in audienceClaims){audienceTown?.ActionOutside(sim);audienceTown?.ActionRelease(sim,this);}audienceClaims.Clear();ClearAudienceGroup(benches);ClearAudienceGroup(standingAudience);standingAudience.Clear();waitingAudience.Clear();AudienceCount=0;ReservedAudience=0;audiencePoll=0;}
    public override void _Input(InputEvent e){if(sitting!=null&&Dialogs.I?.Top==null&&e is InputEventMouseMotion m){seatYaw-=m.Relative.X*Jef.TurnSens*Jef.I.LookSens;seatPitch=Math.Clamp(seatPitch-m.Relative.Y*Jef.TurnSens*Jef.I.LookSens*(Jef.I.InvertY?-1:1),-1.35f,1.35f);}}
}
