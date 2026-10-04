using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Net;

namespace Scheldemist.World;

/// <summary>
/// Finding the way on foot through the town, and the walk map it is found on. The browser asks its server for a
/// way (POST /api/town/ways); here the same search runs in the game itself, on the same picture:
/// server/src/town/walkmap.ts (the picture: client/public/city/walk.png, R wall, G water, B outside, 0.5 m cells),
/// server/src/town/ways.ts (the ground a body can walk, with the opening bridges) and server/src/town/wayfind.ts
/// (the search and the string pulled tight). The same numbers, so a way found here is the way the server finds.
///
///   Ways.Path(from, to)            the corners of the way, (x, z) in world metres, or null when there is none
///   Ways.Length(path)              its length in metres
///   Ways.Flags(x, z)               Wall, Water, Outside (0 = open ground)
///   Ways.Reachable(x, z)           can a body walk here from the game's start (bridges included)?
///
/// A Vector2 here is (x, z) of the world. The map is read at the first ask (about 0.2 s): Ways.Warm() reads it
/// ahead on another thread. Safe to call from any thread.
/// </summary>
public static class Ways
{
    public const byte Wall = 1;
    public const byte Water = 2;
    public const byte Outside = 4;
    /// <summary>Where the game starts (walkmap.ts START): the ground counts when it can be walked to from here.</summary>
    public static readonly Vector2 Start = new(10, 12);

    /// <summary>A little greed in the search: ways at most a few percent longer, found many times faster (wayfind.ts).</summary>
    private const double Greed = 1.4;
    private static readonly double Sqrt2 = Math.Sqrt(2);

    private sealed class Grid
    {
        public double X0, Z0, Res;
        /// <summary>Columns (along z) and rows (along x).</summary>
        public int W, H;
        public byte[] Cells = Array.Empty<byte>();
        /// <summary>1 = a body can stand here and walk to the start.</summary>
        public byte[] Pass = Array.Empty<byte>();
        // the search's own arrays, kept between searches
        public float[] Cost = Array.Empty<float>();
        public int[] From = Array.Empty<int>();
        public uint[] Stamp = Array.Empty<uint>();
        public uint[] Closed = Array.Empty<uint>();
        public uint Run;
    }

    private static readonly object gate = new();
    private static Grid? grid;
    private static string failed = "";

    /// <summary>The folder that holds shared/ and client/ (the checkout, or the download's own).</summary>
    public static string Root => Paths.Root;

    /// <summary>Why the walk map could not be read ("" when it is in, or not asked for yet).</summary>
    public static string Error => failed;
    /// <summary>The walk map's cell in metres (0.5), once it is in.</summary>
    public static double Cell => TheGrid()?.Res ?? 0.5;

    /// <summary>Read the walk map ahead, off the main thread.</summary>
    public static Task Warm()
    {
        string r = Root; // (found on the caller's thread: it asks Godot for its folders)
        return Task.Run(() => TheGrid());
    }

    private static Grid? TheGrid()
    {
        if (grid != null || failed != "") return grid;
        lock (gate)
        {
            if (grid != null || failed != "") return grid;
            try
            {
                grid = Load();
            }
            catch (Exception e)
            {
                failed = $"the walk map could not be read: {e.Message}";
                GD.PrintErr(failed);
            }
            return grid;
        }
    }

