using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Windows;

namespace Scheldemist.Talks;

/// <summary>
/// The talk window (client/src/game/talk.ts, M3). The person speaks; Jef picks one of the lines (1-9) or types his
/// own (T). B shows what they sell and pays on the spot (M3b), H argues a price (M6), W takes the work they offer.
/// E or Esc steps away. The game never waits on the model: "Name ..." shows while the line is written, and a line
/// that does not come in the call's time becomes "Name does not answer."
///
///   Talk.I.Open(id, name, title)          talk to someone (the people's part calls this on E)
///   Talk.I.Open(id, name, title, true)    straight to the wares (F next to a seller)
///   Talk.I.Close(), Talk.I.IsOpen
///   OnOpen, OnClose                       the person stops and faces Jef while they talk
///   Work, WorkLater, OnTakeWork           the jobs' part: the work this person offers and how it is taken
///   OnBought, OnReply                     after a purchase; every reply as it comes (a thing handed over)
/// </summary>
[GamePart(300)]
public partial class Talk : Node, IDialog
{
    public static Talk? I { get; private set; }

    private sealed record Said(string Who, string Text, string? Note = null);

    private (string Id, string Name, string? Title)? npc;
    private bool busy;
    /// <summary>Bumped on every open, close and request: a reply for an older one is dropped (Jef turned to someone else meanwhile).</summary>
    private int req;
    private bool ended;
    /// <summary>A goodbye closes the window by itself once the last line is read (seconds left; 0: no timer).</summary>
    private double endIn;
    private List<string> choices = new();
    private List<string> lastChoices = new();
    private readonly List<Said> lines = new();
    /// <summary>M6 haggle: picking which ware to argue about, then the ware being argued.</summary>
    private bool picking;
    private string? haggleKind;
    /// <summary>M6 haggle: the list prices before a price was agreed, to put back after the purchase.</summary>
    private readonly Dictionary<string, List<Ware>> listBefore = new();
    private string mood = "";
    private bool typing;
    /// <summary>M9: his own words may be typed (false: the server has no AI to read them now; the choices only).</summary>
    private bool freeOk = true;
    private bool shopping;
    private bool working;
    private string note = "";
    private double noteLeft;
    private readonly Dictionary<string, List<Ware>> wares = new();
    private readonly Dictionary<string, (string Name, string Title)> known = new();

    private const string Placeholder = "Say it in your own words, then Enter";
    private Sheet? sheet;
    private LineEdit input = null!;

    /// <summary>Set by the people's part: a townsperson stops and faces Jef while they talk (M3e).</summary>
    public Action<string> OnOpen { get; set; } = _ => { };
    public Action<string> OnClose { get; set; } = _ => { };
    /// <summary>Open work this person offers. Not set by the jobs' part: the board's offered jobs of this employer, none with three in hand.</summary>
    public Func<string, IReadOnlyList<Job>>? Work { get; set; }
    /// <summary>This person has work open, but Jef has his hands full.</summary>
    public Func<string, bool>? WorkLater { get; set; }
    /// <summary>How work is taken. Not set: the server is asked, and a line says so.</summary>
    public Action<Job>? OnTakeWork { get; set; }
    /// <summary>After a purchase: the new state is in the store already; what the seller says.</summary>
    public Action<JobsPayload, string>? OnBought { get; set; }
    /// <summary>M6 gifts: every reply as it comes (the hands' part shows a thing handed over).</summary>
    public Action<string, TalkLine>? OnReply { get; set; }
    /// <summary>The last reply the server gave, for the checks.</summary>
    public TalkLine? LastReply { get; private set; }

    public Talk()
    {
        I = this;
    }

    public override void _Ready()
    {
        input = new LineEdit { MaxLength = 300, PlaceholderText = Placeholder, ContextMenuEnabled = false, CaretBlink = true };
        if (Dialogs.I is { } d) d.Resized += Render;
        ServerLink.I?.WhenUp(LoadWares);
    }

    public override void _ExitTree()
    {
        if (Dialogs.I is { } d) d.Resized -= Render;
        if (I == this) I = null;
    }

