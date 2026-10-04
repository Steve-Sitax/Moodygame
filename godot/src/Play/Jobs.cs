using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Windows;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// The hands and the job (game/jobs.ts). Everything Jef does with E and F at goods and at work goes through here:
/// lift, set down, stack, drop in the Schelde, talk to someone, read the board, take a job, and the job's own keys.
/// The server decides pay, task and trust; this shows them: the board's paper, the quest book (J: up to three jobs
/// in hand, one followed), the task card under the clock, the faint glow at the goal with the ink tick at the top
/// edge, the line when a job is paid, the employer's note. The papers are written on the talk part's paper kit
/// (Windows/Paper.cs) and stand on its dialog stack.
///
/// Tied to the other parts here: the talk's work (Talk.Work, WorkLater, OnTakeWork, OnBought), the paper's job
/// (Press.TakeJob), the map's marks and way (TownMap.JobMarks, WayGoal, PersonAt), a job's thick fog
/// (Daylight.SetThickFog), a load or a new week (MainMenu.WorldReplaced: the job in hand is taken up again from the
/// server). Left open: `Jobs.I.Sfx` (the sound part: "lift", "thud_wood", "thud_soft", "thud_plank", "splash",
/// "bell", "coins", at a place or null).
/// Not here yet: the employers' boxes at night, the handcart, the dockers' piles by the piece, the twists' people.
/// </summary>
[GamePart(320)]
public partial class Jobs : Node
{
    public static Jobs I { get; private set; } = null!;

    private const float ReachBoard = 2.6f;
    private const float ReachTalk = 2.6f;
    private const float OwnerSees = 12;
    private const double NoteSeconds = 11;
    private const int MaxInHand = 3;

    /// <summary>An event sound, at a place or (null) at Jef. Set by the sound part.</summary>
    public Action<string, Vector3?>? Sfx;

    private Job? active;
    private IRun? run;
    private int? followId;
    private bool finishing, taking;
    /// <summary>An owner saw Jef lift this; set back near where it was, they calm down.</summary>
    private (Item Item, string Owner)? watched;
    private readonly List<(Node3D Obj, float T, bool Splashed)> sinking = new();
    private Window board = null!, book = null!;
    private int? giveUpAsk;

    public Job? Active => active;
    public IRun? Run => run;
    public bool BoardOpen => board.IsOpen;
    public bool BookOpen => book.IsOpen;
    /// <summary>What the last job paid, for the checks: the server's settlement.</summary>
    public DoneReply? LastDone { get; private set; }
    public string TaskText { get; private set; } = "";

    // what an owner shouts when Jef lifts their goods under their nose
    private static readonly Dictionary<string, string> OwnerShout = new()
    {
        ["sooi"] = "Sooi: \"Hey! That's natie goods, lad. Put it down or I'll put you down.\"",
        ["peeters"] = "Widow Peeters: \"Thief! Those are mine. Put it back this instant!\"",
        ["tuur"] = "Tuur: \"Hands off, friend. That's not yours to carry.\"",
        ["fientje"] = "Fientje: \"Oi! Fingers off my baskets, you!\"",
    };
    private static readonly Dictionary<string, string> OwnerCalm = new()
    {
        ["sooi"] = "Sooi grunts. \"Right. Keep your hands to your own work.\"",
        ["peeters"] = "The widow sniffs. \"Hm. See that it stays there.\"",
        ["tuur"] = "Tuur nods slowly. \"Wise.\"",
        ["fientje"] = "\"That's better, love. I'd have told the whole Vismarkt.\"",
    };
    /// <summary>T4 the quest book: the twists a player is told of when he takes the work; the others are surprises.</summary>
    private static readonly Dictionary<string, string> KnownTwists = new() { ["foreman_watches"] = "The foreman is watching" };

    public Jobs()
    {
        I = this;
    }

    public override void _Ready()
    {
        board = new Window("job board", WriteBoard, BoardKey);
        book = new Window("quest book", WriteBook, BookKey);
        var st = GameState.I;
        st.Changed += Apply;
        Interact.I.AddProvider(Keys);
        Goods.I.Lost += (it, why) =>
        {
            if (why != "") Toast(why);
            if (watched?.Item == it) watched = null;
        };
        Goods.I.Other += (it, why, at) =>
        {
            if (why == "sunk" && at != null && it.Obj != null) Sink(it.Obj, at.Value.X, at.Value.Y);
            else if (why == "put" && RunWords.Dist(it.X, it.Z, Jef.I.X, Jef.I.Z) < 20) Sound($"thud_{GoodsRules.Of(it.Kind).Thud}", new Vector3(it.X, it.Y, it.Z));
        };
        ServerLink.I?.WhenUp(() => ServerLink.I.Api!.OutcomePushed += ShowOutcome);

        // the talk: the work a person offers, and how it is taken (T4: up to three jobs in hand; with three, the offer waits)
        if (Scheldemist.Talks.Talk.I is { } talk)
        {
            talk.Work = id => InHand().Count >= MaxInHand ? new List<Job>() : GameState.I.Jobs.Where(j => j.EmployerNpc == id && j.Status == "offered" && Playable(j)).ToList();
            talk.WorkLater = id => InHand().Count >= MaxInHand && GameState.I.Jobs.Any(j => j.EmployerNpc == id && j.Status == "offered" && Playable(j));
            talk.OnTakeWork = j => { _ = TakeJob(j); };
            talk.OnBought = (_, line) => Toast(line);
        }
        if (Scheldemist.Talks.Press.I is { } press)
            press.TakeJob = (id, _) =>
            {
                var j = GameState.I.Jobs.FirstOrDefault(q => q.Id == id);
                return j != null ? TakeJob(j) : Task.CompletedTask;
            };
        if (TownMap.I is { } map)
        {
            map.JobMarks = MapMarks;
            map.WayGoal = () => active != null && run?.Goal() is { } g ? new Vector2(g.X, g.Z) : null;
            map.PersonAt = id => Folk.At(id) is { } at ? new Vector2(at.X, at.Z) : null;
        }
        // a save loaded, a new week: the server's game is another one; the job in hand is taken up again from it
        if (Scheldemist.Menu.MainMenu.I is { } menu)
            menu.WorldReplaced += (_, _) => RestoreWorld();
        BuildUi();
        GetViewport().SizeChanged += BuildUi;
        if (st.Payload != null) Apply(st.Payload);
    }

