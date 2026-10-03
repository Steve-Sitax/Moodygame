using System;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The light by the clock and the weather (the browser's world/rijnkaai.ts: DAYLIGHT, sunAt, applyDaylight and the
/// light part of update; world/ambient.ts: the rain, the wet ground, the puddles, the night). The same numbers: the
/// fog's colour, near and far, the sky's two colours, the sun's way over Antwerp in October, its colour and strength.
/// Everything eases as in the browser; Settle() jumps there (a run with --hour or --weather).
/// Options: --hour 21, --weather fog|mist|clear|rain|storm, --puddle 0.25 (the puddles' level, for a comparison).
/// </summary>
[GamePart(10)]
public partial class Daylight : Node
{
    public static Daylight I { get; private set; } = null!;

    /// <summary>Hour, fog colour, sky light, fog far, gas lamps lit 0-1 (rijnkaai.ts DAYLIGHT).</summary>
    private static readonly (float h, int col, float sky, float far, float lamps)[] Table =
    {
        (0, 0x171b21, 0.38f, 19, 1),
        (5.5f, 0x1a1e25, 0.42f, 19, 1),
        (7, 0x343a42, 1.0f, 22, 0.7f),
        (9, 0x51585a, 1.8f, 28, 0),
        (15, 0x51585a, 1.8f, 28, 0),
        (17, 0x4b4540, 1.3f, 25, 0.4f),
        (18.5f, 0x2c2e34, 0.65f, 21, 1),
        (21, 0x1a1e25, 0.42f, 19, 1),
        (24, 0x171b21, 0.38f, 19, 1),
    };

    /// <summary>Fog near x, fog far x, lamp glow in the air, clear sky (rijnkaai.ts WEATHER).</summary>
    private static float[] WeatherOf(string w) => w switch
    {
        "mist" => new[] { 2.5f, 3.5f, 0.6f, 0.25f },
        "clear" => new[] { 12f, 7f, 0.35f, 0.6f },
        "rain" => new[] { 1.8f, 2.5f, 0.8f, 0f },
        "storm" => new[] { 1.3f, 1.6f, 0.9f, 0f },
        _ => new[] { 1f, 1f, 1f, 0f },
    };

    private static readonly Color ClearSky = Psx.Hex(0x8b9398), GoldAir = Psx.Hex(0xdca868), SunWhite = Psx.Hex(0xfff0d8), SunGold = Psx.Hex(0xffa24a);
    private static readonly Color SkyCold = Psx.Hex(0x8494a6), SkyWarm = Psx.Hex(0xb49a7c), Ground = Psx.Hex(0x2a2822);
    /// <summary>The lamps' glow in the air on a fog day (psx.ts uScatter at the start).</summary>
    private const float Scatter = 0.55f;
    private static readonly float SunDecl = Mathf.DegToRad(-6), SunLat = Mathf.DegToRad(51.22f);
    /// <summary>North against the world's axes (shared/city.json frame.thetaDeg: 0 on the designed map).</summary>
    private const float FrameTh = 0;

    private static readonly (float h, float v)[] NightByHour = { (0, 1), (6.2f, 1), (8.2f, 0), (16.2f, 0), (18.3f, 1), (24, 1) };

    // --- what the other parts read
    /// <summary>The clock now, eased (0-24).</summary>
    public float Hour { get; private set; } = 13;
    public string Weather { get; private set; } = "clear";
    /// <summary>The air's colour (linear): the fog and the sky's ground tone.</summary>
    public Color FogColor { get; private set; }
    public float FogNear { get; private set; } = 3;
    public float FogFar { get; private set; } = 25;
    /// <summary>The gas lamps by the clock, 0-1.</summary>
    public float LampsLit { get; private set; }
    /// <summary>How thick the air is for a lamp's glow by day (fog 1, clear 0): rijnkaai.ts `air`.</summary>
    public float Air => Mathf.Clamp((wNow[2] - 0.2f) / 0.8f, 0, 1);
    /// <summary>The clear sky's weight, eased (0 fog .. 0.6 clear).</summary>
    public float Clear => wNow[3];
    /// <summary>The way to the sun (world).</summary>
    public Vector3 SunDir { get; private set; } = Vector3.Up;
    /// <summary>Dark outside 0-1 (ambient.ts NIGHT_BY_HOUR; a dark day lights up earlier): lit windows follow it.</summary>
    public float Night { get; private set; }
    /// <summary>Rain falling now 0-1, the ground's wet 0-1, the puddles' level 0-1 (ambient.ts).</summary>
    public float Rain { get; private set; }
    public float Wet { get; private set; }
    public float Puddle { get; private set; }
    /// <summary>The wind (x, z) in m/s-ish (ambient.ts WIND): rain slants with it.</summary>
    public Vector2 Wind { get; private set; }
    /// <summary>The sun's light as three.js has it (colour, intensity), for a part that wants the number.</summary>
    public float SunIntensity { get; private set; }
    public float SkyIntensity { get; private set; }

    private float dayTarget = 13, skyBase = 1, sunDay, dayFar = 25, fogMix, fogTarget;
    private Color baseFog;
    private float[] wTarget = WeatherOf("clear");
    private readonly float[] wNow = { 1, 1, 1, 0 };
    private float manualRain, pudBase = 0.34f, pudFixed = -1, sea = 1;
    private DirectionalLight3D sun = null!;
    private Godot.Environment env = null!;

    public override void _Ready()
    {
        I = this;
        var main = Main.I;
        env = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Color,
            AmbientLightSource = Godot.Environment.AmbientSource.Disabled,
            TonemapMode = Godot.Environment.ToneMapper.Linear,
        };
        main.View.AddChild(new WorldEnvironment { Environment = env, Name = "air" });
        // the one sun: always there, dark at night (light counts never change: docs/rendering.md)
        sun = new DirectionalLight3D { Name = "sun", ShadowEnabled = false, LightEnergy = 0 };
        main.View.AddChild(sun);

        string h = main.Arg("hour"), w = main.Arg("weather");
        if (h != "" && float.TryParse(h, System.Globalization.CultureInfo.InvariantCulture, out float hour)) SetTime(hour);
        SetWeather(w != "" ? w : "clear");
        string p = main.Arg("puddle");
        if (p != "" && float.TryParse(p, System.Globalization.CultureInfo.InvariantCulture, out float pud)) pudFixed = pud;
        Settle();
    }

    /// <summary>The clock (0-24, fractions): the light eases there, the short way round midnight.</summary>
    public void SetTime(float hour) => dayTarget = ((hour % 24) + 24) % 24;

    public void SetWeather(string w)
    {
        Weather = w is "fog" or "mist" or "clear" or "rain" or "storm" ? w : "fog";
        wTarget = WeatherOf(Weather);
    }

    /// <summary>The job twist "thick fog": it closes in whatever the weather (rijnkaai.ts setThickFog).</summary>
    public void SetThickFog(bool on) => fogTarget = on ? 1 : 0;

    /// <summary>Rain on top of the weather 0-1 (a job twist, or dev).</summary>
    public void SetRain(float amount) => manualRain = Mathf.Clamp(amount, 0, 1);

    /// <summary>After Settle(): a part that eases on its own (the sky's deck, the lamps) jumps too.</summary>
    public event Action? Settled;

    /// <summary>Everything at its target now: no easing (the first frame, a test picture).</summary>
    public void Settle()
    {
        Hour = dayTarget;
        fogMix = fogTarget;
        for (int i = 0; i < 4; i++) wNow[i] = wTarget[i];
        Rain = Math.Max(manualRain, AutoRain());
        Wet = WetTarget();
        pudBase = PudTarget();
        sea = SeaTarget();
        Step(0);
        Settled?.Invoke();
        var f = FogColor.LinearToSrgb();
        GD.Print($"daylight: {Hour:0.##} h, {Weather}: fog #{f.ToHtml(false)} {FogNear:0.#}-{FogFar:0.#} m, sky {SkyIntensity:0.###}, sun {SunIntensity:0.###} from ({SunDir.X:0.###}, {SunDir.Y:0.###}, {SunDir.Z:0.###}), lamps {LampsLit:0.##}, night {Night:0.##}, rain {Rain:0.##}, wet {Wet:0.##}, puddles {Puddle:0.##}");
    }

    public override void _Process(double delta) => Step((float)delta);

    private static float Smooth(float x, float a, float b)
    {
        // three's MathUtils.smoothstep(x, min, max)
        if (x <= a) return 0;
        if (x >= b) return 1;
        x = (x - a) / (b - a);
        return x * x * (3 - 2 * x);
    }

    private static float Bump(float h, float a, float p0, float p1, float b) =>
        h <= a || h >= b ? 0 : h < p0 ? Smooth(h, a, p0) : h <= p1 ? 1 : 1 - Smooth(h, p1, b);

    /// <summary>The golden hour of a clear day, 0-1 by the hour (rijnkaai.ts goldenAt).</summary>
    public static float GoldenAt(float h) => Math.Max(Bump(h, 15.1f, 16.4f, 17.3f, 18.3f), 0.45f * Bump(h, 6.9f, 7.6f, 8.0f, 9.0f));

    /// <summary>The way to the sun at an hour: up in the south-east, about 33 degrees at noon, down in the west (sunAt).</summary>
    public static Vector3 SunAt(float h)
    {
        float ha = Mathf.DegToRad((h - 11.8f) * 15);
        float sinEl = MathF.Sin(SunLat) * MathF.Sin(SunDecl) + MathF.Cos(SunLat) * MathF.Cos(SunDecl) * MathF.Cos(ha);
        float el = Math.Max(Mathf.DegToRad(6), MathF.Asin(sinEl));
        float az = MathF.Atan2(MathF.Sin(ha), MathF.Cos(ha) * MathF.Sin(SunLat) - MathF.Tan(SunDecl) * MathF.Cos(SunLat)) + MathF.PI;
        float e = MathF.Cos(el) * MathF.Sin(az), n = MathF.Cos(el) * MathF.Cos(az);
        float s = MathF.Sin(FrameTh), c = MathF.Cos(FrameTh);
        return new Vector3(e * s + n * c, MathF.Sin(el), e * c - n * s);
    }

    private static float Curve((float h, float v)[] t, float h)
    {
        int i = 0;
        while (i < t.Length - 2 && h >= t[i + 1].h) i++;
        return t[i].v + (t[i + 1].v - t[i].v) * Mathf.Clamp((h - t[i].h) / (t[i + 1].h - t[i].h), 0, 1);
    }

    private void ApplyDaylight(float h)
    {
        int i = 0;
        while (i < Table.Length - 2 && h >= Table[i + 1].h) i++;
        var a = Table[i];
        var b = Table[i + 1];
        float k = Smooth(h, a.h, b.h);
        baseFog = Psx.Hex(a.col).Lerp(Psx.Hex(b.col), k);
        skyBase = Mathf.Lerp(a.sky, b.sky, k);
        sunDay = Math.Max(0, (skyBase - 0.55f) / 1.55f);
        dayFar = Mathf.Lerp(a.far, b.far, k);
        LampsLit = Mathf.Lerp(a.lamps, b.lamps, k);
    }

    private float AutoRain()
    {
        if (Weather == "storm") return 0.65f + 0.35f * (0.5f + 0.5f * MathF.Sin(Hour * 2.3f) * MathF.Sin(Hour * 0.9f + 1.0f));
        if (Weather == "rain") return 0.2f + 0.8f * Smooth(0.5f + 0.5f * MathF.Sin(Hour * 1.7f) * MathF.Sin(Hour * 0.63f + 2.0f), 0.3f, 0.75f);
        return 0;
    }
    private float WetTarget() => Rain > 0.05f ? Math.Min(1, 0.35f + Rain) : Weather is "rain" or "storm" ? 0.45f : 0;
    private float PudTarget()
    {
        bool sunny = Weather == "clear" && Hour > 8 && Hour < 18;
        return Rain > 0.05f ? 0.7f : Weather is "rain" or "storm" ? 0.5f : Weather == "fog" ? 0.34f : Weather == "mist" ? 0.26f : sunny ? 0.1f : 0.12f;
    }
    private float SeaTarget() => Weather == "storm" ? 3.6f : Weather == "rain" ? 1.5f : Weather == "clear" ? 1.1f : 0.85f;

    private void Step(float dt)
    {
        // ease along the clock, the short way round midnight
        float dh = dayTarget - Hour;
        if (dh > 12) dh -= 24;
        if (dh < -12) dh += 24;
        if (MathF.Abs(dh) > 0.001f) Hour = (Hour + dh * Math.Min(1, dt * 0.8f) + 24) % 24;
        ApplyDaylight(Hour);
        fogMix += (fogTarget - fogMix) * Math.Min(1, dt * 0.4f);
        for (int i = 0; i < 4; i++) wNow[i] += (wTarget[i] - wNow[i]) * Math.Min(1, dt * 0.5f);

        // a clear day: the air lighter (by day only); the golden hour: warm air, a low warm sun from the west
        var fog = baseFog.Lerp(ClearSky, wNow[3] * sunDay * 0.6f);
        float gold = GoldenAt(Hour) * wNow[3];
        fog = fog.Lerp(GoldAir, gold * 0.3f);
        var sunCol = SunWhite.Lerp(SunGold, gold);
        var skyCol = SkyCold.Lerp(SkyWarm, gold * 0.55f);
        SunDir = SunAt(Hour).Normalized();
        // a clear or misty day: less light from the sky, more from the sun; a fog day keeps its even grey light
        float bright = Mathf.Clamp(wNow[3] / 0.6f, 0, 1);
        SkyIntensity = skyBase * (1 - 0.28f * sunDay * bright);
        SunIntensity = sunDay * (1.35f - wNow[2]) * 2.6f * (1 + 0.8f * gold) * (1 + 0.25f * bright);
        FogNear = Mathf.Lerp(3 * wNow[0], 1.5f, fogMix);
        FogFar = Mathf.Lerp(dayFar * wNow[1], 11, fogMix);
        FogColor = fog;

        // the rain, the wet ground and the puddles (ambient.ts)
        float target = Math.Max(manualRain, AutoRain());
        Rain += (target - Rain) * Math.Min(1, dt * 0.3f);
        if (Rain < 0.002f && target == 0) Rain = 0;
        float wt = WetTarget();
        Wet += wt > Wet ? (wt - Wet) * Math.Min(1, dt * 0.12f) : Math.Max(wt - Wet, -dt * 0.01f);
        float pt = PudTarget();
        pudBase += pt > pudBase ? (pt - pudBase) * Math.Min(1, dt * 0.08f) : Math.Max(pt - pudBase, -dt * 0.004f);
        Puddle = pudFixed >= 0 ? pudFixed : Math.Max(pudBase, Wet * 0.75f);
        sea += (SeaTarget() - sea) * Math.Min(1, dt * 0.05f);
        float dim = Weather is "fog" or "rain" or "storm" ? 0.4f : 0;
        Night = Math.Max(Curve(NightByHour, Math.Min(24, Hour + dim)), Curve(NightByHour, Math.Max(0, Hour - dim)));
        float ts = Time.GetTicksMsec() / 1000f;
        float wa = 0.35f + MathF.Sin(ts * 0.013f) * 0.25f;
        float ws = (Weather switch { "fog" => 0.35f, "mist" => 0.6f, "clear" => 0.9f, "rain" => 1.5f, "storm" => 3.2f, _ => 0.5f }) * (1 + 0.2f * MathF.Sin(ts * 0.07f));
        Wind = new Vector2(MathF.Cos(wa) * ws, MathF.Sin(wa) * ws);

        // to the picture. three's lights give colour x intensity / pi on a matt face; Godot's give colour x energy
        env.BackgroundColor = fog.LinearToSrgb(); // (the environment takes a screen colour)
        sun.LightColor = sunCol;
        sun.LightEnergy = SunIntensity / MathF.PI;
        var up = MathF.Abs(SunDir.Y) > 0.99f ? Vector3.Forward : Vector3.Up;
        sun.LookAtFromPosition(SunDir * 100, Vector3.Zero, up);
        Action<string, Variant> rs = Psx.Set;
        rs("psx_fog_color", fog);
        rs("psx_fog_near", FogNear);
        rs("psx_fog_far", FogFar);
        rs("psx_hemi_sky", skyCol * (SkyIntensity / MathF.PI));
        rs("psx_hemi_ground", Ground * (SkyIntensity / MathF.PI));
        rs("psx_sun_dir", SunDir);
        // the houses' shadows: hard in a clear day's sun, soft in the glow through fog
        rs("psx_sun_shade", 0.3f + 0.7f * bright);
        rs("psx_scatter", Scatter * wNow[2]);
        rs("psx_wet", Wet);
        rs("psx_rain", Rain);
        rs("psx_puddle", Puddle);
        rs("psx_sea", sea);
    }
}
