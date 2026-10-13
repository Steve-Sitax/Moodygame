using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// The bake hid every rampart chunk that lay out of its own camera's reach: the guard huts, their lantern arms, the gates and the
/// wall walks. Nothing in the native game showed them again, so their lights hung in the air. Each chunk now shows while it is within
/// fog distance of the player's camera, as the old game's WorkWall did.
/// </summary>
public partial class NativeWallChunks : Node
{
    private readonly List<(MeshInstance3D Mesh, Vector3 Center, float Radius)> chunks = new();
    private double poll;
    public int Count => chunks.Count;
    public void Collect(IEnumerable<Node> nodes)
    {
        foreach (var node in nodes)
            if (node is MeshInstance3D { Mesh: not null } mesh && mesh.Name.ToString().StartsWith("wall_chunk_", System.StringComparison.Ordinal))
            {
                var box = mesh.GetAabb(); chunks.Add((mesh, mesh.GlobalTransform * box.GetCenter(), box.Size.Length() * 0.5f));
                // Solid runs after this and skips hidden nodes: every real chunk and walkway must be there for it.
                mesh.Visible = true;
            }
    }
    public override void _Process(double delta)
    {
        if ((poll -= delta) > 0) return; poll = 0.25;
        if (GetViewport().GetCamera3D() is not { } camera) return;
        var at = camera.GlobalPosition; float far = (Daylight.I?.FogFar ?? 28) + 20;
        foreach (var chunk in chunks)
        {
            float reach = far + chunk.Radius; chunk.Mesh.Visible = chunk.Center.DistanceSquaredTo(at) < reach * reach;
        }
    }
}
