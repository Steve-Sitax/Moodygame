using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// Saving and loading (the browser's game/saves.ts; docs/milestones/M7-save-pause.md). On the handbill: Save (five
/// slots of your own, a name each; writing over one asks first), Load (the same list with the two autosaves;
/// loading asks first), and on the first page Continue (the newest save). Autosaves: every game hour while you
/// play (quietly: never while the town is talking), and on the way out (Quit to title, Leave the game).
/// The server writes the save; it waits for the model calls on their way first, and the game stands still meanwhile.
///
/// A load swaps the server's game for the save. The browser reloads its page then; here the store takes the new
/// state, the camera goes back to where Jef stood, and every part hears `MainMenu.I.WorldReplaced` to start again
/// from the server. What a save keeps of the game's own side is `Capture` (the walking part sets it: where Jef
/// stands, a boat, the jobs in hand); not set, the camera's place is kept.
/// </summary>
public partial class Saves : Node
{
    private readonly MainMenu menu;
    private List<SaveInfo> list = new();
    private string mode = "save";
    private string? armed;
    private double armLeft;
    private bool busy;
    private double ownLoadUntil;
    private string lastAuto = "";
    private double autoRetryIn = -1, sinceHourly;
    private Control? panel;
    private Control? card;
    private Label? note;
    private double noteLeft;
    private string panelMsg = "";
    private readonly Dictionary<string, string> typed = new();

    /// <summary>The game's own part of a save, now. Set by the walking part; not set: the camera's place.</summary>
    public Func<ClientState>? Capture { get; set; }
    /// <summary>The name of the place Jef is at, for the save list. Not set: the nearest of the bake's places.</summary>
    public Func<string>? PlaceName { get; set; }
    /// <summary>The saves on the server, newest first (as last asked).</summary>
    public IReadOnlyList<SaveInfo> List => list;
    public SaveInfo? Newest => list.Count > 0 ? list[0] : null;
    public bool PanelOpen => panel != null && Dialogs.IsOpen(panel);
    public bool Busy => busy;
    /// <summary>What the last save or load came to ("saved slot1", "not saved: ..."), for a test.</summary>
    public string Last { get; private set; } = "";

    public Saves(MainMenu menu)
    {
        this.menu = menu;
        Name = "Saves";
        ProcessMode = ProcessModeEnum.Always;
    }

    public static string When(SaveInfo s) => $"{s.Weekday} {s.Hour}:{s.Minute:00}, day {s.Day}";

    private static string Ago(string iso)
    {
        if (!DateTimeOffset.TryParse(iso, out var t)) return "";
        double s = Math.Max(0, (DateTimeOffset.UtcNow - t).TotalSeconds);
        if (s < 60) return "just now";
        if (s < 3600) return $"{Math.Round(s / 60)} min ago";
        if (s < 86400) return $"{Math.Round(s / 3600)} h ago";
        return t.LocalDateTime.ToShortDateString();
    }

    private static Api? Api => ServerLink.I?.Api;

    /// <summary>Ask the server for the list (the handbill's Continue follows).</summary>
    public void Refresh(Action? then = null)
    {
        if (Api is not { } api)
        {
            then?.Invoke();
            return;
        }
        api.Run(api.Saves(), r =>
        {
            list = r.Saves ?? new List<SaveInfo>();
            menu.RefreshNav();
            then?.Invoke();
        }, _ => then?.Invoke());
    }

    // ------------------------------------------------------------------ what the game adds to a save

    private ClientState CaptureNow()
    {
        if (Capture != null) return Capture();
        var st = GameState.I;
        var (h, m) = st.Shown;
        var cam = Main.I.Cam;
        var e = cam.GlobalBasis.GetEuler(EulerOrder.Yxz);
        var p = cam.GlobalPosition;
        return new ClientState(new ClientClock(st.Day, h, m), Place(), new ClientPose(Math.Round(p.X, 3), Math.Round(p.Z, 3), Math.Clamp(Math.Round(p.Y, 3), -30, 80), Math.Round(e.Y, 4), Math.Clamp(Math.Round(e.X, 4), -1.6, 1.6)));
    }

