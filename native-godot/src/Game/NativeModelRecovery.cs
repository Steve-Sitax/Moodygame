using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.World;
using Scheldemist.Native.World;

namespace Scheldemist.Native.Game;

/// <summary>One-time model intake, retaining skeletons and clips in native PackedScenes.</summary>
public partial class NativeModelRecovery : Node
{
    public override void _Ready()
    {
        try
        {
            string source = WorkshopSession.Arg("source-models");
            string output = "res://assets/game-models";
            if (!Directory.Exists(source)) throw new DirectoryNotFoundException(source);
            bool resume = WorkshopSession.Arg("resume-intake") == "yes";
            if (Directory.Exists(ProjectSettings.GlobalizePath(output)) && !resume) throw new IOException("Keep existing native models; intake output already exists.");
            Directory.CreateDirectory(ProjectSettings.GlobalizePath(output));
            var manifest = resume ? JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(output + "/intake.json")))!.AsObject() : new JsonObject();
            string fullPath = ProjectSettings.GlobalizePath(output + "/full-intake.json");
            var full = File.Exists(fullPath) ? JsonNode.Parse(File.ReadAllText(fullPath))!.AsObject() : new JsonObject();
            string only = WorkshopSession.Arg("only");
            string[] names = only == "" ? new[] { "people", "props", "player", "crate", "clutter", "quaygoods", "lively" } : only.Split(',');
            if (names.Any(name => name.Length == 0 || name.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '_')))
                throw new ArgumentException("--only requires comma-separated model names.");
            foreach (string name in names)
            {
                string file = Path.Combine(source, name + ".glb");
                using var input = File.OpenRead(file);
                string sha = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
                if (File.Exists(ProjectSettings.GlobalizePath(output + "/" + name + ".scn")))
                {
                    if (manifest[name]?["sourceSha256"]?.GetValue<string>() != sha) throw new IOException("Existing native model came from another source: " + name);
                    continue; // Native edits remain authoritative; resuming never rewrites a stored scene.
                }
                // Preserve authored extras separately: Godot's importer does not retain every glTF extra.
                using var metadataInput = File.OpenRead(file);
                using var reader = new BinaryReader(metadataInput, Encoding.UTF8);
                if (reader.ReadUInt32() != 0x46546c67 || reader.ReadUInt32() != 2 || reader.ReadUInt32() != metadataInput.Length)
                    throw new InvalidDataException("Expected a complete GLB version 2 file.");
                int jsonLength = reader.ReadInt32();
                if (jsonLength <= 0 || jsonLength > 64 * 1024 * 1024 || reader.ReadUInt32() != 0x4e4f534a)
                    throw new InvalidDataException("Invalid GLB JSON chunk.");
                var json = JsonNode.Parse(reader.ReadBytes(jsonLength))!.AsObject();
                if (json["extensionsRequired"]?.AsArray().Any(e => e?.GetValue<string>() == "KHR_draco_mesh_compression") == true
                    || json["accessors"]?.AsArray().Any(a => a?["sparse"] != null) == true)
                    throw new InvalidDataException("Native model intake requires plain geometry and dense morph accessors.");
                var extras = new JsonObject();
                if (json["nodes"] is JsonArray nodes)
                    for (int i = 0; i < nodes.Count; i++)
                        if (nodes[i]?["extras"] is { } extra && nodes[i]?["name"] is { } nodeName) extras[nodeName.GetValue<string>()] = extra.DeepClone();
                using var gltf = new GltfDocument(); using var state = new GltfState();
                var result = gltf.AppendFromFile(file, state);
                if (result != Error.Ok || gltf.GenerateScene(state) is not Node3D scene) throw new IOException($"Model {name} failed: {result}");
                string resources = output + "/" + name + "-resources";
                if (Directory.Exists(ProjectSettings.GlobalizePath(resources))) throw new IOException("Keep existing model resources: " + resources);
                new NativeResourceStore(resources).Scene(scene, output + "/" + name + ".scn");
                File.WriteAllText(ProjectSettings.GlobalizePath(output + "/" + name + ".extras.json"), extras.ToJsonString());
                manifest[name] = new JsonObject { ["sourceSha256"] = sha, ["nodes"] = BakedWorld.All(scene).Count(), ["animations"] = BakedWorld.All(scene).OfType<AnimationPlayer>().Sum(a => a.GetAnimationList().Length), ["extras"] = name + ".extras.json" };
                full[name] = new JsonObject { ["sourceSha256"] = sha, ["nativeScene"] = output + "/" + name + ".scn", ["existingNativeScenePreserved"] = false };
                scene.Free(); GD.Print("Stored native gameplay model: " + name);
            }
            File.WriteAllText(ProjectSettings.GlobalizePath(output + "/intake.json"), manifest.ToJsonString());
            File.WriteAllText(fullPath, full.ToJsonString());
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
}
