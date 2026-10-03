using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Ui.Dialogs;

namespace Scheldemist.Game;

/// <summary>
/// What the server's tick opens (game/day.ts): the night sheet when Jef dropped where he stood, the line at
/// midnight, the lines on waking, the end of the week or of Jef with its epilogue, and the rent. The papers are
/// the browser's ".night.paper", on the dialog stack: the keys are theirs, Jef stands still, the clock waits, and
/// the game behind is dimmed. Lying down to sleep by choice (the chooser, the fade) is the sleep part's: it sets
/// SleepShown and this part leaves the waking to it.
///
///   DaySheets.I.PayRent()      the week's rent, with the server's words in the middle of the screen
///   DaySheets.I.Shown          "none", "night" or "end"
///   BeforeNewWeek              the menus' part: "Your character" first, then call the action it gets
///   Restart                    what a new week or a new man does once the server has it (not set: the scene again)
/// </summary>
[GamePart(120)]
public partial class DaySheets : Node, IDialog
{
    public static DaySheets? I { get; private set; }

    /// <summary>What the sheet shows: nothing, a night, or the end.</summary>
    public string Shown { get; private set; } = "none";
    /// <summary>The sleep part is in and shows the waking itself (game/sleep.ts getUp): the lines are not said twice.</summary>
    public bool SleepShown { get; set; }
    /// <summary>M6 homes: after a night at home Jef wakes in his own room.</summary>
    public Action<string>? OnWakeHome { get; set; }
    /// <summary>M7 night: midnight while Jef is up (the night's other parts listen).</summary>
    public event Action<DayTurn>? Midnight;
    /// <summary>The menus' part: the character sheet before a new week; it calls the action when the player is done.</summary>
    public Action<Action>? BeforeNewWeek { get; set; }
    /// <summary>After the server has the new week (or the new man): the game starts again from it. Not set: the scene is loaded again.</summary>
    public Action? Restart { get; set; }
    /// <summary>The words on the paper now, for the checks.</summary>
    public IReadOnlyList<string> Lines => lines;

    private Sheet? sheet;
    private ColorRect? dim;
    private Night? night;
    private Ending? endShown;
    private bool endHadEpilogue;
    private bool busy;
    private readonly List<string> lines = new();

    public string DialogName => "day sheet";
    // Esc gets him up from a night; the end of the week is not closed by it (dialogs.ts: esc only for the night)
    public bool EscCloses => Shown == "night";

    public DaySheets()
    {
        I = this;
    }

    public override void _Ready()
    {
        var st = GameState.I;
        st.NightCame += ShowNight;
        st.DayTurned += OnMidnight;
        st.Woke += OnWoke;
        st.Changed += OnState;
        if (Dialogs.I != null) Dialogs.I.Resized += Render;
        // his own end comes as a push too (the epilogue once it is written)
        ServerLink.I?.WhenUp(() => ServerLink.I!.Api!.OtherPushed += OnPush);
    }

    public override void _ExitTree()
    {
        var st = GameState.I;
        st.NightCame -= ShowNight;
        st.DayTurned -= OnMidnight;
        st.Woke -= OnWoke;
        st.Changed -= OnState;
        if (Dialogs.I != null) Dialogs.I.Resized -= Render;
        if (ServerLink.I?.Api is { } api) api.OtherPushed -= OnPush;
        Drop();
        if (I == this) I = null;
    }

    // ------------------------------------------------------------------ what the server says

    private void OnState(JobsPayload p)
    {
        // the end of the week (or of Jef) is in the state; a night sheet up is read first
        if (p.Ending != null && Shown != "night") ShowEnd(p.Ending);
        else if (p.Ending == null && Shown == "end") Close();
    }

    private void OnPush(PushMsg m)
    {
        if (m.Type != "ending") return;
        // the epilogue is written: the state has it
        if (ServerLink.I?.Api is { } api) api.Run(api.Jobs(), GameState.I.Apply);
    }

    /// <summary>day.ts midnight: the date turns while Jef is up: a line, no sheet.</summary>
    private void OnMidnight(DayTurn t)
    {
        var parts = new List<string> { $"Midnight. {(GameState.I.Live ? GameState.I.Weekday : "A new day")} begins. New work goes up on the board." };
        parts.AddRange(t.Lines);
        GameState.I.Say(string.Join(" ", parts));
        Midnight?.Invoke(t);
    }

