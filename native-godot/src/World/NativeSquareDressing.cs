using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.Native.Authoring;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// The squares the razing opened round Sint-Paulus, Sint-Jacob and Sint-Carolus (NativeRazedHouses), made to read as 1873
/// ground that houses stood on a few months ago (Steve, 2026-10-27: "time-appropriate, a bit moody and grimy"; Codex's
/// critique and paint-overs in art-source/square-mood-20261027). world/town/square-dressing.json says what goes where.
/// - Ground: the dirt mask the paving reads (maps/dirt.png: r mud and grime, g wear) was baked with the houses standing,
///   so their plots were "inside a block", all mud. On the cut plots it is drawn again: clean-ish stone, grime along the
///   walls that still stand and the churches' feet, swept paths worn smooth, mud where carts stand and water runs.
/// - Bared walls: a standing neighbour's party wall a razed house stood against shows the old brick (the bake's own rule
///   for the houses pulled down in September, build_city.py side_wall) and the ghost of the house: its rooms' plaster up to
///   its eaves and gable, dark lines where its roof and floors sat, its flue's soot and a fireplace's on every floor, a
///   scrap of wallpaper a room (the town's own grime decal material and cells), and the iron anchors of its beams.
/// - Things: the street kit's cast-iron pump (one model everywhere), the town's own guard stones, handcart, trough, sacks,
///   barrels, straw, dung and leaves (their model packs), and the salvage: stacks of reclaimed bricks and a rubble heap
///   of brick and lime, both in the town's facade material (its brick and plaster pictures), so no new shader kind.
/// (dev: --no-square-dressing leaves the squares as the razing left them, for a before-and-after)
/// </summary>
public static class NativeSquareDressing
{
    public const string File = "res://world/town/square-dressing.json";
    /// <summary>Marks this dressing's nodes: they bring their own collision (Solid leaves them).</summary>
    public const string Meta = "native_square_dressing";
    private const string GrimeDecalMaterial = "res://world/town/resources/r000221.res";
    private const string FacadeMaterial = "res://world/town/resources/r000195.res";
    private const string IronMaterial = "res://world/town/resources/r000615.res";
    private const string GuardStoneMaterial = "res://assets/materials/guard-stones-20261026/guard-stone.tres";
    private const string KitDir = "res://recovered/street-props-20261015/props";
    private const string PumpAsset = KitDir + "/street-pump-iron.tres";

    public sealed record Area(string Name, float[][] Outline);
    public sealed record Path(string Id, float[][] Points, float Width);
    public sealed record Spot(string Id, float[] At, float Radius, float Mud);
    public sealed record GroundPlan(float Base, float WallGrime, float WallReach, float PathWear, Area[] Churches, Path[] Paths, Spot[] Mud);
    public sealed record Thing(string Id, string Kind, float[] At, float Yaw, float Scale = 1, float[]? Size = null, int Seed = 0, float Lift = 0);
    public sealed record Plan(string Note, GroundPlan Ground, Thing[] Things, PavingPlan? Paving = null);

    /// <summary>A stretch of a standing house's wall that a razed house stood against.</summary>
    public sealed record BaredWall(int Standing, int Razed, Vector2 A, Vector2 B, Vector2 Out, float StandingHeight, float RazedHeight, int Storeys, float Rise, int Seed)
    {
        /// <summary>The house's chimney breast and its rooms' paper: on the longest stretch it shared with this neighbour, 3 m or more.</summary>
        public bool Flue { get; init; }
    }

    private sealed record House(int Index, Vector2[] Outline, bool Razed, bool Gone, JsonElement Data);

    public static Plan? Read()
    {
        if (!Godot.FileAccess.FileExists(File)) return null;
        return JsonSerializer.Deserialize<Plan>(Godot.FileAccess.GetFileAsString(File), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }

    // ------------------------------------------------------------------ the ground

    /// <summary>
    /// The dirt mask drawn again on the cut plots and set as the paving's global picture (any thread: an image and the
    /// rendering server). Returns the pixels drawn.
    /// </summary>
    public static int Ground(Plan plan, NativeRazedHouses.Result razed, string mapsDir)
    {
        if (razed.Razed.Count == 0) return 0;
        string png = System.IO.Path.Combine(mapsDir, "dirt.png"), box = System.IO.Path.Combine(mapsDir, "dirt.json");
        if (!System.IO.File.Exists(png) || !System.IO.File.Exists(box)) return 0;
        var b = JsonDocument.Parse(System.IO.File.ReadAllText(box)).RootElement;
        float x0 = b.GetProperty("x0").GetSingle(), z0 = b.GetProperty("z0").GetSingle(), w = b.GetProperty("w").GetSingle(), h = b.GetProperty("h").GetSingle();
        var image = Image.LoadFromFile(png);
        image.Convert(Image.Format.Rgba8);
        int iw = image.GetWidth(), ih = image.GetHeight();
        float px = w / iw, pz = h / ih;
        var g = plan.Ground;
        var cut = razed.Razed;
        var standing = razed.Standing;
        var churches = g.Churches.Select(c => c.Outline.Select(p => new Vector2(p[0], p[1])).ToArray()).ToList();
        int drawn = 0;
        foreach (var outline in cut)
        {
            // the plot and a metre round it (where it meets the street, the new drawing fades into the old)
            float ox0 = outline.Min(p => p.X) - 1.2f, ox1 = outline.Max(p => p.X) + 1.2f, oz0 = outline.Min(p => p.Y) - 1.2f, oz1 = outline.Max(p => p.Y) + 1.2f;
            int i0 = Math.Max(0, (int)((ox0 - x0) / px)), i1 = Math.Min(iw - 1, (int)((ox1 - x0) / px));
            int j0 = Math.Max(0, (int)((oz0 - z0) / pz)), j1 = Math.Min(ih - 1, (int)((oz1 - z0) / pz));
            var nearWalls = standing.Where(s => Near(s, ox0 - 4, oz0 - 4, ox1 + 4, oz1 + 4)).Concat(churches.Where(c => Near(c, ox0 - 4, oz0 - 4, ox1 + 4, oz1 + 4))).ToList();
            for (int j = j0; j <= j1; j++)
                for (int i = i0; i <= i1; i++)
                {
                    var q = new Vector2(x0 + (i + 0.5f) * px, z0 + (j + 0.5f) * pz);
                    // (inside a standing house or a church: not ground)
                    if (standing.Any(s => Inside(s, q)) || churches.Any(c => Inside(c, q))) continue;
                    float inPlot = Inside(outline, q) ? 1 : 1 - Math.Clamp(EdgeDistance(outline, q) / 1.2f, 0, 1);
                    if (inPlot <= 0) continue;
                    // (a pixel another cut plot already drew fully stays as drawn)
                    if (!Inside(outline, q) && cut.Any(o => o != outline && Inside(o, q))) continue;
                    var old = image.GetPixel(i, j);
                    float wall = nearWalls.Count == 0 ? 99 : nearWalls.Min(s => EdgeDistance(s, q));
                    float n = Noise(q * 0.9f) * 0.6f + Noise(q * 2.7f + new Vector2(17, 3)) * 0.4f;
                    float r = g.Base * (0.65f + 0.7f * n);
                    // grime and mud along a standing wall's foot (splash, runoff, sweepings left against it)
                    r = Math.Max(r, g.WallGrime * (1 - Math.Clamp(wall / g.WallReach, 0, 1)) * (0.75f + 0.5f * n));
                    float wear = 0.12f + 0.1f * n;
                    foreach (var path in g.Paths)
                    {
                        float d = PathDistance(path, q);
                        float k = 1 - Math.Clamp((d - path.Width * 0.3f) / (path.Width * 0.5f), 0, 1);
                        if (k <= 0) continue;
                        r *= 1 - 0.6f * k;
                        wear = Math.Max(wear, g.PathWear * k);
                    }
                    foreach (var spot in g.Mud)
                    {
                        float d = q.DistanceTo(new Vector2(spot.At[0], spot.At[1]));
                        if (d >= spot.Radius) continue;
                        float k = 1 - d / spot.Radius;
                        k = k * k * (3 - 2 * k) * (0.7f + 0.6f * Noise(q * 1.9f + new Vector2(5, 11)));
                        r = Math.Max(r, spot.Mud * Math.Clamp(k, 0, 1));
                    }
                    r = Math.Clamp(r, 0, 1); wear = Math.Clamp(wear, 0, 1);
                    float nr = Mathf.Lerp(old.R, r, inPlot), ng = Mathf.Lerp(old.G, wear, inPlot);
                    image.SetPixel(i, j, new Color(nr, ng, nr, old.A));
                    drawn++;
                }
        }
        // the mended patches: earth in their joints (the old paving under them reads only as the dark between the setts)
        var lay = Laid = Lay(plan, razed);
        foreach (var p in lay.Patches)
        {
            var n = new Vector2(-p.Along.Y, p.Along.X);
            float reach = (p.Length + p.Depth) / 2 + 0.5f;
            int i0 = Math.Max(0, (int)((p.At.X - reach - x0) / px)), i1 = Math.Min(iw - 1, (int)((p.At.X + reach - x0) / px));
            int j0 = Math.Max(0, (int)((p.At.Y - reach - z0) / pz)), j1 = Math.Min(ih - 1, (int)((p.At.Y + reach - z0) / pz));
            for (int j = j0; j <= j1; j++)
                for (int i = i0; i <= i1; i++)
                {
                    var q = new Vector2(x0 + (i + 0.5f) * px, z0 + (j + 0.5f) * pz) - p.At;
                    if (Math.Abs(q.Dot(p.Along)) > p.Length / 2 + 0.1f || Math.Abs(q.Dot(n)) > p.Depth / 2 + 0.1f) continue;
                    var old = image.GetPixel(i, j);
                    float r = Math.Max(old.R, 0.6f);
                    image.SetPixel(i, j, new Color(r, old.G, r, old.A));
                }
        }
        // the hollows the water stands in when it rains (the dirt mask's alpha: 1 - how deep; the ground shader's puddles
        // fill them first): beside the patches where the trench's fill settled, at the pump and in the carts' ruts
        foreach (var hole in lay.Hollows)
        {
            var at = new Vector2(hole.At[0], hole.At[1]);
            float reach = hole.Radius * 1.3f + px;
            int i0 = Math.Max(0, (int)((at.X - reach - x0) / px)), i1 = Math.Min(iw - 1, (int)((at.X + reach - x0) / px));
            int j0 = Math.Max(0, (int)((at.Y - reach - z0) / pz)), j1 = Math.Min(ih - 1, (int)((at.Y + reach - z0) / pz));
            for (int j = j0; j <= j1; j++)
                for (int i = i0; i <= i1; i++)
                {
                    var q = new Vector2(x0 + (i + 0.5f) * px, z0 + (j + 0.5f) * pz);
                    float k = 1 - q.DistanceTo(at) / (hole.Radius * (0.85f + 0.3f * Noise(q * 1.7f + new Vector2(hole.Radius * 13, 5))));
                    if (k <= 0) continue;
                    float deep = hole.Mud * k * k * (3 - 2 * k);
                    var old = image.GetPixel(i, j);
                    image.SetPixel(i, j, new Color(old.R, old.G, old.B, Math.Min(old.A, 1 - deep)));
                }
        }
        var texture = ImageTexture.CreateFromImage(image);
        Dirt = texture;
        RenderingServer.GlobalShaderParameterSet("psx_dirt", texture.GetRid());
        return drawn;
    }
    /// <summary>The redrawn mask (kept alive while the town is).</summary>
    public static ImageTexture? Dirt { get; private set; }

    private static float PathDistance(Path path, Vector2 q)
    {
        float best = float.MaxValue;
        for (int i = 1; i < path.Points.Length; i++)
        {
            var a = new Vector2(path.Points[i - 1][0], path.Points[i - 1][1]); var b = new Vector2(path.Points[i][0], path.Points[i][1]);
            var ab = b - a; float t = ab.LengthSquared() < 1e-6f ? 0 : Math.Clamp((q - a).Dot(ab) / ab.LengthSquared(), 0, 1);
            best = Math.Min(best, q.DistanceTo(a + ab * t));
        }
        return best;
    }

    // ------------------------------------------------------------------ the bared walls

    /// <summary>The stretches of standing walls the cut houses stood against (city_build.json's outlines).</summary>
    public static List<BaredWall> Bared(NativeRazedHouses.Result razed, string cityBuildPath)
    {
        var result = new List<BaredWall>();
        if (razed.Razed.Count == 0 || !System.IO.File.Exists(cityBuildPath)) return result;
        using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(cityBuildPath));
        var houses = new List<House>();
        int index = 0;
        foreach (var h in doc.RootElement.GetProperty("houses").EnumerateArray())
        {
            int i = index++;
            if (!h.TryGetProperty("fp", out var fp) || fp.GetArrayLength() < 3) continue;
            bool gone = h.TryGetProperty("gone", out var gv) && gv.ValueKind == JsonValueKind.True;
            bool isRazed = h.TryGetProperty("razed", out var rv) && rv.ValueKind == JsonValueKind.True;
            houses.Add(new House(i, fp.EnumerateArray().Select(q => new Vector2((float)q[0].GetDouble(), (float)q[1].GetDouble())).ToArray(), isRazed, gone, h.Clone()));
        }
        // only the houses that were cut (one whose alpha a neighbour shares stands as baked)
        var cut = houses.Where(h => h.Razed && razed.Razed.Any(o => o.Length == h.Outline.Length && o[0].DistanceTo(h.Outline[0]) < 0.01f)).ToList();
        var standing = houses.Where(h => !h.Gone).ToList();
        foreach (var r in cut)
        {
            float rh = r.Data.GetProperty("h").GetSingle();
            int st = r.Data.TryGetProperty("st", out var sv) ? sv.GetInt32() : 3;
            int seed = r.Data.TryGetProperty("seed", out var sd) ? (int)(sd.GetInt64() & 0x7fffffff) : r.Index;
            string roof = r.Data.TryGetProperty("roof", out var rf) ? rf.GetString() ?? "" : "";
            bool rect = r.Data.TryGetProperty("rect", out var rc) && rc.ValueKind == JsonValueKind.True;
            Vector2? ridge = null;
            if (rect && roof is "side" or "front")
            {
                var u = r.Data.GetProperty(roof == "side" ? "u" : "n");
                ridge = new Vector2(u[0].GetSingle(), u[1].GetSingle());
            }
            float pitch = r.Data.TryGetProperty("pitch", out var pv) ? pv.GetSingle() : 45;
            var centre = r.Outline.Aggregate(Vector2.Zero, (s, p) => s + p) / r.Outline.Length;
            foreach (var s in standing.Where(s => Near(s.Outline, r.Outline, 0.6f)))
            {
                float sh = s.Data.GetProperty("h").GetSingle();
                for (int i = 0; i < s.Outline.Length; i++)
                {
                    Vector2 a = s.Outline[(i + s.Outline.Length - 1) % s.Outline.Length], b = s.Outline[i];
                    float len = a.DistanceTo(b);
                    if (len < 0.5f) continue;
                    var u = (b - a) / len;
                    for (int k = 0; k < r.Outline.Length; k++)
                    {
                        Vector2 c = r.Outline[(k + r.Outline.Length - 1) % r.Outline.Length], d = r.Outline[k];
                        float tc = (c - a).Dot(u), td = (d - a).Dot(u), nc = u.Cross(c - a), nd = u.Cross(d - a);
                        if (Math.Abs(nc) > 0.45f || Math.Abs(nd) > 0.45f) continue;
                        float lo = Math.Max(0, Math.Min(tc, td)), hi = Math.Min(len, Math.Max(tc, td));
                        if (hi - lo < 1.0f) continue;
                        var p0 = a + u * (lo + 0.05f); var p1 = a + u * (hi - 0.05f);
                        var outward = new Vector2(-u.Y, u.X);
                        if ((centre - (p0 + p1) / 2).Dot(outward) < 0) outward = -outward;
                        // the gable's rise where the razed house's ridge crossed this wall (build_city.py GONE_EDGES, gone_along)
                        float rise = 0;
                        float rl = c.DistanceTo(d);
                        if (ridge is { } rd && rl > 0.5f && Math.Abs(((d - c) / rl).Dot(rd)) < 0.3f)
                            rise = MathF.Tan(Mathf.DegToRad(pitch)) * rl / 2 * (hi - lo) / Math.Max(0.1f, Math.Abs(td - tc));
                        result.Add(new BaredWall(s.Index, r.Index, p0, p1, outward, sh, rh, st, rise, seed));
                    }
                }
            }
        }
        // one chimney breast per pulled-down house on each neighbour: the longest stretch they shared, if a room fits on it
        return result.GroupBy(w => (w.Standing, w.Razed)).SelectMany(g =>
        {
            var longest = g.MaxBy(w => w.A.DistanceTo(w.B))!;
            return g.Select(w => w == longest && w.A.DistanceTo(w.B) >= 3f ? w with { Flue = true } : w);
        }).ToList();
    }

