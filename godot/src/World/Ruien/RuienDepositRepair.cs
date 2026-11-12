using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Offline intake: seat the perimeter of mineral crusts in their displaced masonry host.</summary>
public static class RuienDepositRepair
{
    private readonly record struct Triangle(Vector3 A,Vector3 B,Vector3 C,Vector3 Normal);
    private const float Cell=.4f,Reach=.48f;
    private static (int,int,int) Grid(Vector3 p)=>((int)MathF.Floor(p.X/Cell),(int)MathF.Floor(p.Y/Cell),(int)MathF.Floor(p.Z/Cell));
    private static (int,int,int) Weld(Vector3 p)=>((int)MathF.Round(p.X*10000),(int)MathF.Round(p.Y*10000),(int)MathF.Round(p.Z*10000));

    public static void Apply(IEnumerable<RuienGlb.Obj> objects)
    {
        var primitives=objects.SelectMany(o=>o.Prims).ToArray();
        var deposits=primitives.Where(p=>p.Material=="ruien_calcite").ToArray();
        if(deposits.Length==0)return;
        // The study's lime halo was baked as nearly white rectangular rib
        // panels. Keep its seep locations and mottling, but let the masonry's
        // own colour show through the thinner mineral wash.
        foreach(var part in primitives.Where(p=>p.Material.StartsWith("ruien_brick")||p.Material is "ruien_bluestone" or "ruien_sandstone"))
        {
            if(part.Col==null)continue;
            var dry=part.Material=="ruien_bluestone"?new Color(.035f,.043f,.05f):part.Material=="ruien_sandstone"?new Color(.18f,.14f,.09f):new Color(.075f,.032f,.02f);
            for(int i=0;i<part.Col.Length;i++)
            {
                var weather=part.Col[i];float lime=weather.G;
                weather.G*=.30f;part.Col[i]=weather;
                if(part.Bake==null||lime<.08f)continue;
                var baked=part.Bake[i];float bright=(baked.R+baked.G+baked.B)/3;
                float pale=Mathf.SmoothStep(.045f,.18f,bright)*Mathf.SmoothStep(.08f,.55f,lime);
                var mixed=baked.Lerp(new Color(dry.R+baked.R*.2f,dry.G+baked.G*.2f,dry.B+baked.B*.2f,baked.A),pale*.65f);
                part.Bake[i]=mixed;
            }
        }
        // Chunk and material boundaries are storage boundaries. Weld the full
        // file first so neither becomes a false exposed edge of a deposit.
        var lookup=new Dictionary<(int,int,int),int>();var points=new List<Vector3>();
        var maps=new Dictionary<RuienGlb.Prim,int[]>();
        foreach(var part in deposits)
        {
            var ids=new int[part.Pos.Length];maps[part]=ids;
            for(int i=0;i<ids.Length;i++)
            {
                var key=Weld(part.Pos[i]);
                if(!lookup.TryGetValue(key,out int id)){id=points.Count;lookup[key]=id;points.Add(part.Pos[i]);}
                ids[i]=id;
            }
        }
        // Displaced calcite has steep flute normals. Project along the smooth
        // sheet normal instead, otherwise neighbouring vertices move sideways
        // in different directions and turn a curved curtain into a crumpled sheet.
        var sheetNormals=new Vector3[points.Count];var pointCells=new Dictionary<(int,int,int),List<int>>();
        foreach(var part in deposits)if(part.Nrm!=null)
            for(int i=0;i<part.Pos.Length;i++)sheetNormals[maps[part][i]]+=part.Nrm[i];
        for(int i=0;i<points.Count;i++)
        {
            sheetNormals[i]=sheetNormals[i].Normalized();var cell=Grid(points[i]);
            if(!pointCells.TryGetValue(cell,out var ids))pointCells[cell]=ids=new();ids.Add(i);
        }
        Vector3 SheetNormal(int id)
        {
            var p=points[id];var original=sheetNormals[id];var sum=Vector3.Zero;
            var lo=Grid(p-Vector3.One*.3f);var hi=Grid(p+Vector3.One*.3f);
            for(int x=lo.Item1;x<=hi.Item1;x++)for(int y=lo.Item2;y<=hi.Item2;y++)for(int z=lo.Item3;z<=hi.Item3;z++)
                if(pointCells.TryGetValue((x,y,z),out var ids))foreach(int other in ids)
                {
                    float distance=p.DistanceSquaredTo(points[other]);
                    if(distance>=.09f||original.Dot(sheetNormals[other])<.5f)continue;
                    sum+=sheetNormals[other]*(1-distance/.09f);
                }
            return sum.LengthSquared()>1e-8f?sum.Normalized():original;
        }
        var edgeCounts=new Dictionary<(int a,int b),int>();
        foreach(var part in deposits)
        {
            var map=maps[part];
            for(int t=0;t<part.Idx.Length;t+=3)for(int k=0;k<3;k++)
            {
                int a=map[part.Idx[t+k]],b=map[part.Idx[t+(k+1)%3]];if(a==b)continue;
                var edge=a<b?(a,b):(b,a);edgeCounts[edge]=edgeCounts.GetValueOrDefault(edge)+1;
            }
        }
        var neighbors=Enumerable.Range(0,points.Count).Select(_=>new List<(int,float)>()).ToArray();
        var distance=Enumerable.Repeat(float.PositiveInfinity,points.Count).ToArray();
        var pending=new PriorityQueue<int,float>();
        foreach(var (edge,count) in edgeCounts)
        {
            float length=points[edge.a].DistanceTo(points[edge.b]);
            neighbors[edge.a].Add((edge.b,length));neighbors[edge.b].Add((edge.a,length));
            if(count!=1)continue;
            foreach(int id in new[]{edge.a,edge.b})if(distance[id]>0){distance[id]=0;pending.Enqueue(id,0);}
        }
        while(pending.TryDequeue(out int currentPoint,out float d))
        {
            if(d>distance[currentPoint]||d>Reach)continue;
            foreach(var (next,length) in neighbors[currentPoint])
            {
                float candidate=d+length;if(candidate>=distance[next]||candidate>Reach)continue;
                distance[next]=candidate;pending.Enqueue(next,candidate);
            }
        }
        if(!distance.Any(d=>d<=Reach))return;
        var hosts=new List<Triangle>();var cells=new Dictionary<(int,int,int),List<int>>();
        foreach(var part in primitives.Where(p=>p.Material.StartsWith("ruien_brick")||p.Material is "ruien_bluestone" or "ruien_sandstone"))
            for(int t=0;t<part.Idx.Length;t+=3)
            {
                var a=part.Pos[part.Idx[t]];var b=part.Pos[part.Idx[t+1]];var c=part.Pos[part.Idx[t+2]];
                var n=(b-a).Cross(c-a);if(n.LengthSquared()<1e-14f)continue;n=n.Normalized();
                if(part.Nrm!=null&&n.Dot(part.Nrm[part.Idx[t]])<0)n=-n;
                var lo=Grid(a.Min(b).Min(c));var hi=Grid(a.Max(b).Max(c));int number=hosts.Count;hosts.Add(new(a,b,c,n));
                for(int x=lo.Item1;x<=hi.Item1;x++)for(int y=lo.Item2;y<=hi.Item2;y++)for(int z=lo.Item3;z<=hi.Item3;z++)
                {
                    var key=(x,y,z);if(!cells.TryGetValue(key,out var list))cells[key]=list=new();list.Add(number);
                }
            }
        // Resolve every point, including the interior: a curtain must not span
        // the air of a shaft or stand proud of displaced brick like a plaque.
        var attached=new Dictionary<int,(Vector3 host,Vector3 normal,float height)>();
        var visited=new HashSet<int>();int moved=0,unseated=0;float maximum=0;
        foreach(var part in deposits)
        {
            var map=maps[part];
            for(int i=0;i<part.Pos.Length;i++)
            {
                int id=map[i];if(part.Nrm==null||!visited.Add(id))continue;
                {
                    var p=part.Pos[i];var n=SheetNormal(id);var origin=p+n*.35f;var direction=-n;
                    var lo=Grid(p-Vector3.One*.36f);var hi=Grid(p+Vector3.One*.36f);
                    var candidates=new HashSet<int>();
                    for(int x=lo.Item1;x<=hi.Item1;x++)for(int y=lo.Item2;y<=hi.Item2;y++)for(int z=lo.Item3;z<=hi.Item3;z++)
                        if(cells.TryGetValue((x,y,z),out var list))candidates.UnionWith(list);
                    float best=float.PositiveInfinity,hit=0;
                    foreach(int t in candidates.Order())
                    {
                        var face=hosts[t];if(n.Dot(face.Normal)<.25f)continue;
                        if(Ray(face,origin,direction) is not {} at||at<0||at>.7f)continue;
                        float offset=MathF.Abs(at-.35f);if(offset>=best)continue;best=offset;hit=at;
                    }
                    if(float.IsFinite(best))
                    {
                        var host=origin+direction*hit;
                        attached[id]=(host,n,(p-host).Dot(n));
                    }
                    else unseated++;
                }
            }
        }
        // End deposits on real masonry, then taper these new edges as well as
        // the original outline. Keep the mesh keys and the authored positions.
        edgeCounts.Clear();
        foreach(var part in deposits)
        {
            var map=maps[part];var kept=new List<int>();
            for(int t=0;t<part.Idx.Length;t+=3)
            {
                if(!Enumerable.Range(0,3).All(k=>attached.ContainsKey(map[part.Idx[t+k]])))continue;
                for(int k=0;k<3;k++)
                {
                    kept.Add(part.Idx[t+k]);int a=map[part.Idx[t+k]],b=map[part.Idx[t+(k+1)%3]];
                    if(a==b)continue;var edge=a<b?(a,b):(b,a);edgeCounts[edge]=edgeCounts.GetValueOrDefault(edge)+1;
                }
            }
            part.Idx=kept.ToArray();
        }
        foreach(var(edge,count)in edgeCounts)
            if(count==1)foreach(int id in new[]{edge.a,edge.b})if(distance[id]>0){distance[id]=0;pending.Enqueue(id,0);}
        while(pending.TryDequeue(out int current,out float d))
        {
            if(d>distance[current]||d>Reach)continue;
            foreach(var(next,length)in neighbors[current])
            {
                float candidate=d+length;if(candidate>=distance[next]||candidate>Reach)continue;
                distance[next]=candidate;pending.Enqueue(next,candidate);
            }
        }
        var result=new Dictionary<int,Vector3>();
        foreach(var part in deposits)
        {
            var map=maps[part];
            for(int i=0;i<part.Pos.Length;i++)
            {
                int id=map[i];if(!attached.TryGetValue(id,out var support))continue;
                if(!result.TryGetValue(id,out var repaired))
                {
                    var p=points[id];float feather=.18f+.30f*RuienSurfaceRepair.Noise(p*5.7f);
                    float blend=Mathf.SmoothStep(.025f,feather,distance[id]);
                    float maximumHeight=.06f+.30f*Mathf.SmoothStep(.45f,.85f,MathF.Abs(support.normal.Y));
                    float height=Math.Clamp(support.height,-.008f,maximumHeight);
                    repaired=support.host+support.normal*Mathf.Lerp(-.008f,height,blend);
                    maximum=Math.Max(maximum,repaired.DistanceTo(p));moved++;result[id]=repaired;
                }
                part.Pos[i]=repaired;
            }
        }
        var normals=new Vector3[points.Count];
        foreach(var part in deposits)
        {
            if(part.Nrm==null)continue;var map=maps[part];
            for(int t=0;t<part.Idx.Length;t+=3)
            {
                int a=part.Idx[t],b=part.Idx[t+1],c=part.Idx[t+2];
                var n=(part.Pos[b]-part.Pos[a]).Cross(part.Pos[c]-part.Pos[a]);
                if(n.Dot(part.Nrm[a]+part.Nrm[b]+part.Nrm[c])<0)n=-n;
                normals[map[a]]+=n;normals[map[b]]+=n;normals[map[c]]+=n;
            }
        }
        foreach(var part in deposits)if(part.Nrm!=null)
            for(int i=0;i<part.Pos.Length;i++){var n=normals[maps[part][i]];if(n.LengthSquared()>1e-12f)part.Nrm[i]=n.Normalized();}
        GD.Print($"ruien deposit edges: {moved} seated, {unseated} without nearby host, maximum adjustment {maximum:F4} m");
    }

    private static float? Ray(Triangle triangle,Vector3 origin,Vector3 direction)
    {
        var e1=triangle.B-triangle.A;var e2=triangle.C-triangle.A;var p=direction.Cross(e2);
        float determinant=e1.Dot(p);if(MathF.Abs(determinant)<1e-10f)return null;
        float inverse=1/determinant;var s=origin-triangle.A;float u=s.Dot(p)*inverse;if(u<-.0001f||u>1.0001f)return null;
        var q=s.Cross(e1);float v=direction.Dot(q)*inverse;if(v<-.0001f||u+v>1.0001f)return null;
        return e2.Dot(q)*inverse;
    }
}
