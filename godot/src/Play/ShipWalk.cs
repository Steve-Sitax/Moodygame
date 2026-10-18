using System;
using System.Collections.Generic;
using System.Linq;
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
        /// <summary>Gone for good (a rowed copy freed): the deck is dropped from the list.</summary>
        public Func<bool>? Gone;
        /// <summary>A small boat's bottom boards and thwarts (issue 155), not a ship's deck.</summary>
        public bool Small=>Mesh.Small;
        public Vector3 At(Vector2 p)=>World()*new Vector3(p.X,Mesh.Floor(p.X,p.Y),p.Y);
    }
    public readonly List<Deck> Decks=new();
    public Deck? On {get;private set;}
    public Vector2 Local {get;private set;}
    private readonly Dictionary<string,MeshDeck?> floors=new();
    private readonly Func<float,bool> drive;
    private Func<bool>? oldJump;
    private Func<float,float,float,float>? oldFloor;
    private float lastYaw;
    private int floats,epoch;
    public ShipWalk(){I=this;drive=Drive;rampDrive=WalkRamp;Solid.Leave.Add(IsBrigRamp);}
    public override void _Ready()
    {
        ProcessPriority=-1;var library=ModelLibrary.Get("boats",new(TwoSided:true,Affine:.6));
        ulong t0=Time.GetTicksUsec();if(library!=null)foreach(var kind in library.Roots.Keys)FloorFor(kind);
        foreach(var (kind,frame,shown) in Boats.I.MooredDecks())if(FloorFor(kind) is {} mesh)Decks.Add(new(){Kind=kind,World=frame,Visible=shown,Mesh=mesh});CollectFloats();
        GD.Print($"ship walk: {floors.Count(f=>f.Value!=null)} boat floors measured, {Decks.Count} decks, in {(Time.GetTicksUsec()-t0)/1000.0:0} ms");
        FindGangway();
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Replaced;
        oldJump=Jef.I.OnJump;Jef.I.OnJump=Jump;oldFloor=Jef.I.TransportFloor;Jef.I.TransportFloor=Floor;
        Interact.I.AddProvider(Keys);
        ServerLink.I?.WhenUp(()=>_=RestoreDeck());
    }
    private void CollectFloats()
    {while(floats<Boats.I.Floats.Count){var f=Boats.I.Floats[floats++];if(FloorFor(f.Kind) is {} mesh)Decks.Add(new(){Kind=f.Kind,World=()=>f.Inner.GlobalTransform,Visible=()=>GodotObject.IsInstanceValid(f.Outer)&&f.Outer.IsVisibleInTree(),Gone=()=>!GodotObject.IsInstanceValid(f.Outer),Mesh=mesh});}}
    /// <summary>The floor of a boat model, measured once a kind: a ship's deck, or a small boat's bottom boards and thwarts
    /// (issue 155: every hull you can see you can stand in). Null for the landing stage's pontoon, which has its own.</summary>
    public MeshDeck? FloorFor(string kind)
    {
        if(floors.TryGetValue(kind,out var found))return found;
        if(kind=="pontoon_section"||kind.EndsWith("_far")){floors[kind]=null;return null;}
        var model=ModelLibrary.Get("boats",new(TwoSided:true,Affine:.6))?.Roots.GetValueOrDefault(kind);if(model==null){floors[kind]=null;return null;}
        var dim=Boats.I.Dims(kind);
        if(dim.Length<9){float seat=Array.IndexOf(Rowing.HullKinds,kind.Replace("_bare",""))>=0?RowPhysics.Hull.Of(kind.Replace("_bare","")).SeatY:.4f;return floors[kind]=MeshDeck.Hull(model,-dim.Beam/2,dim.Beam/2,-dim.Length/2,dim.Length/2,-.6f,seat+.15f);}
        // a ship: her decks, and where a house, a hatch or a heap stands on them its top (a foot that comes down there stands on it)
        var deck=MeshDeck.Hull(model,-dim.Beam/2,dim.Beam/2,-dim.Length/2,dim.Length/2,kind=="brig"?2.25f:.45f,float.MaxValue,.25f);
        // (#182) at her bow the rail and knightheads stand over the deck's edge: inside her outline the deck goes on under them
        if(Boats.I.HullOf(kind) is {} hull)deck.FillInside((x,z)=>
        {int cx=(int)MathF.Floor((x-hull.MinX)/Boats.HullMap.Cell),cz=(int)MathF.Floor((z-hull.MinZ)/Boats.HullMap.Cell);
            for(int dz=-2;dz<=2;dz++)for(int dx=-2;dx<=2;dx++)if(!hull.Has(cx+dx,cz+dz))return false;return true;});
        return floors[kind]=deck;
    }
    public Deck Add(string kind,MeshDeck mesh,Func<Transform3D> frame,Func<bool> visible,Func<bool>? gone=null)
    {var d=new Deck{Kind=kind,Mesh=mesh,World=frame,Visible=visible,Gone=gone};Decks.Add(d);return d;}
    private float Floor(float x,float z,float feet)
    {
        float best=oldFloor?.Invoke(x,z,feet)??float.NegativeInfinity;
        float ramp=RampFloor(x,z);if(ramp<=feet+Jef.Step)best=Math.Max(best,ramp);
        foreach(var d in Decks)
        {var xf=d.World();if(Math.Abs(x-xf.Origin.X)>70||Math.Abs(z-xf.Origin.Z)>70||!d.Visible())continue;var local=xf.AffineInverse()*new Vector3(x,xf.Origin.Y,z);if(!d.Mesh.Stand(local.X,local.Z,.1f))continue;float y=(xf*new Vector3(local.X,d.Mesh.Floor(local.X,local.Z),local.Z)).Y;if(y<=feet+Jef.Step)best=Math.Max(best,y);}
        return best;
    }
    public void Board(Deck d,Vector2 p,bool climb=true)
    {if(Jef.I.Riding&&Jef.I.Drive!=drive||Jef.I.Laden)return;if(Jef.I.Drive==drive)Clear();var at=new Vector3(p.X,d.Mesh.Floor(p.X,p.Y),p.Y);int e=epoch;if(climb)Jef.I.ClimbTo(new[]{(at+Vector3.Up*.2f,.7f),(at,.3f)},()=>{if(e==epoch&&d.Visible())Attach(d,p);},d.World);else Attach(d,p);}
    public void Attach(Deck d,Vector2 p)
    {On=d;Local=d.Mesh.Nearest(p);lastYaw=d.World().Basis.GetEuler().Y;Jef.I.DrivenEye=Jef.Eye;Jef.I.Drive=drive;Jef.I.Carry(d.At(Local));}
    private void Replaced(string how,ClientState? client){Clear();RestoreDeck(RideSaves.Read<RideSaved>(client,"ride"));}
    public void Clear(){epoch++;On=null;if(Jef.I.Drive==drive||Jef.I.Drive==rampDrive){Jef.I.Drive=null;Jef.I.DrivenEye=Jef.Eye;Jef.I.DrivenRoll=0;}}
    private (Deck Deck,Vector2 Local)? Reach()
    {
        var j=Jef.I;if(j.Riding&&!(On is {Small:true}&&j.Drive==drive)||j.Climbing||j.Laden)return null;float best=2.2f*2.2f;(Deck,Vector2)? answer=null;
        foreach(var d in Decks)
        {if(d==On)continue;var xf=d.World();if(Math.Abs(xf.Origin.X-j.X)>65||Math.Abs(xf.Origin.Z-j.Z)>65||!d.Visible())continue;var p=xf.AffineInverse()*new Vector3(j.X,j.Y,j.Z);if(p.X<d.Mesh.MinX-2.2f||p.X>d.Mesh.MinX+d.Mesh.Nx*d.Mesh.Cell+2.2f||p.Z<d.Mesh.MinZ-2.2f||p.Z>d.Mesh.MinZ+d.Mesh.Nz*d.Mesh.Cell+2.2f)continue;var nearest=d.Mesh.Nearest(new(p.X,p.Z));var at=d.At(nearest);float distance=new Vector2(at.X-j.X,at.Z-j.Z).LengthSquared(),rise=at.Y-j.Y;if(distance<best&&rise>=-3.6f&&rise<(j.Swimming?2:1.3f)&&Interact.Aim(at.X,at.Y+.2f,at.Z)!=null){best=distance;answer=(d,nearest);}}
        return answer;
    }
    private Offers? Keys(float x,float z)
    {
        if(On!=null)
        {
            if(!On.Small)return new(){Only=new(){Act.Me(Key.E,"leave the ship's deck",Leave)}};
            // In a small boat E stays free for the boat itself (Rowing: take her, row her); getting out is the second choice.
            var at=On.At(Local);var exit=QuayExits.Near(at.X,at.Z,2.5f);
            var options=new List<(float,Act)>{(1.5f,Act.Me(Key.E,exit==null?"go over the side into the water":exit.Ladder?"climb out up the ladder":"step out of the boat",Leave))};
            // up onto a ship or another boat lying alongside, by the deck in view
            if(Reach() is {} up)options.Add((new Vector2(Jef.I.X-up.Deck.At(up.Local).X,Jef.I.Z-up.Deck.At(up.Local).Z).Length()*.5f,Act.At(Key.E,up.Deck.Small?"step across into the boat":"climb up onto the ship",up.Deck.At(up.Local)+Vector3.Up*.2f,()=>Board(up.Deck,up.Local))));
            return new(){Options=options};
        }
        var reach=Reach();if(reach is not {} r)return null;bool small=r.Deck.Small;
        return new(){Options=new(){(new Vector2(Jef.I.X-r.Deck.At(r.Local).X,Jef.I.Z-r.Deck.At(r.Local).Z).Length(),Act.At(Key.E,Jef.I.Swimming?(small?"climb into the boat":"climb onto the ship"):small?"step down into the boat":"step or jump onto the ship",r.Deck.At(r.Local)+Vector3.Up*.2f,()=>Board(r.Deck,r.Local)))}};
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
        var before=Local;Local=d.Mesh.Walk(Local,want);j.Carry(d.At(Local),dr);j.WalkedOn(before.DistanceTo(Local),j.KeyDown(Key.Shift));if(j.KeyDown(Key.Space)&&!j.Frozen)Jump();return true;
    }
    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Play.ShipWalk");
        if(floats!=Boats.I.Floats.Count)CollectFloats();
        for(int i=Decks.Count-1;i>=0;i--)if(Decks[i].Gone?.Invoke()==true){if(On==Decks[i])Clear();Decks.RemoveAt(i);}
        UpdateGangway();var j=Jef.I;if(On!=null&&(j.Drive!=drive||new Vector3(j.X,j.Y,j.Z).DistanceTo(On.At(Local))>3)){Clear();return;}
        if(!j.Riding&&!j.Swimming&&!j.Climbing&&!j.Grounded&&!j.Fly)CarryFalling(j);else airDeck=null;
        if(j.Riding||j.Swimming||j.Climbing||!j.Grounded)return;
        if(float.IsFinite(RampFloor(j.X,j.Z))){j.Drive=rampDrive;return;}
        foreach(var d in Decks){var xf=d.World();if(Math.Abs(xf.Origin.X-j.X)>65||Math.Abs(xf.Origin.Z-j.Z)>65||!d.Visible())continue;var p=xf.AffineInverse()*new Vector3(j.X,j.Y,j.Z);if(d.Mesh.Stand(p.X,p.Z)&&Math.Abs(p.Y-d.Mesh.Floor(p.X,p.Z))<.18f){Attach(d,new(p.X,p.Z));break;}}
    }
    private Deck? airDeck;
    private Transform3D airFrom;
    /// <summary>For the checks (#191): how far a deck under way has carried Jef while he was in the air over her.</summary>
    public float AirCarried {get;private set;}
    /// <summary>
    /// #191: a man who drops or jumps onto a boat under way has her way on him (he left her rail, or the quay as she came
    /// past at his feet): while he is in the air over a deck's floor he goes with her, turning as she turns, and lands
    /// on the floor he dropped toward. Before, the boat sailed on under him while he fell, and a rowing boat at a metre a
    /// second left a man who dropped onto her stern seat in the river behind her.
    /// </summary>
    private void CarryFalling(Jef j)
    {
        var at=new Vector3(j.X,j.Y,j.Z);Deck? under=null;Transform3D now=default;
        foreach(var d in Decks)
        {
            var xf=d.World();if(Math.Abs(xf.Origin.X-at.X)>40||Math.Abs(xf.Origin.Z-at.Z)>40||!d.Visible())continue;
            var p=xf.AffineInverse()*at;if(!d.Mesh.Stand(p.X,p.Z,.05f))continue;float above=p.Y-d.Mesh.Floor(p.X,p.Z);
            if(above>-.3f&&above<8&&(under==null||d==airDeck)){under=d;now=xf;}
        }
        if(under!=null&&under==airDeck){var w=now*(airFrom.AffineInverse()*at);AirCarried+=new Vector2(w.X-at.X,w.Z-at.Z).Length();j.X=w.X;j.Z=w.Z;}
        airDeck=under;airFrom=now;
    }
    public override void _ExitTree(){Clear();if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Replaced;Jef.I.OnJump=oldJump;Jef.I.TransportFloor=oldFloor;}
}
