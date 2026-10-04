using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Windows;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// The day's needs by hand (game/day.ts, game/sleep.ts): a bed in the doss house and the benches of the town (E,
/// then how long: 1, 2, 4, 8 hours or until morning), the week's rent at the doss house door (F), the
/// sleep fade and waking from a chosen rest. DaySheets owns the tick's night, midnight and ending.
/// The server decides everything: how the needs
/// fall, who is robbed on a bench, when Jef drops where he stands; this asks and shows. (Eating and drinking are
/// the pockets' window, Talk/Pockets.cs; GameState says the warnings when a need runs low; the clock's tick is
/// ServerLink's.) Dead tired, he walks slower (Jef.Fatigue). The papers stand on the dialog stack, on the paper kit.
///
/// The browser has no pump to drink from (its pumps are the washerwomen's, the fire engine's and a map icon), so
/// none is here. Benches: the Sint-Jansplein, the greens, the Steen and the Stadspark (shared/townplaces.json,
/// client/public/models/park.json); the benches at omnibus stops, on the wall walk and by house doors come with
/// the parts that place them (Day.I.AddBench).
/// </summary>
[GamePart(330)]
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

    /// <summary>After a night at home Jef wakes in his own room (the homes' part).</summary>
    public Action<string>? WakeHome;

    /// <summary>The chooser is up, or he is asleep: no other keys.</summary>
    public bool Busy => chooser.IsOpen || asleep;
    public bool Asleep => asleep;
    public bool SheetOpen => DaySheets.I is { Shown: not "none" };
    /// <summary>What the server last said to a sleep or a wake, for the checks.</summary>
    public RestEnd? LastWoke { get; private set; }
    public string LastError { get; private set; } = "";

    private sealed record Place(string Kind, string Label, string? Bench);
    private Place? choosing;
    private bool asleep, cell, waking;
    private RestView? rest;
    private double sinceStep;
    private bool stepBusy;
    private Window chooser = null!, sleeping = null!;
    private bool wired;

    public Day()
    {
        I = this;
    }

    public override void _Ready()
    {
        chooser = new Window("sleep chooser", WriteChooser, ChooserKey);
        // asleep, the mouse does nothing and Esc is the menu's: a key wakes him
        sleeping = new Window("asleep", () => null, AsleepKey) { Cursor = false, EscCloses = false };
        LoadBenches();
        var st = GameState.I;
        st.NeedsChanged += Tired;
        st.Resting += OnResting;
        st.Woke += GetUp;
        if (DaySheets.I is { } papers) papers.OnWakeHome = WakeAtHome;
        Interact.I.AddProvider(Keys);
        BuildFade();
        GetViewport().SizeChanged += BuildFade;
        Tired();
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced += WorldReplaced;
    }

    public override void _ExitTree()
    {
        GetViewport().SizeChanged -= BuildFade;
        var st = GameState.I;
        st.NeedsChanged -= Tired;
        st.Resting -= OnResting;
        st.Woke -= GetUp;
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced -= WorldReplaced;
        if (DaySheets.I is { } papers)
        {
            papers.SleepShown = false;
            papers.OnWakeHome = null;
        }
        chooser.Close();
        sleeping.Close();
    }

    private void OnResting(RestView r)
    {
        // A saved rest or a collapse together arrives on the server's word too.
        if (!asleep) Sleeping(r);
        else ShowRest(r);
    }

    private void WorldReplaced(string how, ClientState? client)
    {
        choosing = null;
        chooser.Close();
        sleeping.Close();
        asleep = cell = waking = stepBusy = false;
        rest = null;
        LastWoke = null;
        LastError = "";
        fadeWant = 0;
        if (DaySheets.I is { } papers) papers.SleepShown = false;
        Tired();
    }

    private void WakeAtHome(string home) => WakeHome?.Invoke(home);

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
            // someone sits or lies there already? (sleep.ts: a person within 0.9 m of the bench)
            bool taken = Folk.Near(b.X, b.Z, 0.9f).Any();
            o.Options.Add((bd + 0.2f, Act.At(Key.E, taken ? "the bench is taken" : "sleep on the bench", new Vector3(b.X, b.Y + 0.45f, b.Z), () =>
            {
                if (taken) Toast("Someone is on that bench already.");
                else Choose(new Place("bench", b.Label, b.Id));
            })));
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

    // ------------------------------------------------------------------ the rent

    private void Rent()
    {
        DaySheets.I?.PayRent();
    }

    // ------------------------------------------------------------------ the papers

    /// <summary>.night.paper: left 50%, top 50%, min(520px, 86vw) (620 for the week's end), padding 28 44, turned -0.8 degrees.</summary>
    private Sheet NightPaper(float width = 520, float widest = 0.86f)
    {
        var win = GetViewport().GetVisibleRect().Size;
        float s = Dialogs.I!.Ui;
        return new Sheet(s, Math.Min(width * s, win.X * widest) + 88 * s, Css.Hex("d8cfb8"), (44, 28, 44, 28), -0.8f, sepia: 0.3f, contrast: 0.95f, shadow: 30, drop: 6, maxHeight: win.Y * 0.9f) { Where = Window.Middle };
    }

    private static string Span(double minutes)
    {
        int m = (int)Math.Round(minutes), h = m / 60;
        return h == 0 ? $"{m} min" : m % 60 == 0 ? $"{h} h" : $"{h} h {m % 60}";
    }

    private static string Clock(int h, int m) => $"{h}:{m:00}";

    // ------------------------------------------------------------------ sleep (game/sleep.ts)

    private void Choose(Place p)
    {
        choosing = p;
        chooser.Open();
    }

    /// <summary>The homes owner offers this only at the bed in the leased room.</summary>
    public void ChooseHome(string label) => Choose(new Place("home", label, null));

    private Sheet? WriteChooser()
    {
        var p = choosing;
        if (p == null) return null;
        var (h, m) = GameState.I.Shown;
        int now = h * 60 + m;
        int toMorning = ((MorningHour * 60 - now) + 1440 - 1) % 1440 + 1;
        var sh = NightPaper();
        sh.Text($"[b]{(p.Kind == "bench" ? "Sleep on the bench" : p.Kind == "doss" ? "A bed in the doss house" : "Go to bed")}[/b]", Face.Hand, 26, bottom: 4);
        sh.Text($"{Css.Esc(p.Label)} · it is {Clock(h, m)}", Face.Hand, 13, 0.7f, bottom: 12);
        if (p.Kind == "bench") sh.Text("A hard bench in the open: less rest, the cold goes into your coat at once, and a sleeper in the street is easy pickings.", Face.Print, 15, lineHeight: 1.45f, bottom: 8);
        sh.Row(1, "Sleep for 1 hour", face: Face.Hand, size: 16);
        sh.Row(2, "Sleep for 2 hours", face: Face.Hand, size: 16);
        sh.Row(3, "Sleep for 4 hours", face: Face.Hand, size: 16);
        sh.Row(4, "Sleep for 8 hours", face: Face.Hand, size: 16);
        sh.Row(5, $"Sleep until morning ({MorningHour}:00, {Span(toMorning)})", face: Face.Hand, size: 16);
        sh.Keys("E or Esc  never mind", Face.Hand, top: 12, bottom: 0);
        return sh;
    }

    private void ChooserKey(string code, string key)
    {
        if (code is "KeyE" or "Escape")
        {
            choosing = null;
            chooser.Close();
            return;
        }
        int n = Dialogs.Digit(key);
        if (n >= 1 && n <= 4) LieDown(new[] { 1, 2, 4, 8 }[n - 1]);
        else if (n == 5) LieDown("morning");
    }

    private void LieDown(object hours)
    {
        var p = choosing;
        var api = ServerLink.I?.Api;
        if (p == null || api == null) return;
        choosing = null;
        chooser.Close();
        var jef = Jef.I;
        var pos = new Pos3(jef.X, jef.Z, jef.Y);
        void Refused(ApiException e)
        {
            LastError = e.Message;
            Toast(RunWords.Cap(e.Message));
        }
        // the server hears where he stands first (the doss house step, the bench), then the sleep
        api.Run(api.Tick(GameState.I.Where(), null, pos), _ =>
        {
            api.Run(api.Sleep(new RestAsk { Place = p.Kind, Bench = p.Bench, Hours = hours, Pos = pos }), r =>
            {
                GameState.I.Apply(r);
                // SleepReply is a state reply; only ticks dispatch GameState.Resting.
                if (r.Rest != null) Sleeping(r.Rest);
            }, Refused);
        }, Refused);
    }

    private void Sleeping(RestView r)
    {
        asleep = true;
        if (DaySheets.I is { } papers) papers.SleepShown = true;
        cell = r.Place == "cell";
        // sleep.ts joinFromServer: other players see the prisoner at the
        // engine's cell position while his own view fades out.
        if (r.At is {} at) Jef.I.Place((float)at.X,(float)at.Z,(float)at.Yaw);
        waking = false;
        sinceStep = 0;
        fadeWant = 1;
        sleeping.Open();
        ShowRest(r);
    }

    private void ShowRest(RestView r)
    {
        rest = r;
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

    /// <summary>Any key wakes him (not P, not the keys that only hold others; Esc is the menu's): only the time slept counts.</summary>
    private void AsleepKey(string code, string key)
    {
        if (code is "Escape" or "KeyP" || code.StartsWith("Shift", StringComparison.Ordinal) || code.StartsWith("Control", StringComparison.Ordinal) || code.StartsWith("Alt", StringComparison.Ordinal) || code.StartsWith("Meta", StringComparison.Ordinal)) return;
        var api = ServerLink.I?.Api;
        if (api == null || waking || cell) return;
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
        rest = null;
        LastWoke = woke;
        fadeWant = 0;
        sleeping.Close();
        // from the doss house he steps out of the alley gate, facing the river
        if (woke?.Place == "doss")
        {
            var (x, z) = Spots.Doss;
            Jef.I.Place(x, z - 0.4f, 0);
        }
        if (woke?.Place == "home" && woke.Home != null) WakeHome?.Invoke(woke.Home);
        if (woke != null && woke.Ended == null && woke.Place != "cell" && woke.Lines.Count > 0) Toast(string.Join(" ", woke.Lines));
        if (DaySheets.I is { } papers) papers.SleepShown = false;
    }

    // ------------------------------------------------------------------ the dark of a sleep (.sleep-fade)

    private ColorRect? fade;
    private Label restLine = null!, restSmall = null!;
    private float fadeWant;

    private void BuildFade()
    {
        fade?.QueueFree();
        float s = Css.Ui(GetViewport().GetVisibleRect().Size.X);
        fade = new ColorRect { Name = "SleepFade", Color = new Color(0.02f, 0.02f, 0.03f, 1), MouseFilter = Control.MouseFilterEnum.Ignore, Modulate = new Color(1, 1, 1, asleep ? 1 : 0), ZIndex = 10 };
        fade.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        var col = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore, Alignment = BoxContainer.AlignmentMode.Center };
        col.AddThemeConstantOverride("separation", Mathf.RoundToInt(6 * s));
        col.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Label Chalk(float size) => new()
        {
            LabelSettings = new LabelSettings { Font = Fonts.Hand, FontSize = Mathf.RoundToInt(size * s), FontColor = new Color("d8cfb8") },
            HorizontalAlignment = HorizontalAlignment.Center,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        restLine = Chalk(20);
        restSmall = Chalk(14);
        col.AddChild(restLine);
        col.AddChild(restSmall);
        fade.AddChild(col);
        Main.I.Ui.AddChild(fade);
        if (rest != null) ShowRest(rest);
    }

    public override void _Process(double delta)
    {
        if (!wired)
        {
            // (after every part's _Ready: Game/Wiring.cs says when time runs; asleep, or with the night's sheet up, the
            // waking day's clock does not tick, as in the browser: a tick without "asleep" would end the sleep)
            wired = true;
            var was = GameState.I.PlayingWhen;
            if (Main.I.Arg("jobtest") == "") GameState.I.PlayingWhen = () => !asleep && !chooser.IsOpen && (was?.Invoke() ?? (Input.MouseMode == Input.MouseModeEnum.Captured && Main.I.Cam is not FlyCam));
        }
        // .sleep-fade: 1.1 s in, and out again
        if (fade != null)
        {
            float a = fade.Modulate.A;
            if (a != fadeWant) fade.Modulate = new Color(1, 1, 1, Mathf.MoveToward(a, fadeWant, (float)delta / 1.1f));
        }
        if (asleep)
        {
            sinceStep += delta;
            if (sinceStep >= StepS)
            {
                sinceStep = 0;
                SleepStep();
            }
        }
    }
}
