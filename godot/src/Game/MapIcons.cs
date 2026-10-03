using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Godot;

namespace Scheldemist.Game;

/// <summary>A kind of mark on the map: the key's line, the badge's rim, and whether the map shows it before any click.</summary>
public sealed record MapCat(string Id, string Label, Color Ink, bool On);

/// <summary>
/// The map's icons (client/src/game/mapIcons.ts). Each place on the paper map is a small ink picture in a round
/// badge; the badge's rim is the colour of its kind, and the key over the map turns each kind on and off. The
/// pictures are drawn in a box from -10 to 10, y down, with the browser's own canvas calls (the Pen).
/// </summary>
public static class MapIcons
{
    /// <summary>The paper's filter in the browser (.paper: sepia(0.3) contrast(0.95)) lies over the whole map: every colour goes through it.</summary>
    public static Color Sepia(Color c)
    {
        const float a = 0.7f; // 1 - the amount
        float r = (0.393f + 0.607f * a) * c.R + (0.769f - 0.769f * a) * c.G + (0.189f - 0.189f * a) * c.B;
        float g = (0.349f - 0.349f * a) * c.R + (0.686f + 0.314f * a) * c.G + (0.168f - 0.168f * a) * c.B;
        float b = (0.272f - 0.272f * a) * c.R + (0.534f - 0.534f * a) * c.G + (0.131f + 0.869f * a) * c.B;
        static float K(float v) => Math.Clamp(Math.Clamp(v, 0, 1) * 0.95f + 0.025f, 0, 1);
        return new Color(K(r), K(g), K(b), c.A);
    }

    /// <summary>A browser colour ("8a1a10") as the paper shows it.</summary>
    public static Color Ink(string hex, float alpha = 1) => Sepia(new Color(new Color(hex), alpha));

    /// <summary>The kinds, in the key's order.</summary>
    public static readonly MapCat[] Cats =
    {
        new("job", "your job: go here", Ink("8a1a10"), true),
        new("work", "work offered", Ink("1a3a6a"), true),
        new("event", "going on in town", Ink("4a2a5a"), true),
        new("food", "food, drink, markets", Ink("6a4a10"), true),
        new("tavern", "taverns", Ink("7a2a1a"), true),
        new("shop", "other shops", Ink("3a4a2a"), true),
        new("service", "boards, post, police, boats", Ink("2a3a4a"), true),
        new("bed", "a bed for the night", Ink("4a3a2a"), true),
        new("sight", "churches and sights", Ink("5a3a1a"), true),
        new("pump", "water pumps", Ink("2a5a6a"), false),
        new("names", "street and square names", Ink("2a2420"), true),
    };
    public static readonly IReadOnlyDictionary<string, MapCat> Cat = Cats.ToDictionary(c => c.Id);
    public static Color CatInk(string cat) => Cat[cat].Ink;

    public static readonly Color PaperDisc = Ink("f3ead2");
    public static readonly Color Dark = Ink("2a2420");

    /// <summary>An icon: its kind, and its picture (or the one letter it is).</summary>
    public sealed record Icon(string Cat, Action<Pen>? Draw, string Text = "");

    private static void Path(Pen g, bool close, bool fill, params float[] xy)
    {
        g.BeginPath();
        g.MoveTo(xy[0], xy[1]);
        for (int i = 2; i < xy.Length; i += 2) g.LineTo(xy[i], xy[i + 1]);
        if (close) g.ClosePath();
        if (fill) g.Fill();
        else g.Stroke();
    }
    private static void Line(Pen g, params float[] xy) => Path(g, false, false, xy);
    private static void Ring(Pen g, params float[] xy) => Path(g, true, false, xy);

    private static void Circle(Pen g, float x, float y, float r, bool fill = false)
    {
        g.BeginPath();
        g.Arc(x, y, r, 0, MathF.Tau);
        if (fill) g.Fill();
        else g.Stroke();
    }

    private const float Pi = MathF.PI;

