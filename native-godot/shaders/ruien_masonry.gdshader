// The Ruien's solid surfaces (World/Ruien, docs/ruien-native.md), one kind for every family: brick, sandstone,
// bluestone, calcite, oak, iron, silt, moss, debris. Each family is a tiling texture set (albedo, normal, height /
// roughness / AO packed), the brick with its slimed and limed colours on the same bricks; the mesh's vertex colour is
// its weather: R wet and slimed, G lime wash, halo and runnels, B soot and grime, A moss (manifest COLOR_0); CUSTOM0 the
// study's own baked base colour (rgb, as its square root; black where it baked none) and the baked ambient occlusion (a).
// The baked colour carries the study's weathering at the mesh's 2-3 cm, the family's pictures the detail within it. Parallax occlusion steps into the height near the eye, on top of the real relief.
// Light: the Ruien's own list (lamps, grates, the outlet: ruien_common), the street's sky and sun only where no vault
// is overhead, and any real light that reaches it (Jef's lantern). Kept in the psx style: the same fog and glow.
shader_type spatial;
render_mode specular_disabled, ambient_light_disabled, cull_disabled;
#include "res://shaders/ruien_common.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D slime_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D lime_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
// R height (1 the top of the stone), G roughness, B the texture's own cavity AO
uniform sampler2D hra_tex : filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
// the moss set, shared by every family (where the vertex colour's A says)
uniform sampler2D moss_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform sampler2D moss_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec4 tint : source_color = vec4(1.0);
// 1: the family has its own slimed and limed pictures (the brick); else the weather tints the dry one
uniform float variants = 0.0;
// metres of relief the height map spans, and how much of it parallax adds (0 none: the geometry carries it)
uniform float relief_m = 0.02;
uniform float pom = 0.35;
uniform float normal_k = 1.0;
uniform float rough_k = 1.0;
uniform float metal = 0.0;
// light through a thin edge (calcite's translucent crust)
uniform float wrap = 0.0;
// how strongly the weather marks this family (stone takes slime and lime less than the porous brick)
uniform float weather_k = 1.0;
// a layer laid on another (runoff stains): its cover, dithered out where under it (no blending kind: no sorting)
uniform float cover = 1.0;
// UV in metres when 1 (box-mapped kit pieces): divide by the tile
uniform vec2 tile_m = vec2(1.0);
uniform float uv_metres = 0.0;
uniform float moss_tile = 1.2;
// a layer's depth bias (as psx: a share of the distance toward the eye)
uniform float depth_bias = 0.0;

varying vec3 world;
varying float fog_depth;
varying float sun_lit;
varying vec4 wx;
varying float bake_ao;
varying vec4 bake;
// how far the study's baked colour sets the colour (the masks' blend keeps the detail)
uniform float bake_k = 0.85;

void vertex() {
	vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -view.z;
	world = (INV_VIEW_MATRIX * view).xyz;
	POSITION = PROJECTION_MATRIX * vec4(view.xyz * (1.0 - depth_bias), 1.0);
	wx = COLOR;
	bake_ao = CUSTOM0.a > 0.0 ? CUSTOM0.a : 1.0;
	bake = vec4(CUSTOM0.rgb * CUSTOM0.rgb, step(0.0005, dot(CUSTOM0.rgb, vec3(1.0))));
	if (uv_metres > 0.5) UV /= tile_m;
}

