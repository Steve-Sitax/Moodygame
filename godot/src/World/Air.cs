using System;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// What the small life in the air shares (the browser's world/alive/common.ts and wind.ts): the town's dice, the
/// hours, the gusts, and one kind of point for the puffs, the specks and the drops (AirPoints).
/// </summary>
public static class Air
{
    /// <summary>share.ts hash32 / dice, without a list: 0..1 from a key and up to four numbers, the same on every PC.</summary>
    public static float Dice(string key, float a, float b = float.NaN, float c = float.NaN, float d = float.NaN) => Hash32(key, a, b, c, d) / 4294967296f;

    public static uint Hash32(string key, float a, float b = float.NaN, float c = float.NaN, float d = float.NaN)
    {
        uint h = 0x811c9dc5;
        foreach (char ch in key) h = (h ^ ch) * 0x01000193;
        h = Mix(h, a);
        if (!float.IsNaN(b)) h = Mix(h, b);
        if (!float.IsNaN(c)) h = Mix(h, c);
        if (!float.IsNaN(d)) h = Mix(h, d);
        h = (h ^ (h >> 15)) * 0x2c1b3c6d;
        h = (h ^ (h >> 12)) * 0x297a2d39;
        return h ^ (h >> 15);
    }

    private static uint Mix(uint h, float v)
    {
        h = (h ^ (uint)(int)v) * 0x01000193;
        return (h ^ (uint)(int)(v * 4096)) * 0x85ebca6b;
    }

    /// <summary>share.ts seeded: mulberry32, a row of dice from a seed (state kept by the caller).</summary>
    public static float Mulberry(ref uint a)
    {
        a += 0x6d2b79f5;
        uint t = a;
        t = (t ^ (t >> 15)) * (t | 1);
        t ^= t + (t ^ (t >> 7)) * (t | 61);
        return (t ^ (t >> 14)) / 4294967296f;
    }

    /// <summary>common.ts hours: 1 inside a..b (round midnight too), easing in and out over e hours.</summary>
    public static float Hours(float h, float a, float b, float e = 0.5f)
    {
        bool inside = a <= b ? h >= a && h <= b : h >= a || h <= b;
        if (!inside) return 0;
        float da = (h - a + 24) % 24, db = (b - h + 24) % 24;
        return Math.Clamp(Math.Min(da, db) / e, 0, 1);
    }

    /// <summary>common.ts openAt: open street ground with room round it (r metres each way).</summary>
    public static bool OpenAt(float x, float z, float r = 0.6f) =>
        Ways.Flags(x, z) == 0 && Ways.Flags(x + r, z) == 0 && Ways.Flags(x - r, z) == 0 && Ways.Flags(x, z + r) == 0 && Ways.Flags(x, z - r) == 0;

    /// <summary>alive/index.ts frame.cold: the night and the early morning, more under a clear sky and in the fog.</summary>
    public static float Cold(float hour, string weather)
    {
        float early = Math.Max(Hours(hour, 20, 9.5f, 2), 0);
        return Math.Clamp(early * (weather == "clear" ? 1 : weather is "fog" or "mist" ? 0.9f : 0.6f), 0, 1);
    }

    /// <summary>The great storm's level on a storm day (wind.ts fury), else 0.</summary>
    public static float Fury => Daylight.I is { Weather: "storm" } d ? d.Storm : 0;

    /// <summary>The steady wind now (wind.ts base: the daylight's wind, harder in the great storm).</summary>
    public static Vector2 Base => (Daylight.I?.Wind ?? new Vector2(0.9f, 0.35f)) * (1 + 0.9f * Fury);

    /// <summary>The wind at a place: the base wind with the gust on it (wind.ts at).</summary>
    public static Vector2 WindAt(float x, float z) => Base * (1 + Gusts.At(x, z));

    // ------------------------------------------------------------------ the gusts (world/alive/wind.ts)

    /// <summary>
    /// The town's gusts (wind.ts): fronts that sweep across the town along the wind, the same on every PC by the
    /// dice (one each W seconds, its moment, length and strength drawn for its slot). Up to six about now.
    /// </summary>
    public static class Gusts
    {
        private struct Gust { public float T0, Len, K, Speed; }
        private static readonly Gust[] town = new Gust[8];
        private static int count;
        private static float t;
        private static Vector2 dir = new(1, 0);
        private static ulong frame = ulong.MaxValue;

