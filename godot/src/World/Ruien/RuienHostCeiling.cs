using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>The original room vault, before passage cuts, indexed for lining junctions.</summary>
internal sealed class RuienHostCeiling
{
    private const float Cell=.5f;
    private readonly record struct Triangle(Vector3 A,Vector3 B,Vector3 C);
    private readonly Dictionary<(int,int),List<Triangle>> cells=new();
    private static int Grid(float value)=>(int)MathF.Floor(value/Cell);

    internal RuienHostCeiling(RuienData.Area area)
    {
        using var timing=Dev.StartupTiming.Measure("ruien.passage-host-ceiling");
        // Collision exports retain the vault profile without texture tessellation.
        // Read once; all subsequent queries use only managed arrays and nearby faces.
        var shape=ResourceLoader.Load<ConcavePolygonShape3D>(area.Export+"/collision.res")
            ??throw new InvalidOperationException("Missing host vault collision: "+area.Id);
        var points=shape.Data;float floor=area.Zones[0].S.LedgeY+1.2f;
        for(int i=0;i+2<points.Length;i+=3)
        {
            var a=points[i];var b=points[i+1];var c=points[i+2];
            if(Math.Max(a.Y,Math.Max(b.Y,c.Y))<floor)continue;
            var n=(b-a).Cross(c-a);
            // Collision is two-sided; its exported winding is independent of the visible mesh.
            if(n.LengthSquared()<1e-12f||MathF.Abs(n.Normalized().Y)<.05f)continue;
            var lo=a.Min(b).Min(c);var hi=a.Max(b).Max(c);var tri=new Triangle(a,b,c);
            for(int x=Grid(lo.X);x<=Grid(hi.X);x++)for(int z=Grid(lo.Z);z<=Grid(hi.Z);z++)
            {
                if(!cells.TryGetValue((x,z),out var list))cells[(x,z)]=list=new();
                list.Add(tri);
            }
        }
    }

    internal float At(Vector3 p,float floor,float fallback)
    {
        float top=fallback;
        if(!cells.TryGetValue((Grid(p.X),Grid(p.Z)),out var nearby))return top;
        foreach(var tri in nearby)
        {
            var a=tri.A;var b=tri.B-a;var c=tri.C-a;var q=p-a;
            float det=b.X*c.Z-b.Z*c.X;if(MathF.Abs(det)<1e-10f)continue;
            float u=(q.X*c.Z-q.Z*c.X)/det,v=(b.X*q.Z-b.Z*q.X)/det;
            if(u<-.0001f||v<-.0001f||u+v>1.0001f)continue;
            float y=a.Y+u*b.Y+v*c.Y;
            if(y>floor+1.2f)top=Math.Min(top,y);
        }
        return top;
    }
}
