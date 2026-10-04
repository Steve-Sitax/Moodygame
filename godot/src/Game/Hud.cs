using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Net;

namespace Scheldemist.Game;

/// <summary>
/// The papers over the picture, as the browser lays them (client/src/style.css; game/day.ts the clock, game/jobs.ts
/// the money and the line in the middle, game/pockets.ts the needs and the pockets): the day and the clock with the
/// rent line top left, the money and the needs bottom left, six pockets bottom right, the line to read in the
/// middle. Paper and ink: every size is the browser's CSS pixel times its --ui (1.3, more on a wide window).
/// It reads GameState and listens to its events; the server's troubles (ServerLink) show in the middle.
/// </summary>
[GamePart(90)]
public partial class Hud : Node
{
    public static Hud? I { get; private set; }

    private const int Slots = 6;
    private const double ToastSeconds = 5.5;
    // the browser's colours through its sepia(0.3) filter
    private static readonly Color Paper = new("ebdbbb"); // #d8cfb8
    private static readonly Color Ink = NeedsCard.Ink; // #2a2420
    private static readonly Color Chalk = new("e6dcc2"); // the line in the middle
    private static readonly Color KeyInk = new("d8cfb8");
    private static readonly Color NotePaper = new("e9d8b4"); // #d4cab0 through sepia(0.35)

    private Control root = null!;
    private float s;
    private Label weekday = null!, time = null!, rent = null!, money = null!, toast = null!, status = null!, error = null!;
    private PanelContainer errorCard = null!, clockCard = null!, purse = null!, needsCard = null!, taskCard = null!, noteCard = null!;
    private VBoxContainer taskLines = null!;
    private Label noteWho = null!, noteText = null!;
    private Control pocketRow = null!;
    private string taskShown = "\0";
    private double noteLeft;
    private (string Who, string Text) noteNow = ("", "");

    /// <summary>One line of the task card: the job's name in bold, a step, or (Also) another job in hand, small.</summary>
    public sealed record TaskLine(string Text, bool Bold = false, bool Also = false);
    /// <summary>
    /// What the task card under the clock says (jobs.ts renderTask): set by the part that runs the jobs. Not set:
    /// the jobs in hand as the store knows them, the first in bold. No lines: no card.
    /// </summary>
    public Func<IReadOnlyList<TaskLine>>? Task { get; set; }
    private NeedsCard needs = null!;
    private readonly PocketIcon[] icons = new PocketIcon[Slots];
    private double toastLeft;
    private string toastText = "";
    private double sinceClock;

    public Hud()
    {
        I = this;
    }

    public override void _Ready()
    {
        Build();
        GetViewport().SizeChanged += OnResize;
        var st = GameState.I;
        st.Changed += OnState;
        st.MoneyChanged += OnMoney;
        st.Message += Say;
        // how a job went, in the employer's words (jobs.ts showOutcome)
        ServerLink.I?.WhenUp(() => ServerLink.I!.Api!.OutcomePushed += o => Outcome(o.Employer, o.Text));
        if (ServerLink.I is { } link)
        {
            link.StatusChanged += ShowLink;
            ShowLink();
        }
    }

    public override void _ExitTree()
    {
        var st = GameState.I;
        st.Changed -= OnState;
        st.MoneyChanged -= OnMoney;
        st.Message -= Say;
        if (ServerLink.I is { } link) link.StatusChanged -= ShowLink;
        if (I == this) I = null;
    }

    /// <summary>style.css --ui: everything on screen grows with the window.</summary>
    private static float UiScale(float width) => width >= 3000 ? 2.2f : width >= 2200 ? 1.8f : width >= 1600 ? 1.5f : 1.3f;

    private void OnResize()
    {
        var win = GetViewport().GetVisibleRect().Size;
        if (Math.Abs(UiScale(win.X) - s) > 0.01f) Build();
        else Place();
    }

    private int Px(float css) => Mathf.RoundToInt(css * s);

    // ------------------------------------------------------------------ building

