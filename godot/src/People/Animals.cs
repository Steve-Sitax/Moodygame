using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;
using Scheldemist.Town;

namespace Scheldemist.People;

/// <summary>
/// One dog, cat or pig of animals.glb (the browser's game/animals.ts Animal): its own skeleton, the species' clips by
/// bone name. Walk and run are a wish: the legs move only while the animal really goes, at the pace of the ground it
/// covers; held against a wall it stands.
/// </summary>
public sealed class Animal
{
    /// <summary>How far to lower the root so the body rests on the ground (build_animals.py report).</summary>
    private static readonly Dictionary<string, (float sit, float lie)> Drop = new() { ["dog"] = (0.276f, 0.23f), ["dog_grey"] = (0.304f, 0.253f), ["cat"] = (0.131f, 0.139f), ["pig"] = (0, 0), ["pig_spotted"] = (0, 0) };
    /// <summary>Metres per loop of walk and run (the paws stay planted at this).</summary>
    private static readonly Dictionary<string, (float walk, float run)> Stride = new() { ["dog"] = (0.452f, 1.125f), ["dog_grey"] = (0.497f, 1.24f), ["cat"] = (0.21f, 0.531f), ["pig"] = (0.219f, 0.429f), ["pig_spotted"] = (0.206f, 0.403f) };
    /// <summary>Above this ground speed (m/s) the run clip reads better than a hurried walk.</summary>
    private static readonly Dictionary<string, float> RunFrom = new() { ["dog"] = 1.3f, ["dog_grey"] = 1.4f, ["cat"] = 0.8f, ["pig"] = 1.2f, ["pig_spotted"] = 1.2f };
    private const float MoveOn = 0.2f, MoveOff = 0.15f;

    private static ModelLibrary.Model? model;
    private static AnimationLibrary? clips;
    private static readonly Dictionary<string, float> Lengths = new();
    private readonly Dictionary<string, (StringName name, float length)> clipNames = new();
    private static bool tried;
    private static readonly Random Rng = new();

    public static bool Ready
    {
        get
        {
            if (tried) return model != null;
            tried = true;
            // (animals.ts: psx on a Lambert with the file's picture, both sides)
            model = ModelLibrary.Get("animals", new ModelLibrary.Look(TwoSided: true));
            if (model == null) return false;
            foreach (var root in model.Roots.Values)
            {
                root.Position = Vector3.Zero;
                foreach (var n in World.BakedWorld.All(root))
                    if (n is MeshInstance3D mi) mi.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
            }
            // rotations only, by bone name (as the people's clips: Human.cs)
            clips = new AnimationLibrary();
            foreach (var (name, src) in model.Clips)
            {
                var a = new Animation { Length = src.Length, LoopMode = Animation.LoopModeEnum.Linear };
                for (int t = 0; t < src.GetTrackCount(); t++)
                {
                    if (src.TrackGetType(t) != Animation.TrackType.Rotation3D) continue;
                    string path = src.TrackGetPath(t).ToString();
                    int colon = path.LastIndexOf(':');
                    if (colon < 0) continue;
                    int nt = a.AddTrack(Animation.TrackType.Rotation3D);
                    a.TrackSetPath(nt, "Skeleton3D:" + path[(colon + 1)..]);
                    for (int k = 0; k < src.TrackGetKeyCount(t); k++) a.RotationTrackInsertKey(nt, src.TrackGetKeyTime(t, k), src.TrackGetKeyValue(t, k).AsQuaternion());
                }
                clips.AddAnimation(name, a);
                Lengths[name] = (float)src.Length;
            }
            return true;
        }
    }

    public static void Forget() { model = null; clips = null; tried = false; Lengths.Clear(); }

    public static Animal? Make(string kind) => Ready && model!.Copy(kind) is { } root ? new Animal(kind, root) : null;

    public readonly string Kind, Species;
    public readonly Node3D Group = new();
    private readonly Node3D root;
    private readonly AnimationPlayer mixer;
    private readonly string key;
    /// <summary>The clip that shows now (walk or run only while the animal really goes).</summary>
    public string? Motion { get; private set; }
    private string? gait;
    /// <summary>Ground speed in m/s, measured from where the group really went (smoothed).</summary>
    public float Speed { get; private set; }
    private Vector3 last;
    private bool hasLast;
    private float drop;

