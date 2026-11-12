using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Scoured silt beneath the gate aprons, with a gradual bank back to the
/// existing tidal bed. The visible terrain and Solid use the same changed mesh.</summary>
public static class RuienGateBed
{
    public static int Scour(Node3D town,RuienData data)
    {
        using var timing=Dev.StartupTiming.Measure("ruien.gate-bed-scour");
        var regions=new List<QuayNotch.DeformRegion>();
        foreach(var gate in data.Areas.Where(a=>a.Id.StartsWith("network_",StringComparison.Ordinal)).SelectMany(a=>a.Gates))
        {
            if(gate.Sill> -3||gate.Opening.Length<3)continue;
            var n=new Vector3(gate.Normal.X,0,gate.Normal.Y);
            var frame=new Transform3D(new Basis(new Vector3(-n.Z,0,n.X),Vector3.Up,-n),new Vector3(gate.Origin.X,0,gate.Origin.Y));
            var inverse=frame.AffineInverse();float half=gate.Opening.Max(p=>p.X)-.78f;
            float outer=half+1.4f;
            var box=frame*new Aabb(new Vector3(-outer,gate.Sill-.36f,-4.8f),new Vector3(outer*2,3,7.2f));
            var planes=new List<Func<Vector3,float>>();
            // Shared planes retain matching subdivision points on neighbouring
            // triangles, including the coarse original four-metre silt strips.
            for(float x=-outer;x<=outer+.001f;x+=.2f){float at=x;planes.Add(p=>(inverse*p).X-at);}
            for(float z=-4.8f;z<=2.401f;z+=.2f){float at=z;planes.Add(p=>(inverse*p).Z-at);}
            Vector3 Lower(Vector3 p)
            {
                var q=inverse*p;
                float across=1-Mathf.SmoothStep(half+.25f,outer,MathF.Abs(q.X));
                float along=Mathf.SmoothStep(-4.8f,-3.55f,q.Z)*(1-Mathf.SmoothStep(1.6f,2.4f,q.Z));
                float weight=across*along;
                // The dressed stone apron has a 28 cm bearing thickness. Keep
                // the existing silt's fine height variation below that bearing.
                float target=gate.Sill-.34f+.008f*MathF.Sin(q.X*5.7f+q.Z*3.1f);
                q.Y=Mathf.Lerp(q.Y,Math.Min(q.Y,target),weight);
                return weight>0?frame*q:p;
            }
            regions.Add(new(box,planes,Lower));
        }
        int changed=0;
        foreach(var mi in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m=>m.Name=="tide_mud"&&m.Mesh is ArrayMesh))
        {
            var source=(ArrayMesh)mi.Mesh;var xf=Transform3D.Identity;
            for(Node? node=mi;node is Node3D n;node=node.GetParent())xf=n.Transform*xf;
            var result=new ArrayMesh{ResourceName=source.ResourceName};
            foreach(var key in source.GetMetaList())result.SetMeta(key,source.GetMeta(key));
            int here=0;
            for(int s=0;s<source.GetSurfaceCount();s++)
            {
                using var arrays=source.SurfaceGetArrays(s);
                if(source.SurfaceGetPrimitiveType(s)==Mesh.PrimitiveType.Triangles)here+=QuayNotch.DeformSurface(arrays,xf,regions);
                result.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s),arrays,null,null,source.SurfaceGetFormat(s));
                result.SurfaceSetMaterial(s,source.SurfaceGetMaterial(s));result.SurfaceSetName(s,source.SurfaceGetName(s));
            }
            if(source.HasMeta("native_solid_stand_in"))
            {
                using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);
                arrays[(int)Mesh.ArrayType.Vertex]=source.GetMeta("native_solid_stand_in");
                here+=QuayNotch.DeformSurface(arrays,xf,regions);
                var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arrays[(int)Mesh.ArrayType.Index];
                result.SetMeta("native_solid_stand_in",ix.VariantType==Variant.Type.Nil?p:ix.AsInt32Array().Select(i=>p[i]).ToArray());
            }
            if(here>0){mi.Mesh=result;changed+=here;}else result.Dispose();
        }
        return changed;
    }
}
