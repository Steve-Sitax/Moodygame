using System;
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
    public ServerProcess? Server { get; private set; }
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
        var main = Main.I;
        int port = int.TryParse(main.Arg("port"), out int p) ? p : ServerProcess.FirstPort;
        var opt = new ServerOptions
        {
            External = main.Arg("server"),
            FirstPort = port,
            Db = main.Arg("db"),
            // a test never spends model calls
            NoAi = main.Flag("no-ai") || main.Arg("nettest") != "",
        };
        var paths = Paths.Server;
        SetStatus(opt.External != "" ? $"Looking for the game server at {opt.External}..." : "Starting the game server...", "");
        // the game must never leave its server behind: the tree's end, the window's close and the program's end all stop it
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
        var stop = stopping.Token;
        starting = Task.Run(() => ServerProcess.StartAsync(paths, opt, stop));
    }

    /// <summary>The start's outcome, taken up on the main thread (_Process).</summary>
    private Task<ServerProcess>? starting;

    private void Started(Task<ServerProcess> t)
    {
        if (t.Status != TaskStatus.RanToCompletion)
        {
            if (stopping.IsCancellationRequested) return;
            var e = t.Exception?.GetBaseException();
            string why = e is ServerStartException ? e.Message : $"The game server did not start: {e?.Message ?? "stopped"}";
            GD.PrintErr(why);
            SetStatus("", why);
            return;
        }
        Server = t.Result;
        if (stopping.IsCancellationRequested || !IsInsideTree())
        {
            Server.Stop();
            return;
        }
        GD.Print($"game server {(Server.Own ? $"started (pid {Server.Pid})" : "found")}: {Server.Url}");
        var api = new Api(Server.Url);
        api.Failed += e => GD.PrintErr($"a push handler failed: {e}");
        var state = GameState.I;
        api.JobsPushed += state.Apply;
        api.LinkChanged += on =>
        {
            if (!on && Error == "") SetStatus("Connection lost, trying again...", "");
            else if (on) SetStatus("", Error);
        };
        Api = api;
        SetStatus("", "");
        // the state now (the browser's first api.jobs()); the push channel's welcome brings it too
        api.Run(api.Jobs(), state.Apply, e => GD.PrintErr($"the first state did not come: {e.Message}"));
        api.ConnectPush();
        var waiting = up;
        up = null;
        waiting?.Invoke();
    }

    private void SetStatus(string status, string error)
    {
        if (status == Status && error == Error) return;
        Status = status;
        Error = error;
        StatusChanged?.Invoke();
    }

    public override void _Process(double delta)
    {
        if (starting is { IsCompleted: true })
        {
            var t = starting;
            starting = null;
            Started(t);
        }
        var api = Api;
        if (api == null) return;
        api.Pump();
        // day.ts: a tick every 10 s while Jef plays; through a door (or the lantern up or down) the server hears of it now
        var state = GameState.I;
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
        AppDomain.CurrentDomain.ProcessExit -= OnProcessExit;
        Api?.Dispose();
        Api = null;
        // a start still on its way: it ends by the cancel and stops what it started; one that just came up is stopped here
        var t = starting;
        starting = null;
        if (t != null)
        {
            try
            {
                if (t.Wait(5000)) t.Result.Stop();
            }
            catch (AggregateException)
            {
                // it did not come up
            }
        }
        Server?.Stop();
        if (I == this) I = null;
    }
}
