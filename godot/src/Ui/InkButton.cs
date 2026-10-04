using System;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Ui;

/// <summary>
/// Every button of the papers, drawn in ink (menu.css): pick its Look, give it its words, listen to Pressed.
///
///   var b = new InkButton(InkButton.Look.Primary, "Done") { Kbd = "Esc" };
///   b.Pressed += Close;
///
/// The mouse and the keys work it alike: Enter or Space presses the focused one. A button that is "on" (a chosen
/// tab, the chosen one of a row of choices) has `On = true`.
/// </summary>
public partial class InkButton : BaseButton
{
    public enum Look
    {
        /// <summary>.btn: ink border, light wash, small caps.</summary>
        Btn,
        /// <summary>.btn.primary: inked in.</summary>
        Primary,
        /// <summary>.seg button: one of a row of choices (Seg makes them).</summary>
        Seg,
        /// <summary>.tab: a ledger tab along the top of a sheet.</summary>
        Tab,
        /// <summary>.menu-item: a line of the title handbill; the printer's hand points at it.</summary>
        MenuItem,
        /// <summary>.menu-item[data-go=play]: the way into the game, in the slab.</summary>
        MenuPlay,
        /// <summary>.keycap: a typewriter's key (Controls).</summary>
        KeyCap,
        /// <summary>.chip: a small round label to pick.</summary>
        Chip,
        /// <summary>.mode-card: a boxed choice with a title and a line under it.</summary>
        ModeCard,
        /// <summary>.sw: a colour to pick.</summary>
        Swatch,
        /// <summary>A plain button on the old paper (the save list).</summary>
        Plain,
    }

    public Look Kind { get; }
    private string text;
    public string Label
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
    private string sub = "";
    /// <summary>A second, smaller line under the words (a menu item's note, a mode card's text).</summary>
    public string Sub
    {
        get => sub;
        set
        {
            sub = value;
            UpdateMinimumSize();
            QueueRedraw();
        }
    }
    /// <summary>A key shown after the words ("Esc").</summary>
    public string Kbd { get; set; } = "";
    public bool Small { get; set; }
    private bool on;
    public bool On
    {
        get => on;
        set
        {
            on = value;
            QueueRedraw();
        }
    }
    /// <summary>The first of a row of choices (no line on its left).</summary>
    public bool First { get; set; }
    /// <summary>KeyCap: another key than the default; waiting for the new key.</summary>
    public bool Changed { get; set; }
    public bool Waiting { get; set; }
    /// <summary>Swatch: its colour.</summary>
    public Color Colour { get; set; } = Colors.White;
    /// <summary>MenuItem: a dotted line over it (Quit); Dev: the small mono line.</summary>
    public bool RuleAbove { get; set; }
    public bool Dev { get; set; }
    /// <summary>The least width, CSS px.</summary>
    public float MinWidth { get; set; }
    /// <summary>ModeCard: the width its text wraps at, CSS px.</summary>
    public float WrapWidth { get; set; } = 320;

    public InkButton() : this(Look.Btn, "")
    {
    }

    public InkButton(Look kind, string label, Action? pressed = null)
    {
        Kind = kind;
        text = label;
        FocusMode = FocusModeEnum.All;
        MouseDefaultCursorShape = CursorShape.PointingHand;
        if (pressed != null) Pressed += pressed;
        MouseEntered += QueueRedraw;
        MouseExited += QueueRedraw;
        FocusEntered += QueueRedraw;
        FocusExited += QueueRedraw;
        ButtonDown += QueueRedraw;
        ButtonUp += QueueRedraw;
    }

    private bool Ring => HasFocus() && Kit.KeyFocus;
    private Font Face => Kind switch
    {
        Look.MenuPlay => Fonts.Slab,
        Look.KeyCap => Fonts.MonoBold,
        Look.MenuItem when Dev => Fonts.Mono,
        _ => Fonts.Print,
    };
    private float CssSize => Kind switch
    {
        Look.Btn or Look.Primary => Small ? 14 : 16,
        Look.Seg => Small ? 13 : 15,
        Look.Tab => 17,
        Look.MenuItem => Dev ? 13 : Short ? 18 : 20,
        Look.MenuPlay => Short ? 22 : 25,
        Look.KeyCap => 15,
        Look.Chip => 13,
        Look.ModeCard => 19,
        _ => 15,
    };
    private bool Caps => Kind is Look.Btn or Look.Primary or Look.Tab || (Kind == Look.MenuItem && !Dev);
    private float SpacingEm => Kind switch
    {
        Look.Btn or Look.Primary or Look.Tab or Look.MenuPlay => 0.05f,
        Look.MenuItem => Dev ? 0 : 0.06f,
        Look.ModeCard => 0.04f,
        _ => 0,
    };
    /// <summary>A short window (menu.css max-height 800): tighter lines on the handbill.</summary>
    private static bool Short => (Main.I?.GetViewport().GetVisibleRect().Size.Y ?? 900) <= 800;

