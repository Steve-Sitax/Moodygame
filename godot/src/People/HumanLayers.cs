using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.World;

namespace Scheldemist.People;

// Cached bone layers. Every-frame work uses value types and the body's existing arrays only.
internal sealed class HumanLayers
{
    internal bool LocalPlayer;
    private sealed record Rig(int[] Springs, Vector3[] Contacts);
    private static readonly Dictionary<string, Rig> rigs = new();
    private sealed record HandTrack(string Model, float[] Keys);
    private static readonly Dictionary<string, HandTrack> handTracks = new();
    private static bool tracksLoaded;
    internal static Vector3 TrackBase { get; private set; }
    internal static void Forget() { rigs.Clear(); handTracks.Clear(); tracksLoaded = false; }
    private static void LoadTracks()
    {
        if (tracksLoaded) return;
        using var json = JsonDocument.Parse(File.ReadAllText(Paths.Shared("peopleRig.json")));
        var rig = json.RootElement;
        var p = rig.GetProperty("locomotion").GetProperty("trackBase");
        TrackBase = new Vector3(p[0].GetSingle(), p[1].GetSingle(), p[2].GetSingle());
        foreach (var c in rig.GetProperty("work").GetProperty("clips").EnumerateObject())
        {
            if (!c.Value.TryGetProperty("handContacts", out var h)) continue;
            var rows = h.GetProperty("keys");
            var keys = new float[rows.GetArrayLength() * 14]; int at = 0;
            foreach (var row in rows.EnumerateArray()) foreach (var x in row.EnumerateArray()) keys[at++] = x.GetSingle();
            handTracks[c.Name] = new HandTrack(h.GetProperty("model").GetString()!, keys);
        }
        tracksLoaded = true;
    }
    private readonly Node3D root;
    private readonly Skeleton3D sk;
    private readonly int head, chest, eyeL, eyeR;
    private readonly int[] springs;
    private readonly float[] springAngle, springVelocity;
    private readonly int[] up = new int[2], low = new int[2], foot = new int[2], toe = new int[2];
    private readonly Vector3[] contacts, contactAnchors = new Vector3[6];
    private readonly bool[] contactDown = new bool[6];
    public float MaxSlide { get; private set; }
    public float MaxReachError { get; private set; }
    public int ContactSamples { get; private set; }
    private readonly int[] activeContact = { -1, -1 };
    private readonly Vector3[] ankleTargets = new Vector3[2];
    private readonly Quaternion[] footRotations = new Quaternion[2];
    private readonly bool[] supports = new bool[2];
    private readonly int hipBone;
    private readonly int[] arm = new int[2], forearm = new int[2], hand = new int[2];
    private readonly int[] armTwist = new int[2];
    private readonly int[] clavicle = new int[2];
    private readonly Dictionary<string, Node3D?> contactThings = new();
    internal float HandReachError { get; private set; }
    private Vector3 lastPosition, lastForward;
    private Vector2 look;
    internal Vector3? AttentionTarget;
    private bool hadPosition;
    private sealed record Bindings(int[] Bones, int[] SpringSlots, int[] SpringBones);
    private Bindings ReadBindings(Skin skin, string[] names)
    {
        int count = skin.GetBindCount();
        var result = new Bindings(new int[count], new int[count], new int[count]);
        for (int i = 0; i < count; i++) {
            string name = skin.GetBindName(i).ToString();
            int bone = skin.GetBindBone(i);
            result.Bones[i] = name == "" ? bone : sk.FindBone(name);
            if (name == "" && bone >= 0) name = sk.GetBoneName(bone).ToString();
            result.SpringSlots[i] = Array.IndexOf(names, name);
            result.SpringBones[i] = result.SpringSlots[i] >= 0 ? sk.FindBone(name) : -1;
        }
        return result;
    }

