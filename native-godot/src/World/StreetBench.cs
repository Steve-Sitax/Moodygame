using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.Native.World;

/// <summary>
/// A street bench (#165): the model from benches.scn (art-source/tools/blender/build_benches.py), one shape per kind
/// in a fine and a worn finish. The wrapper scene around it carries the collision boxes; the town's AuthoredObject
/// gives the placement and the permanent id.
/// </summary>
public partial class StreetBench : Node3D
{
    /// <summary>bench_park_fine, bench_park_worn, bench_plank_fine or bench_plank_worn.</summary>
    [Export] public string Model { get; set; } = "bench_plank_fine";
    public static readonly ModelLibrary.Look Look = new(TwoSided: true, Affine: 0, VertexColor: true);
    public bool Fine => Model.EndsWith("_fine", System.StringComparison.Ordinal);
    /// <summary>The seat's height and the two sitting places on it (local, from the model's extras).</summary>
    public static float SeatY(string model) => model.Contains("park") ? .448f : .455f;
    public static readonly Vector3[] Sits = { new(-.45f, 0, .02f), new(.45f, 0, .02f) };

    public override void _Ready()
    {
        if (Engine.IsEditorHint() || GetNodeOrNull("model") != null) return;
        if (ModelLibrary.Get("benches", Look)?.Copy(Model) is not { } copy) { GD.PrintErr("street bench: no model " + Model); return; }
        copy.Name = "model";
        // (a bench is small: past 80 m it is not drawn; no fade, so no blended copy of its material)
        foreach (var g in Scheldemist.World.BakedWorld.All(copy).OfType<GeometryInstance3D>()) { g.VisibilityRangeEnd = 80; g.VisibilityRangeEndMargin = 4; }
        AddChild(copy);
    }
}
