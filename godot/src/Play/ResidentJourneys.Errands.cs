using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Play;

public partial class ResidentJourneys
{
    private sealed record Flight(string Id,Vector2 Top,Vector2 Tangent,Vector2 Normal);
    private static readonly Flight[] Flights={new("vismarkt",new(-110,0),new(-1,0),new(0,-1)),new("rijnkaai",new(-4,0),new(-1,0),new(0,-1)),new("cartstand",new(50,0),new(1,0),new(0,-1)),new("north",new(186,0),new(1,0),new(0,-1)),new("canal",new(-70,38),new(0,1),new(-1,0)),new("bassin",new(90,46),new(1,0),new(0,1)),new("bassin_north",new(116,110),new(1,0),new(0,-1))};
    /// <summary>Where a boat ties up at a flight (issue 87): her own home when it is her household's flight, else the first
    /// place along the wall past the foot of the landing (or behind its head) where a rowing boat lies clear of every ladder
    /// and landing, of the flight and of the moored hulls. Found once a flight.</summary>
    private Vector2 Berth(Flight f,Net.ResidentVehicle? home=null)
    {
        if(home?.Home is {Length:>=2} h&&home.Boat is {Flight.Length:>=2} b&&V(b.Flight).DistanceTo(f.Top)<1)return new((float)h[0],(float)h[1]);
        if(berths.TryGetValue(f.Id,out var known))return known;
        if(NearBerth(f) is {} near)return berths[f.Id]=near;
        var spots=Spots();
        Vector2 found=f.Top+f.Tangent*5.41f+f.Normal*3;
        foreach(float s in Enumerable.Range(0,85).Select(i=>9+i*.25f).Concat(Enumerable.Range(0,110).Select(i=>-3.5f-i*.25f))){var c=f.Top+f.Tangent*s+f.Normal*1.25f;if(BerthClear(f,c,spots)){found=c;break;}}
        return berths[f.Id]=found;
    }
    private static List<(Vector2 At,Vector2 Axis,float Half,float Beam)> Spots()=>Boats.I.MooredSpots().Where(m=>!m.Gone).Select(m=>(At:new Vector2(m.X,m.Z),Axis:new Vector2(MathF.Sin(m.Yaw),MathF.Cos(m.Yaw)),Half:Boats.I.Dims(m.Kind).Length/2,Beam:Boats.I.Dims(m.Kind).Beam/2)).ToList();
    /// <summary>The place just past the foot of the flight's landing, against the wall or alongside a boat lying there, where a
    /// rowing boat lies clear (her people step out onto the landing, across that boat if need be); null when both are taken.</summary>
    private Vector2? NearBerth(Flight f)
    {
        if(nearBerths.TryGetValue(f.Id,out var known))return known;
        var spots=Spots();Vector2? found=null;
        foreach(float u in new[]{1.25f,3.25f}){for(float s=QuayExits.FlightEnd+3.5f;s<QuayExits.FlightEnd+6.5f&&found==null;s+=.25f){var c=f.Top+f.Tangent*s+f.Normal*u;if(BerthClear(f,c,spots))found=c;}if(found!=null)break;}
        return nearBerths[f.Id]=found;
    }
    private readonly Dictionary<string,Vector2?> nearBerths=new();
    /// <summary>
    /// Where a boat lies a minute alongside the flight's foot to put her people out onto its landing (#182), when she ties up out of
    /// their reach: just outside the treads, her side by the landing's edge, clear of every other hull, ladder and flight.
    /// </summary>
    private Vector2? LandingStop(Flight f)
    {
        if(landingStops.TryGetValue(f.Id,out var known))return known;
        var spots=Spots();Vector2? found=null;
        // centred on the landing first, then along it either way: up by the lowest treads (her stern still lies the whole
        // landing's length) or past its foot
        var along=Enumerable.Range(0,30).Select(i=>(i%2==0?-1:1)*(i+1)/2*.25f).Where(d=>d>=-3.5f&&d<=1.5f).ToArray();
        foreach(float u in new[]{2.75f,3.0f,3.3f}){foreach(float d in along){var c=f.Top+f.Tangent*(QuayExits.FlightEnd+d)+f.Normal*u;if(BerthClear(f,c,spots,f,FamilyHalf)){found=c;break;}}if(found!=null)break;}
        return landingStops[f.Id]=found;
    }
    private readonly Dictionary<string,Vector2?> landingStops=new();
    /// <summary>Half the length of the longest family boat (a rowing boat or a punt), with a hand's breadth to spare.</summary>
    public static float FamilyHalf=>MathF.Max(Boats.I.Dims("rowboat").Length,Boats.I.Dims("punt").Length)/2+.15f;
    private static bool BerthClear(Flight f,Vector2 c,List<(Vector2 At,Vector2 Axis,float Half,float Beam)> spots,Flight? alongside=null,float half=3.1f)
    {
        {
            for(float a=-half;a<=half+.01f;a+=MathF.Min(.5f,half/6))for(float s=-.85f;s<=.85f;s+=.425f)
            {
                var p=c+f.Tangent*a+f.Normal*s;if(!Water.In(p.X,p.Y))return false;
                foreach(var fl in Flights){var d=p-fl.Top;float along=d.Dot(fl.Tangent),u=d.Dot(fl.Normal);if(along>-.5f&&along<7.3f&&u>-.2f&&u<(fl==alongside?1.95f:3.1f))return false;}
                foreach(var m in spots){var d=p-m.At;if(MathF.Abs(d.Dot(m.Axis))<m.Half+.3f&&MathF.Abs(d.X*m.Axis.Y-d.Y*m.Axis.X)<m.Beam+.3f)return false;}
            }
            // a short stop alongside may lie over her own flight's climb-out place for swimmers
            foreach(var e in QuayExits.Exits){var d=new Vector2(e.Gx,e.Gz)-c;if(alongside!=null&&OwnExit(alongside,e))continue;if(MathF.Abs(d.Dot(f.Tangent))<3.1f+.9f&&MathF.Abs(d.Dot(f.Normal))<.85f+.9f)return false;}
            return true;
        }
    }
    private static bool OwnExit(Flight f,Exit e){var d=new Vector2(e.Gx,e.Gz)-f.Top;float along=d.Dot(f.Tangent),u=d.Dot(f.Normal);return along>-.5f&&along<QuayExits.FlightEnd+2.5f&&u>-.2f&&u<3.5f;}
    /// <summary>For the checks: each flight's berth and whether a boat there lands her people at the landing.</summary>
    public IEnumerable<(string Flight,bool Near,Vector2 At,float FromLanding)> BerthReport()=>Flights.Select(f=>{var b=Berth(f);float d=b.DistanceTo(LandingFoot(f));return(f.Id,d<=LandingReach||NearBerth(f)!=null||LandingStop(f)!=null,b,d);});
    /// <summary>The foot of a flight's landing, and how far from it a boat's people still step out onto it.</summary>
    private static Vector2 LandingFoot(Flight f)=>f.Top+f.Tangent*QuayExits.FlightEnd;
    private const float LandingReach=4.5f;
    /// <summary>For the checks: what lies in each flight's near berths (water, flights, moored hulls, ladders).</summary>
    public IEnumerable<string> BerthWhy()
    {
        var spots=Spots();
        foreach(var f in Flights)
        {
            var notes=new List<string>();
            foreach(var (u,s0,s1,stop) in new[]{(1.25f,QuayExits.FlightEnd+3.5f,QuayExits.FlightEnd+6.5f,false),(3.25f,QuayExits.FlightEnd+3.5f,QuayExits.FlightEnd+6.5f,false),(3.0f,QuayExits.FlightEnd-3.5f,QuayExits.FlightEnd+1.5f,true),(3.3f,QuayExits.FlightEnd-3.5f,QuayExits.FlightEnd+1.5f,true)})for(float s=s0;s<=s1;s+=1f)
            {
                var c=f.Top+f.Tangent*s+f.Normal*u;string why="";
                float half=stop?FamilyHalf:3.1f;
                for(float a=-half;a<=half+.01f&&why=="";a+=MathF.Min(.5f,half/6))for(float k=-.85f;k<=.85f&&why=="";k+=.425f)
                {
                    var p=c+f.Tangent*a+f.Normal*k;if(!Water.In(p.X,p.Y)){why="land at "+p.ToString("0.0");break;}
                    foreach(var fl in Flights){var d=p-fl.Top;float along=d.Dot(fl.Tangent),uu=d.Dot(fl.Normal);if(along>-.5f&&along<7.3f&&uu>-.2f&&uu<(stop&&fl==f?1.95f:3.1f)){why="flight "+fl.Id+" at "+p.ToString("0.0");break;}}
                    foreach(var m in spots){var d=p-m.At;if(MathF.Abs(d.Dot(m.Axis))<m.Half+.3f&&MathF.Abs(d.X*m.Axis.Y-d.Y*m.Axis.X)<m.Beam+.3f){why="hull at "+m.At.ToString("0.0");break;}}
                }
                foreach(var e in QuayExits.Exits){var d=new Vector2(e.Gx,e.Gz)-c;if(stop&&OwnExit(f,e))continue;if(why==""&&MathF.Abs(d.Dot(f.Tangent))<3.1f+.9f&&MathF.Abs(d.Dot(f.Normal))<.85f+.9f)why="exit at "+new Vector2(e.Gx,e.Gz).ToString("0.0");}
                notes.Add($"{(stop?"stop ":"")}u{u} s{s:0.0}: {(why==""?"clear":why)}");
            }
            yield return f.Id+": "+string.Join("; ",notes);
        }
    }
    private readonly Dictionary<string,Vector2> berths=new();
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
        // (issue 156) a boat the player has out, has left elsewhere or has wrecked is not at her mooring for her owner
        if(e.Kind=="boat"&&Rowing.I?.Data.Boats.FirstOrDefault(b=>b.Id==vehicle.Id) is {} rb&&(rb.Ridden||rb.Lost||rb.Mine||new Vector2(rb.X-rb.Home.X,rb.Z-rb.Home.Z).Length()>.5f))return false;
        var to=home?new Vector2((float)s.R.HomeSx,(float)s.R.HomeSz):V(e.To);
        var t=new Trip{Person=s,To=to,Key=s.Key,Mode=e.Kind,Phase="toberth",Vehicle=vehicle,Load=new(e.Load.What,e.Load.Items),Errand=e.Id,Returning=home,Why=home?"home with the vehicle":"an errand to "+e.ToLabel};
        if(e.Kind=="boat"&&vehicle.Boat is {} boat){if(boat.Flight.Length<2)return false;var homeFlight=Flights.FirstOrDefault(f=>f.Top.DistanceTo(V(boat.Flight))<1);if(homeFlight==null)return false;var there=Flights.FirstOrDefault(f=>f.Top.DistanceTo(V(e.To))<1)??homeFlight;var from=home?there:homeFlight;var dest=home?homeFlight:there;var b0=Berth(from,vehicle);var b1=Berth(dest,vehicle);
            // (#182) her own berth out of her people's reach from the landing (her home along the wall, or further along when the
            // places by the landing were taken): she comes alongside the landing first, they step out, she is taken on later
            Vector2? land=null;
            if(b1.DistanceTo(LandingFoot(dest))>LandingReach&&(NearBerth(dest)??LandingStop(dest)) is {} nb&&nb.DistanceTo(b1)>.5f)land=nb;
            var end=land??b1;
            var path=JourneyRules.WaterPath((x,z)=>Rowing.I.ResidentWaterFree((float)x,(float)z),Point(b0),Point(end),2,40);if(path==null){abandonedErrands.Add(e.Id);Note(s.R.Name+": no open water; walks");return false;}path[^1]=Point(end);
            var crew=e.Who.Where(id=>town.ActionPerson(id) is {} person&&!person.ActionHeld&&town.MaySimulate?.Invoke(id)!=false).ToList();
            t.BoatTrip=new(){Kind=boat.Kind,Path=path,Crew=crew,To=b1,ToTop=dest.Top,FromTop=from.Top,Home=home,Land=land,LandYaw=MathF.Atan2(dest.Tangent.X,dest.Tangent.Y)};var fetch=from.Top+from.Tangent*.8f;t.Fetch=new double[]{fetch.X,fetch.Y,0};
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
        // (issue 154) near the player they come down the steps and take their places before she casts off
        if(NearEye(t))Rowing.I.ResidentBoatBoard(t.Vehicle.Id,boat.FromTop);
        t.Phase="row";t.Time=0;
    }
    private void RowTrip(Trip t,double dt)
    {
        var boat=t.BoatTrip!;var eye=Main.I.Cam.GlobalPosition;bool near=new Vector2((float)t.Person.X-eye.X,(float)t.Person.Z-eye.Z).Length()<80;
        var at=Rowing.I.ResidentBoatStep(t.Vehicle!.Id,dt,near,near?1.35:6);
        if(at!=null)foreach(string id in boat.Crew){var s=town.ActionPerson(id);if(s!=null){s.X=at.Value.At.X;s.Z=at.Value.At.Y;}}
        if(at is {Done:false}&&t.Time<=400)return;
        // (issue 154) near the player they step out onto the landing and walk up the steps before they go on
        if(NearEye(t)&&at is {Done:true}){Rowing.I.ResidentBoatLand(t.Vehicle!.Id,boat.ToTop);t.Phase="landing";t.Time=0;return;}
        LandRowTrip(t);
    }
    /// <summary>Boats left lying at a landing (#182) and the berth each is taken on to once the player is away from both.</summary>
    private readonly List<(string Id,Vector2 Land,Vector2 To,bool Home)> takenOn=new();
    /// <summary>For the checks: how many boats lie at a landing, waiting to be taken on to their berth.</summary>
    public int BoatsWaitingAtLanding=>takenOn.Count;
    private void TakeOn()
    {
        var eye=Main.I.Cam.GlobalPosition;var me=new Vector2(eye.X,eye.Z);
        for(int i=takenOn.Count-1;i>=0;i--){var b=takenOn[i];if(b.Land.DistanceTo(me)<90||b.To.DistanceTo(me)<90)continue;Rowing.I.ResidentBoatEnd(b.Id,new Vector3(b.To.X,b.To.Y,0),b.Home);takenOn.RemoveAt(i);}
    }
    private bool NearEye(Trip t)=>new Vector2((float)t.Person.X-Main.I.Cam.GlobalPosition.X,(float)t.Person.Z-Main.I.Cam.GlobalPosition.Z).Length()<80;
    private void LandRowTrip(Trip t)
    {
        var boat=t.BoatTrip!;
        if(boat.Land is {} land){Rowing.I.ResidentBoatEnd(t.Vehicle!.Id,new Vector3(land.X,land.Y,boat.LandYaw),false);takenOn.Add((t.Vehicle.Id,land,boat.To,boat.Home));}
        else Rowing.I.ResidentBoatEnd(t.Vehicle!.Id,new Vector3(boat.To.X,boat.To.Y,0),boat.Home);
        for(int i=0;i<boat.Crew.Count;i++){var s=town.ActionPerson(boat.Crew[i]);if(s==null)continue;s.X=boat.ToTop.X+(i-1)*.8;s.Z=boat.ToTop.Y+1.5;s.InTrip=s.Aboard=false;s.OutAt=Time.GetTicksMsec();town.ActionOutside(s);if(s!=t.Person)town.ActionRelease(s,this);}
        t.Phase="walkon";t.Time=t.Go=0;
    }
}
