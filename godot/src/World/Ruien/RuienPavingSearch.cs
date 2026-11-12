using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Exact segment candidates for metric paving queries; source order and nearest-distance ties are preserved.</summary>
internal sealed class RuienPavingSearch
{
    private const float Cell=2;
    private const int Radius=2;
    private readonly Vector2[] points;
    private readonly int[] all;
    private readonly Dictionary<(int x,int z),List<int>> cells=new();
    private readonly Dictionary<(int x,int z),int[]> neighborhoods=new();

    internal RuienPavingSearch(Vector2[] points)
    {
        this.points=points;all=Enumerable.Range(0,Math.Max(0,points.Length-1)).ToArray();
        foreach(int i in all)
        {
            var a=points[i];var b=points[i+1];
            for(int x=Grid(Math.Min(a.X,b.X));x<=Grid(Math.Max(a.X,b.X));x++)
                for(int z=Grid(Math.Min(a.Y,b.Y));z<=Grid(Math.Max(a.Y,b.Y));z++)
                {
                    if(!cells.TryGetValue((x,z),out var list))cells[(x,z)]=list=new();
                    list.Add(i);
                }
        }
    }
    private static int Grid(float value)=>(int)MathF.Floor(value/Cell);

    internal int[] Candidates(Vector2 q)
    {
        var key=(x:Grid(q.X),z:Grid(q.Y));
        if(!neighborhoods.TryGetValue(key,out var found))
        {
            var set=new HashSet<int>();
            for(int x=key.x-Radius;x<=key.x+Radius;x++)
                for(int z=key.z-Radius;z<=key.z+Radius;z++)
                    if(cells.TryGetValue((x,z),out var list))set.UnionWith(list);
            neighborhoods[key]=found=set.Order().ToArray();
        }
        if(found.Length==0)return all;
        // No segment outside the searched cells can enter this interior radius.
        // If the nearest candidate is farther, use the full original search.
        float bound=Math.Min(Math.Min(q.X-(key.x-Radius)*Cell,(key.x+Radius+1)*Cell-q.X),
                             Math.Min(q.Y-(key.z-Radius)*Cell,(key.z+Radius+1)*Cell-q.Y));
        float nearest=float.MaxValue;
        foreach(int i in found)
        {
            var a=points[i];var ab=points[i+1]-a;float l2=ab.LengthSquared();
            float t=l2>1e-9f?Math.Clamp((q-a).Dot(ab)/l2,0,1):0;
            nearest=Math.Min(nearest,q.DistanceTo(a+ab*t));
        }
        return nearest<bound?found:all;
    }
}
