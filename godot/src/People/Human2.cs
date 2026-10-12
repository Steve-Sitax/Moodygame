using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.People;

// A shared-phase sampler: blend stride and cycle rather than linearly blending speeds.
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
    internal Human.AnimationSnapshot AnimationState => new(motion, clipName, Walking ? phase * LoopTime : time, Phase, clipChanges, held);
    public bool Female { get; }
    public float Pace = 1.35f;
    internal float StanceSlide => layers.MaxSlide;
    internal float StanceReach => layers.MaxReachError;
    internal int StanceSamples => layers.ContactSamples;
    public float Phase => clip.Cycle > 0 ? phase : time / clip.Length;
    public float LoopTime { get; private set; } = 1;
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
        Play("idle", 0);
    }
    private string Map(string m)
    {
        if (People2.Clips.ContainsKey(m) && !Array.Exists(Humans.Motions, x => x == m)) return m; // Parade only.
        if (Humans.OwnClips.TryGetValue(kind, out var own) && own.TryGetValue(m, out var name)) return name;
        if (m == "walk") return style + "_walk";
        if (m == "carry") return Female ? "walk_f" : "carry";
        if (Female && People2.Clips.ContainsKey(m + "_f")) return m + "_f";
        if (Female && Humans.WomenClips.TryGetValue(m, out var female)) return female;
        return People2.Clips.ContainsKey(m) ? m : Female ? "idle_f" : "idle";
    }
    internal void Start() { Play("idle", 0); time = (float)Humans.Rng.NextDouble() * clip.Length; phase = 0; speeds.Clear(); }
    public void Play(string m, float fade)
    {
        if (motion == m && clip != null) return;
        for (int b = 0; b < rest.Length; b++) fadeFrom[b] = sk.GetBonePoseRotation(b);
        fadeHips = sk.GetBonePosePosition(sk.FindBone("hips"));
        motion = m; held = false; clipChanges++;
        string name = Map(m); clipName = name;
        legacyStride = Humans.Stride.GetValueOrDefault(name, 1.2f) * hips / 0.95f;
        clip = People2.Clips.GetValueOrDefault(name, People2.Clips["idle"]);
        time = 0; fadeDuration = fadeLeft = Math.Max(0, fade);
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
                time += dt * rate;
                time = clip.Loop ? ((time % clip.Length) + clip.Length) % clip.Length : Math.Clamp(time, 0, clip.Length);
            }
        }
        float ta = locomotion ? phase * a.Length : time, tb = locomotion ? phase * b.Length : time;
        fadeLeft = Math.Max(0, fadeLeft - dt);
        float blend = fadeDuration > 0 ? 1 - fadeLeft / fadeDuration : 1;
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
        layers.Update(dt, locomotion && Math.Abs(Pace) > 0.01f, phase, Mathf.Lerp(a.Duty, b.Duty, weight));
    }
}
