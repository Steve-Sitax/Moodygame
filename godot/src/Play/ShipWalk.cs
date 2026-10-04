using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;
using Scheldemist.Models;
using Scheldemist.Net;
using Scheldemist.Movers;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

[GamePart(926)]
public partial class ShipWalk:Node
{
    public static ShipWalk I {get;private set;}=null!;
    public sealed class Deck
    {
        public string Kind="";public Func<Transform3D> World=null!;public Func<bool> Visible=()=>true;public MeshDeck Mesh=null!;
        public Vector3 At(Vector2 p)=>World()*new Vector3(p.X,Mesh.Floor(p.X,p.Y),p.Y);
    }
    public readonly List<Deck> Decks=new();
    public Deck? On {get;private set;}
    public Vector2 Local {get;private set;}
    private readonly Dictionary<string,MeshDeck> floors=new();
    private readonly Func<float,bool> drive;
    private Func<bool>? oldJump;
    private Func<float,float,float,float>? oldFloor;
    private float lastYaw;
    private int floats,epoch;
    public ShipWalk(){I=this;drive=Drive;rampDrive=WalkRamp;Solid.Leave.Add(IsBrigRamp);}
    public override void _Ready()
    {
        ProcessPriority=-1;var library=ModelLibrary.Get("boats",new(TwoSided:true,Affine:.6));
        if(library!=null)foreach(var (kind,model) in library.Roots)
        {var dim=Boats.I.Dims(kind);if(dim.Length<9||kind=="pontoon_section")continue;floors[kind]=new(model,-dim.Beam/2,dim.Beam/2,-dim.Length/2,dim.Length/2,kind=="brig"?2.25f:.45f,.25f);}
        foreach(var (kind,frame) in Boats.I.MooredFrames())if(floors.TryGetValue(kind,out var mesh))Decks.Add(new(){Kind=kind,World=frame,Mesh=mesh});CollectFloats();
        FindGangway();
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Replaced;
        oldJump=Jef.I.OnJump;Jef.I.OnJump=Jump;oldFloor=Jef.I.TransportFloor;Jef.I.TransportFloor=Floor;
        Interact.I.AddProvider(Keys);
    }
    private void CollectFloats()
    {while(floats<Boats.I.Floats.Count){var f=Boats.I.Floats[floats++];if(floors.TryGetValue(f.Kind,out var mesh))Decks.Add(new(){Kind=f.Kind,World=()=>f.Inner.GlobalTransform,Visible=()=>GodotObject.IsInstanceValid(f.Outer)&&f.Outer.Visible,Mesh=mesh});}}
    public Deck Add(string kind,MeshDeck mesh,Func<Transform3D> frame,Func<bool> visible)
    {var d=new Deck{Kind=kind,Mesh=mesh,World=frame,Visible=visible};Decks.Add(d);return d;}
    private float Floor(float x,float z,float feet)
    {
        float best=oldFloor?.Invoke(x,z,feet)??float.NegativeInfinity;
        float ramp=RampFloor(x,z);if(ramp<=feet+Jef.Step)best=Math.Max(best,ramp);
        foreach(var d in Decks)if(d.Visible())
        {var xf=d.World();if(Math.Abs(x-xf.Origin.X)>70||Math.Abs(z-xf.Origin.Z)>70)continue;var local=xf.AffineInverse()*new Vector3(x,xf.Origin.Y,z);if(!d.Mesh.Stand(local.X,local.Z,.1f))continue;float y=(xf*new Vector3(local.X,d.Mesh.Floor(local.X,local.Z),local.Z)).Y;if(y<=feet+Jef.Step)best=Math.Max(best,y);}
        return best;
    }
    public void Board(Deck d,Vector2 p,bool climb=true)
    {if(Jef.I.Riding||Jef.I.Laden)return;var at=new Vector3(p.X,d.Mesh.Floor(p.X,p.Y),p.Y);int e=epoch;if(climb)Jef.I.ClimbTo(new[]{(at+Vector3.Up*.2f,.7f),(at,.3f)},()=>{if(e==epoch&&d.Visible())Attach(d,p);},d.World);else Attach(d,p);}
    public void Attach(Deck d,Vector2 p)
    {On=d;Local=d.Mesh.Nearest(p);lastYaw=d.World().Basis.GetEuler().Y;Jef.I.DrivenEye=Jef.Eye;Jef.I.Drive=drive;Jef.I.Carry(d.At(Local));}
    private void Replaced(string how,ClientState? client)=>Clear();
    public void Clear(){epoch++;On=null;if(Jef.I.Drive==drive||Jef.I.Drive==rampDrive){Jef.I.Drive=null;Jef.I.DrivenEye=Jef.Eye;Jef.I.DrivenRoll=0;}}
    private (Deck Deck,Vector2 Local)? Reach()
    {
        var j=Jef.I;if(j.Riding||j.Climbing||j.Laden)return null;float best=2.2f*2.2f;(Deck,Vector2)? answer=null;
        foreach(var d in Decks)if(d.Visible())
        {var xf=d.World();if(Math.Abs(xf.Origin.X-j.X)>65||Math.Abs(xf.Origin.Z-j.Z)>65)continue;var p=xf.AffineInverse()*new Vector3(j.X,j.Y,j.Z);if(p.X<d.Mesh.MinX-2.2f||p.X>d.Mesh.MinX+d.Mesh.Nx*d.Mesh.Cell+2.2f||p.Z<d.Mesh.MinZ-2.2f||p.Z>d.Mesh.MinZ+d.Mesh.Nz*d.Mesh.Cell+2.2f)continue;var nearest=d.Mesh.Nearest(new(p.X,p.Z));var at=d.At(nearest);float distance=new Vector2(at.X-j.X,at.Z-j.Z).LengthSquared(),rise=at.Y-j.Y;if(distance<best&&rise>=-3.6f&&rise<(j.Swimming?2:1.3f)&&Interact.Aim(at.X,at.Y+.2f,at.Z)!=null){best=distance;answer=(d,nearest);}}
        return answer;
    }
    private Offers? Keys(float x,float z)
    {
        if(On!=null)return new(){Only=new(){Act.Me(Key.E,"leave the ship's deck",Leave)}};
        var reach=Reach();return reach is {} r?new(){Options=new(){(new Vector2(Jef.I.X-r.Deck.At(r.Local).X,Jef.I.Z-r.Deck.At(r.Local).Z).Length(),Act.At(Key.E,Jef.I.Swimming?"climb onto the ship":"step or jump onto the ship",r.Deck.At(r.Local)+Vector3.Up*.2f,()=>Board(r.Deck,r.Local)))}}:null;
    }
    private bool Jump()
    {if(On!=null){var at=On.At(Local);Clear();Jef.I.Carry(at);Jef.I.LaunchFromRide();return true;}if(oldJump?.Invoke()==true)return true;var r=Reach();if(r!=null){Board(r.Value.Deck,r.Value.Local);return true;}return false;}
    private void Leave()
    {
        if(On==null)return;var at=On.At(Local);var exit=QuayExits.Near(at.X,at.Z,2.5f);Clear();
        if(exit!=null)Jef.I.ClimbTo(new[]{(new Vector3(exit.Tx,exit.Ty,exit.Tz),.9f)},null);
        else{var j=Jef.I;float fx=-MathF.Sin(j.Yaw),fz=-MathF.Cos(j.Yaw);for(float a=.5f;a<4;a+=.25f)if(j.SwimFree(at.X+fx*a,at.Z+fz*a)){j.DropFromBoat(new(at.X+fx*a,Water.Level(at.X,at.Z)-.3f,at.Z+fz*a));return;}j.LaunchFromRide();}
    }
    private bool Drive(float dt)
    {
        var d=On;if(d==null)return false;if(!d.Visible()){Clear();return false;}var j=Jef.I;var xf=d.World();float yaw=xf.Basis.GetEuler().Y,dr=MathF.Atan2(MathF.Sin(yaw-lastYaw),MathF.Cos(yaw-lastYaw));lastYaw=yaw;
        float x=(j.KeyDown(Key.D)?1:0)-(j.KeyDown(Key.A)?1:0),z=(j.KeyDown(Key.S)?1:0)-(j.KeyDown(Key.W)?1:0);if(j.Frozen)x=z=0;var step=new Vector2(x,z).LimitLength()*(j.KeyDown(Key.Shift)&&!j.Laden?Jef.Hurry:Jef.Walk)*j.SpeedFactor*j.Fatigue*dt;float a=j.Yaw-yaw,c=MathF.Cos(a),s=MathF.Sin(a);var want=Local+new Vector2(step.X*c+step.Y*s,-step.X*s+step.Y*c);
        var world=xf*new Vector3(want.X,d.Mesh.Floor(Local.X,Local.Y),want.Y);float ramp=RampFloor(world.X,world.Z);if(d==annaMaria&&float.IsFinite(ramp)){Clear();j.Place(world.X,world.Z,j.Yaw,j.Pitch,ramp);return false;}
        Local=d.Mesh.Walk(Local,want);j.Carry(d.At(Local),dr);if(j.KeyDown(Key.Space)&&!j.Frozen)Jump();return true;
    }
    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Play.ShipWalk");
        if(floats!=Boats.I.Floats.Count)CollectFloats();UpdateGangway();var j=Jef.I;if(On!=null&&(j.Drive!=drive||new Vector3(j.X,j.Y,j.Z).DistanceTo(On.At(Local))>3)){Clear();return;}
        if(j.Riding||j.Swimming||j.Climbing||!j.Grounded)return;
        if(float.IsFinite(RampFloor(j.X,j.Z))){j.Drive=rampDrive;return;}
        foreach(var d in Decks)if(d.Visible()){var xf=d.World();if(Math.Abs(xf.Origin.X-j.X)>65||Math.Abs(xf.Origin.Z-j.Z)>65)continue;var p=xf.AffineInverse()*new Vector3(j.X,j.Y,j.Z);if(d.Mesh.Stand(p.X,p.Z)&&Math.Abs(p.Y-d.Mesh.Floor(p.X,p.Z))<.18f){Attach(d,new(p.X,p.Z));break;}}
    }
    public override void _ExitTree(){Clear();if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Replaced;Jef.I.OnJump=oldJump;Jef.I.TransportFloor=oldFloor;}
}
