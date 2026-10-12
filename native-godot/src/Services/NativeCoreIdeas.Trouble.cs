using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreIdeas
{
    private JsonObject? TroubleOf(int job)=>C.One("SELECT * FROM job_trouble WHERE job_id=$p0",job);
    private JsonObject? OwnTrouble(int who,int id)=>C.One("SELECT t.* FROM job_trouble t JOIN job j ON j.id=t.job_id WHERE t.id=$p0 AND COALESCE(j.taken_by,1)=$p1",id,who);
    private static readonly JsonObject troubleSchema=Parse("""{"type":"object","properties":{"scene":{"type":"string","minLength":20,"maxLength":420},"lines":{"type":"array","minItems":1,"maxItems":4,"items":{"type":"object","properties":{"who":{"type":"integer"},"text":{"type":"string","minLength":2,"maxLength":180}},"required":["who","text"]}},"options":{"type":"array","minItems":2,"maxItems":3,"items":{"type":"object","properties":{"n":{"type":"integer"},"label":{"type":"string","minLength":3,"maxLength":80},"after":{"type":"string","minLength":5,"maxLength":220},"after_bad":{"type":"string","maxLength":220}},"required":["n","label","after","after_bad"]}}},"required":["scene","lines","options"]}""");
    private string TroublePrompt(JsonObject j,JsonObject plan)
    {
        var t=j["task"];string who=S(j,"employer_name"),what=S(t,"kind")switch{"carry"=>$"carrying {N(t,"count")} {S(t,"goods")} for {who}","deliver"=>$"delivering a {S(t,"goods")} for {who}","watch"=>$"watching {S(t,"goods")} for {who}",_=>"a job for "+who};string reason=S(plan,"kind")switch{"stowaway"=>"A crate from the ship has a stowaway in it: a thin boy of about twelve, frightened, who begs Jef not to give him up.","broken_crate"=>"A crate splits in Jef's hands; the goods show through the boards.","customs"=>"A customs officer stops the load and wants to see the papers; he suspects something.","rival"=>"A docker from another natie wants the load, and the pay, for himself.",_=>"The weather turns bad over the river while the goods are out."};
        return $"THE JOB: Jef is {what}.\nWHAT WENT WRONG (engine): {reason}\n\nPEOPLE (by number)\n"+string.Join("\n",A(plan["cast"]).Select((c,i)=>$"{i}. {S(c,"name")}: {S(c,"role")}"))+"\n\nOPTIONS (engine; number, what Jef does, what follows; \"if unlucky\" only where there is a risk)\n"+string.Join("\n",A(plan["options"]).Select((o,i)=>$"{i+1}. {S(o,"label")}. Then: {S(o,"after")}"+(S(o,"after_bad")!=""?" If unlucky: "+S(o,"after_bad"):"")))+"\n\nWRITE\n- scene: 2 or 3 short sentences, what Jef sees.\n- lines: 1 to 3 lines spoken by the people above (\"who\" = their number), in character.\n- options: for each option by number (\"n\"): label (a few words, as Jef would think it, keeping any sum), after (one sentence), after_bad (one sentence, or \"\" where there is no risk).";
    }
    private JsonObject? PrepareTrouble(int jobId,string? force,Func<double>? random,JsonObject? castAs,int? afterSeconds)
    {
        var job=host.Jobs.Get(jobId);if(S(job,"status")!="taken"||TroubleOf(jobId)!=null)return null;var rng=random??Random(unchecked((uint)((N(Town,"seed")==0?1873:N(Town,"seed"))*41+jobId*7717)));int who=(int)N(job,"taken_by",1);if(force==null&&(C.Scalar<int>("SELECT COUNT(*) FROM job_trouble t JOIN job jb ON jb.id=t.job_id WHERE t.day=$p0 AND COALESCE(jb.taken_by,1)=$p1",Day,who)>=2||rng()>.3))return null;var plan=PlanTrouble(job,rng,force,castAs);if(plan==null)return null;if(afterSeconds!=null)plan["after_s"]=Math.Clamp(afterSeconds.Value,0,60);var fallback=EngineTrouble(plan);
            C.Execute("INSERT INTO job_trouble(job_id,day,kind,after_s,cast_json,options_json,words_json,source,status)VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,'engine','ready')",jobId,Day,S(plan,"kind"),N(plan,"after_s"),A(plan["cast"]).ToJsonString(),A(plan["options"]).ToJsonString(),fallback.ToJsonString());
            return new JsonObject{["id"]=C.Scalar<int>("SELECT last_insert_rowid()"),["generation"]=generation,["who"]=who,["job"]=job,["plan"]=plan,["fallback"]=fallback,["request"]=CanCallIdeas()?new JsonObject{["system"]=S(data,"troubleSystem"),["prompt"]=TroublePrompt(job,plan),["schema"]=troubleSchema.DeepClone()}:null};
    }
    public async Task<JsonObject?> MaybeTrouble(int jobId,string? force=null,Func<double>? random=null,JsonObject? castAs=null,int? afterSeconds=null)
    {
        var prepare=await host.WithState(_=>PrepareTrouble(jobId,force,random,castAs,afterSeconds));return prepare==null?null:await WriteTrouble(prepare).ConfigureAwait(false);
    }
    // Called by Walkup's synchronous route while Host owns the state lock. Words follow without blocking the scene.
    public int? CustomsTrouble(int who,int jobId,JsonObject person)
    {
        var existing=TroubleOf(jobId);if(existing!=null)return(int)N(existing,"id");var job=host.Jobs.Get(jobId);if(!host.Jobs.InHand(job,who))return null;var prepare=PrepareTrouble(jobId,"customs",null,person,0);if(prepare==null)return null;Observe(WriteTrouble(prepare));return(int)N(prepare,"id");
    }
    private async Task<JsonObject?> WriteTrouble(JsonObject prepare)
    {
        int jobId=(int)N(prepare["job"],"id");
        JsonObject? output=null;if(prepare["request"]is JsonObject request&&NarrateAsync!=null)try{output=await NarrateAsync((int)N(prepare,"who"),"trouble",request).ConfigureAwait(false);}catch{/* Engine scene stands immediately. */}
        return await host.WithState(_=>{if(generation!=N(prepare,"generation"))return null;if(output!=null){var words=CleanTrouble(O(prepare["job"]),O(prepare["plan"]),output,O(prepare["fallback"]));C.Execute("UPDATE job_trouble SET words_json=$p0,source='claude' WHERE id=$p1 AND status='ready'",words.ToJsonString(),N(prepare,"id"));}return TroubleOf(jobId);});
    }
    public JsonObject ChooseTrouble(int who,int id,double choice,Func<double>? random=null)
    {
        var t=OwnTrouble(who,id)??throw new NativeServiceException("no such trouble",404);if(S(t,"status")!="ready")throw new NativeServiceException("that is settled already",409);var j=host.Jobs.Get((int)N(t,"job_id"));if(S(j,"status")!="taken")throw new NativeServiceException("the job is over",409);var options=A(JsonNode.Parse(S(t,"options_json","[]")));if(!double.IsFinite(choice)||choice!=Math.Floor(choice)||choice<1||choice>options.Count)throw new NativeServiceException("no such choice",400);int n=(int)choice;var o=options[n-1]!;var words=Parse(S(t,"words_json","{}"));bool bad=o["roll"]!=null&&(random??C.Roll)()<N(o["roll"],"p");int moneyOut=N(o,"now_out_c")!=0?Math.Min((int)N(o,"now_out_c"),Money(who)):0;
        string text=bad?S(words["options"]?[n-1],"after_bad",S(o,"after_bad",S(o,"after"))):S(words["options"]?[n-1],"after",S(o,"after"));if(text=="")text=bad?S(o,"after_bad",S(o,"after")):S(o,"after");string fact=S(o,"fact")+(bad&&o["roll"]!=null?" "+S(o["roll"],"what"):"");var cast=A(JsonNode.Parse(S(t,"cast_json","[]")));
        C.Atomic(()=>{C.Execute("UPDATE job_trouble SET status='chosen',choice=$p0,result_json=$p1 WHERE id=$p2",n,new JsonObject{["bad"]=bad,["text"]=text,["step"]=o["step"]?.DeepClone()}.ToJsonString(),id);int delta=(int)N(o,"now_in_c")-moneyOut;if(delta!=0)C.Execute("UPDATE player SET money_c=MAX(0,money_c+$p0)WHERE id=$p1",delta,who);C.Log(who,"job_trouble",N(t,"job_id").ToString(),fact);});if(bad&&B(o["roll"],"police"))PoliceNote(who,S(o["roll"],"what"));string other=S(cast.FirstOrDefault(),"id");if(other!="")Remember(who,other,"On the quay, "+Regex.Replace(S(o,"fact"),"^Jef","Jef, the new day labourer,"),4);
        Remember(who,S(j,"employer_npc"),bad&&o["roll"]!=null?S(o["roll"],"what"):S(o,"fact"),bad?5:3);Event("job_trouble",fact,bad?5:4,S(j,"employer_npc"),new JsonObject{["kind"]=S(t,"kind"),["choice"]=n,["bad"]=bad},kind:"job",target:other==""?null:other,player:who);
        return new(){["text"]=o["step"]==null?text:text+$" (Go to {S(o["step"],"label")}.)",["money_c"]=Money(who)};
    }
    public JsonObject TroubleStep(int who,int id,JsonObject at)
    {
        var t=OwnTrouble(who,id);if(t==null||S(t,"status")!="chosen")throw new NativeServiceException("nothing to do there",409);var result=Parse(S(t,"result_json","{}"));if(result["step"]is not JsonObject step||N(t,"step_done")!=0)throw new NativeServiceException("nothing to do there",409);if(!Within(at,step,4))throw new NativeServiceException("you are not there yet",409);
        C.Execute("UPDATE job_trouble SET step_done=1 WHERE id=$p0",id);C.Log(who,"job_trouble_step",N(t,"job_id").ToString(),$"Jef went to {S(step,"label")} about the trouble on his job.");return new(){["text"]=$"Done at {S(step,"label")}. Back to the work."};
    }
    public void SettleTrouble(int who,JsonObject job,JsonObject settlement)
    {
        var t=TroubleOf((int)N(job,"id"));if(t==null||S(t,"status")=="settled")return;if(S(t,"status")=="ready"){C.Execute("UPDATE job_trouble SET status='settled' WHERE id=$p0",N(t,"id"));return;}var o=A(JsonNode.Parse(S(t,"options_json","[]"))).ElementAtOrDefault((int)N(t,"choice",1)-1);if(o==null)return;
        var result=Parse(S(t,"result_json","{}"));int cap=TroubleCap(N(job,"pay_c"));double pay=N(o,"pay_c"),trust=N(o,"trust");if(o["step"]!=null)pay+=N(t,"step_done")!=0?N(o["step"],"done_c"):N(o["step"],"missed_c");if(B(result,"bad")&&o["roll"]!=null){pay+=N(o["roll"],"pay_c");trust+=N(o["roll"],"trust");}pay=Math.Clamp(pay,-cap,cap);trust=Math.Clamp(trust,-1,1);if(N(settlement,"pay_c")>0)settlement["pay_c"]=Math.Max(0,N(settlement,"pay_c")+pay);settlement["trust_delta"]=Math.Clamp(N(settlement,"trust_delta")+trust,-2,2);
        A(settlement["facts"]).Add(S(o,"fact")+(o["step"]!=null&&N(t,"step_done")==0?$" He never went to {S(o["step"],"label")}.":"")+(B(result,"bad")&&o["roll"]!=null?" "+S(o["roll"],"what"):""));result["pay_c"]=pay;result["trust"]=trust;C.Execute("UPDATE job_trouble SET status='settled',result_json=$p0 WHERE id=$p1",result.ToJsonString(),N(t,"id"));
    }
    public JsonObject CallTrouble(int who,int id,JsonObject at)
    {
        var t=OwnTrouble(who,id)??throw new NativeServiceException("no such trouble",404);string? role=S(t,"kind")switch{"stowaway"=>null,"customs"=>"customs","rival"=>"rival",_=>"hand"};if(role==null)return new(){["ok"]=false,["none"]=true};if(CallResponder==null)throw new NativeServiceException("native walk-up service is unavailable",503);
        var job=host.Jobs.Get((int)N(t,"job_id"));var cast=A(JsonNode.Parse(S(t,"cast_json","[]")));string first=S(cast.FirstOrDefault(),"id"),reference=$"job:{N(t,"job_id")}:trouble",why=role=="customs"&&(S(job,"employer_npc")=="tuur"||S(job,"source")=="night")?"contraband":"trouble";
        var follower=first==""?null:(Comings?.Invoke()??new()).FirstOrDefault(a=>S(a,"npc_id")==first&&S(Parse(S(a,"data_json","{}")),"ref").StartsWith($"job:{N(t,"job_id")}:"));if(follower!=null)return new(){["ok"]=true,["npc"]=S(follower,"npc_id"),["name"]=S(cast.FirstOrDefault(),"name"),["action"]=follower["id"]!.DeepClone(),["urgent"]=false,["d"]=0,["again"]=true};var response=CallResponder(who,role,why,reference,at);
        if(B(response,"ok")&&S(response,"npc")!=first){string old=S(cast.FirstOrDefault(),"name"),name=S(response,"name"),words=S(t,"words_json","{}");bool named=first!="";var oldCast=cast.FirstOrDefault();if(cast.Count==0)cast.Add(new JsonObject());cast[0]=new JsonObject{["id"]=S(response,"npc"),["name"]=named?name:S(oldCast,"name",name),["role"]=S(oldCast,"role",role)};
            if(named&&old!=""&&old!=name){words=words.Replace(old,name);string shortName=old.Split(' ')[0];if(shortName.Length>2)words=Regex.Replace(words,@"\b"+Regex.Escape(Regex.Replace(shortName,@"[^\p{L}'-]",""))+@"\b",name.Split(' ')[0]);}C.Execute("UPDATE job_trouble SET cast_json=$p0,words_json=$p1 WHERE id=$p2",cast.ToJsonString(),words,id);}return response;
    }
    private static void Observe(Task task)=>_=task.ContinueWith(t=>{_=t.Exception;},TaskScheduler.Default);
    private async Task TroubleTaken(int id){var trouble=await MaybeTrouble(id).ConfigureAwait(false);if(trouble!=null)await host.WithState(_=>{host.PublishFor((int)N(host.Jobs.Get(id),"taken_by",1),"trouble",new JsonObject{["job_id"]=id});return true;});}
    private void RegisterTrouble(NativeServiceHost service)
    {
        service.TakeJobHooks.Add((job,who)=>Observe(TroubleTaken((int)N(job,"id"))));service.Jobs.SettlementExtras.Add(SettleTrouble);
        service.Register("POST","/api/trouble/:id/choose",r=>{var result=ChooseTrouble(r.PlayerId,int.Parse(r.Param("id")),N(r.Body,"n",double.NaN));PushJobs();result["trouble"]=TroubleForPlayer(r.PlayerId);return Reply(r.PlayerId,result);});service.Register("POST","/api/trouble/:id/step",r=>{var result=TroubleStep(r.PlayerId,int.Parse(r.Param("id")),At(r));result["trouble"]=TroubleForPlayer(r.PlayerId);return result;});
    }
}
