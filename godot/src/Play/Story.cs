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

/// <summary>
/// The story's part of the street (NativeStory on the server): the E keys at Pieter's lamps, his ladder, his book and
/// the lamplighter's door; the bent ladder and the book on the stones; the lamps it holds dark or lit for the
/// lamplighter's walk; the goal for the pointer. The server checks every step and keeps the facts; the quest book
/// (Jobs) shows the entry. Nothing here follows the giant.
/// </summary>
[GamePart(325)]
public partial class Story : Node
{
    public static Story? I { get; private set; }
    public StoryView? View => GameState.I.Payload?.Story;
    private Scheldemist.Town.Townspeople? town;
    private Node3D? ladder, book;
    private string placed = "";
    private bool busy;
    private double lift = -1;
    private StoryLamp? lighting;
    private Window paper = null!;
    private string heading = "", body = "";

    public override void _Ready()
    {
        I = this;
        town = Main.I.GetNodeOrNull<Scheldemist.Town.Townspeople>("Townspeople");
        paper = new Window("story paper", Write, (code, _) => { if (code is "KeyE" or "Escape") paper.Close(); });
        Interact.I.AddProvider(Keys);
        GameState.I.Changed += _ => Place();
        if (TownLife.I is { } life) { life.StoryLamp = Lamp; life.StoryCut = Cut; }
    }

    // ------------------------------------------------------------------ the lamps

    private double Absolute => (GameState.I.Day - 1) * 24 + GameState.I.HourF;
    /// <summary>A lamp the story holds: false dark (Pieter never lit it), true lit by Jef, null the clock's.</summary>
    private bool? Lamp(string id)
    {
        if (View is not { } v) return null;
        foreach (var l in v.Lamps) if (l.Id == id)
        {
            if (v.Status == "active" && !l.Lit) return false;
            if (l.Lit && Absolute < l.Until) return true;
        }
        return null;
    }
    /// <summary>Where the lamplighter's own walk stops on his round: before Pieter's stretch while the chapter runs.</summary>
    private int? Cut(string round)
    {
        if (View is not { Status: "active" } v || v.Round != round || TownLife.I is not { } life) return null;
        // Asked every frame by the lamplighter's walk: plain loops, nothing allocated.
        foreach (var run in life.LampRuns)
        {
            if (run.Round.Id != round) continue;
            var lamps = run.Round.Lamps;
            for (int k = 0; k < lamps.Count; k++) foreach (var l in v.Lamps) if (l.Id == lamps[k].Id) return k;
        }
        return null;
    }

    // ------------------------------------------------------------------ the props at the last stop

    private bool grounded;
    private Vector3 Ground(float x, float z, float up = 0) => new(x, (float)(town?.Walk?.BaseAt(x, z) ?? 0) + up, z);
    private void Place()
    {
        var v = View;
        string want = v == null || v.Status == "done" ? "" : $"{v.Ladder?.X:0.00},{v.Ladder?.Z:0.00},{v.Book?.Taken}";
        if (want == placed) return;
        placed = want; grounded = town?.Walk != null;
        if (GodotObject.IsInstanceValid(ladder)) ladder!.QueueFree();
        if (GodotObject.IsInstanceValid(book)) book!.QueueFree();
        ladder = book = null;
        if (v == null || want == "") return;
        if (v.Ladder is { } l)
        {
            // Lying along the kerb, rails on the stones, the bent top half lifted off them.
            var root = new Node3D { Name = "story_bent_ladder", Position = Ground(l.X, l.Z, 0.0225f), Rotation = new Vector3(0, l.Yaw, 0) };
            Main.I.View.AddChild(root);
            LeadLooks.Ladder(root, new Vector3(0, 0, -0.95f), -0.55f).Rotation = new Vector3(Mathf.Pi / 2, 0, 0);
            ladder = root;
        }
        if (v.Book is { Taken: false } b)
        {
            var root = new Node3D { Name = "story_route_book", Position = Ground(b.X, b.Z), Rotation = new Vector3(0, b.Yaw, 0) };
            Main.I.View.AddChild(root);
            // Oilcloth cover over a block of pages, lying open-cornered on the stones.
            root.AddChild(new MeshInstance3D { Mesh = Scheldemist.Models.BevelMesh.Shared(new Vector3(0.11f, 0.008f, 0.17f), 0.002f, Goods.I.Plain(0x2a2420)), Position = new Vector3(0, 0.004f, 0) });
            root.AddChild(new MeshInstance3D { Mesh = Scheldemist.Models.BevelMesh.Shared(new Vector3(0.1f, 0.014f, 0.16f), 0.0015f, Goods.I.Plain(0xd2c7aa)), Position = new Vector3(0.003f, 0.015f, 0) });
            root.AddChild(new MeshInstance3D { Mesh = Scheldemist.Models.BevelMesh.Shared(new Vector3(0.11f, 0.004f, 0.17f), 0.0015f, Goods.I.Plain(0x2a2420)), Position = new Vector3(0, 0.024f, 0.004f), Rotation = new Vector3(-0.12f, 0.08f, 0) });
            book = root;
        }
    }

    // ------------------------------------------------------------------ the keys

