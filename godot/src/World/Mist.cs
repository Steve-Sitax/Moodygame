using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// Mist on the water (the browser's world/alive/water.ts createMist): flat, long wisps lying over the river, the docks
/// and the canals, at dawn most, a little at dusk, all day on a fog day; none in rain or wind. In each 16 m cell of
/// water three may rise, each in its own round of 25 to 50 s, where the round's dice put it, drifting with the wind;
/// the 70 nearest are drawn (one MultiMesh). Paler than the air by day, a dim grey-blue by night.
/// </summary>
[GamePart(39)]
public partial class Mist : Node
{
    private const int Wisps = 70;
    private const float Cell = 16;
    private MultiMesh mm = null!;
    private ShaderMaterial mat = null!;
    private float amt;
    private readonly float[] buf = new float[Wisps * 16];
    private readonly Dictionary<long, bool> water = new();
    private readonly List<(float x, float y, float z, float life, float size, float d)> found = new();

    /// <summary>Counts for a check: how much mist (0..1) and how many wisps are out.</summary>
    public (float amount, int live) Info { get; private set; }

    private const string Code = @"
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform float amt = 0.0;
uniform float night = 0.0;
varying float a_k;
varying float seed;
varying float fog_depth;
float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
void vertex() {
	// a disc facing the eye, INSTANCE_CUSTOM: x its life (0..1, -1 none), y its size (m)
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	fog_depth = -c.z;
	float life = INSTANCE_CUSTOM.x;
	// (faded out close by: a wisp you are in is the air itself)
	a_k = life < 0.0 ? 0.0 : amt * sin(3.14159 * life) * smoothstep(3.0, 9.0, -c.z);
	vec3 w = MODEL_MATRIX[3].xyz;
	seed = w.x * 0.37 + w.z * 0.11;
	POSITION = PROJECTION_MATRIX * vec4(c + vec3(VERTEX.xy * INSTANCE_CUSTOM.y, 0.0), 1.0);
	if (a_k < 0.004 || -c.z < 1.0) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
}
void fragment() {
	vec2 c = UV - 0.5;
	// flat and long: mist lies along the water
	c.y *= 2.2;
	float d = dot(c, c) * 4.0;
	if (d > 1.0) discard;
	float mottle = 0.6 + 0.4 * hash12(floor(UV * 6.0) + seed);
	float a = a_k * (1.0 - d) * (1.0 - d) * mottle * 0.34;
	if (a < 0.004) discard;
	float fog_k = smoothstep(psx_fog_near, psx_fog_far * 1.2, fog_depth);
	// paler than the air by day, a dim grey-blue by night
	vec3 tint = mix(psx_fog_color.rgb, vec3(0.85, 0.87, 0.9), 0.35 * (1.0 - night));
	ALBEDO = mix(tint, psx_fog_color.rgb, fog_k * 0.7);
	ALPHA = a;
}
";

