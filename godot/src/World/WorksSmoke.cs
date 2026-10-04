using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The works chimneys' smoke (the browser's world/works.ts): the two breweries on the brewers' canal, the sugar
/// refinery by the Hanseatic House and the gasworks beyond the south wall each throw a thick dark coal plume, up 6-10
/// m and then lying out far over the roofs down the wind. The breweries and the refinery work by day, the gasworks day
/// and night. The bake's points (26 a stack, with the browser's own dice) say where; the hours are works.ts's.
/// One draw, one shader made at the start, every puff moved on the card.
/// </summary>
[GamePart(41)]
public partial class WorksSmoke : Node
{
    private const int Per = 26;
    private ShaderMaterial? mat;
    private MultiMesh? mm;
    private float[] buf = Array.Empty<float>();
    private int[] stackOf = Array.Empty<int>();
    private float lastHour = -1;
    private readonly List<(string name, Vector3 at, float from, float to, float thick)> stacks = new();

    /// <summary>works.ts WANTS and GASWORKS: where each stack was looked for, its hours and how thick it smokes.</summary>
    private static readonly (string name, float x, float z, float reach, float from, float to, float thick)[] Wants =
    {
        ("brewery on the canal, west side", -100, 128, 34, 5, 20, 0.75f),
        ("brewery on the canal, east side", -52, 172, 34, 5.5f, 19.5f, 0.65f),
        ("sugar refinery by the Hanseatic House", 138, 170, 40, 4.5f, 21, 0.85f),
        ("gasworks beyond the south wall", -520, 205, 30, 0, 24, 1),
    };

    /// <summary>For a check: each stack, where, and whether it smokes now.</summary>
    public IReadOnlyList<(string name, Vector3 at, float from, float to, float thick)> Stacks => stacks;

    private const string Code = @"
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
global uniform float psx_time;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform vec2 wind = vec2(0.9, 0.35);
uniform vec3 col = vec3(0.1);
varying float alpha;
varying float seed;
varying float fog_depth;
varying vec3 glow;
LAMPS
float h12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void vertex() {
	// each copy one puff: its stack's mouth the copy's origin, INSTANCE_CUSTOM (phase, a random, -, how much it smokes)
	vec4 s = INSTANCE_CUSTOM;
	float life = 26.0 + s.y * 8.0;
	float age = fract(psx_time / life + s.x);
	vec3 p = MODEL_MATRIX[3].xyz;
	float ws = length(wind);
	// a hot stack's plume: up 6-10 m, then lying over and away with the wind, spreading as it goes
	p.y += (9.0 / (1.0 + 0.5 * ws)) * (1.0 - exp(-age * 4.0)) + age * 5.0;
	p.xz += wind * age * life * (0.6 + 0.8 * age);
	p.xz += vec2(sin(psx_time * 0.4 + s.y * 6.28 + age * 5.0), cos(psx_time * 0.33 + s.y * 9.0 + age * 4.0)) * 1.4 * age;
	vec4 mv = VIEW_MATRIX * vec4(p, 1.0);
	fog_depth = -mv.z;
	// (the browser's point, at most 160 pixels of the 720-line picture: a metre's pixels from the projection itself)
	vec4 c0 = PROJECTION_MATRIX * mv;
	vec4 c1 = PROJECTION_MATRIX * (mv + vec4(0.0, 1.0, 0.0, 0.0));
	float ppm = max(abs(c1.y / c1.w - c0.y / c0.w) * 360.0, 1e-4);
	float size = min(2.2 + age * 13.0, 160.0 / ppm);
	POSITION = PROJECTION_MATRIX * vec4(mv.xyz + vec3(VERTEX.xy * size, 0.0), 1.0);
	alpha = s.w * smoothstep(0.0, 0.05, age) * pow(1.0 - age, 1.3);
	seed = s.y;
	glow = vec3(0.0);
	if (alpha < 0.005 || fog_depth > psx_fog_far * 2.3) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
	else {
		// the gas lamps' glow in the air in front of the plume, as in front of the sky behind it
		vec3 to_p = p - CAMERA_POSITION_WORLD;
		float len = length(to_p);
		vec3 rd = to_p / max(len, 1e-4);
		glow = psx_lamp_color.rgb * psx_glow(CAMERA_POSITION_WORLD, rd, glow_reach(len, psx_fog_far, rd)) * psx_scatter;
	}
}
void fragment() {
	vec2 c = UV - 0.5;
	float d = dot(c, c) * 4.0;
	if (d > 1.0) discard;
	float mottle = 0.55 + 0.45 * h12(floor(UV * 6.0) + seed * 71.0);
	float f = smoothstep(psx_fog_near, psx_fog_far * 2.2, fog_depth);
	// (thicker than the browser's numbers: drawn the same way, Godot's plumes came out about half as dark; Steve,
	// 2026-10-04: a fuller plume is fine where it makes the air better)
	float a = min(alpha * 1.8 * (1.0 - d * d) * mottle, 0.8) * (1.0 - f * 0.85);
	if (a < 0.008) discard;
	ALBEDO = mix(col, psx_fog_color.rgb * 0.8, f) + glow * (0.35 + 0.65 * smoothstep(psx_fog_near, psx_fog_far, fog_depth));
	ALPHA = a;
}
";

