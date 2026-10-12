using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreRest
{
    private readonly Dictionary<int, JsonObject> woken = new();
    public Action<int, JsonArray, JsonObject?>? CellEnded;
    public bool IsAsleep(int player) => rests.ContainsKey(player);
    public bool AllAsleep() => host.OnlinePlayers().All(IsAsleep);
    public bool InCell(int player) => rests.TryGetValue(player,out var r)&&r.Kind=="cell";
    public bool Acked(int player) => rests.TryGetValue(player,out var r)&&r.Acked;
    public void Acknowledge(int player) { if(rests.TryGetValue(player,out var r)) r.Acked=true; }
    public JsonObject? TakeWoke(int player) { if(!woken.Remove(player,out var result))return null;return result.DeepClone().AsObject(); }
    public void Forget(int player) { rests.Remove(player); woken.Remove(player); seen.Remove(player); }
    public void Turned(Func<int, JsonArray> lines)
    {
        foreach(var r in rests.Values){r.Turned=true;foreach(var line in lines(r.Player))r.Lines.Add(line?.DeepClone());}
    }
    public void WeekOver()
    {
        foreach(var r in rests.Values.ToArray()) host.ForPlayer(r.Player,()=>{woken[r.Player]=End(r,"ended",C.PlayerState(r.Player,"ending")as JsonObject);});
    }
    public JsonObject CellRest(int player, int minutes, JsonObject at, JsonArray lines)
    {
        var c=host.Clock.View();if(rests.TryGetValue(player,out var had))host.ForPlayer(player,()=>End(had,"up"));
        var r=new Rest{Player=player,Kind="cell",Label="the cell at the police post",Planned=Math.Max(1,minutes),FromHour=N(c,"hour"),FromMinute=N(c,"minute"),Acked=false,RobRolled=true,At=at.DeepClone().AsObject()};
        foreach(var line in lines)r.Lines.Add(line?.DeepClone());rests[player]=r;woken.Remove(player);return View(r);
    }
    public JsonObject Collapse(int player)
    {
        var c=host.Clock.View();int until=360-(N(c,"hour")*60+N(c,"minute"));if(until<=0)until+=1440;
        var r=new Rest{Player=player,Kind="bench",Label="the cobbles",Planned=Math.Max(240,Math.Min(720,until)),FromHour=N(c,"hour"),FromMinute=N(c,"minute"),Acked=false};
        r.Lines.Add("You were dead on your feet: your legs gave way and you slept where you fell.");
        C.Atomic(()=>{foreach(var hook in host.StopTransportHooks)hook(player);C.Execute("UPDATE player SET warmth=MIN(warmth,1) WHERE id=$p0",player);});
        rests[player]=r;return View(r);
    }
    /// <summary>The world has already advanced. This modifies only one sleeper and never moves the clock.</summary>
    public bool AdvancePiece(int player, int minutes, bool hourEnded)
    {
        if(!rests.TryGetValue(player,out var r))return false;
        if(minutes<=0)return true;
        return host.ForPlayer(player,()=>{
            string? why=null;JsonObject? ending=null;
            C.Atomic(()=>{
                int piece=Math.Min(minutes,Math.Max(0,r.Planned-r.Slept));r.Slept+=piece;Needs(r,piece);
                if(hourEnded&&r.Kind!="cell"){
                    int h=N(host.Clock.View(),"hour");Hour(r,h);
                    if(r.Bench?["fine"]?.GetValue<bool>()==true&&(h>=22||h<5)&&C.Roll()<.3){r.Lines.Add("A policeman taps your boots with his stick. \"Not here, friend. The benches are for the day. Move along.\"");why="police";}
                }
                if(why==null&&N(host.Player(player),"health")==0){ending=C.PlayerState(player,"ending")as JsonObject??host.Clock.End(player,"health");why="ended";}
                if(why==null&&!r.RobRolled&&r.Slept*2>=r.Planned){
                    r.RobRolled=true;
                    foreach(var hook in host.SleepHooks){
                        var got=hook(player,r.Kind=="bench"?"rough":r.Kind=="home"?"home":"bed",false,N(host.Clock.View(),"hour"));if(got==null)continue;
                        foreach(var line in got["lines"]!.AsArray())r.Lines.Add(line?.DeepClone());
                        if(got["robbed"]is JsonObject robbed){r.Robbed=robbed.DeepClone().AsObject();why="robbed";}
                    }
                }
            });
            if(why==null&&r.Slept>=r.Planned)why="rested";
            if(why!=null)woken[player]=End(r,why,ending);
            return true;
        });
    }
}
