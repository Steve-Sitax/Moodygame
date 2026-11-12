using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World;

public static partial class QuayNotch
{
    public sealed record DeformRegion(Aabb Box,List<Func<Vector3,float>> Grid,Func<Vector3,Vector3> Map);

    /// <summary>Subdivide only the affected terrain on shared planes, then deform
    /// its positions and tangent frame. UV, colour and custom channels interpolate
    /// with the original triangles; unselected triangles retain their exact arrays.</summary>
    public static int DeformSurface(Godot.Collections.Array arrays,Transform3D xf,IReadOnlyList<DeformRegion> regions)
    {
        var positions=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        if(positions.Length==0)return 0;
        var value=arrays[(int)Mesh.ArrayType.Index];
        var indices=value.VariantType==Variant.Type.Nil?Enumerable.Range(0,positions.Length).ToArray():value.AsInt32Array();
        var world=positions.Select(p=>xf*p).ToArray();
        var selected=new List<DeformRegion>?[indices.Length/3];int count=0;
        for(int t=0;t+2<indices.Length;t+=3)
        {
            var a=world[indices[t]];var b=world[indices[t+1]];var c=world[indices[t+2]];
            var bounds=new Aabb(a,Vector3.Zero).Expand(b).Expand(c).Grow(.0001f);
            var near=regions.Where(r=>r.Box.Intersects(bounds)).ToList();
            if(near.Count==0)continue;
            selected[t/3]=near;count++;
        }
        if(count==0)return 0;
        var channels=new List<Channel>();var offsets=new Dictionary<int,int>();int stride=0;
        for(int k=0;k<(int)Mesh.ArrayType.Index;k++)
        {
            if(arrays[k].VariantType==Variant.Type.Nil)continue;
            var channel=ReadChannel(k,arrays[k],positions.Length);channels.Add(channel);offsets[k]=stride;stride+=channel.Stride;
        }
        float[] Row(int vertex)
        {
            var row=new float[stride];int at=0;
            foreach(var c in channels){Array.Copy(c.Data,vertex*c.Stride,row,at,c.Stride);at+=c.Stride;}
            return row;
        }
        Vector3 W(float[] row)=>xf*new Vector3(row[0],row[1],row[2]);
        var inverse=xf.AffineInverse();var normalToWorld=xf.Basis.Inverse().Transposed();
        var kept=new List<int>();var made=new List<float[]>();
        for(int t=0;t+2<indices.Length;t+=3)
        {
            if(selected[t/3] is not {} near)
            {kept.Add(indices[t]);kept.Add(indices[t+1]);kept.Add(indices[t+2]);continue;}
            var polygons=new List<List<float[]>>{new(){Row(indices[t]),Row(indices[t+1]),Row(indices[t+2])}};
            foreach(var region in near)foreach(var plane in region.Grid)
            {
                var split=new List<List<float[]>>();
                foreach(var polygon in polygons)
                {
                    float Key(float[] row)=>plane(W(row));
                    if(polygon.Min(Key)<-.00001f&&polygon.Max(Key)>.00001f)
                    {split.Add(Clip(polygon,Key,0,true));split.Add(Clip(polygon,Key,0,false));}
                    else split.Add(polygon);
                }
                polygons=split;
            }
            Vector3 Map(Vector3 p){foreach(var region in near)p=region.Map(p);return p;}
            foreach(var sourcePolygon in polygons)
            {
                var polygon=sourcePolygon.Select(row=>(float[])row.Clone()).ToList();
                foreach(var row in polygon)
                {
                    var original=W(row);var moved=Map(original);
                    if(offsets.TryGetValue((int)Mesh.ArrayType.Normal,out int normalAt))
                    {
                        var n=(normalToWorld*new Vector3(row[normalAt],row[normalAt+1],row[normalAt+2])).Normalized();
                        var u=n.Cross(MathF.Abs(n.Z)<.9f?Vector3.Back:Vector3.Up).Normalized()*.01f;
                        var v=n.Cross(u).Normalized()*.01f;
                        var normal=(Map(original+u)-Map(original-u)).Cross(Map(original+v)-Map(original-v)).Normalized();
                        normal=(xf.Basis.Transposed()*normal).Normalized();
                        row[normalAt]=normal.X;row[normalAt+1]=normal.Y;row[normalAt+2]=normal.Z;
                        if(offsets.TryGetValue((int)Mesh.ArrayType.Tangent,out int tangentAt))
                        {
                            var tangent=new Vector3(row[tangentAt],row[tangentAt+1],row[tangentAt+2]);
                            tangent=(tangent-normal*tangent.Dot(normal)).Normalized();
                            row[tangentAt]=tangent.X;row[tangentAt+1]=tangent.Y;row[tangentAt+2]=tangent.Z;
                        }
                    }
                    var local=inverse*moved;row[0]=local.X;row[1]=local.Y;row[2]=local.Z;
                }
                for(int i=1;i+1<polygon.Count;i++)
                {
                    if(Area(polygon[0],polygon[i],polygon[i+1])<1e-9f)continue;
                    foreach(var row in new[]{polygon[0],polygon[i],polygon[i+1]}){kept.Add(positions.Length+made.Count);made.Add(row);}
                }
            }
        }
        foreach(var row in made)
        {
            int at=0;foreach(var c in channels){for(int i=0;i<c.Stride;i++)c.Added.Add(row[at+i]);at+=c.Stride;}
        }
        // Do not leave abandoned high-bank vertices: the native silt pass groups
        // every vertex into wall runs, including vertices no triangle references.
        var old=kept.Where(i=>i<positions.Length).Distinct().OrderBy(i=>i).ToArray();
        var remap=new Dictionary<int,int>();for(int i=0;i<old.Length;i++)remap[old[i]]=i;
        foreach(var c in channels)
        {
            var values=new float[(old.Length+made.Count)*c.Stride];
            for(int i=0;i<old.Length;i++)Array.Copy(c.Data,old[i]*c.Stride,values,i*c.Stride,c.Stride);
            c.Added.CopyTo(values,old.Length*c.Stride);WriteChannel(arrays,c,values);
        }
        arrays[(int)Mesh.ArrayType.Index]=kept.Select(i=>i<positions.Length?remap[i]:old.Length+i-positions.Length).ToArray();return count;
    }
}
