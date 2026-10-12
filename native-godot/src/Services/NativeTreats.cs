using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>A real invited tavern guest: follow, enter, sit, three paid rounds and a remembered confidence.</summary>
public sealed class NativeTreats : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeActions actions;
    private readonly NativeRoutines routines;
    private readonly NativeGifts gifts;
    private NativeServiceContext C=>host.Context;
    private int Minute=>host.Clock.GameMinute();
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    private static string S(JsonNode? n,string key,string fallback="")=>NativeGoods.S(n,key,fallback);
    private static double N(JsonNode? n,string key,double fallback=0)=>NativeGoods.N(n,key,fallback);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static double Distance(JsonNode? a,JsonNode? b)=>NativeGoods.Distance(N(a,"x"),N(a,"z"),N(b,"x"),N(b,"z"));
    public NativeTreats(NativeServiceHost host,NativeActions actions,NativeRoutines routines,NativeGifts gifts)=>(this.host,this.actions,this.routines,this.gifts)=(host,actions,routines,gifts);
    private IEnumerable<(JsonObject Row,JsonObject Routine)> Active(int? player=null)=>actions.Active().OfType<JsonObject>().Select(row=>(Row:row,Routine:routines.Of(row))).Where(pair=>pair.Routine!=null&&S(pair.Routine,"purpose")=="treat"&&(player==null||N(pair.Routine,"player",1)==player)).Select(pair=>(pair.Row,pair.Routine!));
    public JsonObject? Of(int player,string npc)=>Active(player).FirstOrDefault(pair=>S(pair.Row,"npc_id")==npc).Routine;
    private string TreatedKey(int player,string npc)=>player==1?$"treat:{Day}:{npc}":$"treat:{Day}:{player}:{npc}";
    public JsonArray Taverns()=>new((C.World("town")?["places"]as JsonObject??new()).Where(p=>p.Key.StartsWith("tavern:",StringComparison.Ordinal)&&p.Value?["door"]is JsonArray).Select(p=>(JsonNode)new JsonObject{["place"]=p.Key,["label"]=S(p.Value,"label"),["x"]=NativeGoods.Number(p.Value!["door"]![0]),["z"]=NativeGoods.Number(p.Value["door"]![1])}).ToArray());
    public JsonObject? PickTavern(string words,JsonObject? near)
    {
        string Norm(string text)=>Regex.Replace(Regex.Replace(text.ToLowerInvariant(),"[^a-z\\s']"," "),"\\s+"," ").Trim();string w=Norm(words);
        var all=Taverns().OfType<JsonObject>().ToArray();var named=all.FirstOrDefault(t=>{string label=Regex.Replace(Norm(S(t,"label")),"^(the|in de|in het|den|de|het) ","");return label.Length>=4&&(w.Contains(label)||label.Split(' ').Any(part=>part.Length>=5&&w.Contains(part)));});
        return named??all.Where(t=>host.Interiors.Open(S(t,"place"))).OrderBy(t=>near==null?0:Distance(t,near)).FirstOrDefault();
    }
    public JsonObject Judge(int player,JsonObject person,string words)
    {
        JsonObject No(string line)=>new(){["ok"]=false,["line"]=line};string id=S(person,"id"),work=S(person["work"],"kind");var now=NativeShops.Activity(person,Day,Hour);
        if(N(person,"age")<16)return No("A tavern? Mother would have my ears.");if(N(person["stats"],"piety")>=8)return No("I do not set foot in taverns. God keep you.");
        if(C.Rules["employers"]?[id]!=null||work=="guard")return No("I cannot leave my post. Another time.");
        if(now.act=="work")return No(work is "stall"or"shop"or"tavern"?"And leave the stall? After hours, maybe.":"I am at my work. After hours, maybe.");
        if(now.act=="home"&&(Hour>=22||Hour<6))return No("At this hour? I am for my bed.");if((Hour>=20||Hour<6)&&N(person["stats"],"courage")<=3)return No("Not in the dark. Not for anyone.");
        int trust=C.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1",id,player);if(trust<0)return No("Drink with you? I would sooner not.");if(trust<1&&N(person["stats"],"warmth")<6&&N(person["stats"],"gossip")<7)return No("I do not know you well enough to drink with you.");
        if(C.World(TreatedKey(player,id))?.GetValue<bool>()==true)return No("You stood me one already today. Another time.");if(Active(player).Any())return No("You have company for the tavern already.");if(actions.Of(id)!=null)return No("My hands are full already.");
        var from=actions.PlayerPosition(player)??actions.Position(id);var tavern=PickTavern(words,from);if(tavern==null)return No("There is nowhere open at this hour.");if(!host.Interiors.Open(S(tavern,"place")))return No(S(tavern,"label")+" is shut at this hour.");if(Distance(from,tavern)>350)return No("That is the other end of town. Somewhere nearer.");return new(){["ok"]=true,["tavern"]=tavern.DeepClone()};
    }
    public JsonObject? Propose(int player,JsonObject person,JsonObject proposal)
    {
        var judged=Judge(player,person,S(proposal,"asked_words")+" "+S(proposal,"target"));if(judged["ok"]!.GetValue<bool>()!=true)return new(){["refused"]="treat",["action_id"]=null,["line"]=S(judged,"line")};var tavern=judged["tavern"]!;string place=S(tavern,"place"),label=S(tavern,"label");
        JsonObject Step(string kind)=>new(){["kind"]=kind,["place"]=place,["label"]=label};var follow=Step("follow");follow["who"]="jef";follow["x"]=tavern["x"]!.DeepClone();follow["z"]=tavern["z"]!.DeepClone();var wait=Step("wait");wait["inside"]=place;
        var state=new JsonObject{["place"]=place,["label"]=label,["rounds"]=0,["tipsy"]=0,["fact"]=null,["told"]=false,["player"]=player,["carried"]=new JsonArray(),["purse_c"]=0,["spent_c"]=0,["outcome"]=new JsonObject()};var row=routines.Start(player,S(person,"id"),"treat",new(follow,Step("enter"),Step("sit"),wait,Step("leave")),state,90,"a drink at "+label);
        return new(){["refused"]=null,["action_id"]=row["id"]!.DeepClone(),["line"]="Lead the way, then.",["end"]=true,["note"]=S(person,"first")+" walks with you to "+label+".",["label"]=label};
    }
    public JsonArray Enter(int player,string place)
    {
        var door=Taverns().FirstOrDefault(t=>S(t,"place")==place);if(door==null||!host.Interiors.Open(place))return new();var guests=new JsonArray();foreach(var (row,routine) in Active(player).ToArray()){
            int index=(int)N(routine,"i");if(S(A(routine["steps"]).ElementAtOrDefault(index),"kind")!="follow")continue;var at=actions.Position(S(row,"npc_id"));if(at==null||Distance(at,door)>30)continue;string label=S(door,"label");foreach(var step in A(routine["steps"]))if(step?["place"]!=null){step["place"]=place;step["label"]=label;}routine["state"]!["place"]=place;routine["state"]!["label"]=label;routines.Save((int)N(row,"id"),routine);routines.CompleteStep(player,(int)N(row,"id"),index,true,"came along");C.Execute("UPDATE npc_action SET until=$p0 WHERE id=$p1",Minute+180,(int)N(row,"id"));guests.Add(new JsonObject{["id"]=S(row,"npc_id"),["name"]=S(actions.Resident(S(row,"npc_id")),"name")});
        }if(guests.Count>0)host.Publish("actions");return guests;
    }
    public int Leave(int player)
    {
        int ended=0;foreach(var (row,routine) in Active(player).ToArray()){int index=(int)N(routine,"i");if(S(A(routine["steps"]).ElementAtOrDefault(index),"kind")=="wait"&&routines.CompleteStep(player,(int)N(row,"id"),index,true,"Jef left"))ended++;}return ended;
    }
    public JsonArray List(int player)=>new(Active(player).Select(pair=>(JsonNode)new JsonObject{["id"]=pair.Row["id"]!.DeepClone(),["npc"]=S(pair.Row,"npc_id"),["name"]=S(actions.Resident(S(pair.Row,"npc_id")),"name"),["first"]=S(actions.Resident(S(pair.Row,"npc_id")),"first"),["step"]=S(A(pair.Routine["steps"]).ElementAtOrDefault((int)N(pair.Routine,"i")),"kind"),["place"]=pair.Routine["state"]?["place"]?.DeepClone(),["label"]=pair.Routine["state"]?["label"]?.DeepClone(),["inside"]=pair.Routine["state"]?["inside"]?.DeepClone(),["rounds"]=N(pair.Routine["state"],"rounds"),["tipsy"]=N(pair.Routine["state"],"tipsy")}).ToArray());
    public JsonObject Round(int player,string place,string kind)=>C.Atomic(()=>
    {
        if(kind is not("beer"or"jenever"))throw new NativeServiceException("a round is beer or jenever");var found=Active(player).FirstOrDefault(pair=>S(pair.Routine["state"],"inside")==place);if(found.Routine==null)throw new NativeServiceException("you have nobody here to stand a drink",409);if(!host.Interiors.Open(place))throw new NativeServiceException("the tavern is shut",409);
        var state=found.Routine["state"]!.AsObject();var guest=actions.Resident(S(found.Row,"npc_id"))!;int rounds=(int)N(state,"rounds");if(rounds>=3)return new JsonObject{["line"]=S(guest,"first")+": No more for me, or I will not find my own door.",["note"]="",["paid_c"]=0,["rounds"]=rounds,["trust"]=0};
        string keeper=S(host.Interiors.Tavern(player,place)["keeper"],"id");var ware=host.Trade.Wares(keeper).FirstOrDefault(w=>S(w,"kind")==kind)??throw new NativeServiceException("they do not sell that",404);int list=(int)N(ware,"price_c");if(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)<list*2)throw new NativeServiceException("not enough money for a round",409);
        var bought=host.Trade.Buy(player,keeper,kind);int price=(int)N(bought,"price_c");if(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)<price)throw new NativeServiceException("not enough money for the guest's drink",409);C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",price,player);C.Log(player,"treated",S(guest,"id"),$"Jef bought {S(guest,"name")} {S(host.Trade.Item(kind),"name",kind)} as well, {price} centimes.");
        state["rounds"]=++rounds;state["tipsy"]=Math.Min(4,N(state,"tipsy")+(kind=="beer"?1:2));double worth=(price+(rounds==1?8:0))/(1+N(guest["stats"],"wealth")*.35);int trust=gifts.GiveTrust(player,guest,rounds==1?Math.Min(6,worth):worth,false);
        if(rounds==1){state["fact"]=Secret(guest);C.SetWorld(TreatedKey(player,S(guest,"id")),true);host.Trade.Remember(player,S(guest,"id"),"Jef stood me a "+kind+" at "+S(state,"label")+", and we sat together.",trust>0?5:3,"Jef stood "+S(guest,"name")+" a drink at "+S(state,"label"),1);}routines.Save((int)N(found.Row,"id"),found.Routine);host.Publish("actions");return new JsonObject{["line"]=S(guest,"first")+(rounds==1?" raises the drink: Your health, Jef.":N(state,"tipsy")>=3?" laughs too loud and spills a little.":": You are a good sort, you know that?"),["note"]=rounds==1?S(guest,"first")+(trust>0?" warms to you.":" is glad of the drink."):N(state,"tipsy")>=3?S(guest,"first")+" is getting merry.":"",["paid_c"]=price*2,["rounds"]=rounds,["trust"]=rounds==1?trust:0};
    });
    public string? Secret(JsonObject person)
    {
        var people=C.Rows("SELECT data_json FROM resident ORDER BY id").Select(row=>JsonNode.Parse(S(row,"data_json"))!.AsObject()).ToArray();var kin=people.FirstOrDefault(r=>S(r,"id")!=S(person,"id")&&N(r,"household")==N(person,"household")&&S(r,"trade")is "thief"or"runner");
        string Label(JsonObject r)=>S(C.World("town")?["places"]?[S(r["work"],"place")],"label","the quays");if(kin!=null)return S(kin,"name")+(S(kin,"trade")=="thief"?", who lives under your own roof, is the one who lifts purses about "+Label(kin)+" after dark. Nobody outside the family knows.":", of your own house, takes a cut from the shipping agents for every emigrant he talks into a dear ticket.");
        bool Telling(JsonNode? e)=>S(e,"kind")is not("action"or"talk")&&!new[]{"bought","drank","ate","talked","convo","gossip","diced","warmed","treated","gave","paid_wage","action","refused","rumour"}.Contains(S(e,"verb"))&&!Regex.IsMatch(S(e,"verb"),@"^action_|_(done|failed|stopped|start|started|end|ended)$|^event_")&&!Regex.IsMatch(S(e,"text"),@"\bJef\b|\b(ended|began|begins|is over)\.?$");
        var dark=C.Rows("SELECT * FROM world_event WHERE day>=$p0 AND weight>=4 AND (kind IN ('theft','police','deed') OR verb IN ('street_robbery','robbery_escaped','robbery_caught','scuffle','scuffle_parted')) ORDER BY weight DESC,id DESC LIMIT 12",Day-2).FirstOrDefault(Telling);if(dark!=null)return S(dark,"text");var mine=C.Rows("SELECT e.* FROM world_event e JOIN world_event_who w ON w.event_id=e.id WHERE w.who=$p0 AND e.day>=$p1 AND e.weight>=3 AND (e.actor IS NULL OR e.actor<>'player') ORDER BY e.weight DESC,e.id DESC LIMIT 12",S(person,"id"),Day-2).FirstOrDefault(Telling);if(mine!=null)return S(mine,"text");if(N(person["stats"],"gossip")>=5&&people.FirstOrDefault(r=>S(r,"trade")=="thief"&&N(r,"household")!=N(person,"household"))is {} thief)return S(thief,"name")+" is the one to watch for your purse about "+Label(thief)+"; everybody in the taverns knows it, and nobody tells the police.";return C.Rows("SELECT * FROM world_event WHERE day>=$p0 AND weight>=4 ORDER BY weight DESC,id DESC LIMIT 4",Day-2).FirstOrDefault(Telling)is {} fact?S(fact,"text"):null;
    }
    public void AttachTalk(NativeTownTalk talk)
    {
        talk.EngineFreeReplies.Add((request,person,words)=>{if(talk.CanNarrate(request.PlayerId,S(person,"id"))||!Regex.IsMatch(words,@"\b(drink|beer|jenever|gin|pint|tavern|inn|a glass|stand you|buy you)\b",RegexOptions.IgnoreCase)||!Regex.IsMatch(words,@"\b(come|join|let me|let's|buy|stand|treat|have a)\b",RegexOptions.IgnoreCase))return null;var result=Propose(request.PlayerId,person,new(){["asked_words"]=words,["target"]=words[..Math.Min(60,words.Length)]})!;var answer=talk.Line(request,person,S(result,"line"),NativeGoods.B(result,"end"));if(result["note"]!=null)answer["note"]=result["note"]!.DeepClone();return answer;});
        var previous=talk.SuppressPositiveTrust;talk.SuppressPositiveTrust=(player,npc,words)=>Of(player,npc)is {} routine&&S(A(routine["steps"]).ElementAtOrDefault((int)N(routine,"i")),"kind")!="follow"||previous?.Invoke(player,npc,words)==true;
        talk.ContextProviders.Add((player,person)=>Of(player,S(person,"id"))?["state"]?.DeepClone());talk.ModelApplied.Add((player,person)=>{var routine=Of(player,S(person,"id"));if(routine?["state"]?["fact"]!=null&&N(routine["state"],"rounds")>0){routine["state"]!["told"]=true;routines.Save((int)N(actions.Of(S(person,"id")),"id"),routine);}});
        const string choice="So what's the talk, then? Between us.";talk.ChoiceAdditions.Add((player,person)=>Of(player,S(person,"id"))is {} routine&&S(routine["state"],"inside")!=""&&N(routine["state"],"rounds")>0&&routine["state"]?["fact"]!=null&&!NativeGoods.B(routine["state"],"told")?new[]{choice}:Array.Empty<string>());
        talk.ReplyOverrides.Add((request,person,topic)=>{if(topic!="extra:"+choice)return null;var routine=Of(request.PlayerId,S(person,"id"));if(routine==null)return null;string fact=S(routine["state"],"fact");routine["state"]!["told"]=true;routines.Save((int)N(actions.Of(S(person,"id")),"id"),routine);return talk.Line(request,person,"Between us, and you did not hear it from me: "+fact.Replace("your own roof","my own roof").Replace("your own house","my own house"));});
    }
    public void Register(NativeServiceHost service)
    {
        actions.Proposals["come_for_drink"]=Propose;routines.Checks["treat"]=(routine,step)=>S(step,"kind")is "enter"or"sit"&&!host.Interiors.Open(S(step,"place"))?"closed":null;
        routines.Failed["treat"]=(row,routine,step,why)=>actions.End((int)N(row,"id"),"failed",why);
        routines.After["treat"]=(row,routine,result)=>{if(!NativeGoods.B(result,"ok")&&S(result,"kind")is "follow"or"enter"or"sit")actions.End((int)N(row,"id"),"failed",S(result,"why"));};
        routines.Ended["treat"]=(row,routine,status)=>{var state=routine["state"]!;if(status=="done"&&N(state,"rounds")>0)host.Trade.Remember((int)N(routine,"player",1),S(row,"npc_id"),"I spent a while at "+S(state,"label")+" with Jef."+(NativeGoods.B(state,"told")?" I may have said more than I should.":""),3);};
        routines.TimeUps["treat"]=(row,routine)=>actions.End((int)N(row,"id"),"done","time");host.Interiors.GuestProviders.Add(place=>new JsonArray(Active().Where(pair=>S(pair.Routine["state"],"inside")==place).Select(pair=>{var person=actions.Resident(S(pair.Row,"npc_id"))!.DeepClone().AsObject();person["role"]=N(pair.Routine["state"],"tipsy")>=2?"guest_tipsy":"guest";return(JsonNode)person;}).ToArray()));
        service.Register("GET","/api/treat",r=>new JsonObject{["treats"]=List(r.PlayerId)});service.Register("POST","/api/treat/enter",r=>new JsonObject{["guests"]=Enter(r.PlayerId,r.Text("place"))});service.Register("POST","/api/treat/leave",r=>new JsonObject{["ended"]=Leave(r.PlayerId)});service.Register("POST","/api/treat/round",r=>NativeCoreClock.Join(Round(r.PlayerId,r.Text("place"),r.Text("kind","beer")),host.Payload(r.PlayerId)));
        service.TickHooks.Add((request,advanced)=>{if(advanced)foreach(var (row,routine) in Active().ToArray())if(S(routine["state"],"inside")!=""&&!host.Interiors.Open(S(routine["state"],"inside")))actions.End((int)N(row,"id"),"done","closing time");});
    }
}
