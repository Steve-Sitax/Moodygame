using System;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Ui;

/// <summary>
/// On and off: a box ticked in ink with its word beside it (the CSS .tog).
///
///   var t = new Tick(prefs.Wobble, on => ...);
/// </summary>
public partial class Tick : BaseButton
{
    private readonly Action<bool> changed;
    public bool Value { get; private set; }

    public Tick(bool now, Action<bool> onChange)
    {
        Value = now;
        changed = onChange;
        FocusMode = FocusModeEnum.All;
        MouseDefaultCursorShape = CursorShape.PointingHand;
        Pressed += () => Set(!Value);
        MouseEntered += QueueRedraw;
        MouseExited += QueueRedraw;
        FocusEntered += QueueRedraw;
        FocusExited += QueueRedraw;
    }

    public void Set(bool v)
    {
        if (v == Value) return;
        Value = v;
        QueueRedraw();
        changed(v);
    }

    public override Vector2 _GetMinimumSize()
    {
        float word = Fonts.Print.GetStringSize("Off", HorizontalAlignment.Left, -1, Kit.Px(15)).X;
        return new Vector2(Kit.Px(20) + Kit.Px(8) + Math.Max(word, Kit.Px(30)), Kit.Px(22));
    }

    public override void _Draw()
    {
        float b = Kit.Px(20), y = (Size.Y - b) / 2;
        var box = Kit.Box(Kit.Wash(0.35f), Kit.Ink, 1.5f, 2, 0, 0);
        var r = new Rect2(0, y, b, b);
        DrawStyleBox(box, r);
        if (Value)
        {
            // the tick: two strokes of the pen
            float w = Math.Max(2, Kit.Pxf(3));
            var a = new Vector2(b * 0.22f, y + b * 0.5f);
            var m = new Vector2(b * 0.42f, y + b * 0.72f);
            var c = new Vector2(b * 0.8f, y + b * 0.26f);
            DrawPolyline(new[] { a, m, c }, Kit.Ink, w, true);
        }
        int fs = Kit.Px(15);
        DrawString(Fonts.Print, new Vector2(b + Kit.Px(8), (Size.Y - Fonts.Print.GetHeight(fs)) / 2 + Fonts.Print.GetAscent(fs)), Value ? "On" : "Off", HorizontalAlignment.Left, -1, fs, Kit.InkSoft);
        if (HasFocus() && Kit.KeyFocus)
        {
            float o = Kit.Px(2), w = Kit.Px(2);
            DrawRect(new Rect2(r.Position - new Vector2(o + w / 2, o + w / 2), r.Size + new Vector2(2 * o + w, 2 * o + w)), Kit.Rust, false, w);
        }
    }
}

/// <summary>
/// A slider: an inked rule with a brass knob, its value in the typewriter face beside it (the CSS .rng).
/// `input` hears every move, `changed` the value when the knob is let go (or a key moved it).
///
///   var s = new InkSlider(0.5, 1, 0.05, prefs.Scale, v => $"{v * 100:0}%", null, v => ...);
/// </summary>
public partial class InkSlider : Control
{
    private readonly double lo, hi, step;
    private readonly Func<double, string> show;
    private readonly Action<double>? input;
    private readonly Action<double>? changed;
    private bool drag;
    public double Value { get; private set; }
    /// <summary>The rule's length, CSS px.</summary>
    public float TrackWidth { get; set; } = 200;
    /// <summary>No number beside it (the age slider shows its own).</summary>
    public bool NoOutput { get; set; }

    public InkSlider(double lo, double hi, double step, double now, Func<double, string> show, Action<double>? input, Action<double>? changed)
    {
        this.lo = lo;
        this.hi = hi;
        this.step = step;
        this.show = show;
        this.input = input;
        this.changed = changed;
        Value = now;
        FocusMode = FocusModeEnum.All;
        MouseDefaultCursorShape = CursorShape.PointingHand;
        FocusEntered += QueueRedraw;
        FocusExited += QueueRedraw;
    }

