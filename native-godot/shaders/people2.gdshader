shader_type spatial;
render_mode ambient_light_disabled, cull_back;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
global uniform vec4 psx_hemi_sky;
global uniform vec4 psx_hemi_ground;
global uniform vec4 psx_mir0;
global uniform vec4 psx_mir1;
global uniform float psx_wet;
// Animals retain their own coat pictures while sharing this exact shader with layered people.
uniform bool layered_pictures = true;
uniform sampler2D tex : source_color, hint_default_white, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D skin_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform vec4 albedo : source_color = vec4(1.0);
uniform float normal_strength = 1.0;
// Optional baked weighted skins for instanced small wildlife; the same shader kind as people/animals.
uniform bool vertex_animation = false;
uniform sampler2D pose_positions : filter_nearest, repeat_disable;
uniform sampler2D pose_normals : filter_nearest, repeat_disable;
instance uniform vec3 skin_pose = vec3(-1.0);
uniform sampler2DArray clothes_colour : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2DArray clothes_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2DArray face_colour : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2DArray face_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2DArray detail_colour : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray detail_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool player_tint = false;
uniform sampler2D player_cloth : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
instance uniform int clothes_layer = 0;
instance uniform int face_layer = 0;
instance uniform vec3 skin_tone_shift = vec3(0.0);
instance uniform vec3 body_tone = vec3(1.0); // the body's skin takes the tone of the person's face picture
instance uniform float underwear_wear = 0.0;
// Optional local player's palette. Alpha zero leaves every townsperson and animal unchanged.
instance uniform vec4 player_skin : source_color = vec4(0.0);
instance uniform vec4 player_hair : source_color = vec4(0.0);
instance uniform vec4 player_shirt : source_color = vec4(0.0);
instance uniform vec4 player_coat : source_color = vec4(0.0);
instance uniform vec4 player_lower : source_color = vec4(0.0);
instance uniform vec4 player_feet : source_color = vec4(0.0);
instance uniform vec4 player_vest : source_color = vec4(0.0);
instance uniform vec4 player_apron : source_color = vec4(0.0);
instance uniform vec4 player_head : source_color = vec4(0.0);
instance uniform float viewmodel_depth_pull = 0.0;
varying vec3 authored_position;
varying vec3 world;
varying float fog_depth;
varying float sun_lit;
varying float eye;
varying float surface_roughness;

global uniform sampler2D psx_sky_shade : filter_linear, repeat_disable;
global uniform vec4 psx_sky_box;
global uniform float psx_sky_on;
global uniform vec3 psx_sun_dir;
global uniform float psx_sun_shade;
// from the point toward the sun, every 2 m out to 40 m: is a house's height (the sky map's blue) over the ray there?
float psx_sun_shadow(vec3 wp, vec3 nw) {
	if (psx_sky_on <= 0.0 || psx_sun_dir.y <= 0.02) return 1.0;
	vec3 p = wp + nw * 0.3;
	float along = length(psx_sun_dir.xz);
	if (along < 1e-3) return 1.0;
	vec2 d = psx_sun_dir.xz / along;
	float rise = psx_sun_dir.y / along;
	float lit = 1.0;
	for (int i = 1; i <= 20; i++) {
		float s = float(i) * 2.0;
		vec2 uv = (p.xz + d * s - psx_sky_box.xy) / psx_sky_box.zw;
		if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
		float over = textureLod(psx_sky_shade, uv, 0.0).b * 30.0 - (p.y + s * rise);
		lit = min(lit, 1.0 - smoothstep(-0.5, 0.5, over));
		if (lit <= 0.0) break;
	}
	return mix(1.0, lit, psx_sky_on * psx_sun_shade);
}
// the street's floor in a narrow lane sees a strip of sky, the wall's foot a little more, the eaves all of it
float psx_sky_seen(vec3 wp, vec3 nw) {
	if (psx_sky_on <= 0.0) return 1.0;
	vec2 uv = (wp.xz + nw.xz * 0.7 - psx_sky_box.xy) / psx_sky_box.zw;
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
	vec4 s = textureLod(psx_sky_shade, uv, 0.0);
	float up = s.g > 0.01 ? clamp(wp.y / (s.g * 25.0), 0.0, 1.0) : 1.0;
	// never under 30 % of the sky, and 65 % of the difference; the sun's shadows carry the contrast on a bright day
	float r = max(s.r, 0.3);
	float v = mix(clamp(r * 2.0, 0.0, 1.0), r, abs(nw.y));
	return mix(1.0, mix(v, 1.0, up * up), 0.65 * psx_sky_on);
}

