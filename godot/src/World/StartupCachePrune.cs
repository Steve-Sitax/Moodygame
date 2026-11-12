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
    public static string Root
    {
        get
        {
            string root = Folder();
            if (System.Threading.Interlocked.Exchange(ref notesTaken, 1) == 0) TakeNotes(root);
            return root;
        }
    }
    private static int notesTaken;
    private static string Folder() => System.Environment.GetEnvironmentVariable("SCHELDEMIST_STARTUP_CACHE") is { Length: > 0 } moved
        ? Path.GetFullPath(moved) : Path.Combine(ProjectSettings.GlobalizePath("user://"), "startup-cache");
    /// <summary>The package's dependency notes (InputFiles) serve until this PC has written its own: without them the
    /// first start reads every town resource's dependency list again.</summary>
    private static void TakeNotes(string root)
    {
        try
        {
            if (Seed is not { } shipped) return;
            string from = Path.Combine(shipped, "dependencies.json"), to = Path.Combine(root, "dependencies.json");
            if (!File.Exists(from) || File.Exists(to)) return;
            Directory.CreateDirectory(root); File.Copy(from, to);
        }
        catch (Exception) { }
    }

    /// <summary>A package may bring its caches along, built once on the build PC: a "startup-cache" folder beside the
    /// executable (SCHELDEMIST_STARTUP_SEED names another, for a proof). It is only read, never written or pruned. Its
    /// entries have the same content keys and receipts as the player's own, and every start checks them the same way.
    /// An entry it lacks is built and kept below <see cref="Root"/> as before.</summary>
    public static string? Seed => seed.Value;
    private static readonly Lazy<string?> seed = new(() =>
    {
        try
        {
            string folder = System.Environment.GetEnvironmentVariable("SCHELDEMIST_STARTUP_SEED") is { Length: > 0 } named
                ? Path.GetFullPath(named) : Path.Combine(Path.GetDirectoryName(OS.GetExecutablePath()) ?? "", "startup-cache");
            return Directory.Exists(folder) && !string.Equals(Path.GetFullPath(folder).TrimEnd('\\', '/'), Path.GetFullPath(Folder()).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase) ? folder : null;
        }
        catch (Exception) { return null; }
    });

    /// <summary>Where a cache entry is. <paramref name="entry"/> is its path below the cache folder, and
    /// <paramref name="marker"/> the suffix of the file that says it is complete (its receipt). The player's own entry
    /// when it is complete; else the package's; else the player's own place, to build it there.</summary>
    public static string Locate(string entry, string marker) => Locate(Root, Seed, entry, marker);
    /// <summary>The same with both folders given (a worker thread asks Godot for no path).</summary>
    public static string Locate(string root, string? seed, string entry, string marker)
    {
        string own = Path.Combine(root, entry);
        if (seed == null || File.Exists(own + marker)) return own;
        string shipped = Path.Combine(seed, entry);
        return File.Exists(shipped + marker) ? shipped : own;
    }

    /// <summary>Mark a cache file as used now (a failure only means it may be pruned and rebuilt).</summary>
    public static void Touch(string file)
    {
        if (Seed is { } shipped && file.StartsWith(shipped, StringComparison.OrdinalIgnoreCase)) return; // the package's own: never pruned
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
