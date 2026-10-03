using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// The day's needs by hand (game/day.ts, game/sleep.ts, game/pockets.ts): the pockets (I: eat, drink or read with
/// 1-6), a bed in the doss house and the benches of the town (E, then how long: 1, 2, 4, 8 hours or until
/// morning), the week's rent at the doss house door (F), the sheet after a night that came by itself, the word
/// at midnight, the week's end. The server decides everything: what a herring does, how the needs fall, who is
/// robbed on a bench, when Jef drops where he stands; this asks and shows. (GameState says the warnings when a
/// need runs low; the clock's tick is ServerLink's.) Dead tired, he walks slower (Jef.Fatigue).
///
/// The browser has no pump to drink from (its pumps are the washerwomen's, the fire engine's and a map icon), so
/// none is here. Benches: the Sint-Jansplein, the greens, the Steen and the Stadspark (shared/townplaces.json,
/// client/public/models/park.json); the benches at omnibus stops, on the wall walk and by house doors come with
/// the parts that place them (Day.I.AddBench).
/// </summary>
[GamePart(68)]
public partial class Day : Node
{
    public static Day I { get; private set; } = null!;

    private const float BenchReach = 1.4f; // sleep.ts
    private const float ReachDoss = 2.4f; // jobs.ts
    private const double StepS = 0.35; // a tick every 350 ms while asleep
    private const int MorningHour = 6; // shared/sleep.ts

    public sealed record Bench(string Id, string Label, float X, float Z, float Y, bool Fine);

    private readonly List<Bench> benches = new();
    public IReadOnlyList<Bench> Benches => benches;
    /// <summary>A bench another part places (an omnibus stop, the wall walk, a house door).</summary>
    public void AddBench(Bench b) => benches.Add(b);

    /// <summary>The paper or letter in the pocket is to be read: the press part's reader. Not set: its note is said.</summary>
    public Action<PocketItem>? Read;
    /// <summary>After a night at home Jef wakes in his own room (the homes' part).</summary>
    public Action<string>? WakeHome;

    public bool PocketsOpen { get; private set; }
    /// <summary>The chooser is up, or he is asleep: no other keys.</summary>
    public bool Busy => choosing != null || asleep;
    public bool Asleep => asleep;
    public bool SheetOpen => shown != "";
    /// <summary>What the server last said to a sleep or a wake, for the checks.</summary>
    public RestEnd? LastWoke { get; private set; }
    public string LastError { get; private set; } = "";

    private sealed record Place(string Kind, string Label, string? Bench);
    private Place? choosing;
    private bool asleep, cell, waking;
    private double sinceStep;
    private bool stepBusy;
    private string shown = ""; // "night" or "end"
    private Night? night;
    private double unfreezeIn;

    public Day()
    {
        I = this;
    }

    public override void _Ready()
    {
        LoadBenches();
        var st = GameState.I;
        st.PocketsChanged += () =>
        {
            if (PocketsOpen) RenderPockets();
        };
        st.NeedsChanged += Tired;
        st.NightCame += ShowNight;
        st.DayTurned += Midnight;
        st.Resting += r =>
        {
            // asleep on the server's word (a load in the middle of a sleep, the cell)
            if (!asleep) Sleeping(r);
            else ShowRest(r);
        };
        st.Woke += GetUp;
        st.Changed += p =>
        {
            if (p.Ending != null && shown != "night") ShowEnd(p.Ending);
        };
        Interact.I.AddProvider(Keys);
        Interact.I.Shut.Add(() => PocketsOpen || Busy || SheetOpen);
        // asleep, or with a sheet up, the waking day's clock does not tick (a tick without "asleep" would end the sleep)
        var was = st.PlayingWhen;
        st.PlayingWhen = () => !Busy && !SheetOpen && (was?.Invoke() ?? (Input.MouseMode == Input.MouseModeEnum.Captured && Main.I.Cam is not FlyCam));
        BuildUi();
        GetViewport().SizeChanged += BuildUi;
        Tired();
    }

    private static void Toast(string text) => GameState.I.Say(text);

    /// <summary>day.ts: dead tired, his legs drag.</summary>
    private static void Tired()
    {
        if (Jef.I == null) return;
        double s = GameState.I.Sleep;
        Jef.I.Fatigue = !GameState.I.Live ? 1 : s <= 1 ? 0.6f : s <= 2 ? 0.75f : 1;
    }

    // ------------------------------------------------------------------ the benches (shared/sleep.ts fixedBenches)

