using System;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Ui;

/// <summary>
/// A sheet over the picture (the CSS .menu-sheet): a paper in the middle of the window with a head (a small line,
/// the title in the slab, the printer's rule), a body that scrolls, and a foot with its buttons on the right.
///
///   var s = new Sheet("Help", "A newcomer's guide");
///   s.Body.AddChild(Kit.Para("..."));
///   s.AddBack();                 // "Back [Esc]"
///   Dialogs.Open(s);             // Esc closes it
///
/// `tall: false` makes a short sheet as high as its words (New game, Quit).
/// </summary>
public partial class Sheet : Control
{
    public PaperCard Card { get; }
    /// <summary>Under the title: tabs and the like go here.</summary>
    public VBoxContainer Head { get; }
    /// <summary>The page: rows, headings, paragraphs.</summary>
    public VBoxContainer Body { get; }
    /// <summary>The buttons at the foot, laid from the left; put Kit.Spring() before those that go right.</summary>
    public HBoxContainer Foot { get; }
    public ScrollContainer Scroll { get; }
    /// <summary>The width of the body's text column, real px.</summary>
    public float BodyWidth { get; }

    private readonly float cssWidth;
    private readonly bool tall;

    public Sheet(string title, string kicker = "", float width = 820, bool tall = true)
    {
        cssWidth = width;
        this.tall = tall;
        SetAnchorsPreset(LayoutPreset.FullRect);
        MouseFilter = MouseFilterEnum.Stop; // a click beside the sheet does not reach the menu under it
        var win = Main.I.GetViewport().GetVisibleRect().Size;
        float w = Math.Min(Kit.Px(width), win.X * 0.96f);
        BodyWidth = w - Kit.Px(38) * 2;

        Card = new PaperCard(PaperCard.Kind.Sheet);
        AddChild(Card);
        var col = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        col.AddThemeConstantOverride("separation", 0);
        Card.AddChild(col);

        // .sheet-head: padding 16px 36px 0, centred
        var head = new MarginContainer { MouseFilter = MouseFilterEnum.Ignore };
        head.AddThemeConstantOverride("margin_left", Kit.Px(36));
        head.AddThemeConstantOverride("margin_right", Kit.Px(36));
        head.AddThemeConstantOverride("margin_top", Kit.Px(16));
        Head = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        Head.AddThemeConstantOverride("separation", 0);
        head.AddChild(Head);
        if (kicker != "")
        {
            var k = Kit.Text(kicker.ToUpperInvariant(), Fonts.Print, 12, Kit.InkSoft, false, 0.32f);
            k.HorizontalAlignment = HorizontalAlignment.Center;
            Head.AddChild(k);
        }
        var h2 = Kit.Text(title.ToUpperInvariant(), Fonts.Slab, 32, Kit.Ink, false, 0.08f);
        h2.HorizontalAlignment = HorizontalAlignment.Center;
        Head.AddChild(h2);
        var rule = new MarginContainer { MouseFilter = MouseFilterEnum.Ignore };
        rule.AddThemeConstantOverride("margin_top", Kit.Px(6));
        rule.AddThemeConstantOverride("margin_bottom", Kit.Px(8));
        rule.AddChild(Kit.Rule((width - 72) * 0.6f));
        Head.AddChild(rule);
        col.AddChild(head);

        // .sheet-body: padding 4px 38px 12px, scrolls
        Scroll = new ScrollContainer { HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled, FollowFocus = true, SizeFlagsVertical = SizeFlags.ExpandFill };
        ThinBar(Scroll.GetVScrollBar());
        var body = new MarginContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill, MouseFilter = MouseFilterEnum.Ignore };
        body.AddThemeConstantOverride("margin_left", Kit.Px(38));
        body.AddThemeConstantOverride("margin_right", Kit.Px(38));
        body.AddThemeConstantOverride("margin_top", Kit.Px(4));
        body.AddThemeConstantOverride("margin_bottom", Kit.Px(12));
        Body = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        Body.AddThemeConstantOverride("separation", 0);
        body.AddChild(Body);
        Scroll.AddChild(body);
        col.AddChild(Scroll);

        // .sheet-foot-row: a line over it, margin 0 18px, padding 10px 18px 16px
        var foot = new MarginContainer { MouseFilter = MouseFilterEnum.Ignore };
        foot.AddThemeConstantOverride("margin_left", Kit.Px(18));
        foot.AddThemeConstantOverride("margin_right", Kit.Px(18));
        var footCol = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        footCol.AddThemeConstantOverride("separation", 0);
        footCol.AddChild(new Line { CustomMinimumSize = new Vector2(0, Math.Max(1, Kit.Px(1))), Colour = Kit.InkFaint });
        var footPad = new MarginContainer { MouseFilter = MouseFilterEnum.Ignore };
        footPad.AddThemeConstantOverride("margin_left", Kit.Px(18));
        footPad.AddThemeConstantOverride("margin_right", Kit.Px(18));
        footPad.AddThemeConstantOverride("margin_top", Kit.Px(10));
        footPad.AddThemeConstantOverride("margin_bottom", Kit.Px(16));
        Foot = new HBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        Foot.AddThemeConstantOverride("separation", Kit.Px(10));
        footPad.AddChild(Foot);
        footCol.AddChild(footPad);
        foot.AddChild(footCol);
        col.AddChild(foot);

        if (!tall) Scroll.VerticalScrollMode = ScrollContainer.ScrollMode.Disabled;
        Resized += Place;
        Card.MinimumSizeChanged += Place;
    }

    public override void _Ready() => Place();

    /// <summary>"Back [Esc]" at the foot's right; `primary`: inked in ("Done").</summary>
    public InkButton AddBack(string label = "Back", bool primary = false)
    {
        var b = new InkButton(primary ? InkButton.Look.Primary : InkButton.Look.Btn, label, () => Dialogs.Close(this)) { Kbd = "Esc" };
        Foot.AddChild(b);
        return b;
    }

    /// <summary>The sheet in the middle: 820 CSS px wide (never wider than the window), nine tenths of the window high.</summary>
    private void Place()
    {
        var win = Size;
        if (win.X < 1) return;
        float w = Math.Min(Kit.Px(cssWidth), win.X * 0.96f);
        float h = tall ? Math.Min(win.Y * 0.9f, Kit.Px(900)) : Math.Min(Card.GetCombinedMinimumSize().Y, win.Y * 0.96f);
        Card.Size = new Vector2(w, h);
        Card.Position = ((win - Card.Size) / 2).Round();
    }

    /// <summary>A thin dark bar, as the browser's (scrollbar-width: thin).</summary>
    public static void ThinBar(ScrollBar bar)
    {
        var track = new StyleBoxFlat { BgColor = Colors.Transparent, ContentMarginLeft = Kit.Px(4), ContentMarginRight = Kit.Px(4) };
        var grab = new StyleBoxFlat { BgColor = new Color(0.133f, 0.106f, 0.082f, 0.45f) };
        grab.SetCornerRadiusAll(Kit.Px(3));
        var hot = new StyleBoxFlat { BgColor = new Color(0.133f, 0.106f, 0.082f, 0.7f) };
        hot.SetCornerRadiusAll(Kit.Px(3));
        bar.AddThemeStyleboxOverride("scroll", track);
        bar.AddThemeStyleboxOverride("scroll_focus", track);
        bar.AddThemeStyleboxOverride("grabber", grab);
        bar.AddThemeStyleboxOverride("grabber_highlight", hot);
        bar.AddThemeStyleboxOverride("grabber_pressed", hot);
        bar.CustomMinimumSize = new Vector2(Kit.Px(8), 0);
    }
}
