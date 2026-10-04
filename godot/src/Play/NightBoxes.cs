using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;

namespace Scheldemist.Play;

/// <summary>questboxes.ts: a day employer's proof waits overnight; the engine keeps the facts.</summary>
[GamePart(360)]
public partial class NightBoxes : Node
{
    public static NightBoxes I { get; private set; } = null!;
    public sealed record Box(string Employer, string Name, Vector3 At);
    public readonly Dictionary<string, Box> Boxes = new();
    private readonly List<Node3D> models = new();
    private Townspeople? town;
    private TownData? built;
    private readonly Dictionary<string, Resident> residents = new();
    private double poll;
    public override void _Ready()
    {
        I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        var wood = Goods.I.Plain(0x4a3524); var iron = Goods.I.Plain(0x20180f);
        var post = new BoxMesh { Size = new(0.1f, 1.15f, 0.1f), Material = wood };
        var box = new BoxMesh { Size = new(0.48f, 0.32f, 0.25f), Material = wood };
        var slot = new BoxMesh { Size = new(0.30f, 0.025f, 0.012f), Material = iron };
        for (int i = 0; i < 32; i++)
        {
            var root = new Node3D { Name = "proof_box_" + i, Visible = false }; Main.I.View.AddChild(root); models.Add(root);
            root.AddChild(new MeshInstance3D { Mesh = post, Position = new(0, 0.575f, 0) });
            root.AddChild(new MeshInstance3D { Mesh = box, Position = new(0, 1.1f, 0) });
            root.AddChild(new MeshInstance3D { Mesh = slot, Position = new(0, 1.15f, -0.132f) });
        }
    }
    public override void _Process(double delta)
    {
        if ((poll -= delta) > 0) return; poll = 0.5;
        if (town?.Data is not { } data || town.Walk == null || data == built) return;
        built = data; Boxes.Clear(); residents.Clear(); foreach (var r in data.Residents) residents[r.Id] = r; foreach (var m in models) m.Visible = false;
        var ids = new List<string> { "sooi", "peeters", "tuur" }; ids.AddRange(data.Employers.Select(e => e.id));
        foreach (string id in ids)
        {
            var resident = data.Residents.FirstOrDefault(r => r.Id == id);
            if (resident?.Sched.Day.FirstOrDefault().A >= 20) continue;
            var at = Folk.At(id); if (at == null && resident?.Work.At is { Length: >= 2 } a) at = new((float)a[0], 0, (float)a[1]);
            if (at == null) continue;
            Vector3? placed = null;
            // Same radii and angle order as the browser; the town's walk map rejects water and walls.
            foreach (float radius in new[] { 1.3f, 1.7f, 2.2f, 2.8f, 1f, 3.6f, 4.6f, 6f })
            {
                for (int k = 0; k < 16; k++)
                {
                    float angle = k * MathF.Tau / 16 + 0.3f, x = at.Value.X + MathF.Cos(angle) * radius, z = at.Value.Z + MathF.Sin(angle) * radius;
                    if (!town.Walk.Free(x, z)) continue;
                    placed = new(x, (float)town.Walk.BaseAt(x, z), z); break;
                }
                if (placed != null) break;
            }
            if (placed is not { } point || Boxes.Count >= models.Count) continue;
            var b = new Box(id, resident?.Name ?? Folk.NameOf(id, id), point); models[Boxes.Count].Position = point;
            models[Boxes.Count].Rotation = new(0, MathF.Atan2(at.Value.X - point.X, at.Value.Z - point.Z), 0); models[Boxes.Count].Visible = true; Boxes[id] = b;
        }
    }
    public static bool Held(Job job) => job.Task is { } t && t.TryGetProperty("held", out var report) && report.ValueKind == JsonValueKind.Object;
    public bool Away(string id)
    {
        double h = GameState.I.HourF;
        if (id == "sooi") return h < 5 || h >= 20;
        if (id == "peeters") return h < 7 || h >= 19;
        if (id == "fientje") return h < 6 || h >= 18;
        if (id == "tuur") return h >= 2 && h < 7;
        return residents.TryGetValue(id, out var r) && Whereabouts.ActivityAt(r.Sched, GameState.I.Day, h).Act != "work";
    }
    public bool ShouldHold(Job job, Report report) => report.Box != true && !Held(job) && job.Source != "night" && Boxes.ContainsKey(job.EmployerNpc) && Away(job.EmployerNpc);
    public override void _ExitTree() { foreach (var m in models) m.QueueFree(); }
}

public partial class Jobs
{
    private async Task HoldProof(Job job, Report report)
    {
        if (finishing || ServerLink.I?.Api is not { } api) return; finishing = true;
        try
        {
            var reply = await api.Hold(job.Id, report); run?.Dispose(); run = null; active = null;
            GameState.I.Apply(reply); Start(reply.Job);
            Toast($"The work is done. {job.EmployerName} has gone home: drop the proof in his box and take your pay.");
        }
        catch (ApiException e) { Toast("Not held: " + e.Message); }
        finally { finishing = false; }
    }
}

public sealed class ProofWork : IRun
{
    private readonly Job job;
    private readonly RunCtx ctx;
    private readonly List<string> hud;
    private bool ended;
    public ProofWork(Job job, RunCtx ctx) { this.job = job; this.ctx = ctx; hud = new() { job.Title, "The work is done. Take the proof to your employer or his box." }; }
    public void Update(float dt) { }
    public List<Act> Actions()
    {
        var result = new List<Act>(); if (ended) return result;
        var boxes = NightBoxes.I;
        if (boxes.Away(job.EmployerNpc) && boxes.Boxes.TryGetValue(job.EmployerNpc, out var b))
        {
            if (RunWords.Dist(Jef.I.X, Jef.I.Z, b.At.X, b.At.Z) < 2.2f) result.Add(Act.At(Key.E, $"drop the proof in {b.Name}'s box and take your pay", b.At + Vector3.Up * 1.2f, () => { ended = true; ctx.Finish(new Report { Box = true }); }));
        }
        else if (Folk.At(job.EmployerNpc) is { } boss && RunWords.Dist(Jef.I.X, Jef.I.Z, boss.X, boss.Z) < 2.6f)
            result.Add(Act.At(Key.E, "give the proof to " + job.EmployerName, boss + Vector3.Up * 1.3f, () => { ended = true; ctx.Finish(new Report()); }));
        return result;
    }
    public List<Act> CarryActions(Item item) => Actions();
    public Vector3? Goal() => NightBoxes.I.Away(job.EmployerNpc) && NightBoxes.I.Boxes.TryGetValue(job.EmployerNpc, out var b) ? b.At : Folk.At(job.EmployerNpc);
    public List<string> Hud() => hud;
    public string? PlaceLabel(Item item, float x, float z) => null;
    public void OnLifted(Item item) { }
    public void OnPlaced(Item item) { }
    public void OnLost(Item item, string? why = null) { }
    public void Dispose(bool keepGoods = false) => ended = true;
}