    /// <summary>Each icon by its name.</summary>
    public static readonly IReadOnlyDictionary<string, Icon> Icons = new Dictionary<string, Icon>
    {
        ["goal"] = new("job", g =>
        {
            g.LineWidth = 2.6f;
            Line(g, -5, -5, 5, 5);
            Line(g, 5, -5, -5, 5);
        }),
        ["work"] = new("work", null, "!"),
        ["event"] = new("event", null, "?"),
        ["bread"] = new("food", g =>
        {
            g.BeginPath();
            g.MoveTo(-8, 4);
            g.BezierCurveTo(-9, -6, 9, -6, 8, 4);
            g.ClosePath();
            g.Stroke();
            foreach (float x in new[] { -3f, 1, 5 }) Line(g, x - 1.5f, 0, x + 0.5f, -3);
        }),
        ["veg"] = new("food", g =>
        {
            Ring(g, -2, -3, 3, -3, 0.5f, 8);
            Line(g, 0.5f, -3, -2, -8);
            Line(g, 0.5f, -3, 0.5f, -8.5f);
            Line(g, 0.5f, -3, 3.5f, -7.5f);
        }),
        ["meat"] = new("food", g =>
        {
            g.BeginPath();
            g.Ellipse(-1.5f, 1, 6, 5, -0.6f, 0, MathF.Tau);
            g.Stroke();
            Circle(g, -2, 1.5f, 1.5f, true);
            Line(g, 3, -3, 7, -7);
            Circle(g, 7.5f, -7.5f, 1.4f);
        }),
        ["fish"] = new("food", g =>
        {
            g.BeginPath();
            g.Ellipse(-2, 0, 6.5f, 3.5f, 0, 0, MathF.Tau);
            g.Stroke();
            Ring(g, 4.5f, 0, 8.5f, -4, 8.5f, 4);
            Circle(g, -5.5f, -0.8f, 0.9f, true);
        }),
        ["cup"] = new("food", g =>
        {
            Ring(g, -6, -2, -5, 6, 3, 6, 4, -2);
            g.BeginPath();
            g.Arc(5.5f, 1.5f, 2.6f, -Pi / 2, Pi / 2);
            g.Stroke();
            Line(g, -3, -4, -2, -8);
            Line(g, 0.5f, -4, 1.5f, -8);
        }),
        ["bottle"] = new("food", g =>
        {
            Ring(g, -1.5f, -8.5f, 1.5f, -8.5f, 1.5f, -4, 4, -1, 4, 8, -4, 8, -4, -1, -1.5f, -4);
            Line(g, -4, 2, 4, 2);
        }),
        ["crate"] = new("food", g =>
        {
            g.StrokeRect(-7, -6, 14, 13);
            Line(g, -7, -6, 7, 7);
            Line(g, 7, -6, -7, 7);
        }),
        ["market"] = new("food", g =>
        {
            Ring(g, -8, -2, -6, -7, 6, -7, 8, -2);
            foreach (float x in new[] { -8f, -4, 0, 4 })
            {
                g.BeginPath();
                g.Arc(x + 2, -2, 2, 0, Pi);
                g.Stroke();
            }
            Line(g, -7, 0, -7, 7);
            Line(g, 7, 0, 7, 7);
            Line(g, -7, 4, 7, 4);
        }),
        ["tankard"] = new("tavern", g =>
        {
            g.StrokeRect(-6, -4, 9, 11);
            g.BeginPath();
            g.Arc(3, 1.5f, 3.5f, -Pi / 2, Pi / 2);
            g.Stroke();
            // (the canvas joins the two arcs of the froth with a line)
            g.BeginPath();
            g.Arc(-4, -5, 2.2f, Pi, Pi * 2);
            g.Arc(0, -5.5f, 2.4f, Pi, Pi * 2);
            g.Stroke();
        }),
        ["anchor"] = new("shop", g =>
        {
            Circle(g, 0, -6.5f, 2);
            Line(g, 0, -4.5f, 0, 7);
            Line(g, -4, -2, 4, -2);
            g.BeginPath();
            g.Arc(0, 1, 6.5f, Pi * 0.15f, Pi * 0.85f);
            g.Stroke();
        }),
        ["pipe"] = new("shop", g =>
        {
            Line(g, -8, -3, 0, 1);
            Line(g, 0, 1, 0, 7, 6, 7, 6, -1, 0, -1);
            Line(g, 2, -3, 3, -6);
            Line(g, 4.5f, -3, 6, -7);
        }),
        ["pawn"] = new("shop", g =>
        {
            Circle(g, 0, -4.5f, 3, true);
            Circle(g, -4.5f, 3, 3, true);
            Circle(g, 4.5f, 3, 3, true);
        }),
        ["shoe"] = new("shop", g =>
        {
            Ring(g, -5, -8, 0, -8, 0, 1, 7, 3, 7, 7, -5, 7);
            Line(g, -5, 4, 7, 4);
        }),
        ["scissors"] = new("shop", g =>
        {
            Circle(g, -4.5f, 5, 2.6f);
            Circle(g, 4.5f, 5, 2.6f);
            Line(g, -3, 3, 5, -8);
            Line(g, 3, 3, -5, -8);
        }),
        ["mortar"] = new("shop", g =>
        {
            g.BeginPath();
            g.MoveTo(-7, -1);
            g.LineTo(7, -1);
            g.QuadraticCurveTo(6, 7, 0, 7);
            g.QuadraticCurveTo(-6, 7, -7, -1);
            g.Stroke();
            Line(g, 1, -1, 6, -8);
        }),
        ["razor"] = new("shop", g =>
        {
            g.StrokeRect(-2.5f, -8, 5, 16);
            foreach (float y in new[] { -6f, -2, 2, 6 }) Line(g, -2.5f, y, 2.5f, y - 2.5f);
        }),
        ["hat"] = new("shop", g =>
        {
            g.StrokeRect(-4.5f, -8, 9, 12);
            Line(g, -8.5f, 4, 8.5f, 4);
            Line(g, -4.5f, 1, 4.5f, 1);
        }),
        ["page"] = new("shop", g =>
        {
            Ring(g, -6, -8, 3, -8, 6, -5, 6, 8, -6, 8);
            foreach (float y in new[] { -3f, 0, 3, 6 }) Line(g, -3.5f, y, 3.5f, y);
        }),
        ["book"] = new("shop", g =>
        {
            g.StrokeRect(-6, -8, 12, 16);
            g.FillRect(-6, -8, 2.5f, 16);
            Line(g, -1, -3, 4, -3);
            Line(g, -1, 0, 4, 0);
        }),
        ["clock"] = new("shop", g =>
        {
            Circle(g, 0, 0, 7.5f);
            Line(g, 0, -5, 0, 0, 3.5f, 2);
        }),
        ["wheel"] = new("shop", g =>
        {
            Circle(g, 0, 0, 7.5f);
            Circle(g, 0, 0, 1.5f, true);
            for (int i = 0; i < 6; i++) Line(g, 0, 0, MathF.Cos(i * Pi / 3) * 7.5f, MathF.Sin(i * Pi / 3) * 7.5f);
        }),
        ["velocipede"] = new("shop", g =>
        {
            Circle(g, -2.5f, 2, 6);
            Circle(g, 6.5f, 5, 3);
            Line(g, -2.5f, -4, 6.5f, 5);
            Line(g, -2.5f, -4, -5, -7);
        }),
        ["vase"] = new("shop", g =>
        {
            g.BeginPath();
            g.MoveTo(-2.5f, -8);
            g.LineTo(2.5f, -8);
            g.QuadraticCurveTo(0.5f, -4, 5, 0);
            g.QuadraticCurveTo(7, 7, 0, 8);
            g.QuadraticCurveTo(-7, 7, -5, 0);
            g.QuadraticCurveTo(-0.5f, -4, -2.5f, -8);
            g.Stroke();
        }),
        ["board"] = new("service", g =>
        {
            g.StrokeRect(-7.5f, -8, 15, 10);
            Line(g, -5, 2, -5, 8);
            Line(g, 5, 2, 5, 8);
            g.FillRect(-5, -6, 4, 5);
            g.FillRect(1, -6, 4, 3);
        }),
        ["box"] = new("service", g =>
        {
            g.StrokeRect(-6, -5, 12, 12);
            g.FillRect(-3.5f, -2.5f, 7, 1.8f);
            Line(g, -6, -5, 0, -8.5f, 6, -5);
        }),
        ["letter"] = new("service", g =>
        {
            g.StrokeRect(-8, -5, 16, 11);
            Line(g, -8, -5, 0, 1.5f, 8, -5);
        }),
        ["boat"] = new("service", g =>
        {
            Ring(g, -8.5f, 1, 8.5f, 1, 5, 6, -5, 6);
            Line(g, -4, -1, 5, -7);
            Line(g, 4, -1, -5, -7);
        }),
        ["police"] = new("service", g =>
        {
            var pts = new float[24];
            for (int i = 0; i < 12; i++)
            {
                float r = i % 2 == 1 ? 3.6f : 8;
                float a = i * Pi / 6 - Pi / 2;
                pts[i * 2] = MathF.Cos(a) * r;
                pts[i * 2 + 1] = MathF.Sin(a) * r;
            }
            Ring(g, pts);
            Circle(g, 0, 0, 1.5f, true);
        }),
        ["bed"] = new("bed", g =>
        {
            Line(g, -8, -5, -8, 6);
            Line(g, 8, 0, 8, 6);
            Line(g, -8, 2, 8, 2);
            g.StrokeRect(-8, -1.5f, 16, 3.5f);
            g.BeginPath();
            g.Ellipse(-4.5f, -3, 2.6f, 1.6f, 0, 0, MathF.Tau);
            g.Fill();
        }),
        ["church"] = new("sight", g =>
        {
            Line(g, 0, -9, 0, -4);
            Line(g, -2, -7, 2, -7);
            Line(g, -6, 0, 0, -4, 6, 0);
            g.StrokeRect(-6, 0, 12, 8);
            Line(g, 0, 8, 0, 4);
        }),
        ["hall"] = new("sight", g =>
        {
            Ring(g, -8.5f, -3, 0, -8, 8.5f, -3);
            foreach (float x in new[] { -6f, -2, 2, 6 }) Line(g, x, -2, x, 6);
            Line(g, -8.5f, 7, 8.5f, 7);
        }),
        ["castle"] = new("sight", g =>
        {
            Ring(g, -7, 8, -7, -7, -4.5f, -7, -4.5f, -4, -1.5f, -4, -1.5f, -7, 1.5f, -7, 1.5f, -4, 4.5f, -4, 4.5f, -7, 7, -7, 7, 8);
            g.BeginPath();
            g.Arc(0, 8, 2.5f, Pi, Pi * 2);
            g.Stroke();
        }),
        ["mill"] = new("sight", g =>
        {
            Ring(g, -3, 8, -2, -1, 2, -1, 3, 8);
            Line(g, -7, -9, 7, 5);
            Line(g, 7, -9, -7, 5);
        }),
        ["pump"] = new("pump", g =>
        {
            g.BeginPath();
            g.MoveTo(0, -8);
            g.BezierCurveTo(6, -1, 6, 7, 0, 7);
            g.BezierCurveTo(-6, 7, -6, -1, 0, -8);
            g.Stroke();
        }),
    };

