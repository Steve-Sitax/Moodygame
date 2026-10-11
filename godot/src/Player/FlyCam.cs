using System;
using Godot;
using Scheldemist.Menu;

namespace Scheldemist.Player;

/// <summary>
/// The free camera (the browser's Fly mode, player/firstPerson.ts updateFly), dev mode's F9 (Dev/DevTools.cs). It
/// flies with the player's own keys (Settings, Controls): walk forward, back and the steps go where it looks, Jump
/// rises, Crouch (or Ctrl) sinks, Hurry goes fast (12 and 45 m/s, as the browser's); the wheel makes both faster or
/// slower. The mouse turns it as it turns Jef, with the mouse speed and invert of the settings. A click takes the
/// mouse when it is free.
/// </summary>
public partial class FlyCam : Camera3D
{
    public float Speed = 12, Fast = 45;
    /// <summary>The wheel's factor on both speeds (0.125 .. 8).</summary>
    public float SpeedScale = 1;
    private float yaw;
    private float pitch;

    public float Yaw => yaw;
    public float Pitch => pitch;

    public void Face(Quaternion q)
    {
        Quaternion = q;
        var e = Basis.GetEuler(EulerOrder.Yxz);
        yaw = e.Y;
        pitch = e.X;
    }

    /// <summary>
    /// The mouse: the camera lives in the game's SubViewport, where the window's mouse events never come, so Jef's
    /// part (in the window's own tree) hands them over while flying.
    /// </summary>
    public void Handle(InputEvent e)
    {
        if (e is InputEventMouseButton { Pressed: true } b)
        {
            if (b.ButtonIndex == MouseButton.WheelUp) SpeedScale = Math.Min(8, SpeedScale * 1.25f);
            else if (b.ButtonIndex == MouseButton.WheelDown) SpeedScale = Math.Max(0.125f, SpeedScale / 1.25f);
            else if (Input.MouseMode != Input.MouseModeEnum.Captured) Input.MouseMode = Input.MouseModeEnum.Captured;
        }
        else if (e is InputEventMouseMotion m && Input.MouseMode == Input.MouseModeEnum.Captured)
        {
            float s = Jef.TurnSens * Tuning.Sens;
            yaw -= m.Relative.X * s;
            pitch = Math.Clamp(pitch - m.Relative.Y * s * (Tuning.InvertY ? -1 : 1), -1.5f, 1.5f);
            Basis = Basis.FromEuler(new Vector3(pitch, yaw, 0), EulerOrder.Yxz);
        }
    }

    public override void _Process(double delta)
    {
        // only with the mouse taken (not under a sheet, the console or another window)
        if (Input.MouseMode != Input.MouseModeEnum.Captured) return;
        var d = Vector3.Zero;
        if (Keys.Down("forward") || Input.IsPhysicalKeyPressed(Key.Up)) d -= Basis.Z;
        if (Keys.Down("back") || Input.IsPhysicalKeyPressed(Key.Down)) d += Basis.Z;
        if (Keys.Down("left") || Input.IsPhysicalKeyPressed(Key.Left)) d -= Basis.X;
        if (Keys.Down("right") || Input.IsPhysicalKeyPressed(Key.Right)) d += Basis.X;
        if (Keys.Down("jump")) d += Vector3.Up;
        if (Keys.Down("crouch") || Input.IsPhysicalKeyPressed(Key.Ctrl)) d += Vector3.Down;
        bool fast = Keys.Down("hurry") || Input.IsPhysicalKeyPressed(Key.Shift);
        if (d.LengthSquared() > 0) Position += d.Normalized() * (fast ? Fast : Speed) * SpeedScale * (float)delta;
    }
}
