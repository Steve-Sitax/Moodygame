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
    public static bool Repair(Godot.Collections.Array arrays,string family,bool continuous=false)
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
            // A continuous floor chart keeps its relief flanks (projected, as laid): only collapsed slivers are re-charted,
            // otherwise each repaired triangle starts its own phase and the setts shatter into mm-scale streaks.
            if(continuous && min>=.25f && max<=3f && max/Math.Max(min,1e-6f)<=4f)continue;
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
    /// <summary>
    /// (#214) A continuous setts chart's steep relief flanks (projected as laid, up to 1:4) are unfolded onto themselves:
    /// a stretched triangle keeps the chart's uv on its edge shared with a sound neighbour (so the phase runs on over the
    /// arris) and its third corner is laid at true length across the flank; fixed triangles become sound neighbours in
    /// turn, so a flank of several rows unrolls from its top. One with no sound edge gets a rigid chart at its own centre.
    /// Returns how many triangles were laid again.
    /// </summary>
    public static int UnfoldFlanks(Godot.Collections.Array arrays,string family)
    {
        var families=RuienTextures.Families();
        if(!families.TryGetValue(family.StartsWith("ruien_")?family[6..]:family,out var f))return 0;
        var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var uv=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var ix=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();if(uv.Length!=p.Length)return 0;
        if(ix.Length==0)ix=Enumerable.Range(0,p.Length).ToArray();
        var tile=new Vector2(f.TileU,f.TileV);int n=ix.Length/3;
        bool Sound(Vector3 a,Vector3 b,Vector3 c,Vector2 ua,Vector2 ub,Vector2 uc)
        {
            var e=b-a;var g=c-a;float length=e.Length();if(length<1e-7f)return true;
            float along=g.Dot(e/length),across=e.Cross(g).Length()/length;if(across<1e-7f)return true;
            var x=(ub-ua)*tile/length;var y=((uc-ua)*tile-x*along)/across;
            float aa=x.LengthSquared(),bb=y.LengthSquared(),ab=x.Dot(y),disc=MathF.Sqrt((aa-bb)*(aa-bb)+4*ab*ab);
            float max=MathF.Sqrt(Math.Max(0,(aa+bb+disc)/2)),min=MathF.Sqrt(Math.Max(0,(aa+bb-disc)/2));
            return min>=.6f && max<=1.7f && max/Math.Max(min,1e-6f)<=1.3f;
        }
        string K(Vector3 v)=>$"{MathF.Round(v.X*2e4f)},{MathF.Round(v.Y*2e4f)},{MathF.Round(v.Z*2e4f)}";
        // each triangle's own corner uvs (a fixed triangle gets new ones)
        var tuv=new Vector2[n*3];for(int i=0;i<n*3;i++)tuv[i]=uv[ix[i]];
        var sound=new bool[n];var bad=new List<int>();
        for(int t=0;t<n;t++){sound[t]=Sound(p[ix[t*3]],p[ix[t*3+1]],p[ix[t*3+2]],tuv[t*3],tuv[t*3+1],tuv[t*3+2]);if(!sound[t])bad.Add(t);}
        if(bad.Count==0)return 0;
        // edges by position: the triangles on each, with the uvs their corners carry
        var edges=new Dictionary<string,List<(int t,int j0,int j1)>>();
        string E(int t,int j0,int j1){string a=K(p[ix[t*3+j0]]),b=K(p[ix[t*3+j1]]);return string.CompareOrdinal(a,b)<0?a+"|"+b:b+"|"+a;}
        foreach(int t in bad)for(int j=0;j<3;j++)edges[E(t,j,(j+1)%3)]=new();
        for(int t=0;t<n;t++)for(int j=0;j<3;j++){var key=E(t,j,(j+1)%3);if(edges.TryGetValue(key,out var l))l.Add((t,j,(j+1)%3));}
        var fixedSet=new HashSet<int>();bool progress=true;
        while(progress)
        {
            progress=false;
            foreach(int t in bad)
            {
                if(fixedSet.Contains(t))continue;
                for(int j=0;j<3&&!fixedSet.Contains(t);j++)
                {
                    int j1=(j+1)%3,j2=(j+2)%3;
                    foreach(var (o,k0,k1) in edges[E(t,j,j1)])
                    {
                        if(o==t||!(sound[o]||fixedSet.Contains(o)))continue;
                        // the neighbour's uv at this edge's two ends (matched by position)
                        bool same=K(p[ix[o*3+k0]])==K(p[ix[t*3+j]]);
                        var ua=same?tuv[o*3+k0]:tuv[o*3+k1];var ub=same?tuv[o*3+k1]:tuv[o*3+k0];
                        Vector3 A=p[ix[t*3+j]],B=p[ix[t*3+j1]],C=p[ix[t*3+j2]];
                        var e=B-A;float length=e.Length();if(length<1e-7f)break;
                        float along=(C-A).Dot(e/length),across=e.Cross(C-A).Length()/length;
                        var du=(ub-ua)*tile;if(du.LengthSquared()<1e-12f)break;
                        // the chart's metric along the edge as it is (its phase), the flank laid across at true length,
                        // on the side the old chart put the third corner (no mirror)
                        var u=du/length;var side=new Vector2(-u.Y,u.X);
                        var oldc=(tuv[t*3+j2]-ua)*tile;float hand=(du.X*oldc.Y-du.Y*oldc.X)<0?-1:1;
                        var uc=ua+(u*along+side.Normalized()*u.Length()*across*hand)/tile;
                        tuv[t*3+j]=ua;tuv[t*3+j1]=ub;tuv[t*3+j2]=uc;
                        fixedSet.Add(t);progress=true;break;
                    }
                }
            }
        }
        foreach(int t in bad)
        {
            if(fixedSet.Contains(t))continue;
            Vector3 A=p[ix[t*3]],B=p[ix[t*3+1]],C=p[ix[t*3+2]];var e=B-A;float length=e.Length();if(length<1e-7f)continue;
            float along=(C-A).Dot(e/length),across=e.Cross(C-A).Length()/length;
            var du=(tuv[t*3+1]-tuv[t*3])*tile;var u=du.LengthSquared()>1e-10f?du.Normalized():new Vector2(1,0);
            var dv=(tuv[t*3+2]-tuv[t*3])*tile;float hand=du.X*dv.Y-du.Y*dv.X<0?-1:1;var v=new Vector2(-u.Y,u.X)*hand;
            var centre=(tuv[t*3]+tuv[t*3+1]+tuv[t*3+2])*tile/3;var origin=centre-(u*(length+along)+v*across)/3;
            tuv[t*3]=origin/tile;tuv[t*3+1]=(origin+u*length)/tile;tuv[t*3+2]=(origin+u*along+v*across)/tile;fixedSet.Add(t);
        }
        // split: each laid-again triangle its own three vertices (copies of the old ones with the new uv)
        var map=Enumerable.Range(0,p.Length).ToList();var mapped=uv.ToList();
        foreach(int t in fixedSet)for(int j=0;j<3;j++){int old=ix[t*3+j];ix[t*3+j]=map.Count;map.Add(old);mapped.Add(tuv[t*3+j]);}
        var used=ix.Distinct().ToArray();var renumber=new int[map.Count];for(int i=0;i<used.Length;i++)renumber[used[i]]=i;
        for(int i=0;i<ix.Length;i++)ix[i]=renumber[ix[i]];
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
        return fixedSet.Count;
    }

    /// <summary>(#214) Unfolds the setts' relief flanks of every installed Ruien mesh in a folder, each original copied to
    /// the backup folder first (never overwriting a backup). Only the setts surfaces change.</summary>
    public static void UnfoldInstalled(string folder,string backup)
    {
        Directory.CreateDirectory(backup);int total=0,files=0;
        foreach(string file in Directory.GetFiles(folder,"mesh_*.res"))
        {
            var res="res://"+Path.GetRelativePath(ProjectSettings.GlobalizePath("res://"),file).Replace('\\','/');
            var mesh=ResourceLoader.Load<ArrayMesh>(res,null,ResourceLoader.CacheMode.Ignore);var rebuilt=new ArrayMesh{ResourceName=mesh.ResourceName};
            foreach(var key in mesh.GetMetaList())rebuilt.SetMeta(key,mesh.GetMeta(key));
            int laid=0;
            for(int s=0;s<mesh.GetSurfaceCount();s++)
            {
                var a=mesh.SurfaceGetArrays(s);string name=mesh.SurfaceGetName(s);
                if(name=="ruien_setts")laid+=UnfoldFlanks(a,name);
                rebuilt.AddSurfaceFromArrays(mesh.SurfaceGetPrimitiveType(s),a,null,null,mesh.SurfaceGetFormat(s)&~Mesh.ArrayFormat.FlagCompressAttributes);
                rebuilt.SurfaceSetName(s,name);rebuilt.SurfaceSetMaterial(s,mesh.SurfaceGetMaterial(s));
            }
            if(laid==0)continue;
            string copy=Path.Combine(backup,Path.GetFileName(file));if(File.Exists(copy))throw new IOException("Backup exists: "+copy);
            File.Copy(file,copy);
            if(ResourceSaver.Save(rebuilt,res,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException(res);
            total+=laid;files++;GD.Print($"ruien flanks: {Path.GetFileName(file)} {laid} triangles");
        }
        GD.Print($"ruien flanks: {total} triangles in {files} meshes");
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
