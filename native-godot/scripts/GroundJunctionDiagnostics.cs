using Godot;
using System;
using System.Collections.Generic;
using System.Linq;
using Scheldemist.World;

/// <summary>Review fixture only. At hour 12.5 replace the five ground materials with
/// unlit grey to distinguish geometry leaks from relief/specular seams. Never saves resources.</summary>
public partial class GroundJunctionDiagnostics : Node
{
    private readonly Dictionary<MeshInstance3D, Material> originals = new();
    private readonly StandardMaterial3D neutral = new()
    {
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        AlbedoColor = new Color(.25f, .25f, .25f)
    };
    private bool enabled;
    public override void _Process(double delta)
    {
        if (Daylight.I == null) return;
        if (originals.Count == 0)
            foreach (var mesh in GetTree().Root.FindChildren("ground_*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
                if (mesh.Name.ToString() is "ground_earth" or "ground_flags" or "ground_cobble" or "ground_grass" or "ground_quay")
                    originals.Add(mesh, mesh.MaterialOverride);
        bool next = Math.Abs(Daylight.I.Hour - 12.5f) < .01f;
        if (next == enabled || originals.Count == 0) return;
        foreach (var pair in originals) pair.Key.MaterialOverride = next ? neutral : pair.Value;
        enabled = next;
        GD.Print($"Ground junction neutral diagnostic: {next}, {originals.Count} ground meshes");
    }
}