    private Animal(string kind, Node3D root)
    {
        Kind = kind;
        Species = kind.StartsWith("dog") ? "dog" : kind.StartsWith("pig") ? "pig" : "cat";
        key = kind is "dog_grey" or "pig_spotted" ? kind : Species;
        this.root = root;
        foreach (var entry in Lengths) if (entry.Key.StartsWith(Species + "_")) clipNames[entry.Key[(Species.Length + 1)..]] = (new StringName(entry.Key), entry.Value);
        Group.Name = kind;
        Group.AddChild(root);
        mixer = new AnimationPlayer { Name = "clips", CallbackModeProcess = AnimationMixer.AnimationCallbackModeProcess.Manual };
        root.AddChild(mixer);
        mixer.RootNode = new NodePath("..");
        mixer.AddAnimationLibrary("", clips!);
    }

    /// <summary>Once it is in the scene: idle, and not all in step.</summary>
    public void Start()
    {
        Show("idle", 0);
        mixer.Seek(Rng.NextDouble() * Lengths.GetValueOrDefault(Species + "_idle", 1), true);
    }

    public void Play(string m, float fade = 0.25f)
    {
        if (m is "walk" or "run")
        {
            gait = m;
            return;
        }
        gait = null;
        Show(m, fade);
    }

    private void Show(string m, float fade = 0.25f)
    {
        if (Motion == m) return;
        var clip = clipNames.GetValueOrDefault(m, clipNames["idle"]);
        bool first = Motion == null;
        Motion = m;
        mixer.SpeedScale = 1;
        mixer.Play(clip.name, first ? 0 : fade);
    }

    public void Update(float dt)
    {
        // how fast it really goes (a jump of more than 2 m is a placement, not a step)
        var p = Group.GlobalPosition;
        if (hasLast && dt > 0.004f)
        {
            float d = new Vector2(p.X - last.X, p.Z - last.Z).Length();
            float inst = d > 2 ? 0 : d / dt;
            Speed += (inst - Speed) * Math.Min(1, dt * 10);
        }
        last = p;
        hasLast = true;
        if (gait != null)
        {
            bool going = Motion is "walk" or "run";
            if (Speed > (going ? MoveOff : MoveOn))
            {
                float runFrom = RunFrom[key];
                string m = Speed > (Motion == "run" ? runFrom - 0.2f : runFrom) ? "run" : "walk";
                Show(m, 0.2f);
                // one loop of the clip is one stride: loops per second = speed / stride
                var s = Stride[key];
                mixer.SpeedScale = Speed * clipNames[m].length / (m == "run" ? s.run : s.walk);
            }
            else if (going || Motion == null) Show("idle", 0.2f);
        }
        mixer.Advance(dt);
        float want = Motion == "sit" ? -Drop[key].sit : Motion == "lie" ? -Drop[key].lie : 0;
        drop += (want - drop) * Math.Min(1, dt * 5);
        root.Position = new Vector3(0, drop, 0);
    }

    public void Dispose() => Group.QueueFree();
}

/// <summary>
/// The animals of the town (the browser's game/animals.ts Animals): a cat on about nine doorsteps in twenty, a stray
/// dog haunting some of the rest (a third of them only at night), each made when the viewer comes within 60 m of its
/// haunt; a townsperson's dog at heel while they are out. Strays trot about, sniff, and come over to Jef now and
/// then; cats sit and lie on their doorsteps, stroll a little, and run from dogs and from Jef right on top of them;
/// in the great storm they run for their doorstep and cower there.
/// ParkWildlife supplies nearby prey. Capture ecology, the dogs' business in the park, fish scraps of the market,
/// the pigs' drove and multiplayer animal replication are left for their own tie-ins.
/// </summary>
[GamePart(206)]
public partial class Animals : Node
{
    private static readonly string[] Dogs = { "dog_brown", "dog_black", "dog_spotted", "dog_grey" };
    private static readonly string[] Cats = { "cat_tabby", "cat_black", "cat_ginger", "cat_white" };
    private const double ReachR = 60, DropR = 75;

