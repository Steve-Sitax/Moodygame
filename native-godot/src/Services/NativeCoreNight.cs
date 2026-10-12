using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

/// <summary>The night's real jobs, deadline checks, dawn expiry, risks and per-player gang encounters.</summary>
public sealed partial class NativeCoreNight : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C=>host.Context;
    private NativeCoreJobPlan Plan=>host.Jobs.Plan;
    private int Day=>NativeCoreClock.Number(host.Clock.View(),"day");
    private double Hour=>NativeCoreClock.Number(host.Clock.View(),"hour")+NativeCoreClock.Number(host.Clock.View(),"minute")/60.0;
    private int Minute=>host.Clock.GameMinute();
    private int generation;
    private Task<JsonObject>? writing;
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync;
    public Func<int>? DailyCallLimit;
    public Action<NativeServiceRequest>? SyncPerception;
    public Func<int,JsonObject?>? PlayerPosition;
    public Func<double,double,double,JsonArray>? PeopleNear;
    public Func<int,string,JsonObject,int,JsonArray>? CallGang;
    public Action<string>? EndCallsFor;
    public Func<int,string,string>? Sexed;
    private static readonly string[] givers={"fence","smuggler","nightcarter","cracksman"};
    private static string S(JsonNode? n,string key,string fallback="")=>n?[key]?.GetValue<string>()??fallback;
    private static double N(JsonNode? n){if(n is not JsonValue v)return 0;if(v.TryGetValue<double>(out var d))return d;if(v.TryGetValue<int>(out int i))return i;if(v.TryGetValue<long>(out long l))return l;return 0;}
    private static int R5(double value)=>(int)Math.Floor(value/5+.5)*5;
    public NativeCoreNight(NativeServiceHost host)=>this.host=host;
    public string? Greeting(int who,JsonObject person)
    {
        string id=S(person,"id");string[]? lines=id switch{"fence"=>new[]{"Evening. Keep your voice down; sound carries on the water.","You're out late. Looking to earn, or looking to buy?"},"smuggler"=>new[]{"Not so loud. The water police sleep light.","Evening. You've a strong back, by the look of you."},"nightcarter"=>new[]{"Evening. Don't ask whose barrels. Ask what it pays.","You walk about late for a farm boy."},"cracksman"=>new[]{"Evening. You've good eyes? Good. Keep them open.","Walk on, unless you want work that pays better than the day's."},_=>null};if(lines==null)return null;int met=C.Scalar<int>("SELECT times_met FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1",id,who);string line=lines[met%lines.Length];return Hour>=3&&Hour<17?Regex.Replace(line,@"^Evening\.\s*",""):line;
    }
    public static string? AboutSelf(string id)=>id switch{"fence"=>"I buy and I sell. What, is my business. Who from, is nobody's.","smuggler"=>"I bring things ashore that the customs never hear of. The river is wide and the night is long.","nightcarter"=>"I move barrels at night for men who pay in coin and give no names. Suits me.","cracksman"=>"I see to doors. Some want seeing to at night. A man needs somebody watching the street.",_=>null};
    public static int NightOf(int day,double hour)=>hour<5?day-1:day;
    public static int NightEndsMinute(int day,double hour)=>NightOf(day,hour)*1440+300;
    public static bool InHours(double h){h=(h%24+24)%24;return h>=21||h<5;}
    public static (int Min,int Max) NightSize(double players){int n=(int)Math.Clamp(Math.Floor(double.IsFinite(players)?players:1),1,6);return(2+2*(n-1),4+2*(n-1));}
    public int Tier(){int trust=C.Scalar<int>("SELECT MAX(trust) FROM faction_trust WHERE player_id=1");int tier=0;int[] thresholds={0,3,5,7,9};for(int i=0;i<thresholds.Length;i++)if(trust>=thresholds[i])tier=i;return tier;}
    public (int Low,int High) Band(int tier){var b=Plan.Data["tierPay"]![Math.Clamp(tier,0,4)]!;return(Math.Max(120,R5(N(b[0])*1.5)),Math.Max(160,R5(N(b[1])*2)));}
    public JsonArray ClampNight(JsonObject board,int tier)
    {
        var band=Band(tier);var result=new JsonArray();foreach(var n in board["jobs"] as JsonArray??new()){var j=n!.DeepClone().AsObject();string title=NativeCoreInteriors.PlainEnglish(S(j,"title")).Trim(),pitch=NativeCoreInteriors.PlainEnglish(S(j,"pitch")).Trim();if(Regex.IsMatch(title+" "+pitch+" "+S(j,"recipient"),@"\b(kill(s|ed|er|ing)?|murder\w*|stab\w*|shoot\w*|shot dead|guns?|gunfire|pistols?|revolvers?|rifles?|muskets?|knife|knives|daggers?|swords?|blades?|cudgels?|clubbed|clubbing|bludgeon\w*|strangl\w*|throttl\w*|blood\w*|wound\w*|injur\w*|beat (him|her|them) up|beaten up|beaten to|riot\w*|hanged|corpse|weapons?|dead body|bodies)\b",RegexOptions.IgnoreCase))continue;j["title"]=title;j["pitch"]=pitch;j["recipient"]=S(j,"recipient").Trim();j["pay_c"]=Math.Clamp(R5(N(j["pay_c"])),band.Low,band.High);result.Add(j);}return result;
    }
    public int LeastMinutes(JsonObject task,string? door=null)
    {
        string kind=S(task,"kind");double distance(string? a,string? b)=>a==null||b==null?0:Plan.Distance(a,b);double seconds=kind=="carry"?distance(door,S(task,"from"))/3.4+N(task["count"])*(distance(S(task,"from"),S(task,"to"))/2+distance(S(task,"to"),S(task,"from"))/3.4)-distance(S(task,"to"),S(task,"from"))/3.4:kind=="deliver"?distance(S(task,"from"),S(task,"to"))/2:kind=="watch"?distance(door,S(task,"post"))/3.4+N(task["duration_s"]):0;return(int)Math.Ceiling(seconds*.5);
    }
    public bool InTime(JsonObject task,string giver)=>Minute+LeastMinutes(task,S(C.Rules["employers"]?[giver],"door"))<=N(task["until_min"]);
    public bool BoardDue()=>InHours(Hour)&&N(C.World("night_board")?["night"])!=NightOf(Day,Hour);
    public JsonArray Insert(JsonArray jobs,int tier,string source)
    {
        var ids=new JsonArray();int until=NightEndsMinute(Day,Hour);C.Atomic(()=>{foreach(var n in jobs){var j=n!.AsObject();string giver=S(j,"giver"),kind=S(j,"task_type");var employer=C.Rules["employers"]?[giver];if(employer?["night"]?.GetValue<bool>()!=true||kind is not("carry" or "watch" or "deliver"))continue;var line=j.DeepClone().AsObject();line["employer"]=giver;line["urgent"]=false;line["risk"]="high";line["cart"]=false;line["items"]??=2;line=Plan.FitCarry(line,Band(tier));var task=Plan.TaskFor(line);if(task==null)continue;task["until_min"]=until;C.Execute("INSERT INTO job(day,title,employer_npc,district,task_type,pay_c,risk,tier,required_faction,pitch,task_json,source,status) VALUES($p0,$p1,$p2,'night',$p3,$p4,'high',$p5,$p6,$p7,$p8,'night','offered')",Day,S(j,"title"),giver,kind,(int)N(line["pay_c"]),tier,S(employer,"faction"),S(j,"pitch"),task.ToJsonString());ids.Add(C.Scalar<int>("SELECT last_insert_rowid()"));}C.Execute("INSERT INTO log(day,hour,place,actor,verb,object,text) VALUES($p0,$p1,'night','world','night_board',$p2,$p3)",Day,(int)Hour,source,"After dark, "+ids.Count+" men had work for anyone who asked no questions.");});return ids;
    }
    public int Expire()
    {
        int expired=0;foreach(var r in C.Rows("SELECT id,status,title,employer_npc,task_json,taken_by FROM job WHERE source='night' AND status IN('offered','taken')")){var task=JsonNode.Parse(S(r,"task_json"))!.AsObject();bool late=S(r,"status")=="offered"&&task["kind"]!=null&&!InTime(task,S(r,"employer_npc"));if(Minute<N(task["until_min"])&&!late)continue;expired++;int id=(int)N(r!["id"]);if(S(r,"status")=="offered"){C.Execute("UPDATE job SET status='expired' WHERE id=$p0",id);continue;}int who=r["taken_by"]==null?1:(int)N(r["taken_by"]);string employer=EmployerName(S(r,"employer_npc"));C.Atomic(()=>{C.Execute("UPDATE job SET status='failed' WHERE id=$p0",id);C.Execute("DELETE FROM item WHERE job_id=$p0",id);C.Log(who,"failed_job",id.ToString(),"Dawn came with the night's job \""+S(r,"title")+"\" not done; "+employer+" was gone.");});host.Trade.Remember(who,S(r,"employer_npc"),"Jef took my night's work \""+S(r,"title")+"\" and did not have it done by five. I will not ask him twice.",5,"Jef let a man down on night work",-1);}return expired;
    }
    private string EmployerName(string id)=>S(C.Rules["employers"]?[id],"name",C.Scalar<string>("SELECT name FROM npc WHERE id=$p0",id)??id);
    public void SettleNight(int who,JsonObject job,JsonObject settlement)
    {
        if(S(job,"source")!="night"||S(settlement,"status")!="done"||settlement["caught"]?.GetValue<bool>()==true)return;var facts=settlement["facts"]!.AsArray();if(C.Roll()<.15){settlement["pay_c"]=0;settlement["trust_delta"]=Math.Min((int)N(settlement["trust_delta"]),0);facts.Add("A night watchman came round the corner with his lantern. Jef got away, but the goods and the pay were lost with them.");return;}if(C.Roll()<.12){settlement["pay_c"]=R5(N(settlement["pay_c"])/2);facts.Add("Men from a rival crew were waiting at the corner and took their share; the pay was halved.");return;}settlement["trust_delta"]=Math.Max((int)N(settlement["trust_delta"]),1);
    }
    private JsonObject BoardSchema(int players)
    {
        var job=JsonNode.Parse("""{"type":"object","properties":{"title":{"type":"string","minLength":3,"maxLength":70},"giver":{"type":"string"},"task_type":{"type":"string","enum":["carry","watch","deliver"]},"goods":{"type":"string"},"from":{"type":"string"},"to":{"type":"string"},"twist":{"type":"string"},"recipient":{"type":"string","maxLength":60},"pay_c":{"type":"integer"},"pitch":{"type":"string","minLength":10,"maxLength":300},"items":{"type":"integer"}},"required":["title","giver","task_type","goods","from","to","twist","recipient","pay_c","pitch"]}""")!.AsObject();job["properties"]!["giver"]!["enum"]=new JsonArray(givers.Select(g=>(JsonNode)JsonValue.Create(g)!).ToArray());foreach(string key in new[]{"from","to"})job["properties"]![key]!["enum"]=new JsonArray(Plan.Data["spots"]!.AsObject().Where(p=>!p.Key.StartsWith("_")).Select(p=>(JsonNode)JsonValue.Create(p.Key)!).ToArray());job["properties"]!["goods"]!["enum"]=Plan.Data["goods"]!.DeepClone();job["properties"]!["twist"]!["enum"]=Plan.Data["twists"]!.DeepClone();return new JsonObject{["type"]="object",["properties"]=new JsonObject{["jobs"]=new JsonObject{["type"]="array",["minItems"]=2,["maxItems"]=NightSize(players).Max,["items"]=job}},["required"]=new JsonArray("jobs")};
    }
    public async Task<JsonObject> WriteBoard(int who=1,bool force=false)
    {
        var prepare=await host.WithState(_=>{int night=NightOf(Day,Hour),tier=Tier(),players=host.OnlinePlayers().Count(),limit=DailyCallLimit?.Invoke()??120;C.SetWorld("night_board",new{night});bool may=NarrateAsync!=null&&(force||C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook='night_board'",Day)<2&&(limit==0||C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0",Day)<limit-15));var request=new JsonObject{["schema"]=BoardSchema(players),["system"]="Write night work offered in Antwerp in1873. Plain English, Dutch only in names. The engine owns all numbers and checks. No weapons or harm; jobs stay on their giver's own places and finish before five.",["prompt"]=new JsonObject{["clock"]=host.Clock.View(),["givers"]=new JsonObject(givers.Select(id=>new KeyValuePair<string,JsonNode?>(id,C.Rules["employers"]?[id]?.DeepClone()))),["spots"]=Plan.Data["spots"]!.DeepClone(),["pay_band"]=new JsonArray(Band(tier).Low,Band(tier).High),["carry_pay_band"]=new JsonArray(NativeCoreJobPlan.CarryBand(Band(tier),false).Low,NativeCoreJobPlan.CarryBand(Band(tier),false).High),["jobs_min"]=NightSize(players).Min,["jobs_max"]=NightSize(players).Max,["recent_log"]=C.Rows("SELECT text FROM log ORDER BY id DESC LIMIT 6"),["instructions"]="Carry one or two things by hand, a short way; watch until the bell; deliver one parcel naming the recipient. Shady but never spelled out, hint at the watch, rivals or water police. Two different givers at least."}.ToJsonString()};return(Night:night,Tier:tier,Most:NightSize(players).Max,May:may,Request:request,Generation:generation);}).ConfigureAwait(false);
        JsonObject? output=null;string? error=prepare.May?null:"no budget";if(prepare.May)try{output=await NarrateAsync!(who,"night_board",prepare.Request).ConfigureAwait(false);if(output==null)error="no narration";}catch{error="narration unavailable";}
        return await host.WithState(_=>{var jobs=output==null?new JsonArray():ClampNight(output,prepare.Tier);string source=output==null?"fallback":"claude";if(jobs.Count<2||jobs.Select(j=>S(j,"giver")).Distinct().Count()<2){var have=new HashSet<string>(jobs.Select(j=>S(j,"giver")));foreach(var f in ClampNight(new JsonObject{["jobs"]=Plan.Data["fallback"]!.DeepClone()},prepare.Tier))if(!have.Contains(S(f,"giver"))&&jobs.Count<prepare.Most)jobs.Add(f!.DeepClone());if(source=="claude")error="the model's night was too thin; hand-written work filled it";}if(generation!=prepare.Generation||NightOf(Day,Hour)!=prepare.Night||!InHours(Hour))return new JsonObject{["source"]=source,["jobs"]=0,["error"]="the night was over before the work was written"};Insert(jobs,prepare.Tier,source);host.PublishState(who);return new JsonObject{["source"]=source,["jobs"]=jobs.Count,["error"]=error};}).ConfigureAwait(false);
    }
    private void Tick(int who)
    {
        if(Expire()>0)host.PublishState(who);if(writing!=null&&!writing.IsCompleted||!BoardDue())return;writing=WriteBoard(who);_=writing.ContinueWith(t=>{_ = t.Exception;},TaskScheduler.Default);
    }
    public Task BoardSettled()=>writing??Task.CompletedTask;
    public void Register(NativeServiceHost service)
    {
        service.Register("POST","/api/night/sleep-rough",r=>throw new NativeServiceException("no lying down on the stones: find a bench or a bed",409));
        service.Register("GET","/api/night/state",r=>new JsonObject{["gang"]=GangNow(r.PlayerId),["givers"]=new JsonArray(givers.Select(id=>{var data=C.Scalar<string>("SELECT data_json FROM resident WHERE id=$p0",id);var at=data==null?null:JsonNode.Parse(data)?["work"]?["at"];return(JsonNode)new JsonObject{["id"]=id,["at"]=at==null?null:new JsonObject{["x"]=N(at[0]),["z"]=N(at[1])}};}).ToArray())});
        service.Register("POST","/api/night/roll",r=>{var gang=Roll(r);if(gang!=null)host.Publish("gang",new JsonObject{["gang"]=gang.DeepClone()});return new JsonObject{["gang"]=gang};});
        service.Register("POST","/api/night/gang/:id",r=>{string how=r.Text("how");if(how is not("run" or "fight" or "shout" or "pay" or "stand"))throw new NativeServiceException("how must be run, fight, shout, pay or stand",400);var result=Resolve(r,int.TryParse(r.Param("id"),out int id)?id:0,how);host.PublishState(r.PlayerId);return NativeCoreClock.Join(new JsonObject{["result"]=result},host.Payload(r.PlayerId));});
        service.Register("POST","/api/dev/gang",r=>{var gang=Roll(r,true);if(gang!=null)host.Publish("gang",new JsonObject{["gang"]=gang.DeepClone()});return new JsonObject{["gang"]=gang};});
        service.Register("POST","/api/dev/gang-chance",r=>new JsonObject{["perHour"]=GangChance(r.PlayerId,r.Body)});
        service.RegisterAsync("POST","/api/dev/night-work",async r=>{if(r.Bool("fallback"))return await host.WithState(_=>{var ids=Insert(ClampNight(new JsonObject{["jobs"]=Plan.Data["fallback"]!.DeepClone()},Tier()),Tier(),"fallback");host.PublishState(r.PlayerId);return(object?)new JsonObject{["source"]="fallback",["ids"]=ids};}).ConfigureAwait(false);return await WriteBoard(r.PlayerId,true).ConfigureAwait(false);});
        service.TickHooks.Add((r,advanced)=>Tick(r.PlayerId));service.TakeJobChecks.Add((job,who)=>{if(S(job,"source")=="night"&&job["task"] is JsonObject task&&!InTime(task,S(job,"employer_npc")))throw new NativeServiceException("too late for that one: "+EmployerName(S(job,"employer_npc"))+" is gone at five, and it would not be done by then",409);});service.Jobs.SettlementExtras.Add(SettleNight);service.SleepHooks.Add(RobbedAsleep);service.NewGame+=()=>{generation++;lastRoll.Clear();C.Execute("DELETE FROM player_state WHERE key='gang'");C.Execute("DELETE FROM world_state WHERE key='gang'");};service.Loaded+=()=>{generation++;lastRoll.Clear();};
    }
}
