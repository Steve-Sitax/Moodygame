using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using Godot;

namespace Scheldemist.Render;

/// <summary>
/// The PS1 material (the browser's retro/psx.ts): vertex snap past arm's length, affine texture warp, the houses'
/// atlas cells, the fog with its reach and the lamps' glow in it, light from the sky's two colours kept off by the
/// houses, the sun with the houses' shadows, the paving's relief, wet stone and puddles, the patches and the dirt,
/// the foot of the walls, the light spilt from lamps and lit windows. One shader per set of switches (Kind), kept
/// and shared (docs/rendering.md: no new shader kinds without need); everything else is a uniform.
///
/// How the light is put together. three.js counts a matt face as colour x (sky + sun + lamps), then psx.ts works on
/// the lit colour (wet stone darker, puddles, the fog, the glow). Godot lights after fragment(), so the same sum is
/// written as: ALBEDO = colour x k (what the sun and any real light multiply), EMISSION = colour x k x (sky + spilt
/// light) + what is added (glints, the puddle's picture, the glow), FOG = the air's colour and how much of it.
/// </summary>
public static class Psx
{
    /// <summary>
    /// The switches that make another shader. Relief: 0 none, 1 a height map, 2 with stone ids. Ground: wet stone,
    /// puddles, patches and dirt (their amounts are uniforms). Wall: the foot's dirt and the mottle. Water: 1 the
    /// river and the docks (waves, foam at the walls, the dark mirror), 2 a sheltered pond (the same, calmer).
    /// Indoor: a room's own light instead of the sky's and the sun's (World/Rooms.cs gives it per mesh). Grime: the
    /// houses' age (Render/Grime.cs), 1 the facade atlas's walls, 2 the stone trim. Bump: a bump map (three's bump
    /// chunk). Decal: the houses' grime decals (a shader of their own). Tree: the sway in the wind and the gale
    /// (trees3d.ts): 1 bark, 2 leaves, 3 and 4 the same for the park's plants (one mesh, each vertex's foot in CUSTOM0),
    /// 5 the falling leaves (World/Trees.cs).
    /// </summary>
    public record struct Kind(bool Unlit, bool Blend, bool Scissor, bool TwoSided, bool DepthWrite, bool Snap, int Atlas, bool VertexColor, bool Add, bool Fog,
        int Relief = 0, bool Parallax = false, bool Detile = false, bool Ground = false, bool Wall = false, bool Slabs = false, bool Far = false, int Water = 0, bool Indoor = false,
        int Grime = 0, bool Bump = false, bool Decal = false, int Tree = 0);

    private static readonly Dictionary<Kind, Shader> Shaders = new();
    private static readonly Dictionary<Shader, Kind> Kinds = new();
    /// <summary>The switches a psx shader was made with (a part that needs the same material with one more).</summary>
    public static Kind? KindOf(Shader? s) => s != null && Kinds.TryGetValue(s, out var k) ? k : null;

    /// <summary>A hex colour (sRGB, as the TypeScript writes them) as the linear colour the shaders count in.</summary>
    public static Color Hex(int h) => new Color(((h >> 16) & 255) / 255f, ((h >> 8) & 255) / 255f, (h & 255) / 255f).SrgbToLinear();

    public const int MaxLamps = 6;
    /// <summary>The spill sources worked out per pixel (psx.ts MAX_SPILL).</summary>
    public const int MaxSpill = 48;
    private static readonly string[] LampNames = new[] { "psx_lamp0", "psx_lamp1", "psx_lamp2", "psx_lamp3", "psx_lamp4", "psx_lamp5" };
    private static readonly Vector4 NoLamp = new(0, -999, 0, 0);

