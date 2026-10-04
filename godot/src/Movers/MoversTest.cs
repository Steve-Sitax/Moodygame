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
                Finish();
                return;
            }
            var np = todo[at];
            if (Math.Abs(MoverClock.HourF - np.Hour) > 0.2 || at == 0) MoverClock.Hold(np.Hour);
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
                if (!ready) { failed = true; GD.PrintErr($"moverstest: {p.Name} was not ready after {p.MaxWait} seconds"); }
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
        var report = new Dictionary<string, object?>
        {
            ["ok"] = !failed && rows.Count > 0,
            ["made"] = DateTime.UtcNow.ToString("s", CultureInfo.InvariantCulture) + "Z",
            ["moversMsPerFrame"] = MoverCost.Report(),
            ["clocks"] = Clocks.I == null ? null : Clocks.I.Report().Select(r => new { where = r.Where, at = V(r.At), shows = r.Shows, running = r.Running, shown = r.Shown }).ToList(),
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

    public static void Begin(string part) => open[part] = Time.GetTicksUsec();

    public static void End(string part)
    {
        double ms = (Time.GetTicksUsec() - open[part]) / 1000.0;
        var c = cost.GetValueOrDefault(part);
        cost[part] = (c.Sum + ms, c.N + 1, Math.Max(c.Max, ms));
    }

    /// <summary>Forget what was measured (after loading: the first frames are not the game's pace).</summary>
    public static void Reset() => cost.Clear();

    public static Dictionary<string, object> Report()
    {
        var r = new Dictionary<string, object>();
        double all = 0;
        foreach (var (k, c) in cost.OrderBy(k => k.Key))
        {
            double mean = c.N > 0 ? c.Sum / c.N : 0;
            all += mean;
            r[k] = new { mean = Math.Round(mean, 4), max = Math.Round(c.Max, 3) };
        }
        r["all"] = Math.Round(all, 4);
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
