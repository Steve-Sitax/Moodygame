using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Game;

/// <summary>
/// The game clock's rate: shared/clock.ts, the one place for it. One game hour is two real minutes.
/// </summary>
public static class ClockRate
{
    public const double RealSPerGameMin = 2;
    public const double GameMinPerRealS = 1 / RealSPerGameMin;
    /// <summary>The server's tick: the game asks every TickEveryMs while Jef plays; the server moves the clock TickMinutes on.</summary>
    public const int TickMinutes = 5;
    public const int TickEveryMs = (int)(TickMinutes * RealSPerGameMin * 1000);
}

/// <summary>
/// What the server last said of the game, for every part to read: the clock, the day, the weather, Jef's needs,
/// his money, the rent, his pockets, and the line to say in the middle of the screen. The server owns the numbers;
/// this only keeps and tells them. Read it as GameState.I (never null: before the server has spoken, or with the
/// net part off, it holds the bake's own hour, 13:00 on a clear Monday, and Live is false). The events come on the
/// main thread. The clock part is game/day.ts.
///
///   GameState.I.HourF                      the hour with its fraction, run on smoothly between the server's ticks
///   GameState.I.Weather                    "fog", "mist", "clear", "rain" or "storm"
///   GameState.I.ClockChanged += () => ...  the server's time moved
///   GameState.I.WeatherChanged += w => ... the weather turned
/// </summary>
[GamePart(10)]
public partial class GameState : Node
{
    private static GameState? inst;
    /// <summary>The store. Made with the game's parts; a part that asks before (or with the store off) gets one that never changes.</summary>
    public static GameState I => inst ??= new GameState();

    public GameState()
    {
        // every part is made before the first is added (GamePart.Make), so a part of any order finds it in its _Ready
        inst = this;
    }

    // ------------------------------------------------------------------ what is known

    /// <summary>The server has spoken: the values are the game's, not the stand-ins.</summary>
    public bool Live => Payload != null;
    /// <summary>The whole of what the server last sent (the job board too), or null.</summary>
    public JobsPayload? Payload { get; private set; }

    /// <summary>The day of the week, 1 = Monday.</summary>
    public int Day => Payload?.Clock.Day ?? 1;
    /// <summary>The server's hour and minute as last sent (whole; see HourF for the running clock).</summary>
    public int Hour => Payload?.Clock.Hour ?? 13;
    public int Minute => Payload?.Clock.Minute ?? 0;
    public string Weekday => Payload?.Clock.Weekday ?? "Monday";
    /// <summary>"fog", "mist", "clear", "rain" or "storm".</summary>
    public string Weather => Payload?.Clock.Weather ?? "clear";

    /// <summary>Jef's needs, 0 to 10.</summary>
    public double Food => Payload?.Player.Food ?? 10;
    public double Warmth => Payload?.Player.Warmth ?? 10;
    public double Sleep => Payload?.Player.Sleep ?? 10;
    public double Health => Payload?.Player.Health ?? 10;
    public string PlayerName => Payload?.Player.Name ?? "Jef";
    /// <summary>Jef's money in centimes.</summary>
    public int Money => moneyOver ?? Payload?.Player.MoneyC ?? 0;
    public bool RentPaid => Payload?.Rent.Paid ?? false;
    public int RentPrice => Payload?.Rent.PriceC ?? 0;
    public IReadOnlyList<PocketItem> Pockets => Payload?.Pockets ?? (IReadOnlyList<PocketItem>)Array.Empty<PocketItem>();
    public IReadOnlyList<Job> Jobs => Payload?.Jobs ?? (IReadOnlyList<Job>)Array.Empty<Job>();
    public Ending? Ending => Payload?.Ending;
    /// <summary>Where the server believes Jef is (the cold): null before the first tick.</summary>
    public WhereNow? WhereNow { get; private set; }

    // ------------------------------------------------------------------ the events (main thread)

