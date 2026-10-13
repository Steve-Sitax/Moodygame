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
        "small_boats", "river_traffic", "life_aboard", "mooring_ropes", "ship_lines", "boat_lamps", "funnel_smoke",
        "traffic", "omnibuses", "omnibus_signs", "pushcart", "handcart_loaded", "dray_horse", "goods_drays", "horses", "velocipede", "railway",
        "park_wildlife", "emigrants", "player_figure", "wall_guards", "park_keeper_and_work",
        "ambient", "cloud_sky", "litter", "posters", "ruts", "vegetation", "fires", "wall_life", "far_glow", "gas_lamp_halos", "rope_coil",
        "ground_seams", "clock_hands",
    };
    private static readonly Regex SkipPrefix = new("^(alive_|wall_climbers|lantern_pool|rampart_(plants|leaves|lilies|reedbank))", RegexOptions.Compiled);
    private static readonly HashSet<string> SkipWords = new() { "leaves", "lilies", "decal", "decals", "glow", "glows", "light", "smoke", "stains", "rigging", "halos", "sails", "plants" };
    /// <summary>Copies (the browser's InstancedMesh): only the tree trunks and the stacked goods are solid.</summary>
    private static readonly Regex SolidCopies = new("^inst\\d+_(tree[a-z]*bark|goods[a-z]*)_mm$", RegexOptions.Compiled);

    /// <summary>
    /// What a part moves and makes solid itself (a door's leaf, goods that are lifted): a part adds a test here in
    /// its constructor (every part is made before the first is added), and such a node and all under it get no wall.
    /// </summary>
    public static readonly List<Func<Node, bool>> Leave = new();

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
        ulong tHoles = Time.GetTicksUsec();
        FindStairHoles(world);
        GD.Print($"solid: stair holes found in {(Time.GetTicksUsec() - tHoles) / 1000.0:0.0} ms");
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
            GD.Print($"solid: the whole town, {Built} shapes, {Triangles} triangles, in {BuildMs:0} ms (stair holes {CutMs:0.0} ms)");
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
            else if (Leave.Exists(f => f(n))) { skipped = true; note("a part's own"); }
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
    private readonly Dictionary<Rid, Aabb> bounds = new();

    public string BodyName(Rid body) => names.GetValueOrDefault(body, "");
    public Aabb BodyBounds(Rid body) => bounds.GetValueOrDefault(body);

    /// <summary>The Godot physics shapes include details absent from the browser's collider boxes. Raster their actual triangles,
    /// not a whole model AABB (which would close the bridge under its overhead beam).</summary>
    public void Footprints(Scheldemist.Town.WalkMap map)
    {
        foreach (var it in items)
            if (map.HasBodyAt(it.Box))
            {
                var local = FacesOf(it.Mesh);
                var pts = new Vector3[local.Length];
                for (int i = 0; i < pts.Length; i++) pts[i] = it.Xf * local[i];
                map.AddTriangles(pts);
            }
        map.CloseOpenCells();
    }

    /// <summary>What a ray from a to b hits first (the checks say what held Jef, what he stands on), or "".</summary>
    public string NameAt(Vector3 a, Vector3 b)
    {
        var hit = Main.I.View.FindWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(a, b, Layer));
        return hit.Count > 0 && names.TryGetValue(hit["rid"].AsRid(), out var s) ? s : "";
    }

    /// <summary>
    /// What a ray from a to b meets first, for a report of what holds someone: the baked part's name, or what a body the
    /// game stands up itself (a stall, a parked cart) says it is in its "held_by" meta. `furniture` is true for the second
    /// kind: things that stand in the street for a while and that a walker goes round, not walls.
    /// </summary>
    public string HeldBy(Vector3 a, Vector3 b, out bool furniture)
    {
        furniture = false;
        var hit = Main.I.View.FindWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(a, b, Layer));
        if (hit.Count == 0) return "";
        if (names.TryGetValue(hit["rid"].AsRid(), out var s)) return s;
        if (hit["collider"].AsGodotObject() is Node n && n.HasMeta("held_by"))
        {
            furniture = true;
            return n.GetMeta("held_by").AsString();
        }
        return "";
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

    // The floors that are open over a flight of steps going down. The street draws the paving and each house's dark
    // lining over a cellar's stair and "punches" them away only in the picture; here both are walls, and a cellar's
    // stair under them could never be walked. Each tread of such a flight opens the ground and the lining's floor
    // above it (a flat triangle of them, at the floor's height), while the room's own passage, landing and treads
    // stay as they are.
    private readonly List<Hole> holes = new();
    private float holeX0 = float.MaxValue, holeX1 = float.MinValue, holeZ0 = float.MaxValue, holeZ1 = float.MinValue;

    /// <summary>One tread's footprint (counter-clockwise, in x, z), its box, and the height of the floor it opens.</summary>
    private readonly record struct Hole(Vector2[] Poly, float X0, float X1, float Z0, float Z1, float Y);
    /// <summary>Milliseconds spent opening the floors over stairs while the shapes were made.</summary>
    public double CutMs { get; private set; }

    private void FindStairHoles(Node world)
    {
        if (Main.I.Flag("no-stair-holes")) return; // (dev: the paving and the linings stay solid over the stairs, to compare)
        foreach (var room in BakedWorld.All(world).Where(n => n.Name.ToString().StartsWith("ROOM_", StringComparison.Ordinal)).ToList())
        {
            string name = room.Name.ToString();
            if (room is not Node3D || !name.StartsWith("ROOM_", StringComparison.Ordinal)) continue;
            if (world.FindChild("house_lining_" + name["ROOM_".Length..], true, false) is not MeshInstance3D { Mesh: not null } lining) continue;
            float floor = (lining.GlobalTransform * lining.Mesh.GetAabb()).Position.Y, lowest = float.PositiveInfinity;
            var meshes = BakedWorld.All(room).OfType<MeshInstance3D>().Where(m => m.Mesh != null).ToList();
            foreach (var m in meshes) lowest = Math.Min(lowest, (m.GlobalTransform * m.Mesh!.GetAabb()).Position.Y);
            if (lowest >= floor - 1f) continue; // a room at the street's level: its lining is its floor
            // The room's floor: its lowest wide level surface (a slab's underside lies a hand below its top, so a tread
            // counts from 0.15 m above that, or from 0.3 above the room's lowest point, whichever is lower). The
            // flight's last treads open the ground too (issue 110: the Poesje's stayed closed, and the lining's floor,
            // 2 cm into Jef's head at the last tread but one, stopped the way down).
            float level = float.PositiveInfinity;
            foreach (var m in meshes)
            {
                var f = FacesOf(m.Mesh!);
                for (int i = 0; i + 2 < f.Length; i += 3)
                {
                    Vector3 a = m.GlobalTransform * f[i], b = m.GlobalTransform * f[i + 1], c = m.GlobalTransform * f[i + 2];
                    var normal = (b - a).Cross(c - a);
                    if (normal.Length() * 0.5f >= 1f && MathF.Abs(normal.Y) >= normal.Length() * 0.9f) level = Math.Min(level, (a.Y + b.Y + c.Y) / 3);
                }
            }
            if (!float.IsFinite(level)) level = lowest + 0.2f;
            float reach = Math.Min(lowest + 0.3f, level + 0.15f); // (the cellar's deep shadow quads put its `lowest` far below its floor)
            int before = holes.Count;
            foreach (var m in meshes)
            {
                var f = FacesOf(m.Mesh!);
                for (int i = 0; i + 2 < f.Length; i += 3)
                {
                    Vector3 a = m.GlobalTransform * f[i], b = m.GlobalTransform * f[i + 1], c = m.GlobalTransform * f[i + 2];
                    var normal = (b - a).Cross(c - a);
                    float y = (a.Y + b.Y + c.Y) / 3;
                    if (MathF.Abs(normal.Y) < normal.Length() * 0.9f || normal.Length() * 0.5f < 0.08f || y > floor - 0.1f || y < reach) continue;
                    var poly = new[] { new Vector2(a.X, a.Z), new Vector2(b.X, b.Z), new Vector2(c.X, c.Z) };
                    if ((poly[1] - poly[0]).Cross(poly[2] - poly[0]) < 0) (poly[1], poly[2]) = (poly[2], poly[1]);
                    float x0 = Math.Min(poly[0].X, Math.Min(poly[1].X, poly[2].X)), x1 = Math.Max(poly[0].X, Math.Max(poly[1].X, poly[2].X));
                    float z0 = Math.Min(poly[0].Y, Math.Min(poly[1].Y, poly[2].Y)), z1 = Math.Max(poly[0].Y, Math.Max(poly[1].Y, poly[2].Y));
                    holes.Add(new Hole(poly, x0, x1, z0, z1, floor));
                    holeX0 = Math.Min(holeX0, x0); holeX1 = Math.Max(holeX1, x1); holeZ0 = Math.Min(holeZ0, z0); holeZ1 = Math.Max(holeZ1, z1);
                }
            }
            if (holes.Count > before) GD.Print($"solid: {name}: {holes.Count - before} stair tread triangles open the lining's floor (at {floor:0.00}) and the paving above them");
        }
        if (holes.Count > 0) GD.Print($"solid: {holes.Count} stair tread triangles in all");
    }

    /// <summary>The triangles of a ground or lining mesh with the footprints of the stairs cut out of their floors.</summary>
    private Vector3[] OpenStairHoles(Vector3[] pts, Aabb box)
    {
        if (box.End.X < holeX0 || box.Position.X > holeX1 || box.End.Z < holeZ0 || box.Position.Z > holeZ1) return pts;
        var result = new List<Vector3>(pts.Length);
        var mine = new List<Hole>();
        for (int t = 0; t + 2 < pts.Length; t += 3)
        {
            Vector3 a = pts[t], b = pts[t + 1], c = pts[t + 2];
            float x0 = Math.Min(a.X, Math.Min(b.X, c.X)), x1 = Math.Max(a.X, Math.Max(b.X, c.X)), z0 = Math.Min(a.Z, Math.Min(b.Z, c.Z)), z1 = Math.Max(a.Z, Math.Max(b.Z, c.Z));
            mine.Clear();
            if (x1 >= holeX0 && x0 <= holeX1 && z1 >= holeZ0 && z0 <= holeZ1)
            {
                var normal = (b - a).Cross(c - a);
                if (MathF.Abs(normal.Y) > normal.Length() * 0.9f)
                {
                    float y = (a.Y + b.Y + c.Y) / 3;
                    foreach (var h in holes)
                        if (h.X0 < x1 && h.X1 > x0 && h.Z0 < z1 && h.Z1 > z0 && MathF.Abs(y - h.Y) < 0.12f) mine.Add(h);
                }
            }
            if (mine.Count == 0) { result.Add(a); result.Add(b); result.Add(c); continue; }
            var pieces = new List<List<Vector3>> { new() { a, b, c } };
            foreach (var hole in mine) pieces = pieces.SelectMany(p => Subtract(p, hole)).ToList();
            foreach (var piece in pieces)
                for (int k = 1; k + 1 < piece.Count; k++)
                {
                    if ((piece[k] - piece[0]).Cross(piece[k + 1] - piece[0]).Length() < 2e-4f) continue;
                    result.Add(piece[0]); result.Add(piece[k]); result.Add(piece[k + 1]);
                }
        }
        return result.ToArray();
    }

    /// <summary>A convex polygon without a convex counter-clockwise footprint (in x, z): the pieces outside it.</summary>
    private static IEnumerable<List<Vector3>> Subtract(List<Vector3> poly, Hole footprint)
    {
        float x0 = float.MaxValue, x1 = float.MinValue, z0 = float.MaxValue, z1 = float.MinValue;
        foreach (var v in poly) { x0 = Math.Min(x0, v.X); x1 = Math.Max(x1, v.X); z0 = Math.Min(z0, v.Z); z1 = Math.Max(z1, v.Z); }
        if (footprint.X0 >= x1 || footprint.X1 <= x0 || footprint.Z0 >= z1 || footprint.Z1 <= z0) { yield return poly; yield break; }
        var hole = footprint.Poly;
        var rest = poly;
        for (int e = 0; e < hole.Length && rest.Count >= 3; e++)
        {
            Vector2 p = hole[e], d = hole[(e + 1) % hole.Length] - p;
            float Side(Vector3 v) => d.Cross(new Vector2(v.X, v.Z) - p); // > 0: inside this edge
            var outside = Clip(rest, v => -Side(v));
            if (outside.Count >= 3) yield return outside;
            rest = Clip(rest, Side);
        }
    }

    /// <summary>The part of a convex polygon where `f` is not negative.</summary>
    private static List<Vector3> Clip(List<Vector3> poly, Func<Vector3, float> f)
    {
        var o = new List<Vector3>();
        for (int i = 0; i < poly.Count; i++)
        {
            Vector3 a = poly[i], b = poly[(i + 1) % poly.Count];
            float fa = f(a), fb = f(b);
            if (fa >= 0) o.Add(a);
            if (fa >= 0 != fb >= 0) o.Add(a.Lerp(b, fa / (fa - fb)));
        }
        return o;
    }

    private void Build(Item it)
    {
        it.Built = true;
        var local = FacesOf(it.Mesh);
        if (local.Length < 3) return;
        var pts = new Vector3[local.Length];
        for (int i = 0; i < pts.Length; i++) pts[i] = it.Xf * local[i];
        if (holes.Count > 0 && (it.Name.Contains("ground", StringComparison.Ordinal) || it.Name.Contains("house_lining_", StringComparison.Ordinal)))
        {
            ulong tCut = Time.GetTicksUsec();
            pts = OpenStairHoles(pts, it.Box);
            CutMs += (Time.GetTicksUsec() - tCut) / 1000.0;
        }
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
        bounds[body] = it.Box;
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
            SortQueue(p); // the nearest last: taken from the end
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

    // A captured sort key must not allocate before the normal all-built early return.
    private void SortQueue(Vector3 p) => queue.Sort((a, b) => Distance(b.Box, p).CompareTo(Distance(a.Box, p)));

    public override void _ExitTree()
    {
        foreach (var b in bodies) PhysicsServer3D.FreeRid(b);
        bodies.Clear();
        names.Clear(); bounds.Clear();
        shapes.Clear();
    }
}
