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
    private static Shader? shader;
    private static ShaderMaterial? sharedMaterial;
    private static readonly List<Texture2DArray> arrays = new();
    private static readonly Dictionary<string, (int Clothes, int Face)> pictures = new();
    internal static long TextureBytes { get; private set; }
    internal static long ProjectionBytes { get; private set; }
    private static long layerBytes, detailBytes;
    internal static ulong GpuBefore { get; private set; }
    internal static ulong GpuAfter { get; private set; }
    internal static void Forget()
    {
        pictures.Clear(); sharedMaterial?.Dispose(); sharedMaterial = null;
        foreach (var array in arrays) array.Dispose(); arrays.Clear();
        shader?.Dispose(); shader = null; TextureBytes = ProjectionBytes = layerBytes = detailBytes = 0;
    }
    private const string PictureRoot = "res://assets/people2-pictures/";
    private static Texture2DArray Layers(System.Text.Json.JsonElement names, string suffix)
    {
        var images = new Godot.Collections.Array<Image>();
        foreach (var name in names.EnumerateArray())
        {
            using var texture = ResourceLoader.Load<Texture2D>(PictureRoot + name.GetString() + suffix + ".png");
            var image = texture.GetImage();
            if (!image.IsCompressed() || !image.HasMipmaps())
                throw new InvalidDataException("People pictures require imported GPU compression and mipmaps: " + name);
            var expected = suffix.EndsWith("normal", StringComparison.Ordinal) ? Image.Format.RgtcRg : Image.Format.BptcRgba;
            if (image.GetFormat() != expected) throw new InvalidDataException("People picture format must be " + expected + ": " + name);
            long bytes = image.GetData().LongLength;
            TextureBytes += bytes;
            if (image.GetWidth() == 1024) layerBytes = bytes;
            else if (image.GetWidth() == 512) detailBytes += bytes;
            else throw new InvalidDataException("People picture size: " + name);
            if (images.Count == 0) GD.Print($"people2 array {suffix}: {image.GetWidth()}px {image.GetFormat()}, mipmaps={image.GetMipmapCount()}, bytes/layer={image.GetData().LongLength}");
            images.Add(image);
        }
        var result = new Texture2DArray();
        var error = result.CreateFromImages(images);
        foreach (var image in images) image.Dispose();
        if (error != Error.Ok) throw new InvalidDataException("People texture array: " + error);
        arrays.Add(result);
        return result;
    }
    internal static void Assign(Node3D root, string body)
    {
        if (!pictures.TryGetValue(body, out var entry)) return;
        root.SetMeta("picture_body", body);
        foreach (var n in BakedWorld.All(root))
            if (n is MeshInstance3D mi)
            {
                mi.SetInstanceShaderParameter("clothes_layer", entry.Clothes);
                mi.SetInstanceShaderParameter("face_layer", entry.Face);
                mi.SetInstanceShaderParameter("skin_tone_shift", Vector3.Zero);
            }
    }
    internal static void Tone(Node3D root, uint seed)
    {
        if (!root.HasMeta("picture_body")) return;
        float shift = ((seed >> 16) % 101 / 100f - .5f) * .06f;
        foreach (var n in BakedWorld.All(root))
            if (n is MeshInstance3D mi) mi.SetInstanceShaderParameter("skin_tone_shift", new Vector3(shift, shift * .75f, shift * .6f));
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
        using var manifest = System.Text.Json.JsonDocument.Parse(Godot.FileAccess.GetFileAsString(PictureRoot + "manifest.json"));
        var data = manifest.RootElement;
        foreach (var entry in data.GetProperty("entries").EnumerateObject())
            pictures[entry.Name] = (entry.Value.GetProperty("clothes").GetInt32(), entry.Value.GetProperty("face").GetInt32());
        var material = sharedMaterial = new ShaderMaterial { Shader = shader, ResourceName = "people2_pictures" };
        material.SetShaderParameter("clothes_colour", Layers(data.GetProperty("clothes"), "_colour"));
        material.SetShaderParameter("clothes_normal", Layers(data.GetProperty("clothes"), "_normal"));
        material.SetShaderParameter("face_colour", Layers(data.GetProperty("faces"), "_face_colour"));
        material.SetShaderParameter("face_normal", Layers(data.GetProperty("faces"), "_face_normal"));
        material.SetShaderParameter("detail_colour", Layers(data.GetProperty("detail"), "_colour"));
        material.SetShaderParameter("detail_normal", Layers(data.GetProperty("detail"), "_normal"));
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
                mi.Mesh.SurfaceSetMaterial(s, material);
            }
            People2Faces.EyeFlags(mi);
        }
        var result = new ModelLibrary.Model { Name = "people2", Scene = scene, Materials = 1 };
        foreach (var c in scene.GetChildren())
            if (c is AnimationPlayer ap)
            {
                foreach (var lib in ap.GetAnimationLibraryList())
                    foreach (var name in ap.GetAnimationLibrary(lib).GetAnimationList()) result.Clips[name] = ap.GetAnimationLibrary(lib).GetAnimation(name);
            }
            else if (c is Node3D root) result.Roots[root.Name] = root;
        foreach (var root in result.Roots) Assign(root.Value, root.Key);
        result.LoadMs = (Time.GetTicksUsec() - start) / 1000.0;
        ProjectionBytes = (61 + 10 + 1 + 32) * 2 * layerBytes + detailBytes;
        if (ProjectionBytes >= 300_000_000) throw new InvalidDataException("People picture projection exceeds 300 MB.");
        GpuAfter = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TextureMemUsed);
        GD.Print($"people2 textures: {TextureBytes} bytes; GPU before/after import {GpuBefore}/{GpuAfter}");
        return result;
    }
}
