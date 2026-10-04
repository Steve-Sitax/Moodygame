using System.Collections.Generic;
using Godot;
using Scheldemist.Game;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>rampart.ts chunks: the bake's camera culling must not remove the mill's floors from physics.</summary>
[GamePart(5)]
public partial class WorkWall : Node
{
    private readonly List<(MeshInstance3D Mesh, Vector3 Center, float Radius)> chunks = new();
    private double poll;
    public override void _Ready()
    {
        foreach (var n in BakedWorld.All(Main.I.World))
            if (n is MeshInstance3D mesh && mesh.Name.ToString().StartsWith("wall_chunk_"))
            {
                var box = mesh.GetAabb(); chunks.Add((mesh, mesh.GlobalTransform * box.GetCenter(), box.Size.Length() * 0.5f));
                // Solid runs next, before play: it sees every real wall chunk and its walkways.
                mesh.Visible = true;
            }
    }
    public override void _Process(double delta)
    {
        if ((poll -= delta) > 0) return; poll = 0.25;
        var camera = Main.I.Cam.GlobalPosition; float far = (Daylight.I?.FogFar ?? 28) + 20;
        foreach (var c in chunks) c.Mesh.Visible = c.Center.DistanceSquaredTo(camera) < (far + c.Radius) * (far + c.Radius);
    }
}
