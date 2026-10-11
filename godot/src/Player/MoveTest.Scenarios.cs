using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.World;

namespace Scheldemist.Player;

public partial class MoveTest
{
    private async Task Settle(float x, float z, float yaw, float pitch = 0, float near = 0)
    {
        Jef.I.ClearKeys();
        Solid.I.Ensure(new Vector3(x, near, z), 25);
        await Frames(3);
        Jef.I.Place(x, z, yaw, pitch, near);
        await Frames(25);
    }

    /// <summary>The yaw that looks along (dx, dz).</summary>
    private static float Facing(float dx, float dz) => MathF.Atan2(-dx, -dz);

    private sealed record ArcInfo(string Name, int TakeoffFrames, float TopM, float AirS, float Gravity, float GravitySpread, float RunSpeed, float FlownM, float KeptSpeed, int Frames);

    /// <summary>What a jump did, read from its samples (the feet's heights from the frame of the press).</summary>
    private static ArcInfo Arc(List<Sample> s, float ground, string name)
    {
        int up = s.FindIndex(x => x.Feet.Y > ground + 0.002f);
        int down = up < 0 ? -1 : s.FindIndex(up + 1, x => x.State == "walk" && Math.Abs(x.Feet.Y - ground) < 0.03f);
        float top = s.Max(x => x.Feet.Y) - ground;
        float air = up >= 0 && down > up ? s[down].T - s[Math.Max(0, up - 1)].T : 0;
        // the bend of the arc frame by frame: a true fall under gravity has the same downward pull every frame
        var pulls = new List<float>();
        for (int i = Math.Max(1, up + 1); up >= 0 && i < (down > 0 ? down - 1 : s.Count - 1); i++)
        {
            float d0 = s[i].T - s[i - 1].T, d1 = s[i + 1].T - s[i].T;
            float v0 = (s[i].Feet.Y - s[i - 1].Feet.Y) / d0, v1 = (s[i + 1].Feet.Y - s[i].Feet.Y) / d1;
            pulls.Add((v1 - v0) / ((d0 + d1) / 2));
        }
        float run = up > 0 ? new Vector2(s[up].Feet.X - s[up - 1].Feet.X, s[up].Feet.Z - s[up - 1].Feet.Z).Length() / Math.Max(1e-4f, s[up].T - s[up - 1].T) : 0;
        float flown = up >= 0 && down > up ? new Vector2(s[down].Feet.X - s[up].Feet.X, s[down].Feet.Z - s[up].Feet.Z).Length() : 0;
        float g = pulls.Count > 0 ? -pulls.Average() : 0, spread = pulls.Count > 0 ? pulls.Max() - pulls.Min() : 0;
        return new ArcInfo(name, up, R(top), R(air), R(g), R(spread), R(run), R(flown), air > 0 ? R(flown / air) : 0, s.Count);
    }

    private async Task JumpCheck()
    {
        var j = Jef.I;
        // standing: straight up and down
        await Settle(-118, 36, 0);
        float g0 = j.Y;
        var dips = new List<float>();
        int f = 0;
        var s = await Sampled(t => { j.SetKey(Key.Space, f++ == 0); dips.Add(j.ViewDip); return t < 1.1f; }, 1.5f);
        var a = Arc(s, g0, "standing jump");
        float dip = -dips.Min();
        reports.Add(new { jump = a, dipCm = R(dip * 100), track = Track(s, 2) });
        Check(a.TakeoffFrames >= 0 && a.TakeoffFrames <= 1, "the jump leaves the ground in the frame Space is pressed", a);
        Check(a.TopM > 0.6f && a.TopM < 0.72f, "a standing jump rises about 0.66 m (clears 0.55 m)", a.TopM);
        Check(a.AirS > 0.5f && a.AirS < 0.66f, "a standing jump is in the air about 0.58 s", a.AirS);
        Check(Math.Abs(a.Gravity - Jef.Gravity) < 0.6f && a.GravitySpread < 1.5f, "the arc bends with the same pull every frame (no fixed curve)", new { a.Gravity, a.GravitySpread });
        Check(dip > 0.03f && dip < 0.1f, "the view dips on landing and comes up again", R(dip * 100));

        // at a run: the run's speed goes on through the air
        await Settle(-118, 40, 0);
        j.SetKey(Key.W, true);
        j.SetKey(Key.Shift, true);
        await Frames(80);
        var p0 = new Vector2(j.X, j.Z);
        float tRun = 0;
        for (int i = 0; i < 20; i++) { await Frames(1); tRun += j.FrameDt; }
        float runSpeed = new Vector2(j.X, j.Z).DistanceTo(p0) / tRun;
        g0 = j.Y;
        f = 0;
        s = await Sampled(t => { j.SetKey(Key.Space, f++ == 0); return t < 1.0f; }, 1.4f);
        j.ClearKeys();
        a = Arc(s, g0, "running jump") with { RunSpeed = R(runSpeed) };
        reports.Add(new { jump = a, track = Track(s, 2) });
        Check(a.TakeoffFrames >= 0 && a.TakeoffFrames <= 1, "a running jump leaves at once", a);
        Check(a.KeptSpeed > a.RunSpeed * 0.9f, "the run's speed is kept through the air", new { a.RunSpeed, a.KeptSpeed });

        // the jump buffer: Space a moment before the feet touch down jumps again as they do
        await Settle(-118, 36, 0);
        g0 = j.Y;
        f = 0;
        int pressedAt = -1, second = -1, landed = -1;
        ulong first = 0;
        s = await Sampled(t =>
        {
            bool press = f == 0 || (pressedAt < 0 && f > 10 && !j.Grounded && j.Y - g0 < 0.12f);
            if (f == 2) first = j.LastJump.Frame;
            if (press && f > 0) pressedAt = f;
            if (pressedAt > 0 && landed < 0 && j.Grounded) landed = f;
            j.SetKey(Key.Space, press);
            if (f > 2 && pressedAt > 0 && second < 0 && j.LastJump.Frame != first) second = f;
            f++;
            return t < 1.6f;
        }, 2);
        reports.Add(new { buffer = new { pressedAt, landedAt = landed, secondJumpAt = second } });
        Check(pressedAt > 0 && second > 0 && second - pressedAt <= 12, "Space just before landing is kept: he jumps again as he touches down", new { pressedAt, landed, second });
    }

