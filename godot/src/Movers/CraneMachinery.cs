using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// The portal crane's winch turns while it hoists (#128). Its machinery is merged into the turning part's mesh
/// (art-source/tools/blender/boats/cranes.py portal_jib, "the machinery"): the winch drum with its rope, flanges, axle
/// and great wheel on one axis; the crankshaft with its pinion, flywheel and crank disc on another. Once per mesh their
/// triangles are taken out into two meshes of their own, each centred on its axle, and every crane gets two nodes that
/// turn: the drum by the rope wound on or paid out, the crankshaft faster by the gears' teeth (20 to 8). Nothing else
/// of the crane changes; the triangles are the model's own.
/// </summary>
internal static class CraneMachinery
{
    // cranes.py, in the jib's frame (Blender x, y, z is the game's x, z, -y): the drum's axis at y -0.2, z 1.25; the
    // crankshaft at y 0.33, z 1.55; both along x
    private static readonly Vector2 DrumAxis = new(1.25f, 0.2f), CrankAxis = new(1.55f, -0.33f);
    private const float RopeRadius = 0.3f, GearRatio = 20f / 8f;

    private sealed record Split(Mesh Rest, Mesh? Drum, Mesh? Crank, int DrumTris, int CrankTris, int[] DrumFrom, int[] CrankFrom);
    private static readonly Dictionary<Mesh, Split> splits = new();

    internal sealed class Parts
    {
        public Node3D? Drum, Crank;
        public float Angle, LastHy = float.NaN;
        public int DrumTris, CrankTris;
    }

    private static float R(Vector3 p, Vector2 axis) => new Vector2(p.Y - axis.X, p.Z - axis.Y).Length();
    private static bool In(float x, float lo, float hi) => x >= lo && x <= hi;

    /// <summary>Which of the turning parts a point belongs to: 1 the drum's, 2 the crankshaft's, 0 neither.</summary>
    private static int Part(Vector3 p)
    {
        float ra = R(p, DrumAxis), rb = R(p, CrankAxis);
        // the two gears mesh at x 0.32..0.38: a point goes to the wheel it is nearer, by each wheel's size
        if (In(p.X, 0.315f, 0.385f))
        {
            if (ra <= 0.47f && ra / 0.46f <= rb / 0.14f) return 1;
            if (rb <= 0.15f) return 2;
        }
        if (In(p.X, -0.585f, -0.065f) && ra <= 0.335f) return 1;             // the drum and its rope
        if ((In(p.X, -0.865f, -0.825f) || In(p.X, 0.175f, 0.215f)) && ra <= 0.39f) return 1; // its flanges
        if (In(p.X, -1.005f, 0.425f) && ra <= 0.056f) return 1;             // its axle
        if (In(p.X, -1.125f, 0.425f) && rb <= 0.041f) return 2;             // the crankshaft
        if (In(p.X, -1.115f, -1.025f) && rb <= 0.38f) return 2;             // the flywheel
        if (In(p.X, 0.09f, 0.15f) && rb <= 0.126f) return 2;                // the crank disc
        return 0;
    }

