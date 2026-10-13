using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;
using Scheldemist.Town;

namespace Scheldemist.People;

/// <summary>
/// The animals of the town (the browser's game/animals.ts Animals): a cat on about nine doorsteps in twenty, a stray
/// dog haunting some of the rest (a third of them only at night), each made when the viewer comes within 60 m of its
/// haunt; a townsperson's dog at heel while they are out. Strays trot about, sniff, and come over to Jef now and
/// then; cats sit and lie on their doorsteps, stroll a little, and run from dogs and from Jef right on top of them;
/// in the great storm they run for their doorstep and cower there.
/// ParkWildlife supplies nearby prey. NativeExtras gives each animal one simulator and streams it to other games.
/// </summary>
[GamePart(206)]
public partial class Animals : Node
{
    // the strays: mostly street mongrels, ratting terriers, a Schipperke off the barges; the cats in six coats
    private static readonly (string kind, int share)[] Dogs = { ("dog_brown", 22), ("dog_black", 16), ("dog_spotted", 14), ("dog_grey", 12), ("dog_terrier", 14), ("dog_terrier_wheaten", 8), ("dog_schipperke", 14) };
    private static readonly (string kind, int share)[] Cats = { ("cat_tabby", 30), ("cat_black", 18), ("cat_ginger", 16), ("cat_white", 10), ("cat_tuxedo", 14), ("cat_tortie", 12) };
    private static readonly string[] OldDogs = { "dog_brown", "dog_black", "dog_spotted", "dog_grey" };
    private static string Weighted((string kind, int share)[] list, double u)
    {
        int total = 0;
        foreach (var e in list) total += e.share;
        int roll = (int)(u * total);
        foreach (var (kind, share) in list)
        {
            if (roll < share) return kind;
            roll -= share;
        }
        return list[0].kind;
    }
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
        public bool Exhibit;
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
    /// <summary>The soft ground shadows (World.Blobs): two under each animal in view, at its shoulders and its hips.</summary>
    private readonly List<World.Blobs.Spot> shadows = new(64);
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
        if (town != null) town.PopulationChanged += PopulationChanged;
        if (town == null) SetProcess(false);
    }

    private void PopulationChanged()
    {
        shadows.Clear();
        foreach (var b in beasts) { b.A.Group.Visible = false; b.A.Dispose(); }
        beasts.Clear(); dogs.Clear(); routeScratch.Clear();
        haunts = null; hauntOf.Clear(); spawnT = 0; Shown = 0;
    }

    public override void _ExitTree()
    {
        if (town != null) town.PopulationChanged -= PopulationChanged;
        PopulationChanged();
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
                o.Add(new Haunt($"a:cat:{key}", Weighted(Cats, Dice("catkind", i)), r.HomeSx + (Dice("catx", i) - 0.5) * 1.2, r.HomeSz + (Dice("catz", i) - 0.5) * 1.2, Dice("catyaw", i) * 6.28, false, Dice("catpose", i) < 0.34 ? "lie" : "sit"));
            else if (Dice("stray", i) < 0.6)
                o.Add(new Haunt($"a:dog:{key}", Weighted(Dogs, Dice("dogkind", i)), r.HomeSx, r.HomeSz, Dice("dogyaw", i) * 6.28, Dice("dognight", i) < 0.33, "sit"));
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
                if(Net.Mp.NativeExtras.I?.RunAnimal(h.Id,h.X,h.Z,ReachR)==false)continue;
                var an = Animal.Make(h.Kind, h.Id);
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
            MakeHeardAnimals(eye);
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
                var a = Animal.Make(OldDogs.Contains(s.R.DogLook) || Animal.RigOf(s.R.DogLook) != null ? s.R.DogLook : "dog_brown", "dog:" + s.R.Id);
                if (a == null) break;
                Main.I.View.AddChild(a.Group);
                a.Start();
                // Wait for a clear side rather than beginning inside the owner's body.
                (double x, double z)? side = null;
                for (int k=0;k<8;k++) { double angle=k*Math.PI/4,x=s.P.X+Math.Cos(angle)*1.15,z=s.P.Z+Math.Sin(angle)*1.15; if (Free(x,z)) { side=(x,z);break; } }
                if (side == null) { a.Dispose(); continue; }
                beasts.Add(new Beast { A = a, X = side.Value.x, Z = side.Value.z, Owner = s, Speed = 0, Id = "dog:" + s.R.Id });
            }
        }
        bool storm = town.StormLevel > 0.3;
        dogs.Clear();
        foreach (var beast in beasts) if (beast.A.Species == "dog") dogs.Add(beast);
        int shown = 0;
        shadows.Clear();
        for (int index = beasts.Count - 1; index >= 0; index--)
        {
            var b = beasts[index];
            double d = Hyp(b.X - eye.X, b.Z - eye.Z);
            if (b.Owner == null && d > DropR)
            {
                DropBeast(b);
                continue;
            }
            bool here=b.Owner!=null?Net.Mp.NativeStreet.I?.Owns(b.Owner.R.Id)!=false:b.Id==null||Net.Mp.NativeExtras.I?.RunAnimal(b.Id,b.X,b.Z,ReachR)!=false;
            if(!here){
                if(b.Id!=null&&Net.Mp.NativeExtras.I?.Animal(b.Id)is{} pose){b.X=pose.X;b.Z=pose.Z;b.Yaw=pose.Yaw;b.A.Play(pose.Motion);}
                else{DropBeast(b);continue;}
            }
            else if (b.Owner != null) Follow(b, dt);
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
                if (b.A.Motion is not ("lie") && shadows.Count < 60)
                {
                    float r = b.A.R.H * b.A.Size * 0.42f, off = b.A.R.H * b.A.Size * 0.32f;
                    float fx = MathF.Sin((float)b.Yaw) * off, fz = MathF.Cos((float)b.Yaw) * off;
                    shadows.Add(new World.Blobs.Spot((float)b.X + fx, (float)b.Z + fz, (float)b.Y, r));
                    shadows.Add(new World.Blobs.Spot((float)b.X - fx, (float)b.Z - fz, (float)b.Y, r));
                }
            }
            if(here&&b.Id!=null)Net.Mp.NativeExtras.I?.PutAnimal(b.Id,new(b.X,b.Z,b.Yaw,b.A.Motion??"idle"),b.Owner?.R.Id);
        }
        World.Blobs.I?.Set("animals", shadows);
        AllocatedBytesLastFrame = GC.GetAllocatedBytesForCurrentThread() - allocated;
        Shown = shown;
        LogicMs = (Time.GetTicksUsec() - t0) / 1000.0;
    }

    /// <summary>For the timing check: `want` more strays and cats about `eye` (local only, nothing is shared).</summary>
    internal void Exhibit(int want, Vector3 eye)
    {
        if (town?.Walk == null || !Animal.Ready) return;
        var kinds = Animal.Kinds.ToArray();
        for (int i = 0, made = 0; made < want && i < 200; i++)
        {
            double a = i * 2.399, r = 4 + (i % 9) * 1.1, x = eye.X + Math.Cos(a) * r, z = eye.Z + Math.Sin(a) * r;
            if (!Free(x, z)) continue;
            var an = Animal.Make(kinds[made % kinds.Length], "exhibit:" + made);
            if (an == null) break;
            Main.I.View.AddChild(an.Group);
            an.Start();
            if (an.Species == "cat") an.Play(made % 3 == 0 ? "lie" : "sit", 0);
            beasts.Add(new Beast { A = an, X = x, Z = z, Yaw = a, Timer = (made % 4) * 0.7, Speed = an.Species == "cat" ? 0 : 1, Exhibit = true });
            made++;
        }
    }

    internal void ClearExhibits()
    {
        for (int i = beasts.Count - 1; i >= 0; i--)
            if (beasts[i].Exhibit) { beasts[i].A.Dispose(); beasts.RemoveAt(i); }
    }

    private void DropBeast(Beast b)
    {
        if(b.Owner==null&&b.Id!=null)Net.Mp.NativeExtras.I?.Release(b.Id);
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
        if (!toJef && rng.NextDouble() < .5) foreach (var scrap in MarketScraps)
        { double d=Hyp(scrap.X-b.X,scrap.Y-b.Z); if(d<30&&d>1) { ok=Aim(b,scrap.X+Rnd(-.4,.4),scrap.Y+Rnd(-.4,.4));break; } }
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
        if (b.A.Motion != "lie") b.A.Play("lie", 0.4f, plain: true);
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
                Scheldemist.Audio.LifeAnimalSounds.Hiss(b.X,b.Z);
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