    private Vector2 Padding => Kind switch
    {
        Look.Btn or Look.Primary => Small ? new Vector2(11, 3) : new Vector2(16, 5),
        Look.Seg => Small ? new Vector2(8, 2) : new Vector2(12, 4),
        Look.Tab => new Vector2(16, 5.5f),
        Look.MenuItem => new Vector2(34, Dev ? 2 : Short ? 2 : 3),
        Look.MenuPlay => new Vector2(34, 5),
        Look.KeyCap => new Vector2(12, 3),
        Look.Chip => new Vector2(9, 2),
        Look.ModeCard => new Vector2(14, 10),
        Look.Plain => new Vector2(14, 3),
        _ => Vector2.Zero,
    };

    /// <summary>The CSS line-height of the words, in em.</summary>
    private float LineEm => Kind switch
    {
        Look.MenuItem => Dev ? 1.4f : 1.25f,
        Look.KeyCap => 1.3f,
        Look.Chip or Look.Plain => 1.3f,
        _ => 1.2f,
    };

    private string Shown => Kind == Look.MenuPlay ? text.ToUpperInvariant() : text;

    private Vector2 WordsSize()
    {
        int fs = Kit.Px(CssSize);
        int sp = Mathf.RoundToInt(fs * SpacingEm);
        if (Caps) return Kit.CapsSize(Face, Shown, fs, sp);
        var f = Kind == Look.ModeCard ? Fonts.Slab : Face;
        var s = f.GetStringSize(Shown, HorizontalAlignment.Left, -1, fs);
        return new Vector2(s.X + sp * Shown.Length, f.GetHeight(fs));
    }

    private Vector2 KbdSize()
    {
        if (Kbd == "") return Vector2.Zero;
        int fs = Kit.Px(CssSize * 0.72f);
        var s = Fonts.MonoBold.GetStringSize(Kbd, HorizontalAlignment.Left, -1, fs);
        return new Vector2(s.X + Kit.Px(8) + Kit.Px(6), Fonts.MonoBold.GetHeight(fs) + Kit.Px(2));
    }

    public override Vector2 _GetMinimumSize()
    {
        if (Kind == Look.Swatch) return new Vector2(Kit.Px(22), Kit.Px(22));
        var pad = Padding * Kit.Scale;
        var w = WordsSize();
        if (Kind == Look.ModeCard)
        {
            float wrap = Kit.Px(WrapWidth);
            float h = w.Y + Kit.Px(4);
            if (sub != "") h += Fonts.Print.GetMultilineStringSize(sub, HorizontalAlignment.Left, wrap, Kit.Px(14)).Y;
            return new Vector2(wrap + pad.X * 2, h + pad.Y * 2);
        }
        float width = w.X + KbdSize().X + pad.X * 2;
        float height = Kit.Pxf(CssSize * LineEm) + pad.Y * 2;
        if (Kind == Look.KeyCap) height += Kit.Pxf(4.5f);
        if (Kind is Look.Btn or Look.Primary) height += Kit.Pxf(3);
        if (Kind is Look.MenuItem or Look.MenuPlay)
        {
            if (sub != "") height += Kit.Pxf(13 * 1.2f);
            if (RuleAbove) height += Kit.Px(8);
        }
        return new Vector2(Math.Max(width, Kit.Px(MinWidth)), height);
    }

