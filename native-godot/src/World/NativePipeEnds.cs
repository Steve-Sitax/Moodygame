using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>
/// Issue #218: the last eight downpipe feet that ended on the flags with nothing to take their water (pipe_drains.py had
/// called five of them "over a step": the tops it found were the crates and barrels stood by the shop fronts; three had no
/// kerb it could find: the pavement there is one flag wide and turns into a door's recess). Each gets the same stone: a
/// blue-stone channel stone (a "goot") laid flush in the raised pavement from the wall to the kerb under the pipe's shoe,
/// a dished groove down its length that falls toward the street and runs out over the kerb's face into the street
/// gutter, as the town's houses without a cast-iron channel plate drained in 1873. One model, stretched to each
/// pavement's width (0.37-0.65 m from the wall's foot to the kerb's face); its worn arrises 4-8 mm (AGENTS.md: worn stone 5-15 mm, a small laid stone less),
/// the groove's lip rounded, the top a millimetre or two uneven, the wet groove darker and a rust stain under the shoe.
/// It stands 4 mm proud of the flags; its triangles are its collision (World/Solid.cs), so the feet walk over it.
/// </summary>
public static class NativePipeEnds
{
    // the blue stone of the guard stones and the tree pits' frames (their material, their picture's 0.91 m repeat)
    private const string Stone = "res://assets/materials/guard-stones-20261026/guard-stone.tres";
    private const float Tile = 0.91f;
    // the pavements' flags and kerbs (the town blocks' materials: NativeSquareDressing's mends cut the same)
    private const string Flags = "res://world/town/resources/r000016.res", Kerbs = "res://world/town/resources/r000209.res";
    // the model: half its width, its length before stretching, its depth (to the street's level under a 12 cm pavement: its
    // end face is the kerb's face there), how proud of the flags it lies
    private const float HalfWidth = 0.1f, Length = 0.42f, Depth = 0.13f, Proud = 0.004f;
    // the groove: half its width, its depth at the wall and at the street end
    private const float GrooveHalf = 0.055f, GrooveWall = 0.016f, GrooveStreet = 0.026f;
    // the worn arris (a round) and how much wider it wears in patches
    private const float Arris = 0.005f, ArrisWear = 0.004f;

    /// <summary>
    /// The eight feet (issue #218's list): the foot (x, z), the wall's outward normal (the nearest house outline's edge,
    /// as pipe_drains.py finds it), the flags' height there and the distance from the wall to the kerb's face (measured on
    /// the drawn paving, art-source/pipe-drains-20261027: W-walls, 2026-11-02), and a sideways shift away from a door's
    /// recess beside the pipe.
    /// </summary>
    private static readonly (float X, float Z, float Nx, float Nz, float Ground, float Kerb, float Shift)[] Feet =
    {
        (-140.14f, 231.52f, -1f, 0f, 0.12f, 0.54f, 0f),
        (-86.15f, 211.89f, 0f, -1f, 0.12f, 0.37f, 0f),
        (14.27f, 309.72f, 0.5551f, -0.8318f, 0.12f, 0.46f, -0.02f),
        (25.67f, 282.25f, -0.1948f, 0.9808f, 0.12f, 0.42f, -0.02f),
        (30.54f, 285.52f, -0.8318f, 0.5551f, 0.12f, 0.52f, -0.02f),
        (37.83f, 147.69f, 0.9655f, -0.2603f, 0.12f, 0.28f, 0f),
        (52.08f, 281.76f, 0.9139f, -0.406f, 0.12f, 0.37f, 0f),
        (207.86f, 118.82f, -1f, 0f, 0.12f, 0.27f, 0f),
    };

    /// <summary>Marks the stones (the dev views and checks find them by it).</summary>
    public const string Meta = "native_pipe_end";

