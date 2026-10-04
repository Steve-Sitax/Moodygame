using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// The movers' own test: `-- --moverstest <dir>` (with `--moversonly a,b` for some kinds). It sets a few hours in
/// turn; for each kind of mover (a clock, a ship, a moored boat, a bridge, the lock, the train, a crane, an
/// omnibus, a cart ...) it takes a close picture, waits a few seconds, takes a second one, and writes the mover's
/// place at both times to <dir>/moverstest.json: it must have moved, and a clock must show the hour set. Quits by
/// itself, with 1 when something stood still. Each mover part adds its probes in its _Ready (MoversTest.Add).
/// </summary>
[GamePart(940)]
public partial class MoversTest : Node
{
    public sealed class Probe
    {
        public string Name = "";
        /// <summary>The game hour to set before the pictures.</summary>
        public double Hour = 13;
        /// <summary>Called once the hour is set, before the wait (send a boat, ask a bridge to open).</summary>
        public Action? Start;
        /// <summary>The thing is ready for its first picture (a ship has come into view)? Null: after the settle time.</summary>
        public Func<bool>? Ready;
        /// <summary>Where the thing is now, and one more number that tells it moves (an angle, a height); with what it says of itself.</summary>
        public Func<(Vector3 At, double Turn, string Note)> Where = () => (Vector3.Zero, 0, "");
        /// <summary>The camera: from where, looking at what.</summary>
        public Func<(Vector3 Eye, Vector3 Look)> View = () => (new Vector3(0, 10, 0), Vector3.Zero);
        /// <summary>Seconds between the two pictures.</summary>
        public double Gap = 3;
        /// <summary>Longest wait for Ready.</summary>
        public double MaxWait = 25;
        /// <summary>It counts as moved from this many metres (or this much turn).</summary>
        public double MinMove = 0.02, MinTurn = 0.002;
        /// <summary>A check of its own on the two samples ("" is good): a clock reads its hands.</summary>
        public Func<string>? Check;
        public Action? End;
    }

    public static readonly List<Probe> Probes = new();
    public static bool On => Main.I.Arg("moverstest") != "";
    public static void Add(Probe p) => Probes.Add(p);

    private string dir = "";
    private List<Probe> todo = new();
    private int at = -1;
    private int stage;
    private double clock, waited;
    private Camera3D cam = null!;
    private (Vector3 At, double Turn, string Note) first;
    private double firstHour;
    private readonly List<Dictionary<string, object?>> rows = new();
    private bool failed;
    private bool readyFailed;
    private bool benchmark;
    private bool measuring;
    private Dictionary<string,object>? tourCost;

    public override void _Ready()
    {
        dir = Main.I.Arg("moverstest");
        if (dir == "")
        {
            SetProcess(false);
            return;
        }
        Directory.CreateDirectory(dir);
        string only = Main.I.Arg("moversonly");
        todo = only == "" ? Probes.ToList() : Probes.Where(p => only.Split(',').Any(o => p.Name.StartsWith(o))).ToList();
        // the same hour's probes one after the other: the hour is set a few times, not for every picture
        todo = todo.OrderBy(p => p.Hour).ToList();
        cam = new Camera3D { Name = "moverstest_eyes", Fov = 55, Near = 0.1f, Far = 700 };
        Main.I.View.AddChild(cam);
        Main.I.Cam = cam;
        Main.I.Ui.Visible = false;
        ProcessPriority = 100; // after the movers have moved
        GD.Print($"moverstest: {todo.Count} probes: {string.Join(", ", todo.Select(p => p.Name))}");
    }

    private static double[] V(Vector3 v) => new[] { Math.Round(v.X, 3), Math.Round(v.Y, 3), Math.Round(v.Z, 3) };

    private void Aim(Probe p)
    {
        var (eye, look) = p.View();
        if (eye.DistanceSquaredTo(look) < 1e-4f) eye += new Vector3(0, 1, 3);
        cam.Current = true;
        cam.LookAtFromPosition(eye, look, Math.Abs((look - eye).Normalized().Y) > 0.99f ? Vector3.Forward : Vector3.Up);
    }

