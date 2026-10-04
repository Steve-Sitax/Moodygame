using System;
using Godot;
using Scheldemist.Play;
using Scheldemist.People;

namespace Scheldemist.Game;

// game/wardrobe.ts and instruments.ts, in the puppet's own +z-facing frame.
internal partial class LeadWear : Node3D
{
    public Node3D? Moving, Left, Right, Purse;
    public Skeleton3D? Skeleton;
    public int UpL = -1, LowL = -1, HandL = -1, UpR = -1, LowR = -1, HandR = -1;
    public void Bind(Human human)
    {
        Scale = Vector3.One * human.Scale;
        Skeleton = human.Root.GetNodeOrNull<Skeleton3D>("Skeleton3D");
        if (Skeleton == null) return;
        UpL = Skeleton.FindBone("armUpL"); LowL = Skeleton.FindBone("armLowL"); HandL = Skeleton.FindBone("handL");
        UpR = Skeleton.FindBone("armUpR"); LowR = Skeleton.FindBone("armLowR"); HandR = Skeleton.FindBone("handR");
    }
}
internal static class LeadLooks
{
    private static MeshInstance3D Box(Node3D p, float w, float h, float d, uint c, float x, float y, float z) => EventProps.Box(p, new Vector3(w, h, d), new Vector3(x, y, z), c);
    internal static MeshInstance3D Cylinder(Node3D p, float top, float bottom, float h, uint c, float x, float y, float z)
    {
        var m = new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = top, BottomRadius = bottom, Height = h, RadialSegments = 10, Rings = 1, Material = Goods.I.Plain(c) }, Position = new Vector3(x, y, z) }; p.AddChild(m); return m;
    }
    private static void Hat(Node3D p) { Cylinder(p, 0.155f, 0.155f, 0.015f, 0x151417, 0, 1.68f, 0); Cylinder(p, 0.1f, 0.095f, 0.2f, 0x151417, 0, 1.78f, 0); }
    public static Node3D Make(string role)
    {
        var r = new LeadWear { Name = "wardrobe_" + role };
        switch (role)
        {
            case "bride": case "widow":
                uint c = role == "bride" ? 0xece8dcu : 0x0e0d10u;
                Box(r, 0.24f, 0.012f, 0.24f, c, 0, 1.712f, -0.01f);
                Box(r, 0.38f, 0.9f, 0.025f, c, 0, 1.27f, -0.15f);
                if (role == "bride")
                {
                    for (int i = 0; i < 9; i++) Cylinder(r, 0.036f, 0.03f, 0.05f, i % 3 == 2 ? 0x3e5a2cu : 0xf4efe0u, MathF.Cos(i * MathF.Tau / 9) * 0.1f, 1.71f, MathF.Sin(i * MathF.Tau / 9) * 0.1f);
                    Cylinder(r, 0.07f, 0.02f, 0.17f, 0x3e5a2c, 0.02f, 1, 0.24f);
                    for (int i = 0; i < 6; i++) Cylinder(r, 0.035f, 0.03f, 0.04f, 0xf4efe0, 0.02f + MathF.Cos(i) * 0.05f, 1.05f + i % 2 * 0.03f, 0.24f + MathF.Sin(i) * 0.05f);
                }
                else Box(r, 0.1f, 0.1f, 0.01f, 0xf4efe0, 0.12f, 1.08f, 0.24f);
                break;
            case "groom": Hat(r); Cylinder(r, 0.03f, 0.03f, 0.04f, 0xf4efe0, 0.1f, 1.38f, 0.13f); break;
            case "priest": Cylinder(r, 0.2f, 0.25f, 0.5f, 0xe6e2d6, 0, 0.98f, 0); foreach (float x in new[] { -0.07f, 0.07f }) Box(r, 0.05f, 0.62f, 0.02f, 0x6a2a5a, x, 1.02f, 0.215f); break;
            case "speaker": case "showman": Hat(r); Cylinder(r, 0.02f, 0.02f, 0.26f, 0xd8cfb4, 0.215f, 0.82f, 0.07f); break;
            case "auctioneer":
                var bell = new Node3D { Position = new Vector3(-0.3f, 1.2f, 0.18f) }; r.AddChild(bell); r.Moving = bell;
                Cylinder(bell, 0.012f, 0.012f, 0.14f, 0x5a3a20, 0, 0.1f, 0); Cylinder(bell, 0.035f, 0.07f, 0.09f, 0xb8923a, 0, 0, 0); break;
            case "drunkard": Cylinder(r, 0.035f, 0.035f, 0.2f, 0x24402a, -0.26f, 0.92f, 0.1f); Cylinder(r, 0.012f, 0.03f, 0.08f, 0x24402a, -0.26f, 1.05f, 0.1f); break;
            case "pickpocket": Cylinder(r, 0.12f, 0.12f, 0.05f, 0x3a3430, 0, 1.69f, -0.01f); Box(r, 0.16f, 0.012f, 0.08f, 0x3a3430, 0, 1.665f, 0.11f); r.Purse = Box(r, 0.09f, 0.07f, 0.04f, 0x5a3a24, -0.25f, 0.95f, 0.14f); r.Purse.Visible = false; break;
            case "victim": r.AddChild(EventProps.Make("flowers")); r.GetChild<Node3D>(0).Position = new Vector3(0.25f, 0.85f, 0.12f); break;
            case "bearers": Cylinder(r, 0.065f, 0.065f, 0.08f, 0x0e0d10, 0.24f, 1.3f, 0); break;
            case "hawker": Box(r, 0.52f, 0.03f, 0.3f, 0x5a3a20, 0, 1, 0.32f); for (int i = 0; i < 6; i++) Box(r, 0.07f, 0.05f, 0.07f, 0xc89a4a, -0.19f + i % 3 * 0.19f, 1.04f, 0.25f + i / 3 * 0.13f); break;
            case "fireman": Cylinder(r, 0.12f, 0.16f, 0.16f, 0xa68434, 0, 1.7f, 0); Box(r, 0.03f, 0.08f, 0.24f, 0xa68434, 0, 1.82f, 0); break;
            case "natie_foreman": Hat(r); Box(r, 0.13f, 0.18f, 0.025f, 0xd8cfb4, 0.2f, 1.22f, 0.26f); break;
            case "ballad_singer": Cylinder(r, 0.1f, 0.12f, 0.07f, 0x9a2924, 0, 1.47f, 0.01f); Box(r, 0.2f, 0.015f, 0.27f, 0xd8cfb4, 0.2f, 1.05f, 0.16f); break;
            case "organ_grinder":
                var cart = new Node3D { Position = new Vector3(0, 0, 0.5f) }; r.AddChild(cart);
                Box(cart, 0.9f, 0.06f, 0.46f, 0x6a3f22, 0, 0.5f, 0); Box(cart, 0.72f, 0.6f, 0.4f, 0x8a2a24, 0, 0.85f, 0); Box(cart, 0.74f, 0.05f, 0.42f, 0xb89a4a, 0, 1.17f, 0); Box(cart, 0.5f, 0.3f, 0.02f, 0xb89a4a, 0, 0.86f, 0.21f);
                foreach (float side in new[] { -1f, 1f }) Cylinder(cart, 0.28f, 0.28f, 0.05f, 0x2a1c14, side * 0.48f, 0.28f, 0).Rotation = new Vector3(0, 0, MathF.PI / 2);
                r.Moving = new Node3D { Position = new Vector3(-0.2f, 1.03f, -0.21f) }; cart.AddChild(r.Moving); Box(r.Moving, 0.025f, 0.1f, 0.02f, 0x3a3a3c, 0, 0.04f, -0.05f); Box(r.Moving, 0.03f, 0.03f, 0.08f, 0x6a3f22, 0, 0.08f, -0.09f); break;
            case "fiddler":
                var fiddle = new Node3D { Position = new Vector3(0.04f, 1.37f, 0.1f), Rotation = new Vector3(0.18f, 0.6f, -0.45f) }; r.AddChild(fiddle);
                Box(fiddle, 0.171f, 0.045f, 0.306f, 0x6a3f22, 0, 0, 0.153f); Box(fiddle, 0.036f, 0.027f, 0.216f, 0x2a1c14, 0, 0.018f, 0.414f); r.Moving = Box(r, 0.62f, 0.012f, 0.012f, 0x2a1c14, -0.2f, 1.4f, 0.25f); break;
            case "accordionist":
                r.Moving = Box(r, 0.3f, 0.28f, 0.14f, 0xd8cfb8, 0, 1.08f, 0.27f);
                r.Left = Box(r, 0.08f, 0.3f, 0.16f, 0x2a1c14, 0.19f, 1.08f, 0.27f); r.Right = Box(r, 0.08f, 0.3f, 0.16f, 0x2a1c14, -0.19f, 1.08f, 0.27f);
                for (int i = -2; i <= 2; i++) Box(r.Moving, 0.012f, 0.29f, 0.148f, 0x2a1c14, i * 0.06f, 0, 0); break;
        }
        return r;
    }
    public static void Animate(Node3D node, string? role, double t)
    {
        if (node is not LeadWear r || r.Moving == null) return;
        if (role == "organ_grinder") r.Moving.Rotation = new Vector3(0, 0, (float)(-t * 5));
        else if (role == "auctioneer") r.Moving.Rotation = new Vector3((float)Math.Sin(t * 3) * 0.5f, 0, 0);
        else if (role == "fiddler") r.Moving.Position = new Vector3(-0.2f + (float)Math.Sin(t * 4.2) * 0.2f, 1.4f, 0.25f);
        else if (role == "accordionist") { float w = 0.3f * (0.7f + 0.45f * (0.5f + 0.5f * (float)Math.Sin(t * 2.1))); r.Moving.Scale = new Vector3(w / 0.3f, 1, 1); r.Left!.Position = new Vector3(w / 2 + 0.04f, 1.08f, 0.27f); r.Right!.Position = new Vector3(-w / 2 - 0.04f, 1.08f, 0.27f); }
    }
    // The animation has posed the body already. Bring each wrist to the held object,
    // retaining the rest of that clip; cached indices and value types keep this allocation free.
    public static void Grip(Node3D node, string? role)
    {
        if (node is not LeadWear r || !r.IsInsideTree() || !GodotObject.IsInstanceValid(r.Skeleton) || !r.Skeleton!.IsInsideTree()) return;
        Vector3 left, right; bool both = false;
        switch (role)
        {
            case "accordionist": left = r.Left!.Position; right = r.Right!.Position; both = true; break;
            case "fiddler": left = new Vector3(0.18f, 1.4f, 0.4f); right = r.Moving!.Position; both = true; break;
            case "organ_grinder": left = new Vector3(-0.2f, 1.03f, 0.29f); right = new Vector3(0.2f, 1.17f, 0.35f); both = true; break;
            case "hawker": left = new Vector3(0.24f, 1, 0.28f); right = new Vector3(-0.24f, 1, 0.28f); both = true; break;
            case "bride": left = new Vector3(0.02f, 0.96f, 0.24f); right = new Vector3(-0.04f, 0.96f, 0.24f); both = true; break;
            case "auctioneer": left = new Vector3(-0.3f, 1.3f, 0.18f); right = Vector3.Zero; break;
            case "drunkard": left = new Vector3(-0.26f, 0.99f, 0.1f); right = Vector3.Zero; break;
            case "speaker": case "showman": left = new Vector3(0.215f, 0.82f, 0.07f); right = Vector3.Zero; break;
            case "ballad_singer": left = new Vector3(0.2f, 1.05f, 0.16f); right = Vector3.Zero; break;
            case "pickpocket": if (r.Purse?.Visible != true) return; left = r.Purse.Position; right = Vector3.Zero; break;
            default: return;
        }
        Reach(r, left.X < 0 ? r.UpR : r.UpL, left.X < 0 ? r.LowR : r.LowL, left.X < 0 ? r.HandR : r.HandL, r.GlobalTransform * left, new Vector3(left.X < 0 ? -1 : 1, -0.3f, 0.35f));
        if (both) Reach(r, right.X < 0 ? r.UpR : r.UpL, right.X < 0 ? r.LowR : r.LowL, right.X < 0 ? r.HandR : r.HandL, r.GlobalTransform * right, new Vector3(right.X < 0 ? -1 : 1, -0.3f, 0.35f));
    }
    private static void Reach(LeadWear r, int up, int low, int hand, Vector3 world, Vector3 pole)
    {
        if (up < 0 || low < 0 || hand < 0) return;
        var sk = r.Skeleton!; var inv = sk.GlobalTransform.AffineInverse();
        Vector3 s = sk.GetBoneGlobalPose(up).Origin, e = sk.GetBoneGlobalPose(low).Origin, h = sk.GetBoneGlobalPose(hand).Origin, target = inv * world;
        float a = s.DistanceTo(e), b = e.DistanceTo(h), want = s.DistanceTo(target);
        if (a < 0.001f || b < 0.001f || want < 0.001f) return;
        float d = Math.Clamp(want, MathF.Abs(a - b) + 0.0001f, a + b - 0.0001f);
        Vector3 direction = (target - s).Normalized(), n = inv.Basis * (r.GlobalBasis * pole);
        n -= direction * n.Dot(direction); if (n.LengthSquared() < 0.00001f) n = Vector3.Down - direction * direction.Dot(Vector3.Down); n = n.Normalized();
        float c = Math.Clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
        Aim(sk, up, e, s + direction * (a * c) + n * (a * MathF.Sqrt(1 - c * c)));
        h = sk.GetBoneGlobalPose(hand).Origin;
        Aim(sk, low, h, s + direction * d);
    }
    private static void Aim(Skeleton3D sk, int bone, Vector3 from, Vector3 to)
    {
        var pose = sk.GetBoneGlobalPose(bone); var u = from - pose.Origin; var v = to - pose.Origin;
        if (u.LengthSquared() < 0.000001f || v.LengthSquared() < 0.000001f) return;
        int parent = sk.GetBoneParent(bone);
        Quaternion parentQ = parent >= 0 ? sk.GetBoneGlobalPose(parent).Basis.GetRotationQuaternion() : Quaternion.Identity;
        sk.SetBonePoseRotation(bone, parentQ.Inverse() * new Quaternion(u.Normalized(), v.Normalized()) * pose.Basis.GetRotationQuaternion());
    }
    public static Node3D Coffin()
    {
        var root = new Node3D { Name = "coffin" }; Box(root, 0.58f, 0.34f, 1.9f, 0x3a2616, 0, 0.17f, 0); Box(root, 0.6f, 0.045f, 1.92f, 0x0e0d10, 0, 0.36f, 0); return root;
    }
}
