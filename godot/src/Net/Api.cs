using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Scheldemist.Net;

/// <summary>A call the server refused or that did not come through. Message is the server's own words when it gave any.</summary>
public sealed class ApiException : Exception
{
    /// <summary>The HTTP status; 0 when no answer came (the server is away, or the time ran out).</summary>
    public int Status { get; }
    public ApiException(string message, int status, Exception? inner = null) : base(message, inner) => Status = status;
}

/// <summary>
/// The game's side of the game server: client/src/net/api.ts. The server owns all numbers; the game shows them
/// and reports what happened in 3D. The calls and the push channel run off the main thread. What comes back is
/// handed over on the main thread: the push channel's events and Run's callbacks through Pump (the Net part calls
/// it every frame); an awaited call goes on where it was awaited (on the main thread, Godot brings it back there).
/// Every call has a time limit. Plain C#, no Godot types.
/// </summary>
public sealed class Api : IDisposable
{
    /// <summary>The server's JSON: snake_case names, as the server writes them.</summary>
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    public const int DefaultTimeoutMs = 8000;
    /// <summary>A call the server may answer with a model's words (talk, haggle): the server gives the model 20 s.</summary>
    public const int TalkTimeoutMs = 30_000;

    // the push line (client/src/net/mp/link.ts)
    private const int RetryFirstMs = 1000;
    private const int RetryMaxMs = 15_000;
    private const int ConnectMs = 10_000;
    private const int PushPingMs = 10_000;
    private const int PushDeadMs = 25_000;

    /// <summary>"http://127.0.0.1:8800".</summary>
    public string Url { get; }
    /// <summary>This game's name on the push channel (the browser's tab name): the server lets go of its pause when the channel closes.</summary>
    public string ClientId { get; } = "godot-" + Guid.NewGuid().ToString("N")[..8];

    private readonly HttpClient http;
    private readonly ConcurrentQueue<Action> inbox = new();
    private readonly CancellationTokenSource closing = new();
    private Task? pushLoop;

    public Api(string url)
    {
        Url = url.TrimEnd('/');
        // the time limit is each call's own (a talk may take 30 s)
        http = new HttpClient { BaseAddress = new Uri(Url + "/"), Timeout = Timeout.InfiniteTimeSpan };
    }

    // ------------------------------------------------------------------ the main thread

    /// <summary>Hand over what came in since the last call. On the main thread, every frame.</summary>
    public void Pump()
    {
        while (inbox.TryDequeue(out var a))
        {
            try
            {
                a();
            }
            catch (Exception e)
            {
                // a handler that throws must not take the later messages with it
                Failed?.Invoke(e);
            }
        }
    }

    /// <summary>A handler threw while a message was handed over.</summary>
    public event Action<Exception>? Failed;

    /// <summary>Run a call and get its answer (or what went wrong) on the main thread, from any thread.</summary>
    public void Run<T>(Task<T> call, Action<T> ok, Action<ApiException>? fail = null)
    {
        call.ContinueWith(t =>
        {
            if (t.Status == TaskStatus.RanToCompletion) inbox.Enqueue(() => ok(t.Result));
            else
            {
                var e = t.Exception?.GetBaseException();
                var ae = e as ApiException ?? new ApiException(e?.Message ?? "cancelled", 0, e);
                inbox.Enqueue(() => fail?.Invoke(ae));
            }
        }, TaskScheduler.Default);
    }

    // ------------------------------------------------------------------ one call

    public Task<T> Get<T>(string path, int timeoutMs = DefaultTimeoutMs) => Call<T>(HttpMethod.Get, path, null, timeoutMs);
    public Task<T> Post<T>(string path, object? body = null, int timeoutMs = DefaultTimeoutMs) => Call<T>(HttpMethod.Post, path, body, timeoutMs);
    public Task<T> Put<T>(string path, object? body = null, int timeoutMs = DefaultTimeoutMs) => Call<T>(HttpMethod.Put, path, body, timeoutMs);

