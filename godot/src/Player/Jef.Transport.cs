using System;
using Godot;

namespace Scheldemist.Player;

public partial class Jef
{
    public Func<Vector2, Vector2, float, Vector2>? CartStep;
    /// <summary>A ride owns translation while the normal mouse look remains live.</summary>
    public Func<float, bool>? Drive;
    public Func<bool>? OnJump;
    public float DrivenEye = Eye;
    public bool Riding => Drive != null;
    public bool KeyDown(Key key) => K(key);
    public void LaunchFromRide()
    {
        Drive = null; DrivenEye = Eye; Grounded = false; Swimming = false;
        placing = false; fallTop = Y; vy = JumpV; jumpHeld = true;
    }
    public void Carry(Vector3 at, float yawDelta = 0)
    {
        X = at.X; Y = at.Y; Z = at.Z;
        Yaw += yawDelta;
        Grounded = true; Swimming = false; climb = null;
        fallTop = Y; vy = 0; vel = Vector2.Zero;
        Body.GlobalPosition = at;
    }
}