    public override void _Process(double delta)
    {
        if (benchmark)
        {
            clock+=delta;
            cam.LookAtFromPosition(new Vector3(32,2.2f,29),new Vector3(27,1.5f,13));
            if (!measuring && clock>2) { measuring=true; clock=0; MoverCost.Reset(); }
            if (measuring && clock>4) Finish();
            return;
        }
        if (at >= todo.Count) return;
        clock += delta;
        if (at < 0 || stage == 4)
        {
            if (at >= 0) todo[at].End?.Invoke();
            at++;
            stage = 0;
            clock = 0;
            if (at >= todo.Count)
            {
                tourCost=MoverCost.Report(); benchmark=true; clock=0; MoverClock.Hold(13.5);
                return;
            }
            var np = todo[at];
            if (at == 0 || np.Hour != todo[at-1].Hour) MoverClock.Hold(np.Hour);
            readyFailed=false;
            np.Start?.Invoke();
            return;
        }
        var p = todo[at];
        Aim(p);
        switch (stage)
        {
            case 0: // settle, or wait for it to be ready
                waited = clock;
                bool ready = p.Ready == null ? clock > 1.2 : clock > 0.6 && p.Ready();
                if (!ready && clock < p.MaxWait) return;
                if (!ready) { readyFailed = failed = true; GD.PrintErr($"moverstest: {p.Name} was not ready after {p.MaxWait} seconds"); }
                stage = 1;
                clock = 0;
                return;
            case 1: // one more drawn frame with the camera there, then the first picture
                if (clock < 0.15) return;
                first = p.Where();
                firstHour = MoverClock.HourF;
                Shot($"{p.Name}_a.png");
                stage = 2;
                clock = 0;
                return;
            case 2:
                if (clock < p.Gap) return;
                stage = 3;
                return;
            case 3:
                var second = p.Where();
                Shot($"{p.Name}_b.png");
                double moved = first.At.DistanceTo(second.At), turned = Math.Abs(second.Turn - first.Turn);
                string problem = p.Check?.Invoke() ?? "";
                if (readyFailed) problem=$"not ready after {p.MaxWait} seconds; "+problem;
                bool ok = (moved >= p.MinMove || turned >= p.MinTurn) && problem == "";
                if (!ok) failed = true;
                rows.Add(new Dictionary<string, object?>
                {
                    ["mover"] = p.Name,
                    ["hour"] = Math.Round(firstHour, 3),
                    ["waitedS"] = Math.Round(waited, 1),
                    ["gapS"] = p.Gap,
                    ["a"] = new { at = V(first.At), turn = Math.Round(first.Turn, 4), note = first.Note },
                    ["b"] = new { at = V(second.At), turn = Math.Round(second.Turn, 4), note = second.Note },
                    ["movedM"] = Math.Round(moved, 3),
                    ["turned"] = Math.Round(turned, 4),
                    ["ok"] = ok,
                    ["problem"] = problem != "" ? problem : ok ? null : "it stood still",
                    ["pictures"] = new[] { $"{p.Name}_a.png", $"{p.Name}_b.png" },
                });
                GD.Print(string.Create(CultureInfo.InvariantCulture, $"moverstest: {p.Name} at {firstHour:0.00} h: moved {moved:0.000} m, turned {turned:0.0000}{(ok ? "" : "  FAILED " + (problem != "" ? problem : "it stood still"))}"));
                stage = 4;
                return;
        }
    }

