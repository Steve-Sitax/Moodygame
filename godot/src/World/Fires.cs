using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// Open fires (the browser's world/fire.ts): the tar-barrel fires on the quays, the hearths and stoves in the rooms, a
/// burning house. Each fire is a few dozen points worked out on the graphics card from their own seed and the clock:
/// tongues of flame that rise, sway and burn from a white-yellow heart to orange to deep red, sparks that shoot up and
/// wink out, smoke above (the lamps' glow in the air in front of it), and a soft warm glow round each fire that
/// breathes. No light of their own. The bake's fires (a group "fires" with its spots in the extras) are made at the
/// start; a part makes its own with Create:
///   var f = Fires.I.Create(new[] { (at, 1.5f) }, smoke: 18);   a burning house (game/townlife.ts)
///   f.SetLevel(0.6f, 1.2f);  f.Free();
/// </summary>
[GamePart(38)]
public partial class Fires : Node
{
    public static Fires? I { get; private set; }

    private const int Flames = 40, Sparks = 10;
    private readonly List<Fire> fires = new();
    private Shader flameShader = null!, smokeShader = null!, glowShader = null!;

    /// <summary>Counts for a check: the fires, the spots.</summary>
    public (int fires, int spots) Info => (fires.Count, fires.Sum(f => f.Spots));

    /// <summary>One set of fires made together: its level and its smoke.</summary>
    public sealed class Fire
    {
        internal readonly List<ShaderMaterial> Mats = new();
        internal Node3D Root = null!;
        internal int Spots;
        /// <summary>How fierce (0 out .. 1 full), and how thick the smoke (0..1.5; steam when the water hits).</summary>
        public void SetLevel(float flame, float smoke = 1)
        {
            foreach (var m in Mats)
            {
                m.SetShaderParameter("level", Mathf.Clamp(flame, 0, 1));
                m.SetShaderParameter("smoke", Math.Max(0, smoke));
            }
        }

        /// <summary>Take it out of the world.</summary>
        public void Free()
        {
            if (GodotObject.IsInstanceValid(Root)) Root.QueueFree();
            I?.fires.Remove(this);
        }
    }

    private const string Common = @"
shader_type spatial;
render_mode unshaded, depth_draw_never, cull_disabled, fog_disabled, BLEND;
global uniform float psx_time;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform float level = 1.0;
uniform float smoke = 1.0;
varying float life;
varying float kind;
varying float fog_depth;
varying float seed;
varying vec3 glow;
float hash(float n) { return fract(sin(n * 91.345) * 47453.5453); }
void vertex() {
	// each copy is one point of the fire: its place the fire's (the copy's origin), INSTANCE_CUSTOM its seed, kind, size
	float sd = INSTANCE_CUSTOM.x;
	kind = INSTANCE_CUSTOM.y;
	float sz = INSTANCE_CUSTOM.z;
	seed = sd;
	float lf = kind < 0.5 ? 0.55 + 0.35 * hash(sd) : kind < 1.5 ? 1.1 + 0.8 * hash(sd) : 3.5 + 2.0 * hash(sd);
	float age = fract(psx_time / lf + sd * 7.13);
	life = age;
	vec3 p = MODEL_MATRIX[3].xyz;
	float a = hash(sd + 1.0) * 6.2832;
	float rad = hash(sd + 2.0);
	float t = psx_time;
	if (kind < 0.5) {
		// a tongue of flame: starts spread over the fuel, rises and narrows, sways
		float spread = 0.22 * sz * (1.0 - age * 0.7);
		p.x += cos(a) * rad * spread + sin(t * 7.0 + sd * 40.0) * 0.05 * age * sz;
		p.z += sin(a) * rad * spread + cos(t * 6.1 + sd * 33.0) * 0.05 * age * sz;
		p.y += age * (0.55 + 0.35 * hash(sd + 3.0)) * sz;
	} else if (kind < 1.5) {
		// a spark: shoots up fast, drifts, fades
		p.x += cos(a) * rad * 0.15 * sz + sin(sd * 20.0 + t) * 0.3 * age;
		p.z += sin(a) * rad * 0.15 * sz + cos(sd * 17.0 + t) * 0.3 * age;
		p.y += age * (1.8 + 1.2 * hash(sd + 4.0)) * sz;
	} else {
		// smoke: rises slowly from above the flames, spreads, drifts on the wind
		p.y += (0.6 + age * 2.6) * sz;
		p.x += age * age * 0.9 + cos(a) * age * 0.3;
		p.z += age * age * 0.4 + sin(a) * age * 0.3;
	}
	vec4 mv = VIEW_MATRIX * vec4(p, 1.0);
	fog_depth = -mv.z;
	// a square facing the eye, as big as the browser's point (never under about a pixel)
	float px = kind < 0.5 ? (0.46 - 0.26 * age) * sz * level : kind < 1.5 ? 0.035 * step(0.05, level) : (0.35 + 0.9 * age) * sz;
	float side = max(px, 0.0025 * -mv.z);
	POSITION = PROJECTION_MATRIX * vec4(mv.xyz + vec3(VERTEX.xy * side, 0.0), 1.0);
	GLOW
}
";

