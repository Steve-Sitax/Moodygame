using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Scheldemist.Game;
using Scheldemist.Play;
using Scheldemist.Town;

namespace Scheldemist.Dev;

/// <summary>The exact browser flood when exported; old bakes use their original quarter-metre crowd mask.
/// Also checks outdoor schedule anchors, which the browser's public paths() does not enumerate.</summary>
public static class PathCheck
{
    public sealed record Target(string Label, double X, double Z, double Reach, string Source);
    public static object Run(Townspeople town)
    {
        var w = town.Walk ?? throw new InvalidOperationException("no baked walk map");
        var data = town.Data ?? throw new InvalidOperationException("no server town");
        bool browser = w.BrowserReached.Length > 0;
        int scale = browser ? 2 : 4;
        double x0 = browser ? w.BrowserX0 : w.X0, z0 = browser ? w.BrowserZ0 : w.Z0;
        int width = browser ? w.BrowserW : w.W * scale, depth = browser ? w.BrowserD : w.D * scale;
        var seen = new bool[width * depth];
        var queue = new Queue<int>();
        double X(int i) => x0 + (i % width + (browser ? 0 : 0.5)) / scale;
        double Z(int i) => z0 + (i / width + (browser ? 0 : 0.5)) / scale;
        int seed = (int)Math.Round((12 - z0) * scale) * width + (int)Math.Round((10 - x0) * scale);
        if (!browser)
        {
            double best = double.MaxValue;
            for (int z = (int)((12 - z0) * scale) - 12; z <= (12 - z0) * scale + 12; z++)
                for (int x = (int)((10 - x0) * scale) - 12; x <= (10 - x0) * scale + 12; x++)
                {
                    if (x < 0 || z < 0 || x >= width || z >= depth) continue;
                    int i = z * width + x;
                    double d = Math.Pow(X(i) - 10, 2) + Math.Pow(Z(i) - 12, 2);
                    if (w.PathFree(X(i), Z(i)) && d < best) { seed = i; best = d; }
                }
        }
        if (seed < 0 || seed >= seen.Length || !(browser ? w.BrowserReached[seed] != 0 : w.PathFree(X(seed), Z(seed)))) throw new InvalidOperationException("the exact browser start (10,12) is closed");
        if (browser) for (int i = 0; i < seen.Length; i++) seen[i] = w.BrowserReached[i] != 0;
        else { queue.Enqueue(seed); seen[seed] = true; }
        int reached = 0;
        var directions = new[] { (-1, 0), (1, 0), (0, -1), (0, 1) };
        while (queue.TryDequeue(out int i))
        {
            reached++;
            int ix = i % width, iz = i / width;
            double h = w.BaseAt(X(i), Z(i));
            foreach (var (dx, dz) in directions)
            {
                int x = ix + dx, z = iz + dz;
                if (x < 0 || z < 0 || x >= width || z >= depth) continue;
                int n = z * width + x;
                if (seen[n] || !w.PathFree(X(n), Z(n)) || Math.Abs(w.BaseAt(X(n), Z(n)) - h) > 0.36) continue;
                seen[n] = true; queue.Enqueue(n);
            }
        }
        if (browser) reached = seen.Count(s => s);
        var targets = new List<Target>();
        void Add(string label, double x, double z, double reach, string source) => targets.Add(new(label, x, z, reach, source));
        void PtAdd(string label, Pt? p, double reach, string source) { if (p is { } q) Add(label, q.X, q.Z, reach, source); }
        foreach (var s in Spots.All.Values) Add("job spot " + s.Id, s.X, s.Z, 1.7, "shared/spots.json");
        void JobPoints(JsonElement value, string label)
        {
            if (value.ValueKind == JsonValueKind.Array)
            {
                int i = 0; foreach (var item in value.EnumerateArray()) JobPoints(item, label + "[" + i++ + "]");
            }
            else if (value.ValueKind == JsonValueKind.Object)
            {
                if (value.TryGetProperty("x", out var x) && value.TryGetProperty("z", out var z) && x.ValueKind == JsonValueKind.Number && z.ValueKind == JsonValueKind.Number)
                    Add(label, x.GetDouble(), z.GetDouble(), 1.7, "server /api/jobs task");
                foreach (var p in value.EnumerateObject())
                {
                    if (p.Value.ValueKind == JsonValueKind.String && p.Name is "from" or "to" or "post" && Spots.Get(p.Value.GetString()) is { } spot)
                        Add(label + " " + p.Name, spot.X, spot.Z, 1.7, "server /api/jobs task");
                    else JobPoints(p.Value, label + "." + p.Name);
                }
            }
        }
        foreach (var job in GameState.I.Jobs) if (job.Task is { } task) JobPoints(task, "job " + job.Id);
        var board = Spots.Board; Add("hiring board", board.X, board.Z, 2.5, "Play/Spots.cs");
        foreach (var (id, p) in data.Places)
        {
            Add("place " + id, p.X, p.Z, 3, "server /api/town places");
            PtAdd("door " + id, p.Door, 1.7, "server /api/town places");
            if (p.Route != null) foreach (var q in p.Route) PtAdd("route " + id, q, 1.7, "server /api/town places");
        }
        foreach (var s in data.Residents)
        {
            Add("home " + s.Id, s.HomeSx, s.HomeSz, 1.6, "server /api/town residents");
            var a = s.Work.At; if (a?.Length >= 2) Add("work " + s.Id, a[0], a[1], 2.4, "server /api/town residents");
            PtAdd("work A " + s.Id, s.Work.A, 2, "server /api/town residents");
            PtAdd("work B " + s.Id, s.Work.B, 2, "server /api/town residents");
            PtAdd("work door " + s.Id, s.Work.Door, 1.6, "server /api/town residents");
            if (s.Work.Route != null) foreach (var q in s.Work.Route) PtAdd("work route " + s.Id, q, 2.4, "server /api/town residents");
            foreach (var seg in s.Sched.Day.Concat(s.Sched.Sunday).Distinct())
            {
                var anchor = Whereabouts.AnchorOf(s, data, seg.Act, seg.Where ?? (seg.Act == "work" ? "work" : "home"));
                Add("plan " + s.Id + " " + seg.Act + " " + seg.Where, anchor.X, anchor.Z, 1.7, "Town/Whereabouts.cs");
            }
        }
        foreach (var s in data.Shops) PtAdd("shop " + s.Id, s.Door, 1.8, "server /api/town shops");
        foreach (var s in data.Stalls) Add("stall " + s.Place, s.X + s.Face.X, s.Z + s.Face.Z, 1.8, "server /api/town stalls");
        foreach (var s in w.Sellers) Add("seller " + s.Key, s.Value[0], s.Value[1], 2.4, "browser bake sellerSpots");
        foreach (var s in town.Sims.Where(s => !s.Inside)) Add("person " + s.R.Id, s.X, s.Z, 2.4, "Town/Townspeople.cs");
        foreach (var d in Spots.Doors.Values) Add("city door " + d.Id, d.X + d.OutX, d.Z + d.OutZ, 1.7, "shared/city.json");
        bool Can(Target t)
        {
            int cx = (int)Math.Round((t.X - x0) * scale), cz = (int)Math.Round((t.Z - z0) * scale), r = (int)Math.Ceiling(t.Reach * scale);
            for (int z = Math.Max(0, cz - r); z <= Math.Min(depth - 1, cz + r); z++)
                for (int x = Math.Max(0, cx - r); x <= Math.Min(width - 1, cx + r); x++)
                {
                    int i = z * width + x;
                    if (seen[i] && Math.Pow(X(i) - t.X, 2) + Math.Pow(Z(i) - t.Z, 2) <= t.Reach * t.Reach) return true;
                }
            return false;
        }
        var bad = targets.Where(t => !Can(t)).Concat(w.BrowserUnreachable.Select(label => new Target(label, 0, 0, 0, "browser paths() at bake time; coordinates not supplied"))).ToArray();
        return new { ok = bad.Length == 0, checkedCount = targets.Count, reachedCells = reached, resolution = 1.0 / scale, start = new[] { X(seed), Z(seed) }, unreachable = bad,
            rule = browser ? "exact browser reachFrom flood; additional plan and live-person targets" : "legacy quarter-metre crowd body mask and sampled heights; rebake --walk-only for exact browser flood (resampling old heights to 0.5 m aliases stairs)",
            notCovered = new[] { "Godot Jef physics routes (the crowd uses the baked map)", "moving bridges, boats and carts after the bake", "unported dynamic quest, event and room-floor targets" } };
    }
}
