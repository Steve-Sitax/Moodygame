using Godot;
using Scheldemist.Models;

namespace Scheldemist.Play;

/// <summary>
/// The work goods (workgoods.glb, art-source/tools/blender/build_workgoods.py): the emigrants' trunk, bundle,
/// featherbed and lidded basket, the cooper's tub, a bundle of hides, a goods parcel (#151); the gutting knife, one
/// herring and the clerk's open ledger in the hands (#131); the works' crab winch (#128). One model per thing,
/// wherever it is: on the quay, on a cart, in the hands. Each copy has its origin on the middle of its base, its
/// front toward +z.
/// </summary>
public static class WorkGoods
{
    public static readonly ModelLibrary.Look Look = new(TwoSided: true, Affine: 0, VertexColor: true);
    public static bool Has => ModelLibrary.Available("workgoods");

    /// <summary>A copy of one of the goods at its own size (or scaled as a whole), or null without the model.</summary>
    public static Node3D? Copy(string name, float scale = 1)
    {
        if (!Has || ModelLibrary.Get("workgoods", Look)?.Copy(name) is not { } copy) return null;
        copy.Transform = Transform3D.Identity;
        if (scale != 1) copy.Scale = Vector3.One * scale;
        return copy;
    }
}
