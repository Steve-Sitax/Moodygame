using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>The floors and stair treads supporting the shared room marks.
/// The browser builds these dynamically, so they are absent from the shared static town bake.
/// Disable this fallback with --no-hallfloors when the full rooms part supplies their geometry.</summary>
[GamePart(185)]
public partial class HallFloors : Node
{
    private readonly List<Node3D> roots = new();
    public override void _Ready()
    {
        using var data = JsonDocument.Parse(HallPeopleData.Json);
        var kind = new Psx.Kind(false, false, false, false, true, true, 0, false, false, true);
        var material = BakedWorld.PsxMaterial(new StandardMaterial3D { AlbedoColor = new Color("736450"), Roughness = 1 }, kind, 0, 1, 0);
        foreach (string list in new[] { "rooms", "homes" })
            foreach (var plan in data.RootElement.GetProperty(list).EnumerateArray())
            {
                var origin = plan.GetProperty("origin");
                var root = new Node3D { Name = "room_floors_" + plan.GetProperty("id").GetString(), Position = new Vector3(origin.GetProperty("x").GetSingle(), plan.GetProperty("floorY").GetSingle(), origin.GetProperty("z").GetSingle()), Rotation = new Vector3(0, plan.GetProperty("yaw").GetSingle(), 0) };
                Main.I.View.AddChild(root); roots.Add(root);
                var boxes = new List<(Vector3 size, Vector3 position)>();
                void Floor(JsonElement rect, float y, float thick = 0.12f)
                {
                    float x0 = rect.GetProperty("minX").GetSingle(), x1 = rect.GetProperty("maxX").GetSingle(), z0 = rect.GetProperty("minZ").GetSingle(), z1 = rect.GetProperty("maxZ").GetSingle();
                    boxes.Add((new Vector3(x1 - x0, thick, z1 - z0), new Vector3((x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2)));
                }
                foreach (var level in plan.GetProperty("levels").EnumerateArray()) foreach (var r in level.GetProperty("floors").EnumerateArray()) Floor(r, level.GetProperty("y").GetSingle());
                if (plan.TryGetProperty("surface", out var surface)) foreach (var f in surface.EnumerateArray()) Floor(f.GetProperty("rect"), f.GetProperty("y").GetSingle());
                if (plan.TryGetProperty("steps", out var steps)) foreach (var f in steps.EnumerateArray()) Floor(f.GetProperty("rect"), f.GetProperty("y").GetSingle());
                if (plan.TryGetProperty("stairs", out var stairs)) foreach (var s in stairs.EnumerateArray())
                {
                    var r = s.GetProperty("rect"); float x0 = r.GetProperty("minX").GetSingle(), x1 = r.GetProperty("maxX").GetSingle(), z0 = r.GetProperty("minZ").GetSingle(), z1 = r.GetProperty("maxZ").GetSingle();
                    float foot = s.GetProperty("foot").GetSingle(), head = s.GetProperty("head").GetSingle(), y0 = s.GetProperty("y0").GetSingle(), y1 = s.GetProperty("y1").GetSingle();
                    int count = Math.Max(1, (int)MathF.Round((y1 - y0) / s.GetProperty("rise").GetSingle()));
                    bool alongX = s.GetProperty("along").GetString() == "x";
                    for (int i = 0; i < count; i++)
                    {
                        float a = foot + (head - foot) * i / count, b = foot + (head - foot) * (i + 1) / count, y = y0 + (y1 - y0) * (i + 1) / count;
                        var size = new Vector3(alongX ? Math.Abs(b - a) : x1 - x0, (y1 - y0) / count, alongX ? z1 - z0 : Math.Abs(b - a));
                        boxes.Add((size, new Vector3(alongX ? (a + b) / 2 : (x0 + x1) / 2, y - size.Y / 2, alongX ? (z0 + z1) / 2 : (a + b) / 2)));
                    }
                }
                var batch = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = new BoxMesh { Size = Vector3.One, Material = material }, InstanceCount = boxes.Count };
                var body = new StaticBody3D { CollisionLayer = Solid.Layer, CollisionMask = 0 };
                root.AddChild(new MultiMeshInstance3D { Multimesh = batch }); root.AddChild(body);
                for (int i = 0; i < boxes.Count; i++)
                {
                    var box = boxes[i]; batch.SetInstanceTransform(i, new Transform3D(Basis.Identity.Scaled(box.size), box.position));
                    body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = box.size }, Position = box.position });
                }
            }
    }
    public override void _ExitTree() { foreach (var root in roots) root.QueueFree(); }
}
