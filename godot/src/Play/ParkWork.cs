using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

/// <summary>parkWork.ts: engine claims, real timed scooping, shared piles, daily wage and feeding.</summary>
[GamePart(354)]
public partial class ParkWork : Node
{
    public static ParkWork I { get; private set; } = null!;
    public ParkView? State { get; private set; }
    public bool Busy { get; private set; }
    private double poll, cleaning;
    private int? pile;
    private int generation;
    private bool dead;
    private readonly List<Interact.Entry> entries = new();
    private readonly List<MeshInstance3D> meshes = new();
    private readonly List<MeshInstance3D> marks = new();
    public static event Action<string, ParkAsk, ParkReply>? Answered;
    public override void _Ready()
    {
        I = this;
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced += Reset;
        var dung = new SphereMesh { Radius = 0.10f, Height = 0.065f, RadialSegments = 5, Rings = 3, Material = Goods.I.Plain(0x463726) };
        var chalk = new TorusMesh { InnerRadius = 0.2f, OuterRadius = 0.23f, Rings = 10, RingSegments = 3, Material = Goods.I.Plain(0xc0b281) };
        for (int i = 0; i < 128; i++)
        {
            var m = new MeshInstance3D { Mesh = dung, Visible = false }; Main.I.View.AddChild(m); meshes.Add(m);
            var ring = new MeshInstance3D { Mesh = chalk, Scale = new(1, 0.1f, 1), Visible = false }; Main.I.View.AddChild(ring); marks.Add(ring);
        }
        entries.Add(Interact.I.Add(new Vector3(-302.7f, 1, 299.5f), 2.6f, () => !Busy && State is { Open: true, Shift: null } ? "park work: clear 10 droppings — 35 c" : null, () => _ = Call("take")));
        entries.Add(Interact.I.Add(new Vector3(-302.7f, 1, 299.5f), 2.6f, () => !Busy && State?.Shift is { Paid: false } ? "return the scoop and abandon the round" : null, () => _ = Call("cancel"), Key.F));
        foreach (var at in new[] { new Vector3(-306, 0.2f, 303), new Vector3(-286, 0.2f, 292) })
            entries.Add(Interact.I.Add(at, 2.6f, () => !Busy && State?.Open == true ? "scatter grain for the birds — 1 c" : null, () => _ = Call("feed"), Key.G));
    }
    private readonly List<Interact.Entry> piles = new();
    private void Apply(ParkView state)
    {
        State = state;
        foreach (var e in piles) e.Dispose(); piles.Clear();
        for (int i = 0; i < meshes.Count; i++) { meshes[i].Visible = false; marks[i].Visible = false; }
        for (int i = 0; i < Math.Min(state.Piles.Count, meshes.Count); i++)
        {
            var p = state.Piles[i]; meshes[i].Position = new(p.X, 0.065f, p.Z); meshes[i].Visible = true;
            bool mine = state.Shift is { Paid: false } shift && shift.Ids.Contains(p.Id);
            marks[i].Position = new(p.X, 0.018f, p.Z); marks[i].Visible = mine;
            if (mine) piles.Add(Interact.I.Add(new Vector3(p.X, 0.08f, p.Z), 2.1f, () => !Busy && pile == null && State?.Open == true ? $"scoop droppings ({State.Shift!.Cleaned.Count}/10)" : null, () => _ = Prepare(p.Id)));
        }
    }
    public override void _Process(double delta)
    {
        if (pile is { } id && (cleaning -= delta) <= 0 && !Busy) { pile = null; _ = Call("clean", id); }
        if ((poll -= delta) <= 0 && !Busy && pile == null && ServerLink.I?.Up == true) { poll = 3; _ = Load(); }
    }
    private void Reset(string how, ClientState? client) { generation++; State = null; pile = null; poll = 0; foreach (var e in piles) e.Dispose(); piles.Clear(); foreach (var m in meshes) m.Visible = false; foreach (var m in marks) m.Visible = false; }
    public async Task Load() { if (Busy || dead || ServerLink.I?.Api is not { } api) return; Busy = true; int g = generation; try { var next = await api.ParkInfo(); if (!dead && g == generation) Apply(next); } catch (ApiException) { } finally { Busy = false; } }
    private async Task Prepare(int id) { int g = generation; if (await Call("prepare", id) && !dead && g == generation) { pile = id; cleaning = 1.9; } }
    public async Task<bool> Call(string action, int? id = null)
    {
        if (Busy || dead || ServerLink.I?.Api is not { } api) return false;
        Busy = true; int g = generation; var ask = new ParkAsk(new(Jef.I.X, Jef.I.Z, ""), id);
        try { var reply = await api.ParkAction(action, ask); if (dead || g != generation) return false; Answered?.Invoke(action, ask, reply); Apply(reply.Park); GameState.I.Apply(reply.State); if (action != "prepare") GameState.I.Say(reply.Text); return true; }
        catch (ApiException e) { GameState.I.Say(e.Message); return false; }
        finally { Busy = false; }
    }
    public override void _ExitTree() { dead = true; generation++; if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced -= Reset; foreach (var e in entries) e.Dispose(); foreach (var e in piles) e.Dispose(); foreach (var m in meshes) m.QueueFree(); foreach (var m in marks) m.QueueFree(); }
}