    /// <summary>A load or new week: forget the old run and resume the server's job, including saved progress.</summary>
    public void RestoreWorld()
    {
        board.Close();
        book.Close();
        run?.Dispose(true);
        run = null;
        active = null;
        followId = null;
        watched = null;
        finishing = taking = false;
        asideProgress.Clear();
        Goods.I.Reset();
        if (GameState.I.Payload != null) Apply(GameState.I.Payload);
    }

    private void Toast(string text) => GameState.I.Say(text);
    private void Sound(string name, Vector3? at = null) => Sfx?.Invoke(name, at);

    // ------------------------------------------------------------------ server data (jobs.ts apply)

    /// <summary>The jobs in hand (up to three), the followed one first.</summary>
    public List<Job> InHand() => GameState.I.Jobs.Where(j => j.Status == "taken").OrderBy(j => j.Id == active?.Id ? 0 : 1).ThenBy(j => j.Id).ToList();

    /// <summary>A job in hand (followed or set aside) by its id, or null.</summary>
    public Job? JobInHand(int? id) => id == null ? null : GameState.I.Jobs.FirstOrDefault(j => j.Id == id && j.Status == "taken");

    private void Apply(JobsPayload p)
    {
        // T4 the quest book: up to three jobs in hand, one followed; pick up the followed one (a load in the middle of
        // a job), the one asked for, else the first this part can play
        var inHand = p.Jobs.Where(j => j.Status == "taken" && JobTask.Of(j) != null).ToList();
        var taken = (active != null ? inHand.FirstOrDefault(j => j.Id == active.Id) : null) ?? inHand.FirstOrDefault(j => j.Id == followId) ?? inHand.FirstOrDefault();
        if (taken != null && active == null && !finishing) Follow(taken);
        // the job ended on the server without us (its deadline, a gang, the cell): drop it here too
        if (active != null && !finishing && taken?.Id != active.Id)
        {
            var a = active;
            if (a.Source == "night" && p.Clock.Hour >= 5 && p.Clock.Hour < 21) Toast($"Five o'clock: {a.EmployerName} is gone, and \"{a.Title}\" with him. Not done, not paid.");
            DropRun();
            // T4: the next job in the book is followed now
            var next = inHand.FirstOrDefault(j => j.Id != a.Id);
            if (next != null) Follow(next);
        }
        if (board.IsOpen) board.Render();
        if (book.IsOpen) book.Render();
    }

    // ------------------------------------------------------------------ per frame

    public override void _Process(double delta)
    {
        float dt = (float)Math.Min(delta, 0.1);
        if (GameState.I.Playing || Jef.I.TestInput) run?.Update(dt);
        UpdateSinking(dt);
        RenderTask();
        UpdatePointer(dt);
        if (noteLeft > 0 && (noteLeft -= delta) <= 0) DropNote();
    }

    /// <summary>J with no other paper up opens the quest book.</summary>
    public override void _UnhandledKeyInput(InputEvent e)
    {
        if (Jef.I.TestInput || e is not InputEventKey { Pressed: true, Echo: false } k || Dialogs.I is not { Any: false } d) return;
        if (d.GameCode(k) != "KeyJ" || TownMap.I is { Open: true }) return;
        GetViewport().SetInputAsHandled();
        OpenBook();
    }

    // ------------------------------------------------------------------ the keys (jobs.ts findAll)

    private Offers? Keys(float x, float z)
    {
        var goods = Goods.I;
        var carried = goods.Carried;
        if (carried != null)
        {
            var only = new List<Act>();
            if (run != null) only.AddRange(run.CarryActions(carried));
            var (px, pz) = Goods.Ahead(0.95f);
            if (OverWater(px, pz)) only.Add(Act.Me(Key.E, "let it fall into the Schelde", () => Drown(px, pz)));
            else
            {
                string? where = goods.CanPlace(px, pz);
                if (where != null)
                {
                    var aside = AsideGoal(carried, px, pz);
                    string label = run?.PlaceLabel(carried, px, pz) ?? (aside != null ? $"set it down here ({aside.Title})" : where == "stack" ? "stack it" : "set it down");
                    only.Add(Act.Me(Key.E, label, () => PutDown(px, pz)));
                }
            }
            return new Offers { Only = only };
        }
        var o = new Offers { First = run?.Actions(), Options = new List<(float, Act)>(), Extra = new List<Act>() };
        // (another player's job goods are his: not offered to lift; anyone's own goods are, as ever)
        var item = goods.Nearest(Goods.ReachItem, it => !it.CartOnly && (it.JobId == null || it.JobId == active?.Id));
        var big = item == null ? goods.Nearest(Goods.ReachItem, it => it.CartOnly) : null;
        if (big != null)
            o.Options.Add((RunWords.Dist(big.X, big.Z, x, z), Act.At(Key.E, "too big to carry: a dray's work", goods.Middle(big), () => Toast("That crate is too big for one man. The naties move it with a dray."))));
        if (item != null)
            o.Options.Add((RunWords.Dist(item.X, item.Z, x, z), Act.At(Key.E, $"lift the {GoodsRules.Of(item.Kind).One}", goods.Middle(item), () => Lift(item))));
        // E goes to a person Jef looks at: the talk window is the talk part's
        if (Scheldemist.Talks.Talk.I is { } talk)
            foreach (var who in Folk.Near(x, z, ReachTalk))
            {
                var chest = who.At + new Vector3(0, 1.3f, 0);
                var p = who;
                o.Options.Add((who.Dist + (who.Fixed ? 0 : 0.05f), Act.At(Key.E, $"talk to {who.Name}", chest, () => talk.Open(p.Id, p.Name, p.Title))));
                if (talk.Sells(who.Id)) o.Extra.Add(Act.At(Key.F, $"buy from {who.Name}", chest, () => talk.Open(p.Id, p.Name, p.Title, true)));
            }
        var (bx, bz) = Spots.Board;
        float boardD = RunWords.Dist(bx, bz, x, z);
        if (boardD < ReachBoard) o.Options.Add((boardD, Act.At(Key.E, "read the hiring board", new Vector3(bx, 1.55f, bz), OpenBoard)));
        return o;
    }

