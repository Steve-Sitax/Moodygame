using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// What is solid in the baked town, for Godot's physics (docs/godot-port.md: Jef walks on the baked meshes). The
/// browser keeps a walk map and a list of boxes (world/rijnkaai.ts addCollider, modelCollision.ts); here the drawn
/// triangles themselves are the walls and the floors. Left out, as the browser leaves them out: hidden nodes, glows
/// and other see-through sprites, decals, leaves, water, litter, things flatter than a few centimetres; and the
/// frozen copies of what moves (people, animals, boats, vehicles), which their own parts bring back.
/// The shapes are made while the game loads (the whole town: about 1.6 s). `--solidlazy` makes them near the camera
/// only: at once within a few metres, the rest a little every frame.
/// </summary>
[GamePart(10)]
public partial class Solid : Node
{
    public static Solid I { get; private set; } = null!;
    /// <summary>The physics layer of the still world.</summary>
    public const uint Layer = 1;

    /// <summary>Shapes are made this far round the camera, a little every frame.</summary>
    private const float Reach = 60;
    /// <summary>Milliseconds a frame for making them.</summary>
    private const double Budget = 1.5;

    private sealed class Item
    {
        public Mesh Mesh = null!;
        public Transform3D Xf;
        public Aabb Box;
        public bool Built;
        public string Name = "";
    }

    private readonly List<Item> items = new();
    private readonly List<Item> queue = new();
    private readonly Dictionary<Mesh, Vector3[]> faces = new();
    private readonly Dictionary<Shader, bool> seeThrough = new();
    private readonly List<ConcavePolygonShape3D> shapes = new();
    private readonly List<Rid> bodies = new();
    private Rid space;
    private Vector3 scannedAt = new(1e9f, 0, 0);
    private bool all;
    /// <summary>The physics tick in which the last shape was made: the space knows it one tick later.</summary>
    public ulong BuiltAtTick { get; private set; }
    public int Triangles { get; private set; }
    public int Built { get; private set; }
    public double BuildMs { get; private set; }

    // whole groups that are not walls: what moves (their parts bring them back), the sky and the weather, plants,
    // marks on the ground
    private static readonly HashSet<string> SkipGroups = new()
    {
        "moored", "barque", "brig", "steamer", "rowboat", "rhine_barge", "sloop", "punt", "paddle_tug", "lighter", "lighter_loaded",
        "small_boats", "river_traffic", "life_aboard", "mooring_ropes", "boat_lamps", "funnel_smoke",
        "traffic", "omnibuses", "omnibus_signs", "pushcart", "handcart_loaded", "dray_horse", "goods_drays", "horses", "velocipede", "railway",
        "park_wildlife", "emigrants", "player_figure", "wall_guards", "park_keeper_and_work",
        "ambient", "cloud_sky", "litter", "posters", "ruts", "vegetation", "fires", "wall_life", "far_glow", "gas_lamp_halos", "rope_coil",
        "ground_seams", "clock_hands",
    };
    private static readonly Regex SkipPrefix = new("^(alive_|wall_climbers|lantern_pool|rampart_(plants|leaves|lilies|reedbank))", RegexOptions.Compiled);
    private static readonly HashSet<string> SkipWords = new() { "leaves", "lilies", "decal", "decals", "glow", "glows", "light", "smoke", "stains", "rigging", "halos", "sails", "plants" };
    /// <summary>Copies (the browser's InstancedMesh): only the tree trunks and the stacked goods are solid.</summary>
    private static readonly Regex SolidCopies = new("^inst\\d+_(tree[a-z]*bark|goods[a-z]*)_mm$", RegexOptions.Compiled);

    public override void _Ready()
    {
        I = this;
        ulong t0 = Time.GetTicksUsec();
        var world = Main.I.World;
        space = Main.I.View.FindWorld3D().Space;
        var people = new HashSet<Node>();
        foreach (var n in BakedWorld.All(world))
            if (n is Skeleton3D)
            {
                people.Add(n);
                var p = n.GetParent();
                if (p != null && p != world && p.GetParent() != world) people.Add(p);
            }
        var skip = new Dictionary<string, int>();
        void Note(string why) => skip[why] = skip.GetValueOrDefault(why) + 1;
        Collect(world, false, people, Note);
        Main.I.World.Report["solidItems"] = items.Count;
        Main.I.World.Report["solidScanMs"] = Math.Round((Time.GetTicksUsec() - t0) / 1000.0, 1);
        GD.Print($"solid: {items.Count} things can be walls; left out: {string.Join(", ", skip.GroupBy(k => k.Key.StartsWith("group") ? "groups" : k.Key).Select(g => $"{g.Key} {g.Sum(k => k.Value)}"))}");
        if (!Main.I.Flag("solidlazy"))
        {
            // The whole town at once, while the game loads: measured 1.6 s for 2.3 million triangles (PCX), and no
            // work at all while playing. With --solidlazy only what is near the camera is made (0.25 s at the
            // start, then a little every frame; a big mesh costs one slow frame when its turn comes).
            all = true;
            Ensure(Vector3.Zero, 1e9f);
            GD.Print($"solid: the whole town, {Built} shapes, {Triangles} triangles, in {BuildMs:0} ms");
        }
        Main.I.World.Report["solidShapes"] = Built;
        Main.I.World.Report["solidTriangles"] = Triangles;
        Main.I.World.Report["solidBuildMs"] = Math.Round(BuildMs);
    }

