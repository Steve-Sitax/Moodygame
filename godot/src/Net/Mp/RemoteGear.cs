using System;
using Godot;
using Scheldemist.Models;
using Scheldemist.World;

namespace Scheldemist.Net.Mp;

/// <summary>The boats, velocipedes and handcarts others bring with them (net/mp/gear.ts).</summary>
public sealed class RemoteGear : IGearModel
{
    private static readonly string[] Boats = { "rowboat", "punt", "workboat", "dinghy", "shipsboat", "gig", "bumboat", "eelboat", "oldboat" };
    public Node3D Root { get; }
    private readonly int kind;
    private Node3D? front, rear, wheels;
    private float lastX = float.NaN, lastZ, distance;

    private RemoteGear(Node3D root, int kind)
    {
        Root = root;
        this.kind = kind;
        root.Visible = false;
        Main.I.View.AddChild(root);
        foreach (var n in BakedWorld.All(root))
        {
            if (n is not Node3D node) continue;
            if (node.Name == "velocipede_front") front = node;
            if (node.Name == "velocipede_rear") rear = node;
            if (node.Name == "CartWheels") wheels = node;
            if (node.Name.ToString().EndsWith("_stow")) node.Visible = false;
        }
    }

    public static IGearModel? Make(int kind, int sub)
    {
        Node3D? root = null;
        if (kind == MpProtocol.GearRowboat)
            root = ModelLibrary.Get("boats")?.Copy(Boats[sub >= 0 && sub < Boats.Length ? sub : 0]);
        else if (kind == MpProtocol.GearVelo)
            root = ModelLibrary.Get("velocipede")?.Copy("velocipede");
        else if (kind == MpProtocol.GearHandcart && ModelLibrary.Get("props") is { } props)
        {
            var body = props.Copy("tr_handcart");
            var wheel = props.Copy("tr_handcart_wheels");
            if (body != null && wheel != null)
            {
                root = new Node3D();
                root.AddChild(body);
                // The wheel vertices are centred on their axle, as in world/traffic.ts PushCart.
                wheel.Name = "CartWheels";
                wheel.Position = new Vector3(0, 0.57f, 0);
                root.AddChild(wheel);
            }
            else { body?.Free(); wheel?.Free(); }
        }
        return root == null ? null : new RemoteGear(root, kind);
    }

    public void Place(float x, float y, float z, float heading, float dt, bool shown)
    {
        Root.Visible = shown;
        if (!shown) { lastX = float.NaN; return; }
        if (!float.IsNaN(lastX)) distance += new Vector2(x - lastX, z - lastZ).Length();
        lastX = x; lastZ = z;
        if (kind == MpProtocol.GearRowboat) y = Tide.LevelAt(x, z);
        else if (kind == MpProtocol.GearHandcart)
        {
            x += MathF.Sin(heading) * 0.95f;
            z += MathF.Cos(heading) * 0.95f;
            if (Player.Jef.I is { } j) y = j.GroundAt(x, z, y, 0.2f);
        }
        Root.Position = new Vector3(x, y, z);
        Root.Rotation = new Vector3(0, heading, 0);
        if (front != null) front.Rotation = new Vector3(distance / 0.46f, 0, 0);
        if (rear != null) rear.Rotation = new Vector3(distance / 0.36f, 0, 0);
        if (wheels != null) wheels.Rotation = new Vector3(distance / 0.57f, 0, 0);
    }

    public void Dispose() => Root.QueueFree();
}
