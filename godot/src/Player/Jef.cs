using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>
/// Jef, the player, on foot (the browser's player/firstPerson.ts, same numbers): W A S D, mouse look, Shift to
/// hurry, C to stoop, Space to jump and to vault, head bob. Off an open quay edge he falls into the Schelde and
/// swims; he gets out up an iron ladder or onto the landing of a flight of steps (push into it, or E).
/// F is the free camera (the browser's Fly mode).
///
/// The browser walks by its own rules over a walk map; here Jef walks on Godot's physics over the baked town
/// (World/Solid.cs), with the browser's shape of a walker: a body that is solid from a step (0.36 m) above his feet
/// up to 1.75 m, and feet that stand on the highest thing under them that is no more than a step up. So kerbs and
/// stairs are walked up, and anything higher is a wall.
/// </summary>
[GamePart(20)]
public partial class Jef : Node, Mantle.IWorld
{
    public const float Eye = 1.62f;
    public const float EyeCrouch = 1.05f;
    public const float JumpV = 4.6f; // m/s up: clears about 0.55 m, onto a crate with the step
    public const float Gravity = 16;
    public const float Walk = 1.55f; // m/s, a tired man on wet stones
    public const float Hurry = 3.4f;
    public const float Radius = 0.32f;
    public const float StepLen = 0.72f; // metres per footstep
    public const float TurnSens = 0.0019f;
    public const float Swim = 1.0f; // m/s, heavy clothes in cold water
    public const float SwimFast = 1.6f; // Shift: a hard crawl
    public const float SwimFeet = 1.45f; // feet this far under the surface while you swim
    public const float SwimEye = 0.17f; // eye this far above it
    public const float Climb = 1.1f; // m/s up a ladder
    public const float StrokeLen = 0.9f; // metres per swim stroke
    /// <summary>Things with a top lower than feet + Step can be walked onto (rijnkaai.ts STEP).</summary>
    public const float Step = 0.36f;
    /// <summary>The body is solid up to here over the feet (modelCollision.ts).</summary>
    public const float Tall = 1.75f;
    /// <summary>
    /// A drop of more than this under the feet is a fall. The browser has 0.12 over the smooth slope it lays on the
    /// quay steps; here the real treads are walked (0.185 m each), so one tread down is still a step.
    /// </summary>
    private const float Drop = 0.2f;
    /// <summary>The physics layer of the player's body.</summary>
    public const uint Layer = 2;

    public static Jef I { get; private set; } = null!;

    /// <summary>The player's own look settings (the browser's `look`): mouse speed, up and down turned round, head bob (0: none).</summary>
    /// <summary>The mouse speed and its up and down turned round: the player's settings (Menu.Tuning, set by Apply).</summary>
    public float LookSens { get => Menu.Tuning.Sens; set => Menu.Tuning.Sens = value; }
    public bool InvertY { get => Menu.Tuning.InvertY; set => Menu.Tuning.InvertY = value; }
    public float Bob = 1;

    /// <summary>Feet: X and Z on the map, Y the height (quay top 0).</summary>
    public float X, Y, Z;
    public float Yaw, Pitch;
    /// <summary>Slower when carrying (the job code), slower when dead tired (the sleep need).</summary>
    public float SpeedFactor = 1, Fatigue = 1;
    /// <summary>No walking while a paper is up in front of your face.</summary>
    public bool Frozen;
    /// <summary>Carrying goods: no jumping.</summary>
    public bool Laden;
    public bool Crouching { get; private set; }
    public bool Hurrying { get; private set; }
    public bool Grounded { get; private set; } = true;
    public bool Swimming { get; private set; }
    /// <summary>Under the water, holding his breath.</summary>
    public bool Diving { get; private set; }
    public bool Climbing => climb != null;
    public bool Fly { get; private set; }
    /// <summary>He pushes on and something solid holds him (for the checks).</summary>
    public bool Blocked { get; private set; }
    /// <summary>Times he fell out of the world and was set back (should stay 0).</summary>
    public int Rescued { get; private set; }
    /// <summary>Milliseconds the start waited for the ground round the first place to be made solid.</summary>
    public double StartMs { get; private set; }

    /// <summary>A footstep (true: hurrying); landed; a fall of 3 m or more ended (metres, into water or not); hit the water; a swim stroke; out of the water.</summary>
    public event Action<bool>? Stepped;
    public event Action? Landed;
    public event Action<float, bool>? Fell;
    public event Action? Splashed;
    public event Action? Stroke;
    public event Action? ClimbedOut;

    /// <summary>Checks only: keys come from SetKey, not from the keyboard.</summary>
    public bool TestInput;
    private readonly HashSet<Key> testKeys = new();

    public CharacterBody3D Body { get; private set; } = null!;
    public Camera3D Cam { get; private set; } = null!;
    private CylinderShape3D bodyShape = null!;
    private CollisionShape3D bodyCol = null!;
    private readonly Dictionary<int, CylinderShape3D> disks = new();
    private FlyCam? fly;
    private bool shots;

