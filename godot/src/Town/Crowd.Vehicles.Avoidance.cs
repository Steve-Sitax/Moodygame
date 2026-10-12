using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using Godot;

namespace Scheldemist.Town;

public sealed partial class Crowd
{
    private sealed class Lane
    {public double X,Z,Ux,Uz,Rx,Rz,HalfLength,HalfWidth,Look,Rank;public Puppet? Owner;}
    private sealed class LanePrevious {public double X,Z,Vx,Vz;}
    private readonly List<Lane> lanes=new();
    private readonly ConditionalWeakTable<Node3D,LanePrevious> laneWas=new();
    private void VehicleLanes(double dt)
    {
        lanes.Clear();
        void Add(double x,double z,double vx,double vz,double ex,double ez,double rank,Puppet? owner=null){double speed=Hyp(vx,vz);if(speed<.35)return;double ux=vx/speed,uz=vz/speed;lanes.Add(new(){X=x,Z=z,Ux=ux,Uz=uz,Rx=-uz,Rz=ux,HalfLength=Math.Abs(ex*ux)+Math.Abs(ez*uz),HalfWidth=Math.Abs(ex*-uz)+Math.Abs(ez*ux),Look=Math.Min(12,Math.Max(3,speed*3.5)),Rank=rank,Owner=owner});}
        foreach(var body in map.TransitBodies()){
            var centre=body.World.GetCenter();double vx=0,vz=0;
            if(laneWas.TryGetValue(body.Node,out var before)&&dt>0){double k=Math.Min(1,dt*6);vx=before.Vx+((centre.X-before.X)/dt-before.Vx)*k;vz=before.Vz+((centre.Z-before.Z)/dt-before.Vz)*k;if(Hyp(centre.X-before.X,centre.Z-before.Z)>3)vx=vz=0;}
            var was=laneWas.GetValue(body.Node,_=>new());was.X=centre.X;was.Z=centre.Z;was.Vx=vx;was.Vz=vz;
            double rank=body.Owner?.Vehicle?.Kind==3?2:body.Owner!=null?1:body.Node.Name.ToString().StartsWith("omnibus",StringComparison.Ordinal)?2.5:body.Node.GetParent() is Scheldemist.Movers.Railway?3:2;
            Add(centre.X,centre.Z,vx,vz,body.World.Size.X/2,body.World.Size.Z/2,rank,body.Owner);
        }
        foreach(var p in people){if(p.Vehicle==null||p.State!="walk"||p.Remote)continue;double fx=Math.Sin(p.Yaw),fz=Math.Cos(p.Yaw);int before=lanes.Count;Add(p.X+fx*p.Nose*.5,p.Z+fz*p.Nose*.5,fx*p.Pace,fz*p.Pace,0,0,p.Vehicle.Kind==3?2:1,p);if(lanes.Count>before){lanes[^1].HalfLength=Math.Max(.6,p.Nose/2+.4);lanes[^1].HalfWidth=Math.Max(.45,p.Reach);}}
    }
    private bool GiveWay(Puppet p,double dt)
    {
        if(p.Remote||lanes.Count==0)return false;double rank=p.Vehicle?.Kind==3?2:p.Vehicle!=null?1:0;Lane? hit=null,near=null;double lateral=0;
        foreach(var l in lanes){if(l.Owner==p||l.Rank<=rank)continue;double dx=p.X-l.X,dz=p.Z-l.Z;if(Math.Abs(dx)>20||Math.Abs(dz)>20)continue;double along=dx*l.Ux+dz*l.Uz;if(along< -l.HalfLength-.4||along>l.HalfLength+l.Look)continue;double lat=dx*l.Rx+dz*l.Rz,room=l.HalfWidth+.55+p.Reach*.5;if(Math.Abs(lat)<room){hit=l;lateral=lat;break;}if(Math.Abs(lat)<room+1.2)near=l;}
        string Moving()=>p.Vehicle?.Kind==1?"ride":p.Vehicle?.Kind==2?(p.Kind is "carter" or "porter"?"walk":"push"):"walk";
        if(hit is {} lane){if(p.State!="walk"&&p.WayHome==null)p.WayHome=(p.X,p.Z);double want=lane.HalfWidth+.55+.9,step=1.7*dt;int[] sides=Math.Abs(lateral)<.15?new[]{1,-1}:new[]{Math.Sign(lateral),-Math.Sign(lateral)};
            foreach(int side in sides){if(side== -Math.Sign(lateral)&&Math.Abs(lateral)>want*.5)continue;double x=p.X+lane.Rx*side*step,z=p.Z+lane.Rz*side*step;
                if(map.FreeFor(p,x,z)&&grid.IsOpen(x,z)&&(p.Nose==0||map.FreeFor(p,x+Math.Sin(p.Yaw)*p.Nose,z+Math.Cos(p.Yaw)*p.Nose))){p.X=x;p.Z=z;Face(p,Math.Atan2(lane.Rx*side,lane.Rz*side),dt*3);p.Human.Play(Moving(),.2f);p.Human.SetPace(1.7f/p.Size);p.StuckT=0;return true;}}
            double bx=p.X-lane.Ux*step,bz=p.Z-lane.Uz*step;if(map.FreeFor(p,bx,bz)&&grid.IsOpen(bx,bz)){p.X=bx;p.Z=bz;}p.Human.Play(StillMotion(p),.3f);return true;
        }
        if(near!=null&&p.State=="walk"&&p.Pi<p.Path.Count){var target=p.Path[p.Pi];double dx=target.x-p.X,dz=target.z-p.Z,len=Math.Max(1e-6,Hyp(dx,dz)),ax=p.X+dx/len*.6-near.X,az=p.Z+dz/len*.6-near.Z,lat=ax*near.Rx+az*near.Rz,along=ax*near.Ux+az*near.Uz;
            if(Math.Abs(lat)<near.HalfWidth+.55+p.Reach*.5&&along> -near.HalfLength-.4&&along<near.HalfLength+near.Look){p.Human.Play(p.Vehicle?.Kind==1?"ride":StillMotion(p),.3f);Face(p,Math.Atan2(near.X-p.X,near.Z-p.Z),dt);p.StuckT=0;return true;}}
        if(p.WayHome!=null&&near!=null&&p.State!="walk"){p.Human.Play(StillMotion(p),.3f);return false;}
        if(p.WayHome is {} home&&near==null){double dx=home.x-p.X,dz=home.z-p.Z,d=Hyp(dx,dz);if(d<.1||p.State=="walk"){p.WayHome=null;if(p.State!="walk")p.Human.Play(StillMotion(p),.3f);return false;}
            double step=Math.Min(d,1.1*dt),x=p.X+dx/d*step,z=p.Z+dz/d*step;if(!map.FreeFor(p,x,z)){p.WayHome=null;p.Human.Play(StillMotion(p),.3f);return false;}p.X=x;p.Z=z;Face(p,Math.Atan2(dx,dz),dt*3);p.Human.Play(p.Vehicle!=null?WalkMotion(p):"walk",.2f);p.Human.SetPace(1.1f/p.Size);if(d-step<.1){p.WayHome=null;p.Human.Play(StillMotion(p),.3f);if(p.PYaw!=null)Face(p,p.PYaw.Value,1);}return true;}
        return false;
    }
}
