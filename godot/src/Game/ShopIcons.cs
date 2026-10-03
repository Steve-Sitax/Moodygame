using System;
using Godot;

namespace Scheldemist.Game;

/// <summary>
/// Pocket drawings for what the shops sell (game/shopIcons.ts), in ink like the others: 32 by 32, a 1.5 px line.
/// </summary>
public static class ShopIcons
{
    private static void Line(Pen g, bool close, params float[] xy)
    {
        g.BeginPath();
        g.MoveTo(xy[0], xy[1]);
        for (int i = 2; i + 1 < xy.Length; i += 2) g.LineTo(xy[i], xy[i + 1]);
        if (close) g.ClosePath();
        g.Stroke();
    }

    private static void Oval(Pen g, float x, float y, float rx, float ry, bool fill = false)
    {
        g.BeginPath();
        g.Ellipse(x, y, rx, ry, 0, 0, MathF.Tau);
        if (fill) g.Fill();
        else g.Stroke();
    }

    private static void Book(Pen g, bool cross)
    {
        g.StrokeRect(8, 6, 16, 21);
        g.FillRect(8, 6, 2.5f, 21);
        if (cross)
        {
            g.FillRect(15, 10, 1.5f, 9);
            g.FillRect(12, 13, 7.5f, 1.5f);
        }
        else
            foreach (int y in new[] { 11, 14 }) g.FillRect(13, y, 8, 1);
    }

    /// <summary>Draw the kind's icon with the pen (the scale is set already); false: no drawing of that kind here.</summary>
    public static bool Draw(Pen g, CanvasItem on, string kind, float s)
    {
        switch (kind)
        {
            case "peperkoek":
                g.StrokeRect(6, 12, 20, 10);
                foreach (int x in new[] { 10, 16, 22 }) g.FillRect(x, 16, 1.5f, 1.5f);
                return true;
            case "sausage":
                g.LineWidth = 5;
                g.BeginPath();
                g.Arc(16, 28, 14, MathF.PI * 1.15f, MathF.PI * 1.85f);
                g.Stroke();
                g.LineWidth = 1.5f;
                return true;
            case "bacon":
                g.StrokeRect(5, 11, 22, 11);
                foreach (int y in new[] { 14, 17, 20 }) Line(g, false, 6, y, 26, y + 0.5f);
                return true;
            case "brawn":
                g.StrokeRect(8, 10, 16, 13);
                foreach (var (x, y) in new[] { (11, 14), (18, 13), (14, 19), (20, 19) }) Oval(g, x, y, 1.5f, 1.2f, true);
                return true;
            case "cheese":
                Line(g, true, 5, 23, 27, 23, 27, 14, 5, 23);
                return true;
            case "candy":
                Oval(g, 16, 16, 6, 5);
                Line(g, true, 10, 16, 4, 12, 4, 20, 10, 16);
                Line(g, true, 22, 16, 28, 12, 28, 20, 22, 16);
                return true;
            case "figs":
                foreach (var (x, y) in new[] { (11, 18), (21, 18), (16, 12) })
                {
                    Oval(g, x, y, 4.5f, 5);
                    g.FillRect(x - 0.5f, y - 6.5f, 1, 2);
                }
                return true;
            case "chocolate":
                g.StrokeRect(6, 9, 20, 14);
                Line(g, false, 13, 9, 13, 23);
                Line(g, false, 19, 9, 19, 23);
                Line(g, false, 6, 16, 26, 16);
                return true;
            case "tea":
                g.StrokeRect(8, 10, 16, 15);
                Line(g, false, 8, 10, 16, 5, 24, 10);
                Oval(g, 16, 17, 3, 3);
                return true;
            case "pipe":
                Line(g, false, 4, 12, 20, 16);
                g.StrokeRect(19, 14, 7, 10);
                return true;
            case "cigar":
                g.LineWidth = 4;
                Line(g, false, 5, 20, 25, 12);
                g.LineWidth = 1.5f;
                g.FillRect(9, 15, 3, 5);
                return true;
            case "matches":
                g.StrokeRect(6, 12, 20, 11);
                foreach (int x in new[] { 10, 14, 18 })
                {
                    Line(g, false, x, 12, x + 3, 5);
                    g.FillRect(x + 2, 4, 2.5f, 2.5f);
                }
                return true;
            case "syrup":
                g.StrokeRect(11, 12, 10, 15);
                g.StrokeRect(14, 7, 4, 5);
                g.FillRect(12, 17, 8, 4);
                return true;
            case "powder":
                Line(g, true, 6, 10, 26, 10, 26, 22, 6, 22);
                Line(g, false, 6, 10, 16, 16, 26, 10);
                return true;
            case "liquorice":
                g.LineWidth = 3;
                Line(g, false, 8, 26, 24, 6);
                g.LineWidth = 1.5f;
                return true;
            case "wool_vest":
                Line(g, true, 9, 6, 13, 10, 16, 16, 19, 10, 23, 6, 25, 27, 7, 27);
                foreach (int y in new[] { 19, 22, 25 }) g.FillRect(15.5f, y, 1.5f, 1.5f);
                return true;
            case "shawl":
                Line(g, true, 4, 9, 28, 9, 16, 27);
                Line(g, false, 16, 27, 14, 30);
                Line(g, false, 16, 27, 18, 30);
                return true;
            case "flat_cap":
                g.BeginPath();
                g.Ellipse(15, 19, 11, 6, 0, MathF.PI, 0);
                g.Stroke();
                Line(g, true, 4, 19, 28, 20, 26, 23, 6, 21);
                return true;
            case "felt_hat":
                g.BeginPath();
                g.Arc(16, 19, 7, MathF.PI, 0);
                g.Stroke();
                Line(g, false, 4, 20, 28, 20);
                return true;
            case "laces":
                g.BeginPath();
                g.MoveTo(4, 16 + MathF.Sin(4 / 2.5f) * 5);
                for (int x = 5; x <= 28; x++) g.LineTo(x, 16 + MathF.Sin(x / 2.5f) * 5);
                g.Stroke();
                return true;
            case "coffee_beans":
                foreach (var (x, y) in new[] { (11, 13), (20, 12), (15, 21), (23, 21) })
                {
                    Oval(g, x, y, 4, 5);
                    Line(g, false, x, y - 4, x, y + 4);
                }
                return true;
            case "almanac":
                g.StrokeRect(8, 6, 16, 21);
                on.DrawSetTransform(Vector2.Zero, 0, Vector2.One);
                on.DrawString(Fonts.PrintBold, new Vector2(9, 17) * s, "1874", HorizontalAlignment.Left, -1, Mathf.RoundToInt(7 * s), g.Colour);
                on.DrawSetTransform(Vector2.Zero, 0, new Vector2(s, s));
                return true;
            case "paper_env":
                g.StrokeRect(5, 10, 22, 14);
                Line(g, false, 5, 10, 16, 18, 27, 10);
                return true;
            case "penny_book":
                Book(g, false);
                return true;
            case "prayer_book":
                Book(g, true);
                return true;
            case "watch":
                Oval(g, 16, 18, 9, 9);
                g.StrokeRect(14, 5, 4, 4);
                Line(g, false, 16, 18, 16, 12);
                Line(g, false, 16, 18, 20, 20);
                return true;
            case "watch_key":
                Oval(g, 16, 10, 5, 5);
                Line(g, false, 16, 15, 16, 27);
                Line(g, false, 16, 24, 20, 24);
                return true;
        }
        return false;
    }
}
