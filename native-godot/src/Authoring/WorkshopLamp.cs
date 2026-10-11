using Godot;

namespace Scheldemist.Native.Authoring;

[Tool]
public partial class WorkshopLamp : Node3D
{
    public bool Lit { get; private set; }
    public void SetNight(bool night)
    {
        Lit = night;
        if (GetNodeOrNull<OmniLight3D>("Light") is { } light) light.Visible = night;
        if (GetNodeOrNull<MeshInstance3D>("Flame") is { } flame) flame.Visible = night;
    }
    public override void _Ready() => SetNight(false);
}
