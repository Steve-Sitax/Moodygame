using System;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienEntrance
{
    // Only fixed masonry and its collision are packed. Doors and stair-house runoff keep their live Spec.
    internal static Node3D CachedStructure(Spec spec) => Cached("entrance:", spec, () => BuildStructure(spec));

    /// <summary>A node tree made only from a Spec, kept as a packed scene under the Spec's whole identity.</summary>
    internal static Node3D Cached(string kind, Spec spec, Func<Node3D> build)
    {
        if(Main.I.Flag("no-startup-cache"))return build();
        using var cacheTrace=Dev.StartupTiming.Split("ruien.entrance-cache."+kind+spec.Id);
        Node3D? result=null;
        try
        {
        string identity=JsonSerializer.Serialize(spec,new JsonSerializerOptions{IncludeFields=true,IgnoreReadOnlyProperties=true});
        if(kind=="entrance:"&&RuienPassage.CeilingSource(spec) is {} ceiling)
            identity+="\nhost-ceiling:"+ceiling+":"+RuienGeometryCache.ContentHash(ceiling);
        var packed=RuienGeometryCache.Get(File,kind+identity,()=>
        {
            var root=build();
            try
            {
                foreach(var node in BakedWorld.All(root).Where(n=>n!=root))node.Owner=root;
                var scene=new PackedScene();
                if(scene.Pack(root)!=Error.Ok)throw new InvalidOperationException("Cannot pack "+kind+" "+spec.Id);
                return scene;
            }
            finally {root.Free();}
        });
        cacheTrace?.Next("load");
        result=packed.Instantiate<Node3D>();
        cacheTrace?.Next("instantiate");
        // Reconnect shared live materials: live editing and the current lighting still reach every cached surface.
        foreach(var node in BakedWorld.All(result).OfType<MeshInstance3D>())
            if(node.Mesh is ArrayMesh mesh)
                for(int surface=0;surface<mesh.GetSurfaceCount();surface++)
                    if(mesh.SurfaceGetMaterial(surface) is { } material && material.ResourceName.StartsWith("ruien_",StringComparison.Ordinal))
                        mesh.SurfaceSetMaterial(surface,RuienMaterials.Get(material.ResourceName));
        cacheTrace?.Next("materials");
        return result;
        }
        catch(Exception e){result?.Free();GD.Print(kind+" cache: bypass: "+e.Message);return build();}
    }
}
