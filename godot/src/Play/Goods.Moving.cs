using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Scheldemist.Net;

namespace Scheldemist.Play;
public partial class Goods
{
    private readonly Dictionary<string,(int Version,int Count,int Need)> pileNeeds=new();
    internal void MovingReply(GoodsReply reply)
    {foreach(var item in reply.Items)Apply(item,true,"");if(reply.Gone!=null)foreach(string id in reply.Gone)Forget(id,"");v=reply.V;}
    public int PileNeed(string route)
    {
        if(pileNeeds.TryGetValue(route,out var previous)&&previous.Version==v&&previous.Count==all.Count)return previous.Need;
        string prefix="haul:"+route+"a:";int have=0;foreach(var item in Lying)if(item.Id.StartsWith(prefix,StringComparison.Ordinal))have++;
        int need=Math.Max(0,5-have);pileNeeds[route]=(v,all.Count,need);return need;
    }
    public async Task<bool> CranePut(string route,int count)
    {
        if(ServerLink.I?.Api is not {} api)return false;
        try{var reply=await api.CranePut(route,count);foreach(var item in reply.Items)Apply(item,true,"");if(reply.Gone!=null)foreach(string id in reply.Gone)Forget(id,"");v=reply.V;return reply.Ok;}
        catch(ApiException){return false;}
    }
}
