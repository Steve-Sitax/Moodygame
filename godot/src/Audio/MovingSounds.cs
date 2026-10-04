using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Play;

namespace Scheldemist.Audio;

/// <summary>Reuse the Soundscape's browser hooks for the moving world.</summary>
[GamePart(929)]
public partial class MovingSounds : Node
{
    public static MovingSounds I {get;private set;}=null!;
    private readonly List<VehicleSound> vehicles=new(64);
    private readonly List<MovingShip> ships=new(128);
    private readonly Dictionary<Boats.Float,MovingShip> hulls=new();
    private readonly MovingShip ferry=new(){Id="st_anna",Kind="paddle",Steam=true};
    private Vector2 previousCart;
    private bool hadCart;
    private double wait;
    public int Vehicles=>vehicles.Count;
    public int Ships=>ships.Count;
    public override void _Ready()
    {
        I=this;Register();
    }
    private void Register()
    {
        if(Boats.I==null)return;
        for(int i=0;i<Boats.I.Floats.Count;i++){var boat=Boats.I.Floats[i];if(!hulls.ContainsKey(boat))hulls.Add(boat,new(){Id="hull_"+hulls.Count,Kind=boat.Kind,Steam=boat.Kind is "steamer" or "tug" or "paddle_tug",Anchored=boat.Kind=="liner"});}
    }
    public void Gather(double elapsed)
    {
        Register();vehicles.Clear();ships.Clear();
        if(Traffic.I is {} traffic)for(int i=0;i<traffic.Vehicles.Count;i++){var v=traffic.Vehicles[i];vehicles.Add(new(v.Kind,v.At.X,v.At.Y,v.V>.08f?"go":"stop"));}
        if(GoodsDrays.I is {} drays)for(int i=0;i<drays.Rigs.Count;i++){var v=drays.Rigs[i];if(v.Root.IsVisibleInTree())vehicles.Add(new(v.Cart!=null?"handcart":"dray",v.At.X,v.At.Y,v.Moving?"go":"stop"));}
        Railway.I?.AddSounds(vehicles);
        if(Omnibus.I!=null)for(int i=0;i<Omnibus.I.Buses.Count;i++){var b=Omnibus.I.Buses[i];vehicles.Add(new("dray",b.Pa.X,b.Pa.Y,b.V>.08f?"go":"stop"));}
        if(Handcarts.I?.Held is {} id&&Handcarts.I.Drawings.TryGetValue(id,out var c))
        {var p=new Vector2(c.X,c.Z);vehicles.Add(new("handcart",p.X,p.Y,hadCart&&p.DistanceTo(previousCart)>elapsed*.08?"go":"stop"));previousCart=p;hadCart=true;}else hadCart=false;
        if(Velocipedes.I?.Ridden is {} velo)vehicles.Add(new("handcart",velo.Root.GlobalPosition.X,velo.Root.GlobalPosition.Z,Math.Abs(Velocipedes.I.Speed)>.6f?"go":"stop"));
        foreach(var pair in hulls)
        {
            var b=pair.Key;if(!b.Outer.IsVisibleInTree())continue;var s=pair.Value;var p=b.Inner.GlobalPosition;s.X=p.X;s.Z=p.Z;s.Heading=b.Outer.Rotation.Y;s.Speed=0;
            for(int i=0;i<River.I.Movers.Count;i++){var m=River.I.Movers[i];foreach(var part in m.Parts)if(part.Boat==b)s.Speed=m.V;}
            if(River.I.Anchorage is {} anchorage)foreach(var tow in anchorage.Tows)if(tow.Tug.Boat==b||tow.Lighter.Boat==b)s.Speed=tow.V;
            ships.Add(s);
        }
        if(FerryArrival.I is {} f&&f.VisibleVessel){var p=f.VesselPosition;ferry.X=p.X;ferry.Z=p.Z;ferry.Heading=f.VesselHeading;ferry.Speed=f.VesselSpeed;ships.Add(ferry);}
    }
    public override void _Process(double delta)
    {
        wait+=delta;if(wait<.25)return;double elapsed=wait;wait=0;Gather(elapsed);
        if(Soundscape.I is {Prepared:true} sound){sound.SetVehicles(vehicles);sound.SetMovingShips(ships);}
    }
}
