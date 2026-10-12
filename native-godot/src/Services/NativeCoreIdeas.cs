using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

/// <summary>Persistent notices, private letters, lost notebooks and engine-owned job complications.</summary>
public sealed partial class NativeCoreIdeas : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private readonly JsonObject data;
    private int generation;
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync;
    public Func<int> DailyCallLimit = () => 120;
    public Func<int,string,string> TextFor = (_,text) => text;
    public Func<int,string,string> StoreText = (_,text) => text;
    public Func<JsonObject?>? PostCounter;
    private int Day => (int)N(host.Clock.View(),"day");
    private int Hour => (int)N(host.Clock.View(),"hour");
    private static string S(JsonNode? n,string key,string fallback="") => n?[key] is JsonValue v&&v.TryGetValue<string>(out var s)?s:fallback;
    private static double V(JsonNode? n,double fallback=0){if(n is JsonValue v){if(v.TryGetValue<double>(out var d))return d;if(v.TryGetValue<long>(out var l))return l;if(v.TryGetValue<int>(out var i))return i;}return fallback;}
    private static double N(JsonNode? n,string key,double fallback=0)=>V(n?[key],fallback);
    private static bool B(JsonNode? n,string key)=>n?[key] is JsonValue v&&v.TryGetValue<bool>(out var b)&&b;
    private static JsonArray A(JsonNode? n)=>n as JsonArray??new();
    private static JsonObject O(JsonNode? n)=>n as JsonObject??new();
    private static JsonObject Parse(string json)=>JsonNode.Parse(json)?.AsObject()??new();
    private static int Round(double n)=>(int)Math.Floor(n+.5);
    private static int Round5(double n)=>Round(n/5)*5;
    private static JsonObject Point(double x,double z)=>new(){["x"]=x,["z"]=z};
    private static double Distance(JsonNode a,JsonNode b)=>Math.Sqrt(Math.Pow(N(a,"x")-N(b,"x"),2)+Math.Pow(N(a,"z")-N(b,"z"),2));
    public static bool Within(JsonObject point,JsonObject target,double radius)=>double.IsFinite(N(point,"x",double.NaN))&&double.IsFinite(N(point,"z",double.NaN))&&Distance(point,target)<=radius;
    private static JsonObject At(NativeServiceRequest r)=>Point(N(r.Body,"x",double.NaN),N(r.Body,"z",double.NaN));
    private JsonObject? Resident(string id){string? text=C.Scalar<string>("SELECT data_json FROM resident WHERE id=$p0",id);return text==null?null:Parse(text);}
    private JsonObject[] Residents()=>C.Rows("SELECT data_json FROM resident ORDER BY id").Select(r=>Parse(S(r,"data_json"))).ToArray();
    private JsonObject Town=>O(C.World("town"));
    private JsonObject[] Family(JsonObject r)=>Residents().Where(p=>N(p,"household")==N(r,"household")&&S(p,"id")!=S(r,"id")).ToArray();
    private int Pockets(int who)=>C.Scalar<int>("SELECT COUNT(*) FROM item WHERE player_id=$p0",who);
    private int Money(int who)=>C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",who);
    private static string Cut(string text,int length)=>text.Length>length?text[..length]:text;
    private JsonObject Reply(int who,JsonObject value){foreach(var part in host.Payload(who))value[part.Key]=part.Value?.DeepClone();return value;}
    private void PushIdeas()=>host.Publish("ideas");
    private void PushJobs()=>host.PublishState();
    public NativeCoreIdeas(NativeServiceHost host){this.host=host;data=Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-ideas.json")));PolicePost=()=>data["policePost"]!.DeepClone().AsObject();}
    public void Register(NativeServiceHost service)
    {
        foreach(var item in O(data["items"]))C.Rules["items"]![item.Key]=item.Value?.DeepClone();
        service.Register("GET","/api/ideas",r=>View(r.PlayerId));
        service.Register("GET","/api/trouble",r=>new JsonObject{["trouble"]=TroubleForPlayer(r.PlayerId)});
        service.NewGame+=()=>{generation++;spotCache=null;};service.Loaded+=()=>{generation++;spotCache=null;};
        RegisterLetters(service);RegisterPosters(service);RegisterDiaries(service);RegisterTrouble(service);RegisterLifecycle(service);
    }
    public bool CanCallIdeas()=>NarrateAsync!=null&&C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook IN('poster','letter_reply','trouble','diary')",Day)<4
        &&(DailyCallLimit()==0||C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0",Day)<DailyCallLimit()-15);
    public JsonObject View(int who)
    {
        var view=PosterView(who);view["diaries"]=DiaryWorld(who);view["meetings"]=MeetingsOpen(who);view["trouble"]=TroubleForPlayer(who);view["news"]=NewsRow(Day);return view;
    }
    public JsonArray DiaryWorld(int who)
    {
        var result=new JsonArray();foreach(var n in C.Rows("SELECT id,owner,status,x,z FROM diary WHERE status='lying' OR (status='held' AND player_id=$p0)",who)){var r=n!.AsObject();var owner=Resident(S(r,"owner"));r["owner_name"]=S(owner,"name");r["door"]=owner==null?null:new JsonArray(N(owner["home"],"sx"),N(owner["home"],"sz"));result.Add(r.DeepClone());}return result;
    }
    public JsonObject? TroubleForPlayer(int who){int id=C.Scalar<int>("SELECT id FROM job WHERE status='taken' AND taken_by=$p0",who);return id==0?null:TroubleView(id);}
    public JsonObject? TroubleView(int job)
    {
        var row=C.One("SELECT * FROM job_trouble WHERE job_id=$p0",job);if(row==null)return null;var words=Parse(S(row,"words_json","{}"));var cast=A(JsonNode.Parse(S(row,"cast_json","[]")));var options=A(JsonNode.Parse(S(row,"options_json","[]")));var outcome=Parse(S(row,"result_json","{}"));
        return new JsonObject{["id"]=row["id"]?.DeepClone(),["job_id"]=job,["kind"]=row["kind"]?.DeepClone(),["after_s"]=row["after_s"]?.DeepClone(),["status"]=row["status"]?.DeepClone(),["source"]=row["source"]?.DeepClone(),["scene"]=words["scene"]?.DeepClone(),
            ["lines"]=new JsonArray(A(words["lines"]).Select(l=>(JsonNode)new JsonObject{["name"]=S(cast.ElementAtOrDefault((int)N(l,"who")),"name"),["who"]=cast.ElementAtOrDefault((int)N(l,"who"))?["id"]?.DeepClone(),["text"]=l?["text"]?.DeepClone()}).ToArray()),
            ["options"]=new JsonArray(A(words["options"]).Select((o,i)=>(JsonNode)new JsonObject{["n"]=i+1,["label"]=o?["label"]?.DeepClone(),["step"]=StepView(options.ElementAtOrDefault(i)?["step"])}).ToArray()),
            ["choice"]=row["choice"]?.DeepClone(),["result"]=outcome["text"]?.DeepClone(),["step"]=S(row,"status")=="chosen"&&N(row,"step_done")==0?StepView(outcome["step"]):null,["step_done"]=N(row,"step_done")!=0};
    }
    private static JsonObject? StepView(JsonNode? step)=>step==null?null:new(){["x"]=step["x"]?.DeepClone(),["z"]=step["z"]?.DeepClone(),["label"]=step["label"]?.DeepClone()};
    private static readonly Regex wordSums=new(@"\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|a|some|many)\s+(francs?|centimes?|guilders?|pounds?|napoleons?|louis|sous?|crowns?|thalers?)\b",RegexOptions.IgnoreCase|RegexOptions.CultureInvariant);
    private static readonly Regex gifts=new(@"\b(enclos\w*|banknote|bank note|money order|postal order|gold coins?|i send you (some|a little)? ?money|here is (some|a little) money|reward you with|i will pay you|i shall pay you|take this purse)\b",RegexOptions.IgnoreCase|RegexOptions.CultureInvariant);
    private static readonly Regex outOfWorld=new(@"\b(computer|internet|telephone|robots?|prompts?|artificial intelligence|language model|chatbot|assistant|video game|the player|instructions|my rules)\b|\bAI\b",RegexOptions.IgnoreCase|RegexOptions.CultureInvariant);
    public static bool NumbersOk(string text,IEnumerable<string> allowed)=>!wordSums.IsMatch(text)&&Regex.Matches(text,"[0-9]+").All(m=>allowed.Contains(m.Value));
    public static string[] DigitsOf(params string[] text)=>text.SelectMany(t=>Regex.Matches(t,"[0-9]+").Select(m=>m.Value)).ToArray();
    public bool NamesOk(string text,IEnumerable<string> allowed,bool jefAllowed){if(!jefAllowed&&Regex.IsMatch(text,@"\bJef\b"))return false;var names=allowed.Select(n=>n.ToLowerInvariant()).ToArray();string lower=text.ToLowerInvariant();return Residents().All(r=>{string name=S(r,"name").ToLowerInvariant();return !lower.Contains(name)||names.Any(n=>n.Contains(name)||name.Contains(n));});}
    private void Remember(int who,string npc,string text,int weight,string? gist=null,int tone=0)=>host.Trade.Remember(who,npc,StoreText(who,text),weight,gist==null?null:StoreText(who,gist),tone);
    private void Event(string verb,string text,int weight=3,string? actor=null,JsonObject? details=null,string? kind=null,string? refType=null,int? refId=null,string? target=null,int player=1)
    {
        C.Execute("INSERT INTO world_event(day,hour,minute,kind,verb,actor,text,weight,data_json,ref_type,ref_id,target) SELECT day,hour,minute,$p0,$p1,$p2,$p3,$p4,$p5,$p6,$p7,$p8 FROM player WHERE id=1",kind??"log",verb,actor,Cut(StoreText(player,text),300),Math.Clamp(weight,1,10),(details??new()).ToJsonString(),refType,refId,target);
        long id=C.Scalar<long>("SELECT last_insert_rowid()");foreach(var npc in new[]{actor,target}.Where(p=>p!=null).Distinct())C.Execute("INSERT INTO world_event_who(event_id,who) SELECT $p0,$p1 WHERE $p1 IN(SELECT id FROM npc)",id,npc);
    }
    public static Func<double> Random(uint seed)=>()=>{seed=unchecked(seed+0x6D2B79F5);uint t=seed;t=unchecked((t^(t>>15))*(t|1));t=unchecked(t^(t+unchecked((t^(t>>7))*(t|61))));return(t^(t>>14))/4294967296.0;};
}
