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
public static partial class NativeDirt
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
        return n + Mud(town);
    }

    /// <summary>
    /// The canals' beds (town/tide_mud's tide_bed surface, bared at low water; #252): Codex's tidal silt instead of the pale
    /// sand ripples, in the mud's own stored shader with its silt lines (Psx.SiltLines, scripts/SiltRepair.cs: no new kind).
    /// The wet silt and the drier silt higher up, hex-tiled in world metres with each hexagon turned its own way (a 2 m tile
    /// laid plain repeats like a camouflage print); the water is laid in world space from the river's level now (SiltLevel),
    /// so the water line breaks into inlets and the pools join up. No parallax: the silt's relief is a few millimetres, the
    /// lights take it from its normal map. The thin strip at the moat's and the river's walls (the tide_mud surface) keeps
    /// its ripples: seen from a step away the silt there read blurred and its water sheets hard-edged (Codex, #252), and the
    /// rule is new dirt only where it is better.
    /// </summary>
    private static int Mud(Node3D town)
    {
        const string Dir = "res://assets/materials/dirt-20261028/";
        if (!ResourceLoader.Exists(Dir + "silt_wet.res")) return 0;
        var mud = BakedWorld.All(town).OfType<MeshInstance3D>().FirstOrDefault(m => m.Name == "tide_mud" && m.Mesh is ArrayMesh);
        if (mud == null) return 0;
        var wet = GD.Load<Texture2D>(Dir + "silt_wet.res");
        var dry = GD.Load<Texture2D>(Dir + "silt_dry.res");
        var rel = GD.Load<Texture2D>(Dir + "silt_relief.res");
        var silts = new System.Collections.Generic.List<ShaderMaterial>();
        for (int s = 0; s < mud.Mesh.GetSurfaceCount(); s++)
        {
            // (the stored shader without the silt lines: the ripples stay)
            if (mud.Mesh.SurfaceGetMaterial(s) is not ShaderMaterial m || m.Shader?.Code.Contains("uniform float silt ") != true) continue;
            if (m.ResourceName != CanalBeds) continue;
            m.SetShaderParameter("tex", wet);
            m.SetShaderParameter("silt_dry", dry);
            m.SetShaderParameter("silt_rel", rel);
            // (the ripples' height goes; the relief light and the parallax are the sand's, not the silt's)
            m.SetShaderParameter("relief_h", rel);
            m.SetShaderParameter("relief_depth", 0f);
            m.SetShaderParameter("silt", 1f);
            m.SetShaderParameter("silt_tile", 2f);
            m.SetShaderParameter("silt_bump", SiltBump);
            m.SetShaderParameter("silt_pools", SiltPools);
            // (the silt's own wet: no second darkening by the tide band; a dielectric's highlight, a wet sheet's)
            m.SetShaderParameter("tide_wet", 0f);
            m.SetShaderParameter("spec_color", new Vector3(0.02f, 0.02f, 0.02f));
            m.SetShaderParameter("shininess", 48f);
            m.SetShaderParameter("albedo", BedTint);
            silts.Add(m);
        }
        if (silts.Count == 0) return 0;
        mud.AddChild(new SiltLevel { Name = "silt_level", Silts = silts });
        GD.Print($"dirt: tide mud, tidal silt on the canals' beds ({silts.Count} surface)");
        return 1;
    }
    // (the canals' beds' surface; the mesh's vertex colour tints it green-grey, the silt comes back to its own grey-brown)
    private const string CanalBeds = "tide_bed";
    private static readonly Color BedTint = new(1.35f, 1.18f, 1.02f, 1);
    private const float SiltBump = 1.2f, SiltPools = 0.18f;

    /// <summary>The river's level now for the silt's water line (Tide.River follows the clock or the tide kit's hold).</summary>
    private sealed partial class SiltLevel : Node
    {
        public System.Collections.Generic.List<ShaderMaterial> Silts = new();
        private float last = float.NaN;
        public override void _Process(double delta)
        {
            if (Tide.River == last) return;
            last = Tide.River;
            foreach (var m in Silts) m.SetShaderParameter("silt_level", last);
        }
    }

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