    /// <summary>api.ts call(): JSON out, JSON back, a time limit; the server's own "error" text when it refuses.</summary>
    /// <param name="refusalToo">A 409 with a body is an answer too (the goods: what the server refused, and the items as they are).</param>
    public async Task<T> Call<T>(HttpMethod method, string path, object? body, int timeoutMs, bool refusalToo = false)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(closing.Token);
        limit.CancelAfter(timeoutMs);
        string url = path.TrimStart('/');
        try
        {
            using var req = new HttpRequestMessage(method, url);
            if (body != null) req.Content = new StringContent(JsonSerializer.Serialize(body, body.GetType(), Json), Encoding.UTF8, "application/json");
            using var res = await http.SendAsync(req, HttpCompletionOption.ResponseContentRead, limit.Token).ConfigureAwait(false);
            string text = await res.Content.ReadAsStringAsync(limit.Token).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode && !(refusalToo && (int)res.StatusCode == 409))
            {
                string? said = null;
                try
                {
                    using var doc = JsonDocument.Parse(text);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String) said = err.GetString();
                }
                catch (JsonException)
                {
                    // no JSON: the status says it
                }
                int status = (int)res.StatusCode;
                throw new ApiException(said ?? (status == 429 ? "The host's game is busy: wait a moment and try again." : $"HTTP {status}"), status);
            }
            try
            {
                // an empty body is {} (api.ts); a body that cannot be read is an error, never a good empty answer
                return JsonSerializer.Deserialize<T>(text == "" ? "{}" : text, Json) ?? throw new JsonException("null");
            }
            catch (JsonException e)
            {
                throw new ApiException($"bad reply from /{url}", (int)res.StatusCode, e);
            }
        }
        catch (OperationCanceledException e)
        {
            throw new ApiException(closing.IsCancellationRequested ? "the game is closing" : $"no answer from /{url} in {timeoutMs / 1000.0:0.#} s", 0, e);
        }
        catch (HttpRequestException e)
        {
            throw new ApiException($"the game server does not answer (/{url})", 0, e);
        }
    }

    // ------------------------------------------------------------------ the calls of api.ts

    /// <summary>The game state: the board, Jef, his pockets, the clock, the weather, the rent.</summary>
    public Task<JobsPayload> Jobs() => Get<JobsPayload>("api/jobs");
    public Task<JobReply> Take(int id) => Post<JobReply>($"api/jobs/{id}/take");
    public Task<List<Npc>> Npcs() => Get<List<Npc>>("api/npcs");
    public Task<BuyReply> Buy(string npc, string kind) => Post<BuyReply>("api/buy", new { npc, kind });
    /// <summary>M6: argue the price of a ware in your own words.</summary>
    public Task<TalkLine> Haggle(string npc, string kind, string text) => Post<TalkLine>($"api/npc/{Esc(npc)}/haggle", new { kind, text }, TalkTimeoutMs);
    public Task<TextReply> Use(int id) => Post<TextReply>("api/use", new { id });
    public Task<JobsPayload> Handover(int jobId) => Post<JobsPayload>($"api/jobs/{jobId}/handover");
    public Task<OkReply> Near(string npc) => Post<OkReply>($"api/npc/{Esc(npc)}/near");
    /// <summary>kind: "open", "choice" or "free".</summary>
    public Task<TalkLine> Talk(string npc, string kind, string? text = null) =>
        Post<TalkLine>($"api/npc/{Esc(npc)}/talk", text == null ? new Dictionary<string, object?> { ["kind"] = kind } : new Dictionary<string, object?> { ["kind"] = kind, ["text"] = text }, TalkTimeoutMs);
    /// <summary>what: "took" or "returned".</summary>
    public Task<OkReply> Witness(string npc, string what) => Post<OkReply>($"api/npc/{Esc(npc)}/witness", new { @event = what });
    public Task<JobReply> Progress(int id, Progress p) => Post<JobReply>($"api/jobs/{id}/progress", p);

    /// <summary>
    /// The clock's step, asked every Clock.TickEveryMs while Jef plays. M7 warmth: where Jef is and whether his
    /// lantern is lit; the reply says what the server believes. pos: where he stands (a bench, the doss house step).
    /// </summary>
    public Task<TickReply> Tick(WhereReport? where = null, bool? asleep = null, Pos3? pos = null)
    {
        var body = new Dictionary<string, object?>();
        if (where != null) body["where"] = where;
        if (asleep != null) body["asleep"] = asleep;
        if (pos != null) body["pos"] = pos;
        return Post<TickReply>("api/tick", body);
    }

    /// <summary>M7 night: the work is done, the employer is at home asleep; the facts wait for the box at his door.</summary>
    public Task<HoldReply> Hold(int id, Report report) => Post<HoldReply>($"api/jobs/{id}/hold", report);
    /// <summary>Dev: the clock on by game minutes the way the game moves it.</summary>
    public Task<AdvanceReply> DevAdvance(int minutes) => Post<AdvanceReply>("api/dev/advance", new { minutes });
    /// <summary>M7 sleep: lie down in a bed or on a bench for so long.</summary>
    public Task<SleepReply> Sleep(RestAsk ask) => Post<SleepReply>("api/sleep", ask);
    /// <summary>M7 sleep: a key wakes him; only the time slept counts.</summary>
    public Task<WakeReply> Wake() => Post<WakeReply>("api/sleep/wake");
    public Task<RentReply> Rent() => Post<RentReply>("api/rent");
    /// <summary>Fell into the Schelde: the server takes the cold off your warmth (once per swim).</summary>
    public Task<SwimReply> Swim() => Post<SwimReply>("api/swim");
    /// <summary>The horse omnibuses. action: "board", "hop", "alight", "seat" or "timetable"; place: "inside" or "roof".</summary>
    public Task<RideReply> Ride(string action, string stop, string? line = null, string? place = null)
    {
        var body = new Dictionary<string, object?> { ["action"] = action, ["stop"] = stop };
        if (line != null) body["line"] = line;
        if (place != null) body["place"] = place;
        return Post<RideReply>("api/ride", body);
    }
    public Task<JobsPayload> NewGame() => Post<JobsPayload>("api/new-game");
    /// <summary>Dev: set day, hour, minute, food, warmth, health, sleep or money_c.</summary>
    public Task<JobsPayload> DevSet(IReadOnlyDictionary<string, double> values) => Post<JobsPayload>("api/dev/set", values);
    /// <summary>The town the server made (api.ts TownData): places, stalls, shops, about 190 residents with their days.</summary>
    public Task<JsonElement> Town() => Get<JsonElement>("api/town", 15_000);
    /// <summary>The ways on foot of the town's day plans.</summary>
    public Task<WaysReply> Ways() => Get<WaysReply>("api/town/ways", 30_000);
    public Task<WaysReply> WaysByKey(IEnumerable<string> keys) => Post<WaysReply>("api/town/ways", new { keys }, 15_000);
    /// <summary>How late the townspeople are on their plans.</summary>
    public Task<LagsReply> Lags() => Get<LagsReply>("api/town/lags", 10_000);
    public Task<LagsReply> ReportLags(IReadOnlyDictionary<string, double> lags) => Post<LagsReply>("api/town/lags", new Dictionary<string, object?> { ["lags"] = lags }, 10_000);
    public Task<OkReply> MapOff(IEnumerable<MapOff> off) => Post<OkReply>("api/map/off", new { off }, 10_000);
    public Task<PickReply> Pick(string resident) => Post<PickReply>($"api/resident/{Esc(resident)}/pick");
    public Task<CatchReply> CatchThief(string resident) => Post<CatchReply>($"api/resident/{Esc(resident)}/catch");
    /// <summary>T4: give up a job in hand (no pay; the employer's trust one down).</summary>
    public Task<GiveUpReply> GiveUp(int id) => Post<GiveUpReply>($"api/jobs/{id}/giveup", new { });
    public Task<DoneReply> Done(int id, Report report) => Post<DoneReply>($"api/jobs/{id}/done", report);
    // M4
    /// <summary>Townspeople who act, street conversations, the director's events (api.ts ActionsPayload).</summary>
    public Task<JsonElement> Actions() => Get<JsonElement>("api/actions");
    public Task<OkReply> ActionsSync(double x, double z, IEnumerable<PersonAt> people) => Post<OkReply>("api/actions/sync", new { x, z, people });
    /// <summary>phase: "arrived", "lost", "blocked" or "done". The reply is the game state with the action in "action".</summary>
    public Task<JsonElement> ActionReport(int id, string phase, double? x = null, double? z = null, bool? found = null, string? why = null)
    {
        var body = new Dictionary<string, object?> { ["phase"] = phase };
        if (x != null) body["x"] = x;
        if (z != null) body["z"] = z;
        if (found != null) body["found"] = found;
        if (why != null) body["why"] = why;
        return Post<JsonElement>($"api/actions/{id}/report", body, TalkTimeoutMs);
    }
    public Task<JsonElement> DevDirector(bool? think = null, bool? invent = null, string? template = null)
    {
        var body = new Dictionary<string, object?>();
        if (think != null) body["think"] = think;
        if (invent != null) body["invent"] = invent;
        if (template != null) body["template"] = template;
        return Post<JsonElement>("api/dev/director", body, 40_000);
    }
    /// <summary>M6 town life: the lamplighters' rounds, the soot of burned fronts (game/townlife.ts TownLifeData).</summary>
    public Task<JsonElement> TownLife() => Get<JsonElement>("api/townlife");
    public Task<TownLifeReply> FireJoin(double x, double z) => Post<TownLifeReply>("api/fire/join", new { x, z });
    public Task<TownLifeReply> FireLeave() => Post<TownLifeReply>("api/fire/leave");
    public Task<TownLifeReply> HiringStand(double x, double z) => Post<TownLifeReply>("api/hiring/stand", new { x, z });

    /// <summary>M8f: every liftable thing of the town as the server has it (shared/goods.ts; the records are in Play/GoodsData.cs).</summary>
    public Task<T> Goods<T>() => Get<T>("api/goods", 10_000);
    /// <summary>M8f: ask to lift, put down, hand over ... (shared/goods.ts GoodsAsk). A refusal (409) comes back as an answer with its reason.</summary>
    public Task<T> GoodsAsk<T>(object ask) => Call<T>(HttpMethod.Post, "api/goods", ask, DefaultTimeoutMs, refusalToo: true);
    private static string Esc(string id) => Uri.EscapeDataString(id);

    // ------------------------------------------------------------------ the push channel

    /// <summary>New game state (the first comes as the channel opens). Main thread.</summary>
    public event Action<JobsPayload>? JobsPushed;
    /// <summary>How a job went, in the employer's words. Main thread.</summary>
    public event Action<OutcomeMsg>? OutcomePushed;
    /// <summary>Anything else: actions, events, convo ... and "resync" when the line is back after a drop. Main thread.</summary>
    public event Action<PushMsg>? OtherPushed;
    /// <summary>The pause and save messages ("gate", "loaded"). Main thread.</summary>
    public event Action<PushMsg>? SystemPushed;
    /// <summary>The push line came up (true) or dropped (false). Main thread.</summary>
    public event Action<bool>? LinkChanged;
    /// <summary>The push line is up now.</summary>
    public bool Linked { get; private set; }

    /// <summary>
    /// api.ts connectPush: open the push channel and keep it. It comes back by itself after 1, 2, 4, 8, then every
    /// 15 s; a ping every 10 s, and a line that said nothing for 25 s after one is given up. Back after a drop,
    /// the state is asked for again and "resync" is said to the parts that keep their own. The game never waits on it.
    /// </summary>
    public void ConnectPush()
    {
        pushLoop ??= Task.Run(() => PushLoop(closing.Token));
    }

    private async Task PushLoop(CancellationToken stop)
    {
        int attempt = 0;
        bool dropped = false;
        var rand = new Random();
        var wsUrl = new Uri((Url.StartsWith("https", StringComparison.Ordinal) ? "wss" : "ws") + Url[Url.IndexOf("://", StringComparison.Ordinal)..] + "/ws?client=" + Uri.EscapeDataString(ClientId));
        while (!stop.IsCancellationRequested)
        {
            using var ws = new ClientWebSocket();
            try
            {
                using (var connect = CancellationTokenSource.CreateLinkedTokenSource(stop))
                {
                    connect.CancelAfter(ConnectMs);
                    await ws.ConnectAsync(wsUrl, connect.Token).ConfigureAwait(false);
                }
                attempt = 0;
                inbox.Enqueue(() =>
                {
                    Linked = true;
                    LinkChanged?.Invoke(true);
                });
                if (dropped)
                {
                    dropped = false;
                    Run(Jobs(), p => JobsPushed?.Invoke(p));
                    Deliver("{\"type\":\"resync\"}");
                }
                await Listen(ws, stop).ConfigureAwait(false);
            }
            catch (Exception e) when (e is WebSocketException or OperationCanceledException or IOException or HttpRequestException or InvalidOperationException)
            {
                // the line is gone, or did not come: the next try after the next wait
            }
            if (stop.IsCancellationRequested) break;
            dropped = true;
            inbox.Enqueue(() =>
            {
                if (!Linked) return;
                Linked = false;
                LinkChanged?.Invoke(false);
            });
            // link.ts retryDelay: a tenth either way
            double wait = Math.Min(RetryMaxMs, RetryFirstMs * Math.Pow(2, Math.Min(10, attempt++))) * (0.9 + 0.2 * rand.NextDouble());
            try
            {
                await Task.Delay((int)wait, stop).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Read until the line closes or dies; a ping every PushPingMs.</summary>
    private async Task Listen(ClientWebSocket ws, CancellationToken stop)
    {
        using var life = CancellationTokenSource.CreateLinkedTokenSource(stop);
        long heard = Environment.TickCount64;
        long firstUnanswered = -1; // link.ts Liveness: the first ping nothing came back for
        var pings = Task.Run(async () =>
        {
            var ping = Encoding.UTF8.GetBytes("{\"type\":\"ping\"}");
            while (!life.IsCancellationRequested)
            {
                await Task.Delay(PushPingMs, life.Token).ConfigureAwait(false);
                long now = Environment.TickCount64;
                long since = Interlocked.Read(ref firstUnanswered);
                if (since >= 0 && Interlocked.Read(ref heard) < since && now - since > PushDeadMs)
                {
                    life.Cancel(); // silent too long: given up without a word
                    return;
                }
                await ws.SendAsync(ping, WebSocketMessageType.Text, true, life.Token).ConfigureAwait(false);
                if (since < 0 || Interlocked.Read(ref heard) >= since) Interlocked.Exchange(ref firstUnanswered, now);
            }
        }, life.Token);
        try
        {
            var buf = new byte[16 * 1024];
            using var whole = new MemoryStream();
            while (ws.State == WebSocketState.Open)
            {
                var r = await ws.ReceiveAsync(buf, life.Token).ConfigureAwait(false);
                if (r.MessageType == WebSocketMessageType.Close) break;
                whole.Write(buf, 0, r.Count);
                if (!r.EndOfMessage) continue;
                Interlocked.Exchange(ref heard, Environment.TickCount64);
                string text = Encoding.UTF8.GetString(whole.GetBuffer(), 0, (int)whole.Length);
                whole.SetLength(0);
                if (r.MessageType == WebSocketMessageType.Text) Deliver(text);
            }
        }
        finally
        {
            life.Cancel();
            try
            {
                await pings.ConfigureAwait(false);
            }
            catch (Exception e) when (e is OperationCanceledException or WebSocketException or ObjectDisposedException or InvalidOperationException)
            {
                // the pings end with the line
            }
            if (ws.State == WebSocketState.Open)
            {
                try
                {
                    using var bye = new CancellationTokenSource(1000);
                    await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", bye.Token).ConfigureAwait(false);
                }
                catch (Exception e) when (e is OperationCanceledException or WebSocketException)
                {
                    // gone already
                }
            }
        }
    }

    /// <summary>One pushed message: read here (off the main thread), handed over on the main thread.</summary>
    private void Deliver(string text)
    {
        // a bad message must not take the channel's later messages with it
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("type", out var t) || t.ValueKind != JsonValueKind.String) return;
            string type = t.GetString()!;
            switch (type)
            {
                case "pong":
                    return; // the line's sign of life only
                case "jobs":
                {
                    var p = JsonSerializer.Deserialize<JobsPayload>(text, Json);
                    if (p != null) inbox.Enqueue(() => JobsPushed?.Invoke(p));
                    return;
                }
                case "outcome":
                {
                    var o = JsonSerializer.Deserialize<OutcomeMsg>(text, Json);
                    if (o != null) inbox.Enqueue(() => OutcomePushed?.Invoke(o));
                    return;
                }
                default:
                {
                    var m = new PushMsg(type, doc.RootElement.Clone());
                    if (type is "gate" or "loaded") inbox.Enqueue(() => SystemPushed?.Invoke(m));
                    else inbox.Enqueue(() => OtherPushed?.Invoke(m));
                    return;
                }
            }
        }
        catch (JsonException)
        {
            // not JSON, or not the shape: dropped
        }
    }

    /// <summary>Close the push channel and end the calls on their way.</summary>
    public void Dispose()
    {
        if (closing.IsCancellationRequested) return;
        closing.Cancel();
        try
        {
            pushLoop?.Wait(1500);
        }
        catch (AggregateException)
        {
            // it ended by the cancel
        }
        http.Dispose();
    }
}
