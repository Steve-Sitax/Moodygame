using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;

using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Scheldemist.Native.Services;
using Scheldemist.Native.Services.Multiplayer;
using Scheldemist.Net;

namespace Scheldemist.Native.World;

/// <summary>HTTP and WebSocket transport in the Godot process. All state remains in the shared native rules.</summary>
public sealed class NativeNetworkHost : IDisposable
{
    /// <summary>Real transport handlers outside the in-process gameplay route registry.</summary>
    public static IReadOnlyList<string> TransportRoutes { get; } = Array.AsReadOnly(new[] { "GET /house-ca.crt" });
    private readonly NativeServiceHost host;
    private readonly NativeMultiplayer multiplayer;
    private readonly NativeTownProfile profile;
    private readonly JsonObject world;
    private readonly CancellationTokenSource stopping = new();
    private readonly ConcurrentDictionary<int, NativeBackendAdapter> adapters = new();
    private readonly ConcurrentDictionary<NativeSocketPipe, int> pushes = new();
    private readonly ConcurrentDictionary<NativeSocketPipe, byte> sockets = new();
    private WebApplication? app;
    private Task? clock, configuration, addressWatch;
    private NativeHouseListeners? house;
    private sealed record NetworkChange(JsonObject Settings,long Revision);
    private readonly Channel<NetworkChange> changes = Channel.CreateBounded<NetworkChange>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropOldest });
    private readonly object configurationGate = new();
    private long requestedConfiguration, appliedConfiguration;
    private string? configurationError;
    private TaskCompletionSource<bool> configurationSignal = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int disposed;
    public string Url { get; private set; } = "";
    public int Port { get; private set; }
    private static readonly HashSet<int> Reserved = new() { 8787, 8788, 8790, 5173, 5183, 5341, 8941, 8080, 8088, 8090 };

    public NativeNetworkHost(NativeServiceHost host, NativeMultiplayer multiplayer, NativeTownProfile profile, JsonObject world)
    {
        this.host = host; this.multiplayer = multiplayer; this.profile = profile; this.world = world;
        host.RoutedPush += OnPush;
        multiplayer.ClosePush += ClosePush; multiplayer.SettingsChanged += ChangedNetwork;
    }

    private NativeBackendAdapter Adapter(int id) => adapters.GetOrAdd(id, player => new NativeBackendAdapter(host, null, profile, player, false));

    public async Task Start(int port, bool exactPort)
    {
        if (port is < 1024 or > 65535 || Reserved.Contains(port)) throw new InvalidOperationException("Choose an unused game port from 1024 to 65535.");
        for (int attempt = 0; attempt < (exactPort ? 1 : 20); attempt++, port++)
        {
            if (port > 65535) break;
            if (Reserved.Contains(port)) continue;
            var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = Array.Empty<string>(), ContentRootPath = AppContext.BaseDirectory, ApplicationName = typeof(NativeNetworkHost).Assembly.GetName().Name });
            builder.Logging.ClearProviders();
            builder.WebHost.ConfigureKestrel(options => {
                options.AddServerHeader = false;
                options.Limits.MaxRequestBodySize = 1024 * 1024;
                options.Limits.MaxConcurrentConnections = 128;
                options.Limits.MaxConcurrentUpgradedConnections = 32;
                options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10);
                options.Listen(IPAddress.Loopback, port);
            });
            var candidate = builder.Build();
            candidate.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
            candidate.Run(Request);
            try { await candidate.StartAsync(stopping.Token).ConfigureAwait(false); }
            catch (IOException) when (!exactPort) { await candidate.DisposeAsync().ConfigureAwait(false); continue; }
            app = candidate; Port = port; Url = "http://127.0.0.1:" + port;
            house = new NativeHouseListeners(port, NativeHouseCertificateStore.DirectoryFor(Scheldemist.Paths.Database), Request, value => host.WithState(_ => { multiplayer.SetEndpoints(value); host.Publish("mp_network"); return true; }), stopping.Token, log: message => Godot.GD.PrintErr("native network: " + message));
            var settings = await host.WithState(_ => multiplayer.NetworkSettings()).ConfigureAwait(false);
            await house.Apply(Flag(settings,"lan"), Flag(settings,"vpn")).ConfigureAwait(false);
            configurationError = house.Error;
            configuration = Task.Run(ConfigureNetwork); addressWatch = Task.Run(WatchAddresses);
            clock = Task.Run(Pump);
            return;
        }
        throw new IOException("No free native game server port was available.");
    }

    private static bool Flag(JsonObject settings,string key) => settings[key] is JsonValue v && v.TryGetValue<bool>(out var value) && value;
    private void ChangedNetwork(JsonObject settings)
    {
        lock (configurationGate) { changes.Writer.TryWrite(new(settings,++requestedConfiguration)); }
    }
    /// <summary>Await queued LAN/VPN configuration outside WithState before publishing connection details.</summary>
    public async Task WaitForConfigurationAsync(TimeSpan? timeout=null,CancellationToken cancellationToken=default)
    {
        if (app==null) throw new InvalidOperationException("Start the native server before awaiting its network configuration.");
        if (Volatile.Read(ref disposed)!=0) throw new ObjectDisposedException(nameof(NativeNetworkHost));
        var duration=timeout??TimeSpan.FromSeconds(20); if(duration<=TimeSpan.Zero||duration>TimeSpan.FromMinutes(2))throw new ArgumentOutOfRangeException(nameof(timeout));
        using var limit=CancellationTokenSource.CreateLinkedTokenSource(stopping.Token,cancellationToken);limit.CancelAfter(duration);
        try { while(true) { Task signal; lock(configurationGate) { if(appliedConfiguration>=requestedConfiguration) { if(configurationError!=null)throw new IOException(configurationError);return; } signal=configurationSignal.Task; } await signal.WaitAsync(limit.Token).ConfigureAwait(false); } }
        catch(OperationCanceledException)when(!stopping.IsCancellationRequested&&!cancellationToken.IsCancellationRequested){throw new TimeoutException("The native server could not finish opening its network listeners within "+duration.TotalSeconds+" seconds.");}
    }
    private async Task ConfigureNetwork()
    {
        try { await foreach (var change in changes.Reader.ReadAllAsync(stopping.Token)) {
            string? error=null;
            try { if(house!=null){await house.Apply(Flag(change.Settings,"lan"),Flag(change.Settings,"vpn")).ConfigureAwait(false);error=house.Error;} }
            catch(Exception e)when(e is not OperationCanceledException){error=e.Message;Godot.GD.PrintErr("Native network configuration failed: "+e.Message);}
            lock(configurationGate){appliedConfiguration=change.Revision;configurationError=error;var signal=configurationSignal;configurationSignal=new(TaskCreationOptions.RunContinuationsAsynchronously);signal.TrySetResult(true);}
        } }
        catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException || stopping.IsCancellationRequested) { }
        catch (Exception e) { Godot.GD.PrintErr("Native network configuration failed: " + e.Message); }
    }
    private async Task WatchAddresses()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        try { while (await timer.WaitForNextTickAsync(stopping.Token).ConfigureAwait(false)) if (house is { Watching:true }) { var settings=await host.WithState(_=>multiplayer.NetworkSettings()).ConfigureAwait(false); await house.Apply(Flag(settings,"lan"),Flag(settings,"vpn"),false).ConfigureAwait(false); } }
        catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException || stopping.IsCancellationRequested) { }
        catch (Exception e) { Godot.GD.PrintErr("Native network address watch failed: " + e.Message); }
    }

    private async Task Pump()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(50));
        var heartbeatClock = System.Diagnostics.Stopwatch.StartNew();
        long nextHeartbeat = 10_000;
        int tick = 0;
        try
        {
            while (await timer.WaitForNextTickAsync(stopping.Token).ConfigureAwait(false))
            {
                bool heartbeatDue = heartbeatClock.ElapsedMilliseconds >= nextHeartbeat;
                if (heartbeatDue) nextHeartbeat = heartbeatClock.ElapsedMilliseconds + 10_000;
                await host.WithState(_ => { multiplayer.Relay(); if (heartbeatDue) multiplayer.Heartbeat(); return true; }).ConfigureAwait(false);
                if (++tick % 5 == 0 && multiplayer.Enabled) await host.ServerTick().ConfigureAwait(false);
            }
        }
        catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException || stopping.IsCancellationRequested) { }
        catch (Exception e) { Godot.GD.PushError("Native server clock failed: " + e.Message); }
    }

    private static async Task Json(HttpContext context, int status, JsonNode body)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsync(body.ToJsonString(), context.RequestAborted).ConfigureAwait(false);
    }

    private async Task Request(HttpContext context)
    {
        try
        {
            // This endpoint serves native clients only; a website cannot use a player's local server.
            if (context.Request.Headers.ContainsKey("Origin")) { await Json(context, 403, new JsonObject { ["error"] = "This endpoint accepts native game clients." }); return; }
            if (house != null && !house.Accepts(context)) { await Json(context, 403, new JsonObject { ["error"] = "This address is not open to that network." }); return; }
            if (house != null && await house.PublicCertificate(context).ConfigureAwait(false)) return;
            string path = context.Request.Path.Value ?? "/";
            string address = context.Connection.RemoteIpAddress?.ToString() ?? "";
            if (context.WebSockets.IsWebSocketRequest && path is "/mp" or "/ws") { await Socket(context, path, address); return; }
            if (context.Request.Method is not ("GET" or "POST" or "PUT")) { await Json(context, 405, new JsonObject { ["error"] = "Unsupported method." }); return; }
            JsonObject body = new();
            if (context.Request.Method != "GET")
            {
                using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
                string input = await reader.ReadToEndAsync(context.RequestAborted).ConfigureAwait(false);
                if (input.Length != 0) body = JsonNode.Parse(input) as JsonObject ?? throw new NativeServiceException("Send a JSON object.", 400);
            }
            string? token = context.Request.Headers[Api.TokenHeader].FirstOrDefault();
            if (path.StartsWith("/api/mp/", StringComparison.Ordinal))
            {
                var reply = await host.WithState(_ => multiplayer.Handle(context.Request.Method, path, token, body, address)).ConfigureAwait(false);
                await Json(context, reply.Status, reply.Body); return;
            }
            var auth = await host.WithState(_ => multiplayer.Authorize(context.Request.Method, path, token, address)).ConfigureAwait(false);
            if (auth.Identity == null || auth.Status != 200) { await Json(context, auth.Status, auth.Error ?? new JsonObject { ["error"] = "Join the game first." }); return; }
            if (path == "/api/native/world" && context.Request.Method == "GET") { await Json(context, 200, world); return; }
            string json = await Adapter(auth.Identity.Id).Call(context.Request.Method, path + context.Request.QueryString, body.ToJsonString()).WaitAsync(context.RequestAborted).ConfigureAwait(false);
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.Headers.CacheControl = "no-store";
            await context.Response.WriteAsync(json, context.RequestAborted).ConfigureAwait(false);
        }
        catch (Exception e) when (e is ApiException or NativeServiceException or System.Text.Json.JsonException or InvalidOperationException or BadHttpRequestException)
        {
            if (context.Response.HasStarted) { context.Abort(); return; }
            int status = e is ApiException api ? api.Status : e is NativeServiceException native ? native.Status : e is BadHttpRequestException bad ? bad.StatusCode : 400;
            await Json(context, status is >= 400 and <= 599 ? status : 500, new JsonObject { ["error"] = e.Message });
        }
        catch (OperationCanceledException) { }
        catch (Exception e)
        {
            Godot.GD.PrintErr("Native network request failed: " + e.GetType().Name + ": " + e.Message);
            if (!context.Response.HasStarted) await Json(context, 500, new JsonObject { ["error"] = "The game could not complete this request." });
        }
    }

    private async Task Socket(HttpContext context, string path, string address)
    {
        using var ws = await context.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
        using var pipe = new NativeSocketPipe(ws, stopping.Token);
        sockets.TryAdd(pipe, 0);
        NativeMpConnection? connection = null;
        try
        {
            if (path == "/mp")
            {
                connection = await host.WithState(_ => multiplayer.OpenPeer(new NativeMpPeer {
                    SendText = pipe.Text, SendBinary = pipe.Binary, Close = pipe.Close,
                    BufferedBytes = () => pipe.BufferedBytes, IsOpen = () => pipe.IsOpen
                }, address)).ConfigureAwait(false);
                await pipe.Read(async (data, text) => {
                    await host.WithState(_ => { if (text) multiplayer.ReceiveText(connection, Encoding.UTF8.GetString(data)); else multiplayer.ReceiveBinary(connection, data); return true; }).ConfigureAwait(false);
                }).ConfigureAwait(false);
            }
            else
            {
                int player = 0;
                using var welcomeDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                using var cancelUnwelcomed = welcomeDeadline.Token.Register(() => { if (Volatile.Read(ref player) == 0) pipe.Close(1008, "Authenticate first."); });
                await pipe.Read(async (data, text) => {
                    if (!text) { pipe.Close(1003, "Text messages only."); return; }
                    var message = JsonNode.Parse(data) as JsonObject ?? throw new NativeServiceException("Invalid push message.");
                    if (player == 0)
                    {
                        if (message["type"]?.GetValue<string>() != "hello") { pipe.Close(1008, "Authenticate first."); return; }
                        var auth = await host.WithState(_ => multiplayer.Authorize("GET", "/api/state", message["token"]?.GetValue<string>(), address)).ConfigureAwait(false);
                        if (auth.Identity == null) { pipe.Close(1008, "Join the game first."); return; }
                        player = auth.Identity.Id;
                        await host.WithState(_ => { pushes[pipe] = player; host.PublishState(player); return true; }).ConfigureAwait(false);
                    }
                    else if (message["type"]?.GetValue<string>() == "ping") pipe.Text("{\"type\":\"pong\"}");
                }).ConfigureAwait(false);
            }
        }
        catch (Exception e) when (e is OperationCanceledException or WebSocketException or System.Text.Json.JsonException or NativeServiceException or ObjectDisposedException) { }
        finally
        {
            pushes.TryRemove(pipe, out _); sockets.TryRemove(pipe, out _);
            if (connection != null && !stopping.IsCancellationRequested) await host.WithState(_ => { multiplayer.Closed(connection); return true; }).ConfigureAwait(false);
        }
    }

    private void OnPush(int? recipient, string message)
    {
        foreach (var group in pushes.Where(p => recipient == null || p.Value == recipient).GroupBy(p => p.Value))
        {
            string shown = Adapter(group.Key).Translate(message);
            foreach (var pair in group) pair.Key.Text(shown);
        }
    }
    private void ClosePush(int player) { foreach (var pair in pushes.Where(p => p.Value == player)) pair.Key.Close(4003, "The host closed this session."); }
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        Godot.GD.Print("native server: closing connections");
        host.RoutedPush -= OnPush; multiplayer.ClosePush -= ClosePush; multiplayer.SettingsChanged -= ChangedNetwork; changes.Writer.TryComplete();
        stopping.Cancel();
        foreach (var pipe in sockets.Keys) pipe.Close(1001, "The server is closing.");
        if (app != null)
        {
            // Godot synchronously tears nodes down on its synchronization context.
            // Hosting shutdown must run outside that context so its continuations can finish.
            Task.Run(async () => {
                if (configuration != null) await configuration.ConfigureAwait(false); if (addressWatch != null) await addressWatch.ConfigureAwait(false); if (house != null) await house.DisposeAsync().ConfigureAwait(false);
                using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                try { await app.StopAsync(limit.Token).ConfigureAwait(false); } catch (OperationCanceledException) { }
                Godot.GD.Print("native server: listener stopped");
                await app.DisposeAsync().ConfigureAwait(false);
                if (clock != null) await clock.ConfigureAwait(false);
            }).GetAwaiter().GetResult();
        }
        foreach (var adapter in adapters.Values) adapter.Dispose();
        stopping.Dispose();
        Godot.GD.Print("native server: stopped");
    }

}

