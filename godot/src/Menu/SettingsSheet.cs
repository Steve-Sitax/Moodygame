using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// The Settings sheet (the browser's menu/menu.ts drawSettings): five tabs (Graphics, Sound, Controls, Game,
/// Accessibility), every setting saved as it is changed and applied at once (Apply.cs). Left and Right on a tab
/// go to the next page; Controls catches the next key for an action.
/// </summary>
public static class SettingsSheet
{
    private static readonly (string id, string label)[] Tabs = { ("graphics", "Graphics"), ("sound", "Sound"), ("controls", "Controls"), ("game", "Game"), ("access", "Accessibility") };

    // menu.ts TAB_KEYS: what "Reset this page" puts back
    private static readonly Dictionary<string, string[]> TabKeys = new()
    {
        ["graphics"] = new[] { "preset", "height", "scale", "psxColour", "wobble", "fullscreen", "view", "rooms", "street", "reflections", "shadows", "lightBudget", "particles", "frameCap", "showFps" },
        ["sound"] = new[] { "master", "music", "ambience", "voices", "effects" },
        ["controls"] = new[] { "sens", "invertY", "fov", "headBob" },
        ["game"] = new[] { "bubbles", "autosave", "miniMap", "language" },
        ["access"] = new[] { "textSize", "contrast", "reduceMotion", "colourSafe" },
    };

    private static Sheet? sheet;
    private static string tab = "graphics";
    private static string? capturing;
    private static string msg = "";
    private static Label? frameLine;
    private static InkButton? benchBtn;
    private static bool hooked;

    /// <summary>The tab on show ("graphics" ...), or "" when the sheet is closed.</summary>
    public static string Tab => sheet != null && Dialogs.IsOpen(sheet) ? tab : "";

    public static void Open(string which)
    {
        tab = which;
        capturing = null;
        msg = "";
        Draw(false);
        if (hooked) return;
        hooked = true;
        Kit.LookChanged += () =>
        {
            if (sheet != null && Dialogs.IsOpen(sheet)) Callable.From(() => Draw(true)).CallDeferred();
        };
    }

    private static string Pct(double v) => $"{Math.Round(v * 100)}%";

    private static void Draw(bool keep)
    {
        string focusKey = "";
        int scroll = 0;
        if (sheet != null && Dialogs.IsOpen(sheet))
        {
            scroll = sheet.Scroll.ScrollVertical;
            if (keep && sheet.GetViewport()?.GuiGetFocusOwner() is { } f && sheet.IsAncestorOf(f)) focusKey = FocusName(f);
            var old = sheet;
            sheet = null;
            Dialogs.Close(old);
        }
        var s = new Sheet("Settings");
        sheet = s;
        // the tabs: ledger tabs along the top, a line under them
        var bar = new HBoxContainer { Alignment = BoxContainer.AlignmentMode.Center, MouseFilter = Control.MouseFilterEnum.Ignore };
        bar.AddThemeConstantOverride("separation", Kit.Px(4));
        foreach (var (id, label) in Tabs)
        {
            string to = id;
            var b = new InkButton(InkButton.Look.Tab, label) { On = id == tab, Name = "tab_" + id };
            b.Pressed += () =>
            {
                tab = to;
                capturing = null;
                msg = "";
                Draw(false);
            };
            bar.AddChild(b);
        }
        s.Head.AddChild(bar);
        s.Head.AddChild(new Line { Colour = Kit.Ink, CustomMinimumSize = new Vector2(0, Math.Max(1, Kit.Px(1.5f))) });

        var body = s.Body;
        switch (tab)
        {
            case "graphics":
                Graphics(body);
                break;
            case "sound":
                Sound(body);
                break;
            case "controls":
                Controls(body);
                break;
            case "game":
                GameTab(body, s);
                break;
            default:
                Access(body);
                break;
        }

        s.Foot.AddChild(new InkButton(InkButton.Look.Btn, "Reset this page", () =>
        {
            if (tab == "controls") Keys.Reset();
            Prefs.Reset(TabKeys[tab]);
            if (tab == "graphics") Prefs.Set("preset", Prefs.Default("preset"), true);
            Draw(true);
        }) { Name = "reset" });
        s.Foot.AddChild(Kit.Text("Saved as you change it", Fonts.PrintItalic, 13, Kit.InkSoft));
        s.Foot.AddChild(Kit.Spring());
        s.AddBack("Done", true);

        Dialogs.Open(s, () =>
        {
            if (sheet == s)
            {
                sheet = null;
                capturing = null;
                if (MainMenu.I != null) MainMenu.I.KeyGrab = null;
            }
        });
        if (MainMenu.I != null) MainMenu.I.KeyGrab = OnKey;
        if (keep)
        {
            Callable.From(() =>
            {
                if (sheet != s) return;
                s.Scroll.ScrollVertical = scroll;
                if (focusKey != "" && Dialogs.Focusables(s).FirstOrDefault(c => FocusName(c) == focusKey) is { } again) again.GrabFocus();
            }).CallDeferred();
        }
    }

