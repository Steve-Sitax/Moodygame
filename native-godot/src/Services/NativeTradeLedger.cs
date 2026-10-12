using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
namespace Scheldemist.Native.Services;

/// <summary>Native shop shelves, town consumption, bakery fuel, delivery runs and player rush jobs.</summary>
public sealed partial class NativeTradeLedger : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeGoods goods;
    private readonly NativeActions actions;
    private NativeServiceContext C=>host.Context;
    public JsonObject Facts {get;}
    public Func<double,double,double,double,JsonArray?>? WayBetween;
    private JsonObject? cached;
    private int cachedMinute=int.MinValue;
    private int lastRushHour=-1;
    public NativeTradeLedger(NativeServiceHost host,NativeGoods goods,NativeActions actions){(this.host,this.goods,this.actions)=(host,goods,actions);Facts=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-trade-ledger.json")))!.AsObject();}
    private static string S(JsonNode? n,string k,string f="")=>NativeGoods.S(n,k,f);
    private static double N(JsonNode? n,string k,double f=0)=>NativeGoods.N(n,k,f);
    private static double V(JsonNode? n)=>NativeGoods.Number(n);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static bool B(JsonNode? n,string k)=>NativeGoods.B(n,k);
    private static double Round(double n)=>Math.Floor(n+.5);
    private JsonArray Posts=>A(Facts["posts"]);
    private JsonObject? Post(string id)=>Posts.OfType<JsonObject>().FirstOrDefault(p=>S(p,"id")==id);
    private int Minute=>host.Clock.GameMinute();
    private int Day=>(int)N(host.Clock.View(),"day");
    private double Hour=>N(host.Clock.View(),"hour")+N(host.Clock.View(),"minute")/60;
    public static double Demand(string good,double hour)=>good=="beer"?hour>=18||hour<2?2:hour>=12&&hour<14?1.2:.6:good=="bread"?hour<9?2:hour<12?1:.6:good=="fish"?hour<10?1.8:hour<13?1:.5:hour>=10&&hour<13?1.6:.8;
    public static bool PostOpen(JsonObject post,int day,double hour){if(day%7==0&&!B(post,"sunday"))return false;var open=A(post["open"]);return V(open[1])>24?hour>=V(open[0])||hour<V(open[1])-24:hour>=V(open[0])&&hour<V(open[1]);}
    public static int StockPrice(int list,JsonObject post,double stock,double hour)
    {
        bool cheap=list<10;double Up(double k)=>cheap?list+Round(2*k):Round(list*(1+.2*k));double Down(double k)=>cheap?Math.Max(1,list-Round(k)):Math.Max(1,Round(list*(1-.2*k)));double price=list;if(stock<=N(post,"floor"))price=Up(1);else if(stock<N(post,"order"))price=Up(.5);else if(stock>=N(post,"room")*.85)price=Down(1);if(S(post,"good")=="fish"&&stock>N(post,"floor")){if(hour>=15)price=Math.Min(price,Down(1));else if(hour>=13)price=Math.Min(price,Down(.5));}return(int)Math.Max(1,price);
    }
    private static JsonObject Sold(JsonObject ledger,string post,int day){var sold=ledger["sold"]![post]as JsonObject;if(sold==null||N(sold,"day")!=day){sold=new(){["town"]=0,["players"]=0,["day"]=day};ledger["sold"]![post]=sold;}return sold;}
    public void Step(JsonObject ledger,int to)
    {
        if(to<=N(ledger,"at"))return;int t=(int)Math.Floor(Math.Max(N(ledger,"at"),to-4320)/5)*5;while(t+5<=to){int day=t/1440+1;double ha=t%1440/60.0,hb=ha+5/60.0;foreach(var p in Posts){string id=S(p,"id"),good=S(p,"good");double stock=N(ledger["stock"],id,N(p,"start"));if(good=="meat"&&ha<7&&hb>=7&&day%7!=0)stock=Math.Min(N(p,"room"),stock+(day%7 is 5 or 6?30:22));if(p?["makes"]!=null&&ha<N(p["makes"],"at")&&hb>=N(p["makes"],"at")&&day%7!=0)stock=Math.Min(N(p,"room"),stock+N(p["makes"],"n"));if(N(p,"perHour")>0&&PostOpen(p!.AsObject(),day,ha)&&stock>N(p,"floor")){double took=Math.Min(N(p,"perHour")*Demand(good,ha)*5/60,stock-N(p,"floor"));stock-=took;var sold=Sold(ledger,id,day);sold["town"]=N(sold,"town")+took;}ledger["stock"]![id]=stock;}t+=5;}ledger["at"]=Math.Max(N(ledger,"at"),t);
    }
    public void Write(JsonObject ledger){C.SetWorld("trade",ledger);cached=ledger.DeepClone().AsObject();cachedMinute=Minute;}
    public JsonObject Ledger()
    {
        int now=Minute;if(cached!=null&&cachedMinute==now)return cached.DeepClone().AsObject();var ledger=C.World("trade")as JsonObject;if(ledger==null||now<N(ledger,"at")-5||!Posts.All(p=>ledger["stock"]?[S(p,"id")]!=null))ledger=new(){["at"]=now,["stock"]=new JsonObject(Posts.Select(p=>new KeyValuePair<string,JsonNode?>(S(p,"id"),JsonValue.Create(N(p,"start"))))),["sold"]=new JsonObject()};Step(ledger,now);SettleRuns(ledger,now);if(ledger["looked"]==null||Math.Floor(now/15.0)!=Math.Floor(N(ledger,"looked")/15)){ledger["looked"]=now;Dispatch(ledger,now);}Write(ledger);return ledger;
    }
    public JsonArray View()
    {
        var ledger=Ledger();int day=(int)N(ledger,"at")/1440+1;return new JsonArray(Posts.Select(p=>{string id=S(p,"id");double stock=N(ledger["stock"],id,N(p,"start"));var sold=ledger["sold"]?[id];if(N(sold,"day")!=day)sold=null;return(JsonNode)new JsonObject{["id"]=id,["label"]=S(p,"label"),["good"]=S(p,"good"),["stock"]=Math.Floor(stock),["room"]=p!["room"]!.DeepClone(),["order"]=p["order"]!.DeepClone(),["floor"]=p["floor"]!.DeepClone(),["short"]=stock<N(p,"order"),["soldTown"]=Round(N(sold,"town")),["soldPlayers"]=N(sold,"players")};}).ToArray());
    }
    public double Supply(string id,double count){var p=Post(id);if(p==null||count<=0)return 0;var l=Ledger();double before=N(l["stock"],id);l["stock"]![id]=Math.Min(N(p,"room"),before+count);Write(l);return N(l["stock"],id)-before;}
    public void OnMillEvents(JsonArray events)
    {
        foreach(var e in events){if(S(e,"what")is not("bake"or"short")||N(e,"n")<=0)continue;var mill=A(Facts["mills"]).FirstOrDefault(m=>S(m,"id")==S(e,"mill"));string bakery=S(mill,"bakery");if(mill==null||Post(bakery)==null)continue;var coal=Post(bakery+":coal");double share=1;if(coal!=null){int day=(int)N(e,"at")/1440+1,need=day%7==0?1:2;var ledger=Ledger();double have=N(ledger["stock"],S(coal,"id"),N(coal,"start")),used=Math.Min(need,have);ledger["stock"]![S(coal,"id")]=have-used;Write(ledger);share=(double)used/need;}Supply(bakery,Round(N(e,"n")*24*share));}
    }
    public JsonObject? SellerPost(string npc)
    {
        if(npc=="fientje")return Post("vismarkt");var r=actions.Resident(npc);if(r==null)return null;string shop=S(r["work"],"shop");if(shop!=""&&Post(shop)is {} post)return post;if(r["work"]?["stall"]!=null){int slot=(int)N(r["work"],"stall");var stalls=A(C.World("town")?["stalls"]);string goods=slot>=0&&slot<stalls.Count?S(stalls[slot],"goods"):"";if(goods=="fish")return Post("vismarkt");if(goods=="bread")return Post("bakery_steen");}return S(r,"trade")=="fish_merchant"?Post("vismarkt"):S(r,"trade")=="baker_boy"?Post("bakery_steen"):null;
    }
    public int Price(string seller,string kind,int price){string good=S(Facts["wareGood"],kind);var post=good==""?null:SellerPost(seller);if(post==null||S(post,"good")!=good)return price;return StockPrice(price,post,N(Ledger()["stock"],S(post,"id"),N(post,"start")),Hour);}
    public string? Bought(int player,string seller,string kind){string good=S(Facts["wareGood"],kind);var post=good==""?null:SellerPost(seller);if(post==null||S(post,"good")!=good)return null;var ledger=Ledger();double before=N(ledger["stock"],S(post,"id"),N(post,"start"));ledger["stock"]![S(post,"id")]=Math.Max(0,before-1);var sold=Sold(ledger,S(post,"id"),(int)N(ledger,"at")/1440+1);sold["players"]=N(sold,"players")+1;Write(ledger);return before<=N(post,"floor")?S(Facts["lastLine"],good):null;}
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/trade",r=>new JsonObject{["posts"]=View(),["runs"]=Ledger()["runs"]?.DeepClone()??new JsonArray(),["drove"]=Drove()});service.Register("POST","/api/dev/trade",r=>{var post=Post(r.Text("post"));if(post==null||r.Body["stock"]is not JsonValue value||!value.TryGetValue<double>(out var stock)||!double.IsFinite(stock))throw new NativeServiceException("post and stock");var ledger=Ledger();ledger["stock"]![S(post,"id")]=Math.Clamp(stock,0,N(post,"room"));ledger.Remove("looked");Write(ledger);cached=null;return new JsonObject{["posts"]=View(),["runs"]=Ledger()["runs"]?.DeepClone()??new JsonArray()};});host.Trade.SellerPrices.Add(Price);host.Trade.BoughtLineHooks.Add(Bought);var prior=goods.HauledIn;goods.HauledIn=route=>{prior?.Invoke(route);if(A(Facts["hauls"]).FirstOrDefault(h=>S(h,"id")==route)is {} haul&&S(haul,"place")=="vismarkt")Supply("vismarkt",6);};service.Jobs.BoardExtras.Add(()=>OfferRush());service.TakeJobHooks.Add(RushTaken);service.Jobs.SettlementExtras.Add(RushSettled);service.TickAfterHooks.Add(_=>{Ledger();if(lastRushHour!=(int)Hour){lastRushHour=(int)Hour;if(OfferRush().Count>0)host.PublishState();}});service.NewGame+=()=>{cached=null;cachedMinute=int.MinValue;lastRushHour=-1;droveLooked=false;droveWay=null;};service.Loaded+=()=>{cached=null;cachedMinute=int.MinValue;lastRushHour=-1;droveLooked=false;droveWay=null;};
    }
}

