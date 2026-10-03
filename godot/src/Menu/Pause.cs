using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Net;

namespace Scheldemist.Menu;

/// <summary>
/// The pause (the browser's game/pause.ts; docs/milestones/M7-save-pause.md): "nothing progresses on pause, like
/// real games". The game is paused while there is a reason: "menu" (the menu is up, or the game does not have the
/// mouse), "key" (P's card), "saving", "loading". Paused: the scene tree stands still (every part's _Process, the
/// shaders' clock, the physics), and the server hears it (POST /api/pause with this game's name: its clock, its
/// ticks and its model calls stop too; a model's answer on its way is kept until the unpause).
///
/// A part that must go on while paused (a menu, a card) sets `ProcessMode = Always`. Parts that keep real-time
/// counts of their own listen to `Pause.Changed`.
/// </summary>
public static class Pause
{
    private static readonly HashSet<string> reasons = new();
    /// <summary>The game went into a pause (true) or out of it.</summary>
    public static event Action<bool>? Changed;

    public static bool Paused => reasons.Count > 0;
    public static bool Has(string reason) => reasons.Contains(reason);
    public static IReadOnlyList<string> Reasons => reasons.ToList();

    /// <summary>Add or take away one reason to be paused; the game plays when there is none.</summary>
    public static void Set(string reason, bool on)
    {
        bool was = Paused;
        if (on) reasons.Add(reason);
        else reasons.Remove(reason);
        bool now = Paused;
        if (was == now) return;
        if (Main.I?.GetTree() is { } tree) tree.Paused = now;
        Tell(now);
        Changed?.Invoke(now);
    }

    private static bool told;
    /// <summary>The server hears the pause; a call that fails is sent again by Resend (the menu's part, every few seconds).</summary>
    private static void Tell(bool on)
    {
        var api = ServerLink.I?.Api;
        if (api == null) return;
        api.Run(api.SetPause(on), _ => told = on, _ => { });
    }

    /// <summary>The server may have missed it (it was away, it started again): say it again when it differs.</summary>
    public static void Resend()
    {
        if (told != Paused) Tell(Paused);
    }

    /// <summary>The game ends or goes back to the first page: no reason is left.</summary>
    public static void Clear()
    {
        foreach (string r in reasons.ToList()) Set(r, false);
    }
}
