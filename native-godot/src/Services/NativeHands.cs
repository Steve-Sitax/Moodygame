using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace Scheldemist.Native.Services;

/// <summary>Source hired carry/watch rules: actual world goods, job progress, wages and dishonesty.</summary>
public sealed partial class NativeHands : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeActions actions;
    private readonly NativeRoutines routines;
    private readonly NativeGoods goods;
    private readonly NativeTransport transport;
    private NativeServiceContext C=>host.Context;
    private int Minute=>host.Clock.GameMinute();
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    private static string S(JsonNode? n,string key,string fallback="")=>NativeGoods.S(n,key,fallback);
    private static double N(JsonNode? n,string key,double fallback=0)=>NativeGoods.N(n,key,fallback);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static bool B(JsonNode? n,string key)=>NativeGoods.B(n,key);
    private static double D(JsonNode? a,JsonNode? b)=>NativeGoods.Distance(N(a,"x"),N(a,"z"),N(b,"x"),N(b,"z"));
    private static int Round5(double n)=>(int)Math.Ceiling(n/5-1e-9)*5;
    public NativeHands(NativeServiceHost host,NativeActions actions,NativeRoutines routines,NativeGoods goods,NativeTransport transport)=>(this.host,this.actions,this.routines,this.goods,this.transport)=(host,actions,routines,goods,transport);
    private IEnumerable<(JsonObject Row,JsonObject Routine)> Active(int? player=null)=>actions.Active().OfType<JsonObject>().Select(row=>(Row:row,Routine:routines.Of(row))).Where(pair=>pair.Routine!=null&&S(pair.Routine,"purpose")=="hire"&&(player==null||N(pair.Routine,"player",1)==player)).Select(pair=>(pair.Row,pair.Routine!));
    public int CrewCap(int player){int cap=3;if(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)>=200)cap++;int trust=C.Scalar<int>("SELECT COALESCE(MAX(trust),0) FROM faction_trust WHERE player_id=$p0",player);if(trust>=3)cap++;if(trust>=5)cap++;return Math.Min(6,cap);}
    private int Left(int job){try{var j=host.Jobs.Get(job);var t=j["task"];var p=t?["progress"];return S(j,"status")=="taken"&&S(t,"kind")=="carry"?(int)Math.Max(0,N(t,"count")-N(p,"delivered")-N(p,"lost")-N(p,"sold")):0;}catch(NativeServiceException){return 0;}}
    private string KeptKey(int player,string npc)=>player==1?"hands:kept:"+npc:$"hands:kept:{player}:{npc}";
    public int Kept(int player,string npc,string task){var kept=C.World(KeptKey(player,npc));return S(kept,"task")==task&&Day-N(kept,"day")<=1?(int)Math.Max(0,N(kept,"c")):0;}
    private void Keep(int player,string npc,string task,int amount){int left=Kept(player,npc,task)+amount;C.SetWorld(KeptKey(player,npc),left>0?new JsonObject{["c"]=left,["task"]=task,["day"]=Day}:null);}
    private void Pay(int player,string npc,int amount,string why){if(amount<=0)return;if(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)<amount)throw new NativeServiceException("show me the coin first",409);C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",amount,player);C.Log(player,"paid_wage",npc,$"Jef paid {amount} centimes to {S(actions.Resident(npc),"name")}, {why}.");}
    private JsonArray LoadSteps(JsonObject state){var from=state["from"]!;var to=state["to"]!;return new(new JsonObject{["kind"]="walk_to",["x"]=N(from,"x"),["z"]=N(from,"z"),["label"]=S(from,"label")},new JsonObject{["kind"]="pick_up",["job"]=state["job"]?.DeepClone(),["x"]=N(from,"x"),["z"]=N(from,"z"),["label"]=S(from,"label"),["count"]=state["cart"]==null?1:N(state["cart"],"per_trip",1)},new JsonObject{["kind"]="carry",["job"]=state["job"]?.DeepClone(),["x"]=N(to,"x"),["z"]=N(to,"z"),["label"]=S(to,"label")});}
    public JsonObject? Propose(int player,JsonObject person,JsonObject proposal)=>C.Atomic(()=>
    {
        JsonObject No(string line)=>new(){["refused"]="hire",["action_id"]=null,["line"]=line};string id=S(person,"id"),words=S(proposal,"asked_words");if(!WorkWords.IsMatch(words))return No("Work for you? Doing what?");var now=NativeShops.Activity(person,Day,Hour);string trade=S(person,"trade");
        if(N(person,"age")<14||N(person,"age")>62)return No("Ask somebody of working age.");if(C.Rules["employers"]?[id]!=null||S(person["work"],"kind")=="guard"||new[]{"police","water_bailiff","customs","priest","sexton"}.Contains(trade)&&now.act=="work")return No("I cannot leave my post.");
        if(now.act=="home"&&(Hour>=22||Hour<5))return No("I am for my bed.");if((Hour>=20||Hour<6)&&N(person["stats"],"courage")<=3)return No("Not in the dark.");int trust=C.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1",id,player);if(trust<=-2)return No("Work for you? I would sooner starve.");if(actions.Of(id)!=null||actions.Reserved?.Invoke(id)==true)return No("My hands are full already.");var crew=Active(player).ToArray();if(crew.Length>=CrewCap(player))return No("You have men enough already.");if(N(person["stats"],"wealth")>=7||new[]{"merchant","alderman","brewer","fish_merchant","pawnbroker"}.Contains(trade))return No("Do I look like a porter?");
        string task=TaskKind(words);JsonObject? from,to,job=null,cart=null;int expected;if(task=="carry"){
            job=host.Jobs.List(player).OfType<JsonObject>().FirstOrDefault(j=>host.Jobs.InHand(j,player));if(job==null||S(job["task"],"kind")!="carry")return No("Carry what? You have no load I can see.");int left=Left((int)N(job,"id"))-crew.Sum(c=>(int)N(c.Routine["state"],"holding"));if(left<=0)return No("Your goods are all carried.");from=actions.FindPlace(S(job["task"],"from"));to=actions.FindPlace(S(job["task"],"to"));if(from==null||to==null)return No("There is no way through there on foot.");if(actions.NearestOpen!=null){from=actions.NearestOpen(N(from,"x"),N(from,"z"),4);to=actions.NearestOpen(N(to,"x"),N(to,"z"),4);if(from==null||to==null)return No("There is no way through there on foot.");}
            expected=Math.Max(1,(int)Math.Ceiling(left/(crew.Count(c=>N(c.Routine["state"],"job")==N(job,"id"))+1.0)));
            if(Regex.IsMatch(words,@"\b(cart|handcart|barrow)\b",RegexOptions.IgnoreCase)){var owned=A(transport.CartView(player)["list"]).FirstOrDefault(c=>!B(c,"held")&&A(c?["load"]).Count==0&&D(c,from)<40);if(owned!=null)cart=new(){["id"]=owned["id"]!.DeepClone(),["x"]=N(owned,"x"),["z"]=N(owned,"z"),["yaw"]=N(owned,"yaw"),["per_trip"]=PerTrip(S(job["task"],"goods")),["taken"]=false};}
        }else{from=actions.PlayerPosition(player);if(from==null)return No("Watch what? Show me.");from=from.DeepClone().AsObject();from["label"]="where Jef stood";to=from.DeepClone().AsObject();expected=2;}
        int wage=Offer(words,(int)N(proposal,"amount_c")),ask=task=="watch"?Round5(N(actions.Data["wages"]?["dayPay"],trade,80+20*N(person["stats"],"wealth"))/4):routines.AskFor(player,person,expected);if(wage==0||wage<ask)return No($"For {ask} centimes I would do it. Half now, half when done.");if(wage>300)return No("That much? What is the catch?");string plan=PayPlan(words);if(plan=="end"&&trust<2)return No("Half now, or find another man.");int first=plan=="now"?wage:plan=="half"?wage/2:0,kept=Math.Min(wage,Kept(player,id,task)),cash=Math.Max(0,first-kept);if(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)<cash)return No($"Show me the coin first: {cash} centimes now.");
        var dishonest=task=="carry"?Dishonesty(person,trust,plan,expected,C.Roll):((int?)null,(int?)null);var state=new JsonObject{["task"]=task,["job"]=job?["id"]?.DeepClone(),["wage_c"]=wage,["paid_c"]=cash+kept,["plan"]=plan,["expected"]=expected,["loads"]=0,["holding"]=0,["strong"]=N(person,"age")>=18&&N(person,"age")<=55,["walk_off_at"]=dishonest.Item1,["ask_more_at"]=dishonest.Item2,["asking"]=0,["asked"]=false,["from"]=from.DeepClone(),["to"]=to!.DeepClone(),["cart"]=cart,["player"]=player,["carried"]=new JsonArray(),["purse_c"]=0,["spent_c"]=0,["outcome"]=new JsonObject(),["gids"]=new JsonArray()};
        if(task=="carry"){goods.Operate(player,new(){["op"]="job",["job"]=state["job"]!.DeepClone(),["lay"]=true});if(!goods.List().Any(item=>N(item,"job",-1)==N(state,"job")))return No("There are no accessible goods here yet. Lower the cargo first.");}
        Pay(player,id,cash,plan=="now"?"all up front":"half up front");if(kept>0)Keep(player,id,task,-kept);JsonArray steps=task=="carry"?LoadSteps(state):new(new JsonObject{["kind"]="walk_to",["x"]=N(from,"x"),["z"]=N(from,"z"),["label"]=S(from,"label")},new JsonObject{["kind"]="wait",["minutes"]=240,["label"]="watching Jef's things"});if(cart!=null)steps.Insert(0,new JsonObject{["kind"]="walk_to",["x"]=N(cart,"x")+2.2,["z"]=N(cart,"z"),["label"]="Jef's handcart"});
        int minutes=(int)Math.Max(240,Math.Min(720,(20-Hour)*60));var row=routines.Start(player,id,"hire",steps,state,minutes,"working for Jef");C.Log(player,"hired",id,$"Jef hired {S(person,"name")} to {task} for {wage} centimes, {cash} paid up front.");host.Trade.Remember(player,id,$"Jef hired me to {task} for {wage} centimes.",4);QueueLines(player,person);
        string promise=kept>0?$"The {kept} kept from last time counts. {cash} more now, {Math.Max(0,wage-cash-kept)} when done.":plan=="now"?$"{wage} centimes, paid now.":plan=="end"?"All of it when done, mind.":$"{first} now, the rest when done.";
        return new JsonObject{["refused"]=null,["action_id"]=row["id"]!.DeepClone(),["line"]=promise+" I will see to it.",["end"]=true,["note"]=S(person,"first")+" works for you now."};
    });
}
