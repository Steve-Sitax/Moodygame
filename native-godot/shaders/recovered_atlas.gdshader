shader_type spatial;
render_mode diffuse_burley;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform float atlas_grid = 8.0;
uniform vec4 uv_transform = vec4(1.0, 1.0, 0.0, 0.0);
uniform float alpha_cut = 0.0;
uniform bool use_vertex_color = false;
varying vec2 atlas_cell;

void vertex() {
    atlas_cell = UV2;
}

void fragment() {
    vec2 tiled_uv = UV * uv_transform.xy + uv_transform.zw;
    vec2 atlas_uv = (atlas_cell + fract(tiled_uv)) / atlas_grid;
    // Derivatives from the unwrapped coordinates prevent blurry seams at each repeated cell.
    vec4 paint = textureGrad(albedo_tex, atlas_uv, dFdx(tiled_uv) / atlas_grid, dFdy(tiled_uv) / atlas_grid);
    if (paint.a * albedo_color.a < alpha_cut) discard;
    ALBEDO = paint.rgb * albedo_color.rgb * (use_vertex_color ? COLOR.rgb : vec3(1.0));
    ROUGHNESS = 1.0;
}