    private const string FlameFrag = @"
void fragment() {
	if (level < 0.01 || kind > 1.5) discard;
	vec2 c = vec2(UV.x, UV.y) - 0.5;
	if (length(c) * 2.0 > 1.0) discard;
	float fog = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	if (kind < 0.5) {
		// a tongue of flame: wide at the root, drawn up to a flickering point, bent by the draught; white-yellow in
		// its heart, orange, deep red toward its tip and as it dies
		float t = life;
		float up = 0.5 - c.y;
		float bend = sin(up * 4.0 + seed * 31.0 + psx_time * 8.0) * 0.09 * up;
		float w = 0.44 * pow(max(0.0, 1.0 - up), 0.8) * (0.85 + 0.15 * sin(psx_time * 11.0 + seed * 17.0));
		float dx = abs(c.x - bend);
		if (dx > w || up < 0.0) discard;
		float core = 1.0 - dx / max(w, 0.001);
		float heat = core * (1.0 - up * 0.8) * (1.0 - t * 0.6);
		vec3 col = mix(vec3(0.75, 0.16, 0.03), vec3(1.0, 0.55, 0.12), smoothstep(0.1, 0.45, heat));
		col = mix(col, vec3(1.0, 0.93, 0.62), smoothstep(0.5, 0.85, heat));
		float a = smoothstep(0.0, 0.35, core) * (1.0 - smoothstep(0.65, 1.0, t)) * 0.95;
		ALBEDO = col * a * (1.0 - fog * 0.85);
	} else {
		float a = (1.0 - life) * step(0.3, fract(seed * 13.0 + life * 9.0));
		ALBEDO = vec3(1.0, 0.7, 0.3) * a * (1.0 - fog);
	}
}
";

    private const string SmokeFrag = @"
void fragment() {
	if (kind < 1.5 || smoke < 0.01) discard;
	vec2 c = vec2(UV.x, UV.y) - 0.5;
	float d = length(c) * 2.0;
	if (d > 1.0) discard;
	float a = min(0.85, (1.0 - d) * smoothstep(0.0, 0.15, life) * (1.0 - life) * 0.35 * min(smoke, 2.5));
	vec3 col = mix(vec3(0.16, 0.15, 0.14), psx_fog_color.rgb, 0.4 + 0.5 * life);
	float fog = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	ALBEDO = mix(col, psx_fog_color.rgb, fog) + glow * (0.35 + 0.65 * fog);
	ALPHA = a * (1.0 - fog);
}
";

    /// <summary>The glow round each fire (the browser's sprite): a soft warm disc that faces the eye and breathes.</summary>
    private const string GlowCode = @"
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
global uniform float psx_time;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform float level = 1.0;
varying float breath;
varying float fog_depth;
void vertex() {
	// INSTANCE_CUSTOM: x its size (2.6 m a barrel), y its own dice
	float sd = INSTANCE_CUSTOM.y;
	breath = 0.85 + 0.1 * sin(psx_time * 9.1 + sd) + 0.06 * sin(psx_time * 23.7 + sd * 3.0);
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	fog_depth = -c.z;
	float b = INSTANCE_CUSTOM.x * breath * (0.3 + 0.7 * level);
	POSITION = PROJECTION_MATRIX * vec4(c + vec3(VERTEX.xy * b, 0.0), 1.0);
	if (level < 0.01) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
}
void fragment() {
	// (the browser's picture: 0.9 at the middle, 0.35 at 0.4 of the radius, nothing at the edge)
	float r = clamp(length(UV - 0.5) * 2.0, 0.0, 1.0);
	vec4 a = vec4(1.0, 0.667, 0.314, 0.9), b = vec4(1.0, 0.431, 0.157, 0.35), c = vec4(1.0, 0.314, 0.078, 0.0);
	vec4 tx = r < 0.4 ? mix(a, b, r / 0.4) : mix(b, c, (r - 0.4) / 0.6);
	float fog = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	ALBEDO = tx.rgb * tx.a * 0.45 * breath * level * (1.0 - fog);
}
";

