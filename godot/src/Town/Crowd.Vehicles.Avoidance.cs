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
            string bodyName=body.Owner==null?body.Node.Name.ToString():"";
            // a portal crane's leg on its rails (Railway.RegisterLegs) outranks everything on the quay, like the train
            double rank=body.Owner?.Vehicle?.Kind==3?2:body.Owner!=null?1:bodyName.StartsWith("omnibus",StringComparison.Ordinal)?2.5:bodyName.StartsWith("crane_leg",StringComparison.Ordinal)||body.Node.GetParent() is Scheldemist.Movers.Railway?3:2;
            Add(centre.X,centre.Z,vx,vz,body.World.Size.X/2,body.World.Size.Z/2,rank,body.Owner);
        }
        foreach(var p in people){if(p.Vehicle==null||p.State!="walk"||p.Remote)continue;double fx=Math.Sin(p.Yaw),fz=Math.Cos(p.Yaw);int before=lanes.Count;Add(p.X+fx*p.Nose*.5,p.Z+fz*p.Nose*.5,fx*p.Pace,fz*p.Pace,0,0,p.Vehicle.Kind==3?2:1,p);if(lanes.Count>before){lanes[^1].HalfLength=Math.Max(.6,p.Nose/2+.4);lanes[^1].HalfWidth=Math.Max(.45,p.Reach);}}
    }
    /// <summary>The vehicle lanes within 20 m of a body and where it stands in each, for the stuck check's report.</summary>
    public string[] LanesNear(Puppet p){var notes=new List<string>();foreach(var l in lanes){double dx=p.X-l.X,dz=p.Z-l.Z;if(Math.Abs(dx)>20||Math.Abs(dz)>20)continue;notes.Add($"lane at {l.X:0.0},{l.Z:0.0} heading {l.Ux:0.00},{l.Uz:0.00} half {l.HalfLength:0.0} x {l.HalfWidth:0.0} look {l.Look:0.0} rank {l.Rank} {(l.Owner==null?"body":"carried by puppet "+l.Owner.Id)}; body is {dx*l.Ux+dz*l.Uz:0.0} along, {dx*l.Rx+dz*l.Rz:0.0} across");}return notes.ToArray();}
    /// <summary>Is there free ground from here, step by step across, far enough to stand clear of a lane's room on that side?</summary>
    private bool Clears(Puppet p,Lane l,int side,double lateral,double room){double need=room-side*lateral;for(double d=.25;d<=need+.05;d+=.25){double x=p.X+l.Rx*side*d,z=p.Z+l.Rz*side*d;if(!(map.FreeFor(p,x,z)&&grid.IsOpen(x,z)))return false;}return true;}
    private static double LaneDepth(Puppet p,Lane l,double x,double z)
    {
        double dx=x-l.X,dz=z-l.Z,along=dx*l.Ux+dz*l.Uz;
        return Math.Max(0,Math.Min(l.HalfWidth+.55+p.Reach*.5-Math.Abs(dx*l.Rx+dz*l.Rz),
            Math.Min(along+l.HalfLength+.4,l.HalfLength+l.Look-along)));
    }
    // Clearing one box must not push a walker into another box of the cart (or another vehicle).
    // A timed reversal hold only slowed that oscillation; it did not remove the conflicting pushes.
    private bool LaneStep(Puppet p,Lane hit,double rank,double x,double z,bool crossing=false)
    {
        double hitLateral=(p.X-hit.X)*hit.Rx+(p.Z-hit.Z)*hit.Rz;
        double lateralStep=(x-p.X)*hit.Rx+(z-p.Z)*hit.Rz;
        int side=Math.Abs(lateralStep)>1e-6?Math.Sign(lateralStep):0;
        double clearance=hit.HalfWidth+.55+p.Reach*.5-side*hitLateral;
        foreach(var l in lanes){
            if(l==hit||l.Owner==p||l.Rank<=rank)continue;
            double depth=LaneDepth(p,l,p.X,p.Z);bool worsens=LaneDepth(p,l,x,z)>depth+1e-6;
            // Check the whole lateral escape: one clear step can lead into the next box a few steps later.
            if(side!=0){
                worsens|=LaneDepth(p,l,p.X+hit.Rx*side*clearance,p.Z+hit.Rz*side*clearance)>depth+1e-6;
                for(double d=.25;!worsens&&d<clearance;d+=.25)
                    worsens=LaneDepth(p,l,p.X+hit.Rx*side*d,p.Z+hit.Rz*side*d)>depth+1e-6;
            }
            if(!worsens)continue;
            // The rail-side escape (issue 117) can cross overlapping boxes of the same vehicle,
            // but only when this direction also has a complete, open way out of the other lane.
            double lateral=(p.X-l.X)*l.Rx+(p.Z-l.Z)*l.Rz,stepAcross=(x-p.X)*l.Rx+(z-p.Z)*l.Rz;
            int outward=Math.Sign(lateral);double room=l.HalfWidth+.55+p.Reach*.5;
            if(crossing&&outward!=0&&stepAcross*outward<0&&Math.Abs(lateral)<l.HalfWidth+.35
                &&!Clears(p,l,outward,lateral,room)&&Clears(p,l,-outward,lateral,room))continue;
            return false;
        }
        return map.FreeFor(p,x,z)&&grid.IsOpen(x,z)&&(p.Nose==0||map.FreeFor(p,x+Math.Sin(p.Yaw)*p.Nose,z+Math.Cos(p.Yaw)*p.Nose));
    }
    private bool GiveWay(Puppet p,double dt)
    {
        p.Yield="";p.PushAge+=dt;if(p.Remote||lanes.Count==0){p.YieldHold=0;return false;}double rank=p.Vehicle?.Kind==3?2:p.Vehicle!=null?1:0;Lane? hit=null,near=null;double lateral=0,alongHit=0;
        foreach(var l in lanes){if(l.Owner==p||l.Rank<=rank)continue;double dx=p.X-l.X,dz=p.Z-l.Z;if(Math.Abs(dx)>20||Math.Abs(dz)>20)continue;double along=dx*l.Ux+dz*l.Uz;if(along< -l.HalfLength-.4||along>l.HalfLength+l.Look)continue;double lat=dx*l.Rx+dz*l.Rz,room=l.HalfWidth+.55+p.Reach*.5;if(Math.Abs(lat)<room){hit=l;lateral=lat;alongHit=along;break;}if(Math.Abs(lat)<room+1.2)near=l;}
        string Moving()=>p.Vehicle?.Kind==1?"ride":p.Vehicle?.Kind==2?(p.Kind is "carter" or "porter"?"walk":"push"):"walk";
        if(hit is {} lane){p.Yield="in a lane";p.YieldHold=1.2;if(p.State!="walk"&&p.WayHome==null)p.WayHome=(p.X,p.Z);double want=lane.HalfWidth+.55+.9,step=1.7*dt;
            // Keep an escape's direction through the centre line instead of choosing the default side again.
            int centreSide=p.PushAge<1.2&&p.PushX*lane.Rx+p.PushZ*lane.Rz<0?-1:1;
            int[] sides=Math.Abs(lateral)<.15?new[]{centreSide,-centreSide}:new[]{Math.Sign(lateral),-Math.Sign(lateral)};
            // The way out is the near side. Deep in the lane the far side means crossing in front of the body: done only when the
            // body is on the walker (inside its width and a body's radius) and the near side has no ground to clear the lane
            // (a bridge's rail at the Vismarkt, issue 117), so that he is not flattened against it. Short of that he stands where
            // he is; stepping across and back from the kerb side, one step at a time, was a body walking to and fro (issue 116).
            double inside=lane.HalfWidth+.35;bool onBody=Math.Abs(lateral)<inside;
            double room=lane.HalfWidth+.55+p.Reach*.5;int outward=Math.Sign(lateral);bool across=onBody&&outward!=0&&!Clears(p,lane,outward,lateral,room)&&Clears(p,lane,-outward,lateral,room);foreach(int side in sides){if(across?side==outward:side==-outward&&Math.Abs(lateral)>want*.5)continue;double x=p.X+lane.Rx*side*step,z=p.Z+lane.Rz*side*step;
                if(LaneStep(p,lane,rank,x,z,across)){double sx=lane.Rx*side,sz=lane.Rz*side;if(p.PushAge<.4&&sx*p.PushX+sz*p.PushZ<-.3){p.StuckT=0;p.Human.Play(StillMotion(p),.3f);return true;}p.PushX=sx;p.PushZ=sz;p.PushAge=0;p.X=x;p.Z=z;Face(p,Math.Atan2(lane.Rx*side,lane.Rz*side),dt*3);p.Human.Play(Moving(),.2f);p.Human.SetPace(1.7f/p.Size);p.StuckT=0;return true;}}
            // No side is open. Under the body: away from it along its way (ahead of it on, behind it back), never towards it.
            // Beside it with no room to clear the lane: stand still.
            if(onBody){double away=alongHit>=0?1:-1,bx=p.X+lane.Ux*away*step,bz=p.Z+lane.Uz*away*step;if(LaneStep(p,lane,rank,bx,bz)){p.X=bx;p.Z=bz;}}
            p.Human.Play(StillMotion(p),.3f);return true;
        }
        // Shoved out of a lane, wait standing for a moment: walking straight back in, only to be shoved out again,
        // is a body walking on the spot.
        if(p.YieldHold>0){p.YieldHold-=dt;if(p.State=="walk"){p.Yield="waits after a lane";p.Human.Play(StillMotion(p),.3f);p.StuckT=0;return true;}}
        if(p.State=="walk"&&p.Pi<p.Path.Count){var target=p.Path[p.Pi];double dx=target.x-p.X,dz=target.z-p.Z,len=Math.Max(1e-6,Hyp(dx,dz)),x=p.X+dx/len*.6,z=p.Z+dz/len*.6;
            foreach(var l in lanes){if(l.Owner==p||l.Rank<=rank||LaneDepth(p,l,x,z)<=0)continue;p.Yield="waits for a lane";p.Human.Play(p.Vehicle?.Kind==1?"ride":StillMotion(p),.3f);Face(p,Math.Atan2(l.X-p.X,l.Z-p.Z),dt);p.StuckT=0;return true;}}
        if(p.WayHome!=null&&near!=null&&p.State!="walk"){p.Human.Play(StillMotion(p),.3f);return false;}
        if(p.WayHome is {} home&&near==null){double dx=home.x-p.X,dz=home.z-p.Z,d=Hyp(dx,dz);if(d<.1||p.State=="walk"){p.WayHome=null;if(p.State!="walk")p.Human.Play(StillMotion(p),.3f);return false;}
            double step=Math.Min(d,1.1*dt),x=p.X+dx/d*step,z=p.Z+dz/d*step;if(!map.FreeFor(p,x,z)){p.WayHome=null;p.Human.Play(StillMotion(p),.3f);return false;}p.X=x;p.Z=z;Face(p,Math.Atan2(dx,dz),dt*3);p.Human.Play(p.Vehicle!=null?WalkMotion(p):"walk",.2f);p.Human.SetPace(1.1f/p.Size);if(d-step<.1){p.WayHome=null;p.Human.Play(StillMotion(p),.3f);if(p.PYaw!=null)Face(p,p.PYaw.Value,1);}return true;}
        return false;
    }
}
