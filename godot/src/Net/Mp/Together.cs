using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.Windows;

namespace Scheldemist.Net.Mp;

/// <summary>What a guest asks to come into a host's game with.</summary>
public sealed record JoinAsk(string Address, string? Code, string Name, int Seat);

/// <summary>The house as the host sees it (/api/mp/host, /api/mp/config).</summary>
public sealed record HostView
{
    public bool Multiplayer { get; init; }
    public bool Lan { get; init; }
    public bool Vpn { get; init; }
    /// <summary>The addresses the server listens on for the house now, as it sent them.</summary>
    public JsonElement? Open { get; init; }
    /// <summary>The addresses the house may type (http://192.168.1.20:8800).</summary>
    public List<string> Urls { get; init; } = new();
    public string Code { get; init; } = "";
    public List<RosterEntry> Players { get; init; } = new();
    [System.Text.Json.Serialization.JsonPropertyName("pausedAll")] public bool PausedAll { get; init; }
}

/// <summary>/api/mp/info: is the game there played together, and who this game is to it.</summary>
public sealed record MpInfo
{
    public bool Multiplayer { get; init; }
    public int Protocol { get; init; }
    public string Version { get; init; } = "";
    public MpYou? You { get; init; }
    [System.Text.Json.Serialization.JsonPropertyName("pausedAll")] public bool PausedAll { get; init; }
}

public sealed record MpYou
{
    public int Id { get; init; }
    public bool Host { get; init; }
    public bool Guest { get; init; }
    public bool Admin { get; init; }
    public string Name { get; init; } = "";
}

/// <summary>Another player's boat, velocipede or handcart, drawn with him (net/mp/gear.ts): made by the part that owns that kind.</summary>
public interface IGearModel
{
    /// <summary>Put it where he is: (x, y, z) his place, heading where it points, dt for the wheels.</summary>
    void Place(float x, float y, float z, float heading, float dt, bool shown);
    void Dispose();
}

/// <summary>
/// Play together (net/mp/together.ts; docs/multiplayer-plan.md, docs/milestones/M8a.md and after): the Godot game
/// as host and as guest.
/// - It sends this player's own state 20 times a second; his walking, jumping, swimming and looking stay his own
///   PC's: nothing received ever moves him or his camera (a soft push apart, when two stand in each other).
/// - It draws the others a little in the past (RemoteTrack: 100 ms to start, 80 to 250 by what the line does;
///   Hermite curves between states; 250 ms on by guess at most), with their names over their heads.
/// - Played together nothing pauses: a window or the menu opens over a running town and the player shows
///   "away"; only the host's "Pause all" stops everyone.
/// - Each player's money, needs, pockets and jobs are his own: the server keeps them by his id and every call
///   carries his token.
///
/// For the menus' part:
///   Together.I.Host(lan)                  play together from this game (lan: open to the house too); the code and the addresses come back
///   Together.I.StopHosting()              alone again
///   Together.I.Join(address, code, name)  leave this game and come into another PC's as a guest (the scene loads again)
///   Together.I.Leave()                    a guest goes home: his own game again
///   Together.I.PauseAll(on)               the host's "Pause all"
///   On, Guest, PlayerId, Roster, House; Changed, RosterChanged
/// For the parts with gear (boats, velocipedes, handcarts): Gear says what this player rows, rides or pushes,
/// GearModel makes another player's. For the tests: `-- --host`, `-- --join address --seat 2 [--code X --name N]`.
/// Not here yet: the townspeople, animals, job figures and the moving world walked by one PC for all (street.ts,
/// extras.ts, jobfigs.ts, world.ts): each Godot game walks its own from the same clock.
/// </summary>
[GamePart(130)]
public partial class Together : Node
{
    public static Together? I { get; private set; }

    /// <summary>A join asked for from inside a running game: the scene loads again and the link reads this.</summary>
    public static JoinAsk? Pending { get; set; }

    private const float Radius = 0.32f;
    private const float PushM = 0.55f;

    /// <summary>Played together now.</summary>
    public bool On { get; private set; }
    /// <summary>The movement channel has welcomed this player (On alone means it is still starting).</summary>
    public bool Connected => session is { Open: true, Id: > 0 };
    /// <summary>This game came into another PC's game.</summary>
    public bool Guest => ServerLink.I?.Api is { Guest: true };
    /// <summary>This player's id (1: the host, and alone).</summary>
    public int PlayerId => session is { Id: > 0 } s ? s.Id : 1;
    public IReadOnlyList<RosterEntry> Roster => roster;
    /// <summary>The house as the host last saw it (the code, the addresses), or null.</summary>
    public HostView? House { get; private set; }
    /// <summary>Paused by the host for everyone.</summary>
    public bool PausedAll { get; private set; }
    /// <summary>Together turned on or off, the house changed, or "pause all".</summary>
    public event Action? Changed;
    public event Action? RosterChanged;
    /// <summary>The line to the host was lost (false) or is back (true).</summary>
    public event Action<bool>? LinkChanged;

