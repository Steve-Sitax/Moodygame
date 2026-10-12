using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreInteriors
{
    /// <summary>Frozen narration request only. Provider work must not touch SQLite. Null selects the original engine words.</summary>
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync;
    private int generation;
    private readonly ConcurrentDictionary<string,Task> writingTaunts=new();
    private readonly ConcurrentDictionary<int,Task<JsonObject>> writingShows=new();
    private static JsonObject Schema(string text)=>JsonNode.Parse(text)!.AsObject();
    private static readonly JsonObject tauntSchema=Schema("""
        {"type":"object","properties":{"greet":{"type":"string","minLength":1,"maxLength":120},"jef_wins":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120},"minItems":1,"maxItems":3},"patron_wins":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120},"minItems":1,"maxItems":3},"draw":{"type":"string","minLength":1,"maxLength":120},"refuse":{"type":"string","minLength":1,"maxLength":120}},"required":["greet","jef_wins","patron_wins","draw","refuse"]}
        """);
    private static readonly JsonObject gossipSchema=Schema("""
        {"type":"object","properties":{"lines":{"type":"array","minItems":2,"maxItems":4,"items":{"type":"object","properties":{"speaker":{"type":"string","enum":["A","B"]},"text":{"type":"string","minLength":1,"maxLength":160}},"required":["speaker","text"]}}},"required":["lines"]}
        """);
    private static readonly JsonObject playSchema=Schema("""
        {"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":60},"third":{"type":"string","minLength":1,"maxLength":30},"lines":{"type":"array","minItems":6,"maxItems":10,"items":{"type":"object","properties":{"who":{"type":"string","enum":["neus","schele","third"]},"text":{"type":"string","minLength":1,"maxLength":150}},"required":["who","text"]}}},"required":["title","third","lines"]}
        """);
    private static readonly JsonObject convoSchema=Schema("""
        {"type":"object","properties":{"lines":{"type":"array","minItems":2,"maxItems":6,"items":{"type":"object","properties":{"speaker":{"type":"string","enum":["A","B"]},"text":{"type":"string","minLength":1,"maxLength":140}},"required":["speaker","text"]}},"memory_a":{"type":"string","maxLength":160},"memory_b":{"type":"string","maxLength":160},"outcome_kind":{"type":"string","enum":["none","pass_rumour","agree","refuse"]},"trust_a":{"type":"integer","minimum":-1,"maximum":1},"trust_b":{"type":"integer","minimum":-1,"maximum":1}},"required":["lines","memory_a","memory_b","outcome_kind","trust_a","trust_b"]}
        """);
    private bool MayNarrate(string hook,int share,params string[] family)
    {
        if(NarrateAsync==null)return false;int total=C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0",Day),mine=0;
        foreach(string member in family.Length==0?new[]{hook}:family)mine+=C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook=$p1",Day,member);
        int limit=DailyCallLimit?.Invoke()??120;return mine<share&&(limit==0||total<limit-15);
    }
    private JsonObject RequestWords(string hook,JsonObject content,JsonObject schema,string rules)
    {
        content["clock"]=host.Clock.View();content["weather"]=data["weatherText"]?[S(host.Clock.View(),"weather")]?.DeepClone();
        return new JsonObject{["hook"]=hook,["schema"]=schema.DeepClone(),["system"]="Write plain English game dialogue for Antwerp in 1873. Dutch only in names of people, places and firms, and the drink jenever. The engine owns money, prices, dice, schedules, facts and outcomes; write words only. Never invent deeds by Jef. No oaths or threats of real harm. "+rules,["prompt"]=content.ToJsonString()};
    }
    private async Task<JsonObject?> Words(int who,string hook,JsonObject request)
    {
        var provider=NarrateAsync;if(provider==null)return null;try{return await provider(who,hook,request).ConfigureAwait(false);}catch{return null;}
    }
    private async Task<object?> SitAsync(NativeServiceRequest r)
    {
        var prepare=await host.WithState(_=>{
            string place=Place(r.Text("place")),id=S(Person(r.Text("patron")),"id");var answer=Sit(r.PlayerId,place,id);var person=NeedPatron(place,id);string key="interior:taunts:"+Day+":"+id;
            JsonObject? request=C.World(key)==null&&MayNarrate("tavern_dice",6,"tavern_dice","tavern_gossip")?RequestWords("tavern_dice",new JsonObject{["resident"]=person.DeepClone(),["place"]=Label(place),["memories"]=host.Rumours.Memories(id,3),["relationship"]=host.Rumours.Relationship(id,r.PlayerId)},tauntSchema,"Write greet, jef_wins, patron_wins, draw and refuse for a game of pitjesbak. Each remark at most fifteen words, by the resident's temperament. Never name sums, numbers or coins."):null;
            return (Answer:answer,Request:request,Key:key,Person:person.DeepClone().AsObject(),Generation:generation);
        }).ConfigureAwait(false);
        if(prepare.Request!=null){var task=writingTaunts.GetOrAdd(prepare.Key,_=>WriteTauntsAsync(r.PlayerId,prepare.Key,prepare.Person,prepare.Request,prepare.Generation));_=task.ContinueWith(done=>{_ = done.Exception;((ICollection<KeyValuePair<string,Task>>)writingTaunts).Remove(new(prepare.Key,done));},TaskScheduler.Default);}
        return prepare.Answer;
    }
    private async Task WriteTauntsAsync(int who,string key,JsonObject person,JsonObject request,int started)
    {
        try{
            var words=await Words(who,"tavern_dice",request).ConfigureAwait(false);if(words==null)return;
            await host.WithState(_=>{if(generation!=started||C.World(key)!=null)return false;var fb=FallbackTaunts(person);var clean=fb.DeepClone().AsObject();foreach(string f in new[]{"greet","draw","refuse"})clean[f]=CleanLine(S(words,f),120)??S(fb,f);
                foreach(string f in new[]{"jef_wins","patron_wins"}){var valid=(words[f] as JsonArray??new()).Select(n=>CleanLine(n?.GetValue<string>()??"",120)).Where(n=>n!=null).Take(3).ToArray();if(valid.Length>0)clean[f]=new JsonArray(valid.Select(n=>(JsonNode)JsonValue.Create(n)!).ToArray());}C.SetWorld(key,new JsonObject{["taunts"]=clean,["source"]="claude"});return true;}).ConfigureAwait(false);
        }catch{ /* Invalid or interrupted narration leaves the original engine remarks. */ }
    }
    public Task TauntsSettled()=>Task.WhenAll(writingTaunts.Values.ToArray());
    private async Task<object?> GossipAsync(NativeServiceRequest r)
    {
        var prepare=await host.WithState(_=>{
            string place=Place(r.Text("place")),aid=S(Person(r.Text("a")),"id"),bid=S(Person(r.Text("b")),"id");
            if(!MayNarrate("tavern_gossip",6,"tavern_dice","tavern_gossip"))return (Answer:Gossip(r.PlayerId,place,aid,bid),Place:place,A:new JsonObject(),B:new JsonObject(),Facts:new JsonArray(),Request:(JsonObject?)null,Generation:generation);
            NeedOpen(r.PlayerId,place);if(aid==bid)throw new NativeServiceException("two people are needed for gossip",400);var a=NeedPatron(place,aid).DeepClone().AsObject();var b=NeedPatron(place,bid).DeepClone().AsObject();double now=host.Clock.MinuteNow();var last=C.World("interior:gossip_last")?.AsObject()??new();if(now-(last[place]==null?-1e9:N(last[place]))<60)throw new NativeServiceException("they talk of nothing much just now",409);last[place]=now;C.SetWorld("interior:gossip_last",last);var facts=GossipFacts();
            var request=facts.Count==0?null:RequestWords("tavern_gossip",new JsonObject{["a"]=a.DeepClone(),["b"]=b.DeepClone(),["facts"]=facts.DeepClone(),["place"]=Label(place)},gossipSchema,"Write two to four lines, A first, then alternating with B. They gossip about the supplied real facts, distort details but keep the facts recognizable. Invent no deaths or new crimes. Never name sums or numbers of coins.");return(Answer:(JsonObject?)null,Place:place,A:a,B:b,Facts:facts,Request:request,Generation:generation);
        }).ConfigureAwait(false);
        if(prepare.Answer!=null)return prepare.Answer;var output=prepare.Request==null?null:await Words(r.PlayerId,"tavern_gossip",prepare.Request).ConfigureAwait(false);
        return await host.WithState(_=>{
            if(generation!=prepare.Generation)throw new NativeServiceException("the week changed while they spoke",409);var a=prepare.A;var b=prepare.B;var facts=prepare.Facts;JsonArray? lines=null;
            if(output?["lines"] is JsonArray proposed&&proposed.Count is >=2 and <=4){var clean=new JsonArray();foreach(var p in proposed){string? text=CleanLine(S(p,"text"),160);string speaker=S(p,"speaker");if(text==null||speaker is not("A" or "B")){clean.Clear();break;}var person=speaker=="A"?a:b;clean.Add(new JsonObject{["who"]=S(person,"id"),["name"]=S(person,"first"),["text"]=text});}if(clean.Count>=2)lines=clean;}
            string source=lines==null?"engine":"claude";lines??=EngineGossip(a,b,facts);if(facts.Count>0){var used=(C.World("interior:gossip_used") as JsonArray??new()).Select(n=>n!.DeepClone()).Concat(facts.Select(f=>f!["id"]!.DeepClone())).TakeLast(200);C.SetWorld("interior:gossip_used",new JsonArray(used.ToArray()));}
            string textSummary=S(a,"name")+" and "+S(b,"name")+" gossiped in "+Label(prepare.Place)+(facts.Count>0?" about: "+S(facts[0],"text"):"");WriteEvent("talk","gossip",textSummary[..Math.Min(280,textSummary.Length)],2,S(a,"id"),S(b,"id"),prepare.Place,extra:new JsonObject{["source"]=source},who:new[]{S(a,"id"),S(b,"id")});return new JsonObject{["lines"]=lines,["source"]=source,["facts"]=new JsonArray(facts.Select(f=>(JsonNode)JsonValue.Create(S(f,"text"))!).ToArray())};
        }).ConfigureAwait(false);
    }
    private async Task<object?> ChatAsync(NativeServiceRequest r)
    {
        var prepare=await host.WithState(_=>{
            string place=Place(r.Text("place")),aid=S(Person(r.Text("a")),"id"),bid=S(Person(r.Text("b")),"id");if(!MayNarrate("npc_convo",10))return (Answer:Chat(r.PlayerId,place,aid,bid),Request:(JsonObject?)null,A:new JsonObject(),B:new JsonObject(),Generation:generation);
            NeedOpen(r.PlayerId,place);if(aid==bid)throw new NativeServiceException("two people are needed for a talk",400);var a=NeedPatron(place,aid).DeepClone().AsObject();var b=NeedPatron(place,bid).DeepClone().AsObject();double now=host.Clock.MinuteNow();var last=C.World("interior:chat_last")?.AsObject()??new();if(now-(last[place]==null?-1e9:N(last[place]))<120)return(Answer:new JsonObject{["lines"]=EngineGossip(a,b,new()),["source"]="engine",["facts"]=new JsonArray()},Request:(JsonObject?)null,A:a,B:b,Generation:generation);last[place]=now;C.SetWorld("interior:chat_last",last);
            var request=RequestWords("npc_convo",new JsonObject{["a"]=a.DeepClone(),["b"]=b.DeepClone(),["a_memories"]=host.Rumours.Memories(aid,3),["b_memories"]=host.Rumours.Memories(bid,3),["about"]="the evening in "+Label(place)+", over a drink"},convoSchema,"Write a short exchange between A and B, alternating, A first. They talk over a drink. Only what each knows of Jef is known. memory_a and memory_b are one sentence remembered or empty. outcome_kind is pass_rumour, agree, refuse or none. trust_a and trust_b are -1, 0 or 1, usually 0.");return(Answer:(JsonObject?)null,Request:request,A:a,B:b,Generation:generation);
        }).ConfigureAwait(false);
        if(prepare.Answer!=null)return prepare.Answer;var output=await Words(r.PlayerId,"npc_convo",prepare.Request!).ConfigureAwait(false);
        return await host.WithState(_=>{
            if(generation!=prepare.Generation)throw new NativeServiceException("the week changed while they spoke",409);var a=prepare.A;var b=prepare.B;string aid=S(a,"id"),bid=S(b,"id");var lines=new JsonArray();bool valid=output?["lines"] is JsonArray proposed&&proposed.Count is >=2 and <=6;
            if(valid)foreach(var p in output!["lines"]!.AsArray()){string speaker=S(p,"speaker"),text=S(p,"text");if(speaker is not("A" or "B")||text.Length is <1 or >140){valid=false;break;}var person=speaker=="A"?a:b;lines.Add(new JsonObject{["who"]=S(person,"id"),["name"]=S(person,"first"),["text"]=PlainEnglish(text)});}
            if(!valid){output=null;lines.Clear();int i=0;foreach(var node in data["convoChat"]!.AsArray()){var person=i++%2==0?a:b;string text=node!.GetValue<string>().Replace("{A}",S(a,"first")).Replace("{B}",S(b,"first"));lines.Add(new JsonObject{["who"]=S(person,"id"),["name"]=S(person,"first"),["text"]=System.Text.RegularExpressions.Regex.Replace(text,@"^[^:]+:\s*","")});}}
            string outcome=output==null?"none":S(output,"outcome_kind","none"),source=output==null?"engine":"claude";
            if(output!=null){foreach(var pair in new[]{(Key:"memory_a",Id:aid),(Key:"memory_b",Id:bid)})if(S(output,pair.Key).Trim().Length>0)host.Trade.Remember(r.PlayerId,pair.Id,S(output,pair.Key),4);host.Rumours.ApplyTrust(aid,r.PlayerId,Math.Clamp((int)N(output["trust_a"]),-1,1),0);host.Rumours.ApplyTrust(bid,r.PlayerId,Math.Clamp((int)N(output["trust_b"]),-1,1),0);}
            if(outcome=="pass_rumour"||output==null&&N(a["stats"]?["gossip"])>=6){if(PassRumour(aid,bid))outcome="pass_rumour";else if(outcome=="pass_rumour")outcome="none";}
            long id=WriteEvent("talk","convo",S(a,"name")+" spoke with "+S(b,"name"),3,aid,bid,outcome:outcome,extra:new JsonObject{["purpose"]="chat",["lines"]=new JsonArray(lines.Select(l=>(JsonNode)JsonValue.Create(S(l,"name")+": "+S(l,"text"))!).ToArray()),["source"]=source},who:new[]{aid,bid});var convo=new JsonObject{["id"]=id,["a"]=aid,["b"]=bid,["a_name"]=S(a,"name"),["b_name"]=S(b,"name"),["purpose"]="chat",["lines"]=lines.DeepClone(),["source"]=source,["outcome"]=outcome,["at"]=C.Now,["event_id"]=null};recentConvos.Add(convo);host.Publish("convo",new JsonObject{["convo"]=convo.DeepClone()});return new JsonObject{["lines"]=lines,["source"]=source,["facts"]=new JsonArray()};
        }).ConfigureAwait(false);
    }
    private Task<JsonObject> TrackShow(int who,int day)
    {
        var task=writingShows.GetOrAdd(day,_=>WriteShowAsync(who,day));_=task.ContinueWith(done=>{_ = done.Exception;((ICollection<KeyValuePair<int,Task<JsonObject>>>)writingShows).Remove(new(day,done));},TaskScheduler.Default);return task;
    }
    private void StartShow(int who)
    {
        if(NarrateAsync==null){WriteShow();return;}_=TrackShow(who,Day);
    }
    public async Task<JsonObject> WriteShowAsync(int who,int? requestedDay=null)
    {
        var prepare=await host.WithState(_=>{int day=requestedDay??Day;var have=C.World("poesje:show:"+day) as JsonObject;if(have!=null)return(Have:have,Day:day,Facts:new JsonArray(),Request:(JsonObject?)null,Generation:generation);var facts=ShowFacts();var request=MayNarrate("poesje_show",2)?RequestWords("poesje_show",new JsonObject{["facts"]=facts.DeepClone()},playSchema,"Write tonight's Poesje puppet play in six to ten short lines. Neus is big-nosed and boastful; Schele stutters and knows better; the third puppet contradicts them. Build the play from supplied facts. Never invent new deaths, crimes or deeds by Jef. No sums, numbers of coins or oaths."):null;return(Have:(JsonObject?)null,Day:day,Facts:facts,Request:request,Generation:generation);}).ConfigureAwait(false);
        try{
            if(prepare.Have!=null)return prepare.Have;var output=prepare.Request==null?null:await Words(who,"poesje_show",prepare.Request).ConfigureAwait(false);var play=output==null?null:CleanPlay(output);var show=new JsonObject{["day"]=prepare.Day,["play"]=play??FallbackPlay(prepare.Facts,prepare.Day),["source"]=play==null?"engine":"claude",["facts"]=new JsonArray(prepare.Facts.Select(f=>(JsonNode)JsonValue.Create(S(f,"text"))!).ToArray()),["aboutJef"]=prepare.Facts.Any(f=>f?["jef"]?.GetValue<bool>()==true)};
            return await host.WithState(_=>{var existing=C.World("poesje:show:"+prepare.Day) as JsonObject;if(existing!=null)return existing;if(generation==prepare.Generation)C.SetWorld("poesje:show:"+prepare.Day,show);return show;}).ConfigureAwait(false);
        }finally{ /* TrackShow removes only this task; a new week may already have another writer. */ }
    }
    private async Task<object?> PlayAsync(NativeServiceRequest r)
    {
        var prepare=await host.WithState(_=>{if(!DoorOpen&&ShowToday()==null)throw new NativeServiceException("no play now",409);return(Day:Day,Have:ShowToday());}).ConfigureAwait(false);if(prepare.Have!=null)return PlayView(prepare.Have);var show=await TrackShow(r.PlayerId,prepare.Day).ConfigureAwait(false);return PlayView(show);
    }
}

