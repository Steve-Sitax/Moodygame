using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The Ruien as data (docs/ruien-native.md): the network plan (res://world/ruien/network.json, made from
/// docs/plans/ruien by tools/ruien/godot_network.py) and the areas the game draws (res://world/ruien/areas.json). An
/// area is a stretch of the network with its own exported folder (meshes, collision, markers, manifest.json) or, until
/// it has one, the stand-in the game builds from its zones. Everything that differs from one area to the next is here:
/// the zones under their vaults, the gates in the quay walls, the water, the lamps, the openings to the street, the
/// mist; the code has no coordinates of its own.
/// </summary>
public sealed class RuienData
{
    public const string NetworkFile = "res://world/ruien/network.json";
    public const string AreasFile = "res://world/ruien/areas.json";

    /// <summary>A gallery class's section (network.json classes: G the giant gallery, M a rui).</summary>
    public sealed record Section(float Width, float Bed, float Crown, float Channel, float Ledge, float LedgeY, float Spring);

    /// <summary>
    /// A covered stretch: a line (a gallery: its centre line, sampled every half metre, and its section) or a room
    /// (a hall: its rectangle, its floor and crown). The cover map, the river's stencil lid, the eye's "underground"
    /// and the stand-in geometry come from these.
    /// </summary>
    public sealed class Zone
    {
        public string Id = "", Kind = "line";
        public Section S = null!;
        public Vector2[] Path = Array.Empty<Vector2>();
        public float[] Along = Array.Empty<float>();
        public Rect2 Rect;
        public float Wall = 0.6f;
        /// <summary>How far (m) the vault's cover fades in past each end (an open end at a gate fades; one into a hall not).</summary>
        public float FadeStart, FadeEnd;
        public float Length => Along.Length > 0 ? Along[^1] : 0;

        /// <summary>Distance inside the zone's outline (positive inside, metres) and where along it.</summary>
        public float Inside(Vector2 p, out float along)
        {
            along = 0;
            if (Kind == "room")
            {
                float dx = Math.Min(p.X - Rect.Position.X, Rect.End.X - p.X), dz = Math.Min(p.Y - Rect.Position.Y, Rect.End.Y - p.Y);
                return Math.Min(dx, dz);
            }
            float best = float.MaxValue, half = S.Width / 2;
            float endIn = float.MaxValue;
            for (int i = 0; i + 1 < Path.Length; i++)
            {
                var a = Path[i]; var b = Path[i + 1];
                var ab = b - a;
                float l2 = ab.LengthSquared();
                float t = l2 > 1e-9f ? Math.Clamp((p - a).Dot(ab) / l2, 0, 1) : 0;
                float d = p.DistanceTo(a + ab * t);
                if (d < best)
                {
                    best = d;
                    along = Along[i] + (Along[i + 1] - Along[i]) * t;
                    // (past an end the distance is to the end: the end cuts square)
                    var tan = ab / MathF.Sqrt(Math.Max(l2, 1e-9f));
                    endIn = i == 0 && (p - a).Dot(tan) < 0 ? (p - a).Dot(tan) : i + 2 == Path.Length && (p - b).Dot(tan) > 0 ? -(p - b).Dot(tan) : float.MaxValue;
                }
            }
            return Math.Min(half - best, endIn);
        }

        /// <summary>The centre line's point and tangent at a distance along it.</summary>
        public (Vector2 at, Vector2 tan) Frame(float u)
        {
            u = Math.Clamp(u, 0, Length);
            int i = Math.Max(0, Array.BinarySearch(Along, u) is int k && k < 0 ? ~k - 1 : k);
            i = Math.Min(i, Path.Length - 2);
            float t = (u - Along[i]) / Math.Max(Along[i + 1] - Along[i], 1e-6f);
            var tan = (Path[i + 1] - Path[i]).Normalized();
            return (Path[i].Lerp(Path[i + 1], t), tan);
        }
    }

    /// <summary>A gate in a quay wall: the plane of the wall's face, the opening (x along the face, y up) cut through it.</summary>
    public sealed class Gate
    {
        public string Id = "";
        public Vector2 Origin, Normal; // on the face; out of the wall toward the open water
        public float Depth = 1.6f;     // the wall's thickness behind the face
        public Vector2[] Opening = Array.Empty<Vector2>(); // (along the face from Origin, y)
        public float Sill;
        public string[] Meshes = Array.Empty<string>();
        /// <summary>Meshes cleared out of the opening whatever way their faces turn (an old outfall's throat).</summary>
        public string[] Clear = Array.Empty<string>();
    }

    /// <summary>A light source of an area (a marker): a lamp, or an opening that lets daylight in.</summary>
    public sealed class Source
    {
        public string Id = "", Kind = "lamp"; // lamp, grate, shaft, hatch, outlet
        public Vector3 At, Dir = Vector3.Down;
        public Color Color = new(1, 0.62f, 0.3f);
        public float Power = 1, Range = 9, HalfU = 0.33f, HalfV = 0.33f, Bars, Haze = 1;
        public bool Round;
        /// <summary>A beam's length (m, an opening: down to what it falls on).</summary>
        public float Beam;
    }

    public sealed class MistBox
    {
        public string Id = "";
        public Vector3 Min, Max;
        public float Density = 0.06f;
    }

    public sealed class WaterSheet
    {
        public string Id = "", Zone = "";
        public Vector2[] Outline = Array.Empty<Vector2>();
        public float Width; // a strip along a zone's line, or along its own line
        public Vector2[] Line = Array.Empty<Vector2>();
        public Vector2 Flow;
    }

    public sealed class Mover
    {
        public string Id = "", Kind = "", Collision = "";
        public Vector3 Pivot;
        public float OpenDeg;
    }

    /// <summary>A way between the street and an area: a ladder up a grate's shaft, or a stair under a hatch.</summary>
    public sealed class Way
    {
        public string Id = "", Kind = "ladder";
        public Vector3 Bottom, Top;
        /// <summary>The street's hole over it (x0, z0, size).</summary>
        public Rect2 Hole;
        /// <summary>Step irons in a channel wall: the wall's foot (x, z) and the way out of it into the channel.</summary>
        public Vector2 Wall, Out;
    }

    public sealed class Area
    {
        public readonly List<Way> Ways = new();
        /// <summary>The export's moving parts: tide door leaves (turned about a hinge), the penstock (raised).</summary>
        public readonly List<Mover> Movers = new();
        /// <summary>How far the penstock's door stands raised over its exported rest (m; its travel's top lets one wade under it).</summary>
        public float PenstockRaise;
        /// <summary>Kit pieces placed in the area (shared models: the lamp brackets the export does not carry).</summary>
        public readonly List<(string piece, Vector3 at, float yaw)> Kit = new();
        /// <summary>Export keys not drawn (the vliet's own walls and bed: the town draws its vliet).</summary>
        public readonly HashSet<string> SkipKeys = new();
        public string Id = "", Name = "", Export = "";
        public readonly List<Zone> Zones = new();
        public readonly List<Gate> Gates = new();
        public readonly List<Source> Sources = new();
        public readonly List<MistBox> Mist = new();
        public readonly List<WaterSheet> Water = new();
        /// <summary>The water inside: never lower than this (the gate's sill holds it), held when the river is higher.</summary>
        public float WaterMin = -4.6f;
        /// <summary>How much the trapped water rises behind shut doors over a high water (m).</summary>
        public float WaterRise = 0.12f;
        /// <summary>Where the dev kit's `ruien` puts Jef: x, y (feet), z, yaw (degrees).</summary>
        public Vector4 DevEntry;
        public Aabb Box;
        /// <summary>Its export is converted (res://world/ruien/&lt;area&gt;): drawn from it, lit by its markers.</summary>
        public bool Exported;
    }

    public readonly Dictionary<string, Section> Classes = new();
    public readonly List<Area> Areas = new();
    public Color Air = new(0.012f, 0.011f, 0.009f);
    public float AirNear = 2, AirFar = 36, Haze = 0.35f, Exposure = 1.6f;
    public Color Fill = new(0.004f, 0.0037f, 0.003f);
    public int LampPool = 4;
    public JsonElement NetworkRoot;

    private static float F(JsonElement e, string k, float d) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetSingle() : d;
    private static string S(JsonElement e, string k, string d = "") => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : d;
    private static Vector2 V2(JsonElement e) => new(e[0].GetSingle(), e[1].GetSingle());
    private static Vector3 V3(JsonElement e) => new(e[0].GetSingle(), e[1].GetSingle(), e[2].GetSingle());
    private static Color Col(JsonElement e) => e.ValueKind == JsonValueKind.String ? new Color(e.GetString()!) : new Color(e[0].GetSingle(), e[1].GetSingle(), e[2].GetSingle());

    public static RuienData Load()
    {
        var d = new RuienData();
        if (!Godot.FileAccess.FileExists(NetworkFile) || !Godot.FileAccess.FileExists(AreasFile)) return d;
        var net = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(NetworkFile)).RootElement;
        d.NetworkRoot = net;
        foreach (var c in net.GetProperty("classes").EnumerateObject())
        {
            var v = c.Value;
            float bed = F(v, "bed", -6.1f), crown = F(v, "crown", bed + F(v, "bedToCrown", 5.2f)), w = F(v, "innerWidth", 6);
            float ledgeY = bed + F(v, "ledgeAboveBed", 2.5f);
            d.Classes[c.Name] = new Section(w, bed, crown, F(v, "channelWidth", w * 0.5f), F(v, "ledgeWidth", 1.5f), ledgeY, ledgeY + 0.5f);
        }
        var lines = net.GetProperty("lines").EnumerateArray().ToDictionary(l => l.GetProperty("id").GetString()!, l => l);
        var rooms = net.GetProperty("rooms").EnumerateArray().ToDictionary(r => r.GetProperty("id").GetString()!, r => r);
        var root = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(AreasFile)).RootElement;
        if (root.TryGetProperty("air", out var air))
        {
            d.Air = Col(air.GetProperty("color")).SrgbToLinear();
            d.AirNear = F(air, "near", d.AirNear);
            d.AirFar = F(air, "far", d.AirFar);
            d.Haze = F(air, "haze", d.Haze);
            d.Exposure = F(air, "exposure", d.Exposure);
            if (air.TryGetProperty("fill", out var fl)) d.Fill = Col(fl).SrgbToLinear() * F(air, "fillStrength", 1);
        }
        d.LampPool = (int)F(root, "lampPool", d.LampPool);
        foreach (var a in root.GetProperty("areas").EnumerateArray())
        {
            if (a.TryGetProperty("enabled", out var en) && en.ValueKind == JsonValueKind.False) continue;
            var area = new Area { Id = S(a, "id"), Name = S(a, "name"), Export = S(a, "export"), WaterMin = F(a, "waterMin", -4.6f), WaterRise = F(a, "waterRise", 0.12f) };
            if (a.TryGetProperty("kit", out var kp))
                foreach (var k in kp.EnumerateArray()) area.Kit.Add((S(k, "piece"), V3(k.GetProperty("at")), F(k, "yaw", 0)));
            if (a.TryGetProperty("skipKeys", out var sk)) foreach (var k in sk.EnumerateArray()) area.SkipKeys.Add(k.GetString()!);
            if (a.TryGetProperty("devEntry", out var de)) area.DevEntry = new Vector4(de[0].GetSingle(), de[1].GetSingle(), de[2].GetSingle(), de[3].GetSingle());
            foreach (var z in a.GetProperty("zones").EnumerateArray())
            {
                var cls = d.Classes.GetValueOrDefault(S(z, "cls", "G")) ?? d.Classes.Values.First();
                var zone = new Zone { Id = S(z, "id"), S = cls, Wall = F(z, "wall", 0.6f), FadeStart = F(z, "fadeStart", 0), FadeEnd = F(z, "fadeEnd", 0) };
                if (z.TryGetProperty("rect", out var rc) || (z.TryGetProperty("room", out var rm) && rooms.TryGetValue(rm.GetString()!, out var room) && room.TryGetProperty("rect", out rc)))
                {
                    zone.Kind = "room";
                    zone.Rect = new Rect2(rc[0].GetSingle(), rc[1].GetSingle(), rc[2].GetSingle() - rc[0].GetSingle(), rc[3].GetSingle() - rc[1].GetSingle());
                }
                else
                {
                    var keys = z.TryGetProperty("path", out var pth) ? pth.EnumerateArray().Select(V2).ToArray() : lines[S(z, "line")].GetProperty("pts").EnumerateArray().Select(V2).ToArray();
                    bool[] curve = z.TryGetProperty("curve", out var cv) ? cv.EnumerateArray().Select(b => b.GetBoolean()).ToArray() : new bool[keys.Length - 1];
                    zone.Path = Smooth(keys, curve, F(z, "handle", 3.2f));
                    zone.Along = new float[zone.Path.Length];
                    for (int i = 1; i < zone.Path.Length; i++) zone.Along[i] = zone.Along[i - 1] + zone.Path[i].DistanceTo(zone.Path[i - 1]);
                }
                area.Zones.Add(zone);
            }
            if (a.TryGetProperty("gates", out var gs))
                foreach (var g in gs.EnumerateArray())
                    area.Gates.Add(new Gate
                    {
                        Id = S(g, "id"), Origin = V2(g.GetProperty("origin")), Normal = V2(g.GetProperty("normal")).Normalized(), Depth = F(g, "depth", 1.6f), Sill = F(g, "sill", -5.05f),
                        Opening = g.GetProperty("opening").EnumerateArray().Select(V2).ToArray(),
                        Meshes = g.TryGetProperty("meshes", out var ms) ? ms.EnumerateArray().Select(m => m.GetString()!).ToArray() : Array.Empty<string>(),
                        Clear = g.TryGetProperty("clear", out var cl) ? cl.EnumerateArray().Select(m => m.GetString()!).ToArray() : Array.Empty<string>(),
                    });
            // the export's own markers (its converted markers.json) take the place of the stand-in's lists; a source
            // marked "always" (the outlet's daylight, which Blender lit with its sky) stays
            string markers = area.Export + "/markers.json";
            var own = a;
            bool exported = area.Export != "" && Godot.FileAccess.FileExists(markers);
            if (exported) own = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(markers)).RootElement;
            if (exported && a.TryGetProperty("sources", out var keep))
                foreach (var s in keep.EnumerateArray())
                    if (s.TryGetProperty("always", out var al) && al.ValueKind == JsonValueKind.True) area.Sources.Add(ReadSource(s));
            if (own.TryGetProperty("sources", out var ss))
                foreach (var s in ss.EnumerateArray()) area.Sources.Add(ReadSource(s));
            if (own.TryGetProperty("mist", out var mi))
                foreach (var m in mi.EnumerateArray())
                    area.Mist.Add(new MistBox { Id = S(m, "id"), Min = V3(m.GetProperty("min")), Max = V3(m.GetProperty("max")), Density = F(m, "density", 0.06f) });
            if (own.TryGetProperty("water", out var wa))
                foreach (var w in wa.EnumerateArray())
                    area.Water.Add(new WaterSheet
                    {
                        Id = S(w, "id"), Zone = S(w, "zone"), Width = F(w, "width", 0),
                        Outline = w.TryGetProperty("outline", out var ol) ? ol.EnumerateArray().Select(V2).ToArray() : Array.Empty<Vector2>(),
                        Line = w.TryGetProperty("line", out var ln) ? ln.EnumerateArray().Select(V2).ToArray() : Array.Empty<Vector2>(),
                        Flow = w.TryGetProperty("flow", out var fw) ? V2(fw) : Vector2.Zero,
                    });
            area.Exported = exported;
            area.PenstockRaise = F(a, "penstockRaise", 0);
            if (a.TryGetProperty("rungs", out var rg))
                foreach (var r in rg.EnumerateArray())
                {
                    var wall = V2(r.GetProperty("wall"));
                    var outw = V2(r.GetProperty("out")).Normalized();
                    var ledge = V2(r.GetProperty("ledge"));
                    float bot = F(r, "bottom", -6.1f), top = F(r, "top", -3.6f);
                    area.Ways.Add(new Way { Id = S(r, "id"), Kind = "rungs", Wall = wall, Out = outw, Bottom = new Vector3(wall.X + outw.X * 0.55f, bot, wall.Y + outw.Y * 0.55f), Top = new Vector3(ledge.X, top, ledge.Y) });
                }
            if (own.TryGetProperty("movers", out var mvs) && mvs.ValueKind == JsonValueKind.Array)
                foreach (var m in mvs.EnumerateArray())
                    area.Movers.Add(new Mover { Id = S(m, "id"), Kind = S(m, "kind"), Pivot = V3(m.GetProperty("pivot")), OpenDeg = F(m, "openDeg", 0), Collision = S(m, "collision") });
            if (own.TryGetProperty("ladders", out var lds))
                foreach (var l in lds.EnumerateArray())
                {
                    var top = V3(l.GetProperty("top"));
                    var g = l.TryGetProperty("grate", out var gr) ? V2(gr) : new Vector2(0.66f, 0.66f);
                    area.Ways.Add(new Way { Id = S(l, "id"), Kind = "ladder", Bottom = V3(l.GetProperty("bottom")), Top = top, Hole = new Rect2(top.X - g.X / 2, top.Z - g.Y / 2, g.X, g.Y) });
                }
            if (own.TryGetProperty("stairs", out var sts))
                foreach (var l in sts.EnumerateArray())
                {
                    var h = l.GetProperty("hatch");
                    area.Ways.Add(new Way { Id = S(l, "id"), Kind = "stair", Bottom = V3(l.GetProperty("bottom")), Top = V3(l.GetProperty("top")), Hole = new Rect2(h[0].GetSingle(), h[2].GetSingle(), h[1].GetSingle() - h[0].GetSingle(), h[3].GetSingle() - h[2].GetSingle()) });
                }
            area.Box = BoxOf(area);
            d.Areas.Add(area);
        }
        return d;
    }

    public static Source ReadSource(JsonElement s)
    {
        var src = new Source { Id = S(s, "id"), Kind = S(s, "kind", "lamp"), At = V3(s.GetProperty("at")) };
        if (s.TryGetProperty("dir", out var dr)) src.Dir = V3(dr).Normalized();
        if (s.TryGetProperty("color", out var c)) src.Color = Col(c).SrgbToLinear();
        src.Power = F(s, "power", src.Kind == "lamp" ? 1 : 1);
        src.Range = F(s, "range", src.Kind == "lamp" ? 9 : 14);
        if (s.TryGetProperty("size", out var sz)) { src.HalfU = sz[0].GetSingle() / 2; src.HalfV = sz[1].GetSingle() / 2; }
        src.Round = s.TryGetProperty("round", out var rd) && rd.ValueKind == JsonValueKind.True;
        src.Bars = F(s, "bars", 0);
        src.Haze = F(s, "haze", src.Kind == "lamp" ? 1 : 0);
        src.Beam = F(s, "beam", 0);
        return src;
    }

    /// <summary>A polyline whose marked segments are cubic curves with their handles along the neighbours (the Blender study's Path).</summary>
    public static Vector2[] Smooth(Vector2[] k, bool[] curve, float handle)
    {
        var pts = new List<Vector2> { k[0] };
        for (int i = 0; i + 1 < k.Length; i++)
        {
            var a = k[i]; var b = k[i + 1];
            if (i < curve.Length && curve[i] && i > 0 && i + 2 < k.Length)
            {
                var t0 = (a - k[i - 1]).Normalized();
                var t1 = (k[i + 2] - b).Normalized();
                Vector2 b1 = a + t0 * handle, b2 = b - t1 * handle;
                for (int j = 1; j <= 40; j++)
                {
                    float t = j / 40f, u = 1 - t;
                    pts.Add(u * u * u * a + 3 * u * u * t * b1 + 3 * u * t * t * b2 + t * t * t * b);
                }
            }
            else
            {
                int n = Math.Max(1, (int)MathF.Ceiling(a.DistanceTo(b) / 0.5f));
                for (int j = 1; j <= n; j++) pts.Add(a.Lerp(b, j / (float)n));
            }
        }
        return pts.ToArray();
    }

    private static Aabb BoxOf(Area a)
    {
        var box = new Aabb();
        bool first = true;
        void Add(Vector3 p) { if (first) { box = new Aabb(p, Vector3.Zero); first = false; } else box = box.Expand(p); }
        foreach (var z in a.Zones)
        {
            float half = z.S.Width / 2 + z.Wall + 0.5f;
            if (z.Kind == "room")
            {
                Add(new Vector3(z.Rect.Position.X - z.Wall, z.S.Bed - 0.5f, z.Rect.Position.Y - z.Wall));
                Add(new Vector3(z.Rect.End.X + z.Wall, 0.5f, z.Rect.End.Y + z.Wall));
            }
            else
                foreach (var p in z.Path)
                {
                    Add(new Vector3(p.X - half, z.S.Bed - 0.5f, p.Y - half));
                    Add(new Vector3(p.X + half, 0.5f, p.Y + half));
                }
        }
        return box;
    }

    /// <summary>How far inside the area's covered zones (m; negative outside) a point on the plan is, the best zone.</summary>
    public (float inside, Zone? zone) Inside(Vector2 p)
    {
        float best = float.MinValue;
        Zone? bz = null;
        foreach (var a in Areas)
        {
            if (p.X < a.Box.Position.X - 2 || p.X > a.Box.End.X + 2 || p.Y < a.Box.Position.Z - 2 || p.Y > a.Box.End.Z + 2) continue;
            foreach (var z in a.Zones)
            {
                float d = z.Inside(p, out _);
                if (d > best) { best = d; bz = z; }
            }
        }
        return (best, bz);
    }
}
