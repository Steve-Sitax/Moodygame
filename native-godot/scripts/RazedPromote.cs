using Godot;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Scheldemist.Native.World;

// Issue #230: bakes the razed houses' cut (NativeRazedHouses.Cut, city_build.json "razed") into the town's resources, so the
// start no longer cuts them. Run in Forward+ (not headless), from a clean checkout of the resources:
//   godot --rendering-method forward_plus --path . res://scripts/razed-promote.tscn -- [--record <folder>]
// The cut always starts from the original chunks: when world/town/razed-baked.json exists, every resource it lists is first
// put back from git (its source commit), each checked against the hashes the bake recorded. So after a rule change or a
// newly razed house, run it again and it bakes the whole cut afresh. The meshes the cuts before the razing change (the Werf's
// notch, the Ruien gates: NativeTown.CutBeforeRazing) are left as they are and listed: the start cuts the razed houses out
// of them after those cuts, as it always did (run it again after a change to those cuts too); so is the chimney smoke
// (dev: --keep-razed-smoke). Every resource the cut changes (a chunk, a dressing or window-glow mesh with its collision
// stand-in, a copy set) is saved in place; the scene, its nodes and their ids are untouched. (--city-build <file> bakes
// another razed set, to check the start's own cut of a house razed later; never commit what it bakes.) razed-baked.json lists the houses weighed (with their outlines' hashes), those cut, the counts and every
// resource's hashes; the start (NativeRazedHouses.Cut) skips those houses and still cuts one razed since.
public partial class RazedPromote : Node
{
    const string Scene = "res://world/town/scene.tscn";
    const string CityBuild = "res://world/data/shared/city_build.json";
    static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    static string HashFile(string path) => Hash(File.ReadAllBytes(ProjectSettings.GlobalizePath(path)));
    static IEnumerable<Node> All(Node n) { yield return n; foreach (var c in n.GetChildren()) foreach (var d in All(c)) yield return d; }

