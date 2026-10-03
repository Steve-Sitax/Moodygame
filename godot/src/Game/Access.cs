using System;

namespace Scheldemist.Game;

/// <summary>
/// The menu's Accessibility switches the game's drawings read (the browser's classes on the page: "colour-safe").
/// The menus' part sets them; a drawing listens to Changed.
/// </summary>
public static class Access
{
    private static bool colourSafe;
    /// <summary>Colour-safe markers: a low need in orange with a mark, not red alone.</summary>
    public static bool ColourSafe
    {
        get => colourSafe;
        set
        {
            if (value == colourSafe) return;
            colourSafe = value;
            Changed?.Invoke();
        }
    }
    public static event Action? Changed;
}
