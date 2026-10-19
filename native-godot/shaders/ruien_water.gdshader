// The Ruien's water (World/Ruien, docs/ruien-native.md): murky brown-green sewage, dark where it is deep and showing
// the silt only in the shallows, fine ripples that drift with the flow, drip rings under the seeps, a dull skin of
// scum in patches, and the vault, the lamps and the daylight of the grates mirrored in it (screen-space, with the
// lamps' own glints when the picture has no hit). One kind for every water surface underground, and the thin films
// that run down the walls (`film`).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_always, cull_disabled, fog_disabled, specular_disabled, ambient_light_disabled;
#include "res://shaders/ruien_common.gdshaderinc"

global uniform sampler2D psx_wave_n : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap, repeat_disable;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest, repeat_disable;
// the silt in the water, lit (its own colour), and how fast each colour is lost per metre of water
uniform vec3 murk : source_color = vec3(0.03, 0.026, 0.015);
uniform vec3 absorb = vec3(2.2, 2.6, 3.4);
// the way it flows (m/s, world x and z): the ripples and the scum drift with it
uniform vec2 flow = vec2(0.0, 0.0);
uniform float scum = 0.6;
uniform float drips = 1.0;
uniform float ripple = 1.0;
// a film running down the stone (a dribble): see-through, its own alpha
uniform float film = 0.0;
uniform float film_alpha = 0.45;

varying vec3 world;
varying float fog_depth;

void vertex() {
	vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -view.z;
	world = (INV_VIEW_MATRIX * view).xyz;
}

float lin_depth(vec2 uv, mat4 invp) {
	float z = textureLod(depth_tex, uv, 0.0).r;
	vec4 v = invp * vec4(uv * 2.0 - 1.0, z, 1.0);
	return -v.z / v.w;
}

// one drop's ring: cells of 1.7 m, a few of them under a drip, a drop every few seconds at its own place
vec2 drip_rings(vec2 p, float t) {
	vec2 s = vec2(0.0);
	for (int k = 0; k < 2; k++) {
		float cs = 1.7 - 0.6 * float(k);
		vec2 g = p / cs + float(k) * vec2(0.37, 0.71);
		vec2 id = floor(g);
		float h = ruien_h12(id + float(k) * 17.0);
		if (h > 0.3 * drips) continue;
		float period = 2.5 + 5.0 * fract(h * 13.7);
		float ph = fract(t / period + h * 7.0);
		vec2 c = (vec2(fract(h * 37.1), fract(h * 91.7)) - 0.5) * 0.6;
		vec2 q = (fract(g) - 0.5 - c) * cs;
		float d = max(length(q), 1e-3);
		float r = ph * 0.55;
		float x = d - r;
		float lam = 0.05 + 0.04 * ph;
		float e = exp(-x * x / (lam * lam));
		float a = 0.012 * (1.0 - ph) * (1.0 - ph);
		s += a * sin(6.283 * x / lam) * e * q / d / lam;
	}
	return s;
}

