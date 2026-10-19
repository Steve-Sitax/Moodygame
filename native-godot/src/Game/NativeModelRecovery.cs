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
    public override async void _Ready()
    {
        var backups = new System.Collections.Generic.List<(string Original, string Backup)>();
        var replacements = new System.Collections.Generic.List<string>();
        bool committed = false;
        try
        {
            string source = Scheldemist.Native.Game.NativeArguments.Arg("source-models");
            string output = "res://assets/game-models";
            if (!Directory.Exists(source)) throw new DirectoryNotFoundException(source);
            bool resume = Scheldemist.Native.Game.NativeArguments.Arg("resume-intake") == "yes";
            if (Directory.Exists(ProjectSettings.GlobalizePath(output)) && !resume) throw new IOException("Keep existing native models; intake output already exists.");
            Directory.CreateDirectory(ProjectSettings.GlobalizePath(output));
            var manifest = resume ? JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(output + "/intake.json")))!.AsObject() : new JsonObject();
            string fullPath = ProjectSettings.GlobalizePath(output + "/full-intake.json");
            var full = File.Exists(fullPath) ? JsonNode.Parse(File.ReadAllText(fullPath))!.AsObject() : new JsonObject();
            string only = Scheldemist.Native.Game.NativeArguments.Arg("only");
            string replace = Scheldemist.Native.Game.NativeArguments.Arg("replace");
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
                if (name is "ferry" or "workgoods" or "benches" or "workboard" or "smallgoods" or "fittings" or "church") CompressPictures(scene);
                // People2's sliders leave the meshes for one sparse file (People2Morphs): dense blend shapes would
                // cost over 100 MB of stored resources.
                string resources = output + "/" + name + "-resources";
                if (replace == name)
                {
                    // Validate/import the new source before moving any native artwork. Only this
                    // model's owned paths and the two intake manifests enter the rollback set.
                    var owned = new System.Collections.Generic.List<string> { name + ".scn", name + "-resources", name + ".extras.json", "intake.json", "full-intake.json" };
                    if (name == "people2")
                        owned.AddRange(Directory.EnumerateFileSystemEntries(ProjectSettings.GlobalizePath(output), "people2_*").Select(Path.GetFileName)!);
                    foreach (string relative in owned.Distinct())
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
                if (name == "people2") StorePeopleParts(scene, output, extras);
                else new NativeResourceStore(resources).Scene(scene, output + "/" + name + ".scn");
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
            // Let the renderer retire saved-scene RIDs before exit. Forcing the Mono finalizer
            // thread here can dispose GLTF wrappers while the engine is still retiring them.
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
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

    /// <summary>
    /// The ferry's pictures are stored as BC7 with mipmaps (its deck alone is 2048 x 1536): a quarter of the size on disk
    /// and on the card. A picture under 128 px stays as it is. The stored texture keeps the glTF image's name.
    /// </summary>
    private static void CompressPictures(Node3D scene)
    {
        var done = new System.Collections.Generic.Dictionary<Texture2D, Texture2D>();
        foreach (var mesh in BakedWorld.All(scene).OfType<MeshInstance3D>())
            for (int surface = 0; surface < mesh.Mesh.GetSurfaceCount(); surface++)
                if (mesh.Mesh.SurfaceGetMaterial(surface) is BaseMaterial3D { AlbedoTexture: { } picture } material)
                {
                    if (!done.TryGetValue(picture, out var packed))
                    {
                        using var image = picture.GetImage();
                        if (image == null || image.IsCompressed() || Math.Min(image.GetWidth(), image.GetHeight()) < 128) packed = picture;
                        else
                        {
                            image.GenerateMipmaps();
                            image.Compress(Image.CompressMode.Bptc, Image.CompressSource.Srgb);
                            var texture = ImageTexture.CreateFromImage(image); texture.ResourceName = picture.ResourceName; packed = texture;
                        }
                        done[picture] = packed;
                    }
                    material.AlbedoTexture = packed;
                }
    }

    private static void StorePeopleParts(Node3D scene, string output, JsonObject extras)
    {
        var parts = new System.Collections.Generic.List<(string Name, Node3D Scene)>();
        var groups = new System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<Node3D>>();
        foreach (var child in scene.GetChildren().OfType<Node3D>().ToArray())
        {
            if (child.Name == "man_middling" || child.Name == "people2_held") continue;
            foreach (var node in BakedWorld.All(child)) node.Owner = null;
            scene.RemoveChild(child);
            string group = extras[child.Name.ToString()]?["people2_group"]?.GetValue<string>() ?? child.Name.ToString();
            if (!groups.TryGetValue(group, out var members)) groups[group] = members = new();
            members.Add(child);
        }
        foreach (var (group, members) in groups)
            for (int i = 0; i < members.Count; i += 3)
            {
                var part = new Node3D { Name = "PeoplePart" };
                foreach (var child in members.Skip(i).Take(3)) part.AddChild(child);
                bool dressed = extras[members[0].Name.ToString()]?["people2_group"] != null;
                parts.Add(("people2_" + group + (dressed ? (i/3+1).ToString() : ""), part));
            }
        parts.Insert(0, ("people2", scene));
        var index = new JsonObject();
        foreach (var (name, part) in parts)
        {
            byte[] morphs = Scheldemist.People.People2Morphs.Extract(part, out int meshes, out long moves);
            if (morphs.Length >= 20_000_000) throw new IOException("People morph part exceeds 20 MB: " + name);
            string resources = output + "/" + name + "-resources";
            new NativeResourceStore(resources).Scene(part, output + "/" + name + ".scn");
            File.WriteAllBytes(ProjectSettings.GlobalizePath(resources + "/morphs.bin"), morphs);
            foreach (var root in part.GetChildren().OfType<Node3D>()) index[root.Name] = name;
            GD.Print($"Stored people part {name}: {meshes} morph meshes, {moves} moves, {morphs.Length} bytes");
            if (part != scene) part.Free();
        }
        File.WriteAllText(ProjectSettings.GlobalizePath(output + "/people2_parts.json"), index.ToJsonString());
    }
}
