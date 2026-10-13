using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

// Package D3's native proof (--people2 --people2-work <dir>): on the Rijnkaai at a docker's sack pile (HaulRoutes
// rk-m) dockers take sacks up onto the shoulder, carry them and set them down, two pass a sack, one rolls a cask,
// one hauls a rope; a fishwife guts at a fish table, a woman sweeps. Pictures at 3 m and 6 m by day and at 19:30, a
// sequence of a lift (every 0.25 s), and a stretch of their life recorded (clips, things, planted feet). Rain too.
// docs/godot-people2.md "Work".
[GamePart(899)]
internal partial class People2WorkProof : Node
{
    private sealed record Fig(Human Human, string Label, Node3D Group);
    private readonly List<Fig> figs = new();
    private readonly List<World.Blobs.Spot> shadows = new();
    private readonly List<object> report = new();
    private bool manual;
    private Vector3 origin, fwd, right;
    private float yaw;
    private Movers.RopeLines? lines;
    private readonly List<(Fig fig, Vector3 anchor)> ropes = new();
    private readonly List<(Fig fig, Vector3 from, Vector3 dir, float speed)> walkers = new();
    private MeshInstance3D[] ropeSegs = Array.Empty<MeshInstance3D>();

    public override async void _Ready()
    {
        string dir = Main.I.Arg("people2-work");
        if (dir == "" || !People2.Enabled) { SetProcess(false); return; }
        dir = Paths.Absolute(dir);
        Directory.CreateDirectory(dir);
        try
        {
            var town = Main.I.GetNode<Town.Townspeople>("Townspeople");
            for (int i = 0; town.Data == null && i < 1800; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            for (int i = 0; !Dev.Kit.I.IsReady && i < 1800; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            if (town.Data == null || !Dev.Kit.I.IsReady) throw new InvalidOperationException("The work proof needs the native town and the dev API.");
            town.ClockRuns = false;
            Game.GameState.I.PlayingWhen = () => false;
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true;
            Main.I.Cam.SetProcess(false);
            Input.MouseMode = Input.MouseModeEnum.Visible;
            var route = Town.HaulRoute.All.First(r => r.Id == (Main.I.Arg("people2-work-route") is { Length: > 0 } w ? w : "rk-m"));
            yaw = (float)route.AYaw;
            fwd = new Vector3(MathF.Sin(yaw), 0, MathF.Cos(yaw));
            right = new Vector3(MathF.Cos(yaw), 0, -MathF.Sin(yaw));
            origin = new Vector3((float)route.A.X, 0, (float)route.A.Z);
            origin.Y = Ground(origin.X, origin.Z);
            // a stretch of quay beside the pile: Jef goes there first so the town's near things are drawn
            await Dev.Kit.I.Light(13, "clear");
            await Look(origin - fwd * 6 + Vector3.Up * 2, origin, 30);
            float pile = PileTop(origin, fwd);
            Stage(pile);
            World.Blobs.I?.Set("people2-work", shadows);
            var pictures = new List<object>();
            foreach (var (label, hour, weather) in new[] { ("day", 13.0, "clear"), ("rain", 13.0, "rain"), ("lamps", 19.5, "clear") })
            {
                await Dev.Kit.I.Light(hour, weather);
                for (int settle = 0; settle < 60; settle++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                walking = false;
                foreach (var (view, at, look, freeze) in Views())
                {
                    Freeze(freeze);
                    await Look(at, look, 10);
                    string name = $"{label}-{view}.png";
                    SavePicture(Path.Combine(dir, name));
                    var day = World.Daylight.I;
                    if (Math.Abs(day.Hour - hour) > 0.02 || day.Weather != weather) throw new InvalidOperationException("wrong live clock or weather in " + name);
                    pictures.Add(new { name, hour = day.Hour, weather = day.Weather, cam = new[] { at.X, at.Y, at.Z } });
                }
                if (label == "day")
                    foreach (var (seq, at, look, who, clip) in Sequences())
                    {
                        // a lift every 0.25 s: the docker's clock driven by hand from the clip's start
                        var f = figs.First(x => x.Label == who);
                        // from the moment the hands take hold (0.8 s): bend, strain, rise, dip, drive, land
                        f.Human.WorkClipNow(clip, 0.8f);
                        var partner = who == "give" ? figs.FirstOrDefault(x => x.Label == "take") : null;
                        partner?.Human.WorkClipNow("sack_pass_take", 0.8f);
                        await Look(at, look, 6);
                        manual = true;
                        for (int k = 0; k < 12; k++)
                        {
                            if (k > 0) for (int s = 0; s < 15; s++) { f.Human.Update(1f / 60); partner?.Human.Update(1f / 60); }
                            DrawRopes();
                            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                            string name = $"seq-{seq}-{k:00}.png";
                            SavePicture(Path.Combine(dir, name));
                            pictures.Add(new { name, t = 0.8 + k * 0.25, clip = f.Human.AnimationState.Clip });
                        }
                        manual = false;
                    }
            }
            var life = Life(60);
            var townHaul = await TownHaul(dir, 45);
            File.WriteAllText(Path.Combine(dir, "work.json"), JsonSerializer.Serialize(new { ok = true, route = route.Id, pileTop = pile, origin = new[] { origin.X, origin.Y, origin.Z }, yaw, figures = report, life, townHaul, pictures }, new JsonSerializerOptions { WriteIndented = true }));
            manual = true; SetProcess(false);
            World.Blobs.I?.Set("people2-work", null);
            foreach (var figure in figs) { figure.Human.Dispose(); figure.Group.QueueFree(); }
            figs.Clear();
            foreach (var segment in ropeSegs) segment.QueueFree();
            ropeSegs = Array.Empty<MeshInstance3D>();
            for (int i = 0; i < 2; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }

    // where each stands: x along the quay (to the pile's right), z away from the pile (back), in metres
    private Vector3 At(float x, float z) { var p = origin + right * x - fwd * z; p.Y = Ground(p.X, p.Z); return p; }

    private float Ground(float x, float z)
    {
        float g = World.Lights.I?.GroundAt(x, z) ?? 0;
        return float.IsFinite(g) ? g : 0;
    }

    /// <summary>The top of the pile before the docker's end (a ray down 0.55 m ahead), over his feet.</summary>
    private float PileTop(Vector3 at, Vector3 ahead)
    {
        var space = Main.I.View.FindWorld3D().DirectSpaceState;
        var p = at + ahead * 0.55f;
        var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(p + Vector3.Up * 3, p + Vector3.Down * 2));
        return hit.Count > 0 ? ((Vector3)hit["position"]).Y - at.Y : -1;
    }

    private Fig? Put(string kind, string id, Vector3 at, float yawOff, string label)
    {
        var h = Humans.Make(kind);
        if (h == null) return null;
        var group = new Node3D { Name = "work_" + label, Position = at, Rotation = new Vector3(0, yaw + yawOff, 0) };
        group.AddChild(h.Root);
        Main.I.View.AddChild(group);
        h.Start();
        h.SetIdentity("work:" + id);
        var f = new Fig(h, label, group);
        figs.Add(f);
        shadows.Add(new World.Blobs.Spot(at.X, at.Z, at.Y, 0.4f));
        return f;
    }

    private Node3D? Prop(string model, string root, Vector3 at, float yawOff)
    {
        var copy = Models.ModelLibrary.Get(model)?.Copy(root);
        if (copy == null) return null;
        copy.Position = at;
        copy.Rotation = new Vector3(0, yaw + yawOff, 0);
        Main.I.View.AddChild(copy);
        return copy;
    }

    private readonly Dictionary<string, (string clip, float t)> stills = new();

    // the groups stand along the quay (to the pile's right) where the ground is clear: no crate, pile or post
    // within the group's square (rays from above), the quay's own level
    private readonly Dictionary<string, Vector3> centres = new();
    private float along;

    private bool Clear(Vector3 c, float half, float ahead)
    {
        var space = Main.I.View.FindWorld3D().DirectSpaceState;
        for (float u = -half; u <= half + 1e-3f; u += half / 3)
            for (float v = -half; v <= half + ahead + 1e-3f; v += (half + ahead) / 5)
            {
                var p = c + right * u + fwd * v;
                var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(p + Vector3.Up * 4, p + Vector3.Down * 2));
                if (hit.Count == 0) return false;
                float y = ((Vector3)hit["position"]).Y;
                if (Math.Abs(y - origin.Y) > 0.12f) return false;
            }
        return true;
    }

    /// <summary>The next clear spot along the quay at least `gap` beyond the last.</summary>
    private Vector3 Slot(string name, float gap, float half = 1.3f, float ahead = 1.2f)
    {
        float s = along + gap;
        for (int k = 0; k < 120; k++, s += 0.5f)
        {
            var c = origin + right * s;
            c.Y = Ground(c.X, c.Z);
            if (Clear(c, half, ahead)) { along = s; centres[name] = c; return c; }
        }
        along = s;
        var f = origin + right * along;
        f.Y = Ground(f.X, f.Z);
        centres[name] = f;
        return f;
    }

    private void Stage(float pile)
    {
        // 1 the route's own docker at his pile (the game's context: crouch at a sack pile lifts a sack); the pile's
        //   height picks the lift (the quay has none there now: a stand-in pile of the one sack)
        if (Put("docker_a", "lift", origin, 0, "lift") is { } lift)
        {
            lift.Human.Work = "haul_sack";
            lift.Human.PileTop = pile;
            lift.Human.Play("crouch", 0);
            if (pile < 0.1f) Pile(origin, 0.21f);
            report.Add(new { who = "lift", clip = lift.Human.AnimationState.Clip, pile });
        }
        // 2 lifts held at moments: from a low pile and from one at the waist
        foreach (var (lab, clip, t, top) in new[] { ("liftLow", "sack_lift", 1.25f, 0.21f), ("liftHigh", "sack_lift_high", 2.0f, 0.73f) })
        {
            var c = Slot(lab, 3.0f);
            if (Put("docker_a", lab, c, 0, lab) is { } f)
            {
                stills[lab] = (clip, t);
                f.Human.WorkClipNow(clip, t);
                Pile(c, top);
                report.Add(new { who = lab, clip, pileTop = top, at = new[] { c.X, c.Z } });
            }
        }
        // 3 carrying a sack along the quay, standing with it, setting it down
        var cc = Slot("carry", 4.5f, 1.3f, 0.6f);
        if (Put("docker_a", "carry", cc + right * 1.6f, -MathF.PI / 2, "carry") is { } carry)
        {
            carry.Human.CarryLoad("sack");
            carry.Human.Play("carry", 0);
            carry.Human.SetPace(1.2f);
            walkers.Add((carry, carry.Group.Position, -right, 1.2f));
            report.Add(new { who = "carry", clip = carry.Human.AnimationState.Clip });
        }
        var hc = Slot("hold", 4.0f);
        if (Put("docker_a", "hold", hc, 0.4f, "hold") is { } hold)
        {
            hold.Human.CarryLoad("sack");
            hold.Human.Play("idle", 0);
            report.Add(new { who = "hold", clip = hold.Human.AnimationState.Clip });
        }
        var dc = Slot("down", 3.5f);
        if (Put("docker_a", "down", dc, 0, "down") is { } down)
        {
            stills["down"] = ("sack_down", 1.75f);
            down.Human.WorkClipNow("sack_down", 1.75f);
            Pile(dc, 0.30f);
            report.Add(new { who = "down", clip = "sack_down" });
        }
        // 4 two men passing a sack (the carrier at the lifter's right)
        var pc = Slot("pass", 4.0f, 1.5f);
        if (Put("docker_a", "give", pc, 0, "give") is { } give && Put("docker_a", "take", pc - right * 0.50f + fwd * 0.24f, 0, "take") is { } take)
        {
            stills["give"] = ("sack_pass_give", 2.75f);
            stills["take"] = ("sack_pass_take", 2.75f);
            give.Human.WorkClipNow("sack_pass_give", 2.75f);
            take.Human.WorkClipNow("sack_pass_take", 2.75f);
            Pile(pc, 0.21f);
            report.Add(new { who = "pass", clip = "sack_pass_give/take" });
        }
        // 5 a cask rolled along the quay; a rope hauled from a block overhead
        var kc = Slot("cask", 4.5f, 1.3f, 0.6f);
        if (Put("docker_a", "cask", kc + right * 1.6f, -MathF.PI / 2, "cask") is { } cask)
        {
            cask.Human.WorkClipNow("cask_roll", 0);
            walkers.Add((cask, cask.Group.Position, -right, 0.8f));
            report.Add(new { who = "cask", clip = "cask_roll" });
        }
        var rc = Slot("rope", 4.0f);
        if (Put("docker_a", "rope", rc, 0, "rope") is { } rope)
        {
            rope.Human.WorkClipNow("rope_haul", 0);
            var a = rope.Group.ToGlobal(new Vector3(0, 4.7f, 2.5f));
            ropes.Add((rope, a));
            report.Add(new { who = "rope", clip = "rope_haul", anchor = new[] { a.X, a.Y, a.Z } });
        }
        // 6 a fishwife gutting at a fish table (the market's table: top 0.8 m and the ice, its near edge 0.30 m
        //   before her); a woman sweeping
        var gc = Slot("gut", 4.0f, 1.5f, 1.4f);
        Prop("stalls", "mk2_fish_table", gc + fwd * 0.76f, MathF.PI);
        if (Put("fishwife_a", "gut", gc, 0, "gut") is { } gut)
        {
            gut.Human.Work = "fish_stall";
            gut.Human.Play("idle", 0);
            report.Add(new { who = "gut", clip = gut.Human.AnimationState.Clip });
        }
        var sc = Slot("sweep", 4.0f);
        if (Put("fishwife_a", "sweep", sc, 0.3f, "sweep") is { } sweep)
        {
            sweep.Human.WorkClipNow("sweep", 0);
            report.Add(new { who = "sweep", clip = "sweep" });
        }
    }

    private void Pile(Vector3 at, float top)
    {
        // a stand-in pile under a still's sack: the one sack model, lying, stacked to the pile's height
        var sackAt = at + fwd * 0.47f;
        for (float y = 0; y < top - 0.05f; y += 0.21f)
        {
            var s = Carried.Sack(0.86f, Math.Min(0.21f, top - y), 0.5f);
            if (s == null) return;
            s.Position = sackAt + Vector3.Up * y + fwd * 0.08f;
            s.Rotation = new Vector3(0, yaw + MathF.PI / 2, 0);
            Main.I.View.AddChild(s);
        }
    }

    private void Freeze(bool on)
    {
        foreach (var f in figs)
            if (stills.TryGetValue(f.Label, out var st)) f.Human.WorkClipNow(st.clip, st.t, on);
    }

    private void DrawRopes()
    {
        if (ropes.Count == 0) return;
        var mat = Movers.Boats.I?.Rope;
        if (ropeSegs.Length == 0)
        {
            ropeSegs = new MeshInstance3D[ropes.Count * 3];
            var mesh = new CylinderMesh { TopRadius = 0.012f, BottomRadius = 0.012f, Height = 1, RadialSegments = 6, Rings = 1, Material = mat };
            for (int i = 0; i < ropeSegs.Length; i++) { ropeSegs[i] = new MeshInstance3D { Mesh = mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off }; Main.I.View.AddChild(ropeSegs[i]); }
        }
        for (int r = 0; r < ropes.Count; r++)
        {
            var (fig, anchor) = ropes[r];
            var gl = fig.Human.Socket("gripL") ?? anchor; var gr = fig.Human.Socket("gripR") ?? anchor;
            var dir = (anchor - (gl + gr) / 2).Normalized();
            var hi = gl.Dot(dir) > gr.Dot(dir) ? gl : gr;
            var lo = hi == gl ? gr : gl;
            var tail = fig.Group.ToGlobal(new Vector3(-0.16f, 0.02f, 0.18f));
            Seg(ropeSegs[r * 3], anchor, hi); Seg(ropeSegs[r * 3 + 1], hi, lo); Seg(ropeSegs[r * 3 + 2], lo, tail);
        }
    }

    private static void Seg(MeshInstance3D m, Vector3 a, Vector3 b)
    {
        float len = a.DistanceTo(b);
        if (len < 1e-4f) { m.Visible = false; return; }
        m.Visible = true;
        var y = (b - a) / len;
        var x = y.Cross(Vector3.Forward).LengthSquared() > 1e-4f ? y.Cross(Vector3.Forward).Normalized() : Vector3.Right;
        var z = x.Cross(y);
        m.GlobalTransform = new Transform3D(new Basis(x, y * len, z), (a + b) / 2);
    }

    private Vector3 Centre(string name)
    {
        // a walker's group is where he is now
        var f = figs.FirstOrDefault(x => x.Label == name);
        if (f != null && walkers.Exists(w => w.fig == f)) return f.Group.Position;
        return centres.TryGetValue(name, out var c) ? c : origin;
    }

    private IEnumerable<(string, Vector3, Vector3, bool)> Views()
    {
        Vector3 up(float h) => new(0, h, 0);
        foreach (var d in new[] { 3f, 6f })
            foreach (var name in new[] { "liftLow", "liftHigh", "carry", "hold", "down", "pass", "cask", "rope", "gut", "sweep" })
            {
                var c = Centre(name);
                if (name == "pass") c -= right * 0.25f;
                // the front three-quarter from his right, over the pile
                bool tall = name == "rope";
                var eye = c + fwd * d * 0.72f + right * d * 0.55f + up(tall ? 1.1f : 1.5f);
                yield return ($"{name}-{d:0}m", eye, c + up(tall ? 1.35f : 0.9f), true);
            }
    }

    private IEnumerable<(string, Vector3, Vector3, string, string)> Sequences()
    {
        var c = Centre("liftLow");
        yield return ("lift", c + fwd * 2.0f - right * 1.3f + new Vector3(0, 1.3f, 0), c + new Vector3(0, 0.85f, 0) + fwd * 0.15f, "liftLow", "sack_lift");
        var p = Centre("pass") - right * 0.25f;
        yield return ("pass", p + fwd * 2.4f + right * 1.2f + new Vector3(0, 1.4f, 0), p + new Vector3(0, 0.95f, 0) + fwd * 0.2f, "give", "sack_pass_give");
    }

    // a stretch of their life at 30 Hz: the clips each plays, the things shown, the planted feet
    private object Life(int seconds)
    {
        manual = true;
        walking = true;
        Freeze(false);
        foreach (var f in figs) if (stills.TryGetValue(f.Label, out var st)) f.Human.WorkClipNow(st.clip, 0);
        var changes = new List<object>();
        var last = figs.ToDictionary(f => f, f => f.Human.AnimationState.Clip);
        for (int i = 0; i < seconds * 30; i++)
        {
            Walk(1f / 30);
            foreach (var f in figs) f.Human.Update(1f / 30);
            foreach (var f in figs)
            {
                string? c = f.Human.AnimationState.Clip;
                if (c != last[f]) { changes.Add(new { t = MathF.Round((i + 1) / 30f, 2), who = f.Label, clip = c }); last[f] = c; }
            }
        }
        manual = false;
        return new
        {
            seconds,
            changes,
            figures = figs.Select(f => new { who = f.Label, clip = f.Human.AnimationState.Clip, stanceSlideMm = MathF.Round(f.Human.StanceSlide * 1000, 3), samples = f.Human.StanceSamples, things = f.Human.ThingsShown }).ToArray(),
        };
    }

    private bool walking = true;

    // the town's own hauling dockers (people2 bodies) on these quays, live for some seconds: the clips their job
    // plays (the lift at the pile, the walk with the sack, the set-down at the door), and a picture now and then
    private async System.Threading.Tasks.Task<object> TownHaul(string dir, int seconds)
    {
        var town = Main.I.GetNode<Town.Townspeople>("Townspeople");
        await Dev.Kit.I.Light(10.5, "clear");
        town.ClockRuns = true;
        var ids = new Dictionary<Town.Puppet, int>();
        var last = new Dictionary<Town.Puppet, string?>();
        var clips = new List<object>();
        var seen = new HashSet<string>();
        await Look(origin - fwd * 7 + right * 3 + Vector3.Up * 3, origin + right * 3, 5);
        ulong start = Time.GetTicksMsec();
        int shots = 0;
        while (Time.GetTicksMsec() - start < (ulong)seconds * 1000)
        {
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            foreach (var s in town.Simulations)
            {
                if (s.Goal.Mode != "haul" || s.P is not { } p || !p.Human.IsPeople2) continue;
                if (!ids.TryGetValue(p, out int id)) ids[p] = id = ids.Count;
                string? c = p.Human.AnimationState.Clip;
                if (!last.TryGetValue(p, out var was) || was != c)
                {
                    last[p] = c;
                    if (c != null) seen.Add(c);
                    clips.Add(new { t = MathF.Round((Time.GetTicksMsec() - start) / 1000f, 2), who = id, kind = p.Kind, motion = p.Human.Motion, clip = c, loaded = p.Loaded, work = p.Human.Work, x = MathF.Round(p.Group.GlobalPosition.X, 1), z = MathF.Round(p.Group.GlobalPosition.Z, 1) });
                    // a picture of a lift or a set-down as it starts, from a few metres
                    if (shots < 6 && c is "sack_lift" or "sack_lift_high" or "sack_down")
                    {
                        var at = p.Group.GlobalPosition;
                        var face = p.Group.GlobalBasis.Z;
                        // (a lift from before him over the pile; a set-down at a door from behind, the house before him)
                        var eye = c == "sack_down" ? at - face * 2.8f + face.Cross(Vector3.Up) * 1.6f + Vector3.Up * 1.7f : at + face * 3.2f + face.Cross(Vector3.Up) * 1.8f + Vector3.Up * 1.6f;
                        await Look(eye, at + Vector3.Up * 0.9f, 40);
                        SavePicture(Path.Combine(dir, $"town-{c}-{shots++}.png"));
                    }
                }
            }
        }
        town.ClockRuns = false;
        return new { seconds, haulers = ids.Count, seen = seen.ToArray(), clips };
    }

    private void Walk(float dt)
    {
        if (!walking) return;
        for (int i = 0; i < walkers.Count; i++)
        {
            var (f, from, dir, v) = walkers[i];
            var p = f.Group.Position + dir * v * dt;
            if (p.DistanceTo(from) > 4) { p = from; f.Human.ReleaseFeet(); }
            p.Y = Ground(p.X, p.Z);
            f.Group.Position = p;
        }
    }

    private async System.Threading.Tasks.Task Look(Vector3 at, Vector3 look, int settle)
    {
        Main.I.Cam.LookAtFromPosition(at, look, Vector3.Up);
        if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
        for (int i = 0; i < settle; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }

    private static void SavePicture(string path)
    {
        using var image = Main.I.View.GetTexture().GetImage();
        if (image.SavePng(path) != Error.Ok) throw new IOException(path);
    }

    public override void _Process(double delta)
    {
        if (manual) return;
        Walk((float)delta);
        foreach (var f in figs) f.Human.Update((float)delta);
        DrawRopes();
    }

    public override void _ExitTree() => World.Blobs.I?.Set("people2-work", null);
}
