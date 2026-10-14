using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.People;

// A shared-phase sampler: blend stride and cycle rather than linearly blending speeds. Standing, talking and
// sitting motions play the D2 clips of the body's family (People2Moves), chosen per person from the stable id; work
// motions play the D3 clips (the family's, a context the game gives: a sack pile, a fish table; a carried load),
// and the things those clips move (People2Things).
internal sealed class Human2
{
    private readonly Skeleton3D sk;
    private readonly Node3D root;
    private readonly string kind, style;
    private readonly People2.Clip stroll, walking, hurry, run, sprint;
    private float legacyStride = 1.2f;
    private readonly int hipBone;
    private readonly float hips;
    private readonly Quaternion[] rest, fadeFrom;
    private readonly Quaternion[] writtenPose;
    private readonly bool[] poseWritten, cachePose;
    private static readonly bool verifyPoseCache = VerifyPoseCache();
    private static bool VerifyPoseCache()
    {
        var args = OS.GetCmdlineUserArgs();
        foreach (string flag in new[] { "--people2-proof", "--people2-work", "--people2-motion", "--parade" })
            if (Array.IndexOf(args, flag) >= 0) return true;
        return false;
    }
    internal static long ValidatedPoseSkips { get; private set; }
    private readonly int[] boneMap;
    private readonly HumanLayers layers;
    private readonly Dictionary<string, float> speeds = new();
    private string motion = "idle";
    private People2.Clip clip = null!;
    private float time, fadeLeft, fadeDuration, phase;
    private Vector3 fadeHips;
    private bool held, running;
    private int clipChanges;
    private string clipName = "idle";
    // D2: the family's clips, the person's own choices
    private readonly People2Moves.Family? fam;
    private uint seed, rng;
    private string? id;
    private float rateK = 1;
    private string? idleClip;
    private float idleClock, idleNext = 30;
    private string? queued;
    private string? mood;
    private ulong moodAt;
    private float seat = 0.45f;
    private People2Moves.Seat? seatInfo;
    private float sitFeet;
    private bool fadeStanding;
    internal bool Speaking { get; private set; }
    private Human2? partner;
    private float age; // seconds in the current motion
    private float quiet, quietLimit = 1.5f;
    // D3: work
    private readonly People2Moves.WorkFamily? workFam;
    private readonly People2Things things;
    private readonly People2Vehicle vehicle;
    internal bool OwnVehicle => vehicle.Present;
    internal bool CanSit => !Humans.OwnClips.ContainsKey(kind);
    internal void UseExternalVehicle(bool external) => vehicle.UseExternal(external);
    private string? load;          // what is carried: "sack", "crate", "fishbox", "keg" (Crowd.PuppetLoad)
    private bool dropPending;      // a sack just let go: set it down before standing
    private float roll;            // the distance walked (a rolled cask turns by it)
    private Vector3 lastAt;
    private bool hadAt;
    /// <summary>The context the game gives (not on the wire; worked out the same on every PC): "haul_sack" at a
    /// sack pile, "fish_stall" behind a fish table. A figure already standing takes up the work at once.</summary>
    internal string? Work
    {
        get => work;
        set
        {
            if (value == work) return;
            work = value;
            if (clip != null && !held && motion is "idle" or "fold" or "crouch" or "pull" && !(clip.Work && !clip.Loop) && Map(motion) is { } n && n != clipName) SetClip(n, 0.5f);
        }
    }
    private string? work;
    private readonly List<BoneAttachment3D> inHand = new();
    private Node3D? basket;
    private int basketElbow, basketHand, basketFreeHand;
    private Vector3 basketPalm;
    private Vector3 basketRim, basketForearm;