    private sealed class Beast
    {
        public Animal A = null!;
        public double X, Z, Yaw, Y;
        public Townspeople.Sim? Owner;
        public (double x, double z)? Goal;
        public List<(double x, double z)> Route = new();
        public double Speed = 1, Timer, Scared, Stuck, Lost, Repath, Hold;
        public string? Id;
        public int Shelter;
        public float Tremble;
    }

    private sealed record Haunt(string Id, string Kind, double X, double Z, double Yaw, bool Night, string Pose);

    public static Animals? I { get; private set; }
    private readonly List<Beast> beasts = new();
    private List<Haunt>? haunts;
    private Dictionary<string, Haunt> hauntOf = new();
    private Townspeople? town;
    private readonly Random rng = new();
    private double spawnT;
    private readonly Plane[] frustum = new Plane[6];
    private readonly List<Beast> dogs = new(32);
    private readonly List<(double x, double z)> routeScratch = new(256);
    private Vector3 eyeNow;
    private double fogNow;

    public int Count => beasts.Count;
    public int Shown { get; private set; }
    public int Haunts => haunts?.Count ?? 0;
    public double LogicMs { get; private set; }
    /// <summary>For a check: every animal here now (its kind, where, what it shows, whose it is).</summary>
    public IEnumerable<(string kind, double x, double z, string? motion, string? owner, bool shown)> List => beasts.Select(b => (b.A.Kind, b.X, b.Z, b.A.Motion, b.Owner?.R.Id, b.A.Group.Visible));

    /// <summary>For a check: every animal's node.</summary>
    public IEnumerable<Node3D> Groups => beasts.Select(b => b.A.Group);

    public Animals()
    {
        I = this;
    }

    public override void _Ready()
    {
        town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        if (town == null) SetProcess(false);
    }

    public override void _ExitTree()
    {
        foreach (var b in beasts) b.A.Dispose();
        beasts.Clear();
        if (I == this) I = null;
    }

    private double Rnd(double a, double b) => a + rng.NextDouble() * (b - a);
    private static readonly string[] SitIdle = { "sit", "idle" }, RestPoses = { "sit", "sit", "sniff", "lie", "idle" }, SniffPoses = { "sniff", "sniff", "idle", "sit", "lie" }, SniffIdle = { "sniff", "idle" }, SitLie = { "sit", "lie", "sit" };
    private T Pick<T>(T[] xs) => xs[rng.Next(xs.Length)];
    private static double AngDiff(double a, double b) => Math.Atan2(Math.Sin(a - b), Math.Cos(a - b));
    private static double Hyp(double a, double b) => Math.Sqrt(a * a + b * b);

    /// <summary>A fixed roll for a thing of the town, the same on every PC (game/share.ts hash32, dice).</summary>
    private static uint Hash32(string key, params double[] n)
    {
        uint h = 0x811c9dc5;
        foreach (char c in key) h = unchecked((h ^ c) * 0x01000193u);
        foreach (double v in n)
        {
            h = unchecked((h ^ (uint)(int)v) * 0x01000193u);
            h = unchecked((h ^ (uint)(int)(v * 4096)) * 0x85ebca6bu);
        }
        h = unchecked((h ^ (h >> 15)) * 0x2c1b3c6du);
        h = unchecked((h ^ (h >> 12)) * 0x297a2d39u);
        return h ^ (h >> 15);
    }
    private static double Dice(string key, params double[] n) => Hash32(key, n) / 4294967296.0;