    private void Build()
    {
        root?.QueueFree();
        var win = GetViewport().GetVisibleRect().Size;
        s = UiScale(win.X);
        root = new Control { Name = "Hud", MouseFilter = Control.MouseFilterEnum.Ignore };
        root.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(root);

        // .clock: top left (the column stands at 18, 14 whatever the scale)
        // (.top-left: the clock, then the task card under it, 10 apart)
        // (placed by hand: a container would take the cards' slight turn away)
        var column = root;
        var clock = Card(0.9f, 12, 3, -1f, 12, 3);
        clock.Position = new Vector2(18, 14);
        clockCard = clock;
        var col = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        col.AddThemeConstantOverride("separation", 0);
        var line = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        line.AddThemeConstantOverride("separation", 0);
        weekday = Text(Fonts.HandBold, 16, Ink);
        time = Text(Fonts.Hand, 16, Ink);
        line.AddChild(weekday);
        line.AddChild(time);
        rent = Text(Fonts.Hand, 13, new Color(Ink, 0.85f));
        col.AddChild(line);
        col.AddChild(rent);
        clock.AddChild(col);
        column.AddChild(clock);

        // .task: the job in hand, in print, at most 380 wide
        taskCard = Card(0.92f, 14, 8, 0.8f, 12, 3);
        taskLines = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        taskLines.AddThemeConstantOverride("separation", 0);
        taskCard.AddChild(taskLines);
        taskCard.Visible = false;
        column.AddChild(taskCard);
        taskShown = "\0";

        // .hud: the money, bottom left
        purse = Card(1f, 12, 4, -2f, 12, 3);
        BottomLeft(purse, 18, 16);
        money = Text(Fonts.Hand, 18, Ink);
        purse.AddChild(money);
        root.AddChild(purse);

        // .needs: beside it
        needsCard = Card(0.9f, 4, 2, 1.2f, 12, 3);
        BottomLeft(needsCard, 108, 14);
        needs = new NeedsCard { MouseFilter = Control.MouseFilterEnum.Ignore };
        needs.SetUi(s);
        needsCard.AddChild(needs);
        root.AddChild(needsCard);

        // .pockets: six slots bottom right, and the key that opens them
        var row = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        row.AddThemeConstantOverride("separation", Px(4));
        row.AnchorLeft = row.AnchorRight = 1;
        row.AnchorTop = row.AnchorBottom = 1;
        row.OffsetLeft = row.OffsetRight = -Px(14);
        row.OffsetTop = row.OffsetBottom = -Px(14);
        row.GrowHorizontal = Control.GrowDirection.Begin;
        row.GrowVertical = Control.GrowDirection.Begin;
        for (int i = 0; i < Slots; i++)
        {
            var slot = Card(0.9f, 3, 3, 0, 8, 2);
            icons[i] = new PocketIcon { MouseFilter = Control.MouseFilterEnum.Ignore };
            icons[i].SetUi(s);
            slot.AddChild(icons[i]);
            row.AddChild(slot);
        }
        var key = Text(Fonts.Hand, 14, new Color(KeyInk, 0.9f));
        key.Text = " I";
        key.SizeFlagsVertical = Control.SizeFlags.ShrinkEnd;
        key.LabelSettings.ShadowColor = new Color(0, 0, 0, 0.8f);
        key.LabelSettings.ShadowSize = Px(3);
        key.LabelSettings.ShadowOffset = Vector2.Zero;
        row.AddChild(key);
        root.AddChild(row);
        pocketRow = row;

        // .note: how a job went, bottom middle, in print
        noteCard = Card(1f, 18, 10, 0.6f, 24, 6);
        ((StyleBoxFlat)noteCard.GetThemeStylebox("panel")).BgColor = NotePaper;
        var noteCol = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        noteCol.AddThemeConstantOverride("separation", Px(2));
        noteWho = Text(Fonts.Print, 12, new Color(Ink, 0.7f));
        noteText = Text(Fonts.Print, 15, Ink);
        noteText.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        noteText.LabelSettings.LineSpacing = Px(15 * 0.4f) - 3;
        noteCol.AddChild(noteWho);
        noteCol.AddChild(noteText);
        noteCard.AddChild(noteCol);
        noteCard.Modulate = new Color(1, 1, 1, 0);
        root.AddChild(noteCard);
        noteWho.Text = noteNow.Who;
        noteText.Text = noteNow.Text;

        // .toast: the line in the middle; the same hand for what the link to the server is doing
        toast = Shadowed(18);
        toast.Modulate = new Color(1, 1, 1, 0);
        root.AddChild(toast);
        status = Shadowed(18);
        root.AddChild(status);

        // the server did not come up: a note on paper, in print
        errorCard = Card(1f, 18, 12, -0.6f, 24, 6);
        error = Text(Fonts.Print, 15, Ink);
        error.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        errorCard.AddChild(error);
        errorCard.Visible = false;
        root.AddChild(errorCard);

        Place();
        Refresh();
        ShowLink();
        toast.Text = toastText;
    }

