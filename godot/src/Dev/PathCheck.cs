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
    /// <summary>How an unseen walker goes: along the way the server found, or straight on because it found none.</summary>
    private static string End(double x, double z) => Scheldemist.World.Ways.NearestOpen(x, z) is { } q ? $"{q.X:0.0},{q.Y:0.0} {(Scheldemist.World.Ways.Reachable(q.X, q.Y) ? "reachable" : "cut off")}" : "none open";
    private static string HiddenWalk(Townspeople.Sim s)
    {
        if (s.P != null) return "";
        if (s.Hw is not { } hw)
        {
            // on a round: the legs the server found no way for are walked straight on
            var data = Kit.I.People?.Data;
            var a = data == null ? null : Whereabouts.AnchorOf(s.R, data, "work", "work");
            if (a?.Route is not { Length: > 1 } route) return ", no hidden walk";
            var legs = new List<string>();
            for (int i = 0; i < route.Length - (a.Loop ? 0 : 1); i++)
            {
                var p = route[i]; var q = route[(i + 1) % route.Length];
                if (Scheldemist.World.Ways.Path(new Godot.Vector2((float)p.X, (float)p.Z), new Godot.Vector2((float)q.X, (float)q.Z)) == null)
                    legs.Add($"{p.X:0.0},{p.Z:0.0}>{q.X:0.0},{q.Z:0.0} (start {End(p.X, p.Z)}, end {End(q.X, q.Z)})");
            }
            return $", on a round of {route.Length}{(a.Loop ? " (loop)" : "")}, legs with no way: [{string.Join("; ", legs)}]";
        }
        string ends = "";
        var match = System.Text.RegularExpressions.Regex.Match(hw.Key, @"^(-?\d+),(-?\d+)>(-?\d+),(-?\d+)$");
        if (match.Success)
        {
            double N(int i) => double.Parse(match.Groups[i].Value, System.Globalization.CultureInfo.InvariantCulture);
            ends = $" (start {End(N(1), N(2))}, end {End(N(3), N(4))}, way now {(Scheldemist.World.Ways.Path(new Godot.Vector2((float)N(1), (float)N(2)), new Godot.Vector2((float)N(3), (float)N(4))) is { } w ? w.Count + " corners" : "none")})";
        }
        return $", way {hw.Key} {(hw.Pts != null ? $"along {hw.Pts.Length} corners at {hw.I}" : hw.Straight ? "straight on" : "asked")}{ends}";
    }
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
                var place = seg.Where ?? (seg.Act == "work" ? "work" : "home");
                var anchor = Whereabouts.AnchorOf(s, data, seg.Act, place);
                // A work anchor with a route is its first stop, already checked above as a
                // haul end (2 m) or round point (2.4 m, browser town.pathPoints()). Applying
                // the generic 1.7 m plan reach to that same stop creates a false failure.
                double reach = anchor.Route is { Length: > 0 } ? s.Work.Kind == "haul" ? 2 : 2.4 : 1.7;
                Add("plan " + s.Id + " " + seg.Act + " " + (place == "work" ? s.Work.Place : place), anchor.X, anchor.Z, reach, "Town/Whereabouts.cs");
            }
        }
        foreach (var s in data.Shops) PtAdd("shop " + s.Id, s.Door, 1.8, "server /api/town shops");
        foreach (var s in data.Stalls) Add("stall " + s.Place, s.X + s.Face.X, s.Z + s.Face.Z, 1.8, "server /api/town stalls");
        foreach (var s in w.Sellers) Add("seller " + s.Key, s.Value[0], s.Value[1], 2.4, "browser bake sellerSpots");
        // a live person: what they do there says which schedule anchor or route put them off the walk map
        foreach (var s in town.Sims.Where(s => !s.Inside))
            Add($"person {s.R.Id} ({s.R.Trade}, {s.Key}, goal {s.Goal.Mode} at {s.Goal.X:0.0},{s.Goal.Z:0.0}, {(s.P != null ? "drawn " + s.P.State : "hidden")}{HiddenWalk(s)}, home {s.R.HomeSx:0.0},{s.R.HomeSz:0.0}, work {s.R.Work.Kind} {s.R.Work.Place})", s.P?.X ?? s.X, s.P?.Z ?? s.Z, 2.4, "Town/Townspeople.cs");
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
        // around each unreachable point, 6 m each way at half a metre: R reached, o free but cut off, # not free, W the server's way grid passes
        var maps = bad.Where(t => t.Reach > 0).Take(12).Select(t =>
        {
            var rows = new List<string>();
            for (double z = t.Z - 6; z <= t.Z + 6.01; z += 0.5)
            {
                var row = new System.Text.StringBuilder();
                for (double x = t.X - 6; x <= t.X + 6.01; x += 0.5)
                {
                    int cx = (int)Math.Floor((x - x0) * scale), cz = (int)Math.Floor((z - z0) * scale);
                    bool inside = cx >= 0 && cz >= 0 && cx < width && cz < depth;
                    char c = inside && seen[cz * width + cx] ? 'R' : w.PathFree(x, z) ? 'o' : '#';
                    if (c != 'R' && Scheldemist.World.Ways.Reachable(x, z)) c = 'W';
                    if (Math.Abs(x - t.X) < 0.25 && Math.Abs(z - t.Z) < 0.25) c = '*';
                    row.Append(c);
                }
                rows.Add($"{z:0.0} {row}");
            }
            return new { t.Label, x = t.X, z = t.Z, from = t.X - 6, rows };
        }).ToArray();
        return new { ok = bad.Length == 0, checkedCount = targets.Count, reachedCells = reached, resolution = 1.0 / scale, start = new[] { X(seed), Z(seed) }, unreachable = bad, unreachableMaps = maps,
            rule = browser ? "exact browser reachFrom flood; additional plan and live-person targets" : "legacy quarter-metre crowd body mask and sampled heights; rebake --walk-only for exact browser flood (resampling old heights to 0.5 m aliases stairs)",
            notCovered = new[] { "Godot Jef physics routes (the crowd uses the baked map)", "moving bridges, boats and carts after the bake", "unported dynamic quest, event and room-floor targets" } };
    }
}