    /// <summary>The town's strays and cats, fixed by its doorsteps (animals.ts catSpots).</summary>
    private void MakeHaunts()
    {
        var o = new List<Haunt>();
        var seen = new HashSet<string>();
        foreach (var r in town!.Data!.Residents)
        {
            string key = $"{Whereabouts.JsRound(r.HomeSx * 10)},{Whereabouts.JsRound(r.HomeSz * 10)}";
            if (!seen.Add(key)) continue; // (a family's one door)
            double i = Hash32(key) % 100000;
            if (Dice("cat", i) < 0.45)
                o.Add(new Haunt($"a:cat:{key}", Cats[(int)Math.Floor(Dice("catkind", i) * 4)], r.HomeSx + (Dice("catx", i) - 0.5) * 1.2, r.HomeSz + (Dice("catz", i) - 0.5) * 1.2, Dice("catyaw", i) * 6.28, false, Dice("catpose", i) < 0.34 ? "lie" : "sit"));
            else if (Dice("stray", i) < 0.6)
                o.Add(new Haunt($"a:dog:{key}", Dogs[(int)Math.Floor(Dice("dogkind", i) * 4)], r.HomeSx, r.HomeSz, Dice("dogyaw", i) * 6.28, Dice("dognight", i) < 0.33, "sit"));
        }
        o.Add(new Haunt("a:parkcat:0", "cat_tabby", -306, 303, 0, false, "sit"));
        o.Add(new Haunt("a:parkcat:1", "cat_ginger", -286, 292, 0, false, "sit"));
        haunts = o;
        hauntOf = o.ToDictionary(h => h.Id);
    }

    private bool Free(double x, double z) => town!.Walk!.Free(x, z);

    private bool InView(double x, double z, double y)
    {

        var c = new Vector3((float)x, (float)y + 0.4f, (float)z);
        foreach (var pl in frustum)
            if (pl.DistanceTo(c) > 1) return false;
        return true;
    }

