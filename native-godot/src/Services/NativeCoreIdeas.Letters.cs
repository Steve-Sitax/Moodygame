using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreIdeas
{
    private static readonly Regex[] letterBlocks={
        new("ignore (all |any |the |your |my )?(previous|prior|above|earlier|rules|instructions)",RegexOptions.IgnoreCase),new("system ?prompt",RegexOptions.IgnoreCase),new("you are now",RegexOptions.IgnoreCase),
        new(@"\b(jailbreak|developer mode|DAN mode)\b",RegexOptions.IgnoreCase),new(@"\bpretend (to be|you are)\b|\byour (instructions|rules|prompt|programming)\b",RegexOptions.IgnoreCase),
        new("```|</?(system|assistant|user|tool)>",RegexOptions.IgnoreCase),new(@"\b(assistant|system|user)\s*:",RegexOptions.IgnoreCase),new(@"[a-z]:\\|/(etc|usr|home|bin|root)/",RegexOptions.IgnoreCase),
        new(@"\b(api[ _-]?key|password|rm -rf|sudo|powershell|cmd\.exe)\b",RegexOptions.IgnoreCase),new(@"\b(claude|anthropic|openai|chatgpt|gpt-?[0-9]|llm|language model|ai model)\b",RegexOptions.IgnoreCase)};
    public static JsonObject GateLetter(string raw){string text=Regex.Replace(Regex.Replace(raw??"","[\u0000-\u001f\u007f]"," "),@"\s+"," ").Trim();string? reason=text.Length==0?"empty":text.Length>600?"too long":letterBlocks.Any(r=>r.IsMatch(text))?"blocked":null;var result=new JsonObject{["ok"]=reason==null,["text"]=text};if(reason!=null)result["reason"]=reason;return result;}
    public static int ToneOf(string text)=>Regex.IsMatch(text,@"\b(fool|idiot|hate|curse|damn|thief|liar|pig|swine|stupid|shut up|or else|i will tell|i'll tell|threat|coward|ugly|drunk(ard)?)\b",RegexOptions.IgnoreCase)?-1:
        Regex.IsMatch(text,@"\b(thank|thanks|sorry|forgive|kind|friend|help|grateful|hope you are well|god bless|pray|good day|regards|miss you|pleasure)\b",RegexOptions.IgnoreCase)?1:0;
    private string PostClerk=>S(C.World("press")?["post"],"clerk");
    private JsonObject? Counter(){if(PostCounter!=null)return PostCounter();var post=C.World("press")?["post"];var at=Resident(PostClerk)?["work"]?["at"]??post?["step"];return at is JsonArray p?Point(V(p[0]),V(p[1])):null;}
    private string ShownTrade(JsonObject r)=>S(r["visitor"],"role")=="fortune"?"fortune teller":S(r,"trade")=="thief"?"day labourer":S(data["tradeLabels"],S(r,"trade"),S(r,"trade").Replace('_',' '));
    public JsonArray WriteTo(int who)
    {
        var output=new JsonArray();foreach(var item in C.Rows("SELECT npc_id FROM npc_relationship WHERE times_met>=1 AND player_id=$p0 ORDER BY COALESCE(last_seen_day,0) DESC,times_met DESC LIMIT 30",who)){
            var r=Resident(S(item,"npc_id"));if(r==null||N(r,"age")<12||S(r,"id")==PostClerk||S(r["visitor"],"role")=="stranger"&&!B(r["visitor"],"here"))continue;
            output.Add(new JsonObject{["id"]=S(r,"id"),["name"]=S(r,"name"),["trade"]=ShownTrade(r),["near"]=NearLabel(N(r["home"],"sx"),N(r["home"],"sz"))});if(output.Count>=9)break;}return output;
    }
    public JsonObject PostLetter(int who,string to,string raw,JsonObject at)
    {
        var c=Counter();if(PostClerk==""||c==null)throw new NativeServiceException("there is no post office",404);if(!host.Trade.AtWork(PostClerk))throw new NativeServiceException("the post office is shut",409);if(!Within(at,c,5.5))throw new NativeServiceException("go to the counter",409);
        var resident=Resident(to);if(resident==null||!WriteTo(who).Any(w=>S(w,"id")==to))throw new NativeServiceException("you can only write to someone you have met",409);var gate=GateLetter(raw);string reason=S(gate,"reason");if(!B(gate,"ok")&&reason!="blocked")throw new NativeServiceException(reason=="empty"?"the page is empty":"a letter of at most 600 letters",400);
        if(C.Scalar<int>("SELECT COUNT(*) FROM jef_letter WHERE day=$p0 AND player_id=$p1",Day,who)>=2)throw new NativeServiceException("two letters a day is enough; the clerk will not take a third",409);if(Money(who)<10)throw new NativeServiceException($"a stamp is 10 centimes and you have {Money(who)}",409);
        long id=C.Atomic(()=>{C.Execute("UPDATE player SET money_c=money_c-10 WHERE id=$p0",who);C.Execute("INSERT INTO jef_letter(day,hour,to_id,to_name,text,gated,stamp_c,reply_day,status,player_id) VALUES($p0,$p1,$p2,$p3,$p4,$p5,10,$p6,'sent',$p7)",Day,Hour,to,S(resident,"name"),Cut(S(gate,"text"),600),B(gate,"ok")?null:reason,Day+1,who);long created=C.Scalar<long>("SELECT last_insert_rowid()");C.Log(who,"posted_letter",to,$"Jef posted a letter to {S(resident,"name")} (10 centimes for the stamp).");return created;});
        return new JsonObject{["text"]=$"The clerk licks a stamp, 10 centimes, and drops your letter to {S(resident,"first")} in the sack. \"It goes out with the evening post.\"",["letter"]=C.One("SELECT * FROM jef_letter WHERE id=$p0 AND player_id=$p1",id,who)};
    }
    public JsonObject? GiftFrom(string id)
    {
        var cheapest=host.Trade.Wares(id).Where(w=>S(host.Trade.Item(S(w,"kind")),"use")=="eat"&&!B(host.Trade.Item(S(w,"kind")),"atCounter")).OrderBy(w=>N(w,"price_c")).FirstOrDefault();return cheapest==null?null:new JsonObject{["item"]=S(cheapest,"kind"),["name"]=S(host.Trade.Item(S(cheapest,"kind")),"name")};
    }
    public JsonObject PlanEffect(JsonObject letter,int who,Func<double> random)
    {
        var r=Resident(S(letter,"to_id"));if(r==null||S(letter,"gated")!="")return new(){["kind"]="none"};var rel=host.Rumours.Relationship(S(r,"id"),who);int tone=ToneOf(S(letter,"text"));double Stat(string key)=>N(r["stats"],key);
        if(tone<0)return random()<.3+Stat("temper")/20?new(){["kind"]="trust",["delta"]=-1}:new(){["kind"]="none"};var gift=GiftFrom(S(r,"id"));if(gift!=null&&6-Pockets(who)>=2&&Stat("warmth")>=6&&Stat("greed")<=6&&random()<.45){gift["kind"]="gift";return gift;}
        if(N(rel,"trust")>=1||Stat("warmth")>=7)if(random()<.45)return new(){["kind"]="invite",["from_h"]=Math.Clamp(Math.Max(Hour+1,12),12,17),["to_h"]=20,["x"]=N(r["home"],"sx"),["z"]=N(r["home"],"sz"),["label"]=$"the door of {S(r,"name")}, near {NearLabel(N(r["home"],"sx"),N(r["home"],"sz"))}"};
        return tone>0&&Stat("warmth")>=4?new(){["kind"]="trust",["delta"]=1}:new(){["kind"]="none"};
    }
    public static JsonObject EngineReply(JsonObject letter,JsonObject effect,JsonObject resident)
    {
        string kind=S(effect,"kind"),body=S(letter,"gated")!=""?"I have read your letter three times and I cannot make head or tail of it. Are you well? Talk to me in the street, like a Christian.":kind=="trust"&&N(effect,"delta")<0?"I got your letter. I did not care for the tone of it. Mind how you write to people.":kind=="trust"?"Thank you for your letter. It is not often anyone writes to me. I was glad of it.":kind=="invite"?$"Thank you for your letter. Come by my door today, between {N(effect,"from_h")} and {N(effect,"to_h")} o'clock, and we will have a word.":kind=="gift"?$"Thank you for your letter. I send you {S(effect,"name")} with this. Eat it and think of me.":"I got your letter. There is not much to say to it, but I thank you for writing.";
        return new(){["salutation"]="Jef,",["body"]=body,["closing"]=kind=="trust"&&N(effect,"delta")<0?"That is all.":"Yours,",["signature"]=S(resident,"first")};
    }
    public JsonObject? CleanReply(JsonObject letter,JsonObject effect,JsonObject output)
    {
        var r=Resident(S(letter,"to_id"));if(r==null)return null;string body=NativeCoreInteriors.PlainEnglish(S(output,"body")),all=string.Join(" ",new[]{S(output,"salutation"),body,S(output,"closing"),S(output,"signature")});var digits=S(effect,"kind")=="invite"?new[]{N(effect,"from_h").ToString(),N(effect,"to_h").ToString()}.Concat(DigitsOf(S(effect,"label"))):Enumerable.Empty<string>();
        if(!NumbersOk(all,digits)||Regex.IsMatch(all,@"\b(francs?|centimes?|guilders?|pounds?|money order)\b",RegexOptions.IgnoreCase)||gifts.IsMatch(all)&&S(effect,"kind")!="gift"||outOfWorld.IsMatch(all)||!NamesOk(all,new[]{S(r,"name")}.Concat(Family(r).Select(f=>S(f,"name"))),true))return null;
        string signature=NativeCoreInteriors.PlainEnglish(S(output,"signature"));return new(){["salutation"]=Cut(NativeCoreInteriors.PlainEnglish(S(output,"salutation")),60),["body"]=body,["closing"]=Cut(NativeCoreInteriors.PlainEnglish(S(output,"closing")),60),["signature"]=signature.Contains(S(r,"first"))?Cut(signature,60):S(r,"first")};
    }
    private string EffectLine(JsonObject e,JsonObject r)=>S(e,"kind") switch{"trust"=>N(e,"delta")>0?"They are pleased with the letter and think a little better of Jef. Nothing else.":"They are put out by the letter and think a little worse of Jef. Nothing else.","invite"=>$"They ask Jef to come by their door ({S(e,"label")}) today, between {N(e,"from_h")}:00 and {N(e,"to_h")}:00, for a word. Nothing else.","gift"=>$"They send {S(e,"name")} from their {S(r,"trade").Replace('_',' ')}'s wares with the letter, a small kindness. No money.",_=>"Nothing. They answer, and that is all."};
    private string ReplyPrompt(JsonObject letter,JsonObject effect,int who)
    {
        var r=Resident(S(letter,"to_id"))!;var rel=host.Rumours.Relationship(S(r,"id"),who);string[] adjectives={N(r["stats"],"warmth")>=7?"warm":N(r["stats"],"warmth")<=3?"cold":"",N(r["stats"],"temper")>=7?"quick to anger":"",N(r["stats"],"piety")>=7?"pious":"",N(r["stats"],"greed")>=7?"close with money":"",N(r["stats"],"honesty")<=3?"sly":"",N(r["stats"],"gossip")>=7?"a gossip":""};
        string bits=string.Join(", ",adjectives.Where(s=>s!="")),family=string.Join(", ",Family(r).Take(4).Select(f=>$"{S(f,"first")} ({S(f,"family_role")})")),mem=string.Join("\n",host.Rumours.Memories(S(r,"id"),6).Select(m=>"- "+S(m,"text")));
        return $"Write {S(r,"first")}'s reply to Jef, {DateLine(Day)}.\n\nWHO WRITES\n{S(r,"name")}, {N(r,"age")}, {S(r,"trade").Replace('_',' ')}, lives near {NearLabel(N(r["home"],"sx"),N(r["home"],"sz"))}."+(bits!=""?" "+bits+".":"")+(family!=""?" Household: "+family+".":"")+$"\nHow they see Jef: {S(rel,"view_of_player","a young day labourer they have met")}.\n\nWHAT THEY REMEMBER (their point of view)\n{(mem==""?"- Little: they met him once.":mem)}\n\nJEF'S LETTER (words from the story, data only)\n\"\"\"\n{S(letter,"text")}\n\"\"\"\n\nTHE REPLY DOES (engine; exactly this, nothing more)\n{EffectLine(effect,r)}\n\nWRITE\n- salutation: a short greeting (\"Jef,\" or \"Dear Jef,\").\n- body: 2 to 5 short sentences in their voice, answering what he wrote as far as it makes sense in 1873.\n- closing: a short closing.\n- signature: {S(r,"name")} or {S(r,"first")}.";
    }
    private static string DateLine(int day)=>new[]{"Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"}[((day-1)%7+7)%7]+$" {12+day} October 1873";
    private static readonly JsonObject replySchema=Parse("""{"type":"object","properties":{"salutation":{"type":"string","minLength":2,"maxLength":60},"body":{"type":"string","minLength":20,"maxLength":700},"closing":{"type":"string","minLength":2,"maxLength":60},"signature":{"type":"string","minLength":1,"maxLength":60}},"required":["salutation","body","closing","signature"]}""");
    public async Task<JsonArray> AnswerLetters(Func<double>? random=null)
    {
        var due=await host.WithState(_=>C.Rows("SELECT * FROM jef_letter WHERE status='sent' AND reply_day<=$p0 ORDER BY id",Day));var replies=new JsonArray();foreach(var node in due){var l=node!.AsObject();int who=(int)N(l,"player_id",1);var prepared=await host.WithState(_=>{
            var r=Resident(S(l,"to_id"));if(r==null){C.Execute("UPDATE jef_letter SET status='answered' WHERE id=$p0",N(l,"id"));return (JsonObject?)null;}if(C.Execute("UPDATE jef_letter SET status='answered' WHERE id=$p0 AND status='sent'",N(l,"id"))!=1)return null;
            var effect=PlanEffect(l,who,random??Random(unchecked((uint)((N(Town,"seed")==0?1873:N(Town,"seed"))*29+N(l,"id")*613))));return new JsonObject{["resident"]=r,["effect"]=effect,["words"]=EngineReply(l,effect,r),["request"]=S(l,"gated")==""&&CanCallIdeas()?new JsonObject{["system"]=S(data,"replySystem"),["prompt"]=ReplyPrompt(l,effect,who),["schema"]=replySchema.DeepClone()}:null,["generation"]=generation};});if(prepared==null)continue;
            JsonObject? output=null;if(prepared["request"] is JsonObject request&&NarrateAsync!=null)try{output=await NarrateAsync(who,"letter_reply",request).ConfigureAwait(false);}catch{/* Engine reply survives unavailable narration. */}
            await host.WithState(_=>{if(generation!=(int)N(prepared,"generation"))return false;var words=output==null?null:CleanReply(l,O(prepared["effect"]),output);string source=words==null?"engine":"claude";words??=O(prepared["words"]);long id=DeliverReply(l,O(prepared["resident"]),O(prepared["effect"]),words,source,who);replies.Add(new JsonObject{["letter"]=l["id"]?.DeepClone(),["reply"]=id,["from"]=S(prepared["resident"],"name"),["effect"]=prepared["effect"]!.DeepClone(),["source"]=source,["player"]=who});return true;});}return replies;
    }
    private long DeliverReply(JsonObject letter,JsonObject r,JsonObject effect,JsonObject words,string source,int who)
    {
        long id=C.Atomic(()=>{int used=Pockets(who);string status=used<6?"given":"waiting";var text=words.DeepClone().AsObject();text["telegram"]="";C.Execute("INSERT INTO letter(day,hour,sender,sender_name,why,kind,facts_json,offer_json,text_json,source,status,job_id,player_id) VALUES($p0,$p1,$p2,$p3,'reply','reply','[]','{}',$p4,$p5,$p6,NULL,$p7)",Day,Hour,S(r,"id"),S(r,"name"),text.ToJsonString(),source,status,who);long created=C.Scalar<long>("SELECT last_insert_rowid()");if(status=="given")C.Execute("INSERT INTO item(kind,job_id,ref,player_id) VALUES('letter',NULL,$p0,$p1)",created,who);
            if(S(effect,"kind")=="trust")host.Rumours.ApplyTrust(S(r,"id"),who,(int)N(effect,"delta"),0);if(S(effect,"kind")=="gift"&&used+1<6)C.Execute("INSERT INTO item(kind,job_id,player_id) VALUES($p0,NULL,$p1)",S(effect,"item"),who);if(S(effect,"kind")=="invite")C.Execute("INSERT INTO meeting(who,day,from_h,to_h,x,z,label,status,letter,player_id) VALUES($p0,$p1,$p2,$p3,$p4,$p5,$p6,'open',$p7,$p8)",S(r,"id"),Day,N(effect,"from_h"),N(effect,"to_h"),N(effect,"x"),N(effect,"z"),S(effect,"label"),created,who);
            C.Execute("UPDATE jef_letter SET effect_json=$p0,reply_letter=$p1 WHERE id=$p2",effect.ToJsonString(),created,N(letter,"id"));C.Log(who,"letter_reply",S(r,"id"),$"A reply came for Jef from {S(r,"name")}.","world");return created;});
        Remember(who,S(r,"id"),S(letter,"gated")!=""?"Jef sent me a letter full of strange words I could not make out.":S(effect,"kind")=="trust"&&N(effect,"delta")<0?"Jef sent me a rude letter. I answered it.":"Jef wrote me a letter, and I wrote back.",S(letter,"gated")!=""?4:3);Event("letter_reply",$"{S(r,"name")} answered a letter from Jef.",2,S(r,"id"));return id;
    }
    public JsonArray MeetingsOpen(int who){var result=C.Rows("SELECT * FROM meeting WHERE status='open' AND day=$p0 AND player_id=$p1",Day,who);foreach(var row in result)row!["name"]=S(Resident(S(row,"who")),"name",S(row,"who"));return result;}
    public int MissMeetings(){var late=C.Rows("SELECT id,who,player_id FROM meeting WHERE status='open' AND(day<$p0 OR(day=$p0 AND to_h<=$p1))",Day,Hour);foreach(var m in late){C.Execute("UPDATE meeting SET status='missed' WHERE id=$p0",N(m,"id"));Remember((int)N(m,"player_id",1),S(m,"who"),"I asked Jef to come by my door, and he never came.",3);}return late.Count;}
    public JsonObject Meet(int who,int id,JsonObject at)
    {
        var m=C.One("SELECT * FROM meeting WHERE id=$p0 AND player_id=$p1",id,who);if(m==null||S(m,"status")!="open")throw new NativeServiceException("nobody expects you",409);if(Day!=N(m,"day")||Hour<N(m,"from_h")||Hour>=N(m,"to_h"))throw new NativeServiceException($"they said between {N(m,"from_h")}:00 and {N(m,"to_h")}:00",409);if(!Within(at,m,4))throw new NativeServiceException("this is not their door",409);var r=Resident(S(m,"who"));C.Execute("UPDATE meeting SET status='met' WHERE id=$p0",id);host.Rumours.ApplyTrust(S(m,"who"),who,1,0);Remember(who,S(m,"who"),"Jef came by my door as I asked in my letter. We had a word on the step.",5,$"Jef keeps his word: he came by {S(r,"first","their")}'s door when asked",1);C.Log(who,"met",S(m,"who"),$"Jef came by the door of {S(r,"name",S(m,"who"))}, as the letter asked.");return new(){["text"]=$"{S(r,"first","They")} opens the door and steps out. You talk a while on the step, about the town and the weather. It went well."};
    }
    private void RegisterLetters(NativeServiceHost service)
    {
        service.Register("GET","/api/post/write",r=>new JsonObject{["to"]=WriteTo(r.PlayerId),["stamp_c"]=10,["max_chars"]=600});service.Register("POST","/api/post/write",r=>{var result=PostLetter(r.PlayerId,r.Text("to"),r.Text("text"),At(r));var letter=O(result["letter"]);result["letter"]=new JsonObject{["id"]=letter["id"]?.DeepClone(),["to"]=letter["to_name"]?.DeepClone(),["reply_day"]=letter["reply_day"]?.DeepClone()};PushJobs();return Reply(r.PlayerId,result);});
        service.Register("POST","/api/meet/:id",r=>{var result=Meet(r.PlayerId,int.Parse(r.Param("id")),At(r));PushIdeas();return Reply(r.PlayerId,result);});
    }
}
