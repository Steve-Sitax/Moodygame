using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Persistent theft, witnesses, returning assets, confrontations and police consequences.</summary>
public sealed partial class NativeDeeds : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeTransport transport;
    public JsonObject Data { get; }
    private NativeServiceContext C=>host.Context;
    private static double N(JsonNode? n,string key,double fallback=0)=>NativeGoods.N(n,key,fallback);
    private static string S(JsonNode? n,string key,string fallback="")=>NativeGoods.S(n,key,fallback);
    private static bool B(JsonNode? n,string key)=>NativeGoods.B(n,key);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static double V(JsonNode? n)=>NativeGoods.Number(n);
    private static bool Finite(params double[] values)=>values.All(v=>double.IsFinite(v)&&Math.Abs(v)<5000);
    private static double Distance(double x,double z,JsonNode? n)=>NativeGoods.Distance(x,z,N(n,"x"),N(n,"z"));
    private static void Refuse(string text,int status=409)=>throw new NativeServiceException(text,status);
    private int Minute=>host.Clock.MinuteNow()-1440;
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    private JsonNode? State(int player,string key)=>C.PlayerState(player,key)??(player==1?C.World(key):null);
    private JsonArray Confronts(int player)=>A(State(player,"confronts"));
    private void SaveConfronts(int player,IEnumerable<JsonNode?> list)=>C.SetPlayerState(player,"confronts",new JsonArray(list.Select(n=>n?.DeepClone()).ToArray()));
    private JsonObject? Resident(string id){var row=C.One("SELECT data_json FROM resident WHERE id=$p0",id);return row==null?null:JsonNode.Parse(S(row,"data_json"))!.AsObject();}
    private string Name(string id)=>C.Scalar<string>("SELECT name FROM npc WHERE id=$p0",id)??"someone";
    private int Money(int player)=>C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player);
    private JsonObject Reply(int player,JsonObject result){host.PublishState(player);return NativeCoreClock.Join(result,host.Payload(player));}
    public Func<double,double,double>? LampLight;
    public Func<JsonArray>? WorkLamps;
    public Func<int,string,JsonObject?>? FindBoat;
    public Action<int,string,int>? TakeBoat;
    public Action<string>? HomeBoat;
    public NativeDeeds(NativeServiceHost host,NativeTransport transport)
    {
        this.host=host;this.transport=transport;Data=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-assets.json")))!.AsObject();
        C.Execute("CREATE TABLE IF NOT EXISTS deed(id INTEGER PRIMARY KEY,day INTEGER NOT NULL,hour INTEGER NOT NULL,minute INTEGER NOT NULL,thing TEXT NOT NULL,item TEXT NOT NULL,ref TEXT NOT NULL,owner TEXT NOT NULL,x REAL NOT NULL,z REAL NOT NULL,seen INTEGER NOT NULL,owner_saw INTEGER NOT NULL,witnesses TEXT DEFAULT '[]',item_id INTEGER,status TEXT DEFAULT 'open',rumour_at INTEGER,player_id INTEGER DEFAULT 1,took_c INTEGER DEFAULT 0,quiet INTEGER DEFAULT 0)");
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/deeds/world",r=>World(r.PlayerId));
        service.Register("POST","/api/deed",r=>Reply(r.PlayerId,Take(r)));
        service.Register("POST","/api/deed/:id/return",r=>Reply(r.PlayerId,Return(r.PlayerId,int.Parse(r.Param("id")),r.Text("how")=="caught"?"caught":"gave")));
        service.Register("POST","/api/pickpocket",r=>Reply(r.PlayerId,PickPocket(r)));
        service.Register("POST","/api/pocket/:deed/discover",r=>Reply(r.PlayerId,Discover(r)));
        service.Register("GET","/api/police",r=>PoliceView(r.PlayerId));
        service.Register("POST","/api/police/arrived",r=>{var state=PoliceState(r.PlayerId);var visit=state["visit"] as JsonObject;if(visit==null||S(visit,"agent")!=r.Text("agent")||S(visit,"state")=="due")Refuse("nobody is looking for you");visit!["state"]="talking";SavePolice(r.PlayerId,state);return PoliceView(r.PlayerId);});
        service.Register("POST","/api/police/fled",r=>Reply(r.PlayerId,Fled(r.PlayerId,false)));
        service.Register("POST","/api/police/seize",r=>Reply(r.PlayerId,Fled(r.PlayerId,true)));
        service.Register("POST","/api/police/cell",r=>{var cell=PoliceState(r.PlayerId)["cell"];if(cell==null)Refuse("no night to show");return NativeCoreClock.Join(new JsonObject{["night"]=cell?.DeepClone()},host.Payload(r.PlayerId));});
        service.Register("POST","/api/police/cell/done",r=>{var state=PoliceState(r.PlayerId);state["cell"]=null;SavePolice(r.PlayerId,state);return new{ok=true};});
        service.Register("GET","/api/police/events",r=>C.Rows("SELECT id,day,hour,verb,object,text FROM log WHERE id>$p0 AND player_id=$p1 AND (verb LIKE 'police_%' OR verb IN ('stole','stole_seen','caught_stealing','picked_pocket','gave_back','arrested','fled_police','cell')) ORDER BY id",int.TryParse(r.Query.GetValueOrDefault("since"),out int since)?since:0,r.PlayerId));
        service.Register("POST","/api/confront/leave",r=>Reply(r.PlayerId,LeaveConfront(r.PlayerId,r.Text("id"))));
        service.Register("POST","/api/deed/:id/noticed",r=>Reply(r.PlayerId,Noticed(r.PlayerId,int.Parse(r.Param("id")),r.Text("who"))));
        service.Register("POST","/api/deed/recognise",r=>Recognise(r));
        service.TickHooks.Add((r,advanced)=>{if(advanced)Rumours();});service.PlayerTickHooks.Add((r,advanced)=>{if(advanced){ConfrontTick(r.PlayerId);PoliceTick(r.PlayerId);}});var priorCell=host.Rest.CellEnded;host.Rest.CellEnded=(player,lines,ending)=>{priorCell?.Invoke(player,lines,ending);CellEnded(player,lines,ending);};
    }
    public Func<JsonObject>? Stealables;
    public JsonObject Assets=>Stealables?.Invoke()??Data["assets"]!.AsObject();
    public JsonObject World(int player)=>new(){["velos"]=transport.BikeWorld(player),["lamps"]=new JsonArray((WorkLamps?.Invoke()??A(Assets?["lamps"])).Where(l=>!A(C.World("lamps_taken:"+Day)).Any(t=>t?.GetValue<string>()==S(l,"id"))).Select(l=>{var row=l!.DeepClone().AsObject();row["owner_name"]=Name(S(l,"owner"));return (JsonNode)row;}).ToArray()),["food"]=Assets!["food"]!.DeepClone()};
    public JsonObject? Row(int id)=>C.One("SELECT * FROM deed WHERE id=$p0",id);
    public bool OutNow(string id){var r=Resident(id);if(r==null)return true;var act=NativeShops.Activity(r,Day,Hour).act;return act is not("home"or"church")&&!(act=="work"&&S(r["work"],"kind")=="inside");}
    private void Trust(int player,string npc,int amount)
    {
        C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) VALUES($p0,$p1)",npc,player);C.Execute("UPDATE npc_relationship SET trust=MAX(-5,MIN(10,trust+$p0)) WHERE npc_id=$p1 AND player_id=$p2",amount,npc,player);
    }
    private void Memory(int player,string npc,string text,int weight,string? gist=null,int tone=0)=>host.Trade.Remember(player,npc,text,weight,gist,tone);
    public int TalkCount(int player)=>C.Scalar<int>("SELECT COUNT(DISTINCT npc_id) FROM npc_memory WHERE tone<0 AND COALESCE(about_player,1)=$p0 AND (gist LIKE 'Jef stole%' OR gist LIKE 'Jef was about when%' OR gist LIKE 'Jef was caught with%' OR gist LIKE 'Jef ran from the police%' OR gist LIKE 'Jef took % and gave it back%' OR gist LIKE 'Jef was caught stealing%' OR gist LIKE 'Jef picked%' OR gist LIKE 'Jef was taken to the prison%')",player);
    public int Charisma(int player){double trust=C.Scalar<double>("SELECT COALESCE(AVG(trust),0) FROM npc_relationship WHERE player_id=$p0 AND (times_met>0 OR trust!=0)",player);var rec=PoliceState(player)["record"];return Math.Clamp((int)Math.Floor(5+trust*.8-TalkCount(player)*.35-N(rec,"fines")*.5-N(rec,"arrests")-N(rec,"fled")*.5+.5),0,10);}
    public static double Daylight(double hour){hour=(hour%24+24)%24;return hour>=20||hour<6?0:hour>=18||hour<7?.5:1;}
    public static double LampBrightness(double distance)=>distance<=3?.85:distance>=13?0:.85*(1-(distance-3)/10);
    private double Light(double x,double z,bool lantern)=>Math.Max(.1+.9*Daylight(Hour),Math.Max(LampLight?.Invoke(x,z)??0,lantern?.9:0));
    public static double SeeChance(double distance,bool los,double facing,bool owner,double light,bool crouch,double range,string trade,int age)
    {
        double s=Math.Clamp(1-distance/(range*light),0,1),p=los?Math.Pow(s,.6):distance<4?.25:0,attention=owner?.9:.6;
        if(age<12)attention=.45;if(trade=="thief")attention=.3;if(trade=="police")attention=1;if(trade is "sentry"or"corporal")attention=Math.Max(attention,.8);
        bool dark=light<.4;attention*=facing>.3?1:facing>-.3?(dark?.3:.6):dark?.05:.25;return Math.Clamp(p*attention*(crouch?.75:1),0,1);
    }
    private double Sight=>N(Data["sight"],S(host.Clock.View(),"weather","fog"),13);
    private JsonArray Witnesses(JsonObject body,string owner,JsonObject? known=null)
    {
        var raw=A(body["witnesses"]);if(raw.Count>60)Refuse("bad witnesses",400);var result=new JsonArray();var ids=new HashSet<string>();
        foreach(var w in raw){string id=S(w,"id").Trim();if(id.Length==0||id.Length>40||!ids.Add(id)||C.Scalar<int>("SELECT COUNT(*) FROM npc WHERE id=$p0",id)==0||!OutNow(id))continue;result.Add(new JsonObject{["id"]=id,["d"]=Math.Clamp(N(w,"d",80),0,80),["los"]=B(w,"los"),["facing"]=Math.Clamp(N(w,"facing",.5),-1,1),["owner"]=id==owner});if(result.Count==16)break;}
        var at=A(known?["at"]);if(at.Count>=2&&OutNow(owner)){double d=NativeGoods.Distance(V(at[0]),V(at[1]),N(body,"x"),N(body,"z"))+1.3;var existing=result.FirstOrDefault(w=>S(w,"id")==owner);if(existing!=null){existing["d"]=Math.Min(N(existing,"d"),d);existing["los"]=true;}else result.Add(new JsonObject{["id"]=owner,["d"]=d,["los"]=true,["facing"]=.5,["owner"]=true});}
        return result;
    }
    private int Record(int player,string thing,string item,string reference,string owner,double x,double z,JsonArray saw,int? itemId,int? rumourAt,int coins=0)
    {
        C.Execute("INSERT INTO deed(day,hour,minute,thing,item,ref,owner,x,z,seen,owner_saw,witnesses,item_id,rumour_at,player_id,took_c) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,$p8,$p9,$p10,$p11,$p12,$p13,$p14,$p15)",Day,(int)N(host.Clock.View(),"hour"),(int)N(host.Clock.View(),"minute"),thing,item,reference,owner,x,z,saw.Count>0?1:0,saw.Any(w=>B(w,"owner"))?1:0,new JsonArray(saw.Select(w=>(JsonNode)JsonValue.Create(S(w,"id"))!).ToArray()).ToJsonString(),itemId,rumourAt,player,coins);return C.Scalar<int>("SELECT last_insert_rowid()");
    }
    private JsonObject Reactions(int player,int deed,JsonArray saw)
    {
        if(S(Row(deed),"thing")=="boat")return BoatReactions(player,deed,saw);
        var row=Row(deed)!;string owner=S(row,"owner"),noun=S(Data["things"]?[S(row,"thing")],"noun",S(row,"item"));bool low=Charisma(player)<=2;var roles=saw.Select(w=>(w,role:Role(S(w,"id"),B(w,"owner")))).ToArray();var agent=roles.FirstOrDefault(r=>r.role=="police").w;var challenger=agent!=null?null:roles.Where(r=>r.role=="confront"&&N(r.w,"d")<30).OrderByDescending(r=>B(r.w,"owner")).ThenBy(r=>N(r.w,"d")).Select(r=>r.w).FirstOrDefault();bool quiet=challenger!=null&&!low;
        var reactions=new JsonArray();void Add(JsonNode? w,string role){if(w==null)return;string id=S(w,"id");reactions.Add(new JsonObject{["who"]=id,["name"]=Name(id),["kind"]=role,["line"]=role=="confront"?$"{Name(id)} steps up: \"That is not yours. Give it back.\"":role=="police"?$"{Name(id)} of the police: \"Halt! I saw that.\"":$"{Name(id)} shouts: \"Thief! Police!\""});}
        if(quiet){C.Execute("UPDATE deed SET quiet=1 WHERE id=$p0",deed);foreach(var w in saw.Take(5))Memory(player,S(w,"id"),$"I saw Jef take {Name(owner)}'s {noun}.",5);}else Spread(player,row,saw.Select(w=>S(w,"id")));
        if(challenger!=null){string id=S(challenger,"id");var list=Confronts(player).Where(c=>S(c,"npc")!=id).ToList();list.Add(new JsonObject{["deed"]=deed,["npc"]=id,["owner"]=id==owner,["at"]=Minute,["low"]=low,["stage"]="open"});SaveConfronts(player,list);Add(challenger,"confront");}
        if(!quiet){if(agent!=null)Add(agent,"police");else Add(roles.FirstOrDefault(r=>r.role=="fetch").w,"fetch");Add(roles.FirstOrDefault(r=>r.role=="shout").w,"shout");}
        bool police=!quiet&&roles.Any(r=>r.role!="silent");int delay=agent!=null?0:roles.Any(r=>r.role=="fetch")?6:20;if(police)Schedule(player,deed,delay,agent==null?null:S(agent,"id"));if(low)C.Log(player,"caught_stealing",owner,$"Jef was seen stealing {noun}; the town has had enough of him.");
        return new(){["reactions"]=reactions,["reaction"]=reactions.FirstOrDefault()?.DeepClone(),["police"]=police,["police_in"]=police?delay:null,["police_agent"]=agent==null?null:JsonValue.Create(S(agent,"id")),["quiet"]=quiet};
    }
    private JsonObject BoatReactions(int player,int deed,JsonArray saw)
    {
        var row=Row(deed)!;string owner=S(row,"owner");var r=Resident(owner);bool posted=r==null||C.Rules["employers"]?[owner]!=null;string kind=posted||N(r,"age")<14||N(r,"age")>=65?"shout":N(r?["stats"],"courage")>=6&&N(r?["stats"],"temper")>=5?"chase":N(r?["stats"],"warmth")>=6||N(r?["stats"],"courage")<=3?"ask":"chase";
        Spread(player,row,new[]{owner});if(kind=="ask"){var asks=State(player,"boat_asked")as JsonObject??new();asks[deed.ToString()]=Minute;C.SetPlayerState(player,"boat_asked",asks);}else Schedule(player,deed);string line=kind=="ask"?$"{Name(owner)}: That is my boat. Bring her back to where she lay and we will say no more.":$"{Name(owner)} shouts and runs for the quay: Bring my boat back, you thief!";var reaction=new JsonObject{["who"]=owner,["name"]=Name(owner),["kind"]=kind,["line"]=line};return new(){["reaction"]=reaction,["reactions"]=new JsonArray(reaction.DeepClone()),["police"]=kind!="ask",["police_agent"]=null};
    }
    private string Role(string id,bool owner){var r=Resident(id);if(r==null||C.Rules["employers"]?[id]!=null)return "shout";string trade=S(r,"trade");if(trade=="police")return "police";if(trade is "sentry"or"corporal"||N(r,"age")>=65)return "shout";if(N(r,"age")<12)return "fetch";if(N(r["stats"],"courage")>=(owner?5:6))return "confront";return owner||N(r["stats"],"honesty")>=4?"fetch":"silent";}
    private void Spread(int player,JsonObject row,IEnumerable<string> witnesses)
    {
        string owner=S(row,"owner"),noun=S(Data["things"]?[S(row,"thing")],"noun",S(row,"item"));foreach(string id in witnesses.Distinct().Take(6)){Memory(player,id,$"I saw Jef take {Name(owner)}'s {noun}.",id==owner?8:6,$"Jef stole {Name(owner)}'s {noun}",-2);Trust(player,id,id==owner?-2:-1);}string faction=C.Scalar<string>("SELECT faction FROM npc WHERE id=$p0",owner);if(!string.IsNullOrEmpty(faction))C.Execute("UPDATE faction_trust SET trust=MAX(-5,trust-1) WHERE faction=$p0 AND player_id=$p1",faction,player);C.Execute("UPDATE deed SET quiet=0 WHERE id=$p0",(int)N(row,"id"));
    }
    private void Suspects(int player,int deed,JsonArray suspects)
    {
        if(suspects.Count==0)return;var list=A(State(player,"deed_suspects")).Where(s=>N(s,"until")>Minute).TakeLast(3).Select(s=>s!.DeepClone()).ToList();list.Add(new JsonObject{["deed"]=deed,["ids"]=new JsonArray(suspects.OrderBy(w=>N(w,"d")).Take(3).Select(w=>(JsonNode)JsonValue.Create(S(w,"id"))!).ToArray()),["until"]=Minute+10});C.SetPlayerState(player,"deed_suspects",new JsonArray(list.ToArray()));
    }
    private void Rumours(){foreach(var row in C.Rows("SELECT * FROM deed WHERE status='open' AND rumour_at IS NOT NULL AND rumour_at<=$p0",Minute)){C.Execute("UPDATE deed SET rumour_at=NULL WHERE id=$p0",(int)N(row,"id"));Memory((int)N(row,"player_id",1),S(row,"owner"),"Someone says Jef was about when my things went missing.",5,$"Jef was about when {Name(S(row,"owner"))}'s things went missing",-1);}}
}

