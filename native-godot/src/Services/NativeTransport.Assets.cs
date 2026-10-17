using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTransport
{
    public JsonObject? FamilyCart(int player,string id)
    {
        var vehicle=A(Transport["vehicles"]).FirstOrDefault(v=>S(v,"id")==id&&S(v,"kind")=="handcart");if(vehicle==null)return null;
        var result=vehicle.DeepClone().AsObject();foreach(var p in C.Rows("SELECT id FROM player")){int pid=(int)N(p,"id");var cart=A(State(pid,"jef_carts")["list"]).FirstOrDefault(c=>S(c,"id")==id&&S(c,"kind")=="taken");if(cart==null)continue;result["x"]=cart["x"]!.DeepClone();result["z"]=cart["z"]!.DeepClone();result["yaw"]=cart["yaw"]!.DeepClone();result["by"]=pid;result["mine"]=pid==player?cart.DeepClone():null;return result;}
        var clock=host.Clock.View();string key=VehicleAt(result,(int)N(clock,"day"),N(clock,"hour")+N(clock,"minute")/60);var spot=A(result["parks"]?[key]??result["home"]);result["x"]=V(spot[0]);result["z"]=V(spot[1]);result["yaw"]=V(spot[2]);result["mine"]=null;result["where"]=key=="home"?"from outside their house":"from beside their stall";
        if(ParkedCartSnapshot?.Invoke(id) is {} snapshot)foreach(var field in new[]{"x","z","yaw","load","in_use"})result[field]=snapshot[field]?.DeepClone();
        return result;
    }
    public void TakeFamilyCart(int player,string id,int deed,JsonObject at)
    {
        var family=FamilyCart(player,id)??throw new NativeServiceException("no such handcart",404);if(family["by"]!=null&&N(family,"by")!=player)Refuse("someone else has it");if(B(family,"in_use"))Refuse("someone is using that cart");
        if(goods.CarriedBy(player)!=null)Refuse("Your hands are full.");
        var load=new JsonArray();
        foreach(var node in A(family["load"])){
            var item=node!.DeepClone().AsObject();item["owner"]=family["owner"]?.DeepClone();
            if(S(item,"kind")=="chair"){
                C.Execute("INSERT INTO home_item(kind,state,home,rot,day,player_id) VALUES('chair','gone',NULL,0,$p0,$p1)",N(host.Clock.View(),"day"),player);
                item["piece"]=C.Scalar<int>("SELECT last_insert_rowid()");
            }else{
                var made=goods.GiveTo(player,item)??throw new NativeServiceException("you cannot carry that",409);
                item["gid"]=S(made,"id");goods.ToCart(player,S(made,"id"),$"hc:{player}:{id}");
            }
            load.Add(item);
        }
        var state=State(player,"jef_carts");foreach(var c in A(state["list"]))c!["held"]=false;state["list"]=new JsonArray(A(state["list"]).Where(c=>S(c,"id")!=id).Select(c=>c!.DeepClone()).ToArray());state["list"]!.AsArray().Add(new JsonObject{["id"]=id,["kind"]="taken",["since"]=Minute,["paid_c"]=0,["owner"]=family["owner"]?.DeepClone(),["deed"]=deed,["label"]=family["label"]?.DeepClone(),["x"]=at["x"]!.DeepClone(),["z"]=at["z"]!.DeepClone(),["yaw"]=at["yaw"]?.DeepClone()??JsonValue.Create(0),["held"]=true,["load"]=load});Save(player,"jef_carts",state);
    }
    public bool HasFamilyCart(int player,string id,int deed)=>A(State(player,"jef_carts")["list"]).Any(c=>S(c,"id")==id&&S(c,"kind")=="taken"&&N(c,"deed")==deed);
    public void HoldFamilyCart(int player,string id){var state=State(player,"jef_carts");if(A(state["list"]).Any(c=>B(c,"held")&&S(c,"id")!=id))Refuse("you have hold of another cart");var cart=Cart(state,id);cart["held"]=true;Save(player,"jef_carts",state);}
    public void HomeFamilyCart(string id)
    {
        foreach(var p in C.Rows("SELECT id FROM player")){int player=(int)N(p,"id");var state=State(player,"jef_carts");var cart=A(state["list"]).FirstOrDefault(c=>S(c,"id")==id&&S(c,"kind")=="taken")as JsonObject;if(cart==null)continue;DropLoad(player,cart,true);state["list"]!.AsArray().Remove(cart);Save(player,"jef_carts",state);}
    }
    public void HomeBike(string id)=>SetBike(id,null);
}

