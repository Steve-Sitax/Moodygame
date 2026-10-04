using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The dark's small life (the browser's world/alive/night.ts), the parts that are seen:
/// - moths round the lit gas lamps on a still, dry night: five pale specks circling each of the ten nearest glasses,
///   now in, now out, their wings catching the light; fewer on a cold night;
/// - cats' eyes in the dark lanes and yards: a pair of green-gold points low by a wall or up on a sill, 7-26 m off,
///   never near a lamp, blinking now and then; come within 5 m and the cat is gone until its next stretch. The spots
///   and the stretches are the town's dice (the same on every PC).
/// Two draws (AirPoints); nothing made in a frame once a cell's spot is known.
/// </summary>
[GamePart(42)]
public partial class NightLife : Node
{
    public static NightLife? I { get; private set; }

    // ------------------------------------------------------------------ moths
    private const int MothLamps = 10, PerLamp = 5;
    private AirPoints moths = null!;
    private readonly float[] mothSeed = new float[MothLamps * PerLamp];
    private readonly Vector3[] mothAt = new Vector3[MothLamps];
    private readonly (int lamp, float d)[] nearLamps = new (int, float)[64];
    private int mothLamps;
    private float mothLevel, mothWait;

    // ------------------------------------------------------------------ cats' eyes
    private const int Pairs = 6;
    private const float Cell = 10, Slot = 40;
    private AirPoints eyes = null!;
    private readonly Dictionary<long, Vector3?> spots = new();
    private readonly Dictionary<long, float> fade = new();
    private readonly Dictionary<long, int> spooked = new();
    private readonly (long key, Vector3 at, float seed, float d)[] found = new (long, Vector3, float, float)[64];
    private readonly long[] shownKeys = new long[Pairs];
    private readonly long[] gone = new long[32];
    private int shown;

