using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>
/// Jef in the water: swimming at the surface and diving under it (2026-10-11, Steve: "can't swim under boat, we need
/// to be able to dive"). At the surface he floats with his body near the top of the water, so a rail or a parapet a
/// hand under the surface does not hold him, and where the water gets shallow enough to stand he finds his feet. C
/// (or Ctrl) dives: under the water W swims where he looks, Space goes up, C deeper; let go and he rises slowly. He
/// holds his breath for half a minute; near the end he is told, and at the end he struggles up to the nearest open
/// water. Under the water the view is dark and close and the town's sounds are dull (World/Underwater.cs). The hulls
/// (Movers/Boats.Hulls.cs), the walls, the piles and the bed hold him; under a keel he passes.
/// </summary>
public partial class Jef
{
    /// <summary>A swimmer's body at the surface reaches this far under it, and this far over it (his head).</summary>
    public const float SwimDeep = 0.5f, SwimTop = 0.35f;
    /// <summary>The diver's head: a ball round the eye.</summary>
    public const float DiveR = 0.3f;
    public const float DiveSpeed = 1.1f, DiveFast = 1.6f;
    /// <summary>Seconds he can hold his breath (heavy clothes, cold water), and when he is told to come up.</summary>
    public const float BreathMax = 30, BreathWarn = 10, BreathLast = 4;
    public float Breath { get; private set; } = BreathMax;
    /// <summary>Times he came up struggling, his breath gone (for the checks).</summary>
    public int Gasps { get; private set; }
    /// <summary>Where and how he last came up (for the checks).</summary>
    public (Vector3 Eye, Vector3 Speed, float Level) LastSurface { get; private set; }

    /// <summary>He dived; came up again (seconds he was under); his breath ran short (seconds left).</summary>
    public event Action? Dived;
    public event Action<float>? Surfaced;
    public event Action<float>? BreathShort;

    private readonly CylinderShape3D swimShape = new() { Radius = Radius, Height = SwimDeep + SwimTop };
    private readonly SphereShape3D diveShape = new() { Radius = DiveR };
    private readonly PhysicsShapeQueryParameters3D swimQ = new() { CollisionMask = Solid.Layer, Margin = 0 };
    private int shapeMode = -1;
    private Vector3 dive3;
    private float underT, bubbleT;
    private bool warned, warnedLast, toldDive;
    private Vector3? airAt;
    private float airSearchT, outOfBreathT, stuckUpT, bobIn = 1;
    /// <summary>Just put in the water (perhaps inside a hull): a moment in which any way out is free.</summary>
    private float hullGrace;

    /// <summary>The body's shape: 0 on foot, 1 swimming at the surface, 2 under water.</summary>
    private void SetShape(int mode)
    {
        if (mode == shapeMode) return;
        shapeMode = mode;
        switch (mode)
        {
            case 1:
                bodyCol.Shape = swimShape;
                bodyCol.Position = new Vector3(0, SwimFeet + (SwimTop - SwimDeep) / 2, 0);
                break;
            case 2:
                bodyCol.Shape = diveShape;
                bodyCol.Position = new Vector3(0, Eye, 0);
                break;
            default:
                bodyCol.Shape = bodyShape;
                bodyCol.Position = new Vector3(0, Step + (Tall - Step) / 2, 0);
                break;
        }
    }

    private bool ShapeFree(Shape3D shape, Vector3 at)
    {
        swimQ.Shape = shape;
        swimQ.Transform = new Transform3D(Basis.Identity, at);
        return Space.IntersectShape(swimQ, 1).Count == 0;
    }

    private static bool Hull(float x, float z, float r, float y0, float y1, out Transform3D frame)
    {
        frame = Transform3D.Identity;
        return Scheldemist.Movers.Boats.I != null && Scheldemist.Movers.Boats.I.HullIn(x, z, r, y0, y1, out frame);
    }

    /// <summary>Open water a swimmer fits in at the surface (rijnkaai.ts swimFree): in the water's outline, clear of walls, steps, piles and hulls.</summary>
    public bool SwimFree(float x, float z)
    {
        if (!Water.In(x, z)) return false;
        float level = Water.Level(x, z);
        return ShapeFree(swimShape, new Vector3(x, level + (SwimTop - SwimDeep) / 2, z)) && !Hull(x, z, Radius, level - SwimDeep, level + SwimTop, out _);
    }

