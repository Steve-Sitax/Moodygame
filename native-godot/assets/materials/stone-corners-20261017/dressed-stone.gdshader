shader_type spatial;
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
uniform float foot = 0.0;
uniform float foot_wear = 0.0;
uniform float mottle = 0.0;
uniform sampler2D slab_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D slab_h : filter_linear_mipmap, repeat_enable;
uniform float slab_tile = 2.6;
uniform float slab_ymax = 0.8;
uniform float slab_dome = 2.5;
// Issue #157, dressed stone (UV2.x > 0): the house's quoins, door and window stones, plinth and step as single
// blocks. UV2 = (face code, the stone's dice); CUSTOM0 = (how open to the falling rain, a second dice); COLOR.rgb =
// sky light baked against the new stone and the wall; COLOR.a = the house's wear. Codes: 1 tooled field,
// 2 margin with upright strokes, 3 margin with level strokes, 4 rubbed (returns, beds, arrises), 5 lime mortar;
// +10 Belgian blue stone. The picture is the 1.2 m blue-stone scan; light stone is ramped from its grain.
uniform sampler2D stone_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
global uniform float psx_wet;
varying vec4 dressed;

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

float pud_hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float pud_val(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(pud_hash(i), pud_hash(i + vec2(1.0, 0.0)), u.x), mix(pud_hash(i + vec2(0.0, 1.0)), pud_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// along the wall, in metres (the ground's xz on the wall's own line)
float psx_along(vec3 wp, vec3 n) {
	vec2 t = vec2(-n.z, n.x);
	float l = length(t);
	return l > 0.2 ? dot(wp.xz, t / l) : wp.x + wp.z;
}
float psx_fine(vec2 p, vec2 c, float r) { return 1.0 - smoothstep(r * 0.65, r, length(p - c)); }
vec3 psx_foot_dirt(vec3 c, float amount, vec3 wp, vec3 n) {
	float y = wp.y;
	if (y > 1.7 || y < -0.4 || amount <= 0.0) return c;
	float vert = 1.0 - smoothstep(0.45, 0.75, abs(n.y));
	if (vert <= 0.0) return c;
	float s = psx_along(wp, n);
	// the street before the wall: its grime and mud (world/dirt.ts), 0.5 m out from the face
	vec2 out2 = normalize(n.xz + 1e-5) * 0.5;
	float street = max(texture(psx_dirt, (wp.xz + out2 - psx_dirt_box.xy) / psx_dirt_box.zw).r, texture(psx_dirt, (wp.xz - out2 - psx_dirt_box.xy) / psx_dirt_box.zw).r);
	// the fine squares kept cleaner (the Grote Markt, the Handschoenmarkt, the cathedral's square, the Conscienceplein, the park's fronts)
	float fine = max(max(max(psx_fine(wp.xz, vec2(-254.0, 94.0), 48.0), psx_fine(wp.xz, vec2(-262.0, 132.0), 32.0)), max(psx_fine(wp.xz, vec2(-262.0, 175.0), 50.0), psx_fine(wp.xz, vec2(-116.0, 160.0), 30.0))), psx_fine(wp.xz, vec2(-300.0, 318.0), 45.0));
	float a = clamp(amount * (0.85 + 0.85 * street) * mix(1.0, 0.3, fine), 0.0, 1.35);
	// the damp's top: 0.5 m on a kept wall, 1.2 m on a foul one, ragged along the wall
	float top = mix(0.55, 1.4, clamp(a, 0.0, 1.0)) + 0.22 * (pud_val(vec2(s / 1.6, 3.1)) - 0.5) + 0.1 * (pud_val(vec2(s / 0.37, 7.7)) - 0.5);
	float damp = 1.0 - smoothstep(top - 0.2, top, y);
	// the tide line: salts left where the damp stops
	float tide = smoothstep(top - 0.16, top - 0.05, y) * (1.0 - smoothstep(top - 0.05, top, y));
	// splashed mud from the wheels and the feet, in clusters, thicker near the street
	float low = 1.0 - smoothstep(0.0, 0.55, y);
	float clus = smoothstep(0.35, 0.75, pud_val(vec2(s / 0.9, y / 0.5) + 41.3));
	float sp = pud_val(vec2(s, y) * vec2(8.0, 6.5) + 13.7) * 0.75 + pud_val(vec2(s, y) * vec2(19.0, 16.0) - 5.1) * 0.25;
	float splash = smoothstep(0.74 - 0.2 * low * a - 0.1 * clus, 0.79 - 0.2 * low * a - 0.1 * clus, sp) * clus * smoothstep(0.0, 0.1, top - y);
	// the kick of the street's own muck along the very bottom
	float muck = 1.0 - smoothstep(0.02, 0.2 + 0.18 * a + 0.12 * pud_val(vec2(s / 0.5, 1.3)), y);
	vec3 d = c;
	d *= mix(vec3(1.0), vec3(0.42, 0.4, 0.33), damp * (0.55 + 0.5 * a) * (0.75 + 0.25 * (1.0 - y / max(top, 0.1))));
	d *= mix(vec3(1.0), vec3(0.6, 0.58, 0.52), tide * a);
	d *= 1.0 + 0.22 * a * smoothstep(top - 0.02, top + 0.03, y) * (1.0 - smoothstep(top + 0.05, top + 0.16, y)) * step(0.45, pud_val(vec2(s / 0.6, 5.3)));
	d = mix(d, d * vec3(0.42, 0.36, 0.28), clamp(splash * (0.5 + 0.5 * a), 0.0, 1.0));
	d = mix(d, d * vec3(0.27, 0.23, 0.17), muck * (0.5 + 0.5 * a));
	return mix(c, d, vert);
}
vec3 psx_mottle(vec3 c, float k, vec3 wp, vec3 n) {
	float vert = 1.0 - smoothstep(0.45, 0.75, abs(n.y));
	if (vert <= 0.0 || k <= 0.0) return c;
	vec2 w = vec2(psx_along(wp, n), wp.y);
	float big = pud_val(w / 8.5 + 3.3) - 0.5;
	float mid = pud_val(w / 3.1 - 11.9) - 0.5;
	float small = pud_val(w / 1.3 + 27.1) - 0.5;
	vec3 t = vec3(1.0 + (big * 0.28 + mid * 0.18 + small * 0.08) * k);
	// warmer where it was patched, greyer and darker where the smoke settled
	t *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), smoothstep(0.12, 0.3, mid) * k);
	t *= mix(vec3(1.0), vec3(0.82, 0.8, 0.78), smoothstep(0.1, 0.35, big) * k * 0.8);
	return c * mix(vec3(1.0), t, vert);
}

