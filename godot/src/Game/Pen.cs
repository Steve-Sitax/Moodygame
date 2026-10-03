using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Game;

/// <summary>
/// The game's own fonts (client/src/menu/fonts.ts; the files in godot/fonts, licences in assets/ATTRIBUTION.md):
/// the hand (Kalam) for notes and the HUD, the print (Old Standard TT) for reading, the slab (Alfa Slab One) for
/// titles, the mono (Courier Prime) for keys.
/// </summary>
public static class Fonts
{
    public static Font Hand => hand ??= Load("kalam-latin-400-normal.woff2");
    public static Font HandBold => handBold ??= Load("kalam-latin-700-normal.woff2");
    public static Font Print => print ??= Load("old-standard-tt-latin-400-normal.woff2");
    public static Font PrintBold => printBold ??= Load("old-standard-tt-latin-700-normal.woff2");
    public static Font PrintItalic => printItalic ??= Load("old-standard-tt-latin-400-italic.woff2");
    public static Font Slab => slab ??= Load("alfa-slab-one-latin-400-normal.woff2");
    public static Font Mono => mono ??= Load("courier-prime-latin-400-normal.woff2");
    public static Font MonoBold => monoBold ??= Load("courier-prime-latin-700-normal.woff2");
    private static Font? hand, handBold, print, printBold, printItalic, slab, mono, monoBold;

    private static Font Load(string file)
    {
        string path = "res://fonts/" + file;
        // imported (the editor's import, or the download's pack), else read as it lies in the checkout
        if (ResourceLoader.Exists(path) && GD.Load<Font>(path) is { } f) return f;
        var raw = new FontFile();
        if (raw.LoadDynamicFont(ProjectSettings.GlobalizePath(path)) == Error.Ok) return raw;
        GD.PrintErr($"font not found: {path}");
        return ThemeDB.FallbackFont;
    }
}

/// <summary>
/// A pen that draws as the browser's canvas does (moveTo, lineTo, arc, curves; fill or stroke), so the HUD's small
/// drawings carry over from the TypeScript line by line. Curves become short straight pieces.
/// </summary>
public sealed class Pen
{
    private readonly CanvasItem on;
    private readonly List<List<Vector2>> paths = new();
    public Color Colour;
    public float LineWidth = 1.5f;

    public Pen(CanvasItem on, Color colour)
    {
        this.on = on;
        Colour = colour;
    }

    private List<Vector2> Now
    {
        get
        {
            if (paths.Count == 0) paths.Add(new List<Vector2>());
            return paths[^1];
        }
    }

    public void BeginPath() => paths.Clear();
    public void MoveTo(float x, float y) => paths.Add(new List<Vector2> { new(x, y) });
    public void LineTo(float x, float y) => Now.Add(new Vector2(x, y));

    public void ClosePath()
    {
        if (paths.Count == 0 || Now.Count < 2) return;
        var first = Now[0];
        Now.Add(first);
        paths.Add(new List<Vector2> { first });
    }

    public void QuadraticCurveTo(float cx, float cy, float x, float y)
    {
        var a = Now.Count > 0 ? Now[^1] : new Vector2(cx, cy);
        if (Now.Count == 0) Now.Add(a);
        Vector2 c = new(cx, cy), b = new(x, y);
        for (int i = 1; i <= 10; i++)
        {
            float t = i / 10f;
            Now.Add(a.Lerp(c, t).Lerp(c.Lerp(b, t), t));
        }
    }

    public void BezierCurveTo(float c1x, float c1y, float c2x, float c2y, float x, float y)
    {
        var a = Now.Count > 0 ? Now[^1] : new Vector2(c1x, c1y);
        if (Now.Count == 0) Now.Add(a);
        Vector2 c1 = new(c1x, c1y), c2 = new(c2x, c2y), b = new(x, y);
        for (int i = 1; i <= 14; i++) Now.Add(a.BezierInterpolate(c1, c2, b, i / 14f));
    }

    public void Arc(float cx, float cy, float r, float a0, float a1, bool anticlockwise = false) => Ellipse(cx, cy, r, r, 0, a0, a1, anticlockwise);

    public void Ellipse(float cx, float cy, float rx, float ry, float rot, float a0, float a1, bool anticlockwise = false)
    {
        if (!anticlockwise) while (a1 < a0) a1 += MathF.Tau;
        else while (a1 > a0) a1 -= MathF.Tau;
        int n = Math.Max(2, (int)MathF.Ceiling(MathF.Abs(a1 - a0) / (MathF.PI / 14)));
        float cr = MathF.Cos(rot), sr = MathF.Sin(rot);
        for (int i = 0; i <= n; i++)
        {
            float a = a0 + (a1 - a0) * i / n;
            float x = rx * MathF.Cos(a), y = ry * MathF.Sin(a);
            Now.Add(new Vector2(cx + x * cr - y * sr, cy + x * sr + y * cr));
        }
    }

    public void Stroke()
    {
        foreach (var p in paths)
            if (p.Count >= 2) on.DrawPolyline(p.ToArray(), Colour, LineWidth, true);
    }

    public void Fill()
    {
        foreach (var p in paths)
        {
            var pts = Clean(p);
            if (pts.Length < 3) continue;
            on.DrawColoredPolygon(pts, Colour);
            // a thin line round it: the polygon's edge is not smoothed by itself
            var ring = new Vector2[pts.Length + 1];
            pts.CopyTo(ring, 0);
            ring[^1] = pts[0];
            on.DrawPolyline(ring, Colour, 0.5f, true);
        }
    }

    /// <summary>No point twice in a row, and the last not the first again: the triangulation wants a clean ring.</summary>
    private static Vector2[] Clean(List<Vector2> p)
    {
        var o = new List<Vector2>(p.Count);
        foreach (var v in p)
            if (o.Count == 0 || o[^1].DistanceSquaredTo(v) > 1e-6f) o.Add(v);
        while (o.Count > 1 && o[^1].DistanceSquaredTo(o[0]) <= 1e-6f) o.RemoveAt(o.Count - 1);
        return o.ToArray();
    }

    public void StrokeRect(float x, float y, float w, float h)
    {
        on.DrawPolyline(new[] { new Vector2(x, y), new Vector2(x + w, y), new Vector2(x + w, y + h), new Vector2(x, y + h), new Vector2(x, y) }, Colour, LineWidth, true);
    }

    public void FillRect(float x, float y, float w, float h) => on.DrawRect(new Rect2(x, y, w, h), Colour);
}