    /// <summary>A sleep ended on a tick (sleep.ts getUp): its lines in the middle of the screen, or the end.</summary>
    private void OnWoke(RestEnd w)
    {
        if (SleepShown) return;
        if (w.Ended != null) ShowEnd(GameState.I.Ending ?? w.Ended);
        else if (w.Place != "cell" && w.Lines.Count > 0) GameState.I.Say(string.Join(" ", w.Lines));
    }

    // ------------------------------------------------------------------ the rent

    /// <summary>day.ts rent: pay the week's bed; the server's words either way.</summary>
    public void PayRent()
    {
        if (ServerLink.I?.Api is not { } api) return;
        api.Run(api.Rent(), r =>
        {
            GameState.I.Apply(r);
            GameState.I.Say(r.Text);
        }, e => GameState.I.Say(e.Message));
    }

    // ------------------------------------------------------------------ the sheets

    private void Open(string kind)
    {
        Shown = kind;
        GameState.I.Hold = true;
        Dialogs.I?.Open(this);
    }

    private void Close()
    {
        Shown = "none";
        night = null;
        endShown = null;
        GameState.I.Hold = false;
        Dialogs.I?.Close(this);
        Drop();
    }

    private void Drop()
    {
        sheet?.Card.QueueFree();
        sheet = null;
        dim?.QueueFree();
        dim = null;
    }

    private void ShowNight(Night n)
    {
        night = n;
        Open("night");
        Render();
    }

    private void ShowEnd(Ending e)
    {
        bool has = e.Epilogue != null;
        if (Shown == "end" && endShown != null && endHadEpilogue == has) return;
        endShown = e;
        endHadEpilogue = has;
        Open("end");
        Render();
    }

    /// <summary>The words under the end sheet (day.ts endKeys).</summary>
    private static string EndKeys(Ending e)
    {
        var link = ServerLink.I;
        if (link is not { Together: true }) return "N  start a new week";
        if (e.Kind == "health") return "N  a new man on the ferry";
        return link.Api is { Guest: true } ? "The host starts the next week." : "N  start a new week";
    }

    private void Render()
    {
        if (Shown == "none" || Dialogs.I is not { } dialogs) return;
        Drop();
        lines.Clear();
        var win = GetViewport().GetVisibleRect().Size;
        float s = dialogs.Ui;
        // body:has(.night) #game { filter: brightness(0.35) }: the game behind is dimmed, the papers are not
        dim = new ColorRect { Color = new Color(0, 0, 0, 0.65f), MouseFilter = Control.MouseFilterEnum.Ignore };
        dim.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(dim);
        Main.I.Ui.MoveChild(dim, 0);
        // .night.paper: in the middle, width min(520px, 86vw) (the end: 620, 90vw), padding 28 44, turned -0.8
        bool end = Shown == "end";
        float w = Math.Min((end ? 620 : 520) * s, win.X * (end ? 0.9f : 0.86f)) + 88 * s;
        var sh = new Sheet(s, w, Css.Hex("d8cfb8"), (44, 28, 44, 28), -0.8f, sepia: 0.3f, contrast: 0.95f, shadow: 30, drop: 6, shadowAlpha: 0.7f, maxHeight: win.Y * 0.92f)
        {
            Where = (v, size) => (v - size) / 2,
        };
        sheet = sh;
        void Title(string t)
        {
            lines.Add(t);
            sh.Text($"[b]{Css.Esc(t)}[/b]", Face.Hand, 26, bottom: 4);
        }
        void Para(string t, float opacity = 1, bool italic = false)
        {
            lines.Add(t);
            sh.Text(italic ? $"[i]{Css.Esc(t)}[/i]" : Css.Esc(t), Face.Print, 16, opacity, lineHeight: 1.45f, bottom: 8);
        }
        if (!end && night is { } n)
        {
            string where = n.Where == "home" ? $"Your own room: {n.Place ?? "home"}" : n.Where == "bed" ? "The doss house, Sint-Andries" : n.Collapsed == true ? "Where you dropped, on the stones" : "Rough, under a tarpaulin";
            Title(n.Collapsed == true ? "Dropped asleep" : "Asleep");
            lines.Add(where);
            sh.Text(Css.Esc(where), Face.Hand, 13, 0.7f, bottom: 12);
            foreach (string l in n.Summary) Para(l);
            sh.Keys(n.Ended != null ? "E or Esc  go on" : "E or Esc  get up", Face.Print, top: 12, bottom: 0);
        }
        else if (endShown is { } e)
        {
            if (e.Epilogue is { } ep)
            {
                Title(ep.Title);
                foreach (string p in ep.Paragraphs) Para(p);
                sh.Keys(EndKeys(e), Face.Print, top: 12, bottom: 0);
            }
            else
            {
                string name = GameState.I.PlayerName;
                Title(e.Kind == "health" ? $"The end of {name}" : "Sunday night");
                Para("Somebody is writing down what became of him …", 0.7f, true);
                sh.Keys("", Face.Print, top: 12, bottom: 0);
            }
        }
        dialogs.Layer.AddChild(sh.Card);
        sh.Place();
    }

