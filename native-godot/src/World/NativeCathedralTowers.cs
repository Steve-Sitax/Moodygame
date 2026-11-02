using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>
/// Issue #260: the cathedral's west towers were see-through at every tall opening; the real towers are not (Steve's photo
/// of the west front, 2026-11-02). The shell (the retired bake's build_landmarks.py, `_real_stage` and the octagon) cut the
/// openings through with a reveal and set the mullions and transoms back into it; this fills them, level by level:
/// - the north tower's first two lancet stages (18-35.3 m, 36-54.8 m) and both of the south tower's stages: a grating of
///   light-painted iron flats set in the reveal behind the mullions (a frame round the opening's outline, upright flats and
///   lighter cross flats), and behind it the tower's stone wall with small windows (one low in each light, one in the arch
///   head);
/// - the north tower's bell stage (55.5-73.3 m) and the clock octagon's lancets (over the clocks and on the diagonal faces):
///   abat-sons, louvre boards of weathered dark oak sloping down and out, in frames set back in the reveal (a stile at each
///   side and one behind the mullion, a head along the arch); the bake's lead louvres there are taken out;
/// - the open upper octagon's piers, the crowns and the south tower's small lantern stay open.
/// One builder a kind (Grating, Louvres), fitted to each opening's own outline. The town's own materials (the shutters' kept
/// paint coloured by the vertex colours, the cathedral's ashlar and carved stone, the houses' glass, the wall iron): no new
/// shader kind, no light. No collision: nothing reaches the towers' stages (and the shell has none there).
/// (dev: --open-cathedral-towers leaves the towers as baked, for a before-and-after)
/// </summary>
public static class NativeCathedralTowers
{
    public const string Meta = "native_cathedral_towers";
    private const string Paint = "res://assets/materials/town-facades-20261018/shutter-paint-kept.tres";
    private const string Ashlar = "res://world/town/resources/r001835.res", Carved = "res://world/town/resources/r001872.res";
    private const string Glass = "res://world/town/resources/r001925.res", IronMaterial = "res://world/town/resources/r000615.res";
    // the shell's world frame: landmark u (from the west front, east) is world z, v (north) is world x (the lead louvres' and
    // the clock hands' places in the drawn shell)
    private const float CentreX = -262.0f, FrontZ = 145.53f;
    private const float TowerU = 9.2f, TowerV = 12.2f;
    private const float WestEaves = 40.15f;
    // the colours: light-painted iron (the photo's pale grating), weathered dark oak, the small windows' glazing bars
    private static readonly Color MetalPaint = new(0.62f, 0.62f, 0.57f);
    private static readonly Color OakGrey = new(0.085f, 0.068f, 0.054f);
    private static readonly Color Iron = new(0.30f, 0.29f, 0.27f);
    private const float AshlarUv = 0.3125f, CarvedUv = 0.625f, PaintUv = 0.5f;

    private enum Fill { Grating, Louvres }

    /// <summary>An opening of the shell: the face's corner (world), along it, out of it, the hole's outline (s along, y up),
    /// the reveal's depth, the mullion's middle (s) and the top of the mullion (y), and the fill.</summary>
    private sealed record Opening(string Name, Vector3 P, Vector3 D, Vector3 O, Vector2[] Hole, float Depth, float MullionS, float MullionTop, float Springing, Fill Kind);

    public static (int Gratings, int Louvres, int LeadRemoved, int Triangles) Install(Node3D town)
    {
        var openings = Openings();
        var paint = ResourceLoader.Load<Material>(Paint);
        var ashlar = ResourceLoader.Load<Material>(Ashlar);
        var carved = ResourceLoader.Load<Material>(Carved);
        var glass = ResourceLoader.Load<Material>(Glass);
        var iron = ResourceLoader.Load<Material>(IronMaterial);
        if (paint == null || ashlar == null || carved == null || glass == null || iron == null) return (0, 0, 0, 0);
        int removed = RemoveLeadLouvres(town);
        var holder = new Node3D { Name = "cathedral_tower_infill" };
        town.AddChild(holder);
        var metal = new Builder(); var oak = new Builder(); var wall = new Builder(); var stone = new Builder(); var pane = new Builder(); var bars = new Builder();
        var rng = new Random(260);
        int gratings = 0, louvres = 0;
        foreach (var op in openings)
        {
            if (op.Kind == Fill.Grating) { Grating(op, metal, wall, stone, pane, bars, rng); gratings++; }
            else { Louvres(op, oak, rng); louvres++; }
        }
        int tris = 0;
        void Add(string name, Builder b, Material m, float range)
        {
            if (b.Count == 0) return;
            tris += b.Count;
            var mi = new MeshInstance3D { Name = name, Mesh = b.Commit(m) };
            if (range > 0) { mi.VisibilityRangeEnd = range; mi.VisibilityRangeEndMargin = range * 0.1f; mi.VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self; }
            holder.AddChild(mi);
        }
        Add("grating", metal, paint, 320);
        Add("louvres", oak, paint, 0);
        Add("back_wall", wall, ashlar, 0);
        Add("window_reveals", stone, carved, 260);
        Add("window_glass", pane, glass, 0);
        Add("window_bars", bars, iron, 160);
        holder.SetMeta(Meta, true);
        foreach (var n in Scheldemist.World.BakedWorld.All(holder)) n.SetMeta(Meta, true);
        return (gratings, louvres, removed, tris);
    }

