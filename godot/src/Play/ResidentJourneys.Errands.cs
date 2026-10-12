using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Town;

namespace Scheldemist.Play;

public partial class ResidentJourneys
{
    private sealed record Flight(string Id,Vector2 Top,Vector2 Tangent,Vector2 Normal);
    private static readonly Flight[] Flights={new("vismarkt",new(-110,0),new(-1,0),new(0,-1)),new("rijnkaai",new(-4,0),new(-1,0),new(0,-1)),new("cartstand",new(50,0),new(1,0),new(0,-1)),new("north",new(186,0),new(1,0),new(0,-1)),new("canal",new(-70,38),new(0,1),new(-1,0)),new("bassin",new(90,46),new(1,0),new(0,1)),new("bassin_north",new(116,110),new(1,0),new(0,-1))};
    private static Vector2 Berth(Flight f)=>f.Top+f.Tangent*5.41f+f.Normal*3;
    public Pt? ScheduledErrandPoint(Townspeople.Sim s)
    {var e=transport?.Day==town.Day?transport.Errands.FirstOrDefault(e=>e.Who.Contains(s.R.Id)&&town.Hour>=e.Hour&&town.Hour<e.Back):null;return e==null?null:new Pt(e.To[0],e.To[1]);}
    private void UpdateErrands()
    {
        if(transport?.Day!=town.Day)return;
        foreach(var e in transport.Errands){bool home=town.Hour>=e.Back;if(town.Hour<e.Hour||completedErrands.Contains(e.Id+(home?":home":":out"))||home&&abandonedErrands.Contains(e.Id))continue;
            var s=town.ActionPerson(e.Who.FirstOrDefault()??"");if(s==null||s.ActionHeld||s.InTrip||town.MaySimulate?.Invoke(s.R.Id)==false)continue;
            if(BeginErrand(s,e,home))completedErrands.Add(e.Id+(home?":home":":out"));
        }
    }
    private bool BeginErrand(Townspeople.Sim s,Net.ResidentErrand e,bool home)
    {
        var vehicle=transport!.Vehicles.FirstOrDefault(v=>v.Id==e.Vehicle);if(vehicle==null||vehicle.Gone)return false;
        var to=home?new Vector2((float)s.R.HomeSx,(float)s.R.HomeSz):V(e.To);
        var t=new Trip{Person=s,To=to,Key=s.Key,Mode=e.Kind,Phase="toberth",Vehicle=vehicle,Load=new(e.Load.What,e.Load.Items),Errand=e.Id,Returning=home,Why=home?"home with the vehicle":"an errand to "+e.ToLabel};
        if(e.Kind=="boat"&&vehicle.Boat is {} boat){if(boat.Flight.Length<2)return false;var homeFlight=Flights.FirstOrDefault(f=>f.Top.DistanceTo(V(boat.Flight))<1);if(homeFlight==null)return false;var there=Flights.FirstOrDefault(f=>f.Top.DistanceTo(V(e.To))<1)??homeFlight;var from=home?there:homeFlight;var dest=home?homeFlight:there;var b0=Berth(from);var b1=Berth(dest);var path=JourneyRules.WaterPath((x,z)=>Rowing.I.ResidentWaterFree((float)x,(float)z),Point(b0),Point(b1),2,40);if(path==null){abandonedErrands.Add(e.Id);Note(s.R.Name+": no open water; walks");return false;}path[^1]=Point(b1);
            var crew=e.Who.Where(id=>town.ActionPerson(id) is {} person&&!person.ActionHeld&&town.MaySimulate?.Invoke(id)!=false).ToList();
            t.BoatTrip=new(){Kind=boat.Kind,Path=path,Crew=crew,To=b1,ToTop=dest.Top,Home=home};var fetch=from.Top+from.Tangent*.8f;t.Fetch=new double[]{fetch.X,fetch.Y,0};
        }else if(e.Kind=="dray"&&vehicle.Route is {} route){var yard=Traffic.I?.ResidentYards().FirstOrDefault(y=>y.Route==route);if(yard==null)return false;t.Fetch=new double[]{yard.At.X,yard.At.Y,yard.Yaw};t.Park=t.Fetch;t.Unload=home?0:e.Load.Items;t.To=home?yard.At:V(e.To);}
        else return false;
        if(!town.ActionHold(s,this))return false;s.Journey=t;Trips.Add(t);Note(s.R.Name+": "+t.Why);
        if(t.BoatTrip!=null)foreach(string id in t.BoatTrip.Crew.Skip(1)){var person=town.ActionPerson(id);if(person!=null)person.InTrip=true;}
        return true;
    }
    private void BerthTrip(Trip t,double dt)
    {
        var at=V(t.Fetch!);var s=t.Person;
        if(t.Mode=="dray"){if(Near(t,at,s.P==null?.6:4.5)||s.P!=null&&t.Time>60){Traffic.I?.ResidentAway(t.Vehicle!.Route!,true);t.Park=null;TakeVehicle(t);}else Go(t,at,dt);return;}
        foreach(string id in t.BoatTrip!.Crew.Skip(1)){
            var crew=town.ActionPerson(id);if(crew==null||!crew.InTrip)continue;
            if(!crew.ActionHeld){var door=crew.Door;if(town.ActionHold(crew,this)){crew.X=door.X;crew.Z=door.Z;crew.OutAt=Time.GetTicksMsec();}}
            if(crew.P==null){town.ActionMoveHidden(crew,at.X+1,at.Y+.5,6*dt);if(new Vector2((float)crew.X-Main.I.Cam.GlobalPosition.X,(float)crew.Z-Main.I.Cam.GlobalPosition.Z).Length()<55)town.ActionClaim(crew);}
            else if(!town.Crowd!.PuppetBusy(crew.P))town.Crowd.PuppetGo(crew.P,at.X+1,at.Y+.5,1.3);
        }
        bool ready=t.BoatTrip.Crew.Skip(1).All(id=>town.ActionPerson(id) is not {} crew||!crew.InTrip||new Vector2((float)(crew.P?.X??crew.X),(float)(crew.P?.Z??crew.Z)).DistanceTo(at)<=4)||t.Time>=40;
        if(Near(t,at,1.8)&&ready){StartRowTrip(t);return;}
        if(s.P==null){double d=new Vector2((float)s.X,(float)s.Z).DistanceTo(at);town.ActionMoveHidden(s,at.X,at.Y,Math.Max(6,d/6)*dt);return;}
        if(t.Time>30&&!s.P.Shown){town.ActionHide(s);return;}
        if(t.Time>45){abandonedErrands.Add(t.Errand!);Note(s.R.Name+" gives up on the boat and walks");End(t,false);return;}
        Go(t,at,dt);
    }
    private void StartRowTrip(Trip t)
    {
        var boat=t.BoatTrip!;var crew=boat.Crew.Select(id=>town.ActionPerson(id)).Where(s=>s!=null).Cast<Townspeople.Sim>().ToArray();
        foreach(var s in crew){s.InTrip=s.Aboard=true;town.ActionInside(s,s.X,s.Z);}
        Rowing.I.ResidentBoatOut(t.Vehicle!.Id,boat.Kind,boat.Path,crew.Select(s=>(s.R.Id,s.Kind)).ToArray(),boat.Home?0:t.Load?.Items??0,boat.Home);
        t.Phase="row";t.Time=0;
    }
    private void RowTrip(Trip t,double dt)
    {
        var boat=t.BoatTrip!;var eye=Main.I.Cam.GlobalPosition;bool near=new Vector2((float)t.Person.X-eye.X,(float)t.Person.Z-eye.Z).Length()<80;
        var at=Rowing.I.ResidentBoatStep(t.Vehicle!.Id,dt,near,near?1.35:6);
        if(at!=null)foreach(string id in boat.Crew){var s=town.ActionPerson(id);if(s!=null){s.X=at.Value.At.X;s.Z=at.Value.At.Y;}}
        if(at is {Done:false}&&t.Time<=400)return;
        Rowing.I.ResidentBoatEnd(t.Vehicle!.Id,new Vector3(boat.To.X,boat.To.Y,0),boat.Home);
        for(int i=0;i<boat.Crew.Count;i++){var s=town.ActionPerson(boat.Crew[i]);if(s==null)continue;s.X=boat.ToTop.X+(i-1)*.8;s.Z=boat.ToTop.Y+1.5;s.InTrip=s.Aboard=false;s.OutAt=Time.GetTicksMsec();town.ActionOutside(s);if(s!=t.Person)town.ActionRelease(s,this);}
        t.Phase="walkon";t.Time=t.Go=0;
    }
}