void fragment() {
	vec3 to_frag = world - CAMERA_POSITION_WORLD;
	float len = length(to_frag);
	vec3 rd = to_frag / max(len, 1e-4);
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	if (!FRONT_FACING) nw = -nw;
	float covered = ruien_covered(world);
	vec2 uv = UV;
	mat3 tbn = ruien_tbn(nw, world, uv);
	// parallax occlusion near the eye, on faces seen at a slant it fades (no swimming at grazing angles)
	vec3 vt = transpose(tbn) * (-rd);
	vt /= max(length(vt), 1e-5);
	// (faded out at a slant, where parallax smears, and far off)
	float pom_k = pom * relief_m * (1.0 - smoothstep(4.0, 9.0, len)) * smoothstep(0.2, 0.5, vt.z);
	float m_per_uv = length(tbn[0]) > 0.0 ? max(length(dFdx(world)) + length(dFdy(world)), 1e-5) / max(length(dFdx(uv)) + length(dFdy(uv)), 1e-6) : 1.0;
	if (pom_k > 0.0005 && m_per_uv < 50.0) {
		vec2 shift = -vt.xy / max(vt.z, 0.35) * pom_k / max(m_per_uv, 1e-3);
		float layers = mix(16.0, 6.0, clamp(vt.z, 0.0, 1.0));
		float dl = 1.0 / layers;
		vec2 duv = shift * dl;
		float depth = 0.0;
		float hd = 1.0 - texture(hra_tex, uv).r;
		for (int i = 0; i < 16; i++) {
			if (depth >= hd || float(i) >= layers) break;
			uv += duv;
			depth += dl;
			hd = 1.0 - texture(hra_tex, uv).r;
		}
		float after = hd - depth;
		float before = (1.0 - texture(hra_tex, uv - duv).r) - (depth - dl);
		uv -= duv * clamp(after / min(after - before, -1e-4), 0.0, 1.0);
	}
	vec4 hra = texture(hra_tex, uv);
	float h = hra.r;
	vec3 dry = texture(albedo_tex, uv).rgb;
	// the weather, by cause (the vertex colour): wet and slimed low and under seeps, limed round deposits and down the
	// runnels (in the joints first), soot over the lamps and under the crown, moss in damp joints near daylight
	float wet = clamp(wx.r * weather_k, 0.0, 1.0);
	float lime = clamp(wx.g * weather_k, 0.0, 1.0);
	float soot = clamp(wx.b, 0.0, 1.0);
	float moss = clamp(wx.a, 0.0, 1.0);
	vec3 c;
	if (variants > 0.5) {
		vec3 sl = texture(slime_tex, uv).rgb;
		vec3 li = texture(lime_tex, uv).rgb;
		c = mix(dry, sl, smoothstep(0.05, 0.85, wet));
		// (the lime goes into the joints first, then over the brick faces: the round-9 halo)
		float lk = smoothstep(0.03, 0.5, lime * 1.3 + (0.5 - h) * 0.9 * lime);
		c = mix(c, li, lk);
	} else {
		c = dry * mix(vec3(1.0), vec3(0.5, 0.52, 0.42), smoothstep(0.1, 0.9, wet) * 0.8);
		float lk = smoothstep(0.05, 0.6, lime * 1.2 + (0.5 - h) * 0.6 * lime);
		c = mix(c, vec3(0.62, 0.6, 0.55) * (0.85 + 0.3 * h), lk * 0.85);
	}
	c *= mix(vec3(1.0), vec3(0.16, 0.14, 0.12), soot * (0.55 + 0.45 * h));
	vec3 nt = texture(normal_tex, uv).xyz * 2.0 - 1.0;
	float mk = moss * smoothstep(0.75, 0.15, h + moss * 0.35 - 0.2);
	if (mk > 0.001) {
		vec2 muv = world.xz / moss_tile + world.y * 0.37;
		vec3 mc = texture(moss_albedo, muv).rgb;
		c = mix(c, mc, mk);
		nt = mix(nt, texture(moss_normal, muv).xyz * 2.0 - 1.0, mk);
	}
	c *= tint.rgb;
	if (bake.a > 0.5 && bake_k > 0.0) {
		// the study's colour at this point, the pictures' variation round their own average (their smallest mip)
		vec3 avg = textureLod(albedo_tex, uv, 11.0).rgb * tint.rgb;
		if (variants > 0.5) avg = mix(avg, textureLod(lime_tex, uv, 11.0).rgb * tint.rgb, smoothstep(0.03, 0.5, lime * 1.3));
		vec3 detail = clamp(c / max(avg, vec3(0.02)), 0.0, 3.0);
		c = mix(c, bake.rgb * detail, bake_k);
	}
	nt.xy *= normal_k;
	nt.z = sqrt(max(1.0 - dot(nt.xy, nt.xy), 0.0));
	vec3 n = normalize(tbn * nt);
	// wet: darker (as porous stone goes) and glossy; lime and moss are matt
	float wet_all = clamp(wet + (1.0 - covered) * psx_wet * 0.6, 0.0, 1.0);
	c *= 1.0 - 0.35 * wet_all * (1.0 - lime);
	float rough = clamp(hra.g * rough_k * (1.0 - 0.88 * wet_all) + 0.5 * lime * (1.0 - wet) + 0.3 * mk, 0.04, 1.0);
	float gloss = (1.0 - rough) * (1.0 - smoothstep(25.0, 45.0, len));
	// (the bake's AO is taken softly: it came from a 0.6 m reach and would black out every joint and corner)
	float ao = hra.b * mix(1.0, bake_ao, 0.7);
	// cover: a stain laid over another surface: dithered, so it needs no blending
	if (cover < 0.999 && ruien_h12(FRAGCOORD.xy) > cover * (0.6 + 0.4 * h)) discard;

	vec3 V = -rd;
	vec3 diff, spec;
	ruien_lights_at(world, n, V, gloss, wrap, diff, spec);
	// metal: its colour in the glint, little diffuse
	vec3 spec_c = mix(vec3(1.0), c * 3.0, metal);
	// in the open: the street's sky (and the sun in light())
	vec3 sky = mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, n.y * 0.5 + 0.5) * (1.0 - covered);
	vec3 fill = ruien_fill.rgb * covered;
	sun_lit = 1.0 - covered;
	vec4 fog = ruien_fog(fog_depth, covered);
	vec3 halo = ruien_haze(CAMERA_POSITION_WORLD, rd, len);
	ALBEDO = c * (1.0 - metal * 0.6);
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	// a wet film: the lamps' glints stronger, and the lamps mirrored as soft streaks on it (the renders' wet coping)
	float film = smoothstep(0.3, 0.9, wet_all) * (1.0 - lime) * (1.0 - smoothstep(12.0, 30.0, len));
	vec3 streak = film > 0.001 ? ruien_streaks(world, reflect(rd, n), 0.6) * film * 0.12 : vec3(0.0);
	EMISSION = c * (1.0 - metal * 0.6) * (diff + (sky + fill) * ao) + spec * spec_c * ao * (1.0 + 2.5 * film) + streak + halo;
	FOG = vec4(fog.rgb + halo, fog.a);
}

void light() {
	// three's matt face, as psx: colour x light x cos / pi; the sun only in the open
	float a = ATTENUATION;
	if (LIGHT_IS_DIRECTIONAL) a *= sun_lit;
	DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR / PI;
}