    public override void _Ready()
    {
        try { Run(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr("Razed promotion stopped: " + e); GetTree().Quit(1); }
    }

    static byte[] Git(params string[] args)
    {
        var info = new ProcessStartInfo("git") { WorkingDirectory = ProjectSettings.GlobalizePath("res://"), RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) info.ArgumentList.Add(a);
        using var git = Process.Start(info)!;
        using var output = new MemoryStream();
        var copy = git.StandardOutput.BaseStream.CopyToAsync(output);
        string error = git.StandardError.ReadToEnd();
        if (!git.WaitForExit(120000)) { git.Kill(); throw new IOException("git timed out: " + string.Join(" ", args)); }
        copy.Wait();
        if (git.ExitCode != 0) throw new IOException($"git {string.Join(" ", args)}: {error}");
        return output.ToArray();
    }

    static string GitText(params string[] args) => System.Text.Encoding.UTF8.GetString(Git(args)).Trim();

    void Run()
    {
        if (DisplayServer.GetName() == "headless") throw new InvalidOperationException("Run the promotion in Forward+, not headless.");
        var args = OS.GetCmdlineUserArgs();
        int r = Array.IndexOf(args, "--record");
        string? record = r >= 0 && r + 1 < args.Length ? args[r + 1] : null;
        int c = Array.IndexOf(args, "--city-build");
        string cityBuild = c >= 0 && c + 1 < args.Length ? args[c + 1] : ProjectSettings.GlobalizePath(CityBuild);
        var clock = Stopwatch.StartNew();
        string prefix = GitText("rev-parse", "--show-prefix");
        string head = GitText("rev-parse", "HEAD");
        string bakedFile = ProjectSettings.GlobalizePath(NativeRazedHouses.BakedFile);

        // 1. the originals back, as the earlier bake found them
        var sources = new Dictionary<string, (string Source, string Original)>();
        if (File.Exists(bakedFile))
        {
            var old = JsonNode.Parse(File.ReadAllText(bakedFile))!["resources"]!.AsObject();
            foreach (var (path, row) in old)
                if (HashFile(path) != row!["installed"]!.GetValue<string>()) throw new IOException("Changed since the razed bake (bake that change into the original first): " + path);
            foreach (var (path, row) in old)
            {
                string source = row!["source"]!.GetValue<string>(), original = row["original"]!.GetValue<string>();
                var bytes = Git("show", source + ":" + prefix + path["res://".Length..]);
                if (Hash(bytes) != original) throw new IOException("The original in git differs from the one recorded: " + path);
                File.WriteAllBytes(ProjectSettings.GlobalizePath(path), bytes);
                sources[path] = (source, original);
            }
            GD.Print($"razed promote: {old.Count} resources put back as they were before the bake");
        }

        // 2. the meshes the cuts before the razing change (the Werf's notch, the Ruien gates): left for the start, so its order stays
        var scene = ResourceLoader.Load<PackedScene>(Scene);
        var probe = scene.Instantiate<Node3D>();
        var probeMeshes = All(probe).OfType<MeshInstance3D>().ToDictionary(m => m, m => m.Mesh);
        NativeTown.CutBeforeRazing(probe, true, true, _ => { });
        var atStart = probeMeshes.Where(kv => !ReferenceEquals(kv.Key.Mesh, kv.Value)).Select(kv => probe.GetPathTo(kv.Key).ToString()).ToHashSet(StringComparer.Ordinal);
        probe.Free();
        // 3. the town as it loads, cut in full (but those meshes)
        var town = scene.Instantiate<Node3D>();
        var meshesBefore = All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh).ToDictionary(m => m, m => (Mesh: (ArrayMesh)m.Mesh, StandIn: StandInLength(m.Mesh)));
        var copiesBefore = All(town).OfType<MultiMeshInstance3D>().Where(m => m.Multimesh != null).ToDictionary(m => m, m => m.Multimesh.InstanceCount);
        var users = new Dictionary<Resource, int>();
        foreach (var n in All(town))
            if (((Resource?)(n as MeshInstance3D)?.Mesh ?? (n as MultiMeshInstance3D)?.Multimesh) is { } used) users[used] = users.GetValueOrDefault(used) + 1;
        // (the chimney smoke is left too: the start drops a razed house's chimneys itself, unless --keep-razed-smoke)
        var leave = All(town).OfType<MeshInstance3D>().Where(m => m.Name == "ambient_smoke" || m.GetParent()?.Name == "ambient_smoke").Select(m => town.GetPathTo(m).ToString()).Concat(atStart).ToHashSet(StringComparer.Ordinal);
        var result = NativeRazedHouses.Cut(town, cityBuild, useBaked: false, leave: leave);
        foreach (var note in result.Notes) GD.Print("razed houses: " + note);

        // 4. what changed: a mesh rebuilt or its stand-in cut, a copy set rebuilt
        var changed = new List<(string Path, Resource Now)>();
        void Take(Resource before, Resource now, string what)
        {
            string path = before.ResourcePath;
            if (!path.StartsWith("res://world/town/resources/", StringComparison.Ordinal) || path.Contains("::")) throw new IOException($"{what} is not a town resource of its own: '{path}'");
            if (users[before] != 1) throw new IOException($"{what} ({path}) is used by {users[before]} nodes");
            if (changed.Any(c => c.Path == path)) throw new IOException("Changed twice: " + path);
            changed.Add((path, now));
        }
        foreach (var (node, (mesh, standIn)) in meshesBefore)
        {
            if (!ReferenceEquals(node.Mesh, mesh)) Take(mesh, node.Mesh, town.GetPathTo(node));
            else if (StandInLength(mesh) != standIn) Take(mesh, mesh, town.GetPathTo(node));
        }
        foreach (var (node, count) in copiesBefore)
            if (node.Multimesh.InstanceCount != count) Take(node.Multimesh, node.Multimesh, town.GetPathTo(node));

        // 5. saved in place (compressed as the original was), each read back
        var resources = new JsonObject();
        long before = 0, after = 0;
        foreach (var (path, now) in changed.OrderBy(c => c.Path, StringComparer.Ordinal))
        {
            string file = ProjectSettings.GlobalizePath(path);
            var bytes = File.ReadAllBytes(file);
            if (!sources.TryGetValue(path, out var source))
            {
                // a resource baked the first time: its original must be the committed one, so a later bake can put it back
                if (Hash(Git("show", head + ":" + prefix + path["res://".Length..])) != Hash(bytes)) throw new IOException("Not as committed (commit it first): " + path);
                source = (head, Hash(bytes));
            }
            before += bytes.Length;
            bool compressed = bytes.Length >= 4 && bytes[0] == 'R' && bytes[1] == 'S' && bytes[2] == 'C' && bytes[3] == 'C';
            if (ResourceSaver.Save(now, path, compressed ? ResourceSaver.SaverFlags.Compress : ResourceSaver.SaverFlags.None) != Error.Ok) throw new IOException(path);
            var back = ResourceLoader.Load<Resource>(path, null, ResourceLoader.CacheMode.Ignore);
            if (now is ArrayMesh mesh)
            {
                var read = (ArrayMesh)back;
                if (read.GetSurfaceCount() != mesh.GetSurfaceCount() || StandInLength(read) != StandInLength(mesh)) throw new IOException("Reload differs: " + path);
                for (int i = 0; i < mesh.GetSurfaceCount(); i++)
                    if (read.SurfaceGetArrayIndexLen(i) != mesh.SurfaceGetArrayIndexLen(i) || read.SurfaceGetArrayLen(i) != mesh.SurfaceGetArrayLen(i)) throw new IOException("Reload differs: " + path);
            }
            else if (((MultiMesh)back).InstanceCount != ((MultiMesh)now).InstanceCount) throw new IOException("Reload differs: " + path);
            after += new FileInfo(file).Length;
            resources[path] = new JsonObject { ["source"] = source.Source, ["original"] = source.Original, ["installed"] = HashFile(path) };
        }
        // a resource the earlier bake changed and this one leaves: it stays as the original (put back above)
        foreach (var path in sources.Keys.Where(p => !resources.ContainsKey(p))) GD.Print("razed promote: back to its original: " + path);

        var weighed = new JsonObject();
        foreach (var (index, hash) in result.Weighed.OrderBy(kv => kv.Key)) weighed[index.ToString(System.Globalization.CultureInfo.InvariantCulture)] = hash;
        var doc = new JsonObject
        {
            ["about"] = "The razed houses cut into the town's resources by scripts/razed-promote.tscn (#230). The start skips the houses weighed here; run the promote again after a change to the cut's rules or to the razed houses.",
            ["razedSet"] = NativeRazedHouses.RazedSet(result.Weighed),
            ["weighed"] = weighed,
            ["cut"] = new JsonObject(result.Tags.OrderBy(kv => kv.Key).Select(kv => KeyValuePair.Create(kv.Key.ToString(System.Globalization.CultureInfo.InvariantCulture), (JsonNode?)kv.Value))),
            ["atStart"] = new JsonArray(atStart.Order(StringComparer.Ordinal).Select(p => (JsonNode)p).ToArray()),
            ["triangles"] = result.Triangles,
            ["windowGlows"] = result.WindowGlows,
            ["notes"] = new JsonArray(result.Notes.Where(n => !n.StartsWith("cut in ", StringComparison.Ordinal)).Select(n => (JsonNode)n).ToArray()),
            ["resources"] = resources,
        };
        File.WriteAllText(bakedFile, doc.ToJsonString(new JsonSerializerOptions { WriteIndented = true }).Replace("\r\n", "\n") + "\n");
        string summary = $"Razed houses baked: {result.Houses} houses, {result.Triangles} triangles, {result.WindowGlows} glow triangles; {changed.Count} resources, {before} bytes before, {after} after; in {clock.ElapsedMilliseconds} ms";
        if (record != null)
        {
            Directory.CreateDirectory(record);
            File.WriteAllText(Path.Combine(record, "razed-promotion.json"), new JsonObject { ["date"] = DateTime.UtcNow.ToString("u"), ["summary"] = summary, ["head"] = head, ["bytesBefore"] = before, ["bytesAfter"] = after }.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        GD.Print(summary);
        town.Free();
    }

    static int StandInLength(Mesh mesh) => mesh.HasMeta("native_solid_stand_in") ? mesh.GetMeta("native_solid_stand_in").AsVector3Array().Length : -1;
}