    /// <summary>The kind's things held in a fist (the fishwife's basket), hung on the sockets once the body is
    /// made (People2.Make): put away while the hands work or carry (D3).</summary>
    internal void HeldReady()
    {
        inHand.Clear();
        foreach (var n in sk.GetChildren())
            if (n is BoneAttachment3D att)
            {
                if (att.GetNodeOrNull<Node3D>("held_basket") is { } heldBasket)
                {
                    basket = heldBasket;
                    basket.Reparent(sk, false);
                    basketElbow = sk.FindBone("armLowL"); basketHand = sk.FindBone("handL");
                    basketFreeHand = sk.FindBone("handR");
                    var handRest = sk.GetBoneGlobalRest(basketHand);
                    Vector3 palm = (sk.GetBoneGlobalRest(sk.FindBone("middle1L")).Origin - handRest.Origin) * 0.45f + new Vector3(-0.016f * hips / 0.902f, 0, 0);
                    basketPalm = handRest.Basis.Inverse() * palm;
                    Quaternion handTurn = new Basis(Vector3.Up, Vector3.Back, Vector3.Right).GetRotationQuaternion();
                    float length = handRest.Origin.DistanceTo(sk.GetBoneGlobalRest(basketElbow).Origin);
                    float best = float.MaxValue;
                    // Pick a point on the inner/front rim whose wrist-to-elbow distance equals
                    // this body's forearm. Both contacts then hold without stretching the rig.
                    for (int i = 0; i <= 128; i++)
                    {
                        float angle = MathF.PI + i * MathF.PI / 256;
                        Vector3 rim = new Vector3(0.25f + 0.12f * MathF.Cos(angle), 0.10f, 0.19f * MathF.Sin(angle));
                        Vector3 delta = new Vector3(rim.X - 0.09f, -rim.Y - 0.12f, -rim.Z) - handTurn * basketPalm;
                        float error = Math.Abs(delta.Length() - length);
                        if (error < best) { best = error; basketRim = rim; basketForearm = delta; }
                    }
                    basket.SetMeta("rim_contact", basketRim);
                    basket.SetMeta("palm_local", basketPalm);
                }
                else if (att.BoneName.ToString() is "gripL" or "gripR") inHand.Add(att);
            }
        ShowHeld();
    }

    private void ShowHeld()
    {
        bool busy = (clip?.Work ?? false) || load != null;
        foreach (var b in inHand) if (GodotObject.IsInstanceValid(b)) b.Visible = !busy;
        if (basket != null) basket.Visible = !busy;
    }
    /// <summary>The height of the pile in front (m over the feet), when the game knows it: picks the lift.</summary>
    internal float PileTop = -1;
    internal bool Alive => GodotObject.IsInstanceValid(root) && root.IsInsideTree() && motion == "talk";
    internal Vector3 Position => root.GlobalPosition;
    internal Human.AnimationSnapshot AnimationState => new(motion, clipName, Walking ? phase * LoopTime : time, Phase, clipChanges, held);
    public bool Female { get; }
    public float Pace = 1.35f;
    internal float StanceSlide => layers.MaxSlide;
    internal float StanceReach => layers.MaxReachError;
    internal int StanceSamples => layers.ContactSamples;
    public float Phase => clip.Cycle > 0 ? phase : time / clip.Length;
    public float LoopTime { get; private set; } = 1;
    internal string ClipName => clipName;
    internal Human2(string kind, Node3D root, (float hips, bool female, string style) info)
    {
        this.kind = kind; this.root = root; hips = info.hips; Female = info.female; style = info.style;
        sk = root.GetNode<Skeleton3D>("Skeleton3D");
        rest = new Quaternion[sk.GetBoneCount()]; fadeFrom = new Quaternion[rest.Length];
        writtenPose = new Quaternion[rest.Length]; poseWritten = new bool[rest.Length]; cachePose = new bool[rest.Length];
        boneMap = new int[rest.Length];
        for (int b = 0; b < rest.Length; b++)
        {
            rest[b] = sk.GetBoneRest(b).Basis.GetRotationQuaternion().Normalized();
            string name = sk.GetBoneName(b).ToString();
            boneMap[b] = Array.IndexOf(People2.BoneNames, name);
            // These joints have no procedural writer. IK, attention, eyes, springs and shoulder helpers
            // must always receive the authored pose again before their overlays run.
            cachePose[b] = name is "hips" or "spine" or "upperChest" or "neck" or "jaw" or "gripL" or "gripR" or "hipL" or "back" or "headTop"
                || name.StartsWith("thumb", StringComparison.Ordinal) || name.StartsWith("index", StringComparison.Ordinal)
                || name.StartsWith("middle", StringComparison.Ordinal) || name.StartsWith("ring", StringComparison.Ordinal);
        }
        hipBone = sk.FindBone("hips");
        stroll = People2.Clips[style + "_stroll"]; walking = People2.Clips[style + "_walk"]; hurry = People2.Clips[style + "_hurry"];
        run = People2.Clips.GetValueOrDefault(style + "_run", hurry); sprint = People2.Clips.GetValueOrDefault(style + "_sprint", hurry);
        layers = new HumanLayers(root, sk);
        things = new People2Things(sk);
        vehicle = new People2Vehicle(kind, root, sk);
        string body = root.Name.ToString();
        fam = People2Moves.Of(People2.BaseBody.GetValueOrDefault(body, body));
        workFam = People2Moves.WorkOf(fam?.Name);
        // a kind that always carries its sack (docker_sack) has it on the shoulder from the start
        if (People2Moves.KindClip(kind, "walk") == People2Moves.Loads.GetValueOrDefault("sack")?.Walk) load = "sack";
        Seed(People2Moves.Hash(kind) ^ (uint)Humans.Rng.Next());
        Play("idle", 0);
    }

