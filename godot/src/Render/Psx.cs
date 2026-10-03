using System.Collections.Generic;
using System.Text;
using Godot;

namespace Scheldemist.Render;

/// <summary>
/// The PS1 material (the browser's retro/psx.ts): vertex snap past arm's length, affine texture warp, the houses'
/// atlas cells, the fog with its reach, light from the sky's two colours. One shader per set of switches, kept and
/// shared (docs/rendering.md: no new shader kinds without need); everything else is a uniform.
/// </summary>
public static class Psx
{
    public record struct Kind(bool Unlit, bool Blend, bool Scissor, bool TwoSided, bool DepthWrite, bool Snap, int Atlas, bool VertexColor, bool Add, bool Fog);

    private static readonly Dictionary<Kind, Shader> Shaders = new();

    /// <summary>A hex colour (sRGB, as the TypeScript writes them) as the linear colour the shaders count in.</summary>
    public static Color Hex(int h) => new Color(((h >> 16) & 255) / 255f, ((h >> 8) & 255) / 255f, (h & 255) / 255f).SrgbToLinear();

    /// <summary>
    /// The values every psx material reads (the browser's psxUniforms), as global shader uniforms. The first ones are
    /// in project.godot; the rest are added here, before the first shader is made, so a new one needs no project edit.
    /// Colours are linear numbers (plain vec4: no conversion on the way).
    /// </summary>
    private static readonly (string name, RenderingServer.GlobalShaderParameterType type, Variant value)[] Added =
    {
        ("psx_sun_dir", RenderingServer.GlobalShaderParameterType.Vec3, new Vector3(0, 1, 0)),
        ("psx_sun_shade", RenderingServer.GlobalShaderParameterType.Float, 1f),
        ("psx_scatter", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_wet", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_rain", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_puddle", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_sea", RenderingServer.GlobalShaderParameterType.Float, 1f),
        // the nearest lit gas lamps (the browser's uLamps, MAX_LAMPS 6): xyz the flame, w its brightness now
        ("psx_lamp0", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp1", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp2", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp3", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp4", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp5", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp_color", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(1.0f, 0.62f, 0.28f, 1)),
    };
    private static bool globalsIn;
    public const int MaxLamps = 6;
    private static readonly Vector4 NoLamp = new(0, -999, 0, 0);

    /// <summary>
    /// The lamps' light scattered toward the eye by the air (psx.ts LAMP_SCATTER_GLSL), for the psx fog and for the
    /// shaders of their own (the sky, the rain): psx_glow(eye, ray, metres) is the sum over the six lamps.
    /// </summary>
    public const string LampScatterGlsl = @"
global uniform vec4 psx_lamp0;
global uniform vec4 psx_lamp1;
global uniform vec4 psx_lamp2;
global uniform vec4 psx_lamp3;
global uniform vec4 psx_lamp4;
global uniform vec4 psx_lamp5;
global uniform vec4 psx_lamp_color;
global uniform float psx_scatter;
// how far along a ray the glow is gathered: to the surface, never past 1.5 fog-fars, nor out of the low air the
// lamps light (16 m over the eye)
float glow_reach(float len, float far, vec3 rd) {
	return min(min(len, far * 1.5), 16.0 / max(rd.y, 0.01));
}
float half_scatter(float t, float h) {
	float h2 = h * h;
	return 0.5 * (t / (h2 * (h2 + t * t)) + atan(t / h) / (h2 * h));
}
float lamp_scatter(vec3 ro, vec3 rd, float len, vec3 p) {
	vec3 q = p - ro;
	float t0 = dot(q, rd);
	float d = length(q - rd * t0);
	float h = d + 1.2;
	float tight = half_scatter(len - t0, h) - half_scatter(-t0, h);
	float hw = d + 2.5;
	float wide = (atan((len - t0) / hw) - atan(-t0 / hw)) / hw;
	// fog throws light on forward: a lamp ahead glows, one beside the eye a third as much, one behind an eighth
	vec3 x = rd * clamp(t0 - hw, 0.0, len) - q;
	float phase = 0.12 + 0.88 * smoothstep(-0.5, 1.0, dot(normalize(x + vec3(0.0, 1e-4, 0.0)), -rd));
	return (tight + wide * 0.165 * smoothstep(14.0, 4.0, d)) * phase;
}
float psx_glow(vec3 ro, vec3 rd, float len) {
	float g = 0.0;
	if (psx_lamp0.w > 0.0) g += psx_lamp0.w * lamp_scatter(ro, rd, len, psx_lamp0.xyz);
	if (psx_lamp1.w > 0.0) g += psx_lamp1.w * lamp_scatter(ro, rd, len, psx_lamp1.xyz);
	if (psx_lamp2.w > 0.0) g += psx_lamp2.w * lamp_scatter(ro, rd, len, psx_lamp2.xyz);
	if (psx_lamp3.w > 0.0) g += psx_lamp3.w * lamp_scatter(ro, rd, len, psx_lamp3.xyz);
	if (psx_lamp4.w > 0.0) g += psx_lamp4.w * lamp_scatter(ro, rd, len, psx_lamp4.xyz);
	if (psx_lamp5.w > 0.0) g += psx_lamp5.w * lamp_scatter(ro, rd, len, psx_lamp5.xyz);
	return g;
}
";

