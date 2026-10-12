using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Explicit native walking support for Steen's curved outdoor ramp and courtyard.
/// The 2026-10-12 steen_blue mesh already draws and collides with these surfaces; this hidden native
/// mesh identifies only their walkable part, avoiding admission of the castle's other upward faces.</summary>
public static class NativeSteenRamp
{
    public static Node3D Create(string cityJson, bool addCollision = false)
    {
        using var document = JsonDocument.Parse(cityJson);
        return Create(document.RootElement, addCollision);
    }

    public static Node3D Create(JsonNode cityJson, bool addCollision = false) => Create(cityJson.ToJsonString(), addCollision);

    public static Node3D Create(JsonElement cityJson, bool addCollision = false)
    {
        var ramp = cityJson.GetProperty("decor").GetProperty("steen_ramp");
        float height = ramp.GetProperty("h").GetSingle(), radius = ramp.GetProperty("half").GetSingle() + 0.35f;
        var line = new List<Vector3>();
        foreach (var point in ramp.GetProperty("line").EnumerateArray()) line.Add(new Vector3(point[0].GetSingle(), point[2].GetSingle(), point[1].GetSingle()));
        if (line.Count < 2 || radius <= 0) throw new InvalidOperationException("Steen ramp needs a positive width and at least two centreline points");
        var terrace = ramp.GetProperty("terrace");
        if (terrace.GetArrayLength() != 4) throw new InvalidOperationException("Steen courtyard needs four rectangle coordinates");
        var faces = new List<Vector3>();
        void Triangle(Vector3 a, Vector3 b, Vector3 c) { faces.Add(a); faces.Add(b); faces.Add(c); }
        void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d) { Triangle(a, c, b); Triangle(a, d, c); }
        var offsets = new Vector3[line.Count];
        for (int i = 0; i < line.Count; i++)
        {
            Vector3 before = i == 0 ? line[1] - line[0] : line[i] - line[i - 1];
            Vector3 after = i + 1 == line.Count ? before : line[i + 1] - line[i];
            before.Y = after.Y = 0; before = before.Normalized(); after = after.Normalized();
            Vector3 leftBefore = new(-before.Z, 0, before.X), leftAfter = new(-after.Z, 0, after.X);
            Vector3 miter = (leftBefore + leftAfter).Normalized();
            float divisor = miter.Dot(leftAfter);
            if (divisor < 0.5f) throw new InvalidOperationException("Steen centreline turn is too sharp for its declared width");
            offsets[i] = miter * radius / divisor;
        }
        for (int i = 0; i + 1 < line.Count; i++)
            Quad(line[i] - offsets[i], line[i] + offsets[i], line[i + 1] + offsets[i + 1], line[i + 1] - offsets[i + 1]);
        // The original height rule is nearest-point distance to the centreline, including rounded ends.
        void Cap(int end, Vector3 direction)
        {
            float angle = MathF.Atan2(direction.Z, direction.X);
            const int slices = 24;
            for (int i = 0; i < slices; i++)
            {
                float a = angle - MathF.PI / 2 + MathF.PI * i / slices;
                float b = angle - MathF.PI / 2 + MathF.PI * (i + 1) / slices;
                Triangle(line[end], line[end] + new Vector3(MathF.Cos(b) * radius, 0, MathF.Sin(b) * radius), line[end] + new Vector3(MathF.Cos(a) * radius, 0, MathF.Sin(a) * radius));
            }
        }
        Cap(0, line[0] - line[1]); Cap(line.Count - 1, line[^1] - line[^2]);
        Quad(new Vector3(terrace[0].GetSingle(), height, terrace[1].GetSingle()), new Vector3(terrace[2].GetSingle(), height, terrace[1].GetSingle()),
             new Vector3(terrace[2].GetSingle(), height, terrace[3].GetSingle()), new Vector3(terrace[0].GetSingle(), height, terrace[3].GetSingle()));
        var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = faces.ToArray();
        var mesh = new ArrayMesh { ResourceName = "Steen native walking support" };
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, flags: 0);
        var root = new Node3D { Name = "native_steen_ramp" };
        root.SetMeta("native_anchor_id", "steen:outdoor-ramp");
        root.SetMeta("native_source_role", "outdoor walking support; existing steen_blue draws the floor");
        root.SetMeta("native_ramp_facts", ramp.GetRawText());
        var floor = new MeshInstance3D { Name = "steen_ramp_walk_surface", Mesh = mesh, Visible = false };
        floor.SetMeta("native_nav_surface", true);
        floor.SetMeta("native_nav_support_only", true);
        floor.SetMeta("native_nav_min_y", -0.05f); floor.SetMeta("native_nav_max_y", height + 0.1f);
        root.AddChild(floor);
        if (addCollision)
        {
            var body = new StaticBody3D { Name = "FloorCollision", CollisionLayer = Solid.Layer, CollisionMask = 0 };
            var shape = new ConcavePolygonShape3D(); shape.SetFaces(faces.ToArray());
            body.AddChild(new CollisionShape3D { Shape = shape }); root.AddChild(body);
        }
        return root;
    }
}
