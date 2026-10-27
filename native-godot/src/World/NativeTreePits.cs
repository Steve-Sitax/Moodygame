using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

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
/// one frame of four Belgian blue-stone kerbs (<see cref="Frame"/>). Like the bake's it is not solid: 3 cm, stepped over.
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
        for (int p = 0; p < parts.Length; p++) Grow(parts[p]!, more[p], p == 0 ? frame : null);
        return $"{more[0].Count} tree pits{(frame == null ? " (the blue-stone frame's material is missing: the bake's frame)" : "")}";
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
    private const float Outer = 0.9f, Width = 0.14f, Top = 0.03f, Foot = -0.03f, Arris = 0.008f, Joint = 0.003f;
    // the stone picture's repeat (the guard stones': 0.91 m)
    private const float Tile = 0.91f;

    private static ArrayMesh? Frame()
    {
        if (ResourceLoader.Load<Material>(Stone) is not { } stone) return null;
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        var rng = new Random(1873);
        float o = Outer, i = Outer - Width;
        foreach (var (x0, z0, x1, z1) in new[] { (-o, i, o, o), (-o, -o, o, -i), (i, -i + Joint, o, i - Joint), (-o, -i + Joint, -i, i - Joint) })
            Kerb(st, x0, z0, x1, z1, Top + (float)(rng.NextDouble() - 0.5) * 0.003f, rng);
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
            // the side facing the earth: splashed and damp
            if (new Vector2(n.X, n.Z).Dot(-centre) > 0) k *= 0.82f;
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

    private static Transform3D WorldOf(Node3D node)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
        return xf;
    }
}
