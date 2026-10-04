using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The lights of the night (the browser's world/gaslamps.ts, spill.ts, ambient.ts windows, landmarkWindows.ts):
/// - the gas lamps burn by the clock (and by day in thick fog): their glass, a halo, their glow in the air and their
///   streaks on wet stone (the six psx lamp slots go to the lit lamps nearest the eye), their light on the street;
/// - the painted windows glow by their households' hours, and throw their light on the street;
/// - the rooms' windows and doors, the lanterns and the landmarks' windows glow after dark.
/// No Godot light is made: the nearest 48 sources are worked out per pixel in every lit psx material (Psx.SetSpill),
/// so the number of lights never changes (docs/rendering.md). The sources and the panes come from the bake
/// (tools/godot/export-scene.mjs --ref-only --lights --hour 21: town_lights.json).
/// Past the nearest 48: the ones that light the ground light it as a pool (spill.ts ground pools), and every lantern,
/// glow and lit room past half the fog shows a far glow (farGlow.ts), as the gas lamps' halos do (Lights.Far.cs).
/// The lamplighter's word lights or puts out one lamp (SetLampLit: game/lamplighter.ts, the server's lampround.ts; on a
/// day of thick fog it leaves them lit, and a lit lamp then glows in the grey); a lamp nobody has set follows the clock.
/// </summary>
[GamePart(30)]
public partial class Lights : Node
{
    public static Lights I { get; private set; } = null!;

    private sealed class Src
    {
        public string Kind = "", Label = "";
        public Vector3 At;
        public Vector2 N, Half;
        public Vector3 Color;
        public float Power, Range, Decay, Depth, Soft, Bars, Level;
        public float[]? Sched;
        // a gas lamp: its flame's own flicker, its id ("q3" a quay lamp, "d12" a city lamp), the lamplighter's word
        // (1 burns, 0 out) and how far the gas has caught
        public bool Lamp;
        public string Id = "";
        public float Seed, B, G, Want = 1, Lit = 1;
        // now: power x level; its weight among the per-pixel ones; its rank
        public float Now, W, Score;
    }

    private readonly List<Src> sources = new();
    private readonly List<Src> lamps = new();
    private readonly List<Src> ranked = new();
    private readonly Src?[] slots = new Src?[Psx.MaxSpill];
    private readonly (Src? lamp, float w)[] lampSlots = new (Src?, float)[Psx.MaxLamps - 1];
    private readonly List<(ShaderMaterial m, Src? lamp)> glass = new();
    private readonly Dictionary<string, Src> byId = new();
    private MultiMesh? haloMM;
    private readonly List<(ShaderMaterial m, Vector3 tint, Vector3 centre, float radius)> landmark = new();
    private ShaderMaterial? paneMat, haloMat;
    private MeshInstance3D? panes;
    private float t, rankT, glassV = -1;
    private Color glassFog;
    private bool snap = true;
    /// <summary>Jef's lantern takes the last psx lamp slot (game/lantern.ts): flame and brightness, or null.</summary>
    public Vector4? Lantern { get; set; }
    /// <summary>Counts for a check: the sources, the lit ones in view, the ones worked out per pixel.</summary>
    public (int sources, int lit, int pixel, int lamps, int panes) Info { get; private set; }

    private const float Fade = 2.2f, Power = 26;

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 40; // after the daylight
        Daylight.I.Settled += () => snap = true;
        string? file = new[] { Paths.TownSide("_lights.json"), Path.Combine(Paths.Baked, "town_lights.json") }.FirstOrDefault(File.Exists);
        int paneCount = 0;
        if (file != null)
        {
            var j = JsonDocument.Parse(File.ReadAllText(file)).RootElement;
            foreach (var e in j.GetProperty("spill").EnumerateArray()) sources.Add(Read(e));
            paneCount = BuildPanes(j.GetProperty("panes"));
        }
        else GD.Print("lights: no " + Paths.TownSide("_lights.json") + " beside the bake: no lamps or lit windows (node tools/godot/export-scene.mjs --ref-only --lights --hour 21)");
        // the doss house lantern (rijnkaai.ts): a real light in the browser, always burning
        sources.Add(new Src { Kind = "doss", Label = "doss house lantern", At = new Vector3(-180.96f, 2.9f, 39.5f), Half = new Vector2(0.1f, 0.1f), Color = V(Psx.Hex(0xffa048)), Power = 7, Range = 10, Decay = 1.7f, Level = 1 });
        lamps.AddRange(sources.Where(s => s.Lamp));
        foreach (var l in lamps) byId[l.Id] = l;
        BuildHalos();
        BuildFar();
        FindGlass();
        Info = (sources.Count, 0, 0, lamps.Count, paneCount);
        GD.Print($"lights: {sources.Count} sources ({lamps.Count} gas lamps), {paneCount} lit panes, {glass.Count} lamp glasses, {landmark.Count} landmark window lights");
    }

    /// <summary>
    /// The lamplighter's word (the browser's gasLamps.set): lamp `id` ("q3" a quay lamp, "d12" a city lamp) burns or
    /// not; the gas catches or goes out in about half a second. A lamp nobody has set follows the clock.
    /// </summary>
    public void SetLampLit(string id, bool on)
    {
        if (byId.TryGetValue(id, out var l)) l.Want = on ? 1 : 0;
    }

    /// <summary>The gas lamps by id and where they stand (the lamplighter's round).</summary>
    public IEnumerable<(string id, Vector3 at)> Lamps => lamps.Select(l => (l.Id, l.At));

    private static Vector3 V(Color c) => new(c.R, c.G, c.B);

    private static Src Read(JsonElement e)
    {
        float F(string k) => e.GetProperty(k).GetSingle();
        var at = e.GetProperty("at");
        var n = e.GetProperty("n");
        var half = e.GetProperty("half");
        var c = e.GetProperty("color");
        var s = new Src
        {
            Kind = e.GetProperty("kind").GetString() ?? "", Label = e.GetProperty("label").GetString() ?? "",
            At = new Vector3(at[0].GetSingle(), at[1].GetSingle(), at[2].GetSingle()), N = new Vector2(n[0].GetSingle(), n[1].GetSingle()),
            Half = new Vector2(half[0].GetSingle(), half[1].GetSingle()), Color = new Vector3(c[0].GetSingle(), c[1].GetSingle(), c[2].GetSingle()),
            Power = F("power"), Range = F("range"), Decay = F("decay"), Depth = F("depth"), Soft = F("soft"), Bars = F("bars"), Level = F("level"),
        };
        if (e.GetProperty("sched").ValueKind == JsonValueKind.Array) s.Sched = e.GetProperty("sched").EnumerateArray().Select(x => x.GetSingle()).ToArray();
        if (s.Kind == "lamp" && s.Label.StartsWith("gas lamp "))
        {
            // the flame's own dice, as gaslamps.ts gives them: a quay lamp q<i>, a city lamp d<i>
            s.Lamp = true;
            string id = s.Label[9..];
            s.Id = id;
            int.TryParse(id[1..], out int i);
            s.Seed = id[0] == 'q' ? i * 1.37f + 0.5f : i * 2.31f + 7.1f;
        }
        return s;
    }

    // ------------------------------------------------------------------ the painted windows' panes (ambient.ts)

    private const string PaneCode = @"
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
global uniform vec2 psx_snap_res;
global uniform float psx_time;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
uniform float hour_n = 12.0;
uniform float night = 0.0;
varying float lit;
varying vec2 tone;
varying float fog_depth;
void vertex() {
	// the household's hours (from noon: 25 = 1:00 at night): the evening's and the early morning's
	vec4 l = CUSTOM0;
	float eve = smoothstep(l.x, l.x + 0.12, hour_n) * (1.0 - smoothstep(l.y, l.y + 0.12, hour_n));
	float morn = smoothstep(l.z, l.z + 0.12, hour_n) * (1.0 - smoothstep(l.w, l.w + 0.12, hour_n));
	lit = max(eve, morn) * night;
	tone = UV2;
	vec4 view = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	fog_depth = -view.z;
	POSITION = PROJECTION_MATRIX * view;
	if (psx_snap_res.x < 5e4) {
		vec2 ndc = POSITION.xy / POSITION.w;
		vec2 snapped = floor(ndc * psx_snap_res + 0.5) / psx_snap_res;
		POSITION.xy = mix(ndc, snapped, smoothstep(1.5, 4.0, POSITION.w)) * POSITION.w;
	}
	if (lit < 0.004) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
}
void fragment() {
	// oil lamp and candle: orange to yellow, some rooms dimmer
	vec3 warm = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.5, 0.14), tone.x) * (0.42 + 0.35 * fract(tone.x * 7.3));
	// brighter low in the pane (the lamp on the table), a curtain edge up top
	warm *= 0.75 + 0.45 * (1.0 - UV.y);
	warm *= 1.0 - 0.35 * smoothstep(0.78, 0.9, UV.y) * step(0.5, fract(tone.x * 3.1));
	// curtains drawn to the sides in most rooms (not the shops), their folds in the light
	float cw = 0.16 + 0.1 * fract(tone.x * 11.3);
	float side = max(step(UV.x, cw), step(1.0 - cw, UV.x));
	float folds = 0.55 + 0.25 * sin(UV.x * 60.0 + tone.x * 9.0);
	float shop_front = step(0.5, tone.y) * step(tone.y, 1.5);
	warm *= mix(1.0, folds * 0.8, side * step(0.35, fract(tone.x * 5.7)) * (1.0 - shop_front));
	// glazing bars: a mullion and two transoms
	float bars = step(abs(UV.x - 0.5), 0.04);
	bars = max(bars, step(abs(UV.y - 0.333), 0.025) + step(abs(UV.y - 0.667), 0.025));
	warm *= 1.0 - 0.7 * min(bars, 1.0);
	warm *= 0.94 + 0.06 * sin(psx_time * 3.1 + tone.x * 40.0) * sin(psx_time * 7.7 + tone.x * 13.0);
	// by the kind of room: a shop or front room downstairs, upstairs, a garret's candle, a lantern
	warm *= tone.y > 3.5 ? 0.75 : tone.y > 2.5 ? 1.0 : tone.y > 1.5 ? 0.6 : tone.y > 0.5 ? 1.15 : 0.9;
	float f = smoothstep(psx_fog_near, psx_fog_far, fog_depth);
	// a faint warm glow stays in the fog: lamplight carries further than the walls show
	ALBEDO = warm * lit * (1.0 - f * 0.82) * 1.25;
}
";

    /// <summary>All the panes as one mesh: three corners each (0, 1 and 3), the hours, the tone and the kind.</summary>
    private int BuildPanes(JsonElement list)
    {
        int n = list.GetArrayLength();
        if (n == 0) return 0;
        var pos = new Vector3[n * 4];
        var uv = new Vector2[n * 4];
        var uv2 = new Vector2[n * 4];
        var lit = new float[n * 16];
        var idx = new int[n * 6];
        int i = 0;
        foreach (var p in list.EnumerateArray())
        {
            float F(int k) => p[k].GetSingle();
            Vector3 a = new(F(0), F(1), F(2)), b = new(F(3), F(4), F(5)), d = new(F(6), F(7), F(8));
            pos[i * 4] = a;
            pos[i * 4 + 1] = b;
            pos[i * 4 + 2] = b + (d - a);
            pos[i * 4 + 3] = d;
            uv[i * 4] = new Vector2(0, 0);
            uv[i * 4 + 1] = new Vector2(1, 0);
            uv[i * 4 + 2] = new Vector2(1, 1);
            uv[i * 4 + 3] = new Vector2(0, 1);
            for (int k = 0; k < 4; k++)
            {
                uv2[i * 4 + k] = new Vector2(F(13), F(14));
                for (int q = 0; q < 4; q++) lit[(i * 4 + k) * 4 + q] = F(9 + q);
            }
            int[] tri = { 0, 1, 2, 0, 2, 3 };
            for (int k = 0; k < 6; k++) idx[i * 6 + k] = i * 4 + tri[k];
            i++;
        }
        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = pos;
        arrays[(int)Mesh.ArrayType.TexUV] = uv;
        arrays[(int)Mesh.ArrayType.TexUV2] = uv2;
        arrays[(int)Mesh.ArrayType.Custom0] = lit;
        arrays[(int)Mesh.ArrayType.Index] = idx;
        var mesh = new ArrayMesh();
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, (Mesh.ArrayFormat)((long)Mesh.ArrayCustomFormat.RgbaFloat << (int)Mesh.ArrayFormat.FormatCustom0Shift));
        paneMat = new ShaderMaterial { Shader = new Shader { Code = PaneCode } };
        mesh.SurfaceSetMaterial(0, paneMat);
        panes = new MeshInstance3D { Name = "lit_windows", Mesh = mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Visible = false };
        Main.I.View.AddChild(panes);
        return n;
    }

    // ------------------------------------------------------------------ the gas lamps' halos and glass (gaslamps.ts)

    private const string HaloCode = @"
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled;
global uniform float psx_fog_near;
global uniform float psx_fog_far;
varying float fog_depth;
varying float lit;
void vertex() {
	// each lamp's own: how lit it is now (INSTANCE_CUSTOM.x)
	lit = INSTANCE_CUSTOM.x;
	// a halo about 1.1 m across that faces the eye, a little in front of the glass (the fogged glass never cuts a
	// dark lamp shape out of its own glow)
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	c += normalize(-c) * 0.45;
	fog_depth = -c.z;
	POSITION = PROJECTION_MATRIX * vec4(c + vec3(VERTEX.xy * 1.1, 0.0), 1.0);
	if (lit < 0.01) POSITION = vec4(2.0, 2.0, 2.0, 1.0);
}
void fragment() {
	float r = clamp(length(UV - 0.5) * 2.0, 0.0, 1.0);
	// (the browser's halo picture: a soft round gradient)
	vec4 a = vec4(1.0, 0.745, 0.431, 0.95), b = vec4(1.0, 0.588, 0.275, 0.4), c = vec4(1.0, 0.471, 0.157, 0.0);
	vec4 tx = r < 0.35 ? mix(a, b, r / 0.35) : mix(b, c, (r - 0.35) / 0.65);
	float fog = smoothstep(psx_fog_near, psx_fog_far * 1.4, fog_depth);
	ALBEDO = tx.rgb * tx.a * lit * 0.6 * (1.0 - fog * 0.8);
}
";

    private void BuildHalos()
    {
        if (lamps.Count == 0) return;
        haloMat = new ShaderMaterial { Shader = new Shader { Code = HaloCode } };
        var quad = new QuadMesh { Size = Vector2.One, Material = haloMat };
        var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = quad, InstanceCount = lamps.Count };
        for (int i = 0; i < lamps.Count; i++)
        {
            mm.SetInstanceTransform(i, new Transform3D(Basis.Identity, lamps[i].At));
            mm.SetInstanceCustomData(i, new Color(1, 0, 0, 0));
        }
        haloMM = mm;
        Main.I.View.AddChild(new MultiMeshInstance3D { Name = "gas_lamp_halos_mm", Multimesh = mm, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
    }

    /// <summary>The lamps' glass (one material a lamp, named "glass", unlit) and the landmarks' window lights.</summary>
    private void FindGlass()
    {
        var seen = new HashSet<Material>();
        foreach (var n in BakedWorld.All(Main.I.World))
        {
            if (n is not MeshInstance3D mi || mi.Mesh == null) continue;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                if (mi.Mesh.SurfaceGetMaterial(s) is not ShaderMaterial m || !seen.Add(m)) continue;
                string name = m.ResourceName;
                if (name == "landmark_window_light")
                {
                    var box = mi.GlobalTransform * mi.GetAabb();
                    // (the atlases carry their own colours; plain glass pictures lamplight: landmarkWindows.ts)
                    bool plain = mi.Name.ToString().Contains("glass");
                    landmark.Add((m, plain ? new Vector3(1.7f, 0.72f, 0.2f) : Vector3.One, box.GetCenter(), box.Size.Length() * 0.5f));
                }
                else if ((name == "glass" || name.EndsWith("_glow")) && m.Shader.Code.Contains("unshaded"))
                {
                    // (its lamp: the nearest within a metre and a half, else it follows the clock)
                    var at = (mi.GlobalTransform * mi.GetAabb()).GetCenter();
                    var lamp = lamps.Where(l => new Vector2(l.At.X - at.X, l.At.Z - at.Z).Length() < 1.5f).OrderBy(l => l.At.DistanceTo(at)).FirstOrDefault();
                    glass.Add((m, lamp));
                }
            }
        }
    }

    /// <summary>Gas flame: slow breathing, small fast noise, now and then a dip (gaslamps.ts flicker).</summary>
    private static float Flicker(float t, float seed)
    {
        float v = 0.9f + MathF.Sin(t * 1.3f + seed * 2.1f) * 0.04f + MathF.Sin(t * 7.7f + seed * 5.3f) * 0.03f + MathF.Sin(t * 17.3f + seed * 1.7f) * 0.02f;
        if (MathF.Sin(t * 0.61f + seed * 3.3f) * MathF.Sin(t * 2.3f + seed) > 0.93f) v *= 0.6f;
        return v;
    }

    private static float Smooth(float x, float a, float b)
    {
        float k = Mathf.Clamp((x - a) / (b - a), 0, 1);
        return k * k * (3 - 2 * k);
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        var cam = Main.I.View.GetCamera3D();
        if (day == null || cam == null) return;
        float dt = (float)delta;
        t += dt;
        float dark = day.LampsLit, air = day.Air, night = day.Night;
        float hourN = day.Hour < 12 ? day.Hour + 24 : day.Hour;
        var eye = cam.GlobalPosition;
        var look = -cam.GlobalTransform.Basis.Z;
        var fog = day.FogColor;

        // --- the gas lamps: by day a lit lamp shows in thick air (its glow), and lights the ground a little
        float glow = Math.Max(dark, 0.8f * air);
        float ground = glow > 0 ? Math.Max(dark, 0.3f * air) / glow : 0;
        float v = Mathf.Clamp(glow, 0, 1);
        // (the gas catches in about half a second)
        float catchK = snap ? 1 : Math.Min(1, dt * 2.5f);
        bool moved = false;
        for (int i = 0; i < lamps.Count; i++)
        {
            var l = lamps[i];
            float was = l.Lit;
            l.Lit += (l.Want - l.Lit) * catchK;
            float lv = Mathf.Clamp(l.Lit * v, 0, 1);
            l.B = lv * Flicker(t, l.Seed);
            l.G = l.B * ground;
            if (MathF.Abs(was - l.Lit) > 0.0005f) moved = true;
            if (haloMM != null && (moved || snap || MathF.Abs(v - glassV) > 0.002f)) haloMM.SetInstanceCustomData(i, new Color(lv, 0, 0, 0));
        }
        // unlit glass takes the colour of the air round it, a little darker, so it never shows as a black box
        if (moved || MathF.Abs(v - glassV) > 0.002f || !fog.IsEqualApprox(glassFog))
        {
            glassV = v;
            glassFog = fog;
            foreach (var (m, lamp) in glass)
            {
                float gv = lamp == null ? v : Mathf.Clamp(lamp.Lit * v, 0, 1);
                m.SetShaderParameter("albedo", new Color(fog.R * 0.8f * (1 - gv) + 1.0f * gv, fog.G * 0.8f * (1 - gv) + 0.72f * gv, fog.B * 0.8f * (1 - gv) + 0.38f * gv));
                m.SetShaderParameter("fog_reach", 1 + 0.6f * gv);
            }
        }
        // the psx lamp slots (the glow in the fog, the streaks on wet stone): the lit lamps nearest the eye
        var near = lamps.Where(l => l.B >= 0.01f)
            .Select(l => (l, d: l.At.DistanceTo(eye) * (Ahead(l.At, eye, look) > -0.3f ? 1 : 1.4f) - (Array.Exists(lampSlots, s => s.lamp == l && s.w > 0) ? 3 : 0)))
            .OrderBy(x => x.d).Take(lampSlots.Length).Select(x => x.l).ToHashSet();
        for (int i = 0; i < lampSlots.Length; i++)
        {
            var (l, w) = lampSlots[i];
            if (l == null) continue;
            w = near.Contains(l) ? Math.Min(1, w + dt * Fade) : Math.Max(0, w - dt * Fade);
            if (snap) w = near.Contains(l) ? 1 : 0;
            lampSlots[i] = (w <= 0 ? null : l, w);
        }
        foreach (var l in near)
        {
            if (Array.Exists(lampSlots, s => s.lamp == l)) continue;
            int free = Array.FindIndex(lampSlots, s => s.lamp == null);
            if (free >= 0) lampSlots[free] = (l, snap ? 1 : 0);
        }
        var list = new List<Vector4>();
        foreach (var (l, w) in lampSlots) list.Add(l == null || w <= 0 ? new Vector4(0, -999, 0, 0) : new Vector4(l.At.X, l.At.Y, l.At.Z, l.B * w));
        list.Add(Lantern ?? new Vector4(0, -999, 0, 0));
        Psx.SetLamps(list);

        // --- the painted windows
        if (panes != null)
        {
            panes.Visible = night > 0.02f;
            paneMat!.SetShaderParameter("hour_n", hourN);
            paneMat.SetShaderParameter("night", night);
        }

        // --- the landmarks' windows: lit all night, each fading by its own distance in the fog
        // (the day by the clock as the landmarks count it, main.ts: full from 9:30 to 15:30, gone by 6:30 and 18:30)
        float dayK = Mathf.Clamp(day.Hour < 12 ? (day.Hour - 6.5f) / 3 : (18.5f - day.Hour) / 3, 0, 1);
        float level = Mathf.Clamp((0.5f - dayK) / 0.3f, 0, 1);
        float breath = 0.94f + 0.04f * MathF.Sin(t * 1.3f) + 0.02f * MathF.Sin(t * 3.7f);
        foreach (var (m, tint, centre, radius) in landmark)
        {
            float dist = Math.Max(0, eye.DistanceTo(centre) - radius * 0.5f);
            var c = tint * (level * 1.35f * breath * (1 - Smooth(dist, day.FogNear, day.FogFar * 2)));
            m.SetShaderParameter("albedo", new Color(c.X, c.Y, c.Z, 1));
        }

        // --- the light on the street (spill.ts): every source's power now, the nearest ranked ten times a second
        nowHourN = hourN;
        nowNight = night;
        nowDark = dark;
        bool ranking = snap || rankT - dt <= 0;
        rankT -= dt;
        if (snap || rankT <= 0)
        {
            rankT = 0.1f;
            float view = Math.Min(170, day.FogFar + 12);
            ranked.Clear();
            foreach (var s in sources)
            {
                var d3 = s.At - eye;
                float d = d3.Length();
                if (d - s.Range > view)
                {
                    s.Now = 0;
                    continue;
                }
                if (Now(s) < 0.02f) continue;
                // the nearer, the brighter and the ones ahead first; one already lit keeps its place
                s.Score = Math.Max(0, d - s.Range * 0.25f) * (Ahead(s.At, eye, look) > -0.3f ? 1 : 1.6f) / Mathf.Clamp(MathF.Sqrt(s.Now / 4), 0.55f, 1.6f) - (s.W > 0 ? 2.5f : 0);
                ranked.Add(s);
            }
            ranked.Sort((a, b) => a.Score.CompareTo(b.Score));
        }
        else foreach (var s in slots) if (s != null) Now(s);
        RankRest(ranking, eye, day);
        var want = new HashSet<Src>(ranked.Take(Psx.MaxSpill));
        for (int i = 0; i < slots.Length; i++)
        {
            var s = slots[i];
            if (s == null) continue;
            s.W = snap ? (want.Contains(s) ? 1 : 0) : want.Contains(s) ? Math.Min(1, s.W + dt * Fade) : Math.Max(0, s.W - dt * Fade);
            if (s.W <= 0) slots[i] = null;
        }
        foreach (var s in want)
        {
            if (Array.IndexOf(slots, s) >= 0) continue;
            int free = Array.IndexOf(slots, null);
            if (free < 0) break;
            slots[free] = s;
            s.W = snap ? 1 : 0.0001f;
        }
        var on = slots.Where(s => s != null && s.W > 0 && s.Now > 0).ToList();
        Psx.SetSpill(on.Count, i =>
        {
            var s = on[i]!;
            return (new Vector4(s.At.X, s.At.Y, s.At.Z, s.Now * s.W), new Vector4(s.N.X, s.N.Y, s.Half.X, s.Half.Y), new Vector4(s.Color.X, s.Color.Y, s.Color.Z, s.Bars), new Vector4(s.Range, s.Decay, s.Depth, s.Soft));
        });
        UpdateFar(eye, day);
        Info = (sources.Count, ranked.Count, on.Count, lamps.Count, Info.panes);
        snap = false;
    }

    private float nowHourN, nowNight, nowDark;

    /// <summary>A source's power now (its kind's rule at this hour), kept in s.Now.</summary>
    private float Now(Src s)
    {
        float hourN = nowHourN, night = nowNight, dark = nowDark;
        {
            float lvl = s.Lamp ? Mathf.Clamp(s.G, 0, 1)
                : s.Sched is { } l ? Math.Max(Smooth(hourN, l[0], l[0] + 0.12f) * (1 - Smooth(hourN, l[1], l[1] + 0.12f)), Smooth(hourN, l[2], l[2] + 0.12f) * (1 - Smooth(hourN, l[3], l[3] + 0.12f))) * night
                : s.Kind == "doss" ? 0.92f + MathF.Sin(t * 5.1f) * 0.04f + MathF.Sin(t * 13.7f) * 0.03f
                : s.Kind == "lamp" ? (s.Level > 0 ? dark : 0) // (a lamp that is not a street gas lamp: lit with them)
                : s.Kind is "glow" or "lantern" ? s.Level * dark
                : s.Kind is "shop" or "tavern" or "room" or "door" ? s.Level * night * (Rooms.I?.LitAt(s.At) ?? 1)
                : s.Level * night;
            return s.Now = s.Power * lvl;
        }
    }

    private static float Ahead(Vector3 at, Vector3 eye, Vector3 look)
    {
        float dx = at.X - eye.X, dz = at.Z - eye.Z;
        return (dx * look.X + dz * look.Z) / Math.Max(MathF.Sqrt(dx * dx + dz * dz), 0.01f);
    }
}
