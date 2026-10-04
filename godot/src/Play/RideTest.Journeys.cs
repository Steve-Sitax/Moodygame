using System;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
namespace Scheldemist.Play;
public partial class RideTest
{
    private async Task JourneyCheck(Api api)
    {
        var town=Main.I.GetNode<Townspeople>("Townspeople");Require(await Until(()=>town.Data!=null,20),"named town roster ready");
        var trips=ResidentJourneys.I!;MoverClock.Hold(13.75,1);GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{hour=13,minute=45,money_c=2000,weather="clear"}));
        var bus=Omnibus.I.Buses.First(b=>b.Line.Id=="kaaien");Omnibus.I.JourneyTestStop(bus,"werf");
        var board=bus.At!;var alight=OmnibusLines.Stops.First(s=>s.Line==board.Line&&s.Id=="bassin");var waiting=Omnibus.WaitingAt(board);
        Require(trips.Plan(waiting,new(alight.X,alight.Z))!=null,"server transport rules choose omnibus for a long connected journey");Require(trips.Plan(waiting,waiting+Vector2.Right*100)==null,"short resident journey stays on foot");
        var person=town.Sims.First(s=>!s.ActionHeld&&s.R.Age>=18&&s.Kind!="carter");town.ActionHide(person);person.X=waiting.X;person.Z=waiting.Y;
        int boarded=trips.Boarded,off=trips.Alighted,finished=trips.Finished;Require(trips.Start(person,Omnibus.WaitingAt(alight),board,alight),"named resident starts an owned journey");
        Require(await Until(()=>trips.Boarded>boarded,12),"named resident boards a real free omnibus seat");
        Require(Omnibus.I.Passengers(bus).Any(p=>p.Id==person.R.Id)&&person.Inside,"named passenger drawn once in omnibus");
        var step=Ride.StepOf(bus);Jef.I.Place(step.X-MathF.Sin(bus.Yaw)*.8f,step.Z-MathF.Cos(bus.Yaw)*.8f,bus.Yaw+MathF.PI);await Frames(5);
        int money=GameState.I.Money;await Ride.I.Board(bus);Require(await Until(()=>Ride.I.Bus==bus&&!Ride.I.Busy,10),"Jef boards alongside named resident");Require(GameState.I.Money<money,"only Jef pays the server fare");await Shot("journey-with-resident");
        var at=new Vector2(Jef.I.X,Jef.I.Z);bus.DwellT=0;bus.DepartAt=(MoverClock.Day-1)*1440+MoverClock.HourF*60;Require(await Until(()=>new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(at)>.2f,15),"omnibus leaves its real stop");await Frames(10);
        Require(new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(at)>.2f,"Jef travels in the same moving omnibus as the resident");
        Omnibus.I.JourneyTestStop(bus,alight.Id);Require(await Until(()=>trips.Alighted>off,20),"named resident walks out at the planned stop");
        Require(await Until(()=>trips.Finished>finished,20),"named resident walks on and releases schedule ownership");Require(!person.ActionHeld,"resident resumes ordinary day without a stale claim");await Ride.I.Leave();await Frames(10);Jef.I.Place(alight.X+4,alight.Z+4,-MathF.PI/4,-.15f);await Shot("journey-resident-ashore");
        replies.Add(new{journey=new{person.R.Id,person.R.Name,trips.Boarded,trips.Alighted,trips.Finished,trips.WalkFallbacks}});
    }
    private async Task CraneRungsCheck(Api api)
    {
        MoverClock.Hold(13.75,1);var rail=Railway.I;var climb=CraneClimb.I;
        int id=Enumerable.Range(0,rail.LadderCount).First(i=>climb.FootOf(i)!=null);var foot=climb.FootOf(id)!.Value;Jef.I.Place(foot.X,foot.Z,rail.LadderAt(id).Face,.2f);climb.Up(id);Jef.I.SetKey(Key.W,true);
        Require(await Until(()=>climb.OnLadder&&Jef.I.Y>3.4f,15),"Jef climbs to real crane rungs above the legs' stop height");Jef.I.ClearKeys();var before=climb.Saved();await Shot("crane-rungs-before");
        Require(before.Ladder&&before.Height>3&&before.Height<5.42f,"save captures ladder height rather than gallery coordinates");await SavedRide(api,"crane",()=>climb.On==id&&climb.OnLadder);
        var after=climb.Saved();Require(Math.Abs(after.Height-before.Height)<.02f,"menu load restores the same rung height");Require(Math.Abs(Jef.I.Y-after.Height)<.02f,"restored rungs retain finite live feet");
        rail.RiderTestTravel(id);var at=new Vector2(Jef.I.X,Jef.I.Z);Require(await Until(()=>new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(at)>.1f,15),"saved rungs carry Jef when the portal travels");await Shot("crane-rungs-restored");Jef.I.SetKey(Key.S,true);Require(await Until(()=>climb.On<0,15),"restored rung controls descend to the reachable foot");Jef.I.ClearKeys();Require(Jef.I.Drive==null&&!Jef.I.Swimming,"restored rung exit returns ordinary walking");
    }
    private async Task PrisonCheck(Api api)
    {
        var prison=People.PrisonPeople.I!;MoverClock.Hold(15.5,1);GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{hour=15,minute=30,weather="clear"}));await prison.Load();
        Require(await Until(()=>prison.State!=null,10),"prison roster loads from the server");var f=prison.Frame;var stand=f*new Vector3(8,0,2.6f);Jef.I.Place(stand.X,stand.Z,f.Basis.GetEuler().Y);await Frames(20);
        int shown=prison.Figures.Count(x=>x.Root.Visible);Require(shown>=4,"warders and prisoners stand in the real prison");if(prison.State!.Exercise)Require(prison.RingCount>0,"exercise ring walks in exercise hours");
        var pacer=prison.Figures.First(x=>x.Id=="cellA");double sx=pacer.Round.X,sz=pacer.Round.Z;bool moved=await Until(()=>Math.Abs(pacer.Round.X-sx)+Math.Abs(pacer.Round.Z-sz)>.3,40);Require(moved,"prisoner paces his cell on the checked floor");
        var from=f*new Vector3(0,0,1.6f);var to=f*new Vector3((float)prison.Figures.First(x=>x.Id=="corridorA").Round.Home.x,0,(float)prison.Figures.First(x=>x.Id=="corridorA").Round.Home.z);
        var route=People.HallPeople.PrisonRoute(prison.Floor,from,to);Require(route.Count>0&&route.All(p=>People.HallPeople.PrisonFree(prison.Floor,p)),"gate to corridor route stays on free prison floor");
        var near=prison.Figures.Where(x=>x.Root.Visible).OrderBy(x=>x.Root.GlobalPosition.DistanceTo(new(Jef.I.X,Jef.I.Y,Jef.I.Z))).First().Root.GlobalPosition;Jef.I.Yaw=MathF.Atan2(-(near.X-Jef.I.X),-(near.Z-Jef.I.Z));Jef.I.Pitch=-.1f;await Frames(10);await Shot("prison-hall");
        var yard=prison.Figures.First(x=>x.Id=="yard");if(yard.Root.Visible){var c=yard.Root.GlobalPosition;var eye=f*new Vector3((float)yard.Round.Home.x+8.5f,0,(float)yard.Round.Home.z);Jef.I.Place(eye.X,eye.Z,MathF.Atan2(-(c.X-eye.X),-(c.Z-eye.Z)),-.12f);await Frames(20);await Shot("prison-yard");}
replies.Add(new{prison=new{shown,prison.RingCount,prison.State.Visiting,prison.State.Exercise,routePoints=route.Count,moved}});
    }
}