    // ------------------------------------------------------------------ the openings (build_landmarks.py's numbers)

    private static Vector3 W(float u, float v, float y) => new(CentreX + v, y, FrontZ + u);

    /// <summary>A pointed arch's outline in a unit box (arch_shape(tsp, 3) of the bake: two-centred, radius 1.25).</summary>
    private static Vector2[] ArchShape(float tsp)
    {
        const float r = 1.25f;
        float T(float x) { x = Math.Min(x, 1 - x); return tsp + (1 - tsp) * MathF.Sqrt(Math.Max(0, r * r - (x - r) * (x - r))); }
        var pts = new List<Vector2> { new(0, 0), new(1, 0), new(1, tsp) };
        for (int k = 1; k < 6; k++) { float x = 1 - k / 6f; pts.Add(new Vector2(x, T(x))); }
        pts.Add(new Vector2(0, tsp));
        return pts.ToArray();
    }

    private static List<Opening> Openings()
    {
        var list = new List<Opening>();
        // the square stages: (tower, stage, y0, y1 of the painted face, half width), the face toward the nave (north: face 0,
        // south: face 2) inside the west bay in the first stage, real over the west roof's eaves in the second
        var stages = new (bool North, int I, float Y0, float Y1, float H, Fill Kind)[]
        {
            (true, 1, 18f, 35.3f, 6f, Fill.Grating), (true, 2, 36f, 54.8f, 5.85f, Fill.Grating), (true, 3, 55.5f, 73.3f, 5.7f, Fill.Louvres),
            (false, 1, 18f, 35.3f, 6f, Fill.Grating), (false, 2, 36f, 54.8f, 5.85f, Fill.Grating),
        };
        var unit = ArchShape(0.8f);
        foreach (var st in stages)
        {
            float tv = st.North ? TowerV : -TowerV;
            int inner = st.North ? 0 : 2;
            var ring = new[] { new Vector2(TowerU - st.H, tv - st.H), new Vector2(TowerU + st.H, tv - st.H), new Vector2(TowerU + st.H, tv + st.H), new Vector2(TowerU - st.H, tv + st.H) };
            for (int fi = 0; fi < 4; fi++)
            {
                if (fi == inner && st.I == 1) continue;
                float? clip = fi == inner && st.I == 2 ? WestEaves : null;
                var a = ring[fi]; var b = ring[(fi + 1) % 4];
                var mid = (a + b) / 2 - new Vector2(TowerU, tv);
                AddFace(list, $"{(st.North ? "north" : "south")} tower stage {st.I} face {fi}", a, b, mid, st.Y0, st.Y1, 128, 256,
                    new[] { (17f, 30f, 42f, 222f), (69f, 30f, 42f, 222f) }, 0.8f, unit, 1.0f, clip, st.Kind);
            }
        }
        // the north tower's octagon (74-93.5 m): its cardinal faces open over the clock (83.2 m up), its diagonal faces all the way
        float y0 = 74f, y1 = 93.5f, yc = 83.2f;
        var oct = new (float U, float V)[] { (5, -3.4f), (5, 3.4f), (3.4f, 5), (-3.4f, 5), (-5, 3.4f), (-5, -3.4f), (-3.4f, -5), (3.4f, -5) };
        var unit76 = ArchShape(0.76f);
        for (int i = 0; i < 8; i++)
        {
            var a = new Vector2(TowerU + oct[i].U, TowerV + oct[i].V); var b = new Vector2(TowerU + oct[(i + 1) % 8].U, TowerV + oct[(i + 1) % 8].V);
            var mid = (a + b) / 2 - new Vector2(TowerU, TowerV);
            AddFace(list, $"north octagon face {i}", a, b, mid, i % 2 == 0 ? yc : y0, y1, 64, 128, new[] { (9f, 20f, 46f, 106f) }, 0.76f, unit76, 0.6f, null, Fill.Louvres);
        }
        return list;
    }

