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
        var backups = new System.Collections.Generic.List<(string Original, string Backup)>();
        var replacements = new System.Collections.Generic.List<string>();
        bool committed = false;
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
            string replace = WorkshopSession.Arg("replace");
            if (replace != "" && (replace != "people2" || only != "people2" || !resume))
                throw new ArgumentException("Replacement is restricted to --resume-intake yes --only people2 --replace people2.");
            if (only.Split(',').Contains("people2") && (DisplayServer.GetName() == "headless" || OS.GetCmdlineArgs().Contains("--headless")))
                throw new IOException("People2 intake requires readable atlas images after saving; use rendered --rendering-method forward_plus, not --headless.");
            string[] names = only == "" ? new[] { "people", "props", "player", "crate", "clutter", "quaygoods", "lively" } : only.Split(',');
            if (names.Any(name => name.Length == 0 || name.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '_')))
                throw new ArgumentException("--only requires comma-separated model names.");
            foreach (string name in names)
            {
                string file = Path.Combine(source, name + ".glb");
                using var input = File.OpenRead(file);
                string sha = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
                if (replace != name && File.Exists(ProjectSettings.GlobalizePath(output + "/" + name + ".scn")))
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
                if (name == "people2")
                    foreach (var mesh in BakedWorld.All(scene).OfType<MeshInstance3D>())
                        for (int surface = 0; surface < mesh.Mesh.GetSurfaceCount(); surface++)
                            if (mesh.Mesh.SurfaceGetMaterial(surface) is BaseMaterial3D material)
                                foreach (var texture in new[] { material.AlbedoTexture, material.NormalTexture })
                                {
                                    using var image = texture?.GetImage();
                                    if (image == null || image.IsEmpty())
                                        throw new IOException("People2 intake requires readable atlas images; use rendered --rendering-method forward_plus, not --headless.");
                                }
                string resources = output + "/" + name + "-resources";
                if (replace == name)
                {
                    // Validate/import the new source before moving any native artwork. Only this
                    // model's owned paths and the two intake manifests enter the rollback set.
                    foreach (string relative in new[] { name + ".scn", name + "-resources", name + ".extras.json", "intake.json", "full-intake.json" })
                    {
                        string original = ProjectSettings.GlobalizePath(output + "/" + relative);
                        string backup = original + ".replace-" + Guid.NewGuid().ToString("N");
                        if (Directory.Exists(original)) Directory.Move(original, backup);
                        else if (File.Exists(original)) File.Move(original, backup);
                        else { replacements.Add(original); continue; }
                        backups.Add((original, backup));
                        replacements.Add(original);
                    }
                    manifest.Remove(name); full.Remove(name);
                }
                if (Directory.Exists(ProjectSettings.GlobalizePath(resources))) throw new IOException("Keep existing model resources: " + resources);
                new NativeResourceStore(resources).Scene(scene, output + "/" + name + ".scn");
                File.WriteAllText(ProjectSettings.GlobalizePath(output + "/" + name + ".extras.json"), extras.ToJsonString());
                manifest[name] = new JsonObject { ["sourceSha256"] = sha, ["nodes"] = BakedWorld.All(scene).Count(), ["animations"] = BakedWorld.All(scene).OfType<AnimationPlayer>().Sum(a => a.GetAnimationList().Length), ["extras"] = name + ".extras.json" };
                full[name] = new JsonObject { ["sourceSha256"] = sha, ["nativeScene"] = output + "/" + name + ".scn", ["existingNativeScenePreserved"] = false };
                scene.Free(); GD.Print("Stored native gameplay model: " + name);
            }
            File.WriteAllText(ProjectSettings.GlobalizePath(output + "/intake.json"), manifest.ToJsonString());
            File.WriteAllText(fullPath, full.ToJsonString());
            committed = true;
            foreach (var pair in backups)
                if (Directory.Exists(pair.Backup)) Directory.Delete(pair.Backup, true);
                else File.Delete(pair.Backup);
            GetTree().Quit();
        }
        catch (Exception error)
        {
            foreach (string path in committed ? Array.Empty<string>() : replacements.ToArray())
                if (Directory.Exists(path)) Directory.Delete(path, true);
                else if (File.Exists(path)) File.Delete(path);
            foreach (var pair in committed ? Array.Empty<(string Original, string Backup)>() : backups.ToArray())
                if (Directory.Exists(pair.Backup)) Directory.Move(pair.Backup, pair.Original);
                else if (File.Exists(pair.Backup)) File.Move(pair.Backup, pair.Original);
            GD.PrintErr(error); GetTree().Quit(1);
        }
    }
}
