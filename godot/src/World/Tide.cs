using System;

namespace Scheldemist.World;

/// <summary>
/// The tide on the Schelde (the browser's world/tide.ts, same numbers): the river's level by the game clock, the
/// Petit Bassin and the lock chamber behind their gates. Until the clock is ported the river stands where the baked
/// water sheet lies (World/Solid.cs reads it); the clock's part calls Set.
/// </summary>
public static class Tide
{
    /// <summary>Half tide: the old still water level.</summary>
    public const float MidY = -2.8f;
    public const float Half = 2.155f;
    public const float Spring = 0.115f;
    public const float Period = 12 + 25 / 60f;
    public const float Rise = 5.5f;
    public const float SpringDays = 14.765f;
    private const float Hw0 = 9.6f;
    private const float SpringAt = 30;

    public const float HwMax = MidY + Half * (1 + Spring);
    public const float LwMin = MidY - Half * (1 + Spring);
    /// <summary>The Petit Bassin's water, kept just under mean high water by the lock.</summary>
    public const float DockY = -0.7f;
    /// <summary>Water deeper than this over a floor: you swim; shallower: you wade and stand.</summary>
    public const float Wade = 1.2f;

    /// <summary>Where the water stands now: the river (with the canal and the vlieten), the dock, the lock chamber's two ends.</summary>
    public static float River = At(1, 13);
    public static float Dock = DockY;
    public static float ChamberA = DockY;
    public static float ChamberB = DockY;

    /// <summary>The level the river is held at (the W1 tide kit), or null: it follows the clock.</summary>
    public static float? Held { get; private set; }

    /// <summary>The game clock moved: day 1 is Monday, the hour with fractions. A hold wins over it.</summary>
    public static void Set(int day, float hour)
    {
        if (Held is { } h) River = h;
        else River = At(day, hour);
    }

    /// <summary>
    /// Dev (the W1 tide kit, the browser's tideDev.hold): hold the river, the canal and the vlieten at level y
    /// (metres, quay top 0), whatever the clock says; null lets it follow the clock again from the next Set.
    /// The drawn sheet eases there at 0.6 m a second (World/Waters.cs).
    /// </summary>
    public static void Hold(float? y)
    {
        if (y is { } v && !float.IsFinite(v)) throw new ArgumentException("tide hold: a level in metres");
        Held = y;
        if (y is { } level) River = level;
    }

    /// <summary>The dev panel's line on the tide (the browser's tideDev.read): the water now, rising or falling, the next high and low water.</summary>
    public static string Describe(int day, float hour)
    {
        static string F(float y) => (y >= 0 ? "+" : "") + y.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
        static string Hm(float h) => $"{(int)Math.Floor(h % 24)}:{(int)Math.Floor(h % 1 * 60):00}";
        float now = At(day, hour), soon = At(day, hour + 0.1f);
        // the next turn of the tide each way, found in five-minute steps over the next day
        (int day, float hour, float y)? high = null, low = null;
        float prev = now, rise = soon - now;
        for (int i = 1; i <= 24 * 12 && (high == null || low == null); i++)
        {
            float h = hour + i / 12f, y = At(day, h), r = y - prev;
            int d = day + (int)Math.Floor(h / 24);
            if (rise > 0 && r <= 0 && high == null) high = (d, h - 1 / 12f, prev);
            if (rise < 0 && r >= 0 && low == null) low = (d, h - 1 / 12f, prev);
            prev = y;
            rise = r;
        }
        string held = Held is { } hv ? $" (held at {F(hv)} m)" : "";
        string next = (high is { } a ? $" High water day {a.day} {Hm(a.hour)} ({F(a.y)})." : "") + (low is { } b ? $" Low water day {b.day} {Hm(b.hour)} ({F(b.y)})." : "");
        return $"River {F(River)} m (quay top 0; {F(River - MidY)} m from half tide), {(soon > now ? "rising" : "falling")}{held}.{next} Dock {F(Dock)}, lock {F(ChamberA)} / {F(ChamberB)}.";
    }

    private static float Amplitude(float t) => Half * (1 + Spring * MathF.Cos(2 * MathF.PI * (t - SpringAt) / (SpringDays * 24)));

    /// <summary>The river's level (y, metres; quay top 0) on a game day at an hour.</summary>
    public static float At(int day, float hour)
    {
        float t = (Math.Max(1, day) - 1) * 24 + hour;
        float a = Amplitude(t);
        float fall = Period - Rise;
        float ph = ((t - Hw0) % Period + Period) % Period; // hours since high water
        if (ph < fall) return MidY + a * MathF.Cos(MathF.PI * ph / fall);
        return MidY - a * MathF.Cos(MathF.PI * (ph - fall) / Rise);
    }

    // the lock chamber between its gates, the Petit Bassin with its quays (tide.ts CHAMBER, DOCK, LOCK_CHANNEL)
    private const float ChMinX = 100, ChMaxX = 120, ChMinZ = 7, ChMaxZ = 42;
    private const float DkMinX = 62, DkMaxX = 178, DkMinZ = 42, DkMaxZ = 118;
    private const float LcMinX = 104, LcMaxX = 116;
    private const float GateHingeIn = 0.3f;
    private static readonly float GateTan = MathF.Tan(15 * MathF.PI / 180);

    /// <summary>The z of a closed pair of mitre gates at x (they make a V toward the dock).</summary>
    private static float GateLine(float gz, float x)
    {
        float half = (LcMaxX - LcMinX) / 2 - GateHingeIn;
        float d = Math.Max(0, Math.Min(half, Math.Min(x - (LcMinX + GateHingeIn), LcMaxX - GateHingeIn - x)));
        return gz + d * GateTan;
    }

    /// <summary>0 river (tidal), 1 dock, 2 lock chamber.</summary>
    public static int RegionAt(float x, float z)
    {
        if (x > LcMinX && x < LcMaxX && z > ChMinZ - 8 && z < DkMinZ + 6)
        {
            if (z < GateLine(ChMinZ, x)) return 0;
            if (z < GateLine(ChMaxZ, x)) return 2;
            return 1;
        }
        if (x > DkMinX && x < DkMaxX && z > DkMinZ && z < DkMaxZ) return 1;
        if (x > ChMinX && x < ChMaxX && z > ChMinZ && z < ChMaxZ) return 2;
        return 0;
    }

    /// <summary>The still water level at (x, z) now (no waves).</summary>
    public static float LevelAt(float x, float z)
    {
        int r = RegionAt(x, z);
        if (r == 2) return ChamberA + (ChamberB - ChamberA) * (z - ChMinZ) / (ChMaxZ - ChMinZ);
        return r == 0 ? River : Dock;
    }
}