    /// <summary>
    /// Is the spot ahead open water (rijnkaai.ts isWater)? Inside the water's outline, and what lies under the spot
    /// at the height of his feet is below the surface: a pier or a pontoon over the river is ground.
    /// </summary>
    private static bool OverWater(float x, float z)
    {
        if (!Water.In(x, z)) return false;
        float g = Jef.I.GroundAt(x, z, Jef.I.Y);
        return !float.IsFinite(g) || g < Water.Level(x, z) + 0.05f;
    }

    // ------------------------------------------------------------------ hands

    private void Lift(Item item)
    {
        // D1 docks: the dockers' piles are the natie's work, for a man in the foreman's book (not here yet)
        if (item.Id.StartsWith("haul:", StringComparison.Ordinal))
        {
            Toast("That is the natie's load. Ask Sooi, the foreman at the Hessenatie door, to write you in his book.");
            return;
        }
        Goods.I.Lift(item);
        var g = GoodsRules.Of(item.Kind);
        Jef.I.SpeedFactor = g.Speed;
        if (item.Heavy && item.JobId == null)
        {
            Jef.I.SpeedFactor = 0.4f;
            Toast($"Heavy. You carry the {g.One} in both arms, slowly.");
        }
        Sound("lift");
        run?.OnLifted(item);
        // someone else's goods, and they are watching?
        if (item.S.Owner is { } owner && item.JobId == null && Folk.Dist(owner, Jef.I.X, Jef.I.Z) < OwnerSees)
        {
            Folk.LookAt?.Invoke(owner, Jef.I.X, Jef.I.Z);
            Toast(OwnerShout.GetValueOrDefault(owner, $"{Folk.NameOf(owner, "Someone")} shouts at you."));
            watched = (item, owner);
            var api = ServerLink.I?.Api;
            api?.Run(api.Witness(owner, "took"), _ => { });
        }
    }

    private void PutDown(float x, float z)
    {
        var from = Goods.I.Carried?.LiftedFrom;
        var item = Goods.I.PutDown(x, z);
        if (item == null) return;
        Sound($"thud_{GoodsRules.Of(item.Kind).Thud}", new Vector3(x, item.Y, z));
        run?.OnPlaced(item);
        // T4: goods of another job in hand, set down at that job's goal: they count for it
        var aside = AsideGoal(item, x, z);
        if (aside != null)
        {
            Goods.I.Unjob(item);
            Tally(aside.Id, "delivered");
        }
        if (watched is { } w && w.Item == item)
        {
            watched = null;
            if (from is { } f && RunWords.Dist(f.X, f.Z, x, z) < 2.5f && Time.GetTicksMsec() - f.T < 15_000)
            {
                Toast(OwnerCalm.GetValueOrDefault(w.Owner, "They let it go."));
                var api = ServerLink.I?.Api;
                api?.Run(api.Witness(w.Owner, "returned"), _ => { });
            }
        }
    }

    private void Drown(float x, float z)
    {
        var item = Goods.I.DropCarried("sunk", new Vector2(x, z));
        if (item == null) return;
        if (item.Obj != null) Sink(item.Obj, x, z);
        bool jobItem = item.JobId != null && item.JobId == active?.Id;
        run?.OnLost(item);
        if (!jobItem) Toast("It goes over the edge. The Schelde takes it.");
        if (!jobItem && JobInHand(item.JobId) != null) Tally(item.JobId!.Value, "lost");
    }

    private void Sink(Node3D obj, float x, float z)
    {
        obj.Reparent(Main.I.View, false);
        obj.Position = new Vector3(x, 0.2f, z);
        obj.Rotation = Vector3.Zero;
        sinking.Add((obj, 0, false));
    }

    private void UpdateSinking(float dt)
    {
        for (int i = sinking.Count - 1; i >= 0; i--)
        {
            var (obj, t, splashed) = sinking[i];
            t += dt;
            float y = t < 0.5f ? 0.2f - t * t * 18 : -1.8f - (t - 0.5f) * 0.35f;
            // down to the water as it stands now, then slowly under
            float level = Water.Level(obj.Position.X, obj.Position.Z);
            if (t >= 0.5f) y = Math.Min(y, level - (t - 0.5f) * 0.35f);
            obj.Position = new Vector3(obj.Position.X, y, obj.Position.Z);
            if (!splashed && y <= Math.Max(-1.8f, level))
            {
                splashed = true;
                Sound("splash", obj.Position);
            }
            obj.RotateZ(dt * 0.6f);
            if (t > 4)
            {
                Goods.I.Sunk(obj);
                sinking.RemoveAt(i);
            }
            else sinking[i] = (obj, t, splashed);
        }
    }

    /// <summary>T4: an item of another carry job in hand, at (x, z) within reach of that job's goal: that job, else null.</summary>
    private Job? AsideGoal(Item item, float x, float z)
    {
        if (item.JobId == null || item.JobId == active?.Id) return null;
        var j = JobInHand(item.JobId);
        var t = j != null ? JobTask.Of(j) : null;
        if (j == null || t?.Kind != "carry" || Spots.Get(t.To) is not { } to) return null;
        return RunWords.Dist(to.X, to.Z, x, z) < RunWords.ReachDrop ? j : null;
    }

    private readonly Dictionary<int, Progress> asideProgress = new();
    private Task asideQ = Task.CompletedTask;

