using System;
using System.Collections.Generic;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Town;
using System.Linq;
using Godot;
namespace Scheldemist.Play;
public partial class JobTest
{
    private static void ClearDay(){if(World.Daylight.I is {} sky){sky.SetTime(12);sky.SetWeather("clear");sky.SetRain(0);sky.SetThickFog(false);sky.Settle();}}
    private IEnumerable<object?> ActorTwistStep()
    {
        Step("actor-twist","a watch-job briber walks up, offers the server-priced coin, and the server settles the report");
        var api=ServerLink.I!.Api!;var fixture=api.LifeJobFixture("watch","bribe");
        yield return When(()=>fixture.IsCompleted,10,"watch fixture from the engine");
        if(!fixture.IsCompletedSuccessfully){Fail("watch fixture failed");yield break;}
        int id=fixture.Result.GetProperty("id").GetInt32();var state=api.Jobs();yield return When(()=>state.IsCompleted,10,"watch offered");if(!state.IsCompletedSuccessfully){Fail("watch offers failed");yield break;}GameState.I.Apply(state.Result);
        var take=Jobs.I.TakeJob(GameState.I.Jobs.First(j=>j.Id==id));yield return When(()=>take.IsCompleted&&Jobs.I.Active?.Id==id,10,"watch taken");
        if(Jobs.I.Run is not WatchRun run){Fail("watch run absent");yield break;}
        var task=JobTask.Of(Jobs.I.Active!)!;var post=Spots.Get(task.Post)!;
        Stand(post.X+1.5f,post.Z,post.X,post.Z);
        yield return When(()=>run.Briber?.Present==true,75,"the real briber draws");
        if(run.Briber is not {Present:true} actor){Fail("briber did not arrive during the watch");yield break;}
        yield return When(()=>run.BriberState=="waiting",40,"briber stops beside Jef");
        var pos=actor.Position;LookAt(pos.X,pos.Z);
        Check(actor.Distance(Jef.I.X,Jef.I.Z)<3,"the briber did not walk into reach");
        Note("resident",actor.Who);Note("name",actor.Name);yield return .5;ClearDay();yield return .5;Shot("watch-briber");
        Check(Interact.I.Find().Any(a=>a.Text.Contains("take his coin")),"no bribe action beside the actor");
        Check(Interact.I.Press(Key.F),"F did not take the bribe");
        Stand(post.X+1.5f,post.Z,post.X,post.Z);
        yield return When(()=>Jobs.I.LastDone?.Job.Id==id,task.DurationS+10,"server settles actor-driven watch");
        Check(Jobs.I.LastDone?.Job.Id==id,"actor watch did not settle");if(Jobs.I.LastDone is {} done)Note("settlement",Settled(done));
        Check(actor.Gone,"job actor remains reserved after settlement");
    }
    private IEnumerable<object?> ActorStrangerStep()
    {
        Step("actor-stranger","a real stranger takes the carried job crate and the server settles the sale");
        var api=ServerLink.I!.Api!;var fixture=api.LifeJobFixture("carry","stranger_offer","crane_foot","vismarkt");
        yield return When(()=>fixture.IsCompleted,10,"stranger job fixture");if(!fixture.IsCompletedSuccessfully){Fail("stranger fixture failed");yield break;}
        int id=fixture.Result.GetProperty("id").GetInt32();var state=api.Jobs();yield return When(()=>state.IsCompleted,10,"stranger offer");if(!state.IsCompletedSuccessfully){Fail("stranger offers failed");yield break;}GameState.I.Apply(state.Result);
        var take=Jobs.I.TakeJob(GameState.I.Jobs.First(j=>j.Id==id));yield return When(()=>take.IsCompleted&&Jobs.I.Active?.Id==id,10,"stranger job taken");
        if(Jobs.I.Run is not HaulRun run){Fail("haul run absent");yield break;}
        var task=JobTask.Of(Jobs.I.Active!)!;var from=Spots.Get(task.From)!;Stand(from.X+2,from.Z+2,from.X,from.Z);
        yield return When(()=>Goods.I.Items.Any(i=>i.JobId==id),15,"job crate laid down");
        var item=Goods.I.Items.FirstOrDefault(i=>i.JobId==id);if(item==null){Fail("no stranger job crate");yield break;}
        Stand(item.X,item.Z+1.25f,item.X,item.Z,Down(1.25f));yield return .6;
        Check(Interact.I.Press(Key.E)&&Goods.I.Carried==item,"cannot lift stranger job crate");
        yield return When(()=>run.Stranger?.Present==true,90,"the real stranger draws");if(run.Stranger is not {Present:true} actor){Fail("stranger did not arrive");yield break;}
        yield return When(()=>!actor.Moving,45,"the stranger reaches his meeting place");
        var pos=actor.Position;Stand(pos.X+1.6f,pos.Z,pos.X,pos.Z,.35f);ClearDay();yield return .7;Shot("haul-stranger");Note("resident",actor.Who);
        Check(Interact.I.Find().Any(a=>a.Text.Contains("sell it to the stranger")),"no stranger sale beside the actor");Check(Interact.I.Press(Key.F),"F did not sell the original crate");
        yield return When(()=>Jobs.I.LastDone?.Job.Id==id,10,"server settles stranger sale");Check(Goods.I.Carried==null,"the sold crate remains in Jef's hands");if(Jobs.I.LastDone is {} done)Note("settlement",Settled(done));else Fail("stranger job did not settle");
    }
    private IEnumerable<object?> WindowStep()
    {
        Step("window","a home resident leans from their actual upstairs opening and retreats");
        var town=Main.I.GetNode<Townspeople>("Townspeople");
        yield return When(()=>town.DoorPlans>0&&StreetWindows.I!=null,20,"window plans load");
        if(town.WindowTrial() is not {} trial){Fail("no upstairs window plan");yield break;}
        var r=trial.person.R;town.SetClock(1,trial.hour);Note("resident",r.Id);Note("hour",trial.hour);
        double dx=r.HomeSx-r.HomeX,dz=r.HomeSz-r.HomeZ,length=Math.Max(.1,Whereabouts.Hypot(dx,dz));dx/=length;dz/=length;
        Stand((float)(r.HomeSx+dx*4),(float)(r.HomeSz+dz*4),(float)r.HomeX,(float)r.HomeZ);
        yield return When(()=>StreetWindows.I?.PositionOf(r.Id)!=null,10,"resident at the upper opening");
        if(StreetWindows.I?.PositionOf(r.Id) is {} at)
        {
            Check(at.Y>3,"window resident appeared on the street");Note("window_position",new[]{at.X,at.Y,at.Z});
            LookAt(at.X,at.Z,MathF.Atan2(at.Y+1.3f-Main.I.Cam.GlobalPosition.Y,(float)Whereabouts.Hypot(at.X-Jef.I.X,at.Z-Jef.I.Z)));ClearDay();yield return .5;Shot("upstairs-neighbour");
        }
        town.SetClock(1,trial.hour+25.0/120);
        yield return When(()=>StreetWindows.I?.PositionOf(r.Id)==null,5,"the window resident retreats");
        Check(StreetWindows.I?.PositionOf(r.Id)==null,"resident did not retreat into the room");
    }
    private IEnumerable<object?> HomeRemarkStep()
    {
        Step("home-remark","entering one's rented room brings the engine-selected neighbour, once per day");
        var api=ServerLink.I!.Api!;
        var set=api.DevSet(new Dictionary<string,double>{["money_c"]=1000,["hour"]=13,["minute"]=45});
        yield return When(()=>set.IsCompleted,10,"home test clock");
        if(!set.IsCompletedSuccessfully){Fail("home test clock failed");yield break;}GameState.I.Apply(set.Result);
        var take=api.HomeTake(new("alley","day"));yield return When(()=>take.IsCompleted,10,"rent from the engine");
        if(!take.IsCompletedSuccessfully){Fail("home rent failed");yield break;}GameState.I.Apply(take.Result);
        var load=HomeLife.I.Load();yield return When(()=>load.IsCompleted&&HomeLife.I.Info?.Lease?.Home=="alley",15,"leased room loads");
        if(!HomeLife.I.Frames.TryGetValue("alley",out var f)){Fail("no alley home frame");yield break;}
        var local=f.Local(f.Bed.X,f.Bed.Z);var at=f.World(local.X+1.3f,local.Y);
        Stand(at.X,at.Z,f.Bed.X,f.Bed.Z,0,f.Y);
        yield return When(()=>f.Inside,5,"inside the actual home floor");
        int money=GameState.I.Money;double food=GameState.I.Food,warm=GameState.I.Warmth;
        yield return When(()=>HomeRemarks.I?.Last!=null,25,"automatic engine home remark");
        var remark=HomeRemarks.I?.Last;
        Check(remark!=null,"no automatic home remark");
        Check(HomeVisitors.I?.Drawn>0,"the selected visitor did not draw");
        Check(GameState.I.Money==money&&GameState.I.Food==food&&GameState.I.Warmth==warm,"a remark changed gameplay numbers");
        if(remark!=null){Note("visitor",remark.Who);Note("line",remark.Line);Note("source",remark.Source);if(HomeVisitors.I?.PositionOf(remark.Who.Id) is {} pos){LookAt(pos.X,pos.Z,0);yield return .5;Shot("home-neighbour");}}
        int requests=HomeRemarks.I?.Requests??0;
        Stand(-118,36,-118,30);yield return When(()=>!f.Inside&&HomeVisitors.I?.Drawn==0,5,"the home visitor leaves with Jef");
        Check(HomeVisitors.I?.Drawn==0,"home visitor remains after Jef leaves");
        Stand(at.X,at.Z,f.Bed.X,f.Bed.Z,0,f.Y);yield return 1.0;
        Check(HomeRemarks.I?.Requests==requests,"home remark was requested twice on the same day");
        Stand(-118,36,-118,30);
    }
}
