using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.Game;

/// <summary>Isolated material review scene. The playable full game starts at town.tscn.</summary>
public partial class NativeGame : Scheldemist.Main
{
    protected override BakedWorld CreateWorld() => new NativeGameWorld();
    public override bool MultiplayerAvailable => false;
    private const bool SurfaceOnly = true;
    protected override bool UseMenus => false;
    protected override IEnumerable<Node> CreateParts()
    {
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
        Scheldemist.Native.World.NativeData.Initialize();
        Scheldemist.Models.ModelLibrary.NativeScene = name =>
        {
            string path = "res://assets/game-models/" + name + ".scn";
            if (!ResourceLoader.Exists(path)) { GD.PrintErr("Native gameplay model missing: " + path); return null; }
            return ResourceLoader.Load<PackedScene>(path).Instantiate<Node3D>();
        };
        base._Ready();
        weatherIndex = hourIndex = 0;
        status = new Label { Position = new Vector2(16, 12), MouseFilter = Control.MouseFilterEnum.Ignore };
        status.AddThemeColorOverride("font_shadow_color", Colors.Black);
        status.AddThemeConstantOverride("shadow_offset_x", 2); status.AddThemeConstantOverride("shadow_offset_y", 2);
        Ui.AddChild(status);
        GetTree().Root.Title = SurfaceOnly ? "Scheldemist · Rijnkaai Surface Viewer" : "Scheldemist · Rijnkaai Playtest";
        if (Arg("native-game-test") != "") _ = NativeGameProof.Run(this, Arg("native-game-test"));
        if (Arg("surface-test") != "") _ = NativeSurfaceProof.Run(this, Arg("surface-test"));
        if (Arg("ladder-test") != "") _ = NativeLadderProof.Run(this, Arg("ladder-test"));
        if (Flag("review-surfaces")) _ = ReviewSurfaces();
    }

    private async Task ReviewSurfaces()
    {
        for (int i = 0; i < 120 && !Loaded; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        if (!Loaded) return;
        for (int i = 0; i < 8; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        if (!Jef.I.Fly) Jef.I.ToggleFly();
        Cam.GlobalPosition = new Vector3(17.08f, 1.13f, 2.08f); Cam.LookAt(new Vector3(18, 0.35f, 0.9f));
        Daylight.I.SetTime(13); Daylight.I.SetWeather("clear"); Daylight.I.SetRain(0); Daylight.I.Settle();
        // FlyCam keeps its own mouse angles; sync them after positioning the review camera.
        if (Cam is FlyCam fly) { fly.Face(Cam.GlobalBasis.GetRotationQuaternion()); fly.SpeedScale = 0.125f; }
    }

    public override void _UnhandledInput(InputEvent input)
    {
        if (!SurfaceOnly || input is not InputEventKey { Pressed: true, Echo: false } key || !Loaded) return;
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
        if (Loaded && !titled) { titled = true; GetTree().Root.Title = SurfaceOnly ? "Scheldemist · Rijnkaai Surface Viewer" : "Scheldemist · Rijnkaai Playtest"; }
        if (!Scheldemist.Menu.Pause.Paused) Tide.Advance((float)delta);
        if (status != null && Loaded && SurfaceOnly) status.Text = $"Rijnkaai · {Daylight.I.Weather} · {Daylight.I.Hour:00.00} h\nF6 weather   F7 time   F9 fly/walk   B bump/relief: {(bumps ? "on" : "off")}   M reflections: {(reflections ? "on" : "off")}   Esc release mouse";
    }
    private bool titled;
}