    /// <summary>A control's name for finding it again after the sheet was drawn anew.</summary>
    private static string FocusName(Control c) => c.GetParent() is Seg seg ? $"{seg.Name}/{c.GetIndex()}" : c.Name.ToString();

    // ------------------------------------------------------------------ the controls of a setting

    private static Control Row(string label, Control ctl, string note = "") => Kit.Row(label, ctl, note);

    private static Seg SegOf(string key, (string id, string label)[] opts)
    {
        var seg = new Seg(opts, Prefs.Str(key), v =>
        {
            if (key == "preset")
            {
                if (v != "custom") Prefs.Preset(v);
            }
            else Prefs.Set(key, v);
            Draw(true);
        }) { Name = key };
        return seg;
    }

    private static Seg SegNum(string key, (double v, string label)[] opts)
    {
        var o = opts.Select(x => (x.v.ToString(CultureInfo.InvariantCulture), x.label)).ToArray();
        return new Seg(o, Prefs.Num(key).ToString(CultureInfo.InvariantCulture), v =>
        {
            Prefs.Set(key, double.Parse(v, CultureInfo.InvariantCulture));
            Draw(true);
        }) { Name = key };
    }

    private static Tick Toggle(string key) => new(Prefs.Bool(key), on =>
    {
        Prefs.Set(key, on);
        if (Tabs.Any(t => t.id == tab && TabKeys[t.id].Contains(key)) && (tab == "graphics" || key is "contrast" or "reduceMotion")) Draw(true);
    }) { Name = key };

    // sound, the text size, the bubbles and the mouse follow the slider as it moves; the rest when it is let go
    private static readonly string[] Live = { "master", "music", "ambience", "voices", "effects", "bubbles", "sens" };

    private static InkSlider Range(string key, double lo, double hi, double step, Func<double, string> show)
    {
        bool live = Live.Contains(key);
        return new InkSlider(lo, hi, step, Prefs.Num(key), show, live ? v => Prefs.Set(key, v) : null, v =>
        {
            Prefs.Set(key, v);
            if (tab == "graphics" || key == "textSize") Draw(true);
        }) { Name = key };
    }

    private static Select SelectNum(string key, (double v, string label)[] opts)
    {
        var o = opts.Select(x => (x.v.ToString(CultureInfo.InvariantCulture), x.label)).ToArray();
        return new Select(o, Prefs.Num(key).ToString(CultureInfo.InvariantCulture), v =>
        {
            Prefs.Set(key, double.Parse(v, CultureInfo.InvariantCulture));
            Draw(true);
        }) { Name = key };
    }

    // ------------------------------------------------------------------ the tabs

    private static string FrameLine() => Apply.Samples == 0
        ? "Not measured yet: go into the game for a moment."
        : $"In play just now: {Math.Round(Apply.Fps)} frames a second, {Apply.Interval:0.0} ms a frame (the game's own work {Apply.Work:0.0} ms).";

