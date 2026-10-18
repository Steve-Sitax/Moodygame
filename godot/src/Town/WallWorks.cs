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
    // #180: the shear legs' fall, its basket of rubble and the rope back to the drum (build_wall.py shear_legs) were baked
    // still. They come out of the bake: the basket (with its sling and rubble) hangs from a live fall that the crab winch's
    // drum winds in as the navvy cranks; at the top it is emptied, then let down on the brake, filled and hoisted again.
    private Vector3 block, hookLow, ropeLeaves;
    private MeshInstance3D? load, fall, back;
    private float lift, crankBefore = float.NaN, hold;
    private bool lowering;
    private const float DrumRadius = 0.10f, LiftTop = 4.0f, LowerSpeed = 0.35f;
    /// <summary>For a check: how high the basket is hoisted (metres over its lowest), and whether it is being let down.</summary>
    public float Lift => lift;
    public bool Lowering => lowering;
    public Node3D? Load => load;
    /// <summary>For the pictures: the shear legs' block, where the hook hangs now, and the wall's run.</summary>
    public Vector3 Block => block;
    public Vector3 Hook => hookLow + Vector3.Up * lift;
    public Vector3 Along => along;
    private readonly List<(Material? Material, List<Vector3> V, List<Vector3> N, List<Vector2> Uv, List<Color> C)> taken = new();

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
        // the shear legs' block under their head (4.6 m over the walk, 0.35 below the lashing) and the fall's hook at its lowest
        // (the basket 3.2 m under the walk, its sling meeting 0.55 m over it), as build_wall.py draws them
        double top = T + 0.9;
        block = P(mid, top, h + 4.6 - 0.35);
        hookLow = P(mid, top, h - 3.2 + 0.55);
        var oldDrum = P(mid, o, h + 0.64);
        static float ToSegment(Vector3 p, Vector3 a, Vector3 b) { var ab = b - a; float t = Math.Clamp((p - a).Dot(ab) / ab.LengthSquared(), 0, 1); return p.DistanceTo(a + ab * t); }
        var basketAt = hookLow - new Vector3(0, 0.55f, 0);
        var reach = new Aabb(basketAt - new Vector3(1, 1, 1), Vector3.Zero).Expand(block + new Vector3(1, 1, 1)).Expand(oldDrum);
        foreach (var node in BakedWorld.All(Main.I.World))
            if (node is MeshInstance3D { Mesh: not null } mi && mi.Name.ToString().Contains("prop", StringComparison.OrdinalIgnoreCase)
                && (mi.GlobalTransform * mi.Mesh.GetAabb()).Intersects(reach))
            {
                // the ropes (thin bars along the two falls, short of the block), and the basket with its sling and rubble
                Mask(mi, p => p.Y < block.Y - 0.1f && (ToSegment(p, block, hookLow) < 0.045f || ToSegment(p, oldDrum, block) < 0.045f && p.Y > walk + 0.6f));
                Mask(mi, p => new Vector2(p.X - basketAt.X, p.Z - basketAt.Z).Length() < 0.42f && p.Y > basketAt.Y - 0.35f && p.Y < hookLow.Y + 0.05f, taken);
            }
        GD.Print($"wall works: the shear legs' fall and basket out of the bake ({taken.Sum(t => t.V.Count / 3)} basket triangles to hoist)");
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

    private void Mask(MeshInstance3D mi, Func<Vector3, bool> inside, List<(Material? Material, List<Vector3> V, List<Vector3> N, List<Vector2> Uv, List<Color> C)>? keepTaken = null)
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
                if (inside(xf * pos[index[k]]) && inside(xf * pos[index[k + 1]]) && inside(xf * pos[index[k + 2]]))
                {
                    taken++;
                    if (keepTaken != null)
                    {
                        // (kept, in the town's frame, to be drawn again where the load hangs)
                        var normals = arrays[(int)Mesh.ArrayType.Normal].VariantType == Variant.Type.Nil ? null : arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                        var uvs = arrays[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.Nil ? null : arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                        var colors = arrays[(int)Mesh.ArrayType.Color].VariantType == Variant.Type.Nil ? null : arrays[(int)Mesh.ArrayType.Color].AsColorArray();
                        var material = mi.GetSurfaceOverrideMaterial(s) ?? mesh.SurfaceGetMaterial(s);
                        var bag = keepTaken.FirstOrDefault(b => b.Material == material);
                        if (bag.V == null) { bag = (material, new(), new(), new(), new()); keepTaken.Add(bag); }
                        for (int q = 0; q < 3; q++)
                        {
                            int i = index[k + q];
                            bag.V.Add(xf * pos[i]); bag.N.Add(normals != null ? (xf.Basis * normals[i]).Normalized() : Vector3.Up);
                            bag.Uv.Add(uvs != null ? uvs[i] : Vector2.Zero); bag.C.Add(colors != null ? colors[i] : Colors.White);
                        }
                    }
                    continue;
                }
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
        // the drum winds the fall in: the basket rises by the rope wound on (a turn of the crank is a quarter turn of the drum)
        if (!float.IsNaN(crankBefore) && !lowering && hold <= 0)
        {
            float turned = Mathf.Wrap(CrankAngle - crankBefore, -MathF.PI, MathF.PI);
            lift = Math.Min(LiftTop, lift + MathF.Abs(turned) / GearRatio * DrumRadius);
            if (lift >= LiftTop) hold = 4f; // emptied over the walk
        }
        crankBefore = CrankAngle;
        if (drum != null) drum.Rotation = new Vector3(-lift / DrumRadius, 0, 0);
    }
    /// <summary>The live fall and basket: made once the winch stands, moved to where the load hangs now.</summary>
    private void Hoist(double delta)
    {
        if (load == null)
        {
            var mesh = new ArrayMesh();
            foreach (var t in taken)
            {
                var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
                arrays[(int)Mesh.ArrayType.Vertex] = t.V.Select(v => v - hookLow).ToArray(); arrays[(int)Mesh.ArrayType.Normal] = t.N.ToArray();
                arrays[(int)Mesh.ArrayType.TexUV] = t.Uv.ToArray(); arrays[(int)Mesh.ArrayType.Color] = t.C.ToArray();
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays); mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, t.Material);
            }
            load = new MeshInstance3D { Name = "works_basket", Mesh = mesh };
            var rope = new CylinderMesh { TopRadius = 0.011f, BottomRadius = 0.011f, Height = 1f, RadialSegments = 6, Rings = 1, Material = new StandardMaterial3D { AlbedoColor = new Color(0.32f, 0.26f, 0.18f), Roughness = 0.95f } };
            fall = new MeshInstance3D { Name = "works_fall", Mesh = rope }; back = new MeshInstance3D { Name = "works_back_fall", Mesh = rope };
            Main.I.View.AddChild(load); Main.I.View.AddChild(fall); Main.I.View.AddChild(back);
            ropeLeaves = frame * new Vector3(0.383f, 0.78f, 0.181f); // workgoods.extras.json crab_winch rope_leaves
        }
        if (hold > 0 && (hold -= (float)delta) <= 0 && lift >= LiftTop) lowering = true;
        if (lowering)
        {
            lift = Math.Max(0, lift - LowerSpeed * (float)delta);
            if (lift <= 0) { lowering = false; hold = 3f; } // filled again at the foot of the wall
            if (drum != null) drum.Rotation = new Vector3(-lift / DrumRadius, 0, 0);
        }
        var hook = hookLow + Vector3.Up * lift;
        load.GlobalPosition = hook;
        Span(fall!, block, hook);
        Span(back!, ropeLeaves, block);
    }
    private static void Span(MeshInstance3D rope, Vector3 a, Vector3 b)
    {
        var d = b - a; float len = d.Length(); if (len < 1e-4f) return;
        var y = d / len; var x = MathF.Abs(y.Dot(Vector3.Right)) < 0.9f ? Vector3.Right : Vector3.Back; var z = x.Cross(y).Normalized(); x = y.Cross(z);
        rope.GlobalTransform = new Transform3D(new Basis(x, y * len, z), (a + b) / 2);
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
        Hoist(delta);
    }
}
