using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Ui.Dialogs;

namespace Scheldemist.Talks;

/// <summary>
/// Pitjesbak in a tavern (client/src/game/interiors.ts DicePanel, M6): three dice each, a number key throws for a
/// stake, the server rolls and pays; E or Esc stops. The server owns the dice, the stakes and the day's limits.
///
///   await Dice.I.Sit(place, patronId, first)                       sit down with a patron (the server names the stakes)
///   Dice.I.Show(place, patronId, first, line, stakes, left, money) the panel as given
///   Dice.I.Close(), Dice.I.IsOpen
///   Sfx                                                            the sound part: "thud_plank", "coins", "thud_soft"
/// </summary>
[GamePart(340)]
public partial class Dice : Node, IDialog
{
    public static Dice? I { get; private set; }

    private bool open;
    private string place = "";
    private string who = "";
    private string first = "";
    private List<int> stakes = new();
    private DiceLeft left = new();
    private int money;
    private double rolling;
    private bool busy;
    private int[] mine = { 1, 1, 1 };
    private int[] theirs = { 1, 1, 1 };
    private string[] scores = { "", "" };
    private string line = "";
    private string cls = "";
    private Sheet? sheet;
    private Faces? mineFaces, theirFaces;
    private readonly Random rand = new();

    /// <summary>The cup, the coins (the sound part).</summary>
    public Action<string>? Sfx { get; set; }
    /// <summary>The line on the panel now (the checks).</summary>
    public string Line => line;
    public bool Busy => busy;

    public Dice()
    {
        I = this;
    }

    public override void _Ready()
    {
        if (Dialogs.I is { } d) d.Resized += Render;
    }

    public override void _ExitTree()
    {
        if (Dialogs.I is { } d) d.Resized -= Render;
        if (I == this) I = null;
    }

    public string DialogName => "tavern dice";
    public bool IsOpen => open;

    /// <summary>Sit down with a patron of a tavern: the server says the stakes and what is left of the day's play. False (and a line in the middle) when it will not be.</summary>
    public async Task<bool> Sit(string place, string patron, string first)
    {
        try
        {
            if (ServerLink.I?.Api is not { } api) throw new ApiException("no server", 0);
            var r = await api.Post<DiceSit>("api/interior/dice/sit", new { place, patron });
            Show(place, patron, first, r.Line, r.Stakes, r.Left, GameState.I.Money);
            return true;
        }
        catch (ApiException e)
        {
            GameState.I.Say(e.Message);
            return false;
        }
    }

    public void Show(string place, string patron, string first, string line, IEnumerable<int> stakes, DiceLeft left, int money)
    {
        this.place = place;
        who = patron;
        this.first = first;
        this.stakes = stakes.ToList();
        this.left = left;
        this.money = money;
        this.line = line;
        cls = "";
        scores = new[] { "", "" };
        open = true;
        Dialogs.I?.Open(this);
        Render();
    }

    public void Close()
    {
        if (!open) return;
        open = false;
        Dialogs.I?.Close(this);
        sheet?.Card.QueueFree();
        sheet = null;
    }

    public void OnKey(string code, string key)
    {
        if (!open) return;
        if (code is "KeyE" or "Escape")
        {
            Close();
            return;
        }
        int n = Dialogs.Digit(key);
        if (n >= 1 && n <= stakes.Count) _ = ThrowFor(stakes[n - 1]);
    }

    private async Task ThrowFor(int stake)
    {
        if (busy || who == "") return;
        busy = true;
        rolling = 0.8;
        Sfx?.Invoke("thud_plank");
        line = "The cup rattles...";
        cls = "";
        Render();
        try
        {
            if (ServerLink.I?.Api is not { } api) throw new ApiException("no server", 0);
            var r = await api.Post<DiceResult>("api/interior/dice/throw", new { place, patron = who, stake });
            // the cup rattles its time out
            while (rolling > 0 && IsInsideTree()) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            rolling = 0;
            mine = r.Jef.Dice;
            theirs = r.Them.Dice;
            scores = new[] { r.Jef.Name, r.Them.Name };
            left = r.Left;
            money = r.Player.MoneyC;
            cls = r.Result > 0 ? "won" : r.Result < 0 ? "lost" : "";
            string head = r.Result > 0 ? $"You win {stake} c." : r.Result < 0 ? $"You lose {stake} c." : "Even: nobody pays.";
            line = $"{head} {r.Line}";
            Sfx?.Invoke(r.Result != 0 ? "coins" : "thud_soft");
            GameState.I.Apply(r);
        }
        catch (ApiException e)
        {
            rolling = 0;
            line = e.Message;
        }
        finally
        {
            busy = false;
            Render();
        }
    }