    // the grime decal atlas's cells (build_city.py: RUST, SOOT, DAMP, CORNER, BLOB; GHOST, LINE, SCRAP)
    private static readonly Vector2 Rust = new(0, 0), Soot = new(1, 0), Damp = new(2, 0), Blob = new(0, 1), Ghost = new(1, 1), LineCell = new(2, 1), Scrap = new(3, 1);
    // The decal is multiplied over the lit wall (Grime.DecalShader, #188): its colour is read against 0.55, so a tint over
    // 0.55 lightens (the old plaster on dark brick) and under it darkens (soot, the lines).
    private static readonly Color GhostTint = new(0.86f, 0.8f, 0.66f), LineTint = new(0.06f, 0.055f, 0.05f), SootTint = new(0.02f, 0.018f, 0.016f),
        RustTint = new(0.2f, 0.065f, 0.018f), DampTint = new(0.06f, 0.07f, 0.04f),
        MottleTint = new(0.3f, 0.28f, 0.25f);
    // (washed-out papers, Codex's #898875 and its kin: what is left of a room's paper after a summer of rain)
    private static readonly Color[] Wallpaper = { new(0.66f, 0.56f, 0.48f), new(0.56f, 0.6f, 0.5f), new(0.55f, 0.57f, 0.6f), new(0.7f, 0.66f, 0.52f), new(0.63f, 0.56f, 0.56f) };
    private const float GroundH = 3.8f, StoreyH = 3.0f, BaredWear = 0.82f;

    /// <summary>
    /// The bared walls: their facade triangles given the old brick picture, then the ghost decals and the iron anchors laid
    /// on them (before collision and navigation read the meshes; any thread: nodes and resources only).
    /// </summary>
    public static (int Walls, int Bricked, int Decals, int Anchors) Walls(Node3D town, List<BaredWall> walls)
    {
        if (walls.Count == 0) return (0, 0, 0, 0);
        int bricked = Brick(town, walls);
        var decal = ResourceLoader.Load<Material>(GrimeDecalMaterial);
        var iron = ResourceLoader.Load<Material>(IronMaterial);
        int quads = 0, anchors = 0;
        var holder = new Node3D { Name = "square_walls" };
        holder.SetMeta(Meta, true);
        town.AddChild(holder);
        // (a set of meshes for each 60 m of the town: the visibility range is measured to a mesh's middle, and one mesh
        // over all the squares had its middle far from each)
        foreach (var area in walls.GroupBy(w => ((int)MathF.Floor((w.A.X + w.B.X) / 120), (int)MathF.Floor((w.A.Y + w.B.Y) / 120))))
        {
            var st = new SurfaceTool(); st.Begin(Mesh.PrimitiveType.Triangles);
            var ir = new SurfaceTool(); ir.Begin(Mesh.PrimitiveType.Triangles);
            var pl = Begin();
            int q0 = 0, a0 = 0;
            foreach (var w in area)
            {
                var (q, a) = GhostMarks(st, ir, pl, w);
                q0 += q; a0 += a;
            }
            string tag = $"{area.Key.Item1}_{area.Key.Item2}";
            if (q0 > 0)
            {
                st.SetMaterial(decal);
                holder.AddChild(new MeshInstance3D
                {
                    Name = "ghosts_" + tag, Mesh = st.Commit(), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                    VisibilityRangeEnd = 160, VisibilityRangeEndMargin = 20, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
                });
                var coat = Commit(pl, ResourceLoader.Load<Material>(FacadeMaterial), "plaster_" + tag, normals: false);
                coat.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
                coat.VisibilityRangeEnd = 160; coat.VisibilityRangeEndMargin = 20; coat.VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self;
                holder.AddChild(coat);
            }
            if (a0 > 0)
            {
                ir.SetMaterial(iron);
                ir.GenerateNormals();
                holder.AddChild(new MeshInstance3D
                {
                    Name = "anchors_" + tag, Mesh = ir.Commit(), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                    VisibilityRangeEnd = 70, VisibilityRangeEndMargin = 10, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
                });
            }
            quads += q0; anchors += a0;
        }
        foreach (var n in holder.GetChildren()) ((Node)n).SetMeta(Meta, true);
        return (walls.Count, bricked, quads, anchors);
    }

