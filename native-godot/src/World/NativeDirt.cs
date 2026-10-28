using System;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Issue #244 (Steve, 2026-10-28: "very low detail dirt where the tree stands ... find more dirt in the game and change if
/// new dirt is better"): the bake's other bare earth that the eye comes close to takes the tree pits' soil
/// (assets/materials/dirt-20261028/pit-soil.tres: a 1 m picture with its height, wet and dry, water in its hollows). The planted
/// beds of the Lijnwaadmarkt, St James's yard and the court green (one 32 px picture with a bump map) and the earth under
/// the liberty tree (a plain colour). Each keeps its mesh; its picture is laid in metres (`uv_xform` from the mesh's own uv
/// per metre), one copy of the soil material per bed, the same shader and pictures (no new kind, no new texture).
/// </summary>
public static class NativeDirt
{
    private const string Soil = "res://assets/materials/dirt-20261028/pit-soil.tres";
    private static readonly string[] Beds = { "place_lijnwaadmarkt_pl_earth", "place_stjacob_yard_pl_earth", "place_court_green_pl_earth", "liberty_tree_earth" };

    /// <summary>Lays the soil on the beds found; returns how many.</summary>
    public static int Lay(Node3D town)
    {
        if (!ResourceLoader.Exists(Soil)) return 0;
        var soil = GD.Load<ShaderMaterial>(Soil);
        int n = 0;
        foreach (var bed in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => Beds.Contains(m.Name.ToString()) && m.Mesh is ArrayMesh))
        {
            float perMetre = UvPerMetre((ArrayMesh)bed.Mesh, Scale(bed));
            if (perMetre <= 0) continue;
            var m = (ShaderMaterial)soil.Duplicate();
            m.ResourceName = "soil_" + bed.Name;
            m.SetShaderParameter("uv_xform", new Vector4(1 / perMetre, 1 / perMetre, 0, 0));
            for (int s = 0; s < bed.Mesh.GetSurfaceCount(); s++) bed.SetSurfaceOverrideMaterial(s, m);
            GD.Print($"dirt: {bed.Name} soil, {perMetre:0.###} uv a metre");
            n++;
        }
        // (the deepened mud read as dry, dug earth on the foreshore (Codex review, #244): the sand ripples stay until the
        // reworked wet silt passes; dev: --new-tide-mud shows it)
        return n + (Scheldemist.Main.I.Flag("new-tide-mud") ? Mud(town) : 0);
    }

    /// <summary>
    /// The river's mud (town/tide_mud: the foreshore under the quay walls and the canals' beds, bared at low water): the
    /// deepened wet mud (sole prints with pushed-up ridges, smeared lumps, a drying crust, level water pockets) instead of
    /// the pale sand ripples, in the mud's own shader (its tide band, relief and parallax: only its pictures and numbers).
    /// </summary>
    private static int Mud(Node3D town)
    {
        const string Dir = "res://assets/materials/dirt-20261028/";
        if (!ResourceLoader.Exists(Dir + "wet_mud_dry.res")) return 0;
        var mud = BakedWorld.All(town).OfType<MeshInstance3D>().FirstOrDefault(m => m.Name == "tide_mud" && m.Mesh is ArrayMesh);
        if (mud == null) return 0;
        float perMetre = UvPerMetre((ArrayMesh)mud.Mesh, Scale(mud));
        for (int s = 0; s < mud.Mesh.GetSurfaceCount(); s++)
        {
            if (mud.Mesh.SurfaceGetMaterial(s) is not ShaderMaterial old || old.GetShaderParameter("relief_h").VariantType == Variant.Type.Nil) continue;
            var m = (ShaderMaterial)old.Duplicate();
            m.SetShaderParameter("tex", GD.Load<Texture2D>(Dir + "wet_mud_dry.res"));
            m.SetShaderParameter("relief_h", GD.Load<Texture2D>(Dir + "wet_mud_height.res"));
            m.SetShaderParameter("uv_xform", new Vector4(1 / perMetre, 1 / perMetre, 0, 0));
            m.SetShaderParameter("relief_tile", 1f);
            m.SetShaderParameter("relief_depth", MudDepth);
            m.SetShaderParameter("relief_bump", MudBump);
            m.SetShaderParameter("relief_dome", 1.5f);
            // (the mud picture is darker than the sand it replaces, and the mud lies in the walls' shade: lighter, greyer)
            m.SetShaderParameter("albedo", new Color(2.3f, 2.2f, 2.1f, 1));
            mud.SetSurfaceOverrideMaterial(s, m);
        }
        GD.Print($"dirt: tide mud, {perMetre:0.###} uv a metre");
        return 1;
    }
    // (the deepened mud's height spans 50 mm: maps.json)
    private const float MudDepth = 0.05f, MudBump = 6f;

    /// <summary>A node's turn and scale in the town (the town is not in the tree yet: its parents' own transforms).</summary>
    private static Basis Scale(Node3D node)
    {
        var b = Basis.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) b = n3.Transform.Basis * b;
        return b;
    }

    /// <summary>The mesh's uv per world metre: the square root of its uv area over its world area.</summary>
    private static float UvPerMetre(ArrayMesh mesh, Basis basis)
    {
        double uvArea = 0, area = 0;
        for (int s = 0; s < mesh.GetSurfaceCount(); s++)
        {
            var a = mesh.SurfaceGetArrays(s);
            var v = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            if (a[(int)Mesh.ArrayType.TexUV].VariantType != Variant.Type.PackedVector2Array) continue;
            var uv = a[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            var ix = a[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.PackedInt32Array ? a[(int)Mesh.ArrayType.Index].AsInt32Array() : Enumerable.Range(0, v.Length).ToArray();
            for (int t = 0; t + 2 < ix.Length; t += 3)
            {
                int i = ix[t], j = ix[t + 1], k = ix[t + 2];
                area += (basis * (v[j] - v[i])).Cross(basis * (v[k] - v[i])).Length() / 2;
                var du = uv[j] - uv[i]; var dv = uv[k] - uv[i];
                uvArea += Math.Abs(du.X * dv.Y - du.Y * dv.X) / 2;
            }
        }
        return area > 1e-6 ? (float)Math.Sqrt(uvArea / area) : 0;
    }
}
