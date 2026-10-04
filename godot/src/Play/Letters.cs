using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Windows;

namespace Scheldemist.Play;

// client/src/game/press.ts LettersRun: all pickup, door and wire facts belong to the server.
public sealed record LetterPlace(float X, float Z, string Label);
public sealed record LetterStop(string Id, string Name, float X, float Z, string What, bool Done = false);
public sealed record LettersTask
{
    public string Kind { get; init; } = "letters";
    public LetterPlace From { get; init; } = new(0, 0, "");
    public List<LetterStop> Stops { get; init; } = new();
    public int FeeC { get; init; }
    public bool Picked { get; init; }
    public static LettersTask? Of(Job j)
    {
        if (j.Task is not { ValueKind: JsonValueKind.Object } t || !t.TryGetProperty("kind", out var k) || k.GetString() != "letters") return null;
        try { return t.Deserialize<LettersTask>(Api.Json); }
        catch (JsonException) { return null; }
    }
}

public sealed record PostAsk(int Job, float X, float Z, int? Index = null);
public sealed record PostReply : JobsPayload
{
    public string Text { get; init; } = "";
}

public sealed class LettersRun : IRun
{
    private readonly Job job;
    private readonly RunCtx ctx;
    private LettersTask task;
    private readonly List<string> hud = new();
    private int delivered;
    private bool tele;
    private bool busy, finished, disposed;
    public bool Busy => busy;
    public LettersTask Task => task;
    public PostReply? LastReply { get; private set; }
    public static event Action<PostAsk, PostReply>? Answered;
    private bool Tele => tele;
    public LettersRun(Job job, LettersTask task, RunCtx ctx)
    {
        this.job = job; this.task = task; this.ctx = ctx;
        SetTask(task);
        if (!task.Picked) ctx.Toast($"Fetch {(Tele ? "the words for the wire" : task.Stops.Count == 1 ? "the letter" : "the letters")} at {task.From.Label}.");
    }
    public void Update(float dt)
    {
        if (disposed || finished || busy || !task.Picked || delivered != task.Stops.Count) return;
        finished = true;
        // Completion is counted again by the server; no client-proposed pay.
        int n = delivered;
        ctx.Progress(new Progress { Delivered = n });
        ctx.Finish(new Report { Delivered = n });
    }
    public List<Act> Actions()
    {
        var acts = new List<Act>();
        if (busy || finished || disposed) return acts;
        var p = Jef.I;
        if (!task.Picked)
        {
            if (RunWords.Dist(p.X, p.Z, task.From.X, task.From.Z) < 3.2f)
                acts.Add(Act.AtGround(Key.E, Tele ? "take the words for the telegram" : task.Stops.Count == 1 ? "take the letter" : "take the letters", task.From.X, task.From.Z, () => _ = Call("pickup")));
            return acts;
        }
        for (int i = 0; i < task.Stops.Count; i++)
        {
            var s = task.Stops[i];
            if (s.Done || RunWords.Dist(p.X, p.Z, s.X, s.Z) > (s.What == "telegraph" ? 3.2f : 2.4f)) continue;
            int index = i;
            acts.Add(Act.AtGround(Key.E, s.What == "door" ? $"put the letter under the door of {s.Name}" : $"send the telegram ({task.FeeC} c)", s.X, s.Z, () => _ = Call(s.What == "door" ? "deliver" : "telegram", index)));
            break;
        }
        return acts;
    }
    private async Task Call(string action, int? index = null)
    {
        if (busy || disposed || ServerLink.I?.Api is not { } api) return;
        busy = true;
        var ask = new PostAsk(job.Id, Jef.I.X, Jef.I.Z, index);
        try
        {
            var reply = action switch
            {
                "pickup" => await api.PostPickup(ask),
                "deliver" => await api.PostDeliver(ask),
                _ => await api.PostTelegram(ask)
            };
            Answered?.Invoke(ask, reply);
            if (disposed) return;
            LastReply = reply;
            var current = reply.Jobs.FirstOrDefault(j => j.Id == job.Id);
            if (current != null && LettersTask.Of(current) is { } next) SetTask(next);
            GameState.I.Apply(reply);
            ctx.Toast(reply.Text);
        }
        catch (ApiException e) { if (!disposed) ctx.Toast(e.Message); }
        finally { busy = false; }
    }
    public Vector3? Goal()
    {
        if (finished || disposed) return null;
        if (!task.Picked) return new Vector3(task.From.X, 0, task.From.Z);
        var s = Next();
        return s == null ? null : new Vector3(s.X, 0, s.Z);
    }
    private LetterStop? Next()
    {
        foreach (var stop in task.Stops) if (!stop.Done) return stop;
        return null;
    }
    // The card is read every frame. Build its words only when a server reply changes the task.
    private void SetTask(LettersTask next)
    {
        task = next; delivered = 0; tele = false;
        foreach (var stop in task.Stops) { if (stop.Done) delivered++; if (stop.What == "telegraph") tele = true; }
        hud.Clear();
        hud.Add(job.Title); // Jobs.RenderTask owns the heading's font; no BBCode in this plain-text line.
        if (!task.Picked) hud.Add($"Fetch {(Tele ? "the words" : task.Stops.Count == 1 ? "the letter" : "the letters")} at {Css.Esc(task.From.Label)}");
        else
        {
            var s = Next();
            hud.Add(s == null ? "All done." : s.What == "telegraph" ? $"Send it at the telegraph counter ({task.FeeC} c)" : $"Next: the door of {Css.Esc(s.Name)}");
            if (task.Stops.Count > 1) hud.Add($"{delivered} of {task.Stops.Count} delivered");
        }
    }
    public List<string> Hud() => hud;
    public List<Act> CarryActions(Item item) => new();
    public string? PlaceLabel(Item item, float x, float z) => null;
    public void OnLifted(Item item) { }
    public void OnPlaced(Item item) { }
    public void OnLost(Item item, string? why = null) { }
    public void Dispose(bool keepGoods = false) => disposed = true;
}
