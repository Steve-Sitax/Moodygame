using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Ui;

/// <summary>
/// The paper-and-ink kit every screen is built from (the browser's menu/menu.css): the colours, the scale, and the
/// makers of the small parts (a line of text, a row with its control, a heading, the printer's rule). The parts
/// themselves are in this folder: PaperCard (the paper), InkButton (every kind of button), Tick, InkSlider,
/// Select, Sheet (a paper with a head, a scrolling body and a foot), Dialogs (the stack Esc closes), InkCursor.
///
/// Sizes are the browser's CSS pixels: `Kit.Px(16)` is 16 CSS px at the window's scale (the CSS --ui: 1.3, more on
/// a wide window, less on a short one, times the Text size setting). A screen builds itself in real pixels and
/// builds again when `Kit.LookChanged` fires (the window's scale, the text size, high contrast).
/// </summary>
public static class Kit
{
    // menu.css :root
    public static Color Paper { get; private set; } = new("ddd3b9");
    public static Color Paper2 { get; private set; } = new("d2c6a6");
    public static Color PaperHi { get; private set; } = new("e9e1cb");
    public static Color Ink { get; private set; } = new("221b15");
    public static Color InkSoft { get; private set; } = new("54463a");
    public static Color InkFaint { get; private set; } = new(0.133f, 0.106f, 0.082f, 0.28f);
    public static readonly Color Rust = new("7d2a18");
    public static readonly Color RustSoft = new(0.49f, 0.165f, 0.094f, 0.12f);
    public static readonly Color Good = new("2f5a2a");
    public static readonly Color Bad = new("8a1c10");
    /// <summary>rgba(255, 250, 235, a): the light wash on buttons and boxes.</summary>
    public static Color Wash(float a) => new(1f, 0.98f, 0.922f, a);

    /// <summary>Accessibility: all text times this (the CSS --text).</summary>
    public static float TextSize { get; private set; } = 1;
    /// <summary>Accessibility: white paper, black ink, no sepia, no grain.</summary>
    public static bool HiContrast { get; private set; }
    /// <summary>Accessibility: nothing fades, slides or turns.</summary>
    public static bool Calm { get; private set; }
    /// <summary>The last thing the player used was the keyboard: the focused control shows its ring (CSS :focus-visible).</summary>
    public static bool KeyFocus { get; set; }

    /// <summary>The scale, the text size or the contrast changed: a screen on show builds again.</summary>
    public static event Action? LookChanged;

    private static float scale = 1.5f;
    /// <summary>The CSS --ui at this window (menu.css): CSS px times this are real px.</summary>
    public static float Scale => scale;
    public static int Px(float css) => Mathf.RoundToInt(css * scale);
    public static float Pxf(float css) => css * scale;

    /// <summary>menu.css: --ui by the window's width, less on a short window, times the text size.</summary>
    public static float ScaleFor(Vector2 win, float text)
    {
        float s = win.X >= 3000 ? 2.2f : win.X >= 2200 ? 1.8f : win.X >= 1600 ? 1.5f : 1.3f;
        if (win.Y <= 800) s = win.X >= 1600 ? 1.2f : 1.1f;
        return s * text;
    }

    /// <summary>The window changed size: the scale follows. True when it changed (LookChanged has fired).</summary>
    public static bool Fit(Vector2 win)
    {
        float s = ScaleFor(win, TextSize);
        if (Math.Abs(s - scale) < 0.005f) return false;
        scale = s;
        LookChanged?.Invoke();
        return true;
    }

    /// <summary>The Accessibility settings (menu/apply.ts applyPage).</summary>
    public static void SetLook(Vector2 win, float textSize, bool hiContrast, bool calm)
    {
        bool changed = Math.Abs(textSize - TextSize) > 0.001f || hiContrast != HiContrast || calm != Calm;
        TextSize = textSize;
        Calm = calm;
        if (hiContrast != HiContrast)
        {
            HiContrast = hiContrast;
            // menu.css html.hi-contrast
            Paper = new Color(hiContrast ? "fbf8ef" : "ddd3b9");
            Paper2 = new Color(hiContrast ? "f3eee0" : "d2c6a6");
            PaperHi = new Color(hiContrast ? "ffffff" : "e9e1cb");
            Ink = new Color(hiContrast ? "000000" : "221b15");
            InkSoft = new Color(hiContrast ? "222222" : "54463a");
            InkFaint = hiContrast ? new Color(0, 0, 0, 0.55f) : new Color(0.133f, 0.106f, 0.082f, 0.28f);
        }
        scale = ScaleFor(win, TextSize);
        if (changed) LookChanged?.Invoke();
    }

    // ------------------------------------------------------------------ text