        private static (float a, float b) Gap(string w) => w switch { "fog" => (70, 160), "mist" => (30, 70), "clear" => (14, 40), "rain" => (8, 22), "storm" => (3, 9), _ => (20, 50) };
        private static (float a, float b) Strength(string w) => w switch { "fog" => (0.6f, 1.2f), "mist" => (1, 2), "clear" => (1.5f, 3), "rain" => (1.5f, 2.8f), "storm" => (0.8f, 1.6f), _ => (1, 2) };
        private static float BaseOf(string w) => w switch { "fog" => 0.35f, "mist" => 0.6f, "clear" => 0.9f, "rain" => 1.5f, "storm" => 3.2f, _ => 0.5f };

        /// <summary>The unit way the wind blows to.</summary>
        public static Vector2 Dir { get { Update(); return dir; } }

        /// <summary>Worked out once a frame, at the first ask.</summary>
        private static void Update()
        {
            ulong f = Engine.GetProcessFrames();
            if (f == frame) return;
            frame = f;
            var day = Daylight.I;
            string w = day?.Weather ?? "fog";
            t = (Time.GetTicksMsec() / 1000f) % 1e6f;
            var wv = day?.Wind ?? new Vector2(1, 0);
            dir = wv.LengthSquared() > 1e-6f ? wv.Normalized() : new Vector2(1, 0);
            var (g0, g1) = Gap(w);
            float W = (g0 + g1) / 2;
            var (k0, k1) = Strength(w);
            float speed = 8 + BaseOf(w) * 3, fury = Fury;
            string key = w switch { "fog" => "gust:fog", "mist" => "gust:mist", "clear" => "gust:clear", "rain" => "gust:rain", "storm" => "gust:storm", _ => "gust:" };
            int w0 = (int)MathF.Floor((t - 60) / W), w1 = w0 + (int)MathF.Ceiling(120 / W) + 1;
            count = 0;
            for (int i = w0; i <= w1 && count < town.Length; i++)
            {
                float len = 2 + Dice(key, i, 1) * 4;
                town[count++] = new Gust { T0 = i * W + Dice(key, i, 2) * Math.Max(1, W - len), Len = len, K = (k0 + (k1 - k0) * Dice(key, i, 3)) * (1 + 2 * fury), Speed = speed };
            }
        }

        /// <summary>The gust at a place now, 0.. (times the base wind).</summary>
        public static float At(float x, float z)
        {
            Update();
            float g = 0, along = x * dir.X + z * dir.Y;
            for (int i = 0; i < count; i++)
            {
                var q = town[i];
                float local = t - q.T0 - along / q.Speed;
                if (local < -0.5f || local > q.Len + 1) continue;
                float env = Math.Clamp((local + 0.5f) / 0.8f, 0, 1) * Math.Clamp((q.Len + 1 - local) / 1.5f, 0, 1);
                g = Math.Max(g, q.K * env * (0.75f + 0.25f * MathF.Sin(local * 7 + x * 0.3f)));
            }
            return g;
        }

        /// <summary>
        /// The gust fronts about now, for the rain's veils (wind.ts fronts): up to four as (when its front passed the
        /// line through the origin, minus now; how long; how strong; how fast). Unused ones have strength 0.
        /// </summary>
        public static void Fronts(out Vector4 a, out Vector4 b, out Vector4 c, out Vector4 d)
        {
            Update();
            a = b = c = d = Vector4.Zero;
            int n = 0;
            for (int i = 0; i < count && n < 4; i++)
            {
                var q = town[i];
                if (t < q.T0 - 12 || t > q.T0 + q.Len + 12) continue;
                var v = new Vector4(q.T0 - t, q.Len, q.K, q.Speed);
                if (n == 0) a = v; else if (n == 1) b = v; else if (n == 2) c = v; else d = v;
                n++;
            }
        }

        /// <summary>The same sum in a shader (ambient.ts gustVeil), for a material with the four gust uniforms.</summary>
        public const string Glsl = @"
uniform vec4 gust0;
uniform vec4 gust1;
uniform vec4 gust2;
uniform vec4 gust3;
uniform vec2 gust_dir = vec2(1.0, 0.0);
float gust_one(vec4 q, float along) {
	if (q.z <= 0.0) return 0.0;
	float local = -q.x - along / q.w;
	float env = clamp((local + 0.5) / 0.8, 0.0, 1.0) * clamp((q.y + 1.0 - local) / 1.5, 0.0, 1.0);
	return q.z * env;
}
float gust_veil(vec2 xz) {
	float along = dot(xz, gust_dir);
	return max(max(gust_one(gust0, along), gust_one(gust1, along)), max(gust_one(gust2, along), gust_one(gust3, along)));
}
";

