using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Godot;

namespace Scheldemist.Render;

/// <summary>
/// The houses grow old (the browser's world/houseGrime.ts, retro/psx.ts wallRelief and bumpFromMap): the plain wall
/// of the facade atlas drawn from pictures of weathered brick, stained plaster and render in the house's own paint,
/// with blotches, streaks, soot over the windows, runs under the sills, plaster fallen off a worn house, green-black
/// damp at the foot, worn paint on the doors and shutters, a film of coal smoke; the stone trim darker and streaked;
/// the walls' bump maps from the pictures' height maps (bands slid along the wall, so no picture repeats in a grid);
/// the bump maps of the floors and the rest (three's bump chunk); the grime decals (rust runs, soot, damp).
/// How worn a house is: its vertex colour's alpha. Which picture and paint: its third uv (CUSTOM0, the bake's gmat).
/// Psx.cs asks for these by the Kind's switches Grime, Bump and Decal.
/// </summary>
public static class Grime
{
    /// <summary>The wall pictures in the texture array's order, and how many metres one tile covers (houseGrime.ts WALL_PICS).</summary>
    private static readonly (string name, float tile)[] WallPics =
    {
        ("brick_fine", 2.1f), ("brick", 1.9f), ("brick_clinker", 2.2f), ("speklagen", 2.5f), ("brick_yellow", 1.7f), ("brick_yellow_old", 1.1f),
        ("brick_white", 1.2f), ("plaster_smooth", 3.0f), ("plaster_rough", 2.5f), ("plaster", 3.0f), ("render", 3.0f), ("ashlar_sand", 2.7f), ("ashlar_blue", 3.2f),
    };
    private const int Pic = 512;
    /// <summary>How hard each kind of wall stands out (psx.ts WALL_KIND_BUMP).</summary>
    private static readonly Dictionary<string, float> KindBump = new() { ["brick"] = 1, ["plaster"] = 0.12f, ["rough"] = 0.18f };

    private static readonly object Gate = new();
    private static bool made;
    private static ImageTexture? noise;
    private static Texture2DArray? pics, heights;
    private static readonly Vector4[] Hk = new Vector4[4], Bed = new Vector4[4];

    /// <summary>The shared pictures on a material that draws the houses' grime (made once, on first need).</summary>
    public static void Apply(ShaderMaterial m)
    {
        Make();
        m.SetShaderParameter("grime_noise", noise);
        if (pics != null) m.SetShaderParameter("wall_arr", pics);
        if (heights != null) m.SetShaderParameter("wall_h", heights);
        m.SetShaderParameter("wall_pics", pics != null ? 1f : 0f);
        m.SetShaderParameter("wall_hk", Hk);
        m.SetShaderParameter("wall_bed", Bed);
    }

    private static void Make()
    {
        lock (Gate)
        {
            if (made) return;
            made = true;
            noise = ImageTexture.CreateFromImage(Noise());
            try
            {
                LoadWalls();
            }
            catch (Exception e)
            {
                GD.Print("grime: the wall pictures did not load: the atlas's own paint shows (" + e.Message + ")");
                pics = heights = null;
            }
        }
    }