    public override void _Ready()
    {
        ProcessPriority = 50;
        mat = new ShaderMaterial { Shader = new Shader { Code = Code }, RenderPriority = 2 };
        mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = new QuadMesh { Size = Vector2.One, Material = mat }, InstanceCount = Wisps, VisibleInstanceCount = 0 };
        mm.CustomAabb = new Aabb(new Vector3(-2000, -50, -2000), new Vector3(4000, 200, 4000));
        Main.I.View.AddChild(new MultiMeshInstance3D { Name = "river_mist", Multimesh = mm, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Layers = Mirrors.NoMirror });
        Main.I.World.Unported.Remove("alive_river_mist");
    }

    /// <summary>share.ts hash32 / dice: 0..1 from a key and numbers, the same on every PC.</summary>
    private static float Dice(string key, params float[] n)
    {
        uint h = 0x811c9dc5;
        foreach (char ch in key) h = (h ^ ch) * 0x01000193;
        foreach (var v in n)
        {
            h = (h ^ (uint)(int)v) * 0x01000193;
            h = (h ^ (uint)(int)(v * 4096)) * 0x85ebca6b;
        }
        h = (h ^ (h >> 15)) * 0x2c1b3c6d;
        h = (h ^ (h >> 12)) * 0x297a2d39;
        return (h ^ (h >> 15)) / 4294967296f;
    }

    /// <summary>common.ts hours: 1 inside a..b (round midnight too), easing in and out over e hours.</summary>
    private static float Hours(float h, float a, float b, float e)
    {
        bool inside = a <= b ? h >= a && h <= b : h >= a || h <= b;
        if (!inside) return 0;
        float da = (h - a + 24) % 24, db = (b - h + 24) % 24;
        return Math.Clamp(Math.Min(da, db) / e, 0, 1);
    }

    private bool IsWater(float x, float z)
    {
        long key = ((long)MathF.Round(x) << 32) ^ (uint)(int)MathF.Round(z);
        if (!water.TryGetValue(key, out var v))
        {
            v = Water.In(x, z);
            if (water.Count > 20000) water.Clear();
            water[key] = v;
        }
        return v;
    }

    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Mist");
        var day = Daylight.I;
        var cam = Main.I.View.GetCamera3D();
        if (day == null || cam == null) return;
        float dt = (float)delta;
        // dawn is the time for it, dusk a little; a fog day all day; not in rain or wind
        float h = day.Hour;
        string w = day.Weather;
        float when = Math.Max(Math.Max(Hours(h, 4.3f, 9.8f, 1.8f), 0.55f * Hours(h, 17.2f, 23, 1.5f)), w == "fog" ? 0.6f : 0);
        float byWeather = w is "rain" or "storm" ? 0 : w == "clear" ? 0.9f : 1;
        float wind = day.Wind.Length();
        float target = when * byWeather * Math.Clamp(1.4f - wind * 0.6f, 0, 1) * (1 - Math.Min(1, day.Rain * 3));
        amt += (target - amt) * Math.Min(1, dt <= 0 ? 1 : dt * 0.2f);
        Scheldemist.Render.UniformUpdates.Material(mat, "amt", amt);
        Scheldemist.Render.UniformUpdates.Material(mat, "night", day.Night);
        if (amt <= 0.01f)
        {
            if (mm.VisibleInstanceCount != 0) mm.VisibleInstanceCount = 0;
            Info = (amt, 0);
            return;
        }
        // the wisps of the water round the eye, the nearest first
        var eye = cam.GlobalPosition;
        float S = Time.GetTicksMsec() / 1000f;
        found.Clear();
        for (int i = (int)MathF.Floor((eye.X - 76) / Cell); i <= (int)MathF.Floor((eye.X + 76) / Cell); i++)
            for (int j = (int)MathF.Floor((eye.Z - 76) / Cell); j <= (int)MathF.Floor((eye.Z + 76) / Cell); j++)
            {
                if (!IsWater((i + 0.5f) * Cell, (j + 0.5f) * Cell) && !IsWater(i * Cell + 2, j * Cell + 2) && !IsWater((i + 1) * Cell - 2, (j + 1) * Cell - 2)) continue;
                for (int k = 0; k < 3; k++)
                {
                    float P = 25 + Dice("mistP", i, j, k) * 25;
                    float u = S / P + Dice("mistph", i, j, k);
                    float c = MathF.Floor(u);
                    float life = u - c;
                    if (Dice("mistok", i, j, k, c) > 0.8f) continue;
                    float x0 = (i + Dice("mistx", i, j, k, c)) * Cell, z0 = (j + Dice("mistz", i, j, k, c)) * Cell;
                    if (!IsWater(x0, z0)) continue;
                    float y = Tide.LevelAt(x0, z0);
                    if (!float.IsFinite(y)) continue;
                    float age = life * P;
                    float x = x0 + day.Wind.X * 0.35f * age, z = z0 + day.Wind.Y * 0.35f * age;
                    float d = MathF.Sqrt((x - eye.X) * (x - eye.X) + (z - eye.Z) * (z - eye.Z));
                    if (d < 6 || d > 76) continue;
                    found.Add((x, y + 0.25f + Dice("misty", i, j, k, c) * 0.9f, z, life, 3 + Dice("mists", i, j, k, c) * 5, d));
                }
            }
        found.Sort((a, b) => a.d.CompareTo(b.d));
        int n = Math.Min(Wisps, found.Count);
        for (int q = 0; q < n; q++)
        {
            var f = found[q];
            int o = q * 16;
            buf[o] = 1; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = f.x;
            buf[o + 4] = 0; buf[o + 5] = 1; buf[o + 6] = 0; buf[o + 7] = f.y;
            buf[o + 8] = 0; buf[o + 9] = 0; buf[o + 10] = 1; buf[o + 11] = f.z;
            buf[o + 12] = f.life; buf[o + 13] = f.size; buf[o + 14] = 0; buf[o + 15] = 0;
        }
        mm.Buffer = buf;
        mm.VisibleInstanceCount = n;
        Info = (amt, n);
    }
}
