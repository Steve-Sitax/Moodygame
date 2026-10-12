using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreIdeas
{
    private static string Weekday(int day)=>new[]{"Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"}[((day-1)%7+7)%7];
    private static string HourWords(int h)=>h<12?$"{(h==0?12:h)} in the morning":h==12?"noon":h<18?$"{h-12} in the afternoon":$"{h-12} at night";
    private bool HasRef(string reference)=>C.Scalar<int>("SELECT COUNT(*) FROM poster WHERE ref=$p0",reference)>0;
    private JsonObject? FreeSpot(JsonObject? near=null,params string[] prefer)
    {
        var used=C.Rows("SELECT spot FROM poster WHERE status='up'").Select(r=>S(r,"spot")).ToHashSet();var free=PosterSpots().Where(s=>!used.Contains(S(s,"id"))).ToArray();foreach(string prefix in prefer){var chosen=free.FirstOrDefault(s=>S(s,"id").StartsWith(prefix+":"));if(chosen!=null)return chosen!.DeepClone().AsObject();}return(near==null?free.FirstOrDefault():free.OrderBy(s=>Distance(s!,near)).FirstOrDefault())?.DeepClone().AsObject();
    }
    private static JsonObject PosterPlan(string kind,string reference,JsonObject spot,IEnumerable<string> facts,IEnumerable<string>? names=null,bool namesJef=false,int reward=0,string? owner=null,int days=1,JsonObject? thing=null,JsonObject? named=null)
    {
        var p=new JsonObject{["kind"]=kind,["ref"]=reference,["spot"]=spot.DeepClone(),["facts"]=new JsonArray(facts.Select(s=>(JsonNode)JsonValue.Create(s)!).ToArray()),["names"]=new JsonArray((names??Array.Empty<string>()).Select(s=>(JsonNode)JsonValue.Create(s)!).ToArray()),["names_jef"]=namesJef,["reward_c"]=reward,["owner"]=owner,["days"]=days};if(thing!=null)p["thing"]=thing.DeepClone();if(named!=null)p["named"]=named.DeepClone();return p;
    }
    public JsonArray WantedPlans()
    {
        var output=new JsonArray();if(C.Scalar<int>("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='deed'")>0)foreach(var d in C.Rows("SELECT * FROM deed WHERE status='open' AND quiet=0 AND day>=$p0 ORDER BY id",Day-1)){
            string thing=S(d,"thing");int reward=thing switch{"velocipede"=>100,"boat"=>150,"lantern"=>40,"purse"=>50,_=>0};string reference="deed:"+N(d,"id");if(reward==0||HasRef(reference))continue;var owner=Resident(S(d,"owner"));string name=S(owner,"name",C.Scalar<string>("SELECT name FROM npc WHERE id=$p0",S(d,"owner"))??"a townsman"),noun=S(data["things"]?[thing],"noun",thing);bool seen=N(d,"seen")==1;int thief=(int)N(d,"player_id",1);var witnesses=A(JsonNode.Parse(S(d,"witnesses","[]")));var facts=new[]{
                $"Taken: the {noun} of {name}, near {NearLabel(N(d,"x"),N(d,"z"))}, on {Weekday((int)N(d,"day"))} at about {HourWords((int)N(d,"hour"))}.",
                $"Reward: {reward} centimes, paid by {name}, for its return or for the thief's name at the police post.",
                seen?$"Seen by {(witnesses.Count>1?$"{witnesses.Count} witnesses":"a witness")}: the thief is Jef, a young day labourer new to the town, from the Kempen, in a thin coat.":"Nobody saw the thief."};
            var spot=FreeSpot(Point(N(d,"x"),N(d,"z")),seen?new[]{"police"}:Array.Empty<string>());if(spot==null)break;output.Add(PosterPlan("wanted",reference,spot,facts.Select(f=>StoreText(thief,f)),new[]{name},seen,reward,S(d,"owner"),3,named:seen?new JsonObject{["id"]=thief,["name"]=StoreText(thief,"Jef")}:null));
        }
        foreach(var e in C.Rows("SELECT id,day,hour,data_json FROM world_event WHERE verb='robbery_escaped' AND day>=$p0 ORDER BY id",Day-1)){string reference="we:"+N(e,"id");if(HasRef(reference)||C.Scalar<int>("SELECT COUNT(*) FROM world_event WHERE verb='robbery_solved' AND ref_id=$p0",N(e,"id"))>0)continue;var details=Parse(S(e,"data_json","{}"));var victim=Resident(S(details,"victim"));if(victim==null)continue;var spot=FreeSpot(null,"police","grote_markt","vismarkt");if(spot==null)break;output.Add(PosterPlan("wanted",reference,spot,new[]{
            $"A pickpocket took the purse of {S(victim,"name")}, {N(details,"amount_c")} centimes, {(S(details,"place")!=""?"at "+S(details,"place"):"in the street")}, on {Weekday((int)N(e,"day"))} at about {HourWords((int)N(e,"hour"))}, and got away.",
            "Reward: 50 centimes from the police for the thief's name, given to an agent of the police."},new[]{S(victim,"name")},false,50,S(details,"victim"),3));}return output;
    }
    public static string DogWords(string look)=>Regex.Replace(look,"^dog_","").Replace('_',' ');
    private static readonly string[] lostItems={"a grey wool shawl","a brass tobacco box","a string of rosary beads","a pair of spectacles in a tin case","a bunch of keys on an iron ring","a child's rag doll"};
    public JsonObject? LostPlan(Func<double> rng)
    {
        if(C.Scalar<int>("SELECT COUNT(*) FROM poster WHERE kind='lost' AND status='up'")>=2)return null;var pool=Residents().Where(r=>N(r,"age")>=18&&S(r,"trade") is not("soldier" or "sentry" or "corporal" or "thief" or "emigrant" or "runner")).ToArray();if(pool.Length==0)return null;var dogs=pool.Where(r=>r["dog"]!=null).ToArray();bool dog=dogs.Length>0&&rng()<.5;var options=dog?dogs:pool;var owner=options[(int)Math.Floor(rng()*options.Length)];string reference=$"lost:{S(owner,"id")}:{Day}";if(HasRef(reference))return null;var home=Point(N(owner["home"],"sx"),N(owner["home"],"sz"));var doors=(Doors?.Invoke()??Array.Empty<JsonObject>()).Where(d=>{double distance=Distance(Point(N(d,"sx"),N(d,"sz")),home);return distance>=60&&distance<=220;}).ToArray();if(doors.Length==0)return null;var at=doors[(int)Math.Floor(rng()*doors.Length)];var drop=Snap?.Invoke(N(at,"sx")+V(at["out"]?[0])*.8,N(at,"sz")+V(at["out"]?[1])*.8,2);var p=drop==null?Point(N(at,"sx"),N(at,"sz")):Point(drop.Value.X,drop.Value.Z);
        string what=dog?$"{S(owner,"first")}'s dog {S(owner["dog"],"name")}":lostItems[(int)Math.Floor(rng()*lostItems.Length)];int reward=Round5(dog?Math.Clamp(20+N(owner["stats"],"wealth")*3,20,40):Math.Clamp(10+N(owner["stats"],"wealth")*2,10,30));var facts=dog?new[]{
            $"Lost: a {DogWords(S(owner["dog"],"look"))} dog called {S(owner["dog"],"name")}, since {Weekday(Day-1)} evening. Last seen near {NearLabel(N(p,"x"),N(p,"z"))}.",
            $"Reward: {reward} centimes on bringing him back to the door of {S(owner,"name")}, near {NearLabel(N(home,"x"),N(home,"z"))}."}:new[]{
            $"Lost: {what}, belonging to {S(owner,"name")}, dropped in the street on {Weekday(Day-1)}, somewhere near {NearLabel(N(p,"x"),N(p,"z"))}.",
            $"Reward: {reward} centimes on bringing it back to the door of {S(owner,"name")}, near {NearLabel(N(home,"x"),N(home,"z"))}."};var spot=FreeSpot(home);if(spot==null)return null;var thing=new JsonObject{["what"]=what,["x"]=Fixed(N(p,"x"),2),["z"]=Fixed(N(p,"z"),2),["state"]="lying"};if(dog)thing["dog"]=owner["dog"]!.DeepClone();return PosterPlan("lost",reference,spot,facts,new[]{S(owner,"name")},false,reward,S(owner,"id"),3,thing);
    }
    public JsonArray SailingPlans()
    {
        var plans=new JsonArray();for(int day=Day;day<=Day+1;day++)foreach(var sail in A(data["sailings"])){int weekday=(day-1)%7+1;if(day>7||!A(sail?["days"]).Any(d=>V(d)==weekday))continue;string key=S(sail,"key"),reference=$"sail:{key}:{day}";if(HasRef(reference)||C.Scalar<int>("SELECT COUNT(*) FROM poster WHERE status='up' AND ref LIKE $p0",$"sail:{key}:%")>0)continue;var spot=FreeSpot(null,key=="harwich"?new[]{"werf","steenplein"}:new[]{"rijnkaai","steenplein","vismarkt"});if(spot!=null)plans.Add(PosterPlan("sailing",reference,spot,A(sail?["factsByDay"]?[day.ToString()]).Select(s=>s!.GetValue<string>()),days:day-Day+1));}return plans;
    }
    public JsonArray AuctionPlans()
    {
        var plans=new JsonArray();var pawn=C.One("SELECT id,item_name,due_day FROM pawn WHERE status='held' ORDER BY due_day LIMIT 1");if(pawn!=null&&!HasRef("berg:"+N(pawn,"due_day"))&&FreeSpot(null,"vleeshuis","vismarkt") is {} berg)plans.Add(PosterPlan("auction","berg:"+N(pawn,"due_day"),berg,new[]{$"Berg van Barmhartigheid: public sale of pledges not redeemed by the end of {Weekday((int)N(pawn,"due_day"))}.","Clothing, linen, tools, clocks, silver and small jewels. Viewing at the Berg by the Vleeshuis."},days:Math.Max(1,(int)N(pawn,"due_day")-Day+2)));
        foreach(var e in C.Rows("SELECT id,title,place,start_m,stages_json FROM town_event WHERE status IN('planned','running') AND(title LIKE '%auction%' OR title LIKE '%sale%')")){if(HasRef("ev:"+N(e,"id")))continue;int minute=Round(N(e,"start_m")%1440/15)*15;string label=S(A(JsonNode.Parse(S(e,"stages_json","[]"))).FirstOrDefault(),"label",S(e,"place"));var spot=FreeSpot(null,"vismarkt","grote_markt");if(spot!=null)plans.Add(PosterPlan("auction","ev:"+N(e,"id"),spot,new[]{$"{S(e,"title")}, at {label}, today from about {minute/60}:{minute%60:00}."}));}
        int wd=(Day-1)%7+1;if(wd is 3 or 4&&!HasRef("timber:4")&&FreeSpot(null,"werf","rijnkaai")is{} timber)plans.Add(PosterPlan("auction","timber:4",timber,new[]{"Public sale of Baltic timber, deals and staves, landed from Riga, on Thursday at 10 in the morning on the Werf.","By order of the owners. Terms at the sale."},days:5-wd));return plans;
    }
    public JsonArray OrderPlans()
    {
        var plans=new JsonArray();void Add(string reference,string[] prefer,string[] facts,int days){if(HasRef(reference))return;var spot=FreeSpot(null,prefer);if(spot!=null)plans.Add(PosterPlan("order",reference,spot,facts,days:days));}int wd=(Day-1)%7+1;
        if(wd is 2 or 5)Add("market:"+(Day+1),new[]{"grote_markt","cathedral"},new[]{$"Market on the Grote Markt on {Weekday(Day+1)}, from half past 7 in the morning. Carts and stalls off the square by 2 in the afternoon.","By order of the burgomaster and aldermen."},2);
        if(Day>=1)Add("order:quays",new[]{"rijnkaai","steenplein","werf"},new[]{"No loitering on the quays after 10 at night. Nobody to cross the quay rails while the wagons move.","By order of the commissioner of police."},4);
        if(Day>=2)Add("order:dogs",new[]{"vismarkt","canal","grote_markt"},new[]{"Dogs in the street to be muzzled or on a lead until the end of October, for fear of madness.","Dogs found loose will be taken up. By order of the burgomaster."},4);
        if(C.Scalar<int>("SELECT COUNT(*) FROM world_event WHERE day>=$p0 AND verb IN('robbed','street_robbery','robbery_escaped','stole')",Day-1)>0)Add("order:pickpockets:"+Day,new[]{"police","vismarkt","grote_markt"},new[]{"Beware of pickpockets at the markets, the shows and the quays. Keep your purse inside your coat.","Report every theft to the police post by the town hall. By order of the commissioner of police."},2);return plans;
    }
    public JsonArray MorningPlans(Func<double>? random=null)
    {
        var rng=random??Random(unchecked((uint)((N(Town,"seed")==0?1873:N(Town,"seed"))*17+Day*7919)));int room=Math.Max(0,Math.Min(3,9-C.Scalar<int>("SELECT COUNT(*) FROM poster WHERE status='up'")));var picks=new JsonArray();if(room==0)return picks;var spots=new HashSet<string>();void Take(JsonArray plans){foreach(var node in plans){if(picks.Count>=room)return;var p=node!.DeepClone().AsObject();if(spots.Contains(S(p["spot"],"id"))){var spare=PosterSpots().FirstOrDefault(s=>!spots.Contains(S(s,"id"))&&C.Scalar<int>("SELECT COUNT(*) FROM poster WHERE status='up' AND spot=$p0",S(s,"id"))==0);if(spare==null)continue;p["spot"]=spare.DeepClone();}spots.Add(S(p["spot"],"id"));picks.Add(p);}}
        Take(WantedPlans());if(rng()<.55&&LostPlan(rng)is{} lost)Take(new JsonArray(lost));Take(SailingPlans());Take(AuctionPlans());Take(OrderPlans());return picks;
    }
    public static JsonObject EnginePoster(JsonObject p)
    {
        string kind=S(p,"kind"),heading=kind switch{"wanted"=>B(p,"names_jef")?"WANTED: "+S(p["named"],"name","Jef").ToUpperInvariant():"THEFT. REWARD","lost"=>p["thing"]?["dog"]!=null?"LOST DOG. REWARD":"LOST. REWARD","sailing"=>S(p,"ref").StartsWith("sail:kempenland")?"RED STAR LINE":"SAILINGS","auction"=>"PUBLIC SALE",_=>"NOTICE"};var facts=A(p["facts"]).Select(f=>f!.GetValue<string>()).ToArray();string? by=facts.Skip(1).FirstOrDefault(f=>f.StartsWith("By order"));return new(){["heading"]=heading,["body"]=string.Join(" ",facts.Where((f,i)=>i==0||f!=by)),["footer"]=by??(kind=="wanted"?"Information to the police post by the town hall.":"")};
    }
    public JsonObject? CleanPoster(JsonObject plan,JsonObject output)
    {
        string heading=Cut(NativeCoreInteriors.PlainEnglish(S(output,"heading")).ToUpperInvariant(),50),body=NativeCoreInteriors.PlainEnglish(S(output,"body")),footer=Cut(NativeCoreInteriors.PlainEnglish(S(output,"footer")),100),all=$"{heading} {body} {footer}";
        if(!NumbersOk(all,DigitsOf(A(plan["facts"]).Select(f=>f!.GetValue<string>()).ToArray()))||!NamesOk(all,A(plan["names"]).Select(n=>n!.GetValue<string>()),B(plan,"names_jef")&&N(plan["named"],"id",1)==1)||gifts.IsMatch(all)||outOfWorld.IsMatch(all)||N(plan,"reward_c")!=0&&!all.Contains(N(plan,"reward_c").ToString())||body.Length<10)return null;return new(){["heading"]=heading,["body"]=body,["footer"]=footer};
    }
    private long InsertPoster(JsonObject p,JsonObject text,string source)
    {
        C.Execute("INSERT INTO poster(kind,spot,day,hour,down_day,status,ref,facts_json,text_json,source,names_jef,reward_c,owner,thing_json) VALUES($p0,$p1,$p2,$p3,$p4,'up',$p5,$p6,$p7,$p8,$p9,$p10,$p11,$p12)",S(p,"kind"),S(p["spot"],"id"),Day,Hour,Day+Math.Max(1,(int)N(p,"days"))-1,S(p,"ref"),A(p["facts"]).ToJsonString(),text.ToJsonString(),source,B(p,"names_jef")?(int)N(p["named"],"id",1):0,N(p,"reward_c"),p["owner"]==null?null:S(p,"owner"),O(p["thing"]).ToJsonString());long id=C.Scalar<long>("SELECT last_insert_rowid()");Event("poster_up",$"A bill went up at {S(p["spot"],"label")}: {S(text,"heading")}. {A(p["facts"]).FirstOrDefault()?.GetValue<string>()}",S(p,"kind")=="wanted"?(B(p,"names_jef")?6:4):2,p["owner"]==null?null:S(p,"owner"),new JsonObject{["poster"]=id,["kind"]=S(p,"kind")});if(S(p,"kind")=="wanted"&&B(p,"names_jef"))C.Execute("INSERT INTO world_fact(text,weight,day,tags)VALUES($p0,6,$p1,'notice,poster')",StoreText((int)N(p["named"],"id",1),$"A bill at {S(p["spot"],"label")} says Jef, the new day labourer, is wanted for a theft; {N(p,"reward_c")} centimes reward."),Day);return id;
    }
    private static readonly JsonObject posterSchema=Parse("""{"type":"object","properties":{"posters":{"type":"array","maxItems":8,"items":{"type":"object","properties":{"n":{"type":"integer"},"heading":{"type":"string","minLength":2,"maxLength":50},"body":{"type":"string","minLength":10,"maxLength":380},"footer":{"type":"string","maxLength":100}},"required":["n","heading","body","footer"]}}},"required":["posters"]}""");
    public async Task<JsonArray> PutUp(JsonArray plans)
    {
        if(plans.Count==0)return new();var prepare=await host.WithState(_=>new JsonObject{["generation"]=generation,["request"]=CanCallIdeas()?new JsonObject{["system"]=S(data,"posterSystem"),["prompt"]="Word these bills, one each, by number (\"n\").\n\n"+string.Join("\n\n",plans.Select((p,i)=>$"BILL {i+1} ({S(p,"kind")})\n"+string.Join("\n",A(p?["facts"]).Select(f=>"- "+f!.GetValue<string>()))))+"\n\nWRITE for each bill: n; heading (a few words, capitals); body (2 or 3 short sentences, only the facts); footer (who orders or pays, from the facts, or \"\").",["schema"]=posterSchema.DeepClone()}:null});JsonObject? output=null;if(prepare["request"]is JsonObject request&&NarrateAsync!=null)try{output=await NarrateAsync(1,"poster",request).ConfigureAwait(false);}catch{/* Engine words remain. */}
        return await host.WithState(_=>{var ids=new JsonArray();if(generation!=N(prepare,"generation"))return ids;C.Atomic(()=>{foreach(var(pair,index)in plans.Select((p,i)=>(p,i))){var p=pair!.DeepClone().AsObject();if(HasRef(S(p,"ref")))continue;if(C.Scalar<int>("SELECT COUNT(*) FROM poster WHERE status='up' AND spot=$p0",S(p["spot"],"id"))>0){var spot=FreeSpot(p["thing"]is JsonObject t?Point(N(t,"x"),N(t,"z")):null);if(spot==null)continue;p["spot"]=spot;}var authored=A(output?["posters"]).FirstOrDefault(n=>N(n,"n")==index+1);var words=authored==null?null:CleanPoster(p,authored.AsObject());ids.Add(InsertPoster(p,words??EnginePoster(p),words==null?"engine":"claude"));}});return ids;});
    }
    private void RegisterPosters(NativeServiceHost service)
    {
        service.Register("GET","/api/posters/spots",_=>new JsonObject{["spots"]=PosterSpots()});service.Register("POST","/api/posters/:id/pick",r=>{var result=PickLost(r.PlayerId,int.Parse(r.Param("id")),At(r));PushIdeas();return Reply(r.PlayerId,result);});service.Register("POST","/api/posters/:id/return",r=>{var result=ReturnLost(r.PlayerId,int.Parse(r.Param("id")),At(r));PushIdeas();PushJobs();return Reply(r.PlayerId,result);});
    }
}
