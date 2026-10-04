using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>lampjob.ts: the server checks the pole, hour and each lamp. No client pay.</summary>
public sealed class LampWork : IRun
{
    private readonly Job job;
    private readonly RunCtx ctx;
    private LampsTask task;
    private readonly List<string> hud = new();
    private bool busy, ended, disposed;
    private double lift = -1;
    private LampPoint? lighting;
    public bool Busy => busy || lift >= 0;
    public LampsTask Task => task;
    public static event Action<LampAsk, PlacesReply>? Answered;
    public LampWork(Job job, LampsTask task, RunCtx ctx) { this.job = job; this.task = task; this.ctx = ctx; Sync(); }
    private void Sync()
    {
        hud.Clear(); hud.Add(job.Title);
        hud.Add(task.Picked ? $"{task.Lamps.Count(l => l.Done)} of {task.Lamps.Count} lamps lit" : "Fetch the spare pole at the first lamp.");
        foreach (var l in task.Lamps) if (l.Done) Lights.I?.SetLampLit(l.Id, true);
        LampPole.I?.Show(task);
    }
    public void Update(float dt)
    {
        if (disposed || ended) return;
        LampPole.I?.Aim(lift, lighting);
        if (lift >= 0) { lift += dt; if (lift >= 0.9 && !busy && lighting != null) { var l = lighting; lighting = null; _ = Call(l); } if (lift >= 2.3) lift = -1; }
        if (!busy && lift < 0 && (task.Lamps.TrueForAll(l => l.Done) || GameState.I.HourF >= task.Until))
        { ended = true; ctx.Finish(new Report { Delivered = task.Lamps.Count(l => l.Done) }); }
    }
    public List<Act> Actions()
    {
        var result = new List<Act>();
        if (disposed || ended || Busy) return result;
        var p = Jef.I;
        if (!task.Picked)
        {
            if (RunWords.Dist(p.X, p.Z, task.Pole.X, task.Pole.Z) < 2.8f)
                result.Add(Act.At(Key.E, "take the spare pole", new Vector3(task.Lamps[0].X, 1.2f, task.Lamps[0].Z), () => _ = Call(null)));
            return result;
        }
        LampPoint? nearest = null; float best = 2.2f;
        foreach (var l in task.Lamps)
        {
            if (l.Done) continue;
            float d = Math.Min(RunWords.Dist(p.X, p.Z, l.Sx, l.Sz), RunWords.Dist(p.X, p.Z, l.X, l.Z) - 0.4f);
            if (d < best) { best = d; nearest = l; }
        }
        if (nearest is { } lamp) result.Add(Act.At(Key.E, "light the lamp", new Vector3(lamp.X, 2.4f, lamp.Z), () =>
        {
            if (GameState.I.HourF < task.Open) { ctx.Toast($"Too early: the lamps are lit from {(int)task.Open}:{(int)Math.Round(task.Open % 1 * 60):00}, when the light goes."); return; }
            lighting = lamp; lift = 0;
        }));
        return result;
    }
    private async Task Call(LampPoint? lamp)
    {
        if (busy || disposed || ServerLink.I?.Api is not { } api) return;
        busy = true;
        var ask = new LampAsk(job.Id, Jef.I.X, Jef.I.Z, lamp?.Id);
        try
        {
            var reply = lamp == null ? await api.LampPole(ask) : await api.LampLight(ask);
            Answered?.Invoke(ask, reply);
            if (disposed) return;
            if (reply.Jobs.FirstOrDefault(j => j.Id == job.Id) is { } current && LampsTask.Of(current) is { } next) task = next;
            Sync(); GameState.I.Apply(reply); ctx.Toast(reply.Text);
        }
        catch (ApiException e) { if (!disposed) ctx.Toast(e.Message); }
        finally { busy = false; }
    }
    public Vector3? Goal() { if (!task.Picked) return new(task.Pole.X, 0, task.Pole.Z); foreach (var l in task.Lamps) if (!l.Done) return new(l.Sx, 0, l.Sz); return null; }
    public List<string> Hud() => hud;
    public List<Act> CarryActions(Item item) => new();
    public string? PlaceLabel(Item item, float x, float z) => null;
    public void OnLifted(Item item) { }
    public void OnPlaced(Item item) { }
    public void OnLost(Item item, string? why = null) { }
    public void Dispose(bool keepGoods = false) { disposed = true; LampPole.I?.Hide(); }
}

/// <summary>The pole's materials and meshes are prepared at load, before the first frame.</summary>
[GamePart(350)]
public partial class LampPole : Node
{
    public static LampPole? I { get; private set; }
    private Node3D pole = null!;
    private bool held;
    public override void _Ready()
    {
        I = this; pole = new Node3D { Name = "player_lamp_pole", Visible = false };
        Main.I.View.AddChild(pole);
        var wood = Goods.I.Plain(0x5a3a20); var brass = Goods.I.Plain(0xb8923a);
        pole.AddChild(new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = 0.016f, BottomRadius = 0.021f, Height = 2.5f, RadialSegments = 6, Material = wood }, Position = new(0, 1.25f, 0) });
        pole.AddChild(new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = 0.023f, BottomRadius = 0.023f, Height = 0.09f, RadialSegments = 6, Material = brass }, Position = new(0, 2.45f, 0) });
        pole.AddChild(new MeshInstance3D { Mesh = new BoxMesh { Size = new(0.012f, 0.1f, 0.012f), Material = brass }, Position = new(0.035f, 2.52f, 0) });
    }
    public void Show(LampsTask task)
    {
        held = task.Picked; pole.Visible = true;
        pole.Reparent(held ? Main.I.Cam : Main.I.View);
        pole.Position = held ? new(0.38f, -0.6f, -0.6f) : new(task.Lamps[0].X + 0.15f, 0, task.Lamps[0].Z);
        pole.Rotation = Vector3.Zero;
    }
    public void Aim(double lift, LampPoint? lamp) { if (held) pole.Rotation = new(0, 0, lift < 0 ? -0.08f : (float)(-0.08 - Math.Sin(Math.Min(1, lift / 2.3) * Math.PI) * 0.24)); }
    public void Hide() => pole.Visible = false;
    public override void _ExitTree() { pole.QueueFree(); if (I == this) I = null; }
}
