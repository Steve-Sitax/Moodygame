using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.Windows;

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
    private readonly List<Dictionary<string, object?>> serverCalls = new();
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
        Goods.I.Answered += (ask, reply) => serverCalls.Add(new Dictionary<string, object?> { ["step"] = now.GetValueOrDefault("step"), ["at_s"] = Math.Round(total, 2), ["ask"] = ask, ["reply"] = reply });
        Jef.I.TestInput = true;
        GameState.I.PlayingWhen = () => false; // the clock stands still unless a step lets it run
        script = Script().GetEnumerator();
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
        Note("server_state", GameState.I.Payload);
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

        if(Main.I.Flag("job-features-only"))yield break;

        Step("frames", "the frame time at the Vismarkt with these parts on: no vsync, Jef turning once round (the budget here is 5 ms)");
        var midday = link.Api!.DevSet(new Dictionary<string, double> { ["hour"] = 13, ["minute"] = 0 });
        yield return When(() => midday.IsCompleted, 10, "midday for the frame check");
        if (midday.IsCompletedSuccessfully) GameState.I.Apply(midday.Result);
        World.Daylight.I?.SetTime(13);
        World.Daylight.I?.SetWeather("clear");
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        Engine.MaxFps = 0;
        Stand(-118, 36, -118, 30);
        yield return 1.0;
        measuring = true;
        for (int i = 0; i < 240; i++)
        {
            Jef.I.Yaw += Mathf.Tau / 240;
            yield return null;
        }
        measuring = false;
        if (frameMs.Count > 0)
        {
            var sorted = frameMs.OrderBy(v => v).ToList();
            double mean = frameMs.Average();
            Note("mean_ms", Math.Round(mean, 2));
            Note("p95_ms", Math.Round(sorted[(int)(sorted.Count * 0.95)], 2));
            Note("draw_calls", RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame));
            Check(mean < 5, $"{mean:0.00} ms a frame at the Vismarkt: over the 5 ms asked");
        }
        Shot("7-vismarkt");
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

    /// <summary>The later steps: the jobs, then the day.</summary>
    private IEnumerable<object?> More()
    {
        if (Only("walkup")) foreach(var s in WalkupStep()) yield return s;
        if (Only("carry"))
            foreach (var s in CarryStep())
                yield return s;
        if (Only("deliver"))
            foreach (var s in DeliverStep())
                yield return s;
        if (Only("watch"))
            foreach (var s in WatchStep())
                yield return s;
        if (Only("day"))
            foreach (var s in DayStep())
                yield return s;
    }

    private IEnumerable<object?> WalkupStep()
    {
        Step("walkup", "the engine selects a resident, who walks up and returns to the town afterwards");
        var town=Main.I.GetNodeOrNull<Scheldemist.Town.Townspeople>("Townspeople");
        yield return When(()=>town?.Data!=null&&Walkups.I!=null,30,"the town and walk-up executor");
        if(Walkups.I==null||town==null){Fail("walk-up executor missing");yield break;}
        Stand(-118,36,-118,30);yield return 1.5;
        Note("caller",new{Jef.I.X,Jef.I.Z});
        var call=Walkups.I.Summon("hand","twist","job:test:walkup",Jef.I.X+2,Jef.I.Z,40);
        try
        {
            yield return When(()=>call.Present||call.Gone,90,"the engine-selected resident draws");
            Check(call.Present&&call.Who!=null,"no engine-selected resident came");
            Note("npc",call.Who);Note("name",call.Name);
            Note("first_position",new[]{call.Position.X,call.Position.Y,call.Position.Z});
            yield return When(()=>call.Present&&!call.Moving||call.Gone,45,"the resident reaches Jef");
            Check(call.Present&&call.Distance(Jef.I.X,Jef.I.Z)<4,"walk-up stopped out of reach");
            if(call.Present){var p=call.Position;LookAt(p.X,p.Z,0);yield return .5;Shot("walkup-resident");}
        }
        finally {call.Dispose();}
        Check(call.Who==null||town.ActionPerson(call.Who)?.ActionOwner==null,"walk-up did not release its resident");
    }

    private Dictionary<string, object?> Needs() => new() { ["food"] = GameState.I.Food, ["warmth"] = GameState.I.Warmth, ["sleep"] = GameState.I.Sleep, ["health"] = GameState.I.Health, ["money_c"] = GameState.I.Money };

    /// <summary>The day: eat from the pockets, pay the rent, sleep in the doss house, a bench, a need at zero and the night that comes by itself.</summary>
    private IEnumerable<object?> DayStep()
    {
        var api = ServerLink.I!.Api!;
        var day = Day.I;

        Step("eat", "a herring bought from Fientje (the shop window is the talk part's: asked straight of the server), eaten from the pockets (I, then 1)");
        var buy = api.Buy("fientje", "herring");
        yield return When(() => buy.IsCompleted, 10, "the herring bought");
        if (!buy.IsCompletedSuccessfully)
        {
            Fail($"the herring was not sold: {buy.Exception?.GetBaseException().Message}");
        }
        else
        {
            GameState.I.Apply(buy.Result);
            Note("bought", new Dictionary<string, object?> { ["line"] = buy.Result.Line, ["price_c"] = buy.Result.PriceC });
            var fientje = Folk.At("fientje") ?? new Vector3(45.2f, 0, 10.2f);
            Stand(fientje.X - 1.8f, fientje.Z + 0.4f, fientje.X, fientje.Z);
            yield return 0.5;
            var before = Needs();
            Pockets.I!.Toggle();
            Check(Pockets.I.IsOpen && Dialogs.I!.Top == Pockets.I, "I did not open the pockets");
            yield return 0.6;
            Note("pockets", GameState.I.Pockets.Select(p => $"{p.Name} ({p.Use ?? p.Note ?? "-"})").ToList());
            Shot("6-pockets");
            int at = GameState.I.Pockets.ToList().FindIndex(p => p.Kind == "herring");
            double food = GameState.I.Food;
            Dialogs.I!.SendKey("Digit" + (at + 1));
            yield return When(() => GameState.I.Food != food || !GameState.I.Pockets.Any(p => p.Kind == "herring"), 8, "the herring eaten");
            yield return 0.6;
            Note("needs_before", before);
            Note("needs_after", Needs());
            Check(GameState.I.Food > food, "the food need did not rise");
            Check(!Pockets.I!.IsOpen && !Jef.I.Frozen, "the pockets stayed up, or Jef stayed frozen");
            Shot("6-eaten");
        }

        Step("drink", "Tuur pours a nip of jenever: the browser and server drink bought drinks on the spot");
        var beforeDrink = Needs();
        var drink = api.Buy("tuur", "jenever");
        yield return When(() => drink.IsCompleted, 10, "the drink bought and drunk");
        if (!drink.IsCompletedSuccessfully) Fail("Tuur did not sell the drink");
        else
        {
            GameState.I.Apply(drink.Result);
            GameState.I.Say(drink.Result.Line);
            Note("server", drink.Result);
            Note("needs_before", beforeDrink);
            Note("needs_after", Needs());
            Check(!GameState.I.Pockets.Any(p => p.Kind == "jenever"), "a bought drink went into the pockets");
            Check(GameState.I.Money == (int)beforeDrink["money_c"]! - drink.Result.PriceC, "the drink price did not come off the money");
            yield return 0.6;
            Shot("6-drunk");
        }

        Step("bench", "a bench of the town: E offers to sleep on it, and the chooser says what a bench costs");
        var bench = day.Benches.FirstOrDefault(b => b.Id == "steen:1") ?? day.Benches.FirstOrDefault();
        if (bench == null) Fail("no benches known");
        else
        {
            Stand(bench.X + 0.9f, bench.Z + 0.5f, bench.X, bench.Z, Down(1.0f, 0.45f));
            yield return 0.8;
            Note("bench", $"{bench.Id}: {bench.Label}");
            Note("prompt_at_bench", Interact.I.Text);
            Check(Interact.I.Text.Contains("sleep on the bench"), $"no key at the bench: \"{Interact.I.Text}\"");
            Interact.I.Press(Key.E);
            yield return 0.6;
            Shot("6-bench-chooser");
            Check(day.Busy, "the chooser did not come up");
            Dialogs.I!.SendKey("Escape");
            yield return 0.3;
            Check(!day.Busy && !Jef.I.Frozen, "Esc did not close the chooser");
        }

        Step("rent", "at the doss house door: F pays the week's rent, and the landlady says so");
        var (dx, dz) = Spots.Doss;
        var (ax, az) = Spots.DossDoor;
        Stand(dx, dz, ax, az);
        yield return 0.8;
        Note("prompt_at_doss", Interact.I.Text);
        Check(Interact.I.Text.Contains("sleep in the doss house") && Interact.I.Text.Contains("pay the week's rent"), $"the doss house keys are not both there: \"{Interact.I.Text}\"");
        Shot("6-doss");
        int money = GameState.I.Money;
        Interact.I.Press(Key.F);
        yield return 1.5;
        Note("money_before", money);
        Note("money_after", GameState.I.Money);
        Note("rent_paid", GameState.I.RentPaid);
        Shot("6-rent");

        Step("sleep", "E at the doss house: the chooser, four hours' sleep by the server's clock, awake again on the step");
        var needs = Needs();
        string clock = $"{GameState.I.Weekday} {GameState.I.Hour}:{GameState.I.Minute:00}";
        Check(Interact.I.Press(Key.E) && day.Busy, $"E did not bring the chooser: \"{Interact.I.Text}\"");
        yield return 0.6;
        Shot("6-sleep-chooser");
        Dialogs.I!.SendKey("Digit3"); // four hours
        yield return When(() => day.Asleep || day.LastError != "", 10, "asleep");
        if (!day.Asleep) Note("refused", day.LastError);
        else
        {
            yield return 1.3;
            Shot("6-asleep");
            yield return When(() => !day.Asleep, 40, "the hour's sleep over");
            yield return 1.6;
            Note("woke", day.LastWoke == null ? null : new Dictionary<string, object?> { ["reason"] = day.LastWoke.Reason, ["slept_min"] = day.LastWoke.SleptMin, ["lines"] = day.LastWoke.Lines });
            Note("clock_before", clock);
            Note("clock_after", $"{GameState.I.Weekday} {GameState.I.Hour}:{GameState.I.Minute:00}");
            Note("needs_before", needs);
            Note("needs_after", Needs());
            Check(!Jef.I.Frozen, "awake, but still frozen");
            Shot("6-woke");
        }

        Step("zero", "a need at zero: the warning, the dragging legs, and the night that comes by itself when sleep runs out");
        var low = api.DevSet(new Dictionary<string, double> { ["sleep"] = 2, ["food"] = 0 });
        yield return When(() => low.IsCompleted, 8, "the needs set low");
        if (low.IsCompletedSuccessfully) GameState.I.Apply(low.Result);
        yield return 0.6;
        Note("said_at_zero_food", said.ToList());
        Check(said.Contains("You are starving. Your strength is going. Eat."), "no warning when food reached zero");
        Note("fatigue_at_sleep_2", Jef.I.Fatigue);
        Check(Jef.I.Fatigue < 1, "dead tired, but he walks as fast as ever");
        Shot("6-starving");
        var zero = api.DevSet(new Dictionary<string, double> { ["sleep"] = 0, ["hour"] = 14, ["minute"] = 55 });
        yield return When(() => zero.IsCompleted, 8, "sleep set to zero");
        if (zero.IsCompletedSuccessfully) GameState.I.Apply(zero.Result);
        // one tick of the clock, as while he plays: the hour turns and the server judges
        ServerLink.I.Tick();
        yield return When(() => day.SheetOpen, 12, "the night sheet after he dropped");
        if (day.SheetOpen)
        {
            Check(DaySheets.I?.Shown == "night" && Dialogs.I!.Up.Count(n => n is "day sheet" or "night sheet") == 1,
                "collapse opened more than one night sheet");
            yield return 0.6;
            Shot("6-dropped");
            Note("needs_after_the_night", Needs());
            Dialogs.I!.SendKey("KeyE");
            yield return 0.8;
            Check(!day.SheetOpen && !GameState.I.Hold && !Jef.I.Frozen, "E did not get him up");
            Shot("6-morning");
        }
    }

    private static float Down(float dist, float height = 0.35f) => MathF.Atan2(height - Jef.Eye, Math.Max(0.3f, dist));

    private Dictionary<string, object?> Settled(DoneReply r) => new()
    {
        ["status"] = r.Settlement.Status, ["pay_c"] = r.Settlement.PayC, ["extra_c"] = r.Settlement.ExtraC, ["trust_delta"] = r.Settlement.TrustDelta, ["facts"] = r.Settlement.Facts, ["money_c"] = r.MoneyC,
    };

    /// <summary>A carry job from the board to the pay: read the board, take it, fetch each crate, carry it, set it down, get paid.</summary>
    private IEnumerable<object?> CarryStep()
    {
        Step("board", "E at the hiring board opens it; a number takes the job; the task card comes up");
        var jobs = Jobs.I;
        var goods = Goods.I;
        yield return When(() => goods.Loaded, 20, "the goods from the server");
        var (bx, bz) = Spots.Board;
        Stand(bx, bz - 1.8f, bx, bz);
        yield return 0.6;
        Check(Interact.I.Press(Key.E) && jobs.BoardOpen, "E did not open the board");
        yield return 0.6;
        Shot("3-board");
        var list = jobs.VisibleJobs();
        Note("board", list.Select((j, i) => $"{i + 1}. {j.Title} ({j.PayC} c, {j.Status})").ToList());
        int at = list.FindIndex(j => j.TaskType == "carry" && j.Status == "offered" && j.Title.Contains("crates"));
        if (at < 0)
        {
            Fail("no carry job with crates on the board");
            yield break;
        }
        var job = list[at];
        int moneyBefore = GameState.I.Money;
        Dialogs.I!.SendKey("Digit" + (at + 1));
        yield return When(() => jobs.Active?.Id == job.Id, 10, "the job taken");
        yield return When(() => !jobs.BoardOpen, 5, "the board put away once the job is taken");
        Note("took", $"{job.Id} {job.Title}");
        var task = JobTask.Of(job)!;
        var to = Spots.Get(task.To)!;
        yield return When(() => goods.Items.Count(i => i.JobId == job.Id) >= task.Count, 10, "the job's goods laid out by the server");
        yield return 0.8;
        Note("task_card", jobs.TaskText);
        Shot("3-job-taken");
        jobs.OpenBook();
        yield return 0.5;
        Check(jobs.BookOpen && Dialogs.I!.Top?.DialogName == "quest book" && Jef.I.Frozen, "the quest book is not on the stack");
        Check(!Interact.I.Press(Key.E), "E went through the book to the world");
        Check(Press.I?.TakeJob != null && Talk.I?.Work != null && Talk.I?.OnTakeWork != null, "the paper or talk work hook is missing");
        Note("map_marks", TownMap.I!.JobMarks!().Select(m => new { m.X, m.Z, m.Label }).ToList());
        Check(TownMap.I.JobMarks!().Any() && TownMap.I.WayGoal!() != null, "the job has no map mark or way goal");
        Shot("3-quest-book");
        Dialogs.I!.SendKey("KeyM");
        yield return 0.6;
        Check(!jobs.BookOpen && TownMap.I.Open && Jef.I.Frozen, "M did not put the book away and open the map");
        Shot("3-job-map");
        TownMap.I.Close();
        jobs.RestoreWorld(); // the same hook a load/new week calls
        yield return When(() => goods.Loaded && jobs.Active?.Id == job.Id, 10, "the job restored after world replacement");
        yield return 0.6;
        Check(goods.Items.Where(i => i.Obj != null).All(i => GodotObject.IsInstanceValid(i.Obj)), "a baked goods node was freed during reset");

        for (int n = 0; n < task.Count; n++)
        {
            Step($"carry {n + 1}", "to the goods, lift one (E), carry it to the goal (slower, no jump), set it down (E)");
            var item = goods.Items.Where(i => i.JobId == job.Id).OrderBy(i => i.X).FirstOrDefault();
            if (item == null)
            {
                Fail("no goods of the job lie anywhere");
                yield break;
            }
            // beside the crate, on the side the quay is
            Stand(item.X, item.Z + 1.25f, item.X, item.Z, Down(1.25f));
            yield return 0.6;
            Note("at_goods", new[] { Math.Round(Jef.I.X, 2), Math.Round(Jef.I.Y, 2), Math.Round(Jef.I.Z, 2) });
            Note("prompt_at_goods", Interact.I.Text);
            if (n == 0) Shot("3-goods");
            Check(Interact.I.Press(Key.E) && goods.Carried == item, $"E did not lift it: \"{Interact.I.Text}\" {goods.LastRefusal}");
            yield return 0.8;
            Check(goods.Carried == item, $"the server took it back: {goods.LastRefusal}");
            Check(Jef.I.Laden && Jef.I.SpeedFactor < 1, "carrying, but not laden or not slower");
            Note("speed_factor", Jef.I.SpeedFactor);
            Jef.I.Pitch = 0;
            yield return 0.3;
            if (n == 0) Shot("3-carrying");
            // carry it: on foot along the quay; where the way is shut (a crane, a pile) he is set down by the goal instead
            float gx = to.X + 1.7f, gz = to.Z + (n == 0 ? -0.45f : 0.55f);
            var start = new Vector2(Jef.I.X, Jef.I.Z);
            double t0 = total;
            foreach (var s in Walk(Jef.I.X, 3.5f, 0.6f, 25, false, must: false)) yield return s;
            foreach (var s in Walk(gx, gz, 0.5f, 60, false, must: false)) yield return s;
            float speedSeen = (float)((new Vector2(Jef.I.X, Jef.I.Z) - start).Length() / Math.Max(0.1, total - t0));
            bool walked = Dist(gx, gz) < 0.9f;
            Note("walked_there", walked);
            Note("metres_a_second", Math.Round(speedSeen, 2));
            if (!walked) Stand(gx, gz, to.X, gz);
            LookAt(to.X, gz, Down(1.0f, 0.0f));
            yield return 0.5;
            Note("prompt_at_goal", Interact.I.Text);
            Check(Interact.I.Text.Contains("set it down here"), $"no key to set it down at the goal: \"{Interact.I.Text}\"");
            if (n == 0) Shot("3-at-goal");
            Check(Interact.I.Press(Key.E) && goods.Carried == null, "E did not set it down");
            yield return 0.8;
            Check(!Jef.I.Laden && Jef.I.SpeedFactor == 1, "hands empty, but still laden or slow");
            Note("task_card", jobs.TaskText);
            if (n == 0) Shot("3-set-down");
        }
        Step("paid", "all goods in: the server settles, the employer pays, the money on the HUD moves");
        yield return When(() => jobs.LastDone != null, 10, "the server's settlement");
        yield return 1.0;
        if (jobs.LastDone is { } done) Note("server", Settled(done));
        Note("money_before", moneyBefore);
        Note("money_after", GameState.I.Money);
        Check(GameState.I.Money > moneyBefore, "no money came");
        Check(jobs.Active == null, "the job is still in hand");
        LookAt(to.X, to.Z, Down(2.0f, 0.3f));
        yield return 0.4;
        Shot("3-paid");
    }

    /// <summary>A delivery: the parcel from the employer's hand into the pocket, to the recipient, paid.</summary>
    private IEnumerable<object?> DeliverStep()
    {
        Step("deliver", "a parcel taken from Tuur (F), carried in the pocket to the mate on the Anna Maria, given (E), paid");
        var jobs = Jobs.I;
        var job = GameState.I.Jobs.FirstOrDefault(j => j.TaskType == "deliver" && j.Status == "offered" && j.EmployerNpc == "tuur");
        if (job == null)
        {
            Fail("Tuur's parcel is not on the board");
            yield break;
        }
        int moneyBefore = GameState.I.Money;
        _ = jobs.TakeJob(job);
        yield return When(() => jobs.Active?.Id == job.Id, 10, "the job taken");
        var tuur = Folk.At("tuur");
        if (tuur == null)
        {
            Fail("nobody knows where Tuur is");
            yield break;
        }
        Stand(tuur.Value.X + 0.2f, tuur.Value.Z + 1.5f, tuur.Value.X, tuur.Value.Z, 0, tuur.Value.Y);
        yield return 0.8;
        Note("task_card", jobs.TaskText);
        Note("prompt_at_tuur", Interact.I.Text);
        Check(Interact.I.Press(Key.E) && Talk.I!.IsOpen, "E at Tuur did not open talk");
        yield return 0.6;
        Shot("4-talk-employer");
        Dialogs.I!.SendKey("Escape");
        yield return 0.3;
        Shot("4-deliver-employer");
        Check(Interact.I.Press(Key.F), $"no F to take the parcel: \"{Interact.I.Text}\"");
        yield return When(() => GameState.I.Pockets.Any(p => p.JobId == job.Id), 8, "the parcel in the pocket");
        Note("pockets", GameState.I.Pockets.Select(p => p.Name).ToList());
        yield return 0.5;
        var goal = jobs.Run?.Goal();
        if (goal == null)
        {
            Fail("the job has no goal with the parcel in the pocket");
            yield break;
        }
        var g = goal.Value;
        Stand(g.X + 0.3f, g.Z + 1.6f, g.X, g.Z, 0, g.Y);
        yield return 0.8;
        Note("at_recipient", new[] { Math.Round(Jef.I.X, 2), Math.Round(Jef.I.Y, 2), Math.Round(Jef.I.Z, 2) });
        Note("prompt_at_recipient", Interact.I.Text);
        Shot("4-deliver-recipient");
        var before = jobs.LastDone;
        Check(Interact.I.Press(Key.E), $"no E to give the parcel: \"{Interact.I.Text}\"");
        yield return When(() => jobs.LastDone != before, 10, "the server's settlement");
        yield return 0.8;
        if (jobs.LastDone is { } done) Note("server", Settled(done));
        Note("money_before", moneyBefore);
        Note("money_after", GameState.I.Money);
        Check(GameState.I.Money > moneyBefore, "no money came");
        Shot("4-deliver-paid");
    }

    /// <summary>A watch: stand at the post until the bell (the clock run fast), paid.</summary>
    private IEnumerable<object?> WatchStep()
    {
        Step("watch", "a watch at the post until the bell (run at eight times the speed), then paid");
        var jobs = Jobs.I;
        var job = GameState.I.Jobs.FirstOrDefault(j => j.TaskType == "watch" && j.Status == "offered");
        if (job == null)
        {
            Fail("no watch on the board");
            yield break;
        }
        int moneyBefore = GameState.I.Money;
        var task = JobTask.Of(job)!;
        var post = Spots.Get(task.Post)!;
        _ = jobs.TakeJob(job);
        yield return When(() => jobs.Active?.Id == job.Id, 10, "the job taken");
        Stand(post.X - 2.5f, post.Z - 1.5f, post.X, post.Z, Down(3));
        yield return When(() => Goods.I.Items.Any(i => i.JobId == job.Id), 8, "the pile at the post");
        yield return 0.8;
        Note("task_card", jobs.TaskText);
        Note("pile", Goods.I.Items.Count(i => i.JobId == job.Id));
        Shot("5-watch");
        if (Only("trouble"))
            foreach (var s in TroubleStep()) yield return s;
        var before = jobs.LastDone;
        Engine.TimeScale = 8;
        yield return When(() => jobs.LastDone != before, task.DurationS + 20, "the bell and the server's settlement");
        Engine.TimeScale = 1;
        yield return 0.8;
        if (jobs.LastDone is { } done) Note("server", Settled(done));
        Note("money_before", moneyBefore);
        Note("money_after", GameState.I.Money);
        Check(GameState.I.Money > moneyBefore, "no money came");
        Shot("5-watch-paid");
    }

    private IEnumerable<object?> TroubleStep()
    {
        Step("trouble", "the server's weather trouble: the sticky paper, a choice, then the extra errand");
        var api = ServerLink.I!.Api!;
        var force = api.Post<JsonElement>("api/dev/ideas", new { trouble = "weather" });
        yield return When(() => force.IsCompleted, 10, "trouble written by the server");
        if (!force.IsCompletedSuccessfully) { Fail("trouble was not written"); yield break; }
        Note("server_plan", force.Result);
        var load = Trouble.I.Load();
        yield return When(() => load.IsCompleted, 10, "the trouble fetched");
        var t = Trouble.I.View;
        if (t == null) { Fail("the server did not send trouble"); yield break; }
        Trouble.I.Show(t); // the walk-up hook: its speaker is before Jef
        yield return 0.6;
        Check(Trouble.I.IsOpen && Jef.I.Frozen && Dialogs.I!.Top?.DialogName == "trouble", "the trouble card is not on top");
        Dialogs.I!.SendKey("Escape");
        Check(Trouble.I.IsOpen, "Esc dismissed a choice that must be made");
        Shot("5-trouble");
        var option = t.Options.FirstOrDefault(o => o.Step != null) ?? t.Options[0];
        Dialogs.I.SendKey("Digit" + option.N);
        yield return When(() => !Trouble.I.IsOpen, 10, "the server accepted the trouble choice");
        Note("server_choice", Trouble.I.LastReply);
        if (Trouble.I.View?.Step is { } step)
        {
            Stand(step.X + 0.7f, step.Z + 0.4f, step.X, step.Z);
            yield return 0.5;
            Check(Interact.I.Press(Key.E), "no E at the trouble errand");
            yield return When(() => Trouble.I.View?.StepDone == true, 10, "the extra errand accepted");
            Note("server_step", Trouble.I.LastReply);
            Shot("5-trouble-step");
        }
        var post = Spots.Get(JobTask.Of(Jobs.I.Active!)!.Post)!;
        Stand(post.X - 2.5f, post.Z - 1.5f, post.X, post.Z, Down(3));
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
            ["goods_calls"] = serverCalls,
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