    private StaticBody3D? ledge;

    /// <summary>A block on the square for the edge checks: 1 m high, its front edge at z = 24.</summary>
    private async Task<float> Ledge()
    {
        if (ledge == null)
        {
            ledge = new StaticBody3D { Name = "movetest_ledge", CollisionLayer = Solid.Layer, CollisionMask = 0, Position = new Vector3(-118, 0.5f, 26) };
            ledge.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(2.4f, 1, 4) } });
            Main.I.View.AddChild(ledge);
            await Frames(3);
        }
        return 1;
    }

    private async Task LedgeCheck()
    {
        var j = Jef.I;
        float top = await Ledge();
        // coyote time: off the edge at a walk, Space a moment later still jumps
        foreach (float late in new[] { 0.05f, 0.22f })
        {
            await Settle(-118, 25, 0, 0, top);
            float off = -1, wait = 0;
            bool pressed = false;
            var s = await Sampled(t =>
            {
                j.SetKey(Key.W, true);
                if (off < 0 && !j.Grounded) off = t;
                bool now = off >= 0 && !pressed && t - off >= late;
                if (now) { pressed = true; wait = t - off; }
                j.SetKey(Key.Space, now);
                return t < 1.6f;
            }, 2);
            j.ClearKeys();
            // a jump from the air: the feet go up again before they touch down (a later press is kept for the landing)
            int pi = s.FindIndex(x => x.T >= off + wait - 1e-4f);
            int li = pi < 0 ? -1 : s.FindIndex(pi, x => x.State == "walk");
            bool jumped = pi >= 0 && Enumerable.Range(pi + 1, Math.Max(0, (li < 0 ? s.Count : li) - pi - 1)).Any(i => s[i].Feet.Y > s[i - 1].Feet.Y + 1e-4f);
            reports.Add(new { coyote = new { lateS = R(wait), jumped, top = R(s.Max(x => x.Feet.Y)) } });
            if (late < 0.1f) Check(jumped, $"off the edge, Space {wait * 1000:0} ms later still jumps (coyote time)");
            else Check(!jumped, $"off the edge, Space {wait * 1000:0} ms later is too late");
        }
        // falling off: the walk's speed goes on, the arc is gravity's, the landing dips the view
        await Settle(-118, 25, 0, 0, top);
        var dips = new List<float>();
        var fall = await Sampled(t => { j.SetKey(Key.W, true); dips.Add(j.ViewDip); return t < 1.8f; }, 2);
        j.ClearKeys();
        int air = fall.FindIndex(x => x.State == "air");
        int down = air < 0 ? -1 : fall.FindIndex(air, x => x.State == "walk");
        float dip = -dips.Min();
        var pulls = new List<float>();
        for (int i = air + 2; air >= 0 && down > 0 && i < down - 1; i++)
        {
            float d0 = fall[i].T - fall[i - 1].T, d1 = fall[i + 1].T - fall[i].T;
            pulls.Add(((fall[i + 1].Feet.Y - fall[i].Feet.Y) / d1 - (fall[i].Feet.Y - fall[i - 1].Feet.Y) / d0) / ((d0 + d1) / 2));
        }
        float flown = air >= 0 && down > 0 ? new Vector2(fall[down].Feet.X - fall[air].Feet.X, fall[down].Feet.Z - fall[air].Feet.Z).Length() : 0;
        reports.Add(new { fallOff = new { airS = down > 0 ? R(fall[down].T - fall[air].T) : 0, flownM = R(flown), gravity = pulls.Count > 0 ? R(-pulls.Average()) : 0, dipCm = R(dip * 100) }, track = Track(fall, 2) });
        Check(air >= 0 && down > air && flown > 0.4f, "walking off the edge he goes on forward as he falls", R(flown));
        Check(dip > 0.03f, "the view dips as he lands from the fall", R(dip * 100));
        ledge?.QueueFree();
        ledge = null;
    }

    private async Task Into(float x, float z, float yaw, float pitch = 0)
    {
        var j = Jef.I;
        Solid.I.Ensure(new Vector3(x, 0, z), 25);
        await Frames(3);
        j.Place(x, z, yaw);
        await Frames(3);
        if (j.NearestSwim(x, z, 3) is { } free) (x, z) = free;
        j.DropFromBoat(new Vector3(x, Water.Level(x, z) - 0.3f, z));
        j.Yaw = yaw;
        j.Pitch = pitch;
        await Frames(80);
    }

    /// <summary>The frame where the eye went fastest: its time, state and the two eyes.</summary>
    private static object Peak(List<Sample> s)
    {
        int best = 1;
        float v = 0;
        for (int i = 1; i < s.Count; i++)
        {
            float w = s[i].Eye.DistanceTo(s[i - 1].Eye) / Math.Max(1e-4f, s[i].T - s[i - 1].T);
            if (w > v) { v = w; best = i; }
        }
        if (s.Count < 2) return new { };
        var a = s[best - 1];
        var b = s[best];
        return new { t = R(b.T), dt = R(b.T - a.T), b.State, from = a.State, speed = R(v), a = new[] { R(a.Eye.X), R(a.Eye.Y), R(a.Eye.Z) }, b = new[] { R(b.Eye.X), R(b.Eye.Y), R(b.Eye.Z) } };
    }

    private async Task QuayLadderCheck()
    {
        var j = Jef.I;
        // a ladder up to the quay with open water in front of it (a boat moored at a ladder holds a swimmer off it)
        var l = QuayExits.Ladders.Where(a => MathF.Abs(a.Top) < 0.1f && Water.Level(a.X + a.Nx * 2, a.Z + a.Nz * 2) < -1.5f).OrderBy(a => new Vector2(a.X + 118, a.Z - 36).Length())
            .FirstOrDefault(a => { Solid.I.Ensure(new Vector3(a.X, 0, a.Z), 10); return Clear(a.X + a.Nx * 0.75f, a.Z + a.Nz * 0.75f, a.X + a.Nx * 2.2f, a.Z + a.Nz * 2.2f); });
        if (l == null) { Check(false, "a quay ladder near the Vismarkt"); return; }
        await Into(l.X + l.Nx * 2.2f, l.Z + l.Nz * 2.2f, Facing(-l.Nx, -l.Nz), 0.15f);
        bool shot = false, was = false;
        float outAt = -1;
        var s = await Sampled(t =>
        {
            // W into the ladder; once out he lets go of the keys (the walk after is the walk's own)
            if (j.Climbing) was = true;
            if (was && !j.Climbing && outAt < 0) outAt = t;
            j.SetKey(Key.W, outAt < 0);
            if (!shot && j.Climbing && j.Y > l.Top - 1.0f) { shot = true; _ = Shot("ladder-climbing", 0); }
            return t < 1 || j.Climbing || j.Swimming && t < 6 || outAt >= 0 && t < outAt + 0.6f;
        }, 16);
        await Frames(20);
        j.ClearKeys();
        int c0 = s.FindIndex(x => x.State == "climb"), c1 = s.FindLastIndex(x => x.State == "climb");
        var into = c0 > 0 ? Snap(s.GetRange(Math.Max(0, c0 - 10), Math.Min(40, s.Count - Math.Max(0, c0 - 10)))) : default;
        var outOf = c1 > 0 ? Snap(s.GetRange(Math.Max(0, c1 - 40), Math.Min(50, s.Count - Math.Max(0, c1 - 40)))) : default;
        var all = Snap(s);
        float frameS = s.Count > 1 ? (s[^1].T - s[0].T) / (s.Count - 1) : 0;
        reports.Add(new { quayLadder = new { at = new[] { R(l.X), R(l.Z) }, l.Top, climbS = c0 > 0 ? R(s[c1].T - s[c0].T) : 0, startCm = R(into.stepCm), startSpeed = R(into.speed), endCm = R(outOf.stepCm), endSpeed = R(outOf.speed), worstCm = R(all.stepCm), maxSpeed = R(all.speed), frameMs = R(frameS * 1000), peak = Peak(s), end = new[] { R(j.X), R(j.Y), R(j.Z) } }, track = Track(s, 3) });
        Check(c0 > 0 && !j.Swimming && j.Grounded && Math.Abs(j.Y - l.Top) < 0.2f, "out of the water up the quay ladder, onto the quay", new { j.Y, l.Top });
        Check(into.stepCm < 4 && outOf.stepCm < 4 && all.speed < 2.6f, "onto and off the ladder the view moves no more than a few cm a frame", new { startCm = R(into.stepCm), endCm = R(outOf.stepCm), maxSpeed = R(all.speed) });
        await Shot("ladder-out");
    }

    private async Task LandingCheck()
    {
        var j = Jef.I;
        // a flight whose landing has open water beside it (rowing boats lie at some; boats pass): the next if one comes
        var tried = new List<object>();
        foreach (var fr in new[] { 3, 4, 5, 1, 6, 7, 2, 0 }.Select(i => QuayExits.Flights[i]))
        {
            var (fx, fz) = fr.On(5.6f, 1.9f);
            Solid.I.Ensure(new Vector3(fx, 0, fz), 12);
            await Frames(2);
            var hit = new[] { 5.1f, 5.6f, 6.0f }.Where(k => { var (ax, az) = fr.On(k, 2.4f); var (bx, bz) = fr.On(k, 3.6f); return Water.Level(ax, az) < -2 && Clear(ax, az, bx, bz); }).ToList();
            if (hit.Count == 0) continue;
            var (gx, gz) = fr.On(hit[0], 3.6f);
            float level = Water.Level(gx, gz);
            await Into(gx, gz, Facing(-fr.Nx, -fr.Nz));
            bool was = false;
            float outAt = -1;
            var s = await Sampled(t =>
            {
                if (j.Climbing) was = true;
                if (was && !j.Climbing && outAt < 0) outAt = t;
                j.SetKey(Key.W, outAt < 0);
                return t < 1 || j.Climbing || j.Swimming && t < 8 || outAt >= 0 && t < outAt + 0.6f;
            }, 14);
            j.ClearKeys();
            await Frames(10);
            bool hull = Boats.I.HullIn(j.X - fr.Nx * 0.5f, j.Z - fr.Nz * 0.5f, Jef.Radius, level - Jef.SwimDeep, level + Jef.SwimTop, out var held);
            tried.Add(new { flight = new[] { fr.Ox, fr.Oz }, end = new[] { R(j.X), R(j.Y), R(j.Z) }, heldByHull = hull ? held.Origin.ToString() : "" });
            if (j.Swimming && hull && tried.Count < 3) continue; // a boat came alongside meanwhile: the next flight
            var snap = Snap(s);
            reports.Add(new { landing = new { level = R(level), tried, worstCm = R(snap.stepCm), maxSpeed = R(snap.speed), peak = Peak(s) }, track = Track(s, 4) });
            Check(!j.Swimming && j.Grounded && j.Y < -1, "from the water onto the landing of the steps", new { j.Y, level });
            Check(snap.stepCm < 4, "the climb onto the landing is smooth", R(snap.stepCm));
            await Shot("landing-out");
            return;
        }
        Check(false, "a landing with open water beside it", tried);
    }

    /// <summary>What solid lies within a body's reach round (x, y, z): rays out at four heights in eight ways.</summary>
    private static string Around(float x, float y, float z)
    {
        var hits = new List<string>();
        foreach (float h in new[] { 0.4f, 0.8f, 1.2f, 1.6f })
            for (int i = 0; i < 8; i++)
            {
                float a = i * MathF.PI / 4;
                var o = new Vector3(x, y + h, z);
                var to = o + new Vector3(MathF.Cos(a), 0, MathF.Sin(a)) * 0.34f;
                var n = Solid.I.NameAt(o, to);
                if (n != "") hits.Add($"{h}/{i * 45}:{n}");
            }
        var q = new PhysicsShapeQueryParameters3D { CollisionMask = Solid.Layer, Margin = 0, Shape = new CylinderShape3D { Radius = Jef.Radius, Height = Jef.Tall - Jef.Step }, Transform = new Transform3D(Basis.Identity, new Vector3(x, y + Jef.Step + (Jef.Tall - Jef.Step) / 2, z)) };
        foreach (var hit in Jef.I.Body.GetWorld3D().DirectSpaceState.IntersectShape(q, 4))
        {
            var rid = hit["rid"].AsRid();
            var box = Solid.I.BodyBounds(rid);
            hits.Add($"in:{Solid.I.BodyName(rid)} {(hit["collider"].AsGodotObject() as Node)?.Name} box {box.Position.X:0.0},{box.Position.Y:0.0},{box.Position.Z:0.0} size {box.Size.X:0.0},{box.Size.Y:0.0},{box.Size.Z:0.0}");
        }
        return string.Join("; ", hits);
    }

    /// <summary>Open water for a swimmer all the way from a to b?</summary>
    private static bool Clear(float ax, float az, float bx, float bz)
    {
        for (float k = 0; k <= 1.001f; k += 0.1f)
            if (!Jef.I.SwimFree(ax + (bx - ax) * k, az + (bz - az) * k)) return false;
        return true;
    }

    /// <summary>The nearest big moored hull in the river with open water on both sides.</summary>
    private (string kind, Func<Transform3D> world, (float Length, float Beam, float Height) d)? BigHull()
    {
        var all = Boats.I.MooredFrames().Concat(Boats.I.Floats.Where(f => f.Outer.Visible).Select(f => (f.Kind, (Func<Transform3D>)(() => f.Inner.GlobalTransform))));
        foreach (var (kind, world) in all)
        {
            var xf = world();
            if (Math.Abs(xf.Basis.Determinant()) < 1e-6f) continue;
            var d = Boats.I.Dims(kind);
            var o = xf.Origin;
            if (d.Length < 15 || d.Beam < 4 || o.Z > -5 || o.X < -130 || o.X > 60) continue;
            GD.Print($"movetest: hull candidate {kind} at {o.X:0.0}, {o.Z:0.0}");
            var side = xf.Basis.X.Normalized();
            bool free = true;
            foreach (float k in new[] { 1f, -1f })
            {
                var p = o + side * k * (d.Beam / 2 + 2.5f);
                Solid.I.Ensure(p, 25);
                if (Jef.I.NearestSwim(p.X, p.Z, 1.5f) == null) free = false;
                // and deep water there, deeper than her keel (no bank of mud by a quay wall)
                var m = Boats.I.HullOf(kind);
                float lv = Water.Level(p.X, p.Z);
                if (m != null && Jef.I.GroundAt(p.X, p.Z, lv) > xf.Origin.Y + m.Bottom - 1.2f) free = false;
            }
            if (free) return (kind, world, d);
        }
        return null;
    }

    private async Task HullCheck()
    {
        var j = Jef.I;
        var big = BigHull();
        if (big == null) { Check(false, "a big moored hull with water on both sides"); return; }
        var (kind, world, d) = big.Value;
        var map = Boats.I.HullOf(kind)!;
        var rows = new List<object>();
        // from the side (the beam) and from off the bow and the stern, straight at her middle
        foreach (var (name, lx, lz) in new[] { ("beam", d.Beam / 2 + 3f, 0f), ("bow", 0.6f, d.Length / 2 + 3f), ("stern", -0.6f, -(d.Length / 2 + 3f)) })
        {
            var xf = world();
            var from = xf * new Vector3(lx, 0, lz);
            Solid.I.Ensure(from, 25);
            await Frames(2);
            if (j.NearestSwim(from.X, from.Z, 2) == null) { rows.Add(new { name, skipped = "no room" }); continue; }
            await Into(from.X, from.Z, Facing(xf.Origin.X - from.X, xf.Origin.Z - from.Z));
            j.SetKey(Key.W, true);
            await Until(() => j.Blocked, 9);
            await Frames(30);
            j.ClearKeys();
            xf = world();
            var local = xf.AffineInverse() * new Vector3(j.X, xf.Origin.Y, j.Z);
            // how far the nearest column of hull at the waterline is from his middle (he should stand off by his radius)
            float near = float.MaxValue;
            for (int z = 0; z < map.Nz; z++)
                for (int x = 0; x < map.Nx; x++)
                    if (map.Has(x, z) && map.Lo[z * map.Nx + x] < 0.3f && map.Hi[z * map.Nx + x] > -0.5f)
                        near = Math.Min(near, new Vector2(map.MinX + (x + 0.5f) * Boats.HullMap.Cell - local.X, map.MinZ + (z + 0.5f) * Boats.HullMap.Cell - local.Z).Length());
            rows.Add(new { name, endLocal = new[] { R(local.X), R(local.Z) }, gapM = R(near), held = j.Blocked });
            await Shot("hull-" + name);
            Check(near > 0.2f && near < 0.75f, $"at the {kind}'s {name} the hull holds him off by about his own breadth", R(near));
        }
        reports.Add(new { hull = new { kind, d.Length, d.Beam, keel = map.Bottom, columns = map.Columns, rows } });
    }

    private async Task DiveCheck()
    {
        var j = Jef.I;
        var big = BigHull();
        if (big == null) { Check(false, "a big moored hull with water on both sides"); return; }
        var (kind, world, d) = big.Value;
        var map = Boats.I.HullOf(kind)!;
        var xf = world();
        var from = xf * new Vector3(d.Beam / 2 + 2.5f, 0, 2);
        var to = xf * new Vector3(-(d.Beam / 2 + 2.5f), 0, 2);
        await Into(from.X, from.Z, Facing(to.X - from.X, to.Z - from.Z));
        int dives = 0, ups = 0;
        float under = 0;
        void OnDive() => dives++;
        void OnUp(float t) { ups++; under = t; }
        j.Dived += OnDive;
        j.Surfaced += OnUp;
        // under, down past the keel, across beneath her, and up on the far side
        float keel = xf.Origin.Y + map.Bottom;
        float minEye = float.MaxValue, breath0 = j.Breath;
        int inHull = 0, f = 0;
        bool shotUnder = false, shotHull = false;
        string phase = "duck";
        (Vector3 local, string phase, Vector3 hull) firstIn = default;
        object? upInfo = null;
        float upT = 0;
        var s = await Sampled(t =>
        {
            var e = j.Cam.GlobalPosition;
            minEye = Math.Min(minEye, e.Y);
            var lx = world().AffineInverse() * e;
            if (j.Diving && Boats.I.HullIn(e.X, e.Z, Jef.DiveR * 0.8f, e.Y - Jef.DiveR * 0.8f, e.Y + Jef.DiveR * 0.8f, out var hx)) { if (inHull++ == 0) firstIn = (hx.AffineInverse() * e, phase, hx.Origin); }
            j.ClearKeys();
            switch (phase)
            {
                case "duck":
                    j.SetKey(Key.C, f < 3);
                    if (j.Diving && f > 3) phase = "down";
                    break;
                case "down":
                    j.SetKey(Key.C, true);
                    if (e.Y < keel - 0.7f) phase = "across";
                    break;
                case "across":
                    j.Pitch = -0.05f;
                    j.SetKey(Key.W, true);
                    if (!shotHull && Math.Abs(lx.X) < 0.6f) { shotHull = true; _ = Shot("dive-under-hull", 0); }
                    if (lx.X < -(d.Beam / 2 + 1.2f)) { phase = "up"; upT = t; }
                    break;
                case "up":
                    j.Pitch = 0.25f;
                    j.SetKey(Key.Space, true);
                    if (!shotUnder) { shotUnder = true; _ = Shot("dive-rising", 0); }
                    if (upInfo == null && t > upT + 3) upInfo = new { eye = new[] { R(e.X), R(e.Y), R(e.Z) }, level = R(Water.Level(e.X, e.Z)), free = j.SwimFree(e.X, e.Z), water = Water.In(e.X, e.Z), near = j.NearestSwim(e.X, e.Z, 3) is { } n ? new[] { R(n.x), R(n.z) } : null, above = Solid.I.NameAt(e, e + new Vector3(0, 2.5f, 0)), aboveSide = Solid.I.NameAt(e + new Vector3(0, 0, 0.25f), e + new Vector3(0, 2.5f, 0.25f)), hull = Boats.I.HullIn(e.X, e.Z, Jef.Radius, Water.Level(e.X, e.Z) - Jef.SwimDeep, Water.Level(e.X, e.Z) + Jef.SwimTop, out var hh) ? hh.Origin.ToString() : "" };
                    if (!j.Diving) phase = "done";
                    break;
            }
            f++;
            return phase != "done";
        }, 40);
        j.ClearKeys();
        await Frames(40);
        j.Dived -= OnDive;
        j.Surfaced -= OnUp;
        var end = world().AffineInverse() * new Vector3(j.X, xf.Origin.Y, j.Z);
        var snap = Snap(s);
        reports.Add(new { dive = new { surface = j.LastSurface.ToString(), peak = Peak(s), upInfo, firstIn = new { l = new[] { R(firstIn.local.X), R(firstIn.local.Y), R(firstIn.local.Z) }, firstIn.phase, h = new[] { R(firstIn.hull.X), R(firstIn.hull.Z) } }, snapAt = R(snap.atT), kind, keel = R(keel), deepestEye = R(minEye), breathUsed = R(breath0 - j.Breath), underS = R(under), dives, ups, framesInHull = inHull, endLocal = new[] { R(end.X), R(end.Z) }, worstCm = R(snap.stepCm), maxSpeed = R(snap.speed) }, track = Track(s, 6) });
        Check(dives == 1 && ups == 1 && j.Swimming && !j.Diving, "C dives, Space brings him up again", new { dives, ups });
        Check(minEye < keel - 0.3f && end.X < -d.Beam / 2, $"he dives under the {kind}'s keel and comes up on her other side", new { keel, minEye, end.X });
        Check(inHull == 0, "never inside the hull on the way", inHull);
        Check(snap.stepCm < 4, "no jump of the view going under and coming up", R(snap.stepCm));
        await Shot("dive-surfaced");

        // straight at her side under the water, above the keel: she holds him
        xf = world();
        from = xf * new Vector3(d.Beam / 2 + 2.5f, 0, -3);
        await Into(from.X, from.Z, Facing(xf.Origin.X - from.X, xf.Origin.Z - from.Z));
        j.SetKey(Key.C, true);
        await Frames(2);
        j.SetKey(Key.C, false);
        await Frames(25);
        inHull = 0;
        await Sampled(t =>
        {
            var e = j.Cam.GlobalPosition;
            if (Boats.I.HullIn(e.X, e.Z, Jef.DiveR * 0.8f, e.Y - Jef.DiveR * 0.8f, e.Y + Jef.DiveR * 0.8f, out _)) inHull++;
            j.SetKey(Key.W, true);
            j.SetKey(Key.C, Water.Level(e.X, e.Z) - e.Y < 0.8f);
            return t < 6;
        }, 7);
        j.ClearKeys();
        var held = world().AffineInverse() * j.Cam.GlobalPosition;
        await Shot("dive-at-hull-side");
        Check(inHull == 0 && held.X > 0, "under water her side holds him too", new { inHull, localX = R(held.X), halfBeam = d.Beam / 2 });

        // out of breath under the hull: he struggles up to open water by himself
        if (Main.I.Flag("move-breath"))
        {
            int gasps = j.Gasps;
            float t0 = 0;
            j.SetKey(Key.C, true);
            await Frames(2);
            j.ClearKeys();
            await Sampled(t => { t0 = t; return j.Diving; }, 45);
            Check(!j.Diving && j.Gasps == gasps + 1, $"his breath gone, he comes up by himself ({t0:0} s)", new { j.Gasps });
        }
    }

    private async Task FloodCheck()
    {
        var j = Jef.I;
        // high water: the lower steps, the landing, the parapet's foot under the water
        MoverClock.Hold(9.6, 1);
        await Frames(5);
        // a flight with open water along its parapet (rowing boats lie at some)
        var fr = QuayExits.Flights[1];
        foreach (var f in new[] { 3, 4, 5, 1, 6, 7, 2, 0 }.Select(i => QuayExits.Flights[i]))
        {
            var (fx, fz) = f.On(3, 1.9f);
            Solid.I.Ensure(new Vector3(fx, 0, fz), 12);
            var (ax, az) = f.On(1.5f, 2.4f);
            var (bx, bz) = f.On(4.2f, 2.4f);
            var (cx, cz) = f.On(4.2f, 3.6f);
            if (Water.In(fx, fz - 0) && Clear(ax, az, bx, bz) && Clear(bx, bz, cx, cz)) { fr = f; break; }
        }
        var (wx, wz) = fr.On(3, 4);
        float level = Water.Level(wx, wz);
        const float cope = 0.06f, going = 0.31f, top = 2 * going, rise = (0.06f - (Tide.MidY + 0.4f)) / 13;
        float Nose(float s) => cope - Math.Max(0, s - top) / going * rise;
        // over the parapet where the step behind it is at the waterline; and over the rail where it is drowned
        float sOver = float.NaN, sFloat = float.NaN;
        for (float s = top + 0.3f; s < top + 12 * going; s += 0.05f)
        {
            float tread = cope - ((int)((s - top) / going) + 1) * rise;
            if (float.IsNaN(sOver) && tread < level - 0.3f) sOver = s;
            if (float.IsNaN(sFloat) && Nose(s) + 0.9f < level - Jef.SwimDeep - 0.15f) sFloat = s + 0.3f;
        }
        var rows = new List<object>();
        var flights = new[] { 3, 4, 5, 1, 2 }.Select(i => QuayExits.Flights[i]).Where(f =>
        {
            var (ax, az) = f.On(1.5f, 2.4f);
            var (bx, bz) = f.On(4.2f, 2.4f);
            var (cx, cz) = f.On(4.2f, 3.6f);
            return Water.In(ax, az) && Clear(ax, az, bx, bz) && Clear(bx, bz, cx, cz);
        }).Take(4).ToList();
        // (the drowned part: the last of the rail, the foot pier and the landing, all under the water at high tide)
        foreach (var (name, sAt) in new[] { ("over the rail", sOver), ("over the drowned rail", sFloat), ("over the drowned landing", 5.4f) })
        foreach (var f in flights)
        {
            fr = f;
            if (float.IsNaN(sAt)) { rows.Add(new { name, skipped = "no such place at this tide" }); break; }
            var (gx, gz) = fr.On(sAt, 3.4f);
            await Into(gx, gz, Facing(-fr.Nx, -fr.Nz));
            // in toward the wall; where the step behind is too deep to stand, on up the flight till his feet find it
            float stood = -1;
            object? standInfo = null;
            string? early = null;
            bool dived = false;
            float diveAt = 0;
            var s = await Sampled(t =>
            {
                j.SetKey(Key.W, stood < 0);
                // a boat lies alongside the steps: he dives under her
                bool hullAhead = Boats.I.HullIn(j.X - fr.Nx * 0.45f, j.Z - fr.Nz * 0.45f, Jef.Radius, level - Jef.SwimDeep, level + Jef.SwimTop, out _);
                j.SetKey(Key.C, j.Swimming && !j.Diving && hullAhead && t > 2 && !dived);
                if (j.Diving)
                {
                    if (!dived) { dived = true; diveAt = t; }
                    // down and in under her for a few seconds, then up where the water is open
                    j.Pitch = t < diveAt + 1.2f ? -0.6f : 0;
                    j.SetKey(Key.Space, t > diveAt + 3.5f);
                }
                else if (dived) j.SetKey(Key.Space, false);
                if (t > 3.5f && early == null) early = string.Join(" | ", new[] { -0.45f, -0.2f, 0.1f, 0.3f }.Select(h => Solid.I.NameAt(new Vector3(j.X, level + h, j.Z), new Vector3(j.X - fr.Nx * 1.5f, level + h, j.Z - fr.Nz * 1.5f)))) + $" hull {Boats.I.HullIn(j.X - fr.Nx * 0.4f, j.Z - fr.Nz * 0.4f, Jef.Radius, level - Jef.SwimDeep, level + Jef.SwimTop, out var hh)} {hh.Origin}";
                if (t > 5 && j.Swimming && !j.Diving && (!dived || t > 9)) { j.Yaw = Facing(-fr.Tx, -fr.Tz); j.Pitch = 0; }
                if (stood < 0 && j.Grounded && !j.Swimming && !j.Climbing) { stood = t; standInfo = new { free = j.BodyFree(j.X, j.Y, j.Z), what = Around(j.X, j.Y, j.Z), ground = R(j.GroundAt(j.X, j.Z, j.Y)), y = R(j.Y), near = Solid.I.NameAt(new Vector3(j.X, j.Y + 0.5f, j.Z), new Vector3(j.X, j.Y + 0.5f, j.Z - 0.5f)) + " | " + Solid.I.NameAt(new Vector3(j.X, j.Y + 0.5f, j.Z), new Vector3(j.X, j.Y + 0.5f, j.Z + 0.5f)) }; }
                return t < 1 || j.Climbing || j.Swimming && t < 16 || stood >= 0 && t < stood + 0.6f;
            }, 20);
            await Frames(15);
            j.ClearKeys();
            var snap = Snap(s);
            bool climbed = s.Any(x => x.State == "climb");
            bool hull = Boats.I.HullIn(j.X - fr.Nx * 0.5f, j.Z - fr.Nz * 0.5f, Jef.Radius, level - Jef.SwimDeep, level + Jef.SwimTop, out _);
            string blocker = string.Join(" | ", new[] { -0.45f, -0.2f, 0.1f, 0.3f }.Select(h => Solid.I.NameAt(new Vector3(j.X, level + h, j.Z), new Vector3(j.X - fr.Nx * 1.5f, level + h, j.Z - fr.Nz * 1.5f))));
            rows.Add(new { name, dived, early, blocker, flight = new[] { fr.Ox, fr.Oz }, s = R(sAt), level = R(level), end = new[] { R(j.X), R(j.Y), R(j.Z) }, climbed, heldByHull = hull, standInfo, worstCm = R(snap.stepCm), peak = Peak(s), track = Track(s, 5) });
            if (j.Swimming && f != flights[^1]) continue; // a boat lies alongside (or came by meanwhile): the next flight
            Check(!j.Swimming && j.Grounded && j.Y > level - Tide.Wade - 0.05f, $"high water at the steps: {name}, he is on his feet on the steps", new { j.Y, level, climbed });
            Check(snap.stepCm < 4, $"{name}: smooth", R(snap.stepCm));
            await Shot("flood-" + name.Replace(' ', '-'));
            break;
        }
        reports.Add(new { flood = rows });
        MoverClock.Hold(13, 1);
    }

    /// <summary>Pictures under the water: at a hull's side, looking up at the surface, down at the bed, and half out.</summary>
    private async Task LookCheck()
    {
        var j = Jef.I;
        var big = BigHull();
        if (big == null) return;
        var (kind, world, d) = big.Value;
        var xf = world();
        var from = xf * new Vector3(d.Beam / 2 + 2.2f, 0, 4);
        await Into(from.X, from.Z, Facing(xf.Origin.X - from.X, xf.Origin.Z - from.Z));
        await Shot("look-surface-hull", 20);
        j.SetKey(Key.C, true);
        await Frames(2);
        j.SetKey(Key.C, false);
        await Until(() => j.Cam.GlobalPosition.Y < Water.Level(j.X, j.Z) - 1.4f, 4);
        j.ClearKeys();
        foreach (var (name, pitch) in new[] { ("look-under-hull", 0.15f), ("look-under-up", 1.1f), ("look-under-down", -1.0f) })
        {
            j.Pitch = pitch;
            j.SetKey(Key.C, true);
            await Frames(1);
            j.SetKey(Key.C, false);
            await Shot(name, 25);
        }
        reports.Add(new { look = new { kind, eye = j.Cam.GlobalPosition.ToString(), level = Water.Level(j.X, j.Z), under = Scheldemist.World.Underwater.I.Under } });
    }
}