    private float Track => Kit.Px(TrackWidth);
    private float OutW => NoOutput ? 0 : Kit.Px(10) + Fonts.Mono.GetStringSize("100%", HorizontalAlignment.Left, -1, Kit.Px(15)).X + Kit.Px(8);

    public override Vector2 _GetMinimumSize() => new(Track + OutW, Kit.Px(22));

    private void SetFrom(float x)
    {
        float k = Kit.Px(14);
        double t = Math.Clamp((x - k / 2) / (Track - k), 0, 1);
        double v = Math.Clamp(lo + Math.Round(t * (hi - lo) / step) * step, lo, hi);
        v = Math.Round(v, 4);
        if (v == Value) return;
        Value = v;
        QueueRedraw();
        input?.Invoke(v);
    }

    /// <summary>A key's step (Left, Right).</summary>
    public bool Step(int dir)
    {
        double v = Math.Round(Math.Clamp(Value + dir * step, lo, hi), 4);
        if (v != Value)
        {
            Value = v;
            QueueRedraw();
            input?.Invoke(v);
            changed?.Invoke(v);
        }
        return true;
    }

    public void Set(double v)
    {
        Value = Math.Clamp(v, lo, hi);
        QueueRedraw();
    }

    public override void _GuiInput(InputEvent e)
    {
        if (e is InputEventMouseButton { ButtonIndex: MouseButton.Left } b)
        {
            if (b.Pressed)
            {
                drag = true;
                GrabFocus();
                SetFrom(b.Position.X);
            }
            else if (drag)
            {
                drag = false;
                changed?.Invoke(Value);
            }
            AcceptEvent();
        }
        else if (e is InputEventMouseMotion m && drag)
        {
            SetFrom(m.Position.X);
            AcceptEvent();
        }
    }

    public override void _Draw()
    {
        float k = Kit.Px(14), kh = Kit.Px(18), mid = Size.Y / 2;
        float t = (float)((Value - lo) / (hi - lo));
        DrawRect(new Rect2(0, mid - Kit.Pxf(1.5f), Track, Math.Max(2, Kit.Pxf(3))), Kit.Ink);
        var knob = new Rect2(t * (Track - k), mid - kh / 2, k, kh);
        if (HasFocus() && Kit.KeyFocus) DrawRect(knob.Grow(Kit.Px(3)), Kit.Rust);
        var box = new StyleBoxFlat { BgColor = new Color("b9933f"), BorderColor = Kit.Ink, AntiAliasing = true };
        box.SetCornerRadiusAll(Kit.Px(2));
        box.SetBorderWidthAll(Math.Max(1, Mathf.RoundToInt(Kit.Pxf(1.5f))));
        DrawStyleBox(box, knob);
        float bw = Math.Max(1, Kit.Pxf(1.5f));
        DrawRect(new Rect2(knob.Position.X + bw, knob.Position.Y + bw, k - 2 * bw, (kh - 2 * bw) * 0.5f), new Color(0.85f, 0.698f, 0.373f, 0.75f));
        if (NoOutput) return;
        int fs = Kit.Px(15);
        string s = show(Value);
        float w = Fonts.Mono.GetStringSize(s, HorizontalAlignment.Left, -1, fs).X;
        DrawString(Fonts.Mono, new Vector2(Size.X - w, mid - Fonts.Mono.GetHeight(fs) / 2 + Fonts.Mono.GetAscent(fs)), s, HorizontalAlignment.Left, -1, fs, Kit.Ink);
    }
}

/// <summary>
/// A list to pick one from (the CSS select): the choice now in an inked box with a small arrow; a click or Enter
/// opens the list, Left and Right step through it.
///
///   var s = new Select(new[] { ("720", "720 lines"), ("0", "Full window") }, "720", id => ...);
/// </summary>
public partial class Select : OptionButton
{
    private readonly (string id, string label)[] opts;
    private readonly Action<string> changed;
    public string Value => Selected >= 0 && Selected < opts.Length ? opts[Selected].id : "";

