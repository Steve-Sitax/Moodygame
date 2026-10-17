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
using Scheldemist.Play;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// The opening ferry, the Werf landing stage and its two bridges in the real native town, in a disposable proof save.
/// Takes pictures of the stage, the tidal bridge and the gangway at three tides, then follows the ferry as she
/// moors, is walked off by the guide, hauls in her gangway and leaves. Writes arrival-pier.json and the pictures.
/// </summary>
public static class NativeArrivalPierProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        var checks = new List<object>(); var notes = new List<object>(); var pictures = new List<string>(); string error = "";
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task<bool> Until(Func<bool> ready, double seconds) { var end = DateTime.UtcNow.AddSeconds(seconds); while (DateTime.UtcNow < end) { if (ready()) return true; await Frames(3); } return ready(); }
        // a failed check is kept and the run goes on: one run shows every picture
        void Check(string name, bool passed) { checks.Add(new { name, passed }); if (!passed) error += name + "; "; }
        async Task Shot(string name, Vector3 eye, Vector3 focus, float fov = 62)
        {
            var capture = new Camera3D { Name = "ArrivalPierCapture", Fov = fov, Near = .05f, Far = game.Cam.Far, CullMask = game.Cam.CullMask, Environment = game.Cam.Environment };
            game.World.AddChild(capture);
            capture.GlobalTransform = new Transform3D(Basis.Identity, eye).LookingAt(focus, Vector3.Up);
            capture.MakeCurrent();
            try
            {
                await Frames(10);
                await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, name + ".png")); pictures.Add(name + ".png");
            }
            finally { game.Cam.MakeCurrent(); capture.QueueFree(); }
        }
        async Task HoldTide(float level) { Scheldemist.World.Tide.Hold(level); await Until(() => MathF.Abs(Scheldemist.World.Tide.River - level) < .02f && MathF.Abs(Waters.Level - level) < .05f, 40); await Frames(4); }
        Node3D? Find(string name) => BakedWorld.All(game.World).OfType<Node3D>().FirstOrDefault(n => n.Name.ToString() == name && n.IsVisibleInTree())
            ?? BakedWorld.All(game.View).OfType<Node3D>().FirstOrDefault(n => n.Name.ToString() == name && n.IsVisibleInTree());
        try
        {
            Check("pier proof uses its own disposable database", Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && game.Flag("no-ai"));
            Check("native town and services become ready", await Until(() => game.Loaded && !Loading.Busy && ServerLink.I?.Up == true && GameState.I.Live, 900));
            var api = ServerLink.I!.Api!; MainMenu.I!.Start(); Jef.I.TestInput = true; Pause.Clear(); game.Ui.Visible = false;
            for (int attempt = 1; ; attempt++)  // (a slow first answer on a busy machine is not the proof's business; 60 s as the menu waits)
                try { GameState.I.Apply(await api.Post<JobsPayload>("api/new-game", null, 60_000)); break; }
                catch (ApiException) when (attempt < 4) { await Frames(30); }
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 12, minute = 0, weather = "clear" })); Scheldemist.Movers.MoverClock.Hold(12, 1);
            await HoldTide(-2.8f);
            var f = FerryArrival.I;
            await f.Ask(false);
            Check("the ferry opening starts", await Until(() => f.Stage == "waiting", 30));
            const float x = -249;
            // the pier and its bridge, from the quay and from the water, at three tides
            foreach (var (name, level) in new[] { ("mid", -2.8f), ("high", -.4f), ("low", -5.2f) })
            {
                await HoldTide(level); float w = Waters.Level;
                await Shot($"bridge-{name}-side", new(x + 5.5f, Math.Max(1.6f, w + 2.6f), 2.2f), new(x, (w + 1.8f) / 2, -3.2f), 55);
                await Shot($"bridge-{name}-walk", new(x, 1.9f, 6.5f), new(x, w / 2 + .9f, -5), 60);
                await Shot($"pier-{name}-deck", new(x + .6f, w + 3.1f, -8.5f), new(x - .2f, w + 1.9f, -40), 60);
            }
            // the way along the pier, over the bridge and onto the quay, at each tide: a floor everywhere, no step over 12 cm in 10 cm
            foreach (var (name, level) in new[] { ("mid", -2.8f), ("high", -.4f), ("low", -5.2f) })
            {
                await HoldTide(level); await Frames(3);
                float last = float.NaN, worst = 0, firstMissing = 0; int missing = 0;  // (the report cannot hold a NaN)
                for (float z = -56; z <= 3; z += .1f)
                {
                    float y = f.Foot(x, z);
                    if (!float.IsFinite(y)) { if (missing++ == 0) firstMissing = z; continue; }
                    if (float.IsFinite(last)) worst = MathF.Max(worst, MathF.Abs(y - last)); last = y;
                }
                notes.Add(new { mode = "walk", tide = name, missing, firstMissing, worstStep = worst });
                Check($"a walkable floor from the pier to the quay at {name} water (no gap, no step over 12 cm)", missing == 0 && worst <= .12f);
            }
            await HoldTide(-2.8f);
            await Shot("pier-head-from-quay", new(x, 2.2f, 1.5f), new(x, -.2f, -58), 38);
            await Shot("pier-low-angle", new(x + 2.9f, Waters.Level + 2.5f, -18), new(x - 2f, Waters.Level + 1.4f, -30), 70);
            await Shot("pier-shelter", new(x + 3f, Waters.Level + 3f, -31), new(x - 1.6f, Waters.Level + 2.5f, -42), 60);
            await Shot("pier-head", new(x - 4.5f, Waters.Level + 3.2f, -50), new(x, Waters.Level + 1.8f, -59), 62);
            await Shot("pier-water-side", new(x + 7f, Waters.Level + .8f, -28), new(x, Waters.Level + 1f, -28), 60);
            // the ferry alongside the stage head with her gangway coming down
            await Shot("ferry-bow", new(-258, Waters.Level + 4.5f, -74), f.VesselPosition + new Vector3(0, 2, 0), 56);
            await Shot("ferry-gangway-lowering", new(x - 1.7f, Waters.Level + 3f, -55.5f), new(x, Waters.Level + 1.6f, -60.4f), 55);
            Check("the ferry reaches her mooring", await Until(() => f.Stage == "moored", 30));
            await Shot("ferry-moored-wide", new(x - 9, Waters.Level + 6, -49), new(-244.5f, Waters.Level + 1.5f, -62), 62);
            await Shot("ferry-gangway-top", new(x, Waters.Level + 5.4f, -57.2f), new(x, Waters.Level + 1.7f, -60.6f), 48);
            await Shot("ferry-gangway-pier-side", new(x + 3.1f, Waters.Level + 3.3f, -57.4f), new(x, Waters.Level + 1.7f, -60.7f), 52);
            await Shot("ferry-deck", new(-246.5f, Waters.Level + 4.3f, -57), f.VesselPosition + new Vector3(0, 1.6f, 3), 66);
            await Shot("ferry-paddle-box", new(-239, Waters.Level + 2.4f, -58.5f), f.VesselPosition + new Vector3(1.2f, 1.4f, 0), 60);
            await Shot("ferry-stern", new(-232, Waters.Level + 3f, -66), f.VesselPosition + new Vector3(8, 1.8f, 0), 55);
            // the guide walks Jef ashore after 115 seconds of play
            var started = DateTime.UtcNow;
            await Until(() => f.Ashore, 600); Check("the guide walks the passenger ashore", f.Ashore);
            notes.Add(new { mode = "ashore", seconds = (DateTime.UtcNow - started).TotalSeconds, f.Stage, f.PassengersOff, f.MissingFootSamples, f.WorstFootError });
            Check("no passenger or Jef walked on air or sank through a floor", f.MissingFootSamples == 0 && f.WorstFootError < .05f);
            // she hauls in the gangway and leaves: where the gangway is, at each moment, against the ferry
            Node3D? Brow() => Find("arrival_gangway") ?? Find("arrival_plank");
            Check("the ferry hauls in her gangway", await Until(() => f.Stage is "hauling" or "leaving", 120));
            await Shot("leaving-1-hauling", new(x + 3.1f, Waters.Level + 3.3f, -57.4f), new(x, Waters.Level + 2f, -60.8f), 55);
            foreach (var seconds in new[] { 2.0, 6.0, 14.0, 30.0 })
            {
                var until = DateTime.UtcNow.AddSeconds(seconds * 1.8); await Until(() => f.Stage == "gone" || DateTime.UtcNow >= until, seconds * 3);
                var brow = Brow(); var ferryAt = f.VesselPosition;
                double away = brow == null ? -1 : brow.GlobalPosition.DistanceTo(ferryAt);
                notes.Add(new { mode = "gangway", f.Stage, ferry = ferryAt.ToString(), gangway = brow?.GlobalPosition.ToString(), away });
                // her brow pins on the sill 4.9 m from her middle, so anything past 6 m has left her
                Check($"the gangway stays with the ferry ({seconds:0}s after hauling)", brow == null || away < 6);
                if (f.Stage != "gone") await Shot($"leaving-{seconds:00}s", new(x - 6, Waters.Level + 4, -52), ferryAt + new Vector3(-2, 1.8f, 0), 62);
            }
            await Until(() => f.Stage == "gone", 400);
            await Shot("after-pier-head", new(x - 3.5f, Waters.Level + 3f, -52), new(x, Waters.Level + 1.7f, -62), 62);
            await Shot("after-pier-quay", new(x + 4f, 2.4f, 3.5f), new(x, -.5f, -8), 56);
            Check("no gangway floats once the ferry has gone", Find("arrival_gangway") == null && Find("arrival_plank") == null || !(Brow()?.IsVisibleInTree() ?? false) || Brow()!.GlobalPosition.DistanceTo(new Vector3(x, Waters.Level + 1.8f, -60)) < 8);
        }
        catch (Exception ex) { error += ex.ToString(); GD.PushError("arrival pier proof: " + ex); }
        finally
        {
            try
            {
                File.WriteAllText(Path.Combine(output, "arrival-pier.json"), JsonSerializer.Serialize(new { ok = error == "", error, checks, notes, pictures }, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
                if (error != "") File.WriteAllText(Path.Combine(output, "failure.txt"), error);
            }
            catch (Exception ex) { File.WriteAllText(Path.Combine(output, "failure.txt"), error + " report: " + ex.Message); }
            game.GetTree().Quit();
        }
    }
}
