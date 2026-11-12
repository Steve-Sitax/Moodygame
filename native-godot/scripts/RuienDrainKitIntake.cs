using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;

// Isolated construction tool: never writes installed world assets unless explicitly given that destination.
public partial class RuienDrainKitIntake : Node
{
    public override void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();
            string Arg(string name)=>args[Array.IndexOf(args,name)+1];
            string source=Path.GetFullPath(Arg("--source")),output=Path.GetFullPath(Arg("--out")).Replace('\\','/');
            if(source==output)throw new ArgumentException("Keep source exports separate from native output");
            Directory.CreateDirectory(output);
            var manifest=JsonDocument.Parse(File.ReadAllText(Path.Combine(source,"manifest.json"))).RootElement;
            var templates=manifest.GetProperty("templates");
            foreach(var template in templates.EnumerateObject())
            {
                string id=template.Name;
                foreach(int lod in new[]{0,1})
                {
                    var mesh=new ArrayMesh{ResourceName=id+"_lod"+lod};
                    var files=manifest.GetProperty("files").EnumerateObject().Where(f=>f.Name.Contains("_"+id+"_") && f.Value.TryGetProperty("lod",out var level) && level.GetInt32()==lod).ToArray();
                    if(files.Length==0)throw new InvalidDataException("Missing drain head level "+id+"/"+lod);
                    foreach(var file in files)
                        foreach(var obj in RuienGlb.Read(Path.Combine(source,file.Name)))
                        {
                            using var part=RuienImport.Build(obj,out _,uvRepair:true);
                            if(part==null)continue;
                            for(int s=0;s<part.GetSurfaceCount();s++)
                            {
                                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,part.SurfaceGetArrays(s),null,null,part.SurfaceGetFormat(s));
                                mesh.SurfaceSetName(mesh.GetSurfaceCount()-1,part.SurfaceGetName(s));
                            }
                        }
                    if(ResourceSaver.Save(mesh,$"{output}/{id}_lod{lod}.res",ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException("Cannot save drain head "+id);
                }
                var collision=new List<Vector3>();
                var col=manifest.GetProperty("files").EnumerateObject().Single(f=>f.Name.Contains("_"+id+"_collision"));
                foreach(var obj in RuienGlb.Read(Path.Combine(source,col.Name)))
                    foreach(var p in obj.Prims)
                        foreach(int index in p.Idx)collision.Add(p.Pos[index]);
                if(ResourceSaver.Save(new ConcavePolygonShape3D{Data=collision.ToArray(),BackfaceCollision=true},$"{output}/{id}_collision.res",ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException("Cannot save drain collision "+id);
                GD.Print($"DRAIN KIT INTAKE {id}: {collision.Count/3} collision triangles");
            }
            File.WriteAllText(Path.Combine(output,"templates.json"),templates.GetRawText()+"\n");
            GD.Print("DRAIN KIT INTAKE PASS");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
