using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Native.Recovery;

/// <summary>Separate the bluestone seat from the iron. Keep collision, UVs and the asset's permanent identity.</summary>
public static class RecoveryIron
{
    public static ArrayMesh Build(Mesh source)
    {
        var mesh = new ArrayMesh { ResourceName = source.ResourceName };
        for (int surface = 0; surface < source.GetSurfaceCount(); surface++)
        {
            var arrays = source.SurfaceGetArrays(surface); var positions = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var material = source.SurfaceGetMaterial(surface);
            if (material is BaseMaterial3D standard && standard.ResourceName == "qf_solid")
            {
                var indices = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Array.Empty<int>() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                if (indices.Length == 0) indices = Enumerable.Range(0, positions.Length).ToArray();
                var stone = new List<int>(); var iron = new List<int>();
                for (int i = 0; i < indices.Length; i += 3)
                {
                    var group = Math.Max(positions[indices[i]].Y, Math.Max(positions[indices[i + 1]].Y, positions[indices[i + 2]].Y)) > 0.064f ? iron : stone;
                    group.AddRange(indices.Skip(i).Take(3));
                }
                void Add(List<int> selected, Material mat)
                {
                    if (selected.Count == 0) return;
                    var copy = arrays.Duplicate(); copy[(int)Mesh.ArrayType.Index] = selected.ToArray();
                    mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, copy); mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, mat);
                }
                Add(stone, standard);
                var casting = new ShaderMaterial { ResourceName = "native_cast_iron", Shader = ResourceLoader.Load<Shader>("res://shaders/cast_iron.gdshader") };
                casting.SetMeta("native_surface_kind", "cast_iron"); casting.SetShaderParameter("surface_depth", 1f);
                Add(iron, casting);
            }
            else
            {
                if (material is BaseMaterial3D decal && decal.ResourceName == "qf_decal")
                {
                    // This is a rust stain on the paving, not a plate placed above the stone pedestal.
                    for (int i = 0; i < positions.Length; i++) positions[i].Y = 0.002f;
                    arrays[(int)Mesh.ArrayType.Vertex] = positions;
                }
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays); mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, material);
            }
        }
        mesh.SetMeta("native_iron_detail", 1);
        return mesh;
    }
}
