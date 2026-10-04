using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

/// <summary>townlife.ts player actions only; the event helper owns the fire and hiring actors.</summary>
[GamePart(357)]
public partial class TownWork : Node
{
    public static TownWork I { get; private set; } = null!;
    public bool InChain { get; private set; }
    private bool busy, loading, dead;
    private double poll;
    private int chainEvent;
    private Vector2 chainAt;
    private readonly List<Interact.Entry> prompts = new();
    public override void _Ready() { I = this; }
    public override void _Process(double delta) { if (InChain && !busy && chainAt.DistanceTo(new(Jef.I.X, Jef.I.Z)) > 2.8f) { InChain = false; _ = Call("leave", chainEvent); } if ((poll -= delta) <= 0 && ServerLink.I?.Up == true) { poll = 2; _ = Load(); } }
    public async Task Load()
    {
        if (loading || dead || ServerLink.I?.Api is not { } api) return; loading = true;
        try
        {
            var world = await api.Actions(); if (dead) return;
            foreach (var p in prompts) p.Dispose(); prompts.Clear(); bool foundChain = false;
            foreach (var e in world.Events)
            {
                if (e.Status != "running" || e.Acts == null || e.Stage >= e.Acts.Count) continue;
                if (e.Acts[e.Stage] == "fire_chain" && e.Fire is { ValueKind: JsonValueKind.Object } fire)
                {
                    if (e.Id == chainEvent && InChain) foundChain = true;
                    foreach (var at in fire.GetProperty("chain").EnumerateArray())
                    {
                        var point = new Vector3(at[0].GetSingle(), 1.1f, at[1].GetSingle());
                        prompts.Add(Interact.I.Add(point, 2.4f, () => !busy && !InChain ? "take a place in the bucket chain" : null, () => _ = Call("join", e.Id)));
                    }
                }
                if (e.Acts[e.Stage] == "hire_gather" && e.Hiring is { ValueKind: JsonValueKind.Object } hire && !AlreadyHiring(hire))
                    foreach (var spot in hire.GetProperty("spots").EnumerateArray())
                    {
                        if (spot.TryGetProperty("jef", out var jef) && jef.GetBoolean()) continue;
                        var point = new Vector3(spot.GetProperty("x").GetSingle(), 0.2f, spot.GetProperty("z").GetSingle());
                        prompts.Add(Interact.I.Add(point, 11, () => !busy ? "stand with the men to be hired" : null, () => _ = Call("hire", e.Id)));
                    }
            }
            if (!foundChain) InChain = false;
            if (InChain) prompts.Add(Interact.I.Add(new Vector3(Jef.I.X, 1.3f, Jef.I.Z), 3, () => !busy ? "step out of the bucket chain" : null, () => _ = Call("leave", chainEvent)));
        }
        catch (ApiException) { }
        finally { loading = false; }
    }
    private static bool AlreadyHiring(JsonElement hire) { foreach (var spot in hire.GetProperty("spots").EnumerateArray()) if (spot.TryGetProperty("jef", out var jef) && jef.GetBoolean()) return true; return false; }
    public async Task Call(string action, int ev)
    {
        if (busy || dead || ServerLink.I?.Api is not { } api) return; busy = true;
        try
        {
            var r = action == "join" ? await api.FireJoin(Jef.I.X, Jef.I.Z) : action == "leave" ? await api.FireLeave() : await api.HiringStand(Jef.I.X, Jef.I.Z);
            if (dead) return; GameState.I.Apply(r); GameState.I.Say(r.Result.Ok ? r.Result.Text ?? "" : r.Result.Why ?? "");
            if (r.Result.Ok && action is "join" or "leave") { InChain = action == "join"; chainEvent = ev; chainAt = new(Jef.I.X, Jef.I.Z); }
            poll = 0;
        }
        catch (ApiException e) { GameState.I.Say(e.Message); }
        finally { busy = false; }
    }
    public override void _ExitTree() { dead = true; foreach (var p in prompts) p.Dispose(); }
}
