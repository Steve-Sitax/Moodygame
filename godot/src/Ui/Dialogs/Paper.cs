using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Ui.Dialogs;

/// <summary>
/// What the browser's style sheet does to a colour and a size (client/src/style.css), so a paper built here looks
/// like the page's: the --ui scale, the sepia and contrast filters, a colour from "#rrggbb".
/// </summary>
public static class Css
{
    public static readonly Color Ink = Hex("2a2420");

    /// <summary>style.css --ui: everything on screen grows with the window.</summary>
    public static float Ui(float width) => width >= 3000 ? 2.2f : width >= 2200 ? 1.8f : width >= 1600 ? 1.5f : 1.3f;

    public static Color Hex(string rrggbb, float alpha = 1) => new(new Color(rrggbb.TrimStart('#')), alpha);

    /// <summary>CSS filter: sepia(a) then contrast(c), on the colour as written (sRGB).</summary>
    public static Color Filter(Color c, float sepia, float contrast = 1)
    {
        float k = 1 - sepia;
        float r = (0.393f + 0.607f * k) * c.R + (0.769f - 0.769f * k) * c.G + (0.189f - 0.189f * k) * c.B;
        float g = (0.349f - 0.349f * k) * c.R + (0.686f + 0.314f * k) * c.G + (0.168f - 0.168f * k) * c.B;
        float b = (0.272f - 0.272f * k) * c.R + (0.534f - 0.534f * k) * c.G + (0.131f + 0.869f * k) * c.B;
        static float Con(float v, float by) => Math.Clamp((v - 0.5f) * by + 0.5f, 0, 1);
        return new Color(Con(Math.Min(1, r), contrast), Con(Math.Min(1, g), contrast), Con(Math.Min(1, b), contrast), c.A);
    }

    /// <summary>Text for a RichTextLabel: no tag of the player's or the model's making is read as one.</summary>
    public static string Esc(string? t) => (t ?? "").Replace("[", "[lb]");
}

/// <summary>
/// The faces the papers are set in (client/src/menu/fonts.ts): the HUD's hand and print (Game/Pen.cs Fonts), and
/// the print's italic, the posters' slab, the newspaper's blackletter and the telegraph's mono. The files lie in
/// godot/fonts beside their licences (assets/ATTRIBUTION.md).
/// </summary>
public static class PaperFonts
{
    public static Font Hand => Fonts.Hand;
    public static Font HandBold => Fonts.HandBold;
    public static Font Print => Fonts.Print;
    public static Font PrintBold => Fonts.PrintBold;
    public static Font PrintItalic => printItalic ??= Load("old-standard-tt-latin-400-italic.woff2");
    public static Font Slab => slab ??= Load("alfa-slab-one-latin-400-normal.woff2");
    public static Font Black => black ??= Load("unifrakturmaguntia-latin-400-normal.woff2");
    public static Font Mono => mono ??= Load("courier-prime-latin-400-normal.woff2");
    /// <summary>The hand has no italic of its own: the browser slants it, and so does this.</summary>
    public static Font HandItalic => handItalic ??= new FontVariation { BaseFont = Fonts.Hand, VariationTransform = new Transform2D(1, 0, 0.2f, 1, 0, 0) };
    private static Font? printItalic, slab, black, mono, handItalic;

    private static Font Load(string file)
    {
        string path = "res://fonts/" + file;
        if (ResourceLoader.Exists(path) && GD.Load<Font>(path) is { } f) return f;
        var raw = new FontFile();
        if (raw.LoadDynamicFont(ProjectSettings.GlobalizePath(path)) == Error.Ok) return raw;
        GD.PrintErr($"font not found: {path}");
        return ThemeDB.FallbackFont;
    }
}

/// <summary>Which faces a piece of text is set in: the hand (headings, labels) or the print (reading).</summary>
public enum Face
{
    Hand,
    Print,
}

