using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Persistent typed resident step executor; proposed plans never move money or assets directly.</summary>
public sealed partial class NativeRoutines : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeActions actions;
    private readonly NativeTransport transport;
    private NativeServiceContext C=>host.Context;
    private int Minute=>host.Clock.MinuteNow()-1440;
    private static double N(JsonNode? n,string k,double f=0)=>NativeGoods.N(n,k,f);
    private static string S(JsonNode? n,string k,string f="")=>NativeGoods.S(n,k,f);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static bool B(JsonNode? n,string k)=>NativeGoods.B(n,k);
    private static double V(JsonNode? n)=>NativeGoods.Number(n);
    private static double D(JsonNode? a,JsonNode? b)=>NativeGoods.Distance(N(a,"x"),N(a,"z"),N(b,"x"),N(b,"z"));
    public readonly Dictionary<string,Func<JsonObject,JsonObject,string?>> Checks=new();
    public readonly Dictionary<string,Func<JsonObject,JsonObject,JsonObject,bool?>> Runs=new();
    public readonly Dictionary<string,Action<JsonObject,JsonObject,JsonObject>> After=new();
    public readonly Dictionary<string,Action<JsonObject,JsonObject,string>> Ended=new();
    public readonly Dictionary<string,Action<JsonObject,JsonObject>> TimeUps=new();
    public readonly Dictionary<string,Action<JsonObject,JsonObject,JsonObject,string>> Failed=new();
    public Func<JsonObject,JsonObject,JsonObject,JsonObject?>? Checkin;
    public NativeRoutines(NativeServiceHost host,NativeActions actions,NativeTransport transport)=>(this.host,this.actions,this.transport)=(host,actions,transport);
    public int AskFor(int player,JsonObject resident,int units)
    {
        var wages=actions.Data["wages"];double dayPay=N(wages?["dayPay"],S(resident,"trade"),80+20*N(resident["stats"],"wealth")),ask=N(wages,"call_c",5)+Math.Ceiling(dayPay/N(wages,"loadsPerDay",12))*Math.Max(1,units);bool working=host.Trade.AtWork(S(resident,"id")),keeper=S(resident["work"],"kind")is "stall"or"shop"or"tavern";if(working&&keeper)ask=Math.Max(ask,(80+30*N(resident["stats"],"wealth"))/2);else if(working)ask*=1.25;int trust=C.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1",S(resident,"id"),player);if(trust>=5)ask*=.85;if(trust<0)ask*=1.3;if(N(resident["stats"],"warmth")>=7)ask*=.9;if(N(resident["stats"],"greed")>=7)ask*=1.2;return (int)Math.Ceiling(ask/5-1e-9)*5;
    }
    public JsonObject? Of(JsonObject? row){try{return row==null?null:JsonNode.Parse(S(row,"data_json","{}"))?["routine"]as JsonObject;}catch{return null;}}
    public JsonArray List()=>new(actions.Active().Where(a=>S(a,"kind")=="routine").Select(a=>{var r=Of(a!.AsObject());int i=(int)N(r,"i");var step=A(r?["steps"]).ElementAtOrDefault(i);return (JsonNode)new JsonObject{["id"]=a["id"]!.DeepClone(),["npc"]=a["npc_id"]!.DeepClone(),["name"]=S(actions.Resident(S(a,"npc_id")),"name",S(a,"npc_id")),["purpose"]=S(r,"purpose"),["i"]=i,["n"]=A(r?["steps"]).Count,["step"]=step?.DeepClone(),["holding"]=N(r?["state"],"holding"),["strong"]=r?["state"]?["strong"]==null||B(r?["state"],"strong"),["cart"]=B(r?["state"]?["cart"],"taken")?r?["state"]?["cart"]?["id"]?.DeepClone():null,["minutes_left"]=Math.Max(0,N(a,"until")-Minute),["player"]=N(r,"player",1)};}).ToArray());
    public bool CompleteStep(int player,int id,int index,bool ok,string why,JsonObject? patch=null)
    {
        var row=actions.Row(id);var routine=Of(row);if(row==null||routine==null||S(row,"status")!="active"||N(routine,"i")!=index||N(routine,"player",1)!=player||routine["state"]?["steering"]!=null)return false;if(patch!=null)foreach(var pair in patch)routine["state"]![pair.Key]=pair.Value?.DeepClone();Result(row,routine,ok,why);Advance(id);return true;
    }
    private JsonObject StepRequest(NativeServiceRequest request)
    {
        int id=int.Parse(request.Param("id")),index=request.Int("i",-1);var row=actions.Row(id);var routine=Of(row);if(row==null||routine==null)throw new NativeServiceException("no such errand",404);var step=A(routine["steps"]).ElementAtOrDefault(index);string kind=S(step,"kind");if(N(routine,"i")!=index||N(routine,"player",1)!=request.PlayerId||kind is not("walk_to"or"follow"or"pick_up"or"carry"or"talk_to"or"wait"))return new(){["ok"]=false,["routine"]=List().FirstOrDefault(r=>N(r,"id")==id)?.DeepClone()};bool ok=request.Bool("ok")&&kind is not("follow"or"wait");var patch=new JsonObject();if(kind=="pick_up"&&ok)patch["holding"]=Math.Clamp(request.Int("n",1),1,(int)N(step,"count",1));if(double.IsFinite(N(request.Body,"x",double.NaN))&&double.IsFinite(N(request.Body,"z",double.NaN))){C.Execute("UPDATE npc_action SET x=$p0,z=$p1 WHERE id=$p2",Math.Clamp(N(request.Body,"x"),-2000,2000),Math.Clamp(N(request.Body,"z"),-2000,2000),id);patch["at"]=new JsonObject{["x"]=N(request.Body,"x"),["z"]=N(request.Body,"z")};}CompleteStep(request.PlayerId,id,index,ok,request.Text("why",ok?"done":"failed"),patch);return NativeCoreClock.Join(new JsonObject{["ok"]=true,["routine"]=List().FirstOrDefault(r=>N(r,"id")==id)?.DeepClone()},host.Payload(request.PlayerId));
    }
    public void Save(int id,JsonObject routine)
    {
        var row=actions.Row(id);if(row==null)return;var data=JsonNode.Parse(S(row,"data_json","{}"))!.AsObject();data["routine"]=routine.DeepClone();int index=(int)N(routine,"i");var step=A(routine["steps"]).ElementAtOrDefault(index);C.Execute("UPDATE npc_action SET data_json=$p0,phase=$p1,target_x=$p2,target_z=$p3,target=$p4 WHERE id=$p5",data.ToJsonString(),S(step,"kind","done"),step?["x"]==null?null:N(step,"x"),step?["z"]==null?null:N(step,"z"),S(step,"who",S(step,"label",S(row,"target"))),id);
    }
    public JsonObject Start(int player,string npc,string purpose,JsonArray steps,JsonObject state,int minutes=180,string reason="")
    {
        if(steps.Count==0)throw new NativeServiceException("nothing to do",409);var routine=new JsonObject{["purpose"]=purpose,["steps"]=steps.DeepClone(),["i"]=0,["results"]=new JsonArray(),["state"]=state.DeepClone(),["since"]=Minute,["player"]=player};var row=actions.Start(new(){["npc_id"]=npc,["kind"]="routine",["target"]=purpose,["source"]="talk",["minutes"]=Math.Clamp(minutes,40,purpose=="hire"?720:180),["reason"]=reason,["data"]=new JsonObject{["routine"]=routine}},player);Advance((int)N(row,"id"));return actions.Row((int)N(row,"id"))!;
    }
    private string? Check(JsonObject row,JsonObject routine,JsonObject step)
    {
        string purpose=S(routine,"purpose"),kind=S(step,"kind");int player=(int)N(routine,"player",1);if(Checks.TryGetValue(purpose,out var hook))return hook(routine,step);
        switch(kind){case "walk_to":case "carry":case "talk_to":if(!double.IsFinite(N(step,"x",double.NaN))||!double.IsFinite(N(step,"z",double.NaN)))return "no_place";if(actions.NearestOpen!=null&&actions.NearestOpen(N(step,"x"),N(step,"z"),4)==null)return "no_way";return null;
            case "buy":var ware=host.Trade.Wares(S(step,"who")).FirstOrDefault(w=>S(w,"kind")==S(step,"item"));if(ware==null)return "not_sold";if(!host.Trade.AtWork(S(step,"who")))return "closed";return N(ware,"price_c")*Math.Clamp((int)N(step,"count",1),1,4)<=N(routine["state"],"purse_c")-N(routine["state"],"spent_c")?null:"no_money";
            case "take":return C.Scalar<int>("SELECT COUNT(*) FROM item WHERE player_id=$p0 AND kind=$p1 AND job_id IS NULL",player,S(step,"item"))>0?null:"no_item";
            case "give":return A(routine["state"]?["carried"]).Any(i=>S(i,"kind")==S(step,"item"))?null:"no_item";
            case "pay":return C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)>=N(step,"amount_c")?null:"no_money";
            case "enter":case "sit":var keeper=C.World("town")?["places"]?[S(step,"place")];return keeper!=null?null:"no_place";
            case "wait":case "follow":case "leave":case "fetch_cart":return null;
            case "pick_up":return step["job"]==null?"no_job":null;
            default:return "unknown_step";}
    }
    private bool Run(JsonObject row,JsonObject routine,JsonObject step)
    {
        string purpose=S(routine,"purpose");if(Runs.TryGetValue(purpose,out var custom)&&custom(row,routine,step)is bool own)return own;int player=(int)N(routine,"player",1);var state=routine["state"]!.AsObject();switch(S(step,"kind")){
            case "take":var item=C.One("SELECT id FROM item WHERE player_id=$p0 AND kind=$p1 AND job_id IS NULL ORDER BY id LIMIT 1",player,S(step,"item"));if(item==null)return false;C.Execute("DELETE FROM item WHERE id=$p0 AND player_id=$p1",(int)N(item,"id"),player);state["carried"]!.AsArray().Add(new JsonObject{["kind"]=S(step,"item"),["jef"]=true});return true;
            case "pay":int amount=(int)N(step,"amount_c");if(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)<amount)return false;C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",amount,player);state[S(step,"role")=="purse"?"purse_c":"paid_c"]=N(state,S(step,"role")=="purse"?"purse_c":"paid_c")+amount;C.Log(player,"paid_hand",S(row,"npc_id"),"Jef handed over "+amount+" centimes for an errand.");return true;
            case "buy":var ware=host.Trade.Wares(S(step,"who")).First(w=>S(w,"kind")==S(step,"item"));int count=Math.Clamp((int)N(step,"count",1),1,4),cost=(int)N(ware,"price_c")*count;state["spent_c"]=N(state,"spent_c")+cost;for(int i=0;i<count;i++)state["carried"]!.AsArray().Add(new JsonObject{["kind"]=S(step,"item"),["jef"]=false});C.Log(player,"errand_bought",S(step,"who"),$"{S(row,"npc_id")} bought {count} {S(step,"item")} with Jef's coins, {cost} centimes.");host.Trade.Remember(player,S(step,"who"),"A runner bought "+S(step,"item")+" from me for Jef.",2);return true;
            case "give":var carried=A(state["carried"]);var gift=carried.FirstOrDefault(i=>S(i,"kind")==S(step,"item"));if(gift==null)return false;carried.Remove(gift);state["outcome"]!["delivered"]=true;host.Trade.Remember(player,S(step,"who"),"A runner brought me "+S(step,"item")+" from Jef.",4,"Jef sent me a gift",1);C.Log(player,"errand_delivered",S(step,"who"),"A runner delivered "+S(step,"item")+" from Jef.");return true;
            case "enter":case "sit":state["inside"]=step["place"]?.DeepClone();return true;case "leave":state["inside"]=null;return true;
            case "fetch_cart":string id=S(step,"cart");var cart=transport.LendCart(player,id);if(cart==null)return false;state["cart"]=cart;state["cart_taken"]=true;return true;
            default:return false;}
    }
    private void Result(JsonObject row,JsonObject routine,bool ok,string why)
    {
        int index=(int)N(routine,"i");var step=A(routine["steps"])[index]!;var result=new JsonObject{["i"]=index,["kind"]=S(step,"kind"),["ok"]=ok,["why"]=why,["at"]=Minute};routine["results"]!.AsArray().Add(result);if(routine["results"]!.AsArray().Count>40)routine["results"]!.AsArray().RemoveAt(0);routine["i"]=index+1;routine["since"]=Minute;Save((int)N(row,"id"),routine);if(After.TryGetValue(S(routine,"purpose"),out var after))after(row,routine,result);
    }
    public void Advance(int id)
    {
        for(int guard=0;guard<60;guard++){var row=actions.Row(id);var routine=Of(row);if(row==null||routine==null||S(row,"status")!="active")return;var step=A(routine["steps"]).ElementAtOrDefault((int)N(routine,"i"))as JsonObject;if(step==null){actions.End(id,"done","finished","That is done. Here I am again.");return;}Retarget(routine,step);Save(id,routine);string? why=Check(row,routine,step);Save(id,routine);if(why!=null){Steer(row,routine,step,why);return;}if(S(step,"kind")is "walk_to"or"carry"or"follow"or"talk_to"or"wait"or"pick_up"){host.Publish("actions");return;}bool ok=C.Atomic(()=>Run(row,routine,step));if(!ok){Steer(row,routine,step,"failed");return;}Result(row,routine,true,"done");}
        throw new InvalidOperationException("Native routine advance exceeded its finite step guard");
    }
    private void Retarget(JsonObject routine,JsonObject step)
    {
        string who=S(step,"who");var at=who=="jef"?actions.PlayerPosition((int)N(routine,"player",1))??routine["state"]?["jef"] as JsonObject:who!=""&&S(step,"kind")is "walk_to"or"talk_to"?actions.Position(who):null;if(at!=null){step["x"]=at["x"]!.DeepClone();step["z"]=at["z"]!.DeepClone();}
    }
    private void Steer(JsonObject row,JsonObject routine,JsonObject step,string why,JsonObject? supplied=null,bool fromAsync=false)
    {
        if(Failed.TryGetValue(S(routine,"purpose"),out var failure)){failure(row,routine,step,why);return;}
        var state=routine["state"]!.AsObject();if(!fromAsync&&QueueCheckin(row,routine,step,why))return;JsonObject? decision=supplied;if(!fromAsync&&N(state,"checkins")<5&&Checkin!=null){state["checkins"]=N(state,"checkins")+1;decision=Checkin(row,routine,new(){["kind"]="failed",["step"]=step.DeepClone(),["why"]=why});}string choose=S(decision,"decision");int id=(int)N(row,"id"),index=(int)N(routine,"i");var retries=state["retried"]as JsonObject??new();string key=index.ToString();
        key=S(step,"native_retry_key",key);step["native_retry_key"]=key;
        if(choose=="give_up"){Save(id,routine);actions.End(id,"failed",why,"I cannot finish that errand.");return;}if(choose=="skip"){Result(row,routine,false,why);Advance(id);return;}
        if(choose=="change_next"&&decision?["step"]is JsonObject proposed){var mapped=MapPlanStep((int)N(routine,"player",1),actions.Resident(S(row,"npc_id"))!,proposed,state["at"]as JsonObject??actions.Position(S(row,"npc_id"))!);if(mapped!=null&&mapped.Count>0){var list=A(routine["steps"]);list.RemoveAt(index);for(int i=0;i<mapped.Count;i++)list.Insert(index+i,mapped[i]!.DeepClone());Save(id,routine);Advance(id);return;}}
        if(choose!="come_back"&&N(retries,key)<1){retries[key]=1;state["retried"]=retries;A(routine["steps"]).Insert(index,new JsonObject{["kind"]="wait",["minutes"]=10,["role"]="retry"});routine["since"]=Minute;Save(id,routine);host.Publish("actions");return;}
        var jef=actions.PlayerPosition((int)N(routine,"player",1))??state["jef"] as JsonObject;if(jef==null){Save(id,routine);actions.End(id,"failed",why,"I could not finish it.");return;}var keep=new JsonArray(A(routine["steps"]).Take(index).Select(n=>n!.DeepClone()).ToArray());keep.Add(new JsonObject{["kind"]="walk_to",["who"]="jef",["x"]=N(jef,"x"),["z"]=N(jef,"z"),["role"]="report"});routine["steps"]=keep;state["report_line"]=S(decision,"line","I could not finish it. Here is what is left.");Save(id,routine);Advance(id);
    }
    private JsonObject? Report(NativeServiceRequest request,JsonObject row)
    {
        var routine=Of(row);if(routine==null)return null;int id=(int)N(row,"id"),index=(int)N(routine,"i");var step=A(routine["steps"]).ElementAtOrDefault(index)as JsonObject;if(step==null)return row;string phase=request.Text("phase"),kind=S(step,"kind");if(phase is "blocked"or"lost"){Steer(row,routine,step,phase);return actions.Row(id);}if(phase is not("arrived"or"done"))return row;var state=routine["state"]!.AsObject();if(kind=="wait"&&Minute-N(routine,"since")<N(step,"minutes"))return row;
        if(kind is "walk_to"or"carry"or"talk_to"){state["at"]=new JsonObject{["x"]=N(request.Body,"x",N(step,"x")),["z"]=N(request.Body,"z",N(step,"z"))};if(S(step,"who")=="jef"){state["outcome"]!["arrived"]=true;ReturnCarried(row,routine);state["outcome"]!["brought"]=true;if(B(state,"cart_taken")){var cart=state["cart"]!.AsObject();transport.ReturnCart((int)N(routine,"player",1),cart,N(state["at"],"x"),N(state["at"],"z"),N(cart,"yaw"));state["cart_taken"]=false;state["outcome"]!["cart_back"]=true;}}if(kind=="talk_to"){string npc=S(step,"who");host.Trade.Remember((int)N(routine,"player",1),npc,S(step,"message","A runner brought me a message from Jef."),4);state["outcome"]!["told"]=true;host.Publish("convo",new(){["id"]=id,["a"]=S(row,"npc_id"),["b"]=npc,["lines"]=new JsonArray(new JsonObject{["who"]=S(row,"npc_id"),["text"]=S(step,"message")})});}}
        if(kind=="wait"&&S(step,"role")!="retry")state["outcome"]!["watched"]=true;Result(row,routine,true,"reported");Advance(id);return actions.Row(id);
    }
    private void ReturnCarried(JsonObject row,JsonObject routine)
    {
        int player=(int)N(routine,"player",1);var state=routine["state"]!.AsObject();var carried=A(state["carried"]);foreach(var item in carried.ToArray()){if(C.Scalar<int>("SELECT COUNT(*) FROM item WHERE player_id=$p0",player)>=6)break;C.Execute("INSERT INTO item(kind,job_id,player_id) VALUES($p0,NULL,$p1)",S(item,"kind"),player);carried.Remove(item);}int coins=(int)Math.Max(0,N(state,"purse_c")-N(state,"spent_c"));if(coins>0)C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1",coins,player);state["purse_c"]=N(state,"spent_c");
    }
    private void End(JsonObject row,string status)
    {
        var routine=Of(row);if(routine==null)return;int player=(int)N(routine,"player",1);var state=routine["state"]!.AsObject();ReturnCarried(row,routine);if(B(state,"cart_taken")&&state["cart"]is JsonObject cart){var at=state["at"]??actions.Position(S(row,"npc_id"));transport.ReturnCart(player,cart,N(at,"x"),N(at,"z"),N(cart,"yaw"));state["cart_taken"]=false;}int due=status=="done"&&S(routine,"purpose")!="hire"?(int)Math.Max(0,N(state,"wage_c")-N(state,"paid_c")):0;if(due>0){int paid=Math.Min(due,C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player));C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",paid,player);state["paid_c"]=N(state,"paid_c")+paid;}Save((int)N(row,"id"),routine);if(Ended.TryGetValue(S(routine,"purpose"),out var custom))custom(row,routine,status);host.PublishState(player);
    }
    private string? ItemKind(string words){string text=words.ToLowerInvariant().Trim();foreach(var pair in new[]{("bread|loaf|loaves|rye","bread"),("herrings?|fish","herring"),("apples?","apple"),("eels?","eel"),("biscuits?","biscuit"),("lanterns?","lantern"),("newspaper|paper|handelsblad","newspaper")})if(Regex.IsMatch(text,@"\b("+pair.Item1+@")\b"))return pair.Item2;return host.Trade.Item(text)!=null?text:null;}
    private JsonArray? MapPlanStep(int player,JsonObject resident,JsonObject proposed,JsonObject from)
    {
        string kind=S(proposed,"kind"),target=S(proposed,"target"),item=ItemKind(S(proposed,"item"))??"";var steps=new JsonArray();JsonObject? where=null;string who="";void Walk(JsonObject to,string? person=null){if(D(from,to)>400)throw new NativeServiceException("That is too far for an errand.",409);steps.Add(new JsonObject{["kind"]="walk_to",["x"]=N(to,"x"),["z"]=N(to,"z"),["who"]=person,["label"]=S(to,"label",target)});}
        switch(kind){case "walk_to":var p=actions.FindPerson(target,from);where=p==null?actions.FindPlace(target):actions.Position(S(p,"id"));if(where==null)return null;Walk(where,p==null?null:S(p,"id"));break;
            case "buy":if(item=="")return null;var def=host.Trade.Item(item);if(def==null||B(def,"atCounter")||S(def,"use")=="drink"||S(def,"use")!="eat"&&item is not("lantern"or"newspaper"))throw new NativeServiceException("That cannot be carried on an errand.",409);var sellers=C.Rows("SELECT id FROM npc").Where(n=>host.Trade.Wares(S(n,"id")).Any(w=>S(w,"kind")==item)).ToArray();var explicitPerson=actions.FindPerson(target,from);var place=actions.FindPlace(target);var seller=sellers.OrderBy(n=>D(actions.Position(S(n,"id")),from)).FirstOrDefault(n=>explicitPerson!=null?S(n,"id")==S(explicitPerson,"id"):place!=null?S(actions.Resident(S(n,"id"))?["work"],"shop")==S(place,"id"):true);if(seller==null)return null;who=S(seller,"id");where=actions.Position(who);if(where==null)return null;Walk(where);steps.Add(new JsonObject{["kind"]="buy",["who"]=who,["item"]=item,["count"]=Math.Clamp((int)N(proposed,"count",1),1,4)});break;
            case "give":case "talk_to":var recipient=actions.FindPerson(target,from);if(recipient==null)return null;who=S(recipient,"id");where=actions.Position(who);if(where==null)return null;Walk(where,who);if(kind=="give")steps.Add(new JsonObject{["kind"]="give",["who"]=who,["item"]=item});else steps.Add(new JsonObject{["kind"]="talk_to",["who"]=who,["x"]=N(where,"x"),["z"]=N(where,"z"),["message"]=S(proposed,"message")[..Math.Min(200,S(proposed,"message").Length)]});break;
            case "take":if(item=="")return null;steps.Add(new JsonObject{["kind"]="take",["item"]=item});break;
            case "come_back":var jef=actions.PlayerPosition(player);if(jef==null)return null;Walk(jef,"jef");break;
            case "wait":int minutes=Math.Clamp((int)N(proposed,"minutes",60),1,120);if(N(proposed,"until_hour",-1)>=0){int hour=(int)N(host.Clock.View(),"hour");minutes=Math.Clamp((((int)N(proposed,"until_hour")-hour+24)%24)*60-(int)N(host.Clock.View(),"minute"),1,120);}steps.Add(new JsonObject{["kind"]="wait",["minutes"]=minutes,["x"]=N(from,"x"),["z"]=N(from,"z")});break;
            case "follow":steps.Add(new JsonObject{["kind"]="follow",["who"]="jef",["minutes"]=Math.Clamp((int)N(proposed,"minutes",60),40,90)});break;
            case "fetch_cart":var cart=transport.CartView(player)["list"]!.AsArray().Where(c=>!B(c,"held")&&A(c?["load"]).Count==0).OrderBy(c=>D(c,from)).FirstOrDefault();if(cart==null)return null;Walk(cart.AsObject());steps.Add(new JsonObject{["kind"]="fetch_cart",["cart"]=S(cart,"id")});break;
            default:return null;}
        return steps;
    }
    public JsonObject Propose(int player,JsonObject resident,JsonObject proposal)=>C.Atomic(()=>
    {
        string id=S(resident,"id");JsonObject No(string line)=>new(){["refused"]="routine",["line"]=line,["action_id"]=null};var plan=proposal["plan"]as JsonObject;if(plan==null)return No("Tell me what the errand is.");var raw=A(plan["steps"]);if(raw.Count==0||raw.Count>8)return No("Give me one errand with at most eight steps.");string words=S(proposal,"reason")+" "+S(plan,"goal")+" "+raw.ToJsonString();if(Regex.IsMatch(words,@"\b(steal\w*|stole|stolen|pickpocket\w*|rob\w*|burgl\w*|smash\w*|burn\w*|arson|kill\w*|stab\w*|poison\w*|threaten\w*|swindle\w*|break into|withdraw|from the bank)\b",RegexOptions.IgnoreCase))return No("I will not run an errand like that.");if(actions.Of(id)!=null)return No("I am busy already.");if(actions.Active().Count(a=>S(a,"kind")=="routine")>=4)return No("There are enough people running about already.");if(actions.Reserved?.Invoke(id)==true||C.Rules["employers"]?[id]!=null||S(resident["work"],"kind")=="guard")return No("I cannot leave my post.");if(S(resident["work"],"kind")is "stall"or"shop"or"tavern"&&host.Trade.AtWork(id))return No("I will not leave the shop.");
        var jef=actions.PlayerPosition(player)??actions.Position(id)!;var from=jef.DeepClone().AsObject();var all=new JsonArray();double metres=0;try{foreach(var ps in raw){var mapped=MapPlanStep(player,resident,ps!.AsObject(),from);if(mapped==null)continue;foreach(var step in mapped){if(step?["x"]!=null){metres+=D(from,step);from=step!.DeepClone().AsObject();}all.Add(step!.DeepClone());}}}catch(NativeServiceException e){return No(e.Message);}if(all.Count==0)return No("There is nothing I can do of that.");if(!A(all).Any(s=>S(s,"who")=="jef")){metres+=D(from,jef);all.Add(new JsonObject{["kind"]="walk_to",["who"]="jef",["x"]=N(jef,"x"),["z"]=N(jef,"z"),["role"]="report"});}if(metres>900)return No("That is too far for one errand.");
        int cost=all.Where(s=>S(s,"kind")=="buy").Sum(s=>(int)N(host.Trade.Wares(S(s,"who")).First(w=>S(w,"kind")==S(s,"item")),"price_c")*(int)N(s,"count",1));int trust=C.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=$p1",id,player),wage=(int)N(proposal,"amount_c"),units=Math.Max(1,(int)Math.Floor(metres/150+.5)+(int)Math.Floor(all.Where(s=>S(s,"kind")=="wait").Sum(s=>N(s,"minutes"))/120+.5)),price=AskFor(player,resident,units);bool child=N(resident,"age")<16||S(resident,"trade")is "street_child"or"errand_boy"or"beggar",favour=!child&&(trust>=2||trust>=0&&N(resident["stats"],"warmth")>=7&&units<=3);if(wage==0&&!favour)return No($"For {price} centimes I will do it. Half now, half when done.");if(wage>300)return No("That much for an errand? What is the catch?");if(wage>0&&wage<price)return No($"Make it {price} centimes and I will go.");int first=wage/2;if(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)<cost+first)return No("Show me the coin first.");
        if(first>0)all.Insert(0,new JsonObject{["kind"]="pay",["amount_c"]=first,["role"]="wage"});if(cost>0)all.Insert(0,new JsonObject{["kind"]="pay",["amount_c"]=cost,["role"]="purse"});var state=new JsonObject{["goal"]=S(plan,"goal"),["success"]=S(plan,"success","arrived"),["plan"]=raw.DeepClone(),["purse_c"]=0,["spent_c"]=0,["wage_c"]=wage,["paid_c"]=0,["carried"]=new JsonArray(),["outcome"]=new JsonObject(),["checkins"]=0,["retried"]=new JsonObject(),["jef"]=jef.DeepClone(),["at"]=jef.DeepClone()};var row=Start(player,id,"errand",all,state,Math.Clamp(NativeActions.WalkMinutes(metres)+20,40,180),S(proposal,"reason"));return new JsonObject{["action_id"]=row["id"]!.DeepClone(),["refused"]=null,["line"]="I will try. Wait here, and I will come back and tell you."};
    });
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/routines",r=>new JsonObject{["routines"]=List()});service.Register("POST","/api/routine/:id/step",StepRequest);
        service.NewGame+=()=>{generation++;pendingCheckins.Clear();};service.Loaded+=()=>{generation++;pendingCheckins.Clear();foreach(var row in actions.Active().OfType<JsonObject>()){var routine=Of(row);if(routine?["state"]?["steering"]==null)continue;routine["state"]!["steering"]=null;Save((int)N(row,"id"),routine);Advance((int)N(row,"id"));}};
        actions.TimeUpHandlers.Add(row=>{var routine=Of(row);if(routine==null||!TimeUps.TryGetValue(S(routine,"purpose"),out var end))return false;end(row,routine);return true;});
        actions.Proposals["routine"]=Propose;actions.Reports["routine"]=Report;actions.EndHooks.Add(End);service.Register("GET","/api/errands",r=>new JsonObject{["active"]=new JsonArray(actions.Active().Where(a=>S(a,"kind")=="routine").Select(a=>(JsonNode)new JsonObject{["row"]=a!.DeepClone(),["routine"]=Of(a.AsObject())?.DeepClone()}).ToArray()),["queue"]=C.World("native_errand_queue")?.DeepClone()??new JsonArray()});service.Register("POST","/api/dev/errand/shut",r=>{string place=r.Text("place");if(actions.FindPlace(place)==null)throw new NativeServiceException("no such place",404);var closed=C.World("m4_closed")as JsonObject??new();if(r.Bool("on",true))closed[place]=-1;else if(N(closed,place)==-1)closed.Remove(place);C.SetWorld("m4_closed",closed);host.Publish("events");return new JsonObject{["closed"]=new JsonArray(closed.Select(p=>(JsonNode)JsonValue.Create(p.Key)!).ToArray())};});service.TickHooks.Add((request,advanced)=>{if(!advanced)return;foreach(var row in actions.Active().Where(a=>S(a,"kind")=="routine")){var routine=Of(row!.AsObject());if(routine==null)continue;var step=A(routine["steps"]).ElementAtOrDefault((int)N(routine,"i"));if(S(step,"kind")=="wait"&&N(step,"minutes")>0&&routine["state"]?["steering"]==null&&Minute-N(routine,"since")>=N(step,"minutes")){Result(row.AsObject(),routine,true,"waited");Advance((int)N(row,"id"));}}});
    }
}
