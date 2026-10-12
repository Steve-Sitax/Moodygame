using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Recovery;

/// <summary>Read-only, selective recovery of the old GLB. Only referenced buffers and images enter Godot.</summary>
public sealed class RecoveryGlb : IDisposable
{
    public sealed record Pick(int Index, string Name, string Kind, Transform3D Transform);
    public JsonObject Json { get; }
    public JsonObject Facts { get; }
    public List<Pick> Picks { get; } = new();
    public List<string> Notes { get; } = new();
    public Dictionary<int, int> NodeMap { get; private set; } = new();
    public Dictionary<int, int> MaterialMap { get; private set; } = new();
    private readonly FileStream source;
    private readonly long binaryOffset;
    private readonly long binaryLength;
    private readonly Dictionary<int, Transform3D> world = new();
    private readonly HashSet<int> visiting = new();
    private readonly Rect2 boundary;
    private JsonArray Table(string key) => Json[key]?.AsArray() ?? new JsonArray();
    private JsonObject At(string key, int index) => Table(key)[index]!.AsObject();

    public RecoveryGlb(string file, JsonObject facts, Rect2 bounds)
    {
        Facts = facts; boundary = bounds;
        source = new FileStream(file, FileMode.Open, System.IO.FileAccess.Read, FileShare.ReadWrite);
        try
        {
            using var reader = new BinaryReader(source, Encoding.UTF8, true);
            if (reader.ReadUInt32() != 0x46546c67 || reader.ReadUInt32() != 2 || reader.ReadUInt32() != source.Length)
                throw new InvalidDataException("Expected a complete GLB version 2 file.");
            int length = reader.ReadInt32();
            if (length <= 0 || length > 64 * 1024 * 1024 || reader.ReadUInt32() != 0x4e4f534a)
                throw new InvalidDataException("Invalid GLB JSON chunk.");
            Json = JsonNode.Parse(reader.ReadBytes(length))!.AsObject();
            binaryLength = reader.ReadUInt32();
            if (reader.ReadUInt32() != 0x004e4942 || source.Position + binaryLength > source.Length)
                throw new InvalidDataException("Invalid GLB binary chunk.");
            binaryOffset = source.Position;
            foreach (var scene in Table("scenes")) foreach (var root in scene!["nodes"]!.AsArray())
                Visit(root!.GetValue<int>(), Transform3D.Identity);
        }
        catch { source.Dispose(); throw; }
    }
    public void Dispose() => source.Dispose();
    public static Transform3D Transform(JsonObject node)
    {
        if (node["matrix"] is JsonArray matrix)
        {
            var v = matrix.Select(x => x!.GetValue<float>()).ToArray();
            if (v.Length != 16) throw new InvalidDataException("Invalid node matrix.");
            return new(new Basis(new(v[0], v[1], v[2]), new(v[4], v[5], v[6]), new(v[8], v[9], v[10])), new(v[12], v[13], v[14]));
        }
        Vector3 Vec(string key, Vector3 fallback) => node[key] is JsonArray a ? new(a[0]!.GetValue<float>(), a[1]!.GetValue<float>(), a[2]!.GetValue<float>()) : fallback;
        var q = node["rotation"] as JsonArray;
        var rotation = q == null ? Quaternion.Identity : new Quaternion(q[0]!.GetValue<float>(), q[1]!.GetValue<float>(), q[2]!.GetValue<float>(), q[3]!.GetValue<float>());
        return new(new Basis(rotation).Scaled(Vec("scale", Vector3.One)), Vec("translation", Vector3.Zero));
    }
    public static JsonArray Matrix(Transform3D t) => new(t.Basis.X.X, t.Basis.X.Y, t.Basis.X.Z, 0,
        t.Basis.Y.X, t.Basis.Y.Y, t.Basis.Y.Z, 0, t.Basis.Z.X, t.Basis.Z.Y, t.Basis.Z.Z, 0, t.Origin.X, t.Origin.Y, t.Origin.Z, 1);
    private void Visit(int index, Transform3D parent)
    {
        if (!visiting.Add(index)) throw new InvalidDataException("Cyclic node hierarchy.");
        var node = At("nodes", index); var pose = parent * Transform(node);
        if (!pose.IsFinite()) throw new InvalidDataException("Non-finite node transform.");
        if (world.TryGetValue(index, out var previous) && previous != pose) throw new InvalidDataException("A node has conflicting parents.");
        world[index] = pose;
        foreach (var child in node["children"]?.AsArray() ?? new JsonArray()) Visit(child!.GetValue<int>(), pose);
        visiting.Remove(index);
    }
    public IEnumerable<int> Descendants(int index)
    {
        yield return index;
        foreach (var child in At("nodes", index)["children"]?.AsArray() ?? new JsonArray())
            foreach (var descendant in Descendants(child!.GetValue<int>())) yield return descendant;
    }
    public JsonObject? Instances(int index) => Facts["instances"]?[At("nodes", index)["name"]?.GetValue<string>() ?? ""] as JsonObject;
    public Aabb? Bounds(int index)
    {
        Aabb? box = null;
        foreach (int child in Descendants(index))
        {
            var node = At("nodes", child);
            if (node["mesh"] == null) continue;
            foreach (var primitive in At("meshes", node["mesh"]!.GetValue<int>())["primitives"]!.AsArray())
            {
                var accessor = At("accessors", primitive!["attributes"]!["POSITION"]!.GetValue<int>());
                if (accessor["min"] is not JsonArray min || accessor["max"] is not JsonArray max) throw new InvalidDataException("Mesh lacks position bounds.");
                Vector3 V(JsonArray a) => new(a[0]!.GetValue<float>(), a[1]!.GetValue<float>(), a[2]!.GetValue<float>());
                var local = new Aabb(V(min), V(max) - V(min));
                if (Instances(child) is { } copies)
                {
                    int count = copies["count"]!.GetValue<int>(); var matrices = copies["m"]!.AsArray();
                    if (matrices.Count != count * 16) throw new InvalidDataException("Instance transform count mismatch.");
                    for (int k = 0; k < count; k++)
                    {
                        var m = new JsonArray(matrices.Skip(k * 16).Take(16).Select(n => n!.DeepClone()).ToArray());
                        var b = world[child] * Transform(new() { ["matrix"] = m }) * local;
                        if (Intersects(b)) box = box == null ? b : box.Value.Merge(b);
                    }
                }
                else { var b = world[child] * local; box = box == null ? b : box.Value.Merge(b); }
            }
        }
        return box;
    }
    private bool Intersects(Aabb box) => boundary.Intersects(new Rect2(box.Position.X, box.Position.Z, Math.Max(box.Size.X, 0.001f), Math.Max(box.Size.Z, 0.001f)), true);
    public void Select(JsonObject plan)
    {
        var groups = plan["groups"]!.AsArray().Select(n => n!.GetValue<string>()).ToHashSet();
        var props = plan["props"]!.AsArray().Select(n => n!.GetValue<string>()).ToHashSet();
        var roots = plan["roots"]!.AsArray().Select(n => n!.GetValue<string>()).ToHashSet();
        void Add(int i, string kind)
        {
            var node = At("nodes", i); string name = node["name"]?.GetValue<string>() ?? "unnamed";
            if (node["extras"]?["hidden"]?.GetValue<bool>() == true) { Notes.Add($"Hidden source root omitted from the static district: {i} {name}"); return; }
            if (Bounds(i) is not { } bounds || !Intersects(bounds)) return;
            if (Descendants(i).Any(j => At("nodes", j)["skin"] != null)) throw new InvalidDataException("Static recovery cannot import a skinned actor: " + name);
            if (Picks.Any(p => Descendants(p.Index).Contains(i))) return;
            Picks.Add(new(i, name, kind, world[i]));
        }
        for (int i = 0; i < Table("nodes").Count; i++)
        {
            var node = At("nodes", i); string name = node["name"]?.GetValue<string>() ?? "";
            if (groups.Contains(name)) foreach (var child in node["children"]?.AsArray() ?? new JsonArray())
            {
                int j = child!.GetValue<int>(); string childName = At("nodes", j)["name"]?.GetValue<string>() ?? "";
                Add(j, childName.StartsWith("ground_") ? "ground" : "scenery");
            }
            if (props.Contains(name)) Add(i, "prop");
            if (roots.Contains(name)) Add(i, "scenery");
        }
        if (Picks.Count == 0) throw new InvalidDataException("The recovery plan selected no geometry.");
    }

