using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Native ownership/economy for handcarts, velocipedes and omnibus tickets, using the original state keys.</summary>
public sealed partial class NativeTransport : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeGoods goods;
    private NativeServiceContext C => host.Context;
    private JsonObject Data => goods.Data;
    public NativeTransport(NativeServiceHost host, NativeGoods goods) => (this.host, this.goods) = (host, goods);
    public Func<JsonObject>? TransportRecord;
    public Func<string,JsonObject>? TripPoints;
    public Func<int,JsonArray>? Errands;
    public JsonObject Transport=>TransportRecord?.Invoke()??Data["transport"]!.AsObject();
    public Func<double,double,double,bool>? GroundOpen;
    public readonly List<Func<int,double,double,bool>> Guards = new();
    public Action<int,string,int>? Stolen;
    private static double N(JsonNode? node,string key,double fallback=0)=>NativeGoods.N(node,key,fallback);
    private static string S(JsonNode? node,string key,string fallback="")=>NativeGoods.S(node,key,fallback);
    private static bool B(JsonNode? node,string key)=>NativeGoods.B(node,key);
    private static JsonArray A(JsonNode? node)=>NativeGoods.A(node);
    private static double V(JsonNode? node)=>NativeGoods.Number(node);
    private static double D(double ax,double az,double bx,double bz)=>NativeGoods.Distance(ax,az,bx,bz);
    private static double R1(double n)=>Math.Floor(n*10+.5)/10;
    private static double R3(double n)=>NativeGoods.R3(n);
    private static bool Finite(params double[] n)=>n.All(v=>double.IsFinite(v)&&Math.Abs(v)<5000);
    private static void Refuse(string text,int status=409)=>throw new NativeServiceException(text,status);
    private int Minute=>host.Clock.MinuteNow()-1440;
    private int Money(int player)=>C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player);
    private JsonObject State(int player,string key)=>C.PlayerState(player,key)as JsonObject ?? (player==1?C.World(key)as JsonObject:null) ?? new JsonObject{["n"]=0,["list"]=new JsonArray(),["notice"]=null,["rolled"]=-1,["dropped"]=new JsonArray(),["dn"]=0};
    private static void Notice(JsonObject state,string text)=>state["notice"]=new JsonObject{["n"]=N(state["notice"],"n")+1,["text"]=text};
    private void Save(int player,string key,JsonObject state)=>C.SetPlayerState(player,key,state);
    private JsonObject Response(int player,JsonObject? extra=null)=>NativeCoreClock.Join(extra??new JsonObject(),host.Payload(player));
    private void Seen(int player,JsonObject body){double x=N(body,"x",double.NaN),z=N(body,"z",double.NaN);if(Finite(x,z))C.SetPlayerState(player,"native_transport_seen",new{x,z,at=C.Now});}
    private bool Watched(int player,double x,double z,double reach){var seen=C.PlayerState(player,"native_transport_seen");return seen!=null&&C.Now-N(seen,"at")<30000&&D(x,z,N(seen,"x"),N(seen,"z"))<reach || Guards.Any(g=>g(player,x,z));}
    private bool Safe(int player,double x,double z,string shop)
    {
        var step=A(C.World(shop)?["step"]);if(step.Count>=2&&D(x,z,V(step[0]),V(step[1]))<9)return true;
        string home=C.Scalar<string>("SELECT home FROM home_lease WHERE player_id=$p0 AND ended IS NULL ORDER BY id DESC LIMIT 1",player);
        var def=A(C.World("homes")?["homes"]).FirstOrDefault(h=>S(h,"id")==home);var door=A(def?["step"]);return door.Count>=2&&D(x,z,V(door[0]),V(door[1]))<8;
    }
    private bool Busy(double x,double z)
    {
        var places=C.World("town")?["places"]as JsonObject;if(places==null)return false;
        return places.Any(p=>p.Value!=null && (p.Key.Contains("market") || p.Key.Contains("markt") || p.Key.StartsWith("tavern:") || p.Key is "rijnkaai" or "werf" or "vismarkt" or "bassin") && D(x,z,N(p.Value,"x"),N(p.Value,"z"))<30);
    }
    public void Register(NativeServiceHost service)
    {
        RegisterCarts(); RegisterBikes(); RegisterRides();
        service.PayloadParts.Add(player=>new JsonObject{["carts"]=CartView(player),["ride"]=RideView(player)});
        service.TakeJobHooks.Add(LendForJob);
        service.PresenceHooks.Add(request=>{if(request.Body["pos"] is JsonObject pos)Seen(request.PlayerId,pos);});service.PlayerTickHooks.Add((request,advanced)=>{if(advanced){CartTick(request.PlayerId);BikeTick(request.PlayerId);}});
        service.StopTransportHooks.Add(player=>{var state=State(player,"jef_carts");foreach(var node in A(state["list"]))node!["held"]=false;Save(player,"jef_carts",state);StopBikes(player);Alight(player);});
        goods.CartContains=CartHas;
        var previousWarmth=service.TransportWarmth;
        service.TransportWarmth=(player,cold)=>RidePlace(player)=="inside"?(cold?6:10,null,10):RidePlace(player)=="roof"?(cold?3:5,null,10):previousWarmth?.Invoke(player,cold);
    }
    private bool? CartHas(string reference,string item)
    {
        var m=Regex.Match(reference,@"^hc:(\d+):(.+)$");if(!m.Success)return null;int player=int.Parse(m.Groups[1].Value);string id=m.Groups[2].Value;
        var cart=A(State(player,"jef_carts")["list"]).FirstOrDefault(c=>S(c,"id")==id);return cart!=null&&A(cart["load"]).Any(i=>S(i,"gid")==item);
    }
}



