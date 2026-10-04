using System;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The sky dome (the browser's world/sky.ts): a low grey autumn overcast round the air's colour, drifting with the
/// wind; a lower, darker deck in rain and storm; a warm band where the evening sun goes down and a cold one at dawn;
/// at night black cloud lit brown from under by the town's gas, a few stars in the gaps on a clear night. It fades
/// into the fog's colour at the horizon and takes the lamps' glow in the air, as the far houses do. One draw: the
/// bake's own sphere ("cloud_sky"), with the shader below; it goes where the camera goes.
/// </summary>
[GamePart(20)]
public partial class Sky : Node
{
    private const string Code = @"
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never, fog_disabled;
uniform vec3 air;
uniform vec2 drift;
uniform float cover = 0.7;
uniform float dark = 0.0;
uniform float night = 0.0;
uniform float stars = 0.0;
uniform float warm = 0.0;
uniform float cold = 0.0;
uniform vec3 warm_col = vec3(0.36, 0.14, 0.045);
uniform vec3 cold_col = vec3(0.05, 0.07, 0.1);
uniform vec2 sun_xz = vec2(-1.0, 0.0);
uniform float fog_sky = 0.0;
uniform float deck = 16.0;
global uniform float psx_time;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
" + Psx.LampScatterGlsl + @"
varying vec3 dir;
void vertex() {
	dir = VERTEX;
	POSITION = PROJECTION_MATRIX * (MODELVIEW_MATRIX * vec4(VERTEX, 1.0));
	// on the far plane's inside: never in front of anything (Godot's depth runs from 1 near to 0 far)
	POSITION.z = POSITION.w * 0.00001;
}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
	float a = 0.5, s = 0.0;
	for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
	return s;
}
void fragment() {
	vec3 d = normalize(dir);
	vec3 rd = d;
	// the PS1 sky: the direction in coarse steps (about a third of a degree), so the cloud edges are blocky
	d = normalize(floor(d * 180.0 + 0.5) / 180.0);
	float e = d.y;
	// the cloud deck: a plane over the town, seen in perspective (the clouds bunch up toward the horizon)
	vec2 p = d.xz / (max(e, 0.0) + 0.09) * 1.6;
	vec2 q = p + drift;
	float n = fbm(q * 0.4);
	float mass = fbm(q * 0.16 + vec2(3.7, 1.9));
	float c = clamp(n * 0.55 + mass * 0.75 - 0.08, 0.0, 1.0);
	float dens = smoothstep(1.0 - cover - 0.25, 1.0 - cover + 0.25, c);
	// underside shading: thick cloud darker, thin cloud and the breaks lighter; the mean stays about 1
	float shade = mix(1.3, 0.74, dens) - 0.16 * smoothstep(0.55, 0.95, c) * dens + 0.1 * (n - 0.5);
	shade = mix(shade, shade * 0.82, dark);
	vec3 col = air * shade;
	// the evening's warm band where the sun goes down; the dawn's cold band opposite
	vec2 hz = normalize(d.xz + 1e-5);
	float to_sun = max(0.0, dot(hz, sun_xz));
	float band = pow(to_sun, 3.0) * (1.0 - smoothstep(0.02, 0.5, e));
	col += warm_col * warm * band * (0.6 + 0.6 * smoothstep(0.35, 0.75, n)) * (0.5 + 0.8 * (1.0 - dens));
	float away = pow(max(0.0, -dot(hz, sun_xz)), 2.0) * (1.0 - smoothstep(0.02, 0.4, e));
	col = mix(col, col * 0.75 + cold_col, cold * away * 0.8);
	// night: the gas of the town on the undersides, low all round
	col += vec3(0.022, 0.014, 0.007) * night * dens * (1.0 - smoothstep(0.0, 0.5, e));
	// stars through the gaps on a clear night
	if (stars > 0.0) {
		vec2 sc = floor(d.xz / (e + 0.25) * 150.0);
		float st = h21(sc + 7.3);
		float tw = 0.7 + 0.3 * sin(psx_time * (2.0 + st * 5.0) + st * 40.0);
		col += vec3(0.8, 0.82, 0.9) * step(0.998, st) * (1.0 - dens) * stars * smoothstep(0.15, 0.4, e) * tw * 0.5;
	}
	// into the air at the horizon: the far fog and the sky meet without a seam
	float hor = smoothstep(0.015, 0.3, e);
	// night: as high as a roof `deck` metres over the eye would be lost in the fog, the sky is the fog
	float deck_fog = smoothstep(psx_fog_near, psx_fog_far, deck / max(e, 0.001));
	hor = mix(hor, min(hor, 1.0 - deck_fog), fog_sky);
	// and over it the night's clouds are never darker than the air
	col = mix(col, max(col, air), fog_sky);
	vec3 a = air + warm_col * warm * pow(to_sun, 2.5) * 0.35;
	a = mix(a, a * 0.8 + cold_col * 0.5, cold * away * 0.6);
	// the lamps' glow in the air in front of the sky, as in front of the far houses
	float glow = psx_glow(CAMERA_POSITION_WORLD, rd, glow_reach(1e4, psx_fog_far, rd));
	ALBEDO = mix(a, col, hor) + psx_lamp_color.rgb * glow * psx_scatter;
}
";

    /// <summary>Cloud cover and darkness by weather, and how fast it drives (sky.ts DECK).</summary>
    private static (float cover, float dark, float speed) Deck(string w) => w switch
    {
        "mist" => (0.62f, 0.1f, 0.6f),
        "clear" => (0.5f, 0.0f, 0.9f),
        "rain" => (0.9f, 0.7f, 1.5f),
        "storm" => (0.97f, 1.0f, 3.2f),
        _ => (0.72f, 0.15f, 0.35f),
    };

    private MeshInstance3D dome = null!;
    private ShaderMaterial mat = null!;
    private (float cover, float dark, float speed) cur;
    private bool first = true;
    private Vector2 drift;

    private static float Smooth(float x, float a, float b)
    {
        if (x <= a) return 0;
        if (x >= b) return 1;
        x = (x - a) / (b - a);
        return x * x * (3 - 2 * x);
    }
    private static float Bump(float h, float a, float p0, float p1, float b) => h <= a || h >= b ? 0 : h < p0 ? Smooth(h, a, p0) : h <= p1 ? 1 : 1 - Smooth(h, p1, b);

    public override void _Ready()
    {
        Psx.EnsureGlobals();
        mat = new ShaderMaterial { Shader = new Shader { Code = Code } };
        if (Main.I.World.FindChild("cloud_sky", true, false) is MeshInstance3D m) dome = m;
        else
        {
            // (a bake without the dome: one of our own, the browser's size)
            dome = new MeshInstance3D { Name = "cloud_sky", Mesh = new SphereMesh { Radius = 560, Height = 1120, RadialSegments = 16, Rings = 8 } };
            Main.I.View.AddChild(dome);
        }
        dome.MaterialOverride = mat;
        dome.Visible = true;
        dome.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
        dome.ExtraCullMargin = 2000;
        Main.I.World.Unported.Remove("cloud_sky");
        // after the daylight has set the air and the camera has moved
        ProcessPriority = 50;
        if (Daylight.I != null) Daylight.I.Settled += () => first = true;
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        if (day == null) return;
        float dt = (float)delta, t = Time.GetTicksMsec() / 1000f;
        var target = Deck(day.Weather);
        float k = first ? 1 : Math.Min(1, dt * 0.3f);
        first = false;
        target.speed *= 1 + 1.6f * day.Storm; // the great storm: the deck races over
        cur = (cur.cover + (target.cover - cur.cover) * k, cur.dark + (target.dark - cur.dark) * k, cur.speed + (target.speed - cur.speed) * k);
        // the smoke's wind (ambient.ts): the same slow veer, so the clouds and the plumes go the same way
        float wa = 0.35f + MathF.Sin(t * 0.013f) * 0.25f;
        drift += new Vector2(MathF.Cos(wa), MathF.Sin(wa)) * (cur.speed * dt * 0.012f);
        float hour = day.Hour;
        var air = day.FogColor;
        float night = Mathf.Clamp(1 - Smooth(hour, 5.2f, 7.2f) + Smooth(hour, 18.2f, 20.0f), 0, 1);
        // (by how dark the air is, not the clock: the dusk and the dawn are dark enough, a fog day stays as it was)
        float airL = 0.2126f * air.R + 0.7152f * air.G + 0.0722f * air.B;
        // a clear or a misty evening: the warm band (fog and rain close it off)
        float open = Math.Max(day.Clear, day.Weather == "mist" ? 0.45f : day.Weather == "fog" ? 0.15f : 0);
        mat.SetShaderParameter("air", new Vector3(air.R, air.G, air.B));
        mat.SetShaderParameter("drift", drift);
        mat.SetShaderParameter("cover", cur.cover);
        mat.SetShaderParameter("dark", cur.dark);
        mat.SetShaderParameter("night", night);
        mat.SetShaderParameter("stars", night * day.Clear * (1 - cur.dark));
        mat.SetShaderParameter("fog_sky", 1 - Smooth(airL, 0.035f, 0.08f));
        mat.SetShaderParameter("warm", Bump(hour, 16.2f, 17.3f, 18.3f, 19.1f) * open * (1 - cur.dark * 0.8f));
        mat.SetShaderParameter("cold", Bump(hour, 5.4f, 6.4f, 7.4f, 8.6f) * open * (1 - cur.dark * 0.8f));
        var s = new Vector2(day.SunDir.X, day.SunDir.Z);
        if (s.LengthSquared() > 1e-6f) mat.SetShaderParameter("sun_xz", s.Normalized());
        var cam = Main.I.View.GetCamera3D();
        if (cam != null) dome.GlobalPosition = new Vector3(cam.GlobalPosition.X, 0, cam.GlobalPosition.Z);
    }
}
