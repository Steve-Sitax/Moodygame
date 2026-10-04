using System;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;
public partial class ShipWalk
{
    private Node3D? brigRamp;
    private Deck? annaMaria;
    private float rampHeight,rampLow;
    private Vector2 rampHead;
    private readonly Func<float,bool> rampDrive;
    private bool WalkRamp(float dt)
    {
        var j=Jef.I;float x=(j.KeyDown(Key.D)?1:0)-(j.KeyDown(Key.A)?1:0),z=(j.KeyDown(Key.S)?1:0)-(j.KeyDown(Key.W)?1:0);if(j.Frozen)x=z=0;var step=new Vector2(x,z).LimitLength()*(j.KeyDown(Key.Shift)&&!j.Laden?Jef.Hurry:Jef.Walk)*j.SpeedFactor*j.Fatigue*dt;float c=MathF.Cos(j.Yaw),s=MathF.Sin(j.Yaw);float nx=j.X+step.X*c+step.Y*s,nz=j.Z-step.X*s+step.Y*c;
        if(Math.Abs(nx+42)>.45f)nx=j.X;
        if(nz>rampLow){j.Drive=null;j.Carry(new(nx,0,nz));return true;}
        if(nz<-3.35f){j.Drive=null;if(annaMaria!=null){var p=annaMaria.World().AffineInverse()*new Vector3(nx,j.Y,nz);Attach(annaMaria,new(p.X,p.Z));}return true;}
        j.Carry(new(nx,RampFloor(nx,nz),nz));return true;
    }
    private static bool IsBrigRamp(Node n)=>n is Node3D p&&Math.Abs(p.Position.X+42)<.01f&&Math.Abs(p.Position.Z+3)<.01f&&p.GetChildCount()>8;
    private void FindGangway()
    {foreach(var n in BakedWorld.All(Main.I.World))if(IsBrigRamp(n)){brigRamp=(Node3D)n;break;}foreach(var d in Decks)if(d.Kind=="brig"&&d.Visible()&&new Vector2(d.World().Origin.X+40,d.World().Origin.Z+7.2f).Length()<1){annaMaria=d;break;}if(annaMaria!=null)rampHead=annaMaria.Mesh.Nearest(new(-3.9f,-2));UpdateGangway();}
    private void UpdateGangway()
    {if(annaMaria==null)return;rampHeight=annaMaria.At(rampHead).Y;float sin=Math.Clamp(rampHeight/4,-.95f,.95f);rampLow=-3+4*MathF.Sqrt(1-sin*sin);if(brigRamp!=null)brigRamp.Transform=new(new Basis(Vector3.Right,MathF.Asin(sin)),new(-42,rampHeight,-3));}
    private float RampFloor(float x,float z)
    {if(annaMaria==null||Math.Abs(x+42)>.45f||z<-3.35f||z>rampLow)return float.NegativeInfinity;return Mathf.Lerp(rampHeight,0,Math.Clamp((z+3)/(rampLow+3),0,1));}
    public object RiderTestGangway()=>new{found=brigRamp!=null,rampHeight,rampLow,floor=float.IsFinite(RampFloor(Jef.I.X,Jef.I.Z))?(float?)RampFloor(Jef.I.X,Jef.I.Z):null,on=On?.Kind,local=new{Local.X,Local.Y},player=new{Jef.I.X,Jef.I.Y,Jef.I.Z,Jef.I.Grounded,Jef.I.Swimming,Jef.I.Riding}};
}
