using System;
using Godot;

namespace Scheldemist.People;

// Local eye behaviour: cached bones/mesh and value types only in Update. No protocol state.
internal sealed class People2Eyes
{
    private readonly Node3D root;
    private readonly Skeleton3D sk;
    private readonly int head, left, right;
    private MeshInstance3D? near;
    private Mesh? lastMesh;
    private int blink = -1, brow = -1, smile = -1;
    private uint rng;
    private float nextBlink, blinkTime = -1, nextLook, expression;
    private Vector2 gaze, want;
    internal People2Eyes(Node3D root)
    {
        this.root = root; sk = root.GetNode<Skeleton3D>("Skeleton3D");
        head = sk.FindBone("head"); left = sk.FindBone("eyeL"); right = sk.FindBone("eyeR");
        string bodyMesh = root.Name + "_lod0";
        foreach (var n in World.BakedWorld.All(root))
            if (n is MeshInstance3D mi && mi.Name.ToString() == bodyMesh) { near = mi; break; }
        Seed(1873);
    }
    internal void Seed(uint seed) { rng = seed | 1; nextBlink = 1 + Random() * 4; nextLook = Random(); expression = Random()*20; }
    private float Random() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return (rng & 0xffffff) / 16777216f; }
    internal void Update(float dt, bool speaking, bool localPlayer = false)
    {
        if (near == null || !GodotObject.IsInstanceValid(near) || !root.IsInsideTree()) return;
        if (near.Mesh != lastMesh)
        {
            lastMesh = near.Mesh; blink = near.FindBlendShapeByName("blink"); brow = near.FindBlendShapeByName("brow_raise"); smile = near.FindBlendShapeByName("smile");
        }
        float distance = localPlayer ? 0 : root.GlobalPosition.DistanceSquaredTo(Main.I.Cam.GlobalPosition);
        if (distance >= 225)
        {
            Set(blink, 0); Set(brow, 0); Set(smile, 0); blinkTime = -1; gaze = Vector2.Zero;
            return;
        }
        // Closing 65 ms, held 25 ms, opening 110 ms. Occasional double blink.
        nextBlink -= dt;
        if (nextBlink <= 0 && blinkTime < 0) { blinkTime = 0; nextBlink = Random() < 0.12f ? 0.3f : 2.2f + Random() * 5.8f; }
        float closure = 0;
        if (blinkTime >= 0)
        {
            blinkTime += dt;
            closure = blinkTime < 0.065f ? blinkTime / 0.065f : blinkTime < 0.09f ? 1 : Math.Max(0, 1 - (blinkTime - 0.09f) / 0.11f);
            if (blinkTime >= 0.2f) blinkTime = -1;
        }
        Set(blink, Mathf.SmoothStep(0, 1, closure));
        expression += dt;
        Set(brow, speaking ? 0.12f + 0.16f * Math.Max(0, MathF.Sin(expression * 1.7f)) : 0.025f);
        Set(smile, speaking ? 0.08f + 0.09f * Math.Max(0, MathF.Sin(expression * 0.7f)) : 0.025f);
        nextLook -= dt;
        if (nextLook <= 0)
        {
            nextLook = 0.25f + Random() * 1.5f;
            Vector3 target = Main.I.Cam.GlobalPosition;
            bool hasTarget = !localPlayer && distance < 36;
            float best = 36;
            if (!localPlayer) foreach (var speaker in People2Moves.Talkers)
            {
                if (!speaker.Alive || !speaker.Speaking) continue;
                float d = speaker.Position.DistanceSquaredTo(root.GlobalPosition);
                if (d < 0.01f || d >= best) continue;
                best = d; target = speaker.Position + Vector3.Up * 1.5f; hasTarget = true;
            }
            want = new Vector2((Random() - 0.5f) * 0.12f, (Random() - 0.5f) * 0.07f);
            if (hasTarget && head >= 0)
            {
                // Head's current frame, after HumanLayers attention, avoids turning the eyes twice.
                var frame = sk.GlobalTransform * sk.GetBoneGlobalPose(head);
                var local = frame.AffineInverse() * target;
                if (local.Z > 0) want += new Vector2(Math.Clamp(MathF.Atan2(local.X, local.Z), -0.40f, 0.40f), Math.Clamp(MathF.Atan2(local.Y, new Vector2(local.X, local.Z).Length()), -0.22f, 0.22f));
            }
        }
        gaze = gaze.Lerp(want, 1 - MathF.Exp(-dt * 38));
        Eye(left); Eye(right);
    }
    private void Set(int key, float value) { if (key >= 0) near!.SetBlendShapeValue(key, value); }
    private void Eye(int bone)
    {
        if (bone < 0) return;
        // The eye bone's +y is forward; start at rest to replace HumanLayers' eye turn.
        sk.SetBonePoseRotation(bone, sk.GetBoneRest(bone).Basis.GetRotationQuaternion() * Quaternion.FromEuler(new Vector3(gaze.Y, 0, -gaze.X)));
    }
    internal long AllocationProof()
    {
        for (int i = 0; i < 8; i++) Update(.001f, false);
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++) Update(.001f, false);
        return GC.GetAllocatedBytesForCurrentThread()-before;
    }
}
