using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// Continuous brick courses for any masonry mesh (offline repair and native kit pieces): one metric chart unfolded
/// over the connected surface. Walls keep level courses; vaults, soffits and returns carry the frame across each
/// edge by rotating it about that edge, so bond and scale continue round corners, collars and arch feet instead of
/// restarting per exported object. A round shaft and its collar take concentric ring courses.
/// </summary>
public static class RuienUnfold
{
    /// <summary>A round opening: rings out to <see cref="Outer"/> metres, its rim course at <see cref="Rim"/>.</summary>
    public readonly record struct Ring(Vector2 Centre,float Radius,float Outer,float Rim,float Top);

    public static bool Bricks(string family)=>family.StartsWith("ruien_brick");

    public static bool Apply(Godot.Collections.Array arrays,string family,IReadOnlyList<Ring>? rings=null,float blur=.07f)
    {
        var families=RuienTextures.Families();
        if(!families.TryGetValue(family.StartsWith("ruien_")?family[6..]:family,out var f))return false;
        var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        if(p.Length==0)return false;
        var normals=arrays[(int)Mesh.ArrayType.Normal].VariantType==Variant.Type.Nil?null:arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
        var oldUv=arrays[(int)Mesh.ArrayType.TexUV].VariantType==Variant.Type.Nil?null:arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var ix=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Array.Empty<int>():arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        if(ix.Length==0)ix=Enumerable.Range(0,p.Length).ToArray();
        int tris=ix.Length/3;if(tris==0)return false;
        // Weld positions for adjacency only; UV seams in the source must not split the surface.
        var weld=new int[p.Length];var keys=new Dictionary<(long,long,long),int>();
        for(int i=0;i<p.Length;i++)
        {
            var k=((long)MathF.Round(p[i].X*2000),(long)MathF.Round(p[i].Y*2000),(long)MathF.Round(p[i].Z*2000));
            if(!keys.TryGetValue(k,out int id)){id=keys.Count;keys[k]=id;}
            weld[i]=id;
        }
        long nw=keys.Count;
        var fn=new Vector3[tris];var centre=new Vector3[tris];var area=new float[tris];
        for(int t=0;t<tris;t++)
        {
            var a=p[ix[t*3]];var b=p[ix[t*3+1]];var c=p[ix[t*3+2]];
            var n=(b-a).Cross(c-a);area[t]=n.Length()/2;
            n=area[t]>1e-12f?n.Normalized():Vector3.Up;
            if(normals!=null&&n.Dot(normals[ix[t*3]]+normals[ix[t*3+1]]+normals[ix[t*3+2]])<0)n=-n;
            fn[t]=n;centre[t]=(a+b+c)/3;
        }
        // Edge -> triangles (non-manifold edges keep every neighbour).
        var edgeFirst=new Dictionary<long,int>(tris*2);var next=new int[tris*3];Array.Fill(next,-1);
        long Edge(int a,int b){long x=weld[a],y=weld[b];return x<y?x*nw+y:y*nw+x;}
        for(int t=0;t<tris;t++)for(int k=0;k<3;k++)
        {
            long e=Edge(ix[t*3+k],ix[t*3+(k+1)%3]);int slot=t*3+k;
            if(edgeFirst.TryGetValue(e,out int head))next[slot]=head;
            edgeFirst[e]=slot;
        }
        var uv=new Vector2[tris*3];var frameB=new Vector3[tris];var done=new bool[tris];
        Vector3 Level(Vector3 n,Vector3 b)
        {
            // Walls and vault webs: level courses (rings in a dome, along each web of a groin), keeping the
            // carried direction's sense so nothing flips at a crown. Near-flat soffits carry the frame instead.
            if(MathF.Abs(n.Y)<.94f){var up=(Vector3.Up-n*n.Y).Normalized();return b.Dot(up)<0?-up:up;}
            var q=b-n*b.Dot(n);return q.LengthSquared()>1e-8f?q.Normalized():Perp(n);
        }
        static Vector3 Perp(Vector3 n){var q=Vector3.Back-n*n.Z;if(q.LengthSquared()<1e-6f)q=Vector3.Right-n*n.X;return q.Normalized();}
        static Vector3 Carry(Vector3 b,Vector3 from,Vector3 to,Vector3 edge)
        {
            // Rotate about the shared edge by the fold angle: an unfolding, also across 90-degree returns.
            var axis=edge.Normalized();
            float angle=MathF.Atan2(from.Cross(to).Dot(axis),from.Dot(to));
            return b.Rotated(axis,angle);
        }
        var queue=new PriorityQueue<(int tri,int parent,int slot),float>();
        // Seeds: the largest upright faces first, so walls set the course heights in world metres.
        var order=Enumerable.Range(0,tris).OrderBy(t=>MathF.Abs(fn[t].Y)<.35f?0:1).ThenByDescending(t=>area[t]).ToArray();
        int seedAt=0;
        void Place(int t,int parent,int slot)
        {
            int i0=ix[t*3],i1=ix[t*3+1],i2=ix[t*3+2];var n=fn[t];
            if(parent<0)
            {
                var b=Level(n,MathF.Abs(n.Y)<.35f?Vector3.Up:Perp(n));var tt=b.Cross(n);frameB[t]=b;
                for(int k=0;k<3;k++){var q=p[ix[t*3+k]];uv[t*3+k]=new Vector2(q.Dot(tt),MathF.Abs(n.Y)<.35f?q.Y:q.Dot(b));}
                return;
            }
            // Shared edge in the parent: the parent's corner slot and the next corner.
            int pk=slot%3;int pa=ix[parent*3+pk],pb=ix[parent*3+(pk+1)%3];
            var uvA=uv[parent*3+pk];var uvB=uv[parent*3+(pk+1)%3];
            var bc=Level(n,Carry(frameB[parent],fn[parent],n,p[pb]-p[pa]));var tc=bc.Cross(n);frameB[t]=bc;
            for(int k=0;k<3;k++)
            {
                int v=ix[t*3+k];
                if(weld[v]==weld[pa]){uv[t*3+k]=uvA;continue;}
                if(weld[v]==weld[pb]){uv[t*3+k]=uvB;continue;}
                var da=p[v]-p[pa];var db=p[v]-p[pb];
                uv[t*3+k]=(uvA+new Vector2(da.Dot(tc),da.Dot(bc))+uvB+new Vector2(db.Dot(tc),db.Dot(bc)))/2;
            }
        }
        int placed=0;
        while(placed<tris)
        {
            if(queue.Count==0)
            {
                while(seedAt<order.Length&&done[order[seedAt]])seedAt++;
                if(seedAt>=order.Length)break;
                queue.Enqueue((order[seedAt],-1,-1),0);
            }
            queue.TryDequeue(out var item,out float dist);
            if(done[item.tri])continue;
            done[item.tri]=true;placed++;Place(item.tri,item.parent,item.slot);
            for(int k=0;k<3;k++)
            {
                long e=Edge(ix[item.tri*3+k],ix[item.tri*3+(k+1)%3]);
                for(int s=edgeFirst[e];s>=0;s=next[s])
                {
                    int other=s/3;if(done[other])continue;
                    queue.Enqueue((other,item.tri,item.tri*3+k),dist+centre[item.tri].DistanceTo(centre[other]));
                }
            }
        }
        // Concentric ring courses on round shafts and their crown collars (seam behind the ladder side is arbitrary).
        if(rings!=null)
            for(int t=0;t<tris;t++)foreach(var r in rings)
            {
                var c2=new Vector2(centre[t].X,centre[t].Z)-r.Centre;
                if(c2.Length()>r.Outer||centre[t].Y<r.Rim-.12f||centre[t].Y>r.Top)continue;
                float a0=MathF.Atan2(c2.Y,c2.X);
                for(int k=0;k<3;k++)
                {
                    var q=p[ix[t*3+k]];var d=new Vector2(q.X,q.Z)-r.Centre;float rad=Math.Max(d.Length(),r.Radius);
                    float a=MathF.Atan2(d.Y,d.X);if(a-a0>MathF.PI)a-=Mathf.Tau;if(a0-a>MathF.PI)a+=Mathf.Tau;
                    bool wall=MathF.Abs(fn[t].Y)<.5f;
                    uv[t*3+k]=new Vector2(a*rad,wall?r.Radius+(r.Rim-q.Y):rad);
                }
            }
        // Corners become vertices; a vertex keeps one copy per distinct UV (seams only).
        var tile=new Vector2(f.TileU,f.TileV);
        var map=new List<int>();var mapped=new List<Vector2>();var lookup=new Dictionary<(int,int,int),int>();
        var newIx=new int[tris*3];
        for(int c=0;c<tris*3;c++)
        {
            int v=ix[c];var q=uv[c]/tile;
            var key=(v,(int)MathF.Round(q.X*1e5f),(int)MathF.Round(q.Y*1e5f));
            if(!lookup.TryGetValue(key,out int id)){id=map.Count;lookup[key]=id;map.Add(v);mapped.Add(q);}
            newIx[c]=id;
        }
        for(int k=0;k<(int)Mesh.ArrayType.Index;k++)
        {
            var value=arrays[k];
            switch(value.VariantType)
            {
                case Variant.Type.Nil:break;
                case Variant.Type.PackedVector3Array:var v3=value.AsVector3Array();arrays[k]=map.Select(i=>v3[i]).ToArray();break;
                case Variant.Type.PackedVector2Array:var v2=value.AsVector2Array();arrays[k]=map.Select(i=>v2[i]).ToArray();break;
                case Variant.Type.PackedColorArray:var cs=value.AsColorArray();arrays[k]=map.Select(i=>cs[i]).ToArray();break;
                case Variant.Type.PackedByteArray:var bytes=value.AsByteArray();int bs=bytes.Length/p.Length;arrays[k]=map.SelectMany(i=>bytes.AsSpan(i*bs,bs).ToArray()).ToArray();break;
                case Variant.Type.PackedFloat32Array:var fl=value.AsFloat32Array();int fs=fl.Length/p.Length;arrays[k]=map.SelectMany(i=>fl.AsSpan(i*fs,fs).ToArray()).ToArray();break;
                default:throw new InvalidOperationException("Unsupported Ruien unfold channel "+value.VariantType);
            }
        }
        arrays[(int)Mesh.ArrayType.TexUV]=mapped.ToArray();arrays[(int)Mesh.ArrayType.Index]=newIx;
        // The study's baked colour sampled the old courses' mortar at 2-3 cm; keep its weathering, drop those lines.
        if(blur>0&&arrays[(int)Mesh.ArrayType.Custom0].VariantType==Variant.Type.PackedByteArray)
        {
            var np=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var baked=arrays[(int)Mesh.ArrayType.Custom0].AsByteArray();
            if(baked.Length==np.Length*4)arrays[(int)Mesh.ArrayType.Custom0]=Blur(np,baked,blur);
        }
        return true;
    }

