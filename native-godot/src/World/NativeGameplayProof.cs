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
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Whole-game smoke: enter through the real menu, apply authoritative weather, then capture the scene.</summary>
public static class NativeGameplayProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output); var checks = new List<object>(); var callbackErrors = new List<string>();
        void Check(string name, bool passed) { checks.Add(new { name, passed }); if (!passed) throw new InvalidOperationException(name); }
        async Task Frames(int count) { for (int i = 0; i < count; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        try {
            // (#198: 90 s was too short with two other Godot windows building the town at the same time: the backend, the whole town and
            // its 600 residents came up after the limit. 240 s, the checks' own four-minute run limit; `--smoke-ready-seconds` sets 30-900.)
            int readySeconds = int.TryParse(game.Arg("smoke-ready-seconds", "240"), out int asked) && asked is >= 30 and <= 900 ? asked : 240;
            var deadline = DateTime.UtcNow.AddSeconds(readySeconds);
            while (!game.Loaded || Loading.Busy || ServerLink.I?.Up != true || !GameState.I.Live || game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count is not > 0) {
                if (DateTime.UtcNow > deadline) throw new TimeoutException($"The native backend and population did not become ready in {readySeconds} s.");
                await Frames(1);
            }
            Check("native backend runs inside Godot", game.UsesLocalBackend && ServerLink.I!.Api!.IsLocal);
            ServerLink.I!.Api!.Failed += error => callbackErrors.Add(error.ToString());
            var menu = MainMenu.I ?? throw new InvalidOperationException("The real game menu is missing.");
            menu.Start(); await Frames(3);
            Check("real menu entered gameplay", menu.InPlay);
            Check("authored district placements loaded", ((NativeTown)game.World).Layouts.ObjectCount >= 15);
            Check("resident population loaded", game.GetNode<Townspeople>("Townspeople").Sims.Count > 500);
            using (var trade = await ServerLink.I!.Api!.Get<JsonDocument>("api/trade"))
                Check("native trade ledger supplies actual town stocks", trade.RootElement.GetProperty("posts").GetArrayLength() > 0);
            using (var mills = await ServerLink.I!.Api!.Get<JsonDocument>("api/mills"))
                Check("native mills supply current production", mills.RootElement.GetProperty("mills").GetArrayLength() > 0);
            var authoredLamps = Lights.I.Lamps.Where(l => l.id.StartsWith("authored:", StringComparison.Ordinal)).ToArray();
            Check("all seven saved editor lamps join the gas-light system", authoredLamps.Length == 7);
            Check("saved user lamp keeps its identity and placement", authoredLamps.Any(l => l.id.EndsWith("/0b6dbc5dc53b48c98eb69b148cb310c8", StringComparison.Ordinal) && Math.Abs(l.at.X-52.5) < .05 && Math.Abs(l.at.Z-2.25) < .05));
            Check("gas lamp identities are unique", Lights.I.Lamps.Select(l=>l.id).Distinct().Count() == Lights.I.LampCount);
            var originalRound = new LampRound { Id="test", Lamps=new() { new RoundLamp { Id="stable",X=1,Z=2,Sx=2,Sz=2 } } };
            Check("equal-count lamp movement invalidates old walking round", !TownLife.SameLampRound(originalRound,originalRound with { Lamps=new() { originalRound.Lamps[0] with { X=3,Sx=4 } } }));
            if (Jef.I is { Fly: false } player) player.ToggleFly();
            var views = new[] {
                (Name:"quay-day", Hour:13, Weather:"clear", Camera:new Vector3(52.5f,1.62f,2.25f), Target:new Vector3(52.5f,1.3f,25)),
                (Name:"quay-rain", Hour:13, Weather:"rain", Camera:new Vector3(52.5f,1.62f,2.25f), Target:new Vector3(52.5f,1.3f,25)),
                (Name:"quay-night", Hour:22, Weather:"mist", Camera:new Vector3(52.5f,1.62f,2.25f), Target:new Vector3(52.5f,1.3f,25))
            };
            foreach (var view in views) {
                var state = await ServerLink.I!.Api!.Post<JobsPayload>("api/dev/set", new { day=1, hour=view.Hour, minute=0, weather=view.Weather });
                GameState.I.Apply(state); await Frames(3);
                game.Cam.GlobalPosition = view.Camera;
                var rotation = new Transform3D(Basis.Identity, view.Camera).LookingAt(view.Target).Basis.GetRotationQuaternion();
                if (game.Cam is FlyCam fly) fly.Face(rotation); else game.Cam.Quaternion = rotation;
                Daylight.I.Settle(); await Frames(180);
                Check(view.Name + " uses authoritative clock and weather", GameState.I.Hour == view.Hour && GameState.I.Weather == view.Weather);
                Check(view.Name + " renderer follows clock and weather", Math.Abs(Daylight.I.Hour - view.Hour) < .1 && Daylight.I.Weather == view.Weather);
                Check(view.Name + " is unobstructed by the menu", menu.InPlay);
                if (view.Hour == 22) {
                    int lampIndex = Lights.I.Lamps.Select((l,i)=>(l,i)).First(pair=>pair.l.id==authoredLamps[0].id).i;
                    Check("editable lamp lights at night", Lights.I.LampBright(lampIndex) > .1);
                }
                await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                using var picture = game.GetViewport().GetTexture().GetImage();
                Check(view.Name + " screenshot written", picture.SavePng(Path.Combine(output, view.Name + ".png")) == Error.Ok);
            }
            deadline = DateTime.UtcNow.AddSeconds(60);
            while (game.GetNode<Townspeople>("Townspeople").WaysWaiting < 0 && DateTime.UtcNow < deadline) await Frames(1);
            Check("native response handlers completed without exceptions", callbackErrors.Count == 0);
            Check("town route service loaded", game.GetNode<Townspeople>("Townspeople").WaysWaiting >= 0);
            // Pause the lamplighter's own per-frame writes while exercising an individual light control.
            var lampRuns = TownLife.I!; bool lampRunsProcessing = lampRuns.IsProcessing(); lampRuns.SetProcess(false);
            Lights.I.SetLampLit(authoredLamps[0].id,false); await Frames(180);
            int darkLamp = Lights.I.Lamps.Select((l,i)=>(l,i)).First(pair=>pair.l.id==authoredLamps[0].id).i;
            int otherLamp = Lights.I.Lamps.Select((l,i)=>(l,i)).First(pair=>pair.l.id==authoredLamps[1].id).i;
            Check("individual editor lamps can be extinguished independently", Lights.I.LampBright(darkLamp) < .01 && Lights.I.LampBright(otherLamp) > .1);
            Lights.I.SetLampLit(authoredLamps[0].id,true);
            lampRuns.SetProcess(lampRunsProcessing);
            if (game.Flag("native-hands-smoke")) await NativeHandsGameplayProof.Run(game, output);
            if (game.Flag("native-new-week-smoke")) await NativeNewWeekGameplayProof.Run(game, output);
            Check("all gameplay callbacks completed without exceptions", callbackErrors.Count == 0);
            File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { passed=true, checks }));
            GD.Print($"Native full gameplay smoke: {checks.Count} checks PASS"); game.GetTree().Quit();
        } catch (Exception error) {
            File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { passed=false, error=error.ToString(), checks, callbackErrors }));
            GD.PrintErr(error); game.GetTree().Quit(1);
        }
    }
}