    /// <summary>What the four of the quay sell (/api/npcs) and what the townspeople sell and are (/api/town).</summary>
    private void LoadWares()
    {
        var api = ServerLink.I!.Api!;
        api.Run(api.Npcs(), list =>
        {
            foreach (var n in list)
            {
                if (!wares.ContainsKey(n.Id)) wares[n.Id] = n.Wares;
                known[n.Id] = (n.Name, "");
            }
        });
        api.Run(api.Town(), town =>
        {
            if (!town.TryGetProperty("residents", out var rs) || rs.ValueKind != JsonValueKind.Array) return;
            foreach (var r in rs.EnumerateArray())
            {
                string? id = r.TryGetProperty("id", out var i) ? i.GetString() : null;
                if (id == null) continue;
                known[id] = (r.TryGetProperty("name", out var nm) ? nm.GetString() ?? id : id, r.TryGetProperty("trade", out var tr) ? tr.GetString() ?? "" : "");
                if (r.TryGetProperty("wares", out var w) && w.ValueKind == JsonValueKind.Array && !wares.ContainsKey(id))
                    wares[id] = JsonSerializer.Deserialize<List<Ware>>(w.GetRawText(), Api.Json) ?? new();
            }
        });
    }

    // ------------------------------------------------------------------ the dialog

    public string DialogName => "talk";
    public bool Typing => typing;
    public bool IsOpen => npc != null;
    /// <summary>Who the window is open with.</summary>
    public string? With => npc?.Id;
    public bool Busy => busy;
    public bool Shopping => shopping;
    /// <summary>The answers offered now (the checks).</summary>
    public IReadOnlyList<string> Choices => choices;
    /// <summary>The lines on the paper now (the checks).</summary>
    public IReadOnlyList<(string Who, string Text)> Lines => lines.Select(l => (l.Who, l.Text)).ToList();
    /// <summary>The line in the keys' place now ("Paid 5 c."), or "".</summary>
    public string Note => note;

    private List<Ware> Stock => npc != null && wares.TryGetValue(npc.Value.Id, out var w) ? w : new List<Ware>();

    /// <summary>Does this person sell anything?</summary>
    public bool Sells(string id) => wares.TryGetValue(id, out var w) && w.Count > 0;

    /// <summary>What a townsperson sells (from the town's part, or a shop's list).</summary>
    public void SetWares(string id, List<Ware> list) => wares[id] = list;

    /// <summary>The name and the trade the town knows this person by, when it is loaded.</summary>
    public (string Name, string Title)? Who(string id) => known.TryGetValue(id, out var k) ? k : null;

    private IReadOnlyList<Job> JobsOf(string id)
    {
        if (Work != null) return Work(id);
        var st = GameState.I;
        if (st.Jobs.Count(j => j.Status == "taken") >= 3) return Array.Empty<Job>();
        return st.Jobs.Where(j => j.EmployerNpc == id && j.Status == "offered" && j.Playable).ToList();
    }

    private bool LaterOf(string id)
    {
        if (WorkLater != null) return WorkLater(id);
        var st = GameState.I;
        return st.Jobs.Count(j => j.Status == "taken") >= 3 && st.Jobs.Any(j => j.EmployerNpc == id && j.Status == "offered" && j.Playable);
    }

    /// <summary>Talk, or (shopOnly) go straight to the wares without a conversation. name empty: the town's name for them.</summary>
    public void Open(string id, string name = "", string? title = null, bool shopOnly = false)
    {
        if (name == "" && known.TryGetValue(id, out var k))
        {
            name = k.Name;
            title ??= k.Title;
        }
        if (name == "") name = id;
        if (npc != null && npc.Value.Id != id) OnClose(npc.Value.Id);
        endIn = 0;
        npc = (id, name, string.IsNullOrEmpty(title) ? null : title);
        OnOpen(id);
        lines.Clear();
        choices = new();
        freeOk = true;
        ended = shopOnly;
        shopping = shopOnly;
        working = false;
        picking = false;
        haggleKind = null;
        typing = false;
        mood = "";
        note = "";
        // a reply still on its way for the last person is dropped, and this window starts clean
        req++;
        busy = false;
        Dialogs.I?.Open(this);
        Render();
        if (shopOnly) _ = AskPrices(id);
        else _ = Send("open");
    }

