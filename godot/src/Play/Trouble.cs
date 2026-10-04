using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Windows;

namespace Scheldemist.Play;

public sealed record TroubleStep(float X, float Z, string Label);
public sealed record TroubleLine(string Name, string? Who, string Text);
public sealed record TroubleOption(int N, string Label, TroubleStep? Step);
public sealed record TroubleView
{
    public int Id { get; init; }
    public int JobId { get; init; }
    public double AfterS { get; init; }
    public string Status { get; init; } = "";
    public string Scene { get; init; } = "";
    public List<TroubleLine> Lines { get; init; } = new();
    public List<TroubleOption> Options { get; init; } = new();
    public TroubleStep? Step { get; init; }
    public bool StepDone { get; init; }
}
public sealed record TroubleReply : JobsPayload
{
    public TroubleView? Trouble { get; init; }
    public string Text { get; init; } = "";
}

/// <summary>
/// The trouble card and its extra errand (game/ideas.ts). The server writes the scene, choices, money and pay.
/// The walk-up part can set Present and call Show once the speaker reaches Jef; until then a speaker already
/// within reach can speak, with the browser's ninety-second fallback. No person is made to appear beside Jef.
/// </summary>
[GamePart(340)]
public partial class Trouble : Node
{
    public static Trouble I { get; private set; } = null!;
    public Func<TroubleView, bool>? Present;
    public TroubleView? View { get; private set; }
    public bool IsOpen => card.IsOpen;
    public string LastReply { get; private set; } = "";
    private Window card = null!;
    private readonly HashSet<int> shown = new();
    private TroubleView? paper;
    private int? job;
    private double age, poll;
    private bool asking, choosing;
    private int world;

    public Trouble() => I = this;

    public override void _Ready()
    {
        card = new Window("trouble", Write, Key);
        Interact.I.AddProvider(Keys);
        ServerLink.I?.WhenUp(() => ServerLink.I.Api!.OtherPushed += m =>
        {
            if (m.Type is "trouble" or "ideas" or "resync") poll = 0;
        });
        if (Scheldemist.Menu.MainMenu.I is { } menu)
            menu.WorldReplaced += (_, _) =>
            {
                world++;
                card.Close();
                View = paper = null;
                shown.Clear();
                job = null;
                age = poll = 0;
            };
    }

    public override void _Process(double delta)
    {
        int? active = Jobs.I.Active?.Id;
        if (active != job)
        {
            job = active;
            age = poll = 0;
            View = null;
            card.Close();
        }
        if (job == null) return;
        age += delta;
        poll -= delta;
        if (poll <= 0 && !asking)
        {
            poll = 3;
            _ = Load();
        }
        if (View is not { Status: "ready" } t || t.JobId != job || shown.Contains(t.Id) || age < t.AfterS || Dialogs.I is not { Any: false }) return;
        bool near = Present?.Invoke(t) ?? t.Lines.Any(l => l.Who != null && Folk.Dist(l.Who, Jef.I.X, Jef.I.Z) <= RunWords.ReachPerson);
        if (near || age >= t.AfterS + 90) Show(t);
    }

    public async Task Load()
    {
        if (asking || ServerLink.I?.Api is not { } api) return;
        asking = true;
        int version = world;
        int? forJob = job;
        try
        {
            var r = await api.Get<TroubleReply>("api/trouble");
            if (version == world && forJob == job) View = r.Trouble;
        }
        catch (ApiException) { }
        finally { asking = false; }
    }

    /// <summary>The walk-up's speaker is before Jef: open the card.</summary>
    public void Show(TroubleView t)
    {
        if (t.JobId != Jobs.I.Active?.Id || t.Status != "ready" || shown.Contains(t.Id)) return;
        paper = t;
        shown.Add(t.Id);
        card.Open();
    }

    private Sheet? Write()
    {
        if (paper is not { } t || Dialogs.I is not { } d) return null;
        var win = GetViewport().GetVisibleRect().Size;
        var s = new Sheet(d.Ui, Math.Min(560 * d.Ui, win.X * 0.90f), Css.Hex("d8cfb8"), (22, 16, 22, 12), -0.6f, maxHeight: win.Y * 0.86f) { Where = Window.Middle };
        s.Text("[b]Trouble on the job[/b]", Face.Print, 19, bottom: 6);
        s.Text(Css.Esc(t.Scene), Face.Print, 16, lineHeight: 1.4f, bottom: 8);
        foreach (var l in t.Lines) s.Text($"[i][b]{Css.Esc(RunWords.Cap(l.Name))}:[/b] \"{Css.Esc(l.Text)}\"[/i]", Face.Print, 16, bottom: 4);
        foreach (var o in t.Options)
        {
            s.Rule(top: 4, bottom: 0);
            s.Row(o.N, Css.Esc(o.Label) + (o.Step != null ? $" [i](go to {Css.Esc(o.Step.Label)})[/i]" : ""), size: 16, padY: 4);
        }
        s.Keys($"1-{t.Options.Count} choose", Face.Hand);
        return s;
    }

    private void Key(string code, string key)
    {
        int n = Dialogs.Digit(key);
        if (paper is { } t && t.Options.Any(o => o.N == n)) _ = Choose(t, n);
    }

    private async Task Choose(TroubleView t, int n)
    {
        if (choosing || ServerLink.I?.Api is not { } api) return;
        choosing = true;
        int version = world;
        try
        {
            var r = await api.Post<TroubleReply>($"api/trouble/{t.Id}/choose", new { n });
            if (version != world) return;
            GameState.I.Apply(r);
            View = r.Trouble;
            LastReply = r.Text;
            GameState.I.Say(r.Text);
            card.Close();
        }
        catch (ApiException e)
        {
            if (version != world) return;
            LastReply = e.Message;
            GameState.I.Say(e.Message);
            card.Close();
        }
        finally { choosing = false; }
    }

    private Offers? Keys(float x, float z)
    {
        if (View is not { Step: { } step, StepDone: false } t || t.JobId != Jobs.I.Active?.Id || RunWords.Dist(x, z, step.X, step.Z) >= 3.4f) return null;
        return new Offers { Options = new() { (0, Act.AtGround(Godot.Key.E, $"see to it at {step.Label}", step.X, step.Z, () => _ = DoStep(t))) } };
    }

    private async Task DoStep(TroubleView t)
    {
        if (choosing || ServerLink.I?.Api is not { } api) return;
        choosing = true;
        int version = world;
        try
        {
            var r = await api.Post<TroubleReply>($"api/trouble/{t.Id}/step", new { x = Jef.I.X, z = Jef.I.Z });
            if (version != world) return;
            View = r.Trouble;
            LastReply = r.Text;
            GameState.I.Say(r.Text);
        }
        catch (ApiException e) { if (version == world) GameState.I.Say(e.Message); }
        finally { choosing = false; }
    }
}
