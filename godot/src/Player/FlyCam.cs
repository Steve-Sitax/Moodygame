using System;
using Godot;

namespace Scheldemist.Player;

/// <summary>
/// The free camera (the browser's Fly mode, player/firstPerson.ts updateFly): a click takes the mouse, Esc gives it
/// back, W A S D move where it looks, Space rises, C or Ctrl sinks, Shift goes fast (12 and 45 m/s, as the browser's).
/// Dev mode's F9 takes it and gives it back to Jef (Dev/DevTools.cs).
/// </summary>
public partial class FlyCam : Camera3D
{
    public float Speed = 12, Fast = 45;
    private float yaw;
    private float pitch;

    public void Face(Quaternion q)
    {
        Quaternion = q;
        var e = Basis.GetEuler(EulerOrder.Yxz);
        yaw = e.Y;
        pitch = e.X;
    }

    public override void _UnhandledInput(InputEvent e)
    {
        if (e is InputEventMouseButton { Pressed: true } && Input.MouseMode != Input.MouseModeEnum.Captured) Input.MouseMode = Input.MouseModeEnum.Captured;
        else if (e is InputEventKey { Pressed: true, Keycode: Key.Escape }) Input.MouseMode = Input.MouseModeEnum.Visible;
        else if (e is InputEventMouseMotion m && Input.MouseMode == Input.MouseModeEnum.Captured)
        {
            yaw -= m.Relative.X * 0.0022f;
            pitch = Math.Clamp(pitch - m.Relative.Y * 0.0022f, -1.5f, 1.5f);
            Basis = Basis.FromEuler(new Vector3(pitch, yaw, 0), EulerOrder.Yxz);
        }
    }

    public override void _Process(double delta)
    {
        var d = Vector3.Zero;
        if (Input.IsKeyPressed(Key.W)) d -= Basis.Z;
        if (Input.IsKeyPressed(Key.S)) d += Basis.Z;
        if (Input.IsKeyPressed(Key.A)) d -= Basis.X;
        if (Input.IsKeyPressed(Key.D)) d += Basis.X;
        if (Input.IsKeyPressed(Key.Space)) d += Vector3.Up;
        if (Input.IsKeyPressed(Key.Ctrl) || Input.IsKeyPressed(Key.C)) d += Vector3.Down;
        if (d.LengthSquared() > 0) Position += d.Normalized() * (Input.IsKeyPressed(Key.Shift) ? Fast : Speed) * (float)delta;
    }
}