    /// <summary>main.ts placeName, as far as the bake knows the town: the nearest named place.</summary>
    private string Place()
    {
        if (PlaceName != null) return PlaceName();
        string best = "Antwerp";
        float bestD = float.MaxValue;
        var at = GameState.I.Pos;
        try
        {
            foreach (var p in Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray())
            {
                var pos = p.GetProperty("pos");
                float d = new Vector2(pos[0].GetSingle() - at.X, pos[2].GetSingle() - at.Z).Length();
                if (d >= bestD) continue;
                bestD = d;
                string n = p.GetProperty("place").GetString() ?? "Antwerp";
                best = char.ToUpperInvariant(n[0]) + n[1..];
            }
        }
        catch (Exception)
        {
            // a bake without places
        }
        return bestD < 120 ? best : $"near {best}";
    }

    // ------------------------------------------------------------------ the panel

    public void OpenPanel(string which)
    {
        mode = which;
        armed = null;
        panelMsg = "";
        typed.Clear();
        Refresh(() =>
        {
            Draw();
        });
    }

    public void ClosePanel()
    {
        if (panel != null) Dialogs.Close(panel);
        panel = null;
    }

    /// <summary>The papers were built again (the window's scale changed): the list too.</summary>
    public void Rebuilt()
    {
        if (PanelOpen) Draw();
    }

    private static readonly Color OldInk = new("2a2420");

    private void Draw()
    {
        if (panel != null) Dialogs.Close(panel);
        var root = new Control { Name = "Saves", MouseFilter = Control.MouseFilterEnum.Stop };
        root.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        var win = GetViewport().GetVisibleRect().Size;
        // .saves: width min(640px, 94vw), the paper's padding round it
        float w = Math.Min(Kit.Px(640), win.X * 0.94f - Kit.Px(88));
        var paper = new PaperCard(PaperCard.Kind.Plain) { Tilt = -0.6f };
        paper.Pad(44, 28, 44, 28);
        var col = new VBoxContainer { CustomMinimumSize = new Vector2(w, 0), MouseFilter = Control.MouseFilterEnum.Ignore };
        col.AddThemeConstantOverride("separation", 0);
        col.AddChild(Kit.Text(mode == "save" ? "Save the game" : "Load a game", Fonts.HandBold, 24, OldInk));
        col.AddChild(new Control { CustomMinimumSize = new Vector2(0, Kit.Px(10)) });

        var bySlot = list.ToDictionary(s => s.Slot);
        if (mode == "save")
        {
            for (int i = 1; i <= 5; i++)
            {
                string slot = $"slot{i}";
                bySlot.TryGetValue(slot, out var s);
                var name = Kit.Input(typed.GetValueOrDefault(slot, s?.Label ?? $"Slot {i}"), 120);
                name.MaxLength = 30;
                name.AddThemeStyleboxOverride("normal", Kit.Box(new Color("f3e9d2"), new Color("8a7d66"), 1, 0, 4, 1));
                name.AddThemeStyleboxOverride("focus", Kit.Box(new Color("f8f0dc"), new Color("5a4a3a"), 1.5f, 0, 4, 1));
                name.TextChanged += t => typed[slot] = t;
                name.TextSubmitted += t => Go(slot, t);
                var go = new InkButton(InkButton.Look.Plain, armed == slot ? "Write over it? Click again" : s != null ? "Save over" : "Save here", () => Go(slot, name.Text));
                col.AddChild(Slot(name, s, go));
            }
        }
        else
        {
            foreach (var s in list)
            {
                string slot = s.Slot;
                var name = Kit.Text(s.Label, Fonts.HandBold, 15, OldInk);
                name.CustomMinimumSize = new Vector2(Kit.Px(92), 0);
                var go = new InkButton(InkButton.Look.Plain, armed == slot ? "Lose what is not saved? Click again" : "Load", () => Go(slot, ""));
                col.AddChild(Slot(name, s, go));
            }
            if (list.Count == 0) col.AddChild(Slot(Kit.Text("No saved games yet.", Fonts.Print, 15, new Color(OldInk, 0.85f)), null, null, false));
        }
        col.AddChild(new Control { CustomMinimumSize = new Vector2(0, Kit.Px(10)) });
        if (panelMsg != "")
        {
            var msg = Kit.Text(panelMsg, Fonts.PrintBold, 16, OldInk, true);
            col.AddChild(msg);
            col.AddChild(new Control { CustomMinimumSize = new Vector2(0, Kit.Px(6)) });
        }
        var small = Kit.Text(mode == "save" ? "The game also saves itself every game hour, and when you leave it (the two autosaves take turns)." : "Loading puts you back where that save was: the time, the place, what you carry.", Fonts.Print, 13, new Color(OldInk, 0.8f), true);
        col.AddChild(small);
        col.AddChild(new Control { CustomMinimumSize = new Vector2(0, Kit.Px(14)) });
        var back = new InkButton(InkButton.Look.Plain, "Back", ClosePanel) { SizeFlagsHorizontal = Control.SizeFlags.ShrinkBegin };
        col.AddChild(back);
        paper.AddChild(col);
        root.AddChild(MainMenu.Centre(paper));
        panel = root;
        Dialogs.Open(root, () =>
        {
            if (panel == root) panel = null;
        });
        back.GrabFocus();
    }

