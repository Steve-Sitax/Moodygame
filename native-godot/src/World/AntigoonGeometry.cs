using Godot;
using System;
using System.Collections.Generic;
using System.Linq;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Immutable triangle index. Whole mesh bounds would falsely fill courtyards and door openings.</summary>
internal sealed class AntigoonGeometry
{
    // Values contain no GC references. One copy per triangle, with small integer indices in each cell,
    // instead of millions of individually allocated objects revisited by the collector.
    private readonly record struct Triangle(Vector3 A,Vector3 B,Vector3 C,Aabb Bounds);
    private const int PageBits = 16, PageSize = 1 << PageBits, PageMask = PageSize - 1;
    private readonly List<Triangle[]> triangles = new();
    private readonly Dictionary<(int,int),List<int>> cells=new();
    private int triangleCount;
#if DEBUG
    private AntigoonGeometryReference? reference;
#endif
    private ref readonly Triangle At(int index) => ref triangles[index >> PageBits][index & PageMask];
    public AntigoonGeometry(Node world)
    {
#if DEBUG
        if (Main.I.Flag("heap-proof")) reference = new();
#endif
        var sourceTriangles = Solid.I is { } solid ? solid.WorldTriangles() : Solid.CaptureWorldTriangles(world);
        foreach(var (a,b,c) in sourceTriangles)Add(a,b,c);
        foreach(var shape in world.FindChildren("*","CollisionShape3D",true,false).OfType<CollisionShape3D>())
        {
            if(shape.Disabled||shape.Shape==null||!shape.IsVisibleInTree()||shape.GetParent() is not CollisionObject3D body||(body.CollisionLayer&Solid.Layer)==0)continue;
            var faces=shape.Shape is ConcavePolygonShape3D concave?concave.GetFaces():shape.Shape.GetDebugMesh().GetFaces();
            for(int i=0;i+2<faces.Length;i+=3)Add(shape.GlobalTransform*faces[i],shape.GlobalTransform*faces[i+1],shape.GlobalTransform*faces[i+2]);
        }
        foreach (var cell in cells.Values) cell.TrimExcess();
        if (triangleCount % PageSize != 0)
            triangles[^1] = triangles[^1].AsSpan(0, triangleCount % PageSize).ToArray();
#if DEBUG
        if (reference != null)
        {
            ProveStorage(reference);
            reference = null;
        }
#endif
        Solid.I?.ReleaseFaceCache();
    }
    private void Add(Vector3 a,Vector3 b,Vector3 c)
    {
#if DEBUG
        reference?.Add(a,b,c);
#endif
        var min=a.Min(b).Min(c);var max=a.Max(b).Max(c);
        if(max.Y<.36f||min.Y>18||(b-a).Cross(c-a).LengthSquared()<1e-12)return;
        int index = triangleCount++;
        if ((index & PageMask) == 0) triangles.Add(new Triangle[PageSize]);
        triangles[index >> PageBits][index & PageMask] = new(a,b,c,new(min,max-min));
        for(int x=(int)Math.Floor(min.X/8);x<=(int)Math.Floor(max.X/8);x++)
        for(int z=(int)Math.Floor(min.Z/8);z<=(int)Math.Floor(max.Z/8);z++)
        {if(!cells.TryGetValue((x,z),out var list))cells[(x,z)]=list=new();list.Add(index);}
    }
#if DEBUG
    private void ProveStorage(AntigoonGeometryReference original)
    {
        if (System.Runtime.CompilerServices.RuntimeHelpers.IsReferenceOrContainsReferences<Triangle>())
            throw new InvalidOperationException("Triangle pages must not contain managed references");
        long entries = 0;
        int queries = 0;
        if (cells.Count != original.cells.Count) throw new InvalidOperationException("Triangle cell count changed");
        foreach (var (key, list) in original.cells)
        {
            if (!cells.TryGetValue(key, out var indices) || indices.Count != list.Count)
                throw new InvalidOperationException("Triangle cell membership changed");
            for (int i = 0; i < list.Count; i++)
            {
                var a = At(indices[i]); var b = list[i];
                if (a.A != b.A || a.B != b.B || a.C != b.C || a.Bounds != b.Bounds)
                    throw new InvalidOperationException("Triangle data/order changed");
                entries++;
            }
            // Include negative coordinates and the exact cell edges. A cell-local ray keeps this bounded.
            foreach (float offset in new[] { 0f, 3.999f, 8f })
            {
                var feet = new Vector3(key.Item1 * 8 + offset, 0, key.Item2 * 8 + offset);
                const float radius = .65f, height = 5.5f, step = 1.1f;
                if (Clear(feet, radius, height, step) != original.Clear(feet, radius, height, step)
                    || Blocker(feet, radius, height, step) != original.Blocker(feet, radius, height, step)
                    || Visible(feet + Vector3.Up * 1.7f, feet + new Vector3(7.99f, 3.1f, -7.99f))
                        != original.Visible(feet + Vector3.Up * 1.7f, feet + new Vector3(7.99f, 3.1f, -7.99f)))
                    throw new InvalidOperationException("Triangle query changed");
                queries += 3;
                if ((key.Item1 + key.Item2) % 17 == 0)
                foreach (var (y, smallRadius, smallHeight, smallStep) in new[] { (-2f, .3f, 1.8f, .36f), (.65f, .55f, 3.4f, .8f), (3f, .6f, 4.4f, 1.1f) })
                {
                    feet.Y = y;
                    if (Clear(feet, smallRadius, smallHeight, smallStep) != original.Clear(feet, smallRadius, smallHeight, smallStep)
                        || Blocker(feet, smallRadius, smallHeight, smallStep) != original.Blocker(feet, smallRadius, smallHeight, smallStep))
                        throw new InvalidOperationException("Triangle query at a different height changed");
                    queries += 2;
                }
            }
        }
        string output = Main.I.Arg("heap-proof-out");
        if (output.Length == 0) throw new InvalidOperationException("--heap-proof requires --heap-proof-out <file>");
        System.IO.File.WriteAllText(output, System.Text.Json.JsonSerializer.Serialize(new
        {
            ok = true, triangles = triangleCount, cells = cells.Count, entries, queries,
            storageBytes = (long)triangleCount * System.Runtime.CompilerServices.Unsafe.SizeOf<Triangle>() + cells.Values.Sum(cell => (long)cell.Capacity * sizeof(int)),
            faceCache = Solid.I?.FaceCacheProof(),
            method = "Every triangle, bound, cell and iteration position matches the original object index; Clear, Blocker and Visible agree at cell edges and centres."
        }, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"heap-proof: PASS, {entries} ordered triangle entries and {queries} queries");
    }
#endif
    /// <summary>Nothing solid between `step` and `height` over the feet within `radius`. Lower things he steps over.</summary>
    public bool Clear(Vector3 feet,float radius,float height,float step=.36f)
    {
        for(int x=(int)Math.Floor((feet.X-radius)/8);x<=(int)Math.Floor((feet.X+radius)/8);x++)
        for(int z=(int)Math.Floor((feet.Z-radius)/8);z<=(int)Math.Floor((feet.Z+radius)/8);z++)
        if(cells.TryGetValue((x,z),out var list))foreach(int index in list)if(Hits(At(index),feet,radius,height,step))return false;
        return true;
    }
    private static bool Hits(in Triangle t,Vector3 feet,float radius,float height,float step)
    {
        var box=t.Bounds;
        if(box.End.Y<=feet.Y+step||box.Position.Y>=feet.Y+height||feet.X+radius<box.Position.X||feet.X-radius>box.End.X||feet.Z+radius<box.Position.Z||feet.Z-radius>box.End.Z)return false;
        Span<Vector3> a=stackalloc Vector3[8],b=stackalloc Vector3[8];
        a[0]=t.A;a[1]=t.B;a[2]=t.C;
        int n=Clip(a,3,b,feet.Y+step,true);n=Clip(b,n,a,feet.Y+height,false);
        bool inside=false;
        for(int i=0;i<n;i++)
        {
            var u=a[i];var v=a[(i+1)%n];
            if((u.Z>feet.Z)!=(v.Z>feet.Z)&&feet.X<(v.X-u.X)*(feet.Z-u.Z)/(v.Z-u.Z)+u.X)inside=!inside;
            var edge=new Vector2(v.X-u.X,v.Z-u.Z);var point=new Vector2(feet.X-u.X,feet.Z-u.Z);
            float at=edge.LengthSquared()>0?Math.Clamp(point.Dot(edge)/edge.LengthSquared(),0,1):0;
            if((point-edge*at).LengthSquared()<radius*radius)return true;
        }
        return inside;
    }
    /// <summary>Proof aid: how many triangles block a giant standing at `feet`, and their height span over the feet.</summary>
    public string Blocker(Vector3 feet,float radius,float height,float step=.36f)
    {
        int count=0;float low=float.MaxValue,high=float.MinValue;
        for(int x=(int)Math.Floor((feet.X-radius)/8);x<=(int)Math.Floor((feet.X+radius)/8);x++)
        for(int z=(int)Math.Floor((feet.Z-radius)/8);z<=(int)Math.Floor((feet.Z+radius)/8);z++)
        if(cells.TryGetValue((x,z),out var list))foreach(int index in list){ref readonly var t=ref At(index);if(Hits(t,feet,radius,height,step)){count++;low=Math.Min(low,t.Bounds.Position.Y-feet.Y);high=Math.Max(high,t.Bounds.End.Y-feet.Y);}}
        return count==0?"clear":$"{count} triangles from {low:0.00} to {high:0.00} m over the feet";
    }
    private static int Clip(Span<Vector3> input,int n,Span<Vector3> output,float y,bool above)
    {
        int count=0;
        for(int i=0;i<n;i++)
        {
            var p=input[i];var q=input[(i+1)%n];bool pin=above?p.Y>=y:p.Y<=y,qin=above?q.Y>=y:q.Y<=y;
            if(pin)output[count++]=p;
            if(pin!=qin)output[count++]=p.Lerp(q,(y-p.Y)/(q.Y-p.Y));
        }
        return count;
    }
    public bool Visible(Vector3 from,Vector3 to)
    {
        var direction=to-from;var min=from.Min(to);var max=from.Max(to);
        for(int x=(int)Math.Floor(min.X/8);x<=(int)Math.Floor(max.X/8);x++)
        for(int z=(int)Math.Floor(min.Z/8);z<=(int)Math.Floor(max.Z/8);z++)
        {
            if(!cells.TryGetValue((x,z),out var list))continue;
            foreach(int index in list)
            {
                ref readonly var tri=ref At(index);
                var e1=tri.B-tri.A;var e2=tri.C-tri.A;var p=direction.Cross(e2);float det=e1.Dot(p);
                if(Math.Abs(det)<1e-7)continue;
                var s=from-tri.A;float u=s.Dot(p)/det;if(u<0||u>1)continue;
                var q=s.Cross(e1);float v=direction.Dot(q)/det;if(v<0||u+v>1)continue;
                float t=e2.Dot(q)/det;if(t>.001&&t<.999)return false;
            }
        }
        return true;
    }
}
