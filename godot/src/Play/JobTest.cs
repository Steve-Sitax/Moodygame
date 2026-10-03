using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

/// <summary>
/// The hands' own test: `-- --jobtest dir`. By script, against the real server with no model calls: the prompt at
/// the hiring board, a shut door tried and an open door passed, a carry job from the board to the pay, something
/// eaten from the pockets, the rent and a sleep. A picture at each step and what the server said go to
/// dir/jobtest.json; then the game quits (1 when a step failed). `--jobonly a,b` picks steps.
/// Jef is placed or walked with his own keys (Jef.I.SetKey), and E is pressed through Interact.I.Press: the same
/// way a player's key goes.
/// </summary>
[GamePart(210)]
public partial class JobTest : Node
{
    private string dir = "";
    private IEnumerator<object?>? script;
    private double wait;
    private Func<bool>? until;
    private double untilLeft;
    private string untilWhat = "";
    private bool failed;
    private readonly List<Dictionary<string, object?>> steps = new();
    private Dictionary<string, object?> now = new();
    private readonly List<string> said = new();
    private readonly List<string> pictures = new();
    private double total;
    private readonly List<double> frameMs = new();
    private ulong lastUsec;

    public override void _Ready()
    {
        dir = Main.I.Arg("jobtest");
        if (dir == "")
        {
            SetProcess(false);
            return;
        }
        Directory.CreateDirectory(dir);
        GameState.I.Message += m => said.Add(m);
        Jef.I.TestInput = true;
        GameState.I.PlayingWhen = () => false; // the clock stands still unless a step lets it run
        script = Script().GetEnumerator();
        // (until the jobs' part is in: the board's own entry)
        var (bx, bz) = Spots.Board;
        Interact.I.Add(new Vector3(bx, 1.55f, bz), 2.6f, "read the hiring board", () => GameState.I.Say("The board is bare. Nobody has come by yet."));
    }

    // ------------------------------------------------------------------ the runner

    private sealed record Until(Func<bool> When, double Seconds, string What);
    private static Until When(Func<bool> f, double seconds, string what) => new(f, seconds, what);

    public override void _Process(double delta)
    {
        if (script == null) return;
        total += delta;
        ulong t = Time.GetTicksUsec();
        if (lastUsec != 0 && measuring) frameMs.Add((t - lastUsec) / 1000.0);
        lastUsec = t;
        if (wait > 0)
        {
            wait -= delta;
            return;
        }
        if (until != null)
        {
            if (until()) until = null;
            else if ((untilLeft -= delta) <= 0)
            {
                Fail($"waited in vain: {untilWhat}");
                until = null;
            }
            else return;
        }
        if (!script.MoveNext())
        {
            script = null;
            Finish();
            return;
        }
        switch (script.Current)
        {
            case double s:
                wait = s;
                break;
            case Until u:
                until = u.When;
                untilLeft = u.Seconds;
                untilWhat = u.What;
                break;
        }
    }

    private bool measuring;

    private void Step(string name, string what)
    {
        now = new Dictionary<string, object?> { ["step"] = name, ["what"] = what, ["ok"] = true, ["at_s"] = Math.Round(total, 1) };
        steps.Add(now);
        said.Clear();
        GD.Print($"jobtest: {name}");
    }

    private void Note(string key, object? value) => now[key] = value;

    private void Fail(string why)
    {
        GD.PrintErr($"jobtest: {now.GetValueOrDefault("step")}: {why}");
        now["ok"] = false;
        now["why"] = why;
        failed = true;
    }

    private void Check(bool ok, string why)
    {
        if (!ok) Fail(why);
    }

    private void Shot(string name)
    {
        string file = Path.Combine(dir, name + ".png");
        GetViewport().GetTexture().GetImage().SavePng(file);
        pictures.Add(file);
        Note("picture", file);
        Note("prompt", Interact.I.Text);
        Note("said", said.ToList());
    }

    /// <summary>Stand at (x, z) and look at (tx, tz), `up` radians above the level.</summary>
    private static void Stand(float x, float z, float tx, float tz, float up = 0, float near = 0)
    {
        Jef.I.ClearKeys();
        Jef.I.Place(x, z, MathF.Atan2(-(tx - x), -(tz - z)), up, near);
    }

    private static void LookAt(float tx, float tz, float up = 0)
    {
        Jef.I.Yaw = MathF.Atan2(-(tx - Jef.I.X), -(tz - Jef.I.Z));
        Jef.I.Pitch = up;
    }

    private static float Dist(float x, float z) => MathF.Sqrt((Jef.I.X - x) * (Jef.I.X - x) + (Jef.I.Z - z) * (Jef.I.Z - z));

