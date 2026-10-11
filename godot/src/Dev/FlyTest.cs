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
using Scheldemist.Ui;

namespace Scheldemist.Dev;

/// <summary>
/// The free camera's own test, through the real input path: `-- --flytest dir --no-ai --port N --db dir/test.sqlite
/// --prefs dir/settings.json` (no --dev). Into the game with Enter, `dev on` typed into the console, F9 pressed, then
/// mouse motion and the player's keys sent as events (Input.ParseInputEvent: the way the OS's arrive): the turn with
/// the mouse speed and invert of the settings, forward with the bound key and with a key given to Walk forward in
/// Controls, Jump up, Crouch down, Hurry fast, the wheel's speed; F9 lands, the walk goes on; the same from the Dev
/// sheet's "fly" button. The server's log must show no refused move while flying or after landing. Writes
/// dir/flytest.json and pictures, deletes the test's save, quits (1 when a check failed).
/// </summary>
[GamePart(987)]
public partial class FlyTest : Node
{
    private string dir = "";
    private readonly List<Dictionary<string, object?>> steps = new();
    private readonly List<string> failed = new();
    private int shot;

    public FlyTest() => ProcessMode = ProcessModeEnum.Always;

    public override void _Ready()
    {
        dir = Paths.TestOutput("flytest");
        if (dir == "") return;
        Directory.CreateDirectory(dir);
        _ = Run();
    }

