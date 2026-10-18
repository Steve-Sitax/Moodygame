using System.Collections.Generic;
using System.Text.RegularExpressions;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>
/// Issue #188: each town block has near-only detail meshes (<c>city_X_Z_d_N</c>: sills, heads, shutters, window boxes, shop
/// fronts, fanlight bars, a large part of the dressed stone, their grime). The browser showed them while the camera was within
/// 60 m of the block's bounding sphere (city.ts DETAIL_NEAR) and the bake froze that switch as it stood: three blocks near the
/// bake's camera showed their detail at every distance, the other 24 never. Every block's detail is now shown, and the GPU's
/// visibility range (measured to the mesh's centre) hides it past <see cref="Near"/> metres beyond its own radius, so a block
/// appears while its nearest part is still that far off. They are visible before Solid runs, so they are solid: a piece of
/// detail whose foot is within <see cref="Reach"/> of its block's lowest point (plinths, quoins, door surrounds, shop fronts,
/// cellar hatches) collides as drawn, the dressed stone by its plain stand-in boxes; what is higher up (sills, heads, bands,
/// shutters on upper storeys) is out of reach and gets no collision, which keeps the load-time collision build small. The grime
/// decals and the window boxes' flowers get none (<see cref="NoCollision"/>). <c>--no-near-detail</c> keeps the bake's state.
/// </summary>
public static class NativeNearDetail
{
    /// <summary>Metres beyond a block's bounding sphere within which its detail is drawn (the browser's 60, plus the fade).</summary>
    public const float Near = 70f;
    /// <summary>The dithered fade at the far edge, so a block's detail never appears in one frame.</summary>
    public const float Fade = 12f;
    /// <summary>Meta on a detail mesh that is only paint or leaves (the grime decals, the flowers): Solid leaves it out.</summary>
    /// <summary>Height over a block's lowest detail within which its detail is solid (a person reaches and bumps into it).</summary>
    public const float Reach = 3f;
    public const string NoCollision = "native_near_detail_no_collision";
    private static readonly HashSet<string> Flat = new() { "res://world/town/resources/r000221.res", "res://world/town/resources/r000230.res" };
    private static readonly Regex Name = new("^city_-?\\d+_-?\\d+_d_\\d+$", RegexOptions.Compiled);

    public static (int Meshes, int WereHidden, int SolidTriangles, int LeftOut) Apply(IEnumerable<Node> nodes)
    {
        int meshes = 0, hidden = 0, solid = 0, leftOut = 0;
        foreach (var node in nodes)
        {
            if (node is not MeshInstance3D { Mesh: not null } mesh || !Name.IsMatch(mesh.Name.ToString())) continue;
            meshes++;
            if (!mesh.Visible) hidden++;
            mesh.Visible = true;
            float radius = mesh.GetAabb().Size.Length() * 0.5f;
            mesh.VisibilityRangeEnd = radius + Near;
            mesh.VisibilityRangeEndMargin = Fade;
            mesh.VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self;
            bool flat = true;
            for (int s = 0; s < mesh.Mesh.GetSurfaceCount(); s++) flat &= mesh.GetActiveMaterial(s) is { } m && Flat.Contains(m.ResourcePath);
            if (flat) { mesh.SetMeta(NoCollision, true); continue; }
            var (kept, gone) = WithinReach(mesh); solid += kept; leftOut += gone;
        }
        return (meshes, hidden, solid, leftOut);
    }

    /// <summary>
    /// The mesh's collision becomes its stand-in list alone (every surface skipped by Solid): the stand-in triangles and the drawn
    /// triangles of unskipped surfaces whose lowest corner is within <see cref="Reach"/> of the mesh's lowest point.
    /// </summary>
    private static (int Kept, int Gone) WithinReach(MeshInstance3D node)
    {
        if (node.Mesh is not ArrayMesh mesh) return (0, 0);
        var xf = node.GlobalTransform;
        float top = (xf * node.GetAabb()).Position.Y + Reach;
        var skip = mesh.HasMeta("native_solid_skip") ? mesh.GetMeta("native_solid_skip").AsInt32Array() : System.Array.Empty<int>();
        var kept = new List<Vector3>(); int gone = 0;
        void Take(Vector3 a, Vector3 b, Vector3 c)
        {
            if (Mathf.Min((xf * a).Y, Mathf.Min((xf * b).Y, (xf * c).Y)) < top) { kept.Add(a); kept.Add(b); kept.Add(c); } else gone++;
        }
        if (mesh.HasMeta("native_solid_stand_in"))
        {
            var faces = mesh.GetMeta("native_solid_stand_in").AsVector3Array();
            for (int t = 0; t + 2 < faces.Length; t += 3) Take(faces[t], faces[t + 1], faces[t + 2]);
        }
        var all = new int[mesh.GetSurfaceCount()];
        for (int s = 0; s < all.Length; s++)
        {
            all[s] = s;
            if (System.Array.IndexOf(skip, s) >= 0) continue;
            var arrays = mesh.SurfaceGetArrays(s); var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var idx = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            if (idx.Length == 0) for (int t = 0; t + 2 < v.Length; t += 3) Take(v[t], v[t + 1], v[t + 2]);
            else for (int t = 0; t + 2 < idx.Length; t += 3) Take(v[idx[t]], v[idx[t + 1]], v[idx[t + 2]]);
        }
        mesh.SetMeta("native_solid_stand_in", kept.ToArray());
        mesh.SetMeta("native_solid_skip", all);
        return (kept.Count / 3, gone);
    }
}
