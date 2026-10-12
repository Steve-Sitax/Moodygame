using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeServiceHost
{
    private sealed record AsyncRoute(string Method, string Pattern, Regex Match, Func<NativeServiceRequest, Task<object?>> Handler);
    private readonly List<AsyncRoute> asyncRoutes = new();
    public void RegisterAsync(string method, string pattern, Func<NativeServiceRequest, Task<object?>> handler)
    {
        method = method.ToUpperInvariant();
        if (CanHandle(method, pattern)) throw new InvalidOperationException("Duplicate native route " + method + " " + pattern);
        var expression = "^" + Regex.Replace(Regex.Escape(pattern), @":([A-Za-z][A-Za-z0-9_]*)", m => "(?<" + m.Groups[1].Value + ">[^/]+)") + "$";
        asyncRoutes.Add(new(method, pattern, new Regex(expression, RegexOptions.CultureInvariant), handler));
    }
    private bool CanHandleAsync(string method, string path) => asyncRoutes.Any(r => r.Method == method.ToUpperInvariant() && r.Match.IsMatch(NormalPath(path)));
    private IEnumerable<string> AsyncPatterns => asyncRoutes.Select(r => r.Method + " " + r.Pattern);

    /// <summary>Short state operations around an asynchronous narration call. Never hold this lock while calling a provider.</summary>
    public async Task<T> WithState<T>(Func<NativeServiceContext, T> operation)
    {
        RequireOpen();
        await gate.WaitAsync().ConfigureAwait(false);
        try { RequireOpen(); return operation(Context); }
        finally { gate.Release(); }
    }
    private async Task<string> CallAsync(AsyncRoute route, string method, string path, string? body, int playerId)
    {
        var request = await WithState(context => {
            if (context.Scalar<long>("SELECT COUNT(*) FROM player WHERE id=$p0", playerId) == 0) throw new NativeServiceException("no such player", 404);
            JsonObject input;
            try { input = string.IsNullOrEmpty(body) ? new JsonObject() : JsonNode.Parse(body)?.AsObject() ?? throw new JsonException(); }
            catch (Exception e) when (e is JsonException or InvalidOperationException) { throw new NativeServiceException("send a JSON object"); }
            var match = route.Match.Match(NormalPath(path));
            var parameters = route.Match.GetGroupNames().Where(n => n != "0").ToDictionary(n => n, n => Uri.UnescapeDataString(match.Groups[n].Value));
            var query = new Dictionary<string, string>();
            if (path.Contains('?')) foreach (var part in path[(path.IndexOf('?') + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            { var pair = part.Split('=', 2); query[Uri.UnescapeDataString(pair[0])] = pair.Length > 1 ? Uri.UnescapeDataString(pair[1]) : ""; }
            return new NativeServiceRequest(context, method, NormalPath(path), playerId, input, parameters, query);
        }).ConfigureAwait(false);
        return JsonSerializer.Serialize(await ForPlayerAsync(playerId, () => route.Handler(request)).ConfigureAwait(false));
    }
}