    /// <summary>One line of the list: the name, when, where and how long ago, the button on the right.</summary>
    private Control Slot(Control name, SaveInfo? s, InkButton? go, bool emptyWord = true)
    {
        var row = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        row.AddThemeConstantOverride("separation", Kit.Px(8));
        name.SizeFlagsVertical = Control.SizeFlags.ShrinkCenter;
        row.AddChild(name);
        if (s != null)
        {
            row.AddChild(Kit.Text(When(s), Fonts.PrintBold, 15, OldInk));
            var what = Kit.Text($"{s.Place} · {s.MoneyC} c · saved {Ago(s.SavedAt)}", Fonts.Print, 15, new Color(OldInk, 0.85f));
            what.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
            what.ClipText = true;
            row.AddChild(what);
        }
        else
        {
            var what = Kit.Text(emptyWord ? "empty" : "", Fonts.Print, 15, new Color(OldInk, 0.85f));
            what.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
            row.AddChild(what);
        }
        if (go != null)
        {
            go.SizeFlagsVertical = Control.SizeFlags.ShrinkCenter;
            row.AddChild(go);
        }
        var box = new RowBox { Colour = new Color(0.165f, 0.141f, 0.125f, 0.35f), MouseFilter = Control.MouseFilterEnum.Ignore };
        box.AddThemeConstantOverride("margin_top", Kit.Px(6));
        box.AddThemeConstantOverride("margin_bottom", Kit.Px(6));
        box.AddChild(row);
        return box;
    }

    /// <summary>A slot's button: once to arm where something would be lost, twice to do it.</summary>
    private void Go(string slot, string name)
    {
        if (busy) return;
        bool taken = list.Any(s => s.Slot == slot);
        bool ask = mode == "load" || taken;
        if (ask && armed != slot)
        {
            armed = slot;
            armLeft = 5;
            Draw();
            return;
        }
        armed = null;
        if (mode == "save") Save(slot, name);
        else Load(slot);
    }

    // ------------------------------------------------------------------ saving and loading

    private static string WaitLine(int n) => n > 0 ? $"Waiting for {(n == 1 ? "someone in the town" : $"{n} people in the town")} to finish speaking." : "Writing it down.";

    private void ShowCard(string title, string sub)
    {
        HideCard();
        var c = new Control { Name = "SaveCard", MouseFilter = Control.MouseFilterEnum.Stop, MouseDefaultCursorShape = Control.CursorShape.Busy, ProcessMode = ProcessModeEnum.Always, ZIndex = 20 };
        c.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        var dim = new ColorRect { Color = new Color(0.031f, 0.035f, 0.039f, 0.5f), MouseFilter = Control.MouseFilterEnum.Ignore };
        dim.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        c.AddChild(dim);
        c.AddChild(MainMenu.Centre(MainMenu.PlainCard(title, sub)));
        Main.I.Ui.AddChild(c);
        card = c;
        CardText = $"{title} {sub}".Trim();
    }

    private void HideCard()
    {
        card?.QueueFree();
        card = null;
        CardText = "";
    }

    /// <summary>The words on the "Saving..." card now ("" when there is none).</summary>
    public string CardText { get; private set; } = "";