    private void Seed(uint s)
    {
        seed = s;
        rng = s ^ 0x2545F491u; if (rng == 0) rng = 1;
        // no two people the same: each plays the standing clips at its own pace (within a tenth)
        rateK = 0.92f + 0.16f * People2Moves.Pick(seed, 11, 1000) / 1000f;
        idleClip = null;
        speeds.Remove("idle");
    }

    /// <summary>The stable resident id: the variants (idle, talk set, seat) follow it on every PC.</summary>
    internal void SetIdentity(string stableId)
    {
        if (stableId == id) return;
        People2Moves.Identify(this, id, stableId);
        id = stableId;
        Seed(People2Moves.Hash(stableId));
        if (motion == "idle" && fam != null) { string n = Map("idle"); if (n != clipName) SetClip(n, 0.6f); }
    }

    internal void SetMood(string m) { mood = m; moodAt = Time.GetTicksMsec(); }

    private float Next01()
    {
        rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
        return (rng & 0xFFFFFF) / (float)0x1000000;
    }

    private string Pick(string[] list, uint salt) => list[People2Moves.Pick(seed, salt, list.Length)];

    private string IdleClip()
    {
        var list = fam!.List("idle");
        if (list.Length == 0) return Female ? "idle_f" : "idle";
        // FNV's low bits stratify consecutive permanent ids across the idle bank. Applying
        // another avalanche here clustered adjacent residents into the same arm silhouette.
        if (idleClip == null || Array.IndexOf(list, idleClip) < 0) idleClip = list[(int)(seed % (uint)list.Length)];
        return idleClip;
    }

    private string TalkSet()
    {
        if (mood != null && Time.GetTicksMsec() - moodAt < 180000) return People2Moves.SetForMood(mood);
        int k = People2Moves.Pick(seed, 7, 10);
        return k < 5 ? "calm" : k < 8 ? "eager" : "cross";
    }

    /// <summary>The next stretch of a conversation: speaking (the set's gestures, now and then a shrug) or
    /// listening (nods, now and then a laugh), taking turns with a partner who also talks.</summary>
    private string TalkClip()
    {
        // a speaker yields at the end of a turn; a listener speaks when the other is quiet (so two never speak at
        // once, and a pause now and then when both listen); alone (talking to Jef, or to someone out of sight) a
        // talker speaks most of the time
        partner = People2Moves.Partner(this, root.GlobalPosition);
        bool speak = partner != null ? !Speaking && !partner.Speaking : Speaking ? Next01() < 0.45f : Next01() < 0.8f;
        quiet = 0; quietLimit = 0.8f + 1.6f * Next01();
        string set = TalkSet();
        string[] talk = fam!.List("talk_" + set);
        foreach (string other in new[] { "calm", "eager", "cross" }) if (talk.Length == 0) talk = fam.List("talk_" + other);
        if (speak && talk.Length > 0)
        {
            Speaking = true;
            var shrug = fam.List("shrug");
            if (set != "eager" && shrug.Length > 0 && Next01() < 0.12f) return shrug[0];
            return talk.Length == 1 ? talk[0] : talk[(int)(Next01() * talk.Length) % talk.Length];
        }
        Speaking = false;
        var laugh = fam.List("laugh");
        if (set == "eager" && laugh.Length > 0 && Next01() < 0.22f) return laugh[0];
        var listen = fam.List("listen");
        return listen.Length > 0 ? Pick(listen, 9) : IdleClip();
    }

    /// <summary>A stable choice among a work motion's variants (sweeping is one doorstep in three; the rest
    /// evenly).</summary>
    private string PickWork(string[] list, string m)
    {
        if (list.Length == 1) return list[0];
        if (m == "scrub" && Array.IndexOf(list, "sweep") >= 0 && Array.IndexOf(list, "scrub") >= 0)
            return People2Moves.Pick(seed, 41, 3) == 0 ? "sweep" : "scrub";
        return Pick(list, 40u + (uint)m.Length);
    }

