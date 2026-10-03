using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Ui;

/// <summary>
/// The dialogs on screen (the browser's game/dialogs.ts), in two parts.
///
/// The stack: a sheet or a panel that lies over the rest. `Dialogs.Open(control)` puts it on top (under
/// `Dialogs.Host`, over the HUD), Esc closes the top one (`CloseTop`; the menu's part calls it), `Close(control)`
/// takes one away. A control on the stack keeps working while the game is paused.
///
/// The list: a panel of the game with its own keys (a talk, the map, a card) says once that it exists, with how to
/// tell it is up: `Dialogs.Register("talk", () => open, close: Close)`. While one is up the mouse works it with the
/// ink cursor (InkCursor) instead of turning the view, and Esc closes it instead of opening the menu.
/// </summary>
public static class Dialogs
{
    // ------------------------------------------------------------------ the stack

    private static readonly List<(Control c, Action? closed)> stack = new();
    /// <summary>Where the stack's controls are put: a full-window Control over the HUD (the menu's part makes it).</summary>
    public static Control? Host { get; set; }
    /// <summary>The stack changed (one opened, one closed).</summary>
    public static event Action? Changed;

    public static int Count => stack.Count;
    public static Control? Top => stack.Count > 0 ? stack[^1].c : null;
    public static bool IsOpen(Control c) => stack.Any(s => s.c == c);

    /// <summary>Put a sheet on top. `closed` runs when it goes (by Esc, its Back, or Close).</summary>
    public static void Open(Control c, Action? closed = null)
    {
        c.ProcessMode = Node.ProcessModeEnum.Always;
        stack.Add((c, closed));
        if (c.GetParent() == null) (Host ?? (Node)Main.I.Ui).AddChild(c);
        Changed?.Invoke();
        FocusFirst(c);
    }

    /// <summary>Take this one away (and any opened over it).</summary>
    public static void Close(Control c)
    {
        int i = stack.FindIndex(s => s.c == c);
        if (i < 0) return;
        var gone = stack.GetRange(i, stack.Count - i);
        stack.RemoveRange(i, stack.Count - i);
        gone.Reverse();
        foreach (var (k, closed) in gone)
        {
            if (GodotObject.IsInstanceValid(k)) k.QueueFree();
            closed?.Invoke();
        }
        Changed?.Invoke();
    }

    /// <summary>Esc: the top one goes. False when the stack was empty.</summary>
    public static bool CloseTop()
    {
        if (stack.Count == 0) return false;
        Close(stack[^1].c);
        return true;
    }

    public static void CloseAll()
    {
        if (stack.Count > 0) Close(stack[0].c);
    }

    // ------------------------------------------------------------------ the list of the game's own dialogs

    private sealed record Entry(string Name, Func<bool> Open, bool Cursor, Func<bool> Esc, Action? Close);
    private static readonly List<Entry> list = new();

    /// <summary>
    /// A panel with its own keys: `open` says whether it is on screen now. `cursor: false`: the mouse keeps the
    /// view (a menace to walk away from). `esc`: may Esc close it now; `close`: how.
    /// </summary>
    public static void Register(string name, Func<bool> open, bool cursor = true, Func<bool>? esc = null, Action? close = null)
    {
        list.RemoveAll(e => e.Name == name);
        list.Add(new Entry(name, open, cursor, esc ?? (() => true), close));
    }

    public static void Unregister(string name) => list.RemoveAll(e => e.Name == name);

