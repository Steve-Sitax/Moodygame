using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace Scheldemist.Native.Services;

/// <summary>Real notable memories shared at home, checked reactions and persistent family visits.</summary>
public sealed partial class NativeFamilies : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeActions actions;
    private NativeServiceContext C=>host.Context;
    private int Minute=>host.Clock.GameMinute();
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    private static string S(JsonNode? n,string key,string fallback="")=>NativeGoods.S(n,key,fallback);
    private static double N(JsonNode? n,string key,double fallback=0)=>NativeGoods.N(n,key,fallback);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static bool B(JsonNode? n,string key)=>NativeGoods.B(n,key);
    private static double D(JsonNode? a,JsonNode? b)=>NativeGoods.Distance(N(a,"x"),N(a,"z"),N(b,"x"),N(b,"z"));
    public Func<int,JsonObject>? SurprisesState;
    public Func<JsonObject,string?>? PoliceDispatch;
    public NativeFamilies(NativeServiceHost host,NativeActions actions)=>(this.host,this.actions)=(host,actions);
    public JsonObject? News(int id)=>C.One("SELECT * FROM family_news WHERE id=$p0",id);
    public JsonArray ListNews(string? status=null)=>status==null?C.Rows("SELECT * FROM family_news ORDER BY id"):C.Rows("SELECT * FROM family_news WHERE status=$p0 ORDER BY id",status);
    private IEnumerable<JsonObject> People=>C.Rows("SELECT data_json FROM resident ORDER BY id").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject());
    private static bool Away(JsonObject? person)=>S(person?["visitor"],"role")=="stranger"&&!B(person?["visitor"],"here");
    private void Patch(int id,JsonObject patch){var keys=patch.Select(p=>p.Key).ToArray();if(keys.Length==0)return;C.Execute("UPDATE family_news SET "+string.Join(",",keys.Select((k,i)=>k+"=$p"+i))+" WHERE id=$p"+keys.Length,patch.Select(p=>p.Value is JsonValue v&&v.TryGetValue<string>(out var s)?(object?)s:p.Value==null?null:(int?)NativeGoods.Number(p.Value)).Append((object?)id).ToArray());}
    public int ScanNews()
    {
        var state=C.World("families")as JsonObject??new JsonObject{["lastMem"]=0,["menaceDay"]=0,["menaces"]=0,["supperDay"]=0};int made=0;var people=People.ToArray();
        foreach(var memory in C.Rows("SELECT id,npc_id,gist,tone,COALESCE(origin,id) AS origin,COALESCE(about_player,1) AS player FROM npc_memory WHERE id>$p0 AND source='seen' AND gist IS NOT NULL AND gist<>'' AND tone<>0 ORDER BY id",(int)N(state,"lastMem"))){
            var teller=people.FirstOrDefault(p=>S(p,"id")==S(memory,"npc_id"));if(teller==null||N(teller,"age")<6||Away(teller)||!Regex.IsMatch(S(memory,"gist"),@"^Jef\b"))continue;
            foreach(var listener in people.Where(p=>N(p,"household")==N(teller,"household")&&S(p,"id")!=S(teller,"id")&&N(p,"age")>=13&&S(p,"trade")!="infant")){if(C.Scalar<int>("SELECT COUNT(*) FROM family_news WHERE listener=$p0 AND origin=$p1",S(listener,"id"),(int)N(memory,"origin"))>0)continue;C.Execute("INSERT INTO family_news(day,minute,teller,listener,memory_id,origin,gist,tone,status,player_id) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,'waiting',$p8)",Day,Minute,S(teller,"id"),S(listener,"id"),(int)N(memory,"id"),(int)N(memory,"origin"),S(memory,"gist"),Math.Clamp((int)N(memory,"tone"),-2,2),(int)N(memory,"player",1));made++;}
        }
        state["lastMem"]=C.Scalar<int>("SELECT COALESCE(MAX(id),0) FROM npc_memory");C.SetWorld("families",state);return made;
    }
    public string? Together(JsonObject a,JsonObject b)
    {
        if(NativeShops.Activity(a,Day,Hour).act=="home"&&NativeShops.Activity(b,Day,Hour).act=="home")return "home";var pa=actions.Position(S(a,"id"));var pb=actions.Position(S(b,"id"));return pa!=null&&pb!=null&&!B(pa,"indoors")&&!B(pb,"indoors")&&D(pa,pb)<=12?"street":null;
    }
    private string? Agent(JsonObject at)=>PoliceDispatch?.Invoke(at)??People.Where(r=>S(r,"trade")is "police"or"water_bailiff"&&host.Trade.AtWork(S(r,"id"))&&actions.Of(S(r,"id"))==null).OrderBy(r=>D(actions.Position(S(r,"id")),at)).Select(r=>S(r,"id")).FirstOrDefault();
    private void WarnOthers(JsonObject person,JsonObject news)
    {
        int told=0;foreach(string id in host.Rumours.CircleOf(S(person,"id"))){if(told>=3)break;var other=actions.Resident(id);if(other!=null&&(N(other,"household")==N(person,"household")||Away(other)))continue;if(C.Scalar<int>("SELECT COUNT(*) FROM npc_memory WHERE npc_id=$p0 AND (origin=$p1 OR id=$p1)",id,(int)N(news,"origin"))>0)continue;C.Execute("INSERT INTO npc_memory(npc_id,text,source,heard_from,weight,day,spread,gist,tone,origin,town_spread,about_player) VALUES($p0,$p1,'heard',$p2,5,$p3,1,$p4,$p5,$p6,0,$p7)",id,S(person,"name")+" told me: "+S(news,"gist"),S(person,"id"),Day,S(news,"gist"),(int)N(news,"tone"),(int)N(news,"origin"),(int)N(news,"player_id",1));told++;}Fact("rumour",N(news,"tone")<0?"warned_others":"praised",S(person,"id"),null,S(person,"name")+" told "+told+" neighbours about Jef: "+S(news,"gist"),3);
    }
    private void ApplyDecision(JsonObject news,JsonObject listener,JsonObject decision,string opening)
    {
        string reaction=S(decision,"reaction");int id=(int)N(news,"id");if(reaction is "none"or"warn_others"){if(reaction=="warn_others")WarnOthers(listener,news);Patch(id,new(){["status"]="done",["reaction"]=reaction,["source"]=S(decision,"source"),["outcome"]=reaction=="none"?"let it be":"told neighbours"});return;}
        Patch(id,new(){["status"]="pending",["reaction"]=reaction,["amount_c"]=N(decision,"amount_c"),["opening"]=opening,["source"]=S(decision,"source"),["not_before"]=Minute+20});
    }
    public JsonObject? ShareEngine(int id,string? where=null,bool shown=false,JsonObject? proposal=null)
    {
        var n=News(id);if(n==null||S(n,"status")!="waiting")return null;var a=actions.Resident(S(n,"teller"));var b=actions.Resident(S(n,"listener"));if(a==null||b==null){Patch(id,new(){["status"]="lapsed",["outcome"]="nobody"});return null;}Patch(id,new(){["status"]="heard"});int player=(int)N(n,"player_id",1);bool already=C.Scalar<int>("SELECT COUNT(*) FROM npc_memory WHERE npc_id=$p0 AND (origin=$p1 OR id=$p1)",S(b,"id"),(int)N(n,"origin"))>0;string kin=KinWord(b,a);
        C.Execute("INSERT INTO npc_memory(npc_id,text,source,heard_from,weight,day,spread,gist,tone,origin,town_spread,about_player) VALUES($p0,$p1,'heard',$p2,$p3,$p4,1,$p5,$p6,$p7,$p8,$p9)",S(b,"id"),kin+" told me: "+S(n,"gist"),S(a,"id"),Math.Clamp(C.Scalar<int>("SELECT weight FROM npc_memory WHERE id=$p0",(int)N(n,"memory_id")),2,10),Day,S(n,"gist"),(int)N(n,"tone"),(int)N(n,"origin"),already?1:0,player);
        var decision=Decide(player,b,n,proposal);string reaction=S(decision,"reaction");var lines=new JsonArray(new JsonObject{["who"]=S(a,"id"),["name"]=S(a,"first"),["text"]="Listen to what happened: "+S(n,"gist")},new JsonObject{["who"]=S(b,"id"),["name"]=S(b,"first"),["text"]=reaction=="none"?"Well. Let it be.":"I will have a word about that."});if(proposal!=null&&decision["refused"]==null){var modelLines=A(proposal["lines"]);if(modelLines.Count is >=2 and <=4&&modelLines.All(line=>S(line,"speaker")is "A"or"B"&&Clean(S(line,"text"),140)))lines=new JsonArray(modelLines.Select(line=>(JsonNode)new JsonObject{["who"]=S(S(line,"speaker")=="A"?a:b,"id"),["name"]=S(S(line,"speaker")=="A"?a:b,"first"),["text"]=S(line,"text")}).ToArray());}ApplyDecision(n,b,decision,proposal!=null&&decision["refused"]==null&&Clean(S(proposal,"opening_line"),200)?S(proposal,"opening_line"):"");int eid=Fact("talk","family_share",S(a,"id"),S(b,"id"),S(a,"name")+" told "+S(b,"name")+" at "+(where??Together(a,b)??"home")+": "+S(n,"gist"),Math.Abs(N(n,"tone"))>=2?5:4,new(){["news"]=id,["lines"]=lines.DeepClone(),["source"]=S(decision,"source")},reaction);if(shown)host.Publish("convo",new(){["id"]=eid,["a"]=S(a,"id"),["b"]=S(b,"id"),["purpose"]="share",["lines"]=lines,[ "source"]=S(decision,"source"),["outcome"]=reaction});return new(){["news"]=id,["where"]=where??"home",["shown"]=shown,["decision"]=decision};
    }
    public JsonObject StartSeek(int player,string npc,string reaction,int? news=null,string reason="")=>actions.Start(new(){["npc_id"]=npc,["kind"]="seek",["target"]="Jef",["source"]="engine",["minutes"]=50,["max_m"]=60,["reason"]=reason,["data"]=new JsonObject{["reaction"]=reaction,["news"]=news,["player"]=player}},player);
    public int? StartReaction(int id)
    {
        var n=News(id);if(n==null||S(n,"status")!="pending"||Minute<N(n,"not_before"))return null;if(Minute-N(n,"not_before")>600){Patch(id,new(){["status"]="lapsed",["outcome"]="the moment passed"});return null;}var b=actions.Resident(S(n,"listener"));if(b==null||Away(b)||actions.Of(S(b,"id"))!=null||actions.Reserved?.Invoke(S(b,"id"))==true)return null;string reaction=S(n,"reaction");bool menace=reaction is "mug"or"knock_down";if(menace?Hour<7||Hour>=23:Hour<7||Hour>=21)return null;int player=(int)N(n,"player_id",1);
        if(reaction=="call_police"){string? agent=Agent(actions.Position(S(b,"id"))!);if(agent==null)return null;var at=actions.Position(agent)!;var row=actions.Start(new(){["npc_id"]=S(b,"id"),["kind"]="fetch_police",["target"]=agent,["target_x"]=N(at,"x"),["target_z"]=N(at,"z"),["source"]="engine",["minutes"]=40,["reason"]="a complaint about Jef",["data"]=new JsonObject{["complaint"]=id,["about"]="complaint: "+S(n,"gist"),["jef"]=actions.PlayerPosition(player)?.DeepClone()}},player);Patch(id,new(){["status"]="acting",["action_id"]=N(row,"id")});return(int)N(row,"id");}
        var jef=actions.PlayerPosition(player);if(jef==null||D(jef,actions.Position(S(b,"id")))>350)return null;var seeks=actions.Active().Where(a=>S(a,"kind")=="seek"&&N(a,"for_player",1)==player).ToArray();if(seeks.Length>=2)return null;var count=C.PlayerState(player,"menaces");if(menace&&(N(count,"day")==Day&&N(count,"n")>=1||seeks.Any(a=>S(Data(a),"reaction")is "mug"or"knock_down")))return null;var seek=StartSeek(player,S(b,"id"),reaction,id,"a word about family news");if(menace)C.SetPlayerState(player,"menaces",new JsonObject{["day"]=Day,["n"]=N(count,"day")==Day?N(count,"n")+1:1});Patch(id,new(){["status"]="acting",["action_id"]=N(seek,"id")});return(int)N(seek,"id");
    }
    private int Fact(string kind,string verb,string? actor,string? target,string text,int weight,JsonObject? data=null,string? outcome=null)
    {
        if(text.Length>300)text=text[..300];C.Execute("INSERT INTO world_event(day,hour,minute,kind,verb,actor,target,text,weight,data_json,outcome) SELECT day,hour,minute,$p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7 FROM player WHERE id=1",kind,verb,actor,target,text,weight,(data??new JsonObject()).ToJsonString(),outcome);int id=C.Scalar<int>("SELECT last_insert_rowid()");foreach(string who in new[]{actor,target}.OfType<string>().Where(s=>s!=""&&C.Scalar<int>("SELECT COUNT(*) FROM npc WHERE id=$p0",s)>0).Distinct())C.Execute("INSERT OR IGNORE INTO world_event_who(event_id,who) VALUES($p0,$p1)",id,who);return id;
    }
    public void Tick()
    {
        ScanNews();foreach(var n in ListNews("waiting").OfType<JsonObject>().ToArray()){if(Minute-N(n,"minute")>1440){Patch((int)N(n,"id"),new(){["status"]="lapsed",["outcome"]="never told"});continue;}if(Minute-N(n,"minute")<15||N(n,"action_id")==-1)continue;var a=actions.Resident(S(n,"teller"));var b=actions.Resident(S(n,"listener"));if(a==null||b==null)continue;string? where=Together(a,b);if(where==null)continue;var jef=actions.PlayerPosition((int)N(n,"player_id",1));var pa=actions.Position(S(a,"id"));if(where=="street"&&jef!=null&&pa!=null&&!B(pa,"indoors")&&D(pa,jef)<=45){if(actions.Of(S(a,"id"))!=null||actions.Of(S(b,"id"))!=null||actions.Reserved?.Invoke(S(a,"id"))==true)continue;var pb=actions.Position(S(b,"id"))!;actions.Start(new(){["npc_id"]=S(a,"id"),["kind"]="talk_to",["target"]=S(b,"id"),["target_x"]=N(pb,"x"),["target_z"]=N(pb,"z"),["source"]="engine",["minutes"]=40,["reason"]="family news",["data"]=new JsonObject{["purpose"]="share",["news"]=N(n,"id")}},(int)N(n,"player_id",1));Patch((int)N(n,"id"),new(){["action_id"]=-1});continue;}QueueShare(n,where);}
        foreach(var n in ListNews("pending").OfType<JsonObject>().ToArray())StartReaction((int)N(n,"id"));
    }
    public static JsonObject PublicVisitor(JsonObject p)=>new(){["id"]=S(p,"id"),["name"]=S(p,"name"),["first"]=S(p,"first"),["label"]=S(p["visitor"],"label"),["here"]=B(p["visitor"],"here"),["role"]=S(p["visitor"],"role"),["sched"]=p["sched"]?.DeepClone(),["at"]=p["work"]?["at"]?.DeepClone()};
    public JsonObject State(int player){var state=SurprisesState?.Invoke(player)??new JsonObject{["fortune"]=People.FirstOrDefault(p=>S(p,"id")=="fortune")is {} f?new JsonObject{["id"]="fortune",["at"]=f["work"]?["at"]?.DeepClone()}:null,["visitors"]=new JsonArray(People.Where(p=>S(p["visitor"],"role")=="stranger").Select(p=>(JsonNode)PublicVisitor(p)).ToArray()),["dream"]=C.PlayerState(player,"dream")?.DeepClone(),["schemes"]=C.Rows("SELECT id,kind,a,b,hour,status,outcome FROM town_scheme WHERE day=$p0 ORDER BY id",Day)};state["menace"]=MenaceNow(player);state["visit"]=VisitNow(player);return state;}
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/families/state",r=>State(r.PlayerId));service.Register("POST","/api/families/menace/:id",r=>{string how=r.Text("how");if(how is not("ran"or"pay"or"stand"))throw new NativeServiceException("how must be ran, pay or stand");return NativeCoreClock.Join(new JsonObject{["result"]=ResolveMenace(r.PlayerId,int.Parse(r.Param("id")),how)},host.Payload(r.PlayerId));});service.RegisterAsync("POST","/api/families/menace/:id/talk",TalkDownAsync);service.RegisterAsync("POST","/api/dev/families",DevAsync);
        var previousTalk=actions.Reports.GetValueOrDefault("talk_to");actions.Reports["talk_to"]=(request,row)=>{var data=Data(row);if(S(data,"purpose")!="share")return previousTalk?.Invoke(request,row);int news=(int)N(data,"news");if(request.Text("phase")=="arrived"){Patch(news,new(){["action_id"]=null});actions.End((int)N(row,"id"),"done","told family news");if(News(news)is {} n)QueueShare(n,"street",true);}else if(request.Text("phase")is "blocked"or"lost"){Patch(news,new(){["action_id"]=null});actions.End((int)N(row,"id"),"done","time");}return actions.Row((int)N(row,"id"));};
        actions.TimeUpHandlers.Add(row=>{var data=Data(row);if(S(row,"kind")!="talk_to"||S(data,"purpose")!="share")return false;Patch((int)N(data,"news"),new(){["action_id"]=null});actions.End((int)N(row,"id"),"done","time");return true;});
        actions.Reports["seek"]=SeekReport;actions.TimeUpHandlers.Add(row=>{if(S(row,"kind")!="seek")return false;int player=(int)N(row,"for_player",1);if(S(row,"phase")=="menace")ResolveMenace(player,(int)N(row,"id"),"time");else EndVisit(row,"time");return true;});
        actions.EndHooks.Add((row,status)=>{var data=Data(row);if(S(row,"kind")=="seek"&&data["news"]!=null)Patch((int)N(data,"news"),new(){["status"]="done",["outcome"]=S(actions.Row((int)N(row,"id")),"outcome")});});service.TickHooks.Add((request,advanced)=>{if(advanced)Tick();});service.NewGame+=()=>{generation++;pendingShares.Clear();};service.Loaded+=()=>{generation++;pendingShares.Clear();};
    }
}