    /// <summary>The prices he asks Jef now (a haggled price still good), not only the list.</summary>
    private async Task AskPrices(string id)
    {
        if (ServerLink.I?.Api is not { } api) return;
        try
        {
            var j = await api.Get<WaresReply>($"api/npc/{Uri.EscapeDataString(id)}/wares", 6000);
            if (j.Wares is not { Count: > 0 } || npc?.Id != id) return;
            NewPrices(id, j.Wares);
            Render();
        }
        catch (ApiException)
        {
            // the list as it was
        }
    }

    /// <summary>Say this in Jef's own words to whoever the window is open with (the checks).</summary>
    public Task Say(string text) => Send("free", text);

    public void Close()
    {
        endIn = 0;
        if (npc != null) OnClose(npc.Value.Id);
        npc = null;
        req++;
        busy = false;
        typing = false;
        Dialogs.I?.Close(this);
        Drop();
    }

    private void Drop()
    {
        if (sheet == null) return;
        if (input.GetParent() is { } p) p.RemoveChild(input);
        sheet.Card.QueueFree();
        sheet = null;
    }

    // ------------------------------------------------------------------ asking the server

    private async Task Send(string kind, string? text = null)
    {
        if (npc is not { } who || busy) return;
        busy = true;
        int my = ++req;
        if (text != null) lines.Add(new Said("You", text));
        choices = new();
        Render();
        TalkLine r;
        try
        {
            if (ServerLink.I?.Api is not { } api) throw new ApiException("no server", 0);
            r = await api.Talk(who.Id, kind, text);
        }
        catch (ApiException)
        {
            r = new TalkLine { NpcLine = $"{who.Name} does not answer.", Choices = new(), End = true };
        }
        if (my != req) return; // walked away or turned to someone else meanwhile
        busy = false;
        if (npc?.Id != who.Id) return;
        LastReply = r;
        if (r.Free != null) freeOk = r.Free.Value;
        if (string.IsNullOrEmpty(r.NpcLine))
        {
            // gated without a line: too fast, too long or empty; M9: no AI to read his own words now
            if (text != null && lines.Count > 0) lines.RemoveAt(lines.Count - 1);
            Flash(r.Gated == "too fast" ? "Catch your breath first." : r.Gated == "too long" ? "Too many words at once." : r.Gated == "no_ai" ? "No AI to hear your own words now. Pick an answer." : "");
            choices = r.Choices is { Count: > 0 } ? r.Choices : lastChoices;
            Render();
            return;
        }
        lines.Add(new Said(who.Name, r.NpcLine, r.Note));
        if (r.Wares != null) NewPrices(who.Id, r.Wares);
        OnReply?.Invoke(who.Id, r);
        mood = r.Mood ?? "";
        choices = r.End == true ? new() : r.Choices ?? new();
        lastChoices = choices;
        ended = r.End == true;
        Render();
        // time to read the last line (about 55 ms a letter), then the window goes; B or W before then keeps it
        if (ended) endIn = Math.Min(8000, Math.Max(2500, 1800 + r.NpcLine.Length * 55)) / 1000.0;
    }

    /// <summary>M6: the seller's prices after a haggle; the list prices are kept to put back after buying.</summary>
    private void NewPrices(string id, List<Ware> now)
    {
        if (!listBefore.ContainsKey(id)) listBefore[id] = wares.TryGetValue(id, out var was) ? was : now;
        wares[id] = now;
    }

