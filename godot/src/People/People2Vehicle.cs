using System;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.People;

// The town's shared carts, fitted to the two animated grip sockets in the body's frame.
internal sealed class People2Vehicle
{
    private static readonly StringName GripError = "vehicle_grip_error";
    private readonly Node3D root;
    private readonly Skeleton3D skeleton;
    private readonly int left, right;
    private readonly PushCart? cart;
    private readonly Node3D? truck;
    private readonly Vector3 axle = new(0, .14f, -.12f);
    private readonly Vector3 handle = new(0, .12f*MathF.Sin(-.12f)+1.42f*MathF.Cos(-.12f),
        -(.12f*MathF.Cos(-.12f)-1.42f*MathF.Sin(-.12f)));

    internal People2Vehicle(string kind, Node3D root, Skeleton3D skeleton)
    {
        this.root = root; this.skeleton = skeleton;
        left = skeleton.FindBone("gripL"); right = skeleton.FindBone("gripR");
        if (kind == "carter" && PushCart.Has) cart = new PushCart(root);
        if (kind == "porter")
        {
            truck = ModelLibrary.Get("quaygoods", new ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true))?.Copy("sack_truck_bare");
            if (truck == null) throw new InvalidOperationException("Porter requires the shared sack truck.");
            truck.Name = "people2_sack_truck";
            root.AddChild(truck);
        }
    }

    internal bool Present => cart != null || truck != null;
    private bool external;
    internal void UseExternal(bool value)
    {
        external = value;
        if (cart != null) cart.Root.Visible = !value;
        if (truck != null) truck.Visible = !value;
    }
    internal void Update(float dt, bool pushing)
    {
        if (external || !Present || left < 0 || right < 0) return;
        Vector3 a = skeleton.Transform * skeleton.GetBoneGlobalPose(left).Origin;
        Vector3 b = skeleton.Transform * skeleton.GetBoneGlobalPose(right).Origin;
        Vector3 mid = (a+b)*.5f;
        if (cart != null)
            cart.Push(dt, mid.X, mid.Z, mid.Y, 0, pushing ? 1 : 0, 0);
        if (truck != null)
        {
            Vector3 delta = handle-axle;
            float radius = new Vector2(delta.Y, delta.Z).Length();
            float tilt = -MathF.Acos(Math.Clamp((mid.Y-axle.Y)/radius, -.95f, .95f))
                - MathF.Atan2(delta.Z, delta.Y);
            var basis = new Basis(Vector3.Right, pushing ? tilt : 0);
            basis = basis.Scaled(new Vector3(Math.Clamp(Math.Abs(a.X-b.X)/.48f,.75f,1.25f),1,1));
            Vector3 position = mid-basis*handle;
            if (!pushing) position.Y = 0;
            truck.Transform = new Transform3D(basis, position);
            root.SetMeta(GripError, (truck.Transform*handle-mid).Length());
        }
    }
    internal void Dispose() { cart?.Dispose(); truck?.QueueFree(); }
}
