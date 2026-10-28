using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// The tree pits (Steve, 2026-10-27: the trees on the new church squares grew straight out of the cobbles). The quay's
/// trees (city.json decor trees) stand in pits the bake made as copies in "vegetation", one at each tree: a stone frame
/// (INST167), the dark earth in it (INST166), the leaves fallen round it (INST168) and weeds in the earth (INST169 and
/// INST170: the town's weed copies, most of them in the joints). A square tree on the paving gets the same pit: one of
/// the quay's pits as it stands, turned square to its church, each part added to the quay's own copies (the same models
/// and materials, no new draw). The ground under all of these trees is the cobbles' flat plane at y 0, as on the quay
/// (checked 2026-10-27), so a pit lies as the quay's do.
/// The bake's frame was four plain boxes, sharp-edged, 8 cm proud and without grain; every pit, the quay's too, now has
/// one frame of Belgian blue-stone kerbs (<see cref="Frame"/>). Like the bake's it is not solid: 3 cm, stepped over.
/// Codex on #222 (the pits looked cartoony): the frame's lengths jointed and dirty at the foot; the earth a rough
/// surface instead of a flat card (<see cref="EarthModel"/>); the weeds, the town's weed copies everywhere (joints, quay
/// and pits), sparse bent grasses, low rosettes and a dead stem instead of crossed cards (<see cref="WeedModel"/>); the
/// fallen leaves a new picture (assets/materials/tree-pits-20261028, art-source/tree-pits-20261028); each pit tree a
/// root collar with its roots running into the earth, in its own bark (<see cref="Roots"/>).
/// </summary>
public static class NativeTreePits
{
    private static readonly string[] Parts = { "vegetation/INST167_x_mm", "vegetation/INST166_x_mm", "vegetation/INST168_x_mm", "vegetation/INST169_x_mm", "vegetation/INST170_x_mm" };
    // the earth's half width (a weed inside it is the pit's), and how near a pit's earth and leaves lie to its frame
    private const float Earth = 0.8f, Near = 0.5f;

    /// <summary>Gives the trees (world x, z, the frame's yaw) their pits and every pit the blue-stone frame; says what it did.</summary>
    public static string Dig(Node3D town, (float X, float Z, float Yaw)[] trees)
    {
        var parts = Parts.Select(p => town.GetNodeOrNull<MultiMeshInstance3D>(p)).ToArray();
        if (parts.Any(p => p?.Multimesh is not { InstanceCount: > 0 })) return "no tree pits (the quay's pit copies are missing)";
        var xf = parts.Select(p => WorldOf(p!)).ToArray();
        var at = parts.Select((p, i) => Enumerable.Range(0, p!.Multimesh.InstanceCount).Select(k => xf[i] * p.Multimesh.GetInstanceTransform(k)).ToArray()).ToArray();
        var more = parts.Select(_ => new List<(Transform3D At, Color Colour)>()).ToArray();
        // (no copy data, a headless run: every copy at the origin, nothing to copy from)
        if (at[0].Select(f => f.Origin).Distinct().Count() > 1)
        {
            // each quay pit: its parts relative to its frame (part, place, colour)
            var quay = at[0].Select(frame =>
            {
                var back = frame.AffineInverse();
                var set = new List<(int Part, Transform3D At, Color Colour)> { (0, Transform3D.Identity, Colors.White) };
                for (int p = 1; p < parts.Length; p++)
                    for (int k = 0; k < at[p].Length; k++)
                    {
                        var o = at[p][k].Origin - frame.Origin;
                        if (Math.Abs(o.X) > Earth * 1.5f || Math.Abs(o.Z) > Earth * 1.5f) continue;
                        var local = back * at[p][k];
                        bool mine = p <= 2 ? local.Origin.LengthSquared() < Near * Near : Math.Abs(local.Origin.X) < Earth && Math.Abs(local.Origin.Z) < Earth;
                        if (mine) set.Add((p, local, parts[p]!.Multimesh.UseColors ? parts[p]!.Multimesh.GetInstanceColor(k) : Colors.White));
                    }
                return set;
            }).ToArray();
            for (int i = 0; i < trees.Length; i++)
            {
                // (a quarter turn more or less keeps the frame square to the church and lays its long stones another way)
                var pit = new Transform3D(Basis.Identity.Rotated(Vector3.Up, trees[i].Yaw + i % 4 * MathF.PI / 2), new Vector3(trees[i].X, 0, trees[i].Z));
                foreach (var (p, local, colour) in quay[i % quay.Length]) more[p].Add((xf[p].AffineInverse() * pit * local, colour));
            }
        }
        var frame = Frame();
        var models = new Mesh?[] { frame, EarthModel(parts[1]!.Multimesh.Mesh), null, WeedModel(parts[3]!.Multimesh.Mesh, false), WeedModel(parts[4]!.Multimesh.Mesh, true) };
        for (int p = 0; p < parts.Length; p++) Grow(parts[p]!, more[p], models[p]);
        // (every pit, the quay's and the squares', in the world: the frame copies' places)
        var pits = Enumerable.Range(0, parts[0]!.Multimesh.InstanceCount).Select(k => (xf[0] * parts[0]!.Multimesh.GetInstanceTransform(k)).Origin).ToList();
        int roots = Roots(town, pits);
        return $"{more[0].Count} tree pits{(frame == null ? " (the blue-stone frame's material is missing: the bake's frame)" : "")}, {roots} root collars";
    }

