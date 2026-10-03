using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// The hands and the job (game/jobs.ts). Everything Jef does with E and F at goods and at work goes through here:
/// lift, set down, stack, drop in the Schelde, read the board, take a job, and the job's own keys. The server
/// decides pay, task and trust; this shows them: the board's paper, the task card under the clock, the faint glow
/// at the goal with the ink tick at the top edge, the line when a job is paid, the employer's note.
///
/// Not here yet (they wait for their parts): the quest book (J, three jobs in hand: the first taken is followed),
/// the employers' boxes at night, the handcart, the dockers' piles by the piece, the twists' people.
/// Hooks: `Jobs.I.Sfx` (the sound part: "lift", "thud_wood", "thud_soft", "thud_plank", "splash", "bell",
/// "coins", at a place or null), `Jobs.I.ThickFog` (the sky part), Folk.* (the people and the talk window).
/// </summary>
[GamePart(66)]
public partial class Jobs : Node
{
    public static Jobs I { get; private set; } = null!;

    private const float ReachBoard = 2.6f;
    private const float OwnerSees = 12;
    private const double NoteSeconds = 11;

    /// <summary>An event sound, at a place or (null) at Jef. Set by the sound part.</summary>
    public Action<string, Vector3?>? Sfx;
    /// <summary>A job's thick fog on or off. Set by the sky part.</summary>
    public Action<bool>? ThickFog;

    private Job? active;
    private JobTask? activeTask;
    private IRun? run;
    private bool finishing, taking;
    /// <summary>An owner saw Jef lift this; set back near where it was, they calm down.</summary>
    private (Item Item, string Owner)? watched;
    private readonly List<(Node3D Obj, float T, bool Splashed)> sinking = new();

    public Job? Active => active;
    public IRun? Run => run;
    public bool BoardOpen { get; private set; }
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

    public Jobs()
    {
        I = this;
    }

    public override void _Ready()
    {
        var st = GameState.I;
        st.Changed += Apply;
        Interact.I.AddProvider(Keys);
        Interact.I.Shut.Add(() => BoardOpen || (Folk.TalkOpen?.Invoke() ?? false));
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
        BuildUi();
        GetViewport().SizeChanged += BuildUi;
        if (st.Payload != null) Apply(st.Payload);
    }

    private void Toast(string text) => GameState.I.Say(text);
    private void Sound(string name, Vector3? at = null) => Sfx?.Invoke(name, at);

    // ------------------------------------------------------------------ server data (jobs.ts apply)

    private void Apply(JobsPayload p)
    {
        var inHand = p.Jobs.Where(j => j.Status == "taken").ToList();
        var taken = (active != null ? inHand.FirstOrDefault(j => j.Id == active.Id) : null) ?? inHand.FirstOrDefault();
        if (taken != null && active == null && !finishing) Start(taken);
        // the job ended on the server without us (its deadline, a gang, the cell): drop it here too
        if (active != null && !finishing && taken?.Id != active.Id)
        {
            var a = active;
            if (a.Source == "night" && p.Clock.Hour >= 5 && p.Clock.Hour < 21) Toast($"Five o'clock: {a.EmployerName} is gone, and \"{a.Title}\" with him. Not done, not paid.");
            DropRun();
            var next = inHand.FirstOrDefault(j => j.Id != a.Id);
            if (next != null) Start(next);
        }
        if (BoardOpen) RenderBoard();
    }

    // ------------------------------------------------------------------ per frame

