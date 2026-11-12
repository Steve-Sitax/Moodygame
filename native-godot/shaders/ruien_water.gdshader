// The Ruien's water (World/Ruien, docs/ruien-native.md): murky brown-green sewage, dark where it is deep and showing
// the silt only in the shallows, fine ripples that drift with the flow, drip rings under the seeps, a dull skin of
// scum in patches, and the vault, the lamps and the daylight of the grates mirrored in it (screen-space, with the
// lamps' own glints when the picture has no hit). One kind for every water surface underground, and the thin films
// that run down the walls (`film`).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, specular_disabled, ambient_light_disabled;
#include "res://shaders/ruien_common.gdshaderinc"

global uniform sampler2D psx_wave_n : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap, repeat_disable;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest, repeat_disable;
// the silt in the water, lit (its own colour), and how fast each colour is lost per metre of water
uniform vec3 murk : source_color = vec3(0.03, 0.026, 0.015);
uniform vec3 absorb = vec3(2.2, 2.6, 3.4);
// the way it flows (m/s, world x and z): the ripples and the scum drift with it
uniform vec2 flow = vec2(0.0, 0.0);
// Curved sheets supply their local current in UV2, in world x/z metres per second.
uniform float flow_vertices = 0.0;
uniform float scum = 0.6;
uniform float drips = 1.0;
uniform float ripple = 1.0;
// a film running down the stone (a dribble): see-through, its own alpha
uniform float film = 0.0;
uniform float film_alpha = 0.45;
uniform float outfall = 0.0;
uniform vec2 outfall_origin = vec2(0.0);
uniform vec2 outfall_direction = vec2(0.0, -1.0);
uniform float outfall_drop = 0.0;

varying vec3 world;
varying float fog_depth;
varying vec2 local_flow;

void vertex() {
	local_flow = UV2;
	if (outfall > 0.5) {
		vec2 plan = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz;
		float u = dot(plan - outfall_origin, outfall_direction);
		VERTEX.y += outfall_drop * smoothstep(-1.6, 2.0, u);
	}
	vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -view.z;
	world = (INV_VIEW_MATRIX * view).xyz;
}

float lin_depth(vec2 uv, mat4 invp) {
	float z = textureLod(depth_tex, uv, 0.0).r;
	vec4 v = invp * vec4(uv * 2.0 - 1.0, z, 1.0);
	return -v.z / v.w;
}

// Sample neighbouring cells too: a ring must not stop at an invisible grid boundary.
vec2 drip_rings(vec2 p, float t, float amount) {
	vec2 s = vec2(0.0);
	vec2 cell = floor(p / 1.6);
	for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		vec2 id = cell + vec2(float(x), float(y));
		float h = ruien_h12(id);
		if (h > min(0.85, amount * 0.32)) continue;
		float period = 3.0 + 4.0 * fract(h * 13.7);
		float age = mod(t + h * period * 7.0, period) / 1.8;
		if (age >= 1.0) continue;
		vec2 c = (id + vec2(0.25) + vec2(fract(h * 37.1), fract(h * 91.7)) * 0.5) * 1.6;
		vec2 q = p - c;
		float d = max(length(q), 1e-3);
		float ring = d - age * 0.65;
		float width = 0.035 + age * 0.035;
		float envelope = exp(-ring * ring / (width * width));
		s += q / d * sin(ring * 90.0) * envelope * 0.045 * (1.0 - age) * (1.0 - age);
	}
	return s;
}

vec2 water_slope(vec2 p) {
	vec2 a = vec2(0.921 * p.x - 0.391 * p.y, 0.391 * p.x + 0.921 * p.y) / 1.25;
	vec2 b = vec2(0.485 * p.x + 0.875 * p.y, -0.875 * p.x + 0.485 * p.y) / 0.38;
	vec2 na = texture(psx_wave_n, a).rg * 2.0 - 1.0;
	vec2 nb = texture(psx_wave_n, b).rg * 2.0 - 1.0;
	vec2 nc = texture(psx_wave_n, p / 0.12).rg * 2.0 - 1.0;
	// Rotate the sampled slopes back into world axes as well as rotating the texture coordinates.
	return vec2(0.921 * na.x + 0.391 * na.y, -0.391 * na.x + 0.921 * na.y) * 0.035
		+ vec2(0.485 * nb.x - 0.875 * nb.y, 0.875 * nb.x + 0.485 * nb.y) * 0.017 + nc * 0.006;
}

vec2 current_ripples(vec2 p, vec2 velocity, float t) {
	// Two overlapping advection phases prevent a varying current from stretching the
	// texture indefinitely around a bend. Each phase resets only while it is invisible.
	float phase = fract(t / 5.0);
	float other = fract(phase + 0.5);
	float weight = 1.0 - abs(phase * 2.0 - 1.0);
	vec2 oscillation = vec2(sin(t * 0.73), sin(t * 0.91 + 1.7)) * 0.008;
	vec2 a = water_slope(p - velocity * phase * 5.0 + oscillation);
	vec2 b = water_slope(p - velocity * other * 5.0 + oscillation);
	return mix(b, a, weight);
}

