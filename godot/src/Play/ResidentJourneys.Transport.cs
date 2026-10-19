using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Threading;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Town;
using Scheldemist.World;
using Handcart=Scheldemist.People.PushCart;

namespace Scheldemist.Play;

public partial class ResidentJourneys
{
    public sealed partial class Trip
    {
        public ResidentVehicle? Vehicle;
        public double[]? Fetch,Park;
        public JourneyRules.Load? Load;
        public int Loaded,Unload;
        public double BedRetry;
        public double? LoadingFinishedAt;
        public Vector2 Door,Bed;
        public bool HasBed,Returning,BedRecovered;
        public string? Errand;
        public List<Carrier> Helpers=new();
        public Carrier Own=new(){Step=1},OffStep=new();
        public FamilyBoat? BoatTrip;
        /// <summary>The nearest a drawn pusher has come to where he takes his vehicle, and since when (town clock seconds) he has gained no ground.</summary>
        public double BestLeft=double.MaxValue,NoGain;
        /// <summary>How the vehicle's way ended: "arrived", "gave up" (out of time where it stood) or "taken on" (out of sight, no ground gained).</summary>
        public string Ended="";
        /// <summary>Where the vehicle's way began (its time limit counts the straight way from here, #196).</summary>
        public Vector2 GoFrom;
        /// <summary>Its ground gained is counted along the crowd's planned way (its search number), or -1 the straight line; from one to
        /// the other the count starts afresh (a new plan of the same way is not: going to and fro between two ways round gains none).</summary>
        public int Plan=-2;
    }
    /// <summary>The last handcart trips' ends (who, how, where, where to, seconds): the stuck report's `cartTrips` (#196).</summary>
    public static readonly List<string> CartEnds=new();
    public sealed class Carrier {public string Id="";public int Step;public double Go,Wait,Time;}
    public sealed class FamilyBoat {public string Kind="rowboat";public List<string> Crew=new();public JourneyRules.Point[] Path=Array.Empty<JourneyRules.Point>();public Vector2 To,ToTop,FromTop;public bool Home;
        /// <summary>Where she comes alongside the landing to put her people ashore when her own berth (her home along the wall, or a place
        /// further along) is out of their reach (#182); she is taken on to it once nobody is near.</summary>
        public Vector2? Land;public float LandYaw;}
    private sealed class ParkedCart {public Vector3 At;public double Waited;public int Items,Goods;public Handcart? Cart;public readonly List<Node3D> Cargo=new();public bool Pushed;}
    private ResidentTransport? transport;
    private readonly Dictionary<string,ParkedCart> parked=new();
    private readonly Dictionary<string,string> cartAt=new();
    private readonly HashSet<string> inUse=new(),missed=new(),completedErrands=new(),abandonedErrands=new();
    private readonly List<string> notes=new();
    private bool transportLoading;
    private bool takingCart;
    private double snapshotPoll;
    private Dictionary<string,string> cartSnapshots=new();
    private double transportPoll;
    private int transportEpoch,lastTransportDay=-1;
    private static readonly JourneyRules.Stop[] TransportStops=OmnibusLines.Stops.Select(s=>new JourneyRules.Stop(s.Id,s.Line,s.X,s.Z)).ToArray();
    public IReadOnlyList<string> Notes=>notes;
    public ResidentTransport? Transport=>transport;
    private static JourneyRules.Point Point(Vector2 p)=>new(p.X,p.Y);
    private static Vector2 V(double[] p)=>new((float)p[0],(float)p[1]);
    private static Vector3 Pose(double[] p)=>new((float)p[0],(float)p[1],p.Length>2?(float)p[2]:0);
    private static string PlaceKey(string key){int marker=key.IndexOf('|');if(marker>=0)key=key[..marker];return key.StartsWith("home",StringComparison.Ordinal)?"home":key;}
    private void Note(string line){notes.Add(line);if(notes.Count>80)notes.RemoveAt(0);}
    public async Task LoadTransport()
    {
        if(transportLoading||ServerLink.I?.Api is not {} api)return;
        transportLoading=true;int epoch=transportEpoch;
        try {var data=await api.TownTransport();if(epoch!=transportEpoch||!IsInsideTree())return;
            if(data.Vehicles.Any(v=>v.Home.Length<3||v.Parks.Values.Any(p=>p.Length<3))||data.Errands.Any(e=>e.To.Length<2))throw new InvalidOperationException("malformed native resident transport geometry");
            bool first=transport==null;transport=data;if(data.Day!=lastTransportDay){lastTransportDay=data.Day;completedErrands.Clear();abandonedErrands.Clear();}
            foreach(var v in data.Vehicles)if(v.Kind=="handcart"&&!inUse.Contains(v.Id))cartAt[v.Id]=v.At;
            if(first)Traffic.I?.ResidentOwners(data.Vehicles.Where(v=>v.Kind=="dray").Select(v=>(v.Route??"",town.ActionPerson(v.Owner)?.Kind??"carter",(Func<bool>)(()=>Working(v.Owner)))));
        } catch(ApiException ex){Note(ex.Message);}catch(Exception ex){GD.PushError("resident transport: "+ex.Message);}finally{transportLoading=false;}
    }
    private bool Working(string id){var s=town.ActionPerson(id);if(s==null)return town.Hour>=7&&town.Hour<18.5;var act=Whereabouts.ActivityAt(s.R.Sched,town.Day,town.Hour).Act;return act=="work"||town.Hour>=7&&town.Hour<18.5&&act is not("home" or "church");}
    public bool ResidentVehicleActive(string owner,int kind)=>town.ActionPerson(owner)?.P?.NetworkVehicle==kind||Trips.Any(t=>t.Person.R.Id==owner&&(kind==1&&t.Mode=="velocipede"||kind==2&&t.Mode=="handcart"||kind==3&&t.Mode=="dray")&&t.Phase=="go");
    private void ClearTransport(){transport=null;transportPoll=10;foreach(var p in parked.Values)p.Cart?.Dispose();parked.Clear();cartAt.Clear();inUse.Clear();missed.Clear();completedErrands.Clear();abandonedErrands.Clear();Volatile.Write(ref cartSnapshots,new());}
    // Only serialized data crosses to the service worker; scene objects remain on the main thread.
    public JsonObject? CartSnapshot(string id)=>Volatile.Read(ref cartSnapshots).TryGetValue(id,out var json)?JsonNode.Parse(json)!.AsObject():null;
    private void PublishCartSnapshots()
    {
        var snapshots=new Dictionary<string,string>();
        foreach(var vehicle in transport?.Vehicles??new()){
            if(vehicle.Kind!="handcart"||vehicle.Gone||!parked.TryGetValue(vehicle.Id,out var pk))continue;
            var load=new JsonArray();
            for(int i=0;i<pk.Items;i++){
                string kind=pk.Goods==5?"sacks":pk.Goods==3&&i%3==0?"chair":pk.Goods!=2&&i%3==1?"sacks":"crates";
                load.Add(new JsonObject{["kind"]=kind});
            }
            snapshots[vehicle.Id]=new JsonObject{["x"]=pk.At.X,["z"]=pk.At.Y,["yaw"]=pk.At.Z,["load"]=load,["in_use"]=inUse.Contains(vehicle.Id)||pk.Pushed||ResidentVehicleActive(vehicle.Owner,2)}.ToJsonString();
        }
        Volatile.Write(ref cartSnapshots,snapshots);
    }
    private Offers? ParkedCartKeys(float x,float z)
    {
        if(takingCart||transport==null||Player.Jef.I.Laden||Player.Jef.I.Riding||Player.Jef.I.Swimming||Player.Jef.I.Climbing||Handcarts.I.Held!=null)return null;
        var offers=new Offers{Options=new()};
        foreach(var vehicle in transport.Vehicles){
            if(vehicle.Kind!="handcart"||vehicle.Gone||inUse.Contains(vehicle.Id)||!parked.TryGetValue(vehicle.Id,out var pk)||pk.Pushed||pk.Cart==null||ResidentVehicleActive(vehicle.Owner,2))continue;
            float distance=new Vector2(pk.At.X-x,pk.At.Y-z).Length();if(distance>2.4f)continue;
            string id=vehicle.Id;
            offers.Options!.Add((distance,Act.At(Key.E,"steal "+vehicle.Label,new(pk.At.X,Player.Jef.I.Y+.7f,pk.At.Y),()=>_=TakeParkedCart(id))));
        }
        return offers.Options!.Count>0?offers:null;
    }
    private async Task TakeParkedCart(string id)
    {
        if(takingCart||Handcarts.I.Busy||Handcarts.I.Held!=null)return;
        takingCart=true;
        try{
            PublishCartSnapshots();await Deeds.I.Take(id);
            var view=await ServerLink.I!.Api!.Carts();
            if(!view.List.Any(c=>c.Id==id&&c.Kind=="taken"))return;
            if(transport!=null)transport=transport with{Vehicles=transport.Vehicles.Select(v=>v.Id==id?v with{Gone=true}:v).ToList()};
            if(parked.TryGetValue(id,out var pk)){pk.Cart?.Dispose();pk.Cart=null;pk.Cargo.Clear();pk.Items=0;}
            PublishCartSnapshots();
            Handcarts.I.Apply(view);Goods.I.RefreshCartGoods();
            if(Handcarts.I.Drawings.TryGetValue(id,out var drawn))await Handcarts.I.Grip(drawn);
        }catch(ApiException ex){GameState.I.Say(ex.Message);}finally{takingCart=false;}
    }
    private bool BeginTransport(Townspeople.Sim s,string previous)
    {
        if(s.ActionHeld||s.InTrip||s.MillRun||town.MaySimulate?.Invoke(s.R.Id)==false)return false;
        string fromKey=PlaceKey(previous),toKey=PlaceKey(s.Key);var destination=town.Anchor(s);var from=new JourneyRules.Point(s.X,s.Z);var to=new JourneyRules.Point(destination.X,destination.Z);
        var load=JourneyRules.ScheduleLoad(s.R.Trade,s.R.Trade=="fishwife"?1:3,fromKey,toKey);
        var velo=transport?.Vehicles.FirstOrDefault(v=>v.Kind=="velocipede"&&v.Owner==s.R.Id);var cart=transport?.Vehicles.FirstOrDefault(v=>v.Kind=="handcart"&&v.Owner==s.R.Id&&v.Household==s.R.Household);
        double[]? veloAt=null;if(velo is {Gone:false}&&!inUse.Contains(velo.Id)&&velo.Parks.TryGetValue(fromKey,out var spot)&&Velocipedes.I?.Machines.TryGetValue(velo.Id,out var bike)==true&&new Vector2(bike.Info.X,bike.Info.Z).DistanceTo(V(spot))<4)veloAt=new double[]{bike.Info.X,bike.Info.Z,bike.Info.Yaw};
        if(velo is {Gone:true}&&from.Distance(to)>300&&missed.Add(velo.Id)&&ServerLink.I?.Api is {} api)api.Run(api.TransportMissed(velo.Id),_=>{});
        bool cartHere=cart is {Gone:false}&&!inUse.Contains(cart.Id)&&cartAt.GetValueOrDefault(cart.Id,"home")==fromKey&&cart.Parks.ContainsKey(toKey);
        var plan=JourneyRules.Choose(new(from,to,load,Velo:veloAt!=null&&velo!.Parks.ContainsKey(toKey),Cart:cartHere,Stops:TransportStops,WaitAt:stop=>WaitAt(OmnibusLines.Stops.First(q=>q.Id==stop.Id&&q.Line==stop.Line)),Age:s.R.Age));
        if(plan.Mode=="walk")return false;
        if(plan.Mode=="omnibus")return Start(s,new((float)to.X,(float)to.Z),OmnibusLines.Stops.First(q=>q.Id==plan.Board!.Id&&q.Line==plan.Board.Line),OmnibusLines.Stops.First(q=>q.Id==plan.Alight!.Id&&q.Line==plan.Alight.Line));
        string key=s.Key;if(!town.ActionHold(s,this))return false;
        var trip=new Trip{Person=s,To=new((float)to.X,(float)to.Z),Key=toKey,Mode=plan.Mode,Phase="fetch",Why=plan.Why,Load=load};
        if(plan.Mode=="velocipede"){trip.Vehicle=velo;trip.Fetch=veloAt;trip.Park=velo!.Parks[toKey];Velocipedes.I!.ResidentUse(velo!.Id,true);}
        else {trip.Vehicle=cart;trip.Fetch=cart!.Parks.GetValueOrDefault(fromKey,cart.Home);trip.Park=cart.Parks[toKey];var pk=ParkCart(cart.Id,trip.Fetch);trip.Loaded=pk.Items;trip.Unload=load?.Items??0;trip.Door=fromKey=="home"?new((float)s.R.HomeSx,(float)s.R.HomeSz):trip.To;if(load!=null&&load.Items>trip.Loaded&&fromKey=="home"){trip.Phase="load";trip.Helpers=Helpers(s,load.Items-trip.Loaded);}}
        inUse.Add(trip.Vehicle!.Id);Trips.Add(trip);s.Journey=trip;Note(s.R.Name+": "+plan.Mode+" ("+plan.Why+")");return true;
    }
    private List<Carrier> Helpers(Townspeople.Sim owner,int items)
    {
        var family=town.Sims.Where(s=>s!=owner&&s.R.Household==owner.R.Household&&!s.ActionHeld&&!s.InTrip&&s.Journey==null)
            .Select(s=>new JourneyRules.Family(s.R.Id,s.R.Age,s.Inside&&(Whereabouts.ActivityAt(s.R.Sched,town.Day,town.Hour).Act=="home"||Math.Abs(s.Door.X-owner.R.HomeSx)+Math.Abs(s.Door.Z-owner.R.HomeSz)<.5)));
        return JourneyRules.PlanLoading(items,owner.R.Id,family).Carriers.Skip(1).Select(id=>new Carrier{Id=id}).ToList();
    }
    private ParkedCart ParkCart(string id,double[] pose){if(!parked.TryGetValue(id,out var pk))parked[id]=pk=new();pk.At=Pose(pose);return pk;}
    private void CartItems(Trip t,int n){if(t.Vehicle==null||!parked.TryGetValue(t.Vehicle.Id,out var pk))return;pk.Items=n;pk.Goods=CargoCode(t.Load?.What);if(pk.Cart!=null)Crowd.CartCargo(pk.Cart,pk.Cargo,n,pk.Goods,t.Person.P?.Id??t.Person.R.Household);}
    private static int CargoCode(string? what)=>what switch{"fish"=>2,"furniture"=>3,"chests"=>4,"sacks"=>5,_=>1};
    private void TransportUpdate(double dt)
    {
        if((transportPoll-=dt)<=0){transportPoll=10;_=LoadTransport();}
        DrawParked(dt);UpdateErrands();TakeOn();
        if((snapshotPoll-=dt)<=0){snapshotPoll=.25;PublishCartSnapshots();}
    }
    private void DrawParked(double dt)
    {
        if(transport==null||!Scheldemist.People.PushCart.Has)return;
        foreach(var vehicle in transport.Vehicles.Where(v=>v.Kind=="handcart")) {
            if(!parked.TryGetValue(vehicle.Id,out var pk))pk=ParkCart(vehicle.Id,vehicle.Parks.GetValueOrDefault(cartAt.GetValueOrDefault(vehicle.Id,vehicle.At),vehicle.Home));
            bool usingCart=pk.Pushed||vehicle.Gone||ResidentVehicleActive(vehicle.Owner,2);
            if(!usingCart&&!inUse.Contains(vehicle.Id)){var next=Pose(vehicle.Parks.GetValueOrDefault(cartAt.GetValueOrDefault(vehicle.Id,vehicle.At),vehicle.Home));if(next!=pk.At){pk.Cart?.Dispose();pk.Cart=null;pk.Cargo.Clear();pk.At=next;}}
            if(usingCart){pk.Cart?.Dispose();pk.Cart=null;pk.Cargo.Clear();continue;}
            var eye=Main.I.Cam.GlobalPosition;bool near=new Vector2(pk.At.X-eye.X,pk.At.Y-eye.Z).Length()<60;
            // (not drawn down onto someone: it waits for him to pass, up to ten seconds, and then eases him out; never onto someone
            // pushing a cart, who could not be eased out of it, #192)
            int on=near&&pk.Cart==null?town.Crowd?.SomeoneOnParkedCart(pk.At.X,pk.At.Y,pk.At.Z)??0:0;
            if(on==0)pk.Waited=0;else pk.Waited+=dt;
            if(near&&pk.Cart==null&&(on==0||on==1&&pk.Waited>10)){pk.Cart=new Handcart(Main.I.View,false);float gx=pk.At.X-MathF.Sin(pk.At.Z)*2.15f,gz=pk.At.Y-MathF.Cos(pk.At.Z)*2.15f;pk.Cart.Push(.5,gx,gz,.9,pk.At.Z,0,town.Walk?.BaseAt(gx,gz)??0);var box=new Aabb(new(-.72f,0,-.9f),new(1.44f,1.3f,1.9f));var solid=Mv.BoxBody(pk.Cart.Root,box,"parked_cart_solid");WalkMap.RegisterBody(solid,box);var cartBox=pk.Cart.Root.GlobalTransform*box;box=new Aabb(new(-.42f,.25f,.98f),new(.84f,.75f,1.2f));solid=Mv.BoxBody(pk.Cart.Root,box,"parked_shafts_solid");WalkMap.RegisterBody(solid,box);town.Crowd?.MoveOutOf(cartBox);town.Crowd?.MoveOutOf(pk.Cart.Root.GlobalTransform*box);Crowd.CartCargo(pk.Cart,pk.Cargo,pk.Items,pk.Goods,vehicle.Household);}
            else if(!near&&pk.Cart!=null){pk.Cart.Dispose();pk.Cart=null;pk.Cargo.Clear();}
        }
    }
    private void Go(Trip t,Vector2 to,double dt,double pace=1.3)
    {
        var s=t.Person;if(s.P==null){double speed=pace==1.3?6:JourneyRules.Speed(t.Mode)*6/1.3;town.ActionMoveHidden(s,to.X,to.Y,speed*dt);if(new Vector2((float)s.X-Main.I.Cam.GlobalPosition.X,(float)s.Z-Main.I.Cam.GlobalPosition.Z).Length()<55)town.ActionClaim(s);}
        if(s.P is {} p){s.X=p.X;s.Z=p.Z;if((t.Go-=dt)<=0||!town.Crowd!.PuppetBusy(p)){t.Go=1.2;town.Crowd!.PuppetGo(p,to.X,to.Y,pace);}}
    }
    private static bool Near(Trip t,Vector2 point,double radius)=>new Vector2((float)(t.Person.P?.X??t.Person.X),(float)(t.Person.P?.Z??t.Person.Z)).DistanceTo(point)<radius;
    private void TakeVehicle(Trip t)
    {
        if(t.Phase=="load")t.LoadingFinishedAt=t.Time;
        t.Phase="go";t.Time=t.Go=0;t.BestLeft=double.MaxValue;t.NoGain=0;t.GoFrom=new((float)(t.Person.P?.X??t.Person.X),(float)(t.Person.P?.Z??t.Person.Z));
        if(t.Mode=="handcart"&&t.Vehicle!=null&&parked.TryGetValue(t.Vehicle.Id,out var pk)){pk.Pushed=true;pk.Cart?.Dispose();pk.Cart=null;pk.Cargo.Clear();}
        if(t.Person.P is {} p){if(t.Fetch!=null)p.Yaw=t.Fetch[2];town.Crowd!.PuppetLoad(p,false);town.Crowd.PuppetVehicle(p,t.Mode=="velocipede"?1:t.Mode=="handcart"?2:3,t.Mode=="dray"?(t.Unload>0?1:0):t.Loaded,CargoCode(t.Load?.What));}
    }
    private void StepTransport(Trip t,double dt)
    {
        var s=t.Person;var p=s.P;
        if(t.Phase=="row"){RowTrip(t,dt);return;}
        if(t.Phase=="landing"){if(Rowing.I.ResidentWalkersDone(t.Vehicle!.Id)||t.Time>45)LandRowTrip(t);return;}
        if(t.Phase=="toberth"){BerthTrip(t,dt);return;}
        // (a handcart's grips taken from where she stands within 3 m after 8 s: its own spot held, #196 a Grote Markt seller
        // stood 2 m from it for 100 s)
        if(t.Phase=="fetch"){var at=V(t.Fetch!);if(t.Mode=="handcart")at-=new Vector2((float)Math.Sin(t.Fetch![2]),(float)Math.Cos(t.Fetch[2]))*2.6f;if(Near(t,at,1.5)||t.Time>8&&Near(t,at,3))TakeVehicle(t);else Go(t,at,dt);return;}
        if(t.Phase=="load"){if(p==null){int rounds=(int)Math.Ceiling(Math.Max(1,(t.Load?.Items??1)-t.Loaded)/(1.0+t.Helpers.Count));if(t.Time>rounds*9/(6/1.3)){t.Loaded=t.Load?.Items??0;CartItems(t,t.Loaded);ReleaseHelpers(t);TakeVehicle(t);}else Go(t,t.Door,dt);}else Loading(t,dt);return;}
        if(t.Phase=="go") {
            if(p!=null&&p.NetworkVehicle==0)town.Crowd!.PuppetVehicle(p,t.Mode=="velocipede"?1:t.Mode=="handcart"?2:3,t.Mode=="dray"?(t.Unload>0?1:0):t.Loaded,CargoCode(t.Load?.What));
            var to=t.Park==null?t.To:V(t.Park);double radius=t.Mode=="velocipede"?1.6:t.Mode=="dray"?3.5:3;
            // (a drawn trip that cannot get there in time stops where it is: in 90 s and 4 s a metre of its straight way (a cart
            // goes about a metre a second, the way round up to twice the straight line), #192 a Grote Markt seller's cart from
            // a home round the town hall's block; #196 the straight way from where it set off: from her pitch it was counted from her
            // door to her cart's place by it, 2 m, and a cart from the market gave up half way home)
            // (out of the player's sight and over 12 m off, a handcart that gains no ground for four seconds, in a street too narrow for it to turn or
            // going to and fro between two ways round, is taken on to its place at once, #192)
            // (counted on the town's clock, 120 s a game hour: the stuck check runs the crowd faster than this node's frames)
            // (ground gained along its planned way, #196: on a way round the street the straight distance first grows, and carts
            // going round the Grote Markt were taken on while they went well, their sellers turning back on foot)
            if(p!=null){var at=new Vector2((float)p.X,(float)p.Z);float? way=p.NativeRoute?.Left(at,to);int plan=way==null?-1:p.NativeRoute!.Searches;double left=way??at.DistanceTo(to),clock=(town.Day*24+town.Hour)*120;if((plan<0)!=(t.Plan<0)){t.BestLeft=double.MaxValue;}t.Plan=plan;if(left<t.BestLeft-1||t.NoGain<=0){t.BestLeft=Math.Min(left,t.BestLeft);t.NoGain=clock;}}
            bool near=Near(t,to,p==null?.6:radius),late=p!=null&&t.Time>90+4*t.GoFrom.DistanceTo(to);
            if(near||late||p is {Shown:false}&&t.Mode=="handcart"&&(town.Day*24+town.Hour)*120-t.NoGain>4&&new Vector2((float)p.X-Main.I.Cam.GlobalPosition.X,(float)p.Z-Main.I.Cam.GlobalPosition.Z).Length()>12)
            {
                t.Ended=near?"arrived":late?"gave up":"taken on";
                if(t.Mode=="handcart"){CartEnds.Add($"{t.Person.R.Id} {t.Ended} at {t.Person.P?.X??t.Person.X:0.0},{t.Person.P?.Z??t.Person.Z:0.0} for {to.X:0.0},{to.Y:0.0} after {t.Time:0} s{(p==null?" (not drawn)":"")}");if(CartEnds.Count>400)CartEnds.RemoveAt(0);}
                ArriveTransport(t);
            }
            else Go(t,to,dt,t.Mode=="velocipede"?4:t.Mode=="dray"?1.15:.95);
            return;
        }
        if(t.Phase=="unload"){if(p==null){if(t.Time>t.Unload*9*.7/(6/1.3)){t.Unload=0;CartItems(t,0);UnloadFinished(t);}}else Unloading(t,dt);return;}
        if(t.Phase=="walkon"){if(Near(t,t.To,1.6))End(t,true);else Go(t,t.To,dt);}
    }
    private void ArriveTransport(Trip t)
    {
        t.Time=t.Go=0;var p=t.Person.P;
        if(t.Mode=="velocipede"){if(p!=null)town.Crowd!.PuppetVehicle(p,0);inUse.Remove(t.Vehicle!.Id);var pose=t.Park==null?new Vector3((float)t.Person.X,(float)t.Person.Z,0):Pose(t.Park);Velocipedes.I.ResidentUse(t.Vehicle.Id,false,pose);t.Phase="walkon";}
        else if(t.Mode=="handcart"){if(p!=null)town.Crowd!.PuppetVehicle(p,0);inUse.Remove(t.Vehicle!.Id);cartAt[t.Vehicle.Id]=t.Key;if(parked.TryGetValue(t.Vehicle.Id,out var pk)){pk.Pushed=false;if(t.Park!=null)pk.At=Pose(t.Park);}CartItems(t,t.Loaded);t.Door=t.To;t.Phase=t.Unload>0?"unload":"walkon";}
        else if(t.Unload>0){t.Phase="unload";if(p!=null)town.Crowd!.PuppetStand(p);}
        else{if(p!=null)town.Crowd!.PuppetVehicle(p,0);if(t.Vehicle?.Route is {} route)Traffic.I?.ResidentAway(route,false);t.Phase="walkon";t.To=new((float)t.Person.R.HomeSx,(float)t.Person.R.HomeSz);}
    }
    private void Loading(Trip t,double dt)
    {
        var p=t.Person.P!;var cart=Pose(t.Fetch!);int items=t.Load?.Items??0;
        if(!t.HasBed){
            if(town.Walk is {IsNative:true} map){
                if(t.Time>40){ReleaseHelpers(t);TakeVehicle(t);return;}
                if((t.BedRetry-=dt)>0)return;
                t.BedRetry=1;
                bool Supported(NativeCartLoadingPoint.Point q)=>map.Free(q.X,q.Z)&&map.SupportsStep(q.X,q.Z,q.X,q.Z)&&!Bridges.OnRaised(q.X,q.Z);
                bool Reachable(NativeCartLoadingPoint.Point q){var at=new Vector2((float)q.X,(float)q.Z);var route=Ways.NativePath(map,t.Door,at);return route is {Count:>0}&&map.SupportsStep(t.Door.X,t.Door.Y,route[0].X,route[0].Y)&&map.SupportsStep(route[^1].X,route[^1].Y,at.X,at.Y);}
                var selected=NativeCartLoadingPoint.Select(new(cart.X,cart.Y),cart.Z,Supported,Reachable);
                if(selected is not {} loading){if(t.Time>40){ReleaseHelpers(t);TakeVehicle(t);}return;}
                t.Bed=new((float)loading.At.X,(float)loading.At.Z);t.BedRecovered=loading.Recovered;t.HasBed=true;
            }else{
                var dir=new Vector2(MathF.Sin(cart.Z),MathF.Cos(cart.Z));var side=new Vector2(dir.Y,-dir.X);var axle=new Vector2(cart.X,cart.Y);var candidates=new[]{axle-dir*.6f+side,axle-dir*.6f-side,axle-dir*2.7f};t.Bed=candidates.FirstOrDefault(q=>town.Crowd!.CanStand(q.X,q.Y),candidates[2]);t.HasBed=true;
            }
        }
        void Carry(Puppet who,Carrier step){if(who.Conversing)return;step.Go-=dt;step.Wait-=dt;if(step.Wait>0)return;
            if(step.Step==0){town.Crowd!.PuppetLoad(who,true);if(new Vector2((float)who.X,(float)who.Z).DistanceTo(t.Bed)<1.5){t.Loaded=Math.Min(items,t.Loaded+1);CartItems(t,t.Loaded);town.Crowd.PuppetLoad(who,false);town.Crowd.PuppetStand(who);step.Step=1;step.Go=0;step.Wait=1.3;}else if(step.Go<=0||!town.Crowd.PuppetBusy(who)){step.Go=1.5;town.Crowd.PuppetGo(who,t.Bed.X,t.Bed.Y,.9);}}
            else if(step.Step==1){if(new Vector2((float)who.X,(float)who.Z).DistanceTo(t.Door)<.9){step.Step=t.Loaded+t.Helpers.Count(h=>h.Step==0)<items?0:2;step.Wait=step.Step==0?1.6:0;}else if(step.Go<=0||!town.Crowd!.PuppetBusy(who)){step.Go=1.5;town.Crowd!.PuppetGo(who,t.Door.X,t.Door.Y,1.1);}}
        }
        if(t.Own.Step!=2)Carry(p,t.Own);
        foreach(var h in t.Helpers){var helper=town.ActionPerson(h.Id);if(helper==null||h.Step==2)continue;if(!helper.InTrip){if(!town.ActionHold(helper,this)){h.Step=2;continue;}helper.InTrip=true;helper.X=t.Door.X;helper.Z=t.Door.Y;helper.OutAt=Time.GetTicksMsec();}if(helper.P==null)town.ActionClaim(helper);if(helper.P is {} hp)Carry(hp,h);else if((h.Go-=dt)<-4){h.Step=2;helper.InTrip=false;town.ActionRelease(helper,this);helper.Inside=true;}}
        if(t.Loaded>=items||t.Time>40){ReleaseHelpers(t);if(Near(t,new(cart.X,cart.Y),3.2)||t.Time>40)TakeVehicle(t);else Go(t,new(cart.X-MathF.Sin(cart.Z)*2.2f,cart.Y-MathF.Cos(cart.Z)*2.2f),dt,1);}
    }
    private void ReleaseHelpers(Trip t){foreach(var h in t.Helpers){var s=town.ActionPerson(h.Id);if(s==null)continue;h.Step=2;s.InTrip=false;if(s.P!=null)town.Crowd!.PuppetLoad(s.P,false);town.ActionRelease(s,this);}}
    private void Unloading(Trip t,double dt)
    {
        var p=t.Person.P!;var step=t.OffStep;step.Go-=dt;step.Time+=dt;
        if(t.Mode=="dray"&&!t.HasBed){t.Bed=new((float)(p.X-Math.Sin(p.Yaw)*4),(float)(p.Z-Math.Cos(p.Yaw)*4));t.HasBed=true;}
        var source=t.Mode=="dray"?t.Bed:t.Park==null?new Vector2((float)p.X,(float)p.Z):V(t.Park);var destination=t.Mode=="dray"?t.To:t.Door;
        var target=step.Step==0?source:destination;
        if(new Vector2((float)p.X,(float)p.Z).DistanceTo(target)<2.4||step.Time>12){step.Time=0;step.Go=0;if(step.Step==0){town.Crowd!.PuppetLoad(p,true);t.Unload--;CartItems(t,Math.Max(0,t.Unload));step.Step=1;}else{town.Crowd!.PuppetLoad(p,false);step.Step=0;if(t.Unload<=0)UnloadFinished(t);}}
        else if(step.Go<=0||!town.Crowd!.PuppetBusy(p)){step.Go=1.5;town.Crowd!.PuppetGo(p,target.X,target.Y,1);}
    }
    private void UnloadFinished(Trip t){t.Time=t.Go=0;if(t.Mode=="dray"){if(t.Person.P is {} p)town.Crowd!.PuppetVehicle(p,3,0);t.Phase="go";t.GoFrom=new((float)(t.Person.P?.X??t.Person.X),(float)(t.Person.P?.Z??t.Person.Z));t.Park=t.Fetch;t.To=V(t.Fetch!);}else t.Phase="walkon";}
    private void TransportEnd(Trip t)
    {
        if(t.Vehicle!=null){inUse.Remove(t.Vehicle.Id);if(parked.TryGetValue(t.Vehicle.Id,out var pk))pk.Pushed=false;if(t.Mode=="velocipede")Velocipedes.I?.ResidentUse(t.Vehicle.Id,false);if(t.Vehicle.Route is {} route)Traffic.I?.ResidentAway(route,false);}
        if(t.Person.P is {} p){town.Crowd!.PuppetVehicle(p,0);town.Crowd.PuppetLoad(p,false);}ReleaseHelpers(t);if(t.BoatTrip is {} boat){if(t.Phase is "row" or "toberth")Rowing.I?.ResidentBoatEnd(t.Vehicle!.Id,null,true);foreach(string id in boat.Crew){var crew=town.ActionPerson(id);if(crew==null||crew==t.Person)continue;crew.InTrip=crew.Aboard=false;town.ActionOutside(crew);town.ActionRelease(crew,this);}}
    }
}

