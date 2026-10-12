using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.People;

// Cached bone layers. Every-frame work uses value types and the body's existing arrays only.
internal sealed class HumanLayers
{
    private sealed record Rig(int[] Springs, Vector3[] Contacts);
    private static readonly Dictionary<string, Rig> rigs = new();
    internal static void Forget() => rigs.Clear();
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
    private Vector3 lastPosition;
    private Vector2 look;
    private bool hadPosition;
    public HumanLayers(Node3D root, Skeleton3D sk)
    {
        this.root = root; this.sk = sk;
        hipBone = sk.FindBone("hips");
        head = sk.FindBone("head"); chest = sk.FindBone("chest"); eyeL = sk.FindBone("eyeL"); eyeR = sk.FindBone("eyeR");
        for (int i = 0; i < 2; i++)
        {
            string suffix = i == 0 ? "L" : "R";
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
        // A skin may bind every bone even when none of its vertices use it. Inspect nonzero weights.
        foreach (var n in BakedWorld.All(root))
        {
            if (n is not MeshInstance3D mi || mi.Mesh == null || mi.Skin == null) continue;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                var arrays = mi.Mesh.SurfaceGetArrays(s);
                var bones = arrays[(int)Mesh.ArrayType.Bones].AsInt32Array();
                var weights = arrays[(int)Mesh.ArrayType.Weights].AsFloat32Array();
                for (int v = 0; v < weights.Length; v++)
                {
                    if (weights[v] <= 0 || bones[v] >= mi.Skin.GetBindCount()) continue;
                    string bind = mi.Skin.GetBindName(bones[v]).ToString();
                    int index = mi.Skin.GetBindBone(bones[v]);
                    if (bind == "" && index >= 0) bind = sk.GetBoneName(index);
                    for (int i = 0; i < names.Length; i++) if (names[i] == bind) springs[i] = sk.FindBone(bind);
                }
            }
        }
        FindContacts();
        rigs[body] = new Rig(springs, contacts);
    }
    private void FindContacts()
    {
        for (int side = 0; side < 2; side++)
        {
            Vector3 ankle = sk.GetBoneGlobalRest(foot[side]).Origin, mtp = sk.GetBoneGlobalRest(toe[side]).Origin;
            float sole = float.MaxValue, back = float.MaxValue, front = float.MinValue;
            foreach (var n in BakedWorld.All(root))
            {
                if (n is not MeshInstance3D mi || mi.Mesh == null || mi.Skin == null || !mi.Name.ToString().EndsWith("_lod0", StringComparison.Ordinal)) continue;
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
                            string name = mi.Skin.GetBindName(bind).ToString();
                            int bone = name == "" ? mi.Skin.GetBindBone(bind) : sk.FindBone(name);
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
    public void ReleaseFeet() { activeContact[0] = activeContact[1] = -1; Array.Clear(contactDown); }
    public void Update(float dt, bool walk, float phase, float duty)
    {
        using var timing = Dev.PeopleTiming.Layers();
        Vector3 position = root.GlobalPosition;
        float distance = position.DistanceSquaredTo(Main.I.Cam.GlobalPosition);
        Vector3 velocity = hadPosition ? (position - lastPosition) / Math.Max(dt, 0.001f) : Vector3.Zero;
        lastPosition = position; hadPosition = true;
        if (distance >= 225) { look = Vector2.Zero; ReleaseFeet(); return; }
        Vector3 target = root.GlobalTransform.AffineInverse() * Main.I.Cam.GlobalPosition;
        Vector2 want = Vector2.Zero;
        if (distance < 36 && target.Z > MathF.Sqrt(target.X * target.X + target.Z * target.Z) * 0.5f)
        {
            float yaw = MathF.Atan2(target.X, target.Z);
            float pitch = MathF.Atan2(target.Y - sk.GetBoneGlobalPose(head).Origin.Y, MathF.Sqrt(target.X * target.X + target.Z * target.Z));
            want = new Vector2(Math.Clamp(yaw, -0.6f, 0.6f), Math.Clamp(pitch, -0.3f, 0.3f));
        }
        look = look.Lerp(want, 1 - MathF.Exp(-dt * 6));
        Turn(chest, look * 0.18f); Turn(head, look * 0.82f);
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
            sk.SetBonePoseRotation(springs[i], sk.GetBonePoseRotation(springs[i]) * new Quaternion(Vector3.Right, springAngle[i]));
        }
        if (!walk) { ReleaseFeet(); return; }
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

    private void Turn(int bone, Vector2 angle)
    {
        if (bone >= 0) sk.SetBonePoseRotation(bone, sk.GetBonePoseRotation(bone) * Quaternion.FromEuler(new Vector3(-angle.Y, angle.X, 0)));
    }
    private void Eye(int bone, Vector2 angle)
    {
        if (bone >= 0) sk.SetBonePoseRotation(bone, sk.GetBoneRest(bone).Basis.GetRotationQuaternion() * Quaternion.FromEuler(new Vector3(angle.Y, 0, -angle.X)));
    }
    private void Reach(int upper, int lower, int end, Vector3 target)
    {
        if (upper < 0 || lower < 0) return;
        Vector3 s = sk.GetBoneGlobalPose(upper).Origin, e = sk.GetBoneGlobalPose(lower).Origin, f = sk.GetBoneGlobalPose(end).Origin;
        float a = s.DistanceTo(e), b = e.DistanceTo(f), d = Math.Clamp(s.DistanceTo(target), Math.Abs(a - b) + 0.0001f, a + b - 0.0001f);
        Vector3 dir = (target - s).Normalized(), pole = Vector3.Back - dir * dir.Dot(Vector3.Back);
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
