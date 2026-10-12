using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Net;

/// <summary>
/// The game's link to its server: starts the server with the game (ServerProcess) and stops it with the game,
/// opens the calls and the push channel (Api), feeds the store (GameState), and asks for the clock's tick while
/// Jef plays (game/day.ts). Other parts reach the server as ServerLink.I.Api once ServerLink.I.Up; ServerLink.I.WhenUp(...) runs a
/// piece of code then.
///
/// Options after "--": --server http://127.0.0.1:PORT (use that server, start none), --port N (the first port to
/// try, default 8800), --db file (another save), --no-ai (the server makes no model calls: walk-around mode).
/// </summary>
[GamePart(20)]
public partial class ServerLink : Node
{
    public static ServerLink? I { get; private set; }

    /// <summary>The calls and the push channel; null until the server answers.</summary>
    public Api? Api { get; private set; }
    public ServerEndpoint? Server { get; private set; }
    public bool Up => Api != null;
    /// <summary>What the link is doing, for the screen ("Starting the game server..."); empty when all is well.</summary>
    public string Status { get; private set; } = "";
    /// <summary>The server did not come up: why, in words for the player. Empty when all is well.</summary>
    public string Error { get; private set; } = "";
    /// <summary>Status or Error changed.</summary>
    public event Action? StatusChanged;
    /// <summary>A tick came back (the net test waits for it).</summary>
    public event Action<TickReply>? Ticked;

    private event Action? up;

    // ------------------------------------------------------------------ the pause (game/pause.ts)

    /// <summary>Paused now: nothing progresses, here or on the server. The reasons are Menu.Pause's.</summary>
    public bool Paused => Scheldemist.Menu.Pause.Paused;
    /// <summary>Played together (the Together part sets it): the menu and the pause key do not pause; only the host's "Pause all" does.</summary>
    public bool Together { get; private set; }
    /// <summary>The pause began (true) or ended (false).</summary>
    public event Action<bool>? PauseChanged;

    /// <summary>Add or take away one reason to be paused ("menu", "key", "saving", "loading", "host"): Menu.Pause.Set.</summary>
    public void SetPause(string reason, bool on) => Scheldemist.Menu.Pause.Set(reason, on);

    /// <summary>The pause changed: the push channel keeps its messages until the unpause, the clock in the corner stands.</summary>
    private void OnPause(bool now)
    {
        Api?.HoldPushes(now);
        GameState.I.SetPaused(now);
        PauseChanged?.Invoke(now);
    }

    public void SetTogether(bool on)
    {
        Together = on;
        GameState.I.Together = on;
        Scheldemist.Menu.Pause.Together = on;
    }

    /// <summary>A word about the line for the middle of the screen ("Connection lost, trying again..."); empty: none.</summary>
    public void Note(string text) => SetStatus(text, Error);

    /// <summary>The player is out of sight indoors or in a menu.</summary>
    public Func<bool> Away { get; set; } = () => false;
    public static string ModeOf(Scheldemist.Player.Jef j) =>
        j.Fly ? "fly" : j.Climbing ? "ladder" : j.Swimming ? "swim" : j.Crouching ? "crouch" : "walk";
    private readonly CancellationTokenSource stopping = new();
    private double sinceTick;
    private double sinceWhere;
    private string whereSent = "";
    private bool busy;
    private int sent;
    private int applied;

    public ServerLink()
    {
        I = this;
    }

    /// <summary>Run this once the server answers (at once if it does already). Main thread.</summary>
    public void WhenUp(Action a)
    {
        if (Up) a();
        else up += a;
    }

    public override void _Ready()
    {
        // the link lives through a pause: the channel is pumped, the unpause is heard
        ProcessMode = ProcessModeEnum.Always;
        Scheldemist.Menu.Pause.Changed += OnPause;
        var main = Main.I;
        HouseTrust.ConfigureStore(System.IO.Path.ChangeExtension(Paths.Database, ".house-trust"));
        join = Mp.Together.Pending;
        if (join == null && main.Arg("join") != "" && !Mp.Together.LeftAsGuest)
        {
            int seat = int.TryParse(main.Arg("seat"), out int n) ? Math.Clamp(n, 2, 6) : 2;
            join = new Mp.JoinAsk(main.Arg("join"), main.Arg("code") == "" ? null : main.Arg("code"), main.Arg("name", "Anna"), seat, main.Arg("house-ca") == "" ? null : main.Arg("house-ca"));
        }
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
        if (join == null && main.Arg("server") == "")
        {
            SetStatus("Starting the game...", "");
            StartLocal(main);
            return;
        }
        string address = Mp.Together.AddressOf(join?.Address ?? main.Arg("server"));
        SetStatus($"Looking for the host's game at {address}...", "");
        joiningApi = new Api(address) { WorldFingerprint = main.WorldFingerprint };
        var remote = joiningApi;
        joining = Task.Run(async () =>
        {
            if (join != null) await Mp.Together.JoinAsync(remote, join).ConfigureAwait(false);
            else throw new ApiException("Join the server with --join, --code and your name.", 400);
        });
    }

    private async void StartLocal(Main main)
    {
        try
        {
            var backend = await main.CreateLocalBackend();
            if (stopping.IsCancellationRequested || !IsInsideTree()) { backend.Dispose(); return; }
            var api = new Api(backend);
            GD.Print("game rules started in the Godot process");
            Linked(api);
        }
        catch (Exception e)
        {
            if (stopping.IsCancellationRequested) return;
            GD.PrintErr(e);
            SetStatus("", $"The game did not start: {e.Message}");
        }
    }
    /// <summary>This game is a guest in another PC's game: what it asked to come in with (null: its own game).</summary>
    public Mp.JoinAsk? JoinedAs => join;
    private Mp.JoinAsk? join;
    private Task? joining;
    private Api? joiningApi;

