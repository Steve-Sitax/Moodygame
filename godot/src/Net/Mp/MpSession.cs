using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace Scheldemist.Net.Mp;

/// <summary>
/// The movement socket (/mp) on this side: net/mp/session.ts.
/// - hello with the token (or none: the host), then own state 20 times a second, always (also while a window or
///   the menu is up: he stands there, "away");
/// - a ping every second: the offset to the server's clock (the best of the last 8 round trips), so every PC
///   draws the others on the same timeline;
/// - the others' batches, the roster and the rest come out of Pump on the main thread, each with the server time
///   it arrived at (stamped where it was read, not where it is handed over).
/// Nothing that comes back ever moves this player or his camera.
/// A lost line comes back by itself with the same token (1, 2, 4 ... 15 s); a dead one is found by the pings.
/// The socket is read and written off the main thread. Plain C#, no Godot types.
/// </summary>
public sealed class MpSession : IDisposable
{
    private const int ConnectMs = 10_000;
    private const int DeadMs = 8_000;
    private const int RetryFirstMs = 1_000, RetryMaxMs = 15_000;

    private readonly Uri url;
    private readonly string? token;
    private readonly int seat;
    private readonly CancellationTokenSource closing = new();
    private readonly ConcurrentQueue<Action> inbox = new();
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private Channel<(byte[] Data, bool Text)>? outbox;
    private readonly object sampleLock = new();
    private readonly List<(double Rtt, double Off)> samples = new();
    private double offset;
    private bool haveOffset;
    private long firstUnanswered = -1, heard;
    private uint seq;
    private Task? loop;

    /// <summary>This player's id (0 before the welcome).</summary>
    public int Id { get; private set; }
    public bool Open { get; private set; }
    /// <summary>No going back in: an old version, removed by the host, not together, taken over by his own other game.</summary>
    public bool Closed { get; private set; }
    public double Rtt { get; private set; }
    /// <summary>Server time = Now + Offset (ms).</summary>
    public double Offset
    {
        get
        {
            lock (sampleLock) return offset;
        }
    }
    /// <summary>When the line was lost (this clock's ms; 0: up) and whether this game was ever in.</summary>
    public double LostAt { get; private set; }
    public bool Ever { get; private set; }
    public int Up, Down, Sent, Batches, Reconnects, Skipped;

    public event Action<JsonElement>? Welcome;
    public event Action<List<RosterEntry>>? Roster;
    /// <summary>The others' states: the list, the server's time when it was sent, the server time it arrived here.</summary>
    public event Action<List<(int Id, MpState S)>, double, double>? Batch;
    /// <summary>Any other JSON message: its type and the whole of it ("went", "pause_all", "owners", "worldpc", "refused" ...).</summary>
    public event Action<string, JsonElement>? Text;
    /// <summary>A binary batch that is not the players' (townspeople 3, job figures 4, animals 5), for the parts that will read them: the kind, the bytes, the server time it arrived.</summary>
    public event Action<byte, byte[], double>? Other;
    /// <summary>The line came up (true) or was lost (false).</summary>
    public event Action<bool>? LinkChanged;

    /// <param name="server">"http://127.0.0.1:8800".</param>
    public MpSession(string server, string? token, int seat)
    {
        this.token = token;
        this.seat = seat;
        string s = server.TrimEnd('/');
        url = new Uri((s.StartsWith("https", StringComparison.Ordinal) ? "wss" : "ws") + s[s.IndexOf("://", StringComparison.Ordinal)..] + "/mp");
    }

    /// <summary>This game's own clock (ms since the session was made): what pings and frames are timed with.</summary>
    public double Now => clock.Elapsed.TotalMilliseconds;
    /// <summary>The server's clock now (ms), as well as this side knows it.</summary>
    public double ServerNow => Now + Offset;

    public void Start() => loop ??= Task.Run(() => Loop(closing.Token));

    /// <summary>Hand over what came in. On the main thread, every frame.</summary>
    public void Pump()
    {
        while (inbox.TryDequeue(out var a)) a();
    }

    // ------------------------------------------------------------------ sending (from the main thread)

    /// <summary>Own state now (the caller times it at 20 a second).</summary>
    public void SendState(MpState s)
    {
        if (!Open || Id == 0) return;
        s.Seq = ++seq;
        if (Write(MpProtocol.EncodeState(s), false)) Sent++;
    }

