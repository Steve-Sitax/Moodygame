using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Movers;
namespace Scheldemist.Audio;
public partial class LifeSound
{
    internal Dictionary<string,bool> WiringChecks()
    {
        var checks=new Dictionary<string,bool>{["live exact-room resolver"]=sound?.InteriorAt==Interior,["ground puddle resolver"]=sound?.PuddleAt==Puddle,["event tempest and gust resolver"]=sound?.TempestNow==Tempest};
        CollectVehicles();CollectShips();
        if(Traffic.I is {} traffic)
        {
            bool same=vehicles.Count>=traffic.Vehicles.Count;
            for(int i=0;i<traffic.Vehicles.Count&&same;i++){var v=traffic.Vehicles[i];same=vehicles[i].X==v.At.X&&vehicles[i].Z==v.At.Y;}
            checks["traffic sounds follow the actual vehicles"]=same;
        }
        bool finite=true;foreach(var ship in ships)finite&=double.IsFinite(ship.X)&&double.IsFinite(ship.Z)&&double.IsFinite(ship.Speed);
        checks["river, canal and lock sounds have real positions"]=finite;
        foreach(var r in counters)
        {
            float x=(r.minX+r.maxX)/2,z=(r.minZ+r.maxZ)/2;
            var p=new Vector3(r.x+x*r.c+z*r.s,r.y,r.z-x*r.s+z*r.c);
            string expected=r.id.StartsWith("tavern:")?"tavern":r.id=="poesje"?"cellar":"shop";
            checks["counter floor "+r.id]=Interior(p)==expected;
            checks["above counter floor "+r.id]=Interior(p+Vector3.Up*10)!=expected;
        }
        checks["dry ground has no puddle"]=Puddles.At(13,21,0)==0;
        return checks;
    }
}
