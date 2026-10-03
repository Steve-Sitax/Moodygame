using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Ui;

/// <summary>
/// A paragraph with keys in it: words in the print face, each key a small typewriter key (the CSS kbd). The keys
/// are written in braces: "{E} does the first thing; {Esc} this menu". It wraps at its width.
///
///   col.AddChild(new KeyedText("{E} use, {Esc} the menu") { CssSize = 12, Centre = true });
/// </summary>
public partial class KeyedText : Control
{
    public float CssSize { get; set; } = 16;
    /// <summary>The CSS line-height, in em.</summary>
    public float LineEm { get; set; } = 1.45f;
    public Color? Colour { get; set; }
    public bool Centre { get; set; }
    public Font Face { get; set; } = Fonts.Print;

    private readonly List<List<(string text, bool key)>> words = new();
    private readonly List<(int from, int to, float width)> lines = new();
    private float laidFor = -1;

    public KeyedText(string markup)
    {
        MouseFilter = MouseFilterEnum.Ignore;
        SizeFlagsHorizontal = SizeFlags.ExpandFill;
        foreach (string w in markup.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var pieces = new List<(string, bool)>();
            int i = 0;
            while (i < w.Length)
            {
                int open = w.IndexOf('{', i);
                int close = open >= 0 ? w.IndexOf('}', open + 2) : -1;
                if (open < 0 || close < 0)
                {
                    pieces.Add((w[i..], false));
                    break;
                }
                if (open > i) pieces.Add((w[i..open], false));
                // a key's name of two words is written with a hard space ("Right Shift")
                pieces.Add((w[(open + 1)..close].Replace(' ', ' '), true));
                i = close + 1;
            }
            words.Add(pieces);
        }
    }

    /// <summary>A key's name as this text wants it: in braces, its spaces made hard.</summary>
    public static string Key(string name) => "{" + name.Replace(' ', ' ') + "}";

    private int Fs => Kit.Px(CssSize);
    private int KeyFs => Mathf.RoundToInt(Fs * 0.86f);

    private float PieceWidth((string text, bool key) p) => p.key
        ? Math.Max(Fs * 1.1f, Fonts.MonoBold.GetStringSize(p.text, HorizontalAlignment.Left, -1, KeyFs).X + Kit.Px(8)) + Kit.Px(2)
        : Face.GetStringSize(p.text, HorizontalAlignment.Left, -1, Fs).X;

    private void Lay()
    {
        float width = Size.X;
        if (Math.Abs(width - laidFor) < 0.5f) return;
        laidFor = width;
        lines.Clear();
        float space = Face.GetStringSize(" ", HorizontalAlignment.Left, -1, Fs).X;
        int from = 0;
        float x = 0;
        for (int i = 0; i < words.Count; i++)
        {
            float w = 0;
            foreach (var p in words[i]) w += PieceWidth(p);
            if (i > from && x + space + w > width)
            {
                lines.Add((from, i, x));
                from = i;
                x = 0;
            }
            x += (i > from ? space : 0) + w;
        }
        if (words.Count > 0) lines.Add((from, words.Count, x));
        float h = MathF.Ceiling(lines.Count * Fs * LineEm);
        if (Math.Abs(CustomMinimumSize.Y - h) > 0.5f) CustomMinimumSize = new Vector2(0, h);
    }

    public override void _Notification(int what)
    {
        if (what == NotificationResized || what == NotificationEnterTree) Lay();
    }

    public override void _Draw()
    {
        Lay();
        var colour = Colour ?? Kit.Ink;
        float space = Face.GetStringSize(" ", HorizontalAlignment.Left, -1, Fs).X;
        float lh = Fs * LineEm;
        for (int l = 0; l < lines.Count; l++)
        {
            var (from, to, width) = lines[l];
            float x = Centre ? (Size.X - width) / 2 : 0;
            float baseY = l * lh + (lh - Face.GetHeight(Fs)) / 2 + Face.GetAscent(Fs);
            for (int i = from; i < to; i++)
            {
                if (i > from) x += space;
                foreach (var p in words[i])
                {
                    float w = PieceWidth(p);
                    if (!p.key) DrawString(Face, new Vector2(x, baseY), p.text, HorizontalAlignment.Left, -1, Fs, colour);
                    else
                    {
                        float kh = Fonts.MonoBold.GetHeight(KeyFs) * 0.98f;
                        var r = new Rect2(x + Kit.Px(1), baseY - Fonts.MonoBold.GetAscent(KeyFs) - Kit.Pxf(0.5f), w - Kit.Px(2), kh);
                        var box = new StyleBoxFlat { BgColor = Kit.Wash(0.35f), BorderColor = new Color(Kit.Ink, 0.55f), AntiAliasing = true };
                        box.SetCornerRadiusAll(Kit.Px(3));
                        box.SetBorderWidthAll(Math.Max(1, Kit.Px(1)));
                        box.BorderWidthBottom = Math.Max(1, Kit.Px(2));
                        DrawStyleBox(box, r);
                        float tw = Fonts.MonoBold.GetStringSize(p.text, HorizontalAlignment.Left, -1, KeyFs).X;
                        DrawString(Fonts.MonoBold, new Vector2(r.Position.X + (r.Size.X - tw) / 2, baseY), p.text, HorizontalAlignment.Left, -1, KeyFs, Kit.Ink);
                    }
                    x += w;
                }
            }
        }
    }
}

/// <summary>Holds one child in its middle without passing on the child's width (a title wider than its column runs over, as CSS lets it).</summary>
public partial class Loose : Control
{
    public Loose(Control child)
    {
        MouseFilter = MouseFilterEnum.Ignore;
        AddChild(child);
        child.MinimumSizeChanged += Fit;
        Resized += Fit;
        Fit();
    }

    private void Fit()
    {
        var c = GetChild<Control>(0);
        var m = c.GetCombinedMinimumSize();
        CustomMinimumSize = new Vector2(0, m.Y);
        c.Size = m;
        c.Position = new Vector2((Size.X - m.X) / 2, 0);
    }
}

/// <summary>
/// Holds one child in the middle of itself, both ways, and leaves the child its turn (a Godot container sets a
/// child's rotation back to none: a tilted paper is centred with this instead of a CenterContainer).
/// </summary>
public partial class Centred : Control
{
    public Centred(Control child)
    {
        MouseFilter = MouseFilterEnum.Ignore;
        SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(child);
        child.MinimumSizeChanged += Fit;
        Resized += Fit;
    }

    public override void _Ready() => Fit();

    private void Fit()
    {
        var c = GetChild<Control>(0);
        var m = c.GetCombinedMinimumSize();
        c.Size = m;
        c.Position = ((Size - m) / 2).Round();
    }
}
