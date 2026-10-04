using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Nonempty, frozen rendered pictures: original uploads versus exact cached uploads, with a positive control.</summary>
public static class PixelComparison
{
    private static int Different(Image a, Image b)
    {
        a.Convert(Image.Format.Rgba8); b.Convert(Image.Format.Rgba8);
        if (a.GetSize() != b.GetSize()) throw new InvalidOperationException("picture dimensions changed");
        var x = a.GetData(); var y = b.GetData(); int n = 0; long sum = 0;
        for (int i = 0; i < x.Length; i += 4)
        {
            sum += x[i] + x[i + 1] + x[i + 2];
            if (x[i] != y[i] || x[i + 1] != y[i + 1] || x[i + 2] != y[i + 2] || x[i + 3] != y[i + 3]) n++;
        }
        if (sum == 0) throw new InvalidOperationException("black readback: no picture compared");
        return n;
    }
    private static async Task Draw(Checks check)
    {
        Mirrors? mirrors = Main.I.GetNodeOrNull<Mirrors>("Mirrors");
        for (int i = 0; i < 4; i++)
        {
            mirrors?._Process(0);
            await check.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        }
    }
    public static async Task<object> Run(Checks check)
    {
        var rows = new List<object>(); int total = 0, controlPixels = 0, actionChecks = 0, actionDifferences = 0, floorChecks = 0, floorDifferences = 0, roomChecks = 0, roomDifferences = 0, routeChecks = 0, routeDifferences = 0, hudChecks = 0, hudDifferences = 0;
        object scheduleProof = SpeedComparison.ScheduleProof();
        int deedsChecks = 0, deedsDifferences = 0;
        int providerChecks = 0, providerDifferences = 0;
        var cases = new List<(double hour, string weather, string place, string scenario)>();
        foreach (var (hour, weather) in new[] { (13.0, "clear"), (22.0, "mist") })
        foreach (string place in new[] { "grote markt", "cathedral", "handschoenmarkt", "vismarkt", "rijnkaai" })
            cases.Add((hour, weather, place, "idle"));
        foreach (string scenario in new[] { "carry", "watch" })
        foreach (var (hour, weather) in new[] { (13.0, "clear"), (22.0, "mist") }) cases.Add((hour, weather, "vismarkt", scenario));
        string activeScenario = "idle";
        foreach (var (hour, weather, place, scenario) in cases)
        {
            if (scenario != activeScenario)
            {
                if (Play.Jobs.I.Active is { } active)
                {
                    await Net.ServerLink.I!.Api!.GiveUp(active.Id);
                    Game.GameState.I.Apply(await Net.ServerLink.I.Api.Jobs());
                }
                await Kit.I.Job(scenario == "carry" ? "{\"type\":\"carry\",\"items\":2,\"goods\":\"crates\"}" : "{\"type\":\"watch\",\"goods\":\"crates\",\"duration_s\":1200}");
                activeScenario = scenario;
            }
            await Kit.I.Light(hour, weather); check.At(place); await check.Frames(120);
            hudChecks++; if (!Play.Jobs.I.SameRunHud()) hudDifferences++;
            var people = Kit.I.People!;
            void Provider(bool same) { providerChecks++; if (!same) providerDifferences++; }
            Provider(Play.Doors.I.SameKeys(Player.Jef.I.X, Player.Jef.I.Z));
            Provider(Play.Ride.I.SameKeys(Player.Jef.I.X, Player.Jef.I.Z));
            Provider(Play.Rowing.I.SameKeys(Player.Jef.I.X, Player.Jef.I.Z));
            Provider(Play.Velocipedes.I.SameKeys(Player.Jef.I.X, Player.Jef.I.Z));
            foreach (var door in Play.Doors.I.All)
            {
                Provider(Play.Doors.I.SameKeys(door.Step.X, door.Step.Y));
                Provider(Play.Doors.I.SameKeys(door.Step.X + 1.8f, door.Step.Y));
            }
            foreach (var bus in Movers.Omnibus.I.Buses)
            {
                var step = Play.Ride.StepOf(bus);
                Provider(Play.Ride.I.SameKeys(step.X, step.Z));
            }
            foreach (var landing in Play.Rowing.I.Data.Landings)
                Provider(Play.Rowing.I.SameKeys(landing.Landing[0], landing.Landing[1]));
            foreach (var boat in Play.Rowing.I.Drawings.Values)
                Provider(Play.Rowing.I.SameKeys(boat.X, boat.Z));
            int residentIndex = 0;
            foreach (var resident in people.Simulations)
            {
                deedsChecks++;
                if (!ReferenceEquals(resident, people.Sims[residentIndex++])) deedsDifferences++;
                if (resident.P is not { } person || resident.Inside) continue;
                foreach (float side in new[] { -1.3f, 1.3f })
                {
                    deedsChecks++;
                    if (!Play.Deeds.I.SameKeys((float)person.X + MathF.Sin((float)person.Yaw) * side, (float)person.Z + MathF.Cos((float)person.Yaw) * side)) deedsDifferences++;
                }
            }
            deedsChecks++;
            if (residentIndex != people.Sims.Count || !Play.Deeds.I.SameKeys(Player.Jef.I.X, Player.Jef.I.Z)) deedsDifferences++;
            foreach (var door in Play.Doors.I.All)
            {
                bool previous = SpeedComparison.Cached;
                try
                {
                    SpeedComparison.Cached = false; var original = Play.Doors.I.Get(door.Id);
                    SpeedComparison.Cached = true;
                    if (original != Play.Doors.I.Get(door.Id)) throw new InvalidOperationException("door lookup differs from original");
                }
                finally { SpeedComparison.Cached = previous; }
            }
            foreach (var resident in Kit.I.People!.Data!.Residents) { routeChecks++; if (!Kit.I.People.SameDayRoute(resident)) routeDifferences++; }
            actionChecks++; if (!Play.Interact.I.SameActions()) actionDifferences++;
            var jef = Player.Jef.I;
            for (int x = -4; x <= 4; x++) for (int z = -4; z <= 4; z++)
            { roomChecks++; if (!Rooms.I.SameSelection(jef.Cam.GlobalPosition + new Vector3(x * 4, 0, z * 4))) roomDifferences++; }
            for (int x = -4; x <= 4; x++) for (int z = -4; z <= 4; z++)
            foreach (float feet in new[] { -2f, 0f, .3f, 1f, 3f, 8f })
            foreach (float radius in new[] { 0f, Player.Jef.Radius * .6f, .12f, .9f })
            {
                floorChecks++;
                if (!jef.SameGround(jef.X + x * .5f, jef.Z + z * .5f, feet, radius)) floorDifferences++;
            }
            bool cached = UniformUpdates.Cached;
            bool speedCached = SpeedComparison.Cached;
            check.ProcessMode = Node.ProcessModeEnum.Always;
            Main.I.PictureTime(12); Main.I.GetTree().Paused = true;
            try
            {
                string name = place.Replace(' ', '_') + (hour == 13 ? "_day" : "_night") + (scenario == "idle" ? "" : "_" + scenario);
                UniformUpdates.Cached = false;
                SpeedComparison.Cached = false;
                Daylight.I.RepeatLight(); Lights.I._Process(0); Rooms.I.RepeatVisibility(); Play.Jobs.I._Process(0); Play.Interact.I.RepeatPrompt(); UniformUpdates.Replay(); NodeUpdates.Replay(); Movers.Copies.Replay(); await Draw(check);
                using var a = Main.I.GetViewport().GetTexture().GetImage();
                string before = check.Picture(name + "_before");
                UniformUpdates.Cached = true;
                SpeedComparison.Cached = true;
                Daylight.I.RepeatLight(); Lights.I._Process(0); Rooms.I.RepeatVisibility(); Play.Jobs.I._Process(0); Play.Interact.I.RepeatPrompt(); UniformUpdates.Replay(); NodeUpdates.Replay(); Movers.Copies.Replay(); await Draw(check);
                using var b = Main.I.GetViewport().GetTexture().GetImage();
                string after = check.Picture(name + "_after");
                int different = Different(a, b); total += different;
                // A deliberately wrong fog colour must be detected by the same readback and comparison.
                var fog = UniformUpdates.LatestGlobal("psx_fog_color");
                Psx.Set("psx_fog_color", new Vector4(1, 0, 1, 1)); await Draw(check);
                using var wrong = Main.I.GetViewport().GetTexture().GetImage();
                int control = Different(b, wrong); controlPixels += control;
                Psx.Set("psx_fog_color", fog);
                rows.Add(new { place, hour, weather, scenario, different, control, before, after, size = new[] { a.GetWidth(), a.GetHeight() } });
                GD.Print($"pixelcheck: {name}, {different} pixels differ, control {control}");
            }
            finally { UniformUpdates.Cached = cached; SpeedComparison.Cached = speedCached; Main.I.PictureTime(-1); Main.I.GetTree().Paused = false; }
        }
        return new { ok = total == 0 && controlPixels > 0 && actionDifferences == 0 && floorDifferences == 0 && roomDifferences == 0 && routeDifferences == 0 && hudDifferences == 0 && deedsDifferences == 0 && providerDifferences == 0 && System.Text.Json.JsonSerializer.SerializeToElement(scheduleProof).GetProperty("ok").GetBoolean(), differentPixels = total, controlPixels, comparisons = rows, scheduleProof, actionProof = new { actionChecks, actionDifferences }, floorProof = new { floorChecks, floorDifferences }, roomProof = new { roomChecks, roomDifferences }, routeProof = new { routeChecks, routeDifferences }, hudProof = new { hudChecks, hudDifferences }, deedsProof = new { deedsChecks, deedsDifferences }, providerProof = new { providerChecks, providerDifferences },
            method = "RGBA8 full screen including retro grain, paused scene and fixed grain; original/cached uniforms, node and MultiMesh poses, reflections, rooms, interaction prompts and active-job HUD; exact schedule, route, floor, room, action and job comparisons; deliberately wrong fog colour as positive control" };
    }
}
