using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeServiceHost : INativeRecipientBackend
{
    private sealed record Route(string Method, string Pattern, Regex Match, Func<NativeServiceRequest, object?> Handler);
    private readonly List<Route> routes = new();
    private readonly SemaphoreSlim gate = new(1, 1);
    private int closed;
    private void RequireOpen() { if (Volatile.Read(ref closed) != 0) throw new NativeServiceException("the game has closed", 503); }
    public NativeServiceContext Context { get; }
    public NativeCoreClock Clock { get; }
    public NativeCoreTrade Trade { get; }
    public NativeCoreJobs Jobs { get; }
    public NativeCoreSave Saves { get; }
    public NativeCoreRest Rest { get; }
    public NativeCoreRumours Rumours { get; }
    public NativeCoreHomes Homes { get; }
    public NativeCoreInteriors Interiors { get; }
    public NativeCoreNight Night { get; }
    public event Action<string>? Push;
    public event Action? NewGame;
    public event Action? Loaded;
    public readonly List<Func<int, JsonObject>> PayloadParts = new();
    public readonly List<Action<int>> MidnightHooks = new();
    public readonly List<Func<int, JsonArray>> MidnightLines = new();
    public readonly List<Action<NativeServiceRequest, bool>> TickHooks = new();
    public readonly List<Action<NativeServiceRequest, bool>> PlayerTickHooks = new();
    public readonly List<Action<NativeServiceRequest>> PresenceHooks = new();
    public readonly List<Action<NativeServiceRequest>> TickAfterHooks = new();
    public readonly List<Action<JsonObject, int>> TakeJobChecks = new();
    public readonly List<Action<JsonObject, int>> TakeJobHooks = new();
    public readonly List<Action<int>> EndJobHooks = new();
    public readonly List<Action<int>> StopTransportHooks = new();
    public readonly List<Action<int>> HourHooks = new();
    public readonly List<Action<int>> SleepEndedHooks = new();
    public readonly List<Func<int, string, bool, int, JsonObject?>> SleepHooks = new();
    public Func<int, JsonObject>? HomeBed;
    public Func<IEnumerable<int>> OnlinePlayers = () => new[] { 1 };
    public Func<int, string, JsonObject?>? ResolveRoom;
    public Func<int, bool, (int? chill, int? gain, int cap)?>? TransportWarmth;
    public Func<int, int, int>? RowFood;
    public Action<int>? RumourRound;
    public Action<int, string, int>? MemoryHook;

    public NativeServiceHost(NativeServiceOptions options)
    {
        Context = new NativeServiceContext(options);
        Clock = new NativeCoreClock(this);
        Trade = new NativeCoreTrade(this);
        Jobs = new NativeCoreJobs(this);
        Saves = new NativeCoreSave(this);
        Rest = new NativeCoreRest(this);
        Rumours = new NativeCoreRumours(this);
        Homes = new NativeCoreHomes(this);
        Interiors = new NativeCoreInteriors(this);
        Night = new NativeCoreNight(this);
        Clock.Register(this); Trade.Register(this); Jobs.Register(this); Saves.Register(this); Rest.Register(this); Rumours.Register(this); Homes.Register(this); Interiors.Register(this); Night.Register(this);
        Register("GET", "/api/state", r => Payload(r.PlayerId));
        Register("GET", "/api/jobs", r => Payload(r.PlayerId));
        Register("POST", "/api/new-game", r => { if (r.PlayerId != 1) throw new NativeServiceException("only the host starts a new week", 403); Reset(); return Payload(r.PlayerId); });
    }
    public void AddModule(INativeServiceModule module) => module.Register(this);
    public void Register(string method, string pattern, Func<NativeServiceRequest, object?> handler)
    {
        method = method.ToUpperInvariant();
        if (routes.Any(r => r.Method == method && r.Pattern == pattern)) throw new InvalidOperationException("Duplicate native route " + method + " " + pattern);
        var expression = "^" + Regex.Replace(Regex.Escape(pattern), @":([A-Za-z][A-Za-z0-9_]*)", m => "(?<" + m.Groups[1].Value + ">[^/]+)") + "$";
        routes.Add(new Route(method, pattern, new Regex(expression, RegexOptions.CultureInvariant), handler));
    }
    public IReadOnlyList<string> RoutePatterns => routes.Select(r => r.Method + " " + r.Pattern).Concat(AsyncPatterns).ToArray();
    private static string NormalPath(string path) => "/" + path.Split('?')[0].Trim('/');
    public bool CanHandle(string method, string path) => routes.Any(r => r.Method == method.ToUpperInvariant() && r.Match.IsMatch(NormalPath(path))) || CanHandleAsync(method, path);
    public async Task<string> Call(string method, string path, string? body, int playerId = 1)
    {
        RequireOpen();
        var asynchronous = asyncRoutes.FirstOrDefault(r => r.Method == method.ToUpperInvariant() && r.Match.IsMatch(NormalPath(path)));
        if (asynchronous != null) return await CallAsync(asynchronous, method.ToUpperInvariant(), path, body, playerId).ConfigureAwait(false);
        await gate.WaitAsync().ConfigureAwait(false);
        try
        {
            RequireOpen();
            method = method.ToUpperInvariant();
            string plain = NormalPath(path);
            var route = routes.FirstOrDefault(r => r.Method == method && r.Match.IsMatch(plain));
            if (route == null) throw new NativeServiceException("Native gameplay route is not implemented: " + method + " " + plain, 501);
            if (Context.Scalar<long>("SELECT COUNT(*) FROM player WHERE id=$p0", playerId) == 0) throw new NativeServiceException("no such player", 404);
            JsonObject input;
            try { input = string.IsNullOrEmpty(body) ? new JsonObject() : JsonNode.Parse(body)?.AsObject() ?? throw new JsonException(); }
            catch (Exception e) when (e is JsonException or InvalidOperationException) { throw new NativeServiceException("send a JSON object", 400); }
            var match = route.Match.Match(plain);
            var parameters = route.Match.GetGroupNames().Where(n => n != "0").ToDictionary(n => n, n => Uri.UnescapeDataString(match.Groups[n].Value));
            var query = new Dictionary<string, string>();
            if (path.Contains('?')) foreach (var part in path[(path.IndexOf('?') + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var pair = part.Split('=', 2); query[Uri.UnescapeDataString(pair[0])] = pair.Length > 1 ? Uri.UnescapeDataString(pair[1]) : "";
            }
            var request = new NativeServiceRequest(Context, method, plain, playerId, input, parameters, query);
            return ForPlayer(playerId, () => JsonSerializer.Serialize(route.Handler(request)));
        }
        finally { gate.Release(); }
    }
    public JsonObject Payload(int playerId)
    {
        Jobs.EnsureStartup();
        var result = new JsonObject {
            ["board"] = Jobs.BoardState(),
            ["jobs"] = Jobs.List(playerId), ["player"] = Player(playerId), ["pockets"] = Trade.Pockets(playerId),
            ["clock"] = Clock.View(), ["rent"] = new JsonObject { ["paid"] = Clock.RentPaid(playerId), ["price_c"] = 150, ["bedtime"] = 18 },
            ["ending"] = Context.PlayerState(playerId, "ending"),
            ["ride"] = new JsonObject { ["on"] = Context.PlayerState(playerId, "ride"), ["fare_c"] = 5, ["change"] = Context.PlayerState(playerId, "ride_change") },
            ["lamps_fog"] = Clock.FogView(), ["lamps_help"] = Context.World("lamps_help")
        };
        foreach (var part in PayloadParts) foreach (var pair in part(playerId)) result[pair.Key] = pair.Value?.DeepClone();
        return result;
    }
    public JsonObject Player(int playerId) => Context.One("SELECT p.name,p.money_c,w.day,w.hour,p.district,p.food,p.warmth,p.health,p.sleep FROM player p,player w WHERE p.id=$p0 AND w.id=1", playerId) ?? throw new NativeServiceException("no such player", 404);
    public void Publish(string type, JsonObject? data = null)
    {
        if (Volatile.Read(ref closed) != 0) return;
        var message = data?.DeepClone().AsObject() ?? new JsonObject(); message["type"] = type;
        if (type == "jobs")
        {
            // The world changed, but pockets, taken work and needs are each recipient's own.
            foreach (var node in Context.Rows("SELECT id FROM player WHERE id>0 ORDER BY id"))
            {
                int player = NativeCoreClock.Number(node!.AsObject(),"id");
                var own = message.DeepClone().AsObject();
                foreach (var pair in ForPlayer(player, () => Payload(player))) own[pair.Key] = pair.Value?.DeepClone();
                Emit(player, own);
            }
            return;
        }
        Emit(PersonalPushTypes.Contains(type) ? CurrentPlayer : null, message);
    }
    private static readonly HashSet<string> PersonalPushTypes = new() { "outcome", "trouble", "press", "gang", "families", "hands", "ending", "rent" };
    private void Emit(int? playerId, JsonObject message)
    {
        string json = message.ToJsonString();
        RoutedPush?.Invoke(playerId, json);
        if (playerId == null || playerId == 1) Push?.Invoke(json);
    }
    public void PublishFor(int playerId, string type, JsonObject? data = null)
    {
        if (Volatile.Read(ref closed) != 0) return;
        var message = data?.DeepClone().AsObject() ?? new JsonObject(); message["type"] = type;
        if (type == "jobs") foreach (var pair in ForPlayer(playerId, () => Payload(playerId))) message[pair.Key] = pair.Value?.DeepClone();
        Emit(playerId, message);
    }
    public void PublishState(int playerId = 1) => Publish("jobs", Payload(playerId));
    public void Reset()
    {
        Context.Execute("PRAGMA foreign_keys=OFF");
        try {
            Context.Atomic(() => { foreach (var row in Context.Rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) {
                string table = row!["name"]!.GetValue<string>();
                if (table is "player_profile" or "game_setting" || table.StartsWith("mp_",StringComparison.Ordinal)) continue;
                Context.Execute("DELETE FROM \"" + table + "\"");
            }});
            Context.RestoreSeed();
            Saves.EnsureIdentities();
            foreach(var profile in Context.Rows("SELECT player_id,profile_json FROM player_profile")) {
                var saved = JsonNode.Parse(profile!["profile_json"]!.GetValue<string>()) as JsonObject;
                if(saved?["first"] is JsonValue first && first.TryGetValue<string>(out var name)) Context.Execute("UPDATE player SET name=$p0 WHERE id=$p1",name,NativeCoreClock.Number(profile.AsObject(),"player_id"));
            }
        } finally { Context.Execute("PRAGMA foreign_keys=ON"); }
        Clock.ResetLimits(); NewGame?.Invoke(); Saves.EnsureIdentities(); Jobs.MakeBoard(); PublishState();
    }
    public void NotifyLoaded() { Clock.ResetLimits(); Loaded?.Invoke(); }
    public void Dispose()
    {
        if (Interlocked.Exchange(ref closed, 1) != 0) return;
        // Let an already active short transaction finish; queued and late provider completions are refused.
        // Keep the managed semaphore alive for those waiters to release safely after observing closure.
        gate.Wait();
        try { Context.Dispose(); }
        finally { gate.Release(); }
    }
}
