using Godot;
using Scheldemist.Play;
using Scheldemist.Movers;

namespace Scheldemist.Net.Mp;

/// <summary>Protocol 5 omnibus frame, shared/mpProtocol.ts baseId and together.ts onPlatform.</summary>
public static class RidePlatforms
{
    public static void Sample(ref MpState state)
    {
        if(Ride.I?.Bus is not {} bus)return;
        var local=bus.Frame.GlobalTransform.AffineInverse()*new Vector3(state.X,state.Y,state.Z);
        state.Base=(MpProtocol.BaseOmnibus<<8)|(bus.Index&255);
        state.Lx=local.X;state.Ly=local.Y;state.Lz=local.Z;state.Lyaw=state.Yaw-bus.Yaw;
        state.Mode=MpProtocol.ModeIndex(Ride.I.Seat<0?"ride":"sit");state.Gear=0;
    }
    public static void Place(ref Pose pose)
    {
        if((pose.Base>>8)!=MpProtocol.BaseOmnibus||Omnibus.I==null)return;
        for(int i=0;i<Omnibus.I.Buses.Count;i++){var bus=Omnibus.I.Buses[i];if(bus.Index!=(pose.Base&255))continue;
        {var at=bus.Frame.GlobalTransform*new Vector3(pose.Lx,pose.Ly,pose.Lz);pose.X=at.X;pose.Y=at.Y;pose.Z=at.Z;pose.Yaw=bus.Yaw+pose.Lyaw;return;}}
    }
}
