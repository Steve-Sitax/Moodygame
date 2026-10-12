shader_type spatial;
render_mode diffuse_burley, cull_back;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform vec3 emission_color : source_color = vec3(0.0);
uniform vec4 uv_transform = vec4(1.0, 1.0, 0.0, 0.0);
// glTF modes: repeat = 10497, clamp = 33071, mirrored repeat = 33648.
uniform ivec2 wrap_modes = ivec2(10497);
uniform bool use_vertex_color = false;
uniform float alpha_cut = 0.0;
uniform float roughness = 1.0;
uniform float metallic = 0.0;

float wrapped_axis(float value, int mode, float texel) {
    if (mode == 33071) return clamp(value, texel * 0.5, 1.0 - texel * 0.5);
    if (mode == 33648) return 1.0 - abs(mod(value, 2.0) - 1.0);
    return value;
}

void fragment() {
    vec2 uv = UV * uv_transform.xy + uv_transform.zw;
    vec2 texel = 1.0 / vec2(textureSize(albedo_tex, 0));
    vec2 sampled_uv = vec2(wrapped_axis(uv.x, wrap_modes.x, texel.x), wrapped_axis(uv.y, wrap_modes.y, texel.y));
    // Use the unwrapped derivatives so the seam does not force a coarse mip.
    vec4 paint = textureGrad(albedo_tex, sampled_uv, dFdx(uv), dFdy(uv));
    if (paint.a * albedo_color.a < alpha_cut) discard;
    vec3 tint = use_vertex_color ? COLOR.rgb : vec3(1.0);
    ALBEDO = paint.rgb * albedo_color.rgb * tint;
    EMISSION = paint.rgb * emission_color * tint;
    ROUGHNESS = roughness;
    METALLIC = metallic;
    // ALPHA_OUTPUT
}