/// <summary>
/// A line or a key that can be clicked (game/cursor.ts: "ink-click"): the mouse over it tints it, a click sends the
/// dialog on top the key it stands for, so the keys and the mouse do the same thing.
/// </summary>
public partial class InkClick : PanelContainer
{
    private static readonly Color Hot = new(122 / 255f, 88 / 255f, 40 / 255f, 0.16f);
    private readonly StyleBoxFlat box = new() { BgColor = Colors.Transparent };
    /// <summary>The key a click sends ("Digit2", "KeyE", "Escape").</summary>
    public string Code = "";
    /// <summary>Instead of a key: what a click does.</summary>
    public Action? Act;

    public InkClick()
    {
        MouseFilter = MouseFilterEnum.Stop;
        MouseDefaultCursorShape = CursorShape.PointingHand;
        box.SetCornerRadiusAll(3);
        box.SetExpandMarginAll(2);
        AddThemeStyleboxOverride("panel", box);
        MouseEntered += () => box.BgColor = Hot;
        MouseExited += () => box.BgColor = Colors.Transparent;
    }

    public override void _GuiInput(InputEvent e)
    {
        if (e is not InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left }) return;
        AcceptEvent();
        if (Act != null) Act();
        else if (Code != "") Dialogs.I?.SendKey(Code);
    }
}

/// <summary>Holds one control and draws it a little lower than it lies (a paragraph inside its CSS line box).</summary>
public partial class Shifted : Container
{
    public float Shift;

    public Shifted()
    {
        MouseFilter = MouseFilterEnum.Ignore;
    }

    public override Vector2 _GetMinimumSize()
    {
        var min = Vector2.Zero;
        foreach (var c in GetChildren())
            if (c is Control k && k.Visible) min = min.Max(k.GetCombinedMinimumSize());
        return min;
    }

    public override void _Notification(int what)
    {
        if (what != NotificationSortChildren) return;
        foreach (var c in GetChildren())
            if (c is Control k) FitChildInRect(k, new Rect2(0, Shift, Size.X, Size.Y));
    }
}

/// <summary>A dashed rule across a paper (CSS "border-top: 1px dashed").</summary>
public partial class Dashes : Control
{
    public Color Colour = new(Css.Ink, 0.35f);
    public float Thick = 1;
    public float Dash = 3;
    public bool Solid;
    /// <summary>A double rule (CSS "3px double"): two thin lines.</summary>
    public bool Double;

    public Dashes()
    {
        MouseFilter = MouseFilterEnum.Ignore;
    }

    public override void _Draw()
    {
        float y = Size.Y / 2;
        if (Double)
        {
            DrawLine(new Vector2(0, y - Thick), new Vector2(Size.X, y - Thick), Colour, Thick, true);
            DrawLine(new Vector2(0, y + Thick), new Vector2(Size.X, y + Thick), Colour, Thick, true);
        }
        else if (Solid) DrawLine(new Vector2(0, y), new Vector2(Size.X, y), Colour, Thick, true);
        else DrawDashedLine(new Vector2(0, y), new Vector2(Size.X, y), Colour, Thick, Dash, true, true);
    }
}

/// <summary>
/// What is drawn on a paper under its text: the lines of laid or ruled paper every so many pixels, and a frame a
/// little inside the edge (single or double). It lies inside the paper's padding and draws out over it.
/// </summary>
public partial class PaperArt : Control
{
    public (float L, float T, float R, float B) Pad;
    /// <summary>A line across every RuleEvery pixels (0: none).</summary>
    public float RuleEvery;
    public Color RuleColour = new(80 / 255f, 60 / 255f, 30 / 255f, 0.08f);
    /// <summary>A frame this far inside the paper's edge (0: none); Double: two thin lines.</summary>
    public float FrameInset;
    public float FrameThick = 1;
    public bool FrameDouble;
    public Color FrameColour = Css.Ink;
    /// <summary>A band down the left edge (a notebook's spine).</summary>
    public float Spine;
    public Color SpineColour = Css.Ink;

    public PaperArt()
    {
        MouseFilter = MouseFilterEnum.Ignore;
    }

