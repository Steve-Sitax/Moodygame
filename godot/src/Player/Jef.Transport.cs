using System;
using Godot;

namespace Scheldemist.Player;

public partial class Jef
{
    public Func<Vector2, Vector2, float, Vector2>? CartStep;
    /// <summary>A ride owns translation while the normal mouse look remains live.</summary>
    public Func<float, bool>? Drive;
    public Func<bool>? OnJump;
    public Func<float,float,float,float>? TransportFloor;
    public float DrivenEye = Eye;
    public float DrivenRoll;
    public bool Riding => Drive != null;
    public bool KeyDown(Key key) => K(key);
    public void DropFromBoat(Vector3 at)
    {Drive=null;DrivenEye=Eye;DrivenRoll=0;X=at.X;Y=at.Y;Z=at.Z;placing=false;vy=-1.5f;climb=null;EnterWater();}
    public void LaunchFromRide()
    {
        Drive = null; DrivenEye = Eye; Grounded = false; Swimming = false;
        placing = false; fallTop = Y; vy = JumpV; jumpHeld = true;
    }
    /// <summary>A ride lets go of him where he stands now (the foot of a ladder): on his feet, walking, the view as it is.</summary>
    public void StandOnFeet()
    {
        Drive = null; DrivenEye = Eye; DrivenRoll = 0;
        Grounded = true; Swimming = false; Diving = false; climb = null; placing = false;
        vel = Vector2.Zero; vy = 0; fallTop = Y; eye = Eye; stepLag = 0; bobAmp = 0;
        SetShape(0);
        Body.GlobalPosition = new Vector3(X, Y, Z);
        Landed?.Invoke();
    }
    /// <summary>A ride that walks him (a ship's deck, a boat's bottom boards) counts his steps as the street does: a footstep each stride.</summary>
    public void WalkedOn(float moved, bool hurry)
    {
        if (moved < 1e-4f) return;
        bobPhase += moved / StepLen * MathF.PI;
        int side = (int)MathF.Floor(bobPhase / MathF.PI);
        if (side != lastStepSide) Stepped?.Invoke(hurry);
        lastStepSide = side;
    }
    /// <param name="turnView">The view turns with the floor at once (a turning crane deck: browser carryTo), not after the look's easing.</param>
    public void Carry(Vector3 at, float yawDelta = 0, bool turnView = false)
    {
        X = at.X; Y = at.Y; Z = at.Z;
        Yaw += yawDelta;
        if (turnView) lookYaw += yawDelta;
        Grounded = true; Swimming = false; Diving = false; climb = null; SetShape(0);
        fallTop = Y; vy = 0; vel = Vector2.Zero;
        Body.GlobalPosition = at;
    }
}
