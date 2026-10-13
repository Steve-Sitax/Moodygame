using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.Game;

public static class NativeGameProof
{
    public static async Task Run(NativeGame game, string output)
    {
        Directory.CreateDirectory(output); var rows = new List<object>(); string? error = null;
        void Check(bool pass, string description) { rows.Add(new { description, pass }); if (!pass) throw new InvalidOperationException(description); }
        async Task Frames(int count) { for (int i = 0; i < count; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.PhysicsFrame); }
        async Task Picture(string name)
        {
            await Frames(35);
            if (DisplayServer.GetName() == "headless") return;
            await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            Check(game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, name + ".png")) == Error.Ok, "render " + name);
        }
        try
        {
            await Frames(30);
            Check(game.Loaded && game.World is NativeGameWorld, "existing game runtime loads a native district");
            Check(!game.GetChildren().Any(n => n.GetType().Name == "ServerLink"), "district run does not start the original server");
            var world = (NativeGameWorld)game.World;
            // The count follows the layout in use: a copy of Steve's saved layout holds 15 (the seed's 14 plus his lamp), a run on the scene seed
            // (--scene-seed, or an --author-dir without a layout) holds the 14 of the committed seed (issue 102).
            int expected = world.LayoutObjects ?? 14;
            Check(world.AuthoredCount == expected, $"the {(world.LayoutObjects == null ? "scene seed" : "copied player layout")} builds all {expected} objects");
            Check(world.AuthoredLamps > 0 && Lights.I.LampCount == world.AuthoredLamps, $"{world.AuthoredLamps} authored lamps supply live game lighting");
            Check(Jef.I.Grounded && Math.Abs(Jef.I.Y) < 0.2f && Jef.I.Rescued == 0, "real game player stands on native quay collision");
            var wall = ResourceLoader.Load<ShaderMaterial>("res://game/rijnkaai/resources/material-6.res");
            Check(wall.GetShaderParameter("bump_map").As<Texture2D>() is { ResourcePath.Length: > 0 }, "wall bump map is a saved native texture");
            var floor = ResourceLoader.Load<ShaderMaterial>("res://game/rijnkaai/resources/material-1.res");
            Check(floor.GetShaderParameter("relief_h").As<Texture2D>() is { ResourcePath.Length: > 0 }, "paving relief map is a saved native texture");
            Check(game.View.FindChild("river_sheet", true, false) is MeshInstance3D, "existing animated river system builds its sheet");
            Check(game.View.FindChild("cloud_sky", true, false) is MeshInstance3D, "existing weather sky is present");
            Jef.I.TestInput = true; Jef.I.SetKey(Key.W, true); float start = Jef.I.Z;
            await Frames(45); Jef.I.ClearKeys();
            Check(Math.Abs(Jef.I.Z - start) > 0.4f && Jef.I.Rescued == 0, "real player walks on the recovered quay");
            Jef.I.Place(20, 26, Mathf.Pi); await Frames(5);
            await Picture("01-game-day");
            Daylight.I.SetWeather("rain"); Daylight.I.SetRain(0.85f); Daylight.I.Settle();
            Check(Daylight.I.Rain >= 0.8f && Daylight.I.Wet > 0, "existing rain weather drives rain and wet surfaces");
            await Picture("02-game-rain");
            var mirrors = game.GetChildren().OfType<Mirrors>().Single();
            Check(mirrors.Drawn.river > 0 && mirrors.Drawn.puddles > 0, "river and puddle reflection cameras update");
            world.SetBumps(false); Check(wall.GetShaderParameter("bump_scale").AsSingle() == 0, "native bump comparison switches off");
            await Picture("03-game-no-bump"); world.SetBumps(true);
            Check(wall.GetShaderParameter("bump_scale").AsSingle() > 0, "native bump comparison restores its strength");
            Daylight.I.SetTime(21); Daylight.I.Settle();
            await Picture("04-game-night-rain");
            Check(Lights.I.LampBright(0) > 0.8f, "existing lamp system lights authored lamps at night");
            Daylight.I.SetRain(0); Daylight.I.SetWeather("fog"); Daylight.I.SetTime(13); Daylight.I.Settle();
            await Picture("05-game-fog");
            Daylight.I.SetWeather("clear"); Daylight.I.Settle(); Jef.I.ToggleFly();
            game.Cam.GlobalPosition = new Vector3(20, 4, -17); game.Cam.LookAt(new Vector3(20, -1.5f, 1));
            await Picture("06-game-water-wall");
            game._UnhandledInput(new InputEventKey { Pressed = true, Keycode = Key.M });
            var rendered = mirrors.Drawn; await Frames(8);
            Check(mirrors.Drawn == rendered, "reflection comparison stops both reflection passes");
            await Picture("07-game-reflections-off");
            game._UnhandledInput(new InputEventKey { Pressed = true, Keycode = Key.M });
            for (int i = 0; i < 8; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame);
            Check(mirrors.Drawn.river > rendered.river, $"reflection comparison restores river pass ({rendered.river} -> {mirrors.Drawn.river})");
            Check(mirrors.Drawn.puddles > rendered.puddles, $"reflection comparison restores puddle pass ({rendered.puddles} -> {mirrors.Drawn.puddles})");
        }
        catch (Exception caught) { error = caught.ToString(); GD.PrintErr(error); }
        File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { rows, error }, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Native game proof: {rows.Count} checks, {(error == null ? "PASS" : "FAIL")}");
        game.GetTree().Quit(error == null ? 0 : 1);
    }
}
