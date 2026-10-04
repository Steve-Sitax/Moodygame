using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Render;
using Scheldemist.Town;

namespace Scheldemist.World;

/// <summary>
/// The lights past the nearest 48 (the browser's world/spill.ts ground pools and world/farGlow.ts):
/// - a pool of light on the ground for each lit source past the per-pixel ones whose light reaches the street, the
///   same light as the per-pixel one on flat ground of the town's colour at night, one MultiMesh (its sources' numbers
///   in a small picture, as Psx.SetSpill does);
/// - a far glow for every lantern, "glow" thing and lit room or hall past half the fog's end: a soft round glow with
///   a bright core, coming in by 0.9 fog-fars and fading with the fog as the gas lamps' halos do, out at 3 fog-fars
///   (260 m at most); the nearest 256.
/// </summary>
public partial class Lights
{
    private const int MaxPools = 512, MaxFar = 256;
    private const float FarReach = 3, FarMax = 260, PoolAlbedo = 0.07f;
    private readonly List<Src> poolList = new();
    private readonly List<(Src s, float size, float gain)> farList = new();
    private readonly List<(Src s, float d, float size, float gain, int order)> farCandidates = new();
    private readonly Dictionary<Src, float> groundOf = new();
    private MultiMesh? poolMM, farMM;
    private Image? poolImage;
    private ImageTexture? poolTex;
    private readonly float[] poolData = new float[MaxPools * 4 * 4];
    private float[] farBuf = Array.Empty<float>();
    private readonly byte[] poolBytes = new byte[MaxPools * 4 * 4 * 4];
    private WalkMap? walk;
    private bool walkTried;
    private readonly bool farOff = Main.I.Flag("no-far-lights");

    /// <summary>Counts for a check: the ground pools and the far glows drawn now.</summary>
    public (int pools, int far) FarInfo => (poolMM?.VisibleInstanceCount ?? 0, farMM?.VisibleInstanceCount ?? 0);

    private const string PoolCode = @"
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform sampler2D pools : filter_nearest, repeat_disable;
uniform float albedo = 0.07;
varying vec4 pool_a;
varying vec4 pool_b;
varying vec4 pool_c;
varying vec4 pool_d;
varying vec3 pool_p;
varying vec2 pool_q;
varying float fog_depth;
SPILL
void vertex() {
	int i = INSTANCE_ID;
	pool_a = texelFetch(pools, ivec2(i, 0), 0);
	pool_b = texelFetch(pools, ivec2(i, 1), 0);
	pool_c = texelFetch(pools, ivec2(i, 2), 0);
	pool_d = texelFetch(pools, ivec2(i, 3), 0);
	pool_q = UV * 2.0 - 1.0;
	vec4 wp = MODEL_MATRIX * vec4(VERTEX, 1.0);
	// lit as the ground it stands for, laid a little over it
	pool_p = wp.xyz;
	vec4 mv = VIEW_MATRIX * wp;
	fog_depth = -mv.z;
	mv.xyz *= 0.999;
	POSITION = PROJECTION_MATRIX * mv;
}
void fragment() {
	vec3 pool_e = spill_one(pool_p, vec3(0.0, 1.0, 0.0), pool_a, pool_b, pool_c, pool_d);
	// (no edge where the quad ends: the light is let go before it)
	float edge = (1.0 - smoothstep(0.7, 1.0, abs(pool_q.x))) * (1.0 - smoothstep(0.75, 1.0, abs(pool_q.y)));
	if (dot(pool_b.xy, pool_b.xy) < 0.01) edge = 1.0 - smoothstep(0.7, 1.0, length(pool_q));
	float fog = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	ALBEDO = pool_e * edge * albedo * 0.3183 * (1.0 - fog);
}
";

    private const string FarCode = @"
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform float reach = 3.0;
uniform float far_max = 260.0;
varying vec3 col;
void vertex() {
	// a disc facing the eye, a little in front of the glass (the fogged glass never cuts a dark shape out of it);
	// INSTANCE_CUSTOM: x how lit, y how big (m)
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	c += normalize(-c) * 0.45;
	float d = length(c);
	float view = min(far_max, psx_fog_far * reach);
	float k = smoothstep(psx_fog_far * 0.5, psx_fog_far * 0.9, d) * (1.0 - 0.8 * smoothstep(psx_fog_near, psx_fog_far * 1.4, d)) * (1.0 - smoothstep(view * 0.75, view, d));
	col = COLOR.rgb * INSTANCE_CUSTOM.x * k;
	// (never under two pixels across)
	float size = max(INSTANCE_CUSTOM.y, 0.005 * d);
	POSITION = PROJECTION_MATRIX * vec4(c + vec3(VERTEX.xy * size, 0.0), 1.0);
	if (INSTANCE_CUSTOM.x * k < 0.004) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
}
void fragment() {
	// a soft round glow with a small bright core
	float r = length(UV - 0.5) * 2.0;
	float a = pow(max(0.0, 1.0 - r), 2.2) * 0.8 + 0.35 * smoothstep(0.35, 0.0, r);
	ALBEDO = col * a;
}
";

