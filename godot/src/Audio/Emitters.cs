using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.Audio;

/// <summary>Where the sound's files are: one place, so the packaged game can point somewhere else.</summary>
public static class AudioPaths
{
    private static string Beside(string rel) => Path.GetFullPath(Path.Combine(ProjectSettings.GlobalizePath("res://"), rel));
    private static string Pick(string arg, string env, string rel)
    {
        string a = Main.I?.Arg(arg) ?? "";
        if (a != "") return a;
        string e = OS.GetEnvironment(env);
        return e != "" ? e : Beside(rel);
    }
    /// <summary>The recordings (the browser's /audio): --audio dir, or SCHELDEMIST_AUDIO, or client/public/audio beside the project.</summary>
    public static string Audio => Pick("audio", "SCHELDEMIST_AUDIO", "../client/public/audio");
    /// <summary>The game's shared data (city.json): --shared dir, or SCHELDEMIST_SHARED, or shared/ beside the project.</summary>
    public static string Shared => Pick("shared", "SCHELDEMIST_SHARED", "../shared");
}

/// <summary>A place a sound comes from (audio/emitters.ts). Kinds: cathedral, bridge, pontoon, smithy, cooper, crane, ship, pump, tavern, market, lamp.</summary>
public sealed class Emitter
{
    public string Kind = "";
    public double X, Z;
    /// <summary>Height in metres (default 1).</summary>
    public double? Y;
    /// <summary>Loudness multiplier (default 1).</summary>
    public double? Gain;
    public string Name = "";
    /// <summary>The building it belongs to (a tavern's house id): its people drive it.</summary>
    public string? Id;
}

/// <summary>
/// Where the city's sounds come from (audio/emitters.ts). World frame: x along the river, z inland, the Scheldt at
/// z below 0. Most points come from shared/city.json; cranes and moorings mirror world/rijnkaai.ts.
/// </summary>
public static class Emitters
{
    private readonly record struct Pt(double X, double Z);
    private sealed record Water(Pt[] Outer, Pt[][] Holes);
    private sealed record Solid(Pt[] Ring, double X0, double X1, double Z0, double Z1);

    private static readonly Dictionary<string, (double x, double z, string kind)> places = new();
    private static readonly Dictionary<string, double[]> bridges = new();
    private static readonly Dictionary<string, string> bridgeKinds = new();
    private static readonly List<Pt> lamps = new();
    private static readonly List<Water> water = new();
    private static readonly List<double[]> edges = new();
    private static readonly List<Solid> solids = new();
    private static readonly List<(string id, double x, double z)> taverns = new();
    private static bool loaded;

    /// <summary>The town inside its wall (world/townBox.ts).</summary>
    public static double TownX0 = -340, TownZ0 = -80, TownW = 540, TownH = 380;

    // shared/cathedralPlan.ts: ORIGIN, SHELL.halfNave, SHELL.towerSide, SHELL.towerFace, TOWER_E
    private const double CatX = -262, CatZ = 145.53, HalfNave = 6.6, TowerSide = 18.2, TowerFace = 3.2, TowerE = 15.3;
    // world/trades.ts TRADE_SOUNDS
    private static readonly (string kind, double x, double z, double gain, string name)[] TradeSounds =
    {
        ("smithy", 162.8, 22.4, 1, "farrier, Eilandje"),
        ("cooper", -89.8, 126, 1, "cooper, Canal des Brasseurs"),
        ("cooper", -66.5, 169, 0.55, "boat repair yard, the canal"),
    };
    // portal cranes (world/rijnkaai.ts, "cranes")
    private static readonly double[][] Cranes = { new[] { -24.0, 4 }, new[] { 0.0, 4 }, new[] { 60.0, 4 }, new[] { 66.0, 62 }, new[] { 66.0, 92 }, new[] { 173.0, 66 }, new[] { 173.0, 100 }, new[] { -280.0, 4 }, new[] { -240.0, 4 }, new[] { -300.0, 4 } };
    // moored rows (world/rijnkaai.ts, mooreAlong): from, to, and the water they lie towards
    private static readonly double[][] Moorings =
    {
        new[] { -316.0, 0, -258, 0, 0, -40 }, new[] { -240.0, 0, -216, 0, 0, -40 }, new[] { -140.0, 0, -90, 0, 0, -40 }, new[] { 60.0, 0, 100, 0, 0, -40 },
        new[] { 120.0, 0, 176, 0, 0, -40 }, new[] { -82.0, 12, -82, 202, -76, 100 }, new[] { -70.0, 12, -70, 202, -76, 100 }, new[] { 70.0, 50, 70, 106, 120, 78 },
        new[] { 170.0, 50, 170, 106, 120, 78 }, new[] { 76.0, 110, 164, 110, 120, 78 }, new[] { 120.0, 46, 164, 46, 120, 78 },
    };
    // ships at anchor or alone in a basin
    private static readonly double[][] Anchored = { new[] { -150.0, -62 }, new[] { -40.0, -48 }, new[] { 110.0, -44 }, new[] { -205.0, -64 }, new[] { 30.0, -70 }, new[] { 125.0, 80 } };

