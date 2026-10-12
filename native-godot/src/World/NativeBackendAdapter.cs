using System;
using System.Threading.Tasks;
using Scheldemist.Net;
using Scheldemist.Native.Services;
using System.Text.Json.Nodes;
using System.Linq;
using System.Threading;

namespace Scheldemist.Native.World;

public sealed class NativeBackendAdapter : ILocalGameBackend
{
    private readonly INativeServiceBackend backend;
    private readonly NativeAI? ai;
    private readonly NativeTownProfile? profile;
    public int PlayerId { get; }
    private readonly bool ownsBackend;
    private int disposed;
    public NativeBackendAdapter(INativeServiceBackend backend, NativeAI? ai = null, NativeTownProfile? profile = null, int playerId = 1, bool ownsBackend = true)
    {
        this.backend = backend; this.ai = ai; this.profile = profile; PlayerId = playerId; this.ownsBackend = ownsBackend;
        if (backend is INativeRecipientBackend routed) routed.RoutedPush += OnRoutedPush;
        else backend.Push += OnPush;
    }
    public event Action<string>? Push;
    /// <summary>Use under the host state lock; each seat has its own character's address and name.</summary>
    public string Translate(string json)
    {
        if (profile == null) return json;
        var shown = profile.ShownSnapshot(PlayerId);
        JsonNode? Translate(JsonNode? node) => node switch {
            JsonObject obj => new JsonObject(obj.Select(p => new System.Collections.Generic.KeyValuePair<string,JsonNode?>(p.Key, Translate(p.Value)))),
            JsonArray array => new JsonArray(array.Select(Translate).ToArray()),
            JsonValue value when value.TryGetValue<string>(out var text) => JsonValue.Create(shown(text)),
            _ => node?.DeepClone()
        };
        return Translate(JsonNode.Parse(json))!.ToJsonString();
    }
    public Task<string> TranslateAsync(string json) => backend is NativeServiceHost host ? host.WithState(_ => Translate(json)) : Task.FromResult(Translate(json));
    private void OnPush(string json) { if (Volatile.Read(ref disposed) == 0) Push?.Invoke(Translate(json)); }
    private void OnRoutedPush(int? recipient, string json) { if (recipient == null || recipient == PlayerId) OnPush(json); }
    public async Task<string> Call(string method, string path, string? body)
    {
        try
        {
            if (Volatile.Read(ref disposed) != 0) throw new NativeServiceException("the game has closed", 503);
            string reply = await backend.Call(method, path, body, PlayerId).ConfigureAwait(false);
            if (profile == null || path.TrimStart('/').StartsWith("api/player/",StringComparison.Ordinal)) return reply;
            return await TranslateAsync(reply).ConfigureAwait(false);
        }
        catch (NativeServiceException e)
        {
            // A quiet HUD toast must not let an incomplete gameplay port pass an engine smoke test.
            // Never log request bodies: dialogue and provider settings can contain private text.
            if (e.Status == 501) Godot.GD.PushError($"Missing native gameplay rule: {method} {path.Split('?')[0]}");
            throw new ApiException(e.Message, e.Status, e);
        }
    }
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        if (backend is INativeRecipientBackend routed) routed.RoutedPush -= OnRoutedPush; else backend.Push -= OnPush;
        if (ownsBackend) { ai?.Dispose(); backend.Dispose(); }
    }
}