    /// <summary>
    /// T4 (the quest book, mixed loads): goods of a job in hand came to account, delivered at its goal or lost. The
    /// followed job's run counts its own; a job set aside is counted here, one after another: its progress saved,
    /// and when all its goods are in, settled and paid at once (each job at its own goal).
    /// </summary>
    public void Tally(int jobId, string what)
    {
        if (jobId == active?.Id) return; // (the followed job's run counts its own in OnPlaced and OnLost)
        asideQ = asideQ.ContinueWith(_ => TallyAside(jobId, what), TaskScheduler.FromCurrentSynchronizationContext()).Unwrap();
    }

    private async Task TallyAside(int jobId, string what)
    {
        var j = JobInHand(jobId);
        var t = j != null ? JobTask.Of(j) : null;
        var api = ServerLink.I?.Api;
        if (j == null || t == null || api == null || t.Kind is not ("carry" or "deliver")) return;
        int count = t.Kind == "carry" ? t.Count : 1;
        var p = asideProgress.GetValueOrDefault(jobId, t.Progress ?? new Progress());
        p = what == "delivered" ? p with { Delivered = p.Delivered + 1 } : p with { Lost = p.Lost + 1 };
        asideProgress[jobId] = p;
        try
        {
            await api.Progress(jobId, p);
        }
        catch (ApiException)
        {
            // the count is kept here; the settlement carries it
        }
        if (p.Delivered + p.Lost + p.Sold < count)
        {
            if (what == "delivered") Toast($"For \"{j.Title}\": {p.Delivered} of {count} in.");
            return;
        }
        try
        {
            var r = await api.Done(jobId, new Report { Delivered = p.Delivered, Lost = p.Lost, Sold = p.Sold, Pocketed = false, Late = false, LeftPostS = 0, Thief = "none", BribeTaken = false, SeenAway = false });
            LastDone = r;
            var s = r.Settlement;
            Toast($"\"{j.Title}\" is done. {(s.PayC > 0 ? $"{j.EmployerName} pays {s.PayC} c" : $"{j.EmployerName} pays nothing")}{(s.ExtraC != 0 ? $", and {s.ExtraC} c on the side" : "")}.");
            Sound("coins");
            GameState.I.SetMoney(r.MoneyC);
            asideProgress.Remove(jobId);
            Goods.I.ClearJob(jobId);
            GameState.I.Apply(await api.Jobs());
        }
        catch (ApiException e)
        {
            Toast($"Not settled: {e.Message}");
        }
    }

    // ------------------------------------------------------------------ the board

    private void OpenBoard() => board.Open();
    public void CloseBoard() => board.Close();

    /// <summary>Open work and your job, plus the last two finished ones. Number keys index this list.</summary>
    public List<Job> VisibleJobs()
    {
        // an emigrant family's errand is asked in talk, and the night's work in a low voice: not chalked on the board
        var all = GameState.I.Jobs.Where(j => (j.Source != "emigrant" && j.Source != "night") || j.Status == "taken").ToList();
        var finished = all.Where(j => j.Status is "done" or "failed").TakeLast(2).ToList();
        return all.Where(j => j.Status is "offered" or "taken" || finished.Contains(j)).ToList();
    }

    /// <summary>jobs.ts summary: a job in a few words.</summary>
    private static string Summary(Job j)
    {
        var t = JobTask.Of(j);
        if (t == null)
        {
            if (j.Task is { ValueKind: System.Text.Json.JsonValueKind.Object } raw && raw.TryGetProperty("kind", out var k) && k.GetString() == "letters" && raw.TryGetProperty("stops", out var stops))
            {
                int n = stops.GetArrayLength();
                bool wire = stops.EnumerateArray().Any(s => s.TryGetProperty("what", out var w) && w.GetString() == "telegraph");
                return wire ? "send a telegram" : $"{(n == 1 ? "a letter" : $"{n} letters")} to doors about the town";
            }
            return j.TaskType;
        }
        string urgent = t.LimitS is > 0 ? ", before the bell" : "";
        var g = GoodsRules.Of(t.Goods);
        if (t.Kind == "carry") return $"carry {(t.Count == 1 ? $"a {g.One}" : $"{t.Count} {t.Goods}")}{(t.Cart ? $" on {j.EmployerName}'s handcart" : " by hand")}, {Spots.Label(t.From)} to {Spots.Label(t.To)}{urgent}";
        if (t.Kind == "deliver") return $"deliver a {g.One} to {t.Recipient}{urgent}";
        return $"watch the {t.Goods} at {Spots.Label(t.Post)}";
    }

    /// <summary>The kinds of work this part plays (carry, watch, deliver by hand); the letters, the mill and the lamps have parts of their own.</summary>
    private static bool Playable(Job j) => j.Playable && JobTask.Of(j) is { Cart: false };

    /// <summary>.board: left 50%, top 50%, min(720px, 86vw), at most 84vh high, padding 18 28 12, turned -0.6 degrees.</summary>
    private Sheet BoardSheet()
    {
        var win = GetViewport().GetVisibleRect().Size;
        float s = Dialogs.I!.Ui;
        return new Sheet(s, Math.Min(720 * s, win.X * 0.86f), Css.Hex("d4cab0"), (28, 18, 28, 12), -0.6f, sepia: 0.35f, contrast: 0.95f, shadow: 40, maxHeight: win.Y * 0.84f) { Where = Window.Middle };
    }

    private Sheet? WriteBoard()
    {
        var sh = BoardSheet();
        var p = GameState.I.Payload;
        if (p == null)
        {
            sh.Text("[b]Work[/b]", Face.Hand, 26, bottom: 8);
            sh.Text("The board is bare. Nobody has come by yet.", Face.Print, 16);
            return sh;
        }
        var open = p.Jobs.Where(j => j.Status == "offered").ToList();
        if (p.Board.State == "writing" && open.Count == 0)
        {
            sh.Text("[b]Work[/b]", Face.Hand, 26, bottom: 8);
            sh.Text("A clerk is chalking up new work. Wait a moment.", Face.Print, 16);
            return sh;
        }
        sh.Text("[b]Work — Rijnkaai[/b]", Face.Hand, 26, bottom: 8);
        if (!open.Any(j => j.Source != "night")) sh.Text("No more work today. New work goes up at midnight.", Face.Print, 16, bottom: 8);
        int i = 0;
        foreach (var j in VisibleJobs())
        {
            i++;
            bool playable = Playable(j);
            bool can = j.Status == "offered" && playable;
            string tag = j.Status == "taken" ? "yours" : j.Status == "done" ? "done" : j.Status == "failed" ? "failed" : !playable ? "not in this build yet" : "";
            JobRow(sh, i, j, can, can ? 1 : 0.45f,
                $"{Css.Esc(j.EmployerName)} · {Css.Esc(Summary(j))} · risk {Css.Esc(j.Risk)}{(tag != "" ? $" · [b]{tag}[/b]" : "")}",
                Css.Esc(j.Pitch));
        }
        sh.Keys("Press a number to take a job · E or Esc to step back", Face.Hand, top: 8, bottom: 0);
        return sh;
    }

