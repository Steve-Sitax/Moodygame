using System;
using Godot;
using Scheldemist.Movers;

namespace Scheldemist.Town;

public sealed partial class Crowd
{
    private bool BicycleSpoke(Puppet p,double ax,double az,double bx,double bz)
    {
        if(!map.SupportsStep(ax,az,bx,bz)||Bridges.Barred(ax,az,bx,bz))return false;
        int count=Math.Max(1,(int)Math.Ceiling(Hyp(bx-ax,bz-az)/NativeBicycleTurn.ArcSample));
        for(int i=0;i<=count;i++)if(!map.FreeFor(p,ax+(bx-ax)*i/count,az+(bz-az)*i/count))return false;
        return true;
    }

    private bool TryBicycleStep(Puppet p,double x,double z,double fraction,out double yaw)
    {
        yaw=p.Yaw;
        return p.Vehicle is {Kind:1,ClearSpoke:not null} vehicle&&NativeBicycleTurn.Step(
            new Vector2((float)p.X,(float)p.Z),new Vector2((float)x,(float)z),p.Yaw,p.Nose,p.Reach,
            p.Path,p.Pi,fraction,vehicle.InitialHeading,vehicle.ClearSpoke,out yaw,vehicle.ClearGrip);
    }
}