    private void Linked(Api api)
    {
        api.Failed += e => GD.PushError("A game response could not be applied: " + e.Message);
        Server = new ServerEndpoint(api.Url, api.IsLocal);
        var state = GameState.I;
        api.JobsPushed += state.Apply;
        api.LinkChanged += on =>
        {
            if (!on && Error == "") SetStatus("Connection lost, trying again...", "");
            else if (on) SetStatus("", Error);
            if (on) Scheldemist.Menu.Pause.Reconnected();
        };
        Api = api;
        SetStatus("", "");
        // the state now (the browser's first api.jobs()); the push channel's welcome brings it too. A run with --hour
        // or --weather (a test, a picture) sets the server's clock and sky to them first, so the light, the HUD's clock
        // and the townspeople agree (the kit's light(): /api/dev/set). Never a host's: a guest does not set its clock.
        var set = api.Guest ? null : TestClock(Main.I);
        api.Run(set != null ? api.Post<JobsPayload>("api/dev/set", set) : api.Jobs(), state.Apply, e => GD.PrintErr($"the first state did not come: {e.Message}"));
        api.ConnectPush();
        if (Paused) api.HoldPushes(true);
        var waiting = up;
        up = null;
        waiting?.Invoke();
    }

    /// <summary>The server's clock and sky as --hour 13.5, --day 2 and --weather clear ask (null: none given).</summary>
    public static Dictionary<string, object>? TestClock(Main main)
    {
        var set = new Dictionary<string, object>();
        if (double.TryParse(main.Arg("hour"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double h) && h >= 0 && h < 24)
        {
            int minutes = (int)Math.Round(h * 60) % (24 * 60);
            set["hour"] = minutes / 60;
            set["minute"] = minutes % 60;
            if (int.TryParse(main.Arg("day"), out int d) && d > 0) set["day"] = d;
        }
        if (main.Arg("weather") is "fog" or "mist" or "clear" or "rain" or "storm") set["weather"] = main.Arg("weather");
        return set.Count > 0 ? set : null;
    }

    private void SetStatus(string status, string error)
    {
        if (status == Status && error == Error) return;
        Status = status;
        Error = error;
        StatusChanged?.Invoke();
    }

    private double pauseRetry;

    public override void _Process(double delta)
    {
        using var frameCost = Dev.FrameCost.Track("Net");
        if (joining is { IsCompleted: true } j && joiningApi is { } ja)
        {
            joining = null;
            joiningApi = null;
            if (j.Status == TaskStatus.RanToCompletion) Linked(ja);
            else
            {
                string why = j.Exception?.GetBaseException().Message ?? "The host did not let you in.";
                GD.PrintErr($"join: {why}");
                ja.Dispose();
                SetStatus("", why);
            }
        }
        var api = Api;
        if (api == null) return;
        api.Pump();
        if ((pauseRetry += delta) >= 2) { pauseRetry = 0; Scheldemist.Menu.Pause.Resend(); }
        // day.ts: a tick every 10 s while Jef plays; through a door (or the lantern up or down) the server hears of it now
        var state = GameState.I;
        if (Paused) return;

        if (!state.Playing)
        {
            sinceTick = 0;
            return;
        }
        sinceTick += delta;
        sinceWhere += delta;
        if (sinceTick * 1000 >= ClockRate.TickEveryMs) Tick();
        else if (sinceWhere >= 1)
        {
            sinceWhere = 0;
            var w = state.Where();
            if ($"{w.At}|{w.Lantern}" != whereSent) Tick();
        }
    }

    /// <summary>
    /// Ask the server to move the clock (day.ts tick). Replies come back in any order: each call takes a number
    /// when it is sent, and one older than the last reply applied is dropped.
    /// </summary>
    public void Tick()
    {
        var api = Api;
        if (api == null || busy) return;
        busy = true;
        sinceTick = 0;
        int seq = ++sent;
        var state = GameState.I;
        var where = state.Where();
        whereSent = $"{where.At}|{where.Lantern}";
        var at = state.Pos;
        api.Run(api.Tick(where, null, new Pos3(at.X, at.Z, at.Y)), r =>
        {
            busy = false;
            if (seq < applied) return;
            applied = seq;
            state.Apply(r);
            Ticked?.Invoke(r);
        }, _ => busy = false); // server away: time simply does not pass
    }

    public override void _Notification(int what)
    {
        if (what == NotificationWMCloseRequest || what == NotificationPredelete) Shutdown();
    }

    public override void _ExitTree() => Shutdown();

    private void OnProcessExit(object? sender, EventArgs e) => Shutdown();

    private bool down;
    /// <summary>The game ends: close the channel, stop the server we started. Safe to call more than once.</summary>
    public void Shutdown()
    {
        if (down) return;
        down = true;
        stopping.Cancel();
        Scheldemist.Menu.Pause.Changed -= OnPause;
        AppDomain.CurrentDomain.ProcessExit -= OnProcessExit;
        Api?.Dispose();
        Api = null;
        joiningApi?.Dispose();
        joiningApi = null;
        Scheldemist.Menu.Pause.ForgetServer();
        if (I == this) I = null;
    }
}
