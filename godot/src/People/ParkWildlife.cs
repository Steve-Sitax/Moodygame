using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>The park and docks' wildlife (world/parkWildlife.ts, shared/parkWildlife.ts).
/// Each kind shares one MultiMesh, capped at 96. Far animals take one step a second.
/// Birds first move away from people, then fly when pressed; broods retreat on the water.
/// The habitat and oak perches come from the browser's files, without baking the town again.</summary>
[GamePart(207)]
public partial class ParkWildlife : Node
{
    public sealed class Beast
    {
        public int Id, Home, Branch;
        public int? Parent;
        public string Species = "duck", Mode = "swim";
        public bool Female, Young;
        public double X, Z, Y = -0.34, Yaw, Timer, Phase, Alarm, Flight, Duration, TargetY;
        public Vector3 Start;
        public Pt Target;
    }
    private record Home(double X, double Z, double R, string Kind);
    private record Tree(double X, double Z, string Kind, double Scale, double Yaw);
    public static ParkWildlife? I { get; private set; }
    public readonly List<Beast> List = new();
    public IEnumerable<Node3D> Groups => meshes.Values;
    public Func<IEnumerable<Pt>> Boats = () => Array.Empty<Pt>();
    public double LogicMs { get; private set; }
    public int Shown { get; private set; }
    private readonly List<Home> homes = new();
    private readonly List<Tree> trees = new();
    private readonly HashSet<long> land = new();
    private readonly Dictionary<string, MultiMeshInstance3D> meshes = new();
    private readonly Dictionary<int, double> watched = new();
    private readonly List<(Pt point, double until)> food = new();
    private Vector3[] perches = Array.Empty<Vector3>();
    private double trunkRadius, climbHeight, clock, coarse;
    private int parkHomes;
    private uint seed = 1873;
    private Townspeople? town;
    private Node3D root = new() { Name = "live_park_wildlife" };
    private double Random() { seed = unchecked(seed * 1664525 + 1013904223); return seed / 4294967296.0; }
    private static double Distance(double ax, double az, double bx, double bz) => Whereabouts.Hypot(ax - bx, az - bz);
    private static long Cell(int x, int z) => ((long)x << 32) | (uint)z;
    private bool OnLand(double x, double z) => land.Contains(Cell((int)Math.Floor(x * 4), (int)Math.Floor(z * 4)));
    public void Feed(double x, double z, double seconds = 16) => food.Add((new Pt(x, z), clock + seconds));
    public Pt? HuntTarget(double x, double z)
    {
        Pt? result = null; double best = 9;
        foreach (var a in List) if (a.Mode is "forage" or "feed" && a.Y < 0.5 && a.Species != "swan")
        { double d = Distance(a.X, a.Z, x, z); if (d < best) { best = d; result = new Pt(a.X, a.Z); } }
        return result;
    }