    public Select((string id, string label)[] options, string now, Action<string> onChange, float maxWidth = 260)
    {
        opts = options;
        changed = onChange;
        for (int i = 0; i < opts.Length; i++)
        {
            AddItem(opts[i].label, i);
            if (opts[i].id == now) Selected = i;
        }
        FitToLongestItem = true;
        Alignment = HorizontalAlignment.Left;
        ClipText = true;
        float longest = 0;
        foreach (var o in opts) longest = Math.Max(longest, Fonts.Print.GetStringSize(o.label, HorizontalAlignment.Left, -1, Kit.Px(15)).X);
        CustomMinimumSize = new Vector2(Math.Min(Kit.Px(maxWidth), longest + Kit.Px(8 + 24 + 6)), 0);
        FitToLongestItem = false;
        MouseDefaultCursorShape = CursorShape.PointingHand;
        AddThemeFontOverride("font", Fonts.Print);
        AddThemeFontSizeOverride("font_size", Kit.Px(15));
        foreach (string c in new[] { "font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color" }) AddThemeColorOverride(c, Kit.Ink);
        var box = Kit.Box(Kit.Wash(0.45f), Kit.Ink, 1.5f, 2, 8, 4);
        box.ContentMarginRight = Kit.Px(24);
        var hover = Kit.Box(Kit.Wash(0.7f), Kit.Ink, 1.5f, 2, 8, 4);
        hover.ContentMarginRight = Kit.Px(24);
        AddThemeStyleboxOverride("normal", box);
        AddThemeStyleboxOverride("hover", hover);
        AddThemeStyleboxOverride("pressed", hover);
        AddThemeStyleboxOverride("focus", new StyleBoxEmpty());
        AddThemeIconOverride("arrow", new ImageTexture());
        AddThemeConstantOverride("arrow_margin", 0);
        ItemSelected += i => changed(opts[(int)i].id);
        FocusEntered += QueueRedraw;
        FocusExited += QueueRedraw;

        // the list that drops down: paper and ink too
        var pop = GetPopup();
        pop.AddThemeFontOverride("font", Fonts.Print);
        pop.AddThemeFontSizeOverride("font_size", Kit.Px(15));
        pop.AddThemeColorOverride("font_color", Kit.Ink);
        pop.AddThemeColorOverride("font_hover_color", Kit.PaperHi);
        pop.AddThemeStyleboxOverride("panel", Kit.Box(Kit.PaperHi, Kit.Ink, 1.5f, 2, 2, 2));
        pop.AddThemeStyleboxOverride("hover", Kit.Box(Kit.Ink, Kit.Ink, 0, 0, 0, 0));
        pop.AddThemeConstantOverride("v_separation", Kit.Px(5));
        pop.AddThemeConstantOverride("item_start_padding", Kit.Px(8));
        pop.AddThemeConstantOverride("item_end_padding", Kit.Px(8));
        foreach (string icon in new[] { "radio_checked", "radio_unchecked", "checked", "unchecked" }) pop.AddThemeIconOverride(icon, new ImageTexture());
        pop.TransparentBg = false;
    }

    /// <summary>Left or Right: the choice before or after.</summary>
    public bool Step(int dir)
    {
        int n = Math.Clamp(Selected + dir, 0, opts.Length - 1);
        if (n == Selected) return true;
        Selected = n;
        changed(opts[n].id);
        return true;
    }

    public override void _Draw()
    {
        // the arrow: a small inked triangle
        float w = Kit.Px(10), h = Kit.Px(5.5f), x = Size.X - Kit.Px(18), y = Size.Y / 2 - h / 2 + Kit.Px(1);
        DrawColoredPolygon(new[] { new Vector2(x, y), new Vector2(x + w, y), new Vector2(x + w / 2, y + h) }, Kit.Ink);
        if (HasFocus() && Kit.KeyFocus)
        {
            float o = Kit.Px(2), lw = Kit.Px(2);
            DrawRect(new Rect2(-o - lw / 2, -o - lw / 2, Size.X + 2 * o + lw, Size.Y + 2 * o + lw), Kit.Rust, false, lw);
        }
    }
}