    private void LoadBenches()
    {
        string shared = Path.GetDirectoryName(Water.CityJson()) ?? ".";
        string tp = Path.Combine(shared, "townplaces.json");
        if (File.Exists(tp))
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(tp));
            var root = doc.RootElement;
            if (root.TryGetProperty("rond", out var rond))
            {
                string label = rond.GetProperty("label").GetString() ?? "";
                int i = 0;
                foreach (var b in rond.GetProperty("benches").EnumerateArray()) benches.Add(new Bench($"rond:{i++}", $"a bench on {label}", b[0].GetSingle(), b[1].GetSingle(), 0, true));
            }
            if (root.TryGetProperty("greens", out var greens))
                foreach (var g in greens.EnumerateArray())
                {
                    string id = g.GetProperty("id").GetString() ?? "", label = g.GetProperty("label").GetString() ?? "";
                    int i = 0;
                    foreach (var b in g.GetProperty("benches").EnumerateArray()) benches.Add(new Bench($"green:{id}:{i++}", $"a bench on {label}", b[0].GetSingle(), b[1].GetSingle(), 0, id == "lijnwaadmarkt"));
                }
        }
        // shared/sleep.ts STEEN_BENCHES
        benches.Add(new Bench("steen:0", "a bench on the Steen's promontory", -203, -27.5f, 0, false));
        benches.Add(new Bench("steen:1", "a bench on the Steen's promontory", -209.5f, -8.5f, 0, false));
        string park = Path.Combine(shared, "..", "client", "public", "models", "park.json");
        if (File.Exists(park))
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(park));
            if (doc.RootElement.TryGetProperty("benches", out var list))
            {
                int i = 0;
                foreach (var r in list.EnumerateArray())
                {
                    double x = 0, z = 0;
                    int n = 0;
                    foreach (var p in r.EnumerateArray())
                    {
                        x += p[0].GetDouble();
                        z += p[1].GetDouble();
                        n++;
                    }
                    if (n > 0) benches.Add(new Bench($"park:{i}", "a bench in the Stadspark", (float)(Math.Round(x / n * 1000) / 1000), (float)(Math.Round(z / n * 1000) / 1000), 0, true));
                    i++;
                }
            }
        }
    }

    // ------------------------------------------------------------------ the keys

    private Offers? Keys(float x, float z)
    {
        var jef = Jef.I;
        if (Goods.I.Carried != null || jef.Swimming || jef.Climbing) return null;
        var o = new Offers { Options = new List<(float, Act)>(), Extra = new List<Act>() };
        // M7 sleep: E at a bench; no more lying down on the bare street
        Bench? best = null;
        float bd = BenchReach;
        foreach (var b in benches)
        {
            float d = RunWords.Dist(b.X, b.Z, x, z);
            if (d < bd && MathF.Abs(jef.Y - b.Y) <= (b.Y > 1 ? 1.2f : 2.5f)) (best, bd) = (b, d);
        }
        if (best != null)
        {
            var b = best;
            o.Options.Add((bd + 0.2f, Act.At(Key.E, "sleep on the bench", new Vector3(b.X, b.Y + 0.45f, b.Z), () => Choose(new Place("bench", b.Label, b.Id)))));
        }
        // the doss house bed, paid by the week, at any hour and for as long as he chooses
        var (dx, dz) = Spots.Doss;
        float doss = RunWords.Dist(dx, dz, x, z);
        if (doss < ReachDoss)
        {
            var (ax, az) = Spots.DossDoor;
            o.Options.Add((doss, Act.AtGround(Key.E, "sleep in the doss house", ax, az, () => Choose(new Place("doss", "the doss house, Sint-Andries", null)))));
            if (!GameState.I.RentPaid)
            {
                int price = GameState.I.Live ? GameState.I.RentPrice : 150;
                o.Extra.Add(Act.AtGround(Key.F, $"pay the week's rent ({price} c)", ax, az, Rent));
            }
        }
        return o;
    }

    /// <summary>A key for the papers of this part (the checks press it too). True: it was taken.</summary>
    public bool Key_(Key k, Key typed)
    {
        if (shown == "night")
        {
            if (k is Key.E or Key.Enter or Key.Escape) Wake();
            return true;
        }
        if (shown == "end")
        {
            if (k == Key.N && GameState.I.Ending?.Epilogue != null) NewWeek();
            return true;
        }
        if (asleep)
        {
            // any key wakes him (not Esc, not P, not the keys that only hold others)
            if (k is Key.Escape or Key.P or Key.Shift or Key.Ctrl or Key.Alt or Key.Meta) return false;
            if (!cell) WakeNow();
            return true;
        }
        if (choosing != null)
        {
            if (k is Key.E or Key.Escape) CloseChooser();
            int n = Digit(typed);
            if (n >= 1 && n <= 4) LieDown(new[] { 1, 2, 4, 8 }[n - 1]);
            else if (n == 5) LieDown("morning");
            return true;
        }
        if (PocketsOpen)
        {
            if (k is Key.I or Key.Escape) ClosePockets();
            int n = Digit(typed);
            if (n >= 1 && n <= 6) Use(n - 1);
            return true;
        }
        if (k == Key.I && !Jef.I.Frozen && !Jef.I.Fly)
        {
            OpenPockets();
            return true;
        }
        return false;
    }

    private static int Digit(Key k) => k >= Key.Key0 && k <= Key.Key9 ? (int)(k - Key.Key0) : k >= Key.Kp0 && k <= Key.Kp9 ? (int)(k - Key.Kp0) : -1;

    public override void _UnhandledInput(InputEvent e)
    {
        if (Jef.I.TestInput || e is not InputEventKey { Pressed: true, Echo: false } k) return;
        if (Key_(k.PhysicalKeycode, k.Keycode)) GetViewport().SetInputAsHandled();
    }

    // ------------------------------------------------------------------ the pockets (game/pockets.ts)

    private PanelContainer pocketCard = null!;
    private VBoxContainer pocketBody = null!;

    public void OpenPockets()
    {
        PocketsOpen = true;
        Jef.I.Frozen = true;
        pocketCard.Visible = true;
        RenderPockets();
    }

    public void ClosePockets()
    {
        PocketsOpen = false;
        Jef.I.Frozen = false;
        pocketCard.Visible = false;
    }

    private void RenderPockets()
    {
        foreach (var c in pocketBody.GetChildren())
        {
            pocketBody.RemoveChild(c);
            c.QueueFree();
        }
        float w = pocketBody.CustomMinimumSize.X;
        pocketBody.AddChild(Paper.Text("Pockets", Fonts.Hand, 20));
        var items = GameState.I.Pockets;
        if (items.Count == 0)
        {
            var l = Paper.Text("Your pockets are empty. Lint, and a button.", Fonts.Print, 15, 1, true);
            l.CustomMinimumSize = new Vector2(w, 0);
            pocketBody.AddChild(l);
        }
        for (int i = 0; i < items.Count; i++)
        {
            var it = items[i];
            var row = Paper.Row(8);
            row.AddChild(Paper.Text((i + 1).ToString(), Fonts.HandBold, 16));
            var name = Paper.Text(it.Name, Fonts.Print, 15);
            name.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
            row.AddChild(name);
            row.AddChild(Paper.Text(it.Use ?? it.Note ?? "", Fonts.Hand, 13, 0.85f));
            pocketBody.AddChild(row);
        }
        pocketBody.AddChild(Paper.Text("1-6 eat, drink or read · I to close", Fonts.Hand, 14, 0.9f, false, HorizontalAlignment.Right));
        pocketCard.ResetSize();
    }

    /// <summary>pockets.ts use: eat it, drink it, read it. The panel closes at once.</summary>
    public void Use(int index)
    {
        var items = GameState.I.Pockets;
        ClosePockets();
        if (index < 0 || index >= items.Count) return;
        var it = items[index];
        if (it.Use == "read")
        {
            if (Read != null) Read(it);
            else Toast(it.Note ?? $"{RunWords.Cap(it.Name)}: to be read by a lamp, when there is time.");
            return;
        }
        if (it.Use == null)
        {
            Toast(it.Note ?? "Not yours to use.");
            return;
        }
        var api = ServerLink.I?.Api;
        api?.Run(api.Use(it.Id), r =>
        {
            Toast(r.Text);
            GameState.I.Apply(r);
        }, e => Toast(e.Message));
    }

    // ------------------------------------------------------------------ the rent

    private void Rent()
    {
        var api = ServerLink.I?.Api;
        api?.Run(api.Rent(), r =>
        {
            GameState.I.Apply(r);
            Toast(r.Text);
        }, e => Toast(e.Message));
    }

    // ------------------------------------------------------------------ sleep (game/sleep.ts)

    private static string Span(double minutes)
    {
        int m = (int)Math.Round(minutes), h = m / 60;
        return h == 0 ? $"{m} min" : m % 60 == 0 ? $"{h} h" : $"{h} h {m % 60}";
    }

    private static string Clock(int h, int m) => $"{h}:{m:00}";

    private void Choose(Place p)
    {
        choosing = p;
        Jef.I.Frozen = true;
        var (h, m) = GameState.I.Shown;
        int now = h * 60 + m;
        int toMorning = ((MorningHour * 60 - now) + 1440 - 1) % 1440 + 1;
        string title = p.Kind == "bench" ? "Sleep on the bench" : p.Kind == "doss" ? "A bed in the doss house" : "Go to bed";
        var lines = new List<(string, bool)>();
        if (p.Kind == "bench") lines.Add(("A hard bench in the open: less rest, the cold goes into your coat at once, and a sleeper in the street is easy pickings.", false));
        lines.Add(("1   Sleep for 1 hour", true));
        lines.Add(("2   Sleep for 2 hours", true));
        lines.Add(("3   Sleep for 4 hours", true));
        lines.Add(("4   Sleep for 8 hours", true));
        lines.Add(($"5   Sleep until morning ({MorningHour}:00, {Span(toMorning)})", true));
        Sheet(title, $"{p.Label} · it is {Clock(h, m)}", lines, "E or Esc  never mind");
    }

    private void CloseChooser()
    {
        choosing = null;
        Jef.I.Frozen = false;
        sheet.Visible = false;
    }

    private void LieDown(object hours)
    {
        var p = choosing;
        var api = ServerLink.I?.Api;
        if (p == null || api == null) return;
        choosing = null;
        sheet.Visible = false;
        var jef = Jef.I;
        var pos = new Pos3(jef.X, jef.Z, jef.Y);
        // the server hears where he stands first (the doss house step, the bench), then the sleep
        api.Run(api.Tick(GameState.I.Where(), null, pos), _ =>
        {
            api.Run(api.Sleep(new RestAsk { Place = p.Kind, Bench = p.Bench, Hours = hours, Pos = pos }), r =>
            {
                GameState.I.Apply(r);
                if (r.Rest != null) Sleeping(r.Rest);
                else jef.Frozen = false;
            }, e =>
            {
                LastError = e.Message;
                jef.Frozen = false;
                Toast(RunWords.Cap(e.Message));
            });
        }, e =>
        {
            LastError = e.Message;
            jef.Frozen = false;
            Toast(RunWords.Cap(e.Message));
        });
    }

    private void Sleeping(RestView r)
    {
        asleep = true;
        cell = r.Place == "cell";
        waking = false;
        Jef.I.Frozen = true;
        sinceStep = 0;
        fadeWant = 1;
        ShowRest(r);
    }

    private void ShowRest(RestView r)
    {
        string where = r.Place switch { "bench" => "On the bench", "doss" => "In the doss house", "home" => "In your own bed", _ => "In the cell at the police post" };
        restLine.Text = $"{where} · {Clock(r.Now.Hour, r.Now.Minute)} · {Span(r.SleptMin)} of {Span(r.PlannedMin)}";
        restSmall.Text = r.Place == "cell" ? "the door is unlocked at dawn; the town goes on outside" : "any key: wake up";
    }

    private void SleepStep()
    {
        var api = ServerLink.I?.Api;
        if (api == null || stepBusy) return;
        stepBusy = true;
        var jef = Jef.I;
        api.Run(api.Tick(GameState.I.Where(), true, new Pos3(jef.X, jef.Z, jef.Y)), r =>
        {
            stepBusy = false;
            // (GameState tells Resting and Woke: ShowRest and GetUp run from there)
            GameState.I.Apply(r);
            if (asleep && r.Woke == null && r.Rest == null && r.Advanced) GetUp(null);
        }, _ => stepBusy = false);
    }

    /// <summary>A key wakes him: only the time slept counts.</summary>
    private void WakeNow()
    {
        var api = ServerLink.I?.Api;
        if (api == null || waking) return;
        waking = true;
        api.Run(api.Wake(), r =>
        {
            GameState.I.Apply(r);
            GetUp(r.Woke);
        }, e =>
        {
            waking = false;
            Toast(e.Message);
        });
    }

    private void GetUp(RestEnd? woke)
    {
        if (!asleep) return;
        asleep = false;
        LastWoke = woke;
        fadeWant = 0;
        // from the doss house he steps out of the alley gate, facing the river
        if (woke?.Place == "doss")
        {
            var (x, z) = Spots.Doss;
            Jef.I.Place(x, z - 0.4f, 0);
        }
        if (woke?.Place == "home" && woke.Home != null) WakeHome?.Invoke(woke.Home);
        unfreezeIn = 0.9;
        if (woke != null && woke.Ended == null && woke.Place != "cell" && woke.Lines.Count > 0) Toast(string.Join(" ", woke.Lines));
        if (woke?.Ended != null) ShowEnd(GameState.I.Ending ?? woke.Ended);
    }

    // ------------------------------------------------------------------ the sheets: a night that came, midnight, the end

    private void Midnight(DayTurn t)
    {
        var lines = new List<string> { $"Midnight. {(GameState.I.Live ? GameState.I.Weekday : "A new day")} begins. New work goes up on the board." };
        lines.AddRange(t.Lines);
        Toast(string.Join(" ", lines));
    }

    private void OpenSheet(string kind)
    {
        if (shown == "")
        {
            Jobs.I?.CloseBoard();
            if (PocketsOpen) ClosePockets();
        }
        shown = kind;
        Jef.I.Frozen = true;
    }

    private void ShowNight(Night n)
    {
        night = n;
        OpenSheet("night");
        string where = n.Where == "home" ? $"Your own room: {n.Place ?? "home"}" : n.Where == "bed" ? "The doss house, Sint-Andries" : n.Collapsed == true ? "Where you dropped, on the stones" : "Rough, under a tarpaulin";
        Sheet(n.Collapsed == true ? "Dropped asleep" : "Asleep", where, n.Summary.Select(l => (l, false)).ToList(), n.Ended != null ? "E or Esc  go on" : "E or Esc  get up");
    }

    private void ShowEnd(Ending e)
    {
        OpenSheet("end");
        if (e.Epilogue != null) Sheet(e.Epilogue.Title, "", e.Epilogue.Paragraphs.Select(p => (p, false)).ToList(), "N  start a new week");
        else Sheet(e.Kind == "health" ? $"The end of {GameState.I.PlayerName}" : "Sunday night", "", new List<(string, bool)> { ("Somebody is writing down what became of him …", false) }, "");
    }

    private void Wake()
    {
        var n = night;
        night = null;
        if (n?.Ended != null)
        {
            // the week is over: the epilogue sheet, or wait for it
            ShowEnd(GameState.I.Ending ?? n.Ended);
            return;
        }
        shown = "";
        sheet.Visible = false;
        Jef.I.Frozen = false;
        // from the doss house you step out of the alley gate, facing the river; rough, he gets up where he lay
        if (n?.Where == "bed")
        {
            var (x, z) = Spots.Doss;
            Jef.I.Place(x, z - 0.4f, 0);
        }
        if (n?.Where == "home" && n.Home != null) WakeHome?.Invoke(n.Home);
        var st = GameState.I;
        string sky = st.Weather switch
        {
            "mist" => "A thin mist lies on the river.",
            "clear" => "The air is clear and cold. You can see the far bank.",
            "rain" => "Rain is coming in off the Schelde.",
            "storm" => "A gale off the sea. The river runs high and grey. Keep off the quay edge.",
            _ => "The fog is thick on the Schelde.",
        };
        bool dark = st.Hour < 6 || st.Hour >= 20;
        Toast($"{st.Weekday} {Clock(st.Hour, st.Minute)}. {(dark ? "Still dark." : sky)}{(n?.Turned == true ? " New work is on the board." : "")}");
    }

    private void NewWeek()
    {
        var api = ServerLink.I?.Api;
        api?.Run(api.NewGame(), p =>
        {
            shown = "";
            sheet.Visible = false;
            Jef.I.Frozen = false;
            GameState.I.Apply(p);
            Goods.I.Load();
        }, e => Toast(e.Message));
    }

    // ------------------------------------------------------------------ the papers

    private Control? ui;
    private PanelContainer sheet = null!;
    private VBoxContainer sheetBody = null!;
    private ColorRect fade = null!;
    private Label restLine = null!, restSmall = null!;
    private float fadeWant;

    private void BuildUi()
    {
        bool pockets = PocketsOpen;
        ui?.QueueFree();
        ui = new Control { Name = "Day", MouseFilter = Control.MouseFilterEnum.Ignore, ZIndex = 30 };
        ui.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(ui);
        var win = GetViewport().GetVisibleRect().Size;
        float s = Paper.UiNow;

        // .sleep-fade: the dark of a sleep, the line of where and how long
        fade = new ColorRect { Color = new Color(0.02f, 0.02f, 0.03f, 1), MouseFilter = Control.MouseFilterEnum.Ignore, Modulate = new Color(1, 1, 1, asleep ? 1 : 0) };
        fade.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        var col = Paper.Column(Paper.Px(6));
        col.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        col.Alignment = BoxContainer.AlignmentMode.Center;
        restLine = Chalk(20);
        restSmall = Chalk(14);
        col.AddChild(restLine);
        col.AddChild(restSmall);
        fade.AddChild(col);
        ui.AddChild(fade);

        // .pocket-panel: right 14px, bottom 64px, min(340px, 80vw)
        pocketCard = Paper.Make(Paper.Sheet, 16, 10, 8, 0.5f, 24, 6);
        pocketBody = Paper.Column(Paper.Px(3));
        pocketBody.CustomMinimumSize = new Vector2(Math.Min(340 * s, win.X * 0.8f) - Paper.Px(32), 0);
        pocketCard.AddChild(pocketBody);
        pocketCard.Visible = false;
        pocketCard.Resized += () =>
        {
            var w = GetViewport().GetVisibleRect().Size;
            pocketCard.Position = new Vector2(w.X - Paper.Px(14) - pocketCard.Size.X, w.Y - Paper.Px(64) - pocketCard.Size.Y);
        };
        ui.AddChild(pocketCard);

        // .night: the sheet in the middle (the chooser, the night, the week's end)
        sheet = Paper.Make(Paper.Sheet, 30, 20, 14, -0.8f, 40, 8);
        sheetBody = Paper.Column(Paper.Px(6));
        sheetBody.CustomMinimumSize = new Vector2(Math.Min(520 * s, win.X * 0.84f) - Paper.Px(60), 0);
        sheet.AddChild(sheetBody);
        Paper.Centre(sheet);
        sheet.Visible = false;
        ui.AddChild(sheet);

        if (pockets)
        {
            pocketCard.Visible = true;
            RenderPockets();
        }
        if (lastSheet is { } l) Sheet(l.Title, l.Sub, l.Lines, l.Keys);
    }

    private Label Chalk(float size) => new()
    {
        LabelSettings = new LabelSettings { Font = Fonts.Hand, FontSize = Paper.Px(size), FontColor = new Color("d8cfb8") },
        HorizontalAlignment = HorizontalAlignment.Center,
        MouseFilter = Control.MouseFilterEnum.Ignore,
    };

    private (string Title, string Sub, List<(string, bool)> Lines, string Keys)? lastSheet;

    /// <summary>The sheet in the middle: a title, a line under it, the paragraphs (or the choices, in the hand), the keys.</summary>
    private void Sheet(string title, string sub, List<(string Text, bool Choice)> lines, string keys)
    {
        lastSheet = (title, sub, lines, keys);
        foreach (var c in sheetBody.GetChildren())
        {
            sheetBody.RemoveChild(c);
            c.QueueFree();
        }
        float w = sheetBody.CustomMinimumSize.X;
        sheetBody.AddChild(Paper.Text(title, Fonts.Hand, 26, 1, false, HorizontalAlignment.Center));
        if (sub != "") sheetBody.AddChild(Paper.Text(sub, Fonts.Hand, 14, 0.8f, false, HorizontalAlignment.Center));
        foreach (var (text, choice) in lines)
        {
            var l = Paper.Text(text, choice ? Fonts.Hand : Fonts.Print, choice ? 17 : 16, 1, true);
            l.CustomMinimumSize = new Vector2(w, 0);
            sheetBody.AddChild(l);
        }
        if (keys != "") sheetBody.AddChild(Paper.Text(keys, Fonts.Hand, 14, 0.9f, false, HorizontalAlignment.Right));
        sheet.Visible = true;
        sheet.ResetSize();
    }

    public override void _Process(double delta)
    {
        if (!sheet.Visible) lastSheet = null;
        // .sleep-fade: 1.1 s in, and out again
        float a = fade.Modulate.A;
        if (a != fadeWant) fade.Modulate = new Color(1, 1, 1, Mathf.MoveToward(a, fadeWant, (float)delta / 1.1f));
        if (asleep)
        {
            sinceStep += delta;
            if (sinceStep >= StepS)
            {
                sinceStep = 0;
                SleepStep();
            }
        }
        if (unfreezeIn > 0 && (unfreezeIn -= delta) <= 0 && !Busy && !SheetOpen && !PocketsOpen && !(Jobs.I?.BoardOpen ?? false)) Jef.I.Frozen = false;
    }
}
