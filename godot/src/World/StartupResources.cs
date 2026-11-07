using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// Files a start is known to load later on the main thread (a part's models, pictures, material tables). The town's
/// prefetch reads them on the loader's worker threads beside the town, and they are held until the game is up, so the
/// part finds them loaded. Declaring a file changes only when it is read, never what is loaded.
/// Rule (AGENTS.md "Adding to the start"): a new part that loads more than a few files at start declares them here.
/// </summary>
public static class StartupResources
{
    private static readonly List<Func<IEnumerable<string>>> sources = new() { () => Folder("res://assets/people2-pictures", ".png") };
    private static List<Resource>? held;

    /// <summary>Add a list of res:// files (read when the town's prefetch starts; a failing list is skipped).</summary>
    public static void Declare(Func<IEnumerable<string>> files) => sources.Add(files);

    public static IEnumerable<string> All()
    {
        foreach (var source in sources)
        {
            string[] files;
            try { files = source().ToArray(); }
            catch (Exception e) { GD.Print("startup resources: a list was skipped: " + e.Message); continue; }
            foreach (string f in files) if (ResourceLoader.Exists(f)) yield return f;
        }
    }

    /// <summary>Every file with this extension in a folder (exported or not).</summary>
    public static IEnumerable<string> Folder(string folder, string extension)
    {
        if (!DirAccess.DirExistsAbsolute(folder)) return Array.Empty<string>();
        // (an exported game lists "x.png.import" or "x.res.remap" where the project has "x.png")
        return DirAccess.GetFilesAt(folder)
            .Select(f => f.EndsWith(".import", StringComparison.Ordinal) ? f[..^7] : f.EndsWith(".remap", StringComparison.Ordinal) ? f[..^6] : f)
            .Where(f => f.EndsWith(extension, StringComparison.Ordinal)).Distinct().Select(f => folder + "/" + f).ToArray();
    }

    /// <summary>Keep the prefetched resources in memory until the game is up.</summary>
    public static void Hold(List<Resource> resources) => held = resources;

    /// <summary>The game is up: the parts hold what they use.</summary>
    public static void Release() => held = null;
}
