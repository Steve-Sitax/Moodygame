using System.Threading.Tasks;
using System.Collections.Generic;
using Scheldemist.Play;

namespace Scheldemist.Net;
public sealed partial class Api
{
    public Task<PrisonView> MovingPrison()=>Get<PrisonView>("api/prison");
    public Task<PrisonVisit> MovingPrisonVisit(string? id=null)=>Post<PrisonVisit>("api/prison/visit",new{id});
    public Task<TransportText> MovingPrisonAsk(string role)=>Post<TransportText>("api/prison/ask",new{role});
    public Task<GoodsReply> MovingNpcLift(string npc,string id)=>GoodsAsk<GoodsReply>(new{op="npc_lift",npc,ids=new[]{id}});
    public Task<GoodsReply> MovingNpcDrop(string npc,string id)=>GoodsAsk<GoodsReply>(new{op="npc_drop",npc,id});
    public Task<GoodsReply> MovingFixtureItem(string id,double x,double z)=>Post<GoodsReply>("api/dev/goods",new{move=new object[]{id,x,z}});
    public Task<GoodsReply> CranePut(string route,int count)=>GoodsAsk<GoodsReply>(new{op="crane_put",route,n=count});
}

public sealed record PrisonWarder {public string Role {get;init;}="";public string Name {get;init;}="";}
public sealed record PrisonInmate {public string Id {get;init;}="";public string Name {get;init;}="";public int Since {get;init;}public int Until {get;init;}}
public sealed record PrisonView {public bool Visiting {get;init;}public bool Exercise {get;init;}public bool DayShift {get;init;}public int Ring {get;init;}public List<PrisonWarder> Warders {get;init;}=new();public List<PrisonInmate> Inmates {get;init;}=new();}
public sealed record PrisonVisit {public bool Ok {get;init;}public string? Id {get;init;}public string Text {get;init;}="";}
