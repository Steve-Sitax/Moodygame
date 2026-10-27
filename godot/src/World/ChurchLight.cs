using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The four churches' own light (Steve 2026-10-27: the naves looked lit by tubes, even grey-white light everywhere and no
/// shadow). The bake lit each church hall as one even room: a strong sky and ambient on every face, day and night, and
/// a big cold lamp high in the nave (60 m reach) burning all day. An 1873 church is dim: by day the light comes only
/// through its windows, the vaults, aisles and chapels stay in gloom; after dark its candles light warm pools that
/// fall off fast: the high altar, the side altars and their votive racks, the lit candle crowns over the nave.
/// - Rooms.cs gives a church hall a low sky and ambient (SkyDay, SkyNight ...: the sky's share lights only what faces up,
///   the floor and the seats), scaled by the day outside, and these lamps in place of the bake's (at most the room's
///   ten, Rooms.RoomPointLights);
/// - a window lamp stands just outside its glass: it lights the pillars, pews and floor that face the window and leaves
///   the window's own wall dark (no shadow map: the light's direction makes the shading);
/// - a flame lamp sits at its candles: the altar's row, a votive rack, under a crown's ring; it flickers a little; the
///   high altar's and the crowns' cast soft shadows (pillars, pews, statues, the ring on the vault), at night only; a
///   window lamp and a night flame share one light (it moves at dusk while both are out);
/// - each candle of the bake's wax (material lm_wax) near a lit flame lamp gets a small flame glow, one of the gas
///   lamps' fixed halos (Lights.FixedHalos: no draw and no shader more). A votive rack's candles burn by day too.
/// </summary>
[GamePart(28)]
public partial class ChurchLight : Node
{
    public enum Role { Window, Flame }

    /// <summary>
    /// A church lamp: a window's daylight or a flame's; its strength (Godot energy), reach and fall-off; how much of it
    /// burns by day (a votive rack 1, a crown 0); the votive racks it stands for (their candles burn all day).
    /// </summary>
    public sealed record Spec(Role Role, Vector3 At, float Energy, float Range, float Decay = 2, float DayShare = 0, Vector3[]? Votives = null, bool Shadow = false);

    /// <summary>The flames of the cathedral's standing lamps (church/lamp_stand, drawn by room-cathedral-source-8902-4).</summary>
    public static readonly Vector3[] LampStands = { new(-239.45f, 2.27f, 183.35f), new(-284.55f, 2.27f, 180.45f) };

    private static Spec Win(float x, float y, float z, float e) => new(Role.Window, new Vector3(x, y, z), e, 32, 1.6f);
    private static Spec Altar(float x, float y, float z, float e = 3.5f, float r = 12, bool shadow = true) => new(Role.Flame, new Vector3(x, y, z), e, r, Shadow: shadow);
    private static Spec Side(float x, float y, float z, float e = 2.0f, float r = 9) => new(Role.Flame, new Vector3(x, y, z), e, r);
    private static Spec Rack(float x, float y, float z, float e, float r, float dayShare, params Vector3[] racks) => new(Role.Flame, new Vector3(x, y, z), e, r, 2, dayShare, racks);
    private static Spec Crown(float x, float y, float z, float e = 4.2f, float r = 15) => new(Role.Flame, new Vector3(x, y, z), e, r, Shadow: true);

