using System;
using System.IO;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.Native.World;

/// <summary>Externalize the shared resource graph once, including arrays, skins and animations.</summary>
public sealed class NativeResourceStore
{
    private readonly string output;
    private readonly HashSet<ulong> seen = new();
    public int Count { get; private set; }
    public NativeResourceStore(string output)
    {
        this.output = output; Directory.CreateDirectory(ProjectSettings.GlobalizePath(output));
    }
    private void Visit(Variant value)
    {
        if (value.VariantType == Variant.Type.Object && value.AsGodotObject() is Resource resource) Save(resource);
        else if (value.VariantType == Variant.Type.Array) foreach (var item in value.AsGodotArray()) Visit(item);
        else if (value.VariantType == Variant.Type.Dictionary) foreach (var item in value.AsGodotDictionary().Values) Visit(item);
    }
    public void Save(Resource resource)
    {
        if (resource.ResourcePath.StartsWith("res://") || !seen.Add(resource.GetInstanceId())) return;
        if (resource is Shader shader && Psx.KindOf(shader) is { } kind)
            shader.SetMeta("native_psx_kind", JsonSerializer.Serialize(kind));
        foreach (var property in resource.GetPropertyList())
        {
            if ((property["usage"].AsInt64() & (long)PropertyUsageFlags.Storage) == 0) continue;
            string name = property["name"].AsString();
            if (name is "script" or "resource_path") continue;
            Visit(resource.Get(name));
        }
        string path = output + "/r" + Count++.ToString("D6") + ".res";
        resource.TakeOverPath(path);
        if (ResourceSaver.Save(resource, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException("Cannot store " + path);
    }
    public void Scene(Node root, string path)
    {
        foreach (var node in Scheldemist.World.BakedWorld.All(root))
        {
            if (node != root) node.Owner = root;
            foreach (var property in node.GetPropertyList())
            {
                if ((property["usage"].AsInt64() & (long)PropertyUsageFlags.Storage) == 0) continue;
                string name = property["name"].AsString(); if (name is "script" or "owner") continue;
                Visit(node.Get(name));
            }
        }
        using var scene = new PackedScene();
        if (scene.Pack(root) != Error.Ok || ResourceSaver.Save(scene, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException("Cannot pack " + path);
    }
}
