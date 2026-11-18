using Godot;
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.Json;

// Offline resource repair. Runtime uses the existing paving, collision and wear mask; no per-stone meshes.
public partial class PavingFinishRepair : Node
{
    static string Hash(string path)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path))));
    static void Check(bool ok,string what){if(!ok)throw new IOException(what);}
    public override void _Ready()
    {
        try {Scheldemist.Native.Game.NativeGlobals.Ensure();Run();GetTree().Quit();}catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
    void Run()
    {
        string work=ProjectSettings.GlobalizePath("res://../.scratch/quay-paving/option-a");
        string backup=Path.Combine(work,"originals");Directory.CreateDirectory(backup);
        var receipt=JsonDocument.Parse(File.ReadAllText(Path.Combine(work,"paved-ruts.json"))).RootElement;
        string rutPath="res://world/town/resources/r005279.res";
        foreach(var entry in receipt.GetProperty("sourceHashes").EnumerateObject())
            Check(Hash(entry.Name).Equals(entry.Value.GetString(),StringComparison.OrdinalIgnoreCase),"Stale paving input: "+entry.Name);
        Check(Hash(Path.Combine(work,"ruts-earth.f32")).Equals(receipt.GetProperty("outputSha256").GetString(),StringComparison.OrdinalIgnoreCase),"Damaged rut candidate");
        Check(Hash(Path.Combine(work,"ruts-earth-bary.f32")).Equals(receipt.GetProperty("barySha256").GetString(),StringComparison.OrdinalIgnoreCase),"Damaged rut interpolation");
        foreach(string path in new[]{rutPath,"res://world/town/resources/r000038.res","res://world/town/resources/r000024.res"}) {
            string original=Path.Combine(backup,Path.GetFileName(path));if(File.Exists(original))Check(Hash(original)==Hash(path),"Repair already applied; restore its exact backup before regenerating: "+original);else File.Copy(ProjectSettings.GlobalizePath(path),original);
        }
        var old=ResourceLoader.Load<ArrayMesh>(rutPath);Check(old.GetSurfaceCount()==1,"Unexpected rut surfaces");
        var source=old.SurfaceGetArrays(0);
        foreach(int channel in new[]{(int)Mesh.ArrayType.Bones,(int)Mesh.ArrayType.Weights})
            Check(source[channel].VariantType==Variant.Type.Nil,"Rut attribute requires explicit interpolation: "+channel);
        var bytes=File.ReadAllBytes(Path.Combine(work,"ruts-earth.f32"));var data=new float[bytes.Length/4];Buffer.BlockCopy(bytes,0,data,0,bytes.Length);
        int n=data.Length/5;var positions=new Vector3[n];var uv=new Vector2[n];
        for(int i=0;i<n;i++){positions[i]=new(data[i*5],data[i*5+1],data[i*5+2]);uv[i]=new(data[i*5+3],data[i*5+4]);}
        var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=positions;arrays[(int)Mesh.ArrayType.Normal]=positions.Select(_=>Vector3.Up).ToArray();arrays[(int)Mesh.ArrayType.TexUV]=uv;
        var baryBytes=File.ReadAllBytes(Path.Combine(work,"ruts-earth-bary.f32"));var bary=new float[baryBytes.Length/4];Buffer.BlockCopy(baryBytes,0,bary,0,baryBytes.Length);Check(bary.Length==n*4,"Wrong interpolation count");
        int[] ix=source[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,old.SurfaceGetArrayLen(0)).ToArray():source[(int)Mesh.ArrayType.Index].AsInt32Array();
        if(source[(int)Mesh.ArrayType.Color].VariantType!=Variant.Type.Nil){var colors=source[(int)Mesh.ArrayType.Color].AsColorArray();var output=new Color[n];for(int i=0;i<n;i++)for(int k=0;k<3;k++)output[i]+=colors[ix[(int)bary[i*4]*3+k]]*bary[i*4+k+1];arrays[(int)Mesh.ArrayType.Color]=output;}
        if(source[(int)Mesh.ArrayType.TexUV2].VariantType!=Variant.Type.Nil){var uv2=source[(int)Mesh.ArrayType.TexUV2].AsVector2Array();var output=new Vector2[n];for(int i=0;i<n;i++)for(int k=0;k<3;k++)output[i]+=uv2[ix[(int)bary[i*4]*3+k]]*bary[i*4+k+1];arrays[(int)Mesh.ArrayType.TexUV2]=output;}
        var mesh=new ArrayMesh{ResourceName=old.ResourceName};foreach(var key in old.GetMetaList())mesh.SetMeta(key,old.GetMeta(key));
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);mesh.SurfaceSetName(0,old.SurfaceGetName(0));mesh.SurfaceSetMaterial(0,old.SurfaceGetMaterial(0));
        if(source[(int)Mesh.ArrayType.Tangent].VariantType!=Variant.Type.Nil){var tool=new SurfaceTool();tool.CreateFrom(mesh,0);tool.GenerateTangents();mesh.ClearSurfaces();tool.Commit(mesh);mesh.SurfaceSetName(0,old.SurfaceGetName(0));mesh.SurfaceSetMaterial(0,old.SurfaceGetMaterial(0));}
        Check(ResourceSaver.Save(mesh,rutPath,ResourceSaver.SaverFlags.Compress)==Error.Ok,"Rut save failed");
        foreach(var (path,depth) in new[]{("res://world/town/resources/r000038.res",.022f),("res://world/town/resources/r000024.res",.018f)}) {
            var material=ResourceLoader.Load<ShaderMaterial>(path);var shader=(Shader)material.Shader.Duplicate();
            const string oldFade="smoothstep(0.2, 1.0, CAMERA_POSITION_WORLD.y - world.y) * smoothstep(0.04, 0.2, rel_v.y)";
            const string newFade="smoothstep(0.04, 0.50, CAMERA_POSITION_WORLD.y - world.y) * smoothstep(0.035, 0.18, rel_v.y)";
            Check(shader.Code.Contains(oldFade),"Unknown parallax fade");shader.Code=shader.Code.Replace(oldFade,newFade);material.Shader=shader;
            material.SetShaderParameter("relief_depth",depth);material.SetShaderParameter("relief_bump",2.0f);material.SetShaderParameter("relief_dome",1.1f);
            Check(ResourceSaver.Save(material,path,ResourceSaver.SaverFlags.Compress)==Error.Ok,"Material save failed");
        }
        GD.Print($"PAVING_FINISH_PASS: {n/3} earth rut triangles; shallow irregular paved wear from original dirt mask; low-eye relief restored without new geometry");
    }
}
