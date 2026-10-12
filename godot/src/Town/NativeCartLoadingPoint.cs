using System;
using System.Collections.Generic;

namespace Scheldemist.Town;

/// <summary>Keep source loading spots when usable; recover a close free reachable spot around the actual native cart.</summary>
public static class NativeCartLoadingPoint
{
    public readonly record struct Point(double X,double Z);
    public readonly record struct Selection(Point At,bool Recovered);
    private static readonly double[] Sides={1,-1};
    private static readonly double[] RecoveryWidths={1.25,1.5};
    private static readonly double[] RecoveryAlong={-.6,0,.6,-1.2};

    public static IEnumerable<Point> Original(Point axle,double yaw)
    {
        double dx=Math.Sin(yaw),dz=Math.Cos(yaw);
        yield return new(axle.X-dx*.6+dz,axle.Z-dz*.6-dx);
        yield return new(axle.X-dx*.6-dz,axle.Z-dz*.6+dx);
        yield return new(axle.X-dx*2.7,axle.Z-dz*2.7);
    }

    public static Selection? Select(Point axle,double yaw,Func<Point,bool> stand,Func<Point,bool> reachable)
    {
        if(!double.IsFinite(axle.X)||!double.IsFinite(axle.Z)||!double.IsFinite(yaw))return null;
        foreach(var point in Original(axle,yaw))if(stand(point)&&reachable(point))return new(point,false);
        // A native parked cart includes solid shafts/bed plus a body margin. The source one-metre
        // flanks can fall inside that margin; its unchecked shaft fallback can be inside a wall.
        // Search only beside the bed and immediately beyond the shafts, without moving the cart.
        double dx=Math.Sin(yaw),dz=Math.Cos(yaw);
        foreach(double width in RecoveryWidths)foreach(double along in RecoveryAlong)foreach(double side in Sides){
            var point=new Point(axle.X+dx*along+dz*width*side,axle.Z+dz*along-dx*width*side);
            if(stand(point)&&reachable(point))return new(point,true);
        }
        foreach(double back in new[]{3.0,3.3})foreach(double side in new[]{0.0,.5,-.5}){
            var point=new Point(axle.X-dx*back+dz*side,axle.Z-dz*back-dx*side);
            if(stand(point)&&reachable(point))return new(point,true);
        }
        // No supported route means there is nowhere to load, rather than an imaginary floor target.
        return null;
    }
}