    /// <summary>Lay the eight channel stones in the town (before it is in the tree). Returns how many were laid.</summary>
    public static int Lay(Node3D town)
    {
        if (ResourceLoader.Load<Material>(Stone) is not ShaderMaterial stone) return 0;
        var mesh = Model();
        var material = (ShaderMaterial)stone.Duplicate();
        material.ResourceName = "pipe_channel_stone";
        // (the tree pits' weathered blue stone: a mid grey with a faint blue, not the guard stones' darker blue)
        material.SetShaderParameter("albedo", new Color(0.98f, 0.98f, 0.98f, 1));
        mesh.SurfaceSetMaterial(0, material);
        var group = new Node3D { Name = "pipe_ends" };
        group.SetMeta(Meta, true);
        town.AddChild(group);
        int i = 0;
        var cuts = new List<Vector2[]>();
        foreach (var (x, z, nx, nz, ground, kerb, shift) in Feet)
        {
            var n = new Vector3(nx, 0, nz).Normalized();
            var across = new Vector3(-n.Z, 0, n.X);
            // the model's z runs out from the wall's foot (the pipe stands about 11 cm off the wall: its foot here is 10 cm out,
            // into the plinth's bed), its x across; stretched to reach 5 mm past the kerb's face
            const float Back = 0.1f;
            float reach = Back + kerb + 0.005f;
            var basis = new Basis(across, Vector3.Up, n * (reach / Length));
            var origin = new Vector3(x, ground, z) + across * shift - n * Back;
            var stoneNode = new MeshInstance3D { Name = $"pipe_channel_stone_{i++}", Mesh = mesh, Transform = new Transform3D(basis, origin) };
            stoneNode.SetMeta(Meta, true);
            group.AddChild(stoneNode);
            // (the flags and the kerb under it go, drawn and solid: the stone fills their place, its groove below their top)
            cuts.Add(new[] { origin - across * HalfWidth, origin + across * HalfWidth, origin + across * HalfWidth + n * reach, origin - across * HalfWidth + n * reach }
                .Select(c => new Vector2(c.X, c.Z)).ToArray());
        }
        var (drawn, standIn) = NativePlanCut.Cut(town, cuts, 0.17f, m => m.Name.ToString().StartsWith("city_", StringComparison.Ordinal), new HashSet<string> { Flags, Kerbs }, true);
        GD.Print($"pipe ends: the flags and kerbs under the channel stones cut: {drawn} drawn and {standIn} solid stand-in triangles");
        GD.Print($"pipe ends: {Feet.Length} blue-stone channel stones under the bare downpipes (#218)");
        return Feet.Length;
    }

    /// <summary>The height of the stone's top at (x across, z along) over its bed's top: the groove and the worn arrises.</summary>
    private static float Top(float x, float z, Func<float, float, float> wear)
    {
        float h = Proud + (wear(x * 31f, z * 29f) - 0.5f) * 0.0015f;
        // the groove: a round dish, deeper toward the street, its lip rounded into the top
        float g = Mathf.Lerp(GrooveWall, GrooveStreet, Mathf.Clamp(z / Length, 0, 1));
        float u = Math.Abs(x) / GrooveHalf;
        if (u < 1.25f)
        {
            float dish = u < 1 ? 1 - u * u : 0;
            // (the lip: a small round from the top into the dish over the last fifth)
            float lip = Mathf.SmoothStep(1.25f, 0.85f, u);
            h -= g * Math.Max(dish, 0) * 0.9f + g * 0.1f * lip;
        }
        // the arrises along the two long sides and the street end: a quarter round of their own radius, worn wider in patches
        float r = Arris + ArrisWear * wear(z * 9f + x * 3f, 7.1f);
        float dSide = HalfWidth - Math.Abs(x), dEnd = Length - z;
        float d = Math.Min(dSide, dEnd);
        if (d < r) h -= r - MathF.Sqrt(Math.Max(r * r - (r - d) * (r - d), 0));
        return h;
    }

