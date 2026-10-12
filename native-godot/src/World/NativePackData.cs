using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.World;

/// <summary>Extracts immutable raw data from the Godot pack for file-based game services.</summary>
public static class NativePackData
{
    public sealed record Result(string Cache, string Version, int Files, long Bytes, bool Extracted);
    private sealed record Entry(string File, string Blob, string Sha256, long Bytes);

    public static Result Extract(string manifestText, Func<string, byte[]> readBlob, string dataRoot, bool verifyCache = false)
    {
        using var document = JsonDocument.Parse(manifestText);
        var manifest = document.RootElement;
        if (manifest.GetProperty("format").GetInt32() != 2) throw new IOException("Unsupported native data pack format.");
        string version = manifest.GetProperty("version").GetString() ?? "";
        if (!Regex.IsMatch(version, "^native-pack-[a-f0-9]{64}$")) throw new IOException("Invalid native data pack version.");
        var entries = new List<Entry>();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long total = 0;
        foreach (var row in manifest.GetProperty("files").EnumerateArray())
        {
            string file = row.GetProperty("file").GetString() ?? "";
            string blob = row.GetProperty("blob").GetString() ?? "";
            string sha = row.GetProperty("sha256").GetString() ?? "";
            long bytes = row.GetProperty("bytes").GetInt64();
            if (!LogicalPath(file) || !names.Add(file)) throw new IOException("Invalid or duplicate native data path: " + file);
            if (!Regex.IsMatch(sha, "^[a-f0-9]{64}$") || blob != "blobs/" + sha + ".bin" || bytes < 0)
                throw new IOException("Invalid native data blob: " + file);
            entries.Add(new(file, blob, sha, bytes));
            total = checked(total + bytes);
        }
        if (entries.Count == 0) throw new IOException("Native data pack is empty.");
        string cache = Path.GetFullPath(Path.Combine(dataRoot, "native-static", version));
        string marker = Path.Combine(cache, ".complete");
        bool complete = File.Exists(marker) && File.ReadAllText(marker) == version;
        if (!complete || verifyCache)
        {
            foreach (var entry in entries)
            {
                string target = Path.GetFullPath(Path.Combine(cache, entry.File));
                if (!target.StartsWith(cache + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("Native data path escapes its cache.");
                if (complete)
                {
                    if (!File.Exists(target)) throw new IOException("Native data cache is missing " + entry.File);
                    Check(File.ReadAllBytes(target), entry);
                    continue;
                }
                byte[] bytes = readBlob(entry.Blob);
                Check(bytes, entry);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                string temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try { File.WriteAllBytes(temporary, bytes); File.Move(temporary, target, true); }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
            }
            if (!complete) File.WriteAllText(marker, version);
        }
        return new(cache, version, entries.Count, total, !complete);
    }

    private static bool LogicalPath(string path)
    {
        if (path.Length == 0 || path.StartsWith('/') || path.Contains('\\') || path.Contains(':') || path.Contains('\0')) return false;
        foreach (string component in path.Split('/'))
            if (component.Length == 0 || component is "." or "..") return false;
        return true;
    }

    private static void Check(byte[] bytes, Entry entry)
    {
        if (bytes.LongLength != entry.Bytes || Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != entry.Sha256)
            throw new IOException("Native data integrity check failed: " + entry.File);
    }
}
