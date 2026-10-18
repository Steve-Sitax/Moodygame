using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.People;

/// <summary>
/// The people of 1873 as rigged, textured models (the browser's game/humans.ts; people.glb from
/// tools/blender/build_people.py). The file is read once (Models/ModelLibrary.cs); each person is a copy with its
/// own skeleton and animation player, sharing the kind's mesh, skin and material and everyone's clips.
/// Motions are named as in the browser ("idle", "walk", "talk" ...: shared/mpProtocol.ts PUPPET_MOTIONS).
/// </summary>
public static class Humans
{
    /// <summary>Every motion (its place in the list is its number in a puppet batch: shared/mpProtocol.ts PUPPET_MOTIONS).</summary>
    public static readonly string[] Motions =
    {
        "idle", "walk", "talk", "fold", "carry", "sit", "behind", "lean", "write", "ride", "row", "push", "scrub", "lace", "cross", "point", "beg", "call",
        "crouch", "hop", "rope", "grind", "pull", "wash", "wall", "pockets", "smoke",
    };

    /// <summary>How far the hips come down (a 1.74 m body) kneeling or crouched (build_people.py KNEEL_DROP, CROUCH_DROP).</summary>
    internal const float KneelDrop = 0.44f;
    internal const float CrouchDrop = 0.4f;
    /// <summary>The velocipede: the saddle's top, and the rider's hips over it.</summary>
    public const float SaddleY = 0.97f;
    public const float RideBack = 0.05f;

    internal static readonly HashSet<string> Women = new() { "peeters", "fientje", "fishwife_a", "fishwife_b", "maid", "girl", "wife_a", "wife_b", "shopwife", "old_woman", "girl_b", "milk_woman", "nun", "beguine", "tourist_lady" };
    /// <summary>The old people.glb only: its long aprons are open shells (the thighs would show through in its sit
    /// clip) and its women have no sit clip. People2 bodies sit, skirts and aprons too (package D2).</summary>
    internal static readonly HashSet<string> NoSit = new() { "baker", "shopkeeper", "publican" };

    /// <summary>Can a person of this kind sit (people2: everybody but those with a load; the old models: men
    /// without a long apron)?</summary>
    public static bool CanSitKind(string kind) => People2.Has(kind) ? !OwnClips.ContainsKey(kind) : !Women.Contains(kind) && !OwnClips.ContainsKey(kind) && !NoSit.Contains(kind);

    private static Dictionary<string, string> Same(string walk, string idle, string? talk = null, bool write = false)
    {
        var d = new Dictionary<string, string> { ["walk"] = walk, ["carry"] = walk, ["idle"] = idle, ["talk"] = talk ?? idle, ["fold"] = idle, ["sit"] = idle, ["behind"] = idle, ["lean"] = idle };
        if (write) d["write"] = idle;
        return d;
    }
    /// <summary>People whose load decides their clips: the sack on the shoulder, the sack truck, the handcart; a sentry's rifle at the shoulder.</summary>
    internal static readonly Dictionary<string, Dictionary<string, string>> OwnClips = new()
    {
        ["docker_sack"] = Same("walk_sack", "idle_sack"),
        ["porter"] = Same("push", "push_idle"),
        ["carter"] = Same("push", "push_idle"),
        ["sentry"] = Same("rifle_walk", "rifle_idle", "rifle_talk", true),
    };
    /// <summary>Women stand with their hands folded in front, and do not sit (the skirt).</summary>
    internal static readonly Dictionary<string, string> WomenClips = new() { ["sit"] = "idle_f", ["behind"] = "idle_f", ["fold"] = "idle_f", ["carry"] = "walk_f" };
    /// <summary>Metres covered by one loop of a walking clip, for a 1.74 m body.</summary>
    internal static readonly Dictionary<string, float> Stride = new() { ["push"] = 0.9f, ["walk_sack"] = 1.05f };

    private static ModelLibrary.Model? model;
    private static AnimationLibrary? clips;
    private static readonly Dictionary<string, float> Scale = new();
    private static readonly Dictionary<string, float> ClipLength = new();
    private static bool tried;
    internal static readonly Random Rng = new();