    /// <summary>Save into a slot: the game stands still meanwhile (the server waits for the model calls on their way).</summary>
    public void Save(string slot, string label = "", Action<string>? done = null)
    {
        if (busy || Api is not { } api)
        {
            done?.Invoke("busy");
            return;
        }
        busy = true;
        Pause.Set("saving", true);
        ShowCard("Saving...", "Writing it down.");
        void End(string outcome, string msg)
        {
            HideCard();
            Pause.Set("saving", false);
            busy = false;
            Last = outcome;
            if (PanelOpen)
            {
                panelMsg = msg;
                typed.Clear();
                Draw();
            }
            menu.RefreshNav();
            done?.Invoke(outcome);
        }
        api.Run(api.Save(slot, label, CaptureNow()), r =>
        {
            if (!r.Ok || r.Info == null)
            {
                End($"not saved: {r.Error ?? "not saved"}", $"Not saved: {r.Error ?? "not saved"}");
                return;
            }
            list = r.Saves ?? list;
            ShowCard("Saved", $"{r.Info.Label}: {When(r.Info)}, {r.Info.Place}.");
            var info = r.Info;
            GetTree().CreateTimer(0.9, true, false, true).Timeout += () => End($"saved {info.Slot} in {r.Ms} ms", $"Saved in {info.Label}.");
        }, e => End($"not saved: {e.Message}", $"Not saved: {e.Message}"));
    }

    /// <summary>The first page's Continue: the newest save.</summary>
    public void Continue()
    {
        if (Newest is { } s) Load(s.Slot);
    }

    /// <summary>Load a save: the server swaps its game for it, then the game starts again from it.</summary>
    public void Load(string slot, Action<string>? done = null)
    {
        if (busy || Api is not { } api)
        {
            done?.Invoke("busy");
            return;
        }
        busy = true;
        Pause.Set("loading", true);
        ShowCard("Loading...", "Back to where you were.");
        ownLoadUntil = Time.GetTicksMsec() / 1000.0 + 90;
        api.Run(api.Load(slot), r =>
        {
            if (!r.Ok)
            {
                Fail(r.Error ?? "not loaded");
                return;
            }
            AfterLoad(r.Client, () => done?.Invoke(Last = $"loaded {slot}"));
        }, e => Fail(e.Message));

        void Fail(string why)
        {
            ownLoadUntil = 0;
            HideCard();
            Pause.Set("loading", false);
            busy = false;
            Last = $"not loaded: {why}";
            if (PanelOpen)
            {
                panelMsg = $"Not loaded: {why}";
                Draw();
            }
            else GameState.I.Say($"Not loaded: {why}");
            done?.Invoke(Last);
        }
    }

    /// <summary>The server's game is the save now: the store takes it, Jef goes back, the first page says where.</summary>
    private void AfterLoad(JsonElement? client, Action? then)
    {
        ClientState? cs = null;
        try
        {
            if (client is { ValueKind: JsonValueKind.Object } c) cs = c.Deserialize<ClientState>(Net.Api.Json);
        }
        catch (JsonException)
        {
            // a save without a readable client part: the town comes back without Jef's place
        }
        void Finish()
        {
            ownLoadUntil = Time.GetTicksMsec() / 1000.0 + 3;
            if (cs != null) PutBack(cs);
            menu.Replaced("load", cs);
            HideCard();
            busy = false;
            lastAuto = "";
            string clock = cs?.Clock != null ? $": {cs.Clock.Hour}:{cs.Clock.Minute:00}" : "";
            string place = string.IsNullOrEmpty(cs?.Place) ? "" : $", {cs!.Place}";
            menu.ToTitle($"Loaded{clock}{place}. Click, or press {Keys.Label("forward")}, to go on.");
            Refresh();
            then?.Invoke();
        }
        if (Api is { } api) api.Run(api.Jobs(), p =>
        {
            GameState.I.Apply(p);
            Finish();
        }, _ => Finish());
        else Finish();
    }

    /// <summary>Where Jef stood. The walking part puts him back itself (WorldReplaced); the free camera is put back here.</summary>
    private static void PutBack(ClientState cs)
    {
        if (Main.I.Cam is not FlyCam fly) return;
        fly.GlobalPosition = new Vector3((float)cs.Pose.X, (float)cs.Pose.Y, (float)cs.Pose.Z);
        fly.Face(new Quaternion(Basis.FromEuler(new Vector3((float)cs.Pose.Pitch, (float)cs.Pose.Yaw, 0), EulerOrder.Yxz)));
    }