    private void Collect(Node n, bool skipped, HashSet<Node> people, Action<string> note)
    {
        string name = n.Name.ToString().ToLowerInvariant();
        if (!skipped && n != Main.I.World)
        {
            string plain = name.TrimEnd('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '_');
            if (people.Contains(n)) { skipped = true; note("people"); }
            else if (n.HasMeta("mover")) { skipped = true; note("movers"); } // a mover's own (src/Movers): it brings a body that moves
            else if (SkipGroups.Contains(plain) || SkipPrefix.IsMatch(name)) { skipped = true; note("group " + plain); }
            else if (n is Node3D { Visible: false }) { skipped = true; note("hidden"); }
            else if (DrawnOver(n))
            {
                // the browser draws these over the rest (renderOrder): the water's sheets, glows, pools of light
                skipped = true;
                note("drawn over");
                // the river's own sheet tells where the tide stood when the town was baked (until the clock is ported)
                if (n is MeshInstance3D { Mesh: not null } w)
                {
                    var box = w.GlobalTransform * w.Mesh.GetAabb();
                    if (box.Size.Y < 0.05f && box.Size.X > 500) Tide.River = box.Position.Y;
                }
            }
        }
        if (!skipped && !n.IsQueuedForDeletion())
        {
            if (n is MeshInstance3D mi && mi.Mesh != null)
            {
                if (mi.Skin != null) note("people");
                else if (name.StartsWith("inst") && name.Contains('_') && char.IsDigit(name[4])) note("copies"); // (its MultiMesh stands beside it)
                else if (Words(name)) note("word");
                else Add(mi.Mesh, mi.GlobalTransform, note, PathOf(mi));
            }
            else if (n is MultiMeshInstance3D mm && mm.Multimesh?.Mesh != null)
            {
                if (!SolidCopies.IsMatch(name)) note("copies");
                else
                    for (int i = 0; i < mm.Multimesh.InstanceCount; i++)
                        Add(mm.Multimesh.Mesh, mm.GlobalTransform * mm.Multimesh.GetInstanceTransform(i), note, name);
            }
        }
        foreach (var c in n.GetChildren()) Collect(c, skipped, people, note);
    }

    private static bool DrawnOver(Node n)
    {
        if (!n.HasMeta("extras")) return false;
        var ex = n.GetMeta("extras").AsGodotDictionary();
        return ex.TryGetValue("ro", out var ro) && ro.AsDouble() != 0;
    }

    private static bool Words(string name)
    {
        bool bark = false, hit = false;
        foreach (var w in name.Split('_', ' ', ':', '-', '.'))
        {
            if (w == "bark") bark = true;
            if (SkipWords.Contains(w)) hit = true;
        }
        return hit && !bark;
    }

    /// <summary>A thing's name for the checks: its own and the group it is in.</summary>
    private static string PathOf(Node n)
    {
        string s = n.Name.ToString();
        for (var p = n.GetParent(); p != null && p != Main.I.World && p.GetParent() != Main.I.World; p = p.GetParent())
            if (!p.Name.ToString().StartsWith('@') && !p.Name.ToString().StartsWith('_')) s = p.Name + "/" + s;
        return s;
    }

    private readonly Dictionary<Rid, string> names = new();

    /// <summary>What a ray from a to b hits first (the checks say what held Jef, what he stands on), or "".</summary>
    public string NameAt(Vector3 a, Vector3 b)
    {
        var hit = Main.I.View.FindWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(a, b, Layer));
        return hit.Count > 0 && names.TryGetValue(hit["rid"].AsRid(), out var s) ? s : "";
    }

    private void Add(Mesh mesh, Transform3D xf, Action<string> note, string name)
    {
        var box = xf * mesh.GetAabb();
        // a decal, a puddle, a mark on the ground: nothing to walk into
        if (box.Size.Y < 0.03f && Math.Max(box.Size.X, box.Size.Z) < 3)
        {
            note("flat");
            return;
        }
        items.Add(new Item { Mesh = mesh, Xf = xf, Box = box, Name = name });
    }