    private static Pt[] Ring(JsonElement e) => e.EnumerateArray().Select(p => new Pt(p[0].GetDouble(), p[1].GetDouble())).ToArray();

    /// <summary>Read shared/city.json and shared/inworld_houses.json once. False when the city file is not there (no places: the beds still play).</summary>
    public static bool Load()
    {
        if (loaded) return true;
        string file = Path.Combine(AudioPaths.Shared, "city.json");
        if (!File.Exists(file))
        {
            GD.PrintErr($"[sound] no city file: {file}");
            return false;
        }
        using var doc = JsonDocument.Parse(File.ReadAllText(file));
        var c = doc.RootElement;
        foreach (var p in c.GetProperty("places").EnumerateObject()) places[p.Name] = (p.Value.GetProperty("x").GetDouble(), p.Value.GetProperty("z").GetDouble(), p.Value.GetProperty("kind").GetString() ?? "");
        foreach (var b in c.GetProperty("bridges").EnumerateObject()) bridges[b.Name] = b.Value.EnumerateArray().Select(v => v.GetDouble()).ToArray();
        foreach (var b in c.GetProperty("bridgeKinds").EnumerateObject()) bridgeKinds[b.Name] = b.Value.GetString() ?? "";
        if (c.TryGetProperty("decor", out var decor))
        {
            if (decor.TryGetProperty("lamps", out var ls)) foreach (var l in ls.EnumerateArray()) lamps.Add(new Pt(l[0].GetDouble(), l[1].GetDouble()));
            if (decor.TryGetProperty("rampart", out var r) && r.TryGetProperty("inner", out var inner))
            {
                double west = Math.Floor(inner.GetProperty("west").GetDouble()), east = Math.Ceiling(inner.GetProperty("east").GetDouble()), north = Math.Ceiling(inner.GetProperty("north").GetDouble());
                (TownX0, TownW, TownH) = (west, east - west, north + 80);
            }
        }
        foreach (var w in c.GetProperty("water").EnumerateArray()) water.Add(new Water(Ring(w.GetProperty("outer")), w.GetProperty("holes").EnumerateArray().Select(Ring).ToArray()));

        // quay edges: water outline segments, without the ones on the map border
        var area = Ring(c.GetProperty("area"));
        double minX = area.Min(p => p.X), maxX = area.Max(p => p.X), minZ = area.Min(p => p.Z);
        foreach (var w in water)
            foreach (var ring in w.Holes.Prepend(w.Outer))
                for (int i = 0; i < ring.Length; i++)
                {
                    var a = ring[i];
                    var b = ring[(i + 1) % ring.Length];
                    bool onBorder = (a.X == b.X && (a.X <= minX || a.X >= maxX)) || (a.Z == b.Z && a.Z <= minZ);
                    if (!onBorder) edges.Add(new[] { a.X, a.Z, b.X, b.Z });
                }

        // house blocks and the landmarks' footprints: what a sound has to pass through or round
        var rings = new List<Pt[]>();
        if (c.TryGetProperty("blocks", out var blocks)) foreach (var b in blocks.EnumerateArray()) rings.Add(Ring(b.GetProperty("outer")));
        if (c.TryGetProperty("landmarks", out var lm))
            foreach (var l in lm.EnumerateObject())
                if (l.Value.TryGetProperty("fp", out var fp) && fp.GetArrayLength() > 2) rings.Add(Ring(fp));
        foreach (var r in rings) solids.Add(new Solid(r, r.Min(p => p.X), r.Max(p => p.X), r.Min(p => p.Z), r.Max(p => p.Z)));

        string houses = Path.Combine(AudioPaths.Shared, "inworld_houses.json");
        if (File.Exists(houses))
        {
            using var hd = JsonDocument.Parse(File.ReadAllText(houses));
            foreach (var h in hd.RootElement.GetProperty("houses").EnumerateArray())
                if (h.GetProperty("kind").GetString() == "tavern") taverns.Add((h.GetProperty("id").GetString() ?? "", h.GetProperty("door")[0].GetDouble(), h.GetProperty("door")[1].GetDouble()));
        }
        loaded = true;
        return true;
    }

