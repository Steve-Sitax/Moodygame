using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public sealed partial class NativeMills
{
    private int lastHour=-1;
    private string Miller(string id)=>id=="mill_mid"?"ml01":"ml03";
    private string Man(string id)=>id=="mill_mid"?"ml02":"ml04";
    private string? Baker(JsonObject mill)=>A(C.World("town")?["shops"]).FirstOrDefault(s=>S(s,"id")==S(mill,"bakery"))?["keeper"]?.GetValue<string>();
    private string SpotLabel(string id)=>S(host.Jobs.Plan.Data["spots"]?[id],"label",id);
    public JsonObject? BuildJob(JsonObject mill,string kind,int who=1,bool? cartOverride=null,string? twistOverride=null)
    {
        string id=S(mill,"id");var rng=NativeCoreIdeas.Random(Hash($"{id}:{kind}:{Day}"));var band=A(host.Jobs.Plan.Data["tierPay"]?[host.Jobs.Tier(who)]);int phrase=(int)Math.Floor(rng()*(kind=="help"?1:2));var meta=new JsonObject{["mill"]=id,["mk"]=kind};
        if(kind=="help"){var door=A(mill["door"]);var cap=mill["capstan"]as JsonArray??new JsonArray(V(door[0])+1.2,V(door[1])-.8);return new(){["title"]="An hour at the mill",["employer"]=Miller(id),["task_type"]="mill",["pay_c"]=Math.Max(V(band[0]),Math.Min(V(band[1]),V(Data["helpPay"]))),["pitch"]=$"The wind keeps backing today. Give me an hour at {S(mill,"label")} on the wall: when I call, put your shoulder to the capstan and bring her face round to the wind.",["task"]=new JsonObject{["kind"]="mill",["goods"]="sacks",["mill"]=id,["post"]=new JsonObject{["x"]=V(door[0]),["z"]=V(door[1]),["label"]=S(mill,"label")},["capstan"]=new JsonObject{["x"]=V(cap[0]),["z"]=V(cap[1])},["duration_s"]=V(Data["helpMinutes"])*2,["turns"]=Data["helpTurns"]!.DeepClone(),["twist"]="none",["limit_s"]=null,["millJob"]=meta},["risk"]="low"};}
        string from=kind=="flour"?S(mill,"yard"):S(mill,"grain"),to=kind=="flour"?S(mill,"bakeryDoor"):S(mill,"yard");string? employer=kind=="flour"?Baker(mill):Miller(id);if(employer==null)return null;bool cart=cartOverride??(host.Jobs.CartWorkOpen(who)&&rng()<.5);int count=cart?3:1;string[] twists=kind=="flour"?new[]{"none","none","broken_goods","heavy_load","stranger_offer"}:new[]{"none","none","broken_goods","foreman_watches","stranger_offer"};string twist=twistOverride??twists[(int)Math.Floor(rng()*twists.Length)];if(cart&&twist=="heavy_load")twist="none";double distance=host.Jobs.Plan.WalkDistance(from,to);double pay=Pay(count,distance,cart,(V(band[0]),V(band[1])));var task=new JsonObject{["kind"]="carry",["goods"]="sacks",["count"]=count,["from"]=from,["to"]=to,["twist"]=twist,["limit_s"]=null,["millJob"]=meta};if(cart)task["cart"]=true;
        string title,pitch;if(kind=="flour"){title=phrase==0?"Flour for the bakery":"A sack from the mill";pitch=phrase==0?$"My loft is near empty and the mill's cart will not come till dawn. {(cart?$"Take the miller's barrow and bring {(count==3?"three sacks":count+" sacks")}":"Bring me a sack")} of flour from {SpotLabel(S(mill,"yard"))} at the foot of the wall, to my door. Keep it dry.":$"The dough won't wait for the miller. {(cart?$"{(count==3?"Three sacks":count+" sacks")} of flour on his barrow":"One sack of flour on your back")} from {SpotLabel(S(mill,"yard"))} to my bakehouse, and mind the gutters.";}
        else{title=phrase==0?"Grain up from the dock":"Rye for the mill";pitch=phrase==0?$"A barge of Zeeland rye lies at {SpotLabel(S(mill,"grain"))}. {(cart?$"Load {(count==3?"three sacks":count+" sacks")} on my barrow":"Bring me a sack")} to {SpotLabel(S(mill,"yard"))}; the natie's men will show you which.":$"The stones are hungry and my man is out with the cart. {(cart?$"{(count==3?"Three sacks":count+" sacks")} of rye by barrow":"A sack of rye")} from {SpotLabel(S(mill,"grain"))} to the store at the foot of the wall, before the wind drops.";}
        return new(){["title"]=title,["employer"]=employer,["task_type"]="carry",["pay_c"]=pay,["pitch"]=pitch,["task"]=task,["risk"]=twist=="none"?"low":"medium"};
    }
    public int InsertJob(JsonObject job,int who=1)
    {
        string employer=S(job,"employer");var npc=C.One("SELECT district,faction FROM npc WHERE id=$p0",employer);C.Execute("INSERT INTO job(day,title,employer_npc,district,task_type,pay_c,risk,tier,required_faction,pitch,task_json,source,status)VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,$p8,$p9,$p10,'mill','offered')",Day,S(job,"title"),employer,S(npc,"district","town"),S(job,"task_type"),N(job,"pay_c"),S(job,"risk"),host.Jobs.Tier(who),npc?["faction"]==null?null:S(npc,"faction"),S(job,"pitch"),O(job["task"]).ToJsonString());return C.Scalar<int>("SELECT last_insert_rowid()");
    }
    private JsonArray TodayJobs()
    {
        var result=new JsonArray();foreach(var row in C.Rows("SELECT id,status,task_json FROM job WHERE source='mill' AND(day=$p0 OR status='taken')",Day)){JsonObject? task;try{task=JsonNode.Parse(S(row,"task_json","{}"))as JsonObject;}catch{continue;}if(task?["millJob"]==null)continue;result.Add(new JsonObject{["id"]=row!["id"]!.DeepClone(),["status"]=row["status"]!.DeepClone(),["meta"]=task["millJob"]!.DeepClone()});}return result;
    }
    public JsonArray OfferJobs()
    {
        var stocks=Stocks();var jobs=TodayJobs();var ids=new JsonArray();foreach(var node in Mills){var m=node!.AsObject();string id=S(m,"id");bool Had(string kind)=>jobs.Any(j=>S(j?["meta"],"mill")==id&&S(j?["meta"],"mk")==kind);var run=RunNow(m,Day,Hour);double incoming=S(run?["run"],"kind")=="flour"&&S(run,"phase")is("go"or"unload")?V(stocks["carts"]?[id]):0;
            if(!Had("flour")&&Hour>=5&&Hour<19&&N(stocks["bakeries"]?[S(m,"bakery")],"flour")+incoming<=3&&N(stocks["mills"]?[id],"flour")>=1){var j=BuildJob(m,"flour");if(j!=null&&N(j["task"],"count")<=N(stocks["mills"]?[id],"flour"))ids.Add(InsertJob(j));else if(j!=null&&BuildJob(m,"flour",cartOverride:false)is{} one)ids.Add(InsertJob(one));}
            if(!Had("grain")&&Hour>=6&&Hour<17&&N(stocks["mills"]?[id],"grain")<=3&&BuildJob(m,"grain")is{} grain)ids.Add(InsertJob(grain));
            if(!Had("help")&&Hour>=7&&Hour<16&&Turning(S(host.Clock.View(),"weather"),Day,Hour)>0&&N(stocks["mills"]?[id],"grain")>=1&&BuildJob(m,"help")is{} help)ids.Add(InsertJob(help));
        }return ids;
    }
    private static JsonObject? Meta(JsonObject job)=>S(job,"source")=="mill"?job["task"]?["millJob"]as JsonObject:null;
    private void Taken(JsonObject job,int who)
    {
        var meta=Meta(job);if(meta==null||S(meta,"mk")!="flour"||S(job["task"],"kind")!="carry")return;double reserved=0;Adjust(stocks=>{var mill=stocks["mills"]?[S(meta,"mill")]as JsonObject;if(mill==null)return;reserved=Math.Min(N(job["task"],"count"),N(mill,"flour"));mill["flour"]=N(mill,"flour")-reserved;});var task=O(job["task"]).DeepClone().AsObject();task["millJob"]!["reserved"]=reserved;C.Execute("UPDATE job SET task_json=$p0 WHERE id=$p1",task.ToJsonString(),N(job,"id"));
    }
    private void Settled(int who,JsonObject job,JsonObject settlement)
    {
        var meta=Meta(job);if(meta==null)return;var mill=Mills.FirstOrDefault(m=>S(m,"id")==S(meta,"mill"));if(mill==null)return;if(S(meta,"mk")=="help"){if(A(settlement["facts"]).Any(f=>Regex.IsMatch(f!.GetValue<string>(),"every time|turned the cap")))Adjust(stocks=>{var m=stocks["mills"]![S(mill,"id")]!;if(N(m,"grain")>0){m["grain"]=N(m,"grain")-1;m["flour"]=N(m,"flour")+1;}});return;}if(S(job["task"],"kind")!="carry")return;var match=Regex.Match(A(settlement["facts"]).FirstOrDefault()?.GetValue<string>()??"",@"brought (\d+) of");double brought=match.Success?double.Parse(match.Groups[1].Value):N(job["task"]?["progress"],"delivered");Adjust(stocks=>{var target=S(meta,"mk")=="flour"?stocks["bakeries"]![S(mill,"bakery")]!:stocks["mills"]![S(mill,"id")]!;string field=S(meta,"mk")=="flour"?"flour":"grain";target[field]=N(target,field)+brought;});
    }
    public JsonObject View()
    {
        var stocks=Stocks();return new(){["day"]=Day,["weather"]=S(host.Clock.View(),"weather"),["mills"]=new JsonArray(Mills.Select(m=>(JsonNode)new JsonObject{["id"]=S(m,"id"),["label"]=S(m,"label"),["miller"]=Miller(S(m,"id")),["man"]=Man(S(m,"id")),["baker"]=Baker(m!.AsObject()),["grain"]=N(stocks["mills"]?[S(m,"id")],"grain"),["flour"]=N(stocks["mills"]?[S(m,"id")],"flour"),["bakery"]=N(stocks["bakeries"]?[S(m,"bakery")],"flour"),["cart"]=V(stocks["carts"]?[S(m,"id")]),["turning"]=Turning(S(host.Clock.View(),"weather"),Day,Hour),["run"]=RunNow(m.AsObject(),Day,Hour),["runs"]=Runs(m.AsObject(),Day)}).ToArray())};
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/mills",_=>View());service.Register("POST","/api/dev/mills/job",r=>{var m=Mills.FirstOrDefault(m=>S(m,"id")==r.Text("mill","mill_mid"))?.AsObject()??Mills[0]!.AsObject();string kind=r.Text("kind")is"grain"or"help"?r.Text("kind"):"flour",twist=r.Text("twist");if(!new[]{"none","broken_goods","stranger_offer","foreman_watches","heavy_load"}.Contains(twist))twist="";bool? cart=r.Body["cart"]is JsonValue v&&v.TryGetValue<bool>(out var b)?b:null;var job=BuildJob(m,kind,r.PlayerId,cart,twist==""?null:twist)??throw new NativeServiceException("no baker for that mill",409);int id=InsertJob(job,r.PlayerId);host.PublishState();return new JsonObject{["id"]=id,["title"]=job["title"]!.DeepClone(),["pay_c"]=job["pay_c"]!.DeepClone(),["task"]=job["task"]!.DeepClone(),["employer"]=job["employer"]!.DeepClone()};});
        service.Register("POST","/api/dev/mills/stock",r=>{var m=Mills.FirstOrDefault(m=>S(m,"id")==r.Text("mill","mill_mid"))??Mills[0]!;return Adjust(stocks=>{foreach(string key in new[]{"grain","flour","bakery"})if(r.Body[key]is JsonValue value&&value.TryGetValue<double>(out var n)&&double.IsFinite(n)){var target=key=="bakery"?stocks["bakeries"]![S(m,"bakery")]!:stocks["mills"]![S(m,"id")]!;target[key=="bakery"?"flour":key]=n;}});});
        service.TakeJobHooks.Add(Taken);service.Jobs.SettlementExtras.Add(Settled);service.Jobs.BoardExtras.Add(()=>OfferJobs());service.TickAfterHooks.Add(_=>{Stocks();int hour=(int)Math.Floor(Hour);if(hour!=lastHour){lastHour=hour;if(OfferJobs().Count>0)host.PublishState();}});
    }
}