    /// <summary>The models are in (false: people.glb is not there; said once).</summary>
    public static bool Ready
    {
        get
        {
            if (!tried) Load();
            return model != null;
        }
    }

    /// <summary>Every kind in people.glb (for a kind name that comes from the server).</summary>
    public static bool IsKind(string k) => People2.Has(k) || (Ready && model!.Roots.ContainsKey(k));

    public static IEnumerable<string> Kinds => Ready ? model!.Roots.Keys : Array.Empty<string>();

    public static double LoadMs => model?.LoadMs ?? 0;

    /// <summary>The town is leaving: the model library frees its sources, so no old body may be copied again.</summary>
    public static void Forget()
    {
        People2.Forget();
        model = null;
        clips = null;
        tried = false;
        Scale.Clear();
        ClipLength.Clear();
    }

    private static void Load()
    {
        tried = true;
        People2.Load();
        // double-sided: skirts, coat tails and bonnets are open shells (humans.ts: psx(new MeshLambertMaterial({ map, side: DoubleSide })))
        model = ModelLibrary.Get("people", new ModelLibrary.Look(TwoSided: true));
        if (model == null) return;
        foreach (var (name, root) in model.Roots)
        {
            root.Position = Vector3.Zero;
            var sk = root.GetNodeOrNull<Skeleton3D>("Skeleton3D");
            int hips = sk?.FindBone("hips") ?? -1;
            // body height over 1.74 m, read from the hips bone (children are about 0.72)
            Scale[name] = hips >= 0 ? sk!.GetBoneRest(hips).Origin.Y / 0.95f : 1;
            foreach (var n in World.BakedWorld.All(root))
                if (n is MeshInstance3D mi) mi.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
            // the docker's shoulder sack and the porter's sack-truck sack are the one sack model, hung where
            // people.glb had its own; the carter's handcart goes on its own wheels (Carried.cs)
            if (name == "carter" && PushCart.Has) PushCart.HideBakedCart(root);
        }
        // rotations only, by bone name: the skeletons differ in size, so bone positions stay each body's own
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
                a.TrackSetInterpolationType(nt, src.TrackGetInterpolationType(t));
                int keys = src.TrackGetKeyCount(t);
                for (int k = 0; k < keys; k++) a.RotationTrackInsertKey(nt, src.TrackGetKeyTime(t, k), src.TrackGetKeyValue(t, k).AsQuaternion());
            }
            clips.AddAnimation(name, a);
            ClipLength[name] = (float)src.Length;
        }
    }

    /// <summary>A new person of this kind, or null when the models are not there (or the kind is not in them).</summary>
    public static Human? Make(string kind)
    {
        using var cost = Scheldemist.Dev.FrameCost.Track("People.Make");
        if (People2.Enabled && People2.Make(kind) is { } newer) return newer;
        if (!Ready) return null;
        var root = model!.Copy(kind);
        // Bone attachments belong to the copy: duplicating an unattached prototype resets the bone index.
        if (root != null) Carried.HangSack(kind, root);
        return root == null ? null : new Human(kind, root, clips!, ClipLength, Scale.GetValueOrDefault(kind, 1));
    }
}

public sealed class Human
{
    public readonly string Kind;
    public readonly Node3D Root;
    /// <summary>Body height over 1.74 m.</summary>
    public readonly float Scale;
    public string? Motion { get; private set; }

    private readonly AnimationPlayer mixer;
    private readonly Dictionary<string, string> actions = new();
    private readonly Dictionary<string, float> stride = new();
    private readonly Dictionary<string, float> speed = new();
    private readonly Dictionary<string, float> lengths;
    private string? current;
    private int clipChanges;
    private string? phaseClip;
    public readonly record struct AnimationSnapshot(string? Motion,string? Clip,double Time,double Cycle,int ClipChanges,bool PhaseControlled);
    public AnimationSnapshot AnimationState=>newer?.AnimationState ?? new(Motion,current,mixer.CurrentAnimationPosition,current==null?0:mixer.CurrentAnimationPosition/lengths[current],clipChanges,phaseClip==current&&current!=null);
    private readonly Human2? newer;
    private readonly People2Eyes? eyes;
    private string? stableIdentity;
    private bool identityReady;
    private bool localPlayer, viewmodel;