    public override void _Draw()
    {
        var all = new Rect2(-Pad.L, -Pad.T, Size.X + Pad.L + Pad.R, Size.Y + Pad.T + Pad.B);
        if (RuleEvery > 0)
            for (float y = all.Position.Y + RuleEvery - 0.5f; y < all.End.Y; y += RuleEvery)
                DrawLine(new Vector2(all.Position.X, y), new Vector2(all.End.X, y), RuleColour, 1);
        if (Spine > 0) DrawRect(new Rect2(all.Position, new Vector2(Spine, all.Size.Y)), SpineColour);
        if (FrameInset > 0)
        {
            var r = all.Grow(-FrameInset);
            if (FrameDouble)
            {
                DrawRect(r, FrameColour, false, FrameThick);
                DrawRect(r.Grow(-FrameThick * 2.5f), FrameColour, false, FrameThick);
            }
            else DrawRect(r, FrameColour, false, FrameThick);
        }
    }
}

/// <summary>
/// One paper on the screen, built as the browser builds its HTML: a card of a set width with a column of text in
/// it; lines with a number badge and the keys named in the keys line can be clicked (InkClick). Sizes are CSS
/// pixels, grown by the --ui scale S. The paper is placed by Where (the window's size and its own in, its top left
/// out) whenever either changes, and turned about its middle.
/// </summary>
public sealed class Sheet
{
    /// <summary>A key named at the start of a part of the keys line (game/cursor.ts KEY_RE).</summary>
    private static readonly Regex KeyRe = new(@"^(Esc|Enter|[A-Z]|[1-9])(?=:|\s{2,}|\s+or\s|\s+to\s)", RegexOptions.Compiled);

    public readonly PanelContainer Card;
    public readonly VBoxContainer Body;
    /// <summary>The --ui scale the sheet was built for.</summary>
    public readonly float S;
    /// <summary>The ink, through the paper's filter.</summary>
    public Color Ink;
    public readonly float SepiaBy;
    public readonly float ContrastBy;
    /// <summary>Where the paper lies: (window, its size) to its top left corner.</summary>
    public Func<Vector2, Vector2, Vector2>? Where;
    private readonly float inner;
    private readonly float space;