    /// <summary>A tileable noise, 128 px: r big blotches, g fine speckle, b streaks running down (houseGrime.ts grimeNoise, the same numbers).</summary>
    private static Image Noise()
    {
        const int n = 128;
        uint s = 1873;
        double Rnd() => (s = s * 1664525u + 1013904223u) / 4294967296.0;
        Func<double, double, double> Grid(int cells)
        {
            var v = new double[cells * cells];
            for (int i = 0; i < v.Length; i++) v[i] = Rnd();
            return (x, y) =>
            {
                double fx = x / n * cells, fy = y / n * cells;
                double x0 = Math.Floor(fx), y0 = Math.Floor(fy);
                double tx = fx - x0, ty = fy - y0;
                double sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
                double At(double i, double j) => v[(((int)j % cells) + cells) % cells * cells + ((((int)i % cells) + cells) % cells)];
                double a = At(x0, y0) * (1 - sx) + At(x0 + 1, y0) * sx;
                double b = At(x0, y0 + 1) * (1 - sx) + At(x0 + 1, y0 + 1) * sx;
                return a * (1 - sy) + b * sy;
            };
        }
        var big = new[] { Grid(4), Grid(8), Grid(16) };
        var fine = Grid(64);
        var cols = new double[n];
        for (int x = 0; x < n; x++) cols[x] = Rnd() < 0.35 ? Rnd() : Rnd() * 0.25;
        var run = Grid(4);
        var data = new byte[n * n * 4];
        for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                int i = (y * n + x) * 4;
                double b = big[0](x, y) * 0.55 + big[1](x, y) * 0.3 + big[2](x, y) * 0.15;
                double c = (cols[(x + n - 1) % n] + 2 * cols[x] + cols[(x + 1) % n]) / 4;
                data[i] = (byte)Math.Round(b * 255);
                data[i + 1] = (byte)Math.Round(fine(x, y) * 255);
                data[i + 2] = (byte)Math.Round(Math.Min(1, c * (0.4 + 0.9 * run(x * 0.25, y))) * 255);
                data[i + 3] = 255;
            }
        var im = Image.CreateFromData(n, n, false, Image.Format.Rgba8, data);
        im.GenerateMipmaps();
        return im;
    }

    private static string? Find(string file)
    {
        foreach (var d in Psx.SharedDirs())
            if (File.Exists(Path.Combine(d, file))) return Path.Combine(d, file);
        return null;
    }

    /// <summary>The 13 wall pictures, their height maps (only one made from the same picture: wall_heights.json's hash), their bump and bed joint.</summary>
    private static void LoadWalls()
    {
        var colour = new Godot.Collections.Array<Image>();
        var height = new Godot.Collections.Array<Image>();
        var made = Find("wall_heights.json") is { } hj ? JsonDocument.Parse(File.ReadAllText(hj)).RootElement : default;
        var hk = new float[16];
        var bed = Enumerable.Repeat(-1f, 16).ToArray();
        for (int i = 0; i < WallPics.Length; i++)
        {
            string name = WallPics[i].name;
            string file = Find($"wall_{name}.jpg") ?? throw new FileNotFoundException($"wall_{name}.jpg");
            var im = Image.LoadFromFile(file);
            im.Convert(Image.Format.Rgba8);
            if (im.GetWidth() != Pic || im.GetHeight() != Pic) im.Resize(Pic, Pic, Image.Interpolation.Bilinear);
            im.GenerateMipmaps();
            colour.Add(im);
            var h = Image.CreateEmpty(Pic, Pic, false, Image.Format.R8);
            if (made.ValueKind == JsonValueKind.Object && made.TryGetProperty(name, out var m) && Find($"wall_{name}_h.png") is { } hf)
            {
                string sha = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant();
                if (sha != m.GetProperty("sha256").GetString())
                    GD.Print($"grime: wall_{name}_h.png was made from another picture: that wall stays flat (tools/textures/wall_heights.py {name})");
                else
                {
                    h = Image.LoadFromFile(hf);
                    if (h.GetWidth() != Pic || h.GetHeight() != Pic) h.Resize(Pic, Pic, Image.Interpolation.Bilinear);
                    h.Convert(Image.Format.R8);
                    string kind = m.TryGetProperty("kind", out var k) ? k.GetString() ?? "" : "";
                    hk[i] = m.TryGetProperty("bump", out var b) && b.ValueKind == JsonValueKind.Number ? b.GetSingle() : KindBump.GetValueOrDefault(kind, 1);
                    // (bricks and stones only: the colour and the height map take the bands together)
                    if (kind == "brick") bed[i] = BedJoint(h.GetData());
                }
            }
            h.GenerateMipmaps();
            height.Add(h);
        }
        pics = new Texture2DArray();
        pics.CreateFromImages(colour);
        heights = new Texture2DArray();
        heights.CreateFromImages(height);
        for (int i = 0; i < 4; i++)
        {
            Hk[i] = new Vector4(hk[i * 4], hk[i * 4 + 1], hk[i * 4 + 2], hk[i * 4 + 3]);
            Bed[i] = new Vector4(bed[i * 4], bed[i * 4 + 1], bed[i * 4 + 2], bed[i * 4 + 3]);
        }
    }

    /// <summary>
    /// The row of a height map that is most nearly all joint from side to side, as v 0..1, or -1 when none is
    /// (psx.ts bedJoint: the joints are the lowest third; a row counts when, within 2 px, 96 % of its columns are joint).
    /// </summary>
    private static float BedJoint(byte[] h)
    {
        const int N = Pic;
        var hist = new int[256];
        for (int p = 0; p < N * N; p++) hist[h[p]]++;
        int acc = 0, p30 = 0;
        while (p30 < 255 && (acc += hist[p30]) < N * N * 0.3) p30++;
        int best = -1, bestCov = 0;
        for (int r = 0; r < N; r++)
        {
            int cov = 0;
            for (int x = 0; x < N; x++)
            {
                int lo = 255;
                for (int d = -2; d <= 2; d++) lo = Math.Min(lo, h[((r + d + N) % N) * N + x]);
                if (lo < p30) cov++;
            }
            if (cov > bestCov) (bestCov, best) = (cov, r);
        }
        return bestCov >= N * 0.96 ? (best + 0.5f) / N : -1;
    }

    // ------------------------------------------------------------------ the GLSL

    /// <summary>The uniforms and functions the grime code reads (houseGrime.ts COMMON, psx.ts wallReliefGlsl).</summary>
    public static string CommonGlsl => @"
