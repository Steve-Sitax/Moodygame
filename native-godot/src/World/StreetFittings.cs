using Godot;
using Scheldemist.Dev;

namespace Scheldemist.Native.World;

/// <summary>Mount the prebuilt street fittings when the district enters the tree.
/// Underground openings are cut earlier, against the structural town alone.</summary>
[Tool]
public partial class StreetFittings : Node3D
{
    public const string ScenePath = "res://assets/models/street-details/fittings.scn";

    public override void _Ready()
    {
        using var timing = StartupTiming.Measure("native.street-fittings");
        AddChild(GD.Load<PackedScene>(ScenePath).Instantiate<Node3D>());
    }
}