    /// <summary>The one channel stone, 0.2 m wide and 0.42 m long, its top at Proud over y 0, its body 10 cm into the bed.</summary>
    private static ArrayMesh Model()
    {
        var rng = new Random(218);
        float ph = (float)rng.NextDouble() * 50;
        float Wear(float a, float b) => 0.5f + 0.25f * MathF.Sin(a + ph) * MathF.Sin(b * 1.3f - ph) + 0.25f * MathF.Sin(a * 2.3f - b * 1.7f + ph * 0.5f);
        const int Nx = 40, Nz = 32;
        var xs = new float[Nx + 1];
        var zs = new float[Nz + 1];
        // (the columns crowd at the arrises and the groove's lip, so the rounds are round)
        for (int i = 0; i <= Nx; i++) { float t = (float)i / Nx * 2 - 1; xs[i] = HalfWidth * MathF.Sign(t) * (1 - MathF.Pow(1 - Math.Abs(t), 1.6f)); }
        for (int j = 0; j <= Nz; j++) { float t = (float)j / Nz; zs[j] = Length * (1 - MathF.Pow(1 - t, 1.5f)); }
        var top = new Vector3[Nx + 1, Nz + 1];
        for (int i = 0; i <= Nx; i++) for (int j = 0; j <= Nz; j++) top[i, j] = new Vector3(xs[i], Top(xs[i], zs[j], Wear), zs[j]);
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        Color Tint(Vector3 p, bool side)
        {
            float tone = 0.68f + 0.08f * (Wear(p.X * 13f, p.Z * 11f) - 0.5f);
            if (side) return new Color(tone * 0.7f, tone * 0.72f, tone * 0.74f, 1);
            // the groove wet and darker, the street end darkest; a rust stain under the shoe, fading out along the groove
            float inGroove = Mathf.SmoothStep(GrooveHalf * 1.2f, GrooveHalf * 0.6f, Math.Abs(p.X));
            float k = tone * (1 - 0.45f * inGroove * (0.8f + 0.2f * p.Z / Length));
            float rust = inGroove * Mathf.SmoothStep(0.22f, 0.02f, p.Z) * (0.6f + 0.4f * Wear(p.X * 40f, p.Z * 23f));
            var c = new Color(k * 0.97f, k * 0.99f, k, 1);
            return c.Lerp(new Color(0.34f, 0.2f, 0.1f, 1), 0.45f * rust);
        }
        Vector2 UvTop(Vector3 p) => new Vector2(p.X, p.Z) / Tile + new Vector2(0.31f, 0.17f);
        void V(Vector3 p, Vector3 n, Vector2 uv, Color c) { st.SetNormal(n); st.SetUV(uv); st.SetColor(c); st.AddVertex(p); }
        Vector3 TopNormal(int i, int j)
        {
            var a = top[Math.Min(i + 1, Nx), j] - top[Math.Max(i - 1, 0), j];
            var b = top[i, Math.Min(j + 1, Nz)] - top[i, Math.Max(j - 1, 0)];
            return b.Cross(a).Normalized();
        }
        // the top (wound clockwise seen from above: Godot's front face)
        for (int i = 0; i < Nx; i++)
            for (int j = 0; j < Nz; j++)
            {
                var q = new[] { (i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1) };
                // (the geometric normal (v1 - v0) x (v2 - v0) points into the stone: Godot's clockwise front face)
                foreach (int k in new[] { 0, 2, 3, 0, 1, 2 })
                {
                    var (a, b) = q[k];
                    V(top[a, b], TopNormal(a, b), UvTop(top[a, b]), Tint(top[a, b], false));
                }
            }
        // the sides and the ends down into the bed: a strip under each edge of the top
        void Side(Vector3 a, Vector3 b, Vector3 outward)
        {
            var a2 = new Vector3(a.X, -Depth, a.Z);
            var b2 = new Vector3(b.X, -Depth, b.Z);
            Vector2 Uv(Vector3 p) => (Math.Abs(outward.X) > 0.5f ? new Vector2(p.Z, -p.Y) : new Vector2(p.X, -p.Y)) / Tile;
            var quad = new[] { a, b, b2, a2 };
            var w = (b - a).Cross(a2 - a);
            int[] order = w.Dot(outward) > 0 ? new[] { 0, 2, 1, 0, 3, 2 } : new[] { 0, 1, 2, 0, 2, 3 };
            foreach (int k in order) V(quad[k], outward, Uv(quad[k]), Tint(quad[k], true));
        }
        for (int j = 0; j < Nz; j++)
        {
            Side(top[0, j], top[0, j + 1], Vector3.Left);
            Side(top[Nx, j], top[Nx, j + 1], Vector3.Right);
        }
        for (int i = 0; i < Nx; i++)
        {
            Side(top[i, Nz], top[i + 1, Nz], Vector3.Back);
            Side(top[i, 0], top[i + 1, 0], Vector3.Forward);
        }
        st.GenerateTangents();
        var mesh = st.Commit();
        mesh.ResourceName = "pipe_channel_stone";
        return mesh;
    }
}
