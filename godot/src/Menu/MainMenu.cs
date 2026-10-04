using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// The menus (the browser's menu/menu.ts and the pause wiring of main.ts): the title handbill with its list, the
/// way into the game, the pause (P's card, the Esc menu, the small hint after the window was left), and the sheets
/// the list opens (Settings, AI setup, Help, Credits, New game, Save and Load, Quit).
///
/// The keys: on the handbill the arrows move, Enter or Space picks, a walking key or a click beside the list walks
/// into town. In play Esc opens the menu (the game pauses) and Esc again goes on; P pauses with a card; leaving
/// the window pauses with a small hint. A sheet open: Esc closes it.
///
/// For other parts: `MainMenu.I.Entered` (the game was entered: the first page is not a pause), `MainMenu.I.InPlay`
/// (Jef has the keys and the mouse now), the events `WalkedIn` and `WorldReplaced` (a save was loaded or a new week
/// begun: every part starts again from the server's state).
/// Off with --no-mainmenu, and in every run that takes its own pictures (--shots, another part's --...test).
/// </summary>
[GamePart(95)]
public partial class MainMenu : Node
{
    public static MainMenu? I { get; private set; }

    /// <summary>The game has been entered since the first page (or since a load).</summary>
    public bool Entered { get; private set; }
    /// <summary>The handbill is up.</summary>
    public bool Open => start.Visible;
    /// <summary>Jef has the keys and the mouse: no menu, no card, no pause.</summary>
    public bool InPlay => Entered && !Pause.Paused && HasInput;
    /// <summary>The game was walked into (each time, from the menu or a pause).</summary>
    public event Action? WalkedIn;
    /// <summary>The server's game is another one now ("load" or "new"): the client part of the save, if any.</summary>
    public event Action<string, ClientState?>? WorldReplaced;
    public Saves Saves { get; private set; } = null!;

    private Control host = null!;      // everything of the menus, over the HUD
    private Control start = null!;     // the dim and the handbill
    private Control sheets = null!;    // Dialogs.Host
    private Control pauseCard = null!;
    private Label resume = null!;
    private Label fpsNote = null!;
    private PaperCard? toast;
    private double toastLeft;
    private VBoxContainer nav = null!;
    private InkButton play = null!;
    private Label hint = null!;
    private MarginContainer keysBox = null!;
    private Control stamp = null!;
    private Control aiNote = null!;
    private RichTextLabel aiNoteText = null!;
    private bool quiet;                // paused without the menu: after the window lost focus
    private string loadedLine = "";    // after a load: the first page says where
    private double sinceSlow;
    private bool walkMode;
    private string walkTitle = "", walkText = "";

    /// <summary>Do the menus belong in this run? Not in one that takes its own pictures or tests another part.</summary>
    public static bool Wanted(Main main)
    {
        if (main.Flag("no-mainmenu")) return false;
        foreach (string check in new[] { "paths", "stuck", "shaders", "perfcheck", "clocks", "interiors", "devtest" })
            if (main.Flag(check)) return false;
        string only = main.Arg("only");
        if (only != "" && !only.Split(',').Contains("mainmenu")) return false;
        foreach (string a in OS.GetCmdlineUserArgs())
            if (a == "--shots" || (a.StartsWith("--") && a.EndsWith("test") && a != "--menutest" && a != "--togethertest"))
                return false;
        return true;
    }

    public MainMenu()
    {
        I = this;
        ProcessMode = ProcessModeEnum.Always;
    }

    private bool HasInput => Input.MouseMode is Input.MouseModeEnum.Captured or Input.MouseModeEnum.ConfinedHidden;

    public override void _Ready()
    {
        if (!Wanted(Main.I))
        {
            SetProcess(false);
            SetProcessInput(false);
            I = null;
            return;
        }
        // the server's link goes on through a pause (its channel, the menus' own calls)
        if (ServerLink.I is { } link)
        {
            link.ProcessMode = ProcessModeEnum.Always;
            link.StatusChanged += OnLink;
        }
        // over the HUD and over what other parts put on the screen later (the loading screen is higher still)
        host = new Control { Name = "Menus", ProcessMode = ProcessModeEnum.Always, MouseFilter = Control.MouseFilterEnum.Ignore, ZIndex = 20 };
        host.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(host);
        // under the loading screen, which Main put up first
        if (Loading.I is { } boot) Main.I.Ui.MoveChild(boot, -1);
        Saves = new Saves(this);
        AddChild(Saves);
        Build();
        Kit.LookChanged += Rebuild;
        GetViewport().SizeChanged += OnResize;
        Keys.Changed += WriteKeys;
        Prefs.Changed += OnPrefs;
        Apply.Benchmarked += OnBenchmark;
        Loading.Done += OnLoaded;
        ServerLink.I?.WhenUp(() =>
        {
            Apply.All();
            RefreshAiNote();
            Saves.Refresh();
            ServerLink.I!.Api!.SystemPushed += Saves.OnPush;
        });
        if (!Loading.Busy) OnLoaded();
    }

