using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>
/// The move check (`-- --movetest dir`, `--moveonly a,b`): Jef's jump, fall, dive, the hulls, the water stairs, the
/// quay and crane ladders, by script with the real keys. Every frame of a part is sampled (feet, eye, view), the
/// report goes to dir/movetest.json with the measures (the jump's arc and timings, the largest step of the view in
/// one frame on a ladder's start and end), pictures beside it; then the game quits (1 if a check failed).
/// </summary>
[GamePart(993)]
public partial class MoveTest : Node
{
    private string dir = "";
    private readonly List<object> checks = new(), reports = new();
    private readonly List<string> pictures = new();
    private bool failed;

    public override void _Ready()
    {
        dir = Paths.TestOutput("movetest");
        if (dir == "") { SetProcess(false); return; }
        Directory.CreateDirectory(dir);
        _ = Run();
    }

    private bool Wants(string part)
    {
        string only = Main.I.Arg("moveonly");
        return only == "" || only.Split(',').Contains(part);
    }

    private async Task Run()
    {
        string error = "";
        try
        {
            if (!await Until(() => Main.I.Loaded && Jef.I != null, 120)) throw new InvalidOperationException("the town did not load");
            // with a server (no --no-serverlink): never on the player's own save, and off the arrival ferry first
            // (a new game starts on its deck, and its ride owns Jef's moves)
            if (!Main.I.Flag("no-serverlink"))
            {
                if (Main.I.Arg("db") == "") throw new InvalidOperationException("movetest with a server needs --db <a test save> (or --no-serverlink)");
                if (!await Until(() => Scheldemist.Net.ServerLink.I?.Up == true && Scheldemist.Game.GameState.I.Live, 100)) throw new InvalidOperationException("the server did not come up");
                await Scheldemist.Net.ServerLink.I!.Api!.Post<Scheldemist.Net.OkReply>("api/arrival/ashore");
                Jef.I.Place(-118, 36, 0);
                if (!await Until(() => Scheldemist.Play.FerryArrival.I == null || Scheldemist.Play.FerryArrival.I.Ashore && !Jef.I.Riding, 15)) throw new InvalidOperationException("Jef stayed on the arrival ferry");
                Scheldemist.Game.GameState.I.PlayingWhen = () => false;
            }
            await Frames(30);
            Jef.I.TestInput = true;
            if (Main.I.Arg("moveonly").Split(',').Contains("probe")) await Probe();
            if (Wants("jump")) await JumpCheck();
            if (Wants("ledge")) await LedgeCheck();
            if (Wants("ladder")) await QuayLadderCheck();
            if (Wants("ladder")) await QuayLadderDownUpCheck();
            if (Wants("landing")) await LandingCheck();
            if (Wants("hull")) await HullCheck();
            if (Wants("dive")) await DiveCheck();
            if (Wants("steps")) await StepsCheck();
            if (Wants("flood")) await FloodCheck();
            if (Wants("crane")) await CraneCheck();
            if (Wants("look")) await LookCheck();
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr("movetest: " + error); failed = true; }
        finally
        {
            File.WriteAllText(Path.Combine(dir, "movetest.json"), JsonSerializer.Serialize(new { ok = !failed, error, checks, reports, pictures }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"movetest: {(failed ? "FAILED" : "all as it should be")}; {Path.Combine(dir, "movetest.json")}");
            GetTree().Quit(failed ? 1 : 0);
        }
    }

    // ------------------------------------------------------------ helpers

    private void Check(bool ok, string name, object? detail = null)
    {
        checks.Add(new { name, ok, detail });
        GD.Print($"movetest: {(ok ? "ok" : "FAIL")} {name}{(detail != null ? " " + JsonSerializer.Serialize(detail) : "")}");
        if (!ok) failed = true;
    }

    private async Task<bool> Until(Func<bool> condition, double seconds)
    {
        ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        while (Time.GetTicksMsec() < end) { if (condition()) return true; await Frames(1); }
        return condition();
    }

    private async Task Frames(int n) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }

    private async Task Shot(string name, int settle = 8)
    {
        await Frames(settle);
        string file = Path.Combine(dir, name + ".png");
        GetViewport().GetTexture().GetImage().SavePng(file);
        pictures.Add(file);
    }

    /// <summary>One frame of a sampled run: time, feet, eye, view angles.</summary>
    private readonly record struct Sample(float T, Vector3 Feet, Vector3 Eye, float Yaw, float Pitch, string State);

    private string StateOf()
    {
        var j = Jef.I;
        return j.Riding ? "ride" : j.Climbing ? "climb" : j.Swimming ? (j.Diving ? "dive" : "swim") : j.Grounded ? "walk" : "air";
    }