    private static void AddFace(List<Opening> list, string name, Vector2 a, Vector2 b, Vector2 mid, float y0, float y1, float cw, float ch,
        (float X, float Y, float W, float H)[] holes, float tsp, Vector2[] unit, float depth, float? clip, Fill kind)
    {
        var pa = W(a.X, a.Y, 0); var pb = W(b.X, b.Y, 0);
        float len = pa.DistanceTo(pb);
        var d = (pb - pa) / len;
        var o = (W(mid.X, mid.Y, 0) - W(0, 0, 0)).Normalized();
        float hgt = y1 - y0;
        for (int k = 0; k < holes.Length; k++)
        {
            var (px, py, pw, ph) = holes[k];
            float s0 = px / cw * len, s1 = (px + pw) / cw * len, yt = y1 - py / ch * hgt, yb = y1 - (py + ph) / ch * hgt;
            var hole = unit.Select(q => new Vector2(s0 + (s1 - s0) * q.X, yb + (yt - yb) * q.Y)).ToArray();
            if (clip is float c) hole = ClipConvex(hole, new Vector2(0, 1), c);
            if (hole.Length < 3) continue;
            float ysp = yb + tsp * (yt - yb);
            float mtop = ysp + (cw == 128 ? 0.3f : 0.2f);
            list.Add(new Opening($"{name} lancet {k + 1}", pa, d, o, hole, depth, (s0 + s1) / 2, mtop, ysp, kind));
        }
    }

    // ------------------------------------------------------------------ the grating and the stone behind it

    private static void Grating(Opening op, Builder metal, Builder wall, Builder stone, Builder pane, Builder bars, Random rng)
    {
        // (e: out of the wall, negative into the reveal; the mullion and transoms stand at -0.45 m, about 0.22 m thick)
        const float frameW = 0.06f, frameF = -0.61f, frameB = -0.70f;
        const float upW = 0.045f, upF = -0.61f, upB = -0.68f;
        const float crossH = 0.045f, crossF = -0.625f, crossB = -0.675f;
        const float backE = -0.93f;
        var hole = op.Hole;
        float sMin = hole.Min(q => q.X), sMax = hole.Max(q => q.X), yMin = hole.Min(q => q.Y), yMax = hole.Max(q => q.Y);
        float yBase = yMin;
        Color Col(float y)
        {
            // (each flat its own tone; dirt and rust bloom darker toward the sill, where the rain runs down and stands)
            float k = 0.94f + 0.12f * (float)rng.NextDouble();
            float low = Math.Clamp((y - yBase) / 1.2f, 0, 1);
            k *= 0.78f + 0.22f * low;
            return new Color(MetalPaint.R * k, MetalPaint.G * k * (0.98f + 0.02f * low), MetalPaint.B * k * (0.95f + 0.05f * low));
        }
        // the frame: a flat round the outline, inset half its width from the reveal
        var inset = Inset(hole, frameW / 2);
        for (int i = 0; i < inset.Length; i++)
        {
            var a = inset[i]; var b = inset[(i + 1) % inset.Length];
            if (a.DistanceTo(b) < 0.02f) continue;
            var dir = (b - a).Normalized();
            a -= dir * frameW / 2; b += dir * frameW / 2;
            FlatAlong(metal, op, a, b, frameW, frameF, frameB, 0.003f, Col(Math.Min(a.Y, b.Y)));
        }
        // the upright flats, about 0.5 m apart, from the frame's bottom to its top
        var inner = Inset(hole, frameW);
        float w = sMax - sMin;
        int ups = Math.Max(2, (int)MathF.Round(w / 0.5f));
        for (int i = 1; i < ups; i++)
        {
            float s = sMin + w * i / ups;
            if (Math.Abs(s - op.MullionS) < 0.12f) s = op.MullionS;
            if (Span(inner, true, s) is not (float lo, float hi) || hi - lo < 0.1f) continue;
            FlatAlong(metal, op, new Vector2(s, lo), new Vector2(s, hi), upW, upF, upB, 0.003f, Col(lo));
        }
        // the cross flats, about 0.68 m apart (the photo's tall panes)
        float h = yMax - yMin;
        int crosses = Math.Max(2, (int)MathF.Round(h / 0.68f));
        for (int i = 1; i < crosses; i++)
        {
            float y = yMin + h * i / crosses;
            if (Span(inner, false, y) is not (float lo, float hi) || hi - lo < 0.1f) continue;
            FlatAlong(metal, op, new Vector2(lo, y), new Vector2(hi, y), crossH, crossF, crossB, 0.003f, Col(y));
        }
        // the stone wall behind, its small windows: one low in each light, one in the arch head over the mullion
        var windows = new List<Rect2>();
        float lw = 0.40f, lh = 0.72f;
        foreach (float sc in new[] { (sMin + op.MullionS) / 2, (op.MullionS + sMax) / 2 })
        {
            var r = new Rect2(sc - lw / 2, yMin + 1.5f, lw, lh);
            if (Inside(hole, r, 0.15f)) windows.Add(r);
        }
        var head = new Rect2(op.MullionS - 0.21f, op.MullionTop + 0.45f, 0.42f, 0.66f);
        if (Inside(hole, head, 0.15f)) windows.Add(head);
        var outline = Inset(hole, -0.06f);
        BackWall(wall, op, outline, windows, backE);
        foreach (var r in windows) SmallWindow(op, r, backE, stone, pane, bars);
    }