    /// <summary>Every emitter the city file (and the world lists above) gives.</summary>
    public static List<Emitter> CityEmitters()
    {
        var o = new List<Emitter>();
        if (!Load()) return o;
        // the cathedral's tall north tower on the west front, bells some 65 m up
        double v = (HalfNave + TowerSide) / 2, u = (TowerFace + TowerE) / 2;
        o.Add(new Emitter { Kind = "cathedral", X = CatX + v, Z = CatZ + u, Y = 65, Name = "Cathedral of Our Lady (north tower)" });

        // bridges: water under the arch; the ferry pontoon ripples instead
        foreach (var (id, b) in bridges)
            o.Add(new Emitter { Kind = bridgeKinds.GetValueOrDefault(id) == "pontoon" ? "pontoon" : "bridge", X = (b[0] + b[2]) / 2, Z = (b[1] + b[3]) / 2, Y = -1.2, Name = id.Replace('_', ' ') });
        // the Rijnkaai pier stands in the water too
        o.Add(new Emitter { Kind = "pontoon", X = -24, Z = -12, Y = -1.2, Gain = 0.8, Name = "Rijnkaai pier" });

        // squares: a pump on each; stalls on the fish market (strong) and the Grote Markt
        foreach (var (name, p) in places)
            if (p.kind == "square") o.Add(new Emitter { Kind = "pump", X = p.x + 6, Z = p.z + 5, Y = 1, Name = $"pump, {name}" });
        if (places.TryGetValue("Vismarkt", out var vis)) o.Add(new Emitter { Kind = "market", X = vis.x, Z = vis.z + 4, Y = 1.6, Gain = 1, Name = "Vismarkt stalls" });
        if (places.TryGetValue("Grote Markt", out var gm)) o.Add(new Emitter { Kind = "market", X = gm.x, Z = gm.z, Y = 1.6, Gain = 0.5, Name = "Grote Markt stalls" });

        // a smithy near the docks; the working trades (world/trades.ts)
        o.Add(new Emitter { Kind = "smithy", X = 50, Z = 46.5, Y = 1.2, Name = "smithy, Rijnkaai" });
        foreach (var t in TradeSounds) o.Add(new Emitter { Kind = t.kind, X = t.x, Z = t.z, Y = 1.2, Gain = t.gain, Name = t.name });

        // taverns: at their street doors (shared/inworld_houses.json)
        foreach (var t in taverns) o.Add(new Emitter { Kind = "tavern", X = t.x, Z = t.z, Y = 1.4, Name = t.id.Replace("tavern:", "tavern "), Id = t.id });

        foreach (var c in Cranes) o.Add(new Emitter { Kind = "crane", X = c[0], Z = c[1], Y = 6, Name = $"crane {c[0]},{c[1]}" });

        // ships: one point every 22 m along each moored row, a few metres out
        foreach (var m in Moorings)
        {
            double len = Hyp(m[2] - m[0], m[3] - m[1]);
            int n = Math.Max(1, (int)Math.Round(len / 22));
            for (int i = 0; i < n; i++)
            {
                double t = (i + 0.5) / n, x = m[0] + (m[2] - m[0]) * t, z = m[1] + (m[3] - m[1]) * t;
                double d = Hyp(m[4] - x, m[5] - z);
                if (d == 0) d = 1;
                o.Add(new Emitter { Kind = "ship", X = x + (m[4] - x) / d * 4, Z = z + (m[5] - z) / d * 4, Y = 1, Name = "moored boat" });
            }
        }
        foreach (var a in Anchored) o.Add(new Emitter { Kind = "ship", X = a[0], Z = a[1], Y = 2, Name = "ship at anchor" });

        // gas lamps (the world adds its own quay lamps; the Soundscape drops doubles)
        foreach (var l in lamps) o.Add(new Emitter { Kind = "lamp", X = l.X, Z = l.Z, Y = 3, Name = "gas lamp" });
        return o;
    }

