using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Player;
using Scheldemist.Ui;
using UiKit = Scheldemist.Ui.Kit;

namespace Scheldemist.Dev;

/// <summary>
/// The console: always there, in the game and on the menu. The key left of 1 (by its place on the keyboard: `²` on
/// a Belgian AZERTY, `` ` `` on a US one) opens and closes it, Esc closes it. While it is open in play the town pauses
/// (as under the menu) and the keys are its own. `help` lists the commands; `dev on` and `dev off` switch dev mode
/// (kept in the settings file); the test kit's commands (Kit.cs: hour, weather, go, summon, job, skip, clear, tide,
/// event, pass, lock, fog, shower, fly) work only in dev mode. Ctrl+Alt+Shift+D switches dev mode too, with a note
/// on screen. `-- --dev` switches it on for one run.
/// </summary>
[GamePart(956)]
public partial class DevConsole : Node
{
    public static DevConsole? I { get; private set; }
    /// <summary>The console is up: its line has the keys (the menu leaves them to it).</summary>
    public static bool Open => I?.panel is { Visible: true };
    /// <summary>The last answers (the self-test reads them).</summary>
    public static string Last { get; private set; } = "";
    /// <summary>The last note the secret combo put on screen.</summary>
    public static string LastNote { get; private set; } = "";

    private PaperCard? panel;
    private LineEdit? line;
    private Label? log;
    private readonly List<string> lines = new();
    private bool fromPlay, busy;

    public DevConsole()
    {
        I = this;
        ProcessMode = ProcessModeEnum.Always;
    }

    public override void _ExitTree()
    {
        if (I == this) I = null;
    }

    public override void _Input(InputEvent e)
    {
        if (e is not InputEventKey { Pressed: true, Echo: false } k || Loading.Busy || MainMenu.I?.KeyGrab != null) return;
        // the secret combo: dev mode on or off, anywhere
        if (k.PhysicalKeycode == Key.D && k.CtrlPressed && k.AltPressed && k.ShiftPressed)
        {
            SetDevMode(!Prefs.DevMode);
            Note(Prefs.DevMode ? "Dev mode on: F8 the Dev sheet, F9 fly" : "Dev mode off");
            GetViewport().SetInputAsHandled();
            return;
        }
        if (k.PhysicalKeycode == Key.Quoteleft || (Open && k.Keycode == Key.Escape))
        {
            if (Open) Hide();
            else if (!Dialogs.Any()) Show();
            GetViewport().SetInputAsHandled();
        }
    }

    /// <summary>Dev mode on or off (the setting; a --dev run is overruled from here on). The menu's Dev line follows at once.</summary>
    public static void SetDevMode(bool on)
    {
        Prefs.SetDevMode(on);
        if (!on)
        {
            DevSheet.Close();
            if (Jef.I is { Fly: true }) DevTools.I?.ToggleFly();
        }
        MainMenu.I?.RefreshNav();
    }

    private static void Note(string text)
    {
        LastNote = text;
        if (MainMenu.I != null) MainMenu.I.Toast(text);
        else GameState.I?.Say(text);
        GD.Print("dev: " + text);
    }

    private void Build()
    {
        panel = new PaperCard(PaperCard.Kind.Plain) { Name = "dev_console", ZIndex = 30, ProcessMode = ProcessModeEnum.Always };
        panel.Pad(14, 8, 14, 10);
        var col = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        col.AddThemeConstantOverride("separation", UiKit.Px(6));
        log = UiKit.Text("", Fonts.Mono, 13, UiKit.InkSoft, true);
        col.AddChild(log);
        line = UiKit.Input("", 700, mono: true, placeholder: "help, dev on, hour 13 clear, go vismarkt, tide high, event musicians ...");
        line.Name = "console_line";
        line.KeepEditingOnTextSubmit = true; // Enter runs the line and the next can be typed at once
        line.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        line.TextSubmitted += text => _ = Submit(text);
        col.AddChild(line);
        panel.AddChild(col);
        Main.I.Ui.AddChild(panel);
    }