    public override void _ExitTree()
    {
        Kit.LookChanged -= Rebuild;
        Keys.Changed -= WriteKeys;
        Prefs.Changed -= OnPrefs;
        Apply.Benchmarked -= OnBenchmark;
        Loading.Done -= OnLoaded;
        if (I == this) I = null;
    }

    private string linkError = "";
    private void OnLink()
    {
        string e = ServerLink.I?.Error ?? "";
        if (e == linkError) return;
        linkError = e;
        RefreshNav();
        if (e != "") Toast(e.Split('\n')[0]);
    }

    private void OnLoaded()
    {
        OnLink();
        if (start.Visible && Dialogs.Count == 0) Dialogs.FocusFirst(nav);
    }

    private void OnResize()
    {
        if (!Kit.Fit(GetViewport().GetVisibleRect().Size)) Rebuild();
    }

    private void OnPrefs(IReadOnlyList<string> keys)
    {
        if (keys.Contains("showFps")) fpsNote.Visible = Prefs.Bool("showFps");
    }

    // ------------------------------------------------------------------ building

    private void Rebuild()
    {
        bool open = start.Visible, card = pauseCard.Visible, hintOn = resume.Visible;
        foreach (var c in host.GetChildren())
            if (c != sheets && c is not InkCursor)
                c.QueueFree();
        Build(sheets);
        start.Visible = open;
        pauseCard.Visible = card;
        resume.Visible = hintOn;
        RefreshNav();
        Saves.Rebuilt();
    }

