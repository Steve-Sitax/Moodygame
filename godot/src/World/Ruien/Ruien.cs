using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The Ruien under the town (docs/ruien-native.md): every area of res://world/ruien/areas.json, drawn from its converted
/// export (or its stand-in), lit by its own lamps and the daylight of its openings, in its own dark air.
/// - Shown only while the eye is underground, at a street opening, or out on the open water before a gate.
/// - The light list (ruien_lights): the 32 sources nearest the eye: lamps that flicker, and the outlet, the grates, the
///   shafts and the hatches with the day's sky light (cold), at night the street lamps' faint glow. Beyond the list a
///   source is not drawn at all; no Godot light lights the stone. A small fixed pool of real lights (LampPool, cull mask
///   the player's arms and body) lights what is not Ruien stone, so the light count stays fixed whatever the network.
/// - The eye's air: Daylight.Below eases in past a gate (the cover map), and the dark air, fog and glow follow.
/// - The water inside: never lower than the gate's sill holds it, held behind the tide doors while the river is higher.
/// - The river's lid over every zone (RuienCover.Lid), at the river's level.
/// - Collision from the area's own faces (StaticBody3D on Solid's layer).
/// </summary>
[GamePart(37)]
public partial class Ruien : Node
{
    public static Ruien? I { get; private set; }
    /// <summary>The Ruien's meshes (their own render layer: the town's lights and mirrors leave them out).</summary>
    public const uint Layer = 1u << 13;
    public const int MaxLights = 32;
    /// <summary>A lamp's soft core (m^2 added to the distance squared): its frame and gauze shade the nearest stone.</summary>
    public const float LampCore = 2.5f;
    public RuienData Data { get; private set; } = new();
    public RuienCover Cover { get; } = new();
    /// <summary>The eye underground now 0..1, and the area it is in (or near).</summary>
    public float Below { get; private set; }
    public RuienData.Area? Near { get; private set; }

    private sealed class Drawn
    {
        public RuienData.Area Area = null!;
        public Node3D Root = null!;
        public readonly List<MeshInstance3D> Water = new();
        public readonly List<(ShaderMaterial m, RuienData.Source s)> Beams = new();
        public float Level;
        public bool Shown;
        public RuienArea? Export;
    }

    private readonly List<Drawn> drawn = new();
    private readonly List<RuienData.Source> sources = new();
    private readonly List<(RuienData.Source s, float d)> nearest = new();
    private Image? lightImage;
    private ImageTexture? lightTex;
    private readonly float[] lightData = new float[MaxLights * 4 * 4];
    private readonly byte[] lightBytes = new byte[MaxLights * 4 * 4 * 4];
    private OmniLight3D[] pool = Array.Empty<OmniLight3D>();
    private MeshInstance3D? lid;
    private float t, lodT;
    private bool globalsIn;
    /// <summary>Counts for a check: areas, sources, the ones sent, the lamps of the pool lit.</summary>
    public string Info => $"areas {drawn.Count}, sources {sources.Count}, sent {nearest.Count}, below {Below:0.00}, near {Near?.Id ?? "-"}, shown {string.Join(",", drawn.Where(d => d.Shown).Select(d => d.Area.Id))}";

    private static readonly HashSet<string> Added = new();
    private static void Add(string n, RenderingServer.GlobalShaderParameterType ty, Variant v)
    {
        if (Added.Add(n)) RenderingServer.GlobalShaderParameterAdd(n, ty, v);
    }

