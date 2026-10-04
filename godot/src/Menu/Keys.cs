using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Godot;

namespace Scheldemist.Menu;

/// <summary>
/// Changeable controls (the browser's menu/keys.ts): each action of the game has a key, the player may give it
/// another (Settings, Controls). Giving an action a key another one holds swaps the two, so no two share a key.
/// Esc, Enter, Tab, the digits, the F keys and the arrows keep their own jobs. Kept in user://keys.json under the
/// browser's names for the keys ("KeyW", "ShiftLeft").
///
/// A part of the game asks by action, never by key:
///   if (Keys.Is(e, "use")) ...            // this key event is the Use key going down
///   if (Keys.Down("forward")) ...         // the Walk forward key is held now
///   prompt.Text = $"{Keys.Label("use")} take";   // the key's name for a hint on screen
/// </summary>
public static class Keys
{
    public sealed record ActionDef(string Id, string Code, string Label, string Also, string Group);

    // keys.ts ACTIONS
    public static readonly ActionDef[] Actions =
    {
        new("forward", "KeyW", "Walk forward", "row forward; in a talk: take the work", "Walking"),
        new("back", "KeyS", "Walk back", "row back, brake", "Walking"),
        new("left", "KeyA", "Step left", "turn the boat", "Walking"),
        new("right", "KeyD", "Step right", "turn the boat", "Walking"),
        new("hurry", "ShiftLeft", "Hurry", "a hard stroke when rowing or swimming (right Shift too)", "Walking"),
        new("crouch", "KeyC", "Crouch", "left Ctrl too", "Walking"),
        new("jump", "Space", "Jump / hold to climb or vault (or press again at the top)", "", "Walking"),
        new("use", "KeyE", "Use, take, talk to", "the first thing the hint offers", "Hands"),
        new("second", "KeyF", "Second choice", "fill, lift, fight", "Hands"),
        new("third", "KeyG", "Third choice", "give, sing along", "Hands"),
        new("fourth", "KeyR", "Fourth choice", "run from trouble, hurry home", "Hands"),
        new("lantern", "KeyL", "Lantern on or off", "", "Hands"),
        new("talk", "KeyT", "Say something", "type a line in a talk", "Talks"),
        new("buy", "KeyB", "Buy", "in a talk with a seller", "Talks"),
        new("haggle", "KeyH", "Haggle or leave", "in a talk; shout for help", "Talks"),
        new("map", "KeyM", "Map", "", "Screens"),
        new("book", "KeyJ", "Quest book", "your jobs: follow one, give one up", "Screens"),
        new("pockets", "KeyI", "Pockets", "", "Screens"),
        new("pause", "KeyP", "Pause", "pay, when a gang asks", "Screens"),
        new("newWeek", "KeyN", "New week", "on the sheet at the end of the week", "Screens"),
    };

    /// <summary>Keys no action may take: they have their own fixed jobs.</summary>
    public static readonly Regex Fixed = new(@"^(Escape|Enter|NumpadEnter|Tab|Digit\d|Numpad\d|F\d+|Arrow\w+|Backspace|MetaLeft|MetaRight|ContextMenu|PrintScreen|CapsLock|NumLock|ScrollLock)$");

    private static Dictionary<string, string>? binding;
    private static Dictionary<string, string> Binding => binding ??= Load();
    /// <summary>A key was given to another action.</summary>
    public static event Action? Changed;

    private static string File
    {
        get
        {
            return Paths.Keys;
        }
    }

    private static Dictionary<string, string> Defaults() => Actions.ToDictionary(a => a.Id, a => a.Code);

