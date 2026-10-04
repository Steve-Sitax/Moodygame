using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The smoke from the town's chimneys (the browser's world/ambient.ts buildSmoke): fourteen puffs a chimney, rising
/// buoyant, levelling off and going with the wind, curling, spreading; thicker in the morning and the evening and on
/// a cold day, each chimney lit as the town's fires are (some only when many burn). Coal smoke: darker and browner than
/// the sky by day, a shade lighter than the dark at night, the lamps' glow in the air in front of it. The bake's points
/// say where the chimneys are; the dice are the browser's (mulberry 1873 and 51), so the same chimneys smoke.
/// </summary>
[GamePart(40)]
public partial class ChimneySmoke : Node
{
    private const int Per = 14;
    private ShaderMaterial? mat;

    /// <summary>Counts for a check: the chimneys, how much they smoke now.</summary>
    public (int chimneys, float level) Info { get; private set; }

    /// <summary>ambient.ts SMOKE_BY_HOUR: how many fires burn by the clock.</summary>
    private static readonly (float h, float v)[] ByHour =
    {
        (0, 0.26f), (5, 0.3f), (6.5f, 0.86f), (9, 0.8f), (10.5f, 0.5f), (12, 0.6f), (13.5f, 0.46f),
        (16, 0.54f), (17.5f, 0.86f), (21, 0.82f), (23, 0.42f), (24, 0.26f),
    };
    private static readonly Dictionary<string, float> Cold = new() { ["fog"] = 0.05f, ["mist"] = 0, ["clear"] = 0.12f, ["rain"] = 0.08f, ["storm"] = 0.1f };

    private const string Code = @"
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
global uniform float psx_time;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform float smoke = 0.5;
uniform vec2 wind = vec2(1.0, 0.0);
uniform vec3 col = vec3(0.1);
varying float alpha;
varying float seed;
varying float fog_depth;
varying vec3 glow;
LAMPS
float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void vertex() {
	// each copy is one puff: its chimney the copy's origin, INSTANCE_CUSTOM its dice
	vec4 s4 = INSTANCE_CUSTOM;
	float act = smoothstep(s4.x - 0.03, s4.x + 0.03, smoke);
	float life = 9.0 + s4.z * 4.0;
	float age = fract(psx_time / life + s4.y);
	vec3 p = MODEL_MATRIX[3].xyz;
	// buoyant at first, then it levels off and goes with the wind (a stronger wind bends it over sooner)
	float lift = 1.0 / (1.0 + 0.45 * length(wind));
	p.y += (5.2 * (1.0 - exp(-age * 2.8)) + age * 2.6) * lift;
	float along = age * life;
	p.xz += wind * along * (0.45 + age * 1.1);
	p.xz += vec2(sin(psx_time * 1.1 + s4.w * 6.28 + age * 6.0), cos(psx_time * 0.9 + s4.z * 6.28 + age * 5.0)) * 0.6 * age;
	vec4 mv = VIEW_MATRIX * vec4(p, 1.0);
	fog_depth = -mv.z;
	// a square facing the eye, as big as the browser's point
	float size = 0.6 + age * 3.6;
	POSITION = PROJECTION_MATRIX * vec4(mv.xyz + vec3(VERTEX.xy * size, 0.0), 1.0);
	// (thicker when many fires burn: the morning and the evening)
	alpha = act * smoothstep(0.0, 0.08, age) * (1.0 - age) * (0.75 + 0.5 * smoke);
	seed = s4.w;
	glow = vec3(0.0);
	if (alpha < 0.005 || fog_depth > psx_fog_far * 1.15) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
	else {
		vec3 wp = p;
		vec3 to_p = wp - CAMERA_POSITION_WORLD;
		float len = length(to_p);
		vec3 rd = to_p / max(len, 1e-4);
		glow = psx_lamp_color.rgb * psx_glow(CAMERA_POSITION_WORLD, rd, glow_reach(len, psx_fog_far, rd)) * psx_scatter;
	}
}
void fragment() {
	vec2 c = UV - 0.5;
	float d = dot(c, c) * 4.0;
	if (d > 1.0) discard;
	// a blocky puff: 5 x 5 cells of uneven density, like a crushed 16 px sprite
	float mottle = 0.55 + 0.45 * hash12(floor(UV * 5.0) + seed * 91.0);
	float f = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	float a = min(alpha * (1.0 - d * d) * mottle * 1.5, 0.7) * (1.0 - f * 0.9);
	if (a < 0.008) discard;
	ALBEDO = mix(col, psx_fog_color.rgb, f) + glow * (0.35 + 0.65 * f);
	ALPHA = a;
}
";