    /// <summary>The D3 clip for a motion (null: none; the D2 and the old ones decide).</summary>
    private string? WorkClip(string m)
    {
        if (People2Moves.KindClip(kind, m) is { } own && People2.Clips.ContainsKey(own)) return own;
        if (vehicle.Present && m is "talk" or "fold" or "behind" or "lean" or "sit")
            return People2Moves.KindClip(kind, "idle");
        // a load decides how he walks and stands with it
        if (load != null && People2Moves.Loads.TryGetValue(load == "sack" ? "sack" : "crate", out var spec))
        {
            if (m is "walk" or "carry") return spec.Walk;
            // (a docker who always has his sack bends at the pile: he stands with it)
            if (m is "idle" or "talk" or "fold" or "crouch") return spec.Hold;
        }
        if (workFam == null) return null;
        if (Work == "haul_sack" && m == "crouch" && load == null)
        {
            var lifts = workFam.Context("haul_sack");
            if (lifts.Length > 0)
            {
                // the pile's height picks the lift when the game knows it, else the person
                if (PileTop >= 0) return Array.Find(lifts, n => PileTop < 0.45f ? !n.EndsWith("_high", StringComparison.Ordinal) : n.EndsWith("_high", StringComparison.Ordinal)) ?? lifts[0];
                return Pick(lifts, 43);
            }
        }
        if (Work == "fish_stall" && m is "idle" or "fold")
        {
            var gut = workFam.Context("fish_stall");
            if (gut.Length > 0) return gut[0];
        }
        if (Work is { } w && m == "pull" && workFam.Context(w) is { Length: > 0 } wl) return wl[0];
        var list = workFam.Motion(m);
        if (m == "point" && fam != null)
        {
            // pointing the way (D2) or pointing up at the spire (D3)
            var d2 = fam.List("point");
            if (d2.Length > 0 && list.Length > 0) return People2Moves.Pick(seed, 44, 2) == 0 ? d2[0] : list[0];
        }
        return list.Length > 0 ? PickWork(list, m) : null;
    }

    /// <summary>Which clip a motion would play now (the kits are laid out for it: a scrubber's bucket, a
    /// sweeper's).</summary>
    internal string? Choose(string m) => WorkClip(m);

    /// <summary>How long the work clip now playing has still to run (a lift, a set-down; 0 for a loop).</summary>
    internal float WorkSeconds => clip != null && clip.Work && !clip.Loop ? Math.Max(0, clip.Length - time) + (queued != null ? 0.3f : 0) : 0;

    /// <summary>A load in his arms or on his shoulder (null: put down). A sack let go is set down first.</summary>
    internal void Load(string? kind_)
    {
        if (kind_ == load) return;
        if (kind_ == null && load == "sack" && clip != null && !(clip.Work && !clip.Loop)) dropPending = true;
        if (kind_ == "sack") { things.DropClear(); dropPending = false; }
        load = kind_;
        ShowHeld();
        // already standing (a guest is told the motion before the load): set the sack down now
        if (dropPending && motion is "idle" or "crouch" or "talk" or "fold" && People2Moves.Loads.TryGetValue("sack", out var sk_) && sk_.Down is { } dn && People2.Clips.ContainsKey(dn))
        {
            dropPending = false;
            queued = motion == "crouch" ? Map("idle") : Map(motion);
            SetClip(dn, 0.2f);
            return;
        }
        // a figure standing with its load changes clip at once (a docker stood at his pile gets his sack)
        if (motion is "idle" or "carry" or "walk" && WorkClip(motion) is { } n && n != clipName && !(clip?.Work == true && !clip.Loop)) SetClip(n, 0.3f);
    }

    internal string? Carrying => load;

    internal void CarryNode(Node3D? node) => things.Attach(node);

    private People2Moves.Seat? SeatFor(float s)
    {
        if (fam == null) return null;
        string kind_ = s > 0.1f && s < 0.32f ? "step" : s > 0.1f && s < 0.43f ? "crate" : People2Moves.Pick(seed, 3, 3) == 0 ? "chair" : "bench";
        return fam.SeatOf(kind_) ?? fam.SeatOf("bench");
    }

