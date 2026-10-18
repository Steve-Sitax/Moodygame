using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>A fire that warms: a tavern's hearth or stove (Place "tavern:x"), or an outdoor fire basket (Place null).</summary>
public sealed record NativeHeatSource(string Id, string? Place, double X, double Y, double Z);

/// <summary>
/// Warmth at a fire (#162). Each presence report adds heat for the game minutes since the last one: one point a
/// minute in a lit tavern or a few metres from a burning fire basket, two close to the fire. 120 points are one
/// warmth, up to the heated cap; half an hour of heat in an hour stops that hour's chill. The same rule runs for
/// every player from his own reports; a tavern's fire burns while it is open (its keeper at work), the fire
/// baskets from dusk to the morning shift.
/// </summary>
public sealed partial class NativeCoreClock
{
    public const int BasketFrom = 17, BasketTo = 8, HeatCap = 7, PointsPerWarmth = 120, NoChillPoints = 30, MostMinutes = 15;
    public const double HearthNear = 2.0, BasketNear = 1.6, BasketReach = 3.2, BasketRise = 2.0;
    /// <summary>The town's fires, from the scene (NativeTownGame); empty in rule fixtures that set none.</summary>
    public IReadOnlyList<NativeHeatSource> HeatSources { get; set; } = Array.Empty<NativeHeatSource>();
    private readonly Dictionary<int, (int minute, int points, int level)> heat = new();

    public static bool BasketsLit(int hour) => hour >= BasketFrom || hour < BasketTo;

    /// <summary>0 no fire, 1 in a lit tavern or near a burning basket, 2 close to the fire.</summary>
    public int HeatLevel(string? place, bool open, double? x, double? y, double? z, int hour)
    {
        if (place != null)
        {
            if (!open || !place.StartsWith("tavern:", StringComparison.Ordinal)) return 0;
            var fires = HeatSources.Where(s => s.Place == place).ToArray();
            if (fires.Length == 0) return 0;
            if (x == null || z == null) return 1;
            return fires.Min(s => Flat(s, x.Value, z.Value)) <= HearthNear ? 2 : 1;
        }
        if (!BasketsLit(hour) || x == null || z == null) return 0;
        double best = double.MaxValue;
        foreach (var s in HeatSources)
            if (s.Place == null && (y == null || Math.Abs(s.Y - y.Value) <= BasketRise)) best = Math.Min(best, Flat(s, x.Value, z.Value));
        return best <= BasketNear ? 2 : best <= BasketReach ? 1 : 0;
    }

    private static double Flat(NativeHeatSource s, double x, double z) => Math.Sqrt((s.X - x) * (s.X - x) + (s.Z - z) * (s.Z - z));

    /// <summary>The heat where this player stands now, from his latest report (the same report the shelter uses).</summary>
    private int HeatNow(int id, JsonObject at)
    {
        string? place = at["place"]?.GetValue<string>();
        if (place != null && !place.StartsWith("tavern:", StringComparison.Ordinal)) return 0;
        var p = host.Rest.PositionOf(id);
        return HeatLevel(place, place != null, p?.x, p?.y, p?.z, Number(View(), "hour"));
    }

    /// <summary>Adds the heat for the game minutes since this player's last report.</summary>
    private void AddHeat(int id)
    {
        int now = MinuteNow(), level = HeatNow(id, Where(id));
        if (!heat.TryGetValue(id, out var h) || now < h.minute || now - h.minute > 60) { heat[id] = (now, 0, level); return; }
        int minutes = Math.Min(MostMinutes, now - h.minute);
        heat[id] = (now, h.points + h.level * minutes, level);
    }

    /// <summary>The hour's heat: the warmth it earns, and whether it stops this hour's chill. Keeps the rest
    /// while the player is still at the fire.</summary>
    private (int gain, bool noChill) TakeHeat(int id)
    {
        if (!heat.TryGetValue(id, out var h)) return (0, false);
        int gain = h.points / PointsPerWarmth;
        bool noChill = h.points >= NoChillPoints;
        heat[id] = (h.minute, h.level > 0 ? h.points % PointsPerWarmth : 0, h.level);
        return (Math.Min(gain, 1), noChill);
    }

    public int Warming(int id) => heat.TryGetValue(id, out var h) ? h.level : 0;
}