    /// <summary>The wall closing the opening: the outline, cut in bands at the windows' heights and round each window.</summary>
    private static void BackWall(Builder wall, Opening op, Vector2[] outline, List<Rect2> windows, float e)
    {
        var cuts = new SortedSet<float>();
        foreach (var r in windows) { cuts.Add(r.Position.Y); cuts.Add(r.End.Y); }
        float yLo = outline.Min(q => q.Y) - 1, yHi = outline.Max(q => q.Y) + 1;
        var levels = new List<float> { yLo }; levels.AddRange(cuts); levels.Add(yHi);
        for (int i = 0; i + 1 < levels.Count; i++)
        {
            var band = ClipConvex(ClipConvex(outline, new Vector2(0, 1), levels[i]), new Vector2(0, -1), -levels[i + 1]);
            if (band.Length < 3) continue;
            float ym = (levels[i] + levels[i + 1]) / 2;
            var gaps = windows.Where(r => r.Position.Y < ym && r.End.Y > ym).OrderBy(r => r.Position.X).ToList();
            var pieces = new List<Vector2[]>();
            var rest = band;
            foreach (var g in gaps)
            {
                var left = ClipConvex(rest, new Vector2(-1, 0), -g.Position.X);
                if (left.Length >= 3) pieces.Add(left);
                rest = ClipConvex(rest, new Vector2(1, 0), g.End.X);
                if (rest.Length < 3) break;
            }
            if (rest.Length >= 3) pieces.Add(rest);
            foreach (var poly in pieces)
            {
                var c = new Color(0.9f, 0.9f, 0.9f);
                for (int k = 1; k + 1 < poly.Length; k++)
                    wall.Tri(Pt(op, poly[0], e), Pt(op, poly[k], e), Pt(op, poly[k + 1], e), op.O,
                        poly[0] * AshlarUv, poly[k] * AshlarUv, poly[k + 1] * AshlarUv, c);
            }
        }
    }

