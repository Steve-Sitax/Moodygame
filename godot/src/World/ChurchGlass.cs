using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The churches' stained glass (Steve, 2026-10-27: "glitches, weird artifacts or contours of other buildings behind it
/// when seeing through it ... you could not make out what is on the other side"). Each church room carries its windows
/// twice on the same faces: a street layer (<c>&lt;id&gt;_street_glass</c>, <c>&lt;id&gt;_x_street_glass</c>, the
/// cathedral's <c>..._glass_out</c>) seen from outside, and a room layer (<c>&lt;id&gt;_hall_glass</c>,
/// <c>&lt;id&gt;_x_room_glass</c>, the cathedral's <c>cathedral_stained_glass</c>, <c>cathedral_clear_glass</c>) seen
/// from inside. The bake had both see-through (alpha 0.4 to 0.9, no depth), the parish churches' room layers facing out
/// (three's back side, lost in the conversion), and the glass at its midday brightness all night.
/// Here, once:
/// - each layer becomes solid glass of the town's plain lit kind (the street layer the outdoor one, the room layer the
///   room's: kinds the town already draws, no new shader): its face (ChurchGlassArt's face picture) takes the light that
///   falls on it, the day's sky outside, the church's candles and lamps inside; the light coming through it is its
///   emission (the colour picture), from inside by day the daylight, from outside after dark the lit church;
/// - the parish churches' windows and the cathedral's plain and smaller stained ones are laid out anew on
///   ChurchGlassArt's pictures at their true size (round 2, Codex's review: the bake stretched one 32 x 96 px cell with its
///   painted stone rim over every window): a window wider than about 1.45 m is cut into lights of equal width, each a
///   column of glass (the same design across one window, the middle one of three or more another), set at a panel's
///   edge by the window's own number, so two windows alike in size seldom look alike; round windows take a rose; the
///   cathedral's great windows keep their saints, every other one mirrored;
/// - a room layer that faces out is turned to face in, and the street layer leaves the room's node, so it still closes
///   the windows when the room is hidden far off (on the town's own layer: the river's mirrors see it);
/// - the churches' lead-grid window lights (landmark_window_light, 3 cm out) are put out: the glass shows its own light,
///   and its light on the stone round the windows (the "churches window" spill) is cut to a third.
/// Every frame (when it changes) the emission follows the daylight and the church's lamps.
/// </summary>
[GamePart(52)]
public partial class ChurchGlass : Node
{
    private static readonly string[] Churches = { "stpaul", "stjacob", "carolus" };

    /// <summary>A layer's material and how it is lit: from the street (the lamps inside after dark) or from the room (the
    /// daylight), and its own strength.</summary>
    private readonly List<(ShaderMaterial m, bool street, float gain)> mats = new();
    private Vector3 last = new(-1, -1, -1);

    /// <summary>For a check: street layers and room layers made solid, room layers turned to face in, street layers kept
    /// outside the room, windows laid out anew.</summary>
    public static (int street, int room, int turned, int kept, int windows) Info { get; private set; }

    private enum Family { Stained, Plain, Rose, Keep }

    /// <summary>Which column designs and roses a church's windows take.</summary>
    private static readonly Dictionary<string, (int[] stained, int plain, int[] roses)> Sets = new()
    {
        ["stpaul"] = (new[] { 0, 2, 4, 1 }, ChurchGlassArt.PlainWarm, new[] { 0, 2 }),
        ["stjacob"] = (new[] { 1, 3, 5, 2 }, ChurchGlassArt.PlainWarm, new[] { 1, 3 }),
        ["carolus"] = (new[] { ChurchGlassArt.Plain }, ChurchGlassArt.Plain, new[] { 4, 5 }),
        ["cathedral"] = (new[] { 0, 3, 4, 5 }, ChurchGlassArt.PlainCathedral, new[] { 0, 1 }),
    };