float skin_noise(vec2 p) {
	vec2 sp = p * 0.8;
	sp += vec2(ruien_noise(sp * 0.4), ruien_noise(sp * 0.4 + 9.3)) * 0.6;
	return ruien_noise(sp) * 0.5 + ruien_noise(sp * 3.3 + 7.7) * 0.3 + ruien_noise(sp * 9.0) * 0.2;
}

float current_skin(vec2 p, vec2 velocity, float t) {
	float phase = fract(t / 20.0);
	float other = fract(phase + 0.5);
	float weight = 1.0 - abs(phase * 2.0 - 1.0);
	return mix(skin_noise(p - velocity * other * 20.0), skin_noise(p - velocity * phase * 20.0), weight);
}

float current_variation(vec2 p, vec2 velocity, float t) {
	float phase = fract(t / 5.0);
	float other = fract(phase + 0.5);
	float weight = 1.0 - abs(phase * 2.0 - 1.0);
	return mix(ruien_noise((p - velocity * other * 5.0) * 3.1), ruien_noise((p - velocity * phase * 5.0) * 3.1), weight);
}

void fragment() {
	vec3 to_frag = world - CAMERA_POSITION_WORLD;
	float len = length(to_frag);
	vec3 rd = to_frag / max(len, 1e-4);
	vec3 V = -rd;
	float covered = ruien_covered(world);
	float t = psx_time;
	vec2 p = world.xz;
	vec2 velocity = flow_vertices > 0.5 ? local_flow : flow;
	vec2 fall_slope = vec2(0.0);
	if (outfall > 0.5) {
		float drop = max(-outfall_drop, 0.0);
		float flowing = smoothstep(0.015, 0.12, drop);
		velocity = outfall_direction * (0.12 + sqrt(drop * 9.81) * 0.20) * flowing;
		float u = clamp((dot(p - outfall_origin, outfall_direction) + 1.6) / 3.6, 0.0, 1.0);
		fall_slope = outfall_direction * outfall_drop * 6.0 * u * (1.0 - u) / 3.6;
	}
	float activity = smoothstep(0.0, 0.18, length(velocity));
	float rain_here = psx_rain * (1.0 - covered);
	vec2 sl = current_ripples(p, velocity, t) * ripple * mix(0.8, 2.7, activity);
	sl *= 1.0 - smoothstep(14.0, 38.0, len);
	if (drips + rain_here > 0.0) sl += drip_rings(p, t, drips + rain_here * 1.8) * (1.0 - smoothstep(8.0, 22.0, len));
	sl += fall_slope;
	vec3 n = normalize(vec3(-sl.x, 1.0, -sl.y));
	if (film > 0.5) {
		// A film follows its real wall/invert normal; it is not a horizontal pool with depth absorption.
		n = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
		if (!FRONT_FACING) n = -n;
		vec3 diffuse, shine;
		ruien_lights_at(world, n, V, 0.88, 0.0, diffuse, shine);
		float rivulet = 0.65 + 0.35 * sin(world.y * 45.0 + world.x * 13.0 + world.z * 17.0 + t * 7.0);
		ALBEDO = murk * diffuse * 0.15 + shine * rivulet;
		ALPHA = film_alpha * (0.18 + 0.5 * pow(1.0 - abs(dot(n, V)), 3.0));
	} else {
	// Imported and generated sheets can have opposite winding; the visible side follows the eye.
	if (CAMERA_POSITION_WORLD.y < world.y) n = -n;
	float cos_v = clamp(dot(n, V), 0.0, 1.0);
	float fres = 0.02 + 0.98 * pow(1.0 - cos_v, 5.0);

	// what lies under it, through the murk
	float surf_d = fog_depth;
	float scene_d = lin_depth(SCREEN_UV, INV_PROJECTION_MATRIX);
	float thick = max(scene_d - surf_d, 0.0) / max(-normalize(VERTEX).z, 0.15);
	vec2 view_slope = (VIEW_MATRIX * vec4(sl.x, 0.0, sl.y, 0.0)).xy;
	vec2 ruv = SCREEN_UV + view_slope * 0.045 / max(cos_v, 0.25) * smoothstep(0.0, 0.08, thick);
	ruv = clamp(ruv, vec2(0.001), vec2(0.999));
	float submerged = smoothstep(0.01, 0.10, lin_depth(ruv, INV_PROJECTION_MATRIX) - surf_d);
	ruv = mix(SCREEN_UV, ruv, submerged);
	vec3 below = textureLod(screen_tex, ruv, 0.0).rgb;
	vec3 tr = exp(-absorb * thick);
	vec3 diff, spec;
	ruien_lights_at(world, vec3(0.0, 1.0, 0.0), V, 0.0, 0.0, diff, spec);
	vec3 sky = mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, 0.75) * (1.0 - covered);
	vec3 lit = diff + sky + ruien_fill.rgb * covered;
	vec3 col = below * tr + murk * lit * (1.0 - tr);
	// scum: a dull, lighter skin in drifting patches, thickest in still corners
	if (scum > 0.0) {
		float sk = smoothstep(0.65, 0.83, current_skin(p, velocity * 0.35, t)) * scum;
		col = mix(col, vec3(0.045, 0.043, 0.025) * lit, sk * 0.32);
		fres *= 1.0 - sk * 0.4;
	}

	// the mirror: march the reflected ray in the view and take the picture where it meets something
	vec3 vpos = VERTEX;
	vec3 nv = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	vec3 rv = normalize(reflect(normalize(vpos), nv));
	vec3 refl = vec3(0.0);
	float hit = 0.0;
	if (len < 45.0) {
		float step_l = 0.075;
		vec3 q = vpos + nv * 0.015;
		vec3 previous = q;
		float previous_delta = -1.0;
		for (int i = 0; i < 36; i++) {
			previous = q;
			q += rv * step_l;
			step_l *= 1.14;
			vec4 cp = PROJECTION_MATRIX * vec4(q, 1.0);
			vec2 uv = cp.xy / cp.w * 0.5 + 0.5;
			if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || q.z > -0.05) break;
			float sd = lin_depth(uv, INV_PROJECTION_MATRIX);
			float qd = -q.z;
			float delta = qd - sd;
			if (i > 1 && previous_delta < 0.0 && delta >= 0.0) {
				vec3 lo = previous, hi = q;
				for (int refine = 0; refine < 5; refine++) {
					vec3 middle = (lo + hi) * 0.5;
					vec4 projected = PROJECTION_MATRIX * vec4(middle, 1.0);
					vec2 sample_uv = projected.xy / projected.w * 0.5 + 0.5;
					if (-middle.z > lin_depth(sample_uv, INV_PROJECTION_MATRIX)) hi = middle;
					else lo = middle;
				}
				vec4 projected = PROJECTION_MATRIX * vec4(hi, 1.0);
				uv = projected.xy / projected.w * 0.5 + 0.5;
				float error = abs(-hi.z - lin_depth(uv, INV_PROJECTION_MATRIX));
				vec4 source = INV_PROJECTION_MATRIX * vec4(uv * 2.0 - 1.0, textureLod(depth_tex, uv, 0.0).r, 1.0);
				float source_y = (INV_VIEW_MATRIX * vec4(source.xyz / source.w, 1.0)).y;
				float above = CAMERA_POSITION_WORLD.y >= world.y ? smoothstep(0.0, 0.06, source_y - world.y) : 1.0;
				vec2 edge = smoothstep(vec2(0.0), vec2(0.09), uv) * (1.0 - smoothstep(vec2(0.91), vec2(1.0), uv));
				hit = edge.x * edge.y * above * (1.0 - smoothstep(0.015, 0.09, error));
				hit *= 1.0 - smoothstep(20.0, 38.0, length(hi - vpos));
				refl = textureLod(screen_tex, uv, 0.7 + activity * 0.6).rgb;
				if (hit > 0.001) break;
			}
			previous_delta = delta;
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
	vec3 streak = ruien_streaks(world, rr, 1.0 + 3.0 * ripple) * (0.55 + 0.45 * smoothstep(0.35, 0.75, current_variation(p, velocity, t)));
	col = mix(col, refl, fres) + glint * (1.0 - hit * 0.6) + streak * fres * 0.08;
	if (outfall > 0.5) {
		float u = dot(p - outfall_origin, outfall_direction);
		vec2 across = vec2(-outfall_direction.y, outfall_direction.x);
		vec2 bubbles = vec2(dot(p - velocity * t, across), dot(p - velocity * t, outfall_direction));
		float foam = smoothstep(0.62, 0.82, ruien_noise(bubbles * vec2(38.0, 24.0)) * 0.65 + ruien_noise(bubbles * 67.0 + 4.7) * 0.35);
		foam *= exp(-pow((u - 0.65) / 0.42, 2.0)) * smoothstep(0.025, 0.25, -outfall_drop) * 0.16;
		col = mix(col, vec3(0.12, 0.13, 0.105) * lit, foam);
	}

	vec4 fog = ruien_fog(fog_depth, covered);
	vec3 halo = ruien_haze(CAMERA_POSITION_WORLD, rd, len);
	col = mix(col, fog.rgb, fog.a) + halo;
	ALBEDO = col;
	ALPHA = film > 0.5 ? film_alpha * (0.6 + 0.4 * fres) : 1.0;
	}
}
