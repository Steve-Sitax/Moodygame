using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Town;

/// <summary>Rigid bicycle clearance during an anticipated route turn; every accepted angle is the rendered angle.</summary>
public static class NativeBicycleTurn
{
    public const double ArcSample = .125, RearAxle = .62;
    private static readonly double[] LookAheadExtra={0,.35,.7,1.2};
    private static readonly int[] Sides={-1,1};

    public static bool Step(Vector2 from, Vector2 to, double yaw, double nose, double reach,
        IReadOnlyList<(double x, double z)> path, int next, double fraction, bool initial,
        Func<double,double,double,double,bool> clear, out double acceptedYaw,Func<double,double,bool>? liveGrip=null)
    {
        acceptedYaw=yaw;if(next<0||next>=path.Count||nose<=0||!double.IsFinite(yaw))return false;
        foreach(double extra in LookAheadExtra) {
            double distance=nose+reach+extra;
            var point=Ahead(to,path,next,distance);double dx=point.X-to.X,dz=point.Y-to.Y;
            if(dx*dx+dz*dz<1e-6)continue;
            double desired=Math.Atan2(dx,dz),delta=Angle(desired-yaw);
            double target=initial?desired:yaw+delta*Math.Clamp(fraction,0,1);
            if(!Sweep(from,to,yaw,target,nose,initial,clear,liveGrip))continue;
            acceptedYaw=target;return true;
        }
        return false;
    }

    public static Vector2 Ahead(Vector2 from,IReadOnlyList<(double x,double z)> path,int next,double distance)
    {
        var at=from;
        for(int i=next;i<path.Count;i++) {
            var to=new Vector2((float)path[i].x,(float)path[i].z);double length=at.DistanceTo(to);
            if(length>=distance&&length>1e-6)return at.Lerp(to,(float)(distance/length));
            distance-=length;at=to;
        }
        return at;
    }

    public static bool Sweep(Vector2 from,Vector2 to,double oldYaw,double newYaw,double nose,bool initial,
        Func<double,double,double,double,bool> clear,Func<double,double,bool>? liveGrip=null)
    {
        double angle=Angle(newYaw-oldYaw),radius=Math.Max(nose,RearAxle);
        int count=Math.Max(1,(int)Math.Ceiling((from.DistanceTo(to)+Math.Abs(angle)*radius)/ArcSample));
        if(count>128)return false;
        // A newly mounted model has no old rendered pose. Choose a valid pose before its first draw;
        // existing bicycles must retain clearance through the entire rotation, including their old pose.
        for(int i=initial?count:0;i<=count;i++) {
            double t=(double)i/count,x=from.X+(to.X-from.X)*t,z=from.Y+(to.Y-from.Y)*t;
            double a=initial?newYaw:oldYaw+angle*t,fx=Math.Sin(a),fz=Math.Cos(a),rx=fz,rz=-fx;
            if(!clear(x,z,x+fx*nose,z+fz*nose)||!clear(x,z,x-fx*RearAxle,z-fz*RearAxle))return false;
            // Native ground has already been cleared for a .4m body radius. The axle spokes retain that
            // radius; the small extra grip offsets cover the model's .42m handlebars without doubling it.
            foreach(int side in Sides)if(!clear(x,z,x+fx*.43+rx*.025*side,z+fz*.43+rz*.025*side))return false;
            if(liveGrip!=null)foreach(int side in Sides)if(!liveGrip(x+fx*.43+rx*.42*side,z+fz*.43+rz*.42*side))return false;
        }
        return true;
    }

    public static double Angle(double angle)=>Math.Atan2(Math.Sin(angle),Math.Cos(angle));
}
