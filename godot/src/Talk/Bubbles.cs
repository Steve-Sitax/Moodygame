using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Net;
using Scheldemist.Windows;

namespace Scheldemist.Talks;

/// <summary>
/// Speech bubbles (client/src/game/bubbles.ts, M4): a conversation between two townspeople the server made shows
/// as paper tags over their heads, one line at a time, taking turns, 2.5 to 4 s a line by its length, with a
/// murmur of speech from the soundscape. At most six tags at once; hidden beyond 30 m or off the screen. The lines
/// are the server's; this side only shows them.
///
///   Bubbles.I.Show(convo)                 a conversation (once; the same id again is ignored)
///   Bubbles.I.Show(convo, () => point)    the same over a point of your own (the feet; the head's height is added)
///   Bubbles.I.Say(() => head, name, text) one line over a point as it is (no height added)
///   PositionOf, InfoOf                    the townspeople's part: where someone stands (the feet), their sex and age
///   Speak                                 the sound part: a voice at a point for some seconds
/// The push "convo" is shown by itself.
/// </summary>
[GamePart(330)]
public partial class Bubbles : Node
{
    public static Bubbles? I { get; private set; }

    private const int MaxTags = 6;
    private const float ShowM = 30;
    private const float HeadM = 1.75f;
    private const float ChildHeadM = 1.3f;
    /// <summary>A bubble stays this far inside the screen's edge (it slides, it never shrinks).</summary>
    private const float EdgePx = 6;
    private const float Tail = 6;

    private sealed class Play
    {
        public Convo C = null!;
        public int Line = -1;
        /// <summary>Seconds left on the current line.</summary>
        public double T;
        public string Who = "";
        public Tag Tag = null!;
        /// <summary>The place given with the conversation, instead of the town's.</summary>
        public Func<Vector3>? At;
        /// <summary>At is the head itself: no height is added.</summary>
        public bool Head;
    }

    private readonly List<Play> plays = new();
    private HashSet<int> seen = new();
    private readonly List<int> seenOrder = new();
    private Control layer = null!;

    /// <summary>Where a townsperson stands (their feet), or null when they are nowhere now. Set by the townspeople's part.</summary>
    public Func<string, Vector3?>? PositionOf { get; set; }
    /// <summary>A townsperson's sex ("m" or "f") and age. Set by the townspeople's part.</summary>
    public Func<string, (string Sex, int Age)?>? InfoOf { get; set; }
    /// <summary>The made voice: a murmur at this point, of this sex and age, for so many seconds. Set by the sound part; not set, the bubbles are silent.</summary>
    public Action<Vector3, string, int, double>? Speak { get; set; }
    /// <summary>The lines shown so far (the checks).</summary>
    public List<string> Shown { get; } = new();

    public Bubbles()
    {
        I = this;
    }

    public override void _Ready()
    {
        // under the dialogs, over the picture
        layer = new Control { Name = "Bubbles", MouseFilter = Control.MouseFilterEnum.Ignore };
        layer.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(layer);
        if (Dialogs.I?.Layer is { } top && top.GetParent() == layer.GetParent()) layer.GetParent().MoveChild(layer, top.GetIndex());
        ServerLink.I?.WhenUp(() => ServerLink.I!.Api!.OtherPushed += OnPush);
    }

    public override void _ExitTree()
    {
        if (ServerLink.I?.Api is { } api) api.OtherPushed -= OnPush;
        if (I == this) I = null;
    }

    private void OnPush(PushMsg m)
    {
        if (m.Type != "convo" || !m.Body.TryGetProperty("convo", out var c) || c.ValueKind != JsonValueKind.Object) return;
        try
        {
            if (JsonSerializer.Deserialize<Convo>(c.GetRawText(), Api.Json) is { } convo) Show(convo);
        }
        catch (JsonException)
        {
            // not a conversation: dropped
        }
    }

    /// <summary>A conversation to show (once; the same id again is ignored). at: the speaker's feet, instead of the town's place for them.</summary>
    public void Show(Convo c, Func<Vector3>? at = null) => Add(c, at, false);

    /// <summary>One line over a point (the head itself).</summary>
    public void Say(Func<Vector3> head, string name, string text, string who = "")
    {
        int id = -1_000_000 - seenOrder.Count - plays.Count;
        while (seen.Contains(id)) id--;
        Add(new Convo { Id = id, A = who, B = who, AName = name, BName = name, Purpose = "chat", Lines = new() { new ConvoLine { Who = who, Name = name, Text = text } }, Source = "engine" }, head, true);
    }

