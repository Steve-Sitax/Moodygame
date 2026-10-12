using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeRoutines
{
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync;
    public Func<int>? DailyCallLimit;
    private int generation;
    private readonly ConcurrentDictionary<int,Task> pendingCheckins=new();
    public Task CheckinsSettled()=>Task.WhenAll(pendingCheckins.Values.ToArray());
    private bool QueueCheckin(JsonObject row,JsonObject routine,JsonObject step,string why)
    {
        if(NarrateAsync==null||N(routine["state"],"checkins")>=5||!NativeNorthNarration.MayCall(C,(int)N(host.Clock.View(),"day"),"routine_checkin",6,DailyCallLimit?.Invoke()??120,pendingCheckins.Values.Count(t=>!t.IsCompleted)))return false;int id=(int)N(row,"id");if(pendingCheckins.ContainsKey(id)||routine["state"]?["steering"]!=null)return true;routine["state"]!["steering"]=Minute;routine["state"]!["checkins"]=N(routine["state"],"checkins")+1;Save(id,routine);var request=NativeNorthNarration.Request("routine_checkin",new(){["clock"]=host.Clock.View(),["resident"]=actions.Resident(S(row,"npc_id"))?.DeepClone(),["routine"]=routine.DeepClone(),["trigger"]=new JsonObject{["kind"]="failed",["step"]=step.DeepClone(),["why"]=why}},NativeNorthNarration.CheckinSchema(),"The resident is carrying out a checked errand. Choose continue, change_next, skip, come_back or give_up. A changed next step must use real supplied people/places and legal owned goods. Do not invent money, theft, harm, entering others' homes or success. Every proposed change is checked by the engine.");int index=(int)N(routine,"i"),started=generation;var task=WriteCheckin(id,index,(int)N(routine,"player",1),why,request,started);pendingCheckins[id]=task;_=task.ContinueWith(done=>{_ =done.Exception;((ICollection<KeyValuePair<int,Task>>)pendingCheckins).Remove(new(id,done));},TaskScheduler.Default);return true;
    }
    private async Task WriteCheckin(int id,int index,int player,string why,JsonObject request,int started)
    {
        JsonObject? answer=null;try{answer=await NarrateAsync!(player,"routine_checkin",request).ConfigureAwait(false);}catch{}await host.WithState(_=>{if(started!=generation)return false;var row=actions.Row(id);var routine=Of(row);if(row==null||routine==null||S(row,"status")!="active"||N(routine,"i")!=index)return false;routine["state"]!["steering"]=null;var step=A(routine["steps"]).ElementAtOrDefault(index)as JsonObject;if(step==null)return false;Steer(row,routine,step,why,answer,true);return true;}).ConfigureAwait(false);
    }
}
