shader_type spatial;
global uniform float psx_wet;
uniform sampler2DArray environment_roof_colour : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray environment_roof_height : filter_linear_mipmap, repeat_enable;

render_mode specular_disabled, ambient_light_disabled, cull_disabled;

float psx_h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float psx_h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float psx_h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

global uniform vec2 psx_snap_res;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
global uniform vec4 psx_hemi_sky;
global uniform vec4 psx_hemi_ground;
global uniform float psx_time;
global uniform sampler2D psx_dirt : filter_linear, repeat_disable;
global uniform vec4 psx_dirt_box;
global uniform vec4 psx_mir0;
global uniform vec4 psx_mir1;
uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform vec3 emission : source_color = vec3(0.0);
uniform sampler2D emission_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
// 1: its emission is the sky's fill light (baked at midday): it follows the sky and the model's vertex colour
uniform float fill = 0.0;
global uniform vec4 psx_fill;
uniform float affine = 1.0;
uniform float fog_reach = 1.0;
uniform float alpha_cut = 0.5;
uniform vec4 uv_xform = vec4(1.0, 1.0, 0.0, 0.0);
// the browser's polygonOffset (a layer on a surface: ruts, the railway's setts, edge stones, bills, grime, litter):
// drawn this share of its distance nearer the eye, along the line of sight, so it lands on the same pixels and wins
// the depth test without a gap (BakedWorld.cs reads it from the bake)
uniform float depth_bias = 0.0;
varying float fog_depth;
varying vec3 world;
varying float sun_lit;
varying vec2 cell;

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

