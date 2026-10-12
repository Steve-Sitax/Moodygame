using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
namespace Scheldemist.Native.Services;
public sealed partial class NativeHaggle : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeActions actions;
    private NativeServiceContext C=>host.Context;
    public JsonObject Facts {get;}
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync;
    public Func<string,bool>? CanUseHook;
    public Func<int>? DailyCallLimit;
    public Func<int,string,(bool Allowed,Action? Release)>? BookMeeting;
    public Func<int,string,bool,bool>? OpenMeeting;
    private readonly HashSet<(int Player,string Seller)> pending=new();
    private int generation;
    public NativeHaggle(NativeServiceHost host,NativeActions actions){(this.host,this.actions)=(host,actions);Facts=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-haggle.json")))!.AsObject();}
    private static string S(JsonNode? n,string k,string fallback="")=>NativeGoods.S(n,k,fallback);
    private static double N(JsonNode? n,string k,double fallback=0)=>NativeGoods.N(n,k,fallback);
    private static bool B(JsonNode? n,string k)=>NativeGoods.B(n,k);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static JsonArray Strings(IEnumerable<string> values)=>new(values.Select(s=>(JsonNode)JsonValue.Create(s)!).ToArray());
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    private int Minute=>host.Clock.GameMinute();
    public JsonObject State(int player){var state=(player==1?C.World("haggle")as JsonObject:C.PlayerState(player,"haggle")as JsonObject)??new JsonObject();foreach(string key in new[]{"deals","refused","lies","tries"})state[key]??=new JsonObject();return state;}
    private void Save(int player,JsonObject state){foreach(var pair in state["tries"]!.AsObject().ToArray())if(!pair.Key.StartsWith(Day+":",StringComparison.Ordinal))state["tries"]!.AsObject().Remove(pair.Key);foreach(var pair in state["deals"]!.AsObject().ToArray())if(N(pair.Value,"day")!=Day||N(pair.Value,"left")<=0)state["deals"]!.AsObject().Remove(pair.Key);if(player==1)C.SetWorld("haggle",state);else C.SetPlayerState(player,"haggle",state);}
    public JsonObject? Deal(int player,string seller,string kind){var d=State(player)["deals"]?[seller+":"+kind]as JsonObject;return d!=null&&N(d,"day")==Day&&N(d,"left")>0?d:null;}
    public int RefusedUntil(int player,string seller){int until=(int)N(State(player)["refused"],seller);return until>Minute?until:0;}
    private static int Floor(int price)=>Math.Max(1,(int)Math.Ceiling(price*.6-1e-9));
    public JsonArray WaresFor(int player,string seller,JsonArray? listed=null){var wares=(listed??host.Trade.Wares(seller)).DeepClone().AsArray();foreach(var ware in wares){int list=(int)N(ware,"price_c");if(Deal(player,seller,S(ware,"kind"))is {} d)ware!["price_c"]=Math.Min(list,Math.Max(Floor(list),(int)N(d,"price_c")));}return wares;}
    public JsonObject? Seller(string id)
    {
        var resident=actions.Resident(id);if(resident!=null)return new(){["id"]=id,["name"]=S(resident,"name"),["first"]=S(resident,"first"),["sex"]=S(resident,"sex")=="f"?"f":"m",["label"]=S(resident,"trade").Replace('_',' '),["stats"]=resident["stats"]!.DeepClone(),["resident"]=true};if(Facts["named"]?[id]is not JsonObject definition||host.Trade.BaseWares(id).Count==0)return null;string name=C.Scalar<string>("SELECT name FROM npc WHERE id=$p0",id)??id;var seller=definition.DeepClone().AsObject();seller["id"]=id;seller["name"]=name;seller["first"]=Regex.Replace(name,@"^(Widow|Agent|Pastoor|Meneer) ","").Split(' ')[0];seller["resident"]=false;return seller;
    }
    public JsonObject FactsFor(int player,JsonObject seller,string kind)
    {
        string id=S(seller,"id");var ware=host.Trade.Wares(id).First(w=>S(w,"kind")==kind)!;int list=(int)N(ware,"price_c");var goods=GoodsFact(id,kind,Day,(int)Hour);var bought=C.One("SELECT COUNT(*) AS times,COUNT(DISTINCT day) AS days FROM npc_memory WHERE npc_id=$p0 AND text LIKE 'Jef bought %from me%' AND COALESCE(about_player,1)=$p1",id,player)!;int? cheapest=null;void Consider(string who,int price){if(who!=id&&(cheapest==null||price<cheapest))cheapest=price;}
        var ids=C.Rules["wares"]!.AsObject().Select(p=>p.Key).Concat(C.Rows("SELECT data_json FROM resident").Select(r=>JsonNode.Parse(S(r,"data_json"))!).Where(r=>r["work"]?["stall"]!=null||r["work"]?["shop"]!=null||S(r,"trade")is "publican"or"chandler"or"newsboy"or"dealer"or"fish_merchant"or"baker"or"grocer").Select(r=>S(r,"id"))).Distinct();foreach(string who in ids)foreach(var w in host.Trade.Wares(who))if(S(w,"kind")==kind)Consider(who,(int)N(w,"price_c"));foreach(var deal in State(player)["deals"]!.AsObject()){var key=deal.Key.Split(':');if(key.Length>=2&&key[1]==kind&&N(deal.Value,"day")==Day)Consider(key[0],(int)N(deal.Value,"price_c"));}
        int free=6-C.Scalar<int>("SELECT COUNT(*) FROM item WHERE player_id=$p0",player),money=C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player),food=C.Scalar<int>("SELECT food FROM player WHERE id=$p0",player);var item=host.Trade.Item(kind);bool onSpot=S(item,"use")=="drink"||B(item,"atCounter");var person=actions.Resident(id);double? left=person==null?null:NativeShops.Activity(person,Day,Hour).act=="work"?NativeShops.Activity(person,Day,Hour).left:null;double eventFactor=N(C.World("m4_prices")?[kind],"factor",1);return new(){["list_c"]=list,["floor_c"]=Floor(list),["stale"]=goods["stale"]!.DeepClone(),["staleWords"]=goods["words"]!.DeepClone(),["regular"]=N(bought,"days")>=2||N(bought,"times")>=3,["bought"]=bought,["cheaper"]=cheapest!=null&&cheapest<list,["cheapest"]=cheapest,["several"]=money>=3*list&&(onSpot||free>=3),["hardUp"]=money<3*list||food<=3,["hoursLeft"]=left,["perishable"]=new[]{"herring","eel","bread","apple","newspaper","soup"}.Contains(kind),["market"]=(eventFactor>0?eventFactor:1)*host.Trade.NewsFactor(kind),["trust"]=N(host.Rumours.Relationship(id,player),"trust"),["liesBefore"]=N(State(player)["lies"],id),["triesToday"]=N(State(player)["tries"],Day+":"+id+":"+kind)};
    }
    private bool MayCall(){int limit=DailyCallLimit?.Invoke()??120,total=C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0",Day),mine=C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook LIKE 'resident%'",Day),running=C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook='resident_haggle' AND error='running'",Day),unbooked=Math.Max(0,pending.Count-running);return NarrateAsync!=null&&CanUseHook?.Invoke("resident_haggle")!=false&&mine+unbooked<40&&(limit==0||total+unbooked<limit-15);}
    private string? Apply(int player,JsonObject seller,string kind,string item,JsonObject decision,string manner,JsonObject facts)
    {
        string id=S(seller,"id"),outcome=S(decision,"outcome");if(RefusedUntil(player,id)>0)return "refuse";var state=State(player);string key=Day+":"+id+":"+kind;if(N(state["tries"],key)>=3)return "enough";state["tries"]![key]=N(state["tries"],key)+1;if(outcome=="yield"){state["deals"]![id+":"+kind]=new JsonObject{["price_c"]=decision["price_c"]!.DeepClone(),["day"]=Day,["left"]=A(decision["truths"]).Any(c=>c!.GetValue<string>()=="buy_several")?3:1};host.Trade.Remember(player,id,A(decision["truths"]).Any(c=>c!.GetValue<string>()=="hard_up")&&N(seller["stats"],"warmth")>=6?"Jef is hard up. I let him have "+item+" cheaper.":"Jef talked me down on the price of "+item+".",2);C.Log(player,"haggled",id,"Jef talked "+S(seller,"name")+" down from "+(int)N(facts,"list_c")+" to "+(int)N(decision,"price_c")+" centimes for "+item+".");}
        else if(outcome=="caught"){state["lies"]![id]=N(state["lies"],id)+1;host.Rumours.ApplyTrust(id,player,-1,0);host.Trade.Remember(player,id,"Jef tried to beat my price down with a lie: he "+S(Facts["claimSaid"],A(decision["caught"])[0]!.GetValue<string>(),"told me a story")+".",5,"Jef lied to "+S(seller,"name")+" to get "+item+" cheaper",-1);C.Log(player,"haggle_lie",id,"Jef lied to "+S(seller,"name")+" over the price of "+item+", and was found out.");}else if(outcome=="refuse"){bool threat=manner=="threatening";state["refused"]![id]=Minute+N(decision,"refuseMin");host.Rumours.ApplyTrust(id,player,threat?-2:-1,0);host.Trade.Remember(player,id,threat?"Jef threatened me over the price of "+item+". I'll not sell to him.":"Jef was rude to me over the price of "+item+". I sent him off.",threat?7:6,"Jef "+(threat?"threatened ":"was rude to ")+S(seller,"name")+" over the price of "+item,threat?-2:-1);C.Log(player,"haggle_refused",id,S(seller,"name")+" would not sell to Jef after he was "+(threat?"threatening":"rude")+" about the price.");}else if(manner is "rude"or"threatening"){host.Rumours.ApplyTrust(id,player,manner=="threatening"?-2:-1,0);host.Trade.Remember(player,id,"Jef was "+manner+" about my prices.",4,"Jef was rude to "+S(seller,"name")+" about "+(S(seller,"sex")=="f"?"her":"his")+" prices",-1);}Save(player,state);return null;
    }
    public void Register(NativeServiceHost service)
    {
        service.RegisterAsync("POST","/api/npc/:id/haggle",async request=>{if(request.Body["kind"]is not JsonValue||request.Body["text"]is not JsonValue)throw new NativeServiceException("kind and text wanted");return await Haggle(request.PlayerId,request.Param("id"),request.Text("kind"),request.Text("text"),true).ConfigureAwait(false);});var priorRefuse=host.Trade.RefusePurchase;host.Trade.RefusePurchase=(player,npc)=>priorRefuse?.Invoke(player,npc)??(N(host.Rumours.Relationship(npc,player),"trust")<=-3?S(Seller(npc),"first","The seller")+" will not sell to you":RefusedUntil(player,npc)>0?S(Seller(npc),"first","The seller")+" will not sell to you just now":null);var priorPrice=host.Trade.AgreedPrice;host.Trade.AgreedPrice=(player,npc,kind,list)=>Deal(player,npc,kind)is {} d?(int)N(d,"price_c"):priorPrice?.Invoke(player,npc,kind,list)??list;host.Trade.BoughtHooks.Add((player,npc,kind)=>{var state=State(player);if(state["deals"]?[npc+":"+kind]is JsonObject deal&&N(deal,"price_c")<N(host.Trade.Wares(npc).FirstOrDefault(w=>S(w,"kind")==kind),"price_c")){deal["left"]=N(deal,"left")-1;Save(player,state);}});var previous=host.Trade.WaresForPlayer;host.Trade.WaresForPlayer=(player,npc,wares)=>WaresFor(player,npc,previous?.Invoke(player,npc,wares)??wares);service.NewGame+=()=>{generation++;pending.Clear();};service.Loaded+=()=>{generation++;pending.Clear();};
    }
}



