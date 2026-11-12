using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

/// <summary>Disposable derived meshes only. Authored resources and layouts are never written.</summary>
public static class NativeCutCache
{
    internal static string? CurrentKey { get; private set; }
    private sealed record Entry(string Node, string File, string Sha256, bool Copies);
    private sealed record Receipt(string Key, int Werf, string[] Notes, Entry[] Entries);
    private sealed record Before(MeshInstance3D Node, ulong Mesh);
    private sealed record CopiesBefore(MultiMeshInstance3D Node, string Buffer);
    private static string Digest(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    private static string BufferHash(MultiMesh mm) => Digest(GD.VarToBytes(MultiMeshData.Read(mm)));
    private static string FileHash(string path)
    {
        string disk = ProjectSettings.GlobalizePath(path);
        if (System.IO.File.Exists(disk))
        {
            using var stream = System.IO.File.OpenRead(disk);
            return Convert.ToHexString(SHA256.HashData(stream));
        }
        if (!Godot.FileAccess.FileExists(path)) throw new IOException("Missing cache input " + path);
        return Digest(Godot.FileAccess.GetFileAsBytes(path));
    }
    private static string Key(Node3D town, bool werf, bool gates)
    {
        using var trace=Scheldemist.Dev.StartupTiming.Split("cache.street.inputs");
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        void Add(string text) { hash.AppendData(Encoding.UTF8.GetBytes(text)); hash.AppendData(new byte[] { 0 }); }
        Add("street-cuts-v1"); Add(StartupCacheCode.Revision(typeof(NativeCutCache).Assembly));
        Add(StartupCacheCode.Revision(typeof(QuayNotch).Assembly)); Add(Engine.GetVersionInfo().ToString()); Add(DisplayServer.GetName()); Add(RenderingServer.GetCurrentRenderingMethod());
        Add(werf.ToString()); Add(gates.ToString()); Add(Scheldemist.Main.I.Flag("no-ruien-entrances").ToString());
        Add(Scheldemist.Main.I.Flag("no-stair-holes").ToString());
        var direct = new List<string>();
        void Resource(string path)
        {
            path = path.Split("::")[0];
            if (path.Length == 0) throw new IOException("Unsaved mesh: using the live construction path");
            direct.Add(path);
        }
        foreach (var node in BakedWorld.All(town))
        {
            Add(town.GetPathTo(node).ToString());
            if (node is Node3D n) Add(Convert.ToHexString(GD.VarToBytes(n.Transform)));
            if (node is MeshInstance3D { Mesh: { } mesh }) Resource(mesh.ResourcePath);
            if (node is MultiMeshInstance3D { Multimesh: { } copies }) Resource(copies.ResourcePath);
        }
        var hashes = InputFiles.HashWithDependencies(direct);
        trace?.Next("dependencies");
        foreach (string file in new[] { RuienData.NetworkFile, RuienData.AreasFile, RuienEntrance.File })
        { Add(file); Add(Godot.FileAccess.FileExists(file) ? FileHash(file) : "missing"); }
        foreach (var area in RuienData.Load().Areas)
        {
            string file = area.Export + "/markers.json";
            Add(file); Add(Godot.FileAccess.FileExists(file) ? FileHash(file) : "missing");
        }
        trace?.Next("configuration");
        foreach (var (file, sha) in hashes) { Add(file); Add(sha); }
        trace?.Next("file-hashes");
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
    public static int Run(Node3D town, bool werf, bool gates, Action<string> note)
    {
        CurrentKey=null;
        if (Scheldemist.Main.I.Flag("no-startup-cache")) return NativeTown.CutBeforeRazing(town, werf, gates, note);
        var clock = System.Diagnostics.Stopwatch.StartNew();
        string key, folder;
        try
        {
            key = Key(town, werf, gates);
            folder = Scheldemist.World.StartupCachePrune.Locate(Path.Combine("cuts", key), Path.DirectorySeparatorChar + "complete.json");
        }
        catch (Exception e)
        {
            GD.Print("startup cache: bypass: " + e.Message);
            return NativeTown.CutBeforeRazing(town, werf, gates, note);
        }
        CurrentKey=key;
        GD.Print($"startup cache: input fingerprint {clock.ElapsedMilliseconds} ms");
        if (TryRead(town, folder, key, out var receipt))
        {
            foreach (string line in receipt!.Notes) note(line);
            GD.Print($"startup cache: street cuts hit ({receipt.Entries.Length} resources), {clock.ElapsedMilliseconds} ms");
            return receipt.Werf;
        }
        var meshes = BakedWorld.All(town).OfType<MeshInstance3D>().Where(n => n.Mesh != null).Select(n => new Before(n,n.Mesh.GetInstanceId())).ToArray();
        var copies = BakedWorld.All(town).OfType<MultiMeshInstance3D>().Where(n => n.Multimesh != null).Select(n => new CopiesBefore(n,BufferHash(n.Multimesh))).ToArray();
        var notes = new List<string>();
        int result = NativeTown.CutBeforeRazing(town, werf, gates, line => { notes.Add(line); note(line); });
        // A unique generation is published only when every resource has been saved successfully.
        string generation = Guid.NewGuid().ToString("N");
        try
        {
            Directory.CreateDirectory(folder);
            var entries = new List<Entry>();
            void Save(Node node, Resource resource, bool isCopies)
            {
                string file = generation + "-" + entries.Count + ".res";
                if (ResourceSaver.Save(resource, Path.Combine(folder,file)) != Error.Ok) throw new IOException("Cannot save " + file);
                entries.Add(new(town.GetPathTo(node).ToString(),file,FileHash(Path.Combine(folder,file)),isCopies));
            }
            foreach (var before in meshes) if (before.Node.Mesh.GetInstanceId() != before.Mesh) Save(before.Node,before.Node.Mesh,false);
            foreach (var before in copies) if (BufferHash(before.Node.Multimesh) != before.Buffer) Save(before.Node,before.Node.Multimesh,true);
            var manifest = new Receipt(key,result,notes.ToArray(),entries.ToArray());
            string temporary = Path.Combine(folder,generation+".json");
            System.IO.File.WriteAllText(temporary,JsonSerializer.Serialize(manifest));
            System.IO.File.Move(temporary,Path.Combine(folder,"complete.json"),true);
            GD.Print($"startup cache: street cuts stored ({entries.Count} resources), {clock.ElapsedMilliseconds} ms");
        }
        catch (Exception e) { GD.Print("startup cache: could not store: " + e.Message); }
        return result;
    }
    private static bool TryRead(Node3D town, string folder, string key, out Receipt? receipt)
    {
        receipt = null;
        try
        {
            string manifest = Path.Combine(folder,"complete.json");
            if (!System.IO.File.Exists(manifest)) return false;
            var saved = JsonSerializer.Deserialize<Receipt>(System.IO.File.ReadAllText(manifest))!;
            if (saved.Key != key || saved.Notes == null || saved.Entries == null) return false;
            var loaded = new List<(Node Node, Resource Resource)>();
            foreach (var entry in saved.Entries)
            {
                if (Path.GetFileName(entry.File) != entry.File) return false;
                string path = Path.Combine(folder,entry.File);
                if (FileHash(path) != entry.Sha256) return false;
                var node = town.GetNodeOrNull(entry.Node);
                if (entry.Copies ? node is not MultiMeshInstance3D : node is not MeshInstance3D) return false;
                Resource resource = entry.Copies ? ResourceLoader.Load<MultiMesh>(path,cacheMode:ResourceLoader.CacheMode.Ignore)
                    : ResourceLoader.Load<ArrayMesh>(path,cacheMode:ResourceLoader.CacheMode.Ignore);
                if (resource == null) return false;
                loaded.Add((node!,resource));
            }
            // No live changes until the complete generation has passed validation.
            foreach (var (node, resource) in loaded)
                if (node is MeshInstance3D mesh) mesh.Mesh=(ArrayMesh)resource;
                else ((MultiMeshInstance3D)node).Multimesh=(MultiMesh)resource;
            Scheldemist.World.StartupCachePrune.Touch(manifest);
            receipt=saved; return true;
        }
        catch (Exception e) { GD.Print("startup cache: rebuilding: " + e.Message); return false; }
    }
}