    internal Human(string kind, Node3D root, AnimationLibrary clips, Dictionary<string, float> lengths, float scale, Human2? newer = null)
    {
        this.newer = newer;
        if (newer != null) eyes = new People2Eyes(root);
        Kind = kind;
        Root = root;
        Scale = scale;
        this.lengths = lengths;
        mixer = new AnimationPlayer { Name = "clips", CallbackModeProcess = AnimationMixer.AnimationCallbackModeProcess.Manual };
        root.AddChild(mixer);
        mixer.RootNode = new NodePath("..");
        mixer.AddAnimationLibrary("", clips);
        bool woman = newer?.Female ?? Humans.Women.Contains(kind);
        var own = Humans.OwnClips.GetValueOrDefault(kind) ?? (woman ? Humans.WomenClips : null);
        foreach (var m in Humans.Motions)
        {
            string? clip = own != null && own.TryGetValue(m, out var o) && lengths.ContainsKey(o) ? o : woman && lengths.ContainsKey(m + "_f") ? m + "_f" : lengths.ContainsKey(m) ? m : null;
            if (clip == null) continue;
            actions[m] = clip;
            if (!animationNames.ContainsKey(clip)) animationNames[clip] = new StringName(clip);
            stride[m] = Humans.Stride.GetValueOrDefault(clip, 1.2f) * scale;
        }
    }

    /// <summary>Once the figure is in the scene: stand idle, and not everyone breathes in step.</summary>
    public void Start()
    {
        if (newer != null) { newer.Start(); Motion = "idle"; return; }
        Motion = null;
        current = null;
        clipChanges = 0;
        phaseClip = null;
        speed.Clear();
        Play("idle", 0);
        if (current != null) mixer.Seek(Humans.Rng.NextDouble() * lengths[current], true);
    }

    private readonly Dictionary<string, StringName> animationNames = new();
    public void Play(string m, float fade = 0.3f)
    {
        if (newer != null) { newer.Play(m, fade); Motion = m; return; }
        if (Motion == m) return;
        if (!actions.TryGetValue(m, out var next) && !actions.TryGetValue("idle", out next)) return;
        Motion = m;
        if (next == current) return;
        phaseClip = null;
        mixer.SpeedScale = SpeedOf(m);
        clipChanges++;
        mixer.Play(animationNames[next], current != null ? fade : 0);
        current = next;
    }

    private float SpeedOf(string? m) => m != null && speed.TryGetValue(m, out var k) ? k : 1;

    private static readonly string[] WalkMotions = { "walk", "carry", "push" };

    /// <summary>Walk clips cover 1.2 m per loop (less for a child or a load); match the feet to the ground speed.</summary>
    public void SetPace(float mps)
    {
        if (newer != null) { newer.Pace = mps; return; }
        foreach (var m in WalkMotions)
            if (actions.ContainsKey(m)) speed[m] = Math.Max(0.3f, mps / stride.GetValueOrDefault(m, 1.2f));
    }

    /// <summary>Hold a clip at a point of its loop (0..1): the pedals follow the front wheel's turn.</summary>
    public void SetPhase(string m, float phase)
    {
        if (newer != null) { newer.SetPhase(m, phase); return; }
        if (!actions.TryGetValue(m, out var clip)) return;
        speed[m] = 0;
        if (current != clip) return;
        if (phaseClip != clip)
        {
            // Zero playback speed also freezes an unfinished fade. A phase-driven pose must take full weight:
            // otherwise moving legs can appear beneath a torso and arms still blended with the idle pose.
            mixer.Stop(true);
            mixer.SpeedScale = 1;
            mixer.Play(animationNames[clip], 0);
            phaseClip = clip;
        }
        mixer.Seek((((phase % 1) + 1) % 1) * lengths[clip], true);
        mixer.Advance(0);
    }

    /// <summary>How far to raise the body so the hips sit on a velocipede's saddle (the ride clip).</summary>
    public float RideLift(float saddle = Humans.SaddleY) => saddle + 0.07f * Scale - 0.9f * Scale;