    public HumanLayers(Node3D root, Skeleton3D sk, bool cachedSetup = true)
    {
        using var cost = Dev.FrameCost.Track("People.LayersSetup");
        cachedSetup &= !Main.I.Flag("layers-original");
        this.root = root; this.sk = sk;
        LoadTracks();
        hipBone = sk.FindBone("hips");
        head = sk.FindBone("head"); chest = sk.FindBone("chest"); eyeL = sk.FindBone("eyeL"); eyeR = sk.FindBone("eyeR");
        for (int i = 0; i < 2; i++)
        {
            string suffix = i == 0 ? "L" : "R";
            arm[i] = sk.FindBone("armUp" + suffix); forearm[i] = sk.FindBone("armLow" + suffix); hand[i] = sk.FindBone("hand" + suffix);
            armTwist[i] = sk.FindBone("armTwist" + suffix);
            clavicle[i] = sk.FindBone("clavicle" + suffix);
            toe[i] = sk.FindBone("toe" + suffix);
            up[i] = sk.FindBone("legUp" + suffix); low[i] = sk.FindBone("legLow" + suffix); foot[i] = sk.FindBone("foot" + suffix);
        }
        string body = root.Name.ToString();
        if (rigs.TryGetValue(body, out var cached))
        {
            springs = cached.Springs; contacts = cached.Contacts;
            springAngle = new float[springs.Length]; springVelocity = new float[springs.Length];
            return;
        }
        contacts = new Vector3[6];
        string[] names = { "skirtF", "skirtB", "skirtL", "skirtR", "coatTailL", "coatTailR" };
        springs = new int[names.Length]; springAngle = new float[names.Length]; springVelocity = new float[names.Length];
        Array.Fill(springs, -1);
        var bindings = cachedSetup ? new Dictionary<Skin, Bindings>() : null;
        // A skin may bind every bone even when none of its vertices use it. Inspect nonzero weights.
        foreach (var n in BakedWorld.All(root))
        {
            if (n is not MeshInstance3D mi || mi.Mesh == null || mi.Skin == null) continue;
            Bindings? lookup = null;
            if (bindings != null && !bindings.TryGetValue(mi.Skin, out lookup)) bindings[mi.Skin] = lookup = ReadBindings(mi.Skin, names);
            int bindCount = mi.Skin.GetBindCount();
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                var arrays = mi.Mesh.SurfaceGetArrays(s);
                var bones = arrays[(int)Mesh.ArrayType.Bones].AsInt32Array();
                var weights = arrays[(int)Mesh.ArrayType.Weights].AsFloat32Array();
                for (int v = 0; v < weights.Length; v++)
                {
                    if (weights[v] <= 0 || bones[v] >= bindCount) continue;
                    if (lookup != null) {
                        int slot = lookup.SpringSlots[bones[v]];
                        if (slot >= 0) springs[slot] = lookup.SpringBones[bones[v]];
                        continue;
                    }
                    string bind = mi.Skin.GetBindName(bones[v]).ToString();
                    int index = mi.Skin.GetBindBone(bones[v]);
                    if (bind == "" && index >= 0) bind = sk.GetBoneName(index);
                    for (int i = 0; i < names.Length; i++) if (names[i] == bind) springs[i] = sk.FindBone(bind);
                }
            }
        }
        FindContacts(bindings);
        rigs[body] = new Rig(springs, contacts);
    }
    private void FindContacts(Dictionary<Skin, Bindings>? bindings)
    {
        for (int side = 0; side < 2; side++)
        {
            Vector3 ankle = sk.GetBoneGlobalRest(foot[side]).Origin, mtp = sk.GetBoneGlobalRest(toe[side]).Origin;
            float sole = float.MaxValue, back = float.MaxValue, front = float.MinValue;
            foreach (var n in BakedWorld.All(root))
            {
                if (n is not MeshInstance3D mi || mi.Mesh == null || mi.Skin == null || !mi.Name.ToString().EndsWith("_lod0", StringComparison.Ordinal)) continue;
                var lookup = bindings?.GetValueOrDefault(mi.Skin);
                for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
                {
                    var arrays = mi.Mesh.SurfaceGetArrays(s); var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var bones = arrays[(int)Mesh.ArrayType.Bones].AsInt32Array(); var weights = arrays[(int)Mesh.ArrayType.Weights].AsFloat32Array();
                    int influences = weights.Length / vertices.Length;
                    for (int v = 0; v < vertices.Length; v++)
                    {
                        float weight = 0;
                        for (int k = 0; k < influences; k++)
                        {
                            int bind = bones[v * influences + k];
                            int bone;
                            if (lookup != null) bone = lookup.Bones[bind];
                            else {
                                string name = mi.Skin.GetBindName(bind).ToString();
                                bone = name == "" ? mi.Skin.GetBindBone(bind) : sk.FindBone(name);
                            }
                            if (bone == foot[side] || bone == toe[side]) weight += weights[v * influences + k];
                        }
                        if (weight <= 0.5f) continue;
                        Vector3 p = root.Transform.AffineInverse() * mi.Transform * vertices[v];
                        sole = Math.Min(sole, p.Y); back = Math.Min(back, p.Z); front = Math.Max(front, p.Z);
                    }
                }
            }
            if (sole == float.MaxValue) { sole = 0.005f; back = ankle.Z - 0.07f; front = mtp.Z + 0.05f; }
            contacts[side * 3] = sk.GetBoneGlobalRest(foot[side]).AffineInverse() * new Vector3(ankle.X, sole, back + 0.034f);
            contacts[side * 3 + 1] = sk.GetBoneGlobalRest(toe[side]).AffineInverse() * new Vector3(mtp.X, sole, mtp.Z);
            contacts[side * 3 + 2] = sk.GetBoneGlobalRest(toe[side]).AffineInverse() * new Vector3(mtp.X, sole, front - 0.008f);
        }
    }
    internal static object CompareSetup(Node3D root)
    {
        string body = root.Name.ToString();
        rigs.Remove(body, out var previous);
        try {
            var sk = root.GetNode<Skeleton3D>("Skeleton3D");
            long bytes = GC.GetAllocatedBytesForCurrentThread();
            long at = System.Diagnostics.Stopwatch.GetTimestamp();
            var original = new HumanLayers(root, sk, false);
            double originalMs = System.Diagnostics.Stopwatch.GetElapsedTime(at).TotalMilliseconds;
            long originalBytes = GC.GetAllocatedBytesForCurrentThread() - bytes;
            rigs.Remove(body);
            bytes = GC.GetAllocatedBytesForCurrentThread(); at = System.Diagnostics.Stopwatch.GetTimestamp();
            var cached = new HumanLayers(root, sk);
            double cachedMs = System.Diagnostics.Stopwatch.GetElapsedTime(at).TotalMilliseconds;
            long cachedBytes = GC.GetAllocatedBytesForCurrentThread() - bytes;
            bool same = original.springs.AsSpan().SequenceEqual(cached.springs) && original.contacts.AsSpan().SequenceEqual(cached.contacts);
            return new { body, originalMs, cachedMs, originalBytes, cachedBytes, contacts = original.contacts.Length, springs = original.springs.Length, ok = same };
        } finally {
            if (previous != null) rigs[body] = previous; else rigs.Remove(body);
        }
    }
    public void ReleaseFeet() { activeContact[0] = activeContact[1] = -1; Array.Clear(contactDown); }
    /// <param name="standLock">Hold the planted feet while one standing clip fades into another (D2).</param>
    /// <param name="sitFeet">Seated: how far the node was raised (+) or lowered (-) from the clip's own seat
    /// height; the feet go back to the floor by leg IK.</param>
    public void Update(float dt, bool walk, float phase, float duty, bool standLock = false, float sitFeet = 0)
    {
        using var timing = Dev.PeopleTiming.Layers();
        Vector3 position = root.GlobalPosition;
        float distance = position.DistanceSquaredTo(Main.I.Cam.GlobalPosition);
        Vector3 velocity = hadPosition ? (position - lastPosition) / Math.Max(dt, 0.001f) : Vector3.Zero;
        Vector3 forward = root.GlobalBasis.Z;
        // a node that moves or turns takes its feet with it: no stance lock across it
        if (standLock && hadPosition && ((position - lastPosition).LengthSquared() > 0.000009f || forward.Dot(lastForward) < 0.99996f)) ReleaseFeet();
        lastPosition = position; lastForward = forward; hadPosition = true;
        if (distance >= 225) { look = Vector2.Zero; ReleaseFeet(); return; }
        Vector3 target = root.GlobalTransform.AffineInverse() * (AttentionTarget ?? Main.I.Cam.GlobalPosition);
        Vector2 want = Vector2.Zero;
        if (!LocalPlayer && distance < 36 && (AttentionTarget.HasValue || target.Z > MathF.Sqrt(target.X * target.X + target.Z * target.Z) * 0.5f))
        {
            float yaw = MathF.Atan2(target.X, target.Z);
            float pitch = MathF.Atan2(target.Y - sk.GetBoneGlobalPose(head).Origin.Y, MathF.Sqrt(target.X * target.X + target.Z * target.Z));
            want = new Vector2(Math.Clamp(yaw, -0.6f, 0.6f), Math.Clamp(pitch, -0.3f, 0.3f));
        }
        look = look.Lerp(want, 1 - MathF.Exp(-dt * 6));
        float attention = Math.Clamp((225 - distance) / 81, 0, 1);
        Turn(chest, look * (0.18f * attention)); Turn(head, look * (0.82f * attention));
        // Eye bones point along local +y (forward), unlike the upright head frame.
        Vector2 eyes = new Vector2(Math.Clamp(want.X - look.X * 0.6f, -0.4363f, 0.4363f), Math.Clamp(want.Y - look.Y * 0.6f, -0.2618f, 0.2618f));
        Eye(eyeL, eyes); Eye(eyeR, eyes);
        float drive = Math.Clamp((root.GlobalBasis.Inverse() * velocity).Z * -0.035f, -0.16f, 0.16f);
        // Bounded substeps keep throttled crowd updates stable.
        int steps = Math.Max(1, (int)Math.Ceiling(Math.Min(dt, 0.25f) / 0.016f));
        float step = Math.Min(dt, 0.25f) / steps;
        for (int i = 0; i < springs.Length; i++)
        {
            if (springs[i] < 0) continue;
            for (int s = 0; s < steps; s++)
            {
                springVelocity[i] += ((drive - springAngle[i]) * 65 - springVelocity[i] * 12) * step;
                springAngle[i] = Math.Clamp(springAngle[i] + springVelocity[i] * step, -0.22f, 0.22f);
            }
            sk.SetBonePoseRotation(springs[i], sk.GetBonePoseRotation(springs[i]) * new Quaternion(Vector3.Right, springAngle[i] * attention));
        }
        if (sitFeet != 0) SitFeet(sitFeet);
        if (!walk && !standLock) { ReleaseFeet(); return; }
        if (!walk) duty = 2; // standing: both feet stand all the time
        float pelvisDrop = 0;
        for (int i = 0; i < 2; i++)
        {
            supports[i] = false;
            float stridePhase = (phase * 2 + (i == 0 ? 0 : 0.5f)) % 1;
            bool down = stridePhase < duty;
            if (!down || foot[i] < 0) { activeContact[i] = -1; for (int c = 0; c < 3; c++) contactDown[i * 3 + c] = false; continue; }
            var pose = sk.GetBoneGlobalPose(foot[i]);
            int selected = activeContact[i];
            float selectedY = float.MaxValue; Vector3 selectedWorld = Vector3.Zero;
            for (int c = 0; c < 3; c++)
            {
                int at = i * 3 + c;
                Vector3 world = sk.GlobalTransform * (sk.GetBoneGlobalPose(c == 0 ? foot[i] : toe[i]) * contacts[at]);
                if (world.Y - root.GlobalPosition.Y >= 0.012f) { contactDown[at] = false; continue; }
                if (!contactDown[at]) contactAnchors[at] = world;
                contactDown[at] = true;
                // A rolling heel and a planted toe cannot both be held as rigid points.
                // Keep the current support until it lifts, then hand over to the lowest sole contact.
                if (at == activeContact[i] || world.Y < selectedY)
                {
                    selected = at; selectedY = world.Y; selectedWorld = world;
                    if (at == activeContact[i]) break;
                }
            }
            if (selectedY == float.MaxValue) { activeContact[i] = -1; continue; }
            if (selected != activeContact[i]) contactAnchors[selected] = selectedWorld;
            activeContact[i] = selected;
            Vector3 correction = contactAnchors[selected] - selectedWorld; correction.Y = 0;
            ankleTargets[i] = pose.Origin + sk.GlobalBasis.Inverse() * correction;
            footRotations[i] = pose.Basis.GetRotationQuaternion(); supports[i] = true;
            Vector3 hip = sk.GetBoneGlobalPose(up[i]).Origin, knee = sk.GetBoneGlobalPose(low[i]).Origin;
            float length = hip.DistanceTo(knee) + knee.DistanceTo(pose.Origin) - 0.001f;
            Vector3 reach = hip - ankleTargets[i];
            float vertical = MathF.Sqrt(Math.Max(0, length * length - reach.X * reach.X - reach.Z * reach.Z));
            pelvisDrop = Math.Max(pelvisDrop, reach.Y - vertical);
        }
        if (pelvisDrop > 0)
        {
            Vector3 hips = sk.GetBonePosePosition(hipBone);
            hips.Y -= Math.Min(pelvisDrop, 0.12f); sk.SetBonePosePosition(hipBone, hips);
        }
        for (int i = 0; i < 2; i++)
        {
            if (!supports[i]) continue;
            Reach(up[i], low[i], foot[i], ankleTargets[i]);
            MaxReachError = Math.Max(MaxReachError, sk.GetBoneGlobalPose(foot[i]).Origin.DistanceTo(ankleTargets[i]));
            int parent = sk.GetBoneParent(foot[i]);
            sk.SetBonePoseRotation(foot[i], sk.GetBoneGlobalPose(parent).Basis.GetRotationQuaternion().Inverse() * footRotations[i]);
            int selected = activeContact[i], selectedBone = selected % 3 == 0 ? foot[i] : toe[i];
            Vector3 supported = sk.GlobalTransform * (sk.GetBoneGlobalPose(selectedBone) * contacts[selected]);
            Vector3 drift = supported - contactAnchors[selected]; drift.Y = 0;
            MaxSlide = Math.Max(MaxSlide, drift.Length()); ContactSamples++;
        }
    }

    private void SitFeet(float raised)
    {
        float scale = sk.GlobalTransform.Basis.Y.Length();
        if (scale < 1e-4f) return;
        Vector3 down = new Vector3(0, raised / scale, 0);
        for (int i = 0; i < 2; i++)
        {
            if (foot[i] < 0) continue;
            var pose = sk.GetBoneGlobalPose(foot[i]);
            Quaternion keep = pose.Basis.GetRotationQuaternion();
            Reach(up[i], low[i], foot[i], pose.Origin - down);
            int parent = sk.GetBoneParent(foot[i]);
            sk.SetBonePoseRotation(foot[i], sk.GetBoneGlobalPose(parent).Basis.GetRotationQuaternion().Inverse() * keep);
        }
    }

    private void Turn(int bone, Vector2 angle)
    {
        if (bone >= 0) sk.SetBonePoseRotation(bone, sk.GetBonePoseRotation(bone) * Quaternion.FromEuler(new Vector3(-angle.Y, angle.X, 0)));
    }
    private void Eye(int bone, Vector2 angle)
    {
        if (bone >= 0) sk.SetBonePoseRotation(bone, sk.GetBoneRest(bone).Basis.GetRotationQuaternion() * Quaternion.FromEuler(new Vector3(angle.Y, 0, -angle.X)));
    }
    internal void Hands(string clip, float time, float ratio, float strength)
    {
        bool carry = clip == "sack_walk";
        if (!handTracks.TryGetValue(carry ? "sack_hold" : clip, out var track) || strength <= 0) return;
        if (carry) time = 0;
        Node3D? thing = null;
        if (track.Model.Length > 0 && (!contactThings.TryGetValue(track.Model, out thing) || thing != null && (!GodotObject.IsInstanceValid(thing) || thing.GetParent() != sk)))
            contactThings[track.Model] = thing = sk.GetNodeOrNull<Node3D>("work_" + track.Model);
        Transform3D frame = thing?.Transform ?? Transform3D.Identity;
        if (track.Model == "cask") frame.Basis = Basis.Identity;
        int count = track.Keys.Length / 14;
        float f = Math.Clamp(time * 24, 0, count - 1);
        int a = (int)f, b = Math.Min(count - 1, a + 1); float w = f - a;
        for (int side = 0; side < (carry ? 1 : 2); side++)
        {
            int i = a * 14 + side * 7, j = b * 14 + side * 7;
            var k = track.Keys;
            Vector3 p = new Vector3(k[i], k[i + 1], k[i + 2]).Lerp(new Vector3(k[j], k[j + 1], k[j + 2]), w) * ratio;
            Quaternion q = new Quaternion(k[i + 3], k[i + 4], k[i + 5], k[i + 6]).Normalized().Slerp(new Quaternion(k[j + 3], k[j + 4], k[j + 5], k[j + 6]).Normalized(), w);
            var now = sk.GetBoneGlobalPose(hand[side]);
            Vector3 target = now.Origin.Lerp(frame * p, strength);
            Quaternion rotation = now.Basis.GetRotationQuaternion().Slerp(frame.Basis.GetRotationQuaternion() * q, strength);
            Arm(side, target, rotation);
        }
        People2Shoulders.Apply(sk);
    }

    internal void Arm(int side, Vector3 target, Quaternion rotation, Vector3? bend = null)
    {
        // Interpolated clips and attention can leave a target just outside the current
        // shoulder's reach. Let the clavicle follow it; keep both limb lengths unchanged.
        for (int attempt = 0; attempt < 2 && clavicle[side] >= 0; attempt++)
        {
            Vector3 shoulder = sk.GetBoneGlobalPose(arm[side]).Origin;
            Vector3 elbow = sk.GetBoneGlobalPose(forearm[side]).Origin;
            Vector3 wrist = sk.GetBoneGlobalPose(hand[side]).Origin;
            float excess = shoulder.DistanceTo(target) - shoulder.DistanceTo(elbow) - elbow.DistanceTo(wrist) + 0.0003f;
            if (excess <= 0) break;
            Aim(clavicle[side], shoulder, shoulder + (target - shoulder).Normalized() * Math.Min(excess, 0.036f));
        }
        Vector3 pole = bend ?? new Vector3(side == 0 ? 0.8f : -0.8f, -0.35f, -0.6f);
        Reach(arm[side], forearm[side], hand[side], target, pole);
        int parent = sk.GetBoneParent(hand[side]);
        sk.SetBonePoseRotation(hand[side], (sk.GetBoneGlobalPose(parent).Basis.GetRotationQuaternion().Inverse() * rotation).Normalized());
        WristTwist(side);
        HandReachError = Math.Max(HandReachError, sk.GetBoneGlobalPose(hand[side]).Origin.DistanceTo(target));
    }

    internal void ForearmCarry(int side, Vector3 upperDirection, Vector3 forearmDirection, Quaternion rotation)
    {
        Vector3 shoulder = sk.GetBoneGlobalPose(arm[side]).Origin;
        Vector3 elbow = sk.GetBoneGlobalPose(forearm[side]).Origin;
        float length = shoulder.DistanceTo(elbow);
        Aim(arm[side], elbow, shoulder + upperDirection.Normalized() * length);
        elbow = sk.GetBoneGlobalPose(forearm[side]).Origin;
        Vector3 wrist = sk.GetBoneGlobalPose(hand[side]).Origin;
        Aim(forearm[side], wrist, elbow + forearmDirection.Normalized() * elbow.DistanceTo(wrist));
        sk.SetBonePoseRotation(hand[side], (sk.GetBoneGlobalPose(forearm[side]).Basis.GetRotationQuaternion().Inverse() * rotation).Normalized());
        WristTwist(side);
    }

    private void WristTwist(int side)
    {
        Quaternion delta = sk.GetBonePoseRotation(hand[side]) * sk.GetBoneRest(hand[side]).Basis.GetRotationQuaternion().Inverse();
        Quaternion twist = new Quaternion(0, delta.Y, 0, delta.W);
        if (armTwist[side] >= 0 && twist.LengthSquared() > 1e-8f)
            sk.SetBonePoseRotation(armTwist[side], sk.GetBoneRest(armTwist[side]).Basis.GetRotationQuaternion() * Quaternion.Identity.Slerp(twist.Normalized(), 0.6f));
    }

    private void Reach(int upper, int lower, int end, Vector3 target, Vector3? bend = null)
    {
        if (upper < 0 || lower < 0) return;
        Vector3 s = sk.GetBoneGlobalPose(upper).Origin, e = sk.GetBoneGlobalPose(lower).Origin, f = sk.GetBoneGlobalPose(end).Origin;
        float a = s.DistanceTo(e), b = e.DistanceTo(f), d = Math.Clamp(s.DistanceTo(target), Math.Abs(a - b) + 0.0001f, a + b - 0.0001f);
        Vector3 bendDirection = bend ?? Vector3.Back;
        Vector3 dir = (target - s).Normalized(), pole = bendDirection - dir * dir.Dot(bendDirection);
        if (pole.LengthSquared() < 0.00001f) return;
        float c = Math.Clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
        Aim(upper, e, s + dir * (a * c) + pole.Normalized() * (a * MathF.Sqrt(1 - c * c)));
        Aim(lower, sk.GetBoneGlobalPose(end).Origin, s + dir * d);
    }
    private void Aim(int bone, Vector3 from, Vector3 to)
    {
        var pose = sk.GetBoneGlobalPose(bone);
        Vector3 u = from - pose.Origin, v = to - pose.Origin;
        if (u.LengthSquared() < 0.000001f || v.LengthSquared() < 0.000001f) return;
        int parent = sk.GetBoneParent(bone);
        Quaternion parentQ = parent >= 0 ? sk.GetBoneGlobalPose(parent).Basis.GetRotationQuaternion() : Quaternion.Identity;
        sk.SetBonePoseRotation(bone, parentQ.Inverse() * new Quaternion(u.Normalized(), v.Normalized()) * pose.Basis.GetRotationQuaternion());
    }
}