    /// <summary>A line of text (a Label): font, CSS size, colour. `wrap`: it breaks at its width.</summary>
    public static Label Text(string text, Font font, float size, Color? colour = null, bool wrap = false, float spacingEm = 0)
    {
        var l = new Label
        {
            Text = text,
            LabelSettings = new LabelSettings { Font = spacingEm != 0 ? Spaced(font, size, spacingEm) : font, FontSize = Px(size), FontColor = colour ?? Ink },
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        if (wrap)
        {
            l.AutowrapMode = TextServer.AutowrapMode.WordSmart;
            l.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        }
        return l;
    }

    /// <summary>
    /// Text with marks in it: [b], [i], [color], [font] ... (BBCode), in the print face unless told. Use it for a
    /// paragraph with a bold word or a key; `Kbd("E")` gives the mark-up of a key.
    /// </summary>
    public static RichTextLabel Rich(string bbcode, float size = 16, Color? colour = null, Font? font = null)
    {
        var r = new RichTextLabel
        {
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            MouseFilter = Control.MouseFilterEnum.Ignore,
            Text = bbcode,
        };
        r.AddThemeFontOverride("normal_font", font ?? Fonts.Print);
        r.AddThemeFontOverride("bold_font", font == Fonts.Hand ? Fonts.HandBold : Fonts.PrintBold);
        r.AddThemeFontOverride("italics_font", Fonts.PrintItalic);
        r.AddThemeFontOverride("mono_font", Fonts.MonoBold);
        foreach (string k in new[] { "normal_font_size", "bold_font_size", "italics_font_size", "bold_italics_font_size" }) r.AddThemeFontSizeOverride(k, Px(size));
        r.AddThemeFontSizeOverride("mono_font_size", Px(size * 0.86f));
        r.AddThemeColorOverride("default_color", colour ?? Ink);
        r.AddThemeConstantOverride("line_separation", Px(size * 0.22f));
        return r;
    }

    /// <summary>The mark-up of a key inside Rich text (the CSS kbd: a mono letter on a light box).</summary>
    public static string Kbd(string key) => $"[bgcolor=#fffaeb80][code] {Esc(key)} [/code][/bgcolor]";

    /// <summary>A text made safe for Rich (no mark-up of its own).</summary>
    public static string Esc(string s) => s.Replace("[", "[lb]");

    private static readonly Dictionary<(Font, int), FontVariation> spaced = new();
    /// <summary>A font with the CSS letter-spacing (in em) at this CSS size.</summary>
    public static Font Spaced(Font font, float size, float em)
    {
        int extra = Mathf.RoundToInt(Pxf(size) * em);
        if (extra == 0) return font;
        if (spaced.TryGetValue((font, extra), out var v)) return v;
        v = new FontVariation { BaseFont = font, SpacingGlyph = extra };
        spaced[(font, extra)] = v;
        return v;
    }

    private static Font? symbols;
    /// <summary>The system's symbol face (the printer's hand that points at a menu item).</summary>
    public static Font Symbols => symbols ??= new SystemFont { FontNames = new[] { "Segoe UI Symbol", "DejaVu Sans", "Noto Sans Symbols2" } };

    // ------------------------------------------------------------------ small caps

    /// <summary>The size of a small capital against a capital (the browser makes them when the face has none).</summary>
    public const float SmallCap = 0.8f;

    /// <summary>The width and height of a line set in small caps.</summary>
    public static Vector2 CapsSize(Font font, string text, int size, int spacing = 0)
    {
        float w = 0;
        foreach (var (run, small) in CapsRuns(text))
        {
            int fs = small ? Mathf.RoundToInt(size * SmallCap) : size;
            w += font.GetStringSize(run, HorizontalAlignment.Left, -1, fs).X + spacing * run.Length;
        }
        return new Vector2(w, font.GetHeight(size));
    }

    /// <summary>Draw a line in small caps (CSS font-variant: small-caps): lower-case letters as smaller capitals. `at` is the top left.</summary>
    public static void DrawCaps(CanvasItem on, Font font, Vector2 at, string text, int size, Color colour, int spacing = 0)
    {
        float x = at.X, baseline = at.Y + font.GetAscent(size);
        foreach (var (run, small) in CapsRuns(text))
        {
            int fs = small ? Mathf.RoundToInt(size * SmallCap) : size;
            if (spacing == 0)
            {
                on.DrawString(font, new Vector2(x, baseline), run, HorizontalAlignment.Left, -1, fs, colour);
                x += font.GetStringSize(run, HorizontalAlignment.Left, -1, fs).X;
                continue;
            }
            foreach (char ch in run)
            {
                string c = ch.ToString();
                on.DrawString(font, new Vector2(x, baseline), c, HorizontalAlignment.Left, -1, fs, colour);
                x += font.GetStringSize(c, HorizontalAlignment.Left, -1, fs).X + spacing;
            }
        }
    }

    private static IEnumerable<(string run, bool small)> CapsRuns(string text)
    {
        int i = 0;
        while (i < text.Length)
        {
            bool small = char.IsLower(text[i]);
            int j = i;
            while (j < text.Length && char.IsLower(text[j]) == small) j++;
            string run = text[i..j];
            yield return (small ? run.ToUpperInvariant() : run, small);
            i = j;
        }
    }

    // ------------------------------------------------------------------ the parts of a sheet

    /// <summary>A heading inside a sheet (the CSS h3): small spaced capitals in rust, a thin line after.</summary>
    public static Control Heading(string text)
    {
        var box = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        box.AddThemeConstantOverride("separation", Px(10));
        box.AddChild(Text(text.ToUpperInvariant(), Fonts.Print, 13, Rust, false, 0.28f));
        var line = new Line { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, SizeFlagsVertical = Control.SizeFlags.ShrinkCenter, Colour = InkFaint, CustomMinimumSize = new Vector2(Px(20), Math.Max(1, Px(1))) };
        box.AddChild(line);
        var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        m.AddThemeConstantOverride("margin_top", Px(16));
        m.AddThemeConstantOverride("margin_bottom", Px(4));
        m.AddChild(box);
        return m;
    }

    /// <summary>
    /// A setting's row (the CSS .set-row): its name with a word on it under, the control on the right, a dotted
    /// line below.
    /// </summary>
    public static Control Row(string label, Control ctl, string note = "", float padY = 7, float labelSize = 17)
    {
        var row = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        row.AddThemeConstantOverride("separation", Px(18));
        var lbl = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, SizeFlagsVertical = Control.SizeFlags.ShrinkCenter, MouseFilter = Control.MouseFilterEnum.Ignore };
        lbl.AddThemeConstantOverride("separation", Px(2));
        lbl.AddChild(Text(label, Fonts.Print, labelSize, Ink, true));
        if (note != "") lbl.AddChild(Text(note, Fonts.PrintItalic, 13.5f, InkSoft, true));
        row.AddChild(lbl);
        ctl.SizeFlagsVertical = Control.SizeFlags.ShrinkCenter;
        ctl.SizeFlagsHorizontal = Control.SizeFlags.ShrinkEnd;
        row.AddChild(ctl);
        var m = new RowBox { Colour = InkFaint, MouseFilter = Control.MouseFilterEnum.Ignore };
        m.AddThemeConstantOverride("margin_top", Px(padY));
        m.AddThemeConstantOverride("margin_bottom", Px(padY));
        m.AddChild(row);
        return m;
    }

