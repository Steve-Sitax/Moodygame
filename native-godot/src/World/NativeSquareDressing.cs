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
    public sealed record Thing(string Id, string Kind, float[] At, float Yaw, float Scale = 1, float[]? Size = null, int Seed = 0);
    public sealed record Plan(string Note, GroundPlan Ground, Thing[] Things);

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
        RustTint = new(0.2f, 0.065f, 0.018f), DampTint = new(0.06f, 0.07f, 0.04f);
    // (washed-out papers, Codex's #898875 and its kin: what is left of a room's paper after a summer of rain)
    private static readonly Color[] Wallpaper = { new(0.66f, 0.56f, 0.48f), new(0.56f, 0.6f, 0.5f), new(0.55f, 0.57f, 0.6f), new(0.7f, 0.66f, 0.52f), new(0.63f, 0.56f, 0.56f) };
    private const float GroundH = 3.8f, StoreyH = 3.0f;

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
        var st = new SurfaceTool(); st.Begin(Mesh.PrimitiveType.Triangles);
        var ir = new SurfaceTool(); ir.Begin(Mesh.PrimitiveType.Triangles);
        var pl = Begin();
        int quads = 0, anchors = 0;
        foreach (var w in walls)
        {
            var (q, a) = GhostMarks(st, ir, pl, w);
            quads += q; anchors += a;
        }
        var holder = new Node3D { Name = "square_walls" };
        holder.SetMeta(Meta, true);
        town.AddChild(holder);
        if (quads > 0)
        {
            st.SetMaterial(decal);
            var mesh = st.Commit();
            holder.AddChild(new MeshInstance3D
            {
                Name = "ghosts", Mesh = mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                VisibilityRangeEnd = 160, VisibilityRangeEndMargin = 20, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
            });
        }
        if (quads > 0)
        {
            var coat = Commit(pl, ResourceLoader.Load<Material>(FacadeMaterial), "plaster", normals: false);
            coat.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
            coat.VisibilityRangeEnd = 160; coat.VisibilityRangeEndMargin = 20; coat.VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self;
            holder.AddChild(coat);
        }
        if (anchors > 0)
        {
            ir.SetMaterial(iron);
            ir.GenerateNormals();
            holder.AddChild(new MeshInstance3D
            {
                Name = "anchors", Mesh = ir.Commit(), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                VisibilityRangeEnd = 70, VisibilityRangeEndMargin = 10, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
            });
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
        // cell's film, a quarter, tiling every 2.3 m)
        for (int i = 1; i + 1 < pts.Count; i++)
            Tri(st, W(pts[0].X, pts[0].Y, 0.006f), W(pts[i].X, pts[i].Y, 0.006f), W(pts[i + 1].X, pts[i + 1].Y, 0.006f),
                pts[0] / 2.3f, pts[i] / 2.3f, pts[i + 1] / 2.3f, Ghost, GhostTint, 1f);
        quads++;
        // and each room's plaster left on the wall between its floor and ceiling, chopped off ragged where the joists and
        // the ceiling were torn out: a real coat, 15 mm proud of the brick with its broken edge, in the facade's rough
        // plaster picture (worn: the shader knocks holes in it to the brick), each room its own old limewash
        var levels = Enumerable.Range(0, Math.Max(1, w.Storeys) - 1).Select(k => GroundH + k * StoreyH).Where(y => y < hg - 0.5f).Prepend(0f).ToList();
        for (int f = 0; f < levels.Count; f++)
        {
            float y0 = levels[f] + (f == 0 ? 0.45f : 0.3f), y1 = (f + 1 < levels.Count ? levels[f + 1] : hg) - 0.22f;
            float x0 = s0 + 0.18f, x1 = s1 - 0.18f;
            if (y1 - y0 < 0.8f || x1 - x0 < 0.8f) continue;
            // (a room or two lost all of it; the ground floor's came off its lower part with the damp and the splash)
            if (rng.NextDouble() < 0.18) continue;
            if (f == 0) y0 += 0.4f + 0.5f * (float)rng.NextDouble();
            var wash = Limewash[rng.Next(Limewash.Length)];
            // a wide room had a partition against this wall: its chase splits the coat in two
            var spans = new List<(float A, float B)> { (x0, x1) };
            if (x1 - x0 > 4f)
            {
                float cut = x0 + (x1 - x0) * (0.35f + 0.3f * (float)rng.NextDouble());
                spans = new() { (x0, cut - 0.08f), (cut + 0.08f, x1) };
            }
            foreach (var (a0, a1) in spans)
            {
                // the coat: the room's rectangle, its floor and ceiling edges chopped ragged where the joists and the
                // ceiling came away (a few cm, now and then a bite of 30-45 cm); its ends straight, where the front and
                // back walls stood against it
                float ph = (float)rng.NextDouble() * 100;
                int n = Math.Max(2, (int)((a1 - a0) / 0.12f));
                // (small losses all along, a few bigger bites, three octaves so no edge repeats)
                float Bite(Vector2 p) => Math.Min(0.02f + Noise(p * 6.3f + new Vector2(ph, f)) * 0.07f + Noise(p * 17f + new Vector2(f, ph)) * 0.04f
                    + Math.Max(0, Noise(p * 1.3f + new Vector2(f * 7, ph)) - 0.5f) * 1.1f, 0.3f * (y1 - y0));
                // most coats lost a ragged piece at one end too: there the coat narrows to nothing over 0.4-1.4 m
                float lossL = rng.NextDouble() < 0.35 ? 0.4f + (float)rng.NextDouble() : 0, lossR = rng.NextDouble() < 0.45 ? 0.4f + (float)rng.NextDouble() : 0;
                float waist = (y0 + y1) / 2 + ((float)rng.NextDouble() - 0.5f) * 0.3f * (y1 - y0);
                var low = new Vector2[n + 1]; var high = new Vector2[n + 1];
                for (int k = 0; k <= n; k++)
                {
                    float x = a0 + (a1 - a0) * k / n;
                    float lo = y0 + Bite(new Vector2(x, y0)), hi = y1 - Bite(new Vector2(x, y1));
                    float t = Math.Max(lossL > 0 ? 1 - (x - a0) / lossL : 0, lossR > 0 ? 1 - (a1 - x) / lossR : 0);
                    if (t > 0)
                    {
                        float shrink = MathF.Pow(Math.Clamp(t, 0, 1), 0.7f) * (0.75f + 0.25f * Noise(new Vector2(x * 4.1f, f + ph)));
                        lo += (waist - 0.03f - lo) * shrink; hi -= (hi - waist - 0.03f) * shrink;
                    }
                    low[k] = new Vector2(x, lo); high[k] = new Vector2(x, Math.Max(hi, lo + 0.04f));
                }
                // (wear under 0.55: the shader's fallen-plaster holes read as a black stipple at this size)
                Coat(plaster, W, low, high, new Color(wash.R, wash.G, wash.B, 0.5f));
                quads++;
            }
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
        // its chimney breast: the flue's soot up the wall, a fireplace's soot on every floor (only on a stretch wide enough for a room)
        float fs = s0 + (s1 - s0) * (0.35f + 0.3f * (float)rng.NextDouble());
        if (w.Flue)
        {
            float flTop = hg;
            if (w.Rise > 0.3f) flTop = Math.Min(cap, hg + w.Rise * Math.Max(0, 1 - Math.Abs(fs - mid) / Math.Max(0.1f, (s1 - s0) / 2)));
            Quad(st, W(fs - 0.28f, 0.9f, 0.017f), W(fs + 0.28f, 0.9f, 0.017f), W(fs + 0.28f, flTop, 0.017f), W(fs - 0.28f, flTop, 0.017f),
                new(0.2f, 0.3f), new(0.8f, 0.3f), new(0.8f, 0.7f), new(0.2f, 0.7f), Soot, SootTint, 1);
            quads++;
            foreach (float y in floors.Prepend(0f))
            {
                Quad(st, W(fs - 0.6f, y + 0.1f, 0.018f), W(fs + 0.6f, y + 0.1f, 0.018f), W(fs + 0.6f, y + 1.5f, 0.018f), W(fs - 0.6f, y + 1.5f, 0.018f),
                    new(0.01f, 0.01f), new(0.99f, 0.01f), new(0.99f, 0.99f), new(0.01f, 0.99f), Soot, SootTint, 1);
                quads++;
            }
        }
        // a patch of wallpaper in most rooms, each room its own paper
        foreach (float y in w.Flue ? floors.Prepend(0f) : Enumerable.Empty<float>())
        {
            var paper = Wallpaper[rng.Next(Wallpaper.Length)];
            if (rng.NextDouble() >= 0.7) continue;
            float pw = 0.9f + 0.9f * (float)rng.NextDouble(), ph = 1.0f + 0.7f * (float)rng.NextDouble();
            float lo = s0 + 0.4f + pw / 2, hi = Math.Max(lo + 0.1f, s1 - 0.4f - pw / 2);
            float c = lo + (hi - lo) * (float)rng.NextDouble();
            float ylo = y + 0.6f, yhi = Math.Max(y + 0.7f, Math.Min(StoreyH, hg - y) + y - ph - 0.3f);
            float yy = ylo + (yhi - ylo) * (float)rng.NextDouble();
            if (yy + ph > hg - 0.2f || Math.Abs(c - fs) < 0.3f + pw / 2 || c + pw / 2 > s1 - 0.2f) continue;
            Quad(st, W(c - pw / 2, yy, 0.0175f), W(c + pw / 2, yy, 0.0175f), W(c + pw / 2, yy + ph, 0.0175f), W(c - pw / 2, yy + ph, 0.0175f),
                new(0.01f, 0.01f), new(0.99f, 0.01f), new(0.99f, 0.99f), new(0.01f, 0.99f), Scrap, paper, 1);
            quads++;
        }
        // damp rising at the foot, where the house's floor kept the wall dry and now the rain splashes on it (over the
        // coats too)
        Quad(st, W(s0, 0.0f, 0.0172f), W(s1, 0.0f, 0.0172f), W(s1, 1.1f, 0.0172f), W(s0, 1.1f, 0.0172f),
            new(0, 0.01f), new(L / 1.4f, 0.01f), new(L / 1.4f, 0.99f), new(0, 0.99f), Damp, DampTint, 1);
        quads++;
        // and the rain run down the bared wall from its top since the summer: a streaked stain or two over brick and coats
        for (int k = 0, runs = 1 + (int)(L / 4f); k < runs; k++)
        {
            float rs = s0 + 0.3f + (L - 0.6f) * (float)rng.NextDouble(), rw = 0.5f + 0.7f * (float)rng.NextDouble();
            float rt = hg - 0.1f, rb = Math.Max(0.5f, hg * (0.3f + 0.4f * (float)rng.NextDouble()));
            Quad(st, W(rs - rw / 2, rb, 0.0174f), W(rs + rw / 2, rb, 0.0174f), W(rs + rw / 2, rt, 0.0174f), W(rs - rw / 2, rt, 0.0174f),
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

    // the rooms' old limewash and distemper (the vertex colour over the unpainted rough plaster): lime white, a grey, a
    // buff, a faded green-grey, a faded pink
    // (darkened by a summer's rain and smoke: Codex's old lime plaster #B5AA90 over the light plaster picture)
    private static readonly Color[] Limewash = { new(0.43f, 0.4f, 0.35f), new(0.38f, 0.37f, 0.34f), new(0.43f, 0.39f, 0.31f), new(0.36f, 0.38f, 0.34f), new(0.42f, 0.36f, 0.33f) };

    /// <summary>
    /// A coat of plaster on the wall: the ragged ring (s, y on the wall) as a face 15 mm out, its broken edge a 4 mm
    /// rounded lip and then straight back to the brick.
    /// </summary>
    private static void Coat(SurfaceTool st, Func<float, float, float, Vector3> W, Vector2[] bottom, Vector2[] top, Color tone)
    {
        // (the ring: the bottom edge left to right, the top edge right to left; the face in upright strips between the
        // two edges, so the light interpolated over it never draws a fan's diagonals)
        var ring = bottom.Concat(top.Reverse()).ToList();
        var centre = ring.Aggregate(Vector2.Zero, (s, p) => s + p) / ring.Count;
        const float T = 0.015f, Lip = 0.004f;
        var cell = WallCell ?? Vector2.Zero;
        // (each triangle its own flat normal, facing out of the wall: no shading creases along the fan)
        var outward = (W(centre.X, centre.Y, 1) - W(centre.X, centre.Y, 0)).Normalized();
        void F(Vector3 a, Vector3 b, Vector3 c)
        {
            var n = (b - a).Cross(c - a);
            if (n.LengthSquared() < 1e-14f) return;
            n = n.Normalized();
            if (n.Dot(outward) < -0.2f) { (b, c) = (c, b); n = -n; }
            // (Godot's front face winds clockwise as seen: a, c, b; wound the other way the two-sided shader turns the
            // normal into the wall and the lights inside the house lit the coat at night)
            foreach (var p in new[] { a, c, b }) { st.SetNormal(n); st.SetColor(tone); st.SetUV(WallUv); st.SetUV2(cell); st.SetCustom(0, new Color(RoughPicture, 1, 0, 0)); st.AddVertex(p); }
        }
        Vector2 In(Vector2 p, int side) => side == 0 ? p + new Vector2(0, Lip) : p - new Vector2(0, Lip);
        var inner = bottom.Select(p => In(p, 0)).Concat(top.Reverse().Select(p => In(p, 1))).ToList();
        // (the end corners pulled in along the wall too)
        int last = bottom.Length - 1;
        foreach (int k in new[] { 0, last, last + 1, ring.Count - 1 })
            inner[k] += new Vector2(k == 0 || k == ring.Count - 1 ? Lip : -Lip, 0);
        // the face
        for (int k = 0; k < last; k++)
        {
            Vector2 b0 = inner[k], b1 = inner[k + 1], t0 = inner[ring.Count - 1 - k], t1 = inner[ring.Count - 2 - k];
            F(W(b0.X, b0.Y, T), W(b1.X, b1.Y, T), W(t1.X, t1.Y, T));
            F(W(b0.X, b0.Y, T), W(t1.X, t1.Y, T), W(t0.X, t0.Y, T));
        }
        for (int k = 0; k < ring.Count; k++)
        {
            int j = (k + 1) % ring.Count;
            // the lip
            F(W(inner[k].X, inner[k].Y, T), W(ring[k].X, ring[k].Y, T - Lip), W(ring[j].X, ring[j].Y, T - Lip));
            F(W(inner[k].X, inner[k].Y, T), W(ring[j].X, ring[j].Y, T - Lip), W(inner[j].X, inner[j].Y, T));
            // the broken edge back to the brick
            F(W(ring[k].X, ring[k].Y, T - Lip), W(ring[k].X, ring[k].Y, 0), W(ring[j].X, ring[j].Y, 0));
            F(W(ring[k].X, ring[k].Y, T - Lip), W(ring[j].X, ring[j].Y, 0), W(ring[j].X, ring[j].Y, T - Lip));
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

    // ------------------------------------------------------------------ the things

    /// <summary>The kit's authored objects (the pump) and the town's guard stones, before collision and navigation read the town.</summary>
    public static int Install(Node3D town, Plan plan)
    {
        var holder = Holder(town);
        int placed = 0;
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
                    var o = new AuthoredObject { Name = "kit_" + t.Id.Replace('-', '_'), ObjectId = t.Id, Asset = asset, Position = at, Rotation = new Vector3(0, Mathf.DegToRad(t.Yaw), 0) };
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
