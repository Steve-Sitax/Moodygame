using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Player;
using Scheldemist.Ui;
using UiKit = Scheldemist.Ui.Kit;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>
/// The Dev sheet (the browser's game/devmenu.ts panel "Time, weather, events"), on the game's paper: time, weather,
/// the tide, the NPC stress test, the events (the movers' passages, thick fog, a shower, every director template),
/// Jef (needs, money, fly) and the places to go to, with the console's line at the foot. Opened by F8 (also while
/// walking: the town pauses under it, and closing it walks on) and by the menu's Dev line, in dev mode only
/// (the console's `dev on`, Ctrl+Alt+Shift+D, or `-- --dev`). What each button does is in DevTools; its answer shows at the foot.
/// </summary>
public static class DevSheet
{
    private static Sheet? sheet;
    private static Label? status;
    private static bool busy;
    private static readonly int[] Hours = { 0, 3, 6, 8, 10, 12, 14, 16, 18, 19, 20, 22 };
    private static readonly string[] Weathers = { "fog", "mist", "clear", "rain", "storm" };

    public static bool IsOpen => sheet != null && Dialogs.IsOpen(sheet);
    public static Sheet? Current => IsOpen ? sheet : null;
    /// <summary>The last answer shown at the foot (the self-test reads it).</summary>
    public static string Last { get; private set; } = "";
    /// <summary>A button's work is under way (a call to the server).</summary>
    public static bool Busy => busy;

    public static void Close()
    {
        if (sheet != null) Dialogs.Close(sheet);
    }

    public static void Open()
    {
        if (IsOpen || DevTools.I == null) return;
        var menu = MainMenu.I;
        // opened while walking (F8): the town pauses under it, as under the menu, and closing it walks on
        bool fromPlay = menu == null ? Dialogs.Count == 0 : menu.InPlay;
        var s = new Sheet("Dev", "Time, weather, events", 900);
        sheet = s;
        var t = DevTools.I;
        var body = s.Body;

        body.AddChild(UiKit.Heading("Time"));
        body.AddChild(Flow(Hours, h => Btn($"hour_{h}", $"{h}:00", () => t.Hour(h))));
        body.AddChild(UiKit.Heading("Weather"));
        body.AddChild(Flow(Weathers, w => Btn($"weather_{w}", w, () => t.Weather(w))));
        body.AddChild(UiKit.Heading("Tide"));
        body.AddChild(Flow(new[] { ("now", "now"), ("high", "high water"), ("low", "low water"), ("clock", "follow the clock") }, x => Btn($"tide_{x.Item1}", x.Item2, () => Task.FromResult(t.TideHold(x.Item1)))));

        body.AddChild(UiKit.Heading("NPC stress test"));
        var popLine = UiKit.Text("", Fonts.PrintItalic, 14, UiKit.InkSoft, true);
        InkSlider? slider = null;
        Tick? extra = null;
        void Show()
        {
            if (!GodotObject.IsInstanceValid(popLine)) return;
            popLine.Text = $"Normal street limit: {t.StressBase}. Extra NPCs: {t.StressExtra:N0} / {t.StressTarget:N0}.";
        }
        extra = new Tick(t.StressMultiplier > 1, on =>
        {
            t.SetStress(on ? (int)Math.Round(slider!.Value) : 1);
            Show();
        }) { Name = "pop_enabled" };
        slider = new InkSlider(1, 100, 1, Math.Max(1, t.StressMultiplier), v => $"{Math.Round(v)}x", v =>
        {
            if (extra.Value) t.SetStress((int)Math.Round(v));
            Show();
        }, v =>
        {
            if (extra.Value) t.SetStress((int)Math.Round(v));
            Show();
        }) { Name = "pop_multiplier" };
        body.AddChild(UiKit.Row("Extra street NPCs", extra, "Adds walking people round you while you play: real walkers, no AI calls. This run only."));
        body.AddChild(UiKit.Row("Population", slider, "Times the normal street limit (Settings, Graphics, People in the street)."));
        var reset = new InkButton(InkButton.Look.Btn, "Reset to normal", () =>
        {
            extra.Set(false);
            slider.Set(1);
            t.SetStress(1);
            Show();
            Say("NPC stress test: back to normal");
        }) { Name = "pop_reset", Small = true };
        body.AddChild(Pad(UiKit.Side(popLine, reset), 6));
        s.AddChild(new Ticker { Every = 0.5, Do = Show });
        Show();

        body.AddChild(UiKit.Heading("Events"));
        var events = new List<Control>
        {
            Btn("ev_lock_in", "Ship into the dock", () => Task.FromResult(t.LockPass("in"))),
            Btn("ev_lock_out", "Ship out of the dock", () => Task.FromResult(t.LockPass("out"))),
            Btn("ev_canal", "Boat up the canal", () => Task.FromResult(t.Passage("canal"))),
            Btn("ev_vliet", "Boat up the vliet", () => Task.FromResult(t.Passage("vliet"))),
            Btn("ev_fog", "Thick fog on/off", () => Task.FromResult(t.ThickFog(!Daylight.I.ThickFog))),
            Btn("ev_shower", "Rain shower on/off", () => Task.FromResult(t.Shower(Daylight.I.ManualRain < 0.5f))),
        };
        foreach (string tp in DevTools.Templates) events.Add(Btn("ev_" + tp, "Event: " + DevTools.Words(tp), () => t.Event(tp)));
        events.Add(Btn("ev_think", "Director: think now", () => t.Director(false)));
        events.Add(Btn("ev_invent", "Director: invent an event now", () => t.Director(true)));
        body.AddChild(Flow(events, c => c));

        body.AddChild(UiKit.Heading("Jef"));
        body.AddChild(Flow(new[]
        {
            Btn("jef_needs", "needs full", t.NeedsFull),
            Btn("jef_money", "+100 c", () => t.Money(100)),
            Btn("jef_fly", "fly over the town (F9)", () =>
            {
                // out of the sheet and into the game, flying
                Close();
                if (MainMenu.I is { InPlay: false } m) m.Start();
                return Task.FromResult(Jef.I.Fly ? "already flying: F9 lands" : t.ToggleFly());
            }),
        }, c => c));

        body.AddChild(UiKit.Heading("Go to"));
        var places = new List<Control>();
        for (int i = 0; i < DevTools.Places.Length; i++)
        {
            int at = i;
            places.Add(Btn("go_" + i, DevTools.Places[i].Name, () => Task.FromResult(t.GoTo(at))));
        }
        body.AddChild(Flow(places, c => c));

        body.AddChild(UiKit.Heading("Console"));
        var line = UiKit.Input("", 520, mono: true, placeholder: "hour 13 clear; go vismarkt; summon fishwife; tide high; event musicians");
        line.Name = "console";
        line.KeepEditingOnTextSubmit = true;
        line.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        async Task<string> RunLine()
        {
            string text = line.Text.Trim();
            if (text == "") return Kit.Help;
            string r = await DevConsole.Run(text);
            if (!r.StartsWith("failed")) line.Text = "";
            return r;
        }
        line.TextSubmitted += text => _ = Do("console", RunLine);
        var run = Btn("console_run", "Run", RunLine);
        body.AddChild(Pad(UiKit.Side(line, run), 6));
        body.AddChild(UiKit.Para(Kit.Help + ". The key left of 1 opens the same console over the game and the menu; dev off there, or Ctrl+Alt+Shift+D, switches dev mode off.", 14, true));
        body.AddChild(UiKit.Para("Time, weather, needs and money change the save; the tide, the fog, the shower and the extra people are this run's only. F9 flies over the town; F9 again lands Jef where you are.", 14, true));

        status = UiKit.Text(Last == "" ? "Pick a time, a weather or an event." : Last, Fonts.Hand, 15, UiKit.Rust, true);
        status.Name = "status";
        status.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        s.Foot.AddChild(status);
        s.AddBack();

        Dialogs.Open(s, () =>
        {
            if (sheet == s)
            {
                sheet = null;
                status = null;
            }
            if (fromPlay) Callable.From(Resume).CallDeferred();
        });
        // the first button has the focus, but the sheet starts at its top (the Time heading in sight)
        Callable.From(() => Callable.From(() => { if (GodotObject.IsInstanceValid(s)) s.Scroll.ScrollVertical = 0; }).CallDeferred()).CallDeferred();
        if (fromPlay)
        {
            Input.MouseMode = Input.MouseModeEnum.Visible;
            if (menu is { Entered: true }) Pause.Set("menu", true);
        }
    }