    private static void Graphics(VBoxContainer body)
    {
        // .frame-box: the frames as measured, and the test of this computer
        var box = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        box.AddThemeStyleboxOverride("panel", Kit.Box(Kit.Wash(0.25f), Kit.InkFaint, 1, 0, 12, 7));
        var line = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        line.AddThemeConstantOverride("separation", Kit.Px(12));
        frameLine = Kit.Text(FrameLine(), Fonts.Print, 14.5f, Kit.Ink, true);
        frameLine.SizeFlagsVertical = Control.SizeFlags.ShrinkCenter;
        line.AddChild(frameLine);
        benchBtn = new InkButton(InkButton.Look.Btn, Apply.BenchmarkRunning ? "Measuring..." : "Test this computer", () =>
        {
            Apply.RunBenchmark();
            Draw(true);
        }) { Small = true, Name = "bench", SizeFlagsVertical = Control.SizeFlags.ShrinkCenter };
        line.AddChild(benchBtn);
        box.AddChild(line);
        var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        m.AddThemeConstantOverride("margin_top", Kit.Px(4));
        m.AddThemeConstantOverride("margin_bottom", Kit.Px(6));
        m.AddChild(box);
        body.AddChild(m);
        var ticker = new Ticker { Every = 0.5, Do = () =>
        {
            if (frameLine != null && GodotObject.IsInstanceValid(frameLine)) frameLine.Text = FrameLine();
        } };
        body.AddChild(ticker);

        body.AddChild(Row("Quality", SegOf("preset", new[] { ("low", "Low"), ("medium", "Medium"), ("high", "High"), ("custom", "Custom") }), "Low for an older or small computer; High is the game as made. A change below makes it Custom."));
        body.AddChild(Kit.Heading("Picture"));
        body.AddChild(Row("Lines drawn", SelectNum("height", Prefs.Heights.Select(h => ((double)h.lines, h.label)).ToArray()), "720 lines by default; 270 lines is the old PS1 look. More lines cost more of the graphics card."));
        body.AddChild(Row("Render scale", Range("scale", 0.5, 1, 0.05, Pct), "Fewer pixels than the lines above: faster, coarser."));
        body.AddChild(Row("PS1 colours", Toggle("psxColour"), "Few colours and a fine dither."));
        body.AddChild(Row("PS1 wobble", Toggle("wobble"), "Corners jump to the pixel grid."));
        body.AddChild(Row("Full screen", Toggle("fullscreen"), "The game over the whole screen, without a window's frame. F11 does the same."));
        body.AddChild(Kit.Heading("The world"));
        body.AddChild(Row("View distance", Range("view", 0.6, 1.2, 0.05, Pct), "Where the fog closes in. Nearer: less to draw."));
        body.AddChild(Row("Rooms seen through windows", Range("rooms", 0, 8, 1, v => v > 0 ? v.ToString("0") : "none"), "Taverns, shops and homes drawn inside while you look in from the street."));
        body.AddChild(Row("People in the street", SegOf("street", Prefs.StreetLevels.Select(l => (l.id, l.label)).ToArray()), $"How many townspeople walk round you at once ({string.Join(", ", Prefs.StreetLevels.Select(l => l.cap))})."));
        body.AddChild(Row("Reflections", SegOf("reflections", new[] { ("off", "Off"), ("coarse", "Coarse"), ("full", "Full") }), "The river and the puddles as mirrors: the town drawn a second time."));
        body.AddChild(Row("Lantern shadows", Toggle("shadows"), "The nearest carried lantern throws shadows."));
        body.AddChild(Row("Light from windows and lamps", SegOf("lightBudget", new[] { ("low", "Low"), ("medium", "Medium"), ("high", "High") }), "How many lights are worked out for every pixel; the rest light the ground only."));
        body.AddChild(Row("Leaves, birds and mist", SegOf("particles", new[] { ("off", "Off"), ("some", "Some"), ("all", "All") }), "The town's small life in the air and on the roofs."));
        body.AddChild(Kit.Heading("Frames"));
        body.AddChild(Row("Frame cap", SelectNum("frameCap", new[] { (0.0, "None: as fast as the screen"), (30, "30 a second"), (45, "45 a second"), (60, "60 a second"), (90, "90 a second"), (120, "120 a second"), (144, "144 a second") }), "A cap keeps a laptop cooler and quieter."));
        body.AddChild(Row("Show the frame time", Toggle("showFps"), "A small counter in the top right corner while you play."));
    }

    private static void Sound(VBoxContainer body)
    {
        void R(string k, string l, string note) => body.AddChild(Row(l, Range(k, 0, 1, 0.05, Pct), note));
        R("master", "All sound", "Everything together.");
        R("music", "Music", "The organ, ballads, the fiddle and a tavern's song.");
        R("ambience", "The town", "Wind, water, rain, bells, gulls, carts and the far-off ships.");
        R("voices", "Voices", "Townspeople talking, street cries, a crowd.");
        R("effects", "Your own sounds", "Footsteps, splashes, goods set down, coins.");
    }

