using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Movers;

/// <summary>The moving dots use the actual drawn places. The closed map needs no work.</summary>
[GamePart(910)]
public partial class MoverMap : Node
{
    private double wait;
    public static IEnumerable<MapMover> Marks()
    {
        if (Omnibus.I != null) foreach (var b in Omnibus.I.Buses) yield return new("omnibus",b.Pa.X,b.Pa.Y,b.Yaw,$"{b.Line.Board}: {(b.At!=null?b.At.Name:b.StopAt[b.NextI].Stop.Name)}");
        if (River.I != null) foreach (var r in River.I.Movers) yield return new("ship",(float)r.X,(float)r.Z,(float)r.Yaw,string.Join(" + ",r.K.Parts));
        if (River.I?.Anchorage is {} anchorage)
        {
            var liner=anchorage.Liner.Outer;
            yield return new("ship",liner.Position.X,liner.Position.Z,liner.Rotation.Y,"the ocean steamer at anchor");
            foreach (var tow in anchorage.Tows) { var p=tow.Lighter.Boat.Outer; yield return new("boat",p.Position.X,p.Position.Z,p.Rotation.Y,"the lighter: "+tow.Phase); }
        }
        if (Railway.I is {Running:true, State:not "shed"} rail) { var p=rail.HeadAt; yield return new("train",p.X,p.Z,rail.HeadYaw,"the quay goods train"); }
        if (Traffic.I!=null) foreach (var v in Traffic.I.Vehicles) yield return new("cart",v.At.X,v.At.Y,v.Yaw,$"{v.Route} {v.Kind}: {v.State}");
        if (GoodsDrays.I!=null) foreach (var r in GoodsDrays.I.Rigs) yield return new("cart",r.At.X,r.At.Y,r.Yaw,r.Label+(r.Moving?": on the way":": standing"));
    }
    public override void _Process(double delta)
    {
        if (TownMap.I?.Open!=true) { wait=0; return; }
        if ((wait-=delta)>0) return;
        wait=0.2;
        MoverCost.Begin("map"); TownMap.I.SetMovers(Marks()); MoverCost.End("map");
    }
}