    /// <summary>
    /// The churches' lamps, placed from the bake's candles (lm_wax) and window openings (a window lamp 1.2 m outside
    /// its glass). A window lamp and a night flame share one light (Rooms.ChurchLamps): it lights the window by day,
    /// goes out at dusk and burns at its candles after dark, so a church keeps its ten lights. St Paul and St James:
    /// the high altar at the west end, the nave crowns' rings at 10.45 m (a crown's lamp 3 m under its ring: its light
    /// on the floor and the pews, less on the high walls); their aisle crowns stay unlit after dark, so the aisles keep
    /// their gloom. The cathedral's lamp stands (#198, by the confessionals) stay as they were lit.
    /// </summary>
    public static readonly Dictionary<string, Spec[]> Lamps = new()
    {
        ["stpaul"] = new[]
        {
            Altar(69.8f, 2.5f, 266),
            Rack(93.9f, 2.0f, 249.9f, 2.0f, 9, 0.35f, new Vector3(92.17f, 1.12f, 250.26f)),
            Rack(93.9f, 2.0f, 282.1f, 2.0f, 9, 0.35f, new Vector3(92.17f, 1.12f, 281.74f)),
            Crown(94.97f, 7.1f, 266), Crown(113.89f, 7.1f, 266), Crown(125.95f, 7.1f, 266),
            // the transepts' tall windows, the south aisle's, a north aisle's, the nave's clerestory, the choir's
            Win(94.97f, 12, 245.8f, 19.6f), Win(94.97f, 12, 286.2f, 19.6f), Win(112.51f, 8, 282.3f, 19.6f), Win(128.23f, 8, 282.3f, 19.6f),
            Win(120.37f, 3.9f, 245.9f, 9.8f), Win(112.51f, 17.4f, 259.3f, 14), Win(64.8f, 14.5f, 266, 14),
        },
        ["stjacob"] = new[]
        {
            Altar(-130.3f, 2.5f, 305, 3.0f, 11), Altar(-120.6f, 2.3f, 305, 2.0f, 9, false),
            Side(-108.1f, 2.2f, 282.2f), Side(-108.1f, 2.2f, 327.8f),
            Rack(-110.1f, 1.8f, 305, 1.2f, 7, 1, new Vector3(-110.09f, 1.42f, 301.6f), new Vector3(-110.09f, 1.42f, 308.4f)),
            Crown(-106.47f, 7.1f, 305), Crown(-92.93f, 7.1f, 305), Crown(-76.01f, 7.1f, 305),
            // the transepts' great windows, the aisles', the clerestory's, the choir's
            Win(-106.47f, 12, 276.6f, 25.2f), Win(-106.47f, 12, 333.4f, 25.2f), Win(-78.07f, 4.6f, 283.3f, 19.6f), Win(-90.87f, 4.6f, 326.7f, 19.6f),
            Win(-84.47f, 12.65f, 289.8f, 14), Win(-97.27f, 12.65f, 320.2f, 14), Win(-129.8f, 6.1f, 294.2f, 25.2f),
        },
        ["carolus"] = new[]
        {
            Altar(-116, 2.9f, 199.4f, 3.0f, 9),
            Side(-125.2f, 2.3f, 193.4f, 1.6f, 8), Side(-106.8f, 2.3f, 193.4f, 1.6f, 8),
            Rack(-100.6f, 2.0f, 191.8f, 1.6f, 8, 0.35f, new Vector3(-102.61f, 1.57f, 189.93f)),
            Crown(-116, 6.3f, 177.75f, 3.5f, 15), Crown(-116, 6.3f, 183.75f, 3.5f, 15), Crown(-116, 6.3f, 189.75f, 3.5f, 15),
            // the east aisle's windows, the west gallery's, the clerestories, the apse over the high altar
            Win(-93.6f, 6.8f, 175.15f, 14), Win(-93.6f, 6.8f, 190.75f, 14), Win(-138.7f, 6.3f, 183.9f, 11.2f),
            Win(-130.0f, 12.6f, 178.55f, 12.6f), Win(-102.0f, 12.6f, 189.95f, 12.6f), Win(-116, 14.75f, 204.2f, 12.6f),
        },
        ["cathedral"] = new[]
        {
            Altar(-262, 2.8f, 250.9f, 3.0f, 13),
            Crown(-262, 6.3f, 175.5f, 5.25f, 17), Crown(-262, 6.3f, 193.5f, 5.25f, 17), Crown(-262, 6.3f, 220.13f, 5.25f, 17),
            Rack(-239.6f, 2.2f, 219.4f, 2.2f, 10, 0.35f, new Vector3(-236.07f, 1.40f, 225.46f)),
            Rack(-285.4f, 2.2f, 219.4f, 2.2f, 10, 0.35f, new Vector3(-286.57f, 1.68f, 225.67f)),
            // (#198) the standing lamps by the confessionals, as the transept altar's light, a little weaker
            new Spec(Role.Flame, LampStands[0], 6.5f / MathF.PI, 9, 1.5f), new Spec(Role.Flame, LampStands[1], 6.5f / MathF.PI, 9, 1.5f),
            // the aisles' windows, the transepts' great end windows, the choir's clerestory over the high altar
            Win(-234.8f, 12, 172.7f, 22.4f), Win(-234.8f, 12, 199.5f, 22.4f), Win(-289.2f, 9.1f, 172.7f, 22.4f), Win(-289.2f, 9.1f, 199.5f, 22.4f),
            Win(-224.8f, 14, 220.13f, 30.8f), Win(-299.2f, 14, 220.13f, 30.8f), Win(-262, 25, 260.2f, 33.6f),
        },
    };

    /// <summary>A church's sky, ground and ambient light by day (scaled by the day outside) and after dark: low, so the
    /// windows and the candles make the light.</summary>
    public static readonly Vector3 SkyDay = new(0.12f, 0.114f, 0.105f), GroundDay = new(0.028f, 0.026f, 0.024f), AmbDay = new(0.010f, 0.009f, 0.008f);
    public static readonly Vector3 SkyNight = new(0.042f, 0.034f, 0.026f), GroundNight = new(0.007f, 0.006f, 0.0052f), AmbNight = new(0.003f, 0.0026f, 0.0022f);
    /// <summary>The window light's colour (the day through old glass, a little cool) and the candles' (the bake's #ffae70).</summary>
    public static readonly Color WindowColour = new(0.86f, 0.87f, 0.93f), FlameColour = new(1f, 0xae / 255f, 0x70 / 255f);

    /// <summary>How lit a candle's glow is (the gas lamps' halo is a lamp's: a candle's is about half of it).</summary>
    public const float FlameGlow = 0.55f;

