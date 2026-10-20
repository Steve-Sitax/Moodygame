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
uniform float rough_floor = 0.08;
uniform float grit = 0.0;
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
// how much the moss mask grows moss on this family (silt banks: hardly; the study's moss is on lit masonry joints)
uniform float moss_k = 1.0;
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
// how strongly the lime halo, bloom and salt flecks show over the bake (brick families with their own pictures)
uniform float halo_k = 1.0;
// the halo's slow mottle (20 cm), taken at the vertices: cheaper than per pixel, and the relief is that fine
varying float halo_n;
// the lime's slow variation from bay to bay (about 3 m): the study laid the same halo on every rib and groin
varying float lime_mod;

void vertex() {
	vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -view.z;
	world = (INV_VIEW_MATRIX * view).xyz;
	POSITION = PROJECTION_MATRIX * vec4(view.xyz * (1.0 - depth_bias), 1.0);
	wx = COLOR;
	halo_n = COLOR.g > 0.04 ? ruien_noise3(world * 5.0) : 0.5;
	lime_mod = COLOR.g > 0.04 ? 0.3 + 1.0 * ruien_noise3(world * 0.33 + vec3(5.7, 1.3, 2.9)) : 1.0;
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
	// The brick sets paint a few missing bricks black. The courses are now unfolded across the mesh, so they no longer
	// fall on the geometry's own chipped recesses: lay the brick one course up (half a brick along) into the slot.
	if (variants > 0.5 && dot(dry, vec3(0.333)) < 0.018) {
		uv += vec2(0.0208, 0.025);
		hra = texture(hra_tex, uv);
		h = hra.r;
		dry = texture(albedo_tex, uv).rgb;
	}
	// the weather, by cause (the vertex colour): wet and slimed low and under seeps, limed round deposits and down the
	// runnels (in the joints first), soot over the lamps and under the crown, moss in damp joints near daylight
	float wet = clamp(wx.r * weather_k, 0.0, 1.0);
	float lime = clamp(wx.g * weather_k * lime_mod, 0.0, 1.0);
	// (broken up in world space at 15 cm: on coarse triangles the vertex mask alone draws straight-edged blotches)
	if (lime > 0.02) lime = clamp(lime * mix(0.5, 1.35, ruien_noise3(world * 6.5 + vec3(1.7, 0.3, 4.1))), 0.0, 1.0);
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
	float mk = moss * moss_k * smoothstep(0.75, 0.15, h + moss * 0.35 - 0.2);
	if (mk > 0.001) {
		vec2 muv = world.xz / moss_tile + world.y * 0.37;
		vec3 mc = texture(moss_albedo, muv).rgb;
		c = mix(c, mc * 0.5, mk);
		nt = mix(nt, texture(moss_normal, muv).xyz * 2.0 - 1.0, mk);
	}
	c *= tint.rgb;
	if (grit > 0.0) c *= mix(1.0, 0.72 + 0.48 * ruien_noise3(world * 180.0) + 0.16 * ruien_noise3(world * 17.0), grit);
	if (bake.a > 0.5 && bake_k > 0.0) {
		// the study's colour at this point, the pictures' variation round their own average (their smallest mip)
		vec3 avg = textureLod(albedo_tex, uv, 11.0).rgb;
		vec3 detail = clamp(dry / max(avg, vec3(0.02)), 0.0, 3.0);
		// (lime and moss keep their own pictures' grain over the bake's colour)
		if (variants > 0.5) detail = mix(detail, clamp(texture(lime_tex, uv).rgb / max(textureLod(lime_tex, uv, 11.0).rgb, vec3(0.02)), 0.0, 3.0), smoothstep(0.03, 0.5, lime * 1.3));
		c = mix(c, bake.rgb * detail * tint.rgb, bake_k);
	}
	// the study's lime (its halo and bloom layers, carried in the mask's G, which the bake's vertices sample too
	// sparsely to show): white lime in the joints, white salt flecks over the faces, and a mottled pale wash where it
	// is thickest; laid over the bake
	// (the flecks' size on screen, taken outside the branch: derivatives need every pixel of the quad)
	// (a plane for the 2D noise: the floor's and the vault crown's on xz, the walls' upright)
	vec2 wp = abs(nw.y) > 0.6 ? world.xz : vec2(world.x + world.z * 1.3, world.y);
	vec2 fp = wp * 150.0;
	float fpw = length(fwidth(fp));
	if (halo_k > 0.0 && variants > 0.5 && lime > 0.04) {
		float hal = clamp(lime * mix(0.55, 1.35, halo_n), 0.0, 1.0);
		float mortar = smoothstep(0.8, 0.73, h);
		float n22 = ruien_noise(wp * 22.0 + 7.1);
		float wash = smoothstep(0.55, 1.0, hal * mix(0.35, 1.5, n22));
		vec3 washc = mix(vec3(0.58, 0.56, 0.52), vec3(0.74, 0.72, 0.67), fract(n22 * 7.3));
		c = mix(c, washc * tint.rgb, wash * 0.7 * halo_k);
		// (the flecks fade to their share where they would be smaller than a pixel)
		float fk = 1.0 - smoothstep(0.5, 1.5, fpw);
		float fl = clamp(lime * 0.45, 0.0, 0.4);
		if (fk > 0.001) fl = mix(fl, step(0.7 - lime * 0.22, ruien_noise(fp)), fk);
		c = mix(c, vec3(0.8, 0.78, 0.73) * tint.rgb, fl * smoothstep(0.05, 0.35, lime) * (1.0 - mortar) * 0.9 * halo_k);
		c = mix(c, vec3(0.8, 0.78, 0.73) * tint.rgb, smoothstep(0.08, 0.4, hal) * mortar * halo_k);
	}
	nt.xy *= normal_k;
	nt.z = sqrt(max(1.0 - dot(nt.xy, nt.xy), 0.0));
	vec3 n = normal_k > 0.001 ? normalize(tbn * nt) : nw;
	// wet: darker (as porous stone goes) and glossy; lime and moss are matt
	float wet_all = clamp(wet + (1.0 - covered) * psx_wet * 0.6, 0.0, 1.0);
	c *= 1.0 - 0.35 * wet_all * (1.0 - lime) * (bake.a > 0.5 ? 1.0 - bake_k : 1.0);
	float rough = clamp(hra.g * rough_k * (1.0 - 0.88 * wet_all) + 0.5 * lime * (1.0 - wet) + 0.3 * mk, rough_floor, 1.0);
	float gloss = (1.0 - rough) * (1.0 - smoothstep(25.0, 45.0, len));
	// (the bake's AO is taken softly: it came from a 0.6 m reach and would black out every joint and corner)
	float ao = hra.b * mix(1.0, bake_ao, 0.7);
	// cover: a stain laid over another surface: dithered, so it needs no blending
	// (in world space and coherent, so the stain's broken edge stays put as you move; and mottled)
	if (cover < 0.999) {
		if (ruien_noise3(world * 45.0) > cover * (0.6 + 0.4 * h) + 0.2) discard;
		c *= mix(0.8, 1.15, ruien_noise3(world * 25.0 + 1.3));
	}

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
	// (mirrored off the film, which lies smooth over the grain: the stone's own relief must not stripe the streaks)
	vec3 streak = film > 0.001 ? ruien_streaks(world, reflect(rd, normalize(mix(nw, n, 0.25))), 0.6) * film * 0.12 * (1.0 - 0.6 * rough) : vec3(0.0);
	EMISSION = c * (1.0 - metal * 0.6) * ((diff + sky + fill) * ao) + spec * spec_c * ao * (1.0 + 0.8 * film) + streak + halo;
	FOG = vec4(fog.rgb + halo, fog.a);
}

void light() {
	// three's matt face, as psx: colour x light x cos / pi; the sun only in the open
	float a = ATTENUATION;
	if (LIGHT_IS_DIRECTIONAL) a *= sun_lit;
	DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR / PI;
}