    private void BuildFar()
    {
        poolImage = Image.CreateEmpty(MaxPools, 4, false, Image.Format.Rgbaf);
        poolTex = ImageTexture.CreateFromImage(poolImage);
        var poolMat = new ShaderMaterial { Shader = new Shader { Code = PoolCode.Replace("SPILL", Psx.SpillGlsl) }, RenderPriority = 2 };
        poolMat.SetShaderParameter("pools", poolTex);
        poolMat.SetShaderParameter("albedo", PoolAlbedo);
        poolMM = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = new PlaneMesh { Size = new Vector2(2, 2), Material = poolMat }, InstanceCount = MaxPools, VisibleInstanceCount = 0 };
        poolMM.CustomAabb = new Aabb(new Vector3(-2000, -50, -2000), new Vector3(4000, 200, 4000));
        Main.I.View.AddChild(new MultiMeshInstance3D { Name = "spill_ground_pools", Multimesh = poolMM, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        var farMat = new ShaderMaterial { Shader = new Shader { Code = FarCode }, RenderPriority = 3 };
        farMat.SetShaderParameter("reach", FarReach);
        farMat.SetShaderParameter("far_max", FarMax);
        farMM = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, UseCustomData = true, Mesh = new QuadMesh { Size = Vector2.One, Material = farMat }, InstanceCount = MaxFar, VisibleInstanceCount = 0 };
        farMM.CustomAabb = new Aabb(new Vector3(-2000, -50, -2000), new Vector3(4000, 200, 4000));
        farBuf = new float[MaxFar * 20];
        Main.I.View.AddChild(new MultiMeshInstance3D { Name = "far_glow", Multimesh = farMM, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        // (the walk map's ground, for the pools: read now, while the town loads, not at the first dusk)
        Ground(new Src { At = new Vector3(0, 100, 0) });
        groundOf.Clear();
        Main.I.World.Unported.RemoveAll(u => u is "far_glow" or "gas_lamp_halos" or "ambient_windows" || (u.StartsWith("INST") && u.EndsWith("spillgroundpools")));
    }

    /// <summary>Which sources get a far glow, how big (m across) and how bright (1 = a gas lamp's halo): farGlow.ts farKind.</summary>
    private static (float size, float gain)? FarKind(Src s)
    {
        if (s.Kind == "lantern") return s.Label == "Jef's lantern" ? null : (1.4f, 0.6f);
        if (s.Kind == "glow") return (Math.Min(2.2f, 0.9f + s.Half.X * 1.2f), 0.55f);
        if (s.Kind is "lamp" or "doss") return null;
        if (s.Sched != null) return null;
        return (Math.Min(2.4f, 0.8f + Math.Max(s.Half.X, s.Half.Y) * 1.4f), s.Kind is "garret" or "upper" ? 0.2f : 0.3f);
    }

    /// <summary>The street under a source, a step out from its wall (the walk map's ground), worked out once.</summary>
    private float Ground(Src s)
    {
        if (groundOf.TryGetValue(s, out var g)) return g;
        if (!walkTried)
        {
            walkTried = true;
            {
                string town = Main.I.Arg("town", OS.GetEnvironment("SCHELDEMIST_BAKE") is { Length: > 0 } b ? b : ProjectSettings.GlobalizePath("res://baked/town.glb"));
                walk = WalkMap.Load(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(town) ?? ".", System.IO.Path.GetFileNameWithoutExtension(town) + "_walk.json"));
            }
        }
        float x = s.At.X + s.N.X * 1.2f, z = s.At.Z + s.N.Y * 1.2f;
        g = walk != null ? (float)walk.BaseAt(x, z) : 0;
        // (a source below the walk's ground there, a cellar's or the water's: no pool)
        if (g > s.At.Y + 0.2f) g = float.NaN;
        groundOf[s] = g;
        return g;
    }

    /// <summary>At each ranking: the pools (the ranked past the per-pixel ones) and the far glows (the nearest lit far ones).</summary>
    private void RankRest(bool ranking, Vector3 eye, Daylight day)
    {
        if (!ranking) return;
        poolList.Clear();
        for (int i = Psx.MaxSpill; i < ranked.Count && poolList.Count < MaxPools; i++)
        {
            var s = ranked[i];
            float g = Ground(s);
            if (float.IsNaN(g) || s.At.Y - g > s.Range * 0.8f) continue;
            poolList.Add(s);
        }
        farList.Clear();
        float view = Math.Min(FarMax, day.FogFar * FarReach);
        farCandidates.Clear();
        foreach (var s in sources)
        {
            if (FarKind(s) is not { } k) continue;
            float d = s.At.DistanceTo(eye);
            if (d > view || d < day.FogFar * 0.4f) continue;
            if (Now(s) < 0.02f * s.Power) continue;
            farCandidates.Add((s, d, k.size, k.gain, farCandidates.Count));
        }
        farCandidates.Sort((a, b) => { int d = a.d.CompareTo(b.d); return d != 0 ? d : a.order.CompareTo(b.order); });
        for (int i = 0; i < Math.Min(farCandidates.Count, MaxFar); i++) { var c = farCandidates[i]; farList.Add((c.s, c.size, c.gain)); }
        if (compareSelections && !farCandidates.OrderBy(c => c.order).OrderBy(c => c.d).Take(MaxFar).Select(c => (c.s, c.size, c.gain)).SequenceEqual(farList))
            throw new InvalidOperationException("far glow selection differs from original");
    }

    private void UpdateFar(Vector3 eye, Daylight day)
    {
        using var frameCost = Dev.FrameCost.Track("Lights.Far");
        if (farOff) { if (poolMM != null) poolMM.VisibleInstanceCount = 0; if (farMM != null) farMM.VisibleInstanceCount = 0; return; }
        if (poolMM == null || farMM == null || poolImage == null || poolTex == null) return;
        // the pools: each a quad on the ground, out from its wall, as big as its light reaches
        int n = 0;
        foreach (var s in poolList)
        {
            float g = groundOf[s];
            float r = s.Range;
            bool wall = s.N.LengthSquared() > 0.01f;
            var mid = wall ? new Vector3(s.At.X + s.N.X * r * 0.5f, g + 0.02f, s.At.Z + s.N.Y * r * 0.5f) : new Vector3(s.At.X, g + 0.02f, s.At.Z);
            float half = wall ? r * 0.55f : r * 0.8f;
            var basis = wall ? new Basis(new Vector3(-s.N.Y, 0, s.N.X) * half, Vector3.Up, new Vector3(s.N.X, 0, s.N.Y) * half) : Basis.Identity.Scaled(new Vector3(half, 1, half));
            poolMM.SetInstanceTransform(n, new Transform3D(basis, mid));
            Put(n, 0, new Vector4(s.At.X, s.At.Y, s.At.Z, s.Now));
            Put(n, 1, new Vector4(s.N.X, s.N.Y, s.Half.X, s.Half.Y));
            Put(n, 2, new Vector4(s.Color.X, s.Color.Y, s.Color.Z, s.Bars));
            Put(n, 3, new Vector4(s.Range, s.Decay, s.Depth, s.Soft));
            n++;
        }
        poolMM.VisibleInstanceCount = n;
        if (n > 0)
        {
            var bytes = UniformUpdates.Cached ? poolBytes : new byte[poolData.Length * 4];
            Buffer.BlockCopy(poolData, 0, bytes, 0, bytes.Length);
            poolImage.SetData(MaxPools, 4, false, Image.Format.Rgbaf, bytes);
            poolTex.Update(poolImage);
        }
        // the far glows: the colour at a gas lamp halo's brightness (its hue, the brightest channel at 1)
        int f = 0;
        foreach (var (s, size, gain) in farList)
        {
            int o = f * 20;
            farBuf[o] = 1; farBuf[o + 1] = 0; farBuf[o + 2] = 0; farBuf[o + 3] = s.At.X;
            farBuf[o + 4] = 0; farBuf[o + 5] = 1; farBuf[o + 6] = 0; farBuf[o + 7] = s.At.Y;
            farBuf[o + 8] = 0; farBuf[o + 9] = 0; farBuf[o + 10] = 1; farBuf[o + 11] = s.At.Z;
            float m = Math.Max(Math.Max(s.Color.X, s.Color.Y), Math.Max(s.Color.Z, 1e-3f));
            farBuf[o + 12] = s.Color.X / m; farBuf[o + 13] = s.Color.Y / m; farBuf[o + 14] = s.Color.Z / m; farBuf[o + 15] = 1;
            farBuf[o + 16] = Math.Min(1, s.Now / Math.Max(s.Power, 1e-3f)) * gain; farBuf[o + 17] = size; farBuf[o + 18] = 0; farBuf[o + 19] = 0;
            f++;
        }
        if (f > 0 || farMM.VisibleInstanceCount > 0)
        {
            farMM.Buffer = farBuf;
            farMM.VisibleInstanceCount = f;
        }
    }

    private void Put(int i, int row, Vector4 v)
    {
        int o = (row * MaxPools + i) * 4;
        poolData[o] = v.X;
        poolData[o + 1] = v.Y;
        poolData[o + 2] = v.Z;
        poolData[o + 3] = v.W;
    }
}