    private static byte[] Blur(Vector3[] p,byte[] baked,float radius)
    {
        var grid=new Dictionary<(int,int,int),List<int>>();
        (int,int,int) Cell(Vector3 q)=>((int)MathF.Floor(q.X/radius),(int)MathF.Floor(q.Y/radius),(int)MathF.Floor(q.Z/radius));
        for(int i=0;i<p.Length;i++)
        {
            if(baked[i*4]+baked[i*4+1]+baked[i*4+2]==0)continue;
            var c=Cell(p[i]);if(!grid.TryGetValue(c,out var list))grid[c]=list=new List<int>();list.Add(i);
        }
        var result=(byte[])baked.Clone();float inv=1/(radius*radius*.5f);
        for(int i=0;i<p.Length;i++)
        {
            if(baked[i*4]+baked[i*4+1]+baked[i*4+2]==0)continue;
            var (cx,cy,cz)=Cell(p[i]);Vector3 sum=Vector3.Zero;float w=0;
            for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++)
            {
                if(!grid.TryGetValue((cx+x,cy+y,cz+z),out var list))continue;
                foreach(int j in list)
                {
                    float d2=p[i].DistanceSquaredTo(p[j]);if(d2>radius*radius)continue;
                    float k=MathF.Exp(-d2*inv);
                    // Average in linear colour (stored as square roots).
                    sum+=new Vector3(baked[j*4]*baked[j*4],baked[j*4+1]*baked[j*4+1],baked[j*4+2]*baked[j*4+2])*k;w+=k;
                }
            }
            if(w<=0)continue;sum/=w;
            result[i*4]=(byte)Math.Clamp(MathF.Round(MathF.Sqrt(sum.X)),0,255);
            result[i*4+1]=(byte)Math.Clamp(MathF.Round(MathF.Sqrt(sum.Y)),0,255);
            result[i*4+2]=(byte)Math.Clamp(MathF.Round(MathF.Sqrt(sum.Z)),0,255);
        }
        return result;
    }
}
