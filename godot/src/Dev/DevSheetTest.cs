using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.Ui;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>
/// The Dev sheet's own test: `-- --devsheettest dir --no-ai --port N --db dir/test.sqlite --prefs dir/settings.json`
/// (no --dev: dev mode is switched on by the console's "dev on", as Steve would). It opens the console with the key
/// left of 1, tries a kit command with dev mode off, `help`, `dev on`, the secret combo Ctrl+Alt+Shift+D twice, then
/// the menu's Dev line on the first page and in the pause menu, F8 in play, every button of the sheet with the
/// mouse, and checks what each
/// did in the game (the clock, the weather, the tide, the lock, the bridges' boats, the fog, the rain, the extra
/// people, each director event started in front of Jef, the director, needs, money, every place, the console line),
/// then F9's flight and landing, the console in play and `dev off`. A picture of each kind goes to dir, every step to
/// dir/devsheettest.json; the test's save is deleted; it quits (1 when a check failed).
/// </summary>
[GamePart(985)]
public partial class DevSheetTest : Node
{
    private string dir = "";
    private readonly List<Dictionary<string, object?>> steps = new();
    private readonly List<string> failed = new();
    private int shot;

    public DevSheetTest() => ProcessMode = ProcessModeEnum.Always;

    public override void _Ready()
    {
        dir = Paths.TestOutput("devsheettest");
        if (dir == "") return;
        Directory.CreateDirectory(dir);
        _ = Run();
    }

    private async Task Wait(double s) => await ToSignal(GetTree().CreateTimer(s, true, false, true), SceneTreeTimer.SignalName.Timeout);

    private async Task<bool> Until(Func<bool> ok, double s)
    {
        for (double left = s; !ok(); left -= 0.1)
        {
            if (left <= 0) return false;
            await Wait(0.1);
        }
        return true;
    }

