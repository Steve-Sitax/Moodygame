using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;

/// <summary>Run in fresh processes to test valid and damaged cache generations.</summary>
public partial class RuienCacheValidationProof:Node
{
    public override void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string key)=>args[Array.IndexOf(args,key)+1];
            string folder=Arg("--fixture");Directory.CreateDirectory(folder);
            string source=Path.Combine(folder,"source.res");
            using var box=new BoxMesh{Size=new Vector3(1.25f,2.5f,3.75f)};
            if(!System.IO.File.Exists(source))
            {
                using var original=new ArrayMesh();original.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,box.GetMeshArrays());
                ResourceSaver.Save(original,source);
            }
            var type=typeof(RuienData).Assembly.GetType("Scheldemist.World.Ruien.RuienGeometryCache")!;
            var get=type.GetMethod("Get",BindingFlags.NonPublic|BindingFlags.Static)!.MakeGenericMethod(typeof(ArrayMesh));
            int built=0;
            ArrayMesh Build(){built++;var mesh=new ArrayMesh();mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,box.GetMeshArrays());return mesh;}
            var result=(ArrayMesh)get.Invoke(null,new object[]{source,"validation-fixture",(Func<ArrayMesh>)Build})!;
            int expected=int.Parse(Arg("--expected-builds"));
            if(built!=expected||result.GetAabb()!=box.GetAabb()||!result.GetFaces().SequenceEqual(box.GetFaces()))
                throw new Exception($"Cache round trip failed: expected {expected} builds, got {built}");
            var file=(string)type.GetMethod("CacheFile",BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,new object[]{source,"validation-fixture",".res"})!;
            System.IO.File.WriteAllText(Path.Combine(folder,"result.json"),JsonSerializer.Serialize(new{pass=true,built,file}));
            GD.Print($"RUIEN CACHE VALIDATION PASS: {built} builds, exact geometry");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