    public long AllocatedBytesLastFrame { get; private set; }
    public void FillThreats(List<Pt> cats, List<Pt> dogs)
    {
        foreach (var b in beasts) (b.A.Species == "cat" ? cats : dogs).Add(new Pt(b.X, b.Z));
    }
    public override void _Process(double delta)
    {
        if (town?.Data == null || town.Walk == null || town.Crowd == null || town.Paused || !Animal.Ready) return;
        long allocated = GC.GetAllocatedBytesForCurrentThread();
        ulong t0 = Time.GetTicksUsec();
        double dt = Math.Min(delta, 0.1);
        if (haunts == null) MakeHaunts();
        var cam = Main.I.Cam;
        var eye = cam.GlobalPosition;
        var projection = cam.GetCameraProjection();
        var transform = cam.GetCameraTransform();
        for (int i = 0; i < 6; i++) frustum[i] = transform * projection.GetProjectionPlane((Projection.Planes)i);
        eyeNow = eye;
        double fogFar = town.Crowd.FogDistance;
        bool night = town.Hour >= 19 || town.Hour < 6.5;
        (double x, double z)? jef = Scheldemist.Player.Jef.I is { Fly: false } j ? (j.X, j.Z) : null;
        fogNow = fogFar;
        // the town's strays and cats near: made at their haunts; the townspeople's dogs come out with them
        spawnT -= dt;
        if (spawnT <= 0)
        {
            spawnT = 0.5;
            foreach (var h in haunts!)
            {
                if (Hyp(h.X - eye.X, h.Z - eye.Z) > ReachR || (h.Night && !night) || HasBeast(h.Id)) continue;
                var an = Animal.Make(h.Kind);
                if (an == null) break;
                Main.I.View.AddChild(an.Group);
                an.Start();
                if (an.Species == "cat")
                {
                    an.Play(h.Pose, 0);
                    beasts.Add(new Beast { A = an, X = h.X, Z = h.Z, Yaw = h.Yaw, Speed = 0, Timer = 5 + Dice("cattimer", h.X, h.Z) * 15, Id = h.Id });
                }
                else beasts.Add(new Beast { A = an, X = h.X, Z = h.Z, Yaw = h.Yaw, Timer = Dice("dogtimer", h.X, h.Z) * 3, Id = h.Id });
            }
            for (int person = 0; person < town.Sims.Count; person++)
            {
                var s = town.Sims[person];
                if (s.R.DogLook == null) continue;
                Beast? mine = null;
                foreach (var beast in beasts) if (beast.Owner == s) { mine = beast; break; }
                if (s.P == null)
                {
                    if (mine != null) DropBeast(mine);
                    continue;
                }
                if (mine != null) continue;
                var a = Animal.Make(Dogs.Contains(s.R.DogLook) ? s.R.DogLook : "dog_brown");
                if (a == null) break;
                Main.I.View.AddChild(a.Group);
                a.Start();
                // at her side if there is room, else where she stands (it steps out from there)
                bool side = Free(s.P.X + 0.8, s.P.Z + 0.8);
                beasts.Add(new Beast { A = a, X = s.P.X + (side ? 0.8 : 0), Z = s.P.Z + (side ? 0.8 : 0), Owner = s, Speed = 0, Id = "dog:" + s.R.Id });
            }
        }
        bool storm = town.StormLevel > 0.3;
        dogs.Clear();
        foreach (var beast in beasts) if (beast.A.Species == "dog") dogs.Add(beast);
        int shown = 0;
        for (int index = beasts.Count - 1; index >= 0; index--)
        {
            var b = beasts[index];
            double d = Hyp(b.X - eye.X, b.Z - eye.Z);
            if (b.Owner == null && d > DropR)
            {
                DropBeast(b);
                continue;
            }
            if (b.Owner != null) Follow(b, dt);
            // the great storm: strays and cats run for their doorstep and cower there, flat to the stone
            else if (storm) Storm(b, dt);
            else if (b.Shelter != 0)
            {
                b.Shelter = 0;
                b.Tremble = 0;
                b.Goal = null;
                b.Route.Clear();
                b.Timer = Rnd(1, 4);
                b.A.Play(b.A.Species == "cat" ? "sit" : "idle");
            }
            else if (b.A.Species == "dog") Stray(b, dt, jef);
            else Cat(b, dt, dogs, jef);
            // shown within the fog and in view; it stands on the ground under it (the pontoon, steps, a raised courtyard)
            b.Y = town.Walk.BaseAt(b.X, b.Z);
            bool show = d < Math.Min(fogFar + 5, 50) && (d < 4 || InView(b.X, b.Z, b.Y));
            b.A.Group.Visible = show;
            b.A.Group.Position = new Vector3((float)b.X, (float)b.Y, (float)b.Z);
            b.A.Group.Rotation = new Vector3(0, (float)b.Yaw, b.Tremble);
            if (show)
            {
                shown++;
                b.A.Update((float)dt);
            }
        }
        AllocatedBytesLastFrame = GC.GetAllocatedBytesForCurrentThread() - allocated;
        Shown = shown;
        LogicMs = (Time.GetTicksUsec() - t0) / 1000.0;
    }

    private void DropBeast(Beast b)
    {
        b.A.Dispose();
        beasts.Remove(b);
    }

    // ---- moving

    /// <summary>One step toward (tx, tz) at speed, sliding along what is in the way.</summary>
    private void Step(Beast b, double tx, double tz, double speed, double dt)
    {
        double dx = tx - b.X, dz = tz - b.Z, len = Hyp(dx, dz);
        if (len < 0.02) return;
        double s = Math.Min(len, speed * dt);
        double nx = b.X + dx / len * s, nz = b.Z + dz / len * s;
        if (!Free(nx, nz))
        {
            if (Free(nx, b.Z)) nz = b.Z;
            else if (Free(b.X, nz)) nx = b.X;
            // (on a doorstep no body fits on: it may step off it towards its goal)
            else if (Free(b.X, b.Z)) return;
        }
        if (Hyp(nx - b.X, nz - b.Z) > 1e-4) b.Yaw += AngDiff(Math.Atan2(nx - b.X, nz - b.Z), b.Yaw) * Math.Min(1, dt * 8);
        b.X = nx;
        b.Z = nz;
    }

