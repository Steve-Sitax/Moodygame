using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World;

public static partial class QuayNotch
{
    private static Channel ReadChannel(int index,Variant value,int count)
    {
        var c=new Channel{Index=index,Kind=value.VariantType};
        c.Data=value.VariantType switch
        {
            Variant.Type.PackedByteArray=>value.AsByteArray().Select(x=>(float)x).ToArray(),
            Variant.Type.PackedVector3Array=>Flatten(value.AsVector3Array()),
            Variant.Type.PackedVector2Array=>Flatten(value.AsVector2Array()),
            Variant.Type.PackedColorArray=>Flatten(value.AsColorArray()),
            Variant.Type.PackedFloat32Array=>value.AsFloat32Array(),
            _=>throw new NotSupportedException("Cut channel "+value.VariantType)
        };
        c.Stride=c.Data.Length/count;return c;
    }
    private static void WriteChannel(Godot.Collections.Array arrays,Channel channel,float[] values)
    {
        switch(channel.Kind)
        {
            case Variant.Type.PackedByteArray:arrays[channel.Index]=values.Select(v=>(byte)Math.Clamp(MathF.Round(v),0,255)).ToArray();break;
            case Variant.Type.PackedVector3Array:
                var p=new Vector3[values.Length/3];for(int i=0;i<p.Length;i++)p[i]=new(values[i*3],values[i*3+1],values[i*3+2]);arrays[channel.Index]=p;break;
            case Variant.Type.PackedVector2Array:
                var uv=new Vector2[values.Length/2];for(int i=0;i<uv.Length;i++)uv[i]=new(values[i*2],values[i*2+1]);arrays[channel.Index]=uv;break;
            case Variant.Type.PackedColorArray:
                var colours=new Color[values.Length/4];for(int i=0;i<colours.Length;i++)colours[i]=new(values[i*4],values[i*4+1],values[i*4+2],values[i*4+3]);arrays[channel.Index]=colours;break;
            default:arrays[channel.Index]=values;break;
        }
    }
    /// <summary>Run the same ordered cuts on nearby original triangles only. Keep
    /// original vertex/index order and every channel's per-cut rounding exactly.</summary>
    public static int CutSurfaceRegions(Godot.Collections.Array arrays,Transform3D xf,IReadOnlyList<Region> regions)
    {
        if(regions.Count==0)return 0;
        var positions=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();if(positions.Length==0)return 0;
        var value=arrays[(int)Mesh.ArrayType.Index];var index=value.VariantType==Variant.Type.Nil?Enumerable.Range(0,positions.Length).ToArray():value.AsInt32Array();
        var world=positions.Select(p=>xf*p).ToArray();var picked=new bool[index.Length/3];var triangles=new List<int>();var vertices=new SortedSet<int>();
        for(int t=0;t+2<index.Length;t+=3)
        {
            var box=new Aabb(world[index[t]],Vector3.Zero).Expand(world[index[t+1]]).Expand(world[index[t+2]]);
            if(!regions.Any(r=>r.Box.Intersects(box)))continue;
            picked[t/3]=true;triangles.Add(t/3);for(int k=0;k<3;k++)vertices.Add(index[t+k]);
        }
        if(triangles.Count==0)return 0;
        var old=vertices.ToArray();var map=new Dictionary<int,int>();for(int i=0;i<old.Length;i++)map[old[i]]=i;
        var channels=new List<Channel>();using var local=new Godot.Collections.Array();local.Resize((int)Mesh.ArrayType.Max);
        for(int k=0;k<(int)Mesh.ArrayType.Index;k++)
        {
            var v=arrays[k];if(v.VariantType==Variant.Type.Nil)continue;
            var c=ReadChannel(k,v,positions.Length);channels.Add(c);var subset=new float[old.Length*c.Stride];
            for(int i=0;i<old.Length;i++)Array.Copy(c.Data,old[i]*c.Stride,subset,i*c.Stride,c.Stride);
            WriteChannel(local,c,subset);
        }
        var originalLocal=new Dictionary<(int,int,int),Queue<int>>();var initial=new List<int>();
        foreach(int triangle in triangles)
        {
            var key=(map[index[triangle*3]],map[index[triangle*3+1]],map[index[triangle*3+2]]);
            if(!originalLocal.TryGetValue(key,out var ids))originalLocal[key]=ids=new();ids.Enqueue(triangle);
            initial.Add(key.Item1);initial.Add(key.Item2);initial.Add(key.Item3);
        }
        local[(int)Mesh.ArrayType.Index]=initial.ToArray();int changed=0;
        foreach(var region in regions)
        {
            bool Near((Vector3 a,Vector3 b,Vector3 c)t)=>new Aabb(t.a,Vector3.Zero).Expand(t.b).Expand(t.c).Intersects(region.Box);
            changed+=CutSurfaceWith(local,xf,Near,region.Inside);
        }
        if(changed==0)return 0;
        var final=local[(int)Mesh.ArrayType.Index].AsInt32Array();var fresh=new List<int>();
        int Remap(int i)=>i<old.Length?old[i]:positions.Length+i-old.Length;
        for(int t=0;t+2<final.Length;t+=3)
        {
            int a=final[t],b=final[t+1],c=final[t+2];
            if(a<old.Length&&b<old.Length&&c<old.Length)
            {picked[originalLocal[(a,b,c)].Dequeue()]=false;continue;}
            fresh.Add(Remap(a));fresh.Add(Remap(b));fresh.Add(Remap(c));
        }
        var result=new List<int>(index.Length+fresh.Count);
        for(int t=0;t+2<index.Length;t+=3)if(!picked[t/3]){result.Add(index[t]);result.Add(index[t+1]);result.Add(index[t+2]);}
        result.AddRange(fresh);
        int localCount=local[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length;
        foreach(var c in channels)
        {
            var converted=ReadChannel(c.Index,local[c.Index],localCount);
            WriteChannel(arrays,c,c.Data.Concat(converted.Data.Skip(old.Length*c.Stride)).ToArray());
        }
        arrays[(int)Mesh.ArrayType.Index]=result.ToArray();return changed;
    }
}