    private Vector2 vel;
    private float vy;
    private bool jumpHeld;
    private float jumpBase;
    private float mantleWait;
    private float eye = Eye;
    private float fallTop = float.NegativeInfinity;
    private float bobPhase, bobAmp;
    private int lastStepSide;
    private float lookYaw, lookPitch;
    private float swimT, strokeDist;
    private float stepLag;
    private ulong holdTick;
    private Vector3 safe;
    private float safeT;

    /// <summary>A climb or a vault: one smooth curve (Glide) in the world or in a moving frame (a ship's deck).</summary>
    private sealed class ClimbRun
    {
        public Glide Path = null!;
        public float T;
        public Action? Then;
        public Func<Transform3D>? Frame;
        /// <summary>The key up the rungs of a ladder (hand over hand), or -1.</summary>
        public int Rungs = -1;
        /// <summary>Where the view was against the plain eye when it began (a bob, a stoop, the swim): eased away.</summary>
        public Vector3 Off;
        public float Roll;
        /// <summary>A way to turn to over the first part of the climb (down a ladder: to face the rungs), or null.</summary>
        public float? Face;
        public float Yaw0;
    }
    private ClimbRun? climb;

    // the jump as in a good first-person game (2026-10-11, Steve: "it seems scripted and not natural behaviour like in
    // a fps"): the jump leaves at once, flies a real arc that keeps the run's speed, steers a little in the air, still
    // goes a moment after the edge (coyote time) and a press just before landing is kept (the jump buffer)
    public const float Coyote = 0.12f;
    public const float JumpBuffer = 0.15f;
    /// <summary>How fast the air turns his speed toward the keys (1/s; on the ground 6).</summary>
    public const float AirControl = 1.4f;
    private float coyoteT, bufferT;
    private bool jumpedOff;
    /// <summary>The view's dip as the legs take a landing: a spring, metres down (negative) and m/s.</summary>
    private float dip, dipV;
    /// <summary>The last jump's measures (for the move check): when it left, its top, its time in the air.</summary>
    public (ulong Frame, float From, float Top, float Air, float Impact) LastJump { get; private set; }
    private float airT;
    /// <summary>The landing dip of the view now (m, negative: down).</summary>
    public float ViewDip => dip;
    /// <summary>The time step of his last move (for the checks).</summary>
    public float FrameDt { get; private set; }
    /// <summary>His own time: the sum of the steps he moved by (for the checks).</summary>
    public double Clock { get; private set; }

    public override void _Ready()
    {
        I = this;
        var view = Main.I.View;
        fly = Main.I.Cam as FlyCam;
        shots = Main.I.Arg("shots") != "";
        QuayExits.Build(Main.I.World);

        Body = new CharacterBody3D { Name = "jef_body", CollisionLayer = Layer, CollisionMask = Solid.Layer, MotionMode = CharacterBody3D.MotionModeEnum.Floating };
        bodyShape = new CylinderShape3D { Radius = Radius, Height = Tall - Step };
        bodyCol = new CollisionShape3D { Shape = bodyShape, Position = new Vector3(0, Step + (Tall - Step) / 2, 0) };
        Body.AddChild(bodyCol);
        view.AddChild(Body);
        floorCast = new ShapeCast3D { Name = "floor_cast", Enabled = false, ExcludeParent = false, CollisionMask = Solid.Layer, Margin = 0, MaxResults = 0 };
        floorRay = new RayCast3D { Name = "floor_ray", Enabled = false, ExcludeParent = false, CollisionMask = Solid.Layer };
        view.AddChild(floorCast); view.AddChild(floorRay);

        var from = Main.I.Cam;
        Cam = new Camera3D { Name = "jef_eyes", Fov = from?.Fov ?? 75, Near = from?.Near ?? 0.08f, Far = from?.Far ?? 600 };
        view.AddChild(Cam);

        // the first baked place: the browser's camera there, feet on the ground under it
        var start = from != null ? from.GlobalPosition : new Vector3(-118, Eye, 36);
        var e = from != null ? from.GlobalBasis.GetEuler(EulerOrder.Yxz) : Vector3.Zero;
        ulong t0 = Time.GetTicksUsec();
        Place(start.X, start.Z, e.Y, e.X, start.Y - Eye);
        StartMs = (Time.GetTicksUsec() - t0) / 1000.0;
        GD.Print($"jef: the ground round the start is solid in {StartMs:0} ms ({Solid.I.Built} shapes, {Solid.I.Triangles} triangles)");
        // his own figure (the browser shows it to others and in mirrors only) is not in his own view
        if (Main.I.World.FindChild("player_figure", true, false) is Node3D figure) figure.Visible = false;
        if (shots) return; // the pictures are taken from the free camera; Jef only stands there
        TakeCamera();
    }

    private void TakeCamera()
    {
        Fly = false;
        if (fly != null)
        {
            fly.SetProcess(false);
            fly.SetProcessUnhandledInput(false);
        }
        Cam.Current = true;
        Main.I.Cam = Cam;
    }

