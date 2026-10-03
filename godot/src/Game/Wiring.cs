using Godot;
using Scheldemist.World;

namespace Scheldemist.Game;

/// <summary>What one part needs from another, in one place: the tide and the townspeople follow the game's clock.</summary>
[GamePart(900)]
public partial class Wiring : Node
{
    private double wait;
    private Scheldemist.Town.Townspeople? people;

    public override void _Process(double delta)
    {
        if ((wait -= delta) > 0) return;
        wait = 1;
        var s = GameState.I;
        // (--hour or a part's own test holds the clock: then the server's is not passed on)
        if (s == null || !s.Live || Main.I.Arg("hour") != "" || Main.I.Arg("peopletest") != "") return;
        Tide.Set((int)s.Day, (float)s.HourF);
        people ??= Main.I.GetNodeOrNull<Scheldemist.Town.Townspeople>("Townspeople");
        people?.SetClock((int)s.Day, s.HourF);
    }
}