        /// <summary>Hands the fronts to a material with Glsl in it (once a frame).</summary>
        public static void Send(ShaderMaterial m)
        {
            Fronts(out var a, out var b, out var c, out var d);
            UniformUpdates.Material(m, "gust0", a);
            UniformUpdates.Material(m, "gust1", b);
            UniformUpdates.Material(m, "gust2", c);
            UniformUpdates.Material(m, "gust3", d);
            UniformUpdates.Material(m, "gust_dir", dir);
        }
    }
}

/// <summary>
/// Points in the air written by the CPU (the browser's THREE.Points of the alive parts): each a square facing the eye,
/// at a place, with a size, a strength, a seed and a brightness. Two shaders for all of them, made at load (one
/// mixes, one adds light); each part its own material with its own colour and look:
///   shape 0 a soft puff (breath, spray), 1 a hard speck (a moth, a drop, an eye), 2 a funnel's puff (boats.ts
///   puffTexture: a 16-pixel cloud, nearly solid to its middle).
/// One MultiMesh a part, one draw; nothing allocated after the start.
/// </summary>
public sealed class AirPoints
{
    private const string Code = @"
shader_type spatial;
render_mode unshaded, BLEND, depth_draw_never, cull_disabled, fog_disabled;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform vec3 col = vec3(1.0);
uniform float shape = 0.0;
// how much of the fog's colour it takes far off, how far it is seen (fog-fars), the lamps' glow on it
uniform float fog_mix = 1.0;
uniform float fog_fade = 0.5;
uniform float fog_reach = 1.0;
uniform float glow_k = 0.0;
// smallest size on the screen in pixels of the 720-line picture (a speck stays a pixel or two)
uniform float min_px = 0.0;
uniform float max_px = 400.0;
uniform float alpha_k = 1.0;
varying float alpha;
varying float seed;
varying float bright;
varying float fog_depth;
varying vec3 glow;
LAMPS
float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void vertex() {
	vec4 s4 = INSTANCE_CUSTOM;
	vec3 p = MODEL_MATRIX[3].xyz;
	vec4 mv = VIEW_MATRIX * vec4(p, 1.0);
	fog_depth = -mv.z;
	// pixels of the 720-line picture a metre spans at that depth (from the projection itself)
	vec4 c0 = PROJECTION_MATRIX * mv;
	vec4 c1 = PROJECTION_MATRIX * (mv + vec4(0.0, 1.0, 0.0, 0.0));
	float ppm = max(abs(c1.y / c1.w - c0.y / c0.w) * 360.0, 1e-4);
	float size = clamp(s4.x * ppm, min_px, max_px) / ppm;
	POSITION = PROJECTION_MATRIX * vec4(mv.xyz + vec3(VERTEX.xy * size, 0.0), 1.0);
	alpha = s4.y;
	seed = s4.z;
	bright = s4.w;
	glow = vec3(0.0);
	if (alpha < 0.003 || fog_depth < 0.1 || fog_depth > psx_fog_far * fog_reach * 1.1) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
	else if (glow_k > 0.0) {
		vec3 to_p = p - CAMERA_POSITION_WORLD;
		float len = length(to_p);
		vec3 rd = to_p / max(len, 1e-4);
		glow = psx_lamp_color.rgb * psx_glow(CAMERA_POSITION_WORLD, rd, glow_reach(1e4, psx_fog_far, rd)) * psx_scatter * glow_k;
	}
}
void fragment() {
	vec2 c = UV - 0.5;
	float d = dot(c, c) * 4.0;
	float a = alpha * alpha_k;
	float shade = 1.0;
	if (shape < 0.5) {
		if (d > 1.0) discard;
		// a blocky puff: 4 x 4 cells of uneven density
		float mottle = 0.6 + 0.4 * hash12(floor(UV * 4.0) + seed * 91.0);
		a *= (1.0 - d) * (1.0 - d) * mottle;
	} else if (shape > 1.5) {
		float r = sqrt(d);
		if (r > 1.0) discard;
		vec2 cell = floor(UV * 16.0) + seed * 37.0;
		a *= min(1.0, (1.0 - r) * 1.6) * (0.75 + 0.25 * hash12(cell));
		shade = 0.59 + 0.24 * hash12(cell + 11.0);
	}
	float f = smoothstep(psx_fog_near, psx_fog_far * fog_reach, fog_depth);
	a *= 1.0 - f * fog_fade;
	if (a < 0.004) discard;
	ALBEDO = mix(col * bright * shade, psx_fog_color.rgb, f * fog_mix) + glow * (0.35 + 0.65 * f);
	ALPHA = min(a, 1.0);
}
";

