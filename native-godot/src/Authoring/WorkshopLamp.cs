using System.Linq;
using Godot;

namespace Scheldemist.Native.Authoring;

[Tool]
public partial class WorkshopLamp : Node3D
{
    public bool Lit { get; private set; }
    private MeshInstance3D? recoveredFlame;
    public void SetNight(bool night)
    {
        Lit = night;
        if (GetNodeOrNull<OmniLight3D>("Light") is { } light) light.Visible = night;
        if (GetNodeOrNull<MeshInstance3D>("Flame") is { } flame) flame.Visible = recoveredFlame == null && night;
        if (recoveredFlame != null) recoveredFlame.Visible = night;
    }
    public override void _Ready()
    {
        if (Name == "NativeLamp" && GetParent() is Node3D model)
        {
            recoveredFlame = Recovery.TownRecovery.Nodes(model).OfType<MeshInstance3D>().FirstOrDefault(mesh => mesh.Mesh != null
                && Enumerable.Range(0, mesh.Mesh.GetSurfaceCount()).Any(i => mesh.Mesh.SurfaceGetMaterial(i)?.ResourceName == "flame"));
            if (recoveredFlame?.Mesh != null && GetNodeOrNull<OmniLight3D>("Light") is { } light)
                light.Position = (GlobalTransform.AffineInverse() * recoveredFlame.GlobalTransform * recoveredFlame.Mesh.GetAabb()).GetCenter();
        }
        SetNight(false);
    }
}
