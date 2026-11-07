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
/// - World-space exclusion of the town river sheet beneath every covered zone and its masonry.
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
        public readonly List<(MeshInstance3D mesh, ShaderMaterial material, RuienData.Gate gate)> Outflows = new();
        public readonly List<(MeshInstance3D mesh, ShaderMaterial material, RuienData.MistBox box)> Mists = new();
        public readonly List<(ShaderMaterial m, RuienData.Source s)> Beams = new();
        public float Level;
        public bool Shown, InBox, AtGate, AtOpening;
        public RuienArea? Export;
        /// <summary>The tide doors: their meshes (every level), their own solid body, how open now (0 shut .. 1).</summary>
        public readonly List<(RuienData.Mover m, List<MeshInstance3D> meshes, StaticBody3D? body, float[] open)> Doors = new();
    }

    private readonly List<Drawn> drawn = new();
    private readonly HashSet<string> groupShown = new();
    /// <summary>The entrances' doors (plan), for lighting their stairs when the eye is near one.</summary>
    private readonly List<Vector2> entranceDoors = new();
    private readonly List<RuienData.Source> sources = new();
    private readonly List<(RuienData.Source s, float d)> nearest = new();
    private Image? lightImage;
    private ImageTexture? lightTex;
    private readonly float[] lightData = new float[MaxLights * 4 * 4];
    private readonly byte[] lightBytes = new byte[MaxLights * 4 * 4 * 4];
    private OmniLight3D[] pool = Array.Empty<OmniLight3D>();
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

    /// <summary>The pieces built beside the town's load (StartBeside), in the order they are laid into the view.</summary>
    private readonly List<Node> placed = new();
    private Action<Node> place = n => Main.I.View.AddChild(n);
    private List<RuienEntrance.Spec> entrances = new();
    private System.Threading.Tasks.Task<bool>? beside;
    private Dev.StartupTiming.Sequence? ruienTrace;

    /// <summary>
    /// Build the entrances and the areas on a worker thread while the town loads (docs/ruien-native.md). Nothing is
    /// in the tree until _Ready lays the pieces in, at the part's own place in the start, so what the other parts
    /// see is unchanged. The globals and the cover come first, on this thread: the pieces' materials use them.
    /// </summary>
    public void StartBeside()
    {
        // (only while the town is still loading: Main joins the worker before the town enters the tree)
        if (beside != null || IsInsideTree() || Main.I.World.IsInsideTree()) return;
        PrepareEarly();
        place = placed.Add;
        // (two frames first: the globals and the cover picture made just now reach the renderer before the worker's
        // materials use them)
        var go = new System.Threading.Tasks.TaskCompletionSource();
        beside = go.Task.ContinueWith(_ => BuildPieces(), System.Threading.Tasks.TaskScheduler.Default);
        var tree = Main.I.GetTree();
        int frames = 0;
        void Tick() { if (++frames < 2) return; tree.ProcessFrame -= Tick; go.SetResult(); }
        tree.ProcessFrame += Tick;
    }

    private bool preparedEarly;
    /// <summary>
    /// The globals and the cover picture, set before the town's loading thread starts: the renderer's global values are
    /// not to be changed while that thread makes the town's materials.
    /// </summary>
    public void PrepareEarly()
    {
        if (preparedEarly || IsInsideTree()) return;
        preparedEarly = true;
        Prepare();
    }

    /// <summary>Done (or not started): the part can be added.</summary>
    public System.Threading.Tasks.Task Beside => beside ?? System.Threading.Tasks.Task.CompletedTask;

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 31; // after Jef (10) has moved the eye and Underwater (30)
        bool areas;
        if (beside == null) { if (!preparedEarly) Prepare(); areas = BuildPieces(); }
        else
        {
            // (Main waits for the worker frame by frame before adding this part: this never blocks)
            bool built = beside.IsCompletedSuccessfully;
            if (!built) GD.PrintErr($"ruien: the pieces built beside the town failed, building them here: {beside.Exception?.GetBaseException()}");
            areas = built && beside.Result;
            if (built)
                using (Dev.StartupTiming.Measure("ruien.attach"))
                {
                    var slow = new List<(double Ms, string Name)>();
                    foreach (var node in placed)
                    {
                        long t0 = System.Diagnostics.Stopwatch.GetTimestamp();
                        Main.I.View.AddChild(node);
                        slow.Add((System.Diagnostics.Stopwatch.GetElapsedTime(t0).TotalMilliseconds, node.Name));
                    }
                    if (Main.I.Flag("startup-proof"))
                        GD.Print("ruien: slowest to lay in: " + string.Join(", ", slow.OrderByDescending(x => x.Ms).Take(12).Select(x => $"{x.Name} {x.Ms:0} ms")) + $"; all {slow.Sum(x => x.Ms):0} ms");
                }
            else
            {
                foreach (var node in placed) node.Free();
                drawn.Clear(); sources.Clear(); entranceDoors.Clear(); soundPoints.Clear();
            }
            placed.Clear();
            place = n => Main.I.View.AddChild(n);
            if (!built) { Prepare(); areas = BuildPieces(); }
        }
        UniformUpdates.Global("ruien_air", new Vector4(Data.Air.R, Data.Air.G, Data.Air.B, Data.Haze));
        UniformUpdates.Global("ruien_fill", new Vector4(Data.Fill.R, Data.Fill.G, Data.Fill.B, 0));
        if (Daylight.I != null) { Daylight.I.BelowAir = Data.Air; Daylight.I.BelowNear = Data.AirNear; Daylight.I.BelowFar = Data.AirFar; Daylight.I.BelowExposure = Data.Exposure; }
        if (Main.I.Flag("startup-proof")) Fingerprint();
        if (!areas) { GD.Print("ruien: no areas"); ruienTrace?.Dispose(); return; }
        Audio.Soundscape.RuienPoints = soundPoints;
        Audio.Soundscape.RuienOpenAt = OpenAt;
        // the fixed pool of real lights for what is not Ruien stone (the arms, the body): never more, never fewer
        pool = new OmniLight3D[Data.LampPool];
        for (int i = 0; i < pool.Length; i++)
        {
            pool[i] = new OmniLight3D { Name = $"ruien_lamp_pool_{i}", LightEnergy = 0, OmniRange = 7, OmniAttenuation = 2, ShadowEnabled = false, LightSpecular = 0, LightCullMask = Player.Arms.ArmLayer | Player.Arms.BodyLayer, Position = new Vector3(0, -999, 0) };
            Main.I.View.AddChild(pool[i]);
        }
        Update(0);
        ruienTrace?.Dispose();
    }

    /// <summary>The proof's summary of every piece laid into the view: the same pieces whichever thread built them.</summary>
    private void Fingerprint()
    {
        using var hash = System.Security.Cryptography.IncrementalHash.CreateHash(System.Security.Cryptography.HashAlgorithmName.SHA256);
        int nodes = 0, meshes = 0, faces = 0;
        var lines = Main.I.Arg("ruien-pieces-out") is { Length: > 0 } ? new List<string>() : null;
        // (an unnamed node's automatic name carries a process-wide counter: left out)
        void Add(string text) { text = System.Text.RegularExpressions.Regex.Replace(text, @"@(\w+)@\d+", "@$1@"); hash.AppendData(System.Text.Encoding.UTF8.GetBytes(text + "|")); lines?.Add(text); }
        foreach (var top in Main.I.View.GetChildren())
            foreach (var n in BakedWorld.All(top))
            {
                string at = Main.I.View.GetPathTo(n).ToString();
                if (!at.Contains("ruien", StringComparison.OrdinalIgnoreCase) && !at.StartsWith("entrance_", StringComparison.Ordinal)) continue;
                nodes++;
                Add(Main.I.View.GetPathTo(n) + " " + n.GetClass() + (n is Node3D n3 ? " " + n3.Transform : ""));
                if (n is MeshInstance3D { Mesh: { } m }) { meshes++; Add(m.GetSurfaceCount() + " " + m.GetAabb()); }
                if (n is CollisionShape3D { Shape: ConcavePolygonShape3D c }) { var f = c.Data; faces += f.Length / 3; Add(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Runtime.InteropServices.MemoryMarshal.AsBytes(f.AsSpan())))); }
            }
        if (lines != null) System.IO.File.WriteAllLines(Main.I.Arg("ruien-pieces-out"), lines);
        GD.Print($"ruien pieces: {nodes} nodes, {meshes} meshes, {faces} collision triangles, {drawn.Count} areas, {sources.Count} sources, {soundPoints.Count} sound points, {Convert.ToHexString(hash.GetHashAndReset())[..16]}");
    }

    private void Prepare()
    {
        Data = RuienData.Load();
        EnsureGlobals();
        // the light list and the cover map, as global pictures
        lightImage = Image.CreateEmpty(MaxLights, 4, false, Image.Format.Rgbaf);
        lightTex = ImageTexture.CreateFromImage(lightImage);
        if (!Added.Add("ruien_lights")) RenderingServer.GlobalShaderParameterSet("ruien_lights", lightTex.GetRid());
        else RenderingServer.GlobalShaderParameterAdd("ruien_lights", RenderingServer.GlobalShaderParameterType.Sampler2D, lightTex.GetRid());
        // the ways in from the street (entrances.json): their models, their doors' daylight in the light list
        entrances = Main.I.Flag("no-ruien-entrances") ? new List<RuienEntrance.Spec>() : RuienEntrance.All.ToList();
        ruienTrace=Dev.StartupTiming.Split("ruien.prepare");
        Cover.Build(Data, entrances);
        var coverTex = Cover.Texture ?? ImageTexture.CreateFromImage(Image.CreateEmpty(1, 1, false, Image.Format.R8));
        if (!Added.Add("ruien_cover")) RenderingServer.GlobalShaderParameterSet("ruien_cover", coverTex.GetRid());
        else RenderingServer.GlobalShaderParameterAdd("ruien_cover", RenderingServer.GlobalShaderParameterType.Sampler2D, coverTex.GetRid());
        UniformUpdates.Global("ruien_cover_box", Cover.Box);
        RenderingServer.GlobalShaderParameterSet("psx_ruien_cover",coverTex.GetRid());
        UniformUpdates.Global("psx_ruien_box",Cover.Box);
        ruienTrace?.Next("cover");
        // (shared lazily made lists, made here once rather than on two threads)
        _ = RuienEntrance.All;
    }

    /// <summary>The entrances' and areas' nodes, laid by <see cref="place"/>; false when there are no areas to draw.</summary>
    private bool BuildPieces()
    {
        foreach (var e in entrances)
        {
            using var entranceTrace=Dev.StartupTiming.Split("ruien.entrance-add."+e.Id);
            var built=RuienEntrance.Build(e);
            entranceTrace?.Next("build");
            place(built);
            entranceTrace?.Next("attach");
            sources.Add(RuienEntrance.DoorLight(e));
            entranceTrace?.Next("light");
            entranceDoors.Add(new Vector2(e.Door.X, e.Door.Y));
        }
        ruienTrace?.Next("entrances");
        if (entrances.Count > 0) GD.Print($"ruien: {entrances.Count} entrances from the street");
        if (Data.Areas.Count == 0 || Main.I.Flag("no-ruien-draw")) return false;
        var spec = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile)).RootElement.GetProperty("areas").EnumerateArray().ToDictionary(a => a.GetProperty("id").GetString()!, a => a);
        foreach (var area in Data.Areas)
        {
            using var areaTrace=Dev.StartupTiming.Split("ruien.area."+area.Id);
            ulong t0 = Time.GetTicksMsec();
            var d = new Drawn { Area = area, Level = area.WaterMin };
            Node3D root;
            ConcavePolygonShape3D? shape;
            string how;
            if (RuienArea.Load(area) is { } loaded) { root = loaded.Root; shape = loaded.Shape; d.Export = loaded; how = $"export {area.Export} ({loaded.Keys.Count} keys, {loaded.Triangles0} + {loaded.Triangles1} triangles)"; }
            else { (root, shape) = new RuienStandIn(area).Build(spec[area.Id]); how = "stand-in"; }
            areaTrace?.Next("load-export");
            place(RuienConnections.Build(spec[area.Id],area));
            foreach(var drain in area.Drains)place(RuienDrain.Build(area.Line(drain.Zone)!,drain.U,drain.Side));
            // Shared kit pieces placed by the area's data: open cast outfalls and bricked-up stub ends.
            var pipes=RuienPipe.Read(spec[area.Id],area);
            for(int i=0;i<pipes.Count;i++)place(RuienPipe.Build(pipes[i],i));
            foreach(var end in RuienEnd.Read(spec[area.Id]))place(RuienEnd.Build(end));
            // Folding footbridges over the rui channels (#286, #283): one shared model, the server's shared leaf state.
            foreach(var bridge in area.Bridges)place(RuienFoldBridge.Build(bridge,Data.Bridge));
            if(spec[area.Id].TryGetProperty("grates",out var grates))
                foreach(var g in grates.EnumerateArray())
                    if(g.TryGetProperty("collar",out var collar))
                    {
                        var at=g.GetProperty("at");
                        place(RuienKit.Collar(new Vector3(at[0].GetSingle(),0,at[2].GetSingle()),g.GetProperty("size").GetSingle()/2,collar.GetProperty("outer").GetSingle()+.17f,collar.GetProperty("rim").GetSingle()));
                    }
            areaTrace?.Next("connections");
            d.Root = root;
            place(root);
            if (shape != null)
            {
                var body = new StaticBody3D { Name = "ruien_" + area.Id + "_solid", CollisionLayer = Solid.Layer, CollisionMask = 0 };
                body.AddChild(new CollisionShape3D { Shape = shape });
                place(body);
            }
            areaTrace?.Next("attach-collision");
            Dress(d, root);
            areaTrace?.Next("dress");
            // the penstock stands raised (its travel's top), so the channel under it can be waded at low water
            if (d.Export != null && area.PenstockRaise != 0)
                foreach (var mv in area.Movers.Where(m => m.Kind.StartsWith("penstock")))
                    if (d.Export.Keys.FirstOrDefault(k => k.Name == mv.Id) is { } pk)
                        foreach (var mi in pk.Lods.SelectMany(l => l)) mi.Position = new Vector3(0, area.PenstockRaise, 0);
            // the tide doors: the export's leaves, each turned on its hinge by the tide (Doors below)
            if (d.Export != null)
                foreach (var mv in area.Movers.Where(m => m.Kind == "tide_door_leaf"))
                {
                    var key = d.Export.Keys.FirstOrDefault(k => k.Name == mv.Id);
                    if (key == null) continue;
                    StaticBody3D? body = null;
                    string colPath = area.Export + "/" + mv.Collision;
                    if (mv.Collision != "" && ResourceLoader.Exists(colPath))
                    {
                        body = new StaticBody3D { Name = "ruien_" + mv.Id + "_solid", CollisionLayer = Solid.Layer, CollisionMask = 0 };
                        body.AddChild(new CollisionShape3D { Shape = ResourceLoader.Load<ConcavePolygonShape3D>(colPath) });
                        place(body);
                    }
                    d.Doors.Add((mv, key.Lods.SelectMany(l => l).ToList(), body, new[] { -1f }));
                }
            drawn.Add(d);
            sources.AddRange(area.Sources);
            SoundPoints(area, spec[area.Id], pipes);
            GD.Print($"ruien: {area.Id} ({area.Name}) from the {how}: {root.GetChildCount()} parts, {area.Sources.Count} sources, {area.Zones.Count} zones in {Time.GetTicksMsec() - t0} ms");
        }
        ruienTrace?.Next("areas");
        return true;
    }

    private readonly List<Audio.Soundscape.RuienPoint> soundPoints = new();

    /// <summary>
    /// An area's water sounds, each at its own place with its own reach: the side drains' spouts where they meet the
    /// channel, a drop now and then from each pipe mouth, and the drips the area lists (`drips`: vault joints over the
    /// water, the niche's seep).
    /// </summary>
    private void SoundPoints(RuienData.Area area, JsonElement spec, List<RuienPipe.Spec> pipes)
    {
        foreach (var drain in area.Drains)
            soundPoints.Add(new() { Kind = "spill", At = RuienDrain.SpoutImpact(area.Line(drain.Zone)!, drain.U, drain.Side), Reach = 7, Gain = .6 });
        foreach (var p in pipes)
            soundPoints.Add(new() { Kind = "drip", At = p.Front + Vector3.Down * .45f, Reach = 5, Gain = .8, Min = 4, Max = 11 });
        // a covered side drain's pour where it meets the channel (`spills`: the R3 crossings of a generated stretch)
        if (spec.TryGetProperty("spills", out var spills))
            foreach (var s in spills.EnumerateArray())
            {
                var at = s.GetProperty("at");
                soundPoints.Add(new() { Kind = "spill", At = new Vector3(at[0].GetSingle(), at[1].GetSingle(), at[2].GetSingle()),
                    Reach = s.TryGetProperty("reach", out var r) ? r.GetDouble() : 7, Gain = s.TryGetProperty("gain", out var g) ? g.GetDouble() : .6 });
            }
        if (spec.TryGetProperty("drips", out var drips))
            foreach (var d in drips.EnumerateArray())
            {
                var at = d.GetProperty("at");
                var every = d.TryGetProperty("every", out var e) ? e : default;
                soundPoints.Add(new()
                {
                    Kind = "drip", At = new Vector3(at[0].GetSingle(), at[1].GetSingle(), at[2].GetSingle()),
                    Reach = d.TryGetProperty("reach", out var r) ? r.GetDouble() : 6, Gain = d.TryGetProperty("gain", out var g) ? g.GetDouble() : 1.2,
                    Min = every.ValueKind == JsonValueKind.Array ? every[0].GetDouble() : 2.5, Max = every.ValueKind == JsonValueKind.Array ? every[1].GetDouble() : 8,
                });
            }
    }

    /// <summary>For the echo: 1 at an opening to the street (a grate, shaft, hatch, the outlet), 0 nine metres in.</summary>
    public double OpenAt(Vector3 p)
    {
        float best = float.MaxValue;
        foreach (var s in sources)
            if (s.Kind != "lamp" && s.Power>0) best = Math.Min(best, new Vector2(p.X - s.At.X, p.Z - s.At.Z).Length() - Math.Max(s.HalfU, s.HalfV));
        return 1 - Mathf.SmoothStep(1.5f, 9f, best);
    }

    /// <summary>An area's water sheets, beams, mist and lamps' glow (from its data: the markers or the stand-in's).</summary>
    private void Dress(Drawn d, Node3D root)
    {
        var area = d.Area;
        using var dressTrace=Scheldemist.Dev.StartupTiming.Split("ruien."+area.Id+".dress");
        foreach (var w in area.Water)
        {
            var st = new SurfaceTool();
            st.Begin(Mesh.PrimitiveType.Triangles);
            void V(Vector2 p) { st.SetUV(p); st.AddVertex(new Vector3(p.X, 0, p.Y)); }
            if (w.Outline.Length >= 3)
                for (int i = 1; i + 1 < w.Outline.Length; i++) { V(w.Outline[0]); V(w.Outline[i]); V(w.Outline[i + 1]); }
            else if ((w.Line.Length >= 2 ? w.Line : area.Zones.FirstOrDefault(z => z.Id == w.Zone && z.Kind == "line")?.Path) is { Length: >= 2 } path)
            {
                var section=area.Line(w.Zone)?.S;
                float half = (w.Width > 0 ? w.Width : section?.Channel ?? 3) / 2;
                float centre=w.Line.Length>=2?0:((section?.ChannelLow??-half)+(section?.ChannelHigh??half))/2;
                for (int i = 0; i + 1 < path.Length; i++)
                {
                    var t0 = (path[Math.Min(i + 1, path.Length - 1)] - path[Math.Max(i - 1, 0)]).Normalized();
                    var t1 = (path[Math.Min(i + 2, path.Length - 1)] - path[i]).Normalized();
                    var n0 = new Vector2(t0.Y, -t0.X) * half; var n1 = new Vector2(t1.Y, -t1.X) * half;
                    Vector2 a = path[i] - n0, b = path[i] + n0, c = path[i + 1] + n1, e = path[i + 1] - n1;
                    var shift0=new Vector2(t0.Y,-t0.X)*centre;var shift1=new Vector2(t1.Y,-t1.X)*centre;
                    a+=shift0;b+=shift0;c+=shift1;e+=shift1;
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
        dressTrace?.Next("water");
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
        dressTrace?.Next("sources");
        // the kit pieces the area places (shared models)
        foreach (var (piece, at, yaw, hook) in area.Kit)
        {
            if (RuienKit.Piece(piece, at, yaw, hook) is not { } pn) continue;
            root.AddChild(pn);
            // On a curved wall the kit lamp hangs from the shared hook, fitted to the brick behind it.
            if (hook && d.Export != null)
                RuienHook.Place(root, pn, d.Export.Keys.SelectMany(k => k.Lods[0]).Select(m => m.Mesh).OfType<ArrayMesh>(),
                    RuienKit.LampTop, piece + "_" + at.X.ToString("0.0"));
        }
        dressTrace?.Next("kit");
        // the export's lamps on curved walls: hooks instead of their straight brackets
        if (d.Export != null) GD.Print($"ruien: {RuienHook.Fit(area, d.Export, root)} lamp hooks fitted in {area.Id}");
        // the street grates over the ladder shafts: on the street, drawn with the town (not with the area); the step
        // irons up a channel wall
        dressTrace?.Next("hooks");
        foreach (var w in area.Ways)
        {
            using var wayTrace=Scheldemist.Dev.StartupTiming.Measure("ruien."+area.Id+".way."+w.Id);
            if (RuienSurround.Applies(w)) place(RuienSurround.Build(w));
            if (w.Kind is "ladder" or "grate") place(RuienKit.Grate(w));
            if (w.Kind == "rungs" && w.Irons) root.AddChild(RuienKit.StepIrons(w));
            if (w.Kind == "keeper_stair") place(RuienStair.CachedBuild(w, area.StairZone(w)));
            if(w.Retired)root.AddChild(RuienStreetClosure.Cap(w));
        }
        dressTrace?.Next("ways");
        foreach (var mb in area.Mist)
        {
            var m = RuienMaterials.Mist(mb.Min, mb.Max, mb.Density);
            var size = mb.Max - mb.Min;
            var mist = new MeshInstance3D { Name = "mist_" + mb.Id, Mesh = new BoxMesh { Size = size + Vector3.One * 0.02f }, MaterialOverride = m, Position = (mb.Min + mb.Max) / 2, Layers = Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
            root.AddChild(mist);
            d.Mists.Add((mist, m, mb));
        }
        foreach (var gate in area.Gates)
        {
            var st = new SurfaceTool(); st.Begin(Mesh.PrimitiveType.Triangles);
            var across = new Vector2(-gate.Normal.Y, gate.Normal.X);
            Vector3 Point(float along, float side)
            {
                var p = gate.Origin + gate.Normal * along + across * side*gate.WaterWidth(along)/2;
                return new Vector3(p.X, 0, p.Y);
            }
            for (int i = 0; i < 24; i++)
            {
                float a = -1.6f + i * 0.15f, b = a + 0.15f;
                foreach (var p in new[] { Point(a, -1), Point(a, 1), Point(b, 1), Point(a, -1), Point(b, 1), Point(b, -1) })
                { st.SetNormal(Vector3.Up); st.SetUV(new Vector2(p.X,p.Z)); st.AddVertex(p); }
            }
            var m = (ShaderMaterial)RuienMaterials.Get("ruien_misc_water").Duplicate();
            m.SetShaderParameter("outfall", 1f);
            m.SetShaderParameter("outfall_origin", gate.Origin);
            m.SetShaderParameter("outfall_direction", gate.Normal);
            m.SetShaderParameter("flow", gate.Normal * 0.18f);
            var sheet = new MeshInstance3D { Name = "outflow_" + gate.Id, Mesh = st.Commit(), MaterialOverride = m, Layers = Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
            root.AddChild(sheet);
            d.Outflows.Add((sheet,m,gate));
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
    public float CoverAt(Vector3 p) => Math.Max(Cover.At(p.X, p.Z) * (1 - Mathf.SmoothStep(-0.7f, -0.05f, p.Y)), Cover.Closed(p.X, p.Y, p.Z));

    /// <summary>The same footprint and level as the drawn water, including the gate's sloping outflow.</summary>
    private static Rect2 SheetBounds(Vector2[] pts, float grow)
    {
        if (pts.Length == 0) return new Rect2();
        var r = new Rect2(pts[0], Vector2.Zero);
        foreach (var q in pts) r = r.Expand(q);
        return r.Grow(grow);
    }

    public float? WaterAt(float x, float z)
    {
        var p = new Vector2(x, z);
        foreach (var d in drawn)
        {
            var box=d.Area.Box.Grow(2);
            if(x<box.Position.X || x>box.End.X || z<box.Position.Z || z>box.End.Z)continue;
            foreach (var g in d.Area.Gates)
            {
                var rel = p - g.Origin;
                float u = rel.Dot(g.Normal);
                if (u >= -1.6f && u <= 2f && MathF.Abs(rel.Cross(g.Normal)) < g.WaterWidth(u)/2)
                    return Mathf.Lerp(d.Level, Math.Min(d.Level, Math.Max(Tide.River, g.Sill + 0.015f)), Mathf.SmoothStep(-1.6f, 2, u));
            }
            foreach (var w in d.Area.Water)
            {
                var line = w.Line.Length >= 2 ? w.Line : d.Area.Zones.FirstOrDefault(q => q.Id == w.Zone)?.Path;
                var section=d.Area.Line(w.Zone)?.S;
                float half=(w.Width>0?w.Width:section?.Channel??3)/2;
                // (each sheet's own bounds first: the streets over a rui ask this for every walker, gull and cart)
                w.Bounds ??= SheetBounds(w.Outline.Length >= 3 ? w.Outline : line ?? Array.Empty<Vector2>(), half + Math.Abs(((section?.ChannelLow??0)+(section?.ChannelHigh??0))/2) + 0.1f);
                if (!w.Bounds.Value.HasPoint(p)) continue;
                if (w.Outline.Length >= 3 && Geometry2D.IsPointInPolygon(p, w.Outline)) return d.Level;
                if (line == null) continue;
                float centre=w.Line.Length>=2?0:((section?.ChannelLow??-half)+(section?.ChannelHigh??half))/2;
                for (int i = 0; i + 1 < line.Length; i++)
                {
                    var ab = line[i + 1] - line[i];
                    float t = (p - line[i]).Dot(ab) / Math.Max(ab.LengthSquared(), 1e-6f);
                    if (t >= 0 && t <= 1 && MathF.Abs((p-line[i]).Dot(new Vector2(ab.Y,-ab.X).Normalized())-centre) < half) return d.Level;
                }
            }
        }
        return null;
    }

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
        // which areas the eye calls for: underground in an area's box its whole group shows (a room and the ruien built
        // from its mouths are seen from one another); before a gate or at a street opening only that area itself
        groupShown.Clear();
        foreach (var d in drawn)
        {
            var a = d.Area;
            d.InBox = a.Box.Grow(2).HasPoint(eye);
            d.AtGate = a.Gates.Any(g => { var rel = new Vector2(eye.X, eye.Z) - g.Origin; return rel.Dot(g.Normal) > -1 && rel.Length() < 90 && eye.Y < 6; });
            d.AtOpening = a.Sources.Any(s => s.Kind != "lamp" && s.Power>0 && new Vector2(eye.X - s.At.X, eye.Z - s.At.Z).Length() < 14 && eye.Y > -1.5f);
            if (d.InBox && eye.Y < 0.5f) groupShown.Add(a.Group);
        }
        foreach (var d in drawn)
        {
            var a = d.Area;
            bool inBox = d.InBox, atGate = d.AtGate;
            bool show = Main.I.Flag("ruien-always") || groupShown.Contains(a.Group) || atGate || d.AtOpening;
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
            foreach (var (mesh, material, gate) in d.Outflows)
            {
                mesh.Position = new Vector3(0, d.Level, 0);
                float drop = Math.Min(d.Level, Math.Max(river, gate.Sill + 0.015f)) - d.Level;
                material.SetShaderParameter("outfall_drop", drop);
            }
            foreach (var (mesh, material, box) in d.Mists)
            {
                float rise = d.Level - a.WaterMin;
                var lo = new Vector3(box.Min.X, d.Level + 0.015f, box.Min.Z);
                var hi = new Vector3(box.Max.X, Math.Min(a.Zones.Min(z => z.S.LedgeY) - 0.15f, box.Max.Y + rise), box.Max.Z);
                material.SetShaderParameter("box_min", lo); material.SetShaderParameter("box_max", hi);
                mesh.Position = (lo + hi) / 2;
                ((BoxMesh)mesh.Mesh).Size = hi - lo + Vector3.One * 0.02f;
            }
            // the tide doors: the rising river pushes them shut; they swing open (about a minute) once it falls below
            // the water inside, and the trapped water runs out
            bool open = river < d.Level - 0.02f;
            foreach (var (mv, meshes, body, f) in d.Doors)
            {
                float want = open ? 1 : 0;
                // (a held tide, the dev kit's or a test picture's, puts them where it says at once)
                float now = f[0] < 0 || dt <= 0 || Tide.Held != null ? want : Mathf.MoveToward(f[0], want, dt / 60f);
                if (now == f[0]) continue;
                f[0] = now;
                var b = new Basis(Vector3.Up, Mathf.DegToRad(mv.OpenDeg * Mathf.SmoothStep(0, 1, now)));
                var xf = new Transform3D(b, mv.Pivot - b * mv.Pivot);
                foreach (var mi in meshes) mi.Transform = xf;
                if (body != null) body.Transform = xf;
            }
        }
        if (lodT <= 0) lodT = 0.25f;
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
        return s.Power * m * RuienHatch.Light(s.Id) * RuienEntranceDoor.Light(s.Id);
    }

    private void SendLights(Vector3 eye, Daylight day)
    {
        nearest.Clear();
        bool any = drawn.Any(d => d.Shown) || entranceDoors.Any(e => new Vector2(eye.X - e.X, eye.Z - e.Y).Length() < 30);
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
