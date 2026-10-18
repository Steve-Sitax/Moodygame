using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Town;

namespace Scheldemist.Play;

public partial class ResidentJourneys
{
    private static void RequireJourneyTest()
    {if(Main.I.Arg("ridetest")==""&&Main.I.Arg("native-journey-proof")==""&&Main.I.Arg("movetest")=="")throw new InvalidOperationException("Journey controls require a disposable journey proof world.");}
    public string JourneyTestGo(string id,Vector2 destination,JourneyRules.Load? load=null,string previous="home",bool fromHome=true)
    {
        RequireJourneyTest();var s=town.ActionPerson(id);if(s==null||transport==null)return "no such resident";
        var old=Trips.FirstOrDefault(t=>t.Person==s);if(old!=null)End(old,false);if(s.ActionHeld)return "reserved";
        if(fromHome){town.ActionHide(s);s.X=s.R.HomeSx;s.Z=s.R.HomeSz;s.Door=new(s.R.HomeSx,s.R.HomeSz);s.Inside=true;}
        var from=new JourneyRules.Point(s.X,s.Z);var velo=transport.Vehicles.FirstOrDefault(v=>v.Owner==id&&v.Kind=="velocipede");var cart=transport.Vehicles.FirstOrDefault(v=>v.Owner==id&&v.Kind=="handcart");
        double[]? fetch=null;if(velo is {Gone:false}&&!inUse.Contains(velo.Id)&&velo.Parks.TryGetValue(previous,out var spot)&&Velocipedes.I.Machines.TryGetValue(velo.Id,out var bike)&&new Vector2(bike.Info.X,bike.Info.Z).DistanceTo(V(spot))<4)fetch=new double[]{bike.Info.X,bike.Info.Z,bike.Info.Yaw};
        var plan=JourneyRules.Choose(new(from,Point(destination),load,Velo:fetch!=null,Cart:cart is {Gone:false}&&!inUse.Contains(cart.Id),Stops:TransportStops,Age:s.R.Age));
        if(plan.Mode=="omnibus"){Start(s,destination,OmnibusLines.Stops.First(q=>q.Id==plan.Board!.Id&&q.Line==plan.Board.Line),OmnibusLines.Stops.First(q=>q.Id==plan.Alight!.Id&&q.Line==plan.Alight.Line));return plan.Mode;}
        if(plan.Mode is not("velocipede" or "handcart"))return plan.Mode;
        if(!town.ActionHold(s,this))return "reserved";var t=new Trip{Person=s,To=destination,Key="dev:destination",Mode=plan.Mode,Phase="fetch",Why="dev: "+plan.Why,Vehicle=plan.Mode=="velocipede"?velo:cart,Fetch=plan.Mode=="velocipede"?fetch:cart!.Parks.GetValueOrDefault(previous,cart.Home),Park=new double[]{destination.X,destination.Y,0},Load=load,Door=new((float)s.R.HomeSx,(float)s.R.HomeSz)};
        if(plan.Mode=="velocipede")Velocipedes.I.ResidentUse(velo!.Id,true);else{ParkCart(cart!.Id,t.Fetch!);cartAt[cart.Id]=previous;if(load is {Items:>0}){t.Phase="load";t.Helpers=Helpers(s,load.Items);}}
        inUse.Add(t.Vehicle!.Id);Trips.Add(t);s.Journey=t;s.OutAt=Time.GetTicksMsec();return plan.Mode;
    }
    public bool JourneyTestErrand(string vehicleId,bool home=false,Vector2? from=null)
    {
        RequireJourneyTest();var e=transport?.Errands.FirstOrDefault(e=>e.Vehicle==vehicleId);var s=e==null?null:town.ActionPerson(e.Who.FirstOrDefault()??"");if(s==null)return false;
        var old=Trips.FirstOrDefault(t=>t.Person==s);if(old!=null)End(old,false);if(s.ActionHeld)return false;
        town.ActionHide(s);s.X=from?.X??s.R.HomeSx;s.Z=from?.Y??s.R.HomeSz;s.Inside=false;return BeginErrand(s,e!,home);
    }
    public void JourneyTestCancel(string id){RequireJourneyTest();var trip=Trips.FirstOrDefault(t=>t.Person.R.Id==id);if(trip!=null)End(trip,false);}
}
