using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Net.Mp;
using Scheldemist.Play;
using Scheldemist.World;

namespace Scheldemist.Movers;
public partial class Railway
{
    private sealed record Feed(string Route,float X,float Z);
    // shared/hauls.ts: only CRANE_FED source piles, as the server accepts them.
    private static readonly Feed[] feeds={new("rk-m",-9.41f,13.66f),new("hn-1",18.72f,11.72f),new("en-1",168.6f,44.38f),new("en-2",175,113.23f),new("wf-1",-300,12.5f),new("wf-2",-267.83f,11.73f),new("wf-3",-226.36f,11.78f)};
    private sealed class FeedState
    {public readonly List<(float P,float A,Feed Feed)> Berths=new();public float Wait;public Feed? Current;public int Count,Fed;public string? OldGoods;}
    private readonly Dictionary<Crane,FeedState> craneFeeds=new();
    private void MakeFeeds()
    {
        foreach(var c in cranes)
        {
            var state=new FeedState();craneFeeds.Add(c,state);
            foreach(var f in feeds)
            {
                float best=float.PositiveInfinity,pos=c.Pos;float? angle=null;
                float lo=c.Axis==' '?c.Pos:c.Lo,hi=c.Axis==' '?c.Pos:c.Hi;
                for(float p=lo;p<=hi;p+=.25f){var (x,z)=SiteAt(c,p);float off=Math.Abs(new Vector2(x-f.X,z-f.Z).Length()-RHook);if(off>=.65f||off>=best||HoldAngle(c,x,z,4) is not {} a)continue;best=off;pos=p;angle=a;}
                if(angle==null)continue;state.Berths.Add((pos,angle.Value,f));if(c.Axis!=' ')c.Berths.Add((pos,angle.Value));
            }
        }
    }
    private bool StartFeed(Crane c,float dt)
    {
        if(!craneFeeds.TryGetValue(c,out var state))return false;if(c.Ops.Count==0&&state.OldGoods!=null){c.Goods=state.OldGoods;state.OldGoods=null;state.Current=null;}state.Wait=Math.Max(0,state.Wait-dt);
        if(c.Mode!="berth"||c.Reserved||c.Ops.Count>0||state.Wait>0||Together.I?.Guest==true||Play.Goods.I?.Loaded!=true)return false;
        foreach(var b in state.Berths)
        {
            if(Math.Abs(b.P-c.Pos)>.3f)continue;int need=Play.Goods.I.PileNeed(b.Feed.Route);if(need==0)continue;
            int n=Math.Min(3,need);state.Current=b.Feed;state.Count=n;state.OldGoods=c.Goods;c.Goods="sacks";float unit=UnitH["sacks"]+Sling,top=5-need>=3?.23f:0;
            c.Ops.Add(new(){T=OpT.Hoist,V=Travel});c.Ops.Add(new(){T=OpT.Slew,V=b.A});c.Ops.Add(new(){T=OpT.Hoist,V=Tide.LevelAt(c.X,c.Z)+.25f+unit});c.Ops.Add(new(){T=OpT.Wait,V=1.6f});c.Ops.Add(new(){T=OpT.Take,Src=0});c.Ops.Add(new(){T=OpT.Hoist,V=Travel});c.Ops.Add(new(){T=OpT.Slew,V=AngleTo(c,b.Feed.X,b.Feed.Z)});c.Ops.Add(new(){T=OpT.Hoist,V=top+unit});c.Ops.Add(new(){T=OpT.Wait,V=1.2f});c.Ops.Add(new(){T=OpT.Drop,Src=3});c.Ops.Add(new(){T=OpT.Hoist,V=Travel});c.Ops.Add(new(){T=OpT.Done});c.OpT=0;state.Wait=4+(float)c.R()*4;return true;
        }
        return false;
    }
    private void FeedProbe()
    {
        Crane? chosen=null;FeedState? feeding=null;int before=0;string error="";bool prepared=false;
        MoversTest.Add(new(){Name="crane_feeds_docker_pile",Hour=13,Gap=65,MaxWait=90,MinMove=0,
            Start=()=>{prepared=false;error="";_=PrepareFeed();},
            Ready=()=>error!=""||prepared&&(chosen?.Carry!=null||feeding?.Fed>before),
            Where=()=> chosen==null?(Vector3.Zero,0,error):(new Vector3(chosen.X,chosen.Hy,chosen.Z),feeding?.Fed??0,"server-confirmed docker feeds"),
            View=()=> chosen==null?(new Vector3(0,10,20),new Vector3(0,0,5)):CraneView(chosen),
            Check=()=>error!=""?error:feeding?.Fed>before?"":"crane drop did not refill its real server pile"});
        async System.Threading.Tasks.Task PrepareFeed()
        {
            try
            {
                ulong until=Time.GetTicksMsec()+30000;while((Scheldemist.Net.ServerLink.I?.Up!=true||Play.Goods.I?.Loaded!=true||Main.I.GetNode<Scheldemist.Town.Townspeople>("Townspeople").Data==null)&&Time.GetTicksMsec()<until)await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);if(Scheldemist.Net.ServerLink.I?.Api is not {} api){error="server absent";return;}var town=Main.I.GetNode<Scheldemist.Town.Townspeople>("Townspeople");if(Play.Goods.I is not {} goods||!goods.Loaded||town.Data==null){error="goods or town not loaded";return;}
                state="shed";shedT=300;working=null;stops.Clear();v=0;
                foreach(var c in cranes){c.Ops.Clear();c.Reserved=false;c.Mode="berth";c.Stay=300;}
                foreach(var pair in craneFeeds)foreach(var berth in pair.Value.Berths)
                {
                    var c=pair.Key;if(!TryMove(c,berth.P,berth.A,Travel))continue;Play.Item? load=null;string prefix="haul:"+berth.Feed.Route+"a:";
                    foreach(var item in goods.All.Values){if(!item.S.Lies||!item.Id.StartsWith(prefix,StringComparison.Ordinal))continue;bool above=false;foreach(var other in goods.All.Values)if(other.S.On.Contains(item.Id)){above=true;break;}if(!above){load=item;break;}}
                    if(load==null)continue;before=pair.Value.Fed;
                    foreach(var person in town.Sims)
                    {
                        if(person.R.Work.Kind!="haul")continue;
                        var take=await api.MovingNpcLift(person.R.Id,load.Id);if(!take.Ok)continue;Play.Goods.I.MovingReply(take);var drop=await api.MovingNpcDrop(person.R.Id,load.Id);if(!drop.Ok){error=drop.Error??"docker failed to consume fixture sack";return;}Play.Goods.I.MovingReply(drop);
                        chosen=c;feeding=pair.Value;feeding.Wait=0;c.Mode="berth";c.Stay=300;prepared=StartFeed(c,0)||feeding.Current!=null&&c.Ops.Count>0||feeding.Fed>before;if(!prepared)error="hungry pile did not start crane feed";return;
                    }
                }
                error="no reachable crane and docker pile pair";
            }catch(Exception e){error=e.Message;}
        }
    }
    private void DropFeed(Crane c)
    {
        if(craneFeeds.TryGetValue(c,out var state)&&state.Current is {} feed){state.Current=null;int count=state.Count;_=Deliver();async System.Threading.Tasks.Task Deliver(){if(await Play.Goods.I.CranePut(feed.Route,count))state.Fed++;}}
    }
    private (float P,float A)? PreferredFeed(Crane c,List<(float P,float A)> candidates)
    {
        if(Play.Goods.I?.Loaded!=true||!craneFeeds.TryGetValue(c,out var state))return null;
        foreach(var b in state.Berths)if(Play.Goods.I.PileNeed(b.Feed.Route)>0)foreach(var candidate in candidates)if(Math.Abs(candidate.P-b.P)<.1f)return candidate;
        return null;
    }
}