    private void Place()
    {
        if (panel == null) return;
        var win = GetViewport().GetVisibleRect().Size;
        float w = Math.Min(UiKit.Px(900), win.X * 0.96f);
        panel.CustomMinimumSize = new Vector2(w, 0);
        panel.ResetSize();
        panel.Position = new Vector2((win.X - w) / 2, UiKit.Px(14));
    }

    private void Show()
    {
        if (panel == null || !IsInstanceValid(panel)) Build();
        var menu = MainMenu.I;
        fromPlay = menu == null ? Input.MouseMode == Input.MouseModeEnum.Captured : menu.InPlay;
        if (lines.Count == 0) Say("Scheldemist console. Type help for the commands. Esc or the key left of 1 closes it.");
        else Show(lines);
        panel!.Visible = true;
        Place();
        if (fromPlay)
        {
            // the town pauses under it, as under the menu (and nobody walks while you type)
            Input.MouseMode = Input.MouseModeEnum.Visible;
            if (menu is { Entered: true }) Pause.Set("menu", true);
            if (menu == null && Jef.I != null) Jef.I.TestInput = true;
        }
        line!.Text = "";
        line.GrabFocus();
    }

    private void Hide()
    {
        if (panel == null) return;
        panel.Visible = false;
        line?.ReleaseFocus();
        if (!fromPlay) return;
        var m = MainMenu.I;
        if (m == null)
        {
            if (Jef.I != null) Jef.I.TestInput = false;
            if (Dialogs.Count == 0) Input.MouseMode = Input.MouseModeEnum.Captured;
        }
        else if (m.Entered && !m.Open && Dialogs.Count == 0 && !Pause.Has("key")) m.Start();
    }

    private async Task Submit(string text)
    {
        text = text.Trim();
        if (text == "" || busy || line == null) return;
        busy = true;
        line.Text = "";
        Say("> " + text);
        try
        {
            Say(await Run(text));
        }
        finally
        {
            busy = false;
            if (line != null && IsInstanceValid(line) && Open) line.GrabFocus();
        }
    }

    /// <summary>One line of commands: `help` and `dev` always; the rest in dev mode only.</summary>
    public static async Task<string> Run(string text)
    {
        string verb = text.Split(' ', 2)[0].Trim().ToLowerInvariant();
        if (verb == "help") return Kit.Help + "\npeople2 on|off: switch the people kit for later spawns (dev mode)";
        if (verb == "dev")
        {
            string arg = text.Length > 3 ? text[3..].Trim().ToLowerInvariant() : "";
            if (arg is "on" or "off") SetDevMode(arg == "on");
            else if (arg != "") return "dev on or dev off";
            return Prefs.DevMode ? "dev mode is on: F8 the Dev sheet (also in the menu), F9 fly over the town" : "dev mode is off";
        }
        if (!Prefs.DevMode) return "dev mode is off: type dev on first (or help)";
        if (verb == "people2")
        {
            string arg = text.Length > 7 ? text[7..].Trim().ToLowerInvariant() : "";
            if (arg is not ("on" or "off")) return "people2 on or people2 off (newly spawned people)";
            People.People2.Enabled = arg == "on";
            if (People.People2.Enabled) People.People2.Load();
            return "people2 " + arg + ": applies to people spawned afterwards";
        }
        if (Kit.I == null) return "the test kit is not in this run";
        return await Kit.I.Run(text);
    }

    private void Say(string text)
    {
        Last = text;
        foreach (string l in text.Split('\n')) lines.Add(l);
        while (lines.Count > 8) lines.RemoveAt(0);
        Show(lines);
    }

    private void Show(List<string> all)
    {
        if (log != null && IsInstanceValid(log)) log.Text = string.Join("\n", all);
        Place();
    }
}
