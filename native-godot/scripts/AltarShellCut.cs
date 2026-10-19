using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;

/// <summary>Apply the reviewed #198 shell cut, retaining the shared choir floor and other altars.
/// Run altar-shell-cut.tscn with --record pointing outside the checkout; refuses an already cut source.</summary>
public partial class AltarShellCut : Node
{
    public override void _Ready()
    {
        try { Cut(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
    void Cut()
    {
        var args = OS.GetCmdlineUserArgs(); int at = Array.IndexOf(args, "--record");
        if (at < 0 || at + 1 >= args.Length) throw new ArgumentException("--record is required");
        string output = args[at + 1]; Directory.CreateDirectory(output);
        using var plan = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://recovery/cathedral-198-shell.json")));
        var altars = plan.RootElement.GetProperty("altars").EnumerateArray().ToArray();
        var scene = ResourceLoader.Load<PackedScene>("res://world/town/roots/node-08900.scn").Instantiate<Node3D>(); AddChild(scene);
        var pending = new List<(string Path, ArrayMesh Mesh, int[] Counts)>();
        foreach (var node in scene.FindChildren("*", "MeshInstance3D", true, false).OfType<MeshInstance3D>().Where(n => n.Name == "Mesh1135" || n.Name == "Mesh1136"))
        {
            var source = (ArrayMesh)node.Mesh!; var result = new ArrayMesh { ResourceName = source.ResourceName };
            foreach (var key in source.GetMetaList()) result.SetMeta(key, source.GetMeta(key));
            var counts = new int[altars.Length];
            for (int s = 0; s < source.GetSurfaceCount(); s++)
            {
                var arrays = source.SurfaceGetArrays(s); var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var ids = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, vertices.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                var keep = new List<int>();
                for (int i = 0; i < ids.Length; i += 3)
                {
                    var centre = node.GlobalTransform * ((vertices[ids[i]] + vertices[ids[i + 1]] + vertices[ids[i + 2]]) / 3);
                    int hit = -1;
                    for (int a = 0; a < altars.Length; a++)
                    {
                        var b = altars[a].GetProperty("worldBox");
                        if (centre.X >= b[0].GetSingle() && centre.X <= b[1].GetSingle() && centre.Y >= b[2].GetSingle() && centre.Y <= b[3].GetSingle() && centre.Z >= b[4].GetSingle() && centre.Z <= b[5].GetSingle()) { hit = a; break; }
                    }
                    if (hit >= 0) counts[hit]++; else { keep.Add(ids[i]); keep.Add(ids[i + 1]); keep.Add(ids[i + 2]); }
                }
                if (keep.Count == 0) continue;
                arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
                result.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), arrays, null, null, source.SurfaceGetFormat(s));
                result.SurfaceSetMaterial(result.GetSurfaceCount() - 1, source.SurfaceGetMaterial(s));
            }
            for (int a = 0; a < counts.Length; a++)
                if (counts[a] != altars[a].GetProperty("triangles").GetProperty(node.Name).GetInt32()) throw new InvalidDataException($"Unexpected cut at {node.Name}/{a}: {counts[a]}");
            pending.Add((source.ResourcePath, result, counts));
        }
        if (pending.Count != 2) throw new InvalidDataException("Both shared marble meshes must be found");
        foreach (var p in pending)
            if (File.Exists(Path.Combine(output, Path.GetFileName(p.Path)))) throw new IOException("Backup exists; use a fresh record directory");
        var records = new List<object>();
        foreach (var p in pending)
        {
            string path = ProjectSettings.GlobalizePath(p.Path); var before = File.ReadAllBytes(path);
            File.Copy(path, Path.Combine(output, Path.GetFileName(path)));
            if (ResourceSaver.Save(p.Mesh, p.Path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(p.Path);
            records.Add(new { resource = p.Path, cut = p.Counts, before = Convert.ToHexString(SHA256.HashData(before)), after = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))) });
        }
        File.WriteAllText(Path.Combine(output, "cut.json"), JsonSerializer.Serialize(records, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print("Altar shell cut: 1270 triangles removed from two shared resources; other geometry and ids retained");
    }
}
