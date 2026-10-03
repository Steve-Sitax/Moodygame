using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Net;
using Scheldemist.World;

namespace Scheldemist.Game;

/// <summary>
/// The map's own test: `-- --maptest dir` (with `--no-ai`; `--mapat x,z,yawDeg` puts the camera where the browser's
/// reference picture had Jef). It waits for the town's places, opens the map with the M key, points the mouse at
/// three places, the ink cursor at a fourth, clicks a kind off and on in the key, shows the way on foot between two
/// named places, closes with E, M and Esc, and saves pictures and what it found (dir/maptest.json): the places
/// counted per kind, the hover lines, the way's length, the drawing's cost. The keys and the mouse go in as real
/// input events. Quits with 1 and the reason in the json when a step fails. Its settings file is dir/map.json,
/// never the player's own.
/// </summary>
[GamePart(210)]
public partial class MapTest : Node
{
    private string dir = "";
    private double total;
    private bool done;
    private readonly Dictionary<string, object?> found = new();
    private readonly List<string> steps = new();

    public override void _Ready()
    {
        dir = Main.I.Arg("maptest");
        if (dir == "")
        {
            SetProcess(false);
            return;
        }
        Directory.CreateDirectory(dir);
        _ = Run();
    }

    public override void _Process(double delta)
    {
        total += delta;
        if (!done && total > 170) Finish(false, "the test took more than 170 s");
    }

    private async Task Frames(int n)
    {
        for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }

    private async Task<bool> Until(Func<bool> ok, double seconds)
    {
        double end = total + seconds;
        while (!ok())
        {
            if (total > end) return false;
            await Frames(1);
        }
        return true;
    }