    public override void _Ready()
    {
        var meshes = BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.Mesh.GetSurfaceCount() == 1).ToList();
        // the town's plain lit kinds, outdoor and in a room (Rooms has made the rooms' by now): no new shader
        var kinds = new HashSet<Psx.Kind>();
        var shaderOf = new Dictionary<Psx.Kind, Shader>();
        foreach (var m in meshes)
            if (m.Mesh!.SurfaceGetMaterial(0) is ShaderMaterial sm && Psx.KindOf(sm.Shader) is { } k && kinds.Add(k)) shaderOf[k] = sm.Shader;
        var outdoor = PlainLit(kinds, false);
        var indoorK = PlainLit(kinds, true) ?? outdoor;
        var byName = new Dictionary<string, MeshInstance3D>();
        foreach (var m in meshes)
            if (m.Mesh!.SurfaceGetMaterial(0) is ShaderMaterial sm && sm.ResourceName.Length > 0) byName.TryAdd(sm.ResourceName, m);
        if (outdoor is not { } streetKind || indoorK is not { } roomKind)
        {
            GD.PushWarning("church glass: no plain lit kind in the town; the glass is left as it was");
            SetProcess(false);
            return;
        }
        GD.Print($"church glass: street layers {Describe(streetKind)}, room layers {Describe(roomKind)}");
        var t0 = Time.GetTicksMsec();
        var (colour, face) = ChurchGlassArt.Build();
        GD.Print($"church glass: pictures drawn in {Time.GetTicksMsec() - t0} ms");