    public void WriteSlice(string file)
    {
        var needed = new Dictionary<string, HashSet<int>>();
        foreach (string key in new[] { "nodes", "meshes", "materials", "accessors", "textures", "images", "samplers", "bufferViews" }) needed[key] = new();
        foreach (var pick in Picks) foreach (int i in Descendants(pick.Index)) needed["nodes"].Add(i);
        foreach (int i in needed["nodes"]) if (At("nodes", i)["mesh"] is { } mesh) needed["meshes"].Add(mesh.GetValue<int>());
        foreach (int i in needed["meshes"]) foreach (var primitive in At("meshes", i)["primitives"]!.AsArray())
        {
            foreach (var value in primitive!["attributes"]!.AsObject()) needed["accessors"].Add(value.Value!.GetValue<int>());
            if (primitive["indices"] is { } indices) needed["accessors"].Add(indices.GetValue<int>());
            if (primitive["material"] is { } material) needed["materials"].Add(material.GetValue<int>());
            if (primitive["targets"] != null || primitive["extensions"] != null) throw new InvalidDataException("Morph or compressed meshes need a dedicated recovery path.");
        }
        foreach (int i in needed["accessors"])
        {
            var a = At("accessors", i);
            if (a["sparse"] != null || a["bufferView"] == null) throw new InvalidDataException("Sparse accessors are not supported by static recovery.");
            needed["bufferViews"].Add(a["bufferView"]!.GetValue<int>());
        }
        void TextureSlots(JsonNode? node, Action<JsonObject> action)
        {
            if (node is JsonObject obj) foreach (var pair in obj.ToArray())
            {
                if (pair.Key.EndsWith("Texture", StringComparison.Ordinal) && pair.Value is JsonObject texture && texture["index"] != null) action(texture);
                else TextureSlots(pair.Value, action);
            }
            else if (node is JsonArray arr) foreach (var child in arr) TextureSlots(child, action);
        }
        foreach (int i in needed["materials"]) TextureSlots(At("materials", i), t => needed["textures"].Add(t["index"]!.GetValue<int>()));
        foreach (int i in needed["textures"])
        {
            var texture = At("textures", i);
            if (texture["extensions"] != null) throw new InvalidDataException("Compressed textures need a dedicated recovery path.");
            needed["images"].Add(texture["source"]!.GetValue<int>());
            if (texture["sampler"] is { } sampler) needed["samplers"].Add(sampler.GetValue<int>());
        }
        foreach (int i in needed["images"])
        {
            var image = At("images", i);
            if (image["uri"] != null) throw new InvalidDataException("Recovery requires embedded images, not external paths.");
            needed["bufferViews"].Add(image["bufferView"]!.GetValue<int>());
        }
        var maps = needed.ToDictionary(p => p.Key, p => p.Value.Order().Select((old, index) => (old, index)).ToDictionary(x => x.old, x => x.index));
        NodeMap = maps["nodes"]; MaterialMap = maps["materials"];
        var output = new JsonObject { ["asset"] = Json["asset"]!.DeepClone(), ["scene"] = 0 };
        foreach (var table in maps) output[table.Key] = new JsonArray(table.Value.Keys.Select(i => At(table.Key, i).DeepClone()).ToArray());
        foreach (var pair in NodeMap)
        {
            var node = output["nodes"]![pair.Value]!.AsObject();
            node["name"] = "recover_" + pair.Key;
            node.Remove("camera"); node.Remove("extensions");
            if (node["mesh"] is { } mesh) node["mesh"] = maps["meshes"][mesh.GetValue<int>()];
            if (node["children"] is JsonArray children) node["children"] = new JsonArray(children.Select(c => JsonValue.Create(NodeMap[c!.GetValue<int>()])).ToArray());
            if (Picks.FirstOrDefault(p => p.Index == pair.Key) is { } pick)
            { node["matrix"] = Matrix(pick.Transform); node.Remove("translation"); node.Remove("rotation"); node.Remove("scale"); }
        }
        foreach (var mesh in output["meshes"]!.AsArray()) foreach (var primitive in mesh!["primitives"]!.AsArray())
        {
            foreach (var a in primitive!["attributes"]!.AsObject().ToArray()) primitive["attributes"]![a.Key] = maps["accessors"][a.Value!.GetValue<int>()];
            if (primitive["indices"] is { } indices) primitive["indices"] = maps["accessors"][indices.GetValue<int>()];
            if (primitive["material"] is { } material) primitive["material"] = MaterialMap[material.GetValue<int>()];
        }
        foreach (var material in output["materials"]!.AsArray()) TextureSlots(material, t => t["index"] = maps["textures"][t["index"]!.GetValue<int>()]);
        foreach (var texture in output["textures"]!.AsArray())
        {
            texture!["source"] = maps["images"][texture["source"]!.GetValue<int>()];
            if (texture["sampler"] is { } sampler) texture["sampler"] = maps["samplers"][sampler.GetValue<int>()];
        }
        foreach (var image in output["images"]!.AsArray()) image!["bufferView"] = maps["bufferViews"][image["bufferView"]!.GetValue<int>()];
        foreach (var accessor in output["accessors"]!.AsArray()) accessor!["bufferView"] = maps["bufferViews"][accessor["bufferView"]!.GetValue<int>()];
        using var bin = new MemoryStream();
        foreach (var pair in maps["bufferViews"])
        {
            var view = output["bufferViews"]![pair.Value]!;
            long offset = view["byteOffset"]?.GetValue<long>() ?? 0; int length = view["byteLength"]!.GetValue<int>();
            if (view["buffer"]!.GetValue<int>() != 0 || offset < 0 || length < 0 || offset + length > binaryLength) throw new InvalidDataException("Buffer view escapes the GLB binary chunk.");
            while (bin.Length % 4 != 0) bin.WriteByte(0);
            view["byteOffset"] = bin.Length; view["buffer"] = 0;
            source.Position = binaryOffset + offset; var bytes = new byte[length]; source.ReadExactly(bytes); bin.Write(bytes);
        }
        while (bin.Length % 4 != 0) bin.WriteByte(0);
        output["buffers"] = new JsonArray(new JsonObject { ["byteLength"] = bin.Length });
        output["scenes"] = new JsonArray(new JsonObject { ["nodes"] = new JsonArray(Picks.Select(p => JsonValue.Create(NodeMap[p.Index])).ToArray()) });
        // These are the only material extensions carried through. Node lights are replaced by native behavior.
        output["extensionsUsed"] = new JsonArray("KHR_materials_unlit", "KHR_texture_transform");
        byte[] json = Encoding.UTF8.GetBytes(output.ToJsonString()); int jsonLength = (json.Length + 3) & ~3;
        using var destination = new BinaryWriter(File.Create(file));
        destination.Write(0x46546c67u); destination.Write(2u); destination.Write(checked((uint)(28 + jsonLength + bin.Length)));
        destination.Write(jsonLength); destination.Write(0x4e4f534au); destination.Write(json);
        for (int i = json.Length; i < jsonLength; i++) destination.Write((byte)32);
        destination.Write(checked((uint)bin.Length)); destination.Write(0x004e4942u); destination.Write(bin.ToArray());
    }
}