    /// <summary>Sample every frame while `step` runs (it gets the time and returns false when done).</summary>
    private async Task<List<Sample>> Sampled(Func<float, bool> step, float limit)
    {
        var list = new List<Sample>();
        // ProcessFrame resumes before Jef's update. Fence the previous placement/frame before starting his clock.
        await Frames(1);
        float t = 0;
        double c0 = Jef.I.Clock;
        if(int.TryParse(Main.I.Arg("move-sampler-stall-ms"),out int stall)&&stall is >0 and <=2000)
            System.Threading.Thread.Sleep(stall); // controlled regression: a stalled wall frame must not spend movement time
        ulong wallEnd=Time.GetTicksMsec()+(ulong)(Math.Max(30,limit*10)*1000);
        while (t < limit)
        {
            if(Time.GetTicksMsec()>wallEnd)throw new TimeoutException("Sampled movement clock stopped before the run completed");
            bool more = step(t);
            await Frames(1);
            // (his own clock: the time his moves took, however the frames fell)
            t = (float)(Jef.I.Clock - c0);
            var j = Jef.I;
            list.Add(new Sample(t, new Vector3(j.X, j.Y, j.Z), j.Cam.GlobalPosition, j.Cam.Rotation.Y, j.Cam.Rotation.X, StateOf()));
            if (!more) break;
        }
        return list;
    }

    /// <summary>
    /// The largest step of the eye in one frame at 60 frames a second (cm: how far it goes in any 1/60 s, so a run at
    /// a high frame rate is measured as a player at 60 sees it), the largest speed over those steps (m/s), and when.
    /// </summary>
    private static (float stepCm, float speed, float atT) Snap(List<Sample> s, Func<Sample, Vector3>? frame = null)
    {
        float best = 0, at = 0;
        int k = 0;
        for (int i = 0; i < s.Count; i++)
        {
            if (k < i) k = i;
            while (k < s.Count - 1 && s[k].T - s[i].T < 1 / 60f) k++;
            if (s[k].T - s[i].T < 1 / 60f - 1e-4f) break;
            var a = frame == null ? s[i].Eye : frame(s[i]);
            var b = frame == null ? s[k].Eye : frame(s[k]);
            // (scaled to exactly 1/60 s: the window may be a little longer)
            float d = a.DistanceTo(b) * (1 / 60f) / (s[k].T - s[i].T);
            if (d > best) { best = d; at = s[k].T; }
        }
        return (best * 100, best * 60, at);
    }

    private static object Track(List<Sample> s, int every = 3)
        => s.Where((_, i) => i % every == 0 || i == s.Count - 1).Select(x => new[] { R(x.T), R(x.Feet.X), R(x.Feet.Y), R(x.Feet.Z), R(x.Eye.Y) }).ToArray();

    private static float R(float v) => MathF.Round(v, 3);

    // ------------------------------------------------------------ the probe: what holds a swimmer at the hulls

    private async Task Probe()
    {
        var j = Jef.I;
        var rows = new List<object>();
        int n = 0;
        var all = Boats.I.MooredFrames().Select(m => (m.Kind, m.World())).Concat(Boats.I.Floats.Where(f => f.Outer.Visible).Select(f => (f.Kind, f.Inner.GlobalTransform))).ToList();
        foreach (var (kind, xf) in all)
        {
            var o = xf.Origin;
            var d = Boats.I.Dims(kind);
            if (Math.Abs(xf.Basis.Determinant()) < 1e-6f || !Water.In(o.X, o.Z) || o.X < -140 || o.X > 60 || o.Z > 0 || d.Length < 9) continue;
            if (n++ >= 8) break;
            var side = xf.Basis.X.Normalized();
            var from = o + side * (d.Beam / 2 + 4);
            Solid.I.Ensure(from, 20);
            await Frames(3);
            float lv = Water.Level(from.X, from.Z);
            if (!j.SwimFree(from.X, from.Z)) { rows.Add(new { kind, o = new[] { o.X, o.Z }, skipped = "no room to swim at the side" }); continue; }
            j.Place(from.X, from.Z, 0);
            await Frames(3);
            j.DropFromBoat(new Vector3(from.X, lv - 0.3f, from.Z));
            j.Yaw = MathF.Atan2(-(o.X - from.X), -(o.Z - from.Z));
            j.Pitch = 0;
            await Frames(40);
            j.SetKey(Key.W, true);
            await Until(() => j.Blocked, 8);
            await Frames(20);
            j.ClearKeys();
            var local = xf.AffineInverse() * new Vector3(j.X, xf.Origin.Y, j.Z);
            string held = Solid.I.NameAt(new Vector3(j.X, lv - 0.3f, j.Z), new Vector3(o.X, lv - 0.3f, o.Z));
            await Shot($"probe-{n}-{kind}");
            rows.Add(new { kind, o = new[] { R(o.X), R(o.Z) }, d.Length, d.Beam, endLocalX = R(local.X), endLocalZ = R(local.Z), halfBeam = d.Beam / 2, held, swimming = j.Swimming });
        }
        reports.Add(new { probe = rows });
    }
}
