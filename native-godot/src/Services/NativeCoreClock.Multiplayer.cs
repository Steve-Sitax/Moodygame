using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreClock
{
    private readonly Dictionary<int,JsonArray> dayLines=new();
    private JsonArray commonDayLines=new();
    private JsonArray LinesFor(int player)
    {
        var lines=commonDayLines.DeepClone().AsArray();
        if(dayLines.TryGetValue(player,out var own))foreach(var line in own)lines.Add(line?.DeepClone());
        return lines;
    }
    public JsonObject Heartbeat(NativeServiceRequest request)
    {
        int id=request.PlayerId;bool asleep=request.Bool("asleep");
        if(asleep)host.Rest.Acknowledge(id);
        var woke=host.Rest.TakeWoke(id);
        if(woke==null&&!asleep&&host.Rest.Acked(id))woke=host.Rest.Wake(id);
        var rest=host.Rest.View(id);
        var result=Join(new JsonObject{["advanced"]=asleep&&rest==null&&woke==null,["together"]=true},host.Payload(id));
        if(rest!=null)result["rest"]=rest;
        if(woke!=null)result["woke"]=woke;
        result["where"]=Where(id);return result;
    }
    public JsonObject WorldTick(NativeServiceRequest request)
    {
        var result=new JsonObject{["advanced"]=false};bool fast=host.Rest.AllAsleep();
        var ids=host.OnlinePlayers().Distinct().Where(p=>C.Scalar<int>("SELECT COUNT(*) FROM player WHERE id=$p0",p)>0).ToArray();
        if(host.Saves.Paused||host.Saves.Busy||C.Now-lastTick<(fast?300:9000)||ids.All(id=>C.PlayerState(id,"ending")!=null))return result;
        lastTick=C.Now;int left=fast?30:5;result["advanced"]=true;
        while(left>0){
            var c=View();int toHour=60-Number(c,"minute"),piece=System.Math.Min(left,toHour);left-=piece;bool hourEnded=piece==toHour;
            if(hourEnded&&Number(c,"hour")>=23){
                var turn=TurnDay(request.PlayerId);result["turned"]=turn;
                host.Rest.Turned(LinesFor);
                if(turn["ended"]!=null){host.Rest.WeekOver();result["ended"]=turn["ended"]!.DeepClone();return result;}
            }else{int t=Number(c,"hour")*60+Number(c,"minute")+piece;SetTime(Number(c,"day"),t/60,t%60);}
            int hour=Number(View(),"hour");
            foreach(int id in ids)host.ForPlayer(id,()=>{
                if(C.PlayerState(id,"ending")!=null)return;
                if(host.Rest.AdvancePiece(id,piece,hourEnded)||!hourEnded)return;
                if(ApplyHour(id,hour)){var end=End(id,"health");if(id==request.PlayerId)result["ended"]=end;}
                else if(Number(host.Player(id),"sleep")<=0)host.Rest.Collapse(id);
            });
            if(hourEnded){host.RumourRound?.Invoke(hour);foreach(var hook in host.HourHooks)hook(hour);}
        }
        return result;
    }
}
