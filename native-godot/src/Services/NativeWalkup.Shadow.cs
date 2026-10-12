using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace Scheldemist.Native.Services;
public sealed partial class NativeWalkup
{
    public static JsonObject ShadowStep(JsonObject facts)
    {
        if(!B(facts,"carrying"))return new(){["kind"]="break_off",["why"]="no load"};if(S(facts,"role")=="thief"&&B(facts,"policeNear"))return new(){["kind"]="break_off",["why"]="police"};if(N(facts,"d")>90)return new(){["kind"]="break_off",["why"]="lost him"};double hour=(N(facts,"hour")%24+24)%24;if(hour>=20||hour<6||N(facts,"peopleNear")<=1)return new(){["kind"]="close_in"};if(!B(facts,"jefMoving"))return new(){["kind"]="linger"};return new(){["kind"]="keep",["gap"]=18.5};
    }
    public string? PoliceWithin(JsonObject point,double radius=35)=>actions.PeopleNear(N(point,"x"),N(point,"z"),radius).Select(p=>actions.Resident(S(p,"id"))).FirstOrDefault(p=>S(p,"trade")is "police"or"water_bailiff"or"watchman")?["id"]?.GetValue<string>();
    public JsonObject? MayShadow(int player,string reference,string kind,bool shady,JsonObject at,double see=40,Func<double>? roll=null)
    {
        reference=reference[..Math.Min(50,reference.Length)]+":shadow";var had=Comings().FirstOrDefault(a=>S(Data(a),"ref")==reference&&Holder(a!)==player);if(had!=null)return CallResponder(player,"thief","shadow",reference,at);
        var state=C.World("walkup")as JsonObject??new JsonObject{["rolled"]=new JsonArray()};if(A(state["rolled"]).Any(r=>r?.GetValue<string>()==reference))return null;state["rolled"]??=new JsonArray();state["rolled"]!.AsArray().Add(reference);while(state["rolled"]!.AsArray().Count>40)state["rolled"]!.AsArray().RemoveAt(0);C.SetWorld("walkup",state);
        if(Comings().Any(a=>S(Data(a),"why")=="shadow"&&Holder(a!)==player))return null;bool night=Hour>=20||Hour<6;string role=shady&&night?"customs":"thief";if(!shady&&!new[]{"parcel","chests","tobacco","coffee","hides","barrels"}.Contains(kind))return null;if((roll??C.Roll)()>(night?.6:.35))return null;var person=PickResponder(role,at,see)??(role=="customs"?PickResponder("thief",at,see):null);if(person==null)return null;return CallResponder(player,S(person["r"],"trade")=="customs"?"customs":"thief","shadow",reference,at,see);
    }
    public JsonObject? ShadowFacts(int player,int id,bool moving,bool carrying)
    {
        var row=Comings().FirstOrDefault(a=>N(a,"id")==id);if(row==null||Holder(row)!=player)return null;var jef=actions.PlayerPosition(player);var follower=actions.Position(S(row,"npc_id"));if(jef==null||follower==null)return null;string role=S(Data(row),"role");if(role is not("thief"or"customs"))return null;return new(){["hour"]=Hour,["d"]=NativeGoods.Distance(N(jef,"x"),N(jef,"z"),N(follower,"x"),N(follower,"z")),["jefMoving"]=moving,["peopleNear"]=actions.PeopleNear(N(jef,"x"),N(jef,"z"),15).Count(p=>S(p,"id")!=S(row,"npc_id")),["policeNear"]=PoliceWithin(jef)!=null||PoliceWithin(follower)!=null,["carrying"]=carrying,["role"]=role};
    }
    private bool Shady(JsonObject job)=>S(job,"employer_npc")=="tuur"||S(job,"source")=="night"||C.Rules["nightGivers"]is JsonArray givers&&givers.Any(g=>S(g,"id")==S(job,"employer_npc"));
    private void RegisterShadow(NativeServiceHost service)
    {
        service.Register("POST","/api/walkup/shadow",r=>{var job=host.Jobs.Get(r.Int("job_id"));if(!host.Jobs.InHand(job,r.PlayerId)||job["task"]==null)return new JsonObject{["ok"]=false};return MayShadow(r.PlayerId,"job:"+N(job,"id"),S(job["task"],"goods"),Shady(job),Point(r))??new JsonObject{["ok"]=false};});
        service.Register("POST","/api/dev/walkup/shadow",r=>{var job=host.Jobs.Get(r.Int("job_id"));return MayShadow(r.PlayerId,"job:"+N(job,"id"),"parcel",r.Bool("shady")||Shady(job),Point(r),Math.Min(300,N(r.Body,"see",40)),()=>0)??new JsonObject{["ok"]=false,["why"]="nobody near to follow"};});
        service.Register("POST","/api/walkup/shadow/:id/step",r=>{int id=int.Parse(r.Param("id"));var facts=ShadowFacts(r.PlayerId,id,r.Bool("moving"),r.Bool("carrying"));if(facts==null)return new JsonObject{["move"]=new JsonObject{["kind"]="break_off",["why"]="lost him"}};var move=ShadowStep(facts);int? trouble=null;if(S(move,"kind")=="close_in"&&S(facts,"role")=="customs"){var row=actions.Row(id)!;var match=Regex.Match(S(Data(row),"ref"),@"^job:(\d+):");if(match.Success&&CustomsTrouble!=null)trouble=CustomsTrouble(r.PlayerId,int.Parse(match.Groups[1].Value),actions.Resident(S(row,"npc_id"))!);}return new JsonObject{["move"]=move,["facts"]=facts,["trouble"]=trouble};});
        service.Register("POST","/api/walkup/shadow/:id/snatch",r=>{int id=int.Parse(r.Param("id"));var row=Comings().FirstOrDefault(a=>N(a,"id")==id);if(row==null||Holder(row)!=r.PlayerId)return new JsonObject{["taken"]=false,["why"]="gone"};var point=Point(r);string? police=PoliceWithin(point);bool taken=police==null&&r.Bool("hands")&&!r.Bool("shouted");string npc=S(row,"npc_id");var person=actions.Resident(npc);if(person!=null){C.Log(r.PlayerId,taken?"load_snatched":"load_tried",npc,S(person,"name")+(taken?" followed Jef and snatched the load from his hands in a quiet street.":" followed Jef with an eye on his load, and thought better of it."),npc);if(taken)host.Trade.Remember(r.PlayerId,npc,"I followed the new day labourer and had his load off him in a quiet street.",5);}return new JsonObject{["taken"]=taken,["why"]=police!=null?"police":!r.Bool("hands")?"pocket":r.Bool("shouted")?"shouted":"taken"};});
    }
}
