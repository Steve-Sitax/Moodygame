using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace Scheldemist.Net;

// The menus' calls (godot/src/Menu): the saves, the pause, the AI setup, the town's settings, the player's
// character, a new week. Extension methods on Api, with their payloads, so Api.cs stays as it is.
//
// The server's save and pause routes speak snake_case (as Api.Json writes); the AI setup, the town's settings and
// the character speak camelCase: those go out as dictionaries (their keys are sent as written) and come back as
// JsonElement.

/// <summary>One saved game in the list (server/src/save/saves.ts SaveInfo).</summary>
public sealed record SaveInfo(string Slot, string Kind, string Label, string SavedAt, int Day, string Weekday, int Hour, int Minute, string Place, int MoneyC);

/// <summary>GET /api/saves: newest first.</summary>
public sealed record SavesReply(List<SaveInfo>? Saves, string? Newest);

/// <summary>POST /api/save. `Deferred`: a quiet autosave put off (the town is talking). `Guest`: only his own part was kept.</summary>
public sealed record SaveReply(bool Ok, SaveInfo? Info, List<SaveInfo>? Saves, double? Ms, bool? Deferred, bool? Guest, string? Error);

/// <summary>POST /api/load: the save's client part (where Jef stood), and the game's state after it.</summary>
public sealed record LoadReply(bool Ok, JsonElement? Client, string? Error);

/// <summary>GET /api/client-state.</summary>
public sealed record ClientStateReply(JsonElement? Client);

/// <summary>The gate (GET and POST /api/pause): is the game paused, is it saving, how many model calls are on their way.</summary>
public sealed record GateReply(bool Paused, string? Mode, int InFlight);

/// <summary>The game's own part of a save (server ClientStateSchema): the minute on screen, the place's name, where Jef stands.</summary>
public sealed record ClientClock(int Day, int Hour, int Minute);
public sealed record ClientPose(double X, double Z, double Y, double Yaw, double Pitch, bool Swimming = false, bool Crouching = false);
public sealed record ClientState(ClientClock? Clock, string? Place, ClientPose Pose)
{
    public int V { get; init; } = 1;
    /// <summary>What other parts add (a boat, the jobs in hand ...): written beside the rest as they are.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? More { get; init; }
}

public static class ApiMenu
{
    public const int SaveTimeoutMs = 60_000;

    public static Task<SavesReply> Saves(this Api api) => api.Get<SavesReply>("api/saves");

    /// <summary>Save into a slot ("slot1".."slot5", or "auto"). `quiet`: only in a moment with no model call on its way.</summary>
    public static Task<SaveReply> Save(this Api api, string slot, string? label, ClientState client, bool quiet = false, int timeoutMs = SaveTimeoutMs)
    {
        var body = new Dictionary<string, object?> { ["slot"] = slot, ["client"] = client };
        if (label != null) body["label"] = label;
        if (quiet) body["quiet"] = true;
        return api.Post<SaveReply>("api/save", body, timeoutMs);
    }

    public static Task<LoadReply> Load(this Api api, string slot) => api.Post<LoadReply>("api/load", new { slot }, SaveTimeoutMs);
    public static Task<ClientStateReply> GetClientState(this Api api) => api.Get<ClientStateReply>("api/client-state");

    /// <summary>The pause, held under this game's name: the server lets go of it when the push channel closes.</summary>
    public static Task<GateReply> SetPause(this Api api, bool on) => api.Post<GateReply>("api/pause", new { on, client = api.ClientId }, 5000);
    public static Task<GateReply> Gate(this Api api) => api.Get<GateReply>("api/pause");

    /// <summary>The AI setup as the server describes it (docs/ai-setup.md).</summary>
    public static Task<JsonElement> AiConfig(this Api api, int timeoutMs = 15_000) => api.Get<JsonElement>("api/ai/config", timeoutMs);
    /// <summary>Change it: a patch ({mode}, {default}, {kinds}, {typedLines}, {connections}); the new description comes back.</summary>
    public static Task<JsonElement> PutAiConfig(this Api api, Dictionary<string, object?> patch) => api.Put<JsonElement>("api/ai/config", patch, 15_000);
    /// <summary>Try an AI: {kind}, {choice} or {all: true}. The server gives each 20 s.</summary>
    public static Task<JsonElement> AiTest(this Api api, Dictionary<string, object?> body) => api.Post<JsonElement>("api/ai/test", body, 60_000);

    /// <summary>The town's own settings: the biggest event, the town size for a new game.</summary>
    public static Task<JsonElement> Population(this Api api) => api.Get<JsonElement>("api/settings/population");
    public static Task<JsonElement> SetPopulation(this Api api, Dictionary<string, object?> body) => api.Post<JsonElement>("api/settings/population", body);

    /// <summary>The player's character: {profile, made, look ...}.</summary>
    public static Task<JsonElement> Profile(this Api api) => api.Get<JsonElement>("api/player/profile");
    /// <summary>Store it: the server checks and clamps; {profile, fixed} comes back.</summary>
    public static Task<JsonElement> PutProfile(this Api api, JsonElement profile) => api.Put<JsonElement>("api/player/profile", new Dictionary<string, object?> { ["profile"] = profile });

    // (a new week: Api.NewGame, in Api.cs)
}
