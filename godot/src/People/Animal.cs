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
        model?.Scene.Free();
        model = null;
        tried = false;
        rigs.Clear();
        rigOfKind.Clear();
    }

    private static ModelLibrary.Model? Load()
    {
        if (ModelLibrary.NativeScene == null || !ModelLibrary.Available("animals") || ModelLibrary.NativeScene("animals") is not { } scene) return null;
        var shader = People2Material.Skin();
        var mats = new Dictionary<Material, Material>();
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
                    var sm = new ShaderMaterial { Shader = shader, ResourceName = "animal_" + bm.ResourceName };
                    sm.SetShaderParameter("albedo", bm.AlbedoColor);
                    if (bm.AlbedoTexture is { } tex) sm.SetShaderParameter("tex", People2Material.Mipmapped(tex, true));
                    if (bm.NormalTexture is { } nrm) sm.SetShaderParameter("skin_normal", People2Material.Mipmapped(nrm, false));
                    else sm.SetShaderParameter("normal_strength", 0f);
                    if (Main.I.Arg("animals-normal-strength") is { Length: > 0 } ns) sm.SetShaderParameter("normal_strength", float.Parse(ns, System.Globalization.CultureInfo.InvariantCulture));
                    sm.SetShaderParameter("alpha_cut", 0f);
                    // the eyes (vertex red 1) and the wet nose (0.45) catch the light
                    sm.SetShaderParameter("eye_vertex_flag", 1f);
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
        GD.Print($"animals: {rigOfKind.Count} kinds on {rigs.Count} rigs, {result.Clips.Count} clips, {mats.Count} materials");
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

    /// <summary>A new animal of this kind; `id` (stable: a haunt, an owner, a cart) chooses its size, pace and flourishes.</summary>
    public static Animal? Make(string kind, string? id = null)
    {
        if (!Ready || !rigOfKind.TryGetValue(kind, out var rig) || model!.Copy(kind) is not { } root) return null;
        return new Animal(kind, root, rig, id ?? kind + ":" + made++);
    }

    public readonly string Kind, Species;
    public readonly Node3D Group = new();
    private readonly Node3D root;
    private readonly Skeleton3D sk;
    internal readonly Rig R;
    private readonly uint seed;
    public readonly float Size;
    private readonly float pace, rate;
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

    private Animal(string kind, Node3D root, Rig rig, string id)
    {
        Kind = kind;
        R = rig;
        Species = rig.Species;
        this.root = root;
        sk = root.GetNode<Skeleton3D>("Skeleton3D");
        seed = Hash(id);
        // a size of its own (a few per cent), a pace and a tempo
        Size = 1 + (Unit(seed, 1) - 0.5f) * (Species == "pig" ? 0.08f : 0.12f);
        pace = 0.92f + Unit(seed, 2) * 0.16f;
        rate = 0.9f + Unit(seed, 3) * 0.2f;
        root.Scale = Vector3.One * Size;
        fadeRot = new Quaternion[sk.GetBoneCount()];
        Group.Name = kind;
        Group.AddChild(root);
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

    /// <summary>The lively.glb harness on the dog's chest, fitted to the breed (the dog carts).</summary>
    public Node3D? Harness(Node3D harness)
    {
        if (!R.HasHarness || R.HarnessBone < 0) return null;
        var att = new BoneAttachment3D { Name = "harness_socket", BoneName = R.Bones[R.HarnessBone], BoneIdx = R.HarnessBone };
        sk.AddChild(att);
        // the model's breast band: a ring of 0.13 m round (0, 0.36, 0); fit it round the chest just behind the forelegs
        var fit = new Transform3D(Basis.FromScale(new Vector3(R.HarnessRadius.X / 0.13f * 1.06f, R.HarnessRadius.Y / 0.13f * 1.06f, 1)), R.HarnessCentre)
                  * new Transform3D(Basis.Identity, new Vector3(0, -0.36f, 0));
        harness.Transform = sk.GetBoneGlobalRest(R.HarnessBone).AffineInverse() * fit;
        att.AddChild(harness);
        return att;
    }

    public void Dispose() => Group.QueueFree();
}
