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
/// The pages to read and the two counters (client/src/game/press.ts, M6; the bill and the notebook of
/// game/ideas.ts): the newspaper, a letter, a pawn ticket, a bill on a wall read large, a lost notebook, the Berg
/// van Barmhartigheid's counter (pawn, redeem) and the post office's (letters waiting, the round). The server owns
/// every fact and number; this side shows them. E, Esc or F puts a page away; a page's own keys are named on it.
///
///   Press.I.Read(item)        a paper, a letter, a ticket or a notebook from the pockets
///   Press.I.OpenPaper(day)    the paper of that day (he must have it in a pocket)
///   Press.I.OpenBerg()        the Berg's counter (E at the counter in the pawn office, F by the clerk)
///   Press.I.OpenPost()        the post office counter
///   Press.I.ShowBill(bill)    a bill read large; OpenBill(id) asks the server for it first
///   Press.I.Close(), Press.I.IsOpen, Press.I.Page ("paper", "letter", "ticket", "berg", "post", "bill", "diary")
///   Press.I.Info              today's paper, the newsboys' corners, the post office and the Berg (GET /api/press)
/// The pushes "press" (a line to say) and "clerk" (a clerk's word, as a bubble) are shown; "paper" marks the day's
/// paper printed.
/// </summary>
[GamePart(320)]
public partial class Press : Node, IDialog
{
    public static Press? I { get; private set; }
    private static readonly string[] Days = { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" };

    private Sheet? sheet;
    private string? page;
    private Dictionary<string, Action> keys = new();
    /// <summary>The page drawn again (the window's size changed).</summary>
    private Action? again;
    /// <summary>One counter request at a time: 1 then 2 pressed quickly does not pawn or take twice.</summary>
    private bool acting;
    private int convoId = -1;

    public PressInfo? Info { get; private set; }
    /// <summary>How work from a counter or a letter is taken. Not set: the server is asked.</summary>
    public Func<int, string, Task>? TakeJob { get; set; }
    /// <summary>What the server last answered at a counter (the checks).</summary>
    public string LastText { get; private set; } = "";

    public Press()
    {
        I = this;
    }

    public override void _Ready()
    {
        if (Dialogs.I is { } d) d.Resized += Redraw;
        if (Pockets.I is { } p) p.OnRead = it => _ = Read(it);
        ServerLink.I?.WhenUp(() =>
        {
            ServerLink.I!.Api!.OtherPushed += OnPush;
            _ = Load();
        });
    }

    public override void _ExitTree()
    {
        if (Dialogs.I is { } d) d.Resized -= Redraw;
        if (ServerLink.I?.Api is { } api) api.OtherPushed -= OnPush;
        if (I == this) I = null;
    }

    private void Redraw()
    {
        if (page != null) again?.Invoke();
    }

    /// <summary>GET /api/press; an answer without the paper (the server still starting) is no answer: asked again.</summary>
    private async Task Load()
    {
        for (int tries = 0; tries < 30 && IsInsideTree(); tries++)
        {
            try
            {
                var inf = await ServerLink.I!.Api!.Get<PressInfo>("api/press");
                if (inf.Paper != null && inf.Corners != null)
                {
                    Info = inf;
                    return;
                }
            }
            catch (ApiException)
            {
                // not yet
            }
            await ToSignal(GetTree().CreateTimer(4), SceneTreeTimer.SignalName.Timeout);
        }
    }

    private void OnPush(PushMsg m)
    {
        var b = m.Body;
        string Str(string k) => b.TryGetProperty(k, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() ?? "" : "";
        if (m.Type == "paper" && Info?.Paper != null)
        {
            int day = b.TryGetProperty("day", out var d) && d.TryGetInt32(out int n) ? n : Info.Paper.Day;
            Info = Info with { Paper = Info.Paper with { Day = day, Printed = true, Cry = Str("cry"), Headline = Str("headline") } };
        }
        else if (m.Type == "press" && Str("text") != "") GameState.I.Say(Str("text"));
        else if (m.Type == "clerk" && Str("who") != "" && Str("text") != "") Say(Str("who"), Str("name") == "" ? "The clerk" : Str("name"), Str("text"));
    }

    /// <summary>A line over someone's head, through the bubbles (with the made voice).</summary>
    public void Say(string who, string name, string text)
    {
        Bubbles.I?.Show(new Convo { Id = convoId--, A = who, B = who, AName = name, BName = name, Purpose = "chat", Lines = new() { new ConvoLine { Who = who, Name = name, Text = text } }, Source = "engine" });
    }

    // ------------------------------------------------------------------ the dialog

    public string DialogName => "press page";
    public bool IsOpen => page != null;
    /// <summary>Which page is up, or null.</summary>
    public string? Page => page;

    public void Close()
    {
        if (page == null) return;
        page = null;
        again = null;
        keys = new();
        Dialogs.I?.Close(this);
        sheet?.Card.QueueFree();
        sheet = null;
    }

    public void OnKey(string code, string key)
    {
        if (page == null) return;
        if (code is "KeyE" or "Escape" or "KeyF")
        {
            Close();
            return;
        }
        if (keys.TryGetValue(code, out var k)) k();
    }

    /// <summary>A new page: the old one goes, this one lies in the middle of the window, at most 88% of it high.</summary>
    private Sheet Begin(string kind, float width, Color paper, (float L, float T, float R, float B) pad, Dictionary<string, Action> pageKeys, Action redraw, float turn = 0, float sepia = 0, float contrast = 1)
    {
        sheet?.Card.QueueFree();
        var d = Dialogs.I!;
        var win = GetViewport().GetVisibleRect().Size;
        // .press-page: the type grows with --ui, the paper's own lengths do not
        var sh = new Sheet(d.Ui, width, paper, pad, turn, sepia, contrast, shadow: 30, drop: 8, shadowAlpha: 0.75f, maxHeight: win.Y * 0.88f, padScale: 1)
        {
            Where = (v, size) => (v - size) / 2,
        };
        sheet = sh;
        page = kind;
        keys = pageKeys;
        again = redraw;
        return sh;
    }

    private void End(Sheet sh)
    {
        Dialogs.I!.Layer.AddChild(sh.Card);
        sh.Place();
        Dialogs.I.Open(this);
    }

    private float Width(float css, float vw) => Math.Min(css, GetViewport().GetVisibleRect().Size.X * vw);

    private static string Cap(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];

    private static Font Spaced(Font f, int px) => new FontVariation { BaseFont = f, SpacingGlyph = px };

    // ------------------------------------------------------------------ reading

    /// <summary>Read what lies in a pocket: the paper, a letter, a pawn ticket, a notebook.</summary>
    public async Task Read(PocketItem it)
    {
        if (ServerLink.I?.Api is not { } api) return;
        try
        {
            if (it.Kind == "newspaper") ShowPaper(await api.Get<PaperPage>($"api/paper/{it.Ref}"), it);
            else if (it.Kind == "letter" && it.Ref is > 0) ShowLetter(await api.Get<LetterView>($"api/letter/{it.Ref}"), it);
            else if (it.Kind == "letter") GameState.I.Say("A letter for someone else. Not yours to open.");
            else if (it.Kind == "pawn_ticket") ShowTicket(await api.Get<TicketView>($"api/ticket/{it.Ref}"));
            else if (it.Kind == "diary") ShowDiary(await api.Get<DiaryView>($"api/diary/{it.Ref}"));
            else GameState.I.Say(it.Note ?? "Nothing to read on it.");
        }
        catch (ApiException e)
        {
            GameState.I.Say(e.Message);
        }
    }

    /// <summary>The paper of that day, from the pocket it lies in.</summary>
    public Task OpenPaper(int day)
    {
        var it = GameState.I.Pockets.FirstOrDefault(p => p.Kind == "newspaper" && p.Ref == day);
        if (it != null) return Read(it);
        GameState.I.Say("You have no such paper.");
        return Task.CompletedTask;
    }

    /// <summary>The newspaper: yellowed newsprint, a black masthead, the lead across, then three columns of small type.</summary>
    public void ShowPaper(PaperPage p, PocketItem? it = null)
    {
        var pageKeys = new Dictionary<string, Action>();
        if (it != null) pageKeys["KeyD"] = () => _ = Discard(it);
        var sh = Begin("paper", Width(880, 0.92f) + 52, Css.Hex("e4d6ae"), (26, 18, 26, 14), pageKeys, () => ShowPaper(p, it), sepia: 0.25f, contrast: 0.96f);
        const HorizontalAlignment mid = HorizontalAlignment.Center;

        // .mast: the number, the name in blackletter, the price
        var mast = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        var earL = sh.Plain($"No. {9000 + p.Day}", PaperFonts.PrintItalic, 11);
        earL.CustomMinimumSize = new Vector2(110, 0);
        earL.SizeFlagsVertical = Control.SizeFlags.ShrinkEnd;
        var name = sh.Plain(p.Name, Spaced(PaperFonts.Black, 1), 46);
        name.HorizontalAlignment = mid;
        name.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        var earR = sh.Plain($"{p.PriceC} centimes", PaperFonts.PrintItalic, 11);
        earR.CustomMinimumSize = new Vector2(110, 0);
        earR.HorizontalAlignment = HorizontalAlignment.Right;
        earR.SizeFlagsVertical = Control.SizeFlags.ShrinkEnd;
        mast.AddChild(earL);
        mast.AddChild(name);
        mast.AddChild(earR);
        sh.Add(mast);
        sh.Rule(top: 4, alpha: 1, dbl: true, thick: 3);
        sh.Text(SmallCaps($"van Antwerpen · {Css.Esc(p.Date)} · commerce, shipping and the town", sh.Px(12)), Face.Print, 12, top: 3, bottom: 3, align: mid);
        sh.Rule(bottom: 10, alpha: 1, solid: true);

        var lead = p.Articles.FirstOrDefault();
        if (lead != null)
        {
            sh.TextIn($"[b]{Css.Esc(lead.Headline)}[/b]", PaperFonts.Print, Spaced(PaperFonts.PrintBold, 2), PaperFonts.PrintItalic, 20, bottom: 3, align: mid);
            sh.Text(Css.Esc(lead.Text), Face.Print, 15, lineHeight: 1.32f, bottom: 4 + 8, align: mid);
            sh.Rule(bottom: 10, alpha: 1, solid: true);
        }

        // .cols: three columns, an article never split; filled in order to about the same height
        const float gap = 20;
        float colW = MathF.Floor((sh.Inner - 2 * gap) / 3);
        var blocks = new List<(Action<Container> Build, float Height)>();
        foreach (var a in p.Articles.Skip(1))
        {
            var art = a;
            blocks.Add((into =>
            {
                sh.TextIn($"[b]{Css.Esc(art.Headline)}[/b]", PaperFonts.Print, Spaced(PaperFonts.PrintBold, 1), PaperFonts.PrintItalic, 12.5f, bottom: 3, align: mid, into: into, width: colW);
                sh.Text(Css.Esc(art.Text), Face.Print, 13, lineHeight: 1.32f, bottom: 4 + 10, align: HorizontalAlignment.Fill, into: into, width: colW);
            }, Tall(sh, art.Headline, 12.5f, 1.3f, colW, true) + 3 + Tall(sh, art.Text, 13, 1.32f, colW) + 14));
        }
        var ins = p.Shipping.Where(x => x.Dir == "in").ToList();
        var outs = p.Shipping.Where(x => x.Dir == "out").ToList();
        float shipsH = Tall(sh, "SHIPPING INTELLIGENCE", 12.5f, 1.3f, colW, true) + 3 + 10;
        foreach (var x in ins.Concat(outs)) shipsH += Tall(sh, x.Line, 11.5f, 1.32f, colW) + 4;
        shipsH += (ins.Count > 0 ? 1 : 0) * (sh.Px(11) * 1.3f + 6) + (outs.Count > 0 ? 1 : 0) * (sh.Px(11) * 1.3f + 6);
        blocks.Add((into =>
        {
            sh.TextIn("[b]SHIPPING INTELLIGENCE[/b]", PaperFonts.Print, Spaced(PaperFonts.PrintBold, 1), PaperFonts.PrintItalic, 12.5f, bottom: 3, align: mid, into: into, width: colW);
            void List(string title, List<ShipLine> lines)
            {
                if (lines.Count == 0) return;
                sh.Text($"[i]{title}[/i]", Face.Print, 11, top: 4, bottom: 2, align: mid, into: into, width: colW);
                foreach (var x in lines) sh.Text(Css.Esc(x.Line), Face.Print, 11.5f, lineHeight: 1.32f, bottom: 4, into: into, width: colW);
            }
            List("Arrived", ins);
            List("Sailed", outs);
            sh.Gap(10, into);
        }, shipsH));
        if (p.Notices is { Count: > 0 } notices)
        {
            float h = Tall(sh, "WANTED", 12.5f, 1.3f, colW, true) + 3 + 10;
            foreach (string n in notices) h += Tall(sh, n, 11.5f, 1.32f, colW) + 4;
            blocks.Add((into =>
            {
                sh.TextIn("[b]WANTED[/b]", PaperFonts.Print, Spaced(PaperFonts.PrintBold, 1), PaperFonts.PrintItalic, 12.5f, bottom: 3, align: mid, into: into, width: colW);
                foreach (string n in notices) sh.Text(Css.Esc(n), Face.Print, 11.5f, lineHeight: 1.32f, bottom: 4, into: into, width: colW);
                sh.Gap(10, into);
            }, h));
        }
        var cols = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        cols.AddThemeConstantOverride("separation", 0);
        float total = blocks.Sum(b => b.Height);
        // the lowest column height that holds every article in three columns, in order (CSS balances the same way):
        // it is the height of some run of articles
        var runs = new List<float>();
        for (int i = 0; i < blocks.Count; i++)
        {
            float sum = 0;
            for (int j = i; j < blocks.Count; j++) runs.Add(sum += blocks[j].Height);
        }
        float best = total;
        foreach (float tryH in runs.Where(r => r >= total / 3 - 0.5f).OrderBy(r => r))
        {
            int col = 0;
            float used = 0;
            foreach (var b in blocks)
            {
                if (used > 0 && used + b.Height > tryH + 0.5f)
                {
                    col++;
                    used = 0;
                }
                used += b.Height;
            }
            if (col > 2) continue;
            best = tryH;
            break;
        }
        int at = 0;
        float filled = 0;
        var boxes = new List<VBoxContainer>();
        for (int c = 0; c < 3; c++)
        {
            if (c > 0)
            {
                // the rule between two columns
                var rule = new ColorRect { Color = new Color(sh.Ink, 0.6f), CustomMinimumSize = new Vector2(1, 0), MouseFilter = Control.MouseFilterEnum.Ignore };
                cols.AddChild(sh.Margin(rule, 0, 0, gap / 2 - 0.5f, gap / 2 - 0.5f));
            }
            var box = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, CustomMinimumSize = new Vector2(colW, 0) };
            box.AddThemeConstantOverride("separation", 0);
            boxes.Add(box);
            cols.AddChild(box);
        }
        foreach (var b in blocks)
        {
            if (filled > 0 && filled + b.Height > best + 0.5f && at < 2)
            {
                at++;
                filled = 0;
            }
            b.Build(boxes[at]);
            filled += b.Height;
        }
        sh.Add(cols);
        sh.Keys($"E or Esc to fold it{(it != null ? " · D to leave it on a bench" : "")}", Face.Print, 11, 0.7f, top: 10, bottom: 0);
        End(sh);
    }

    /// <summary>How high a paragraph stands in a column: for sharing the articles out over the columns.</summary>
    private static float Tall(Sheet sh, string text, float size, float lineHeight, float width, bool bold = false)
    {
        int px = sh.Px(size);
        Font f = bold ? PaperFonts.PrintBold : PaperFonts.Print;
        float own = f.GetHeight(px);
        var box = f.GetMultilineStringSize(text, HorizontalAlignment.Left, width, px);
        int lines = Math.Max(1, Mathf.RoundToInt(box.Y / own));
        return lines * Math.Max(own, lineHeight * px);
    }

    /// <summary>CSS small-caps: the small letters as capitals of a smaller size.</summary>
    private static string SmallCaps(string escaped, int px)
    {
        var sb = new System.Text.StringBuilder();
        bool small = false;
        int cap = Mathf.RoundToInt(px * 0.8f);
        for (int i = 0; i < escaped.Length; i++)
        {
            char c = escaped[i];
            // a tag of the escape ("[lb]") passes as it is
            if (c == '[')
            {
                int end = escaped.IndexOf(']', i);
                if (end > i)
                {
                    if (small) sb.Append("[/font_size]");
                    small = false;
                    sb.Append(escaped, i, end - i + 1);
                    i = end;
                    continue;
                }
            }
            bool low = char.IsLower(c);
            if (low && !small) sb.Append($"[font_size={cap}]");
            if (!low && small) sb.Append("[/font_size]");
            small = low;
            sb.Append(low ? char.ToUpperInvariant(c) : c);
        }
        if (small) sb.Append("[/font_size]");
        return sb.ToString();
    }

    /// <summary>A letter: laid paper, ink, the hand; an offer of work under it is taken with T.</summary>
    public void ShowLetter(LetterView l, PocketItem it)
    {
        var pageKeys = new Dictionary<string, Action> { ["KeyD"] = () => _ = Discard(it) };
        string offer = "";
        if (l.Job is { } job)
        {
            if (job.Status == "offered" && job.Today)
            {
                offer = $"{Css.Esc(job.Title)}{(job.PayC > 0 ? $", {job.PayC} centimes" : ", no pay")}. [b]T[/b] to take it on.";
                pageKeys["KeyT"] = () => _ = Take(job.Id, job.Title);
            }
            else offer = job.Status == "taken" ? "You have taken this on." : job.Status == "done" ? "Done." : "Too late for that now.";
        }
        var sh = Begin("letter", Width(520, 0.9f) + 60, Css.Hex("efe6cf"), (30, 22, 30, 14), pageKeys, () => ShowLetter(l, it), turn: -0.6f);
        sh.Under(new PaperArt { RuleEvery = 24 });
        float em = sh.Em(1, 15);
        sh.Text(Css.Esc($"Antwerp, {l.Date}"), Face.Hand, 15 * 0.85f, lineHeight: 1.5f, top: sh.Em(1, 15 * 0.85f), align: HorizontalAlignment.Right);
        sh.Text(Css.Esc(l.Salutation), Face.Hand, 15, lineHeight: 1.5f, top: em);
        sh.Text(Css.Esc(l.Body), Face.Hand, 15, lineHeight: 1.5f, top: em);
        if (!string.IsNullOrEmpty(l.Telegram))
        {
            // .wire: the words to send, in the telegraph's type on a lighter strip
            var strip = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
            strip.AddThemeStyleboxOverride("panel", new StyleBoxFlat { BgColor = new Color(1, 1, 1, 0.35f), ContentMarginLeft = 8, ContentMarginRight = 8, ContentMarginTop = 4, ContentMarginBottom = 4 });
            sh.TextIn($"To be wired{(string.IsNullOrEmpty(l.Offer?.City) ? "" : $" to {Css.Esc(l.Offer!.City)}")}: {Css.Esc(l.Telegram)}", PaperFonts.Mono, PaperFonts.Mono, PaperFonts.Mono, 15 * 0.85f, lineHeight: 1.5f, into: strip, width: sh.Inner - 16);
            sh.Add(sh.Margin(strip, em, 0));
        }
        sh.Text($"{Css.Esc(l.Closing)}\n{Css.Esc(l.Signature)}", Face.Hand, 15, lineHeight: 1.5f, top: em, bottom: em, align: HorizontalAlignment.Right);
        if (offer != "")
        {
            sh.Rule(alpha: 0.5f);
            sh.Text(offer, Face.Print, 15 * 0.8f, lineHeight: 1.5f, top: 6, bottom: sh.Em(1, 12));
        }
        sh.Keys("E or Esc to fold it · D to throw it away", Face.Hand, 11, 0.7f, top: 10, bottom: 0);
        End(sh);
    }

    /// <summary>A pawn ticket: a printed card in a double frame.</summary>
    public void ShowTicket(TicketView t)
    {
        var sh = Begin("ticket", Width(360, 0.88f) + 48 + 4, Css.Hex("d9d2bd"), (26, 22, 26, 14), new(), () => ShowTicket(t));
        var frame = Css.Hex("3a2320");
        var box = sh.Box;
        box.BorderColor = frame;
        box.SetBorderWidthAll(2);
        sh.Under(new PaperArt { FrameInset = 9, FrameDouble = true, FrameThick = 1.3f, FrameColour = frame });
        const HorizontalAlignment mid = HorizontalAlignment.Center;
        sh.TextIn("BERG VAN BARMHARTIGHEID · ANTWERPEN", Spaced(PaperFonts.Print, 1), PaperFonts.PrintBold, PaperFonts.PrintItalic, 14 * 0.8f, top: 4, bottom: 4, align: mid);
        sh.Text($"No. {t.No}", Face.Print, 14 * 1.8f, top: 6, bottom: 10, align: mid);
        sh.Text($"Pledge: {Css.Esc(t.Name)}", Face.Print, 14, top: 4, bottom: 4);
        sh.Text($"Lent: {t.LoanC} centimes, on {Days[((t.Day - 1) % 7 + 7) % 7]}.", Face.Print, 14, top: 4, bottom: 4);
        sh.Text($"Interest: {t.RateC} centimes for each day begun.", Face.Print, 14, top: 4, bottom: 4);
        sh.Text($"To redeem today: [b]{t.RedeemC} centimes[/b].", Face.Print, 14, top: 4, bottom: 4);
        sh.Text($"[i]Redeem by {Css.Esc(t.Due)}, or the pledge is sold.[/i]", Face.Print, 14, top: 4, bottom: 4);
        sh.Keys("E or Esc to put it away", Face.Print, 11, 0.7f, top: 10, bottom: 0);
        End(sh);
    }

    /// <summary>A lost notebook: small ruled pages in pencil.</summary>
    public void ShowDiary(DiaryView d)
    {
        var sh = Begin("diary", Width(460, 0.88f) + 52 + 14, Css.Hex("efe8d4"), (26 + 14, 16, 26, 12), new(), () => ShowDiary(d));
        sh.Ink = Css.Hex("3a3530");
        sh.Under(new PaperArt { RuleEvery = 22, RuleColour = new Color(60 / 255f, 80 / 255f, 120 / 255f, 0.16f), Spine = 14, SpineColour = Css.Hex("3b2c22") });
        sh.Text($"{Css.Esc(d.Owner)}\n[i]{Css.Esc(d.Near)}[/i]", Face.Hand, 14 * 0.95f, lineHeight: 1.55f, bottom: 6, align: HorizontalAlignment.Center);
        sh.Rule(bottom: 6, alpha: 0.4f, solid: true);
        foreach (var e in d.Entries)
        {
            sh.Text($"[u][b]{Css.Esc(e.Date)}[/b][/u]", Face.Hand, 14 * 0.95f, lineHeight: 1.55f, top: 8);
            sh.Text(Css.Esc(e.Text), Face.Hand, 14, lineHeight: 1.55f, bottom: 2);
        }
        string first = d.Owner.Split(' ')[0];
        sh.Text(Css.Esc($"Give it back at {first}'s door (E), keep it, or sell it to the Berg's clerk (G). E or Esc to close it."), Face.Hand, 11, 0.7f, top: 10, align: HorizontalAlignment.Right);
        End(sh);
    }

    /// <summary>A bill on a wall, read large: rag paper, big wood type, a rule under the heading.</summary>
    public void ShowBill(Bill p)
    {
        string kind = p.Kind;
        string paper = kind switch { "wanted" => "eadfbe", "lost" => "e2e0cf", "sailing" => "d8d2b6", "auction" => "e7d2a4", _ => "e7ddc0" };
        var sh = Begin("bill", Width(430, 0.88f) + 56 + 2, Css.Hex(paper), (29, 23, 29, 15), new(), () => ShowBill(p), turn: 0.8f, sepia: 0.2f, contrast: 0.97f);
        var box = sh.Box;
        box.BorderColor = sh.Tone(Css.Hex("8a7a5a"));
        box.SetBorderWidthAll(1);
        const HorizontalAlignment mid = HorizontalAlignment.Center;
        var slab = Spaced(PaperFonts.Slab, 2);
        sh.TextIn(Css.Esc(p.Text.Heading), slab, slab, slab, 34, lineHeight: 1.05f, bottom: 8, align: mid);
        sh.Rule(bottom: 10, alpha: 1, dbl: true, thick: 3);
        sh.Text(Css.Esc(p.Text.Body), Face.Print, 17, lineHeight: 1.4f, bottom: 12, align: mid);
        if (p.Text.Footer != "") sh.Text($"[i]{Css.Esc(p.Text.Footer)}[/i]", Face.Print, 14, bottom: 10, align: mid);
        sh.TextIn(SmallCaps("Printed by Buschmann, Antwerp", sh.Px(9)), Spaced(PaperFonts.Print, 1), PaperFonts.PrintBold, PaperFonts.PrintItalic, 9, 0.65f, top: 8, align: mid);
        sh.Keys("E or Esc to step back", Face.Print, 11, 0.7f, top: 10, bottom: 0);
        End(sh);
    }

    /// <summary>The bills up in the town now (GET /api/ideas).</summary>
    public async Task<List<Bill>> Bills()
    {
        if (ServerLink.I?.Api is not { } api) return new();
        return (await api.Get<IdeasView>("api/ideas")).Posters ?? new();
    }

    /// <summary>Read the bill with this id large (E at a wall). False when it is not up any more.</summary>
    public async Task<bool> OpenBill(int id)
    {
        try
        {
            var b = (await Bills()).FirstOrDefault(x => x.Id == id);
            if (b == null) return false;
            ShowBill(b);
            return true;
        }
        catch (ApiException e)
        {
            GameState.I.Say(e.Message);
            return false;
        }
    }

    private async Task Discard(PocketItem it)
    {
        try
        {
            var r = await ServerLink.I!.Api!.Post<JobsPayload>("api/pockets/discard", new { id = it.Id });
            GameState.I.Apply(r);
            Close();
        }
        catch (ApiException e)
        {
            GameState.I.Say(e.Message);
        }
    }

    // ------------------------------------------------------------------ the counters

    private Sheet Counter(string kind, string label, string sub, Dictionary<string, Action> pageKeys, Action redraw)
    {
        var sh = Begin(kind, Width(560, 0.9f) + 44, Css.Hex("d8cfb8"), (22, 16, 22, 12), pageKeys, redraw);
        sh.Text($"[b]{Css.Esc(Cap(label))}[/b]", Face.Hand, 22);
        sh.Text(sub == "" ? " " : sub, Face.Hand, 12, 0.75f, bottom: 8);
        return sh;
    }

    private static void CounterRow(Sheet sh, int n, string what, string right, string under = "")
    {
        var row = sh.Row(n, what, right, Face.Hand, 14, padY: 3, gap: 8, rule: true, under: under == "" ? "" : $"[i]{under}[/i]");
        // (the dashed rule is the line's own top border, a little fainter than the lists')
        foreach (var d in row.FindChildren("*", nameof(Dashes), true, false)) ((Dashes)d).Colour = new Color(sh.Ink, 0.3f);
    }

    /// <summary>The Berg van Barmhartigheid's counter: what it lends on, and the tickets to redeem.</summary>
    public async Task OpenBerg(string msg = "")
    {
        BergView v;
        try
        {
            if (ServerLink.I?.Api is not { } api) throw new ApiException("no server", 0);
            v = await api.Get<BergView>("api/berg");
        }
        catch (ApiException e)
        {
            GameState.I.Say(e.Message);
            return;
        }
        ShowBerg(v, msg);
    }

    private void ShowBerg(BergView v, string msg)
    {
        var pageKeys = new Dictionary<string, Action>();
        int money = GameState.I.Money;
        var sh = Counter("berg", v.Label, $"{(v.ClerkName != null ? $"{Css.Esc(v.ClerkName)} behind the grille" : "The counter")} · you have {money} c", pageKeys, () => ShowBerg(v, msg));
        int n = 0;
        if (!v.Open) sh.Text("The counter is shut. The Berg opens in the morning.", Face.Hand, 13, 0.75f, top: 2, bottom: 2);
        else
        {
            sh.Text("[b]Lend on it[/b]", Face.Hand, 13, top: 8, bottom: 2);
            if (v.Offers.Count == 0) sh.Text("You have nothing the Berg will lend on.", Face.Hand, 13, 0.75f, top: 2, bottom: 2);
            foreach (var o in v.Offers)
            {
                int k = ++n;
                var offer = o;
                CounterRow(sh, k, $"{Css.Esc(Cap(o.Name))}{(o.Item == 0 ? $" [font_size={sh.Px(14 * 0.8f)}][i](sewn in your coat)[/i][/font_size]" : "")}", $"{o.LoanC} c");
                pageKeys[$"Digit{k}"] = () => _ = Act("api/berg/pawn", new { item = offer.Item }, () => OpenBerg());
            }
            sh.Text("[b]Your tickets[/b]", Face.Hand, 13, top: 8, bottom: 2);
            if (v.Tickets.Count == 0) sh.Text("No pledges here.", Face.Hand, 13, 0.75f, top: 2, bottom: 2);
            foreach (var t in v.Tickets)
            {
                int k = ++n;
                var ticket = t;
                CounterRow(sh, k, $"No. {1000 + t.Id}: {Css.Esc(t.Name)}", $"redeem {t.RedeemC} c", $"lent {t.LoanC} c at {t.RateC} c a day; redeem by {Days[((t.DueDay - 1) % 7 + 7) % 7]} night");
                pageKeys[$"Digit{k}"] = () => _ = Act("api/berg/redeem", new { pawn = ticket.Id }, () => OpenBerg());
            }
        }
        sh.Text(Css.Esc(v.Terms), Face.Hand, 11, 0.8f, top: 10);
        if (msg != "") sh.Text(Css.Esc(msg), Face.Hand, 12, top: 6);
        sh.Keys($"{(n > 0 ? $"{(n > 1 ? $"1-{n}" : "1")} choose · " : "")}E or Esc to step away", Face.Hand, 11, 0.7f, top: 10, bottom: 0);
        End(sh);
    }

    /// <summary>The post office counter: letters waiting in the pigeonholes, the round of letters to walk.</summary>
    public async Task OpenPost(string msg = "")
    {
        PostView v;
        try
        {
            if (ServerLink.I?.Api is not { } api) throw new ApiException("no server", 0);
            v = await api.Get<PostView>("api/post");
        }
        catch (ApiException e)
        {
            GameState.I.Say(e.Message);
            return;
        }
        ShowPost(v, msg);
    }

    private void ShowPost(PostView v, string msg)
    {
        var pageKeys = new Dictionary<string, Action>();
        var sh = Counter("post", v.Label, v.ClerkName != null ? $"{Css.Esc(v.ClerkName)} at the counter" : "", pageKeys, () => ShowPost(v, msg));
        int k = 0;
        if (!v.Open) sh.Text("The office is shut. Open from eight in the morning till seven at night, not on Sunday.", Face.Hand, 13, 0.75f, top: 2, bottom: 2);
        else
        {
            // the choices are numbered from 1 in the order shown
            if (v.Waiting > 0)
            {
                int n = ++k;
                CounterRow(sh, n, $"{(v.Waiting == 1 ? "A letter waits" : $"{v.Waiting} letters wait")} for you in the pigeonholes", "");
                pageKeys[$"Digit{n}"] = () => _ = Act("api/post/collect", new { }, () => OpenPost());
            }
            else sh.Text("\"Nothing for you in the pigeonholes.\"", Face.Hand, 13, 0.75f, top: 2, bottom: 2);
            if (v.Round is { } round)
            {
                int n = ++k;
                CounterRow(sh, n, $"{Css.Esc(round.Title)}: {Css.Esc(round.Pitch)}", $"{round.PayC} c");
                pageKeys[$"Digit{n}"] = () => _ = Take(round.Id, round.Title);
            }
            else sh.Text("No round of letters to give out today.", Face.Hand, 13, 0.75f, top: 2, bottom: 2);
        }
        sh.Text($"Telegrams: {v.TelegramFeeC} centimes for {v.TelegramWords} words, anywhere in the kingdom.", Face.Hand, 11, 0.8f, top: 10);
        if (msg != "") sh.Text(Css.Esc(msg), Face.Hand, 12, top: 6);
        sh.Keys($"{(k > 1 ? "1-2 choose · " : k == 1 ? "1 choose · " : "")}E or Esc to step away", Face.Hand, 11, 0.7f, top: 10, bottom: 0);
        End(sh);
    }

    private async Task Take(int jobId, string title)
    {
        if (acting) return;
        acting = true;
        try
        {
            if (TakeJob != null) await TakeJob(jobId, title);
            else
            {
                var api = ServerLink.I!.Api!;
                await api.Take(jobId);
                GameState.I.Apply(await api.Jobs());
            }
            Close();
            LastText = $"You take the work: {title}.";
            GameState.I.Say(LastText);
        }
        catch (ApiException e)
        {
            LastText = e.Message;
            GameState.I.Say(e.Message);
        }
        finally
        {
            acting = false;
        }
    }

    private async Task Act(string url, object body, Func<Task> next)
    {
        if (acting) return;
        acting = true;
        try
        {
            var r = await ServerLink.I!.Api!.Post<CounterReply>(url, body);
            GameState.I.Apply(r);
            LastText = r.Text;
            GameState.I.Say(r.Text);
            await next();
        }
        catch (ApiException e)
        {
            LastText = e.Message;
            GameState.I.Say(e.Message);
        }
        finally
        {
            acting = false;
        }
    }
}
