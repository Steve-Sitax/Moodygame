using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Native event scheduler/director with checked stages, real resident attendance and cleaned effects.</summary>
public sealed partial class NativeEvents : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeActions actions;
    private NativeServiceContext C=>host.Context;
    public JsonObject Data=>actions.Data;
    private int Minute=>host.Clock.MinuteNow()-1440;
    private int Day=>(int)N(host.Clock.View(),"day");
    private static double N(JsonNode? n,string k,double f=0)=>NativeGoods.N(n,k,f);
    private static string S(JsonNode? n,string k,string f="")=>NativeGoods.S(n,k,f);
    private static bool B(JsonNode? n,string k)=>NativeGoods.B(n,k);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static double V(JsonNode? n)=>NativeGoods.Number(n);
    private static double D(JsonNode? a,JsonNode? b)=>NativeGoods.Distance(N(a,"x"),N(a,"z"),N(b,"x"),N(b,"z"));
    public Func<int>? EventPeopleMax;
    public Func<JsonObject>? EmigrantShip;
    private int PeopleMax=>Math.Clamp(EventPeopleMax?.Invoke()??100,0,100);
    public Func<JsonObject,JsonObject?>? Director;
    public Action<JsonObject,JsonObject,int>? StageAct;
    public Action<JsonObject,string>? EventEnded;
    public Func<JsonObject,int,JsonObject?>? FireView;
    public Func<JsonObject,int,JsonObject?>? HiringView;
    public NativeEvents(NativeServiceHost host,NativeActions actions)=>(this.host,this.actions)=(host,actions);
    public JsonObject? Row(int id)=>C.One("SELECT * FROM town_event WHERE id=$p0",id);
    public JsonArray Live()=>C.Rows("SELECT * FROM town_event WHERE status IN ('planned','running') ORDER BY id");
    public void SaveStages(int id,JsonArray stages)=>C.Execute("UPDATE town_event SET stages_json=$p0 WHERE id=$p1",stages.ToJsonString(),id);
    private JsonObject? Place(string id)
    {
        if(id=="house"||id.StartsWith("house:",StringComparison.Ordinal)){var r=id=="house"?C.Rows("SELECT data_json FROM resident ORDER BY id").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject()).FirstOrDefault(r=>N(r,"age")>=58&&S(r,"trade")!="priest"):actions.Resident(id[6..]);return r==null?null:new(){["id"]="house:"+S(r,"id"),["label"]="the house of "+S(r,"name"),["x"]=N(r["home"],"sx"),["z"]=N(r["home"],"sz"),["r"]=5};}
        var place=actions.FindPlace(id);if(place==null)return null;var open=actions.NearestOpen==null?place:actions.NearestOpen(N(place,"x"),N(place,"z"),8);if(open==null)return null;place["x"]=open["x"]!.DeepClone();place["z"]=open["z"]!.DeepClone();place["r"]=id=="cathedral_west"?9:Math.Min(14,N(C.World("town")?["places"]?[id],"r",8));return place;
    }
    public JsonObject Plan(JsonObject proposed,bool dev=false)
    {
        JsonObject No(string why)=>new(){["ok"]=false,["why"]=why};string template=S(proposed,"template");var source=A(Data["templates"]).FirstOrDefault(t=>S(t,"id")==template);var script=source!=null&&source["acts"]!=null?source:null;bool routine=B(source,"routine");var plan=proposed.DeepClone().AsObject();if(script!=null)plan["stages"]=script["stages"]!.DeepClone();if(template=="house_fire"){var f=Data["fires"]?[(((Day-1)%7)+1).ToString()];if(f==null)return No("no house near enough to water for a bucket chain");plan["place"]="house:"+S(f,"owner");if(!dev&&C.Scalar<int>("SELECT COUNT(*) FROM town_event WHERE template='house_fire' AND day>$p0",Day-3)>0)return No("a house fire was too recent");}
        var place=Place(S(plan,"place"));if(place==null)return No("no such place: "+S(plan,"place"));var stages=new JsonArray();int total=0;var current=place;var ops=new HashSet<string>{"gather","procession","sound","props","talk","notice","rumour","price","close","open","job","weather","scuffle","robbery","enter","depart"};
        foreach(var raw in A(plan["stages"]).Take(6)){string op=S(raw,"op");if(!ops.Contains(op))continue;int duration=Math.Clamp((int)Math.Floor(N(raw,"minutes",5)+.5),5,180);if(total+duration>240)break;var stage=raw!.DeepClone().AsObject();stage["minutes"]=duration;stage["count"]=Math.Clamp((int)N(stage,"count"),0,PeopleMax);stage["factor"]=op=="price"?Math.Clamp(N(stage,"factor",1),.5,3):1;if(op=="price"&&host.Trade.Item(S(stage,"item"))==null)continue;var at=S(stage,"place")==""?current:Place(S(stage,"place"))??current;stage["x"]=at["x"]!.DeepClone();stage["z"]=at["z"]!.DeepClone();stage["label"]=at["label"]!.DeepClone();if(op=="procession")current=at;if(script?["acts"]is JsonArray acts&&stages.Count<acts.Count)stage["act"]=acts[stages.Count]?.DeepClone();if(op=="enter"&&S(at,"id")!="cathedral_west")stage["op"]="sound";if(op=="depart"){stage["exit"]=new JsonObject{["id"]="kiel_road",["label"]="the road out to the Kiel cemetery",["x"]=-307,["z"]=296};stage["route"]=new JsonArray(new JsonArray(N(current,"x"),N(current,"z")),new JsonArray(-307,296),new JsonArray(-307,326));}stages.Add(stage);total+=duration;}
        if(stages.Count==0)return No("no stages the engine can play");int start=Minute+Math.Clamp((int)N(plan,"start_in_min",15),0,180),end=start+total;bool night=(start%1440)>=1320||(start%1440)<300;if(!dev&&!routine&&night&&!Regex.IsMatch(template+" "+S(plan,"title"),"night|burgl|smuggl|scuffle|watch|fire",RegexOptions.IgnoreCase))return No("the town is abed; only a night event now");if(!dev&&!routine&&night&&end>(int)Math.Floor((start-300)/1440.0)*1440+1740)return No("a night event must be over by 5:00");if(!dev&&!routine&&!night&&end>(start/1440)*1440+1320)return No("it would run past 22:00");if(!dev&&!routine&&C.Scalar<int>("SELECT COUNT(*) FROM town_event WHERE day=$p0 AND template NOT IN ('hiring','ballad')",Day)>=4)return No("four events today already");var overlap=Live().Where(e=>N(e,"start_m")-20<end&&N(e,"end_m")+20>start).ToArray();if(overlap.Any(e=>S(e,"place")==S(place,"id")||D(e,place)<60))return No("another event is too near then");if(!dev&&!routine&&overlap.Count(e=>S(e,"template")is not("hiring"or"ballad"))>=2)return No("two events run at once already");
        C.Execute("INSERT INTO town_event(day,title,template,place,x,z,r,start_m,end_m,stage,stages_json,people_json,leads_json,status,source,notice,rumour,why,for_player) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,$p8,-1,$p9,'[]','[]','planned',$p10,$p11,$p12,$p13,$p14)",Day,S(plan,"title",S(source,"title",template)),template,S(place,"id"),N(place,"x"),N(place,"z"),N(place,"r",8),start,end,stages.ToJsonString(),S(plan,"source","engine"),S(plan,"notice",S(source,"notice")),S(plan,"rumour",S(source,"rumour")),S(plan,"why"),plan["for_player"]==null?null:(int)N(plan,"for_player"));int id=C.Scalar<int>("SELECT last_insert_rowid()");WriteEvent(Row(id)!,"planned",$"Planned: {S(Row(id),"title")} at {S(place,"label")}, in {start-Minute} minutes ({S(plan,"source","engine")}).",3);host.Publish("events");return new(){["ok"]=true,["event"]=Row(id)};
    }
    public JsonObject FromTemplate(string id,int startIn=15,bool dev=false)
    {
        var template=A(Data["templates"]).FirstOrDefault(t=>S(t,"id")==id)as JsonObject??throw new NativeServiceException("no such template",404);var plan=template.DeepClone().AsObject();plan["template"]=id;plan["source"]="engine";plan["start_in_min"]=startIn;return Plan(plan,dev);
    }
    private void WriteEvent(JsonObject ev,string verb,string text,int weight,JsonObject? at=null)
    {
        at??=ev;if(text.Length>300)text=text[..300];C.Execute("INSERT INTO world_event(day,hour,minute,kind,verb,place,x,z,text,ref_type,ref_id,weight,data_json) SELECT day,hour,minute,'event',$p0,$p1,$p2,$p3,$p4,'town_event',$p5,$p6,'{}' FROM player WHERE id=1",verb,S(ev,"place"),N(at,"x"),N(at,"z"),text,(int)N(ev,"id"),Math.Clamp(weight,1,10));int eventId=C.Scalar<int>("SELECT last_insert_rowid()");var people=A(JsonNode.Parse(S(ev,"people_json","[]"))).Select(p=>p?.GetValue<string>()??"").Concat(A(JsonNode.Parse(S(ev,"leads_json","[]"))).Select(p=>S(p,"id"))).Where(id=>id!="").Distinct();foreach(string person in people)C.Execute("INSERT OR IGNORE INTO world_event_who(event_id,who) SELECT $p0,$p1 WHERE EXISTS(SELECT id FROM npc WHERE id=$p1)",eventId,person);
    }
    private static uint Hash(string text){uint h=2166136261;foreach(char c in text)h=unchecked((h^c)*16777619);return h;}
    public void Attend(JsonObject ev,JsonObject stage)
    {
        int id=(int)N(ev,"id"),count=(int)N(stage,"count");string role=S(stage,"role","crowd");var residents=C.Rows("SELECT data_json FROM resident ORDER BY id").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject()).Where(r=>actions.Of(S(r,"id"))==null&&C.Rules["employers"]?[S(r,"id")]==null&&S(r["work"],"kind")!="guard"&&NativeShops.Activity(r,Day,N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60).act!="home");if(role=="family"){var households=A(EmigrantShip?.Invoke()["households"]??new JsonArray(A(C.World("emigrants")?["families"]).Where(f=>S(f,"status")=="here"&&N(f,"board_day")==Day).Select(f=>f!["household"]!.DeepClone()).ToArray()));residents=residents.Where(r=>r["emigrant"]!=null&&N(r,"age")>=6&&households.Any(h=>V(h)==N(r,"household")));}else if(role=="police")residents=residents.Where(r=>S(r,"trade")=="police");else if(role=="children")residents=residents.Where(r=>N(r,"age")<16);else if(role=="musicians")residents=residents.Where(r=>S(r,"trade")=="sailor"||N(r["stats"],"warmth")>=6);var picked=residents.OrderBy(r=>D(actions.Position(S(r,"id")),stage)+Hash(S(r,"id")+":"+id)%50).Take(Math.Clamp(count,0,PeopleMax)).ToArray();var people=A(JsonNode.Parse(S(ev,"people_json","[]")));int offset=people.Count;foreach(var (person,index) in picked.Select((r,i)=>(r,i))){int i=offset+index;double radius=3+Math.Floor(i/20.0),angle=(i%20)/20.0*Math.PI*2+Math.Floor(i/20.0)*.37,x=N(stage,"x")+Math.Cos(angle)*radius,z=N(stage,"z")+Math.Sin(angle)*radius;var at=actions.NearestOpen?.Invoke(x,z,6)??new JsonObject{["x"]=x,["z"]=z};string npc=S(person,"id");actions.Start(new(){["npc_id"]=npc,["kind"]="attend",["target"]=S(ev,"title"),["target_x"]=N(at,"x"),["target_z"]=N(at,"z"),["source"]="event",["event_id"]=id,["minutes"]=Math.Max(5,N(ev,"end_m")-Minute),["data"]=new JsonObject{["order"]=i,["role"]=role}},null);people.Add(npc);}C.Execute("UPDATE town_event SET people_json=$p0 WHERE id=$p1",people.ToJsonString(),id);
    }
    private void RunStage(JsonObject ev,JsonObject stage,int index)
    {
        int id=(int)N(ev,"id");string stageKind=S(stage,"act",S(stage,"op"));WriteEvent(ev,"stage_"+stageKind,S(ev,"title")+": "+stageKind.Replace("_"," ")+(S(stage,"label")==""?"":" at "+S(stage,"label"))+(S(stage,"text")==""?"":" ("+S(stage,"text")+")")+".",index==0?3:2,stage);if(S(stage,"act")!=""){StageAct?.Invoke(ev,stage,index);return;}switch(S(stage,"op")){
            case "gather":Attend(ev,stage);break;
            case "procession":case "enter":case "depart":foreach(var action in actions.Active().Where(a=>N(a,"event_id",-1)==id)){int i=(int)N(JsonNode.Parse(S(action,"data_json","{}")),"order");double x=N(stage,"x")+((i%4)-1.5)*1.1,z=N(stage,"z")-Math.Floor(i/4.0)*1.2-1;string phase=S(stage,"op")=="enter"?"inside":"procession";if(S(stage,"op")=="depart"){x=N(stage["exit"],"x");z=N(stage["exit"],"z")+Math.Floor(i/4.0)*1.2;}C.Execute("UPDATE npc_action SET phase=$p0,target_x=$p1,target_z=$p2 WHERE id=$p3",phase,x,z,(int)N(action,"id"));}C.Execute("UPDATE town_event SET x=$p0,z=$p1 WHERE id=$p2",N(stage,"x"),N(stage,"z"),id);break;
            case "price":var prices=C.World("m4_prices")as JsonObject??new();prices[S(stage,"item")]=new JsonObject{["factor"]=N(stage,"factor",1),["event"]=id};C.SetWorld("m4_prices",prices);break;
            case "close":var closed=C.World("m4_closed")as JsonObject??new();closed[S(stage,"place",S(ev,"place"))]=id;C.SetWorld("m4_closed",closed);break;
            case "open":var opened=C.World("m4_closed")as JsonObject??new();opened.Remove(S(stage,"place",S(ev,"place")));C.SetWorld("m4_closed",opened);break;
            case "weather":if(V(C.World("m4_weather_day"))!=Day&&S(stage,"text")is "clear"or"mist"or"fog"or"rain"or"storm"){host.Clock.SetWeather(S(stage,"text"),N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60);C.SetWorld("m4_weather_day",Day);}break;
            case "notice":C.SetWorld("native_notice",new{eventId=id,text=S(stage,"text"),at=Minute});break;
            case "rumour":foreach(var person in C.Rows("SELECT id FROM npc ORDER BY id LIMIT 10"))host.Trade.Remember(1,S(person,"id"),S(stage,"text",S(ev,"rumour")),4);break;
            case "job":PostJob(ev,stage);break;
            case "talk":var participants=A(JsonNode.Parse(S(Row(id),"people_json","[]"))).Take(2).ToArray();if(participants.Length==2)host.Publish("convo",new(){["id"]=id,["a"]=participants[0]!.DeepClone(),["b"]=participants[1]!.DeepClone(),["lines"]=new JsonArray(new JsonObject{["who"]=participants[0]!.DeepClone(),["text"]=S(stage,"text","Well, that is something to see.")},new JsonObject{["who"]=participants[1]!.DeepClone(),["text"]="There will be talk of it on the quay."})});break;
            case "scuffle":case "robbery":var people=A(JsonNode.Parse(S(Row(id),"people_json","[]")));stage["scene"]=new JsonObject{["kind"]=S(stage,"op"),["a"]=people.FirstOrDefault()?.DeepClone(),["b"]=people.Skip(1).FirstOrDefault()?.DeepClone(),["x"]=N(stage,"x"),["z"]=N(stage,"z"),["started"]=Minute};var stages=A(JsonNode.Parse(S(Row(id),"stages_json","[]")));stages[index]=stage.DeepClone();SaveStages(id,stages);break;
        }host.Publish("events");
    }
    public void PostJob(JsonObject ev,JsonObject stage,string employer="sooi",int? player=null)
    {
        var def=C.Rules["employers"]?[employer];if(def==null)return;var area=A(def["area"]);string from=area.FirstOrDefault(a=>a?.GetValue<string>()!=S(def,"door"))?.GetValue<string>()??S(def,"door");string to=S(def,"door");var task=new JsonObject{["kind"]="carry",["goods"]=S(stage,"item","sacks"),["from"]=from,["to"]=to,["count"]=2,["cart"]=false,["twist"]="none",["progress"]=new JsonObject{["delivered"]=0,["lost"]=0,["sold"]=0}};string title="Extra hands: "+S(ev,"title");C.Execute("INSERT INTO job(day,title,employer_npc,district,task_type,pay_c,risk,tier,required_faction,pitch,task_json,source,status) VALUES($p0,$p1,$p2,'rijnkaai','carry',$p3,'low',0,$p4,$p5,$p6,'event','offered')",Day,title,employer,S(ev,"template")=="hiring"?150:70,S(def,"faction"),S(stage,"text","Paid work at the quay."),task.ToJsonString());host.PublishState(player??1);
    }
    public void Finish(int id,string status="done")
    {
        var ev=Row(id);if(ev==null||S(ev,"status")is "done"or"cancelled")return;EventEnded?.Invoke(ev,status);foreach(var row in actions.Active().Where(a=>N(a,"event_id",-1)==id))actions.End((int)N(row,"id"),"done","event ended");foreach(string key in new[]{"m4_prices","m4_closed"}){var state=C.World(key)as JsonObject??new();foreach(var item in state.ToArray())if(key=="m4_closed"?V(item.Value)==id:N(item.Value,"event")==id)state.Remove(item.Key);C.SetWorld(key,state);}C.Execute("UPDATE town_event SET status=$p0 WHERE id=$p1",status,id);WriteEvent(ev,status=="done"?"ended":"cancelled",S(ev,"title")+(status=="done"?" ended.":" was called off."),status=="done"?4:2);host.Publish("events");
    }
    public void Tick(bool think=true)
    {
        foreach(var row in Live()){int id=(int)N(row,"id");if(Minute<N(row,"start_m"))continue;var stages=A(JsonNode.Parse(S(row,"stages_json","[]")));int index=0,end=(int)N(row,"start_m");while(index<stages.Count&&Minute>=end+N(stages[index],"minutes")){end+=(int)N(stages[index],"minutes");index++;}int old=(int)N(row,"stage",-1);for(int i=old+1;i<Math.Min(index+1,stages.Count);i++){if(i==0)WriteEvent(row!.AsObject(),"started",S(row,"title")+" began at "+S(stages[0],"label",S(row,"place"))+".",6);C.Execute("UPDATE town_event SET status='running',stage=$p0 WHERE id=$p1",i,id);RunStage(Row(id)!,stages[i]!.AsObject(),i);stages=A(JsonNode.Parse(S(Row(id),"stages_json","[]")));}if(index>=stages.Count)Finish(id);}
        if(!think)return;var state=C.World("director")as JsonObject??new();int hour=(int)N(host.Clock.View(),"hour");if(Minute-N(state,"lastThinkMin",-100000)<30||N(state,"lastHour",-1)==hour&&N(state,"lastDay")==Day)return;state["lastThinkMin"]=Minute;state["lastHour"]=hour;state["lastDay"]=Day;state["thinks"]=N(state,"thinks")+1;C.SetWorld("director",state);if(Day%7!=0&&hour>=5&&hour<7&&C.Scalar<int>("SELECT COUNT(*) FROM town_event WHERE day=$p0 AND template='hiring'",Day)==0){FromTemplate("hiring",Math.Max(0,330-(Minute%1440)));return;}if(hour>=8&&hour<21){if(Director!=null){var model=Director.Invoke(new(){["clock"]=host.Clock.View(),["events"]=List(1),["threads"]=C.Rows("SELECT verb,text FROM log ORDER BY id DESC LIMIT 12")});if(model!=null&&B(Plan(model),"ok"))return;}QueueDirector();}
    }
    public JsonArray List(int player)
    {
        var result=new JsonArray();foreach(var raw in Live()){var e=raw!.DeepClone().AsObject();var stages=A(JsonNode.Parse(S(e,"stages_json","[]")));e["stages"]=stages;e["people"]=JsonNode.Parse(S(e,"people_json","[]"));e["leads"]=JsonNode.Parse(S(e,"leads_json","[]"));e["acts"]=new JsonArray(stages.Select(s=>s?["act"]?.DeepClone()).ToArray());int stage=(int)N(e,"stage",-1);e["scene"]=stage>=0&&stage<stages.Count?stages[stage]?["scene"]?.DeepClone():null;e["stage_left"]=stage<0?0:Math.Max(0,N(e,"start_m")+stages.Take(stage+1).Sum(s=>N(s,"minutes"))-Minute);e["starts_in"]=Math.Max(0,N(e,"start_m")-Minute);e["ends_in"]=Math.Max(0,N(e,"end_m")-Minute);e["fire"]=FireView?.Invoke(raw.AsObject(),player);e["hiring"]=HiringView?.Invoke(raw.AsObject(),player);e.Remove("stages_json");e.Remove("people_json");e.Remove("leads_json");result.Add(e);}return result;
    }
    public void Register(NativeServiceHost service)
    {
        actions.Events=()=>List(1);service.Register("GET","/api/events",r=>new JsonObject{["events"]=List(r.PlayerId),["closed"]=new JsonArray((C.World("m4_closed")as JsonObject??new()).Select(p=>(JsonNode)JsonValue.Create(p.Key)!).ToArray())});service.RegisterAsync("POST","/api/dev/director",DevDirectorAsync);service.NewGame+=()=>generation++;service.Loaded+=()=>generation++;service.TickHooks.Add((r,advanced)=>{if(advanced)Tick();});
        var previousWork=service.Trade.WorkResolver;service.Trade.WorkResolver=npc=>{var r=actions.Resident(npc);string place=S(r?["work"],"place"),shop=S(r?["work"],"shop");var closed=C.World("m4_closed")as JsonObject;if(closed!=null&&(closed.ContainsKey(place)||closed.ContainsKey(shop)))return false;return previousWork?.Invoke(npc)??(r==null?C.Rules["wares"]?[npc]!=null:NativeShops.Activity(r,Day,N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60).act=="work");};
    }
}