    /// <summary>A text message (claim, release, the world's state, an ask), if the socket is open.</summary>
    public bool SendText(object message)
    {
        if (!Open || Id == 0) return false;
        return Write(JsonSerializer.SerializeToUtf8Bytes(message, Api.Json), true);
    }

    /// <summary>A binary frame of another kind (the townspeople this PC walks). A line that cannot keep up skips it.</summary>
    public bool SendBinary(byte[] frame) => Open && Id != 0 && Write(frame, false);

    private bool Write(byte[] data, bool text)
    {
        var box = outbox;
        // a line that cannot keep up: the next state replaces this one (never queue stale states)
        if (box == null || !box.Writer.TryWrite((data, text)))
        {
            Skipped++;
            return false;
        }
        Up += data.Length;
        return true;
    }

    /// <summary>Once a second: the ping the clock's offset is measured with; a line silent too long after one is given up.</summary>
    public void Ping()
    {
        if (!Open) return;
        long now = (long)Now;
        long since = Interlocked.Read(ref firstUnanswered);
        if (since >= 0 && Interlocked.Read(ref heard) < since && now - since > DeadMs)
        {
            Drop();
            return;
        }
        Write(Encoding.UTF8.GetBytes($"{{\"type\":\"ping\",\"c\":{Now.ToString("R", System.Globalization.CultureInfo.InvariantCulture)}}}"), true);
        if (since < 0 || Interlocked.Read(ref heard) >= since) Interlocked.Exchange(ref firstUnanswered, now);
    }

    private CancellationTokenSource? life;
    private void Drop() => life?.Cancel();

    // ------------------------------------------------------------------ the line (off the main thread)