global uniform sampler2D psx_spill : filter_nearest, repeat_disable;
global uniform int psx_spill_n;
// a gas lamp's light stops under its cap (issue #11): its decay (1.7) tells it apart. Under the cap its slanted glass
// and the cap's white underside throw it down and out (the look survey's point 18): the paving under it takes a pool,
// a wall level with the flame less than half (psx.ts psxLampCap, the same numbers)
float psx_lamp_cap(float decay, float up) {
	return abs(decay - 1.7) < 0.001 ? (1.0 - smoothstep(0.5, 0.8, up)) * (0.42 + 2.2 * smoothstep(-0.05, 0.75, -up)) : 1.0;
}
// and no hot spot on a wall right by the flame (its frame and burner shade the nearest stone): a soft core, added to
// the fall-off's d^1.7 (psx.ts PSX_LAMP_CORE)
float psx_lamp_core(float decay) {
	return abs(decay - 1.7) < 0.001 ? 0.6 : 0.0;
}
// the spilt light on the ground is uneven (survey 18): worn hollows and damp stone take more of it, dirt and dry crowns
// less, so a pool is never a clean disc; walls take it evenly (psx.ts psxPoolTone)
float psx_pool_h(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float psx_pool_n(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(psx_pool_h(i), psx_pool_h(i + vec2(1.0, 0.0)), f.x), mix(psx_pool_h(i + vec2(0.0, 1.0)), psx_pool_h(i + vec2(1.0, 1.0)), f.x), f.y);
}
float psx_pool_tone(vec3 P, vec3 N) {
	float g = smoothstep(0.55, 0.9, N.y);
	if (g <= 0.0) return 1.0;
	float n = 0.62 * psx_pool_n(P.xz / 2.6) + 0.38 * psx_pool_n(P.xz / 0.95 + 17.3);
	return 1.0 + g * (n - 0.5) * 1.3;
}
vec3 spill_one(vec3 P, vec3 N, vec4 A, vec4 B, vec4 C, vec4 D) {
	vec3 d = P - A.xyz;
	float dd = dot(d, d);
	float r2 = D.x * D.x;
	if (dd >= r2) return vec3(0.0);
	float q = dd / r2;
	float fade = (1.0 - q * q);
	fade *= fade;
	vec3 n = vec3(B.x, 0.0, B.y);
	if (dot(n, n) < 0.01) {
		// a lamp or a lantern: a point light
		float dl = sqrt(dd);
		float cr = max(dot(N, -d / max(dl, 1e-4)), 0.0);
		return C.rgb * (A.w * cr * fade * psx_lamp_cap(D.y, d.y / max(dl, 1e-4)) / (pow(max(dl, 0.05), D.y) + D.w + psx_lamp_core(D.y)));
	}
	float o = dot(d, n);
	if (o < -0.08) return vec3(0.0);
	vec3 u = vec3(-n.z, 0.0, n.x);
	float s = dot(d, u);
	// the nearest point of the opening, and its middle
	vec3 e = vec3(clamp(s, -B.z, B.z), clamp(d.y, -B.w, B.w), 0.0);
	vec3 L1 = u * e.x + vec3(0.0, e.y, 0.0) - d;
	float l1 = length(L1);
	vec3 L2 = -d;
	float l2 = sqrt(dd);
	L1 /= max(l1, 1e-4);
	L2 /= max(l2, 1e-4);
	// the lobe out of the opening; the ground under it takes some light even straight below the sill
	float under = 0.45 * clamp(N.y, 0.0, 1.0) * (1.0 - smoothstep(B.z, B.z + 0.6 + 0.5 * max(o, 0.0), abs(s)));
	float lobe = (under + (1.0 - under) * max(dot(-L1, n), 0.0)) * smoothstep(-0.08, 0.1, o);
	float cr = 0.5 * (max(dot(N, L1), 0.0) + max(dot(N, L2), 0.0));
	float fall = 0.5 * (1.0 / (pow(l1 * l1, D.y * 0.5) + D.w) + 1.0 / (pow(l2 * l2, D.y * 0.5) + D.w));
	// the opening's shape thrown by the lamp inside (D.z behind the glass), its bars, soft with the distance out
	float pat = 1.0;
	if (D.z > 0.0) {
		vec3 lamp = vec3(0.0, B.w * 0.35, 0.0) - n * D.z;
		vec3 rel = d - lamp;
		float oo = max(o, 0.0);
		float k = D.z / max(D.z + o, 0.05);
		vec3 w = lamp + rel * k;
		float ws = dot(w, u) / B.z;
		float wt = w.y / B.w;
		float pw = 0.1 + 0.9 * oo / (D.z + oo);
		float sw_s = pw / B.z;
		float sw_t = pw / B.w;
		float m = (1.0 - smoothstep(1.0 - sw_s, 1.0 + sw_s, abs(ws))) * (1.0 - smoothstep(1.0 - sw_t, 1.0 + sw_t, abs(wt)));
		if (C.w > 0.5) {
			float cols = floor(C.w / 10.0 + 0.01);
			float rows = C.w - cols * 10.0;
			float fx = (ws * 0.5 + 0.5) * cols;
			float fy = (wt * 0.5 + 0.5) * rows;
			float bx = 0.0;
			float by = 0.0;
			if (cols > 1.5) {
				float pb = 0.06 + pw * cols / (2.0 * B.z);
				bx = 1.0 - smoothstep(0.03, 0.03 + pb, abs(fx - clamp(floor(fx + 0.5), 1.0, cols - 1.0)));
			}
			if (rows > 1.5) {
				float pb = 0.06 + pw * rows / (2.0 * B.w);
				by = 1.0 - smoothstep(0.03, 0.03 + pb, abs(fy - clamp(floor(fy + 0.5), 1.0, rows - 1.0)));
			}
			m *= 1.0 - 0.4 * max(bx, by) * (1.0 - smoothstep(0.6, 2.5, oo));
		}
		pat = 0.5 + 0.5 * m;
	}
	return C.rgb * (A.w * lobe * cr * fall * fade * pat);
}
vec3 psx_spill_at(vec3 P, vec3 N) {
	vec3 sum = vec3(0.0);
	for (int i = 0; i < psx_spill_n; i++) {
		vec4 A = texelFetch(psx_spill, ivec2(i, 0), 0);
		vec4 D = texelFetch(psx_spill, ivec2(i, 3), 0);
		vec3 d = P - A.xyz;
		if (dot(d, d) >= D.x * D.x) continue;
		sum += spill_one(P, N, A, texelFetch(psx_spill, ivec2(i, 1), 0), texelFetch(psx_spill, ivec2(i, 2), 0), D);
	}
	return sum * psx_pool_tone(P, N);
}

uniform sampler2D bump_map : filter_linear_mipmap, repeat_enable;
uniform float bump_scale = 1.0;
float psx_bump_gain(vec2 dx, vec2 dy, vec2 size, float res) {
	float tpp = max(length(dx * size), length(dy * size)) * res;
	return mix(2.5, 1.0, smoothstep(2.0, 8.0, tpp));
}
vec2 bump_dh(vec2 raw, vec2 cl, float res) {
	vec2 dx = dFdx(raw);
	vec2 dy = dFdy(raw);
	vec2 gx = dx / 2.0;
	vec2 gy = dy / 2.0;
	float hll = bump_scale * textureGrad(environment_roof_height, vec3(raw, cl.x + cl.y * 2.0), dx, dy).x;
	float dbx = bump_scale * textureGrad(environment_roof_height, vec3(raw + dx, cl.x + cl.y * 2.0), dx, dy).x - hll;
	float dby = bump_scale * textureGrad(environment_roof_height, vec3(raw + dy, cl.x + cl.y * 2.0), dx, dy).x - hll;
	return vec2(dbx, dby) * res * psx_bump_gain(gx, gy, vec2(textureSize(bump_map, 0)), res);
}
vec3 bump_normal(vec3 surf_pos, vec3 surf_norm, vec2 dh) {
	vec3 sx = normalize(dFdx(surf_pos));
	vec3 sy = normalize(dFdy(surf_pos));
	vec3 r1 = cross(sy, surf_norm);
	vec3 r2 = cross(surf_norm, sx);
	float det = dot(sx, r1);
	vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
	return normalize(abs(det) * surf_norm - grad);
}

