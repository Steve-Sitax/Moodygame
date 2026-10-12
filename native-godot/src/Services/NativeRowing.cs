using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Native small-boat hire, world ownership, return, wreck/debt and rowing needs.</summary>
public sealed class NativeRowing : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly NativeGoods goods;
    private readonly NativeDeeds deeds;
    private NativeServiceContext C=>host.Context;
    private JsonObject Data=>goods.Data;
    public Func<JsonArray>? BoatDefinitions;
    public Func<JsonArray>? PublicBoats;
    public Func<string,string>? LandingWaterman;
    public JsonArray BaseBoats=>BoatDefinitions?.Invoke()??A(Data["rowBoatDefinitions"]);
    private readonly Dictionary<int,long> lastStroke=new();
    private static double N(JsonNode? n,string k,double fallback=0)=>NativeGoods.N(n,k,fallback);
    private static string S(JsonNode? n,string k,string fallback="")=>NativeGoods.S(n,k,fallback);
    private static bool B(JsonNode? n,string k)=>NativeGoods.B(n,k);
    private static JsonArray A(JsonNode? n)=>NativeGoods.A(n);
    private static double V(JsonNode? n)=>NativeGoods.Number(n);
    private static double D(double x,double z,JsonNode? n)=>NativeGoods.Distance(x,z,N(n,"x"),N(n,"z"));
    private static bool Finite(params double[] n)=>n.All(v=>double.IsFinite(v)&&Math.Abs(v)<5000);
    private static void Refuse(string text,int code=409)=>throw new NativeServiceException(text,code);
    private int Minute=>host.Clock.MinuteNow()-1440;
    private int Day=>(int)N(host.Clock.View(),"day");
    private int Money(int player)=>C.Scalar<int>("SELECT money_c FROM player WHERE id=$p0",player);
    public NativeRowing(NativeServiceHost host,NativeGoods goods,NativeDeeds deeds)=>(this.host,this.goods,this.deeds)=(host,goods,deeds);
    private JsonObject State(int player)=>C.PlayerState(player,"row")as JsonObject??(player==1?C.World("row")as JsonObject:null)??new JsonObject{["hire"]=null,["on"]=null,["onSince"]=0,["effort"]=0,["debt_c"]=0,["debt_to"]=null,["debt_day"]=null,["notice"]=null};
    private void Save(int player,JsonObject state)=>C.SetPlayerState(player,"row",state);
    private void Notice(JsonObject state,string text)=>state["notice"]=new JsonObject{["n"]=N(state["notice"],"n")+1,["text"]=text};
    private JsonObject? Definition(string id)=>BaseBoats.FirstOrDefault(b=>S(b,"id")==id)as JsonObject;
    private JsonObject Landing(string id)=>A(Data["row"]?["landings"]).FirstOrDefault(l=>S(l,"id")==id)as JsonObject??throw new NativeServiceException("no such landing",400);
    private string Waterman(string id)=>LandingWaterman?.Invoke(id)??Data["watermen"]?[id]?.GetValue<string>()??"";
    public static int LateFee(int since,int minute)=>minute-since-120<=0?0:Math.Min(20,(int)Math.Ceiling((minute-since-120)/60.0)*2);
    private JsonObject Charge(int player,JsonObject state,int amount,string owner)
    {
        int paid=Math.Min(Money(player),Math.Max(0,amount)),owed=amount-paid;if(paid>0)C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",paid,player);if(owed>0){if(N(state,"debt_c")==0)state["debt_day"]=Day;state["debt_c"]=Math.Min(150,N(state,"debt_c")+owed);if(owner!="")state["debt_to"]=owner;}return new(){["paid_c"]=paid,["owed_c"]=owed};
    }
    public JsonObject Boats()
    {
        var saved=C.World("row_boats")as JsonObject??new();var result=new JsonObject();foreach(var b in BaseBoats){string id=S(b,"id");var st=saved[id]as JsonObject;result[id]=st!=null&&!(st["lostDay"]!=null&&N(st,"lostDay")<Day)?st.DeepClone():new JsonObject{["x"]=b!["x"]!.DeepClone(),["z"]=b["z"]!.DeepClone(),["yaw"]=b["yaw"]!.DeepClone(),["ridden"]=false,["deed"]=null};}return result;
    }
    private void SetBoat(string id,JsonObject state){var all=Boats();all[id]=state.DeepClone();C.SetWorld("row_boats",all);}
    public JsonObject? Find(int player,string id)
    {
        var b=Definition(id);if(b==null)return null;var st=Boats()[id]!.AsObject();if(st["lostDay"]!=null)Refuse("it is gone");if(B(st,"ridden")&&N(st,"by",1)!=player)Refuse("someone else is in it");if(st["deed"]!=null&&deeds.Row((int)N(st,"deed"))is JsonObject d&&N(d,"player_id",1)!=player)Refuse("someone else has it");if(S(State(player),"on")!="")Refuse("you are in a boat already");var result=b.DeepClone().AsObject();foreach(var p in st)result[p.Key]=p.Value?.DeepClone();result["length"]=N(Data["boatHulls"]?[S(b,"kind")],"len");return result;
    }
    public void Take(int player,string id,int deed)
    {
        var found=Find(player,id)??throw new NativeServiceException("no such boat",404);var st=Boats()[id]!.AsObject();st["ridden"]=true;st["by"]=player;st["deed"]=deed==0?null:JsonValue.Create(deed);SetBoat(id,st);var state=State(player);state["on"]=id;state["onSince"]=Minute;Save(player,state);
    }
    public void Home(string id)
    {
        var b=Definition(id);if(b==null||Boats()[id]?["lostDay"]!=null)return;SetBoat(id,new(){["x"]=b["x"]!.DeepClone(),["z"]=b["z"]!.DeepClone(),["yaw"]=b["yaw"]!.DeepClone(),["ridden"]=false,["deed"]=null});foreach(var p in C.Rows("SELECT id FROM player")){int player=(int)N(p,"id");var state=State(player);if(S(state,"on")==id){state["on"]=null;Save(player,state);}}
    }
    private JsonArray LandingsView(){var landings=Data["row"]!["landings"]!.DeepClone().AsArray();if(LandingWaterman!=null)foreach(var landing in landings){string id=Waterman(S(landing,"id")),name=id==""?"The waterman":C.Scalar<string>("SELECT name FROM npc WHERE id=$p0",id)??"The waterman";landing!["waterman"]=name=="The waterman"?name:name.Split(' ')[0];}return landings;}
    public JsonObject World(int player)
    {
        var state=State(player);var states=Boats();var missed=C.PlayerState(player,"row_missed")as JsonObject??new();var list=new JsonArray();foreach(var baseBoat in (PublicBoats?.Invoke()??A(Data["row"]?["boats"]))){string id=S(baseBoat,"id");var st=states[id]!;var boat=baseBoat!.DeepClone().AsObject();foreach(string k in new[]{"x","z","yaw","ridden"})boat[k]=st[k]?.DeepClone();boat["mine"]=st["deed"]!=null||S(boat,"owner")==""&&(B(st,"ridden")||D(N(st,"x"),N(st,"z"),boat["home"])>4);boat["lost"]=st["lostDay"]!=null;boat["missed"]=N(missed,id);list.Add(boat);}var hire=state["hire"]as JsonObject;var hireView=hire?.DeepClone().AsObject();if(hireView!=null){hireView["minutes"]=Minute-N(hire,"since");hireView["time_left_min"]=Math.Max(0,N(hire,"since")+120-Minute);hireView["late_c"]=LateFee((int)N(hire,"since"),Minute);hireView.Remove("since");}return new(){["landings"]=LandingsView(),["boats"]=list,["hire"]=hireView,["on"]=state["on"]?.DeepClone(),["debt_c"]=N(state,"debt_c"),["notice"]=state["notice"]?.DeepClone(),["storm"]=S(host.Clock.View(),"weather")=="storm",["fees"]=Data["row"]!["fees"]!.DeepClone()};
    }
    private JsonObject Reply(int player,JsonObject result){result["row"]=World(player);host.PublishState(player);return NativeCoreClock.Join(result,host.Payload(player));}
    private JsonObject Hire(NativeServiceRequest r)=>C.Atomic(()=>
    {
        string landing=r.Text("landing");var l=Landing(landing);double x=N(r.Body,"x",double.NaN),z=N(r.Body,"z",double.NaN);var step=A(l["landing"]);if(!Finite(x,z)||NativeGoods.Distance(x,z,V(step[0]),V(step[1]))>5)Refuse("too far from the boat");var state=State(r.PlayerId);if(state["on"]!=null)Refuse("you are in a boat already");if(state["hire"]!=null)Refuse("you have one of his boats out already");if(S(host.Clock.View(),"weather")=="storm")Refuse("The waterman will not let a boat out in this gale");int debt=(int)N(state,"debt_c");if(Money(r.PlayerId)<10+debt)Refuse("The waterman wants the debt paid first and 10 c for the boat");C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1",10+debt,r.PlayerId);state["debt_c"]=0;state["debt_to"]=null;state["debt_day"]=null;state["hire"]=new JsonObject{["landing"]=landing,["kind"]=l["kind"]!.DeepClone(),["since"]=Minute,["left"]=null};state["on"]="hire";state["onSince"]=Minute;Save(r.PlayerId,state);C.Log(r.PlayerId,"hired_boat",landing,"Jef hired a rowing boat for 10 centimes.");return new JsonObject{["fee_c"]=10,["debt_paid_c"]=debt,["kind"]=l["kind"]!.DeepClone(),["text"]="The waterman takes 10 c and holds the boat while you climb in. Back within two hours at any of our steps."};
    });
    private JsonObject Board(NativeServiceRequest r){var state=State(r.PlayerId);if(state["on"]!=null)Refuse("you are in a boat already");if(state["hire"]==null)Refuse("you have no boat out");if(!Finite(N(r.Body,"x",double.NaN),N(r.Body,"z",double.NaN)))Refuse("bad place",400);state["on"]="hire";state["onSince"]=Minute;state["hire"]!["left"]=null;Save(r.PlayerId,state);return new(){["text"]="You climb back into the boat."};}
    public JsonObject Leave(int player,double x,double z,double yaw,bool ashore=true)=>C.Atomic(()=>
    {
        var state=State(player);string on=S(state,"on");var result=new JsonObject{["returned"]=false,["late_c"]=0,["paid_c"]=0,["owed_c"]=0,["text"]=""};if(on=="")return result;if(!Finite(x,z))Refuse("bad place",400);state["on"]=null;var hire=state["hire"] as JsonObject;
        if(on!="hire"){var st=Boats()[on]!.AsObject();st["x"]=NativeGoods.R3(x);st["z"]=NativeGoods.R3(z);if(double.IsFinite(yaw))st["yaw"]=NativeGoods.R3(yaw);st["ridden"]=false;SetBoat(on,st);Save(player,state);var b=Definition(on);if(b!=null&&ashore&&D(x,z,b)<=4){if(st["deed"]!=null){deeds.Return(player,(int)N(st,"deed"),"gave");deeds.SettleBoat(player,(int)N(st,"deed"));}Home(on);result["returned"]=true;result["text"]="You tie the boat up again where she lay.";}return result;}
        var at=ashore?A(Data["row"]?["landings"]).FirstOrDefault(l=>D(x,z,l)<=9):null;if(at!=null){int late=LateFee((int)N(hire,"since"),Minute);var charge=Charge(player,state,late,Waterman(S(at,"id")));state["hire"]=null;Save(player,state);foreach(var p in charge)result[p.Key]=p.Value?.DeepClone();result["returned"]=true;result["late_c"]=late;result["text"]=late>0?$"The waterman ties the boat up. Late: {late} c.":"The waterman ties the boat up and nods.";C.Log(player,"returned_boat",S(at,"id"),"Jef brought the hire boat back to the steps.");return result;}
        hire!["left"]=new JsonObject{["x"]=NativeGoods.R3(x),["z"]=NativeGoods.R3(z),["at"]=Minute};Save(player,state);return result;
    });
    private void Fetch(int player,JsonObject state,string why)
    {
        var hire=state["hire"]as JsonObject;if(hire==null)return;int sum=15+LateFee((int)N(hire,"since"),Minute);var charged=Charge(player,state,sum,Waterman(S(hire,"landing")));state["hire"]=null;if(S(state,"on")=="hire")state["on"]=null;Notice(state,$"The waterman's boy fetched the boat; {N(charged,"paid_c")} c paid, {N(charged,"owed_c")} c owed.");Save(player,state);C.Log(player,"boat_fetched",S(hire,"landing"),"The waterman had the boat Jef left fetched.");string owner=Waterman(S(hire,"landing"));if(owner!="")host.Trade.Remember(player,owner,"Jef left my boat on the water and I had to send the boy for it.",4,"Jef left a hired boat lying on the water",-1);
    }
    private JsonObject Lost(NativeServiceRequest r)=>C.Atomic(()=>
    {
        string cause=r.Text("cause");if(cause is not("ship"or"bridge"))Refuse("cause must be ship or bridge",400);var state=State(r.PlayerId);string on=S(state,"on");var hire=state["hire"]as JsonObject;if(on=="hire"||hire!=null&&on==""){int amount=Math.Clamp((int)N(Data["boatHulls"]?[S(hire,"kind")],"lost_c",120),60,120)+LateFee((int)N(hire,"since"),Minute);var charge=Charge(r.PlayerId,state,amount,Waterman(S(hire,"landing")));state["hire"]=null;state["on"]=null;Save(r.PlayerId,state);C.Log(r.PlayerId,"lost_boat",S(hire,"landing"),"Jef lost the waterman's boat, "+cause+".");charge["lost_c"]=amount;charge["text"]=$"The boat is gone. {N(charge,"paid_c")} c paid; {N(charge,"owed_c")} c owed. An unpaid debt goes to the police in the morning.";return charge;}
        if(on=="")Refuse("you are not in a boat");var b=Definition(on)??throw new NativeServiceException("no such boat",404);var st=Boats()[on]!.AsObject();if(S(b,"owner")!=""&&st["deed"]==null)Refuse("that boat is not yours to lose");st["ridden"]=false;st["lostDay"]=Day;SetBoat(on,st);state["on"]=null;Save(r.PlayerId,state);if(st["deed"]!=null)deeds.WreckBoat(r.PlayerId,(int)N(st,"deed"));C.Log(r.PlayerId,"wrecked_boat",on,"Jef wrecked a small boat, "+cause+".");return new JsonObject{["text"]=S(b,"owner")==""?"The old boat is gone to the bottom. Nobody will ask after her.":"The boat is gone. Whose it was, you know; soon they will know about you."};
    });
    public int Effort(int player,int hard)
    {
        var state=State(player);if(S(state,"on")=="")return 0;long previous=lastStroke.GetValueOrDefault(player);int allowed=(int)Math.Floor(Math.Clamp((C.Now-previous)/1000.0,0,30));lastStroke[player]=C.Now;int add=Math.Min(Math.Max(0,hard),allowed);state["effort"]=Math.Min(120,N(state,"effort")+add);Save(player,state);return add;
    }
    private int Food(int player,int hour)
    {
        var state=State(player);if(S(state,"on")=="")return 0;int amount=hour%4==0&&Minute-N(state,"onSince")>=120?1:0;if(N(state,"effort")>=60){amount++;state["effort"]=N(state,"effort")-60;Save(player,state);}return amount;
    }
    private void Stop(int player,bool night)
    {
        var state=State(player);string on=S(state,"on");if(on!=""&&on!="hire"){var st=Boats()[on]!.AsObject();st["ridden"]=false;SetBoat(on,st);state["on"]=null;Save(player,state);}if(night&&state["hire"]!=null)Fetch(player,state,"night");else if(on=="hire"){var hire=state["hire"] as JsonObject;var berth=Landing(S(hire,"landing"));Leave(player,N(berth,"x"),N(berth,"z"),N(berth,"yaw"));}
    }
    private void Tick(int player)
    {
        var state=State(player);if(state["hire"]?["left"]!=null&&Minute-N(state["hire"]!["left"],"at")>=60)Fetch(player,state,"fetched");state=State(player);if(N(state,"debt_c")>0&&state["debt_day"]!=null&&N(state,"debt_day")<Day){string owner=S(state,"debt_to");int amount=(int)N(state,"debt_c");state["debt_c"]=0;state["debt_day"]=null;state["debt_to"]=null;if(owner!=""){int deed=deeds.BoatDebt(player,owner);Notice(state,$"The waterman went to the police about the {amount} c owed for his boat.");deeds.Schedule(player,deed);}Save(player,state);}
        var asked=C.PlayerState(player,"boat_asked")as JsonObject??new();foreach(var ask in asked.ToArray()){if(Minute-V(ask.Value)<40)continue;asked.Remove(ask.Key);if(int.TryParse(ask.Key,out int id)){var d=deeds.Row(id);if(d!=null&&S(d,"status")=="open"&&N(d,"player_id",1)==player){deeds.Schedule(player,id);host.Trade.Remember(player,S(d,"owner"),"Jef took my boat and did not bring her back when I asked. I went to the police.",6,"Jef took a boat and would not bring it back",-2);}}}C.SetPlayerState(player,"boat_asked",asked);
        var missed=C.PlayerState(player,"row_missed")as JsonObject??new();foreach(var b in BaseBoats){string id=S(b,"id"),owner=S(b,"owner");var st=Boats()[id];if(owner==""||st?["deed"]==null||st["lostDay"]!=null||N(missed,id)>0||!B(st,"ridden")&&D(N(st,"x"),N(st,"z"),b)<=4)continue;var deed=deeds.Row((int)N(st,"deed"));if(deed==null||N(deed,"seen")>0||S(deed,"status")!="open"||Minute-((N(deed,"day")-1)*1440+N(deed,"hour")*60+N(deed,"minute"))<45)continue;missed[id]=Minute;host.Trade.Remember(player,owner,"My boat was gone from her mooring. Somebody took her and I had to do without.",4);C.Log(player,"missed_boat",id,"The owner found the boat gone from her mooring.");}C.SetPlayerState(player,"row_missed",missed);
    }
    public void Register(NativeServiceHost service)
    {
        deeds.FindBoat=Find;deeds.TakeBoat=Take;deeds.HomeBoat=Home;service.Register("GET","/api/row/world",r=>World(r.PlayerId));service.Register("POST","/api/row/hire",r=>Reply(r.PlayerId,Hire(r)));service.Register("POST","/api/row/board",r=>{var response=Board(r);response["row"]=World(r.PlayerId);return response;});service.Register("POST","/api/row/leave",r=>Reply(r.PlayerId,Leave(r.PlayerId,N(r.Body,"x",double.NaN),N(r.Body,"z",double.NaN),N(r.Body,"yaw",double.NaN),r.Bool("ashore",true))));service.Register("POST","/api/row/stroke",r=>new{counted=Effort(r.PlayerId,r.Int("hard"))});service.Register("POST","/api/row/lost",r=>Reply(r.PlayerId,Lost(r)));
        service.PlayerTickHooks.Add((r,advanced)=>{if(advanced)Tick(r.PlayerId);});service.PlayerMidnightHooks.Add((player,day)=>{Stop(player,true);Tick(player);});service.StopTransportHooks.Add(player=>Stop(player,true));service.NewGame+=lastStroke.Clear;service.Loaded+=lastStroke.Clear;
        var previousWarmth=service.TransportWarmth;service.TransportWarmth=(player,cold)=>S(State(player),"on")!=""?(cold?2:S(host.Clock.View(),"weather")is "rain"or"storm"?3:4,null,10):previousWarmth?.Invoke(player,cold);var previousFood=service.RowFood;service.RowFood=(player,hour)=>Food(player,hour)+(previousFood?.Invoke(player,hour)??0);
    }
}