    private static Split Make(Mesh source, Transform3D toJib)
    {
        var rest = new ArrayMesh();
        var drum = new ArrayMesh();
        var crank = new ArrayMesh();
        int drumTris = 0, crankTris = 0;
        var drumFrom = new List<int>();
        var crankFrom = new List<int>();
        var fromJib = toJib.AffineInverse();
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var arrays = source.SurfaceGetArrays(s);
            var material = source.SurfaceGetMaterial(s);
            var pos = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var index = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            if (index.Length == 0) { index = new int[pos.Length]; for (int i = 0; i < index.Length; i++) index[i] = i; }
            var keep = new List<int>(index.Length);
            var a = new List<int>();
            var b = new List<int>();
            for (int t = 0; t + 2 < index.Length; t += 3)
            {
                int p0 = Part(toJib * pos[index[t]]), p1 = Part(toJib * pos[index[t + 1]]), p2 = Part(toJib * pos[index[t + 2]]);
                var list = p0 == p1 && p1 == p2 ? p0 == 1 ? a : p0 == 2 ? b : keep : keep;
                list.Add(index[t]); list.Add(index[t + 1]); list.Add(index[t + 2]);
            }
            void Add(ArrayMesh into, List<int> tris, Vector2? axis, List<int>? from)
            {
                // (the rest keeps every surface, so the instance's own surface materials still fit)
                if (tris.Count == 0) { if (axis != null) return; tris.AddRange(new[] { 0, 0, 0 }); }
                from?.Add(s);
                var copy = (Godot.Collections.Array)arrays.Duplicate();
                if (axis is { } c)
                {
                    // centred on its axle (in the jib's frame), back in the mesh's own axes
                    var moved = new Vector3[pos.Length];
                    var shift = new Vector3(0, c.X, c.Y);
                    for (int i = 0; i < pos.Length; i++) moved[i] = fromJib.Basis * (toJib * pos[i] - shift);
                    copy[(int)Mesh.ArrayType.Vertex] = moved;
                }
                copy[(int)Mesh.ArrayType.Index] = tris.ToArray();
                into.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, copy);
                into.SurfaceSetMaterial(into.GetSurfaceCount() - 1, material);
            }
            Add(rest, keep, null, null);
            Add(drum, a, DrumAxis, drumFrom);
            Add(crank, b, CrankAxis, crankFrom);
            drumTris += a.Count / 3; crankTris += b.Count / 3;
        }
        return new Split(rest, drumTris > 0 ? drum : null, crankTris > 0 ? crank : null, drumTris, crankTris, drumFrom.ToArray(), crankFrom.ToArray());
    }

    /// <summary>Take the turning parts out of a crane's jib meshes and give it the two nodes that turn.</summary>
    internal static Parts Fit(Node3D jib)
    {
        var parts = new Parts();
        var meshes = new List<MeshInstance3D>();
        foreach (var n in World.BakedWorld.All(jib)) if (n is MeshInstance3D { Mesh: not null } mi) meshes.Add(mi);
        foreach (var mi in meshes)
        {
            var toJib = Transform3D.Identity;
            for (Node? up = mi; up != null && up != jib; up = up.GetParent()) if (up is Node3D q) toJib = q.Transform * toJib;
            if (mi == jib) toJib = Transform3D.Identity;
            if (!splits.TryGetValue(mi.Mesh, out var split)) splits[mi.Mesh] = split = Make(mi.Mesh, toJib);
            if (split.Drum == null && split.Crank == null) continue;
            var overrides = new Material?[mi.GetSurfaceOverrideMaterialCount()];
            for (int s = 0; s < overrides.Length; s++) overrides[s] = mi.GetSurfaceOverrideMaterial(s);
            mi.Mesh = split.Rest;
            for (int s = 0; s < overrides.Length; s++) mi.SetSurfaceOverrideMaterial(s, overrides[s]);
            Node3D? Turning(Mesh? mesh, Vector2 axis, string name, int[] from)
            {
                if (mesh == null) return null;
                // the part's own node on its axle, in the jib's frame; the mesh instance's own turn kept under it
                var pivot = new Node3D { Name = name, Position = new Vector3(0, axis.X, axis.Y) };
                var part = new MeshInstance3D { Mesh = mesh, Name = name + "_mesh", Basis = toJib.Basis, CastShadow = mi.CastShadow, MaterialOverride = mi.MaterialOverride };
                for (int k = 0; k < from.Length; k++) if (from[k] < overrides.Length && overrides[from[k]] is { } m) part.SetSurfaceOverrideMaterial(k, m);
                pivot.AddChild(part);
                jib.AddChild(pivot);
                return pivot;
            }
            parts.Drum ??= Turning(split.Drum, DrumAxis, "winch_drum", split.DrumFrom);
            parts.Crank ??= Turning(split.Crank, CrankAxis, "winch_crankshaft", split.CrankFrom);
            parts.DrumTris += split.DrumTris; parts.CrankTris += split.CrankTris;
        }
        return parts;
    }

    /// <summary>The hook moved from LastHy to hy: the drum winds or pays out its rope, the crankshaft turns it.</summary>
    internal static void Turn(Parts parts, float hy)
    {
        if (float.IsNaN(parts.LastHy)) { parts.LastHy = hy; return; }
        parts.Angle += (hy - parts.LastHy) / RopeRadius;
        parts.LastHy = hy;
        if (parts.Drum != null) parts.Drum.Rotation = new Vector3(parts.Angle, 0, 0);
        if (parts.Crank != null) parts.Crank.Rotation = new Vector3(-parts.Angle * GearRatio, 0, 0);
    }
}
