using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreJobs
{
    private Func<int,string,JsonObject,Task<JsonObject?>>? narration;
    private bool startupNeeded=true;
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync {get=>narration;set=>ConfigureNarration(value);}
    /// <summary>Fresh-world factories configure first, rebuild the people, then Reset starts exactly one board.</summary>
    public void ConfigureNarration(Func<int,string,JsonObject,Task<JsonObject?>>? provider,bool startStartup=true)
    {
        narration=provider;
        if(startStartup&&provider!=null&&startupNeeded){startupNeeded=false;if(RawList(1).Count==0)StartBoard();}
    }
    private JsonObject boardState=new(){["state"]="ready"};
    private Task? boardWriting;
    private bool boardAgain;
    private int generation;
    private readonly List<Task> outcomes=new();
    public JsonObject BoardState(){var state=boardState.DeepClone().AsObject();state["slots"]=Slots();return state;}
    public void EnsureStartup(){if(!startupNeeded)return;startupNeeded=false;if(RawList(1).Count==0)MakeBoard();}
    public static (int Min,int Max,int SchemaMin) BoardSize(double players){int n=(int)Math.Clamp(Math.Floor(double.IsFinite(players)?players:1),1,6);return(4+2*(n-1),7+2*(n-1),3);}
    public int Tier(int who=1){int best=C.Scalar<int>("SELECT MAX(trust) FROM faction_trust WHERE player_id=$p0",who),tier=0;int[] thresholds={0,3,5,7,9};for(int i=0;i<thresholds.Length;i++)if(best>=thresholds[i])tier=i;return tier;}
    public bool CartWorkOpen(int who=1)=>C.Scalar<long>("SELECT COUNT(*) FROM job WHERE status='done' AND COALESCE(taken_by,1)=$p0",who)>=3||(C.PlayerState(who,"jef_carts")?["list"] as JsonArray)?.Any(c=>S(c!.AsObject(),"kind") is "new" or "used")==true;
    public JsonArray FallbackBoard(int players,bool carts)
    {
        var all=C.Rules["fallbackJobs"]!.AsArray();var jobs=all.Take(carts?7:6).Select(RawProposal).ToList();int more=BoardSize(players).Min-4;if(more>0)jobs.AddRange(all.Skip(7).Take(more).Select(RawProposal));return new JsonArray(jobs.Take(BoardSize(players).Max).Cast<JsonNode?>().ToArray());
    }
    private static JsonObject RawProposal(JsonNode? node){var j=node!.DeepClone().AsObject();j.Remove("task");return j;}
    public JsonArray GateCarts(JsonArray jobs,bool open)
    {
        int n=0;var result=new JsonArray();foreach(var item in jobs){var j=item!.DeepClone().AsObject();bool cart=open&&S(j,"task_type")=="carry"&&j["cart"]?.GetValue<bool>()==true&&n<1;if(cart)n++;j["cart"]=cart;result.Add(j);}return result;
    }
    public JsonArray ClampBoard(JsonArray jobs,int tier)
    {
        var band=Plan.Data["tierPay"]![Math.Clamp(tier,0,4)]!;int low=(int)Number(band[0]),high=(int)Number(band[1]);var result=new JsonArray();foreach(var node in jobs){var j=node!.DeepClone().AsObject();j["title"]=NativeCoreInteriors.PlainEnglish(S(j,"title"));j["pitch"]=NativeCoreInteriors.PlainEnglish(S(j,"pitch"));j["recipient"]=S(j,"recipient").Trim();j["pay_c"]=Math.Clamp(Round5(Number(j["pay_c"])),low,high);result.Add(Plan.FitCarry(j,(low,high)));}return result;
    }
    public JsonArray EnsurePlayable(JsonArray jobs)
    {
        if(jobs.Any(j=>Playable.Contains(S(j!.AsObject(),"task_type"))))return jobs;return new JsonArray(new JsonNode?[]{RawProposal(C.Rules["fallbackJobs"]![0])}.Concat(jobs.Take(4).Select(j=>j!.DeepClone())).ToArray());
    }
    private static double Number(JsonNode? n){if(n is not JsonValue v)return 0;if(v.TryGetValue<double>(out var d))return d;if(v.TryGetValue<int>(out var i))return i;if(v.TryGetValue<long>(out var l))return l;return 0;}
    private JsonObject BoardSchema(int players)
    {
        var job=JsonNode.Parse("""{"type":"object","properties":{"title":{"type":"string","minLength":3,"maxLength":70},"employer":{"type":"string"},"task_type":{"type":"string","enum":["carry","watch","deliver","row","find","talk"]},"goods":{"type":"string"},"from":{"type":"string"},"to":{"type":"string"},"twist":{"type":"string"},"urgent":{"type":"boolean"},"recipient":{"type":"string","maxLength":60},"pay_c":{"type":"integer"},"risk":{"type":"string","enum":["low","medium","high"]},"pitch":{"type":"string","minLength":10,"maxLength":360},"items":{"type":"integer"},"cart":{"type":"boolean"}},"required":["title","employer","task_type","goods","from","to","twist","urgent","recipient","pay_c","risk","pitch"]}""")!.AsObject();var props=job["properties"]!.AsObject();props["employer"]!["enum"]=new JsonArray(C.Rules["employers"]!.AsObject().Select(e=>(JsonNode)JsonValue.Create(e.Key)!).ToArray());foreach(string key in new[]{"from","to"})props[key]!["enum"]=new JsonArray(Plan.Data["spots"]!.AsObject().Where(p=>!p.Key.StartsWith("_")).Select(p=>(JsonNode)JsonValue.Create(p.Key)!).ToArray());props["goods"]!["enum"]=Plan.Data["goods"]!.DeepClone();props["twist"]!["enum"]=Plan.Data["twists"]!.DeepClone();return new JsonObject{["type"]="object",["properties"]=new JsonObject{["jobs"]=new JsonObject{["type"]="array",["minItems"]=3,["maxItems"]=BoardSize(players).Max,["items"]=job}},["required"]=new JsonArray("jobs")};
    }
    private JsonObject BoardRequest(int tier,int players)
    {
        var band=Plan.Data["tierPay"]![tier]!;return new JsonObject{["schema"]=BoardSchema(players),["system"]="Write short job-board lines for Antwerp in1873, plain English. Dutch only in names. The engine owns all numbers, money, pay, trust, goods counts and schedules. Use the supplied employer/spot lists and stay on each employer's own ground.",["prompt"]=new JsonObject{["clock"]=host.Clock.View(),["player"]=host.Player(1),["trust"]=C.Rows("SELECT faction,trust FROM faction_trust WHERE player_id=1 ORDER BY faction"),["employers"]=C.Rules["employers"]!.DeepClone(),["places"]=Plan.Data["spots"]!.DeepClone(),["pay_band"]=band.DeepClone(),["jobs_min"]=BoardSize(players).Min,["jobs_max"]=BoardSize(players).Max,["cart_work_open"]=CartWorkOpen(),["recent_log"]=C.Rows("SELECT text FROM log ORDER BY id DESC LIMIT 8"),["instructions"]="Carry by hand one or two things, a short way; a cart carries three to eight only if cart work is open, one cart job at most. Watch a pile; deliver one item to a named recipient. Include different employers. Pitch one to three short sentences, naming goods and places in words. Urgent jobs have time limits. Use row/find/talk at most once: these kinds cannot be played yet."}.ToJsonString()};
    }
    public async Task<JsonObject> WriteBoardAsync()
    {
        var watch=System.Diagnostics.Stopwatch.StartNew();var prepare=await host.WithState(_=>{int tier=Tier(),players=host.OnlinePlayers().Count();return(Tier:tier,Players:players,Request:BoardRequest(tier,players),Generation:generation);}).ConfigureAwait(false);JsonObject? output=null;string? error=null;var provider=NarrateAsync;if(provider!=null)try{output=await provider(1,"job_board",prepare.Request).ConfigureAwait(false);if(output==null)error="no narration";}catch{error="narration unavailable";}
        return await host.WithState(_=>{if(generation!=prepare.Generation)return new JsonObject{["source"]="fallback",["error"]="the week changed while the board was written",["ms"]=watch.ElapsedMilliseconds};bool carts=CartWorkOpen();var jobs=output?["jobs"] is JsonArray authored?authored.DeepClone().AsArray():FallbackBoard(prepare.Players,carts);string source=output==null?"fallback":"claude";jobs=EnsurePlayable(ClampBoard(GateCarts(jobs,carts),prepare.Tier));InsertBoard(jobs,prepare.Tier,source);return new JsonObject{["source"]=source,["error"]=error,["ms"]=watch.ElapsedMilliseconds};}).ConfigureAwait(false);
    }
    public void InsertBoard(JsonArray jobs,int tier,string source)
    {
        int day=N(host.Clock.View(),"day");C.Atomic(()=>{C.Execute("UPDATE job SET status='expired' WHERE status='offered' AND source<>'night'");foreach(var n in jobs){var j=n!.AsObject();string npc=S(j,"employer");var employer=C.Rules["employers"]?[npc]??throw new NativeServiceException("unknown board employer",400);var task=Playable.Contains(S(j,"task_type"))?Plan.TaskFor(j):null;string district=employer["town"]?.GetValue<bool>()==true?C.Scalar<string>("SELECT district FROM npc WHERE id=$p0",npc)??"town":"rijnkaai";C.Execute("INSERT INTO job(day,title,employer_npc,district,task_type,pay_c,risk,tier,required_faction,pitch,task_json,source,status) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,$p8,$p9,$p10,$p11,'offered')",day,S(j,"title"),npc,district,S(j,"task_type"),N(j,"pay_c"),S(j,"risk"),tier,employer["faction"]!.GetValue<string>(),S(j,"pitch"),task?.ToJsonString()??"{}",source);}C.Log(1,"job_board",source,$"A new job board went up on the Rijnkaai with {jobs.Count} jobs.","world");});foreach(var hook in BoardExtras)try{hook();}catch{/* Optional board extras cannot invalidate already-written work. */}
    }
    public void StartBoard()
    {
        if(boardWriting is {IsCompleted:false}){boardAgain=true;return;}boardState=new JsonObject{["state"]="writing"};host.PublishState();boardWriting=RunBoard();_=boardWriting.ContinueWith(t=>{_ = t.Exception;},TaskScheduler.Default);
    }
    private async Task RunBoard()
    {
        JsonObject result;try{result=await WriteBoardAsync().ConfigureAwait(false);}catch(Exception e){result=new JsonObject{["source"]="error",["error"]=e.Message};}
        await host.WithState(_=>{boardState=new JsonObject{["state"]="ready",["source"]=result["source"]?.DeepClone(),["error"]=result["error"]?.DeepClone()};host.PublishState();if(boardAgain){boardAgain=false;boardWriting=null;StartBoard();}return true;}).ConfigureAwait(false);
    }
    public async Task BoardSettled(){Task? previous;do{previous=boardWriting;if(previous!=null)await previous.ConfigureAwait(false);}while(boardWriting!=previous);}
    private static readonly JsonObject outcomeSchema=JsonNode.Parse("""{"type":"object","properties":{"narration":{"type":"string","minLength":10,"maxLength":320},"memory":{"type":"string","minLength":5,"maxLength":180},"weight":{"type":"integer","minimum":1,"maximum":10}},"required":["narration","memory","weight"]}""")!.AsObject();
    public static JsonObject FallbackOutcome(JsonObject job,JsonObject settlement)
    {
        string who=S(job,"employer_name");bool caught=settlement["caught"]?.GetValue<bool>()==true;int pay=N(settlement,"pay_c");return new JsonObject{["narration"]=caught?$"{who} looks at you a long time. \"Not a centime. Get off my kaai.\"":pay==0?$"{who} shakes their head. \"Nothing done, nothing paid.\"":$"{who} counts it over and pays {pay} centimes. \"Good. Come back tomorrow.\"",["memory"]=settlement["facts"]?.AsArray().FirstOrDefault()?.GetValue<string>()??"Jef did a job.",["weight"]=caught?7:4};
    }
    public string WorkLine(JsonObject job)
    {
        if(job["task"] is not JsonObject t)return "";string place(string id)=>Plan.Data["spots"]?[id]?["label"]?.GetValue<string>()??id;string work=S(t,"kind") switch{"carry"=>$"{N(t,"count")} {S(t,"goods")} from {place(S(t,"from"))} to {place(S(t,"to"))}"+(t["cart"]?.GetValue<bool>()==true?", on the employer's handcart":""),"deliver"=>$"{(S(t,"goods")=="parcel"?"a parcel":"one of the "+S(t,"goods"))} from {place(S(t,"from"))} to {S(t,"recipient")} at {place(S(t,"to"))}","watch"=>$"a watch over the {S(t,"goods")} at {place(S(t,"post"))}","mill"=>$"an hour's help at {t["post"]?["label"]?.GetValue<string>()}, turning the cap into the wind when the miller called","lamps"=>$"the last {t["lamps"]!.AsArray().Count} street lamps of the lamplighter's round, lit at dusk with his spare pole",_=>t["stops"]!.AsArray().Any(s=>s?["what"]?.GetValue<string>()=="telegraph")?"a telegram to send":$"{t["stops"]!.AsArray().Count} letters to doors"};return "The work, as it really was (these goods and places, whatever the pitch says): "+work+".";
    }
    private void StartOutcome(int who,JsonObject job,JsonObject settlement)
    {
        if(NarrateAsync==null){Narrate(who,job,settlement);return;}int started=generation;var request=new JsonObject{["schema"]=outcomeSchema.DeepClone(),["system"]="Write how a job ends on the Antwerp quays in1873. Plain English, Dutch only in names. The engine already paid and moved trust. Never change facts or sums. If the employer does not know about a misdeed, do not mention it.",["prompt"]=new JsonObject{["employer"]=C.Rules["employers"]?[S(job,"employer_npc")]?.DeepClone(),["job"]=job.DeepClone(),["actual_work"]=WorkLine(job),["settlement"]=settlement.DeepClone(),["instructions"]="Narration: one or two short sentences in the employer's voice. Memory: one sentence in the employer's own point of view. Weight1to10, plain work3to4, theft/rescue7to9."}.ToJsonString()};var task=WriteOutcome(who,job.DeepClone().AsObject(),settlement.DeepClone().AsObject(),request,started);outcomes.Add(task);_=task.ContinueWith(t=>{_ = t.Exception;},TaskScheduler.Default);
    }
    private async Task WriteOutcome(int who,JsonObject job,JsonObject settlement,JsonObject request,int started)
    {
        JsonObject? output=null;try{output=await NarrateAsync!(who,"job_outcome",request).ConfigureAwait(false);}catch{/* Original handwritten outcome remains available. */}
        if(output!=null&&(S(output,"narration").Length is <10 or >320||S(output,"memory").Length is <5 or >180||Number(output["weight"]) is <1 or >10||Number(output["weight"])%1!=0))output=null;
        await host.WithState(_=>{if(generation==started&&C.Scalar<int>("SELECT COUNT(*) FROM job WHERE id=$p0 AND status IN('done','failed')",N(job,"id"))>0)Narrate(who,job,settlement,output);return true;}).ConfigureAwait(false);
    }
    public Task OutcomesSettled()=>Task.WhenAll(outcomes.ToArray());
    public JsonObject DevJob(JsonObject spec)
    {
        string type=S(spec,"type") is "watch" or "deliver"?S(spec,"type"):"carry";var all=C.Rules["fallbackJobs"]!.AsArray();var j=(type=="carry"&&spec["cart"]?.GetValue<bool>()==true?all[6]:all.First(b=>b?["task_type"]?.GetValue<string>()==type))!.DeepClone().AsObject();foreach(var field in new[]{("twist",Plan.Data["twists"]!), ("goods",Plan.Data["goods"]!)})if(field.Item2.AsArray().Any(v=>v!.GetValue<string>()==S(spec,field.Item1)))j[field.Item1]=S(spec,field.Item1);string employer=S(spec,"employer");if(C.Rules["employers"]?[employer]!=null)j["employer"]=employer;foreach(string key in new[]{"from","to"})if(!S(spec,key).StartsWith("_")&&Plan.Data["spots"]?[S(spec,key)]!=null)j[key]=S(spec,key);if(spec["urgent"] is JsonValue urgent&&urgent.TryGetValue<bool>(out bool u))j["urgent"]=u;j["title"]="Test: "+type+(spec["cart"]?.GetValue<bool>()==true?" by cart":"")+(S(spec,"twist").Length>0&&S(spec,"twist")!="none"?", "+S(spec,"twist"):"");if(spec["items"]!=null)j["items"]=spec["items"]!.DeepClone();if(spec["pay"]!=null)j["pay_c"]=spec["pay"]!.DeepClone();if(type=="carry")j=Plan.FitCarry(j,(50,150));var task=Plan.TaskFor(j);var e=C.Rules["employers"]![S(j,"employer")]!;C.Execute("INSERT INTO job(day,title,employer_npc,district,task_type,pay_c,risk,tier,required_faction,pitch,task_json,source,status) VALUES($p0,$p1,$p2,'rijnkaai',$p3,$p4,$p5,1,$p6,$p7,$p8,'dev','offered')",N(host.Clock.View(),"day"),S(j,"title"),S(j,"employer"),S(j,"task_type"),N(j,"pay_c"),S(j,"risk"),e["faction"]!.GetValue<string>(),S(j,"pitch"),task?.ToJsonString()??"{}");return new JsonObject{["id"]=C.Scalar<int>("SELECT last_insert_rowid()"),["title"]=j["title"]!.DeepClone(),["task"]=task};
    }
    private void RegisterBoard(NativeServiceHost service)
    {
        service.Register("POST","/api/dev/new-board",r=>{StartBoard();return new{ok=true};});service.Register("POST","/api/dev/job",r=>{var result=DevJob(r.Body);host.PublishState(r.PlayerId);return result;});
        service.NewGame+=()=>{generation++;outcomes.Clear();};service.Loaded+=()=>{generation++;outcomes.Clear();};
    }
}