/*SCATTER*/
/*SPILL*/
// The six existing gas lamps also catch the eye when their lighting is drawn as spill.
vec3 eye_lamp(vec4 lamp, vec3 n, vec3 v) {
    vec3 d = lamp.xyz - world;
    float dl = length(d);
    vec3 l = d / max(dl, 1e-4);
    float glint = pow(max(dot(n, normalize(l + v)), 0.0), 150.0);
    float cap = psx_lamp_cap(1.7, -l.y);
    return psx_lamp_color.rgb * lamp.w * cap * glint * 0.6 / (pow(max(dl, 0.05), 1.7) + 0.6) / PI;
}
vec3 palette_point(sampler2D image, float bone, vec3 pose, vec4 point) {
    vec2 dimensions = vec2(textureSize(image, 0));
    vec2 a = vec2((bone * 3.0 + 0.5) / dimensions.x, (pose.x + 0.5) / dimensions.y);
    vec2 b = vec2(a.x, (pose.y + 0.5) / dimensions.y);
    vec4 r0 = mix(textureLod(image, a, 0.0), textureLod(image, b, 0.0), pose.z);
    a.x += 1.0 / dimensions.x; b.x = a.x;
    vec4 r1 = mix(textureLod(image, a, 0.0), textureLod(image, b, 0.0), pose.z);
    a.x += 1.0 / dimensions.x; b.x = a.x;
    vec4 r2 = mix(textureLod(image, a, 0.0), textureLod(image, b, 0.0), pose.z);
    return vec3(dot(r0, point), dot(r1, point), dot(r2, point));
}
void vertex() {
    authored_position = vec3(UV2.y, UV2.x, 0.0);
    if (vertex_animation) {
        vec3 pose = skin_pose.x >= 0.0 ? skin_pose : INSTANCE_CUSTOM.rgb;
        vec2 bone = floor(UV2);
        vec2 weight = max((fract(UV2) - vec2(0.25)) * 2.0, vec2(0.0));
        weight /= max(weight.x + weight.y, 0.0001);
        vec4 point = vec4(VERTEX, 1.0);
        VERTEX = palette_point(pose_positions, bone.x, pose, point) * weight.x + palette_point(pose_positions, bone.y, pose, point) * weight.y;
        vec4 direction = vec4(NORMAL, 0.0);
        NORMAL = normalize(palette_point(pose_normals, bone.x, pose, direction) * weight.x + palette_point(pose_normals, bone.y, pose, direction) * weight.y);
    }
    vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
    // Reverse-Z: keep the camera rig in front of close geometry while retaining its own depth order.
    // It still contracts physically at walls; this also covers thin overhangs between the collision probes.
    POSITION = PROJECTION_MATRIX * view;
    // Retain the real near-plane clip: pulling vertices behind the eye forward exposes the sleeve cut.
    if (view.z < -0.08) POSITION.z = mix(POSITION.z, POSITION.w, viewmodel_depth_pull * 0.99);
    world = (INV_VIEW_MATRIX * view).xyz;
    fog_depth = -view.z;
}
void fragment() {
    if ((world.y < psx_mir0.w - 0.02 && distance(CAMERA_POSITION_WORLD, psx_mir0.xyz) < 0.02) || (world.y < psx_mir1.w - 0.02 && distance(CAMERA_POSITION_WORLD, psx_mir1.xyz) < 0.02)) discard;
    bool face = layered_pictures && COLOR.g > 0.5;
    vec4 cloth = layered_pictures ? texture(clothes_colour, vec3(UV, float(clothes_layer))) : texture(tex, UV) * albedo;
    vec4 c = face ? texture(face_colour, vec3(UV, float(face_layer))) : player_tint ? texture(player_cloth, UV) : cloth;
    // Strand coverage and the geometric fade together retain an opaque depth/shadow path.
    if (face && c.a + COLOR.a <= 1.0) discard;
    ALPHA = 1.0;
    ALPHA_SCISSOR_THRESHOLD = 0.42;
    float zone = layered_pictures ? (face ? 5.0 : round(cloth.a * 5.0)) : 0.0;
    if (!face && zone > 1.5 && zone < 2.5) c.rgb *= 1.0 - underwear_wear * (0.23 + 0.035 * sin(UV.y * 150.0) * sin(UV.x * 110.0));
    if (!face && zone > 4.5) c.rgb *= body_tone;
    if (face || zone > 4.5) c.rgb = clamp(c.rgb + skin_tone_shift, vec3(0.0), vec3(1.0));
    float close_detail = 1.0 - smoothstep(1.25, 3.5, length(world - CAMERA_POSITION_WORLD));
    vec2 detail_uv = UV * (face ? 4.0 : 8.0);
    if (zone > 0.5 && close_detail > 0.0) {
        vec3 grain = texture(detail_colour, vec3(detail_uv, zone)).rgb;
        c.rgb *= mix(vec3(1.0), grain / vec3(0.5), close_detail * 0.35);
    }
    eye = COLOR.r;
    bool hair = face && eye < 0.5 && c.a < 0.99;
    vec4 palette = vec4(0.0);
    if (eye < 0.5) {
        if (hair) palette = player_hair;
        else if (face || zone > 4.5) palette = player_skin;
    }
    float pigment = clamp(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) / (face || zone > 4.5 ? 0.46 : hair ? 0.18 : 0.30), 0.25, 1.8);
    c.rgb = mix(c.rgb, palette.rgb * pigment, palette.a);
    float dry = face ? (hair ? 0.48 : 0.76) : zone < 0.5 ? 0.42 : zone < 1.5 ? 0.94 : zone < 2.5 ? 0.87 : zone < 3.5 ? 0.91 : zone < 4.5 ? 0.62 : 0.76;
    // Wool/linen/canvas absorb more water than skin, leather or metal fittings (zone zero).
    float wet = layered_pictures ? clamp(psx_wet, 0.0, 1.0) : 0.0;
    float absorb = !face && zone > 0.5 && zone < 3.5 ? 0.28 : hair ? 0.18 : 0.09;
    c.rgb *= 1.0 - wet * absorb;
    surface_roughness = layered_pictures ? mix(dry, max(0.23, dry * 0.58), wet) : 0.55;
    surface_roughness = mix(surface_roughness, 0.12, eye);
    // Cotangent frame from the actual skinned surface; handles mirrored UVs without imported tangents.
    vec3 dp1 = dFdx(VERTEX), dp2 = dFdy(VERTEX);
    vec2 duv1 = dFdx(UV), duv2 = dFdy(UV);
    vec3 p2 = cross(dp2, NORMAL), p1 = cross(NORMAL, dp1);
    vec3 t = p2 * duv1.x + p1 * duv2.x;
    vec3 b = p2 * duv1.y + p1 * duv2.y;
    float inv = inversesqrt(max(max(dot(t,t), dot(b,b)), 1e-12));
    vec2 xy = layered_pictures ? (face ? texture(face_normal, vec3(UV,float(face_layer))).rg : texture(clothes_normal, vec3(UV,float(clothes_layer))).rg) * 2.0 - 1.0 : (texture(skin_normal, UV).rg * 2.0 - 1.0) * normal_strength;
    if (zone > 0.5 && close_detail > 0.0 && eye < 0.5) xy += (texture(detail_normal, vec3(detail_uv,zone)).rg * 2.0 - 1.0) * close_detail * 0.4;
    vec3 nm = vec3(xy, sqrt(max(1.0 - dot(xy,xy), 0.001)));
    NORMAL = normalize(mat3(t * inv, b * inv, NORMAL) * normalize(nm));
    vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
    vec3 sky = mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, nw.y * 0.5 + 0.5) * psx_sky_seen(world, nw);
    sun_lit = psx_sun_shadow(world, nw);
    vec3 spilt = psx_spill_n > 0 ? psx_spill_at(world, nw) / PI : vec3(0.0);
    float fog_k = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
    vec3 ray = world - CAMERA_POSITION_WORLD;
    float len = length(ray);
    vec3 rd = ray / max(len, 1e-4);
    vec3 halo = psx_lamp_color.rgb * psx_glow(CAMERA_POSITION_WORLD, rd, glow_reach(len, psx_fog_far, rd)) * psx_scatter * (0.35 + 0.65 * fog_k);
    ALBEDO = c.rgb;
    float occlusion = layered_pictures ? clamp(COLOR.b, 0.22, 1.0) : 1.0;
    EMISSION = c.rgb * (sky * occlusion + spilt) + halo;
    if (eye > 0.5) {
        vec3 v = normalize(CAMERA_POSITION_WORLD - world);
        EMISSION += eye * (eye_lamp(psx_lamp0, nw, v) + eye_lamp(psx_lamp1, nw, v) + eye_lamp(psx_lamp2, nw, v) + eye_lamp(psx_lamp3, nw, v) + eye_lamp(psx_lamp4, nw, v) + eye_lamp(psx_lamp5, nw, v));
        if (layered_pictures) EMISSION += eye * psx_hemi_sky.rgb * pow(max(dot(nw, normalize(v + vec3(-0.3, 0.8, 0.4))), 0.0), 100.0) * 0.18;
    }
    ROUGHNESS = surface_roughness;
    FOG = vec4(psx_fog_color.rgb + halo, fog_k);
}
void light() {
    float a = ATTENUATION;
    if (LIGHT_IS_DIRECTIONAL) a *= sun_lit;
    // Warm wrap fills the terminator without adding lights or brightening the whole scene.
    float ndl = dot(NORMAL, LIGHT);
    float wrap = max((ndl + 0.35) / 1.35, 0.0);
    vec3 tint = mix(vec3(1.0), vec3(1.0, 0.86, 0.76), clamp(wrap - max(ndl, 0.0), 0.0, 1.0));
    // Psx convention: LIGHT_COLOR includes pi; Godot converts the lights' sRGB colours.
    DIFFUSE_LIGHT += wrap * tint * a * LIGHT_COLOR / PI;
    vec3 hv = normalize(LIGHT + VIEW);
    float power = layered_pictures ? mix(8.0, 150.0, pow(1.0 - surface_roughness, 2.0)) : mix(18.0, 150.0, eye);
    float strength = layered_pictures ? mix(0.012, 0.24, pow(1.0 - surface_roughness, 2.0)) : 0.035;
    strength = mix(strength, 0.6, eye);
    SPECULAR_LIGHT += pow(max(dot(NORMAL, hv), 0.0), power) * strength * max(ndl, 0.0) * a * LIGHT_COLOR / PI;
}
