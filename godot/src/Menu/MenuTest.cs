using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// The menus' own test: `-- --menutest dir` (run it with --no-ai, and a --db and --port of its own). It walks
/// through every screen by script: the loading screen, the handbill, each Settings tab (changing a setting on each
/// and checking what it does), a key given to another action, the AI setup, Help, Credits, A new game, the
/// character, into the game, P's pause (the server's gate asked), the menu in play, a save into a test slot, the
/// load of it, the ink cursor, Quit to title. A picture of each goes to dir, what it did to dir/menutest.json;
/// then it quits (1 when a check failed). The settings it changes are its own (dir/settings.json), never the
/// player's.
/// </summary>
[GamePart(210)]
public partial class MenuTest : Node
{
    private string dir = "";
    private readonly List<Dictionary<string, object?>> steps = new();
    private readonly List<string> failed = new();
    private int shot;

    public MenuTest()
    {
        ProcessMode = ProcessModeEnum.Always;
    }

    public override void _Ready()
    {
        dir = Paths.TestOutput("menutest");
        if (dir == "") return;
        Directory.CreateDirectory(dir);
        _ = Run();
    }

    private async Task Wait(double s) => await ToSignal(GetTree().CreateTimer(s, true, false, true), SceneTreeTimer.SignalName.Timeout);

    private async Task<bool> Until(Func<bool> ok, double s)
    {
        double left = s;
        while (!ok())
        {
            if (left <= 0) return false;
            await Wait(0.1);
            left -= 0.1;
        }
        return true;
    }

