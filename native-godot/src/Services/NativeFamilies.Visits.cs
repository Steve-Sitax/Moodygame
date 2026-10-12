using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
namespace Scheldemist.Native.Services;
public sealed partial class NativeFamilies
{
    private static JsonObject Data(JsonNode? row){try{return JsonNode.Parse(S(row,"data_json","{}"))!.AsObject();}catch{return new();}}
    private JsonObject? Seek(int player,string npc)=>actions.Of(npc)is {} row&&S(row,"kind")=="seek"&&N(row,"for_player",1)==player?row:null;
    private void SetSeek(JsonObject row,string phase,int until,JsonObject? patch=null){var data=Data(actions.Row((int)N(row,"id")));if(patch!=null)foreach(var p in patch)data[p.Key]=p.Value?.DeepClone();C.Execute("UPDATE npc_action SET phase=$p0,until=$p1,data_json=$p2 WHERE id=$p3",phase,until,data.ToJsonString(),(int)N(row,"id"));}
    private void EndVisit(JsonObject row,string outcome){var data=Data(row);if(data["news"]!=null)Patch((int)N(data,"news"),new(){["status"]="done",["outcome"]=outcome});actions.End((int)N(row,"id"),"done",outcome);}
    private string Opening(JsonObject row)
    {
        var data=Data(row);var news=data["news"]==null?null:News((int)N(data,"news"));var person=actions.Resident(S(row,"npc_id"))!;var teller=news==null?null:actions.Resident(S(news,"teller"));string kin=teller==null?"People":KinWord(person,teller),fact=news==null?"what happened":NativeCoreRumours.ToYou(S(news,"gist"));if(S(news,"opening")!=""&&S(news,"reaction")==S(data,"reaction"))return S(news,"opening");
        return S(data,"reaction") switch{"talk_calm"=>"A word, if you will let me. "+kin+" tells me "+fact+". I would rather hear it from you.","talk_angry"=>"You there. "+kin+" told me "+fact+". What have you got to say for yourself?","demand_apology"=>kin+" told me "+fact+". You will say sorry for that, to my face.","demand_payment"=>kin+" told me "+fact+". That cost us. "+N(news,"amount_c",15)+" centimes puts it right.","thank"=>"I wanted to thank you myself. "+kin+" told me "+fact+".","invite_supper"=>"Come and eat with us tonight. There is stew, and bread enough.","gift"=>"Here, take this. No, no, I insist.","police_word"=>"A word. There has been a complaint about you. I will not have trouble on my beat.",_=>"You are new here. I am "+S(person,"first")+". Mind how you go on these quays."};
    }
    private (string? Police,int Crowd) Deterrence(int player,string exclude)
    {
        var jef=actions.PlayerPosition(player);if(jef==null)return(null,0);string? police=null;int crowd=0;foreach(var known in actions.PeopleNear(N(jef,"x"),N(jef,"z"),30)){string id=S(known,"id");if(id==exclude)continue;var person=actions.Resident(id);if(person==null)continue;if(S(person,"trade")is "police"or"water_bailiff"&&N(known,"d")<=30)police??=id;if(N(known,"d")<=15&&N(person,"age")>=13)crowd++;}return(police,crowd);
    }
    private JsonObject? SeekReport(NativeServiceRequest request,JsonObject row)
    {
        if(request.Text("phase")is "lost"or"blocked"){EndVisit(row,"lost Jef");return actions.Row((int)N(row,"id"));}if(request.Text("phase")!="arrived"||S(row,"phase")!="going")return row;var data=Data(row);string reaction=S(data,"reaction"),npc=S(row,"npc_id");int player=(int)N(row,"for_player",1);
        if(reaction is "mug"or"knock_down"){var deter=Deterrence(player,npc);if(deter.Police!=null||deter.Crowd>=6){EndVisit(row,"deterred");return actions.Row((int)N(row,"id"));}int amount=ClampAmount(player,reaction,0);string line=reaction=="mug"?"I heard what you did. You will pay for it. Turn out your pockets.":"I heard what you did. Nobody does that to my family.";SetSeek(row,"menace",Minute+25,new(){["line"]=line,["demand"]=amount});Fact("action","menace",npc,null,S(actions.Resident(npc),"name")+" came up to Jef in the street with a grudge.",6);host.Publish("families",new(){["menace"]=MenaceNow(player)});return actions.Row((int)N(row,"id"));}
        if(reaction=="gift"&&C.Scalar<int>("SELECT COUNT(*) FROM item WHERE player_id=$p0",player)<6){var ware=host.Trade.Wares(npc).Where(w=>S(host.Trade.Item(S(w,"kind")),"use")=="eat").OrderBy(w=>N(w,"price_c")).FirstOrDefault();if(ware!=null){C.Execute("INSERT INTO item(kind,job_id,player_id) VALUES($p0,NULL,$p1)",S(ware,"kind"),player);C.Log(player,"given",S(ware,"kind"),S(actions.Resident(npc),"name")+" gave Jef "+S(host.Trade.Item(S(ware,"kind")),"name",S(ware,"kind"))+", for his kindness.",npc);}}
        SetSeek(row,"at_jef",Minute+20);host.Publish("families",new(){["visit"]=VisitNow(player),["jobs"]=true});return actions.Row((int)N(row,"id"));
    }
    public JsonObject? MenaceNow(int player)
    {
        var row=actions.Active().FirstOrDefault(a=>S(a,"kind")=="seek"&&S(a,"phase")=="menace"&&N(a,"for_player",1)==player);if(row==null)return null;var data=Data(row);return new(){["action"]=N(row,"id"),["npc"]=S(row,"npc_id"),["name"]=S(actions.Resident(S(row,"npc_id")),"name"),["kind"]=S(data,"reaction")=="mug"?"mug":"knock_down",["demand_c"]=N(data,"demand"),["line"]=S(data,"line")};
    }
    public JsonObject? VisitNow(int player)
    {
        var row=actions.Active().FirstOrDefault(a=>S(a,"kind")=="seek"&&S(a,"phase")=="at_jef"&&N(a,"for_player",1)==player&&!B(Data(a),"opened"));return row==null?null:new(){["action"]=N(row,"id"),["npc"]=S(row,"npc_id"),["name"]=S(actions.Resident(S(row,"npc_id")),"name"),["title"]=S(actions.Resident(S(row,"npc_id")),"trade").Replace('_',' '),["reaction"]=S(Data(row),"reaction")};
    }
    public JsonObject? ResolveMenace(int player,int id,string how,bool talked=false,string line="")
    {
        var row=actions.Row(id);if(row==null||S(row,"status")!="active"||S(row,"kind")!="seek"||S(row,"phase")!="menace"||N(row,"for_player",1)!=player)return null;var data=Data(row);string npc=S(row,"npc_id"),kind=S(data,"reaction")=="mug"?"mug":"knock_down";var person=actions.Resident(npc)!;
        JsonObject Done(string outcome,string text,int health=0,int money=0){EndVisit(row,outcome);var result=new JsonObject{["outcome"]=outcome,["text"]=text,["line"]=line,["health_lost"]=health,["money_lost"]=money};host.Publish("families",new(){["menace_end"]=NativeCoreClock.Join(new JsonObject{["action"]=id,["npc"]=npc},result),["jobs"]=true});host.PublishState(player);return result;}
        if(how=="ran"){host.Trade.Remember(player,npc,"Jef ran from me like a rat. I know his face.",6);Fact("action","menace_ran",npc,null,"Jef got away from "+S(person,"name")+", who came for him with a grudge.",5);return Done("ran","You get away. They do not follow far.");}
        if(how=="pay"){int amount=Math.Min((int)N(data,"demand"),C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player));if(amount>0){C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",amount,player);C.Log(player,"paid_off",npc,$"Jef paid {S(person,"name")} {amount} centimes to let it go.");host.Trade.Remember(player,npc,$"Jef paid me {amount} centimes to let it go.",6);return Done("paid","You give them "+amount+" centimes. They count them and walk off.",0,amount);}}
        if(how=="talk"&&talked){host.Trade.Remember(player,npc,"Jef talked me down in the street. Maybe I had it wrong.",5,"Jef talked "+S(person,"name")+" out of a quarrel",1);return Done("talked_down","They let their hands drop and walk off.");}
        var deter=Deterrence(player,npc);if(deter.Police!=null||deter.Crowd>=6)return Done("deterred",deter.Police!=null?"A police agent watches. They think better of it.":"People stop and stare. They think better of it.");
        int health=(int)Math.Max(0,Math.Min(kind=="mug"?1:2,C.Scalar<int>("SELECT health FROM player WHERE id=$p0",player)-1)),money=kind=="mug"?Math.Min(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player),Math.Min(40,(int)N(data,"demand"))):0;C.Execute("UPDATE player SET health=MAX(1,health-$p0),money_c=MAX(0,money_c-$p1) WHERE id=$p2",health,money,player);C.Log(player,money>0?"robbed":"assaulted",npc,S(person,"name")+" knocked Jef down in the street"+(money>0?" and took "+money+" centimes.":"."));
        string gist="Jef was knocked down"+(money>0?" and robbed":"")+" in the street by "+S(person,"name");host.Trade.Remember(player,npc,"I knocked Jef down for what he did to my family.",8,gist,0);var jef=actions.PlayerPosition(player);var witnesses=jef==null?new JsonArray():new JsonArray(actions.PeopleNear(N(jef,"x"),N(jef,"z"),20).Where(p=>S(p,"id")!=npc).Take(5).Select(p=>p!["id"]!.DeepClone()).ToArray());foreach(var witness in witnesses)host.Trade.Remember(player,witness!.GetValue<string>(),"I saw "+S(person,"name")+" knock a young man down in the street.",6,gist,0);Fact("theft",money>0?"mugged":"knocked_down",npc,"player",S(person,"name")+" knocked Jef down in the street"+(money>0?" and took "+money+" centimes.":".")+" Nobody was badly hurt.",8,new(){["health_lost"]=health,["money_lost"]=money,["witnesses"]=witnesses},money>0?"mugged":"knocked_down");host.Rumours.ApplyTrust(npc,player,-2,0);return Done(money>0?"mugged":"knocked_down","They shove you hard and you go down on the cobbles. Your head rings.",health,money);
    }
    private string[] VisitChoices(int player,JsonObject person)
    {
        var row=Seek(player,S(person,"id"));if(row==null||S(row,"phase")!="at_jef")return Array.Empty<string>();var d=Data(row);var n=d["news"]==null?null:News((int)N(d,"news"));return S(d,"reaction")switch{
            "talk_calm"or"talk_angry"or"demand_apology"=>new[]{"I'm sorry for it. I meant no harm.","I said what I said."},
            "demand_payment"=>new[]{$"Here, {N(n,"amount_c",15)} centimes. Let's call it square.","I owe you nothing."},
            "thank"=>new[]{"It was nothing. Anyone would have."},"meet"=>new[]{"Good to meet you."},"invite_supper"=>new[]{"I'd be glad to. Thank you.","Another time, thank you."},"gift"=>new[]{"Thank you kindly."},"police_word"=>new[]{"It won't happen again, agent.","That's a lie, and you know it."},_=>Array.Empty<string>()};
    }
    private JsonObject? VisitReply(NativeTownTalk talk,NativeServiceRequest request,JsonObject person,string? topic)
    {
        var row=Seek(request.PlayerId,S(person,"id"));if(row==null||S(row,"phase")!="at_jef"||topic==null||!topic.StartsWith("extra:",StringComparison.Ordinal))return null;string choice=topic[6..];if(!VisitChoices(request.PlayerId,person).Contains(choice))return null;var data=Data(row);string reaction=S(data,"reaction"),text="Good day to you.";int trust=0;bool end=false;string npc=S(person,"id");int player=request.PlayerId;
        if(choice.StartsWith("I'm sorry",StringComparison.Ordinal)){text="Well. We will leave it there.";trust=1;host.Trade.Remember(player,npc,"Jef said he was sorry, to my face.",5,"Jef said sorry to "+S(person,"name")+" and meant it",1);}
        else if(choice=="I said what I said."||choice=="I owe you nothing."||choice.StartsWith("That's a lie",StringComparison.Ordinal)){text="Then mind yourself. I will be watching.";trust=-1;end=true;host.Trade.Remember(player,npc,"Jef would not put right what I came about.",7,"Jef refused "+S(person,"name")+" over a complaint",-1);}
        else if(reaction=="demand_payment"){var news=data["news"]==null?null:News((int)N(data,"news"));int amount=(int)N(news,"amount_c",15);if(C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player)<amount)return talk.Line(request,person,"You have not got "+amount+" centimes. Come back when you have.");C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",amount,player);C.Log(player,"paid",npc,$"Jef paid {S(person,"name")} {amount} centimes to put the complaint right.");text="That is square, then. No hard feelings.";trust=1;}
        else if(reaction=="invite_supper"&&choice.StartsWith("I'd",StringComparison.Ordinal)){C.Execute("UPDATE player SET food=MIN(10,food+3),warmth=MIN(10,warmth+2) WHERE id=$p0",player);C.SetPlayerState(player,"supper_day",Day);C.Log(player,"supper",npc,"Jef ate supper with the "+S(person,"surname")+" family.");foreach(var kin in People.Where(p=>N(p,"household")==N(person,"household")))host.Trade.Remember(player,S(kin,"id"),"Jef ate supper with us. He has manners, for a quay man.",5);host.Publish("families",new(){["veil"]="You eat with the "+S(person,"surname")+" family: stew, dark bread, weak beer. You leave warm and full.",["jobs"]=true});text="Come, then. It is this way.";trust=1;end=true;}
        else if(choice=="Another time, thank you.")text="Another time, then. The door is open.";else if(reaction=="police_word")text="See it does not. That is all.";else{text="Well, God keep you. Mind how you go.";trust=1;}
        EndVisit(row,choice);if(trust!=0)host.Rumours.ApplyTrust(npc,player,trust,0);host.PublishState(player);return talk.Line(request,person,text,end);
    }
    public void AttachTalk(NativeTownTalk talk)
    {
        talk.OpeningOverrides.Add((request,person)=>{var row=Seek(request.PlayerId,S(person,"id"));if(row==null||S(row,"phase")!="at_jef")return null;SetSeek(row,"at_jef",(int)N(row,"until"),new(){["opened"]=true});return Opening(row);});talk.ChoiceAdditions.Add(VisitChoices);talk.ReplyOverrides.Add((request,person,topic)=>VisitReply(talk,request,person,topic));talk.ContextProviders.Add((player,person)=>Seek(player,S(person,"id"))is {} row&&S(row,"phase")=="at_jef"?new JsonObject{["why_came"]=Opening(row),["reaction"]=S(Data(row),"reaction")}:null);
    }
}
