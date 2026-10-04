using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Movers;
using Scheldemist.Windows;

namespace Scheldemist.Play;

/// <summary>Bounded server-backed transport check. Unsupported features remain explicit in its report.</summary>
[GamePart(992)]
public partial class RideTest : Node
{
    private string dir = "";
    private readonly List<object> checks = new(), replies = new();
    private readonly List<string> pictures = new();
    public override void _Ready()
    {
        dir = Main.I.Arg("ridetest");
        if (dir == "") return;
        dir = Path.GetFullPath(dir);
        Directory.CreateDirectory(dir);
        _ = Run();
    }
    private async Task Run()
    {
        string error = "";
        try
        {
            if (!Main.I.Flag("no-ai") || Paths.Database != Path.Combine(dir, "test.sqlite")) throw new InvalidOperationException("ridetest needs --no-ai and --db <dir>/test.sqlite");
            Require(await Until(() => ServerLink.I?.Up == true && GameState.I.Live, 100), "server ready");
            var api = ServerLink.I!.Api!;
            Require(await Until(()=>Main.I.Loaded&&!Scheldemist.Menu.Loading.Busy,100),"town loading screen finished");
            if(Scheldemist.Menu.MainMenu.I is {} menu){Scheldemist.Menu.Prefs.Set("benchDone",true,true);menu.Start();menu.SetProcess(false);Scheldemist.Menu.Pause.Clear();}
            Jef.I.TestInput = true;
            GameState.I.PlayingWhen = () => false;
            Dialogs.I!.KeepMouse = true;
            await api.Post<OkReply>("api/arrival/ashore");
            Jef.I.Place(-118, 36, 0);
            if(Main.I.Arg("ride-only")=="cart") {await HandcartCheck(api);return;}
            if(Main.I.Arg("ride-only")=="velo") {await VeloCheck(api);return;}
            if(Main.I.Arg("ride-only")=="row") {await RowCheck(api);return;}
            if(Main.I.Arg("ride-only")=="ship") {await ShipCheck(api);return;}
            if(Main.I.Arg("ride-only")=="water") {await ShipCheck(api);await FerryCheck(api);return;}
            if(Main.I.Arg("ride-only")=="ferry") {await FerryCheck(api);return;}
            if(Main.I.Arg("ride-only")=="ferry-scenarios") {await FerryScenarios(api);return;}
            if(Main.I.Arg("ride-only")=="saved-rides") {await OmnibusCheck(api);await HandcartCheck(api);await VeloCheck(api);await SavedRowCheck(api);return;}
            if(Main.I.Arg("ride-only")=="expiry") {await HireExpiryCheck(api);return;}
            if(Main.I.Arg("ride-only")=="crane") {await CraneCheck();return;}
            if(Main.I.Arg("ride-only")=="omnibus") {await OmnibusCheck(api);return;}
            if(Main.I.Arg("ride-only")=="saved-row") {await SavedRowCheck(api);return;}
            if(Main.I.Arg("ride-only")=="navigation") {await NavigationCheck(api);return;}
            foreach (float height in new[] { 2.99f, 3, 5, 8, 12 })
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour = 13, minute = 45, weather = "clear", health = 10 }));
                int expected = height < 3 ? 0 : height < 5 ? 1 : height < 8 ? 2 : height < 12 ? 3 : 4;
                var r = await Falls.I.Report(height, false);
                replies.Add(new { height, water = false, reply = r });
                Require(r != null && r.Hurt == expected && r.Player.Health == 10 - expected, $"stone fall {height} m");
                if (height >= 3) await Shot("fall-" + height);
                var wet = await Falls.I.Report(height, true);
                replies.Add(new { height, water = true, reply = wet });
                Require(wet != null && wet.Hurt == 0 && wet.Player.Health == 10 - expected, $"water takes {height} m fall");
            }
            // Physical landing, not a direct call: the ordinary walker emits the height once.
            int landed = 0; float measured = 0;
            void Fell(float height, bool water, FallReply reply) { landed++; measured = height; replies.Add(new { physicalFall = new { height, water, reply } }); }
            Falls.I.Answered += Fell;
            Jef.I.Place(-118, 36, 0); await Frames(10);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { health = 10 }));
            Jef.I.Y += 5.2f;
            Require(await Until(() => landed > 0, 8), "physical fall reaches server");
            await Frames(25);
            Require(landed == 1 && measured >= 5 && measured < 5.5 && GameState.I.Payload!.Player.Health == 8, "physical landing reports once with measured height");
            Falls.I.Answered -= Fell;
            await OmnibusCheck(api);
            await CraneCheck();
            await HandcartCheck(api);
            await VeloCheck(api);
            await RowCheck(api);
            await SavedRowCheck(api);
            await ShipCheck(api);
            await FerryCheck(api);
            await HireExpiryCheck(api);
            await FerryScenarios(api);
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr("ridetest: " + error); }
        finally
        {
            try { File.WriteAllText(Path.Combine(dir, "ridetest.json"), JsonSerializer.Serialize(new { ok = error == "", error, selection=Main.I.Arg("ride-only"), checks, replies, pictures, incomplete = new[] { "household taking and furniture handoffs", "all hulls and street routes", "all boat ladder approaches and saved crane rungs", "two-client remote rides and guest ferry creator", "auditory review of ride sounds", "named household journeys and prisoner room movement" } }, new JsonSerializerOptions(Api.Json) { WriteIndented = true })); }
            catch(Exception report){error=report.ToString();GD.PrintErr("ridetest report: "+error);}
            finally{GetTree().Quit(error == "" ? 0 : 1);}
        }
    }
    private async Task NavigationCheck(Api api)
    {
        MoverClock.Hold(13.75,1);
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{hour=13,minute=45,weather="clear",money_c=2000,health=10}));await Rowing.I.Load();var row=Rowing.I;row.Answered+=(action,reply)=>replies.Add(new{rowing=action,reply});var landing=row.Data.Landings.First(l=>l.Id=="vismarkt");
        Jef.I.Place(landing.Landing[0],landing.Landing[1],0);await row.Hire(landing);Require(row.Boat!=null,"navigation check hires a real boat");row.RiderTestHeadroom=4;RowPose(row,-76,-14,0);await Frames(5);
        var bridge=Bridges.I.List.First(b=>b.Key=="canal_mouth");Require(bridge.Boats.Contains("rower"),"rower hails bridge keeper when headroom is too low");Require(row.Rower.Blocked(row,-76,6,0),"closed bridge refuses a boat that cannot fit underneath");Require(await Until(()=>bridge.Open>.97f,40),"bridge keeper opens real lifting leaves for rower");Jef.I.Yaw=MathF.PI;Jef.I.Pitch=-.25f;await Shot("rowing-bridge");row.RiderTestHeadroom=0;RowPose(row,-76,6,0);await Frames(3);Require(row.Boat!=null&&!row.Rower.Blocked(row,-76,6,0),"raised bridge clears the whole rowing hull");
        RowPose(row,landing.X,landing.Z,landing.Yaw);await Frames(3);await row.Leave(row.ExitHere());Require(!bridge.Boats.Contains("rower"),"leaving boat releases its bridge request");Require(await Until(()=>!Jef.I.Climbing,15),"navigation boat docks ashore");
        Jef.I.Place(landing.Landing[0],landing.Landing[1],0);await row.Hire(landing);RowPose(row,110,-16,0);await Frames(5);Require(row.Rower.Blocked(row,110,7,0),"shut near lock gates refuse the boat");Require(await Until(()=>Mv.Smooth(Lock.I.GateOpen(0))>.95f,65),"lock keeper opens near gates at the river level");RowPose(row,110,15,0);await Frames(5);Require(await Until(()=>Mv.Smooth(Lock.I.GateOpen(1))>.95f&&Lock.I.GateOpen(0)<.01f,80),"rower in chamber makes keeper shut near gates and open far gates");Jef.I.Pitch=-.25f;await Shot("rowing-lock");
        RowPose(row,landing.X,landing.Z,landing.Yaw);await Frames(3);await row.Leave(row.ExitHere());Require(await Until(()=>!Jef.I.Climbing,15),"lock test boat returns ashore");
        Jef.I.Place(landing.Landing[0],landing.Landing[1],0);await row.Hire(landing);bridge.Amount=0;bridge.Draw!.Set(0);row.RiderTestHeadroom=4;RowPose(row,-76,6,0);Require(await Until(()=>row.Boat==null&&!row.Busy,10),"closing deck crushes a boat under insufficient headroom");row.RiderTestHeadroom=0;Require(row.Data.Hire==null&&Jef.I.Swimming,"server prices lost boat and puts rower in water");replies.Add(new{afterBridgeWreck=await api.RowWorld()});Jef.I.Place(-118,36,0);
        Jef.I.Place(landing.Landing[0],landing.Landing[1],0);await row.Hire(landing);var traffic=River.I.Movers.First(m=>m.Parts.Any(p=>Boats.I.Dims(p.Boat.Kind).Beam>2&&p.Boat.Outer.Visible));var ship=traffic.Parts.First(p=>Boats.I.Dims(p.Boat.Kind).Beam>2&&p.Boat.Outer.Visible);var hit=ship.Boat.Inner.GlobalPosition;RowPose(row,hit.X,hit.Z,0);Require(await Until(()=>row.Boat==null&&!row.Busy,10),"moving ship runs down overlapping rowboat");Require(row.Data.Hire==null&&Jef.I.Swimming,"ship wreck is priced by server and leaves rower swimming");replies.Add(new{afterShipWreck=await api.RowWorld()});Jef.I.Place(-118,36,0);
    }
    private static void RowPose(Rowing row,float x,float z,float yaw)
    {row.Rower.X=x;row.Rower.Z=z;row.Rower.Y=World.BoatWater.At(x,z);row.Rower.Heading=yaw;row.Rower.Speed=row.Rower.Turn=0;}
    private async Task ShipCheck(Api api)
    {
        MoverClock.Hold(13.75,1);
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{hour=13,minute=45,weather="clear",health=10}));
        var ships=ShipWalk.I;Require(ships.Decks.Count>10,"live ship decks loaded from model floors");
        Jef.I.Place(-42,1.4f,0,-.3f);await Frames(10);Jef.I.SetKey(Key.W,true);Require(await Until(()=>ships.On?.Kind=="brig",10),"Anna Maria gangway is reachable on foot from quay");Jef.I.ClearKeys();await Shot("ship-gangway");Jef.I.Yaw=MathF.PI;Jef.I.SetKey(Key.W,true);bool walkedBack=await Until(()=>!Jef.I.Riding&&Jef.I.Z>.15f,10);replies.Add(new{brigGangway=ships.RiderTestGangway()});Require(walkedBack,"walk back off tide deck onto quay without jumping");Jef.I.ClearKeys();
        var d=ships.Decks.First(d=>d.Kind=="hengst"&&d.Visible());var p=d.Mesh.Nearest(new(d.Mesh.MinX+.5f,0));var at=d.At(p);replies.Add(new{shipApproach=new{d.Kind,p.X,p.Y,at}});
        var xf=d.World();var off=xf*new Vector3(d.Mesh.MinX-.35f,0,p.Y);Jef.I.DropFromBoat(new(off.X,World.Water.Level(off.X,off.Z)-.3f,off.Z));Jef.I.Yaw=MathF.Atan2(Jef.I.X-at.X,Jef.I.Z-at.Z);Jef.I.Pitch=.25f;await Frames(3);await Shot("ship-swim");
        Require(Interact.I.Find().Any(a=>a.Text=="climb onto the ship"),"ship climb prompt in view from water");Require(Interact.I.Press(Key.E),"E from water climbs onto low ship deck");Require(await Until(()=>ships.On!=null&&!Jef.I.Climbing,10),"climb lands on ship model boards");d=ships.On!;await Shot("ship-aboard");await SavedRide(api,"ship",()=>ships.On==d);
        var local=ships.Local;float startY=Jef.I.Y;await Frames(90);Require(ships.Local.DistanceTo(local)<.001f&&new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z).DistanceTo(d.At(local))<.02f,"standing feet follow live heave and roll");
        Jef.I.SetKey(Key.W,true);await Frames(60);Jef.I.ClearKeys();Require(ships.Local.DistanceTo(local)>.1f,"walk through reachable deck cells");await Shot("ship-walking");
        for(int i=0;i<100;i++)Jef.I.Drive!(0);long before=GC.GetAllocatedBytesForCurrentThread();for(int i=0;i<10000;i++)Jef.I.Drive!(0);long allocated=GC.GetAllocatedBytesForCurrentThread()-before;replies.Add(new{shipProbe=new{iterations=10000,allocatedBytes=allocated}});Require(allocated==0,"ship frame walking allocates zero bytes");
        for(int i=0;i<100;i++)ships._Process(0);before=GC.GetAllocatedBytesForCurrentThread();for(int i=0;i<10000;i++)ships._Process(0);allocated=GC.GetAllocatedBytesForCurrentThread()-before;replies.Add(new{shipUpdateProbe=new{iterations=10000,allocatedBytes=allocated}});Require(allocated==0,"ship deck and gangway updates allocate zero bytes");
        Require(Jef.I.OnJump?.Invoke()==true&&ships.On==null&&!Jef.I.Grounded,"Space launches from ship deck");ships.Clear();Jef.I.Place(-118,36,0);
        var traffic=River.I.Movers.First(m=>m.Parts.Any(part=>ships.Decks.Any(d=>d.Kind==part.Boat.Kind&&d.Visible()&&d.World().Origin.DistanceTo(part.Boat.Inner.GlobalPosition)<.1f)));var part=traffic.Parts.First(part=>ships.Decks.Any(d=>d.Kind==part.Boat.Kind&&d.Visible()&&d.World().Origin.DistanceTo(part.Boat.Inner.GlobalPosition)<.1f));var moving=ships.Decks.First(d=>d.Kind==part.Boat.Kind&&d.Visible()&&d.World().Origin.DistanceTo(part.Boat.Inner.GlobalPosition)<.1f);p=moving.Mesh.Nearest(Vector2.Zero);ships.Clear();var approach=moving.At(p);Jef.I.DropFromBoat(approach-Vector3.Up);ships.Board(moving,p);Require(await Until(()=>ships.On==moving&&!Jef.I.Climbing,5),"moving ship climb follows its endpoint until attachment");Require(new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z).DistanceTo(moving.At(ships.Local))<.05f,"moving climb lands at current deck position");var initial=moving.World().Origin;Require(await Until(()=>moving.World().Origin.DistanceTo(initial)>.2f,10),"underway ship moves while Jef stands aboard");Require(new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z).DistanceTo(moving.At(ships.Local))<.05f,"player follows travelling ship frame");replies.Add(new{movingShip=new{moving.Kind,local=new{ships.Local.X,ships.Local.Y},feet=new{Jef.I.X,Jef.I.Y,Jef.I.Z},floor=moving.Mesh.Floor(ships.Local.X,ships.Local.Y)}});Jef.I.Yaw=moving.World().Basis.GetEuler().Y;Jef.I.Pitch=-.5f;await Shot("ship-moving");ships.Clear();Jef.I.Place(-118,36,0);
    }
    private async Task FerryCheck(Api api)
    {
        MoverClock.Hold(13.75,1);
        GameState.I.Apply(await api.NewGame());GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{hour=13,minute=45,weather="clear"}));
        var f=FerryArrival.I;f.Answered+=(action,reply)=>replies.Add(new{ferry=action,reply});Require((await api.Arrival()).Stage=="ferry","new week arrives on ferry");await f.Ask(false);
        Require(f.Stage=="waiting"&&Jef.I.Riding&&!f.Ashore,"player starts on measured ferry deck");await Shot("ferry-deck");Require(await Until(()=>f.Stage=="moored",8),"ferryman lowers gangway before walking ashore");
        var start=new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z);for(int i=0;i<100;i++)Jef.I.Drive!(0);long before=GC.GetAllocatedBytesForCurrentThread();for(int i=0;i<10000;i++)Jef.I.Drive!(0);long alloc=GC.GetAllocatedBytesForCurrentThread()-before;replies.Add(new{ferryProbe=new{iterations=10000,allocatedBytes=alloc}});Require(alloc==0,"ferry walking allocates zero bytes");
        for(int i=0;i<100;i++)f._Process(0);before=GC.GetAllocatedBytesForCurrentThread();for(int i=0;i<10000;i++)f._Process(0);alloc=GC.GetAllocatedBytesForCurrentThread()-before;replies.Add(new{ferryUpdateProbe=new{iterations=10000,allocatedBytes=alloc}});Require(alloc==0,"ferry models and passengers update without managed allocations");
        await FerryWalk(f.Port,15);Jef.I.Pitch=-.35f;await Shot("ferry-gangway");await FerryWalk(new(-249,-58.5f),15);
        Require(await Until(()=>f.Ashore,10),"walking gangway reports ashore to server");Require((await api.Arrival()).Stage=="ashore","server stores ferry arrival completion");Jef.I.Yaw=MathF.Atan2(Jef.I.X-f.VesselPosition.X,Jef.I.Z-f.VesselPosition.Z);Jef.I.Pitch=-.2f;await Shot("ferry-ashore");
        Require(await Until(()=>f.PassengersOff==5,40),"all five foot passengers leave before gangway is raised");Require(await Until(()=>f.Stage=="leaving",10),"ferry casts off after everyone is ashore");var departed=f.VesselPosition;Require(await Until(()=>f.VesselPosition.DistanceTo(departed)>.5f,8),"departing ferry steams clear of landing");Jef.I.Yaw=MathF.Atan2(Jef.I.X-f.VesselPosition.X,Jef.I.Z-f.VesselPosition.Z);await Shot("ferry-departing");
        var path=f.StagePath(new(Jef.I.X,Jef.I.Z),new(-249,-6));replies.Add(new{ferryStagePath=path});Require(path.Count>0,"measured landing floor has a route around its furniture");foreach(var point in path)await FerryWalk(point,45);await FerryWalk(new(-249,-6),10);await FerryWalk(new(-249,.2f),10);Require(!Jef.I.Riding&&!Jef.I.Swimming&&Jef.I.Grounded,"landing stage and quay gangway reach town on foot");
        replies.Add(new{ferryFootProbe=new{f.WorstFootError,f.MissingFootSamples,f.MissingPerson,missingAt=new{f.MissingAt.X,f.MissingAt.Y},f.PassengersOff,start=new{start.X,start.Y,start.Z}}});Require(f.MissingFootSamples==0,"passengers keep feet on deck, plank and landing floors");await f.Ask(false);Require(f.Stage=="gone"&&!Jef.I.Riding,"loading ashore game does not restart arrival");
    }
    private async Task FerryWalk(Vector2 target,double timeout)
    {
        bool reached=await Until(()=>{var j=Jef.I;var delta=target-new Vector2(j.X,j.Z);j.Yaw=MathF.Atan2(-delta.X,-delta.Y);j.SetKey(Key.W,delta.Length()>.12f);return delta.Length()<.12f;},timeout);Jef.I.ClearKeys();if(!reached)replies.Add(new{ferryBlocked=new{Jef.I.X,Jef.I.Y,Jef.I.Z,Jef.I.Frozen,Jef.I.Riding,Jef.I.Grounded,Jef.I.Blocked,drive=Jef.I.Drive?.Method.DeclaringType?.Name,method=Jef.I.Drive?.Method.Name,foot=FerryArrival.I.Foot(Jef.I.X,Jef.I.Z),passengers=FerryArrival.I.RiderTestPassengers()}});Require(reached,$"walk ferry route to {target}");
    }
    private async Task SavedRide(Api api,string kind,Func<bool> resumed)
    {
        var capture=RideSaves.I.Capture();Require(RideSaves.Read<RideSaved>(capture,"ride")?.Kind==kind,"save captures "+kind+" frame");
        Require((await api.Save("slot2","Ride test",capture)).Ok,"server saves while on "+kind);
        await LoadSaved(api,"slot2");
        Require(await Until(resumed,12),"loaded "+kind+" resumes with its live controls");
        await Frames(5);Require(float.IsFinite(Jef.I.Y),"loaded "+kind+" has finite feet");
    }
    private async Task LoadSaved(Api api,string slot)
    {
        var menu=Scheldemist.Menu.MainMenu.I!;string result="";menu.Saves.Load(slot,r=>result=r);
        Require(await Until(()=>result!="",65)&&result=="loaded "+slot,"menu loads real server save and dispatches replacement");
        Require((await api.GetClientState()).Client.HasValue,"server preserved client ride state");menu.Start();await Frames(2);
    }
    private async Task SavedRowCheck(Api api)
    {
        MoverClock.Hold(13.75,1);GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{hour=13,minute=45,weather="clear",money_c=2000,health=10}));
        var row=Rowing.I;await row.Load();var landing=row.Data.Landings.First(l=>l.Id=="vismarkt");
        Jef.I.Place(landing.Landing[0],landing.Landing[1],0);await row.Hire(landing);
        RowPose(row,landing.X-2,landing.Z-3,.45f);await Frames(3);
        var captured=RideSaves.I.Capture();var back=RideSaves.Read<RowSaved>(captured,"row");Require(back!=null&&back.What=="hire","save captures rowing hull and heading");
        Require((await api.Save("slot1","Rowing test",captured)).Ok,"real server saves while rowing");
        await row.Leave(null);Require(row.Boat==null,"rower leaves before loading saved week");
        await LoadSaved(api,"slot1");
        Require(await Until(()=>row.Boat!=null&&!row.Busy,10),"saved rower resumes on authoritative hired boat");
        Require(row.Data.On=="hire"&&new Vector2(row.Rower.X,row.Rower.Z).DistanceTo(new(back!.X,back.Z))<.05f&&Math.Abs(row.Rower.Heading-back.Yaw)<.001f,"loaded rowing position and heading match save");
        Jef.I.Pitch=.35f;await Shot("rowing-loaded");
        RowPose(row,landing.X,landing.Z,landing.Yaw);await Frames(3);await row.Leave(row.ExitHere());Require(await Until(()=>!Jef.I.Climbing,15),"saved boat can still return through steps");
    }
    private async Task RowCheck(Api api)
    {
        MoverClock.Hold(13.75,1);
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{hour=13,minute=45,weather="clear",money_c=2000,health=10}));await Rowing.I.Load();
        var row=Rowing.I;Require(await Until(()=>row.Data.Landings.Count>0,10),"rowing landings ready");row.Answered+=(action,reply)=>replies.Add(new{rowing=action,reply});
        replies.Add(new{rowInitial=row.Data});var landing=row.Data.Landings.First(l=>l.Id=="vismarkt");
        float ly=Jef.I.GroundAt(landing.Landing[0],landing.Landing[1],0);Jef.I.Place(landing.Landing[0],landing.Landing[1],MathF.Atan2(landing.Landing[0]-landing.X,landing.Landing[1]-landing.Z),-.45f,ly);await Frames(15);
        await Shot("rowing-hire");Require(Interact.I.Find().Any(a=>a.Text.StartsWith("hire a")),"hire boat prompt at waterman's steps");int money=GameState.I.Money;
        Require(Interact.I.Press(Key.E),"E hires rowing boat");Require(await Until(()=>row.Boat!=null&&!row.Busy,10),"server confirms hire and rower sits on thwart");
        Require(row.Data.On=="hire"&&GameState.I.Money==money-row.Data.Fees.HireC,"server charges hire fee");await Shot("rowing-thwart");
        replies.Add(new{rowStart=new{row.Rower.X,row.Rower.Y,row.Rower.Z,row.Rower.Heading,blocked=row.Rower.Blocked(row,row.Rower.X,row.Rower.Z,row.Rower.Heading)}});
        for(int k=-1;k<=1;k++)replies.Add(new{rowWater=row.RiderTestWater(row.Rower.X+MathF.Sin(row.Rower.Heading)*(row.Rower.Shape.Half-row.Rower.Shape.Beam*.6f)*k,row.Rower.Z+MathF.Cos(row.Rower.Heading)*(row.Rower.Shape.Half-row.Rower.Shape.Beam*.6f)*k,row.Rower.Shape.Beam)});
        var from=new Vector2(row.Rower.X,row.Rower.Z);Jef.I.SetKey(Key.W,true);Jef.I.SetKey(Key.Shift,true);bool rowed=await Until(()=>new Vector2(row.Rower.X,row.Rower.Z).DistanceTo(from)>1,12);
        replies.Add(new{rowPush=new{row.Rower.X,row.Rower.Z,row.Rower.Speed,row.Rower.Port,row.Rower.Starboard,Jef.I.Frozen,drive=Jef.I.Drive?.Method.DeclaringType?.Name,boat=row.Boat?.Key,blocked=row.Rower.Blocked(row,row.Rower.X,row.Rower.Z,row.Rower.Heading),prompts=Interact.I.Find().Select(a=>a.Text).ToArray()}});Jef.I.ClearKeys();Require(rowed,"W rows hired boat one metre");
        Require(row.Rower.Speed>.2f&&Math.Abs(row.Rower.Port)>0&&Math.Abs(row.Rower.Starboard)>0,"both oars propel rowing boat");Jef.I.Pitch=-.45f;await Shot("rowing-oars");
        float h=row.Rower.Heading;Jef.I.SetKey(Key.A,true);Require(await Until(()=>Math.Abs(row.Rower.Heading-h)>.08f,8),"A turns with unequal oars");Jef.I.ClearKeys();
        for(int i=0;i<100;i++)Jef.I.Drive!(0);long before=GC.GetAllocatedBytesForCurrentThread();for(int i=0;i<10000;i++)Jef.I.Drive!(0);long allocated=GC.GetAllocatedBytesForCurrentThread()-before;replies.Add(new{rowingProbe=new{iterations=10000,allocatedBytes=allocated}});Require(allocated==0,"rowing drive allocates zero bytes");
        // Return at the actual berth after testing the real water movement.
        row.Rower.X=landing.X;row.Rower.Z=landing.Z;row.Rower.Heading=landing.Yaw;row.Rower.Speed=row.Rower.Turn=0;await Frames(3);
        Require(row.ExitHere()!=null,"rowing berth has a reachable exit to the steps");Require(Interact.I.Press(Key.E),"E docks and steps out");Require(await Until(()=>row.Boat==null&&!row.Busy&&!Jef.I.Climbing,15),"climb from thwart finishes on landing");
        var world=await api.RowWorld();replies.Add(new{rowAfterReturn=world});Require(world.On==null&&world.Hire==null,"server returns hire at landing");Require(!Jef.I.Swimming&&!Jef.I.Riding,"rower stands ashore after docking");await Shot("rowing-returned");
        Jef.I.Place(landing.Landing[0],landing.Landing[1],0,-.45f,ly);await row.Hire(landing);Require(row.Boat!=null,"second hire ready for reboarding");
        row.Rower.X=-130;row.Rower.Z=-5;row.Rower.Heading=MathF.PI/2;row.Rower.Speed=row.Rower.Turn=0;await Frames(3);
        await row.Leave(null);Require(await Until(()=>Jef.I.Swimming&&!row.Busy,8),"leave boat over side enters water");
        Require(row.Data.Hire?.Left!=null&&row.Drawings.TryGetValue("mine",out var leftBoat)&&Math.Abs(leftBoat.Yaw-MathF.PI/2)<.01f,"left hired boat keeps its original hull and heading");var lying=row.Drawings["mine"];Jef.I.Yaw=MathF.Atan2(Jef.I.X-lying.X,Jef.I.Z-lying.Z);Jef.I.Pitch=0;await Frames(3);await Shot("rowing-swimming");
        Require(Interact.I.Press(Key.E),"E climbs back into boat from water");Require(await Until(()=>row.Boat!=null&&!row.Busy&&!Jef.I.Climbing,10),"swimmer climbs onto thwart and server confirms reboarding");
        row.Rower.X=-125;row.Rower.Z=-1.4f;row.Rower.Heading=MathF.PI/2;row.Rower.Speed=row.Rower.Turn=0;await Frames(3);await row.Leave(null);
        MoverClock.Hold(13.75,1);Jef.I.Place(-125,.2f,0,-.55f,0);await Frames(3);replies.Add(new{rowJump=new{row.Busy,Jef.I.Laden,Jef.I.Riding,Jef.I.Swimming,Jef.I.Climbing,Jef.I.Y,water=World.Water.Level(-125,-1.4f),boat=new{row.Drawings["mine"].X,row.Drawings["mine"].Z}}});Require(Jef.I.OnJump?.Invoke()==true,"Space at quay jumps into the left boat");Require(await Until(()=>row.Boat!=null&&!row.Busy&&!Jef.I.Climbing,10),"quay jump lands on thwart and server reboards");await Shot("rowing-quay-jump");
        row.Rower.X=landing.X;row.Rower.Z=landing.Z;row.Rower.Heading=landing.Yaw;row.Rower.Speed=row.Rower.Turn=0;await Frames(3);await row.Leave(row.ExitHere());Require(await Until(()=>!row.Busy&&!Jef.I.Climbing,15),"second hired boat returns ashore");
    }
    private async Task VeloFixture(Api api,Velocipedes.Machine m,float x,float z,float yaw)
    {
        var mounted=await api.VeloMount(m.Info,m.Info.X,m.Info.Z);replies.Add(new{veloFixtureMount=mounted});
        var left=await api.VeloLeave(m.Info.Id,x,z,yaw,false);replies.Add(new{veloFixtureLeave=left});await Velocipedes.I.Load();
    }
    private async Task VeloCheck(Api api)
    {
        MoverClock.Hold(13.75,1);
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {hour=13,minute=45,weather="clear",money_c=2000,health=10}));
        await Velocipedes.I.Load();Require(await Until(()=>Velocipedes.I.Ownership?.Shop!=null,15),"velocipede maker ready");
        var velo=Velocipedes.I;var shop=velo.Ownership!.Shop!;velo.Answered+=(action,reply)=>replies.Add(new{velocipede=action,reply});
        var buy=await api.Buy(shop.Id,"velocipede_used");GameState.I.Apply(buy);replies.Add(new{veloBuy=buy});
        Require(buy.PriceC==600&&GameState.I.Money==1400,"server sells owned used velocipede");await velo.Load();
        Require(velo.Machines.Values.Any(m=>m.Info.Own&&m.Info.Mine),"owned velocipede drawn from model library");var m=velo.Machines.Values.First(m=>m.Info.Own&&m.Info.Mine);
        await VeloFixture(api,m,-118,36,0);Jef.I.Place(-118.8f,36,-MathF.PI/2,-.65f);await Frames(15);await Shot("velocipede-parked");
        Require(Interact.I.Press(Key.E),"E mounts owned velocipede");Require(await Until(()=>velo.Ridden==m&&!velo.Busy,10),"server confirms mounted velocipede");
        var from=new Vector2(Jef.I.X,Jef.I.Z);Jef.I.SetKey(Key.W,true);Require(await Until(()=>new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(from)>2,8),"velocipede travels two metres");Jef.I.ClearKeys();
        replies.Add(new{veloPedal=new{from=new{from.X,from.Y},Jef.I.X,Jef.I.Y,Jef.I.Z,velo.Speed,velo.LastEvent,velo.Heading}});
        Require(velo.Speed>1&&new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(from)>1,"W pedals velocipede along flat street");Jef.I.Pitch=-.9f;await Shot("velocipede-riding");
        for(int i=0;i<100;i++)velo.Drive(0);long before=GC.GetAllocatedBytesForCurrentThread();for(int i=0;i<10000;i++)velo.Drive(0);long bytes=GC.GetAllocatedBytesForCurrentThread()-before;
        replies.Add(new{veloFrameProbe=new{iterations=10000,allocatedBytes=bytes}});Require(bytes==0,"velocipede drive allocates zero bytes");
        await SavedRide(api,"velo",()=>velo.Ridden!=null&&!velo.Busy);m=velo.Ridden!;
        float h=velo.Heading;Jef.I.SetKey(Key.W,true);Jef.I.SetKey(Key.A,true);await Frames(60);Jef.I.ClearKeys();Require(Math.Abs(velo.Heading-h)>.02f,"A turns handlebar and machine");
        Jef.I.SetKey(Key.S,true);Require(await Until(()=>Math.Abs(velo.Speed)<.1f,5),"S brakes velocipede");Jef.I.ClearKeys();
        Require(Interact.I.Press(Key.E),"E dismounts velocipede");Require(await Until(()=>velo.Ridden==null&&!velo.Busy,10),"dismount returns to ordinary walking");
        var world=await api.Velos();replies.Add(new{veloWorldAfterLeave=world});Require(world.Velos.First(v=>v.Id==m.Info.Id).Ridden==false,"server parks dismounted velocipede");Jef.I.Yaw=MathF.Atan2(Jef.I.X-m.Info.X,Jef.I.Z-m.Info.Z);Jef.I.Pitch=-.65f;await Shot("velocipede-dismounted");
        // A real raised slab across the route: the wheels must refuse a 20 cm step.
        await VeloFixture(api,m,-118,36,0);Jef.I.Place(-118.8f,36,-MathF.PI/2);await Frames(12);await velo.Mount(m);
        var step=new StaticBody3D{CollisionLayer=Scheldemist.World.Solid.Layer,CollisionMask=0,Position=new(-118,.1f,38)};
        step.AddChild(new CollisionShape3D{Shape=new BoxShape3D{Size=new(4,.2f,1)}});Main.I.View.AddChild(step);await Frames(3);
        Jef.I.SetKey(Key.W,true);Require(await Until(()=>velo.LastEvent=="steps",8),"velocipede refuses a real twenty-centimetre step");Jef.I.ClearKeys();Require(Jef.I.Z<38,"wheels stay below refused step");await velo.Leave();step.QueueFree();await Frames(3);
        await VeloFixture(api,m,-118,1.5f,MathF.PI);Jef.I.Place(-118.8f,1.5f,MathF.PI/2);await Frames(12);await velo.Mount(m);
        Jef.I.SetKey(Key.W,true);Require(await Until(()=>velo.LastEvent=="edge",10),"velocipede stops short of quay water edge");Jef.I.ClearKeys();Require(!Jef.I.Swimming&&Jef.I.Z>-.5f,"edge refusal keeps rider ashore");await Shot("velocipede-edge");await velo.Leave();
        var hire=await api.Buy(shop.Id,"velocipede_hire");GameState.I.Apply(hire);replies.Add(new{veloHire=hire});await velo.Load();
        Require(hire.PriceC==30&&velo.Ownership!.List.Any(v=>v.Kind=="hire"&&v.MinutesLeft==840),"server rents velocipede for fourteen game hours");
        var rentedId=velo.Ownership!.List.First(v=>v.Kind=="hire").Id;var rented=velo.Machines[rentedId];
        await VeloFixture(api,rented,-118,36,0);Jef.I.Place(-118.8f,36,-MathF.PI/2,-.65f);await Frames(12);Require(Interact.I.Press(Key.E),"E mounts hired velocipede");Require(await Until(()=>velo.Ridden==rented&&!velo.Busy,10),"hired machine uses same riding controls");await velo.Leave();
        await VeloFixture(api,m,-180,4+1.435f/2,-MathF.PI/2);Jef.I.Place(-180,5.8f,0,-.5f);await Frames(12);await velo.Mount(m);velo.RiderTestRisk(true);
        Jef.I.SetKey(Key.W,true);Jef.I.SetKey(Key.Shift,true);
        Require(await Until(()=>velo.LastEvent=="fall"&&!velo.Busy,15),"fast wheel in real rail groove throws rider with fixture dice");Jef.I.ClearKeys();velo.RiderTestRisk(false);
        Require(velo.Ridden==null&&m.Info.Down,"crash leaves machine down and rider beside it");Jef.I.Yaw=MathF.Atan2(Jef.I.X-m.Info.X,Jef.I.Z-m.Info.Z);Jef.I.Pitch=-.55f;await Shot("velocipede-crash");
        Require(await Until(()=>!Jef.I.Riding,5),"rider gets up after crash");world=await api.Velos();replies.Add(new{veloAfterCrash=world});Require(world.Velos.First(v=>v.Id==m.Info.Id).Down,"server records crashed velocipede on its side");
    }
    private async Task CartFixture(Api api,HandcartInfo c,float x,float z,float yaw)
    {
        await api.CartHold(c.Id,c.X,c.Z);
        var p=new Vector2(c.X,c.Z);var goal=new Vector2(x,z);
        while(p.DistanceTo(goal)>50){p=p.MoveToward(goal,50);await api.CartAt(c.Id,p.X,p.Y,yaw);}
        var r=await api.CartRelease(c.Id,x,z,yaw);Handcarts.I.Apply(r.Carts);
        replies.Add(new {cartFixture=r.Carts});
    }
    private async Task HandcartCheck(Api api)
    {
        MoverClock.Hold(13.75,1);
        var world=new CartTestWorld();var pose=new CartPhysics.Pose(0,0,0);
        Require(CartPhysics.Misfit(pose,world)==0,"empty whole cart fits flat open ground");
        world.Wall=.6f;Require(CartPhysics.Misfit(pose,world)>0,"cart bed side catches a wall");
        world.Wall=float.PositiveInfinity;world.StepHeight=.1f;Require(CartPhysics.Misfit(pose,world)>0,"cart refuses ground ten centimetres above its feet");
        world.StepHeight=0;world.WaterZ=4;
        var stopped=CartPhysics.Step(pose,new(0,.5f),0,.1f,world);
        Require(stopped.X==pose.X&&stopped.Z==pose.Z,"whole cart stops before a wheel hangs over water");
        world.WaterZ=float.PositiveInfinity;world.Wall=.1f;
        Require(CartPhysics.Step(pose,new(-.5f,0),0,.1f,world).X<0,"wedged cart may move towards clearer ground");
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {hour=13,minute=45,money_c=2000,health=10}));
        await Handcarts.I.Load();
        Require(await Until(()=>Handcarts.I.View.Shop!=null&&Goods.I.Loaded,15),"wheelwright and goods ready");
        Require(!((CartPhysics.IWorld)Handcarts.I).Water(7,-6),"wooden pier is dry ground for handcart wheels");
        using(var city=JsonDocument.Parse(File.ReadAllText(Scheldemist.World.Water.CityJson())))
        {var rail=city.RootElement.GetProperty("decor").GetProperty("crane_rails")[0];Require(Handcarts.I.OnRails((rail[0].GetSingle()+rail[2].GetSingle())/2,(rail[1].GetSingle()+rail[3].GetSingle())/2),"crane runway is kept clear of parked carts");}
        var shop=Handcarts.I.View.Shop!;Handcarts.I.Answered+=(action,reply)=>replies.Add(new {cart=action,reply});
        Goods.I.Answered+=(ask,reply)=>replies.Add(new {cartGoodsAsk=ask,reply});
        var bought=await api.Buy(shop.Id,"handcart_used");GameState.I.Apply(bought);replies.Add(new {cartBuy=bought});
        Require(bought.PriceC==200&&GameState.I.Money==1800,"server sells owned used handcart");
        await Handcarts.I.Load();
        Require(await Until(()=>Handcarts.I.Drawings.Count==1,10),"owned cart drawn from model library");
        var d=Handcarts.I.Drawings.Values.Single();
        await CartFixture(api,d.Info,-118,36,0);
        Jef.I.Place(-118,33.3f,MathF.PI,.15f);await Frames(12);
        await Shot("handcart-grips");
        Require(Interact.I.Press(Key.E),"E grips owned handcart");
        Require(await Until(()=>Handcarts.I.Held!=null&&!Handcarts.I.Busy,10),"held cart confirmed by server");
        var from=new Vector2(Jef.I.X,Jef.I.Z);ulong pushStart=Time.GetTicksMsec();
        Jef.I.SetKey(Key.W,true);
        bool pushed;
        try { pushed=await Until(()=>new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(from)>.3f,3); }
        finally { Jef.I.ClearKeys(); }
        replies.Add(new{cartPush=new{elapsedMs=Time.GetTicksMsec()-pushStart,distance=new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(from),Jef.I.Frozen,drive=Jef.I.Drive?.Method.DeclaringType?.Name}});
        Require(pushed,"W pushes whole cart on flat street");await Frames(15);
        await Shot("handcart-pushing");
        for(int i=0;i<100;i++)Jef.I.CartStep!(new(Jef.I.X,Jef.I.Z),new(Jef.I.X,Jef.I.Z),0);
        long start=GC.GetAllocatedBytesForCurrentThread();ulong t0=Time.GetTicksUsec();
        for(int i=0;i<10000;i++)Jef.I.CartStep!(new(Jef.I.X,Jef.I.Z),new(Jef.I.X,Jef.I.Z),0);
        long alloc=GC.GetAllocatedBytesForCurrentThread()-start;
        double micros=(Time.GetTicksUsec()-t0)/10000.0;
        Require(alloc==0,"whole-cart physics allocates zero bytes");replies.Add(new {cartPhysicsProbe=new {iterations=10000,allocatedBytes=alloc,microsecondsPerCall=micros}});
        for(int i=0;i<100;i++)Handcarts.I._Process(0);
        start=GC.GetAllocatedBytesForCurrentThread();for(int i=0;i<10000;i++)Handcarts.I._Process(0);
        alloc=GC.GetAllocatedBytesForCurrentThread()-start;
        Require(alloc==0,"held cart model update allocates zero bytes");
        await SavedRide(api,"cart",()=>Handcarts.I.Held!=null&&!Handcarts.I.Busy);d=Handcarts.I.Drawings[Handcarts.I.Held!];
        Require(Interact.I.Press(Key.E),"E releases handcart");
        Require(await Until(()=>Handcarts.I.Held==null&&!Handcarts.I.Busy,10),"release restores walking and parked solid");
        var job=GameState.I.Jobs.First(j=>j.TaskType=="carry"&&JobTask.Of(j)?.Goods=="rope");
        await Jobs.I.TakeJob(job);
        Require(await Until(()=>Goods.I.All.Values.Count(it=>it.JobId==job.Id)==2,12),"two server job goods ready for cart");
        await Frames(12);for(int i=0;i<5&&Dialogs.I!.Any;i++)Dialogs.I.SendKey("Escape");await Frames(4);
        var items=Goods.I.All.Values.Where(it=>it.JobId==job.Id).OrderBy(it=>it.Id).ToArray();
        // Fixture only moves the cart through server position reports; loading uses the real goods owner.
        await CartFixture(api,d.Info,items[0].X+3,items[0].Z+4,0);
        foreach(var item in items)
        {
            Jef.I.Place(item.X+.2f,item.Z+.7f,0);await Frames(12);Goods.I.Lift(item);
            Require(await Until(()=>Goods.I.Carried==item,5),"job good in Jef's arms");
            await Frames(20);
            var confirmed=await api.Goods<GoodsList>();
            Require(confirmed.Items.Any(g=>g.Id==item.Id&&g.ByPlayer==Goods.I.Me),"server confirms good in Jef's arms");
            Jef.I.Place(d.X,d.Z-1.8f,MathF.PI,.1f);await Frames(12);
            replies.Add(new {cartCarryPrompt=new {acts=Interact.I.Find().Select(a=>a.Text).ToArray(),carried=Goods.I.Carried?.S,cart=d.Info,at=new {Jef.I.X,Jef.I.Y,Jef.I.Z},localCart=new {d.X,d.Z,d.Yaw}}});
            Require(Interact.I.Find().Any(a=>a.Text.Contains("on the cart")),"carried good offers cart loading");
            Require(Interact.I.Press(Key.E),"E loads carried good");
            Require(await Until(()=>!Handcarts.I.Busy&&Goods.I.Carried==null&&d.Info.Load.Any(l=>l.Gid==item.Id),10),"server moves real good onto cart");
            Require(item.Obj?.GetParent()==d.Bed&&item.Obj.Visible,"one original good model on bed");
        }
        Jef.I.Place(d.X+1.8f,d.Z-2,MathF.Atan2(1.8f,-2),-.4f);await Frames(20);
        Require(Goods.I.Carried==null,"loading leaves both hands free after the goods pushes arrive");
        await Shot("handcart-loaded");
        Require(Interact.I.Press(Key.G),"G unloads top good into arms");
        Require(await Until(()=>Goods.I.Carried!=null&&!Handcarts.I.Busy,10),"unloaded good retains server identity");
        Require(Interact.I.Press(Key.E),"E reloads same good");
        Require(await Until(()=>Goods.I.Carried==null&&d.Info.Load.Count==2&&!Handcarts.I.Busy,10),"two goods restored on bed");
        var to=Spots.Get(JobTask.Of(job)!.To)!;await CartFixture(api,d.Info,to.X,to.Z+3,0);
        Jef.I.Place(d.X,d.Z-2.6f,MathF.PI,.1f);await Frames(12);
        Require(Interact.I.Press(Key.E),"E grips loaded handcart at goal");
        Require(await Until(()=>Handcarts.I.Held!=null&&!Handcarts.I.Busy,10),"loaded grip confirmed");
        int money=GameState.I.Money;
        Require(Interact.I.Press(Key.F),"F unloads entire allowed job at goal");
        Require(await Until(()=>d.Info.Load.Count==0&&!Handcarts.I.Busy,10),"server empties the job's load");
        Require(await Until(()=>GameState.I.Jobs.Any(j=>j.Id==job.Id&&j.Status=="done"),10),"bulk unloading settles real carry job");
        Require(GameState.I.Money>money,"server pays bulk delivery");
        await Shot("handcart-unloaded");await Handcarts.I.Release(true);
        var rented=await api.Buy(shop.Id,"handcart_hire");GameState.I.Apply(rented);replies.Add(new {cartHire=rented});await Handcarts.I.Load();
        Require(await Until(()=>Handcarts.I.Drawings.Values.Any(c=>c.Info.Kind=="hire"&&c.Info.MinutesLeft==840),10),"server rents handcart for fourteen game hours");
        var hire=Handcarts.I.Drawings.Values.First(c=>c.Info.Kind=="hire");
        await CartFixture(api,hire.Info,-118,36,0);Jef.I.Place(-118,33.3f,MathF.PI);await Frames(12);
        Require(Interact.I.Press(Key.E),"E grips hired handcart");Require(await Until(()=>Handcarts.I.Held==hire.Info.Id&&!Handcarts.I.Busy,10),"hired cart uses same grip physics");
        await Shot("handcart-hired");await Handcarts.I.Release(true);await CartFixture(api,hire.Info,-110,36,0);Require(Handcarts.I.Held==null&&!Jef.I.Laden,"cart check releases hands and parks clear of next ride");
    }
    private sealed class CartTestWorld : CartPhysics.IWorld
    {
        public float Wall=float.PositiveInfinity,WaterZ=float.PositiveInfinity,StepHeight;
        public bool Water(float x,float z)=>z>WaterZ;
        public float Base(float x,float z)=>StepHeight;
        public bool Free(float x,float z,float r)=>x+r<Wall;
        public int People(CartPhysics.Pose p)=>0;
    }
    private async Task CraneCheck()
    {
        MoverClock.Hold(13.75,1);
        var rail = Railway.I; Require(rail.LadderCount == 10, "ten live crane ladders");
        int id = Enumerable.Range(0, rail.LadderCount).First(i => CraneClimb.I.FootOf(i) != null);
        // Earlier ride sections consume real time; start at the ladder's idle alignment,
        // as the dock fixture does below, before proving live slew and runway travel.
        rail.RiderTestWork(id, 0);
        rail.RiderTestWork(id, 0);
        var foot = CraneClimb.I.FootOf(id)!.Value; var l = rail.LadderAt(id);
        Jef.I.Place(foot.X, foot.Z, l.Face, .25f); await Frames(12);
        Require(Interact.I.Find().Any(a => a.Text == "climb the crane's ladder"), "crane foot E prompt");
        await Shot("crane-foot"); Require(Interact.I.Press(Key.E), "E grips crane ladder");
        Jef.I.SetKey(Key.W, true);
        Require(await Until(() => CraneClimb.I.On == id && !CraneClimb.I.OnLadder, 50), "W climbs onto working crane gallery ("+rail.LadderAt(id).Deck.Basis.GetEuler().Y+" rad)");
        Jef.I.ClearKeys(); Jef.I.Yaw=rail.LadderAt(id).Deck.Basis.GetEuler().Y+MathF.PI/2; Jef.I.Pitch=-.1f; await Shot("crane-gallery");
        await SavedRide(ServerLink.I!.Api!,"crane",()=>CraneClimb.I.On==id&&!CraneClimb.I.OnLadder);
        var before = rail.LadderAt(id); var at = new Vector3(Jef.I.X, Jef.I.Y, Jef.I.Z);
        rail.RiderTestWork(id, .25f);
        Require(await Until(() => new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z).DistanceTo(at) > .1f, 12), "gallery carries Jef during real slew operation");
        l = rail.LadderAt(id); var local = l.Deck.AffineInverse() * new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z);
        Require(new Vector2(local.X, local.Z).DistanceTo(CraneClimb.I.Local) < .01f && Math.Abs(Jef.I.Y-6.42f)<.02f, "feet keep live gallery frame");
        await Shot("crane-turning");
        for(int i=0;i<100;i++) Jef.I.Drive!(0);
        long allocAt=GC.GetAllocatedBytesForCurrentThread();
        for(int i=0;i<10000;i++) Jef.I.Drive!(0);
        long allocated=GC.GetAllocatedBytesForCurrentThread()-allocAt;
        replies.Add(new { craneFrameProbe = new { iterations=10000,allocatedBytes=allocated } });
        Require(allocated==0,"crane gallery drive allocates zero bytes");
        foreach(var p in new[] { new Vector2(0,-1.7f), new Vector2(1.58f,-1.7f), new Vector2(1.58f,-.7f), new Vector2(.8f,-.7f), new Vector2(.8f,1.08f), new Vector2(.2f,1.08f) }) await WalkCrane(p);
        Require(Math.Abs(Jef.I.Y-6.54f)<.02f, "cabin reached on foot through its door");
        Jef.I.Yaw=rail.LadderAt(id).Deck.Basis.GetEuler().Y+MathF.PI; Jef.I.Pitch=-.1f;
        await Shot("crane-cabin");
        foreach(var p in new[] { new Vector2(.8f,1.08f), new Vector2(.8f,-.7f), new Vector2(1.58f,-.7f), new Vector2(1.58f,-1.7f), new Vector2(0,-1.7f), new Vector2(0,-2.45f) }) await WalkCrane(p);
        at = new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z);
        Require(rail.RiderTestTravel(id),"crane has travelling runway");
        Require(await Until(()=>new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z).DistanceTo(at)>.2f,12),"gallery carries Jef during real runway travel");
        await Shot("crane-travel");
        rail.RiderTestWork(id,0);
        Require(await Until(() => Interact.I.Find().Any(a=>a.Text=="climb down the ladder"), 20), "gallery comes round to ladder head");
        Require(Interact.I.Press(Key.E), "E starts climb down"); Jef.I.SetKey(Key.S,true);
        Require(await Until(() => CraneClimb.I.On<0 && !Jef.I.Riding, 10), "S climbs down onto free quay ground");
        Jef.I.ClearKeys(); await Shot("crane-down");
        replies.Add(new { crane = new { id, before, after = rail.LadderAt(id), foot = new { foot.X, foot.Y, foot.Z }, cabinReachable = true } });
        // The dock portals face away from the quay: their literal ladder foot is over water.
        int dock = 3; l = rail.LadderAt(dock);
        Scheldemist.World.Solid.I.Ensure(l.Foot, 14);
        await Frames(12);
        var reachable = CraneClimb.I.FootOf(dock);
        Require(reachable != null && !Scheldemist.World.Water.In(reachable.Value.X, reachable.Value.Z), "dock crane ladder has a quay-side foot");
        foot = reachable!.Value; rail.RiderTestWork(dock, 0);
        Jef.I.Place(foot.X,foot.Z,l.Face,.25f); await Frames(12);
        Require(Interact.I.Press(Key.E) && CraneClimb.I.On==dock,"E reaches dock crane ladder from the quay");
        await Shot("crane-dock-ladder");
        Jef.I.SetKey(Key.W,true);
        Require(await Until(()=>!CraneClimb.I.OnLadder,50),"dock crane gallery reached from quay ladder");
        Jef.I.ClearKeys(); Jef.I.Yaw=rail.LadderAt(dock).Deck.Basis.GetEuler().Y+MathF.PI/2;
        await Shot("crane-dock-gallery");
        Require(Interact.I.Press(Key.E),"E down dock crane"); Jef.I.SetKey(Key.S,true);
        Require(await Until(()=>CraneClimb.I.On<0,10),"dock crane returns Jef to the quay");
        Jef.I.ClearKeys();
        Require(!Jef.I.Swimming && !Scheldemist.World.Water.In(Jef.I.X,Jef.I.Z),"dock ladder landing stays ashore");
        replies.Add(new { dockCrane = new { id=dock, foot=new { foot.X,foot.Y,foot.Z }, quayReachable=true } });
    }
    private async Task WalkCrane(Vector2 target)
    {
        ulong end=Time.GetTicksMsec()+10000;
        Jef.I.SetKey(Key.W,true);
        while(Time.GetTicksMsec()<end && CraneClimb.I.Local.DistanceTo(target)>.1f)
        {
            var d=target-CraneClimb.I.Local;
            Jef.I.Yaw=Railway.I.LadderAt(CraneClimb.I.On).Deck.Basis.GetEuler().Y+MathF.Atan2(-d.X,-d.Y);
            await Frames(1);
        }
        Jef.I.ClearKeys();replies.Add(new{craneWalk=new{target,local=CraneClimb.I.Local,error=CraneClimb.I.Local.DistanceTo(target)}}); Require(CraneClimb.I.Local.DistanceTo(target)<.11f,$"walk crane gallery to {target}");
    }
    private async Task OmnibusCheck(Api api)
    {
        MoverClock.Hold(13.75,1);
        Require(Omnibus.I.Buses.Count == 6, "six live omnibuses");
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour = 13, minute = 45, weather = "clear", health = 10, money_c = 500 }));
        Ride.I.Answered += (action, reply) => replies.Add(new { ride = action, reply });
        var bus = Omnibus.I.Buses.First(b => b.Line.Id == "kaaien");
        var st = bus.StopAt.First(s => s.Stop.Id == "rijnkaai");
        bus.S = st.S; bus.At = st.Stop; bus.V = 0; bus.DwellT = 100;
        await Frames(2);
        var step = Ride.StepOf(bus);
        Jef.I.Place(step.X - MathF.Sin(bus.Yaw) * .8f, step.Z - MathF.Cos(bus.Yaw) * .8f, bus.Yaw + MathF.PI);
        await Frames(12);
        Require(Interact.I.Find().Any(a => a.Text.StartsWith("get on the KAAIEN")), "back step boarding prompt");
        await Shot("omnibus-step");
        int before = GameState.I.Money, fare = GameState.I.Payload!.Ride!.FareC;
        Require(Interact.I.Press(Key.E), "E boards omnibus");
        Require(await Until(() => Ride.I.Riding && !Ride.I.Busy, 10), "boarding reply and frame ready");
        Require(GameState.I.Money == before - fare && GameState.I.Payload!.Ride!.On != null, "server charges boarding fare");
        for (int i = 0; i < 100; i++) Jef.I.Drive!(0);
        long allocatedAt = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 10000; i++) Jef.I.Drive!(0);
        long allocated = GC.GetAllocatedBytesForCurrentThread() - allocatedAt;
        replies.Add(new { omnibusFrameProbe = new { iterations = 10000, allocatedBytes = allocated } });
        Require(allocated == 0, "omnibus frame drive allocates zero bytes");
        var state=new Scheldemist.Net.Mp.MpState{X=Jef.I.X,Y=Jef.I.Y,Z=Jef.I.Z,Yaw=Jef.I.Yaw};Scheldemist.Net.Mp.RidePlatforms.Sample(ref state);
        var remote=new Scheldemist.Net.Mp.Pose{Base=state.Base,Lx=state.Lx,Ly=state.Ly,Lz=state.Lz,Lyaw=state.Lyaw};Scheldemist.Net.Mp.RidePlatforms.Place(ref remote);
        Require(state.Base==(256|bus.Index)&&new Vector3(remote.X,remote.Y,remote.Z).DistanceTo(new(Jef.I.X,Jef.I.Y,Jef.I.Z))<.001f,"protocol 5 remote omnibus feet reconstruct in live frame");
        await SavedRide(api,"omnibus",()=>Ride.I.Riding&&!Ride.I.Busy);bus=Ride.I.Bus!;
        await Shot("omnibus-platform");
        Require(Interact.I.Press(Key.F), "F climbs roof");
        Require(await Until(() => Ride.I.Seat >= 12, 3), "roof seat occupied");
        await Shot("omnibus-roof");
        Require(Interact.I.Press(Key.E), "E returns from roof");
        Require(await Until(() => !Ride.I.Busy && Ride.I.Seat < 0, 3), "standing on platform");
        // Move the actual route while Jef stands in its frame.
        var at = new Vector3(Jef.I.X, Jef.I.Y, Jef.I.Z);
        bus.At = null; bus.V = 1.5f;
        await Frames(90);
        var now = new Vector3(Jef.I.X, Jef.I.Y, Jef.I.Z);
        Require(now.DistanceTo(at) > .2f && Math.Abs(Jef.I.Y - bus.Frame.ToGlobal(new Vector3(0, .74f, -1.5f)).Y) < .02f, "rider follows live moving platform");
        await Shot("omnibus-moving");
        Ride.I.Sit(0); await Frames(5);
        if (Ride.I.Seat != 0) { int seat = Enumerable.Range(0, 12).First(i => !Omnibus.I.Passengers(bus).Any(p => p.Seat == i)); Ride.I.Sit(seat); }
        Require(Ride.I.Seat is >= 0 and < 12, "free inside seat");
        await Shot("omnibus-inside"); Ride.I.Stand();
        await Ride.I.Leave();
        Require(!Ride.I.Riding && !Jef.I.Riding && GameState.I.Payload!.Ride!.On == null, "alight clears local and server ride");
        // Hop on a rolling bus and pay through the conductor's real paper.
        step = Ride.StepOf(bus);
        Jef.I.Place(step.X - MathF.Sin(bus.Yaw) * .6f, step.Z - MathF.Cos(bus.Yaw) * .6f, bus.Yaw + MathF.PI);
        await Frames(3);
        Require(Interact.I.Press(Key.E) && Ride.I.Unpaid, "E hops onto rolling back step");
        Require(await Until(() => Ride.I.FareOpen, 5), "conductor fare card after hop");
        await Shot("conductor-pay");
        before = GameState.I.Money;
        Require(Dialogs.I!.Top == Ride.I, "fare card owns keyboard");
        Ride.I.OnKey("Digit1", "1");
        Require(await Until(() => !Ride.I.Unpaid && !Ride.I.Busy, 10), "fare card pays through server hopOn");
        Require(GameState.I.Money <= before && GameState.I.Payload!.Ride!.On != null, "hop ticket is server owned");
        await Ride.I.Leave();
        step = Ride.StepOf(bus);
        Jef.I.Place(step.X - MathF.Sin(bus.Yaw) * .6f, step.Z - MathF.Cos(bus.Yaw) * .6f, bus.Yaw + MathF.PI);
        await Frames(3);
        before = GameState.I.Money;
        Require(Interact.I.Press(Key.E) && Ride.I.Unpaid, "second hop before refusal");
        Require(await Until(() => Ride.I.FareOpen, 5), "refusal card opens");
        Require(Dialogs.I.Top == Ride.I, "refusal paper owns keyboard");
        await Shot("conductor-refuse");
        Ride.I.OnKey("Digit2", "2");
        Require(await Until(() => !Ride.I.Riding, 15), "conductor puts nonpayer off onto free ground");
        Require(GameState.I.Money == before && !Jef.I.Riding, "refusal does not invent a payment");
        step = Ride.StepOf(bus);
        Jef.I.Place(step.X - MathF.Sin(bus.Yaw) * .6f, step.Z - MathF.Cos(bus.Yaw) * .6f, bus.Yaw + MathF.PI);
        await Frames(3); Jef.I.SetKey(Key.Space, true);
        Require(await Until(() => Ride.I.Unpaid, 2), "Space hops onto moving omnibus");
        Jef.I.SetKey(Key.Space, false);
        await Ride.I.AnswerFare(false);
        Require(await Until(() => !Ride.I.Riding, 15), "Space rider can be put off safely");
        Jef.I.Place(30, 11.1f, 0); await Frames(10);
        Require(Interact.I.Find().Any(a => a.Text == "read the timetable"), "real stop post timetable prompt");
        Require(Interact.I.Press(Key.E), "E reads stop timetable");
        Require(await Until(() => Dialogs.I.Top == Ride.I, 8), "timetable paper ready");
        await Shot("stop-timetable"); Ride.I.Close();
    }
    private void Require(bool ok, string name)
    {
        checks.Add(new { name, ok });
        GD.Print($"ridetest: {(ok ? "ok" : "FAIL")} {name}");
        if (!ok)
        {
            var j=Jef.I;var velo=Velocipedes.I;
            replies.Add(new{failedControl=new{name,j.X,j.Y,j.Z,j.Frozen,j.Riding,j.Grounded,j.Blocked,forward=j.KeyDown(Key.W),drive=j.Drive?.Method.DeclaringType?.Name,method=j.Drive?.Method.Name,dialog=Dialogs.I?.Top?.DialogName,pause=Scheldemist.Menu.Pause.Reasons,crane=CraneClimb.I.On,ladder=CraneClimb.I.OnLadder,velo.Speed,velo.LastEvent,velo.Heading,prompts=Interact.I.Find().Select(a=>a.Text).ToArray()}});
            string file=Path.Combine(dir,"ride-failure.png");GetViewport().GetTexture().GetImage().SavePng(file);pictures.Add(file);
            throw new InvalidOperationException(name);
        }
    }
    private async Task<bool> Until(Func<bool> condition, double seconds)
    {
        ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        while (Time.GetTicksMsec() < end) { if (condition()) return true; await Frames(1); }
        return condition();
    }
    private async Task Frames(int n) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }
    private async Task Shot(string name)
    {
        await Frames(8);
        await Until(()=>Math.Abs(Mathf.AngleDifference(Jef.I.Cam.Rotation.Y,Jef.I.Yaw))<.025f&&Math.Abs(Jef.I.Cam.Rotation.X-Jef.I.Pitch)<.025f,1.2);
        string file = Path.Combine(dir, name + ".png");
        GetViewport().GetTexture().GetImage().SavePng(file);
        pictures.Add(file);
    }
}