    /// <summary>The server's push: the gate while a save waits for the town; a save loaded by someone else.</summary>
    public void OnPush(PushMsg m)
    {
        if (m.Type == "gate" && card != null && Pause.Has("saving") && m.Body.TryGetProperty("mode", out var mode) && mode.GetString() == "saving")
        {
            int n = m.Body.TryGetProperty("in_flight", out var f) && f.ValueKind == JsonValueKind.Number ? f.GetInt32() : 0;
            ShowCard("Saving...", WaitLine(n));
        }
        if (m.Type == "loaded" && Time.GetTicksMsec() / 1000.0 > ownLoadUntil && !busy && Api is { } api)
        {
            // another player loaded a save on this server: this game starts again from it too
            busy = true;
            Pause.Set("loading", true);
            ShowCard("Loading...", "A saved game was loaded.");
            api.Run(api.GetClientState(), r => AfterLoad(r.Client, null), _ => AfterLoad(null, null));
        }
    }

    // ------------------------------------------------------------------ autosaves

    /// <summary>An autosave. `quiet`: while playing: only in a moment when no model call is on its way (the server says when).</summary>
    public void Autosave(bool quiet, Action<string>? done = null)
    {
        if (busy || !menu.Entered || Api is not { } api)
        {
            done?.Invoke("not now");
            return;
        }
        api.Run(api.Save("auto", null, CaptureNow(), quiet, 40_000), r =>
        {
            if (r.Deferred == true)
            {
                autoRetryIn = 30;
                done?.Invoke(Last = "put off: the town is busy talking");
                return;
            }
            if (!r.Ok || r.Info == null)
            {
                done?.Invoke(Last = "not saved");
                return;
            }
            autoRetryIn = -1;
            list = r.Saves ?? list;
            if (quiet) Flash("Game saved");
            done?.Invoke(Last = $"autosaved {r.Info.Slot}");
        }, e => done?.Invoke(Last = $"not saved: {e.Message}"));
    }

    /// <summary>The small word in the corner after an autosave.</summary>
    private void Flash(string text)
    {
        if (note == null || !IsInstanceValid(note))
        {
            note = Kit.Text("", Fonts.Hand, 15, new Color("e6dcc2"));
            note.LabelSettings.ShadowColor = new Color(0, 0, 0, 0.8f);
            note.LabelSettings.ShadowSize = Kit.Px(4);
            note.LabelSettings.ShadowOffset = Vector2.Zero;
            note.AnchorLeft = note.AnchorRight = 1;
            note.AnchorTop = note.AnchorBottom = 1;
            note.GrowHorizontal = Control.GrowDirection.Begin;
            note.GrowVertical = Control.GrowDirection.Begin;
            note.OffsetLeft = note.OffsetRight = -Kit.Px(18);
            note.OffsetTop = note.OffsetBottom = -Kit.Px(16) - Kit.Px(50);
            note.ProcessMode = ProcessModeEnum.Always;
            Main.I.Ui.AddChild(note);
        }
        note.Text = text;
        noteLeft = 2.2;
    }

    /// <summary>saves.ts hourly: an autosave every 1, 2 or 4 game hours while Jef plays (Settings, Game).</summary>
    private void Hourly()
    {
        if (!menu.InPlay || !GameState.I.Playing || GameState.I.Ending != null) return;
        int every = (int)Prefs.Num("autosave");
        if (every == 0) return;
        string key = $"{GameState.I.Day}:{GameState.I.Hour / every}";
        if (lastAuto == "")
        {
            lastAuto = key; // the hour we came in at: the next one saves
            return;
        }
        if (key != lastAuto || autoRetryIn == 0)
        {
            lastAuto = key;
            autoRetryIn = -1;
            Autosave(true);
        }
    }

    public override void _Process(double delta)
    {
        if (armed != null && (armLeft -= delta) <= 0)
        {
            armed = null;
            if (PanelOpen) Draw();
        }
        if (note != null && IsInstanceValid(note))
        {
            noteLeft = Math.Max(0, noteLeft - delta);
            float want = noteLeft > 0 ? 0.9f : 0;
            note.Modulate = new Color(1, 1, 1, Mathf.MoveToward(note.Modulate.A, want, (float)delta / 0.8f));
        }
        if (autoRetryIn > 0) autoRetryIn = Math.Max(0, autoRetryIn - delta);
        sinceHourly += delta;
        if (sinceHourly < 2) return;
        sinceHourly = 0;
        Hourly();
    }
}