    /// <summary>The free camera and back (dev mode's F9). Coming back, Jef stands under where the camera was.</summary>
    public void ToggleFly()
    {
        if (fly == null) return;
        if (!Fly)
        {
            Fly = true;
            fly.Position = Cam.GlobalPosition;
            fly.Face(Cam.GlobalBasis.GetRotationQuaternion());
            fly.SetProcess(true);
            fly.SetProcessUnhandledInput(true);
            fly.Current = true;
            Main.I.Cam = fly;
            return;
        }
        var p = fly.GlobalPosition;
        var e = fly.GlobalBasis.GetEuler(EulerOrder.Yxz);
        Place(p.X, p.Z, e.Y, e.X, p.Y - Eye);
        TakeCamera();
    }

    /// <summary>Put Jef down at (x, z), looking along yaw: on the ground under `near` (a height; default the quay top).</summary>
    public void Place(float x, float z, float yaw, float pitch = 0, float near = 0)
    {
        X = x;
        Z = z;
        Y = near;
        Yaw = lookYaw = yaw;
        Pitch = lookPitch = Math.Clamp(pitch, -1.35f, 1.35f);
        vel = Vector2.Zero;
        vy = 0;
        Grounded = true;
        Swimming = false;
        Diving = false;
        Breath = BreathMax;
        SetShape(0);
        climb = null;
        dip = dipV = 0;
        bobAmp = 0;
        Crouching = Hurrying = false;
        eye = Eye;
        stepLag = 0;
        fallTop = float.NegativeInfinity;
        placing = true;
        safe = new Vector3(x, near, z);
        Solid.I.Ensure(new Vector3(x, near, z), 14);
        holdTick = Engine.GetPhysicsFrames() + 1;
        Body.GlobalPosition = new Vector3(X, Y, Z);
        Look(0, 0, 0);
    }
    private bool placing;

    public void SetKey(Key k, bool down)
    {
        if (down) testKeys.Add(k);
        else testKeys.Remove(k);
    }
    public void ClearKeys() => testKeys.Clear();

    private bool Active => (TestInput || Input.MouseMode == Input.MouseModeEnum.Captured) && !Frozen;
    private bool K(Key k) => Active && (TestInput ? testKeys.Contains(k) : Input.IsPhysicalKeyPressed(k));