    private async Task Wait(double s) => await ToSignal(GetTree().CreateTimer(s, true, false, true), SceneTreeTimer.SignalName.Timeout);
    private async Task Frames(int n) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }

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
        GD.Print($"[flytest] {what}: {JsonSerializer.Serialize(got)}{(ok ? "" : "  FAILED")}");
    }

    private static void KeyEvent(Key key, bool down) => Input.ParseInputEvent(new InputEventKey { Keycode = key, PhysicalKeycode = key, Pressed = down });

    private static void Tap(Key key)
    {
        KeyEvent(key, true);
        KeyEvent(key, false);
    }

    /// <summary>A key held for `s` seconds, as a finger would.</summary>
    private async Task Hold(Key key, double s)
    {
        KeyEvent(key, true);
        await Wait(s);
        KeyEvent(key, false);
        await Frames(2);
    }

    /// <summary>The mouse moved by (dx, dy) with the mouse taken (relative motion, as the OS sends it).</summary>
    private async Task Mouse(float dx, float dy)
    {
        var mid = GetViewport().GetVisibleRect().Size / 2;
        Input.ParseInputEvent(new InputEventMouseMotion { Relative = new Vector2(dx, dy), ScreenRelative = new Vector2(dx, dy), Position = mid, GlobalPosition = mid });
        await Frames(3);
    }

    private async Task<string> Console(string text)
    {
        var line = Main.I.Ui.FindChild("console_line", true, false) as LineEdit;
        if (line == null || !DevConsole.Open) return "no console";
        line.Text = text;
        string before = DevConsole.Last;
        Tap(Key.Enter);
        await Until(() => DevConsole.Last != before && DevConsole.Last != "> " + text, 20);
        return DevConsole.Last;
    }

    /// <summary>The server's log since the test began: its refused moves.</summary>
    private long logFrom;
    private string LogSince()
    {
        try
        {
            using var f = new FileStream(Paths.ServerLog, FileMode.Open, System.IO.FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (f.Length <= logFrom) return "";
            f.Seek(logFrom, SeekOrigin.Begin);
            return new StreamReader(f).ReadToEnd();
        }
        catch (IOException)
        {
            return "";
        }
    }
    private long LogSize() => File.Exists(Paths.ServerLog) ? new FileInfo(Paths.ServerLog).Length : 0;
    private int Refused(string log) => log.Split('\n').Count(l => l.Contains("move refused"));

    private static Key KeyOfAction(string id) => Keys.KeyOf(Keys.Get(id)).key;

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
        AudioServer.SetBusMute(AudioServer.GetBusIndex("Master"), true);
        await Until(() => !Loading.Busy, 160);
        Note("the server", ServerLink.I?.Server?.Url, ServerLink.I is { Up: true });
        Note("the server's log", Paths.ServerLog, File.Exists(Paths.ServerLog));

        // ---- into the game with the keys, dev mode by the console
        Tap(Key.Enter);
        await Until(() => menu.InPlay && GameState.I.Live && Main.I.GetNodeOrNull<Town.Townspeople>("Townspeople")?.Data != null, 60);
        Note("Enter walks into town", new { menu.InPlay, mouse = Input.MouseMode.ToString() }, menu.InPlay && Input.MouseMode == Input.MouseModeEnum.Captured);
        Tap(Key.Quoteleft);
        await Wait(0.3);
        string on = await Console("dev on");
        Tap(Key.Escape);
        await Until(() => menu.InPlay, 3);
        Note("dev on in the console, Esc back into the game", new { on, Prefs.DevMode, menu.InPlay, mouse = Input.MouseMode.ToString() }, Prefs.DevMode && menu.InPlay && Input.MouseMode == Input.MouseModeEnum.Captured);
        await Kit.I.Light(12, "clear");
        Kit.I.Go("vismarkt");
        await Wait(3);
        logFrom = LogSize();

        // ---- F9 from play
        await FlyChecks("play", () => { Tap(Key.F9); return Task.CompletedTask; });
        // ---- the Dev sheet's fly button (the sheet frees the mouse; fly must take it again)
        await FlyChecks("sheet", async () =>
        {
            Tap(Key.F8);
            await Until(() => DevSheet.IsOpen, 3);
            await Wait(0.3);
            var b = Find<InkButton>(DevSheet.Current!, "jef_fly")!;
            DevSheet.Current!.Scroll.EnsureControlVisible(b);
            await Wait(0.2);
            var at = b.GetGlobalRect().GetCenter();
            Input.ParseInputEvent(new InputEventMouseMotion { Position = at, GlobalPosition = at });
            await Wait(0.05);
            foreach (bool down in new[] { true, false })
            {
                Input.ParseInputEvent(new InputEventMouseButton { ButtonIndex = MouseButton.Left, Pressed = down, Position = at, GlobalPosition = at });
                await Wait(0.05);
            }
        });

        // ---- no refused move in the server's log, no raw HTTP error said on screen
        await Wait(2);
        string log = LogSince();
        Note("the server refused no move while flying or after landing", new { refused = Refused(log), lines = log.Split('\n').Where(l => l.Contains("[mp]")).Take(8).ToArray() }, Refused(log) == 0);
        string refusal = "";
        try { await ServerLink.I!.Api!.EmigrantBoard(-1); }
        catch (ApiException e) { refusal = $"{e.Status}: {e.Message}"; }
        Note("a refused report (409 without an error) reads as words, not HTTP 409", refusal, refusal.StartsWith("409") && !refusal.Contains("HTTP"));
        Note("nothing said on screen was a raw HTTP error", said.Where(t => t.Contains("HTTP")).ToArray(), !said.Any(t => t.Contains("HTTP")));
    }

    private readonly List<string> said = new();
    public override void _EnterTree()
    {
        if (GameState.I != null) GameState.I.Message += t => said.Add(t);
    }

    private async Task FlyChecks(string how, Func<Task> takeOff)
    {
        var jef = Jef.I;
        var stand = new Vector3(jef.X, jef.Y, jef.Z);
        await takeOff();
        await Until(() => jef.Fly, 3);
        await Wait(0.4);
        var fly = Main.I.Cam as FlyCam;
        Note($"{how}: flying, the mouse taken", new { jef.Fly, cam = Main.I.Cam?.GetType().Name, mouse = Input.MouseMode.ToString(), MainMenu.I!.InPlay }, jef.Fly && fly != null && Input.MouseMode == Input.MouseModeEnum.Captured);
        if (fly == null) return;
        fly.SpeedScale = 1;
        // the turn: the game's turn speed times the setting, the right way up or turned round
        foreach (var (sens, invert) in new[] { (1.0, false), (2.0, false), (1.0, true) })
        {
            Prefs.Set(new Dictionary<string, object> { ["sens"] = sens, ["invertY"] = invert });
            await Frames(2);
            float y0 = fly.Yaw, p0 = fly.Pitch;
            await Mouse(100, 0);
            await Mouse(0, 40);
            float dyaw = fly.Yaw - y0, dpitch = fly.Pitch - p0;
            float wantYaw = -100 * Jef.TurnSens * (float)sens, wantPitch = -40 * Jef.TurnSens * (float)sens * (invert ? -1 : 1);
            Note($"{how}: the mouse turns it (speed {sens}, invert {invert})", new { dyaw = Math.Round(dyaw, 4), wantYaw = Math.Round(wantYaw, 4), dpitch = Math.Round(dpitch, 4), wantPitch = Math.Round(wantPitch, 4) },
                Math.Abs(dyaw - wantYaw) < 0.002f && Math.Abs(dpitch - wantPitch) < 0.002f);
        }
        Prefs.Reset(new[] { "sens", "invertY" });
        // level, looking along the street, for the moves
        fly.Face(Quaternion.FromEuler(new Vector3(0, fly.Yaw, 0)));
        async Task<Vector3> Move(Key key, double s)
        {
            var a = fly.GlobalPosition;
            await Hold(key, s);
            return fly.GlobalPosition - a;
        }
        var fwd = -fly.GlobalBasis.Z;
        var d = await Move(KeyOfAction("forward"), 1);
        Note($"{how}: Walk forward ({Keys.Label("forward")}) flies forward", new { moved = Math.Round(d.Length(), 2), along = Math.Round(d.Dot(fwd), 2) }, d.Dot(fwd) > 8 && d.Dot(fwd) < 16);
        d = await Move(KeyOfAction("back"), 0.5);
        Note($"{how}: Walk back flies back", Math.Round(d.Dot(fwd), 2), d.Dot(fwd) < -3);
        d = await Move(KeyOfAction("left"), 0.5);
        Note($"{how}: Step left", Math.Round(d.Dot(fly.GlobalBasis.X), 2), d.Dot(fly.GlobalBasis.X) < -3);
        d = await Move(KeyOfAction("jump"), 0.5);
        Note($"{how}: Jump rises", Math.Round(d.Y, 2), d.Y > 3);
        d = await Move(KeyOfAction("crouch"), 0.5);
        Note($"{how}: Crouch sinks", Math.Round(d.Y, 2), d.Y < -3);
        // Hurry with forward: fast
        var a0 = fly.GlobalPosition;
        KeyEvent(KeyOfAction("hurry"), true);
        await Hold(KeyOfAction("forward"), 0.5);
        KeyEvent(KeyOfAction("hurry"), false);
        float fast = (fly.GlobalPosition - a0).Length();
        Note($"{how}: Hurry flies fast", Math.Round(fast, 2), fast > 15);
        // the wheel: faster
        for (int i = 0; i < 3; i++)
            foreach (bool down in new[] { true, false }) Input.ParseInputEvent(new InputEventMouseButton { ButtonIndex = MouseButton.WheelUp, Pressed = down });
        await Frames(2);
        d = await Move(KeyOfAction("forward"), 0.5);
        Note($"{how}: the wheel makes it faster", new { fly.SpeedScale, moved = Math.Round(d.Length(), 2) }, fly.SpeedScale > 1.9f && d.Length() > 9);
        fly.SpeedScale = 1;
        // a key given to Walk forward in Controls: it flies with that one
        if (how == "play")
        {
            Keys.Set("forward", "KeyU");
            d = await Move(Key.U, 0.5);
            Note("a key given to Walk forward (U) flies forward", Math.Round(d.Length(), 2), d.Length() > 4);
            Keys.Reset();
        }
        Note($"{how}: Jef stays where he took off while the camera flies", new { moved = Math.Round(new Vector3(jef.X, jef.Y, jef.Z).DistanceTo(stand), 3) }, new Vector3(jef.X, jef.Y, jef.Z).DistanceTo(stand) < 0.05f);
        await Shot(how + "-flying");
        // land over the square, then walk on
        fly.GlobalPosition = new Vector3(-118, 20, 34);
        Tap(Key.F9);
        await Wait(1);
        Note($"{how}: F9 lands Jef under the camera", new { jef.Fly, x = Math.Round(jef.X, 1), z = Math.Round(jef.Z, 1), mouse = Input.MouseMode.ToString() }, !jef.Fly && Math.Abs(jef.X + 118) < 6 && Math.Abs(jef.Z - 34) < 6 && Input.MouseMode == Input.MouseModeEnum.Captured);
        var w0 = new Vector3(jef.X, 0, jef.Z);
        await Hold(KeyOfAction("forward"), 1);
        float walked = new Vector3(jef.X, 0, jef.Z).DistanceTo(w0);
        Note($"{how}: after landing he walks with the keys", Math.Round(walked, 2), walked > 0.5f);
        await Mouse(-100, 0);
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
        File.WriteAllText(Path.Combine(dir, "flytest.json"), JsonSerializer.Serialize(o, new JsonSerializerOptions { WriteIndented = true }));
        Input.MouseMode = Input.MouseModeEnum.Visible;
        GetTree().Quit(failed.Count == 0 ? 0 : 1);
    }
}