    private Offers? Keys(float x, float z)
    {
        if (View is not { Status: "active" } v || busy || lift >= 0) return null;
        var o = new Offers { Options = new List<(float, Act)>() };
        foreach (var l in v.Lamps)
        {
            if (l.Lit) continue;
            float d = Math.Min(RunWords.Dist(x, z, l.Sx, l.Sz), RunWords.Dist(x, z, l.X, l.Z) - 0.4f);
            var lamp = l;
            if (d < 2.2f) o.Options.Add((d, Act.At(Key.E, $"light {v.Helper}'s lamp with the pole", new Vector3(l.X, 2.4f, l.Z), () =>
            {
                if (!v.LampTime && GameState.I.HourF < v.Open && GameState.I.HourF >= 5) { GameState.I.Say($"Too early: the lamps are lit from {(int)v.Open}:{(int)Math.Round(v.Open % 1 * 60):00}, when the light goes."); return; }
                lighting = lamp; lift = 0;
            })));
        }
        if (v.Ladder is { } ladderAt && !v.Facts.Exists(f => f.Id == "ladder") && RunWords.Dist(x, z, ladderAt.X, ladderAt.Z) < 2.4f)
            o.Options.Add((RunWords.Dist(x, z, ladderAt.X, ladderAt.Z), Act.At(Key.E, $"look at {v.Helper}'s ladder", Ground(ladderAt.X, ladderAt.Z, 0.1f), () => _ = Call("api/story/inspect", new { what = "ladder", x = Jef.I.X, z = Jef.I.Z }))));
        if (v.Book is { Taken: false } bookAt && RunWords.Dist(x, z, bookAt.X, bookAt.Z) < 2.2f)
            o.Options.Add((RunWords.Dist(x, z, bookAt.X, bookAt.Z) - 0.1f, Act.At(Key.E, "pick up the book on the stones", Ground(bookAt.X, bookAt.Z, 0.05f), () => _ = Call("api/story/inspect", new { what = "book", x = Jef.I.X, z = Jef.I.Z }))));
        if (v.Inspected && v.Door is { } door && RunWords.Dist(x, z, door.X, door.Z) < 2.6f)
        {
            string first = v.LowieName.Split(' ')[0];
            o.Options.Add((RunWords.Dist(x, z, door.X, door.Z) + 0.3f, Act.At(Key.E, $"push a note under {first}'s door", Ground(door.X, door.Z, 1.1f), () => _ = Call("api/story/door", new { x = Jef.I.X, z = Jef.I.Z }))));
        }
        return o.Options.Count == 0 ? null : o;
    }
    public override void _Process(double delta)
    {
        // Props placed before the walk map was ready stood at height 0: put them on the stones now.
        if (!grounded && placed != "" && town?.Walk != null) { placed = ""; Place(); }
        if (lift < 0) return;
        // The loaned pole goes up into the lantern, the gas catches at the top of the lift, the pole comes down.
        lift += delta; LampPole.I?.Hold(); LampPole.I?.Aim(lift, null);
        if (lift >= 0.9 && lighting is { } lamp) { lighting = null; _ = Call("api/story/light", new { lamp = lamp.Id, x = Jef.I.X, z = Jef.I.Z }); }
        if (lift >= 2.3)
        {
            lift = -1;
            if (Jobs.I.Run is LampWork work) LampPole.I?.Show(work.Task); else LampPole.I?.Hide();
        }
    }
    private async Task Call(string path, object request)
    {
        if (busy || ServerLink.I?.Api is not { } api) return;
        busy = true;
        try
        {
            var reply = await api.Post<StoryReply>(path, request);
            GameState.I.Apply(reply);
            if (reply.Text != "") GameState.I.Say(reply.Text);
            if (reply.Paper is { } p) { heading = p.Title; body = p.Text; paper.Open(); }
        }
        catch (ApiException e) { GameState.I.Say(e.Message); }
        finally { busy = false; }
    }
    public void ClosePaper() => paper.Close();
    private Sheet? Write()
    {
        var sh = new Sheet(Dialogs.I!.Ui, 560, Css.Hex("e3d4ad"), (26, 18, 26, 14), maxHeight: GetViewport().GetVisibleRect().Size.Y * 0.85f) { Where = Window.Middle };
        sh.Text("[b]" + Css.Esc(heading) + "[/b]", Face.Print, 24, bottom: 14);
        sh.Text(Css.Esc(body), Face.Print, 16, lineHeight: 1.45f);
        sh.Keys("E or Esc to fold it away", Face.Hand);
        return sh;
    }

    // ------------------------------------------------------------------ for the quest book and the pointer

    /// <summary>Where the story wants Jef now (a person or a spot), with its words; null when nothing is to be found.</summary>
    public (string Label, Vector3 At)? Goal()
    {
        if (View is not { Goal: { } g } v || v.Status == "done") return null;
        if (g.Kind == "person") return g.Id != null && Folk.At(g.Id) is { } at ? (g.Label, at) : null;
        return (g.Label, Ground(g.X, g.Z));
    }
    public override void _ExitTree()
    {
        if (GodotObject.IsInstanceValid(ladder)) ladder!.QueueFree();
        if (GodotObject.IsInstanceValid(book)) book!.QueueFree();
        if (I == this) I = null;
    }
}
