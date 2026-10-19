// The Ruien's air (World/Ruien, docs/ruien-native.md): what is in the air rather than on a surface, one kind for all
// of it, premultiplied so it can both add light and hide what is behind:
//   mode 0 a beam: daylight down a grate, a shaft or the stair's hatch, dusty, as bright as the day (`strength`);
//   mode 1 mist: the low rot mist over the water in a box, thickest at the surface, drifting, lit by the lamps;
//   mode 2 a glow: a flame or a lamp's glass (its mesh), self-lit, flickering with its lamp (`strength`).
// The beams and the mist are drawn on their box's far faces, and worked out along the eye's ray through the box up to
// what the depth says is behind, so the eye can stand inside them.
shader_type spatial;
render_mode unshaded, blend_premul_alpha, depth_draw_never, cull_front, fog_disabled, specular_disabled, ambient_light_disabled, shadows_disabled;
#include "res://shaders/ruien_common.gdshaderinc"

uniform sampler2D depth_tex : hint_depth_texture, filter_nearest, repeat_disable;
uniform int mode = 0;
uniform vec3 colour : source_color = vec3(1.0);
uniform float strength = 1.0;
// a beam: where it enters (the opening's middle), the way it goes, how long and how wide (the opening's half size)
uniform vec3 beam_from = vec3(0.0);
uniform vec3 beam_dir = vec3(0.0, -1.0, 0.0);
uniform float beam_len = 4.0;
uniform float beam_r = 0.35;
// mist: the box (world), how thick at the bottom, how fast it thins upward (m), how it drifts
uniform vec3 box_min = vec3(0.0);
uniform vec3 box_max = vec3(1.0);
uniform float density = 0.06;
uniform float thin_up = 0.25;
uniform vec2 drift = vec2(0.05, 0.02);

varying vec3 world;

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

float lin_depth(vec2 uv, mat4 invp) {
	float z = textureLod(depth_tex, uv, 0.0).r;
	vec4 v = invp * vec4(uv * 2.0 - 1.0, z, 1.0);
	return -v.z / v.w;
}

// the eye's ray through a box: from t0 to t1 (none when t1 < t0)
vec2 box_hit(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
	vec3 inv = 1.0 / (rd + vec3(1e-6));
	vec3 a = (lo - ro) * inv, b = (hi - ro) * inv;
	vec3 mn = min(a, b), mx = max(a, b);
	return vec2(max(max(mn.x, mn.y), max(mn.z, 0.0)), min(min(mx.x, mx.y), mx.z));
}

void fragment() {
	vec3 ro = CAMERA_POSITION_WORLD;
	vec3 to_frag = world - ro;
	float len = length(to_frag);
	vec3 rd = to_frag / max(len, 1e-4);
	// how far the eye sees along this ray before something solid (the depth is along the view's axis)
	float zlin = lin_depth(SCREEN_UV, INV_PROJECTION_MATRIX);
	vec3 fwd = -normalize((INV_VIEW_MATRIX * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
	float tmax = zlin / max(dot(rd, fwd), 1e-3);
	float covered = ruien_covered(world);
	vec4 fog = ruien_fog(min(len, tmax), covered);
	if (mode == 2) {
		// a flame or a lamp's glass: its own light, brighter where it faces the eye
		float face = 0.55 + 0.45 * abs(dot(normalize(cross(dFdx(world), dFdy(world))), rd));
		ALBEDO = colour * strength * face * (1.0 - fog.a);
		ALPHA = 0.0;
	} else if (mode == 0) {
		// the beam's column: its axis from beam_from along beam_dir; the ray's nearest pass and the stretch in it
		vec3 w = ro - beam_from;
		float b = dot(rd, beam_dir);
		float den = max(1.0 - b * b, 1e-4);
		float s_ray = (b * dot(w, beam_dir) - dot(w, rd)) / den;
		float s_ax = dot(w + rd * s_ray, beam_dir);
		float dist = length(w + rd * s_ray - beam_dir * s_ax);
		float r = beam_r * (1.0 + 0.12 * clamp(s_ax / beam_len, 0.0, 1.0) * beam_len);
		float half_chord = sqrt(max(r * r * 1.6 - dist * dist, 0.0)) / sqrt(den);
		float t0 = max(s_ray - half_chord, 0.0), t1 = min(s_ray + half_chord, tmax);
		float along = clamp(s_ax / beam_len, 0.0, 1.0);
		float inside = max(t1 - t0, 0.0);
		float prof = exp(-dist * dist / (r * r * 0.55));
		float ends = smoothstep(-0.1, 0.25, s_ax) * (1.0 - smoothstep(beam_len * 0.75, beam_len, s_ax));
		// dust: brighter specks and slow-turning motes along the stretch
		vec3 mid = ro + rd * (t0 + t1) * 0.5;
		float dust = 0.55 + 0.45 * ruien_noise3(mid * 2.3 + vec3(0.0, psx_time * 0.08, psx_time * 0.03)) + 0.35 * ruien_noise3(mid * 9.0 - psx_time * 0.2);
		float g = inside * prof * ends * (1.0 - 0.6 * along) * dust;
		ALBEDO = colour * strength * g * (1.0 - fog.a);
		ALPHA = 0.0;
	} else {
		// the rot mist: density falling off upward from the box's floor, broken into drifting wisps
		vec2 tb = box_hit(ro, rd, box_min, box_max);
		float t0 = tb.x, t1 = min(tb.y, tmax);
		if (t1 <= t0) discard;
		float acc = 0.0;
		vec3 light = vec3(0.0);
		float wsum = 0.0;
		const int N = 6;
		float dt = (t1 - t0) / float(N);
		for (int i = 0; i < N; i++) {
			vec3 q = ro + rd * (t0 + (float(i) + 0.5) * dt);
			float up = max(q.y - box_min.y, 0.0);
			vec2 dq = q.xz - drift * psx_time;
			float wisp = smoothstep(0.25, 0.85, ruien_noise(dq * 0.45) * 0.6 + ruien_noise(dq * 1.3 + 3.1) * 0.4 + 0.12 * sin(psx_time * 0.3 + q.x * 0.7));
			float edge = smoothstep(0.0, 1.2, min(min(q.x - box_min.x, box_max.x - q.x), min(q.z - box_min.z, box_max.z - q.z)) + 0.6);
			float ceiling_fade = 1.0 - smoothstep(box_max.y - 0.18, box_max.y, q.y);
			float dens = density * exp(-up / thin_up) * (0.25 + 0.75 * wisp) * edge * ceiling_fade;
			acc += dens * dt;
			if (i % 2 == 0) {
				// the light the mist takes here: the lamps and openings all round (no facing: wrap 1), the fill, the open sky
				vec3 d, s;
				ruien_lights_at(q, vec3(0.0, 1.0, 0.0), -rd, 0.0, 1.0, d, s);
				float cq = ruien_covered(q);
				// (a lamp close by lights the mist round it softly, never a white blot: its light rolled off)
				light += (d * 0.35 / (1.0 + dot(d, vec3(0.3))) + ruien_fill.rgb * cq + psx_hemi_sky.rgb * (1.0 - cq)) * (dens + 1e-4);
				wsum += dens + 1e-4;
			}
		}
		float a = 1.0 - exp(-acc);
		vec3 lit = colour * light / max(wsum, 1e-4);
		ALBEDO = mix(lit * a, fog.rgb * a, fog.a);
		ALPHA = a;
	}
}
