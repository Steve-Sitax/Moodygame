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

    // ------------------------------------------------------------------ Jef's place for the host's town map (net/mp/together.ts soloMap)

    private bool mapOn;
    private double mapAcc;
    private bool mapBusy;
    private readonly Dictionary<string, (double X, double Z)> soloWas = new();
    /// <summary>The town map's address on this PC (the host's own game only), or empty.</summary>
    public string MapUrl { get; private set; } = "";
    /// <summary>Jef is out of sight indoors or in a menu ("away" on the map). Set by the rooms' or the menus' part.</summary>
    public Func<bool> Away { get; set; } = () => false;
    /// <summary>The townspeople this game moves unseen off their day plan, for the map (town.offPlan()); set by the townspeople's part. Sent once a second.</summary>
    public Func<IEnumerable<MapOff>>? OffPlan { get; set; }
    /// <summary>How many times the map took Jef's place (the checks).</summary>
    public int MapReports { get; private set; }
    private double offAcc;
    private bool offBusy;

    /// <summary>How Jef moves now, in the words the server and the other players know (shared/mpProtocol.ts MpMode).</summary>
    public static string ModeOf(Scheldemist.Player.Jef j) =>
        j.Fly ? "fly" : j.Climbing ? "ladder" : j.Swimming ? "swim" : j.Crouching ? "crouch" : "walk";

    /// <summary>Played alone there is no movement socket: four times a second the game says where Jef is, and the townspeople it draws round him.</summary>
    private void SoloMap(double delta)
    {
        var api = Api;
        var jef = Scheldemist.Player.Jef.I;
        if (api == null || !mapOn || Together || jef == null || !GameState.I.Live) return;
        mapAcc += delta;
        if (mapAcc >= 0.25 && !mapBusy)
        {
            double span = mapAcc;
            mapAcc = 0;
            var people = new List<Dictionary<string, object?>>();
            var town = Main.I.GetNodeOrNull<Scheldemist.Town.Townspeople>("Townspeople");
            if (town != null)
            {
                var seen = new HashSet<string>();
                foreach (var sim in town.Sims)
                {
                    if (sim.P is not { } q) continue;
                    string id = sim.R.Id;
                    double speed = soloWas.TryGetValue(id, out var was) ? Math.Min(8, Math.Sqrt((q.X - was.X) * (q.X - was.X) + (q.Z - was.Z) * (q.Z - was.Z)) / Math.Max(0.05, span)) : 0;
                    soloWas[id] = (q.X, q.Z);
                    seen.Add(id);
                    string motion = q.Human.Motion ?? "idle";
                    people.Add(new Dictionary<string, object?>
                    {
                        ["id"] = id, ["x"] = Math.Round(q.X, 1), ["z"] = Math.Round(q.Z, 1), ["yaw"] = Math.Round(q.Yaw, 2), ["speed"] = Math.Round(speed, 1),
                        ["motion"] = motion, ["sit"] = q.State == "sit", ["lantern"] = false, ["sack"] = q.Loaded, ["bought"] = null, ["vehicle"] = null,
                    });
                    if (people.Count >= 80) break;
                }
                foreach (string id in new List<string>(soloWas.Keys))
                    if (!seen.Contains(id)) soloWas.Remove(id);
            }
            mapBusy = true;
            var body = new Dictionary<string, object?> { ["x"] = jef.X, ["y"] = jef.Y, ["z"] = jef.Z, ["yaw"] = jef.Yaw, ["mode"] = ModeOf(jef), ["away"] = Away(), ["people"] = people };
            api.Run(api.Post<OkReply>("api/map/me", body), r =>
            {
                mapBusy = false;
                if (r.Ok) MapReports++;
            }, _ => mapBusy = false);
        }
        offAcc += delta;
        if (offAcc >= 1 && !offBusy && OffPlan != null)
        {
            offAcc = 0;
            offBusy = true;
            api.Run(api.MapOff(System.Linq.Enumerable.Take(OffPlan(), 400)), _ => offBusy = false, _ => offBusy = false);
        }
    }
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
        int port = int.TryParse(main.Arg("port"), out int p) ? p : ServerProcess.FirstPort;
        // a guest: into another PC's game (the menu's Together screen, or --join address --seat 2 --code X --name N)
        join = Mp.Together.Pending;
        if (join == null && main.Arg("join") != "" && !Mp.Together.LeftAsGuest)
        {
            int seat = int.TryParse(main.Arg("seat"), out int n) ? Math.Max(2, n) : 2;
            string[] names = { "Anna", "Piet", "Mie", "Tist", "Lien", "Rik", "Wannes" };
            join = new Mp.JoinAsk(main.Arg("join"), main.Arg("code") == "" ? null : main.Arg("code"), main.Arg("name", names[Math.Min(names.Length - 1, seat - 2)]), seat);
        }
        var opt = new ServerOptions
        {
            External = join != null ? Mp.Together.AddressOf(join.Address) : main.Arg("server"),
            FirstPort = port,
            // A test uses a fresh database: no player save is opened.
            Db = main.Arg("db") != "" ? main.Arg("db") : main.Arg("mptest") != "" ? Mp.MpTest.TestDb(main) : "",
            // a test never spends model calls
            NoAi = main.Flag("no-ai") || main.Arg("nettest") != "" || main.Arg("mptest") != "",
        };
        var paths = Paths.Server;
        SetStatus(join != null ? $"Looking for the host's game at {opt.External}..." : opt.External != "" ? $"Looking for the game server at {opt.External}..." : "Starting the game server...", "");
        // the game must never leave its server behind: the tree's end, the window's close and the program's end all stop it
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
        var stop = stopping.Token;
        starting = Task.Run(() => ServerProcess.StartAsync(paths, opt, stop));
    }

    /// <summary>The start's outcome, taken up on the main thread (_Process).</summary>
    private Task<ServerProcess>? starting;
    /// <summary>This game is a guest in another PC's game: what it asked to come in with (null: its own game).</summary>
    public Mp.JoinAsk? JoinedAs => join;
    private Mp.JoinAsk? join;
    private Task? joining;
    private Api? joiningApi;

    private void Started(Task<ServerProcess> t)
    {
        if (t.Status != TaskStatus.RanToCompletion)
        {
            if (stopping.IsCancellationRequested) return;
            var e = t.Exception?.GetBaseException();
            string why = e is ServerStartException ? e.Message : $"The game server did not start: {e?.Message ?? "stopped"}";
            if (join != null) why = $"The host's PC does not answer at {Mp.Together.AddressOf(join.Address)}. Is the game running there, and open to others?";
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
        if (join != null)
        {
            // the host must know this player before the first call: the token from the join rides on all of them
            SetStatus("Asking the host...", "");
            joiningApi = api;
            var ask = join;
            joining = Task.Run(() => Mp.Together.JoinAsync(api, ask));
            return;
        }
        Linked(api);
    }

    private void Linked(Api api)
    {
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
        // the state now (the browser's first api.jobs()); the push channel's welcome brings it too
        api.Run(api.Jobs(), state.Apply, e => GD.PrintErr($"the first state did not come: {e.Message}"));
        api.ConnectPush();
        if (Paused) api.HoldPushes(true);
        // the host's own game has a town map on this PC: Jef's place goes to it
        if (!api.Guest)
            api.Run(api.Get<Dictionary<string, string>>("api/map"), m =>
            {
                MapUrl = m.TryGetValue("url", out string? u) ? u : "";
                mapOn = MapUrl != "";
            }, _ => { });
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

    private double pauseRetry;

    public override void _Process(double delta)
    {
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
        if (starting is { IsCompleted: true })
        {
            var t = starting;
            starting = null;
            Started(t);
        }
        var api = Api;
        if (api == null) return;
        api.Pump();
        if ((pauseRetry += delta) >= 2) { pauseRetry = 0; Scheldemist.Menu.Pause.Resend(); }
        // day.ts: a tick every 10 s while Jef plays; through a door (or the lantern up or down) the server hears of it now
        var state = GameState.I;
        if (Paused) return;
        SoloMap(delta);
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
