using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Lamplighter rounds, native fire bucket-chain participation and dawn dock hiring.</summary>
public sealed partial class NativeTownLife : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeEvents events;
    private readonly NativeActions actions;
    private NativeServiceContext C=>host.Context;
    private int Minute=>host.Clock.MinuteNow()-1440;
    private int Day=>(int)N(host.Clock.View(),"day");
    private static double N(JsonNode? n,string k,double f=0)=>NativeGoods.N(n,k,f);
    private static string S(JsonNode? n,string k,string f="")=>NativeGoods.S(n,k,f);
    private static bool B(JsonNode? n,string k)=>NativeGoods.B(n,k);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static double V(JsonNode? n)=>NativeGoods.Number(n);
    private static uint Hash(string text){uint h=2166136261;foreach(char c in text)h=unchecked((h^c)*16777619);return h;}
    public Func<JsonObject,JsonObject?>? HiringWords;
    public NativeTownLife(NativeServiceHost host,NativeEvents events,NativeActions actions)=>(this.host,this.events,this.actions)=(host,events,actions);
    private JsonArray Stages(JsonObject ev)=>A(JsonNode.Parse(S(ev,"stages_json","[]")));
    private void Save(JsonObject ev,string key,JsonObject value){var stages=Stages(events.Row((int)N(ev,"id"))??ev);stages[0]![key]=value.DeepClone();events.SaveStages((int)N(ev,"id"),stages);}
    private JsonObject? Fire(JsonObject ev)=>Stages(ev).FirstOrDefault()?["fire"]as JsonObject;
    private JsonObject? Hiring(JsonObject ev)=>Stages(ev).FirstOrDefault()?["hiring"]as JsonObject;
    private JsonObject? ChainPart(JsonObject fire,int player)=>fire["players"]?[player.ToString()]as JsonObject;
    private void PlacePeople(JsonObject ev,JsonArray people,Func<int,JsonObject> position,string role)
    {
        int eventId=(int)N(ev,"id");var ids=A(JsonNode.Parse(S(events.Row(eventId),"people_json","[]")));foreach(var (person,index) in people.Select((p,i)=>(p,i))){string id=person!.GetValue<string>();if(actions.Resident(id)==null)continue;var old=actions.Of(id);var at=position(index);if(old!=null){if(N(old,"event_id",-1)!=eventId)continue;C.Execute("UPDATE npc_action SET target_x=$p0,target_z=$p1,phase=$p2 WHERE id=$p3",N(at,"x"),N(at,"z"),role,(int)N(old,"id"));}else actions.Start(new(){["npc_id"]=id,["kind"]="attend",["target"]=S(ev,"title"),["target_x"]=N(at,"x"),["target_z"]=N(at,"z"),["source"]="event",["event_id"]=eventId,["minutes"]=Math.Max(5,N(ev,"end_m")-Minute),["phase"]=role,["data"]=new JsonObject{["role"]=role,["order"]=index}},null);if(!ids.Any(n=>n?.GetValue<string>()==id))ids.Add(id);}C.Execute("UPDATE town_event SET people_json=$p0 WHERE id=$p1",ids.ToJsonString(),eventId);
    }
    private void Act(JsonObject ev,JsonObject stage,int index)
    {
        string act=S(stage,"act");if(act.StartsWith("fire_",StringComparison.Ordinal)){var fire=Fire(events.Row((int)N(ev,"id"))!);if(act=="fire_start"){fire=events.Data["fires"]?[(((Day-1)%7)+1).ToString()]?.DeepClone().AsObject();if(fire==null)return;fire["started"]=Minute;fire["players"]=new JsonObject();fire["chainIds"]=new JsonArray();fire["firemen"]=new JsonArray();Save(ev,"fire",fire);JsonArray step=A(fire["step"]),outward=A(fire["out"]);PlacePeople(ev,A(fire["family"]),i=>new(){["x"]=V(step[0])+V(outward[0])*6-V(outward[1])*(i-A(fire["family"]).Count/2.0)*.9,["z"]=V(step[1])+V(outward[1])*6+V(outward[0])*(i-A(fire["family"]).Count/2.0)*.9},"family");foreach(var id in A(fire["family"]))if(actions.Resident(id!.GetValue<string>())!=null)host.Trade.Remember(1,id.GetValue<string>(),"Our house caught fire. We got into the street and watched the smoke.",7);}
            else if(fire!=null&&act=="fire_brigade"){var candidates=C.Rows("SELECT data_json FROM resident").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject()).Where(r=>S(r,"sex")=="m"&&N(r,"age")>=20&&N(r,"age")<=52&&actions.Of(S(r,"id"))==null&&C.Rules["employers"]?[S(r,"id")]==null).OrderByDescending(r=>N(r["stats"],"courage")).Take(4).ToArray();var ids=new JsonArray(candidates.Select(r=>r["id"]!.DeepClone()).ToArray());fire["firemen"]=ids.DeepClone();var pump=A(fire["pumpAt"]);PlacePeople(ev,ids,i=>new(){["x"]=V(pump[0])+(i%2)*1.2,["z"]=V(pump[1])+Math.Floor(i/2.0)*1.2},"fireman");Save(ev,"fire",fire);}
            else if(fire!=null&&act=="fire_chain"){var slots=A(fire["chain"]);var pool=C.Rows("SELECT data_json FROM resident").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject()).Where(r=>N(r,"age")>=14&&N(r,"age")<65&&C.Rules["employers"]?[S(r,"id")]==null&&actions.Of(S(r,"id"))==null).OrderBy(r=>NativeGoods.Distance(N(actions.Position(S(r,"id")),"x"),N(actions.Position(S(r,"id")),"z"),V(A(fire["step"])[0]),V(A(fire["step"])[1]))).Take(Math.Min(60,slots.Count)).ToArray();var ids=new JsonArray(pool.Select(r=>r["id"]!.DeepClone()).ToArray());fire["chainIds"]=ids.DeepClone();PlacePeople(ev,ids,i=>new(){["x"]=V(A(slots[i])[0]),["z"]=V(A(slots[i])[1])},"chain");Save(ev,"fire",fire);}
            else if(fire!=null&&act=="fire_down")SettleFire(ev,fire);
        }
        if(act=="hire_gather"){var hiring=events.Data["hiring"]!.DeepClone().AsObject();hiring["day"]=Day;hiring["called"]=false;foreach(var sp in A(hiring["spots"])){sp!["stands"]=new JsonObject();sp["results"]=new JsonObject();sp["picked"]=new JsonArray();string foreman=S(sp,"foreman");if(foreman!="")PlacePeople(ev,new JsonArray(foreman),i=>new(){["x"]=N(sp,"x"),["z"]=N(sp,"z")},"natie_foreman");double yaw=N(sp,"yaw"),dx=Math.Sin(yaw),dz=Math.Cos(yaw);PlacePeople(ev,A(sp["men"]),i=>new(){["x"]=N(sp,"x")+dx*(3+Math.Floor(i/6.0)*1.3)-dz*((i%6)-2.5)*1.05,["z"]=N(sp,"z")+dz*(3+Math.Floor(i/6.0)*1.3)+dx*((i%6)-2.5)*1.05},"dockers");}Save(ev,"hiring",hiring);}
        if(act=="hire_call"){var hiring=Hiring(events.Row((int)N(ev,"id"))!);if(hiring==null||B(hiring,"called"))return;hiring["called"]=true;foreach(var sp in A(hiring["spots"])){var men=A(sp!["men"]);sp["picked"]=new JsonArray(men.Take((int)N(sp,"want")).Select(n=>n!.DeepClone()).ToArray());foreach(var stand in (sp["stands"]as JsonObject??new())){int player=int.Parse(stand.Key);var pos=actions.PlayerPosition(player);bool there=pos==null||NativeGoods.Distance(N(pos,"x"),N(pos,"z"),N(sp,"x"),N(sp,"z"))<=21.6;var p=host.Player(player);double strength=(N(p,"food")+N(p,"health")+N(p,"sleep"))/3,trust=C.Scalar<int>("SELECT trust FROM faction_trust WHERE faction='naties' AND player_id=$p0",player),own=C.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1",S(sp,"foreman"),player),chance=Math.Clamp(.2+trust*.08+own*.05+(strength-5)*.05,.05,.9);bool selected=there&&(Hash($"{N(ev,"id")}:jef{(player==1?"":player)}:{S(sp,"id")}")/4294967296.0)<chance;int? job=null;if(selected){events.PostJob(new JsonObject{["title"]="Taken on at the gate: a day on "+S(sp,"ship"),["template"]="hiring"},new JsonObject{["item"]="sacks",["text"]="The foreman took you on at the gate this morning."},S(sp,"employer"),player);job=C.Scalar<int>("SELECT MAX(id) FROM job");}sp["results"]![stand.Key]=new JsonObject{["picked"]=selected,["text"]=selected?"The foreman points at you. Taken on. The work is on the board.":there?"The foreman's eye passes over you. Not today.":"The names were called while you were away.",["job"]=job};C.Log(player,selected?"hired_jef":"not_hired_jef",S(sp,"foreman"),"At "+S(sp,"label")+" the foreman "+(selected?"took Jef on.":"passed Jef over."));}sp["call"]=$"For {S(sp,"ship")}: {string.Join(", ",A(sp["picked"]).Select(n=>S(actions.Resident(n!.GetValue<string>()),"name")))}. The rest of you, try again tomorrow.";sp["source"]="engine";}var words=HiringWords?.Invoke(hiring);if(words!=null)foreach(var sp in A(hiring["spots"]))if(words[S(sp,"id")]is JsonObject line){sp!["call"]=line["call"]?.DeepClone()??sp["call"]?.DeepClone();sp["source"]="native_provider";}Save(ev,"hiring",hiring);QueueHiring(ev,hiring);host.PublishState();}
        host.Publish("events");
    }
    private (JsonObject ev,JsonObject fire)? Chain()
    {
        foreach(var ev in events.Live()){if(S(ev,"template")!="house_fire"||S(ev,"status")!="running")continue;var stages=Stages(ev!.AsObject());int index=(int)N(ev,"stage");var fire=Fire(ev.AsObject());if(index>=0&&index<stages.Count&&S(stages[index],"act")=="fire_chain"&&fire!=null)return(ev.AsObject(),fire);}return null;
    }
    private JsonObject Join(int player,double x,double z)
    {
        var now=Chain();if(now==null)return new(){["ok"]=false,["why"]="There is no bucket chain to stand in."};var (ev,fire)=now.Value;var part=ChainPart(fire,player);if(part!=null&&part["left"]==null)return new(){["ok"]=false,["why"]="You are in the chain already."};if(part?["settled"]!=null)return new(){["ok"]=false,["why"]="That is done with."};var taken=(fire["players"]as JsonObject??new()).Where(p=>p.Key!=player.ToString()&&p.Value?["left"]==null).Select(p=>(int)N(p.Value,"slot")).ToHashSet();var slots=A(fire["chain"]);int best=-1;double near=3;for(int i=0;i<slots.Count;i++){double d=NativeGoods.Distance(x,z,V(A(slots[i])[0]),V(A(slots[i])[1]));if(d<near&&!taken.Contains(i)){near=d;best=i;}}if(best<0)return new(){["ok"]=false,["why"]="Stand by the line to take a bucket."};double before=part?["left"]==null?0:N(part,"left")-N(part,"joined");fire["players"]![player.ToString()]=new JsonObject{["joined"]=Minute-before,["left"]=null,["slot"]=best,["player"]=player};Save(ev,"fire",fire);C.Log(player,"chain_join",S(fire,"owner"),"Jef took a place in the bucket chain.");host.Publish("events");return new(){["ok"]=true,["text"]="You take a bucket. Pass it on.",["slot"]=best};
    }
    private JsonObject Leave(int player)
    {
        var now=Chain();if(now==null)return new(){["ok"]=false,["why"]="You are not in a chain."};var part=ChainPart(now.Value.fire,player);if(part==null||part["left"]!=null)return new(){["ok"]=false,["why"]="You are not in a chain."};part["left"]=Minute;Save(now.Value.ev,"fire",now.Value.fire);host.Publish("events");return new(){["ok"]=true,["text"]="You step out of the chain.",["slot"]=part["slot"]!.DeepClone()};
    }
    private void SettleFire(JsonObject ev,JsonObject fire)
    {
        foreach(var pair in fire["players"]as JsonObject??new()){int player=int.Parse(pair.Key);var part=pair.Value!.AsObject();if(part["settled"]!=null)continue;int minutes=(int)Math.Max(0,Math.Min(N(part,"left",Minute),Minute)-N(part,"joined"));double wealth=A(fire["family"]).Select(id=>N(actions.Resident(id!.GetValue<string>())?["stats"],"wealth")).DefaultIfEmpty(0).Max();int paid=minutes<20||wealth<5?0:Math.Clamp((int)Math.Floor(minutes/30.0*10/5+.5)*5,5,30),trust=minutes>=20&&wealth<5?1:0;if(paid>0)C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1",paid,player);if(trust>0)foreach(var id in A(fire["family"]))if(actions.Resident(id!.GetValue<string>())!=null){C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) VALUES($p0,$p1)",id.GetValue<string>(),player);C.Execute("UPDATE npc_relationship SET trust=MIN(10,trust+1) WHERE npc_id=$p0 AND player_id=$p1",id.GetValue<string>(),player);}string text=minutes<20?"You were hardly in the chain long enough to count.":paid>0?$"The owner presses {paid} centimes into your black hand. For the buckets.":"The family has nothing to give. We will not forget it, Jef.";part["settled"]=new JsonObject{["minutes"]=minutes,["paid_c"]=paid,["trust"]=trust,["text"]=text};host.Trade.Remember(player,S(fire,"owner"),"Jef stood in the bucket chain when our house burned.",6,"Jef stood in a bucket chain",1);C.Log(player,"chain_settled",S(fire,"owner"),text);host.Publish("events",new(){["jobs"]=true,["fire_settled"]=text,["fire_for"]=player});}Save(ev,"fire",fire);
    }
    private JsonObject? FireFor(JsonObject ev,int player)
    {
        var fire=Fire(ev);if(fire==null)return null;var result=new JsonObject();foreach(string key in new[]{"owner","owner_name","door","out","step","storeys","water","chain","full","station","firemen"})result[key]=fire[key]?.DeepClone();result["chain_ids"]=fire["chainIds"]?.DeepClone();result["pump_path"]=fire["pumpPath"]?.DeepClone();result["pump_at"]=fire["pumpAt"]?.DeepClone();var part=ChainPart(fire,player);result["jef"]=part==null?null:new JsonObject{["slot"]=part["slot"]!.DeepClone(),["in"]=part["left"]==null};result["settled"]=part?["settled"]?["text"]?.DeepClone();return result;
    }
    private JsonObject? HiringFor(JsonObject ev,int player)
    {
        var hiring=Hiring(ev);if(hiring==null)return null;return new(){["called"]=B(hiring,"called"),["spots"]=new JsonArray(A(hiring["spots"]).Select(sp=>{var s=sp!.DeepClone().AsObject();s["men"]=A(sp["men"]).Count;s["jef"]=sp["stands"]?[player.ToString()]!=null;s["jef_result"]=sp["results"]?[player.ToString()]?.DeepClone();s.Remove("stands");s.Remove("results");return (JsonNode)s;}).ToArray())};
    }
    private JsonObject Stand(int player,double x,double z)
    {
        var ev=events.Live().LastOrDefault(e=>S(e,"template")=="hiring"&&S(e,"status")=="running")as JsonObject;var h=ev==null?null:Hiring(ev);if(h==null)return new(){["ok"]=false,["why"]="Nobody is hiring now. The naties hire at dawn."};if(B(h,"called"))return new(){["ok"]=false,["why"]="The names have been called. Try again tomorrow."};var spot=A(h["spots"]).FirstOrDefault(s=>NativeGoods.Distance(x,z,N(s,"x"),N(s,"z"))<=12);if(spot==null)return new(){["ok"]=false,["why"]="Stand with the men at the gate."};if(A(h["spots"]).Any(s=>s?["stands"]?[player.ToString()]!=null))return new(){["ok"]=false,["why"]="You are standing for hire already."};spot["stands"]![player.ToString()]=Minute;Save(ev!,"hiring",h);C.Log(player,"stood_for_hire",S(spot,"id"),"Jef stood with the day men at the gate.");host.Publish("events");return new(){["ok"]=true,["text"]="You stand with the men and wait for the foreman.",["spot"]=S(spot,"id")};
    }
    public void Register(NativeServiceHost service)
    {
        service.NewGame+=()=>{generation++;writingCalls.Clear();};service.Loaded+=()=>{generation++;writingCalls.Clear();};var before=events.StageAct;events.StageAct=(ev,stage,index)=>{before?.Invoke(ev,stage,index);Act(ev,stage,index);};events.FireView=FireFor;events.HiringView=HiringFor;var ended=events.EventEnded;events.EventEnded=(ev,status)=>{ended?.Invoke(ev,status);var fire=Fire(ev);if(fire!=null){SettleFire(ev,fire);var soot=A(C.World("fire_soot"));soot.Add(new JsonObject{["house"]=fire["house"]?.DeepClone(),["door"]=fire["door"]?.DeepClone(),["out"]=fire["out"]?.DeepClone(),["width"]=N(fire,"width"),["storeys"]=N(fire,"storeys"),["day"]=Day});C.SetWorld("fire_soot",soot);}};
        service.Register("GET","/api/townlife",r=>new JsonObject{["day"]=Day,["rounds"]=C.World("townlife_lamps")?["rounds"]?.DeepClone()??new JsonArray(),["fog"]=host.Clock.FogView(),["soot"]=new JsonArray(A(C.World("fire_soot")).Where(s=>Day-N(s,"day")<3).Select(s=>s!.DeepClone()).ToArray())});service.Register("POST","/api/fire/join",r=>NativeCoreClock.Join(new JsonObject{["result"]=Join(r.PlayerId,N(r.Body,"x",double.NaN),N(r.Body,"z",double.NaN))},host.Payload(r.PlayerId)));service.Register("POST","/api/fire/leave",r=>NativeCoreClock.Join(new JsonObject{["result"]=Leave(r.PlayerId)},host.Payload(r.PlayerId)));service.Register("POST","/api/hiring/stand",r=>NativeCoreClock.Join(new JsonObject{["result"]=Stand(r.PlayerId,N(r.Body,"x",double.NaN),N(r.Body,"z",double.NaN))},host.Payload(r.PlayerId)));
    }
}