uniform sampler2D grime_noise : filter_linear_mipmap, repeat_enable;
uniform sampler2DArray wall_arr : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2DArray wall_h : filter_linear_mipmap, repeat_enable;
uniform float wall_pics = 0.0;
uniform vec4 wall_hk[4];
uniform vec4 wall_bed[4];
varying vec2 gmat;
const float WALL_TILE[13] = float[13](" + string.Join(", ", WallPics.Select(w => w.tile.ToString("0.0###", System.Globalization.CultureInfo.InvariantCulture))) + @");
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
	float h = fract(sin(b * 12.9898 + key * 78.233) * 43758.5453);
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
";

    /// <summary>
    /// Before the vertex colour: the wall's picture, the blotches, streaks, runs, soot, fallen plaster, the damp at the
    /// foot (houseGrime.ts install, the block before color_fragment). Reads c, raw_uv (the uv before the atlas), cell,
    /// world, len; writes c and wall_dn. facade: the atlas's walls; else the stone trim.
    /// </summary>
    public static string BeforeColourGlsl(bool facade) => @"	{
		float g_wear = COLOR.a;
		vec3 g_n = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
		float g_vert = 1.0 - abs(g_n.y);
		vec2 g_w = g_wall_uv(g_n, world);
		vec4 g_nz = vec4(g_fbm(g_w / 1.25), 0.0, 0.0, 0.0);
		vec4 g_nf = texture(grime_noise, g_w / 1.3);
		float g_streak = clamp((smoothstep(0.5, 0.95, g_val(vec2(g_w.x / 0.3, 0.37))) * 0.9 + 0.12 * g_val(vec2(g_w.x / 0.13, 5.1))) * (0.4 + 0.9 * g_val(vec2(g_w.x / 2.0, g_w.y / 5.0))), 0.0, 1.0);
" + (facade ? @"		vec2 g_cell = floor(cell + 0.5);
		vec2 g_lc = fract(raw_uv);
		bool g_wall_cell = (g_cell.x < 3.5 && g_cell.y < 3.5) || g_cell.y > 6.5;
		float g_fill = g_wall_cell ? 1.0 - step(0.75, c.a) : 0.0;
		if (g_fill > 0.5 && wall_pics > 0.5) {
			// the plain wall from the house's own picture, in its paint (the painted ones) or a slight tint
			float layer = clamp(floor(gmat.x + 0.5), 0.0, 12.0);
			float g_pi = clamp(floor(1.5 - gmat.y), 0.0, 19.0);
			vec3 g_paint = PAINT[int(g_pi)];
			vec2 g_raw = g_w / WALL_TILE[int(layer)];
			vec3 g_t = wall_tile_uv(layer, g_raw, floor(atan(g_n.z, g_n.x) * 1.27 + 4.5) + g_pi * 9.1 + layer * 3.7);
			vec2 g_gx = dFdx(g_raw), g_gy = dFdy(g_raw);
			vec3 pic = g_pic_uv(layer, g_t.xy, g_raw) * g_paint;
			if (layer < 5.5 || layer > 10.5) {
				// bricks and stones: stretches of other bricks where it was patched, fresh pointing, smoke in soft clouds
				float g_b = g_fbm(g_w / 3.3 + 7.1) - 0.5;
				float g_m2 = g_val(g_w / 1.4 - 3.7) - 0.5;
				pic *= 1.0 + g_b * 0.32 + g_m2 * 0.14;
				float g_patch = smoothstep(0.62, 0.7, g_val(vec2(g_w.x / 2.4, g_w.y / 1.1) + 31.3));
				pic *= mix(vec3(1.0), vec3(1.1, 0.95, 0.86), g_patch * 0.7);
				if (wall_hk_of(int(layer)) > 0.0) {
					float g_j = 1.0 - smoothstep(0.25, 0.55, wall_hgt(g_t.xy, layer, g_gx, g_gy));
					float g_point = smoothstep(0.55, 0.68, g_val(g_w / 2.8 - 13.9));
					pic = mix(pic, pic * 0.55 + vec3(0.2, 0.19, 0.17), g_j * g_point * 0.6);
				}
			}
			if (layer > 5.5 && layer < 10.5) {
				// plaster and limewash: the picture's own patches flattened, the weathering drawn here
				vec3 g_flat = textureLod(wall_arr, vec3(g_t.xy, layer), 6.0).rgb * g_paint;
				pic = mix(g_flat, pic, 0.4);
				float g_st = g_fbm(vec2(g_w.x / 0.85 + 0.37, g_w.y / 3.0)) * 0.8 + g_val(vec2(g_w.x / 0.28, g_w.y / 1.0)) * 0.2;
				pic *= mix(vec3(1.0), vec3(0.8, 0.75, 0.66), smoothstep(0.45, 0.8, g_st) * (0.2 + 0.8 * g_wear));
				// plaster fallen off a worn house: ragged holes to the brick, most near the foot
				if (g_wear > 0.55) {
					vec2 g_wp = g_w + (vec2(g_nf.g, texture(grime_noise, g_w / 0.8 + 0.5).g) - 0.5) * 0.7;
					float g_m = g_fbm(vec2(g_wp.x / 1.1, g_wp.y / 0.65) + 0.21) * 0.8 + texture(grime_noise, g_wp / 0.9).g * 0.2;
					float g_mu = g_fbm(vec2(g_wp.x / 1.1, (g_wp.y + 0.05) / 0.65) + 0.21) * 0.8 + texture(grime_noise, vec2(g_wp.x, g_wp.y + 0.05) / 0.9).g * 0.2;
					float g_low = 1.0 - smoothstep(0.4, 3.0, world.y);
					float g_thr = 0.74 - 0.08 * (g_wear - 0.55) / 0.45 - 0.1 * g_low;
					float g_off = step(g_thr, g_m);
					float g_rim = step(g_thr - 0.02, g_m) - g_off;
					vec3 g_brick = g_pic(1.0, g_w) * mix(vec3(1.0), vec3(0.75, 0.72, 0.66), g_low);
					pic = mix(pic, g_brick, g_off);
					pic = mix(pic, pic * 1.1 + 0.02, g_rim * 0.7);
					pic *= 1.0 - 0.35 * g_off * (1.0 - step(g_thr, g_mu));
				}
			}
			c.rgb = albedo.rgb * pic * 1.08;
			// the bump maps on the walls: the picture's height map
			c.rgb *= wall_relief(layer, g_t.xy, g_t.z, g_n, len, g_gx, g_gy, wall_dn);
		}
		if (g_wall_cell) {
			// under every sill a dark run of water, over every window soot, fading into the wall
			bool g_up = g_cell.y > 6.5 || (g_cell.x > 0.5 && g_cell.x < 1.5);
			bool g_shop = g_cell.x < 0.5 && g_cell.y < 3.5;
			if (g_up || g_shop) {
				float a0 = g_up ? 0.3 : 0.17, a1 = g_up ? 0.7 : 0.83;
				float col = smoothstep(a0 - 0.04, a0 + 0.04, g_lc.x) * (1.0 - smoothstep(a1 - 0.04, a1 + 0.04, g_lc.x));
				float run = smoothstep(0.0, 0.14, g_lc.y) * (1.0 - step(0.14, g_lc.y)) * (0.45 + 0.9 * g_streak);
				float soot = g_up ? smoothstep(0.875, 0.97, g_lc.y) : 0.0;
				c.rgb *= 1.0 - col * (run * 0.45 + soot * 0.3) * (0.35 + 0.65 * g_wear);
			}
			c.rgb *= 1.0 - (g_nz.r - 0.45) * 0.2 * g_wear;
			c.rgb *= 1.0 - g_streak * 0.38 * g_wear * g_vert;
		}
" : @"		// stone (sills, heads, cornices, quoins, kerbs): darker with the years, streaked
		c.rgb *= (1.0 - 0.28 * g_wear) * (1.0 - g_streak * 0.3 * g_wear * g_vert) * (1.0 - (g_nz.r - 0.45) * 0.3 * g_wear);
") + @"		// more soot the higher up (the town's chimneys), and on the cornices
		c.rgb *= 1.0 - smoothstep(4.5, 14.0, world.y) * 0.32 * g_wear;
		// green-black damp rising from the street: higher on a worn house, a ragged top edge
		float g_top = 0.45 + 0.85 * g_wear + 0.35 * (g_nf.g - 0.5) + 0.25 * (g_nz.r - 0.5);
		float g_damp = (1.0 - smoothstep(g_top - 0.3, g_top, world.y)) * g_vert;
		c.rgb *= mix(vec3(1.0), vec3(0.34, 0.39, 0.28), g_damp * (0.75 + 0.25 * g_wear));
		c.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.18, world.y)) * 0.3 * g_vert;
	}