    /// <summary>For a check: the lamps with moths and how many fly, the cats' eyes shown and the first one's place.</summary>
    public (int mothLamps, float mothLevel, int eyes, Vector3 firstEye, int cells, int spots) Info { get; private set; }
    private int spotCount;

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 60;
        moths = new AirPoints("alive_moths_live", MothLamps * PerLamp);
        moths.Param("shape", 1.0f);
        moths.Param("col", new Vector3(1, 0.9f, 0.7f));
        moths.Param("min_px", 1.5f);
        moths.Param("max_px", 4.0f);
        moths.Param("fog_fade", 1.0f);
        uint r = 281;
        for (int i = 0; i < mothSeed.Length; i++) mothSeed[i] = Air.Mulberry(ref r);
        eyes = new AirPoints("alive_cat_eyes_live", Pairs * 2, add: true, priority: 3);
        eyes.Param("shape", 1.0f);
        eyes.Param("col", new Vector3(0.75f, 0.95f, 0.35f));
        // (two pixels of the browser's 270-line picture; eyeshine carries further than a wall is seen)
        eyes.Param("min_px", 720f / 270 * 2);
        eyes.Param("max_px", 720f / 270 * 2);
        eyes.Param("fog_mix", 0.0f);
        eyes.Param("fog_fade", 0.6f);
        eyes.Param("fog_reach", 1.2f);
        Main.I.World.Unported.RemoveAll(u => u is "alive_moths" or "alive_cat_eyes");
    }

    public override void _ExitTree()
    {
        if (I == this) I = null;
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        var lights = Lights.I;
        if (day == null || lights == null) return;
        float dt = (float)Math.Min(delta, 0.1);
        float t = Time.GetTicksMsec() / 1000f;
        var eye = Main.I.Cam.GlobalPosition;
        float night = NightAt(day);
        float cold = Air.Cold(day.Hour, day.Weather);
        Moths(day, lights, eye, night, cold, t, dt);
        Eyes(day, lights, eye, night, t, dt);
        Info = (mothLamps, mothLevel, shown, shown > 0 ? shownAt : Vector3.Zero, spots.Count, spotCount);
    }

    /// <summary>alive/index.ts nightAt with the dim of a grey day: 0 by day, 1 at night.</summary>
    /// <summary>The alive parts' night (alive/index.ts frame night): 1 after dark, by the clock and the weather's dimness.</summary>
    internal static float NightAt(Daylight day)
    {
        static float N(float h) => h < 6.2f || h > 18.3f ? 1 : h < 8.2f ? 1 - (h - 6.2f) / 2 : h > 16.2f ? (h - 16.2f) / 2.1f : 0;
        float dim = day.Weather is "fog" or "rain" or "storm" ? 0.4f : 0;
        return Math.Max(N(day.Hour + dim), N(day.Hour - dim));
    }

    private void Moths(Daylight day, Lights lights, Vector3 eye, float night, float cold, float t, float dt)
    {
        // a still, dry night; October: fewer on a cold one
        bool still = day.Wind.Length() < 1.0f && day.Rain < 0.05f && day.Weather != "storm";
        mothLevel += ((night > 0.7f && still ? 1 - 0.5f * cold : 0) - mothLevel) * Math.Min(1, dt);
        mothWait -= dt;
        if (mothWait <= 0)
        {
            mothWait = 0.5f;
            int n = 0;
            for (int i = 0; i < lights.LampCount && n < nearLamps.Length; i++)
            {
                var at = lights.LampAt(i);
                float d = new Vector2(at.X - eye.X, at.Z - eye.Z).Length();
                if (d < 28 && lights.LampBright(i) > 0.05f) nearLamps[n++] = (i, d);
            }
            Array.Sort(nearLamps, 0, n, DistanceOrder.Instance);
            mothLamps = Math.Min(MothLamps, n);
            for (int i = 0; i < mothLamps; i++) mothAt[i] = lights.LampAt(nearLamps[i].lamp);
        }
        for (int i = 0; i < MothLamps; i++)
            for (int k = 0; k < PerLamp; k++)
            {
                int j = i * PerLamp + k;
                if (i >= mothLamps || mothLevel < 0.01f) { moths.Hide(j); continue; }
                // an uneven orbit round the glass, now in, now out; darting
                float sd = mothSeed[j], s = sd * 43;
                float a = t * (2.2f + sd * 2.5f) * (sd > 0.5f ? 1 : -1) + s;
                float r = 0.25f + 0.3f * MathF.Abs(MathF.Sin(t * 1.3f + s)) + 0.1f * MathF.Sin(t * 9 + s * 2);
                var p = mothAt[i] + new Vector3(MathF.Cos(a) * r, 0.2f * MathF.Sin(t * 3.1f + s) + 0.12f * MathF.Sin(t * 11 + s), MathF.Sin(a * 1.1f) * r);
                // wings catch the light: a flicker
                moths.Set(j, p, 0.05f, mothLevel * (0.55f + 0.45f * MathF.Sin(t * 30 + s * 7)), sd);
            }
        moths.Commit();
    }

    private sealed class DistanceOrder : IComparer<(int lamp, float d)>
    {
        public static readonly DistanceOrder Instance = new();
        public int Compare((int lamp, float d) a, (int lamp, float d) b) => a.d.CompareTo(b.d);
    }

    private sealed class FoundOrder : IComparer<(long key, Vector3 at, float seed, float d)>
    {
        public static readonly FoundOrder Instance = new();
        public int Compare((long key, Vector3 at, float seed, float d) a, (long key, Vector3 at, float seed, float d) b) => a.d.CompareTo(b.d);
    }

    private static long Key(int i, int j) => ((long)i << 32) ^ (uint)j;

    /// <summary>A cell's spot: open ground by a wall, mostly in a narrow lane or a yard, away from the lamps; null: none.</summary>
    private Vector3? SpotOf(int ci, int cj, Lights lights)
    {
        long key = Key(ci, cj);
        if (spots.TryGetValue(key, out var have)) return have;
        Vector3? spot = null;
        uint r = Air.Hash32("cateyes", ci, cj);
        for (int k = 0; k < 16 && spot == null; k++)
        {
            float x = (ci + Air.Mulberry(ref r)) * Cell, z = (cj + Air.Mulberry(ref r)) * Cell;
            float narrowRoll = Air.Mulberry(ref r), up = Air.Mulberry(ref r), upH = Air.Mulberry(ref r);
            if (!Air.OpenAt(x, z, 0.3f)) continue;
            // by a wall (a cat keeps to the foot of the wall) or in a narrow lane
            int wall = 0;
            if (Ways.Flags(x + 1.2f, z) == Ways.Wall) wall++;
            if (Ways.Flags(x - 1.2f, z) == Ways.Wall) wall++;
            if (Ways.Flags(x, z + 1.2f) == Ways.Wall) wall++;
            if (Ways.Flags(x, z - 1.2f) == Ways.Wall) wall++;
            if (wall == 0) continue;
            bool narrow = Narrow(x, z, 1, 0) || Narrow(x, z, 0, 1);
            if (!narrow && narrowRoll < 0.75f) continue;
            bool lamp = false;
            for (int i = 0; i < lights.LampCount && !lamp; i++)
            {
                var l = lights.LampAt(i);
                lamp = new Vector2(l.X - x, l.Z - z).Length() < 11;
            }
            if (lamp) continue;
            float y = lights.GroundAt(x, z);
            if (!float.IsFinite(y)) continue;
            // most on the ground, some up on a sill or a wall's coping
            spot = new Vector3(x, y + (up < 0.75f ? 0.24f : 0.9f + upH * 0.6f), z);
        }
        spots[key] = spot;
        if (spot != null) spotCount++;
        return spot;
    }

    private static bool Narrow(float x, float z, float dx, float dz)
    {
        bool a = false, b = false;
        for (float q = 0.5f; q <= 4; q += 0.5f)
        {
            a |= Ways.Flags(x + dx * q, z + dz * q) == Ways.Wall;
            b |= Ways.Flags(x - dx * q, z - dz * q) == Ways.Wall;
        }
        return a && b;
    }

    private Vector3 shownAt;

    private void Eyes(Daylight day, Lights lights, Vector3 eye, float night, float t, float dt)
    {
        bool dark = night > 0.75f && day.Weather != "storm" && day.Rain < 0.6f;
        int n = 0;
        if (dark)
        {
            int ci0 = (int)MathF.Floor((eye.X - 26) / Cell), ci1 = (int)MathF.Floor((eye.X + 26) / Cell);
            int cj0 = (int)MathF.Floor((eye.Z - 26) / Cell), cj1 = (int)MathF.Floor((eye.Z + 26) / Cell);
            for (int i = ci0; i <= ci1; i++)
                for (int j = cj0; j <= cj1; j++)
                {
                    long key = Key(i, j);
                    int slot = (int)MathF.Floor(t / Slot + Air.Dice("cateyephase", i, j));
                    if (Air.Dice("cateye", i, j, slot) > 0.5f) continue;
                    if (SpotOf(i, j, lights) is not { } at) continue;
                    if (Math.Abs(at.Y - (eye.Y - 1.6f)) > 3) continue;
                    // gone: slunk off when he came within 5 m; back in the next stretch
                    if (spooked.TryGetValue(key, out int s) && s == slot) continue;
                    float d = new Vector2(at.X - eye.X, at.Z - eye.Z).Length();
                    if (d < 5) { spooked[key] = slot; continue; }
                    if (d < 7 || d > 26 || n >= found.Length) continue;
                    found[n++] = (key, at, Air.Dice("cateyeseed", i, j), d);
                }
        }
        Array.Sort(found, 0, n, FoundOrder.Instance);
        shown = 0;
        for (int i = 0; i < Pairs; i++)
        {
            if (i >= n) { eyes.Hide(i * 2); eyes.Hide(i * 2 + 1); shownKeys[i] = long.MinValue; continue; }
            var c = found[i];
            shownKeys[i] = c.key;
            float o = Math.Min(1, fade.GetValueOrDefault(c.key) + dt * 1.5f);
            fade[c.key] = o;
            // a blink now and then (by the clock)
            float v = (t + c.seed * 7) % 5 < 0.15f ? 0 : o;
            // two eyes 7 cm apart, square to the line to him
            var side = new Vector3(eye.Z - c.at.Z, 0, -(eye.X - c.at.X)).Normalized() * 0.035f;
            eyes.Set(i * 2, c.at + side, 0.02f, v);
            eyes.Set(i * 2 + 1, c.at - side, 0.02f, v);
            if (shown++ == 0) shownAt = c.at;
        }
        eyes.Commit();
        // (the fade of a cat no longer shown starts again from nothing)
        int g = 0;
        foreach (var k in fade.Keys)
        {
            if (Array.IndexOf(shownKeys, k) >= 0 || g >= gone.Length) continue;
            gone[g++] = k;
        }
        for (int i = 0; i < g; i++) fade.Remove(gone[i]);
    }
}
