using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.Game;

/// <summary>
/// The town as the paper map needs it, read from shared/city.json and shared/spots.json, and the picture of the
/// city itself, drawn once (client/src/game/map.ts drawBase): the colours of the Vuillaume map, red blocks,
/// blue-grey water, the wall, the landmarks, a faint grain. Made off the main thread (plain numbers, no nodes);
/// the map window turns the pixels into a texture when it first opens.
/// </summary>
public sealed class MapBase
{
    /// <summary>Px per metre on the stored map.</summary>
    public const float Scale = 2;

    public float Sin, Cos;
    /// <summary>The traced town's edges in map metres (east and north of the Rijnkaai).</summary>
    public float E0, E1, N0, N1;
    public int Width, Height;
    /// <summary>The picture, RGBA, Width x Height.</summary>
    public byte[] Pixels = Array.Empty<byte>();
    /// <summary>The landmarks as marks: an icon in the middle of each, its name on hover.</summary>
    public List<MapMark> Sights = new();
    /// <summary>Names of the squares, quays, water and gates, in world metres.</summary>
    public List<(string Name, float X, float Z, bool Big)> PlaceNames = new();
    /// <summary>The named doors of the plan (city.json doors): x, z, and the way out of the house.</summary>
    public Dictionary<string, (float X, float Z, float Ox, float Oz)> Doors = new();
    /// <summary>The jobs' named spots (shared/spots.json).</summary>
    public Dictionary<string, (string Label, float X, float Z)> Spots = new();

    private static readonly Dictionary<string, string> LandmarkIcons = new() { ["stadhuis"] = "hall", ["hanzehuis"] = "hall", ["vleeshuis"] = "castle", ["steen"] = "castle" };
    private static readonly Dictionary<string, string> LandmarkNames = new()
    {
        ["cathedral"] = "Cathedral of Our Lady",
        ["stadhuis"] = "Town Hall",
        ["vleeshuis"] = "Vleeshuis",
        ["steen"] = "Het Steen",
        ["carolus"] = "St. Charles Borromeo",
        ["stpaul"] = "St. Paul's",
        ["stjacob"] = "St. James",
        ["hanzehuis"] = "Hanseatic House",
    };

    /// <summary>World (x, z) to map metres, east and north of the Rijnkaai.</summary>
    public Vector2 En(float x, float z) => new(x * Sin + z * Cos, x * Cos - z * Sin);

    /// <summary>World (x, z) to the stored picture's px.</summary>
    public Vector2 Px(float x, float z)
    {
        var en = En(x, z);
        return new Vector2((en.X - E0) * Scale, (N1 - en.Y) * Scale);
    }

    /// <summary>world/city.ts doorSpot: a place d metres out of a named door, `side` metres along the front.</summary>
    public Vector2 DoorSpot(string name, float d = 1.5f, float side = 0)
    {
        if (!Doors.TryGetValue(name, out var door)) return Vector2.Zero;
        return new Vector2(door.X + door.Ox * d - door.Oz * side, door.Z + door.Oz * d + door.Ox * side);
    }

    private static Vector2[] Ring(JsonElement ring) => ring.EnumerateArray().Select(p => new Vector2(p[0].GetSingle(), p[1].GetSingle())).ToArray();

    private static IEnumerable<JsonElement> List(JsonElement at, params string[] path)
    {
        foreach (string k in path)
        {
            if (at.ValueKind != JsonValueKind.Object || !at.TryGetProperty(k, out at)) return Enumerable.Empty<JsonElement>();
        }
        return at.ValueKind == JsonValueKind.Array ? at.EnumerateArray() : Enumerable.Empty<JsonElement>();
    }

