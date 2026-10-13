using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Stateful job ownership, load accounting, settlement and no-AI hand-written boards.</summary>
public sealed partial class NativeCoreJobs : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private static readonly HashSet<string> Playable = new() { "carry", "watch", "deliver", "letters", "mill", "lamps" };
    public readonly List<Action> BoardExtras = new();
    public readonly List<Action<int, JsonObject, JsonObject>> SettlementExtras = new();
    public NativeCoreJobPlan Plan {get;}
    public NativeCoreJobs(NativeServiceHost host) {this.host = host;Plan=new NativeCoreJobPlan(host);}
    public void MakeBoard()
    {
        startupNeeded=false;
        if(NarrateAsync!=null){StartBoard();return;}
        boardState=new JsonObject{["state"]="ready",["source"]="fallback"};
        int best = C.Scalar<int>("SELECT MAX(trust) FROM faction_trust WHERE player_id=1");
        int tier = 0; int[] thresholds = { 0, 3, 5, 7, 9 }; for (int i = 0; i < thresholds.Length; i++) if (best >= thresholds[i]) tier = i;
        bool carts = C.Scalar<long>("SELECT COUNT(*) FROM job WHERE status='done' AND COALESCE(taken_by,1)=1") >= 3 || (C.PlayerState(1,"jef_carts")?["list"] as JsonArray)?.Any(c=>c?["kind"]?.GetValue<string>() is "new" or "used") == true;
        var authored = C.Rules["fallbackBoards"]![$"{tier}:{carts.ToString().ToLowerInvariant()}"]!.AsArray();
        var clock = host.Clock.View(); int day = N(clock, "day");
        C.Atomic(() => {
            C.Execute("UPDATE job SET status='expired' WHERE status='offered' AND source<>'night'");
            foreach (var node in authored) {
                var proposal = node!.AsObject(); string npc = S(proposal, "employer"); var employer = C.Rules["employers"]![npc]!;
                string district = employer["town"]?.GetValue<bool>() == true ? C.Scalar<string>("SELECT district FROM npc WHERE id=$p0", npc) ?? "town" : "rijnkaai";
                C.Execute("INSERT INTO job(day,title,employer_npc,district,task_type,pay_c,risk,tier,required_faction,pitch,task_json,source,status) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,$p8,$p9,$p10,'fallback','offered')",
                    day, S(proposal,"title"), npc, district, S(proposal,"task_type"), N(proposal,"pay_c"), S(proposal,"risk"), tier, employer["faction"]!.GetValue<string>(), S(proposal,"pitch"), proposal["task"]?.ToJsonString() ?? "{}");
            }
            C.Log(1, "job_board", "fallback", $"A new job board went up on the Rijnkaai with {authored.Count} jobs.", "world");
            foreach (var hook in BoardExtras) hook();
        });
    }
    public JsonObject Row(JsonObject row)
    {
        string npc = S(row, "employer_npc");
        row["employer_name"] = C.Rules["employers"]?[npc]?["name"]?.DeepClone() ?? JsonValue.Create(C.Scalar<string>("SELECT name FROM npc WHERE id=$p0", npc) ?? npc);
        var task = JsonNode.Parse(S(row, "task_json", "{}")) as JsonObject; row.Remove("task_json");
        row["task"] = task?["kind"] != null ? task : null; row["playable"] = Playable.Contains(S(row,"task_type")) && task?["kind"] != null;
        return row;
    }
    private JsonArray RawList(int playerId) => new(C.Rows("SELECT * FROM job WHERE ((day=$p0 AND status IN('offered','taken','done','failed')) OR status='taken' OR (source='night' AND status='offered')) AND NOT(status='taken' AND COALESCE(taken_by,1)<>$p1) ORDER BY id", N(host.Clock.View(),"day"), playerId).Select(node => Row(node!.AsObject()).DeepClone()).ToArray());
    public JsonArray List(int playerId) {if(startupNeeded&&NarrateAsync==null)EnsureStartup();return RawList(playerId);}
    public JsonObject Get(int id)
    {
        var row = C.One("SELECT * FROM job WHERE id=$p0", id) ?? throw new NativeServiceException("no such job on today's board", 404);
        if (S(row, "status") == "expired") throw new NativeServiceException(S(row,"source") == "night" ? "too late for that one: it could not be done before five" : "that work is gone from the board", 409);
        return Row(row);
    }
    public bool InHand(JsonObject job, int playerId) => S(job,"status") == "taken" && (job["taken_by"] == null ? 1 : N(job,"taken_by")) == playerId;
    public JsonObject Take(int playerId, int id)
    {
        var job = Get(id);
        if (S(job,"status") != "offered") throw new NativeServiceException("that job is not open", 409);
        if (job["playable"]?.GetValue<bool>() != true) throw new NativeServiceException("that kind of work is not in the game yet", 409);
        if (C.Scalar<long>("SELECT COUNT(*) FROM job WHERE status='taken' AND COALESCE(taken_by,1)=$p0", playerId) >= 3) throw new NativeServiceException("You have your hands full already: finish or give up one of your jobs first",409);
        C.Atomic(() => { foreach (var check in host.TakeJobChecks) check(job,playerId); C.Execute("UPDATE job SET status='taken',taken_by=$p0 WHERE id=$p1",playerId,id);
            C.Log(playerId,"took_job",id.ToString(),$"Jef took a job from {S(job,"employer_name")}: {S(job,"title")}."); foreach (var hook in host.TakeJobHooks) hook(Get(id),playerId); });
        return Get(id);
    }
    public JsonObject Progress(int playerId,int id,JsonObject body)
    {
        var job=Get(id); var task=job["task"] as JsonObject;
        if (!InHand(job,playerId) || task==null || S(task,"kind") is "watch" or "mill" or "lamps") throw new NativeServiceException("no progress to save",409);
        int count=Count(task); var progress=new JsonObject { ["delivered"]=Math.Clamp(N(body,"delivered"),0,count),["lost"]=Math.Clamp(N(body,"lost"),0,count),["sold"]=Math.Clamp(N(body,"sold"),0,count) };
        if (N(progress,"delivered")+N(progress,"lost")+N(progress,"sold")>count) throw new NativeServiceException("more goods than the job has",400);
        task["progress"]=progress; SaveTask(id,task); return Get(id);
    }
    public static JsonObject Report(JsonObject body)
    {
        var result=new JsonObject();
        foreach(string key in new[]{"delivered","lost","sold","left_post_s","turns"}) {
            int max=key=="left_post_s"?3600:10;
            if (body[key]==null) { if(key!="turns") result[key]=0; continue; }
            if (body[key] is not JsonValue v || !v.TryGetValue<double>(out var n) || !double.IsFinite(n) || Math.Floor(n)!=n || n<0 || n>max) throw new NativeServiceException("bad report",400);
            result[key]=(int)n;
        }
        foreach(string key in new[]{"pocketed","late","bribe_taken","seen_away","box"}) {
            if(body[key]==null) { if(key!="box") result[key]=false; continue; }
            if(body[key] is not JsonValue v || !v.TryGetValue<bool>(out bool value)) throw new NativeServiceException("bad report",400); result[key]=value;
        }
        string thief="none";if(body["thief"]!=null){if(body["thief"] is not JsonValue tv||!tv.TryGetValue<string>(out var parsed)||parsed==null)throw new NativeServiceException("bad report",400);thief=parsed;}
        if(thief is not ("none" or "chased" or "stole")) throw new NativeServiceException("bad report",400); result["thief"]=thief;
        return result;
    }
    public JsonObject Settle(JsonObject job,JsonObject report)
    {
        var task=job["task"] as JsonObject ?? throw new NativeServiceException("job has no task",400);
        string kind=S(task,"kind"), who=S(job,"employer_name"); bool watched=S(task,"twist")=="foreman_watches";
        double pay=N(job,"pay_c"); int extra=0,trust=0; bool caught=false; string status="done"; var facts=new JsonArray();
        bool b(string key)=>report[key]?.GetValue<bool>()==true;
        JsonObject answer()=>new(){["pay_c"]=Round5(pay),["extra_c"]=extra,["trust_delta"]=trust,["caught"]=caught,["status"]=status,["facts"]=facts};
        if(kind is "letters" or "lamps") {
            var list=task[kind=="letters"?"stops":"lamps"]!.AsArray(); int count=list.Count,done=list.Count(x=>x?["done"]?.GetValue<bool>()==true);
            pay=count==0?0:pay*done/count; trust=done==count?1:kind=="lamps"&&done==0?-1:0; status=done==0?"failed":"done";
            if(kind=="letters") facts.Add(list.Any(x=>x?["what"]?.GetValue<string>()=="telegraph") ? done==count?$"Jef sent the telegram{(task["city"]==null?"":" to "+S(task,"city"))} for {who}.":$"The telegram for {who} was never sent.":$"Jef put {done} of {count} letters under the right doors for {who}.");
            else facts.Add(done==count?$"Jef lit the last {count} lamps of {who}'s round at dusk, every one in time.":done>0?$"Jef lit {done} of the {count} lamps {who} gave him; {who} lit the rest himself, late.":$"Jef took {who}'s lamps and lit none of them; {who} lit them himself, late.");
            return answer();
        }
        if(kind=="mill") {
            int asked=Math.Max(0,N(task,"turns")),done=Math.Min(asked,N(report,"turns")); bool away=N(report,"left_post_s")>20;
            pay*=asked==0?1:.5+.5*done/asked;
            if(away){pay*=.5;facts.Add($"Jef left the mill for {N(report,"left_post_s")} seconds.");}
            facts.Add(done==asked?$"Jef gave {who} an hour at the mill and put his shoulder to the capstan every time the wind backed.":done>0?$"Jef turned the cap for {who} {(done==1?"once":done+" times")} of the {asked} he was called.":$"{who} called for the cap to be turned and Jef never came.");
            trust=done==asked&&!away?1:done==0?-1:0;status=done==0&&away?"failed":"done";return answer();
        }
        if(kind=="watch") {
            bool away=N(report,"left_post_s")>15||b("seen_away"); string thief=S(report,"thief");
            if(away){pay*=.5;facts.Add(b("seen_away")?$"{who}'s man came by and found Jef away from his post.":$"Jef left his post for {N(report,"left_post_s")} seconds.");}
            if(thief=="stole"){pay*=.5;if(!(b("bribe_taken")&&S(task,"twist")!="thief"))facts.Add("A thief came out of the fog and got away with some of the goods.");}
            if(thief=="chased"){extra+=15;facts.Add("A thief came out of the fog. Jef ran him off.");}
            if(b("bribe_taken")){extra+=50;facts.Add("A man paid Jef to look away, and something went missing.");}
            caught=b("bribe_taken")&&(watched||C.Roll()<.35);if(caught){pay=0;facts.Add($"{who} found out about the bribe.");}
            trust=caught?-2:thief=="stole"||away?-1:1;if(facts.Count==0)facts.Add("Jef stood his watch in the fog until the bell. Nothing was lost.");return answer();
        }
        if(kind is not ("carry" or "deliver")) throw new NativeServiceException("Native job settlement is not implemented: "+kind,501);
        int total=Count(task),delivered=N(report,"delivered"),lost=N(report,"lost"),sold=N(report,"sold");
        if(delivered+lost+sold!=total)throw new NativeServiceException($"goods not all accounted for: {delivered+lost+sold} of {total}",409);
        string goods=S(task,"goods");var one=new Dictionary<string,string>{{"crates","crate"},{"sacks","sack"},{"barrels","barrel"},{"hides","bundle of hides"},{"rope","coil of rope"},{"parcel","parcel"},{"chests","chest"}};
        string noun=kind=="carry"?goods:"the "+one.GetValueOrDefault(goods,goods);pay*=delivered/(double)total;if(b("late"))pay*=.75;
        extra=sold*(kind=="carry"?35:60)+(b("pocketed")?15:0);
        facts.Add(kind=="carry"?$"Jef brought {delivered} of {total} {noun} for {who}.":delivered>0?$"Jef handed {noun} to {S(task,"recipient")}.":$"{char.ToUpperInvariant(noun[0])+noun[1..]} never reached {S(task,"recipient")}.");
        if(b("late"))facts.Add("He was late.");if(lost>0)facts.Add($"{lost} went into the Schelde.");if(sold>0)facts.Add($"He sold {sold} to a stranger in the fog.");if(b("pocketed"))facts.Add("He filled his pockets from a broken load.");if(S(task,"twist")=="heavy_load")facts.Add("One load was far too heavy for one man, and he carried it anyway.");
        bool misdeed=sold>0||b("pocketed");caught=misdeed&&(watched||C.Roll()<.35);if(caught){pay=0;facts.Add($"{who} found out.");}
        trust=caught?-2:lost>0?-1:delivered==total&&!b("late")&&!misdeed?1:0;status=delivered==0?"failed":"done";return answer();
    }
    public JsonObject Finish(int playerId,int id,JsonObject report,bool giveUp=false)
    {
        var job=Get(id);if(!InHand(job,playerId))throw new NativeServiceException("that job is not in hand",409);
        if(job["task"]?["held"] is JsonObject held){bool box=report["box"]?.GetValue<bool>()==true;report=held.DeepClone().AsObject();report["box"]=box;}
        var settlement=giveUp?new JsonObject{["pay_c"]=0,["extra_c"]=0,["trust_delta"]=-1,["caught"]=false,["status"]="failed",["facts"]=new JsonArray($"Jef took on \"{S(job,"title")}\" for {S(job,"employer_name")} and gave it up.")}:Settle(job,report);
        if(report["box"]?.GetValue<bool>()==true)settlement["facts"]!.AsArray().Add($"{S(job,"employer_name")} was abed; Jef dropped the proof in the box at the door and took his pay from it.");
        string npc=S(job,"employer_npc"),faction=C.Rules["employers"]?[npc]?["faction"]?.GetValue<string>()??C.Scalar<string>("SELECT faction FROM npc WHERE id=$p0",npc);
        C.Atomic(()=>{
            foreach(var extra in SettlementExtras)extra(playerId,job,settlement);
            C.Execute("UPDATE job SET status=$p0 WHERE id=$p1",S(settlement,"status"),id);
            C.Execute("UPDATE player SET money_c=MAX(0,money_c+$p0) WHERE id=$p1",N(settlement,"pay_c")+N(settlement,"extra_c"),playerId);
            if(!string.IsNullOrEmpty(faction))C.Execute("UPDATE faction_trust SET trust=MAX(-5,MIN(10,trust+$p0)) WHERE faction=$p1 AND player_id=$p2",N(settlement,"trust_delta"),faction,playerId);
            C.Log(playerId,S(settlement,"status")=="done"?"finished_job":"failed_job",id.ToString(),string.Join(" ",settlement["facts"]!.AsArray().Select(x=>x!.GetValue<string>())));
            C.Execute("DELETE FROM item WHERE job_id=$p0",id);foreach(var hook in host.EndJobHooks)hook(id);
            if(giveUp)host.Trade.Remember(playerId,npc,$"Jef took on my job \"{S(job,"title")}\" and gave it up.",4,$"Jef gave up a job for {S(job,"employer_name")}",-1);
            else if(report["box"]?.GetValue<bool>()==true)host.Trade.Remember(playerId,npc,$"Jef finished my job \"{S(job,"title")}\" at night while I was abed, left the proof in my box at the door and took his {N(settlement,"pay_c")} centimes from it.",4,$"Jef did a job for {S(job,"employer_name")} at night and was paid from the box",N(settlement,"trust_delta")>0?1:0);
        });
        if(!giveUp)StartOutcome(playerId,Get(id),settlement);
        return new JsonObject{["job"]=Get(id),["settlement"]=settlement,["money_c"]=N(host.Player(playerId),"money_c")};
    }
    private void Narrate(int playerId,JsonObject job,JsonObject settlement,JsonObject? written=null)
    {
        int id=N(job,"id");string who=S(job,"employer_name");bool caught=settlement["caught"]!.GetValue<bool>();int pay=N(settlement,"pay_c");
        string narration=written==null?caught?$"{who} looks at you a long time. \"Not a centime. Get off my kaai.\"":pay==0?$"{who} shakes their head. \"Nothing done, nothing paid.\"":$"{who} counts it over and pays {pay} centimes. \"Good. Come back tomorrow.\"":NativeCoreInteriors.PlainEnglish(S(written,"narration"));
        var facts=settlement["facts"]!.AsArray();string memory=written==null?facts.FirstOrDefault()?.GetValue<string>()??"Jef did a job.":S(written,"memory");int weight=written==null?caught?7:4:Math.Clamp(N(written,"weight"),3,8);
        string gist=caught?$"Jef was caught cheating {who}":S(settlement,"status")=="failed"?$"Jef let {who} down on a job":facts.Any(f=>f!.GetValue<string>().Contains("went into the Schelde"))?$"Jef dropped {who}'s goods in the Schelde":N(settlement,"trust_delta")>0?$"Jef did honest work for {who}":$"Jef did a job for {who}";
        int tone=caught?-2:S(settlement,"status")=="failed"||facts.Any(f=>f!.GetValue<string>().Contains("went into the Schelde"))?-1:N(settlement,"trust_delta")>0?1:0;
        C.Atomic(()=>{C.Execute("UPDATE job SET outcome_text=$p0 WHERE id=$p1",narration,id);C.Log(playerId,"job_outcome",id.ToString(),narration,S(job,"employer_npc"));host.Trade.Remember(playerId,S(job,"employer_npc"),memory,weight,gist,tone);});
        host.PublishFor(playerId,"outcome",new JsonObject{["job_id"]=id,["text"]=narration,["employer"]=who});
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("POST","/api/jobs/:id/take",r=>{var job=Take(r.PlayerId,Id(r));host.PublishState(r.PlayerId);return new JsonObject{["job"]=job};});
        service.Register("POST","/api/jobs/:id/progress",r=>new JsonObject{["job"]=Progress(r.PlayerId,Id(r),r.Body)});
        service.Register("POST","/api/jobs/:id/done",r=>{var result=Finish(r.PlayerId,Id(r),Report(r.Body));host.PublishState(r.PlayerId);return result;});
        service.Register("POST","/api/jobs/:id/giveup",r=>{var result=Finish(r.PlayerId,Id(r),new JsonObject(),true);host.PublishState(r.PlayerId);return result;});
        service.Register("POST","/api/jobs/:id/hold",r=>{var job=Get(Id(r));if(!InHand(job,r.PlayerId)||job["task"] is not JsonObject task)throw new NativeServiceException("that job is not in hand",409);if(S(job,"source")=="night")throw new NativeServiceException("night work is paid by the man who gave it",409);task["held"]=Report(r.Body);task["held"]!["box"]=false;task["held_min"]=host.Clock.GameMinute();SaveTask(Id(r),task);C.Log(r.PlayerId,"job_held",Id(r).ToString(),$"Jef finished the work of \"{S(job,"title")}\" after {S(job,"employer_name")} had gone home; the proof is for the box at the door.");foreach(var hook in host.EndJobHooks)hook(Id(r));var held=host.Payload(r.PlayerId);held["job"]=Get(Id(r));host.PublishState(r.PlayerId);return held;});
        service.Register("POST","/api/jobs/:id/handover",r=>{var job=Get(Id(r));if(!InHand(job,r.PlayerId)||job["task"] is not JsonObject task||S(task,"kind")!="deliver")throw new NativeServiceException("nothing to hand over",409);host.Trade.Parcel(r.PlayerId,Id(r));host.PublishState(r.PlayerId);return host.Payload(r.PlayerId);});
        RegisterBoard(service);
    }
    private void SaveTask(int id,JsonObject task)=>C.Execute("UPDATE job SET task_json=$p0 WHERE id=$p1",task.ToJsonString(),id);
    private static int Id(NativeServiceRequest r)=>int.TryParse(r.Param("id"),out int id)?id:0;
    private static int N(JsonObject obj,string key)=>NativeCoreClock.Number(obj,key);
    private static string S(JsonObject obj,string key,string fallback="")=>obj[key]?.GetValue<string>()??fallback;
    private static int Count(JsonObject task)=>S(task,"kind")=="carry"?N(task,"count"):S(task,"kind")=="letters"?task["stops"]!.AsArray().Count:1;
    private static int Round5(double value)=>(int)Math.Floor(value/5+.5)*5;
}