    /// <summary>Puts a copy set's copies and the new ones in a new set, on another model if one is given.</summary>
    private static void Grow(MultiMeshInstance3D copies, List<(Transform3D At, Color Colour)> more, Mesh? model)
    {
        if (more.Count == 0 && model == null) return;
        var old = copies.Multimesh; int n = old.InstanceCount;
        var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = old.UseColors, UseCustomData = old.UseCustomData, Mesh = model ?? old.Mesh, InstanceCount = n + more.Count };
        for (int i = 0; i < n; i++)
        {
            mm.SetInstanceTransform(i, old.GetInstanceTransform(i));
            if (old.UseColors) mm.SetInstanceColor(i, old.GetInstanceColor(i));
            if (old.UseCustomData) mm.SetInstanceCustomData(i, old.GetInstanceCustomData(i));
        }
        for (int i = 0; i < more.Count; i++)
        {
            mm.SetInstanceTransform(n + i, more[i].At);
            if (old.UseColors) mm.SetInstanceColor(n + i, more[i].Colour);
        }
        // (a copy set with a box of its own would leave the new copies out of view: the box takes them in)
        if (old.CustomAabb.Size != Vector3.Zero)
            mm.CustomAabb = more.Aggregate(old.CustomAabb, (box, m) => box.Merge(m.At * mm.Mesh.GetAabb()));
        copies.Multimesh = mm;
    }

    // The frame: four Belgian blue-stone kerbs round the earth, two long and two short set between them with a 3 mm joint,
    // 14 cm wide, 3 cm proud of the paving and sunk 3 cm into it, an arris worn round every top edge (AGENTS.md: worn
    // stone 5-15 mm). On the guard stones' blue stone (the town stairs' jointless stone with its height map, the clutter's
    // own shader kind). Each stone its own height to a millimetre or two, tone and place in the picture; dirt at its foot,
    // the earth side darker. (Codex on #237: the edges razor-sharp, the stones new.) The arris a worn round of 4-12 mm,
    // wider at the joints, the stones' corners rounded, their tops a little uneven (WornStone); the joints filled with
    // the earth's dirt and a ragged band of dirt at the foot; the tops grimed in patches, darker toward the earth and at
    // the joints.
    private const string Stone = "res://assets/materials/guard-stones-20261026/guard-stone.tres";
    private const float Outer = 0.9f, Width = 0.14f, Top = 0.03f, Foot = -0.03f, Arris = 0.008f, Joint = 0.005f;
    // the stone picture's repeat (the guard stones': 0.91 m)
    private const float Tile = 0.91f;

    private static ArrayMesh? Frame()
    {
        if (ResourceLoader.Load<Material>(Stone) is not { } stone) return null;
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        var rng = new Random(1873);
        float o = Outer, i = Outer - Width;
        // (Codex on #222: the frame read as one machined outline) the long sides each in two bedded lengths, every joint
        // 5 mm and open to the bed, each stone its own height to a millimetre or two
        var stones = new List<(float, float, float, float)>();
        foreach (var (z0, z1) in new[] { (i, o), (-o, -i) })
        {
            float cut = -o + 0.8f + 0.25f * (float)rng.NextDouble();
            stones.Add((-o, z0, cut - Joint / 2, z1));
            stones.Add((cut + Joint / 2, z0, o, z1));
        }
        stones.Add((i, -i + Joint, o, i - Joint));
        stones.Add((-o, -i + Joint, -i, i - Joint));
        foreach (var (x0, z0, x1, z1) in stones)
            Kerb(st, x0, z0, x1, z1, Top + (float)(rng.NextDouble() - 0.5) * 0.004f, rng);
        // the joints: the earth's dirt packed into them, 2 cm under the tops (seen in the worn notch where two stones meet)
        for (int a = 0; a < stones.Count; a++)
            for (int b = a + 1; b < stones.Count; b++)
            {
                var (ax0, az0, ax1, az1) = stones[a];
                var (bx0, bz0, bx1, bz1) = stones[b];
                float gx0 = Math.Max(ax0, bx0), gx1 = Math.Min(ax1, bx1), gz0 = Math.Max(az0, bz0), gz1 = Math.Min(az1, bz1);
                // (side by side: a gap of a joint one way, an overlap the other)
                if (!(gx1 - gx0 > -Joint * 1.5f && gz1 - gz0 > -Joint * 1.5f && (gx1 - gx0 > 0.02f || gz1 - gz0 > 0.02f))) continue;
                if (gx1 - gx0 < 0.02f) { float c = (gx0 + gx1) / 2; gx0 = c - 0.012f; gx1 = c + 0.012f; }
                if (gz1 - gz0 < 0.02f) { float c = (gz0 + gz1) / 2; gz0 = c - 0.012f; gz1 = c + 0.012f; }
                float y = Top - 0.022f + 0.006f * (float)rng.NextDouble(), k = 0.2f + 0.06f * (float)rng.NextDouble();
                var fill = new Color(k * 1.05f, k, k * 0.9f, 1);
                var q = new[] { new Vector3(gx0, y, gz0), new Vector3(gx0, y, gz1), new Vector3(gx1, y, gz1), new Vector3(gx1, y, gz0) };
                foreach (int v in new[] { 0, 2, 1, 0, 3, 2 }) { st.SetNormal(Vector3.Up); st.SetUV(new Vector2(q[v].X, q[v].Z) / Tile); st.SetColor(fill); st.AddVertex(q[v]); }
            }
        st.GenerateTangents();
        var mesh = st.Commit();
        mesh.SurfaceSetMaterial(0, stone);
        mesh.ResourceName = "tree_pit_frame";
        return mesh;
    }

    /// <summary>One kerb: a worn old stone (WornStone) from (x0, z0) to (x1, z1), its foot 3 cm under the paving.</summary>
    private static void Kerb(SurfaceTool st, float x0, float z0, float x1, float z1, float top, Random rng)
    {
        var off = new Vector2((float)rng.NextDouble(), (float)rng.NextDouble());
        float tone = 0.86f + 0.12f * (float)rng.NextDouble();
        var centre = new Vector2((x0 + x1) / 2, (z0 + z1) / 2);
        bool alongX = x1 - x0 >= z1 - z0;
        var along = alongX ? Vector2.Right : Vector2.Down;
        float ha = (alongX ? x1 - x0 : z1 - z0) / 2, hc = (alongX ? z1 - z0 : x1 - x0) / 2;
        float gph = (float)rng.NextDouble() * 40;
        Color Tint(WornStone.Corner c)
        {
            var p = c.P;
            // the dirt packed against its foot: the earth's inside, the street's grey grime outside, paler at its edge
            if (c.Dirt >= 0)
            {
                bool earth = new Vector2(c.P.X, c.P.Z).Dot(centre) < centre.LengthSquared();
                float d = earth ? 0.24f + 0.1f * c.Dirt : 0.36f + 0.22f * c.Dirt;
                return earth ? new Color(d * 1.08f, d, d * 0.86f, 1) : new Color(d * 1.02f, d, d * 0.94f, 1);
            }
            // toward the earth (the pit's middle): its splash and dirt
            float toEarth = Mathf.Clamp(1 - (Math.Max(Math.Abs(p.X), Math.Abs(p.Z)) - (Outer - Width)) / Width, 0, 1);
            // grime in patches (the town's soot and the trodden dirt), more at the joints
            float patch = Mathf.Clamp(Mathf.Sin(p.X * 9.3f + gph) * Mathf.Sin(p.Z * 8.1f - gph * 0.7f) * 0.9f + Mathf.Sin(p.X * 23.7f - p.Z * 19.1f + gph) * 0.35f, -1, 1) * 0.5f + 0.5f;
            float grime = 0.92f - 0.2f * patch - 0.2f * c.End - 0.1f * toEarth;
            float k;
            // the tooled top weathered pale, the worn arris rubbed between it and the sawn sides' darker blue
            if (c.Up > 0.92f) k = tone * grime;
            else if (c.Up > 0.15f) k = tone * Mathf.Lerp(0.8f, 0.94f, c.Up) * grime;
            else
            {
                k = tone * 0.74f * (0.62f + 0.38f * Mathf.Clamp((p.Y - Foot) / (top - Foot), 0, 1));
                // the side facing the earth: splashed and damp, the earth's dirt on it in patches, not an even band
                if (new Vector2(c.N.X, c.N.Z).Dot(-centre) > 0) k *= 0.7f + 0.2f * Mathf.Clamp(Mathf.Sin(p.X * 13.1f + p.Z * 7.3f) * Mathf.Sin(p.X * 4.7f - p.Z * 9.1f) + 0.4f, 0, 1);
                // and dirt where it goes into the paving
                k *= 0.62f + 0.38f * Mathf.Clamp(c.Over / 0.012f, 0, 1);
            }
            return new Color(k * 0.97f, k * 0.99f, k, 1);
        }
        Vector2 Uv(Vector3 p, Vector3 n) => (n.Y > 0.7f ? new Vector2(p.X, p.Z) : Math.Abs(n.X) > Math.Abs(n.Z) ? new Vector2(p.Z, -p.Y) : new Vector2(p.X, -p.Y)) / Tile + off;
        WornStone.Build(centre, along, ha, hc, top, Foot, Arris, rng, (a, b, c) =>
        {
            // (one picture place for the whole triangle: no seam drawn across it)
            var n = (a.N + b.N + c.N).Normalized();
            foreach (var v in new[] { a, b, c }) { st.SetNormal(v.N); st.SetUV(Uv(v.P, n)); st.SetColor(Tint(v)); st.AddVertex(v.P); }
        }, endWear: 0.8f, ground: 0, dirt: 0.025f);
    }

    // ------------------------------------------------------------------ the earth

    /// <summary>
    /// The pit's earth (the bake's flat card, 1.6 m square at 6 mm): a 10 cm grid in the card's own material and picture
    /// place, compacted earth 4-16 mm up in lumps, lower along the frame where the rain runs off the stone, heaped a little
    /// round the trunk (the root collar). Never under the paving's plane, which runs on under it.
    /// </summary>
    private static ArrayMesh? EarthModel(Mesh? bake)
    {
        if (bake is not ArrayMesh card || card.GetSurfaceCount() == 0) return null;
        var arrays = card.SurfaceGetArrays(0);
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var uv = arrays[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.PackedVector2Array ? arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array() : null;
        if (v.Length < 3 || uv == null) return null;
        // the card's picture as a plane through its corners (uv = a + bx x + bz z)
        var (a0, bx, bz) = UvPlane(v, uv);
        float h0 = v.Min(p => p.Y), half = v.Max(p => Math.Abs(p.X));
        const int N = 16;
        float Height(float x, float z)
        {
            float lump = Noise2(x * 7.1f, z * 7.1f) * 0.6f + Noise2(x * 19 + 4, z * 19 - 2) * 0.4f;
            float edge = Mathf.Clamp((half - Math.Max(Math.Abs(x), Math.Abs(z))) / 0.12f, 0, 1);
            float r = MathF.Sqrt(x * x + z * z), collar = Mathf.Clamp(1 - r / 0.45f, 0, 1);
            return h0 - 0.002f + 0.012f * lump * (0.4f + 0.6f * edge) + 0.008f * collar * collar;
        }
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        Vector3 P(int i, int j) { float x = -half + 2 * half * i / N, z = -half + 2 * half * j / N; return new Vector3(x, Math.Max(0.002f, Height(x, z)), z); }
        for (int i = 0; i < N; i++)
            for (int j = 0; j < N; j++)
            {
                var q = new[] { P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1) };
                // (Godot's front face clockwise as seen from above)
                foreach (int k in new[] { 0, 1, 2, 0, 2, 3 }) { st.SetUV(a0 + bx * q[k].X + bz * q[k].Z); st.AddVertex(q[k]); }
            }
        st.Index();
        st.GenerateNormals();
        var mesh = st.Commit();
        mesh.SurfaceSetMaterial(0, card.SurfaceGetMaterial(0));
        mesh.ResourceName = "tree_pit_earth";
        return mesh;
    }

    /// <summary>The card's uv as a plane over x and z (least squares over its corners): a, and its steps along x and z.</summary>
    private static (Vector2 A, Vector2 Bx, Vector2 Bz) UvPlane(Vector3[] v, Vector2[] uv)
    {
        int n = v.Length;
        double sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0;
        foreach (var p in v) { sx += p.X; sz += p.Z; sxx += p.X * p.X; szz += p.Z * p.Z; sxz += p.X * p.Z; }
        double Det(double[,] q) => q[0, 0] * (q[1, 1] * q[2, 2] - q[1, 2] * q[2, 1]) - q[0, 1] * (q[1, 0] * q[2, 2] - q[1, 2] * q[2, 0]) + q[0, 2] * (q[1, 0] * q[2, 1] - q[1, 1] * q[2, 0]);
        double[] Fit(Func<int, float> f)
        {
            double s1 = 0, s2 = 0, s3 = 0;
            for (int i = 0; i < n; i++) { s1 += f(i); s2 += f(i) * v[i].X; s3 += f(i) * v[i].Z; }
            var m = new[,] { { n, sx, sz }, { sx, sxx, sxz }, { sz, sxz, szz } };
            double det = Det(m);
            var res = new double[3];
            if (Math.Abs(det) < 1e-12) return res;
            for (int col = 0; col < 3; col++)
            {
                var q = (double[,])m.Clone();
                q[0, col] = s1; q[1, col] = s2; q[2, col] = s3;
                res[col] = Det(q) / det;
            }
            return res;
        }
        var fu = Fit(i => uv[i].X); var fv = Fit(i => uv[i].Y);
        return (new Vector2((float)fu[0], (float)fv[0]), new Vector2((float)fu[1], (float)fv[1]), new Vector2((float)fu[2], (float)fv[2]));
    }

    // ------------------------------------------------------------------ the weeds

    /// <summary>
    /// A weed copy (the bake's was three crossed cards 0.6 m wide and 0.45 m high in a 32 px picture: rigid flat fingers,
    /// Codex on #222). Now a joint's or a pit's sparse growth, 4-12 cm: bent, tapering grass blades 3-7 mm wide in the
    /// picture's olive, dull green and straw columns, a low rosette of broad leaves, and (the second kind) a dead stem
    /// 15-22 cm with a seed head and a tiny pale flower or two (the picture's pale column). The weed picture's material,
    /// both sides drawn for the blades (it culls the back), each blade its own place in a fixed seed.
    /// </summary>
    private static ArrayMesh? WeedModel(Mesh? bake, bool tall)
    {
        if (bake is not ArrayMesh old || old.GetSurfaceCount() == 0) return null;
        var rng = new Random(tall ? 4271 : 1873);
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        // the picture's opaque columns (u in texels, v at the tip, v at the base): greens; straw; pale (the flowers)
        var greens = tall ? new[] { (7.5f, 1f, 13f), (22.5f, 1f, 24f), (27.5f, 1f, 19f) } : new[] { (2.5f, 1f, 21f), (6.6f, 7f, 15f), (13.5f, 1f, 23f) };
        var straw = tall ? (25.5f, 1f, 11f) : (9.5f, 1f, 16f);
        var pale = (29.5f, 11f, 19f);
        Vector2 Uv((float U, float V0, float V1) c, float t) => new(c.U / 32f, Mathf.Lerp(c.V1, c.V0, t) / 32f);
        void Tri(Vector3 a, Vector3 b, Vector3 c, Vector2 ua, Vector2 ub, Vector2 uc, Color ca, Color cb, Color cc, Vector3 n, bool both)
        {
            foreach (var (p, u, col) in new[] { (a, ua, ca), (c, uc, cc), (b, ub, cb) }) { st.SetNormal(n); st.SetColor(col); st.SetUV(u); st.AddVertex(p); }
            if (both) foreach (var (p, u, col) in new[] { (a, ua, ca), (b, ub, cb), (c, uc, cc) }) { st.SetNormal(n); st.SetColor(col); st.SetUV(u); st.AddVertex(p); }
        }
        // a blade: rooted at (x, z), leaning out and bending over; two segments and a point
        void Blade(Vector2 at, float h, float w, float lean, float dir, (float, float, float) col)
        {
            var out2 = new Vector2(MathF.Cos(dir), MathF.Sin(dir));
            var side = new Vector3(-out2.Y, 0, out2.X);
            Vector3 Pt(float t) { float bend = lean * t * t; return new Vector3(at.X + out2.X * h * bend, h * t * (1 - 0.25f * lean * t), at.Y + out2.Y * h * bend); }
            var n = (Vector3.Up + new Vector3(out2.X, 0, out2.Y) * 0.4f).Normalized();
            float tone = 0.85f + 0.25f * (float)rng.NextDouble();
            Color C(float t) => new(tone * (0.72f + 0.28f * t), tone * (0.72f + 0.28f * t), tone * (0.72f + 0.28f * t));
            Vector3 b0 = Pt(0) - side * w / 2, b1 = Pt(0) + side * w / 2, m0 = Pt(0.55f) - side * w * 0.35f, m1 = Pt(0.55f) + side * w * 0.35f, tip = Pt(1);
            Tri(b0, b1, m1, Uv(col, 0), Uv(col, 0), Uv(col, 0.55f), C(0), C(0), C(0.55f), n, true);
            Tri(b0, m1, m0, Uv(col, 0), Uv(col, 0.55f), Uv(col, 0.55f), C(0), C(0.55f), C(0.55f), n, true);
            Tri(m0, m1, tip, Uv(col, 0.55f), Uv(col, 0.55f), Uv(col, 1), C(0.55f), C(0.55f), C(1), n, true);
        }
        int blades = tall ? 7 : 9;
        for (int k = 0; k < blades; k++)
        {
            var at = new Vector2((float)(rng.NextDouble() - 0.5) * 0.1f, (float)(rng.NextDouble() - 0.5) * 0.06f);
            float h = 0.04f + 0.08f * (float)Math.Pow(rng.NextDouble(), 1.4);
            var col = rng.NextDouble() < 0.22 ? straw : greens[rng.Next(greens.Length)];
            Blade(at, h, 0.003f + 0.004f * (float)rng.NextDouble(), 0.3f + 0.9f * (float)rng.NextDouble(), (float)(rng.NextDouble() * MathF.Tau), col);
        }
        // a low rosette: broad leaves lying nearly flat, tilted up a little toward their tips (top side only)
        var rc = new Vector2((float)(rng.NextDouble() - 0.5) * 0.08f, (float)(rng.NextDouble() - 0.5) * 0.08f);
        int leaves = tall ? 6 : 5;
        float turn = (float)(rng.NextDouble() * MathF.Tau);
        for (int k = 0; k < leaves; k++)
        {
            float a = turn + k * MathF.Tau / leaves + (float)(rng.NextDouble() - 0.5) * 0.5f, len = 0.025f + 0.03f * (float)rng.NextDouble(), wid = len * (0.35f + 0.15f * (float)rng.NextDouble());
            var d = new Vector3(MathF.Cos(a), 0, MathF.Sin(a)); var sd = new Vector3(-d.Z, 0, d.X);
            float lift = 0.15f + 0.25f * (float)rng.NextDouble();
            var b = new Vector3(rc.X, 0.004f, rc.Y);
            Vector3 m0 = b + d * len * 0.45f + sd * wid / 2 + Vector3.Up * len * lift * 0.4f, m1 = b + d * len * 0.45f - sd * wid / 2 + Vector3.Up * len * lift * 0.4f, tip = b + d * len + Vector3.Up * len * lift;
            var col = greens[k % greens.Length];
            var n = (Vector3.Up - d * lift * 0.5f).Normalized();
            var c0 = new Color(0.8f, 0.8f, 0.8f); var c1 = new Color(1, 1, 1);
            Tri(b, m0, tip, Uv(col, 0.3f), Uv(col, 0.6f), Uv(col, 0.9f), c0, c1, c1, n, false);
            Tri(b, tip, m1, Uv(col, 0.3f), Uv(col, 0.9f), Uv(col, 0.6f), c0, c1, c1, n, false);
        }
        if (tall)
        {
            // a dead stem with its seed head, and a tiny flower or two low in the clump
            var at = new Vector2(0.02f, -0.015f);
            float sh = 0.15f + 0.07f * (float)rng.NextDouble();
            Blade(at, sh, 0.0025f, 0.12f, 0.8f, straw);
            var head = new Vector3(at.X + 0.004f, sh * 0.93f, at.Y + 0.003f);
            for (int k = 0; k < 2; k++)
            {
                var s2 = k == 0 ? new Vector3(0.008f, 0, 0) : new Vector3(0, 0, 0.008f);
                Tri(head - s2, head + s2, head + Vector3.Up * 0.025f, Uv(straw, 0.6f), Uv(straw, 0.6f), Uv(straw, 0.9f), new Color(0.9f, 0.9f, 0.9f), new Color(0.9f, 0.9f, 0.9f), new Color(1, 1, 1), Vector3.Up, true);
            }
            for (int k = 0; k < 2; k++)
            {
                var c = new Vector3((float)(rng.NextDouble() - 0.5) * 0.06f, 0.035f + 0.02f * (float)rng.NextDouble(), (float)(rng.NextDouble() - 0.5) * 0.06f);
                float r = 0.005f;
                Tri(c + new Vector3(-r, 0, -r), c + new Vector3(r, 0, -r), c + new Vector3(0, 0.001f, r), Uv(pale, 0.3f), Uv(pale, 0.5f), Uv(pale, 0.7f), Colors.White, Colors.White, Colors.White, Vector3.Up, true);
            }
        }
        var mesh = st.Commit();
        mesh.SurfaceSetMaterial(0, old.SurfaceGetMaterial(0));
        mesh.ResourceName = tall ? "weeds_tall" : "weeds_low";
        return mesh;
    }

    // ------------------------------------------------------------------ the roots

    /// <summary>
    /// Each pit tree's root collar (Codex on #222: the trunks ended flat on the earth): five to seven rounded roots, most
    /// forked, sinking into the earth (<see cref="RootModel"/>), in the tree's own bark (copies at the trees'
    /// own places, so they turn and scale with each tree; under 2 m the bark's wind leaves them still). A copy set for each
    /// tree kind's bark; not solid (a few centimetres, stepped over). Returns the collars.
    /// </summary>
    private const float RootCell = 30;
    private static int Roots(Node3D town, List<Vector3> pits)
    {
        int made = 0;
        var barks = BakedWorld.All(town).OfType<MultiMeshInstance3D>().Where(m => m.Name.ToString().Contains("bark_mm") && m.Multimesh is { InstanceCount: > 0, Mesh: ArrayMesh }).ToList();
        foreach (var bark in barks)
        {
            var mm0 = bark.Multimesh;
            var xf = WorldOf(bark);
            var at = new List<Transform3D>();
            for (int k = 0; k < mm0.InstanceCount; k++)
            {
                var t = mm0.GetInstanceTransform(k);
                var w = xf * t;
                if (pits.Any(p => new Vector2(p.X - w.Origin.X, p.Z - w.Origin.Z).Length() < 0.35f)) at.Add(t);
            }
            if (at.Count == 0 || RootModel((ArrayMesh)mm0.Mesh) is not { } model) continue;
            // in sets of 30 m of the town (#237: one set for a whole tree kind, its middle often over 60 m off, was not
            // drawn even beside its trees: a visibility range is measured to a set's middle)
            foreach (var cell in at.GroupBy(t => { var o = (xf * t).Origin; return ((int)MathF.Floor(o.X / RootCell), (int)MathF.Floor(o.Z / RootCell)); }))
            {
                var list = cell.ToList();
                var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = model, InstanceCount = list.Count };
                for (int k = 0; k < list.Count; k++) mm.SetInstanceTransform(k, list[k]);
                var node = new MultiMeshInstance3D
                {
                    Name = $"{bark.Name}_roots_{cell.Key.Item1}_{cell.Key.Item2}", Multimesh = mm, Transform = bark.Transform,
                    VisibilityRangeEnd = 60, VisibilityRangeEndMargin = 8, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
                };
                bark.GetParent().AddChild(node);
            }
            made += at.Count;
        }
        return made;
    }

    /// <summary>
    /// The root collar for one bark model: the trunk's radius and bark picture read from its own lowest 30 cm. (Codex on
    /// #237: a straight wedge tapering to a point read as a wooden stake.) Five to seven roots leave the trunk as broad,
    /// low buttresses 7-12 cm high and 20-30 cm wide at the trunk, their backs low and their sides sloping into the
    /// earth, each bending its own way; most fork once; each thins and dives into the earth and ends under it, so no root
    /// has a tip. The bark's grain runs along each root, from the trunk's own picture at its foot.
    /// </summary>
    private static ArrayMesh? RootModel(ArrayMesh bark)
    {
        var arrays = bark.SurfaceGetArrays(0);
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var uvs = arrays[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.PackedVector2Array ? arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array() : null;
        var low = Enumerable.Range(0, v.Length).Where(i => v[i].Y < 0.3f).ToList();
        if (low.Count < 3 || uvs == null) return null;
        var centre = low.Aggregate(Vector2.Zero, (s, i) => s + new Vector2(v[i].X, v[i].Z)) / low.Count;
        float radius = (float)low.Average(i => new Vector2(v[i].X, v[i].Z).DistanceTo(centre));
        float u0 = low.Min(i => uvs[i].X), u1 = low.Max(i => uvs[i].X);
        // the bark picture up the trunk: v = va + vb y (a line through the low corners), so a root's grain goes on from
        // the trunk's foot as if the bark were unrolled along it
        double my = low.Average(i => v[i].Y), mv = low.Average(i => uvs[i].Y);
        double sxy = low.Sum(i => (v[i].Y - my) * (uvs[i].Y - mv)), sxx = low.Sum(i => (v[i].Y - my) * (v[i].Y - my));
        float vb = sxx > 1e-6 ? (float)(sxy / sxx) : -1, va = (float)(mv - vb * my);
        // (metres round the trunk to its picture's width)
        float uPerM = (u1 - u0) / (MathF.Tau * Math.Max(0.05f, radius));
        var rng = new Random((int)(radius * 10000) + low.Count);
        GD.Print($"tree pits: root collar for {bark.ResourceName}{bark.ResourcePath}: trunk radius {radius:0.000} m round ({centre.X:0.00}, {centre.Y:0.00}) from {low.Count} corners, bark u {u0:0.00}-{u1:0.00}, v {va:0.00} + {vb:0.00} y");
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        // the roots' foot under the earth (the pit's earth lies 2-20 mm up), and how far a root may reach from the trunk's
        // middle (inside the frame's 0.76 m)
        const float Bed = -0.012f;
        float reach = Math.Min(0.64f, radius + 0.36f);
        // one root from p0 heading h0 (radians), its centre line len long, bending by bend; hb its top's height at its
        // start, wb its width there; returns its centre line (place, heading, top, width at each step)
        List<(Vector2 P, float H, float T, float W)> Root(Vector2 p0, float h0, float bend, float len, float hb, float wb, float uOff)
        {
            const int Along = 12, Round = 9;
            float ph = (float)rng.NextDouble() * 10, knot = 0.6f + 0.5f * (float)rng.NextDouble();
            var line = new List<(Vector2 P, float H, float T, float W)>();
            var beds = new List<float>();
            var p = p0;
            for (int i = 0; i <= Along; i++)
            {
                float t = (float)i / Along;
                float h = h0 + bend * t + 0.12f * MathF.Sin(t * 5.3f + ph);
                // the top: high at the trunk, a long low back, under the earth by its end (no tip shows)
                // (its foot dives as it goes: the end lies well under the earth, thin)
                float bed = Bed - 0.025f * t * t, top = bed + (hb - Bed) * MathF.Pow(1 - t, 1.25f);
                top += 0.006f * MathF.Sin(t * 13 * knot + ph) * (1 - t);
                // broad where it leaves the trunk (the flare), narrowing
                float w = wb * (1 - 0.8f * t) * (1 + 0.35f * MathF.Pow(1 - t, 3));
                line.Add((p, h, top, w));
                beds.Add(bed);
                p += new Vector2(MathF.Cos(h), MathF.Sin(h)) * (len / Along);
            }
            // the round over the root: a low back, its sides sloping gently into the earth (a steep foot read as a stone)
            Vector3 P(int i, int j, out Vector2 uv)
            {
                var (c, h, top, w) = line[i];
                float th = MathF.PI * j / Round;
                var side = new Vector2(-MathF.Sin(h), MathF.Cos(h));
                var q = c + side * (MathF.Cos(th) * w / 2);
                float bed = beds[i], y = bed + (Math.Max(top, bed + 0.001f) - bed) * MathF.Pow(Math.Max(0, MathF.Sin(th)), 1.5f);
                float along = len * i / Along, arc = (w + 2 * Math.Max(0, top - bed)) * j / Round;
                uv = new Vector2(u0 + uOff + arc * uPerM, va + vb * along);
                return new Vector3(q.X, y, q.Y);
            }
            for (int i = 0; i < Along; i++)
                for (int j = 0; j < Round; j++)
                {
                    var q = new Vector3[4];
                    var uv = new Vector2[4];
                    q[0] = P(i, j, out uv[0]); q[1] = P(i + 1, j, out uv[1]); q[2] = P(i + 1, j + 1, out uv[2]); q[3] = P(i, j + 1, out uv[3]);
                    // (Godot's front face clockwise as seen from outside: the round's outside is away from its foot line)
                    var cm = (line[i].P + line[i + 1].P) / 2;
                    var outward = (q[0] + q[2]) / 2 - new Vector3(cm.X, (beds[i] + beds[i + 1]) / 2, cm.Y);
                    bool flip = (q[1] - q[0]).Cross(q[2] - q[0]).Dot(outward) > 0;
                    foreach (int k in flip ? new[] { 0, 2, 1, 0, 3, 2 } : new[] { 0, 1, 2, 0, 2, 3 }) { st.SetUV(uv[k]); st.AddVertex(q[k]); }
                }
            return line;
        }
        int roots = 5 + rng.Next(3);
        float turn = (float)(rng.NextDouble() * MathF.Tau);
        for (int r = 0; r < roots; r++)
        {
            float a = turn + r * MathF.Tau / roots + (float)(rng.NextDouble() - 0.5) * 0.5f;
            // (from just inside the bark, so it rises out of the trunk's foot)
            var start = centre + new Vector2(MathF.Cos(a), MathF.Sin(a)) * radius * 0.75f;
            float len = (0.65f + 0.35f * (float)rng.NextDouble()) * (reach - radius * 0.75f);
            float hb = 0.07f + 0.05f * (float)rng.NextDouble(), wb = 0.15f + 0.08f * (float)rng.NextDouble();
            // (inside the bark's own place in the picture: the next one over is another tree's)
            float bend = ((float)rng.NextDouble() - 0.5f) * 0.9f, uOff = (float)rng.NextDouble() * Math.Max(0, u1 - u0 - 0.6f * uPerM - 0.1f);
            var line = Root(start, a, bend, len, hb, wb, uOff);
            // a fork: a thinner root from its flank, a third to two thirds out, turned off 25-45 degrees, sinking sooner
            if (rng.NextDouble() < 0.7)
            {
                int at = 4 + rng.Next(3);
                var (p, h, top, w) = line[at];
                float side = rng.NextDouble() < 0.5 ? -1 : 1, rest = len * (1 - at / 10f);
                Root(p - new Vector2(MathF.Cos(h), MathF.Sin(h)) * 0.03f, h + side * (0.45f + 0.35f * (float)rng.NextDouble()), -side * 0.3f * (float)rng.NextDouble(),
                    rest * (0.6f + 0.35f * (float)rng.NextDouble()), Math.Max(0.02f, top * 0.85f), w * 0.6f, uOff + 0.1f);
            }
        }
        st.Index();
        st.GenerateNormals();
        var mesh = st.Commit();
        mesh.SurfaceSetMaterial(0, bark.SurfaceGetMaterial(0));
        mesh.ResourceName = "tree_root_collar";
        return mesh;
    }

    private static float Noise2(float x, float z)
    {
        static float H(int i, int j) { uint h = (uint)(i * 374761393 + j * 668265263); h = (h ^ (h >> 13)) * 1274126177; return (h ^ (h >> 16)) / (float)uint.MaxValue; }
        int ix = (int)MathF.Floor(x), iz = (int)MathF.Floor(z);
        float fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
        return Mathf.Lerp(Mathf.Lerp(H(ix, iz), H(ix + 1, iz), ux), Mathf.Lerp(H(ix, iz + 1), H(ix + 1, iz + 1), ux), uz);
    }

    private static Transform3D WorldOf(Node3D node)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
        return xf;
    }
}
