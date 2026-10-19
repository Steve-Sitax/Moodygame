// The Ruien's shared parts (World/Ruien: docs/ruien-native.md). The three Ruien kinds (masonry, water, air) read the
// same light list, the same cover map and the same air, so a lamp, a grate or the outlet lights everything alike.
//
// The light list (Ruien.cs SendLights): the sources nearest the eye, 4 texels each in a column of ruien_lights:
//   row 0: xyz where, w strength now (linear, its flicker and the day's light already in it; 0 is out)
//   row 1: xyz the way an opening throws its light (0 for a lamp), w the kind (0 lamp, 1 square opening, 2 round opening)
//   row 2: rgb colour (linear), w the opening's half width across (u)
//   row 3: x reach (m), y the opening's half length (v), z an opening's grate bars (0 none) or a lamp's soft core (m^2), w how much it glows in the air
// The cover map: red 1 where a vault is overhead (the zones of the drawn areas, soft at the gates), over ruien_cover_box.

global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
global uniform vec4 psx_hemi_sky;
global uniform vec4 psx_hemi_ground;
global uniform float psx_time;
global uniform vec3 psx_sun_dir;
global uniform float psx_wet;
global uniform float psx_rain;
global uniform sampler2D ruien_lights : filter_nearest, repeat_disable;
global uniform int ruien_light_n;
global uniform sampler2D ruien_cover : filter_linear, repeat_disable;
global uniform vec4 ruien_cover_box;
// rgb the underground air's colour (what the fog turns a covered surface into), a how much the lamps glow in the air
global uniform vec4 ruien_air;
// rgb the faint light everywhere inside (stray light off wet walls; the AO multiplies it), a the eye underground 0..1
global uniform vec4 ruien_fill;

