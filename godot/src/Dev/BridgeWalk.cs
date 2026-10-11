using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Player;
using Scheldemist.Town;

namespace Scheldemist.Dev;

/// <summary>
/// People on foot and the opening bridges (fix 2026-10-11: a policeman walked in the air over the dock while the
/// bridge was up). -- --bridgewalk dir (with a game server and --no-mainmenu): at the canal's middle bridge, then at
/// the lock's bridge, the bridge is asked up; a summoned policeman and six walkers are sent across, three each way.
/// Every quarter second nobody may stand on a deck that is not down; while it is up they wait at its ends; when it
/// is down again everyone must get across. Writes dir/bridgewalk.json and a picture of each stage, then quits.
/// </summary>
[GamePart(960)]
public partial class BridgeWalk : Node
{
    private string dir = "";
    private bool started;
    private readonly List<object> stages = new();
    private readonly List<string> problems = new();

    private sealed record Span(string Key, Bridges.Rect Rect, bool AlongX, Func<bool> Down, Func<float> Up, Action<bool> Ask);

    public override void _Ready()
    {
        dir = Paths.TestOutput("bridgewalk");
        if (dir == "") SetProcess(false);
        else Directory.CreateDirectory(dir);
    }

    public override void _Process(double delta)
    {
        if (started || !GameState.I.Live || Kit.I?.People?.Data == null || Kit.I.People.Crowd == null || Bridges.I == null) return;
        started = true;
        _ = Run();
    }