    public static void EnsureGlobals()
    {
        if (globalsIn) return;
        globalsIn = true;
        foreach (var (name, type, value) in Added) RenderingServer.GlobalShaderParameterAdd(name, type, value);
    }

    /// <summary>Set one of the shared values (a colour as its linear numbers).</summary>
    public static void Set(string name, Variant value)
    {
        EnsureGlobals();
        if (value.VariantType == Variant.Type.Color)
        {
            var c = value.AsColor();
            value = new Vector4(c.R, c.G, c.B, c.A);
        }
        RenderingServer.GlobalShaderParameterSet(name, value);
    }

    public static int ShaderCount => Shaders.Count;

    public static Shader ShaderOf(Kind k)
    {
        if (Shaders.TryGetValue(k, out var s)) return s;
        EnsureGlobals();
        var modes = new List<string> { "diffuse_lambert", "specular_disabled", "vertex_lighting", "ambient_light_disabled" };
        if (k.Unlit) modes.Add("unshaded");
        if (k.TwoSided) modes.Add("cull_disabled");
        if (k.Add) modes.Add("blend_add");
        else if (k.Blend) modes.Add("blend_mix");
        if (k.Blend || k.Add) modes.Add(k.DepthWrite ? "depth_draw_always" : "depth_draw_never");
        var c = new StringBuilder();
        c.Append("shader_type spatial;\nrender_mode ").Append(string.Join(", ", modes)).Append(";\n");
        c.Append(@"
global uniform vec2 psx_snap_res;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
global uniform vec4 psx_hemi_sky;
global uniform vec4 psx_hemi_ground;
uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D tex : source_color, filter_nearest_mipmap, repeat_enable;
uniform vec3 emission : source_color = vec3(0.0);
uniform sampler2D emission_tex : source_color, filter_nearest_mipmap, repeat_enable;
uniform float affine = 1.0;
uniform float fog_reach = 1.0;
uniform float alpha_cut = 0.5;
uniform vec4 uv_xform = vec4(1.0, 1.0, 0.0, 0.0);
varying vec3 aff;
varying float fog_depth;
");
        if (k.Atlas > 0) c.Append("varying vec2 cell;\n");
        c.Append(@"
void vertex() {
	vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -view.z;
	POSITION = PROJECTION_MATRIX * view;
");
        if (k.Snap)
            c.Append(@"	// snap only past arm's length: up close the jitter just looks broken
	if (psx_snap_res.x < 5e4) {
		vec2 ndc = POSITION.xy / POSITION.w;
		vec2 snapped = floor(ndc * psx_snap_res + 0.5) / psx_snap_res;
		POSITION.xy = mix(ndc, snapped, smoothstep(1.5, 4.0, POSITION.w)) * POSITION.w;
	}
");
        if (k.Atlas > 0) c.Append("	cell = UV2;\n");
        c.Append(@"	UV = UV * uv_xform.xy + uv_xform.zw;
	aff = vec3(UV * POSITION.w, POSITION.w);
}

void fragment() {
	vec2 uv = mix(UV, aff.xy / aff.z, affine);
");
        if (k.Atlas > 0) c.Append($"	uv = (cell + fract(uv)) / {k.Atlas}.0;\n");
        c.Append("	vec4 c = albedo * texture(tex, uv);\n");
        if (k.VertexColor) c.Append("	c.rgb *= COLOR.rgb;\n");
        if (k.Scissor) c.Append("	if (c.a < alpha_cut) discard;\n");
        c.Append("	ALBEDO = c.rgb;\n");
        if (k.Blend || k.Add) c.Append("	ALPHA = c.a;\n");
        if (!k.Unlit)
            c.Append(@"	// the sky's light: its own colour from above, the ground's from below (three's HemisphereLight)
	vec3 wn = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	EMISSION = emission * texture(emission_tex, uv).rgb + c.rgb * mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, wn.y * 0.5 + 0.5);
");
        if (k.Fog) c.Append("	FOG = vec4(psx_fog_color.rgb, smoothstep(psx_fog_near, psx_fog_far * fog_reach, fog_depth));\n");
        else c.Append("	FOG = vec4(0.0);\n");
        c.Append("}\n");
        s = new Shader { Code = c.ToString() };
        Shaders[k] = s;
        return s;
    }
}
