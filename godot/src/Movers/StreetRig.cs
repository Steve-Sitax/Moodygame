using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.People;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>The browser's traffic.ts PushCart and handsOf: an axle on the ground, rolling wheels, grips following the hands.</summary>
public sealed class PushCart
{
    public readonly Node3D Root, Pivot;
    private readonly Node3D wheels;
    private float dir, ax, az, spin, tilt, held;
    private bool placed;
    public Vector2 Axle => new(ax, az);
    public float Yaw => dir;
    public readonly AnimatableBody3D Body;
    private const float Radius = 0.57f, GripZ = 2.15f, GripY = 0.75f;

    public PushCart(Node3D root)
    {
        Root = root;
        Pivot = root.GetChildren().OfType<Node3D>().First(n => n is not MeshInstance3D);
        wheels = root.GetChildren().OfType<MeshInstance3D>().First();
        Pivot.Transform = new Transform3D(Basis.Identity, new Vector3(0, Radius, 0));
        foreach (var c in Pivot.GetChildren().OfType<MeshInstance3D>()) c.Transform = new Transform3D(Basis.Identity, new Vector3(0, -Radius, 0));
        Body = Mv.BoxBody(root, new Aabb(new Vector3(-0.72f, 0, -0.9f), new Vector3(1.44f, 1.3f, 1.9f)));
        Mv.BoxBody(root, new Aabb(new Vector3(-0.42f, 0.25f, 0.98f), new Vector3(0.84f, 0.75f, 1.2f)), "shafts");
    }

    public void Place(float x, float z, float yaw)
    {
        dir = yaw;
        ax = x + MathF.Sin(yaw) * GripZ;
        az = z + MathF.Cos(yaw) * GripZ;
        placed = true;
        Pose();
    }

    public void Push(float dt, Vector3 hands, float yaw, float hold)
    {
        if (!placed) Place(hands.X, hands.Z, yaw);
        held += (hold - held) * Math.Min(1, dt * 3);
        float dy = GripY - Radius, rho = MathF.Sqrt(dy * dy + GripZ * GripZ);
        if (hold > 0.5f)
        {
            dir += MathF.Atan2(MathF.Sin(yaw - dir), MathF.Cos(yaw - dir)) * Math.Min(1, dt * 2.2f);
            float ox = ax, oz = az;
            float reach = rho * MathF.Cos(MathF.Atan2(dy, GripZ) - tilt);
            float k = held > 0.9f ? 1 : Math.Min(1, dt * 4);
            ax += (hands.X + MathF.Sin(dir) * reach - ax) * k;
            az += (hands.Z + MathF.Cos(dir) * reach - az) * k;
            spin += ((ax - ox) * MathF.Sin(dir) + (az - oz) * MathF.Cos(dir)) / Radius;
        }
        float want = (MathF.Atan2(dy, GripZ) - MathF.Asin(Math.Clamp((hands.Y - Radius) / rho, -0.2f, 0.5f))) * held;
        tilt += (want - tilt) * Math.Min(1, dt * 6);
        Pose();
    }

    private void Pose()
    {
        Root.Transform = new Transform3D(new Basis(Vector3.Up, dir + MathF.PI), new Vector3(ax, 0, az));
        Pivot.Rotation = new Vector3(tilt, 0, 0);
        wheels.Transform = new Transform3D(new Basis(Vector3.Right, -spin), new Vector3(0, Radius, 0));
    }
}

public static class Carters
{
    private static readonly Dictionary<Mesh, Mesh> stripped = new();