    private async Task Shot(string name)
    {
        await Wait(0.3);
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        string file = $"{++shot:00}-{name}.png";
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, file));
        steps.Add(new() { ["picture"] = file });
    }

    private void Note(string what, object? got, bool ok)
    {
        steps.Add(new() { ["step"] = what, ["got"] = got, ["ok"] = ok });
        if (!ok) failed.Add(what);
        GD.Print($"[devsheettest] {what}: {JsonSerializer.Serialize(got)}{(ok ? "" : "  FAILED")}");
    }

    private static T? Find<T>(Node root, string name) where T : Node
    {
        foreach (var c in root.GetChildren(true))
        {
            if (c is T t && c.Name == name) return t;
            if (Find<T>(c, name) is { } deep) return deep;
        }
        return null;
    }

    private static void Key(Key key, bool combo = false)
    {
        foreach (bool down in new[] { true, false })
            Input.ParseInputEvent(new InputEventKey { Keycode = key, PhysicalKeycode = key, Pressed = down, CtrlPressed = combo, AltPressed = combo, ShiftPressed = combo });
    }

    /// <summary>A line typed into the open console and Enter pressed; its answer.</summary>
    private async Task<string> Console(string text)
    {
        var line = Main.I.Ui.FindChild("console_line", true, false) as LineEdit;
        if (line == null || !DevConsole.Open) return "no console";
        line.Text = text;
        line.CaretColumn = text.Length;
        string before = DevConsole.Last;
        Key(Godot.Key.Enter);
        await Until(() => DevConsole.Last != before && DevConsole.Last != "> " + text, 20);
        return DevConsole.Last;
    }

    /// <summary>A click of the mouse in the middle of a control, as the player's (scrolled into view first).</summary>
    private async Task Click(Control c)
    {
        // scrolled into the middle of its list first (the sheet, or the menu's paper on a short window), as a player would
        for (var up = c.GetParent(); up != null; up = up.GetParent())
            if (up is ScrollContainer sc)
            {
                float off = c.GetGlobalRect().GetCenter().Y - sc.GetGlobalRect().GetCenter().Y;
                if (Math.Abs(off) > sc.Size.Y * 0.3f) sc.ScrollVertical += (int)off;
                await Wait(0.15);
                break;
            }
        var at = c.GetGlobalRect().GetCenter();
        Input.ParseInputEvent(new InputEventMouseMotion { Position = at, GlobalPosition = at });
        await Wait(0.05);
        foreach (bool down in new[] { true, false })
        {
            Input.ParseInputEvent(new InputEventMouseButton { ButtonIndex = MouseButton.Left, Pressed = down, Position = at, GlobalPosition = at });
            await Wait(0.05);
        }
        await Wait(0.1);
    }

    /// <summary>Click a button of the open Dev sheet and wait for its answer.</summary>
    private async Task<string> Press(string name, double wait = 30)
    {
        if (DevSheet.Current is not { } s) { await OpenByF8(); s = DevSheet.Current!; }
        var b = Find<InkButton>(s, name);
        if (b == null) return "no button " + name;
        string before = DevSheet.Last;
        await Click(b);
        // a click that did not take (the list still settling) is given again, once
        if (!await Until(() => DevSheet.Busy || DevSheet.Last != before, 1.5)) await Click(b);
        await Until(() => !DevSheet.Busy && DevSheet.Last != before && !DevSheet.Last.EndsWith(": ..."), wait);
        return DevSheet.Last;
    }

    private async Task OpenByF8()
    {
        if (DevSheet.IsOpen) return;
        Key(Godot.Key.F8);
        await Until(() => DevSheet.IsOpen, 3);
        await Wait(0.2);
    }

    /// <summary>Out of the sheet (Esc) and back into the game; the town runs for `s` seconds.</summary>
    private async Task Play(double s)
    {
        if (DevSheet.IsOpen) Key(Godot.Key.Escape);
        await Until(() => !DevSheet.IsOpen && MainMenu.I!.InPlay, 3);
        await Wait(s);
    }

    private static Api Api => ServerLink.I!.Api!;

    private async Task Run()
    {
        try
        {
            await Script();
        }
        catch (Exception e)
        {
            Note("the test broke", e.ToString(), false);
        }
        Finish();
    }

    private async Task Script()
    {
        var menu = MainMenu.I;
        if (menu == null || DevTools.I == null) { Note("the menus and the dev tools are here", null, false); return; }
        var t = DevTools.I;
        AudioServer.SetBusMute(AudioServer.GetBusIndex("Master"), true);
        await Until(() => !Loading.Busy, 160);
        Note("the server", ServerLink.I?.Server?.Url, ServerLink.I is { Up: true });
        var devItem = Find<InkButton>(menu.GetParent(), "devmenu")!;
        Note("dev mode is off by default: no Dev line, F8 does nothing", new { Prefs.DevMode, item = devItem.IsVisibleInTree() }, !Prefs.DevMode && !devItem.IsVisibleInTree());
        Key(Godot.Key.F8);
        await Wait(0.3);
        Note("F8 with dev mode off", DevSheet.IsOpen, !DevSheet.IsOpen);

        // ---- the console (the key left of 1), dev mode by its command and by the secret combo
        Key(Godot.Key.Quoteleft);
        await Wait(0.3);
        Note("the key left of 1 opens the console on the first page", new { console = DevConsole.Open, menu = menu.Open }, DevConsole.Open && menu.Open);
        string off = await Console("hour 10");
        Note("a kit command with dev mode off", off, off.StartsWith("dev mode is off"));
        string help = await Console("help");
        Note("help lists the commands", help, help.Contains("dev on") && help.Contains("tide") && help.Contains("event"));
        string on = await Console("dev on");
        await Shot("console-dev-on");
        Note("dev on", new { on, Prefs.DevMode, saved = File.ReadAllText(Prefs.File).Contains("\"devMode\": true") }, Prefs.DevMode && on.StartsWith("dev mode is on") && File.ReadAllText(Prefs.File).Contains("\"devMode\": true"));
        Key(Godot.Key.Escape);
        await Wait(0.3);
        Note("Esc closes the console, the first page stays", new { console = DevConsole.Open, menu = menu.Open }, !DevConsole.Open && menu.Open);
        Key(Godot.Key.D, combo: true);
        await Wait(0.4);
        Note("Ctrl+Alt+Shift+D: dev mode off, with a note", new { Prefs.DevMode, DevConsole.LastNote, item = devItem.IsVisibleInTree() }, !Prefs.DevMode && DevConsole.LastNote == "Dev mode off" && !devItem.IsVisibleInTree());
        await Shot("combo-dev-off");
        Key(Godot.Key.D, combo: true);
        await Wait(0.4);
        Note("Ctrl+Alt+Shift+D again: dev mode on", new { Prefs.DevMode, DevConsole.LastNote }, Prefs.DevMode && DevConsole.LastNote.StartsWith("Dev mode on"));
        Note("the Dev line is on the first page", devItem.IsVisibleInTree(), devItem.IsVisibleInTree());
        await Shot("title-with-dev");
        await Click(devItem);
        Note("a click on it opens the Dev sheet", DevSheet.IsOpen, DevSheet.IsOpen);
        await Shot("sheet-top");
        DevSheet.Current!.Scroll.ScrollVertical = 100000;
        await Shot("sheet-bottom");
        Key(Godot.Key.Escape);
        await Wait(0.3);
        Note("Esc closes it, the first page stays", new { DevSheet.IsOpen, menu.Open }, !DevSheet.IsOpen && menu.Open);

        // ---- into the game at midday, clear
        menu.Start();
        await Until(() => GameState.I.Live && Main.I.GetNodeOrNull<Townspeople>("Townspeople")?.Data != null, 60);
        await Kit.I.Light(12, "clear");
        Kit.I.Go("vismarkt");
        await Wait(2);
        Note("in the game", menu.InPlay, menu.InPlay);
        await OpenByF8();
        Note("F8 while walking opens the sheet and pauses the town", new { DevSheet.IsOpen, Pause.Paused, mouse = Input.MouseMode.ToString() }, DevSheet.IsOpen && Pause.Paused && Input.MouseMode == Input.MouseModeEnum.Visible);
        Key(Godot.Key.F8);
        await Wait(0.4);
        Note("F8 again closes it and walks on", new { DevSheet.IsOpen, menu.InPlay }, !DevSheet.IsOpen && menu.InPlay);

        // ---- the time
        foreach (int h in new[] { 0, 3, 6, 8, 10, 12, 14, 16, 18, 19, 20, 22 })
        {
            string r = await Press($"hour_{h}");
            Note($"Time {h}:00", new { r, hour = Math.Round(GameState.I.HourF, 2), light = Daylight.I.Hour }, Math.Abs(GameState.I.HourF - h) < 0.1 && r.StartsWith("time"));
        }
        await Play(3);
        await Shot("time-22-vismarkt");
        await Press("hour_12");
        // ---- the weather
        foreach (string w in new[] { "fog", "mist", "clear", "rain", "storm" })
        {
            string r = await Press($"weather_{w}");
            Note($"Weather {w}", new { r, server = GameState.I.Weather, sky = Daylight.I.Weather }, GameState.I.Weather == w && Daylight.I.Weather == w);
        }
        await Play(4);
        await Shot("weather-storm");
        await Press("weather_clear");

        // ---- the tide, looking over the river from the Rijnkaai
        await Press("go_0");
        Jef.I.Place(Jef.I.X, Jef.I.Z, 0, -0.25f, Jef.I.Y);
        foreach (var (how, want) in new[] { ("high", Tide.HwMax), ("low", Tide.LwMin) })
        {
            string r = await Press($"tide_{how}");
            Note($"Tide {how} water", new { r, river = Math.Round(Tide.River, 2), want = Math.Round(want, 2) }, Math.Abs(Tide.River - want) < 0.01f && r.Contains("held at " + how));
            await Play(10);
            Note($"the water sheet stands at {how} water", Math.Round(Waters.Level, 2), Math.Abs(Waters.Level - want) < 0.3f);
            await Shot("tide-" + how);
        }
        string clock = await Press("tide_clock");
        float atClock = Tide.At(GameState.I.Day, (float)GameState.I.HourF);
        Note("Tide: follow the clock", new { clock, river = Math.Round(Tide.River, 2), atClock = Math.Round(atClock, 2) }, Tide.Hold == null && Math.Abs(Tide.River - atClock) < 0.05f);
        string now = await Press("tide_now");
        Note("Tide: now", now, now.StartsWith("River") && now.Contains("High water") && now.Contains("Low water"));

        // ---- the NPC stress test
        await OpenByF8();
        var s = DevSheet.Current!;
        await Click(Find<Tick>(s, "pop_enabled")!);
        var slider = Find<InkSlider>(s, "pop_multiplier")!;
        slider.Step(1);
        slider.Step(1);
        Note("Extra street NPCs on, population 3x", new { t.StressMultiplier, t.StressTarget, t.StressBase }, t.StressMultiplier == 3 && t.StressTarget == 2 * t.StressBase);
        await Play(4);
        int walkers = Main.I.GetNode<Townspeople>("Townspeople").Crowd!.Walking.Count;
        Note("the extra people walk the streets", new { t.StressExtra, walkers }, t.StressExtra >= t.StressTarget * 0.8);
        Jef.I.Place(Jef.I.X, Jef.I.Z, MathF.PI, -0.1f, Jef.I.Y);
        await Wait(1);
        await Shot("stress-3x");
        string reset = await Press("pop_reset");
        Note("Reset to normal", new { reset, t.StressExtra, t.StressMultiplier }, t.StressExtra == 0 && t.StressMultiplier == 1);

        // ---- the movers
        string was = Lock.I.State;
        string outR = await Press("ev_lock_out");
        // the lock may be busy with its own traffic: then the button says so (a passage takes minutes)
        bool busyLock = was is "in" or "out" or "turn" or "back";
        Note("Ship out of the dock", new { outR, was, now = Lock.I.State }, busyLock ? outR.Contains("busy") : Lock.I.State == "out" || outR.Contains("no ship lies in the dock"));
        was = Lock.I.State;
        busyLock = was is "in" or "out" or "turn" or "back";
        string inR = await Press("ev_lock_in");
        Note("Ship into the dock", new { inR, was, now = Lock.I.State }, busyLock ? inR.Contains("busy") : Lock.I.State == "in");
        foreach (string where in new[] { "canal", "vliet" })
        {
            string before = Bridges.I.PassageState(where);
            string r = await Press("ev_" + where);
            string after = Bridges.I.PassageState(where);
            Note($"Boat up the {where}", new { r, before, after }, before is "in" or "out" ? r.Contains("already") : after is "in" or "out");
        }
        await Press("go_9");
        Jef.I.Place(Jef.I.X, Jef.I.Z, 0, -0.1f, Jef.I.Y);
        await Play(8);
        await Shot("lock-ship-coming");

        // ---- the sky's own
        await Press("go_4");
        float far = Daylight.I.FogFar;
        string fog = await Press("ev_fog");
        await Play(8);
        Note("Thick fog on", new { fog, Daylight.I.ThickFog, before = Math.Round(far, 1), now = Math.Round(Daylight.I.FogFar, 1) }, Daylight.I.ThickFog && Daylight.I.FogFar < far * 0.8f);
        await Shot("thick-fog");
        fog = await Press("ev_fog");
        Note("Thick fog off", new { fog, Daylight.I.ThickFog }, !Daylight.I.ThickFog);
        string rain = await Press("ev_shower");
        await Play(6);
        Note("Rain shower on", new { rain, Daylight.I.ManualRain, Daylight.I.Rain }, Daylight.I.ManualRain > 0.9f && Daylight.I.Rain > 0.5f);
        await Shot("rain-shower");
        rain = await Press("ev_shower");
        Note("Rain shower off", new { rain, Daylight.I.ManualRain }, Daylight.I.ManualRain < 0.1f);

        // ---- every director event, each on a quiet afternoon of its own (the last one has ended)
        foreach (string tp in DevTools.Templates)
        {
            // the town runs while the clock is moved on (a paused server's clock stands)
            await Play(0.5);
            GameState.I.Apply(await Api.DevAdvance(600));
            GameState.I.Apply(await Api.Tick());
            Actors.I?.Apply(await Api.Actions());
            await Api.Post<JobsPayload>("api/dev/set", new { day = 2, hour = 13, minute = 30, weather = "clear", food = 10, warmth = 10, sleep = 10, health = 10 });
            await Kit.I.Light(13.5, "clear");
            Actors.I?.Apply(await Api.Actions());
            var before = t.LastEvent;
            string r = await Press("ev_" + tp, 45);
            await Play(0.2);
            // it begins a game minute after the town goes on; then Jef is put in front of it
            await Until(() => t.Pending == null, 60);
            var last = t.LastEvent;
            var live = last != null && last != before ? Events.I?.Find(last.Value.Id) : null;
            double d = live != null ? Whereabouts.Hypot(Jef.I.X - last!.Value.X, Jef.I.Z - last.Value.Z) : -1;
            bool ok = tp == "tempest" ? r.Contains("over the whole town") : r.StartsWith("planned") && live?.Event.Status == "running" && d < 30;
            Note($"Event: {DevTools.Words(tp)}", new { r, running = live?.Event.Status, title = live?.Event.Title, jefFrom = Math.Round(d, 1) }, ok);
            await Wait(tp == "tempest" ? 10 : 4);
            await Shot("event-" + tp);
        }
        GameState.I.Apply(await Api.DevAdvance(600));
        await Kit.I.Light(13, "clear");
        string think = await Press("ev_think", 45);
        Note("Director: think now", think, think != "" && !think.Contains("failed"));
        string invent = await Press("ev_invent", 45);
        Note("Director: invent an event now (needs the AI; this run has none)", invent, invent.StartsWith("invented") || invent.StartsWith("no event"));

        // ---- Jef
        await Api.Post<JobsPayload>("api/dev/set", new { food = 3, warmth = 4 });
        string needs = await Press("jef_needs");
        Note("needs full", new { needs, GameState.I.Food }, GameState.I.Food >= 9.99);
        int m0 = GameState.I.Money;
        string money = await Press("jef_money");
        Note("+100 c", new { money, before = m0, now = GameState.I.Money }, GameState.I.Money == m0 + 100);

        // ---- every place
        for (int i = 0; i < DevTools.Places.Length; i++)
        {
            var p = DevTools.Places[i];
            string r = await Press("go_" + i);
            double d = Whereabouts.Hypot(Jef.I.X - p.X, Jef.I.Z - p.Z);
            Note($"Go to {p.Name}", new { r, d = Math.Round(d, 1) }, d < 9 && r == "at " + p.Name);
            if (i is 4 or 7 or 10)
            {
                await Play(2);
                await Shot("go-" + p.Name.ToLowerInvariant().Replace(' ', '-'));
            }
        }

        // ---- the console line in the sheet
        await OpenByF8();
        var line = Find<LineEdit>(DevSheet.Current!, "console")!;
        line.Text = "hour 15; go -254 90";
        string ran = await Press("console_run");
        Note("Console: hour 15; go -254 90 (the Grote Markt)", new { ran, hour = Math.Round(GameState.I.HourF, 2), x = Math.Round(Jef.I.X), z = Math.Round(Jef.I.Z) }, Math.Abs(GameState.I.HourF - 15) < 0.1 && Whereabouts.Hypot(Jef.I.X + 254, Jef.I.Z - 90) < 12);
        line.Text = "tide high; tide clock; fog on; fog off";
        ran = await Press("console_run");
        Note("Console: the new commands", ran, ran.Contains("held at high") && Tide.Hold == null && !Daylight.I.ThickFog);

        // ---- F9: fly over the town and land
        await Play(1);
        await Kit.I.Light(12, "clear");
        Kit.I.Go("vismarkt");
        await Wait(1);
        Key(Godot.Key.F9);
        await Wait(0.3);
        var fly = Main.I.Cam as FlyCam;
        var hud = Main.I.Ui.FindChild("devfly", true, false) as Label;
        Note("F9 flies", new { Jef.I.Fly, cam = Main.I.Cam?.GetType().Name, hud = hud?.Visible }, Jef.I.Fly && fly != null && hud is { Visible: true });
        if (fly != null)
        {
            fly.GlobalPosition = new Vector3(-150, 45, 60);
            fly.Face(Quaternion.FromEuler(new Vector3(-0.5f, 2.2f, 0)));
            await Wait(1);
            await Shot("fly-over-the-town");
            // a street to come down in: over the Vleeshuis's square
            fly.GlobalPosition = new Vector3(-122, 30, 84);
        }
        Key(Godot.Key.F9);
        await Wait(1);
        Note("F9 again lands Jef where you are", new { Jef.I.Fly, x = Math.Round(Jef.I.X, 1), y = Math.Round(Jef.I.Y, 2), z = Math.Round(Jef.I.Z, 1), menu.InPlay }, !Jef.I.Fly && Whereabouts.Hypot(Jef.I.X + 122, Jef.I.Z - 84) < 7 && Math.Abs(Jef.I.Y) < 4 && Main.I.Cam == Jef.I.Cam);
        await Shot("landed");

        // ---- the pause menu's Dev line
        Key(Godot.Key.Escape);
        await Until(() => menu.Open, 3);
        await Wait(0.3);
        Note("the pause menu has the Dev line", devItem.IsVisibleInTree(), menu.Open && devItem.IsVisibleInTree());
        await Shot("pause-menu-with-dev");
        await Click(devItem);
        Note("a click on it opens the sheet over the menu", new { DevSheet.IsOpen, Pause.Paused }, DevSheet.IsOpen && Pause.Paused);
        Key(Godot.Key.Escape);
        await Wait(0.4);
        Note("Esc: back to the pause menu", new { DevSheet.IsOpen, menu.Open }, !DevSheet.IsOpen && menu.Open);
        Key(Godot.Key.Escape);
        await Until(() => menu.InPlay, 3);

        // ---- the console over the game: the town pauses, Esc walks on
        Key(Godot.Key.Quoteleft);
        await Wait(0.4);
        Note("the key left of 1 opens the console in play, the town pauses", new { DevConsole.Open, Pause.Paused }, DevConsole.Open && Pause.Paused);
        string tide = await Console("tide high");
        Note("a kit command in the console", new { tide, river = Math.Round(Tide.River, 2) }, tide.Contains("held at high") && Math.Abs(Tide.River - Tide.HwMax) < 0.01f);
        await Console("tide clock");
        await Shot("console-in-play");
        Key(Godot.Key.Quoteleft);
        await Wait(0.5);
        Note("the key again closes it and walks on", new { DevConsole.Open, menu.InPlay }, !DevConsole.Open && menu.InPlay);

        // ---- dev mode off again, by the console
        Key(Godot.Key.Quoteleft);
        await Wait(0.3);
        string devOff = await Console("dev off");
        Key(Godot.Key.Escape);
        await Wait(0.5);
        Key(Godot.Key.F8);
        await Wait(0.3);
        Key(Godot.Key.F9);
        await Wait(0.3);
        Note("dev off: F8 and F9 do nothing, no Dev line", new { devOff, DevSheet.IsOpen, Jef.I.Fly, item = devItem.Visible, menu.InPlay }, devOff == "dev mode is off" && !DevSheet.IsOpen && !Jef.I.Fly && !devItem.Visible && menu.InPlay);
    }

    /// <summary>No test save is kept: the server is stopped and the save, its side files and its slots are deleted.</summary>
    private string Tidy(ServerLink? link)
    {
        string db = Main.I.Arg("db");
        if (db == "" || link?.Server is not { Own: true }) return "nothing of the test's own";
        string full = Path.GetFullPath(db), home = Path.GetFullPath(dir);
        if (!full.StartsWith(home, StringComparison.OrdinalIgnoreCase)) return "the save is not in the test's folder: kept";
        link.Shutdown();
        string slots = Path.Combine(Path.GetDirectoryName(full)!, "saves", Path.GetFileNameWithoutExtension(full));
        for (int i = 0; i < 25; i++)
        {
            try
            {
                foreach (string f in new[] { full, full + "-shm", full + "-wal" }) File.Delete(f);
                if (Directory.Exists(slots)) Directory.Delete(slots, true);
                string saves = Path.GetDirectoryName(slots)!;
                if (Directory.Exists(saves) && !Directory.EnumerateFileSystemEntries(saves).Any()) Directory.Delete(saves);
                return "the test's save and its slots are deleted";
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                System.Threading.Thread.Sleep(200);
            }
        }
        return "the test's save could not be deleted (still held)";
    }

    private void Finish()
    {
        var link = ServerLink.I;
        var o = new Dictionary<string, object?> { ["ok"] = failed.Count == 0, ["failed"] = failed, ["steps"] = steps };
        o["cleaned"] = Tidy(link);
        File.WriteAllText(Path.Combine(dir, "devsheettest.json"), JsonSerializer.Serialize(o, new JsonSerializerOptions { WriteIndented = true }));
        Input.MouseMode = Input.MouseModeEnum.Visible;
        GetTree().Quit(failed.Count == 0 ? 0 : 1);
    }
}
