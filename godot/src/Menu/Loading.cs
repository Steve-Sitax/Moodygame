using System;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// The loading screen (the browser's index.html #boot and boot/loader.ts): the etching of the quay, the title, and
/// a card that says what the game is doing and how far it is, with a tip under it. Main shows it before the town is
/// read; it follows the real work:
///   1. Loading the town: the baked town read from the disk (BakedWorld.Stage).
///   2. Building the streets: the scene made from it.
///   3. Unpacking the pictures: every mesh given its material, counted.
///   4. Loading the people: the game's server answers and sends the first state.
///   5. Preparing the shaders: the town drawn behind the screen until the frames run even.
/// Then it fades into the menu. Keys and clicks wait until then (`Loading.Busy`).
/// Sizes follow the window's height, as the browser's (vh), not the papers' scale.
/// </summary>
public partial class Loading : Control
{
    public static Loading? I { get; private set; }
    /// <summary>Loading, until the screen has faded: the menu takes no key and no click.</summary>
    public static bool Busy => I != null;
    /// <summary>What the card says now ("Loading the town (120 of 300)"), for a test.</summary>
    public string StepNow { get; private set; } = "";
    public float Shown => shown;
    /// <summary>The screen is gone: the menu is up.</summary>
    public static event Action? Done;

    // index.html: the tips, changed every few seconds
    private static readonly string[] Tips =
    {
        "The hiring board on the Rijnkaai has the day's work. Walk up to it and press [b]E[/b].",
        "Anyone in the street will talk to you. Walk up to them and press [b]E[/b].",
        "[b]M[/b] shows the map, [b]I[/b] your pockets, [b]P[/b] pauses the town.",
        "The Schelde is ice cold. If you fall in, find a ladder or a flight of steps.",
        "After dark the streets are not safe. Carry a lantern and keep to the lamps.",
        "A bed in the doss house is cheap. You can go to bed there from six in the evening.",
        "Too far from a bed? From ten at night you can lie down and sleep rough, at your own risk.",
        "A warm room takes the cold off you. The taverns keep a fire.",
        "The horse omnibus goes round the quays. Wait at a stop and press [b]E[/b] to get on.",
        "Rowing boats can be hired at the river steps.",
        "Short of money? The Berg van Barmhartigheid lends against what you own.",
        "The ballad singer sells his sheets at the market corners.",
        "The newsboys call the morning paper. The news moves prices on the quays.",
        "[b]Shift[/b] to hurry. [b]Esc[/b] opens the menu, where you can save.",
    };

    private readonly Main main;
    private Texture2D? pic;
    private TextureRect veilRound = null!, veilLeft = null!;
    private Label kicker = null!, title = null!, sub = null!, count = null!, pct = null!, save = null!, nowLine = null!, later = null!;
    private CapsLine what = null!;
    private Ornament rule = null!;
    private PaperCard card = null!;
    private VBoxContainer col = null!;
    private Bar bar = null!;
    private RichTextLabel tip = null!;
    private float shown = 0.02f;
    private double age, tipAge, readyAt = -1, fade = -1, serverFrom = -1, drawFrom = -1, lastLoadMs = 5000;
    private int tipAt, evenFrames;
    private double buildFrom = -1;
    private bool askedSaves;

    public static Loading Show(Main main)
    {
        var l = new Loading(main);
        main.Ui.AddChild(l);
        return l;
    }