    /// <summary>The menu is up or the window lost the mouse: he stands there, "away". The menus' part sets it.</summary>
    public Func<bool>? Away { get; set; }
    /// <summary>Which body of the people model another player gets (until his look is ported): from his roster entry.</summary>
    public Func<RosterEntry, string>? FigureKind { get; set; }
    /// <summary>M8b: what this player rows, rides or pushes now (MpProtocol.Gear*, which one, where it points), or null.</summary>
    public Func<(int Kind, int Sub, float Heading)?>? Gear { get; set; }
    /// <summary>M8b: a model of another player's gear (kind, which one); null: none drawn.</summary>
    public Func<int, int, IGearModel?>? GearModel { get; set; } = RemoteGear.Make;
    /// <summary>A footstep of another player at his feet: where, hurrying, how loud (0 to 0.8). The sound part listens.</summary>
    public event Action<Vector3, bool, float>? Footstep;
    /// <summary>A binary batch for a part not ported yet (townspeople 3, job figures 4, animals 5).</summary>
    public event Action<byte, byte[], double>? OtherBatch;
    /// <summary>Any other message of the movement socket ("owners", "worldpc", "world", "pins" ...).</summary>
    public event Action<string, JsonElement>? OtherText;

    private MpSession? session;
    private List<RosterEntry> roster = new();
    private readonly Dictionary<int, RemoteTrack> tracks = new();
    private readonly Dictionary<int, RemoteFigure> figs = new();
    private readonly Dictionary<int, float> looks = new();
    private readonly Dictionary<int, Shown> shown = new();
    private readonly Dictionary<int, (int Code, IGearModel? Model)> gears = new();

    private sealed class Shown
    {
        public float X, Y, Z, Vx, Vz, Ex, Ey, Ez;
    }

    // own pose as of the last frame (server time) and the one before (for the velocity)
    private (double T, float X, float Y, float Z) now, prev;
    private bool wasGrounded = true, jumpedSince, landedSince, snapNext, stepSince, placedGuest;
    private double gameT, anchor = double.NaN;
    private double sendAcc, pingAcc;
    private bool hooked;

    // the harness's numbers
    private int frames, camSnaps;
    private float maxCamStep;
    private Vector3? lastCam;
    private sealed class RemoteMeter
    {
        public int Frames;
        public float MaxStep, LastX = float.NaN, LastZ = float.NaN;
        public readonly List<float> Steps = new();
    }
    private readonly Dictionary<int, RemoteMeter> meter = new();

    public Together()
    {
        I = this;
    }

    public override void _Ready()
    {
        // together nothing pauses, and under the host's "pause all" this game still says where it stands
        ProcessMode = ProcessModeEnum.Always;
        ServerLink.I?.WhenUp(Begin);
    }

    public override void _ExitTree()
    {
        End();
        if (I == this) I = null;
    }

    // ------------------------------------------------------------------ starting and stopping

    /// <summary>The server answers: is its game played together? (The host's own setting from last time, or the game a guest came into.)</summary>
    private void Begin()
    {
        var link = ServerLink.I!;
        var api = link.Api!;
        api.OtherPushed += OnPush;
        api.SystemPushed += OnPush;
        api.Run(api.Get<MpInfo>("api/mp/info"), info =>
        {
            if (info.Multiplayer) StartSession();
            else if (Main.I.Flag("host")) _ = Host(Main.I.Flag("house"));
            if (info.PausedAll) SetPausedAll(true);
        }, e => GD.PrintErr($"together: {e.Message}"));
    }

    private void OnPush(PushMsg m)
    {
        if (m.Type == "mp_pause_all" && m.Body.TryGetProperty("on", out var paused))
        {
            SetPausedAll(paused.ValueKind == JsonValueKind.True);
            return;
        }
        // the host turned playing together on or off (another window of his, or this one)
        if (m.Type == "mp" && m.Body.TryGetProperty("multiplayer", out var on) && on.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            if (on.GetBoolean() && !On) StartSession();
            else if (!on.GetBoolean() && On) End();
        }
    }

    private void StartSession()
    {
        var link = ServerLink.I;
        if (link?.Api is not { } api || session != null) return;
        On = true;
        link.SetTogether(true);
        var s = new MpSession(api.Url, api.Token, Guest ? Math.Max(2, seat) : 1);
        session = s;
        s.Batch += OnBatch;
        s.Roster += r =>
        {
            roster = r;
            DressAll();
            RosterChanged?.Invoke();
        };
        s.Welcome += OnWelcome;
        s.Text += OnText;
        s.Other += (k, d, at) => OtherBatch?.Invoke(k, d, at);
        s.LinkChanged += up =>
        {
            link.Note(up ? "" : (s.Ever ? "Connection lost, trying again..." : "The host's game does not answer yet, trying again..."));
            if (up && s.Reconnects > 0) GameState.I.Say("Connected again.");
            LinkChanged?.Invoke(up);
        };
        if (!hooked && Jef.I != null)
        {
            hooked = true;
            Jef.I.Stepped += _ => stepSince = true;
        }
        s.Start();
        Changed?.Invoke();
    }

