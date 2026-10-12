using System;
using System.IO;
using System.Text.Json;
using System.Collections.Generic;
using System.Security.Cryptography;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>Godot ships the static data in its pack. File-based systems use a versioned extracted cache.</summary>
public static class NativeData
{
    public static void Initialize()
    {
        string dataRoot = System.Environment.GetEnvironmentVariable("SCHELDEMIST_USER_DATA") ?? Scheldemist.Paths.NativeUserDirectory ?? ProjectSettings.GlobalizePath("user://");
        string[] args = OS.GetCmdlineUserArgs();
        bool packed = OS.HasFeature("native_standalone") || Array.IndexOf(args, "--native-pack-test") >= 0;
        if (packed)
        {
            const string pack = "res://world/data/pack/";
            int proof = Array.IndexOf(args, "--native-data-proof");
            var result = NativePackData.Extract(Godot.FileAccess.GetFileAsString(pack + "manifest.json"),
                path => Godot.FileAccess.GetFileAsBytes(pack + path), dataRoot, proof >= 0);
            Scheldemist.Paths.NativeDataRoot = result.Cache;
            if (proof >= 0 && proof + 1 < args.Length)
            {
                string receipt = Path.GetFullPath(args[proof + 1]);
                Directory.CreateDirectory(Path.GetDirectoryName(receipt)!);
                File.WriteAllText(receipt, JsonSerializer.Serialize(result));
            }
            return;
        }
        const string source = "res://world/data";
        using var manifest = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(source + "/manifest.json"));
        var extra = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (string name in DirAccess.GetFilesAt("res://services/data"))
            if (!name.EndsWith(".import", StringComparison.Ordinal)) extra["services/" + name] = "res://services/data/" + name;
        foreach (string name in DirAccess.GetFilesAt("res://world/town/maps"))
            if (!name.EndsWith(".import", StringComparison.Ordinal)) extra["maps/" + name] = "res://world/town/maps/" + name;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var file in extra) { hash.AppendData(System.Text.Encoding.UTF8.GetBytes(file.Key)); hash.AppendData(Godot.FileAccess.GetFileAsBytes(file.Value)); }
        string version = manifest.RootElement.GetProperty("version").GetString()! + "-" + Convert.ToHexString(hash.GetHashAndReset())[..12].ToLowerInvariant();
        string cache = Path.GetFullPath(Path.Combine(dataRoot, "native-static", version));
        string marker = Path.Combine(cache, ".complete");
        if (!File.Exists(marker))
        {
            foreach (var row in manifest.RootElement.GetProperty("files").EnumerateArray())
            {
                string file = row.GetString()!;
                string target = Path.GetFullPath(Path.Combine(cache, file));
                if (!target.StartsWith(cache + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Native data path escapes its cache.");
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.WriteAllBytes(target, Godot.FileAccess.GetFileAsBytes(source + "/" + file));
            }
            foreach (var file in extra)
            {
                string target = Path.Combine(cache, file.Key);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.WriteAllBytes(target, Godot.FileAccess.GetFileAsBytes(file.Value));
            }
            File.WriteAllText(marker, version);
        }
        Scheldemist.Paths.NativeDataRoot = cache;
    }
}