    private static Grid Load()
    {
        using var city = JsonDocument.Parse(File.ReadAllBytes(Paths.City));
        var info = city.RootElement.GetProperty("walk");
        var g = new Grid
        {
            X0 = info.GetProperty("x0").GetDouble(),
            Z0 = info.GetProperty("z0").GetDouble(),
            Res = info.GetProperty("res").GetDouble(),
            W = info.GetProperty("w").GetInt32(),
            H = info.GetProperty("h").GetInt32(),
        };
        string rel = (info.GetProperty("file").GetString() ?? "/city/walk.png").TrimStart('/');
        // the server's PUBLIC_DIR: client/public in a checkout, client/dist in the download
        string file = Paths.Public(rel);
        var img = Image.LoadFromFile(file) ?? throw new IOException($"not a picture: {file}");
        if (img.GetWidth() != g.W || img.GetHeight() != g.H) throw new IOException($"{file} is {img.GetWidth()} x {img.GetHeight()}, the map says {g.W} x {g.H}");
        img.Convert(Image.Format.Rgb8);
        byte[] px = img.GetData();
        int n = g.W * g.H;
        g.Cells = new byte[n];
        for (int i = 0; i < n; i++)
            g.Cells[i] = (byte)((px[i * 3] > 127 ? Wall : 0) | (px[i * 3 + 1] > 127 ? Water : 0) | (px[i * 3 + 2] > 127 ? Outside : 0));

        // ways.ts theGrid: a cell a body fits in, or one on an opening bridge or the ferry pontoon (walk.png has water there)
        var bridges = new List<double[]>();
        var kinds = city.RootElement.GetProperty("bridgeKinds");
        foreach (var b in city.RootElement.GetProperty("bridges").EnumerateObject())
        {
            string kind = kinds.TryGetProperty(b.Name, out var k) ? k.GetString() ?? "" : "";
            if (kind != "draw" && kind != "pontoon") continue;
            bridges.Add(new[] { b.Value[0].GetDouble(), b.Value[1].GetDouble(), b.Value[2].GetDouble(), b.Value[3].GetDouble() });
        }
        var open = new byte[n];
        for (int r = 0; r < g.H; r++)
        {
            double x = g.X0 + (r + 0.5) * g.Res;
            for (int c = 0; c < g.W; c++)
            {
                double z = g.Z0 + (c + 0.5) * g.Res;
                bool ok = OpenAt(g, x, z, 0.45);
                if (!ok)
                    foreach (var b in bridges)
                        if (x > b[0] && x < b[2] && z > b[1] && z < b[3])
                        {
                            ok = true;
                            break;
                        }
                open[r * g.W + c] = (byte)(ok ? 1 : 0);
            }
        }
        // flood from the start over that ground
        g.Pass = new byte[n];
        int s0 = (int)Math.Floor((Start.X - g.X0) / g.Res) * g.W + (int)Math.Floor((Start.Y - g.Z0) / g.Res);
        var stack = new Stack<int>();
        stack.Push(s0);
        g.Pass[s0] = 1;
        while (stack.Count > 0)
        {
            int i = stack.Pop();
            int r = i / g.W, c = i % g.W;
            if (r + 1 < g.H) Visit(i + g.W);
            if (r > 0) Visit(i - g.W);
            if (c + 1 < g.W) Visit(i + 1);
            if (c > 0) Visit(i - 1);
        }
        void Visit(int j)
        {
            if (g.Pass[j] != 0 || open[j] == 0) return;
            g.Pass[j] = 1;
            stack.Push(j);
        }
        g.Cost = new float[n];
        g.From = new int[n];
        g.Stamp = new uint[n];
        g.Closed = new uint[n];
        return g;
    }

    // ------------------------------------------------------------------ the walk map (walkmap.ts)

    private static int FlagsAt(Grid g, double x, double z)
    {
        int c = (int)Math.Floor((z - g.Z0) / g.Res);
        int r = (int)Math.Floor((x - g.X0) / g.Res);
        if (c < 0 || r < 0 || c >= g.W || r >= g.H) return Outside | Water;
        return g.Cells[r * g.W + c];
    }

    private static bool OpenAt(Grid g, double x, double z, double r)
    {
        if (FlagsAt(g, x, z) != 0) return false;
        for (int i = 0; i < 8; i++)
        {
            double a = i * Math.PI / 4;
            if (FlagsAt(g, x + Math.Cos(a) * r, z + Math.Sin(a) * r) != 0) return false;
        }
        return true;
    }

    /// <summary>Flags at a point: Wall, Water, Outside (0 = open ground). Off the map counts as outside water.</summary>
    public static int Flags(double x, double z) => TheGrid() is { } g ? FlagsAt(g, x, z) : Outside | Water;

    /// <summary>Open ground with room for a body (radius r) around it.</summary>
    public static bool Open(double x, double z, double r = 0.45) => TheGrid() is { } g && OpenAt(g, x, z, r);

    /// <summary>Can a body walk to this point from the start, the opening bridges included (ways.ts wayReachable)?</summary>
    public static bool Reachable(double x, double z)
    {
        if (TheGrid() is not { } g) return false;
        int i = CellOf(g, x, z);
        return i >= 0 && g.Pass[i] == 1;
    }

    /// <summary>The nearest point a body can stand on and walk from, within max metres, or null.</summary>
    public static Vector2? NearestOpen(double x, double z, double max = 20)
    {
        if (TheGrid() is not { } g) return null;
        int i = NearestPass(g, x, z, max);
        return i < 0 ? null : Centre(g, i);
    }

    // ------------------------------------------------------------------ the search (wayfind.ts)

    private static int CellOf(Grid g, double x, double z)
    {
        int c = (int)Math.Floor((z - g.Z0) / g.Res);
        int r = (int)Math.Floor((x - g.X0) / g.Res);
        return c < 0 || r < 0 || c >= g.W || r >= g.H ? -1 : r * g.W + c;
    }

    /// <summary>Cell centres lie on 0.25 m steps: two decimals keep them exact.</summary>
    private static Vector2 Centre(Grid g, int i) => new((float)(Math.Round((g.X0 + (i / g.W + 0.5) * g.Res) * 100) / 100), (float)(Math.Round((g.Z0 + (i % g.W + 0.5) * g.Res) * 100) / 100));

