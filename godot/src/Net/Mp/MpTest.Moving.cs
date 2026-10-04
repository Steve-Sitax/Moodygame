using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Play;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.Ui;
using Scheldemist.World;

namespace Scheldemist.Net.Mp;

/// <summary>
/// `--mpmoving` after the walk: the host gives a townsperson an event action; both games agree the host drives him,
/// the guest's claim is refused, the guest draws him from the host's replica, and the release reaches both. Then the
/// host rides an omnibus and the guest draws him in that bus's own frame while it drives. The two games meet through
/// small files in the test folder; every file is deleted afterwards.
/// </summary>
public partial class MpTest
{
    private static readonly string[] movingFiles = { "mpmoving-action.json", "mpmoving-seen.json", "mpmoving-released.json", "mpmoving-release-seen.json", "mpmoving-ride.json", "mpmoving-ride-seen.json" };
    private string MovingFile(string name) => Path.Combine(dir, name);
    private void MovingWrite(string name, object value) => File.WriteAllText(MovingFile(name), JsonSerializer.Serialize(value, Api.Json));
    private async Task<JsonElement?> MovingRead(string name, double seconds)
    {
        if (!await Until(() => File.Exists(MovingFile(name)), seconds)) return null;
        await Frames(3);
        return JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(MovingFile(name)));
    }
    private void MovingClean() { foreach (string f in movingFiles) File.Delete(MovingFile(f)); }

    private static Omnibus.Bus MovingBus() => Omnibus.I.Buses.First(b => b.Line.Id == "kaaien");
    private static void MovingDepart(Omnibus.Bus bus) { bus.DwellT = 0; bus.DepartAt = (MoverClock.Day - 1) * 1440 + MoverClock.HourF * 60; }

    private async Task<bool> HostMoving()
    {
        MovingClean();
        var api = ServerLink.I!.Api!; var town = Main.I.GetNode<Townspeople>("Townspeople"); var actors = Actors.I!;
        var place = town.Data!.Places.Values.First(p => p.Label.Contains("Grote Markt"));
        var candidates = town.Sims.Where(s => !s.ActionHeld && s.R.Age >= 18 && s.R.Work.Kind is not ("guard" or "shop" or "stall" or "tavern") && s.R.Trade != "agent").Take(40).ToArray();
        Townspeople.Sim? npc = null; int actionId = 0;
        foreach (var s in candidates)
        {
            town.ActionHold(s); town.ActionHide(s); s.X = Jef.I.X + 3; s.Z = Jef.I.Z + 5; town.ActionClaim(s);
            await api.ActionsSync(Jef.I.X, Jef.I.Z, new[] { new PersonAt(s.R.Id, s.X, s.Z) });
            var reply = await api.DevAction(s.R.Id, "go_to", place.Label, 30, "Please help me.");
            if (reply.ActionId is int id) { npc = s; actionId = id; break; }
            town.ActionRelease(s);
        }
        if (npc == null) return Fail("no townsperson took an event action");
        if (!await Until(() => actors.Runs.Any(r => r.Action.Id == actionId) && actors.ReplicaOwnerOf(npc.R.Id) == 1 && actors.NpcOwned(npc.R.Id), 15)) return Fail("the host never got the event townsperson from the server");
        var start = new Vector2((float)npc.X, (float)npc.Z);
        MovingWrite("mpmoving-action.json", new { npc = npc.R.Id, id = actionId });
        var seen = await MovingRead("mpmoving-seen.json", 45);
        if (seen == null) return Fail("the guest never answered about the event townsperson");
        doc["moving_claim"] = new Dictionary<string, object?> { ["npc"] = npc.R.Id, ["action"] = actionId, ["host_owner"] = actors.ReplicaOwnerOf(npc.R.Id), ["host_still_owns"] = actors.NpcOwned(npc.R.Id), ["host_walked_m"] = Math.Round(start.DistanceTo(new((float)npc.X, (float)npc.Z)), 2), ["guest"] = seen };
        if (!actors.NpcOwned(npc.R.Id)) return Fail("the guest's claim took the host's event townsperson");
        if (!seen.Value.GetProperty("ok").GetBoolean()) return Fail("the guest's side of the event townsperson failed");

        await api.ActionReport(actionId, "done");
        if (!await Until(() => actors.Runs.All(r => r.Action.Id != actionId) && actors.ReplicaOwnerOf(npc.R.Id) == 0, 20)) return Fail("the finished action never released its townsperson");
        MovingWrite("mpmoving-released.json", new { npc = npc.R.Id });
        var released = await MovingRead("mpmoving-release-seen.json", 30);
        doc["moving_release"] = released;
        if (released?.GetProperty("ok").GetBoolean() != true) return Fail("the guest never heard the release");

        var bus = MovingBus(); Omnibus.I.JourneyTestStop(bus, "werf");
        var step = Ride.StepOf(bus); Jef.I.Place(step.X - MathF.Sin(bus.Yaw) * .8f, step.Z - MathF.Cos(bus.Yaw) * .8f, bus.Yaw + MathF.PI); await Frames(5);
        await Ride.I.Board(bus);
        if (!await Until(() => Ride.I.Bus == bus && !Ride.I.Busy, 10)) return Fail("the host could not board the omnibus");
        MovingWrite("mpmoving-ride.json", new { bus = bus.Index, stop = "werf" });
        await Frames(20); MovingDepart(bus);
        var at = new Vector2(Jef.I.X, Jef.I.Z);
        var ride = await MovingRead("mpmoving-ride-seen.json", 45);
        doc["moving_ride"] = new Dictionary<string, object?> { ["bus"] = bus.Index, ["host_moved_m"] = Math.Round(at.DistanceTo(new(Jef.I.X, Jef.I.Z)), 2), ["guest"] = ride };
        await Ride.I.Leave(); MovingClean();
        if (ride?.GetProperty("ok").GetBoolean() != true) return Fail("the guest did not draw the host riding the omnibus");
        return true;
    }

    private async Task<bool> GuestMoving()
    {
        var tg = Together.I!; var town = Main.I.GetNode<Townspeople>("Townspeople"); var actors = Actors.I!;
        var action = await MovingRead("mpmoving-action.json", 90);
        if (action == null) return Fail("the host gave no event townsperson");
        string npc = action.Value.GetProperty("npc").GetString()!; int id = action.Value.GetProperty("id").GetInt32();
        bool run = await Until(() => actors.Runs.Any(r => r.Action.Id == id) && actors.ReplicaOwnerOf(npc) == 1, 20);
        actors.TestClaim(npc);
        await Until(() => false, 2);
        bool refused = actors.ReplicaOwnerOf(npc) == 1 && !actors.NpcOwned(npc);
        var person = town.ActionPerson(npc);
        var from = person == null ? Vector2.Zero : new Vector2((float)person.X, (float)person.Z);
        bool follows = person != null && await Until(() => new Vector2((float)person.X, (float)person.Z).DistanceTo(from) > 1, 15);
        bool ok = run && refused && follows;
        MovingWrite("mpmoving-seen.json", new { ok, run, owner = actors.ReplicaOwnerOf(npc), refused, follows, moved_m = person == null ? 0 : Math.Round(from.DistanceTo(new((float)person.X, (float)person.Z)), 2) });
        if (!ok) return Fail($"event townsperson: run {run}, refused {refused}, follows {follows}");

        if (await MovingRead("mpmoving-released.json", 60) == null) return Fail("the host never released the townsperson");
        bool free = await Until(() => actors.ReplicaOwnerOf(npc) == 0 && actors.Runs.All(r => r.Action.Id != id), 20);
        MovingWrite("mpmoving-release-seen.json", new { ok = free, owner = actors.ReplicaOwnerOf(npc) });
        if (!free) return Fail("the release never reached the guest");

        var ride = await MovingRead("mpmoving-ride.json", 60);
        if (ride == null) return Fail("the host never boarded");
        var bus = Omnibus.I.Buses.First(b => b.Index == ride.Value.GetProperty("bus").GetInt32());
        Omnibus.I.JourneyTestStop(bus, ride.Value.GetProperty("stop").GetString()!); await Frames(20); MovingDepart(bus);
        var stand = bus.Frame.GlobalTransform * new Vector3(6, 0, 0); Jef.I.Place(stand.X, stand.Z, 0);
        // How far the drawn host stands outside the omnibus body (3.6 m ahead) and its back platform (4.2 m behind); 0 = aboard.
        Vector3 local = Vector3.Zero; float Gap() { if (tg.PlayerAt(1) is not { } p) return float.PositiveInfinity; var l = local = bus.Frame.GlobalTransform.AffineInverse() * p; return Math.Max(Math.Abs(l.X) - 1.3f, 0) + Math.Max(l.Z - 3.6f, 0) + Math.Max(-4.2f - l.Z, 0); }
        bool aboard = await Until(() => Gap() < .05f, 10);
        lookAt = tg.PlayerAt(1); await Until(() => { lookAt = tg.PlayerAt(1); return Math.Abs(Mathf.AngleDifference(Main.I.Cam.GlobalRotation.Y, Jef.I.Yaw)) < .05f; }, 3); await Frames(2);
        float eyeToBus = Main.I.Cam.GlobalPosition.DistanceTo(bus.Frame.GlobalPosition);
        var cam = Main.I.Cam; var mid = bus.Frame.GlobalPosition + Vector3.Up; bool busInView = !cam.IsPositionBehind(mid) && new Rect2(Vector2.Zero, Main.I.View.Size).HasPoint(cam.UnprojectPosition(mid)); bool bodyShown = bus.Body.IsVisibleInTree();
        // The guest's character sheet is still open (it comes last): the picture shows the street, not the sheet.
        Main.I.Ui.Visible = false; if (tg.PlayerAt(1) is { } aim) Main.I.Cam.LookAt(aim + Vector3.Up * .6f); await Frames(1);
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, "mp_guest_ride.png"));
        Main.I.Ui.Visible = true;
        lookAt = null;
        var start = tg.PlayerAt(1) ?? Vector3.Zero; float worst = 0;
        bool travels = await Until(() => { worst = Math.Max(worst, Gap()); return tg.PlayerAt(1) is { } p && new Vector2(p.X, p.Z).DistanceTo(new(start.X, start.Z)) > 2; }, 15);
        bool okRide = aboard && travels && worst < .3f;
        MovingWrite("mpmoving-ride-seen.json", new { ok = okRide, aboard, travels, eye_to_bus_m = Math.Round(eyeToBus, 1), bus_in_view = busInView, body_shown = bodyShown, worst_gap_m = Math.Round(worst, 2), local = new[] { local.X, local.Y, local.Z }, shown = tg.FigureOf(1)?.Shown });
        doc["moving"] = new { claim = ok, release = free, ride = okRide, worst_gap_m = Math.Round(worst, 2) };
        if (!okRide) return Fail("the host was not drawn in the moving omnibus");

        // The guest's own arrival: the host's server asks this seat for a character; Start submits it and boards the ferry.
        bool sheet = await Until(() => Menu.CharacterSheet.IsOpen, 20);
        if (sheet) BakedWorld.All(Main.I.Ui).OfType<InkButton>().First(b => b.Name == "start").EmitSignal(BaseButton.SignalName.Pressed);
        bool made = sheet && await Until(() => !Menu.CharacterSheet.IsOpen && FerryArrival.I.Stage == "waiting", 20);
        bool asked = made && (await ServerLink.I!.Api!.Arrival()).Creator;
        doc["guest_creator"] = new { sheet, made, asked_again = asked, name = GameState.I.PlayerName };
        if (!made || asked) return Fail("the guest's character sheet did not reach the ferry");
        return true;
    }
}