    /// <summary>Along the route to the goal: "there", "going", or "stuck" (0.4 s on end of getting almost nowhere).</summary>
    private string Go(Beast b, double speed, double dt)
    {
        (double x, double z)? next = b.Route.Count > 0 ? b.Route[0] : b.Goal;
        if (next == null) return "there";
        var n = next.Value;
        b.A.Play(speed > 1.6 ? "run" : "walk");
        double len = Hyp(n.x - b.X, n.z - b.Z), x0 = b.X, z0 = b.Z;
        if (len > 0.25) Step(b, n.x, n.z, speed, dt);
        if (Hyp(n.x - b.X, n.z - b.Z) <= 0.25)
        {
            b.Stuck = 0;
            if (b.Route.Count > 1)
            {
                b.Route.RemoveAt(0);
                return "going";
            }
            b.Route.Clear();
            return "there";
        }
        double moved = Hyp(b.X - x0, b.Z - z0);
        if (moved < Math.Min(len, speed * dt) * 0.35) b.Stuck += dt;
        else b.Stuck = Math.Max(0, b.Stuck - dt * 2);
        return b.Stuck > 0.4 ? "stuck" : "going";
    }

    private bool LineFree(double ax, double az, double bx, double bz)
    {
        int n = Math.Max(1, (int)Math.Ceiling(Hyp(bx - ax, bz - az) / 0.25));
        for (int i = 1; i <= n; i++)
            if (!Free(ax + (bx - ax) * i / n, az + (bz - az) * i / n)) return false;
        return true;
    }

    /// <summary>Aim for (x, z) only if it can get there: straight when the way is free, else on the people's walk grid (at most maxLen long).</summary>
    private bool Aim(Beast b, double x, double z, double maxLen = 35)
    {
        var crowd = town!.Crowd!;
        if (Free(x, z) && LineFree(b.X, b.Z, x, z))
        {
            b.Goal = (x, z);
            b.Route.Clear(); b.Route.Add((x, z));
            b.Stuck = 0;
            return true;
        }
        var q = crowd.OpenNear(x, z);
        if (q == null || !crowd.CanStand(q.Value.x, q.Value.z)) return false;
        var way = crowd.PathOn(b.X, b.Z, q.Value.x, q.Value.z, routeScratch);
        if (way == null || way.Count == 0) return false;
        // the grid keeps half a metre off the walls: from a doorstep, first out onto it
        if (!crowd.CanStand(b.X, b.Z))
        {
            var s = crowd.OpenNear(b.X, b.Z);
            if (s == null) return false;
            way.Insert(0, s.Value);
        }
        double len = 0, px = b.X, pz = b.Z;
        foreach (var p in way)
        {
            len += Hyp(p.x - px, p.z - pz);
            (px, pz) = p;
        }
        if (len > maxLen) return false;
        b.Goal = q;
        b.Route.Clear(); b.Route.AddRange(way);
        b.Stuck = 0;
        return true;
    }