    /// <summary>Walk to (x, z) with W held, looking where he goes; true when he is within `reach`.</summary>
    private IEnumerable<object?> Walk(float x, float z, float reach = 0.4f, double seconds = 40, bool run = true, bool must = true)
    {
        var jef = Jef.I;
        double left = seconds;
        float stuck = 0;
        while (Dist(x, z) > reach && left > 0)
        {
            LookAt(x, z, jef.Pitch);
            jef.SetKey(Key.W, true);
            jef.SetKey(Key.Shift, run);
            left -= GetProcessDeltaTime();
            stuck = jef.Blocked ? stuck + (float)GetProcessDeltaTime() : 0;
            if (stuck > 2) break;
            yield return null;
        }
        jef.ClearKeys();
        if (must && Dist(x, z) > reach + 0.3f) Fail($"did not get to {x:0.0}, {z:0.0}: stands at {jef.X:0.0}, {jef.Z:0.0}{(jef.Blocked ? ", held by " + World.Solid.I.NameAt(new Vector3(jef.X, jef.Y + 1, jef.Z), new Vector3(x, jef.Y + 1, z)) : "")}");
        yield return 0.2;
    }

    private bool Only(string name)
    {
        string only = Main.I.Arg("jobonly");
        return only == "" || only.Split(',').Contains(name);
    }

    // ------------------------------------------------------------------ the steps

    private IEnumerable<object?> Script()
    {
        var link = ServerLink.I;
        Step("server", "the game starts its server and the first state comes");
        if (link == null)
        {
            Fail("the server link is off");
            yield break;
        }
        yield return When(() => GameState.I.Live || link.Error != "", 100, "the first state from the server");
        if (!GameState.I.Live)
        {
            Fail(link.Error);
            yield break;
        }
        Note("server", link.Server?.Url);
        Note("clock", $"{GameState.I.Weekday} {GameState.I.Hour}:{GameState.I.Minute:00}");
        Note("jobs", GameState.I.Jobs.Select(j => $"{j.Id} {j.Status} {j.TaskType} {j.Title}").ToList());
        // a good view: midday, clear (docs/testing.md)
        var set = link.Api!.DevSet(new Dictionary<string, double> { ["hour"] = 13, ["minute"] = 0 });
        yield return When(() => set.IsCompleted, 10, "the clock set to 13:00");
        if (set.IsCompletedSuccessfully) GameState.I.Apply(set.Result);
        yield return 0.5;

        if (Only("prompt"))
            foreach (var s in PromptStep())
                yield return s;
        if (Only("door"))
            foreach (var s in DoorStep())
                yield return s;
        foreach (var s in More())
            yield return s;
    }

    /// <summary>The prompt: at the hiring board, looking at it and looking away.</summary>
    private IEnumerable<object?> PromptStep()
    {
        Step("prompt", "by the hiring board: the prompt shows only while Jef looks at the board");
        var (bx, bz) = Spots.Board;
        Stand(bx, bz - 1.8f, bx, bz);
        yield return 1.0;
        Note("looking_at_it", Interact.I.Text);
        Check(Interact.I.Text.Contains("read the hiring board"), $"no prompt at the board: \"{Interact.I.Text}\"");
        Shot("1-prompt-board");
        LookAt(bx - 10, bz - 1.8f);
        yield return 0.6;
        Note("looking_away", Interact.I.Text);
        Check(!Interact.I.Text.Contains("hiring board"), "the prompt stays while he looks away");
        Shot("1-prompt-away");
        // a place added by another part, nearer the crosshair than the board: it wins
        var mark = Interact.I.Add(new Vector3(bx - 1.2f, 1.2f, bz - 0.4f), 3, "a thing another part added", () => Note("pressed", "the added thing"));
        LookAt(bx - 1.2f, bz - 0.4f);
        yield return 0.4;
        Note("two_near", Interact.I.Text);
        Check(Interact.I.Press(Key.E) && (string?)now.GetValueOrDefault("pressed") == "the added thing", "E did not go to the thing under the crosshair");
        mark.Dispose();
        LookAt(bx, bz);
        yield return 0.3;
    }