    /// <summary>The flames' glows: per church, each fixed halo's index and whether it burns by day (a votive rack's).</summary>
    public static readonly Dictionary<string, List<(int halo, bool allDay)>> Flames = new();

    /// <summary>The window light's strength from the day outside: the sky's and the sun's, 1 on a clear noon (rain's about half).</summary>
    public static float WindowK(Daylight day) => Mathf.Clamp((day.SkyIntensity + day.SunIntensity) / 5.94f, 0, 1.2f) * (1 - day.Night);

    /// <summary>How lit the night flames are (0 until the dusk is half dark, then up to 1), and how much of the windows'
    /// light is left (out at the same half: a shared lamp moves while it is dark).</summary>
    public static float FlameK(Daylight day) => Mathf.Clamp(2 * day.Night - 1, 0, 1);
    public static float DayK(Daylight day) => WindowK(day) * Mathf.Clamp(1 - 2 * day.Night, 0, 1);

    /// <summary>A flame's flicker (the lamp's energy factor), each lamp its own.</summary>
    public static float Flicker(double t, float seed) => 1 + 0.06f * MathF.Sin((float)t * 7.3f + seed) + 0.035f * MathF.Sin((float)t * 13.1f + seed * 2.3f);

    public override void _Ready()
    {
        if (Main.I.World == null) return;
        foreach (var n in BakedWorld.All(Main.I.World))
        {
            if (n is not Node3D root || !n.HasMeta("extras")) continue;
            var ex = n.GetMeta("extras").AsGodotDictionary();
            if (!ex.TryGetValue("room", out var rv)) continue;
            string id = JsonDocument.Parse(Json.Stringify(rv)).RootElement.GetProperty("id").GetString() ?? "";
            if (!Lamps.TryGetValue(id, out var specs) || Flames.ContainsKey(id)) continue;
            var list = Flames[id] = new();
            foreach (var tip in CandleTips(root))
            {
                // a candle burns when a lit flame lamp stands by it: a crown's (high up) within its pool, an altar's or a
                // rack's within three quarters of its reach
                var lamp = specs.Where(s => s.Role == Role.Flame && (tip.Y > 4) == (s.At.Y > 4) && s.At.DistanceTo(tip) < s.Range * (tip.Y > 4 ? 0.6f : 0.75f))
                    .OrderBy(s => s.At.DistanceSquaredTo(tip)).FirstOrDefault();
                if (lamp == null) continue;
                bool allDay = lamp.Votives?.Any(v => new Vector2(v.X - tip.X, v.Z - tip.Z).Length() < 0.7f && MathF.Abs(v.Y - tip.Y) < 0.8f) == true;
                Lights.FixedHalos.Add((tip + new Vector3(0, 0.035f, 0), tip.Y > 4 ? 0.16f : 0.13f));
                list.Add((Lights.FixedHalos.Count - 1, allDay));
            }
            GD.Print($"church light {id}: {specs.Length} lamps ({specs.Count(s => s.Role == Role.Window)} windows), {list.Count} candle flames ({list.Count(f => f.allDay)} burn all day)");
        }
    }

    /// <summary>The tips of the bake's candles in a room: its wax's corners, each candle one cluster (5 cm cells).</summary>
    private static List<Vector3> CandleTips(Node3D root)
    {
        var cell = new Dictionary<Vector3I, (Vector3 lo, Vector3 hi)>();
        foreach (var mi in BakedWorld.All(root).OfType<MeshInstance3D>())
        {
            if (mi.Mesh == null) continue;
            var xf = mi.GlobalTransform;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                if (mi.GetActiveMaterial(s)?.ResourceName.Contains("wax") != true) continue;
                foreach (var p0 in mi.Mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array())
                {
                    var p = xf * p0;
                    var k = new Vector3I(Mathf.FloorToInt(p.X / 0.05f), Mathf.FloorToInt(p.Y / 0.05f), Mathf.FloorToInt(p.Z / 0.05f));
                    cell[k] = cell.TryGetValue(k, out var b) ? (b.lo.Min(p), b.hi.Max(p)) : (p, p);
                }
            }
        }
        // join touching cells into candles
        var parent = cell.Keys.ToDictionary(k => k, k => k);
        Vector3I Find(Vector3I x) { while (parent[x] != x) x = parent[x] = parent[parent[x]]; return x; }
        foreach (var k in cell.Keys)
            for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) for (int dz = -1; dz <= 1; dz++)
            {
                var o = k + new Vector3I(dx, dy, dz);
                if (!parent.ContainsKey(o)) continue;
                var (a, b) = (Find(k), Find(o));
                if (a != b) parent[a] = b;
            }
        return cell.GroupBy(c => Find(c.Key)).Select(g =>
        {
            var lo = g.Select(c => c.Value.lo).Aggregate((a, b) => a.Min(b));
            var hi = g.Select(c => c.Value.hi).Aggregate((a, b) => a.Max(b));
            return new Vector3((lo.X + hi.X) / 2, hi.Y, (lo.Z + hi.Z) / 2);
        }).ToList();
    }
}
