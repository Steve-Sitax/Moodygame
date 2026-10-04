using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

public sealed record MillTask(string Mill, WorkPoint Post, double DurationS, int Turns)
{
    public static MillTask? Of(Job j) => j.Task is { ValueKind: JsonValueKind.Object } t && t.TryGetProperty("kind", out var k) && k.GetString() == "mill" ? t.Deserialize<MillTask>(Api.Json) : null;
}
/// <summary>mills.ts MillRun: stay on the wall, answer each wind call, lean for five seconds.</summary>
public sealed class MillWork : IRun
{
    private readonly Job job;
    private readonly MillTask task;
    private readonly RunCtx ctx;
    private readonly Vector3 cap, stand;
    private readonly bool capstan;
    private double t, away, call = -1, turning = -1;
    private int calls, turns, shownSeconds = -1;
    private bool ended;
    private readonly List<string> hud = new();
    public bool Calling => call >= 0;
    public int Turns => turns;
    public Vector3 Stand => stand;
    public MillWork(Job job, MillTask task, RunCtx ctx)
    {
        this.job = job; this.task = task; this.ctx = ctx;
        using var doc = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));
        foreach (var m in doc.RootElement.GetProperty("mills").EnumerateArray()) if (m.GetProperty("id").GetString() == task.Mill)
        {
            if (m.GetProperty("capstan") is { ValueKind: JsonValueKind.Array } c) { capstan = true; cap = new(c[0].GetSingle(), Jef.I.Y + 0.9f, c[1].GetSingle()); stand = cap + new Vector3(1.25f, -0.9f, 0); }
            else { var door = m.GetProperty("door"); var tower = m.GetProperty("tower"); float x = door[0].GetSingle(), z = door[1].GetSingle(), ox = x - tower[0].GetSingle(), oz = z - tower[1].GetSingle(), len = MathF.Sqrt(ox * ox + oz * oz); stand = new(x - oz / len * 1.4f, Jef.I.Y, z + ox / len * 1.4f); cap = stand + Vector3.Up * 1.4f; }
            break;
        }
        // The wall floor is found at the goal by the player's body map; target height is read when used.
        ctx.Toast($"{job.EmployerName}: \"Stay by the mill. When the wind backs I'll call you to the {(capstan ? "capstan" : "chain")}.\""); WriteHud();
    }
    public void Update(float dt)
    {
        if (ended) return;
        bool near = RunWords.Dist(Jef.I.X, Jef.I.Z, task.Post.X, task.Post.Z) < 14 && Jef.I.Y > 3;
        if (near) t += dt; else away += dt;
        double next = task.DurationS * (0.25 + 0.5 * calls / Math.Max(1, task.Turns - 1));
        if (call < 0 && calls < task.Turns && t >= next) { call = 0; calls++; ctx.Toast($"{job.EmployerName}: \"She's backing! To the {(capstan ? "capstan" : "chain")}, quick!\""); ctx.Sfx("bell", null); WriteHud(); }
        if (call >= 0 && turning < 0) { call += dt; if (call > 40) { call = -1; ctx.Toast($"{job.EmployerName} brings the cap round on his own and does not look at you."); WriteHud(); } }
        if (turning >= 0)
        {
            turning += dt;
            if (RunWords.Dist(Jef.I.X, Jef.I.Z, stand.X, stand.Z) > 3.2f) { turning = -1; ctx.Toast("You let go of the spokes and the cap stops half way."); }
            else if (turning > 5) { turning = call = -1; turns++; ctx.Toast($"The cap grinds round until the sails face the wind. {job.EmployerName}: \"That's her.\""); WriteHud(); }
        }
        if (shownSeconds != (int)t) WriteHud();
        if (t >= task.DurationS && call < 0 && turning < 0) { ended = true; ctx.Finish(new Report { Turns = turns, LeftPostS = Math.Round(away) }); }
    }
    private void WriteHud() { shownSeconds = (int)t; hud.Clear(); hud.Add(job.Title); hud.Add($"Help at {task.Post.Label}: {RunWords.BellIn(task.DurationS - t)} left."); hud.Add($"Cap turned {turns} of {task.Turns}.{(Calling ? capstan ? " To the capstan!" : " To the chain!" : "")}"); }
    public List<Act> Actions()
    {
        var result = new List<Act>();
        if (!ended && call >= 0 && turning < 0 && RunWords.Dist(Jef.I.X, Jef.I.Z, stand.X, stand.Z) < 2.6f)
            result.Add(Act.At(Key.E, capstan ? "lean on the capstan: bring the cap round" : "haul on the chain: bring the cap round", new(cap.X, Jef.I.Y + (capstan ? 0.9f : 1.4f), cap.Z), () => { turning = 0; ctx.Toast(capstan ? "You put your shoulder to the spokes and walk the capstan round, the chain groaning." : "You haul hand over hand on the chain from the gallery."); }));
        return result;
    }
    public List<Act> CarryActions(Item item) => Actions();
    public Vector3? Goal() => Calling ? stand : new Vector3(task.Post.X, 0, task.Post.Z);
    public List<string> Hud() => hud;
    public string? PlaceLabel(Item item, float x, float z) => null;
    public void OnLifted(Item item) { }
    public void OnPlaced(Item item) { }
    public void OnLost(Item item, string? why = null) { }
    public void Dispose(bool keepGoods = false) => ended = true;
}
