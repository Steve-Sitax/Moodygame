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
    private int chainEvent,generation;
    private Vector2 chainAt;
    private HiringView? hiring;
    private int hiringEvent;
    private readonly List<Interact.Entry> prompts = new();
    public override void _Ready() { I = this; Interact.I.AddProvider(HiringOffers);if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Reset; }
    private void Reset(string how,ClientState? state){generation++;InChain=false;hiring=null;poll=0;foreach(var p in prompts)p.Dispose();prompts.Clear();}
    public override void _Process(double delta) { if (InChain && !busy && chainAt.DistanceTo(new(Jef.I.X, Jef.I.Z)) > 2.8f) { InChain = false; _ = Call("leave", chainEvent); } if ((poll -= delta) <= 0 && ServerLink.I?.Up == true) { poll = 2; _ = Load(); } }
    public async Task Load()
    {
        if (loading || dead || ServerLink.I?.Api is not { } api) return; loading = true;int g=generation;
        try
        {
            var world = await api.Actions(); if (dead||g!=generation) return;
            foreach (var p in prompts) p.Dispose(); prompts.Clear(); hiring = null; bool foundChain = false;
            foreach (var e in world.Events)
            {
                if (e.Status != "running" || e.Acts == null || e.Stage >= e.Acts.Count) continue;
                if (e.Acts[e.Stage] == "fire_chain" && e.Fire is { } fire)
                {
                    if (e.Id == chainEvent && InChain) foundChain = true;
                    foreach (var at in fire.Chain)
                    {
                        var point = new Vector3((float)at[0], 1.1f, (float)at[1]);
                        prompts.Add(Interact.I.Add(point, 2.4f, () => !busy && !InChain ? "take a place in the bucket chain" : null, () => _ = Call("join", e.Id)));
                    }
                }
                if (e.Acts[e.Stage] == "hire_gather" && e.Hiring is { } hire && !AlreadyHiring(hire))
                { hiring = hire; hiringEvent = e.Id; }
            }
            if (!foundChain) InChain = false;
            if (InChain) prompts.Add(Interact.I.Add(new Vector3(Jef.I.X, 1.3f, Jef.I.Z), 3, () => !busy ? "step out of the bucket chain" : null, () => _ = Call("leave", chainEvent)));
        }
        catch (ApiException) { }
        finally { loading = false; }
    }
    // Browser townlife.keys: standing among the men is a self action, independent of aim or height.
    private Offers? HiringOffers(float x, float z)
    {
        if (busy || hiring == null || AlreadyHiring(hiring)) return null;
        foreach (var spot in hiring.Spots)
        {
            float d = new Vector2((float)spot.X - x, (float)spot.Z - z).Length();
            if (d < 11) return new Offers { Options = new() { (d, Act.Me(Key.E, "stand with the men to be hired", () => _ = Call("hire", hiringEvent))) } };
        }
        return null;
    }
    private static bool AlreadyHiring(HiringView hire) { foreach (var spot in hire.Spots) if (spot.Jef) return true; return false; }
    public async Task Call(string action, int ev)
    {
        if (busy || dead || ServerLink.I?.Api is not { } api) return; busy = true;int g=generation;
        try
        {
            var r = action == "join" ? await api.FireJoin(Jef.I.X, Jef.I.Z) : action == "leave" ? await api.FireLeave() : await api.HiringStand(Jef.I.X, Jef.I.Z);
            if (dead||g!=generation) return; GameState.I.Apply(r); GameState.I.Say(r.Result.Ok ? r.Result.Text ?? "" : r.Result.Why ?? "");
            if (r.Result.Ok && action == "hire") hiring = null;
            if (r.Result.Ok && action is "join" or "leave") { InChain = action == "join"; chainEvent = ev; chainAt = new(Jef.I.X, Jef.I.Z); }
            poll = 0;
        }
        catch (ApiException e) { GameState.I.Say(e.Message); }
        finally { busy = false; }
    }
    public override void _ExitTree() { dead = true;generation++;if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset; foreach (var p in prompts) p.Dispose(); }
}
