using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Complete one-time model intake with external shared resources and retained native metadata.</summary>
public partial class NativeModelSetRecovery : Node
{
    public override async void _Ready()
    {
        try
        {
            string source = WorkshopSession.Arg("source-models");
            const string output = "res://assets/game-models";
            var store = new NativeResourceStore(output + "/resources");
            var manifest = new JsonObject();
            foreach (string file in Directory.GetFiles(source, "*.glb").Order(StringComparer.Ordinal))
            {
                string name = Path.GetFileNameWithoutExtension(file), path = output + "/" + name + ".scn";
                using var input = File.OpenRead(file); string sha = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant(); input.Position = 12;
                using var read = new BinaryReader(input); int length = read.ReadInt32(); read.ReadUInt32();
                var json = JsonNode.Parse(read.ReadBytes(length))!; var extras = new JsonObject();
                foreach (var node in json["nodes"]!.AsArray())
                    if (node!["name"] is { } nodeName && node["extras"] is { } data) extras[nodeName.GetValue<string>()] = data.DeepClone();
                string extraPath = ProjectSettings.GlobalizePath(output + "/" + name + ".extras.json");
                if (!File.Exists(extraPath)) File.WriteAllText(extraPath, extras.ToJsonString());
                bool kept = ResourceLoader.Exists(path);
                if (!kept)
                {
                    var document = new GltfDocument(); var state = new GltfState { HandleBinaryImageMode = GltfState.HandleBinaryImageModeEnum.EmbedAsUncompressed };
                    if (document.AppendFromFile(file, state) != Error.Ok || document.GenerateScene(state) is not Node3D scene) throw new IOException("Cannot recover model " + name);
                    store.Scene(scene, path); scene.Free();
                }
                manifest[name] = new JsonObject { ["sourceSha256"] = sha, ["nativeScene"] = path, ["existingNativeScenePreserved"] = kept };
                GD.Print("Native model set: " + name + (kept ? " (native scene retained)" : " stored"));
                await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            }
            File.WriteAllText(ProjectSettings.GlobalizePath(output + "/full-intake.json"), manifest.ToJsonString());
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
}