    private static readonly (Regex Re, string Icon)[] Rules =
    {
        (new("bakery|bread"), "bread"),
        (new("grocer|veg"), "veg"),
        (new("butcher"), "meat"),
        (new("fish"), "fish"),
        (new("coffee|roaster"), "cup"),
        (new("jenever|gin|liquor"), "bottle"),
        (new("colonial"), "crate"),
        (new("chandl"), "anchor"),
        (new("tobacco"), "pipe"),
        (new("berg van barm|pawn"), "pawn"),
        (new("cobbler|shoe"), "shoe"),
        (new("draper|tailor|cloth"), "scissors"),
        (new("apothecar"), "mortar"),
        (new("barber"), "razor"),
        (new("hatter"), "hat"),
        (new("printer"), "page"),
        (new("book"), "book"),
        (new("clock|watch"), "clock"),
        (new("velocipede"), "velocipede"),
        (new("wheelwright|cart"), "wheel"),
        (new("second-hand|dealer"), "vase"),
        (new("boats? for hire"), "boat"),
    };

    /// <summary>The icon a place gets from its words when the game did not name one (the shops' labels).</summary>
    public static string IconFor(string label)
    {
        string l = label.ToLowerInvariant();
        foreach (var (re, icon) in Rules)
            if (re.IsMatch(l)) return icon;
        return "vase";
    }

