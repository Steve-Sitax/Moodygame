using Godot;

namespace Scheldemist.Native.Authoring;

public partial class WorkshopCamera : CharacterBody3D
{
    public Camera3D Eye { get; private set; } = null!;
    public bool Editing { get; private set; } = true;
    public Vector3? ProofDrive { get; set; }
    private float yaw, pitch = -0.35f;
    private Vector3 flyPosition;
    public override void _Ready()
    {
        Eye = GetNode<Camera3D>("Eye");
        yaw = Rotation.Y; Rotation = Vector3.Zero;
        Eye.Rotation = new(pitch, yaw, 0);
        CollisionLayer = 4; CollisionMask = 3;
    }
    public void SetEditing(bool editing)
    {
        if (editing == Editing) return;
        Input.MouseMode = Input.MouseModeEnum.Visible;
        if (!editing)
        {
            flyPosition = Position;
            // A test walk starts on a clear part of the pilot quay.
            Position = new(0, 0.02f, 8); pitch = 0;
        }
        else { Position = flyPosition; pitch = -0.35f; }
        Editing = editing; Velocity = Vector3.Zero;
        Eye.Rotation = new(pitch, yaw, 0);
    }
    public void Look(InputEventMouseMotion motion)
    {
        yaw -= motion.Relative.X * 0.003f;
        pitch = Mathf.Clamp(pitch - motion.Relative.Y * 0.003f, -1.45f, 1.45f);
        Eye.Rotation = new(pitch, yaw, 0);
    }
    public override void _PhysicsProcess(double delta)
    {
        float dt = (float)delta;
        var direction = ProofDrive ?? Vector3.Zero;
        bool active = Input.MouseMode == Input.MouseModeEnum.Captured;
        if (active && ProofDrive == null)
        {
            if (Input.IsPhysicalKeyPressed(Key.W)) direction -= Eye.GlobalBasis.Z;
            if (Input.IsPhysicalKeyPressed(Key.S)) direction += Eye.GlobalBasis.Z;
            if (Input.IsPhysicalKeyPressed(Key.A)) direction -= Eye.GlobalBasis.X;
            if (Input.IsPhysicalKeyPressed(Key.D)) direction += Eye.GlobalBasis.X;
            if (Editing)
            {
                if (Input.IsPhysicalKeyPressed(Key.E)) direction += Vector3.Up;
                if (Input.IsPhysicalKeyPressed(Key.Q)) direction -= Vector3.Up;
            }
        }
        if (Editing)
        {
            if (direction.LengthSquared() > 0) Position += direction.Normalized() * dt * (Input.IsPhysicalKeyPressed(Key.Shift) ? 15 : 6);
            return;
        }
        direction.Y = 0;
        direction = direction.Normalized();
        var v = Velocity;
        v.X = direction.X * 4; v.Z = direction.Z * 4;
        if (IsOnFloor())
        {
            v.Y = -0.2f;
            if (active && Input.IsPhysicalKeyPressed(Key.Space)) v.Y = 4.5f;
        }
        else v.Y -= 15 * dt;
        Velocity = v; MoveAndSlide();
    }
}