";

    /// <summary>After the vertex colour, the facade's: worn paint on doors, gates and shutters, the film of coal smoke.</summary>
    public const string AfterColourGlsl = @"	{
		float g_wear = COLOR.a;
		vec2 g_cell2 = floor(cell + 0.5);
		vec2 g_lc2 = fract(raw_uv);
		bool g_leaf = (g_cell2.y > 3.5 && g_cell2.y < 4.5 && g_cell2.x > 3.5) || (g_cell2.y > 5.5 && g_cell2.y < 6.5 && g_cell2.x > 3.5 && g_cell2.x < 6.5)
			|| (g_cell2.y > 4.5 && g_cell2.y < 5.5 && g_cell2.x > 5.5 && g_cell2.x < 6.5) || (g_cell2.y > 1.5 && g_cell2.y < 2.5 && g_cell2.x > 3.5 && g_cell2.x < 5.5);
		if (g_leaf) {
			vec2 g_p = g_wall_uv(normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz), world) * 1.6 + cell * 0.37;
			float fl = texture(grime_noise, g_p).r * 0.7 + texture(grime_noise, g_p * 3.0).r * 0.3;
			float edge = max(1.0 - smoothstep(0.0, 0.08, min(g_lc2.x, 1.0 - g_lc2.x)), 1.0 - smoothstep(0.0, 0.3, g_lc2.y));
			float flake = smoothstep(0.72 - 0.12 * g_wear - 0.15 * edge, 0.75 - 0.12 * g_wear - 0.15 * edge, fl);
			c.rgb = mix(c.rgb, vec3(0.13, 0.115, 0.1), flake * 0.5 * g_wear);
			c.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.16, g_lc2.y)) * 0.35 * g_wear;
		}
		// over all of it a brown-black film of coal smoke: darker, never grey
		c.rgb *= mix(vec3(1.0), vec3(0.8, 0.76, 0.7), g_wear);
	}
