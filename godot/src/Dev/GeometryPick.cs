using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>The actual drawn triangles under normalized image positions, for native scene diagnostics.</summary>
public static class GeometryPick
{
    public static IEnumerable<string> At(Node view,Camera3D camera,IReadOnlyList<Vector2> fractions)
    {
        var rays=fractions.Select(f=>
        {
            var pixel=f*camera.GetViewport().GetVisibleRect().Size;
            return (Origin:camera.ProjectRayOrigin(pixel),Direction:camera.ProjectRayNormal(pixel));
        }).ToArray();
        var hits=rays.Select(_=>new List<(float Distance,string What)>()).ToArray();
        foreach(var node in BakedWorld.All(view))
        {
            if(node is not MeshInstance3D mi||!mi.IsVisibleInTree()||mi.Mesh is not {} mesh||(mi.Layers&camera.CullMask)==0)continue;
            var transform=mi.GlobalTransform;var box=(transform*mi.GetAabb()).Grow(.05f);
            var nearby=Enumerable.Range(0,rays.Length).Where(i=>box.IntersectsSegment(rays[i].Origin,rays[i].Origin+rays[i].Direction*300)).ToArray();
            if(nearby.Length==0)continue;
            for(int surface=0;surface<mesh.GetSurfaceCount();surface++)
            {
                if(mesh is ArrayMesh arrayMesh&&arrayMesh.SurfaceGetPrimitiveType(surface)!=Mesh.PrimitiveType.Triangles)continue;
                using var arrays=mesh.SurfaceGetArrays(surface);
                var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var indices=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.PackedInt32Array?
                    arrays[(int)Mesh.ArrayType.Index].AsInt32Array():Enumerable.Range(0,vertices.Length).ToArray();
                var material=mi.GetActiveMaterial(surface);
                string identity=string.Join("/",mi.GetPath().ToString().Split('/').TakeLast(3))+" "+material?.ResourceName+" "+(material as ShaderMaterial)?.Shader?.ResourcePath;
                for(int t=0;t+2<indices.Length;t+=3)
                {
                    var a=transform*vertices[indices[t]];var b=transform*vertices[indices[t+1]];var c=transform*vertices[indices[t+2]];
                    foreach(int i in nearby)
                    {
                        var ray=rays[i];if(Geometry3D.RayIntersectsTriangle(ray.Origin,ray.Direction,a,b,c).Obj is not Vector3 point)continue;
                        var normal=(c-a).Cross(b-a).Normalized();
                        hits[i].Add((ray.Origin.DistanceTo(point),$"{identity} s{surface} tri {t/3} front {normal.Dot(-ray.Direction)>0} layers {mi.Layers} at {point.X:0.00},{point.Y:0.00},{point.Z:0.00}"));
                    }
                }
            }
        }
        for(int i=0;i<hits.Length;i++)
        {
            yield return $"ray {fractions[i]} from {rays[i].Origin} direction {rays[i].Direction}; {hits[i].Count} triangle hits";
            foreach(var hit in hits[i].OrderBy(h=>h.Distance).Take(6))
                yield return $"{fractions[i].X:0.###},{fractions[i].Y:0.###} {hit.Distance:0.00} m {hit.What}";
        }
    }
}