    // ------------------------------------------------------------------ the keys

    public void OnKey(string code, string key)
    {
        if (Shown == "night" && code is "KeyE" or "Enter" or "Escape") GetUp();
        else if (Shown == "end" && code == "KeyN" && GameState.I.Ending?.Epilogue != null && !busy)
        {
            var link = ServerLink.I;
            bool together = link is { Together: true };
            if (together && GameState.I.Ending.Kind == "health") NewMan();
            else if (!together || link?.Api is not { Guest: true }) NewWeek();
        }
    }

    /// <summary>day.ts wake: up from the night sheet; where he wakes, and a line about the morning.</summary>
    private void GetUp()
    {
        var n = night;
        if (n?.Ended != null)
        {
            // the week is over: the epilogue sheet, or wait for it
            night = null;
            ShowEnd(GameState.I.Ending ?? n.Ended);
            return;
        }
        Close();
        // from the doss house you step out of the alley gate, facing the river; rough, he gets up where he lay
        if (n?.Where == "bed" && Jef.I != null && TownMap.I?.Find("doss house") is { } doss) Jef.I.Place(doss.X, doss.Z - 0.4f, 0);
        if (n?.Where == "home" && n.Home != null) OnWakeHome?.Invoke(n.Home);
        var st = GameState.I;
        string sky = st.Weather switch
        {
            "mist" => "A thin mist lies on the river.",
            "clear" => "The air is clear and cold. You can see the far bank.",
            "rain" => "Rain is coming in off the Schelde.",
            "storm" => "A gale off the sea. The river runs high and grey. Keep off the quay edge.",
            _ => "The fog is thick on the Schelde.",
        };
        bool dark = st.Hour < 6 || st.Hour >= 20;
        string day = st.Live ? $"{st.Weekday} {st.Hour}:{st.Minute:00}" : "A new day";
        st.Say($"{day}. {(dark ? "Still dark." : sky)}{(n?.Turned == true ? " New work is on the board." : "")}");
    }

    /// <summary>day.ts newWeek: "Your character" first (the menus' part), the new week once the server has it, then the game again from it.</summary>
    private void NewWeek()
    {
        void Start()
        {
            if (ServerLink.I?.Api is not { } api || busy) return;
            busy = true;
            api.Run(api.NewGame(), _ => Again(), e =>
            {
                busy = false;
                GameState.I.Say(e.Message);
            });
        }
        if (BeforeNewWeek != null) BeforeNewWeek(Start);
        else Start();
    }

    /// <summary>M8d played together: after his own end a player starts a new man, who comes by the ferry while the world goes on.</summary>
    private void NewMan()
    {
        if (ServerLink.I?.Api is not { } api) return;
        busy = true;
        api.Run(api.Post<JsonElement>("api/player/new-man", null, 15_000), _ => Again(), e =>
        {
            busy = false;
            GameState.I.Say(e.Message);
        });
    }

    /// <summary>The browser loads its page again; here the scene (the game's own server stops and starts with it), unless a part knows a lighter way.</summary>
    private void Again()
    {
        busy = false;
        if (Restart != null)
        {
            Close();
            Restart();
            return;
        }
        GetTree().CallDeferred(SceneTree.MethodName.ReloadCurrentScene);
    }
}
