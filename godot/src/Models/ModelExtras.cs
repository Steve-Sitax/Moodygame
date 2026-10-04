using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace Scheldemist.Models;

/// <summary>Read public model metadata once. The Godot model loader and the browser share these GLB extras.</summary>
public static class ModelExtras
{
    private static readonly Dictionary<string,Dictionary<string,JsonElement>> files=new();
    public static JsonElement? Get(string file,string node,string key)
    {
        if(!files.TryGetValue(file,out var nodes))
        {
            nodes=new();files[file]=nodes;string path=Path.Combine(ModelLibrary.Dir,file+".glb");if(!File.Exists(path))return null;
            using var read=new BinaryReader(File.OpenRead(path));if(read.ReadUInt32()!=0x46546c67)return null;read.ReadUInt32();read.ReadUInt32();int len=read.ReadInt32();if(read.ReadUInt32()!=0x4e4f534a)return null;
            using var doc=JsonDocument.Parse(read.ReadBytes(len));foreach(var n in doc.RootElement.GetProperty("nodes").EnumerateArray())if(n.TryGetProperty("name",out var name)&&n.TryGetProperty("extras",out var extra))nodes[name.GetString()!]=extra.Clone();
        }
        if(!nodes.TryGetValue(node,out var ex)||!ex.TryGetProperty(key,out var value))return null;
        if(value.ValueKind!=JsonValueKind.String)return value;
        try{using var parsed=JsonDocument.Parse(value.GetString()!);return parsed.RootElement.Clone();}catch(JsonException){return value;}
    }
}
