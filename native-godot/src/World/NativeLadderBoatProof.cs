using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// #195: a household's boat moored at a quay ladder, on her real errand. Her people climb down the ladder into her before
/// she casts off (the ladder clip on its rungs), and when she comes home from the flight she rowed to they climb up it
/// to the quay. Pictures from the water at 13:00 in clear weather, in rain and at 19:30. Run by NativeJourneyGameplayProof
/// (--native-journey-scope ladder-boat) in its disposable world.
/// </summary>
public static class NativeLadderBoatProof
{
    public static async Task Run(NativeTownGame game, string output, Action<string, bool> check, Func<int, Task> frames, Func<Func<bool>, double, Task<bool>> until, List<object> observations, List<string> pictures)
    {
        var api = ServerLink.I!.Api!; var town = game.GetNode<Townspeople>("Townspeople"); var journeys = ResidentJourneys.I!;
        ResidentVehicle? boat = null; ResidentErrand? errand = null;
        for (int day = 1; day <= 6 && boat == null; day++)
        {
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day, hour = 6, minute = 0, weather = "clear" }));
            Scheldemist.Movers.MoverClock.Hold(6, day); await frames(12); await journeys.LoadTransport(); await until(() => journeys.Transport?.Day == day, 12);
            // (the one whose ladder is longest above the water: the river's, at low water)
            errand = journeys.Transport?.Errands.Where(e => e.Kind == "boat" && journeys.Transport.Vehicles.FirstOrDefault(v => v.Id == e.Vehicle)?.Boat?.Board == "ladder" && e.Who.All(id => town.ActionPerson(id) is { ActionHeld: false }))
                .OrderByDescending(e => { var f = journeys.Transport.Vehicles.First(v => v.Id == e.Vehicle).Boat!.Flight; return -Water.Level((float)f[0], (float)f[1]); }).FirstOrDefault();
            if (errand != null) boat = journeys.Transport!.Vehicles.First(v => v.Id == errand.Vehicle);
        }
        check("a household's boat moored at a ladder has a published errand", boat != null && errand != null);
        var ladders = journeys.Transport!.Vehicles.Where(v => v.Boat?.Board == "ladder").Select(v => new { v.Id, v.Owner, v.Label, home = v.Home, flight = v.Boat!.Flight }).ToArray();
        observations.Add(new { mode = "ladder_boats", ladders, errand = new { errand!.Id, errand.Who, errand.To, errand.ToLabel, errand.Hour } });
        var top = new Vector2((float)boat!.Boat!.Flight[0], (float)boat.Boat.Flight[1]);
        var exit = QuayExits.Exits.Where(x => x.Ladder && new Vector2(x.Wx, x.Wz).DistanceTo(top) < 1.5f).OrderBy(x => new Vector2(x.Wx, x.Wz).DistanceTo(top)).FirstOrDefault();
        check("her mooring's ladder is a native quay ladder", exit?.Of != null);
        var l = exit!.Of!; var n = new Vector3(exit.Nx, 0, exit.Nz); var side = new Vector3(n.Z, 0, -n.X); var wall = new Vector3(exit.Wx, 0, exit.Wz); var line = wall + n * (l.Rung + .30f);
        Look(game, wall - n * 3 + Vector3.Up * 2.5f, wall + n * 2); await frames(20);

        // (the pictures in daylight: the clock to 12:30 once her errand is chosen, her people still at home)
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour = 12, minute = 30, weather = "clear" }));
        Scheldemist.Movers.MoverClock.Hold(12.5, GameState.I.Day); await frames(10);
        // out: down the ladder into her
        bool started = journeys.JourneyTestErrand(boat.Id);
        if (!started)
        {
            var moor = new Vector2((float)boat.Home[0], (float)boat.Home[1]); var to0 = new Vector2((float)errand.To[0], (float)errand.To[1]);
            var rb = Rowing.I.Data.Boats.FirstOrDefault(b => b.Id == boat.Id);
            observations.Add(new { mode = "ladder_start_failed", notes = journeys.Notes.TakeLast(12).ToArray(), homeFree = Rowing.I.ResidentWaterFree(moor.X, moor.Y),
                boatState = rb == null ? null : new { rb.Ridden, rb.Lost, rb.Mine, rb.X, rb.Z, hx = rb.Home.X, hz = rb.Home.Z },
                ownerHeld = town.ActionPerson(boat.Owner)?.ActionHeld, path = JourneyRules.WaterPath((x, z) => Rowing.I.ResidentWaterFree((float)x, (float)z), new(moor.X, moor.Y), new(to0.X, to0.Y), 2, 40)?.Length });
        }
        check("the ladder boat's errand starts from her mooring", started);
        var owner = town.ActionPerson(boat.Owner)!; var trip = owner.Journey!;
        check("her people reach the ladder's head and she has them aboard by the ladder", await until(() => trip.Phase == "row" && Rowing.I.Drawings.ContainsKey("town:" + boat.Id), 90));
        var hull = Rowing.I.Drawings["town:" + boat.Id]; var cast = new Vector2(hull.X, hull.Z);
        var down = await Follow(game, frames, boat.Id, line, l, output, "ladder-down", pictures, observations);
        bool boarded = await until(() => Rowing.I.ResidentWalkersDone(boat.Id), 60);
        observations.Add(new { mode = "ladder_down_trace", down.Trace, top = l.Top, foot = l.Foot });
        check("they climb down the rungs with the ladder clip, from the quay to her floor", down.Climbed && down.High > l.Top - .2f && down.Low < Water.Level(line.X, line.Z) + 1.2f);
        check("all of them are aboard before she casts off", boarded && new Vector2(hull.X, hull.Z).DistanceTo(cast) < .3f && trip.BoatTrip!.Crew.All(id => town.ActionPerson(id)?.Aboard == true));
        observations.Add(new { mode = "ladder_down", down.High, down.Low, down.Samples, crew = trip.BoatTrip!.Crew, down.Trace });
        await frames(60);
        var state = Rowing.I.ResidentNetState();
        check("the shared world carries her out with her crew", state["boats"]!.AsArray().Any(b => b?["id"]?.GetValue<string>() == boat.Id && b?["_crew"]?.AsArray().Count == Math.Min(3, trip.BoatTrip.Crew.Count)));
        journeys.JourneyTestCancel(boat.Owner); await frames(5);

        // home: from the flight she rowed to, back to her ladder and up it
        var to = new Vector2((float)errand.To[0], (float)errand.To[1]);
        Look(game, new Vector3(to.X, 4, to.Y) + new Vector3(0, 0, 0) - n * 2, new Vector3(to.X, 0, to.Y) + n * 4); await frames(20);
        check("her errand home starts at the flight she rowed to", journeys.JourneyTestErrand(boat.Id, home: true, from: to));
        trip = owner.Journey!;
        bool rowing = await until(() => { if (Rowing.I.Drawings.TryGetValue("town:" + boat.Id, out var d)) Follow(game, d); return trip.Phase is "row" or "landing" or "walkon"; }, 120);
        check("she rows home from the flight", rowing);
        bool home = await until(() => { if (Rowing.I.Drawings.TryGetValue("town:" + boat.Id, out var d)) Follow(game, d); return trip.Phase is "landing" or "walkon"; }, 330);
        observations.Add(new { mode = "ladder_home", home, phase = trip.Phase, time = trip.Time, report = Rowing.I.ResidentBoatReport(boat.Id) is { } br ? JsonSerializer.Serialize(br) : null, walkersDone = Rowing.I.ResidentWalkersDone(boat.Id), notes = journeys.Notes.TakeLast(6).ToArray() });
        check("she comes home to her ladder", home && trip.Phase == "landing" && !Rowing.I.ResidentWalkersDone(boat.Id));
        var up = await Follow(game, frames, boat.Id, line, l, output, "ladder-up", pictures, observations);
        bool ashore = await until(() => trip.Phase == "walkon" || Rowing.I.ResidentWalkersDone(boat.Id), 60);
        var where = (Rowing.I.ResidentWalkersReport(boat.Id) is { } r ? JsonSerializer.Serialize(r) : "");
        observations.Add(new { mode = "ladder_up_trace", up.Trace });
        check("they climb up the rungs with the ladder clip, from her floor to the quay", up.Climbed && up.Low < Water.Level(line.X, line.Z) + 1.2f && up.High > l.Top - .2f);
        check("they stand on the quay behind the ladder's head", ashore && up.Last.Y > l.Top - .25f && new Vector2(up.Last.X - exit.Tx, up.Last.Z - exit.Tz).Length() < 3f);
        observations.Add(new { mode = "ladder_up", up.High, up.Low, up.Samples, last = new[] { up.Last.X, up.Last.Y, up.Last.Z }, where, up.Trace });
        journeys.JourneyTestCancel(boat.Owner); await frames(5);
    }

    /// <summary>The camera behind her and over her (never in the water ahead: a boat waits for whoever is there).</summary>
    private static void Follow(NativeTownGame game, Rowing.Drawn d)
    {
        var at = new Vector3(d.X, 0, d.Z); var back = -new Vector3(MathF.Sin(d.Yaw), 0, MathF.Cos(d.Yaw));
        Look(game, at + back * 6 + Vector3.Up * 6, at);
    }

    private sealed record Climb(bool Climbed, float High, float Low, int Samples, Vector3 Last, List<string> Trace);

    /// <summary>Samples her walkers until they are done: the heights climbed on the rungs' line with the ladder clip, and
    /// pictures of the first climber high, halfway and low on the ladder (13:00 clear, rain at the middle, 19:30 low down).</summary>
    private static async Task<Climb> Follow(NativeTownGame game, Func<int, Task> frames, string id, Vector3 line, QuayExits.Ladder l, string output, string name, List<string> pictures, List<object> observations)
    {
        float high = float.MinValue, low = float.MaxValue; int samples = 0; bool climbed = false; var last = Vector3.Zero; var trace = new List<string>();
        // high on the ladder, halfway down the quay wall, and low by the boat (her floor lies near the water)
        float water = Water.Level(line.X, line.Z);
        var shots = new List<(float y, string tag)> { (l.Top - .6f, "high"), ((l.Top + water) / 2, "mid"), (water + 1.0f, "low") };
        var end = DateTime.UtcNow.AddSeconds(70);
        while (DateTime.UtcNow < end && !Rowing.I.ResidentWalkersDone(id))
        {
            await frames(3);
            if (Rowing.I.ResidentWalkersReport(id) is not { } report) continue; // (she is still being drawn in to her mooring)
            var json = JsonDocument.Parse(JsonSerializer.Serialize(report)).RootElement;
            bool first = true;
            foreach (var w in json.EnumerateArray())
            {
                if (w.GetProperty("at").ValueKind != JsonValueKind.Array) continue;
                var a = w.GetProperty("at"); var p = new Vector3(a[0].GetSingle(), a[1].GetSingle(), a[2].GetSingle());
                if (first) last = p;
                bool onLine = new Vector2(p.X - line.X, p.Z - line.Z).Length() < .06f;
                if (trace.Count < 400) trace.Add($"{p.Y:0.00} {new Vector2(p.X - line.X, p.Z - line.Z).Length():0.00} {w.GetProperty("motion")} {w.GetProperty("I")}/{w.GetProperty("n")}");
                if (onLine && w.GetProperty("motion").GetString() == "work:ladder") { climbed = true; high = Math.Max(high, p.Y); low = Math.Min(low, p.Y); samples++; }
                if (first && onLine && shots.Count > 0 && (name == "ladder-down" ? p.Y < shots[0].y : p.Y > shots[^1].y))
                {
                    var (_, tag) = name == "ladder-down" ? shots[0] : shots[^1];
                    if (name == "ladder-down") shots.RemoveAt(0); else shots.RemoveAt(shots.Count - 1);
                    await Pictures(game, frames, output, $"{name}-{tag}", p, pictures, observations);
                }
                first = false;
            }
        }
        return new Climb(climbed, high, low, samples, last, trace);
    }

    /// <summary>The climber from over the water: full body at 3 m, and close at 0.6 m at the hands; 13:00 clear, rain, 19:30
    /// (the light and the weather of the picture only: the town's clock stays). Her walkers wait while they are taken.</summary>
    private static async Task Pictures(NativeTownGame game, Func<int, Task> frames, string output, string name, Vector3 at, List<string> pictures, List<object> observations)
    {
        Rowing.I.HoldWalkers = true; Main.I.Ui.Visible = false;
        try
        {
            foreach (var (hour, weather) in new[] { (13f, "clear"), (13f, "rain"), (19.5f, "clear") })
            {
                Daylight.I!.SetTime(hour); Daylight.I.SetWeather(weather); Daylight.I.Settle();
                foreach (var (tag, eye, look) in Views(at))
                {
                    Look(game, eye, look); await frames(6);
                    string file = $"{name}-{tag}-{(weather == "rain" ? "rain" : hour > 18 ? "night" : "day")}.png";
                    game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, file)); pictures.Add(file);
                    observations.Add(new { mode = "capture", name = file, eye = eye.ToString(), at = at.ToString() });
                }
            }
        }
        finally
        {
            Rowing.I.HoldWalkers = false; Main.I.Ui.Visible = true;
            Daylight.I!.SetTime((float)GameState.I.HourF); Daylight.I.SetWeather(GameState.I.Weather); Daylight.I.Settle();
        }
    }

    private static IEnumerable<(string, Vector3, Vector3)> Views(Vector3 at)
    {
        var e = QuayExits.Exits.Where(x => x.Ladder).OrderBy(x => new Vector2(x.Gx - at.X, x.Gz - at.Z).LengthSquared()).First();
        var n = new Vector3(e.Nx, 0, e.Nz); var side = new Vector3(n.Z, 0, -n.X);
        yield return ("full", at + n * 3f + side * .9f + Vector3.Up * 1.0f, at + Vector3.Up * .9f);
        yield return ("close", at + n * .6f + side * .35f + Vector3.Up * 1.75f, at - n * .3f + Vector3.Up * 1.75f);
    }

    private static void Look(NativeTownGame game, Vector3 eye, Vector3 at)
    {
        if (!Scheldemist.Player.Jef.I.Fly) Scheldemist.Player.Jef.I.ToggleFly();
        Scheldemist.Player.Jef.I.Place(eye.X, eye.Z, 0, 0, eye.Y);
        game.Cam.LookAtFromPosition(eye, at, Vector3.Up);
        if (game.Cam is Scheldemist.Player.FlyCam fly) fly.Face(game.Cam.GlobalBasis.GetRotationQuaternion());
    }
}
