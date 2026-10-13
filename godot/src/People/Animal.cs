using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>
/// One dog, cat or pig of animals.scn (art-source/tools/blender/build_animals.py): its own skeleton of 47 bones, its rig's
/// clips sampled by bone name, a near copy (under 15 m) and a far copy, the people2 skin shader (normal-mapped fur,
/// linear mipmapped pictures, wet eyes and nose).
///
/// What the game asks for (Play) is the shared motion: idle, walk, run, sit, lie, sniff; that is all that goes between
/// players. What shows is chosen here from it: walk and run are a wish, and the gait (walk, trot or gallop) follows the
/// ground really covered, the cycle advanced by the distance over the stride so the paws stand still on the street;
/// at rest the animal now and then scratches, shakes, barks, begs, stretches, grooms or nods, and lying it may sleep
/// curled. Those flourishes are picked from the animal's stable id and the shared clock, so every game shows the same.
/// Each animal has its own size (a few per cent), pace and timing from its id.
/// </summary>
public sealed class Animal
{
    internal sealed class Clip
    {
        public string Name = "";
        public Animation Anim = null!;
        public float Length = 1, Stride, Duty = 0.6f, Speed, Cycle;
        public bool Loop = true;
        public string Kind = "pose", Base = "stand";
        public int[] Rot = Array.Empty<int>();
        public int Pos = -1;
        /// <summary>Gaits: where in the cycle each foot (FL, FR, HL, HR) comes down.</summary>
        public readonly Dictionary<string, float> Phases = new();
        /// <summary>Gaits: the toes (skeleton space, size 1) at 60 phases, to start a gait where the feet already are.</summary>
        public Vector3[,]? Toes;
    }

    internal sealed class Rig
    {
        public string Name = "", Species = "";
        public float H = 0.5f;
        public readonly Dictionary<string, Clip> Clips = new();
        public string[] Bones = Array.Empty<string>();
        public int Hips;
        public (string Leg, int Bone, Vector3 At)[] Contacts = Array.Empty<(string, int, Vector3)>();
        public bool HasHarness;
        public int HarnessBone = -1;
        public Vector3 HarnessCentre;
        public Vector2 HarnessRadius;
        /// <summary>The harness's trace rings and shaft tugs (left, right): bone and rest point (skeleton space, size 1).</summary>
        public (int Bone, Vector3 At)[] HarnessPoints = Array.Empty<(int, Vector3)>();
        public float TrotFrom, RunFrom;
        public Vector3[] StandToes = Array.Empty<Vector3>();
        public LegChain[] Legs = Array.Empty<LegChain>();
    }

    /// <summary>One leg's bones for the foot lock: girdle, upper, lower, pastern or metatarsus, paw; the joint helpers.</summary>
    internal sealed class LegChain
    {
        public string Leg = "";
        public int Parent, Upper, Lower, Distal, Paw;
        public Vector3 ContactAt;
        public (int h, int a, int b)[] Helpers = Array.Empty<(int, int, int)>();
    }

    private const int ToeSamples = 60;

    /// <summary>The toes of a gait clip at evenly spaced phases, by forward kinematics over the rig's rest skeleton.</summary>
    private static Vector3[,] ToeTable(Clip c, Skeleton3D sk, Rig rig)
    {
        int bc = sk.GetBoneCount();
        var glob = new Transform3D[bc];
        var table = new Vector3[ToeSamples, rig.Contacts.Length];
        for (int k = 0; k < ToeSamples; k++)
        {
            float t = k / (float)ToeSamples * c.Length;
            for (int b = 0; b < bc; b++)
            {
                var rest = sk.GetBoneRest(b);
                var rot = c.Rot[b] >= 0 ? c.Anim.RotationTrackInterpolate(c.Rot[b], t).Normalized() : rest.Basis.GetRotationQuaternion();
                var pos = b == rig.Hips && c.Pos >= 0 ? c.Anim.PositionTrackInterpolate(c.Pos, t) : rest.Origin;
                var local = new Transform3D(new Basis(rot), pos);
                int par = sk.GetBoneParent(b);
                glob[b] = par >= 0 ? glob[par] * local : local;
            }
            for (int i = 0; i < rig.Contacts.Length; i++)
            {
                var (_, bone, at) = rig.Contacts[i];
                table[k, i] = glob[bone] * sk.GetBoneGlobalRest(bone).AffineInverse() * at;
            }
        }
        return table;
    }

    /// <summary>The phase of gait `c` whose feet stand nearest to `toes` (skeleton space, size 1).</summary>
    private static float NearestPhase(Clip c, Vector3[] toes)
    {
        if (c.Toes == null) return 0;
        float best = float.MaxValue;
        int at = 0;
        for (int k = 0; k < ToeSamples; k++)
        {
            float cost = 0;
            for (int i = 0; i < toes.Length; i++) cost += (c.Toes[k, i] - toes[i]).LengthSquared();
            if (cost < best) { best = cost; at = k; }
        }
        return at / (float)ToeSamples;
    }

