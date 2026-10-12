using System;
using System.Collections.Generic;
using System.Diagnostics;
using Godot;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Derive the crowd's cheap navigation lookup from the current native scene.
/// Only semantic floor meshes supply support: a roof, crate or bollard top is never generic ground.
/// Static clearance uses Solid's actual mesh triangles, without millions of physics queries.</summary>
public static class NativeWorldNavigation
{
    private enum Support { None, Ground, Connected }
    private static readonly HashSet<string> GroundNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "ground_earth", "ground_flags", "ground_cobble", "ground_grass", "ground_quay",
        "park_ground_lawn", "park_ground_gravel", "park_ground_mud", "park_ground_bed",
    };
    private static readonly HashSet<string> ConnectedNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "quay_steps", "pier_deck", "landing_stage", "landing_stage_piles", "pontoon_gangway",
    };

    public static WalkMap Build(Node3D nativeTown, Rect2 bounds)
    {
        var timer = Stopwatch.StartNew();
        int x0 = (int)Math.Floor(bounds.Position.X), z0 = (int)Math.Floor(bounds.Position.Y);
        int width = (int)Math.Ceiling(bounds.End.X - x0), depth = (int)Math.Ceiling(bounds.End.Y - z0);
        int gridWidth = width * 4, gridDepth = depth * 4, cells = checked(gridWidth * gridDepth);
        var heights = new short[cells];
        Array.Fill(heights, short.MinValue);
        var seeds = new byte[cells];
        int supportMeshes = 0, supportTriangles = 0;
        foreach (var node in BakedWorld.All(nativeTown))
        {
            if (node is not MeshInstance3D { Mesh: not null, Skin: null } mesh || !Visible(node, nativeTown, true)) continue;
            var kind = Kind(mesh, nativeTown);
            if (kind == Support.None) continue;
            supportMeshes++;
            string name = SemanticName(mesh);
            // Three-centimetre gaps between deck boards cannot swallow a person's foot. Sample within 2.5 cm
            // of these triangles, then still apply the normal 25 cm shore margin and solid-object clearance.
            float seam = name == "pier_deck" ? .025f : 0;
            bool wall = name.StartsWith("wall_chunk_", StringComparison.OrdinalIgnoreCase);
            float minY = mesh.HasMeta("native_nav_min_y") ? mesh.GetMeta("native_nav_min_y").AsSingle() : -8;
            float maxY = mesh.HasMeta("native_nav_max_y") ? mesh.GetMeta("native_nav_max_y").AsSingle() : wall ? 6.65f : kind == Support.Ground ? 0.65f : 0.8f;
            var faces = mesh.Mesh.GetFaces();
            var transform = mesh.GlobalTransform;
            for (int i = 0; i + 2 < faces.Length; i += 3)
            {
                Vector3 a = transform * faces[i], b = transform * faces[i + 1], c = transform * faces[i + 2];
                Vector3 normal = (b - a).Cross(c - a);
                if (normal.LengthSquared() < 0.000001f || Math.Abs(normal.Y) / normal.Length() < 0.65f) continue;
                // Imported triangulation can have a reversed winding, but a semantic ground mesh still supplies
                // its physical top. Its source role and height limits, rather than arbitrary facing, admit it.
                if (Math.Min(a.Y, Math.Min(b.Y, c.Y)) < minY || Math.Max(a.Y, Math.Max(b.Y, c.Y)) > maxY) continue;
                supportTriangles++;
                Raster(a, b, c, x0, z0, gridWidth, gridDepth, heights, seeds, kind == Support.Ground, seam);
            }
        }

        var free = new byte[cells];
        var halfHeights = new short[width * depth * 4];
        for (int z = 0; z < gridDepth; z++) for (int x = 0; x < gridWidth; x++)
        {
            int index = z * gridWidth + x;
            if (heights[index] == short.MinValue) { heights[index] = 0; continue; }
            free[index] = 1;
            halfHeights[z / 2 * width * 2 + x / 2] = heights[index];
        }
        // Keep a quarter-metre body off water/unsupported floor boundaries. Use the support snapshot so this
        // is a one-cell geometric margin, rather than repeatedly eroding a shore into an empty district.
        var supports = (byte[])free.Clone();
        for (int z = 0; z < gridDepth; z++) for (int x = 0; x < gridWidth; x++)
        {
            int index = z * gridWidth + x;
            if (supports[index] == 0) continue;
            for (int dz = -1; dz <= 1 && free[index] != 0; dz++) for (int dx = -1; dx <= 1; dx++)
            {
                int nx = x + dx, nz = z + dz;
                if (nx < 0 || nz < 0 || nx >= gridWidth || nz >= gridDepth || supports[nz * gridWidth + nx] == 0) { free[index] = 0; break; }
            }
        }
        var map = WalkMap.FromNativeData(bounds, free, halfHeights, heights);
        Solid.I?.Footprints(map);
        int nativeShapes = AddAuthoredShapes(nativeTown, map);
        var reached = Connected(map, heights, seeds, gridWidth, gridDepth);
        map.RestrictNativeTo(reached);
        map.FinishNative();
        int reachable = 0, elevated = 0;
        for (int i = 0; i < cells; i++) if (reached[i] != 0) { reachable++; if (heights[i] > 65) elevated++; }
        GD.Print($"native navigation: {width}x{depth} m; {supportMeshes} support meshes/{supportTriangles} triangles, {nativeShapes} authored shapes, {reachable} free quarter cells ({elevated} elevated); {timer.ElapsedMilliseconds} ms");
        return map;
    }

    private static string SemanticName(Node node) => node.HasMeta("source_name") ? node.GetMeta("source_name").AsString() : node.Name.ToString();

    private static Support Kind(MeshInstance3D mesh, Node root)
    {
        if (mesh.HasMeta("native_nav_surface"))
            return mesh.GetMeta("native_nav_surface").AsBool() ? Support.Ground : Support.None;
        string name = SemanticName(mesh);
        if (GroundNames.Contains(name)) return Support.Ground;
        if (name.StartsWith("wall_chunk_", StringComparison.OrdinalIgnoreCase)) return Support.Connected;
        if (ConnectedNames.Contains(name)) return Support.Connected;
        for (Node? parent = mesh.GetParent(); parent != null && parent != root; parent = parent.GetParent())
        {
            string group = SemanticName(parent);
            if (group == "landing_stage") return Support.Connected;
            if (group == "opening_bridges" && !name.StartsWith("draw_beam", StringComparison.OrdinalIgnoreCase) && !name.StartsWith("draw_frame", StringComparison.OrdinalIgnoreCase)) return Support.Connected;
            if (group.StartsWith("ROOM_", StringComparison.OrdinalIgnoreCase) || group.StartsWith("house_", StringComparison.OrdinalIgnoreCase)) return Support.None;
        }
        return Support.None;
    }

    private static bool Visible(Node node, Node root, bool support = false)
    {
        for (Node? here = node; here != null; here = here == root ? null : here.GetParent())
        {
            bool hiddenSupport = support && here == node && here.HasMeta("native_nav_support_only") && here.GetMeta("native_nav_support_only").AsBool();
            if (here is Node3D { Visible: false } && !hiddenSupport || (!support && here.HasMeta("mover")) || here is Skeleton3D) return false;
            if (here.HasMeta("extras"))
            {
                var extras = here.GetMeta("extras").AsGodotDictionary();
                if (extras.TryGetValue("hidden", out var hidden) && hidden.AsBool()) return false;
                if (extras.TryGetValue("ro", out var order) && order.AsDouble() != 0) return false;
            }
        }
        return true;
    }

    private static void Raster(Vector3 a, Vector3 b, Vector3 c, int x0, int z0, int width, int depth, short[] heights, byte[] seeds, bool seed, float seam)
    {
        float denominator = (b.Z - c.Z) * (a.X - c.X) + (c.X - b.X) * (a.Z - c.Z);
        if (Math.Abs(denominator) < 0.000001f) return;
        int minX = Math.Max(0, (int)Math.Floor((Math.Min(a.X, Math.Min(b.X, c.X)) - x0 - seam) * 4));
        int maxX = Math.Min(width - 1, (int)Math.Ceiling((Math.Max(a.X, Math.Max(b.X, c.X)) - x0 + seam) * 4));
        int minZ = Math.Max(0, (int)Math.Floor((Math.Min(a.Z, Math.Min(b.Z, c.Z)) - z0 - seam) * 4));
        int maxZ = Math.Min(depth - 1, (int)Math.Ceiling((Math.Max(a.Z, Math.Max(b.Z, c.Z)) - z0 + seam) * 4));
        static float EdgeDistanceSquared(float x, float z, Vector3 start, Vector3 end) {
            float dx=end.X-start.X, dz=end.Z-start.Z, length=dx*dx+dz*dz;
            float t=length>0 ? Math.Clamp(((x-start.X)*dx+(z-start.Z)*dz)/length,0,1) : 0;
            return (x-start.X-t*dx)*(x-start.X-t*dx)+(z-start.Z-t*dz)*(z-start.Z-t*dz);
        }
        for (int z = minZ; z <= maxZ; z++) for (int x = minX; x <= maxX; x++)
        {
            float wx = x0 + (x + 0.5f) / 4, wz = z0 + (z + 0.5f) / 4;
            float u = ((b.Z - c.Z) * (wx - c.X) + (c.X - b.X) * (wz - c.Z)) / denominator;
            float v = ((c.Z - a.Z) * (wx - c.X) + (a.X - c.X) * (wz - c.Z)) / denominator;
            if (u < -0.00001f || v < -0.00001f || u + v > 1.00001f) {
                if (seam <= 0 || Math.Min(EdgeDistanceSquared(wx,wz,a,b), Math.Min(EdgeDistanceSquared(wx,wz,b,c),EdgeDistanceSquared(wx,wz,c,a))) > seam*seam) continue;
            }
            int index = z * width + x;
            short height = (short)Math.Clamp(Math.Round((u * a.Y + v * b.Y + (1 - u - v) * c.Y) * 100), short.MinValue + 1, short.MaxValue);
            if (height > heights[index]) { heights[index] = height; seeds[index] = seed ? (byte)1 : (byte)0; }
            else if (height == heights[index] && seed) seeds[index] = 1;
        }
    }

    private static byte[] Connected(WalkMap map, short[] heights, byte[] seeds, int width, int depth)
    {
        var reached = new byte[seeds.Length];
        var queue = new int[seeds.Length];
        int head = 0, tail = 0;
        for (int z = 0; z < depth; z++) for (int x = 0; x < width; x++)
        {
            int index = z * width + x;
            if (seeds[index] != 0 && map.NativeCellFree(x, z)) { reached[index] = 1; queue[tail++] = index; }
        }
        void Visit(int index, int next)
        {
            if (reached[next] != 0 || Math.Abs(heights[next] - heights[index]) > 36 || !map.NativeCellFree(next % width, next / width)) return;
            reached[next] = 1; queue[tail++] = next;
        }
        while (head < tail)
        {
            int index = queue[head++], x = index % width, z = index / width;
            if (x > 0) Visit(index, index - 1);
            if (x + 1 < width) Visit(index, index + 1);
            if (z > 0) Visit(index, index - width);
            if (z + 1 < depth) Visit(index, index + width);
        }
        return reached;
    }

    private static int AddAuthoredShapes(Node root, WalkMap map)
    {
        int count = 0;
        foreach (var node in BakedWorld.All(root))
        {
            if (node is not CollisionShape3D { Shape: not null, Disabled: false } shape || !Visible(shape, root)) continue;
            if (shape.GetParent() is not CollisionObject3D { CollisionLayer: var layer } || (layer & Solid.Layer) == 0) continue;
            Vector3[] faces;
            if (shape.Shape is ConcavePolygonShape3D concave) faces = concave.GetFaces();
            else if (shape.Shape is BoxShape3D box) faces = BoxFaces(box.Size);
            else
            {
                // Tree/prop cylinders and capsules are conservatively blocked at their actual shape bounds.
                var bounds = shape.Shape.GetDebugMesh().GetAabb();
                faces = BoxFaces(bounds.Size);
                Vector3 centre = bounds.GetCenter();
                for (int i = 0; i < faces.Length; i++) faces[i] += centre;
            }
            var transform = shape.GlobalTransform;
            for (int i = 0; i < faces.Length; i++) faces[i] = transform * faces[i];
            map.AddTriangles(faces); count++;
        }
        return count;
    }

    private static Vector3[] BoxFaces(Vector3 size)
    {
        Vector3 half = size / 2;
        var vertices = new Vector3[8];
        for (int i = 0; i < 8; i++) vertices[i] = new Vector3((i & 1) == 0 ? -half.X : half.X, (i & 2) == 0 ? -half.Y : half.Y, (i & 4) == 0 ? -half.Z : half.Z);
        int[] indices = { 0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5 };
        var faces = new Vector3[indices.Length];
        for (int i = 0; i < indices.Length; i++) faces[i] = vertices[indices[i]];
        return faces;
    }
}
