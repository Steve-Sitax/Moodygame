using System;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>
/// Counts a built mesh's triangles by their winding (Godot's front face turns clockwise as seen from outside: a triangle's
/// (p1 - p0) x (p2 - p0) points against its corners' normal). A mesh wound the other way is culled from outside and
/// shows its inside (the trunks drawn inside out, 2026-10-28). Returns the triangles wound right and wrong.
/// </summary>
public static class MeshWinding
{
    public static (int Right, int Wrong) Count(Mesh? mesh)
    {
        int right = 0, wrong = 0;
        if (mesh is not ArrayMesh am) return (0, 0);
        for (int s = 0; s < am.GetSurfaceCount(); s++)
        {
            if (am.SurfaceGetPrimitiveType(s) != Mesh.PrimitiveType.Triangles) continue;
            var arrays = am.SurfaceGetArrays(s);
            var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            if (arrays[(int)Mesh.ArrayType.Normal].VariantType != Variant.Type.PackedVector3Array) continue;
            var n = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
            var index = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.PackedInt32Array ? arrays[(int)Mesh.ArrayType.Index].AsInt32Array() : null;
            int count = (index?.Length ?? v.Length) / 3;
            for (int t = 0; t < count; t++)
            {
                int a = index?[3 * t] ?? 3 * t, b = index?[3 * t + 1] ?? 3 * t + 1, c = index?[3 * t + 2] ?? 3 * t + 2;
                var cross = (v[b] - v[a]).Cross(v[c] - v[a]);
                if (cross.LengthSquared() < 1e-14f) continue;
                if (cross.Dot(n[a] + n[b] + n[c]) < 0) right++; else wrong++;
            }
        }
        return (right, wrong);
    }

    /// <summary>
    /// "name n wound right, m wrong" for the log; with <paramref name="up"/> (a mesh that lies on the ground, whose normals
    /// SurfaceTool made from the winding itself) also how many triangles face down.
    /// </summary>
    public static string Say(string name, Mesh? mesh, bool up = false)
    {
        var (right, wrong) = Count(mesh);
        int down = 0;
        if (up && mesh is ArrayMesh am)
        {
            var f = am.GetFaces();
            for (int i = 0; i + 2 < f.Length; i += 3)
            {
                // (clockwise from above points the cross down; an upright one, under 3 degrees off, faces neither way)
                var cr = (f[i + 1] - f[i]).Cross(f[i + 2] - f[i]);
                if (cr.Y > 0.05f * cr.Length()) down++;
            }
        }
        return $"{name} {right} wound right, {wrong} wrong" + (up ? $", {down} facing down" : "");
    }
}
