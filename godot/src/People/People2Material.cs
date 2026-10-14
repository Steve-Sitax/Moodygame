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
    internal static long AnimalTextureBytes { get; private set; }
    private static Shader? shader;
    private static ShaderMaterial? sharedMaterial;
    private static readonly List<Texture2DArray> arrays = new();
    private static readonly Dictionary<string, (int Clothes, int Face)> pictures = new();
    private static readonly Dictionary<string, int> faceIds = new(StringComparer.Ordinal);
    internal static long TextureBytes { get; private set; }
    internal static long ProjectionBytes { get; private set; }
    private static long layerBytes, detailBytes;
    internal static ulong GpuBefore { get; private set; }
    internal static ulong GpuAfter { get; private set; }
    internal static void Forget()
    {
        Player.PlayerPalette.Forget();
        foreach (var texture in colours.Values) texture.Dispose();
        foreach (var texture in normals.Values) texture.Dispose();
        colours.Clear(); normals.Clear(); AnimalTextureBytes = 0;
        pictures.Clear(); faceIds.Clear(); bodyTones.Clear(); sharedMaterial?.Dispose(); sharedMaterial = null;
        foreach (var array in arrays) array.Dispose(); arrays.Clear();
        shader?.Dispose(); shader = null; TextureBytes = ProjectionBytes = layerBytes = detailBytes = 0;
    }
    /// <summary>The one skin shader (sun, sky, fog, lamp spill, normal maps, eye glints) for people2 and the animals.</summary>
    internal static Shader Skin()
    {
        if (shader != null) return shader;
        Psx.EnsureGlobals();
        string code = Godot.FileAccess.GetFileAsString("res://shaders/people2.gdshader");
        return shader = new Shader { Code = code.Replace("/*SCATTER*/", Psx.LampScatterGlsl).Replace("/*SPILL*/", Psx.SpillGlsl
            .Replace("max(dot(N, -d / max(dl, 1e-4)), 0.0)", "max((dot(N, -d / max(dl, 1e-4)) + 0.35) / 1.35, 0.0)")
            .Replace("max(dot(N, L1), 0.0)", "max((dot(N, L1) + 0.35) / 1.35, 0.0)")
            .Replace("max(dot(N, L2), 0.0)", "max((dot(N, L2) + 0.35) / 1.35, 0.0)")), ResourceName = "people2" };
    }
    /// <summary>A picture with linear-light mipmaps (colour) or renormalised ones (normals); cached until Forget.</summary>
    internal static Texture2D Mipmapped(Texture2D source, bool colour) => Mips(source, colour);
    internal static Texture2D PlayerMipmapped(Texture2D source) => Mips(source, true, false);
    private static Texture2D Mips(Texture2D source, bool colour, bool cacheResult = true)
    {
        var cache = colour ? colours : normals;
        if (cacheResult && cache.TryGetValue(source, out var known)) return known;
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
        AnimalTextureBytes += image.GetData().LongLength;
        var result = ImageTexture.CreateFromImage(image);
        if (cacheResult) cache[source] = result;
        return result;
    }
    private const string PictureRoot = "res://assets/people2-pictures/";
    private static Texture2DArray Layers(System.Text.Json.JsonElement names, string suffix)
    {
        var images = new Godot.Collections.Array<Image>();
        foreach (var name in names.EnumerateArray())
        {
            string path = PictureRoot + name.GetString() + suffix + ".png";
            if (!ResourceLoader.Exists(path)) throw new InvalidDataException("People2 picture is not imported: " + path + ". Run replace-people2.ps1 (Godot --editor --import) before --people2.");
            using var texture = ResourceLoader.Load<Texture2D>(path)
                ?? throw new InvalidDataException("People2 picture failed to load: " + path);
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
                mi.SetInstanceShaderParameter("body_tone", Vector3.One);
                bool baseBody = body.StartsWith("man_") || body.StartsWith("woman_") || body.StartsWith("child_") || (body.StartsWith("old_") && !body.EndsWith("_dressed", StringComparison.Ordinal));
                mi.SetInstanceShaderParameter("underwear_wear", baseBody ? 1f : 0f);
            }
    }
    private static readonly Dictionary<string, Vector3> bodyTones = new(StringComparer.Ordinal);
    /// <summary>A person's face picture (a layer of the face array, by its cell name) and the tone their body's skin
    /// takes to match it at the neck and the hands (faceTypes.json cells.bodyTone).</summary>
    internal static void Face(Node3D root, string cell)
    {
        if (!faceIds.TryGetValue(cell, out int layer)) return;
        if (bodyTones.Count == 0 && File.Exists(Paths.Shared("faceTypes.json")))
        {
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Paths.Shared("faceTypes.json")));
            foreach (var c in doc.RootElement.GetProperty("cells").EnumerateObject())
            {
                var t = c.Value.GetProperty("bodyTone");
                bodyTones[c.Name] = new Vector3(t[0].GetSingle(), t[1].GetSingle(), t[2].GetSingle());
            }
        }
        var tone = bodyTones.GetValueOrDefault(cell, Vector3.One);
        foreach (var n in BakedWorld.All(root))
            if (n is MeshInstance3D mi)
            {
                mi.SetInstanceShaderParameter("face_layer", layer);
                mi.SetInstanceShaderParameter("body_tone", tone);
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
        if (!ModelLibrary.Available("people2") || ModelLibrary.NativeScene == null)
        {
            if (People2.Enabled) throw new InvalidDataException("--people2 requires the imported native people2 scene and pictures. Run replace-people2.ps1.");
            return null;
        }
        GpuBefore = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TextureMemUsed);
        ulong start = Time.GetTicksUsec();
        if (ModelLibrary.NativeScene("people2") is not { } scene) throw new InvalidDataException("People2 native scene failed to load; --people2 cannot fall back to people.glb.");
        var shader = Skin();
        using var manifest = System.Text.Json.JsonDocument.Parse(Godot.FileAccess.GetFileAsString(PictureRoot + "manifest.json"));
        var data = manifest.RootElement;
        foreach (var entry in data.GetProperty("entries").EnumerateObject())
            pictures[entry.Name] = (entry.Value.GetProperty("clothes").GetInt32(), entry.Value.GetProperty("face").GetInt32());
        if (data.TryGetProperty("faceIds", out var ids))
            foreach (var id in ids.EnumerateObject()) if (id.Value.ValueKind == System.Text.Json.JsonValueKind.Number) faceIds[id.Name] = id.Value.GetInt32();
        var material = sharedMaterial = new ShaderMaterial { Shader = shader, ResourceName = "people2_pictures" };
        material.SetShaderParameter("clothes_colour", Layers(data.GetProperty("clothes"), "_colour"));
        material.SetShaderParameter("clothes_normal", Layers(data.GetProperty("clothes"), "_normal"));
        material.SetShaderParameter("face_colour", Layers(data.GetProperty("faces"), "_face_colour"));
        material.SetShaderParameter("face_normal", Layers(data.GetProperty("faces"), "_face_normal"));
        material.SetShaderParameter("detail_colour", Layers(data.GetProperty("detail"), "_colour"));
        material.SetShaderParameter("detail_normal", Layers(data.GetProperty("detail"), "_normal"));
        // Every people mesh keeps its sliders' moves in RAM (People2Faces, from the intake's morph file) and draws
        // without them: each person's sliders are baked into their own mesh once, at spawn.
        People2Faces.LoadMorphs();
        foreach (var n in BakedWorld.All(scene))
        {
            if (n is not MeshInstance3D mi || mi.Mesh is not ArrayMesh source) continue;
            for (int s = 0; s < source.GetSurfaceCount(); s++) source.SurfaceSetMaterial(s, material);
            People2Faces.Capture(mi);
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
    internal static void LoadPart(ModelLibrary.Model model, string rootName)
    {
        using var index = System.Text.Json.JsonDocument.Parse(Godot.FileAccess.GetFileAsString("res://assets/game-models/people2_parts.json"));
        string part = index.RootElement.GetProperty(rootName).GetString()!;
        if (ModelLibrary.NativeScene?.Invoke(part) is not { } scene)
            throw new InvalidDataException("Missing people model part: " + part);
        People2Faces.LoadMorphs(part);
        foreach (var n in BakedWorld.All(scene)) if (n is MeshInstance3D mi && mi.Mesh is ArrayMesh mesh)
        {
            for (int s = 0; s < mesh.GetSurfaceCount(); s++) mesh.SurfaceSetMaterial(s, sharedMaterial);
            People2Faces.Capture(mi);
        }
        foreach (var child in scene.GetChildren()) if (child is Node3D root)
        {
            foreach (var node in BakedWorld.All(root)) node.Owner = null;
            scene.RemoveChild(root); model.Scene.AddChild(root);
            model.Roots[root.Name] = root; Assign(root, root.Name);
        }
        scene.Free();
    }
}
