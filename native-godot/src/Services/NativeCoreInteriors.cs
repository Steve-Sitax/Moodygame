using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Tavern ownership, opening hours, fire, intoxication, pitjesbak and the nightly Poesje.
/// Narration callbacks return words only; this module owns facts, payments, dice and cooldowns.</summary>
public sealed partial class NativeCoreInteriors : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private readonly JsonObject data;
    private List<JsonObject>? residents;
    private readonly List<JsonObject> recentConvos = new();
    public Func<string,JsonObject,JsonObject?>? Narrate;
    public Func<int,string,string,string,JsonObject?>? ConvoResolver;
    public readonly List<Func<string,JsonArray>> GuestProviders = new();
    public Func<int>? DailyCallLimit;
    private static readonly int[] stakes = {2,5,10};
    private static readonly HashSet<string> dull = new(new[]{"bought","drank","ate","talked","convo","gossip","diced","warmed","paid_show","poesje_show","arrived","job_board","said_strange"});
    private static string S(JsonNode? n,string key,string fallback="") => n?[key]?.GetValue<string>() ?? fallback;
    private static double N(JsonNode? n) {if(n is not JsonValue v)return 0;if(v.TryGetValue<double>(out var d))return d;if(v.TryGetValue<int>(out int i))return i;if(v.TryGetValue<long>(out long l))return l;return 0;}
    private int Day => NativeCoreClock.Number(host.Clock.View(),"day");
    private double Hour => NativeCoreClock.Number(host.Clock.View(),"hour")+NativeCoreClock.Number(host.Clock.View(),"minute")/60.0;
    public NativeCoreInteriors(NativeServiceHost host) { this.host=host;data=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-interiors.json")))!.AsObject(); }
    private IReadOnlyList<JsonObject> Residents => residents ??= C.Rows("SELECT data_json FROM resident ORDER BY id").Select(r=>JsonNode.Parse(S(r,"data_json"))!.AsObject()).ToList();
    private JsonObject Person(string id) => Residents.FirstOrDefault(r=>S(r,"id")==id) ?? throw new NativeServiceException("nobody by that name here",404);
    private JsonObject Places => C.World("town")?["places"]?.AsObject() ?? new();
    public string Place(string id) { string p=id.StartsWith("tavern:",StringComparison.Ordinal)?id:"tavern:"+id;return Places[p]?["door"]!=null?p:throw new NativeServiceException("no such tavern",404); }
    private string Label(string place) => S(Places[place],"label","the tavern");
    private JsonObject? Keeper(string place) => Residents.FirstOrDefault(r=>S(r,"trade")=="publican"&&S(r["work"],"place")==place);
    public bool Open(string place) => Keeper(place) is {} k && host.Trade.AtWork(S(k,"id"));
    public bool Welcome(int who,string place) => place!="tavern:zwarte_kat" || C.Scalar<int>("SELECT trust FROM faction_trust WHERE faction='smokkelaars' AND player_id=$p0",who)>=3;
    private void NeedOpen(int who,string place) { if(!Open(place))throw new NativeServiceException(Label(place)+" is shut",409);if(!Welcome(who,place))throw new NativeServiceException("\"We do not serve strangers here. Best be on your way.\"",409); }
    public static (string Act,string Place) Activity(JsonObject r,int day,double hour)
    {
        hour=(hour%24+24)%24;foreach(var part in r["sched"]?[day%7==0?"sunday":"day"]?.AsArray() ?? new()) {
            if(part is not JsonArray a || a.Count<3)continue;double from=N(a[0]),to=N(a[1]);
            if(hour>=from&&hour<to || hour+24>=from&&hour+24<to){string act=a[2]!.GetValue<string>();return (act,a.Count>3?a[3]?.GetValue<string>()??(act=="work"?"work":"home"):act=="work"?"work":"home");}
        }
        return ("home","home");
    }
    // Pure shared/tempest.ts sum, same person and same storm always choose the same shelter.
    private string? StormTavern(JsonObject r,(string Act,string Place) now,JsonObject places,int storm)
    {
        string wk=S(r["work"],"kind"),wp=S(r["work"],"place");
        if(wk=="tavern"&&wp.StartsWith("tavern:")&&N(r["age"])>=14)return now.Act=="work"?null:wp;
        if(now.Act=="tavern"&&now.Place.StartsWith("tavern:"))return now.Place;
        if(now.Act is "home" or "church" or "tavern" || now.Act=="work"&&wk is "tavern" or "inside" or "guard")return null;
        if(N(r["age"])<14||S(r,"trade") is "child" or "street_child")return null;
        uint hash=2166136261;foreach(char ch in S(r,"id")+":tempest:"+storm)hash=unchecked((hash^ch)*16777619);
        double h=hash/4294967296.0;if(h<.42||h>=.74)return null;
        var from=places[now.Act=="work"?wp:now.Place];double x=from==null?N(r["home"]?["sx"]):N(from["x"]),z=from==null?N(r["home"]?["sz"]):N(from["z"]);
        string? best=null;double distance=260;foreach(var p in places.Where(p=>p.Key.StartsWith("tavern:"))) {double d=Math.Sqrt(Math.Pow(N(p.Value?["x"])-x,2)+Math.Pow(N(p.Value?["z"])-z,2));if(d<distance){distance=d;best=p.Key;}}return best;
    }
    public IReadOnlyList<JsonObject> Patrons(string place)
    {
        var result=new List<JsonObject>();var tempest=C.World("tempest");bool storm=S(tempest,"phase") is "coming" or "peak" or "easing";int ran=0;
        // the clock read once, not twice a resident (#62: thousands of database reads and parsed clocks a request)
        int day=Day;double hour=Hour;
        var places=Places;foreach(var r in Residents) {if(N(r["age"])<14)continue;var now=Activity(r,day,hour);if(now.Act=="tavern"&&now.Place==place || storm&&StormTavern(r,now,places,(int)N(tempest?["event"]))==place&&ran++<24)result.Add(r);}return result;
    }
    private JsonObject NeedPatron(string place,string id) => Patrons(place).FirstOrDefault(r=>S(r,"id")==id) ?? throw new NativeServiceException("they are not drinking here now",409);
    private static JsonObject PublicPerson(JsonObject r,bool full=true) {var answer=new JsonObject();foreach(string f in full?new[]{"id","name","first","kind","sex","age"}:new[]{"id","name","first","kind"})answer[f]=r[f]?.DeepClone();return answer;}
    public JsonObject Tavern(int who,string place)
    {
        var keeper=Keeper(place);bool open=Open(place),welcome=Welcome(who,place);var patrons=new JsonArray();var regulars=open?Patrons(place):Array.Empty<JsonObject>();foreach(var r in regulars)patrons.Add(PublicPerson(r));
        if(open)foreach(var guest in GuestProviders.SelectMany(f=>f(place)))if(guest is JsonObject g&&!regulars.Any(r=>S(r,"id")==S(g,"id")))patrons.Add(g.DeepClone());
        return new JsonObject{["place"]=place,["label"]=Label(place),["open"]=open,["welcome"]=welcome,["greeting"]=place=="tavern:zwarte_kat"?welcome?"A man by the bar nods. \"One of ours. Pull up a chair.\"":"The room falls quiet. \"This is our place. Finish looking and leave. Earn the lads' trust before you come drinking here.\"":"",["keeper"]=keeper==null?null:PublicPerson(keeper,false),["patrons"]=patrons};
    }
    public double Tipsy(int who)
    {
        double sum=0,now=host.Clock.MinuteNow();foreach(var row in C.Rows("SELECT e.target,e.day*1440+e.hour*60+e.minute AS m FROM world_event e JOIN log l ON e.ref_type='log' AND l.id=e.ref_id WHERE e.verb IN ('bought','drank') AND e.target IN ('beer','jenever') AND e.day>=$p0 AND l.player_id=$p1",Day-1,who)) {
            double age=now-N(row?["m"]);if(age>=0&&age<180)sum+=(S(row,"target")=="beer"?1:2)*(1-age/180);
        }return Math.Floor(Math.Min(4,sum)*100+.5)/100;
    }
    public JsonObject Fire(int who,string place)
    {
        NeedOpen(who,place);double now=host.Clock.MinuteNow(),last=C.PlayerState(who,"interior:fire") is {} previous?N(previous):-1e9;
        if(now-last<60)return new JsonObject{["text"]="You hold your hands to the fire. You are as warm as it will make you for now.",["warmed"]=false};
        C.Atomic(()=>{C.Execute("UPDATE player SET warmth=MIN(10,warmth+1) WHERE id=$p0",who);C.SetPlayerState(who,"interior:fire",now);C.Log(who,"warmed",place,"Jef warmed himself at the fire in "+Label(place)+".");});return new JsonObject{["text"]="The heat gets into your hands, then your coat. You stop shivering.",["warmed"]=true};
    }
    public static JsonObject Score(params int[] dice)
    {
        int[] sorted=dice.OrderBy(d=>d).ToArray();int rank,points;string name;
        if(sorted[0]==sorted[2]){rank=2;points=sorted[0]==1?7:sorted[0];name="three "+new[]{"","aces","twos","threes","fours","fives","sixes"}[sorted[0]];}
        else if(sorted.SequenceEqual(new[]{4,5,6})){rank=1;points=69;name="sixty-nine";}
        else{rank=0;points=dice.Sum(d=>d==1?100:d==6?60:d);name=points.ToString(System.Globalization.CultureInfo.InvariantCulture);}
        return new JsonObject{["dice"]=new JsonArray(dice.Select(d=>(JsonNode)JsonValue.Create(d)!).ToArray()),["rank"]=rank,["points"]=points,["name"]=name};
    }
    public static int Compare(JsonObject a,JsonObject b) => Math.Sign(N(a["rank"])==N(b["rank"])?N(a["points"])-N(b["points"]):N(a["rank"])-N(b["rank"]));
    private JsonObject Ledger(int who) => C.PlayerState(who,"interior:dice:"+Day)?.AsObject() ?? new JsonObject{["games"]=0,["net"]=0,["won"]=new JsonObject()};
    public JsonObject DiceLeft(int who) {var l=Ledger(who);return new JsonObject{["games"]=Math.Max(0,12-(int)N(l["games"])),["loss_c"]=Math.Max(0,30+Math.Min(0,(int)N(l["net"])))};}
    public static JsonObject FallbackTaunts(JsonObject r)
    {
        bool hot=N(r["stats"]?["temper"])>=6,kind=N(r["stats"]?["warmth"])>=6;
        return new JsonObject{["greet"]=hot?"Sit, then. And keep your hands where I can see them.":kind?"A throw or two? Why not, it's a long evening.":"Dice? Put your money down first.",["jef_wins"]=hot?new JsonArray("Luck. Pure dumb luck.","Again. Now."):new JsonArray("Well thrown, curse you.","The dice like a new face."),["patron_wins"]=hot?new JsonArray("Ha! Pay up, farm boy.","That's the Kempen for you."):kind?new JsonArray("Sorry, friend. The cup was kind to me.","Better luck on the next one."):new JsonArray("Mine.","Thank you kindly."),["draw"]="Nobody's the richer. Throw again.",["refuse"]=hot?"Enough. My purse is shut for tonight.":"No more for me tonight, I've a wife to answer to."};
    }
    private JsonObject Taunts(JsonObject r) => C.World("interior:taunts:"+Day+":"+S(r,"id"))?.AsObject() ?? new JsonObject{["taunts"]=FallbackTaunts(r),["source"]="engine"};
    private JsonObject? Narration(string hook,int share,JsonObject context,params string[] family)
    {
        if(Narrate==null)return null;int total=C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0",Day),mine=0;foreach(string member in family.Length==0?new[]{hook}:family)mine+=C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook=$p1",Day,member);
        int limit=DailyCallLimit?.Invoke()??120;if(mine>=share || limit!=0&&total>=limit-15)return null;
        context["clock"]=host.Clock.View();context["weather"]=data["weatherText"]?[S(host.Clock.View(),"weather")]?.DeepClone();try{return Narrate(hook,context);}catch{return null;}
    }
    public JsonObject Sit(int who,string place,string id)
    {
        NeedOpen(who,place);var r=NeedPatron(place,id);var before=Taunts(r);string key="interior:taunts:"+Day+":"+id;
        if(S(before,"source")=="engine") {var words=Narration("tavern_dice",6,new JsonObject{["resident"]=r.DeepClone(),["place"]=Label(place),["memories"]=host.Rumours.Memories(id,3),["relationship"]=host.Rumours.Relationship(id,who)},"tavern_dice","tavern_gossip");if(words!=null){var fb=FallbackTaunts(r);var clean=fb.DeepClone().AsObject();foreach(string f in new[]{"greet","draw","refuse"})clean[f]=CleanLine(S(words,f),120)??S(fb,f);foreach(string f in new[]{"jef_wins","patron_wins"}){var valid=(words[f] as JsonArray??new()).Select(n=>CleanLine(n?.GetValue<string>()??"",120)).Where(n=>n!=null).Take(3).ToArray();if(valid.Length>0)clean[f]=new JsonArray(valid.Select(n=>(JsonNode)JsonValue.Create(n)!).ToArray());}C.SetWorld(key,new JsonObject{["taunts"]=clean,["source"]="claude"});}}
        return new JsonObject{["line"]=S(r,"first")+": "+S(before["taunts"],"greet"),["stakes"]=new JsonArray(2,5,10),["left"]=DiceLeft(who),["source"]=before["source"]?.DeepClone()};
    }
    public JsonObject Throw(int who,string place,string id,double stake,Func<double>? rng=null)
    {
        NeedOpen(who,place);var r=NeedPatron(place,id);if(!stakes.Any(s=>s==stake))throw new NativeServiceException("the stakes here are 2, 5, 10 centimes",400);var l=Ledger(who);var taunts=Taunts(r)["taunts"]!;var won=l["won"]!.AsObject();
        if(N(l["games"])>=12)throw new NativeServiceException(S(r,"first")+": \"The cup's had enough for one day, and so have you.\"",409);
        if(N(l["net"])-stake< -30)throw new NativeServiceException("You have lost enough at dice for one day. Keep the rest for bread.",409);
        if(N(won[id])+stake>10+4*N(r["stats"]?["wealth"]))throw new NativeServiceException(S(r,"first")+": \""+S(taunts,"refuse")+"\"",409);
        if(N(host.Player(who)["money_c"])<stake)throw new NativeServiceException("not enough money: "+stake+" c on the table",409);
        var roll=rng??C.Roll;JsonObject score()=>Score(Enumerable.Range(0,3).Select(_=>1+Math.Min(5,(int)Math.Floor(roll()*6))).ToArray());var jef=score();var them=score();int result=Compare(jef,them),net=result*(int)stake;string label=Label(place);
        C.Atomic(()=>{if(net!=0)C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1",net,who);l["games"]=(int)N(l["games"])+1;l["net"]=(int)N(l["net"])+net;won[id]=(int)N(won[id])+net;C.SetPlayerState(who,"interior:dice:"+Day,l);string what=result>0?"won "+stake+" centimes off "+S(r,"name"):result<0?"lost "+stake+" centimes to "+S(r,"name"):"threw even with "+S(r,"name");C.Log(who,"diced",id,"Jef "+what+" at dice in "+label+".");});
        if(result>0)host.Trade.Remember(who,id,"Jef beat me at dice in "+label+" for "+stake+" centimes.",stake>=10?3:2);else if(result<0)host.Trade.Remember(who,id,"I took "+stake+" centimes off Jef at dice in "+label+".",2);
        string words=result==0?S(taunts,"draw"):taunts[result>0?"jef_wins":"patron_wins"]!.AsArray()[(int)Math.Floor(roll()*taunts[result>0?"jef_wins":"patron_wins"]!.AsArray().Count)%taunts[result>0?"jef_wins":"patron_wins"]!.AsArray().Count]!.GetValue<string>();return new JsonObject{["jef"]=jef,["them"]=them,["result"]=result,["net_c"]=net,["line"]=S(r,"first")+": "+words,["left"]=DiceLeft(who)};
    }
    public JsonArray GossipFacts(int max=2)
    {
        var used=new HashSet<int>((C.World("interior:gossip_used") as JsonArray??new()).Select(n=>(int)N(n)));return new JsonArray(C.Rows("SELECT * FROM world_event WHERE day>=$p0 AND weight>=3 ORDER BY weight DESC,id DESC LIMIT 60",Day-1).Where(r=>!used.Contains((int)N(r?["id"]))&&!dull.Contains(S(r,"verb"))).Take(max).Select(r=>r!.DeepClone()).ToArray());
    }
    public static JsonArray EngineGossip(JsonObject a,JsonObject b,JsonArray facts)
    {
        string x,y;if(facts.Count==0){var lines=new[]{new[]{"The fog's in my bones again tonight.","Drink up, it goes out the same way it came in."},new[]{"They say the Red Star ships take a thousand at a time.","And bring back not one of them."},new[]{"The naties are hiring short this week.","They always are when you need it."},new[]{"My wife says I drink too much.","Your wife says a lot of things."}};string ai=S(a,"id"),bi=S(b,"id");var selected=lines[(ai[^1]+bi[^1])%4];x=selected[0];y=selected[1];}else{x="Did you hear? "+Regex.Replace(S(facts[0],"text"),@"\.$","")+".";y=N(b["stats"]?["temper"])>=6?"I heard worse. I heard it was twice that.":"Is that so. Well, it's not the first time.";}
        return new JsonArray(new JsonObject{["who"]=S(a,"id"),["name"]=S(a,"first"),["text"]=x},new JsonObject{["who"]=S(b,"id"),["name"]=S(b,"first"),["text"]=y});
    }
    public long WriteEvent(string kind,string verb,string text,int weight=2,string? actor=null,string? target=null,string? place=null,string? outcome=null,JsonObject? extra=null,IEnumerable<string>? who=null)
    {
        var c=host.Clock.View();C.Execute("INSERT INTO world_event(day,hour,minute,kind,verb,actor,target,place,text,outcome,weight,data_json) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,$p8,$p9,$p10,$p11)",Day,NativeCoreClock.Number(c,"hour"),NativeCoreClock.Number(c,"minute"),kind,verb,actor,target,place,text,outcome,weight,extra?.ToJsonString()??"{}");long id=C.Scalar<long>("SELECT last_insert_rowid()");foreach(string person in who??Array.Empty<string>())C.Execute("INSERT INTO world_event_who(event_id,who) VALUES($p0,$p1)",id,person);return id;
    }
    public JsonObject Gossip(int who,string place,string aid,string bid)
    {
        NeedOpen(who,place);if(aid==bid)throw new NativeServiceException("two people are needed for gossip",400);var a=NeedPatron(place,aid);var b=NeedPatron(place,bid);double now=host.Clock.MinuteNow();var last=C.World("interior:gossip_last")?.AsObject()??new();if(now-(last[place]==null?-1e9:N(last[place]))<60)throw new NativeServiceException("they talk of nothing much just now",409);last[place]=now;C.SetWorld("interior:gossip_last",last);
        var facts=GossipFacts();JsonArray? lines=null;var outp=facts.Count>0?Narration("tavern_gossip",6,new JsonObject{["a"]=a.DeepClone(),["b"]=b.DeepClone(),["facts"]=facts.DeepClone(),["place"]=Label(place)},"tavern_dice","tavern_gossip"):null;
        if(outp?["lines"] is JsonArray proposed&&proposed.Count is >=2 and <=4){var clean=new JsonArray();foreach(var p in proposed){string? text=CleanLine(S(p,"text"),160);string speaker=S(p,"speaker");if(text==null||speaker is not ("A" or "B")){clean.Clear();break;}var r=speaker=="A"?a:b;clean.Add(new JsonObject{["who"]=S(r,"id"),["name"]=S(r,"first"),["text"]=text});}if(clean.Count>=2)lines=clean;}
        string source=lines==null?"engine":"claude";lines??=EngineGossip(a,b,facts);if(facts.Count>0){var used=(C.World("interior:gossip_used") as JsonArray??new()).Select(n=>n!.DeepClone()).Concat(facts.Select(f=>f!["id"]!.DeepClone())).TakeLast(200);C.SetWorld("interior:gossip_used",new JsonArray(used.ToArray()));}
        string summary=S(a,"name")+" and "+S(b,"name")+" gossiped in "+Label(place)+(facts.Count>0?" about: "+S(facts[0],"text"):"");WriteEvent("talk","gossip",summary[..Math.Min(280,summary.Length)],2,aid,bid,place,extra:new JsonObject{["source"]=source},who:new[]{aid,bid});return new JsonObject{["lines"]=lines,["source"]=source,["facts"]=new JsonArray(facts.Select(f=>(JsonNode)JsonValue.Create(S(f,"text"))!).ToArray())};
    }
    public bool PassRumour(string from,string to)
    {
        var row=C.Rows("SELECT id,gist,tone,weight,COALESCE(origin,id) AS origin,about_player FROM npc_memory WHERE npc_id=$p0 AND gist IS NOT NULL AND gist<>'' AND weight>=2 ORDER BY weight DESC,id DESC LIMIT 5",from).FirstOrDefault(r=>C.Scalar<long>("SELECT COUNT(*) FROM npc_memory WHERE npc_id=$p0 AND (origin=$p1 OR id=$p1)",to,(int)N(r?["origin"]))==0);if(row==null)return false;
        string teller=C.Scalar<string>("SELECT name FROM npc WHERE id=$p0",from)??"someone";C.Execute("INSERT INTO npc_memory(npc_id,text,source,heard_from,weight,day,spread,gist,tone,origin,town_spread,about_player) VALUES($p0,$p1,'heard',$p2,$p3,$p4,1,$p5,$p6,$p7,0,$p8)",to,teller+" told me: "+S(row,"gist"),from,Math.Max(1,(int)N(row["weight"])-1),Day,S(row,"gist"),(int)N(row["tone"]),(int)N(row["origin"]),row["about_player"]==null?null:(int)N(row["about_player"]));return true;
    }
    public JsonObject Chat(int who,string place,string aid,string bid)
    {
        NeedOpen(who,place);if(aid==bid)throw new NativeServiceException("two people are needed for a talk",400);var a=NeedPatron(place,aid);var b=NeedPatron(place,bid);double now=host.Clock.MinuteNow();var last=C.World("interior:chat_last")?.AsObject()??new();
        if(now-(last[place]==null?-1e9:N(last[place]))<120)return new JsonObject{["lines"]=EngineGossip(a,b,new()),["source"]="engine",["facts"]=new JsonArray()};last[place]=now;C.SetWorld("interior:chat_last",last);
        var resolved=ConvoResolver?.Invoke(who,aid,bid,"the evening in "+Label(place)+", over a drink");if(resolved!=null)return new JsonObject{["lines"]=resolved["lines"]?.DeepClone(),["source"]=resolved["source"]?.DeepClone(),["facts"]=new JsonArray()};
        var lines=new JsonArray();int i=0;foreach(var node in data["convoChat"]!.AsArray()){var r=i++%2==0?a:b;string text=node!.GetValue<string>().Replace("{A}",S(a,"first")).Replace("{B}",S(b,"first"));lines.Add(new JsonObject{["who"]=S(r,"id"),["name"]=S(r,"first"),["text"]=Regex.Replace(text,@"^[^:]+:\s*","")});}
        string outcome=N(a["stats"]?["gossip"])>=6&&PassRumour(aid,bid)?"pass_rumour":"none";long id=WriteEvent("talk","convo",S(a,"name")+" spoke with "+S(b,"name"),3,aid,bid,outcome:outcome,extra:new JsonObject{["purpose"]="chat",["lines"]=new JsonArray(lines.Select(l=>(JsonNode)JsonValue.Create(S(l,"name")+": "+S(l,"text"))!).ToArray()),["source"]="engine"},who:new[]{aid,bid});var convo=new JsonObject{["id"]=id,["a"]=aid,["b"]=bid,["a_name"]=S(a,"name"),["b_name"]=S(b,"name"),["purpose"]="chat",["lines"]=lines.DeepClone(),["source"]="engine",["outcome"]=outcome,["at"]=C.Now,["event_id"]=null};recentConvos.Add(convo);host.Publish("convo",new JsonObject{["convo"]=convo.DeepClone()});return new JsonObject{["lines"]=lines,["source"]="engine",["facts"]=new JsonArray()};
    }
    public JsonArray RecentConvos(){recentConvos.RemoveAll(c=>C.Now-N(c["at"])>120000);return new JsonArray(recentConvos.Select(c=>c.DeepClone()).ToArray());}
    public JsonObject? PoesjeDoor() {var kept=C.World("poesje:door") as JsonObject;if(kept!=null)return kept;var door=data["poesjeDoor"]?.DeepClone().AsObject();if(door!=null)C.SetWorld("poesje:door",door);return door;}
    public bool DoorOpen => Hour>=18.5&&Hour<22;
    public JsonObject? ShowToday() => C.World("poesje:show:"+Day) as JsonObject;
    public JsonArray ShowFacts(int max=3)
    {
        int score(JsonNode? e)=>(int)N(e?["weight"])+(S(e,"kind")=="event"?3:0)+(S(e,"kind") is "theft" or "police"?2:0)+(S(e,"actor")=="player"?2:0)+(N(e?["day"])==Day?1:0);
        var result=new JsonArray();var seen=new HashSet<string>();foreach(var e in C.Rows("SELECT * FROM world_event WHERE day>=$p0 AND weight>=3 ORDER BY id DESC LIMIT 120",Day-1).Where(e=>!dull.Contains(S(e,"verb"))&&S(e,"verb")!="took_job").OrderByDescending(score).ThenByDescending(e=>N(e?["id"]))) {if(!seen.Add(S(e,"verb")))continue;string text=S(e,"text");result.Add(new JsonObject{["text"]=text,["jef"]=S(e,"actor")=="player"||Regex.IsMatch(text,@"\bJef\b")});if(result.Count>=max)break;}
        if(result.Count<max)result.Add(new JsonObject{["text"]="The weather today: "+(data["weatherText"]?[S(host.Clock.View(),"weather")]?.GetValue<string>()??"thick river fog")+".",["jef"]=false});return result;
    }
    public static JsonObject FallbackPlay(JsonArray facts,int day)
    {
        var texts=facts.Select(f=>Regex.Replace(S(f,"text"),@"\.$","")).ToArray();bool jef=facts.Any(f=>f?["jef"]?.GetValue<bool>()==true);var lines=new JsonArray();void line(string who,string text)=>lines.Add(new JsonObject{["who"]=who,["text"]=text});
        line("neus","Dockers, sailors and small fry! Hats off, noses up, the Poesje is on!");line("schele","N-n-news, Neus? I heard some. I think.");line("neus","Heard? I saw it with my own nose. "+texts[0]+".");line("third",jef?"It wasn't like that at all! I only came to town for work!":"Lies! It was nothing of the sort!");line("schele","Th-that's not how it went, Neus. It went w-worse.");if(texts.Length>1){line("neus","And that's not all. "+texts[1]+".");line("third","I'll have the police on the lot of you!");}line("neus","The police? They're in the tavern with the rest of us!");line("schele","Then g-g-give him the stick, Neus. Gently.");line("neus","Gently it is. Knock! And good night to you all!");
        return new JsonObject{["title"]=jef?"Jef the Farm Boy Comes to Town":new[]{"The Fog Over the Schelde","Neus and the Lost Purse","A Wedding Gone Wrong","Schele Goes to Sea","Who Stole the Herring?"}[day%5],["third"]=jef?"Jef the Farm Boy":"a Know-all",["lines"]=lines};
    }
    public static JsonObject? CleanPlay(JsonObject proposed)
    {
        string? title=CleanLine(S(proposed,"title"),60),third=CleanLine(S(proposed,"third"),30);if(title==null||third==null||proposed["lines"] is not JsonArray lines||lines.Count is <6 or >10)return null;var clean=new JsonArray();foreach(var l in lines){string who=S(l,"who");string? text=CleanLine(S(l,"text"));if(who is not("neus" or "schele" or "third")||text==null)return null;clean.Add(new JsonObject{["who"]=who,["text"]=text});}return new JsonObject{["title"]=title,["third"]=third,["lines"]=clean};
    }
    public JsonObject WriteShow()
    {
        if(ShowToday() is {} have)return have;var facts=ShowFacts();var output=Narration("poesje_show",2,new JsonObject{["facts"]=facts.DeepClone()});var play=output==null?null:CleanPlay(output);var show=new JsonObject{["day"]=Day,["play"]=play??FallbackPlay(facts,Day),["source"]=play==null?"engine":"claude",["facts"]=new JsonArray(facts.Select(f=>(JsonNode)JsonValue.Create(S(f,"text"))!).ToArray()),["aboutJef"]=facts.Any(f=>f?["jef"]?.GetValue<bool>()==true)};C.SetWorld("poesje:show:"+Day,show);return show;
    }
    public IReadOnlyList<JsonObject> Audience()
    {
        var want=new HashSet<string>(new[]{"child","street_child","errand_boy","docker","natie","sailor","boatman","porter"});int day=Day;uint hash(string id){uint x=(uint)(day*7919);foreach(char ch in id)x=unchecked(x*31+ch);return x;}
        var sorted=Residents.Where(r=>want.Contains(S(r,"trade"))&&N(r["age"])>=6&&Activity(r,day,20).Act is "home" or "play" or "loiter").OrderBy(r=>hash(S(r,"id"))).ToArray();var kids=sorted.Where(r=>N(r["age"])<16).Take(6).ToArray();return kids.Concat(sorted.Where(r=>N(r["age"])>=16).Take(14-kids.Length)).ToArray();
    }
    public JsonObject Admit(int who)
    {
        if(!DoorOpen)throw new NativeServiceException("the cellar door is shut; the Poesje plays from seven in the evening",409);string key="poesje:paid:"+Day;if(C.PlayerState(who,key)?.GetValue<bool>()==true)return new JsonObject{["paid_c"]=0,["line"]="The woman at the door knows your face and waves you down the steps."};if(N(host.Player(who)["money_c"])<5)throw new NativeServiceException("not enough money: 5 c to go down",409);var show=ShowToday();C.Atomic(()=>{C.Execute("UPDATE player SET money_c=money_c-5 WHERE id=$p0",who);C.SetPlayerState(who,key,true);C.Log(who,"paid_show","poesje","Jef paid 5 centimes to see the Poesje.");});
        if(show!=null){bool about=show["aboutJef"]?.GetValue<bool>()==true;WriteEvent("event","poesje_show","The Poesje played \""+S(show["play"],"title")+"\" in the cellar by the Vleeshuis; Jef was in the audience.",about?4:2,place:"poesje");if(about)foreach(var r in Audience().Take(4))host.Trade.Remember(who,S(r,"id"),"At the Poesje they made fun of Jef, the farm boy: \""+S(show["play"],"title")+"\". He was sitting right there.",3,"Jef was made fun of at the Poesje",0);}
        return new JsonObject{["paid_c"]=5,["line"]="You pay 5 centimes to the woman at the door and go down the steps into the smoke."};
    }
    public static string PlainEnglish(string input)
    {
        const string address="jongen|jong|maat|schat|manneke|manneken|baas|allee|allez|zeveraar|mijnheer|meneer|menier|madam|ventje|kerel|gast|sloeber",exclaim="ach|allee|allez|awel|amai|hé|goed|ja|nee|zeg|seg";const RegexOptions options=RegexOptions.IgnoreCase|RegexOptions.CultureInvariant;string s=Regex.Replace(input,@",\s*(?:"+address+@"),",",",options);s=Regex.Replace(s,@",\s*(?:"+address+@")(?!\w)(?=\s*(?:[.!?;:""\u201d]|$))","",options);s=Regex.Replace(s,@"(^|[""\u201c]\s*)(?:(?:"+address+"|"+exclaim+@")\s*[,.!]\s*)+(\S)",m=>m.Groups[1].Value+m.Groups[2].Value.ToUpperInvariant(),options);return Regex.Replace(s,@"\s{2,}"," ").Trim();
    }
    public static string? CleanLine(string s,int max=150,bool allowNumbers=false)
    {
        string text=PlainEnglish(Regex.Replace(s,@"[\r\n\t]+"," "));text=text[..Math.Min(max,text.Length)].Trim();if(text.Length==0||Regex.IsMatch(text,@"\b(fuck\w*|shit\w*|bastard\w*|whore\w*|cunt\w*|bitch\w*|damn\w*|bloody|christ|jesus|kill\w*|murder\w*|rape\w*|nigg\w*|jew\w*|gypsy)\b",RegexOptions.IgnoreCase)||!allowNumbers&&Regex.IsMatch(text,@"\d|\bfrancs?\b|\bcentimes?\b|\bsous?\b",RegexOptions.IgnoreCase)||Regex.IsMatch(text,@"[<>{}`\\]|https?:|\bsystem prompt\b|\bAI\b|\bmodel\b",RegexOptions.IgnoreCase))return null;return text;
    }
    private static JsonObject PlayView(JsonObject show) {var play=show["play"]!.DeepClone().AsObject();play["state"]="ready";play["source"]=show["source"]?.DeepClone();return play;}
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/interiors",r=>{var taverns=new JsonArray();foreach(var p in Places.Where(p=>p.Key.StartsWith("tavern:")&&p.Value?["door"]!=null)){var now=Tavern(r.PlayerId,p.Key);now.Remove("patrons");now["door"]=p.Value!["door"]!.DeepClone();now["out"]=p.Value["out"]?.DeepClone()??new JsonArray(0,-1);taverns.Add(now);}var d=PoesjeDoor();return new JsonObject{["taverns"]=taverns,["poesje"]=d==null?null:new JsonObject{["label"]="the Poesje",["door"]=new JsonArray(N(d["sx"]),N(d["sz"])),["wall"]=new JsonArray(N(d["x"]),N(d["z"])),["out"]=d["out"]!.DeepClone(),["open"]=DoorOpen,["door_opens"]=18.5,["show_from"]=19,["show_to"]=22,["price_c"]=5},["tipsy"]=Tipsy(r.PlayerId)};});
        service.Register("GET","/api/interior/:place",r=>{var answer=Tavern(r.PlayerId,Place(r.Param("place")));answer["tipsy"]=Tipsy(r.PlayerId);answer["dice"]=new JsonObject{["stakes"]=new JsonArray(2,5,10),["left"]=DiceLeft(r.PlayerId)};return answer;});
        service.Register("GET","/api/tipsy",r=>new JsonObject{["tipsy"]=Tipsy(r.PlayerId),["clock"]=host.Clock.View()});
        service.Register("POST","/api/interior/fire",r=>{var answer=Fire(r.PlayerId,Place(r.Text("place")));if(answer["warmed"]!.GetValue<bool>())host.PublishState(r.PlayerId);return NativeCoreClock.Join(answer,host.Payload(r.PlayerId));});
        service.RegisterAsync("POST","/api/interior/dice/sit",SitAsync);
        service.Register("POST","/api/interior/dice/throw",r=>{var answer=Throw(r.PlayerId,Place(r.Text("place")),S(Person(r.Text("patron")),"id"),N(r.Body["stake"]));host.PublishState(r.PlayerId);return NativeCoreClock.Join(answer,host.Payload(r.PlayerId));});
        service.RegisterAsync("POST","/api/interior/gossip",GossipAsync);
        service.RegisterAsync("POST","/api/interior/chat",ChatAsync);
        service.Register("GET","/api/poesje",r=>new JsonObject{["open"]=DoorOpen,["price_c"]=5,["play"]=ShowToday() is {} show?PlayView(show):new JsonObject{["state"]=writingShows.ContainsKey(Day)?"writing":"none"},["audience"]=new JsonArray(Audience().Select(p=>(JsonNode)PublicPerson(p)).ToArray())});
        service.Register("POST","/api/poesje/enter",r=>{var answer=Admit(r.PlayerId);if(ShowToday()==null)StartShow(r.PlayerId);if(N(answer["paid_c"])!=0)host.PublishState(r.PlayerId);return NativeCoreClock.Join(answer,host.Payload(r.PlayerId));});
        service.RegisterAsync("POST","/api/poesje/play",PlayAsync);
        service.TickHooks.Add((r,advanced)=>{if(Hour>=17&&ShowToday()==null)StartShow(r.PlayerId);});
        var previous=service.Trade.RefusePurchase;service.Trade.RefusePurchase=(who,npc)=>{var person=Residents.FirstOrDefault(r=>S(r,"id")==npc);string place=S(person?["work"],"place");return place.StartsWith("tavern:")&&!Welcome(who,place)?"\"We do not serve strangers here. Best be on your way.\"":previous?.Invoke(who,npc);};
        service.NewGame+=()=>{residents=null;recentConvos.Clear();generation++;writingShows.Clear();writingTaunts.Clear();};service.Loaded+=()=>{residents=null;recentConvos.Clear();generation++;writingShows.Clear();writingTaunts.Clear();};
    }
}


