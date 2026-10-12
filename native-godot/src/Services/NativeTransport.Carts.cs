using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTransport
{
    private void RegisterCarts()
    {
        foreach(var pair in new[]{("handcart_new","new"),("handcart_used","used"),("handcart_hire","hire")}){
            string item=pair.Item1,kind=pair.Item2;
            host.Trade.ItemReferences[item]=player=>{RefuseCartBuy(player,kind);return null;};
            host.Trade.SpecialBuy[item]=(player,npc)=>GiveCart(player,kind);
        }
        host.Register("GET","/api/cart",r=>CartView(r.PlayerId));
        host.Register("POST","/api/cart/seen",r=>{Seen(r.PlayerId,r.Body);return new JsonObject{["ok"]=true};});
        foreach(string action in new[]{"hold","at","place","load","unload"}){string op=action;host.Register("POST","/api/cart/:id/"+action,r=>CartAction(r,op));}
        host.Register("POST","/api/cart/dropped",r=>{var state=State(r.PlayerId,"jef_carts");var ids=A(r.Body["ids"]).Select(V).ToHashSet();state["dropped"]=new JsonArray(A(state["dropped"]).Where(d=>!ids.Contains(N(d,"id"))).Select(d=>d!.DeepClone()).ToArray());Save(r.PlayerId,"jef_carts",state);return new JsonObject{["ok"]=true};});
    }
    private void RefuseCartBuy(int player,string kind)
    {
        if(C.World("cartshop")==null)Refuse("there is no wheelwright in this town");var list=A(State(player,"jef_carts")["list"]);
        if(kind=="hire" && list.Any(c=>S(c,"kind")=="hire"))Refuse("you have his hire cart already");
        if(kind!="hire" && list.Any(c=>S(c,"kind")is "new"or"used"))Refuse("you have a handcart of your own already");
    }
    private void GiveCart(int player,string kind)
    {
        var state=State(player,"jef_carts");var shop=C.World("cartshop")!;var show=A(shop["show"]);var spot=A(show.ElementAtOrDefault(kind=="hire"?1:0)??show[0]);state["n"]=N(state,"n")+1;
        string id=player==1?"cart:jef"+N(state,"n"):"cart:jef"+player+"x"+N(state,"n");
        var cart=new JsonObject{["id"]=id,["kind"]=kind,["since"]=Minute,["paid_c"]=Data["cartPrices"]![kind+"_c"]!.DeepClone(),["label"]=kind=="hire"?"the wheelwright's hire cart":"your handcart",["x"]=V(spot[0]),["z"]=V(spot[1]),["yaw"]=V(spot[2]),["held"]=false,["load"]=new JsonArray()};
        if(kind=="hire")cart["until"]=Minute+14*60;state["list"]!.AsArray().Add(cart);Save(player,"jef_carts",state);C.Log(player,kind=="hire"?"hired_cart":"bought_cart",id,kind=="hire"?"Jef hired a handcart for the day from the wheelwright.":"Jef bought a handcart from the wheelwright.");
    }
    private (double size,double kg) Load(JsonArray load)
    {
        double size=0,kg=0;foreach(var item in load){var def=Data["cartLoad"]?[S(item,"kind")];if(def==null)continue;size+=N(def,"size");kg+=N(def,"kg")*(B(item,"heavy")?2:1);}return(Math.Floor(size*100+.5)/100,Math.Floor(kg+.5));
    }
    private void CanLoad(JsonArray load,JsonObject item)
    {
        var def=Data["cartLoad"]?[S(item,"kind")];if(def==null)Refuse("that does not go on a handcart");var total=Load(load);
        if(total.size+N(def,"size")>N(Data["cartLimit"],"size")+1e-9)Refuse("there is no more room on the cart");
        if(total.kg+N(def,"kg")*(B(item,"heavy")?2:1)>N(Data["cartLimit"],"kg"))Refuse("that would be too heavy for the cart");
    }
    private bool JobOver(JsonNode? cart)=>cart?["job"]==null || C.Scalar<string>("SELECT status FROM job WHERE id=$p0",(int)N(cart,"job"))!="taken";
    public JsonObject CartView(int player)
    {
        var state=State(player,"jef_carts");bool dirty=false;
        foreach(var node in A(state["list"])) {var cart=node!.AsObject();var keep=A(cart["load"]).Where(i=>i?["job"]==null || C.Scalar<string>("SELECT status FROM job WHERE id=$p0",(int)N(i,"job"))=="taken").Select(i=>i!.DeepClone()).ToArray();if(keep.Length!=A(cart["load"]).Count){cart["load"]=new JsonArray(keep);dirty=true;}}
        if(dirty)Save(player,"jef_carts",state);
        var view=new JsonArray();foreach(var node in A(state["list"])){var cart=node!.DeepClone().AsObject();var total=Load(A(cart["load"]));cart["size"]=total.size;cart["kg"]=total.kg;cart["minutes_left"]=cart["until"]==null?null:JsonValue.Create(Math.Max(0,N(cart,"until")-Minute));view.Add(cart);}
        return new(){["list"]=view,["notice"]=state["notice"]?.DeepClone(),["dropped"]=state["dropped"]?.DeepClone()??new JsonArray(),["shop"]=C.World("cartshop")?.DeepClone(),["prices"]=Data["cartPrices"]!.DeepClone(),["limit"]=Data["cartLimit"]!.DeepClone()};
    }
    private JsonObject Cart(JsonObject state,string id)=>A(state["list"]).FirstOrDefault(c=>S(c,"id")==id)?.AsObject()??throw new NativeServiceException("that is not your cart",404);
    private static void Near(JsonObject cart,double x,double z,double reach=4.5){if(!Finite(x,z))Refuse("bad place",400);if(D(N(cart,"x"),N(cart,"z"),x,z)>reach)Refuse("too far from the cart");}
    private JsonObject CartAction(NativeServiceRequest r,string op)=>C.Atomic(()=>CartActionNow(r,op));
    private JsonObject CartActionNow(NativeServiceRequest r,string op)
    {
        string id="cart:"+r.Param("id");if(!Regex.IsMatch(id,"^cart:[a-z0-9]{1,16}$"))Refuse("bad cart",400);var state=State(r.PlayerId,"jef_carts");var cart=Cart(state,id);double x=N(r.Body,"x",double.NaN),z=N(r.Body,"z",double.NaN),yaw=N(r.Body,"yaw",double.NaN);var extra=new JsonObject();
        switch(op){
            case "hold":Near(cart,x,z);if(A(state["list"]).Any(c=>B(c,"held")&&S(c,"id")!=id))Refuse("you have hold of another cart");cart["held"]=true;break;
            case "at":if(!Finite(x,z,yaw))Refuse("bad place",400);if(!B(cart,"held"))Refuse("you have not got hold of it");if(D(N(cart,"x"),N(cart,"z"),x,z)>60)Refuse("the cart is not there");if(!r.Bool("held") && GroundOpen?.Invoke(x,z,.3)==false)Refuse("you cannot leave it there");cart["x"]=R1(x);cart["z"]=R1(z);cart["yaw"]=R3(yaw);cart["held"]=r.Bool("held");if(!r.Bool("held"))LentBack(r.PlayerId,state,cart);break;
            case "place":if(!Finite(x,z,yaw))Refuse("bad place",400);if(S(cart,"kind")!="lent"||B(cart,"placed")||B(cart,"held")||A(cart["load"]).Count>0)Refuse("that cart stays where it is");if(D(N(cart,"x"),N(cart,"z"),x,z)>12)Refuse("too far from where it stood");if(GroundOpen?.Invoke(x,z,.3)==false)Refuse("it cannot stand there");cart["x"]=R1(x);cart["z"]=R1(z);cart["yaw"]=R3(yaw);cart["home"]=new JsonArray(R1(x),R1(z));cart["placed"]=true;break;
            case "load":extra["item"]=LoadCart(r.PlayerId,state,cart,r.Body["item"]as JsonObject??new(),x,z);break;
            case "unload":if(r.Body["job"]!=null){var removed=UnloadJob(r.PlayerId,state,cart,(int)N(r.Body,"job"),x,z);extra["items"]=removed.items;extra["goods"]=removed.goods;}
                else {var result=UnloadOne(r.PlayerId,cart,x,z,r.Body["index"]==null?null:(int)N(r.Body,"index"));extra["item"]=result.item;extra["goods"]=result.goods;}break;
        }
        Save(r.PlayerId,"jef_carts",state);if(op=="at"&&r.Bool("held"))return new(){["ok"]=true};extra["carts"]=CartView(r.PlayerId);return Response(r.PlayerId,extra);
    }
    private JsonObject LoadCart(int player,JsonObject state,JsonObject cart,JsonObject raw,double x,double z)
    {
        Near(cart,x,z);if(B(cart,"held"))Refuse("let go of the shafts first");string gid=S(raw,"gid");JsonObject? held=gid==""?null:goods.Get(gid);
        if(gid!="" && (held==null || held["by"]?["p"]==null || N(held["by"],"p")!=player))Refuse("you are not carrying that");
        var authoritative=held??raw;string kind=S(authoritative,"kind");var item=new JsonObject{["kind"]=kind,["job"]=null,["owner"]=authoritative["owner"]?.DeepClone()};
        if(B(authoritative,"broken"))item["broken"]=true;if(B(authoritative,"heavy"))item["heavy"]=true;if(held!=null)item["gid"]=gid;
        if(raw["piece"]!=null){int piece=(int)N(raw,"piece");var row=C.One("SELECT id,kind FROM home_item WHERE id=$p0 AND player_id=$p1 AND state='arms'",piece,player);if(row==null)Refuse("you are not carrying that");item["kind"]=row!["kind"]!.DeepClone();item["piece"]=piece;item["owner"]=null;}
        else {if(Data["cartLoad"]?[kind]==null || new[]{"chair","table","stove","rug","plant","birdcage"}.Contains(kind))Refuse("that does not go on a handcart",400);
            if(authoritative["job"]!=null){int jid=(int)N(authoritative,"job");var job=host.Jobs.Get(jid);var task=job["task"]!;if(!host.Jobs.InHand(job,player)||S(task,"kind")is not("carry"or"deliver"))Refuse("that job is not in hand");if(S(task,"goods")!=kind)Refuse("those are not the job's goods");int count=S(task,"kind")=="carry"?(int)N(task,"count"):1;var p=task["progress"];int aboard=A(state["list"]).Sum(c=>A(c?["load"]).Count(i=>i?["job"]!=null&&N(i,"job")==jid));if(aboard+N(p,"delivered")+N(p,"lost")+N(p,"sold")+1>count)Refuse("more goods than the job has");item["job"]=jid;}}
        CanLoad(A(cart["load"]),item);if(item["piece"]!=null)C.Execute("UPDATE home_item SET state='gone' WHERE id=$p0 AND player_id=$p1",(int)N(item,"piece"),player);
        if(gid!="" && goods.ToCart(player,gid,$"hc:{player}:{S(cart,"id")}")==null)Refuse("you are not carrying that");cart["load"]!.AsArray().Add(item);return item.DeepClone().AsObject();
    }
    private (JsonObject item,JsonObject? goods) UnloadOne(int player,JsonObject cart,double x,double z,int? index)
    {
        Near(cart,x,z);if(B(cart,"held"))Refuse("let go of the shafts first");var load=A(cart["load"]);if(load.Count==0)Refuse("the cart is empty");int i=index??load.Count-1;if(i<0||i>=load.Count)Refuse("nothing like that on the cart",404);var item=load[i]!.DeepClone().AsObject();JsonObject? returned=null;
        if(item["piece"]!=null){if(C.Scalar<long>("SELECT COUNT(*) FROM home_item WHERE player_id=$p0 AND state='arms'",player)>0)Refuse("your arms are full");C.Execute("UPDATE home_item SET state='arms' WHERE id=$p0 AND player_id=$p1",(int)N(item,"piece"),player);}
        else {if(goods.CarriedBy(player)!=null)Refuse("Your hands are full.");string gid=S(item,"gid");returned=gid==""?null:goods.FromCart(player,gid,$"hc:{player}:{S(cart,"id")}");returned??=goods.GiveTo(player,item);if(returned==null)Refuse("you cannot carry that");}
        load.RemoveAt(i);return(item,returned);
    }
    private (JsonArray items,JsonArray goods) UnloadJob(int player,JsonObject state,JsonObject cart,int jid,double x,double z)
    {
        var job=host.Jobs.Get(jid);var task=job["task"]!;if(!host.Jobs.InHand(job,player))Refuse("that job is not in hand");if(S(task,"kind")!="carry"||S(task,"twist")=="foreman_watches")Refuse("this job wants them one by one");var target=Data["spots"]?[S(task,"to")];if(target==null || !Finite(x,z))Refuse("bad place",400);if(D(x,z,N(target,"x"),N(target,"z"))>4.5)Refuse("this is not where the goods go");if(D(N(cart,"x"),N(cart,"z"),N(target,"x"),N(target,"z"))>7.5)Refuse("bring the cart to the place first");
        var items=A(cart["load"]).Where(i=>i?["job"]!=null&&N(i,"job")==jid).Select(i=>i!.DeepClone().AsObject()).ToList();if(items.Count==0)Refuse("none of the job's goods are on the cart");cart["load"]=new JsonArray(A(cart["load"]).Where(i=>i?["job"]==null||N(i,"job")!=jid).Select(i=>i!.DeepClone()).ToArray());
        var positions=items.Select((item,i)=>{var p=goods.Slot(S(task,"to"),((int)N(task["progress"],"delivered")+i)%6,.8);return new JsonObject{["id"]=S(item,"gid"),["x"]=p.x,["z"]=p.z};}).ToList();var placed=goods.CartUnload($"hc:{player}:{S(cart,"id")}",positions);
        for(int i=0;i<items.Count;i++)if(S(items[i],"gid")=="" || !placed.Any(g=>S(g,"id")==S(items[i],"gid"))){var spec=items[i].DeepClone().AsObject();spec["x"]=positions[i]["x"]!.DeepClone();spec["z"]=positions[i]["z"]!.DeepClone();foreach(var made in goods.Spawn(new[]{spec}))placed.Add(made!.DeepClone());}
        C.Log(player,"unloaded_cart",jid.ToString(),$"Jef tipped {items.Count} {S(task,"goods")} off his handcart at {S(target,"label","the place")}.");return(new JsonArray(items.Select(i=>(JsonNode)i).ToArray()),placed);
    }
    public void LendForJob(JsonObject job,int player)
    {
        var task=job["task"];if(S(task,"kind")!="carry" || !B(task,"cart"))return;int jid=(int)N(job,"id");var state=State(player,"jef_carts");if(A(state["list"]).Any(c=>S(c,"kind")=="lent"&&N(c,"job")==jid))return;var from=Data["spots"]?[S(task,"from")];if(from==null)return;
        if(A(state["list"]).Any(c=>S(c,"kind")is "new"or"used"or"hire" && D(N(c,"x"),N(c,"z"),N(from,"x"),N(from,"z"))<=35))return;var at=A(Data["lentSpots"]?[S(task,"from")]);if(at.Count<3)return;
        state["n"]=N(state,"n")+1;string id=player==1?"cart:lent"+N(state,"n"):"cart:lent"+player+"x"+N(state,"n");string owner=S(job,"employer_npc"),name=S(job,"employer_name");
        var cart=new JsonObject{["id"]=id,["kind"]="lent",["since"]=Minute,["paid_c"]=0,["label"]=name+"'s handcart",["job"]=jid,["lender"]=owner,["home"]=new JsonArray(V(at[0]),V(at[1])),["x"]=V(at[0]),["z"]=V(at[1]),["yaw"]=V(at[2]),["held"]=false,["load"]=new JsonArray()};state["list"]!.AsArray().Add(cart);Notice(state,name+"'s handcart stands by the goods. Load it, push it, and bring it back there when the work is done.");Save(player,"jef_carts",state);C.Log(player,"lent_cart",jid.ToString(),name+" lent Jef a handcart.");
    }
    private void DropLoad(int player,JsonObject cart,bool piecesHome)
    {
        string reference=$"hc:{player}:{S(cart,"id")}";var load=A(cart["load"]);int count=load.Count;
        for(int i=0;i<count;i++){var item=load[i]!.AsObject();if(item["piece"]!=null){string home=piecesHome?C.Scalar<string>("SELECT home FROM home_lease WHERE player_id=$p0 AND ended IS NULL ORDER BY id DESC LIMIT 1",player):"";if(!string.IsNullOrEmpty(home))C.Execute("UPDATE home_item SET state='stored',home=$p0,gx=NULL,gz=NULL WHERE id=$p1 AND player_id=$p2",home,(int)N(item,"piece"),player);continue;}
            double angle=i/(double)Math.Max(1,count)*Math.PI*2,x=N(cart,"x")+Math.Cos(angle)*1.2,z=N(cart,"z")+Math.Sin(angle)*1.2;var placed=goods.CartUnload(reference,new[]{new JsonObject{["id"]=S(item,"gid"),["x"]=x,["z"]=z}});if(placed.Count==0){var spec=item.DeepClone().AsObject();spec["x"]=x;spec["z"]=z;goods.Spawn(new[]{spec});}}
        cart["load"]=new JsonArray();
    }
    private bool LentBack(int player,JsonObject state,JsonObject cart)
    {
        var home=A(cart["home"]);if(S(cart,"kind")!="lent"||B(cart,"held")||home.Count<2||D(V(home[0]),V(home[1]),N(cart,"x"),N(cart,"z"))>8||!JobOver(cart))return false;DropLoad(player,cart,true);state["list"]!.AsArray().Remove(cart);Notice(state,"You leave "+S(cart,"label")+" where it stood. The employer's man wheels it in.");C.Log(player,"returned_cart",S(cart,"id"),"Jef brought the lent handcart back where it stood.");return true;
    }
    private void CartTick(int player)
    {
        C.Atomic(()=>{var state=State(player,"jef_carts");int minute=Minute,hour=minute/60;bool rolled=N(state,"rolled",-1)!=hour;state["rolled"]=hour;
            foreach(var node in A(state["list"]).ToArray()){var cart=node!.AsObject();string kind=S(cart,"kind");if(kind=="lent"&&JobOver(cart)){if(LentBack(player,state,cart))continue;if(cart["until"]==null){cart["until"]=minute+60;Notice(state,"The work is done. Bring the employer's handcart back within the hour.");}else if(minute>=N(cart,"until")&&!B(cart,"held")){int fee=Math.Min(Money(player),20);C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",fee,player);string lender=S(cart,"lender"),faction=C.Rules["employers"]?[lender]?["faction"]?.GetValue<string>()??"";if(faction!="")C.Execute("UPDATE faction_trust SET trust=MAX(-5,trust-1) WHERE faction=$p0 AND player_id=$p1",faction,player);DropLoad(player,cart,true);state["list"]!.AsArray().Remove(cart);Notice(state,"The employer's man fetched the handcart; "+fee+" centimes come off your purse.");C.Log(player,"cart_left",S(cart,"id"),"Jef left a lent handcart behind after the work.");}continue;}
                if(!rolled||B(cart,"held"))continue;if(kind=="hire"&&minute>=N(cart,"until",double.PositiveInfinity)){var step=A(C.World("cartshop")?["step"]);bool back=step.Count>=2&&D(N(cart,"x"),N(cart,"z"),V(step[0]),V(step[1]))<10;int fee=back?0:Math.Min(Money(player),10);if(fee>0)C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",fee,player);DropLoad(player,cart,true);state["list"]!.AsArray().Remove(cart);Notice(state,back?"The day's hire is over; the handcart is back at the wheelwright's.":"The wheelwright's boy fetched your hire cart and left the load on the stones; "+fee+" centimes for his trouble.");C.Log(player,"cart_fetched",S(cart,"id"),S(state["notice"],"text"));continue;}
                if(kind=="taken"||Safe(player,N(cart,"x"),N(cart,"z"),"cartshop")||!Busy(N(cart,"x"),N(cart,"z"))||Watched(player,N(cart,"x"),N(cart,"z"),20))continue;int h=(int)N(host.Clock.View(),"hour");if(C.Roll()>=(h>=20||h<6?.1:.05))continue;int worth=(int)N(cart,"paid_c");state["list"]!.AsArray().Remove(cart);Notice(state,"Someone wheeled your handcart off while it stood unwatched, load and all.");C.Log(player,"robbed",S(cart,"id"),S(state["notice"],"text"));Stolen?.Invoke(player,S(cart,"id"),worth);
            }Save(player,"jef_carts",state);
        });
    }
    public JsonObject? LendCart(int player,string id){var state=State(player,"jef_carts");var cart=A(state["list"]).FirstOrDefault(c=>S(c,"id")==id)?.AsObject();if(cart==null||B(cart,"held")||A(cart["load"]).Count>0)return null;var result=cart.DeepClone().AsObject();state["list"]!.AsArray().Remove(cart);Save(player,"jef_carts",state);return result;}
    public void ReturnCart(int player,JsonObject cart,double x,double z,double yaw){var state=State(player,"jef_carts");if(A(state["list"]).Any(c=>S(c,"id")==S(cart,"id")))return;if(!Finite(x,z,yaw)||GroundOpen?.Invoke(x,z,.3)==false){x=N(cart,"x");z=N(cart,"z");yaw=N(cart,"yaw");}var next=cart.DeepClone().AsObject();next["x"]=R1(x);next["z"]=R1(z);next["yaw"]=R3(yaw);next["held"]=false;next["load"]=new JsonArray();state["list"]!.AsArray().Add(next);Save(player,"jef_carts",state);}
}