    private bool HasBeast(string id) { foreach (var beast in beasts) if (beast.Id == id) return true; return false; }
    private bool Hidden(double x, double z)
    {
        double d = Hyp(x - eyeNow.X, z - eyeNow.Z);
        return d >= 8 && (d > fogNow + 3 || !InView(x, z, town!.Walk!.BaseAt(x, z)));
    }
    private void Follow(Beast b, double dt)
    {
        var o = b.Owner!.P;
        if (o == null) return;
        bool walking = town!.Crowd!.PuppetBusy(o);
        // at heel: a little behind and to the left; along a house front that spot is in the wall, so then right behind
        double tx = o.X - Math.Sin(o.Yaw) * 1.1 + Math.Cos(o.Yaw) * 0.6, tz = o.Z - Math.Cos(o.Yaw) * 1.1 - Math.Sin(o.Yaw) * 0.6;
        if (!Free(tx, tz))
        {
            double bx = o.X - Math.Sin(o.Yaw) * 0.9, bz = o.Z - Math.Cos(o.Yaw) * 0.9;
            var q = Free(bx, bz) ? (bx, bz) : town.Crowd.OpenNear(tx, tz);
            if (q != null) (tx, tz) = q.Value;
        }
        double d = Hyp(tx - b.X, tz - b.Z);
        if ((d > 12 || b.Lost > 2) && Hidden(b.X, b.Z) && Hidden(tx, tz))
        {
            // lost the way round a corner: catch up where nobody sees it
            b.X = tx;
            b.Z = tz;
            b.Lost = 0;
            b.Route.Clear();
            b.Stuck = 0;
            return;
        }
        if (b.Hold > 0)
        {
            // a dead end: it stands and looks at her a moment, then tries again
            b.Hold -= dt;
            b.Yaw += AngDiff(Math.Atan2(o.X - b.X, o.Z - b.Z), b.Yaw) * Math.Min(1, dt * 3);
            return;
        }
        // off it goes when she is a metre off, and it stops within half a metre (no dithering at heel)
        if (d > (b.Route.Count > 0 ? 0.5 : 1.0))
        {
            b.Repath -= dt;
            if (b.Repath <= 0 || b.Route.Count == 0)
            {
                b.Repath = 0.7;
                if (!Aim(b, tx, tz, 60))
                {
                    b.Goal = (tx, tz);
                    b.Route.Clear(); b.Route.Add((tx, tz));
                }
            }
            else if (b.Route.Count == 1)
            {
                // straight at her: keep up with where she is now
                b.Goal = (tx, tz);
                b.Route[0] = (tx, tz);
            }
            string r = Go(b, d > 3 ? 2.6 : Math.Max(0.8, Math.Min(1.6, d)), dt);
            if (r == "there") b.Route.Clear();
            else if (r == "stuck")
            {
                // as near as the wall lets it (that is heel), or a dead end: it waits a moment, then tries again
                bool near = d < 1.6;
                if (!near) b.Lost += 0.6;
                b.Route.Clear();
                b.Stuck = 0;
                b.Hold = near ? 1.5 : 0.6;
                b.A.Play(near ? Pick(SitIdle) : "idle");
            }
            else b.Lost = Math.Max(0, b.Lost - dt);
            b.Timer = Rnd(2, 6);
        }
        else
        {
            b.Lost = 0;
            b.Route.Clear();
            if (b.A.Motion is not ("sit" or "lie" or "sniff")) b.A.Play("idle");
            b.Yaw += AngDiff(o.Yaw, b.Yaw) * Math.Min(1, dt * 3);
            if ((b.Timer -= dt) <= 0)
            {
                b.A.Play(walking ? "idle" : Pick(RestPoses));
                b.Timer = Rnd(4, 10);
            }
        }
    }

    private void Stray(Beast b, double dt, (double x, double z)? jef)
    {
        if (b.Goal != null)
        {
            string r = Go(b, b.Speed, dt);
            if (r != "going")
            {
                b.Goal = null;
                b.Route.Clear();
                b.A.Play(r == "there" ? Pick(SniffPoses) : Pick(SniffIdle));
                b.Timer = r == "there" ? Rnd(2, 9) : Rnd(0.5, 2);
            }
            return;
        }
        if ((b.Timer -= dt) > 0) return;
        // trot off somewhere it can get to, now and then over to Jef for a sniff
        bool toJef = jef != null && rng.NextDouble() < 0.15 && Hyp(jef.Value.x - b.X, jef.Value.z - b.Z) < 20;
        b.Speed = rng.NextDouble() < 0.25 ? Rnd(2.2, 3.2) : Rnd(0.8, 1.3);
        bool ok = toJef && Aim(b, jef!.Value.x + Rnd(-1, 1), jef.Value.z + Rnd(-1, 1));
        for (int i = 0; !ok && i < 6; i++)
        {
            double a = rng.NextDouble() * Math.PI * 2, r = Rnd(4, 14);
            ok = Aim(b, b.X + Math.Cos(a) * r, b.Z + Math.Sin(a) * r);
        }
        if (!ok) b.Timer = Rnd(1, 3);
    }

