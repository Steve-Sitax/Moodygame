using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownLife
{
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync;
    public Func<int>? DailyCallLimit;
    private int generation;
    private readonly ConcurrentDictionary<int,Task> writingCalls=new();
    public Task NarrationSettled()=>Task.WhenAll(writingCalls.Values.ToArray());
    public static bool CleanHiringLine(string text,int maximum=200,bool names=false)
    {
        if(text.Length==0||text.Length>maximum)return false;string checkedText=names?text.Replace("{names}","",StringComparison.Ordinal):text;return checkedText.IndexOfAny(new[]{'<','>','{','}','\u0060','\\'})<0;
    }
    private void QueueHiring(JsonObject ev,JsonObject hiring)
    {
        if(NarrateAsync==null||!NativeNorthNarration.MayCall(C,Day,"hiring_call",1,DailyCallLimit?.Invoke()??120,writingCalls.Values.Count(t=>!t.IsCompleted)))return;int id=(int)N(ev,"id"),started=generation;var request=NativeNorthNarration.Request("hiring_call",new(){["clock"]=host.Clock.View(),["hiring"]=hiring.DeepClone(),["residents"]=new JsonArray(A(hiring["spots"]).SelectMany(sp=>A(sp?["picked"]).Append(JsonValue.Create(S(sp,"foreman")))).Select(n=>actions.Resident(n?.GetValue<string>()??"")?.DeepClone()).Where(n=>n!=null).ToArray())},NativeNorthNarration.Hiring,"Word the two foremen's already-decided calls. Preserve spot IDs, ship names, picked men and each real player result. Use {names} for names if desired; the engine fills it. Add up to three short remarks. Do not choose more men, offer wages, change jobs or alter who was picked.");var task=WriteHiring(id,request,started);writingCalls[id]=task;_=task.ContinueWith(done=>{_ =done.Exception;((ICollection<KeyValuePair<int,Task>>)writingCalls).Remove(new(id,done));},TaskScheduler.Default);
    }
    private async Task WriteHiring(int id,JsonObject request,int started)
    {
        JsonObject? output=null;try{output=await NarrateAsync!(1,"hiring_call",request).ConfigureAwait(false);}catch{}if(output==null)return;await host.WithState(_=>{if(generation!=started)return false;var ev=events.Row(id);var hiring=ev==null?null:Hiring(ev);if(ev==null||hiring==null||!B(hiring,"called")||S(ev,"status")is "done"or"cancelled")return false;foreach(var proposed in A(output["calls"])){var spot=A(hiring["spots"]).FirstOrDefault(s=>S(s,"id")==S(proposed,"spot"));if(spot==null)continue;string line=S(proposed,"call").Trim();if(!CleanHiringLine(line,200,true))continue;line=line.Replace("{names}",string.Join(", ",A(spot["picked"]).Select(p=>S(actions.Resident(p!.GetValue<string>()),"name"))),StringComparison.Ordinal);spot["call"]=line;var remarks=A(proposed?["remarks"]).Where(p=>p is JsonValue v&&v.TryGetValue<string>(out var text)&&CleanHiringLine(text,120)).Take(3).Select(p=>p!.DeepClone()).ToArray();if(remarks.Length>0)spot["remarks"]=new JsonArray(remarks);spot["source"]="claude";}Save(ev,"hiring",hiring);host.Publish("events");return true;}).ConfigureAwait(false);
    }
}
