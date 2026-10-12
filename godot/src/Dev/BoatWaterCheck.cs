using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>
/// W1 (docs/plans/next-update.md, section 4): the boat-water check, the browser's dev/boatWaterCheck.ts.
///   -- --boatcheck dir [--boatcheck-seconds 60] [--boatcheck-levels -5.2,-0.4] [--boatcheck-eye x,y,z]
/// Every vessel drawn (the bake's single ships, the moored rows and the small boats, the river traffic, the
/// anchorage and its tows, the lock's boats, the ferry and the landing stage) at the levels -5.20, -4.95, -4.40,
/// -2.80, -0.65, -0.40 and the storm's top -0.50, each held (Tide.Hold) until the drawn sheet stands there, then
/// run for the seconds given (the game at four times its speed), sampled every half second. Per hull, measured on
/// the drawn meshes: her bottom against the baked tide mud (the canal and vliet beds, the bank at each wall's
/// foot), her waterline against the water where she lies (within 5 cm, the mean of the run), her water cap. Also
/// the drawn sheet against the boats while it eases after a jump (case 8) and the great storm's surge (case 9).
/// Writes dir/boatcheck.json; `problems` must be empty (ok). Then quits.
/// </summary>
[GamePart(985)]
public partial class BoatWaterCheck : Node
{
    private static readonly (float Y, string Name)[] AllLevels =
    {
        (-5.2f, "spring low water"), (-4.95f, "mean low water"), (-4.4f, "the brig's floor"), (-2.8f, "half tide"),
        (-0.65f, "mean high water"), (-0.4f, "spring high water"), (-0.5f, "the great storm's top"),
    };
    private const float Afloat = 0.05f, MudIn = 0.06f, Holds = 0.06f, Cell = 0.25f, CanalBed = -5.05f;
    private const float StormSurgeTop = Tide.HwMax - 0.1f; // the browser's rijnkaai.ts STORM_SURGE_TOP

    private string dir = "";
    private readonly List<(float Y, string Name)> levels = new();
    private float seconds = 60;
    private int phase, level;
    private double t, sampleT, geoT, waited;
    private ulong frames;
    private readonly Dictionary<long, (float Y, bool Bed)> mud = new();
    private float bedLo = float.MaxValue, bedHi = float.MinValue;
    private readonly Dictionary<string, Stat> stats = new();
    private readonly List<object> levelReports = new();
    private readonly List<string> problems = new(), notes = new(), noCap = new();
    private readonly Dictionary<string, int> cases = new();
    private readonly HashSet<string> capsSeen = new();
    private float jumpFrom = float.NaN, jumpMax;
    private string weatherWas = "clear";
    private double jumpOff;
    private Task? clockJump;
    private float clockError;
    private int clockFrames;

    private sealed class Stat
    {
        public string Name = "", Kind = "", Source = "";
        public bool Moving, Far;
        public float X, Z, Level, Sum, Min = float.MaxValue, Max = float.MinValue, Pen = float.NegativeInfinity, Clear = float.PositiveInfinity, MudY = float.NaN;
        public string Over = "";
        public float? Floor;
        public int N, Region;
    }

    private sealed class Vessel
    {
        public string Key = "", Name = "", Kind = "", Source = "";
        public bool Moving, CapHidden, HasCap;
        public float X, Y, Z;
        public float? Floor;
        public readonly List<(Vector3[] Pts, Transform3D M)> Hull = new();
    }

