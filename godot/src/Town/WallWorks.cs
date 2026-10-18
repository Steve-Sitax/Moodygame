using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Models;
using Scheldemist.World;

namespace Scheldemist.Town;

/// <summary>
/// The crab winch of the town's works on the old rampart (#128). The wall's bake drew a low winch merged into its props
/// (art-source/tools/blender/build_wall.py shear_legs: its axle 0.55 m up, its crank fixed): before the town's collision
/// is made (Solid, part 10) its triangles are taken out, and the works' own crab winch (workgoods.glb crab_winch: its
/// crank axle at a man's waist, 1.02 m, the drum geared 4 to 1) stands there with a body of its own. The navvy of the
/// winch cranks it (people2's winch clip): the crank turns with his hands, the drum with the crank. Where it is comes
/// from the wall's own facts (shared/city.json decor.rampart, services/native-population-facts.json WORKS), the same
/// on every PC.
/// </summary>
[GamePart(9)]
public partial class WallWorks : Node
{
    public static WallWorks? I { get; private set; }
    // build_wall.py: the breastwork (BATTER 0.15 + BW_T 0.5) inside the wall's thickness; the drum 1 m in from the
    // shear legs' feet (0.15 inside the breastwork); its axle 0.55 m over the walk, its crank at 0.62 along
    private const double Breastwork = 0.65, DrumIn = 0.85;
    private static readonly Vector3 DrumAxle = new(0.475f, 0.78f, 0.08f); // workgoods crab_winch (its extras)
    private const float GearRatio = 4f;
    /// <summary>Where the winch's navvy stands at its crank, facing it (world), or null: no works.</summary>
    public (double X, double Z, double Yaw)? Crank { get; private set; }
    public int TrianglesTaken { get; private set; }
    public Node3D? Winch { get; private set; }
    private Node3D? crank, drum;
    private Transform3D frame;
    private Vector3 drumAt, along, outward;
    private float walk;
    /// <summary>The crank's turn now (radians about its axle, 0 the arm up), for a check.</summary>
    public float CrankAngle { get; private set; }

    public override void _Ready()
    {
        I = this;
        if (Paths.NativeDataRoot == null) return;
        var city = JsonNode.Parse(File.ReadAllText(Paths.Shared("city.json")));
        string factsFile = Path.Combine(Paths.NativeDataRoot, "services", "native-population-facts.json");
        if (city?["decor"]?["rampart"] is not JsonObject wall || !File.Exists(factsFile)) return;
        JsonNode? works = null;
        void Find(JsonNode? n) { if (works != null || n == null) return; if (n is JsonObject o) { if (o["WORKS"] is JsonObject w) { works = w; return; } foreach (var kv in o) Find(kv.Value); } else if (n is JsonArray a) foreach (var v in a) Find(v); }
        Find(JsonNode.Parse(File.ReadAllText(factsFile)));
        string seg = works?["seg"]?.GetValue<string>() ?? "";
        if (wall["segments"] is not JsonArray segments || segments.FirstOrDefault(q => q?["name"]?.GetValue<string>() == seg) is not JsonObject s) return;
        double T = wall["t"]!.GetValue<double>(), h = wall["h"]!.GetValue<double>();
        double mid = (works!["s0"]!.GetValue<double>() + works["s1"]!.GetValue<double>()) / 2, o = T - Breastwork + 0.15 - 1.0;
        // the segment's frame (build_wall.py sframe, p): x = o + t a + n (o - T), the walk's height h
        var o0 = new Vector2((float)s["o"]![0]!.GetValue<double>(), (float)s["o"]![1]!.GetValue<double>());
        var t = new Vector2((float)s["t"]![0]!.GetValue<double>(), (float)s["t"]![1]!.GetValue<double>());
        var n = new Vector2((float)s["n"]![0]!.GetValue<double>(), (float)s["n"]![1]!.GetValue<double>());
        Vector3 P(double a, double oo, double y) { var q = o0 + t * (float)a + n * (float)(oo - T); return new Vector3(q.X, (float)y, q.Y); }
        walk = (float)h;
        drumAt = P(mid, o, h + 0.55);
        along = new Vector3(t.X, 0, t.Y); outward = new Vector3(n.X, 0, n.Y);
        // the old winch out of the bake: its cheeks (a +-0.49, o +-0.35, 0.8 high), axle (a -0.5 .. +0.62) and crank
        var touched = new List<string>();
        foreach (var node in BakedWorld.All(Main.I.World))
            if (node is MeshInstance3D { Mesh: not null } mi && (mi.GlobalTransform * mi.Mesh.GetAabb()).Grow(0.5f).HasPoint(drumAt))
            {
                // the wall's props only (build_wall.py: g.grp "props"), never its walk, so no faces of the paving go
                string name = mi.Name.ToString() + "/" + mi.GetParent()?.Name.ToString();
                touched.Add(name);
                if (!name.Contains("prop", StringComparison.OrdinalIgnoreCase)) continue;
                Mask(mi, p =>
                {
                    var d = p - drumAt;
                    float a = d.Dot(along), oo = d.Dot(outward), y = p.Y - walk;
                    return a > -0.75f && a < 0.85f && oo > -0.6f && oo < 0.6f && y > -0.05f && y < 0.9f;
                });
            }
        GD.Print("wall works: meshes at the old winch: " + string.Join(", ", touched));
        // the works' crab winch: its body toward the old drum (model +x along -t), its crank at the old crank's end,
        // the man at the crank on the town side facing the field
        var x = -along; var z = x.Cross(Vector3.Up);
        var basis = new Basis(x, Vector3.Up, z);
        var root = drumAt - basis * new Vector3(DrumAxle.X, 0, DrumAxle.Z);
        root.Y = walk;
        frame = new Transform3D(basis, root);
        var man = frame * new Vector3(-0.04f, 0, -0.42f);
        Crank = (man.X, man.Z, Math.Atan2(z.X, z.Z));
        GD.Print($"wall works: the crab winch at ({root.X:0.00}, {root.Z:0.00}); {TrianglesTaken} triangles of the bake's own taken out");
    }