float ruien_h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ruien_h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float ruien_noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(ruien_h12(i), ruien_h12(i + vec2(1.0, 0.0)), f.x), mix(ruien_h12(i + vec2(0.0, 1.0)), ruien_h12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float ruien_noise3(vec3 p) {
	vec3 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(ruien_h13(i), ruien_h13(i + vec3(1, 0, 0)), f.x), mix(ruien_h13(i + vec3(0, 1, 0)), ruien_h13(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(ruien_h13(i + vec3(0, 0, 1)), ruien_h13(i + vec3(1, 0, 1)), f.x), mix(ruien_h13(i + vec3(0, 1, 1)), ruien_h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// 1 under a vault (no sky, no sun, no street lamp), 0 in the open; the shafts' tops and the outlet's mouth between
float ruien_covered(vec3 wp) {
	vec2 uv = (wp.xz - ruien_cover_box.xy) / ruien_cover_box.zw;
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
	return textureLod(ruien_cover, uv, 0.0).r * (1.0 - smoothstep(-0.7, -0.05, wp.y));
}

// an opening's axes: u across, v along (a level opening: x and z)
void ruien_axes(vec3 dir, out vec3 u, out vec3 v) {
	u = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
	v = normalize(cross(u, dir));
}

// the light one source gives a point with normal N (diffuse, as a matt face takes it: no pi), and its glint on a wet
// surface seen along V (gloss 0 dull .. 1 a film of water); wrap lets light round a thin edge (calcite)
void ruien_light_one(int i, vec3 P, vec3 N, vec3 V, float gloss, float wrap, inout vec3 diff, inout vec3 spec) {
	vec4 A = texelFetch(ruien_lights, ivec2(i, 0), 0);
	vec4 D = texelFetch(ruien_lights, ivec2(i, 3), 0);
	vec3 d = A.xyz - P;
	float dd = dot(d, d);
	if (A.w <= 0.0 || dd > D.x * D.x) return;
	vec4 B = texelFetch(ruien_lights, ivec2(i, 1), 0);
	vec4 C = texelFetch(ruien_lights, ivec2(i, 2), 0);
	float q = dd / (D.x * D.x);
	float fade = (1.0 - q * q);
	fade *= fade;
	vec3 L;
	float e;
	if (B.w < 0.5) {
		// a lamp: the square of the distance, a soft core so the wall by the flame has no hot spot
		float dl = sqrt(dd);
		L = d / max(dl, 1e-4);
		// (the lamp's own cap, frame and gauze shade the stone nearest it: no blown-out patch round the flame)
		e = A.w / (dd + max(D.z, 0.2)) * (dd / (dd + 0.6));
	} else {
		// an opening: daylight from a patch of sky (a grate, a hatch, the outlet's arch), from its nearest point, thrown
		// out along its way as a lit cloth would be (cos at both ends over the distance squared, softened by its size)
		vec3 ua, va;
		ruien_axes(B.xyz, ua, va);
		vec3 rel = P - A.xyz;
		float du = dot(rel, ua), dv = dot(rel, va);
		float out_d = dot(rel, B.xyz);
		if (out_d < -0.05) return;
		vec3 Q = A.xyz + ua * clamp(du, -C.w, C.w) + va * clamp(dv, -D.y, D.y);
		if (B.w > 1.5) {
			float r = length(vec2(du, dv));
			Q = A.xyz + (ua * du + va * dv) * (min(r, C.w) / max(r, 1e-4));
		}
		vec3 lq = Q - P;
		float dl = max(length(lq), 1e-3);
		L = lq / dl;
		float area = B.w > 1.5 ? 3.1416 * C.w * C.w : 4.0 * C.w * D.y;
		float cos_e = max(dot(-L, B.xyz), 0.0) * 0.7 + 0.3 * smoothstep(-0.05, 0.4, out_d / dl);
		e = A.w * area * cos_e / (dl * dl + area * 0.6);
		// the grate's bars: their shadows on what lies under it, sharp close by and blurred further down
		if (D.z > 0.5) {
			float k = D.z / (2.0 * C.w);
			float pen = 0.04 + out_d * 0.07;
			float bu = abs(fract(du * k + 0.5) - 0.5) / k;
			float bv = abs(fract(dv * k + 0.5) - 0.5) / k;
			float bars = smoothstep(0.012, 0.012 + pen, bu) * smoothstep(0.012, 0.012 + pen, bv);
			e *= mix(1.0, 0.25 + 0.75 * bars, smoothstep(2.5 * C.w + 2.0, 0.0, out_d));
		}
	}
	float nl = dot(N, L);
	float lam = wrap > 0.0 ? max((nl + wrap) / (1.0 + wrap), 0.0) : max(nl, 0.0);
	diff += C.rgb * (e * lam * fade);
	if (gloss > 0.001 && nl > 0.0) {
		vec3 H = normalize(L + V);
		float sh = mix(8.0, 220.0, gloss * gloss);
		float fr = 0.03 + 0.97 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
		spec += C.rgb * (e * fade * nl * pow(max(dot(N, H), 0.0), sh) * (sh + 8.0) / 25.1 * fr * gloss);
	}
}

void ruien_lights_at(vec3 P, vec3 N, vec3 V, float gloss, float wrap, out vec3 diff, out vec3 spec) {
	diff = vec3(0.0);
	spec = vec3(0.0);
	for (int i = 0; i < ruien_light_n; i++) ruien_light_one(i, P, N, V, gloss, wrap, diff, spec);
}

// the lamps' light scattered toward the eye by the damp air (psx's lamp_scatter, the same shape): a glow round each
// lamp, more of it the further the eye looks past it
float ruien_half_scatter(float t, float h) {
	float h2 = h * h;
	return 0.5 * (t / (h2 * (h2 + t * t)) + atan(t / h) / (h2 * h));
}
vec3 ruien_haze(vec3 ro, vec3 rd, float len) {
	vec3 g = vec3(0.0);
	if (ruien_air.a <= 0.0) return g;
	for (int i = 0; i < ruien_light_n; i++) {
		vec4 D = texelFetch(ruien_lights, ivec2(i, 3), 0);
		if (D.w <= 0.0) continue;
		vec4 A = texelFetch(ruien_lights, ivec2(i, 0), 0);
		if (A.w <= 0.0) continue;
		vec3 q = A.xyz - ro;
		float t0 = dot(q, rd);
		float dperp = length(q - rd * t0);
		if (dperp > D.x) continue;
		float h = dperp + 0.12;
		float s = ruien_half_scatter(min(len, 40.0) - t0, h) - ruien_half_scatter(-t0, h);
		// (the glow grows with the root of the strength: a bright lamp lights the stone far more than it hazes the air;
		// and it is rolled off, so a lamp by the eye is a soft warm glow, never a white disc)
		float x = sqrt(A.w) * D.w * s * ruien_air.a;
		g += texelFetch(ruien_lights, ivec2(i, 2), 0).rgb * (x / (1.0 + x * 5.0));
	}
	return g;
}

// a lamp mirrored in water or a wet film: a streak drawn out toward the eye by the ripples (psx wet_streak's shape)
vec3 ruien_streaks(vec3 P, vec3 rr, float stretch) {
	vec3 s = vec3(0.0);
	for (int i = 0; i < ruien_light_n; i++) {
		vec4 B = texelFetch(ruien_lights, ivec2(i, 1), 0);
		if (B.w > 0.5) continue;
		vec4 A = texelFetch(ruien_lights, ivec2(i, 0), 0);
		if (A.w <= 0.0) continue;
		vec3 q = A.xyz - P;
		float t0 = dot(q, rr);
		if (t0 < 0.0) continue;
		vec3 perp = q - rr * t0;
		vec3 across = normalize(vec3(-rr.z, 0.0, rr.x) + 1e-5);
		float da = dot(perp, across);
		float dv = length(perp - across * da);
		float k = 1.0 / (1.0 + da * da * 60.0 + dv * dv * 6.0 / stretch) / (1.0 + t0 * 0.15);
		float x = sqrt(A.w) * k;
		s += texelFetch(ruien_lights, ivec2(i, 2), 0).rgb * (x / (1.0 + x * 0.5));
	}
	return s;
}

// the air between the eye and a point: the street's fog outside, the dark underground air under a vault
vec4 ruien_fog(float depth, float covered) {
	float k = smoothstep(psx_fog_near, psx_fog_far, depth);
	return vec4(mix(psx_fog_color.rgb, ruien_air.rgb, covered), k);
}

// the cotangent frame from the screen derivatives (no tangents in the mesh): tangent-space normal and height work on
// every face as exported
mat3 ruien_tbn(vec3 N, vec3 p, vec2 uv) {
	vec3 dp1 = dFdx(p), dp2 = dFdy(p);
	vec2 du1 = dFdx(uv), du2 = dFdy(uv);
	vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
	vec3 T = dp2perp * du1.x + dp1perp * du2.x;
	vec3 Bt = dp2perp * du1.y + dp1perp * du2.y;
	float invmax = inversesqrt(max(max(dot(T, T), dot(Bt, Bt)), 1e-20));
	return mat3(T * invmax, Bt * invmax, N);
}