    /// <summary>The great storm: back to its doorstep at a run, then flat on the stone, trembling; if the way is shut it cowers where it is.</summary>
    private void Storm(Beast b, double dt)
    {
        hauntOf.TryGetValue(b.Id ?? "", out var h);
        if (b.Shelter != 2 && h != null)
        {
            if (b.Shelter == 0)
            {
                b.Shelter = 1;
                b.Goal = null;
                b.Route.Clear();
                if (!Aim(b, h.X, h.Z, 80)) b.Shelter = 2;
            }
            if (b.Shelter == 1)
            {
                string r = b.Goal != null ? Go(b, b.A.Species == "dog" ? 3.1 : 3.4, dt) : "stuck";
                if (r != "going")
                {
                    b.Shelter = 2;
                    b.Goal = null;
                    b.Route.Clear();
                }
                return;
            }
        }
        b.Shelter = 2;
        if (b.A.Motion != "lie") b.A.Play("lie", 0.4f);
        // trembling: a shiver of the whole body
        b.Timer += dt;
        b.Tremble = (float)(Math.Sin(b.Timer * 38) * 0.015);
    }

    /// <summary>A way out for a frightened cat: away from the fright, or as near that as the walls allow.</summary>
    private bool Flee(Beast b, double ux, double uz)
    {
        foreach (double turn in EscapeAngles)
        {
            double c = Math.Cos(turn), s = Math.Sin(turn), dx = ux * c - uz * s, dz = ux * s + uz * c;
            for (double dist = 7; dist >= 4; dist -= 3)
                if (Aim(b, b.X + dx * dist, b.Z + dz * dist, dist * 2.5)) return true;
        }
        return false;
    }

    private static readonly double[] EscapeAngles = { 0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9 };
    private void Cat(Beast b, double dt, List<Beast> dogs, (double x, double z)? jef)
    {
        // what frightens a cat: a dog near, or Jef right on top of it
        double tx = 0, tz = 0;
        int fear = 0;
        foreach (var d in dogs)
        {
            double dd = Hyp(d.X - b.X, d.Z - b.Z);
            if (dd < 5 && dd > 1e-3)
            {
                tx += (b.X - d.X) / dd;
                tz += (b.Z - d.Z) / dd;
                fear++;
            }
        }
        if (jef != null)
        {
            double pd = Hyp(jef.Value.x - b.X, jef.Value.z - b.Z);
            if (pd < 1.6 && pd > 1e-3)
            {
                tx += (b.X - jef.Value.x) / pd;
                tz += (b.Z - jef.Value.z) / pd;
                fear++;
            }
        }
        if (fear > 0)
        {
            if (b.Scared <= 0)
            {
                b.Goal = null;
                b.Route.Clear();
                b.Timer = 0;
            }
            b.Scared = Math.Max(b.Scared, Rnd(2, 3.5));
        }
        if (b.Scared > 0)
        {
            b.Scared -= dt;
            b.Timer -= dt;
            if (b.Goal == null && fear > 0 && b.Timer <= 0)
            {
                double len = Hyp(tx, tz);
                if (len == 0) len = 1;
                // cornered: it crouches where it is and looks again in a moment
                if (!Flee(b, tx / len, tz / len)) b.Timer = 0.8;
            }
            if (b.Goal != null)
            {
                string r = Go(b, 3.2, dt);
                if (r != "going")
                {
                    b.Goal = null;
                    b.Route.Clear();
                    b.Timer = r == "stuck" ? 0.3 : 0;
                }
            }
            if (b.Goal == null) b.A.Play("idle");
            if (b.Scared <= 0)
            {
                b.Goal = null;
                b.Route.Clear();
                b.A.Play("sit");
                b.Timer = Rnd(5, 20);
            }
            return;
        }
        if (b.Goal != null)
        {
            string r = Go(b, 0.45, dt);
            if (r != "going")
            {
                b.Goal = null;
                b.Route.Clear();
                b.A.Play(Pick(SitLie));
                b.Timer = r == "there" ? Rnd(8, 25) : Rnd(2, 6);
            }
            return;
        }
        if ((b.Timer -= dt) <= 0)
        {
            if (ParkWildlife.I?.HuntTarget(b.X, b.Z) is { } prey && Aim(b, prey.X, prey.Z, 20)) return;
            double a = rng.NextDouble() * Math.PI * 2, r = Rnd(2, 5);
            if (!Aim(b, b.X + Math.Cos(a) * r, b.Z + Math.Sin(a) * r, 10)) b.Timer = Rnd(2, 6);
        }
    }
}