    public override void _Draw()
    {
        var r = new Rect2(Vector2.Zero, Size);
        bool hover = IsHovered() && !Disabled;
        bool down = ButtonPressed || (hover && Input.IsMouseButtonPressed(MouseButton.Left));
        int fs = Kit.Px(CssSize);
        int sp = Mathf.RoundToInt(fs * SpacingEm);
        float line = Math.Max(1, Kit.Pxf(1.5f));
        var ink = Kit.Ink;
        Color fg = ink;
        switch (Kind)
        {
            case Look.Btn:
                Fill(r, Kit.Wash(hover ? 0.65f : 0.3f), ink, line, 2);
                break;
            case Look.Primary:
                Fill(r, hover ? new Color("3a2c20") : ink, ink, line, 2);
                fg = Kit.PaperHi;
                break;
            case Look.Plain:
                Fill(r, hover ? new Color("fbf6e9") : new Color("f6eedb"), new Color("8a7d66"), Math.Max(1, Kit.Pxf(1)), 3);
                break;
            case Look.Seg:
                DrawRect(r, on ? ink : Kit.Wash(hover ? 0.65f : 0.25f));
                if (!First) DrawLine(new Vector2(0, 0), new Vector2(0, Size.Y), on ? ink : Kit.InkFaint, Math.Max(1, Kit.Px(1)));
                fg = on ? Kit.PaperHi : ink;
                break;
            case Look.Tab:
                fg = on || hover ? ink : Kit.InkSoft;
                if (on)
                {
                    var box = new StyleBoxFlat { BgColor = Kit.PaperHi, BorderColor = ink, AntiAliasing = true, CornerRadiusTopLeft = Kit.Px(5), CornerRadiusTopRight = Kit.Px(5) };
                    int bw = Math.Max(1, Mathf.RoundToInt(line));
                    box.BorderWidthLeft = box.BorderWidthRight = box.BorderWidthTop = bw;
                    DrawStyleBox(box, new Rect2(0, 0, Size.X, Size.Y + bw));
                }
                else if (hover) DrawRect(r, Kit.Wash(0.25f));
                if (Ring)
                {
                    fg = Kit.Rust;
                    DrawRect(new Rect2(0, Size.Y - Kit.Px(3), Size.X, Kit.Px(3)), Kit.Rust);
                }
                break;
            case Look.MenuItem:
            case Look.MenuPlay:
                DrawMenuItem(hover);
                return;
            case Look.KeyCap:
            {
                var box = new StyleBoxFlat { BgColor = Waiting ? ink : hover ? new Color("f4eedc") : new Color("e5dcc3"), BorderColor = ink, AntiAliasing = true };
                box.SetCornerRadiusAll(Kit.Px(4));
                box.SetBorderWidthAll(Math.Max(1, Mathf.RoundToInt(line)));
                box.BorderWidthBottom = Kit.Px(3);
                DrawStyleBox(box, r);
                if (!Waiting && !hover) DrawRect(new Rect2(line, line, Size.X - 2 * line, Size.Y * 0.45f), new Color(0.945f, 0.918f, 0.84f, 0.6f));
                fg = Waiting ? Kit.PaperHi : Changed ? Kit.Rust : ink;
                if (Waiting) fg.A = 0.65f + 0.35f * MathF.Abs(MathF.Sin(Time.GetTicksMsec() / 1000f * MathF.PI));
                break;
            }
            case Look.Chip:
            {
                var box = new StyleBoxFlat { BgColor = on ? ink : hover ? Kit.Wash(0.5f) : Colors.Transparent, BorderColor = on ? ink : Kit.InkFaint, AntiAliasing = true };
                box.SetCornerRadiusAll(Kit.Px(10));
                box.SetBorderWidthAll(Math.Max(1, Kit.Px(1)));
                DrawStyleBox(box, r);
                fg = on ? Kit.PaperHi : ink;
                break;
            }
            case Look.ModeCard:
                DrawModeCard(hover);
                return;
            case Look.Swatch:
            {
                var box = new StyleBoxFlat { BgColor = Colour, BorderColor = new Color(0.133f, 0.106f, 0.082f, 0.55f), AntiAliasing = true };
                box.SetCornerRadiusAll(Kit.Px(2));
                box.SetBorderWidthAll(Math.Max(1, Mathf.RoundToInt(line)));
                DrawStyleBox(box, r);
                if (on || Ring) Outline(r, Kit.Rust);
                return;
            }
        }
        // the words in the middle, the key after them
        var w = WordsSize();
        var k = KbdSize();
        float x = (Size.X - w.X - k.X) / 2, y = (Size.Y - w.Y) / 2 + (down && Kind != Look.Tab ? 1 : 0);
        if (Kind == Look.KeyCap) y -= Kit.Px(1);
        if (Caps) Kit.DrawCaps(this, Face, new Vector2(x, y), Shown, fs, fg, sp);
        else DrawString(Face, new Vector2(x, y + Face.GetAscent(fs)), Shown, HorizontalAlignment.Left, -1, fs, fg);
        if (Kbd != "")
        {
            int kfs = Kit.Px(CssSize * 0.72f);
            var kr = new Rect2(x + w.X + Kit.Px(6), (Size.Y - k.Y) / 2, k.X - Kit.Px(6), k.Y);
            var box = new StyleBoxFlat { BgColor = Colors.Transparent, BorderColor = fg, AntiAliasing = true };
            box.SetCornerRadiusAll(Kit.Px(3));
            box.SetBorderWidthAll(Math.Max(1, Kit.Px(1)));
            box.BorderWidthBottom = Math.Max(1, Kit.Px(2));
            DrawStyleBox(box, kr);
            DrawString(Fonts.MonoBold, new Vector2(kr.Position.X + Kit.Px(4), kr.Position.Y + Kit.Px(1) + Fonts.MonoBold.GetAscent(kfs)), Kbd, HorizontalAlignment.Left, -1, kfs, fg);
        }
        if (Ring && Kind is Look.Btn or Look.Primary or Look.Seg or Look.KeyCap or Look.Chip or Look.Plain && HasFocus() && Kit.KeyFocus) Outline(r, Kit.Rust);
    }

