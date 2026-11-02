using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

/// <summary>
/// Which models each configured AI offers now (2026-11-02): asked when AI setup opens and at most once a day in the
/// background, with a short timeout, never blocking play. The Anthropic key goes only to Anthropic's models endpoint, an
/// OpenAI-compatible key only to that server's own address; neither is logged. The Claude login has no model list, so
/// it uses the Anthropic list when a key is set, otherwise the built-in current list. The answer is cached in the
/// settings folder (ai-models.json). Lists show the newest of each tier first (Opus, Sonnet, Haiku, Fable), then the rest.
/// </summary>
public sealed class NativeAiModels
{
    private readonly NativeAiConfiguration settings;
    private readonly HttpClient http;
    private readonly string file;
    private readonly SemaphoreSlim running = new(1, 1);
    private JsonObject cache;
    public string AnthropicModelsUrl { get; set; } = "https://api.anthropic.com/v1/models";
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(6);
    public NativeAiModels(NativeAiConfiguration settings, string file, HttpClient http)
    {
        this.settings = settings; this.file = file; this.http = http;
        try { cache = File.Exists(file) ? JsonNode.Parse(File.ReadAllText(file)) as JsonObject ?? new() : new(); }
        catch (Exception e) when (e is IOException or System.Text.Json.JsonException) { cache = new(); }
    }
    private static string S(JsonNode? n, string key) => NativeGoods.S(n, key);
    public DateTime? CheckedAt => DateTime.TryParse(S(cache, "checkedAt"), null, System.Globalization.DateTimeStyles.RoundtripKind, out var at) ? at : null;
    public bool Stale => CheckedAt is not { } at || DateTime.UtcNow - at > TimeSpan.FromHours(24);

    private static readonly string[] Tiers = { "opus", "sonnet", "haiku", "fable", "mythos" };
    private static readonly Regex NotChat = new("embed|whisper|tts|dall-e|moderation|image|audio|transcribe|realtime|search|rerank", RegexOptions.IgnoreCase);
    public static string Tier(string id) => Tiers.FirstOrDefault(t => id.Contains(t, StringComparison.OrdinalIgnoreCase)) ?? "";
    /// <summary>The version numbers in a model id, a date suffix left out: claude-sonnet-5-5 -> [5,5], claude-haiku-4-5-20251001 -> [4,5].</summary>
    public static int[] Version(string id) => Regex.Matches(id, @"(?<![0-9])[0-9]{1,3}(?![0-9])").Select(m => int.Parse(m.Value)).ToArray();
    public static int CompareVersion(int[] a, int[] b)
    {
        for (int i = 0; i < Math.Max(a.Length, b.Length); i++) { int x = i < a.Length ? a[i] : 0, y = i < b.Length ? b[i] : 0; if (x != y) return x.CompareTo(y); }
        return 0;
    }
    /// <summary>"claude-sonnet-5-5" -> "Claude Sonnet 5.5"; other ids stay as they are.</summary>
    public static string Friendly(string id)
    {
        var m = Regex.Match(id, @"^claude-([a-z]+)-([0-9]+)(?:-([0-9]{1,2}))?(?:-[0-9]{8})?$");
        if (!m.Success) return id;
        string tier = char.ToUpperInvariant(m.Groups[1].Value[0]) + m.Groups[1].Value[1..];
        return "Claude " + tier + " " + m.Groups[2].Value + (m.Groups[3].Success ? "." + m.Groups[3].Value : "");
    }
    /// <summary>Newest first: Claude models the newest of each tier (Opus, Sonnet, Haiku, Fable), then the older ones;
    /// other providers by date (or version) newest first.</summary>
    public static List<JsonObject> Order(IEnumerable<JsonObject> models)
    {
        var list = models.ToList();
        if (list.All(m => Tier(S(m, "id")) == ""))
            return list.OrderByDescending(m => NativeGoods.N(m, "created", 0)).ThenByDescending(m => Version(S(m, "id")), Comparer<int[]>.Create(CompareVersion)).ToList();
        var byTier = list.GroupBy(m => Tier(S(m, "id"))).OrderBy(g => g.Key == "" ? 99 : Array.IndexOf(Tiers, g.Key))
            .Select(g => g.OrderByDescending(m => Version(S(m, "id")), Comparer<int[]>.Create(CompareVersion)).ThenByDescending(m => NativeGoods.N(m, "created", 0)).ToList()).ToList();
        return byTier.Select(g => g[0]).Concat(byTier.SelectMany(g => g.Skip(1))).ToList();
    }