uniform sampler2D grime_noise : filter_linear_mipmap, repeat_enable;
uniform sampler2DArray wall_arr : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2DArray wall_h : filter_linear_mipmap, repeat_enable;
uniform float wall_pics = 0.0;
uniform vec4 wall_hk[4];
uniform vec4 wall_bed[4];
varying vec2 gmat;
const float WALL_TILE[13] = float[13](2.1, 1.9, 2.2, 2.5, 1.7, 1.1, 1.2, 3.0, 2.5, 3.0, 3.0, 2.7, 3.2);
// the paints (build_city.py PAINTS): none; fresh cream, ochre, pale grey, pale green, pale pink, white; greys; old paint;
// slight tints for the unpainted pictures
const vec3 PAINT[20] = vec3[20](vec3(1.0, 1.0, 1.0), vec3(0.97, 0.92, 0.8), vec3(0.93, 0.8, 0.56), vec3(0.88, 0.88, 0.84), vec3(0.82, 0.88, 0.78),
	vec3(0.96, 0.84, 0.8), vec3(0.97, 0.96, 0.92), vec3(0.8, 0.8, 0.77), vec3(0.72, 0.73, 0.72), vec3(0.86, 0.85, 0.8), vec3(0.86, 0.8, 0.66),
	vec3(0.8, 0.7, 0.5), vec3(0.76, 0.76, 0.72), vec3(0.84, 0.78, 0.74), vec3(1.04, 0.99, 0.95), vec3(0.94, 0.94, 0.96), vec3(1.0, 0.96, 0.92),
	vec3(0.9, 0.88, 0.86), vec3(1.06, 1.02, 0.98), vec3(0.97, 1.0, 1.0));
