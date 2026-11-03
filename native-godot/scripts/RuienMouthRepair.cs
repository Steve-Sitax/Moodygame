using Godot;
using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.World.Ruien;

// #267: patch the CURRENT native resources, never regenerate the original hall export.
public partial class RuienMouthRepair : Node
{
    static readonly Aabb[] Bounds = {
        new(new Vector3(-152.37f,-3.40f,109.29f),new Vector3(.42f,.30f,1.27f)),
        new(new Vector3(-147.05f,-3.40f,109.29f),new Vector3(.42f,.30f,1.27f)) };
    static bool Inside(Vector3 p)=>Bounds.Any(b=>b.HasPoint(p));
    public override void _Ready()
    {
        try { Repair(); GetTree().Quit(); }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
    void Repair()
    {
        var args=OS.GetCmdlineUserArgs();int i=Array.IndexOf(args,"--backup");
        if(i<0 || i+1>=args.Length)throw new ArgumentException("--backup outside the checkout required");
        string backup=Path.GetFullPath(args[i+1]);
        string checkout=Path.GetFullPath(Path.Combine(ProjectSettings.GlobalizePath("res://"),".."))+Path.DirectorySeparatorChar;
        if((backup+Path.DirectorySeparatorChar).StartsWith(checkout,StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Backup must be outside the checkout");
        Directory.CreateDirectory(backup);
        const string dir="res://world/ruien/o2/";

        // Validate the entire input set before writing anything; reject already repaired or independently edited resources.
        var originals=new (string file,string sha)[]{
            ("area.json","3D09708A2252C6DD8CED156403729D91B7CA01BDD252CD1DE7EA4FA558E9DD59"),
            ("collision.res","835CB5CF21639B1DA10E613B799A087EF0246AC0DE80BE38E49FD77E40457E73"),
            ("mesh_hall_bay10_lod0_01.res","4E3D355D82A09E76C5B141E5017869A53FA3612892F65947E6BDB24713654F80"),
            ("mesh_hall_bay10_lod1_00.res","7C7A0A5F675DDB11926882D392024217531CA4061EAAE3E851C3A9907A6EDE19"),
        };
        foreach(var original in originals)
        {
            var full=ProjectSettings.GlobalizePath(dir+original.file);
            if(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(full)))!=original.sha)
                throw new InvalidDataException("Source changed: "+original.file);
            if(File.Exists(Path.Combine(backup,original.file)))throw new IOException("Backup already exists: "+original.file);
        }
        var index=JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(dir+"area.json")))!;
        var stones=new RuienPatch.Tris();
        // Retain the spring bearing and embed the rear in the wall. Two bedded stones replace each long slab.
        // 10–13 mm arrises on all sides, including the soffit; no shader bevel or baked-black contact band.
        foreach(float x in new[]{-152.16f,-146.84f})
            for(int k=0;k<2;k++)
                RuienPatch.Box(stones,new Vector3(.398f,.20f,.616f),.010f+k*.003f,
                    new Transform3D(Basis.Identity,new Vector3(x,-3.21f,109.612f+k*.624f)),
                    new Color(.13f,.025f,.18f,0),.92f,2.4f);
        var bed=new RuienPatch.Tris();
        foreach(float x in new[]{-152.16f,-146.84f})
            RuienPatch.Box(bed,new Vector3(.374f,.178f,1.23f),.003f,
                new Transform3D(Basis.Identity,new Vector3(x,-3.21f,109.924f)),new Color(.1f,0,.1f,0),1,1);
        void Save(Resource r,string file)
        {
            string full=ProjectSettings.GlobalizePath(dir+file);
            System.IO.File.Copy(full,Path.Combine(backup,file),false);
            if(ResourceSaver.Save(r,dir+file,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException(file);
        }
        foreach(string lod in new[]{"lod0","lod1"})
        {
            string file=lod=="lod0"?"mesh_hall_bay10_lod0_01.res":"mesh_hall_bay10_lod1_00.res";
            var old=ResourceLoader.Load<ArrayMesh>(dir+file);var mesh=new ArrayMesh();int removed=0;
            for(int s=0;s<old.GetSurfaceCount();s++)
            {
                var a=old.SurfaceGetArrays(s);string family=old.SurfaceGetName(s);
                if(family=="ruien_bluestone") {removed+=RuienPatch.Drop(a,Inside);RuienPatch.Append(a,stones);}
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,a,null,null,old.SurfaceGetFormat(s)&~Mesh.ArrayFormat.FlagCompressAttributes);
                mesh.SurfaceSetName(s,family);
            }
            if(removed<100)throw new InvalidOperationException($"Unexpected {lod} source: {removed} removed triangles");
            var mortar=RuienPatch.ToArrays(bed);
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,mortar);
            mesh.SurfaceSetName(mesh.GetSurfaceCount()-1,"ruien_misc_Mortar_header");
            Save(mesh,file);
            foreach(var entry in index["keys"]!["hall_bay10"]![lod]!.AsArray())
                if(entry!["file"]!.GetValue<string>()==file)entry["tris"]=mesh.GetFaces().Length/3;
            GD.Print($"{file}: removed {removed}, added {stones.Count/3} stone + {bed.Count/3} mortar triangles");
        }
        var collision=ResourceLoader.Load<ConcavePolygonShape3D>(dir+"collision.res");
        var arr=new Godot.Collections.Array();arr.Resize((int)Mesh.ArrayType.Max);arr[(int)Mesh.ArrayType.Vertex]=collision.Data;
        int dropped=RuienPatch.Drop(arr,Inside);
        var p=arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arr[(int)Mesh.ArrayType.Index].AsInt32Array();
        if(dropped==0)throw new InvalidOperationException("No matching collision");
        var shape=new ConcavePolygonShape3D{Data=ix.Select(j=>p[j]).Concat(stones.P).Concat(bed.P).ToArray(),BackfaceCollision=true};
        Save(shape,"collision.res");
        System.IO.File.Copy(ProjectSettings.GlobalizePath(dir+"area.json"),Path.Combine(backup,"area.json"),false);
        File.WriteAllText(ProjectSettings.GlobalizePath(dir+"area.json"),index.ToJsonString(new(){WriteIndented=true})+"\n");
        GD.Print($"collision: removed {dropped}; matching stone/mortar faces installed");
    }
}
