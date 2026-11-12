using System;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

public partial class RuienFoldBridge
{
    private const string ModelCacheKind = "fold-bridge-model-v1:";
    // Only immutable meshes are packed; live hinges, collision and server state remain in Make().
    // RuienGeometryCache includes construction code, the complete area manifest and its kit settings.
    private static Model CachedModel(string key, Func<Model> draw)
    {
        using var timing = Dev.StartupTiming.Measure("ruien.bridge-model.cache");
        if (Main.I?.Flag("no-startup-cache") == true || Main.I?.Flag("uncached-bridge-models") == true) return draw();
        Node3D? instance = null;
        try
        {
            var packed = RuienGeometryCache.Get(RuienData.AreasFile, ModelCacheKind + key, () =>
            {
                var model = draw();
                var root = new Node3D { Name = "bridge_model" };
                try
                {
                    void Group(string name, Mesh[] meshes)
                    {
                        var group = new Node3D { Name = name };
                        root.AddChild(group); group.Owner = root;
                        for (int i = 0; i < meshes.Length; i++)
                        {
                            var node = new MeshInstance3D { Name = "mesh_" + i, Mesh = meshes[i] };
                            group.AddChild(node); node.Owner = root;
                        }
                    }
                    Group("leaf_a", model.LeafA); Group("leaf_b", model.LeafB); Group("fixed", model.Fixed);
                    var scene = new PackedScene();
                    if (scene.Pack(root) != Error.Ok) throw new InvalidOperationException("Cannot pack folding bridge model");
                    return scene;
                }
                finally { root.Free(); }
            });
            using (Dev.StartupTiming.Measure("ruien.bridge-model.instantiate")) instance = packed.Instantiate<Node3D>();
            Mesh[] Read(string name)
            {
                var meshes = instance.GetNode<Node3D>(name).GetChildren().OfType<MeshInstance3D>().Select(n => n.Mesh).ToArray();
                if (meshes.Length == 0) throw new InvalidOperationException("Missing folding bridge " + name);
                foreach (var mesh in meshes.OfType<ArrayMesh>())
                    for (int surface = 0; surface < mesh.GetSurfaceCount(); surface++)
                        if (mesh.SurfaceGetMaterial(surface) is {} material && material.ResourceName.StartsWith("ruien_", StringComparison.Ordinal))
                            mesh.SurfaceSetMaterial(surface, RuienMaterials.Get(material.ResourceName));
                return meshes;
            }
            return new Model(Read("leaf_a"), Read("leaf_b"), Read("fixed"));
        }
        catch (Exception e) { GD.Print("folding bridge cache: bypass: " + e.Message); return draw(); }
        finally { instance?.Free(); }
    }
}
