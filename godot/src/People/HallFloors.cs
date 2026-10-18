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
        // (a room the bake brings in full, ROOM_<id>, draws its own floors: here only what carries feet. Drawn, its plain
        // boxes stuck out through the doors as flat beige slabs: the Vleeshuis's, issue #65, the look survey's point 22)
        var baked = new HashSet<string>();
        foreach (var n in BakedWorld.All(Main.I.View)) if (n.Name.ToString() is { } nm && nm.StartsWith("ROOM_")) baked.Add(nm[5..]);
        foreach (string list in new[] { "rooms", "homes" })
            foreach (var plan in data.RootElement.GetProperty(list).EnumerateArray())
            {
                var origin = plan.GetProperty("origin");
                var root = new Node3D { Name = "room_floors_" + plan.GetProperty("id").GetString(), Position = new Vector3(origin.GetProperty("x").GetSingle(), plan.GetProperty("floorY").GetSingle(), origin.GetProperty("z").GetSingle()), Rotation = new Vector3(0, plan.GetProperty("yaw").GetSingle(), 0) };
                Main.I.View.AddChild(root); roots.Add(root);
                var boxes = new List<(Vector3 size, Vector3 position)>();
                // (the look survey's point 22 and issue #65: the plans' outdoor parts, the steps up to a door and the
                // surfaces before it, stood as flat untextured beige slabs in the street, by the Vleeshuis, the
                // Oostershuis and the town hall; the shells draw their own stone steps there, so these only carry feet)
                var unseen = new List<(Vector3 size, Vector3 position)>();
                bool own = baked.Contains(plan.GetProperty("id").GetString() ?? "");
                void Floor(JsonElement rect, float y, float thick = 0.12f, bool drawn = true)
                {
                    float x0 = rect.GetProperty("minX").GetSingle(), x1 = rect.GetProperty("maxX").GetSingle(), z0 = rect.GetProperty("minZ").GetSingle(), z1 = rect.GetProperty("maxZ").GetSingle();
                    (drawn && !own ? boxes : unseen).Add((new Vector3(x1 - x0, thick, z1 - z0), new Vector3((x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2)));
                }
                foreach (var level in plan.GetProperty("levels").EnumerateArray()) foreach (var r in level.GetProperty("floors").EnumerateArray()) Floor(r, level.GetProperty("y").GetSingle());
                if (plan.TryGetProperty("surface", out var surface)) foreach (var f in surface.EnumerateArray()) Floor(f.GetProperty("rect"), f.GetProperty("y").GetSingle(), drawn: false);
                if (plan.TryGetProperty("steps", out var steps)) foreach (var f in steps.EnumerateArray()) Floor(f.GetProperty("rect"), f.GetProperty("y").GetSingle(), drawn: false);
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
                        (own ? unseen : boxes).Add((size, new Vector3(alongX ? (a + b) / 2 : (x0 + x1) / 2, y - size.Y / 2, alongX ? (z0 + z1) / 2 : (a + b) / 2)));
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
                foreach (var box in unseen) body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = box.size }, Position = box.position });
                if (own && plan.GetProperty("id").GetString() == "vleeshuis") VleeshuisStair(root, body);
                if (own && plan.GetProperty("id").GetString() == "cathedral") CathedralLoftStair(root, body);
            }
    }
    /// <summary>
    /// #186: the Vleeshuis's flight up to its theatre floor was treads of collision only (the bake draws the hall but no
    /// stair), so its 209 seats were reached by no way anyone could see. The fittings' oak stair (build_fittings.py
    /// vleeshuis_stair) stands over those treads in the hall's own frame; its balustrade on the open side and the posts
    /// under it are solid, so nobody steps off the flight's open side or walks through a post.
    /// </summary>
    private static void VleeshuisStair(Node3D root, StaticBody3D body)
    {
        if (Scheldemist.Models.ModelLibrary.Get("fittings", new Scheldemist.Models.ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true))?.Copy("vleeshuis_stair") is not { } stair) return;
        stair.Name = "vleeshuis_stair"; root.AddChild(stair);
        const float foot = 26.05f, head = 11f, rise = 9.84f, z = 12.33f;
        float slope = rise / (foot - head), length = MathF.Sqrt((foot - head) * (foot - head) + rise * rise);
        // the balustrade: a slab along the rail line from the nosings up to the handrail (0.06 m over the string's top)
        var rail = new BoxShape3D { Size = new Vector3(length, 0.95f, 0.06f) };
        float mx = (foot + head) / 2, my = 0.06f + slope * (foot - mx) + 0.40f;
        body.AddChild(new CollisionShape3D { Name = "stair_balustrade", Shape = rail, Transform = new Transform3D(new Basis(Vector3.Back, -MathF.Atan(slope)), new Vector3(mx, my, z)) });
        for (int k = 1; k < 5; k++)
        {
            float x = 26f - 15f * k / 5, top = 0.06f + slope * (foot - x) - 0.36f;
            body.AddChild(new CollisionShape3D { Name = "stair_post", Shape = new BoxShape3D { Size = new Vector3(0.18f, top, 0.18f) }, Position = new Vector3(x, top / 2, z) });
        }
    }
    /// <summary>
    /// #192: the cathedral's organ loft (7.3 m over the nave, the organ and the organist's chair on it) had no way up. The
    /// fittings' oak stair in the south aisle (build_fittings.py cathedral_loft_stair, the plan's stair: its treads are made
    /// above) and its gallery from the stair's head into the loft, in the hall's own frame; the gallery's boards carry feet,
    /// its railings, the stair's balustrades and the posts under them are solid.
    /// </summary>
    private static void CathedralLoftStair(Node3D root, StaticBody3D body)
    {
        if (Scheldemist.Models.ModelLibrary.Get("fittings", new Scheldemist.Models.ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true))?.Copy("cathedral_loft_stair") is not { } stair) return;
        stair.Name = "cathedral_loft_stair"; root.AddChild(stair);
        const float x0 = 9.45f, x1 = 10.55f, foot = 21f, head = 9.6f, rise = 7.3f, land = 7.9f, gallery = 5.7f;
        void Box(string name, Vector3 min, Vector3 max) => body.AddChild(new CollisionShape3D { Name = name, Shape = new BoxShape3D { Size = max - min }, Position = (min + max) / 2 });
        // the gallery's boards (over the loft's own floor for its last 0.3 m)
        Box("loft_gallery", new Vector3(gallery, rise - 0.22f, land), new Vector3(x1, rise, head));
        // its railings: the south edge, the landing's east end, the north edge from the loft to the stair's opening
        Box("loft_gallery_rail_s", new Vector3(gallery + 0.33f, rise, land), new Vector3(x1, rise + 0.95f, land + 0.06f));
        Box("loft_gallery_rail_e", new Vector3(x1 - 0.06f, rise, land), new Vector3(x1, rise + 0.95f, head));
        Box("loft_gallery_rail_n", new Vector3(gallery + 0.33f, rise, head - 0.06f), new Vector3(x0, rise + 0.95f, head));
        // the flight's balustrades: a slab along each side from the nosings up to the handrail
        float slope = rise / (foot - head), length = MathF.Sqrt((foot - head) * (foot - head) + rise * rise), mz = (foot + head) / 2, my = 0.06f + slope * (foot + 0.05f - mz) + 0.42f;
        foreach (float x in new[] { x0 + 0.03f, x1 - 0.03f })
            body.AddChild(new CollisionShape3D { Name = "loft_stair_balustrade", Shape = new BoxShape3D { Size = new Vector3(0.06f, 0.95f, length) }, Transform = new Transform3D(new Basis(Vector3.Right, MathF.Atan(slope)), new Vector3(x, my, mz)) });
        // the posts under both strings and under the gallery
        for (int k = 1; k < 5; k++)
        {
            float z = foot - (foot - head) * k / 5, top = 0.06f + slope * (foot + 0.05f - z) - 0.36f;
            foreach (float x in new[] { x0 + 0.03f, x1 - 0.03f }) Box("loft_stair_post", new Vector3(x - 0.09f, 0, z - 0.09f), new Vector3(x + 0.09f, top, z + 0.09f));
        }
        foreach (var (x, z) in new[] { (7.4f, land + 0.1f), (7.4f, head - 0.1f), (x1 - 0.1f, land + 0.1f) })
            Box("loft_gallery_post", new Vector3(x - 0.1f, 0, z - 0.1f), new Vector3(x + 0.1f, rise - 0.25f, z + 0.1f));
    }
    public override void _ExitTree() { foreach (var root in roots) root.QueueFree(); }
}