    /// <summary>Room for the diver's head at this eye: in the water, under its surface, clear of all that is solid.</summary>
    public bool DiveFree(Vector3 e)
        => Water.In(e.X, e.Z) && e.Y < Water.Level(e.X, e.Z) && ShapeFree(diveShape, e) && !Hull(e.X, e.Z, DiveR, e.Y - DiveR, e.Y + DiveR, out _);

    /// <summary>The nearest spot within 1 m where a swimmer fits, or null.</summary>
    public (float x, float z)? NearestSwim(float x, float z, float reach = 1.0f)
    {
        if (SwimFree(x, z)) return (x, z);
        for (float d = 0.15f; d <= reach; d += 0.15f)
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

    private void EnterWater()
    {
        Swimming = true;
        Diving = false;
        Grounded = false;
        Crouching = false;
        Hurrying = false;
        Blocked = false;
        SetShape(1);
        hullGrace = 1;
        bobAmp = 0;
        Land(Math.Min(-vy, 6) * 0.5f);
        vy = Math.Max(vy, -7); // the plunge, then you come up
        vel *= 0.3f;
        // clear of the wall you fell from
        var spot = NearestSwim(X, Z);
        if (spot != null) (X, Z) = spot.Value;
        strokeDist = 0;
        stepLag = 0;
        Splashed?.Invoke();
    }

    /// <summary>Ground to wade on: both feet on it (a parapet's coping under the water is no floor).</summary>
    private bool BroadStand(float x, float z, float g)
    {
        foreach (var (ox, oz) in new[] { (.2f, 0f), (-.2f, 0f), (0f, .2f), (0f, -.2f) })
            if (Math.Abs(GroundAt(x + ox, z + oz, g, 0.05f) - g) > .15f) return false;
        return StandFree(x, z, g);
    }

    /// <summary>Slide a move along a hull's side (her length or her beam), or not at all.</summary>
    private Vector3 AlongHull(Transform3D hull, Vector3 from, Vector3 move, Func<Vector3, bool> free)
    {
        var along = hull.Basis.Z.Normalized();
        var across = hull.Basis.X.Normalized();
        foreach (var axis in new[] { along, across, Vector3.Up })
        {
            var m = axis * move.Dot(axis);
            if (m.LengthSquared() > 1e-8f && free(from + m)) return from + m;
        }
        return from;
    }

    private void UpdateSwim(float dt)
    {
        if (Diving)
        {
            UpdateDive(dt);
            return;
        }
        SetShape(1);
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

        // a swimmer moves at the height he floats at; walls, steps, piles and hulls stop him, and so does the water's edge
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
        }
        hullGrace = Math.Max(0, hullGrace - dt);
        if (Hull(ox, oz, Radius, level - SwimDeep, level + SwimTop, out var inside))
        {
            // in a hull already (she rolled onto him, or he was put there): out across her beam, the nearer way
            if (hullGrace <= 0)
            {
                var side = inside.Basis.X.Normalized();
                float k = (new Vector3(ox, 0, oz) - inside.Origin).Dot(side) >= 0 ? 1 : -1;
                (X, Z) = (ox + side.X * k * 0.6f * dt, oz + side.Z * k * 0.6f * dt);
            }
        }
        else if (Hull(X, Z, Radius, level - SwimDeep, level + SwimTop, out var hull))
        {
            var to = AlongHull(hull, new Vector3(ox, 0, oz), new Vector3(X - ox, 0, Z - oz), p => !Hull(p.X, p.Z, Radius, level - SwimDeep, level + SwimTop, out _));
            (X, Z) = (to.X, to.Z);
            vel *= 0.5f;
        }
        moved = MathF.Sqrt((X - ox) * (X - ox) + (Z - oz) * (Z - oz));
        Blocked = len > 0 && wanted > 1e-5f && moved < wanted * 0.3f;

        // up out of the plunge, then float: feet under, eye just above the waves
        level = Water.Level(X, Z);
        floatY = level - SwimFeet;
        vy += (floatY - Y) * 14 * dt;
        vy *= MathF.Exp(-dt * 4.5f);
        Y += vy * dt;
        Breath = Math.Min(BreathMax, Breath + dt * 6);
        if (Breath >= BreathMax) warned = warnedLast = false;

        // strokes, and a slow bob
        swimT += dt;
        strokeDist += moved;
        if (strokeDist > StrokeLen)
        {
            strokeDist = 0;
            Stroke?.Invoke();
        }
        float speed = moved / Math.Max(dt, 1e-4f);
        Scheldemist.World.Waters.Swim(this, X, Z, vel.X, vel.Y, speed); // (D3: rings at each stroke, a small wake)
        // (the bob grows in again after he comes up from a dive, so the eye goes on smoothly)
        bobIn = Math.Min(1, bobIn + dt * 1.5f);
        float bob = (MathF.Sin(swimT * 1.7f) * 0.035f + MathF.Sin(swimT * 5.2f) * 0.012f * Math.Min(1, speed)) * bobIn;

        // the water shallow enough to stand in (a flooded flight of steps, the mud at low water): on his feet again
        float g = GroundAt(X, Z, level - 0.3f);
        if (float.IsFinite(g) && g >= level - Tide.Wade + 0.1f && Math.Abs(vy) < 1.5f && BroadStand(X, Z, g))
        {
            ClimbTo(new[] { (new Vector3(X, g, Z), 0.55f) }, () =>
            {
                Grounded = true;
                eye = Eye;
                vel = new Vector2(wx, wz) * 0.5f;
                Landed?.Invoke();
                ClimbedOut?.Invoke();
            }, null, new Vector3(vel.X, vy, vel.Y), new Vector3(wx, 0, wz) * 0.5f);
            return;
        }

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
        // C (or Ctrl): under the water
        bool duck = K(Key.C) || K(Key.Ctrl);
        if (duck && !duckHeld && Math.Abs(vy) < 2)
        {
            duckHeld = true;
            StartDive(level);
            return;
        }
        duckHeld = duck;
        Look(dt, 0, MathF.Sin(swimT * 1.1f) * 0.02f, SwimFeet + SwimEye + bob);
    }
    private bool duckHeld;