    public override void _UnhandledInput(InputEvent e)
    {
        if (shots) return;
        // (the free camera is dev mode's F9, Dev/DevTools.cs: F is the Second choice key). Flying, the mouse is the
        // free camera's: it is in the game's SubViewport, which the window's mouse events never reach
        if (Fly)
        {
            if (e is InputEventMouse) fly?.Handle(e);
            return;
        }
        if (e is InputEventMouseButton { Pressed: true } && Input.MouseMode != Input.MouseModeEnum.Captured) Input.MouseMode = Input.MouseModeEnum.Captured;
        else if (e is InputEventKey { Pressed: true, Keycode: Key.Escape }) Input.MouseMode = Input.MouseModeEnum.Visible;
        else if (e is InputEventMouseMotion m && Input.MouseMode == Input.MouseModeEnum.Captured && !TestInput)
        {
            Yaw -= m.Relative.X * TurnSens * LookSens;
            Pitch -= m.Relative.Y * TurnSens * LookSens * (InvertY ? -1 : 1);
            Pitch = Math.Clamp(Pitch, -1.35f, 1.35f);
        }
    }

    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Player.Jef");
        if (Fly) return;
        float dt = (float)Math.Min(delta, 0.05);
        FrameDt = dt;
        Clock += dt;
        if (Drive != null && Drive(dt)) { Body.GlobalPosition = new Vector3(X, Y, Z); Look(dt, 0, DrivenRoll, DrivenEye); return; }
        // the ground a few metres round him is solid before he steps on it (the rest is made a little every frame)
        if (Solid.I.Ensure(new Vector3(X, Y, Z), 14) > 0) holdTick = Engine.GetPhysicsFrames() + 1;
        if (Engine.GetPhysicsFrames() <= holdTick)
        {
            Look(dt, 0, 0);
            return;
        }
        if (placing)
        {
            // down onto the ground under the spot he was put at
            placing = false;
            float g = GroundAt(X, Z, Y + 0.5f);
            if (float.IsFinite(g)) Y = g;
            safe = new Vector3(X, Y, Z);
        }
        if (climb != null) UpdateClimb(dt);
        else if (Swimming) UpdateSwim(dt);
        else UpdateWalk(dt);
        Body.GlobalPosition = new Vector3(X, Y, Z);
    }

    // ------------------------------------------------------------ what the physics knows

    private PhysicsDirectSpaceState3D Space => Body.GetWorld3D().DirectSpaceState;
    private readonly PhysicsShapeQueryParameters3D castQ = new() { CollisionMask = Solid.Layer, Margin = 0 };
    private readonly PhysicsShapeQueryParameters3D bodyQ = new() { CollisionMask = Solid.Layer, Margin = 0 };
    private ShapeCast3D floorCast = null!;
    private RayCast3D floorRay = null!;

    private CylinderShape3D Disk(float r)
    {
        int k = (int)MathF.Round(Math.Max(r, 0.03f) * 1000);
        if (!disks.TryGetValue(k, out var d)) disks[k] = d = new CylinderShape3D { Radius = k / 1000f, Height = 0.02f };
        return d;
    }

    /// <summary>
    /// The height to stand on at (x, z) with the feet at `feet`: the highest top under a disk of radius r that is no
    /// more than a step above the feet (rijnkaai.ts groundAt, modelCollision.ts topAt). Nothing below: -infinity.
    /// </summary>
    public float GroundAt(float x, float z, float feet, float r = Radius * 0.6f)
        => Scheldemist.Dev.SpeedComparison.Cached ? GroundCached(x, z, feet, r) : GroundOriginal(x, z, feet, r);

    private float GroundCached(float x, float z, float feet, float r)
    {
        float deck = TransportFloor?.Invoke(x, z, feet) ?? float.NegativeInfinity;
        float top = feet + Step, y0 = top + 0.015f;
        floorCast.Shape = Disk(r);
        for (int i = 0; i < 2; i++)
        {
            float start = i == 0 ? y0 : y0 - 1.2f, len = i == 0 ? 1.2f : 60f;
            floorCast.Transform = new Transform3D(Basis.Identity, new Vector3(x, start, z));
            floorCast.TargetPosition = new Vector3(0, -len, 0);
            // MaxResults=0 keeps precisely cast_motion's fractions, without collecting contacts or a C# array.
            floorCast.ForceShapecastUpdate();
            float safe = floorCast.GetClosestCollisionSafeFraction(), unsafeFraction = floorCast.GetClosestCollisionUnsafeFraction();
            if (unsafeFraction >= 1) continue;
            if (unsafeFraction <= 0 && start == y0)
            {
                floorRay.Transform = new Transform3D(Basis.Identity, new Vector3(x, top, z));
                floorRay.TargetPosition = new Vector3(0, -60, 0);
                floorRay.ForceRaycastUpdate();
                return Math.Max(deck, floorRay.IsColliding() ? floorRay.GetCollisionPoint().Y : float.NegativeInfinity);
            }
            return Math.Max(deck, start - 0.01f - safe * len);
        }
        return deck;
    }

    public bool SameGround(float x, float z, float feet, float r)
        => GroundCached(x, z, feet, r).Equals(GroundOriginal(x, z, feet, r));

    private float GroundOriginal(float x, float z, float feet, float r)
    {
        float deck = TransportFloor?.Invoke(x, z, feet) ?? float.NegativeInfinity;
        float top = feet + Step;
        castQ.Shape = Disk(r);
        float y0 = top + 0.015f; // the disk's middle; its underside 5 mm over the step height
        foreach (var (start, len) in new[] { (y0, 1.2f), (y0 - 1.2f, 60f) })
        {
            castQ.Transform = new Transform3D(Basis.Identity, new Vector3(x, start, z));
            castQ.Motion = new Vector3(0, -len, 0);
            var hit = Space.CastMotion(castQ);
            if (hit[1] >= 1) continue; // nothing on the way
            if (hit[1] <= 0 && start == y0)
            {
                // the disk starts in something (a slope steeper than a step): ask a ray down the middle
                var ray = Space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x, top, z), new Vector3(x, top - 60, z), Solid.Layer));
                return Math.Max(deck, ray.Count > 0 ? ray["position"].AsVector3().Y : float.NegativeInfinity);
            }
            return Math.Max(deck, start - 0.01f - hit[0] * len);
        }
        return deck;
    }

    /// <summary>The body (from a step over the feet up to 1.75 m) fits at (x, z) with the feet at y.</summary>
    public bool BodyFree(float x, float y, float z)
    {
        bodyQ.Shape = bodyShape;
        bodyQ.Transform = new Transform3D(Basis.Identity, new Vector3(x, y + Step + (Tall - Step) / 2, z));
        return Space.IntersectShape(bodyQ, 1).Count == 0;
    }

    /// <summary>May he stand at (x, z) with his feet at `feet`? (rijnkaai.ts standFree)</summary>
    public bool StandFree(float x, float z, float feet) => Math.Abs(GroundAt(x, z, feet) - feet) <= Step && BodyFree(x, feet, z);

    /// <summary>Walk by (dx, dz) with the feet at `feet`: slides along what is solid. Returns the metres moved.</summary>
    private float MoveBy(float dx, float dz, float feet)
    {
        Body.GlobalPosition = new Vector3(X, feet, Z);
        var want = new Vector3(dx, 0, dz);
        var rem = want;
        for (int i = 0; i < 4 && rem.LengthSquared() > 1e-10f; i++)
        {
            var hit = Body.MoveAndCollide(rem, false, 0.002f);
            if (hit == null) break;
            var n = hit.GetNormal();
            n.Y = 0;
            if (n.LengthSquared() < 1e-4f) break;
            n = n.Normalized();
            rem = hit.GetRemainder();
            rem.Y = 0;
            rem = rem.Slide(n);
            if (rem.Dot(want) <= 0) break;
        }
        var p = Body.GlobalPosition;
        float moved = MathF.Sqrt((p.X - X) * (p.X - X) + (p.Z - Z) * (p.Z - Z));
        X = p.X;
        Z = p.Z;
        return moved;
    }

    // ------------------------------------------------------------ on foot

    private void UpdateWalk(float dt)
    {
        SetShape(0);
        float fx = 0, fz = 0;
        if (K(Key.W) || K(Key.Up)) fz -= 1;
        if (K(Key.S) || K(Key.Down)) fz += 1;
        if (K(Key.A) || K(Key.Left)) fx -= 1;
        if (K(Key.D) || K(Key.Right)) fx += 1;
        Crouching = K(Key.C) || K(Key.Ctrl);
        bool hurry = K(Key.Shift) && !Crouching;
        float len = MathF.Sqrt(fx * fx + fz * fz);
        Hurrying = hurry && len > 0;
        float speed = (hurry ? Hurry : Walk) * SpeedFactor * Fatigue * (Crouching ? 0.5f : 1);
        float sin = MathF.Sin(Yaw), cos = MathF.Cos(Yaw);

        // Tap to jump, keep holding to try a reachable ledge. Each jump starts only once per press. In the air, a
        // fresh press tries at once; held, every few frames.
        bool space = K(Key.Space), pressed = space && !jumpHeld;
        jumpHeld = space;
        bufferT = pressed ? JumpBuffer : Math.Max(0, bufferT - dt);
        if (Grounded) { coyoteT = Coyote; jumpedOff = false; }
        else coyoteT = Math.Max(0, coyoteT - dt);
        if (pressed && !Laden && OnJump?.Invoke() == true) return;
        if (Grounded) jumpBase = Y;
        mantleWait = Math.Max(0, mantleWait - dt);
        if (space && !Laden && !Crouching && (mantleWait == 0 || (pressed && !Grounded)))
        {
            mantleWait = .12f;
            var route = Mantle.Find(this, new Mantle.Point(X, Y, Z), -sin, -cos, jumpBase);
            if (route != null)
            {
                bool air = !Grounded, wet = route[^1].Water || route[^1].Fall;
                var keys = (wet ? route[..^1] : route).Select((p, i) => (new Vector3(p.X, p.Y, p.Z), i == 0 ? (air ? .2f : .32f) : i == 1 ? (air ? .32f : .4f) : .3f)).ToList();
                // one swing up and over, carrying the run's speed in and out: no stop at the top of the rail
                var v0 = new Vector3(vel.X, Grounded ? 0 : vy, vel.Y).LimitLength(2.5f);
                var last = keys[^1].Item1;
                var over = new Vector3(last.X - keys[0].Item1.X, 0, last.Z - keys[0].Item1.Z);
                float carry = Math.Clamp(new Vector2(vel.X, vel.Y).Length(), wet ? 1.2f : 0.4f, Walk);
                var v1 = over.LengthSquared() > 1e-4f ? over.Normalized() * carry * (wet ? 1 : 0.8f) : Vector3.Zero;
                ClimbTo(keys, () =>
                {
                    vy = 0;
                    mantleWait = .25f;
                    vel = new Vector2(v1.X, v1.Z);
                    // over a railing into the water or off a height: he drops from the top of the vault
                    if (wet)
                    {
                        Grounded = false;
                        fallTop = Y;
                        coyoteT = 0;
                        jumpedOff = true;
                        return;
                    }
                    Grounded = true;
                    Landed?.Invoke();
                }, null, v0, v1, -1, 3.2f);
                return;
            }
        }
        if (bufferT > 0 && !Laden && !Crouching && (Grounded || (coyoteT > 0 && !jumpedOff)))
        {
            // off at once, from the ground or a moment after the edge; the run's speed goes with him
            vy = JumpV;
            Grounded = false;
            jumpedOff = true;
            coyoteT = bufferT = 0;
            fallTop = Y;
            airT = 0;
            LastJump = (Engine.GetProcessFrames(), Y, Y, 0, 0);
        }

        // wish velocity in world space
        float wx = 0, wz = 0;
        if (len > 0)
        {
            fx /= len;
            fz /= len;
            wx = (fx * cos + fz * sin) * speed;
            wz = (-fx * sin + fz * cos) * speed;
        }
        // heavy start and stop on the ground; in the air the speed he jumped with goes on, the keys steer a little
        float a = Grounded ? 1 - MathF.Exp(-dt * (len > 0 ? 6 : 9)) : len > 0 ? 1 - MathF.Exp(-dt * AirControl) : 1 - MathF.Exp(-dt * 0.1f);
        vel.X += (wx - vel.X) * a;
        vel.Y += (wz - vel.Y) * a;

        float wanted = vel.Length() * dt;
        var cartFrom = new Vector2(X, Z);
        float moved = MoveBy(vel.X * dt, vel.Y * dt, Y);
        if (CartStep != null)
        {
            var p = CartStep(cartFrom, new Vector2(X, Z), dt);
            X = p.X; Z = p.Y; Body.GlobalPosition = new Vector3(X, Y, Z);
            moved = p.DistanceTo(cartFrom);
        }
        Blocked = len > 0 && wanted > 1e-5f && moved < wanted * 0.3f;

        float ground = GroundAt(X, Z, Y);
        float level = Water.Level(X, Z);
        // walked off an edge (down steps and slopes you stay on your feet)
        if (Grounded && ground < Y - Drop) Grounded = false;
        if (!Grounded)
        {
            fallTop = Math.Max(fallTop, Y);
            airT += dt;
            // the true arc whatever the frame rate: the height from the mean speed over the frame
            float v0 = vy;
            vy = Math.Max(vy - Gravity * dt, -45);
            if (vy > 0)
            {
                // a ceiling over a jump
                Body.GlobalPosition = new Vector3(X, Y, Z);
                if (Body.TestMove(Body.GlobalTransform, new Vector3(0, vy * dt, 0))) v0 = vy = 0;
            }
            Y += (v0 + vy) * 0.5f * dt;
            if (LastJump.Frame > 0 && Y > LastJump.Top) LastJump = LastJump with { Top = Y };
            if (Y <= level && Water.In(X, Z) && ground < level - Tide.Wade)
            {
                float h = fallTop - Y;
                fallTop = float.NegativeInfinity;
                if (h >= 3) Fell?.Invoke(h, true);
                EnterWater();
                return;
            }
            if (Y <= ground)
            {
                float h = fallTop - ground;
                fallTop = float.NegativeInfinity;
                Y = ground;
                Land(-vy);
                vy = 0;
                Grounded = true;
                Landed?.Invoke();
                // a fall of 3 m or more: the engine judges the harm
                if (h >= 3) Fell?.Invoke(h, false);
            }
            else if (Y < Tide.LwMin - 6)
            {
                // under the town with no ground and no water: a hole in the world. Back to where he last stood.
                Rescued++;
                GD.PrintErr($"Jef fell out of the world at {X:0.0}, {Z:0.0}: set back");
                Place(safe.X, safe.Z, Yaw, Pitch, safe.Y);
                return;
            }
        }
        else
        {
            stepLag = Math.Clamp(stepLag + (Y - ground), -0.5f, 0.5f); // the eye follows a step up or down softly
            Y = ground; // step up onto low things
            fallTop = Y;
            safeT += dt;
            if (safeT > 0.5f)
            {
                safeT = 0;
                safe = new Vector3(X, Y, Z);
            }
        }
        // M6 tides: down a flight of steps into deep water (or the tide came up round you): swim
        if (Grounded && Y < level - Tide.Wade && Water.In(X, Z))
        {
            EnterWater();
            return;
        }
        eye += ((Crouching ? EyeCrouch : Eye) - eye) * (1 - MathF.Exp(-dt * 10));
        stepLag *= MathF.Exp(-dt * 14);

        // head bob follows distance walked: one full cycle = two steps
        bool moving = moved / Math.Max(dt, 1e-4f) > 0.25f && Grounded;
        bobAmp += ((moving ? 1 : 0) - bobAmp) * (1 - MathF.Exp(-dt * 5));
        bobPhase += moved / StepLen * MathF.PI;
        int side = (int)MathF.Floor(bobPhase / MathF.PI);
        if (moving && side != lastStepSide) Stepped?.Invoke(hurry);
        lastStepSide = side;

        float bobY = -MathF.Abs(MathF.Sin(bobPhase)) * 0.045f * bobAmp * (hurry ? 1.4f : 1) * Bob;
        float bobX = MathF.Cos(bobPhase) * 0.025f * bobAmp * Bob;
        Look(dt, bobX, MathF.Cos(bobPhase) * 0.004f * bobAmp * Bob, eye + bobY + stepLag);
    }

    /// <summary>The legs take a landing at this speed (m/s down): the view dips and comes up again.</summary>
    private void Land(float impact)
    {
        if (LastJump.Frame > 0 && LastJump.Air == 0) LastJump = LastJump with { Air = airT, Impact = impact };
        airT = 0;
        // a step down is nothing; a jump on the flat about 6 cm; a drop of a few metres 15 cm
        if (impact > 1.6f) dipV = Math.Min(dipV, -Math.Min(impact, 14) * 0.42f);
    }

    /// <summary>The view: a slow turn (it lags the mouse a little), the eye at `up` over the feet, `side` to the right.</summary>
    private void Look(float dt, float side, float roll, float up = Eye)
    {
        float s = 1 - MathF.Exp(-dt * 22);
        lookYaw += (Yaw - lookYaw) * s;
        lookPitch += (Pitch - lookPitch) * s;
        // the landing dip: a stiff, fully damped spring (down and back in about a fifth of a second)
        for (float left = dt; left > 1e-5f;)
        {
            float h = Math.Min(left, 1 / 120f);
            const float w = 11;
            dipV += (-w * w * dip - 2 * w * dipV) * h;
            dip += dipV * h;
            left -= h;
        }
        if (MathF.Abs(dip) < 1e-4f && MathF.Abs(dipV) < 1e-3f) dip = dipV = 0;
        float sin = MathF.Sin(Yaw), cos = MathF.Cos(Yaw);
        Cam.GlobalPosition = new Vector3(X + cos * side, Y + up + dip * Bob, Z - sin * side);
        Cam.Rotation = new Vector3(lookPitch + dip * 0.35f * Bob, lookYaw, roll);
    }

    // ------------------------------------------------------------ in the water: Jef.Swim.cs

    /// <summary>
    /// The spot at the top can hold a crane's leg or a wagon: step off beside it, wherever you can stand. The feet go
    /// onto the stone as it is there (a step of a flight may lie a little higher or lower than its number says).
    /// </summary>
    private (float x, float z, float y) ClimbSpot(Exit e)
    {
        foreach (float d in new[] { 0f, 0.4f, 0.8f, 1.2f })
            foreach (float s in new[] { 0f, 0.6f, -0.6f, 1.2f, -1.2f })
            {
                float x = e.Tx - e.Nx * d - e.Nz * s;
                float z = e.Tz - e.Nz * d + e.Nx * s;
                float g = GroundAt(x, z, e.Ty + 0.2f);
                if (float.IsFinite(g) && Math.Abs(g - e.Ty) < 0.45f && StandFree(x, z, g)) return (x, z, g);
            }
        return (e.Tx, e.Tz, e.Ty);
    }

    private void StartClimb(Exit e)
    {
        float floatY = Swimming ? Water.Level(X, Z) - SwimFeet : Y; // (afloat, or on his feet on the mud below a ladder)
        var keys = new List<(Vector3, float)>();
        var (tx, tz, ty) = ClimbSpot(e);
        int rungs = -1;
        if (e.Ladder)
        {
            // in to the rungs, hand over hand up them, and over the hoop onto the quay: one move, no stop at the top
            float lx = e.Gx - e.Nx * 0.12f, lz = e.Gz - e.Nz * 0.12f;
            keys.Add((new Vector3(lx, floatY, lz), 0.45f));
            keys.Add((new Vector3(lx, e.Ty + 0.15f, lz), (e.Ty + 0.15f - floatY) / Climb));
            rungs = 1;
            keys.Add((new Vector3(lx - e.Nx * 0.45f, e.Ty + 0.32f, lz - e.Nz * 0.45f), 0.45f));
            keys.Add((new Vector3(tx, ty, tz), 0.5f));
        }
        else if (e.Over > 0)
        {
            // out over a parapet with a handrail on it: up the face, a leg over the rail, down onto the tread
            float up = e.Over + 0.12f;
            keys.Add((new Vector3(e.Gx, floatY, e.Gz), 0.35f));
            keys.Add((new Vector3(e.Gx - e.Nx * 0.3f, up, e.Gz - e.Nz * 0.3f), 0.35f + (up - floatY) / 1.6f));
            keys.Add((new Vector3(e.Gx - e.Nx * 0.95f, up, e.Gz - e.Nz * 0.95f), 0.55f));
            keys.Add((new Vector3(tx, ty, tz), 0.5f));
        }
        else
        {
            keys.Add((new Vector3(e.Gx, floatY, e.Gz), 0.35f));
            keys.Add((new Vector3(e.Gx - e.Nx * 0.45f, e.Ty + 0.12f, e.Gz - e.Nz * 0.45f), 1.1f));
            keys.Add((new Vector3(tx, ty, tz), 0.5f));
        }
        ClimbTo(keys, null, null, new Vector3(vel.X, vy, vel.Y), default, rungs);
    }

    /// <summary>
    /// Where a climb down this quay ladder ends (issue 85): afloat just clear of the stiles where the water is deep
    /// enough, else on his feet on the mud at its foot (a spring low water), or null when there is no room for him.
    /// </summary>
    public (Vector3 At, bool Swim)? LadderFoot(Exit e)
    {
        if (!e.Ladder) return null;
        float fx = e.Gx + e.Nx * 0.05f, fz = e.Gz + e.Nz * 0.05f, level = Water.Level(fx, fz);
        if (e.Ty < level + 0.3f) return null;
        float floor = GroundAt(fx, fz, e.Ty - 1.0f);
        if (SwimFree(fx, fz) && !(floor > level - Tide.Wade)) return (new Vector3(fx, level - SwimFeet, fz), true);
        if (float.IsFinite(floor) && floor < e.Ty - 1.2f && StandFree(fx, fz, floor)) return (new Vector3(fx, floor, fz), false);
        return null;
    }

    /// <summary>
    /// Down a quay ladder (issue 85): over the coping between the hoops, turning to face the rungs, hand under hand
    /// down them, and off into a swim just clear of the stiles, or onto the mud at a low spring tide. The line of the
    /// climb out, the other way.
    /// </summary>
    public void ClimbDown(Exit e)
    {
        if (Climbing || LadderFoot(e) is not { } foot) return;
        float lx = e.Gx - e.Nx * 0.12f, lz = e.Gz - e.Nz * 0.12f;
        var keys = new List<(Vector3, float)>
        {
            (new Vector3(lx - e.Nx * 0.45f, e.Ty + 0.32f, lz - e.Nz * 0.45f), 0.55f),
            (new Vector3(lx, e.Ty + 0.15f, lz), 0.45f),
            (new Vector3(lx, foot.At.Y + 0.25f, lz), Math.Max(0.3f, (e.Ty + 0.15f - foot.At.Y - 0.25f) / Climb)),
            (foot.At, 0.45f),
        };
        ClimbTo(keys, foot.Swim ? () => { vy = 0; EnterWater(); } : null, null, null, default, 1);
        climb!.Face = MathF.Atan2(e.Nx, e.Nz);
        climb.Yaw0 = Yaw;
    }

    /// <summary>Up a quay ladder from the mud at its foot (the swimmer's way up is the same, StartClimb).</summary>
    public void ClimbUp(Exit e)
    {
        if (!Climbing && e.Ladder) StartClimb(e);
    }

    /// <summary>The fastest a climb goes between its keys (m/s); with the rounded corners its top speed stays near 2 m/s, about 3 cm a frame at 60 frames a second.</summary>
    public const float ClimbMax = 1.3f;

    /// <summary>
    /// A climb along key points (x, y, z, seconds each from the last): no control meanwhile, one smooth move that
    /// starts with his speed `v0` (default: as he moves now) and ends with `v1`. `then` runs at the end instead of
    /// landing. With `frame` the points are in that moving frame (a ship's deck). `rungs`: the key up a ladder.
    /// </summary>
    public void ClimbTo(IEnumerable<(Vector3, float)> keys, Action? then, Func<Transform3D>? frame = null, Vector3? v0 = null, Vector3 v1 = default, int rungs = -1, float maxSpeed = ClimbMax)
    {
        var from = new Vector3(X, Y, Z);
        var speed = (v0 ?? new Vector3(vel.X, Grounded ? 0 : vy, vel.Y)).LimitLength(2.5f);
        if (frame != null)
        {
            var f = frame();
            from = f.AffineInverse() * from;
            speed = f.Basis.Inverse() * speed;
        }
        SetShape(0);
        bobAmp = 0;
        climb = new ClimbRun { Path = new Glide(from, keys.ToList(), speed, v1, 0.8f, maxSpeed), Then = then, Frame = frame, Rungs = rungs, Off = Cam.GlobalPosition - new Vector3(X, Y + Eye, Z), Roll = Cam.Rotation.Z };
        Swimming = false;
        Diving = false;
        Blocked = false;
        vel = Vector2.Zero;
        vy = 0;
    }

    private void UpdateClimb(float dt)
    {
        var c = climb!;
        c.T += dt;
        if (c.Face is { } face && c.T - dt < 0.8f) Yaw =Mathf.LerpAngle(c.Yaw0, face, Mathf.SmoothStep(0, 1, c.T / 0.8f));
        var at = c.Path.At(c.T);
        if (c.Frame != null) at = c.Frame() * at;
        (X, Y, Z) = (at.X, at.Y, at.Z);
        if (c.T >= c.Path.Duration)
        {
            climb = null;
            if (c.Then != null) c.Then();
            else
            {
                Grounded = true;
                eye = Eye;
                Landed?.Invoke();
                ClimbedOut?.Invoke();
            }
        }
        // hand over hand: a small pull on every rung, eased in and out with the climb
        float pull = 0;
        if (c.Rungs >= 0)
        {
            // as strong as he goes up the rungs (so it fades in and out with the climb, never stops at once)
            float rise = (c.Path.Velocity(c.T).Y - 0.3f) / (Climb - 0.3f);
            pull = MathF.Abs(MathF.Sin(c.T * 5.5f)) * 0.04f * Math.Clamp(rise, 0, 1);
        }
        Look(dt, 0, 0, Eye - pull);
        float fade = 1 - Mathf.SmoothStep(0, 1, c.T / 0.35f);
        if (fade > 0)
        {
            Cam.GlobalPosition += c.Off * fade;
            Cam.Rotation += new Vector3(0, 0, c.Roll * fade);
        }
    }

    // ------------------------------------------------------------ vaulting (shared/mantle.ts asks the world this)

    float Mantle.IWorld.Floor(float x, float z, float ceiling) => GroundAt(x, z, ceiling - Step, 0.12f);

    bool Mantle.IWorld.Clear(float x, float y, float z) => BodyFree(x, y, z);

    bool Mantle.IWorld.Stand(float x, float y, float z)
    {
        // Both feet need support: a thin railing can be vaulted, never used as a platform.
        foreach (var (ox, oz) in new[] { (0f, 0f), (.18f, 0f), (-.18f, 0f), (0f, .18f), (0f, -.18f) })
            if (Math.Abs(GroundAt(x + ox, z + oz, y, 0) - y) > .12f)
                return false;
        return StandFree(x, z, y);
    }

    float? Mantle.IWorld.Water(float x, float z) => Swimmable(x, z) ? Water.Level(x, z) : null;
}