    private static void Controls(VBoxContainer body)
    {
        body.AddChild(Kit.Heading("Mouse and view"));
        body.AddChild(Row("Mouse speed", Range("sens", 0.25, 3, 0.05, Pct)));
        body.AddChild(Row("Turn the mouse's up and down round", Toggle("invertY")));
        body.AddChild(Row("Field of view", Range("fov", 55, 100, 1, v => $"{v:0}°"), "How wide you see. 75° as made."));
        body.AddChild(Row("Head bob", Toggle("headBob"), "The view rocks a little as Jef walks."));
        body.AddChild(Kit.Para("Click a key, then press the new one. A key another action has goes to that action in exchange. Esc, Enter, Tab, the digits (the choices in a talk), the F keys and the arrows (a second set of walking keys) stay as they are.", 16, true));
        var m = Kit.Text(msg, Fonts.Hand, 15, Kit.Rust, true);
        m.CustomMinimumSize = new Vector2(0, Kit.Px(20));
        m.Name = "msg";
        body.AddChild(m);
        foreach (string g in Keys.Actions.Select(a => a.Group).Distinct())
        {
            body.AddChild(Kit.Heading(g));
            // .key-grid: two columns of typewriter keys
            var grid = new GridContainer { Columns = 2, MouseFilter = Control.MouseFilterEnum.Ignore };
            grid.AddThemeConstantOverride("h_separation", Kit.Px(34));
            grid.AddThemeConstantOverride("v_separation", 0);
            foreach (var a in Keys.Actions.Where(x => x.Group == g))
            {
                string id = a.Id;
                string now = Keys.Get(id);
                bool wait = capturing == id;
                var cap = new InkButton(InkButton.Look.KeyCap, wait ? "Press a key..." : Keys.CodeName(now)) { MinWidth = 74, Waiting = wait, Changed = now != a.Code, Name = "key_" + id };
                cap.Pressed += () =>
                {
                    capturing = capturing == id ? null : id;
                    Draw(true);
                };
                var row = Kit.Row(a.Label, cap, a.Also, 4);
                row.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
                grid.AddChild(row);
            }
            body.AddChild(grid);
        }
        var btns = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        btns.AddChild(new InkButton(InkButton.Look.Btn, "All keys as they were", () =>
        {
            Keys.Reset();
            Draw(true);
        }) { Small = true, Name = "keys-reset" });
        var bm = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        bm.AddThemeConstantOverride("margin_top", Kit.Px(12));
        bm.AddThemeConstantOverride("margin_bottom", Kit.Px(4));
        bm.AddChild(btns);
        body.AddChild(bm);
    }