    /// <summary>build_city.py ghost_marks, at runtime: one bared stretch's ghost (decal quads) and anchors (iron).</summary>
    private static (int Quads, int Anchors) GhostMarks(SurfaceTool st, SurfaceTool iron, SurfaceTool plaster, BaredWall w)
    {
        float L = w.A.DistanceTo(w.B);
        var u = (w.B - w.A) / L;
        Vector3 W(float s, float y, float d) { var p = w.A + u * s + w.Out * d; return new Vector3(p.X, y, p.Y); }
        var rng = new Random(w.Seed * 7 + 3 + w.Standing);
        float cap = w.StandingHeight - 0.35f;
        float hg = Math.Min(w.RazedHeight, cap);
        if (hg < 2.5f) return (0, 0);
        float s0 = 0, s1 = L, mid = L / 2;
        int quads = 0;
        // the outline: up to its eaves, and its gable over them (cut off under this house's own top)
        var pts = new List<Vector2> { new(s0, 0.2f), new(s1, 0.2f), new(s1, hg) };
        if (w.Rise > 0.3f)
        {
            float apex = hg + w.Rise;
            if (apex <= cap) pts.Add(new Vector2(mid, apex));
            else { float k = (cap - hg) / w.Rise; pts.Add(new Vector2(s1 - (s1 - mid) * k, cap)); pts.Add(new Vector2(s0 + (mid - s0) * k, cap)); }
        }
        pts.Add(new Vector2(s0, hg));
        // a thin film of lime over the old house's outline (a fan from its first corner, the outline is convex; the ghost
        // cell's film, a quarter, tiling every 2.3 m): faint, the brick under it only greyed
        for (int i = 1; i + 1 < pts.Count; i++)
            Tri(st, W(pts[0].X, pts[0].Y, 0.006f), W(pts[i].X, pts[i].Y, 0.006f), W(pts[i + 1].X, pts[i + 1].Y, 0.006f),
                pts[0] / 2.3f, pts[i] / 2.3f, pts[i + 1] / 2.3f, Ghost, GhostTint, 0.5f);
        quads++;
        // where its chimney breast stood against the wall (the flue's soot, its fireplaces, no plaster: the breast was
        // pulled down with the house and left a rough band of brick)
        float fs = s0 + (s1 - s0) * (0.35f + 0.3f * (float)rng.NextDouble());
        // the roof's slope over the wall (its gable), and where it is cut off under this house's own top
        float Roof(float x) => w.Rise > 0.3f ? Math.Min(cap, hg + w.Rise * Math.Max(0, 1 - Math.Abs(x - mid) / Math.Max(0.1f, (s1 - s0) / 2))) : hg;
        float slope = w.Rise > 0.3f ? w.Rise / Math.Max(0.1f, (s1 - s0) / 2) : 0;
        // each room's plaster left on the wall (Room, Coat): a coat 20 mm proud of the brick, its edges straight where the
        // floor, the ceiling, the front and back walls and a partition met it, broken where it fell; the town's dirty old
        // render picture (or the ochre plaster's), each room its own limewash or distemper, grimed by its stove and the rain
        var levels = Enumerable.Range(0, Math.Max(1, w.Storeys) - 1).Select(k => GroundH + k * StoreyH).Where(y => y < hg - 0.5f).Prepend(0f).ToList();
        var rooms = new List<Room>();
        for (int f = 0; f < levels.Count; f++)
        {
            // (the skirting board came off with the floor: the coat stops a hand over it; the ceiling's lath and plaster
            // hung under the joists: the coat stops under them)
            float y0 = levels[f] + (f == 0 ? 0.28f : 0.17f), y1 = (f + 1 < levels.Count ? levels[f + 1] : hg) - 0.26f;
            float x0 = s0 + 0.14f, x1 = s1 - 0.14f;
            if (y1 - y0 < 0.8f || x1 - x0 < 0.8f) continue;
            // (a room in eight lost all of it)
            if (rng.NextDouble() < 0.12) continue;
            float ceil = y1;
            rooms.Add(NewRoom(rng, x0, x1, y0, _ => ceil, f == 0 ? y0 + 0.5f + 0.7f * (float)rng.NextDouble() : 0, w.Flue ? fs : float.NaN, false));
        }
        // the attic under the roof's slope: limewashed now and then, its top the rafters' line
        if (w.Rise > 0.6f && rng.NextDouble() < 0.3)
        {
            float y0 = hg + 0.12f;
            float half = (s1 - s0) / 2 * Math.Clamp(1 - (y0 + 0.5f - hg) / w.Rise, 0, 1);
            if (half > 0.6f)
                rooms.Add(NewRoom(rng, mid - half, mid + half, y0, x => Roof(x) - 0.2f, 0, w.Flue ? fs : float.NaN, true, slope));
        }
        foreach (var room in rooms)
        {
            Coat(plaster, W, room);
            // its grime: the ghost cell's mottle (a film of specks and scratches) multiplied dark over the coat and the
            // brick its losses bare, every 1.1 m, each room its own place in it
            float roomTop = Enumerable.Range(0, 5).Max(k => room.Top(room.X0 + (room.X1 - room.X0) * k / 4f));
            var o = new Vector2(room.Ph % 1, room.Ph * 0.37f % 1);
            Quad(st, W(room.X0, room.Y0, CoatT + 0.0016f), W(room.X1, room.Y0, CoatT + 0.0016f), W(room.X1, roomTop, CoatT + 0.0016f), W(room.X0, roomTop, CoatT + 0.0016f),
                new Vector2(room.X0, room.Y0) / 1.1f + o, new Vector2(room.X1, room.Y0) / 1.1f + o, new Vector2(room.X1, roomTop) / 1.1f + o, new Vector2(room.X0, roomTop) / 1.1f + o, Ghost, MottleTint, 0.85f);
            quads += 2;
        }
        // the roof's line: a dark band along the outline's top (the old flashing and the rafters' ends)
        var top = pts.Skip(2).ToList();
        for (int i = 0; i + 1 < top.Count; i++)
        {
            var (p, q) = (top[i], top[i + 1]);
            float ln = Math.Max(0.1f, p.DistanceTo(q)) / 1.5f;
            Quad(st, W(p.X, p.Y - 0.18f, 0.008f), W(q.X, q.Y - 0.18f, 0.008f), W(q.X, q.Y + 0.06f, 0.008f), W(p.X, p.Y + 0.06f, 0.008f),
                new(0, 0.01f), new(ln, 0.01f), new(ln, 0.99f), new(0, 0.99f), LineCell, LineTint, 1);
            quads++;
        }
        // its floors: a dark line where each floor's joists sat in the wall
        var floors = Enumerable.Range(0, Math.Max(1, w.Storeys) - 1).Select(k => GroundH + k * StoreyH).Where(y => y < hg - 0.5f).ToList();
        foreach (float y in floors)
        {
            Quad(st, W(s0 + 0.1f, y - 0.16f, 0.008f), W(s1 - 0.1f, y - 0.16f, 0.008f), W(s1 - 0.1f, y + 0.1f, 0.008f), W(s0 + 0.1f, y + 0.1f, 0.008f),
                new(0, 0.01f), new((s1 - s0) / 1.5f, 0.01f), new((s1 - s0) / 1.5f, 0.99f), new(0, 0.99f), LineCell, LineTint, 1);
            quads++;
            // the joists' pockets along it, 0.4 m apart, each a dark socket where a joist end was pulled out
            for (float js = s0 + 0.35f; js < s1 - 0.3f; js += 0.4f)
            {
                Quad(st, W(js - 0.06f, y - 0.14f, 0.0085f), W(js + 0.06f, y - 0.14f, 0.0085f), W(js + 0.06f, y + 0.04f, 0.0085f), W(js - 0.06f, y + 0.04f, 0.0085f),
                    new(0.15f, 0.15f), new(0.85f, 0.15f), new(0.85f, 0.85f), new(0.15f, 0.85f), Blob, SootTint, 1);
                quads++;
            }
        }
        // its chimney breast: a band of brick blackened by the smoke where the breast stood, the flue's soot up its middle,
        // a fireplace's soot on every floor (only on a stretch wide enough for a room)
        if (w.Flue)
        {
            float flTop = Roof(fs);
            Quad(st, W(fs - Breast, 0.3f, 0.0078f), W(fs + Breast, 0.3f, 0.0078f), W(fs + Breast, flTop, 0.0078f), W(fs - Breast, flTop, 0.0078f),
                new(0.1f, 0.2f), new(0.9f, 0.2f), new(0.9f, 0.8f), new(0.1f, 0.8f), Soot, SootTint, 0.45f);
            Quad(st, W(fs - 0.24f, 0.9f, 0.0082f), W(fs + 0.24f, 0.9f, 0.0082f), W(fs + 0.24f, flTop, 0.0082f), W(fs - 0.24f, flTop, 0.0082f),
                new(0.2f, 0.3f), new(0.8f, 0.3f), new(0.8f, 0.7f), new(0.2f, 0.7f), Soot, SootTint, 1);
            quads += 2;
            foreach (float y in floors.Prepend(0f))
            {
                Quad(st, W(fs - 0.55f, y + 0.1f, 0.0086f), W(fs + 0.55f, y + 0.1f, 0.0086f), W(fs + 0.55f, y + 1.4f, 0.0086f), W(fs - 0.55f, y + 1.4f, 0.0086f),
                    new(0.01f, 0.01f), new(0.99f, 0.01f), new(0.99f, 0.99f), new(0.01f, 0.99f), Soot, SootTint, 1);
                quads++;
            }
        }
        // a scrap of wallpaper on half the coats, where the coat is whole round it, each room its own paper (faded: read
        // only near the wall's own tone)
        foreach (var room in rooms.Where(r => !r.Attic))
        {
            var paper = Wallpaper[rng.Next(Wallpaper.Length)];
            if (rng.NextDouble() >= 0.55) continue;
            float pw = 0.35f + 0.55f * (float)rng.NextDouble(), ph = 0.45f + 0.65f * (float)rng.NextDouble();
            for (int tries = 0; tries < 8; tries++)
            {
                float c = room.X0 + pw / 2 + (room.X1 - room.X0 - pw) * (float)rng.NextDouble();
                float yy = room.Y0 + 0.3f + (room.Top(c) - room.Y0 - ph - 0.5f) * (float)rng.NextDouble();
                var corners = new[] { new Vector2(c - pw / 2, yy), new Vector2(c + pw / 2, yy), new Vector2(c + pw / 2, yy + ph), new Vector2(c - pw / 2, yy + ph), new Vector2(c, yy + ph / 2) };
                if (corners.Any(p => room.Field(p) < 0.06f)) continue;
                Quad(st, W(c - pw / 2, yy, CoatT + 0.0012f), W(c + pw / 2, yy, CoatT + 0.0012f), W(c + pw / 2, yy + ph, CoatT + 0.0012f), W(c - pw / 2, yy + ph, CoatT + 0.0012f),
                    new(0.01f, 0.01f), new(0.99f, 0.01f), new(0.99f, 0.99f), new(0.01f, 0.99f), Scrap, paper, 0.8f);
                quads++;
                break;
            }
        }
        // damp rising at the foot, where the house's floor kept the wall dry and now the rain splashes on it (over the
        // coats too)
        Quad(st, W(s0, 0.0f, CoatT + 0.0022f), W(s1, 0.0f, CoatT + 0.0022f), W(s1, 1.1f, CoatT + 0.0022f), W(s0, 1.1f, CoatT + 0.0022f),
            new(0, 0.01f), new(L / 1.4f, 0.01f), new(L / 1.4f, 0.99f), new(0, 0.99f), Damp, DampTint, 1);
        quads++;
        // and the rain run down the bared wall from its top since the summer: a streaked stain or two over brick and coats
        for (int k = 0, runs = 1 + (int)(L / 4f); k < runs; k++)
        {
            float rs = s0 + 0.3f + (L - 0.6f) * (float)rng.NextDouble(), rw = 0.5f + 0.7f * (float)rng.NextDouble();
            float rt = hg - 0.1f, rb = Math.Max(0.5f, hg * (0.3f + 0.4f * (float)rng.NextDouble()));
            Quad(st, W(rs - rw / 2, rb, CoatT + 0.0024f), W(rs + rw / 2, rb, CoatT + 0.0024f), W(rs + rw / 2, rt, CoatT + 0.0024f), W(rs - rw / 2, rt, CoatT + 0.0024f),
                new(0.01f, 0.99f), new(0.99f, 0.99f), new(0.99f, 0.01f), new(0.01f, 0.01f), Damp, new Color(0.16f, 0.15f, 0.13f), 0.8f);
            quads++;
        }
        // the iron anchors of its beams, left in the wall, each with its rust run
        int anchors = 0;
        if (L >= 2.0f)
            foreach (float y in floors)
                foreach (float s in new[] { s0 + 0.7f, s1 - 0.7f })
                {
                    Anchor(iron, W, s, y);
                    Quad(st, W(s - 0.09f, y - 0.95f, 0.009f), W(s + 0.09f, y - 0.95f, 0.009f), W(s + 0.09f, y + 0.02f, 0.009f), W(s - 0.09f, y + 0.02f, 0.009f),
                        new(0.01f, 0.01f), new(0.99f, 0.01f), new(0.99f, 0.99f), new(0.01f, 0.99f), Rust, RustTint, 1);
                    anchors++; quads++;
                }
        return (quads, anchors);
    }

    // The coats (Room, Coat): 20 mm of old lime plaster on the brick, a 4 mm broken lip, the broken face slanting 6 mm out
    // to the brick; the town's render picture (dirty grey lime with its own cracks and stains) or, a room in four, the
    // ochre plaster's; drawn on a 10 cm grid (marching squares), so each vertex takes its own grime.
    private const float CoatT = 0.02f, CoatLip = 0.004f, CoatSpread = 0.006f, CoatGrid = 0.08f, Breast = 0.6f;
    private const int PlasterPicture = 9, RenderPicture = 10;
    // the rooms' old limewash and distemper over the render picture: a grey-ochre, a faded blue-green, a dirty pink, a
    // lime grey, a buff, a green-grey (Codex: low against the brick, darkened by a summer's rain and the town's smoke)
    private static readonly Color[] Distemper = { new(0.39f, 0.34f, 0.25f), new(0.27f, 0.34f, 0.325f), new(0.39f, 0.29f, 0.27f), new(0.34f, 0.335f, 0.32f), new(0.39f, 0.345f, 0.27f), new(0.29f, 0.335f, 0.28f) };
    // (over the ochre plaster picture, already warm: plain greys)
    private static readonly Color[] OchreWash = { new(0.33f, 0.32f, 0.31f), new(0.3f, 0.31f, 0.31f) };

    /// <summary>One room's coat on a bared wall, in the wall's own frame (s along it from its first end, y up; metres).</summary>
    private sealed class Room
    {
        public float X0, X1, Y0, Damp, Flue = float.NaN, Chase = float.NaN, Thr, Ph, Slope;
        public Func<float, float> Top = _ => 0;
        public Color Wash;
        public int Picture;
        public bool Attic;

        /// <summary>
        /// Over 0 on the coat: how far (metres) to its nearest straight edge (floor, ceiling or rafters, the front and back
        /// walls, a partition's chase, the chimney breast), cut by where it fell off.
        /// </summary>
        public float Field(Vector2 p)
        {
            float top = (Top(p.X) - p.Y) / MathF.Sqrt(1 + Slope * Slope);
            float d = Math.Min(Math.Min(p.X - X0, X1 - p.X), Math.Min(p.Y - Y0, top));
            if (!float.IsNaN(Chase)) d = Math.Min(d, Math.Abs(p.X - Chase) - 0.06f);
            if (!float.IsNaN(Flue)) d = Math.Min(d, Math.Abs(p.X - Flue) - Breast - 0.02f);
            // where it fell: a warped noise in three octaves over the room's own threshold (big sheets, their broken edge
            // chipped); a little more near an edge, where the coat was weakest, and on the ground floor under its damp line
            var q = p + new Vector2(Ph, Ph * 0.37f);
            var warp = new Vector2(Noise(q / 1.3f), Noise(q / 1.3f + new Vector2(41, 7))) - new Vector2(0.5f, 0.5f);
            float n = Noise((q + warp * 1.1f) / 0.9f) * 0.47f + Noise(q / 0.3f + new Vector2(13, 5)) * 0.33f + Noise(q / 0.1f + new Vector2(3, 29)) * 0.2f;
            float thr = Thr - 0.07f * MathF.Exp(-Math.Max(0, d) / 0.25f);
            if (Damp > 0 && p.Y < Damp) thr -= 0.3f * Math.Clamp((Damp - p.Y) / 0.5f, 0, 1);
            return Math.Min(d, (thr - n) * 0.9f);
        }

        /// <summary>
        /// The coat's colour here (alpha the wear, kept under 0.55 where the shader would knock its own holes): the room's
        /// wash in blotches, rain runs down it, the smoke of its stove and lamps under the ceiling, the flue's soot beside
        /// the breast, dirt along its foot.
        /// </summary>
        public Color Tone(Vector2 p, float k = 1)
        {
            var q = p + new Vector2(Ph * 1.7f, Ph);
            float m = 1.1f * (0.76f + 0.48f * Noise(q / 1.05f)) * (0.9f + 0.2f * Noise(q / 0.21f + new Vector2(9, 2)));
            m *= 1 - 0.2f * SmoothStep(0.55f, 0.88f, Noise(new Vector2(q.X / 0.17f, q.Y / 2.8f)));
            m *= 1 + 0.08f * SmoothStep(0.6f, 0.9f, Noise(new Vector2(q.X / 0.4f + 17, q.Y / 3.5f)));
            m *= 1 - 0.3f * Math.Clamp(1 - (Top(p.X) - p.Y) / 0.8f, 0, 1);
            m *= 1 - 0.22f * Math.Clamp(1 - (p.Y - Y0) / 0.4f, 0, 1);
            if (!float.IsNaN(Flue)) m *= 1 - 0.4f * MathF.Exp(-Math.Max(0, Math.Abs(p.X - Flue) - Breast) / 0.45f);
            m *= k;
            return new Color(Wash.R * m, Wash.G * m, Wash.B * m, 0.5f);
        }
    }