    /// <summary>How far to lower the node for a seat `s` high (the D2 sit clips lower the hips themselves), and
    /// the feet's correction for a seat that is not the clip's own height; null: this body has no such clip.</summary>
    internal float? SitDrop(float s)
    {
        seat = s;
        var info = SeatFor(s);
        if (info == null || !People2.Clips.TryGetValue(info.Clip, out var c)) return null;
        bool changed = seatInfo != info;
        seatInfo = info;
        float own = info.Height * hips / c.Hips;
        sitFeet = s > 0.1f && !info.Dangle ? s - own : 0;
        if (changed && motion == "sit" && queued == null && clipName != info.Clip) SetClip(info.Clip, 0);
        return s > 0.1f ? s - own : -own;
    }

    private string Map(string m)
    {
        if (People2.Clips.ContainsKey(m) && !Array.Exists(Humans.Motions, x => x == m)) return m; // Parade only.
        if (WorkClip(m) is { } work && People2.Clips.ContainsKey(work)) return work;
        if (Humans.OwnClips.TryGetValue(kind, out var own) && own.TryGetValue(m, out var name)) return name;
        if (m == "walk") return style + "_walk";
        if (fam != null)
        {
            switch (m)
            {
                case "idle": return IdleClip();
                case "talk": return TalkClip();
                case "sit":
                    seatInfo ??= SeatFor(seat);
                    if (seatInfo != null) return seatInfo.Clip;
                    break;
                case "fold" or "behind" or "pockets" or "point":
                    var list = fam.List(m);
                    if (list.Length > 0) return Pick(list, m == "fold" ? 21u : m == "behind" ? 22u : m == "pockets" ? 23u : 24u);
                    break;
            }
        }
        if (m == "carry") return Female ? "walk_f" : "carry";
        string legacy = Female && People2.Clips.ContainsKey(m + "_f") ? m + "_f" : Female && Humans.WomenClips.TryGetValue(m, out var female) ? female : People2.Clips.ContainsKey(m) ? m : Female ? "idle_f" : "idle";
        // the old stand on bent knees: their own versions of the old standing clips
        if (style == "old" && People2.Clips.ContainsKey(legacy + "_old")) legacy += "_old";
        return legacy;
    }

    internal void Start()
    {
        Array.Clear(poseWritten);
        Play("idle", 0);
        time = (float)Humans.Rng.NextDouble() * clip.Length; phase = 0; speeds.Clear();
        idleClock = (float)Humans.Rng.NextDouble() * 20;
    }

    private bool IsStanding(string m) => m is "idle" or "talk" or "fold" or "behind" or "pockets" or "point" or "smoke" or "cross" or "call" or "beg";

    public void Play(string m, float fade)
    {
        if (motion == m && clip != null) return;
        string before = motion;
        // a figure just put in place (spawned, then given its motion) sits or stands at once, without the change
        bool settled = age > 0.8f;
        age = 0;
        if (before == "talk") { People2Moves.Talkers.Remove(this); Speaking = false; }
        motion = m; held = false; clipChanges++;
        if (m == "talk") People2Moves.Talkers.Add(this);
        if (m == "idle") { idleClock = 0; idleNext = 20 + 30 * Next01(); }
        string name = Map(m);
        queued = null;
        // a sack let go is set down from the shoulder first (the docker at the door or the pile)
        if (dropPending)
        {
            dropPending = false;
            if (m is "idle" or "crouch" or "talk" or "fold" && People2Moves.Loads.TryGetValue("sack", out var sack) && sack.Down is { } down && People2.Clips.ContainsKey(down))
            {
                // the set-down is the bend: he stands after it
                queued = m == "crouch" ? Map("idle") : name;
                SetClip(down, Math.Min(0.25f, Math.Max(0.1f, fade)));
                return;
            }
        }
        // sitting down and getting up (only with a fade: a placement with none is a figure put in its seat)
        if (fam != null && fade > 0 && clip != null && settled)
        {
            string seatKind = seatInfo != null ? SeatKind(seatInfo) : "bench";
            if (m == "sit" && (IsStanding(before) || before == "walk") && fam.Change(true, seatKind) is { } down && People2.Clips.ContainsKey(down)) { queued = name; name = down; }
            else if (before == "sit" && m != "walk" && IsStanding(m) && fam.Change(false, seatKind) is { } up && People2.Clips.ContainsKey(up)) { queued = name; name = up; }
        }
        SetClip(name, fade);
    }

    private string SeatKind(People2Moves.Seat s)
    {
        for (var f = fam; f != null; f = f.Fallback)
            foreach (var (k, v) in f.Sits) if (v == s) return k;
        return "bench";
    }

