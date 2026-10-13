using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.People;

// A shared-phase sampler: blend stride and cycle rather than linearly blending speeds. Standing, talking and
// sitting motions play the D2 clips of the body's family (People2Moves), chosen per person from the stable id.
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
        boneMap = new int[rest.Length];
        for (int b = 0; b < rest.Length; b++)
        {
            rest[b] = sk.GetBoneRest(b).Basis.GetRotationQuaternion().Normalized();
            boneMap[b] = Array.IndexOf(People2.BoneNames, sk.GetBoneName(b).ToString());
        }
        hipBone = sk.FindBone("hips");
        stroll = People2.Clips[style + "_stroll"]; walking = People2.Clips[style + "_walk"]; hurry = People2.Clips[style + "_hurry"];
        run = People2.Clips.GetValueOrDefault(style + "_run", hurry); sprint = People2.Clips.GetValueOrDefault(style + "_sprint", hurry);
        layers = new HumanLayers(root, sk);
        string body = root.Name.ToString();
        fam = People2Moves.Of(People2.BaseBody.GetValueOrDefault(body, body));
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
        if (motion == "idle" && fam != null) { string n = IdleClip(); if (n != clipName) SetClip(n, 0.6f); }
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
        if (idleClip == null || Array.IndexOf(list, idleClip) < 0) idleClip = Pick(list, 1);
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
        var partner = People2Moves.Partner(this, root.GlobalPosition);
        bool speak = partner != null ? !Speaking && !partner.Speaking : Speaking ? Next01() < 0.45f : Next01() < 0.8f;
        string set = TalkSet();
        string[] talk = fam!.List("talk_" + set);
        if (talk.Length == 0) talk = fam.List("talk_calm");
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
        return listen.Length > 0 ? listen[0] : IdleClip();
    }

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
        Play("idle", 0);
        time = (float)Humans.Rng.NextDouble() * clip.Length; phase = 0; speeds.Clear();
        idleClock = (float)Humans.Rng.NextDouble() * 20;
    }

    private bool IsStanding(string m) => m is "idle" or "talk" or "fold" or "behind" or "pockets" or "point" or "smoke" or "cross" or "call" or "beg";

    public void Play(string m, float fade)
    {
        if (motion == m && clip != null) return;
        string before = motion;
        if (before == "talk") { People2Moves.Talkers.Remove(this); Speaking = false; }
        motion = m; held = false; clipChanges++;
        if (m == "talk") People2Moves.Talkers.Add(this);
        if (m == "idle") { idleClock = 0; idleNext = 20 + 30 * Next01(); }
        string name = Map(m);
        queued = null;
        // sitting down and getting up (only with a fade: a placement with none is a figure put in its seat)
        if (fam != null && fade > 0 && clip != null)
        {
            string seatKind = seatInfo != null ? SeatKind(seatInfo) : "bench";
            if (m == "sit" && IsStanding(before) && fam.Change(true, seatKind) is { } down && People2.Clips.ContainsKey(down)) { queued = name; name = down; }
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
        clipName = name;
        legacyStride = Humans.Stride.GetValueOrDefault(name, 1.2f) * hips / 0.95f;
        clip = People2.Clips.GetValueOrDefault(name, People2.Clips["idle"]);
        time = 0; fadeDuration = fadeLeft = Math.Max(0, fade);
        // a fade between two standing clips keeps the feet where they are (HumanLayers' lock)
        fadeStanding = wasStanding && People2Moves.Standing.Contains(name);
        layers.ReleaseFeet();
    }

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
    private bool Walking => !held && motion == "walk" && clip.Cycle > 0;

    /// <summary>At the end of a loop: an idle may give way to another of the family's (now and then, back to the
    /// person's own one most often); a conversation takes its next turn.</summary>
    private void Seam()
    {
        if (fam == null) return;
        if (motion == "idle" && idleClock > idleNext)
        {
            var list = fam.List("idle");
            if (list.Length > 1)
            {
                string own = Pick(list, 1);
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
            Quaternion q = track >= 0 ? a.Animation.RotationTrackInterpolate(track, ta).Normalized() : rest[bone];
            if (a != b && other >= 0) q = q.Slerp(b.Animation.RotationTrackInterpolate(other, tb).Normalized(), weight);
            sk.SetBonePoseRotation(bone, blend < 1 ? fadeFrom[bone].Normalized().Slerp(q.Normalized(), blend) : q);
        }
        Vector3 p = sk.GetBoneRest(hipBone).Origin;
        // Position keys are authored on trackBase, not on the receiving body's rest height.
        if (a.PositionTrack >= 0) p += (a.Animation.PositionTrackInterpolate(a.PositionTrack, ta) - new Vector3(0, 0.9118f, 0)) * bodyRatio;
        if (a != b && b.PositionTrack >= 0)
        {
            Vector3 pb = sk.GetBoneRest(hipBone).Origin + (b.Animation.PositionTrackInterpolate(b.PositionTrack, tb) - new Vector3(0, 0.9118f, 0)) * bodyRatio;
            p = p.Lerp(pb, weight);
        }
        sk.SetBonePosePosition(hipBone, blend < 1 ? fadeHips.Lerp(p, blend) : p);
        bool near = root.GlobalPosition.DistanceSquaredTo(Main.I.Cam.GlobalPosition) < 225;
        // a mix of clips mixes the shoulder helpers' turns too: put them back on their rule near the camera
        if (near && (blend < 1 || (a != b && weight > 0 && weight < 1))) People2Shoulders.Apply(sk);
        bool stand = !locomotion && blend < 1 && fadeStanding;
        layers.Update(dt, locomotion && Math.Abs(Pace) > 0.01f, phase, Mathf.Lerp(a.Duty, b.Duty, weight), stand,
            motion == "sit" && queued == null ? sitFeet : 0);
    }

    internal void Dispose() => People2Moves.Drop(this, id);
}
