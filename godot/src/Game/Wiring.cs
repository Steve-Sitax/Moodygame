using Godot;
using Scheldemist.World;

namespace Scheldemist.Game;

/// <summary>What one part needs from another, in one place: the tide, the daylight, the weather and the townspeople follow the game's clock.</summary>
[GamePart(900)]
public partial class Wiring : Node
{
    private double wait;
    private Scheldemist.Town.Townspeople? people;

    private bool mapOpen;

    public override void _Ready()
    {
        if (TownMap.I != null) TownMap.I.OpenChanged += open => mapOpen = open;
        // time runs while Jef plays: walking with the mouse taken, or in a window (a talk, a shop), as in the browser
        GameState.I.PlayingWhen = () => DialogUp() || (Input.MouseMode == Input.MouseModeEnum.Captured && Main.I?.Cam is not null and not Scheldemist.Player.FlyCam);
    }

    private static bool DialogUp() => Scheldemist.Ui.Dialogs.Dialogs.I is { Any: true };

    public override void _Process(double delta)
    {
        // Jef stands still under the open map and while a window is up
        if (Scheldemist.Player.Jef.I != null) Scheldemist.Player.Jef.I.Frozen = mapOpen || DialogUp();
        if ((wait -= delta) > 0) return;
        wait = 1;
        var s = GameState.I;
        // (--hour or a part's own test holds the clock: then the server's is not passed on)
        if (s == null || !s.Live || Main.I.Arg("hour") != "" || Main.I.Arg("peopletest") != "") return;
        Tide.Set((int)s.Day, (float)s.HourF);
        if (Daylight.I != null)
        {
            Daylight.I.SetTime((float)s.HourF);
            if (Main.I.Arg("weather") == "") Daylight.I.SetWeather(s.Weather);
        }
        people ??= Main.I.GetNodeOrNull<Scheldemist.Town.Townspeople>("Townspeople");
        people?.SetClock((int)s.Day, s.HourF);
    }
}