    private static Dictionary<string, string> Load()
    {
        var next = Defaults();
        try
        {
            if (!System.IO.File.Exists(File)) return next;
            using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(File));
            foreach (var a in Actions)
                if (doc.RootElement.TryGetProperty(a.Id, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } c && !Fixed.IsMatch(c))
                    next[a.Id] = c;
            // a broken store (two actions on one key): the defaults
            return next.Values.Distinct().Count() == next.Count ? next : Defaults();
        }
        catch (Exception)
        {
            return Defaults();
        }
    }

    private static void Store()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(File)!);
            System.IO.File.WriteAllText(File, JsonSerializer.Serialize(Binding, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception e)
        {
            GD.PrintErr($"the keys were not saved: {e.Message}");
        }
        Changed?.Invoke();
    }

    /// <summary>The key of an action now, by the browser's name ("KeyE").</summary>
    public static string Get(string id) => Binding[id];
    public static bool IsDefault() => Actions.All(a => Binding[a.Id] == a.Code);

    /// <summary>Give an action a key; the action that held that key gets this one's old key (its id comes back).</summary>
    public static string? Set(string id, string code)
    {
        if (Fixed.IsMatch(code)) return null;
        string old = Binding[id];
        string? other = Binding.Where(kv => kv.Key != id && kv.Value == code).Select(kv => kv.Key).FirstOrDefault();
        Binding[id] = code;
        if (other != null) Binding[other] = old;
        Store();
        return other;
    }

    public static void Reset()
    {
        binding = Defaults();
        Store();
    }

    // ------------------------------------------------------------------ the game asks by action

    /// <summary>Is this event the action's key going down (not a repeat)?</summary>
    public static bool Is(InputEvent e, string id) => e is InputEventKey { Pressed: true, Echo: false } k && CodeOf(k) == Binding[id];

    /// <summary>Is the action's key held now?</summary>
    public static bool Down(string id)
    {
        var (key, _) = KeyOf(Binding[id]);
        return key != Key.None && Input.IsPhysicalKeyPressed(key);
    }

    /// <summary>The name on the action's key, for a hint on screen.</summary>
    public static string Label(string id) => CodeName(Binding[id]);

    // ------------------------------------------------------------------ names of keys

    private static readonly Dictionary<string, Key> named = new()
    {
        ["Space"] = Key.Space, ["ShiftLeft"] = Key.Shift, ["ShiftRight"] = Key.Shift, ["ControlLeft"] = Key.Ctrl, ["ControlRight"] = Key.Ctrl,
        ["AltLeft"] = Key.Alt, ["AltRight"] = Key.Alt, ["Backquote"] = Key.Quoteleft, ["Minus"] = Key.Minus, ["Equal"] = Key.Equal,
        ["BracketLeft"] = Key.Bracketleft, ["BracketRight"] = Key.Bracketright, ["Backslash"] = Key.Backslash, ["Semicolon"] = Key.Semicolon,
        ["Quote"] = Key.Apostrophe, ["Comma"] = Key.Comma, ["Period"] = Key.Period, ["Slash"] = Key.Slash, ["Insert"] = Key.Insert,
        ["Delete"] = Key.Delete, ["Home"] = Key.Home, ["End"] = Key.End, ["PageUp"] = Key.Pageup, ["PageDown"] = Key.Pagedown,
        ["Escape"] = Key.Escape, ["Enter"] = Key.Enter, ["NumpadEnter"] = Key.KpEnter, ["Tab"] = Key.Tab, ["Backspace"] = Key.Backspace,
        ["ArrowUp"] = Key.Up, ["ArrowDown"] = Key.Down, ["ArrowLeft"] = Key.Left, ["ArrowRight"] = Key.Right,
        ["CapsLock"] = Key.Capslock, ["NumLock"] = Key.Numlock, ["ScrollLock"] = Key.Scrolllock, ["PrintScreen"] = Key.Print,
        ["ContextMenu"] = Key.Menu, ["MetaLeft"] = Key.Meta, ["MetaRight"] = Key.Meta,
    };

    /// <summary>The Godot key of a browser key name, and whether it is the right-hand one of a pair.</summary>
    public static (Key key, bool right) KeyOf(string code)
    {
        if (code.Length == 4 && code.StartsWith("Key")) return (Key.A + (code[3] - 'A'), false);
        if (code.Length == 6 && code.StartsWith("Digit")) return (Key.Key0 + (code[5] - '0'), false);
        if (code.Length == 7 && code.StartsWith("Numpad") && char.IsDigit(code[6])) return (Key.Kp0 + (code[6] - '0'), false);
        if (code.Length >= 2 && code[0] == 'F' && int.TryParse(code[1..], out int f)) return (Key.F1 + (f - 1), false);
        return named.TryGetValue(code, out var k) ? (k, code.EndsWith("Right") && code != "ArrowRight" && code != "BracketRight") : (Key.None, false);
    }

    /// <summary>The browser's name of the key in this event (the key's place on the board, whatever the layout).</summary>
    public static string CodeOf(InputEventKey e)
    {
        var k = e.PhysicalKeycode != Key.None ? e.PhysicalKeycode : e.Keycode;
        if (k >= Key.A && k <= Key.Z) return "Key" + (char)('A' + (k - Key.A));
        if (k >= Key.Key0 && k <= Key.Key9) return "Digit" + (k - Key.Key0);
        if (k >= Key.Kp0 && k <= Key.Kp9) return "Numpad" + (k - Key.Kp0);
        if (k >= Key.F1 && k <= Key.F35) return "F" + (k - Key.F1 + 1);
        bool right = e.Location == KeyLocation.Right;
        switch (k)
        {
            case Key.Shift: return right ? "ShiftRight" : "ShiftLeft";
            case Key.Ctrl: return right ? "ControlRight" : "ControlLeft";
            case Key.Alt: return right ? "AltRight" : "AltLeft";
            case Key.Meta: return right ? "MetaRight" : "MetaLeft";
        }
        foreach (var (name, key) in named)
            if (key == k && !name.EndsWith("Right") || key == k && name is "ArrowRight" or "BracketRight")
                return name;
        return k.ToString();
    }

    private static readonly Dictionary<string, string> names = new()
    {
        ["Space"] = "Space", ["ShiftLeft"] = "Shift", ["ShiftRight"] = "Right Shift", ["ControlLeft"] = "Ctrl", ["ControlRight"] = "Right Ctrl",
        ["AltLeft"] = "Alt", ["AltRight"] = "Alt Gr", ["Backquote"] = "`", ["Minus"] = "-", ["Equal"] = "=", ["BracketLeft"] = "[", ["BracketRight"] = "]",
        ["Backslash"] = "\\", ["Semicolon"] = ";", ["Quote"] = "'", ["Comma"] = ",", ["Period"] = ".", ["Slash"] = "/", ["IntlBackslash"] = "<",
        ["Insert"] = "Ins", ["Delete"] = "Del", ["Home"] = "Home", ["End"] = "End", ["PageUp"] = "PgUp", ["PageDown"] = "PgDn",
    };

    /// <summary>The name on the key (keys.ts codeName): the letter printed on it on the player's own keyboard layout.</summary>
    public static string CodeName(string code)
    {
        if (code == "") return "-";
        var (key, _) = KeyOf(code);
        if (key != Key.None && !(names.TryGetValue(code, out string? two) && two.Contains(' ')))
        {
            // the letter on the player's layout (AZERTY: the W key says Z)
            var label = DisplayServer.KeyboardGetLabelFromPhysical(key);
            // a key with a sign on it (AZERTY: the M key's place says ","): Godot's key numbers are the signs' own
            long sign = (long)label;
            if (sign > 32 && sign < 127) return ((char)sign).ToString().ToUpperInvariant();
            string l = OS.GetKeycodeString(label);
            if (l.Length == 1 && !char.IsWhiteSpace(l[0])) return l.ToUpperInvariant();
        }
        if (names.TryGetValue(code, out string? n)) return n;
        if (code.Length == 4 && code.StartsWith("Key")) return code[3..];
        if (code.Length == 6 && code.StartsWith("Digit")) return code[5..];
        if (code.StartsWith("Numpad")) return $"Num {code[6..]}";
        return code;
    }

    /// <summary>The key to show for one of the game's default keys ("KeyE": the key Use has now).</summary>
    public static string KeyLabel(string gameCode)
    {
        var a = Actions.FirstOrDefault(q => q.Code == gameCode);
        return CodeName(a != null ? Binding[a.Id] : gameCode);
    }
}
