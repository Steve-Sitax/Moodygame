using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

// Package D2's native proof (--people2 --people2-motion <dir>): at the Vismarkt a row of people idling, a pair
// talking, people sitting on a crate, a stool and a doorstep, and on a town bench; pictures at 3 m and 6 m by day
// and at 19:30 under a lamp; frame sequences (every 0.25 s) of an idle and of a talk. docs/godot-people2.md.
[GamePart(898)]
internal partial class People2MotionProof : Node
{
    private sealed record Fig(Human Human, string Label);
    private readonly List<Fig> figs = new();
    private readonly List<World.Blobs.Spot> shadows = new();
    private readonly List<object> report = new();
    private readonly List<object> probes = new();
    private bool manual;
    private Vector3 origin;

    public override async void _Ready()
    {
        string dir = Main.I.Arg("people2-motion");
        if (dir == "" || !People2.Enabled) { SetProcess(false); return; }
        dir = Paths.Absolute(dir);
        Directory.CreateDirectory(dir);
        try
        {
            var town = Main.I.GetNode<Town.Townspeople>("Townspeople");
            for (int i = 0; town.Data == null && i < 1800; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            for (int i = 0; !Dev.Kit.I.IsReady && i < 1800; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            if (town.Data == null || !Dev.Kit.I.IsReady) throw new InvalidOperationException("The motion proof needs the native town and the dev API.");
            town.ClockRuns = false;
            Game.GameState.I.PlayingWhen = () => false;
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true;
            Main.I.Cam.SetProcess(false);
            Input.MouseMode = Input.MouseModeEnum.Visible;
            var p = Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray().First(p => p.GetProperty("place").GetString() == "vismarkt").GetProperty("pos");
            origin = new Vector3(p[0].GetSingle(), 0, p[2].GetSingle());
            if (World.Lights.I is { } lamps)
            {
                var nearest = lamps.Lamps.OrderBy(l => new Vector2(l.at.X - origin.X, l.at.Z - origin.Z).LengthSquared()).First();
                origin = nearest.at - new Vector3(0, nearest.at.Y, 5f);
            }
            Stage();
            World.Blobs.I?.Set("people2-motion", shadows);
            var pictures = new List<object>();
            foreach (var (label, hour, weather) in new[] { ("day", 13.0, "clear"), ("lamps", 19.5, "clear") })
            {
                await Dev.Kit.I.Light(hour, weather);
                for (int settle = 0; settle < 60; settle++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                foreach (var (view, at, look) in Views())
                {
                    await Look(at, look, 10);
                    string name = $"{label}-{view}.png";
                    Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name));
                    var day = World.Daylight.I;
                    if (Math.Abs(day.Hour - hour) > 0.02 || day.Weather != weather) throw new InvalidOperationException("wrong live clock or weather in " + name);
                    pictures.Add(new { name, hour = day.Hour, weather = day.Weather, cam = new[] { at.X, at.Y, at.Z } });
                }
                if (label == "day")
                {
                    // the motion: ten pictures a quarter of a second apart, the clock of the figures driven by hand
                    foreach (var (seq, at, look) in Sequences())
                    {
                        await Look(at, look, 6);
                        manual = true;
                        for (int k = 0; k < 10; k++)
                        {
                            if (k > 0) for (int s = 0; s < 15; s++) foreach (var f in figs) f.Human.Update(1f / 60);
                            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                            string name = $"seq-{seq}-{k:00}.png";
                            Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name));
                            pictures.Add(new { name, t = k * 0.25 });
                        }
                        manual = false;
                    }
                }
            }
            File.WriteAllText(Path.Combine(dir, "motion.json"), JsonSerializer.Serialize(new { ok = true, place = "vismarkt", origin = new[] { origin.X, origin.Y, origin.Z }, figures = report, doorProbes = probes, pictures }, new JsonSerializerOptions { WriteIndented = true }));
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }

