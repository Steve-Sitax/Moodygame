using System;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienStair
{
    // Cache only the completed stonework and collision. A working hatch always receives its current Way.
    internal static Node3D CachedBuild(RuienData.Way way,RuienData.Zone? gallery)
    {
        if(Main.I.Flag("no-startup-cache"))return Build(way,gallery);
        Node3D? result=null;
        try
        {
            var options=new JsonSerializerOptions{IncludeFields=true,IgnoreReadOnlyProperties=true};
            string identity=JsonSerializer.Serialize(way,options)+"\n"+JsonSerializer.Serialize(gallery,options);
            var packed=RuienGeometryCache.Get(RuienData.AreasFile,"stair:"+identity,()=>
            {
                var root=BuildStructure(way,gallery);
                try
                {
                    foreach(var node in BakedWorld.All(root).Where(n=>n!=root))node.Owner=root;
                    var scene=new PackedScene();
                    if(scene.Pack(root)!=Error.Ok)throw new InvalidOperationException("Cannot pack stair structure");
                    return scene;
                }
                finally{root.Free();}
            });
            result=packed.Instantiate<Node3D>();
            foreach(var node in BakedWorld.All(result).OfType<MeshInstance3D>())
                if(node.Mesh is ArrayMesh mesh)
                    for(int surface=0;surface<mesh.GetSurfaceCount();surface++)
                        if(mesh.SurfaceGetMaterial(surface) is {} material && material.ResourceName.StartsWith("ruien_",StringComparison.Ordinal))
                            mesh.SurfaceSetMaterial(surface,RuienMaterials.Get(material.ResourceName));
            if(!way.Retired)result.AddChild(new RuienHatch{Way=way});
            return result;
        }
        catch(Exception e){result?.Free();GD.Print("stair cache: bypass: "+e.Message);return Build(way,gallery);}
    }
}