    private void SetClip(string name, float fade)
    {
        for (int b = 0; b < rest.Length; b++) fadeFrom[b] = sk.GetBonePoseRotation(b);
        fadeHips = sk.GetBonePosePosition(hipBone);
        bool wasStanding = clip != null && People2Moves.Standing.Contains(clipName);
        // a sack set down stays where it was put
        if (clip != null && clip.Work && !clip.Loop && clipName == People2Moves.Loads.GetValueOrDefault("sack")?.Down && time >= clip.Length - 0.05f) things.Drop();
        clipName = name;
        legacyStride = Humans.Stride.GetValueOrDefault(name, 1.2f) * hips / 0.95f;
        clip = People2.Clips.GetValueOrDefault(name, People2.Clips["idle"]);
        // a carry or work loop with its own pace (D1's sack walk, the cask, the sentry's march): two strides a loop
        if (clip.Stride > 0) legacyStride = 2 * clip.Stride * hips / clip.Hips;
        ShowHeld();
        time = 0; fadeDuration = fadeLeft = Math.Max(0, fade);
        // a fade between two standing clips keeps the feet where they are (HumanLayers' lock)
        fadeStanding = wasStanding && People2Moves.Standing.Contains(name);
        layers.ReleaseFeet();
    }

    /// <summary>A work clip from time t, as the proofs show it (frozen: held at t).</summary>
    internal void PlayClip(string name, float t, bool frozen)
    {
        if (!People2.Clips.ContainsKey(name)) return;
        string m = "work:" + name;
        if (motion != m || clipName != name) { Play(m, 0); SetClip(name, 0); motion = m; }
        speeds[m] = 1;
        held = frozen;
        fadeLeft = 0;
        time = Math.Clamp(t, 0, clip.Length);
    }

    internal int ThingsShown => things.Shown;

    internal void ReleaseFeet() => layers.ReleaseFeet();

    internal void PlayRaw(string name)
    {
        Play(name, 0); clipName = name; clip = People2.Clips[name]; motion = "parade"; time = clip.Length * 0.15f;
    }
    public void ClipSpeed(string m, float k) => speeds[m] = k;
    public void SetPhase(string m, float p) { if (motion != m) Play(m, 0); held = true; fadeLeft = 0; layers.ReleaseFeet(); phase = ((p % 1) + 1) % 1; time = phase * clip.Length; }
    private static bool SameStance(float p, float walkDuty, float runDuty)
    {
        float left = p % 1, right = (p + 0.5f) % 1;
        bool l = left < runDuty, r = right < runDuty;
        return l != r && l == (left < walkDuty) && r == (right < walkDuty);
    }
    private bool Walking => !held && motion == "walk" && clip.Cycle > 0 && clipName == style + "_walk";
    /// <summary>A loop that walks with its own pace (a carry, a push, the cask, the sentry's march).</summary>
    private bool PacedLoop => !held && clip.Loop && clip.Cycle > 0 && clip.Stride > 0 && (motion is "walk" or "carry" or "push" || motion.StartsWith("work:", StringComparison.Ordinal)) && !Walking;

    /// <summary>At the end of a loop: an idle may give way to another of the family's (now and then, back to the
    /// person's own one most often); a conversation takes its next turn.</summary>
    private void Seam()
    {
        if (fam == null) return;
        // Loads keep their authored grip through idle/talk loops rather than borrowing a free-hand idle.
        if (People2Moves.KindClip(kind, motion) != null || vehicle.Present && motion is "talk" or "fold" or "behind" or "lean" or "sit") return;
        if (motion == "idle" && idleClock > idleNext && !clip.Work)
        {
            var list = fam.List("idle");
            if (list.Length > 1)
            {
                string own = list[(int)(seed % (uint)list.Length)];
                string next = idleClip != own && Next01() < 0.7f ? own : list[(int)(Next01() * list.Length) % list.Length];
                if (next == idleClip) next = list[(Array.IndexOf(list, next) + 1) % list.Length];
                idleClip = next;
                SetClip(next, 1.0f);
            }
            idleClock = 0; idleNext = 20 + 30 * Next01();
        }
        else if (motion == "talk")
        {
            string next = TalkClip();
            if (next != clipName) SetClip(next, 0.7f);
        }
    }