    /// <summary>M6: argue the price of a ware in his own words (the server's gate, the model's reading, the engine's price).</summary>
    private async Task Haggle(string kind, string text)
    {
        if (npc is not { } who || busy) return;
        busy = true;
        int my = ++req;
        var ware = Stock.FirstOrDefault(w => w.Kind == kind);
        lines.Add(new Said("You", text));
        Render();
        TalkLine r;
        try
        {
            if (ServerLink.I?.Api is not { } api) throw new ApiException("no server", 0);
            r = await api.Haggle(who.Id, kind, text);
        }
        catch (ApiException e)
        {
            r = new TalkLine { NpcLine = $"{who.Name} shrugs. ({e.Message})" };
        }
        if (my != req) return;
        busy = false;
        if (npc?.Id != who.Id) return;
        LastReply = r;
        if (string.IsNullOrEmpty(r.NpcLine))
        {
            if (lines.Count > 0) lines.RemoveAt(lines.Count - 1);
            Flash(r.Gated == "too fast" ? "Catch your breath first." : r.Gated == "too long" ? "Too many words at once." : r.Gated == "no_ai" ? "No AI to hear your own words now." : "");
            Render();
            return;
        }
        lines.Add(new Said(who.Name, r.NpcLine, r.Note));
        if (r.Wares != null) NewPrices(who.Id, r.Wares);
        mood = r.Mood ?? mood;
        var now = r.Wares?.FirstOrDefault(w => w.Kind == kind);
        if (ware != null && now != null && now.PriceC < ware.PriceC) Flash($"{ware.Name}: {now.PriceC} c for you.");
        Render();
    }

    private async Task Buy(Ware w)
    {
        if (npc is not { } who) return;
        try
        {
            if (ServerLink.I?.Api is not { } api) throw new ApiException("no server", 0);
            var r = await api.Post<ShopBuyReply>("api/buy", new { npc = who.Id, kind = w.Kind });
            GameState.I.Apply(r);
            if (OnBought != null) OnBought(r, r.Line);
            else GameState.I.Say(r.Line);
            int paid = r.PriceC > 0 ? r.PriceC : w.PriceC;
            Flash($"Paid {paid} c.");
            // the server's prices after this purchase: a haggled price still good for more stays shown
            if (r.Wares is { Count: > 0 }) wares[who.Id] = r.Wares;
            else if (listBefore.TryGetValue(who.Id, out var list) && paid < (list.FirstOrDefault(x => x.Kind == w.Kind)?.PriceC ?? 0))
                wares[who.Id] = Stock.Select(x => x.Kind == w.Kind ? list.FirstOrDefault(l => l.Kind == x.Kind) ?? x : x).ToList();
        }
        catch (ApiException e)
        {
            Flash(e.Message);
        }
        Render();
    }

    /// <summary>The jobs' part not in yet: the server is asked for the job, and a line says what came of it.</summary>
    private async Task TakeWork(Job j)
    {
        Close();
        if (OnTakeWork != null)
        {
            OnTakeWork(j);
            return;
        }
        try
        {
            if (ServerLink.I?.Api is not { } api) throw new ApiException("no server", 0);
            await api.Take(j.Id);
            GameState.I.Apply(await api.Jobs());
            GameState.I.Say($"In your book: {j.Title}. J to follow it.");
        }
        catch (ApiException e)
        {
            string m = e.Message;
            GameState.I.Say(m.Length > 0 ? char.ToUpperInvariant(m[0]) + m[1..] + (".!?".Contains(m[^1]) ? "" : ".") : "That did not go through.");
        }
    }

    /// <summary>M6 haggle: open the input for his argument about this ware.</summary>
    private void StartHaggle(Ware w)
    {
        haggleKind = w.Kind;
        input.PlaceholderText = $"Argue the price of {w.Name} ({w.PriceC} c), then Enter";
        typing = true;
        Render();
    }

    private void Flash(string t)
    {
        note = t;
        noteLeft = 2.5;
    }

    public override void _Process(double delta)
    {
        if (noteLeft > 0 && (noteLeft -= delta) <= 0)
        {
            note = "";
            Render();
        }
        if (endIn > 0 && (endIn -= delta) <= 0)
        {
            endIn = 0;
            if (npc != null && ended && !shopping && !working && !typing) Close();
        }
    }

    // ------------------------------------------------------------------ the paper