    private void Mask(MeshInstance3D mi, Func<Vector3, bool> inside)
    {
        var mesh = mi.Mesh;
        var xf = mi.GlobalTransform;
        var made = new ArrayMesh();
        int taken = 0;
        for (int s = 0; s < mesh.GetSurfaceCount(); s++)
        {
            var arrays = mesh.SurfaceGetArrays(s);
            var pos = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var index = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            if (index.Length == 0) { index = new int[pos.Length]; for (int i = 0; i < index.Length; i++) index[i] = i; }
            var keep = new List<int>(index.Length);
            for (int k = 0; k + 2 < index.Length; k += 3)
            {
                // a triangle of the old winch: all its corners in its box
                if (inside(xf * pos[index[k]]) && inside(xf * pos[index[k + 1]]) && inside(xf * pos[index[k + 2]])) { taken++; continue; }
                keep.Add(index[k]); keep.Add(index[k + 1]); keep.Add(index[k + 2]);
            }
            if (keep.Count == 0) keep.AddRange(new[] { 0, 0, 0 });
            arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
            made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            made.SurfaceSetMaterial(s, mesh.SurfaceGetMaterial(s));
        }
        if (taken == 0) return;
        TrianglesTaken += taken;
        var overrides = new Material?[mi.GetSurfaceOverrideMaterialCount()];
        for (int s = 0; s < overrides.Length; s++) overrides[s] = mi.GetSurfaceOverrideMaterial(s);
        mi.Mesh = made;
        for (int s = 0; s < overrides.Length; s++) mi.SetSurfaceOverrideMaterial(s, overrides[s]);
    }

    /// <summary>Stand the winch up once the town is there (its model, its solid body for walkers and the player).</summary>
    private void Place()
    {
        if (Winch != null || Crank == null || ModelLibrary.Get("workgoods", new ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true))?.Copy("crab_winch") is not { } model) return;
        Winch = model;
        model.Name = "works_crab_winch";
        Main.I.View.AddChild(model);
        model.GlobalTransform = frame;
        crank = BakedWorld.All(model).OfType<Node3D>().FirstOrDefault(c => c.Name == "winch_crank");
        drum = BakedWorld.All(model).OfType<Node3D>().FirstOrDefault(c => c.Name == "winch_drum");
        // its body: the frame between the cheeks (the handle's sweep left free for the man)
        var solid = new StaticBody3D { Name = "solid", CollisionLayer = Solid.Layer, CollisionMask = 0 };
        var box = new BoxShape3D { Size = new Vector3(0.95f, 1.15f, 1.0f) };
        solid.AddChild(new CollisionShape3D { Shape = box, Position = new Vector3(0.47f, 0.575f, 0.36f) });
        model.AddChild(solid);
        WalkMap.RegisterBody(solid, new Aabb(new Vector3(0.47f, 0.575f, 0.36f) - box.Size / 2, box.Size));
    }

    /// <summary>The navvy cranks: the crank follows the arm of the crank his clip turns (its things' crank in his frame,
    /// arm along its x), the drum the crank through the gears.</summary>
    public void Turn(People.Human human)
    {
        if (crank == null || human.WorkThing("crank") is not { } pose) return;
        var arm = (pose.Basis * Vector3.Right).Normalized();
        // (his frame and the winch's share their axes: the axle along x)
        CrankAngle = MathF.Atan2(arm.Z, arm.Y);
        crank.Rotation = new Vector3(CrankAngle, 0, 0);
        if (drum != null) drum.Rotation = new Vector3(-CrankAngle / GearRatio, 0, 0);
    }

    public override void _Process(double delta)
    {
        if (Winch == null && Crank != null && ModelLibrary.Available("workgoods")) Place();
        if (Winch == null || Crank is not { } at || Main.I.GetNodeOrNull<Townspeople>("Townspeople")?.Crowd is not { } crowd) return;
        // the man at the crank pulling (the host's navvy or a guest's copy of him) cranks the winch
        foreach (var p in crowd.Walking)
        {
            // (the walk map's half-metre cells round the winch stop him short: the last step to the crank, his own)
            if (!p.Remote && p.Human.Motion == "pull" && !crowd.PuppetBusy(p) && Math.Abs(p.X - at.X) + Math.Abs(p.Z - at.Z) is > 0.05 and < 2.5) { p.X = at.X; p.Z = at.Z; p.Yaw = at.Yaw; }
            if (!p.Human.IsPeople2 || Math.Abs(p.X - at.X) + Math.Abs(p.Z - at.Z) > 0.4) continue;
            bool cranking = p.Human.Motion == "pull";
            if (cranking && p.Human.Work != "winch") { p.Human.Work = "winch"; p.Human.HideWorkThing("crank", true); }
            if (cranking && p.Shown) Turn(p.Human);
        }
    }
}