    /// <summary>Fold away the handcart bound to the hips in people.glb (traffic.ts hideBakedCart). Keep the file's shared mesh.</summary>
    public static void HideBakedCart(Human human)
    {
        var sk = BakedWorld.All(human.Root).OfType<Skeleton3D>().FirstOrDefault();
        int hips = sk?.FindBone("hips") ?? -1;
        if (hips < 0) return;
        foreach (var mi in BakedWorld.All(human.Root).OfType<MeshInstance3D>())
        {
            if (mi.Mesh == null || mi.Skin == null) continue;
            if (stripped.TryGetValue(mi.Mesh, out var old)) { mi.Mesh = old; continue; }
            var src = mi.Mesh;
            var mesh = new ArrayMesh();
            for (int s = 0; s < src.GetSurfaceCount(); s++)
            {
                var a = src.SurfaceGetArrays(s);
                var p = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var b = a[(int)Mesh.ArrayType.Bones].AsInt32Array();
                var w = a[(int)Mesh.ArrayType.Weights].AsFloat32Array();
                int stride = p.Length > 0 ? b.Length / p.Length : 0;
                for (int i = 0; stride > 0 && i < p.Length; i++)
                    if (b[i * stride] == hips && w[i * stride] > 0.99f && p[i].Z > 0.3f) p[i] = new Vector3(0, 1, 0);
                a[(int)Mesh.ArrayType.Vertex] = p;
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, a);
                mesh.SurfaceSetMaterial(s, src.SurfaceGetMaterial(s));
            }
            stripped[src] = mesh;
            mi.Mesh = mesh;
        }
    }

    public static Human? Make(Node3D frame, string kind, bool cart = false)
    {
        foreach (var child in frame.GetChildren()) child.QueueFree();
        var man = Humans.Make(kind);
        if (man == null) return null;
        if (cart) HideBakedCart(man);
        frame.AddChild(man.Root);
        man.Start();
        grips.GetValue(man, ReadGrip);
        return man;
    }

    private sealed record Grip(Skeleton3D? Skeleton, int Left, int Right);
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<Human, Grip> grips = new();
    private static Grip ReadGrip(Human man)
    {
        var sk = man.Root.GetNodeOrNull<Skeleton3D>("Skeleton3D");
        return new Grip(sk, sk?.FindBone("handL") ?? -1, sk?.FindBone("handR") ?? -1);
    }

    /// <summary>Hands sway; only their forward reach and height move the cart (traffic.ts handsOf).</summary>
    public static Vector3 Hands(Human? man, Node3D frame, Vector2 at, float yaw)
    {
        float reach = 0.5f, height = 0.9f;
        if (man != null && frame.Visible)
        {
            var grip = grips.GetValue(man, ReadGrip);
            var sk = grip.Skeleton;
            int l = grip.Left, r = grip.Right;
            if (l >= 0 && r >= 0)
            {
                var p = sk!.GlobalTransform * ((sk.GetBoneGlobalPose(l).Origin + sk.GetBoneGlobalPose(r).Origin) / 2);
                reach = Math.Clamp((p.X - at.X) * MathF.Sin(yaw) + (p.Z - at.Y) * MathF.Cos(yaw), 0.25f, 0.75f);
                height = Math.Clamp(p.Y, 0.7f, 1.1f);
            }
        }
        return new Vector3(at.X + MathF.Sin(yaw) * reach, height, at.Y + MathF.Cos(yaw) * reach);
    }
}

/// <summary>A horse in the dray's own coat; the same horseGait.ts pose as the train and the omnibus pool.</summary>
public sealed class DrayHorse
{
    private readonly Node3D body;
    private readonly Node3D[] legs;
    private readonly HorseGait.Pose pose = new();
    public float Bob => pose.Bob;
    public DrayHorse(Node3D body, Node3D[] legs) { this.body = body; this.legs = legs; }
    public void Set(Vector2 p, float yaw, float gait, float amp)
    {
        HorseGait.PoseAt(pose, gait, amp, 0, 1.35f);
        Put(body, p, pose.Bob, yaw);
        float cy = MathF.Cos(yaw), sy = MathF.Sin(yaw);
        for (int k = 0; k < 4; k++)
        {
            var l = pose.Legs[k];
            Put(legs[k * 2], new Vector2(p.X + l.X * cy + l.Uz * sy, p.Y - l.X * sy + l.Uz * cy), l.Uy, yaw, l.Up);
            Put(legs[k * 2 + 1], new Vector2(p.X + l.X * cy + l.Lz * sy, p.Y - l.X * sy + l.Lz * cy), l.Ly, yaw, l.Lp);
        }
    }
    public static void Put(Node3D n, Vector2 p, float y, float yaw, float pitch = 0) => n.Transform = new Transform3D(new Basis(Vector3.Up, yaw) * new Basis(Vector3.Right, pitch), new Vector3(p.X, y, p.Y));
}
