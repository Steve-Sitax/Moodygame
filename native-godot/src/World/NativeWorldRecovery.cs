using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Game;
using Scheldemist.Native.Recovery;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>One read-only intake of the complete game world; never run by the game or editor.</summary>
public partial class NativeWorldRecovery : Node
{
    private const string Output = "res://world/town";
    private BakedWorld? imported;
    public override async void _Ready()
    {
        try
        {
            NativeGlobals.Ensure();
            if (DisplayServer.GetName() == "headless") throw new InvalidOperationException("Full intake requires a renderer for layered texture data.");
            string source = WorkshopSession.Arg("source");
            if (!File.Exists(source)) throw new FileNotFoundException(source);
            if (Directory.Exists(ProjectSettings.GlobalizePath(Output))) throw new IOException("Keep native world edits; output already exists.");
            using var input = File.OpenRead(source); string sha = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
            if (sha != "ac8534149415142120f325986c7abd3818c38005206d45354f1ebb2619f3a7d9") throw new IOException("Unexpected world snapshot.");
            foreach (string directory in new[] { "roots", "resources", "maps", "attributes" }) Directory.CreateDirectory(ProjectSettings.GlobalizePath(Output + "/" + directory));
            var world = imported = new BakedWorld();
            if (world.Load(source) != Error.Ok) throw new IOException("Complete source world failed to load.");
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); // Flush original cameras/lights/instanced placeholders.
            var town = (Node3D)world.GetChild(0);
            GD.Print("Source node mappings: " + BakedWorld.All(town).Count(n => n.HasMeta("source_node_index")) + "; coping " + string.Join(",", BakedWorld.All(town).Where(n => n.Name.ToString().Contains("coping")).Select(n => n.Name + ":" + (n.HasMeta("source_node_index") ? n.GetMeta("source_node_index").ToString() : "missing") + ":" + (n.HasMeta("source_name") ? n.GetMeta("source_name").ToString() : "missing"))));
            var resourceStore = new NativeResourceStore(Output + "/resources");
            var nodes = new JsonArray();
            using var raw = new RecoveryGlb(source, new JsonObject(), new Rect2(-480, -80, 820, 560));
            RepairCoping(town, raw);
            PreserveRijnkaaiObjects(town);
            string city = WorkshopSession.Arg("city", Path.GetFullPath(Path.Combine(ProjectSettings.GlobalizePath("res://"), "../shared/city.json")));
            town.AddChild(NativeSteenRamp.Create(File.ReadAllText(city)));
            var attributes = new JsonArray();
            foreach (string name in new[] { "alive_gutter_stains", "works_smoke" })
                foreach (string attr in new[] { "POSITION", "_AUV", "_AKIND", "_ASEED" })
                    if (world.Attribute(name, attr) is { } values)
                    {
                        string file = Output + "/attributes/" + name + "-" + attr + ".bin";
                        var bytes = new byte[values.Length * 4]; Buffer.BlockCopy(values, 0, bytes, 0, bytes.Length);
                        File.WriteAllBytes(ProjectSettings.GlobalizePath(file), bytes);
                        attributes.Add(new JsonObject { ["node"] = name, ["attribute"] = attr, ["nth"] = 0, ["path"] = file });
                    }
            // Store each original root once. A native whole-world scene references these roots without reparenting them.
            var text = new System.Text.StringBuilder("[gd_scene format=3]\n\n");
            int ordinal = 0;
            foreach (var root in town.GetChildren().ToArray())
            {
                if (root.IsQueuedForDeletion()) continue;
                int index = root.HasMeta("source_node_index") ? root.GetMeta("source_node_index").AsInt32() : -1;
                string path = Output + "/roots/node-" + (index >= 0 ? index : 90000 + ordinal).ToString("D5") + ".scn";
                resourceStore.Scene(root, path);
                nodes.Add(new JsonObject { ["sourceIndex"] = index, ["sourceName"] = root.HasMeta("source_name") ? root.GetMeta("source_name").AsString() : root.Name.ToString(), ["godotName"] = root.Name.ToString(), ["path"] = path });
                text.Append($"[ext_resource type=\"PackedScene\" path=\"{path}\" id=\"{++ordinal}\"]\n");
                if (ordinal % 50 == 0) { GD.Print($"Native roots stored: {ordinal}; shared resources: {resourceStore.Count}"); await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }
            }
            text.Append("\n[node name=\"town\" type=\"Node3D\"]\n"); ordinal = 0;
            foreach (var root in nodes) text.Append($"\n[node name=\"{root!["godotName"]!.GetValue<string>()}\" parent=\".\" instance=ExtResource(\"{++ordinal}\")]\n");
            File.WriteAllText(ProjectSettings.GlobalizePath(Output + "/scene.tscn"), text.ToString());
            File.WriteAllText(ProjectSettings.GlobalizePath(Output + "/roots.json"), nodes.ToJsonString());
            File.WriteAllText(ProjectSettings.GlobalizePath(Output + "/attributes.json"), attributes.ToJsonString());
            File.Copy(Path.ChangeExtension(source, ".json"), ProjectSettings.GlobalizePath(Output + "/facts.json"));
            File.Copy(Path.Combine(Path.GetDirectoryName(source)!, "town_lights.json"), ProjectSettings.GlobalizePath(Output + "/lights.json"));
            foreach (string map in new[] { "skyshade", "dirt", "shore", "foul" }) foreach (string ext in new[] { ".png", ".json" })
                File.Copy(Path.Combine(Paths.TownTextures(source), map + ext), ProjectSettings.GlobalizePath(Output + "/maps/" + map + ext));
            File.WriteAllText(ProjectSettings.GlobalizePath(Output + "/intake.json"), JsonSerializer.Serialize(new { sourceSha256 = sha, sourceBytes = new FileInfo(source).Length, roots = nodes.Count, resources = resourceStore.Count, unported = world.Unported, report = world.Report }, new JsonSerializerOptions { WriteIndented = true }));
            world.Free(); GD.Print($"Full native world stored: {nodes.Count} roots, {resourceStore.Count} shared resources."); GetTree().Quit();
        }
        catch (Exception error) { imported?.Free(); GD.PrintErr(error); GetTree().Quit(1); }
    }
    private static void RepairCoping(Node town, RecoveryGlb raw)
    {
        foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.HasMeta("source_name") && m.GetMeta("source_name").AsString() == "quay_coping"))
        {
            if (mesh.Mesh == null) continue;
            mesh.Mesh = RecoveryCoping.Build(raw, mesh.GetMeta("source_node_index").AsInt32(), mesh.Mesh.SurfaceGetMaterial(0));
            if (mesh.Mesh.SurfaceGetMaterial(0) is ShaderMaterial material)
            {
                var kind = Scheldemist.Render.Psx.KindOf(material.Shader);
                NativeSurfaceMaterials.Coping(material);
                if (kind != null) Scheldemist.Render.Psx.RegisterNative(material.Shader, kind.Value);
            }
            GD.Print("Full-world coping geometry and material corrected.");
        }
    }
    private static Transform3D Pose(Node3D node, Node root)
    {
        var pose = node.Transform;
        for (var parent = node.GetParent(); parent is Node3D p && p != root; parent = parent.GetParent()) pose = p.Transform * pose;
        return pose;
    }
    private static void PreserveRijnkaaiObjects(Node3D town)
    {
        var report = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://recovered/rijnkaai-recovered/recovery-report.json")))!;
        var lampIndices = report["selected"]!.AsArray().Where(n => n!["kind"]!.GetValue<string>() == "prop" && n["name"]!.GetValue<string>() == "gas_lamp").Select(n => n!["index"]!.GetValue<int>()).ToHashSet();
        foreach (var node in BakedWorld.All(town).OfType<Node3D>().Where(n => n.HasMeta("source_node_index") && lampIndices.Contains(n.GetMeta("source_node_index").AsInt32())))
        { node.Visible = false; node.SetMeta("native_replaced_by_layout", true); }
        var district = ResourceLoader.Load<AuthorDistrict>("res://recovered/rijnkaai-recovered/district.tres");
        var seed = district.Scene!.Instantiate<Node3D>();
        // Current snapshot descriptors are semantic aliases, so use source records as the durable bollard selection.
        var selected = report["selected"]!.AsArray().Where(n => n!["kind"]!.GetValue<string>() == "prop" && n["name"]!.GetValue<string>() == "bollard").Select(n => n!["id"]!.GetValue<string>()).ToHashSet();
        var bollards = seed.GetNode("Objects").GetChildren().OfType<AuthoredObject>().Where(n => selected.Contains(n.ObjectId)).ToArray();
        var model = bollards[0].Asset!.Scene!.Instantiate<Node3D>();
        var local = TownRecovery.LocalBounds(model); model.Free();
        var boxes = bollards.Select(n => (n.Transform * local).Grow(0.003f)).ToArray();
        var removed = new int[boxes.Length];
        foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>())
        {
            if (mesh.Mesh == null || !mesh.HasMeta("source_name") || !mesh.GetMeta("source_name").AsString().StartsWith("quayfurniture")) continue;
            var trimmed = RecoveryRefresh.Trim(mesh.Mesh, Pose(mesh, town), boxes, removed);
            if (trimmed != null) mesh.Mesh = trimmed;
        }
        seed.Free();
        if (lampIndices.Count != 6 || selected.Count != 8 || removed.Any(n => n != 1106)) throw new IOException("Rijnkaai overlay extraction does not match the reviewed six lamps/eight bollards. Lamps=" + lampIndices.Count + ", selected=" + selected.Count + ", boxes=" + boxes.Length + ", removed=" + string.Join(",", removed));
        GD.Print("Preserved Rijnkaai overlay: six source lamps hidden, eight merged bollards removed.");
    }
}