    private async Task<JsonNode> Get(string url, Dictionary<string, string> headers, CancellationToken stop)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        foreach (var header in headers) request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        using var reply = await http.SendAsync(request, stop).ConfigureAwait(false);
        if (!reply.IsSuccessStatusCode) throw new InvalidOperationException($"the model list answered {(int)reply.StatusCode}");
        return JsonNode.Parse(await reply.Content.ReadAsStringAsync(stop).ConfigureAwait(false)) ?? throw new InvalidOperationException("no model list");
    }
    private async Task<JsonObject> Ask(string provider, CancellationToken stop)
    {
        var models = new List<JsonObject>();
        if (provider == "anthropic_api")
        {
            string key = S(settings.Connection("anthropic_api"), "apiKey");
            if (key == "") return new JsonObject { ["state"] = "not_checked", ["note"] = "model list not checked (no API key)" };
            var reply = await Get(AnthropicModelsUrl + "?limit=100", new() { ["x-api-key"] = key, ["anthropic-version"] = "2023-06-01" }, stop).ConfigureAwait(false);
            foreach (var m in reply["data"]?.AsArray() ?? new JsonArray())
                models.Add(new JsonObject { ["id"] = S(m, "id"), ["label"] = S(m, "display_name") is { Length: > 0 } name ? name : Friendly(S(m, "id")),
                    ["created"] = DateTimeOffset.TryParse(S(m, "created_at"), out var at) ? at.ToUnixTimeSeconds() : 0 });
        }
        else if (provider == "openai_compat")
        {
            var connection = settings.Connection("openai_compat"); string url = S(connection, "baseUrl"), key = S(connection, "apiKey");
            if (url == "") return new JsonObject { ["state"] = "not_checked", ["note"] = "model list not checked (no address)" };
            var headers = new Dictionary<string, string>(); if (key != "") headers["Authorization"] = "Bearer " + key;
            var reply = await Get(url + "/models", headers, stop).ConfigureAwait(false);
            foreach (var m in reply["data"]?.AsArray() ?? new JsonArray())
                if (S(m, "id") is { Length: > 0 } id && !NotChat.IsMatch(id)) models.Add(new JsonObject { ["id"] = id, ["label"] = id, ["created"] = NativeGoods.N(m, "created", 0) });
        }
        else if (provider == "ollama")
        {
            string url = S(settings.Connection("ollama"), "baseUrl");
            var reply = await Get(url + "/api/tags", new(), stop).ConfigureAwait(false);
            foreach (var m in reply["models"]?.AsArray() ?? new JsonArray())
                if (S(m, "name") is { Length: > 0 } id && !NotChat.IsMatch(id)) models.Add(new JsonObject { ["id"] = id, ["label"] = id, ["created"] = DateTimeOffset.TryParse(S(m, "modified_at"), out var at) ? at.ToUnixTimeSeconds() : 0 });
        }
        else return new JsonObject { ["state"] = "built_in", ["note"] = "built-in list" };
        models = models.Where(m => S(m, "id").Length is > 0 and <= 100).ToList();
        if (models.Count == 0) throw new InvalidOperationException("the model list was empty");
        return new JsonObject { ["state"] = "checked", ["models"] = new JsonArray(Order(models).Select(m => (JsonNode)m).ToArray()) };
    }
    /// <summary>Asks every provider that has its connection set, in parallel, each within the timeout. Never throws.</summary>
    public async Task<JsonObject> Detect(CancellationToken stop = default)
    {
        if (!await running.WaitAsync(0, stop).ConfigureAwait(false)) return Snapshot();
        try
        {
            var providers = new[] { "anthropic_api", "openai_compat", "ollama" };
            var results = await Task.WhenAll(providers.Select(async provider =>
            {
                using var limit = CancellationTokenSource.CreateLinkedTokenSource(stop); limit.CancelAfter(Timeout);
                try { return (provider, await Ask(provider, limit.Token).ConfigureAwait(false)); }
                catch (Exception e) when (e is HttpRequestException or InvalidOperationException or OperationCanceledException or System.Text.Json.JsonException)
                {
                    string why = e is OperationCanceledException ? "no answer in time" : settings.Scrub(e.Message);
                    return (provider, new JsonObject { ["state"] = "not_checked", ["note"] = "model list not checked (" + why[..Math.Min(120, why.Length)] + ")" });
                }
            })).ConfigureAwait(false);
            var next = new JsonObject { ["checkedAt"] = DateTime.UtcNow.ToString("o"), ["providers"] = new JsonObject() };
            foreach (var (provider, result) in results) { result["at"] = next["checkedAt"]!.DeepClone(); next["providers"]![provider] = result; }
            lock (this) cache = next;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file))!);
                string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
                File.WriteAllText(temporary, next.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true })); File.Move(temporary, file, true);
            }
            catch (IOException) { }
            return Snapshot();
        }
        finally { running.Release(); }
    }
    public JsonObject Snapshot() { lock (this) return cache.DeepClone().AsObject(); }
    /// <summary>The models one provider offers now: its detected list (built-in labels and effort kept), or the built-in list.</summary>
    public JsonArray ListFor(string provider, JsonArray builtIn, out JsonObject check)
    {
        var detected = Snapshot()["providers"]?[provider == "claude_local" ? "anthropic_api" : provider] as JsonObject;
        if (detected != null && S(detected, "state") == "checked" && detected["models"] is JsonArray found && (provider != "claude_local" || found.Any(m => Tier(S(m, "id")) != "")))
        {
            check = new JsonObject { ["state"] = "checked", ["at"] = detected["at"]?.DeepClone(), ["note"] = provider == "claude_local" ? "model list checked with the Anthropic key" : "model list checked" };
            var known = builtIn.OfType<JsonObject>().ToDictionary(m => S(m, "id"));
            return new JsonArray(found.OfType<JsonObject>().Select(m =>
            {
                var row = new JsonObject { ["id"] = S(m, "id"), ["label"] = known.TryGetValue(S(m, "id"), out var b) ? S(b, "label") : S(m, "label") is { Length: > 0 } l && l != S(m, "id") ? l : Friendly(S(m, "id")) };
                row["effort"] = b != null ? b["effort"]?.DeepClone() : Tier(S(m, "id")) != "" && !S(m, "id").Contains("haiku-4", StringComparison.Ordinal) && !S(m, "id").StartsWith("claude-3", StringComparison.Ordinal);
                return (JsonNode)row;
            }).ToArray());
        }
        check = provider is "claude_local" or "codex_cli" ? new JsonObject { ["state"] = "built_in", ["note"] = "built-in list of current models (this login cannot list its models)" }
            : detected != null && S(detected, "state") == "not_checked" ? new JsonObject { ["state"] = "not_checked", ["note"] = S(detected, "note"), ["at"] = detected["at"]?.DeepClone() }
            : new JsonObject { ["state"] = "not_checked", ["note"] = "model list not checked" };
        return builtIn.DeepClone().AsArray();
    }
}
