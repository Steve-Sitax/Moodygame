using System;
using Godot;

namespace Scheldemist.Play;

/// <summary>The dashed line between the board's rows (style.css .board li: border-top 1px dashed, ink at 35%).</summary>
public partial class Dashes : Control
{
    public override void _Ready()
    {
        CustomMinimumSize = new Vector2(0, Math.Max(1, Paper.Px(1)));
        MouseFilter = MouseFilterEnum.Ignore;
    }

    public override void _Draw()
    {
        float w = Size.X, dash = Paper.Px(4), y = Size.Y / 2;
        for (float x = 0; x < w; x += dash * 2) DrawLine(new Vector2(x, y), new Vector2(Math.Min(w, x + dash), y), new Color(Paper.Ink, 0.35f), Math.Max(1, Paper.Px(1)));
    }
}
