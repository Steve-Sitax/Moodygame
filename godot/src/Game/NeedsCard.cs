using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Game;

/// <summary>
/// The needs card's drawing (game/pockets.ts needsDrawing): one row each with its name, then five small drawings,
/// full or hollow (one per 2 points): loaves (food), flames (warmth), moons (sleep), hearts (health). A low need is red.
/// </summary>
public partial class NeedsCard : Control
{
    public static readonly Color Ink = new("2c2721"); // #2a2420 through the browser's sepia(0.3)
    private static readonly Color Low = new("78291c"); // #8a1c10, the same way
    private static readonly Color LowSafe = new("9b4d18"); // #b34700: colour-safe markers (the menu's Accessibility)
    private float s = 1;
    private double food = 10, warmth = 10, sleep = 10, health = 10;

    public override void _EnterTree() => Access.Changed += QueueRedraw;
    public override void _ExitTree() => Access.Changed -= QueueRedraw;

    public void SetUi(float scale)
    {
        s = scale;
        CustomMinimumSize = new Vector2(200, 92) * s;
        QueueRedraw();
    }

    public void SetNeeds(double food, double warmth, double sleep, double health)
    {
        if (food == this.food && warmth == this.warmth && sleep == this.sleep && health == this.health) return;
        (this.food, this.warmth, this.sleep, this.health) = (food, warmth, sleep, health);
        TooltipText = $"food {food}/10, warmth {warmth}/10, sleep {sleep}/10, health {health}/10";
        QueueRedraw();
    }

    public override void _Draw()
    {
        var rows = new (string Label, double V, Action<Pen, float, float> Draw)[]
        {
            ("Food", food, Loaf),
            ("Warmth", warmth, Flame),
            ("Sleep", sleep, Moon),
            ("Health", health, Heart),
        };
        var font = Fonts.PrintBold;
        int size = Mathf.RoundToInt(14 * s);
        // the words at their own size (sharp), the drawings through the scale
        float mid = (font.GetAscent(size) - font.GetDescent(size)) / 2;
        for (int r = 0; r < rows.Length; r++)
        {
            float y = 12 + r * 22;
            DrawSetTransform(Vector2.Zero, 0, Vector2.One);
            // colour-safe: a low need in orange with a mark, not red alone
            bool safe = Access.ColourSafe;
            var col = rows[r].V <= 2 ? (safe ? LowSafe : Low) : Ink;
            DrawString(font, new Vector2(4 * s, y * s + mid), rows[r].V <= 2 && safe ? rows[r].Label + " !" : rows[r].Label, HorizontalAlignment.Left, -1, size, col);
            DrawSetTransform(Vector2.Zero, 0, new Vector2(s, s));
            var pen = new Pen(this, col) { LineWidth = 1.3f };
            for (int i = 0; i < 5; i++)
            {
                pen.BeginPath();
                rows[r].Draw(pen, 76 + i * 17, y);
                if (rows[r].V >= (i + 1) * 2) pen.Fill();
                else pen.Stroke();
            }
        }
    }

    private static void Loaf(Pen g, float x, float y)
    {
        g.Ellipse(x + 5, y + 1, 5, 3.4f, 0, MathF.PI, 0);
        g.LineTo(x + 10, y + 3.5f);
        g.LineTo(x, y + 3.5f);
        g.ClosePath();
    }

    private static void Flame(Pen g, float x, float y)
    {
        g.MoveTo(x + 5, y - 6);
        g.QuadraticCurveTo(x + 11, y + 1, x + 5, y + 6);
        g.QuadraticCurveTo(x - 1, y + 1, x + 5, y - 6);
    }

    private static void Moon(Pen g, float x, float y)
    {
        g.Arc(x + 5, y, 5, MathF.PI * 0.35f, MathF.PI * 1.65f);
        g.Arc(x + 7.5f, y, 4, MathF.PI * 1.45f, MathF.PI * 0.55f, true);
        g.ClosePath();
    }

    private static void Heart(Pen g, float x, float y)
    {
        g.MoveTo(x + 5, y + 6);
        g.BezierCurveTo(x - 3, y, x + 1, y - 7, x + 5, y - 2);
        g.BezierCurveTo(x + 9, y - 7, x + 13, y, x + 5, y + 6);
    }
}