    private async System.Threading.Tasks.Task Look(Vector3 at, Vector3 look, int settle)
    {
        Main.I.Cam.LookAtFromPosition(at, look, Vector3.Up);
        if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
        for (int i = 0; i < settle; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }

    private float Ground(float x, float z)
    {
        float g = World.Lights.I?.GroundAt(x, z) ?? 0;
        return float.IsFinite(g) ? g : 0;
    }

    private Fig? Put(string kind, string id, Vector3 at, float yaw, string motion, float seat = -1, string label = "")
    {
        var h = Humans.Make(kind);
        if (h == null) return null;
        h.Root.Position = at;
        h.Root.Rotation = new Vector3(0, yaw, 0);
        Main.I.View.AddChild(h.Root);
        h.Start();
        h.SetIdentity("proof:" + id);
        if (seat >= 0) { h.Root.Position = at + Vector3.Up * h.SitDrop(seat); h.Play("sit", 0); }
        else h.Play(motion, 0);
        var f = new Fig(h, label == "" ? id : label);
        figs.Add(f);
        shadows.Add(new World.Blobs.Spot(at.X, at.Z, at.Y, seat >= 0 ? 0.35f : 0.4f));
        report.Add(new { id, kind, body = h.Root.Name.ToString(), motion = seat >= 0 ? "sit" : motion, seat, x = at.X, y = at.Y, z = at.Z, yaw });
        return f;
    }

    private Node3D? Prop(string model, string root, Vector3 at, float yaw)
    {
        var copy = Models.ModelLibrary.Get(model)?.Copy(root);
        if (copy == null) return null;
        copy.Position = at;
        copy.Rotation = new Vector3(0, yaw, 0);
        Main.I.View.AddChild(copy);
        return copy;
    }

    private static float Top(Node3D n)
    {
        float top = float.MinValue;
        foreach (var mi in World.BakedWorld.All(n).OfType<MeshInstance3D>())
        {
            var box = mi.GlobalTransform * mi.GetAabb();
            top = Math.Max(top, box.End.Y);
        }
        return top;
    }

    // what stands where (relative to the lamp's square: the figures face -z, toward the cameras)
    private Vector3 At(float x, float z) { var p = origin + new Vector3(x, 0, z); p.Y = Ground(p.X, p.Z); return p; }
    private Vector3 rowC, pairC, seatC, benchC;
    private float benchYaw;

    private void Stage()
    {
        // a row idling: men, women, the old, a child, the dressed kinds
        string[] row = { "docker_a", "p2:woman_middling", "police", "p2:old_man", "fishwife_a", "sooi", "p2:child_middling", "p2:old_woman" };
        for (int i = 0; i < row.Length; i++) Put(row[i], "row" + i, At((i - 3.5f) * 1.05f, 3.2f), MathF.PI, "idle");
        rowC = At(0, 3.2f);
        // a pair talking, half turned to each other
        pairC = At(-6.6f, 5.4f);
        Put("docker_a", "pairA", pairC + new Vector3(0.55f, 0, 0), -MathF.PI / 2 - 0.3f, "talk");
        Put("fishwife_a", "pairB", pairC + new Vector3(-0.55f, 0, 0), MathF.PI / 2 + 0.3f, "talk");
        // seats: the crate (the game's own crate model), a market stool, and a doorstep found by the colliders
        seatC = At(9.5f, 2.0f);
        var crate = Prop("crate", "crate", seatC + new Vector3(-0.9f, 0, 0), 0);
        var stool = Prop("stalls", "mk2_stool", seatC + new Vector3(0.9f, 0, 0), 0);
        if (crate != null) Put("docker_a", "crate", seatC + new Vector3(-0.9f, 0, 0), MathF.PI, "sit", Top(crate) - seatC.Y);
        if (stool != null) Put("p2:woman_middling", "stool", seatC + new Vector3(0.9f, 0, 0), MathF.PI, "sit", Top(stool) - seatC.Y);
        foreach (var (kind, i) in new[] { ("fishwife_a", 0), ("p2:old_man", 1) })
            if (Step(i) is { } st) Put(kind, "step" + i, st.at, st.yaw, "sit", st.h);
        // a town bench (shared/townplaces.json), the nearest to the square
        if (Bench() is { } b)
        {
            benchC = b.at; benchYaw = b.yaw;
            var side = new Vector3(MathF.Cos(b.yaw), 0, -MathF.Sin(b.yaw));
            Put("fishwife_a", "benchA", b.at - side * 0.45f, b.yaw, "sit", b.h);
            Put("p2:old_woman", "benchB", b.at + side * 0.45f, b.yaw, "sit", b.h);
        }
    }

    // (doorsteps) the residents' doors near the square, probed from above: a top 0.12-0.35 m over the street
    private readonly List<(Vector3 at, float yaw, float h)> steps = new();
    private (Vector3 at, float yaw, float h)? Step(int i)
    {
        if (steps.Count == 0) FindSteps();
        return i < steps.Count ? steps[i] : null;
    }

    private void FindSteps()
    {
        var town = Main.I.GetNode<Town.Townspeople>("Townspeople");
        var space = Main.I.View.FindWorld3D().DirectSpaceState;
        float Top(float x, float z)
        {
            var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x, 30, z), new Vector3(x, -10, z)));
            return hit.Count > 0 ? ((Vector3)hit["position"]).Y : float.NaN;
        }
        // places to look from: the residents' doors and a grid round the square; a step is a rise of 9-36 cm ahead
        // with a top at least 30 cm deep and level to both sides: sit on its front, facing away from it
        var o2 = new Vector2(origin.X, origin.Z);
        var spots = town.Data!.Residents.Select(r => new Vector2((float)r.HomeSx, (float)r.HomeSz)).Distinct()
            .Where(d => d.DistanceTo(o2) < 25).ToList();
        for (float gx = -12; gx <= 12; gx += 1f)
            for (float gz = -12; gz <= 12; gz += 1f) spots.Add(o2 + new Vector2(gx, gz));
        foreach (var c in spots.OrderBy(c => c.DistanceSquaredTo(o2)))
        {
            float t0 = Top(c.X, c.Y);
            if (!float.IsFinite(t0) || t0 - Ground(c.X, c.Y) > 0.3f) continue; // (not on a roof or a stall)
            for (int a = 0; a < 16; a++)
            {
                var n = new Vector2(MathF.Sin(a * MathF.PI / 8), MathF.Cos(a * MathF.PI / 8));
                // the profile ahead: the street, then a doorstep or a house's plinth (9-36 cm, 15 cm deep at least,
                // a wall behind it is fine)
                var stepTops = new List<float>();
                float edge = -1;
                for (float r = 0.05f; r <= 1.2f; r += 0.05f)
                {
                    var q = c + n * r;
                    float t = Top(q.X, q.Y);
                    if (!float.IsFinite(t)) break;
                    float h = t - t0;
                    if (h > 0.09f && h < 0.36f) { if (edge < 0) edge = r; stepTops.Add(t); continue; }
                    if (edge >= 0 || h > 0.36f) break;
                    if (Math.Abs(h) > 0.03f) break;
                }
                if (edge < 0.5f || stepTops.Count < 3) continue;
                stepTops.Sort();
                float top = stepTops[stepTops.Count / 2];
                var seat = c + n * (edge + 0.1f);
                var side = new Vector2(-n.Y, n.X);
                bool level = Math.Abs(Top(seat.X + side.X * 0.35f, seat.Y + side.Y * 0.35f) - top) < 0.05f && Math.Abs(Top(seat.X - side.X * 0.35f, seat.Y - side.Y * 0.35f) - top) < 0.05f;
                if (!level || steps.Any(st => new Vector2(st.at.X, st.at.Z).DistanceTo(seat) < 2.5f)) continue;
                steps.Add((new Vector3(seat.X, Ground(c.X, c.Y), seat.Y), MathF.Atan2(-n.X, -n.Y), top - t0));
                probes.Add(new { at = new[] { seat.X, seat.Y }, street = t0, step = top - t0 });
                break;
            }
            if (steps.Count >= 2) break;
        }
    }

    private (Vector3 at, float yaw, float h)? Bench()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Paths.Shared("townplaces.json")));
            var all = new List<(float x, float z, float yaw)>();
            void Walk(JsonElement e)
            {
                if (e.ValueKind == JsonValueKind.Object)
                    foreach (var p in e.EnumerateObject())
                    {
                        if (p.Name == "benches" && p.Value.ValueKind == JsonValueKind.Array)
                            foreach (var b in p.Value.EnumerateArray()) all.Add((b[0].GetSingle(), b[1].GetSingle(), b[2].GetSingle()));
                        else Walk(p.Value);
                    }
                else if (e.ValueKind == JsonValueKind.Array) foreach (var x in e.EnumerateArray()) Walk(x);
            }
            Walk(doc.RootElement);
            if (all.Count == 0) return null;
            var want = Main.I.Arg("people2-motion-bench") is { Length: > 0 } w ? w.Split(',').Select(v => float.Parse(v, System.Globalization.CultureInfo.InvariantCulture)).ToArray() : new[] { origin.X, origin.Z };
            var best = all.OrderBy(b => new Vector2(b.x - want[0], b.z - want[1]).LengthSquared()).First();
            var space = Main.I.View.FindWorld3D().DirectSpaceState;
            float g = Ground(best.x, best.z);
            var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(best.x, g + 1.2f, best.z), new Vector3(best.x, g - 1, best.z)));
            float top = hit.Count > 0 ? ((Vector3)hit["position"]).Y : g + 0.45f;
            return (new Vector3(best.x, g, best.z), best.yaw, Math.Clamp(top - g, 0.3f, 0.6f));
        }
        catch (Exception e) { GD.PrintErr("people2 motion proof: no bench: " + e.Message); return null; }
    }

    private IEnumerable<(string, Vector3, Vector3)> Views()
    {
        Vector3 up(float h) => new(0, h, 0);
        foreach (var d in new[] { 3f, 6f })
        {
            yield return ($"row-{d:0}m", rowC + new Vector3(0, 1.5f, -d), rowC + up(0.95f));
            yield return ($"pair-{d:0}m", pairC + new Vector3(0, 1.5f, -d), pairC + up(0.95f));
            yield return ($"seats-{d:0}m", seatC + new Vector3(0, 1.3f, -d), seatC + up(0.7f));
            foreach (var (st, i) in steps.Select((s, i) => (s, i)))
            {
                var n = new Vector3(MathF.Sin(st.yaw), 0, MathF.Cos(st.yaw));
                var side = new Vector3(n.Z, 0, -n.X);
                yield return ($"step{i}-{d:0}m", st.at + n * d * 0.9f + side * d * 0.35f + up(1.4f), st.at + up(0.6f));
            }
            if (benchC != default)
            {
                var n = new Vector3(MathF.Sin(benchYaw), 0, MathF.Cos(benchYaw));
                yield return ($"bench-{d:0}m", benchC + n * d + up(1.4f), benchC + up(0.65f));
            }
        }
    }

    private IEnumerable<(string, Vector3, Vector3)> Sequences()
    {
        yield return ("idle", rowC + new Vector3(-1.6f, 1.45f, -3.2f), rowC + new Vector3(-1.6f, 0.95f, 0));
        yield return ("talk", pairC + new Vector3(0.6f, 1.45f, -3.0f), pairC + new Vector3(0, 0.95f, 0));
    }

    public override void _Process(double delta)
    {
        if (manual) return;
        foreach (var f in figs) f.Human.Update((float)delta);
    }

    public override void _ExitTree() => World.Blobs.I?.Set("people2-motion", null);
}