    /// <summary>Any new state from the server (a push or a reply).</summary>
    public event Action<JobsPayload>? Changed;
    /// <summary>The first state is in: the game knows the time and the weather.</summary>
    public event Action? FirstState;
    /// <summary>The server's hour or minute moved (or the day).</summary>
    public event Action? ClockChanged;
    /// <summary>The day of the week turned.</summary>
    public event Action<int>? DayChanged;
    public event Action<string>? WeatherChanged;
    public event Action? NeedsChanged;
    public event Action<int>? MoneyChanged;
    public event Action? RentChanged;
    public event Action? PocketsChanged;
    /// <summary>A line for the middle of the screen (the browser's toast).</summary>
    public event Action<string>? Message;
    /// <summary>Jef dropped where he stood and the night passed (the night sheet).</summary>
    public event Action<Night>? NightCame;
    /// <summary>The date turned at midnight; the night's other work may have a word.</summary>
    public event Action<DayTurn>? DayTurned;
    /// <summary>Asleep on the server's word, and how a sleep ended (game/sleep.ts).</summary>
    public event Action<RestView>? Resting;
    public event Action<RestEnd>? Woke;

    // ------------------------------------------------------------------ what the game says of itself

    /// <summary>
    /// Is Jef in play (day.ts playing)? Time runs only then: the net part asks for the clock's tick. Set by the
    /// player's part. Not set: the mouse is taken and the camera is not the free one (the browser's Fly mode
    /// stops the clock too).
    /// </summary>
    public Func<bool>? PlayingWhen { get; set; }
    /// <summary>day.ts hold: a sheet is up (the night, the end, a night in the cell): the clock waits.</summary>
    public bool Hold { get; set; }
    public bool Playing => Ending == null && !Hold && (PlayingWhen?.Invoke() ?? (Input.MouseMode == Input.MouseModeEnum.Captured && Main.I?.Cam is not null and not FlyCam));

    /// <summary>M7 warmth: where Jef is (a room's id, or null outside) and whether his lantern is lit; sent with each tick. Set by the rooms' part.</summary>
    public Func<WhereReport> Where { get; set; } = () => new WhereReport(null, false);
    /// <summary>Where Jef stands, sent with each tick. Not set: the camera's place.</summary>
    public Func<Vector3>? PosOf { get; set; }
    public Vector3 Pos => PosOf?.Invoke() ?? Main.I?.Cam?.GlobalPosition ?? Vector3.Zero;

    // ------------------------------------------------------------------ the running clock (day.ts hourF)

    private ulong shownAt = PlayNow;
    private bool wasOn;

    // game/pause.ts: the game's own clock is real time less the time spent paused
    private static ulong pausedAt;
    private static ulong pausedTotal;
    private static bool paused;
    /// <summary>Milliseconds of play: real time less the time spent paused. A part that counts real seconds reads this.</summary>
    public static ulong PlayNow => (paused ? pausedAt : Time.GetTicksMsec()) - pausedTotal;
    public bool Paused => paused;
    /// <summary>Played together: the town's clock runs on behind a window or the menu.</summary>
    public bool Together { get; set; }

    /// <summary>The link's word that the game is paused or plays again (ServerLink.SetPause).</summary>
    public void SetPaused(bool on)
    {
        if (on == paused) return;
        if (on) pausedAt = Time.GetTicksMsec();
        else pausedTotal += Time.GetTicksMsec() - pausedAt;
        paused = on;
    }

    /// <summary>The hour with its fraction, run on smoothly between the server's ticks (half a game minute a real second), never past the next tick.</summary>
    public double HourF
    {
        get
        {
            var c = Payload?.Clock;
            if (c == null) return 13;
            // paused, the clock stands where it was on screen (PlayNow stands still)
            bool on = Playing || paused || Together;
            ulong now = PlayNow;
            // back in play after a time out of it: the run on starts again from here
            if (on && !wasOn) shownAt = Math.Max(shownAt, now);
            wasOn = on;
            double ahead = on ? Math.Min(ClockRate.TickMinutes / 60.0, (now - shownAt) / 1000.0 * (ClockRate.GameMinPerRealS / 60)) : 0;
            // never 24 or past it (the server turns the date at midnight)
            return Math.Min(24 - 1e-6, c.Hour + c.Minute / 60.0 + ahead);
        }
    }

    /// <summary>The clock as the corner shows it: the running hour and minute.</summary>
    public (int Hour, int Minute) Shown
    {
        get
        {
            int at = (int)Math.Floor(HourF * 60 + 1e-6);
            return (at / 60 % 24, at % 60);
        }
    }

    // ------------------------------------------------------------------ new state

    private int? moneyOver;

