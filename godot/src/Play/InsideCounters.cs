using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Talks;

namespace Scheldemist.Play;

/// <summary>interiors.ts counter actions, in the baked room; drinks use the ordinary trade engine.</summary>
[GamePart(358)]
public partial class InsideCounters : Node
{
    public static InsideCounters I { get; private set; } = null!;
    public sealed class Counter
    {
        public string Id = "", Kind = "", Keeper = "", Name = "", Label = "";
        public Vector3 At, Stand;
        public bool Open;
    }
    public readonly List<Counter> Counters = new();
    private readonly List<Interact.Entry> prompts = new();
    private double poll;
    private bool loading, dead;
    private int generation;
    public override void _Ready()
    {
        I = this;if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Reset;
        using var doc = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));
        foreach (var item in doc.RootElement.GetProperty("counters").EnumerateArray())
        {
            var p = item.GetProperty("counter"); var o = item.GetProperty("origin"); float yaw = item.GetProperty("yaw").GetSingle(), x = p.GetProperty("x").GetSingle(), z = p.GetProperty("z").GetSingle();
            var c = new Counter { Id = item.GetProperty("id").GetString()!, Kind = item.GetProperty("kind").GetString()!, At = new(o.GetProperty("x").GetSingle()+x*MathF.Cos(yaw)+z*MathF.Sin(yaw), item.GetProperty("floor_y").GetSingle()+1.2f, o.GetProperty("z").GetSingle()-x*MathF.Sin(yaw)+z*MathF.Cos(yaw)) }; Counters.Add(c);
            var stand = item.GetProperty("stand"); x = stand.GetProperty("x").GetSingle(); z = stand.GetProperty("z").GetSingle(); c.Stand = new(o.GetProperty("x").GetSingle()+x*MathF.Cos(yaw)+z*MathF.Sin(yaw), c.At.Y-1.2f, o.GetProperty("z").GetSingle()-x*MathF.Sin(yaw)+z*MathF.Cos(yaw));
            prompts.Add(Interact.I.Add(c.At, c.Kind == "shop" ? 1.4f : 1.2f, () => Available(c) ? c.Kind == "tavern" ? "talk to " + c.Name + ", the keeper" : c.Id == "shop:pawn_vis" ? "the Berg's counter: pawn or redeem" : "buy from " + c.Name : null, () => { if (c.Kind == "tavern") Talk.I!.Open(c.Keeper, c.Name, c.Label); else Open(c); }));
            prompts.Add(Interact.I.Add(c.At, c.Kind == "shop" ? 1.4f : 1.2f, () => Available(c) ? c.Kind == "tavern" ? "buy at the counter" : "talk to " + c.Name : null, () => { if (c.Kind == "tavern") Open(c); else Talk.I!.Open(c.Keeper, c.Name, c.Label); }, Key.F));
        }
    }
    private void Reset(string how,ClientState? state){generation++;poll=0;foreach(var c in Counters)c.Open=false;}
    private static bool Available(Counter c) => c.Open && c.Keeper != "" && MathF.Abs(Jef.I.Y - (c.At.Y - 1.2f)) < 0.6f;
    private static void Open(Counter c) { if (c.Id == "shop:pawn_vis") _ = Press.I!.OpenBerg(); else Talk.I!.Open(c.Keeper, c.Name, c.Label, true); }
    public override void _Process(double delta) { if ((poll -= delta) <= 0 && ServerLink.I?.Up == true) { poll = 15; _ = Load(); } }
    public async Task Load()
    {
        if (loading || dead || ServerLink.I?.Api is not { } api) return; loading = true;int g=generation;
        try
        {
            var taverns = await api.InsideDoors(); var shops = await api.ShopDoors(); if (dead||g!=generation) return;
            foreach (var c in Counters)
            {
                foreach (var info in c.Kind == "shop" ? shops.Shops : taverns.Taverns)
                {
                    if (c.Id != (c.Kind == "shop" ? "shop:" + info.Place : info.Place)) continue;
                    c.Open = info.Open; c.Label = info.Label;
                    if (info.Keeper is { } keeper) { c.Keeper = keeper.Id; c.Name = keeper.First; }
                    else c.Keeper = "";
                    break;
                }
            }
        }
        catch (ApiException) { }
        finally { loading = false; }
    }
    public override void _ExitTree() { dead = true;generation++;if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset; foreach (var p in prompts) p.Dispose(); }
}
