using Godot;
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.Json;
using Scheldemist.World;

/// <summary>Remove the four obsolete broad weathering strips from street-life wall decals.
/// Posters and lettering share the atlas and stay untouched. Audit by default; --apply
/// saves affected native resources with originals and hashes in the required --record folder.</summary>
public partial class StreetWeatheringRepair : Node
{
    private static string Arg(string key)
    {
        var args = OS.GetCmdlineUserArgs(); int i = Array.IndexOf(args, "--" + key);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : "";
    }

    public static (ArrayMesh Mesh, int Removed, int Kept) WithoutWeathering(ArrayMesh source)
    {
        // Verify the native atlas receipt instead of guessing from texture colours.
        using var extras = JsonDocument.Parse(Godot.FileAccess.GetFileAsString("res://assets/game-models/streetlife.extras.json"));
        using var meta = JsonDocument.Parse(extras.RootElement.GetProperty("streetlife_meta").GetProperty("meta").GetString()!);
        var atlas = meta.RootElement.GetProperty("decal");
        var size = new Vector2(atlas.GetProperty("size")[0].GetSingle(), atlas.GetProperty("size")[1].GetSingle());
        var cells = new[] { "damp_0", "damp_1", "moss_0", "salt_0" }.Select(name =>
        {
            var c = atlas.GetProperty("cells").GetProperty(name);
            return new Rect2(c[0].GetSingle(), c[1].GetSingle(), c[2].GetSingle(), c[3].GetSingle());
        }).ToArray();
        var result = new ArrayMesh { ResourceName = source.ResourceName };
        foreach (var key in source.GetMetaList()) result.SetMeta(key, source.GetMeta(key));
        int removed = 0, kept = 0;
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var arrays = source.SurfaceGetArrays(s);
            if (source.SurfaceGetMaterial(s)?.ResourceName == "streetlife_walldecal")
            {
                var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                var value = arrays[(int)Mesh.ArrayType.Index];
                var ix = value.VariantType == Variant.Type.Nil ? Enumerable.Range(0, uv.Length).ToArray() : value.AsInt32Array();
                var keep = new List<int>();
                for (int i = 0; i < ix.Length; i += 3)
                {
                    var points = new[] { uv[ix[i]] * size, uv[ix[i+1]] * size, uv[ix[i+2]] * size };
                    if (cells.Any(cell => points.All(p => cell.HasPoint(p)))) removed++;
                    else
                    {
                        // A triangle must belong wholly to a cell; no broad centroid selection can erase a neighbouring sign.
                        if (cells.Any(cell => cell.HasPoint((points[0]+points[1]+points[2])/3)))
                            throw new InvalidDataException("Weathering triangle crosses an atlas cell boundary: " + source.ResourcePath);
                        keep.AddRange(new[] { ix[i], ix[i+1], ix[i+2] }); kept++;
                    }
                }
                if (keep.Count == 0) continue;
                arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
            }
            result.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), arrays, null, null, source.SurfaceGetFormat(s));
            int slot = result.GetSurfaceCount() - 1;
            result.SurfaceSetMaterial(slot, source.SurfaceGetMaterial(s));
            result.SurfaceSetName(slot, source.SurfaceGetName(s));
        }
        return (result, removed, kept);
    }

    public override void _Ready()
    {
        try
        {
            string output = Arg("record");
            if (output == "") throw new ArgumentException("--record <external directory>");
            Directory.CreateDirectory(output);
            bool apply = OS.GetCmdlineUserArgs().Contains("--apply");
            var street = GD.Load<PackedScene>("res://world/town/roots/node-07692.scn").Instantiate<Node3D>();
            AddChild(street);
            var rows = new List<object>();
            var seen = new HashSet<string>();
            foreach (var mi in BakedWorld.All(street).OfType<MeshInstance3D>())
            {
                if (mi.Mesh is not ArrayMesh source || !seen.Add(source.ResourcePath) ||
                    !Enumerable.Range(0, source.GetSurfaceCount()).Any(s => source.SurfaceGetMaterial(s)?.ResourceName == "streetlife_walldecal")) continue;
                var (result, removed, kept) = WithoutWeathering(source);
                if (removed == 0) continue;
                string path = ProjectSettings.GlobalizePath(source.ResourcePath);
                string beforeHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
                string? afterHash = null;
                if (apply)
                {
                    string backup = Path.Combine(output, Path.GetFileName(path));
                    if (File.Exists(backup)) throw new IOException("Keep original backup: " + backup);
                    File.Copy(path, backup);
                    if (ResourceSaver.Save(result, source.ResourcePath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(path);
                    afterHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
                }
                rows.Add(new { mesh = source.ResourcePath, removed, kept, beforeHash, afterHash });
                GD.Print($"Street weathering: {mi.Name}: {removed} triangles removed, {kept} poster/lettering triangles retained{(apply ? " (saved)" : " (audit)")}");
            }
            File.WriteAllText(Path.Combine(output, "street-weathering.json"), JsonSerializer.Serialize(new { apply, meshes = rows }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print("Street weathering: " + rows.Count + " affected resources");
            GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
}
