using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>Reading order only: what the town and its districts load is unchanged (kept out of the geometry revision).</summary>
public static class NativeTownPrefetch
{
    /// <summary>
    /// The resources the street cache found under the town's meshes at the last start, read level by level on the
    /// loader's worker threads: a level's files depend only on lower levels, so no read waits for another and all
    /// run at once. A file whose dependencies are not all known is left to the town's own request.
    /// </summary>
    public static List<Resource> Run(IEnumerable<string> more)
    {
        using var timing = Scheldemist.Dev.StartupTiming.Measure("native.prefetch");
        // (the district descriptors and their catalogs are scripted resources: read by their own loads, after these)
        var tops = new HashSet<string>(more, StringComparer.Ordinal);
        // Include the packed town itself: NativeTown's following request then finds a finished
        // resource too, instead of entering the same unfinished-load path after shared textures.
        var dependencies = Scheldemist.World.InputFiles.DependencyHints(Scheldemist.World.InputFiles.KnownDependencies().Keys.Concat(Scheldemist.World.StartupResources.All()).Concat(tops).Append("res://world/town/scene.tscn"));
        var level = DependencyLevels(dependencies, Scheldemist.Main.I.Flag("serial-script-prefetch"));
        var cpu = System.Diagnostics.Process.GetCurrentProcess().TotalProcessorTime; var wall = System.Diagnostics.Stopwatch.StartNew();
        var levels = level.Where(l => l.Value >= 0).GroupBy(l => l.Value).OrderBy(g => g.Key)
            .Select(group => group.Select(l => l.Key).Where(p => !p.EndsWith(".catalog.tres", StringComparison.Ordinal) && !tops.Contains(p))
                .Where(p => Godot.FileAccess.FileExists(p) || ResourceLoader.Exists(p)));
        var held = LoadLevels(levels);
        GD.Print($"town prefetch: {held.Count} resources in {level.Values.Where(v => v >= 0).DefaultIfEmpty(-1).Max() + 1} levels, {wall.ElapsedMilliseconds} ms, {(System.Diagnostics.Process.GetCurrentProcess().TotalProcessorTime - cpu).TotalMilliseconds:0} ms of processor time");
        return held;
    }

    internal static List<Resource> LoadLevels(IEnumerable<IEnumerable<string>> levels, bool? parallel = null)
    {
        // Godot's dummy renderer intermittently allocates an already-initialized shader RID when
        // several resources are loaded together. Headless tools keep one loader; Forward+ keeps
        // the parallel resource path. Script classes and shader sources load serially first.
        bool threaded = parallel ?? DisplayServer.GetName() != "headless";
        using var loaderMethod = new StringName(threaded ? "load_threaded_get" : "load");
        using var scriptMethod = new StringName("load");
        var native = new List<Variant>();
        try
        {
            foreach (var paths in levels)
            {
                var files = paths.ToArray();
                // Shader includes are not reported by GetDependencies. Loading their parent shader
                // on an engine worker still takes the nested unfinished-load path, even with the
                // level barrier below (cast_iron's two includes reproduced two leaked LoadTokens).
                foreach (string file in files.Where(SerialSource))
                    native.Add(ResourceLoader.Singleton.Call(scriptMethod, file));
                var resources = files.Where(p => !SerialSource(p));
                var requested = threaded ? resources.Where(p => ResourceLoader.LoadThreadedRequest(p) == Error.Ok).ToArray() : resources.ToArray();
                // On a user worker, Get() on an unfinished request executes the engine's load-task
                // assistance path. Godot 4.7 can leave a zero-reference LoadToken there (#120661).
                // Let the loader finish the whole level before collecting any result.
                if (threaded)
                    foreach (string path in requested)
                        while (ResourceLoader.LoadThreadedGetStatus(path) == ResourceLoader.ThreadLoadStatus.InProgress)
                            Thread.Sleep(1);
                foreach (string path in requested)
                    native.Add(ResourceLoader.Singleton.Call(loaderMethod, path));
            }
            // Keep native references until all loader tasks have joined, then bind the C# wrappers
            // in one phase. A Variant retains the native resource without creating its wrapper.
            var held = new List<Resource>(native.Count);
            foreach (var value in native)
                if (value.AsGodotObject() is Resource resource) held.Add(resource);
            return held;
        }
        finally { foreach (var value in native) value.Dispose(); }
    }

    private static bool IsScript(string path) => path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".gd", StringComparison.OrdinalIgnoreCase);
    private static bool SerialSource(string path) => IsScript(path) || path.EndsWith(".gdshader", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".gdshaderinc", StringComparison.OrdinalIgnoreCase);

    // The diagnostic serial-script mode leaves the entire scripted branch to its owning loader.
    // Native dependencies below it remain eligible; unknown dependencies and cycles are always left out.
    internal static Dictionary<string, int> DependencyLevels(IReadOnlyDictionary<string, string[]> dependencies, bool deferScripts = true)
    {
        var level = new Dictionary<string, int>(StringComparer.Ordinal);
        int LevelOf(string path, int depth)
        {
            if (level.TryGetValue(path, out int known)) return known;
            level[path] = -1; // (a cycle or an unknown file is left out)
            if (deferScripts && IsScript(path)) return -1;
            if (depth > 64 || !dependencies.TryGetValue(path, out var under)) return -1;
            int result = 0;
            foreach (string d in under)
            {
                int l = LevelOf(d, depth + 1);
                if (l < 0) return -1;
                result = Math.Max(result, l + 1);
            }
            return level[path] = result;
        }
        foreach (string path in dependencies.Keys) LevelOf(path, 0);
        return level;
    }
}
