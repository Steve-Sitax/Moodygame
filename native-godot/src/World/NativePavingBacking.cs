using System;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Recessed bedding beneath the Rond's separately tessellated paving rings.</summary>
public static class NativePavingBacking
{
    public static void Lay(Node3D town,Action<string> note)
    {
        using var timing=Scheldemist.Dev.StartupTiming.Measure("paving joint backing");
        foreach(var paving in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m=>m.Name=="rond_pavement"&&m.Mesh is ArrayMesh))
        {
            var source=(ArrayMesh)paving.Mesh;
            if(Enumerable.Range(0,source.GetSurfaceCount()).Any(s=>source.SurfaceGetName(s)=="recessed_joint_bedding"))continue;
            var mesh=(ArrayMesh)source.Duplicate();var bounds=source.GetAabb();var centre=bounds.GetCenter();
            centre.Y=bounds.Position.Y-.04f;float radius=MathF.Max(bounds.Size.X,bounds.Size.Z)/2+.08f;
            using var surface=new SurfaceTool();surface.Begin(Mesh.PrimitiveType.Triangles);
            // It shares the existing paving's grain and wet response; a dark neutral
            // vertex tint reads as bedding through the 1–30 mm polygon-joint gaps.
            surface.SetMaterial(source.SurfaceGetMaterial(0));
            void Vertex(Vector3 p)
            {
                surface.SetNormal(Vector3.Up);surface.SetTangent(new Plane(Vector3.Right,1));
                surface.SetColor(new Color(.25f,.24f,.22f));surface.SetUV(new Vector2(p.X,p.Z));surface.AddVertex(p);
            }
            const int count=192;
            for(int i=0;i<count;i++)
            {
                float a=Mathf.Tau*i/count,b=Mathf.Tau*(i+1)/count;
                Vertex(centre);Vertex(centre+new Vector3(MathF.Cos(a),0,MathF.Sin(a))*radius);Vertex(centre+new Vector3(MathF.Cos(b),0,MathF.Sin(b))*radius);
            }
            surface.Commit(mesh);mesh.SurfaceSetName(mesh.GetSurfaceCount()-1,"recessed_joint_bedding");paving.Mesh=mesh;
            note("Rond paving: recessed bedding closes ring joints (192 hidden mating triangles)");
        }
    }
}