    /// <summary>Back into the game after an F8 sheet: the mouse to Jef again (and the menu's pause off).</summary>
    private static void Resume()
    {
        var m = MainMenu.I;
        if (m == null)
        {
            if (Dialogs.Count == 0 && !Dialogs.Any()) Input.MouseMode = Input.MouseModeEnum.Captured;
            return;
        }
        if (m.Entered && !m.Open && Dialogs.Count == 0 && !Pause.Has("key") && !Pause.Has("saving") && !Pause.Has("loading")) m.Start();
    }

    private static void Say(string text)
    {
        Last = text;
        if (status != null && GodotObject.IsInstanceValid(status)) status.Text = text;
        GD.Print("dev sheet: " + text);
    }

    /// <summary>One button's work: "label: ..." while it runs, then its answer; one at a time.</summary>
    private static async Task Do(string label, Func<Task<string>> work)
    {
        if (busy) return;
        busy = true;
        Say(label + ": ...");
        try
        {
            Say(await work());
        }
        catch (Exception e)
        {
            Say($"{label}: failed ({e.Message})");
        }
        finally
        {
            busy = false;
        }
    }

    private static InkButton Btn(string name, string label, Func<Task<string>> work)
    {
        var b = new InkButton(InkButton.Look.Btn, label) { Name = name, Small = true };
        b.Pressed += () => _ = Do(label, work);
        return b;
    }

    private static Control Flow<T>(IEnumerable<T> items, Func<T, Control> make)
    {
        var f = new HFlowContainer { MouseFilter = Control.MouseFilterEnum.Ignore, SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        f.AddThemeConstantOverride("h_separation", UiKit.Px(6));
        f.AddThemeConstantOverride("v_separation", UiKit.Px(6));
        foreach (var it in items) f.AddChild(make(it));
        return Pad(f, 4);
    }

    private static Control Pad(Control c, float y)
    {
        var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        m.AddThemeConstantOverride("margin_top", UiKit.Px(y));
        m.AddThemeConstantOverride("margin_bottom", UiKit.Px(y));
        m.AddChild(c);
        return m;
    }
}