    // ------------------------------------------------------------------ the badges as one picture

    /// <summary>A badge takes some thirty pen strokes; drawn once into one picture, each is a single copy from it after that.</summary>
    private const int Cell = 104, Cols = 8;
    private const float AtlasScale = 4;
    private static ImageTexture? atlas;
    private static Dictionary<string, int>? cellOf;
    private static bool making;
    /// <summary>The badges' picture is in (until then each badge is drawn stroke by stroke).</summary>
    public static bool AtlasReady => atlas != null;

    /// <summary>
    /// Draw every badge once, four times its size, into a picture of their own (a viewport that draws a single
    /// frame and goes again). `host`: a node in the tree; `then`: called when the picture is in.
    /// </summary>
    public static async void MakeAtlas(Node host, Action? then = null)
    {
        if (atlas != null || making) return;
        making = true;
        try
        {
            var names = Icons.Keys.ToList();
            int rows = (names.Count + Cols - 1) / Cols;
            var vp = new SubViewport { Size = new Vector2I(Cols * Cell, rows * Cell), TransparentBg = true, Disable3D = true, RenderTargetUpdateMode = SubViewport.UpdateMode.Always };
            var sheet = new MapSheet
            {
                Paint = g =>
                {
                    for (int i = 0; i < names.Count; i++) DrawBadgeStrokes(g, names[i], new Vector2((i % Cols + 0.5f) * Cell, (i / Cols + 0.5f) * Cell), AtlasScale, 1);
                },
            };
            vp.AddChild(sheet);
            host.AddChild(vp);
            for (int i = 0; i < 2; i++) await host.ToSignal(RenderingServer.Singleton, RenderingServerInstance.SignalName.FramePostDraw);
            var img = vp.GetTexture().GetImage();
            vp.QueueFree();
            img.Convert(Image.Format.Rgba8);
            // the viewport holds colour times alpha: back to plain colour, so the rim's edge is not darkened twice
            byte[] px = img.GetData();
            for (int i = 0; i < px.Length; i += 4)
            {
                int al = px[i + 3];
                if (al == 0 || al == 255) continue;
                for (int c = 0; c < 3; c++) px[i + c] = (byte)Math.Min(255, px[i + c] * 255 / al);
            }
            var fixedImg = Image.CreateFromData(img.GetWidth(), img.GetHeight(), false, Image.Format.Rgba8, px);
            fixedImg.GenerateMipmaps();
            cellOf = names.Select((n, i) => (n, i)).ToDictionary(t => t.n, t => t.i);
            atlas = ImageTexture.CreateFromImage(fixedImg);
            then?.Invoke();
        }
        catch (Exception e)
        {
            GD.PrintErr($"the map's badges stay drawn by pen: {e.Message}");
        }
        finally
        {
            making = false;
        }
    }