    private void Add(Convo c, Func<Vector3>? at, bool head)
    {
        if (seen.Contains(c.Id) || c.Lines.Count == 0) return;
        seen.Add(c.Id);
        seenOrder.Add(c.Id);
        if (seenOrder.Count > 200)
        {
            seenOrder.RemoveRange(0, 100);
            seen = new HashSet<int>(seenOrder);
        }
        var tag = new Tag();
        layer.AddChild(tag);
        plays.Add(new Play { C = c, Tag = tag, At = at, Head = head });
    }

    public int Active => plays.Count;

    private static double SecondsFor(string text) => Math.Min(4, 2.5 + text.Length / 90.0);

    public override void _Process(double delta)
    {
        if (plays.Count == 0) return;
        var cam = Main.I.Cam;
        float s = Dialogs.I?.Ui ?? Css.Ui(GetViewport().GetVisibleRect().Size.X);
        foreach (var p in plays.ToList())
        {
            p.T -= delta;
            if (p.T <= 0)
            {
                p.Line++;
                if (p.Line >= p.C.Lines.Count)
                {
                    p.Tag.QueueFree();
                    plays.Remove(p);
                    continue;
                }
                var l = p.C.Lines[p.Line];
                p.Who = l.Who;
                p.T = SecondsFor(l.Text);
                p.Tag.Set(l.Name, l.Text, s);
                Shown.Add($"{l.Name}: {l.Text}");
                if (Shown.Count > 40) Shown.RemoveAt(0);
                var feet = Feet(p);
                var info = InfoOf?.Invoke(l.Who);
                if (feet is { } at && cam != null && new Vector2(at.X - cam.GlobalPosition.X, at.Z - cam.GlobalPosition.Z).Length() < ShowM)
                    Speak?.Invoke(at, info?.Sex ?? "m", info?.Age ?? 30, Math.Min(p.T - 0.3, 3.5));
            }
            Place(p, cam, (float)delta);
        }
        // the oldest tags give way when there are too many
        int n = 0;
        foreach (var p in plays)
            if (++n > MaxTags) p.Tag.On = false;
        foreach (var p in plays) p.Tag.Fade((float)delta);
    }

    private Vector3? Feet(Play p) => p.At != null ? p.At() : PositionOf?.Invoke(p.Who);

    private void Place(Play p, Camera3D? cam, float dt)
    {
        var tag = p.Tag;
        var at = Feet(p);
        if (at == null || cam == null)
        {
            tag.On = false;
            return;
        }
        var feet = at.Value;
        if (new Vector2(feet.X - cam.GlobalPosition.X, feet.Z - cam.GlobalPosition.Z).Length() > ShowM)
        {
            tag.On = false;
            return;
        }
        Vector3 point = feet;
        if (!p.Head)
        {
            var info = InfoOf?.Invoke(p.Who);
            float head = info is { Age: < 13 } ? ChildHeadM : HeadM;
            point = new Vector3(feet.X, feet.Y + head + 0.15f, feet.Z);
        }
        // the speaker off the screen: no bubble (never a squashed one at the edge)
        var win = GetViewport().GetVisibleRect().Size;
        var view = (Vector2)Main.I.View.Size;
        if (cam.IsPositionBehind(point) || view.X < 1 || view.Y < 1)
        {
            tag.On = false;
            return;
        }
        var on = cam.UnprojectPosition(point) * win / view;
        if (on.X < 0 || on.X > win.X || on.Y < 0 || on.Y > win.Y)
        {
            tag.On = false;
            return;
        }
        // the bubble keeps its own size; near an edge it slides inside, the tail still points at the head
        var size = tag.Size;
        float cx = Math.Max(EdgePx + size.X / 2, Math.Min(win.X - EdgePx - size.X / 2, on.X));
        float cy = Math.Max(EdgePx + size.Y, Math.Min(win.Y - EdgePx, on.Y));
        tag.TailX = Math.Max(-size.X / 2 + 10, Math.Min(size.X / 2 - 10, on.X - cx));
        tag.Position = new Vector2(MathF.Round(cx - size.X / 2), MathF.Round(cy - size.Y));
        tag.On = true;
    }

    /// <summary>What is up now (the checks).</summary>
    public IReadOnlyList<(int Id, string Who, int Line, int Of, bool On)> Info() => plays.Select(p => (p.C.Id, p.Who, p.Line, p.C.Lines.Count, p.Tag.On)).ToList();