    /// <param name="width">The paper's whole width in real pixels (padding included).</param>
    /// <param name="pad">CSS padding: left, top, right, bottom.</param>
    /// <param name="maxHeight">Real pixels the paper may be high: taller, its text scrolls (CSS max-height with overflow auto). 0: as high as its text.</param>
    /// <param name="padScale">What the padding grows by: the --ui scale for the zoomed papers, 1 for the pages whose CSS scales the type only.</param>
    public Sheet(float scale, float width, Color paper, (float L, float T, float R, float B) pad, float turnDeg = 0, float sepia = 0, float contrast = 1, float shadow = 36, float drop = 8, float shadowAlpha = 0.8f, float maxHeight = 0, float padScale = 0)
    {
        space = padScale > 0 ? padScale : scale;
        if (padScale > 0) pad = (pad.L * padScale / scale, pad.T * padScale / scale, pad.R * padScale / scale, pad.B * padScale / scale);
        S = scale;
        SepiaBy = sepia;
        ContrastBy = contrast;
        Ink = Css.Filter(Css.Ink, sepia, contrast);
        var box = new StyleBoxFlat
        {
            BgColor = Css.Filter(paper, sepia, contrast),
            ContentMarginLeft = Px(pad.L),
            ContentMarginTop = Px(pad.T),
            ContentMarginRight = Px(pad.R),
            ContentMarginBottom = Px(pad.B),
            ShadowColor = new Color(0, 0, 0, shadowAlpha * 0.55f),
            ShadowSize = Sp(shadow * 0.6f),
            ShadowOffset = new Vector2(0, Sp(drop)),
            AntiAliasing = true,
        };
        box.SetCornerRadiusAll(1);
        Card = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Stop, RotationDegrees = turnDeg, CustomMinimumSize = new Vector2(MathF.Round(width), 0) };
        Card.AddThemeStyleboxOverride("panel", box);
        inner = MathF.Round(width) - Px(pad.L) - Px(pad.R);
        Body = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        Body.AddThemeConstantOverride("separation", 0);
        if (maxHeight > 0)
        {
            // a page taller than the window lets its text scroll (the wheel, the bar)
            float room = maxHeight - Px(pad.T) - Px(pad.B);
            var scroll = new ScrollContainer { HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled, MouseFilter = Control.MouseFilterEnum.Pass };
            scroll.AddChild(Body);
            Card.AddChild(scroll);
            void Fit() => scroll.CustomMinimumSize = new Vector2(0, MathF.Min(Body.GetCombinedMinimumSize().Y, room));
            Body.MinimumSizeChanged += Fit;
            Body.Resized += Fit;
        }
        else Card.AddChild(Body);
        Card.Resized += Place;
    }

    /// <summary>Something drawn on the paper under its text (a letter's ruling, a ticket's frame): it gets the paper's whole face.</summary>
    public void Under(PaperArt art)
    {
        var b = Box;
        art.Pad = (b.ContentMarginLeft, b.ContentMarginTop, b.ContentMarginRight, b.ContentMarginBottom);
        Card.AddChild(art);
        Card.MoveChild(art, 0);
    }

    public StyleBoxFlat Box => (StyleBoxFlat)Card.GetThemeStylebox("panel");
    /// <summary>The width text has inside the padding, in real pixels.</summary>
    public float Inner => inner;
    /// <summary>A type size or a zoomed length: CSS px times the --ui scale.</summary>
    public int Px(float css) => Mathf.RoundToInt(css * S);
    /// <summary>A margin, a padding, a gap: CSS px times what the paper's lengths grow by (the --ui scale on a zoomed paper, 1 on a page).</summary>
    public int Sp(float css) => Mathf.RoundToInt(css * space);
    /// <summary>So many em of a type size, as a length for the margins.</summary>
    public float Em(float em, float size) => em * size * S / space;

    /// <summary>Put the paper where it belongs (after its size or the window's changed).</summary>
    public void Place()
    {
        if (!GodotObject.IsInstanceValid(Card) || !Card.IsInsideTree()) return;
        var win = Card.GetViewport().GetVisibleRect().Size;
        Card.PivotOffset = Card.Size / 2;
        if (Where != null) Card.Position = Where(win, Card.Size).Round();
    }

    /// <summary>A colour as the paper's filter shows it.</summary>
    public Color Tone(Color c) => Css.Filter(c, SepiaBy, ContrastBy);

    // ------------------------------------------------------------------ text

    /// <summary>
    /// A paragraph. The text is BBCode ([b], [i], [font_size], [color]): escape what is not yours with Css.Esc.
    /// lineHeight is the CSS one (1.45 = 1.45 times the size); margins in CSS px.
    /// </summary>
    public RichTextLabel Text(string bb, Face face, float size, float opacity = 1, float lineHeight = 0, float top = 0, float bottom = 0, HorizontalAlignment align = HorizontalAlignment.Left, Container? into = null, Color? colour = null, float width = 0)
    {
        var (normal, bold, italic) = face == Face.Hand ? (PaperFonts.Hand, PaperFonts.HandBold, PaperFonts.HandItalic) : (PaperFonts.Print, PaperFonts.PrintBold, PaperFonts.PrintItalic);
        return TextIn(bb, normal, bold, italic, size, opacity, lineHeight, top, bottom, align, into, colour, width);
    }

    public RichTextLabel TextIn(string bb, Font normal, Font bold, Font italic, float size, float opacity = 1, float lineHeight = 0, float top = 0, float bottom = 0, HorizontalAlignment align = HorizontalAlignment.Left, Container? into = null, Color? colour = null, float width = 0)
    {
        int px = Math.Max(1, Px(size));
        var l = new RichTextLabel
        {
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            MouseFilter = Control.MouseFilterEnum.Ignore,
            SelectionEnabled = false,
            ShortcutKeysEnabled = false,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        // the width is set before the text is: a label that learns its width only from its container keeps the
        // height of the narrow first try (every word on its own line)
        if (width <= 0 && into == null) width = inner;
        if (width > 0)
        {
            l.CustomMinimumSize = new Vector2(MathF.Floor(width), 0);
            l.Size = new Vector2(MathF.Floor(width), 0);
        }
        l.AddThemeFontOverride("normal_font", normal);
        l.AddThemeFontOverride("bold_font", bold);
        l.AddThemeFontOverride("italics_font", italic);
        l.AddThemeFontOverride("bold_italics_font", bold);
        foreach (string k in new[] { "normal_font_size", "bold_font_size", "italics_font_size", "bold_italics_font_size" }) l.AddThemeFontSizeOverride(k, px);
        l.AddThemeColorOverride("default_color", colour ?? Ink);
        l.AddThemeStyleboxOverride("normal", new StyleBoxEmpty());
        // the CSS line is lineHeight x size tall, the words in its middle: the face's own line is taken off between
        // the lines, and half of the rest stands over the first and under the last
        if (lineHeight <= 0) lineHeight = NormalLine(normal);
        float lead = lineHeight * px - normal.GetHeight(px);
        l.AddThemeConstantOverride("line_separation", Mathf.RoundToInt(lead));
        string open = align == HorizontalAlignment.Right ? "[right]" : align == HorizontalAlignment.Center ? "[center]" : align == HorizontalAlignment.Fill ? "[fill]" : "";
        string close = align == HorizontalAlignment.Right ? "[/right]" : align == HorizontalAlignment.Center ? "[/center]" : align == HorizontalAlignment.Fill ? "[/fill]" : "";
        l.Text = open + bb + close;
        if (opacity < 1) l.Modulate = new Color(1, 1, 1, opacity);
        // (the label keeps the room between its lines under each line, the last too: moved down by half of it, the
        // words stand in the middle of their CSS line)
        var held = new Shifted { Shift = MathF.Round(lead / 2), SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        held.AddChild(l);
        Add(Margin(held, top, bottom), into);
        return l;
    }

    /// <summary>CSS "line-height: normal" of the game's faces: what the browser gives a line of the hand and of the print.</summary>
    public static float NormalLine(Font f)
    {
        Font b = f is FontVariation { BaseFont: { } inner } ? inner : f;
        return b == Fonts.Hand || b == Fonts.HandBold ? 1.59f : b == PaperFonts.Mono ? 1.13f : 1.2f;
    }

    /// <summary>Wrap a control in CSS margins (top, bottom; left, right).</summary>
    public Control Margin(Control c, float top, float bottom, float left = 0, float right = 0)
    {
        if (top == 0 && bottom == 0 && left == 0 && right == 0) return c;
        var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore, SizeFlagsHorizontal = c.SizeFlagsHorizontal };
        m.AddThemeConstantOverride("margin_top", Sp(top));
        m.AddThemeConstantOverride("margin_bottom", Sp(bottom));
        m.AddThemeConstantOverride("margin_left", Sp(left));
        m.AddThemeConstantOverride("margin_right", Sp(right));
        m.AddChild(c);
        return m;
    }

    public void Add(Control c, Container? into = null) => (into ?? Body).AddChild(c);

    /// <summary>Empty room, CSS px high.</summary>
    public void Gap(float css, Container? into = null) => Add(new Control { CustomMinimumSize = new Vector2(0, Sp(css)), MouseFilter = Control.MouseFilterEnum.Ignore }, into);

    /// <summary>A rule across the paper: dashed (the lists' "border-top"), solid or double.</summary>
    public Dashes Rule(float top = 0, float bottom = 0, float alpha = 0.35f, bool solid = false, bool dbl = false, float thick = 1, Container? into = null)
    {
        float t = Math.Max(1, MathF.Round(thick * space * (dbl ? 0.34f : 1)));
        var d = new Dashes { Colour = new Color(Ink, alpha), Thick = t, Dash = Math.Max(2, Sp(2.5f)), Solid = solid, Double = dbl, CustomMinimumSize = new Vector2(0, dbl ? t * 3 : t) };
        Add(Margin(d, top, bottom), into);
        return d;
    }

    // ------------------------------------------------------------------ lines to click

    /// <summary>
    /// A line of a list with its number badge ("<li><span class="n">2</span> ..."): the key 2, and a click does the
    /// same. right: what stands at the line's end (a price). The text is BBCode.
    /// </summary>
    public InkClick Row(int n, string bb, string right = "", Face face = Face.Print, float size = 15, float padY = 3, float gap = 6, bool rule = false, Container? into = null, bool click = true, string under = "", float lineHeight = 0, bool boldN = true, bool centre = false, Control? icon = null, float rightSize = 0, bool rightBold = true, float rightOpacity = 1, float width = 0)
    {
        var row = new InkClick { Code = click && n is >= 1 and <= 9 ? $"Digit{n}" : "", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        if (!click || n < 1 || n > 9)
        {
            row.MouseFilter = Control.MouseFilterEnum.Ignore;
            row.MouseDefaultCursorShape = Control.CursorShape.Arrow;
        }
        var col = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        col.AddThemeConstantOverride("separation", 0);
        if (rule) Rule(into: col);
        Font bold = face == Face.Hand ? PaperFonts.HandBold : PaperFonts.PrintBold;
        Font plain = face == Face.Hand ? PaperFonts.Hand : PaperFonts.Print;
        float rowW = width > 0 ? width : inner;
        if (centre)
        {
            // the browser's centred line: the badge, a gap, the words, all in the middle
            string badge = boldN ? $"[b]{n}[/b]" : n.ToString();
            var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
            m.AddThemeConstantOverride("margin_top", Sp(padY));
            m.AddThemeConstantOverride("margin_bottom", Sp(padY));
            Text($"{badge}  {bb}", face, size, into: m, lineHeight: lineHeight, align: HorizontalAlignment.Center, width: rowW);
            col.AddChild(m);
        }
        else
        {
            var line = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
            line.AddThemeConstantOverride("separation", Sp(gap));
            var badge = Plain(n.ToString(), boldN ? bold : plain, size, lineHeight: lineHeight);
            badge.SizeFlagsVertical = Control.SizeFlags.ShrinkBegin;
            line.AddChild(badge);
            float wordsW = rowW - MathF.Ceiling(badge.GetMinimumSize().X) - Sp(gap);
            if (icon != null)
            {
                icon.SizeFlagsVertical = Control.SizeFlags.ShrinkCenter;
                line.AddChild(icon);
                wordsW -= MathF.Ceiling(icon.GetCombinedMinimumSize().X) + Sp(gap);
            }
            Label? price = null;
            if (right != "")
            {
                price = Plain(right, rightBold ? bold : plain, rightSize > 0 ? rightSize : size, rightOpacity, lineHeight: (lineHeight > 0 ? lineHeight : NormalLine(plain)) * size / (rightSize > 0 ? rightSize : size));
                price.SizeFlagsVertical = Control.SizeFlags.ShrinkBegin;
                wordsW -= MathF.Ceiling(price.GetMinimumSize().X) + Sp(gap);
            }
            var words = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, SizeFlagsVertical = Control.SizeFlags.ShrinkCenter };
            words.AddThemeConstantOverride("separation", 0);
            Text(bb, face, size, into: words, lineHeight: lineHeight, width: wordsW - 1);
            if (under != "") Text(under, face, size * 0.78f, opacity: 0.75f, into: words, width: wordsW - 1);
            line.AddChild(words);
            if (price != null) line.AddChild(price);
            col.AddChild(Margin(line, padY, padY));
        }
        row.AddChild(col);
        Add(row, into);
        return row;
    }

    /// <summary>A plain label of one line (a badge, a price).</summary>
    public Label Plain(string text, Font font, float size, float opacity = 1, Color? colour = null, float lineHeight = 0)
    {
        int px = Math.Max(1, Px(size));
        return new Label
        {
            Text = text,
            LabelSettings = new LabelSettings { Font = font, FontSize = px, FontColor = new Color(colour ?? Ink, opacity) },
            MouseFilter = Control.MouseFilterEnum.Ignore,
            // the CSS line box, the words in its middle
            VerticalAlignment = VerticalAlignment.Center,
            CustomMinimumSize = new Vector2(0, MathF.Round((lineHeight > 0 ? lineHeight : NormalLine(font)) * px)),
        };
    }

    /// <summary>
    /// The keys line ("1-3  answer · T  say it your way · E  step away"): its parts split at the dots; a part that
    /// starts with a key can be clicked and sends that key (game/cursor.ts splitText). A line that names no key is
    /// plain text (a note shown in the keys' place).
    /// </summary>
    public Control Keys(string line, Face face = Face.Print, float size = 14, float opacity = 0.9f, float top = 4, float bottom = 4, HorizontalAlignment align = HorizontalAlignment.Right, Container? into = null, float lineHeight = 0)
    {
        Font font = face == Face.Hand ? PaperFonts.Hand : PaperFonts.Print;
        var parts = line.Split('·');
        bool any = false;
        foreach (string p in parts) any |= KeyRe.IsMatch(p.Trim());
        if (!any)
        {
            // the browser keeps the paragraph's room when it is empty
            return Text(Css.Esc(line == "" ? " " : Regex.Replace(line, @"\s+", " ")), face, size, opacity, top: top, bottom: bottom, align: align, into: into, lineHeight: lineHeight);
        }
        var flow = new HFlowContainer { MouseFilter = Control.MouseFilterEnum.Ignore, Alignment = align == HorizontalAlignment.Right ? FlowContainer.AlignmentMode.End : align == HorizontalAlignment.Center ? FlowContainer.AlignmentMode.Center : FlowContainer.AlignmentMode.Begin, Modulate = new Color(1, 1, 1, opacity) };
        flow.AddThemeConstantOverride("h_separation", 0);
        flow.AddThemeConstantOverride("v_separation", 0);
        for (int i = 0; i < parts.Length; i++)
        {
            string body = parts[i].Trim();
            if (i > 0) flow.AddChild(Plain(" · ", font, size, lineHeight: lineHeight));
            var m = KeyRe.Match(body);
            // the key's name as the player's keyboard has it (menu/keys.ts puts the bound key's name into the hints)
            if (m.Success && m.Groups[1].Value.Length == 1 && char.IsLetter(m.Groups[1].Value[0])) body = Dialogs.Label(CodeOf(m.Groups[1].Value)) + body[1..];
            // (HTML shows a run of spaces as one)
            var word = Plain(Regex.Replace(body, @"\s+", " "), font, size, lineHeight: lineHeight);
            if (m.Success)
            {
                var click = new InkClick { Code = CodeOf(m.Groups[1].Value) };
                word.LabelSettings.FontColor = Ink;
                click.AddChild(word);
                // the dotted line under a key that can be clicked
                var dots = new Dashes { Colour = new Color(Ink, 0.5f), Thick = Math.Max(1, MathF.Round(S * 0.7f)), Dash = Math.Max(1, Px(1.2f)), CustomMinimumSize = new Vector2(0, 1), SizeFlagsVertical = Control.SizeFlags.ShrinkEnd };
                click.AddChild(dots);
                flow.AddChild(click);
            }
            else flow.AddChild(word);
        }
        Add(Margin(flow, top, bottom), into);
        return flow;
    }

    /// <summary>game/cursor.ts codeOf: the key's name on the paper to the code a dialog reads.</summary>
    public static string CodeOf(string k) => k == "Esc" ? "Escape" : k == "Enter" ? "Enter" : k.Length == 1 && char.IsDigit(k[0]) ? $"Digit{k}" : $"Key{k}";

    /// <summary>Take everything off the paper (before it is written again).</summary>
    public void Clear()
    {
        foreach (var c in Body.GetChildren())
        {
            Body.RemoveChild(c);
            c.QueueFree();
        }
    }
}