    private static float SmoothStep(float a, float b, float x) { float t = Math.Clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

    private static Room NewRoom(Random rng, float x0, float x1, float y0, Func<float, float> top, float damp, float flue, bool attic, float slope = 0)
    {
        bool ochre = rng.NextDouble() < 0.25;
        var wash = attic ? new Color(0.34f, 0.335f, 0.32f) : ochre ? OchreWash[rng.Next(OchreWash.Length)] : Distemper[rng.Next(Distemper.Length)];
        // (each room a little lighter or darker than the next)
        float k = 0.9f + 0.2f * (float)rng.NextDouble();
        return new Room
        {
            X0 = x0, X1 = x1, Y0 = y0, Top = top, Damp = damp, Flue = flue, Slope = slope, Attic = attic,
            // a wide room had a partition against this wall: its chase splits the coat
            Chase = !attic && x1 - x0 > 4.2f ? x0 + (x1 - x0) * (0.35f + 0.3f * (float)rng.NextDouble()) : float.NaN,
            // how much of it held: most rooms lost a quarter to a half (the attic's thin wash more)
            Thr = attic ? 0.44f + 0.08f * (float)rng.NextDouble() : 0.54f + 0.13f * (float)rng.NextDouble(),
            Ph = (float)rng.NextDouble() * 100,
            Picture = ochre && !attic ? PlasterPicture : RenderPicture,
            Wash = new Color(wash.R * k, wash.G * k, wash.B * k),
        };
    }

    /// <summary>
    /// A room's coat on the wall (marching squares over Room.Field on a 10 cm grid): its face 20 mm out, a 4 mm lip at the
    /// broken edge and the broken face slanting back to the brick; each vertex its own grime (Room.Tone).
    /// </summary>
    private static void Coat(SurfaceTool st, Func<float, float, float, Vector3> W, Room r)
    {
        const float H = CoatGrid;
        float topMax = Enumerable.Range(0, 9).Max(k => r.Top(r.X0 + (r.X1 - r.X0) * k / 8f));
        float gx0 = r.X0 - H, gy0 = r.Y0 - H;
        int nx = (int)MathF.Ceiling((r.X1 - r.X0) / H) + 3, ny = (int)MathF.Ceiling((topMax - r.Y0) / H) + 3;
        if (nx < 3 || ny < 3) return;
        var v = new float[nx, ny];
        Vector2 Node(int i, int j) => new(gx0 + i * H, gy0 + j * H);
        for (int i = 0; i < nx; i++)
            for (int j = 0; j < ny; j++)
            {
                float f = r.Field(Node(i, j));
                v[i, j] = Math.Abs(f) < 1e-5f ? -1e-5f : f;
            }
        var origin = W(0, 0, 0);
        var along = W(1, 0, 0) - origin; var outward = (W(0, 0, 1) - origin).Normalized();
        Vector3 Dir(Vector2 o) => along * o.X + Vector3.Up * o.Y;
        // the broken edge's way out of the coat, in the wall's plane
        Vector2 Out(Vector2 p)
        {
            const float e = 0.012f;
            var g = new Vector2(r.Field(p + new Vector2(e, 0)) - r.Field(p - new Vector2(e, 0)), r.Field(p + new Vector2(0, e)) - r.Field(p - new Vector2(0, e)));
            return g.LengthSquared() < 1e-12f ? Vector2.Zero : -g.Normalized();
        }
        var cell = WallCell ?? Vector2.Zero;
        var custom = new Color(r.Picture, 1, 0, 0);
        void E(Vector3 a, Vector3 b, Vector3 c, Color ca, Color cb, Color cc, Vector3 expect, Vector3? normal = null)
        {
            var n = (b - a).Cross(c - a);
            if (n.LengthSquared() < 1e-14f) return;
            if (n.Dot(expect) < 0) { (b, c) = (c, b); (cb, cc) = (cc, cb); n = -n; }
            n = normal ?? n.Normalized();
            // (Godot's front face winds clockwise as seen: a, c, b; wound the other way the two-sided shader turns the
            // normal into the wall and the lights inside the house lit the coat at night)
            foreach (var (p, col) in new[] { (a, ca), (c, cc), (b, cb) })
            {
                st.SetNormal(n); st.SetColor(col); st.SetUV(WallUv); st.SetUV2(cell); st.SetCustom(0, custom); st.AddVertex(p);
            }
        }
        var crossings = new Dictionary<(int, int, int, int), (Vector2 P, Vector2 O)>();
        (Vector2 P, Vector2 O) Cross(int i1, int j1, int i2, int j2)
        {
            if (i2 < i1 || (i2 == i1 && j2 < j1)) (i1, j1, i2, j2) = (i2, j2, i1, j1);
            if (crossings.TryGetValue((i1, j1, i2, j2), out var had)) return had;
            float a = v[i1, j1], b = v[i2, j2];
            var p = Node(i1, j1).Lerp(Node(i2, j2), a / (a - b));
            return crossings[(i1, j1, i2, j2)] = (p, Out(p));
        }
        var pieces = new List<List<(Vector2 P, bool Edge, Vector2 O)>>();
        for (int i = 0; i + 1 < nx; i++)
            for (int j = 0; j + 1 < ny; j++)
            {
                var ci = new[] { (i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1) };
                var inside = ci.Select(c => v[c.Item1, c.Item2] > 0).ToArray();
                if (!inside.Any(b => b)) continue;
                pieces.Clear();
                bool saddle = inside[0] == inside[2] && inside[1] == inside[3] && inside[0] != inside[1];
                if (saddle && r.Field(Node(i, j) + new Vector2(H / 2, H / 2)) <= 0)
                {
                    // two corners apart: a triangle at each
                    for (int k = 0; k < 4; k++)
                    {
                        if (!inside[k]) continue;
                        var (pi, pj) = ci[k]; var (ni, nj) = ci[(k + 1) % 4]; var (bi, bj) = ci[(k + 3) % 4];
                        var x1 = Cross(pi, pj, ni, nj); var x2 = Cross(bi, bj, pi, pj);
                        pieces.Add(new() { (Node(pi, pj), false, Vector2.Zero), (x1.P, true, x1.O), (x2.P, true, x2.O) });
                    }
                }
                else
                {
                    var face = new List<(Vector2 P, bool Edge, Vector2 O)>();
                    for (int k = 0; k < 4; k++)
                    {
                        var (pi, pj) = ci[k]; var (ni, nj) = ci[(k + 1) % 4];
                        if (inside[k]) face.Add((Node(pi, pj), false, Vector2.Zero));
                        if (inside[k] != inside[(k + 1) % 4]) { var x = Cross(pi, pj, ni, nj); face.Add((x.P, true, x.O)); }
                    }
                    pieces.Add(face);
                }
                foreach (var poly in pieces)
                {
                    // the face: corners on the coat, the broken edge's points pulled in by the lip
                    Vector3 F3(int k) { var (p, edge, o) = poly[k]; var q = edge ? p - o * CoatLip : p; return W(q.X, q.Y, CoatT); }
                    for (int k = 1; k + 1 < poly.Count; k++)
                        E(F3(0), F3(k), F3(k + 1), r.Tone(poly[0].P), r.Tone(poly[k].P), r.Tone(poly[k + 1].P), outward, outward);
                    // the broken edge: the lip, then the break slanting out to the brick
                    for (int k = 0; k < poly.Count; k++)
                    {
                        var (p1, e1, o1) = poly[k]; var (p2, e2, o2) = poly[(k + 1) % poly.Count];
                        if (!e1 || !e2) continue;
                        var o = (o1 + o2).Normalized();
                        Vector3 a0 = F3(k), b0 = F3((k + 1) % poly.Count), a1 = W(p1.X, p1.Y, CoatT - CoatLip), b1 = W(p2.X, p2.Y, CoatT - CoatLip);
                        Vector2 q1 = p1 + o1 * CoatSpread, q2 = p2 + o2 * CoatSpread;
                        Vector3 a2 = W(q1.X, q1.Y, 0), b2 = W(q2.X, q2.Y, 0);
                        // (the lip the fresh lime of the break, paler; the broken face in its own shadow)
                        Color t1 = r.Tone(p1, 1.14f), t2 = r.Tone(p2, 1.14f), d1 = r.Tone(p1, 0.55f), d2 = r.Tone(p2, 0.55f);
                        var lip = Dir(o) + outward; var side = Dir(o) + outward * 0.3f;
                        E(a0, b0, b1, t1, t2, t2, lip); E(a0, b1, a1, t1, t2, t1, lip);
                        E(a1, b1, b2, d1, d2, d2, side); E(a1, b2, a2, d1, d2, d1, side);
                    }
                }
            }
    }

    private static void Tri(SurfaceTool st, Vector3 a, Vector3 b, Vector3 c, Vector2 ua, Vector2 ub, Vector2 uc, Vector2 cell, Color tint, float wear)
    {
        var col = new Color(tint.R, tint.G, tint.B, wear);
        // (the bake's decal uvs went through glTF, whose v runs down the picture: v flipped, so the cells stand as there)
        foreach (var (p, uv) in new[] { (a, ua), (b, ub), (c, uc) })
        {
            st.SetColor(col); st.SetUV(new Vector2(uv.X, 1 - uv.Y)); st.SetUV2(cell); st.SetNormal(Vector3.Up); st.AddVertex(p);
        }
    }

    private static void Quad(SurfaceTool st, Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector2 ua, Vector2 ub, Vector2 uc, Vector2 ud, Vector2 cell, Color tint, float wear)
    {
        Tri(st, a, b, c, ua, ub, uc, cell, tint, wear);
        Tri(st, a, c, d, ua, uc, ud, cell, tint, wear);
    }

    /// <summary>
    /// A wall anchor: the forged end of an iron tie to a floor beam, an upright bar 0.55 m long and 50 x 20 mm with 3 mm
    /// chamfers, a round boss over its middle where the tie comes through (8 sides, chamfered), 1-4 mm edges as cast iron.
    /// </summary>
    private static void Anchor(SurfaceTool st, Func<float, float, float, Vector3> W, float s, float y)
    {
        var col = new Color(0.42f, 0.4f, 0.37f);
        void Prism(Vector2[] ring, float d0, float d1, float ch)
        {
            // a ring (s, y on the wall) pushed out from d0 to d1, its front edge chamfered by ch
            int n = ring.Length;
            var centre = ring.Aggregate(Vector2.Zero, (a, p) => a + p) / n;
            var inside = W(centre.X, centre.Y, (d0 + d1) / 2);
            var inner = ring.Select(p => p + (centre - p).Normalized() * ch).ToArray();
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                Face(st, col, inside, W(ring[i].X, ring[i].Y, d0), W(ring[j].X, ring[j].Y, d0), W(ring[j].X, ring[j].Y, d1 - ch), W(ring[i].X, ring[i].Y, d1 - ch));
                Face(st, col, inside, W(ring[i].X, ring[i].Y, d1 - ch), W(ring[j].X, ring[j].Y, d1 - ch), W(inner[j].X, inner[j].Y, d1), W(inner[i].X, inner[i].Y, d1));
            }
            for (int i = 1; i + 1 < n; i++) Face3(st, col, inside, W(inner[0].X, inner[0].Y, d1), W(inner[i].X, inner[i].Y, d1), W(inner[i + 1].X, inner[i + 1].Y, d1));
        }
        Prism(new[] { new Vector2(s - 0.025f, y - 0.275f), new Vector2(s + 0.025f, y - 0.275f), new Vector2(s + 0.025f, y + 0.275f), new Vector2(s - 0.025f, y + 0.275f) }, 0, 0.02f, 0.003f);
        Prism(Enumerable.Range(0, 8).Select(k => new Vector2(s + 0.035f * MathF.Cos(k * MathF.Tau / 8), y + 0.035f * MathF.Sin(k * MathF.Tau / 8))).ToArray(), 0.02f, 0.05f, 0.004f);
    }

    private static void Face(SurfaceTool st, Color col, Vector3 inside, Vector3 a, Vector3 b, Vector3 c, Vector3 d) { Face3(st, col, inside, a, b, c); Face3(st, col, inside, a, c, d); }

    private static void Face3(SurfaceTool st, Color col, Vector3 inside, Vector3 a, Vector3 b, Vector3 c)
    {
        // (clockwise as seen from outside, Godot's front face, whichever way the wall runs: the right-hand normal points in)
        var n = (b - a).Cross(c - a);
        if (n.LengthSquared() < 1e-12f) return;
        if (n.Dot(inside - a) < 0) (b, c) = (c, b);
        foreach (var (p, uv) in new[] { (a, new Vector2(0, 0)), (b, new Vector2(0.05f, 0)), (c, new Vector2(0.05f, 0.05f)) })
        {
            st.SetColor(col); st.SetUV(uv); st.AddVertex(p);
        }
    }