    private void End()
    {
        if (session == null && !On) return;
        session?.Dispose();
        session = null;
        On = false;
        foreach (int id in figs.Keys.ToList()) Drop(id);
        tracks.Clear();
        roster = new List<RosterEntry>();
        if (PausedAll) SetPausedAll(false);
        ServerLink.I?.SetTogether(false);
        Scheldemist.Menu.Pause.Together = false;
        Scheldemist.Menu.Pause.Set("host", false);
        ServerLink.I?.Note("");
        Changed?.Invoke();
        RosterChanged?.Invoke();
    }

    private int seat = 2;

    // ------------------------------------------------------------------ for the menu

    /// <summary>Play together from this game: the others come in with the code. lan: open to the house too (else this PC only).</summary>
    public async Task<HostView> Host(bool lan = false)
    {
        if (ServerLink.I?.Api is not { } api) throw new ApiException("The game server is not up yet.", 0);
        if (api.Guest) throw new ApiException("You are a guest in another game: go home first.", 0);
        await api.Post<JsonElement>("api/mp/config", new Dictionary<string, object?> { ["multiplayer"] = true, ["lan"] = lan }, 20_000);
        var view = await api.Get<HostView>("api/mp/host");
        House = view;
        if (!On) StartSession();
        Changed?.Invoke();
        return view;
    }

    /// <summary>The house now (who is in, the code), for the host's panel.</summary>
    public async Task<HostView> Refresh()
    {
        if (ServerLink.I?.Api is not { } api) throw new ApiException("The game server is not up yet.", 0);
        House = await api.Get<HostView>("api/mp/host");
        Changed?.Invoke();
        return House;
    }

    /// <summary>The host plays alone again: the guests are told the game is closed.</summary>
    public async Task StopHosting()
    {
        if (ServerLink.I?.Api is not { Guest: false } api) return;
        await api.Post<JsonElement>("api/mp/config", new Dictionary<string, object?> { ["multiplayer"] = false, ["lan"] = false, ["vpn"] = false }, 20_000);
        End();
    }

    /// <summary>The host removes a player, or makes him an admin.</summary>
    public Task Kick(int id) => ServerLink.I!.Api!.Post<JsonElement>("api/mp/kick", new { id });
    public Task SetAdmin(int id, bool on) => ServerLink.I!.Api!.Post<JsonElement>("api/mp/admin", new { id, on });
    /// <summary>The host's "Pause all": the town waits for everyone.</summary>
    public async Task PauseAll(bool on)
    {
        var reply = await ServerLink.I!.Api!.Post<JsonElement>("api/mp/pause-all", new { on });
        if (reply.TryGetProperty("pausedAll", out var paused)) SetPausedAll(paused.ValueKind == JsonValueKind.True);
    }

    /// <summary>
    /// Come into another PC's game as a guest: its address ("192.168.1.20:8800" or with http://), the code on the
    /// host's screen (not needed again on a PC that was in before), a first name. This game ends and starts again
    /// in the host's town; the game's own server is stopped.
    /// </summary>
    public void Join(string address, string? code = null, string name = "Anna", int seat = 2)
    {
        // A code alone joins the server this game already knows; another PC also needs its address.
        if (System.Text.RegularExpressions.Regex.IsMatch(address.Trim(), "^[A-Za-z]{4}-?[0-9]{2}$"))
        {
            code = address.Trim();
            address = ServerLink.I?.Api?.Url ?? throw new ApiException("Type the host's address first.", 400);
        }
        Scheldemist.Menu.Pause.Clear();
        Pending = new JoinAsk(address, code, name, seat);
        GetTree().CallDeferred(SceneTree.MethodName.ReloadCurrentScene);
    }

    /// <summary>A guest goes home: his own game again. (The host: StopHosting.)</summary>
    public void Leave()
    {
        if (!Guest) return;
        Scheldemist.Menu.Pause.Clear();
        Pending = null;
        LeftAsGuest = true;
        GetTree().CallDeferred(SceneTree.MethodName.ReloadCurrentScene);
    }

    /// <summary>The guest went home: the link starts its own server even when the game was started with --join.</summary>
    public static bool LeftAsGuest { get; private set; }

    // ------------------------------------------------------------------ joining (before the game's first call)

    private static string TokenFile => Main.I.Arg("mptest") != ""
        ? System.IO.Path.Combine(System.IO.Path.GetFullPath(Main.I.Arg("mptest")), "mp-tokens.json")
        : ProjectSettings.GlobalizePath("user://mp-tokens.json");

