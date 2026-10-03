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
    };
    private static bool globalsIn;

    private static void EnsureGlobals()
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
