using Godot;

namespace Scheldemist.People;

// Keep the prepared shader represented from frame one, even when routing defaults off.
[GamePart(209)]
public partial class People2Warmup : Node
{
    public override void _Ready()
    {
        try { People2.Load(); People2Faces.Warmup(); }
        catch (System.Exception error) { GD.PrintErr("People2 startup failed: " + error); GetTree().Quit(1); return; }
        if (People2.PreparedMesh is { } mesh)
            AddChild(new MeshInstance3D { Name = "people2_material_reference", Mesh = mesh, Visible = false });
    }
    public override void _Process(double delta) => People2Faces.Pump();
}
