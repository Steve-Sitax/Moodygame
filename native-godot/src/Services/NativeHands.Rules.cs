using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace Scheldemist.Native.Services;
public sealed partial class NativeHands
{
    public static readonly Regex WorkWords=new(@"\b(carry|haul|lift|loads?|crates?|sacks?|barrels?|goods|watch|guard|mind|keep an eye|work for me|help me)\b",RegexOptions.IgnoreCase);
    private static readonly Dictionary<string,int> Numbers=new(){{"one",1},{"two",2},{"three",3},{"four",4},{"five",5},{"six",6},{"seven",7},{"eight",8},{"nine",9},{"ten",10},{"eleven",11},{"twelve",12},{"fifteen",15},{"twenty",20},{"twenty-five",25},{"thirty",30},{"forty",40},{"fifty",50},{"sixty",60},{"seventy",70},{"eighty",80},{"ninety",90},{"hundred",100}};
    public static (int[] Unit,int[] Bare) Sums(string words)
    {
        var unit=new List<int>();var bare=new List<int>();string text=Regex.Replace(words.ToLowerInvariant().Replace("half a franc","50 centimes"),@"\ba franc\b","1 franc");
        foreach(Match m in Regex.Matches(text,@"\b(\d{1,7}|twenty-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s*(francs?|fr\b|centimes?|cents?|c\b|sous?)?")){int n=int.TryParse(m.Groups[1].Value,out int digit)?digit:Numbers[m.Groups[1].Value];string u=m.Groups[2].Value;if(u.StartsWith("fr"))unit.Add(n*100);else if(u.StartsWith("sou"))unit.Add(n*5);else if(u!="")unit.Add(n);else bare.Add(n);}return(unit.ToArray(),bare.ToArray());
    }
    public static int Offer(string words,int modelAmount){var sums=Sums(words);if(sums.Unit.Length>0)return sums.Unit.Contains(modelAmount)?modelAmount:sums.Unit[0];if(sums.Bare.Contains(modelAmount)&&modelAmount>0)return modelAmount;return sums.Bare.Length==1&&Regex.IsMatch(words,@"\b(pay|give|wage|for)\b",RegexOptions.IgnoreCase)?sums.Bare[0]:0;}
    public static string PayPlan(string words){if(Regex.IsMatch(words,@"\bhalf\b",RegexOptions.IgnoreCase))return "half";if(Regex.IsMatch(words,@"\b(at the end|when (it'?s|you'?re|we'?re|they'?re|the job'?s) (done|finished|delivered)|afterwards?|after(wards)? you'?re done|on delivery|when done)\b",RegexOptions.IgnoreCase))return "end";return Regex.IsMatch(words,@"\b(all|everything|the lot|in full|whole)\b.*\b(now|up front|upfront|in advance|first)\b|\b(up front|upfront|in advance)\b",RegexOptions.IgnoreCase)?"now":"half";}
    public static string TaskKind(string words)=>Regex.IsMatch(words,@"\b(watch|guard|mind|keep an eye)\b",RegexOptions.IgnoreCase)&&!Regex.IsMatch(words,@"\b(carry|crates?|sacks?|barrels?|haul|lift)\b",RegexOptions.IgnoreCase)?"watch":"carry";
    public static (int? WalkOff,int? AskMore) Dishonesty(JsonObject person,int trust,string plan,int expected,Func<double> roll)
    {
        double calm=trust>=5?.5:1,walk=Math.Max(0,4-N(person["stats"],"honesty"))*.12*(S(person,"trade")is "thief"or"runner"?1.5:1)*(plan=="now"?1.5:1)*calm;if(roll()<walk)return(Math.Min(Math.Max(0,expected-1),1),null);double ask=(N(person["stats"],"greed")>=7?.35:N(person["stats"],"greed")>=5&&N(person["stats"],"honesty")<=4?.15:0)*calm;return expected>=2&&roll()<ask?(null,(int)Math.Ceiling(expected/2.0)):(null,null);
    }
    private static int PerTrip(string kind)=>kind switch{"sacks"=>5,"crates"=>5,"barrels"=>3,"hides"=>5,"rope"=>5,"chests"=>5,_=>5};
    private string? Check(JsonObject routine,JsonObject step)
    {
        var state=routine["state"]!;string kind=S(step,"kind");if(kind=="carry"&&N(state,"holding")==0)return "empty_hands";if(kind is "walk_to"or"carry"&&actions.NearestOpen!=null&&actions.NearestOpen(N(step,"x"),N(step,"z"),4)==null)return "no_way";if(kind!="pick_up")return null;
        int job=(int)N(state,"job"),left=Left(job);if(left<=0)return "none_left";var all=goods.List();var items=all.Where(i=>N(i,"job",-1)==job&&i?["by"]==null&&!all.Any(other=>other?["by"]==null&&A(other?["on"]).Any(above=>above?.GetValue<string>()==S(i,"id")))).OrderBy(i=>D(i,state["from"])).Take(Math.Min(left,(int)N(step,"count",1))).ToArray();if(items.Length==0)return "none_left";
        step["gids"]=new JsonArray(items.Select(i=>(JsonNode)JsonValue.Create(S(i,"id"))!).ToArray());step["gid"]=S(items[0],"id");return null;
    }
    private void AddLoads(JsonObject routine){var steps=A(routine["steps"]);int i=(int)N(routine,"i");while(steps.Count>i)steps.RemoveAt(i);foreach(var step in LoadSteps(routine["state"]!.AsObject()))steps.Add(step!.DeepClone());}
    private void Progress(int player,int job,string field,int count){var task=host.Jobs.Get(job)["task"]!;var p=task["progress"]?.DeepClone().AsObject()??new JsonObject{["delivered"]=0,["lost"]=0,["sold"]=0};p[field]=N(p,field)+Math.Min(count,Left(job));host.Jobs.Progress(player,job,p);}
    private void After(JsonObject row,JsonObject routine,JsonObject result)
    {
        int id=(int)N(row,"id"),player=(int)N(routine,"player",1),index=(int)N(routine,"i")-1;var state=routine["state"]!.AsObject();var step=A(routine["steps"])[index]!;string kind=S(result,"kind"),npc=S(row,"npc_id");if(!B(result,"ok")){actions.End(id,"failed",S(result,"why"));return;}
        if(kind=="walk_to"&&S(step,"label")=="Jef's handcart"&&state["cart"]is JsonObject cart&&!B(cart,"taken")){var loan=transport.LendCart(player,S(cart,"id"));if(loan!=null){cart["taken"]=true;cart["data"]=loan;}else state["cart"]=null;routines.Save(id,routine);return;}
        if(kind=="pick_up"){
            var selected=A(step["gids"]).Take(Math.Max(1,(int)N(state,"holding",1))).Select(g=>g!.DeepClone()).ToArray();var response=goods.Operate(player,new(){["op"]="npc_lift",["npc"]=npc,["ids"]=new JsonArray(selected)});if(!B(response,"ok")){state["holding"]=0;routines.Save(id,routine);actions.End(id,"failed","could not lift");return;}
            state["gids"]=new JsonArray(selected.Select(g=>g.DeepClone()).ToArray());state["holding"]=selected.Length;if(state["walk_off_at"]!=null&&N(state,"loads")>=N(state,"walk_off_at")){var next=A(routine["steps"]).ElementAtOrDefault((int)N(routine,"i"));if(next!=null){var from=state["from"]!;var to=state["to"]!;double dx=N(from,"x")-N(to,"x"),dz=N(from,"z")-N(to,"z"),length=Math.Sqrt(dx*dx+dz*dz);var away=actions.NearestOpen?.Invoke(N(from,"x")+(length>0?dx/length*45:20),N(from,"z")+(length>0?dz/length*45:0),4)??new JsonObject{["x"]=N(from,"x")+20,["z"]=N(from,"z")};next["off"]=true;next["x"]=away["x"]!.DeepClone();next["z"]=away["z"]!.DeepClone();next["label"]="away";}}routines.Save(id,routine);return;
        }
        if(kind=="carry"){
            int count=(int)N(state,"holding");bool stole=B(step,"off");foreach(var gid in A(state["gids"]).ToArray()){var item=goods.Get(gid!.GetValue<string>());if(item?["by"]?["npc"]?.GetValue<string>()!=npc)continue;if(stole)goods.Operate(player,new(){["op"]="npc_drop",["npc"]=npc,["id"]=gid.DeepClone(),["why"]="stolen"});else{var job=host.Jobs.Get((int)N(state,"job"));var position=goods.Slot(S(job["task"],"to"),(int)N(job["task"]?["progress"],"delivered")+Array.IndexOf(A(state["gids"]).ToArray(),gid),.8);var put=goods.Operate(player,new(){["op"]="npc_put",["npc"]=npc,["id"]=gid.DeepClone(),["x"]=position.x,["z"]=position.z});if(!B(put,"ok")){routines.Save(id,routine);actions.End(id,"failed","no room to set down");return;}}}
            Progress(player,(int)N(state,"job"),stole?"lost":"delivered",count);state["gids"]=new JsonArray();state["holding"]=0;if(stole){state["stole"]=true;routines.Save(id,routine);C.Log(player,"robbed",npc,S(actions.Resident(npc),"name")+" walked off with a load of Jef's job and the wage paid.","world");host.Publish("hands",new(){["npc"]=npc,["name"]=S(actions.Resident(npc),"name"),["line"]="",["say"]="Your hand has gone, and a load with them."});actions.End(id,"failed","walked off");return;}state["loads"]=N(state,"loads")+count;
            if(state["ask_more_at"]!=null&&!B(state,"asked")&&N(state,"loads")>=N(state,"ask_more_at")&&Left((int)N(state,"job"))>0){int asking=Math.Max(5,Round5(N(state,"wage_c")*.5));state["asking"]=asking;var steps=A(routine["steps"]);while(steps.Count>N(routine,"i"))steps.RemoveAt(steps.Count-1);steps.Add(new JsonObject{["kind"]="wait",["minutes"]=20,["label"]="asking for more"});host.Publish("hands",new(){["npc"]=npc,["name"]=S(actions.Resident(npc),"name"),["line"]=HandLine(npc,"ask_more")+" "+asking+" centimes more, or I put it down here.",["ask"]=asking});}else if(Left((int)N(state,"job"))>0)AddLoads(routine);routines.Save(id,routine);return;
        }
        if(kind=="wait"&&S(state,"task")=="carry"){if(N(state,"asking")>0){state["asking"]=0;routines.Save(id,routine);actions.End(id,"failed","quit");return;}if(Left((int)N(state,"job"))>0)AddLoads(routine);routines.Save(id,routine);}
    }
    private void Ended(JsonObject row,JsonObject routine,string status)
    {
        var state=routine["state"]!.AsObject();int player=(int)N(routine,"player",1);string npc=S(row,"npc_id"),task=S(state,"task");bool stole=B(state,"stole"),finished=status=="done"&&(task=="watch"||state["job"]==null||Left((int)N(state,"job"))==0);
        if(!stole){int earned=finished||task=="watch"?(int)N(state,"wage_c"):Round5(N(state,"wage_c")*N(state,"loads")/Math.Max(1,N(state,"expected")));earned=Math.Min(earned,(int)N(state,"wage_c"));int over=(int)N(state,"paid_c")-earned;if(over>0)Keep(player,npc,task,over);int due=(int)Math.Max(0,earned-N(state,"paid_c")),pay=Math.Min(due,C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player));Pay(player,npc,pay,"the rest of a wage");state["paid_c"]=N(state,"paid_c")+pay;if(pay<due){C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) VALUES($p0,$p1)",npc,player);C.Execute("UPDATE npc_relationship SET trust=MAX(-5,trust-2) WHERE npc_id=$p0 AND player_id=$p1",npc,player);host.Trade.Remember(player,npc,$"Jef owes me {due-pay} centimes of my wage. He had not got it.",6,"Jef did not pay "+S(actions.Resident(npc),"name")+" all their wage",-2);}
            if(state["cart"]is JsonObject cart&&B(cart,"taken")&&cart["data"]is JsonObject loan){var at=state["at"]??state["to"]??cart;transport.ReturnCart(player,loan,N(at,"x")+3.5,N(at,"z"),N(cart,"yaw"));cart["taken"]=false;}
        }
        foreach(var gid in A(state["gids"]))if(goods.Get(gid!.GetValue<string>())?["by"]?["npc"]?.GetValue<string>()==npc){var at=state["at"]??state["from"];goods.Operate(player,new(){["op"]="npc_put",["npc"]=npc,["id"]=gid.DeepClone(),["x"]=N(at,"x"),["z"]=N(at,"z")});}
        state["gids"]=new JsonArray();state["holding"]=0;routines.Save((int)N(row,"id"),routine);if(N(state,"loads")>0&&!stole)host.Trade.Remember(player,npc,$"I carried {N(state,"loads")} loads for Jef, and he paid.",3);host.PublishState(player);
    }
    public JsonObject AnswerAsk(int player,string npc,bool pay)
    {
        var found=Active(player).FirstOrDefault(pair=>S(pair.Row,"npc_id")==npc);if(found.Routine==null||N(found.Routine["state"],"asking")<=0)throw new NativeServiceException("nobody is asking you for anything",409);var state=found.Routine["state"]!;int extra=(int)N(state,"asking");state["asking"]=0;state["asked"]=true;bool carryOn=pay||N(actions.Resident(npc)?["stats"],"honesty")>=4||C.Roll()<.5;if(pay){Pay(player,npc,extra,"more, asked halfway");state["wage_c"]=N(state,"wage_c")+extra;state["paid_c"]=N(state,"paid_c")+extra;}routines.Save((int)N(found.Row,"id"),found.Routine);if(carryOn)routines.CompleteStep(player,(int)N(found.Row,"id"),(int)N(found.Routine,"i"),true,pay?"paid more":"carries on");else actions.End((int)N(found.Row,"id"),"failed","quit");return new(){["text"]=carryOn?HandLine(npc,"carry_on"):HandLine(npc,"quit"),["quit"]=!carryOn};
    }
    public void AttachTalk(NativeTownTalk talk)
    {
        talk.EngineFreeReplies.Add((request,person,words)=>{if(talk.CanNarrate(request.PlayerId,S(person,"id"))||!WorkWords.IsMatch(words)||!Regex.IsMatch(words,@"\b(pay|hire|wage|centimes?|francs?|help me)\b",RegexOptions.IgnoreCase))return null;var result=Propose(request.PlayerId,person,new(){["asked_words"]=words,["amount_c"]=0})!;var answer=talk.Line(request,person,S(result,"line"),B(result,"end"));if(result["note"]!=null)answer["note"]=result["note"]!.DeepClone();return answer;});
        talk.ChoiceAdditions.Add((player,person)=>{var found=Active(player).FirstOrDefault(pair=>S(pair.Row,"npc_id")==S(person,"id"));int asking=(int)N(found.Routine?["state"],"asking");return asking>0?new[]{$"All right, {asking} more. Now get on with it.","No. A bargain is a bargain."}:Array.Empty<string>();});
        talk.ReplyOverrides.Add((request,person,topic)=>{if(topic==null||!topic.StartsWith("extra:",StringComparison.Ordinal))return null;var found=Active(request.PlayerId).FirstOrDefault(pair=>S(pair.Row,"npc_id")==S(person,"id"));int ask=(int)N(found.Routine?["state"],"asking");if(ask<=0)return null;bool pay=topic==$"extra:All right, {ask} more. Now get on with it.";if(!pay&&topic!="extra:No. A bargain is a bargain.")return null;var answer=AnswerAsk(request.PlayerId,S(person,"id"),pay);return talk.Line(request,person,S(answer,"text"),B(answer,"quit"));});
        talk.ContextProviders.Add((player,person)=>Active(player).FirstOrDefault(pair=>S(pair.Row,"npc_id")==S(person,"id")).Routine?["state"]?.DeepClone());
    }
    public void Register(NativeServiceHost service)
    {
        actions.Proposals["work_for_pay"]=Propose;routines.Checks["hire"]=Check;routines.After["hire"]=After;routines.Ended["hire"]=Ended;routines.Failed["hire"]=(row,routine,step,why)=>actions.End((int)N(row,"id"),why=="none_left"?"done":"failed",why);routines.TimeUps["hire"]=(row,routine)=>actions.End((int)N(row,"id"),"failed","home");
        var oldCart=goods.NpcHasCart;goods.NpcHasCart=npc=>routines.Of(actions.Of(npc))?["state"]?["cart"]?["taken"]?.GetValue<bool>()==true||oldCart?.Invoke(npc)==true;transport.Guards.Add((player,x,z)=>Active(player).Any(pair=>S(pair.Routine["state"],"task")=="watch"&&D(pair.Routine["state"]?["from"],new JsonObject{["x"]=x,["z"]=z})<20));
        service.NewGame+=()=>{generation++;pending.Clear();};service.Loaded+=()=>{generation++;pending.Clear();};service.TickHooks.Add((request,advanced)=>{if(advanced&&Hour>=18)foreach(var (row,routine) in Active().ToArray())if(NativeShops.Activity(actions.Resident(S(row,"npc_id"))!,Day,Hour).act=="home")actions.End((int)N(row,"id"),"failed","home");});
    }
}