    public override void _Ready()
    {
        I = this;
        town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        string repo = Path.GetFullPath(Path.Combine(ProjectSettings.GlobalizePath("res://"), ".."));
        string file = Main.I.Arg("park-habitat", Path.Combine(repo, "client/public/models/park_plants.json"));
        if (town == null || !File.Exists(file)) { SetProcess(false); return; }
        using var d = JsonDocument.Parse(File.ReadAllText(file));
        var data = d.RootElement;
        foreach (var t in data.GetProperty("trees").EnumerateArray()) trees.Add(new Tree(t[0].GetDouble(), t[1].GetDouble(), t[2].GetString()!, t[3].GetDouble(), t[4].GetDouble()));
        foreach (var h in data.GetProperty("birds").EnumerateArray()) homes.Add(new Home(h[0].GetDouble(), h[1].GetDouble(), h[2].GetDouble(), h[3].GetString()!));
        parkHomes = homes.Count;
        foreach (string k in new[] { "lawn", "gravel", "mud" }) foreach (var tri in data.GetProperty("ground").GetProperty(k).EnumerateArray())
        {
            double ax = tri[0].GetDouble(), az = tri[1].GetDouble(), bx = tri[2].GetDouble(), bz = tri[3].GetDouble(), cx = tri[4].GetDouble(), cz = tri[5].GetDouble();
            for (int x = (int)Math.Floor(Math.Min(ax, Math.Min(bx, cx)) * 4); x <= Math.Ceiling(Math.Max(ax, Math.Max(bx, cx)) * 4); x++)
            for (int z = (int)Math.Floor(Math.Min(az, Math.Min(bz, cz)) * 4); z <= Math.Ceiling(Math.Max(az, Math.Max(bz, cz)) * 4); z++)
            {
                double px = (x + 0.5) / 4, pz = (z + 0.5) / 4;
                double Cross(double ux, double uz, double vx, double vz) => (px - vx) * (uz - vz) - (ux - vx) * (pz - vz);
                double a = Cross(ax, az, bx, bz), b = Cross(bx, bz, cx, cz), c = Cross(cx, cz, ax, az);
                if (!((a < 0 || b < 0 || c < 0) && (a > 0 || b > 0 || c > 0))) land.Add(Cell(x, z));
            }
        }
        using var oak = JsonDocument.Parse(File.ReadAllText(Path.Combine(repo, "shared/parkTreeLife.json")));
        var life = oak.RootElement.GetProperty("old_oak");
        trunkRadius = life.GetProperty("trunkRadius").GetDouble(); climbHeight = life.GetProperty("climbHeight").GetDouble();
        perches = life.GetProperty("perches").EnumerateArray().Select(p => new Vector3(p[0].GetSingle(), p[1].GetSingle(), p[2].GetSingle())).ToArray();
        // shared/parkWildlife.ts TOWN_WATERS; the generator keeps the numeric table in step.
        homes.AddRange(SharedWildlife.Waters.Select(h => new Home(h.x, h.z, h.radius, h.flock)));
        for (int h = 0; h < homes.Count; h++)
        {
            var home = homes[h];
            if (h >= parkHomes && home.Kind == "") continue;
            string species = home.Kind == "swan" ? "swan" : "duck";
            int mother = List.Count;
            for (int i = 0; i < (species == "swan" ? 3 : h < parkHomes ? 6 : 5); i++)
            {
                var a = Add(species, home.X + Math.Cos(i) * home.R * 0.45, home.Z + Math.Sin(i) * home.R * 0.45, h);
                a.Female = i == 0 || i == 2; a.Young = i > 2 || species == "swan" && i == 2; if (a.Young) a.Parent = mother;
            }
        }
        for (int i = 0; i < 6 && parkHomes > 0; i++) { var h = homes[i % parkHomes]; Add("goose", h.X + Math.Cos(i) * h.R * 0.6, h.Z + Math.Sin(i) * h.R * 0.6, i % parkHomes).Female = i % 2 == 0; }
        foreach (var t in trees.Where(t => t.Kind is not ("conifer" or "old_bare")).Where((t, i) => i % 4 == 0).Take(10))
        { var a = Add("squirrel", t.X + (t.Kind == "old_oak" ? 1.8 : 0.45), t.Z, trees.IndexOf(t)); a.Mode = "forage"; a.Y = 0.08; }
        int oldOak = trees.FindIndex(t => t.Kind == "old_oak");
        for (int i = 0; i < 6 && oldOak >= 0; i++) { var a = Add("songbird", 0, 0, oldOak); a.Branch = i; Put(a, BranchPoint(a)); a.Mode = "perch"; a.Timer = 3 + i * 3; }
        var model = ModelLibrary.Get("park_animals", new ModelLibrary.Look(Affine: 0, VertexColor: true));
        if (model == null) { SetProcess(false); return; }
        Main.I.View.AddChild(root);
        foreach (var (name, n) in model.Roots)
        {
            var source = n as MeshInstance3D ?? BakedWorld.All(n).OfType<MeshInstance3D>().FirstOrDefault();
            if (source?.Mesh == null) continue;
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = source.Mesh, InstanceCount = 96, VisibleInstanceCount = 0 };
            var inst = new MultiMeshInstance3D { Name = name, Multimesh = mm, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
            meshes[name] = inst;
            multiMeshes[name] = mm; root.AddChild(inst);
        }
        foreach (var n in BakedWorld.All(Main.I.World).OfType<Node3D>().Where(n => n.Name.ToString() == "park_wildlife")) n.Visible = false;
    }
    private Beast Add(string species, double x, double z, int home)
    {
        var a = new Beast { Id = List.Count, Species = species, X = x, Z = z, Home = home, Timer = 3 + Random() * 12, Phase = Random() * 6.28, Target = new Pt(x, z), Start = new Vector3((float)x, -0.34f, (float)z) };
        List.Add(a); return a;
    }
    private static void Put(Beast a, Vector3 p) { a.X = p.X; a.Y = p.Y; a.Z = p.Z; }
    private Vector3 BranchPoint(Beast a)
    {
        var t = trees[a.Home]; var p = perches[a.Branch % 6]; double c = Math.Cos(t.Yaw), s = Math.Sin(t.Yaw), start = 3.35 + a.Branch % 6 * 0.75;
        return new Vector3((float)(t.X + (p.X * c + p.Z * s) * t.Scale * 0.82), (float)((p.Y * 0.82 + start * 0.18 + 0.04) * t.Scale), (float)(t.Z + (-p.X * s + p.Z * c) * t.Scale * 0.82));
    }
    private void Go(Beast a, Pt p, double speed, double dt, bool onLand = false)
    {
        double d = Distance(a.X, a.Z, p.X, p.Z); if (d < 0.05) return;
        double f = Math.Min(1, speed * dt / d), x = a.X + (p.X - a.X) * f, z = a.Z + (p.Z - a.Z) * f;
        if (onLand && !OnLand(x, z)) { a.Timer = 0; return; }
        a.Yaw = Math.Atan2(-(p.Z - a.Z), p.X - a.X); a.X = x; a.Z = z;
    }
    private bool HasBrood(Beast a) { foreach (var b in List) if (b.Parent == a.Id && b.Mode != "caught") return true; return false; }
    private readonly List<Pt> people = new(64), cats = new(32), dogs = new(32), boats = new(32), threats = new(128);
    private readonly int[] freeBranches = new int[6];
    private readonly Dictionary<string, int> drawCounts = new();
    private readonly Dictionary<string, MultiMesh> multiMeshes = new();
    public long AllocatedBytesLastFrame { get; private set; }
    private static bool Near(List<Pt> points, Beast a, double radius) { foreach (var p in points) if (Distance(a.X, a.Z, p.X, p.Z) < radius) return true; return false; }
    private int Elsewhere(Beast a, bool away)
    {
        if (away) { int h = parkHomes + (int)(Random() * (homes.Count - parkHomes)); return h == a.Home ? parkHomes + (h - parkHomes + 1) % (homes.Count - parkHomes) : h; }
        return a.Home >= parkHomes || parkHomes < 2 ? (int)(Random() * Math.Max(1, parkHomes)) : (a.Home + 1) % parkHomes;
    }
    private void Fly(Beast a, int home, bool away)
    {
        var h = homes[home]; a.Start = new Vector3((float)a.X, (float)a.Y, (float)a.Z); a.Target = new Pt(h.X + Math.Cos(a.Phase) * h.R * 0.65, h.Z + Math.Sin(a.Phase) * h.R * 0.65); a.Home = home;
        double d = Distance(a.X, a.Z, a.Target.X, a.Target.Z); a.Duration = Math.Max(4, d / (a.Species == "swan" ? 6 : 8)) + (away || d > 60 ? 12 : 0); a.Flight = 0; a.Mode = "flight"; a.Timer = away ? 22 : 5;
    }
    public override void _Process(double delta)
    {
        if (town?.Data == null || town.Paused || meshes.Count == 0) return;
        long allocated = GC.GetAllocatedBytesForCurrentThread();
        ulong started = Time.GetTicksUsec();
        double dt = Math.Min(delta, 0.1); clock += dt; coarse += dt;
        var eye = Main.I.Cam.GlobalPosition;
        for (int i = food.Count - 1; i >= 0; i--) if (food[i].until < clock) food.RemoveAt(i);
        people.Clear(); cats.Clear(); dogs.Clear(); boats.Clear(); threats.Clear();
        for (int i = 0; i < town.Sims.Count; i++) if (town.Sims[i].P is { } p) people.Add(new Pt(p.X, p.Z));
        people.Add(new Pt(eye.X, eye.Z));
        Animals.I?.FillThreats(cats, dogs);
        foreach (var boat in Boats()) boats.Add(boat);
        threats.AddRange(people); threats.AddRange(dogs); threats.AddRange(cats);
        bool farTick = coarse >= 1;
        foreach (var a in List) { bool far = Distance(a.X, a.Z, eye.X, eye.Z) >= 160; if (!far || farTick) Step(a, far ? Math.Min(coarse, 5) : dt, people, cats, dogs, boats); }
        for (int i = 0; i < List.Count; i++)
        {
            var a = List[i];
            if (a.Species is "songbird" or "squirrel" || a.Mode == "flight" || Distance(a.X, a.Z, eye.X, eye.Z) > 160) continue;
            for (int j = i + 1; j < List.Count; j++)
            {
                var b = List[j];
                if (b.Species is "songbird" or "squirrel" || b.Mode == "flight") continue;
                double d = Distance(a.X, a.Z, b.X, b.Z), gap = (a.Species == "swan" ? 0.62 : 0.31) + (b.Species == "swan" ? 0.62 : 0.31);
                if (d >= gap) continue;
                double dx = d > 0.001 ? (a.X - b.X) / d : Math.Cos(i * 2.399), dz = d > 0.001 ? (a.Z - b.Z) / d : Math.Sin(i * 2.399), push = (gap - d) * Math.Min(0.45, dt * 2);
                for (int side = 0; side < 2; side++)
                {
                    var bird = side == 0 ? a : b; int sign = side == 0 ? 1 : -1;
                    double x = bird.X + dx * push * sign, z = bird.Z + dz * push * sign; var h = homes[bird.Home];
                    if (bird.Mode == "feed" || Distance(x, z, h.X, h.Z) < h.R * 0.92) { bird.X = x; bird.Z = z; }
                }
            }
        }
        if (farTick) coarse = 0;
        Draw(eye);
        AllocatedBytesLastFrame = GC.GetAllocatedBytesForCurrentThread() - allocated;
        LogicMs = (Time.GetTicksUsec() - started) / 1000.0;
    }
    private void Step(Beast a, double dt, List<Pt> people, List<Pt> cats, List<Pt> dogs, List<Pt> boats)
    {
        a.Timer -= dt;
        bool shelter = town!.StormLevel > 0.35 || town.Raining() || town.Hour < 6.5 || town.Hour > 19;
        if (a.Species is "songbird" or "squirrel") { TreeStep(a, dt, shelter, threats); return; }
        var h = homes[a.Home]; double water = a.Home < parkHomes ? -0.34 : Water.Level((float)h.X, (float)h.Z) + 0.01;
        if (a.Mode == "flight")
        {
            a.Flight += dt; double f = Math.Min(1, a.Flight / a.Duration), smooth = f * f * (3 - 2 * f);
            a.X = a.Start.X + (a.Target.X - a.Start.X) * smooth; a.Z = a.Start.Z + (a.Target.Z - a.Start.Z) * smooth; a.Y = a.Start.Y * (1 - f) + water * f + Math.Sin(Math.PI * f) * (a.Duration > 12 ? 42 : 4.5); a.Yaw = Math.Atan2(-(a.Target.Z - a.Start.Z), a.Target.X - a.Start.X);
            if (f == 1) { a.Mode = "swim"; a.Timer = 16 + Random() * 18; } return;
        }
        Pt? cat = null;
        foreach (var point in cats) if (Distance(a.X, a.Z, point.X, point.Z) < 5) { cat = point; break; }
        if (a.Young && cat != null && a.Parent is int parent && List[parent].Mode != "flight") { List[parent].Mode = "defend"; List[parent].Timer = 5; }
        if (a.Mode == "defend" && a.Timer > 0 && cat is { } c) { a.Yaw = Math.Atan2(-(c.Z - a.Z), c.X - a.X); return; }
        bool fear = cat is { } cp && Distance(a.X, a.Z, cp.X, cp.Z) < (a.Mode == "feed" ? 1.2 : 3) || Near(dogs, a, 4) || Near(boats, a, 7);
        var person = people[0];
        double nearest = Distance(a.X, a.Z, person.X, person.Z);
        foreach (var point in people) { double d = Distance(a.X, a.Z, point.X, point.Z); if (d < nearest) { nearest = d; person = point; } }
        double pd = nearest, wary = a.Species == "swan" ? 5 : a.Species == "goose" ? 6.5 : 6, close = a.Species == "swan" ? 2.4 : a.Species == "goose" ? 3.2 : 3;
        double last = watched.GetValueOrDefault(a.Id, pd); if (pd < wary) watched[a.Id] = pd; else watched.Remove(a.Id);
        bool pressed = pd < close && (pd < last - 0.002 || pd < close * 0.55);
        a.Alarm = fear || pressed ? a.Alarm + dt : Math.Max(0, a.Alarm - dt * 0.5);
        if (!shelter && (fear || pressed) && a.Alarm > (fear ? cat != null ? 0.65 : 0.08 : a.Species == "swan" ? 0.9 : 0.5))
        {
            if (a.Young || HasBrood(a)) { a.Mode = "swim"; a.Target = new Pt(h.X, h.Z); Go(a, a.Target, 1.9, dt); a.Y = OnLand(a.X, a.Z) ? 0.06 : water; return; }
            bool away = Random() < 0.5; Fly(a, Elsewhere(a, away), away); a.Alarm = 0; watched.Remove(a.Id); return;
        }
        if (pd < wary && !shelter)
        {
            double d = Math.Max(pd, 0.001), x = a.X + (a.X - person.X) / d * 2.5, z = a.Z + (a.Z - person.Z) / d * 2.5; bool wet = !OnLand(a.X, a.Z);
            double r = Distance(x, z, h.X, h.Z); if (wet && r > h.R * 1.15) { x = h.X + (x - h.X) / r * h.R * 1.15; z = h.Z + (z - h.Z) / r * h.R * 1.15; }
            a.Target = new Pt(x, z); a.Timer = Math.Max(a.Timer, 3); Go(a, a.Target, a.Species == "swan" ? 0.6 : a.Species == "goose" ? 0.85 : 0.9, dt, !wet); a.Y = OnLand(a.X, a.Z) ? 0.06 : water; a.Mode = a.Y > 0 ? "forage" : "swim"; return;
        }
        if (shelter) { a.Mode = "shelter"; Go(a, new Pt(h.X, h.Z), 0.35, dt); a.Y = water; return; }
        if (a.Mode == "shelter") { a.Mode = "swim"; a.Timer = 5; }
        Pt? meal = null;
        foreach (var item in food) if (Distance(a.X, a.Z, item.point.X, item.point.Z) < 14) { meal = item.point; break; }
        if (meal != null) { a.Mode = "feed"; a.Target = meal.Value; } else if (a.Mode == "feed") { a.Mode = "swim"; a.Timer = 0; }
        if (a.Timer <= 0 && meal == null)
        {
            if (!a.Young && !HasBrood(a) && Random() < 0.22) { bool away = Random() < 0.4; Fly(a, Elsewhere(a, away), away); return; }
            double angle = Random() * Math.PI * 2; a.Target = new Pt(h.X + Math.Cos(angle) * h.R * 0.75, h.Z + Math.Sin(angle) * h.R * 0.75); a.Mode = "swim"; a.Timer = 7 + Random() * 13;
            if (a.Species == "goose") for (int i = 0; i < 12; i++) { angle = Random() * Math.PI * 2; double r = h.R + 1 + Random() * 3; var p = new Pt(h.X + Math.Cos(angle) * r, h.Z + Math.Sin(angle) * r); if (OnLand(p.X, p.Z)) { a.Target = p; a.Mode = "forage"; a.Timer = 18 + Random() * 12; break; } }
        }
        var target = a.Young && a.Parent is int m && List[m].Mode != "flight" ? new Pt(List[m].X - 0.6 * Math.Cos(a.Phase), List[m].Z - 0.6 * Math.Sin(a.Phase)) : a.Target;
        Go(a, target, a.Mode == "feed" ? 0.8 : a.Species == "swan" ? 0.27 : 0.46, dt); a.Y = OnLand(a.X, a.Z) ? 0.06 : water; if (a.Y > 0 && a.Mode != "feed") a.Mode = "forage";
    }
    private void TreeStep(Beast a, double dt, bool shelter, List<Pt> threats)
    {
        var t = trees[a.Home]; bool danger = Near(threats, a, 3);
        if (a.Species == "songbird")
        {
            if (a.Mode == "flight") { a.Flight = Math.Min(1, a.Flight + dt / a.Duration); double f = a.Flight; a.X = a.Start.X + (a.Target.X - a.Start.X) * f; a.Z = a.Start.Z + (a.Target.Z - a.Start.Z) * f; a.Y = a.Start.Y + (a.TargetY - a.Start.Y) * f + Math.Sin(Math.PI * f) * 2.1; a.Yaw = Math.Atan2(-(a.Target.Z - a.Start.Z), a.Target.X - a.Start.X); if (f == 1) { a.Mode = a.TargetY < 0.2 ? "forage" : "perch"; a.Timer = 7 + Random() * 16; } return; }
            danger &= a.Y < 2;
            if (a.Timer > 0 && !danger && !(shelter && a.Y < 2)) return;
            if (shelter && a.Y > 2) { a.Mode = "shelter"; a.Timer = 10; return; }
            double angle = Random() * 6.28; var ground = new Vector3((float)(t.X + Math.Cos(angle) * 2.5), 0.03f, (float)(t.Z + Math.Sin(angle) * 2.5)); Vector3 dest;
            if (!shelter && !danger && a.Y > 2 && Random() < 0.4 && OnLand(ground.X, ground.Z)) dest = ground;
            else { int count = 0;
                for (int branch = 0; branch < 6; branch++)
                {
                    if (a.Y >= 2 && branch == a.Branch) continue;
                    bool taken = false;
                    foreach (var b in List) if (b != a && b.Species == "songbird" && b.Home == a.Home && b.Branch == branch && b.Mode != "forage") { taken = true; break; }
                    if (!taken) freeBranches[count++] = branch;
                }
                if (count > 0) a.Branch = freeBranches[(int)(Random() * count)]; dest = BranchPoint(a); }
            a.Start = new Vector3((float)a.X, (float)a.Y, (float)a.Z); a.Target = new Pt(dest.X, dest.Z); a.TargetY = dest.Y; a.Flight = 0; a.Duration = Math.Max(1.2, a.Start.DistanceTo(dest) / 4); a.Mode = "flight"; return;
        }
        bool oak = t.Kind == "old_oak"; double radius = (oak ? trunkRadius : 0.24) * t.Scale, top = (oak ? climbHeight : 3.3) * t.Scale;
        if ((danger || shelter) && a.Mode != "perch") a.Mode = "climb";
        if (a.Mode == "climb") { Go(a, new Pt(t.X + radius, t.Z), 2.8, dt, true); if (Distance(a.X, a.Z, t.X, t.Z) < radius + 0.4) { a.Y = Math.Min(top, a.Y + dt * 1.7); a.X = t.X + radius; a.Z = t.Z; a.Yaw = Math.PI; if (a.Y >= top) { a.Mode = "perch"; a.Timer = 8 + Random() * 18; } } return; }
        if (a.Mode == "perch") { if (shelter || danger) a.Timer = Math.Max(a.Timer, 5); else if (a.Timer <= 0) { a.Y = Math.Max(0.08, a.Y - dt * 1.4); if (a.Y <= 0.08) { a.Mode = "forage"; a.Timer = 0; } } return; }
        if (a.Timer <= 0) { double angle = Random() * 6.28, r = 1 + Random() * 3; a.Target = new Pt(t.X + Math.Cos(angle) * r, t.Z + Math.Sin(angle) * r); a.Timer = 3 + Random() * 6; if (Random() < 0.18) a.Mode = "climb"; }
        Go(a, a.Target, 1.1, dt, true); a.Y = 0.08 + Math.Abs(Math.Sin(clock * 13 + a.Phase)) * 0.08;
    }
    private void Draw(Vector3 eye)
    {
        var counts = drawCounts;
        foreach (string key in meshes.Keys) counts[key] = 0;
        int shown = 0;
        void Set(string kind, Transform3D transform) { if (meshes.TryGetValue(kind, out var m) && counts[kind] < 96) multiMeshes[kind].SetInstanceTransform(counts[kind]++, transform); }
        foreach (var a in List)
        {
            if (Distance(a.X, a.Z, eye.X, eye.Z) > 90) continue;
            string kind = a.Species == "duck" ? a.Young ? "duck_young" : a.Female ? "duck_female" : "duck_mallard" : a.Species == "swan" && a.Young ? "swan_young" : a.Species;
            bool fly = a.Mode == "flight"; float peck = a.Mode is "feed" or "forage" or "swim" && Distance(a.X, a.Z, a.Target.X, a.Target.Z) < 0.65 ? (float)(-(0.15 + 0.15 * Math.Sin(clock * 5 + a.Phase)) * (a.Species == "squirrel" ? 0.5 : 1)) : 0;
            var tr = new Transform3D(Basis.FromEuler(new Vector3(0, (float)a.Yaw, a.Mode == "climb" && a.Y > 0.25 ? MathF.PI / 2 : fly ? -0.08f : peck)), new Vector3((float)a.X, (float)(a.Y + (a.Mode == "swim" ? Math.Sin(clock * 2 + a.Phase) * 0.012 : 0)), (float)a.Z));
            Set(kind, tr); shown++;
            if (fly || a.Mode == "defend") for (int sign = -1; sign <= 1; sign += 2)
            {
                string wing = a.Species == "swan" ? "wing_swan" : a.Species == "goose" ? "wing_goose" : a.Species == "songbird" ? "wing_songbird" : "wing_duck";
                var local = new Transform3D(Basis.FromEuler(new Vector3((float)(sign * (fly ? Math.Sin(clock * (a.Species == "swan" ? 7 : a.Species == "goose" ? 10 : 15) + a.Phase) * 0.8 : 0.75)), 0, 0)).Scaled(new Vector3(1, 1, sign)), new Vector3(0, a.Species == "songbird" ? 0.11f : 0.27f, sign * (a.Species == "songbird" ? 0.045f : 0.12f)));
                Set(wing, tr * local);
            }
        }
        foreach (var (k, m) in multiMeshes) m.VisibleInstanceCount = counts[k]; Shown = shown;
    }
    public override void _ExitTree() { root.QueueFree(); if (I == this) I = null; }
}