    /// <summary>Doors: a shut door is tried and holds; an open one is passed; one swings.</summary>
    private IEnumerable<object?> DoorStep()
    {
        Step("door", "a shut door holds Jef and says why; an open door lets him in; the leaf swings");
        var doors = Doors.I;
        yield return When(() => doors.All.Any(d => d.Known && d.Kind == "shop"), 20, "the server's word on the shops' doors");
        Note("doors", doors.All.Count);
        Note("known", doors.All.Where(d => d.Known).Select(d => $"{d.Kind} {d.Id} {(d.Target > 0 ? "open" : "shut")}").ToList());
        var open = doors.All.Where(d => d.Known && d.Kind == "shop" && d.Target > 0).OrderBy(d => d.Middle.DistanceTo(new Vector3(20, 0, 43))).FirstOrDefault();
        if (open == null)
        {
            Fail("no shop is open at 13:00");
            yield break;
        }
        // the way out of the wall: from the doorway's middle to the step
        var o = (open.Step - new Vector2(open.Middle.X, open.Middle.Z)).Normalized();
        var front = open.Step + o * 1.2f;
        var inside = new Vector2(open.Middle.X, open.Middle.Z) - o * 1.6f;
        Note("door", $"{open.Id} ({open.Label})");

        // shut it (as its keeper would at night): it swings to, and holds him
        doors.Force(open, false);
        Stand(front.X, front.Y, open.Middle.X, open.Middle.Z);
        yield return When(() => open.Open <= 0.01f, 5, "the leaf swung shut");
        yield return 0.4;
        Check(Interact.I.Text.Contains("try the door of"), $"no prompt at the shut door: \"{Interact.I.Text}\"");
        Interact.I.Press(Key.E);
        yield return 0.5;
        Shot("2-door-shut");
        foreach (var s in Walk(inside.X, inside.Y, 0.5f, 5, false, must: false)) yield return s;
        // still on the street's side of the leaf
        bool held = (new Vector2(Jef.I.X, Jef.I.Z) - new Vector2(open.Middle.X, open.Middle.Z)).Dot(o) > 0.3f;
        Note("stopped_at", new[] { Math.Round(Jef.I.X, 2), Math.Round(Jef.I.Z, 2) });
        Note("shut_holds", held);
        Check(held, "he walked through a shut door");

        // open again: the leaf swings (a picture half way), then he walks in
        Stand(front.X, front.Y, open.Middle.X, open.Middle.Z);
        doors.Force(open, true);
        yield return When(() => open.Open > 0.45f, 5, "the leaf swinging");
        Shot("2-door-swinging");
        yield return When(() => open.Open >= 0.99f, 5, "the leaf wide open");
        Check(Interact.I.Text == "" || !Interact.I.Text.Contains("try the door"), "a prompt at an open door");
        foreach (var s in Walk(inside.X, inside.Y, 0.5f, 8, false)) yield return s;
        Note("inside_at", new[] { Math.Round(Jef.I.X, 2), Math.Round(Jef.I.Z, 2), Math.Round(Jef.I.Y, 2) });
        Check((new Vector2(Jef.I.X, Jef.I.Z) - new Vector2(open.Middle.X, open.Middle.Z)).Dot(o) < -0.8f, "he did not get in through the open door");
        // (the room behind is the rooms' part: the picture looks back at the open door and the street)
        LookAt(front.X, front.Y);
        yield return 0.5;
        Shot("2-door-inside");
        // and out again
        foreach (var s in Walk(front.X, front.Y, 0.5f, 8, false)) yield return s;
        doors.Release(open);
    }

    /// <summary>The later steps (the job, the day): added with their parts.</summary>
    private IEnumerable<object?> More()
    {
        yield break;
    }

    // ------------------------------------------------------------------ the end

    private void Finish()
    {
        frameMs.Sort();
        var doc = new Dictionary<string, object?>
        {
            ["ok"] = !failed,
            ["seconds"] = Math.Round(total, 1),
            ["steps"] = steps,
            ["pictures"] = pictures,
            ["frame_ms"] = frameMs.Count == 0 ? null : new Dictionary<string, object?> { ["mean"] = Math.Round(frameMs.Average(), 2), ["p95"] = Math.Round(frameMs[(int)(frameMs.Count * 0.95)], 2), ["frames"] = frameMs.Count },
            ["money_c"] = GameState.I.Money,
            ["needs"] = new Dictionary<string, object?> { ["food"] = GameState.I.Food, ["warmth"] = GameState.I.Warmth, ["sleep"] = GameState.I.Sleep, ["health"] = GameState.I.Health },
            ["rescued"] = Jef.I.Rescued,
        };
        File.WriteAllText(Path.Combine(dir, "jobtest.json"), JsonSerializer.Serialize(doc, new JsonSerializerOptions(Api.Json) { WriteIndented = true }));
        GD.Print($"jobtest: {(failed ? "FAILED" : "ok")}, {steps.Count} steps, {pictures.Count} pictures");
        GetTree().Quit(failed ? 1 : 0);
    }
}
