using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.World;
namespace Scheldemist.Play;
public partial class PlacesTest
{
    private async Task WeddingPicture(string name,HallPeople.Figure figure)
    {
        var at=figure.Group.GlobalPosition;pictureTarget=at+Vector3.Up*.85f;pictureAt=at+new Vector3(2.2f,1.5f,-2.2f);
        for(int i=0;i<12;i++){float angle=i*MathF.Tau/12;var eye=at+new Vector3(MathF.Cos(angle)*2.2f,1.5f,MathF.Sin(angle)*2.2f);if(Solid.I.NameAt(eye,pictureTarget.Value)==""&&Solid.I.NameAt(pictureTarget.Value,eye)==""){pictureAt=eye;break;}}
        await Shot(name);pictureAt=pictureTarget=null;
    }
    private async Task AdvanceIndoor(Api api,int minutes)
    {
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/advance",new {minutes}));GameState.I.Apply(await api.Tick());Actors.I!.Apply(await api.Actions());
    }
    private async Task WeddingAndHall(Api api)
    {
        var halls=HallPeople.I!;var hall=halls.Halls.First(h=>h.Id=="townhall");
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {day=2,hour=11,minute=15,weather="clear"}));Daylight.I!.SetTime(13.75f);Daylight.I.Settle();
        var board=LandmarkLife.I.Point("townhall","board");await At(board.X,board.Z+1,board.X,board.Z,board.Y+1,board.Y);await LandmarkLife.I.Load();
        var civil=await api.LandmarkNow("townhall");halls.ApplyHall("townhall",await api.Get<JsonElement>("api/landmark/townhall"));replies.Add(new{civil});
        Check(civil.Civil is {ValueKind:JsonValueKind.Object},"town hall civil wedding follows engine weekday and hour");
        Check(await Until(()=>hall.Figures.Values.Any(f=>f.Role=="c_groom")&&hall.Figures.Values.Any(f=>f.Role=="c_bride"),10),"civil couple occupies real wedding hall");await WeddingPicture("townhall-civil-wedding",hall.Figures.Values.First(f=>f.Role=="c_groom"));
        foreach(string role in new[]{"registrar","alderman","clerk","concierge"})
        {
            var person=civil.People.First(p=>p.Role==role||p.Role==role+"_wed");halls.ApplyHall("townhall",await api.Get<JsonElement>("api/landmark/townhall"));
            bool present=await Until(()=>hall.Figures.ContainsKey(person.Id),12);replies.Add(new{hallActorProbe=new{role,present,figures=hall.Figures.Values.Select(f=>new{f.Id,f.Role}).ToArray(),held=Main.I.GetNode<Scheldemist.Town.Townspeople>("Townspeople").ActionPerson(person.Id)?.ActionHeld}});Check(present,"town hall "+role+" has physical work figure");
            var f=hall.Figures[person.Id];string motion=role=="registrar"?"write":role=="alderman"?"talk":f.Human.CanSit?"sit":"idle";Check(f.Motion==motion,"town hall "+role+" follows browser work routine");
            for(int k=0;k<12;k++){var at=f.Group.GlobalPosition;float angle=k*MathF.Tau/12;await At(at.X+MathF.Cos(angle)*.95f,at.Z+MathF.Sin(angle)*.95f,at.X,at.Z,at.Y+1.3f,at.Y);await LandmarkLife.I.Load();if(await Until(()=>Interact.I.Find().Any(a=>a.Text=="talk to "+person.Name),.6))break;}
            replies.Add(new{hallWorkProbe=new{role,LandmarkLife.I.Here,at=f.Group.GlobalPosition.ToString(),Jef.I.X,Jef.I.Z,Jef.I.Y,prompts=Interact.I.Find().Select(a=>a.Text).ToArray()}});
            Check(Interact.I.Find().Any(a=>a.Text=="talk to "+person.Name),"town hall "+role+" actual work/talk prompt");
            Interact.I.Press(Key.E);Check(await Until(()=>Talk.I!.IsOpen&&!Talk.I.Busy,12),"town hall "+role+" work paper uses ordinary talk owner");await Shot("townhall-"+role);Talk.I!.Close();
        }
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {hour=12,minute=15}));var after=await api.LandmarkNow("townhall");Check(after.Civil==null||after.Civil.Value.ValueKind==JsonValueKind.Null,"civil wedding ends at engine hour");
        // The events helper owns leads and procession. Exercise its real roster/door hooks here.
        await AdvanceIndoor(api,600);GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {day=2,hour=10,minute=0,weather="clear"}));
        var cath=halls.Halls.First(h=>h.Id=="cathedral");Jef.I.Place(cath.Origin.X+1.4f,cath.Origin.Z+12,MathF.PI,0,cath.Origin.Y);await Frames(30);
        halls.ApplyHall("cathedral",await api.Get<JsonElement>("api/landmark/cathedral"));cath.HadRoster=true;
        var plan=await api.DevEvent("wedding");Check(plan.Ok,"engine wedding fixture accepted");await AdvanceIndoor(api,2);
        TownEvent? live=(await api.Actions()).Events.FirstOrDefault(e=>e.Id==plan.Id);
        for(int i=0;i<16&&live!=null&&Events.StageOf(live)?.Op!="enter";i++){await AdvanceIndoor(api,(int)Math.Ceiling(live.StageLeft)+1);live=(await api.Actions()).Events.FirstOrDefault(e=>e.Id==plan.Id);}
        Check(live!=null&&Events.StageOf(live)?.Op=="enter","wedding reaches cathedral ceremony");await AdvanceIndoor(api,12);
        for(int i=0;i<12;i++){halls.ApplyHall("cathedral",await api.Get<JsonElement>("api/landmark/cathedral"));if(cath.Figures.Values.Any(f=>f.Ceremony&&f.Moving))break;await Frames(60);}
        Check(cath.Figures.Values.Any(f=>f.Ceremony&&f.Moving),"wedding people walk from real cathedral door");await WeddingPicture("wedding-entry",cath.Figures.Values.First(f=>f.Ceremony&&f.Moving));
        int entered=halls.CeremonyEntered;Check(await Until(()=>!cath.Figures.Values.Any(f=>f.Ceremony&&f.Moving&&!f.Leaving),78),"wedding party reaches ceremony positions");
        Check(halls.CeremonyEntered>entered,"wedding entrance completion recorded");await WeddingPicture("wedding-ceremony",cath.Figures.Values.First(f=>f.Ceremony&&!f.Leaving));
        live=(await api.Actions()).Events.First(e=>e.Id==plan.Id);await AdvanceIndoor(api,(int)Math.Ceiling(live.StageLeft)+1);halls.ApplyHall("cathedral",await api.Get<JsonElement>("api/landmark/cathedral"));
        Check(cath.Figures.Values.Any(f=>f.Ceremony&&f.Leaving&&f.Moving),"wedding party walks out of cathedral");Jef.I.Place(cath.Origin.X+1.4f,cath.Origin.Z-4,MathF.PI,0,0);await WeddingPicture("wedding-exit",cath.Figures.Values.First(f=>f.Ceremony&&f.Leaving));
        Check(await Until(()=>!cath.Figures.Values.Any(f=>f.Ceremony&&f.Leaving),55),"wedding party reaches street");
        for(int i=0;i<16;i++){live=(await api.Actions()).Events.FirstOrDefault(e=>e.Id==plan.Id);if(live==null||live.Status=="done")break;await AdvanceIndoor(api,(int)Math.Ceiling(live.StageLeft)+1);}
        Check(live==null||live.Status=="done","wedding completes engine procession and reception stages");replies.Add(new{wedding=plan.Id,entered=halls.CeremonyEntered-entered,finished=live});
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {day=1,hour=13,minute=45}));
    }
}