    private void Shot(string file) => GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, file));

    private void Finish()
    {
        var costs=MoverCost.Report();
        if (Convert.ToDouble(costs["all"],CultureInfo.InvariantCulture)>=1) {failed=true; GD.PrintErr("moverstest: Rijnkaai mover mean exceeds 1 ms");}
        if (MoverCost.Maximum(costs) > 16) { failed=true; GD.PrintErr("moverstest: a warm mover update frame exceeds 16 ms"); }
        if (MoverCost.Maximum(tourCost) > 16) { failed=true; GD.PrintErr("moverstest: a tour mover update frame exceeds 16 ms"); }
        var clocks=Clocks.I?.Report();
        if (clocks?.Any(c=>!c.Running)==true) failed=true;
        foreach (var c in clocks??new()) GD.Print($"clock: {c.Where} at {c.At}: {c.Shows}, {(c.Running?"running":"FAILED")}");
        var report = new Dictionary<string, object?>
        {
            ["ok"] = !failed && rows.Count > 0,
            ["made"] = DateTime.UtcNow.ToString("s", CultureInfo.InvariantCulture) + "Z",
            ["moversMsPerFrame"] = tourCost,
            ["rijnkaaiMsPerFrame"] = costs,
            ["mapMarkers"] = MoverMap.Marks().ToList(),
            ["clocks"] = Clocks.I == null ? null : Clocks.I.Report().Select(r => new { path = r.Path, where = r.Where, at = V(r.At), shows = r.Shows, running = r.Running, shown = r.Shown }).ToList(),
            ["movers"] = rows,
        };
        File.WriteAllText(Path.Combine(dir, "moverstest.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"moverstest: {(failed ? "FAILED" : "ok")}, {rows.Count} movers, {Path.Combine(dir, "moverstest.json")}");
        GetTree().Quit(failed ? 1 : 0);
    }
}

/// <summary>
/// What the movers cost: each part times its own _Process (MoverCost.Begin / End); the mean per frame is printed
/// with `--shots` and written by the self-test. The budget for all of them together: 1 ms a frame.
/// </summary>
public static class MoverCost
{
    private static readonly Dictionary<string, (double Sum, long N, double Max)> cost = new();
    private static readonly Dictionary<string, ulong> open = new();
    private static readonly Dictionary<string, long> allocatedAt = new();
    private static readonly Dictionary<string, (long Sum, long Max)> allocated = new();
    private static readonly List<object> spikes = new();
    private static int gc0, gc1, gc2;
    private static ulong measuredFrame=ulong.MaxValue;
    private static double frameMs;
    // Keep profiling bounded during ordinary play; lifetime means/maxima still include every frame.
    private const int FrameSamples=65536;
    private static readonly double[] frames=new double[FrameSamples];
    private static long frameCount;
    private static double frameSum,frameMax;
    private static long frameBytes, bytesSum, bytesMax, zeroFrames;
    private static readonly long[] bytesFrames=new long[FrameSamples];

    public static void Begin(string part)
    {
        gc0=GC.CollectionCount(0);gc1=GC.CollectionCount(1);gc2=GC.CollectionCount(2);
        open[part] = Time.GetTicksUsec();
        allocatedAt[part] = GC.GetAllocatedBytesForCurrentThread();
    }

    public static void End(string part)
    {
        double ms = (Time.GetTicksUsec() - open[part]) / 1000.0;
        long bytes = GC.GetAllocatedBytesForCurrentThread() - allocatedAt[part];
        var a = allocated.GetValueOrDefault(part);
        allocated[part] = (a.Sum + bytes, Math.Max(a.Max, bytes));
        int g0=GC.CollectionCount(0),g1=GC.CollectionCount(1),g2=GC.CollectionCount(2);
        if(ms>8 && spikes.Count<128) spikes.Add(new {part,ms,bytes,frame=MoverClock.Frame,gc=new[]{g0-gc0,g1-gc1,g2-gc2}});
        gc0=g0;gc1=g1;gc2=g2;
        if(measuredFrame!=MoverClock.Frame)
        {
            if(measuredFrame!=ulong.MaxValue)
            {
                frames[frameCount%FrameSamples]=frameMs;frameCount++;
                frameSum+=frameMs;frameMax=Math.Max(frameMax,frameMs);
                bytesFrames[(frameCount-1)%FrameSamples]=frameBytes;
                bytesSum+=frameBytes;bytesMax=Math.Max(bytesMax,frameBytes);
                if(frameBytes==0) zeroFrames++;
            }
            measuredFrame=MoverClock.Frame; frameMs=0; frameBytes=0;
        }
        frameMs+=ms;
        frameBytes+=bytes;
        var c = cost.GetValueOrDefault(part);
        cost[part] = (c.Sum + ms, c.N + 1, Math.Max(c.Max, ms));
    }

    /// <summary>Forget what was measured (after loading: the first frames are not the game's pace).</summary>
    public static void Reset() {cost.Clear(); allocated.Clear(); spikes.Clear(); frameCount=0;frameSum=frameMax=0;measuredFrame=ulong.MaxValue; frameMs=0; frameBytes=bytesSum=bytesMax=zeroFrames=0;}

    private sealed record Timing(double mean, double p95, double max, long frames, int samples);
    public static double Maximum(Dictionary<string,object>? report) => report != null && report.TryGetValue("combined", out var c) && c is Timing t ? t.max : 0;

    public static Dictionary<string, object> Report()
    {
        var r = new Dictionary<string, object>();
        double all = 0;
        foreach (var (k, c) in cost.OrderBy(k => k.Key))
        {
            double mean = c.N > 0 ? c.Sum / c.N : 0;
            all += mean;
            var a=allocated.GetValueOrDefault(k);
            r[k] = new { mean = Math.Round(mean, 4), max = Math.Round(c.Max, 3), bytesMean=Math.Round(a.Sum/(double)c.N,2),bytesMax=a.Max };
        }
        r["all"] = Math.Round(all, 4);
        r["spikes"] = spikes.ToArray();
        if(measuredFrame!=ulong.MaxValue)
        {
            var f=frames.Take((int)Math.Min(frameCount,FrameSamples)).Append(frameMs).OrderBy(n=>n).ToArray();
            r["combined"] = new Timing(Math.Round((frameSum+frameMs)/(frameCount+1),4),Math.Round(f[(int)((f.Length-1)*.95)],4),Math.Round(Math.Max(frameMax,frameMs),4),frameCount+1,f.Length);
            var b=bytesFrames.Take((int)Math.Min(frameCount,FrameSamples)).Append(frameBytes).OrderBy(n=>n).ToArray();
            r["allocatedBytesPerFrame"] = new { mean=Math.Round((bytesSum+frameBytes)/(double)(frameCount+1),2), median=b[b.Length/2], p95=b[(int)((b.Length-1)*.95)], max=Math.Max(bytesMax,frameBytes), zeroFrames=zeroFrames+(frameBytes==0?1:0), frames=frameCount+1 };
        }
        return r;
    }

    public static string Line()
    {
        double all = 0;
        var parts = new List<string>();
        foreach (var (k, c) in cost.OrderBy(k => k.Key))
        {
            double mean = c.N > 0 ? c.Sum / c.N : 0;
            all += mean;
            parts.Add(string.Create(CultureInfo.InvariantCulture, $"{k} {mean:0.000}"));
        }
        return string.Create(CultureInfo.InvariantCulture, $"movers: {all:0.000} ms a frame ({string.Join(", ", parts)})");
    }
}