    public override void _Process(double delta)
    {
        if (Waiting) QueueRedraw();
    }

    private void Fill(Rect2 r, Color fill, Color border, float width, float radius)
    {
        var box = new StyleBoxFlat { BgColor = fill, BorderColor = border, AntiAliasing = true };
        box.SetCornerRadiusAll(Kit.Px(radius));
        box.SetBorderWidthAll(Math.Max(1, Mathf.RoundToInt(width)));
        DrawStyleBox(box, r);
    }

    /// <summary>The focus ring: 2 px of rust, 2 px off the edge.</summary>
    private void Outline(Rect2 r, Color c)
    {
        float o = Kit.Px(2), w = Math.Max(1, Kit.Px(2));
        DrawRect(new Rect2(r.Position - new Vector2(o + w / 2, o + w / 2), r.Size + new Vector2(2 * o + w, 2 * o + w)), c, false, w);
    }

    private void DrawMenuItem(bool hover)
    {
        bool hot = hover || Ring;
        var fg = hot ? Kit.Rust : Kit.Ink;
        if (Dev) fg.A = 0.6f;
        float top = 0;
        if (RuleAbove)
        {
            DrawDashedLine(new Vector2(0, Kit.Px(4)), new Vector2(Size.X, Kit.Px(4)), Kit.InkFaint, Math.Max(1, Kit.Px(1)), Math.Max(1, Kit.Px(1)) * 2);
            top = Kit.Px(8);
        }
        if (Ring) DrawRect(new Rect2(0, top, Size.X, Size.Y - top), Kit.RustSoft);
        int fs = Kit.Px(CssSize);
        int sp = Mathf.RoundToInt(fs * SpacingEm);
        var w = WordsSize();
        float subH = sub != "" ? Kit.Pxf(13 * 1.2f) : 0;
        float y = top + (Size.Y - top - w.Y - subH) / 2;
        float x = (Size.X - w.X) / 2;
        if (Caps) Kit.DrawCaps(this, Face, new Vector2(x, y), Shown, fs, fg, sp);
        else if (sp == 0) DrawString(Face, new Vector2(x, y + Face.GetAscent(fs)), Shown, HorizontalAlignment.Left, -1, fs, fg);
        else
        {
            // the slab with its letter-spacing; a thin second print as the CSS text-shadow
            var f = Kit.Spaced(Face, CssSize, SpacingEm);
            DrawString(f, new Vector2(x, y + Face.GetAscent(fs)), Shown, HorizontalAlignment.Left, -1, fs, fg);
        }
        if (sub != "")
        {
            int sfs = Kit.Px(13);
            var ss = Fonts.PrintItalic.GetStringSize(sub, HorizontalAlignment.Left, -1, sfs);
            DrawString(Fonts.PrintItalic, new Vector2((Size.X - ss.X) / 2, y + w.Y * 0.92f + Fonts.PrintItalic.GetAscent(sfs)), sub, HorizontalAlignment.Left, -1, sfs, hot ? Kit.Rust : Kit.InkSoft);
        }
        if (!hot) return;
        // the printer's hand, left and right
        int hs = Kit.Px(22);
        var hand = Kit.Symbols;
        float hy = top + (Size.Y - top) / 2 + hand.GetAscent(hs) * 0.36f;
        DrawString(hand, new Vector2(Kit.Px(8), hy), "☞", HorizontalAlignment.Left, -1, hs, Kit.Rust);
        float hw = hand.GetStringSize("☜", HorizontalAlignment.Left, -1, hs).X;
        DrawString(hand, new Vector2(Size.X - Kit.Px(8) - hw, hy), "☜", HorizontalAlignment.Left, -1, hs, Kit.Rust);
    }