    private Vector3[] ToesNow(Clip c, float ph)
    {
        var o = new Vector3[R.Contacts.Length];
        if (c.Toes == null) return R.StandToes;
        int k = (int)(ph * ToeSamples) % ToeSamples;
        for (int i = 0; i < o.Length; i++) o[i] = c.Toes[k, i];
        return o;
    }

    public const float NearRange = 15;
    private static ModelLibrary.Model? model;
    private static readonly Dictionary<string, Rig> rigs = new();
    private static readonly Dictionary<string, Rig> rigOfKind = new();
    private static bool tried;
    private static int made;
    public static IEnumerable<string> Kinds => rigOfKind.Keys;
    internal static Rig? RigOf(string kind) => rigOfKind.GetValueOrDefault(kind);

    public static bool Ready
    {
        get
        {
            if (tried) return model != null;
            tried = true;
            model = Load();
            return model != null;
        }
    }

    public static void Forget()
    {
        foreach (var stack in pool.Values) foreach (var a in stack) if (GodotObject.IsInstanceValid(a.Group)) a.Group.QueueFree();
        pool.Clear(); outNow.Clear();
        model?.Scene.Free();
        model = null;
        tried = false;
        rigs.Clear();
        rigOfKind.Clear();
    }

    /// <summary>The pictures (art-source/tools/blender/animals/pictures.py): each kind's colour, each rig's normal, the
    /// harness's; imported by Godot as mipmapped BPTC colour and RGTC normals, the glb holding only stand-ins.</summary>
    private const string PictureRoot = "res://assets/animal-pictures/";
    public static long PictureBytes { get; private set; }

    private static Texture2D Picture(string name, bool normal)
    {
        var tex = ResourceLoader.Load<Texture2D>(PictureRoot + name + ".png") ?? throw new System.IO.FileNotFoundException("animal picture " + name);
        using var image = tex.GetImage();
        if (image == null || !image.IsCompressed() || !image.HasMipmaps())
            throw new System.IO.InvalidDataException("Animal pictures require imported GPU compression and mipmaps: " + name);
        var want = normal ? Image.Format.RgtcRg : Image.Format.BptcRgba;
        if (image.GetFormat() != want) throw new System.IO.InvalidDataException("Animal picture format must be " + want + ": " + name);
        PictureBytes += image.GetData().LongLength;
        return tex;
    }