float wall_hk_of(int i) { return wall_hk[i / 4][i % 4]; }
float wall_bed_of(int i) { return wall_bed[i / 4][i % 4]; }
vec3 g_pic(float layer, vec2 w) { return texture(wall_arr, vec3(w / WALL_TILE[int(layer)], layer)).rgb; }
vec3 g_pic_uv(float layer, vec2 uv, vec2 raw) { return textureGrad(wall_arr, vec3(uv, layer), dFdx(raw), dFdy(raw)).rgb; }
// a value noise from a hash of the cell corners: the blotches, streaks and stains never repeat over a big wall
float g_hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float g_val(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(g_hash(i), g_hash(i + vec2(1.0, 0.0)), u.x), mix(g_hash(i + vec2(0.0, 1.0)), g_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float g_fbm(vec2 p) { return g_val(p) * 0.55 + g_val(p * 2.03 + 17.1) * 0.3 + g_val(p * 4.1 - 5.3) * 0.15; }
// the wall's own frame: along it (u, from the world normal) and up (y), in metres
vec2 g_wall_uv(vec3 wn, vec3 wp) {
	vec2 t = vec2(-wn.z, wn.x);
	float l = length(t);
	return l > 0.3 ? vec2(dot(wp.xz, t / l), wp.y) : wp.xz;
}
float wall_hgt(vec2 uv, float layer, vec2 gx, vec2 gy) { return textureGrad(wall_h, vec3(uv, layer), gx, gy).r; }
// anti-tiling: a wall of bricks or stones cut into bands one picture high, each cut on a bed joint, every band slid
// along the wall by its own dice and now and then mirrored; plaster and render (no courses): no bands.
// The picture's uv and the mirror (1 or -1); raw = w / tile, key = the wall's own dice.
vec3 wall_tile_uv(float layer, vec2 raw, float key) {
	float ph = wall_bed_of(int(layer));
	if (ph < 0.0) return vec3(raw, 1.0);
	float b = floor(raw.y - ph);
	float h = psx_h12(vec2(b, key));
	float f = fract(h * 91.7) < 0.35 ? -1.0 : 1.0;
	return vec3(raw.x * f + h * 5.0, raw.y, f);
}
// the joints darkened and a little sky light on the tops; the tilt for the lights goes to dn (world space)
float wall_relief(float layer, vec2 uv, float flip, vec3 wn, float dist, vec2 gx, vec2 gy, out vec3 dn) {
	dn = vec3(0.0);
	float fp = max(length(gx), length(gy)) * 512.0;
	float k = wall_hk_of(int(layer));
	float fade = (1.0 - smoothstep(10.0, 28.0, dist)) * (1.0 - smoothstep(2.5, 5.0, fp));
	if (k <= 0.0 || fade <= 0.0 || abs(wn.y) > 0.7) return 1.0;
	float e = max(2.0, fp) / 512.0;
	float h = wall_hgt(uv, layer, gx, gy);
	float dU = (wall_hgt(uv + vec2(e, 0.0), layer, gx, gy) - wall_hgt(uv - vec2(e, 0.0), layer, gx, gy)) * flip;
	float dV = wall_hgt(uv + vec2(0.0, e), layer, gx, gy) - wall_hgt(uv - vec2(0.0, e), layer, gx, gy);
	vec3 along = normalize(vec3(-wn.z, 0.0, wn.x));
	vec3 up = vec3(0.0, 1.0, 0.0);
	float b = 3.5 * k * fade;
	vec3 nW = normalize(wn - along * dU * b - up * dV * b);
	dn = nW - wn;
	vec3 L = normalize(up * 0.8 - along * 0.3 + wn * 0.5);
	float lit = clamp(dot(nW, L), 0.0, 1.0) / max(dot(wn, L), 0.3);
	float ao = (0.7 + 0.36 * h) / (0.7 + 0.36 * 0.8);
	return mix(1.0, mix(1.0, lit, 0.35) * mix(1.0, ao, k), fade);
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
	gmat = CUSTOM0.xy; // (the house's wall picture and paint)
	dressed = vec4(UV2, CUSTOM0.xy);
	UV = UV * uv_xform.xy + uv_xform.zw;
}

vec3 dressed_normal(vec3 position, vec3 normal, vec2 grad_uv, vec2 dx, vec2 dy) {
	vec3 sx = dFdx(position), sy = dFdy(position), r1 = cross(sy, normal), r2 = cross(normal, sx);
	float det = dot(sx, r1);
	vec3 g = sign(det) * (dot(grad_uv, dx) * r1 + dot(grad_uv, dy) * r2);
	vec3 n = normalize(max(abs(det), 1e-12) * normal - g);
	// seen edge-on the screen derivatives run away and the relief would turn the face over (a black reveal):
	// fade it out at grazing angles and never tilt it more than about 35 degrees
	float facing = abs(dot(normal, normalize(-position)));
	n = normalize(mix(normal, n, smoothstep(0.06, 0.3, facing)));
	float c = dot(n, normal);
	if (c < 0.82) n = normalize(normal * 0.82 + normalize(n - normal * c) * 0.57);
	return n;
}
float dressed_lum(vec2 uv) { return dot(texture(stone_tex, uv).rgb, vec3(0.3333)); }

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
	float psx_h = 0.5; // how high the stone is here; the puddles leave the tops dry
	vec3 ground_dn = vec3(0.0);
	vec4 c = texture(tex, uv);
	c *= albedo;
	float dcode = floor(dressed.x + 0.5);
	bool dz = dcode > 0.5;
	float dregion = mod(dcode, 10.0);
	bool dblue = dcode > 9.5;
	if (dz) {
		float lum = dressed_lum(uv);
		vec3 col;
		if (dblue) col = texture(stone_tex, uv).rgb * mix(vec3(0.90, 0.97, 1.06), vec3(1.0), dressed.w) * (0.62 + 0.2 * dressed.y);
		else {
			// a fine sandy limestone: the scan's grain kept, its blotches and fossil flecks calmed
			float soft = dot(texture(stone_tex, uv, 3.0).rgb, vec3(0.3333));
			float grain = clamp((lum - soft) * 1.6, -0.12, 0.12);
			col = vec3(0.36, 0.345, 0.30) * (1.0 + grain * 2.2) * (0.94 + 0.9 * (soft - 0.13));
			// every stone from its own bed: tone and warmth vary; now and then a newer replacement stone
			col *= mix(vec3(1.03, 1.0, 0.93), vec3(0.96, 0.99, 1.03), dressed.w) * (0.82 + 0.24 * dressed.y) * (dressed.w > 0.92 ? 1.1 : 1.0);
		}
		if (dregion > 4.5) col = vec3(0.36, 0.345, 0.30) * (0.8 + 2.0 * lum) * (dblue ? 0.85 : 1.0);
		c = vec4(col * albedo.rgb, 1.0);
	}
	{
		// pavements, kerbs and door steps: slabs in world metres with their own relief
		vec3 fn = normalize(cross(dFdx(world), dFdy(world)));
		if (!dz && abs(fn.y) > 0.9 && world.y < slab_ymax) {
			vec2 suv = world.xz / slab_tile;
			c.rgb = albedo.rgb * texture(slab_map, suv).rgb * 1.25;
			float e = 1.0 / 128.0;
			float sh = texture(slab_h, suv).r;
			float sx = texture(slab_h, suv + vec2(e, 0.0)).r - texture(slab_h, suv - vec2(e, 0.0)).r;
			float sz = texture(slab_h, suv + vec2(0.0, e)).r - texture(slab_h, suv - vec2(0.0, e)).r;
			vec3 rn = normalize(vec3(-sx * 1.6, 1.0, -sz * 1.6));
			float lit = clamp(dot(rn, normalize(vec3(-0.45, 0.8, -0.35))), 0.0, 1.0);
			float rel = mix(0.6, 1.12, lit) * (0.55 + 0.45 * sh);
			c.rgb *= mix(rel, 0.86, smoothstep(8.0, 22.0, len));
			float e2 = 3.0 / 128.0;
			float bx = texture(slab_h, suv + vec2(e2, 0.0), 2.0).r - texture(slab_h, suv - vec2(e2, 0.0), 2.0).r;
			float bz = texture(slab_h, suv + vec2(0.0, e2), 2.0).r - texture(slab_h, suv - vec2(0.0, e2), 2.0).r;
			float fps = max(length(dFdx(suv)), length(dFdy(suv))) * 128.0;
			vec2 ss = (vec2(sx, sz) * 1.2 + vec2(bx, bz) * slab_dome) * 1.6 * (1.0 - smoothstep(12.0, 28.0, len)) * (1.0 - smoothstep(6.0, 14.0, fps));
			ground_dn = normalize(vec3(-ss.x, 1.0, -ss.y)) - vec3(0.0, 1.0, 0.0);
			psx_h = sh;
		}
	}
	if (dz) {
		// weathering that follows its causes: soot crusts where the rain never washes, runoff streaks on open faces,
		// grit on the tops, splash and muck at the foot, the bake's own shadow in the joints
		vec3 wn = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
		float rain = dressed.z, ao = COLOR.r, wear = COLOR.a;
		vec2 sw = vec2(psx_along(world, wn), world.y);
		float n1 = pud_val(sw * 9.0 + dressed.y * 31.0), n2 = pud_val(sw * 2.3 - 7.0);
		float under = smoothstep(-0.2, -0.8, wn.y), up = smoothstep(0.6, 0.95, wn.y), vert = 1.0 - abs(wn.y);
		// the town's coal smoke: a grey film everywhere, heavier where the rain never washes it off, black gypsum
		// crusts under the ledges and the mouldings
		c.rgb *= mix(1.0, 0.80 + 0.12 * n2, (0.45 + 0.55 * wear));
		// and in soft clouds, as it settled over the years (larger than one stone, so the blocks share it)
		float cloud = smoothstep(0.3, 0.78, pud_val(sw / 1.3 + 7.1) * 0.7 + pud_val(sw / 0.45 - 3.3) * 0.3);
		c.rgb *= mix(vec3(1.0), vec3(0.66, 0.64, 0.60), cloud * (0.45 + 0.55 * wear) * (0.6 + 0.4 * (1.0 - rain)));
		float shelter = 1.0 - rain;
		// (the black crust belongs under ledges and mouldings; an upright face out of the rain only greys)
		float crust = clamp(shelter * shelter * (0.25 + 0.55 * under) + 0.12 * shelter * vert, 0.0, 1.0) * (0.5 + 0.5 * wear);
		c.rgb *= mix(vec3(1.0), vec3(0.42, 0.40, 0.37), crust * (0.6 + 0.4 * n1));
		// what the rain does wash runs down the faces: paler washed bands with dark edges where the dirt settles
		float band = pud_val(vec2(sw.x / 0.05, sw.y / 0.9) + dressed.y * 13.0);
		float streak = smoothstep(0.5, 0.85, band) * rain * vert;
		float edge = smoothstep(0.42, 0.5, band) * (1.0 - smoothstep(0.5, 0.58, band)) * rain * vert;
		c.rgb *= (1.0 + 0.10 * streak) * (1.0 - 0.22 * edge * (0.5 + wear));
		c.rgb *= mix(1.0, 0.68 + 0.2 * n2, up * (0.45 + 0.55 * shelter));
		c.rgb *= 1.0 - smoothstep(4.5, 14.0, world.y) * 0.16 * wear;
		float gy = world.y - 0.12;
		if (gy < 0.9) {
			float splash = (1.0 - smoothstep(0.05, 0.42 + 0.15 * n2, gy)) * smoothstep(0.62, 0.8, pud_val(sw * vec2(14.0, 11.0) + dressed.y * 5.0)) * (1.0 - up);
			float muck = (1.0 - smoothstep(0.0, 0.09 + 0.06 * n1, gy)) * vert;
			float damp = dblue ? 0.0 : (1.0 - smoothstep(0.16 + 0.14 * n2, 0.30 + 0.14 * n2, gy)) * vert;
			c.rgb *= mix(vec3(1.0), vec3(0.55, 0.50, 0.42), splash * 0.75);
			c.rgb *= mix(vec3(1.0), vec3(0.42, 0.38, 0.30), muck * 0.7);
			c.rgb *= mix(vec3(1.0), vec3(0.62, 0.64, 0.56), damp * 0.55);
			// the blue stone's lime bloom where the damp dries out
			if (dblue) c.rgb = mix(c.rgb, vec3(0.22, 0.22, 0.205), 0.3 * smoothstep(0.62, 0.86, pud_val(sw * vec2(6.0, 18.0))) * (1.0 - smoothstep(0.08, 0.34, gy)) * vert);
		}
		c.rgb *= mix(0.6, 1.0, ao);
		// wet stone darkens where the rain reaches it; the porous light stone more than the blue
		c.rgb *= 1.0 - psx_wet * (dblue ? 0.32 : 0.48) * clamp(rain * 1.2 + 0.2 * vert, 0.0, 1.0);
	} else {
		float g_wear = COLOR.a;
		vec3 g_n = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
		float g_vert = 1.0 - abs(g_n.y);
		vec2 g_w = g_wall_uv(g_n, world);
		vec4 g_nz = vec4(g_fbm(g_w / 1.25), 0.0, 0.0, 0.0);
		vec4 g_nf = texture(grime_noise, g_w / 1.3);
		float g_streak = clamp((smoothstep(0.5, 0.95, g_val(vec2(g_w.x / 0.3, 0.37))) * 0.9 + 0.12 * g_val(vec2(g_w.x / 0.13, 5.1))) * (0.4 + 0.9 * g_val(vec2(g_w.x / 2.0, g_w.y / 5.0))), 0.0, 1.0);
		// stone (sills, heads, cornices, quoins, kerbs): darker with the years, streaked
		c.rgb *= (1.0 - 0.28 * g_wear) * (1.0 - g_streak * 0.3 * g_wear * g_vert) * (1.0 - (g_nz.r - 0.45) * 0.3 * g_wear);
		// more soot the higher up (the town's chimneys), and on the cornices
		c.rgb *= 1.0 - smoothstep(4.5, 14.0, world.y) * 0.32 * g_wear;
		// green-black damp rising from the street: higher on a worn house, a ragged top edge
		float g_top = 0.45 + 0.85 * g_wear + 0.35 * (g_nf.g - 0.5) + 0.25 * (g_nz.r - 0.5);
		float g_damp = (1.0 - smoothstep(g_top - 0.3, g_top, world.y)) * g_vert;
		c.rgb *= mix(vec3(1.0), vec3(0.34, 0.39, 0.28), g_damp * (0.75 + 0.25 * g_wear));
		c.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.18, world.y)) * 0.3 * g_vert;
	}
	if (!dz) c.rgb *= COLOR.rgb;
	{
		vec3 fn = normalize(cross(dFdx(world), dFdy(world)));
		if (!dz && mottle > 0.0) c.rgb = psx_mottle(c.rgb, mottle, world, fn);
		// (the house's own wear in the vertex colour's alpha sets how high and how dark)
		if (!dz && foot > 0.0) c.rgb = psx_foot_dirt(c.rgb, foot * mix(1.0, 0.25 + 0.9 * COLOR.a, foot_wear), world, fn);
	}
	if (dz) {
		// the mason's tooling: fine strokes across the drafted margins, a punched field, rubbed returns; the scan's
		// grain as relief. Strokes fade before they shimmer (a pixel over ~1.5 mm)
		vec2 m = uv * 1.2;
		vec2 dx = dFdx(uv), dy = dFdy(uv);
		float fw = max(length(dx), length(dy)) * 1.2;
		float near = 1.0 - smoothstep(0.0009, 0.0018, fw);
		float pitch = 0.0028, k = 6.28318 / pitch;
		vec2 grad = vec2(0.0);
		float wob = pud_val(m * 40.0 + dressed.y * 9.0) * 2.0;
		if (dregion > 1.5 && dregion < 2.5) grad.x = cos(m.x * k + wob) * k * 0.00015 * near;
		else if (dregion > 2.5 && dregion < 3.5) grad.y = cos(m.y * k + wob) * k * 0.00015 * near;
		else if (dregion < 1.5) {
			vec2 q = m / 0.0035;
			float e = 0.15;
			grad = vec2(pud_val(q + vec2(e, 0.0)) - pud_val(q - vec2(e, 0.0)), pud_val(q + vec2(0.0, e)) - pud_val(q - vec2(0.0, e))) / (2.0 * e * 0.0035) * 0.0003 * near;
		}
		float te = 1.5 / 1254.0;
		float tf = 1.0 - smoothstep(0.002, 0.006, fw);
		grad += vec2(dressed_lum(uv + vec2(te, 0.0)) - dressed_lum(uv - vec2(te, 0.0)), dressed_lum(uv + vec2(0.0, te)) - dressed_lum(uv - vec2(0.0, te))) / (2.0 * te) * 0.0011 * tf;
		if (dregion < 4.5) NORMAL = dressed_normal(VERTEX, NORMAL, grad * 1.2, dx, dy);
	}
	vec3 n_flat = NORMAL;
	// the ground bump: the lights see the stones' own normal; the brightness stays (the colour is divided by how far
	// the normal was tilted, the sky's light multiplied by it)
	NORMAL = normalize(NORMAL + (VIEW_MATRIX * vec4(ground_dn, 0.0)).xyz);
	float bump_k = clamp(dot(NORMAL, n_flat), 0.4, 1.0);
	c.rgb /= bump_k;
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