    private async Task Shot(string name)
    {
        await Wait(0.25);
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        string file = $"{++shot + 1:00}-{name}.png";
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, file));
        steps.Add(new() { ["picture"] = file });
    }

    private void Note(string what, object? got = null, bool? ok = null)
    {
        var d = new Dictionary<string, object?> { ["step"] = what };
        if (got != null) d["got"] = got;
        if (ok != null) d["ok"] = ok;
        steps.Add(d);
        if (ok == false) failed.Add(what);
        GD.Print($"[menutest] {what}{(got != null ? $": {got}" : "")}{(ok == false ? "  FAILED" : "")}");
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

    private static void Key(Key key, bool physical = true)
    {
        foreach (bool down in new[] { true, false })
        {
            var e = new InputEventKey { Keycode = key, PhysicalKeycode = physical ? key : Godot.Key.None, Pressed = down };
            Input.ParseInputEvent(e);
        }
    }

    /// <summary>A click of the mouse in the middle of a control, as the player's.</summary>
    private async Task Click(Control c)
    {
        var at = c.GetGlobalRect().GetCenter();
        Input.ParseInputEvent(new InputEventMouseMotion { Position = at, GlobalPosition = at });
        await Wait(0.1);
        foreach (bool down in new[] { true, false })
        {
            Input.ParseInputEvent(new InputEventMouseButton { ButtonIndex = MouseButton.Left, Pressed = down, Position = at, GlobalPosition = at });
            await Wait(0.1);
        }
        await Wait(0.2);
    }

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
        if (menu == null)
        {
            Note("the menus are off", null, false);
            return;
        }
        Note("loading screen", Loading.TestShotStep, Loading.TestShotStep != "");
        bool up = await Until(() => !Loading.Busy, 160);
        Note("the loading screen went", Loading.Busy ? "still up" : "gone", up);
        var link = ServerLink.I;
        Note("the server", link?.Error is { Length: > 0 } err ? err : link?.Server?.Url ?? "none", link is { Up: true });
        await Shot("title");
        Note("the first page is not a pause", new { menu.Entered, Pause.Paused, tree = GetTree().Paused }, !menu.Entered && !Pause.Paused);

        // ---- the mouse and the keys on the handbill
        var help = Dialogs.Focusables(menu.GetParent()).OfType<InkButton>().FirstOrDefault(b => b.Label == "Help" && b.IsVisibleInTree());
        if (help != null) await Click(help);
        Note("a click on Help opens its sheet", Dialogs.Count, Dialogs.Count == 1);
        Key(Godot.Key.Escape);
        await Wait(0.3);
        Note("Esc closes it", Dialogs.Count, Dialogs.Count == 0);
        for (int i = 0; i < 3; i++)
        {
            Key(Godot.Key.Down);
            await Wait(0.1);
        }
        string focused = (GetViewport().GuiGetFocusOwner() as InkButton)?.Label ?? "";
        Note("Down three times: the third item after the first", focused, focused == "Settings");
        await Shot("title-keys");
        Key(Godot.Key.Enter);
        await Wait(0.4);
        Note("Enter opens Settings", SettingsSheet.Tab, SettingsSheet.Tab == "graphics");
        Key(Godot.Key.Right);
        await Wait(0.3);
        Note("Right on the tabs: the next page", SettingsSheet.Tab, SettingsSheet.Tab == "sound");
        var done = Dialogs.Focusables(Dialogs.Top!).OfType<InkButton>().FirstOrDefault(b => b.Label == "Done");
        if (done != null) await Click(done);
        Note("a click on Done closes the sheet", Dialogs.Count, Dialogs.Count == 0);

        // ---- Settings: each tab, a setting changed on each
        SettingsSheet.Open("graphics");
        await Shot("settings-graphics");
        var sheet = Dialogs.Top!;
        Find<Select>(sheet, "height")!.Step(-1);
        await Wait(0.3);
        Note("Lines drawn: one step down", new { height = Prefs.Num("height"), viewport = Main.I.View.Size.Y, preset = Prefs.Str("preset") }, Prefs.Num("height") == 540 && Main.I.View.Size.Y == 540 && Prefs.Str("preset") == "custom");
        Find<Tick>(Dialogs.Top!, "wobble")!.Set(true);
        Find<Tick>(Dialogs.Top!, "psxColour")!.Set(false);
        await Wait(0.3);
        var snap = Main.I.SnapGrid;
        Note("PS1 wobble on, PS1 colours off", new { snap = $"{snap.X} x {snap.Y}", wobble = Prefs.Bool("wobble"), colour = Prefs.Bool("psxColour") }, snap.X < 1000 && Prefs.Bool("wobble") && !Prefs.Bool("psxColour"));
        await Shot("settings-graphics-changed");
        Find<InkButton>(Dialogs.Top!, "reset")!.EmitSignal(BaseButton.SignalName.Pressed);
        await Wait(0.3);
        snap = Main.I.SnapGrid;
        Note("Reset this page", new { height = Prefs.Num("height"), viewport = Main.I.View.Size.Y, preset = Prefs.Str("preset"), snap = snap.X }, Prefs.Num("height") == 720 && Main.I.View.Size.Y == 720 && Prefs.Str("preset") == "high" && snap.X > 1000);

        Find<InkButton>(Dialogs.Top!, "tab_sound")!.EmitSignal(BaseButton.SignalName.Pressed);
        await Wait(0.2);
        var music = Find<InkSlider>(Dialogs.Top!, "music")!;
        for (int i = 0; i < 10; i++) music.Step(-1);
        int bus = AudioServer.GetBusIndex("Music");
        float db = bus >= 0 ? AudioServer.GetBusVolumeDb(bus) : 0;
        Note("Music down to half", new { music = Prefs.Num("music"), bus, db = Math.Round(db, 2) }, Math.Abs(Prefs.Num("music") - 0.5) < 0.001 && bus >= 0 && Math.Abs(db - Mathf.LinearToDb(0.5f)) < 0.05);
        await Shot("settings-sound");
        Prefs.Reset(new[] { "music" });

        Find<InkButton>(Dialogs.Top!, "tab_controls")!.EmitSignal(BaseButton.SignalName.Pressed);
        await Shot("settings-controls");
        Find<InkButton>(Dialogs.Top!, "key_use")!.EmitSignal(BaseButton.SignalName.Pressed);
        await Wait(0.2);
        await Shot("settings-controls-waiting");
        Key(Godot.Key.R);
        await Wait(0.3);
        Note("Use given the R key", new { use = Keys.Get("use"), fourth = Keys.Get("fourth") }, Keys.Get("use") == "KeyR" && Keys.Get("fourth") == "KeyE");
        await Shot("settings-controls-changed");
        Find<InkButton>(Dialogs.Top!, "keys-reset")!.EmitSignal(BaseButton.SignalName.Pressed);
        await Wait(0.2);
        Note("All keys as they were", Keys.Get("use"), Keys.IsDefault());
        var sens = Find<InkSlider>(Dialogs.Top!, "sens")!;
        sens.Step(1);
        Note("Mouse speed one step up", new { sens = Prefs.Num("sens"), Tuning.Sens }, Math.Abs(Tuning.Sens - 1.05f) < 0.001f);
        Prefs.Reset(new[] { "sens" });

        Find<InkButton>(Dialogs.Top!, "tab_game")!.EmitSignal(BaseButton.SignalName.Pressed);
        bool pop = await Until(() => Dialogs.Top != null && Find<Select>(Dialogs.Top, "eventSize") != null, 10);
        Note("the town's own settings came from the server", null, pop);
        await Shot("settings-game");

        Find<InkButton>(Dialogs.Top!, "tab_access")!.EmitSignal(BaseButton.SignalName.Pressed);
        await Shot("settings-access");
        float before = Kit.Scale;
        Prefs.Set(new Dictionary<string, object> { ["contrast"] = true, ["textSize"] = 1.2 });
        await Wait(0.4);
        Note("High contrast, text size 120%", new { scale = Kit.Scale, before, Kit.HiContrast }, Kit.HiContrast && Kit.Scale > before * 1.19f);
        await Shot("settings-access-high-contrast");
        Prefs.Reset(new[] { "contrast", "textSize" });
        await Wait(0.4);
        Key(Godot.Key.Escape);
        await Wait(0.3);
        Note("Esc closes the sheet", Dialogs.Count, Dialogs.Count == 0);
        string kept = File.Exists(Prefs.File) ? File.ReadAllText(Prefs.File) : "";
        Note("the settings are kept in their file", Prefs.File, kept.Contains("\"height\""));

        // ---- the other sheets
        AiSheet.Open();
        await Until(() => AiSheet.Shown, 10);
        await Shot("ai");
        Note("AI setup", AiSheet.Status, AiSheet.Shown);
        await AiSteps();
        Dialogs.CloseAll();
        Sheets.Help();
        await Shot("help");
        Dialogs.CloseAll();
        Sheets.Credits();
        await Shot("credits");
        Dialogs.CloseAll();
        Sheets.NewGame(menu);
        await Shot("new");
        Find<InkButton>(Dialogs.Top!, "newgame")!.EmitSignal(BaseButton.SignalName.Pressed);
        await Wait(0.8);
        await Shot("character");
        await CharacterSteps();
        Key(Godot.Key.Escape);
        await Wait(0.3);
        Dialogs.CloseAll();

        // ---- into the game, the pause, the menu in play
        Key(Godot.Key.Enter);
        await Wait(0.4);
        Note("Enter on the handbill walks into town", new { menu.Entered, menu.InPlay, mouse = Input.MouseMode.ToString() }, menu.InPlay);
        await Shot("in-game");
        Key(Godot.Key.P);
        await Wait(0.6);
        var gate = await Gate();
        Note("P pauses", new { Pause.Paused, reasons = string.Join(",", Pause.Reasons), tree = GetTree().Paused, server = gate?.Paused }, Pause.Has("key") && GetTree().Paused && gate?.Paused == true);
        await Shot("paused");
        // nothing moves: the server's clock stands through a tick
        var api = ServerLink.I!.Api!;
        var tick = await TryCall(api.Tick());
        Note("a tick while paused moves nothing", tick == null ? "no answer" : new { tick.Advanced }, tick is { Advanced: false });
        Key(Godot.Key.P);
        await Wait(0.6);
        gate = await Gate();
        Note("P again goes on", new { Pause.Paused, tree = GetTree().Paused, server = gate?.Paused, menu.InPlay }, !Pause.Paused && !GetTree().Paused && gate?.Paused == false && menu.InPlay);
        Key(Godot.Key.Escape);
        await Wait(0.6);
        gate = await Gate();
        Note("Esc opens the menu and pauses", new { menu.Open, Pause.Paused, server = gate?.Paused }, menu.Open && Pause.Has("menu") && gate?.Paused == true);
        await Shot("menu-in-game");

        // ---- a save into a test slot, the load of it
        menu.Saves.OpenPanel("save");
        await Until(() => menu.Saves.PanelOpen, 10);
        await Shot("save");
        string outcome = "";
        menu.Saves.Save("slot2", "Menu test", o => outcome = o);
        await Wait(0.3);
        await Shot("saving");
        await Until(() => outcome != "", 70);
        var mine = menu.Saves.List.FirstOrDefault(s => s.Slot == "slot2");
        Note("saved into slot 2", new { outcome, mine?.Label, when = mine != null ? Saves.When(mine) : "", mine?.Place }, outcome.StartsWith("saved slot2") && mine?.Label == "Menu test");
        await Shot("save-done");
        Key(Godot.Key.Escape);
        await Wait(0.3);
        // move on from the saved moment: the camera elsewhere
        var cam = Main.I.Cam;
        var was = cam.GlobalPosition;
        cam.GlobalPosition += new Vector3(40, 6, 25);
        menu.Saves.OpenPanel("load");
        await Until(() => menu.Saves.PanelOpen, 10);
        await Shot("load");
        outcome = "";
        menu.Saves.Load("slot2", o => outcome = o);
        await Until(() => outcome != "", 70);
        await Wait(0.5);
        float off = cam.GlobalPosition.DistanceTo(was);
        Note("loaded slot 2", new { outcome, back = Math.Round(off, 3), menu.Entered, Pause.Paused }, outcome == "loaded slot2" && off < 0.01f && !menu.Entered && !Pause.Paused);
        await Shot("loaded");
        gate = await Gate();
        Note("after a load the first page is not a pause", new { server = gate?.Paused }, gate?.Paused == false);

        // ---- back in, the ink cursor over a dialog of the game, quit to title
        menu.Start();
        await Wait(0.4);
        bool dialog = true;
        var fake = MainMenu.PlainCard("A dialog", "The quill works it; the mouse cannot leave the window.", "E or Esc to step away");
        var holder = MainMenu.Centre(fake);
        Main.I.Ui.AddChild(holder);
        Dialogs.Register("menutest", () => dialog, true, null, () => dialog = false);
        await Wait(0.5);
        Note("a dialog of the game: the ink cursor", new { InkCursor.I?.Shown, mouse = Input.MouseMode.ToString(), menu.InPlay }, InkCursor.I is { Shown: true } && Input.MouseMode == Input.MouseModeEnum.ConfinedHidden && menu.InPlay);
        await Shot("ink-cursor");
        Key(Godot.Key.Escape);
        await Wait(0.5);
        Note("Esc closes the dialog, not the game", new { dialog, menu.Open, mouse = Input.MouseMode.ToString() }, !dialog && !menu.Open && Input.MouseMode == Input.MouseModeEnum.Captured);
        holder.QueueFree();
        Dialogs.Unregister("menutest");
        Key(Godot.Key.Escape);
        await Wait(0.4);
        Sheets.Quit(menu);
        await Shot("quit");
        bool quit = false;
        Dialogs.CloseAll();
        Sheets.QuitToTitle(menu, () => quit = true);
        await Until(() => quit, 50);
        await Wait(0.5);
        Note("Quit to title: saved, the first page", new { last = menu.Saves.Last, menu.Entered, newest = menu.Saves.Newest?.Slot }, !menu.Entered && menu.Saves.Last.StartsWith("autosaved"));
        await Shot("title-continue");
    }

    private async Task AiSteps()
    {
        string was = AiSheet.Mode;
        AiSheet.Press("mode", "ai");
        await Until(() => AiSheet.Mode == "ai", 10);
        await Wait(0.3);
        await Shot("ai-on");
        Note("AI on (no test is run: no model call)", AiSheet.Mode, AiSheet.Mode == "ai");
        AiSheet.Press("mode", "walk");
        await Until(() => AiSheet.Mode == "walk", 10);
        await Wait(0.3);
        Note("walk-around mode again", new { AiSheet.Mode, was }, AiSheet.Mode == "walk");
    }

    private async Task CharacterSteps()
    {
        if (!CharacterSheet.IsOpen)
        {
            Note("the character sheet is up", null, false);
            return;
        }
        CharacterSheet.Press("random");
        await Wait(0.3);
        await Shot("character-random");
        Note("Random", CharacterSheet.Look, CharacterSheet.Look != "");
        CharacterSheet.Press("sunday");
        await Wait(0.3);
        Note("Sunday best", CharacterSheet.Look, CharacterSheet.Draft?.Best == true);
        await Shot("character-sunday");
    }

    private static async Task<GateReply?> Gate() => ServerLink.I?.Api is { } api ? await TryCall(api.Gate()) : null;

    private static async Task<T?> TryCall<T>(Task<T> call) where T : class
    {
        try
        {
            return await call;
        }
        catch (ApiException)
        {
            return null;
        }
    }

    /// <summary>
    /// No test save is kept: when the test's --db lies in the test's own folder, the server is stopped and the save,
    /// its side files and its slots are deleted. The pictures and menutest.json stay.
    /// </summary>
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
                // the server still holds the file for a moment
                System.Threading.Thread.Sleep(200);
            }
        }
        return "the test's save could not be deleted (still held)";
    }

    private void Finish()
    {
        var link = ServerLink.I;
        var o = new Dictionary<string, object?>
        {
            ["ok"] = failed.Count == 0,
            ["failed"] = failed,
            ["server"] = link?.Server?.Url,
            ["serverPid"] = link?.Server?.Pid,
            ["window"] = $"{GetViewport().GetVisibleRect().Size.X} x {GetViewport().GetVisibleRect().Size.Y}",
            ["scale"] = Kit.Scale,
            ["steps"] = steps,
        };
        o["cleaned"] = Tidy(link);
        File.WriteAllText(Path.Combine(dir, "menutest.json"), JsonSerializer.Serialize(o, new JsonSerializerOptions { WriteIndented = true }));
        Input.MouseMode = Input.MouseModeEnum.Visible;
        GetTree().Quit(failed.Count == 0 ? 0 : 1);
    }
}
