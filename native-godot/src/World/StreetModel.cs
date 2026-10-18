using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.Native.World;

/// <summary>
/// A street fitting drawn from a stored model file (the hiring board, #153: workboard.scn hiring_board). The wrapper
/// scene around it carries its collision; the town's AuthoredObject gives its placement and permanent id.
/// </summary>
public partial class StreetModel : Node3D
{
    [Export] public string Library { get; set; } = "workboard";
    [Export] public string Model { get; set; } = "hiring_board";
    [Export] public float DrawDistance { get; set; } = 120;

    public override void _Ready()
    {
        if (Engine.IsEditorHint() || GetNodeOrNull("model") != null) return;
        if (ModelLibrary.Get(Library, StreetBench.Look)?.Copy(Model) is not { } copy) { GD.PrintErr($"street model: no {Library}/{Model}"); return; }
        copy.Name = "model";
        foreach (var g in Scheldemist.World.BakedWorld.All(copy).OfType<GeometryInstance3D>()) { g.VisibilityRangeEnd = DrawDistance; g.VisibilityRangeEndMargin = 5; }
        AddChild(copy);
    }
}
