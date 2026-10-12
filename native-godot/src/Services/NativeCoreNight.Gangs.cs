using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreNight
{
    private readonly Dictionary<int,long> lastRoll=new();
    private static readonly HashSet<string> notTaken=new(new[]{"letter","letters","pawn_ticket","medal","newspaper","velocipede_new","velocipede_used","velocipede_hire"});
    private static bool B(JsonNode? n,string key)=>n?[key] is JsonValue v&&v.TryGetValue<bool>(out bool yes)&&yes;
    private static bool Finite(JsonNode? value)=>value is JsonValue v&&v.TryGetValue<double>(out double n)&&double.IsFinite(n);
    private JsonObject State(int who) => (C.PlayerState(who,"gang")??(who==1?C.World("gang"):null))?.DeepClone().AsObject()??new JsonObject{["gang"]=null,["night"]=0,["tries"]=0,["last_min"]=-1e9,["next_id"]=1};
    private JsonObject? Standing(int who,JsonObject? facts=null) => PlayerPosition?.Invoke(who) ?? (facts!=null&&Finite(facts["x"])&&Finite(facts["z"])?new JsonObject{["x"]=N(facts["x"]),["z"]=N(facts["z"])}:null);
    private string Reference(int who,int id)=>who==1?"gang:"+id:"gang:p"+who+"-"+id;
    public (bool Police,int People) Around(int who,JsonObject? at=null)
    {
        at??=Standing(who);if(at==null)return(false,0);bool police=false;int count=0;
        foreach(var p in PeopleNear?.Invoke(N(at["x"]),N(at["z"]),35)??new JsonArray()){string? record=C.Scalar<string>("SELECT data_json FROM resident WHERE id=$p0",S(p,"id"));if(record==null)continue;var r=JsonNode.Parse(record);if(S(r,"trade") is "police" or "water_bailiff"&&N(p?["d"])<=35)police=true;if(N(p?["d"])<=15&&N(r?["age"])>=13)count++;}return(police,count);
    }
    private JsonArray Parcels(int who)=>C.Rows("SELECT id,job_id,kind FROM item WHERE job_id IS NOT NULL AND player_id=$p0",who);
    public double GangChance(int who,JsonObject facts,JsonObject? at=null)
    {
        var near=Around(who,at??Standing(who,facts));double tipsy=host.Interiors.Tipsy(who),chance=.12;if(B(facts,"lit"))chance*=.35;if(B(facts,"quay"))chance*=1.3;if(B(facts,"carrying")||Parcels(who).Count>0)chance*=1.8;if(tipsy>=4)chance*=2;else if(tipsy>=2)chance*=1.5;if(near.Police)chance*=.1;chance*=near.People==0?1.3:near.People<=2?.8:.3;if(N(host.Player(who)["money_c"])>=150)chance*=1.2;return Math.Min(.55,chance);
    }
    public JsonObject? GangNow(int who)
    {
        var state=State(who);var gang=state["gang"] as JsonObject;if(gang==null||S(gang,"status")!="menace")return null;if(Minute-N(gang["at_min"])>20){gang["status"]="over";C.SetPlayerState(who,"gang",state);EndCallsFor?.Invoke(Reference(who,(int)N(gang["id"])));return null;}return gang.DeepClone().AsObject();
    }
    private long Event(string kind,string verb,string text,int weight=2,string? target=null,JsonObject? at=null,string? outcome=null,JsonObject? extra=null)
    {
        long id=host.Interiors.WriteEvent(kind,verb,text,weight,target:target,outcome:outcome,extra:extra);if(at!=null)C.Execute("UPDATE world_event SET x=$p0,z=$p1 WHERE id=$p2",N(at["x"]),N(at["z"]),id);return id;
    }
    public JsonObject? Roll(NativeServiceRequest request,bool force=false)
    {
        int who=request.PlayerId;var facts=request.Body;SyncPerception?.Invoke(request);if(GangNow(who) is {} open)return open;long now=C.Now;if(!force&&now-lastRoll.GetValueOrDefault(who)<9000)return null;lastRoll[who]=now;if(!force&&(!InHours(Hour)||B(facts,"indoors")))return null;
        var state=State(who);int night=NightOf(Day,Hour);if(N(state["night"])!=night){state["night"]=night;state["tries"]=0;}if(!force&&(N(state["tries"])>=2||Minute-N(state["last_min"])<60)){C.SetPlayerState(who,"gang",state);return null;}double perTick=1-Math.Pow(1-GangChance(who,facts),5.0/60);if(!force&&C.Roll()>=perTick)return null;
        int demand=Math.Clamp(R5(N(host.Player(who)["money_c"])*.5),20,200);var at=Standing(who,facts)??new JsonObject{["x"]=N(facts["x"]),["z"]=N(facts["z"])};int id=(int)N(state["next_id"]);var gang=new JsonObject{["id"]=id,["night"]=night,["at_min"]=Minute,["x"]=N(at["x"]),["z"]=N(at["z"]),["demand_c"]=demand,["members"]=3,["status"]="menace",["lit"]=B(facts,"lit"),["carrying"]=B(facts,"carrying"),["lads"]=CallGang?.Invoke(who,Reference(who,id),at,3)??new JsonArray()};state["gang"]=gang;state["next_id"]=id+1;state["tries"]=(int)N(state["tries"])+1;state["last_min"]=Minute;C.SetPlayerState(who,"gang",state);Event("theft","gang_menace","Three men stepped out of the dark and stopped Jef in the street, asking for "+demand+" centimes.",5,"player",at);return gang.DeepClone().AsObject();
    }
    private static JsonObject Result(string outcome,string text,int money=0,int health=0,string hands="keep",JsonArray? things=null,int? failed=null)
    {
        var result=new JsonObject{["outcome"]=outcome,["text"]=text,["money_c"]=money,["health_lost"]=health,["things"]=things??new JsonArray(),["hands"]=hands};if(failed!=null)result["job_failed"]=failed;return result;
    }
    public JsonObject Resolve(NativeServiceRequest request,int id,string how)
    {
        int who=request.PlayerId;var facts=request.Body;if(facts["x"]!=null)SyncPerception?.Invoke(request);var state=State(who);var gang=state["gang"] as JsonObject;if(gang==null||N(gang["id"])!=id||S(gang,"status")!="menace")throw new NativeServiceException("nobody is stopping you now",409);var p=host.Player(who);double tipsy=host.Interiors.Tipsy(who);var near=Around(who,Standing(who,facts)??(who==1?null:new JsonObject{["x"]=N(gang["x"]),["z"]=N(gang["z"])}));bool carrying=facts["carrying"]==null?B(gang,"carrying"):B(facts,"carrying"),lit=facts["lit"]==null?B(gang,"lit"):B(facts,"lit"),tired=N(p["sleep"])<=2;double roll=C.Roll();JsonObject result;
        if(how=="pay"){int demand=(int)N(gang["demand_c"]);if(N(p["money_c"])>=demand){C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",demand,who);C.Log(who,"paid_off",null,"Jef paid a gang "+demand+" centimes in the street at night to leave him be.");string text="You count "+demand+" centimes into a dirty palm. \"Sensible lad.\" They melt back into the dark.";result=Result("paid",Sexed?.Invoke(who,text)??text,demand);}else result=Rob(who,gang,0,"Not enough in your purse. They go through your coat for the rest.");}
        else if(how=="run"){double odds=.6+(carrying?-.25:0)+tipsy*-.07+(tired?-.2:0)+(N(p["health"])<=3?-.15:0);if(roll<odds){C.Log(who,"escaped_gang",null,"Jef ran from a gang in the street at night and got away.");result=Result("escaped",carrying?"You drop what you carry and run. Boots behind you, then only your own breath. You got away.":"You run. Boots behind you, then only your own breath. You got away.",hands:carrying?"drop":"keep");}else result=Rob(who,gang,1,"You run, but not fast enough. A foot hooks yours and you go down on the cobbles.");}
        else if(how=="fight"){double odds=.3+(N(p["health"])>=7?.1:0)+tipsy*-.05+(tired?-.1:0);if(roll<odds){int health=Math.Max(0,Math.Min(1,(int)N(p["health"])-1));C.Execute("UPDATE player SET health=MAX(1,health-$p0) WHERE id=$p1",health,who);C.Log(who,"fought_off_gang",null,"Jef stood his ground against a gang in the street at night; they thought better of it.");result=Result("fought_off","You square up and shove the first one back hard. They did not come for a man who pushes back: a curse, and they are gone. Your knuckles smart.",health:health);}else result=Rob(who,gang,2,"You shove the first one, but there are three. They put you down on the wet stones.");}
        else if(how=="shout"){double odds=near.Police?.85:.2+(lit?.15:0)+(near.People>=1?.3:0);if(roll<odds){C.Log(who,"shouted_off_gang",null,"Jef shouted for the watch and a gang in the street at night scattered.");result=Result("scattered",near.Police?"\"Watch! Watch!\" A whistle answers at once, close by. The three are gone before the agent's lantern comes round the corner.":"\"Watch! Thieves!\" A window goes up, a dog barks, someone shouts back. The three scatter into the alleys.");}else result=Rob(who,gang,1,"\"Watch!\" Nobody comes. A hand over your mouth, and you are down.");}
        else result=Rob(who,gang,1,"You stand there too long. They do not ask twice.");
        gang["status"]="over";gang["outcome"]=result["outcome"]!.DeepClone();gang["text"]=result["text"]!.DeepClone();EndCallsFor?.Invoke(Reference(who,id));C.SetPlayerState(who,"gang",state);string outcome=S(result,"outcome"),textOutcome=outcome=="robbed"?"A gang of three robbed Jef in the street at night"+(N(result["money_c"])>0?" of "+N(result["money_c"])+" centimes":"")+(result["things"]!.AsArray().Count>0?" and "+string.Join(", ",result["things"]!.AsArray().Select(n=>n!.GetValue<string>())):"")+".":outcome=="paid"?"Jef paid a gang "+N(result["money_c"])+" centimes to let him pass in the night.":outcome=="escaped"?"Jef outran a gang in the night streets.":outcome=="fought_off"?"Jef shoved a gang off in the night streets; they went off.":"Jef shouted for the watch and a gang in the night streets scattered.";Event("theft","gang_"+outcome,textOutcome,outcome=="robbed"?7:5,"player",gang,outcome,new JsonObject{["money_c"]=result["money_c"]!.DeepClone(),["health_lost"]=result["health_lost"]!.DeepClone(),["things"]=result["things"]!.DeepClone()});return result;
    }
    private JsonObject? FirstThing(int who)=>C.Rows("SELECT id,kind FROM item WHERE job_id IS NULL AND player_id=$p0 ORDER BY id",who).FirstOrDefault(r=>!notTaken.Contains(S(r,"kind")))?.DeepClone().AsObject();
    private int LoseJob(int who,int jobId,string why)
    {
        var job=C.One("SELECT id,title,employer_npc,status FROM job WHERE id=$p0",jobId);C.Execute("DELETE FROM item WHERE job_id=$p0",jobId);if(job==null||S(job,"status")!="taken")return jobId;C.Execute("UPDATE job SET status='failed' WHERE id=$p0",jobId);C.Log(who,"failed_job",jobId.ToString(),"The job \""+S(job,"title")+"\" was lost: "+why+".");host.Trade.Remember(who,S(job,"employer_npc"),"Jef lost my goods for \""+S(job,"title")+"\" to thieves in the night.",5,"Jef was robbed of goods in his care",-1);return jobId;
    }
    private JsonObject Rob(int who,JsonObject gang,int blow,string lead)
    {
        var p=host.Player(who);int money=(int)N(p["money_c"]),taken=Math.Min(money,Math.Min(500,Math.Max(Math.Min((int)N(gang["demand_c"]),money),R5(money*.7)))),health=Math.Max(0,Math.Min(blow,(int)N(p["health"])-1));var things=new JsonArray();int? failed=null;C.Atomic(()=>{C.Execute("UPDATE player SET money_c=MAX(0,money_c-$p0),health=MAX(1,health-$p1) WHERE id=$p2",taken,health,who);var thing=FirstThing(who);if(thing!=null){C.Execute("DELETE FROM item WHERE id=$p0",(int)N(thing["id"]));things.Add(S(host.Trade.Item(S(thing,"kind")),"name",S(thing,"kind")));}var parcel=Parcels(who).FirstOrDefault();if(parcel!=null)failed=LoseJob(who,(int)N(parcel["job_id"]),"a gang took its goods from Jef in the night");C.Log(who,"robbed",null,"A gang robbed Jef in the street at night"+(taken>0?" of "+taken+" centimes":"")+(things.Count>0?" and "+string.Join(", ",things.Select(n=>n!.GetValue<string>())):"")+".");});var bits=new List<string>{lead,taken>0?"When you get up, your purse is lighter by "+taken+" centimes.":"Your purse was empty; they spit and go."};if(things.Count>0){string name=things[0]!.GetValue<string>();bits.Add(char.ToUpperInvariant(name[0])+name[1..]+" is gone too.");}if(failed!=null)bits.Add("And the job's parcel with it.");return Result("robbed",string.Join(" ",bits),taken,health,"taken",things,failed);
    }
    public JsonObject? RobbedAsleep(int who,string where,bool collapsed,int hour)
    {
        if(where!="rough")return null;double chance=InHours(hour)||hour>=18?.35:.12;if(collapsed)chance+=.1;var near=Around(who);if(near.Police)chance*=.2;else if(near.People>=3)chance*=.5;if(host.Interiors.Tipsy(who)>=2)chance*=1.4;if(C.Roll()>=Math.Min(.7,chance))return null;int taken=Math.Min(500,R5(N(host.Player(who)["money_c"])*.6));var things=new JsonArray();var thing=FirstThing(who);C.Execute("UPDATE player SET money_c=MAX(0,money_c-$p0) WHERE id=$p1",taken,who);if(thing!=null){C.Execute("DELETE FROM item WHERE id=$p0",(int)N(thing["id"]));things.Add(S(host.Trade.Item(S(thing,"kind")),"name",S(thing,"kind")));}var parcel=Parcels(who).FirstOrDefault();if(parcel!=null)LoseJob(who,(int)N(parcel["job_id"]),"it was taken from Jef's coat while he slept in the street");C.Log(who,"robbed",null,"While Jef slept rough, someone went through his coat"+(taken>0?" and took "+taken+" centimes":"")+(things.Count>0?" and "+string.Join(", ",things.Select(n=>n!.GetValue<string>())):"")+".");Event("theft","robbed_asleep","Jef was robbed in his sleep in the street"+(taken>0?" of "+taken+" centimes":"")+".",6,"player");var lines=new JsonArray("In the night hands go through your coat. By the time you are awake enough to shout, they are gone"+(taken>0?", and "+taken+" centimes with them":"")+".");if(things.Count>0){string name=things[0]!.GetValue<string>();lines.Add(char.ToUpperInvariant(name[0])+name[1..]+" is gone too.");}if(parcel!=null)lines.Add("The job's parcel is gone.");return new JsonObject{["lines"]=lines,["robbed"]=new JsonObject{["money_c"]=taken,["things"]=things}};
    }
}
