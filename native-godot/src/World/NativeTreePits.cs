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
    // 14 cm wide, 3 cm proud of the paving and sunk 3 cm into it, an 8 mm arris worn round every top edge (AGENTS.md: worn
    // stone 5-15 mm). On the guard stones' blue stone (the town stairs' jointless stone with its height map, the clutter's
    // own shader kind). Each stone its own height to a millimetre or two, tone and place in the picture; dirt at its foot,
    // the earth side darker.
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
        st.GenerateTangents();
        var mesh = st.Commit();
        mesh.SurfaceSetMaterial(0, stone);
        mesh.ResourceName = "tree_pit_frame";
        return mesh;
    }

    /// <summary>One kerb: a top inset by the arris, the arris faces, upright sides down to the foot (the bed is never seen).</summary>
    private static void Kerb(SurfaceTool st, float x0, float z0, float x1, float z1, float top, Random rng)
    {
        float b = Arris, y = top - Arris;
        var off = new Vector2((float)rng.NextDouble(), (float)rng.NextDouble());
        float tone = 0.86f + 0.12f * (float)rng.NextDouble();
        var centre = new Vector2((x0 + x1) / 2, (z0 + z1) / 2);
        Color Tint(Vector3 p, Vector3 n)
        {
            // the tooled top weathered pale, the sawn sides the stone's own darker blue
            if (n.Y > 0.9f) return new Color(tone * 0.99f, tone, tone, 1);
            // the worn arris: rubbed, between the two
            if (n.Y > 0.5f) return new Color(tone * 0.9f * 0.98f, tone * 0.9f, tone * 0.9f, 1);
            float k = tone * 0.74f * (0.62f + 0.38f * Mathf.Clamp((p.Y - Foot) / (top - Foot), 0, 1));
            // the side facing the earth: splashed and damp, the earth's dirt on it in patches, not an even band
            if (new Vector2(n.X, n.Z).Dot(-centre) > 0) k *= 0.7f + 0.2f * Mathf.Clamp(Mathf.Sin(p.X * 13.1f + p.Z * 7.3f) * Mathf.Sin(p.X * 4.7f - p.Z * 9.1f) + 0.4f, 0, 1);
            return new Color(k * 0.97f, k * 0.99f, k, 1);
        }
        Vector2 Uv(Vector3 p, Vector3 n) => (Math.Abs(n.Y) > 0.5f ? new Vector2(p.X, p.Z) : Math.Abs(n.X) > Math.Abs(n.Z) ? new Vector2(p.Z, -p.Y) : new Vector2(p.X, -p.Y)) / Tile + off;
        void Quad(Vector3 a, Vector3 c1, Vector3 c2, Vector3 d, Vector3 n)
        {
            // Godot's front face turns clockwise as seen from outside
            if ((c1 - a).Cross(c2 - a).Dot(n) > 0) (c1, d) = (d, c1);
            foreach (var p in new[] { a, c1, c2, a, c2, d })
            {
                st.SetNormal(n); st.SetUV(Uv(p, n)); st.SetColor(Tint(p, n)); st.AddVertex(p);
            }
        }
        Vector3 T(float x, float z) => new(x, top, z);
        Vector3 E(float x, float z) => new(x, y, z);
        Vector3 F(float x, float z) => new(x, Foot, z);
        Quad(T(x0 + b, z0 + b), T(x1 - b, z0 + b), T(x1 - b, z1 - b), T(x0 + b, z1 - b), Vector3.Up);
        float s = MathF.Sqrt(0.5f);
        Quad(T(x0 + b, z0 + b), T(x1 - b, z0 + b), E(x1, z0), E(x0, z0), new Vector3(0, s, -s));
        Quad(T(x0 + b, z1 - b), T(x1 - b, z1 - b), E(x1, z1), E(x0, z1), new Vector3(0, s, s));
        Quad(T(x0 + b, z0 + b), T(x0 + b, z1 - b), E(x0, z1), E(x0, z0), new Vector3(-s, s, 0));
        Quad(T(x1 - b, z0 + b), T(x1 - b, z1 - b), E(x1, z1), E(x1, z0), new Vector3(s, s, 0));
        Quad(E(x0, z0), E(x1, z0), F(x1, z0), F(x0, z0), Vector3.Forward);
        Quad(E(x0, z1), E(x1, z1), F(x1, z1), F(x0, z1), Vector3.Back);
        Quad(E(x0, z0), E(x0, z1), F(x0, z1), F(x0, z0), Vector3.Left);
        Quad(E(x1, z0), E(x1, z1), F(x1, z1), F(x1, z0), Vector3.Right);
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
    /// Each pit tree's root collar (Codex on #222: the trunks ended flat on the earth): four or five roots 15-35 cm long
    /// and 2-6 cm proud where they leave the trunk, tapering into the earth, in the tree's own bark (copies at the trees'
    /// own places, so they turn and scale with each tree; under 2 m the bark's wind leaves them still). A copy set for each
    /// tree kind's bark; not solid (a few centimetres, stepped over). Returns the collars.
    /// </summary>
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
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = model, InstanceCount = at.Count };
            for (int k = 0; k < at.Count; k++) mm.SetInstanceTransform(k, at[k]);
            var node = new MultiMeshInstance3D
            {
                Name = bark.Name + "_roots", Multimesh = mm, Transform = bark.Transform,
                VisibilityRangeEnd = 60, VisibilityRangeEndMargin = 8, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
            };
            bark.GetParent().AddChild(node);
            made += at.Count;
        }
        return made;
    }

    /// <summary>The root collar for one bark model: the trunk's radius and picture place read from its own lowest 30 cm.</summary>
    private static ArrayMesh? RootModel(ArrayMesh bark)
    {
        var arrays = bark.SurfaceGetArrays(0);
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var uvs = arrays[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.PackedVector2Array ? arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array() : null;
        var low = Enumerable.Range(0, v.Length).Where(i => v[i].Y < 0.3f).ToList();
        if (low.Count < 3 || uvs == null) return null;
        var centre = low.Aggregate(Vector2.Zero, (s, i) => s + new Vector2(v[i].X, v[i].Z)) / low.Count;
        float radius = (float)low.Average(i => new Vector2(v[i].X, v[i].Z).DistanceTo(centre));
        float u0 = low.Min(i => uvs[i].X), u1 = low.Max(i => uvs[i].X), v0 = low.Min(i => uvs[i].Y), v1 = low.Max(i => uvs[i].Y);
        var rng = new Random((int)(radius * 10000) + low.Count);
        GD.Print($"tree pits: root collar for {bark.ResourceName}{bark.ResourcePath}: trunk radius {radius:0.000} m round ({centre.X:0.00}, {centre.Y:0.00}) from {low.Count} corners");
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        int roots = 4 + rng.Next(2);
        float turn = (float)(rng.NextDouble() * MathF.Tau);
        for (int r = 0; r < roots; r++)
        {
            float a = turn + r * MathF.Tau / roots + (float)(rng.NextDouble() - 0.5) * 0.6f;
            var d = new Vector2(MathF.Cos(a), MathF.Sin(a));
            var side = new Vector2(-d.Y, d.X);
            float len = 0.15f + 0.2f * (float)rng.NextDouble(), proud = 0.02f + 0.03f * (float)rng.NextDouble(), wide = 0.08f + 0.06f * (float)rng.NextDouble();
            const int Along = 5, Round = 5;
            // a half-round, its foot in the earth, from inside the trunk out to its tip, tapering and sinking as it goes
            Vector3 P(int i, int j)
            {
                float t = (float)i / Along, th = MathF.PI * j / Round;
                var c = centre + d * (radius * 0.8f + (len + radius * 0.2f) * t);
                float w = wide * (1 - 0.8f * t) / 2, hgt = proud * MathF.Pow(1 - t, 1.5f) + 0.003f;
                var q = c + side * (MathF.Cos(th) * w);
                // (it leaves the trunk a little up its foot and runs down into the earth)
                return new Vector3(q.X, 0.004f + MathF.Sin(th) * hgt + 0.025f * (1 - t) * (1 - t), q.Y);
            }
            for (int i = 0; i < Along; i++)
                for (int j = 0; j < Round; j++)
                {
                    var q = new[] { P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1) };
                    var uv = new[] { (i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1) }.Select(c => new Vector2(Mathf.Lerp(u0, u1, (float)c.Item2 / Round * 0.4f), Mathf.Lerp(v1, v0, (float)c.Item1 / Along * 0.5f))).ToArray();
                    // (Godot's front face clockwise as seen from outside: the half-round's outside is away from its axis)
                    float tm = (i + 0.5f) / Along;
                    var cm = centre + d * (radius * 0.8f + (len + radius * 0.2f) * tm);
                    var mid = (q[0] + q[2]) / 2;
                    var outward = mid - new Vector3(cm.X, 0.004f, cm.Y);
                    bool flip = (q[1] - q[0]).Cross(q[2] - q[0]).Dot(outward) > 0;
                    foreach (int k in flip ? new[] { 0, 2, 1, 0, 3, 2 } : new[] { 0, 1, 2, 0, 2, 3 }) { st.SetUV(uv[k]); st.AddVertex(q[k]); }
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
