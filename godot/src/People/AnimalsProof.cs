using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

/// <summary>
/// Repeatable pictures and measures of the animals in the native town (--animals-captures dir; --animals-slide dir for
/// the measures alone): every kind at a doorstep beside a gas lamp, at 1 m and 3 m from the front, side and back and
/// low behind, standing, sitting and lying, at 13:00 clear, 13:00 rain and 19:30 under the lamps; each rig walking,
/// trotting and running down the street with the camera beside it (a strip of frames); the foot slide of every paw
/// in stance measured on the live skeleton as the animal moves at the gait's speeds and through the gait changes;
/// the dog cart with its draught dog. The town's own animals are hidden meanwhile.
/// </summary>
[GamePart(898)]
internal partial class AnimalsProof : Node
{
    private string dir = "";
    private readonly List<object> pictures = new();

    public override async void _Ready()
    {
        string cap = Main.I.Arg("animals-captures"), sl = Main.I.Arg("animals-slide");
        if (cap == "" && sl == "") { SetProcess(false); return; }
        bool shots = cap != "";
        dir = Paths.Absolute(shots ? cap : sl);
        try
        {
            Directory.CreateDirectory(dir);
            var town = Main.I.GetNode<Town.Townspeople>("Townspeople");
            for (int i = 0; town.Data == null && i < 2400; i++) await Frame();
            for (int i = 0; !Dev.Kit.I.IsReady && i < 1800; i++) await Frame();
            if (town.Data == null || town.Walk == null || !Animal.Ready) throw new InvalidOperationException("The animal proof needs the native town and animals.scn.");
            town.ClockRuns = false;
            Game.GameState.I.PlayingWhen = () => false;
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true;
            Main.I.Cam.SetProcess(false);
            Input.MouseMode = Input.MouseModeEnum.Visible;
            await Dev.Kit.I.Light(13, "clear");
            var (spot, face, lamp) = Doorstep(town);
            // by day the sunniest doorstep on open ground (no lamp needed); at 19:30 the one beside a lamp
            var (sunSpot, sunFace, _) = Doorstep(town, 11f, 0.5f, float.PositiveInfinity) ?? Doorstep(town, 8f, 0.3f, float.PositiveInfinity) ?? (spot, face, lamp);
            GD.Print($"animals doorstep by day: {sunSpot}, facing {sunFace}; " + string.Join(", ", doorCounts.Select(kv => kv.Key + " " + kv.Value)));
            var report = new Dictionary<string, object> { ["doorstep"] = new[] { sunSpot.X, sunSpot.Y, sunSpot.Z }, ["lampDoorstep"] = new[] { spot.X, spot.Y, spot.Z }, ["lamp"] = new[] { lamp.X, lamp.Y, lamp.Z } };
            // the slide on straight runs and through the gait changes, per rig
            var street = Street(town, spot, face);
            // (--horses-only: the horse's pictures alone, no animal measures or pictures)
            bool horsesOnly = Main.I.Flag("horses-only");
            if (!horsesOnly)
            {
                report["slide"] = await Slide(town, street.from, street.dir);
                report["startStop"] = await StartStop(town, street.from, street.dir, false);
            }
            if (Main.I.Flag("animals-sun-test") && !horsesOnly)
            {
                // the draught dog in open sun on the square, turned four ways (does the light fall smoothly over it?)
                HideTownAnimals();
                var open = street.from + street.dir * 6;
                open.Y = (float)town.Walk.BaseAt(open.X, open.Z);
                var sd = new Vector3(street.dir.Z, 0, -street.dir.X);
                var a = Spawn("dog_draught", open, 0);
                for (int k = 0; k < 4; k++)
                {
                    a.Group.Rotation = new Vector3(0, k * Mathf.Pi / 2, 0);
                    a.Hold("idle", 0);
                    await Shoot($"sun-{k}", open + sd * 2.4f + street.dir * 0.6f + Vector3.Up * 0.9f, open + Vector3.Up * 0.4f, 13, "clear");
                }
                a.Dispose();
            }
            if (shots)
            {
                if (!horsesOnly)
                {
                    await Captures(town, (sunSpot, sunFace), (spot, face));
                    await Strips(town, street.from, street.dir);
                    report["startStrips"] = await StartStop(town, street.from, street.dir, true);
                    report["cart"] = await Cart(town);
                }
                if (horsesOnly || Main.I.Flag("horses-captures"))
                {
                    HideTownAnimals();
                    report["horses"] = await new HorsesProof(this, dir, pictures).Run(town, (sunSpot, sunFace), (spot, face), street.from, street.dir);
                }
            }
            report["pictures"] = pictures;
            report["ok"] = true;
            File.WriteAllText(Path.Combine(dir, shots ? "animals-captures.json" : "animals-slide.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }

    private async System.Threading.Tasks.Task Frame() => await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);

    private static void HideTownAnimals()
    {
        if (Animals.I is { } a)
        {
            a.SetProcess(false);
            foreach (var g in a.Groups) g.Visible = false;
        }
    }

    /// <summary>A resident's doorstep within a few metres of a gas lamp, with open street in front and at the sides.</summary>
    private static (Vector3 spot, Vector3 face, Vector3 lamp) Doorstep(Town.Townspeople town)
    {
        int level = 0;
        foreach (var (open, sunAt, lampFar) in new[] { (11f, 0.35f, 7f), (8f, 0.2f, 10f), (6f, 0f, 12f), (3f, -1f, 14f) })
        {
            level++;
            if (Doorstep(town, open, sunAt, lampFar) is { } d)
            {
                GD.Print($"animals doorstep: level {level} (open {open} m, sun {sunAt}, lamp within {lampFar} m) at {d.spot}, facing {d.face}; " + string.Join(", ", doorCounts.Select(kv => kv.Key + " " + kv.Value)));
                return d;
            }
            GD.Print($"animals doorstep: none at level {level}; " + string.Join(", ", doorCounts.Select(kv => kv.Key + " " + kv.Value)));
        }
        throw new InvalidOperationException("no doorstep beside a lamp with open street round it");
    }

    private static (Vector3 spot, Vector3 face, Vector3 lamp)? Doorstep(Town.Townspeople town, float needOpen, float sunAt, float lampFar)
    {
        var w = town.Walk!;
        var lamps = World.Lights.I?.Lamps.Select(l => l.at).ToList() ?? new List<Vector3>();
        (Vector3, Vector3, Vector3)? best = null;
        double bestScore = double.MaxValue;
        var vis = Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray().First(p => p.GetProperty("place").GetString() == "vismarkt").GetProperty("pos");
        var centre = new Vector2(vis[0].GetSingle(), vis[2].GetSingle());
        // a house front the midday sun falls on (the light on the animal, not the street's shadow)
        var sun = World.Daylight.I.SunDir;
        var sunFlat = new Vector2(sun.X, sun.Z).Normalized();
        doorCounts.Clear();
        void Count(string why) => doorCounts[why] = doorCounts.GetValueOrDefault(why) + 1;
        foreach (var r in town.Data!.Residents)
        {
            var s = new Vector2((float)r.HomeSx, (float)r.HomeSz);
            var f = new Vector2((float)(r.HomeSx - r.HomeX), (float)(r.HomeSz - r.HomeZ));
            if (f.Length() < 0.05f) continue;
            f = f.Normalized();
            var side = new Vector2(f.Y, -f.X);
            bool Open(Vector2 p) => w.Free(p.X, p.Y);
            if (!Open(s) || !Open(s + f * 1.2f) || !Open(s + f * 3.2f) || !Open(s + side * 3.2f) || !Open(s - side * 3.2f) || !Open(s + f * 1.5f + side * 3.2f)) { Count("closed"); continue; }
            if (f.Dot(sunFlat) < sunAt) { Count("away from the sun"); continue; }
            // open ground ahead (a square or a wide street), so no house opposite shades it at midday
            float open = 0;
            while (open < 16 && Open(s + f * (open + 0.5f)) && Open(s + f * (open + 0.5f) + side * 1.5f) && Open(s + f * (open + 0.5f) - side * 1.5f)) open += 0.5f;
            if (open < needOpen) { Count("narrow"); continue; }
            var foot = new Vector3(s.X, (float)w.BaseAt(s.X, s.Y), s.Y);
            var fw = new Vector3(f.X, 0, f.Y);
            var sw = new Vector3(side.X, 0, side.Y);
            if (sunAt > -1 && !(Sunlit(foot + Vector3.Up * 0.35f + fw * 0.4f, sun) && Sunlit(foot + Vector3.Up * 0.1f + fw * 0.9f + sw * 0.3f, sun)
                                && Sunlit(foot + Vector3.Up * 0.6f + fw * 0.2f - sw * 0.3f, sun))) { Count("shaded"); continue; }
            Count("candidates");
            if (float.IsPositiveInfinity(lampFar))
            {
                double sc = (s - centre).Length() * 0.01 - f.Dot(sunFlat) * 3 - open * 0.05;
                if (sc < bestScore) { bestScore = sc; best = (foot, new Vector3(f.X, 0, f.Y), Vector3.Zero); }
                continue;
            }
            foreach (var l in lamps)
            {
                float d = new Vector2(l.X - s.X, l.Z - s.Y).Length();
                if (d < 2.5f || d > lampFar) continue;
                double score = d + (s - centre).Length() * 0.01 - f.Dot(sunFlat) * 3;
                if (score < bestScore)
                {
                    bestScore = score;
                    float y = (float)w.BaseAt(s.X, s.Y);
                    best = (new Vector3(s.X, y, s.Y), new Vector3(f.X, 0, f.Y), l);
                }
            }
        }
        return best;
    }

    private static readonly Dictionary<string, int> doorCounts = new();

    /// <summary>Does the midday sun reach this point (nothing of the town between it and the sun)?</summary>
    private static bool Sunlit(Vector3 p, Vector3 sun)
    {
        var space = Main.I.Cam.GetWorld3D()?.DirectSpaceState;
        if (space == null) return true;
        var q = PhysicsRayQueryParameters3D.Create(p, p + sun.Normalized() * 120);
        return space.IntersectRay(q).Count == 0;
    }

    /// <summary>A straight run of open street from near the doorstep (12 m), for the gaits.</summary>
    private static (Vector3 from, Vector3 dir) Street(Town.Townspeople town, Vector3 spot, Vector3 face)
    {
        var w = town.Walk!;
        var origin = spot + face * 2.2f;
        for (int k = 0; k < 24; k++)
        {
            float a = k * Mathf.Tau / 24;
            var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
            var side = new Vector3(d.Z, 0, -d.X);
            bool ok = true;
            for (float s = -6; s <= 6 && ok; s += 0.4f)
            {
                var p = origin + d * s;
                ok = w.Free(p.X, p.Z) && w.Free(p.X + side.X * 3, p.Z + side.Z * 3) && Math.Abs(w.BaseAt(p.X, p.Z) - spot.Y) < 0.08;
            }
            if (ok) return (origin - d * 6, d);
        }
        throw new InvalidOperationException("no straight open street near the doorstep");
    }

    private Animal Spawn(string kind, Vector3 at, float yaw)
    {
        var a = Animal.Make(kind, "proof:" + kind) ?? throw new InvalidOperationException("no animal " + kind);
        a.Group.Visible = true;
        a.Group.Position = at;
        a.Group.Rotation = new Vector3(0, yaw, 0);
        a.Start();
        return a;
    }

    private static float YawOf(Vector3 d) => Mathf.Atan2(d.X, d.Z);

    private async System.Threading.Tasks.Task Shoot(string name, Vector3 from, Vector3 at, double hour, string weather)
    {
        Main.I.Cam.LookAtFromPosition(from, at);
        if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
        for (int i = 0; i < 8; i++) await Frame();
        Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name + ".png"));
        var daylight = World.Daylight.I;
        if (Math.Abs(daylight.Hour - hour) > 0.02 || daylight.Weather != weather) throw new InvalidOperationException($"{name}: wrong live clock/weather {daylight.Hour} {daylight.Weather}");
        pictures.Add(new { name = name + ".png", hour = daylight.Hour, weather = daylight.Weather, daylight.Night, from = new[] { from.X, from.Y, from.Z }, at = new[] { at.X, at.Y, at.Z } });
    }

    private async System.Threading.Tasks.Task Captures(Town.Townspeople town, (Vector3 spot, Vector3 face) byDay, (Vector3 spot, Vector3 face) byLamp)
    {
        HideTownAnimals();
        foreach (var (label, hour, weather) in new[] { ("day", 13.0, "clear"), ("rain", 13.0, "rain"), ("lamps", 19.5, "clear") })
        {
            var (spot, face) = label == "lamps" ? byLamp : byDay;
            var side = new Vector3(face.Z, 0, -face.X);
            await Dev.Kit.I.Light(hour, weather);
            HideTownAnimals();
            for (int i = 0; i < 60; i++) await Frame();
            foreach (string kind in Animal.Kinds)
            {
                if (!Wanted(kind)) continue;
                var rig = Animal.RigOf(kind)!;
                float H = rig.H;
                var a = Spawn(kind, spot, YawOf(face));
                float mid = 0.55f * H, head = 1.0f * H;
                async System.Threading.Tasks.Task Pose(string clip, float t, float yaw)
                {
                    a.Group.Rotation = new Vector3(0, yaw, 0);
                    a.Hold(clip, t);
                    await Frame();
                }
                var c = spot + Vector3.Up * mid;
                await Pose("idle", 1.2f, YawOf(face));
                // a metre from the nose (the nose stands about half a shoulder height ahead of the body's middle)
                await Shoot($"{label}-{kind}-1m-front", spot + face * (1.0f + 0.5f * H) + Vector3.Up * (head + 0.25f), spot + face * 0.25f * H + Vector3.Up * (0.85f * H), hour, weather);
                if (label == "day" || Main.I.Flag("animals-integration-proof"))
                {
                    await Shoot($"{label}-{kind}-3m-front", spot + face * 3f + Vector3.Up * 1.5f, c, hour, weather);
                    // side: the animal turned along the street
                    await Pose("idle", 1.2f, YawOf(side));
                    await Shoot($"{label}-{kind}-1m-side", spot + face * 1.0f + Vector3.Up * (mid + 0.3f), c, hour, weather);
                    await Shoot($"{label}-{kind}-3m-side", spot + face * 3f + Vector3.Up * 1.4f, c, hour, weather);
                    // the far copy (past 15 m), as the street sees it
                    await Shoot($"{label}-{kind}-18m-far", spot + face * 17.5f + side * 3f + Vector3.Up * 1.7f, c, hour, weather);
                    // back: the animal waits at the door, the camera in the street behind it
                    await Pose("idle", 1.2f, YawOf(-face));
                    await Shoot($"{label}-{kind}-3m-back", spot + face * 3f + Vector3.Up * 1.4f, c, hour, weather);
                    await Shoot($"{label}-{kind}-1m-back-low", spot + face * 1.0f + side * 0.45f + Vector3.Up * 0.12f, c, hour, weather);
                    await Pose("sit", 1.0f, YawOf(side));
                    await Shoot($"{label}-{kind}-3m-sit", spot + face * 3f + Vector3.Up * 1.4f, c, hour, weather);
                    if (Main.I.Flag("animals-integration-proof"))
                        await Shoot($"{label}-{kind}-1m-sit", spot + face * 1f + Vector3.Up * (head + 0.25f), c, hour, weather);
                    await Pose(rig.Clips.ContainsKey("sleep") && kind.StartsWith("cat") ? "sleep" : "lie", 1.0f, YawOf(side));
                    await Shoot($"{label}-{kind}-3m-lie", spot + face * 2.6f + side * 1.2f + Vector3.Up * 1.4f, spot, hour, weather);
                    if (Main.I.Flag("animals-integration-proof"))
                    {
                        await Shoot($"{label}-{kind}-1m-lie", spot + face * 1f + Vector3.Up * (mid + 0.3f), spot + Vector3.Up * mid * 0.5f, hour, weather);
                        await Pose("walk", 0.35f, YawOf(side));
                        await Shoot($"{label}-{kind}-1m-walk", spot + face * 1f + Vector3.Up * (mid + 0.3f), c, hour, weather);
                        await Shoot($"{label}-{kind}-3m-walk", spot + face * 3f + Vector3.Up * 1.4f, c, hour, weather);
                        await Pose("trot", 0.3f, YawOf(side));
                        await Shoot($"{label}-{kind}-3m-trot", spot + face * 3f + Vector3.Up * 1.4f, c, hour, weather);
                        // from above: the back, the croup and the head seen from a person's eye straight over it
                        await Pose("idle", 1.2f, YawOf(side));
                        await Shoot($"{label}-{kind}-1m-above", spot + face * 0.25f + Vector3.Up * (1.05f + H), spot + Vector3.Up * mid * 0.6f, hour, weather);
                        // in the street, walking along it, three metres off
                        var street = spot + face * 2.6f;
                        street.Y = (float)town.Walk!.BaseAt(street.X, street.Z);
                        a.Group.Position = street;
                        await Pose("walk", 0.6f, YawOf(side));
                        await Shoot($"{label}-{kind}-street-3m", street + face * 3f + side * 0.6f + Vector3.Up * 1.3f, street + Vector3.Up * mid, hour, weather);
                        a.Group.Position = spot;
                    }
                }
                else
                {
                    await Pose("idle", 1.2f, YawOf(side));
                    await Shoot($"{label}-{kind}-3m-side", spot + face * 3f + Vector3.Up * 1.4f, c, hour, weather);
                }
                a.Dispose();
            }
        }
        await Dev.Kit.I.Light(13, "clear");
    }

    /// <summary>Each rig walking, trotting and running down the street, the camera keeping beside it.</summary>
    private async System.Threading.Tasks.Task Strips(Town.Townspeople town, Vector3 from, Vector3 dir)
    {
        HideTownAnimals();
        var side = new Vector3(dir.Z, 0, -dir.X);
        var done = new HashSet<string>();
        foreach (string kind in Animal.Kinds)
        {
            var rig = Animal.RigOf(kind)!;
            if (!done.Add(rig.Name)) continue;
            foreach (string gait in new[] { "walk", "trot", "run" })
            {
                if (!rig.Clips.TryGetValue(gait, out var g)) continue;
                var a = Spawn(kind, from, YawOf(dir));
                float v = g.Speed;
                float travelled = 0;
                int shot = 0;
                float cycle = g.Stride * a.Size;
                // run up for one cycle, then six frames a sixth of a cycle apart
                while (shot < 6)
                {
                    float dt = (float)GetProcessDeltaTime();
                    travelled += v * dt;
                    a.Group.Position = from + dir * travelled;
                    a.Play("walk");
                    a.Update(dt);
                    var at = a.Group.Position + Vector3.Up * 0.5f * rig.H;
                    Main.I.Cam.LookAtFromPosition(at + side * (3.0f * rig.H + 0.9f) + Vector3.Up * 0.1f, at);
                    if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
                    if (travelled > cycle && travelled >= cycle * (1 + shot / 6f))
                    {
                        await Frame();
                        Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir_, $"strip-{rig.Name}-{gait}-{shot}.png"));
                        pictures.Add(new { name = $"strip-{rig.Name}-{gait}-{shot}.png", clip = a.ClipName, phase = a.Phase });
                        shot++;
                    }
                    else await Frame();
                    if (travelled > 11) break;
                }
                a.Dispose();
            }
        }
    }

    private string dir_ => dir;

    private static bool Wanted(string kind)
    {
        string only = Main.I.Arg("animals-kinds");
        return only == "" || only.Split(',').Contains(kind);
    }

    /// <summary>From standing into each gait and back to a stand, the way an animal sets off in the street: it stands,
    /// speeds up over a moment, goes four metres, slows down and stands again. Every paw is measured while it is on the
    /// ground (its toe within a few millimetres of the street, whatever clip shows): how far it moves before it lifts.
    /// Fixed steps of 1/60 s. With shots: a strip of the start and the stop for the pig and the draught dog, the camera
    /// beside it, each frame named with the worst slide so far.</summary>
    private async System.Threading.Tasks.Task<object> StartStop(Town.Townspeople town, Vector3 from, Vector3 dir, bool shots)
    {
        HideTownAnimals();
        var rows = new List<object>();
        var done = new HashSet<string>();
        var side = new Vector3(dir.Z, 0, -dir.X);
        if (shots) await Dev.Kit.I.Light(13, "clear");
        foreach (string kind in Animal.Kinds)
        {
            var rig = Animal.RigOf(kind)!;
            if (!done.Add(rig.Name)) continue;
            if (shots && kind is not ("pig_pink" or "dog_draught")) continue;
            foreach (string gait in shots ? new[] { "walk" } : new[] { "walk", "trot", "run" })
            {
                if (!rig.Clips.TryGetValue(gait, out var g)) continue;
                var a = Spawn(kind, from, YawOf(dir));
                float v = g.Speed * a.Size, acc = gait == "walk" ? 0.5f : gait == "trot" ? 0.9f : 1.4f;
                // on the ground: the toe within a millimetre and a half or so of the street (a paw coming down or lifting
                // off passes that height with its speed nearly gone)
                float ground = from.Y, near = Math.Max(0.0012f, 0.003f * rig.H * a.Size), lowest = 9;
                const float dt = 1 / 60f;
                float t = 0, travelled = 0, stopAt = -1, speed = 0;
                var start = new Dictionary<string, Vector3>();
                var worst = new Dictionary<string, Dictionary<string, float>> { ["start"] = new(), ["going"] = new(), ["stop"] = new() };
                var clips = new List<string>();
                System.Text.StringBuilder? trace = Main.I.Flag("animals-slide-trace") && !shots ? new() : null;
                int shot = 0;
                float nextShot = 0.6f;
                while (t < 14)
                {
                    t += dt;
                    // stand 0.8 s, speed up, go on to 4 m, slow down, stand 2 s
                    if (t < 0.8f) speed = 0;
                    else if (stopAt < 0)
                    {
                        speed = v * Math.Min(1, (t - 0.8f) / acc);
                        if (travelled >= 4f) stopAt = t;
                    }
                    else speed = Math.Max(0, v * (1 - (t - stopAt) / (acc * 0.8f)));
                    if (stopAt > 0 && t > stopAt + acc * 0.8f + 2.0f) break;
                    travelled += speed * dt;
                    a.Group.Position = from + dir * travelled;
                    a.Play("walk");
                    a.Update(dt);
                    if (clips.Count == 0 || clips[^1] != a.ClipName) clips.Add(a.ClipName);
                    string part = stopAt > 0 ? "stop" : t < 0.8f + acc + 0.6f ? "start" : "going";
                    if (shots)
                    {
                        var at = a.Group.Position + Vector3.Up * 0.5f * rig.H;
                        Main.I.Cam.LookAtFromPosition(at + side * (3.0f * rig.H + 0.9f) + Vector3.Up * 0.1f, at);
                        if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
                    }
                    await Frame();
                    trace?.AppendLine(FormattableString.Invariant($"{t:0.000};{travelled:0.000};{a.Speed:0.000};") + a.DebugState() + ";" + string.Join(";", a.Toes().Select(x => FormattableString.Invariant($"{x.leg}:{x.at.X:0.0000}:{x.at.Y - ground:0.0000}:{x.at.Z:0.0000}"))));
                    rig.Clips.TryGetValue(a.ClipName, out var shown);
                    foreach (var (leg, toe) in a.Toes())
                    {
                        lowest = Math.Min(lowest, toe.Y - ground);
                        // on the ground: in a gait, the paws its footfall table has standing (as the gait proof counts
                        // them); at rest (the stand, the stop's steps), a toe within a millimetre or two of the street
                        // (a paw the planting lifts to step it on, in a start, a change or a stop, is not on the ground)
                        bool down = shown != null && shown.Kind == "gait"
                            ? ((a.Phase - shown.Phases.GetValueOrDefault(leg)) % 1 + 1) % 1 < shown.Duty * 0.98f && toe.Y - ground < 0.004f
                            : toe.Y - ground < near;
                        if (down)
                        {
                            if (!start.TryGetValue(leg, out var p0)) { start[leg] = toe; continue; }
                            float slide = new Vector2(toe.X - p0.X, toe.Z - p0.Z).Length();
                            var w = worst[part];
                            w[leg] = Math.Max(w.GetValueOrDefault(leg), slide);
                        }
                        else start.Remove(leg);
                    }
                    bool startShots = t >= nextShot && t < 0.8f + acc + 0.9f;
                    bool stopShots = stopAt > 0 && t >= nextShot && t > stopAt - 0.2f && t < stopAt + acc * 0.8f + 1.2f;
                    if (shots && (startShots || stopShots))
                    {
                        float worstMm = worst.Values.SelectMany(x => x.Values).DefaultIfEmpty(0).Max() * 1000;
                        string name = $"start-{kind}-{shot:00}-t{t:0.00}-slide{worstMm:0.0}mm.png";
                        Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir_, name));
                        pictures.Add(new { name, clip = a.ClipName, t, speed, worstSlideMm = Math.Round(worstMm, 2) });
                        shot++;
                        nextShot = t + 0.15f;
                    }
                    if (shots && stopAt > 0 && nextShot < stopAt - 0.2f) nextShot = stopAt - 0.2f;
                }
                if (trace != null) File.WriteAllText(Path.Combine(dir_, $"trace-start-{rig.Name}-{gait}.csv"), trace.ToString());
                rows.Add(new { rig = rig.Name, kind, gait, speed = v, clips, groundMm = Math.Round(near * 1000, 2), lowestToeMm = Math.Round(lowest * 1000, 2), maxSlideMm = worst.ToDictionary(p => p.Key, p => p.Value.ToDictionary(q => q.Key, q => Math.Round(q.Value * 1000, 2))),
                    worstMm = Math.Round(worst.Values.SelectMany(x => x.Values).DefaultIfEmpty(0).Max() * 1000, 2) });
                a.Dispose();
            }
        }
        return rows;
    }

    /// <summary>Paw slide in stance on the live skeleton: each rig at each gait's speed, then through the gait changes.</summary>
    private async System.Threading.Tasks.Task<object> Slide(Town.Townspeople town, Vector3 from, Vector3 dir)
    {
        HideTownAnimals();
        var rows = new List<object>();
        var done = new HashSet<string>();
        // the clip alone: held at 60 phases, each standing toe in the animal's own frame against the authored sweep
        var held = new List<object>();
        foreach (string kind in Animal.Kinds)
        {
            var rig = Animal.RigOf(kind)!;
            if (!done.Add(rig.Name)) continue;
            foreach (string gait in new[] { "walk", "trot", "run" })
            {
                var c = rig.Clips[gait];
                var a = Spawn(kind, from, 0);
                a.Group.Position = Vector3.Zero;
                var dev = new Dictionary<string, double>();
                var lo = new Dictionary<string, float>();
                var hi = new Dictionary<string, float>();
                var hip = new List<float>();
                for (int k = 0; k < 120; k++)
                {
                    float ph = k / 120f;
                    a.Hold(gait, ph);
                    await Frame();
                    foreach (var (leg, at) in a.Toes())
                    {
                        float s = ((ph - c.Phases.GetValueOrDefault(leg)) % 1 + 1) % 1;
                        if (s >= c.Duty) continue;
                        // standing still on the street: the toe's z plus the ground the body has covered is constant
                        float v = at.Z + c.Stride * s * a.Size;
                        lo[leg] = Math.Min(lo.GetValueOrDefault(leg, 9f), v);
                        hi[leg] = Math.Max(hi.GetValueOrDefault(leg, -9f), v);
                        dev[leg] = hi[leg] - lo[leg];
                    }
                }
                var track = new List<float[]>();
                if (rig.Name == "mongrel" && gait == "walk")
                    for (int k = 0; k < 120; k++)
                    {
                        a.Hold(gait, k / 120f);
                        await Frame();
                        var hl = a.Toes().First(x => x.leg == "HL").at / a.Size;
                        var fl = a.Toes().First(x => x.leg == "FL").at / a.Size;
                        var sk = a.Group.GetChild(0).GetNode<Skeleton3D>("Skeleton3D");
                        var hp = sk.GetBonePosePosition(sk.FindBone("hips"));
                        var chp = sk.GetBoneGlobalPose(sk.FindBone("chest")).Origin;
                        var scp = sk.GetBoneGlobalPose(sk.FindBone("scapulaL")).Origin;
                        var hup = sk.GetBoneGlobalPose(sk.FindBone("humerusL")).Origin;
                        track.Add(new[] { hl.X, hl.Y, hl.Z, hp.X, hp.Y, hp.Z, fl.X, fl.Y, fl.Z, chp.X, chp.Y, chp.Z, scp.X, scp.Y, scp.Z, hup.X, hup.Y, hup.Z });
                        if (k == 0) GD.Print("animals skeleton: " + string.Join(",", Enumerable.Range(0, sk.GetBoneCount()).Select(b2 => sk.GetBoneName(b2) + "<" + sk.GetBoneParent(b2))) + " skel xf " + sk.Transform + " root " + a.Group.GetChild(0).GetType().Name + " " + ((Node3D)a.Group.GetChild(0)).Transform);
                    }
                held.Add(new { rig = rig.Name, gait, size = a.Size, posTrack = c.Pos, deviationMm = dev.ToDictionary(p => p.Key, p => Math.Round(p.Value * 1000, 2)), track });
                a.Dispose();
            }
        }
        rows.Add(new { held });
        // the rest clips held: where each toe is over the street (it should stand on it)
        var rest = new List<object>();
        done.Clear();
        foreach (string kind in Animal.Kinds)
        {
            var rig = Animal.RigOf(kind)!;
            if (!done.Add(rig.Name)) continue;
            var a = Spawn(kind, from, 0);
            foreach (string clip in new[] { "idle", "sniff" })
            {
                if (!rig.Clips.TryGetValue(clip, out var c)) continue;
                foreach (float f in new[] { 0f, 0.3f, 0.6f })
                {
                    a.Hold(clip, f * c.Length);
                    await Frame();
                    rest.Add(new { rig = rig.Name, clip, at = f, toesMm = a.Toes().ToDictionary(x => x.leg, x => Math.Round((x.at.Y - from.Y) * 1000, 1)) });
                }
            }
            a.Dispose();
        }
        rows.Add(new { rest });
        done.Clear();
        foreach (string kind in Animal.Kinds)
        {
            var rig = Animal.RigOf(kind)!;
            if (!done.Add(rig.Name)) continue;
            var cases = new List<(string name, Func<float, float> speed)>();
            foreach (string gait in new[] { "walk", "trot", "run" })
                if (rig.Clips.TryGetValue(gait, out var g))
                {
                    float v = g.Speed;
                    cases.Add((gait, _ => v));
                }
            float w = rig.Clips["walk"].Speed, r = rig.Clips["run"].Speed;
            cases.Add(("speeding-up", t => w * 0.8f + (r * 1.05f - w * 0.8f) * Math.Clamp(t / 4f, 0, 1)));
            foreach (var (name, speed) in cases)
            {
                var a = Spawn(kind, from, YawOf(dir));
                System.Text.StringBuilder? trace = Main.I.Flag("animals-slide-trace") && name == "speeding-up" ? new() : null;
                float travelled = 0, t = 0;
                var start = new Dictionary<string, Vector3>();
                var duringChange = new HashSet<string>();
                var worst = new Dictionary<string, float>();
                float worstSwitch = 0;
                int stances = 0, frames = 0;
                string lastClip = "";
                float sinceSwitch = 9;
                while (travelled < 11.5f && t < 6)
                {
                    float dt = (float)GetProcessDeltaTime();
                    t += dt;
                    travelled += speed(t) * dt;
                    a.Group.Position = from + dir * travelled;
                    a.Play("walk");
                    a.Update(dt);
                    if (a.ClipName != lastClip) { sinceSwitch = 0; lastClip = a.ClipName; start.Clear(); }
                    sinceSwitch += dt;
                    await Frame();
                    trace?.AppendLine($"{t:0.000},{travelled:0.000},{a.Speed:0.000}," + a.DebugState() + "," + string.Join(",", a.Toes().Select(x => $"{x.leg}:{x.at.X:0.0000}:{x.at.Y:0.0000}:{x.at.Z:0.0000}")));
                    if (travelled < 1.5f || !rig.Clips.TryGetValue(a.ClipName, out var c) || c.Kind != "gait") continue;
                    frames++;
                    foreach (var (leg, at) in a.Toes())
                    {
                        float ph = c.Phases.GetValueOrDefault(leg);
                        float s = ((a.Phase - ph) % 1 + 1) % 1;
                        // on the ground in the gait's stance (a paw the planting lifts to step it on is not)
                        if (s < c.Duty * 0.98f && at.Y - from.Y < 0.004f)
                        {
                            if (!start.TryGetValue(leg, out var p0))
                            {
                                start[leg] = at;
                                stances++;
                                if (sinceSwitch < 0.3f) duringChange.Add(leg);
                                continue;
                            }
                            float slide = new Vector2(at.X - p0.X, at.Z - p0.Z).Length();
                            // a stance that began in a gait change (the two gaits blending) is the change's, not the gait's
                            if (sinceSwitch < 0.3f || duringChange.Contains(leg)) worstSwitch = Math.Max(worstSwitch, slide);
                            else worst[leg] = Math.Max(worst.GetValueOrDefault(leg), slide);
                        }
                        else { start.Remove(leg); duringChange.Remove(leg); }
                    }
                }
                if (trace != null) File.WriteAllText(Path.Combine(dir_, $"trace-{rig.Name}-{name}.csv"), trace.ToString());
                rows.Add(new { rig = rig.Name, kind, test = name, frames, stances, maxSlideMm = worst.ToDictionary(p => p.Key, p => Math.Round(p.Value * 1000, 2)), maxSlideInGaitChangeMm = Math.Round(worstSwitch * 1000, 2) });
                a.Dispose();
            }
        }
        return rows;
    }

    /// <summary>A dog cart on its round, with its draught dog: the camera goes to a milk woman's or baker boy's round.</summary>
    private async System.Threading.Tasks.Task<object> Cart(Town.Townspeople town)
    {
        var trades = Main.I.GetNodeOrNull<Town.StreetTrades>("StreetTrades");
        if (trades == null) return new { found = false, why = "no StreetTrades" };
        (Node3D root, Animal? dog) cart = default;
        foreach (double hour in new[] { 10.0, 11.5, 9.0, 13.0, 8.0, 15.0, 7.0, 16.5 })
        {
            await Dev.Kit.I.Light(hour, "clear");
            HideTownAnimals();
            for (int i = 0; i < 30; i++) await Frame();
            foreach (var s in town.Sims.Where(s => s.R.Trade is "milk_woman" or "baker_boy" && s.R.Work.Kind == "round" && !s.Inside).Take(10))
            {
                Main.I.Cam.Position = new Vector3((float)s.X + 4, (float)town.Walk!.BaseAt(s.X, s.Z) + 1.7f, (float)s.Z + 4);
                for (int i = 0; i < 150 && !trades.CartDogs.Any(); i++) await Frame();
                cart = trades.CartDogs.FirstOrDefault();
                if (cart.dog != null) break;
            }
            if (cart.dog != null) break;
        }
        if (cart.dog == null) return new { found = false, why = "no dog cart out at 7, 8:30, 10 or 15 h" };
        var shots = new List<string>();
        for (int k = 0; k < 3; k++)
        {
            for (int i = 0; i < 20; i++) await Frame();
            var d = cart.dog.Group.GlobalTransform;
            var fwd = d.Basis.Z.Normalized();
            var sd = d.Basis.X.Normalized();
            var at = d.Origin + Vector3.Up * 0.4f - fwd * (k == 2 ? 0f : 0.8f);
            // a camera in open street with a clear sight of the dog: the first of a few places round it that works
            var tries = k == 0 ? new[] { fwd * 3.2f - sd * 2.2f, fwd * 3.2f + sd * 2.2f, fwd * 4f } : k == 1 ? new[] { -sd * 3.6f - fwd * 0.8f, sd * 3.6f - fwd * 0.8f, -sd * 2.6f + fwd * 1.5f } : new[] { fwd * 1.4f - sd * 0.9f, fwd * 1.4f + sd * 0.9f, fwd * 1.8f };
            var from = d.Origin + tries[0] + Vector3.Up * 1.2f;
            foreach (var off in tries)
            {
                var c = d.Origin + off + Vector3.Up * (k == 2 ? 0.75f : 1.2f);
                if (!town.Walk!.Free(c.X, c.Z)) continue;
                var space = Main.I.Cam.GetWorld3D()?.DirectSpaceState;
                var hit = space?.IntersectRay(PhysicsRayQueryParameters3D.Create(c, at));
                if (hit != null && hit.Count > 0 && ((Vector3)hit["position"]).DistanceTo(at) > 0.8f) continue;
                from = c;
                break;
            }
            Main.I.Cam.LookAtFromPosition(from, at);
            if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
            for (int i = 0; i < 4; i++) await Frame();
            string name = $"cart-{k}.png";
            Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name));
            shots.Add(name);
            pictures.Add(new { name, clip = cart.dog.ClipName, kind = cart.dog.Kind, hour = World.Daylight.I.Hour });
        }
        {
            // two metres from the dog's side, at its middle's height: the harness, the traces and the shafts
            for (int i = 0; i < 10; i++) await Frame();
            var d = cart.dog.Group.GlobalTransform;
            var fwd = d.Basis.Z.Normalized();
            var sd = d.Basis.X.Normalized();
            var at = d.Origin + Vector3.Up * 0.38f - fwd * 0.12f;
            Vector3 from = at + sd * 2f + Vector3.Up * 0.25f;
            foreach (var off in new[] { sd * 2f, -sd * 2f })
            {
                var c = at + off + Vector3.Up * 0.25f;
                if (!town.Walk!.Free(c.X, c.Z)) continue;
                from = c;
                break;
            }
            Main.I.Cam.LookAtFromPosition(from, at);
            if (Main.I.Cam is Player.FlyCam fly2) fly2.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
            for (int i = 0; i < 4; i++) await Frame();
            Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, "cart-side-2m.png"));
            shots.Add("cart-side-2m.png");
            var hp = cart.dog.HarnessPoints();
            pictures.Add(new { name = "cart-side-2m.png", clip = cart.dog.ClipName, kind = cart.dog.Kind, hour = World.Daylight.I.Hour,
                harness = hp is { } h ? new[] { h.traceL.X, h.traceL.Y, h.traceL.Z, h.tugL.X, h.tugL.Y, h.tugL.Z } : null });
        }
        return new { found = true, kind = cart.dog.Kind, clip = cart.dog.ClipName, shots };
    }
}
