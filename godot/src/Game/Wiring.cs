using Godot;
using Scheldemist.World;

namespace Scheldemist.Game;

/// <summary>What one part needs from another, in one place: the tide follows the game's clock.</summary>
[GamePart(900)]
public partial class Wiring : Node
{
    private double wait;

    public override void _Process(double delta)
    {
        if ((wait -= delta) > 0) return;
        wait = 1;
        var s = GameState.I;
        if (s != null && s.Live) Tide.Set((int)s.Day, (float)s.HourF);
    }
}