    /// <summary>
    /// One badge on a canvas item, in its _Draw: a paper disc, its kind's rim, the picture in ink. s scales it
    /// (1 = 11 px round); alpha fades it (a kind turned off, in the key). The item's draw transform is left at the
    /// identity. The item's TextureFilter should be LinearWithMipmaps (the badge comes from a larger picture).
    /// </summary>
    public static void DrawBadge(CanvasItem on, string icon, Vector2 at, float s, float alpha = 1)
    {
        if (atlas != null && cellOf != null)
        {
            int i = cellOf.TryGetValue(icon, out int found) ? found : cellOf["vase"];
            float half = Cell / AtlasScale / 2 * s;
            on.DrawTextureRectRegion(atlas, new Rect2(at.X - half, at.Y - half, half * 2, half * 2), new Rect2(i % Cols * Cell, i / Cols * Cell, Cell, Cell), new Color(1, 1, 1, alpha));
            return;
        }
        DrawBadgeStrokes(on, icon, at, s, alpha);
    }

    private static void DrawBadgeStrokes(CanvasItem on, string icon, Vector2 at, float s, float alpha)
    {
        var ic = Icons.TryGetValue(icon, out var found) ? found : Icons["vase"];
        Color rim = new(CatInk(ic.Cat), alpha);
        on.DrawSetTransform(at, 0, new Vector2(s, s));
        on.DrawCircle(Vector2.Zero, 11, new Color(PaperDisc, alpha), true, -1, true);
        on.DrawArc(Vector2.Zero, 11, 0, MathF.Tau, 40, rim, 2.2f, true);
        Color ink = ic.Cat is "job" or "work" or "event" ? rim : new Color(Dark, alpha);
        if (ic.Draw != null)
        {
            on.DrawSetTransform(at, 0, new Vector2(s * 0.78f, s * 0.78f));
            ic.Draw(new Pen(on, ink) { LineWidth = 1.7f });
            on.DrawSetTransform(Vector2.Zero);
        }
        else
        {
            // a letter: drawn at its size on screen (a scaled glyph would blur), its em box's middle a little under the badge's
            on.DrawSetTransform(Vector2.Zero);
            int size = Math.Max(6, Mathf.RoundToInt(15 * s * 0.78f));
            var font = Fonts.PrintBold;
            float w = font.GetStringSize(ic.Text, HorizontalAlignment.Left, -1, size).X;
            float baseline = at.Y + 1 * s * 0.78f + (font.GetAscent(size) - font.GetDescent(size)) / 2;
            on.DrawString(font, new Vector2(at.X - w / 2, baseline), ic.Text, HorizontalAlignment.Left, -1, size, ink);
        }
    }
}