    private static bool IsUp(Entry e)
    {
        try
        {
            return e.Open();
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>Is any of the game's dialogs up now?</summary>
    public static bool Any() => list.Any(IsUp);
    /// <summary>Is one up that the mouse works (the ink cursor instead of the view)?</summary>
    public static bool Cursor() => list.Any(e => e.Cursor && IsUp(e));
    /// <summary>Is one up that Esc closes?</summary>
    public static bool Escapable() => list.Any(e => IsUp(e) && e.Esc());
    /// <summary>Esc with a dialog up: close the last one that lets it. False when none did.</summary>
    public static bool EscapeOne()
    {
        var e = list.LastOrDefault(x => IsUp(x) && x.Esc() && x.Close != null);
        if (e == null) return false;
        e.Close!();
        return true;
    }
    public static IReadOnlyList<string> Up() => list.Where(IsUp).Select(e => e.Name).ToList();
    public static IReadOnlyList<string> Names() => list.Select(e => e.Name).ToList();

    // ------------------------------------------------------------------ the keyboard in a sheet or a list

    /// <summary>Everything under `root` the keys can reach, in reading order.</summary>
    public static List<Control> Focusables(Node root)
    {
        var o = new List<Control>();
        Walk(root, o);
        return o;
    }

    private static void Walk(Node n, List<Control> o)
    {
        if (n is Control { Visible: false }) return;
        if (n is Control c && c.FocusMode == Control.FocusModeEnum.All && c is not ScrollContainer && c is not ScrollBar && !(c is BaseButton { Disabled: true })) o.Add(c);
        if (n is OptionButton) return;
        foreach (var k in n.GetChildren()) Walk(k, o);
    }

    /// <summary>The first control of a sheet takes the keys (menu.ts focusFirst): the chosen tab or the page's first, never the foot's.</summary>
    public static void FocusFirst(Node root)
    {
        if (!GodotObject.IsInstanceValid(root)) return;
        var l = Focusables(root);
        var first = l.FirstOrDefault(c => c is InkButton { Kind: InkButton.Look.Tab, On: true }) ?? l.FirstOrDefault();
        if (first != null && first.IsInsideTree()) first.GrabFocus();
        else if (first != null) first.Ready += () => first.GrabFocus();
    }

    /// <summary>
    /// The menus' keys (menu.ts menuKey): Up and Down go from control to control, Left and Right change a row of
    /// choices, a list or a slider. True: the key was used.
    /// </summary>
    public static bool NavKey(Node root, InputEventKey e)
    {
        var vp = root.GetViewport();
        var el = vp?.GuiGetFocusOwner();
        bool inside = el != null && root.IsAncestorOf(el);
        if (el is LineEdit && inside && e.Keycode is not (Key.Up or Key.Down)) return false; // a text box has its own keys
        if (e.Keycode is Key.Up or Key.Down)
        {
            Kit.KeyFocus = true;
            var l = Focusables(root);
            if (l.Count == 0) return true;
            int dir = e.Keycode == Key.Down ? 1 : -1;
            int i = inside ? l.IndexOf(el!) : -1;
            // from the tabs, Down goes into the page (Left and Right go along the tabs)
            if (inside && el is InkButton { Kind: InkButton.Look.Tab } && dir > 0)
            {
                var first = l.FirstOrDefault(c => c is not InkButton { Kind: InkButton.Look.Tab });
                if (first != null)
                {
                    first.GrabFocus();
                    return true;
                }
            }
            // a row of choices is one stop: on to the next control that is not its neighbour
            int n = i;
            for (int k = 0; k < l.Count; k++)
            {
                n = (n + dir + l.Count) % l.Count;
                if (i < 0 || el!.GetParent() is not Seg || l[n].GetParent() != el.GetParent()) break;
            }
            var next = l[n];
            if (next.GetParent() is Seg seg)
                foreach (var b in seg.GetChildren())
                    if (b is InkButton { On: true } onB)
                        next = onB;
            next.GrabFocus();
            foreach (var c in l) c.QueueRedraw();
            return true;
        }
        if (e.Keycode is Key.Left or Key.Right)
        {
            if (!inside) return true;
            Kit.KeyFocus = true;
            int dir = e.Keycode == Key.Right ? 1 : -1;
            if (el is InkSlider sl) return sl.Step(dir);
            if (el is Select se) return se.Step(dir);
            if (el!.GetParent() is Seg sg) return sg.Step(dir);
            if (el is InkButton { Kind: InkButton.Look.Tab } tab && tab.GetParent() is { } bar)
            {
                var tabs = bar.GetChildren().OfType<InkButton>().ToList();
                int i = tabs.IndexOf(tab);
                var to = tabs[(i + dir + tabs.Count) % tabs.Count];
                to.EmitSignal(BaseButton.SignalName.Pressed);
                return true;
            }
            return true;
        }
        return false;
    }
}
