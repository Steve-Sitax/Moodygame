using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
namespace Scheldemist.Native.Services;

/// <summary>Paid fortunes, bounded promises, real visitor slots and dreams; model words cannot choose effects.</summary>
public sealed partial class NativeSurprises : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeActions actions;
    private readonly NativeFamilies families;
    private NativeServiceContext C=>host.Context;
    public JsonObject Facts {get;}
    public Action<JsonObject>? SaveVisitor;
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync;
    public Func<string,bool>? CanUseHook;
    public Func<int>? DailyCallLimit;
    private int generation;
    private bool arriving;
    private int pendingCalls;
    private readonly Dictionary<int,Task> dreams=new();
    private static string S(JsonNode? n,string k,string f="")=>NativeGoods.S(n,k,f);
    private static double N(JsonNode? n,string k,double f=0)=>NativeGoods.N(n,k,f);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static bool B(JsonNode? n,string k)=>NativeGoods.B(n,k);
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    private int Minute=>host.Clock.GameMinute();
    private static readonly string[] Kinds={"sailor","merchant","runaway","preacher","gambler"};
    private static readonly string[] PromiseKinds={"meeting","loss","gift","stranger"};
    private static readonly string[] SurpriseHooks={"stranger_arrive","rumour_twist","dream"};
    public NativeSurprises(NativeServiceHost host,NativeActions actions,NativeFamilies families){(this.host,this.actions,this.families)=(host,actions,families);Facts=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-family.json")))!.AsObject();}
    private IEnumerable<JsonObject> People=>C.Rows("SELECT data_json FROM resident ORDER BY id").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject());
    private bool MayCall(string hook)
    {
        if(NarrateAsync==null||CanUseHook?.Invoke(hook)==false)return false;int total=C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0",Day),limit=DailyCallLimit?.Invoke()??120;
        int mine=hook.StartsWith("resident",StringComparison.Ordinal)?C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook LIKE 'resident%'",Day):C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook IN('stranger_arrive','rumour_twist','dream')",Day);int running=C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND error='running' AND (hook LIKE 'resident%' OR hook IN('stranger_arrive','rumour_twist','dream'))",Day),unbooked=Math.Max(0,pendingCalls-running);return mine+unbooked<(hook.StartsWith("resident",StringComparison.Ordinal)?40:3)&&(limit==0||total+unbooked<limit-15);
    }
    private static string? Clean(string text,int max)
    {
        text=text.Trim();if(text.Length==0||text.Length>max||Regex.IsMatch(text,@"[<>\u0060\\]|\b(kill|murder|stab|shoot|weapon|gun|death|blood)\b|\b\d+\s*(centimes?|francs?)\b",RegexOptions.IgnoreCase))return null;return text;
    }
    private int Fact(string kind,string verb,string text,int weight,JsonObject? data=null,string? actor=null)
    {
        if(text.Length>300)text=text[..300];C.Execute("INSERT INTO world_event(day,hour,minute,kind,verb,actor,text,weight,data_json) SELECT day,hour,minute,$p0,$p1,$p2,$p3,$p4,$p5 FROM player WHERE id=1",kind,verb,actor,text,weight,(data??new JsonObject()).ToJsonString());int id=C.Scalar<int>("SELECT last_insert_rowid()");if(actor!=null&&C.Scalar<int>("SELECT COUNT(*) FROM npc WHERE id=$p0",actor)>0)C.Execute("INSERT INTO world_event_who(event_id,who) VALUES($p0,$p1)",id,actor);return id;
    }
    public JsonObject? Promise(int player)=>C.PlayerState(player,"fortune_promise")as JsonObject??(player==1?C.World("fortune_promise")as JsonObject:null);
    public async Task<JsonObject> TellFortune(int player)
    {
        var prepared=await host.WithState(_=>{
            var old=Promise(player);if(old!=null&&N(old,"day")==Day)return(Answer:(JsonObject?)new JsonObject{["text"]="The cards have spoken for today, my dear. Come back tomorrow."},Request:(JsonObject?)null,Generation:generation,Promise:(JsonObject?)null);
            if(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)<5)return(Answer:(JsonObject?)new JsonObject{["text"]="No coin, no cards, my dear. The cards are hungry too."},Request:(JsonObject?)null,Generation:generation,Promise:(JsonObject?)null);
            string kind=PromiseKinds[Math.Clamp((int)(C.Roll()*4),0,3)],text=S(Facts["fortuneFallback"],kind);var promise=new JsonObject{["day"]=Day,["kind"]=kind,["text"]=text,["due"]=Day+2,["status"]="pending"};C.Execute("UPDATE player SET money_c=money_c-5 WHERE id=$p0",player);C.SetPlayerState(player,"fortune_promise",promise);C.Log(player,"fortune","fortune","Jef paid Madame Zelie 5 centimes to read his fortune.");
            JsonObject? request=null;if(MayCall("resident_fortune")){pendingCalls++;var schema=NativeNorthNarration.Parse("""{"type":"object","properties":{"prophecy":{"type":"string","minLength":10,"maxLength":320},"promise":{"type":"string","enum":["meeting","loss","gift","stranger"]}},"required":["prophecy","promise"]}""");request=NativeNorthNarration.Request("resident_fortune",new(){["clock"]=host.Clock.View(),["player"]=host.Player(player),["recent_facts"]=C.Rows("SELECT verb,text FROM log WHERE player_id=$p0 ORDER BY id DESC LIMIT 12",player)},schema,"Speak as Madame Zelie over worn cards. Two to four vague, eerie, kind sentences from actual recent facts. Hint at one meeting, loss, gift or stranger in the next day or two. Never name a person, day, sum or state outcome; no weapons, death or harm.");}
            return(Answer:(JsonObject?)null,Request:request,Generation:generation,Promise:(JsonObject?)promise);}).ConfigureAwait(false);if(prepared.Answer!=null)return prepared.Answer;JsonObject? output=null;if(prepared.Request!=null)try{output=await NarrateAsync!(player,"resident_fortune",prepared.Request).ConfigureAwait(false);}catch{}
        return await host.WithState(_=>{if(generation!=prepared.Generation)throw new NativeServiceException("the week changed while the cards spoke",409);if(prepared.Request!=null)pendingCalls=Math.Max(0,pendingCalls-1);var promise=Promise(player);if(promise==null||N(promise,"day")!=N(prepared.Promise,"day"))return new JsonObject{["text"]="The cards are quiet now."};string source="engine";if(output!=null&&PromiseKinds.Contains(S(output,"promise"))&&Clean(S(output,"prophecy"),320)is {} prophecy){promise["text"]=prophecy;promise["kind"]=S(output,"promise");source="claude";}promise["status"]="open";C.SetPlayerState(player,"fortune_promise",promise);Fact("talk","fortune","Madame Zelie read Jef's cards ("+source+"); she foretold "+S(promise,"kind")+".",4,new(){["promise"]=S(promise,"kind"),["text"]=S(promise,"text")},"fortune");host.Trade.Remember(player,"fortune","I read the cards for Jef, the new man. They had something to say.",4);host.PublishState(player);return new JsonObject{["text"]="She lays out the cards, one by one. "+S(promise,"text")};}).ConfigureAwait(false);
    }
    private void StoreVisitor(JsonObject person)
    {
        if(SaveVisitor!=null){SaveVisitor(person);return;}string id=S(person,"id");C.Execute("UPDATE resident SET data_json=$p0,persona='' WHERE id=$p1",person.ToJsonString(),id);C.Execute("UPDATE npc SET name=$p0,role=$p1 WHERE id=$p2",S(person,"name"),S(person["visitor"],"label"),id);
    }
    public bool LeaveStranger(string id)
    {
        var person=actions.Resident(id);if(person==null||!B(person["visitor"],"here"))return false;var action=actions.Of(id);if(action!=null&&S(action,"source")!="event")actions.End((int)N(action,"id"),"stopped","left town");person["sched"]=new JsonObject{["day"]=new JsonArray(new JsonArray(0,24,"home")),["sunday"]=new JsonArray(new JsonArray(0,24,"home"))};person["visitor"]!["here"]=false;StoreVisitor(person);Fact("event","stranger_left",S(person,"name")+" left Antwerp.",3,actor:id);host.Publish("families",new(){["visitor"]=NativeFamilies.PublicVisitor(person)});return true;
    }
    public async Task<JsonObject?> Arrive(string? wanted=null)
    {
        var prepared=await host.WithState(_=>{
            if(arriving)return(Kind:"",Person:(JsonObject?)null,Request:(JsonObject?)null,Generation:generation);
            var away=People.Where(p=>S(p["visitor"],"role")=="stranger"&&!B(p["visitor"],"here")).ToArray();string last=S(C.World("strangers"),"last");var pool=away.Where(p=>S(p["visitor"],"kind")!=last).ToArray();if(pool.Length==0)pool=away;var person=away.FirstOrDefault(p=>S(p["visitor"],"kind")==wanted)??(pool.Length==0?null:pool[Math.Clamp((int)(C.Roll()*pool.Length),0,pool.Length-1)]);if(person==null)return(Kind:"",Person:(JsonObject?)null,Request:(JsonObject?)null,Generation:generation);arriving=true;string kind=S(person["visitor"],"kind");JsonObject? request=null;
            if(MayCall("stranger_arrive")){pendingCalls++;var schema=NativeNorthNarration.Parse("""{"type":"object","properties":{"first":{"type":"string","minLength":2,"maxLength":20},"surname":{"type":"string","minLength":2,"maxLength":24},"origin":{"type":"string","maxLength":40},"story":{"type":"string","maxLength":220},"goal":{"type":"string","maxLength":140},"secret":{"type":"string","maxLength":140},"greeting":{"type":"string","maxLength":160}},"required":["first","surname","origin","story","goal","secret","greeting"]}""");request=NativeNorthNarration.Request("stranger_arrive",new(){["kind"]=kind,["person"]=person.DeepClone(),["fixed_wants"]=Facts["strangerWants"]?[kind]?.DeepClone(),["clock"]=host.Clock.View()},schema,"Name a plausible stranger from a nearby country, never a famous person. Word their two-sentence story, secret and greeting, which asks about fixed_wants. The kind, age, stats, stay and actual errand are fixed by the engine. No weapons or killing.");}
            return(Kind:kind,Person:(JsonObject?)person.DeepClone().AsObject(),Request:request,Generation:generation);}).ConfigureAwait(false);if(prepared.Person==null)return null;JsonObject? output=null;if(prepared.Request!=null)try{output=await NarrateAsync!(1,"stranger_arrive",prepared.Request).ConfigureAwait(false);}catch{}
        return await host.WithState(_=>{if(generation!=prepared.Generation)return null;arriving=false;if(prepared.Request!=null)pendingCalls=Math.Max(0,pendingCalls-1);var person=prepared.Person;string kind=prepared.Kind;var words=Facts["strangerFallback"]![kind]!.DeepClone().AsObject();bool valid=output!=null&&Regex.IsMatch(S(output,"first"),@"^[A-Z][A-Za-z'À-ſ-]{1,23}( [A-Z][A-Za-z'À-ſ-]{1,23})?$")&&Regex.IsMatch(S(output,"surname"),@"^[A-Z][A-Za-z'À-ſ-]{1,23}( [A-Z][A-Za-z'À-ſ-]{1,23})?$")&&!People.Any(p=>S(p,"name")==S(output,"first")+" "+S(output,"surname"));
            if(valid&&Clean(S(output,"story"),220)!=null&&Clean(S(output,"secret"),140)!=null&&Clean(S(output,"greeting"),160)!=null&&Clean(S(output,"goal"),140)!=null){foreach(string field in new[]{"first","surname","origin","story","secret","greeting"})words[field]=output![field]?.DeepClone();words["goal"]="to find "+S(Facts["strangerWants"],kind);}
            string id=S(person,"id");person["first"]=words["first"]!.DeepClone();person["surname"]=words["surname"]!.DeepClone();person["name"]=S(words,"first")+" "+S(words,"surname");person["origin"]=S(words,"origin");C.Execute("DELETE FROM world_state WHERE key=$p0","errand:"+id);C.Execute("DELETE FROM player_state WHERE key=$p0","errand:"+id);person["sched"]=new JsonObject{["day"]=Facts["strangerDay"]![kind]!.DeepClone(),["sunday"]=Facts["strangerDay"]![kind]!.DeepClone()};var visitor=person["visitor"]!.AsObject();int stay=1+Math.Clamp((int)(C.Roll()*3),0,2);visitor["here"]=true;visitor["came"]=Day;visitor["leaves"]=Day+stay;foreach(string field in new[]{"story","goal","secret","greeting","origin"})visitor[field]=words[field]?.DeepClone();
            C.Execute("DELETE FROM npc_memory WHERE npc_id=$p0",id);C.Execute("UPDATE npc_relationship SET trust=0,affection=0,respect=0,fear=0,times_met=0,view_of_player='' WHERE npc_id=$p0",id);StoreVisitor(person);C.SetWorld("strangers",new JsonObject{["last"]=kind,["next"]=Day+stay+1});Fact("event","stranger_arrived","A stranger came to town: "+S(person,"name")+" from "+S(words,"origin")+". "+S(words,"story"),4,new(){["kind"]=kind,["source"]=valid?"claude":"engine",["stay"]=stay},id);host.Publish("families",new(){["visitor"]=NativeFamilies.PublicVisitor(person)});return person.DeepClone().AsObject();}).ConfigureAwait(false);
    }
    public JsonObject State(int player)
    {
        var people=People.ToArray();var fortune=people.FirstOrDefault(p=>S(p,"id")=="fortune");return new(){["fortune"]=fortune==null?null:new JsonObject{["id"]="fortune",["at"]=fortune["work"]?["at"]?.DeepClone()},["visitors"]=new JsonArray(people.Where(p=>S(p["visitor"],"role")=="stranger").Select(p=>(JsonNode)NativeFamilies.PublicVisitor(p)).ToArray()),["dream"]=C.PlayerState(player,"dream")?.DeepClone(),["schemes"]=C.Rows("SELECT id,kind,a,b,hour,status,outcome FROM town_scheme WHERE day=$p0 ORDER BY id",Day)};
    }
    public void Register(NativeServiceHost service)
    {
        var priorConvos=actions.Conversations;actions.Conversations=()=>new JsonArray(A(priorConvos?.Invoke()).Concat(RecentConvos()).Select(c=>c!.DeepClone()).ToArray());
        var priorTalk=actions.Reports.GetValueOrDefault("talk_to");actions.Reports["talk_to"]=(request,row)=>{var data=JsonNode.Parse(S(row,"data_json"));if(S(data,"purpose")!="scheme")return priorTalk?.Invoke(request,row);if(request.Text("phase")is "arrived"or"done"){_ = RunScheme((int)N(data,"scheme"));}else if(request.Text("phase")is "lost"or"blocked"){C.Execute("UPDATE town_scheme SET status='failed',outcome='never found them' WHERE id=$p0 AND status='running'",(int)N(data,"scheme"));actions.End((int)N(row,"id"),"failed","never found them");}return actions.Row((int)N(row,"id"));};actions.TimeUpHandlers.Add(row=>{var data=JsonNode.Parse(S(row,"data_json"));if(S(row,"kind")=="talk_to"&&S(data,"purpose")=="scheme")C.Execute("UPDATE town_scheme SET status='failed',outcome='never found them' WHERE id=$p0 AND status='running'",(int)N(data,"scheme"));return false;});
        families.SurprisesState=State;families.SurpriseDev=DevAsync;var previous=actions.Reserved;actions.Reserved=id=>id=="fortune"&&Hour>=9&&Hour<18||actions.Resident(id)?["visitor"]!=null||previous?.Invoke(id)==true;
        service.NewGame+=()=>{generation++;arriving=false;pendingCalls=0;dreams.Clear();runningSchemes.Clear();recentConvos.Clear();ticking=null;};service.Loaded+=()=>{generation++;arriving=false;pendingCalls=0;dreams.Clear();runningSchemes.Clear();recentConvos.Clear();ticking=null;foreach(var player in service.OnlinePlayers()){var promise=Promise(player);if(promise!=null&&S(promise,"status")is "pending"or"keeping"){promise["status"]="open";C.SetPlayerState(player,"fortune_promise",promise);}}};service.SleepEndedHooks.Add(QueueDream);service.TickHooks.Add((request,advanced)=>{if(advanced)Tick();});
    }
}