    /// <summary>Play a clip at this speed; negative runs it backwards (the rope maker stepping back).</summary>
    public void ClipSpeed(string m, float k)
    {
        if (newer != null) { newer.ClipSpeed(m, k); return; }
        if (actions.ContainsKey(m)) speed[m] = k;
    }

    /// <summary>A woman's clips (hands folded in front, shorter steps)?</summary>
    public bool Woman => newer?.Female ?? Humans.Women.Contains(Kind);
    internal bool OwnPushedVehicle => newer?.OwnVehicle ?? false;
    internal void UseExternalVehicle(bool external) => newer?.UseExternalVehicle(external);

    /// <summary>Can this body sit? People2 bodies all sit (women in skirts and aprons too) unless they carry a
    /// load; the old models only the men without a long apron.</summary>
    public bool CanSit => newer?.CanSit ?? (!Woman && !Humans.OwnClips.ContainsKey(Kind) && !Humans.NoSit.Contains(Kind));

    /// <summary>How far to lower the body (negative) so it sits on a seat `seat` metres high (the sit clip). A
    /// people2 body picks its seated clip by the seat's height (a step, a crate, a bench or a chair), whose hips
    /// come down by themselves; a seat of 0 is a seat at the node's own height.</summary>
    public float SitDrop(float seat = 0.45f) => newer?.SitDrop(seat) ?? LegacySitDrop(seat);

    private float LegacySitDrop(float seat) => seat + 0.07f * Scale - 0.9f * Scale;

    private float Phase => newer?.Phase ?? (current == null ? 0 : (float)(mixer.CurrentAnimationPosition / lengths[current]));

    /// <summary>How far to lower (negative) or lift the body for what it plays now: on the knees to scrub, on a chair at the lace pillow, crouched at marbles, off the ground in a hop.</summary>
    public float MotionLift() => newer != null ? newer.MotionLift() : Motion switch
    {
        "scrub" => -Humans.KneelDrop * Scale,
        "crouch" => -Humans.CrouchDrop * Scale,
        "lace" => LegacySitDrop(0.45f),
        "hop" => 0.2f * Scale * Math.Max(0, MathF.Sin(Phase * MathF.PI * 2)),
        _ => 0,
    };

    /// <summary>How far the hips dip below standing height right now (walking only).</summary>
    public float Bob()
    {
        if (newer != null) return 0; // The new clips key the hips themselves.
        if (Motion != "walk" && Motion != "carry") return 0;
        float c = MathF.Cos(Phase * MathF.PI * 2);
        return -(Humans.Women.Contains(Kind) ? 0.035f : 0.05f) * Scale * c * c;
    }

    /// <summary>Seconds in one loop of what is playing now.</summary>
    public float LoopTime => newer?.LoopTime ?? (current != null ? lengths[current] : 1);

    // ---- package D3: work (local choices only; nothing here goes on the wire)

    /// <summary>A people2 body (its work clips position their own hips and carry their own things).</summary>
    public bool IsPeople2 => newer != null;

    /// <summary>The work context the game gives this figure: "haul_sack" at a sack pile, "fish_stall" behind a
    /// fish table; null: none. Worked out from what every PC knows (the place, the kind).</summary>
    public string? Work
    {
        get => newer?.Work;
        set { if (newer != null) newer.Work = value; }
    }

    /// <summary>The height of the pile before a docker (picks the lift), when the game knows it.</summary>
    public float PileTop { set { if (newer != null) newer.PileTop = value; } }

    /// <summary>How long the work clip now playing still runs (a lift, a set-down): the game waits for it.</summary>
    public float WorkSeconds => newer?.WorkSeconds ?? 0;

    /// <summary>The clip a motion would play for this person (people2), to lay out the kit for it.</summary>
    public string? WorkChoice(string motion) => newer?.Choose(motion);

    /// <summary>A load carried by a people2 body ("sack" rides the shoulder; others are the game's node on the
    /// chest); null: put down (a sack is set down first).</summary>
    public void CarryLoad(string? kind) => newer?.Load(kind);

