using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Game;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Editor-only subsets of shared native roots, using the already stored resource graph.</summary>
public partial class NativeFragmentRecovery : Node
{
    public override void _Ready()
    {
        Node3D? town = null;
        try
        {
            NativeGlobals.Ensure();
            const string output = "res://world/town/fragments";
            Directory.CreateDirectory(ProjectSettings.GlobalizePath(output));
            town = ResourceLoader.Load<PackedScene>("res://world/town/scene.tscn").Instantiate<Node3D>();
            var requested = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://recovery/full/outer-fragments.json")))!["sourceIndices"]!.AsArray().Select(n => n!.GetValue<int>()).ToHashSet();
            var centre = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/districts/centre-manifest.json")))!;
            foreach (var row in centre["sharedChildren"]!.AsArray()) requested.Add(row!["sourceIndex"]!.GetValue<int>());
            var nodes = BakedWorld.All(town).Where(n => n.HasMeta("source_node_index")).GroupBy(n => n.GetMeta("source_node_index").AsInt32()).ToDictionary(g => g.Key, g => g.First());
            var store = new NativeResourceStore("res://world/town/resources");
            foreach (int index in requested.Order())
            {
                string path = output + "/node-" + index.ToString("D5") + ".scn";
                if (ResourceLoader.Exists(path)) continue;
                if (!nodes.TryGetValue(index, out var node)) throw new IOException("Requested native fragment does not exist: " + index);
                var clone = node.Duplicate();
                if (node is Node3D original && clone is Node3D copy)
                {
                    var transform = original.Transform;
                    for (var parent = original.GetParent(); parent is Node3D p && p != town; parent = parent.GetParent()) transform = p.Transform * transform;
                    copy.Transform = transform;
                }
                store.Scene(clone, path); clone.Free();
            }
            town.Free(); town = null;
            GD.Print("Native editor fragments stored: " + requested.Count); GetTree().Quit();
        }
        catch (Exception error) { town?.Free(); GD.PrintErr(error); GetTree().Quit(1); }
    }
}
