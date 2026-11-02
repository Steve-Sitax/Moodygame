using System;
using System.Text.Json;

namespace Scheldemist.Menu;

/// <summary>
/// What the game's server says about AI now (GET /api/ai/config, and the "ai" push after every change): on or off,
/// ready or why not. The host's server decides for everyone, a guest included; the start flag is not consulted here.
/// The typing box, the menu's AI item and the AI setup sheet all read this one state.
/// </summary>
public static class AiState
{
    public static bool Known { get; private set; }
    /// <summary>"ai" or "walk".</summary>
    public static string Mode { get; private set; } = "";
    /// <summary>"ready", "off", "no_login" or "failing".</summary>
    public static string State { get; private set; } = "";
    public static string Title { get; private set; } = "";
    public static string Text { get; private set; } = "";
    /// <summary>The run was started with no AI (a test start): the switch cannot turn it on.</summary>
    public static bool Locked { get; private set; }
    /// <summary>This player may change the settings (the host; a guest follows the host).</summary>
    public static bool Host { get; private set; } = true;
    public static event Action? Changed;

    /// <summary>The player may type their own words, as far as the AI setting goes (each reply's "free" still decides per turn).
    /// Before the server has answered, the reply's own flag decides alone.</summary>
    public static bool AllowsTyping => !Known || Mode == "ai" && State is "ready" or "failing";
    public static bool On => Known && Mode == "ai" && !Locked;

    private static string S(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    /// <summary>From the full settings view or the push (both carry "mode" and "status").</summary>
    public static void Update(JsonElement view)
    {
        if (view.ValueKind != JsonValueKind.Object) return;
        Mode = S(view, "mode");
        if (view.TryGetProperty("status", out var s))
        {
            State = S(s, "state");
            Title = S(s, "title");
            Text = S(s, "text");
        }
        if (view.TryGetProperty("locked", out var l)) Locked = l.ValueKind == JsonValueKind.True;
        if (view.TryGetProperty("host", out var h)) Host = h.ValueKind != JsonValueKind.False;
        Known = true;
        Changed?.Invoke();
    }

    /// <summary>The menu item's words: "AI: on" / "AI: off", and the short status under it.</summary>
    public static string Label => !Known ? "AI: ..." : On ? "AI: on" : "AI: off";
}
