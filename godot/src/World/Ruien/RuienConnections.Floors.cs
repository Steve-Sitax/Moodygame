using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienConnections
{
    public static void ClearBedBanks(Godot.Collections.Array arrays,string area,string family)
    {
        if(family!="ruien_silt")return;
        Regions(area);
        if(!definitions![area].TryGetProperty("bedClearances",out var mouths))return;
        using var timing=Dev.StartupTiming.Measure("ruien.bed-bank-clearance");
        var points=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var normals=arrays[(int)Mesh.ArrayType.Normal].VariantType==Variant.Type.Nil?Array.Empty<Vector3>():arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
        var settings=mouths.EnumerateArray().Select(m=>
        {
            Vector3 V(string key){var p=m.GetProperty(key);return new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());}
            return(at:V("at"),axis:V("axis"),inside:m.GetProperty("inside").GetSingle(),outside:m.GetProperty("outside").GetSingle());
        }).ToArray();
        Vector3 Map(Vector3 p)
        {
            foreach(var m in settings)
            {
                var delta=p-m.at;float u=delta.Dot(m.axis),v=delta.Dot(Vector3.Up.Cross(m.axis));
                float weight=(1-Mathf.SmoothStep(.8f,2.5f,MathF.Abs(u)))*(1-Mathf.SmoothStep(1.15f,2.7f,MathF.Abs(v)));
                if(weight<=0)continue;
                float target=Mathf.Lerp(m.inside,m.outside,Mathf.SmoothStep(-.6f,.8f,u));
                // Retain centimetre-scale silt relief while clearing the wall's
                // metre-high bank from the channel's central walking envelope.
                float lowered=target+.015f*(RuienSurfaceRepair.Noise(p*6)-.5f);
                p.Y=Mathf.Lerp(p.Y,Math.Min(p.Y,lowered),weight);
            }
            return p;
        }
        for(int i=0;i<points.Length;i++)
        {
            var p=points[i];var q=Map(p);if(q==p)continue;points[i]=q;
            if(normals.Length!=points.Length)continue;
            const float e=.001f;
            var x=(Map(p+Vector3.Right*e)-Map(p-Vector3.Right*e))/(2*e);
            var z=(Map(p+Vector3.Back*e)-Map(p-Vector3.Back*e))/(2*e);
            normals[i]=z.Cross(x).Normalized();
        }
        arrays[(int)Mesh.ArrayType.Vertex]=points;
        if(normals.Length==points.Length)arrays[(int)Mesh.ArrayType.Normal]=normals;
    }

    private static IEnumerable<string> FloorSources(RuienData.Area area)
    {
        Regions(area.Id);
        if(!definitions![area.Id].TryGetProperty("floorCollisionKeys",out var requested))yield break;
        using var index=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(area.Export+"/area.json"));
        var keys=index.RootElement.GetProperty("keys");
        foreach(var key in requested.EnumerateArray())
            foreach(var file in keys.GetProperty(key.GetString()!).GetProperty("lod0").EnumerateArray())
                yield return area.Export+"/"+file.GetProperty("file").GetString();
    }

    public static IEnumerable<string> StartupFiles(RuienData data)
        =>data.Areas.SelectMany(area=>FloorSources(area).Select(source=>RuienGeometryCache.Prefetch(source,area.Id+"/channel-floor")));

    // The original O2 collision export omitted its three side-channel beds.
    // Use the authored visible floor faces, including their worn relief, rather
    // than inventing a flat collider at a guessed level or changing the export.
    private static void AddExportFloors(Node3D root,RuienData.Area area)
    {
        foreach(string source in FloorSources(area))
        {
            using var timing=Dev.StartupTiming.Measure("ruien.retained-bed-collision");
            var shape=RuienGeometryCache.Get(source,area.Id+"/channel-floor",()=>
            {
                var mesh=ResourceLoader.Load<ArrayMesh>(source);var faces=new List<Vector3>();
                float bed=area.Zones[0].S.Bed;
                for(int surface=0;surface<mesh.GetSurfaceCount();surface++)
                {
                    using var arrays=mesh.SurfaceGetArrays(surface);
                    ClearBedBanks(arrays,area.Id,mesh.SurfaceGetName(surface));
                    float ceiling=mesh.SurfaceGetName(surface)=="ruien_silt"?area.Zones[0].S.LedgeY-.3f:bed+.4f;
                    var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var ix=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,p.Length).ToArray():arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                    if(ix.Length==0)ix=Enumerable.Range(0,p.Length).ToArray();
                    for(int i=0;i+2<ix.Length;i+=3)
                    {
                        var a=p[ix[i]];var b=p[ix[i+1]];var c=p[ix[i+2]];
                        if(Math.Min(a.Y,Math.Min(b.Y,c.Y))<bed-.31f||Math.Max(a.Y,Math.Max(b.Y,c.Y))>ceiling)continue;
                        var normal=(c-a).Cross(b-a);
                        if(normal.LengthSquared()<1e-12f||normal.Normalized().Y<.5f)continue;
                        faces.Add(a);faces.Add(b);faces.Add(c);
                    }
                }
                return new ConcavePolygonShape3D{Data=faces.ToArray(),BackfaceCollision=true};
            });
            var body=new StaticBody3D{Name="channel_floor_"+root.GetChildCount(),CollisionLayer=Solid.Layer,CollisionMask=0};
            body.AddChild(new CollisionShape3D{Shape=shape});root.AddChild(body);
        }
    }
}
