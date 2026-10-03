using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.Menu;

/// <summary>
/// The settings' store (the browser's game/prefs.ts): the same names, the same limits and defaults. Kept as a json
/// in the player's own folder (user://settings.json; the browser keeps it in localStorage), written at every change
/// and applied at once (Apply.cs). `-- --prefs file` keeps them somewhere else (a test never touches the player's).
///
/// Another part reads a setting with `Prefs.Num("view")`, `Prefs.Bool("headBob")`, `Prefs.Str("street")` and hears
/// changes with `Prefs.Changed += keys => ...`. Only the menu writes them.
/// </summary>
public static class Prefs
{
    /// <summary>prefs.ts STREET_LEVELS: how many townspeople walk round Jef at once.</summary>
    public static readonly (string id, string label, int cap)[] StreetLevels = { ("few", "Few", 20), ("normal", "Normal", 50), ("many", "Many", 75), ("crowded", "Crowded", 100) };
    public static int StreetCap => StreetLevels.First(l => l.id == Str("street")).cap;

    public static readonly (int lines, string label)[] Heights =
    {
        (270, "270 lines (the old PS1 look)"), (360, "360 lines"), (540, "540 lines"), (720, "720 lines"), (1080, "1080 lines"), (0, "Full window"),
    };

    private abstract record Spec(object Default);
    private sealed record NumSpec(double D, double Lo, double Hi, bool Whole = false, double[]? Only = null) : Spec(D);
    private sealed record BoolSpec(bool D) : Spec(D);
    private sealed record OneSpec(string D, string[] Of) : Spec(D);

    // prefs.ts DEFAULTS and read(); "fullscreen" is the Godot game's own (a browser has F11)
    private static readonly Dictionary<string, Spec> specs = new()
    {
        ["height"] = new NumSpec(720, 0, 1080, true, new double[] { 270, 360, 540, 720, 1080, 0 }),
        ["psxColour"] = new BoolSpec(true),
        ["wobble"] = new BoolSpec(false),
        ["street"] = new OneSpec("normal", new[] { "few", "normal", "many", "crowded" }),
        ["preset"] = new OneSpec("high", new[] { "low", "medium", "high", "custom" }),
        ["scale"] = new NumSpec(1, 0.5, 1),
        ["view"] = new NumSpec(1, 0.6, 1.2),
        ["rooms"] = new NumSpec(4, 0, 8, true),
        ["reflections"] = new OneSpec("full", new[] { "off", "coarse", "full" }),
        ["shadows"] = new BoolSpec(true),
        ["lightBudget"] = new OneSpec("high", new[] { "low", "medium", "high" }),
        ["particles"] = new OneSpec("all", new[] { "off", "some", "all" }),
        ["frameCap"] = new NumSpec(0, 0, 144, true, new double[] { 0, 30, 45, 60, 90, 120, 144 }),
        ["showFps"] = new BoolSpec(false),
        ["benchDone"] = new BoolSpec(false),
        ["fullscreen"] = new BoolSpec(false),
        ["master"] = new NumSpec(1, 0, 1),
        ["music"] = new NumSpec(1, 0, 1),
        ["ambience"] = new NumSpec(1, 0, 1),
        ["voices"] = new NumSpec(1, 0, 1),
        ["effects"] = new NumSpec(1, 0, 1),
        ["sens"] = new NumSpec(1, 0.25, 3),
        ["invertY"] = new BoolSpec(false),
        ["fov"] = new NumSpec(75, 55, 100, true),
        ["headBob"] = new BoolSpec(true),
        ["bubbles"] = new NumSpec(1, 0.7, 1.8),
        ["autosave"] = new NumSpec(1, 0, 4, true, new double[] { 0, 1, 2, 4 }),
        ["miniMap"] = new OneSpec("off", new[] { "off", "small", "large" }),
        ["language"] = new OneSpec("en", new[] { "en" }),
        ["textSize"] = new NumSpec(1, 0.8, 1.6),
        ["contrast"] = new BoolSpec(false),
        ["reduceMotion"] = new BoolSpec(false),
        ["colourSafe"] = new BoolSpec(false),
    };

    /// <summary>prefs.ts PRESETS: what each quality sets. "high" is the game as made.</summary>
    public static readonly Dictionary<string, Dictionary<string, object>> Presets = new()
    {
        ["low"] = new() { ["height"] = 270.0, ["scale"] = 0.75, ["view"] = 0.7, ["rooms"] = 1.0, ["street"] = "few", ["reflections"] = "off", ["shadows"] = false, ["lightBudget"] = "low", ["particles"] = "off", ["frameCap"] = 30.0 },
        ["medium"] = new() { ["height"] = 540.0, ["scale"] = 1.0, ["view"] = 0.85, ["rooms"] = 2.0, ["street"] = "normal", ["reflections"] = "coarse", ["shadows"] = true, ["lightBudget"] = "medium", ["particles"] = "some", ["frameCap"] = 60.0 },
        ["high"] = new() { ["height"] = 720.0, ["scale"] = 1.0, ["view"] = 1.0, ["rooms"] = 4.0, ["street"] = "normal", ["reflections"] = "full", ["shadows"] = true, ["lightBudget"] = "high", ["particles"] = "all", ["frameCap"] = 0.0 },
    };
    private static readonly string[] presetKeys = Presets["high"].Keys.ToArray();