    private async Task Run()
    {
        try
        {
            await Kit.I.Light(13, "clear");
            var mid = Bridges.I.List.First(c => c.Key == "canal_mid");
            await One(new Span("canal_mid", mid.Rect, true, () => mid.Closed, () => mid.Open, on => Bridges.I.Request(mid.Key, "bridgewalk", on)));
            await One(new Span("lock_bridge", Lock.BridgeRect, true, () => Lock.I.BridgeClosed, () => Lock.I.Lift, on => Lock.I.Request(on)));
        }
        catch (Exception e) { problems.Add("error: " + e.Message); }
        File.WriteAllText(Path.Combine(dir, "bridgewalk.json"), JsonSerializer.Serialize(new { ok = problems.Count == 0, problems, stages }, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"bridgewalk: {(problems.Count == 0 ? "PASS" : "FAIL")} {string.Join("; ", problems)}");
        GetTree().Quit();
    }

    private async Task One(Span s)
    {
        var town = Kit.I.People!;
        var crowd = town.Crowd!;
        var r = s.Rect;
        double cx = (r.MinX + r.MaxX) / 2, cz = (r.MinZ + r.MaxZ) / 2;
        // the two ends, a few metres off the deck, on ground one can stand on
        var west = Kit.I.FreeNear(r.MinX - 3.5, cz, crowd: true);
        var east = Kit.I.FreeNear(r.MaxX + 3.5, cz, crowd: true);
        // Jef to the side, off the deck (he would hold it down), looking at it
        var view = Kit.I.FreeNear(cx - 3, r.MaxZ + 9);
        Jef.I.Place((float)view.X, (float)view.Z, MathF.Atan2(-(float)(cx - view.X), -(float)(cz - view.Z)), -0.12f);
        town.Refill();
        await Frames(30);
        s.Ask(true);
        if (!await Until(() => s.Up() > 0.9f, 60)) problems.Add($"{s.Key}: did not go up");
        // the policeman: a resident with his own goal across the bridge (the town walks him), and six plain walkers
        string id = Kit.I.Summon("police");
        var police = town.Sims.First(q => q.R.Id == id);
        police.P!.X = west.X; police.P.Z = west.Z;
        police.Goal = new Townspeople.Goal { Mode = "stand", X = east.X, Z = east.Z, Motion = "idle" };
        police.Tries = 0;
        var walkers = new List<(Puppet p, Pt to)>();
        for (int i = 0; i < 6; i++)
        {
            var from = i < 3 ? west : east;
            var to = i < 3 ? east : west;
            var at = Kit.I.FreeNear(from.X + (i % 3 - 1) * 1.2, from.Z + (i % 3 - 1) * 1.2, crowd: true);
            var p = crowd.AddPuppet(i % 2 == 0 ? "docker_a" : "fishwife_a", at.X, at.Z);
            if (p == null) { problems.Add($"{s.Key}: walker {i} could not be made"); continue; }
            crowd.PuppetGo(p, to.X, to.Z);
            walkers.Add((p, to));
        }
        int onDeck = 0, maxWaiting = 0;
        string Watch()
        {
            int waiting = 0;
            foreach (var p in crowd.Walking)
            {
                if (p.BridgeWait) waiting++;
                if (!s.Down() && r.Has((float)p.X, (float)p.Z))
                {
                    onDeck++;
                    if (onDeck <= 5) problems.Add($"{s.Key}: {p.Kind} {p.Id} on the deck at {p.X:0.0},{p.Z:0.0} while it is {s.Up() * 100:0} % up");
                }
            }
            maxWaiting = Math.Max(maxWaiting, waiting);
            return $"{waiting} waiting";
        }
        // up for forty seconds: they come to the ends and wait there
        for (double t = 0; t < 40; t += 0.25)
        {
            Watch();
            await Seconds(0.25);
        }
        Picture(s.Key + "-up");
        var waitingAtEnds = walkers.Where(w => w.p.BridgeWait).Select(w => $"{w.p.Kind} {w.p.Id} at {w.p.X:0.0},{w.p.Z:0.0}").ToList();
        if (maxWaiting == 0) problems.Add($"{s.Key}: nobody waited at its ends");
        // let it down; then everyone gets across
        s.Ask(false);
        double downAt = 0;
        bool across = false;
        for (double t = 0; t < 300; t += 0.25)
        {
            string w = Watch();
            if (t % 10 == 0) GD.Print($"bridgewalk {s.Key}: {t:0} s after the ask to come down, {s.Up() * 100:0} % up, {w}");
            if (downAt == 0 && s.Down()) downAt = t;
            across = walkers.All(w => Math.Sqrt(Math.Pow(w.p.X - w.to.X, 2) + Math.Pow(w.p.Z - w.to.Z, 2)) < 2.5)
                && Math.Sqrt(Math.Pow(police.P!.X - east.X, 2) + Math.Pow(police.P.Z - east.Z, 2)) < 2.5;
            if (across && downAt > 0) break;
            await Seconds(0.25);
        }
        Picture(s.Key + "-down");
        var left = walkers.Where(w => Math.Sqrt(Math.Pow(w.p.X - w.to.X, 2) + Math.Pow(w.p.Z - w.to.Z, 2)) >= 2.5).Select(w => $"{w.p.Kind} {w.p.Id} at {w.p.X:0.0},{w.p.Z:0.0} ({w.p.State})").ToList();
        if (police.P != null && Math.Sqrt(Math.Pow(police.P.X - east.X, 2) + Math.Pow(police.P.Z - east.Z, 2)) >= 2.5) left.Add($"the policeman {police.R.Name} at {police.P.X:0.0},{police.P.Z:0.0} ({police.P.State})");
        if (left.Count > 0) problems.Add($"{s.Key}: not across after it came down: {string.Join(", ", left)}");
        stages.Add(new { bridge = s.Key, west = new[] { west.X, west.Z }, east = new[] { east.X, east.Z }, police = police.R.Name, onDeckWhileUp = onDeck, maxWaiting, waitingAtEnds, downAfterSeconds = downAt, allAcross = across });
        foreach (var (p, _) in walkers) crowd.RemovePuppet(p);
        Kit.I.Clear();
    }

    private void Picture(string name) => Main.I.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, name + ".png"));
    private async Task Frames(int n) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }
    private async Task Seconds(double s) => await ToSignal(GetTree().CreateTimer(s), SceneTreeTimer.SignalName.Timeout);
    private async Task<bool> Until(Func<bool> ok, double seconds)
    {
        for (double t = 0; t < seconds; t += 0.25)
        {
            if (ok()) return true;
            await Seconds(0.25);
        }
        return ok();
    }
}
