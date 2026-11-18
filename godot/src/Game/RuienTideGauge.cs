using System.Linq;
using Godot;
using Scheldemist.World.Ruien;

namespace Scheldemist.Game;

/// <summary>A staff let into the eastern channel wall on the retained side of the Vlietrui sluice.</summary>
[GamePart(123)]
public partial class RuienTideGauge : Node
{
    public const string Installed = "ruien_o2/VlietruiStaff";
    private const string Prefab = "res://assets/models/ruien-gauge/o2-staff.tscn";
    // On the first straight bay behind the penstock. Its dressed stone is 31 mm behind the collision proxy.
    private static readonly Vector3 Wall = new(-144.67661f,0,75.75082f);
    private static readonly Vector3 Facing = new(-.994824f,0,-.101614f);
    private Node3D? staff;
    private MeshInstance3D floatMesh = null!;
    private Vector3 sample;

    public override void _Process(double delta)
    {
        if (!Main.I.Loaded || Ruien.I is not { } ruien || Main.I.View.GetCamera3D() is not { } camera) return;
        var eye = camera.GlobalPosition;
        bool nearby = ruien.Near != null && eye.Y < -.25f && eye.DistanceSquaredTo(Wall) < 28*28;
        if (staff != null) staff.Visible = nearby;
        if (!nearby) return;
        if (staff == null)
        {
            var host = Main.I.View.GetNodeOrNull<Node3D>("ruien_o2");
            var gate = ruien.Data.Areas.FirstOrDefault(a => a.Id == "o2")?.Gates.FirstOrDefault(g => g.Id == "O2");
            if (host == null || gate == null || !ResourceLoader.Exists(Prefab)) return;
            using var timing = Dev.StartupTiming.Measure("ruien.tide-gauge");
            staff = GD.Load<PackedScene>(Prefab).Instantiate<Node3D>();
            host.AddChild(staff);
            var right = Vector3.Up.Cross(Facing).Normalized();
            staff.GlobalTransform = new Transform3D(new Basis(right, Vector3.Up, Facing.Normalized()),
                new Vector3(Wall.X, gate.Sill, Wall.Z) - Facing*.031f);
            floatMesh = staff.GetNode<MeshInstance3D>("Float");
            // Sample where the buoy actually rides on its rod, past the face of the staff.
            sample = staff.ToGlobal(new Vector3(-.141f,0,.049f));
        }
        var level = ruien.WaterAt(sample.X, sample.Z);
        float? aboveSill = level - staff.GlobalPosition.Y;
        floatMesh.Visible = aboveSill is >= 0 and <= .90f;
        if (floatMesh.Visible) floatMesh.Position = Vector3.Up * aboveSill!.Value;
    }
}
