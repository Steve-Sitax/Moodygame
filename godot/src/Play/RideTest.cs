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
            Jef.I.TestInput = true;
            GameState.I.PlayingWhen = () => false;
            Dialogs.I!.KeepMouse = true;
            await api.Post<OkReply>("api/arrival/ashore");
            Jef.I.Place(-118, 36, 0);
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
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr("ridetest: " + error); }
        finally
        {
            File.WriteAllText(Path.Combine(dir, "ridetest.json"), JsonSerializer.Serialize(new { ok = error == "", error, checks, replies, pictures, incomplete = new[] { "handcart", "rowing", "ship frames", "velocipede", "ferry" } }, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
            GetTree().Quit(error == "" ? 0 : 1);
        }
    }
    private async Task CraneCheck()
    {
        var rail = Railway.I; Require(rail.LadderCount == 10, "ten live crane ladders");
        int id = Enumerable.Range(0, rail.LadderCount).First(i => CraneClimb.I.FootOf(i) != null);
        rail.RiderTestWork(id, 0);
        var foot = CraneClimb.I.FootOf(id)!.Value; var l = rail.LadderAt(id);
        Jef.I.Place(foot.X, foot.Z, l.Face, .25f); await Frames(12);
        Require(Interact.I.Find().Any(a => a.Text == "climb the crane's ladder"), "crane foot E prompt");
        await Shot("crane-foot"); Require(Interact.I.Press(Key.E), "E grips crane ladder");
        Jef.I.SetKey(Key.W, true);
        Require(await Until(() => CraneClimb.I.On == id && !CraneClimb.I.OnLadder, 50), "W climbs onto working crane gallery");
        Jef.I.ClearKeys(); Jef.I.Yaw=rail.LadderAt(id).Deck.Basis.GetEuler().Y+MathF.PI/2; Jef.I.Pitch=-.1f; await Shot("crane-gallery");
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
        while(Time.GetTicksMsec()<end && CraneClimb.I.Local.DistanceTo(target)>.055f)
        {
            var d=target-CraneClimb.I.Local;
            Jef.I.Yaw=Railway.I.LadderAt(CraneClimb.I.On).Deck.Basis.GetEuler().Y+MathF.Atan2(-d.X,-d.Y);
            await Frames(1);
        }
        Jef.I.ClearKeys(); Require(CraneClimb.I.Local.DistanceTo(target)<.06f,$"walk crane gallery to {target}");
    }
    private async Task OmnibusCheck(Api api)
    {
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
        if (!ok) throw new InvalidOperationException(name);
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
        string file = Path.Combine(dir, name + ".png");
        GetViewport().GetTexture().GetImage().SavePng(file);
        pictures.Add(file);
    }
}
