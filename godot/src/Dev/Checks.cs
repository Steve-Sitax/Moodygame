using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Milestone checks against the running Godot game. One option per run; write evidence, then quit.</summary>
[GamePart(990)]
public partial class Checks : Node
{
    private string mode = "", dir = "";
    private RenderAudit? renderAudit;
    private int frames;
    private readonly ulong began = Time.GetTicksMsec();
    private bool running;
    private ulong frameStart;
    private double lastMainMs;
    private bool timingConnected;
    private Townspeople Town => Kit.I.People ?? throw new InvalidOperationException("town part missing");
    private static readonly string[] Places = { "grote markt", "cathedral", "handschoenmarkt", "vismarkt", "rijnkaai" };
    public override void _Ready()
    {
        foreach (string m in new[] { "devtest", "paths", "stuck", "shaders", "perfcheck", "clocks", "interiors" })
            if (Main.I.Flag(m))
            {
                if (mode != "") throw new ArgumentException("one Godot check per run");
                mode = m;
                dir = Main.I.Arg(m);
                if (dir == "" || dir.StartsWith("--")) dir = Main.I.Arg("check-out", ProjectSettings.GlobalizePath("res://baked/checks"));
            }
        if (mode == "") { SetProcess(false); return; }
        Directory.CreateDirectory(dir);
        GameState.I.PlayingWhen = () => false;
        Jef.I.TestInput = true;
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        Engine.MaxFps = 120;
        if (mode == "shaders") renderAudit = new RenderAudit();
        if (mode == "perfcheck")
        {
            GetTree().ProcessFrame += BeginFrame;
            GetTree().PhysicsFrame += BeginFrame;
            RenderingServer.FramePostDraw += EndFrame;
            timingConnected = true;
        }
    }
    private void BeginFrame() { if (frameStart == 0) frameStart = Time.GetTicksUsec(); }
    private void EndFrame() { if (frameStart != 0) lastMainMs = (Time.GetTicksUsec() - frameStart) / 1000.0; frameStart = 0; }
    public override void _ExitTree()
    {
        if (!timingConnected) return;
        if (GetTree() != null) { GetTree().ProcessFrame -= BeginFrame; GetTree().PhysicsFrame -= BeginFrame; }
        RenderingServer.FramePostDraw -= EndFrame;
    }
    public override void _Process(double delta)
    {
        if (mode == "") return;
        frames++;
        // The baseline is the first processed frame after all game parts were added, not after late loads.
        renderAudit?.Sample("frame " + frames);
        if (Time.GetTicksMsec() - began > 240_000) { Finish(new { ok = false, problems = new[] { "check exceeded its four-minute limit" } }); return; }
        if (running) return;
        if (Kit.I.Error != "") { Finish(new { ok = false, problems = new[] { Kit.I.Error } }); return; }
        if (!Kit.I.IsReady) return;
        running = true;
        _ = Run();
    }
    private async Task Run()
    {
        try
        {
            await Kit.I.Light();
            Town.ClockRuns = false;
            await Frames(60);
            object report = mode switch
            {
                "devtest" => await DevTest(),
                "paths" => PathCheck.Run(Town),
                "stuck" => await Stuck(),
                "shaders" => await Shaders(),
                "perfcheck" => await Perf(),
                "clocks" => await BuildingAudit.Clocks(this, Frames),
                "interiors" => await BuildingAudit.Interiors(this, Frames),
                _ => throw new InvalidOperationException("unknown check")
            };
            Finish(report);
        }
        catch (Exception e) { GD.PrintErr(e); Finish(new { ok = false, problems = new[] { e.Message } }); }
    }
    public async Task Frames(int n)
    {
        for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }
    public string Picture(string name)
    {
        string file = Path.Combine(dir, name + ".png");
        Main.I.GetViewport().GetTexture().GetImage().SavePng(file);
        return file;
    }
    private void Finish(object report)
    {
        if (mode == "") return;
        var result = JsonSerializer.SerializeToNode(report)!.AsObject();
        result["at"] = DateTime.UtcNow.ToString("O");
        result["townSeed"] = Kit.I.People?.Data?.Seed;
        string json = result.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(Path.Combine(dir, mode + ".json"), json);
        using var doc = JsonDocument.Parse(json);
        bool ok = doc.RootElement.TryGetProperty("ok", out var value) && value.GetBoolean();
        GD.Print($"{mode}: {(ok ? "PASS" : "FAIL")}; {Path.Combine(dir, mode + ".json")}");
        Engine.TimeScale = 1;
        Jef.I.ClearKeys();
        mode = "";
        GetTree().Quit(ok ? 0 : 1);
    }
    public void At(string name)
    {
        // tools/perfcheck.mjs calls t.go: JUMPS first, then the server's places. Its camera is six metres
        // back, facing the named point, at eye height. A bake's optional reference cameras can differ.
        var jump = name switch
        {
            "grote markt" => new Vector2(-254, 90),
            "cathedral" => new Vector2(-262, 138),
            "rijnkaai" => new Vector2(20, 20),
            "vismarkt" => new Vector2(-118, 30),
            "handschoenmarkt" when Town.Data!.Places.TryGetValue("handschoenmarkt", out var p) => new Vector2((float)p.X, (float)p.Z),
            _ => TownMap.I?.NamedPlace(name) ?? throw new InvalidOperationException("no named perf place " + name)
        };
        var open = Kit.I.FreeNear(jump.X, jump.Y + 6);
        float yaw = MathF.Atan2(-(jump.X - (float)open.X), -(jump.Y - (float)open.Z));
        Jef.I.Place((float)open.X, (float)open.Z, yaw, near: (float)Town.Walk!.BaseAt(open.X, open.Z));
        Town.Refill();
    }
    private async Task<object> DevTest()
    {
        var steps = new List<object>();
        await Kit.I.Commands("hour 13.5 clear; go vismarkt"); await Frames(30);
        steps.Add(new { step = "hour, weather and place", ok = GameState.I.Hour == 13 && GameState.I.Minute == 30 && Daylight.I.Weather == "clear", x = Jef.I.X, z = Jef.I.Z });
        string id = Kit.I.Summon("fishwife"); await Frames(60);
        var s = Town.Sims.First(s => s.R.Id == id);
        steps.Add(new { step = "summon resident", ok = s.P != null && !s.Inside && Math.Sqrt(Math.Pow(s.X - Jef.I.X, 2) + Math.Pow(s.Z - Jef.I.Z, 2)) < 8, id });
        Picture("dev-summon");
        Kit.I.Clear();
        int job = await Kit.I.Job("{\"type\":\"carry\",\"items\":2,\"goods\":\"crates\"}"); await Frames(60);
        steps.Add(new { step = "dev job taken", ok = Play.Jobs.I.Active?.Id == job, job });
        Picture("dev-job");
        var before = GameState.I.HourF;
        await Kit.I.Commands("skip 10"); await Frames(10);
        steps.Add(new { step = "advance server clock", ok = GameState.I.HourF > before, hour = GameState.I.HourF });
        bool ok = steps.All(step => JsonSerializer.SerializeToElement(step).GetProperty("ok").GetBoolean());
        return new { ok, steps, notCovered = new[] { "F9 console mouse and keyboard interaction", "other test-kit commands of the browser (events, saves, gang, stress population)" } };
    }
    private async Task<object> Stuck()
    {
        var watch = new StuckWatch();
        double simulated = 0, sample = 0;
        // Fixed simulation delta: keep the crowd's integration normal while running faster than real time.
        // 0.05 real-game seconds per rendered frame, a 20 Hz simulation; three game hours = 7,200 frames.
        Engine.PhysicsTicksPerSecond = 60;
        for (int place = 0; place < Places.Length; place++)
        {
            At(Places[place]); await Frames(60); watch.ResetWindow();
            for (int i = 0; i < 1440; i++)
            {
                // Run this part directly with its normal _Process path; disable its automatic step to avoid doubling.
                Town.SetProcess(false);
                Town.SetClock(1, 13 + simulated / 120);
                Town._Process(0.05);
                simulated += 0.05; sample += 0.05;
                if (sample >= 0.25) { watch.SampleTown(Town, simulated, Places[place]); sample = 0; }
                await Frames(1);
            }
            Picture("stuck-" + Places[place].Replace(' ', '-'));
        }
        Town.SetProcess(true);
        return watch.Report(Town, Math.Round(simulated, 2));
    }
    private async Task<object> Shaders()
    {
        foreach (var name in Places)
        {
            At(name);
            foreach (var (h, weather) in new[] { (13.0, "clear"), (22.0, "rain"), (6.0, "fog") })
            {
                await Kit.I.Light(h, weather);
                await Frames(30);
                renderAudit!.Sample(name + " " + h + " " + weather);
            }
        }
        return renderAudit!.Report();
    }
    private sealed record Measure(double Mean, double P95, double WallMean, double WallP95, double Calls, int Over33, int Samples);
    private async Task<Measure> MeasureFrames(int n, bool turn = false, bool walk = false)
    {
        var cpu = new List<double>(); var wall = new List<double>(); var calls = new List<double>();
        Jef.I.SetKey(Key.W, walk);
        ulong last = Time.GetTicksUsec();
        for (int i = 0; i < n; i++)
        {
            if (turn) Jef.I.Yaw += Mathf.DegToRad(2);
            await Frames(1);
            ulong now = Time.GetTicksUsec(); wall.Add((now - last) / 1000.0); last = now;
            cpu.Add(lastMainMs);
            calls.Add(RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame));
        }
        Jef.I.ClearKeys();
        double P95(List<double> a) => a.Order().ElementAt(Math.Min(a.Count - 1, (int)(a.Count * 0.95)));
        return new(Math.Round(cpu.Average(), 3), Math.Round(P95(cpu), 3), Math.Round(wall.Average(), 3), Math.Round(P95(wall), 3), Math.Round(calls.Average()), wall.Count(t => t > 33), n);
    }
    private async Task<object> Perf()
    {
        Engine.MaxFps = 0;
        var rows = new List<object>();
        foreach (string name in Places)
        {
            At(name); await Frames(120);
            Picture("perf-" + name.Replace(' ', '-'));
            var still = await MeasureFrames(90);
            var turn = await MeasureFrames(90, turn: true);
            At(name); await Frames(30);
            // Six seconds of actual walking frames, as tools/perfcheck.mjs; no synthetic logic-only timing.
            var live = new List<Measure>(); ulong end = Time.GetTicksMsec() + 6000;
            Jef.I.SetKey(Key.W, true);
            var start = new Vector2(Jef.I.X, Jef.I.Z);
            while (Time.GetTicksMsec() < end) live.Add(await MeasureFrames(1, walk: true));
            Jef.I.ClearKeys();
            var mainTimes = live.Select(s => s.Mean).Order().ToArray();
            var wallTimes = live.Select(s => s.WallMean).Order().ToArray();
            double mean = Math.Round(mainTimes.Average(), 3);
            rows.Add(new { place = name, liveMean = mean, liveP95 = mainTimes[(int)(mainTimes.Length * 0.95)], fps = Math.Round(1000 / wallTimes.Average()), over33 = wallTimes.Count(t => t > 33), stillMean = still.Mean, turnMean = turn.Mean, turnP95 = turn.P95,
                calls = turn.Calls, top = Array.Empty<string>(), ok = mean < 5, still, turn, liveSamples = live.Count, liveWallMean = Math.Round(wallTimes.Average(), 3), liveWallP95 = wallTimes[(int)(wallTimes.Length * 0.95)], walkedMetres = start.DistanceTo(new Vector2(Jef.I.X, Jef.I.Z)) });
        }
        return new { ok = rows.All(r => JsonSerializer.SerializeToElement(r).GetProperty("ok").GetBoolean()), at = DateTime.UtcNow, gpu = RenderingServer.GetVideoAdapterName(), budget = 5, metric = "active main frame: first physics/process signal through RenderingServer.FramePostDraw, including renderer submission; wall frame time recorded separately", rows,
            notCovered = new[] { "per-part browser frameProf breakdown and GPU-finish synchronisation", "night, rain and population stress settings", "walking can meet walls; displacement is reported" } };
    }
}
