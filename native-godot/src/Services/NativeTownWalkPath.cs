using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.Native.Services;

/// <summary>Exact-cell routing for residents and carts against the current native navigation, with room and lamp clearance.</summary>
public sealed class NativeTownWalkPath
{
    private readonly NativeTownPopulation population;
    private readonly Dictionary<double, HashSet<int>> postCells = new();
    public NativeTownWalkPath(NativeTownPopulation population) => this.population = population;
    private HashSet<int> PostCells(double room)
    {
        if (postCells.TryGetValue(room, out var cached)) return cached;
        var info = population.MapInfo(); var result = new HashSet<int>(); double radius = room + .3;
        foreach (var lamp in NativeTownPopulation.A(population.Facts["LAMPS"])) {
            if (lamp?["hung"]?.GetValue<bool>() == true) continue;
            double x = NativeTown.N(lamp?["x"]), z = NativeTown.N(lamp?["z"]);
            int r0 = Math.Max(0, (int)Math.Floor((x - radius - info.X0) / info.Res)), r1 = Math.Min(info.H - 1, (int)Math.Floor((x + radius - info.X0) / info.Res));
            int c0 = Math.Max(0, (int)Math.Floor((z - radius - info.Z0) / info.Res)), c1 = Math.Min(info.W - 1, (int)Math.Floor((z + radius - info.Z0) / info.Res));
            for (int r = r0; r <= r1; r++) for (int c = c0; c <= c1; c++) if (NativeTownBackGeometry.D(info.X0 + (r + .5) * info.Res, info.Z0 + (c + .5) * info.Res, x, z) <= radius) result.Add(r * info.W + c);
        }
        postCells[room] = result; return result;
    }
    public List<(double x, double z)>? Path(double ax, double az, double bx, double bz, int maxExpand = 400000, double room = 0)
    {
        var info = population.MapInfo(); if (info.W == 0 || info.H == 0 || info.Res <= 0) return null;
        (double x, double z) Centre(int r, int c) => (info.X0 + (r + .5) * info.Res, info.Z0 + (c + .5) * info.Res);
        int Cell(double x, double z) => (int)Math.Floor((x - info.X0) / info.Res) * info.W + (int)Math.Floor((z - info.Z0) / info.Res);
        var roomy = new Dictionary<int, bool>(); var posts = room > 0 ? PostCells(room) : null;
        bool Ok(int r, int c) {
            if (r < 0 || c < 0 || r >= info.H || c >= info.W) return false; var point = Centre(r, c);
            if (!population.Reachable(point.x, point.z)) return false; if (room == 0) return true;
            int key = r * info.W + c; if (!roomy.TryGetValue(key, out bool value)) roomy[key] = value = population.Open(point.x, point.z, room); return value;
        }
        int sr = (int)Math.Floor((ax - info.X0) / info.Res), sc = (int)Math.Floor((az - info.Z0) / info.Res), tr = (int)Math.Floor((bx - info.X0) / info.Res), tc = (int)Math.Floor((bz - info.Z0) / info.Res);
        if (!Ok(sr, sc) || !Ok(tr, tc)) return null;
        int start = sr * info.W + sc, end = tr * info.W + tc;
        bool ByPost(int key) => posts?.Contains(key) == true && key != start && key != end;
        var cost = new Dictionary<int, double> { [start] = 0 }; var from = new Dictionary<int, int>(); var closed = new HashSet<int>(); var heap = new Heap();
        double H(int r, int c) => NativeTownBackGeometry.D(r, c, tr, tc);
        heap.Push(H(sr, sc), start); int expanded = 0;
        while (heap.Count > 0 && expanded++ < maxExpand) {
            int key = heap.Pop(); if (key == end) break; if (!closed.Add(key)) continue; int r = key / info.W, c = key % info.W; double current = cost[key]; var at = Centre(r, c);
            for (int dr = -1; dr <= 1; dr++) for (int dc = -1; dc <= 1; dc++) {
                if (dr == 0 && dc == 0) continue; int rr = r + dr, cc = c + dc;
                if (!Ok(rr, cc) || (dr != 0 && dc != 0 && (!Ok(r + dr, c) || !Ok(r, c + dc)))) continue;
                int next = rr * info.W + cc; if (ByPost(next)) continue; var point = Centre(rr, cc);
                if (!population.CanStep(at.x, at.z, point.x, point.z)) continue;
                double value = current + (dr != 0 && dc != 0 ? Math.Sqrt(2) : 1);
                if (value >= cost.GetValueOrDefault(next, double.PositiveInfinity)) continue;
                cost[next] = value; from[next] = key; heap.Push(value + H(rr, cc), next);
            }
        }
        if (!cost.ContainsKey(end)) return null;
        var cells = new List<(double x, double z)>(); for (int key = end; ; key = from[key]) { cells.Add(Centre(key / info.W, key % info.W)); if (!from.ContainsKey(key)) break; }
        cells.Reverse(); cells[0] = (ax, az); cells[^1] = (bx, bz); if (cells.Count <= 2) return cells;
        bool Clear((double x, double z) a, (double x, double z) b) {
            if (!population.CanStep(a.x, a.z, b.x, b.z)) return false; int n = (int)Math.Ceiling(NativeTownBackGeometry.D(a.x, a.z, b.x, b.z) / .25);
            for (int i = 1; i < n; i++) { double fraction = i / (double)n, x = a.x + (b.x - a.x) * fraction, z = a.z + (b.z - a.z) * fraction; if (!population.Reachable(x, z) || (room > 0 && (!population.Open(x, z, room) || posts!.Contains(Cell(x, z))))) return false; } return true;
        }
        var result = new List<(double x, double z)> { cells[0] }; for (int i = 0; i < cells.Count - 1;) { int j = cells.Count - 1; while (j > i + 1 && !Clear(cells[i], cells[j])) j--; result.Add(cells[j]); i = j; }
        return result.Select(p => (Math.Floor(p.x * 100 + .5) / 100, Math.Floor(p.z * 100 + .5) / 100)).ToList();
    }
    private sealed class Heap
    {
        private readonly List<(double f, int key)> items = new(); public int Count => items.Count;
        public void Push(double f, int key) { items.Add((f, key)); int i = items.Count - 1; while (i > 0) { int parent = (i - 1) >> 1; if (items[parent].f <= items[i].f) break; (items[parent], items[i]) = (items[i], items[parent]); i = parent; } }
        public int Pop() { int result = items[0].key; var last = items[^1]; items.RemoveAt(items.Count - 1); if (items.Count == 0) return result; items[0] = last;
            for (int i = 0; ;) { int l = i * 2 + 1, r = l + 1, best = i; if (l < items.Count && items[l].f < items[best].f) best = l; if (r < items.Count && items[r].f < items[best].f) best = r; if (best == i) break; (items[best], items[i]) = (items[i], items[best]); i = best; } return result; }
    }
}
