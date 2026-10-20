using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Offline metric UV audit. Measures in physical texture metres, never in normalized tile units.</summary>
public static class RuienUv
{
    /// <summary>Restore collapsed/sliver UV charts on exposed narrow faces; retain the authored phase and direction.</summary>
    public static bool Repair(Godot.Collections.Array arrays,string family)
    {
        var families=RuienTextures.Families();
        if(!families.TryGetValue(family.StartsWith("ruien_")?family[6..]:family,out var f))return false;
        var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var uv=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var ix=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();if(uv.Length!=p.Length)return false;
        if(ix.Length==0)ix=Enumerable.Range(0,p.Length).ToArray();
        var map=Enumerable.Range(0,p.Length).ToList();var mapped=uv.ToList();var tile=new Vector2(f.TileU,f.TileV);
        var unbake=new HashSet<int>();
        for(int i=0;i<ix.Length;i+=3)
        {
            int a=ix[i],b=ix[i+1],c=ix[i+2];var e=p[b]-p[a];var g=p[c]-p[a];
            float length=e.Length();if(length<1e-7f)continue;
            float along=g.Dot(e/length),across=e.Cross(g).Length()/length;if(across<1e-7f)continue;
            var du=(uv[b]-uv[a])*tile;var dv=(uv[c]-uv[a])*tile;
            var x=du/length;var y=(dv-x*along)/across;
            float aa=x.LengthSquared(),bb=y.LengthSquared(),ab=x.Dot(y),disc=MathF.Sqrt((aa-bb)*(aa-bb)+4*ab*ab);
            float max=MathF.Sqrt(Math.Max(0,(aa+bb+disc)/2)),min=MathF.Sqrt(Math.Max(0,(aa+bb-disc)/2));
            // Relief slopes may shorten a chart slightly. Exposed thin faces still need the same metric scale.
            if(min>=.6f && max<=1.7f && max/Math.Max(min,1e-6f)<=1.3f)continue;
            var u=du.LengthSquared()>.00001f?du.Normalized():new Vector2(1,0);
            float handed=du.Cross(dv)<0?-1:1;var v=new Vector2(-u.Y,u.X)*handed;
            var centre=(uv[a]+uv[b]+uv[c])*tile/3;
            var origin=centre-(u*(length+along)+v*across)/3;
            var fix=new[]{origin,origin+u*length,origin+u*along+v*across};
            bool collapsed=min<.25f||max>3||max/Math.Max(min,1e-6f)>4;
            for(int j=0;j<3;j++){int old=ix[i+j];ix[i+j]=map.Count;if(collapsed)unbake.Add(map.Count);map.Add(old);mapped.Add(fix[j]/tile);}
        }
        if(map.Count==p.Length)return false;
        // Keep only referenced vertices after splitting charts; the old copies would waste GPU memory.
        var used=ix.Distinct().ToArray();var renumber=new int[map.Count];
        for(int i=0;i<used.Length;i++)renumber[used[i]]=i;
        for(int i=0;i<ix.Length;i++)ix[i]=renumber[ix[i]];
        var repaired=used.Select(unbake.Contains).ToArray();
        map=used.Select(i=>map[i]).ToList();mapped=used.Select(i=>mapped[i]).ToList();
        for(int k=0;k<(int)Mesh.ArrayType.Index;k++)
        {
            var value=arrays[k];
            switch(value.VariantType)
            {
                case Variant.Type.Nil:break;
                case Variant.Type.PackedVector3Array:var v3=value.AsVector3Array();arrays[k]=map.Select(i=>v3[i]).ToArray();break;
                case Variant.Type.PackedVector2Array:var v2=value.AsVector2Array();arrays[k]=map.Select(i=>v2[i]).ToArray();break;
                case Variant.Type.PackedColorArray:var colors=value.AsColorArray();arrays[k]=map.Select(i=>colors[i]).ToArray();break;
                case Variant.Type.PackedByteArray:var bytes=value.AsByteArray();int bs=bytes.Length/p.Length;arrays[k]=map.SelectMany(i=>bytes.AsSpan(i*bs,bs).ToArray()).ToArray();break;
                case Variant.Type.PackedFloat32Array:var floats=value.AsFloat32Array();int fs=floats.Length/p.Length;arrays[k]=map.SelectMany(i=>floats.AsSpan(i*fs,fs).ToArray()).ToArray();break;
                default:throw new InvalidOperationException("Unsupported Ruien UV vertex channel "+value.VariantType);
            }
        }
        arrays[(int)Mesh.ArrayType.TexUV]=mapped.ToArray();arrays[(int)Mesh.ArrayType.Index]=ix;
        // A colour baked from the collapsed chart would preserve its streak even after fixing the normal/albedo UV.
        if(arrays[(int)Mesh.ArrayType.Custom0].VariantType==Variant.Type.PackedByteArray)
        {
            var baked=arrays[(int)Mesh.ArrayType.Custom0].AsByteArray();
            if(baked.Length==map.Count*4)for(int i=0;i<map.Count;i++)if(repaired[i])
                baked[i*4]=baked[i*4+1]=baked[i*4+2]=0; // black RGB means no baked colour; alpha remains AO
            arrays[(int)Mesh.ArrayType.Custom0]=baked;
        }
        return true;
    }
    public static void Audit(string folder,string output)
    {
        var families=RuienTextures.Families();var report=new List<object>();
        foreach(string file in Directory.GetFiles(folder,"mesh_*.res"))
        {
            var mesh=ResourceLoader.Load<ArrayMesh>(file);
            for(int s=0;s<mesh.GetSurfaceCount();s++)
            {
                string name=mesh.SurfaceGetName(s),key=name.StartsWith("ruien_")?name[6..]:name;
                if(!families.TryGetValue(key,out var family))continue;
                var a=mesh.SurfaceGetArrays(s);var v=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var uv=a[(int)Mesh.ArrayType.TexUV].AsVector2Array();var ix=a[(int)Mesh.ArrayType.Index].AsInt32Array();
                if(ix.Length==0)ix=Enumerable.Range(0,v.Length).ToArray();
                if(uv.Length!=v.Length)continue;
                double area=0,bad=0;float worst=0;Vector3 where=default;var samples=new List<object>();
                for(int i=0;i<ix.Length;i+=3)
                {
                    var p=v[ix[i]];var e=v[ix[i+1]]-p;var f=v[ix[i+2]]-p;
                    float x=e.Length(),height=e.Cross(f).Length()/Math.Max(x,1e-8f),weight=x*height*.5f;
                    if(weight<1e-7f)continue;
                    var tile=new Vector2(family.TileU,family.TileV);
                    var u=(uv[ix[i+1]]-uv[ix[i]])*tile/Math.Max(x,1e-8f);
                    var w=((uv[ix[i+2]]-uv[ix[i]])*tile-u*f.Dot(e/x))/height;
                    float aa=u.LengthSquared(),bb=w.LengthSquared(),ab=u.Dot(w),disc=MathF.Sqrt((aa-bb)*(aa-bb)+4*ab*ab);
                    float max=MathF.Sqrt(Math.Max(0,(aa+bb+disc)/2)),min=MathF.Sqrt(Math.Max(0,(aa+bb-disc)/2));
                    float ratio=max/Math.Max(min,1e-5f);area+=weight;
                    if(ratio>1.3f || min<.6f || max>1.7f)
                    {
                        bad+=weight;
                        if(samples.Count<5)samples.Add(new{at=new[]{p.X,p.Y,p.Z},ratio,min,max});
                    }
                    if(ratio>worst){worst=ratio;where=p;}
                }
                report.Add(new{file=Path.GetFileName(file),family=name,area,badArea=bad,worst,at=new[]{where.X,where.Y,where.Z},samples});
            }
        }
        File.WriteAllText(output,JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
    }
}