    private static void GameTab(VBoxContainer body, Sheet s)
    {
        body.AddChild(Row("Speech bubbles", Range("bubbles", 0.7, 1.8, 0.05, Pct), "The size of the words over the heads of people talking."));
        body.AddChild(Row("Autosave", SegNum("autosave", new[] { (1.0, "Each hour"), (2, "2 hours"), (4, "4 hours"), (0, "On leaving") }), "In game hours. The game also saves when you quit to the title or leave it."));
        body.AddChild(Row("Map in the corner", SegOf("miniMap", new[] { ("off", "Off"), ("small", "Small"), ("large", "Large") }), $"A round map in the top right corner, turned the way you look, with your work on it. {Keys.Label("map")} still opens the big map."));
        body.AddChild(Row("Language", new Select(new[] { ("en", "English") }, "en", _ => { }) { Name = "language" }, "More languages later. Names stay Dutch."));
        body.AddChild(Row("The clock", Kit.Text("A game hour is two real minutes", Fonts.PrintItalic, 15, Kit.InkSoft), "The town's clock runs on the server and is the same for everyone."));
        body.AddChild(Kit.Heading("The town"));
        var pop = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, Name = "pop" };
        pop.AddThemeConstantOverride("separation", 0);
        pop.AddChild(Kit.Para("Asking the town...", 16, true));
        body.AddChild(pop);
        Population(pop, s, null);
    }

    /// <summary>menu.ts drawServer: the town's own settings (the server's): the biggest event, the town size for a new game.</summary>
    private static void Population(VBoxContainer box, Sheet s, Dictionary<string, object?>? change)
    {
        void Fail()
        {
            if (sheet != s || !GodotObject.IsInstanceValid(box)) return;
            foreach (var c in box.GetChildren()) c.QueueFree();
            box.AddChild(Kit.Para("The town's settings cannot be reached just now.", 16, true));
        }
        var api = ServerLink.I?.Api;
        if (api == null)
        {
            Fail();
            return;
        }
        api.Run(change == null ? api.Population() : api.SetPopulation(change), v =>
        {
            if (sheet != s || !GodotObject.IsInstanceValid(box)) return;
            foreach (var c in box.GetChildren()) c.QueueFree();
            try
            {
                int size = v.GetProperty("eventSize").GetInt32();
                var sizes = v.GetProperty("eventSizes").EnumerateArray().Select(n => (n.GetInt32().ToString(), $"up to {n.GetInt32()} people")).ToArray();
                box.AddChild(Row("Biggest event", new Select(sizes, size.ToString(), id => Population(box, s, new Dictionary<string, object?> { ["eventSize"] = int.Parse(id) })) { Name = "eventSize" }, "The most people a wedding, a funeral or a street show may gather."));
                var towns = v.GetProperty("townSizes").EnumerateArray().ToList();
                var cur = v.GetProperty("current");
                string curId = cur.GetProperty("size").GetString() ?? "";
                string curLabel = towns.Where(t => t.GetProperty("id").GetString() == curId).Select(t => t.GetProperty("label").GetString()).FirstOrDefault() ?? "Normal";
                var opts = towns.Select(t => (t.GetProperty("id").GetString() ?? "", $"{t.GetProperty("label").GetString()} (about {t.GetProperty("about").GetInt32()} people)")).ToArray();
                box.AddChild(Row("Town size for a new game", new Select(opts, v.GetProperty("townSize").GetString() ?? "", id => Population(box, s, new Dictionary<string, object?> { ["townSize"] = id })) { Name = "townSize" }, $"This week's town stays as it is: {cur.GetProperty("residents").GetInt32()} people ({curLabel}). The new size starts with a new game."));
            }
            catch (Exception e) when (e is KeyNotFoundException or InvalidOperationException or JsonException)
            {
                Fail();
            }
        }, _ => Fail());
    }

    private static void Access(VBoxContainer body)
    {
        body.AddChild(Row("Text size", Range("textSize", 0.8, 1.6, 0.05, Pct), "All the papers, notes and hints on screen."));
        body.AddChild(Row("High-contrast paper", Toggle("contrast"), "White paper and black ink, no sepia, stronger lines."));
        body.AddChild(Row("Reduce motion", Toggle("reduceMotion"), "No head bob, no sway, no fading and sliding of the papers."));
        body.AddChild(Row("Colour-safe markers", Toggle("colourSafe"), "Warnings in blue and orange with a mark, not red on brown."));
    }

    // ------------------------------------------------------------------ a key being caught (menu.ts menuKey, capturing)

    private static bool OnKey(InputEventKey e)
    {
        if (capturing == null || sheet == null || !Dialogs.IsOpen(sheet) || Dialogs.Top != sheet) return false;
        if (e.Echo) return true;
        string code = Keys.CodeOf(e);
        if (code == "Escape")
        {
            capturing = null;
            Draw(true);
            return true;
        }
        if (Keys.Fixed.IsMatch(code))
        {
            msg = $"{Keys.CodeName(code)} keeps its own job: pick another key.";
            Draw(true);
            return true;
        }
        string id = capturing;
        capturing = null;
        string? swapped = Keys.Set(id, code);
        string label = Keys.Actions.First(a => a.Id == id).Label;
        if (swapped != null)
        {
            var other = Keys.Actions.First(a => a.Id == swapped);
            msg = $"{label} is now {Keys.CodeName(code)}; {other.Label} took {Keys.KeyLabel(other.Code)} in exchange.";
        }
        else msg = $"{label} is now {Keys.CodeName(code)}.";
        Draw(true);
        return true;
    }

    /// <summary>For a test: the key an action waits for is pressed (as if on the keyboard).</summary>
    public static void BeginCapture(string id)
    {
        capturing = id;
        Draw(true);
    }
}

/// <summary>Runs a piece of code every so often while it is on screen (the frame line of Graphics).</summary>
public partial class Ticker : Node
{
    public double Every = 0.5;
    public Action? Do;
    private double since;
    public override void _Process(double delta)
    {
        since += delta;
        if (since < Every) return;
        since = 0;
        Do?.Invoke();
    }
}
