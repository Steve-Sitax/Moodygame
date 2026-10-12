using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreIdeas
{
    public Func<int,JsonObject?>? PlayerPosition;
    public Func<string,JsonObject,double,JsonObject?>? PickResponder;
    public Func<int,string,string,string,JsonObject,JsonObject>? CallResponder;
    public Func<JsonArray>? Comings;
    public static int TroubleCap(double pay)=>(int)Math.Clamp(Round5(pay*.25),5,40);
    public static string[] FittingTrouble(JsonObject job,string weather)
    {
        var t=job["task"];if(t==null)return Array.Empty<string>();var kinds=new List<string>();string kind=S(t,"kind");if(kind=="carry"){if(S(t,"goods")is"crates"or"barrels"or"chests")kinds.AddRange(new[]{"stowaway","broken_crate"});kinds.Add("rival");}if(kind is"carry"or"deliver")kinds.Add("customs");if(kind=="watch")kinds.Add("rival");if(kind is"carry"or"deliver"or"watch"or"letters"&&(weather!="clear"||kind!="letters"))kinds.Add("weather");return kinds.ToArray();
    }
    private JsonObject? Spot(string id)=>host.Jobs.Plan.Data["spots"]?[id]?.DeepClone().AsObject();
    private JsonObject? JobAt(JsonObject j)=>PlayerPosition?.Invoke((int)N(j,"taken_by",1))??Spot(S(j["task"],"from",S(j["task"],"post")));
    private JsonObject? NearestFor(JsonObject j,string role){var at=JobAt(j);return at==null?null:PickResponder?.Invoke(role,at,2000)?["r"]?.DeepClone().AsObject();}
    public JsonObject? PlanTrouble(JsonObject j,Func<double> rng,string? force=null,JsonObject? castAs=null)
    {
        string weather=S(host.Clock.View(),"weather");var kinds=FittingTrouble(j,weather);string? kind=force!=null?(kinds.Contains(force)?force:null):kinds.ElementAtOrDefault((int)Math.Floor(rng()*kinds.Length));if(kind==null)return null;double pay=N(j,"pay_c");int cap=TroubleCap(pay),half=Round5(cap/2.0);if(half==0)half=5;string who=S(j,"employer_name");var employer=C.Rules["employers"]?[S(j,"employer_npc")];var door=employer==null?null:Spot(S(employer,"door"));var chandler=Spot("peeters_dock");var pp=PolicePost();var cast=new JsonArray();var options=new JsonArray();int count=S(j["task"],"kind")=="carry"?(int)N(j["task"],"count"):1;
        JsonObject Step(JsonObject at,string label,int done,int missed)=>new(){["x"]=N(at,"x"),["z"]=N(at,"z"),["label"]=label,["done_c"]=done,["missed_c"]=missed};
        JsonObject Roll(double p,int penalty,int trust,string fact,bool police=false){var roll=new JsonObject{["p"]=p,["pay_c"]=penalty,["trust"]=trust,["what"]=fact};if(police)roll["police"]=true;return roll;}
        JsonObject Option(string label,string after,string fact,int? moneyIn=null,int? moneyOut=null,int? payChange=null,int? trust=null,JsonObject? step=null,JsonObject? roll=null,string? afterBad=null){var result=new JsonObject{["label"]=label,["after"]=after,["fact"]=fact};if(moneyIn!=null)result["now_in_c"]=moneyIn;if(moneyOut!=null)result["now_out_c"]=moneyOut;if(payChange!=null)result["pay_c"]=payChange;if(trust!=null)result["trust"]=trust;if(step!=null)result["step"]=step;if(roll!=null)result["roll"]=roll;if(afterBad!=null)result["after_bad"]=afterBad;return result;}
        void Cast(string? id,string name,string role)=>cast.Add(new JsonObject{["id"]=id,["name"]=name,["role"]=role});
        switch(kind){
        case"stowaway":
            Cast(null,"a thin boy of about twelve","a stowaway, hidden in a crate from the ship");
            options.Add(Option("Take him to the police post","You walk him up to the police post by the town hall.","Jef found a stowaway boy in a crate and took him to the police post.",step:Step(pp,S(pp,"label"),half,0)));
            options.Add(Option("Let him slip away","He is gone between the sheds before anyone looks up.","Jef found a stowaway boy in a crate and let him go.",roll:Roll(.4,0,-1,$"{who} found out Jef let a stowaway go."),afterBad:$"{who} heard of it and is not pleased."));
            options.Add(Option($"Tell {who}'s man","The man takes the boy by the ear. The work goes on.",$"Jef found a stowaway boy in a crate and handed him to {who}'s man.",payChange:5));break;
        case"broken_crate":
            Cast(null,$"{who}'s tally man","counts the goods");options.Add(Option("Own up to it","The tally man writes it down. It will come off your pay, but he nods at you.","A crate broke in Jef's hands and he owned up to it.",payChange:-half,trust:1));
            if(chandler!=null)options.Add(Option("Fetch nails at the chandler's and mend it","Nails, a borrowed hammer, and the lid is shut again.","A crate broke in Jef's hands; he went for nails to mend it.",step:Step(chandler,"the chandlery on the Rijnkaai",0,-cap)));
            options.Add(Option("Hide it among the others","You turn the split side to the wall. Nobody seems to see.","A crate broke in Jef's hands and he hid it among the others.",roll:Roll(.5,-cap,-1,"The broken crate Jef hid was found."),afterBad:"The tally man found the broken crate you hid."));break;
        case"customs":{
            var officers=Residents().Where(r=>S(r,"trade")=="customs").ToArray();var officer=(castAs==null?null:officers.FirstOrDefault(r=>S(r,"id")==S(castAs,"id")))??NearestFor(j,"customs")??(officers.Length==0?null:officers[(int)Math.Floor(rng()*officers.Length)]);Cast(officer==null?null:S(officer,"id"),S(officer,"name","a customs officer"),"customs officer, suspicious of the load");
            options.Add(Option("Wait while he checks the load","He takes his time over every mark. You lose half an hour.","A customs officer stopped Jef's load and checked it slowly.",payChange:-5));
            if(door!=null)options.Add(Option($"Fetch the papers from {who}",$"{who} sends the papers with a curse for the customs. All in order.",$"A customs officer stopped Jef's load; Jef went to {who} for the papers.",trust:1,step:Step(door,$"{who}'s door",0,-cap)));
            if(Money((int)N(j,"taken_by",1))>=10)options.Add(Option("Slip him 10 centimes","The coins vanish into his glove. He waves you on.","Jef paid a customs officer 10 centimes to look away.",moneyOut:10,roll:Roll(.3,0,-1,"Jef offered a customs officer 10 centimes to look away, and the officer reported it.",true),afterBad:"He took the coins, and then he told his sergeant."));break;}
        case"rival":{
            var rivals=Residents().Where(r=>S(r,"trade")is("docker"or"natie")&&N(r,"age")>=18).ToArray();var rival=NearestFor(j,"rival")??(rivals.Length==0?null:rivals[(int)Math.Floor(rng()*rivals.Length)]);Cast(rival==null?null:S(rival,"id"),S(rival,"name","a docker of another natie"),"a rival docker who wants the load and the pay");int oneLoad=Round5(pay/Math.Max(1,count));
            options.Add(Option("Send him off","He spits, looks you over, and goes.","A rival docker wanted Jef's load; Jef sent him off.",roll:Roll(rival==null?.3:Math.Clamp(.1+N(rival["stats"],"temper")/25,.1,.45),-half,0,$"A rival docker complained about Jef to {who}."),afterBad:$"He went straight to {who} with a story about you."));
            options.Add(Option("Let him carry one load for 20 centimes","He counts the coins into your hand and shoulders one load.","Jef let a rival docker carry one load for 20 centimes.",moneyIn:20,payChange:-Math.Min(cap,oneLoad),roll:Roll(.35,-cap+Math.Min(cap,oneLoad),-1,$"{who} found out Jef sold a load of his work to another man."),afterBad:$"{who}'s man saw another man carrying your load."));
            if(door!=null)options.Add(Option($"Call {who}",$"{who} comes out and the rival slinks away. \"Good man.\"", $"A rival docker wanted Jef's load; Jef went for {who}.",step:Step(door,$"{who}'s door",half,0)));break;}
        case"weather":{
            bool wet=weather is"rain"or"storm";Cast(null,$"{who}'s man","an old hand");options.Add(Option("Push on","You bend your head and keep going.",wet?"A squall came over the river; Jef pushed on.":"The fog came down thick; Jef pushed on.",roll:Roll(.4,-half,0,wet?"One of Jef's loads got soaked in the squall.":"In the fog Jef set a load down in the wrong place."),afterBad:wet?"One load got soaked through; it will come off your pay.":"In the murk you set one load down at the wrong door."));
            options.Add(Option("Wait it out under the shed","You wait under the eaves till the worst is over. The foreman grumbles at the time.","Jef waited out the weather under a shed.",payChange:-5));if(chandler!=null)options.Add(Option("Fetch a tarpaulin from the chandler's","A tarred sheet over the goods. The old hand nods: that is how it is done.","Jef fetched a tarpaulin from the chandler's to keep the goods dry.",step:Step(chandler,"the chandlery on the Rijnkaai",half,0)));break;}
        }
        foreach(var option in options){var o=option!.AsObject();foreach(var field in new[]{"pay_c","now_in_c","now_out_c","trust"})if(o[field]!=null&&N(o,field)!=0)o[field]=field=="pay_c"?Math.Clamp(N(o,field),-cap,cap):field=="trust"?Math.Clamp(N(o,field),-1,1):Math.Clamp(N(o,field),0,field=="now_in_c"?30:20);if(o["step"]is JsonObject step){step["done_c"]=Math.Clamp(N(step,"done_c"),-cap,cap);step["missed_c"]=Math.Clamp(N(step,"missed_c"),-cap,cap);}if(o["roll"]is JsonObject roll){roll["p"]=Math.Clamp(N(roll,"p"),0,1);roll["pay_c"]=Math.Clamp(N(roll,"pay_c"),-cap,cap);roll["trust"]=Math.Clamp(N(roll,"trust"),-1,1);}}
        return options.Count<2?null:new JsonObject{["kind"]=kind,["cast"]=cast,["options"]=options,["after_s"]=18+(int)Math.Floor(rng()*20)};
    }
    public JsonObject EngineTrouble(JsonObject plan)
    {
        string kind=S(plan,"kind");var words=O(data["troubleWords"]?[kind]).DeepClone().AsObject();words["options"]=new JsonArray(A(plan["options"]).Select(o=>(JsonNode)new JsonObject{["label"]=S(o,"label"),["after"]=S(o,"after"),["after_bad"]=S(o,"after_bad")}).ToArray());return words;
    }
    public JsonObject CleanTrouble(JsonObject job,JsonObject plan,JsonObject output,JsonObject fallback)
    {
        var names=new[]{S(job,"employer_name")}.Concat(A(plan["cast"]).Select(c=>S(c,"name"))).ToArray();bool Good(string s,IEnumerable<string> nums)=>NumbersOk(s,nums)&&NamesOk(s,names,true)&&!outOfWorld.IsMatch(s)&&!gifts.IsMatch(s)&&!Regex.IsMatch(s,@"\b(knife|pistol|gun|blood|stab|kill|wound)\w*",RegexOptions.IgnoreCase);
        string scene=NativeCoreInteriors.PlainEnglish(S(output,"scene"));var lines=new JsonArray();foreach(var l in A(output["lines"])){int who=(int)N(l,"who");if(who<0||who>=A(plan["cast"]).Count)continue;string text=NativeCoreInteriors.PlainEnglish(S(l,"text"));if(!Good(text,Array.Empty<string>()))continue;lines.Add(new JsonObject{["who"]=who,["text"]=text});if(lines.Count>=3)break;}
        var options=new JsonArray();foreach(var(o,index)in A(plan["options"]).Select((o,i)=>(o,i))){var m=A(output["options"]).FirstOrDefault(n=>N(n,"n")==index+1);var fb=fallback["options"]![index]!;if(m==null){options.Add(fb.DeepClone());continue;}var nums=DigitsOf(S(o,"label"));string label=NativeCoreInteriors.PlainEnglish(S(m,"label")),after=NativeCoreInteriors.PlainEnglish(S(m,"after")),bad=NativeCoreInteriors.PlainEnglish(S(m,"after_bad"));options.Add(new JsonObject{["label"]=Good(label,nums)&&nums.All(label.Contains)?label:S(fb,"label"),["after"]=Good(after,Array.Empty<string>())?after:S(fb,"after"),["after_bad"]=S(o,"after_bad")!=""?(bad!=""&&Good(bad,Array.Empty<string>())?bad:S(fb,"after_bad")):""});}return new(){["scene"]=Good(scene,Array.Empty<string>())?scene:S(fallback,"scene"),["lines"]=lines.Count>0?lines:fallback["lines"]!.DeepClone(),["options"]=options};
    }
}