    public override void _Ready()
    {
        ProcessPriority = 50;
        var world = Main.I.World;
        MeshInstance3D? src = null;
        foreach (var n in BakedWorld.All(world))
            if (n is MeshInstance3D m && m.Name == "works_smoke") { src = m; break; }
        var pos = world.Attribute("works_smoke", "POSITION");
        var seeds = world.Attribute("works_smoke", "_ASEED");
        if (src == null || pos == null || seeds == null || pos.Length / 3 != seeds.Length / 4)
        {
            GD.Print("works smoke: no works_smoke points in the bake: no works smoke");
            return;
        }
        int n3 = pos.Length / 3;
        // (the stacks: every Per points one mouth; which works it is by the place it was looked for)
        for (int i = 0; i * Per < n3; i++)
        {
            var at = src.GlobalTransform * new Vector3(pos[i * Per * 3], pos[i * Per * 3 + 1], pos[i * Per * 3 + 2]);
            int best = Wants.Length - 1;
            float bestD = float.MaxValue;
            for (int w = 0; w < Wants.Length; w++)
            {
                float d = new Vector2(at.X - Wants[w].x, at.Z - Wants[w].z).Length();
                if (d <= Wants[w].reach + 6 && d < bestD) { bestD = d; best = w; }
            }
            var q = Wants[best];
            stacks.Add((q.name, at, q.from, q.to, q.thick));
        }
        mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = new QuadMesh { Size = Vector2.One }, InstanceCount = n3 };
        buf = new float[n3 * 16];
        stackOf = new int[n3];
        var box = new Aabb(stacks[0].at, Vector3.Zero);
        for (int i = 0; i < n3; i++)
        {
            var at = src.GlobalTransform * new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
            int o = i * 16;
            buf[o] = 1; buf[o + 3] = at.X; buf[o + 5] = 1; buf[o + 7] = at.Y; buf[o + 10] = 1; buf[o + 11] = at.Z;
            buf[o + 12] = seeds[i * 4];
            buf[o + 13] = seeds[i * 4 + 1];
            stackOf[i] = Math.Clamp(i / Per, 0, stacks.Count - 1);
            box = box.Expand(at);
        }
        mm.Buffer = buf;
        // (a plume lies out 40 m and more down the wind; far beyond the fog it is still seen against the sky)
        mm.CustomAabb = box.Grow(120);
        mat = new ShaderMaterial { Shader = new Shader { Code = Code.Replace("LAMPS", Psx.LampScatterGlsl) }, RenderPriority = 2 };
        src.Visible = false;
        Main.I.View.AddChild(new MultiMeshInstance3D { Name = "works_smoke_live", Multimesh = mm, MaterialOverride = mat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        world.Unported.Remove("works_smoke");
        GD.Print($"works smoke: {stacks.Count} stacks ({string.Join(", ", stacks.ConvertAll(s => $"{s.name} at {s.at.Round()}"))})");
    }

    private static bool InHours(float h, float a, float b) => a <= b ? h >= a && h <= b : h >= a || h <= b;

    /// <summary>Does a stack smoke at this hour (works.ts inHours).</summary>
    public bool Smoking(int stack, float hour) => InHours(hour, stacks[stack].from, stacks[stack].to);

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        if (mat == null || mm == null || day == null) return;
        UniformUpdates.Material(mat, "wind", day.Wind);
        // coal smoke: darker than the air by day, a little lighter than the dark at night
        float k = day.Hour < 6.5f || day.Hour > 18.5f ? 1.25f : 0.42f;
        var fog = day.FogColor;
        UniformUpdates.Material(mat, "col", new Vector3(fog.R * k, fog.G * k, fog.B * k));
        if (Math.Abs(day.Hour - lastHour) < 0.05f) return;
        lastHour = day.Hour;
        for (int i = 0; i < stackOf.Length; i++)
        {
            var s = stacks[stackOf[i]];
            buf[i * 16 + 15] = InHours(day.Hour, s.from, s.to) ? 0.55f * s.thick : 0;
        }
        RenderingServer.MultimeshSetBuffer(mm.GetRid(), buf);
    }
}
