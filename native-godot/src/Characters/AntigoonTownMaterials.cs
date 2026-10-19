using Godot;
using System;
using System.Collections.Generic;
using System.Linq;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Native.Characters;

/// <summary>Keep the character's baked maps while using the town's sky, occlusion, lamps and fog.</summary>
public static class AntigoonTownMaterials
{
    private static Shader? shader;
    private static readonly Psx.Kind Kind=new(false,false,false,false,true,false,0,false,false,true);
    public static void Apply(Node model)
    {
        var converted=new Dictionary<Material,Material>();
        foreach(var mesh in model.FindChildren("*","MeshInstance3D",true,false).OfType<MeshInstance3D>())
        {
            // Reuse the Ruien's existing nearby lamp pool for this dynamic body as well as the player's body.
            mesh.Layers |= Scheldemist.Player.Arms.BodyLayer;
            for(int i=0;i<(mesh.Mesh?.GetSurfaceCount()??0);i++)
            {
                if(mesh.Mesh!.SurfaceGetMaterial(i) is not BaseMaterial3D source)continue;
                if(!converted.TryGetValue(source,out var result))converted[source]=result=Convert(source);
                mesh.SetSurfaceOverrideMaterial(i,result);
            }
        }
    }
    public static ShaderMaterial Convert(BaseMaterial3D source)
    {
        if(shader==null)
        {
            string code=Psx.ShaderOf(Kind).Code;
            const string normal="vec3 n_flat = NORMAL;",diffuse="DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR / PI;";
            if(!code.Contains(normal)||!code.Contains(diffuse))throw new InvalidOperationException("Review Antigoon's native lighting hooks.");
            code=code.Replace("void vertex() {",@"
uniform sampler2D character_normal : hint_normal, filter_linear_mipmap_anisotropic;
uniform sampler2D character_rough : hint_default_white, filter_linear_mipmap_anisotropic;
uniform sampler2D character_metal : hint_default_white, filter_linear_mipmap_anisotropic;
uniform bool character_has_normal = false;
uniform float character_normal_scale = 1.0;
uniform float character_roughness = 0.8;
uniform float character_metallic = 0.0;
uniform vec4 character_rough_channel = vec4(1,0,0,0);
uniform vec4 character_metal_channel = vec4(1,0,0,0);
varying float character_r;
varying vec3 character_f0;
void vertex() {");
            code=code.Replace(normal,@"
if(character_has_normal) {
    vec3 detail=texture(character_normal,uv).xyz*2.0-1.0;
    detail.xy*=character_normal_scale;
    NORMAL=normalize(TANGENT*detail.x+BINORMAL*detail.y+NORMAL*detail.z);
}
character_r=clamp(character_roughness*dot(texture(character_rough,uv),character_rough_channel),0.08,1.0);
float metal=clamp(character_metallic*dot(texture(character_metal,uv),character_metal_channel),0.0,1.0);
character_f0=mix(vec3(0.04),c.rgb,metal);
vec3 n_flat = NORMAL;");
            code=code.Replace(diffuse,diffuse+@"
vec3 half_vector=normalize(LIGHT+VIEW);
float exponent=max(2.0,2.0/pow(character_r,4.0)-2.0);
vec3 fresnel=character_f0+(1.0-character_f0)*pow(1.0-max(dot(VIEW,half_vector),0.0),5.0);
SPECULAR_LIGHT+=a*LIGHT_COLOR*max(dot(NORMAL,LIGHT),0.0)*fresnel*(exponent+2.0)/(8.0*PI)*pow(max(dot(NORMAL,half_vector),0.0),exponent);");
            shader=new Shader{Code=code};
        }
        var material=BakedWorld.PsxMaterial(source,Kind,0,1);material.Shader=shader;
        material.SetShaderParameter("character_has_normal",source.NormalEnabled&&source.NormalTexture!=null);
        material.SetShaderParameter("character_normal_scale",source.NormalScale);
        material.SetShaderParameter("character_roughness",source.Roughness);
        material.SetShaderParameter("character_metallic",source.Metallic);
        material.SetShaderParameter("character_rough_channel",Channel(source.RoughnessTextureChannel));
        material.SetShaderParameter("character_metal_channel",Channel(source.MetallicTextureChannel));
        if(source.NormalTexture is {} normalMap)material.SetShaderParameter("character_normal",BakedWorld.Mipmapped(normalMap));
        if(source.RoughnessTexture is {} rough)material.SetShaderParameter("character_rough",BakedWorld.Mipmapped(rough));
        if(source.MetallicTexture is {} metal)material.SetShaderParameter("character_metal",BakedWorld.Mipmapped(metal));
        return material;
    }
    private static Vector4 Channel(BaseMaterial3D.TextureChannel channel)=>channel switch {
        BaseMaterial3D.TextureChannel.Green=>new(0,1,0,0),BaseMaterial3D.TextureChannel.Blue=>new(0,0,1,0),
        BaseMaterial3D.TextureChannel.Alpha=>new(0,0,0,1),BaseMaterial3D.TextureChannel.Grayscale=>new(1f/3,1f/3,1f/3,0),_=>new(1,0,0,0)};
}