    /// <summary>ambient.ts mulberry: a row of dice from a seed (mulberry32).</summary>
    private static Func<float> Mulberry(uint seed)
    {
        uint a = seed;
        return () =>
        {
            a += 0x6d2b79f5;
            uint t = a;
            t = (t ^ (t >> 15)) * (t | 1);
            t ^= t + (t ^ (t >> 7)) * (t | 61);
            return (t ^ (t >> 14)) / 4294967296f;
        };
    }

    public override void _Ready()
    {
        ProcessPriority = 50;
        var src = BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().FirstOrDefault(m => m.Name == "ambient_smoke" || m.GetParent()?.Name == "ambient_smoke");
        if (src?.Mesh is not ArrayMesh am || am.GetSurfaceCount() == 0)
        {
            GD.Print("smoke: no ambient_smoke in the bake: no chimney smoke");
            return;
        }
        var pts = am.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var chimneys = new List<Vector3>();
        for (int i = 0; i < pts.Length; i += Per) chimneys.Add(src.GlobalTransform * pts[i]);
        var actR = Mulberry(1873);
        var act = chimneys.Select(_ => actR()).ToArray();
        var r = Mulberry(51);
        int n = chimneys.Count * Per;
        var buf = new float[n * 16];
        for (int i = 0; i < chimneys.Count; i++)
            for (int k = 0; k < Per; k++)
            {
                int o = (i * Per + k) * 16;
                // (the bake's points stand 0.1 m over the chimney already)
                var c = chimneys[i];
                buf[o] = 1; buf[o + 3] = c.X; buf[o + 5] = 1; buf[o + 7] = c.Y; buf[o + 10] = 1; buf[o + 11] = c.Z;
                buf[o + 12] = act[i];
                buf[o + 13] = (k + r() * 0.6f) / Per;
                buf[o + 14] = r();
                buf[o + 15] = r();
            }
        var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = new QuadMesh { Size = Vector2.One }, InstanceCount = n };
        mm.Buffer = buf;
        var box = new Aabb(chimneys[0], Vector3.Zero);
        foreach (var c in chimneys) box = box.Expand(c);
        mm.CustomAabb = box.Grow(40);
        mat = new ShaderMaterial { Shader = new Shader { Code = Code.Replace("LAMPS", Psx.LampScatterGlsl) }, RenderPriority = 2 };
        src.Visible = false;
        Main.I.View.AddChild(new MultiMeshInstance3D { Name = "chimney_smoke", Multimesh = mm, MaterialOverride = mat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        Main.I.World.Unported.Remove("ambient_smoke");
        Info = (chimneys.Count, 0);
        GD.Print($"smoke: {chimneys.Count} chimneys, one at {chimneys[chimneys.Count / 2].Round()}");
    }

    private static float Curve(float h)
    {
        int i = 0;
        while (i < ByHour.Length - 2 && h >= ByHour[i + 1].h) i++;
        var (h0, v0) = ByHour[i];
        var (h1, v1) = ByHour[i + 1];
        return v0 + (v1 - v0) * Math.Clamp((h - h0) / (h1 - h0), 0, 1);
    }

    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("ChimneySmoke");
        var day = Daylight.I;
        if (mat == null || day == null) return;
        float level = Curve(day.Hour) + Cold.GetValueOrDefault(day.Weather, 0);
        Scheldemist.Render.UniformUpdates.Material(mat, "smoke", level);
        Scheldemist.Render.UniformUpdates.Material(mat, "wind", day.Wind);
        var fog = day.FogColor;
        float night = day.Night, dayK = 1 - night;
        Scheldemist.Render.UniformUpdates.Material(mat, "col", new Vector3(fog.R * (0.4f + 0.75f * night) + 0.018f * dayK, fog.G * (0.4f + 0.75f * night) + 0.015f * dayK, fog.B * (0.4f + 0.75f * night) + 0.012f * dayK));
        Info = (Info.chimneys, level);
    }
}