    /// <summary>The game's node for a load the kit has no model of (a crate, a box of fish, a keg): held against
    /// the belly by a people2 body.</summary>
    public void CarryNode(Node3D? node) => newer?.CarryNode(node);

    /// <summary>The proofs: play a work clip from t (frozen: held there).</summary>
    internal void WorkClipNow(string clip, float t, bool frozen = false) { if (newer != null) { newer.PlayClip(clip, t, frozen); Motion = "work:" + clip; } }

    internal int ThingsShown => newer?.ThingsShown ?? 0;

    /// <summary>The proofs: a figure put somewhere else lets its planted feet go.</summary>
    internal void ReleaseFeet() => newer?.ReleaseFeet();

    /// <summary>Where a bone (a socket: gripL, gripR) is now, in the world.</summary>
    internal Vector3? Socket(string bone)
    {
        skeleton ??= Root.GetNodeOrNull<Skeleton3D>("Skeleton3D");
        int b = skeleton?.FindBone(bone) ?? -1;
        return b < 0 ? null : skeleton!.GlobalTransform * skeleton.GetBoneGlobalPose(b).Origin;
    }

    public int SetFace(IReadOnlyDictionary<string, float> weights) => People2Faces.SetFace(Root, weights);
    internal void PlayerAppearance(Menu.Profile profile, bool arms = false)
    {
        identityReady = true;
        localPlayer = true; viewmodel = arms;
        newer?.PlayerArms();
        newer?.SetIdentity("local-player");
        People2Faces.Player(Root, profile, arms);
    }
    internal long EyeAllocationProof() => eyes?.AllocationProof() ?? -1;
    public int SetIdentity(string stableId)
    {
        if (stableIdentity == stableId && Root.HasMeta("face_id")) return Root.GetMeta("face_id").AsInt32();
        stableIdentity = stableId;
        identityReady = true;
        newer?.SetIdentity(stableId);
        int face = People2Faces.SetIdentity(Root, stableId);
        if (Root.HasMeta("face_seed")) eyes?.Seed((uint)Root.GetMeta("face_seed").AsInt64());
        return face;
    }

    public void Update(float dt)
    {
        using var timing = Dev.PeopleTiming.Track(newer != null);
        if (newer != null)
        {
            // Townspeople/remote identities are assigned before the first update. Only nameless
            // decorative/proof figures need a local identity here; Make never builds a temporary face.
            if (!identityReady)
            {
                People2Faces.Next(this);
                identityReady = true;
                if (Root.HasMeta("face_seed")) eyes?.Seed((uint)Root.GetMeta("face_seed").AsInt64());
            }
            newer.Update(dt); if (!viewmodel) eyes?.Update(dt, newer.Speaking, localPlayer); return;
        }
        mixer.SpeedScale = SpeedOf(Motion);
        mixer.Advance(dt);
    }

    private Skeleton3D? skeleton;
    private int handL = -2, handR = -2;

    /// <summary>Where a hand is now, in the world (null: this body has no such bone).</summary>
    public Vector3? Hand(bool right)
    {
        skeleton ??= Root.GetNodeOrNull<Skeleton3D>("Skeleton3D");
        if (skeleton == null) return null;
        if (handL == -2)
        {
            handL = skeleton.FindBone("handL");
            handR = skeleton.FindBone("handR");
        }
        int b = right ? handR : handL;
        return b < 0 ? null : skeleton.GlobalTransform * skeleton.GetBoneGlobalPose(b).Origin;
    }

    internal float StanceSlide => newer?.StanceSlide ?? 0;
    /// <summary>A people2 talker speaking now (not listening); for the proofs.</summary>
    internal bool Speaking => newer?.Speaking ?? false;
    internal float StanceReach => newer?.StanceReach ?? 0;
    internal int StanceSamples => newer?.StanceSamples ?? 0;
    internal void ParadeClip(string clip) { Motion = clip; if (newer != null) newer.PlayRaw(clip); else Play(clip, 0); }

    public void Dispose()
    {
        newer?.Dispose();
        Root.QueueFree();
    }
}