    public override void _Process(double delta)
    {
        if (!open || rolling <= 0) return;
        rolling -= delta;
        mine = new[] { rand.Next(1, 7), rand.Next(1, 7), rand.Next(1, 7) };
        theirs = new[] { rand.Next(1, 7), rand.Next(1, 7), rand.Next(1, 7) };
        mineFaces?.Set(mine);
        theirFaces?.Set(theirs);
    }

    private void Render()
    {
        if (!open || Dialogs.I is not { } dialogs) return;
        sheet?.Card.QueueFree();
        var win = GetViewport().GetVisibleRect().Size;
        // .dice-panel: not zoomed with --ui (the browser's px as they are): width min(520px, 86vw), padding 10 22 8, bottom 7%
        float w = Math.Min(520, win.X * 0.86f) + 44;
        var sh = new Sheet(1, w, Css.Hex("d4cab0"), (22, 10, 22, 8), -0.5f, sepia: 0.35f)
        {
            Where = (v, size) => new Vector2((v.X - size.X) / 2, v.Y - v.Y * 0.07f - size.Y),
        };
        sheet = sh;
        sh.Text($"[b]Pitjesbak with {Css.Esc(first)}[/b]", Face.Hand, 18, bottom: 6);
        mineFaces = Row(sh, "You", mine, scores[0]);
        theirFaces = Row(sh, first, theirs, scores[1]);
        Color? tone = cls == "won" ? sh.Tone(Css.Hex("2a5a20")) : cls == "lost" ? sh.Tone(Css.Hex("7a1a14")) : null;
        sh.Text(Css.Esc(line == "" ? " " : line), Face.Hand, 15, top: 6, bottom: 4, colour: tone);
        string throws = string.Join(" · ", stakes.Select((s, i) => $"{i + 1}  throw for {s} c"));
        sh.Keys($"{throws}{(throws == "" ? "" : " · ")}E  stop", Face.Hand, 12, 0.75f, top: 4, bottom: 0, align: HorizontalAlignment.Left);
        sh.Text($"An ace counts 100, a six 60; six-five-four beats points; three alike beat all. You have {money} c; {left.Games} throws left today, and you may lose {left.LossC} c more.", Face.Hand, 12, 0.75f);
        dialogs.Layer.AddChild(sh.Card);
        sh.Place();
    }

    private static Faces Row(Sheet sh, string name, int[] dice, string score)
    {
        var row = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        row.AddThemeConstantOverride("separation", 12);
        var who = sh.Plain(name, PaperFonts.Hand, 16);
        who.CustomMinimumSize = new Vector2(90, 0);
        who.ClipText = true;
        row.AddChild(who);
        var faces = new Faces { Ink = sh.Ink };
        faces.Set(dice);
        row.AddChild(faces);
        row.AddChild(sh.Plain(score, PaperFonts.HandBold, 16));
        sh.Add(sh.Margin(row, 2, 2));
        return faces;
    }

    /// <summary>Three dice faces drawn in ink (the browser's are the die glyphs of a symbol font, 34 px with 4 px between).</summary>
    private sealed partial class Faces : Control
    {
        private const float Die = 26;
        private const float Gap = 8;
        private int[] dice = { 1, 1, 1 };
        public Color Ink = Css.Ink;

        public Faces()
        {
            MouseFilter = MouseFilterEnum.Ignore;
            CustomMinimumSize = new Vector2(3 * Die + 3 * Gap, 34);
        }

        public void Set(int[] d)
        {
            dice = d;
            QueueRedraw();
        }

        public override void _Draw()
        {
            for (int i = 0; i < dice.Length && i < 3; i++)
            {
                var o = new Vector2(i * (Die + Gap) + 1, (Size.Y - Die) / 2);
                var box = new StyleBoxFlat { BgColor = Colors.Transparent, BorderColor = Ink, AntiAliasing = true };
                box.SetBorderWidthAll(2);
                box.SetCornerRadiusAll(5);
                DrawStyleBox(box, new Rect2(o, new Vector2(Die, Die)));
                float a = Die * 0.26f, m = Die * 0.5f, b = Die * 0.74f;
                var pips = dice[i] switch
                {
                    1 => new[] { (m, m) },
                    2 => new[] { (a, a), (b, b) },
                    3 => new[] { (a, a), (m, m), (b, b) },
                    4 => new[] { (a, a), (b, a), (a, b), (b, b) },
                    5 => new[] { (a, a), (b, a), (m, m), (a, b), (b, b) },
                    _ => new[] { (a, a), (b, a), (a, m), (b, m), (a, b), (b, b) },
                };
                foreach (var (x, y) in pips) DrawCircle(o + new Vector2(x, y), 2.4f, Ink, true, -1, true);
            }
        }
    }
}
