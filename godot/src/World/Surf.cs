using System;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The great storm against the town (the browser's world/alive/gale.ts createSurf and createSplash):
/// - the surf: the seas run at the river's quay walls round Jef and burst up them, a sheet of white water thrown over
///   the edge and blown onto the stones by the wind, with fine spray over it, falling back. Only the open river (25 m
///   of water out from the face), the nearest quay edges within 40 m; every half second to two, more the harder it blows;
/// - the splashes: every drop that lands on open ground round him throws up a little white splash, so the street
///   seems to boil a hand high; none under a roof.
/// The spray and the splashes are the breath's mist (AirPoints.AsMist); the six sheets one shader made at the start.
/// The foam lapping at the walls on any day is the water's own (psx water, the shore map).
/// </summary>
[GamePart(44)]
public partial class Surf : Node
{
    public static Surf? I { get; private set; }

    private const int Spray = 1400, Sheets = 6, Splash = 900;
    private AirPoints spray = null!, splash = null!;
    private readonly Vector3[] sp = new Vector3[Spray], sv = new Vector3[Spray];
    private readonly float[] sAge = new float[Spray], sLife = new float[Spray], sSize = new float[Spray], sFloor = new float[Spray];
    private readonly Vector3[] kp = new Vector3[Splash];
    private readonly float[] kAge = new float[Splash], kLife = new float[Splash], kVy = new float[Splash], kSize = new float[Splash];
    private readonly (MeshInstance3D mesh, ShaderMaterial mat, float t, float life)[] sheets = new (MeshInstance3D, ShaderMaterial, float, float)[Sheets];
    private readonly (float x, float z, float ix, float iz, float top)[] edges = new (float, float, float, float, float)[36];
    private int edgeCount, bursts, spawned;
    private float look, next = 1, carry;
    private uint dice = 1873;
    private float R() => Air.Mulberry(ref dice);

    /// <summary>For a check: the quay edges found, the bursts so far, the spray and the splashes in the air, the sheets up, the last burst (else the first edge).</summary>
    public (int edges, int bursts, int spray, int splashes, int sheets, Vector3 edge0) Info { get; private set; }

    private const string SheetCode = @"
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
global uniform vec4 psx_fog_color;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform float t = 0.0;
uniform float seed = 0.0;
uniform float h = 3.0;
uniform float lean = 0.0;
uniform vec3 tint = vec3(0.8);
varying vec2 uv;
varying float fog_depth;
float sh(float n) { return fract(sin(n) * 43758.5453); }
float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y);
}
void vertex() {
	vec3 p = VERTEX;
	// up the wall and down again; taller in the middle, in ragged jets along it
	float env = 1.0 - pow(abs(p.x) * 2.0, 2.0);
	float rise = sin(3.14159 * clamp(t * 1.3, 0.0, 1.0));
	float c = (p.x + 0.5) * 11.0 + seed * 7.0;
	float jet = mix(sh(floor(c) + seed * 13.1), sh(floor(c) + 1.0 + seed * 13.1), smoothstep(0.0, 1.0, fract(c)));
	float hgt = h * env * rise * (0.55 + 0.45 * jet);
	// the top is thrown over onto the quay by the gale
	vec3 w = vec3(p.x, p.y * hgt, p.y * p.y * lean * hgt * 0.45);
	vec4 mv = MODELVIEW_MATRIX * vec4(w, 1.0);
	fog_depth = -mv.z;
	POSITION = PROJECTION_MATRIX * mv;
	uv = vec2(p.x + 0.5, p.y);
}
void fragment() {
	// white water: streaks running up it, foam churning in it, a ragged top that tears into spray
	float streak = vn(vec2(uv.x * 16.0 + seed * 9.0, uv.y * 2.5 - t * 5.0));
	float foam = vn(vec2(uv.x * 34.0 + seed * 3.0, uv.y * 10.0 - t * 9.0));
	float a = smoothstep(1.0, 0.45, uv.y + (streak - 0.5) * 0.6) * (0.5 + 0.5 * foam);
	a *= smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x);
	a *= 1.0 - smoothstep(0.5, 1.0, t);
	a *= 0.9;
	if (a < 0.03) discard;
	vec3 col = tint * (0.8 + 0.3 * foam);
	float f = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	ALBEDO = mix(col, psx_fog_color.rgb, f * 0.85);
	ALPHA = a * (1.0 - f * 0.5);
}
";

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 60;
        spray = new AirPoints("alive_surf_live", Spray, priority: 4).AsMist(1.8f);
        splash = new AirPoints("alive_splash_live", Splash, priority: 4).AsMist(1.4f);
        Array.Fill(sAge, -1);
        Array.Fill(kAge, -1);
        // the sheets: a plane 1 x 1 in 18 x 8, its foot on the water (gale.ts sheetGeo)
        var plane = new PlaneMesh { Size = Vector2.One, SubdivideWidth = 17, SubdivideDepth = 7, Orientation = PlaneMesh.OrientationEnum.Z, CenterOffset = new Vector3(0, 0.5f, 0) };
        var shader = new Shader { Code = SheetCode };
        for (int i = 0; i < Sheets; i++)
        {
            var m = new ShaderMaterial { Shader = shader, RenderPriority = 4 };
            var mi = new MeshInstance3D { Name = "alive_surf_sheet_live", Mesh = plane, MaterialOverride = m, Visible = false, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Layers = Mirrors.NoMirror, ExtraCullMargin = 12 };
            Main.I.View.AddChild(mi);
            sheets[i] = (mi, m, -1, 2);
        }
        Main.I.World.Unported.RemoveAll(u => u.StartsWith("alive_surf") || u == "alive_splash");
    }

    public override void _ExitTree()
    {
        if (I == this) I = null;
    }

    /// <summary>Dev: a burst at the nearest edge now (gale.ts burstNow).</summary>
    public bool BurstNow()
    {
        if (edgeCount == 0) FindEdges(Main.I.Cam.GlobalPosition);
        if (edgeCount == 0) return false;
        Burst(0, 1);
        return true;
    }

    private void FindEdges(Vector3 eye)
    {
        edgeCount = 0;
        var lights = Lights.I;
        for (int k = 0; k < 36; k++)
        {
            float a = k / 36f * MathF.Tau, dx = MathF.Cos(a), dz = MathF.Sin(a);
            bool land = false;
            for (float d = 1; d < 40; d += 0.7f)
            {
                int fl = Ways.Flags(eye.X + dx * d, eye.Z + dz * d);
                if (fl == Ways.Outside) break;
                if (fl != Ways.Water) { land = true; continue; }
                if (!land) continue;
                // the wall's face: from a step back on the quay, out in 5 cm steps to the water's edge
                float x0 = eye.X + dx * (d - 1.2f), z0 = eye.Z + dz * (d - 1.2f);
                float top = lights?.GroundAt(x0, z0) ?? float.NaN;
                if (!float.IsFinite(top)) break;
                float face = -1;
                for (float s = 0; s < 2.4f; s += 0.05f)
                    if (Water.In(x0 + dx * s, z0 + dz * s)) { face = s; break; }
                // only the open river throws up surf: water at least 25 m out from the face, not a canal
                bool open = face >= 0;
                for (float s = 2; open && s < 25; s += 2) if (Ways.Flags(x0 + dx * (face + s), z0 + dz * (face + s)) != Ways.Water) open = false;
                if (open) edges[edgeCount++] = (x0 + dx * face, z0 + dz * face, -dx, -dz, top);
                break;
            }
        }
    }

    private void Burst(int which, float fury)
    {
        var e = edges[which];
        float wl = Water.Level(e.x - e.ix * 0.8f, e.z - e.iz * 0.8f);
        float top = e.top;
        if (!float.IsFinite(wl) || !float.IsFinite(top)) return;
        float big = (0.5f + 0.5f * R()) * fury;
        int n = (int)MathF.Round(90 + 110 * big);
        // the sheet of white water up the wall's face (a free one, else the oldest)
        int si = 0;
        for (int i = 0; i < Sheets; i++)
        {
            if (sheets[i].t < 0) { si = i; break; }
            if (sheets[i].t > sheets[si].t) si = i;
        }
        var sh = sheets[si];
        float width = 4 + 5 * big + R() * 2;
        sh.mesh.Position = new Vector3(e.x - e.ix * 0.15f, wl - 0.3f, e.z - e.iz * 0.15f);
        sh.mesh.Rotation = new Vector3(0, MathF.Atan2(e.ix, e.iz), 0);
        sh.mesh.Scale = new Vector3(width, 1, 1);
        sh.mat.SetShaderParameter("h", top - wl + 0.3f + 1.2f + 3.8f * big);
        sh.mat.SetShaderParameter("seed", R() * 100);
        var wd = Air.Gusts.Dir;
        sh.mat.SetShaderParameter("lean", Math.Max(0.15f, wd.X * e.ix + wd.Y * e.iz) * (0.6f + 0.6f * fury));
        sh.t = 0;
        sh.life = 1.7f + R() * 0.8f;
        sh.mesh.Visible = true;
        sheets[si] = sh;
        // up the face: fast enough to clear the quay's top by a few metres
        float need = MathF.Sqrt(2 * 9.8f * Math.Max(0.5f, top - wl + 1.5f + 3 * big));
        for (int i = 0; i < Spray && n > 0; i++)
        {
            if (sAge[i] >= 0) continue;
            float along = (R() - 0.5f) * width;
            sp[i] = new Vector3(e.x - e.ix * 0.2f - e.iz * along, wl + 0.2f, e.z - e.iz * 0.2f + e.ix * along);
            float up = need * (0.55f + R() * 0.6f), inl = 0.5f + R() * 2.5f;
            sv[i] = new Vector3(e.ix * inl + (R() - 0.5f) * 1.5f, up, e.iz * inl + (R() - 0.5f) * 1.5f);
            sAge[i] = 0;
            sLife[i] = 1.3f + R() * 1.2f;
            sFloor[i] = wl;
            // fine drops over the sheet (no big puffs: they read as bubbles)
            sSize[i] = 0.15f + R() * 0.4f;
            n--;
        }
        bursts++;
        lastBurst = new Vector3(e.x, top, e.z);
    }
    private Vector3 lastBurst;

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        if (day == null) return;
        float dt = (float)Math.Min(delta, 0.05);
        var eye = Main.I.Cam.GlobalPosition;
        float fury = Air.Fury;
        var fog = day.FogColor;
        float k = 0.55f * (1 - 0.6f * day.Night);
        var tint = new Vector3(fog.R + (0.86f - fog.R) * k, fog.G + (0.88f - fog.G) * k, fog.B + (0.86f - fog.B) * k);
        spray.Param("col", tint);
        if (fury > 0.2f)
        {
            look -= dt;
            if (look <= 0) { look = 1; FindEdges(eye); }
            next -= dt;
            if (next <= 0 && edgeCount > 0)
            {
                next = (0.5f + 1.5f * R()) / fury;
                Burst((int)(R() * edgeCount) % edgeCount, fury);
            }
        }
        int sheetsUp = 0;
        for (int i = 0; i < Sheets; i++)
        {
            var q = sheets[i];
            if (q.t < 0) continue;
            q.t += dt / q.life;
            if (q.t >= 1) { q.t = -1; q.mesh.Visible = false; }
            else
            {
                Render.UniformUpdates.Material(q.mat, "t", q.t);
                Render.UniformUpdates.Material(q.mat, "tint", tint);
                sheetsUp++;
            }
            sheets[i] = q;
        }
        var lights = Lights.I;
        int live = 0;
        for (int i = 0; i < Spray; i++)
        {
            if (sAge[i] >= 0)
            {
                sAge[i] += dt / sLife[i];
                // thrown up, slowed by the air, carried onto the quay by the gale, down again
                var w = Air.WindAt(sp[i].X, sp[i].Z);
                var v = sv[i];
                v.X += (w.X * 0.35f - v.X) * Math.Min(1, dt * 0.9f);
                v.Z += (w.Y * 0.35f - v.Z) * Math.Min(1, dt * 0.9f);
                v.Y -= 9.8f * dt;
                sv[i] = v;
                sp[i] += v * dt;
                float gy = Ways.Flags(sp[i].X, sp[i].Z) == Ways.Water ? sFloor[i] : lights?.GroundAt(sp[i].X, sp[i].Z) ?? float.NaN;
                if (sAge[i] >= 1 || (v.Y < 0 && float.IsFinite(gy) && sp[i].Y < gy)) sAge[i] = -1;
                else live++;
            }
            spray.Mist(i, sp[i], sAge[i], sSize[i]);
        }
        spray.Commit();
        int splashes = Splashes(day, eye, dt, lights);
        Info = (edgeCount, bursts, live, splashes, sheetsUp, bursts > 0 ? lastBurst : edgeCount > 0 ? new Vector3(edges[0].x, edges[0].top, edges[0].z) : Vector3.Zero);
    }

    private int Splashes(Daylight day, Vector3 eye, float dt, Lights? lights)
    {
        bool indoors = Rooms.I?.Around(eye) != null;
        float fury = indoors ? 0 : Air.Fury * day.Rain;
        float k = 0.4f * (1 - 0.7f * day.Night);
        var fog = day.FogColor;
        splash.Param("col", new Vector3(fog.R + (0.8f - fog.R) * k, fog.G + (0.83f - fog.G) * k, fog.B + (0.84f - fog.B) * k));
        carry += 1400 * fury * dt;
        int live = 0;
        for (int i = 0; i < Splash; i++)
        {
            if (kAge[i] < 0 && carry >= 1)
            {
                // a drop lands somewhere round him, on open ground (a disc 1.5 to 14 m out, more near)
                float a = R() * MathF.Tau, r = 1.5f + MathF.Pow(R(), 0.7f) * 12.5f;
                float x = eye.X + MathF.Cos(a) * r, z = eye.Z + MathF.Sin(a) * r;
                if (Ways.Flags(x, z) == 0 && lights != null)
                {
                    float y = lights.GroundAt(x, z);
                    if (float.IsFinite(y))
                    {
                        kp[i] = new Vector3(x, y + 0.03f, z);
                        kAge[i] = 0;
                        kLife[i] = 0.25f + R() * 0.3f;
                        kVy[i] = 0.5f + R() * 0.9f;
                        kSize[i] = 0.25f + R() * 0.35f;
                        spawned++;
                    }
                }
                carry -= 1;
            }
            if (kAge[i] >= 0)
            {
                kAge[i] += dt / kLife[i];
                kp[i].Y += kVy[i] * dt;
                kVy[i] -= 4 * dt;
                if (kAge[i] >= 1) kAge[i] = -1;
                else live++;
            }
            splash.Mist(i, kp[i], kAge[i], kSize[i]);
        }
        carry = Math.Min(carry, 50);
        splash.Commit();
        return live;
    }
}
