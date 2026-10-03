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

    /// <summary>The game clock moved: day 1 is Monday, the hour with fractions.</summary>
    public static void Set(int day, float hour) => River = At(day, hour);

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
