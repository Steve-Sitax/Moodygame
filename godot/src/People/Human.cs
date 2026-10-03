using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.People;

/// <summary>
/// The people of 1873 as rigged, textured low-poly models (the browser's game/humans.ts; people.glb from
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
    /// <summary>Long aprons are open shells: the thighs would show through in the sit clip.</summary>
    internal static readonly HashSet<string> NoSit = new() { "baker", "shopkeeper", "publican" };

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
    public static bool IsKind(string k) => Ready && model!.Roots.ContainsKey(k);

    public static IEnumerable<string> Kinds => Ready ? model!.Roots.Keys : Array.Empty<string>();

    public static double LoadMs => model?.LoadMs ?? 0;

    private static void Load()
    {
        tried = true;
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
            Carried.HangSack(name, root);
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
        if (!Ready) return null;
        var root = model!.Copy(kind);
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

    internal Human(string kind, Node3D root, AnimationLibrary clips, Dictionary<string, float> lengths, float scale)
    {
        Kind = kind;
        Root = root;
        Scale = scale;
        this.lengths = lengths;
        mixer = new AnimationPlayer { Name = "clips", CallbackModeProcess = AnimationMixer.AnimationCallbackModeProcess.Manual };
        root.AddChild(mixer);
        mixer.RootNode = new NodePath("..");
        mixer.AddAnimationLibrary("", clips);
        bool woman = Humans.Women.Contains(kind);
        var own = Humans.OwnClips.GetValueOrDefault(kind) ?? (woman ? Humans.WomenClips : null);
        foreach (var m in Humans.Motions)
        {
            string? clip = own != null && own.TryGetValue(m, out var o) && lengths.ContainsKey(o) ? o : woman && lengths.ContainsKey(m + "_f") ? m + "_f" : lengths.ContainsKey(m) ? m : null;
            if (clip == null) continue;
            actions[m] = clip;
            stride[m] = Humans.Stride.GetValueOrDefault(clip, 1.2f) * scale;
        }
    }

    /// <summary>Once the figure is in the scene: stand idle, and not everyone breathes in step.</summary>
    public void Start()
    {
        Motion = null;
        current = null;
        speed.Clear();
        Play("idle", 0);
        if (current != null) mixer.Seek(Humans.Rng.NextDouble() * lengths[current], true);
    }

    public void Play(string m, float fade = 0.3f)
    {
        if (Motion == m) return;
        if (!actions.TryGetValue(m, out var next) && !actions.TryGetValue("idle", out next)) return;
        Motion = m;
        if (next == current) return;
        mixer.SpeedScale = SpeedOf(m);
        mixer.Play(next, current != null ? fade : 0);
        current = next;
    }

    private float SpeedOf(string? m) => m != null && speed.TryGetValue(m, out var k) ? k : 1;

    private static readonly string[] WalkMotions = { "walk", "carry", "push" };

    /// <summary>Walk clips cover 1.2 m per loop (less for a child or a load); match the feet to the ground speed.</summary>
    public void SetPace(float mps)
    {
        foreach (var m in WalkMotions)
            if (actions.ContainsKey(m)) speed[m] = Math.Max(0.3f, mps / stride.GetValueOrDefault(m, 1.2f));
    }

    /// <summary>Hold a clip at a point of its loop (0..1): the pedals follow the front wheel's turn.</summary>
    public void SetPhase(string m, float phase)
    {
        if (!actions.TryGetValue(m, out var clip)) return;
        speed[m] = 0;
        if (current == clip) mixer.Seek((((phase % 1) + 1) % 1) * lengths[clip], true);
    }

    /// <summary>How far to raise the body so the hips sit on a velocipede's saddle (the ride clip).</summary>
    public float RideLift(float saddle = Humans.SaddleY) => saddle + 0.07f * Scale - 0.9f * Scale;

    /// <summary>Play a clip at this speed; negative runs it backwards (the rope maker stepping back).</summary>
    public void ClipSpeed(string m, float k)
    {
        if (actions.ContainsKey(m)) speed[m] = k;
    }

    /// <summary>A woman's clips (hands folded in front, shorter steps)?</summary>
    public bool Woman => Humans.Women.Contains(Kind);

    /// <summary>Can this body sit (the men's sit clip; not under a skirt, not with a load)?</summary>
    public bool CanSit => !Humans.Women.Contains(Kind) && !Humans.OwnClips.ContainsKey(Kind) && !Humans.NoSit.Contains(Kind);

    /// <summary>How far to lower the body (negative) so it sits on a seat `seat` metres high (the sit clip).</summary>
    public float SitDrop(float seat = 0.45f) => seat + 0.07f * Scale - 0.9f * Scale;

    private float Phase => current == null ? 0 : (float)(mixer.CurrentAnimationPosition / lengths[current]);

    /// <summary>How far to lower (negative) or lift the body for what it plays now: on the knees to scrub, on a chair at the lace pillow, crouched at marbles, off the ground in a hop.</summary>
    public float MotionLift() => Motion switch
    {
        "scrub" => -Humans.KneelDrop * Scale,
        "crouch" => -Humans.CrouchDrop * Scale,
        "lace" => SitDrop(0.45f),
        "hop" => 0.2f * Scale * Math.Max(0, MathF.Sin(Phase * MathF.PI * 2)),
        _ => 0,
    };

    /// <summary>How far the hips dip below standing height right now (walking only).</summary>
    public float Bob()
    {
        if (Motion != "walk" && Motion != "carry") return 0;
        float c = MathF.Cos(Phase * MathF.PI * 2);
        return -(Humans.Women.Contains(Kind) ? 0.035f : 0.05f) * Scale * c * c;
    }

    /// <summary>Seconds in one loop of what is playing now.</summary>
    public float LoopTime => current != null ? lengths[current] : 1;

    public void Update(float dt)
    {
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

    public void Dispose()
    {
        Root.QueueFree();
    }
}
