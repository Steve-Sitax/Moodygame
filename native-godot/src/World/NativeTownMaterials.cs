using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Game;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Gives the town's authored objects (lamps, bollards, benches ...) the game's own materials. The game draws its fog,
/// light and weather in its Psx shaders; an editor material (StandardMaterial3D, or a workshop ShaderMaterial) gets
/// none of that and stays sharp and black in mist. This is the same swap NativeGameWorld makes for the district slice.
/// No new shader kind per object: cast iron reuses NativeSurfaceMaterials, recovered materials use the game's own
/// material table, and anything else maps onto the few shared switch sets of BakedWorld.PsxMaterial.
/// </summary>
public sealed class NativeTownMaterials
{
    public static NativeTownMaterials Furniture {get;}=new();
    public void ApplyObject(Node root)
    {
        foreach(var mesh in BakedWorld.All(root).OfType<MeshInstance3D>())
        {
            if(mesh.Mesh!=null)Surfaces(mesh);
            if(mesh.MaterialOverride is {} material&&Swap(material,mesh) is {} made)mesh.MaterialOverride=made;
        }
    }
    private const string Table = "res://game/rijnkaai/materials.json";
    private readonly Dictionary<ulong, Mesh> meshes = new();
    private readonly Dictionary<ulong, Material> swapped = new();
    private Dictionary<int, ShaderMaterial>? game;
    /// <summary>Surfaces and overrides given a game material, and ones left as they were (unknown shaders).</summary>
    public int Swapped { get; private set; }
    public int Left { get; private set; }

    public void Apply(Node town)
    {
        foreach (var authored in BakedWorld.All(town).OfType<AuthoredObject>().ToArray())
            foreach (var mesh in BakedWorld.All(authored).OfType<MeshInstance3D>())
            {
                if (mesh.Mesh != null) Surfaces(mesh);
                if (mesh.MaterialOverride is { } over && Swap(over, mesh) is { } made) mesh.MaterialOverride = made;
            }
    }

    private void Surfaces(MeshInstance3D mesh)
    {
        var source = mesh.Mesh!;
        int count = source.GetSurfaceCount();
        Mesh? own = null;
        for (int i = 0; i < count; i++)
        {
            if (source.SurfaceGetMaterial(i) is not { } original || Swap(original, mesh) is not { } made) continue;
            // The mesh resource is shared by every copy of the object: swap on one private copy of it.
            if (own == null && !meshes.TryGetValue(source.GetInstanceId(), out own)) meshes[source.GetInstanceId()] = own = (Mesh)source.Duplicate();
            own.SurfaceSetMaterial(i, made);
        }
        if (own != null) mesh.Mesh = own;
    }

    private Material? Swap(Material original, MeshInstance3D mesh)
    {
        ulong id = original.GetInstanceId();
        if (swapped.TryGetValue(id, out var done)) return done;
        Material? made = null;
        if (original is ShaderMaterial shader)
        {
            if (shader.HasMeta("native_surface_kind") && shader.GetMeta("native_surface_kind").AsString() == "cast_iron") made = NativeSurfaceMaterials.CastIron(shader);
        }
        else if (original.HasMeta("legacy_material_index") && !original.HasMeta("native_gltf_material")
            && GameMaterials().TryGetValue(original.GetMeta("legacy_material_index").AsInt32(), out var recovered)) made = recovered;
        else if (original is BaseMaterial3D standard) made = FromStandard(standard, mesh);
        if (made == null) { Left++; return null; }
        Swapped++;
        return swapped[id] = made;
    }

    /// <summary>
    /// A plain editor material as one of the game's shared shader kinds. The lamp's glass and flame keep the names the
    /// game's own lamp glow looks for (World/Lights.cs FindGlass), so they colour with the air and fade in the fog.
    /// </summary>
    public static ShaderMaterial FromStandard(BaseMaterial3D standard, MeshInstance3D mesh)
    {
        string name = standard.ResourceName;
        if (name == "") name = mesh.Name.ToString() switch { "Head" => "glass", "Flame" => "flame", _ => "" };
        bool glow = name is "glass" or "flame";
        bool blend = NativeGameWorld.IsBlended(standard);
        var kind = new Psx.Kind(glow || standard.ShadingMode == BaseMaterial3D.ShadingModeEnum.Unshaded, blend,
            standard.Transparency == BaseMaterial3D.TransparencyEnum.AlphaScissor, standard.CullMode == BaseMaterial3D.CullModeEnum.Disabled,
            !blend, false, 0, standard.VertexColorUseAsAlbedo, false, true);
        var made = BakedWorld.PsxMaterial(standard, kind, 0, 1, alphaTest: standard.AlphaScissorThreshold);
        made.ResourceName = name;
        return made;
    }

    private Dictionary<int, ShaderMaterial> GameMaterials()
    {
        if (game != null) return game;
        game = new();
        var table = JsonNode.Parse(Godot.FileAccess.GetFileAsString(Table))!.AsObject();
        foreach (var row in table) game[int.Parse(row.Key)] = ResourceLoader.Load<ShaderMaterial>(row.Value!.GetValue<string>());
        return game;
    }
}
