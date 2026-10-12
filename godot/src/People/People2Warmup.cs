using Godot;

namespace Scheldemist.People;

// Keep the prepared shader represented from frame one, even when routing defaults off.
[GamePart(209)]
public partial class People2Warmup : Node
{
    public override void _Ready()
    {
        People2.Load();
        if (People2.PreparedMesh is { } mesh)
            AddChild(new MeshInstance3D { Name = "people2_material_reference", Mesh = mesh, Visible = false });
        SetProcess(false);
    }
}
