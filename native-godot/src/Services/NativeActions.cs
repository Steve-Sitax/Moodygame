using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Authoritative resident actions and report chains, stored in the original npc_action table.</summary>
public sealed class NativeActions : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeGoods goods;
    private NativeServiceContext C=>host.Context;
    public JsonObject Data {get;}
    public readonly Dictionary<string,Func<int,JsonObject,JsonObject,JsonObject?>> Proposals=new();
    public readonly List<Func<JsonObject,bool>> TimeUpHandlers=new();
    public readonly Dictionary<string,Func<NativeServiceRequest,JsonObject,JsonObject?>> Reports=new();
    public readonly List<Action<JsonObject,string>> EndHooks=new();
    public Func<double,double,double,JsonObject?>? NearestOpen;
    public Func<string,bool>? Reserved;
    public Func<JsonObject,JsonObject?>? Conversation;
    public Func<JsonArray>? Conversations;
    public Func<string,int?>? Walker;
    private readonly Dictionary<string,(double x,double z,long at)> people=new();
    private readonly Dictionary<int,(double x,double z,long at)> players=new();
    private int Minute=>host.Clock.MinuteNow()-1440;
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    private static double N(JsonNode? n,string k,double f=0)=>NativeGoods.N(n,k,f);
    private static string S(JsonNode? n,string k,string f="")=>NativeGoods.S(n,k,f);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static double V(JsonNode? n)=>NativeGoods.Number(n);
    private static bool B(JsonNode? n,string k)=>NativeGoods.B(n,k);
    private static double D(JsonNode? a,JsonNode? b)=>NativeGoods.Distance(N(a,"x"),N(a,"z"),N(b,"x"),N(b,"z"));
    private static string Norm(string s)=>Regex.Replace(Regex.Replace(s.ToLowerInvariant(),@"^(the|a|an|agent|old|young|mister|missus|mr|mrs)\s+",""),@"[^a-z\s'-]","").Trim();
    private static JsonObject? Point(JsonNode? n)=>double.IsFinite(N(n,"x",double.NaN))&&double.IsFinite(N(n,"z",double.NaN))?new JsonObject{["x"]=Math.Clamp(N(n,"x"),-2000,2000),["z"]=Math.Clamp(N(n,"z"),-2000,2000)}:null;
    public NativeActions(NativeServiceHost host,NativeGoods goods){this.host=host;this.goods=goods;Data=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-director.json")))!.AsObject();}
    public JsonObject? Resident(string id){var row=C.One("SELECT data_json FROM resident WHERE id=$p0",id);return row==null?null:JsonNode.Parse(S(row,"data_json"))!.AsObject();}
    public JsonObject? PlayerPosition(int player)=>players.TryGetValue(player,out var p)&&C.Now-p.at<15000?new JsonObject{["x"]=p.x,["z"]=p.z}:null;
    public JsonArray PeopleNear(double x,double z,double radius)=>new(people.Where(p=>C.Now-p.Value.at<15000&&NativeGoods.Distance(x,z,p.Value.x,p.Value.z)<=radius).Select(p=>(JsonNode)new JsonObject{["id"]=p.Key,["d"]=NativeGoods.Distance(x,z,p.Value.x,p.Value.z)}).ToArray());
    public JsonArray CallGang(int player,string reference,JsonObject at,int members=3)
    {
        var existing=Active().Where(a=>S(a,"kind")=="come"&&S(JsonNode.Parse(S(a,"data_json","{}")),"ref").StartsWith(reference+":",StringComparison.Ordinal)).ToArray();if(existing.Length>0)return new JsonArray(existing.Select(a=>a!["npc_id"]!.DeepClone()).ToArray());var ids=new JsonArray();var candidates=C.Rows("SELECT data_json FROM resident WHERE trade='thief'").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject()).Where(r=>Of(S(r,"id"))==null&&Reserved?.Invoke(S(r,"id"))!=true&&NativeShops.Activity(r,Day,Hour).act is not("home"or"church")).Select(r=>(r,at:Position(S(r,"id"))!)).Where(c=>!B(c.at,"indoors")&&D(c.at,at)<=220).OrderBy(c=>D(c.at,at)).Take(Math.Clamp(members,1,6)).ToArray();foreach(var c in candidates){string id=S(c.r,"id");Start(new(){["npc_id"]=id,["kind"]="come",["target"]="Jef",["target_x"]=N(at,"x"),["target_z"]=N(at,"z"),["minutes"]=WalkMinutes(D(c.at,at))+30,["source"]="engine",["reason"]="a purse in a dark street",["data"]=new JsonObject{["ref"]=reference+":"+ids.Count,["role"]="gang",["why"]="gang",["reaction"]="gang"}},player);ids.Add(id);}return ids;
    }
    public int EndCallsFor(string prefix){int count=0;foreach(var row in Active().Where(a=>S(a,"kind")=="come"&&S(JsonNode.Parse(S(a,"data_json","{}")),"ref").StartsWith(prefix,StringComparison.Ordinal))){End((int)N(row,"id"),"done","job over");count++;}return count;}
    public JsonObject? Position(string id)
    {
        if(people.TryGetValue(id,out var known)&&C.Now-known.at<15000)return new(){["x"]=known.x,["z"]=known.z,["indoors"]=false};var r=Resident(id);if(r==null)return null;var act=NativeShops.Activity(r,Day,Hour);var work=r["work"];var home=r["home"];var places=C.World("town")?["places"];var result=new JsonObject{["x"]=N(home,"sx"),["z"]=N(home,"sz"),["indoors"]=true};
        if(act.act=="home")return result;if(act.act=="church")return new(){["x"]=-262,["z"]=149.5,["indoors"]=true};if(act.act=="work"){if(S(work,"kind")=="inside"){var door=A(work?["door"]);if(door.Count>=2){result["x"]=V(door[0]);result["z"]=V(door[1]);}return result;}var at=A(work?["at"]??work?["a"]??A(work?["route"]).FirstOrDefault());if(at.Count>=2)return new(){["x"]=V(at[0]),["z"]=V(at[1]),["indoors"]=false};}var pl=places?[act.act=="work"?S(work,"place"):act.place]??places?[S(work,"place")];if(pl==null)return result;var step=A(pl["door"]);return new(){["x"]=step.Count>=2?V(step[0]):N(pl,"x"),["z"]=step.Count>=2?V(step[1]):N(pl,"z"),["indoors"]=false};
    }
    public JsonObject? FindPerson(string words,JsonObject? near=null)
    {
        if(Resident(words)is {} direct)return direct;string n=Norm(words);if(n=="")return null;var all=C.Rows("SELECT data_json FROM resident WHERE trade!='infant'").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject()).ToArray();var found=all.Where(r=>Norm(S(r,"name"))==n).ToArray();if(found.Length==0)found=all.Where(r=>Norm(S(r,"first"))==n||Norm(S(r,"surname"))==n).ToArray();if(found.Length==0&&n.Length>=4)found=all.Where(r=>Norm(S(r,"name")).Contains(n,StringComparison.Ordinal)).ToArray();return near==null?found.FirstOrDefault():found.OrderBy(r=>D(Position(S(r,"id")),near)).FirstOrDefault();
    }
    public JsonObject? FindPlace(string words)
    {
        string n=Norm(words);if(n=="")return null;var places=C.World("town")?["places"]as JsonObject??new();var hits=new List<JsonObject>();foreach(var pair in places){var p=pair.Value;var door=A(p?["door"]);hits.Add(new(){["id"]=pair.Key,["label"]=S(p,"label",pair.Key),["x"]=door.Count>=2?V(door[0]):N(p,"x"),["z"]=door.Count>=2?V(door[1]):N(p,"z")});}foreach(var pair in DataSpots()){if(pair.Key.StartsWith("_"))continue;var p=pair.Value;hits.Add(new(){["id"]=pair.Key,["label"]=S(p,"label",pair.Key),["x"]=N(p,"x"),["z"]=N(p,"z")});}hits.Add(new(){["id"]="cathedral_west",["label"]="the west door of the cathedral",["x"]=-262,["z"]=149.5});return hits.FirstOrDefault(h=>S(h,"id")==words||S(h,"id")==n.Replace(' ','_'))??hits.FirstOrDefault(h=>Norm(S(h,"label"))==n)??hits.FirstOrDefault(h=>Norm(S(h,"label")).Contains(n,StringComparison.Ordinal));
    }
    private JsonObject DataSpots()=>goods.Data["spots"]!.AsObject();
    public JsonObject? Row(int id)=>C.One("SELECT * FROM npc_action WHERE id=$p0",id);
    public JsonObject? Of(string id)=>C.One("SELECT * FROM npc_action WHERE npc_id=$p0 AND status='active' ORDER BY id DESC LIMIT 1",id);
    public JsonArray Active()=>C.Rows("SELECT * FROM npc_action WHERE status='active' ORDER BY id");
    public JsonArray List()
    {
        var list=new JsonArray();foreach(var n in Active()){var a=n!.DeepClone().AsObject();var data=JsonNode.Parse(S(a,"data_json","{}"))!.AsObject();a["npc"]=a["npc_id"]!.DeepClone();a["name"]=S(Resident(S(a,"npc_id")),"name",S(a,"npc_id"));a["target_name"]=Resident(S(a,"target"))?["name"]?.DeepClone();a["minutes_left"]=Math.Max(0,N(a,"until")-Minute);a["order"]=data["order"]?.DeepClone()??JsonValue.Create(0);a["n"]=data["n"]?.DeepClone()??JsonValue.Create(0);foreach(string key in new[]{"role","lead","reaction"})a[key]=data[key]?.DeepClone();a.Remove("data_json");list.Add(a);}return list;
    }
    public JsonObject Start(JsonObject spec,int? player=null)
    {
        string npc=S(spec,"npc_id"),kind=S(spec,"kind"),source=S(spec,"source","engine");if(Resident(npc)==null)throw new NativeServiceException("no such resident",404);if(Of(npc)!=null)throw new NativeServiceException("they are busy",409);var at=Position(npc);C.Execute("INSERT INTO npc_action(npc_id,kind,target,target_x,target_z,reason,source,event_id,status,started,until,max_m,phase,x,z,data_json,for_player) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,'active',$p8,$p9,$p10,$p11,$p12,$p13,$p14,$p15)",npc,kind,S(spec,"target"),spec["target_x"]==null?null:N(spec,"target_x"),spec["target_z"]==null?null:N(spec,"target_z"),S(spec,"reason")[..Math.Min(120,S(spec,"reason").Length)],source,spec["event_id"]==null?null:(int)N(spec,"event_id"),Minute,Minute+(int)N(spec,"minutes",40),(int)N(spec,"max_m"),S(spec,"phase","going"),at?["x"]==null?null:N(at,"x"),at?["z"]==null?null:N(at,"z"),(spec["data"]??new JsonObject()).ToJsonString(),player);int id=C.Scalar<int>("SELECT last_insert_rowid()");C.Log(player??1,"action_"+kind,npc,S(Resident(npc),"name")+" began "+kind+".",npc);host.Publish("actions");return Row(id)!;
    }
    public JsonObject? End(int id,string status,string outcome,string line="")
    {
        var row=Row(id);if(row==null||S(row,"status")!="active")return row;C.Execute("UPDATE npc_action SET status=$p0,outcome=$p1,phase='ended' WHERE id=$p2 AND status='active'",status,outcome,id);int player=(int)N(row,"for_player",1);host.Trade.Remember(player,S(row,"npc_id"),"I tried to help Jef: "+outcome+".",status=="done"?3:2);foreach(var hook in EndHooks)hook(row,status);C.Log(player,"action_end",S(row,"npc_id"),S(Resident(S(row,"npc_id")),"name")+" ended "+S(row,"kind")+": "+outcome+".",S(row,"npc_id"));host.Publish("actions");if(line!="")host.Publish("convo",new(){["id"]=id,["a"]=S(row,"npc_id"),["lines"]=new JsonArray(new JsonObject{["who"]=S(row,"npc_id"),["text"]=line}),["at"]=Minute});return Row(id);
    }
    private JsonObject Refusal(string kind,string? line=null)=>new(){["line"]=line??S(Data["refusals"],kind,"I cannot do that."),["action_id"]=null,["refused"]=kind};
    private JsonObject? Open(double x,double z,double distance=3)=>NearestOpen==null?new JsonObject{["x"]=x,["z"]=z}:NearestOpen(x,z,distance);
    public JsonObject Apply(int player,string id,JsonObject proposal)
    {
        var r=Resident(id)??throw new NativeServiceException("no such resident",404);string kind=S(proposal,"kind"),target=S(proposal,"target"),reason=S(proposal,"reason");if(kind=="none"||kind=="")return new(){["action_id"]=null,["refused"]=null,["line"]=""};if(Proposals.TryGetValue(kind,out var hook)&&hook(player,r,proposal)is {} own)return own;var existing=Of(id);if(kind=="stop"){if(existing==null||S(existing,"source")!="talk")return Refusal("nothing_to_stop");if(N(existing,"for_player",1)!=player)return Refusal("busy");End((int)N(existing,"id"),"stopped","asked to stop","All right. I am off.");return new(){["action_id"]=null,["refused"]=null,["line"]="All right. I am off."};}if(kind=="give")return Refusal("no_money");if(existing!=null)return Refusal(S(existing,"source")=="talk"?"busy":"reserved");if(Active().Count(a=>S(a,"source")=="talk"&&N(a,"for_player",1)==player)>=3)return Refusal("too_many");if(Reserved?.Invoke(id)==true)return Refusal("reserved");if(C.Rules["employers"]?[id]!=null||S(r["work"],"kind")=="guard")return Refusal("post");if(S(r["work"],"kind")is "stall"or"shop"or"tavern"&&host.Trade.AtWork(id))return Refusal("at_stall");bool police=S(r,"trade")is "police"or"water_bailiff";if(N(r,"age")<13&&kind is "talk_to"or"fetch_police"or"look_for")return Refusal("child");if(kind=="follow"&&C.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1",id,player)<2&&N(r["stats"],"warmth")<6&&!(police&&Regex.IsMatch(reason,"rob|thie|stol|pick|purse|pocket",RegexOptions.IgnoreCase)))return Refusal("no_trust");if((Hour>=20||Hour<6)&&N(r["stats"],"courage")<=3&&N(r,"age")>=13)return Refusal("dark");
        var jef=PlayerPosition(player);var mine=people.TryGetValue(id,out var known)&&C.Now-known.at<15000?new JsonObject{["x"]=known.x,["z"]=known.z}:jef??Position(id)!;var spec=new JsonObject{["npc_id"]=id,["kind"]=kind,["target"]=target,["reason"]=reason,["source"]="talk",["data"]=new JsonObject()};string line;
        switch(kind){case "follow":int max=police?120:N(r,"age")<13?45:90;spec["minutes"]=N(proposal,"minutes")>0?Math.Clamp((int)N(proposal,"minutes"),40,max):max;spec["max_m"]=40;spec["target"]="Jef";if(jef!=null)spec["data"]!["jef"]=jef.DeepClone();line="Lead on. I can spare you a little time.";break;
            case "wait":spec["minutes"]=Math.Clamp((int)N(proposal,"minutes",60),15,60);spec["target"]="here";spec["target_x"]=mine["x"]!.DeepClone();spec["target_z"]=mine["z"]!.DeepClone();line="I will wait. Then I am off.";break;
            case "go_to":var place=FindPlace(target);if(place==null)return Refusal("unknown_place");var to=Open(N(place,"x"),N(place,"z"));if(to==null)return Refusal("no_way");double dist=D(to,mine);if(dist>400)return Refusal("too_far");spec["minutes"]=WalkMinutes(dist);spec["target"]=place["label"]!.DeepClone();spec["target_x"]=to["x"]!.DeepClone();spec["target_z"]=to["z"]!.DeepClone();if(police)spec["data"]!["then"]=new JsonObject{["kind"]="look_for",["minutes"]=30,["target"]="",["data"]=new JsonObject{["purpose"]="question",["about"]=reason}};line="I will go. Do not make me wait there all day.";break;
            case "talk_to":case "look_for":var who=FindPerson(target,jef??mine);if(who==null||S(who,"id")==id)return Refusal("unknown_person");var at=Position(S(who,"id"))!;if(B(at,"indoors"))return Refusal("indoors");if(kind=="talk_to"&&D(at,mine)>150)return Refusal("too_far");var dest=kind=="talk_to"?Open(N(at,"x"),N(at,"z")):jef??mine;if(dest==null)return Refusal("no_way");spec["minutes"]=40;spec["target"]=who["id"]!.DeepClone();spec["target_x"]=dest["x"]!.DeepClone();spec["target_z"]=dest["z"]!.DeepClone();spec["max_m"]=kind=="look_for"?40:0;spec["data"]!["purpose"]=police?"question":"chat";spec["data"]!["about"]=reason;line=kind=="talk_to"?"I will go and have a word.":"I will have a look about.";break;
            case "fetch_police":if(police)return Refusal("busy","I am the police. Tell me what happened.");var agent=C.Rows("SELECT data_json FROM resident WHERE trade='police'").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject()).Where(a=>host.Trade.AtWork(S(a,"id"))&&Of(S(a,"id"))==null).OrderBy(a=>D(Position(S(a,"id")),mine)).FirstOrDefault();if(agent==null)return Refusal("unknown_person","There is no agent about. Try the post on the Grote Markt.");var agentAt=Position(S(agent,"id"))!;if(D(agentAt,mine)>400)return Refusal("too_far");spec["target"]=agent["id"]!.DeepClone();spec["target_x"]=agentAt["x"]!.DeepClone();spec["target_z"]=agentAt["z"]!.DeepClone();spec["minutes"]=WalkMinutes(D(agentAt,mine));spec["data"]!["jef"]=(jef??mine).DeepClone();spec["data"]!["about"]=reason;line="I will find an agent. Stay where you are.";break;
            default:return Refusal("unknown_place","I do not know how to do that.");}
        var action=Start(spec,player);return new(){["line"]=line,["action_id"]=action["id"]!.DeepClone(),["refused"]=null};
    }
    public static int WalkMinutes(double metres,int stand=10)=>(int)Math.Floor(metres*1.4/1.5*.5+.5)+stand;
    public JsonObject? Report(NativeServiceRequest r,JsonObject row)
    {
        int? walks=Walker?.Invoke(S(row,"npc_id"));if(walks!=null&&walks!=r.PlayerId&&N(row,"for_player",-1)!=r.PlayerId&&!(walks==0&&r.PlayerId==1))throw new NativeServiceException("not yours to report",409);
        int owner=(int)N(row,"for_player",r.PlayerId);if(row["for_player"]!=null&&owner!=r.PlayerId){var owned=new NativeServiceRequest(C,r.Method,r.Path,owner,r.Body,new(r.Parameters),new(r.Query));return host.ForPlayer(owner,()=>ReportOwned(owned,row));}return ReportOwned(r,row);
    }
    private JsonObject? ReportOwned(NativeServiceRequest r,JsonObject row)
    {
        string phase=r.Text("phase"),kind=S(row,"kind");if(phase is not("arrived"or"lost"or"blocked"or"done"))throw new NativeServiceException("bad phase");if(S(row,"status")!="active")return row;var at=Point(r.Body);if(at!=null)C.Execute("UPDATE npc_action SET x=$p0,z=$p1 WHERE id=$p2",N(at,"x"),N(at,"z"),(int)N(row,"id"));if(Reports.TryGetValue(kind,out var hook)&&hook(r,row)is {} own)return own;int id=(int)N(row,"id");var data=JsonNode.Parse(S(row,"data_json","{}"))!.AsObject();
        if(kind=="follow"){if(phase is "lost"or"blocked")return End(id,"failed",phase,S(Data["endLines"],"follow_"+phase));return Row(id);}if(kind=="wait")return Row(id);if(kind is "attend"or"come"){if(phase=="arrived")C.Execute("UPDATE npc_action SET phase=$p0 WHERE id=$p1",S(row,"phase")=="inside"?"in":"there",id);return Row(id);}if(phase=="blocked")return End(id,"failed","blocked","I cannot get through there.");if(phase is not("arrived"or"done"))return Row(id);
        if(kind=="look_for"){End(id,"done",r.Bool("found")?"found":"not found",r.Bool("found")?"There! That is the one.":"Not a sign. I have looked enough.");if(r.Bool("found")&&Resident(S(row,"target"))is {} found){var targetAt=Position(S(found,"id"))!;Start(new(){["npc_id"]=row["npc_id"]!.DeepClone(),["kind"]="talk_to",["target"]=found["id"]!.DeepClone(),["target_x"]=targetAt["x"]!.DeepClone(),["target_z"]=targetAt["z"]!.DeepClone(),["minutes"]=40,["source"]="engine",["data"]=data.DeepClone()},(int)N(row,"for_player",1));}return Row(id);}
        End(id,"done",kind=="fetch_police"?"fetched":kind=="talk_to"?"talked":"arrived",kind=="go_to"&&data["then"]==null?"Here I am, as you asked.":"");if(kind=="talk_to"){var conversation=Conversation?.Invoke(row);if(conversation!=null)host.Publish("convo",conversation);else host.Publish("convo",new(){["id"]=id,["a"]=S(row,"npc_id"),["b"]=S(row,"target"),["purpose"]=S(data,"purpose","chat"),["lines"]=new JsonArray(new JsonObject{["who"]=S(row,"npc_id"),["text"]="A word, if you please."},new JsonObject{["who"]=S(row,"target"),["text"]="Good day. What is it?"})});}
        if(kind=="fetch_police"){string agent=S(row,"target");var jef=data["jef"]as JsonObject??PlayerPosition(r.PlayerId)??Position(S(row,"npc_id"))!;if(Of(agent)==null)Start(new(){["npc_id"]=agent,["kind"]="go_to",["target"]="where Jef was",["target_x"]=jef["x"]!.DeepClone(),["target_z"]=jef["z"]!.DeepClone(),["minutes"]=WalkMinutes(D(Position(agent),jef),5),["reason"]="fetched for Jef",["source"]="engine",["data"]=new JsonObject{["then"]=new JsonObject{["kind"]="wait",["target"]="Jef",["minutes"]=60}}},r.PlayerId);}
        if(data["then"]is JsonObject next){var spec=next.DeepClone().AsObject();spec["npc_id"]=row["npc_id"]!.DeepClone();spec["source"]="engine";spec["target_x"]??=row["x"]?.DeepClone()??row["target_x"]?.DeepClone();spec["target_z"]??=row["z"]?.DeepClone()??row["target_z"]?.DeepClone();Start(spec,(int)N(row,"for_player",1));}return Row(id);
    }
    private void Tick()
    {
        foreach(var row in Active()){string kind=S(row,"kind");if(kind=="attend"||S(row,"phase")=="talking"||Minute<N(row,"until"))continue;int id=(int)N(row,"id");if(TimeUpHandlers.Any(handler=>handler(row!.AsObject())))continue;if(kind is "go_to"or"talk_to"or"fetch_police"or"seek"or"routine"&&S(row,"source")!="event"&&Minute-N(row,"started")<360){C.Execute("UPDATE npc_action SET until=$p0 WHERE id=$p1",Math.Min(N(row,"started")+360,Minute+10),id);continue;}End(id,kind is "wait"or"go_to"?"done":"failed","time",S(Data["endLines"],kind+"_time"));}
    }
    public void Sync(NativeServiceRequest r)
    {
        var p=Point(r.Body);if(p!=null){players[r.PlayerId]=(N(p,"x"),N(p,"z"),C.Now);p["at"]=C.Now;C.SetPlayerState(r.PlayerId,"native_position",p);}foreach(var stale in people.Where(p=>C.Now-p.Value.at>15000).Select(p=>p.Key).ToArray())people.Remove(stale);foreach(var node in A(r.Body["people"]).Take(60)){string id=S(node,"id");var at=Point(node);if(at!=null&&Resident(id)!=null)people[id]=(N(at,"x"),N(at,"z"),C.Now);}
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/actions",r=>new JsonObject{["actions"]=List(),["convos"]=Conversations?.Invoke()??new JsonArray(),["events"]=Events?.Invoke()??new JsonArray(),["closed"]=new JsonArray((C.World("m4_closed")as JsonObject??new()).Select(p=>(JsonNode)JsonValue.Create(p.Key)!).ToArray())});service.Register("POST","/api/actions/sync",r=>{Sync(r);return new{ok=true};});service.Register("POST","/api/actions/:id/report",r=>{var row=Row(int.Parse(r.Param("id")))??throw new NativeServiceException("no such action",404);return NativeCoreClock.Join(new JsonObject{["action"]=Report(r,row)},host.Payload(r.PlayerId));});service.Register("POST","/api/dev/action",r=>Apply(r.PlayerId,r.Text("npc"),r.Body));service.TickHooks.Add((r,advanced)=>{if(advanced)Tick();});service.NewGame+=()=>{people.Clear();players.Clear();};service.Loaded+=()=>{people.Clear();players.Clear();};
        var previousLift=goods.NpcMayLift;goods.NpcMayLift=(npc,item)=>Of(npc)is JsonObject a&&S(a,"kind")=="routine"&&(JsonNode.Parse(S(a,"data_json","{}"))?["routine"]?["steps"]as JsonArray??new()).Any(step=>S(step,"gid")==S(item,"id")||A(step?["gids"]).Any(g=>g?.GetValue<string>()==S(item,"id")))||previousLift?.Invoke(npc,item)==true;var previousErrand=goods.NpcHasErrand;goods.NpcHasErrand=npc=>Of(npc)!=null||previousErrand?.Invoke(npc)==true;
    }
    public Func<JsonArray>? Events;
}
