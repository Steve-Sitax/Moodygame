using System;
using System.Collections.Generic;
using System.Linq;
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
        var held = new List<Resource>();
        // (the district descriptors and their catalogs are scripted resources: read by their own loads, after these)
        var tops = new HashSet<string>(more, StringComparer.Ordinal);
        var dependencies = Scheldemist.World.InputFiles.DependencyHints(Scheldemist.World.InputFiles.KnownDependencies().Keys.Concat(Scheldemist.World.StartupResources.All()).Concat(tops));
        var level = new Dictionary<string, int>(StringComparer.Ordinal);
        int LevelOf(string path, int depth)
        {
            if (level.TryGetValue(path, out int known)) return known;
            level[path] = -1; // (a cycle or an unknown file is left out)
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
        var cpu = System.Diagnostics.Process.GetCurrentProcess().TotalProcessorTime; var wall = System.Diagnostics.Stopwatch.StartNew();
        foreach (var group in level.Where(l => l.Value >= 0).GroupBy(l => l.Value).OrderBy(g => g.Key))
        {
            // (scripts are left to the resources that use them)
            var requested = group.Select(l => l.Key).Where(p => !p.EndsWith(".cs", StringComparison.Ordinal) && !p.EndsWith(".gd", StringComparison.Ordinal) && !p.EndsWith(".catalog.tres", StringComparison.Ordinal) && !tops.Contains(p))
                .Where(p => Godot.FileAccess.FileExists(p) || ResourceLoader.Exists(p))
                .Where(p => ResourceLoader.LoadThreadedRequest(p) == Error.Ok).ToArray();
            foreach (string path in requested)
                if (ResourceLoader.LoadThreadedGet(path) is { } resource) held.Add(resource);
        }
        GD.Print($"town prefetch: {held.Count} resources in {level.Values.Where(v => v >= 0).DefaultIfEmpty(-1).Max() + 1} levels, {wall.ElapsedMilliseconds} ms, {(System.Diagnostics.Process.GetCurrentProcess().TotalProcessorTime - cpu).TotalMilliseconds:0} ms of processor time");
        return held;
    }
}