    /// <summary>A piece of paper: the browser's background, padding (CSS px), a slight turn and a soft shadow under it.</summary>
    private PanelContainer Card(float alpha, float padX, float padY, float turnDeg, float shadow, float drop)
    {
        var box = new StyleBoxFlat
        {
            BgColor = new Color(Paper, alpha),
            ContentMarginLeft = Px(padX),
            ContentMarginRight = Px(padX),
            ContentMarginTop = Px(padY),
            ContentMarginBottom = Px(padY),
            ShadowColor = new Color(0, 0, 0, 0.45f),
            ShadowSize = Px(shadow * 0.6f),
            ShadowOffset = new Vector2(0, Px(drop)),
            // one pixel of rounding lets the edge be smoothed: a turned card has no stair steps
            AntiAliasing = true,
        };
        box.SetCornerRadiusAll(1);
        var card = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Ignore, RotationDegrees = turnDeg };
        card.AddThemeStyleboxOverride("panel", box);
        // turned about its middle, as CSS does
        card.Resized += () => card.PivotOffset = card.Size / 2;
        return card;
    }

    private void BottomLeft(Control c, float left, float bottom)
    {
        c.AnchorLeft = c.AnchorRight = 0;
        c.AnchorTop = c.AnchorBottom = 1;
        c.OffsetLeft = c.OffsetRight = Px(left);
        c.OffsetTop = c.OffsetBottom = -Px(bottom);
        c.GrowHorizontal = Control.GrowDirection.End;
        c.GrowVertical = Control.GrowDirection.Begin;
    }

    private Label Text(Font font, float size, Color colour) => new()
    {
        LabelSettings = new LabelSettings { Font = font, FontSize = Px(size), FontColor = colour },
        MouseFilter = Control.MouseFilterEnum.Ignore,
    };

    /// <summary>Light words over the picture with a dark glow round them (.toast).</summary>
    private Label Shadowed(float size)
    {
        var l = Text(Fonts.Hand, size, Chalk);
        l.LabelSettings.ShadowColor = new Color(0, 0, 0, 0.7f);
        l.LabelSettings.ShadowSize = Px(4);
        l.LabelSettings.ShadowOffset = Vector2.Zero;
        l.HorizontalAlignment = HorizontalAlignment.Center;
        l.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        return l;
    }

    /// <summary>What hangs on the window's size: the line in the middle, the server's note.</summary>
    private void Place()
    {
        var win = GetViewport().GetVisibleRect().Size;
        // .toast: left 50%, top 14%, at most 620 wide and never past the right edge
        float w = Math.Min(620 * s, win.X / 2);
        toast.Size = new Vector2(w, 0);
        toast.Position = new Vector2((win.X - w) / 2, win.Y * 0.14f);
        status.Size = new Vector2(w, 0);
        status.Position = new Vector2((win.X - w) / 2, win.Y * 0.46f);
        float ew = Math.Min(560 * s, win.X * 0.8f);
        // .note: bottom 9%, at most 560 wide (80% of the window)
        noteText.CustomMinimumSize = new Vector2(ew - Px(36), 0);
        noteCard.ResetSize();
        noteCard.Position = new Vector2((win.X - noteCard.Size.X) / 2, win.Y * 0.91f - noteCard.Size.Y);
        error.CustomMinimumSize = new Vector2(ew, 0);
        errorCard.ResetSize();
        errorCard.Position = new Vector2((win.X - errorCard.Size.X) / 2, (win.Y - errorCard.Size.Y) / 2);
    }

    // ------------------------------------------------------------------ showing

    private void OnState(JobsPayload p) => Refresh();
    private void OnMoney(int c) => money.Text = $"{c} c";

    /// <summary>jobs.ts showOutcome: the employer's name and his words on a note at the bottom, gone after 11 s.</summary>
    public void Outcome(string employer, string text)
    {
        noteNow = (employer, text);
        noteWho.Text = employer;
        noteText.Text = text;
        noteLeft = 11;
        Place();
    }

    private IReadOnlyList<TaskLine> TaskNow()
    {
        if (Task != null) return Task();
        var lines = new List<TaskLine>();
        foreach (var j in GameState.I.Jobs)
        {
            if (j.Status != "taken") continue;
            lines.Add(lines.Count == 0 ? new TaskLine(j.Title, Bold: true) : new TaskLine("and: " + j.Title, Also: true));
            if (lines.Count == 1) lines.Add(new TaskLine("for " + j.EmployerName));
        }
        return lines;
    }

    /// <summary>jobs.ts renderTask: the card under the clock; built again only when its words change.</summary>
    private void ShowTask()
    {
        var lines = TaskNow();
        string key = string.Join("\n", lines.Select(l => (l.Bold ? "b" : l.Also ? "a" : " ") + l.Text));
        if (key == taskShown) return;
        taskShown = key;
        foreach (var c in taskLines.GetChildren())
        {
            taskLines.RemoveChild(c);
            c.QueueFree();
        }
        taskCard.Visible = lines.Count > 0;
        float width = 380 * s - Px(28);
        foreach (var l in lines)
        {
            var label = Text(l.Bold ? Fonts.PrintBold : Fonts.Print, l.Also ? 12 : 15, new Color(Ink, l.Also ? 0.75f : 1));
            label.Text = l.Text;
            // as wide as its words, wrapped at the card's width
            if (label.LabelSettings.Font.GetStringSize(l.Text, HorizontalAlignment.Left, -1, label.LabelSettings.FontSize).X > width)
            {
                label.AutowrapMode = TextServer.AutowrapMode.WordSmart;
                label.CustomMinimumSize = new Vector2(width, 0);
            }
            taskLines.AddChild(label);
        }
        taskCard.ResetSize();
        PlaceTask();
    }

    private void PlaceTask()
    {
        clockCard.ResetSize();
        taskCard.Position = new Vector2(18, 14 + clockCard.Size.Y + 10);
    }

    private void Refresh()
    {
        var st = GameState.I;
        // nothing is known before the server's first word: no "0 c", no full needs
        clockCard.Visible = purse.Visible = needsCard.Visible = pocketRow.Visible = st.Live;
        ShowClock();
        ShowTask();
        money.Text = $"{st.Money} c";
        needs.SetNeeds(st.Food, st.Warmth, st.Sleep, st.Health);
        var pockets = st.Pockets;
        for (int i = 0; i < Slots; i++)
        {
            if (i < pockets.Count) icons[i].ShowKind(pockets[i].Kind, pockets[i].Name);
            else icons[i].ShowKind(null, "");
        }
    }

    /// <summary>day.ts renderClock: the server's time, run on between its ticks; the rent line until it is paid.</summary>
    private void ShowClock()
    {
        var st = GameState.I;
        if (!st.Live) return;
        var (h, m) = st.Shown;
        weekday.Text = st.Weekday;
        string t = $" {h}:{m:00}";
        if (time.Text != t) time.Text = t;
        rent.Visible = !st.RentPaid;
        if (!st.RentPaid) rent.Text = $"rent {st.RentPrice} c due by Sunday";
    }

    /// <summary>jobs.ts toastMsg: a line in the middle of the screen, gone again after a few seconds.</summary>
    public void Say(string text)
    {
        toastText = text;
        toast.Text = text;
        toastLeft = ToastSeconds;
    }

    private void ShowLink()
    {
        var link = ServerLink.I;
        status.Text = link?.Status ?? "";
        string why = link?.Error ?? "";
        error.Text = why;
        errorCard.Visible = why != "";
        if (why != "") Place();
    }

    public override void _Process(double delta)
    {
        using var frameCost = Dev.FrameCost.Track("HUD");
        // the clock in the corner runs on a minute every two real seconds
        sinceClock += delta;
        if (sinceClock >= 0.25)
        {
            sinceClock = 0;
            ShowClock();
            ShowTask();
            PlaceTask();
        }
        // .toast: opacity over 0.6 s
        toastLeft = Math.Max(0, toastLeft - delta);
        float want = toastLeft > 0 ? 1 : 0;
        float a = toast.Modulate.A;
        if (a != want) toast.Modulate = new Color(1, 1, 1, Mathf.MoveToward(a, want, (float)delta / 0.6f));
        // .note: opacity over 0.8 s
        noteLeft = Math.Max(0, noteLeft - delta);
        float nWant = noteLeft > 0 ? 1 : 0;
        float na = noteCard.Modulate.A;
        if (na != nWant) noteCard.Modulate = new Color(1, 1, 1, Mathf.MoveToward(na, nWant, (float)delta / 0.8f));
        if (errorCard.Visible) errorCard.Position = (GetViewport().GetVisibleRect().Size - errorCard.Size) / 2;
    }
}