void vertex() {
	vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -view.z;
	world = (INV_VIEW_MATRIX * view).xyz;
	POSITION = PROJECTION_MATRIX * vec4(view.xyz * (1.0 - depth_bias), 1.0);
	// snap only past arm's length: up close the jitter just looks broken
	if (psx_snap_res.x < 5e4) {
		vec2 ndc = POSITION.xy / POSITION.w;
		vec2 snapped = floor(ndc * psx_snap_res + 0.5) / psx_snap_res;
		POSITION.xy = mix(ndc, snapped, smoothstep(1.5, 4.0, POSITION.w)) * POSITION.w;
	}
	cell = UV2;
	UV = UV * uv_xform.xy + uv_xform.zw;
}

void fragment() {
	// in a mirror's picture (its camera: World/Mirrors.cs) nothing under the mirror's plane is drawn
	if ((world.y < psx_mir0.w - 0.02 && distance(CAMERA_POSITION_WORLD, psx_mir0.xyz) < 0.02) || (world.y < psx_mir1.w - 0.02 && distance(CAMERA_POSITION_WORLD, psx_mir1.xyz) < 0.02)) discard;
	vec3 to_frag = world - CAMERA_POSITION_WORLD;
	float len = length(to_frag);
	vec3 rd = to_frag / max(len, 1e-4);
	vec3 fogc = psx_fog_color.rgb;
	// what the lit colour is multiplied by, and what is added to it, before the fog (see the class comment)
	vec3 k3 = vec3(1.0);
	vec3 ad = vec3(0.0);
	// (Steve, 2026-10-11: no PS1 look: textures stay true on their faces, no affine warp)
	vec2 uv = UV;
	vec2 raw_uv = uv;
	uv = (cell + fract(uv)) / 2.0;
	vec4 c = texture(environment_roof_colour, vec3(raw_uv, cell.x + cell.y * 2.0));
                if(cell.x > 0.5 && cell.y < 0.5) {
                    float course=floor(raw_uv.y*8.0);
                    float tile=floor(raw_uv.x*6.0 - mod(course,2.0)*0.5);
                    float tone=mix(0.78,1.18,psx_h11(tile*17.137+course*113.91));
                    float soot=0.94+0.06*sin(world.x*0.47+sin(world.z*0.29))*sin(world.z*0.31+world.y*0.23);
                    c.rgb *= vec3(0.48,0.53,0.61)*tone*soot;
                }
                c.rgb *= 1.0-0.28*clamp(psx_wet,0.0,1.0);
	c *= albedo;
	c.rgb *= COLOR.rgb;
	vec3 n_flat = NORMAL;
	NORMAL = bump_normal(VERTEX, NORMAL, bump_dh(raw_uv, cell, VIEWPORT_SIZE.y / 270.0));
	float bump_k = 1.0;
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	// the sky's light: its own colour from above, the ground's from below (three's HemisphereLight), less of it in
	// a narrow street; the sun waits for light(), kept off by the houses
	vec3 sky = mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, nw.y * 0.5 + 0.5) * bump_k * psx_sky_seen(world, nw);
	sun_lit = psx_sun_shadow(world, nw);
	// the light spilt from lamps, lit windows and doors (world/spill.ts), as point lights would give it
	vec3 spilt = psx_spill_n > 0 ? psx_spill_at(world, nw) / PI : vec3(0.0);
	float fog_k = smoothstep(psx_fog_near, psx_fog_far * fog_reach, fog_depth);
	// the lamps' glow in the air between the eye and the surface
	vec3 halo = psx_lamp_color.rgb * psx_glow(CAMERA_POSITION_WORLD, rd, glow_reach(len, psx_fog_far, rd)) * psx_scatter * (0.35 + 0.65 * fog_k);
	ALBEDO = c.rgb * k3;
	EMISSION = (emission * texture(emission_tex, uv).rgb * mix(vec3(1.0), psx_fill.rgb * COLOR.rgb, fill) + c.rgb * (sky + spilt)) * k3 + ad + halo;
	FOG = vec4(fogc + halo, fog_k);
}

void light() {
	// three's matt face: colour x light x cos / pi (LIGHT_COLOR comes times pi); the sun kept off by the houses
	float a = ATTENUATION;
	if (LIGHT_IS_DIRECTIONAL) a *= sun_lit;
	DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR / PI;
}