    /// <summary>The nearest cell a body can stand on, within max metres (a ring search), or -1.</summary>
    private static int NearestPass(Grid g, double x, double z, double max = 20)
    {
        int i0 = CellOf(g, x, z);
        if (i0 >= 0 && g.Pass[i0] != 0) return i0;
        int r0 = (int)Math.Floor((x - g.X0) / g.Res);
        int c0 = (int)Math.Floor((z - g.Z0) / g.Res);
        int reach = (int)Math.Ceiling(max / g.Res);
        for (int d = 1; d <= reach; d++)
        {
            int best = -1;
            int bestD = int.MaxValue;
            for (int dr = -d; dr <= d; dr++)
            {
                for (int dc = -d; dc <= d; dc++)
                {
                    if (Math.Max(Math.Abs(dr), Math.Abs(dc)) != d) continue;
                    int r = r0 + dr, c = c0 + dc;
                    if (r < 0 || c < 0 || r >= g.H || c >= g.W) continue;
                    int i = r * g.W + c;
                    if (g.Pass[i] == 0) continue;
                    int dd = dr * dr + dc * dc;
                    if (dd < bestD)
                    {
                        bestD = dd;
                        best = i;
                    }
                }
            }
            if (best >= 0) return best;
        }
        return -1;
    }

    /// <summary>
    /// Is the straight line from the centre of cell a to the centre of cell b all passable? Every cell the line
    /// touches counts, and through a cell corner both side cells count.
    /// </summary>
    private static bool Clear(Grid g, int a, int b)
    {
        int r = a / g.W, c = a % g.W;
        int r1 = b / g.W, c1 = b % g.W;
        int dr = r1 - r, dc = c1 - c;
        int sr = Math.Sign(dr), sc = Math.Sign(dc);
        double tdr = dr != 0 ? 1.0 / Math.Abs(dr) : double.PositiveInfinity;
        double tdc = dc != 0 ? 1.0 / Math.Abs(dc) : double.PositiveInfinity;
        double tr = dr != 0 ? 0.5 * tdr : double.PositiveInfinity;
        double tc = dc != 0 ? 0.5 * tdc : double.PositiveInfinity;
        for (;;)
        {
            if (g.Pass[r * g.W + c] == 0) return false;
            if (r == r1 && c == c1) return true;
            if (Math.Abs(tr - tc) < 1e-9)
            {
                if (g.Pass[(r + sr) * g.W + c] == 0 || g.Pass[r * g.W + c + sc] == 0) return false;
                r += sr;
                c += sc;
                tr += tdr;
                tc += tdc;
            }
            else if (tr < tc)
            {
                r += sr;
                tr += tdr;
            }
            else
            {
                c += sc;
                tc += tdc;
            }
        }
    }

    /// <summary>
    /// The way on foot from a to b, both (x, z) in world metres: the corners to walk, the first near a and the last
    /// near b, straight between them over open ground along the streets. Null when either end is more than 20 m
    /// off the walkable town, or they do not connect.
    /// </summary>
    public static List<Vector2>? Path(Vector2 from, Vector2 to)
    {
        if (TheGrid() is not { } g) return null;
        lock (g)
        {
            return Find(g, R(from.X), R(from.Y), R(to.X), R(to.Y));
        }
    }

    /// <summary>The same for places in the world (y is left out; the way comes back on the ground, y = 0).</summary>
    public static List<Vector3>? Path(Vector3 from, Vector3 to)
    {
        var w = Path(new Vector2(from.X, from.Z), new Vector2(to.X, to.Z));
        return w?.ConvertAll(p => new Vector3(p.X, 0, p.Y));
    }

    /// <summary>JavaScript's Math.round (a half goes up), so a way's ends land on the cells the server picks.</summary>
    private static double R(double v) => Math.Floor(v + 0.5);

    /// <summary>wayfind.ts Heap: cell ids by a float key, the same order of equal keys as the server's.</summary>
    private sealed class Heap
    {
        private int[] ids = new int[4096];
        private double[] keys = new double[4096];
        public int N;

        public void Push(int id, double k)
        {
            if (N == ids.Length)
            {
                Array.Resize(ref ids, N * 2);
                Array.Resize(ref keys, N * 2);
            }
            int i = N++;
            while (i > 0)
            {
                int p = (i - 1) >> 1;
                if (keys[p] <= k) break;
                ids[i] = ids[p];
                keys[i] = keys[p];
                i = p;
            }
            ids[i] = id;
            keys[i] = k;
        }