    /// <summary>One job on the board or in the book: the number, the title and the pay; who and what under it; a paragraph.</summary>
    private static void JobRow(Sheet sh, int n, Job j, bool click, float opacity, string who, params string[] more)
    {
        sh.Rule(top: 0, bottom: 0);
        var col = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, Modulate = new Color(1, 1, 1, opacity) };
        col.AddThemeConstantOverride("separation", 0);
        sh.Row(n, Css.Esc(j.Title), $"{j.PayC} c", Face.Hand, 18, padY: 0, gap: 10, into: col, click: click);
        // .who and .pitch stand 22 px in, under the title
        float w = sh.Inner - sh.Sp(22);
        var under = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        under.AddThemeConstantOverride("separation", 0);
        sh.Text(who, Face.Hand, 13, 0.85f, top: 1, bottom: 2, width: w, into: under);
        foreach (string text in more)
            if (text != "")
                sh.Text(text, Face.Print, 15, lineHeight: 1.4f, width: w, into: under);
        col.AddChild(sh.Margin(under, 0, 0, 22));
        sh.Add(sh.Margin(col, 7, 7));
    }

    private void BoardKey(string code, string key)
    {
        if (code is "KeyE" or "Escape")
        {
            board.Close();
            return;
        }
        int n = Dialogs.Digit(key);
        if (n < 1) return;
        var list = VisibleJobs();
        if (n > list.Count || list[n - 1].Status != "offered") return;
        _ = TakeJob(list[n - 1]);
    }

    /// <summary>Take a job, from the board, from the person who offers it or from the paper.</summary>
    public async Task TakeJob(Job j)
    {
        if (taking) return; // the first ask is still on its way (a second key press, the board and the talk window)
        if (!Playable(j))
        {
            Toast("That work is not in this build yet.");
            return;
        }
        // T4 the quest book: up to three jobs in hand
        if (InHand().Count >= MaxInHand)
        {
            Toast("You have your hands full already. Finish or give up a job first (J, your book).");
            return;
        }
        if (active == null && Goods.I.Carried != null)
        {
            Toast("Your hands are full. Set that down first.");
            return;
        }
        var api = ServerLink.I?.Api;
        if (api == null) return;
        taking = true;
        try
        {
            var r = await api.Take(j.Id);
            board.Close();
            // the first job is followed at once; another goes into the book (J to follow it)
            if (active == null) Follow(r.Job);
            else if (active.Id != r.Job.Id) Toast($"In your book: {r.Job.Title}. J to follow it.");
            GameState.I.Apply(await api.Jobs());
        }
        catch (ApiException e)
        {
            // the server's words, as a sentence ("Too late for that one: ...")
            string m = e.Message;
            Toast($"{RunWords.Cap(m)}{(m.EndsWith('.') || m.EndsWith('!') || m.EndsWith('?') ? "" : ".")}");
        }
        finally
        {
            taking = false;
        }
    }

    // ------------------------------------------------------------------ T4 the quest book (J)

    public void OpenBook()
    {
        giveUpAsk = null;
        book.Open();
    }

    /// <summary>Where a job is to be done, in words and as a point (for the book, the task card and the map).</summary>
    private static (string Label, float X, float Z)? GoalOf(Job j)
    {
        var t = JobTask.Of(j);
        var s = Spots.Get(t?.Kind == "watch" ? t.Post : t?.To);
        if (s != null) return (s.Label, s.X, s.Z);
        return Folk.At(j.EmployerNpc) is { } at ? (Folk.NameOf(j.EmployerNpc, j.EmployerName), at.X, at.Z) : null;
    }

    private Sheet? WriteBook()
    {
        var sh = BoardSheet();
        var list = InHand();
        if (list.Count == 0)
        {
            sh.Text("[b]Your book[/b]", Face.Hand, 26, bottom: 8);
            sh.Text("No work in hand. The hiring board on the Rijnkaai, or a word with someone who has work.", Face.Print, 16);
            sh.Keys("J or Esc to close", Face.Hand, top: 8, bottom: 0);
            return sh;
        }
        sh.Text($"[b]Your book — {list.Count} of {MaxInHand} jobs[/b]", Face.Hand, 26, bottom: 8);
        for (int i = 0; i < list.Count; i++)
        {
            var j = list[i];
            var g = GoalOf(j);
            bool followed = active?.Id == j.Id;
            string where = g != null ? $" · to {Css.Esc(g.Value.Label)}, {Metres(RunWords.Dist(g.Value.X, g.Value.Z, Jef.I.X, Jef.I.Z))}" : "";
            string twist = JobTask.Of(j)?.Twist ?? "";
            JobRow(sh, i + 1, j, true, followed ? 1 : 0.45f,
                $"{Css.Esc(j.EmployerName)} · {Css.Esc(Summary(j))}{where}{(followed ? " · [b]followed[/b]" : "")}",
                KnownTwists.TryGetValue(twist, out var known) ? $"You know: {known}" : "",
                giveUpAsk == j.Id ? $"[b]Give it up? G again: no pay, and {Css.Esc(j.EmployerName)} thinks less of you.[/b]" : "");
        }
        sh.Keys("A number follows that job · G then G gives up the one asked · M the map · J or Esc to close", Face.Hand, top: 8, bottom: 0);
        return sh;
    }

    private void BookKey(string code, string key)
    {
        if (code is "Escape" or "KeyJ")
        {
            book.Close();
            return;
        }
        var list = InHand();
        int n = Dialogs.Digit(key);
        if (n >= 1 && n <= list.Count)
        {
            giveUpAsk = null;
            if (JobTask.Of(list[n - 1]) == null) Toast("That work has its own way: it needs no following.");
            else
            {
                Follow(list[n - 1]);
                Toast($"Following: {list[n - 1].Title}.");
            }
            book.Render();
            return;
        }
        if (code == "KeyG")
        {
            var j = active ?? list.FirstOrDefault();
            if (j == null) return;
            if (giveUpAsk == j.Id)
            {
                giveUpAsk = null;
                _ = GiveUp(j);
            }
            else giveUpAsk = j.Id;
            book.Render();
            return;
        }
        if (code == "KeyM")
        {
            book.Close();
            TownMap.I?.Toggle();
        }
    }

    /// <summary>Give up a job in hand: settled with nothing done (no pay; the employer's trust, as the engine rules).</summary>
    private async Task GiveUp(Job j)
    {
        var api = ServerLink.I?.Api;
        if (api == null) return;
        try
        {
            await api.GiveUp(j.Id);
            if (active?.Id == j.Id) DropRun();
            else Goods.I.ClearJob(j.Id);
            Toast($"You gave up \"{j.Title}\". {j.EmployerName} will remember.");
            GameState.I.Apply(await api.Jobs());
        }
        catch (ApiException)
        {
            Toast("That did not go through. Try again.");
        }
    }

    // ------------------------------------------------------------------ the running job

    /// <summary>Follow this job: its run starts (the other job's run is set aside, its goods where they are).</summary>
    private void Follow(Job job)
    {
        if (active?.Id == job.Id) return;
        if (active != null)
        {
            run?.Dispose(true);
            run = null;
            active = null;
        }
        followId = job.Id;
        Start(job);
    }

    private void Start(Job job)
    {
        // the push message and the reply can both bring the same job
        if (job.Task == null || active != null) return;
        var t = JobTask.Of(job);
        if (t == null) return; // a kind with a part of its own (letters, mill, lamps)
        active = job;
        var ctx = new RunCtx
        {
            Toast = Toast,
            Sfx = Sound,
            Progress = p =>
            {
                var api = ServerLink.I?.Api;
                api?.Run(api.Progress(job.Id, p), _ => { });
            },
            Finish = r => Finish(job, r),
            ThickFog = on => Daylight.I?.SetThickFog(on),
        };
        // the job line first; a twist may say something right after
        string who = Folk.NameOf(job.EmployerNpc, job.EmployerName);
        var g = GoodsRules.Of(t.Goods);
        if (t.Kind == "carry")
        {
            string from = t.From == "ship_gangway" ? "the Anna Maria (call up at the gangway)" : Spots.Label(t.From);
            Toast($"{who}: {(t.Count == 1 ? $"a {g.One}" : $"{t.Count} {t.Goods}")} from {from} to {Spots.Label(t.To)}.");
        }
        if (t.Kind == "deliver") Toast($"{who} has a {g.One} for {t.Recipient}. Get it from {who}.");
        run = t.Kind == "watch" ? new WatchRun(job, t, ctx) : new HaulRun(job, t, ctx);
    }

    /// <summary>Stop the running job without settling it (the server already closed it).</summary>
    private void DropRun()
    {
        run?.Dispose();
        run = null;
        active = null;
        if (Goods.I.Carried == null) Jef.I.SpeedFactor = 1;
    }

    private void Finish(Job job, Report report)
    {
        if (finishing) return;
        var api = ServerLink.I?.Api;
        if (api == null) return;
        finishing = true;
        void End()
        {
            finishing = false;
            run?.Dispose();
            run = null;
            active = null;
            api.Run(api.Jobs(), GameState.I.Apply);
        }
        api.Run(api.Done(job.Id, report), r =>
        {
            LastDone = r;
            var s = r.Settlement;
            var parts = new List<string> { s.PayC > 0 ? $"{job.EmployerName} pays {s.PayC} c" : $"{job.EmployerName} pays nothing" };
            // (a sale, a bribe, a tip, or the pockets filled from a broken load)
            if (s.ExtraC != 0) parts.Add($"and {s.ExtraC} c on the side");
            string trust = s.TrustDelta == 0 ? "" : $" {job.EmployerName} trusts you {(s.TrustDelta > 0 ? "more" : "less")} ({s.TrustDelta:+0.##;-0.##}).";
            Toast(string.Join(", ", parts) + "." + trust);
            Sound("coins");
            GameState.I.SetMoney(r.MoneyC);
            End();
        }, e =>
        {
            Toast($"Not settled: {e.Message}");
            End();
        });
    }

    // ------------------------------------------------------------------ the map (jobs.ts mapMarks)

    private IEnumerable<MapMark> MapMarks()
    {
        var o = new List<MapMark>();
        var goal = run?.Goal();
        Spot? end = null;
        if (goal != null && active != null)
        {
            // named as the task card names the step now ("Fetch the crate at the pier head")
            var lines = run!.Hud();
            string step = lines.Count > 1 && lines[1].Length <= 60 ? lines[1] : active.Title;
            o.Add(new MapMark(goal.Value.X, goal.Value.Z, step, "goal", $"{active.Title}, for {active.EmployerName}"));
            var t = JobTask.Of(active);
            end = Spots.Get(t?.Kind == "watch" ? null : t?.To);
            if (end != null && RunWords.Dist(goal.Value.X, goal.Value.Z, end.X, end.Z) >= 4) o.Add(new MapMark(end.X, end.Z, $"then: {end.Label}", "goal", $"where {active.Title} ends"));
        }
        // T4: the other jobs in hand, numbered as in the book
        var list = InHand();
        for (int i = 0; i < list.Count; i++)
        {
            if (list[i].Id == active?.Id) continue;
            if (GoalOf(list[i]) is { } g) o.Add(new MapMark(g.X, g.Z, $"{i + 1}: {list[i].Title}", "goal", $"for {list[i].EmployerName}; J to follow it"));
        }
        return o;
    }

    // ------------------------------------------------------------------ the small papers: task card, note, tick

    private Sheet? taskCard, note;
    private Label tickDist = null!;
    private Tick tick = null!;
    private Control? ui;
    private double noteLeft;
    private OutcomeMsg? noteMsg;
    private string lastTask = "\u0000";

    private void BuildUi()
    {
        ui?.QueueFree();
        ui = new Control { Name = "Jobs", MouseFilter = Control.MouseFilterEnum.Ignore };
        ui.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(ui);
        float s = Css.Ui(GetViewport().GetVisibleRect().Size.X);
        taskCard = null;
        note = null;
        lastTask = "\u0000";
        if (noteMsg != null && noteLeft > 0) WriteNote(noteMsg);

        // .tick: the ink arrow at the top edge, the metres under it
        int Px(float css) => Mathf.RoundToInt(css * s);
        tick = new Tick { MouseFilter = Control.MouseFilterEnum.Ignore, Size = new Vector2(Px(34), Px(22)) };
        tickDist = new Label
        {
            LabelSettings = new LabelSettings { Font = Fonts.Hand, FontSize = Px(14), FontColor = new Color("e8d8b0"), ShadowColor = new Color(0, 0, 0, 0.85f), ShadowSize = Px(4), ShadowOffset = Vector2.Zero },
            MouseFilter = Control.MouseFilterEnum.Ignore,
            HorizontalAlignment = HorizontalAlignment.Center,
            Size = new Vector2(Px(120), Px(18)),
        };
        tick.Modulate = tickDist.Modulate = new Color(1, 1, 1, 0);
        ui.AddChild(tick);
        ui.AddChild(tickDist);
    }

    /// <summary>.task: under the clock in the top left corner, at most 380px wide, padding 8 14, turned 0.8 degrees.</summary>
    private void RenderTask()
    {
        var lines = run?.Hud() ?? new List<string>();
        if (lines.Count > 0 && active?.Source == "night") lines.Add("Done before five, or not at all");
        // T4: one short line a job in hand besides the followed one
        var also = new List<string>();
        foreach (var j in InHand())
        {
            if (j.Id == active?.Id) continue;
            also.Add($"and: {j.Title}{(GoalOf(j) is { } g ? $" – {Metres(RunWords.Dist(g.X, g.Z, Jef.I.X, Jef.I.Z))}" : "")}");
        }
        if (lines.Count == 0 && also.Count > 0) also.Add("J: your book, to follow one");
        string full = string.Join("\n", lines.Concat(also));
        if (full == lastTask) return;
        lastTask = full;
        TaskText = full;
        if (taskCard != null && GodotObject.IsInstanceValid(taskCard.Card)) taskCard.Card.QueueFree();
        taskCard = null;
        if (full == "" || ui == null) return;
        float s = Css.Ui(GetViewport().GetVisibleRect().Size.X);
        // as wide as its longest line, at most the card's 380 px
        float widest = 0;
        for (int i = 0; i < lines.Count; i++) widest = Math.Max(widest, (i == 0 ? Fonts.PrintBold : Fonts.Print).GetStringSize(lines[i], HorizontalAlignment.Left, -1, Mathf.RoundToInt(15 * s)).X);
        foreach (string a in also) widest = Math.Max(widest, Fonts.Print.GetStringSize(a, HorizontalAlignment.Left, -1, Mathf.RoundToInt(12 * s)).X);
        float w = Math.Min(380 * s, widest + 28 * s + 4);
        var sh = new Sheet(s, w, Css.Hex("d8cfb8"), (14, 8, 14, 8), 0.8f, sepia: 0.3f, shadow: 12, drop: 3, shadowAlpha: 0.6f)
        {
            // under the clock's card, whatever its height (Game/Hud.cs)
            Where = (_, _) => Main.I.Ui.GetNodeOrNull<Control>("Hud") is { } hud && hud.GetChildCount() > 0 && hud.GetChild(0) is Control clock ? new Vector2(18, clock.Position.Y + clock.Size.Y + 10 * s) : new Vector2(18, 16 + 60 * s),
        };
        sh.Card.MouseFilter = Control.MouseFilterEnum.Ignore;
        sh.Card.SelfModulate = new Color(1, 1, 1, 0.92f);
        for (int i = 0; i < lines.Count; i++) sh.Text(i == 0 ? $"[b]{Css.Esc(lines[i])}[/b]" : Css.Esc(lines[i]), Face.Print, 15, lineHeight: 1.35f);
        foreach (string a in also) sh.Text(Css.Esc(a), Face.Print, 12, 0.75f, lineHeight: 1.35f);
        taskCard = sh;
        ui.AddChild(sh.Card);
        sh.Place();
    }

    /// <summary>.note: the employer's word on how it went, bottom 9%, at most min(560px, 80vw), padding 10 18, turned 0.6 degrees.</summary>
    private void ShowOutcome(OutcomeMsg o)
    {
        noteMsg = o;
        noteLeft = NoteSeconds;
        WriteNote(o);
    }

    private void WriteNote(OutcomeMsg o)
    {
        DropNote(false);
        if (ui == null) return;
        var win = GetViewport().GetVisibleRect().Size;
        float s = Css.Ui(win.X);
        float widest = Fonts.Print.GetStringSize(o.Text, HorizontalAlignment.Left, -1, Mathf.RoundToInt(15 * s)).X + 36 * s + 4;
        var sh = new Sheet(s, Math.Min(Math.Min(560 * s, win.X * 0.8f), widest), Css.Hex("d4cab0"), (18, 10, 18, 10), 0.6f, sepia: 0.35f, shadow: 24, drop: 6, shadowAlpha: 0.7f)
        {
            Where = (v, size) => new Vector2((v.X - size.X) / 2, v.Y * 0.91f - size.Y),
        };
        sh.Card.MouseFilter = Control.MouseFilterEnum.Ignore;
        // Drawn after the HUD, underneath the dialog layer: a paid job must not cover someone's talk.
        sh.Text(Css.Esc(o.Employer), Face.Hand, 12, 0.7f, bottom: 2);
        sh.Text(Css.Esc(o.Text), Face.Print, 15, lineHeight: 1.4f);
        note = sh;
        ui.AddChild(sh.Card);
        sh.Place();
    }

    private void DropNote(bool forget = true)
    {
        if (note != null && GodotObject.IsInstanceValid(note.Card)) note.Card.QueueFree();
        note = null;
        if (forget) noteMsg = null;
    }

    // ------------------------------------------------------------------ the pointer: a faint warm glow at the goal, an ink tick at the top edge

    private MeshInstance3D? glow;
    private StandardMaterial3D? glowMat;
    private OmniLight3D? glowLight;
    private double pulse;

    private void MakeGlow()
    {
        // world/textures.ts glowTexture: warm in the middle, gone at the rim
        var grad = new Gradient { Offsets = new[] { 0f, 0.12f, 0.35f, 0.7f, 1f }, Colors = new[] { new Color(1, 0.91f, 0.71f, 1), new Color(1, 0.78f, 0.47f, 0.75f), new Color(1, 0.63f, 0.27f, 0.22f), new Color(1, 0.55f, 0.24f, 0.05f), new Color(1, 0.55f, 0.24f, 0) } };
        var tex = new GradientTexture2D { Gradient = grad, Fill = GradientTexture2D.FillEnum.Radial, FillFrom = new Vector2(0.5f, 0.5f), FillTo = new Vector2(1, 0.5f), Width = 64, Height = 64 };
        glowMat = new StandardMaterial3D
        {
            AlbedoTexture = tex,
            AlbedoColor = new Color("ffc080", 0),
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            BlendMode = BaseMaterial3D.BlendModeEnum.Add,
            BillboardMode = BaseMaterial3D.BillboardModeEnum.Enabled,
            DepthDrawMode = BaseMaterial3D.DepthDrawModeEnum.Disabled,
            DisableFog = true,
        };
        glow = new MeshInstance3D { Name = "job_glow", Mesh = new QuadMesh { Size = new Vector2(1.1f, 1.1f), Material = glowMat }, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        Main.I.View.AddChild(glow);
        // always in the scene, dimmed with energy 0 (docs/rendering.md: light counts never change at run time)
        glowLight = new OmniLight3D { Name = "job_glow_light", LightColor = new Color("ffb060"), LightEnergy = 0, OmniRange = 5, ShadowEnabled = false };
        Main.I.View.AddChild(glowLight);
    }

    private void UpdatePointer(float dt)
    {
        if (glow == null) MakeGlow();
        var goal = active != null ? run?.Goal() : null;
        var jef = Jef.I;
        if (goal == null || jef == null)
        {
            glowMat!.AlbedoColor = new Color(glowMat.AlbedoColor, 0);
            glowLight!.LightEnergy = 0;
            tick.Modulate = tickDist.Modulate = new Color(1, 1, 1, Mathf.MoveToward(tick.Modulate.A, 0, dt / 0.6f));
            return;
        }
        var g = goal.Value;
        float d = RunWords.Dist(g.X, g.Z, jef.X, jef.Z);
        pulse += dt;
        // the glow hangs just above the goal; it fades out when you are there
        float near = Mathf.SmoothStep(1.5f, 4, d);
        glow!.Position = new Vector3(g.X, g.Y + 1.1f + MathF.Sin((float)pulse * 1.3f) * 0.05f, g.Z);
        glowMat!.AlbedoColor = new Color(glowMat.AlbedoColor, 0.35f * near * (0.85f + MathF.Sin((float)pulse * 2.1f) * 0.15f));
        glowLight!.Position = new Vector3(g.X, g.Y + 1.2f, g.Z);
        glowLight.LightEnergy = 2.5f / MathF.PI * near;

        // the ink tick slides along the top edge toward the goal, only when it is far or off screen
        float ang = MathF.Atan2(g.X - jef.X, g.Z - jef.Z) - MathF.Atan2(-MathF.Sin(jef.Yaw), -MathF.Cos(jef.Yaw));
        float a = MathF.Atan2(MathF.Sin(ang), MathF.Cos(ang)); // -pi..pi, + is to the left
        float x = Math.Clamp(-a / (MathF.PI / 2), -1, 1);
        var win = GetViewport().GetVisibleRect().Size;
        float left = win.X * (0.5f + x * 0.42f);
        // Keep the top-edge pointer outside the top-left paper column, including its distance label.
        float paperRight = 0;
        if (Main.I.Ui.GetNodeOrNull<Control>("Hud") is { } hud && hud.GetChildCount() > 0 && hud.GetChild(0) is Control clock)
            paperRight = clock.Position.X + clock.Size.X;
        if (taskCard != null) paperRight = Math.Max(paperRight, taskCard.Card.Position.X + taskCard.Card.Size.X);
        left = Math.Clamp(left, Math.Min(win.X / 2, paperRight + tickDist.Size.X / 2 + 12), win.X * 0.92f);
        tick.Position = new Vector2(left - tick.Size.X / 2, 4);
        tick.Turn = MathF.Abs(a) > MathF.PI / 2 ? (a > 0 ? 90 : -90) : 0;
        tickDist.Position = new Vector2(left - tickDist.Size.X / 2, 4 + tick.Size.Y - 2);
        string words = Metres(d);
        if (tickDist.Text != words) tickDist.Text = words;
        bool windowUp = Dialogs.I is { Any: true };
        float want = d > 6 && !windowUp ? 0.55f + 0.25f * Math.Min(1, MathF.Abs(a)) : 0;
        tick.Modulate = tickDist.Modulate = new Color(1, 1, 1, Mathf.MoveToward(tick.Modulate.A, want, dt / 0.6f));
    }

    /// <summary>map.ts metres: a distance in round metres.</summary>
    public static string Metres(float d) => $"{(d < 100 ? Math.Max(5, (int)MathF.Round(d / 5) * 5) : (int)MathF.Round(d / 10) * 10)} m";
}
