using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
        public readonly Heap Frontier = new();
        public readonly List<int> PathCells = new(1024);
        public Scheldemist.Town.WalkMap? NativeMap;
        public Func<float, float, bool>? NativeWater;
        public byte[] NativeLinks = Array.Empty<byte>();
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

    /// <summary>Current routing grid, including the native scene bounds when installed.</summary>
    public static (double X0, double Z0, double Res, int W, int H) MapInfo
        => TheGrid() is { } g ? (g.X0, g.Z0, g.Res, g.W, g.H) : (0, 0, .5, 0, 0);

    /// <summary>Check native support height continuity on a routing leg.</summary>
    public static bool CanStep(double ax, double az, double bx, double bz)
        => TheGrid() is { } g && (g.NativeMap?.SupportsStep(ax, az, bx, bz) ?? true);

    /// <summary>Use the current native scene's navigation for every long-range route. No legacy walk image is read.
    /// Install once after static physics/edited placements, before townspeople and route requests attach.</summary>
    public static void InstallNative(Scheldemist.Town.WalkMap map, Func<float, float, bool>? water = null, IReadOnlyList<Vector2[]>? houseFootprints = null)
    {
        lock (gate)
        {
            var g = new Grid { X0 = map.X0, Z0 = map.Z0, Res = 0.5, W = map.D * 2, H = map.W * 2, NativeMap = map, NativeWater = water ?? Scheldemist.World.Water.In };
            int count = g.W * g.H;
            g.Cells = new byte[count]; g.Pass = new byte[count];
            for (int r = 0; r < g.H; r++) for (int c = 0; c < g.W; c++)
                g.Cells[r * g.W + c] = map.NativeCellFree(r * 2 + 1, c * 2 + 1) ? (byte)0 : (byte)128;
            // Native height links are immutable with the authored support. Reusing them avoids sampling the
            // quarter-metre mesh and taking live-body locks for every A* neighbour of every resident.
            g.NativeLinks = new byte[count];
            for (int r = 0; r < g.H; r++) for (int c = 0; c < g.W; c++) {
                int index = r * g.W + c; if (g.Cells[index] != 0) continue; var from = Centre(g, index);
                for (int direction = 4; direction < NativeDirections.Length; direction++) {
                    var (dr, dc) = NativeDirections[direction]; int rr = r + dr, cc = c + dc;
                    if (rr < 0 || cc < 0 || rr >= g.H || cc >= g.W) continue; int next = rr * g.W + cc; if (g.Cells[next] != 0) continue;
                    if (dr != 0 && dc != 0 && (g.Cells[r * g.W + cc] != 0 || g.Cells[rr * g.W + c] != 0)) continue;
                    var to = Centre(g, next); if (!map.SupportsStep(from.X, from.Y, to.X, to.Y)) continue;
                    g.NativeLinks[index] |= (byte)(1 << direction); g.NativeLinks[next] |= (byte)(1 << (7 - direction));
                }
            }
            // Flags for closed cells are resolved lazily from native water outlines. Navigation needs only the
            // open bit, avoiding millions of expensive polygon queries while the game starts.
            int first = NearestNative(g, Start.X, Start.Y, 20);
            var queue = new int[count]; int head = 0, tail = 0;
            if (first >= 0) { g.Pass[first] = 1; queue[tail++] = first; }
            while (head < tail)
            {
                int index = queue[head++], r = index / g.W, c = index % g.W;
                void Visit(int next, int direction)
                {
                    if (g.Cells[next] != 0 || g.Pass[next] != 0) return;
                    if ((g.NativeLinks[index] & (1 << direction)) == 0) return;
                    g.Pass[next] = 1; queue[tail++] = next;
                }
                if (r > 0) Visit(index - g.W, 1); if (r + 1 < g.H) Visit(index + g.W, 6);
                if (c > 0) Visit(index - 1, 3); if (c + 1 < g.W) Visit(index + 1, 4);
            }
            // Some houses' floors are open in the native map (a room fills its shell, or a wall has a gap). This map is the
            // outdoor one: every spot, side, queue place, drop place and route the town picks through it must stay in the street.
            // Rooms are entered and walked by their own routes (Jef's ground test, the interior checks), never through here.
            if (houseFootprints != null) CloseHouseFloors(g, houseFootprints);
            g.Cost = new float[count]; g.From = new int[count]; g.Stamp = new uint[count]; g.Closed = new uint[count];
            grid = g; failed = "";
        }
    }

    /// <summary>Close the floors inside the houses' outlines, except a floor that is the only way between two outdoor areas
    /// (a real alley the outline covers, which would cut a court off from the street and take its homes' doors away).</summary>
    private static void CloseHouseFloors(Grid g, IReadOnlyList<Vector2[]> polygons)
    {
        int count = g.W * g.H; var inside = new bool[count];
        foreach (var p in polygons)
        {
            if (p.Length < 3) continue;
            float x0 = p[0].X, x1 = x0, z0 = p[0].Y, z1 = z0;
            foreach (var q in p) { x0 = Math.Min(x0, q.X); x1 = Math.Max(x1, q.X); z0 = Math.Min(z0, q.Y); z1 = Math.Max(z1, q.Y); }
            int r0 = Math.Max(0, (int)Math.Floor((x0 - g.X0) / g.Res)), r1 = Math.Min(g.H - 1, (int)Math.Floor((x1 - g.X0) / g.Res));
            int c0 = Math.Max(0, (int)Math.Floor((z0 - g.Z0) / g.Res)), c1 = Math.Min(g.W - 1, (int)Math.Floor((z1 - g.Z0) / g.Res));
            for (int r = r0; r <= r1; r++) for (int c = c0; c <= c1; c++)
                if (InPolygon(p, g.X0 + (r + 0.5) * g.Res, g.Z0 + (c + 0.5) * g.Res)) inside[r * g.W + c] = true;
        }
        // 1. the outdoor areas: reachable cells outside every outline, joined by the same four-way links the flood used
        var label = new int[count]; int labels = 0; var stack = new Stack<int>();
        void Neighbours(int i, Action<int> visit)
        {
            int r = i / g.W, c = i % g.W;
            if (r > 0 && (g.NativeLinks[i] & (1 << 1)) != 0) visit(i - g.W);
            if (r + 1 < g.H && (g.NativeLinks[i] & (1 << 6)) != 0) visit(i + g.W);
            if (c > 0 && (g.NativeLinks[i] & (1 << 3)) != 0) visit(i - 1);
            if (c + 1 < g.W && (g.NativeLinks[i] & (1 << 4)) != 0) visit(i + 1);
        }
        for (int i = 0; i < count; i++)
        {
            if (g.Pass[i] == 0 || inside[i] || label[i] != 0) continue;
            label[i] = ++labels; stack.Push(i);
            while (stack.Count > 0) Neighbours(stack.Pop(), n => { if (g.Pass[n] != 0 && !inside[n] && label[n] == 0) { label[n] = labels; stack.Push(n); } });
        }
        // 2. the reachable floors inside outlines, in pockets: a pocket that touches two outdoor areas is a way through, so it stays
        var pocket = new int[count]; int pockets = 0; var keep = new HashSet<int>();
        for (int i = 0; i < count; i++)
        {
            if (g.Pass[i] == 0 || !inside[i] || pocket[i] != 0) continue;
            pocket[i] = ++pockets; var touched = new HashSet<int>(); stack.Push(i);
            while (stack.Count > 0)
            {
                Neighbours(stack.Pop(), n => { if (g.Pass[n] == 0) return; if (inside[n]) { if (pocket[n] == 0) { pocket[n] = pockets; stack.Push(n); } } else touched.Add(label[n]); });
            }
            if (touched.Count >= 2) keep.Add(pockets);
        }
        // 3. close everything else inside an outline
        for (int i = 0; i < count; i++)
        {
            if (!inside[i] || (pocket[i] != 0 && keep.Contains(pocket[i]))) continue;
            g.Cells[i] = 128; g.Pass[i] = 0;
        }
    }

    private static bool InPolygon(Vector2[] p, double x, double z)
    {
        bool inside = false;
        for (int i = 0, j = p.Length - 1; i < p.Length; j = i++)
            if ((p[i].Y > z) != (p[j].Y > z) && x < (p[j].X - p[i].X) * (z - p[i].Y) / (p[j].Y - p[i].Y) + p[i].X) inside = !inside;
        return inside;
    }

    /// <summary>The houses' outlines (x, z) from the town's city_build.json, to close for outdoor routing. Houses that are gone, and
    /// houses with a carriage passage (poort) through them, are left out: a passage is a street.</summary>
    public static IReadOnlyList<Vector2[]> ReadHouseFootprints(string cityBuildPath)
    {
        var result = new List<Vector2[]>();
        if (!File.Exists(cityBuildPath)) return result;
        using var doc = JsonDocument.Parse(File.ReadAllText(cityBuildPath));
        if (!doc.RootElement.TryGetProperty("houses", out var houses)) return result;
        foreach (var h in houses.EnumerateArray())
        {
            if (h.TryGetProperty("gone", out var gone) && gone.ValueKind == JsonValueKind.True) continue;
            if (h.TryGetProperty("poort", out var poort) && poort.ValueKind != JsonValueKind.Null) continue;
            if (!h.TryGetProperty("fp", out var fp) || fp.ValueKind != JsonValueKind.Array || fp.GetArrayLength() < 3) continue;
            result.Add(fp.EnumerateArray().Select(q => new Vector2((float)q[0].GetDouble(), (float)q[1].GetDouble())).ToArray());
        }
        return result;
    }

    private static int NearestNative(Grid g, double x, double z, double maximum)
    {
        int r0 = (int)Math.Floor((x - g.X0) / g.Res), c0 = (int)Math.Floor((z - g.Z0) / g.Res);
        for (int radius = 0; radius <= maximum / g.Res; radius++)
            for (int dr = -radius; dr <= radius; dr++) for (int dc = -radius; dc <= radius; dc++)
            {
                if (Math.Max(Math.Abs(dr), Math.Abs(dc)) != radius) continue;
                int r = r0 + dr, c = c0 + dc;
                if (r >= 0 && c >= 0 && r < g.H && c < g.W && g.Cells[r * g.W + c] == 0) return r * g.W + c;
            }
        return -1;
    }

    private static readonly (int dr, int dc)[] NativeDirections = { (-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1) };

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
        int index = r * g.W + c;
        if (g.Cells[index] == 128)
            g.Cells[index] = g.NativeWater?.Invoke((float)x, (float)z) == true ? Water : Wall;
        return g.Cells[index];
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
    private static bool Clear(Grid g, int a, int b, Func<double, double, bool>? closed = null)
    {
        if (g.NativeMap != null)
        {
            var from = Centre(g, a); var to = Centre(g, b);
            if (!g.NativeMap.SupportsStep(from.X, from.Y, to.X, to.Y)) return false;
        }
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
            if (closed != null && (r != a / g.W || c != a % g.W) && closed(Centre(g, r * g.W + c).X, Centre(g, r * g.W + c).Y)) return false;
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

    /// <summary>Exact native cell routing for a crowd body. Keep sub-metre doorways and require this scene's installed map.</summary>
    public static List<Vector2>? NativePath(Scheldemist.Town.WalkMap map, Vector2 from, Vector2 to, Func<double, double, bool>? closed = null)
    {
        if (TheGrid() is not { } g || !ReferenceEquals(g.NativeMap, map)) return null;
        lock (g) return Find(g, from.X, from.Y, to.X, to.Y, false, closed);
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

    /// <summary>`closed`, when given: cells it says are taken (a standing body's ground) are not walked, nor cut across.</summary>
    private static List<Vector2>? Find(Grid g, double ax, double az, double bx, double bz, bool freshBuffers = false, Func<double, double, bool>? closed = null)
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
        // Both entry points hold g's lock. Reuse its search buffers instead of allocating 48 KiB per route.
        var heap = freshBuffers ? new Heap() : g.Frontier;
        heap.N = 0;
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
                    if (closed != null && j != t && closed(Centre(g, j).X, Centre(g, j).Y)) continue;
                    if (g.NativeMap != null)
                    {
                        int direction = dr < 0 ? dc + 1 : dr > 0 ? dc + 6 : dc < 0 ? 3 : 4;
                        if ((g.NativeLinks[i] & (1 << direction)) == 0) continue;
                    }
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
        var cells = freshBuffers ? new List<int>() : g.PathCells;
        cells.Clear();
        for (int i = t; i >= 0; i = g.From[i]) cells.Add(i);
        cells.Reverse();
        // pull the string tight: keep only the corners a straight walk needs
        var keep = new List<Vector2> { Centre(g, cells[0]) };
        int a = 0;
        while (a < cells.Count - 1)
        {
            int b = a + 1;
            while (b + 1 < cells.Count && Clear(g, cells[a], cells[b + 1], closed)) b++;
            keep.Add(Centre(g, cells[b]));
            a = b;
        }
        return keep;
    }

    internal static object HeapProof()
    {
        var g = TheGrid() ?? throw new InvalidOperationException("no native routing grid");
        int checks = 0, differences = 0;
        long originalBytes = 0, cachedBytes = 0;
        var points = new[] { new Vector2(10, 12), new Vector2(-118, 30), new Vector2(-254, 90), new Vector2(-262, 138), new Vector2(20, 20) };
        lock (g) foreach (var from in points) foreach (var to in points) {
            long bytes = GC.GetAllocatedBytesForCurrentThread();
            var original = Find(g, from.X, from.Y, to.X, to.Y, true);
            originalBytes += GC.GetAllocatedBytesForCurrentThread() - bytes;
            bytes = GC.GetAllocatedBytesForCurrentThread();
            var cached = Find(g, from.X, from.Y, to.X, to.Y);
            cachedBytes += GC.GetAllocatedBytesForCurrentThread() - bytes;
            checks++;
            if (original == null ? cached != null : cached == null || !original.SequenceEqual(cached)) differences++;
        }
        return new { checks, differences, originalBytes, cachedBytes, ok = differences == 0 };
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