    public static void EnsureGlobals()
    {
        if (I is { globalsIn: true }) return;
        Psx.EnsureGlobals();
        Add("ruien_light_n", RenderingServer.GlobalShaderParameterType.Int, 0);
        Add("ruien_cover_box", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(0, 0, 1, 1));
        Add("ruien_air", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(0.012f, 0.011f, 0.009f, 0.35f));
        Add("ruien_fill", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(0.004f, 0.0037f, 0.003f, 0));
        if (I != null) I.globalsIn = true;
    }

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 31; // after Jef (10) has moved the eye and Underwater (30)
        Data = RuienData.Load();
        EnsureGlobals();
        // the light list and the cover map, as global pictures
        lightImage = Image.CreateEmpty(MaxLights, 4, false, Image.Format.Rgbaf);
        lightTex = ImageTexture.CreateFromImage(lightImage);
        if (!Added.Add("ruien_lights")) RenderingServer.GlobalShaderParameterSet("ruien_lights", lightTex.GetRid());
        else RenderingServer.GlobalShaderParameterAdd("ruien_lights", RenderingServer.GlobalShaderParameterType.Sampler2D, lightTex.GetRid());
        Cover.Build(Data);
        var coverTex = Cover.Texture ?? ImageTexture.CreateFromImage(Image.CreateEmpty(1, 1, false, Image.Format.R8));
        if (!Added.Add("ruien_cover")) RenderingServer.GlobalShaderParameterSet("ruien_cover", coverTex.GetRid());
        else RenderingServer.GlobalShaderParameterAdd("ruien_cover", RenderingServer.GlobalShaderParameterType.Sampler2D, coverTex.GetRid());
        UniformUpdates.Global("ruien_cover_box", Cover.Box);
        UniformUpdates.Global("ruien_air", new Vector4(Data.Air.R, Data.Air.G, Data.Air.B, Data.Haze));
        UniformUpdates.Global("ruien_fill", new Vector4(Data.Fill.R, Data.Fill.G, Data.Fill.B, 0));
        if (Daylight.I != null) { Daylight.I.BelowAir = Data.Air; Daylight.I.BelowNear = Data.AirNear; Daylight.I.BelowFar = Data.AirFar; Daylight.I.BelowExposure = Data.Exposure; }
        if (Data.Areas.Count == 0 || Main.I.Flag("no-ruien-draw")) { GD.Print("ruien: no areas"); return; }
        var spec = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile)).RootElement.GetProperty("areas").EnumerateArray().ToDictionary(a => a.GetProperty("id").GetString()!, a => a);
        foreach (var area in Data.Areas)
        {
            ulong t0 = Time.GetTicksMsec();
            var d = new Drawn { Area = area, Level = area.WaterMin };
            Node3D root;
            ConcavePolygonShape3D? shape;
            string how;
            if (RuienArea.Load(area) is { } loaded) { root = loaded.Root; shape = loaded.Shape; d.Export = loaded; how = $"export {area.Export} ({loaded.Keys.Count} keys, {loaded.Triangles0} + {loaded.Triangles1} triangles)"; }
            else { (root, shape) = new RuienStandIn(area).Build(spec[area.Id]); how = "stand-in"; }
            d.Root = root;
            Main.I.View.AddChild(root);
            if (shape != null)
            {
                var body = new StaticBody3D { Name = "ruien_" + area.Id + "_solid", CollisionLayer = Solid.Layer, CollisionMask = 0 };
                body.AddChild(new CollisionShape3D { Shape = shape });
                Main.I.View.AddChild(body);
            }
            Dress(d, root);
            drawn.Add(d);
            sources.AddRange(area.Sources);
            GD.Print($"ruien: {area.Id} ({area.Name}) from the {how}: {root.GetChildCount()} parts, {area.Sources.Count} sources, {area.Zones.Count} zones in {Time.GetTicksMsec() - t0} ms");
        }
        lid = RuienCover.Lid(Data);
        Main.I.View.AddChild(lid);
        // the fixed pool of real lights for what is not Ruien stone (the arms, the body): never more, never fewer
        pool = new OmniLight3D[Data.LampPool];
        for (int i = 0; i < pool.Length; i++)
        {
            pool[i] = new OmniLight3D { Name = $"ruien_lamp_pool_{i}", LightEnergy = 0, OmniRange = 7, OmniAttenuation = 2, ShadowEnabled = false, LightSpecular = 0, LightCullMask = Player.Arms.ArmLayer | Player.Arms.BodyLayer, Position = new Vector3(0, -999, 0) };
            Main.I.View.AddChild(pool[i]);
        }
        Update(0);
    }

    /// <summary>An area's water sheets, beams, mist and lamps' glow (from its data: the markers or the stand-in's).</summary>
    private void Dress(Drawn d, Node3D root)
    {
        var area = d.Area;
        foreach (var w in area.Water)
        {
            var st = new SurfaceTool();
            st.Begin(Mesh.PrimitiveType.Triangles);
            void V(Vector2 p) { st.SetUV(p); st.AddVertex(new Vector3(p.X, 0, p.Y)); }
            if (w.Outline.Length >= 3)
                for (int i = 1; i + 1 < w.Outline.Length; i++) { V(w.Outline[0]); V(w.Outline[i]); V(w.Outline[i + 1]); }
            else if ((w.Line.Length >= 2 ? w.Line : area.Zones.FirstOrDefault(z => z.Id == w.Zone && z.Kind == "line")?.Path) is { Length: >= 2 } path)
            {
                float half = (w.Width > 0 ? w.Width : area.Zones.FirstOrDefault(z => z.Kind == "line")?.S.Channel ?? 3) / 2;
                for (int i = 0; i + 1 < path.Length; i++)
                {
                    var t0 = (path[Math.Min(i + 1, path.Length - 1)] - path[Math.Max(i - 1, 0)]).Normalized();
                    var t1 = (path[Math.Min(i + 2, path.Length - 1)] - path[i]).Normalized();
                    var n0 = new Vector2(t0.Y, -t0.X) * half; var n1 = new Vector2(t1.Y, -t1.X) * half;
                    Vector2 a = path[i] - n0, b = path[i] + n0, c = path[i + 1] + n1, e = path[i + 1] - n1;
                    V(a); V(b); V(c); V(a); V(c); V(e);
                }
            }
            else continue;
            var mesh = st.Commit();
            var m = (ShaderMaterial)RuienMaterials.Get("ruien_misc_water").Duplicate();
            m.SetShaderParameter("flow", w.Flow);
            mesh.SurfaceSetMaterial(0, m);
            var mi = new MeshInstance3D { Name = "water_" + w.Id, Mesh = mesh, Layers = Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Position = new Vector3(0, area.WaterMin, 0) };
            root.AddChild(mi);
            d.Water.Add(mi);
        }
        foreach (var s in area.Sources)
        {
            if (s.Kind == "lamp")
            {
                // the lamp's glass and flame: one shared model (RuienKit), its glow following the lamp
                if (!area.Exported) root.AddChild(RuienKit.Lamp(s)); // (an export has its own lamps)
                continue;
            }
            if (s.Beam <= 0) continue; // (an outlet: its light comes in level, no shaft of it)
            float len = s.Beam;
            float r = Math.Max(s.HalfU, s.HalfV) * (s.Round ? 0.95f : 0.7f);
            var m = RuienMaterials.Beam(new Color(0.75f, 0.82f, 0.95f), s.At, s.Dir, len, r);
            var box = new BoxMesh { Size = new Vector3(r * 2 + len * 0.3f + 0.6f, len + 0.6f, r * 2 + len * 0.3f + 0.6f) };
            var mi = new MeshInstance3D { Name = "beam_" + s.Id, Mesh = box, MaterialOverride = m, Layers = Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
            mi.Position = s.At + s.Dir * (len / 2);
            mi.Basis = new Basis(new Quaternion(Vector3.Down, s.Dir.Normalized()));
            root.AddChild(mi);
            d.Beams.Add((m, s));
        }
        // the street grates over the ladder shafts: on the street, drawn with the town (not with the area)
        foreach (var w in area.Ways)
            if (w.Kind == "ladder") Main.I.View.AddChild(RuienKit.Grate(w));
        foreach (var mb in area.Mist)
        {
            var m = RuienMaterials.Mist(mb.Min, mb.Max, mb.Density);
            var size = mb.Max - mb.Min;
            root.AddChild(new MeshInstance3D { Name = "mist_" + mb.Id, Mesh = new BoxMesh { Size = size + Vector3.One * 0.02f }, MaterialOverride = m, Position = (mb.Min + mb.Max) / 2, Layers = Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        }
    }

    public override void _Process(double delta)
    {
        using var cost = Scheldemist.Dev.FrameCost.Track("Ruien");
        if (live) Live((float)delta);
        Update((float)delta);
    }

    // (dev: --ruien-live re-reads areas.json and materials.json when they change: the light, the air and the
    // materials' numbers follow at once, the geometry stays)
    private readonly bool live = Main.I.Flag("ruien-live");
    private float liveT;
    private ulong liveStamp;
    private void Live(float dt)
    {
        liveT -= dt;
        if (liveT > 0) return;
        liveT = 0.5f;
        ulong stamp = Godot.FileAccess.GetModifiedTime(RuienData.AreasFile) + Godot.FileAccess.GetModifiedTime(RuienMaterials.File) * 3;
        if (liveStamp == 0) { liveStamp = stamp; return; }
        if (stamp == liveStamp) return;
        liveStamp = stamp;
        try
        {
            var fresh = RuienData.Load();
            Data.Air = fresh.Air; Data.Fill = fresh.Fill; Data.Haze = fresh.Haze; Data.AirNear = fresh.AirNear; Data.AirFar = fresh.AirFar; Data.Exposure = fresh.Exposure;
            UniformUpdates.Global("ruien_air", new Vector4(Data.Air.R, Data.Air.G, Data.Air.B, Data.Haze));
            if (Daylight.I != null) { Daylight.I.BelowAir = Data.Air; Daylight.I.BelowNear = Data.AirNear; Daylight.I.BelowFar = Data.AirFar; Daylight.I.BelowExposure = Data.Exposure; Daylight.I.Restep(); }
            var byId = fresh.Areas.SelectMany(a => a.Sources).ToDictionary(x => x.Id, x => x);
            foreach (var src in sources)
                if (byId.TryGetValue(src.Id, out var f)) { src.Power = f.Power; src.Color = f.Color; src.Range = f.Range; src.Haze = f.Haze; src.HalfU = f.HalfU; src.HalfV = f.HalfV; src.Bars = f.Bars; src.At = f.At; src.Dir = f.Dir; }
            RuienMaterials.Reload();
            GD.Print("ruien: live reload");
        }
        catch (Exception e) { GD.PrintErr("ruien: live reload failed: " + e.Message); }
    }

    /// <summary>How far under a vault a point is: 0 in the open .. 1 inside (the cover map, below the crown).</summary>
    public float CoverAt(Vector3 p) => Cover.At(p.X, p.Z) * (1 - Mathf.SmoothStep(-0.7f, -0.05f, p.Y));

    private void Update(float dt)
    {
        t += dt;
        var cam = Main.I.View.GetCamera3D();
        var day = Daylight.I;
        if (cam == null || day == null) return;
        var eye = cam.GlobalPosition;
        // the eye under a vault: the air and the light follow it (Daylight)
        float below = CoverAt(eye);
        Below = below;
        if (MathF.Abs(day.Below - below) > 0.002f)
        {
            day.Below = below;
            day.Restep();
        }
        UniformUpdates.Global("ruien_fill", new Vector4(Data.Fill.R, Data.Fill.G, Data.Fill.B, below));
        Near = null;
        lodT -= dt;
        foreach (var d in drawn)
        {
            var a = d.Area;
            bool inBox = a.Box.Grow(2).HasPoint(eye);
            bool atGate = a.Gates.Any(g => { var rel = new Vector2(eye.X, eye.Z) - g.Origin; return rel.Dot(g.Normal) > -1 && rel.Length() < 90 && eye.Y < 6; });
            bool atOpening = a.Sources.Any(s => s.Kind != "lamp" && new Vector2(eye.X - s.At.X, eye.Z - s.At.Z).Length() < 14 && eye.Y > -1.5f);
            bool show = Main.I.Flag("ruien-always") || (inBox && eye.Y < 0.5f) || atGate || atOpening;
            if (show != d.Shown) { d.Shown = show; d.Root.Visible = show; }
            if (inBox || atGate) Near = a;
            // the export's levels of detail, four times a second
            if (show && d.Export != null && (lodT <= 0 || d.Export.Keys.All(k => k.Shown < 0))) d.Export.Lod(eye);
            // the water inside: the river lets it down to the sill's level and no lower; behind shut doors it is held and
            // rises a little with what the drains bring
            float river = Tide.River;
            float target = river < a.WaterMin ? a.WaterMin : a.WaterMin + a.WaterRise * Mathf.Clamp((river - a.WaterMin) / 3.5f, 0, 1);
            d.Level += (target - d.Level) * Math.Min(1, dt * 0.05f + (dt <= 0 ? 1 : 0));
            foreach (var w in d.Water) w.Position = new Vector3(0, d.Level, 0);
        }
        if (lodT <= 0) lodT = 0.25f;
        if (lid != null)
        {
            // (over the swell and the storm's chop: the sheet's vertices rise up to a few decimetres over its level)
            lid.Position = new Vector3(0, Tide.River + 0.45f, 0);
            lid.Visible = drawn.Any(x => x.Shown);
        }
        SendLights(eye, day);
    }

    /// <summary>The light of a source now: a lamp's flicker, an opening's day (cold sky) or night (the street's glow).</summary>
    private float Strength(RuienData.Source s, Daylight day, out Color c)
    {
        c = s.Color;
        if (s.Kind == "lamp")
        {
            float seed = s.At.X * 0.37f + s.At.Z * 0.11f;
            float f = 0.9f + 0.05f * MathF.Sin(t * 1.7f + seed) + 0.035f * MathF.Sin(t * 7.9f + seed * 3.1f) + 0.02f * MathF.Sin(t * 17.3f + seed * 1.3f);
            return s.Power * f;
        }
        // daylight: the sky's strength outside, cold; at night a trace of the gas lamps' warm light
        float sky = day.SkyIntensity * (1 - 0.85f * day.Night);
        var cold = new Color(0.72f, 0.8f, 0.95f);
        var warm = new Color(1.0f, 0.62f, 0.3f);
        float nightGlow = 0.05f * day.Night;
        c = cold * sky + warm * nightGlow;
        float m = Math.Max(c.R, Math.Max(c.G, c.B));
        if (m > 1e-5f) c /= m;
        return s.Power * m;
    }

    private void SendLights(Vector3 eye, Daylight day)
    {
        nearest.Clear();
        bool any = drawn.Any(d => d.Shown);
        if (any)
            foreach (var s in sources)
            {
                float dd = s.At.DistanceTo(eye) - s.Range;
                if (dd > 45) continue;
                int at = nearest.Count;
                while (at > 0 && nearest[at - 1].d > dd) at--;
                if (at >= MaxLights) continue;
                nearest.Insert(at, (s, dd));
                if (nearest.Count > MaxLights) nearest.RemoveAt(MaxLights);
            }
        Array.Clear(lightData);
        for (int i = 0; i < nearest.Count; i++)
        {
            var s = nearest[i].s;
            float p = Strength(s, day, out var c);
            int kind = s.Kind == "lamp" ? 0 : s.Round ? 2 : 1;
            Put(i, 0, new Vector4(s.At.X, s.At.Y, s.At.Z, p));
            Put(i, 1, kind == 0 ? new Vector4(0, 0, 0, 0) : new Vector4(s.Dir.X, s.Dir.Y, s.Dir.Z, kind));
            Put(i, 2, new Vector4(c.R, c.G, c.B, s.HalfU));
            Put(i, 3, new Vector4(s.Range, s.HalfV, kind == 0 ? LampCore : s.Bars, s.Haze));
        }
        Buffer.BlockCopy(lightData, 0, lightBytes, 0, lightBytes.Length);
        lightImage!.SetData(MaxLights, 4, false, Image.Format.Rgbaf, lightBytes);
        lightTex!.Update(lightImage);
        UniformUpdates.Global("ruien_light_n", nearest.Count);
        // the beams follow the day; the lamps' glass and flames their lamps
        foreach (var d in drawn)
            foreach (var (m, s) in d.Beams)
            {
                float p = d.Shown ? Strength(s, day, out var c) : 0;
                UniformUpdates.Material(m, "strength", p * 0.06f);
            }
        // the real lights' pool: the nearest lamps, for the arms and the body
        int k = 0;
        foreach (var (s, _) in nearest)
        {
            if (k >= pool.Length) break;
            if (s.Kind != "lamp") continue;
            var l = pool[k++];
            float p = Strength(s, day, out var c);
            if (l.Position != s.At) l.Position = s.At;
            l.LightColor = c.LinearToSrgb();
            l.LightEnergy = p * 0.35f;
        }
        for (; k < pool.Length; k++) if (pool[k].LightEnergy != 0) pool[k].LightEnergy = 0;
    }

    private void Put(int i, int row, Vector4 v)
    {
        int o = (row * MaxLights + i) * 4;
        lightData[o] = v.X; lightData[o + 1] = v.Y; lightData[o + 2] = v.Z; lightData[o + 3] = v.W;
    }

    /// <summary>The dev kit's way in: Jef on an area's entry (areas.json devEntry), or the first area's.</summary>
    public string Enter(string id)
    {
        var a = Data.Areas.FirstOrDefault(x => x.Id == id) ?? Data.Areas.FirstOrDefault() ?? throw new ArgumentException("no Ruien areas");
        var e = a.DevEntry;
        Player.Jef.I.Place(e.X, e.Z, Mathf.DegToRad(e.W), near: e.Y);
        // (again a moment later: a game just started puts him back at its own start after the first frames)
        GetTree().CreateTimer(0.8).Timeout += () => Player.Jef.I.Place(e.X, e.Z, Mathf.DegToRad(e.W), near: e.Y);
        return $"in the Ruien: {a.Name} at ({e.X:0.0}, {e.Y:0.0}, {e.Z:0.0})";
    }
}