    private Loading(Main main)
    {
        this.main = main;
        I = this;
        Name = "Loading";
        ProcessMode = ProcessModeEnum.Always;
        MouseFilter = MouseFilterEnum.Stop;
        MouseDefaultCursorShape = CursorShape.Busy;
        SetAnchorsPreset(LayoutPreset.FullRect);
        ZIndex = 50;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(LastFile));
            lastLoadMs = Math.Clamp(doc.RootElement.GetProperty("ms").GetDouble(), 500, 120_000);
        }
        catch (Exception)
        {
            // the first start: a guess
        }
    }

    private static string LastFile => Path.Combine(Path.GetDirectoryName(Prefs.File) ?? ".", "boot.json");

    public override void _Ready()
    {
        pic = Kit.Picture(Paths.LoadingPicture);
        Build();
        GetViewport().SizeChanged += Build;
        tipAt = (int)(GD.Randi() % (uint)Tips.Length);
        ShowTip();
        ShowStep("Building the streets", "", 0.05f, "The game lays out the quays, the houses and the river.");
    }

    public override void _ExitTree()
    {
        GetViewport().SizeChanged -= Build;
        if (I == this) I = null;
    }

    private static float Clamp(float lo, float v, float hi) => Math.Clamp(v, lo, hi);

    private void Build()
    {
        foreach (var c in GetChildren()) c.QueueFree();
        var win = GetViewport().GetVisibleRect().Size;
        float vw = win.X / 100, vh = win.Y / 100;
        var ink = new Color("221b15");
        var soft = new Color("54463a");

        // the veil: the edges burnt like an old print, the fog on the left a little lighter (the words sit in it)
        var round = new Gradient { Offsets = new[] { 0f, 0.55f, 1f }, Colors = new[] { new Color(0.086f, 0.059f, 0.031f, 0), new Color(0.086f, 0.059f, 0.031f, 0), new Color(0.086f, 0.059f, 0.031f, 0.55f) } };
        veilRound = new TextureRect { Texture = new GradientTexture2D { Gradient = round, Fill = GradientTexture2D.FillEnum.Radial, FillFrom = new Vector2(0.58f, 0.46f), FillTo = new Vector2(0.58f + 0.85f, 0.46f), Width = 256, Height = 256 }, ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.Scale, MouseFilter = MouseFilterEnum.Ignore };
        veilRound.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(veilRound);
        var left = new Gradient { Offsets = new[] { 0f, 0.3f, 0.52f }, Colors = new[] { new Color(0.91f, 0.87f, 0.78f, 0.5f), new Color(0.91f, 0.87f, 0.78f, 0.28f), new Color(0.91f, 0.87f, 0.78f, 0) } };
        veilLeft = new TextureRect { Texture = new GradientTexture2D { Gradient = left, FillFrom = new Vector2(0, 0), FillTo = new Vector2(1, 0), Width = 256, Height = 4 }, ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.Scale, MouseFilter = MouseFilterEnum.Ignore };
        veilLeft.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(veilLeft);

        // the title, top left
        float x = 6.5f * vw, y = 9 * vh;
        int ks = (int)Clamp(11, 1.6f * vh, 18);
        kicker = Words("ANTWERP · AUTUMN 1873", new FontVariation { BaseFont = Fonts.Print, SpacingGlyph = Mathf.RoundToInt(ks * 0.34f) }, ks, soft);
        kicker.Position = new Vector2(x, y);
        AddChild(kicker);
        y += Fonts.Print.GetHeight(ks) * 1.0f + ks * 0.3f;
        int hs = (int)Clamp(40, 10.5f * vh, 124);
        title = Words("SCHELDEMIST", new FontVariation { BaseFont = Fonts.Slab, SpacingGlyph = Mathf.RoundToInt(hs * 0.06f) }, hs, ink);
        title.LabelSettings.ShadowColor = new Color(0.925f, 0.89f, 0.81f, 0.5f);
        title.LabelSettings.ShadowSize = Math.Max(2, hs / 8);
        title.LabelSettings.ShadowOffset = Vector2.Zero;
        // the slab's own line is taller than the CSS line-height 0.95: set by its top
        title.Position = new Vector2(x, y - (Fonts.Slab.GetHeight(hs) - hs * 0.95f) / 2);
        AddChild(title);
        y += hs * 0.95f + 1.1f * vh;
        rule = new Ornament { Plain = true, Colour = new Color(ink, 0.7f), Position = new Vector2(x, y), Size = new Vector2(Math.Min(34 * vw, 470), 12), MouseFilter = MouseFilterEnum.Ignore };
        AddChild(rule);
        y += 12 + 0.9f * vh;
        int ss = (int)Clamp(14, 2.3f * vh, 26);
        sub = Words("The river, the fog, and a town that has work for those who ask.", Fonts.PrintItalic, ss, soft);
        sub.Position = new Vector2(x, y);
        AddChild(sub);

        // the card, bottom left
        float cw = Math.Max(Math.Min(560, 46 * vw), Math.Min(340, 88 * vw));
        card = new PaperCard(PaperCard.Kind.Boot) { MouseFilter = MouseFilterEnum.Ignore };
        card.RotationDegrees = -0.7f;
        col = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        col.AddThemeConstantOverride("separation", 0);
        int st = (int)Clamp(15, 2.3f * vh, 22);
        var step = new HBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        step.AddThemeConstantOverride("separation", 10);
        what = new CapsLine { Font = Fonts.Print, FontSize = st, Colour = ink, SpacingEm = 0.04f, SizeFlagsHorizontal = SizeFlags.ExpandFill, SizeFlagsVertical = SizeFlags.ShrinkEnd };
        count = Words("", Fonts.PrintItalic, Mathf.RoundToInt(st * 0.8f), soft);
        count.SizeFlagsVertical = SizeFlags.ShrinkEnd;
        pct = Words("1%", Fonts.Print, Mathf.RoundToInt(st * 0.85f), soft);
        pct.SizeFlagsVertical = SizeFlags.ShrinkEnd;
        step.AddChild(what);
        step.AddChild(count);
        step.AddChild(pct);
        col.AddChild(step);
        col.AddChild(Gap(6));
        bar = new Bar { CustomMinimumSize = new Vector2(0, 13 + 4 + 3), Ink = ink };
        col.AddChild(bar);
        save = Words("", Fonts.Print, (int)Clamp(13, 1.9f * vh, 17), ink);
        save.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        save.Visible = false;
        col.AddChild(Margin(save, 8));
        nowLine = Words("", Fonts.PrintItalic, (int)Clamp(12, 1.75f * vh, 16), soft);
        nowLine.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        col.AddChild(Margin(nowLine, 8));
        col.AddChild(Gap(9));
        col.AddChild(new Line { Dashed = true, Colour = new Color(ink, 0.3f), CustomMinimumSize = new Vector2(0, 1) });
        int ts = (int)Clamp(13, 2 * vh, 19);
        tip = new RichTextLabel { BbcodeEnabled = true, FitContent = true, ScrollActive = false, MouseFilter = MouseFilterEnum.Ignore, CustomMinimumSize = new Vector2(0, ts * 1.3f * 2.6f / 1.3f + 7) };
        tip.AddThemeFontOverride("normal_font", Fonts.Hand);
        tip.AddThemeFontOverride("bold_font", Fonts.HandBold);
        tip.AddThemeFontSizeOverride("normal_font_size", ts);
        tip.AddThemeFontSizeOverride("bold_font_size", ts);
        tip.AddThemeColorOverride("default_color", ink);
        tip.AddThemeConstantOverride("line_separation", -Mathf.RoundToInt(ts * 0.28f));
        col.AddChild(Margin(tip, 7));
        card.AddChild(col);
        // padding 16px 24px 14px (real px here: the card does not follow the papers' scale)
        float s = Kit.Scale;
        card.Pad(24 / s, 16 / s, 24 / s, 14 / s);
        card.CustomMinimumSize = new Vector2(cw, 0);
        AddChild(card);

        later = Words("The first start takes longest. Later starts are quicker.", Fonts.PrintItalic, 13, new Color(0.94f, 0.91f, 0.83f, 0.85f));
        later.LabelSettings.ShadowColor = new Color("120d08");
        later.LabelSettings.ShadowSize = 4;
        later.LabelSettings.ShadowOffset = new Vector2(0, 1);
        AddChild(later);

        ShowTip(false);
        ShowStep(stepWhat, stepCount, null, stepNow);
        Place();
    }

    private static Label Words(string text, Font font, int size, Color colour) => new()
    {
        Text = text,
        LabelSettings = new LabelSettings { Font = font, FontSize = size, FontColor = colour },
        MouseFilter = MouseFilterEnum.Ignore,
    };

    private static Control Gap(float px) => new() { CustomMinimumSize = new Vector2(0, px), MouseFilter = MouseFilterEnum.Ignore };
    private static Control Margin(Control c, int top)
    {
        var m = new MarginContainer { MouseFilter = MouseFilterEnum.Ignore };
        m.AddThemeConstantOverride("margin_top", top);
        m.AddChild(c);
        return m;
    }

    private void Place()
    {
        var win = GetViewport().GetVisibleRect().Size;
        float vw = win.X / 100, vh = win.Y / 100;
        card.ResetSize();
        var size = card.GetCombinedMinimumSize();
        card.Size = size;
        card.Position = new Vector2(6.5f * vw, win.Y - 7.5f * vh - size.Y);
        later.ResetSize();
        later.Position = new Vector2(win.X - 2.2f * vw - later.GetCombinedMinimumSize().X, win.Y - 2 * vh - later.GetCombinedMinimumSize().Y);
    }

    public override void _Draw()
    {
        var win = Size;
        // the fog's own tone under the picture
        DrawRect(new Rect2(Vector2.Zero, win), new Color("cfc3a8"));
        if (pic == null) return;
        // cover the window (and 2% more each way), the picture's point at 72% 42% kept; a slow drift over 90 s
        float t = (float)Math.Min(1, age / 90);
        float ease = 1 - (1 - t) * (1 - t);
        float zoom = 1.04f * (1 + 0.07f * ease);
        var ps = pic.GetSize();
        float k = Math.Max(win.X / ps.X, win.Y / ps.Y) * zoom;
        var dst = ps * k;
        var at = new Vector2((win.X - dst.X) * 0.72f, (win.Y - dst.Y) * 0.42f) - new Vector2(win.X * 0.012f * ease, 0);
        float a = (float)Math.Min(1, age / 1.4);
        DrawTextureRect(pic, new Rect2(at, dst), false, new Color(0.97f, 0.955f, 0.93f, a));
    }

    // ------------------------------------------------------------------ the card's words

    private string stepWhat = "", stepCount = "", stepNow = "";

    /// <summary>loader.ts show(): the step, its count, how far (the bar never goes back), the line under it.</summary>
    private void ShowStep(string step, string cnt, float? progress, string now)
    {
        if (step != stepWhat) stepAge = 0;
        stepWhat = step;
        stepCount = cnt;
        stepNow = now;
        if (what == null) return;
        what.Text = step;
        count.Text = cnt;
        if (progress is { } p) shown = Math.Max(shown, Math.Min(1, p));
        bar.Fill = Math.Max(0.02f, shown);
        pct.Text = $"{Mathf.RoundToInt(shown * 100)}%";
        if (nowLine.Text != now)
        {
            nowLine.Text = now;
            Callable.From(Place).CallDeferred();
        }
        StepNow = $"{step} {cnt}".Trim();
    }

    private void ShowTip(bool next = true)
    {
        if (tip == null) return;
        if (next) tipAt++;
        tip.Text = "Tip: " + Tips[tipAt % Tips.Length];
        Callable.From(Place).CallDeferred();
    }

    private readonly System.Collections.Generic.List<string> testShots = new();
    private double stepAge;
    /// <summary>The menus' test (--menutest dir): the step the loading screen showed when its picture was taken.</summary>
    public static string TestShotStep { get; private set; } = "";

    public override void _Process(double delta)
    {
        age += delta;
        stepAge += delta;
        QueueRedraw();
        if (age > 1.6 && StepNow != "" && fade < 0 && main.Arg("menutest") is { Length: > 0 } dir)
        {
            // a picture early in the load, and one of each later step
            string step = stepWhat;
            if (TestShotStep == "")
            {
                TestShotStep = StepNow;
                Directory.CreateDirectory(dir);
                testShots.Add(step);
                GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, "01-loading.png"));
            }
            else if (!testShots.Contains(step) && stepAge > 0.12)
            {
                testShots.Add(step);
                GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, $"01-loading-{testShots.Count}.png"));
            }
        }
        // the tips: a new one every 7.5 s, faded out and in
        tipAge += delta;
        if (tipAge > 7.5)
        {
            tipAge = 0;
            ShowTip();
        }
        tip.Modulate = new Color(1, 1, 1, (float)Math.Clamp(Math.Min(tipAge / 0.45, (7.5 - tipAge) / 0.45), 0, 1));

        if (fade >= 0)
        {
            // index.html: opacity over 1.1 s, ease-in; the menu comes up under it
            fade += delta;
            float t = (float)Math.Min(1, fade / (Kit.Calm ? 0.2 : 1.1));
            Modulate = new Color(1, 1, 1, 1 - t * t);
            if (t < 1) return;
            I = null;
            QueueFree();
            Done?.Invoke();
            return;
        }
        Follow(delta);
    }

    private void Follow(double delta)
    {
        var world = main.World;
        string stage = world?.Stage ?? "";
        if (!main.Loaded)
        {
            double ms = age * 1000;
            if (stage is "" or "read" or "parse")
            {
                // the glb's own reading has no count: the bar creeps towards its share by the last start's time
                float k = (float)(1 - Math.Exp(-ms / (lastLoadMs * 0.5)));
                ShowStep("Loading the town", "", 0.08f + 0.36f * k, "Reading the houses, the boats, the quays and the people from the disk.");
            }
            else if (stage == "build")
            {
                // no count either: a slow creep by the clock, never by the frames
                if (buildFrom < 0) buildFrom = age;
                ShowStep("Building the streets", "", 0.44f + 0.06f * (float)(1 - Math.Exp(-(age - buildFrom) / 2)), "The game lays out the quays, the houses and the river.");
            }
            else if (stage is "materials" or "done")
            {
                int n = world!.StageDone, of = world.StageTotal;
                ShowStep("Unpacking the pictures", of > 0 ? $"({n} of {of})" : "", 0.5f + (of > 0 ? 0.1f * n / of : 0), "Every wall, roof and sign painted onto the graphics card.");
            }
            return;
        }
        // 4: the server and the first state (a server that did not come up says so on the paper under this screen)
        var link = ServerLink.I;
        if (serverFrom < 0)
        {
            serverFrom = age;
            try
            {
                File.WriteAllText(LastFile, JsonSerializer.Serialize(new { ms = Math.Round(age * 1000) }));
            }
            catch (Exception)
            {
                // no folder to write: the next start guesses again
            }
        }
        if (link is { Up: true } && !askedSaves)
        {
            askedSaves = true;
            ShowSave(link.Api!);
        }
        bool serverDone = link == null || link.Error != "" || GameState.I.Live || age - serverFrom > 100;
        if (!serverDone)
        {
            float creep = 0.6f + 0.2f * (float)(1 - Math.Exp(-(age - serverFrom) / 5));
            if (link!.Up) ShowStep("Loading the people", "", creep, "The townsfolk wake: homes, trades and the day ahead.");
            else ShowStep("Starting the game server", "", creep, "The town's clock, its people and its rules run beside the game.");
            return;
        }
        // 5: the town is drawn behind this screen; its shaders are built by those first frames
        if (drawFrom < 0) drawFrom = age;
        if (readyAt < 0)
        {
            evenFrames = delta < 0.05 ? evenFrames + 1 : 0;
            double t = age - drawFrom;
            ShowStep("Preparing the shaders", "", 0.82f + 0.16f * (float)Math.Min(1, t / 1.5), "Building every picture program once, now, so the first walk does not stutter.");
            if ((t > 0.8 && evenFrames >= 20) || t > 6) readyAt = age;
            return;
        }
        ShowStep("Ready", "", 1, "The town is ready.");
        if (age - readyAt > 0.25) fade = 0;
    }

    /// <summary>A returning player: the game they will continue, named as the menu's Continue names it.</summary>
    private void ShowSave(Api api)
    {
        api.Run(api.Saves(), r =>
        {
            if (r.Saves is not { Count: > 0 } || I != this || save == null) return;
            var s = r.Saves[0];
            save.Text = $"Your game waits: {s.Weekday} {s.Hour}:{s.Minute:00}, day {s.Day}, {s.Place}. Continue is on the menu.";
            save.Visible = true;
            Callable.From(Place).CallDeferred();
        }, _ => { });
    }

    /// <summary>A line in small caps that draws itself (the step's name).</summary>
    private partial class CapsLine : Control
    {
        public Font Font = Fonts.Print;
        public int FontSize = 20;
        public Color Colour;
        public float SpacingEm;
        private string text = "";
        public string Text
        {
            get => text;
            set
            {
                if (text == value) return;
                text = value;
                UpdateMinimumSize();
                QueueRedraw();
            }
        }
        public override Vector2 _GetMinimumSize() => new(0, Font.GetHeight(FontSize));
        public override void _Draw() => Kit.DrawCaps(this, Font, Vector2.Zero, text, FontSize, Colour, Mathf.RoundToInt(FontSize * SpacingEm));
    }

    /// <summary>The bar: an engraver's frame filled with hatching; a light runs over the ink so it never looks stuck.</summary>
    private partial class Bar : Control
    {
        public Color Ink;
        private float fill = 0.02f, drawn = 0.02f;
        public float Fill
        {
            get => fill;
            set => fill = value;
        }

        public override void _Process(double delta)
        {
            // CSS transition 0.6 s ease-out
            drawn += (fill - drawn) * (float)Math.Min(1, delta * 5);
            QueueRedraw();
        }

        public override void _Draw()
        {
            float h = 13 + 4 + 3;
            var frame = new Rect2(0.75f, 0.75f, Size.X - 1.5f, h - 1.5f);
            DrawRect(frame, new Color(1f, 0.98f, 0.92f, 0.35f));
            DrawRect(frame, Ink, false, 1.5f);
            var inner = new Rect2(3.5f, 3.5f, (Size.X - 7) * drawn, h - 7);
            // the hatching: slanted ink lines, 5 px apart
            for (float x = inner.Position.X - inner.Size.Y; x < inner.End.X; x += 5)
            {
                var a = new Vector2(x, inner.End.Y);
                var b = new Vector2(x + inner.Size.Y * 0.7f, inner.Position.Y);
                // cut to the fill
                if (a.X < inner.Position.X)
                {
                    float t = (inner.Position.X - a.X) / (b.X - a.X);
                    if (t >= 1) continue;
                    a = a.Lerp(b, t);
                }
                if (b.X > inner.End.X)
                {
                    float t = (inner.End.X - a.X) / (b.X - a.X);
                    if (t <= 0) continue;
                    b = a.Lerp(b, t);
                }
                DrawLine(a, b, Ink, 2.2f, true);
            }
            // the sheen
            float ph = (float)(Time.GetTicksMsec() % 2600) / 2600f;
            float sw = inner.Size.X * 0.4f, sx = inner.Position.X + (-1.1f + 3.7f * ph) * sw;
            float x0 = Math.Max(inner.Position.X, sx), x1 = Math.Min(inner.End.X, sx + sw);
            if (x1 > x0)
            {
                float mid = sx + sw / 2;
                var light = new Color(0.914f, 0.882f, 0.796f, 0.55f);
                var none = new Color(light, 0);
                Color At(float x) => none.Lerp(light, 1 - Math.Min(1, Math.Abs(x - mid) / (sw / 2)));
                float m = Math.Clamp(mid, x0, x1);
                DrawPolygon(new[] { new Vector2(x0, inner.Position.Y), new Vector2(m, inner.Position.Y), new Vector2(m, inner.End.Y), new Vector2(x0, inner.End.Y) }, new[] { At(x0), At(m), At(m), At(x0) });
                DrawPolygon(new[] { new Vector2(m, inner.Position.Y), new Vector2(x1, inner.Position.Y), new Vector2(x1, inner.End.Y), new Vector2(m, inner.End.Y) }, new[] { At(m), At(x1), At(x1), At(m) });
            }
        }
    }
}