    private void Render()
    {
        if (npc is not { } who || Dialogs.I is not { } dialogs) return;
        Drop();
        var win = GetViewport().GetVisibleRect().Size;
        float s = dialogs.Ui;
        // .talk: width min(640px, 88vw), padding 12 22 8, bottom 6%, a slight turn, paper through sepia(0.35)
        float w = Math.Min(640 * s, win.X * 0.88f) + 44 * s;
        var sh = new Sheet(s, w, Css.Hex("d4cab0"), (22, 12, 22, 8), -0.4f, sepia: 0.35f)
        {
            Where = (v, size) => new Vector2((v.X - size.X) / 2, v.Y - v.Y * 0.06f - size.Y),
        };
        sheet = sh;
        const HorizontalAlignment mid = HorizontalAlignment.Center;

        // .who: the name, the trade after it, the mood in a small slant
        string head = $"[b]{Css.Esc(who.Name)}[/b]";
        if (who.Title != null) head += $"[font_size={sh.Px(14)}][color=#{new Color(sh.Ink, 0.75f).ToHtml()}], {Css.Esc(who.Title)}[/color][/font_size]";
        if (mood != "") head += $" [font_size={sh.Px(13)}][color=#{new Color(sh.Ink, 0.85f).ToHtml()}][i]{Css.Esc(mood)}[/i][/color][/font_size]";
        sh.Text(head, Face.Hand, 18, bottom: 4, align: mid);

        // (CSS: the margins of two paragraphs fall together, 4 px between them)
        foreach (var l in lines.Skip(Math.Max(0, lines.Count - 4)))
        {
            bool you = l.Who == "You";
            sh.Text($"[b]{Css.Esc(l.Who)}:[/b] {Css.Esc(l.Text)}", Face.Print, you ? 14 : 16, you ? 0.7f : 1, 1.45f, 4, 0, mid);
            if (!string.IsNullOrEmpty(l.Note)) sh.Text($"[i]{Css.Esc(l.Note)}[/i]", Face.Print, 14, 0.7f, 1.45f, 1, 0, mid);
        }
        if (busy) sh.Text($"{Css.Esc(who.Name)} …", Face.Print, 16, 0.6f, 1.45f, 4, 0, mid);

        var jobs = JobsOf(who.Id);
        var stock = Stock;
        string shop = (stock.Count > 0 ? " · B  buy" : "") + (jobs.Count > 0 ? " · W  take work" : LaterOf(who.Id) ? " · work: finish yours first" : "");
        string keys =
            picking ? $"1-{stock.Count}  which one to argue about · Esc  back" :
            typing && haggleKind != null ? "Argue the price in your own words, then Enter · Esc  back" :
            shopping ? $"1-{stock.Count}  pay · H  argue a price · B  back to talk · you have {GameState.I.Money} c" :
            working ? $"{(jobs.Count > 1 ? $"1-{jobs.Count}" : "1")}  take it · W  back to talk" :
            ended ? $"E  step away{shop}" :
            busy ? "" :
            $"1-{Math.Max(1, choices.Count)}  answer{(freeOk ? " · T  say it your way" : "")}{shop} · E  step away";

        if (shopping)
        {
            sh.Rule(top: 8);
            for (int i = 0; i < stock.Count; i++) sh.Row(i + 1, Css.Esc(stock[i].Name), $"{stock[i].PriceC} c", gap: 8, boldN: false);
        }
        else if (working)
        {
            sh.Rule(top: 8);
            for (int i = 0; i < jobs.Count; i++) sh.Row(i + 1, Css.Esc(jobs[i].Title), $"{jobs[i].PayC} c", gap: 8, boldN: false);
        }
        else if (choices.Count > 0)
        {
            sh.Rule(top: 8);
            for (int i = 0; i < choices.Count; i++) sh.Row(i + 1, Css.Esc(choices[i]), centre: true);
        }
        sh.Keys(note != "" ? note : keys, lineHeight: 1.45f);

        if (typing)
        {
            // .talk-input: the line he types, under the keys
            StyleInput(sh);
            sh.Add(sh.Margin(input, 6, 4));
        }
        dialogs.Layer.AddChild(sh.Card);
        sh.Place();
        if (typing) input.CallDeferred(Control.MethodName.GrabFocus);
    }

