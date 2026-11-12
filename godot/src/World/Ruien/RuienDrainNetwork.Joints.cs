using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienDrainNetwork
{
    private static float Nearest(Collector c,Vector3 p)
    {
        float best=float.MaxValue,u=0;var xy=new Vector2(p.X,p.Z);
        for(int i=0;i+1<c.Path.Length;i++)
        {
            var a=c.Path[i];var ab=c.Path[i+1]-a;float t=Math.Clamp((xy-a).Dot(ab)/Math.Max(ab.LengthSquared(),1e-8f),0,1);
            float d=xy.DistanceSquaredTo(a+ab*t);if(d>=best)continue;best=d;u=Mathf.Lerp(c.Along[i],c.Along[i+1],t);
        }
        return u;
    }
    private static QuayNotch.Region Bore(Collector c,float u,Vector2[] profile,float reach=1.8f,float margin=0)
    {
        float start=Math.Max(0,u-reach),end=Math.Min(c.Length,u+reach);
        var points=new List<(Vector3 at,float u)> { (c.At(start),start) };
        for(int i=0;i<c.Path.Length;i++)if(c.Along[i]>start&&c.Along[i]<end)points.Add((c.At(c.Along[i]),c.Along[i]));
        points.Add((c.At(end),end));
        var bounds=new Aabb(points[0].at,Vector3.Zero);foreach(var point in points)bounds=bounds.Expand(point.at);
        bounds=bounds.Grow(.56f);bounds.Size+=Vector3.Up*1.65f;
        var cells=new Dictionary<(int,int),List<int>>();
        for(int i=0;i+1<points.Count;i++)
        {
            var a=points[i].at;var b=points[i+1].at;
            for(int x=(int)MathF.Floor((Math.Min(a.X,b.X)-.65f)/2);x<=(int)MathF.Floor((Math.Max(a.X,b.X)+.65f)/2);x++)
                for(int z=(int)MathF.Floor((Math.Min(a.Z,b.Z)-.65f)/2);z<=(int)MathF.Floor((Math.Max(a.Z,b.Z)+.65f)/2);z++)
                {if(!cells.TryGetValue((x,z),out var list))cells[(x,z)]=list=new();list.Add(i);}
        }
        var memo=new Dictionary<Vector3,(Vector2 at,float end)>();
        (Vector2 at,float end) Local(Vector3 p)
        {
            if(memo.TryGetValue(p,out var found))return found;
            if(!cells.TryGetValue(((int)MathF.Floor(p.X/2),(int)MathF.Floor(p.Z/2)),out var candidates))return(new Vector2(100,100),-100);
            float best=float.MaxValue,endIn=100;Vector2 q=default;var xy=new Vector2(p.X,p.Z);
            foreach(int i in candidates)
            {
                var a=points[i].at;var b=points[i+1].at;var ab=new Vector2(b.X-a.X,b.Z-a.Z);
                float t=Math.Clamp((xy-new Vector2(a.X,a.Z)).Dot(ab)/Math.Max(ab.LengthSquared(),1e-8f),0,1);
                var at=a.Lerp(b,t);float distance=new Vector2(p.X-at.X,p.Z-at.Z).LengthSquared();if(distance>=best)continue;
                best=distance;var across=Vector3.Up.Cross((b-a).Normalized()).Normalized();q=new Vector2((p-at).Dot(across),p.Y-at.Y);
                var tangent=new Vector2(b.X-a.X,b.Z-a.Z).Normalized();
                endIn=i==0&&(xy-new Vector2(a.X,a.Z)).Dot(tangent)<0?(xy-new Vector2(a.X,a.Z)).Dot(tangent)
                    :i==points.Count-2&&(xy-new Vector2(b.X,b.Z)).Dot(tangent)>0?-(xy-new Vector2(b.X,b.Z)).Dot(tangent):100;
            }
            memo[p]=(q,endIn);return(q,endIn);
        }
        var planes=new List<Func<Vector3,float>>{p=>Local(p).end+margin,p=>.501f+margin-MathF.Abs(Local(p).at.X),
            p=>Local(p).at.Y+margin,p=>1.601f+margin-Local(p).at.Y};
        for(int i=0;i<profile.Length;i++)
        {
            var a=profile[i];var delta=profile[(i+1)%profile.Length]-a;if(delta.LengthSquared()<1e-10f)continue;
            var n=new Vector2(-delta.Y,delta.X).Normalized();if(n.Dot(new Vector2(0,.8f)-a)<0)n=-n;
            var normal=n;var origin=a;planes.Add(p=>normal.Dot(Local(p).at-origin)+margin);
        }
        var first=points[0].at;var last=points[^1].at;var forward=(points[1].at-first).Normalized();var backward=(last-points[^2].at).Normalized();
        planes.Add(p=>(p-first).Dot(forward)+.02f);planes.Add(p=>(last-p).Dot(backward)+.02f);
        return new(bounds,planes);
    }
    private static QuayNotch.Region Socket(Inlet inlet)
    {
        var path=InletPath(inlet);var centre=inlet.To;var top=path[^2];var axis=(centre-top).Normalized();
        var x=axis.Cross(MathF.Abs(axis.Y)>.9f?Vector3.Right:Vector3.Up).Normalized();var y=axis.Cross(x).Normalized();
        float radius=Math.Max(.01f,inlet.Diameter/2-.008f);
        var planes=new List<Func<Vector3,float>>{p=>(p-top).Dot(axis)+.05f,p=>(centre-p).Dot(axis)+.08f};
        for(int i=0;i<24;i++)
        {
            float angle=i*Mathf.Tau/24;var n=new Vector2(MathF.Cos(angle),MathF.Sin(angle));
            planes.Add(p=>radius-(p-centre).Dot(x*n.X+y*n.Y));
        }
        return new(new Aabb(centre,Vector3.Zero).Expand(top).Grow(radius+.08f),planes);
    }
    private static Dictionary<string,List<QuayNotch.Region>> JunctionCuts(Network net)
    {
        var cuts=net.Collectors.ToDictionary(c=>c.Id,_=>new List<QuayNotch.Region>());var byId=net.Collectors.ToDictionary(c=>c.Id);
        var profile=net.Templates.Values.First().Profile;
        var collectors=net.Collectors.OrderBy(c=>c.Id,StringComparer.Ordinal).ToArray();
        var bounds=collectors.Select(c=>
        {
            var box=new Aabb(c.At(0),Vector3.Zero);foreach(float u in c.Along)box=box.Expand(c.At(u));
            box=box.Grow(.51f);box.Size+=Vector3.Up*1.6f;return box;
        }).ToArray();
        for(int i=0;i<collectors.Length;i++)for(int j=i+1;j<collectors.Length;j++)
        {
            if(!bounds[i].Intersects(bounds[j]))continue;
            var a=collectors[i];var b=collectors[j];
            // Stable ownership keeps coincident shared runs closed: the owner
            // loses only genuinely interior faces; the other loses the seam too.
            bool aOwns=b.DestinationKind=="collector"&&b.Destination==a.Id || !(a.DestinationKind=="collector"&&a.Destination==b.Id);
            cuts[a.Id].Add(Bore(b,b.Length/2,profile,b.Length+1,aOwns?-.004f:.004f));
            cuts[b.Id].Add(Bore(a,a.Length/2,profile,a.Length+1,aOwns?.004f:-.004f));
        }
        foreach(var inlet in net.Inlets)
        {
            var socket=Socket(inlet);
            for(int i=0;i<collectors.Length;i++)if(bounds[i].Intersects(socket.Box))cuts[collectors[i].Id].Add(socket);
        }
        return cuts;
    }
    private static ArrayMesh CutPipe(ArrayMesh original,IReadOnlyList<QuayNotch.Region> cuts)
    {
        if(cuts.Count==0)return original;
        var mesh=new ArrayMesh{ResourceName=original.ResourceName};
        for(int surface=0;surface<original.GetSurfaceCount();surface++)
        {
            using var arrays=original.SurfaceGetArrays(surface);
            QuayNotch.CutSurfaceRegions(arrays,Transform3D.Identity,cuts);
            if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0)continue;
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);mesh.SurfaceSetName(mesh.GetSurfaceCount()-1,original.SurfaceGetName(surface));
        }
        return mesh;
    }
    private static ArrayMesh CollectorCap(Collector c,Vector2[] profile)
    {
        var g=new Geometry();var centre=c.At(0);var along=c.Tangent(0);var lateral=Vector3.Up.Cross(along).Normalized();
        var mid=centre+Vector3.Up*.8f+along*.006f;
        g.Vertex(mid,along,new Vector2(0,.8f)/new Vector2(4.8f,2.4f),new Color(.6f,.03f,.55f,.1f));
        for(int i=0;i<profile.Length;i++)
        {
            var q=profile[i];var normal=ProfileNormal(profile,i);var inside=q+normal*.006f;
            var at=centre+lateral*inside.X+Vector3.Up*inside.Y+along*.006f;
            g.Vertex(at,along,inside/new Vector2(4.8f,2.4f),new Color(.6f,.03f,.55f,.1f));
        }
        for(int i=0;i<profile.Length;i++)g.Triangle(0,i+1,(i+1)%profile.Length+1,along);
        int start=g.P.Count;
        for(int i=0;i<profile.Length;i++)
        {
            var q=profile[i];var n=ProfileNormal(profile,i);var want=(lateral*n.X+Vector3.Up*n.Y+along).Normalized();
            g.Vertex(centre+lateral*q.X+Vector3.Up*q.Y,want,q/new Vector2(4.8f,2.4f),new Color(.6f,.03f,.6f,.1f));
        }
        for(int i=0;i<profile.Length;i++)
        {
            int j=(i+1)%profile.Length;var want=g.N[start+i];g.Triangle(start+i,start+j,j+1,want);g.Triangle(start+i,j+1,i+1,want);
        }
        using var arrays=g.Arrays();var mesh=new ArrayMesh{ResourceName=c.Id+"_upstream_cap"};mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);mesh.SurfaceSetName(0,"ruien_brick_stretcher");return mesh;
    }
}
