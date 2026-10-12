using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.World;

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
            foreach (string name in new[] { "people", "props", "player", "crate", "clutter", "quaygoods", "lively" })
            {
                string file = Path.Combine(source, name + ".glb");
                using var input = File.OpenRead(file);
                string sha = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
                if (File.Exists(ProjectSettings.GlobalizePath(output + "/" + name + ".scn")))
                {
                    if (manifest[name]?["sourceSha256"]?.GetValue<string>() != sha) throw new IOException("Existing native model came from another source: " + name);
                    continue; // Native edits remain authoritative; resuming never rewrites a stored scene.
                }
                var gltf = new GltfDocument(); var state = new GltfState();
                var result = gltf.AppendFromFile(file, state);
                if (result != Error.Ok || gltf.GenerateScene(state) is not Node3D scene) throw new IOException($"Model {name} failed: {result}");
                foreach (var node in BakedWorld.All(scene).Where(n => n != scene)) node.Owner = scene;
                var packed = new PackedScene();
                if (packed.Pack(scene) != Error.Ok || ResourceSaver.Save(packed, output + "/" + name + ".scn", ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException("Cannot store " + name);
                manifest[name] = new JsonObject { ["sourceSha256"] = sha, ["nodes"] = BakedWorld.All(scene).Count(), ["animations"] = BakedWorld.All(scene).OfType<AnimationPlayer>().Sum(a => a.GetAnimationList().Length) };
                scene.Free(); GD.Print("Stored native gameplay model: " + name);
            }
            File.WriteAllText(ProjectSettings.GlobalizePath(output + "/intake.json"), manifest.ToJsonString());
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
}
