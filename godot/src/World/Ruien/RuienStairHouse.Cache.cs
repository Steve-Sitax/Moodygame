using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienStairHouse
{
    internal const string HeightTexture="res://assets/materials/environment-20261013/wall-brick-height-texture.res";

    private static Made CachedShell(RuienEntrance.Spec spec,string dimensions)
    {
        using var timing=Dev.StartupTiming.Measure("ruien.stair-house-shell");
        // The cache hashes the sampled height texture, dimensions, construction
        // sources and entrance inputs. Rebind materials to the current town below.
        // The comparison switch retains the identical uncached construction path.
        bool comparison=Main.I?.Flag("no-stair-house-cache")==true;
        var mesh=comparison?Make(spec):RuienGeometryCache.Get(HeightTexture,"stair-house-mesh:"+dimensions,()=>Make(spec));
        var (brick,stone,slate,iron,wood)=ShellMaterials();
        for(int i=0;i<mesh.GetSurfaceCount();i++)
            mesh.SurfaceSetMaterial(i,mesh.SurfaceGetName(i) switch
            {
                "house_brick" or "house_brick_relief"=>brick,
                "house_bluestone"=>stone,"house_slate"=>slate,
                "house_iron"=>iron,"house_boarding"=>wood,
                _=>mesh.SurfaceGetMaterial(i)
            });
        ConcavePolygonShape3D Collision()=>new(){Data=mesh.GetFaces(),BackfaceCollision=true};
        var shape=comparison?Collision():RuienGeometryCache.Get(HeightTexture,"stair-house-collision:"+dimensions,Collision);
        return new Made(mesh,shape);
    }

    private static (Material Brick,Material Stone,Material Slate,Material Iron,Material Wood) ShellMaterials()
    {
        var brick=(ShaderMaterial)ResourceLoader.Load<Material>(BrickMaterial).Duplicate();
        brick.SetShaderParameter("relief_depth",0f);
        brick.SetShaderParameter("foot",1f);brick.SetShaderParameter("foot_wear",1f);
        var stone=(ShaderMaterial)ResourceLoader.Load<Material>(StoneMaterial).Duplicate();
        stone.SetShaderParameter("foot",.6f);stone.SetShaderParameter("foot_wear",1f);
        return(brick,stone,ResourceLoader.Load<Material>(SlateMaterial),ResourceLoader.Load<Material>(IronMaterial),
            ResourceLoader.Load<Material>("res://assets/materials/town-facades-20261018/shutter-paint-worn.tres"));
    }
}
