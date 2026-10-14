using System.Globalization;
using Godot;
using Scheldemist.Player;

namespace Scheldemist.Dev;

/// <summary>
/// The console's <c>where</c>: a line at the top of the screen with the player's place and the camera's view, written as a
/// test picture's view (Snap.cs: x,y,z,yaw,pitch), so a screenshot of a problem says exactly where it was taken and the
/// same picture can be taken again with <c>--views "name:x,y,z,yaw,pitch"</c>. <c>where</c> again takes it away.
/// </summary>
public partial class WhereOverlay : CanvasLayer
{
    private Label line = null!;

    /// <summary>Shows or hides the line; returns what it says now (or that it is off).</summary>
    public static string Toggle(Node owner)
    {
        if (owner.GetNodeOrNull<WhereOverlay>("WhereOverlay") is { } shown) { shown.QueueFree(); return "where: off"; }
        var overlay = new WhereOverlay { Name = "WhereOverlay", Layer = 120, ProcessMode = ProcessModeEnum.Always };
        owner.AddChild(overlay);
        return overlay.Now();
    }

    public override void _Ready()
    {
        line = new Label { Position = new Vector2(12, 96) };
        line.AddThemeFontSizeOverride("font_size", 18);
        line.AddThemeColorOverride("font_color", Colors.White);
        line.AddThemeColorOverride("font_outline_color", Colors.Black);
        line.AddThemeConstantOverride("outline_size", 6);
        AddChild(line);
    }

    public override void _Process(double delta) => line.Text = Now();

    private string Now()
    {
        string F(float v) => v.ToString("0.0", CultureInfo.InvariantCulture);
        string text = "";
        if (Jef.I?.Body is { } body && IsInstanceValid(body)) text = $"player x {F(body.GlobalPosition.X)}  z {F(body.GlobalPosition.Z)}  y {F(body.GlobalPosition.Y)}";
        if ((Main.I?.View ?? GetViewport())?.GetCamera3D() is { } cam)
        {
            var p = cam.GlobalPosition;
            var e = cam.GlobalBasis.GetEuler(EulerOrder.Yxz);
            text += (text == "" ? "" : "\n") + $"view {F(p.X)},{F(p.Y)},{F(p.Z)},{F(Mathf.RadToDeg(e.Y))},{F(Mathf.RadToDeg(e.X))}";
        }
        return text == "" ? "where: no player or camera yet" : text;
    }
}