    public void Update(float dt)
    {
        if (dt <= 0 || !root.IsInsideTree()) return;
        age += dt;
        var a = clip; var b = clip; float weight = 0;
        float bodyRatio = hips / clip.Hips;
        float rate = speeds.GetValueOrDefault(motion, 1);
        bool locomotion = Walking;
        if (locomotion)
        {
            float v = Math.Abs(Pace) / bodyRatio;
            if (style == "old") v = Math.Min(v, 2.2f);
            bool wantRun = style != "old" && v > 2.2f;
            if (wantRun != running && SameStance(phase * 2, hurry.Duty, run.Duty))
            {
                // Switch in an authored contact window, then complete the fade rather than hold a gait mix.
                for (int bone = 0; bone < rest.Length; bone++) fadeFrom[bone] = sk.GetBonePoseRotation(bone);
                fadeHips = sk.GetBonePosePosition(hipBone);
                fadeLeft = fadeDuration = 0.18f;
                fadeStanding = false;
                running = wantRun;
            }
            var slow = running ? run : stroll;
            var fast = running ? sprint : hurry;
            var middle = running ? slow : walking;
            a = v <= middle.Speed ? slow : middle;
            b = v <= middle.Speed ? middle : fast;
            if (v <= slow.Speed) a = b = slow;
            else if (v >= fast.Speed) a = b = fast;
            if (a != b)
                weight = Math.Clamp((a.Stride - v * a.Cycle) / (v * (b.Cycle - a.Cycle) - (b.Stride - a.Stride)), 0, 1);
            float cycle = Mathf.Lerp(a.Cycle, b.Cycle, weight);
            if (a == b) cycle = a.Stride / Math.Max(v, 0.001f);
            LoopTime = 2 * cycle;
            phase = (((phase + dt * rate / LoopTime) % 1) + 1) % 1;
        }
        else
        {
            LoopTime = clip.Length;
            if (!held)
            {
                if (motion is "walk" or "carry" or "push" && !speeds.ContainsKey(motion))
                    rate = Math.Abs(Pace) / legacyStride * clip.Length;
                else if (fam != null && !speeds.ContainsKey(motion)) rate *= rateK;
                if (motion == "idle") idleClock += dt;
                // a listener whose partner has fallen quiet takes the turn after a short pause, not at the end of
                // its own loop (the feet stay: the fade between two standing clips is locked)
                if (motion == "talk" && !Speaking && partner != null)
                {
                    quiet = partner.Alive && !partner.Speaking ? quiet + dt : 0;
                    if (quiet > quietLimit && time > 1.5f) { string next = TalkClip(); if (next != clipName) SetClip(next, 0.8f); }
                }
                time += dt * rate;
                if (clip.Loop)
                {
                    if (time >= clip.Length) { time %= clip.Length; Seam(); }
                    else if (time < 0) time = (time % clip.Length) + clip.Length;
                }
                else if (time >= clip.Length)
                {
                    time = clip.Length;
                    // a transition (sitting down, getting up) hands over to what follows it
                    if (queued != null) { string q = queued; queued = null; SetClip(q, 0.25f); }
                }
                else if (time < 0) time = 0;
            }
            a = b = clip;
        }
        float ta = locomotion ? phase * a.Length : time, tb = locomotion ? phase * b.Length : time;
        fadeLeft = Math.Max(0, fadeLeft - dt);
        float blend = fadeDuration > 0 ? 1 - fadeLeft / fadeDuration : 1;
        if (blend < 1) blend = blend * blend * (3 - 2 * blend);
        for (int bone = 0; bone < rest.Length; bone++)
        {
            int source = boneMap[bone];
            int track = source >= 0 ? a.RotationTracks[source] : -1, other = source >= 0 ? b.RotationTracks[source] : -1;
            Quaternion q = track >= 0 ? a.Rotations.At(track, ta).Normalized() : rest[bone];
            if (a != b && other >= 0) q = q.Slerp(b.Rotations.At(other, tb).Normalized(), weight);
            q = blend < 1 ? fadeFrom[bone].Normalized().Slerp(q.Normalized(), blend) : q;
            if (!cachePose[bone] || !poseWritten[bone] || writtenPose[bone] != q)
            {
                sk.SetBonePoseRotation(bone, q); writtenPose[bone] = q; poseWritten[bone] = true;
            }
            else if (verifyPoseCache)
            {
                if (!sk.GetBonePoseRotation(bone).IsEqualApprox(q)) throw new InvalidOperationException("Cached authored joint changed outside the sampler: " + bone);
                ValidatedPoseSkips++;
            }
        }
        Vector3 p = sk.GetBoneRest(hipBone).Origin;
        // Position keys are authored on trackBase, not on the receiving body's rest height.
        if (a.PositionTrack >= 0) p += (a.Animation.PositionTrackInterpolate(a.PositionTrack, ta) - HumanLayers.TrackBase) * bodyRatio;
        if (a != b && b.PositionTrack >= 0)
        {
            Vector3 pb = sk.GetBoneRest(hipBone).Origin + (b.Animation.PositionTrackInterpolate(b.PositionTrack, tb) - HumanLayers.TrackBase) * bodyRatio;
            p = p.Lerp(pb, weight);
        }
        sk.SetBonePosePosition(hipBone, blend < 1 ? fadeHips.Lerp(p, blend) : p);
        // a fade between two clips mixes the shoulder helpers' turns too: put them back on their rule near the camera
        // (the speed blend mixes two neighbouring loops whose arms swing alike: their keyed helpers mix well enough)
        if (blend < 1 && root.GlobalPosition.DistanceSquaredTo(Main.I.Cam.GlobalPosition) < 225) People2Shoulders.Apply(sk);
        bool stand = !locomotion && blend < 1 && fadeStanding;
        // a paced loop (a carry, the cask) locks its planted feet as the walks do
        bool paced = PacedLoop && Math.Abs(Pace) > 0.01f;
        layers.Update(dt, (locomotion || paced) && Math.Abs(Pace) > 0.01f, paced ? time / clip.Length : phase,
            paced ? clip.Duty : Mathf.Lerp(a.Duty, b.Duty, weight), stand, motion == "sit" && queued == null ? sitFeet : 0);
        // the things the work moves (D3), or the load carried
        var at = root.GlobalPosition;
        if (hadAt) roll += new Vector2(at.X - lastAt.X, at.Z - lastAt.Z).Length() / Math.Max(0.01f, root.GlobalBasis.Y.Length());
        lastAt = at; hadAt = true;
        if (clip.Things.Length > 0 || load != null)
        {
            if (root.GlobalPosition.DistanceSquaredTo(Main.I.Cam.GlobalPosition) < 3600) things.Show(clip, time, bodyRatio, load, roll);
            else things.HideAll();
        }
        else if (things.Shown > 0) things.HideAll();
        if (root.GlobalPosition.DistanceSquaredTo(Main.I.Cam.GlobalPosition) < 3600)
            layers.Hands(clipName, time, bodyRatio, blend);
        BasketPose();
        vehicle.Update(dt, clipName.StartsWith("truck_", StringComparison.Ordinal) || clipName.StartsWith("cart_", StringComparison.Ordinal));
        things.Tick(dt);
    }