    /// <summary>New state from the server (a push or a reply): kept, and told to whoever listens.</summary>
    public void Apply(JobsPayload p)
    {
        var was = Payload;
        int moneyWas = Money;
        // a reply sent before the epilogue was written may come in after the push that brought it: the epilogue stays
        if (was?.Ending is { Epilogue: not null } had && p.Ending is { Epilogue: null } e && e.Kind == had.Kind && e.Day == had.Day) p = p with { Ending = had };
        WarnNeeds(was, p);
        if (was == null || was.Clock.Minute != p.Clock.Minute || was.Clock.Hour != p.Clock.Hour) shownAt = PlayNow;
        Payload = p;
        moneyOver = null;
        if (was == null) FirstState?.Invoke();
        Changed?.Invoke(p);
        if (was == null || was.Clock.Day != p.Clock.Day) DayChanged?.Invoke(p.Clock.Day);
        if (was == null || was.Clock.Day != p.Clock.Day || was.Clock.Hour != p.Clock.Hour || was.Clock.Minute != p.Clock.Minute || was.Clock.Weekday != p.Clock.Weekday) ClockChanged?.Invoke();
        if (was == null || was.Clock.Weather != p.Clock.Weather) WeatherChanged?.Invoke(p.Clock.Weather);
        if (was == null || was.Player.Food != p.Player.Food || was.Player.Warmth != p.Player.Warmth || was.Player.Sleep != p.Player.Sleep || was.Player.Health != p.Player.Health) NeedsChanged?.Invoke();
        if (was == null || moneyWas != p.Player.MoneyC) MoneyChanged?.Invoke(p.Player.MoneyC);
        if (was == null || was.Rent != p.Rent) RentChanged?.Invoke();
        if (was == null || !SamePockets(was.Pockets, p.Pockets)) PocketsChanged?.Invoke();
    }

    /// <summary>A tick's answer: the state, and what the night or the sleep did.</summary>
    public void Apply(TickReply r)
    {
        Apply((JobsPayload)r);
        if (r.Where != null) WhereNow = r.Where;
        if (r.Rest != null) Resting?.Invoke(r.Rest);
        if (r.Woke != null) Woke?.Invoke(r.Woke);
        if (r.Night != null) NightCame?.Invoke(r.Night);
        else if (r.Turned != null && r.Turned.Ended == null) DayTurned?.Invoke(r.Turned);
    }

    /// <summary>A call that answers with the money only (a job settled): shown at once, until the next state.</summary>
    public void SetMoney(int moneyC)
    {
        if (moneyC == Money) return;
        moneyOver = moneyC;
        MoneyChanged?.Invoke(moneyC);
    }

    /// <summary>Say a line in the middle of the screen.</summary>
    public void Say(string text)
    {
        if (text != "") Message?.Invoke(text);
    }

    private static bool SamePockets(List<PocketItem> a, List<PocketItem> b)
    {
        if (a.Count != b.Count) return false;
        for (int i = 0; i < a.Count; i++)
            if (a[i] != b[i]) return false;
        return true;
    }

    /// <summary>day.ts warnNeeds: say it when a need runs low, once each time it crosses the line.</summary>
    private void WarnNeeds(JobsPayload? was, JobsPayload p)
    {
        if (was == null || p.Ending != null) return;
        PlayerState before = was.Player, now = p.Player;
        var lines = new (double Was, double Is, string Low, string Zero)[]
        {
            (before.Food, now.Food, "Your belly aches. Eat something soon: Fientje sells herring, the widow sells biscuit.", "You are starving. Your strength is going. Eat."),
            (before.Warmth, now.Warmth, "You are cold to the bone. A warm room, a bed or a nip of jenever warms you; a lantern or a roof slows the cold.", "You are freezing. Get into a warm room, a tavern or a shop with a stove, or you will fall ill."),
            (before.Sleep, now.Sleep, "Your eyes close by themselves and your legs drag. Get to a bed or a bench soon, or you will drop where you stand.", "You drop where you stand."),
            (before.Health, now.Health, "You feel ill. Eat, get warm and sleep.", "You can hardly stand."),
        };
        foreach (var l in lines)
        {
            if (l.Is <= 0 && l.Was > 0)
            {
                Say(l.Zero);
                return;
            }
            if (l.Is <= 2 && l.Was > 2)
            {
                Say(l.Low);
                return;
            }
        }
    }

    public override void _ExitTree()
    {
        if (inst == this) inst = null;
    }
}
