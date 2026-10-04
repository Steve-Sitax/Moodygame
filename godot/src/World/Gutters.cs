using System;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The broken gutters (the browser's world/alive/eaves.ts): a worn house with a cracked gutter end or no downpipe has,
/// by its own dice, one point on its eave where a thin stream of water falls to the street: a column of fast streaks
/// with a thin core in a real shower, wobbling in the wind, splashing at its foot; full in the rain, a trickle for a
/// while after. Under each a damp streak down the wall and a wet patch on the ground, darker when wet; the stains stay
/// in dry weather too. The bake holds the stains (alive_gutter_stains, two quads a stream): the streams are read back
/// from them. The water is lines (eaves.ts LINE_V: the sky's grey a little lighter, a gas lamp's glow near one), one
/// draw; the stains a multiply, one draw.
/// Not here yet: the lone drops off every street eave in the rain (eaves.ts findEaves needs the roofs' plan), and the
/// stream's top is read from the stain's top (the bake keeps no eave height: 0.1 m under it, as the browser's
/// stream at (-100, 231) has its top at 9.29 m, its stain at 9.4 m).
/// </summary>
[GamePart(45)]
public partial class Gutters : Node
{
    public static Gutters? I { get; private set; }

    /// <summary>Dev: the stream nearest a place: its foot on the ground and the way out of its wall.</summary>
    public (Vector3 foot, Vector3 outward)? Nearest(Vector3 p)
    {
        int best = -1;
        float bd = float.MaxValue;
        for (int i = 0; i < streams.Length; i++)
        {
            float d = new Vector2(streams[i].X - p.X, streams[i].Z - p.Z).LengthSquared();
            if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) return null;
        var s = streams[best];
        return (new Vector3(s.X, s.Ground, s.Z), new Vector3(s.Ox, 0, s.Oz));
    }

    private struct Stream { public float X, Z, Ux, Uz, Ox, Oz, Top, Ground, Seed; }
    private Stream[] streams = Array.Empty<Stream>();
    private const int NearStreams = 14, Streaks = 13, Core = 8, Splash = 8;
    private const int Segs = NearStreams * (Streaks * 3 + Core * 3 + Splash);
    private readonly int[] near = new int[NearStreams];
    private readonly (int i, float d)[] order = new (int, float)[256];
    private int nearCount;
    private Vector3 picked = new(1e9f, 0, 0);
    private MultiMesh lines = null!;
    private float[] buf = Array.Empty<float>();
    private int seg, lastSeg;
    private ShaderMaterial stainMat = null!, lineMat = null!;
    private MultiMeshInstance3D lineNode = null!;
    private float wetSince = 1e9f;

    /// <summary>For a check: the streams in town, the near ones running now, the line pieces drawn, how strong.</summary>
    public (int streams, int near, int segments, float flow) Info { get; private set; }

    private const string LineCode = @"
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
global uniform vec4 psx_lamp0;
global uniform vec4 psx_lamp1;
global uniform vec4 psx_lamp2;
global uniform vec4 psx_lamp3;
global uniform vec4 psx_lamp4;
global uniform vec4 psx_lamp5;
global uniform vec4 psx_lamp_color;
varying vec3 col;
varying float alpha;
varying float fog_depth;
vec3 lamp(vec3 p, vec4 l) {
	vec3 d = p - l.xyz;
	return psx_lamp_color.rgb * l.w * 1.2 / (1.0 + dot(d, d) * 0.35);
}
void vertex() {
	// each copy one piece of water from a (its origin) to b (origin + its z column); the custom data its two weights
	float aK = mix(INSTANCE_CUSTOM.x, INSTANCE_CUSTOM.y, VERTEX.z);
	vec3 p = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec4 mv = VIEW_MATRIX * vec4(p, 1.0);
	fog_depth = -mv.z;
	POSITION = PROJECTION_MATRIX * mv;
	// water catches the light round it: by day the grey sky, by a gas lamp its glow; in the dark, nothing
	vec3 c = psx_fog_color.rgb * 1.22 + 0.008 + lamp(p, psx_lamp0) + lamp(p, psx_lamp1) + lamp(p, psx_lamp2) + lamp(p, psx_lamp3) + lamp(p, psx_lamp4) + lamp(p, psx_lamp5);
	// (a negative weight: the water's shadow side; the whole part of |aK| brightens a stream's glassy thread)
	float k = abs(aK);
	float lift = floor(k);
	col = aK < 0.0 ? c * 0.22 : c * (1.0 + 0.6 * lift);
	bool stream = aK < 0.0 || lift > 0.5;
	alpha = fract(k) * smoothstep(0.4, 1.0, fog_depth) * (1.0 - (stream ? smoothstep(12.0, 24.0, fog_depth) : smoothstep(7.0, 18.0, fog_depth)));
	if (alpha < 0.003 || INSTANCE_CUSTOM.z < 0.5) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
}
void fragment() {
	float f = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	ALBEDO = mix(col, psx_fog_color.rgb, f);
	ALPHA = alpha * (1.0 - f);
}
";

    private const string StainCode = @"
shader_type spatial;
render_mode unshaded, blend_mul, depth_draw_never, cull_disabled, fog_disabled;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform float wet_k = 0.0;
varying float fog_depth;
float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() {
	vec4 v = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -v.z;
	// (three's polygon offset: pulled a little toward the eye, never fights the wall)
	v.xyz *= 0.998;
	POSITION = PROJECTION_MATRIX * v;
}
void fragment() {
	float kind = UV2.x, seed = UV2.y;
	float a;
	vec3 col;
	if (kind < 0.5) {
		// the damp streak down the wall: a wavering band, darkest under the leak and at the foot (splash-back, green)
		float y = UV.y;
		float x = UV.x - 0.5;
		float w = 0.2 + 0.14 * vnoise(vec2(seed * 17.0, y * 7.0)) + 0.18 * smoothstep(0.25, 0.0, y) + 0.08 * smoothstep(0.85, 1.0, y);
		float band = smoothstep(w, w * 0.35, abs(x + 0.06 * (vnoise(vec2(y * 3.0, seed * 9.0)) - 0.5)));
		float runs = 0.75 + 0.25 * vnoise(vec2(x * 22.0 + seed * 5.0, y * 1.5));
		a = band * runs * (0.75 + 0.2 * smoothstep(0.75, 1.0, y) + 0.3 * smoothstep(0.2, 0.0, y));
		a = min(1.0, a * (0.65 + 0.45 * wet_k));
		col = mix(vec3(0.36, 0.37, 0.34), vec3(0.33, 0.42, 0.26), smoothstep(0.3, 0.0, y));
	} else {
		// the wet patch on the ground: ragged, darkest in the middle
		vec2 c = (UV - 0.5) * 2.0;
		float r = length(c) + 0.35 * (vnoise(c * 2.5 + seed * 11.0) - 0.5);
		a = smoothstep(1.0, 0.3, r) * (0.2 + 0.7 * wet_k);
		col = vec3(0.4, 0.41, 0.43);
	}
	a *= 1.0 - smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	if (a < 0.004) discard;
	// (a multiply over what is there: it only ever darkens, as damp does)
	ALBEDO = mix(vec3(1.0), col, a);
}
";

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 60;
        var world = Main.I.World;
        var pos = world.Attribute("alive_gutter_stains", "POSITION");
        var uv = world.Attribute("alive_gutter_stains", "_AUV");
        var kind = world.Attribute("alive_gutter_stains", "_AKIND");
        var seed = world.Attribute("alive_gutter_stains", "_ASEED");
        int n = pos == null ? 0 : pos.Length / 3;
        if (pos == null || uv == null || kind == null || seed == null || n == 0 || n % 12 != 0)
        {
            GD.Print("gutters: no alive_gutter_stains in the bake: no broken gutters");
            SetProcess(false);
            return;
        }
        // --- the stains, as baked
        var P = new Vector3[n];
        var U = new Vector2[n];
        var U2 = new Vector2[n];
        for (int i = 0; i < n; i++)
        {
            P[i] = new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
            U[i] = new Vector2(uv[i * 2], uv[i * 2 + 1]);
            U2[i] = new Vector2(kind[i], seed[i]);
        }
        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = P;
        arrays[(int)Mesh.ArrayType.TexUV] = U;
        arrays[(int)Mesh.ArrayType.TexUV2] = U2;
        var am = new ArrayMesh();
        am.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
        stainMat = new ShaderMaterial { Shader = new Shader { Code = StainCode }, RenderPriority = 1 };
        am.SurfaceSetMaterial(0, stainMat);
        Main.I.View.AddChild(new MeshInstance3D { Name = "alive_gutter_stains_live", Mesh = am, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        // --- the streams, read back from their stains: the wall quad (6 corners) and the wet patch round the foot (6)
        streams = new Stream[n / 12];
        for (int s = 0; s < streams.Length; s++)
        {
            int o = s * 12;
            Vector3 w0 = P[o], w1 = P[o + 1], wTop = P[o + 2];
            Vector3 patch = (P[o + 6] + P[o + 7] + P[o + 8] + P[o + 11]) / 4;
            var along = new Vector2(w1.X - w0.X, w1.Z - w0.Z).Normalized();
            var wallMid = new Vector2((w0.X + w1.X) / 2, (w0.Z + w1.Z) / 2);
            var outw = new Vector2(patch.X - wallMid.X, patch.Z - wallMid.Y);
            // (out of the wall: square to it, toward the patch)
            var norm = new Vector2(-along.Y, along.X);
            if (norm.Dot(outw) < 0) norm = -norm;
            streams[s] = new Stream
            {
                X = patch.X + norm.X * 0.1f, Z = patch.Z + norm.Y * 0.1f, Ux = along.X, Uz = along.Y, Ox = norm.X, Oz = norm.Y,
                Top = wTop.Y - 0.1f, Ground = patch.Y - 0.012f, Seed = seed[o],
            };
        }
        // --- the water: line pieces, one copy each
        var line = new ArrayMesh();
        var la = new Godot.Collections.Array();
        la.Resize((int)Mesh.ArrayType.Max);
        la[(int)Mesh.ArrayType.Vertex] = new[] { Vector3.Zero, new Vector3(0, 0, 1) };
        line.AddSurfaceFromArrays(Mesh.PrimitiveType.Lines, la);
        lineMat = new ShaderMaterial { Shader = new Shader { Code = LineCode }, RenderPriority = 3 };
        line.SurfaceSetMaterial(0, lineMat);
        lines = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = line, InstanceCount = Segs };
        buf = new float[Segs * 16];
        RenderingServer.MultimeshSetBuffer(lines.GetRid(), buf);
        lines.CustomAabb = new Aabb(new Vector3(-3000, -100, -3000), new Vector3(6000, 600, 6000));
        lineNode = new MultiMeshInstance3D { Name = "alive_drips_live", Multimesh = lines, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Layers = Mirrors.NoMirror, Visible = false };
        Main.I.View.AddChild(lineNode);
        world.Unported.RemoveAll(u => u is "alive_gutter_stains" or "alive_drips");
        GD.Print($"gutters: {streams.Length} broken gutters, one at {new Vector3(streams[0].X, streams[0].Top, streams[0].Z).Round()}");
    }

    private void Put(float ax, float ay, float az, float bx, float by, float bz, float ka, float kb)
    {
        if (seg >= Segs) return;
        int o = seg * 16;
        // basis: x and y anything square, z from a to b; the origin a
        float dx = bx - ax, dy = by - ay, dz = bz - az;
        buf[o] = 1e-3f; buf[o + 1] = 0; buf[o + 2] = dx; buf[o + 3] = ax;
        buf[o + 4] = 0; buf[o + 5] = 1e-3f; buf[o + 6] = dy; buf[o + 7] = ay;
        buf[o + 8] = 0; buf[o + 9] = 0; buf[o + 10] = dz; buf[o + 11] = az;
        buf[o + 12] = ka; buf[o + 13] = kb; buf[o + 14] = 1; buf[o + 15] = 0;
        seg++;
    }

    private static float Hash(float a, float b)
    {
        float s = MathF.Sin(a * 127.1f + b * 311.7f) * 43758.5453f;
        return s - MathF.Floor(s);
    }

    private static readonly float[] One = { 0 }, Wide = { -0.016f, 0.016f }, Wide3 = { -0.028f, 0, 0.028f };
    private static float Tone(float w) => w > 0.001f ? -0.8f : 1;
    private static float Sk(float k, float tone) => tone > 0 ? 1 + Math.Min(0.95f, k) : -Math.Min(0.95f, k * -tone);

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        if (day == null) return;
        float dt = (float)Math.Min(delta, 0.1);
        float t = Time.GetTicksMsec() / 1000f;
        Render.UniformUpdates.Material(stainMat, "wet_k", Math.Min(1, day.Wet * 1.2f));
        // after the rain a broken gutter runs on a while, a trickle (the roofs drain)
        if (day.Rain > 0.05f) wetSince = 0;
        else wetSince += dt;
        float sflow = Math.Max(day.Rain, day.Wet > 0.15f ? Math.Max(0, 1 - wetSince / 480) * 0.3f : 0);
        bool any = sflow > 0.02f;
        if (lineNode.Visible != any) lineNode.Visible = any;
        Info = (streams.Length, any ? nearCount : 0, any ? lastSeg : 0, sflow);
        if (!any) return;
        var cam = Main.I.Cam;
        var eye = cam.GlobalPosition;
        if (picked.DistanceTo(eye) > 6)
        {
            int m = 0;
            for (int i = 0; i < streams.Length && m < order.Length; i++)
            {
                float d = new Vector2(streams[i].X - eye.X, streams[i].Z - eye.Z).Length();
                if (d < 30) order[m++] = (i, d);
            }
            Array.Sort(order, 0, m, Closer.Instance);
            nearCount = Math.Min(NearStreams, m);
            for (int i = 0; i < nearCount; i++) near[i] = order[i].i;
            picked = eye;
        }
        seg = 0;
        var w2 = Air.WindAt(eye.X, eye.Z);
        float wx = Math.Clamp(w2.X, -1.5f, 1.5f) * 0.02f, wz = Math.Clamp(w2.Y, -1.5f, 1.5f) * 0.02f;
        var right = cam.GlobalBasis.X;
        float rx = right.X, rz = right.Z;
        float strong = Math.Min(1, sflow * 1.25f);
        for (int q = 0; q < nearCount; q++)
        {
            var s = streams[near[q]];
            float Hf = Math.Max(0.5f, s.Top - s.Ground);
            float tf = MathF.Sqrt(2 * Hf / 9.8f);
            float sway = MathF.Sin(t * 2.3f + s.Seed * 20) * 0.035f + MathF.Sin(t * 5.1f + s.Seed * 7) * 0.015f;
            int n = Math.Max(1, (int)MathF.Round(Streaks * strong));
            float dEye = new Vector2(s.X - eye.X, s.Z - eye.Z).Length();
            var wide = strong < 0.25f || dEye > 18 ? One : dEye < 10 ? Wide3 : Wide;
            for (int j = 0; j < n; j++)
            {
                float ph = t / tf + (float)j / n + s.Seed * 3.7f;
                float cyc = MathF.Floor(ph), p = ph - cyc, tau = p * tf;
                float d = 0.3f * tau + 4.9f * tau * tau;
                if (d > Hf) continue;
                float v = 0.3f + 9.8f * tau;
                float len = Math.Min(d, 0.06f + v * (strong > 0.4f ? 0.02f : 0.012f));
                float jx = (Hash(cyc, j + s.Seed) - 0.5f) * 0.05f * (0.4f + d / Hf);
                At(s, d, Hf, sway, wx, wz, out float x0, out float z0);
                At(s, d - len, Hf, sway, wx, wz, out float x1, out float z1);
                float k = (strong > 0.4f ? 0.95f : 0.7f) * (0.6f + 0.4f * Hash(cyc + 11, j));
                foreach (var w in wide)
                {
                    float dy = Math.Min(d - len, w * (Hash(cyc, j * 7 + w * 90) - 0.5f) * 12);
                    float yb = Math.Max(s.Ground + 0.01f, s.Top - d - dy);
                    float tone = Tone(w);
                    Put(x1 + jx * s.Ux + rx * w, Math.Min(s.Top, yb + len), z1 + jx * s.Uz + rz * w, x0 + jx * s.Ux + rx * w, yb, z0 + jx * s.Uz + rz * w, Sk(k * 0.3f, tone), Sk(k, tone));
                }
            }
            // the core: an unbroken thread when it pours
            if (strong > 0.45f)
            {
                float kc = 0.16f * strong;
                foreach (var w in wide)
                {
                    At(s, 0, Hf, sway, wx, wz, out float px, out float pz);
                    float py = s.Top;
                    for (int c = 1; c <= Core; c++)
                    {
                        float d = Hf * c / Core;
                        At(s, d, Hf, sway, wx, wz, out float x, out float z);
                        // (the thread is broken here and there: the water gathers and parts as it falls)
                        float hk = Hash(MathF.Floor(t * 9 - c), c + w * 50 + s.Seed);
                        float kk = hk < 0.35f ? 0 : kc * (0.4f + hk);
                        if (kk > 0) Put(px + rx * w, py, pz + rz * w, x + rx * w, s.Top - d, z + rz * w, Sk(kk, Tone(w)), Sk(kk, Tone(w)));
                        px = x; pz = z; py = s.Top - d;
                    }
                }
            }
            // splashes: flecks thrown up at the foot, each on its own short arc (never back into the wall)
            At(s, Hf, Hf, sway, wx, wz, out float fx, out float fz);
            int sm = Math.Max(1, (int)MathF.Round(Splash * strong));
            for (int j = 0; j < sm; j++)
            {
                const float life = 0.28f;
                float ph = t / life + (float)j / sm + s.Seed * 5.3f;
                float cyc = MathF.Floor(ph), a = (ph - cyc) * life;
                float ang = Hash(cyc, j * 3.1f + s.Seed) * MathF.Tau;
                float sp = (0.3f + 0.6f * Hash(cyc + 7, j)) * (0.5f + 0.5f * strong);
                float vx = MathF.Cos(ang) * sp, vz = MathF.Sin(ang) * sp;
                float outv = vx * s.Ox + vz * s.Oz;
                float ux = outv < 0 ? vx - 2 * outv * s.Ox : vx, uz = outv < 0 ? vz - 2 * outv * s.Oz : vz;
                float vy = 0.7f + 1.1f * Hash(cyc + 3, j) * strong;
                float y = s.Ground + vy * a - 4.9f * a * a;
                if (y < s.Ground) continue;
                float x = fx + ux * a, z = fz + uz * a, vyn = vy - 9.8f * a;
                Put(x - ux * 0.035f, y - vyn * 0.035f, z - uz * 0.035f, x, y, z, 0.08f, 0.4f);
            }
        }
        // (the pieces not used this frame: off)
        for (int i = seg; i < lastSeg; i++) buf[i * 16 + 14] = 0;
        lastSeg = seg;
        RenderingServer.MultimeshSetBuffer(lines.GetRid(), buf);
    }

    /// <summary>Where the water is d metres under the lip: it leaves with a little speed, outward, and sways.</summary>
    private static void At(in Stream s, float d, float Hf, float sway, float wx, float wz, out float x, out float z)
    {
        float k = d / Hf, o = 0.02f + sway * k + 0.02f * k;
        x = s.X + s.Ox * o + s.Ux * sway * 0.6f * k + wx * d;
        z = s.Z + s.Oz * o + s.Uz * sway * 0.6f * k + wz * d;
    }

    private sealed class Closer : System.Collections.Generic.IComparer<(int i, float d)>
    {
        public static readonly Closer Instance = new();
        public int Compare((int i, float d) a, (int i, float d) b) => a.d.CompareTo(b.d);
    }
}
