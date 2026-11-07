using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// Content hashes of a startup cache's input files, read on several cores. Every file is hashed in full on every
/// start; only the dependency list of a file whose content hash is unchanged is reused from the last start.
/// </summary>
public static class InputFiles
{
    private sealed record Known(string Sha256, string[] Dependencies);
    private static readonly object gate = new();
    private static Dictionary<string, Known>? known;
    private static string MemoFile => Path.Combine(ProjectSettings.GlobalizePath("user://"), "startup-cache", "dependencies.json");
    private static int Cores => Math.Clamp(System.Environment.ProcessorCount / 2, 2, 16);

    /// <summary>The SHA-256 (upper-case hex) of each file, in order. A file outside the disk (an exported pack) is
    /// read through Godot on the calling thread.</summary>
    public static string[] Hash(IReadOnlyList<string> paths)
    {
        var disk = paths.Select(p => ProjectSettings.GlobalizePath(p)).ToArray();
        var result = new string[paths.Count];
        var packed = new ConcurrentQueue<int>();
        Parallel.For(0, paths.Count, new ParallelOptions { MaxDegreeOfParallelism = Cores }, i =>
        {
            if (!System.IO.File.Exists(disk[i])) { packed.Enqueue(i); return; }
            using var stream = new FileStream(disk[i], FileMode.Open, System.IO.FileAccess.Read, FileShare.Read, 1 << 16, FileOptions.SequentialScan);
            result[i] = Convert.ToHexString(SHA256.HashData(stream));
        });
        foreach (int i in packed)
        {
            if (!Godot.FileAccess.FileExists(paths[i])) throw new IOException("Missing cache input " + paths[i]);
            result[i] = Convert.ToHexString(SHA256.HashData(Godot.FileAccess.GetFileAsBytes(paths[i])));
        }
        return result;
    }

    /// <summary>The files and every resource they depend on, each with its content hash, sorted by path.</summary>
    public static IReadOnlyList<(string Path, string Sha256)> HashWithDependencies(IEnumerable<string> roots)
    {
        lock (gate)
        {
            known ??= ReadMemo();
            var hashes = new SortedDictionary<string, string>(StringComparer.Ordinal);
            var next = roots.Distinct(StringComparer.Ordinal).ToList();
            bool changed = false;
            while (next.Count > 0)
            {
                var batch = next.Where(p => !hashes.ContainsKey(p)).Distinct(StringComparer.Ordinal).ToArray();
                next = new List<string>();
                var shas = Hash(batch);
                for (int i = 0; i < batch.Length; i++)
                {
                    hashes[batch[i]] = shas[i];
                    string[] dependencies;
                    if (known.TryGetValue(batch[i], out var memo) && memo.Sha256 == shas[i]) dependencies = memo.Dependencies;
                    else
                    {
                        dependencies = ResourceLoader.GetDependencies(batch[i]).Select(d => d.Split("::")[^1]).ToArray();
                        known[batch[i]] = new Known(shas[i], dependencies);
                        changed = true;
                    }
                    foreach (string dependency in dependencies)
                    {
                        string path = dependency.Split("::")[0];
                        if (path.Length == 0) throw new IOException("Unsaved resource: using the live construction path");
                        if (!hashes.ContainsKey(path)) next.Add(path);
                    }
                }
            }
            if (changed) WriteMemo();
            return hashes.Select(h => (h.Key, h.Value)).ToArray();
        }
    }

    /// <summary>
    /// The resources under the given ones, each with its dependency list as kept from an earlier start (a file never
    /// seen before is read for its list now). A hint for reading order only: a changed file may have a new list, and
    /// a list learnt here carries no content hash, so the startup caches still read every list they rely on.
    /// </summary>
    public static IReadOnlyDictionary<string, string[]> DependencyHints(IEnumerable<string> roots)
    {
        lock (gate)
        {
            known ??= ReadMemo();
            var result = new Dictionary<string, string[]>(StringComparer.Ordinal);
            var next = new Stack<string>(roots);
            bool changed = false;
            while (next.Count > 0)
            {
                string path = next.Pop();
                if (result.ContainsKey(path)) continue;
                if (!known.TryGetValue(path, out var memo))
                {
                    if (!ResourceLoader.Exists(path)) { result[path] = Array.Empty<string>(); continue; }
                    memo = known[path] = new Known("", ResourceLoader.GetDependencies(path).Select(d => d.Split("::")[^1]).ToArray());
                    changed = true;
                }
                var under = memo.Dependencies.Select(d => d.Split("::")[0]).Where(d => d.Length > 0).ToArray();
                result[path] = under;
                foreach (string d in under) next.Push(d);
            }
            if (changed) WriteMemo();
            return result;
        }
    }

    /// <summary>The files a startup cache hashed at the last start, with their dependency lists (by path; a changed file
    /// may have changed its list). Lists learnt only as reading hints are left out.</summary>
    public static IReadOnlyDictionary<string, string[]> KnownDependencies()
    {
        lock (gate)
        {
            known ??= ReadMemo();
            return known.Where(k => k.Value.Sha256.Length > 0).ToDictionary(k => k.Key, k => k.Value.Dependencies.Select(d => d.Split("::")[0]).ToArray(), StringComparer.Ordinal);
        }
    }

    private static Dictionary<string, Known> ReadMemo()
    {
        try
        {
            if (System.IO.File.Exists(MemoFile))
                return JsonSerializer.Deserialize<Dictionary<string, Known>>(System.IO.File.ReadAllText(MemoFile)) ?? new();
        }
        catch (Exception e) { GD.Print("startup cache: dependency notes unreadable, reading them again: " + e.Message); }
        return new(StringComparer.Ordinal);
    }

    private static void WriteMemo()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(MemoFile)!);
            string temporary = MemoFile + "." + Guid.NewGuid().ToString("N") + ".tmp";
            System.IO.File.WriteAllText(temporary, JsonSerializer.Serialize(known));
            System.IO.File.Move(temporary, MemoFile, true);
        }
        catch (Exception e) { GD.Print("startup cache: could not keep the dependency notes: " + e.Message); }
    }
}