    private static Dictionary<string, string> Tokens()
    {
        try
        {
            if (System.IO.File.Exists(TokenFile)) return JsonSerializer.Deserialize<Dictionary<string, string>>(System.IO.File.ReadAllText(TokenFile)) ?? new();
        }
        catch (Exception e) when (e is System.IO.IOException or JsonException)
        {
            // a new join then
        }
        return new();
    }

    private static void KeepToken(string key, string? token)
    {
        var all = Tokens();
        if (token == null) all.Remove(key);
        else all[key] = token;
        try
        {
            System.IO.File.WriteAllText(TokenFile, JsonSerializer.Serialize(all));
        }
        catch (System.IO.IOException)
        {
            // not kept: the code is asked for again next time
        }
    }

    /// <summary>"192.168.1.20:8800" to "http://192.168.1.20:8800".</summary>
    public static string AddressOf(string typed)
    {
        string a = typed.Trim().TrimEnd('/');
        return a.Contains("://") ? a : "http://" + a;
    }

    /// <summary>
    /// boot/netboot.ts whoAmI, for a guest: the token kept for this host and seat if the host still knows it, else a
    /// join with the code. The token goes on the client; every call after is this player's. Throws ApiException
    /// with words for the player when the host says no.
    /// </summary>
    public static async Task JoinAsync(Api api, JoinAsk ask)
    {
        string key = $"{api.Url}|{ask.Seat}";
        string? token = Tokens().GetValueOrDefault(key);
        MpInfo? info = null;
        if (token != null)
        {
            api.Token = token;
            try
            {
                info = await api.Get<MpInfo>("api/mp/info").ConfigureAwait(false);
                if (info.You == null) token = null; // the host removed him, or a new save: join again
            }
            catch (ApiException e) when (e.Status is 401 or 403)
            {
                token = null;
            }
            if (token == null)
            {
                api.Token = null;
                KeepToken(key, null);
            }
        }
        if (token == null)
        {
            info = await api.Get<MpInfo>("api/mp/info").ConfigureAwait(false);
            if (!info.Multiplayer) throw new ApiException("The game on the host's PC is not open to others. Ask the host to open it (Together), then join again.", 409);
            string? code = ask.Code;
            if (string.IsNullOrWhiteSpace(code) && new Uri(api.Url).IsLoopback)
            {
                // tests: a second game on the host's own PC joins with the code the host's side can read
                code = (await api.Get<HostView>("api/mp/host").ConfigureAwait(false)).Code;
            }
            if (string.IsNullOrWhiteSpace(code)) throw new ApiException("Type the code on the host's screen.", 400);
            var r = await api.Post<Dictionary<string, JsonElement>>("api/mp/join", new { code, name = ask.Name }).ConfigureAwait(false);
            token = r.TryGetValue("token", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
            if (token == null) throw new ApiException("The host did not let you in.", 403);
            KeepToken(key, token);
            api.Token = token;
        }
        if (info is { Protocol: not MpProtocol.Protocol }) throw new ApiException("The host has another version of the game. Both need the same download.", 409);
    }

    // ------------------------------------------------------------------ what comes in

    private void OnWelcome(JsonElement w)
    {
        // A pause may have changed while the movement socket was away; welcome has no gate state.
        int revision = pauseRevision;
        if (ServerLink.I?.Api is { } api)
            api.Run(api.Get<MpInfo>("api/mp/info"), info => { if (pauseRevision == revision) SetPausedAll(info.PausedAll); });
        if (ServerLink.I?.Api is { Guest: true } && Main.I.Arg("seat") is { Length: > 0 } s && int.TryParse(s, out int n)) seat = n;
        // a guest who was here before starts where he stood
        if (!placedGuest && w.TryGetProperty("pose", out var p) && p.ValueKind == JsonValueKind.Object && Jef.I != null)
        {
            placedGuest = true;
            Jef.I.Place(p.GetProperty("x").GetSingle(), p.GetProperty("z").GetSingle(), p.GetProperty("yaw").GetSingle());
            snapNext = true;
        }
        Changed?.Invoke();
    }

    private void OnBatch(List<(int Id, MpState S)> list, double serverNow, double recv)
    {
        foreach (var (id, s) in list)
        {
            if (!tracks.TryGetValue(id, out var tr)) tracks[id] = tr = new RemoteTrack();
            tr.Push(s, recv);
        }
        PlaceGuest(list);
    }

    /// <summary>A guest with no place of his own starts beside the host (once, when the host is first heard of).</summary>
    private void PlaceGuest(List<(int Id, MpState S)> list)
    {
        if (placedGuest || !Guest || Jef.I == null) return;
        int at = list.FindIndex(e => e.Id == 1);
        if (at < 0) return;
        placedGuest = true;
        var h = list[at].S;
        foreach (var (ox, oz) in new[] { (1.6f, 0f), (-1.6f, 0f), (0f, 1.6f), (0f, -1.6f), (2.4f, 2.4f) })
        {
            float x = h.X + ox * MathF.Cos(h.Yaw) + oz * MathF.Sin(h.Yaw);
            float z = h.Z - ox * MathF.Sin(h.Yaw) + oz * MathF.Cos(h.Yaw);
            if (!Jef.I.StandFree(x, z, h.Y)) continue;
            Jef.I.Place(x, z, h.Yaw, 0, h.Y);
            snapNext = true;
            GameState.I.Say("You come into the town next to the host.");
            return;
        }
    }

    private void OnText(string type, JsonElement m)
    {
        string Str(string k) => m.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        switch (type)
        {
            case "went":
                if (m.TryGetProperty("id", out var id)) Drop(id.GetInt32());
                GameState.I.Say($"{Str("name")} went home.");
                break;
            case "pause_all":
                SetPausedAll(m.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True);
                break;
            case "old":
                GameState.I.Say("The host has another version of the game. Both need the same download.");
                break;
            case "kicked":
                GameState.I.Say("The host took you out of the game.");
                break;
            case "refused":
                GameState.I.Say(Str("why"));
                break;
            default:
                OtherText?.Invoke(type, m);
                break;
        }
    }

    private void Drop(int id)
    {
        if (gears.Remove(id, out var g)) g.Model?.Dispose();
        shown.Remove(id);
        looks.Remove(id);
        if (figs.Remove(id, out var f)) f.Dispose();
        tracks.Remove(id);
        meter.Remove(id);
    }

    private string KindOf(RosterEntry r)
    {
        if (FigureKind != null) return FigureKind(r);
        // shared/character.ts appearanceCode: "A", then the sex (1: a woman)
        bool woman = r.Code.Length > 1 && r.Code[1] == 'B';
        foreach (string k in woman ? new[] { "maid", "wife_a", "shopwife" } : new[] { "docker", "labourer", "clerk", "sailor" })
            if (People.Humans.IsKind(k)) return k;
        return People.Humans.Kinds.FirstOrDefault() ?? "docker";
    }

    private void DressAll()
    {
        var online = new HashSet<int>();
        foreach (var r in roster)
        {
            if (r.Id == session?.Id || !r.Online) continue;
            online.Add(r.Id);
            if (!figs.TryGetValue(r.Id, out var f)) figs[r.Id] = f = new RemoteFigure(r.Id);
            f.Dress(r, KindOf(r));
        }
        foreach (int id in figs.Keys.ToList())
            if (!online.Contains(id)) Drop(id);
    }

    // ------------------------------------------------------------------ pause all

    private Sheet? card;
    private int pauseRevision;

    private void SetPausedAll(bool on)
    {
        if (on == PausedAll) return;
        PausedAll = on;
        pauseRevision++;
        ServerLink.I?.SetPause("host", on);
        card?.Card.QueueFree();
        card = null;
        if (on && Dialogs.I is { } dialogs)
        {
            var win = GetViewport().GetVisibleRect().Size;
            float s = dialogs.Ui;
            var sh = new Sheet(s, Math.Min(420 * s, win.X * 0.86f) + 88 * s, Css.Hex("d8cfb8"), (44, 28, 44, 28), -1.2f, sepia: 0.3f, contrast: 0.95f, shadow: 30, drop: 6, shadowAlpha: 0.7f)
            {
                Where = (v, size) => (v - size) / 2,
            };
            sh.Card.ProcessMode = ProcessModeEnum.Always;
            sh.Text("[b]Paused[/b]", Face.Hand, 42, bottom: 6, align: HorizontalAlignment.Center);
            sh.Text("Paused by the host. The town waits for everyone.", Face.Hand, 16, bottom: 18, align: HorizontalAlignment.Center);
            sh.Text(Guest ? "" : "G  go on for everyone", Face.Print, 14, 0.9f, align: HorizontalAlignment.Center);
            dialogs.Layer.AddChild(sh.Card);
            sh.Place();
            card = sh;
        }
        Changed?.Invoke();
    }

    public override void _UnhandledKeyInput(InputEvent e)
    {
        if (!PausedAll || Guest || e is not InputEventKey { Pressed: true, Echo: false } k) return;
        if (Dialogs.CodeOf(k) != "KeyG") return;
        GetViewport().SetInputAsHandled();
        _ = PauseAll(false);
    }

    // ------------------------------------------------------------------ own state

    /// <summary>
    /// The time of each own frame on the server's clock, run on by the frames' own dt and kept to the server's clock
    /// gently (a jump only if it drifted a quarter second): so the times and the places sent always agree, even when
    /// frames come unevenly.
    /// </summary>
    private double FrameTime(double dt)
    {
        double sn = session?.ServerNow ?? Time.GetTicksMsec();
        gameT += dt * 1000;
        double err = sn - (anchor + gameT);
        if (double.IsNaN(anchor) || Math.Abs(err) > 250) anchor = sn - gameT;
        else anchor += Math.Max(-dt * 50, Math.Min(dt * 50, err));
        return anchor + gameT;
    }

    private void OwnFrame(double dt)
    {
        var p = Jef.I;
        double t = FrameTime(dt);
        prev = now;
        now = (t, p.X, p.Y, p.Z);
        bool grounded = p.Grounded;
        if (wasGrounded && !grounded && !p.Swimming) jumpedSince = true;
        if (!wasGrounded && grounded) landedSince = true;
        wasGrounded = grounded;
        // a jump of place (a load, a ladder's top, a test's jump): no in-between for the others
        double span = (now.T - prev.T) / 1000;
        if (prev.T > 0 && Dist(now.X - prev.X, now.Z - prev.Z) > 1 + 8 * Math.Max(0, span)) snapNext = true;
    }

    private static float Dist(float dx, float dz) => MathF.Sqrt(dx * dx + dz * dz);

    private bool IsAway()
    {
        if (Away != null) return Away();
        // no part says: away when the mouse is not the game's and no window of the game is up (a test walks by script)
        return Input.MouseMode != Input.MouseModeEnum.Captured && Jef.I is { TestInput: false } && Dialogs.I is not { Any: true };
    }

    private MpState? Sample(double serverNow)
    {
        var p = Jef.I;
        if (p == null || !GameState.I.Live) return null;
        var ownGear = Gear?.Invoke();
        string mode = ownGear?.Kind == MpProtocol.GearRowboat ? "row" : ownGear?.Kind == MpProtocol.GearVelo ? "bike" : ServerLink.ModeOf(p);
        // the pose's own time; a game that draws no frames says where it stands now
        bool fresh = now.T > 0 && serverNow - now.T < 120;
        double t = fresh ? now.T : serverNow;
        if (!fresh) now = (t, p.X, p.Y, p.Z);
        float dt = (float)Math.Max(1e-3, (now.T - prev.T) / 1000);
        bool grounded = p.Grounded;
        bool moving = fresh && prev.T > 0 && !snapNext;
        float vx = moving ? (now.X - prev.X) / dt : 0;
        float vz = moving ? (now.Z - prev.Z) / dt : 0;
        const float cap = 9;
        float h = Dist(vx, vz);
        if (h > cap)
        {
            vx *= cap / h;
            vz *= cap / h;
        }
        float vy = !moving ? 0 : Math.Clamp((now.Y - prev.Y) / dt, -8, 8);
        int flags = 0;
        if (grounded || p.Swimming) flags |= MpProtocol.FlagGrounded;
        if (p.Hurrying) flags |= MpProtocol.FlagHurry;
        if (IsAway()) flags |= MpProtocol.FlagAway;
        if (snapNext) flags |= MpProtocol.FlagSnap;
        if (jumpedSince) flags |= MpProtocol.FlagJumped;
        if (landedSince) flags |= MpProtocol.FlagLanded;
        if (stepSince) flags |= MpProtocol.FlagStep;
        snapNext = jumpedSince = landedSince = stepSince = false;
        var s = new MpState { T = t, X = now.X, Y = now.Y, Z = now.Z, Vx = vx, Vy = vy, Vz = vz, Yaw = p.Yaw, Pitch = p.Pitch, Mode = MpProtocol.ModeIndex(mode), Flags = flags };
        // M8b: what he rows, rides or pushes: the others draw it with him; its heading goes in Lyaw
        if (ownGear is { } g)
        {
            s.Gear = (g.Kind & 3) | ((g.Sub & 63) << 2);
            s.Lyaw = g.Heading;
        }
        return s;
    }

    // ------------------------------------------------------------------ each frame

    public override void _Process(double delta)
    {
        var jef = Jef.I;
        if (jef == null) return;
        float dt = (float)delta;
        OwnFrame(delta);
        MeterCamera();
        var s = session;
        if (s == null) return;
        s.Pump();
        // own state 20 times a second and a ping every second, by real time (a paused tree still says where it stands)
        sendAcc += delta * 1000;
        if (sendAcc >= MpProtocol.SendMs)
        {
            sendAcc = Math.Min(sendAcc - MpProtocol.SendMs, MpProtocol.SendMs);
            if (Sample(s.ServerNow) is { } st) s.SendState(st);
        }
        pingAcc += delta;
        if (pingAcc >= 1)
        {
            pingAcc = 0;
            s.Ping();
        }
        // the others are drawn on the same frame clock (frame by frame as the frames' dt says: no bunching)
        double sn = now.T;
        foreach (var (id, tr) in tracks)
        {
            figs.TryGetValue(id, out var f);
            tr.Adapt(delta * 1000);
            var sampled = tr.Sample(sn);
            if (f == null || sampled == null)
            {
                f?.Hide();
                if (gears.TryGetValue(id, out var g0)) g0.Model?.Place(0, 0, 0, 0, dt, false);
                continue;
            }
            var pose = sampled.Value;
            HideCorrection(id, ref pose, dt);
            f.Place(pose, dt);
            looks[id] = pose.Yaw;
            PlaceGear(id, pose, dt, f.Shown);
            MeterRemote(id, f, dt);
            if (f.Stepped)
            {
                float d = Dist(f.At.X - jef.X, f.At.Z - jef.Z);
                if (d < 14) Footstep?.Invoke(f.At, f.Hurry, MathF.Pow(1 - d / 14, 2) * 0.8f);
            }
            // a soft push: a late figure can never block a door; two men do not stand in each other
            if (!jef.Climbing && !jef.Fly && f.Shown)
            {
                float dx = jef.X - f.At.X, dz = jef.Z - f.At.Z;
                float dd = Dist(dx, dz);
                if (dd < 1e-3f)
                {
                    // right on top of each other: the one with the higher id steps aside
                    dd = 1e-3f;
                    dx = (s.Id > id ? 1 : -1) * MathF.Cos(jef.Yaw) * dd;
                    dz = (s.Id > id ? -1 : 1) * MathF.Sin(jef.Yaw) * dd;
                }
                if (dd < PushM && Math.Abs(jef.Y - f.At.Y) < 1.2f)
                {
                    float k = (PushM - dd) * Math.Min(1, dt * 6);
                    float nx = jef.X + dx / dd * k, nz = jef.Z + dz / dd * k;
                    if (jef.StandFree(nx, nz, jef.Y))
                    {
                        jef.X = nx;
                        jef.Z = nz;
                        now.X = nx;
                        now.Z = nz;
                    }
                }
            }
        }
        if (figs.Count > 0 && Main.I.Cam is { } cam)
        {
            var win = GetViewport().GetVisibleRect().Size;
            var view = (Vector2)Main.I.View.Size;
            foreach (var f in figs.Values) f.DrawTag(cam, win, view);
        }
    }

    /// <summary>
    /// A late state after a stall puts him somewhere other than where he was drawn going on. Never a snap: the
    /// difference is kept as an offset that fades in about a tenth of a second. Not for a snap of his (a ladder, a
    /// seat): he is simply there.
    /// </summary>
    private void HideCorrection(int id, ref Pose p, float dt)
    {
        bool snap = (p.Flags & MpProtocol.FlagSnap) != 0;
        shown.TryGetValue(id, out var last);
        if (last != null && !snap)
        {
            // where he would be now had he gone on as drawn
            float gx = last.X - last.Ex + last.Vx * dt;
            float gz = last.Z - last.Ez + last.Vz * dt;
            float jump = Dist(p.X - gx, p.Z - gz);
            if (jump > 0.04f && jump < 3)
            {
                last.Ex += gx - p.X;
                last.Ez += gz - p.Z;
            }
            float dy = Math.Abs(p.Y - (last.Y - last.Ey));
            if (dy > 0.25f && dy < 2) last.Ey += last.Y - last.Ey - p.Y;
            float k = MathF.Exp(-dt / 0.1f);
            last.Ex *= k;
            last.Ey *= k;
            last.Ez *= k;
        }
        float ex = last != null && !snap ? last.Ex : 0, ey = last != null && !snap ? last.Ey : 0, ez = last != null && !snap ? last.Ez : 0;
        var o = new Shown { X = p.X + ex, Y = p.Y + ey, Z = p.Z + ez, Vx = p.Vx, Vz = p.Vz, Ex = ex, Ey = ey, Ez = ez };
        shown[id] = o;
        p.X = o.X;
        p.Y = o.Y;
        p.Z = o.Z;
    }

    private void PlaceGear(int id, in Pose p, float dt, bool visible)
    {
        if (!gears.TryGetValue(id, out var g) || g.Code != p.Gear)
        {
            g.Model?.Dispose();
            g = (p.Gear, p.Gear != 0 ? GearModel?.Invoke(p.Gear & 3, p.Gear >> 2) : null);
            gears[id] = g;
        }
        g.Model?.Place(p.X, p.Y, p.Z, p.Lyaw, dt, visible);
    }

    // ------------------------------------------------------------------ for the other parts

    /// <summary>Where player `id` stands: this PC's own player, or another as drawn here (null: not in view, or gone).</summary>
    public Vector3? PlayerAt(int id)
    {
        if (id == PlayerId && Jef.I != null) return new Vector3(Jef.I.X, Jef.I.Y, Jef.I.Z);
        return figs.TryGetValue(id, out var f) && f.Shown ? f.At : null;
    }

    /// <summary>The others where they are drawn (the bridges do not open under them; the carts wait for them).</summary>
    public IEnumerable<Vector3> Positions() => figs.Values.Where(f => f.Shown).Select(f => f.At);

    /// <summary>Another player's figure, for what he carries (the goods' part), or null.</summary>
    public RemoteFigure? FigureOf(int id) => figs.GetValueOrDefault(id);

    /// <summary>Send a message of the movement socket for a part that shares its own things (a claim, an ask).</summary>
    public bool SendText(object message) => session?.SendText(message) ?? false;
    public bool SendBinary(byte[] frame) => session?.SendBinary(frame) ?? false;
    /// <summary>The server's clock now (ms); 0 alone.</summary>
    public double ServerNow => session?.ServerNow ?? 0;

    // ------------------------------------------------------------------ the harness's numbers

    private void MeterCamera()
    {
        if (Main.I.Cam is not { } cam) return;
        var c = cam.GlobalPosition;
        if (lastCam is { } was)
        {
            float step = c.DistanceTo(was);
            maxCamStep = Math.Max(maxCamStep, step);
            // faster than any walk, hurry or fall could take it in one frame: a snap (a Place of a test is one too)
            if (step > 0.6f) camSnaps++;
        }
        frames++;
        lastCam = c;
    }

    private void MeterRemote(int id, RemoteFigure f, float dt)
    {
        if (!meter.TryGetValue(id, out var m)) meter[id] = m = new RemoteMeter();
        if (!float.IsNaN(m.LastX) && dt > 1e-4f)
        {
            float s = Dist(f.At.X - m.LastX, f.At.Z - m.LastZ);
            m.MaxStep = Math.Max(m.MaxStep, s);
            m.Steps.Add(s / dt); // his speed as drawn this frame (m/s)
            if (m.Steps.Count > 3600) m.Steps.RemoveAt(0);
        }
        m.Frames++;
        m.LastX = f.At.X;
        m.LastZ = f.At.Z;
    }

    /// <summary>For the harness (the browser's mp.report()): the numbers so far, and each remote's jitter buffer.</summary>
    public Dictionary<string, object?> Report()
    {
        var remotes = new List<Dictionary<string, object?>>();
        foreach (var (id, m) in meter)
        {
            // jitter: how far his drawn speed from frame to frame wanders from his steady pace (the median), m/s;
            // times the frame (1/60 s) it is the wobble in metres
            var sorted = m.Steps.OrderBy(v => v).ToList();
            float med = sorted.Count > 0 ? sorted[sorted.Count / 2] : 0;
            var d = m.Steps.Select(v => Math.Abs(v - med)).OrderBy(v => v).ToList();
            float p95 = d.Count > 0 ? d[(int)Math.Floor(d.Count * 0.95)] : 0;
            tracks.TryGetValue(id, out var tr);
            remotes.Add(new Dictionary<string, object?>
            {
                ["id"] = id, ["name"] = figs.GetValueOrDefault(id)?.Name, ["frames"] = m.Frames, ["pace"] = Math.Round(med, 3), ["maxStep"] = Math.Round(m.MaxStep, 3),
                ["speedDevP95"] = Math.Round(p95, 3), ["speedDevMax"] = Math.Round(d.Count > 0 ? d[^1] : 0, 3), ["jitterP95m"] = Math.Round(p95 / 60, 4),
                ["delay"] = tr == null ? null : Math.Round(tr.Delay),
                ["buffer"] = tr == null ? null : new Dictionary<string, object?> { ["states"] = tr.States, ["dropped"] = tr.Dropped, ["starved"] = tr.Starved, ["extrapolated"] = tr.Extrapolated },
            });
        }
        var s = session;
        return new Dictionary<string, object?>
        {
            ["frames"] = frames, ["camSnaps"] = camSnaps, ["maxCamStep"] = Math.Round(maxCamStep, 3),
            ["rtt"] = s == null ? null : Math.Round(s.Rtt, 2), ["offset"] = s == null ? null : Math.Round(s.Offset),
            ["session"] = s == null ? null : new Dictionary<string, object?> { ["up"] = s.Up, ["down"] = s.Down, ["sent"] = s.Sent, ["batches"] = s.Batches, ["reconnects"] = s.Reconnects, ["skipped"] = s.Skipped },
            ["me"] = PlayerId, ["guest"] = Guest, ["remotes"] = remotes,
            ["figures"] = figs.Values.Select(f => new Dictionary<string, object?> { ["id"] = f.Id, ["name"] = f.Name, ["body"] = f.Figure?.Kind, ["shown"] = f.Shown, ["states"] = tracks.GetValueOrDefault(f.Id)?.States ?? 0 }).ToList(),
        };
    }

    public void ResetMeter()
    {
        frames = camSnaps = 0;
        maxCamStep = 0;
        meter.Clear();
        lastCam = null;
        foreach (var tr in tracks.Values) tr.ResetStats();
    }
}
