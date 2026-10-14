using Godot;
using System;
using System.Collections.Generic;
using System.Linq;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Immutable triangle index. Whole mesh bounds would falsely fill courtyards and door openings.</summary>
internal sealed class AntigoonGeometry
{
    private sealed record Triangle(Vector3 A,Vector3 B,Vector3 C,Aabb Bounds);
    private readonly Dictionary<(int,int),List<Triangle>> cells=new();
    public AntigoonGeometry(Node world)
    {
        var triangles = Solid.I is { } solid ? solid.WorldTriangles() : Solid.CaptureWorldTriangles(world);
        foreach(var (a,b,c) in triangles)Add(a,b,c);
        foreach(var shape in world.FindChildren("*","CollisionShape3D",true,false).OfType<CollisionShape3D>())
        {
            if(shape.Disabled||shape.Shape==null||!shape.IsVisibleInTree()||shape.GetParent() is not CollisionObject3D body||(body.CollisionLayer&Solid.Layer)==0)continue;
            var faces=shape.Shape is ConcavePolygonShape3D concave?concave.GetFaces():shape.Shape.GetDebugMesh().GetFaces();
            for(int i=0;i+2<faces.Length;i+=3)Add(shape.GlobalTransform*faces[i],shape.GlobalTransform*faces[i+1],shape.GlobalTransform*faces[i+2]);
        }
    }
    private void Add(Vector3 a,Vector3 b,Vector3 c)
    {
        var min=a.Min(b).Min(c);var max=a.Max(b).Max(c);
        if(max.Y<.36f||min.Y>18||(b-a).Cross(c-a).LengthSquared()<1e-12)return;
        var tri=new Triangle(a,b,c,new(min,max-min));
        for(int x=(int)Math.Floor(min.X/8);x<=(int)Math.Floor(max.X/8);x++)
        for(int z=(int)Math.Floor(min.Z/8);z<=(int)Math.Floor(max.Z/8);z++)
        {if(!cells.TryGetValue((x,z),out var list))cells[(x,z)]=list=new();list.Add(tri);}
    }
    public bool Clear(Vector3 feet,float radius,float height)
    {
        Span<Vector3> a=stackalloc Vector3[8],b=stackalloc Vector3[8];
        for(int x=(int)Math.Floor((feet.X-radius)/8);x<=(int)Math.Floor((feet.X+radius)/8);x++)
        for(int z=(int)Math.Floor((feet.Z-radius)/8);z<=(int)Math.Floor((feet.Z+radius)/8);z++)
        if(cells.TryGetValue((x,z),out var list))foreach(var t in list)
        {
            var box=t.Bounds;
            if(box.End.Y<=feet.Y+.36f||box.Position.Y>=feet.Y+height||feet.X+radius<box.Position.X||feet.X-radius>box.End.X||feet.Z+radius<box.Position.Z||feet.Z-radius>box.End.Z)continue;
            a[0]=t.A;a[1]=t.B;a[2]=t.C;
            int n=Clip(a,3,b,feet.Y+.36f,true);n=Clip(b,n,a,feet.Y+height,false);
            bool inside=false;
            for(int i=0;i<n;i++)
            {
                var u=a[i];var v=a[(i+1)%n];
                if((u.Z>feet.Z)!=(v.Z>feet.Z)&&feet.X<(v.X-u.X)*(feet.Z-u.Z)/(v.Z-u.Z)+u.X)inside=!inside;
                var edge=new Vector2(v.X-u.X,v.Z-u.Z);var point=new Vector2(feet.X-u.X,feet.Z-u.Z);
                float at=edge.LengthSquared()>0?Math.Clamp(point.Dot(edge)/edge.LengthSquared(),0,1):0;
                if((point-edge*at).LengthSquared()<radius*radius)return false;
            }
            if(inside)return false;
        }
        return true;
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
            foreach(var tri in list)
            {
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
