using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Game;

/// <summary>
/// What lies in a pocket, as a small ink drawing (game/pockets.ts ICON, game/shopIcons.ts), 32 by 32. A kind with
/// no drawing of its own shows the parcel, as in the browser.
/// </summary>
public partial class PocketIcon : Control
{
    private float s = 1;
    private string kind = "";

    public void SetUi(float scale)
    {
        s = scale;
        CustomMinimumSize = new Vector2(32, 32) * s;
        QueueRedraw();
    }

    public void ShowKind(string? kind, string name)
    {
        kind ??= "";
        TooltipText = name;
        if (kind == this.kind) return;
        this.kind = kind;
        QueueRedraw();
    }

    public override void _Draw()
    {
        if (kind == "") return;
        DrawSetTransform(Vector2.Zero, 0, new Vector2(s, s));
        var g = new Pen(this, NeedsCard.Ink);
        switch (kind)
        {
            case "herring":
                g.BeginPath();
                g.Ellipse(14, 16, 10, 4.5f, -0.2f, 0, MathF.Tau);
                g.Stroke();
                g.BeginPath();
                g.MoveTo(23, 13.5f);
                g.LineTo(29, 9);
                g.LineTo(28, 20);
                g.ClosePath();
                g.Stroke();
                g.FillRect(8, 14, 2, 2);
                break;
            case "eel":
                g.BeginPath();
                g.MoveTo(3, 18);
                for (int x = 3; x <= 29; x += 2) g.LineTo(x, 16 + MathF.Sin(x / 3f) * 4);
                g.LineWidth = 3;
                g.Stroke();
                break;
            case "biscuit":
                g.StrokeRect(7, 8, 18, 16);
                foreach (var (x, y) in new[] { (11, 12), (16, 12), (21, 12), (11, 19), (16, 19), (21, 19) }) g.FillRect(x, y, 1.5f, 1.5f);
                break;
            case "jenever":
                g.StrokeRect(11, 11, 10, 16);
                g.StrokeRect(14, 5, 4, 6);
                break;
            case "bread":
                g.BeginPath();
                g.Ellipse(16, 18, 12, 7, 0, MathF.PI, 0);
                g.LineTo(28, 22);
                g.LineTo(4, 22);
                g.ClosePath();
                g.Stroke();
                foreach (int x in new[] { 10, 16, 22 })
                {
                    g.BeginPath();
                    g.MoveTo(x - 2, 14);
                    g.LineTo(x + 2, 12);
                    g.Stroke();
                }
                break;
            case "apple":
                g.BeginPath();
                g.Arc(16, 18, 8, 0, MathF.Tau);
                g.Stroke();
                g.BeginPath();
                g.MoveTo(16, 10);
                g.LineTo(17, 5);
                g.MoveTo(17, 7);
                g.QuadraticCurveTo(22, 4, 23, 8);
                g.Stroke();
                break;
            case "newspaper":
                g.StrokeRect(5, 7, 22, 18);
                g.FillRect(8, 9, 16, 2.5f);
                foreach (int y in new[] { 14, 17, 20, 23 })
                {
                    g.FillRect(8, y, 7, 0.9f);
                    g.FillRect(17, y, 7, 0.9f);
                }
                break;
            case "letter":
                g.StrokeRect(5, 9, 22, 15);
                g.BeginPath();
                g.MoveTo(5, 9);
                g.LineTo(16, 18);
                g.LineTo(27, 9);
                g.Stroke();
                g.BeginPath();
                g.Arc(16, 18, 2.2f, 0, MathF.Tau);
                g.Fill();
                break;
            case "letters":
                foreach (int o in new[] { 0, 3, 6 }) g.StrokeRect(4 + o, 6 + o, 18, 12);
                g.BeginPath();
                g.MoveTo(17, 6);
                g.LineTo(17, 30);
                g.Stroke();
                break;
            case "pawn_ticket":
                g.StrokeRect(6, 8, 20, 16);
                g.BeginPath();
                g.Arc(10, 12, 1.6f, 0, MathF.Tau);
                g.Stroke();
                g.FillRect(9, 19, 14, 1);
                DrawSetTransform(Vector2.Zero, 0, Vector2.One);
                DrawString(Fonts.PrintBold, new Vector2(13, 15) * s, "No.", HorizontalAlignment.Left, -1, Mathf.RoundToInt(8 * s), NeedsCard.Ink);
                break;
            case "ballad":
                g.StrokeRect(8, 4, 16, 24);
                g.FillRect(11, 7, 10, 5);
                foreach (int y in new[] { 15, 18, 21, 24 }) g.FillRect(11, y, y == 21 ? 7 : 10, 0.9f);
                break;
            default:
                // what the shops sell (game/shopIcons.ts); a kind with no drawing at all is a parcel
                if (ShopIcons.Draw(g, this, kind, s)) break;
                g.StrokeRect(6, 9, 20, 15);
                g.BeginPath();
                g.MoveTo(16, 9);
                g.LineTo(16, 24);
                g.MoveTo(6, 16);
                g.LineTo(26, 16);
                g.Stroke();
                break;
        }
    }
}
