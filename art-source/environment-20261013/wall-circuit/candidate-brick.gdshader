shader_type spatial;
render_mode ambient_light_disabled, cull_disabled;

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
float circuit_vault_cap(vec3 p,vec3 lamp,float decay,float up){float original=psx_lamp_cap(decay,up);if(abs(decay-1.7)>.001)return original;float zone=0.0;
{vec2 c=vec2(229.34500,122.07750),q=p.xz-c;float side=abs(dot(q,vec2(0.05300,0.99860)));float depth=abs(dot(q,vec2(0.99860,-0.05300)));zone=max(zone,(1.0-smoothstep(2.5,2.8,side))*(1.0-smoothstep(5.8,6.3,depth))*(1.0-smoothstep(.4,.9,length(lamp.xz-c))));}
{vec2 c=vec2(63.85250,352.18000),q=p.xz-c;float side=abs(dot(q,vec2(-0.99900,0.04490)));float depth=abs(dot(q,vec2(0.04490,0.99900)));zone=max(zone,(1.0-smoothstep(2.5,2.8,side))*(1.0-smoothstep(5.8,6.3,depth))*(1.0-smoothstep(.4,.9,length(lamp.xz-c))));}
{vec2 c=vec2(-144.92000,354.07500),q=p.xz-c;float side=abs(dot(q,vec2(-0.99910,-0.04320)));float depth=abs(dot(q,vec2(-0.04320,0.99910)));zone=max(zone,(1.0-smoothstep(2.5,2.8,side))*(1.0-smoothstep(5.8,6.3,depth))*(1.0-smoothstep(.4,.9,length(lamp.xz-c))));}
{vec2 c=vec2(-365.02750,150.13500),q=p.xz-c;float side=abs(dot(q,vec2(0.07250,-0.99740)));float depth=abs(dot(q,vec2(-0.99740,-0.07250)));zone=max(zone,(1.0-smoothstep(2.5,2.8,side))*(1.0-smoothstep(5.8,6.3,depth))*(1.0-smoothstep(.4,.9,length(lamp.xz-c))));}

 zone*=smoothstep(2.8,3.3,p.y)*(1.0-smoothstep(6.3,6.8,p.y));
 float reflected=.42*(.18+.82*(1.0-smoothstep(.3,1.0,up)));
 return mix(original,reflected,zone*smoothstep(.2,.35,up));
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
		return C.rgb * (A.w * cr * fade * circuit_vault_cap(P,A.xyz,D.y,d.y/max(dl,1e-4)) / (pow(max(dl, 0.05), D.y) + D.w + psx_lamp_core(D.y)));
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

uniform sampler2D bump_map : filter_linear_mipmap_anisotropic, repeat_enable;
uniform float bump_scale = 1.0;
float psx_bump_gain(vec2 dx, vec2 dy, vec2 size, float res) {
	float tpp = max(length(dx * size), length(dy * size)) * res;
	return mix(2.5, 1.0, smoothstep(2.0, 8.0, tpp));
}
vec2 bump_dh(vec2 raw, vec2 cl, float res) {
	vec2 dx = dFdx(raw);
	vec2 dy = dFdy(raw);
	float hll = bump_scale * texture(bump_map, raw).x;
	float dbx = bump_scale * texture(bump_map, raw + dx).x - hll;
	float dby = bump_scale * texture(bump_map, raw + dy).x - hll;
	return vec2(dbx, dby) * res * psx_bump_gain(dx, dy, vec2(textureSize(bump_map, 0)), res);
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
	UV = UV * uv_xform.xy + uv_xform.zw;
}

global uniform float psx_wet;
// Height is measured in metres. Raw position derivatives keep slopes stable at any camera distance.
vec3 metric_surface_normal(vec3 position, vec3 normal, float height) {
    vec3 sx = dFdx(position);
    vec3 sy = dFdy(position);
    vec3 r1 = cross(sy, normal);
    vec3 r2 = cross(normal, sx);
    float determinant = dot(sx, r1);
    vec3 gradient = sign(determinant) * (dFdx(height) * r1 + dFdy(height) * r2);
    return normalize(max(abs(determinant), 1e-12) * normal - gradient);
}


float junction_hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float junction_noise(vec2 p) {
 vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
 return clamp(mix(mix(junction_hash(i),junction_hash(i+vec2(1,0)),f.x),mix(junction_hash(i+vec2(0,1)),junction_hash(i+vec2(1,1)),f.x),f.y),0.0,1.0);
}
vec3 junction_weather(vec3 color, vec3 p, float iron) {
 vec2 q=p.xz-vec2(212.9183,30.7344);
 float a=dot(q,vec2(.16092,.98697)), o=dot(q,vec2(.98697,-.16092));
 float local=(1.0-smoothstep(16.0,18.0,a))*smoothstep(-1.0,0.0,a)*(1.0-smoothstep(4.6,5.6,abs(o)));
 float coarse=junction_noise(p.xz*1.8+vec2(p.y*.4));
 float fine=junction_noise(p.xz*13.0+vec2(p.y*11.0));
 float splash=(1.0-smoothstep(.01,.24+coarse*.75,p.y))*local;
 float ground=(1.0-smoothstep(.05,.16,p.y))*exp(-abs(o+2.3)*1.6)*local;
 float dirt=clamp(max(splash*.95,ground*.95)*(.45+.55*coarse),0.0,.90);
 color=mix(color,color*vec3(.39,.37,.30),dirt);
 color=mix(color,color*vec3(.36,.34,.25),ground*(.48+.30*coarse));
 // Vertical runs originate at coping joints; quiet variation breaks regular tile reads.
 float drip=pow(junction_noise(vec2(a*3.0,2.0)),7.0)*exp(-p.y*.9)*local;
 color*=1.0-drip*.26;
 float postA=.25+clamp(round((a-.25)/(11.45/9.0)),0.0,9.0)*(11.45/9.0);
 float socketY=.3+postA*6.5/11.7;
 float rust=exp(-abs(a-postA)*48.0)*exp(-abs(o+2.05)*9.0)*smoothstep(socketY-.5,socketY-.05,p.y)*(1.0-smoothstep(socketY+.015,socketY+.035,p.y))*local*(1.0-iron);
 color=mix(color,color*vec3(.64,.37,.18),rust*.43);
 float moss=smoothstep(.44,.72,coarse)*(.45+.55*fine)*max(splash,ground)*.75*(1.0-iron);
 color=mix(color,color*vec3(.44,.56,.29),moss);
 // Splash from the actual house shoe meets its cross-channel and street gutter.
 float shoe=exp(-length((p.xz-vec2(200.55,43.74))*vec2(1.9,3.6)))*(1.0-smoothstep(.1,.6,p.y));
 color=mix(color,color*vec3(.38,.40,.31),shoe*.55);
 float guard=smoothstep(6.4,6.49,p.y)*(1.0-smoothstep(6.55,7.10+coarse*.3,p.y))*exp(-length(p.xz-vec2(222.55,47.23))*1.5);
 color=mix(color,color*vec3(.36,.42,.27),guard*(.45+.30*coarse));
 float age=junction_noise(p.xz*.29+vec2(p.y*.7));
 color*=.82+.18*age;
 float runoff=pow(junction_noise(vec2(a*2.1,5.7)),4.0)*(.5+.5*junction_noise(vec2(a*8.0,p.y*.35)));
 color*=1.0-local*runoff*.22;
 return color*(1.0-psx_wet*(.22-.10*iron));
}


float circuit_hash(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453);}
float circuit_noise(vec2 q){q+=vec2(sin(q.y*.71),cos(q.x*.63))*.37;return clamp(.5+.22*sin(q.x*1.37+sin(q.y*1.81))+.16*sin(q.y*2.11+cos(q.x*.93))+.12*sin(q.x*3.71+q.y*2.79),0.0,1.0);}
vec3 circuit_weather(vec3 color,vec3 p,float iron){float d=1000.0;float base=0.0;
{vec2 q=p.xz-vec2(215.00000,0.00000);float a=dot(q,vec2(0.16092,0.98697));float o=dot(q,vec2(0.98697,-0.16092));float end=max(-a,a-93.21000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(230.00000,92.00000);float a=dot(q,vec2(0.05302,0.99859));float o=dot(q,vec2(0.99859,-0.05302));float end=max(-a,a-113.16000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(236.00000,205.00000);float a=dot(q,vec2(-0.12295,0.99241));float o=dot(q,vec2(0.99241,0.12295));float end=max(-a,a-113.86000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(222.00000,318.00000);float a=dot(q,vec2(-0.95050,0.31074));float o=dot(q,vec2(0.31074,0.95050));float end=max(-a,a-109.42000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(118.00000,352.00000);float a=dot(q,vec2(-0.99899,0.04490));float o=dot(q,vec2(0.04490,0.99899));float end=max(-a,a-178.18000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(-60.00000,360.00000);float a=dot(q,vec2(-0.99907,-0.04320));float o=dot(q,vec2(-0.04320,0.99907));float end=max(-a,a-185.17000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(-245.00000,352.00000);float a=dot(q,vec2(-0.95897,-0.28352));float o=dot(q,vec2(-0.28352,0.95897));float end=max(-a,a-119.92000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(-360.00000,318.00000);float a=dot(q,vec2(-0.11572,-0.99328));float o=dot(q,vec2(-0.99328,0.11572));float end=max(-a,a-103.70000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(-372.00000,215.00000);float a=dot(q,vec2(0.07254,-0.99737));float o=dot(q,vec2(-0.99737,-0.07254));float end=max(-a,a-110.29000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(-364.00000,105.00000);float a=dot(q,vec2(0.08540,-0.99635));float o=dot(q,vec2(-0.99635,-0.08540));float end=max(-a,a-105.39000);float edge=p.y>6.3?min(abs(o+6.58),abs(o+.65)):min(abs(o+7.0),abs(o));d=min(d,length(vec2(max(end,0.0),edge)));}
{vec2 q=p.xz-vec2(212.91880,30.73554);float a=dot(q,vec2(0.16092,0.98697));float o=dot(q,vec2(0.98697,-0.16092));d=min(d,length(vec2(max(max(-a,a-11.70200),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(225.13070,132.31470);float a=dot(q,vec2(0.05302,0.99859));float o=dot(q,vec2(0.99859,-0.05302));d=min(d,length(vec2(max(max(-a,a-11.70643),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(224.13510,243.83580);float a=dot(q,vec2(-0.12295,0.99241));float o=dot(q,vec2(0.99241,0.12295));d=min(d,length(vec2(max(max(-a,a-11.69896),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(181.80480,323.77610);float a=dot(q,vec2(-0.95050,0.31074));float o=dot(q,vec2(0.31074,0.95050));d=min(d,length(vec2(max(max(-a,a-11.71010),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(53.75034,347.88070);float a=dot(q,vec2(-0.99899,0.04490));float o=dot(q,vec2(0.04490,0.99899));d=min(d,length(vec2(max(max(-a,a-11.70201),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(22.78165,349.27260);float a=dot(q,vec2(-0.99899,0.04490));float o=dot(q,vec2(0.04490,0.99899));d=min(d,length(vec2(max(max(-a,a-11.70201),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(-134.62790,349.76650);float a=dot(q,vec2(0.99907,0.04320));float o=dot(q,vec2(-0.04320,0.99907));d=min(d,length(vec2(max(max(-a,a-11.70069),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(-167.59720,348.34090);float a=dot(q,vec2(-0.99907,-0.04320));float o=dot(q,vec2(-0.04320,0.99907));d=min(d,length(vec2(max(max(-a,a-11.70069),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(-281.37410,333.94640);float a=dot(q,vec2(-0.95897,-0.28352));float o=dot(q,vec2(-0.28352,0.95897));d=min(d,length(vec2(max(max(-a,a-11.69806),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(-357.09720,282.42520);float a=dot(q,vec2(-0.11572,-0.99328));float o=dot(q,vec2(-0.99328,0.11572));d=min(d,length(vec2(max(max(-a,a-11.69932),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(-359.57790,140.70500);float a=dot(q,vec2(0.07254,-0.99737));float o=dot(q,vec2(-0.99737,-0.07254));d=min(d,length(vec2(max(max(-a,a-11.70091),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(-354.46360,75.70730);float a=dot(q,vec2(0.08540,-0.99635));float o=dot(q,vec2(-0.99635,-0.08540));d=min(d,length(vec2(max(max(-a,a-11.69284),0.0),abs(o+2.3))));}
{vec2 q=p.xz-vec2(225.02000,49.02500);vec2 a=abs(vec2(dot(q,vec2(-0.98713,0.15994)),dot(q,vec2(-0.15994,-0.98713))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(236.24000,171.78000);vec2 a=abs(vec2(dot(q,vec2(-0.99862,0.05256)),dot(q,vec2(-0.05256,-0.99862))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(231.22000,259.83000);vec2 a=abs(vec2(dot(q,vec2(-0.99247,-0.12250)),dot(q,vec2(0.12250,-0.99247))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(170.34250,336.99000);vec2 a=abs(vec2(dot(q,vec2(-0.31248,-0.94993)),dot(q,vec2(0.94993,-0.31248))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(-1.79000,359.38500);vec2 a=abs(vec2(dot(q,vec2(-0.04507,-0.99898)),dot(q,vec2(0.99898,-0.04507))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(-199.95500,355.95000);vec2 a=abs(vec2(dot(q,vec2(0.04257,-0.99909)),dot(q,vec2(0.99909,0.04257))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(-303.10500,336.90750);vec2 a=abs(vec2(dot(q,vec2(0.28298,-0.95913)),dot(q,vec2(0.95913,0.28298))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(-368.35250,263.60250);vec2 a=abs(vec2(dot(q,vec2(0.99339,-0.11481)),dot(q,vec2(0.11481,0.99339))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(-361.29500,50.03000);vec2 a=abs(vec2(dot(q,vec2(0.99639,0.08491)),dot(q,vec2(-0.08491,0.99639))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(241.93000,90.71500);vec2 a=abs(vec2(dot(q,vec2(-0.99419,0.10768)),dot(q,vec2(-0.10768,-0.99419))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(231.26500,325.62750);vec2 a=abs(vec2(dot(q,vec2(-0.77251,-0.63501)),dot(q,vec2(0.63501,-0.77251))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(-369.18000,325.73000);vec2 a=abs(vec2(dot(q,vec2(0.76452,-0.64460)),dot(q,vec2(0.64460,0.76452))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(-383.99500,215.25750);vec2 a=abs(vec2(dot(q,vec2(0.99980,-0.02000)),dot(q,vec2(0.02000,0.99980))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(219.00000,-12.00000);vec2 a=abs(vec2(dot(q,vec2(-1.00000,0.00000)),dot(q,vec2(-0.00000,-1.00000))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}
{vec2 q=p.xz-vec2(-359.00000,-12.00000);vec2 a=abs(vec2(dot(q,vec2(1.00000,-0.00000)),dot(q,vec2(0.00000,1.00000))));float edge=abs(max(a.x,a.y)-1.88);if(max(a.x,a.y)<3.4&&p.y>6.35){d=min(d,edge);base=6.5;}}

if(p.y>6.3&&p.y<8.0&&d<1.6)base=6.5;
if(p.x> -319.0&&p.x< -278.0&&p.z>294.0&&p.z<329.0&&p.y<2.0)base=-.35;
float y=p.y-base;float noise=.50*circuit_noise(p.xz*1.7+vec2(p.y*.93,-p.y*.63))+.30*circuit_noise(vec2(dot(p.xz,vec2(.61,.79))*4.7,p.y*4.3))+.20*circuit_noise(vec2(dot(p.xz,vec2(-.79,.61))*11.0,p.y*13.0));
float band=(1.0-smoothstep(.04,.42+noise*.85,y))*exp(-d*1.4)*smoothstep(-.18,-.015,y);
float fine=circuit_noise(vec2(dot(p.xz,vec2(.79,.61))*27.0,p.y*29.0));float damp=band*(.35+.65*noise);
color=mix(color,color*vec3(.28,.30,.22),damp*.94);
float moss=band*smoothstep(.40,.72,noise)*(.2+.8*fine)*(1.0-iron);
color=mix(color,color*vec3(.36,.51,.21),moss*.82);
float contact=exp(-max(y,0.0)*5.0)*exp(-d*1.5)*(.55+.45*noise)*smoothstep(-.18,-.015,y);
float vertical=1.0-smoothstep(.55,.85,abs(normalize(cross(dFdx(p),dFdy(p))).y));
color=mix(color,color*vec3(.08,.105,.055),contact*mix(.72,.94,vertical));
// Persistent wet joints at the pond have a visible narrow algae/splash zone.
float waterline=base<-.3?(1.0-smoothstep(.03,.31+noise*.18,y))*smoothstep(-.12,-.01,y):0.0;
color=mix(color,vec3(.024,.046,.012)*(.8+.4*fine),waterline*(.62+.25*fine));
color*=1.0-psx_wet*.12;
float age=circuit_noise(p.xz*.17+vec2(p.y*.21));color*=.91+.12*age;
return color;
}


vec3 circuit_brick_normal(vec3 position,vec3 normal,vec2 uv,vec2 dx,vec2 dy){
 vec2 step_uv=2.0/vec2(textureSize(bump_map,0));
 float hx=(textureGrad(bump_map,uv+vec2(step_uv.x,0),dx,dy).r-textureGrad(bump_map,uv-vec2(step_uv.x,0),dx,dy).r)/ (2.0*step_uv.x);
 float hy=(textureGrad(bump_map,uv+vec2(0,step_uv.y),dx,dy).r-textureGrad(bump_map,uv-vec2(0,step_uv.y),dx,dy).r)/ (2.0*step_uv.y);
 vec2 gradient_uv=vec2(hx,hy)*.004;
 vec3 sx=dFdx(position),sy=dFdy(position),r1=cross(sy,normal),r2=cross(normal,sx);
 float determinant=dot(sx,r1);
 vec3 gradient=sign(determinant)*(dot(gradient_uv,dx)*r1+dot(gradient_uv,dy)*r2);
 return normalize(max(abs(determinant),1e-12)*normal-gradient);
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
	vec3 jn=normalize((INV_VIEW_MATRIX*vec4(NORMAL,0.0)).xyz); uv=vec2(dot(world,normalize(vec3(jn.z,0.0,-jn.x)))/1.84,-world.y/1.56); if(UV2.x>76.5)uv=UV; vec2 circuit_dx=dFdx(uv),circuit_dy=dFdy(uv); float circuit_y=fract(uv.y)*1161.0; float circuit_row=0.0; float circuit_joints[23]=float[23](45.0,94.0,143.0,192.0,242.0,290.0,338.0,385.0,434.0,482.0,532.0,579.0,629.0,677.0,725.0,772.0,821.0,869.0,917.0,966.0,1016.0,1064.0,1114.0); for(int ci=0;ci<23;ci++){circuit_row+=step(circuit_joints[ci],circuit_y);} circuit_row+=floor(uv.y)*24.0; float circuit_phase=mod(circuit_row,2.0)<0.5?0.0325:(mod(circuit_row,4.0)<2.0?0.0625:0.0025); uv.x=mod(uv.x+floor(junction_hash(vec2(circuit_row,17.0))*7.0)/8.0-circuit_phase,0.875)+circuit_phase; vec2 raw_uv = uv;
	vec4 c = textureGrad(tex,uv,circuit_dx,circuit_dy);
	c *= albedo;
	c.rgb *= COLOR.rgb;
 c.rgb=circuit_weather(c.rgb,world,0.0);

 c.rgb = junction_weather(c.rgb, world, 0.0);

	{
		vec3 fn = normalize(cross(dFdx(world), dFdy(world)));
		if (mottle > 0.0) c.rgb = psx_mottle(c.rgb, mottle, world, fn);
		// (the house's own wear in the vertex colour's alpha sets how high and how dark)
		if (foot > 0.0) c.rgb = psx_foot_dirt(c.rgb, foot * mix(1.0, 0.25 + 0.9 * COLOR.a, foot_wear), world, fn);
	}
	vec3 n_flat = NORMAL;
	NORMAL = circuit_brick_normal(VERTEX,NORMAL,raw_uv,circuit_dx,circuit_dy);
	float bump_k = 1.0;
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	// the sky's light: its own colour from above, the ground's from below (three's HemisphereLight), less of it in
	// a narrow street; the sun waits for light(), kept off by the houses
	vec3 sky = mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, nw.y * 0.5 + 0.5) * bump_k * psx_sky_seen(world, nw);
	sun_lit = psx_sun_shadow(world, nw);
	// the light spilt from lamps, lit windows and doors (world/spill.ts), as point lights would give it
	vec3 spilt = psx_spill_n > 0 ? psx_spill_at(world, nw) / PI : vec3(0.0);
	float fog_k = smoothstep(psx_fog_near, psx_fog_far * fog_reach, fog_depth);
	{
		// a landmark seen further than the fog: past the normal fog it becomes one soft silhouette tone
		float sil = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
		k3 *= 1.0 - sil;
		ad = ad * (1.0 - sil) + fogc * 0.74 * sil;
	}
	// the lamps' glow in the air between the eye and the surface
	vec3 halo = psx_lamp_color.rgb * psx_glow(CAMERA_POSITION_WORLD, rd, glow_reach(len, psx_fog_far, rd)) * psx_scatter * (0.35 + 0.65 * fog_k);
	ALBEDO = c.rgb * k3;
	EMISSION = (emission * texture(emission_tex, uv).rgb * mix(vec3(1.0), psx_fill.rgb * COLOR.rgb, fill) + c.rgb * (sky + spilt)) * k3 + ad + halo;
	float jf=pow(1.0-clamp(dot(normalize(-VERTEX),NORMAL),0.0,1.0),4.0);
                float jw=psx_wet*(.25+.75*junction_noise(world.xz*2.7));
                EMISSION+=psx_hemi_sky.rgb*jf*jw*.12;
                FOG = vec4(fogc + halo, fog_k);
}

void light() {
	// three's matt face: colour x light x cos / pi (LIGHT_COLOR comes times pi); the sun kept off by the houses
	float a = ATTENUATION;
	if (LIGHT_IS_DIRECTIONAL) a *= sun_lit;
	DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR / PI;
 vec3 jh=normalize(LIGHT+VIEW); float js=mix(10.0,55.0,psx_wet); SPECULAR_LIGHT+=LIGHT_COLOR*a*pow(max(dot(NORMAL,jh),0.0),js)*max(dot(NORMAL,LIGHT),0.0)*(0.018+psx_wet*0.12);

}
