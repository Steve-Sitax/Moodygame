using System;
using System.IO;
using Godot;
using Scheldemist.Net;

namespace Scheldemist;

/// <summary>All disk locations. Resources stay in the game folder; everything writable stays with the player.
/// SCHELDEMIST_USER_DATA isolates a test. Command line file overrides are absolute before background work starts.
/// Fonts, UI and shaders are res:// resources packed by Godot, rather than ordinary disk files.</summary>
public static class Paths
{
    /// <summary>Native projects point file-based game systems at packaged static data, not client/.</summary>
    public static string? NativeDataRoot { get; set; }
    /// <summary>A native project's own game saves, separate from its workshop layouts.</summary>
    public static string? NativeUserDirectory { get; set; }
    public static string Root { get; private set; } = "";
    public static string Data { get; private set; } = "";
    public static string Baked { get; private set; } = "";
    public static string Town { get; private set; } = "";
    public static string Models { get; private set; } = "";
    public static string City { get; private set; } = "";
    public static string Prefs { get; private set; } = "";
    public static string Keys { get; private set; } = "";
    public static string Database { get; private set; } = "";
    public static string SaveSlots => Path.Combine(Path.GetDirectoryName(Database)!, "saves", Path.GetFileNameWithoutExtension(Database));
    public static string AiSetup => Path.Combine(Path.GetDirectoryName(Database)!, Path.GetFileName(Database) == "game.sqlite" ? "ai-config.json" : Path.GetFileNameWithoutExtension(Database) + ".ai-config.json");
    public static string MapSettings => Path.Combine(Data, "map.json");
    public static string EngineLog => Path.Combine(ProjectSettings.GlobalizePath("user://"), "logs", "godot.log");
    public static string ServerLog => EngineLog;
    public static string WalkAiSetup => Path.Combine(Data, "godot-no-ai.ai-config.json");
    public static string PublicDir => Path.Combine(NativeDataRoot ?? throw new InvalidOperationException("Initialize the native Godot data pack first."), "public");
    public static string Audio => Path.Combine(PublicDir, "audio");
    public static string Textures => Path.Combine(PublicDir, "textures");
    public static string TownFacts(string town) => Path.ChangeExtension(town, ".json");
    public static string TownTextures(string town) => Path.Combine(Path.GetDirectoryName(town)!, Path.GetFileNameWithoutExtension(town) + "_tex");
    public static string TownSide(string suffix) => Path.Combine(Path.GetDirectoryName(Town)!, Path.GetFileNameWithoutExtension(Town) + suffix);
    public static string Shared(string file) => Path.Combine(NativeDataRoot ?? Root, "shared", file);
    public static string Public(string file) => Path.Combine(PublicDir, file.TrimStart('/'));
    public static string Font(string file) => "res://fonts/" + file;
    public const string RetroShader = "res://shaders/retro.gdshader";
    public const string LoadingPicture = "res://ui/loading.jpg";
    public const string MenuPicture = "res://ui/quay_woodcut.jpg";
    public static string TestOutput(string option) => Main.I.Arg(option) is { Length: > 0 } p ? Absolute(p) : "";
    public static string Absolute(string p) => Path.GetFullPath(p.StartsWith("user://") || p.StartsWith("res://") ? ProjectSettings.GlobalizePath(p) : p);
    private static string? Env(string name) => System.Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value : null;
    private static string Override(string name, string fallback) => Absolute(Main.I.Arg(name, fallback));

    public static void Initialize()
    {
        Root = Absolute(Env("SCHELDEMIST_ROOT") ?? Path.Combine(ProjectSettings.GlobalizePath("res://"), ".."));
        Data = Absolute(Env("SCHELDEMIST_USER_DATA") ?? NativeUserDirectory ?? ProjectSettings.GlobalizePath("user://"));
        Baked = Path.Combine(Root, "godot/baked");
        Town = Override("town", Env("SCHELDEMIST_BAKE") ?? Path.Combine(Baked, "town.glb"));
        Models = Override("models", Path.Combine(Baked, "models"));
        City = Override("city", Shared("city.json"));
        Prefs = Override("prefs", Path.Combine(Data, "settings.json"));
        Keys = Main.I.Arg("prefs") != "" ? Path.ChangeExtension(Prefs, ".keys.json") : Path.Combine(Data, "keys.json");
        // The download paths are also the server's paths; the multiplayer check must never open a player's save.
        string database = Main.I.Arg("mptest") != "" ? Net.Mp.MpTest.TestDb(Main.I) : Path.Combine(Data, "game.sqlite");
        Database = Override("db", database);
        Directory.CreateDirectory(Data);
    }

}
