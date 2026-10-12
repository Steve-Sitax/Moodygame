using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Home leases, billing, furniture ownership and room comfort; all economy writes remain authoritative.</summary>
public sealed class NativeCoreHomes : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C=>host.Context;
    public NativeCoreHomePlan Plan {get;}
    private static readonly Dictionary<string,string> OwnerNoun=new(){{"cellar","cellar room"},{"garret","garret"},{"widow","spare room"},{"alley","house in the alley"},{"merchant","upper floor"}};
    public NativeCoreHomes(NativeServiceHost host){this.host=host;Plan=new NativeCoreHomePlan(host.Context);}
    public JsonObject? Town()=>C.World("homes") as JsonObject;
    public JsonObject? Home(string id)=>Town()?["homes"]?.AsArray().FirstOrDefault(h=>h?["id"]?.GetValue<string>()==id)?.DeepClone().AsObject();
    public JsonObject? Lease(int who=1)=>C.One("SELECT * FROM home_lease WHERE ended IS NULL AND player_id=$p0 ORDER BY id DESC LIMIT 1",who);
    public JsonArray Items(int who)=>C.Rows("SELECT * FROM home_item WHERE state<>'gone' AND player_id=$p0 ORDER BY id",who);
    public JsonArray Placed(int who,string home)=>C.Rows("SELECT id,kind,gx,gz,rot FROM home_item WHERE home=$p0 AND state='placed' AND player_id=$p1",home,who);
    public int DayRate(string cls)=>(int)Math.Ceiling(N(Plan.Class(cls),"week_c")/7.0);
    public int RentFor(string cls,int days)=>days/7*N(Plan.Class(cls),"week_c")+days%7*DayRate(cls);
    private static int WeekEnd(int day)=>(int)Math.Ceiling(day/7.0)*7;
    private int Owed(JsonObject lease)=>Math.Max(0,N(host.Clock.View(),"day")-N(lease,"paid_through"));
    private string Landlord(JsonObject h)=>C.Scalar<string>("SELECT name FROM npc WHERE id=$p0",S(h,"landlord"))??"the landlord";
    private bool Locked(JsonObject lease){int day=N(host.Clock.View(),"day");return day>=WeekEnd(day)&&N(lease,"paid_through")<day&&N(lease,"warned_day")>0&&N(lease,"warned_day")<day;}
    private JsonObject NeedHome(string id)=>Home(id)??throw new NativeServiceException("no such home",404);
    private void Living(int who){if(C.PlayerState(who,"ending")!=null)throw new NativeServiceException("the week is over",409);}
    public JsonObject Take(int who,string id,string payment)
    {
        Living(who);var home=NeedHome(id);var old=Lease(who);int day=N(host.Clock.View(),"day");string cls=S(home,"cls");
        if(old!=null&&S(old,"home")==id)throw new NativeServiceException("you have the key already",409);
        if(C.Scalar<long>("SELECT COUNT(*) FROM home_lease WHERE ended IS NULL AND home=$p0 AND player_id<>$p1",id,who)>0)throw new NativeServiceException($"the room is let: {Landlord(home)} has no other to give",409);
        if(old!=null&&Owed(old)>0)throw new NativeServiceException($"first pay what you owe on {Home(S(old,"home"))?["label"]?.GetValue<string>()??"your room"}",409);
        int days=payment=="day"?1:WeekEnd(day)-day+1,cost=RentFor(cls,days);
        if(N(host.Player(who),"money_c")<cost)throw new NativeServiceException($"not enough money: {cost} c needed",409);
        C.Atomic(()=>{C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",cost,who);if(old!=null){C.Execute("UPDATE home_lease SET ended='moved' WHERE id=$p0",N(old,"id"));MoveThings(who,S(old,"home"),cls);}
            C.Execute("INSERT INTO home_lease(home,since_day,paid_through,warned_day,ended,player_id) VALUES($p0,$p1,$p2,0,NULL,$p3)",id,day,day+days-1,who);
            C.Log(who,"took_home",id,$"Jef took {S(home,"label")} from {Landlord(home)}, {cost} centimes for {(days==1?"one night":days+" days")}.");});
        host.Trade.Remember(who,S(home,"landlord"),$"Jef took my {OwnerNoun[cls]} and paid {cost} centimes rent in advance.",4,$"Jef rents a room from {Landlord(home)}",1);
        return new JsonObject{["paid_c"]=cost,["text"]=$"{Landlord(home)} counts the coins and hands you a key on a string. \"{(days==1?"For tonight.":"Paid to Sunday.")} Keep it clean.\""};
    }
    public JsonObject Pay(int who,string payment)
    {
        Living(who);var lease=Lease(who)??throw new NativeServiceException("you rent no room",409);var home=NeedHome(S(lease,"home"));int day=N(host.Clock.View(),"day"),end=WeekEnd(day),to=payment=="day"?Math.Max(N(lease,"paid_through"),day-1)+1:end,days=to-N(lease,"paid_through");
        if(days<=0||to>end)throw new NativeServiceException("paid to Sunday already",409);int cost=RentFor(S(home,"cls"),days);if(N(host.Player(who),"money_c")<cost)throw new NativeServiceException($"not enough money: {cost} c needed",409);
        C.Atomic(()=>{C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",cost,who);C.Execute("UPDATE home_lease SET paid_through=$p0,warned_day=0 WHERE id=$p1",to,N(lease,"id"));C.Log(who,"paid_home_rent",S(home,"id"),$"Jef paid {Landlord(home)} {cost} centimes rent for {S(home,"label")}.");});
        host.Trade.Remember(who,S(home,"landlord"),$"Jef paid me {cost} centimes rent on the day it was due.",2);
        return new JsonObject{["paid_c"]=cost,["text"]=$"{Landlord(home)} writes it in the rent book. \"{(to>=end?"Paid to Sunday.":"That covers today.")}\""};
    }
    public JsonArray RentNight(int who,int day)
    {
        var result=new JsonArray();var lease=Lease(who);if(lease==null||N(lease,"paid_through")>=day)return result;var home=Home(S(lease,"home"));if(home==null)return result;int owed=RentFor(S(home,"cls"),day-N(lease,"paid_through"));string lord=Landlord(home),id=S(home,"id");
        if(day>=WeekEnd(day)&&N(lease,"warned_day")>0&&N(lease,"warned_day")<day){C.Execute("UPDATE home_lease SET ended='evicted' WHERE id=$p0",N(lease,"id"));int kept=C.Execute("UPDATE home_item SET state='gone' WHERE home=$p0 AND state IN('placed','stored') AND player_id=$p1",id,who);C.Log(who,"lost_home",id,$"{lord} took back the key of {S(home,"label")}: Jef owed {owed} centimes rent.");host.Trade.Remember(who,S(home,"landlord"),$"Jef owed me {owed} centimes rent and never paid. I took my key back{(kept>0?" and kept his things":"")}.",6,$"Jef did not pay his rent to {lord}",-2);result.Add($"{lord} has taken back the key of {S(home,"label")}. You owed {owed} centimes.{(kept>0?" Your things stay with him for the rent.":"")}");}
        else if(N(lease,"warned_day")==0){C.Execute("UPDATE home_lease SET warned_day=$p0 WHERE id=$p1",day,N(lease,"id"));C.Log(who,"rent_warning",id,$"{lord} warned Jef about the rent for {S(home,"label")}.");result.Add($"A note from {lord} under your door: rent owed, {owed} centimes so far. Pay by Sunday, or the key goes back.");}
        return result;
    }
    public JsonObject Bed(int who)
    {
        var lease=Lease(who)??throw new NativeServiceException("you rent no room",409);var home=NeedHome(S(lease,"home"));if(Locked(lease))throw new NativeServiceException($"The key does not turn: {Landlord(home)} has changed the lock. You owe him rent.",409);
        var night=Plan.Night(S(home,"cls"),Placed(who,S(home,"id")));night["id"]=S(home,"id");night["label"]=S(home,"label");night["text"]=S(Plan.Class(S(home,"cls")),"night")+(night["restful"]!.GetValue<bool>()?" You sleep deep and wake rested.":"");night.Remove("restful");return new JsonObject{["home"]=home,["night"]=night};
    }
    public JsonObject Stove(int who)
    {
        var lease=Lease(who)??throw new NativeServiceException("you rent no room",409);var home=NeedHome(S(lease,"home"));bool has=Plan.Class(S(home,"cls"))["fire"]?.GetValue<bool>()==true||Placed(who,S(home,"id")).Any(p=>p?["kind"]?.GetValue<string>()=="stove");if(!has)throw new NativeServiceException("there is no stove here",409);
        int now=host.Clock.MinuteNow();if(now-(C.PlayerState(who,"home:stove")?.GetValue<int>()??-1000000000)<60)return new JsonObject{["text"]="The iron ticks. You are as warm as it will make you for now.",["warmed"]=false};
        C.Atomic(()=>{C.Execute("UPDATE player SET warmth=MIN(10,warmth+1) WHERE id=$p0",who);C.SetPlayerState(who,"home:stove",now);C.Log(who,"warmed",S(home,"id"),$"Jef warmed himself at his own stove in {S(home,"label")}.");});return new JsonObject{["text"]="You feed the fire a little and hold your hands to it. The cold goes out of your fingers.",["warmed"]=true};
    }
    private void MoveThings(int who,string from,string to)
    {
        var placed=Placed(who,to);foreach(var node in C.Rows("SELECT * FROM home_item WHERE home=$p0 AND state IN('placed','stored') AND player_id=$p1 ORDER BY id",from,who)){var item=node!.AsObject();var at=Plan.FirstFit(to,placed,S(item,"kind"));if(at!=null){C.Execute("UPDATE home_item SET home=$p0,state='placed',gx=$p1,gz=$p2,rot=$p3 WHERE id=$p4",to,N(at,"gx"),N(at,"gz"),N(at,"rot"),N(item,"id"));at["id"]=N(item,"id");at["kind"]=S(item,"kind");placed.Add(at);}else C.Execute("UPDATE home_item SET home=$p0,state='stored',gx=NULL,gz=NULL WHERE id=$p1",to,N(item,"id"));}
    }
    private int? BuyPiece(int who,string kind)
    {
        if(Lease(who)==null)throw new NativeServiceException("\"And where would you put it? Rent a room first, then come back.\"",409);var piece=Plan.Furniture(kind)!;string carry=S(piece,"carry");
        if(carry=="arms"&&C.Scalar<long>("SELECT COUNT(*) FROM home_item WHERE state='arms' AND player_id=$p0",who)>0)throw new NativeServiceException("your arms are full: carry the other piece home first",409);
        if(carry=="pocket"&&C.Scalar<long>("SELECT COUNT(*) FROM item WHERE player_id=$p0",who)>=6)throw new NativeServiceException("your pockets are full",409);
        C.Execute("INSERT INTO home_item(kind,state,home,rot,day,player_id) VALUES($p0,$p1,NULL,0,$p2,$p3)",kind,carry,N(host.Clock.View(),"day"),who);return C.Scalar<int>("SELECT last_insert_rowid()");
    }
    public JsonObject Place(int who,int itemId,double gx,double gz,double rot)
    {
        var lease=Lease(who)??throw new NativeServiceException("you rent no room",409);var item=C.One("SELECT * FROM home_item WHERE id=$p0 AND state<>'gone' AND player_id=$p1",itemId,who)??throw new NativeServiceException("you have no such thing",404);string home=S(lease,"home"),kind=S(item,"kind");if(item["home"]!=null&&S(item,"home")!=home)throw new NativeServiceException("that is in another house",409);
        string? why=Plan.CanPlace(home,Placed(who,home),kind,gx,gz,rot,itemId);if(why!=null)throw new NativeServiceException(why,409);
        C.Atomic(()=>{if(S(item,"state")=="pocket")C.Execute("DELETE FROM item WHERE kind=$p0 AND ref=$p1 AND player_id=$p2",kind,itemId,who);C.Execute("UPDATE home_item SET state='placed',home=$p0,gx=$p1,gz=$p2,rot=$p3 WHERE id=$p4",home,(int)gx,(int)gz,(int)rot,itemId);if(S(item,"state")!="placed")C.Log(who,"furnished",kind,$"Jef put {S(Plan.Furniture(kind)!,"name")} in his room.");});
        return new JsonObject{["placed"]=new JsonObject{["id"]=itemId,["kind"]=kind,["gx"]=(int)gx,["gz"]=(int)gz,["rot"]=(int)rot},["why"]=null};
    }
    public JsonObject Lift(int who,int id)
    {
        var lease=Lease(who);var item=C.One("SELECT * FROM home_item WHERE id=$p0 AND state='placed' AND player_id=$p1",id,who);if(lease==null||item==null||S(item,"home")!=S(lease,"home"))throw new NativeServiceException("nothing of yours stands there",404);C.Execute("UPDATE home_item SET state='stored',gx=NULL,gz=NULL WHERE id=$p0",id);item["state"]="stored";item["gx"]=null;item["gz"]=null;return item;
    }
    public JsonObject Abandon(int who)
    {
        var item=C.One("SELECT * FROM home_item WHERE state='arms' AND player_id=$p0",who)??throw new NativeServiceException("your arms are empty",409);string kind=S(item,"kind"),name=S(Plan.Furniture(kind)!,"name");C.Execute("UPDATE home_item SET state='gone' WHERE id=$p0",N(item,"id"));C.Log(who,"left_furniture",kind,$"Jef left {name} in the street.");return new JsonObject{["text"]=$"You set {name} against a wall and walk away. Someone will have it before dark."};
    }
    private JsonObject? Resident(string id){var row=C.One("SELECT data_json FROM resident WHERE id=$p0",id);return row==null?null:JsonNode.Parse(S(row,"data_json"))?.AsObject();}
    private string Activity(JsonObject person)
    {
        var clock=host.Clock.View();double hour=N(clock,"hour")+N(clock,"minute")/60.0;var segments=person["sched"]![N(clock,"day")%7==0?"sunday":"day"]!.AsArray();foreach(var seg in segments){double a=seg![0]!.GetValue<double>(),b=seg[1]!.GetValue<double>();if(hour>=a&&hour<b||hour+24>=a&&hour+24<b)return seg[2]!.GetValue<string>();}return "home";
    }
    public JsonObject Info(int who)
    {
        var town=Town();var lease=Lease(who);int day=N(host.Clock.View(),"day");var homes=new JsonArray();foreach(var node in town?["homes"]?.AsArray()??new JsonArray()){var h=node!.AsObject();string cls=S(h,"cls");var landlord=Resident(S(h,"landlord"));var view=h.DeepClone().AsObject();view.Remove("house");view["week_c"]=N(Plan.Class(cls),"week_c");view["day_c"]=DayRate(cls);view["to_sunday_c"]=RentFor(cls,WeekEnd(day)-day+1);view["notice"]=Plan.Class(cls)["notice"]!.DeepClone();view["let"]=C.Scalar<long>("SELECT COUNT(*) FROM home_lease WHERE ended IS NULL AND home=$p0 AND player_id<>$p1",S(h,"id"),who)>0;view["landlord"]=landlord==null?null:new JsonObject{["id"]=landlord["id"]!.DeepClone(),["name"]=landlord["name"]!.DeepClone(),["first"]=landlord["first"]!.DeepClone()};homes.Add(view);}
        var mine=lease==null?null:Home(S(lease,"home"));var placed=mine==null?new JsonArray():Placed(who,S(mine,"id"));JsonObject? l=null;if(lease!=null&&mine!=null){string cls=S(mine,"cls");var comfort=Plan.Comfort(cls,placed);l=new JsonObject{["home"]=S(lease,"home"),["since_day"]=N(lease,"since_day"),["paid_through"]=N(lease,"paid_through"),["owed_days"]=Owed(lease),["owed_c"]=RentFor(cls,Owed(lease)),["warned"]=N(lease,"warned_day")>0,["to_sunday_c"]=RentFor(cls,Math.Max(0,WeekEnd(day)-N(lease,"paid_through"))),["day_c"]=DayRate(cls),["comfort"]=comfort,["words"]=NativeCoreHomePlan.Words(comfort),["night"]=Plan.Night(cls,placed),["fire"]=Plan.Class(cls)["fire"]?.GetValue<bool>()==true||placed.Any(p=>p?["kind"]?.GetValue<string>()=="stove")};}
        var items=Items(who);foreach(var item in items)item!["name"]=Plan.Furniture(item["kind"]!.GetValue<string>())?["name"]?.DeepClone()??item["kind"]!.DeepClone();string widow=town?["widow"]?.GetValue<string>()??"";var w=widow==""?null:Resident(widow);double hr=N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60.0;return new JsonObject{["homes"]=homes,["dealer"]=town?["dealer"]?.DeepClone(),["lease"]=l,["items"]=items,["widow"]=w==null?null:new JsonObject{["id"]=widow,["home"]=hr>=6.5&&hr<21.5&&Activity(w)=="home"}};
    }
    public JsonObject? Remark(int who)
    {
        var lease=Lease(who);if(lease==null)return null;var home=Home(S(lease,"home"));if(home==null)return null;string key=$"home:remark:{N(host.Clock.View(),"day")}:{S(home,"id")}";if(C.World(key)!=null)return null;double hour=N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60.0;if(hour<7||hour>=21.5)return null;
        JsonObject? visitor=null;if(S(home,"cls")=="widow"){var w=Resident(S(home,"landlord"));if(w!=null&&Activity(w)=="home")visitor=w;}else{double best=30;foreach(var row in C.Rows("SELECT data_json FROM resident ORDER BY id")){var r=JsonNode.Parse(S(row!.AsObject(),"data_json"))!.AsObject();if(N(r,"age")<16||N(r["home"]!.AsObject(),"house")==N(home,"house")||Activity(r)!="home")continue;double dx=r["home"]!["sx"]!.GetValue<double>()-home["step"]![0]!.GetValue<double>(),dz=r["home"]!["sz"]!.GetValue<double>()-home["step"]![1]!.GetValue<double>(),d=Math.Sqrt(dx*dx+dz*dz);if(d<best){best=d;visitor=r;}}}if(visitor==null)return null;
        C.SetWorld(key,new JsonObject{["who"]=S(visitor,"id")});var placed=Placed(who,S(home,"id"));var pieces=placed.Select(p=>S(Plan.Furniture(S(p!.AsObject(),"kind"))!,"name")).Distinct().ToArray();var words=NativeCoreHomePlan.Words(Plan.Comfort(S(home,"cls"),placed));bool warm=N(visitor["stats"]!.AsObject(),"warmth")>=6;string line;
        if(S(home,"cls")=="widow")line=pieces.Length==0?"Keep it tidy, and no visitors after nine. The walls are thin.":(pieces.Length>2?"Well now, you have made it quite homely.":"A few things of your own. Good.")+" Mind my floor.";
        else if(pieces.Length==0)line=warm?"Bare as a church, this. You'll want a stool at least.":"Nothing in it but you. The last one left owing, too.";else if(words[0]!.GetValue<string>()=="warm")line="Warm in here. Warmer than my place, I'll say that.";else line=warm?$"So you've got {pieces[0]}. It suits the place.":$"{char.ToUpperInvariant(pieces[0][0])+pieces[0][1..]}. Where did you find the money for that?";
        host.Trade.Remember(who,S(visitor,"id"),$"I looked in at Jef's room: {(pieces.Length==0?"bare":string.Join(", ",pieces))}, {string.Join(", ",words.Select(n=>n!.GetValue<string>()))}.",2);var shown=new JsonObject();foreach(string f in new[]{"id","name","first","kind","sex","age"})if(visitor[f]!=null)shown[f]=visitor[f]!.DeepClone();return new JsonObject{["who"]=shown,["line"]=line,["source"]="engine"};
    }
    public JsonObject? ResolveRoom(int who,string at)
    {
        var lease=Lease(who);if(lease==null||at!="home:"+S(lease,"home"))return null;var home=Home(S(lease,"home"));if(home==null)return null;bool fire=Plan.Class(S(home,"cls"))["fire"]?.GetValue<bool>()==true||Placed(who,S(home,"id")).Any(p=>p?["kind"]?.GetValue<string>()=="stove");return new JsonObject{["shelter"]=fire?"heated":"sheltered",["place"]=at,["label"]=S(home,"label")};
    }
    public void Register(NativeServiceHost service)
    {
        host.HomeBed=Bed;var previous=host.ResolveRoom;host.ResolveRoom=(who,at)=>ResolveRoom(who,at)??previous?.Invoke(who,at);
        service.PlayerMidnightLines.Add((who,day)=>RentNight(who,day));
        host.Rumours.StillTrueChecks.Add((_,fact)=>{var match=Regex.Match(fact,@"^(\S+) rents a room from (.+?)\.?$");if(!match.Success)return true;int id=match.Groups[1].Value=="Jef"?1:C.Scalar<int>("SELECT id FROM player WHERE name=$p0 AND id<>1",match.Groups[1].Value);if(id==0)return true;var l=Lease(id);var h=l==null?null:Home(S(l,"home"));return h!=null&&Landlord(h)==match.Groups[2].Value;});
        foreach(var pair in C.Rules["furniture"]!.AsObject()){string kind=pair.Key;host.Trade.ItemReferences[kind]=who=>BuyPiece(who,kind);}
        JsonObject Both(int who,JsonObject result){NativeCoreClock.Join(result,host.Payload(who));result["homes"]=Info(who);return result;}
        service.Register("GET","/api/homes",r=>Info(r.PlayerId));
        service.Register("POST","/api/homes/take",r=>{var result=Take(r.PlayerId,r.Text("home"),r.Text("plan"));host.PublishState(r.PlayerId);return Both(r.PlayerId,result);});
        service.Register("POST","/api/homes/rent",r=>{var result=Pay(r.PlayerId,r.Text("plan"));host.PublishState(r.PlayerId);return Both(r.PlayerId,result);});
        service.Register("POST","/api/homes/stove",r=>{var result=Stove(r.PlayerId);if(result["warmed"]!.GetValue<bool>())host.PublishState(r.PlayerId);return Both(r.PlayerId,result);});
        service.Register("POST","/api/homes/place",r=>{double number(string key)=>r.Body[key] is JsonValue v&&v.TryGetValue<double>(out var n)?n:double.NaN;var result=Place(r.PlayerId,r.Int("id"),number("gx"),number("gz"),number("rot"));host.PublishState(r.PlayerId);return Both(r.PlayerId,result);});
        service.Register("POST","/api/homes/lift",r=>Both(r.PlayerId,new JsonObject{["item"]=Lift(r.PlayerId,r.Int("id"))}));
        service.Register("POST","/api/homes/abandon",r=>Both(r.PlayerId,Abandon(r.PlayerId)));
        service.Register("POST","/api/homes/remark",r=>new JsonObject{["remark"]=Remark(r.PlayerId)});
    }
    private static int N(JsonObject obj,string key)=>NativeCoreClock.Number(obj,key);
    private static string S(JsonObject obj,string key)=>obj[key]?.GetValue<string>()??"";
}

