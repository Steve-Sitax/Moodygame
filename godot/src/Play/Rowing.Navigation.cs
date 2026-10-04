using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;
public partial class Rowing
{
    private readonly HashSet<string> requested=new(8);
    private readonly Dictionary<Boats.Float,Vector2> previousHulls=new(256);
    private readonly Func<Vector2> rowWhere;
    private bool lockAsked;
    private int hullCount;
    private float headroom;
    public float RiderTestHeadroom {get=>headroom;set{if(Main.I.Arg("ridetest")=="")throw new InvalidOperationException("rowing headroom fixture outside ridetest");headroom=value;}}
    private void WarmNavigation(){foreach(var f in Boats.I.Floats)previousHulls[f]=new(f.Outer.GlobalPosition.X,f.Outer.GlobalPosition.Z);hullCount=Boats.I.Floats.Count;}
    private bool Fits()=>-.42f>Water.Level(Rower.X,Rower.Z)+1.2f+.25f+.22f*MoverClock.Sea+RiderTestHeadroom;
    private void ReleaseNavigation()
    {foreach(string key in requested)Bridges.I.Request(key,"rower",false);requested.Clear();if(lockAsked)Lock.I.RowRequest(false);lockAsked=false;}
    private bool NavigationFree(float x,float z,float r)
    {
        if(x>104-r&&x<116+r&&((Math.Abs(z-7)<1.8f&&Mv.Smooth(Lock.I.GateOpen(0))<=.95f)||(Math.Abs(z-42)<1.8f&&Mv.Smooth(Lock.I.GateOpen(1))<=.95f)))return false;
        if(!Fits()){for(int i=0;i<Bridges.I.List.Count;i++){var b=Bridges.I.List[i];var a=b.Rect;if(x>a.MinX-r&&x<a.MaxX+r&&z>a.MinZ-r&&z<a.MaxZ+r&&b.Open<.97f)return false;}var gate=Lock.BridgeRect;if(x>gate.MinX-r&&x<gate.MaxX+r&&z>gate.MinZ-r&&z<gate.MaxZ+r&&Lock.I.Lift<.97f)return false;}
        return true;
    }
    private bool Navigate()
    {
        if(Boat==null)return false;float fx=MathF.Sin(Rower.Heading),fz=MathF.Cos(Rower.Heading),len=Rower.Shape.Half*.8f;var seat=Rower.Seat;
        if(Bridges.I.PlayerUnderside(seat.X,seat.Z)<Rower.Y+1.2f+RiderTestHeadroom||Bridges.I.PlayerUnderside(Rower.X+fx*len,Rower.Z+fz*len)<Rower.Y+.7f||Bridges.I.PlayerUnderside(Rower.X-fx*len,Rower.Z-fz*len)<Rower.Y+.7f){_=Wreck("bridge");return false;}
        if(!Fits())for(int i=0;i<Bridges.I.List.Count;i++)
        {var b=Bridges.I.List[i];var r=b.Rect;float dx=Math.Max(r.MinX-Rower.X,Math.Max(0,Rower.X-r.MaxX)),dz=Math.Max(r.MinZ-Rower.Z,Math.Max(0,Rower.Z-r.MaxZ)),distance=new Vector2(dx,dz).Length();if(distance<22&&requested.Add(b.Key)){Bridges.I.Request(b.Key,"rower",true);GameState.I.Say("You hail the bridge-keeper: too low to pass under. He starts to wind it up.");}else if(distance>28&&requested.Remove(b.Key))Bridges.I.Request(b.Key,"rower",false);}
        bool zone=Rower.X>96&&Rower.X<124&&Rower.Z>-26&&Rower.Z<70;if(zone&&!lockAsked){lockAsked=true;Lock.I.RowRequest(true,rowWhere);GameState.I.Say("You hail the lock-keeper. Wait for the near gates while he levels the chamber.");}else if(!zone&&lockAsked){lockAsked=false;Lock.I.RowRequest(false);}
        return true;
    }
    private void NavigationTraffic(float dt)
    {
        if(hullCount!=Boats.I.Floats.Count){foreach(var f in Boats.I.Floats)if(!previousHulls.ContainsKey(f))previousHulls[f]=new(f.Outer.GlobalPosition.X,f.Outer.GlobalPosition.Z);hullCount=Boats.I.Floats.Count;}
        for(int i=0;i<Boats.I.Floats.Count;i++)
        {
            var f=Boats.I.Floats[i];
            if(!GodotObject.IsInstanceValid(f.Outer))continue;var at=f.Outer.GlobalPosition;var p=new Vector2(at.X,at.Z);var old=previousHulls[f];previousHulls[f]=p;
            if(Boat==null||Busy||!f.Outer.Visible||dt<=0||p.DistanceTo(old)/dt<.3f)continue;var dim=Boats.I.Dims(f.Kind);if(dim.Beam/2<=.9f)continue;var local=f.Inner.GlobalTransform.AffineInverse()*new Vector3(Rower.X,at.Y,Rower.Z);if(Math.Abs(local.X)<dim.Beam/2+Rower.Shape.Beam*.6f&&Math.Abs(local.Z)<dim.Length/2+Rower.Shape.Half*.6f)_=Wreck("ship");
        }
    }
    public async Task Wreck(string cause)
    {
        if(Boat==null||Busy)return;var d=Boat;Busy=true;int e=++epoch;var at=Rower.Seat;Clear();d.Root.Visible=d.Oars.Visible=false;
        Jef.I.DropFromBoat(new(at.X,Water.Level(at.X,at.Z)-.3f,at.Z));GameState.I.Say(cause=="ship"?"The bow comes out of the fog right over you. Wood cracks, the boat breaks under you, and you are in the water.":"The boat jams under the bridge. Wood cracks and splits, and you are in the water.");
        try{var r=await ServerLink.I!.Api!.RowLost(cause);if(e!=epoch)return;GameState.I.Apply(r);Apply(r.Row);Answered?.Invoke("lost",r);if(r.Text!="")GameState.I.Say(r.Text);}catch(Scheldemist.Net.ApiException ex){GameState.I.Say(ex.Message);}finally{Busy=false;}
    }
}
