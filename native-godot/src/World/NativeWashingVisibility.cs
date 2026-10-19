using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Clothes and their pegs are put away in rain and overnight; lines, rings and poles remain.</summary>
public partial class NativeWashingVisibility : Node
{
    private const string Group = "native_washing";
    private bool? hanging;
    public static bool Hang(float hour, string weather, float rain) => hour >= 8 && hour < 18 && weather is not ("rain" or "storm") && rain <= .05f;
    public override void _Ready() => Update();
    public override void _Process(double delta) => Update();
    private void Update()
    {
        if (Daylight.I == null) return;
        bool next = Hang(Daylight.I.Hour, Daylight.I.Weather, Daylight.I.Rain);
        if (next == hanging) return;
        hanging = next;
        foreach (var node in GetTree().GetNodesInGroup(Group))
            if (node is Node3D cloth) cloth.Visible = next;
    }
    public static void Attach(Node3D cloth)
    {
        cloth.SetMeta("native_washing", true);
        cloth.SetMeta(NativeStreetFurniture.Meta, true);
        cloth.AddToGroup(Group);
        if (Daylight.I != null) cloth.Visible = Hang(Daylight.I.Hour, Daylight.I.Weather, Daylight.I.Rain);
    }
}