        var layers = new List<(string name, string church, bool street)>();
        foreach (var c in Churches)
            layers.AddRange(new[] { (c + "_street_glass", c, true), (c + "_x_street_glass", c, true), (c + "_hall_glass", c, false), (c + "_x_room_glass", c, false) });
        layers.AddRange(new[] { ("cathedral_stained_glass_out", "cathedral", true), ("cathedral_clear_glass_out", "cathedral", true), ("cathedral_stained_glass", "cathedral", false), ("cathedral_clear_glass", "cathedral", false) });
        int s = 0, r = 0, turned = 0, kept = 0, windows = 0;
        var saintsFace = new Dictionary<Texture2D, ImageTexture>();
        foreach (var (name, church, street) in layers)
        {
            if (!byName.TryGetValue(name, out var mi) || mi.Mesh!.SurfaceGetMaterial(0) is not ShaderMaterial old || Psx.KindOf(old.Shader) is not { Unlit: true }) continue;
            var shader = shaderOf[street ? streetKind : roomKind];
            bool turn = !street && FacesOut(mi.Mesh!);
            bool clear = name.Contains("clear");
            bool saints = church == "cathedral" && !clear;
            float gain = church == "carolus" ? (street ? CarolusNightGain : CarolusGain) : clear ? PlainNightGain : 1;
            var atlas = MakeMaterial(old, shader, face, colour, true);
            ShaderMaterial? keep = null;
            if (saints && old.GetShaderParameter("tex").Obj is Texture2D pic)
            {
                if (!saintsFace.TryGetValue(pic, out var pf)) saintsFace[pic] = pf = FaceOf(pic);
                keep = MakeMaterial(old, shader, pf, pic, false);
            }
            var (mesh, count) = Rebuild(mi.Mesh!, turn, church, name, atlas, keep);
            mi.Mesh = mesh;
            // (it is solid now: the wall round it shades the sun already)
            mi.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
            windows += count;
            mats.Add((atlas, street, gain));
            if (keep != null) mats.Add((keep, street, gain));
            if (turn) turned++;
            if (street)
            {
                s++;
                // (out of the room: a room far off is hidden, and its windows were open holes into the empty church)
                if (RoomOf(mi)?.GetParent() is Node3D outside)
                {
                    mi.Reparent(outside, true);
                    kept++;
                }
                mi.Layers = 1;
            }
            else r++;
        }
        // the churches' window lights at night (the old lead grid in lamplight, 3 cm out of the glass) out: the glass glows
        // in its own colours, its own leads dark
        if (Lights.I != null && s > 0)
        {
            foreach (var m in meshes)
                if (m.Mesh!.SurfaceGetMaterial(0) is ShaderMaterial wm && wm.ResourceName == "landmark_window_light"
                    && (m.Name.ToString().StartsWith("church_", StringComparison.Ordinal) || m.Name.ToString().StartsWith("landmark_cathedral_lit_glass", StringComparison.Ordinal)))
                    Lights.I.LandmarkGain[wm] = 0;
            int dimmed = Lights.I.ScaleWindows("churches window", WindowSpill) + Lights.I.ScaleWindows("cathedral_outside window", WindowSpill);
            GD.Print($"church glass: {dimmed} window lights on the street at {WindowSpill:0.##} of their power");
        }
        // (the cathedral's added amber over its whole glass at night hid the colours: its street layer glows itself now)
        if (s > 0 && byName.TryGetValue("cathedral_window_glow", out var glow)) glow.Visible = false;
        Info = (s, r, turned, kept, windows);
        GD.Print($"church glass: {s} street layers and {r} room layers solid and lit, {windows} windows laid out, {turned} room layers turned to face in, {kept} street layers kept outside their room");
        if (s + r == 0) SetProcess(false);
    }

    private static string Describe(Psx.Kind k) => $"lit{(k.Indoor ? " indoor" : "")}{(k.Fog ? ", fog" : "")}{(k.TwoSided ? ", two-sided" : "")}{(k.VertexColor ? ", vertex colour" : "")}";

    /// <summary>The town's plain lit, solid kind (no picture tricks, no wall, ground, water or tree): the one nearest a
    /// pane's needs (fogged, one-sided), outdoor or in a room.</summary>
    private static Psx.Kind? PlainLit(IEnumerable<Psx.Kind> kinds, bool indoor) =>
        kinds.Where(k => k is { Unlit: false, Blend: false, Add: false, Scissor: false, Snap: false, Atlas: 0, Relief: 0, Parallax: false, Detile: false, Ground: false,
                Wall: false, Slabs: false, Far: false, Water: 0, Grime: 0, Bump: false, Decal: false, Tree: 0, NameCell: 0, TideWet: false } && k.Indoor == indoor)
            .OrderByDescending(k => (k.Fog ? 4 : 0) + (k.TwoSided ? 0 : 2) + (k.VertexColor ? 0 : 1)).Cast<Psx.Kind?>().FirstOrDefault();

    /// <summary>The glass's own material on the lit kind: its face the picture the light falls on, the light through it the
    /// emission (dark until _Process sets it).</summary>
    private static ShaderMaterial MakeMaterial(ShaderMaterial old, Shader shader, Texture2D face, Texture2D through, bool laidOut)
    {
        var made = (ShaderMaterial)old.Duplicate();
        made.Shader = shader;
        made.ResourceName = old.ResourceName + (laidOut ? "_leaded" : "_saints");
        made.SetShaderParameter("tex", face);
        made.SetShaderParameter("emission_tex", through);
        made.SetShaderParameter("albedo", new Color(FaceGain, FaceGain, FaceGain).LinearToSrgb() with { A = 1 });
        made.SetShaderParameter("emission", new Color(0, 0, 0));
        made.SetShaderParameter("fill", 0f);
        if (laidOut) made.SetShaderParameter("uv_xform", new Vector4(1, 1, 0, 0));
        return made;
    }

    /// <summary>The face of a picture of glass (the cathedral's saints): slate with a little of its colour, uneven.</summary>
    private static ImageTexture FaceOf(Texture2D pic)
    {
        var img = (Image)pic.GetImage().Duplicate();
        if (img.IsCompressed()) img.Decompress();
        img.ClearMipmaps();
        img.Convert(Image.Format.Rgb8);
        int w = img.GetWidth(), h = img.GetHeight();
        var data = img.GetData();
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int o = (y * w + x) * 3;
                float n = 0.78f + 0.4f * (0.5f + 0.5f * MathF.Sin(x * 0.37f + 1.3f * MathF.Sin(y * 0.11f)) * MathF.Sin(y * 0.23f + x * 0.05f));
                data[o] = Face(data[o], 0.28f, n);
                data[o + 1] = Face(data[o + 1], 0.34f, n);
                data[o + 2] = Face(data[o + 2], 0.40f, n);
            }
        var made = Image.CreateFromData(w, h, false, Image.Format.Rgb8, data);
        made.GenerateMipmaps();
        return ImageTexture.CreateFromImage(made);
    }

    private static byte Face(byte c, float slate, float n) => (byte)Math.Clamp((int)(((slate * 0.62f + c / 255f * 0.6f * 0.38f) * n) * 255 + 0.5f), 0, 255);

    /// <summary>The room node a mesh stands in (ROOM_&lt;id&gt;), or null.</summary>
    private static Node? RoomOf(Node n)
    {
        for (var q = n.GetParent(); q != null; q = q.GetParent()) if (q.Name.ToString().StartsWith("ROOM_", StringComparison.Ordinal)) return q;
        return null;
    }

    private static (Vector3[] v, Vector2[] uv, int[] idx) Arrays(Mesh mesh)
    {
        var arrays = mesh.SurfaceGetArrays(0);
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var uv = arrays[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.Nil ? new Vector2[v.Length] : arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var idx = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        return (v, uv, idx);
    }

    /// <summary>Whether most of a layer's faces are turned away from its own middle (the church's inside).</summary>
    private static bool FacesOut(Mesh mesh)
    {
        var (v, _, idx) = Arrays(mesh);
        var mid = mesh.GetAabb().GetCenter();
        int count = idx.Length / 3, outward = 0;
        for (int t = 0; t < count; t++)
        {
            Vector3 a = v[idx[t * 3]], b = v[idx[t * 3 + 1]], c = v[idx[t * 3 + 2]];
            // (Godot's front face winds clockwise: its normal is (c - a) x (b - a))
            var n = (c - a).Cross(b - a);
            var at = (a + b + c) / 3 - mid;
            if (n.X * at.X + n.Z * at.Z > 0) outward++;
        }
        return outward * 2 > count;
    }

    /// <summary>One window of a layer: its triangles, its plane's way across (u, canonical whichever way it faces), its
    /// extent and the old picture's corner and size.</summary>
    private sealed class Window
    {
        public readonly List<int> Tris = new();
        public Vector3 Across;
        public float U0, U1, Y0, Y1, Area;
        public Vector2 UvMin = new(1e9f, 1e9f), UvMax = new(-1e9f, -1e9f);
        public Vector3 Mid;
        public float W => U1 - U0;
        public float H => Y1 - Y0;
    }

    /// <summary>The windows of a layer (its connected pieces, by shared corners).</summary>
    private static List<Window> Windows(Vector3[] v, Vector2[] uv, int[] idx)
    {
        var key = new Dictionary<(int, int, int), int>();
        var rep = new int[v.Length];
        for (int i = 0; i < v.Length; i++)
        {
            var k = ((int)MathF.Round(v[i].X * 200), (int)MathF.Round(v[i].Y * 200), (int)MathF.Round(v[i].Z * 200));
            if (!key.TryGetValue(k, out var first)) key[k] = first = i;
            rep[i] = first;
        }
        var parent = Enumerable.Range(0, v.Length).ToArray();
        int Find(int x)
        {
            while (parent[x] != x) x = parent[x] = parent[parent[x]];
            return x;
        }
        for (int t = 0; t + 2 < idx.Length; t += 3)
        {
            int a = Find(rep[idx[t]]);
            parent[Find(rep[idx[t + 1]])] = a;
            parent[Find(rep[idx[t + 2]])] = a;
        }
        var groups = new Dictionary<int, Window>();
        for (int t = 0; t + 2 < idx.Length; t += 3)
        {
            int g = Find(rep[idx[t]]);
            if (!groups.TryGetValue(g, out var w)) groups[g] = w = new Window();
            w.Tris.Add(t);
        }
        foreach (var w in groups.Values)
        {
            var n = Vector3.Zero;
            foreach (var t in w.Tris) n += (v[idx[t + 2]] - v[idx[t]]).Cross(v[idx[t + 1]] - v[idx[t]]);
            n.Y = 0;
            if (n.LengthSquared() < 1e-8f) n = Vector3.Back;
            n = n.Normalized();
            // (the same way across from either side: both layers of a window take the same picture in the same place)
            if (n.X < -0.01f || (MathF.Abs(n.X) <= 0.01f && n.Z < 0)) n = -n;
            w.Across = Vector3.Up.Cross(n).Normalized();
            w.U0 = w.Y0 = 1e9f;
            w.U1 = w.Y1 = -1e9f;
            var sum = Vector3.Zero;
            foreach (var t in w.Tris)
                for (int j = 0; j < 3; j++)
                {
                    var p = v[idx[t + j]];
                    float u = p.Dot(w.Across);
                    w.U0 = MathF.Min(w.U0, u); w.U1 = MathF.Max(w.U1, u);
                    w.Y0 = MathF.Min(w.Y0, p.Y); w.Y1 = MathF.Max(w.Y1, p.Y);
                    var q = uv[idx[t + j]];
                    w.UvMin = new Vector2(MathF.Min(w.UvMin.X, q.X), MathF.Min(w.UvMin.Y, q.Y));
                    w.UvMax = new Vector2(MathF.Max(w.UvMax.X, q.X), MathF.Max(w.UvMax.Y, q.Y));
                    sum += p;
                }
            w.Mid = sum / (w.Tris.Count * 3);
            foreach (var t in w.Tris) w.Area += (v[idx[t + 2]] - v[idx[t]]).Cross(v[idx[t + 1]] - v[idx[t]]).Length() / 2;
        }
        return groups.Values.ToList();
    }

    /// <summary>A window's glass by the bake's old picture and its shape.</summary>
    private static Family FamilyOf(Window w, string church, string layer)
    {
        if (layer.Contains("clear")) return Family.Plain;
        if (church == "cathedral") return w.H >= 10.5f && w.W / w.H > 0.3f ? Family.Keep : Family.Stained;
        if (MathF.Abs(w.W - w.H) < 0.25f * MathF.Max(w.W, w.H) && w.Area < 0.85f * w.W * w.H && w.W < 3.2f) return Family.Rose;
        if (church == "carolus") return Family.Plain;
        var c = (w.UvMin + w.UvMax) / 2;
        // (the bake's plain cells: the leaded-rectangle lancet and the small square-paned window)
        if ((c.X >= 0.125f && c.X < 0.25f && c.Y >= 0.1875f && c.Y < 0.5f) || (c.X >= 0.375f && c.X < 0.5f && c.Y >= 0.4375f && c.Y < 0.625f)) return Family.Plain;
        return Family.Stained;
    }

    private static uint Hash(Vector3 p)
    {
        uint h = (uint)(int)MathF.Round(p.X * 10) * 73856093u ^ (uint)(int)MathF.Round(p.Y * 10) * 19349663u ^ (uint)(int)MathF.Round(p.Z * 10) * 83492791u;
        h ^= h >> 13; h *= 0x5bd1e995; h ^= h >> 15;
        return h;
    }

    /// <summary>A layer's glass made anew: each window on its column (or rose, or kept saints), turned if it must face in.
    /// Surface 0 the laid-out glass, surface 1 the kept saints (if any).</summary>
    private static (ArrayMesh, int) Rebuild(Mesh mesh, bool turn, string church, string layer, Material atlas, Material? keep)
    {
        var (v, uv, idx) = Arrays(mesh);
        var set = Sets[church];
        var laid = new Builder();
        var kept = new Builder();
        var windows = Windows(v, uv, idx);
        foreach (var w in windows)
        {
            uint h = Hash(w.Mid);
            var family = FamilyOf(w, church, layer);
            if (family == Family.Keep && keep == null) family = Family.Stained;
            if (family == Family.Keep)
            {
                // the saints, every other window mirrored
                bool flip = (h & 1) == 1;
                foreach (var t in w.Tris)
                {
                    Vector2 F(Vector2 q) => flip ? new Vector2(w.UvMin.X + w.UvMax.X - q.X, q.Y) : q;
                    kept.Tri(v[idx[t]], v[idx[t + 1]], v[idx[t + 2]], F(uv[idx[t]]), F(uv[idx[t + 1]]), F(uv[idx[t + 2]]), turn);
                }
                continue;
            }
            if (family == Family.Rose)
            {
                int rose = set.roses[(int)(h % (uint)set.roses.Length)];
                float rx = ChurchGlassArt.RoseX + 2, ry = rose * ChurchGlassArt.RoseCell + 2, side = ChurchGlassArt.RoseCell - 4;
                Vector2 R(Vector3 p) => new((rx + (p.Dot(w.Across) - w.U0) / w.W * side) / ChurchGlassArt.Size, (ry + (w.Y1 - p.Y) / w.H * side) / ChurchGlassArt.Size);
                foreach (var t in w.Tris) laid.Tri(v[idx[t]], v[idx[t + 1]], v[idx[t + 2]], R(v[idx[t]]), R(v[idx[t + 1]]), R(v[idx[t + 2]]), turn);
                continue;
            }
            // lights of equal width, each a column at its true size; the outer ones one design, the middle ones another
            int n = Math.Max(1, (int)MathF.Ceiling(w.W / LightWidth - 0.04f));
            float lw = w.W / n;
            int[] designs = family == Family.Plain ? new[] { set.plain } : set.stained;
            int outer = designs[(int)(h % (uint)designs.Length)], middle = designs[(int)((h % (uint)designs.Length + 1 + (h / 7) % (uint)Math.Max(1, designs.Length - 1)) % (uint)designs.Length)];
            float ppm = (ChurchGlassArt.ColW - 2) / lw;
            // (the window's foot on a panel's edge, which panel by its number)
            float foot = ((h / 49) % (ChurchGlassArt.Size / ChurchGlassArt.Panel) + 1) * ChurchGlassArt.Panel;
            for (int j = 0; j < n; j++)
            {
                int col = j == 0 || j == n - 1 ? outer : middle;
                float x0 = j * lw, x1 = (j + 1) * lw;
                float cx = col * ChurchGlassArt.ColW + 1;
                Vector2 Uv(Vector3 p) => new((cx + (p.Dot(w.Across) - w.U0 - x0) * ppm) / ChurchGlassArt.Size, (foot - (p.Y - w.Y0) * ppm) / ChurchGlassArt.Size);
                foreach (var t in w.Tris)
                    foreach (var piece in Clip(new[] { v[idx[t]], v[idx[t + 1]], v[idx[t + 2]] }, w, j == 0 ? -1e6f : x0, j == n - 1 ? 1e6f : x1))
                        laid.Tri(piece.a, piece.b, piece.c, Uv(piece.a), Uv(piece.b), Uv(piece.c), turn);
            }
        }
        var made = new ArrayMesh { ResourceName = mesh.ResourceName };
        laid.AddTo(made, atlas);
        if (keep != null) kept.AddTo(made, keep);
        return (made, windows.Count);
    }

    /// <summary>The part of a triangle between two cuts across its window (x from the window's left edge): a fan of triangles,
    /// the same winding. A cut point is worked out from the edge's ends in one order, so neighbours share it exactly.</summary>
    private static IEnumerable<(Vector3 a, Vector3 b, Vector3 c)> Clip(Vector3[] tri, Window w, float x0, float x1)
    {
        var poly = new List<Vector3>(tri);
        poly = Cut(poly, w, x0, true);
        if (poly.Count >= 3) poly = Cut(poly, w, x1, false);
        for (int i = 1; i + 1 < poly.Count; i++) yield return (poly[0], poly[i], poly[i + 1]);
    }

    private static List<Vector3> Cut(List<Vector3> poly, Window w, float at, bool keepAbove)
    {
        var res = new List<Vector3>(poly.Count + 2);
        float X(Vector3 p) => p.Dot(w.Across) - w.U0;
        bool In(Vector3 p) => keepAbove ? X(p) >= at : X(p) <= at;
        for (int i = 0; i < poly.Count; i++)
        {
            var a = poly[i];
            var b = poly[(i + 1) % poly.Count];
            bool ia = In(a), ib = In(b);
            if (ia) res.Add(a);
            if (ia != ib)
            {
                // (one order for the edge, whichever way it is walked)
                var (p, q) = X(a) < X(b) || (X(a) == X(b) && a.Y < b.Y) ? (a, b) : (b, a);
                float k = (at - X(p)) / (X(q) - X(p));
                res.Add(p.Lerp(q, k));
            }
        }
        return res;
    }

    /// <summary>A surface's triangles as they are made (no index: a few hundred per layer).</summary>
    private sealed class Builder
    {
        private readonly List<Vector3> v = new(), n = new();
        private readonly List<Vector2> uv = new();

        public void Tri(Vector3 a, Vector3 b, Vector3 c, Vector2 ua, Vector2 ub, Vector2 uc, bool turn)
        {
            if (turn) { (b, c) = (c, b); (ub, uc) = (uc, ub); }
            var nn = (c - a).Cross(b - a);
            if (nn.LengthSquared() < 1e-12f) return;
            nn = nn.Normalized();
            v.Add(a); v.Add(b); v.Add(c);
            uv.Add(ua); uv.Add(ub); uv.Add(uc);
            n.Add(nn); n.Add(nn); n.Add(nn);
        }

        public void AddTo(ArrayMesh mesh, Material material)
        {
            if (v.Count == 0) return;
            var arrays = new Godot.Collections.Array();
            arrays.Resize((int)Mesh.ArrayType.Max);
            arrays[(int)Mesh.ArrayType.Vertex] = v.ToArray();
            arrays[(int)Mesh.ArrayType.Normal] = n.ToArray();
            arrays[(int)Mesh.ArrayType.TexUV] = uv.ToArray();
            arrays[(int)Mesh.ArrayType.Color] = Enumerable.Repeat(new Color(1, 1, 1, 1), v.Count).ToArray();
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, material);
        }
    }

    /// <summary>A light no wider than this (m); a wider window is cut into lights of equal width.</summary>
    private const float LightWidth = 1.45f;
    /// <summary>The glass's face (its albedo, linear, over the face picture): how much of the light falling on it it gives back.</summary>
    private const float FaceGain = 2.2f;
    /// <summary>The churches' window light on the street round the windows, at this share of its power (Codex: the stone
    /// round the windows outshone the glass).</summary>
    private const float WindowSpill = 0.35f;
    /// <summary>Sint-Carolus's pale plain glass lets through more than coloured glass: its light at this share (Codex: 35 to 50 % less).</summary>
    private const float CarolusGain = 0.6f;
    /// <summary>... and from the street after dark (its blue-grey panes pass the warm lamplight dimly anyway).</summary>
    private const float CarolusNightGain = 0.9f;
    /// <summary>The cathedral's plain windows at night, at this share, below its stained ones (Codex: 25 to 40 % less; their pale glass passes more than the stained).</summary>
    private const float PlainNightGain = 0.45f;
    /// <summary>The candles' and lamps' light inside, through the glass after dark (linear), and its strength from the street.</summary>
    private static readonly Vector3 Lamplight = new(1.0f, 0.78f, 0.55f);
    private const float StreetGlow = 0.9f;
    /// <summary>The daylight through the glass from inside (linear), and the moon's at night, a cold blue.</summary>
    private static readonly Vector3 DaySky = new(0.95f, 0.97f, 1.0f), Moon = new(0.55f, 0.65f, 0.9f);
    private const float DayThrough = 1.0f, NightThrough = 0.05f;

    /// <summary>The glass's light now: the street layer's face (the day's light on it), the room layer's (the daylight
    /// through it) and how lit the church is inside after dark (the landmarks' clock, Lights.cs: lit from 18:30 to 6:30).</summary>
    public static Vector3 Levels(Daylight day)
    {
        float daylight = 1 - day.Night;
        float sun = Mathf.Clamp(day.SunIntensity / 4.2f, 0, 1);
        float h = day.Hour;
        float dayK = Mathf.Clamp(h < 12 ? (h - 6.5f) / 3 : (18.5f - h) / 3, 0, 1);
        float lit = Mathf.Clamp((0.5f - dayK) / 0.3f, 0, 1);
        return new Vector3(daylight * (0.2f + 0.14f * sun) + 0.012f, daylight * (0.62f + 0.6f * sun), lit);
    }

    public override void _Process(double delta)
    {
        if (Daylight.I is not { } day) return;
        var k = Levels(day);
        if (MathF.Abs(k.X - last.X) < 0.003f && MathF.Abs(k.Y - last.Y) < 0.003f && MathF.Abs(k.Z - last.Z) < 0.003f) return;
        last = k;
        // from the street: after dark the lamps inside shining through it (by day its face only, the daylight on it)
        var street = Lamplight * (StreetGlow * k.Z);
        // from inside: the daylight through it; at night a little of the moon's
        float moon = Mathf.Clamp(1 - k.Y / 0.3f, 0, 1);
        var room = DaySky * (DayThrough * k.Y) + Moon * (NightThrough * moon);
        foreach (var (m, isStreet, gain) in mats)
        {
            var e = (isStreet ? street : room) * gain;
            // (a colour uniform is read as sRGB: the light adds in linear)
            UniformUpdates.Material(m, "emission", new Color(e.X, e.Y, e.Z).LinearToSrgb());
        }
    }
}
