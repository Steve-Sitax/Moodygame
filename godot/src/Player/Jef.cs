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
    public float LookSens = 1;
    public bool InvertY;
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

    private sealed class ClimbRun
    {
        public Vector3 From;
        public List<(Vector3 p, float dur)> Keys = new();
        public int I;
        public float T;
        public Action? Then;
    }
    private ClimbRun? climb;

    public override void _Ready()
    {
        I = this;
        var view = Main.I.View;
        fly = Main.I.Cam as FlyCam;
        shots = Main.I.Arg("shots") != "";
        QuayExits.Build(Main.I.World);

        Body = new CharacterBody3D { Name = "jef_body", CollisionLayer = Layer, CollisionMask = Solid.Layer, MotionMode = CharacterBody3D.MotionModeEnum.Floating };
        bodyShape = new CylinderShape3D { Radius = Radius, Height = Tall - Step };
        Body.AddChild(new CollisionShape3D { Shape = bodyShape, Position = new Vector3(0, Step + (Tall - Step) / 2, 0) });
        view.AddChild(Body);

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

    /// <summary>F: the free camera and back. Coming back, Jef stands under where the camera was.</summary>
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
        climb = null;
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
        if (e is InputEventKey { Pressed: true, Echo: false, PhysicalKeycode: Key.F } && !TestInput)
        {
            ToggleFly();
            return;
        }
        if (Fly) return;
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
        if (Fly) return;
        float dt = (float)Math.Min(delta, 0.05);
        if (Drive != null && Drive(dt)) { Body.GlobalPosition = new Vector3(X, Y, Z); Look(dt, 0, 0, DrivenEye); return; }
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
    {
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
                return ray.Count > 0 ? ray["position"].AsVector3().Y : float.NegativeInfinity;
            }
            return start - 0.01f - hit[0] * len;
        }
        return float.NegativeInfinity;
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

    /// <summary>Open water a swimmer fits in (rijnkaai.ts swimFree): in the water's outline and clear of walls, steps and piles.</summary>
    public bool SwimFree(float x, float z) => Water.In(x, z) && BodyFree(x, Water.Level(x, z) - SwimFeet, z);

    /// <summary>The nearest spot within 1 m where a swimmer fits, or null.</summary>
    public (float x, float z)? NearestSwim(float x, float z)
    {
        if (SwimFree(x, z)) return (x, z);
        for (float d = 0.15f; d <= 1.0f; d += 0.15f)
            for (int i = 0; i < 12; i++)
            {
                float a = i * MathF.PI / 6;
                float px = x + MathF.Cos(a) * d, pz = z + MathF.Sin(a) * d;
                if (SwimFree(px, pz)) return (px, pz);
            }
        return null;
    }

    /// <summary>Can he drop into the water here? Water deep enough to swim, with room close by.</summary>
    public bool Swimmable(float x, float z)
    {
        if (!Water.In(x, z)) return false;
        float level = Water.Level(x, z);
        return GroundAt(x, z, level - Step) < level - Tide.Wade && NearestSwim(x, z) != null;
    }

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
                var keys = (wet ? route[..^1] : route).Select((p, i) => (new Vector3(p.X, p.Y, p.Z), i == 0 ? (air ? .2f : .35f) : i == 1 ? (air ? .35f : .45f) : .28f));
                ClimbTo(keys, () =>
                {
                    vy = 0;
                    mantleWait = .25f;
                    // over a railing into the water or off a height: he drops from the top of the vault
                    if (wet)
                    {
                        Grounded = false;
                        fallTop = Y;
                        return;
                    }
                    Grounded = true;
                    Landed?.Invoke();
                });
                return;
            }
        }
        if (pressed && Grounded && !Laden && !Crouching)
        {
            vy = JumpV;
            Grounded = false;
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
        // heavy start and stop
        float a = 1 - MathF.Exp(-dt * (len > 0 ? 6 : 9));
        vel.X += (wx - vel.X) * a;
        vel.Y += (wz - vel.Y) * a;

        float wanted = vel.Length() * dt;
        float moved = MoveBy(vel.X * dt, vel.Y * dt, Y);
        Blocked = len > 0 && wanted > 1e-5f && moved < wanted * 0.3f;

        float ground = GroundAt(X, Z, Y);
        float level = Water.Level(X, Z);
        // walked off an edge (down steps and slopes you stay on your feet)
        if (Grounded && ground < Y - Drop) Grounded = false;
        if (!Grounded)
        {
            fallTop = Math.Max(fallTop, Y);
            vy -= Gravity * dt;
            if (vy > 0)
            {
                // a ceiling over a jump
                Body.GlobalPosition = new Vector3(X, Y, Z);
                if (Body.TestMove(Body.GlobalTransform, new Vector3(0, vy * dt, 0))) vy = 0;
            }
            Y += vy * dt;
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

    /// <summary>The view: a slow turn (it lags the mouse a little), the eye at `up` over the feet, `side` to the right.</summary>
    private void Look(float dt, float side, float roll, float up = Eye)
    {
        float s = 1 - MathF.Exp(-dt * 22);
        lookYaw += (Yaw - lookYaw) * s;
        lookPitch += (Pitch - lookPitch) * s;
        float sin = MathF.Sin(Yaw), cos = MathF.Cos(Yaw);
        Cam.GlobalPosition = new Vector3(X + cos * side, Y + up, Z - sin * side);
        Cam.Rotation = new Vector3(lookPitch, lookYaw, roll);
    }

    // ------------------------------------------------------------ in the water

    private void EnterWater()
    {
        Swimming = true;
        Grounded = false;
        Crouching = false;
        Hurrying = false;
        Blocked = false;
        vy = Math.Max(vy, -7); // the plunge, then you come up
        vel *= 0.3f;
        // clear of the wall you fell from
        var spot = NearestSwim(X, Z);
        if (spot != null) (X, Z) = spot.Value;
        strokeDist = 0;
        stepLag = 0;
        Splashed?.Invoke();
    }

    private void UpdateSwim(float dt)
    {
        float fx = 0, fz = 0;
        if (K(Key.W) || K(Key.Up)) fz -= 1;
        if (K(Key.S) || K(Key.Down)) fz += 1;
        if (K(Key.A) || K(Key.Left)) fx -= 1;
        if (K(Key.D) || K(Key.Right)) fx += 1;
        float len = MathF.Sqrt(fx * fx + fz * fz);
        float sin = MathF.Sin(Yaw), cos = MathF.Cos(Yaw);
        float wx = 0, wz = 0;
        float stroke = K(Key.Shift) ? SwimFast : Swim;
        if (len > 0)
        {
            wx = (fx * cos + fz * sin) / len * stroke;
            wz = (-fx * sin + fz * cos) / len * stroke;
        }
        // water is thick: slow to get going, slow to stop
        float a = 1 - MathF.Exp(-dt * (len > 0 ? 2.2f : 1.6f));
        vel.X += (wx - vel.X) * a;
        vel.Y += (wz - vel.Y) * a;

        // a swimmer moves at the height he floats at; walls, steps and piles stop him, and so does the water's edge
        float level = Water.Level(X, Z);
        float floatY = level - SwimFeet;
        float ox = X, oz = Z;
        float wanted = vel.Length() * dt;
        float moved = MoveBy(vel.X * dt, vel.Y * dt, floatY);
        if (!Water.In(X, Z))
        {
            float nx = X, nz = Z;
            X = Water.In(nx, oz) ? nx : ox;
            Z = Water.In(X, nz) ? nz : oz;
            moved = MathF.Sqrt((X - ox) * (X - ox) + (Z - oz) * (Z - oz));
        }
        Blocked = len > 0 && wanted > 1e-5f && moved < wanted * 0.3f;

        // up out of the plunge, then float: feet under, eye just above the waves
        level = Water.Level(X, Z);
        floatY = level - SwimFeet;
        vy += (floatY - Y) * 14 * dt;
        vy *= MathF.Exp(-dt * 4.5f);
        Y += vy * dt;

        // strokes, and a slow bob
        swimT += dt;
        strokeDist += moved;
        if (strokeDist > StrokeLen)
        {
            strokeDist = 0;
            Stroke?.Invoke();
        }
        float speed = moved / Math.Max(dt, 1e-4f);
        float bob = MathF.Sin(swimT * 1.7f) * 0.035f + MathF.Sin(swimT * 5.2f) * 0.012f * Math.Min(1, speed);

        // out: push into a ladder or a landing, or press E by one
        var exit = QuayExits.Near(X, Z, 1.2f);
        if (exit != null)
        {
            bool push = len > 0 && (wx * -exit.Nx + wz * -exit.Nz) / Swim > 0.5f;
            if (push || K(Key.E) || K(Key.Space))
            {
                StartClimb(exit);
                return;
            }
        }
        float eyeY = Math.Max(Y + SwimFeet + SwimEye + bob, level + 0.07f);
        Look(dt, 0, MathF.Sin(swimT * 1.1f) * 0.02f, eyeY - Y);
    }

    /// <summary>The spot at the top can hold a crane's leg or a wagon: step off beside it, wherever you can stand.</summary>
    private (float x, float z) ClimbSpot(Exit e)
    {
        foreach (float d in new[] { 0f, 0.4f, 0.8f, 1.2f })
            foreach (float s in new[] { 0f, 0.6f, -0.6f, 1.2f, -1.2f })
            {
                float x = e.Tx - e.Nx * d - e.Nz * s;
                float z = e.Tz - e.Nz * d + e.Nx * s;
                if (StandFree(x, z, e.Ty)) return (x, z);
            }
        return (e.Tx, e.Tz);
    }

    private void StartClimb(Exit e)
    {
        float floatY = Water.Level(X, Z) - SwimFeet;
        var keys = new List<(Vector3, float)>();
        var (tx, tz) = ClimbSpot(e);
        if (e.Ladder)
        {
            float lx = e.Gx - e.Nx * 0.12f, lz = e.Gz - e.Nz * 0.12f;
            keys.Add((new Vector3(lx, floatY, lz), 0.4f));
            keys.Add((new Vector3(lx, e.Ty + 0.15f, lz), (e.Ty + 0.15f - floatY) / Climb));
            keys.Add((new Vector3(tx, e.Ty, tz), 0.7f));
        }
        else
        {
            keys.Add((new Vector3(e.Gx, floatY, e.Gz), 0.35f));
            keys.Add((new Vector3(e.Gx - e.Nx * 0.45f, e.Ty + 0.1f, e.Gz - e.Nz * 0.45f), 1.1f));
            keys.Add((new Vector3(tx, e.Ty, tz), 0.5f));
        }
        ClimbTo(keys, null);
    }

    /// <summary>A climb along key points (x, y, z, seconds each): no control meanwhile. `then` runs at the end instead of landing.</summary>
    public void ClimbTo(IEnumerable<(Vector3, float)> keys, Action? then)
    {
        climb = new ClimbRun { From = new Vector3(X, Y, Z), Keys = keys.ToList(), Then = then };
        Swimming = false;
        Blocked = false;
        vel = Vector2.Zero;
        vy = 0;
    }

    private void UpdateClimb(float dt)
    {
        var c = climb!;
        c.T += dt;
        while (c.I < c.Keys.Count && c.T >= c.Keys[c.I].dur)
        {
            c.T -= c.Keys[c.I].dur;
            c.From = c.Keys[c.I].p;
            c.I++;
        }
        if (c.I >= c.Keys.Count)
        {
            (X, Y, Z) = (c.From.X, c.From.Y, c.From.Z);
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
        else
        {
            var (p, dur) = c.Keys[c.I];
            float k = Mathf.SmoothStep(0, 1, c.T / dur);
            var at = c.From.Lerp(p, k);
            (X, Y, Z) = (at.X, at.Y, at.Z);
        }
        // hand over hand: a small pull on every rung
        float pull = c.I == 1 ? MathF.Abs(MathF.Sin(c.T * 5.5f)) * 0.04f : 0;
        Look(dt, 0, 0, Eye - pull);
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