    /// <summary>A small window in the back wall: a 12 mm chamfer round the hole, stone reveals 0.13 m deep, a sill weathered
    /// out, the glass at the back with an iron cross of glazing bars.</summary>
    private static void SmallWindow(Opening op, Rect2 r, float e, Builder stone, Builder pane, Builder bars)
    {
        const float depth = 0.13f, ch = 0.012f;
        var c = new Color(0.86f, 0.86f, 0.86f);
        var corners = new[] { r.Position, new Vector2(r.End.X, r.Position.Y), r.End, new Vector2(r.Position.X, r.End.Y) };
        var mid = r.GetCenter();
        for (int i = 0; i < 4; i++)
        {
            var a = corners[i]; var b = corners[(i + 1) % 4];
            var inward = (mid - (a + b) / 2); inward = Math.Abs(inward.X) > Math.Abs(inward.Y) ? new Vector2(Math.Sign(inward.X), 0) : new Vector2(0, Math.Sign(inward.Y));
            // (the chamfer: from the wall's face, ch out from the hole, to ch into the reveal)
            Vector2 ao = a - inward * ch, bo = b - inward * ch;
            float along = a.DistanceTo(b);
            var nChamfer = (op.O + PlaneDir(op, -inward)).Normalized();
            stone.Quad(Pt(op, ao, e), Pt(op, bo, e), Pt(op, b, e - ch), Pt(op, a, e - ch), nChamfer,
                new Vector2(0, 0), new Vector2(along * CarvedUv, 0), new Vector2(along * CarvedUv, ch * CarvedUv), new Vector2(0, ch * CarvedUv), c);
            var nSide = PlaneDir(op, inward);
            var cs = inward.Y > 0 ? c * 0.8f : c; cs.A = 1;
            stone.Quad(Pt(op, a, e - ch), Pt(op, b, e - ch), Pt(op, b, e - depth), Pt(op, a, e - depth), nSide,
                new Vector2(0, 0), new Vector2(along * CarvedUv, 0), new Vector2(along * CarvedUv, depth * CarvedUv), new Vector2(0, depth * CarvedUv), cs);
        }
        // the sill: a stone 40 mm proud of the back wall, its top weathered out, its front arris chamfered
        float s0 = r.Position.X - 0.05f, s1 = r.End.X + 0.05f, y = r.Position.Y;
        var sill = new[] { new Vector2(0.0f, -0.06f), new Vector2(0.032f, -0.06f), new Vector2(0.04f, -0.052f), new Vector2(0.04f, -0.008f), new Vector2(0f, 0.0f) };
        ExtrudeSection(stone, op, new Vector2(s0, y), new Vector2(s1, y), sill.Select(q => new Vector2(q.X + e, q.Y)).ToArray(), c, CarvedUv, true, true);
        // the glass and its bars
        float ge = e - depth + 0.02f;
        var g = new Color(1, 1, 1);
        pane.Quad(Pt(op, corners[0], ge), Pt(op, corners[1], ge), Pt(op, corners[2], ge), Pt(op, corners[3], ge), op.O,
            new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1), g);
        FlatAlong(bars, op, new Vector2(mid.X, r.Position.Y), new Vector2(mid.X, r.End.Y), 0.018f, ge + 0.022f, ge, 0.002f, Iron);
        foreach (float t in new[] { 0.36f, 0.68f })
        {
            float yy = r.Position.Y + r.Size.Y * t;
            FlatAlong(bars, op, new Vector2(r.Position.X, yy), new Vector2(r.End.X, yy), 0.016f, ge + 0.02f, ge, 0.002f, Iron);
        }
    }

    // ------------------------------------------------------------------ the abat-sons

    private static void Louvres(Opening op, Builder oak, Random rng)
    {
        // the frame stands just behind the mullion's back; the boards slope down and out at 42 degrees between its stiles
        float mullionBack = -(op.Depth * 0.45f + 0.11f);
        float front = mullionBack - 0.02f, back = Math.Max(-(op.Depth - 0.015f), front - 0.30f);
        const float stileW = 0.10f, t = 0.028f, theta = 42f * MathF.PI / 180f;
        float reach = front - back;           // the boards' horizontal reach (out of the wall)
        float lb = reach / MathF.Cos(theta);  // a board's width along its slope
        float rise = lb * MathF.Sin(theta);
        float step = rise * 0.82f;            // each board overlaps the one under it: no sight line through
        var hole = op.Hole;
        float sMin = hole.Min(q => q.X), sMax = hole.Max(q => q.X), yMin = hole.Min(q => q.Y), yMax = hole.Max(q => q.Y);
        Color Wood(float k) => new(OakGrey.R * k, OakGrey.G * k, OakGrey.B * k);
        // the frame: a stile along the outline's sides and over the arch, and one behind the mullion
        var inset = Inset(hole, stileW / 2);
        for (int i = 0; i < inset.Length; i++)
        {
            var a = inset[i]; var b = inset[(i + 1) % inset.Length];
            if (a.DistanceTo(b) < 0.02f) continue;
            var dir = (b - a).Normalized();
            a -= dir * stileW / 2; b += dir * stileW / 2;
            FlatAlong(oak, op, a, b, stileW, front, back, 0.003f, Wood(0.9f));
        }
        var inner = Inset(hole, stileW);
        if (Span(inner, true, op.MullionS) is (float mlo, float mhi))
            FlatAlong(oak, op, new Vector2(op.MullionS, mlo), new Vector2(op.MullionS, mhi), stileW, front, back, 0.003f, Wood(0.9f));
        // the boards: a chamfered slab in section (out = e, up = y), from the outer low edge in and up
        var dirSlope = new Vector2(-MathF.Cos(theta), MathF.Sin(theta)); // (in and up)
        var perp = new Vector2(MathF.Sin(theta), MathF.Cos(theta));      // (its top face's normal: out and up)
        Vector2[] Section(float yLow)
        {
            var lowOut = new Vector2(front, yLow);
            var c0 = lowOut + perp * t; var c1 = lowOut; var c2 = lowOut + dirSlope * lb; var c3 = c2 + perp * t;
            // (3 mm chamfers on the two long arrises that show: the outer edge's top and bottom)
            const float k = 0.003f;
            return new[] { c1 + perp * k, c1 + dirSlope * k, c2, c3, c0 + dirSlope * k, c0 - perp * k };
        }
        for (float y = yMin + 0.06f; y + rise < yMax - 0.02f; y += step)
        {
            float top = y + rise + t;
            // (a board stops at the outline at its top, so it never runs into the arch's stone)
            if (Span(inner, false, top) is not (float lo, float hi)) continue;
            var lights = new List<(float, float)>();
            if (op.MullionS > lo + 0.1f && op.MullionS < hi - 0.1f) { lights.Add((lo, op.MullionS - stileW / 2)); lights.Add((op.MullionS + stileW / 2, hi)); }
            else lights.Add((lo, hi));
            foreach (var (a, b) in lights)
            {
                if (b - a < 0.08f) continue;
                float tone = 0.85f + 0.3f * (float)rng.NextDouble();
                ExtrudeSection(oak, op, new Vector2(a, 0), new Vector2(b, 0), Section(y), Wood(tone), PaintUv, false, false, louvre: true);
            }
        }
    }

    // ------------------------------------------------------------------ the bake's lead louvres

    /// <summary>The lead boards the bake laid across the belfries' lower halves (cath_lead, sloping down and out) in the north
    /// tower's bell stage and the south tower's top stage: out, the new fills stand there.</summary>
    private static int RemoveLeadLouvres(Node3D town)
    {
        int removed = 0;
        foreach (var node in Scheldemist.World.BakedWorld.All(town).OfType<MeshInstance3D>())
        {
            if (node.Name != "landmark_cathedral_3" || node.Mesh is not ArrayMesh mesh) continue;
            // (the town is not in the tree yet: its transform from the parents' own)
            var xf = node.Transform;
            for (var up = node.GetParent() as Node3D; up != null; up = up.GetParent() as Node3D) xf = up.Transform * xf;
            var copy = new ArrayMesh();
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                var arrays = mesh.SurfaceGetArrays(s);
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var ix = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                var keep = new List<int>(ix.Length);
                for (int t = 0; t + 2 < ix.Length; t += 3)
                {
                    Vector3 a = xf * v[ix[t]], b = xf * v[ix[t + 1]], c = xf * v[ix[t + 2]];
                    if (IsLeadLouvre(a, b, c)) { removed++; continue; }
                    keep.Add(ix[t]); keep.Add(ix[t + 1]); keep.Add(ix[t + 2]);
                }
                arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
                copy.AddSurfaceFromArrays(mesh.SurfaceGetPrimitiveType(s), arrays);
                copy.SurfaceSetMaterial(s, mesh.SurfaceGetMaterial(s));
                copy.SurfaceSetName(s, mesh.SurfaceGetName(s));
            }
            if (removed > 0) { copy.ResourceName = mesh.ResourceName; node.Mesh = copy; }
        }
        return removed;
    }

    private static bool IsLeadLouvre(Vector3 a, Vector3 b, Vector3 c)
    {
        var n = (b - a).Cross(c - a);
        if (n.LengthSquared() < 1e-10f) return false;
        n = n.Normalized();
        float ny = Math.Abs(n.Y), nh = new Vector2(n.X, n.Z).Length();
        if (ny < 0.7f || ny > 0.9f || nh < 0.45f || nh > 0.72f) return false;
        foreach (var (north, y0, y1, h) in new[] { (true, 55.5f, 73.3f, 5.7f), (false, 36f, 54.8f, 5.85f) })
        {
            var centre = W(TowerU, north ? TowerV : -TowerV, 0);
            bool all = true;
            foreach (var p in new[] { a, b, c })
            {
                float dx = Math.Abs(p.X - centre.X), dz = Math.Abs(p.Z - centre.Z);
                bool inBox = p.Y > y0 && p.Y < y1 && dx < h + 0.05f && dz < h + 0.05f && Math.Max(dx, dz) > h - 0.8f;
                if (!inBox) { all = false; break; }
            }
            if (all) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ geometry helpers

    private static Vector3 Pt(Opening op, Vector2 sy, float e) => op.P + op.D * sy.X + op.O * e + Vector3.Up * sy.Y;
    private static Vector3 PlaneDir(Opening op, Vector2 d) => (op.D * d.X + Vector3.Up * d.Y).Normalized();

    /// <summary>A convex polygon cut to the half plane n·p >= c.</summary>
    private static Vector2[] ClipConvex(Vector2[] poly, Vector2 n, float c)
    {
        var res = new List<Vector2>();
        for (int i = 0; i < poly.Length; i++)
        {
            var a = poly[i]; var b = poly[(i + 1) % poly.Length];
            float da = n.Dot(a) - c, db = n.Dot(b) - c;
            if (da >= 0) res.Add(a);
            if ((da >= 0) != (db >= 0)) res.Add(a + (b - a) * (da / (da - db)));
        }
        return res.ToArray();
    }

    /// <summary>A convex outline moved in by d (out when d is negative): each edge shifted, the corners where they meet.</summary>
    private static Vector2[] Inset(Vector2[] poly, float d)
    {
        int n = poly.Length;
        var c = poly.Aggregate(Vector2.Zero, (s, p) => s + p) / n;
        var lines = new List<(Vector2 P, Vector2 Dir)>();
        for (int i = 0; i < n; i++)
        {
            var a = poly[i]; var b = poly[(i + 1) % n];
            if (a.DistanceTo(b) < 1e-4f) continue;
            var dir = (b - a).Normalized();
            var nrm = new Vector2(-dir.Y, dir.X);
            if (nrm.Dot(c - a) < 0) nrm = -nrm;
            lines.Add((a + nrm * d, dir));
        }
        var res = new Vector2[lines.Count];
        for (int i = 0; i < lines.Count; i++)
        {
            var (p0, d0) = lines[(i + lines.Count - 1) % lines.Count]; var (p1, d1) = lines[i];
            float den = d0.X * d1.Y - d0.Y * d1.X;
            if (Math.Abs(den) < 1e-6f) { res[i] = p1; continue; }
            var w = p1 - p0;
            float t = (w.X * d1.Y - w.Y * d1.X) / den;
            res[i] = p0 + d0 * t;
        }
        return res;
    }

    /// <summary>Where a convex outline crosses an upright (vertical: s = v, gives its y range) or a level line (y = v, gives its s range).</summary>
    private static (float, float)? Span(Vector2[] poly, bool vertical, float v)
    {
        float lo = float.MaxValue, hi = float.MinValue;
        for (int i = 0; i < poly.Length; i++)
        {
            var a = poly[i]; var b = poly[(i + 1) % poly.Length];
            float av = vertical ? a.X : a.Y, bv = vertical ? b.X : b.Y;
            if ((av - v) * (bv - v) > 0 || Math.Abs(av - bv) < 1e-6f) continue;
            float t = (v - av) / (bv - av);
            float o = vertical ? a.Y + (b.Y - a.Y) * t : a.X + (b.X - a.X) * t;
            lo = Math.Min(lo, o); hi = Math.Max(hi, o);
        }
        return lo <= hi ? (lo, hi) : null;
    }

    private static bool Inside(Vector2[] poly, Rect2 r, float margin)
    {
        var grown = r.Grow(margin);
        foreach (var p in new[] { grown.Position, new Vector2(grown.End.X, grown.Position.Y), grown.End, new Vector2(grown.Position.X, grown.End.Y) })
            if (Span(poly, false, p.Y) is not (float lo, float hi) || p.X < lo || p.X > hi) return false;
        return true;
    }

    /// <summary>A flat or bar along a line in the wall's plane: w across (in the plane), from e front to e back, its front
    /// arrises chamfered by ch.</summary>
    private static void FlatAlong(Builder b, Opening op, Vector2 a, Vector2 c, float w, float eFront, float eBack, float ch, Color col)
    {
        var dir = (c - a).Normalized(); var across = new Vector2(-dir.Y, dir.X);
        float hw = w / 2;
        // (the section in (across, e): front face inset by the chamfer)
        var sec = new[] { new Vector2(-hw, eBack), new Vector2(hw, eBack), new Vector2(hw, eFront - ch), new Vector2(hw - ch, eFront), new Vector2(-hw + ch, eFront), new Vector2(-hw, eFront - ch) };
        ExtrudeGeneral(b, op, a, c, across, sec, col, PaintUv, false, false);
    }

    /// <summary>A section in (e, y) extruded along s, from a.X to c.X (a board, a sill).</summary>
    private static void ExtrudeSection(Builder b, Opening op, Vector2 a, Vector2 c, Vector2[] sec, Color col, float uvk, bool capA, bool capB, bool louvre = false)
    {
        // (the section's first coordinate is e, its second y; the path runs along the face)
        var A = op.P + op.D * a.X; var B = op.P + op.D * c.X;
        var pts = sec.Select(q => (op.O * q.X + Vector3.Up * q.Y)).ToArray();
        Extrude(b, A, B, pts, col, uvk, capA, capB, louvre);
    }

    private static void ExtrudeGeneral(Builder b, Opening op, Vector2 a, Vector2 c, Vector2 across, Vector2[] sec, Color col, float uvk, bool capA, bool capB)
    {
        var A = Pt(op, a, 0); var B = Pt(op, c, 0);
        var ax = PlaneDir(op, across);
        var pts = sec.Select(q => ax * q.X + op.O * q.Y).ToArray();
        Extrude(b, A, B, pts, col, uvk, capA, capB, false);
    }

    /// <summary>A convex section (offsets from the path) swept from A to B: flat faces, uv along the path and round the
    /// section at the material's own scale; louvre: tops paler (bleached), undersides darker.</summary>
    private static void Extrude(Builder b, Vector3 A, Vector3 B, Vector3[] sec, Color col, float uvk, bool capA, bool capB, bool louvre)
    {
        int n = sec.Length;
        var centre = sec.Aggregate(Vector3.Zero, (s, p) => s + p) / n;
        var axis = (B - A).Normalized();
        float len = A.DistanceTo(B), round = 0;
        for (int i = 0; i < n; i++)
        {
            var p = sec[i]; var q = sec[(i + 1) % n];
            float el = p.DistanceTo(q);
            if (el < 1e-5f) continue;
            var nrm = (q - p).Cross(axis).Normalized();
            if (nrm.Dot((p + q) / 2 - centre) < 0) nrm = -nrm;
            var c = col;
            if (louvre) { float k = nrm.Y > 0.3f ? 1.25f : nrm.Y < -0.3f ? 0.62f : 0.9f; c = new Color(col.R * k + (nrm.Y > 0.3f ? 0.012f : 0), col.G * k + (nrm.Y > 0.3f ? 0.012f : 0), col.B * k + (nrm.Y > 0.3f ? 0.014f : 0)); }
            else if (nrm.Y < -0.5f) c = col * 0.8f;
            c.A = 1;
            b.Quad(A + p, A + q, B + q, B + p, nrm, new Vector2(round * uvk, 0), new Vector2((round + el) * uvk, 0), new Vector2((round + el) * uvk, len * uvk), new Vector2(round * uvk, len * uvk), c);
            round += el;
        }
        foreach (var (end, cap, sgn) in new[] { (A, capA, -1f), (B, capB, 1f) })
        {
            if (!cap) continue;
            for (int i = 1; i + 1 < n; i++)
                b.Tri(end + sec[0], end + sec[i], end + sec[i + 1], axis * sgn, Vector2.Zero, new Vector2(0.02f, 0), new Vector2(0, 0.02f), col);
        }
    }

    private sealed class Builder
    {
        private readonly List<Vector3> pos = new(), nor = new();
        private readonly List<Vector2> uvs = new();
        private readonly List<Color> cols = new();
        public int Count { get; private set; }

        public void Tri(Vector3 a, Vector3 b, Vector3 c, Vector3 n, Vector2 ua, Vector2 ub, Vector2 uc, Color col)
        {
            var face = (b - a).Cross(c - a);
            if (face.LengthSquared() < 1e-14f) return;
            // (Godot's front face winds clockwise as seen: a, c, b when the face's own normal looks along n)
            if (face.Dot(n) > 0) { V(a, n, ua, col); V(c, n, uc, col); V(b, n, ub, col); }
            else { V(a, n, ua, col); V(b, n, ub, col); V(c, n, uc, col); }
            Count++;
        }

        public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 n, Vector2 ua, Vector2 ub, Vector2 uc, Vector2 ud, Color col)
        {
            Tri(a, b, c, n, ua, ub, uc, col);
            Tri(a, c, d, n, ua, uc, ud, col);
        }

        private void V(Vector3 p, Vector3 n, Vector2 uv, Color c) { pos.Add(p); nor.Add(n); uvs.Add(uv); cols.Add(c); }

        public ArrayMesh Commit(Material m)
        {
            var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
            arrays[(int)Mesh.ArrayType.Vertex] = pos.ToArray(); arrays[(int)Mesh.ArrayType.Normal] = nor.ToArray();
            arrays[(int)Mesh.ArrayType.TexUV] = uvs.ToArray(); arrays[(int)Mesh.ArrayType.Color] = cols.ToArray();
            arrays[(int)Mesh.ArrayType.Index] = Enumerable.Range(0, pos.Count).ToArray();
            var mesh = new ArrayMesh();
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            mesh.SurfaceSetMaterial(0, m);
            return mesh;
        }
    }
}
