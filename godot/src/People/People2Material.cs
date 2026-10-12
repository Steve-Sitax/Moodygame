using System;
using System.Collections.Generic;
using System.IO;
using Godot;
using Scheldemist.Models;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.People;

// Native scene loading keeps source normals and morphs before the ordinary material conversion.
internal static class People2Material
{
    private static readonly Dictionary<Texture2D, Texture2D> colours = new(), normals = new();
    private static Shader? shader;
    internal static long TextureBytes { get; private set; }
    internal static ulong GpuBefore { get; private set; }
    internal static ulong GpuAfter { get; private set; }
    internal static void Forget() { colours.Clear(); normals.Clear(); shader = null; TextureBytes = 0; }
    private static Texture2D Mips(Texture2D source, bool colour)
    {
        var cache = colour ? colours : normals;
        if (cache.TryGetValue(source, out var known)) return known;
        using var image = source.GetImage();
        if (image.IsCompressed()) image.Decompress();
        image.ClearMipmaps();
        image.Convert(Image.Format.Rgba8);
        if (colour)
        {
            byte[] pixels = image.GetData();
            var linear = new float[pixels.Length];
            var decode = new float[256];
            for (int i = 0; i < 256; i++)
            {
                float x = i / 255f;
                decode[i] = x <= 0.04045f ? x / 12.92f : MathF.Pow((x + 0.055f) / 1.055f, 2.4f);
            }
            for (int i = 0; i < pixels.Length; i++) linear[i] = i % 4 == 3 ? pixels[i] / 255f : decode[pixels[i]];
            var data = new byte[linear.Length * 4]; Buffer.BlockCopy(linear, 0, data, 0, data.Length);
            using var filtered = Image.CreateFromData(image.GetWidth(), image.GetHeight(), false, Image.Format.Rgbaf, data);
            filtered.GenerateMipmaps();
            data = filtered.GetData(); linear = new float[data.Length / 4]; Buffer.BlockCopy(data, 0, linear, 0, data.Length);
            pixels = new byte[linear.Length];
            for (int i = 0; i < linear.Length; i++)
            {
                float x = linear[i];
                if (i % 4 != 3) x = x <= 0.0031308f ? x * 12.92f : 1.055f * MathF.Pow(x, 1 / 2.4f) - 0.055f;
                pixels[i] = (byte)Math.Clamp((int)MathF.Round(x * 255), 0, 255);
            }
            image.SetData(image.GetWidth(), image.GetHeight(), true, Image.Format.Rgba8, pixels);
        }
        else image.GenerateMipmaps(true);
        TextureBytes += image.GetData().LongLength;
        var result = ImageTexture.CreateFromImage(image);
        cache[source] = result;
        return result;
    }
    internal static ModelLibrary.Model? Load()
    {
        if (!ModelLibrary.Available("people2") || ModelLibrary.NativeScene == null) return null;
        GpuBefore = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TextureMemUsed);
        ulong start = Time.GetTicksUsec();
        if (ModelLibrary.NativeScene("people2") is not { } scene) return null;
        Psx.EnsureGlobals();
        string code = Godot.FileAccess.GetFileAsString("res://shaders/people2.gdshader");
        shader = new Shader { Code = code.Replace("/*SCATTER*/", Psx.LampScatterGlsl).Replace("/*SPILL*/", Psx.SpillGlsl
            .Replace("max(dot(N, -d / max(dl, 1e-4)), 0.0)", "max((dot(N, -d / max(dl, 1e-4)) + 0.35) / 1.35, 0.0)")
            .Replace("max(dot(N, L1), 0.0)", "max((dot(N, L1) + 0.35) / 1.35, 0.0)")
            .Replace("max(dot(N, L2), 0.0)", "max((dot(N, L2) + 0.35) / 1.35, 0.0)")), ResourceName = "people2" };
        var made = new Dictionary<Material, Material>();
        var stripped = new Dictionary<Mesh, ArrayMesh>();
        foreach (var n in BakedWorld.All(scene))
        {
            if (n is not MeshInstance3D mi || mi.Mesh is not ArrayMesh source) continue;
            bool far = mi.Name.ToString().EndsWith("_lod1", StringComparison.Ordinal);
            if (far && source.GetBlendShapeCount() > 0)
            {
                if (!stripped.TryGetValue(source, out var mesh))
                {
                    mesh = new ArrayMesh();
                    for (int s = 0; s < source.GetSurfaceCount(); s++)
                    {
                        mesh.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), source.SurfaceGetArrays(s));
                        mesh.SurfaceSetMaterial(s, source.SurfaceGetMaterial(s));
                    }
                    stripped[source] = mesh;
                }
                mi.Mesh = mesh;
            }
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            {
                var old = mi.Mesh.SurfaceGetMaterial(s);
                if (old is not BaseMaterial3D bm) continue;
                if (!made.TryGetValue(old, out var material))
                {
                    var m = new ShaderMaterial { Shader = shader, ResourceName = "people2_" + bm.ResourceName };
                    m.SetShaderParameter("albedo", bm.AlbedoColor);
                    if (bm.AlbedoTexture is { } tex) m.SetShaderParameter("tex", Mips(tex, true));
                    if (bm.NormalTexture is { } normal) m.SetShaderParameter("skin_normal", Mips(normal, false));
                    else m.SetShaderParameter("normal_strength", 0f);
                    m.SetShaderParameter("alpha_cut", bm.Transparency == BaseMaterial3D.TransparencyEnum.AlphaScissor ? bm.AlphaScissorThreshold : 0f);
                    // Current kit has white vertex colours. Source eye bones provide an interim mask at load.
                    m.SetShaderParameter("eye_vertex_flag", 1f);
                    made[old] = material = m;
                }
                mi.Mesh.SurfaceSetMaterial(s, material);
            }
            People2Faces.EyeFlags(mi);
        }
        var result = new ModelLibrary.Model { Name = "people2", Scene = scene, Materials = made.Count };
        foreach (var c in scene.GetChildren())
            if (c is AnimationPlayer ap)
            {
                foreach (var lib in ap.GetAnimationLibraryList())
                    foreach (var name in ap.GetAnimationLibrary(lib).GetAnimationList()) result.Clips[name] = ap.GetAnimationLibrary(lib).GetAnimation(name);
            }
            else if (c is Node3D root) result.Roots[root.Name] = root;
        colours.Clear(); normals.Clear();
        result.LoadMs = (Time.GetTicksUsec() - start) / 1000.0;
        GpuAfter = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TextureMemUsed);
        GD.Print($"people2 textures: {TextureBytes} bytes; GPU before/after import {GpuBefore}/{GpuAfter}");
        return result;
    }
}
