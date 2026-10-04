using System;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The rain (the browser's world/ambient.ts buildRain): streaks as thin strips in a box of 28 x 14 x 28 m that goes
/// with the eye, each the drop's fall in one frame, laid over by the wind, a little lighter than the air and lit by
/// the gas lamps near them; close drops only (far off, rain is the weather's thicker air). How much falls is
/// Daylight.Rain (psx_rain): showers come and go on a rain day, a storm never quite stops. The wet stone, the rings
/// in the puddles and the darker sky are the psx material's and the sky's. One draw; hidden when it is dry.
/// Not here: the great storm's sheets and gusts (world/tempest.ts), and no rain under a roof.
/// </summary>
[GamePart(40)]
public partial class Rain : Node
{
    private const int N = 6000;

    private const string Code = @"
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
global uniform float psx_time;
global uniform float psx_rain;
global uniform float psx_storm;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
global uniform vec4 psx_lamp0;
global uniform vec4 psx_lamp1;
global uniform vec4 psx_lamp2;
global uniform vec4 psx_lamp3;
global uniform vec4 psx_lamp4;
global uniform vec4 psx_lamp5;
global uniform vec4 psx_lamp_color;
uniform vec2 wind = vec2(0.9, 0.35);
uniform float expo = 0.02;
uniform vec4 room = vec4(1.0, 1.0, 0.0, 0.0);
varying vec3 col;
varying float alpha;
varying float seg;
varying float fog_depth;
vec3 lamp(vec3 p, vec4 l) {
	vec3 d = p - l.xyz;
	return psx_lamp_color.rgb * l.w * 1.3 / (1.0 + dot(d, d) * 0.3);
}
void vertex() {
	seg = CUSTOM0.x;
	float side = CUSTOM0.y;
	float seed = CUSTOM0.z;
	vec3 box = vec3(28.0, 14.0, 28.0);
	// each drop a little its own way in the wind
	float jit = fract(seed * 13.7) - 0.5;
	// (the great storm: it drives down harder, and the wind lays it over)
	vec3 vel = vec3(wind.x * (1.6 + jit * 0.5), (-8.5 - seed * 2.5) * (1.0 + 0.45 * psx_storm), wind.y * (1.6 - jit * 0.5));
	vec3 lo = CAMERA_POSITION_WORLD - vec3(14.0, 5.0, 14.0);
	vec3 head = lo + mod(VERTEX + vel * psx_time - lo, box);
	// a streak is the drop's fall in one frame, a little more or less drop by drop
	vec3 tail = head - vel * expo * (0.85 + 0.3 * fract(seed * 5.31));
	vec4 mh = VIEW_MATRIX * vec4(head, 1.0);
	vec4 mt = VIEW_MATRIX * vec4(tail, 1.0);
	vec4 ch = PROJECTION_MATRIX * mh;
	vec4 ct = PROJECTION_MATRIX * mt;
	vec3 p = seg > 0.5 ? tail : head;
	fog_depth = seg > 0.5 ? -mt.z : -mh.z;
	POSITION = seg > 0.5 ? ct : ch;
	// widened across the streak on the screen: a pixel and a half at the game's 270 lines, more for the nearest
	float aspect = abs(PROJECTION_MATRIX[1][1] / PROJECTION_MATRIX[0][0]);
	vec2 dir = ct.xy / max(ct.w, 1e-3) - ch.xy / max(ch.w, 1e-3);
	dir.x *= aspect;
	dir = length(dir) > 1e-6 ? normalize(dir) : vec2(0.0, 1.0);
	vec2 perp = vec2(-dir.y, dir.x);
	perp.x /= aspect;
	float px = (0.75 + 0.9 * (1.0 - smoothstep(0.8, 3.5, fog_depth))) * (1.0 + 0.4 * psx_storm);
	POSITION.xy += perp * side * px * (2.0 / 270.0) * POSITION.w;
	// rain barely shows in grey daylight (a little lighter than the air); a drop by a gas lamp catches its glow
	col = psx_fog_color.rgb * (1.3 + 0.5 * psx_storm) + 0.01 + 0.05 * psx_storm + lamp(p, psx_lamp0) + lamp(p, psx_lamp1) + lamp(p, psx_lamp2) + lamp(p, psx_lamp3) + lamp(p, psx_lamp4) + lamp(p, psx_lamp5);
	// close drops only: far off, rain is thicker air, not streaks; both ends in front of the eye, or none
	// (the great storm: sheets of it, seen farther off: the whole box)
	float near = smoothstep(0.4, 1.2, fog_depth) * (1.0 - smoothstep(3.0 + 5.0 * psx_storm, 7.0 + 6.0 * psx_storm, fog_depth));
	alpha = step(seed, psx_rain * (0.267 + 0.733 * psx_storm)) * near * (0.08 + 0.2 * fract(seed * 7.3)) * (0.5 + 0.5 * psx_rain) * (1.0 + 2.6 * psx_storm) * step(0.7, min(-mh.z, -mt.z)) * 0.75;
	if (psx_storm > 0.0) {
		// the rain comes in curtains that sweep along with the wind, thick and thin by turns
		vec2 wd = normalize(wind + vec2(1e-4));
		float along = dot(head.xz, wd) - psx_time * length(wind) * 1.1;
		float cu = 0.5 + 0.5 * sin(along * 0.21 + sin(dot(head.xz, vec2(-wd.y, wd.x)) * 0.09) * 2.0) * sin(along * 0.083 + 1.3);
		alpha *= mix(1.0, 0.3 + 1.1 * smoothstep(0.25, 0.8, cu), psx_storm);
	}
	// in a room: no rain in it, only out of the windows (its box in x and z)
	if (room.z > room.x && head.x > room.x && head.x < room.z && head.z > room.y && head.z < room.w) alpha = 0.0;
	if (alpha < 0.004) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
}
void fragment() {
	float f = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	// the head of the streak (where the drop is now) bright, its tail faint: the eye reads which way it goes
	ALBEDO = mix(col, psx_fog_color.rgb, f * 0.8);
	ALPHA = alpha * (1.0 - f * 0.6) * mix(1.25, 0.12, seg);
}
";

    private MeshInstance3D mesh = null!;
    private ShaderMaterial mat = null!;
    private float expo = 1f / 50;

    public override void _Ready()
    {
        Psx.EnsureGlobals();
        // the same drops as the browser's: mulberry32(99)
        uint a = 99;
        float R()
        {
            unchecked
            {
                a += 0x6d2b79f5;
                uint t = a;
                t = (t ^ (t >> 15)) * (t | 1);
                t ^= t + (t ^ (t >> 7)) * (t | 61);
                return ((t ^ (t >> 14)) >> 0) / 4294967296f;
            }
        }
        var pos = new Vector3[N * 4];
        var custom = new float[N * 16];
        var idx = new int[N * 6];
        for (int i = 0; i < N; i++)
        {
            var p = new Vector3(R() * 28, R() * 14, R() * 28);
            float sd = R();
            for (int k = 0; k < 4; k++)
            {
                pos[i * 4 + k] = p;
                custom[(i * 4 + k) * 4] = k >> 1;
                custom[(i * 4 + k) * 4 + 1] = (k & 1) != 0 ? 1 : -1;
                custom[(i * 4 + k) * 4 + 2] = sd;
            }
            int[] tri = { 0, 1, 2, 2, 1, 3 };
            for (int k = 0; k < 6; k++) idx[i * 6 + k] = i * 4 + tri[k];
        }
        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = pos;
        arrays[(int)Mesh.ArrayType.Custom0] = custom;
        arrays[(int)Mesh.ArrayType.Index] = idx;
        var m = new ArrayMesh();
        m.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, (Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.RgbaFloat << (int)Mesh.ArrayFormat.FormatCustom0Shift));
        // (the drops go where the eye goes: never culled by where the mesh was made)
        m.CustomAabb = new Aabb(new Vector3(-1e5f, -1e3f, -1e5f), new Vector3(2e5f, 2e3f, 2e5f));
        mat = new ShaderMaterial { Shader = new Shader { Code = Code }, RenderPriority = 3 };
        m.SurfaceSetMaterial(0, mat);
        mesh = new MeshInstance3D { Name = "ambient_rain", Mesh = m, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Visible = false, Layers = Mirrors.NoMirror };
        Main.I.View.AddChild(mesh);
    }

    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Rain");
        var day = Daylight.I;
        if (day == null) return;
        mesh.Visible = day.Rain > 0.01f;
        if (!mesh.Visible) return;
        // a streak is one frame's fall: the frame's length, eased (a hitch does not stretch the rain)
        expo += (Mathf.Clamp((float)delta, 1f / 60, 1f / 24) - expo) * 0.1f;
        mat.SetShaderParameter("expo", expo);
        // (the great storm: harder, about twice the gale's wind)
        mat.SetShaderParameter("wind", day.Wind * (1 + 0.9f * day.Storm));
        // no rain round the eye under a roof: the room's box (World/Rooms.cs)
        var box = Rooms.I?.Around(Main.I.View.GetCamera3D()?.GlobalPosition ?? Vector3.Zero);
        mat.SetShaderParameter("room", box is { } bx ? new Vector4(bx.Position.X, bx.Position.Z, bx.End.X, bx.End.Z) : new Vector4(1, 1, 0, 0));
    }
}