";

    /// <summary>
    /// three's bump chunk (psx.ts bumpParsGlsl): the height's change per pixel counted at 270 lines, stronger up close;
    /// atlas: the height map read in the same cell, the neighbours wrapped inside it (atlasBumpGlsl).
    /// </summary>
    public static string BumpGlsl(int atlas) => @"
uniform sampler2D bump_map : filter_linear_mipmap, repeat_enable;
uniform float bump_scale = 1.0;
float psx_bump_gain(vec2 dx, vec2 dy, vec2 size, float res) {
	float tpp = max(length(dx * size), length(dy * size)) * res;
	return mix(2.5, 1.0, smoothstep(2.0, 8.0, tpp));
}
vec2 bump_dh(vec2 raw, vec2 cl, float res) {
	vec2 dx = dFdx(raw);
	vec2 dy = dFdy(raw);
" + (atlas > 0 ? $@"	vec2 gx = dx / {atlas}.0;
	vec2 gy = dy / {atlas}.0;
	float hll = bump_scale * textureGrad(bump_map, (cl + fract(raw)) / {atlas}.0, gx, gy).x;
	float dbx = bump_scale * textureGrad(bump_map, (cl + fract(raw + dx)) / {atlas}.0, gx, gy).x - hll;
	float dby = bump_scale * textureGrad(bump_map, (cl + fract(raw + dy)) / {atlas}.0, gx, gy).x - hll;
	return vec2(dbx, dby) * res * psx_bump_gain(gx, gy, vec2(textureSize(bump_map, 0)), res);
" : @"	float hll = bump_scale * texture(bump_map, raw).x;
	float dbx = bump_scale * texture(bump_map, raw + dx).x - hll;
	float dby = bump_scale * texture(bump_map, raw + dy).x - hll;
	return vec2(dbx, dby) * res * psx_bump_gain(dx, dy, vec2(textureSize(bump_map, 0)), res);
") + @"}
vec3 bump_normal(vec3 surf_pos, vec3 surf_norm, vec2 dh) {
	vec3 sx = normalize(dFdx(surf_pos));
	vec3 sy = normalize(dFdy(surf_pos));
	vec3 r1 = cross(sy, surf_norm);
	vec3 r2 = cross(surf_norm, sx);
	float det = dot(sx, r1);
	vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
	return normalize(abs(det) * surf_norm - grad);
}
";

    /// <summary>
    /// The grime decals (houseGrime.ts grimeDecalMaterial): rust runs, soot, damp, corner grime, the ghost of a pulled-down
    /// house's plaster. The tint laid over the wall as much as the cell's alpha times the house's wear; the fog washes
    /// it out; lit by the day's light (the fog's colour); no depth written, pulled a little toward the eye.
    /// </summary>
    public const string DecalShader = @"shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
global uniform vec4 psx_mir0;
global uniform vec4 psx_mir1;
uniform sampler2D tex : source_color, filter_linear_mipmap, repeat_enable;
uniform float cells = 4.0;
varying vec2 cell;
varying float fog_depth;
varying vec3 world;
void vertex() {
	cell = UV2;
	vec4 v = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -v.z;
	world = (INV_VIEW_MATRIX * v).xyz;
	// (three's polygon offset: never fights the wall under it)
	v.xyz *= 0.9985;
	POSITION = PROJECTION_MATRIX * v;
}
void fragment() {
	if ((world.y < psx_mir0.w - 0.02 && distance(CAMERA_POSITION_WORLD, psx_mir0.xyz) < 0.02) || (world.y < psx_mir1.w - 0.02 && distance(CAMERA_POSITION_WORLD, psx_mir1.xyz) < 0.02)) discard;
	float a = texture(tex, (floor(cell + 0.5) + fract(UV)) / cells).a * COLOR.a;
	a *= 1.0 - smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	float light = clamp(dot(psx_fog_color.rgb, vec3(0.3, 0.59, 0.11)) / 0.125, 0.06, 1.0);
	ALBEDO = COLOR.rgb * light;
	ALPHA = a;
}
";
}
