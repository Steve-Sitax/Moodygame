using System.Collections.Generic;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Recovery;

/// <summary>StandardMaterial has one repeat switch; preserve glTF's independent axes explicitly.</summary>
public static class RecoverySampler
{
    private static readonly Dictionary<(int cull, bool blend), Shader> shaders = new();

    public static (int u, int v) Modes(JsonObject gltf, JsonNode material)
    {
        if (material["pbrMetallicRoughness"]?["baseColorTexture"]?["index"] is not { } index) return (10497, 10497);
        var texture = gltf["textures"]![index.GetValue<int>()]!;
        var sampler = texture["sampler"] is { } i ? gltf["samplers"]![i.GetValue<int>()] : null;
        return (sampler?["wrapS"]?.GetValue<int>() ?? 10497, sampler?["wrapT"]?.GetValue<int>() ?? 10497);
    }

    public static ShaderMaterial Create(BaseMaterial3D standard, int u, int v)
    {
        var key = ((int)standard.CullMode, standard.Transparency is BaseMaterial3D.TransparencyEnum.Alpha or BaseMaterial3D.TransparencyEnum.AlphaDepthPrePass or BaseMaterial3D.TransparencyEnum.AlphaHash);
        if (!shaders.TryGetValue(key, out var shader))
        {
            string code = ResourceLoader.Load<Shader>("res://shaders/recovered_sampler.gdshader").Code;
            code = code.Replace("cull_back", standard.CullMode switch { BaseMaterial3D.CullModeEnum.Disabled => "cull_disabled", BaseMaterial3D.CullModeEnum.Front => "cull_front", _ => "cull_back" });
            if (key.Item2) code = code.Replace("// ALPHA_OUTPUT", "ALPHA = paint.a * albedo_color.a;");
            shaders[key] = shader = new Shader { Code = code };
        }
        var made = new ShaderMaterial { Shader = shader, ResourceName = standard.ResourceName, RenderPriority = standard.RenderPriority };
        made.SetShaderParameter("albedo_tex", standard.AlbedoTexture);
        made.SetShaderParameter("albedo_color", standard.AlbedoColor);
        made.SetShaderParameter("emission_color", standard.EmissionEnabled ? standard.Emission * standard.EmissionEnergyMultiplier : Colors.Black);
        made.SetShaderParameter("uv_transform", new Vector4(standard.Uv1Scale.X, standard.Uv1Scale.Y, standard.Uv1Offset.X, standard.Uv1Offset.Y));
        made.SetShaderParameter("wrap_modes", new Vector2I(u, v));
        made.SetShaderParameter("use_vertex_color", standard.VertexColorUseAsAlbedo);
        made.SetShaderParameter("alpha_cut", standard.Transparency == BaseMaterial3D.TransparencyEnum.AlphaScissor ? standard.AlphaScissorThreshold : 0);
        made.SetShaderParameter("roughness", standard.Roughness);
        made.SetShaderParameter("metallic", standard.Metallic);
        foreach (var meta in standard.GetMetaList()) made.SetMeta(meta, standard.GetMeta(meta));
        made.SetMeta("legacy_sampler_modes", new Vector2I(u, v));
        return made;
    }
}