    /// <summary>Controls side by side (the CSS .ctl): right-aligned, 8 px between.</summary>
    public static HBoxContainer Side(params Control[] parts)
    {
        var h = new HBoxContainer { Alignment = BoxContainer.AlignmentMode.End, MouseFilter = Control.MouseFilterEnum.Ignore };
        h.AddThemeConstantOverride("separation", Px(8));
        foreach (var p in parts)
        {
            p.SizeFlagsVertical = Control.SizeFlags.ShrinkCenter;
            h.AddChild(p);
        }
        return h;
    }

    /// <summary>A paragraph in a sheet (the CSS .menu-sheet p; `fine`: the small italic note).</summary>
    public static Control Para(string text, float size = 16, bool fine = false, Color? colour = null)
    {
        var l = fine ? Text(text, Fonts.PrintItalic, 14, colour ?? InkSoft, true) : Text(text, Fonts.Print, size, colour ?? Ink, true);
        l.LabelSettings.LineSpacing = Px(size * 0.2f);
        var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        m.AddThemeConstantOverride("margin_top", Px(6));
        m.AddThemeConstantOverride("margin_bottom", Px(6));
        m.AddChild(l);
        return m;
    }

    /// <summary>A text box (the CSS input): ink border, light wash. `mono`: the typewriter face (keys, addresses).</summary>
    public static LineEdit Input(string text, float width, bool mono = false, bool secret = false, string placeholder = "", float size = 15, Font? font = null)
    {
        var e = new LineEdit { Text = text, PlaceholderText = placeholder, Secret = secret, CustomMinimumSize = new Vector2(Px(width), 0), CaretBlink = true, SelectAllOnFocus = false };
        e.AddThemeFontOverride("font", font ?? (mono ? Fonts.Mono : Fonts.Print));
        e.AddThemeFontSizeOverride("font_size", Px(mono ? size - 1 : size));
        e.AddThemeColorOverride("font_color", Ink);
        e.AddThemeColorOverride("caret_color", Ink);
        e.AddThemeColorOverride("font_placeholder_color", new Color(InkSoft, 0.7f));
        e.AddThemeColorOverride("selection_color", new Color(Rust, 0.3f));
        e.AddThemeColorOverride("font_selected_color", Ink);
        var box = Box(Wash(0.45f), Ink, 1.5f, 2, 8, 4);
        var focus = Box(Wash(0.6f), Rust, 2, 2, 8, 4);
        e.AddThemeStyleboxOverride("normal", box);
        e.AddThemeStyleboxOverride("focus", focus);
        e.AddThemeStyleboxOverride("read_only", box);
        return e;
    }