    private static ModelLibrary.Model? Load()
    {
        if (ModelLibrary.NativeScene == null || !ModelLibrary.Available("animals") || ModelLibrary.NativeScene("animals") is not { } scene) return null;
        var shader = People2Material.Skin();
        var mats = new Dictionary<Material, Material>();
        // which rig each kind is on (its normal picture is the rig's)
        var rigName = new Dictionary<string, string>();
        foreach (var c in scene.GetChildren())
            if (c is Node3D r && ModelExtras.Get("animals", r.Name.ToString(), "animal") is { } f) rigName[r.Name.ToString()] = f.GetProperty("rig").GetString()!;
        PictureBytes = 0;
        var pics = new Dictionary<string, Texture2D>();
        Texture2D Pic(string name, bool normal) => pics.TryGetValue(name, out var t) ? t : pics[name] = Picture(name, normal);
        foreach (var n in BakedWorld.All(scene))
        {
            if (n is not MeshInstance3D mi || mi.Mesh == null) continue;
            mi.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
            string nm = mi.Name.ToString();
            if (nm.EndsWith("_lod0", StringComparison.Ordinal)) mi.VisibilityRangeEnd = NearRange;
            if (nm.EndsWith("_lod1", StringComparison.Ordinal)) mi.VisibilityRangeBegin = NearRange;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                if (mi.Mesh.SurfaceGetMaterial(s) is not BaseMaterial3D bm) continue;
                if (!mats.TryGetValue(bm, out var m))
                {
                    string kind = bm.ResourceName;
                    var sm = new ShaderMaterial { Shader = shader, ResourceName = "animal_" + kind };
                    sm.SetShaderParameter("layered_pictures", false);
                    sm.SetShaderParameter("albedo", Colors.White);
                    sm.SetShaderParameter("tex", Pic(kind + "_colour", false));
                    if (rigName.TryGetValue(kind, out var rig)) sm.SetShaderParameter("skin_normal", Pic(rig + "_normal", true));
                    else sm.SetShaderParameter("normal_strength", 0f);
                    if (Main.I.Arg("animals-normal-strength") is { Length: > 0 } ns) sm.SetShaderParameter("normal_strength", float.Parse(ns, System.Globalization.CultureInfo.InvariantCulture));
                    // the eyes (vertex red 1), the wet nose (0.45) and the coat's sheen (a black coat 0.14) catch the light
                    mats[bm] = m = sm;
                }
                mi.Mesh.SurfaceSetMaterial(s, m);
            }
        }
        var result = new ModelLibrary.Model { Name = "animals", Scene = scene, Materials = mats.Count };
        foreach (var c in scene.GetChildren())
            if (c is AnimationPlayer ap)
            {
                foreach (var lib in ap.GetAnimationLibraryList())
                    foreach (var name in ap.GetAnimationLibrary(lib).GetAnimationList()) result.Clips[name] = ap.GetAnimationLibrary(lib).GetAnimation(name);
            }
            else if (c is Node3D root)
            {
                root.Position = Vector3.Zero;
                result.Roots[root.Name] = root;
            }
        foreach (var (kind, root) in result.Roots)
        {
            if (ModelExtras.Get("animals", kind, "animal") is not { } facts) continue;
            string rn = facts.GetProperty("rig").GetString()!;
            if (!rigs.TryGetValue(rn, out var rig))
            {
                rig = MakeRig(rn, facts, root.GetNode<Skeleton3D>("Skeleton3D"), result);
                rigs[rn] = rig;
            }
            rigOfKind[kind] = rig;
        }
        GD.Print($"animals: {rigOfKind.Count} kinds on {rigs.Count} rigs, {result.Clips.Count} clips, {mats.Count} materials, {pics.Count} pictures ({PictureBytes / 1048576.0:0.0} MB)");
        return rigOfKind.Count > 0 ? result : null;
    }

    private static Rig MakeRig(string name, JsonElement facts, Skeleton3D sk, ModelLibrary.Model m)
    {
        var rig = new Rig { Name = name, Species = facts.GetProperty("species").GetString()!, H = facts.GetProperty("H").GetSingle() };
        rig.Bones = new string[sk.GetBoneCount()];
        for (int b = 0; b < rig.Bones.Length; b++) rig.Bones[b] = sk.GetBoneName(b);
        rig.Hips = sk.FindBone("hips");
        var clips = facts.GetProperty("clips");
        foreach (var c in clips.EnumerateObject())
        {
            if (!m.Clips.TryGetValue(name + "_" + c.Name, out var anim)) continue;
            var clip = new Clip { Name = c.Name, Anim = anim, Length = (float)anim.Length, Rot = new int[rig.Bones.Length] };
            Array.Fill(clip.Rot, -1);
            var f = c.Value;
            clip.Kind = f.GetProperty("kind").GetString()!;
            clip.Base = f.GetProperty("base").GetString()!;
            clip.Loop = f.GetProperty("loop").GetBoolean();
            if (f.TryGetProperty("stride", out var st)) clip.Stride = st.GetSingle();
            if (f.TryGetProperty("duty", out var du)) clip.Duty = du.GetSingle();
            if (f.TryGetProperty("speed", out var sp)) clip.Speed = sp.GetSingle();
            if (f.TryGetProperty("cycle", out var cy)) clip.Cycle = cy.GetSingle();
            if (f.TryGetProperty("phases", out var ph)) foreach (var leg in ph.EnumerateObject()) clip.Phases[leg.Name] = leg.Value.GetSingle();
            for (int t = 0; t < anim.GetTrackCount(); t++)
            {
                string path = anim.TrackGetPath(t).ToString();
                int colon = path.LastIndexOf(':');
                int bone = colon >= 0 ? sk.FindBone(path[(colon + 1)..]) : -1;
                if (bone < 0) continue;
                if (anim.TrackGetType(t) == Animation.TrackType.Rotation3D) clip.Rot[bone] = t;
                else if (bone == rig.Hips && anim.TrackGetType(t) == Animation.TrackType.Position3D) clip.Pos = t;
            }
            rig.Clips[c.Name] = clip;
        }
        var contacts = new List<(string, int, Vector3)>();
        foreach (var c in facts.GetProperty("contacts").EnumerateObject())
        {
            var r = c.Value.GetProperty("rest");
            contacts.Add((c.Name, sk.FindBone(c.Value.GetProperty("bone").GetString()!), new Vector3(r[0].GetSingle(), r[1].GetSingle(), r[2].GetSingle())));
        }
        rig.Contacts = contacts.ToArray();
        if (facts.TryGetProperty("harness", out var h))
        {
            rig.HasHarness = true;
            rig.HarnessBone = sk.FindBone(h.GetProperty("bone").GetString()!);
            var c = h.GetProperty("centre");
            var rr = h.GetProperty("radius");
            rig.HarnessCentre = new Vector3(c[0].GetSingle(), c[1].GetSingle(), c[2].GetSingle());
            rig.HarnessRadius = new Vector2(rr[0].GetSingle(), rr[1].GetSingle());
            if (h.TryGetProperty("points", out var pts))
            {
                var list = new List<(int, Vector3)>();
                foreach (string key in new[] { "traceL", "traceR", "tugL", "tugR" })
                    if (pts.TryGetProperty(key, out var q))
                    {
                        var at = q.GetProperty("rest");
                        list.Add((sk.FindBone(q.GetProperty("bone").GetString()!), new Vector3(at[0].GetSingle(), at[1].GetSingle(), at[2].GetSingle())));
                    }
                if (list.Count == 4 && list.All(x => x.Item1 >= 0)) rig.HarnessPoints = list.ToArray();
            }
        }
        foreach (var clip in rig.Clips.Values)
            if (clip.Kind == "gait") clip.Toes = ToeTable(clip, sk, rig);
        var legs = new List<LegChain>();
        foreach (var (leg, bone, at) in rig.Contacts)
        {
            string S = leg[1..];
            bool front = leg[0] == 'F';
            int F(string n) => sk.FindBone(n + S);
            var L = new LegChain { Leg = leg, Upper = front ? F("humerus") : F("thigh"),
                Lower = front ? F("forearm") : F("shin"), Distal = front ? F("pastern") : F("meta"), Paw = bone, ContactAt = at };
            L.Parent = L.Upper >= 0 ? sk.GetBoneParent(L.Upper) : -1;
            var hs = front ? new[] { ("shoulderHelp", "scapula", "humerus"), ("elbowHelp", "humerus", "forearm"), ("carpusHelp", "forearm", "pastern") }
                           : new[] { ("hipHelp", "", "thigh"), ("kneeHelp", "thigh", "shin"), ("hockHelp", "shin", "meta") };
            L.Helpers = hs.Select(h => (F(h.Item1), h.Item2 == "" ? sk.FindBone("hips") : F(h.Item2), F(h.Item3))).Where(h => h.Item1 >= 0 && h.Item2 >= 0 && h.Item3 >= 0).ToArray();
            if (L.Parent >= 0 && L.Upper >= 0 && L.Lower >= 0 && L.Distal >= 0 && L.Paw >= 0) legs.Add(L);
        }
        rig.Legs = legs.ToArray();
        rig.StandToes = new Vector3[rig.Contacts.Length];
        for (int i = 0; i < rig.Contacts.Length; i++) rig.StandToes[i] = rig.Contacts[i].At;
        float Speed(string g, float d) => rig.Clips.TryGetValue(g, out var cl) && cl.Speed > 0 ? cl.Speed : d;
        float walk = Speed("walk", 0.9f), trot = Speed("trot", 2f), run = Speed("run", 3.5f);
        rig.TrotFrom = (walk + trot) * 0.5f;
        rig.RunFrom = (trot + run) * 0.5f;
        return rig;
    }

    // The pool: animals copied while the game loads, hidden in the view, and handed out and back again, so no animal
    // is ever built in front of the player (a copy and its first entry into the tree took 2-3 ms each, and a street
    // of new animals at once 20-35 ms). Each kind keeps its own; a kind that runs dry makes one more and counts it.
    private static readonly Dictionary<string, Stack<Animal>> pool = new();
    private static readonly Dictionary<string, int> outNow = new();
    /// <summary>Animals made on demand because their kind's pool was empty (the frame-time proof expects none).</summary>
    public static int ColdMakes { get; private set; }
    /// <summary>Animals waiting in the pool now, all kinds.</summary>
    public static int Pooled { get { int n = 0; foreach (var st in pool.Values) n += st.Count; return n; } }

    /// <summary>Copies of each kind made ahead (at loading): `want(kind)` in all, counting those waiting and those out.</summary>
    public static void Prepare(Func<string, int> want)
    {
        if (!Ready || Main.I?.View is not { } view) return;
        foreach (var kind in rigOfKind.Keys)
        {
            if (!pool.TryGetValue(kind, out var stack)) pool[kind] = stack = new Stack<Animal>();
            int need = want(kind) - stack.Count - outNow.GetValueOrDefault(kind);
            for (int i = 0; i < need; i++)
            {
                if (model!.Copy(kind) is not { } root) break;
                var a = new Animal(kind, root, rigOfKind[kind]) { pooled = true };
                view.AddChild(a.Group);
                stack.Push(a);
            }
        }
    }

    /// <summary>An animal of this kind, in the view and hidden until it is placed; `id` (stable: a haunt, an owner, a
    /// cart) chooses its size, pace and flourishes. From the pool when one waits there.</summary>
    public static Animal? Make(string kind, string? id = null)
    {
        if (!Ready || !rigOfKind.TryGetValue(kind, out var rig)) return null;
        Animal? a = null;
        if (pool.TryGetValue(kind, out var stack))
            while (stack.Count > 0 && a == null)
            {
                var b = stack.Pop();
                if (GodotObject.IsInstanceValid(b.Group) && b.Group.IsInsideTree()) a = b;
            }
        if (a == null)
        {
            if (model!.Copy(kind) is not { } root) return null;
            a = new Animal(kind, root, rig);
            ColdMakes++;
        }
        if (a.Group.GetParent() == null) Main.I.View.AddChild(a.Group);
        a.Reset(id ?? kind + ":" + made++);
        a.pooled = false;
        outNow[kind] = outNow.GetValueOrDefault(kind) + 1;
        return a;
    }

    public readonly string Kind, Species;
    public readonly Node3D Group = new();
    private readonly Node3D root;
    private readonly Skeleton3D sk;
    internal readonly Rig R;
    private uint seed;
    public float Size { get; private set; }
    private float pace, rate;
    private bool pooled;
    /// <summary>The shared motion (the six that go between players).</summary>
    public string? Motion { get; private set; }
    /// <summary>The clip that shows now (local: walk, trot, run, idle, scratch ...).</summary>
    public string ClipName => clip?.Name ?? "";
    public float Speed { get; private set; }
    public float Phase => phase;
    private Clip? clip, prev;
    private float time, phase, fade, fadeLen, prevPhase, mixT, mixLen;
    private string? wish;
    private string rest = "idle";
    private bool plain;
    private double nextLook;
    private Vector3 last;
    private bool hasLast;
    private readonly Quaternion[] fadeRot;
    private Vector3 fadeHips;
    // the foot lock of a gait change: while two gaits blend, a paw the new gait stands on stays where it is set down
    // until the new gait lifts it
    private readonly Vector3[] lockAt = new Vector3[4];
    private readonly float[] lockWeight = new float[4], lockDrop = new float[4];
    private readonly bool[] locked = new bool[4];
    private bool planting;
    private static readonly Random Rng = new();

    private Animal(string kind, Node3D root, Rig rig)
    {
        Kind = kind;
        R = rig;
        Species = rig.Species;
        this.root = root;
        sk = root.GetNode<Skeleton3D>("Skeleton3D");
        fadeRot = new Quaternion[sk.GetBoneCount()];
        Group.Name = kind;
        Group.Visible = false;
        Group.AddChild(root);
        foreach (var n in BakedWorld.All(root))
            if (n is MeshInstance3D mi && mi.Name.ToString().Contains("_harness", StringComparison.Ordinal))
                (mi.Name.ToString().Contains("_harness_tugs", StringComparison.Ordinal) ? tugMeshes : harnessMeshes).Add(mi);
        if (harnessMeshes.Count > 0)
            for (int i = 0; i < 2; i++)
                if (model!.Copy("dog_trace") is { } t) { t.Name = i == 0 ? "trace_left" : "trace_right"; Group.AddChild(t); traces[i] = t; }
        ShowHarness(false);
    }

    /// <summary>A fresh start for a new owner of this copy: its own size (a few per cent), pace and tempo from the id.</summary>
    private void Reset(string id)
    {
        seed = Hash(id);
        Size = 1 + (Unit(seed, 1) - 0.5f) * (Species == "pig" ? 0.08f : 0.12f);
        pace = 0.92f + Unit(seed, 2) * 0.16f;
        rate = 0.9f + Unit(seed, 3) * 0.2f;
        root.Scale = Vector3.One * Size;
        clip = prev = null;
        time = phase = fade = fadeLen = prevPhase = mixT = mixLen = 0;
        wish = null; rest = "idle"; plain = false; nextLook = 0; hasLast = false; Speed = 0; Motion = null;
        Array.Clear(locked); Array.Clear(lockWeight); Array.Clear(lockDrop); planting = false;
        Group.Position = Vector3.Zero; Group.Rotation = Vector3.Zero; Group.Scale = Vector3.One;
        Group.Visible = false;
        ShowHarness(false);
    }

    private static uint Hash(string s)
    {
        uint h = 0x811c9dc5;
        foreach (char c in s) h = unchecked((h ^ c) * 0x01000193u);
        h ^= h >> 15; h = unchecked(h * 0x2c1b3c6du); h ^= h >> 12;
        return h;
    }

    private static float Unit(uint h, int k)
    {
        uint x = unchecked(h ^ ((uint)k * 0x9e3779b9u));
        x ^= x >> 16; x = unchecked(x * 0x7feb352du); x ^= x >> 15; x = unchecked(x * 0x846ca68bu); x ^= x >> 16;
        return (x & 0xffffff) / 16777216f;
    }

    /// <summary>The shared clock (the server's when playing together), for flourishes all games agree on.</summary>
    private static double Now => Net.Mp.Together.I is { Connected: true } t ? t.ServerNow / 1000.0 : Time.GetTicksMsec() / 1000.0;

    /// <summary>Once it is in the scene: idle, not all in step.</summary>
    public void Start()
    {
        Show("idle", 0);
        Motion = "idle";
        time = Unit(seed, 4) * (clip?.Length ?? 1);
        phase = Unit(seed, 5);
    }

    /// <summary>The shared motion: idle, walk, run, sit, lie, sniff. plain: no flourish (a lie stays a lie: cowering in the storm).</summary>
    public void Play(string m, float fade = 0.25f, bool plain = false)
    {
        this.plain = plain;
        if (m is "walk" or "run")
        {
            wish = m;
            return;
        }
        wish = null;
        if (Motion == m && clip != null && (clip.Base == RestOf(m) || clip.Name == rest)) return;
        Motion = m;
        rest = RestClip(m);
        Show(rest, fade);
        nextLook = Now + 2 + Unit(seed, 6) * 4;
    }

    private static string RestOf(string m) => m switch { "sit" => "sit", "lie" => "lie", _ => "stand" };

    /// <summary>The clip for a shared rest: lying may be sleep (curled), more so at night, by the animal's id and the hour.</summary>
    private string RestClip(string m)
    {
        if (m == "lie" && !plain && R.Clips.ContainsKey("sleep"))
        {
            float night = Main.I?.GetNodeOrNull<Town.Townspeople>("Townspeople") is { } town && (town.Hour >= 21 || town.Hour < 6) ? 0.7f : 0.35f;
            if (Unit(seed, 7 + (int)(Now / 600)) < night) return "sleep";
        }
        return R.Clips.ContainsKey(m) ? m : "idle";
    }

    private void Show(string name, float fadeSecs)
    {
        if (!R.Clips.TryGetValue(name, out var c)) c = R.Clips["idle"];
        if (clip == c) return;
        if (clip != null && clip.Kind == "gait" && c.Kind == "gait" && fadeSecs > 0)
        {
            // gait to gait: both stay live, each cycle moved on by the ground covered; the new one starts where its
            // feet stand nearest to where they are now, and each paw it stands on is planted where it is set down
            prev = clip;
            prevPhase = phase;
            phase = NearestPhase(c, ToesNow(clip, phase));
            planting = R.Legs.Length == R.Contacts.Length;
            mixT = 0;
            mixLen = 0.25f;
            fade = 0;
            clip = c;
            return;
        }
        prev = null;
        if (clip != null && fadeSecs > 0)
        {
            for (int b = 0; b < fadeRot.Length; b++) fadeRot[b] = sk.GetBonePoseRotation(b);
            fadeHips = sk.GetBonePosePosition(R.Hips);
            fade = fadeLen = fadeSecs;
        }
        else fade = 0;
        // from a stand into a gait: at the phase whose feet are nearest the standing feet
        if (c.Kind == "gait" && (clip == null || clip.Kind != "gait")) phase = NearestPhase(c, R.StandToes);
        clip = c;
        if (c.Kind != "gait") time = 0;
    }

    /// <summary>Flourishes for each rest, with how often one is taken at a look round (per mille of looks).</summary>
    private static readonly Dictionary<string, (string clip, int share)[]> Flourishes = new()
    {
        ["dog:stand"] = new[] { ("shake", 90), ("bark", 110), ("sniff", 0) },
        ["dog:sit"] = new[] { ("scratch", 160), ("beg", 70) },
        ["cat:stand"] = new[] { ("stretch", 140) },
        ["cat:sit"] = new[] { ("groom", 260) },
        ["pig:stand"] = new[] { ("nod", 300) },
        ["pig:lie"] = new[] { ("wallow", 220) },
    };

    private void MaybeFlourish()
    {
        if (plain || clip == null || clip.Kind == "once" || clip.Kind == "gait") return;
        double now = Now;
        if (now < nextLook) return;
        // looks every 6-11 s, on the shared clock; which one from the id and the look's number
        long slot = (long)Math.Floor(now / 8.0);
        nextLook = (slot + 1) * 8.0 + Unit(seed, 8) * 3;
        if (!Flourishes.TryGetValue(Species + ":" + clip.Base, out var list) || clip.Name != rest) return;
        int roll = (int)(Unit(seed, (int)(slot % 100000) + 11) * 1000);
        foreach (var (name, share) in list)
        {
            if (roll < share)
            {
                if (R.Clips.ContainsKey(name)) Show(name, 0.3f);
                return;
            }
            roll -= share;
        }
    }

    public void Update(float dt)
    {
        if (dt <= 0) return;
        // how far it really went (a jump of more than 2 m is a placement, not a step)
        var p = Group.GlobalPosition;
        float d = 0;
        if (hasLast)
        {
            d = new Vector2(p.X - last.X, p.Z - last.Z).Length();
            if (d > 2) d = 0;
            float inst = d / dt;
            Speed += (inst - Speed) * Math.Min(1, dt * 8);
        }
        last = p;
        hasLast = true;
        if (wish != null)
        {
            bool going = clip?.Kind == "gait";
            if (Speed > (going ? 0.12f : 0.2f))
            {
                // the gait the speed calls for, with some hysteresis and this animal's own pace
                float v = Speed / Size;
                string now = clip?.Name ?? "walk";
                float trotAt = R.TrotFrom * pace, runAt = R.RunFrom * pace;
                string g = v > (now == "run" ? runAt * 0.9f : runAt) ? "run" : v > (now is "trot" or "run" ? trotAt * 0.9f : trotAt) ? "trot" : "walk";
                if (!R.Clips.ContainsKey(g)) g = "walk";
                // change gait only as a hind foot comes down (phase 0 or a half in every gait), never mid-blend
                if (!going || g == now || prev == null) Show(g, going ? 0.22f : 0.2f);
                Motion = g == "run" ? "run" : "walk";
            }
            else if (going || Motion == null)
            {
                Show("idle", 0.2f);
                Motion = "idle";
                rest = "idle";
            }
        }
        else MaybeFlourish();
        var c = clip!;
        if (c.Kind == "gait")
        {
            // one cycle of the clip is one stride: the cycle moves on by the distance covered (the paws stay put)
            phase = (phase + d / (c.Stride * Size)) % 1f;
            time = phase * c.Length;
            if (prev != null)
            {
                prevPhase = (prevPhase + d / (prev.Stride * Size)) % 1f;
                mixT += dt;
                if (mixT >= mixLen) { prev = null; planting = false; }
            }
        }
        else
        {
            prev = null;
            time += dt * rate;
            if (time >= c.Length)
            {
                if (c.Loop) time %= c.Length;
                else
                {
                    time = c.Length;
                    Show(rest, 0.3f);
                    c = clip!;
                }
            }
        }
        Pose(dt);
        if (planting || lockWeight[0] + lockWeight[1] + lockWeight[2] + lockWeight[3] > 0) Locks(dt);
    }

    /// <summary>While two gaits blend, plant each paw the new gait stands on where it is set down (two-bone reach of
    /// the upper leg) and hold it there until the new gait lifts it; then let it go over a moment.</summary>
    private void Locks(float dt)
    {
        var c = clip;
        if (c == null || c.Kind != "gait" || c.Toes == null) { Array.Clear(locked); Array.Clear(lockWeight); planting = false; return; }
        var xf = sk.GlobalTransform;
        var toSk = xf.AffineInverse();
        int k = (int)(phase * ToeSamples) % ToeSamples;
        for (int i = 0; i < R.Legs.Length && i < 4; i++)
        {
            var L = R.Legs[i];
            float sn = ((phase - c.Phases.GetValueOrDefault(L.Leg)) % 1 + 1) % 1;
            bool stance = sn < c.Duty * 0.97f;
            if (locked[i] && !stance) locked[i] = false;  // the new gait lifts it: let it go, quickly
            if (!locked[i] && planting && stance && lockWeight[i] <= 0)
            {
                // set down where the blend has it, on the new gait's ground; a paw still in the air comes down quickly
                var toe = sk.GetBoneGlobalPose(L.Paw) * sk.GetBoneGlobalRest(L.Paw).AffineInverse() * L.ContactAt;
                float ground = c.Toes[k, i].Y;
                lockAt[i] = xf * new Vector3(toe.X, ground, toe.Z);
                lockDrop[i] = toe.Y - ground > 0.004f ? 0 : 1;
                locked[i] = true;
                lockWeight[i] = 1;
            }
            if (locked[i]) lockDrop[i] = Math.Min(1, lockDrop[i] + dt / 0.08f);
            else lockWeight[i] = Math.Max(0, lockWeight[i] - dt / 0.12f);
            if (lockWeight[i] <= 0) continue;
            Reach(L, toSk * lockAt[i], lockWeight[i], lockDrop[i]);
        }
    }

    private void Reach(LegChain L, Vector3 target, float weight, float drop)
    {
        var gS = sk.GetBoneGlobalPose(L.Upper);
        var gE = sk.GetBoneGlobalPose(L.Lower);
        var gC = sk.GetBoneGlobalPose(L.Distal);
        var gP = sk.GetBoneGlobalPose(L.Paw);
        var toe = gP * sk.GetBoneGlobalRest(L.Paw).AffineInverse() * L.ContactAt;
        target = new Vector3(Mathf.Lerp(toe.X, target.X, weight), Mathf.Lerp(toe.Y, target.Y, weight * drop), Mathf.Lerp(toe.Z, target.Z, weight));
        Vector3 S = gS.Origin, E = gE.Origin, C = gC.Origin;
        var want = target - (toe - C);
        float L1 = (E - S).Length(), L2 = (C - E).Length();
        var d = want - S;
        float D = Math.Clamp(d.Length(), Math.Abs(L1 - L2) + 1e-4f, L1 + L2 - 1e-4f);
        var u = d.Normalized();
        var pole = (E - S) - u * (E - S).Dot(u);
        if (pole.LengthSquared() < 1e-10f || L1 < 1e-5f || L2 < 1e-5f) return;
        pole = pole.Normalized();
        float ca = Math.Clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1);
        var En = S + u * (L1 * ca) + pole * (L1 * MathF.Sqrt(1 - ca * ca));
        var Cn = S + u * D;
        var bU = new Basis(new Quaternion((E - S).Normalized(), (En - S).Normalized())) * gS.Basis;
        var bL = new Basis(new Quaternion((C - E).Normalized(), (Cn - En).Normalized())) * gE.Basis;
        var bParent = sk.GetBoneGlobalPose(L.Parent).Basis;
        sk.SetBonePoseRotation(L.Upper, (bParent.Inverse() * bU).GetRotationQuaternion());
        sk.SetBonePoseRotation(L.Lower, (bU.Inverse() * bL).GetRotationQuaternion());
        sk.SetBonePoseRotation(L.Distal, (bL.Inverse() * gC.Basis).GetRotationQuaternion());
        // the joint helpers turn half as far as the bone below them, as baked: local = half(pose * rest^-1) * own rest
        foreach (var (h, _, b) in L.Helpers)
        {
            var rb = sk.GetBoneRest(b).Basis.GetRotationQuaternion();
            var turn = (sk.GetBonePoseRotation(b) * rb.Inverse()).Normalized();
            sk.SetBonePoseRotation(h, (Quaternion.Identity.Slerp(turn, 0.5f) * sk.GetBoneRest(h).Basis.GetRotationQuaternion()).Normalized());
        }
    }

    private void Pose(float dt)
    {
        var c = clip!;
        float blend = 1;
        if (fade > 0)
        {
            fade = Math.Max(0, fade - dt);
            blend = 1 - fade / fadeLen;
            blend = blend * blend * (3 - 2 * blend);
        }
        float t = Math.Clamp(time, 0, c.Length);
        var p = prev;
        float w = 1, tp = 0;
        if (p != null)
        {
            w = Math.Clamp(mixT / mixLen, 0, 1);
            w = w * w * (3 - 2 * w);
            tp = prevPhase * p.Length;
        }
        for (int b = 0; b < c.Rot.Length; b++)
        {
            int tr = c.Rot[b];
            if (tr < 0) continue;
            var q = c.Anim.RotationTrackInterpolate(tr, t).Normalized();
            if (p != null && p.Rot[b] >= 0) q = p.Anim.RotationTrackInterpolate(p.Rot[b], tp).Normalized().Slerp(q, w);
            if (blend < 1) q = fadeRot[b].Normalized().Slerp(q, blend);
            sk.SetBonePoseRotation(b, q);
        }
        if (c.Pos >= 0)
        {
            var h = c.Anim.PositionTrackInterpolate(c.Pos, t);
            if (p != null && p.Pos >= 0) h = p.Anim.PositionTrackInterpolate(p.Pos, tp).Lerp(h, w);
            sk.SetBonePosePosition(R.Hips, blend < 1 ? fadeHips.Lerp(h, blend) : h);
        }
    }

    /// <summary>For proofs: where each paw's toe is in the world now.</summary>
    public IEnumerable<(string leg, Vector3 at)> Toes()
    {
        var xf = sk.GlobalTransform;
        foreach (var (leg, bone, rest) in R.Contacts)
            yield return (leg, xf * (sk.GetBoneGlobalPose(bone) * sk.GetBoneGlobalRest(bone).AffineInverse() * rest));
    }

    /// <summary>For proofs and the dog carts: a clip by its own name, held at a phase or time.</summary>
    internal void Hold(string name, float at)
    {
        if (!R.Clips.TryGetValue(name, out var c)) return;
        clip = c;
        prev = null;
        fade = 0;
        wish = null;
        Array.Clear(locked);
        Array.Clear(lockWeight);
        planting = false;
        if (c.Kind == "gait") { phase = at % 1f; time = phase * c.Length; }
        else time = Math.Clamp(at, 0, c.Length);
        Pose(0);
    }

    private readonly List<MeshInstance3D> harnessMeshes = new(), tugMeshes = new();
    private readonly Node3D?[] traces = new Node3D?[2];

    /// <summary>Hitched to a cart: each trace runs from its ring on the breast strap to its hook on the shaft (world
    /// points); the tugs show when the shafts' ends lie in them (the dog in the shafts), not for a dog beside them.</summary>
    public void Hitch(Vector3 hookL, Vector3 hookR, Vector3? tipL, Vector3? tipR)
    {
        if (HarnessPoints() is not { } h) return;
        Strap(traces[0], h.traceL, hookL);
        Strap(traces[1], h.traceR, hookR);
        foreach (var mi in tugMeshes) mi.Visible = tipL != null && tipR != null;
    }

    private static void Strap(Node3D? t, Vector3 from, Vector3 to)
    {
        if (t == null) return;
        var d = to - from;
        float len = d.Length();
        t.Visible = len > 0.01f;
        if (!t.Visible) return;
        // the trace model is a strap a metre long along +z from its ring end: stretched to the hook
        t.GlobalTransform = new Transform3D(Basis.LookingAt(d / len, Vector3.Up, true) * Basis.FromScale(new Vector3(1, 1, len)), from);
    }
    /// <summary>The draught dog's own harness (animals.glb: breast strap, back pad and girth with the shaft tugs,
    /// skinned to its chest so it moves with it), shown on the cart dogs only. False for a kind without one.</summary>
    public bool ShowHarness(bool on)
    {
        foreach (var mi in harnessMeshes) mi.Visible = on;
        foreach (var mi in tugMeshes) mi.Visible = on;
        foreach (var t in traces) if (t != null) t.Visible = false;
        return harnessMeshes.Count > 0;
    }

    /// <summary>Where the harness's trace rings (at the ends of the breast strap) and shaft tugs (at the girth) are now,
    /// in the world, left then right: the cart's traces and shafts are set to meet them. Null without a harness.</summary>
    public (Vector3 traceL, Vector3 traceR, Vector3 tugL, Vector3 tugR)? HarnessPoints()
    {
        if (R.HarnessPoints.Length < 4) return null;
        var xf = sk.GlobalTransform;
        Vector3 At(int i) { var (bone, rest) = R.HarnessPoints[i]; return xf * (sk.GetBoneGlobalPose(bone) * sk.GetBoneGlobalRest(bone).AffineInverse() * rest); }
        return (At(0), At(1), At(2), At(3));
    }

    /// <summary>Back to the pool: hidden, what others hung on it taken off, ready for the next owner.</summary>
    public void Dispose()
    {
        if (pooled || !GodotObject.IsInstanceValid(Group)) return;
        pooled = true;
        outNow[Kind] = Math.Max(0, outNow.GetValueOrDefault(Kind) - 1);
        foreach (var n in Group.GetChildren()) if (n != root && n != traces[0] && n != traces[1]) n.QueueFree();
        Group.Visible = false;
        ShowHarness(false);
        if (!pool.TryGetValue(Kind, out var stack)) pool[Kind] = stack = new Stack<Animal>();
        stack.Push(this);
    }
}