    private void Build(Control? keepSheets = null)
    {
        var win = GetViewport().GetVisibleRect().Size;
        Kit.Fit(win);

        // #start: the dim over the picture, darker to the edges; a click on it walks into town
        start = new Control { Name = "Start", MouseFilter = Control.MouseFilterEnum.Stop };
        start.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        var dim = new Gradient { Offsets = new[] { 0f, 1f }, Colors = new[] { new Color(0.031f, 0.035f, 0.039f, 0.35f), new Color(0.031f, 0.035f, 0.039f, 0.72f) } };
        var shade = new TextureRect { Texture = new GradientTexture2D { Gradient = dim, Fill = GradientTexture2D.FillEnum.Radial, FillFrom = new Vector2(0.5f, 0.5f), FillTo = new Vector2(1.2f, 0.5f), Width = 128, Height = 128 }, ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.Scale, MouseFilter = Control.MouseFilterEnum.Ignore };
        shade.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        start.AddChild(shade);
        start.GuiInput += e =>
        {
            if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left }) Start();
        };
        host.AddChild(start);
        BuildPaper(win);

        // the sheets go over the handbill
        if (keepSheets == null)
        {
            sheets = new Control { Name = "Sheets", MouseFilter = Control.MouseFilterEnum.Ignore, ProcessMode = ProcessModeEnum.Always };
            sheets.SetAnchorsPreset(Control.LayoutPreset.FullRect);
            host.AddChild(sheets);
            Dialogs.Host = sheets;
            Dialogs.Changed += OnDialogs;
        }
        else host.MoveChild(sheets, -1);

        // .pause-card: P's card
        pauseCard = new Control { Name = "PauseCard", Visible = false, MouseFilter = Control.MouseFilterEnum.Stop };
        pauseCard.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        pauseCard.AddChild(Fill(new ColorRect { Color = new Color(0.031f, 0.035f, 0.039f, 0.38f), MouseFilter = Control.MouseFilterEnum.Ignore }));
        pauseCard.GuiInput += e =>
        {
            if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left }) KeyPause(false);
        };
        var pc = PlainCard("Paused", "Nothing moves in the town until you go on.", $"{Keys.Label("pause")}, {Keys.Label("forward")} or a click to go on · Esc: the menu");
        pauseCard.AddChild(Centre(pc));
        host.AddChild(pauseCard);

        // .resume-hint: paused without the menu
        resume = Kit.Text("", Fonts.Hand, 16 / Kit.Scale, new Color("2a241c"));
        resume.Visible = false;
        var rb = new StyleBoxFlat { BgColor = new Color(0.847f, 0.812f, 0.722f, 0.9f), ContentMarginLeft = 14, ContentMarginRight = 14, ContentMarginTop = 6, ContentMarginBottom = 6 };
        rb.SetCornerRadiusAll(3);
        resume.AddThemeStyleboxOverride("normal", rb);
        resume.AnchorLeft = resume.AnchorRight = 0.5f;
        resume.AnchorTop = resume.AnchorBottom = 1;
        resume.GrowHorizontal = Control.GrowDirection.Both;
        resume.GrowVertical = Control.GrowDirection.Begin;
        resume.OffsetBottom = resume.OffsetTop = -18;
        host.AddChild(resume);

        // .fps-note: the frame time in the corner
        fpsNote = new Label { Text = "-- fps", Visible = Prefs.Bool("showFps"), MouseFilter = Control.MouseFilterEnum.Ignore, LabelSettings = new LabelSettings { Font = Fonts.Mono, FontSize = 12, FontColor = new Color("e8e0c8") } };
        var fb = new StyleBoxFlat { BgColor = new Color(0.04f, 0.04f, 0.04f, 0.55f), ContentMarginLeft = 8, ContentMarginRight = 8, ContentMarginTop = 2, ContentMarginBottom = 2 };
        fpsNote.AddThemeStyleboxOverride("normal", fb);
        fpsNote.AnchorLeft = fpsNote.AnchorRight = 1;
        fpsNote.GrowHorizontal = Control.GrowDirection.Begin;
        fpsNote.OffsetRight = fpsNote.OffsetLeft = -10;
        fpsNote.OffsetTop = 8;
        host.AddChild(fpsNote);

        if (InkCursor.I == null) host.AddChild(new InkCursor { Playing = () => Entered && !Pause.Paused && !start.Visible });
        else host.MoveChild(InkCursor.I, -1);
        RefreshNav();
    }

    private static Control Fill(Control c)
    {
        c.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        return c;
    }

    /// <summary>A paper in the middle of the window, whatever its size.</summary>
    public static Control Centre(Control c)
    {
        return new Centred(c);
    }

    /// <summary>The old plain card (style.css .pause-card .paper): a big hand-written word, a line in print, the keys.</summary>
    public static PaperCard PlainCard(string title, string sub, string keys = "")
    {
        var card = new PaperCard(PaperCard.Kind.Plain) { Tilt = -1.2f, MouseFilter = Control.MouseFilterEnum.Ignore };
        card.Pad(44, 28, 44, 28);
        var col = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        col.AddThemeConstantOverride("separation", 0);
        var ink = new Color("2a2420");
        var h = Kit.Text(title, Fonts.HandBold, 40, ink, false, 0.075f);
        h.HorizontalAlignment = HorizontalAlignment.Center;
        col.AddChild(h);
        if (sub != "")
        {
            col.AddChild(new Control { CustomMinimumSize = new Vector2(0, Kit.Px(4)) });
            var s = Kit.Text(sub, Fonts.Print, 16, ink);
            s.HorizontalAlignment = HorizontalAlignment.Center;
            col.AddChild(s);
        }
        if (keys != "")
        {
            col.AddChild(new Control { CustomMinimumSize = new Vector2(0, Kit.Px(14)) });
            var k = Kit.Text(keys, Fonts.Hand, 14, new Color(ink, 0.9f));
            k.HorizontalAlignment = HorizontalAlignment.Center;
            col.AddChild(k);
        }
        col.CustomMinimumSize = new Vector2(Kit.Px(260 - 88), 0);
        card.AddChild(col);
        return card;
    }

    private InkButton cont = null!, saveBtn = null!, loadBtn = null!, quitTitle = null!;
    private PaperCard paper = null!;
    private ScrollContainer paperScroll = null!;
    private TextureRect? cut;

    /// <summary>menu.ts buildPaper: the handbill.</summary>
    private void BuildPaper(Vector2 win)
    {
        paper = new PaperCard(PaperCard.Kind.Title) { Tilt = -0.8f, MouseDefaultCursorShape = Control.CursorShape.Arrow };
        // the CSS padding is 22px 34px 16px; 20 of the 34 at the sides is the paper's, 14 each line's own, so the
        // title (wider than its column, as the browser lets it run over) is not cut by the list's scroll
        paper.Pad(20, 22, 20, 16);
        // a click on the paper beside the list walks into town, as a click on the dim does
        paper.GuiInput += e =>
        {
            if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left }) Start();
        };
        float width = Math.Min(Kit.Px(440), win.X * 0.94f);
        float inner = width - Kit.Px(68);
        var col = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, CustomMinimumSize = new Vector2(width - Kit.Px(40), 0) };
        col.AddThemeConstantOverride("separation", 0);

        // the masthead
        var kicker = Kit.Text("ANTWERPEN · MDCCCLXXIII", Fonts.Print, 12, Kit.InkSoft, false, 0.32f);
        kicker.HorizontalAlignment = HorizontalAlignment.Center;
        col.AddChild(Margin(kicker, 0, 0, 14));
        bool shortWin = win.Y <= 800;
        var h1 = Kit.Text("SCHELDEMIST", Fonts.Slab, shortWin ? 40 : 44, Kit.Ink, false, 0.07f);
        h1.HorizontalAlignment = HorizontalAlignment.Center;
        // the slab's line box is taller than the CSS line-height 1: take the spare off
        var h1Box = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        float spare = Fonts.Slab.GetHeight(Kit.Px(shortWin ? 40 : 44)) - Kit.Px(shortWin ? 40 : 44);
        h1Box.AddThemeConstantOverride("margin_top", Kit.Px(2) - Mathf.RoundToInt(spare * 0.5f));
        h1Box.AddThemeConstantOverride("margin_bottom", -Mathf.RoundToInt(spare * 0.5f));
        h1Box.AddChild(new Loose(h1));
        col.AddChild(h1Box);
        var sub = Kit.Text("Antwerpen, Rijnkaai. October 1873.", Fonts.PrintItalic, 16, Kit.InkSoft);
        sub.HorizontalAlignment = HorizontalAlignment.Center;
        col.AddChild(Margin(sub, 6, 0, 14));
        // the wood engraving of the quay, printed on the paper; smaller on a short window, gone there in play
        cut = null;
        if (Kit.Picture(Paths.MenuPicture) is { } tex)
        {
            float share = win.Y <= 900 ? 0.66f : 0.86f;
            float cw = inner * share;
            cut = new TextureRect { Texture = tex, ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.Scale, CustomMinimumSize = new Vector2(cw, cw * tex.GetHeight() / tex.GetWidth()), SizeFlagsHorizontal = Control.SizeFlags.ShrinkCenter, MouseFilter = Control.MouseFilterEnum.Ignore, Material = new CanvasItemMaterial { BlendMode = CanvasItemMaterial.BlendModeEnum.Mul } };
            col.AddChild(Margin(cut, win.Y <= 900 ? 4 : 8, 0, 14));
        }
        col.AddChild(Margin(Kit.Rule((440 - 68) * 0.78f), 8, 6, 14));

        // the list
        nav = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        nav.AddThemeConstantOverride("separation", 0);
        play = Item(InkButton.Look.MenuPlay, "Walk into town", Start);
        cont = Item(InkButton.Look.MenuItem, "Continue", () => Saves.Continue());
        saveBtn = Item(InkButton.Look.MenuItem, "Save", () => Saves.OpenPanel("save"));
        loadBtn = Item(InkButton.Look.MenuItem, "Load", () => Saves.OpenPanel("load"));
        Item(InkButton.Look.MenuItem, "New game", () => Sheets.NewGame(this));
        Item(InkButton.Look.MenuItem, "Settings", () => SettingsSheet.Open("graphics"));
        Item(InkButton.Look.MenuItem, "Together", TogetherSheet.Open);
        Item(InkButton.Look.MenuItem, "AI setup", () => AiSheet.Open());
        Item(InkButton.Look.MenuItem, "Controls", () => SettingsSheet.Open("controls"));
        Item(InkButton.Look.MenuItem, "Help", Sheets.Help);
        Item(InkButton.Look.MenuItem, "Credits", Sheets.Credits);
        quitTitle = Item(InkButton.Look.MenuItem, "Quit to title", () => Sheets.Quit(this));
        quitTitle.RuleAbove = true;
        // a program has a way out a browser tab does not need
        Item(InkButton.Look.MenuItem, "Leave the game", () => Sheets.Leave(this));
        col.AddChild(Margin(nav, 2, 4, 14));

        // .ai-note: a plain line when the game plays without AI
        aiNoteText = Kit.Rich("", 13, Kit.InkSoft);
        var noteBox = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        var nb = new StyleBoxFlat { BgColor = Colors.Transparent, BorderColor = Kit.InkFaint, ContentMarginLeft = Kit.Px(8), ContentMarginRight = Kit.Px(8), ContentMarginTop = Kit.Px(4), ContentMarginBottom = Kit.Px(4) };
        nb.SetBorderWidthAll(Math.Max(1, Kit.Px(1)));
        noteBox.AddThemeStyleboxOverride("panel", nb);
        noteBox.AddChild(aiNoteText);
        aiNote = Margin(noteBox, 4, 0, 20);
        aiNote.Visible = false;
        col.AddChild(aiNote);

        // .sheet-foot: the hint in the hand, the keys
        col.AddChild(new Control { CustomMinimumSize = new Vector2(0, Kit.Px(8)) });
        col.AddChild(Margin(new Line { CustomMinimumSize = new Vector2(0, Math.Max(1, Kit.Px(1))), Colour = Kit.InkFaint }, 0, 0, 14));
        hint = Kit.Text("", Fonts.Hand, 16, Kit.Ink, true);
        hint.HorizontalAlignment = HorizontalAlignment.Center;
        col.AddChild(Margin(hint, 6, 0, 14));
        keysBox = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        col.AddChild(Margin(keysBox, 0, 0, 14));

        // never higher than the window: the list scrolls then (no bar, as the browser's)
        var scroll = new ScrollContainer { HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled, VerticalScrollMode = ScrollContainer.ScrollMode.ShowNever, FollowFocus = false, MouseFilter = Control.MouseFilterEnum.Pass };
        scroll.AddChild(col);
        paper.AddChild(scroll);
        paperScroll = scroll;
        void Size()
        {
            var w = GetViewport().GetVisibleRect().Size;
            float want = col.GetCombinedMinimumSize().Y + Kit.Px(38);
            float h = Math.Min(want, w.Y * 0.96f);

            paper.Size = new Vector2(width, h);
            paper.Position = ((w - paper.Size) / 2).Round();
        }
        col.MinimumSizeChanged += Size;
        start.AddChild(paper);
        Callable.From(Size).CallDeferred();

        // the stamp (main.ts): a red "Paused" slanted over the masthead, as a rubber stamp would
        // red ink printed over what is under it (the CSS mix-blend-mode: multiply at opacity 0.8)
        var stampInk = Colors.White.Lerp(Kit.Rust, 0.8f);
        var st = Kit.Text("PAUSED", Fonts.Slab, 15, stampInk, false, 0.25f);
        var sbx = new StyleBoxFlat { BgColor = Colors.White.Lerp(new Color("ddd3b9"), 0.3f), BorderColor = stampInk, ContentMarginLeft = Kit.Px(12), ContentMarginRight = Kit.Px(9), ContentMarginTop = Kit.Px(1), ContentMarginBottom = Kit.Px(1) };
        sbx.SetBorderWidthAll(Math.Max(1, Kit.Px(2)));
        st.AddThemeStyleboxOverride("normal", sbx);
        st.RotationDegrees = 8;
        st.Material = new CanvasItemMaterial { BlendMode = CanvasItemMaterial.BlendModeEnum.Mul };
        stamp = st;
        stamp.Visible = false;
        paper.AddChild(stamp, false, Node.InternalMode.Back);
        paper.Resized += () =>
        {
            stamp.PivotOffset = stamp.Size / 2;
            stamp.Position = new Vector2(paper.Size.X - stamp.Size.X - Kit.Px(34 - 14), Kit.Px(22 + 8));
        };
        WriteKeys();
    }

    private static Control Margin(Control c, float top, float bottom, float side = 0)
    {
        var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        m.AddThemeConstantOverride("margin_top", Kit.Px(top));
        m.AddThemeConstantOverride("margin_bottom", Kit.Px(bottom));
        m.AddThemeConstantOverride("margin_left", Kit.Px(side));
        m.AddThemeConstantOverride("margin_right", Kit.Px(side));
        m.AddChild(c);
        return m;
    }

    private InkButton Item(InkButton.Look look, string label, Action go)
    {
        var b = new InkButton(look, label, go);
        nav.AddChild(b);
        return b;
    }

    /// <summary>menu.ts refreshNav: the first page or in the game: the items that belong, their words.</summary>
    public void RefreshNav()
    {
        if (play == null) return;
        play.Label = Entered ? "Go on" : "Walk into town";
        quitTitle.Visible = Entered;
        stamp.Visible = Entered;
        if (cut != null) cut.GetParent<Control>().Visible = !(Entered && GetViewport().GetVisibleRect().Size.Y <= 800);
        // the saves' own lines (saves.ts buttons): Continue on the first page, Save in play (and after a load)
        var newest = Saves.Newest;
        bool afterLoad = loadedLine != "";
        cont.Visible = !Entered && !afterLoad && newest != null;
        if (newest != null) cont.Sub = $"{Saves.When(newest)}, {newest.Place}";
        saveBtn.Visible = Entered || afterLoad;
        string walk = Keys.Label("forward");
        hint.Text = loadedLine != "" && !Entered ? loadedLine : Entered ? $"Click, or press {walk}, Space or Enter, to go on." : $"Click, or press {walk}, Space or Enter, to walk.";
        aiNote.Visible = walkMode;
        if (walkMode) aiNoteText.Text = $"[b]{Kit.Esc(walkTitle)}.[/b] {Kit.Esc(walkText)}";
        // the server did not come up: the handbill says so (the HUD's own note lies under it)
        if (ServerLink.I?.Error is { Length: > 0 } down)
        {
            aiNote.Visible = true;
            aiNoteText.Text = $"[b]The game server is not running.[/b] {Kit.Esc(down)}";
        }
    }

    /// <summary>menu.ts writeKeysLine: the keys line at the foot of the paper, from the keys bound now.</summary>
    private void WriteKeys()
    {
        if (keysBox == null || !IsInstanceValid(keysBox)) return;
        foreach (var c in keysBox.GetChildren()) c.QueueFree();
        string K(string id) => KeyedText.Key(Keys.Label(id));
        keysBox.AddChild(new KeyedText($"{K("forward")}{K("left")}{K("back")}{K("right")} walk \u00b7 {K("hurry")} hurry \u00b7 {K("use")} use \u00b7 {K("map")} map \u00b7 {K("pockets")} pockets \u00b7 {K("pause")} pause \u00b7 {{Esc}} menu") { CssSize = 12, LineEm = 1.9f, Colour = Kit.InkSoft, Centre = true });
        RefreshNav();
    }

    /// <summary>ai.ts aiMenuNote: the server says whether the game plays without AI.</summary>
    public void RefreshAiNote()
    {
        var api = ServerLink.I?.Api;
        if (api == null) return;
        api.Run(api.AiConfig(5000), v =>
        {
            walkMode = v.TryGetProperty("mode", out var m) && m.GetString() == "walk";
            if (v.TryGetProperty("status", out var s))
            {
                walkTitle = s.GetProperty("title").GetString() ?? "";
                walkText = s.GetProperty("text").GetString() ?? "";
            }
            RefreshNav();
        }, _ => { });
    }

    private void OnDialogs()
    {
        // a sheet up: the handbill under it steps back
        paper.Visible = Dialogs.Count == 0;
        if (Dialogs.Count == 0 && start.Visible) Dialogs.FocusFirst(nav);
    }

    private void OnBenchmark(string preset, int fps)
    {
        string words = preset switch { "low" => "Low", "medium" => "Medium", _ => "High" };
        Toast($"Graphics set to {words} for this computer ({fps} frames a second). Change it in Esc, Settings.");
    }

    /// <summary>menu.ts toastNote: a slip of paper at the top for nine seconds.</summary>
    public void Toast(string text)
    {
        toast?.QueueFree();
        toast = new PaperCard(PaperCard.Kind.Plain) { Tilt = -0.5f, MouseFilter = Control.MouseFilterEnum.Ignore };
        toast.Pad(16, 6, 16, 6);
        var l = Kit.Text(text, Fonts.Print, 15, Kit.Ink);
        toast.AddChild(l);
        host.AddChild(toast);
        toast.ResetSize();
        var win = GetViewport().GetVisibleRect().Size;
        toast.Position = new Vector2((win.X - toast.GetCombinedMinimumSize().X) / 2, 18);
        toastLeft = 9;
    }

    // ------------------------------------------------------------------ in and out of the game (main.ts)

    /// <summary>main.ts start(): into the game from the menu, the card or the hint.</summary>
    public void Start()
    {
        if (Loading.Busy || !Main.I.Loaded || Pause.Has("saving") || Pause.Has("loading")) return;
        Dialogs.CloseAll();
        bool first = !Entered;
        Entered = true;
        quiet = false;
        loadedLine = "";
        start.Visible = false;
        pauseCard.Visible = false;
        resume.Visible = false;
        GetViewport().GuiReleaseFocus();
        Input.MouseMode = Input.MouseModeEnum.Captured;
        Pause.Set("key", false);
        Pause.Set("menu", false);
        RefreshNav();
        if (first && !Prefs.Bool("benchDone") && Main.I.Arg("menutest") == "") Apply.RunBenchmark();
        WalkedIn?.Invoke();
    }

    /// <summary>main.ts showMenu: the handbill up (the game pauses once it was entered) or away.</summary>
    public void ShowMenu(bool on)
    {
        start.Visible = on;
        if (on)
        {
            pauseCard.Visible = false;
            Input.MouseMode = Input.MouseModeEnum.Visible;
            RefreshNav();
            Saves.Refresh();
            RefreshAiNote();
            if (Dialogs.Count == 0) Dialogs.FocusFirst(nav);
        }
        else Dialogs.CloseAll();
        resume.Visible = !on && quiet && !Pause.Has("key");
        resume.Text = Dialogs.Any() ? "Click or press any key to go on · Esc: menu" : $"Click or press {Keys.Label("forward")} to go on · Esc: menu";
        SyncPause();
    }

    /// <summary>The menu's reason to pause: entered once, and the menu is up or the game does not have the mouse.</summary>
    private void SyncPause() => Pause.Set("menu", Entered && (start.Visible || !HasInput));

    /// <summary>P: the "Paused" card; P, a walking key or a click goes on.</summary>
    public void KeyPause(bool on)
    {
        if (Pause.Together) return;
        if (on == Pause.Has("key")) return;
        if (on)
        {
            pauseCard.Visible = true;
            Input.MouseMode = Input.MouseModeEnum.Visible;
            resume.Visible = false;
            Pause.Set("key", true);
        }
        else Start();
    }

    /// <summary>Back to the first page (Quit to title, or after a load or a new week): not a pause.</summary>
    public void ToTitle(string loaded = "")
    {
        Dialogs.CloseAll();
        Entered = false;
        quiet = false;
        loadedLine = loaded;
        pauseCard.Visible = false;
        Input.MouseMode = Input.MouseModeEnum.Visible;
        Pause.Clear();
        ShowMenu(true);
    }

    /// <summary>The game under the menus is another one now: every part starts again from the server's state.</summary>
    public void Replaced(string how, ClientState? client) => WorldReplaced?.Invoke(how, client);

    public override void _Notification(int what)
    {
        if (I != this) return;
        // the window was left: a quiet pause, only a small hint (no menu for a snipping tool)
        if (what == NotificationApplicationFocusOut && InPlay && Main.I.Arg("menutest") == "")
        {
            quiet = true;
            Input.MouseMode = Input.MouseModeEnum.Visible;
            ShowMenu(false);
        }
    }

    /// <summary>A key being caught for a binding (Settings, Controls): it gets every key first.</summary>
    public Func<InputEventKey, bool>? KeyGrab { get; set; }

    private static readonly Key[] ResumeKeys = { Key.Space, Key.Enter, Key.KpEnter, Key.Up, Key.Down, Key.Left, Key.Right };
    private static bool Walking(InputEventKey k) => Keys.Is(k, "forward") || Keys.Is(k, "back") || Keys.Is(k, "left") || Keys.Is(k, "right");

    public override void _Input(InputEvent e)
    {
        if (I != this) return;
        if (Loading.Busy)
        {
            // keys and clicks wait until the menu is up
            if (e is InputEventKey or InputEventMouseButton) GetViewport().SetInputAsHandled();
            return;
        }
        if (e is InputEventMouseButton { Pressed: true } mb)
        {
            Kit.KeyFocus = false;
            if (mb.ButtonIndex == MouseButton.Left && Entered && quiet && !start.Visible && !Pause.Has("key") && Dialogs.Count == 0)
            {
                Start();
                GetViewport().SetInputAsHandled();
            }
            return;
        }
        if (e is not InputEventKey { Pressed: true } k) return;
        if (KeyGrab != null && KeyGrab(k))
        {
            GetViewport().SetInputAsHandled();
            return;
        }
        if (Pause.Has("saving") || Pause.Has("loading"))
        {
            GetViewport().SetInputAsHandled(); // wait for it
            return;
        }
        if (k.Keycode == Key.F11 && !k.Echo)
        {
            Prefs.Set("fullscreen", !Prefs.Bool("fullscreen"));
            GetViewport().SetInputAsHandled();
            return;
        }
        if (k.Keycode == Key.Escape)
        {
            if (k.Echo) return;
            GetViewport().SetInputAsHandled();
            if (Dialogs.CloseTop()) return;
            if (InPlay)
            {
                // a dialog of the game that Esc closes goes first; else the menu
                if (Dialogs.EscapeOne()) return;
                quiet = false;
                ShowMenu(true);
                return;
            }
            if (Pause.Has("key"))
            {
                // from the card to the menu (the menu's pause first: no moment of play between them)
                quiet = false;
                ShowMenu(true);
                Pause.Set("key", false);
                return;
            }
            if (start.Visible)
            {
                if (Entered) Start(); // Esc again goes on
                return;
            }
            if (Entered) ShowMenu(true); // from the quiet pause
            return;
        }
        // a sheet is up: its keys
        if (Dialogs.Top is { } top)
        {
            bool typing = GetViewport().GuiGetFocusOwner() is LineEdit;
            if (Dialogs.NavKey(top, k)) GetViewport().SetInputAsHandled();
            else if (!typing && k.Keycode is not (Key.Enter or Key.KpEnter or Key.Space or Key.Tab)) GetViewport().SetInputAsHandled();
            else if (k.Keycode is Key.Enter or Key.KpEnter or Key.Space or Key.Tab) Kit.KeyFocus = true;
            return;
        }
        if (start.Visible)
        {
            if (Dialogs.NavKey(nav, k))
            {
                GetViewport().SetInputAsHandled();
                if (GetViewport().GuiGetFocusOwner() is { } f && nav.IsAncestorOf(f)) paperScroll.EnsureControlVisible(f);
                return;
            }
            if (k.Keycode is Key.Enter or Key.KpEnter or Key.Space or Key.Tab)
            {
                Kit.KeyFocus = true;
                return; // the focused item is pressed (the first one walks into town)
            }
            if (!k.Echo && Walking(k))
            {
                Start();
                GetViewport().SetInputAsHandled();
            }
            return;
        }
        if (Pause.Has("key"))
        {
            if (!k.Echo && (Keys.Is(k, "pause") || Walking(k) || ResumeKeys.Contains(k.Keycode))) KeyPause(false);
            GetViewport().SetInputAsHandled();
            return;
        }
        if (Entered && quiet)
        {
            if (!k.Echo && (Walking(k) || ResumeKeys.Contains(k.Keycode) || Dialogs.Any())) Start();
            GetViewport().SetInputAsHandled();
            return;
        }
        // P in the game: the pause (not while a dialog of the game is up: P may be its own key there)
        if (InPlay && Keys.Is(k, "pause") && !Dialogs.Any() && GameState.I.Ending == null)
        {
            KeyPause(true);
            GetViewport().SetInputAsHandled();
        }
    }

    public override void _Process(double delta)
    {
        using var frameCost = Dev.FrameCost.Track("Menus");
        if (I != this) return;
        // the link's inbox is emptied here too: its own _Process may stand still for a frame at a pause's edge
        ServerLink.I?.Api?.Pump();
        if (InPlay) Apply.Frame(delta);
        if (toast != null)
        {
            toastLeft -= delta;
            toast.Modulate = new Color(1, 1, 1, (float)Math.Clamp(Math.Min((9 - toastLeft) / 0.8, toastLeft / 0.8), 0, 1));
            if (toastLeft <= 0)
            {
                toast.QueueFree();
                toast = null;
            }
        }
        sinceSlow += delta;
        if (sinceSlow < 0.5) return;
        sinceSlow = 0;
        Apply.Fov();
        Pause.Resend();
        if (fpsNote.Visible) fpsNote.Text = Apply.Samples > 0 ? $"{Math.Round(Apply.Fps)} fps · {Apply.Interval:0.0} ms · script {Apply.Work:0.0} ms" : "-- fps";
        // the mouse was taken or let go by another part: the pause follows
        if (Entered && !start.Visible && !Pause.Has("key") && !Pause.Has("saving") && !Pause.Has("loading")) SyncPause();
    }
}
