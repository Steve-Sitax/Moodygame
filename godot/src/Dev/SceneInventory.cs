using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Scene counts collected between samples, never inside the frame timer.</summary>
public static class SceneInventory
{
    public static object Capture()
    {
        int nodes = 0, meshes = 0, visibleMeshes = 0, multiMeshes = 0, bodies = 0, shapes = 0;
        int areas = 0, rigidBodies = 0, activeLights = 0, lights = 0, viewports = 0, cameras = 0;
        int process = 0, physicsProcess = 0, rays = 0, enabledRays = 0, casts = 0;
        var groups = new Dictionary<string, int>();
        foreach (var n in BakedWorld.All(Main.I))
        {
            nodes++;
            if (n.IsProcessing()) process++;
            if (n.IsPhysicsProcessing()) physicsProcess++;
            if (n is MeshInstance3D m) { meshes++; if (m.IsVisibleInTree()) visibleMeshes++; }
            if (n is MultiMeshInstance3D) multiMeshes++;
            if (n is PhysicsBody3D b) { bodies++; shapes += PhysicsServer3D.BodyGetShapeCount(b.GetRid()); }
            if (n is Area3D a) { areas++; shapes += PhysicsServer3D.AreaGetShapeCount(a.GetRid()); }
            if (n is RigidBody3D) rigidBodies++;
            if (n is Light3D l) { lights++; if (l.IsVisibleInTree() && l.LightEnergy > 0) activeLights++; }
            if (n is Viewport) viewports++;
            if (n is Camera3D) cameras++;
            if (n is RayCast3D r) { rays++; if (r.Enabled) enabledRays++; }
            if (n is ShapeCast3D) casts++;
            if (n is MeshInstance3D or PhysicsBody3D or CollisionShape3D)
            {
                Node parent = n;
                while (parent.GetParent() is { } p && p != Main.I && p != Main.I.View && p != Main.I.World) parent = p;
                string key = parent.Name.ToString();
                groups[key] = groups.GetValueOrDefault(key) + 1;
            }
        }
        int rawStaticBodies = Solid.I.Built;
        return new { nodes, meshes, visibleMeshes, multiMeshes, bodies = bodies + rawStaticBodies,
            shapes = shapes + rawStaticBodies, sceneBodies = bodies, rawStaticBodies, areas, rigidBodies,
            activeLights, lights, viewports, cameras, process, physicsProcess, rays, enabledRays, casts,
            activePhysicsObjects = Performance.GetMonitor(Performance.Monitor.Physics3DActiveObjects), groups };
    }
}
