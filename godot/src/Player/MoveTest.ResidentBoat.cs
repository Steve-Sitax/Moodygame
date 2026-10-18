using System;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Play;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>
/// Issue 154 (`--moveonly resboat`): the households' boats and their errands (the family boats, the residents' boats at
/// the steps, out twice a working day); then one trip: the crew walks down the steps into her, she rows to the other
/// flight, they step out and walk up the steps to the quay.
/// </summary>
public partial class MoveTest
{
    private async Task ResidentBoatCheck()
    {
        var j = Jef.I;
        var api = Scheldemist.Net.ServerLink.I!.Api!;
        var journeys = ResidentJourneys.I!;
        var town = Main.I.GetNode<Scheldemist.Town.Townspeople>("Townspeople");
        Scheldemist.Net.ResidentErrand? errand = null;
        Scheldemist.Net.ResidentVehicle? vehicle = null;
        object? week = null;
        for (int day = 1; day <= 6 && errand == null; day++)
        {
            Scheldemist.Game.GameState.I.Apply(await api.Post<Scheldemist.Net.JobsPayload>("api/dev/set", new { day, hour = 6, minute = 0, weather = "clear" }));
            MoverClock.Hold(6, day); await Frames(12);
            await journeys.LoadTransport(); await Until(() => journeys.Transport?.Day == day, 12);
            var t = journeys.Transport;
            if (t == null) continue;
            var boats = t.Vehicles.Where(v => v.Kind == "boat").ToList();
            var trips = t.Errands.Where(e => e.Kind == "boat").ToList();
            week ??= new { day, boats = boats.Select(v => new { v.Id, v.Label, kind = v.Boat?.Kind, home = v.Home.Take(2).ToArray() }).ToArray(), errands = trips.Select(e => new { e.Id, e.Vehicle, e.Hour, e.Back, who = e.Who.Count, e.ToLabel }).ToArray() };
            errand = trips.FirstOrDefault(e => e.Who.All(id => town.ActionPerson(id) is { ActionHeld: false }) && t.Vehicles.Any(v => v.Id == e.Vehicle && v.Boat is { Flight.Length: >= 2 }));
            if (errand != null) vehicle = t.Vehicles.First(v => v.Id == errand.Vehicle);
        }
        reports.Add(new { residentBoats = week });
        var wk = journeys.Transport!;
        int boatCount = wk.Vehicles.Count(v => v.Kind == "boat"), errandsToday = wk.Errands.Count(e => e.Kind == "boat");
        Check(boatCount > 3 && errandsToday >= boatCount, "more households have boats and each goes out twice a working day", new { boatCount, errandsToday });
        if (errand == null || vehicle == null) { Check(false, "a boat errand with a free crew"); return; }
        // (pictures by day) stand at her flight's head and watch them go down
        await Tidy(13);
        var top = new Vector2((float)vehicle.Boat!.Flight[0], (float)vehicle.Boat.Flight[1]);
        var f = QuayExits.FlightAt(top.X, top.Y);
        if (f is { } fl) { var eye = QuayExits.OnFlight(fl, 0.3f, -2.5f); await Settle(eye.X, eye.Z, Facing(fl.Tx + fl.Nx, fl.Tz + fl.Nz), -0.35f); }
        Check(journeys.JourneyTestErrand(vehicle.Id), $"{vehicle.Label} sets out on her errand to {errand.ToLabel}", new { errand.Id, who = errand.Who });
        var rower = town.ActionPerson(errand.Who[0])!;
        bool rowing = await Until(() => rower.Journey?.Phase == "row" && Rowing.I.Drawings.ContainsKey("town:" + vehicle.Id), 70);
        bool walking = rowing && !Rowing.I.ResidentWalkersDone(vehicle.Id);
        await Frames(60);
        var walkersEarly = Rowing.I.ResidentWalkersReport(vehicle.Id);
        await Shot("resboat-boarding");
        var hull = rowing ? Rowing.I.Drawings["town:" + vehicle.Id] : null;
        var cast = hull == null ? Vector2.Zero : new Vector2(hull.X, hull.Z);
        bool boarded = await Until(() => Rowing.I.ResidentWalkersDone(vehicle.Id), 45);
        bool stayed = hull != null && new Vector2(hull.X, hull.Z).DistanceTo(cast) < 0.3f;
        Check(rowing && walking && boarded && stayed, "the crew walks down the steps into her before she casts off", new { rowing, walking, boarded, stayed, walkersEarly, walkersLate = Rowing.I.ResidentWalkersReport(vehicle.Id) });
        await Frames(30);
        await Shot("resboat-aboard");
        // she rows to the other flight; Jef waits at its head
        var to = rower.Journey?.BoatTrip?.ToTop ?? top;
        if (QuayExits.FlightAt(to.X, to.Y) is { } tf) { var eye = QuayExits.OnFlight(tf, 0.3f, -2.5f); await Settle(eye.X, eye.Z, Facing(tf.Tx + tf.Nx, tf.Tz + tf.Nz), -0.35f); }
        var route = new System.Collections.Generic.List<object?>();
        bool landing = await Until(() => { if (Engine.GetProcessFrames() % 120 == 0) route.Add(Rowing.I.ResidentBoatReport(vehicle.Id)); return rower.Journey?.Phase == "landing"; }, 300);
        if (!landing) reports.Add(new { stuckRoute = route.TakeLast(12).ToArray(), path = rower.Journey?.BoatTrip?.Path.Select(p => new[] { R((float)p.X), R((float)p.Z) }).ToArray() });
        await Frames(90);
        await Shot("resboat-landing");
        bool up = await Until(() => rower.Journey?.Phase != "landing", 50);
        await Frames(20);
        var crewAt = errand.Who.Select(id => town.ActionPerson(id)).Where(s => s != null).Select(s => new Vector2((float)s!.X, (float)s.Z)).ToArray();
        await Shot("resboat-ashore");
        Check(landing && up && crewAt.All(p => p.DistanceTo(to) < 6), "at the other flight they step out and walk up the steps to the quay", new { landing, up, crew = crewAt.Select(p => new[] { R(p.X), R(p.Y) }).ToArray(), top = new[] { to.X, to.Y } });
    }
}