    public override void _Ready()
    {
        I = this;
        flameShader = new Shader { Code = Common.Replace("BLEND", "blend_add").Replace("GLOW", "glow = vec3(0.0);") + FlameFrag };
        // (the smoke: the gas lamps' glow in the air in front of it, as in front of the sky behind it)
        smokeShader = new Shader
        {
            Code = Common.Replace("BLEND", "blend_mix").Replace("float hash(", Psx.LampScatterGlsl + "\nfloat hash(").Replace("GLOW", @"vec3 wp = p;
	vec3 to_p = wp - CAMERA_POSITION_WORLD;
	float len = length(to_p);
	vec3 rd = to_p / max(len, 1e-4);
	glow = kind > 1.5 ? psx_lamp_color.rgb * psx_glow(CAMERA_POSITION_WORLD, rd, glow_reach(len, psx_fog_far, rd)) * psx_scatter : vec3(0.0);") + SmokeFrag,
        };
        glowShader = new Shader { Code = GlowCode };
        // the bake's fires: each group "fires" says where its own burn (tools/godot/export-scene.mjs)
        int baked = 0;
        foreach (var n in BakedWorld.All(Main.I.World).ToList())
        {
            if (n is not Node3D g || !n.Name.ToString().StartsWith("fires") || !n.HasMeta("extras")) continue;
            var ex = n.GetMeta("extras").AsGodotDictionary();
            if (!ex.ContainsKey("fire")) continue;
            var fire = ex["fire"].AsGodotDictionary();
            var spots = new List<(Vector3, float)>();
            foreach (var s in fire["spots"].AsGodotArray())
            {
                var a = s.AsGodotArray();
                spots.Add((new Vector3(a[0].AsSingle(), a[1].AsSingle(), a[2].AsSingle()), a[3].AsSingle()));
            }
            foreach (var c in g.GetChildren()) if (c is Node3D c3) c3.Visible = false;
            Make(spots, fire.ContainsKey("smoke") ? fire["smoke"].AsInt32() : 10, g);
            baked++;
            Main.I.World.Unported.RemoveAll(u => g.GetChildren().Any(c => c.Name.ToString() == u || $"{g.Name}/{c.Name}" == u));
        }
        GD.Print($"fires: {baked} from the bake, {Info.spots} fires burning" + (fires.Count > 0 ? $", the first at {(fires[0].Root.GetParent<Node3D>().GlobalTransform * firstSpot).Round()}" : ""));
    }

    public override void _ExitTree()
    {
        if (I == this) I = null;
    }

    /// <summary>Fires at these places (world metres; size 1 a tar barrel, 0.6 a brazier, 1.5 a big bonfire), `smoke` points each.</summary>
    public Fire Create(IEnumerable<(Vector3 at, float size)> spots, int smoke = 10)
    {
        var root = new Node3D { Name = "fires_made" };
        Main.I.View.AddChild(root);
        return Make(spots.ToList(), smoke, root);
    }

    private Vector3 firstSpot;

    private Fire Make(List<(Vector3 at, float size)> spots, int smoke, Node3D parent)
    {
        if (fires.Count == 0) firstSpot = spots[0].at;
        int per = Flames + Sparks + smoke;
        int n = spots.Count * per;
        uint sd = 1873;
        float R() => (sd = sd * 1664525u + 1013904223u) / 4294967296f;
        var buf = new float[n * 16];
        int k = 0;
        foreach (var (at, size) in spots)
            for (int i = 0; i < per; i++, k++)
            {
                int o = k * 16;
                buf[o] = 1; buf[o + 3] = at.X; buf[o + 5] = 1; buf[o + 7] = at.Y; buf[o + 10] = 1; buf[o + 11] = at.Z;
                buf[o + 12] = R();
                buf[o + 13] = i < Flames ? 0 : i < Flames + Sparks ? 1 : 2;
                buf[o + 14] = size;
            }
        var quads = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = new QuadMesh { Size = Vector2.One }, InstanceCount = n };
        quads.Buffer = buf;
        // (the points move up to a few metres from their fire: never culled by the fuel's own box)
        var box = new Aabb(spots[0].at, Vector3.Zero);
        foreach (var (at, size) in spots) box = box.Expand(at);
        quads.CustomAabb = box.Grow(5);
        var fire = new Fire { Root = new Node3D { Name = "fire" }, Spots = spots.Count };
        parent.AddChild(fire.Root);
        var flameMat = new ShaderMaterial { Shader = flameShader, RenderPriority = 5 };
        var smokeMat = new ShaderMaterial { Shader = smokeShader, RenderPriority = 4 };
        fire.Mats.Add(flameMat);
        fire.Mats.Add(smokeMat);
        fire.Root.AddChild(new MultiMeshInstance3D { Name = "smoke", Multimesh = quads, MaterialOverride = smokeMat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        fire.Root.AddChild(new MultiMeshInstance3D { Name = "flames", Multimesh = quads, MaterialOverride = flameMat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        // the glow in the air round each fire
        var glowMat = new ShaderMaterial { Shader = glowShader, RenderPriority = 5 };
        fire.Mats.Add(glowMat);
        var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = new QuadMesh { Size = Vector2.One, Material = glowMat }, InstanceCount = spots.Count };
        for (int i = 0; i < spots.Count; i++)
        {
            var (at, size) = spots[i];
            mm.SetInstanceTransform(i, new Transform3D(Basis.Identity, at + new Vector3(0, 0.35f * size, 0)));
            mm.SetInstanceCustomData(i, new Color(2.6f * size, R() * 10, 0, 0));
        }
        fire.Root.AddChild(new MultiMeshInstance3D { Name = "glow", Multimesh = mm, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        fires.Add(fire);
        return fire;
    }
}