    private async Task Shot(string name)
    {
        await Frames(4);
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, name + ".png"));
        steps.Add($"picture {name}.png");
    }

    private static void Press(Key key, bool down = true)
    {
        Input.ParseInputEvent(new InputEventKey { PhysicalKeycode = key, Keycode = key, Pressed = down });
    }

    private async Task Tap(Key key)
    {
        Press(key);
        await Frames(2);
        Press(key, false);
        await Frames(2);
    }

    private static void MouseTo(Vector2 at) => Input.ParseInputEvent(new InputEventMouseMotion { Position = at, GlobalPosition = at });

    private async Task Click(Vector2 at)
    {
        MouseTo(at);
        await Frames(2);
        Input.ParseInputEvent(new InputEventMouseButton { Position = at, GlobalPosition = at, ButtonIndex = MouseButton.Left, Pressed = true });
        await Frames(2);
        Input.ParseInputEvent(new InputEventMouseButton { Position = at, GlobalPosition = at, ButtonIndex = MouseButton.Left, Pressed = false });
        await Frames(3);
    }

    /// <summary>The mean frame in ms over n frames (vsync is off in the project).</summary>
    private async Task<double> FrameMs(int n)
    {
        await Frames(10);
        ulong t0 = Time.GetTicksUsec();
        await Frames(n);
        return Math.Round((Time.GetTicksUsec() - t0) / 1000.0 / n, 3);
    }

    private async Task Run()
    {
        try
        {
            var map = TownMap.I ?? throw new Exception("the map part is off (--no-townmap)");
            string settings = Path.Combine(dir, "map.json");
            File.Delete(settings);
            map.SettingsFile = settings;
            map.ReloadSettings();
            // --mapat x,z,yawDeg: stand where the browser's picture was taken
            string at = Main.I.Arg("mapat");
            if (at != "")
            {
                var v = at.Split(',').Select(s => float.Parse(s, CultureInfo.InvariantCulture)).ToArray();
                Main.I.Cam.GlobalPosition = new Vector3(v[0], 1.6f, v[1]);
                Main.I.Cam.GlobalRotation = new Vector3(0, Mathf.DegToRad(v.Length > 2 ? v[2] : 0), 0);
            }
            // the town's places come from the server; without the link the map has its own few
            bool link = ServerLink.I != null;
            if (link && !await Until(() => (bool)map.Info()["town_places_in"]! || ServerLink.I!.Error != "", 110)) throw new Exception("the town's places did not come in 110 s");
            if (link && ServerLink.I!.Error != "") throw new Exception(ServerLink.I.Error);
            if (link) await Until(() => GameState.I.Live, 20);
            await Frames(30);
            found["frame_ms_closed"] = await FrameMs(90);

            // ---- open with M
            await Tap(Godot.Key.M);
            if (!map.Open) throw new Exception("M did not open the map");
            await Shot("map-open");
            var info = map.Info();
            found["open"] = info;
            found["frame_ms_open"] = await FrameMs(90);

            // ---- move and zoom: the wheel, a held key, a drag; the free camera stands still under the map
            var camWas = Main.I.Cam.GlobalPosition;
            var mid = GetViewport().GetVisibleRect().Size / 2 - new Vector2(200, 0);
            float Zoom() => (float)map.Info()["zoom"]!;
            float PanX() => ((float[])map.Info()["pan"]!)[0];
            Input.ParseInputEvent(new InputEventMouseButton { Position = mid, GlobalPosition = mid, ButtonIndex = MouseButton.WheelUp, Pressed = true });
            await Frames(2);
            float wheelIn = Zoom();
            Input.ParseInputEvent(new InputEventMouseButton { Position = mid, GlobalPosition = mid, ButtonIndex = MouseButton.WheelDown, Pressed = true });
            await Frames(2);
            if (Math.Abs(wheelIn - 1.25f) > 0.01f || Math.Abs(Zoom() - 1) > 0.01f) throw new Exception($"the wheel zooms to {wheelIn} and back to {Zoom()}");
            Press(Godot.Key.D);
            await Frames(12);
            Press(Godot.Key.D, false);
            await Frames(2);
            float held = PanX();
            if (held <= 0) throw new Exception("holding D does not move the map");
            Input.ParseInputEvent(new InputEventMouseButton { Position = mid, GlobalPosition = mid, ButtonIndex = MouseButton.Left, Pressed = true });
            await Frames(2);
            Input.ParseInputEvent(new InputEventMouseMotion { Position = mid - new Vector2(40, 0), GlobalPosition = mid - new Vector2(40, 0), Relative = new Vector2(-40, 0) });
            await Frames(2);
            Input.ParseInputEvent(new InputEventMouseButton { Position = mid, GlobalPosition = mid, ButtonIndex = MouseButton.Left, Pressed = false });
            await Frames(2);
            float dragged = PanX() - held;
            if (Math.Abs(dragged - 80) > 0.5f) throw new Exception($"a drag of 40 px moves the map {dragged} stored px, not 80");
            await Tap(Godot.Key.C);
            if (PanX() != 0) throw new Exception("C does not go back to you");
            if (Main.I.Cam.GlobalPosition.DistanceTo(camWas) > 0.001f) throw new Exception("the camera moved under the open map");
            found["move_and_zoom"] = new { wheel_zoom = wheelIn, held_key_px = Math.Round(held, 1), drag_px = Math.Round(dragged, 1) };

            // ---- hover three places with the mouse
            var hovers = new List<object?>();
            int n = 0;
            foreach (string name in new[] { "hiring board", "Cathedral of Our Lady", "doss house" })
            {
                var p = map.OnScreen(name) ?? throw new Exception($"\"{name}\" is not drawn on the map");
                MouseTo(p);
                await Frames(3);
                var lines = map.Info()["hover"] as string[] ?? throw new Exception($"no name shows over \"{name}\"");
                if (!lines[0].StartsWith(name, StringComparison.OrdinalIgnoreCase)) throw new Exception($"over \"{name}\" the map says \"{lines[0]}\"");
                hovers.Add(new { place = name, name = lines[0], detail = lines[1], line = lines[2] });
                await Shot($"map-hover-{++n}");
            }
            MouseTo(new Vector2(4, 4));
            await Frames(3);
            if (map.Info()["hover"] != null) throw new Exception("the name stays when the mouse has left the mark");
            found["hover"] = hovers;

            // ---- a kind off and on in the key, kept in the settings file
            var keyLine = map.KeyLineOnScreen("food") ?? throw new Exception("the key has no line for food");
            int before = (int)map.Info()["drawn"]!;
            await Click(keyLine);
            if (map.Shows("food")) throw new Exception("a click on the key's food line did not turn food off");
            await Frames(3);
            int without = (int)map.Info()["drawn"]!;
            string kept = File.ReadAllText(settings);
            await Shot("map-food-off");
            map.ReloadSettings();
            if (map.Shows("food")) throw new Exception("food is on again after the settings were read back");
            await Click(keyLine);
            if (!map.Shows("food")) throw new Exception("a second click did not turn food on again");
            await Frames(3);
            found["kind_off_on"] = new { kind = "food", drawn_before = before, drawn_without = without, drawn_after = (int)map.Info()["drawn"]!, kept, kept_after = File.ReadAllText(settings) };
            // pumps are off at first: on, a picture, off again
            await Click(map.KeyLineOnScreen("pump")!.Value);
            MouseTo(new Vector2(4, 4));
            await Shot("map-pumps-on");
            await Click(map.KeyLineOnScreen("pump")!.Value);

            // ---- the way on foot between two named places
            MapMark a = map.Find("hiring board")!;
            var square = map.NamedPlace("Grote Markt") ?? throw new Exception("the map has no Grote Markt");
            var b = new MapMark(square.X, square.Y, "Grote Markt", "place");
            var path = Ways.Path(new Vector2(a.X, a.Z), new Vector2(b.X, b.Z)) ?? throw new Exception($"no way on foot from the hiring board to the Grote Markt ({Ways.Error})");
            ulong t0 = Time.GetTicksUsec();
            for (int i = 0; i < 20; i++) Ways.Path(new Vector2(a.X, a.Z), new Vector2(b.X, b.Z));
            double pathMs = (Time.GetTicksUsec() - t0) / 1000.0 / 20;
            var far = Ways.Path(new Vector2(a.X, a.Z), new Vector2(map.Find("doss house")!.X, map.Find("doss house")!.Z));
            found["way"] = new
            {
                from = a.Label,
                to = b.Label,
                metres = Math.Round(Ways.Length(path), 1),
                straight_metres = Math.Round(new Vector2(a.X - b.X, a.Z - b.Z).Length(), 1),
                corners = path.Count,
                points = path.Select(p => new[] { p.X, p.Y }).ToArray(),
                find_ms = Math.Round(pathMs, 2),
                to_doss_house_metres = far == null ? (double?)null : Math.Round(Ways.Length(far), 1),
                every_corner_on_open_ground = path.All(p => Ways.Reachable(p.X, p.Y)),
            };
            // ... and drawn: the job's goal at the cathedral, Jef at his place, two things that move
            map.JobMarks = () => new[] { new MapMark(b.X, b.Z, "Carry the crate to the Grote Markt", "goal", "A crate for the town hall, for Sooi") };
            map.SetMovers(new[] { new MapMover("omnibus", a.X + 30, a.Z + 25, 1.2f, "the omnibus to the Grote Markt"), new MapMover("ship", a.X - 20, a.Z - 70, 0, "the steamer Baron Osy") });
            if (!await Until(() => (map.Info()["listed"] as string[])!.Length > 0, 5)) throw new Exception("the job's mark is not listed");
            await Frames(20);
            await Shot("map-way");
            await Tap(Godot.Key.Key1);
            await Tap(Godot.Key.Equal);
            await Shot("map-way-near");
            found["with_job"] = map.Info();
            await Tap(Godot.Key.C);
            await Tap(Godot.Key.Minus);
            map.JobMarks = null;
            map.SetMovers(null);

            // ---- the ink cursor: the game holds the mouse, the map's own quill points
            await Tap(Godot.Key.E);
            if (map.Open) throw new Exception("E did not close the map");
            Input.MouseMode = Input.MouseModeEnum.Captured;
            await Frames(3);
            await Tap(Godot.Key.M);
            await Frames(3);
            var target = map.OnScreen("Town Hall") ?? throw new Exception("the Town Hall is not drawn on the map");
            var rel = target - GetViewport().GetVisibleRect().Size / 2;
            Input.ParseInputEvent(new InputEventMouseMotion { Relative = rel });
            await Frames(3);
            var ink = map.Info()["hover"] as string[];
            await Shot("map-ink-cursor");
            Input.MouseMode = Input.MouseModeEnum.Visible;
            if (ink == null || !ink[0].StartsWith("Town Hall")) throw new Exception($"the ink cursor on the Town Hall shows \"{ink?[0]}\"");
            found["ink_cursor"] = new { name = ink[0], line = ink[2] };

            // ---- close with M, and with Esc
            await Tap(Godot.Key.M);
            if (map.Open) throw new Exception("M did not close the map");
            await Tap(Godot.Key.M);
            await Tap(Godot.Key.Escape);
            if (map.Open) throw new Exception("Esc did not close the map");
            await Shot("map-closed");
            found["closed"] = map.Info();
            Finish(true, "");
        }
        catch (Exception e)
        {
            Input.MouseMode = Input.MouseModeEnum.Visible;
            GD.PrintErr($"maptest: {e}");
            try
            {
                await Shot("map-failed");
            }
            catch
            {
                // (the tree is going)
            }
            Finish(false, e.Message);
        }
    }

    private void Finish(bool ok, string why)
    {
        if (done) return;
        done = true;
        var doc = new Dictionary<string, object?> { ["ok"] = ok, ["why"] = why, ["seconds"] = Math.Round(total, 1), ["steps"] = steps, ["walk_map"] = Ways.Error == "" ? "read" : Ways.Error };
        foreach (var (k, v) in found) doc[k] = v;
        File.WriteAllText(Path.Combine(dir, "maptest.json"), JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"maptest: {(ok ? "ok" : "failed: " + why)}");
        GetTree().Quit(ok ? 0 : 1);
    }
}
