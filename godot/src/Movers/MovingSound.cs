using System;
using System.Collections.Generic;
using Scheldemist.Audio;
namespace Scheldemist.Movers;

public partial class Bridges
{
    private readonly Dictionary<string,MovingShip> soundShips=new();
    internal void FillSoundShips(List<MovingShip> into)
    {
        foreach(var p in passages.Values)
        {
            if(p.Part==null||!p.Part.Boat.Outer.Visible)continue;
            if(!soundShips.TryGetValue(p.Name,out var ship))soundShips[p.Name]=ship=new(){Id="bridge:"+p.Name};
            var at=p.Part.Boat.Outer.GlobalPosition;ship.X=at.X;ship.Z=at.Z;ship.Kind=p.Kind;ship.Steam=Boats.IsSteam(p.Kind);ship.Heading=p.Part.Boat.Outer.Rotation.Y;ship.Speed=p.V;ship.Anchored=p.State is "up" or "river";into.Add(ship);
        }
    }
    private static void SoundSignal(Passage p)
    {
        if (p.Part == null || Main.I.Arg("soundtest")!="") return;
        var at = p.Part.Boat.Outer.GlobalPosition;
        Soundscape.I?.ShipSignal(new MovingShip { Id = "bridge:" + p.Name, Kind = p.Kind, X = at.X, Z = at.Z, Steam = Boats.IsSteam(p.Kind), Heading = p.Part.Boat.Outer.Rotation.Y, Speed = p.V }, "bridge");
    }
}
public partial class Lock
{
    private readonly MovingShip soundShip=new(){Id="lock"};
    internal void FillSoundShips(List<MovingShip> into)
    {
        if(cur==null||cur.Objs.Count==0||!cur.Objs[0].Outer.Visible)return;
        var boat=cur.Objs[0];var at=boat.Outer.GlobalPosition;soundShip.X=at.X;soundShip.Z=at.Z;soundShip.Kind=boat.Kind;soundShip.Steam=Boats.IsSteam(boat.Kind);soundShip.Heading=boat.Outer.Rotation.Y;soundShip.Speed=lastV;soundShip.Anchored=state is "dock" or "river";into.Add(soundShip);
    }
    private void SoundSignal(Train t)
    {
        if (t.Objs.Count == 0 || Main.I.Arg("soundtest")!="") return;
        var boat = t.Objs[0]; var at = boat.Outer.GlobalPosition;
        Soundscape.I?.ShipSignal(new MovingShip { Id = "lock", Kind = boat.Kind, X = at.X, Z = at.Z, Steam = Boats.IsSteam(boat.Kind), Heading = boat.Outer.Rotation.Y, Speed = lastV }, "lock");
    }
}
