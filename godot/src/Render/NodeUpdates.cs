using System.Collections.Generic;
using Godot;

namespace Scheldemist.Render;

/// <summary>Keep unchanged poses out of the scene's transform propagation queue. Compare exact values.</summary>
public static class NodeUpdates
{
    private sealed class Pose
    {
        public Node3D Node = null!;
        public Vector3 Position, Rotation;
        public Transform3D Transform;
        public bool HasPosition, HasRotation, HasTransform;
    }
    private static readonly Dictionary<ulong, Pose> poses = new();
    private static Pose Of(Node3D node)
    {
        ulong id = node.GetInstanceId();
        if (!poses.TryGetValue(id, out var pose))
        {
            // Scene changes are infrequent; discard freed wrappers here, never in the steady frame loop.
            var stale = new List<ulong>();
            foreach (var row in poses) if (!GodotObject.IsInstanceValid(row.Value.Node)) stale.Add(row.Key);
            foreach (ulong key in stale) poses.Remove(key);
            poses[id] = pose = new() { Node = node };
        }
        return pose;
    }
    public static void Position(Node3D node, Vector3 value)
    {
        var p = Of(node); p.Position = value; p.HasPosition = true;
        if (!UniformUpdates.Cached || node.Position != value) node.Position = value;
    }
    public static void Rotation(Node3D node, Vector3 value)
    {
        var p = Of(node); p.Rotation = value; p.HasRotation = true;
        if (!UniformUpdates.Cached || node.Rotation != value) node.Rotation = value;
    }
    public static void Transform(Node3D node, Transform3D value)
    {
        var p = Of(node); p.Transform = value; p.HasTransform = true;
        if (!UniformUpdates.Cached || node.Transform != value) node.Transform = value;
    }
    // Pixel proof replays both paths while all clocks, animation and the screen grain stand still.
    public static void Replay()
    {
        foreach (var p in poses.Values)
        {
            if (!GodotObject.IsInstanceValid(p.Node)) continue;
            if (p.HasTransform) Transform(p.Node, p.Transform);
            if (p.HasPosition) Position(p.Node, p.Position);
            if (p.HasRotation) Rotation(p.Node, p.Rotation);
        }
    }
}
