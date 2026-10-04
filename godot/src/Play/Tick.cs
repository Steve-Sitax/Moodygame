using System;
using Godot;

namespace Scheldemist.Play;

/// <summary>The ink tick at the top edge that points to the job's goal (style.css .tick .arr: a small arrow down, turned sideways when the goal is behind).</summary>
public partial class Tick : Control
{
    private float turn;
    /// <summary>Degrees: 0 down, 90 or -90 when the goal is behind Jef.</summary>
    public float Turn
    {
        get => turn;
        set
        {
            if (turn == value) return;
            turn = value;
            QueueRedraw();
        }
    }

    public override void _Draw()
    {
        var c = Size / 2;
        float w = Size.X * 0.36f, h = Size.Y * 0.42f;
        var pts = new[] { new Vector2(-w, -h), new Vector2(w, -h), new Vector2(0, h) };
        float r = Mathf.DegToRad(turn);
        for (int i = 0; i < 3; i++) pts[i] = c + pts[i].Rotated(r);
        // the dark glow round it, then the arrow
        for (int k = 3; k >= 1; k--)
        {
            var grown = new Vector2[3];
            for (int i = 0; i < 3; i++) grown[i] = c + (pts[i] - c) * (1 + 0.18f * k);
            DrawColoredPolygon(grown, new Color(0, 0, 0, 0.18f));
        }
        DrawColoredPolygon(pts, new Color("e8d8b0"));
    }
}