    private static Dictionary<string, object>? now;
    private static Dictionary<string, object> Now => now ??= Read();

    /// <summary>Some settings changed (their names): saved already.</summary>
    public static event Action<IReadOnlyList<string>>? Changed;

    /// <summary>Where the settings are kept.</summary>
    public static string File
    {
        get
        {
            string other = Main.I?.Arg("prefs") ?? "";
            return other != "" ? Path.GetFullPath(other) : ProjectSettings.GlobalizePath("user://settings.json");
        }
    }

    public static double Num(string k) => (double)Now[k];
    public static bool Bool(string k) => (bool)Now[k];
    public static string Str(string k) => (string)Now[k];
    public static object Default(string k) => specs[k].Default;
    public static IReadOnlyDictionary<string, object> All() => new Dictionary<string, object>(Now);

    private static object Clean(string k, object? v)
    {
        switch (specs[k])
        {
            case NumSpec n:
            {
                if (v is not double d || !double.IsFinite(d)) return n.D;
                if (n.Only != null) return n.Only.Contains(d) ? d : n.D;
                d = Math.Clamp(d, n.Lo, n.Hi);
                return n.Whole ? Math.Round(d) : d;
            }
            case BoolSpec b:
                return v is bool x ? x : b.D;
            case OneSpec o:
                return v is string s && o.Of.Contains(s) ? s : o.D;
        }
        return specs[k].Default;
    }

    private static Dictionary<string, object> Read()
    {
        var raw = new Dictionary<string, object?>();
        try
        {
            if (System.IO.File.Exists(File))
            {
                using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(File));
                foreach (var p in doc.RootElement.EnumerateObject())
                    raw[p.Name] = p.Value.ValueKind switch
                    {
                        JsonValueKind.Number => p.Value.GetDouble(),
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        JsonValueKind.String => p.Value.GetString(),
                        _ => null,
                    };
            }
        }
        catch (Exception)
        {
            // a broken store: the defaults
        }
        var o = new Dictionary<string, object>();
        foreach (string k in specs.Keys) o[k] = Clean(k, raw.GetValueOrDefault(k));
        return o;
    }

    private static void Write()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(File)!);
            System.IO.File.WriteAllText(File, JsonSerializer.Serialize(Now, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception e)
        {
            // a folder that cannot be written: the settings last until the game closes
            GD.PrintErr($"the settings were not saved: {e.Message}");
        }
    }

    /// <summary>Change some; saved and applied at once. A graphics setting changed by hand makes the quality "custom".</summary>
    public static void Set(IReadOnlyDictionary<string, object> part, bool keepPreset = false)
    {
        var changed = new List<string>();
        foreach (var (k, v) in part)
        {
            if (!specs.ContainsKey(k)) continue;
            object c = Clean(k, v is int i ? (double)i : v is float f ? (double)f : v);
            if (c.Equals(Now[k])) continue;
            Now[k] = c;
            changed.Add(k);
        }
        if (changed.Count == 0) return;
        if (!keepPreset && !part.ContainsKey("preset") && changed.Any(k => presetKeys.Contains(k)) && Str("preset") != "custom")
        {
            Now["preset"] = "custom";
            changed.Add("preset");
        }
        Write();
        Changed?.Invoke(changed);
    }

    public static void Set(string key, object value, bool keepPreset = false) => Set(new Dictionary<string, object> { [key] = value }, keepPreset);

    /// <summary>A whole quality at once ("low", "medium", "high").</summary>
    public static void Preset(string p)
    {
        var part = new Dictionary<string, object>(Presets[p]) { ["preset"] = p };
        Set(part);
    }

    /// <summary>Back to the defaults (some settings, or all). The first run's test of the computer is not run again.</summary>
    public static void Reset(IEnumerable<string>? keys = null)
    {
        var part = new Dictionary<string, object>();
        foreach (string k in keys ?? specs.Keys)
            if (k != "benchDone")
                part[k] = specs[k].Default;
        Set(part, true);
    }
}

/// <summary>
/// What the settings hand to the player's and the world's own code (the browser's player `look` and menu/tuning.ts),
/// in a place of their own so those parts need nothing of the menu. Set by Apply from the settings.
/// </summary>
public static class Tuning
{
    /// <summary>Mouse speed, times the game's own (0.25 .. 3).</summary>
    public static float Sens = 1;
    /// <summary>The mouse's up and down turned round.</summary>
    public static bool InvertY;
    /// <summary>The view rocks as Jef walks: 1, or 0 (off, or Reduce motion).</summary>
    public static float Bob = 1;
    /// <summary>View distance: the street's fog ends this much nearer or further (1 as designed).</summary>
    public static float ViewFar = 1;
    /// <summary>Speech bubbles over heads, times their size.</summary>
    public static float Bubbles = 1;
}
