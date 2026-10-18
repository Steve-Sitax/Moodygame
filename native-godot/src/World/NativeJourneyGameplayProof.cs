using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Play;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Actual resident transport, native models and physics. All changes stay in a disposable proof database.</summary>
public static class NativeJourneyGameplayProof
{
    private readonly record struct RiderPose(double? LeftGripGap,double? RightGripGap,double? HipHorizontalGap,double? HipAboveSaddle,double? ForwardLean);
    private static RiderPose RidePose(Puppet person,Node3D bike)
    {
        var skeleton=BakedWorld.All(person.Human.Root).OfType<Skeleton3D>().First();
        Vector3? Bone(string name){int index=skeleton.FindBone(name);return index<0?null:skeleton.GlobalTransform*skeleton.GetBoneGlobalPose(index).Origin;}
        var seat=bike.GlobalTransform*new Vector3(0,.97f,-.02f);var leftGrip=bike.GlobalTransform*new Vector3(.36f,1.09f,.43f);var rightGrip=bike.GlobalTransform*new Vector3(-.36f,1.09f,.43f);
        var hip=Bone("hips");var spine=Bone("spine");var neck=Bone("neck");double? lean=null;
        if(spine is Vector3 a&&neck is Vector3 b){var axis=(b-a).Normalized();lean=axis.Dot(new Vector3((float)Math.Sin(person.Yaw),0,(float)Math.Cos(person.Yaw)));}
        return new(person.Human.Hand(false)?.DistanceTo(leftGrip),person.Human.Hand(true)?.DistanceTo(rightGrip),
            hip is Vector3 h?new Vector2(h.X-seat.X,h.Z-seat.Z).Length():null,hip?.Y-seat.Y,lean);
    }
    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);var checks=new List<object>();var observations=new List<object>();var pictures=new List<string>();var stages=new List<string>();string error="";string scope=Main.I.Arg("native-journey-scope") is {Length:>0} chosenScope?chosenScope:"full";
        void Check(string name,bool passed){checks.Add(new{name,passed});if(!passed)throw new InvalidOperationException(name);}
        async Task Frames(int n){for(int i=0;i<n;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        async Task<bool> Until(Func<bool> ready,double seconds){var end=DateTime.UtcNow.AddSeconds(seconds);while(DateTime.UtcNow<end){if(ready())return true;await Frames(3);}return ready();}
        void View(Vector3 target,Node3D? subject=null)
        {
            if(!Jef.I.Fly)Jef.I.ToggleFly();var focus=target+Vector3.Up;var eye=focus+new Vector3(0,8,1);var space=game.World.GetWorld3D().DirectSpaceState;
            foreach(var offset in new[]{new Vector3(0,1.2f,2.5f),new Vector3(0,1.2f,-2.5f),new Vector3(2.5f,1.2f,0),new Vector3(-2.5f,1.2f,0),new Vector3(2,1.8f,2),new Vector3(-2,1.8f,-2),new Vector3(0,6,1)}){
                var candidate=focus+offset;using var ray=PhysicsRayQueryParameters3D.Create(candidate,focus,Solid.Layer);var hit=space.IntersectRay(ray);
                bool own=subject!=null&&hit.Count>0&&hit["collider"].AsGodotObject() is Node body&&(body==subject||subject.IsAncestorOf(body));
                if(hit.Count==0||own){eye=candidate;break;}
            }
            Jef.I.Place(eye.X,eye.Z,0,0,target.Y);game.Cam.GlobalPosition=eye;
            if(game.Cam is FlyCam fly)fly.Face(new Transform3D(Basis.Identity,eye).LookingAt(focus,Math.Abs((focus-eye).Normalized().Dot(Vector3.Up))>.98f?Vector3.Forward:Vector3.Up).Basis.GetRotationQuaternion());
        }
        async Task Shot(string name,Vector3 target,Node3D subject,Node3D? focusNode=null)
        {
            var capture=new Camera3D{Name="NativeJourneyCapture",Fov=65,Near=.05f,Far=game.Cam.Far,CullMask=game.Cam.CullMask,Environment=game.Cam.Environment};game.World.AddChild(capture);
            Daylight.I!.SetTime(10);Daylight.I.Settle();
            try{
                for(int frame=0;frame<24;frame++){var aim=focusNode??subject;View(GodotObject.IsInstanceValid(aim)?aim.GlobalPosition:target,subject);capture.GlobalTransform=game.Cam.GlobalTransform;capture.MakeCurrent();await Frames(1);}
                string path=Path.Combine(output,name+".png");game.GetViewport().GetTexture().GetImage().SavePng(path);pictures.Add(name+".png");
                var focus=focusNode??subject;observations.Add(new{mode="capture",name,subject=subject.Name.ToString(),camera=capture.GlobalPosition.ToString(),target=focus.GlobalPosition.ToString(),inFront=!capture.IsPositionBehind(focus.GlobalPosition+Vector3.Up)});
            }finally{game.Cam.MakeCurrent();capture.QueueFree();Daylight.I.SetTime((float)GameState.I.HourF);Daylight.I.Settle();}
        }
        bool Physical(Node3D root,int minimum){var shapes=BakedWorld.All(root).OfType<CollisionShape3D>().Where(s=>!s.Disabled).ToArray();if(shapes.Length<minimum)return false;var space=root.GetWorld3D().DirectSpaceState;
            foreach(var shape in shapes){if(shape.GetParent() is not CollisionObject3D body||body.CollisionLayer==0)continue;var centre=shape.GlobalPosition;using var ray=PhysicsRayQueryParameters3D.Create(centre+Vector3.Up*3,centre-Vector3.Up*2,Solid.Layer);var hit=space.IntersectRay(ray);if(hit.Count>0&&hit["collider"].AsGodotObject()==body)return true;}return false;}
        Dictionary<string,Quaternion> LegPose(Puppet person){var result=new Dictionary<string,Quaternion>();var skeleton=BakedWorld.All(person.Human.Root).OfType<Skeleton3D>().First();for(int bone=0;bone<skeleton.GetBoneCount();bone++){string name=skeleton.GetBoneName(bone);if(name.Contains("leg",StringComparison.OrdinalIgnoreCase)||name.Contains("thigh",StringComparison.OrdinalIgnoreCase)||name.Contains("shin",StringComparison.OrdinalIgnoreCase)||name.Contains("foot",StringComparison.OrdinalIgnoreCase))result[name]=skeleton.GetBonePoseRotation(bone);}return result;}
        try{
            if(scope is not("full"or"cart-dray"or"cart-theft"or"boat"))throw new ArgumentException("native-journey-scope is full, cart-dray, cart-theft or boat");
            Check("journey proof uses its own disposable database",Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)&&Main.I.Flag("no-ai"));
            Check("native town and services become ready",await Until(()=>game.Loaded&&!Loading.Busy&&ServerLink.I?.Up==true&&GameState.I.Live&&game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count>500,100));
            float wheel=0;var api=ServerLink.I!.Api!;MainMenu.I?.Start();Jef.I.TestInput=true;Pause.Clear();var town=game.GetNode<Townspeople>("Townspeople");var journeys=ResidentJourneys.I!;
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=6,minute=0,weather="clear",money_c=1000}));Scheldemist.Movers.MoverClock.Hold(6,1);await Frames(20);await journeys.LoadTransport();await Velocipedes.I.Load();
            Check("source-authored vehicle and errand records reach native client",journeys.Transport is {} data&&data.Vehicles.Count>10&&data.Errands.Count>0);
            if(scope=="boat")goto familyBoat; // (issue 154: the family boat alone)
            if(scope=="cart-theft"){
                var leftovers=BakedWorld.All(game.World).OfType<Node3D>().Where(n=>n.HasMeta("source_node_index")&&n.GetMeta("source_node_index").AsInt32() is 4854 or 4867).ToArray();
                Check("both unowned quay snapshots stay preserved but hidden",leftovers.Length==2&&leftovers.All(n=>!n.IsVisibleInTree()));
                Check("hidden quay snapshots have no live collision",leftovers.SelectMany(BakedWorld.All).OfType<CollisionShape3D>().All(s=>s.Disabled));
                Scheldemist.Movers.MoverClock.Hold(8+8.5/60,1);await Frames(20);
                var round=Scheldemist.Movers.GoodsDrays.I!.Rigs.Single(r=>r.Id=="casks");
                Check("live Hessenatie dray has its carter and articulated horse",round.Man!=null&&round.Horse!=null&&round.Moving&&round.CartId=="dray:hessenatie");
                float gait=round.Gait;await Frames(30);Check("live dray horse animates on its working round",Math.Abs(round.Gait-gait)>.001);
                Scheldemist.Movers.MoverClock.Hold(6,1);
                ResidentVehicle? candidate=null;Vector2 approach=default;
                foreach(var vehicle in journeys.Transport!.Vehicles.Where(v=>v.Kind=="handcart"&&!v.Gone)){
                    View(new((float)vehicle.Home[0],0,(float)vehicle.Home[1]));await Frames(12);
                    if(journeys.CartSnapshot(vehicle.Id) is not {} snapshot||snapshot["in_use"]?.GetValue<bool>()==true)continue;
                    double cx=snapshot["x"]!.GetValue<double>(),cz=snapshot["z"]!.GetValue<double>(),cyaw=snapshot["yaw"]!.GetValue<double>();
                    var spot=NativeCartLoadingPoint.Select(new(cx,cz),cyaw,p=>town.Walk!.Free(p.X,p.Z)&&town.Walk.SupportsStep(p.X,p.Z,p.X,p.Z),_=>true);
                    if(spot==null)continue;approach=new((float)spot.Value.At.X,(float)spot.Value.At.Z);
                    if(Jef.I.Fly)Jef.I.ToggleFly();Jef.I.Place(approach.X,approach.Y,MathF.Atan2(approach.X-(float)cx,approach.Y-(float)cz),.15f);await Frames(12);
                    if(Interact.I.Find().Any(a=>a.Text=="steal "+vehicle.Label)){candidate=vehicle;break;}
                }
                Check("parked family cart exposes an actual theft prompt",candidate!=null);var cartId=candidate!.Id;
                Check("E takes the parked family handcart",Interact.I.Press(Key.E));
                Check("theft hands control to the playable cart",await Until(()=>Handcarts.I.Held==cartId&&!Handcarts.I.Busy,15));
                await journeys.LoadTransport();Check("taken cart is removed from its owner's transport",journeys.Transport!.Vehicles.Single(v=>v.Id==cartId).Gone);
                var playable=Handcarts.I.Drawings[cartId];await Shot("stolen-family-cart",playable.Root.GlobalPosition,playable.Root);
                if(Jef.I.Fly)Jef.I.ToggleFly();await Handcarts.I.Release(true,true);
                var created=await api.Post<JsonElement>("api/dev/job",new{type="carry",goods="rope",items=1,cart=true});int jobId=created.GetProperty("id").GetInt32();
                GameState.I.Apply(await api.Get<JobsPayload>("api/jobs"));await Jobs.I.TakeJob(GameState.I.Jobs.Single(j=>j.Id==jobId));Goods.I.RefreshCartGoods();
                Check("real carry goods become available",await Until(()=>Goods.I.All.Values.Any(i=>i.JobId==jobId),10));
                var goodsItem=Goods.I.All.Values.First(i=>i.JobId==jobId);Jef.I.Place(goodsItem.X+.7f,goodsItem.Z+.7f,0);await Frames(12);Goods.I.Lift(goodsItem);
                Check("goods lifted into player's hands",await Until(()=>Goods.I.Carried?.Id==goodsItem.Id,10));
                Jef.I.Place(playable.X+1.8f,playable.Z,MathF.PI/2,.1f);await Frames(12);await Handcarts.I.LoadGoods(playable,goodsItem);
                Check("stolen handcart loads an original good",playable.Info.Load.Any(i=>i.Gid==goodsItem.Id)&&Goods.I.Carried==null);
                await Handcarts.I.Unload(playable);Check("stolen handcart unloads the same good",Goods.I.Carried?.Id==goodsItem.Id&&!playable.Info.Load.Any(i=>i.Gid==goodsItem.Id));
                stages.Add("quay snapshots, live dray, cart theft and cargo");return;
            }
            var bike=journeys.Transport!.Vehicles.First(v=>v.Kind=="velocipede"&&!v.Gone&&town.ActionPerson(v.Owner) is {R.Age:>=15 and <60,ActionHeld:false}&&Velocipedes.I.Machines.ContainsKey(v.Id));
            var cyclist=town.ActionPerson(bike.Owner)!;var machine=Velocipedes.I.Machines[bike.Id];var start=new Vector3(machine.Info.X,0,machine.Info.Z);View(start,machine.Root);await Frames(30);
            var source=new Vector2(start.X,start.Z);Vector2 rideTo=default;List<Vector2>? rideWay=null;string rideLabel="";
            var goals=bike.Parks.Where(p=>p.Key!="home").Select(p=>(Label:"owned parking:"+p.Key,At:new Vector2((float)p.Value[0],(float)p.Value[1]))).Concat(town.Data!.Places.OrderBy(p=>p.Key,StringComparer.Ordinal).Select(p=>(Label:p.Key,At:Ways.NearestOpen(p.Value.X,p.Value.Z,6)??new Vector2(float.NaN,float.NaN))));
            foreach(var goal in goals){if(!float.IsFinite(goal.At.X)||source.DistanceTo(goal.At)<=310||!Ways.Reachable(goal.At.X,goal.At.Y))continue;var way=Ways.Path(source,goal.At);if(way==null||way.Count<2)continue;rideTo=goal.At;rideWay=way;rideLabel=goal.Label;break;}
            Check("bicycle long destination has an authoritative native supported route",rideWay!=null);observations.Add(new{mode="bicycle_route",landmark=rideLabel,destination=new[]{rideTo.X,rideTo.Y},distance=source.DistanceTo(rideTo),routeLength=Ways.Length(rideWay!),route=rideWay!.Select(p=>new[]{p.X,p.Y}).ToArray()});
            string chosen=journeys.JourneyTestGo(cyclist.R.Id,rideTo,fromHome:true);Check("real engine chooses owned bicycle for long trip",chosen=="velocipede");
                        bool fetched=await Until(()=>cyclist.P?.NetworkVehicle==1&&town.Crowd!.PuppetVehicleDistance(cyclist.P)>1,45);observations.Add(new{mode="bicycle_fetch",seed=town.Data!.Seed,bike=bike.Id,cyclist.R.Id,cyclist.R.Kind,home=new[]{cyclist.R.HomeSx,cyclist.R.HomeSz},park=bike.Home,phase=cyclist.Journey?.Phase,time=cyclist.Journey?.Time,fetch=cyclist.Journey?.Fetch,destination=cyclist.Journey?.To.ToString(),position=new[]{cyclist.P?.X??cyclist.X,cyclist.P?.Z??cyclist.Z},vehicle=cyclist.P?.NetworkVehicle,distance=cyclist.P==null?0:town.Crowd!.PuppetVehicleDistance(cyclist.P),pace=cyclist.P?.Pace,state=cyclist.P?.State,route=cyclist.P==null?null:(Crowd.MovementSnapshot?)town.Crowd!.PuppetMovement(cyclist.P),held=cyclist.ActionHeld,owner=cyclist.ActionOwner?.GetType().Name,inside=cyclist.Inside,shoreShown=cyclist.P?.Shown,currentSupported=town.Walk!.PathFree(cyclist.P?.X??cyclist.X,cyclist.P?.Z??cyclist.Z),parkSupported=town.Walk.PathFree(bike.Home[0],bike.Home[1]),parkedVisible=machine.Root.Visible,parkedLayer=machine.Solid.CollisionLayer,notes=journeys.Notes.ToArray()});Check("resident fetches bicycle and starts pedalling",fetched);var bicycle=town.Crowd!.PuppetVehicleNode(cyclist.P!)!;
            var front=BakedWorld.All(bicycle).OfType<Node3D>().First(n=>n.Name=="velocipede_front");var rear=BakedWorld.All(bicycle).OfType<Node3D>().First(n=>n.Name=="velocipede_rear");wheel=front.Rotation.X;double moved=town.Crowd.PuppetVehicleDistance(cyclist.P!);var animationBefore=cyclist.P!.Human.AnimationState;var legsBefore=LegPose(cyclist.P);double jointChange=0;for(int frames=0;frames<60;frames+=6){await Frames(6);jointChange=Math.Max(jointChange,LegPose(cyclist.P).Where(b=>legsBefore.ContainsKey(b.Key)).Select(b=>(double)b.Value.AngleTo(legsBefore[b.Key])).DefaultIfEmpty(0).Max());}
            Check("bicycle rider and both wheels move with distance",cyclist.P!.Human.Motion=="ride"&&town.Crowd.PuppetVehicleDistance(cyclist.P)>moved+.25&&Math.Abs(front.Rotation.X-wheel)>.25&&Math.Abs(rear.Rotation.X)>.1);
            var animationAfter=cyclist.P.Human.AnimationState;var legsAfter=LegPose(cyclist.P);double expectedCycle=(town.Crowd.PuppetVehicleDistance(cyclist.P)/.46/Math.Tau)%1;double observedCycle=animationAfter.Cycle-Math.Floor(animationAfter.Cycle);double cycleGap=Math.Abs(observedCycle-expectedCycle);cycleGap=Math.Min(cycleGap,1-cycleGap);
            observations.Add(new{mode="bicycle_animation",before=animationBefore,after=animationAfter,bones=legsAfter.Keys.ToArray(),jointChange,expectedCycle,cycleGap});
            Check("rider keeps actual ride clip without restarting walk blends",animationAfter.Clip?.StartsWith("ride",StringComparison.Ordinal)==true&&animationAfter.ClipChanges-animationBefore.ClipChanges<=2);
            Check("rider leg joints pedal with actual distance driven cycle",legsAfter.Count>=4&&jointChange>.04&&cycleGap<.025);
            var ridePose=RidePose(cyclist.P,bicycle);observations.Add(new{mode="bicycle_seating",pose=ridePose,animation=cyclist.P.Human.AnimationState});
            Check("phase-controlled rider reaches both actual handlebar grips",ridePose.LeftGripGap is <.25&&ridePose.RightGripGap is <.25&&animationAfter.PhaseControlled);
            Check("rider hips sit over saddle and torso leans toward bars",ridePose.HipHorizontalGap is <.2&&ridePose.HipAboveSaddle is >=0 and <.23&&ridePose.ForwardLean is >.12 and <.55);
            Check("bicycle is drawn once while ridden by its owner",!machine.Root.Visible&&machine.Solid.CollisionLayer==0&&bicycle.IsInsideTree());observations.Add(new{mode="bicycle",cyclist.R.Id,distance=town.Crowd.PuppetVehicleDistance(cyclist.P),model=bicycle.Name.ToString()});await Shot("resident-bicycle",bicycle.GlobalPosition,bicycle);
            journeys.JourneyTestCancel(cyclist.R.Id);await Frames(5);observations.Add(new{mode="bicycle_cancel",journeyCleared=cyclist.Journey==null,vehicle=cyclist.P?.NetworkVehicle,parkedVisible=machine.Root.Visible,parkedLayer=machine.Solid.CollisionLayer,travellingFreed=!GodotObject.IsInstanceValid(bicycle),observerDistance=new Vector2(machine.Info.X-Jef.I.X,machine.Info.Z-Jef.I.Z).Length()});Check("bicycle cancellation releases gear and restores parked collision",cyclist.Journey==null&&cyclist.P?.NetworkVehicle is null or 0&&machine.Root.Visible&&machine.Solid.CollisionLayer!=0&&!GodotObject.IsInstanceValid(bicycle));
            stages.Add("bicycle");
            var cart=journeys.Transport.Vehicles.First(v=>v.Kind=="handcart"&&!v.Gone&&town.ActionPerson(v.Owner) is {ActionHeld:false}&&town.Sims.Any(s=>s.R.Id!=v.Owner&&s.R.Household==v.Household&&s.R.Age>=10&&s.Inside&&!s.ActionHeld));var carter=town.ActionPerson(cart.Owner)!;View(new((float)cart.Home[0],0,(float)cart.Home[1]));await Frames(30);
            var cartDoor=new Vector2((float)carter.R.HomeSx,(float)carter.R.HomeSz);Vector2 cartTo=default;List<Vector2>? cartWay=null;string cartLabel="";
            var cartGoals=cart.Parks.Where(p=>p.Key!="home").Select(p=>(Label:"owned parking:"+p.Key,At:new Vector2((float)p.Value[0],(float)p.Value[1]))).Concat(town.Data!.Places.OrderBy(p=>p.Key,StringComparer.Ordinal).Select(p=>(Label:p.Key,At:Ways.NearestOpen(p.Value.X,p.Value.Z,6)??new Vector2(float.NaN,float.NaN))));
            foreach(var goal in cartGoals){if(!float.IsFinite(goal.At.X)||cartDoor.DistanceTo(goal.At)<10||!town.Walk!.SupportsStep(goal.At.X,goal.At.Y,goal.At.X,goal.At.Y))continue;var way=Ways.NativePath(town.Walk,cartDoor,goal.At);if(way is not{Count:>0}||!town.Walk.SupportsStep(cartDoor.X,cartDoor.Y,way[0].X,way[0].Y)||!town.Walk.SupportsStep(way[^1].X,way[^1].Y,goal.At.X,goal.At.Y))continue;cartTo=goal.At;cartWay=way;cartLabel=goal.Label;break;}
            Check("handcart destination has a supported native route",cartWay!=null);observations.Add(new{mode="cart_route",cart=cart.Id,carter.R.Id,landmark=cartLabel,destination=new[]{cartTo.X,cartTo.Y},route=cartWay!.Select(q=>new[]{q.X,q.Y}).ToArray()});
            chosen=journeys.JourneyTestGo(carter.R.Id,cartTo,new("goods",3));Check("load chooses actual household handcart before distance",chosen=="handcart");var cartTrip=carter.Journey!;Check("eligible household helper joins source loading plan",cartTrip.Helpers.Count>0);
            object CarrierLoadingState(string id,ResidentJourneys.Carrier carrier){var person=town.ActionPerson(id);var puppet=person?.P;double x=puppet?.X??person?.X??double.NaN,z=puppet?.Z??person?.Z??double.NaN;return new{id,carrier.Step,carrier.Go,carrier.Wait,carrier.Time,position=new[]{x,z},toDoor=new Vector2((float)x,(float)z).DistanceTo(cartTrip.Door),toBed=cartTrip.HasBed?(double?)new Vector2((float)x,(float)z).DistanceTo(cartTrip.Bed):null,inside=person?.Inside,inTrip=person?.InTrip,held=person?.ActionHeld,owner=person?.ActionOwner?.GetType().Name,shown=puppet?.Shown,loaded=puppet?.Loaded,vehicle=puppet?.NetworkVehicle,cargo=puppet?.NetworkLoad,state=puppet?.State,yaw=puppet?.Yaw,route=puppet==null?null:(Crowd.MovementSnapshot?)town.Crowd!.PuppetMovement(puppet)};}
            object LoadingPoint(Vector2 at)=>new{position=new[]{at.X,at.Y},staticSupported=town.Walk!.SupportsStep(at.X,at.Y,at.X,at.Y),liveFree=town.Walk.Free(at.X,at.Y),stand=town.Crowd!.CanStand(at.X,at.Y)};
            object LoadingState(string checkpoint)=>new{checkpoint,phase=cartTrip.Phase,time=cartTrip.Time,cartTrip.Loaded,requested=cartTrip.Load?.Items,cartTrip.BedRecovered,loadingSeconds=cartTrip.LoadingFinishedAt,door=LoadingPoint(cartTrip.Door),bed=cartTrip.HasBed?LoadingPoint(cartTrip.Bed):null,fetch=cartTrip.Fetch,own=CarrierLoadingState(carter.R.Id,cartTrip.Own),helpers=cartTrip.Helpers.Select(h=>CarrierLoadingState(h.Id,h)).ToArray()};
            observations.Add(new{mode="cart_loading_start",seed=town.Data!.Seed,cart=cart.Id,carter.R.Id,carter.R.Name,cart.Home,state=LoadingState("start")});
            bool helperVisible=false,carried=false;var loadingSamples=new List<object>();var deadline=DateTime.UtcNow.AddSeconds(60);var nextSample=DateTime.UtcNow;int lastLoaded=-1;while(DateTime.UtcNow<deadline&&carter.P?.NetworkVehicle!=2){helperVisible|=cartTrip.Helpers.Any(h=>town.ActionPerson(h.Id)?.P is {Shown:true});carried|=carter.P?.Loaded==true||cartTrip.Helpers.Any(h=>town.ActionPerson(h.Id)?.P?.Loaded==true);if(DateTime.UtcNow>=nextSample||cartTrip.Loaded!=lastLoaded){loadingSamples.Add(LoadingState("loading"));nextSample=DateTime.UtcNow.AddSeconds(3);lastLoaded=cartTrip.Loaded;}await Frames(3);}
            observations.Add(new{mode="cart_loading",helperVisible,carried,samples=loadingSamples.ToArray(),final=LoadingState("before assertions")});
            Check("family carries actual visible loads out to handcart",helperVisible&&carried);
            Check("handcart departs with its actual delivered cargo",carter.P?.NetworkVehicle==2&&cartTrip.Loaded>0&&cartTrip.Loaded<=3&&carter.P.NetworkLoad==cartTrip.Loaded);
            Check("partial loading waits for the original forty-second timeout",cartTrip.Loaded==3||cartTrip.LoadingFinishedAt is >40 and <=40.11);
            var cartNode=town.Crowd.PuppetVehicleNode(carter.P!)!;await Frames(12);Check("handcart and shafts have real solid physics",Physical(cartNode,2));
            var wheels=BakedWorld.All(cartNode).OfType<Node3D>().First(n=>n.Name=="tr_handcart_wheels");wheel=wheels.Rotation.X;moved=town.Crowd.PuppetVehicleDistance(carter.P!);await Frames(60);Check("loaded handcart rolls on its wheels while pushed",carter.P!.Human.Motion is "push" or "walk"&&town.Crowd.PuppetVehicleDistance(carter.P)>moved+.2&&Math.Abs(wheels.Rotation.X-wheel)>.1);
            observations.Add(new{mode="cart",carter.R.Id,cartTrip.Loaded,helpers=cartTrip.Helpers.Select(h=>h.Id).ToArray(),physicsShapes=BakedWorld.All(cartNode).OfType<CollisionShape3D>().Count()});await Shot("resident-family-cart",cartNode.GlobalPosition,cartNode);journeys.JourneyTestCancel(carter.R.Id);await Frames(5);Check("cart ending clears helper holds and disposes travelling rig",carter.Journey==null&&!GodotObject.IsInstanceValid(cartNode)&&cartTrip.Helpers.All(h=>town.ActionPerson(h.Id)?.InTrip!=true));
            stages.Add("handcart");
            var dray=journeys.Transport.Vehicles.First(v=>v.Kind=="dray"&&journeys.Transport.Errands.Any(e=>e.Vehicle==v.Id)&&town.ActionPerson(v.Owner) is {ActionHeld:false});var driver=town.ActionPerson(dray.Owner)!;var yard=Scheldemist.Movers.Traffic.I!.ResidentYards().First(y=>y.Route==dray.Route);View(new(yard.At.X,0,yard.At.Y));await Frames(30);var drayApproach=town.Crowd!.OpenNearFree(yard.At.X+Math.Sin(yard.Yaw)*8,yard.At.Y+Math.Cos(yard.Yaw)*8);Check("dray approach has actual supported ground",drayApproach!=null);Check("real dray errand starts from its native yard",journeys.JourneyTestErrand(dray.Id,from:new Vector2((float)drayApproach!.Value.x,(float)drayApproach.Value.z)));
            bool drayMoved=await Until(()=>driver.P?.NetworkVehicle==3&&town.Crowd.PuppetVehicleDistance(driver.P)>1,80);observations.Add(new{mode="dray_fetch",driver.R.Id,phase=driver.Journey?.Phase,time=driver.Journey?.Time,position=new[]{driver.P?.X??driver.X,driver.P?.Z??driver.Z},yard=new[]{yard.At.X,yard.At.Y},destination=driver.Journey?.To.ToString(),vehicle=driver.P?.NetworkVehicle,pace=driver.P?.Pace,state=driver.P?.State,path=driver.P==null?0:town.Crowd.PuppetMovement(driver.P).PathCount,pathIndex=driver.P==null?0:town.Crowd.PuppetMovement(driver.P).PathIndex,replans=driver.P==null?0:town.Crowd.PuppetMovement(driver.P).Replans,distance=driver.P==null?0:town.Crowd.PuppetVehicleDistance(driver.P),held=driver.ActionHeld,remote=driver.P?.Remote,notes=journeys.Notes.ToArray()});Check("driver fetches horse dray and starts haul",drayMoved);var drayNode=town.Crowd.PuppetVehicleNode(driver.P!)!;await Frames(12);Check("articulated dray and horse have real solid bodies",Physical(drayNode,2));
            var horse=BakedWorld.All(drayNode).OfType<Node3D>().First(n=>n.Name=="tr_horse_body");var leg=BakedWorld.All(drayNode).OfType<Node3D>().First(n=>n.Name.ToString().StartsWith("tr_leg_front",StringComparison.Ordinal));float legAngle=leg.Rotation.X;var horseAt=horse.GlobalPosition;await Frames(50);Check("horse walks and separate front/rear axles roll",horse.GlobalPosition.DistanceTo(horseAt)>.2&&Math.Abs(leg.Rotation.X-legAngle)>.001&&BakedWorld.All(drayNode).OfType<Node3D>().Any(n=>n.Name=="tr_wheels_rear"&&Math.Abs(n.Rotation.X)>.1));
            observations.Add(new{mode="dray",driver.R.Id,physicsShapes=BakedWorld.All(drayNode).OfType<CollisionShape3D>().Count(),horsePosition=horse.GlobalPosition.ToString()});await Shot("resident-horse-dray",horse.GlobalPosition,drayNode,horse);journeys.JourneyTestCancel(driver.R.Id);await Frames(5);Check("dray ending removes horse rig and restores round ownership",driver.Journey==null&&!GodotObject.IsInstanceValid(drayNode));
            stages.Add("dray");
            if(scope=="cart-dray")return;
            familyBoat:
            ResidentVehicle? boat=null;ResidentErrand? familyErrand=null;
            for(int boatDay=1;boatDay<=6&&boat==null;boatDay++){GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=boatDay,hour=6,minute=0,weather="clear"}));Scheldemist.Movers.MoverClock.Hold(6,boatDay);await Frames(12);await journeys.LoadTransport();await Until(()=>journeys.Transport?.Day==boatDay,12);familyErrand=journeys.Transport?.Errands.FirstOrDefault(e=>e.Kind=="boat"&&e.Who.Count>=2&&e.Who.All(id=>town.ActionPerson(id) is {ActionHeld:false}));if(familyErrand!=null)boat=journeys.Transport!.Vehicles.FirstOrDefault(v=>v.Id==familyErrand.Vehicle);}
            Check("published weekday errand supplies a real family crew",boat!=null&&familyErrand!=null);observations.Add(new{mode="boat_selection",day=journeys.Transport!.Day,id=boat!.Id,expectedCrew=familyErrand!.Who.ToArray()});
            var rower=town.ActionPerson(boat.Owner)!;View(new((float)boat.Boat!.Flight[0],0,(float)boat.Boat.Flight[1]));await Frames(20);Check("family boat chooses an actual open-water path",journeys.JourneyTestErrand(boat.Id));
            var boatTrip=rower.Journey!;Check("family reaches berth and boards owned boat",await Until(()=>boatTrip.Phase=="row"&&Rowing.I.Drawings.ContainsKey("town:"+boat.Id),65));var hull=Rowing.I.Drawings["town:"+boat.Id];var crew=boatTrip.BoatTrip!.Crew;
            // (issue 154) the family walks down the steps and takes their places before she casts off
            bool walking=!Rowing.I.ResidentWalkersDone(boat.Id);var cast=new Vector2(hull.X,hull.Z);await Shot("resident-family-boarding",new Vector3(hull.X,0,hull.Z),hull.Root);bool boarded=await Until(()=>Rowing.I.ResidentWalkersDone(boat.Id),45);
            Check("family walks down the steps into the boat before she casts off",walking&&boarded&&new Vector2(hull.X,hull.Z).DistanceTo(cast)<.3f);observations.Add(new{mode="boat_boarding",crew=crew.ToArray(),members=crew.Select(id=>new{id,aboard=town.ActionPerson(id)?.Aboard,inTrip=town.ActionPerson(id)?.InTrip,shoreBody=town.ActionPerson(id)?.P!=null}).ToArray(),crewModels=BakedWorld.All(hull.Root).OfType<Node3D>().Where(n=>n.Name.ToString().StartsWith("crew_",StringComparison.Ordinal)).Select(n=>n.Name.ToString()).ToArray()});Check("family is drawn aboard once rather than on shore",crew.Count>1&&crew.All(id=>town.ActionPerson(id)?.Aboard==true&&town.ActionPerson(id)?.P==null)&&BakedWorld.All(hull.Root).OfType<Node3D>().Count(n=>n.Name.ToString().StartsWith("crew_",StringComparison.Ordinal))==Math.Min(3,crew.Count));
            View(new(hull.X,0,hull.Z));await Frames(10);var position=new Vector2(hull.X,hull.Z);wheel=hull.Pivot[0].Rotation.Y;await Frames(80);Check("owned family boat rows with real oars and occupants",new Vector2(hull.X,hull.Z).DistanceTo(position)>.3&&Math.Abs(hull.Pivot[0].Rotation.Y-wheel)>.01&&hull.Oars.Visible);observations.Add(new{mode="boat",rower.R.Id,crew,path=boatTrip.BoatTrip.Path.Length,position=new[]{hull.X,hull.Z}});await Shot("resident-family-boat",new Vector3(hull.X,0,hull.Z),hull.Root);
            // and step out onto the landing and up the steps to the quay when she comes in
            var top=new Vector2((float)boat.Boat.Flight[0],(float)boat.Boat.Flight[1]);Rowing.I.ResidentBoatLand(boat.Id,top);bool landing=!Rowing.I.ResidentWalkersDone(boat.Id);await Frames(90);await Shot("resident-family-landing",new Vector3(top.X,0,top.Y),hull.Root);bool landed=await Until(()=>Rowing.I.ResidentWalkersDone(boat.Id),45);
            var ashore=crew.Take(3).Select(id=>BakedWorld.All(Main.I.View).OfType<Node3D>().FirstOrDefault(n=>n.Name.ToString()=="crew_"+id)).Where(n=>n!=null).Select(n=>n!.GlobalPosition).ToArray();
            Check("family steps out and walks up the steps to the quay",landing&&landed&&ashore.Length==Math.Min(3,crew.Count)&&ashore.All(p=>p.Y>-.3f&&new Vector2(p.X,p.Z).DistanceTo(top)<4));observations.Add(new{mode="boat_landing",ashore=ashore.Select(p=>new[]{p.X,p.Y,p.Z}).ToArray()});
            journeys.JourneyTestCancel(rower.R.Id);await Frames(5);Check("boat ending releases every family member and travelling hull",rower.Journey==null&&crew.All(id=>town.ActionPerson(id)?.InTrip!=true&&town.ActionPerson(id)?.Aboard!=true)&&!Rowing.I.Drawings.ContainsKey("town:"+boat.Id));
            Rowing.I.ResidentBoatOut(boat.Id,boat.Boat.Kind,boatTrip.BoatTrip.Path,Array.Empty<(string Id,string Kind)>(),0);var moored=new Vector3(hull.X,hull.Z,hull.Yaw);Rowing.I.ResidentBoatEnd(boat.Id,moored,false);var boatState=Rowing.I.ResidentNetState();Check("shared world includes landed family boat and hidden home berth",boatState["lying"]!.AsArray().Any(n=>n?["id"]?.GetValue<string>()==boat.Id)&&boatState["_homes"]!.AsArray().Any(n=>n?["id"]?.GetValue<string>()==boat.Id));Rowing.I.ResidentNetApply(boatState,0);Check("landed family hull survives native world replica roundtrip",Rowing.I.Drawings.TryGetValue("town:"+boat.Id,out var mooring)&&!mooring.Oars.Visible&&new Vector2(mooring.X,mooring.Z).DistanceTo(new(moored.X,moored.Y))<.01f);Rowing.I.ResidentBoatEnd(boat.Id,null,true);Check("returning family boat clears replica and restores home berth",!Rowing.I.Drawings.ContainsKey("town:"+boat.Id)&&!Rowing.I.ResidentNetState()["_homes"]!.AsArray().Any(n=>n?["id"]?.GetValue<string>()==boat.Id));
            stages.Add("family boat");if(scope=="boat")return;
        }catch(Exception ex){error=ex.ToString();GD.PushError("native journey proof: "+error);}
        finally{File.WriteAllText(Path.Combine(output,"native-journeys.json"),JsonSerializer.Serialize(new{ok=error=="",scope,stages,error,checks,observations,pictures},new JsonSerializerOptions(Api.Json){WriteIndented=true}));}
        if(error!="")throw new InvalidOperationException(error);
    }
}