    public override void _Process(double delta)
    {
        float dt = (float)Math.Min(delta, 0.1);
        if (GameState.I.Playing || Jef.I.TestInput) run?.Update(dt);
        UpdateSinking(dt);
        RenderTask();
        UpdatePointer(dt);
        if (noteLeft > 0 && (noteLeft -= delta) <= 0) note.Visible = false;
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
                    string label = run?.PlaceLabel(carried, px, pz) ?? (where == "stack" ? "stack it" : "set it down");
                    only.Add(Act.Me(Key.E, label, () => PutDown(px, pz)));
                }
            }
            return new Offers { Only = only };
        }
        var o = new Offers { First = run?.Actions(), Options = new List<(float, Act)>(), Extra = new List<Act>() };
        // (another player's job goods are his: not offered to lift; anyone's own goods are, as ever)
        var item = goods.Nearest(Goods.ReachItem, it => !it.CartOnly && (it.JobId == null || it.JobId == active?.Id));
        if (item != null)
        {
            float d = RunWords.Dist(item.X, item.Z, x, z);
            o.Options.Add((d, Act.At(Key.E, $"lift the {GoodsRules.Of(item.Kind).One}", goods.Middle(item), () => Lift(item))));
        }
        // the Rijnkaai's people: the talk window is the talk part's
        if (Folk.OpenTalk != null)
            foreach (string id in Folk.Talkers)
            {
                var at = Folk.At(id);
                if (at == null) continue;
                float d = Folk.Dist(id, x, z);
                if (d >= 2.6f) continue;
                string who = id, name = Folk.NameOf(id);
                o.Options.Add((d, Act.At(Key.E, $"talk to {name}", at.Value + new Vector3(0, 1.3f, 0), () => Folk.OpenTalk(who, name))));
                if (Folk.OpenShop != null && id is "peeters" or "tuur" or "fientje") o.Extra.Add(Act.At(Key.F, $"buy from {name}", at.Value + new Vector3(0, 1.3f, 0), () => Folk.OpenShop(who, name)));
            }
        var (bx, bz) = Spots.Board;
        float board = RunWords.Dist(bx, bz, x, z);
        if (board < ReachBoard) o.Options.Add((board, Act.At(Key.E, "read the hiring board", new Vector3(bx, 1.55f, bz), OpenBoard)));
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

    // ------------------------------------------------------------------ the board

    private PanelContainer boardCard = null!;
    private VBoxContainer boardBody = null!;
    private Control boardClip = null!;

    private void OpenBoard()
    {
        BoardOpen = true;
        Jef.I.Frozen = true;
        boardCard.Visible = true;
        RenderBoard();
    }

    public void CloseBoard()
    {
        if (!BoardOpen) return;
        BoardOpen = false;
        Jef.I.Frozen = false;
        boardCard.Visible = false;
    }

    /// <summary>Open work and your job, plus the last two finished ones. Number keys index this list.</summary>
    public List<Job> VisibleJobs()
    {
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

    /// <summary>The kinds of work this build plays (carry, watch, deliver by hand).</summary>
    private static bool Playable(Job j) => j.Playable && JobTask.Of(j) is { Cart: false };

    private void RenderBoard()
    {
        FillBoard();
        // .board: max-height 84vh, overflow hidden: a long board is cut at the bottom, never off the top of the screen
        var size = boardBody.GetCombinedMinimumSize();
        boardBody.Size = size;
        float max = GetViewport().GetVisibleRect().Size.Y * 0.84f - Paper.Px(30);
        boardClip.CustomMinimumSize = new Vector2(size.X, Math.Min(size.Y, max));
        boardCard.ResetSize();
    }

    private void FillBoard()
    {
        foreach (var c in boardBody.GetChildren())
        {
            boardBody.RemoveChild(c);
            c.QueueFree();
        }
        float cw = boardBody.CustomMinimumSize.X;
        var p = GameState.I.Payload;
        void Note(string text) => boardBody.AddChild(Wide(Paper.Text(text, Fonts.Print, 16, 1, true), cw));
        if (p == null)
        {
            boardBody.AddChild(Paper.Text("Work", Fonts.Hand, 26));
            Note("The board is bare. Nobody has come by yet.");
            return;
        }
        var open = p.Jobs.Where(j => j.Status == "offered").ToList();
        if (p.Board.State == "writing" && open.Count == 0)
        {
            boardBody.AddChild(Paper.Text("Work", Fonts.Hand, 26));
            Note("A clerk is chalking up new work. Wait a moment.");
            return;
        }
        boardBody.AddChild(Paper.Text("Work — Rijnkaai", Fonts.Hand, 26));
        if (!open.Any(j => j.Source != "night")) Note("No more work today. New work goes up at midnight.");
        int i = 0;
        foreach (var j in VisibleJobs())
        {
            i++;
            bool playable = Playable(j);
            float alpha = j.Status != "offered" || !playable ? 0.45f : 1;
            string tag = j.Status == "taken" ? "yours" : j.Status == "done" ? "done" : j.Status == "failed" ? "failed" : !playable ? "not in this build yet" : "";
            boardBody.AddChild(new Dashes());
            var row = Paper.Column(Paper.Px(1));
            row.Modulate = new Color(1, 1, 1, alpha);
            var head = Paper.Row(10);
            head.AddChild(Paper.Text(i.ToString(), Fonts.HandBold, 18));
            var title = Paper.Text(j.Title, Fonts.Hand, 18);
            title.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
            head.AddChild(title);
            head.AddChild(Paper.Text($"{j.PayC} c", Fonts.HandBold, 18));
            row.AddChild(head);
            var who = Indent(Wide(Paper.Text($"{j.EmployerName} · {Summary(j)} · risk {j.Risk}{(tag != "" ? $" · {tag}" : "")}", Fonts.Hand, 13, 0.85f, true), cw - Paper.Px(22)));
            row.AddChild(who);
            row.AddChild(Indent(Wide(Paper.Text(j.Pitch, Fonts.Print, 15, 1, true), cw - Paper.Px(22))));
            var pad = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
            pad.AddThemeConstantOverride("margin_top", Paper.Px(6));
            pad.AddThemeConstantOverride("margin_bottom", Paper.Px(6));
            pad.AddChild(row);
            boardBody.AddChild(pad);
        }
        boardBody.AddChild(new Dashes());
        boardBody.AddChild(Paper.Text("Press a number to take a job · E or Esc to step back", Fonts.Hand, 14, 0.9f, false, HorizontalAlignment.Right));
    }

    /// <summary>A line that wraps needs its width said, or it is laid out one letter wide.</summary>
    private static Label Wide(Label l, float width)
    {
        l.CustomMinimumSize = new Vector2(width, 0);
        return l;
    }

    private static Control Indent(Control c)
    {
        var m = new MarginContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        m.AddThemeConstantOverride("margin_left", Paper.Px(22));
        m.AddChild(c);
        return m;
    }

    /// <summary>A key while the board is up (the checks press it too): a number takes that job, E or Esc steps back.</summary>
    public void BoardKey(Key k)
    {
        if (!BoardOpen) return;
        if (k is Key.E or Key.Escape)
        {
            CloseBoard();
            return;
        }
        int n = k >= Key.Key1 && k <= Key.Key9 ? (int)(k - Key.Key0) : k >= Key.Kp1 && k <= Key.Kp9 ? (int)(k - Key.Kp0) : 0;
        if (n < 1) return;
        var list = VisibleJobs();
        if (n > list.Count || list[n - 1].Status != "offered") return;
        TakeJob(list[n - 1]);
    }

    public override void _UnhandledInput(InputEvent e)
    {
        if (!BoardOpen || Jef.I.TestInput || e is not InputEventKey { Pressed: true, Echo: false } k) return;
        BoardKey(k.PhysicalKeycode is Key.E or Key.Escape ? k.PhysicalKeycode : k.Keycode);
        GetViewport().SetInputAsHandled();
    }

    /// <summary>Take a job, from the board or from the person who offers it.</summary>
    public void TakeJob(Job j)
    {
        if (taking) return;
        if (!Playable(j))
        {
            Toast("That work is not in this build yet.");
            return;
        }
        if (active != null)
        {
            Toast("You have your hands full already. Finish or give up a job first.");
            return;
        }
        if (Goods.I.Carried != null)
        {
            Toast("Your hands are full. Set that down first.");
            return;
        }
        var api = ServerLink.I?.Api;
        if (api == null) return;
        taking = true;
        api.Run(api.Take(j.Id), r =>
        {
            taking = false;
            CloseBoard();
            if (active == null) Start(r.Job);
            api.Run(api.Jobs(), GameState.I.Apply);
        }, e =>
        {
            taking = false;
            // the server's words, as a sentence ("Too late for that one: ...")
            string m = e.Message;
            Toast($"{RunWords.Cap(m)}{(m.EndsWith('.') || m.EndsWith('!') || m.EndsWith('?') ? "" : ".")}");
        });
    }

    // ------------------------------------------------------------------ the running job

    private void Start(Job job)
    {
        // the push message and the reply can both bring the same job
        if (job.Task == null || active != null) return;
        var t = JobTask.Of(job);
        if (t == null) return; // a kind with a part of its own (letters, mill, lamps)
        active = job;
        activeTask = t;
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
            ThickFog = on => ThickFog?.Invoke(on),
        };
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
        activeTask = null;
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
            activeTask = null;
            api.Run(api.Jobs(), GameState.I.Apply);
        }
        api.Run(api.Done(job.Id, report), r =>
        {
            LastDone = r;
            var s = r.Settlement;
            var parts = new List<string> { s.PayC > 0 ? $"{job.EmployerName} pays {s.PayC} c" : $"{job.EmployerName} pays nothing" };
            // (a sale, a bribe, a tip, or the pockets filled from a broken load)
            if (s.ExtraC != 0) parts.Add($"and {s.ExtraC} c on the side");
            Toast(string.Join(", ", parts) + ".");
            Sound("coins");
            GameState.I.SetMoney(r.MoneyC);
            End();
        }, e =>
        {
            Toast($"Not settled: {e.Message}");
            End();
        });
    }

    // ------------------------------------------------------------------ the papers: board, task card, note, tick

    private PanelContainer taskCard = null!, note = null!;
    private VBoxContainer taskBody = null!;
    private Label noteWho = null!, noteText = null!, tickDist = null!;
    private Tick tick = null!;
    private Control? ui;
    private double noteLeft;
    private string lastTask = "\u0000";

    private void BuildUi()
    {
        bool wasOpen = BoardOpen;
        ui?.QueueFree();
        // (over the HUD's cards: the board and the employer's note lie on top of them)
        ui = new Control { Name = "Jobs", MouseFilter = Control.MouseFilterEnum.Ignore, ZIndex = 20 };
        ui.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(ui);
        var win = GetViewport().GetVisibleRect().Size;
        float s = Paper.UiNow;

        // .task: under the clock, top left
        taskCard = Paper.Make(new Color(Paper.Card, 0.92f), 14, 8, 8, 0.8f, 12, 3);
        taskBody = Paper.Column();
        taskBody.CustomMinimumSize = new Vector2(0, 0);
        taskCard.AddChild(taskBody);
        taskCard.Visible = false;
        ui.AddChild(taskCard);
        lastTask = "\u0000";

        // .board: the middle of the screen, min(720px, 86vw)
        boardCard = Paper.Make(Paper.Sheet, 28, 18, 12, -0.6f, 40, 8);
        float w = Math.Min(720 * s, win.X * 0.86f);
        boardBody = Paper.Column(Paper.Px(2));
        boardBody.CustomMinimumSize = new Vector2(w - Paper.Px(56), 0);
        boardClip = new Control { ClipContents = true, MouseFilter = Control.MouseFilterEnum.Ignore };
        boardClip.AddChild(boardBody);
        boardCard.AddChild(boardClip);
        Paper.Centre(boardCard);
        boardCard.Visible = false;
        ui.AddChild(boardCard);

        // .note: the employer's word on how it went, bottom 9%
        note = Paper.Make(Paper.Sheet, 18, 10, 10, 0.6f, 24, 6);
        var nb = Paper.Column();
        noteWho = Paper.Text("", Fonts.Hand, 12, 0.7f);
        noteText = Paper.Text("", Fonts.Print, 15, 1, true);
        noteText.CustomMinimumSize = new Vector2(Math.Min(560 * s, win.X * 0.8f) - Paper.Px(36), 0);
        nb.AddChild(noteWho);
        nb.AddChild(noteText);
        note.AddChild(nb);
        note.Visible = false;
        note.Resized += () => note.Position = new Vector2((GetViewport().GetVisibleRect().Size.X - note.Size.X) / 2, GetViewport().GetVisibleRect().Size.Y * 0.91f - note.Size.Y);
        ui.AddChild(note);

        // .tick: the ink arrow at the top edge, the metres under it
        tick = new Tick { MouseFilter = Control.MouseFilterEnum.Ignore, Size = new Vector2(Paper.Px(34), Paper.Px(22)) };
        tickDist = new Label
        {
            LabelSettings = new LabelSettings { Font = Fonts.Hand, FontSize = Paper.Px(14), FontColor = new Color("e8d8b0"), ShadowColor = new Color(0, 0, 0, 0.85f), ShadowSize = Paper.Px(4), ShadowOffset = Vector2.Zero },
            MouseFilter = Control.MouseFilterEnum.Ignore,
            HorizontalAlignment = HorizontalAlignment.Center,
            Size = new Vector2(Paper.Px(120), Paper.Px(18)),
        };
        tick.Modulate = tickDist.Modulate = new Color(1, 1, 1, 0);
        ui.AddChild(tick);
        ui.AddChild(tickDist);

        if (wasOpen)
        {
            boardCard.Visible = true;
            RenderBoard();
        }
    }

    private void RenderTask()
    {
        var lines = run?.Hud() ?? new List<string>();
        if (lines.Count > 0 && active?.Source == "night") lines.Add("Done before five, or not at all");
        string full = string.Join("\n", lines);
        // under the clock's card, whatever its height (Game/Hud.cs)
        if (taskCard.Visible && Main.I.Ui.GetNodeOrNull<Control>("Hud") is { } hud && hud.GetChildCount() > 0 && hud.GetChild(0) is Control clock)
            taskCard.Position = new Vector2(18, clock.Position.Y + clock.Size.Y + Paper.Px(10));
        if (full == lastTask) return;
        lastTask = full;
        TaskText = full;
        foreach (var c in taskBody.GetChildren())
        {
            taskBody.RemoveChild(c);
            c.QueueFree();
        }
        taskCard.Visible = lines.Count > 0;
        if (lines.Count == 0) return;
        float max = Paper.Px(380 - 28);
        for (int i = 0; i < lines.Count; i++)
        {
            var l = Paper.Text(lines[i], i == 0 ? Fonts.PrintBold : Fonts.Print, 15, 1, true);
            // (a wrapping line needs its width said: the text's own, at most the card's 380 px)
            var font = i == 0 ? Fonts.PrintBold : Fonts.Print;
            l.CustomMinimumSize = new Vector2(Math.Min(max, font.GetStringSize(lines[i], HorizontalAlignment.Left, -1, Paper.Px(15)).X + 2), 0);
            taskBody.AddChild(l);
        }
        taskCard.ResetSize();
    }

    private void ShowOutcome(OutcomeMsg o)
    {
        noteWho.Text = o.Employer;
        noteText.Text = o.Text;
        note.Visible = true;
        note.ResetSize();
        noteLeft = NoteSeconds;
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
        tick.Position = new Vector2(left - tick.Size.X / 2, 4);
        tick.Turn = MathF.Abs(a) > MathF.PI / 2 ? (a > 0 ? 90 : -90) : 0;
        tickDist.Position = new Vector2(left - tickDist.Size.X / 2, 4 + tick.Size.Y - Paper.Px(2));
        string words = Metres(d);
        if (tickDist.Text != words) tickDist.Text = words;
        float want = d > 6 ? 0.55f + 0.25f * Math.Min(1, MathF.Abs(a)) : 0;
        tick.Modulate = tickDist.Modulate = new Color(1, 1, 1, Mathf.MoveToward(tick.Modulate.A, want, dt / 0.6f));
    }

    /// <summary>map.ts metres: a distance in round metres.</summary>
    public static string Metres(float d) => $"{(d < 100 ? Math.Max(5, (int)MathF.Round(d / 5) * 5) : (int)MathF.Round(d / 10) * 10)} m";
}