    private void DrawModeCard(bool hover)
    {
        var r = new Rect2(Vector2.Zero, Size);
        Fill(r, Kit.Wash(on ? 0.7f : hover ? 0.55f : 0.25f), on ? Kit.Ink : Kit.InkFaint, Kit.Pxf(on ? 2.5f : 1.5f), 2);
        var pad = Padding * Kit.Scale;
        int fs = Kit.Px(Small ? 16 : 19);
        var title = Small ? Fonts.PrintBold : Kit.Spaced(Fonts.Slab, 19, 0.04f);
        float x = pad.X, y = pad.Y;
        if (on)
        {
            DrawString(Fonts.PrintBold, new Vector2(x, y + title.GetAscent(fs)), "✓", HorizontalAlignment.Left, -1, fs, Kit.Good);
            x += Fonts.PrintBold.GetStringSize("✓  ", HorizontalAlignment.Left, -1, fs).X;
        }
        DrawString(title, new Vector2(x, y + title.GetAscent(fs)), text, HorizontalAlignment.Left, -1, fs, Kit.Ink);
        y += title.GetHeight(fs) + Kit.Px(4);
        if (sub != "") DrawMultilineString(Fonts.Print, new Vector2(pad.X, y + Fonts.Print.GetAscent(Kit.Px(14))), sub, HorizontalAlignment.Left, Size.X - pad.X * 2, Kit.Px(14), -1, Kit.Ink);
        if (Ring) Outline(r, Kit.Rust);
    }
}

/// <summary>
/// A row of choices set like a printer's list, the chosen one inked in (the CSS .seg). Left and Right move the
/// choice when one of them has the focus.
///
///   var seg = new Seg(new[] { ("low", "Low"), ("high", "High") }, "high", v => ...);
/// </summary>
public partial class Seg : HBoxContainer
{
    private readonly (string id, string label)[] opts;
    private readonly Action<string> changed;
    public string Value { get; private set; }

    public Seg((string id, string label)[] options, string now, Action<string> onChange, bool small = false)
    {
        opts = options;
        changed = onChange;
        Value = now;
        AddThemeConstantOverride("separation", 0);
        for (int i = 0; i < opts.Length; i++)
        {
            string id = opts[i].id;
            var b = new InkButton(InkButton.Look.Seg, opts[i].label) { Small = small, First = i == 0, On = id == now };
            b.Pressed += () => Pick(id);
            AddChild(b);
        }
    }

    public void Pick(string id)
    {
        if (id == Value) return;
        Value = id;
        for (int i = 0; i < opts.Length; i++) ((InkButton)GetChild(i)).On = opts[i].id == id;
        changed(id);
    }

    /// <summary>Left or Right on the focused choice: the one beside it. True when the key was ours.</summary>
    public bool Step(int dir)
    {
        int i = Array.FindIndex(opts, o => o.id == Value);
        var focus = GetViewport().GuiGetFocusOwner();
        for (int k = 0; k < GetChildCount(); k++)
            if (GetChild(k) == focus)
                i = k;
        int n = Math.Clamp(i + dir, 0, opts.Length - 1);
        ((Control)GetChild(n)).GrabFocus();
        Pick(opts[n].id);
        return true;
    }

    public override void _Draw()
    {
        // the frame round the row
        float w = Math.Max(1, Kit.Pxf(1.5f));
        DrawRect(new Rect2(-w / 2, -w / 2, Size.X + w, Size.Y + w), Kit.Ink, false, w);
    }
}