    private static Shader? mixShader, addShader;
    public readonly MultiMesh Mm;
    public readonly MultiMeshInstance3D Node;
    public readonly ShaderMaterial Mat;
    private readonly float[] buf;
    private bool dirty;
    public int Count { get; }

    /// <param name="add">Light added (eyes, sparks) rather than mixed.</param>
    public AirPoints(string name, int count, bool add = false, int priority = 2)
    {
        Count = count;
        var shader = add ? addShader ??= new Shader { Code = Code.Replace("BLEND", "blend_add").Replace("LAMPS", Psx.LampScatterGlsl) }
                         : mixShader ??= new Shader { Code = Code.Replace("BLEND", "blend_mix").Replace("LAMPS", Psx.LampScatterGlsl) };
        Mat = new ShaderMaterial { Shader = shader, RenderPriority = priority };
        Mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = new QuadMesh { Size = Vector2.One }, InstanceCount = count };
        buf = new float[count * 16];
        for (int i = 0; i < count; i++) { buf[i * 16] = 1; buf[i * 16 + 5] = 1; buf[i * 16 + 10] = 1; }
        Mm.CustomAabb = new Aabb(new Vector3(-3000, -100, -3000), new Vector3(6000, 600, 6000));
        Node = new MultiMeshInstance3D { Name = name, Multimesh = Mm, MaterialOverride = Mat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Layers = Mirrors.NoMirror };
        RenderingServer.MultimeshSetBuffer(Mm.GetRid(), buf);
        Main.I.View.AddChild(Node);
    }

    /// <summary>Point i: where, its size (m), how strong (0 hides it), its seed, its brightness.</summary>
    public void Set(int i, Vector3 at, float size, float alpha, float seed = 0, float bright = 1)
    {
        int o = i * 16;
        buf[o + 3] = at.X; buf[o + 7] = at.Y; buf[o + 11] = at.Z;
        buf[o + 12] = size; buf[o + 13] = alpha; buf[o + 14] = seed; buf[o + 15] = bright;
        dirty = true;
    }

    public void Hide(int i)
    {
        if (buf[i * 16 + 13] == 0) return;
        buf[i * 16 + 13] = 0;
        dirty = true;
    }

    /// <summary>Sends this frame's points (once a frame, only when something changed).</summary>
    public void Commit()
    {
        if (!dirty) return;
        dirty = false;
        RenderingServer.MultimeshSetBuffer(Mm.GetRid(), buf);
    }

    public void Param(string name, Variant v) => UniformUpdates.Material(Mat, name, v);

    /// <summary>
    /// air.ts mistMaterial: soft puffs of mist lit as the fog round them (breath, the storm's spray and splashes);
    /// `thick` its uAlpha. A puff is then set with Mist(i, at, age, size).
    /// </summary>
    public AirPoints AsMist(float thick)
    {
        Param("shape", 0.0f);
        Param("fog_mix", 1.0f);
        Param("fog_fade", 0.0f);
        Param("glow_k", 1.0f);
        Param("min_px", 2.0f);
        Param("max_px", 90.0f);
        Param("alpha_k", 0.2f * thick);
        return this;
    }

    /// <summary>A mist puff: its age 0..1 (below 0 hides it) and its size (aSize).</summary>
    public void Mist(int i, Vector3 at, float age, float size)
    {
        if (age < 0) { Hide(i); return; }
        float a = Mathf.SmoothStep(0, 0.12f, age) * (1 - age) * (0.7f + 0.3f * size);
        Set(i, at, (0.07f + age * 0.24f) * size, a, at.X * 3.1f + at.Z * 1.7f);
    }
}
