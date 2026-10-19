using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTransport
{
    private void RegisterBikes()
    {
        foreach(var pair in new[]{("velocipede_new","new"),("velocipede_used","used"),("velocipede_hire","hire")}){
            string item=pair.Item1,kind=pair.Item2;host.Trade.ItemReferences[item]=player=>{RefuseBikeBuy(player,kind);return null;};host.Trade.SpecialBuy[item]=(player,npc)=>GiveBike(player,kind);
        }
        host.Register("GET","/api/transport",r=>FamilyView(r.PlayerId));
        host.Register("POST","/api/transport/seen",r=>{Seen(r.PlayerId,r.Body);return new JsonObject{["ok"]=true};});
        host.Register("POST","/api/transport/missed",r=>{string id=r.Text("velo");if(!id.StartsWith("velo:",StringComparison.Ordinal))Refuse("bad velocipede",400);return new JsonObject{["missed"]=MissedBike(r.PlayerId,id)};});
        host.Register("POST","/api/velo/:id/leave",r=>LeaveBike(r.PlayerId,"velo:"+r.Param("id"),N(r.Body,"x",double.NaN),N(r.Body,"z",double.NaN),N(r.Body,"yaw",double.NaN),r.Bool("down")));
    }
    private void RefuseBikeBuy(int player,string kind)
    {
        if(C.World("veloshop")==null)Refuse("there is no velocipede maker in this town");var list=A(State(player,"jef_velos")["list"]);
        if(kind=="hire"&&list.Any(v=>S(v,"kind")=="hire"))Refuse("you have his hire machine already");if(kind!="hire"&&list.Any(v=>S(v,"kind")!="hire"))Refuse("you have a velocipede of your own already");
    }
    private void GiveBike(int player,string kind)
    {
        var state=State(player,"jef_velos");var show=A(C.World("veloshop")?["show"]);var spot=A(show.ElementAtOrDefault(kind=="hire"?1:0)??show[0]);state["n"]=N(state,"n")+1;string id=player==1?"velo:jef"+N(state,"n"):"velo:jef"+player+"x"+N(state,"n");
        var record=new JsonObject{["id"]=id,["kind"]=kind,["since"]=Minute,["paid_c"]=kind=="new"?1200:kind=="used"?600:30};if(kind=="hire")record["until"]=Minute+14*60;state["list"]!.AsArray().Add(record);Save(player,"jef_velos",state);
        SetBike(id,new(){["x"]=V(spot[0]),["z"]=V(spot[1]),["yaw"]=V(spot[2]),["ridden"]=false,["deed"]=null,["own"]=true,["by"]=player});C.Log(player,kind=="hire"?"hired_velo":"bought_velo",id,kind=="hire"?"Jef hired a velocipede for the day.":"Jef bought a "+kind+" velocipede.");
    }
    public void SetBike(string id,JsonObject? state){var all=C.World("velos")as JsonObject??new();if(state==null)all.Remove(id);else all[id]=state.DeepClone();C.SetWorld("velos",all);}
    private static string PlaceKey(JsonArray seg){string act=seg.Count>=3?seg[2]!.GetValue<string>():"home";if(act=="home")return"home";return act+":"+(seg.Count>=4&&seg[3]!=null?seg[3]!.GetValue<string>():act=="work"?"work":act);}
    private static List<(double from,double to,string key)> DayKeys(JsonNode data,int day)
    {
        var list=A(data["sched"]?[day%7==0?"sunday":"day"]).Select(n=>n!.AsArray()).OrderBy(n=>V(n[0])).ToList();var result=new List<(double,double,string)>();double time=0;
        foreach(var seg in list){double from=V(seg[0]),to=V(seg[1]);if(from>time)result.Add((time,from,"home"));result.Add((from,to,PlaceKey(seg)));time=to;}if(time<24)result.Add((time,24,"home"));return result;
    }
    public string VehicleAt(JsonObject vehicle,int day,double hour)
    {
        if(S(vehicle,"kind")is "dray"or"boat")return"home";var row=C.One("SELECT data_json FROM resident WHERE id=$p0",S(vehicle,"owner"));if(row==null)return"home";var resident=JsonNode.Parse(S(row,"data_json","{}"))!;
        double h=((hour%24)+24)%24;int previousDay=day<=1?7:day-1;bool late=A(resident["sched"]?[previousDay%7==0?"sunday":"day"]).Any(n=>n is JsonArray seg&&V(seg[1])>24&&h+24>=V(seg[0])&&h+24<V(seg[1]));var keys=DayKeys(resident,late?previousDay:day);double now=late?h+24:h;bool cart=S(vehicle,"kind")=="handcart";string at="home",prev="home";
        foreach(var k in keys){if(k.from>now)break;if(k.key==prev)continue;bool outside=at!="home",far=false,load=false;var points=TripPoints?.Invoke(S(vehicle,"id"))??Data["tripPoints"]?[S(vehicle,"id")];var a=A(points?[prev]);var b=A(points?[k.key]);if(!cart&&a.Count>=2&&b.Count>=2)far=D(V(a[0]),V(a[1]),V(b[0]),V(b[1]))>300;
            if(cart&&new[]{"market_woman","fishwife","grocer","dealer"}.Contains(S(resident,"trade")))load=prev=="home"&&k.key.StartsWith("work")||prev.StartsWith("work")&&k.key=="home";
            bool takes=at==prev && vehicle["parks"]?[k.key]!=null && (outside&&(!cart||k.key=="home")||far||load);if(takes)at=k.key;
            // (#198: a handcart left where she was for a stop with no place for it, a tavern after the market, went nowhere again:
            // she takes it home first, as the town's journeys do)
            else if(cart&&at==prev&&at!="home"&&vehicle["parks"]?[k.key]==null)at="home";
            prev=k.key;}
        return at;
    }
    public JsonObject BikeStates()
    {
        var all=C.World("velos")as JsonObject??new();var clock=host.Clock.View();int day=(int)N(clock,"day");double hour=N(clock,"hour")+N(clock,"minute")/60;
        foreach(var node in A(Transport["vehicles"])){var vehicle=node!.AsObject();if(S(vehicle,"kind")!="velocipede")continue;string id=S(vehicle,"id");var state=all[id]as JsonObject;bool fixedState=state!=null&&(state["deed"]!=null||B(state,"ridden")||B(state,"own"));if(fixedState)continue;string at=VehicleAt(vehicle,day,hour);var spot=A(vehicle["parks"]?[at]??vehicle["home"]);all[id]=new JsonObject{["x"]=V(spot[0]),["z"]=V(spot[1]),["yaw"]=V(spot[2]),["ridden"]=false,["deed"]=null};}
        return all;
    }
    public JsonObject JefBikes(int player)
    {
        var state=State(player,"jef_velos");var all=BikeStates();var list=new JsonArray();foreach(var node in A(state["list"])){var bike=node!.DeepClone().AsObject();string id=S(bike,"id");var position=all[id];bike["x"]=position?["x"]?.DeepClone();bike["z"]=position?["z"]?.DeepClone();bike["ridden"]=B(position,"ridden");bike["minutes_left"]=bike["until"]==null?null:JsonValue.Create(Math.Max(0,N(bike,"until")-Minute));list.Add(bike);}return new(){["list"]=list,["notice"]=state["notice"]?.DeepClone(),["shop"]=C.World("veloshop")?.DeepClone(),["prices"]=new JsonObject{["new_c"]=1200,["used_c"]=600,["hire_c"]=30}};
    }
    public JsonObject FamilyView(int player)
    {
        var clock=host.Clock.View();int day=(int)N(clock,"day");double hour=N(clock,"hour")+N(clock,"minute")/60;var bikes=BikeStates();var list=new JsonArray();
        foreach(var node in A(Transport["vehicles"])){var vehicle=node!.DeepClone().AsObject();string id=S(vehicle,"id"),kind=S(vehicle,"kind");var state=kind=="velocipede"?bikes[id]:null;bool cartGone=kind=="handcart"&&C.Rows("SELECT id FROM player").Any(p=>A(State((int)N(p,"id"),"jef_carts")["list"]).Any(c=>S(c,"id")==id&&S(c,"kind")=="taken"));vehicle["gone"]=state!=null&&(state["deed"]!=null||B(state,"ridden"))||cartGone;vehicle["at"]=VehicleAt(vehicle,day,hour);list.Add(vehicle);}
        return new(){["day"]=day,["vehicles"]=list,["errands"]=Errands?.Invoke(day)??Data["errands"]?[(((day-1)%7)+1).ToString()]?.DeepClone()??new JsonArray(),["jef"]=JefBikes(player)};
    }
    public JsonArray BikeWorld(int player)
    {
        var states=BikeStates();var list=new JsonArray();foreach(var node in A(Transport["vehicles"]))if(S(node,"kind")=="velocipede"){string id=S(node,"id"),owner=S(node,"owner");var state=states[id]!.DeepClone().AsObject();state["id"]=id;state["owner"]=owner;state["owner_name"]=C.Scalar<string>("SELECT name FROM npc WHERE id=$p0",owner)??owner;state["mine"]=state["deed"]!=null&&N(state,"by",1)==player;state["by"]=B(state,"ridden")?JsonValue.Create(N(state,"by",1)):null;list.Add(state);}
        foreach(var node in A(State(player,"jef_velos")["list"])){string id=S(node,"id");var state=states[id]?.DeepClone().AsObject();if(state==null)continue;state["id"]=id;state["owner"]=null;state["owner_name"]="";state["mine"]=true;state["by"]=B(state,"ridden")?JsonValue.Create(player):null;list.Add(state);}return list;
    }
    public JsonObject MountBike(int player,string id,int? deed=null)
    {
        var states=BikeStates();var state=states[id]?.AsObject()??throw new NativeServiceException("no such velocipede",404);if(states.Any(p=>B(p.Value,"ridden")&&N(p.Value,"by",1)==player))Refuse("you are already riding one");if(B(state,"ridden")&&N(state,"by",1)!=player)Refuse("someone else rides it");if(!B(state,"own")&&state["deed"]==null&&deed==null)Refuse("that is not your velocipede");if(B(state,"own")&&N(state,"by",1)!=player)Refuse("that is another man's velocipede");if(deed!=null)state["deed"]=deed.Value;state["ridden"]=true;state["by"]=player;state["down"]=false;SetBike(id,state);return state.DeepClone().AsObject();
    }
    public JsonObject LeaveBike(int player,string id,double x,double z,double yaw,bool down=false)
    {
        var state=BikeStates()[id]?.AsObject()??throw new NativeServiceException("no such velocipede",404);if(!B(state,"ridden"))Refuse("you are not on it");if(N(state,"by",1)!=player)Refuse("someone else rides it");if(!Finite(x,z))Refuse("bad place",400);if(GroundOpen?.Invoke(x,z,.25)==false)Refuse("you cannot leave it there");state["x"]=R1(x);state["z"]=R1(z);if(double.IsFinite(yaw))state["yaw"]=R3(yaw);state["ridden"]=false;state["down"]=down;SetBike(id,state);return state.DeepClone().AsObject();
    }
    private bool MissedBike(int player,string id)
    {
        var state=BikeStates()[id];if(state?["deed"]==null)return false;var vehicle=A(Transport["vehicles"]).FirstOrDefault(v=>S(v,"id")==id);if(vehicle==null)return false;string owner=S(vehicle,"owner");double deed=N(state,"deed");if(V(C.World("velo_missed:"+id))==deed)return false;C.SetWorld("velo_missed:"+id,deed);host.Trade.Remember(player,owner,"I went for my velocipede, and Jef had ridden it off. I had to walk.",5);return true;
    }
    private void StopBikes(int player){foreach(var pair in BikeStates())if(B(pair.Value,"ridden")&&N(pair.Value,"by",1)==player){var state=pair.Value!.AsObject();state["ridden"]=false;SetBike(pair.Key,state);}}
    private void BikeTick(int player)
    {
        C.Atomic(()=>{var state=State(player,"jef_velos");int hour=Minute/60;if(N(state,"rolled",-1)==hour)return;state["rolled"]=hour;var all=BikeStates();
            foreach(var node in A(state["list"]).ToArray()){var bike=node!.AsObject();string id=S(bike,"id");var position=all[id];if(position==null||B(position,"ridden"))continue;double x=N(position,"x"),z=N(position,"z");if(S(bike,"kind")=="hire"&&Minute>=N(bike,"until",double.PositiveInfinity)){var step=A(C.World("veloshop")?["step"]);bool back=step.Count>=2&&D(x,z,V(step[0]),V(step[1]))<10;int fee=back?0:Math.Min(Money(player),15);if(fee>0)C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",fee,player);state["list"]!.AsArray().Remove(bike);SetBike(id,null);Notice(state,back?"The day's hire is over; the velocipede is back at the maker's.":"The maker's boy fetched your hire machine; "+fee+" centimes for his trouble.");C.Log(player,"velo_fetched",id,S(state["notice"],"text"));continue;}
                if(Safe(player,x,z,"veloshop")||!Busy(x,z)||Watched(player,x,z,25))continue;int h=(int)N(host.Clock.View(),"hour");if(C.Roll()>=(h>=20||h<6?.08:.04))continue;state["list"]!.AsArray().Remove(bike);SetBike(id,null);Notice(state,"Someone rode off on your velocipede while it stood unwatched.");C.Log(player,"robbed",id,S(state["notice"],"text"));Stolen?.Invoke(player,id,(int)N(bike,"paid_c"));
            }Save(player,"jef_velos",state);
        });
    }
}