    private void StartDive(float level)
    {
        // head first from where the eyes are now: a short push down
        var e = Cam.GlobalPosition;
        Diving = true;
        SetShape(2);
        X = e.X;
        Z = e.Z;
        Y = e.Y - Eye;
        dive3 = new Vector3(vel.X, -1.3f, vel.Y);
        underT = 0;
        bubbleT = 0.6f;
        airAt = null;
        outOfBreathT = 0;
        Dived?.Invoke();
        if (!toldDive)
        {
            toldDive = true;
            Scheldemist.Game.GameState.I?.Say("Under the water: W swims where you look, Space goes up, C deeper. You can hold your breath for half a minute.");
        }
    }

    /// <summary>The top of the bed under (x, z): the first solid straight down from `top`.</summary>
    private float BedUnder(float x, float z, float top)
    {
        var hit = Space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x, top, z), new Vector3(x, Tide.LwMin - 8, z), Solid.Layer));
        return hit.Count > 0 ? hit["position"].AsVector3().Y : float.NegativeInfinity;
    }

    /// <summary>The nearest open water within 15 m where he can put his head up (out of breath, under a hull), at least `min` away.</summary>
    private Vector3? AirNear(Vector3 e, float min = 0)
    {
        if (min <= 0 && SwimFree(e.X, e.Z)) return new Vector3(e.X, e.Y, e.Z);
        for (float d = Math.Max(0.5f, min); d <= 15; d += 0.5f)
            for (int i = 0; i < 16; i++)
            {
                float a = i * MathF.PI / 8;
                float x = e.X + MathF.Cos(a) * d, z = e.Z + MathF.Sin(a) * d;
                // room at the top, and open water all the way down to his depth (no bank in the way)
                if (SwimFree(x, z) && BedUnder(x, z, Water.Level(x, z) - 0.05f) < e.Y - DiveR) return new Vector3(x, e.Y, z);
            }
        return null;
    }

    private void UpdateDive(float dt)
    {
        SetShape(2);
        var e = new Vector3(X, Y + Eye, Z);
        float level = Water.Level(X, Z);
        float fx = 0, fz = 0;
        if (K(Key.W) || K(Key.Up)) fz -= 1;
        if (K(Key.S) || K(Key.Down)) fz += 1;
        if (K(Key.A) || K(Key.Left)) fx -= 1;
        if (K(Key.D) || K(Key.Right)) fx += 1;
        float upKey = (K(Key.Space) ? 1 : 0) - (K(Key.C) || K(Key.Ctrl) ? 1 : 0);
        float sy = MathF.Sin(Yaw), cy = MathF.Cos(Yaw), cp = MathF.Cos(Pitch), sp = MathF.Sin(Pitch);
        var fwd = new Vector3(-sy * cp, sp, -cy * cp);
        var right = new Vector3(cy, 0, -sy);
        var wish = fwd * -fz + right * fx;
        if (wish.LengthSquared() > 1e-6f) wish = wish.Normalized() * (K(Key.Shift) ? DiveFast : DiveSpeed);
        wish.Y += upKey * 0.9f;
        // let go and the air in his clothes lifts him, slowly
        if (upKey == 0) wish.Y += 0.22f;

        // the breath
        underT += dt;
        Breath = Math.Max(0, Breath - dt);
        if (Breath < BreathWarn && !warned)
        {
            warned = true;
            BreathShort?.Invoke(Breath);
            Scheldemist.Game.GameState.I?.Say("Your chest burns. You must come up for air soon.");
        }
        if (Breath < BreathLast && !warnedLast)
        {
            warnedLast = true;
            BreathShort?.Invoke(Breath);
            Scheldemist.Game.GameState.I?.Say("You need air. Up, now!");
        }
        if (Breath <= 0)
        {
            // no breath left: he fights his way up to the nearest open water, whatever the keys say
            outOfBreathT += dt;
            airSearchT -= dt;
            if (airAt == null || airSearchT <= 0)
            {
                // held under something (a hull, the staging, a ledge of the wall): to open water a little way off
                airAt = AirNear(e, stuckUpT > 0.6f ? 1.2f : 0);
                airSearchT = 0.5f;
            }
            var to = airAt is { } t ? new Vector3(t.X - e.X, 0, t.Z - e.Z) : Vector3.Zero;
            wish = (to.LengthSquared() > 0.04f ? to.Normalized() * 1.3f : Vector3.Zero) + new Vector3(0, 1.1f, 0);
            if (outOfBreathT > 12)
            {
                // nowhere to come up: the river spits him out where he last stood
                Rescued++;
                Scheldemist.Game.GameState.I?.Say("Half drowned, you are dragged out of the water.");
                Place(safe.X, safe.Z, Yaw, Pitch, safe.Y);
                return;
            }
        }

        float a = 1 - MathF.Exp(-dt * 2.2f);
        dive3 += (wish - dive3) * a;
        var from = e;
        var move = dive3 * dt;
        // the walls, the piles, the staging and the bed: Godot's physics, sliding along
        Body.GlobalPosition = new Vector3(X, Y, Z);
        var rem = move;
        for (int i = 0; i < 4 && rem.LengthSquared() > 1e-10f; i++)
        {
            var hit = Body.MoveAndCollide(rem, false, 0.002f);
            if (hit == null) break;
            var n = hit.GetNormal();
            rem = hit.GetRemainder().Slide(n);
            dive3 = dive3.Slide(n);
        }
        e = Body.GlobalPosition + new Vector3(0, Eye, 0);
        // the hulls: slide along her side or under her keel
        hullGrace = Math.Max(0, hullGrace - dt);
        if (Hull(from.X, from.Z, DiveR, from.Y - DiveR, from.Y + DiveR, out _))
        {
            // her keel came down onto him as she heaved: down and out from under it
            if (hullGrace <= 0)
            {
                e = from + new Vector3(0, -0.5f * dt, 0);
                dive3.Y = Math.Min(dive3.Y, 0);
            }
        }
        else if (Hull(e.X, e.Z, DiveR, e.Y - DiveR, e.Y + DiveR, out var hull))
        {
            e = AlongHull(hull, from, e - from, p => !Hull(p.X, p.Z, DiveR, p.Y - DiveR, p.Y + DiveR, out _) && ShapeFree(diveShape, p));
            var d = e - from;
            dive3 = dt > 0 ? d / dt : Vector3.Zero;
        }
        if (!Water.In(e.X, e.Z)) e = new Vector3(from.X, e.Y, from.Z);
        // never into the bed: the first solid straight down from the surface (the mud, the stones of the bed; a sheet
        // of mud off a wall's foot stands for the bank under it: he does not go in beneath it), nor deeper than the
        // deepest dock. A bed that rises over his head is a bank before him: he stops at it (and is never lifted
        // into it from below).
        float Bed(float x, float z) => Math.Max(BedUnder(x, z, level - 0.05f), Math.Max(Scheldemist.Movers.Boats.BedAt(x, z), Tide.LwMin - 6)) + DiveR;
        float bed = Bed(e.X, e.Z);
        if (e.Y < bed - 0.02f && bed > from.Y + 0.05f)
        {
            e = new Vector3(from.X, e.Y, from.Z);
            dive3.X = dive3.Z = 0;
            bed = Bed(e.X, e.Z);
        }
        if (e.Y < bed && bed <= from.Y + 0.05f) { e.Y = Math.Max(e.Y, Math.Min(bed, from.Y + 1.2f * dt)); dive3.Y = Math.Max(0, dive3.Y); }

        level = Water.Level(e.X, e.Z);
        // at the surface: up into the air where there is room for his head, else he stays under it (going down from
        // the surface, as he dives, he passes on through it)
        if (e.Y > level - 0.12f && dive3.Y > -0.2f)
        {
            if (SwimFree(e.X, e.Z))
            {
                SurfaceAt(e, level);
                return;
            }
            e.Y = Math.Min(e.Y, Math.Max(from.Y, level - 0.12f));
            dive3.Y = Math.Min(0, dive3.Y);
        }
        // wanting up and getting nowhere
        stuckUpT = wish.Y > 0.3f && e.Y - from.Y < wish.Y * dt * 0.1f ? stuckUpT + dt : 0;
        X = e.X;
        Z = e.Z;
        Y = e.Y - Eye;
        Blocked = (fz != 0 || fx != 0) && (e - from).Length() < DiveSpeed * dt * 0.3f;

        // a stroke now and then, and the air going out of him
        strokeDist += (e - from).Length();
        if (strokeDist > StrokeLen)
        {
            strokeDist = 0;
            Stroke?.Invoke();
        }
        bubbleT -= dt;
        if (bubbleT <= 0)
        {
            bubbleT = Breath < BreathLast ? 0.9f : 2.6f + (float)GD.RandRange(0, 1.6);
            Scheldemist.Audio.Soundscape.I?.DiverBubbles(e, Breath < BreathLast);
        }
        swimT += dt;
        Look(dt, 0, MathF.Sin(swimT * 1.1f) * 0.02f, Eye);
    }

    private void SurfaceAt(Vector3 e, float level)
    {
        Diving = false;
        SetShape(1);
        X = e.X;
        Z = e.Z;
        // the eye goes on up through the surface (no jump): the float takes it the rest of the way
        Y = e.Y - SwimFeet - SwimEye;
        vy = Math.Clamp(dive3.Y, 0.5f, 0.9f);
        LastSurface = (e, dive3, level);
        bobIn = 0;
        vel = new Vector2(dive3.X, dive3.Z);
        bool gasp = Breath < BreathMax * 0.5f;
        if (Breath <= 0) Gasps++;
        Surfaced?.Invoke(underT);
        if (gasp) Scheldemist.Audio.Soundscape.I?.Gasp(Breath <= 0);
        if (Breath <= 0) Scheldemist.Game.GameState.I?.Say("You come up gasping for air.");
        airAt = null;
        outOfBreathT = 0;
    }
}
