using System.Threading.Tasks;
using Scheldemist.Play;

namespace Scheldemist.Net;
public sealed partial class Api
{
    public Task<GoodsReply> MovingNpcLift(string npc,string id)=>GoodsAsk<GoodsReply>(new{op="npc_lift",npc,ids=new[]{id}});
    public Task<GoodsReply> MovingNpcDrop(string npc,string id)=>GoodsAsk<GoodsReply>(new{op="npc_drop",npc,id});
    public Task<GoodsReply> MovingFixtureItem(string id,double x,double z)=>Post<GoodsReply>("api/dev/goods",new{move=new object[]{id,x,z}});
    public Task<GoodsReply> CranePut(string route,int count)=>GoodsAsk<GoodsReply>(new{op="crane_put",route,n=count});
}