    private void BasketPose()
    {
        if (basket == null || !basket.Visible) return;
        // Keep the handle's crown in the elbow crook. The wicker model is in hipL's downward
        // frame; the rim is 22 cm below its crown. Only the carrying arm overrides the clip.
        Quaternion q = new Basis(Vector3.Up, Vector3.Back, Vector3.Right).GetRotationQuaternion();
        layers.ForearmCarry(0, new Vector3(0.32f, -0.85f, 0.15f), basketForearm, q);
        Vector3 crook = sk.GetBoneGlobalPose(basketElbow).Origin;
        // Model handle crown: (0.09, -0.12, 0), rim forward: (0.25, 0.10, -0.17).
        Basis down = new Basis(Vector3.Right, Vector3.Down, Vector3.Forward);
        basket.Transform = new Transform3D(down, crook - down * new Vector3(0.09f, -0.12f, 0));
        // The free hand may gesture, but an inherited folded/hip idle cannot put it inside
        // the apron. Move only a hand in the waist band beyond the garment's side.
        var free = sk.GetBoneGlobalPose(basketFreeHand);
        float waist = sk.GetBoneGlobalPose(hipBone).Origin.Y, scale = hips / 0.902f;
        if (free.Origin.Y > waist - 0.18f * scale && free.Origin.Y < waist + 0.17f * scale && free.Origin.X > -0.35f * scale)
            layers.Arm(1, new Vector3(-0.35f * scale, free.Origin.Y, free.Origin.Z), free.Basis.GetRotationQuaternion());
        People2Shoulders.Apply(sk);
    }

    /// <summary>The D3 clips put their own hips where the work needs them (on the knees, crouched, seated at the
    /// lace pillow, in the air): no lift from the game.</summary>
    internal float MotionLift() => 0;

    internal void Dispose()
    {
        People2Moves.Drop(this, id);
        things.Dispose();
        vehicle.Dispose();
    }
}