    private static double Hyp(double a, double b) => Math.Sqrt(a * a + b * b);

    private static bool InRing(Pt[] ring, double x, double z)
    {
        bool inside = false;
        for (int i = 0, j = ring.Length - 1; i < ring.Length; j = i++)
        {
            var a = ring[i];
            var b = ring[j];
            if (a.Z > z != b.Z > z && x < (b.X - a.X) * (z - a.Z) / (b.Z - a.Z) + a.X) inside = !inside;
        }
        return inside;
    }

    /// <summary>Is (x, z) over open water (river, canals, basin)?</summary>
    public static bool OverWater(double x, double z)
    {
        foreach (var w in water)
        {
            if (!InRing(w.Outer, x, z)) continue;
            bool hole = false;
            foreach (var h in w.Holes) if (InRing(h, x, z)) { hole = true; break; }
            if (!hole) return true;
        }
        return false;
    }

    /// <summary>Nearest point on a quay edge, and how far it is.</summary>
    public static (double x, double z, double d) NearestQuay(double x, double z)
    {
        (double x, double z, double d) best = (x, 0, double.PositiveInfinity);
        foreach (var e in edges)
        {
            double dx = e[2] - e[0], dz = e[3] - e[1];
            double l2 = dx * dx + dz * dz;
            if (l2 == 0) l2 = 1;
            double t = Math.Clamp(((x - e[0]) * dx + (z - e[1]) * dz) / l2, 0, 1);
            double px = e[0] + dx * t, pz = e[1] + dz * t;
            double d = Hyp(x - px, z - pz);
            if (d < best.d) best = (px, pz, d);
        }
        return best;
    }

    private static bool InSolid(double x, double z)
    {
        foreach (var s in solids) if (x > s.X0 && x < s.X1 && z > s.Z0 && z < s.Z1 && InRing(s.Ring, x, z)) return true;
        return false;
    }

    /// <summary>
    /// Metres of house blocks (and landmark walls) on the straight line from a to b, sampled every few metres; the
    /// first and last 2.5 m do not count (a door, a quay wall).
    /// </summary>
    public static double BlockedMetres(double ax, double az, double bx, double bz)
    {
        double len = Hyp(bx - ax, bz - az);
        if (len < 6) return 0;
        int n = Math.Min(36, (int)Math.Ceiling(len / 3));
        double step = len / n, m = 0;
        for (int i = 1; i < n; i++)
        {
            double s = i * step;
            if (s < 2.5 || len - s < 2.5) continue;
            double t = s / len;
            if (InSolid(ax + (bx - ax) * t, az + (bz - az) * t)) m += step;
        }
        return m;
    }

    /// <summary>Streets a horse and cart can be heard on (never seen). Waypoints go over the bridges, not through the water.</summary>
    public static List<double[][]> CartRoutes()
    {
        if (!Load()) return new();
        double[] P(string n, double dx = 0, double dz = 0) => places.TryGetValue(n, out var q) ? new[] { q.x + dx, q.z + dz } : new[] { 0.0, 0 };
        double[] Mid(string id) => bridges.TryGetValue(id, out var b) ? new[] { (b[0] + b[2]) / 2, (b[1] + b[3]) / 2 } : new[] { 0.0, 0 };
        return new List<double[][]>
        {
            // along the quays, Werf to the lock and back
            new[] { P("Werf", -20, 6), P("Steenplein"), Mid("vliet_mouth"), P("Vismarkt"), Mid("canal_mouth"), P("Rijnkaai"), Mid("lock_bridge"), new[] { 150.0, 30 } },
            // Steenplein up to the Grote Markt and the Handschoenmarkt
            new[] { P("Steenplein"), new[] { -204.0, 40 }, new[] { -204.0, 128 }, P("Handschoenmarkt"), P("Grote Markt"), new[] { -240.0, 60 }, new[] { -204.0, 40 } },
            // the warehouse streets behind the Rijnkaai
            new[] { P("Rijnkaai"), new[] { 33.0, 70 }, new[] { 33.0, 108 }, new[] { -4.0, 108 }, new[] { -4.0, 70 }, new[] { 33.0, 70 } },
        };
    }
}
