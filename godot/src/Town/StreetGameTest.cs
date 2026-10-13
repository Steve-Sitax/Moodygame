using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Dev;
using Scheldemist.Player;

namespace Scheldemist.Town;

/// <summary>Rendered regression for issue 119: a child displaced while playing waits at a blocked hop, then resumes.</summary>
[GamePart(991)]
public partial class StreetGameTest : Node
{
    private string dir = "";
    private bool running;
    private readonly ulong began = Time.GetTicksMsec();

    public override void _Ready()
    {
        dir = Main.I.Arg("streetgametest");
        if (dir == "") { SetProcess(false); return; }
        Directory.CreateDirectory(dir);
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        Engine.MaxFps = 120;
    }

    public override void _Process(double delta)
    {
        if (Time.GetTicksMsec() - began > 240_000) { Finish(new { ok = false, why = "four-minute limit" }); return; }
        if (running || !Kit.I.IsReady || Scheldemist.Audio.Soundscape.I is { Prepared: false }) return;
        running = true;
        _ = Run();
    }

    private async Task Frames(int count)
    {
        for (int i = 0; i < count; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }

    private async Task Run()
    {
        try
        {
            await Kit.I.Light(14.5, "clear");
            var town = Kit.I.People!;
            town.ClockRuns = false;
            town.SetProcess(false);
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            Finish(await town.BlockedGameProof(dir, Frames));
        }
        catch (Exception e) { Finish(new { ok = false, why = e.ToString() }); }
    }

    private void Finish(object report)
    {
        SetProcess(false);
        string json = JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(Path.Combine(dir, "streetgametest.json"), json);
        bool ok = JsonSerializer.SerializeToElement(report).GetProperty("ok").GetBoolean();
        GD.Print("streetgametest: " + (ok ? "PASS" : "FAIL") + " " + dir);
        GetTree().Quit(ok ? 0 : 1);
    }
}

public partial class Townspeople
{
    internal async Task<object> BlockedGameProof(string dir, Func<int, Task> frames)
    {
        var crowd = Crowd!;
        foreach (var s in sims) { if (s.P != null) crowd.RemovePuppet(s.P); s.P = null; }
        const string place = "issue119-hop";
        (double x, double z)? spot = null;
        for (double radius = 0; radius <= 3 && spot == null; radius += .25)
            for (int angle = 0; angle < 16 && spot == null; angle++)
            {
                double x = -2 + Math.Sin(angle * Math.PI / 8) * radius, z = 68.75 + Math.Cos(angle * Math.PI / 8) * radius;
                if (Walk!.Free(x, z) && Walk.Free(x, z + .5) && Walk.Free(x + .65, z + .5)) spot = (x, z);
            }
        if (spot == null) throw new InvalidOperationException("No free Rijnkaai regression spots near -2,69");
        var pitch = new ChalkPitch { X = spot.Value.x, Z = spot.Value.z + 1.85, Yaw = 0, Root = new Node3D(), Marbles = new Node3D() };
        pitch.Root.AddChild(pitch.Marbles); Main.I.View.AddChild(pitch.Root);
        chalkPitches[place] = pitch;
        forcedGames[place] = "hopscotch";
        var rows = new List<object>();
        foreach (string id in new[] { "r032", "r152", "r153" })
        {
            var s = byId[id];
            double x = pitch.X, z = pitch.Z - 1.85;
            if (!Walk!.Free(x, z) || !Walk.Free(x + .65, z + .5)) throw new InvalidOperationException("Rijnkaai regression spots must be free");
            var p = crowd.AddPuppet(s.Kind, x, z)!;
            s.P = p; s.Inside = false; s.ActionHeld = false;
            s.Goal = new Goal { Mode = "play", Place = place, X = x, Z = z };
            pitch.Line.Clear(); pitch.Line.Add(s); pitch.Ready = true; pitch.Hop = 1.4;
            // A lane displacement or the approach to the game leaves the walk clip active.
            crowd.PuppetStand(p, "walk", 0);
            var blocker = crowd.AddPuppet("girl", x + .65, z + .5)!;
            crowd.PuppetStand(blocker, "idle");
            Jef.I.Place(4, 72, 0);
            int walkingFrames = 0;
            double moved = 0, clockDrift = 0;
            for (int i = 0; i < 80; i++)
            {
                pitch.Frame = Engine.GetProcessFrames() - 1;
                ChalkStep(s, "hopscotch", .05);
                if (p.Human.Motion == "walk") walkingFrames++;
                moved = Math.Max(moved, Dist(p.X, p.Z, x, z));
                clockDrift = Math.Max(clockDrift, Math.Abs(pitch.Hop - 1.4));
                crowd.Update(.05, -2, 69, null, Main.I.Cam);
                await frames(1);
            }
            Main.I.Cam.LookAtFromPosition(new Vector3((float)x, 1.45f, (float)z + 2.6f), new Vector3((float)x, .8f, (float)z), Vector3.Up);
            for (int i = 0; i < 4; i++) { crowd.Update(.05, x, z + 2.6, null, Main.I.Cam); await frames(1); }
            Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, id + "-waiting-front.png"));
            Main.I.Cam.LookAtFromPosition(new Vector3((float)x + 2.6f, 1.45f, (float)z), new Vector3((float)x, .8f, (float)z), Vector3.Up);
            for (int i = 0; i < 4; i++) { crowd.Update(.05, x + 2.6, z, null, Main.I.Cam); await frames(1); }
            Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, id + "-waiting-side.png"));
            crowd.RemovePuppet(blocker);
            pitch.Frame = Engine.GetProcessFrames() - 1;
            ChalkStep(s, "hopscotch", .05);
            bool resumed = p.Human.Motion == "hop" && Dist(p.X, p.Z, x, z) > .1 && pitch.Hop > 1.4;
            rows.Add(new { id, who = s.R.Name, walkingFrames, moved, clockDrift, resumed, ok = walkingFrames == 0 && moved < .001 && clockDrift < .001 && resumed });
            crowd.RemovePuppet(p); s.P = null;
        }
        pitch.Root.QueueFree(); chalkPitches.Remove(place); forcedGames.Remove(place);
        return new { ok = rows.All(r => JsonSerializer.SerializeToElement(r).GetProperty("ok").GetBoolean()), rows };
    }
}
