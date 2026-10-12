using System;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.Native.Game;

/// <summary>Native surface detail within the game's sun, spill-light, fog and weather shaders.</summary>
public static class NativeSurfaceMaterials
{
    private static string Read(string path) => Godot.FileAccess.GetFileAsString("res://shaders/" + path);
    public static ShaderMaterial CastIron(ShaderMaterial source)
    {
        var kind = new Psx.Kind(false, false, false, false, true, false, 0, false, false, true, Ground: true);
        string code = Psx.ShaderOf(kind).Code;
        code = code.Replace("void vertex() {", Read("surface_normal.gdshaderinc") + "\n" + Read("cast_iron.gdshaderinc") + "\nvoid vertex() {\n iron_position = VERTEX;");
        code = code.Replace("vec4 c = texture(tex, uv);", "vec3 iron_colour; float iron_rough, iron_metal, iron_polish;\n iron_finish(iron_position, iron_colour, iron_rough, iron_metal, iron_polish);\n vec4 c = vec4(iron_colour, 1.0);");
        code = code.Replace("vec3 n_flat = NORMAL;", "NORMAL = metric_surface_normal(VERTEX, NORMAL, iron_height(iron_position));\n vec3 n_flat = NORMAL;");
        int start = code.IndexOf("\tspec_k = 0.0;", StringComparison.Ordinal), end = code.IndexOf("\t// the lamps' glow", StringComparison.Ordinal);
        if (start < 0 || end <= start) throw new InvalidOperationException("The game wet-surface shader changed; review native iron lighting.");
        code = code[..start] + @"
    // Rust stays rough; polished iron and the rain film catch broad highlights.
    float iron_wet = clamp(psx_wet, 0.0, 1.0);
    c.rgb *= 1.0 - iron_wet * 0.24;
    spec_k = mix(0.22, 1.0, clamp(iron_metal * (1.0 - iron_rough) + iron_polish * 0.4 + iron_wet * 0.6, 0.0, 1.0));
    float iron_fresnel = pow(1.0 - max(dot(NORMAL, VIEW), 0.0), 5.0);
    vec3 iron_reflection = reflect(rd, nw);
    ad += mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, iron_reflection.y * 0.5 + 0.5) * iron_fresnel * (0.035 + 0.13 * iron_metal + iron_wet * 0.12);
    if (psx_spill_n > 0) ad += psx_spill_wet(world, iron_reflection, 0.0) * (0.04 + iron_wet * 0.11) * spec_k;
" + code[end..];
        var made = new ShaderMaterial { ResourceName = "Native cast iron · game", Shader = new Shader { Code = code } };
        made.SetShaderParameter("surface_depth", source.GetShaderParameter("surface_depth"));
        made.SetShaderParameter("affine", 0f); made.SetShaderParameter("spec_color", new Vector3(0.13f, 0.14f, 0.15f)); made.SetShaderParameter("shininess", 38f);
        made.SetMeta("native_surface_kind", "cast_iron");
        return made;
    }

    public static void Coping(ShaderMaterial material)
    {
        const string old = "NORMAL = bump_normal(VERTEX, NORMAL, bump_dh(raw_uv, vec2(0.0), VIEWPORT_SIZE.y / 270.0));";
        string code = material.Shader.Code;
        if (!code.Contains(old, StringComparison.Ordinal)) throw new InvalidOperationException("Coping game shader has no original bump hook.");
        code = code.Replace("void vertex() {", Read("surface_normal.gdshaderinc") + "\nvoid vertex() {");
        code = code.Replace(old, "NORMAL = metric_surface_normal(VERTEX, NORMAL, bump_scale * textureGrad(bump_map, raw_uv, dFdx(raw_uv), dFdy(raw_uv)).r);");
        material.Shader = new Shader { Code = code }; material.SetShaderParameter("bump_scale", 0.008f);
        material.SetMeta("native_coping_detail", 1);
    }
}
