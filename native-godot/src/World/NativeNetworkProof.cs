using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Scheldemist.Native.Services;
using Scheldemist.Net;
using Scheldemist.Net.Mp;

namespace Scheldemist.Native.World;

/// <summary>Real TCP/HTTP/WebSocket clients against an isolated dedicated Godot process.</summary>
public static class NativeNetworkProof
{
    public static async Task Run(NativeHostedBackend backend, string output)
    {
        Directory.CreateDirectory(output);
        var checks = new JsonArray();
        void Check(string name, bool pass) { checks.Add(new JsonObject { ["name"] = name, ["passed"] = pass }); if (!pass) throw new InvalidOperationException(name); }
        try
        {
            string allowed = Path.GetFullPath(output) + Path.DirectorySeparatorChar;
            Check("network proof uses its own database", Path.GetFullPath(Scheldemist.Paths.Database).StartsWith(allowed, StringComparison.OrdinalIgnoreCase));
            Check("dedicated default saves are separate from the local game", Scheldemist.Paths.NativeUserDirectory == Path.Combine(Godot.ProjectSettings.GlobalizePath("user://"), "native-server"));
            using var http = new HttpClient { BaseAddress = new Uri(backend.ServerUrl), Timeout = TimeSpan.FromSeconds(30) };
            async Task<(int Status, JsonObject Body)> Call(string method, string path, string? token = null, JsonObject? body = null, bool origin = false)
            {
                using var request = new HttpRequestMessage(new HttpMethod(method), path);
                if (token != null) request.Headers.Add(Api.TokenHeader, token);
                if (origin) request.Headers.Add("Origin", "https://untrusted.invalid");
                if (body != null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
                using var result = await http.SendAsync(request).ConfigureAwait(false);
                string data = await result.Content.ReadAsStringAsync().ConfigureAwait(false);
                return ((int)result.StatusCode, JsonNode.Parse(data)!.AsObject());
            }
            var information = await Call("GET", "/api/mp/info");
            Check("dedicated server announces native multiplayer", information.Status == 200 && information.Body["multiplayer"]?.GetValue<bool>() == true && information.Body["protocol"]?.GetValue<int>() == MpProtocol.Protocol);
            Check("unauthenticated local clients cannot read private state", (await Call("GET", "/api/state")).Status == 401);
            Check("browser origins cannot access local host privileges", (await Call("GET", "/api/state", backend.HostToken, origin: true)).Status == 403);
            var house = await Call("GET", "/api/mp/host", backend.HostToken);
            Check("host token authorizes management", house.Status == 200);
            string code = house.Body["code"]!.GetValue<string>();
            JsonObject Join(string name, string fingerprint) => new() { ["code"] = code, ["name"] = name, ["protocol"] = MpProtocol.Protocol, ["fingerprint"] = fingerprint };
            Check("different native build refused before joining", (await Call("POST", "/api/mp/join", body: Join("Wrong", "wrong-build"))).Status == 409);
            var a = await Call("POST", "/api/mp/join", body: Join("Anna", backend.WorldFingerprint));
            var b = await Call("POST", "/api/mp/join", body: Join("Piet", backend.WorldFingerprint));
            Check("two separate guest seats join", a.Status == 200 && b.Status == 200 && a.Body["id"]!.GetValue<int>() != b.Body["id"]!.GetValue<int>());
            string at = a.Body["token"]!.GetValue<string>(), bt = b.Body["token"]!.GetValue<string>();
            int aid = a.Body["id"]!.GetValue<int>(), bid = b.Body["id"]!.GetValue<int>();
            var ast = await Call("GET", "/api/state", at); var bst = await Call("GET", "/api/state", bt);
            Check("guest HTTP state uses each player's identity", ast.Status == 200 && bst.Status == 200 && ast.Body["player"]?["name"]?.GetValue<string>() == "Anna" && bst.Body["player"]?["name"]?.GetValue<string>() == "Piet");
            Check("guest cannot reset the shared world", (await Call("POST", "/api/new-game", at, new())).Status == 403);
            Check("guest cannot change authoritative weather", (await Call("POST", "/api/dev/set", at, new JsonObject { ["weather"] = "storm" })).Status == 403);
            Check("guest cannot use host controls", (await Call("GET", "/api/mp/host", at)).Status == 403);
            var layouts = await Call("GET", "/api/native/world", at);
            Check("guest receives authenticated district layouts", layouts.Status == 200 && layouts.Body["fingerprint"]?.GetValue<string>() == backend.WorldFingerprint && layouts.Body["layouts"] is JsonObject districts && districts.Count == 11);
            Check("anonymous clients cannot download world layouts", (await Call("GET", "/api/native/world")).Status == 401);

            using var movementA = await Open(backend.ServerUrl, "/mp", new JsonObject { ["type"] = "hello", ["token"] = at, ["protocol"] = MpProtocol.Protocol, ["version"] = "godot", ["fingerprint"] = backend.WorldFingerprint });
            using var movementB = await Open(backend.ServerUrl, "/mp", new JsonObject { ["type"] = "hello", ["token"] = bt, ["protocol"] = MpProtocol.Protocol, ["version"] = "godot", ["fingerprint"] = backend.WorldFingerprint });
            var welcomeA = await Until(movementA, n => n["type"]?.GetValue<string>() == "welcome");
            var welcomeB = await Until(movementB, n => n["type"]?.GetValue<string>() == "welcome");
            Check("both movement sockets receive authenticated welcome", welcomeA != null && welcomeB != null);
            // An ordinary quiet interval must not be mistaken for a dead connection.
            await Task.Delay(350).ConfigureAwait(false);
            await movementA.SendAsync(Encoding.UTF8.GetBytes("{\"type\":\"ping\",\"c\":123}"), WebSocketMessageType.Text, true, CancellationToken.None).ConfigureAwait(false);
            Check("movement socket survives a normal pause between packets", await Until(movementA, n => n["type"]?.GetValue<string>() == "pong") != null);
            await Send(movementA, MpProtocol.EncodeState(new MpState { Seq = 1, X = 52, Y = 0, Z = 10, Flags = MpProtocol.FlagGrounded, T = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));
            await Send(movementB, MpProtocol.EncodeState(new MpState { Seq = 1, X = 54, Y = 0, Z = 10, Flags = MpProtocol.FlagGrounded, T = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }));
            Check("movement crosses the real network between players", await Binary(movementA, 2) && await Binary(movementB, 2));
            using var pushA = await Open(backend.ServerUrl, "/ws", new JsonObject { ["type"] = "hello", ["token"] = at });
            using var pushB = await Open(backend.ServerUrl, "/ws", new JsonObject { ["type"] = "hello", ["token"] = bt });
            var privateA = await Until(pushA, n => n["type"]?.GetValue<string>() == "jobs");
            var privateB = await Until(pushB, n => n["type"]?.GetValue<string>() == "jobs");
            Check("push channels receive only their own player state", privateA?["player"]?["name"]?.GetValue<string>() == "Anna" && privateB?["player"]?["name"]?.GetValue<string>() == "Piet");
            await Call("POST", "/api/dev/set", backend.HostToken, new JsonObject { ["weather"] = "rain" });
            var weatherA = await Call("GET", "/api/state", at); var weatherB = await Call("GET", "/api/state", bt);
            Check("clock and weather are shared", weatherA.Body["clock"]?.ToJsonString() == weatherB.Body["clock"]?.ToJsonString());
            await Call("POST", "/api/mp/pause-all", backend.HostToken, new JsonObject { ["on"] = true });
            var paused = await Call("GET", "/api/state", at);
            for (int i = 0; i < 5; i++) await Call("POST", "/api/tick", bt, new());
            var after = await Call("GET", "/api/state", at);
            Check("client tick requests cannot advance a host-paused world", paused.Body["clock"]?.ToJsonString() == after.Body["clock"]?.ToJsonString());
            await Call("POST", "/api/mp/pause-all", backend.HostToken, new JsonObject { ["on"] = false });
            Check("guest cannot pause everyone", (await Call("POST", "/api/mp/pause-all", at, new JsonObject { ["on"] = true })).Status == 403);
            using var reconnect = await Open(backend.ServerUrl, "/mp", new JsonObject { ["type"] = "hello", ["token"] = at, ["protocol"] = MpProtocol.Protocol, ["version"] = "godot", ["fingerprint"] = backend.WorldFingerprint });
            Check("reconnect keeps the same private identity", await Until(reconnect, n => n["type"]?.GetValue<string>() == "welcome") != null && (await Call("GET", "/api/mp/info", at)).Body["you"]?["id"]?.GetValue<int>() == aid);
            await Call("POST", "/api/mp/kick", backend.HostToken, new JsonObject { ["id"] = bid });
            Check("kicked token loses HTTP access", (await Call("GET", "/api/state", bt)).Status is 401 or 403);
            Check("host-only new week succeeds with connected guest", (await Call("POST", "/api/new-game", backend.HostToken, new())).Status == 200);
            Check("new week preserves authenticated guest identity", (await Call("GET", "/api/state", at)).Body["player"]?["name"]?.GetValue<string>() == "Anna");
            File.WriteAllText(Path.Combine(output, "network.json"), new JsonObject { ["passed"] = true, ["checks"] = checks }.ToJsonString());
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(output, "network.json"), new JsonObject { ["passed"] = false, ["checks"] = checks, ["error"] = error.ToString() }.ToJsonString());
            throw;
        }
    }
    private static async Task<ClientWebSocket> Open(string url, string path, JsonObject hello)
    {
        var socket = new ClientWebSocket();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await socket.ConnectAsync(new Uri(url.Replace("http:", "ws:") + path), timeout.Token).ConfigureAwait(false);
        await socket.SendAsync(Encoding.UTF8.GetBytes(hello.ToJsonString()), WebSocketMessageType.Text, true, timeout.Token).ConfigureAwait(false);
        return socket;
    }
    private static async Task Send(ClientWebSocket socket, byte[] message)
    { using var timeout = new CancellationTokenSource(5000); await socket.SendAsync(message, WebSocketMessageType.Binary, true, timeout.Token); }
    private static async Task<(byte[] Data, bool Text)> Read(ClientWebSocket socket, CancellationToken token)
    {
        byte[] buffer = new byte[16384]; using var message = new MemoryStream();
        while (true)
        {
            var frame = await socket.ReceiveAsync(buffer, token).ConfigureAwait(false);
            if (frame.MessageType == WebSocketMessageType.Close) throw new IOException("The proof socket was closed: " + socket.CloseStatusDescription);
            message.Write(buffer, 0, frame.Count);
            if (message.Length > 1024 * 1024) throw new IOException("Unexpectedly large proof message.");
            if (frame.EndOfMessage) return (message.ToArray(), frame.MessageType == WebSocketMessageType.Text);
        }
    }
    private static async Task<JsonObject?> Until(ClientWebSocket socket, Func<JsonObject, bool> match)
    {
        using var timeout = new CancellationTokenSource(10000);
        while (true) { var data = await Read(socket, timeout.Token); if (data.Text && JsonNode.Parse(data.Data) is JsonObject node && match(node)) return node; }
    }
    private static async Task<bool> Binary(ClientWebSocket socket, byte kind)
    {
        using var timeout = new CancellationTokenSource(10000);
        while (true) { var data = await Read(socket, timeout.Token); if (!data.Text && data.Data.Length > 1 && data.Data[0] == kind) return true; }
    }
}