    private void StyleInput(Sheet sh)
    {
        var box = new StyleBoxFlat { BgColor = sh.Tone(Css.Hex("e6ddc6")), BorderColor = sh.Tone(Css.Hex("8a7a5a")), ContentMarginLeft = sh.Px(8), ContentMarginRight = sh.Px(8), ContentMarginTop = sh.Px(6), ContentMarginBottom = sh.Px(6) };
        box.SetBorderWidthAll(Math.Max(1, sh.Px(1)));
        foreach (string k in new[] { "normal", "focus", "read_only" }) input.AddThemeStyleboxOverride(k, k == "focus" ? new StyleBoxEmpty() : box);
        input.AddThemeFontOverride("font", PaperFonts.Print);
        input.AddThemeFontSizeOverride("font_size", sh.Px(15));
        input.AddThemeColorOverride("font_color", sh.Ink);
        input.AddThemeColorOverride("font_placeholder_color", new Color(sh.Ink, 0.55f));
        input.AddThemeColorOverride("caret_color", sh.Ink);
        input.AddThemeColorOverride("selection_color", new Color(sh.Ink, 0.25f));
        input.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
    }

    // ------------------------------------------------------------------ the keys

    public void OnKey(string code, string key)
    {
        if (npc is not { } who) return;
        if (typing)
        {
            if (code == "Enter")
            {
                string t = input.Text.Trim();
                input.Text = "";
                typing = false;
                string? kind = haggleKind;
                haggleKind = null;
                input.PlaceholderText = Placeholder;
                if (t != "" && kind != null) _ = Haggle(kind, t);
                else if (t != "") _ = Send("free", t);
                else Render();
            }
            else if (code == "Escape")
            {
                typing = false;
                haggleKind = null;
                input.PlaceholderText = Placeholder;
                Render();
            }
            return;
        }
        var stock = Stock;
        int n = Dialogs.Digit(key);
        // M6 haggle: which ware to argue about
        if (picking)
        {
            if (code is "Escape" or "KeyH")
            {
                picking = false;
                Render();
            }
            else if (n >= 1 && n <= stock.Count)
            {
                picking = false;
                StartHaggle(stock[n - 1]);
            }
            return;
        }
        if (code is "KeyE" or "Escape")
        {
            Close();
            return;
        }
        if (code == "KeyH" && shopping && stock.Count > 0 && !busy)
        {
            if (stock.Count == 1) StartHaggle(stock[0]);
            else
            {
                picking = true;
                Render();
            }
            return;
        }
        if (code == "KeyB" && stock.Count > 0)
        {
            endIn = 0;
            shopping = !shopping;
            working = false;
            Render();
            return;
        }
        var jobs = JobsOf(who.Id);
        if (code == "KeyW" && (jobs.Count > 0 || working))
        {
            endIn = 0;
            working = !working;
            shopping = false;
            Render();
            return;
        }
        if (working)
        {
            if (n >= 1 && n <= jobs.Count) _ = TakeWork(jobs[n - 1]);
            return;
        }
        if (shopping)
        {
            if (n >= 1 && n <= stock.Count) _ = Buy(stock[n - 1]);
            return;
        }
        if (busy || ended) return;
        if (n >= 1 && n <= choices.Count)
        {
            _ = Send("choice", choices[n - 1]);
            return;
        }
        if (code == "KeyT")
        {
            // M9: no AI to read his own words: the choices only
            if (!freeOk)
            {
                Flash("No AI to hear your own words now. Pick an answer.");
                Render();
                return;
            }
            typing = true;
            Render();
        }
    }

    /// <summary>The checks: put words in the line he types (as the keyboard would).</summary>
    public void DevType(string text)
    {
        if (typing) input.Text = text;
    }
}

/// <summary>GET /api/npc/:id/wares: the prices he asks Jef now.</summary>
public sealed record WaresReply
{
    public List<Ware>? Wares { get; init; }
}

/// <summary>POST /api/buy: the game state, what the seller says, the price paid, and his prices after it.</summary>
public sealed record ShopBuyReply : JobsPayload
{
    public string Line { get; init; } = "";
    public int PriceC { get; init; }
    public List<Ware>? Wares { get; init; }
}