    /// <summary>
    /// The values every psx material reads (the browser's psxUniforms), as global shader uniforms. The first ones are
    /// in project.godot; the rest are added here, before the first shader is made, so a new one needs no project edit.
    /// Colours are linear numbers (plain vec4: no conversion on the way).
    /// </summary>
    private static readonly (string name, RenderingServer.GlobalShaderParameterType type, Variant value)[] Added =
    {
        ("psx_sun_dir", RenderingServer.GlobalShaderParameterType.Vec3, new Vector3(0, 1, 0)),
        ("psx_sun_shade", RenderingServer.GlobalShaderParameterType.Float, 1f),
        ("psx_scatter", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_wet", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_rain", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_puddle", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_sea", RenderingServer.GlobalShaderParameterType.Float, 1f),
        ("psx_storm", RenderingServer.GlobalShaderParameterType.Float, 0f),
        // the gale (main.ts uGale): the way the wind blows (x, z) and how hard it bends the trees now (0 any calm day)
        ("psx_gale", RenderingServer.GlobalShaderParameterType.Vec3, new Vector3(1, 0, 0)),
        // the nearest lit gas lamps (the browser's uLamps, MAX_LAMPS 6): xyz the flame, w its brightness now
        ("psx_lamp0", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp1", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp2", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp3", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp4", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp5", RenderingServer.GlobalShaderParameterType.Vec4, NoLamp),
        ("psx_lamp_color", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(1.0f, 0.62f, 0.28f, 1)),
        // the sky over the streets (tools/city/skyshade.mjs) and where it lies: x0, z0, w, h; 0 until its picture is in
        ("psx_sky_box", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(-385, -80, 634, 453)),
        ("psx_sky_on", RenderingServer.GlobalShaderParameterType.Float, 0f),
        // grime and mud on the paving (world/dirt.ts) and where it lies
        ("psx_dirt_box", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(-365, -80, 594, 433)),
        // how many spill sources are in the list now (the rows of psx_spill)
        ("psx_spill_n", RenderingServer.GlobalShaderParameterType.Int, 0),
        // the sky's fill light now against the bake's (cathedralOutside.ts skyFill: an emissive that follows the sky)
        ("psx_fill", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(1, 1, 1, 1)),
        // where the shore map (the distance from the water to the nearest quay wall) and the foul water map lie
        ("psx_shore_box", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(-425, -80, 714, 493)),
        ("psx_foul_box", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(-365, -80, 594, 433)),
        // the mirrors (World/Mirrors.cs): world -> the river's picture and the puddles', 1 while each is drawn, and each
        // mirror's own camera with its plane's height (nothing under a mirror's plane is drawn in it)
        ("psx_water_mirror_mat", RenderingServer.GlobalShaderParameterType.Mat4, Projection.Identity),
        ("psx_water_mirror_on", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_mirror_mat", RenderingServer.GlobalShaderParameterType.Mat4, Projection.Identity),
        ("psx_mirror_columns", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_water_mirror_col0", RenderingServer.GlobalShaderParameterType.Vec4, Projection.Identity.X),
        ("psx_water_mirror_col1", RenderingServer.GlobalShaderParameterType.Vec4, Projection.Identity.Y),
        ("psx_water_mirror_col2", RenderingServer.GlobalShaderParameterType.Vec4, Projection.Identity.Z),
        ("psx_water_mirror_col3", RenderingServer.GlobalShaderParameterType.Vec4, Projection.Identity.W),
        ("psx_mirror_col0", RenderingServer.GlobalShaderParameterType.Vec4, Projection.Identity.X),
        ("psx_mirror_col1", RenderingServer.GlobalShaderParameterType.Vec4, Projection.Identity.Y),
        ("psx_mirror_col2", RenderingServer.GlobalShaderParameterType.Vec4, Projection.Identity.Z),
        ("psx_mirror_col3", RenderingServer.GlobalShaderParameterType.Vec4, Projection.Identity.W),
        ("psx_mirror_on", RenderingServer.GlobalShaderParameterType.Float, 0f),
        ("psx_mir0", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(0, -1e6f, 0, 0)),
        ("psx_mir1", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(0, -1e6f, 0, 0)),
    };
    private static bool globalsIn;
    /// <summary>
    /// Dev, to measure what a feature costs: -- --psx-off relief,ground,wall,shade,spill,grime,bump leaves those out (the
    /// paving's relief and slabs; wet, puddles and patches; the foot of the walls and the mottle; the houses' shadows and
    /// sky shade; the spilt light; the houses' age; the bump maps).
    /// </summary>
    private static readonly HashSet<string> Off = new((Array.IndexOf(OS.GetCmdlineUserArgs(), "--psx-off") is var i and >= 0 && i + 1 < OS.GetCmdlineUserArgs().Length ? OS.GetCmdlineUserArgs()[i + 1] : "").Split(',', StringSplitOptions.RemoveEmptyEntries));
    private static ImageTexture? skyShade, dirt, spill, shore, foul;
    private static Image? spillImage;
    private static readonly float[] SpillData = new float[MaxSpill * 4 * 4];
    private static readonly byte[] SpillBytes = new byte[MaxSpill * 4 * 4 * 4];

    public static void EnsureGlobals()
    {
        if (globalsIn) return;
        globalsIn = true;
        foreach (var (name, type, value) in Added) RenderingServer.GlobalShaderParameterAdd(name, type, value);
        // the pictures every material shares: stand-ins until theirs are in (LoadShared)
        skyShade = Flat(Colors.White);
        dirt = Flat(Colors.Black);
        spillImage = Image.CreateEmpty(MaxSpill, 4, false, Image.Format.Rgbaf);
        spill = ImageTexture.CreateFromImage(spillImage);
        RenderingServer.GlobalShaderParameterAdd("psx_sky_shade", RenderingServer.GlobalShaderParameterType.Sampler2D, skyShade.GetRid());
        RenderingServer.GlobalShaderParameterAdd("psx_dirt", RenderingServer.GlobalShaderParameterType.Sampler2D, dirt.GetRid());
        RenderingServer.GlobalShaderParameterAdd("psx_spill", RenderingServer.GlobalShaderParameterType.Sampler2D, spill.GetRid());
        // (until theirs are in: no wall anywhere near, clean water everywhere)
        shore = Flat(Colors.White);
        foul = Flat(Colors.Black);
        RenderingServer.GlobalShaderParameterAdd("psx_shore", RenderingServer.GlobalShaderParameterType.Sampler2D, shore.GetRid());
        RenderingServer.GlobalShaderParameterAdd("psx_foul", RenderingServer.GlobalShaderParameterType.Sampler2D, foul.GetRid());
        RenderingServer.GlobalShaderParameterAdd("psx_water_mirror", RenderingServer.GlobalShaderParameterType.Sampler2D, foul.GetRid());
        RenderingServer.GlobalShaderParameterAdd("psx_mirror", RenderingServer.GlobalShaderParameterType.Sampler2D, foul.GetRid());
    }

    private static ImageTexture Flat(Color c)
    {
        var im = Image.CreateEmpty(1, 1, false, Image.Format.Rgba8);
        im.SetPixel(0, 0, c);
        return ImageTexture.CreateFromImage(im);
    }

    /// <summary>
    /// The shared pictures, from the bake's texture folder (or, for a bake made before they were written, the
    /// project's own baked folder and the browser's public folder): skyshade.png with its box (skyshade.json), dirt.png
    /// with its box (dirt.json).
    /// </summary>
    private static string sharedDir = "";
    /// <summary>Where the shared pictures are looked for, in order: the bake's texture folder, the project's own, the browser's.</summary>
    public static string[] SharedDirs() => new[] { sharedDir, ProjectSettings.GlobalizePath("res://baked/town_tex"), Path.GetFullPath(Path.Combine(ProjectSettings.GlobalizePath("res://"), "../client/public/textures")) };

    public static void LoadShared(string texDir)
    {
        EnsureGlobals();
        sharedDir = texDir;
        string own = ProjectSettings.GlobalizePath("res://baked/town_tex");
        string web = Path.GetFullPath(Path.Combine(ProjectSettings.GlobalizePath("res://"), "../client/public/textures"));
        string? Find(string file)
        {
            foreach (var d in new[] { texDir, own, web })
                if (File.Exists(Path.Combine(d, file))) return Path.Combine(d, file);
            return null;
        }
        Vector4? Box(string? file)
        {
            if (file == null) return null;
            var j = JsonDocument.Parse(File.ReadAllText(file)).RootElement;
            return new Vector4(j.GetProperty("x0").GetSingle(), j.GetProperty("z0").GetSingle(), j.GetProperty("w").GetSingle(), j.GetProperty("h").GetSingle());
        }
        if (Find("skyshade.png") is { } sky && !Off.Contains("shade"))
        {
            skyShade = ImageTexture.CreateFromImage(Image.LoadFromFile(sky));
            RenderingServer.GlobalShaderParameterSet("psx_sky_shade", skyShade.GetRid());
            if (Box(Find("skyshade.json")) is { } b) RenderingServer.GlobalShaderParameterSet("psx_sky_box", b);
            RenderingServer.GlobalShaderParameterSet("psx_sky_on", 1f);
        }
        else GD.Print("psx: no skyshade.png: no shadows of the houses");
        if (Find("dirt.png") is { } d)
        {
            dirt = ImageTexture.CreateFromImage(Image.LoadFromFile(d));
            RenderingServer.GlobalShaderParameterSet("psx_dirt", dirt.GetRid());
            if (Box(Find("dirt.json")) is { } b) RenderingServer.GlobalShaderParameterSet("psx_dirt_box", b);
        }
        else GD.Print("psx: no dirt.png: the paving is clean (bake again, or node tools/godot/export-scene.mjs --ref-only)");
        if (Find("shore.png") is { } sh)
        {
            shore = ImageTexture.CreateFromImage(Image.LoadFromFile(sh));
            RenderingServer.GlobalShaderParameterSet("psx_shore", shore.GetRid());
            if (Box(Find("shore.json")) is { } b) RenderingServer.GlobalShaderParameterSet("psx_shore_box", b);
        }
        else GD.Print("psx: no shore.png: no foam at the quay walls (node tools/godot/export-scene.mjs --ref-only)");
        if (Find("foul.png") is { } fl)
        {
            foul = ImageTexture.CreateFromImage(Image.LoadFromFile(fl));
            RenderingServer.GlobalShaderParameterSet("psx_foul", foul.GetRid());
            if (Box(Find("foul.json")) is { } b) RenderingServer.GlobalShaderParameterSet("psx_foul_box", b);
        }
    }

    /// <summary>Set one of the shared values (a colour as its linear numbers).</summary>
    public static void Set(string name, Variant value)
    {
        EnsureGlobals();
        if (value.VariantType == Variant.Type.Color)
        {
            var c = value.AsColor();
            value = new Vector4(c.R, c.G, c.B, c.A);
        }
        UniformUpdates.Global(name, value);
    }

    /// <summary>The six lamps whose glow hangs in the air (psx.ts uLamps): flame and brightness; the rest dark.</summary>
    public static void SetLamps(IReadOnlyList<Vector4> lamps)
    {
        EnsureGlobals();
        for (int i = 0; i < MaxLamps; i++) UniformUpdates.Global(LampNames[i], i < lamps.Count ? lamps[i] : NoLamp);
    }

    /// <summary>
    /// The spill sources for this frame (world/spill.ts: see psx.ts MAX_SPILL), four vec4s each:
    /// A centre and power, B the way out of the wall (0, 0: a flame) and the opening's half size, C colour and bars,
    /// D range, decay, the lamp's depth behind the glass, softening.
    /// </summary>
    public static void SetSpill(int count, Func<int, (Vector4 a, Vector4 b, Vector4 c, Vector4 d)> at)
    {
        EnsureGlobals();
        count = Off.Contains("spill") ? 0 : Math.Min(count, MaxSpill);
        for (int i = 0; i < count; i++)
        {
            var (a, b, c, d) = at(i);
            Put(i, 0, a);
            Put(i, 1, b);
            Put(i, 2, c);
            Put(i, 3, d);
        }
        var bytes = UniformUpdates.Cached ? SpillBytes : new byte[SpillData.Length * 4];
        Buffer.BlockCopy(SpillData, 0, bytes, 0, bytes.Length);
        spillImage!.SetData(MaxSpill, 4, false, Image.Format.Rgbaf, bytes);
        spill!.Update(spillImage);
        UniformUpdates.Global("psx_spill_n", count);
    }

    private static void Put(int i, int row, Vector4 v)
    {
        int o = (row * MaxSpill + i) * 4;
        SpillData[o] = v.X;
        SpillData[o + 1] = v.Y;
        SpillData[o + 2] = v.Z;
        SpillData[o + 3] = v.W;
    }

    public static int ShaderCount => Shaders.Count;

    private static ShaderMaterial? cap;
    /// <summary>
    /// The water cap (the browser's boats.ts capMaterial): the invisible lid over a hull's rail. It draws nothing but
    /// marks its pixels, and the water is not drawn there: no water inside an open boat or over a low deck in a swell.
    /// </summary>
    public static ShaderMaterial Cap()
    {
        if (cap != null) return cap;
        cap = new ShaderMaterial
        {
            ResourceName = "cap",
            RenderPriority = -11,
            Shader = new Shader
            {
                Code = @"
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
stencil_mode write, compare_always, 1;
void fragment() {
	ALBEDO = vec3(0.0);
	ALPHA = 0.0;
}
",
            },
        };
        return cap;
    }

    // ------------------------------------------------------------------ the shader's parts

    /// <summary>
    /// The lamps' light scattered toward the eye by the air (psx.ts LAMP_SCATTER_GLSL), for the psx fog and for the
    /// shaders of their own (the sky, the rain): psx_glow(eye, ray, metres) is the sum over the six lamps.
    /// </summary>
    public const string LampScatterGlsl = @"
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
";

    /// <summary>The sun past the houses and the sky seen past them (psx.ts psxSunShadow, psxSkyShade).</summary>
    private const string SkyGlsl = @"
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
";

    /// <summary>Value noise from a hash of the cell corners: no texture, so no tiling (psx.ts pudNoiseGlsl).</summary>
    private const string NoiseGlsl = @"
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
";

    /// <summary>The light one spill source gives a point (psx.ts spillGlsl), and all of them (psxSpill).</summary>
    public const string SpillGlsl = @"
global uniform sampler2D psx_spill : filter_nearest, repeat_disable;
global uniform int psx_spill_n;
// a gas lamp's light stops under its cap (issue #11): its decay (1.7) tells it apart
float psx_lamp_cap(float decay, float up) {
	return abs(decay - 1.7) < 0.001 ? 1.0 - smoothstep(0.5, 0.8, up) : 1.0;
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
		return C.rgb * (A.w * cr * fade * psx_lamp_cap(D.y, d.y / max(dl, 1e-4)) / (pow(max(dl, 0.05), D.y) + D.w));
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
	return sum;
}
";

    /// <summary>Wet ground: a lamp as a streak toward the eye, the rain's rings, the spill sources mirrored (psx.ts).</summary>
    private const string WetGlsl = @"
global uniform sampler2D psx_mirror : source_color, filter_nearest, repeat_disable;
global uniform mat4 psx_mirror_mat;
global uniform float psx_mirror_columns;
global uniform vec4 psx_mirror_col0;
global uniform vec4 psx_mirror_col1;
global uniform vec4 psx_mirror_col2;
global uniform vec4 psx_mirror_col3;
global uniform float psx_mirror_on;
global uniform float psx_wet;
global uniform float psx_rain;
global uniform float psx_puddle;
global uniform float psx_sea;
float wet_streak(vec3 ro, vec3 rr, vec3 p) {
	vec3 q = p - ro;
	float t0 = dot(q, rr);
	if (t0 < 0.0) return 0.0;
	vec3 perp = q - rr * t0;
	vec3 across = normalize(vec3(-rr.z, 0.0, rr.x) + 1e-5);
	float da = dot(perp, across);
	float dv = length(perp - across * da);
	return 1.0 / (1.0 + da * da * 5.0 + dv * dv * 0.35) / (1.0 + t0 * 0.08);
}
float lamp_streaks(vec3 P, vec3 rr) {
	float s = 0.0;
	if (psx_lamp0.w > 0.0) s += psx_lamp0.w * wet_streak(P, rr, psx_lamp0.xyz);
	if (psx_lamp1.w > 0.0) s += psx_lamp1.w * wet_streak(P, rr, psx_lamp1.xyz);
	if (psx_lamp2.w > 0.0) s += psx_lamp2.w * wet_streak(P, rr, psx_lamp2.xyz);
	if (psx_lamp3.w > 0.0) s += psx_lamp3.w * wet_streak(P, rr, psx_lamp3.xyz);
	if (psx_lamp4.w > 0.0) s += psx_lamp4.w * wet_streak(P, rr, psx_lamp4.xyz);
	if (psx_lamp5.w > 0.0) s += psx_lamp5.w * wet_streak(P, rr, psx_lamp5.xyz);
	return s;
}
// rain rings: drops land in a grid of cells, each ring grows and fades
float rain_rings(vec2 wp, float t, float amount) {
	float ring = 0.0;
	for (int k = 0; k < 2; k++) {
		vec2 g = wp * 1.3 + float(k) * vec2(0.37, 0.71);
		vec2 id = floor(g);
		vec2 f = fract(g) - 0.5;
		float h = psx_h13(vec3(id, float(k)));
		vec2 c = (vec2(fract(h * 7.13), fract(h * 3.71)) - 0.5) * 0.4;
		float ph = fract(t * 0.8 + h * 5.0);
		float d = length(f - c);
		ring += smoothstep(0.045, 0.0, abs(d - ph * 0.3)) * (1.0 - ph) * step(h, amount * 1.1);
	}
	return ring;
}
// the spill sources mirrored as streaks; pud 1: in a puddle (a soft band as wide as the opening), 0: wet stone
vec3 psx_spill_wet(vec3 P, vec3 rr, float pud) {
	vec3 sum = vec3(0.0);
	for (int i = 0; i < psx_spill_n; i++) {
		vec4 A = texelFetch(psx_spill, ivec2(i, 0), 0);
		vec3 d = P - A.xyz;
		float r = texelFetch(psx_spill, ivec2(i, 3), 0).x * 1.6;
		float dd = dot(d, d);
		if (dd > r * r) continue;
		vec4 B = texelFetch(psx_spill, ivec2(i, 1), 0);
		vec2 nb = B.xy;
		vec3 c = A.xyz + vec3(nb.x, 0.0, nb.y) * 0.3;
		float s;
		if (pud > 0.5 && dot(nb, nb) > 0.01) {
			vec3 q = c - P;
			float t0 = dot(q, rr);
			if (t0 < 0.0) continue;
			vec3 perp = q - rr * t0;
			vec3 across = normalize(vec3(-rr.z, 0.0, rr.x) + 1e-5);
			float da = dot(perp, across);
			float dv = length(perp - across * da);
			float ea = max(abs(da) - B.z * abs(dot(vec3(-nb.y, 0.0, nb.x), across)), 0.0);
			float ev = max(dv - B.w, 0.0);
			s = 0.1 / (1.0 + ea * ea * 3.0 + ev * ev * 0.35) / (1.0 + t0 * 0.08);
		} else s = wet_streak(P, rr, c);
		sum += texelFetch(psx_spill, ivec2(i, 2), 0).rgb * A.w * s * (1.0 - dd / (r * r));
	}
	return sum;
}
";

    /// <summary>The water's own parts (psx.ts): a lamp's mirror image, the foul water's scum noise, where the basins lie.</summary>
    private const string WaterGlsl = @"
global uniform sampler2D psx_shore : filter_linear, repeat_disable;
global uniform vec4 psx_shore_box;
global uniform sampler2D psx_foul : filter_linear, repeat_disable;
global uniform vec4 psx_foul_box;
global uniform sampler2D psx_water_mirror : source_color, filter_nearest, repeat_disable;
global uniform mat4 psx_water_mirror_mat;
global uniform vec4 psx_water_mirror_col0;
global uniform vec4 psx_water_mirror_col1;
global uniform vec4 psx_water_mirror_col2;
global uniform vec4 psx_water_mirror_col3;
global uniform float psx_water_mirror_on;
uniform vec3 spec_color = vec3(0.0);
uniform float shininess = 120.0;
// 1: the river's sheet, which runs under the Petit Bassin and the lock: not drawn there (their water has its own level)
uniform float river = 0.0;
varying float wave_h;
varying float spec_k;
// mirror image of a lamp on the water: only the sharp core, no wide wash
float lamp_reflect(vec3 ro, vec3 rd, vec4 l) {
	if (l.w <= 0.0) return 0.0;
	vec3 q = l.xyz - ro;
	float t0 = dot(q, rd);
	if (t0 < 0.0) return 0.0;
	float h = length(q - rd * t0) + 0.6;
	return l.w * min(half_scatter(60.0 - t0, h) - half_scatter(-t0, h), 4.0);
}
float lamp_reflects(vec3 P, vec3 rr) {
	return lamp_reflect(P, rr, psx_lamp0) + lamp_reflect(P, rr, psx_lamp1) + lamp_reflect(P, rr, psx_lamp2) + lamp_reflect(P, rr, psx_lamp3) + lamp_reflect(P, rr, psx_lamp4) + lamp_reflect(P, rr, psx_lamp5);
}
float foul_hash(vec2 p) { return psx_h12(p); }
float foul_val(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(foul_hash(i), foul_hash(i + vec2(1.0, 0.0)), u.x), mix(foul_hash(i + vec2(0.0, 1.0)), foul_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// the Petit Bassin between its walls, and the lock from the river gates' V to the dock (world/tide.ts, rijnkaai.ts)
bool in_basin(vec2 p) {
	if (p.x > 104.0 && p.x < 116.0 && p.y < 47.0) return p.y >= 7.0 + clamp(min(p.x - 104.3, 115.7 - p.x), 0.0, 5.7) * 0.26795;
	return p.x > 70.0 && p.x < 170.0 && p.y > 46.0 && p.y < 110.0;
}
";

    /// <summary>The foot of the walls and the mottle (psx.ts footGlsl), in world space from the face's own normal.</summary>
    private const string FootGlsl = @"
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
";

    /// <summary>The paving's relief (psx.ts): each stone's own height, tone and sinking, the relief light, the tilt.</summary>
    private static string ReliefGlsl(bool ids) => @"
uniform sampler2D relief_h : filter_linear_mipmap, repeat_enable;
uniform float relief_depth = 0.0;
uniform float relief_tile = 4.0;
uniform float relief_bump = 3.0;
uniform float relief_holes = 0.0;
uniform float relief_reach = 1.0;
" + (ids ? @"
uniform sampler2D stone_id : filter_nearest, repeat_enable;
// every stone its own dice: its number in the tile mixed with the tile's place in the world
float stone_r(vec2 uv, vec3 s) {
	vec2 t = floor(uv) - vec2(step(0.5, s.b), 0.0);
	return psx_h13(vec3(t, floor(s.r * 255.0 + 0.5)));
}
// x: gone (a muddy hole), y: sunk; far more of both in the wheel lines of the cart roads
vec2 stone_ms(float r, float wear) {
	return vec2(step(r, (0.012 + 0.07 * wear) * relief_holes), step(r, (0.06 + 0.22 * wear) * relief_holes + 0.02));
}
float rel_shape(float h, vec2 uv, float wear) {
	vec3 s = texture(stone_id, uv).rgb;
	if (s.g < 0.5) return h;
	float r = stone_r(uv, s);
	vec2 ms = stone_ms(r, wear);
	// no two stones at the same height; worn ones rounder and lower; sunk ones low; gone ones a hole
	float top = mix(0.35 + 0.65 * fract(r * 53.7), 0.22, ms.y) * (1.0 - 0.3 * wear);
	return mix(h * top, 0.02, ms.x);
}
float rel_h(vec2 uv, float wear) { return rel_shape(texture(relief_h, uv).r, uv, wear); }
float rel_hs(vec2 uv, float wear) { return rel_shape(texture(relief_h, uv, 2.0).r, uv, wear); }
// each stone its own tone; a stone gone is a hole of mud; further off (far_s) only a dark patch
vec3 stone_tone(vec2 uv, float wear, float far_s) {
	vec3 sid = texture(stone_id, uv).rgb;
	if (sid.g <= 0.5) return vec3(1.0);
	float r = stone_r(uv, sid);
	vec2 ms = stone_ms(r, wear);
	vec3 st = vec3(0.8 + 0.36 * fract(r * 91.3)) * mix(vec3(1.06, 1.0, 0.9), vec3(0.94, 0.98, 1.06), fract(r * 17.9));
	st = mix(st, vec3(0.2, 0.15, 0.1) * (0.7 + 0.6 * fract(r * 7.7)), ms.x);
	st = mix(st, st * 0.85, ms.y * (1.0 - ms.x));
	return mix(st, vec3(mix(1.0, 0.6, ms.x)), far_s);
}
" : @"
float rel_h(vec2 uv, float wear) { return texture(relief_h, uv).r; }
float rel_hs(vec2 uv, float wear) { return texture(relief_h, uv, 2.0).r; }
") + @"
// the relief light at uv: lit tops from the sky, dark joints; worn by the wheels: smoother, the tops a little lighter
float relief_light(vec2 uv, float wear, out float h_c, out vec2 slope) {
	float e = 2.0 / max(float(textureSize(relief_h, 0).x), 256.0);
	h_c = rel_h(uv, wear);
	float hx = rel_h(uv + vec2(e, 0.0), wear) - rel_h(uv - vec2(e, 0.0), wear);
	float hz = rel_h(uv + vec2(0.0, e), wear) - rel_h(uv - vec2(0.0, e), wear);
	vec3 rn = normalize(vec3(-hx * relief_bump, 1.0, -hz * relief_bump));
	// the slope tilts the normal the lights see: the sharp edges at this step, the dome of the stone from a softer mip
	float e3 = e * 3.0;
	float dx = rel_hs(uv + vec2(e3, 0.0), wear) - rel_hs(uv - vec2(e3, 0.0), wear);
	float dz = rel_hs(uv + vec2(0.0, e3), wear) - rel_hs(uv - vec2(0.0, e3), wear);
	slope = (vec2(hx, hz) * 1.2 + vec2(dx, dz) * 2.5) * relief_bump * (1.0 - wear * 0.3);
	float lit = clamp(dot(rn, normalize(vec3(-0.45, 0.8, -0.35))), 0.0, 1.0);
	float relief = mix(0.6, 1.12, lit) * (0.55 + 0.45 * h_c);
	return mix(relief, 1.0 + 0.12 * h_c, wear * 0.45);
}
";

    /// <summary>The ground's normal tilted by a slope in its uv (psx.ts psxGroundTilt), world space.</summary>
    private const string TiltGlsl = @"
vec3 ground_tilt(vec3 wp, vec2 uv, vec2 slope) {
	vec3 dpx = dFdx(wp);
	vec3 dpy = dFdy(wp);
	vec2 dux = dFdx(uv);
	vec2 duy = dFdy(uv);
	float det = dux.x * duy.y - dux.y * duy.x;
	if (abs(det) < 1e-12) return vec3(0.0);
	// where u and v run on the ground (world space)
	vec3 tu = normalize((dpx * duy.y - dpy * dux.y) * sign(det));
	vec3 tv = normalize((dpy * dux.x - dpx * duy.x) * sign(det));
	return normalize(vec3(0.0, 1.0, 0.0) - tu * slope.x - tv * slope.y) - vec3(0.0, 1.0, 0.0);
}
";

    /// <summary>
    /// The trees in the wind (trees3d.ts swayGlsl): the crown bends with the sea state's wind, leans hard downwind in a
    /// gale (psx_gale) and whips in the gusts; the leaves flutter. merged: the park's plants (one mesh in world space,
    /// each vertex's plant foot in CUSTOM0: x, z, y); else a tree's copy (its foot is its origin).
    /// </summary>
    private static string TreeSway(bool leaf, bool merged) => @"	{
" + (merged ? @"		vec3 tree_at = vec3(CUSTOM0.x, CUSTOM0.z, CUSTOM0.y);
		float foot_y = CUSTOM0.z;
" : @"		vec3 tree_at = MODEL_MATRIX[3].xyz;
		float foot_y = 0.0;
") + @"		float ph = tree_at.x * 0.21 + tree_at.z * 0.17;
		float wind = 0.55 + 0.45 * psx_sea;
		float hh = max(VERTEX.y - foot_y - 2.0, 0.0);
		float bend = hh * hh * 0.0011 * wind;
		float g = sin(psx_time * 0.83 + ph) + 0.45 * sin(psx_time * 2.07 + ph * 1.7);
		VERTEX.x += g * bend;
		VERTEX.z += sin(psx_time * 0.61 + ph * 1.3) * bend * 0.6;
		float lean = hh * hh * 0.0045 * psx_gale.z * (0.8 + 0.2 * sin(psx_time * 1.7 + ph) + 0.15 * sin(psx_time * 4.3 + ph * 2.1));
		VERTEX.x += psx_gale.x * lean;
		VERTEX.z += psx_gale.y * lean;
		VERTEX.y -= lean * lean * 0.08;
" + (leaf ? @"		vec3 p0 = VERTEX;
		float fl = sin(psx_time * 3.4 + dot(p0, vec3(1.7, 2.3, 1.1)) + ph) * 0.035 * wind * min(hh, 1.0);
		VERTEX += NORMAL * fl;
		VERTEX.y += cos(psx_time * 2.9 + dot(p0, vec3(2.1, 0.7, 1.9))) * 0.02 * wind * min(hh, 1.0);
		VERTEX += NORMAL * sin(psx_time * 9.0 + dot(p0, vec3(3.1, 1.3, 2.7))) * 0.05 * psx_gale.z * min(hh, 1.0);
" : "") + @"	}
";

    /// <summary>
    /// The falling leaves (trees3d.ts fallingLeaves): each copy is one leaf of a tree (its origin the tree's foot,
    /// INSTANCE_CUSTOM its start height, its circle, its speed and its number); it drifts round and down, turning, and
    /// starts again at the top. Worked out here from the time, no work on the CPU.
    /// </summary>
    /// <summary>
    /// The shaders' dice, without sin (Dave Hoskins, "Hash without Sine"): the browser's fract(sin(x) * 43758.5453)
    /// loses its bits on this card once x is in the thousands, and its noise came out in flat patches (issue #58).
    /// </summary>
    public const string HashGlsl = @"
float psx_h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float psx_h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float psx_h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
";

    public const string FallGlsl = @"	{
		float top = INSTANCE_CUSTOM.x, rad = INSTANCE_CUSTOM.y, speed = INSTANCE_CUSTOM.z, li = INSTANCE_CUSTOM.w;
		float a0 = psx_h11(li) * 6.2832;
		float phase = psx_h11(li + 17.0);
		float spin = 1.5 + psx_h11(li + 43.0) * 2.5;
		float t = psx_time;
		float wind = 0.55 + 0.45 * psx_sea;
		float f = fract(t / (top / speed) + phase);
		float a = a0 + f * 2.2;
		float sway = sin(t * 1.3 + li) * 0.5 * wind;
		vec3 off = vec3(cos(a) * rad + sway + f * 1.5 * wind, top * (1.0 - f) + 0.03, sin(a) * rad + cos(t * 1.1 + li) * 0.3);
		// (three's Euler XYZ: x, then y, then z, as a matrix Rx Ry Rz)
		vec3 e = vec3(t * spin + li, t * spin * 0.7, sin(t * 2.0 + li) * 0.8);
		mat3 rx = mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, cos(e.x), sin(e.x)), vec3(0.0, -sin(e.x), cos(e.x)));
		mat3 ry = mat3(vec3(cos(e.y), 0.0, -sin(e.y)), vec3(0.0, 1.0, 0.0), vec3(sin(e.y), 0.0, cos(e.y)));
		mat3 rz = mat3(vec3(cos(e.z), sin(e.z), 0.0), vec3(-sin(e.z), cos(e.z), 0.0), vec3(0.0, 0.0, 1.0));
		mat3 r = rx * ry * rz;
		VERTEX = r * VERTEX + off;
		NORMAL = r * NORMAL;
	}
";

    public static Shader ShaderOf(Kind k)
    {
        if (Shaders.TryGetValue(k, out var s)) return s;
        EnsureGlobals();
        if (k.Decal)
        {
            s = new Shader { Code = Grime.DecalShader };
            Shaders[k] = s;
            Kinds[s] = k;
            return s;
        }
        bool lit = !k.Unlit;
        bool bump = k.Relief > 0 || k.Slabs;
        bool noise = k.Ground || k.Wall || k.Detile;
        var modes = new List<string> { "specular_disabled", "ambient_light_disabled" };
        // (the water's waves are worked out from the world point; its highlight is its own, in light())
        if (k.Water > 0)
        {
            modes.Add("world_vertex_coords");
            modes.Remove("specular_disabled");
            // drawn after the solid world and the boats' caps (Cap below), before every other see-through thing
            modes.Add("blend_mix");
            modes.Add("depth_draw_always");
        }
        string calm = k.Water == 2 ? "0.28" : "1.0", amp = k.Water == 2 ? "0.12" : "1.0";
        // (wet ground: the sun's highlight comes with the wet, psx.ts opts.wet)
        if (k.Ground && !k.Unlit) modes.Remove("specular_disabled");
        if (k.Unlit) modes.Add("unshaded");
        if (k.TwoSided) modes.Add("cull_disabled");
        if (k.Add) modes.Add("blend_add");
        else if (k.Blend) modes.Add("blend_mix");
        if (k.Blend || k.Add) modes.Add(k.DepthWrite ? "depth_draw_always" : "depth_draw_never");
        var c = new StringBuilder();
        c.Append("shader_type spatial;\nrender_mode ").Append(string.Join(", ", modes)).Append(";\n");
        c.Append(HashGlsl);
        if (k.Water > 0) c.Append("stencil_mode read, compare_not_equal, 1;\n");
        c.Append(@"
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
uniform sampler2D tex : source_color, filter_nearest_mipmap, repeat_enable, hint_default_white;
uniform vec3 emission : source_color = vec3(0.0);
uniform sampler2D emission_tex : source_color, filter_nearest_mipmap, repeat_enable, hint_default_white;
// 1: its emission is the sky's fill light (baked at midday): it follows the sky and the model's vertex colour
uniform float fill = 0.0;
global uniform vec4 psx_fill;
uniform float affine = 1.0;
uniform float fog_reach = 1.0;
uniform float alpha_cut = 0.5;
uniform vec4 uv_xform = vec4(1.0, 1.0, 0.0, 0.0);
varying vec3 aff;
varying float fog_depth;
varying vec3 world;
");
        if (lit) c.Append("varying float sun_lit;\n");
        // a room's own light (three's HemisphereLight and AmbientLight of the room's scene, over pi), set per mesh
        if (k.Indoor && lit) c.Append("instance uniform vec3 room_sky = vec3(0.3);\ninstance uniform vec3 room_ground = vec3(0.1);\ninstance uniform vec3 room_ambient = vec3(0.0);\n");
        if (k.Atlas > 0) c.Append("varying vec2 cell;\n");
        if (k.Ground) c.Append("uniform float vary = 0.0;\nuniform float puddles = 0.0;\n// the wet stone's highlight (three's Phong: specular and shininess; 0 when it never gets wet)\nuniform vec3 spec_color = vec3(0.0);\nuniform float shininess = 12.0;\nvarying float spec_k;\n");
        if (k.Wall) c.Append("uniform float foot = 0.0;\nuniform float foot_wear = 0.0;\nuniform float mottle = 0.0;\n");
        if (k.Slabs) c.Append("uniform sampler2D slab_map : source_color, filter_nearest_mipmap, repeat_enable;\nuniform sampler2D slab_h : filter_linear_mipmap, repeat_enable;\nuniform float slab_tile = 2.6;\nuniform float slab_ymax = 0.8;\n");
        c.Append(LampScatterGlsl);
        if (lit || k.Ground) c.Append(SkyGlsl).Append(SpillGlsl);
        if (noise) c.Append(NoiseGlsl);
        if (k.Ground || k.Water > 0) c.Append(WetGlsl);
        if (k.Water > 0) c.Append(WaterGlsl);
        if (k.Wall) c.Append(FootGlsl);
        if (k.Relief > 0) c.Append(ReliefGlsl(k.Relief > 1));
        if (k.Relief > 0) c.Append(TiltGlsl);
        if (k.Grime > 0) c.Append(Grime.CommonGlsl);
        if (k.Tree > 0) c.Append("global uniform vec3 psx_gale;\nglobal uniform float psx_sea;\n" + (k.Tree % 2 == 0 ? "global uniform float psx_wet;\n" : ""));
        if (k.Bump) c.Append(Grime.BumpGlsl(k.Atlas));
        c.Append(@"
void vertex() {
");
        if (k.Water > 0)
            c.Append(@"	// a long slow swell under shorter waves (waveAt in the browser is the same sum); the normal from their slopes
	vec3 wp = VERTEX;
	float t = psx_time;
	float sw = cos(wp.x * 0.11 + wp.z * 0.07 + t * 0.45);
	float dx = sw * 0.018 + cos(wp.x * 0.35 + t * 0.9) * 0.045 + cos(wp.z * 0.55 - t * 0.7 + wp.x * 0.2) * 0.016 + cos((wp.x + wp.z) * 1.3 + t * 1.7) * 0.039 + cos(wp.x * 3.1 - wp.z * 1.7 + t * 2.3) * 0.07;
	float dz = sw * 0.012 + cos(wp.z * 0.55 - t * 0.7 + wp.x * 0.2) * 0.05 + cos((wp.x + wp.z) * 1.3 + t * 1.7) * 0.039 - cos(wp.x * 3.1 - wp.z * 1.7 + t * 2.3) * 0.04;
	NORMAL = normalize(vec3(-dx * " + calm + @", 1.0, -dz * " + calm + @"));
	float w = sin(wp.x * 0.11 + wp.z * 0.07 + t * 0.45) * 0.08 + sin(wp.x * 0.35 + t * 0.9) * 0.07 + sin(wp.z * 0.55 - t * 0.7 + wp.x * 0.2) * 0.05 + sin((wp.x + wp.z) * 1.3 + t * 1.7) * 0.02;
	w *= psx_sea * " + amp + @";
	// the great storm's chop: short steep seas over the swell
	w += (sin(wp.x * 0.92 - wp.z * 0.38 + t * 2.6) * 0.06 + sin(wp.z * 1.07 + wp.x * 0.55 - t * 3.1) * 0.045) * max(0.0, psx_sea - 3.6) * " + amp + @";
	VERTEX.y += w;
	wave_h = w / 0.22;
	// (the same picture tiles everywhere: 4 m, drifting slowly)
	UV = vec2(wp.x, -wp.z) / 4.0 + psx_time * vec2(0.004, 0.011);
	vec4 view = VIEW_MATRIX * vec4(VERTEX, 1.0);
");
        else
        {
            if (k.Tree == 5) c.Append(FallGlsl);
            else if (k.Tree > 0) c.Append(TreeSway(k.Tree % 2 == 0, k.Tree > 2));
            c.Append("	vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);\n");
        }
        c.Append(@"	fog_depth = -view.z;
	world = (INV_VIEW_MATRIX * view).xyz;
	POSITION = PROJECTION_MATRIX * view;
");
        if (k.Snap)
            c.Append(@"	// snap only past arm's length: up close the jitter just looks broken
	if (psx_snap_res.x < 5e4) {
		vec2 ndc = POSITION.xy / POSITION.w;
		vec2 snapped = floor(ndc * psx_snap_res + 0.5) / psx_snap_res;
		POSITION.xy = mix(ndc, snapped, smoothstep(1.5, 4.0, POSITION.w)) * POSITION.w;
	}
");
        if (k.Atlas > 0) c.Append("	cell = UV2;\n");
        if (k.Grime > 0) c.Append("	gmat = CUSTOM0.xy; // (the house's wall picture and paint)\n");
        c.Append(@"	UV = UV * uv_xform.xy + uv_xform.zw;
	aff = vec3(UV * POSITION.w, POSITION.w);
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
	// affine warp fades in with distance: textures swim a little far off, but stay straight at your feet
	vec2 uv = mix(UV, aff.xy / aff.z, affine * smoothstep(4.0, 14.0, len));
");
        if (k.Grime > 0 || k.Bump) c.Append("	vec2 raw_uv = uv;\n");
        if (k.Grime == 1) c.Append("	vec3 wall_dn = vec3(0.0);\n");
        if (k.Atlas > 0) c.Append($"	uv = (cell + fract(uv)) / {k.Atlas}.0;\n");
        if (bump) c.Append("	float psx_h = 0.5; // how high the stone is here; the puddles leave the tops dry\n	vec3 ground_dn = vec3(0.0);\n");
        if (k.Ground) c.Append("	// how worn the ground is here: the cart roads (world/dirt.ts, green)\n	float wear = vary > 0.0 ? texture(psx_dirt, (world.xz - psx_dirt_box.xy) / psx_dirt_box.zw).g : 0.0;\n");
        else if (k.Relief > 0) c.Append("	float wear = 0.0;\n");
        if (k.Parallax)
            c.Append(@"	{
		// parallax occlusion: step into the stones along the view ray, near the eye only
		vec3 rel_v = -rd;
		float rel_fade = 1.0 - smoothstep(6.0, 14.0, len);
		if (rel_fade > 0.0 && relief_depth > 0.0) {
			float layers = mix(14.0, 5.0, clamp(rel_v.y, 0.0, 1.0));
			float dl = 1.0 / layers;
			vec2 duv = (-rel_v.xz / max(rel_v.y, 0.2)) * (relief_depth * rel_fade / relief_tile) * dl;
			vec2 ruv = uv;
			float depth = 0.0;
			float h_depth = 1.0 - rel_h(ruv, wear);
			int steps = 0;
			for (int i = 0; i < 14; i++) {
				if (depth >= h_depth) break;
				ruv += duv;
				h_depth = 1.0 - rel_h(ruv, wear);
				depth += dl;
				steps++;
			}
			if (steps > 0) {
				// between the last two steps where the ray met the stone: no stair steps along the joints
				float after = h_depth - depth;
				float before = (1.0 - rel_h(ruv - duv, wear)) - (depth - dl);
				ruv -= duv * clamp(after / min(after - before, -1e-4), 0.0, 1.0);
			}
			uv = ruv;
		}
	}
");
        c.Append("	vec4 c = texture(tex, uv);\n");
        if (k.Detile)
            c.Append(@"	// no tile repeats in a grid: where a slow noise says so, the same texture turned 37 degrees and scaled
	vec2 uv2 = mat2(vec2(0.8, -0.6), vec2(0.6, 0.8)) * uv * 0.77 + vec2(0.31, 0.57);
	float dm = smoothstep(0.35, 0.65, pud_val(world.xz / 7.0));
	c = mix(c, texture(tex, uv2), dm);
");
        c.Append("	c *= albedo;\n");
        if (k.Tree > 0 && k.Tree % 2 == 0) c.Append("	c.rgb *= 1.0 - 0.16 * psx_wet; // (wet leaves are darker)\n");
        if (k.Water > 0)
            c.Append(@"	{
		if (river > 0.5 && in_basin(world.xz)) discard;
		// far off, the ripples melt into one dark tone (no shimmer at the fog line)
		vec2 wxz = world.xz;
		c.rgb = mix(albedo.rgb * vec3(0.045, 0.062, 0.05), c.rgb, 1.0 - smoothstep(10.0, 70.0, len));
		// wave crests a shade lighter, troughs darker
		c.rgb *= 1.0 + clamp(wave_h * 0.18, -0.45, 0.7);
		// along the walls: lighter, silty water and foam lapping at the stone, in 20 cm pixels
		float shore = texture(psx_shore, (wxz - psx_shore_box.xy) / psx_shore_box.zw).r * 8.0;
		vec2 cl = floor(wxz * 5.0);
		float n = psx_h12(cl);
		float lap = 0.5 + 0.5 * sin(psx_time * 1.1 + wxz.x * 0.45 + wxz.y * 0.3);
		float reach = (0.2 + 0.5 * lap) * (0.45 + 0.75 * n);
		// the great storm: the surf reaches far out from the walls, churned white
		float storm_k = clamp((psx_sea - 3.6) / 2.4, 0.0, 1.0);
		reach *= 1.0 + 3.5 * storm_k;
		float foam = step(shore, reach) * (0.55 + 0.45 * step(0.5, n));
		float silt = 1.0 - smoothstep(0.2, 2.5, shore);
		c.rgb *= 1.0 + silt * 0.45;
		c.rgb = mix(c.rgb, vec3(0.3, 0.32, 0.29) + 0.12 * storm_k, foam * (0.8 + 0.15 * storm_k));
		if (storm_k > 0.0) {
			// whitecaps: the crests break white, in streaks blown downwind, flickering as they break
			float crest = wave_h * 0.22 / max(psx_sea, 1.0);
			vec2 wc = floor(wxz * vec2(3.0, 5.0));
			float wn = psx_h12(wc + floor(psx_time * 3.0));
			c.rgb = mix(c.rgb, vec3(0.42, 0.45, 0.44), smoothstep(0.45, 0.8, crest + wn * 0.35) * storm_k * 0.85);
		}
		// foul water (the vlieten, the canal, by the fish market): browner and duller
		float foul_d = texture(psx_foul, (wxz - psx_foul_box.xy) / psx_foul_box.zw).r;
		c.rgb = mix(c.rgb, c.rgb * vec3(0.85, 0.74, 0.5), foul_d);
	}
");
        if (k.Slabs)
            c.Append(@"	{
		// pavements, kerbs and door steps: slabs in world metres with their own relief
		vec3 fn = normalize(cross(dFdx(world), dFdy(world)));
		if (abs(fn.y) > 0.9 && world.y < slab_ymax) {
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
			vec2 ss = (vec2(sx, sz) * 1.2 + vec2(bx, bz) * 2.5) * 1.6 * (1.0 - smoothstep(12.0, 28.0, len)) * (1.0 - smoothstep(6.0, 14.0, fps));
			ground_dn = normalize(vec3(-ss.x, 1.0, -ss.y)) - vec3(0.0, 1.0, 0.0);
			psx_h = sh;
		}
	}
");
        if (k.Ground)
            c.Append(@"	if (vary > 0.0) {
		// patches: worn paths, newer stones where it was mended, dirt by the walls
		vec2 vp = world.xz;
		float big = pud_val(vp / 23.0) - 0.5;
		float mid = pud_val(vp / 6.5 + 17.3) - 0.5;
		float mend = smoothstep(0.78, 0.82, pud_val(vp / 4.1 - 41.0));
		vec3 tone = vec3(1.0 + (big * 0.26 + mid * 0.16) * vary);
		tone *= mix(vec3(1.0), vec3(1.07, 1.05, 1.0), mend * vary);
		tone *= mix(vec3(1.0), vec3(0.93, 0.95, 1.0), smoothstep(0.1, 0.4, mid) * 0.5 * vary);
		// grime in the gutters by the walls, mud and dung on the open ground, broken up
		float grime = texture(psx_dirt, (vp - psx_dirt_box.xy) / psx_dirt_box.zw).r;
		grime *= 0.6 + 0.8 * pud_val(vp * 1.7 + 5.1);
		tone *= mix(vec3(1.0), vec3(0.24, 0.19, 0.13), clamp(grime, 0.0, 1.0));
		c.rgb *= tone;
	}
");
        if (k.Relief > 0)
        {
            c.Append(@"	{
		// relief light from the height map: the tops lit, the joints dark; it melts into an even tone further off
		float h_c;
		vec2 sl;
		float relief = relief_light(uv, wear, h_c, sl);
");
            if (k.Detile)
                c.Append(@"		if (dm > 0.001) {
			// where the colour is the turned sample, so is the relief; its slope turned back into this uv
			float h_c2;
			vec2 sl2;
			float relief2 = relief_light(uv2, wear, h_c2, sl2);
			relief = mix(relief, relief2, dm);
			h_c = mix(h_c, h_c2, dm);
			sl = mix(sl, 0.77 * vec2(0.8 * sl2.x - 0.6 * sl2.y, 0.6 * sl2.x + 0.8 * sl2.y), dm);
		}
");
            c.Append(@"		psx_h = h_c;
		c.rgb *= mix(relief, 0.86, smoothstep(8.0 * relief_reach, 22.0 * relief_reach, len));
		// the stones for the lights: each sett lit on the side that faces a light; it melts away further off and
		// where one pixel covers a stone's worth of the height map (no sparkle)
		float far_t = smoothstep(12.0 * relief_reach, 28.0 * relief_reach, len);
		float fpx = max(length(dFdx(UV)), length(dFdy(UV))) * float(textureSize(relief_h, 0).x);
		ground_dn = ground_tilt(world, UV, sl * (1.0 - far_t) * (1.0 - smoothstep(16.0, 40.0, fpx)));
");
            if (k.Relief > 1)
                c.Append(@"		float far_s = smoothstep(14.0 * relief_reach, 30.0 * relief_reach, len);
		vec3 st = stone_tone(uv, wear, far_s);
" + (k.Detile ? "		if (dm > 0.001) st = mix(st, stone_tone(uv2, wear, far_s), dm);\n" : "") + "		c.rgb *= st;\n");
            c.Append("	}\n");
        }
        // the houses' age: the wall pictures and the grime before the vertex colour, the worn paint after (Render/Grime.cs)
        if (k.Grime > 0) c.Append(Grime.BeforeColourGlsl(k.Grime == 1 && k.Atlas > 0));
        if (k.VertexColor) c.Append("	c.rgb *= COLOR.rgb;\n");
        if (k.Grime == 1 && k.Atlas > 0) c.Append(Grime.AfterColourGlsl);
        if (k.Scissor) c.Append("	if (c.a < alpha_cut) discard;\n");
        if (k.Wall)
            c.Append(@"	{
		vec3 fn = normalize(cross(dFdx(world), dFdy(world)));
		if (mottle > 0.0) c.rgb = psx_mottle(c.rgb, mottle, world, fn);
		// (the house's own wear in the vertex colour's alpha sets how high and how dark)
		if (foot > 0.0) c.rgb = psx_foot_dirt(c.rgb, foot * mix(1.0, 0.25 + 0.9 * COLOR.a, foot_wear), world, fn);
	}
");
        if (lit)
        {
            // (leaves keep their normal on the back face: the sky lights them from both sides)
            if (k.Tree > 0 && k.Tree % 2 == 0) c.Append("	if (!FRONT_FACING) NORMAL = -NORMAL;\n");
            c.Append("	vec3 n_flat = NORMAL;\n");
            if (k.Grime == 1 && k.Atlas > 0) c.Append("	NORMAL = normalize(NORMAL + (VIEW_MATRIX * vec4(wall_dn, 0.0)).xyz); // (the wall's bumps for the lights)\n");
            if (k.Bump) c.Append("	NORMAL = bump_normal(VERTEX, NORMAL, bump_dh(raw_uv, " + (k.Atlas > 0 ? "cell" : "vec2(0.0)") + ", VIEWPORT_SIZE.y / 270.0));\n");
            if (bump)
                c.Append(@"	// the ground bump: the lights see the stones' own normal; the brightness stays (the colour is divided by how far
	// the normal was tilted, the sky's light multiplied by it)
	NORMAL = normalize(NORMAL + (VIEW_MATRIX * vec4(ground_dn, 0.0)).xyz);
	float bump_k = clamp(dot(NORMAL, n_flat), 0.4, 1.0);
	c.rgb /= bump_k;
");
            else c.Append("	float bump_k = 1.0;\n");
            c.Append(@"	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	// the sky's light: its own colour from above, the ground's from below (three's HemisphereLight), less of it in
	// a narrow street; the sun waits for light(), kept off by the houses
	vec3 sky = mix(psx_hemi_ground.rgb, psx_hemi_sky.rgb, nw.y * 0.5 + 0.5) * bump_k * psx_sky_seen(world, nw);
	sun_lit = psx_sun_shadow(world, nw);
	// the light spilt from lamps, lit windows and doors (world/spill.ts), as point lights would give it
	vec3 spilt = psx_spill_n > 0 ? psx_spill_at(world, nw) / PI : vec3(0.0);
");
            if (k.Indoor)
                c.Append(@"	// inside: the room's own light; no sun, no street lamp through the walls (its lamps are real lights)
	sky = (mix(room_ground, room_sky, nw.y * 0.5 + 0.5) + room_ambient) * bump_k;
	sun_lit = 0.0;
	spilt = vec3(0.0);
");
            if (k.Water > 0) c.Append("	spilt = vec3(0.0); // (the water takes no spilt light: its lamps are mirror images)\n");
        }
        c.Append("	float fog_k = smoothstep(psx_fog_near, psx_fog_far * fog_reach, fog_depth);\n");
        if (k.Far)
            c.Append(@"	{
		// a landmark seen further than the fog: past the normal fog it becomes one soft silhouette tone
		float sil = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
		k3 *= 1.0 - sil;
		ad = ad * (1.0 - sil) + fogc * 0.74 * sil;
	}
");
        if (k.Ground)
        {
            c.Append(@"	spec_k = 0.0;
	if (psx_wet > 0.001) {
		// wet stone: porous stone goes darker, the joints darkest, in patches; it shines only in small broken glints
		// at a slant. Only the puddles are mirrors.
		float stone = smoothstep(0.06, 0.4, dot(c.rgb, vec3(0.333)));
		float patchy = pud_val(world.xz / 1.7) * 0.6 + pud_val(world.xz * 4.0) * 0.4;
		float wet_k = psx_wet * smoothstep(0.15, 0.65, patchy + psx_wet * 0.35);
		// a film of water is smooth: the sun's highlight in the same patches (dry stone is matte)
		spec_k = wet_k;
		float dk = 1.0 - 0.36 * wet_k * (1.25 - 0.5 * stone);
		k3 *= dk;
		ad *= dk;
		float grazing = pow(1.0 - clamp(-rd.y, 0.0, 1.0), 3.0);
		float glint = step(0.6, pud_hash(floor(world.xz * 2.2)));
");
            if (bump) c.Append("		// the wet tops of the stones glint, the joints stay dark\n		glint = smoothstep(0.3, 0.65, psx_h) * (0.45 + 0.55 * glint);\n");
            c.Append(@"		ad += fogc * grazing * 0.2 * wet_k * stone * (0.25 + 0.75 * glint);
		vec3 rr = vec3(rd.x, -rd.y, rd.z);
		ad += psx_lamp_color.rgb * lamp_streaks(world, rr) * wet_k * stone * (0.15 + 0.85 * glint) * 0.4;
");
            if (lit) c.Append("		if (psx_spill_n > 0) ad += psx_spill_wet(world, rr, 0.0) * wet_k * stone * (0.1 + 0.9 * glint) * 0.15;\n");
            c.Append(@"		if (psx_rain > 0.001) ad += fogc * rain_rings(world.xz * 1.6, psx_time * 1.3, psx_rain * 0.6) * 0.18 * wet_k;
	}
	if (psx_puddle > 0.001 && puddles > 0.0) {
		// puddles in the paving: water lies where a soft noise is highest, a dark damp band round it; it shows the
		// ground under it looking down and the sky at a slant (the street mirrored in it: the mirrors' step)
		vec2 pp = world.xz;
		float pn = pud_val(pp / 17.0) * 0.55 + pud_val(pp / 7.3 + 31.7) * 0.3 + pud_val(pp / 2.9 - 12.1) * 0.15;
		pn = clamp((pn - 0.5) * 2.4 + 0.5, 0.0, 1.0);
		float lvl = clamp(psx_puddle * puddles, 0.0, 1.0);
		// at most about a quarter of the ground is puddle, even in a storm
		float th = 0.97 - lvl * 0.22;
		float water = smoothstep(th, th + 0.018, pn);
		// broken into puddles a few metres across
		water *= smoothstep(0.46, 0.56, pud_val(pp / 2.1 + 57.1)) * smoothstep(0.3, 0.42, pud_val(pp / 4.7 - 23.9));
");
            if (k.Relief > 0) c.Append("		// stones and pebbles stand out of the water: the shallower the puddle, the more of them\n		water *= 1.0 - smoothstep(0.6 + lvl * 0.2, 0.7 + lvl * 0.2, psx_h) * (1.0 - smoothstep(th + 0.05, th + 0.3, pn));\n");
            c.Append(@"		water = clamp(water, 0.0, 1.0);
		float damp = smoothstep(th - 0.09, th, pn);
		float dk = 1.0 - 0.38 * damp * (1.0 - water);
		k3 *= dk;
		ad *= dk;
		if (water > 0.0) {
			float cos_t = clamp(-rd.y, 0.0, 1.0);
			float fres = max(0.02 + 0.98 * pow(1.0 - cos_t, 5.0), 0.22);
			// wind ripples dull the picture in gust patches; the sea state is the wind
			vec2 wd = vec2(0.93, 0.36);
			float wk = clamp((psx_sea - 0.85) / 2.75, 0.0, 1.0);
			float gust = smoothstep(mix(0.42, 0.18, wk), mix(0.78, 0.5, wk), pud_val(pp * 0.3 - wd * psx_time * mix(0.5, 1.4, wk)));
			float wind = clamp(psx_sea, 0.6, 2.0);
			// fine crests across the wind that run with it, in gust patches that drift downwind; between the gusts a
			// puddle is a still, sharp mirror; faded out from 10 to 30 m, where a ripple is under a pixel
			float ph = dot(pp, wd) * mix(30.0, 13.0, wk) - psx_time * mix(7.5, 9.0, wk);
			vec2 ripp = vec2(sin(ph + pud_val(pp * 1.9) * 5.0), sin(ph * 0.87 + 1.7 + pud_val(pp * 2.6 + 9.0) * 5.0));
			vec2 wob = (wd * ripp.x + vec2(-wd.y, wd.x) * ripp.y * 0.45) * (0.0006 + gust * (0.0045 + 0.006 * wk * wk)) * wind * (1.0 - smoothstep(10.0, 30.0, len));
			if (psx_rain > 0.001) wob += vec2(rain_rings(pp * 1.4, psx_time * 1.2, psx_rain)) * 0.012;
			mat4 mirror_mat = psx_mirror_columns > 0.5 ? mat4(psx_mirror_col0, psx_mirror_col1, psx_mirror_col2, psx_mirror_col3) : psx_mirror_mat;
			vec4 mr = mirror_mat * vec4(world, 1.0);
			// the street itself mirrored (World/Mirrors.cs); reflections off: dark water with a little of the sky's grey
			vec3 refl = psx_mirror_on > 0.5 ? texture(psx_mirror, (vec2(mr.x, -mr.y) / mr.w + wob) * 0.5 + 0.5).rgb * 1.1 : fogc * 0.3;
			refl *= 1.0 - 0.12 * gust * min(1.0, wind - 0.6);
			// (the great storm: the puddles are all rain-splash and wind; no picture in them)
			refl = mix(refl, fogc * 0.3, 0.85 * clamp((psx_sea - 3.6) / 2.0, 0.0, 1.0));
			vec3 rr = vec3(rd.x, -rd.y, rd.z);
			refl += psx_lamp_color.rgb * lamp_streaks(world, rr) * 0.8;
");
            if (lit) c.Append("			if (psx_spill_n > 0) refl += psx_spill_wet(world, rr, 1.0) * 0.05;\n");
            c.Append(@"			// shallow, a little brown: the ground under it, darker
			vec3 keep = vec3(1.0 - water) + water * vec3(0.52, 0.48, 0.42) * (1.0 - fres);
			k3 *= keep;
			ad = ad * keep + refl * (water * fres);
		}
	}
");
        }
        if (k.Water > 0)
            c.Append(@"	{
		// a dark mirror: the misty sky at low angles, black water looking down, the gas lamps drawn out into long
		// broken streaks by fine ripples (in chunky world pixels)
		vec2 rp = floor(world.xz * 6.0) / 6.0;
		vec2 rip = vec2(sin(rp.x * 2.7 + rp.y * 0.9 + psx_time * 1.9), sin(rp.y * 3.3 - rp.x * 0.7 - psx_time * 1.5)) * " + (k.Water == 2 ? "0.006 * (1.0 + psx_rain * 1.5)" : "0.06") + @";
		vec3 rn = normalize(nw + vec3(rip.x, 0.0, rip.y));
		float cos_v = max(dot(rn, -rd), 0.0);
		if (psx_water_mirror_on > 0.5) {
			// the quays, ships and sky mirrored (World/Mirrors.cs), shaken by the ripples
			mat4 mirror_mat = psx_mirror_columns > 0.5 ? mat4(psx_water_mirror_col0, psx_water_mirror_col1, psx_water_mirror_col2, psx_water_mirror_col3) : psx_water_mirror_mat;
			vec4 mr = mirror_mat * vec4(world, 1.0);
			vec2 muv = (vec2(mr.x, -mr.y) / mr.w + rip * 0.35) * 0.5 + 0.5;
			vec3 mc = texture(psx_water_mirror, muv).rgb;
			float f = " + (k.Water == 2 ? "0.48 + 0.48 * pow(1.0 - cos_v, 3.0)" : "max(0.22, 0.04 + 0.96 * pow(1.0 - cos_v, 5.0))") + @";
			// (the great storm: the torn-up water mirrors nothing)
			f = clamp(f * (1.0 - clamp((psx_sea - 3.6) / 2.0, 0.0, 1.0)), 0.0, 0.9);
			k3 *= 1.0 - f;
			ad = ad * (1.0 - f) + mc * 0.92 * f;
		} else {
			// (no mirror: the sky's grey at a slant)
			float t = clamp(pow(1.0 - cos_v, 4.0) * 0.8, 0.0, 0.75);
			k3 *= 1.0 - t;
			ad = ad * (1.0 - t) + fogc * 1.08 * t;
		}
		float foul = texture(psx_foul, (world.xz - psx_foul_box.xy) / psx_foul_box.zw).r;
		if (foul > 0.01) {
			// the vlieten and the canal were open sewers: murky water that mirrors less, a dull skin of scum in patches
			vec2 sp = world.xz * 0.8 + vec2(psx_time * 0.03, psx_time * 0.017);
			float scum = smoothstep(0.5, 0.68, foul_val(sp) * 0.7 + foul_val(sp * 3.1 + 7.7) * 0.3) * foul;
			float t = foul * 0.45;
			k3 *= 1.0 - t;
			ad = ad * (1.0 - t) + fogc * vec3(0.3, 0.28, 0.22) * t;
			t = scum * 0.8;
			k3 *= 1.0 - t;
			ad = ad * (1.0 - t) + (fogc * vec3(0.26, 0.23, 0.17) + vec3(0.03, 0.024, 0.014)) * t;
		}
		vec3 rr = reflect(rd, rn);
		float dash = 0.5 + 0.5 * sin(rp.y * 7.0 + rp.x * 1.3 + psx_time * 2.2);
		ad += psx_lamp_color.rgb * (lamp_reflects(world, rr) * 0.09 + lamp_streaks(world, rr) * 0.5 * dash * dash);
		// rain on the water: rings that catch the sky
		if (psx_rain > 0.001) ad += (fogc * 0.7 + 0.015) * rain_rings(world.xz, psx_time, psx_rain) * 0.6 * psx_rain;
		spec_k = dot(k3, vec3(0.333));
	}
");
        c.Append(@"	// the lamps' glow in the air between the eye and the surface
	vec3 halo = psx_lamp_color.rgb * psx_glow(CAMERA_POSITION_WORLD, rd, glow_reach(len, psx_fog_far, rd)) * psx_scatter * (0.35 + 0.65 * fog_k);
");
        if (!k.Fog) c.Append("	fog_k = 0.0;\n	halo = vec3(0.0);\n");
        if (k.Blend || k.Add) c.Append("	ALPHA = c.a;\n");
        if (k.Water > 0) c.Append("	ALPHA = 1.0;\n");
        if (lit)
            c.Append(@"	ALBEDO = c.rgb * k3;
	EMISSION = (emission * texture(emission_tex, uv).rgb * mix(vec3(1.0), psx_fill.rgb * COLOR.rgb, fill) + c.rgb * (sky + spilt)) * k3 + ad + halo;
	FOG = vec4(fogc + halo, fog_k);
}

void light() {
	// three's matt face: colour x light x cos / pi (LIGHT_COLOR comes times pi); the sun kept off by the houses
	float a = ATTENUATION;
	if (LIGHT_IS_DIRECTIONAL) a *= sun_lit;
	DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR / PI;
" + (k.Water > 0 || k.Ground ? @"	// the water's highlight, the wet stone's (three's Blinn-Phong): the sun and a real light glint on it
	vec3 hv = normalize(LIGHT + VIEW);
	vec3 fr = spec_color + (1.0 - spec_color) * pow(1.0 - max(dot(VIEW, hv), 0.0), 5.0);
	SPECULAR_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR * fr * (0.25 * (shininess * 0.5 + 1.0) / PI * pow(max(dot(NORMAL, hv), 0.0), shininess)) * spec_k;
" : "") + @"}
");
        else
            c.Append(@"	ALBEDO = c.rgb * k3 + ad + halo;
	FOG = vec4(fogc + halo, fog_k);
}
");
        s = new Shader { Code = c.ToString() };
        Shaders[k] = s;
        Kinds[s] = k;
        return s;
    }

    // ------------------------------------------------------------------ a baked material's options

    private static readonly Dictionary<string, Texture2D> Textures = new();

    /// <summary>A picture the psx options name (the bake's town_tex/uuid.png; a canvas in the browser: its top is v = 1).</summary>
    private static Texture2D? Tex(JsonElement e, string texDir)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty("tex", out var u)) return null;
        string id = u.GetString() ?? "";
        if (Textures.TryGetValue(id, out var t)) return t;
        string file = Path.Combine(texDir, id + ".png");
        if (!File.Exists(file)) return null;
        var im = Image.LoadFromFile(file);
        im.FlipY();
        im.GenerateMipmaps();
        t = ImageTexture.CreateFromImage(im);
        Textures[id] = t;
        return t;
    }

    private static double Num(JsonElement e, string k, double d) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : d;
    private static bool Has(JsonElement e, string k, out JsonElement v)
    {
        v = default;
        return e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out v) && v.ValueKind != JsonValueKind.Null && v.ValueKind != JsonValueKind.False;
    }

    /// <summary>
    /// The switches a baked material's psx options ask for (the bake's extras.psx.bake: psx.ts PsxOptions). The water
    /// keeps the plain material until the water's own step.
    /// </summary>
    public static Kind WithOptions(Kind k, JsonElement bake)
    {
        if (bake.ValueKind != JsonValueKind.Object) return k;
        if (Has(bake, "water", out _)) return k with { Water = Has(bake, "waterCalm", out _) ? 2 : 1 };
        if (Has(bake, "grimeDecal", out _)) return k with { Decal = true };
        if (bake.TryGetProperty("grime", out var gr) && gr.ValueKind == JsonValueKind.String && !Off.Contains("grime"))
            k = k with { Grime = gr.GetString() == "facade" ? 1 : 2 };
        if (Has(bake, "bump", out _) && !Off.Contains("bump")) k = k with { Bump = true };
        if (bake.TryGetProperty("tree", out var tr) && tr.ValueKind == JsonValueKind.Object)
            k = k with { Tree = (Has(tr, "leaf", out _) ? 2 : 1) + (Has(tr, "merged", out _) ? 2 : 0) };
        bool relief = Has(bake, "relief", out var r) && !Off.Contains("relief");
        k = k with { Far = Num(bake, "fogReach", 1) > 1 };
        return k with
        {
            Relief = relief ? (Has(r, "id", out _) ? 2 : 1) : 0,
            Parallax = relief && Num(r, "depth", 0) > 0,
            Detile = Has(bake, "detile", out _) && !Off.Contains("ground"),
            Ground = (Has(bake, "wet", out _) || Has(bake, "vary", out _) || Has(bake, "puddles", out _)) && !Off.Contains("ground"),
            Wall = (Has(bake, "foot", out _) || Num(bake, "mottle", 0) > 0) && !Off.Contains("wall"),
            Slabs = Has(bake, "slabs", out _) && !Off.Contains("relief"),
        };
    }

    /// <summary>The options' numbers and pictures on a material made with WithOptions' kind.</summary>
    public static void ApplyOptions(ShaderMaterial m, Kind k, JsonElement bake, string texDir)
    {
        if (bake.ValueKind != JsonValueKind.Object) return;
        if (k.Decal && Has(bake, "grimeDecal", out var gd))
        {
            if (Tex(gd.GetProperty("map"), texDir) is { } dt) m.SetShaderParameter("tex", dt);
            m.SetShaderParameter("cells", Num(gd, "cells", 4));
            return;
        }
        if (k.Grime > 0) Grime.Apply(m);
        if (k.Bump && Has(bake, "bump", out var bp))
        {
            if (Tex(bp, texDir) is { } bt) m.SetShaderParameter("bump_map", bt);
            m.SetShaderParameter("bump_scale", Num(bp, "scale", 1));
        }
        if (k.Water > 0)
        {
            // (the browser's water: the deep Schelde's highlight, the pond's; World/Waters.cs finds its sheets by this mark)
            var sp = Hex(k.Water == 2 ? 0x202b23 : 0x3a342a);
            m.SetShaderParameter("spec_color", new Vector3(sp.R, sp.G, sp.B));
            m.SetMeta("psx_water", k.Water);
            m.RenderPriority = -10;
        }
        if (k.Relief > 0 && Has(bake, "relief", out var r))
        {
            if (Tex(r.GetProperty("height"), texDir) is { } h) m.SetShaderParameter("relief_h", h);
            if (k.Relief > 1 && Tex(r.GetProperty("id"), texDir) is { } id) m.SetShaderParameter("stone_id", id);
            m.SetShaderParameter("relief_depth", Num(r, "depth", 0));
            m.SetShaderParameter("relief_tile", Num(r, "tile", 4));
            m.SetShaderParameter("relief_bump", Num(r, "bump", 3));
            m.SetShaderParameter("relief_holes", Num(r, "holes", 0));
            m.SetShaderParameter("relief_reach", Num(r, "reach", 1));
        }
        if (k.Ground)
        {
            m.SetShaderParameter("vary", Num(bake, "vary", 0));
            m.SetShaderParameter("puddles", Has(bake, "wet", out _) ? Num(bake, "puddles", 0) : 0);
            // the wet stone's highlight: three's specular (linear) and shininess, by the bake (else the flags')
            if (Has(bake, "wet", out _))
            {
                var sc = Hex(0x1a1a1a);
                var spec = Has(bake, "spec", out var sp) && sp.ValueKind == JsonValueKind.Array && sp.GetArrayLength() == 4
                    ? new Vector4(sp[0].GetSingle(), sp[1].GetSingle(), sp[2].GetSingle(), sp[3].GetSingle()) : new Vector4(sc.R, sc.G, sc.B, 12);
                m.SetShaderParameter("spec_color", new Vector3(spec.X, spec.Y, spec.Z));
                m.SetShaderParameter("shininess", spec.W);
            }
        }
        if (k.Wall)
        {
            bool foot = Has(bake, "foot", out var f);
            m.SetShaderParameter("foot", foot ? Num(f, "amount", 0) : 0);
            m.SetShaderParameter("foot_wear", foot && Has(f, "vertexWear", out _) ? 1 : 0);
            m.SetShaderParameter("mottle", Num(bake, "mottle", 0));
        }
        if (k.Slabs && Has(bake, "slabs", out var s))
        {
            if (Tex(s.GetProperty("map"), texDir) is { } map) m.SetShaderParameter("slab_map", map);
            if (Tex(s.GetProperty("height"), texDir) is { } sh) m.SetShaderParameter("slab_h", sh);
            m.SetShaderParameter("slab_tile", Num(s, "tile", 2.6));
            m.SetShaderParameter("slab_ymax", Num(s, "yMax", 0.8));
        }
    }
}
