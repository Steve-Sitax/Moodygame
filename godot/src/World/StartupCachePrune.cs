using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The startup caches keep one entry per content key, and every code or asset change makes new keys. An entry a
/// start uses is touched (<see cref="Touch"/>); entries no start has used for a few days are deleted after the
/// game is up, on a worker thread. Other checkouts on this PC share the folder and keep their own entries fresh.
/// </summary>
public static class StartupCachePrune
{
    private static readonly TimeSpan Unused = TimeSpan.FromDays(3);
    /// <summary>All startup caches live below this folder. SCHELDEMIST_STARTUP_CACHE moves it: a proof run on staged
    /// content then fills its own folder, not the player's (each staged revision spools gigabytes of new keys).</summary>
    public static string Root => System.Environment.GetEnvironmentVariable("SCHELDEMIST_STARTUP_CACHE") is { Length: > 0 } moved
        ? Path.GetFullPath(moved) : Path.Combine(ProjectSettings.GlobalizePath("user://"), "startup-cache");

    /// <summary>Mark a cache file as used now (a failure only means it may be pruned and rebuilt).</summary>
    public static void Touch(string file)
    {
        try { File.SetLastWriteTimeUtc(file, DateTime.UtcNow); } catch (Exception) { }
    }

    public static void Start()
    {
        string root = Root;
        Task.Run(() =>
        {
            try
            {
                if (!Directory.Exists(root)) return;
                var before = DateTime.UtcNow - Unused;
                long freed = 0; int files = 0;
                void Drop(string file) { try { long n = new FileInfo(file).Length; File.Delete(file); freed += n; files++; } catch (Exception) { } }
                // single-file entries (the Ruien's): an entry and its receipt go together
                string ruien = Path.Combine(root, "ruien");
                if (Directory.Exists(ruien))
                    foreach (string file in Directory.EnumerateFiles(ruien).Where(f => f.EndsWith(".res", StringComparison.Ordinal) || f.EndsWith(".scn", StringComparison.Ordinal) || f.EndsWith(".bin",StringComparison.Ordinal)).ToArray())
                        if (File.GetLastWriteTimeUtc(file) < before) { Drop(file); if (File.Exists(file + ".sha256")) Drop(file + ".sha256"); }
                // Uncached proofs spool finished visuals into a unique directory.
                // Only expired, named run directories immediately below this cache qualify.
                if(Directory.Exists(ruien))
                    foreach(string entry in Directory.EnumerateDirectories(ruien,"transient-*").ToArray())
                    {
                        var newest=Directory.EnumerateFiles(entry).Select(File.GetLastWriteTimeUtc).DefaultIfEmpty(DateTime.MinValue).Max();
                        if(newest>=before)continue;
                        foreach(string file in Directory.EnumerateFiles(entry).ToArray())Drop(file);
                        try{Directory.Delete(entry);}catch(Exception){}
                    }
                // folder entries (the street cuts' and squares'): the folder goes when its receipt is old
                foreach (string kind in new[] { "cuts", "square-ground", "square-walls" })
                {
                    string dir = Path.Combine(root, kind);
                    if (!Directory.Exists(dir)) continue;
                    foreach (string entry in Directory.EnumerateDirectories(dir).ToArray())
                    {
                        var newest = Directory.EnumerateFiles(entry).Select(File.GetLastWriteTimeUtc).DefaultIfEmpty(DateTime.MinValue).Max();
                        if (newest >= before) continue;
                        foreach (string file in Directory.EnumerateFiles(entry, "*", SearchOption.AllDirectories).ToArray()) Drop(file);
                        try { Directory.Delete(entry, true); } catch (Exception) { }
                    }
                }
                if (files > 0) GD.Print($"startup cache: {files} files no start has used for {Unused.TotalDays:0} days removed ({freed / 1048576.0:0} MB)");
            }
            catch (Exception e) { GD.Print("startup cache: not pruned: " + e.Message); }
        });
    }
}