    /// <summary>Read the town and draw its picture. root: the folder that holds shared/ (Ways.Root).</summary>
    public static MapBase Make(string root)
    {
        using var doc = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(root, "shared", "city.json")));
        var city = doc.RootElement;
        var m = new MapBase();
        float th = city.GetProperty("frame").GetProperty("thetaDeg").GetSingle() * MathF.PI / 180;
        m.Sin = MathF.Sin(th);
        m.Cos = MathF.Cos(th);
        var area = Ring(city.GetProperty("area"));
        var pts = area.Select(p => m.En(p.X, p.Y)).ToArray();
        m.E0 = pts.Min(p => p.X);
        m.E1 = pts.Max(p => p.X);
        m.N0 = pts.Min(p => p.Y);
        m.N1 = pts.Max(p => p.Y);
        m.Width = (int)MathF.Ceiling((m.E1 - m.E0) * Scale);
        m.Height = (int)MathF.Ceiling((m.N1 - m.N0) * Scale);

        foreach (var l in city.GetProperty("landmarks").EnumerateObject())
        {
            var fp = Ring(l.Value.GetProperty("fp"));
            m.Sights.Add(new MapMark(fp.Average(p => p.X), fp.Average(p => p.Y), LandmarkNames.GetValueOrDefault(l.Name, l.Name), "place", null, LandmarkIcons.GetValueOrDefault(l.Name, "church")));
        }
        if (city.TryGetProperty("places", out var places))
            foreach (var p in places.EnumerateObject())
            {
                string kind = p.Value.GetProperty("kind").GetString() ?? "";
                if (kind == "building") continue;
                bool small = kind is "water" or "quay" or "gate" or "rampart";
                m.PlaceNames.Add((small ? p.Name : p.Name.ToUpperInvariant(), p.Value.GetProperty("x").GetSingle(), p.Value.GetProperty("z").GetSingle(), !small));
            }
        if (city.TryGetProperty("doors", out var doors))
            foreach (var d in doors.EnumerateObject())
            {
                var o = d.Value.GetProperty("out");
                m.Doors[d.Name] = (d.Value.GetProperty("x").GetSingle(), d.Value.GetProperty("z").GetSingle(), o[0].GetSingle(), o[1].GetSingle());
            }
        string spots = Path.Combine(root, "shared", "spots.json");
        if (File.Exists(spots))
        {
            using var sd = JsonDocument.Parse(File.ReadAllBytes(spots));
            foreach (var s in sd.RootElement.EnumerateObject())
                if (!s.Name.StartsWith('_') && s.Value.ValueKind == JsonValueKind.Object)
                    m.Spots[s.Name] = (s.Value.GetProperty("label").GetString() ?? s.Name, s.Value.GetProperty("x").GetSingle(), s.Value.GetProperty("z").GetSingle());
        }

        // ---- the picture (drawBase), drawn twice the size and brought down: smooth edges
        Color paper = MapIcons.Ink("e0d4b8"), water = MapIcons.Ink("9fb4b2"), grass = MapIcons.Ink("b9c294");
        var r = new Raster(m.Width * 2, m.Height * 2);
        Vector2[] P(Vector2[] ring) => ring.Select(p => m.Px(p.X, p.Y) * 2).ToArray();
        var waters = List(city, "water").Select(w => P(Ring(w.GetProperty("outer")))).ToList();
        // the river beyond the traced map, then the water inside it
        r.Clear(water);
        r.Fill(P(area), paper);
        foreach (var w in waters) r.Fill(w, water);
        // the grass round the town wall (tools/city/rampart.py)
        foreach (var gr in List(city, "decor", "grass")) r.Fill(P(Ring(gr.GetProperty("outer"))), grass);
        foreach (var w in waters) r.Fill(w, water);
        Color block = MapIcons.Ink("b8604a"), blockEdge = MapIcons.Ink("7a3a2c");
        foreach (var b in List(city, "blocks"))
        {
            var ring = P(Ring(b.GetProperty("outer")));
            if (ring.Length < 3) continue;
            r.Fill(ring, block);
            r.Stroke(ring, 2, blockEdge);
        }
        // the back alleys (tools/city/alleys.py): lanes and yards in the paper's colour, gardens green
        foreach (var ring in List(city, "alleys", "lanes").Concat(List(city, "alleys", "yards"))) r.Fill(P(Ring(ring)), paper);
        foreach (var ring in List(city, "alleys", "gardens")) r.Fill(P(Ring(ring)), grass);
        // the town wall: the walk and the bastions, the gate houses, the bridges over the moat
        Color wall = MapIcons.Ink("8a4a3a"), wallEdge = MapIcons.Ink("4a2418"), gate = MapIcons.Ink("5a3024");
        foreach (var top in List(city, "decor", "rampart", "tops"))
        {
            var ring = P(Ring(top));
            r.Fill(ring, wall);
            r.Stroke(ring, 2, wallEdge);
        }
        foreach (var gt in List(city, "decor", "rampart", "gates"))
        {
            r.Fill(P(Ring(gt.GetProperty("house"))), gate);
            r.Fill(P(Ring(gt.GetProperty("passage"))), paper);
            r.Fill(P(Ring(gt.GetProperty("bridge"))), paper);
        }
        Color mark = MapIcons.Ink("d8a45a"), markEdge = MapIcons.Ink("5a3a1a");
        foreach (var l in city.GetProperty("landmarks").EnumerateObject())
        {
            var ring = P(Ring(l.Value.GetProperty("fp")));
            r.Fill(ring, mark);
            r.Stroke(ring, 2, markEdge);
        }
        m.Pixels = r.Halved();
        // the paper: a faint grain (the same on every PC)
        var rnd = new Random(1873);
        Color speck = MapIcons.Ink("3c2814");
        for (int i = 0; i < 9000; i++)
        {
            float a = (float)rnd.NextDouble() * 0.05f;
            int x = (int)(rnd.NextDouble() * m.Width), y = (int)(rnd.NextDouble() * m.Height);
            for (int dy = 0; dy < 2; dy++)
                for (int dx = 0; dx < 2; dx++)
                {
                    if (x + dx >= m.Width || y + dy >= m.Height) continue;
                    int o = ((y + dy) * m.Width + x + dx) * 4;
                    m.Pixels[o] = (byte)(m.Pixels[o] + (speck.R8 - m.Pixels[o]) * a);
                    m.Pixels[o + 1] = (byte)(m.Pixels[o + 1] + (speck.G8 - m.Pixels[o + 1]) * a);
                    m.Pixels[o + 2] = (byte)(m.Pixels[o + 2] + (speck.B8 - m.Pixels[o + 2]) * a);
                }
        }
        return m;
    }

    /// <summary>A small picture to fill shapes into (the canvas's fill and stroke, for whole colours).</summary>
    private sealed class Raster
    {
        private readonly int w, h;
        private readonly byte[] px;
        private readonly List<float> xs = new();

        public Raster(int w, int h)
        {
            this.w = w;
            this.h = h;
            px = new byte[w * h * 3];
        }

        public void Clear(Color c)
        {
            byte r = (byte)c.R8, g = (byte)c.G8, b = (byte)c.B8;
            for (int i = 0; i < px.Length; i += 3)
            {
                px[i] = r;
                px[i + 1] = g;
                px[i + 2] = b;
            }
        }

        /// <summary>Fill a ring: a scan line at each row's middle, filled between each pair of crossings.</summary>
        public void Fill(Vector2[] ring, Color c)
        {
            if (ring.Length < 3) return;
            byte r = (byte)c.R8, g = (byte)c.G8, b = (byte)c.B8;
            float min = ring.Min(p => p.Y), max = ring.Max(p => p.Y);
            int y0 = Math.Max(0, (int)MathF.Floor(min)), y1 = Math.Min(h - 1, (int)MathF.Ceiling(max));
            for (int y = y0; y <= y1; y++)
            {
                float yc = y + 0.5f;
                xs.Clear();
                for (int i = 0; i < ring.Length; i++)
                {
                    Vector2 p = ring[i], q = ring[(i + 1) % ring.Length];
                    if ((p.Y <= yc) == (q.Y <= yc)) continue;
                    xs.Add(p.X + (yc - p.Y) * (q.X - p.X) / (q.Y - p.Y));
                }
                xs.Sort();
                for (int i = 0; i + 1 < xs.Count; i += 2)
                {
                    int x0 = Math.Max(0, (int)MathF.Ceiling(xs[i] - 0.5f)), x1 = Math.Min(w - 1, (int)MathF.Floor(xs[i + 1] - 0.5f));
                    int o = (y * w + x0) * 3;
                    for (int x = x0; x <= x1; x++, o += 3)
                    {
                        px[o] = r;
                        px[o + 1] = g;
                        px[o + 2] = b;
                    }
                }
            }
        }

        /// <summary>A closed line of the given width: each piece a thin box, a little longer than the piece so the corners close.</summary>
        public void Stroke(Vector2[] ring, float width, Color c)
        {
            float hw = width / 2;
            var box = new Vector2[4];
            for (int i = 0; i < ring.Length; i++)
            {
                Vector2 p = ring[i], q = ring[(i + 1) % ring.Length];
                var d = q - p;
                float len = d.Length();
                if (len < 1e-4f) continue;
                d /= len;
                var n = new Vector2(-d.Y, d.X) * hw;
                var e = d * hw;
                box[0] = p - e + n;
                box[1] = q + e + n;
                box[2] = q + e - n;
                box[3] = p - e - n;
                Fill(box, c);
            }
        }

        /// <summary>The picture at half the size, each pixel the mean of four, as RGBA.</summary>
        public byte[] Halved()
        {
            int W = w / 2, H = h / 2;
            var o = new byte[W * H * 4];
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    int a = (y * 2 * w + x * 2) * 3, b = a + w * 3, t = (y * W + x) * 4;
                    for (int ch = 0; ch < 3; ch++) o[t + ch] = (byte)((px[a + ch] + px[a + 3 + ch] + px[b + ch] + px[b + 3 + ch] + 2) >> 2);
                    o[t + 3] = 255;
                }
            return o;
        }
    }
}
