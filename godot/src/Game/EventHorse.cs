using Godot;
using Scheldemist.Models;
using Scheldemist.Movers;

namespace Scheldemist.Game;

/// <summary>The movers' existing hoof solver, on copies of the same model parts.</summary>
internal sealed class EventHorse
{
    public readonly Node3D Root = new() { Name = "event_horse" };
    private readonly Node3D? body;
    private readonly Node3D?[] upper = new Node3D?[4], lower = new Node3D?[4];
    private readonly HorseGait.Pose pose = new();
    public EventHorse()
    {
        var model = ModelLibrary.Get("props"); body = model?.Copy("tr_horse_body");
        if (body != null) Root.AddChild(body);
        for (int i = 0; i < 4; i++)
        {
            upper[i] = model?.Copy(i < 2 ? "tr_leg_front" : "tr_leg_hind"); lower[i] = model?.Copy(i < 2 ? "tr_leg_front_lo" : "tr_leg_hind_lo");
            if (upper[i] != null) Root.AddChild(upper[i]!); if (lower[i] != null) Root.AddChild(lower[i]!);
        }
        Set(0, 0, false);
    }
    public void Set(double distance, float moving, bool trot)
    {
        HorseGait.PoseAt(pose, (float)(distance / (trot ? HorseGait.TrotStride : HorseGait.WalkStride) % 1), moving, trot ? 1 : 0);
        if (body != null) body.Position = new Vector3(0, pose.Bob, 0);
        for (int i = 0; i < 4; i++)
        {
            var leg = pose.Legs[i];
            if (upper[i] != null) { upper[i]!.Position = new Vector3(leg.X, leg.Uy, leg.Uz); upper[i]!.Rotation = new Vector3(leg.Up, 0, 0); }
            if (lower[i] != null) { lower[i]!.Position = new Vector3(leg.X, leg.Ly, leg.Lz); lower[i]!.Rotation = new Vector3(leg.Lp, 0, 0); }
        }
    }
}
