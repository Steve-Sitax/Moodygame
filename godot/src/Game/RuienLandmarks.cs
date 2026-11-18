using Godot;
using Scheldemist.World.Ruien;

namespace Scheldemist.Game;

/// <summary>The junction masonry follows the first descent. Both facings share the collision of their host wall.</summary>
[GamePart(123)]
public partial class RuienLandmarks : Node
{
    private const string Model = "res://assets/models/ruien-junctions/landmarks.scn";

    public override void _Process(double delta)
    {
        if (!Main.I.Loaded || Ruien.I?.Near == null || Main.I.View.GetCamera3D() is not { } eye || eye.GlobalPosition.Y >= -.25f) return;
        SetProcess(false);
        // The browser-source project has no native gallery models.
        if (!ResourceLoader.Exists(Model)) return;
        using var timing = Dev.StartupTiming.Measure("ruien.junction-landmarks");
        var landmarks = GD.Load<PackedScene>(Model).Instantiate<Node3D>();
        Main.I.View.AddChild(landmarks);
    }
}