    /// <summary>
    /// One paper tag (.bubble): the speaker's name small over the line, in the hand; as wide as its words up to
    /// 200 CSS px; a small tail under it that points at the head. Drawn by hand, so its size is known at once.
    /// </summary>
    private sealed partial class Tag : Control
    {
        private static readonly Color Paper = Css.Filter(Css.Hex("d8cfb8"), 0.3f, 0.95f);
        private static readonly Color InkC = Css.Filter(Css.Ink, 0.3f, 0.95f);
        // .bubble: padding 3px 9px 4px; the type and the greatest width grow with --ui, the padding does not
        private const float PadX = 9, PadTop = 3, PadBottom = 4;
        private string name = "";
        private readonly List<string> lines = new();
        private int px = 14, namePx = 11;
        private readonly StyleBoxFlat box = new() { BgColor = Paper, ShadowColor = new Color(0, 0, 0, 0.4f), ShadowSize = 6, ShadowOffset = new Vector2(0, 3), AntiAliasing = true };
        public bool On;
        public float TailX;

        public Tag()
        {
            MouseFilter = MouseFilterEnum.Ignore;
            Modulate = new Color(1, 1, 1, 0);
            box.SetCornerRadiusAll(1);
        }

        public void Set(string who, string text, float s)
        {
            name = who;
            px = Mathf.RoundToInt(11 * s);
            namePx = Math.Max(1, Mathf.RoundToInt(px * 0.78f));
            // width: max-content, at most 200 CSS px (padding included): the words wrap at that
            float most = 200 * s - 2 * PadX;
            lines.Clear();
            float widest = name == "" ? 0 : PaperFonts.HandBold.GetStringSize(name, HorizontalAlignment.Left, -1, namePx).X;
            string line = "";
            foreach (string word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                string tryLine = line == "" ? word : line + " " + word;
                if (line != "" && PaperFonts.Hand.GetStringSize(tryLine, HorizontalAlignment.Left, -1, px).X > most)
                {
                    lines.Add(line);
                    line = word;
                }
                else line = tryLine;
            }
            if (line != "") lines.Add(line);
            foreach (string l in lines) widest = Math.Max(widest, PaperFonts.Hand.GetStringSize(l, HorizontalAlignment.Left, -1, px).X);
            float high = PadTop + PadBottom + (name == "" ? 0 : 1.25f * namePx) + lines.Count * 1.25f * px;
            Size = new Vector2(MathF.Ceiling(Math.Min(most, widest) + 2 * PadX), MathF.Ceiling(high));
            QueueRedraw();
        }

        /// <summary>.bubble: opacity over 0.2 s.</summary>
        public void Fade(float dt)
        {
            float want = On ? 1 : 0;
            float a = Modulate.A;
            if (a != want) Modulate = new Color(1, 1, 1, Mathf.MoveToward(a, want, dt / 0.2f));
            QueueRedraw();
        }

        public override void _Draw()
        {
            DrawStyleBox(box, new Rect2(Vector2.Zero, Size));
            float x = Size.X / 2 + TailX;
            DrawColoredPolygon(new[] { new Vector2(x - Tail, Size.Y - 0.5f), new Vector2(x + Tail, Size.Y - 0.5f), new Vector2(x, Size.Y + Tail) }, Paper);
            float y = PadTop;
            if (name != "")
            {
                y += Line(PaperFonts.HandBold, name, namePx, y, new Color(InkC, 0.65f));
            }
            foreach (string l in lines) y += Line(PaperFonts.Hand, l, px, y, InkC);
        }

        /// <summary>One line in its CSS line box (1.25 times the size high, the words in its middle); returns the box's height.</summary>
        private float Line(Font f, string text, int size, float top, Color colour)
        {
            float boxH = 1.25f * size;
            float ascent = f.GetAscent(size), descent = f.GetDescent(size);
            DrawString(f, new Vector2(PadX, top + (boxH - ascent - descent) / 2 + ascent), text, HorizontalAlignment.Left, -1, size, colour);
            return boxH;
        }
    }
}

/// <summary>A line someone says (api.ts ConvoLine).</summary>
public sealed record ConvoLine
{
    public string Who { get; init; } = "";
    public string Name { get; init; } = "";
    public string Text { get; init; } = "";
}

/// <summary>A conversation between two townspeople, as the server made it (api.ts Convo).</summary>
public sealed record Convo
{
    public int Id { get; init; }
    public string A { get; init; } = "";
    public string B { get; init; } = "";
    public string AName { get; init; } = "";
    public string BName { get; init; } = "";
    public string Purpose { get; init; } = "";
    public List<ConvoLine> Lines { get; init; } = new();
    public string Source { get; init; } = "";
    public string Outcome { get; init; } = "";
    public double At { get; init; }
    public int? EventId { get; init; }
}
