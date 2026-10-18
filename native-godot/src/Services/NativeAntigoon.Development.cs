using System;
using System.Linq;
using System.Text.Json.Nodes;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;
namespace Scheldemist.Native.Services;

public sealed partial class NativeAntigoon
{
    public Func<P,(P Home,P Watch)?> DevelopmentStage=_=>null;
    public Func<P,string> BlockReason=_=>"";
    /// <summary>Raw giant clearance, without his reachability map. Proof aid.</summary>
    public Func<P,bool> Fits=_=>false;
    public Func<AntigoonReach>? ReachMap;
    internal P? DevelopmentPosition=>brain?.Position;
    internal double DevelopmentYaw=>brain?.Yaw??0;
    internal string PlayerTrace(int id)=>$"host {PositionOf(id)}, available {Available(id)}, where {host.Clock.Where(id).ToJsonString()}, health {host.Player(id)["health"]}";
    internal string? FoodTarget=>brain?.GoingFor;
    internal const double FoodProofMaximumSeconds=600;
    internal string FoodGoal()=>brain?.GoingFor is {} id&&brain.Foods.FirstOrDefault(f=>f.Id==id) is {} f?$"food goal {id} at ({f.Stand.X:0},{f.Stand.Z:0}), {f.Stand.Distance(brain.Position):0} m, path {(Path(brain.Position,f.Stand)?.Count.ToString()??"none")} points":"no food goal";
    internal object FoodPlan()=>new{goal=brain?.GoingFor,foods=brain?.Foods.Select(f=>new{id=f.Id,light=Light(f.Stand),clear=Clear(f.Stand),distance=f.Stand.Distance(brain.Position),routeMetres=FoodRouteMetres(f.Stand)}).ToArray()};
    private double FoodRouteMetres(P stand)
    {
        if(brain==null||Path(brain.Position,stand) is not {Count:>0} path)return 0;
        return brain.Position.Distance(path[0])+path.Zip(path.Skip(1),(a,b)=>a.Distance(b)).Sum();
    }
    internal double FoodWaitSeconds()=>brain==null?120:Math.Clamp(brain.Foods.Where(f=>f.Id==brain.GoingFor).Select(f=>FoodRouteMetres(f.Stand)/AntigoonBrain.ShieldSpeed*2+AntigoonBrain.EatTime+30).DefaultIfEmpty(300).Max(),120,FoodProofMaximumSeconds);
    /// <summary>Proof aid: his food places, and what he is eating and has eaten.</summary>
    internal string FoodTrace()=>brain==null?"none":$"{brain.Foods.Count} food places ({string.Join(", ",brain.Foods.GroupBy(f=>f.Kind).Select(g=>g.Count()+" "+g.Key))}), meal {brain.Meal??"none"}, eaten {brain.Eaten.Count}, animals seen {Beasts().Count}; going for {brain.GoingFor??"none"}; "+string.Join("; ",brain.Foods.Select(f=>$"{f.Id} {f.Kind} {f.Stand.Distance(brain.Position):0} m lit {Light(f.Stand):0.00}"));
    /// <summary>Proof trace of the live brain. Call through WithState.</summary>
    internal string DevelopmentTrace()=>brain==null?"none":$"{brain.State} at ({brain.Position.X:0.0},{brain.Position.Z:0.0}) target {brain.Target} patrol {brain.Patrol.Count} light {Light(brain.Position):0.00} shield goal ({brain.Goals.Shield.X:0.0},{brain.Goals.Shield.Z:0.0}) lit {Light(brain.Goals.Shield):0.00} patrol goal ({brain.Goals.Patrol.X:0.0},{brain.Goals.Patrol.Z:0.0}) lit {Light(brain.Goals.Patrol):0.00}";
    private void RegisterDevelopment(NativeServiceHost service)
    {
        service.Register("POST","/api/dev/antigoon",r=>
        {
            if(r.PlayerId!=1)throw new NativeServiceException("Only the host starts development events.",403);
            if(PositionOf(r.PlayerId) is not {} player)throw new NativeServiceException("Enter the town before starting Antigoon.",409);
            var clock=host.Clock.View();int day=(int)NativeGoods.Number(clock["day"]),hour=(int)NativeGoods.Number(clock["hour"]),minute=(int)NativeGoods.Number(clock["minute"]);
            host.Clock.SetTime(day,22,0);
            var stage=DevelopmentStage(player);
            if(stage is not {} at||!Clear(at.Home)||Light(at.Home)>=.25||!Clear(at.Watch)||Path(at.Home,at.Watch) is not {Count:>0})
            {
                host.Clock.SetTime(day,hour,minute);
                throw new NativeServiceException("No dark street on Antigoon's map is near enough.",409);
            }
            observed.Clear();developmentEnabled=true;Create(at.Home);brain!.Patrol.Insert(0,at.Watch);brain.Reveal();last=host.Context.Now;Save();
            host.Clock.ResetLimits();host.PublishState();
            var view=View(r.PlayerId);view["watch_x"]=at.Watch.X;view["watch_y"]=Ground(at.Watch);view["watch_z"]=at.Watch.Z;
            view["world"]=host.Payload(r.PlayerId);return view;
        });
    }
}