    public override void _Ready()
    {
        if (!Main.I.Flag("boatcheck"))
        {
            SetProcess(false);
            return;
        }
        dir = Paths.TestOutput("boatcheck");
        if (dir == "" || dir.StartsWith("--")) dir = ProjectSettings.GlobalizePath("res://baked/checks/boatcheck");
        Directory.CreateDirectory(dir);
        if (float.TryParse(Main.I.Arg("boatcheck-seconds"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float s) && s > 0) seconds = s;
        var only = Main.I.Arg("boatcheck-levels");
        foreach (var l in AllLevels)
            if (only == "" || only.Split(',').Any(o => float.TryParse(o, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float y) && MathF.Abs(y - l.Y) < 1e-4f)) levels.Add(l);
        if (levels.Count == 0) throw new ArgumentException("--boatcheck-levels: none of " + string.Join(", ", AllLevels.Select(l => l.Y)));
        ProcessPriority = 1000; // after the boats and their owners have placed theirs
        weatherWas = Main.I.Arg("weather", "clear");
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        Engine.MaxFps = 0;
    }

    private string Tag(int c, string p)
    {
        cases[c.ToString()] = cases.GetValueOrDefault(c.ToString()) + 1;
        return c > 0 ? $"[case {c}] {p}" : p;
    }

    public override void _Process(double delta)
    {
        // (the report's numbers with a point, whatever the PC's own language writes)
        var culture = System.Globalization.CultureInfo.CurrentCulture;
        System.Globalization.CultureInfo.CurrentCulture = System.Globalization.CultureInfo.InvariantCulture;
        try { Step(delta); }
        finally { System.Globalization.CultureInfo.CurrentCulture = culture; }
    }

    private void Step(double delta)
    {
        frames++;
        t += delta;
        switch (phase)
        {
            case 0: // the town comes in: the loading screen, the bake's groups
                if (frames < 400 || Boats.I == null) return;
                Mud();
                // (--boatcheck-eye x,y,z: the camera there; the boats far from it are written less often, Movers/Boats.cs)
                if (Main.I.Arg("boatcheck-eye") is { Length: > 0 } eye && Main.I.Cam is { } cam0)
                {
                    var e = eye.Split(',').Select(v => float.Parse(v, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                    if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
                    Main.I.Cam.GlobalPosition = new Vector3(e[0], e[1], e[2]);
                }
                Engine.TimeScale = 4;
                phase = 1;
                StartLevel();
                return;
            case 1: // the sheet and hulls share the eased level (case 8)
            {
                float gap = Boats.I.WaterlineError();
                if (!float.IsNaN(jumpFrom))
                {
                    jumpMax = MathF.Max(jumpMax, gap);
                    if (gap > Afloat) jumpOff += delta;
                }
                waited += delta;
                if (MathF.Abs(Tide.River - Tide.Target) > 0.004f && waited < 40) return;
                if (!float.IsNaN(jumpFrom) && jumpMax > Afloat)
                    problems.Add(Tag(8, $"the river held from {jumpFrom:0.00} to {levels[level].Y:0.00}: a hull disagreed with the shared eased sheet (World/Tide.cs): for {jumpOff:0.0} s they floated off it, by up to {jumpMax:0.00} m"));
                phase = 2;
                t = 0;
                sampleT = 0;
                geoT = 0;
                stats.Clear();
                return;
            }
            case 2: // the run at this level
                if (t < sampleT) return;
                sampleT += 0.5;
                bool geo = t >= geoT || t >= seconds;
                if (geo) geoT += 10;
                Look(geo);
                if (t < seconds) return;
                EndLevel();
                level++;
                if (level < levels.Count)
                {
                    StartLevel();
                    phase = 1;
                }
                else
                {
                    phase = 3;
                    t = 0;
                    Tide.Hold(null);
                    Tide.Set(Movers.MoverClock.Day, (float)Movers.MoverClock.HourF);
                    Daylight.I.SetWeather("storm");
                    Daylight.I.StormHold = 1;
                    Daylight.I.SetStorm(1);
                }
                return;
            case 3: // the great storm at full strength, the tide by the clock (case 9)
                if (t < 20) return;
                Storm();
                if (Main.I.Flag("boatcheck-clock-jump"))
                {
                    clockJump = ClockJump();
                    phase = 5;
                    return;
                }
                Write();
                phase = 4;
                return;
            case 5:
                if(clockJump is not { IsCompleted: true }) return;
                if(clockJump.IsFaulted) problems.Add(Tag(8, "skip 120 failed: " + clockJump.Exception?.GetBaseException().Message));
                phase=6;t=0;return;
            case 6:
                clockFrames++;
                clockError=MathF.Max(clockError,Boats.I.WaterlineError());
                if(t<12) return;
                notes.Add($"skip 120: {clockFrames} frames, maximum hull/sheet error {clockError:0.000} m (normal heave removed)");
                if(clockError>Afloat) problems.Add(Tag(8,$"skip 120: a boat was {clockError:0.000} m off the drawn sheet"));
                Write();phase=4;return;
        }
    }

    private async Task ClockJump()
    {
        Engine.TimeScale=1;
        Tide.Hold(null);
        await Kit.I.Commands("hour 13 clear");
        await ToSignal(GetTree().CreateTimer(8), SceneTreeTimer.SignalName.Timeout);
        await Kit.I.Commands("skip 120");
        notes.Add($"clock after skip 120: day {Game.GameState.I.Day}, hour {Game.GameState.I.HourF:0.00}");
    }

    private void StartLevel()
    {
        var (y, name) = levels[level];
        jumpFrom = level == 0 ? float.NaN : Tide.River;
        jumpMax = 0;
        jumpOff = 0;
        waited = 0;
        Tide.Hold(y);
        // (the storm's top: the great storm's look, its waves; the boats' sea follows the server's weather)
        bool storm = name.Contains("storm");
        Daylight.I.SetWeather(storm ? "storm" : weatherWas);
        Daylight.I.StormHold = storm ? 1 : null;
        Daylight.I.SetStorm(storm ? 1 : 0);
    }

    // ---- the mud: the baked tide_mud mesh(es) in 25 cm cells, the highest in each, and whether it is a bed
    private static long Key(float x, float z) => ((long)MathF.Floor(x / Cell) + 100000) * 1000000 + (long)MathF.Floor(z / Cell) + 100000;
    private static readonly (float X0, float X1, float Z0, float Z1)[] Beds = { (-82, -70, 0.5f, 205), (-150, -142, 0.5f, 72) };
    private static bool OnBedGrid(Vector3 p) => Beds.Any(b => p.X >= b.X0 - 0.01f && p.X <= b.X1 + 0.01f && p.Z >= b.Z0 - 0.01f && p.Z <= b.Z1 + 0.01f);
    private static bool InCanal(float x, float z) => Beds.Any(b => x > b.X0 - 1 && x < b.X1 + 1 && z > b.Z0 - 1 && z < b.Z1 + 1);

    private void Mud()
    {
        int meshes = 0;
        foreach (var n in BakedWorld.All(Main.I.World))
        {
            if (n is not MeshInstance3D { Mesh: not null } mi || !mi.Name.ToString().StartsWith("tide_mud")) continue;
            meshes++;
            var xf = mi.GlobalTransform;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                var arr = mi.Mesh.SurfaceGetArrays(s);
                var v = arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var idx = arr[(int)Mesh.ArrayType.Index].AsInt32Array();
                int count = idx.Length > 0 ? idx.Length : v.Length;
                for (int k = 0; k + 2 < count; k += 3)
                {
                    Vector3 a = xf * v[idx.Length > 0 ? idx[k] : k], b = xf * v[idx.Length > 0 ? idx[k + 1] : k + 1], c = xf * v[idx.Length > 0 ? idx[k + 2] : k + 2];
                    bool bed = OnBedGrid(a) && OnBedGrid(b) && OnBedGrid(c);
                    float d = (b.Z - c.Z) * (a.X - c.X) + (c.X - b.X) * (a.Z - c.Z);
                    if (MathF.Abs(d) < 1e-9f) continue;
                    int i0 = (int)MathF.Floor(MathF.Min(a.X, MathF.Min(b.X, c.X)) / Cell), i1 = (int)MathF.Floor(MathF.Max(a.X, MathF.Max(b.X, c.X)) / Cell);
                    int j0 = (int)MathF.Floor(MathF.Min(a.Z, MathF.Min(b.Z, c.Z)) / Cell), j1 = (int)MathF.Floor(MathF.Max(a.Z, MathF.Max(b.Z, c.Z)) / Cell);
                    for (int i = i0; i <= i1; i++)
                        for (int j = j0; j <= j1; j++)
                        {
                            float px = (i + 0.5f) * Cell, pz = (j + 0.5f) * Cell;
                            float l1 = ((b.Z - c.Z) * (px - c.X) + (c.X - b.X) * (pz - c.Z)) / d;
                            float l2 = ((c.Z - a.Z) * (px - c.X) + (a.X - c.X) * (pz - c.Z)) / d;
                            float l3 = 1 - l1 - l2;
                            if (l1 < -1e-4f || l2 < -1e-4f || l3 < -1e-4f) continue;
                            float y = l1 * a.Y + l2 * b.Y + l3 * c.Y;
                            long key = Key(px, pz);
                            if (!mud.TryGetValue(key, out var o) || y > o.Y) mud[key] = (y, bed);
                        }
                }
            }
        }
        foreach (var (y, bed) in mud.Values)
            if (bed) { bedLo = MathF.Min(bedLo, y); bedHi = MathF.Max(bedHi, y); }
        if (meshes == 0) problems.Add("no tide_mud mesh in the bake: the keels are not checked against the mud");
        notes.Add($"tide mud: {meshes} meshes, {mud.Count} cells of {Cell} m; the drawn canal and vliet beds lie from {bedLo:0.00} to {bedHi:0.00} (CANAL_BED {CanalBed})");
    }

    // ---- the vessels drawn now
    private readonly Dictionary<Mesh, Vector3[]> points = new();
    private Vector3[] Points(Mesh m)
    {
        if (points.TryGetValue(m, out var p)) return p;
        var seen = new HashSet<(int, int, int)>();
        var list = new List<Vector3>();
        for (int s = 0; s < m.GetSurfaceCount(); s++)
        {
            if (m.SurfaceGetMaterial(s)?.ResourceName == "cap") continue;
            foreach (var v in m.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array())
                if (seen.Add(((int)MathF.Round(v.X * 10), (int)MathF.Round(v.Y * 10), (int)MathF.Round(v.Z * 10)))) list.Add(v);
        }
        return points[m] = list.ToArray();
    }
    private static bool IsCap(MeshInstance3D mi) => mi.Name.ToString().EndsWith("_cap") || mi.Mesh is { } m && m.GetSurfaceCount() == 1 && m.SurfaceGetMaterial(0)?.ResourceName == "cap";

    private static string SourceOf(Node n)
    {
        for (var p = n.GetParent(); p != null; p = p.GetParent())
        {
            string name = Mv.Plain(p);
            if (name == "river_traffic") return "river";
            if (name.StartsWith("anchorage")) return "anchorage";
            if (name == "lock") return "lock";
            if (name == "opening_bridges") return "bridge";
        }
        return "still";
    }

    private readonly Dictionary<string, bool> rowCaps = new();
    private Dictionary<string, List<Mesh>>? rowMeshes;
    private List<Mesh> RowMeshes(string kind)
    {
        if (rowMeshes == null)
        {
            rowMeshes = new();
            var re = new System.Text.RegularExpressions.Regex("^INST\\d+_(.+?)(moored|small)_mm$");
            foreach (var top in Mv.Town.GetChildren())
            {
                string tn = Mv.Plain(top);
                if (tn is not ("moored" or "small_boats")) continue;
                foreach (var c in top.GetChildren())
                    if (c is MultiMeshInstance3D { Multimesh.Mesh: not null } mmi && re.Match(mmi.Name.ToString()) is { Success: true } m)
                    {
                        var mesh = mmi.Multimesh.Mesh;
                        if (mesh.GetSurfaceCount() == 1 && mesh.SurfaceGetMaterial(0)?.ResourceName == "cap")
                        { rowCaps[m.Groups[1].Value] = mmi.IsVisibleInTree(); continue; }
                        string k = m.Groups[1].Value;
                        if (!rowMeshes.TryGetValue(k, out var l)) rowMeshes[k] = l = new();
                        if (!l.Contains(mesh)) l.Add(mesh);
                    }
            }
        }
        return rowMeshes.GetValueOrDefault(kind.Replace("_", "")) ?? new List<Mesh>();
    }

    private List<Vessel> Vessels()
    {
        var list = new List<Vessel>();
        foreach (var f in Boats.I.Floats)
        {
            if (!IsInstanceValid(f.Outer) || !f.Outer.IsVisibleInTree() || f.Kind is "portal_crane" or "hand_crane") continue;
            var o = f.Outer.GlobalPosition;
            string source = SourceOf(f.Outer);
            var v = new Vessel { Key = f.Outer.GetInstanceId().ToString(), Kind = f.Kind, Source = source, Moving = source != "still", X = o.X, Y = o.Y, Z = o.Z, Floor = float.IsNaN(f.Floor) ? null : f.Floor };
            v.Name = $"{f.Kind} at ({o.X:0.0}, {o.Z:0.0})";
            Meshes(f.Inner, v);
            list.Add(v);
        }
        int n = 0;
        foreach (var (kind, world) in Boats.I.MooredFrames())
        {
            var w = world();
            n++;
            if (MathF.Abs(w.Basis.Determinant()) < 1e-9f) continue; // a small boat taken from her mooring
            var v = new Vessel { Key = "row" + n, Kind = kind, Source = "moored", X = w.Origin.X, Y = w.Origin.Y, Z = w.Origin.Z };
            v.Name = $"{kind} moored at ({w.Origin.X:0.0}, {w.Origin.Z:0.0})";
            foreach (var m in RowMeshes(kind)) v.Hull.Add((Points(m), w));
            v.HasCap = rowCaps.ContainsKey(kind.Replace("_", ""));
            v.CapHidden = !rowCaps.GetValueOrDefault(kind.Replace("_", "")); // (the bake's cap rows are hidden: Movers/Boats.cs)
            list.Add(v);
        }
        foreach (var c in Main.I.View.GetChildren())
            if (c is Node3D n3 && n3.IsVisibleInTree() && n3.Name.ToString() is "ferry" or "landing_stage")
            {
                var o = n3.GlobalPosition;
                var v = new Vessel { Key = n3.GetInstanceId().ToString(), Kind = n3.Name.ToString(), Source = n3.Name.ToString() == "ferry" ? "ferry" : "stage", X = o.X, Y = o.Y, Z = o.Z };
                v.Name = $"{v.Kind} at ({o.X:0.0}, {o.Z:0.0})";
                Meshes(n3, v);
                list.Add(v);
            }
        return list;
    }

    private void Meshes(Node root, Vessel v)
    {
        foreach (var n in BakedWorld.All(root))
            if (n is MeshInstance3D { Mesh: not null } mi)
            {
                if (IsCap(mi))
                {
                    v.HasCap = true;
                    if (!mi.IsVisibleInTree()) v.CapHidden = true;
                    continue;
                }
                if (mi.IsVisibleInTree()) v.Hull.Add((Points(mi.Mesh), mi.GlobalTransform));
            }
    }

    private (float Pen, float Clear, string Over, float MudY) Measure(Vessel v)
    {
        float pen = float.NegativeInfinity, clear = float.PositiveInfinity, mudY = float.NaN;
        string over = "";
        foreach (var (pts, m) in v.Hull)
            foreach (var p0 in pts)
            {
                var p = m * p0;
                if (p.Y > v.Y + 0.1f) continue;
                if (!mud.TryGetValue(Key(p.X, p.Z), out var g)) continue;
                float d = g.Y - p.Y;
                if (d > pen) { pen = d; over = g.Bed ? "bed" : "toe"; mudY = g.Y; }
                clear = MathF.Min(clear, -d);
            }
        return (pen, clear, over, mudY);
    }

    private void Look(bool geo)
    {
        foreach (var v in Vessels())
        {
            float lv = Tide.LevelAt(v.X, v.Z);
            // (what the eye sees: the river's drawn sheet, World/Waters.cs; the dock's and the chamber's are their levels)
            float shown = Tide.RegionAt(v.X, v.Z) == 0 ? Waters.Level : lv;
            if (!stats.TryGetValue(v.Key, out var s)) stats[v.Key] = s = new Stat { Region = Tide.RegionAt(v.X, v.Z) };
            s.Far = Main.I.Cam is { } cam && new Vector2(v.X - cam.GlobalPosition.X, v.Z - cam.GlobalPosition.Z).Length() > 140;
            s.Name = v.Name; s.Kind = v.Kind; s.Source = v.Source; s.Moving = v.Moving; s.X = v.X; s.Z = v.Z; s.Level = shown; s.Floor = v.Floor;
            float dy = v.Y - shown;
            s.N++; s.Sum += dy; s.Min = MathF.Min(s.Min, dy); s.Max = MathF.Max(s.Max, dy);
            if (geo || v.Moving)
            {
                var m = Measure(v);
                if (m.Pen > s.Pen) { s.Pen = m.Pen; s.Over = m.Over; s.MudY = m.MudY; }
                s.Clear = MathF.Min(s.Clear, m.Clear);
            }
            string capKey = v.Kind + ":" + v.Source;
            if (v.Hull.Count > 0 && capsSeen.Add(capKey) && v.Kind is not ("landing_stage" or "pontoon_section"))
            {
                if (!v.HasCap && v.Source != "moored") noCap.Add($"{v.Kind} ({v.Source}): no water cap in her model");
                else if (v.CapHidden) noCap.Add($"{v.Kind} ({v.Source}): her water cap is hidden (Movers/Boats.cs): the river shows inside her");
            }
        }
    }

    private (int C, string Hint) CaseOf(Stat s)
    {
        if (s.Region == 2) return (4, "");
        if (s.Moving && s.Over == "toe" && MathF.Abs(s.Z) < 8) return (1, " (a tow walked in against the wall)");
        if (s.Moving) return (10, "");
        if ((s.Over != "" || s.Floor != null) && InCanal(s.X, s.Z)) return (7, "");
        if (s.Floor is { } f && float.IsFinite(f)) return (0, $" (new: her own floor {f:0.00} has no drawn bed under it)");
        if (s.Over == "toe") return (1, "");
        return (0, "");
    }

    private void EndLevel()
    {
        var (y, name) = levels[level];
        var list = new List<string>();
        int afloat = 0, aground = 0, moving = 0, frozen = 0;
        string frozenAt = "";
        foreach (var s in stats.Values)
        {
            float mean = s.Sum / Math.Max(1, s.N);
            bool rests = s.Pen > -Holds && !float.IsNegativeInfinity(s.Pen);
            if (rests) aground++; else afloat++;
            if (s.Moving) moving++;
            var (c, hint) = CaseOf(s);
            string where = s.Name + (s.Moving ? $" ({s.Source}, moving)" : s.Source is "still" or "moored" ? "" : $" ({s.Source})");
            void Say(string p) => list.Add(Tag(c, p + hint));
            // a moored boat far from the camera that never moved in the whole run: not written (Movers/Boats.cs)
            bool still = !rests && s.Source == "moored" && s.Far && s.N > 4 && s.Max - s.Min < 0.002f && MathF.Abs(mean) > Afloat;
            if (still)
            {
                frozen++;
                if (frozenAt.Length < 400) frozenAt += $"{(frozenAt == "" ? "" : "; ")}{s.Name} at y {s.Level + mean:0.00}";
            }
            if (s.Pen > MudIn && !still) Say($"{where}: her bottom is {s.Pen:0.00} m in the {(s.Over == "bed" ? "canal bed's" : "wall's bank of")} mud (her waterline {s.Level + mean:0.00}, the water {s.Level:0.00}, the mud {s.MudY:0.00})");
            else if (mean > Afloat && !rests && !still) Say($"{where}: she floats {mean:0.00} m over the water (waterline {s.Level + mean:0.00}, the water {s.Level:0.00}) with nothing under her keel to hold her up{(float.IsFinite(s.Clear) ? $" (the mud is {s.Clear:0.00} m under her)" : "")}");
            if (mean < -Afloat && !still) Say($"{where}: she lies {-mean:0.00} m under the water (waterline {s.Level + mean:0.00}, the water {s.Level:0.00})");
        }
        if (frozen > 0)
            list.Add(Tag(0, $"{frozen} moored boats more than 140 m from the camera never moved in the {seconds:0} s and keep an old tide ({frozenAt}): a far row is written every 8th frame and in it only the boats whose number shares that turn, so the others are never written (Movers/Boats.cs _Process and Write: (frame + row) % 8 and (frame + boat) % 8)"));
        foreach (var p in list) problems.Add($"{y:0.00} ({name}): {p}");
        if (Main.I.Cam is { } cam) notes.Add($"{y:0.00}: the camera at ({cam.GlobalPosition.X:0.0}, {cam.GlobalPosition.Y:0.0}, {cam.GlobalPosition.Z:0.0})");
        // case 10: how near the moving ships' keels come to the mud
        var near = stats.Values.Where(s => s.Moving && float.IsFinite(s.Clear)).OrderBy(s => s.Clear).FirstOrDefault();
        notes.Add($"{y:0.00}: {moving} moving hulls; {(near != null ? $"the nearest to the mud: {near.Name} ({near.Source}), {near.Clear:0.00} m over it" : "none came over the mud")}");
        levelReports.Add(new { level = y, name, hulls = stats.Count, afloat, aground, moving, problems = list });
    }

    private void Storm()
    {
        // the browser (rijnkaai.ts tideTarget): the great storm drives the river up to a metre over the tide, never over the top
        float tide = Tide.At(Movers.MoverClock.Day, (float)Movers.MoverClock.HourF), storm = Daylight.I.Storm;
        float browser = MathF.Max(tide, MathF.Min(tide + 1.0f * storm, StormSurgeTop));
        if (MathF.Abs(browser - Tide.River) > 0.05f)
            problems.Add(Tag(9, $"the great storm at strength {storm:0.00}, day {Movers.MoverClock.Day} {Movers.MoverClock.HourF:0.00} h (the tide {tide:0.00}): the browser's river stands at {browser:0.00} (a metre of surge, up to {StormSurgeTop:0.00}), Godot's at {Tide.River:0.00} (the drawn water {Waters.Level:0.00}): Godot has no storm surge"));
        else notes.Add($"the great storm: the river at {Tide.River:0.00}, as the browser's {browser:0.00}");
        Daylight.I.StormHold = null;
        Daylight.I.SetStorm(0);
        Daylight.I.SetWeather(weatherWas);
    }

    private void Write()
    {
        // Sculpted channels and pools deliberately differ from CanalBed. Hull
        // penetration above is the check that their actual support agrees.
        problems.AddRange(noCap);
        var report = new
        {
            ok = problems.Count == 0,
            seconds,
            levels = levelReports,
            cases,
            noCap,
            notes,
            problems,
            notCovered = new[]
            {
                "the boats' sea follows the server's weather (Movers/MoverClock.cs Sea): the storm's top is run with the storm's look, not its waves",
                "the moored rows' hulls are their kind's meshes in the row's frame (part offsets left out)",
                "the hulls against the quay walls and each other, the lines to their rings, the browser's probes (ladder, drift, cranes, build-time heights)",
                "the river's waves: the waterline is the mean over the run",
            },
        };
        File.WriteAllText(Path.Combine(dir, "boatcheck.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"boatcheck: {problems.Count} problems, cases {string.Join(", ", cases.Select(k => $"{k.Key}: {k.Value}"))}; {Path.Combine(dir, "boatcheck.json")}");
        Engine.TimeScale = 1;
        Tide.Hold(null);
        GetTree().Quit();
    }
}