    /// <summary>A flat box: fill, border (CSS px), corner, padding (CSS px).</summary>
    public static StyleBoxFlat Box(Color fill, Color border, float borderPx, float radius, float padX, float padY)
    {
        var b = new StyleBoxFlat
        {
            BgColor = fill,
            BorderColor = border,
            ContentMarginLeft = Px(padX),
            ContentMarginRight = Px(padX),
            ContentMarginTop = Px(padY),
            ContentMarginBottom = Px(padY),
            AntiAliasing = true,
        };
        b.SetBorderWidthAll(borderPx <= 0 ? 0 : Math.Max(1, Mathf.RoundToInt(Pxf(borderPx))));
        b.SetCornerRadiusAll(Mathf.RoundToInt(Pxf(radius)));
        return b;
    }

    /// <summary>The printer's rule with its diamond (menu.ts RULE), `width` CSS px wide.</summary>
    public static Control Rule(float width, float opacity = 0.75f) => new Ornament { CustomMinimumSize = new Vector2(Px(width), Px(10)), SizeFlagsHorizontal = Control.SizeFlags.ShrinkCenter, Colour = new Color(Ink, opacity), MouseFilter = Control.MouseFilterEnum.Ignore };

    /// <summary>An empty stretch that takes the spare room in a box.</summary>
    public static Control Spring() => new Control { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, SizeFlagsVertical = Control.SizeFlags.ExpandFill, MouseFilter = Control.MouseFilterEnum.Ignore };

    /// <summary>A picture from the project's folder (res://ui/...), read as it lies when it was not imported.</summary>
    public static Texture2D? Picture(string resPath)
    {
        if (ResourceLoader.Exists(resPath) && GD.Load<Texture2D>(resPath) is { } t) return t;
        var img = new Image();
        if (img.Load(ProjectSettings.GlobalizePath(resPath)) != Error.Ok) return null;
        img.GenerateMipmaps();
        return ImageTexture.CreateFromImage(img);
    }
}

/// <summary>A thin straight line (a heading's rule, a foot's border).</summary>
public partial class Line : Control
{
    public Color Colour = Kit.InkFaint;
    public bool Dashed;
    public override void _Draw()
    {
        float y = Size.Y / 2;
        if (!Dashed) DrawLine(new Vector2(0, y), new Vector2(Size.X, y), Colour, Math.Max(1, Kit.Px(1)));
        else DrawDashedLine(new Vector2(0, y), new Vector2(Size.X, y), Colour, Math.Max(1, Kit.Px(1)), Kit.Px(4));
    }
}

/// <summary>A row's box: its content with a dotted line under it (the CSS .set-row border-bottom).</summary>
public partial class RowBox : MarginContainer
{
    public Color Colour = Kit.InkFaint;
    public override void _Draw()
    {
        float w = Math.Max(1, Kit.Px(1));
        DrawDashedLine(new Vector2(0, Size.Y - w / 2), new Vector2(Size.X, Size.Y - w / 2), Colour, w, w * 2);
    }
}

/// <summary>The printer's rule: two double lines and a diamond between two dots (menu.ts RULE, a 400 x 14 drawing).</summary>
public partial class Ornament : Control
{
    public Color Colour = Kit.Ink;
    /// <summary>The loading screen's rule (index.html): no dots, the lines closer to the diamond.</summary>
    public bool Plain;
    public override void _Draw()
    {
        float sx = Size.X / 400f, sy = Size.Y / 14f;
        float w = Math.Max(1, Kit.Pxf(0.7f));
        float gap = Plain ? 20 : 24;
        foreach (float y in new[] { 5.2f, 8.8f })
        {
            DrawLine(new Vector2(0, y * sy), new Vector2((200 - gap) * sx, y * sy), Colour, w, true);
            DrawLine(new Vector2((200 + gap) * sx, y * sy), new Vector2(400 * sx, y * sy), Colour, w, true);
        }
        // the diamond keeps its shape whatever the width
        float cx = 200 * sx, cy = 7 * sy, r = 5.5f * sy, rx = r * 1.27f;
        DrawColoredPolygon(new[] { new Vector2(cx, cy - r), new Vector2(cx + rx, cy), new Vector2(cx, cy + r), new Vector2(cx - rx, cy) }, Colour);
        if (Plain) return;
        DrawCircle(new Vector2(cx - 16 * sx, cy), 2 * sy, Colour, true, -1, true);
        DrawCircle(new Vector2(cx + 16 * sx, cy), 2 * sy, Colour, true, -1, true);
    }
}