        public int Pop()
        {
            int top = ids[0];
            int id = ids[--N];
            double k = keys[N];
            int i = 0;
            for (;;)
            {
                int c = 2 * i + 1;
                if (c >= N) break;
                if (c + 1 < N && keys[c + 1] < keys[c]) c++;
                if (keys[c] >= k) break;
                ids[i] = ids[c];
                keys[i] = keys[c];
                i = c;
            }
            ids[i] = id;
            keys[i] = k;
            return top;
        }
    }

    private static List<Vector2>? Find(Grid g, double ax, double az, double bx, double bz)
    {
        int s = NearestPass(g, ax, az);
        int t = NearestPass(g, bx, bz);
        if (s < 0 || t < 0) return null;
        if (s == t) return new List<Vector2> { Centre(g, s), Centre(g, t) };
        uint run = ++g.Run;
        int tr = t / g.W, tc = t % g.W;
        double H(int i)
        {
            int dr = Math.Abs(i / g.W - tr), dc = Math.Abs(i % g.W - tc);
            return (Math.Max(dr, dc) + (Sqrt2 - 1) * Math.Min(dr, dc)) * Greed;
        }
        var heap = new Heap();
        g.Stamp[s] = run;
        g.Cost[s] = 0;
        g.From[s] = -1;
        heap.Push(s, H(s));
        bool found = false;
        while (heap.N > 0)
        {
            int i = heap.Pop();
            if (g.Closed[i] == run) continue;
            g.Closed[i] = run;
            if (i == t)
            {
                found = true;
                break;
            }
            int r = i / g.W, c = i % g.W;
            float ci = g.Cost[i];
            for (int dr = -1; dr <= 1; dr++)
            {
                for (int dc = -1; dc <= 1; dc++)
                {
                    if (dr == 0 && dc == 0) continue;
                    int rr = r + dr, cc = c + dc;
                    if (rr < 0 || cc < 0 || rr >= g.H || cc >= g.W) continue;
                    int j = rr * g.W + cc;
                    if (g.Pass[j] == 0 || g.Closed[j] == run) continue;
                    // no cutting a corner
                    if (dr != 0 && dc != 0 && (g.Pass[r * g.W + cc] == 0 || g.Pass[rr * g.W + c] == 0)) continue;
                    float nc = ci + (dr != 0 && dc != 0 ? (float)Sqrt2 : 1f);
                    if (g.Stamp[j] == run && g.Cost[j] <= nc) continue;
                    g.Stamp[j] = run;
                    g.Cost[j] = nc;
                    g.From[j] = i;
                    heap.Push(j, nc + H(j));
                }
            }
        }
        if (!found) return null;
        var cells = new List<int>();
        for (int i = t; i >= 0; i = g.From[i]) cells.Add(i);
        cells.Reverse();
        // pull the string tight: keep only the corners a straight walk needs
        var keep = new List<Vector2> { Centre(g, cells[0]) };
        int a = 0;
        while (a < cells.Count - 1)
        {
            int b = a + 1;
            while (b + 1 < cells.Count && Clear(g, cells[a], cells[b + 1])) b++;
            keep.Add(Centre(g, cells[b]));
            a = b;
        }
        return keep;
    }

    /// <summary>The length of a way in metres.</summary>
    public static float Length(IReadOnlyList<Vector2> pts)
    {
        float d = 0;
        for (int i = 1; i < pts.Count; i++) d += pts[i].DistanceTo(pts[i - 1]);
        return d;
    }

    /// <summary>The point d metres along a way (kept to its ends), and which way a walker faces there (yaw = atan2(dx, dz)).</summary>
    public static (Vector2 At, float Yaw) PointAlong(IReadOnlyList<Vector2> pts, float d)
    {
        if (pts.Count == 0) return (Vector2.Zero, 0);
        if (pts.Count == 1 || d <= 0)
        {
            var n = pts.Count > 1 ? pts[1] : pts[0];
            return (pts[0], MathF.Atan2(n.X - pts[0].X, n.Y - pts[0].Y));
        }
        for (int i = 1; i < pts.Count; i++)
        {
            Vector2 a = pts[i - 1], b = pts[i];
            float len = a.DistanceTo(b);
            if (d <= len) return (a.Lerp(b, len > 0 ? d / len : 0), MathF.Atan2(b.X - a.X, b.Y - a.Y));
            d -= len;
        }
        Vector2 p = pts[^2], q = pts[^1];
        return (q, MathF.Atan2(q.X - p.X, q.Y - p.Y));
    }

    /// <summary>The key the server keeps a way under (wayfind.ts wayKey): both ends on a 1 m grid. For Api.WaysByKey.</summary>
    public static string Key(Vector2 from, Vector2 to) => $"{R(from.X)},{R(from.Y)}>{R(to.X)},{R(to.Y)}";
}