    private async Task Loop(CancellationToken stop)
    {
        int attempt = 0;
        var rand = new Random();
        while (!stop.IsCancellationRequested && !Closed)
        {
            using var ws = new ClientWebSocket();
            using var alive = CancellationTokenSource.CreateLinkedTokenSource(stop);
            life = alive;
            var box = Channel.CreateBounded<(byte[], bool)>(new BoundedChannelOptions(64) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
            try
            {
                using (var connect = CancellationTokenSource.CreateLinkedTokenSource(stop))
                {
                    connect.CancelAfter(ConnectMs);
                    await ws.ConnectAsync(url, connect.Token).ConfigureAwait(false);
                }
                var hello = new Dictionary<string, object?> { ["type"] = "hello", ["seat"] = seat, ["protocol"] = MpProtocol.Protocol, ["version"] = "godot" };
                if (token != null) hello["token"] = token;
                await ws.SendAsync(JsonSerializer.SerializeToUtf8Bytes(hello), WebSocketMessageType.Text, true, alive.Token).ConfigureAwait(false);
                Interlocked.Exchange(ref firstUnanswered, -1);
                outbox = box;
                inbox.Enqueue(() => Open = true);
                var writer = Task.Run(async () =>
                {
                    await foreach (var (data, text) in box.Reader.ReadAllAsync(alive.Token).ConfigureAwait(false))
                        await ws.SendAsync(data, text ? WebSocketMessageType.Text : WebSocketMessageType.Binary, true, alive.Token).ConfigureAwait(false);
                }, alive.Token);
                try
                {
                    await Read(ws, alive.Token).ConfigureAwait(false);
                }
                finally
                {
                    alive.Cancel();
                    try
                    {
                        await writer.ConfigureAwait(false);
                    }
                    catch (Exception e) when (e is OperationCanceledException or WebSocketException or ObjectDisposedException or InvalidOperationException)
                    {
                        // the writer ends with the line
                    }
                }
                // no hello, an old version, removed, not together, taken over, or a flood: no going back in
                int code = (int)(ws.CloseStatus ?? 0);
                if (code >= 4001 && code <= 4006)
                {
                    bool takenOver = code == 4005;
                    inbox.Enqueue(() =>
                    {
                        Closed = true;
                        if (takenOver) Text?.Invoke("refused", JsonDocument.Parse("{\"type\":\"refused\",\"why\":\"You are playing in another game on this PC now.\"}").RootElement.Clone());
                    });
                }
            }
            catch (Exception e) when (e is WebSocketException or OperationCanceledException or IOException or HttpRequestException or InvalidOperationException)
            {
                // gone, or it did not come: the next try after the next wait
            }
            outbox = null;
            life = null;
            bool final = false;
            var told = new TaskCompletionSource();
            inbox.Enqueue(() =>
            {
                bool was = Open;
                Open = false;
                Id = 0;
                final = Closed;
                if (!Closed)
                {
                    if (LostAt == 0) LostAt = Now;
                    Reconnects++;
                }
                if (was) LinkChanged?.Invoke(false);
                told.TrySetResult();
            });
            if (stop.IsCancellationRequested) break;
            // (whether it is closed for good is the main thread's word: wait for it, a moment at most)
            await Task.WhenAny(told.Task, Task.Delay(500, CancellationToken.None)).ConfigureAwait(false);
            if (final) break;
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

    private async Task Read(ClientWebSocket ws, CancellationToken stop)
    {
        var buf = new byte[32 * 1024];
        using var whole = new MemoryStream();
        while (ws.State == WebSocketState.Open)
        {
            var r = await ws.ReceiveAsync(buf, stop).ConfigureAwait(false);
            if (r.MessageType == WebSocketMessageType.Close) break;
            whole.Write(buf, 0, r.Count);
            if (!r.EndOfMessage) continue;
            double at = Now; // stamped here: the main thread's frames would add up to 16 ms of their own
            Interlocked.Exchange(ref heard, (long)at);
            var data = whole.ToArray();
            whole.SetLength(0);
            Interlocked.Add(ref Down, data.Length);
            if (r.MessageType == WebSocketMessageType.Text) OnText(data, at);
            else OnBinary(data, at);
        }
    }

    private void OnText(byte[] data, double at)
    {
        JsonElement m;
        try
        {
            using var doc = JsonDocument.Parse(data);
            m = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return;
        }
        if (m.ValueKind != JsonValueKind.Object || !m.TryGetProperty("type", out var t) || t.ValueKind != JsonValueKind.String) return;
        string type = t.GetString()!;
        switch (type)
        {
            case "pong":
            {
                if (!m.TryGetProperty("c", out var c) || !m.TryGetProperty("s", out var s)) return;
                double rtt = at - c.GetDouble();
                lock (sampleLock)
                {
                    // the server read its clock about half way through the round trip
                    samples.Add((rtt, s.GetDouble() + rtt / 2 - at));
                    if (samples.Count > 8) samples.RemoveAt(0);
                    var best = samples[0];
                    foreach (var x in samples)
                        if (x.Rtt < best.Rtt) best = x;
                    offset = best.Off;
                    haveOffset = true;
                    double bestRtt = best.Rtt;
                    inbox.Enqueue(() => Rtt = bestRtt);
                }
                return;
            }
            case "welcome":
            {
                lock (sampleLock)
                {
                    // a first guess of the offset until the pings speak
                    if (!haveOffset && m.TryGetProperty("serverNow", out var sn)) offset = sn.GetDouble() - at;
                }
                int id = m.TryGetProperty("id", out var i) ? i.GetInt32() : 0;
                inbox.Enqueue(() =>
                {
                    Id = id;
                    LostAt = 0;
                    Ever = true;
                    LinkChanged?.Invoke(true);
                    Welcome?.Invoke(m);
                });
                return;
            }
            case "roster":
            {
                List<RosterEntry>? list = null;
                try
                {
                    if (m.TryGetProperty("players", out var p)) list = p.Deserialize<List<RosterEntry>>(Api.Json);
                }
                catch (JsonException)
                {
                    return;
                }
                if (list != null) inbox.Enqueue(() => Roster?.Invoke(list));
                return;
            }
            default:
                if (type is "old" or "kicked" or "refused") inbox.Enqueue(() => Closed = true);
                inbox.Enqueue(() => Text?.Invoke(type, m));
                return;
        }
    }

    private void OnBinary(byte[] data, double at)
    {
        if (data.Length == 0) return;
        double recv = at + Offset;
        byte kind = data[0];
        if (kind is MpProtocol.MsgPuppets or MpProtocol.MsgFigs or MpProtocol.MsgAnimals)
        {
            inbox.Enqueue(() => Other?.Invoke(kind, data, recv));
            return;
        }
        var b = MpProtocol.DecodeBatch(data);
        if (b == null) return;
        var (serverNow, list) = b.Value;
        inbox.Enqueue(() =>
        {
            Batches++;
            Batch?.Invoke(list, serverNow, recv);
        });
    }

    public void Dispose()
    {
        if (closing.IsCancellationRequested) return;
        Closed = true;
        closing.Cancel();
        try
        {
            loop?.Wait(1500);
        }
        catch (AggregateException)
        {
            // it ended by the cancel
        }
    }
}
