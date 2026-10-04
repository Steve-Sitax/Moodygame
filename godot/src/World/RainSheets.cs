using System;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The great storm's far rain (the browser's world/ambient.ts buildRainSheets, after the rain layers of ATI's ToyShop):
/// two open cylinders round the eye, 9 and 17 m out, with streaks falling down their inside at the drops' speed, laid
/// over by the wind and thick and thin in sweeping curtains, and on the far one grey billows of rain rolling by.
/// Walls nearer than a layer hide it (the depth test): in a lane the rain is what falls in the lane. Drawn only while
/// it pours in the great storm (Daylight.Storm), none in a room round the eye. One draw, one shader, made at the start.
/// Not here: the gusts' white veils (the browser's wind fronts are not ported).
/// </summary>
[GamePart(34)]
public partial class RainSheets : Node
{
    private MeshInstance3D mesh = null!;
    private ShaderMaterial mat = null!;
    private float expo = 1 / 50f;

    private const string Code = @"
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_front, fog_disabled;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
global uniform float psx_time;
global uniform float psx_rain;
global uniform float psx_storm;
uniform vec2 wind = vec2(1.0, 0.0);
uniform float expo = 0.02;
uniform float night = 0.0;
uniform vec4 room = vec4(1.0, 1.0, 0.0, 0.0);
varying vec3 l;
varying vec3 w;
varying float fog_depth;
float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void vertex() {
	l = VERTEX;
	w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec4 mv = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -mv.z;
	POSITION = PROJECTION_MATRIX * mv;
}
void fragment() {
	float amt = psx_rain * psx_storm;
	if (amt < 0.02) discard;
	if (room.z > room.x && w.x > room.x && w.x < room.z && w.z > room.y && w.z < room.w) discard;
	float R = length(l.xz);
	float ang = atan(l.z, l.x);
	vec2 tang = vec2(-sin(ang), cos(ang));
	float fall = 12.0 + 4.0 * psx_storm;
	// laid over by the wind across the line of sight
	float slant = dot(wind * 1.6, tang) / fall;
	float u = ang * R + l.y * slant;
	float cw = 0.2 * R / 9.0;
	float col = floor(u / cw);
	float h1 = hash12(vec2(col, R));
	float h2 = hash12(vec2(col * 1.7 + 3.1, R * 0.37));
	float xf = fract(u / cw);
	float thin = 1.0 - smoothstep(0.08, 0.2, abs(xf - 0.3 - h1 * 0.4));
	float sp = 1.6 + h2 * 2.4;
	float y = w.y + psx_time * fall * (0.9 + 0.2 * h1) + h2 * 37.0;
	float f = fract(y / sp);
	float len = clamp(fall * expo * 1.2 / sp, 0.05, 0.6);
	float streak = step(f, len) * (1.0 - 0.85 * f / len) * step(h1, amt * 0.9 + 0.1);
	// the curtains, as the near drops have them
	vec2 wd = normalize(wind + vec2(1e-4));
	float along = dot(w.xz, wd) - psx_time * length(wind) * 1.1;
	float c = 0.5 + 0.5 * sin(along * 0.21 + sin(dot(w.xz, vec2(-wd.y, wd.x)) * 0.09) * 2.0) * sin(along * 0.083 + 1.3);
	float curtain = 0.3 + 1.1 * smoothstep(0.25, 0.8, c);
	float k = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	float a = thin * streak * curtain * amt * (R < 12.0 ? 0.8 : 0.6) * (1.0 - 0.5 * k);
	// the rain so thick it rolls by in grey clouds, on the far layer only
	if (R > 12.0) {
		vec2 hp = vec2(along * 0.08, w.y * 0.12 + dot(w.xz, vec2(-wd.y, wd.x)) * 0.05);
		float billow = 0.5 + 0.25 * sin(hp.x * 3.1 + sin(hp.y * 2.3) * 1.7) + 0.25 * sin(hp.x * 1.3 - hp.y * 1.9 + 2.0);
		a += smoothstep(0.4, 0.95, billow) * 0.12 * amt;
	}
	if (a < 0.004) discard;
	ALBEDO = mix(psx_fog_color.rgb * 1.45 + 0.03, psx_fog_color.rgb, k * 0.6) * (1.0 - 0.3 * night);
	ALPHA = a;
}
";

    public override void _Ready()
    {
        ProcessPriority = 55;
        mat = new ShaderMaterial { Shader = new Shader { Code = Code }, RenderPriority = 2 };
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        foreach (float r in new[] { 9f, 17f })
        {
            const int seg = 40;
            for (int i = 0; i < seg; i++)
            {
                float a0 = i * MathF.Tau / seg, a1 = (i + 1) * MathF.Tau / seg;
                Vector3 p0 = new(MathF.Cos(a0) * r, -8, MathF.Sin(a0) * r), p1 = new(MathF.Cos(a1) * r, -8, MathF.Sin(a1) * r);
                Vector3 q0 = p0 + new Vector3(0, 26, 0), q1 = p1 + new Vector3(0, 26, 0);
                // (facing out: the inside is drawn, cull_front)
                st.AddVertex(p0); st.AddVertex(q0); st.AddVertex(p1);
                st.AddVertex(p1); st.AddVertex(q0); st.AddVertex(q1);
            }
        }
        var m = st.Commit();
        m.SurfaceSetMaterial(0, mat);
        m.CustomAabb = new Aabb(new Vector3(-18, -9, -18), new Vector3(36, 28, 36));
        mesh = new MeshInstance3D { Name = "ambient_rainsheets", Mesh = m, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Visible = false, Layers = Mirrors.NoMirror };
        Main.I.View.AddChild(mesh);
        Main.I.World.Unported.RemoveAll(u => u is "ambient_rainsheets" or "ambient_rain");
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        var cam = Main.I.View.GetCamera3D();
        if (day == null || cam == null) return;
        bool on = day.Weather == "storm" && day.Storm * day.Rain > 0.02f;
        if (mesh.Visible != on) mesh.Visible = on;
        if (!on) return;
        var eye = cam.GlobalPosition;
        mesh.GlobalPosition = eye;
        expo += (Math.Clamp((float)delta, 1 / 60f, 1 / 24f) - expo) * 0.1f;
        mat.SetShaderParameter("expo", expo);
        mat.SetShaderParameter("wind", day.Wind * (1 + 0.9f * day.Storm));
        mat.SetShaderParameter("night", day.Night);
        var box = Rooms.I?.Around(eye);
        mat.SetShaderParameter("room", box is { } b ? new Vector4(b.Position.X, b.Position.Z, b.End.X, b.End.Z) : new Vector4(1, 1, 0, 0));
    }
}
