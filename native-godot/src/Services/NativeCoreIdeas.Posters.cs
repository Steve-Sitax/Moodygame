using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreIdeas
{
    public JsonObject PosterView(int who)
    {
        var spots=PosterSpots().ToDictionary(s=>S(s,"id"),s=>s!);var posters=new JsonArray();foreach(var n in C.Rows("SELECT * FROM poster WHERE status='up' ORDER BY id")){var r=n!.AsObject();if(!spots.TryGetValue(S(r,"spot"),out var spot))continue;var text=Parse(S(r,"text_json","{}"));foreach(string part in new[]{"heading","body","footer"})text[part]=TextFor(who,S(text,part));posters.Add(new JsonObject{["id"]=r["id"]!.DeepClone(),["kind"]=S(r,"kind"),["spot"]=spot.DeepClone(),["day"]=r["day"]!.DeepClone(),["text"]=text,["names_jef"]=N(r,"names_jef")==who,["reward_c"]=r["reward_c"]!.DeepClone(),["source"]=S(r,"source")});}
        var lost=new JsonArray();foreach(var r in C.Rows("SELECT * FROM poster WHERE kind='lost' ORDER BY id")){var t=Parse(S(r,"thing_json","{}"));int holder=(int)N(t,"by",1);if(S(t,"state")!="lying"&&!(S(t,"state")=="held"&&holder==who))continue;var owner=Resident(S(r,"owner"));lost.Add(new JsonObject{["poster"]=r!["id"]!.DeepClone(),["what"]=t["what"]?.DeepClone(),["dog"]=t["dog"]?.DeepClone(),["x"]=t["x"]?.DeepClone(),["z"]=t["z"]?.DeepClone(),["state"]=S(t,"state"),["by"]=holder,["owner"]=r["owner"]?.DeepClone(),["owner_name"]=owner?["name"]?.DeepClone(),["door"]=owner==null?null:new JsonArray(N(owner["home"],"sx"),N(owner["home"],"sz")),["reward_c"]=r["reward_c"]!.DeepClone()});}return new(){["posters"]=posters,["lost"]=lost};
    }
    private (JsonObject Poster,JsonObject Thing) LostRow(int id){var row=C.One("SELECT * FROM poster WHERE id=$p0 AND kind='lost'",id)??throw new NativeServiceException("no such bill",404);return(row,Parse(S(row,"thing_json","{}")));}
    public JsonObject PickLost(int who,int id,JsonObject at)
    {
        var(p,t)=LostRow(id);if(S(t,"state")!="lying")throw new NativeServiceException("it is not there any more",409);if(!Within(at,t,3.5))throw new NativeServiceException("you are not there yet",409);bool dog=t["dog"]!=null;if(!dog&&Pockets(who)>=6)throw new NativeServiceException("your pockets are full",409);
        C.Atomic(()=>{t["state"]="held";t["by"]=who;C.Execute("UPDATE poster SET thing_json=$p0 WHERE id=$p1",t.ToJsonString(),id);if(!dog)C.Execute("INSERT INTO item(kind,job_id,ref,player_id) VALUES('found',NULL,$p0,$p1)",id,who);C.Log(who,"found_lost",S(p,"owner"),dog?$"Jef found {S(t,"what")}, the lost dog on the bill.":$"Jef found {S(t,"what")}, lost by {S(Resident(S(p,"owner")),"name","someone")}.");});return new(){["text"]=dog?$"{S(t["dog"],"name")} sniffs your hand and lets you tie your belt to the collar.":$"You pick up {S(t,"what")}. The bill said: back to the door of its owner."};
    }
    public JsonObject ReturnLost(int who,int id,JsonObject at)
    {
        var(p,t)=LostRow(id);if(S(t,"state")!="held"||N(t,"by",1)!=who)throw new NativeServiceException("you do not have it",409);var o=Resident(S(p,"owner"))??throw new NativeServiceException("nobody to give it to",409);if(!Within(at,Point(N(o["home"],"sx"),N(o["home"],"sz")),3.5))throw new NativeServiceException("this is not their door",409);bool dog=t["dog"]!=null;int reward=(int)N(p,"reward_c");C.Atomic(()=>{t["state"]="returned";C.Execute("UPDATE poster SET thing_json=$p0,status='down',why_down='found' WHERE id=$p1",t.ToJsonString(),id);C.Execute("DELETE FROM item WHERE kind='found' AND ref=$p0 AND player_id=$p1",id,who);C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1",reward,who);C.Log(who,"returned_lost",S(o,"id"),$"Jef brought {S(t,"what")} back to {S(o,"name")} and had the {reward} centimes on the bill.");});host.Rumours.ApplyTrust(S(o,"id"),who,1,0);Remember(who,S(o,"id"),$"Jef, the new day labourer, brought back {(dog?"my dog "+S(t["dog"],"name"):S(t,"what"))} after I put up a bill. I paid him the reward.",6,$"Jef brought {S(o,"first")}'s {(dog?"lost dog":"lost things")} back for the reward",1);return new(){["text"]=$"{S(o,"first")} opens the door{(dog?" and "+S(t["dog"],"name")+" bounds in":"")}. \"Well I never.\" {reward} centimes, as the bill said.",["paid_c"]=reward};
    }
    public JsonArray TakeDown()
    {
        var output=new JsonArray();void Down(JsonNode r,string why){C.Execute("UPDATE poster SET status='down',why_down=$p0 WHERE id=$p1",why,N(r,"id"));output.Add(new JsonObject{["id"]=r["id"]!.DeepClone(),["why"]=why.StartsWith("settled:")?"settled":why});}
        foreach(var p in C.Rows("SELECT * FROM poster WHERE status='up'")){string reference=S(p,"ref");if(reference.StartsWith("deed:")){string? status=C.Scalar<string>("SELECT status FROM deed WHERE id=$p0",int.Parse(reference[5..]));if(status!=null&&status!="open"){Down(p!,"settled: "+status);continue;}}
            if(reference.StartsWith("we:")){var solved=C.One("SELECT id,data_json FROM world_event WHERE verb='robbery_solved' AND ref_id=$p0",int.Parse(reference[3..]));if(solved!=null){int who=(int)N(Parse(S(solved,"data_json","{}")),"player",1);if(who==0)who=1;bool paid=C.Atomic(()=>{if(C.Execute("UPDATE poster SET status='down',why_down='solved' WHERE id=$p0 AND status='up'",N(p,"id"))!=1)return false;C.Execute("UPDATE player SET money_c=money_c+$p0 WHERE id=$p1",N(p,"reward_c"),who);C.Log(who,"reward_paid",N(p,"id").ToString(),$"The police paid Jef the {N(p,"reward_c")} centimes reward on the bill: the pickpocket he named was found.");return true;});if(paid)output.Add(new JsonObject{["id"]=p!["id"]!.DeepClone(),["why"]="solved",["paid_c"]=p["reward_c"]!.DeepClone(),["player"]=who});continue;}}
            var thing=Parse(S(p,"thing_json","{}"));if(S(p,"kind")=="lost"&&S(thing,"state")=="returned"){Down(p!,"found");continue;}if(Day>N(p,"down_day")){Down(p!,"old");if(S(p,"kind")=="lost"&&S(thing,"state")=="lying"){thing["state"]="gone";C.Execute("UPDATE poster SET thing_json=$p0 WHERE id=$p1",thing.ToJsonString(),N(p,"id"));}}}return output;
    }
}
