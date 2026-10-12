using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.Game;

/// <summary>The existing Godot game, supplied with an editable native district.</summary>
public partial class NativeGame : Scheldemist.Main
{
    protected override BakedWorld CreateWorld() => new NativeGameWorld();
    protected override bool UseMenus => false;
    protected override IEnumerable<Node> CreateParts()
    {
        // This district has no recovered actors, service locations or mover routes yet.
        var parts = new Node[] { new Daylight(), new Solid(), new Lightning(), new Jef(), new Scheldemist.World.Sky(), new Lights(), new RainSheets(), new Rain(), new Waters(), new Mirrors() };
        foreach (var part in parts) part.Name = part.GetType().Name;
        return parts;
    }

    private Label status = null!;
    private int weatherIndex, hourIndex;
    private bool bumps = true, reflections = true;
    private readonly string[] weather = { "clear", "mist", "fog", "rain", "storm" };
    private readonly float[] hours = { 13, 18, 21, 5 };

    public override void _Ready()
    {
        NativeGlobals.Ensure();
        base._Ready();
        weatherIndex = System.Array.IndexOf(weather, Daylight.I.Weather);
        hourIndex = System.Array.IndexOf(hours, Daylight.I.Hour);
        status = new Label { Position = new Vector2(16, 12), MouseFilter = Control.MouseFilterEnum.Ignore };
        status.AddThemeColorOverride("font_shadow_color", Colors.Black);
        status.AddThemeConstantOverride("shadow_offset_x", 2); status.AddThemeConstantOverride("shadow_offset_y", 2);
        Ui.AddChild(status);
        DisplayServer.WindowSetTitle("Scheldemist · Native Rijnkaai Game");
        if (Arg("native-game-test") != "") _ = NativeGameProof.Run(this, Arg("native-game-test"));
    }

    public override void _UnhandledInput(InputEvent input)
    {
        if (input is not InputEventKey { Pressed: true, Echo: false } key || !Loaded) return;
        switch (key.Keycode)
        {
            case Key.F6: Daylight.I.SetWeather(weather[++weatherIndex % weather.Length]); Daylight.I.SetStorm(Daylight.I.Weather == "storm" ? 0.65f : 0); Daylight.I.Settle(); break;
            case Key.F7: Daylight.I.SetTime(hours[++hourIndex % hours.Length]); Daylight.I.Settle(); Tide.Set(1, Daylight.I.Hour); break;
            case Key.F9: Jef.I.ToggleFly(); break;
            case Key.B: bumps = !bumps; ((NativeGameWorld)World).SetBumps(bumps); break;
            case Key.M: reflections = !reflections; GetChildren().OfType<Mirrors>().Single().SetQuality(reflections ? "full" : "off"); break;
            case Key.Escape: Input.MouseMode = Input.MouseModeEnum.Visible; break;
            default: return;
        }
        GetViewport().SetInputAsHandled();
    }

    public override void _Process(double delta)
    {
        base._Process(delta);
        Tide.Advance((float)delta);
        if (status != null && Loaded) status.Text = $"Rijnkaai · {Daylight.I.Weather} · {Daylight.I.Hour:00.00} h\nF6 weather   F7 time   F9 fly/walk   B bump/relief: {(bumps ? "on" : "off")}   M reflections: {(reflections ? "on" : "off")}   Esc release mouse";
    }
}
