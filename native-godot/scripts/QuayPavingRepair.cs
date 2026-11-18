using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.Json;
using Godot;

// Offline repair: dump-quay.gd -> quay_track_infill.py -> this scene, all with the same --work folder.
// Originals are retained. A repeat application requires the current files to match the last receipt.
public partial class QuayPavingRepair : Node
{
    const string Quay="res://world/town/resources/r000039.res", Track="res://world/town/resources/r000553.res";
    static readonly Dictionary<string,string> Ground=new() {
        ["ground_quay"]=Quay, ["ground_cobble"]="res://world/town/resources/r000025.res",
        ["ground_flags"]="res://world/town/resources/r000017.res", ["ground_earth"]="res://world/town/resources/r000008.res" };
    static void Check(bool ok,string label) { if(!ok)throw new IOException(label); }
    static string Hash(string path)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path))));
    static bool Same(Variant a,Variant b)=>GD.VarToBytes(a).SequenceEqual(GD.VarToBytes(b));
    static void SameMeta(ArrayMesh a,ArrayMesh b) { foreach(var k in a.GetMetaList())Check(Same(a.GetMeta(k),b.GetMeta(k)),"Changed metadata "+k); }
    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch(Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
    void Run()
    {
        var args=OS.GetCmdlineUserArgs();int at=Array.IndexOf(args,"--work");
        string work=at>=0?Path.GetFullPath(args[at+1]):ProjectSettings.GlobalizePath("res://../.scratch/quay-paving");
        string backup=Path.Combine(work,"originals"), receipt=Path.Combine(work,"repair.json");Directory.CreateDirectory(backup);
        var previous=File.Exists(receipt)?JsonDocument.Parse(File.ReadAllText(receipt)).RootElement.EnumerateArray().ToArray():Array.Empty<JsonElement>();
                var candidate=JsonDocument.Parse(File.ReadAllText(Path.Combine(work,"candidate.json"))).RootElement;
        foreach(var entry in candidate.GetProperty("sourceHashes").EnumerateObject()) {
            string source=entry.Name;
            if(source==Quay||source==Track) {
                string saved=Path.Combine(backup,Path.GetFileName(source));if(File.Exists(saved))source=saved;
            }
            Check(Hash(source).Equals(entry.Value.GetString(),StringComparison.OrdinalIgnoreCase),"Stale paving candidate: "+entry.Name);
        }
        foreach(var entry in candidate.GetProperty("outputs").EnumerateObject())
            Check(Hash(Path.Combine(work,entry.Name)).Equals(entry.Value.GetString(),StringComparison.OrdinalIgnoreCase),"Damaged candidate triangles: "+entry.Name);
        var originals=new Dictionary<string,ArrayMesh>();
        // Guard both inputs before saving either output.
        foreach(string path in new[]{Quay,Track}) {
            string file=ProjectSettings.GlobalizePath(path), original=Path.Combine(backup,Path.GetFileName(path));
            if(File.Exists(original)) {
                bool recorded=previous.Any(e=>e.GetProperty("path").GetString()==path && e.GetProperty("after").GetString()==Hash(path));
                Check(recorded||Hash(file)==Hash(original),"Changed outside the recorded repair: "+file);
            } else File.Copy(file,original);
            var old=ResourceLoader.Load<ArrayMesh>(original);Check(old.GetSurfaceCount()==1,"Expected one original surface: "+path);originals[path]=old;
        }
        var receipts=new List<object>();
        foreach(string path in new[]{Quay,Track}) {
            var old=originals[path];var made=new ArrayMesh{ResourceName=old.ResourceName};
            foreach(var key in old.GetMetaList())made.SetMeta(key,old.GetMeta(key));
            if(path==Quay) {
                var arrays=old.SurfaceGetArrays(0);var pos=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                arrays[(int)Mesh.ArrayType.TexUV]=pos.Select(p=>new Vector2(p.X/2.5f,p.Z/2.5f)).ToArray();
                made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays,null,null,old.SurfaceGetFormat(0)&Mesh.ArrayFormat.FlagCompressAttributes);
                made.SurfaceSetMaterial(0,old.SurfaceGetMaterial(0));made.SurfaceSetName(0,old.SurfaceGetName(0));
            } else {
                Check(old.HasMeta("native_solid_stand_in")&&old.HasMeta("native_solid_skip"),"Track collision stand-in missing");
                foreach(var entry in JsonDocument.Parse(File.ReadAllText(Path.Combine(work,"track-surfaces.json"))).RootElement.EnumerateArray()) {
                    string ground=entry.GetProperty("ground").GetString()!;
                    byte[] bytes=File.ReadAllBytes(Path.Combine(work,entry.GetProperty("file").GetString()!));Check(bytes.Length%60==0,"Partial triangle");
                    var rows=new float[bytes.Length/4];Buffer.BlockCopy(bytes,0,rows,0,bytes.Length);
                    int count=rows.Length/5;var pos=new Vector3[count];var uv=new Vector2[count];var normal=new Vector3[count];
                    for(int i=0;i<count;i++) { pos[i]=new(rows[i*5],rows[i*5+1],rows[i*5+2]);uv[i]=new(rows[i*5+3],rows[i*5+4]);normal[i]=Vector3.Up; }
                    var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);
                    arrays[(int)Mesh.ArrayType.Vertex]=pos;arrays[(int)Mesh.ArrayType.Normal]=normal;arrays[(int)Mesh.ArrayType.TexUV]=uv;
                    made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);int s=made.GetSurfaceCount()-1;
                    made.SurfaceSetMaterial(s,ResourceLoader.Load<ArrayMesh>(Ground[ground]).SurfaceGetMaterial(0));made.SurfaceSetName(s,ground+"_edge_fill");
                }
                // The original skipped surface 0. All replacement surfaces are visual; the original stand-in still owns collision.
                made.SetMeta("native_solid_skip",Enumerable.Range(0,made.GetSurfaceCount()).ToArray());
            }
            foreach(var k in old.GetMetaList())if(k!="native_solid_skip")Check(Same(old.GetMeta(k),made.GetMeta(k)),"Changed metadata "+k);
            Check(ResourceSaver.Save(made,path,ResourceSaver.SaverFlags.Compress)==Error.Ok,"Save failed "+path);
            var back=ResourceLoader.Load<ArrayMesh>(path,null,ResourceLoader.CacheMode.Ignore);SameMeta(made,back);
            for(int s=0;s<made.GetSurfaceCount();s++) {
                var a=made.SurfaceGetArrays(s);var b=back.SurfaceGetArrays(s);
                for(int i=0;i<(int)Mesh.ArrayType.Max;i++)Check(Same(a[i],b[i]),"Reload changed attribute "+i);
            }
            if(path==Quay) {
                var a=old.SurfaceGetArrays(0);var b=back.SurfaceGetArrays(0);
                for(int i=0;i<(int)Mesh.ArrayType.Max;i++)if(i!=(int)Mesh.ArrayType.TexUV)Check(Same(a[i],b[i]),"Quay attribute changed "+i);
                Check(old.GetAabb()==back.GetAabb(),"Quay bounds changed");
            }
            receipts.Add(new{path,before=Hash(Path.Combine(backup,Path.GetFileName(path))),after=Hash(path),
                verticesBefore=old.SurfaceGetArrayLen(0),verticesAfter=Enumerable.Range(0,back.GetSurfaceCount()).Sum(back.SurfaceGetArrayLen),collisionStandInUnchanged=true});
        }
                const string matPath="res://world/town/resources/r000038.res";
        string matOriginal=Path.Combine(backup,Path.GetFileName(matPath));
        if(File.Exists(matOriginal))Check(previous.Any(e=>e.GetProperty("path").GetString()==matPath&&e.GetProperty("after").GetString()==Hash(matPath)),"Changed quay material outside repair");
        else File.Copy(ProjectSettings.GlobalizePath(matPath),matOriginal);
        var material=ResourceLoader.Load<ShaderMaterial>(matPath);
        string shader=material.Shader.Code;
        foreach(var value in new[]{("relief_depth",.014f),("relief_bump",1.6f),("relief_dome",1f)})material.SetShaderParameter(value.Item1,value.Item2);
        Check(ResourceSaver.Save(material,matPath,ResourceSaver.SaverFlags.Compress)==Error.Ok,"Material save failed");
        var reloaded=ResourceLoader.Load<ShaderMaterial>(matPath,null,ResourceLoader.CacheMode.Ignore);Check(reloaded.Shader.Code==shader,"Shader changed");
        foreach(var value in new[]{("relief_depth",.014f),("relief_bump",1.6f),("relief_dome",1f)})Check(reloaded.GetShaderParameter(value.Item1).AsSingle()==value.Item2,"Relief value lost");
        receipts.Add(new{path=matPath,before=Hash(matOriginal),after=Hash(matPath),reliefDepth=.014f,bump=1.6f,dome=1f,shaderUnchanged=true});
        File.WriteAllText(receipt,JsonSerializer.Serialize(receipts,new JsonSerializerOptions{WriteIndented=true}));
        GD.Print("QUAY_REPAIR_PASS: straight 2.5 m UV grid; exposed infill only; exact ground geometry and collision stand-ins");
    }
}


