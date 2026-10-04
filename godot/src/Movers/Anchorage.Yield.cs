using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Play;

namespace Scheldemist.Movers;

public sealed partial class Anchorage
{
    private bool CanBack(Tow tow,double metres)
    {
        double to=Wrap(tow.S-metres);
        foreach(var z in zones)if(Ahead(Wrap(z.S0-tow.Len/2),to)<=z.S1-z.S0+tow.Len)return false;
        foreach(double stop in stops)if(Ahead(to,stop)<=metres+1)return false;
        foreach(var other in Tows)if(other!=tow&&Ahead(other.S,tow.S)-other.Len/2-tow.Len/2<metres+20)return false;
        return true;
    }
    private void BackOff(Tow tow,double dt)
    {
        tow.Why="backs off";
        if(tow.Back>0){tow.V=-.45;double distance=Math.Min(tow.Back,.45*dt);tow.S=Wrap(tow.S-distance);tow.Back-=distance;if(tow.Back<=0)tow.Hold=12;return;}
        tow.V=0;tow.Hold=Math.Max(0,tow.Hold-dt);if(tow.Hold==0)tow.Waited=RelaxS+1;
    }
    private (double X,double Z) PathMiddle(Tow tow,int k)
    {
        int i=((int)Math.Floor(tow.S/LEN*N)+(int)Math.Round(tow.Len/2)+k)%N;
        var p=pts[i];var next=pts[(i+1)%N];double dx=next.X-p.X,dz=next.Z-p.Z,length=Math.Max(.001,Scheldemist.Town.Whereabouts.Hypot(dx,dz));
        return(p.X+dz/length*tow.TugOff/2,p.Z-dx/length*tow.TugOff/2);
    }
    private double OnWayAhead(Tow tow,River.Mover ship)
    {
        double radius=tow.Width/2+ship.Beam/2+1;
        for(int k=0;k<=16;k+=2){var p=PathMiddle(tow,k);for(int u=0;u<=10;u++){double dx=ship.X-ship.Hx*ship.Len*u/10-p.X,dz=ship.Z-ship.Hz*ship.Len*u/10-p.Z;if(dx*dx+dz*dz<radius*radius)return k;}}
        return -1;
    }
    private bool StoppedFor(Tow tow,River.Mover ship)=>StoppedFor(tow.Lighter,tow.Lb,ship)||StoppedFor(tow.Tug,tow.Tb,ship);
    private static bool StoppedFor(TrainPart hull,double beam,River.Mover ship)
    {
        var pos=hull.Boat.Outer.Position;double dx=pos.X-ship.X,dz=pos.Z-ship.Z,along=dx*ship.Hx+dz*ship.Hz;if(along<=0||along>90)return false;
        double side=Math.Abs(dx*ship.Hz-dz*ship.Hx),cos=Math.Abs(Math.Sin(hull.Boat.Outer.Rotation.Y)*ship.Hx+Math.Cos(hull.Boat.Outer.Rotation.Y)*ship.Hz),sin=Math.Sqrt(Math.Max(0,1-cos*cos));
        return side-hull.Len/2*sin-beam/2*cos<=ship.Beam/2+3.5;
    }
    private static bool ShipStopsNear(Tow tow,List<River.Mover> traffic)
    {
        var at=tow.Lighter.Boat.Outer.Position;
        foreach(var ship in traffic)if(ship.V<.2)for(int i=0;i<=4;i++)if(Scheldemist.Town.Whereabouts.Hypot(ship.X-ship.Hx*ship.Len*i/4-at.X,ship.Z-ship.Hz*ship.Len*i/4-at.Z)<45)return true;
        return false;
    }
    private void AvoidRowers(Tow tow,double time,double dt,ref double target)
    {
        bool blocked=false;
        if(Rowing.I is {} rowing)foreach(var boat in rowing.Drawings.Values)
        {
            if(!boat.Root.Visible||tow.Blocked>90&&boat!=rowing.Boat&&time-boat.LastMoved>60)continue;
            for(int k=0;k<=40;k+=2){var p=PathMiddle(tow,k);double dx=p.X-boat.X,dz=p.Z-boat.Z,r=tow.Width/2+1.6;if(dx*dx+dz*dz>=r*r)continue;target=Math.Min(target,Math.Max(0,(k-6)*.08));tow.Why="stops for a rowing boat";blocked=true;break;}
        }
        tow.Blocked=blocked?tow.Blocked+dt:0;
    }
    private bool TryWatchdog(Tow tow,List<River.Mover> traffic)
    {
        if(tow.Waited<=WatchdogS||tow.Why=="waits for room"||tow.Why=="stops for a rowing boat"||!ShipStopsNear(tow,traffic)||!CanBack(tow,14))return false;
        tow.Back=14;tow.Backs++;tow.Committed=-1;return true;
    }
    internal void YieldProbes()
    {
        if(Tows.Count==0)return;var tow=Tows[0];double oldS=0,oldV=0,oldDwell=0;string oldPhase="";
        MoversTest.Add(new(){Name="tow_watchdog_astern",Hour=13,Gap=3,MinMove=.5,MinTurn=0,
            Start=()=>{oldS=tow.S;oldV=tow.V;oldDwell=tow.Dwell;oldPhase=tow.Phase;tow.Phase="run";tow.V=0;tow.Hold=0;
                for(int i=0;i<N;i++){tow.S=i*LEN/N;if(CanBack(tow,14))break;}PlaceTows();tow.Waited=WatchdogS+1;tow.Why="waits for a ship";
                var at=tow.Lighter.Boat.Outer.Position;TryWatchdog(tow,new(){new(){X=at.X,Z=at.Z,V=0,Len=10,Hx=1,Hz=0}});},
            Where=()=> (tow.Lighter.Boat.Outer.Position,tow.Back,tow.Why),View=()=> (tow.Lighter.Boat.Outer.Position+new Vector3(16,8,15),tow.Lighter.Boat.Outer.Position+Vector3.Up*2),
            Check=()=>tow.V<0&&tow.Back<14&&tow.Why=="backs off"?"":"tow did not move astern through its watchdog",
            End=()=>{tow.S=oldS;tow.V=oldV;tow.Dwell=oldDwell;tow.Phase=oldPhase;tow.Back=tow.Hold=tow.Waited=0;}});
    }
}

