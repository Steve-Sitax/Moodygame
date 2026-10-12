using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Recovery;

/// <summary>A small GLB with nested transforms, hidden geometry, coloured instances and unused invalid image data.</summary>
public static class RecoveryFixture
{
    public static void Write(string directory, string id)
    {
        Directory.CreateDirectory(directory);
        var positions = new float[] { 0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1 };
        var indices = new ushort[] { 0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 3,7,6, 3,6,2, 1,2,6, 1,6,5, 0,4,7, 0,7,3 };
        using var bin = new MemoryStream(); using var writer = new BinaryWriter(bin, Encoding.UTF8, true);
        foreach (float f in positions) writer.Write(f);
        foreach (ushort i in indices) writer.Write(i);
        writer.Write(0xdeadbeefu);
        JsonObject Node(string name, Transform3D transform, int? mesh = null, params int[] children)
        {
            var node = new JsonObject { ["name"] = name, ["matrix"] = RecoveryGlb.Matrix(transform) };
            if (mesh != null) node["mesh"] = mesh.Value;
            if (children.Length > 0) node["children"] = new JsonArray(children.Select(c => JsonValue.Create(c)).ToArray());
            return node;
        }
        Transform3D Pose(Vector3 origin) => new(Basis.Identity, origin);
        var hidden = Node("hidden-child", Pose(new(0.25f, 2, 0)), 0); hidden["extras"] = new JsonObject { ["hidden"] = true, ["kept"] = "hidden metadata" };
        var material = new JsonObject { ["pbrMetallicRoughness"] = new JsonObject { ["metallicFactor"] = 0, ["roughnessFactor"] = 1 },
            ["extras"] = new JsonObject { ["three"] = new JsonObject { ["type"] = "MeshLambertMaterial", ["side"] = 2, ["visible"] = true, ["colorWrite"] = true }, ["psx"] = new JsonObject { ["bake"] = new JsonObject { ["wet"] = true } } } };
        JsonObject Primitive(int mat) => new() { ["attributes"] = new JsonObject { ["POSITION"] = 0 }, ["indices"] = 1, ["material"] = mat };
        var json = new JsonObject {
            ["asset"] = new JsonObject { ["version"] = "2.0" }, ["scene"] = 0,
            ["scenes"] = new JsonArray(new JsonObject { ["nodes"] = new JsonArray(0, 6, 8) }),
            ["nodes"] = new JsonArray(
                Node("fixture-group", Pose(new(3,0,4)), null, 1,4,5),
                Node("frame", new(new Basis(Vector3.Up, Mathf.Pi / 2), new(1,0,2)), null, 2,3),
                Node("solid-child", Pose(new(0.25f,0,0)), 0), hidden,
                Node("INST_fixture", Pose(new(1,0,1)), 0),
                Node("ground_fixture", new(Basis.Identity.Scaled(new(14,0.5f,14)), new(-2,-0.5f,-2)), 0),
                Node("bollard", Pose(new(8,0,8)), null, 7), Node("bollard-shape", Transform3D.Identity, 0),
                Node("outside", Pose(new(200,0,200)), 1)),
            ["meshes"] = new JsonArray(new JsonObject { ["primitives"] = new JsonArray(Primitive(0)) }, new JsonObject { ["primitives"] = new JsonArray(Primitive(1)) }),
            ["materials"] = new JsonArray(material, new JsonObject { ["pbrMetallicRoughness"] = new JsonObject { ["baseColorTexture"] = new JsonObject { ["index"] = 0 } } }),
            ["textures"] = new JsonArray(new JsonObject { ["source"] = 0 }), ["images"] = new JsonArray(new JsonObject { ["bufferView"] = 2, ["mimeType"] = "image/png" }),
            ["accessors"] = new JsonArray(new JsonObject { ["bufferView"] = 0, ["componentType"] = 5126, ["count"] = 8, ["type"] = "VEC3", ["min"] = new JsonArray(0,0,0), ["max"] = new JsonArray(1,1,1) },
                new JsonObject { ["bufferView"] = 1, ["componentType"] = 5123, ["count"] = 36, ["type"] = "SCALAR" }),
            ["bufferViews"] = new JsonArray(new JsonObject { ["buffer"] = 0, ["byteOffset"] = 0, ["byteLength"] = 96 },
                new JsonObject { ["buffer"] = 0, ["byteOffset"] = 96, ["byteLength"] = 72 }, new JsonObject { ["buffer"] = 0, ["byteOffset"] = 168, ["byteLength"] = 4 }),
            ["buffers"] = new JsonArray(new JsonObject { ["byteLength"] = bin.Length }) };
        byte[] text = Encoding.UTF8.GetBytes(json.ToJsonString()); int padded = (text.Length + 3) & ~3;
        using (var file = new BinaryWriter(File.Create(Path.Combine(directory, "fixture.glb"))))
        {
            file.Write(0x46546c67u); file.Write(2u); file.Write((uint)(28 + padded + bin.Length)); file.Write(padded); file.Write(0x4e4f534au); file.Write(text);
            for (int i = text.Length; i < padded; i++) file.Write((byte)32);
            file.Write((uint)bin.Length); file.Write(0x004e4942u); file.Write(bin.ToArray());
        }
        File.WriteAllText(Path.Combine(directory, "fixture.json"), new JsonObject { ["made"] = "test fixture", ["instances"] = new JsonObject {
            ["INST_fixture"] = new JsonObject { ["count"] = 2, ["m"] = new JsonArray(RecoveryGlb.Matrix(Pose(Vector3.Zero)).Concat(RecoveryGlb.Matrix(Pose(new(40,0,0)))).Select(n => n!.DeepClone()).ToArray()), ["c"] = new JsonArray(1,0,0, 0,1,0) } } }.ToJsonString());
        File.WriteAllText(Path.Combine(directory, "plan.json"), new JsonObject { ["id"] = id, ["title"] = "Recovery fixture", ["bounds"] = new JsonArray(0,0,16,16),
            ["walkSpawn"] = new JsonArray(12,0.02f,12), ["flySpawn"] = new JsonArray(8,8,14), ["flyYaw"] = 0, ["flyPitch"] = -0.45f,
            ["groups"] = new JsonArray("fixture-group"), ["props"] = new JsonArray("bollard"), ["roots"] = new JsonArray() }.ToJsonString());
    }
}