    /// <summary>
    /// The bared walls' facade triangles (the standing house's party wall, facing the plot) get the old brick picture:
    /// CUSTOM0 (the bake's gmat: picture, paint) set to (1, 0), as build_city.py side_wall gave the walls of September's
    /// houses pulled down. Returns the triangles changed.
    /// </summary>
    private static int Brick(Node3D town, List<BaredWall> walls)
    {
        int changed = 0;
        var facade = ResourceLoader.Load<Material>(FacadeMaterial);
        foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh && m.Name.ToString().StartsWith("city_", StringComparison.Ordinal)))
        {
            var xf = WorldOf(mesh);
            var box = xf * mesh.GetAabb();
            var near = walls.Where(w => box.Position.X <= Math.Max(w.A.X, w.B.X) + 0.5f && box.End.X >= Math.Min(w.A.X, w.B.X) - 0.5f
                && box.Position.Z <= Math.Max(w.A.Y, w.B.Y) + 0.5f && box.End.Z >= Math.Min(w.A.Y, w.B.Y) - 0.5f).ToList();
            if (near.Count == 0) continue;
            var source = (ArrayMesh)mesh.Mesh;
            var redone = new Dictionary<int, Godot.Collections.Array>();
            for (int hit = 0; hit < source.GetSurfaceCount(); hit++)
            {
                if (source.SurfaceGetMaterial(hit) != facade) continue;
                var arrays = source.SurfaceGetArrays(hit);
                var custom = arrays[(int)Mesh.ArrayType.Custom0];
                if (custom.VariantType != Variant.Type.PackedFloat32Array) continue;
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var nrm = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                var c0 = custom.AsFloat32Array();
                int stride = v.Length == 0 ? 0 : c0.Length / v.Length;
                if (stride < 2) continue;
                var index = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.PackedInt32Array ? arrays[(int)Mesh.ArrayType.Index].AsInt32Array() : Enumerable.Range(0, v.Length).ToArray();
                var basis = xf.Basis;
                var pick = new HashSet<int>(); var other = new HashSet<int>(); var picked = new List<int>();
                for (int t = 0; t + 2 < index.Length; t += 3)
                {
                    var p = (xf * v[index[t]] + xf * v[index[t + 1]] + xf * v[index[t + 2]]) / 3;
                    var n = (basis * nrm[index[t]]).Normalized();
                    bool on = near.Any(w =>
                    {
                        var u = (w.B - w.A).Normalized(); var q = new Vector2(p.X, p.Z) - w.A;
                        float along = q.Dot(u), off = Math.Abs(u.Cross(q));
                        return along > -0.1f && along < w.A.DistanceTo(w.B) + 0.1f && off < 0.25f && p.Y < w.StandingHeight + 0.2f
                            && new Vector2(n.X, n.Z).Dot(w.Out) > 0.9f;
                    });
                    if (on) picked.Add(t);
                    for (int k = 0; k < 3; k++) (on ? pick : other).Add(index[t + k]);
                }
                if (picked.Count == 0) continue;
                // (a corner shared with a triangle not on the wall is copied for the wall's triangles: the other keeps its picture)
                var shared = new HashSet<int>(pick); shared.IntersectWith(other);
                if (shared.Count > 0)
                {
                    var copyOf = new Dictionary<int, int>();
                    int count = v.Length;
                    foreach (int i in shared) copyOf[i] = count++;
                    var order = copyOf.OrderBy(p => p.Value).Select(p => p.Key).ToArray();
                    for (int a = 0; a < arrays.Count; a++)
                    {
                        if (a == (int)Mesh.ArrayType.Index) continue;
                        var src = arrays[a];
                        switch (src.VariantType)
                        {
                            case Variant.Type.PackedVector3Array: { var l = src.AsVector3Array().ToList(); l.AddRange(order.Select(i => l[i])); arrays[a] = l.ToArray(); break; }
                            case Variant.Type.PackedVector2Array: { var l = src.AsVector2Array().ToList(); l.AddRange(order.Select(i => l[i])); arrays[a] = l.ToArray(); break; }
                            case Variant.Type.PackedColorArray: { var l = src.AsColorArray().ToList(); l.AddRange(order.Select(i => l[i])); arrays[a] = l.ToArray(); break; }
                            case Variant.Type.PackedFloat32Array: { var l = src.AsFloat32Array().ToList(); int k = l.Count / v.Length; foreach (int i in order) l.AddRange(l.GetRange(i * k, k)); arrays[a] = l.ToArray(); break; }
                            case Variant.Type.PackedInt32Array: { var l = src.AsInt32Array().ToList(); int k = l.Count / v.Length; foreach (int i in order) l.AddRange(l.GetRange(i * k, k)); arrays[a] = l.ToArray(); break; }
                            case Variant.Type.PackedByteArray: { var l = src.AsByteArray().ToList(); int k = l.Count / v.Length; foreach (int i in order) l.AddRange(l.GetRange(i * k, k)); arrays[a] = l.ToArray(); break; }
                        }
                    }
                    foreach (int t in picked)
                        for (int k = 0; k < 3; k++)
                            if (copyOf.TryGetValue(index[t + k], out int c)) index[t + k] = c;
                    arrays[(int)Mesh.ArrayType.Index] = index;
                    c0 = arrays[(int)Mesh.ArrayType.Custom0].AsFloat32Array();
                }
                var mine = picked.SelectMany(t => new[] { index[t], index[t + 1], index[t + 2] }).ToHashSet();
                foreach (int i in mine) { c0[i * stride] = 1; c0[i * stride + 1] = 0; }
                // (a party wall was never meant to be seen: worn and sooted from the start, its brick darker and blotched
                // than the facade's, the damp higher: the wear the vertex colour's alpha gives)
                if (arrays[(int)Mesh.ArrayType.Color].VariantType == Variant.Type.PackedColorArray)
                {
                    var colours = arrays[(int)Mesh.ArrayType.Color].AsColorArray();
                    foreach (int i in mine) colours[i].A = Math.Max(colours[i].A, BaredWear);
                    arrays[(int)Mesh.ArrayType.Color] = colours;
                }
                // (the salvage's bricks take this wall's cell and place in it: a plain wall cell of the atlas)
                if (WallCell == null && arrays[(int)Mesh.ArrayType.TexUV2].VariantType == Variant.Type.PackedVector2Array)
                {
                    int any = mine.First();
                    WallCell = arrays[(int)Mesh.ArrayType.TexUV2].AsVector2Array()[any];
                    // (the middle of the cell: a corner's uv sits on the cell's edge, where the atlas's filtering reaches the
                    // next cell, a lit window, and the coat glowed at night)
                    var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array()[any];
                    WallUv = new Vector2(MathF.Floor(uv.X) + 0.5f, MathF.Floor(uv.Y) + 0.5f);
                }
                arrays[(int)Mesh.ArrayType.Custom0] = c0;
                redone[hit] = arrays;
                changed += picked.Count;
            }
            if (redone.Count == 0) continue;
            var rebuilt = new ArrayMesh { ResourceName = source.ResourceName };
            foreach (var key in source.GetMetaList()) rebuilt.SetMeta(key, source.GetMeta(key));
            for (int s = 0; s < source.GetSurfaceCount(); s++)
            {
                rebuilt.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), redone.TryGetValue(s, out var a) ? a : source.SurfaceGetArrays(s), null, null, source.SurfaceGetFormat(s));
                rebuilt.SurfaceSetMaterial(s, source.SurfaceGetMaterial(s));
            }
            mesh.Mesh = rebuilt;
        }
        return changed;
    }

    // ------------------------------------------------------------------ the paving

    /// <summary>
    /// Where the houses' fronts stood and where the street was mended: Paving in square-dressing.json (chance of a mended
    /// patch on a front, how many in all, the hollows the water stands in besides those beside the patches).
    /// </summary>
    public sealed record PavingPlan(int Seed, float PatchChance, int MaxPatches, Spot[] Hollows, float[][]? KeepOut = null);
    /// <summary>A patch of re-laid setts: its middle, its run (unit, along the old front), its length and depth.</summary>
    public sealed record Patch(Vector2 At, Vector2 Along, float Length, float Depth, int Seed);
    /// <summary>A run of the old front's foundation (its blue-stone plinth) from A to B; In: into the plot.</summary>
    public sealed record Strip(Vector2 A, Vector2 B, Vector2 In, int Seed);
    public sealed record Layout(List<Patch> Patches, List<Strip> Strips, List<Spot> Hollows);
    private sealed record SquareFile(SquareTree[] Trees, SquareBench[] Benches);
    private sealed record SquareTree(float X, float Z);
    private sealed record SquareBench(float X, float Z);
    /// <summary>The paving laid out on the cut plots (Ground makes it; Install lays its stones).</summary>
    public static Layout? Laid { get; private set; }

    /// <summary>
    /// The razed houses' fronts (their outline's edges that stood free: on no standing house, church or other cut house)
    /// and, on them, the mended patches and the hollows beside them; away from the trees, benches and things.
    /// </summary>
    public static Layout Lay(Plan plan, NativeRazedHouses.Result razed)
    {
        var lay = new Layout(new(), new(), new());
        if (plan.Paving is not { } pv) return lay;
        var rng = new Random(pv.Seed);
        var churches = plan.Ground.Churches.Select(c => c.Outline.Select(p => new Vector2(p[0], p[1])).ToArray()).ToList();
        Keep.Clear();
        if (Godot.FileAccess.FileExists(NativeRazedHouses.SquaresFile)
            && JsonSerializer.Deserialize<SquareFile>(Godot.FileAccess.GetFileAsString(NativeRazedHouses.SquaresFile), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) is { } sq)
        {
            // (a tree's pit frame reaches 0.9 m; a bench is 1.8 m long)
            Keep.AddRange(sq.Trees.Select(t => (new Vector2(t.X, t.Z), 1.35f)));
            Keep.AddRange(sq.Benches.Select(b => (new Vector2(b.X, b.Z), 1.2f)));
        }
        Keep.AddRange(plan.Things.Where(t => !t.Kind.StartsWith("move:", StringComparison.Ordinal)).Select(t => (new Vector2(t.At[0], t.At[1]), t.Size is { Length: 3 } s ? Math.Max(s[0], s[2]) / 2 + 0.4f : 0.7f)));
        // (keepOut: boxes x0, z0, x1, z1 another piece of work owns, the Sint-Jacob churchyard's south side)
        var boxes = (pv.KeepOut ?? Array.Empty<float[]>()).Where(b => b.Length == 4).ToList();
        bool Out(Vector2 p) => boxes.Any(b => p.X >= b[0] && p.X <= b[2] && p.Y >= b[1] && p.Y <= b[3]);
        bool Clear(Vector2 p, float margin) => !Out(p) && Keep.All(k => p.DistanceTo(k.At) > k.R + margin);
        var cut = razed.Razed;
        var fronts = new List<(Vector2 A, Vector2 B, Vector2 U, float Len, Vector2 Centre)>();
        foreach (var outline in cut)
        {
            var centre = outline.Aggregate(Vector2.Zero, (s, p) => s + p) / outline.Length;
            for (int i = 0; i < outline.Length; i++)
            {
                Vector2 a = outline[i], b = outline[(i + 1) % outline.Length];
                float len = a.DistanceTo(b);
                if (len < 1.5f) continue;
                var u = (b - a) / len;
                // free: most of the edge stands on open ground (a front on the old street or a side on a yard)
                int free = 0;
                for (int k = 1; k <= 7; k++)
                {
                    var q = a + u * (len * k / 8);
                    bool against = razed.Standing.Any(s => Inside(s, q) || EdgeDistance(s, q) < 0.5f) || churches.Any(c => Inside(c, q) || EdgeDistance(c, q) < 0.5f)
                        || cut.Any(o => o != outline && EdgeDistance(o, q) < 0.3f);
                    if (!against) free++;
                }
                if (free < 6 || Out(a) || Out(b) || Out((a + b) / 2)) continue;
                // (a front two houses share is laid once)
                var m = (a + b) / 2;
                if (lay.Strips.Any(s => (s.A + s.B).DistanceTo(m * 2) < 0.6f)) continue;
                var inward = new Vector2(-u.Y, u.X);
                if ((centre - m).Dot(inward) < 0) inward = -inward;
                lay.Strips.Add(new Strip(a + u * 0.12f, b - u * 0.12f, inward, rng.Next()));
                if (len >= 2.5f) fronts.Add((a, b, u, len, centre));
            }
        }
        // a mended patch where the doorway's step and the cellar's hatch were torn out (straddling the old front): the
        // fronts taken in a shuffled order, at most maxPatches by each church
        for (int i = fronts.Count - 1; i > 0; i--) { int j = rng.Next(i + 1); (fronts[i], fronts[j]) = (fronts[j], fronts[i]); }
        var centres = churches.Select(c => c.Aggregate(Vector2.Zero, (s, p) => s + p) / c.Length).ToList();
        var per = new Dictionary<int, int>();
        foreach (var (a, b, u, len, centre) in fronts)
        {
            var m = (a + b) / 2;
            int square = centres.Count == 0 ? -1 : Enumerable.Range(0, centres.Count).MinBy(i => centres[i].DistanceTo(m));
            if (square >= 0 && centres[square].DistanceTo(m) > 60) square = -1;
            if (per.GetValueOrDefault(square) >= pv.MaxPatches || rng.NextDouble() >= pv.PatchChance) continue;
            var n = new Vector2(-u.Y, u.X);
            if ((centre - m).Dot(n) > 0) n = -n;
            for (int tries = 0; tries < 10; tries++)
            {
                float plen = 1.4f + 1.8f * (float)rng.NextDouble(), depth = 0.9f + 1.0f * (float)rng.NextDouble();
                plen = Math.Min(plen, len - 0.6f);
                float t = plen / 2 + 0.3f + (len - plen - 0.6f) * (float)rng.NextDouble();
                // (behind the old front, inside the house's plot: in front of it the street's pavement still runs)
                var at = a + u * t - n * (depth / 2 + 0.05f + 0.25f * (float)rng.NextDouble());
                var probe = new[] { at, at + u * plen / 2, at - u * plen / 2, at + n * depth / 2, at - n * depth / 2 };
                if (!probe.All(p => Clear(p, 0.4f))) continue;
                if (probe.Any(p => razed.Standing.Any(s => Inside(s, p)) || churches.Any(c => Inside(c, p)))) continue;
                lay.Patches.Add(new Patch(at, u, plen, depth, rng.Next()));
                per[square] = per.GetValueOrDefault(square) + 1;
                // the fill of the trench under it settled: the old paving beside it sank, and water stands there
                if (rng.NextDouble() < 0.5)
                {
                    float hr = 0.8f + 0.5f * (float)rng.NextDouble();
                    var hole = at + u * (plen / 2 + hr + 0.1f) * (rng.NextDouble() < 0.5 ? -1 : 1) + n * (((float)rng.NextDouble() - 0.5f) * depth * 0.6f);
                    if (Clear(hole, 0)) lay.Hollows.Add(new Spot($"patch-{lay.Patches.Count}", new[] { hole.X, hole.Y }, hr, 0.85f + 0.15f * (float)rng.NextDouble()));
                }
                break;
            }
        }
        lay.Hollows.AddRange(pv.Hollows);
        return lay;
    }

    /// <summary>
    /// The mended patches' setts and the old fronts' plinth stones (one mesh in the facade material, as the salvage, so
    /// no new shader kind; no collision: 1-2 cm proud, stepped over). Returns the stones laid.
    /// </summary>
    public static int Pave(Node3D town, Layout lay)
    {
        if (lay.Patches.Count == 0 && lay.Strips.Count == 0) return 0;
        if (ResourceLoader.Load<Material>(FacadeMaterial) is not { } stone) return 0;
        var ground = new GroundHeight(town, lay.Patches.Select(p => new Rect2(p.At - Vector2.One * ((p.Length + p.Depth) / 2 + 0.5f), Vector2.One * (p.Length + p.Depth + 1)))
            .Concat(lay.Strips.Select(s => new Rect2(new Vector2(Math.Min(s.A.X, s.B.X), Math.Min(s.A.Y, s.B.Y)) - Vector2.One * 2, (s.B - s.A).Abs() + Vector2.One * 4))));
        // one mesh for each 60 m of the town (a square's stones together: each its own bounds for the visibility range)
        (int, int) Area(Vector2 p) => ((int)MathF.Floor(p.X / 60), (int)MathF.Floor(p.Y / 60));
        var areas = lay.Patches.Select(p => Area(p.At)).Concat(lay.Strips.Select(s => Area((s.A + s.B) / 2))).Distinct().ToList();
        int stones = 0;
        foreach (var area in areas)
        {
            var st = Begin();
            int laid = 0;
            foreach (var p in lay.Patches.Where(p => Area(p.At) == area)) laid += Setts(st, p, ground);
            foreach (var s in lay.Strips.Where(s => Area((s.A + s.B) / 2) == area)) laid += Plinth(st, s, lay.Patches, ground);
            if (laid == 0) continue;
            st.SetMaterial(stone);
            var mesh = st.Commit();
            mesh.ResourceName = "square_paving";
            var node = new MeshInstance3D
            {
                Name = $"paving_{area.Item1}_{area.Item2}", Mesh = mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                VisibilityRangeEnd = 110, VisibilityRangeEndMargin = 12, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
            };
            node.SetMeta(Meta, true);
            Holder(town).AddChild(node);
            stones += laid;
        }
        return stones;
    }

    /// <summary>
    /// A patch of reclaimed setts re-laid where the house's front stood: courses along the old front (the street's own run
    /// another way), stones 16-26 x 12-18 cm with 1-2 cm earth joints, in running bond, the courses' ends stepped; each sett
    /// its own height (1-1.8 cm proud: a new course over the old), a slight tilt, a 6 mm worn arris, a reused stone's tone.
    /// </summary>
    private static int Setts(SurfaceTool st, Patch p, GroundHeight ground)
    {
        var rng = new Random(p.Seed);
        var n = new Vector2(-p.Along.Y, p.Along.X);
        int laid = 0;
        float y = -p.Depth / 2;
        int course = 0;
        while (y < p.Depth / 2)
        {
            float cw = 0.12f + 0.06f * (float)rng.NextDouble();
            if (y + cw > p.Depth / 2 + 0.04f) break;
            // the course's ends stepped by a sett or so, as a repair is laid out to the stones left standing
            float x0 = -p.Length / 2 + ((float)rng.NextDouble() - 0.3f) * 0.3f, x1 = p.Length / 2 - ((float)rng.NextDouble() - 0.3f) * 0.3f;
            float x = x0 + (course % 2 == 0 ? 0 : -0.09f);
            while (x < x1)
            {
                float sl = 0.16f + 0.1f * (float)rng.NextDouble(), joint = 0.01f + 0.012f * (float)rng.NextDouble();
                float a = Math.Max(x, x0), b = Math.Min(x + sl, x1);
                if (b - a > 0.08f)
                {
                    var mid = p.At + p.Along * ((a + b) / 2) + n * (y + cw / 2);
                    float top = 0.01f + 0.008f * (float)rng.NextDouble();
                    // (the repair stops at the pavement's kerb, a step or a tree pit: only on the street's own setts)
                    float under = ground.At(mid);
                    if (under > 0.025f) { x += sl; continue; }
                    // (reclaimed: a worn grey, a warm grey, now and then a darker or a sandier one)
                    double pick = rng.NextDouble();
                    float k = 0.22f + 0.22f * (float)rng.NextDouble();
                    var tone = pick < 0.45 ? new Color(1.0f * k, 1.0f * k, 0.94f * k) : pick < 0.8 ? new Color(1.03f * k, 1.0f * k, 0.92f * k) : pick < 0.95 ? new Color(0.9f * k, 0.98f * k, 1.0f * k) : new Color(1.05f * k, 0.98f * k, 0.84f * k);
                    Block(st, mid, p.Along, (b - a - joint) / 2, (cw - joint) / 2, under + top, 0.01f, tone, rng, 0.003f + 0.006f * (float)rng.NextDouble(), 0.05f);
                    laid++;
                }
                x += sl;
            }
            y += cw;
            course++;
        }
        return laid;
    }

    /// <summary>
    /// The old front's plinth left in the street: blue-stone blocks 0.45-0.95 m long and 0.30-0.36 m wide on the wall's line,
    /// 1-3 cm proud, a 10 mm worn arris; one in six taken for reuse, one in four broken short, none under a mended patch, a
    /// tree, bench or thing.
    /// </summary>
    private static int Plinth(SurfaceTool st, Strip s, List<Patch> patches, GroundHeight ground)
    {
        var rng = new Random(s.Seed);
        float len = s.A.DistanceTo(s.B);
        var u = (s.B - s.A) / len;
        int laid = 0;
        float t = 0;
        while (t < len - 0.3f)
        {
            float bl = Math.Min(0.45f + 0.5f * (float)rng.NextDouble(), len - t);
            var mid = s.A + u * (t + bl / 2);
            // (where the street's pavement still runs along the old front, the plinth lies at its back, inside the plot)
            float High(Vector2 c) => Math.Max(ground.At(c - u * bl / 2), Math.Max(ground.At(c), ground.At(c + u * bl / 2)));
            for (float back = 0; back < 1.8f && High(mid) > 0.025f; back += 0.1f) mid += s.In * 0.1f;
            if (High(mid) > 0.025f) { t += bl; continue; }
            mid += s.In * 0.12f;
            bool under = patches.Any(p => Math.Abs((mid - p.At).Dot(p.Along)) < p.Length / 2 + bl / 2 && Math.Abs((mid - p.At).Dot(new Vector2(-p.Along.Y, p.Along.X))) < p.Depth / 2 + 0.2f);
            if (!under && rng.NextDouble() > 0.18 && Keep.All(k => mid.DistanceTo(k.At) > k.R + bl / 2))
            {
                float k = 0.26f + 0.1f * (float)rng.NextDouble();
                // (one in four broken off short)
                float keep = rng.NextDouble() < 0.25 ? 0.45f + 0.3f * (float)rng.NextDouble() : 1;
                Block(st, mid - u * bl * (1 - keep) / 2, u, (bl * keep - 0.008f) / 2, 0.15f + 0.03f * (float)rng.NextDouble(), ground.At(mid) + 0.01f + 0.02f * (float)rng.NextDouble(), 0.01f, new Color(0.9f * k, 0.97f * k, 1.0f * k), rng, 0.002f, 0.02f);
                laid++;
            }
            t += bl;
        }
        return laid;
    }
    /// <summary>
    /// The street's height under the new stones: the town's upward faces near the ground (pavements, kerbs, steps, the
    /// setts) in the given boxes, the highest under a point (0 where none is: the squares' setts lie at y 0).
    /// </summary>
    private sealed class GroundHeight
    {
        private readonly Dictionary<(int, int), List<(Vector3 A, Vector3 B, Vector3 C)>> cells = new();

        public GroundHeight(Node3D town, IEnumerable<Rect2> boxes)
        {
            var want = new HashSet<(int, int)>();
            foreach (var b in boxes)
                for (int i = (int)MathF.Floor(b.Position.X / 2); i <= (int)MathF.Floor(b.End.X / 2); i++)
                    for (int j = (int)MathF.Floor(b.Position.Y / 2); j <= (int)MathF.Floor(b.End.Y / 2); j++) want.Add((i, j));
            if (want.Count == 0) return;
            bool Wanted(float x0, float z0, float x1, float z1)
            {
                for (int i = (int)MathF.Floor(x0 / 2); i <= (int)MathF.Floor(x1 / 2); i++)
                    for (int j = (int)MathF.Floor(z0 / 2); j <= (int)MathF.Floor(z1 / 2); j++) if (want.Contains((i, j))) return true;
                return false;
            }
            foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh && !m.HasMeta(Meta)))
            {
                var xf = WorldOf(mesh);
                var box = xf * mesh.GetAabb();
                if (box.Position.Y > 0.5f || !Wanted(box.Position.X, box.Position.Z, box.End.X, box.End.Z)) continue;
                var am = (ArrayMesh)mesh.Mesh;
                for (int s = 0; s < am.GetSurfaceCount(); s++)
                {
                    if (am.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles || !Street(am.SurfaceGetMaterial(s))) continue;
                    var arrays = am.SurfaceGetArrays(s);
                    var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var index = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.PackedInt32Array ? arrays[(int)Mesh.ArrayType.Index].AsInt32Array() : Enumerable.Range(0, v.Length).ToArray();
                    for (int t = 0; t + 2 < index.Length; t += 3)
                    {
                        Vector3 a = xf * v[index[t]], b = xf * v[index[t + 1]], c = xf * v[index[t + 2]];
                        if (Math.Max(a.Y, Math.Max(b.Y, c.Y)) > 0.45f || Math.Min(a.Y, Math.Min(b.Y, c.Y)) < -0.3f) continue;
                        var n = (b - a).Cross(c - a);
                        if (n.LengthSquared() < 1e-12f || Math.Abs(n.Normalized().Y) < 0.85f) continue;
                        float x0 = Math.Min(a.X, Math.Min(b.X, c.X)), x1 = Math.Max(a.X, Math.Max(b.X, c.X)), z0 = Math.Min(a.Z, Math.Min(b.Z, c.Z)), z1 = Math.Max(a.Z, Math.Max(b.Z, c.Z));
                        if (!Wanted(x0, z0, x1, z1)) continue;
                        for (int i = (int)MathF.Floor(x0); i <= (int)MathF.Floor(x1); i++)
                            for (int j = (int)MathF.Floor(z0); j <= (int)MathF.Floor(z1); j++)
                            {
                                if (!cells.TryGetValue((i, j), out var list)) cells[(i, j)] = list = new();
                                list.Add((a, b, c));
                            }
                    }
                }
            }
        }

        // (only the street's own surfaces: the ground's setts and the pavements' and kerbs' slabs, not the houses' walls
        // and roofs, whose arrays are the big ones)
        private readonly Dictionary<Material, bool> street = new();
        private bool Street(Material? m)
        {
            if (m is not ShaderMaterial sm) return false;
            if (!street.TryGetValue(m, out bool yes))
                street[m] = yes = sm.GetShaderParameter("puddles").VariantType != Variant.Type.Nil || sm.GetShaderParameter("slab_tile").VariantType != Variant.Type.Nil;
            return yes;
        }

        public float At(Vector2 p)
        {
            if (!cells.TryGetValue(((int)MathF.Floor(p.X), (int)MathF.Floor(p.Y)), out var list)) return 0;
            float best = float.NegativeInfinity;
            foreach (var (a, b, c) in list)
            {
                // (barycentric, in plan)
                float d = (b.Z - c.Z) * (a.X - c.X) + (c.X - b.X) * (a.Z - c.Z);
                if (Math.Abs(d) < 1e-9f) continue;
                float l1 = ((b.Z - c.Z) * (p.X - c.X) + (c.X - b.X) * (p.Y - c.Z)) / d, l2 = ((c.Z - a.Z) * (p.X - c.X) + (a.X - c.X) * (p.Y - c.Z)) / d, l3 = 1 - l1 - l2;
                if (l1 < -1e-4f || l2 < -1e-4f || l3 < -1e-4f) continue;
                best = Math.Max(best, l1 * a.Y + l2 * b.Y + l3 * c.Y);
            }
            return float.IsNegativeInfinity(best) ? 0 : best;
        }
    }

    /// <summary>The trees, benches and things the stones keep clear of (Lay fills it).</summary>
    private static readonly List<(Vector2 At, float R)> Keep = new();

    /// <summary>
    /// One stone in the paving: a block (half sizes along and across its run) whose top stands `top` over the street, its
    /// top's arris worn by `arris` all round, its sides down to 3 cm under the street; tilted a hair, its tone dirtier at
    /// the foot. In the facade material (as the salvage's bricks): the render picture's grey grain in world metres, so
    /// each stone shows its own piece of it, in the stone's own colour (the vertex colour), worn 0.5 (the town's coal film).
    /// </summary>
    private static void Block(SurfaceTool st, Vector2 at, Vector2 along, float ha, float hc, float top, float arris, Color tone, Random rng, float crown = 0, float turn = 0)
    {
        // (a hand-laid stone is turned a hair off its course)
        float tw = ((float)rng.NextDouble() - 0.5f) * 2 * turn;
        along = new Vector2(along.X * MathF.Cos(tw) - along.Y * MathF.Sin(tw), along.X * MathF.Sin(tw) + along.Y * MathF.Cos(tw));
        var ac = new Vector2(-along.Y, along.X);
        float tiltA = ((float)rng.NextDouble() - 0.5f) * 0.006f, tiltC = ((float)rng.NextDouble() - 0.5f) * 0.006f;
        float Foot = top - 0.045f;
        Vector3 P(float a, float c, float y)
        {
            var q = at + along * a + ac * c;
            float lift = y > 0 ? (a / Math.Max(ha, 0.01f)) * tiltA + (c / Math.Max(hc, 0.01f)) * tiltC : 0;
            return new Vector3(q.X, y + lift, q.Y);
        }
        void Face(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 nrm, float shade)
        {
            // Godot's front face turns clockwise as seen from outside
            bool tri = c == d;
            if ((b - a).Cross(c - a).Dot(nrm) > 0) { if (tri) (b, c) = (c, b); else (b, d) = (d, b); }
            foreach (var p in tri ? new[] { a, b, c } : new[] { a, b, c, a, c, d })
            {
                float k = shade * (p.Y < Foot + 0.001f ? 0.8f : 1);
                st.SetNormal(nrm); st.SetUV(WallUv); st.SetUV2(WallCell ?? Vector2.Zero); st.SetCustom(0, new Color(RenderPicture, 1, 0, 0));
                st.SetColor(new Color(tone.R * k, tone.G * k, tone.B * k, 0.5f)); st.AddVertex(p);
            }
        }
        float y = top - arris, ia = ha - arris, ic = hc - arris;
        var up = Vector3.Up;
        Vector3 A3 = new(along.X, 0, along.Y), C3 = new(ac.X, 0, ac.Y);
        // the worn top: flat, or crowned (worn round by the wheels and the feet: four faces up to a middle a few mm higher)
        if (crown <= 0) Face(P(-ia, -ic, top), P(ia, -ic, top), P(ia, ic, top), P(-ia, ic, top), up, 1);
        else
        {
            var mid = P(0, 0, top + crown);
            var ring = new[] { P(-ia, -ic, top), P(ia, -ic, top), P(ia, ic, top), P(-ia, ic, top) };
            for (int k = 0; k < 4; k++)
            {
                Vector3 a = ring[k], b = ring[(k + 1) % 4];
                var nrm = (b - a).Cross(mid - a).Normalized();
                if (nrm.Y < 0) nrm = -nrm;
                Face(a, b, mid, mid, nrm, 1.02f);
            }
        }
        // the arris, all round
        Face(P(-ia, ic, top), P(ia, ic, top), P(ha, hc, y), P(-ha, hc, y), (up + C3).Normalized(), 0.92f);
        Face(P(ia, -ic, top), P(-ia, -ic, top), P(-ha, -hc, y), P(ha, -hc, y), (up - C3).Normalized(), 0.92f);
        Face(P(ia, ic, top), P(ia, -ic, top), P(ha, -hc, y), P(ha, hc, y), (up + A3).Normalized(), 0.92f);
        Face(P(-ia, -ic, top), P(-ia, ic, top), P(-ha, hc, y), P(-ha, -hc, y), (up - A3).Normalized(), 0.92f);
        // the sides, into the street
        Face(P(-ha, hc, y), P(ha, hc, y), P(ha, hc, Foot), P(-ha, hc, Foot), C3, 0.78f);
        Face(P(ha, -hc, y), P(-ha, -hc, y), P(-ha, -hc, Foot), P(ha, -hc, Foot), -C3, 0.78f);
        Face(P(ha, hc, y), P(ha, -hc, y), P(ha, -hc, Foot), P(ha, hc, Foot), A3, 0.78f);
        Face(P(-ha, -hc, y), P(-ha, hc, y), P(-ha, hc, Foot), P(-ha, -hc, Foot), -A3, 0.78f);
    }

    // ------------------------------------------------------------------ the things

    /// <summary>The kit's authored objects (the pump) and the town's guard stones, before collision and navigation read the town.</summary>
    public static int Install(Node3D town, Plan plan)
    {
        var holder = Holder(town);
        int placed = 0;
        if (Laid is { } lay)
        {
            int stones = Pave(town, lay);
            GD.Print($"square dressing: {lay.Patches.Count} mended patches and {lay.Strips.Count} old fronts paved ({stones} stones), {lay.Hollows.Count} hollows");
        }
        AuthorAsset? pump = null;
        Mesh? guard = null; float guardFoot = 0;
        foreach (var t in plan.Things)
        {
            var at = new Vector3(t.At[0], 0, t.At[1]);
            switch (t.Kind.Split(':')[0])
            {
                case "pump":
                case "kit":
                    // the street kit's own objects (one model everywhere: the pump the town's streets have, its hitching post)
                    var asset = t.Kind == "pump" ? pump ??= ResourceLoader.Load<AuthorAsset>(PumpAsset) : ResourceLoader.Load<AuthorAsset>($"{KitDir}/{t.Kind[4..]}.tres");
                    if (asset == null) { GD.Print($"square dressing: {t.Id}: no kit object {t.Kind}"); break; }
                    // (lift: a kit object whose top is the street's own level, the gully's grate, set a hair proud of it)
                    var o = new AuthoredObject { Name = "kit_" + t.Id.Replace('-', '_'), ObjectId = t.Id, Asset = asset, Position = at + Vector3.Up * t.Lift, Rotation = new Vector3(0, Mathf.DegToRad(t.Yaw), 0) };
                    o.SetMeta(Meta, true);
                    holder.AddChild(o); placed++;
                    break;
                case "move":
                    // (the bake's own loose things moved, by their node paths after "move:", as far as at says: the barrels
                    // set on the Paulus north threshold go to the cart's delivery)
                    foreach (var path in t.Kind[5..].Split(','))
                        if (town.GetNodeOrNull<Node3D>(path) is { } thing) { thing.Position += new Vector3(t.At[0], 0, t.At[1]); placed++; }
                        else GD.Print($"square dressing: {t.Id}: no {path} to move");
                    break;
                case "guard":
                    if (guard == null) (guard, guardFoot) = GuardStone(town);
                    if (guard == null) break;
                    var node = new Node3D { Name = "guard_" + t.Id, Position = at + Vector3.Down * guardFoot, Rotation = new Vector3(0, Mathf.DegToRad(t.Yaw), 0) };
                    node.SetMeta(Meta, true);
                    node.AddChild(new MeshInstance3D { Name = "Mesh", Mesh = guard, VisibilityRangeEnd = 140, VisibilityRangeEndMargin = 15, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self });
                    var body = new StaticBody3D { Name = "Solid", CollisionLayer = Scheldemist.World.Solid.Layer, CollisionMask = 0 };
                    body.AddChild(new CollisionShape3D { Name = "Shape", Shape = new CylinderShape3D { Radius = 0.17f, Height = 0.7f }, Position = new Vector3(0, guardFoot + 0.35f, 0) });
                    node.AddChild(body);
                    holder.AddChild(node); placed++;
                    break;
            }
        }
        return placed;
    }

    /// <summary>
    /// One of the town's guard stones (guard_stones.py's model in the clutter's guard-stone surface), as a mesh of its own
    /// round its foot: the same stone for the squares' corners. Returns the mesh and how far its foot lies under the street.
    /// </summary>
    private static (Mesh?, float) GuardStone(Node3D town)
    {
        foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh))
        {
            var am = (ArrayMesh)mesh.Mesh;
            for (int s = 0; s < am.GetSurfaceCount(); s++)
            {
                if (am.SurfaceGetMaterial(s)?.ResourcePath != GuardStoneMaterial) continue;
                var arrays = am.SurfaceGetArrays(s);
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                if (v.Length == 0) continue;
                var index = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.PackedInt32Array ? arrays[(int)Mesh.ArrayType.Index].AsInt32Array() : Enumerable.Range(0, v.Length).ToArray();
                // the first stone: the triangles within 0.3 m (in plan) of the first one
                var first = (v[index[0]] + v[index[1]] + v[index[2]]) / 3;
                var keep = new List<int>();
                for (int t = 0; t + 2 < index.Length; t += 3)
                {
                    var c = (v[index[t]] + v[index[t + 1]] + v[index[t + 2]]) / 3;
                    if (new Vector2(c.X - first.X, c.Z - first.Z).Length() < 0.3f) { keep.Add(index[t]); keep.Add(index[t + 1]); keep.Add(index[t + 2]); }
                }
                var used = keep.Distinct().ToList();
                float cx = used.Average(i => v[i].X), cz = used.Average(i => v[i].Z), minY = used.Min(i => v[i].Y);
                // its foot: the lowest point is sunk 4 cm into the paving
                var remap = used.Select((i, k) => (i, k)).ToDictionary(p => p.i, p => p.k);
                var outArrays = new Godot.Collections.Array(); outArrays.Resize((int)Mesh.ArrayType.Max);
                var shift = new Vector3(cx, minY + 0.04f, cz);
                outArrays[(int)Mesh.ArrayType.Vertex] = used.Select(i => v[i] - shift).ToArray();
                foreach (var kind in new[] { Mesh.ArrayType.Normal, Mesh.ArrayType.TexUV, Mesh.ArrayType.TexUV2, Mesh.ArrayType.Color, Mesh.ArrayType.Tangent })
                {
                    var src = arrays[(int)kind];
                    switch (src.VariantType)
                    {
                        case Variant.Type.PackedVector3Array: { var a = src.AsVector3Array(); outArrays[(int)kind] = used.Select(i => a[i]).ToArray(); break; }
                        case Variant.Type.PackedVector2Array: { var a = src.AsVector2Array(); outArrays[(int)kind] = used.Select(i => a[i]).ToArray(); break; }
                        case Variant.Type.PackedColorArray: { var a = src.AsColorArray(); outArrays[(int)kind] = used.Select(i => a[i]).ToArray(); break; }
                        case Variant.Type.PackedFloat32Array: { var a = src.AsFloat32Array(); int k = a.Length / v.Length; outArrays[(int)kind] = used.SelectMany(i => a.Skip(i * k).Take(k)).ToArray(); break; }
                    }
                }
                outArrays[(int)Mesh.ArrayType.Index] = keep.Select(i => remap[i]).ToArray();
                var stone = new ArrayMesh { ResourceName = "square_guard_stone" };
                stone.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, outArrays);
                stone.SurfaceSetMaterial(0, am.SurfaceGetMaterial(s));
                return (stone, 0.04f);
            }
        }
        return (null, 0);
    }

    /// <summary>The model packs' things and the salvage (main thread: the packs' materials are made here).</summary>
    public static int Dress(Node3D town, Plan plan)
    {
        var holder = Holder(town);
        int placed = 0;
        var look = new ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true);
        var facade = ResourceLoader.Load<Material>(FacadeMaterial);
        foreach (var t in plan.Things)
        {
            var at = new Vector3(t.At[0], 0, t.At[1]);
            var rot = new Vector3(0, Mathf.DegToRad(t.Yaw), 0);
            Node3D? made = null;
            string[] k = t.Kind.Split(':');
            switch (k[0])
            {
                case "pump": case "kit": case "guard": case "move": continue;
                case "handcart":
                {
                    var props = ModelLibrary.Get("props", new ModelLibrary.Look(TwoSided: true));
                    if (props?.Copy("tr_handcart") is not { } body || props.Copy("tr_handcart_wheels") is not { } wheels) break;
                    made = new Node3D(); made.AddChild(body); made.AddChild(wheels); wheels.Position = new Vector3(0, 0.57f, 0);
                    // (Handcarts.cs: the body sits on its wheels' axle, the shafts down on the ground resting)
                    if (k.Length > 1 && props.Copy(k[1]) is { } load) { load.Position = new Vector3(0, 0, 0); made.AddChild(load); }
                    made.Rotation = new Vector3(0, Mathf.DegToRad(t.Yaw) + MathF.PI, 0);
                    Solid(made, new Vector3(1.44f, 0.65f, 1.9f), new Vector3(0, 0.65f, 0));
                    break;
                }
                case "bricks":
                    made = BrickStack(facade, t); break;
                case "rubble":
                    made = Rubble(facade, t); break;
                default:
                {
                    // "pack:model": a copy of a model pack's top node (solid when it stands up off the ground)
                    if (k.Length < 2) break;
                    var pack = ModelLibrary.Get(k[0], k[0] == "props" ? new ModelLibrary.Look(TwoSided: true) : look);
                    if (pack?.Copy(k[1]) is not { } copy) break;
                    made = new Node3D(); made.AddChild(copy);
                    if (t.Size is { Length: 3 } size) Solid(made, new Vector3(size[0], size[1], size[2]), new Vector3(0, size[1] / 2, 0));
                    break;
                }
            }
            if (made == null) { GD.Print($"square dressing: {t.Id} ({t.Kind}) not made"); continue; }
            made.Name = "thing_" + t.Id.Replace('-', '_');
            made.Position = at;
            if (t.Kind.Split(':')[0] != "handcart") made.Rotation = rot;
            if (t.Scale != 1) made.Scale = Vector3.One * t.Scale;
            foreach (var n in BakedWorld.All(made)) n.SetMeta(Meta, true);
            made.SetMeta(Meta, true);
            foreach (var gi in BakedWorld.All(made).OfType<GeometryInstance3D>())
            {
                gi.VisibilityRangeEnd = 110; gi.VisibilityRangeEndMargin = 12; gi.VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self;
            }
            holder.AddChild(made); placed++;
        }
        return placed;
    }

    private static void Solid(Node3D node, Vector3 size, Vector3 centre)
    {
        var body = new StaticBody3D { Name = "Solid", CollisionLayer = Scheldemist.World.Solid.Layer, CollisionMask = 0 };
        body.AddChild(new CollisionShape3D { Name = "Shape", Shape = new BoxShape3D { Size = size }, Position = centre });
        node.AddChild(body);
    }

    private static Node3D Holder(Node3D town)
    {
        if (town.GetNodeOrNull<Node3D>("square_dressing") is { } had) return had;
        var holder = new Node3D { Name = "square_dressing" };
        holder.SetMeta(Meta, true);
        town.AddChild(holder);
        return holder;
    }

    // ------------------------------------------------------------------ the salvage

    // The facade material draws its wall picture by the vertex's CUSTOM0 (picture, paint) in world space (Grime.cs). A
    // brick is too small for the brick picture's courses: it takes the fine smooth plaster picture (unpainted) in its own
    // fired colour (the vertex colour), so each reads as one brick with a fired skin; a lime lump the rough plaster's. The
    // atlas cell (UV2) and place in it come from a bared wall's corner (a plain wall cell); the vertex alpha is the wear,
    // kept under 0.55 (over it the plaster pictures fall off in holes).
    private const int SmoothPicture = 7, RoughPicture = 8;
    // fired brick (Codex's reused brick #885D47 and its kin: a red, a dark, an old yellow-red, an over-burnt) and lime
    private static readonly Color[] Fired = { new(0.36f, 0.17f, 0.1f), new(0.3f, 0.14f, 0.09f), new(0.4f, 0.22f, 0.13f), new(0.33f, 0.19f, 0.12f), new(0.22f, 0.12f, 0.085f) };
    private static readonly Color Lime = new(0.52f, 0.48f, 0.4f), Crusted = new(0.46f, 0.34f, 0.25f), Dust = new(0.24f, 0.21f, 0.17f);
    private static Color FiredOf(Random rng, float wear) { var c = Fired[rng.Next(Fired.Length)]; float k = 0.9f + 0.2f * (float)rng.NextDouble(); return new Color(c.R * k, c.G * k, c.B * k, wear); }
    private static Vector2? WallCell;
    private static Vector2 WallUv = new(0.5f, 0.5f);

    /// <summary>
    /// Reclaimed bricks stacked for carting: courses of single bricks (0.22 x 0.105 x 0.065 m, 2 mm arrises), headers and
    /// stretchers crossing course by course, a few set aside crooked, old mortar on some (the plaster picture).
    /// </summary>
    private static Node3D BrickStack(Material facade, Thing t)
    {
        var size = t.Size is { Length: 3 } s ? new Vector3(s[0], s[1], s[2]) : new Vector3(0.9f, 0.55f, 0.66f);
        var rng = new Random(t.Seed == 0 ? t.Id.GetHashCode() : t.Seed);
        var st = Begin();
        int courses = Math.Max(1, (int)(size.Y / 0.07f));
        for (int c = 0; c < courses; c++)
        {
            bool along = c % 2 == 0;
            float bl = 0.22f, bw = 0.105f;
            float lx = along ? bl : bw, lz = along ? bw : bl;
            int nx = Math.Max(1, (int)(size.X / (lx + 0.012f))), nz = Math.Max(1, (int)(size.Z / (lz + 0.012f)));
            // (the top course only part laid: the stack is being built or taken)
            bool topCourse = c == courses - 1;
            for (int i = 0; i < nx; i++)
                for (int j = 0; j < nz; j++)
                {
                    if (topCourse && rng.NextDouble() < 0.45) continue;
                    float x = -size.X / 2 + (i + 0.5f) * size.X / nx + ((float)rng.NextDouble() - 0.5f) * 0.012f;
                    float z = -size.Z / 2 + (j + 0.5f) * size.Z / nz + ((float)rng.NextDouble() - 0.5f) * 0.012f;
                    float yaw = (along ? 0 : MathF.PI / 2) + ((float)rng.NextDouble() - 0.5f) * 0.06f;
                    // (one in eight still crusted with its old mortar)
                    var tone = rng.NextDouble() < 0.12 ? new Color(Crusted.R, Crusted.G, Crusted.B, 0.4f) : FiredOf(rng, 0.3f + 0.2f * (float)rng.NextDouble());
                    Brick(st, new Vector3(x, c * 0.067f, z), yaw, 0, tone);
                }
        }
        // a few loose bricks at its foot, knocked off or set aside
        for (int i = 0; i < 4; i++)
        {
            float a = (float)rng.NextDouble() * MathF.Tau;
            var p = new Vector3(MathF.Cos(a) * (size.X / 2 + 0.2f), 0, MathF.Sin(a) * (size.Z / 2 + 0.2f));
            Brick(st, p, (float)rng.NextDouble() * MathF.Tau, rng.NextDouble() < 0.5 ? 0 : 0.35f, FiredOf(rng, 0.45f));
        }
        var node = new Node3D();
        node.AddChild(Commit(st, facade, "bricks"));
        Solid(node, new Vector3(size.X, size.Y, size.Z), new Vector3(0, size.Y / 2, 0));
        return node;
    }

    /// <summary>
    /// A heap of demolition rubble: broken bricks and lumps of lime mortar and plaster tipped in a low mound (its outline an
    /// ellipse of the given size, its height falling off from a ridge), the bigger pieces at the foot where they rolled.
    /// </summary>
    private static Node3D Rubble(Material facade, Thing t)
    {
        var size = t.Size is { Length: 3 } s ? new Vector3(s[0], s[1], s[2]) : new Vector3(2.4f, 0.55f, 1.1f);
        var rng = new Random(t.Seed == 0 ? t.Id.GetHashCode() : t.Seed);
        var st = Begin();
        int pieces = (int)(size.X * size.Z * 230);
        for (int i = 0; i < pieces; i++)
        {
            float u = (float)rng.NextDouble() * 2 - 1, v = (float)rng.NextDouble() * 2 - 1;
            float r2 = u * u + v * v;
            if (r2 > 1) { i--; continue; }
            float hgt = size.Y * (1 - r2) * (0.75f + 0.25f * (float)rng.NextDouble());
            // pieces lie on the mound's surface, a few inside it to fill
            float y = Math.Max(0, hgt - 0.05f - (float)rng.NextDouble() * 0.12f);
            var p = new Vector3(u * size.X / 2, y, v * size.Z / 2);
            bool lime = rng.NextDouble() < 0.14;
            float tilt = ((float)rng.NextDouble() - 0.5f) * 1.4f;
            float scale = lime ? 0.5f + 0.6f * (float)rng.NextDouble() : 0.45f + 0.55f * (float)rng.NextDouble();
            var tone = lime ? new Color(Lime.R, Lime.G, Lime.B, 0.35f) : FiredOf(rng, 0.3f + 0.2f * (float)rng.NextDouble());
            Brick(st, p, (float)rng.NextDouble() * MathF.Tau, tilt, tone, scale, lime);
        }
        // a fringe of chips and dust 20-40 cm round its foot, kicked out by the barrows
        for (int i = 0; i < (int)(size.X * 40); i++)
        {
            float a = (float)rng.NextDouble() * MathF.Tau, r = 1.02f + 0.3f * (float)rng.NextDouble();
            var p = new Vector3(MathF.Cos(a) * r * size.X / 2, -0.01f, MathF.Sin(a) * r * size.Z / 2);
            bool lime = rng.NextDouble() < 0.3;
            Brick(st, p, (float)rng.NextDouble() * MathF.Tau, ((float)rng.NextDouble() - 0.5f) * 0.6f,
                lime ? new Color(Lime.R, Lime.G, Lime.B, 0.35f) : FiredOf(rng, 0.4f), 0.22f + 0.2f * (float)rng.NextDouble(), lime);
        }
        Mound(st, size, rng);
        var node = new Node3D();
        node.AddChild(Commit(st, facade, "rubble"));
        Solid(node, new Vector3(size.X * 0.8f, size.Y * 0.8f, size.Z * 0.8f), new Vector3(0, size.Y * 0.4f, 0));
        return node;
    }

    /// <summary>
    /// The rubble's body under its pieces: lime dust, broken mortar and earth in a low mound (the plaster picture, dark), its
    /// edge sunk 2 cm into the paving and its surface broken by noise so it is no smooth dome.
    /// </summary>
    private static void Mound(SurfaceTool st, Vector3 size, Random rng)
    {
        const int rings = 7, sides = 20;
        var col = new Color(Dust.R, Dust.G, Dust.B, 0.3f);
        var cell = WallCell ?? Vector2.Zero;
        float seed = (float)rng.NextDouble() * 50;
        Vector3 At(int r, int k)
        {
            float t = r / (float)rings, a = k * MathF.Tau / sides;
            float wob = 1 + 0.24f * (Noise(new Vector2(MathF.Cos(a) * 2 + seed, MathF.Sin(a) * 2)) - 0.5f);
            float rad = (1 - t) * wob;
            float hgt = size.Y * 0.82f * (1 - rad * rad) * (0.85f + 0.3f * Noise(new Vector2(rad * MathF.Cos(a) * 3 + seed, rad * MathF.Sin(a) * 3)));
            return new Vector3(MathF.Cos(a) * rad * size.X / 2, Math.Max(-0.02f, hgt - 0.02f), MathF.Sin(a) * rad * size.Z / 2);
        }
        void V(Vector3 p) { st.SetColor(col); st.SetUV(WallUv); st.SetUV2(cell); st.SetCustom(0, new Color(RoughPicture, 1, 0, 0)); st.AddVertex(p); }
        // (clockwise as seen from above: the right-hand normal points down, into the heap)
        void Tw(Vector3 a, Vector3 b, Vector3 c) { if ((b - a).Cross(c - a).Y > 0) (b, c) = (c, b); V(a); V(b); V(c); }
        for (int r = 0; r < rings; r++)
            for (int k = 0; k < sides; k++)
            {
                Vector3 a = At(r, k), b = At(r, (k + 1) % sides), c = At(r + 1, (k + 1) % sides), d = At(r + 1, k);
                Tw(a, b, c);
                if (r + 1 < rings) Tw(a, c, d);
            }
    }

    private static SurfaceTool Begin()
    {
        var st = new SurfaceTool(); st.Begin(Mesh.PrimitiveType.Triangles);
        st.SetCustomFormat(0, SurfaceTool.CustomFormat.RgFloat);
        return st;
    }

    private static MeshInstance3D Commit(SurfaceTool st, Material material, string name, bool normals = true)
    {
        st.SetMaterial(material);
        if (normals) st.GenerateNormals();
        return new MeshInstance3D { Name = name, Mesh = st.Commit() };
    }

    /// <summary>
    /// One brick (or a broken piece, or a lump of lime): a box 0.22 x 0.065 x 0.105 m scaled, its eight corners pulled in by
    /// 2 mm on every arris (a chamfered box: faces, edge strips and corner triangles), turned by yaw and tilted.
    /// </summary>
    private static void Brick(SurfaceTool st, Vector3 at, float yaw, float tilt, Color tone, float scale = 1, bool lump = false)
    {
        var half = new Vector3(0.11f, 0.0325f, 0.0525f) * scale;
        if (lump) half = new Vector3(0.06f, 0.035f, 0.05f) * scale * 1.4f;
        float ch = Math.Min(0.002f + (lump ? 0.008f : 0), Math.Min(half.X, Math.Min(half.Y, half.Z)) * 0.4f);
        var basis = new Basis(Vector3.Up, yaw) * new Basis(Vector3.Right, tilt);
        var origin = at + Vector3.Up * half.Y;
        Vector3 P(float x, float y, float z) => origin + basis * new Vector3(x, y, z);
        var col = tone;
        int picture = lump ? RoughPicture : SmoothPicture;
        var cell = WallCell ?? Vector2.Zero;
        void V(Vector3 p)
        {
            st.SetColor(col); st.SetUV(WallUv); st.SetUV2(cell);
            // (paint 1: g_pi 0, the unpainted white)
            st.SetCustom(0, new Color(picture, 1, 0, 0)); st.AddVertex(p);
        }
        void T(Vector3 a, Vector3 b, Vector3 c)
        {
            // (clockwise as seen from outside, Godot's front face: the right-hand normal points into the brick)
            if ((b - a).Cross(c - a).Dot((a + b + c) / 3 - origin) > 0) (b, c) = (c, b);
            V(a); V(b); V(c);
        }
        void Q(Vector3 a, Vector3 b, Vector3 c, Vector3 d) { T(a, b, c); T(a, c, d); }
        float x = half.X, y = half.Y, z = half.Z, e = ch;
        // the six faces, each inset by the chamfer
        Q(P(-x + e, y, -z + e), P(x - e, y, -z + e), P(x - e, y, z - e), P(-x + e, y, z - e));
        Q(P(-x + e, -y, -z + e), P(x - e, -y, -z + e), P(x - e, -y, z - e), P(-x + e, -y, z - e));
        Q(P(x, -y + e, -z + e), P(x, y - e, -z + e), P(x, y - e, z - e), P(x, -y + e, z - e));
        Q(P(-x, -y + e, -z + e), P(-x, y - e, -z + e), P(-x, y - e, z - e), P(-x, -y + e, z - e));
        Q(P(-x + e, -y + e, z), P(x - e, -y + e, z), P(x - e, y - e, z), P(-x + e, y - e, z));
        Q(P(-x + e, -y + e, -z), P(x - e, -y + e, -z), P(x - e, y - e, -z), P(-x + e, y - e, -z));
        // the twelve edge strips
        foreach (float sy in new[] { -1f, 1f })
            foreach (float sz in new[] { -1f, 1f })
                Q(P(-x + e, sy * y, sz * (z - e)), P(x - e, sy * y, sz * (z - e)), P(x - e, sy * (y - e), sz * z), P(-x + e, sy * (y - e), sz * z));
        foreach (float sx in new[] { -1f, 1f })
            foreach (float sz in new[] { -1f, 1f })
                Q(P(sx * (x - e), -y + e, sz * z), P(sx * x, -y + e, sz * (z - e)), P(sx * x, y - e, sz * (z - e)), P(sx * (x - e), y - e, sz * z));
        foreach (float sx in new[] { -1f, 1f })
            foreach (float sy in new[] { -1f, 1f })
                Q(P(sx * (x - e), sy * y, -z + e), P(sx * (x - e), sy * y, z - e), P(sx * x, sy * (y - e), z - e), P(sx * x, sy * (y - e), -z + e));
        // the eight corners
        foreach (float sx in new[] { -1f, 1f })
            foreach (float sy in new[] { -1f, 1f })
                foreach (float sz in new[] { -1f, 1f })
                    T(P(sx * (x - e), sy * y, sz * (z - e)), P(sx * x, sy * (y - e), sz * (z - e)), P(sx * (x - e), sy * (y - e), sz * z));
    }

    // ------------------------------------------------------------------ geometry

    private static float Noise(Vector2 p)
    {
        // value noise, smooth, 0..1
        int xi = (int)MathF.Floor(p.X), zi = (int)MathF.Floor(p.Y);
        float fx = p.X - xi, fz = p.Y - zi;
        float H(int a, int b) { uint h = (uint)(a * 374761393 + b * 668265263); h = (h ^ (h >> 13)) * 1274126177; return (h ^ (h >> 16)) / 4294967295f; }
        float sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
        return Mathf.Lerp(Mathf.Lerp(H(xi, zi), H(xi + 1, zi), sx), Mathf.Lerp(H(xi, zi + 1), H(xi + 1, zi + 1), sx), sz);
    }

    private static Transform3D WorldOf(Node3D node)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
        return xf;
    }

    private static bool Near(Vector2[] p, float x0, float z0, float x1, float z1) => p.Any(q => q.X >= x0 && q.X <= x1 && q.Y >= z0 && q.Y <= z1) || p.Min(q => q.X) <= x1 && p.Max(q => q.X) >= x0 && p.Min(q => q.Y) <= z1 && p.Max(q => q.Y) >= z0;

    private static bool Near(Vector2[] a, Vector2[] b, float d) => a.Any(p => Inside(b, p) || EdgeDistance(b, p) <= d) || b.Any(p => Inside(a, p) || EdgeDistance(a, p) <= d);

    private static bool Inside(Vector2[] p, Vector2 q)
    {
        bool inside = false;
        for (int i = 0, j = p.Length - 1; i < p.Length; j = i++)
            if ((p[i].Y > q.Y) != (p[j].Y > q.Y) && q.X < (p[j].X - p[i].X) * (q.Y - p[i].Y) / (p[j].Y - p[i].Y) + p[i].X) inside = !inside;
        return inside;
    }

    private static float EdgeDistance(Vector2[] p, Vector2 q)
    {
        float best = float.MaxValue;
        for (int i = 0, j = p.Length - 1; i < p.Length; j = i++)
        {
            var ab = p[i] - p[j];
            float t = ab.LengthSquared() < 1e-9f ? 0 : Math.Clamp((q - p[j]).Dot(ab) / ab.LengthSquared(), 0, 1);
            best = Math.Min(best, q.DistanceTo(p[j] + ab * t));
        }
        return best;
    }
}