    /// <summary>A material you see through and walk through: a glow, a halo, a decal that writes no depth.</summary>
    private bool SeeThrough(Material? m)
    {
        if (m is not ShaderMaterial sm || sm.Shader == null) return false;
        if (seeThrough.TryGetValue(sm.Shader, out bool v)) return v;
        string code = sm.Shader.Code;
        int end = code.IndexOf(';', Math.Max(0, code.IndexOf("render_mode", StringComparison.Ordinal)));
        string modes = end > 0 ? code[..end] : "";
        v = modes.Contains("blend_add") || modes.Contains("depth_draw_never");
        seeThrough[sm.Shader] = v;
        return v;
    }

    /// <summary>The mesh's solid triangles in its own frame (three corners each).</summary>
    private Vector3[] FacesOf(Mesh mesh)
    {
        if (faces.TryGetValue(mesh, out var f)) return f;
        var list = new List<Vector3>();
        for (int s = 0; s < mesh.GetSurfaceCount(); s++)
        {
            if (mesh is ArrayMesh am && am.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles) continue;
            if (SeeThrough(mesh.SurfaceGetMaterial(s))) continue;
            var arr = mesh.SurfaceGetArrays(s);
            var v = arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var ix = arr[(int)Mesh.ArrayType.Index];
            if (ix.VariantType == Variant.Type.Nil) list.AddRange(v.AsSpan(0, v.Length - v.Length % 3).ToArray());
            else
                foreach (int i in ix.AsInt32Array())
                    list.Add(v[i]);
        }
        f = list.ToArray();
        faces[mesh] = f;
        return f;
    }

    private void Build(Item it)
    {
        it.Built = true;
        var local = FacesOf(it.Mesh);
        if (local.Length < 3) return;
        var pts = new Vector3[local.Length];
        for (int i = 0; i < pts.Length; i++) pts[i] = it.Xf * local[i];
        var shape = new ConcavePolygonShape3D { BackfaceCollision = true };
        shape.SetFaces(pts);
        var body = PhysicsServer3D.BodyCreate();
        PhysicsServer3D.BodySetMode(body, PhysicsServer3D.BodyMode.Static);
        PhysicsServer3D.BodyAddShape(body, shape.GetRid());
        PhysicsServer3D.BodySetCollisionLayer(body, Layer);
        PhysicsServer3D.BodySetCollisionMask(body, 0);
        PhysicsServer3D.BodySetSpace(body, space);
        shapes.Add(shape);
        bodies.Add(body);
        names[body] = it.Name;
        Triangles += pts.Length / 3;
        Built++;
        BuiltAtTick = Engine.GetPhysicsFrames();
    }

    private static float Distance(Aabb b, Vector3 p)
    {
        float dx = Math.Max(0, Math.Max(b.Position.X - p.X, p.X - b.End.X));
        float dz = Math.Max(0, Math.Max(b.Position.Z - p.Z, p.Z - b.End.Z));
        return MathF.Sqrt(dx * dx + dz * dz);
    }

    /// <summary>Everything within r metres (on the map) of p is solid now. Returns how many shapes it had to make.</summary>
    public int Ensure(Vector3 p, float r)
    {
        ulong t0 = Time.GetTicksUsec();
        int n = 0;
        foreach (var it in items)
            if (!it.Built && Distance(it.Box, p) <= r)
            {
                Build(it);
                n++;
            }
        if (n > 0) BuildMs += (Time.GetTicksUsec() - t0) / 1000.0;
        return n;
    }

    /// <summary>The shapes just made are in the physics space (it takes them in at its next tick)?</summary>
    public bool Settled => Engine.GetPhysicsFrames() > BuiltAtTick + 1;

    public override void _Process(double delta)
    {
        if (all || Main.I.Cam == null) return;
        var p = Main.I.Cam.GlobalPosition;
        if (p.DistanceTo(scannedAt) > 4)
        {
            scannedAt = p;
            queue.Clear();
            foreach (var it in items)
                if (!it.Built && Distance(it.Box, p) <= Reach)
                    queue.Add(it);
            queue.Sort((a, b) => Distance(b.Box, p).CompareTo(Distance(a.Box, p))); // the nearest last: taken from the end
        }
        if (queue.Count == 0) return;
        ulong t0 = Time.GetTicksUsec();
        while (queue.Count > 0 && (Time.GetTicksUsec() - t0) / 1000.0 < Budget)
        {
            var it = queue[^1];
            queue.RemoveAt(queue.Count - 1);
            if (!it.Built) Build(it);
        }
        BuildMs += (Time.GetTicksUsec() - t0) / 1000.0;
    }

    public override void _ExitTree()
    {
        foreach (var b in bodies) PhysicsServer3D.FreeRid(b);
        bodies.Clear();
        shapes.Clear();
    }
}