void fragment() {
	vec3 to_frag = world - CAMERA_POSITION_WORLD;
	float len = length(to_frag);
	vec3 rd = to_frag / max(len, 1e-4);
	vec3 V = -rd;
	float covered = ruien_covered(world);
	float t = psx_time;
	// ripples: the town's wave picture at small scales, drifting with the flow; far off they melt
	vec2 p = world.xz;
	vec2 a = vec2(0.921 * p.x - 0.391 * p.y, 0.391 * p.x + 0.921 * p.y) / 1.6 - flow * t / 1.6 + t * vec2(0.004, 0.003);
	vec2 b = vec2(0.485 * p.x + 0.875 * p.y, -0.875 * p.x + 0.485 * p.y) / 0.55 - flow * t / 0.55 + t * vec2(-0.011, 0.009);
	vec2 sl = (texture(psx_wave_n, a).rg * 2.0 - 1.0) * 0.03 + (texture(psx_wave_n, b).rg * 2.0 - 1.0) * 0.012;
	sl *= ripple * (1.0 - smoothstep(12.0, 30.0, len));
	if (drips > 0.0) sl += drip_rings(p, t) * (1.0 - smoothstep(8.0, 20.0, len));
	vec3 n = normalize(vec3(-sl.x, 1.0, -sl.y));
	if (!FRONT_FACING && film < 0.5) n = -n;
	float cos_v = clamp(dot(n, V), 0.0, 1.0);
	float fres = 0.02 + 0.98 * pow(1.0 - cos_v, 5.0);

	// what lies under it, through the murk
	float surf_d = fog_depth;
	float scene_d = lin_depth(SCREEN_UV, INV_PROJECTION_MATRIX);
	float thick = max(scene_d - surf_d, 0.0) * mix(1.0, max(-rd.y, 0.15), 0.6);
	vec2 ruv = SCREEN_UV + sl * 0.15 * (1.0 - smoothstep(0.0, 3.0, thick) * 0.5);
	if (lin_depth(ruv, INV_PROJECTION_MATRIX) < surf_d) ruv = SCREEN_UV;
	vec3 below = textureLod(screen_tex, ruv, 0.0).rgb;
	vec3 tr = exp(-absorb * thick);
	vec3 diff, spec;
	ruien_lights_at(world, vec3(0.0, 1.0, 0.0), V, 0.0, 0.0, diff, spec);
	vec3 sky = mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, 0.75) * (1.0 - covered);
	vec3 lit = diff + sky + ruien_fill.rgb * covered;
	vec3 col = below * tr + murk * lit * (1.0 - tr);
	// scum: a dull, lighter skin in drifting patches, thickest in still corners
	if (scum > 0.0) {
		vec2 sp = p * 0.7 - flow * t * 0.7;
		float sk = smoothstep(0.55, 0.75, ruien_noise(sp) * 0.65 + ruien_noise(sp * 3.3 + 7.7) * 0.35) * scum;
		sk *= 0.6 + 0.4 * ruien_noise(sp * 11.0);
		col = mix(col, vec3(0.07, 0.06, 0.035) * lit, sk * 0.6);
		fres *= 1.0 - sk * 0.45;
	}

	// the mirror: march the reflected ray in the view and take the picture where it meets something
	vec3 vpos = VERTEX;
	vec3 nv = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	vec3 rv = normalize(reflect(normalize(vpos), nv));
	vec3 refl = vec3(0.0);
	float hit = 0.0;
	if (len < 45.0) {
		float step_l = 0.12;
		vec3 q = vpos;
		for (int i = 0; i < 28; i++) {
			q += rv * step_l;
			step_l *= 1.16;
			vec4 cp = PROJECTION_MATRIX * vec4(q, 1.0);
			vec2 uv = cp.xy / cp.w * 0.5 + 0.5;
			if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || q.z > -0.05) break;
			float sd = lin_depth(uv, INV_PROJECTION_MATRIX);
			float qd = -q.z;
			if (qd > sd + 0.02 && qd < sd + 0.35 + step_l * 1.5) {
				vec2 edge = smoothstep(0.0, 0.08, uv) * smoothstep(1.0, 0.92, uv);
				refl = textureLod(screen_tex, uv, 0.5).rgb;
				hit = edge.x * edge.y * (1.0 - float(i) / 28.0 * 0.4);
				break;
			}
		}
	}
	// where the picture has nothing: the dark air of the vault, the street's sky in the open
	vec3 miss = mix(psx_fog_color.rgb * 0.6, ruien_air.rgb * 0.3, covered);
	refl = mix(miss, refl, hit);
	// the lamps' and the openings' glints on the ripples
	vec3 d2, glint;
	ruien_lights_at(world, n, V, 0.93, 0.0, d2, glint);
	// the lamps drawn out into bright broken streaks by the ripples (D3 style), and their glints
	vec3 rr = reflect(rd, n);
	vec3 streak = ruien_streaks(world, rr, 1.0 + 3.0 * ripple) * (0.55 + 0.45 * smoothstep(0.35, 0.75, ruien_noise(p * 3.1 + t * 0.4)));
	col = mix(col, refl, fres) + glint * (1.0 - hit * 0.6) + streak * (0.25 + 0.75 * fres) * 0.6;

	vec4 fog = ruien_fog(fog_depth, covered);
	vec3 halo = ruien_haze(CAMERA_POSITION_WORLD, rd, len);
	col = mix(col, fog.rgb, fog.a) + halo;
	ALBEDO = col;
	ALPHA = film > 0.5 ? film_alpha * (0.6 + 0.4 * fres) : 1.0;
}
