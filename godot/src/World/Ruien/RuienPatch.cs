using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>Offline mesh edits on exported Ruien surfaces: append triangles in every existing vertex channel, drop triangles.</summary>
public static class RuienPatch
{
    public sealed class Tris
    {
        public readonly List<Vector3> P=new(),N=new();public readonly List<Vector2> Uv=new();
        public readonly List<Color> C=new();public readonly List<byte[]> Bake=new();
        public void Add(Vector3 p,Vector3 n,Vector2 uv,Color c,byte r=0,byte g=0,byte b=0,byte ao=255){P.Add(p);N.Add(n);Uv.Add(uv);C.Add(c);Bake.Add(new[]{r,g,b,ao});}
        public void Tri(Vector3 a,Vector3 b,Vector3 c,Vector3 n,Color col,float ao=1)
        {
            byte o=(byte)Math.Clamp(MathF.Round(ao*255),1,255);
            // Godot's front faces wind clockwise about their normal.
            if((b-a).Cross(c-a).Dot(n)>0)(b,c)=(c,b);
            foreach(var p in new[]{a,b,c})Add(p,n,Vector2.Zero,col,0,0,0,o);
        }
        public int Count=>P.Count;
    }

    /// <summary>Append unindexed triangles (multiple of 3 corners) to a surface's arrays.</summary>
    public static void Append(Godot.Collections.Array a,Tris t)
    {
        if(t.Count==0)return;
        var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();int n0=p.Length;
        var ix=a[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,n0).ToArray():a[(int)Mesh.ArrayType.Index].AsInt32Array();
        if(ix.Length==0)ix=Enumerable.Range(0,n0).ToArray();
        a[(int)Mesh.ArrayType.Vertex]=p.Concat(t.P).ToArray();
        if(a[(int)Mesh.ArrayType.Normal].VariantType!=Variant.Type.Nil)a[(int)Mesh.ArrayType.Normal]=a[(int)Mesh.ArrayType.Normal].AsVector3Array().Concat(t.N).ToArray();
        if(a[(int)Mesh.ArrayType.Tangent].VariantType!=Variant.Type.Nil)
        {
            var tan=a[(int)Mesh.ArrayType.Tangent].AsFloat32Array().ToList();
            foreach(var n in t.N){var tt=n.Cross(MathF.Abs(n.Y)<.9f?Vector3.Up:Vector3.Right).Normalized();tan.AddRange(new[]{tt.X,tt.Y,tt.Z,1f});}
            a[(int)Mesh.ArrayType.Tangent]=tan.ToArray();
        }
        if(a[(int)Mesh.ArrayType.TexUV].VariantType!=Variant.Type.Nil)a[(int)Mesh.ArrayType.TexUV]=a[(int)Mesh.ArrayType.TexUV].AsVector2Array().Concat(t.Uv).ToArray();
        if(a[(int)Mesh.ArrayType.TexUV2].VariantType!=Variant.Type.Nil)a[(int)Mesh.ArrayType.TexUV2]=a[(int)Mesh.ArrayType.TexUV2].AsVector2Array().Concat(t.Bake.Select(b=>new Vector2(b[3]/255f,0))).ToArray();
        if(a[(int)Mesh.ArrayType.Color].VariantType!=Variant.Type.Nil)a[(int)Mesh.ArrayType.Color]=a[(int)Mesh.ArrayType.Color].AsColorArray().Concat(t.C).ToArray();
        if(a[(int)Mesh.ArrayType.Custom0].VariantType==Variant.Type.PackedByteArray)
        {
            var bytes=a[(int)Mesh.ArrayType.Custom0].AsByteArray();
            if(bytes.Length==n0*4)a[(int)Mesh.ArrayType.Custom0]=bytes.Concat(t.Bake.SelectMany(b=>b)).ToArray();
        }
        for(int k=(int)Mesh.ArrayType.Custom1;k<=(int)Mesh.ArrayType.Weights;k++)
            if(a[k].VariantType!=Variant.Type.Nil)throw new InvalidOperationException("Unsupported channel for a Ruien patch: "+(Mesh.ArrayType)k);
        a[(int)Mesh.ArrayType.Index]=ix.Concat(Enumerable.Range(n0,t.Count)).ToArray();
    }

    /// <summary>Tris as mesh arrays (for cutting with QuayNotch) and back.</summary>
    public static Godot.Collections.Array ToArrays(Tris t)
    {
        var a=new Godot.Collections.Array();a.Resize((int)Mesh.ArrayType.Max);
        a[(int)Mesh.ArrayType.Vertex]=t.P.ToArray();a[(int)Mesh.ArrayType.Normal]=t.N.ToArray();a[(int)Mesh.ArrayType.TexUV]=t.Uv.ToArray();
        a[(int)Mesh.ArrayType.Color]=t.C.ToArray();a[(int)Mesh.ArrayType.Custom0]=t.Bake.SelectMany(b=>b).ToArray();
        return a;
    }
    public static Tris FromArrays(Godot.Collections.Array a)
    {
        var t=new Tris();var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var n=a[(int)Mesh.ArrayType.Normal].AsVector3Array();
        var uv=a[(int)Mesh.ArrayType.TexUV].AsVector2Array();var c=a[(int)Mesh.ArrayType.Color].AsColorArray();var b=a[(int)Mesh.ArrayType.Custom0].AsByteArray();
        var ix=a[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,p.Length).ToArray():a[(int)Mesh.ArrayType.Index].AsInt32Array();
        foreach(int i in ix)t.Add(p[i],n[i],uv[i],c[i],b[i*4],b[i*4+1],b[i*4+2],b[i*4+3]);
        return t;
    }

    /// <summary>Remove triangles whose corners satisfy the predicate (by centroid).</summary>
    public static int Drop(Godot.Collections.Array a,Func<Vector3,bool> drop)
    {
        var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var ix=a[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,p.Length).ToArray():a[(int)Mesh.ArrayType.Index].AsInt32Array();
        if(ix.Length==0)ix=Enumerable.Range(0,p.Length).ToArray();
        var keep=new List<int>(ix.Length);int removed=0;
        for(int i=0;i<ix.Length;i+=3)
        {
            if(drop((p[ix[i]]+p[ix[i+1]]+p[ix[i+2]])/3)){removed++;continue;}
            keep.Add(ix[i]);keep.Add(ix[i+1]);keep.Add(ix[i+2]);
        }
        if(removed>0)a[(int)Mesh.ArrayType.Index]=keep.ToArray();
        return removed;
    }

    /// <summary>A bevelled box as triangles (BevelMesh), placed by a transform.</summary>
    public static void Box(Tris t,Vector3 size,float bevel,Transform3D at,Color col,float ao=1,float tile=1)
    {
        var arrays=BevelMesh.Box(size,bevel,null!).SurfaceGetArrays(0);
        var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var n=arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
        var uv=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        byte o=(byte)Math.Clamp(MathF.Round(ao*255),1,255);
        for(int i=0;i<p.Length;i++)t.Add(at*p[i],(at.Basis*n[i]).Normalized(),uv[i]/tile,col,0,0,0,o);
    }
}
