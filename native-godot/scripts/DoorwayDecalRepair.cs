using Godot;
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.Json;
using Scheldemist.World;

/// <summary>Trim the street-life wall stains to the native house door openings. Audit by default;
/// --apply saves only intersecting decal meshes, with original resources and hashes in --record.
/// Door leaves, stone surrounds, collision, material resources and scene placements stay unchanged.</summary>
public partial class DoorwayDecalRepair : Node
{
    private sealed record Opening(string Name, Transform3D Frame, Aabb Box);

    private static string Arg(string key)
    {
        var args = OS.GetCmdlineUserArgs(); int i = Array.IndexOf(args, "--" + key);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : "";
    }

    public override void _Ready()
    {
        try { Repair(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }

    private List<Opening> Openings()
    {
        using var roots = JsonDocument.Parse(Godot.FileAccess.GetFileAsString("res://world/town/roots.json"));
        var result = new List<Opening>();
        foreach (var row in roots.RootElement.EnumerateArray())
        {
            string name = row.GetProperty("sourceName").GetString()!;
            if (!name.StartsWith("house_") || name.StartsWith("house_lining_") || name.StartsWith("house_glow_") ||
                new[] { "_in", "_openings", "_light_well", "_grating" }.Any(name.EndsWith)) continue;
            var house = GD.Load<PackedScene>(row.GetProperty("path").GetString()!).Instantiate<Node3D>();
            AddChild(house);
            var hinge = house.GetChildren().OfType<Node3D>().FirstOrDefault(n => n is not MeshInstance3D);
            if (hinge != null)
            {
                var rotation = hinge.Rotation;
                hinge.Rotation = new Vector3(rotation.X, 0, rotation.Z);
                var inverse = house.GlobalTransform.AffineInverse();
                Aabb? bounds = null;
                foreach (var mi in BakedWorld.All(hinge).OfType<MeshInstance3D>().Where(m => m.Mesh != null))
                {
                    var box = (inverse * mi.GlobalTransform) * mi.Mesh.GetAabb();
                    bounds = bounds == null ? box : bounds.Value.Merge(box);
                }
                if (bounds is { } leaf)
                {
                    // The leaf fits within the jambs. Five millimetres cover the closing clearance;
                    // depth includes the wall face in front of the recessed leaf, not the room beyond.
                    var margin = new Vector3(.005f, .005f, .6f);
                    result.Add(new Opening(name, house.GlobalTransform, new Aabb(leaf.Position - margin, leaf.Size + margin * 2)));
                }
            }
            house.Free();
        }
        return result;
    }

    private static double Area(Godot.Collections.Array arrays)
    {
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var iv = arrays[(int)Mesh.ArrayType.Index];
        var ix = iv.VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : iv.AsInt32Array();
        double area = 0;
        for (int t = 0; t < ix.Length; t += 3) area += (v[ix[t + 1]] - v[ix[t]]).Cross(v[ix[t + 2]] - v[ix[t]]).Length() * .5;
        return area;
    }

    private void Repair()
    {
        string output = Arg("record");
        if (output == "") throw new ArgumentException("--record <external directory> is required");
        Directory.CreateDirectory(output);
        bool apply = OS.GetCmdlineUserArgs().Contains("--apply");
        var openings = Openings();
        var street = GD.Load<PackedScene>("res://world/town/roots/node-07692.scn").Instantiate<Node3D>();
        AddChild(street);
        var records = new List<object>();
        var seen = new HashSet<string>();
        foreach (var mi in BakedWorld.All(street).OfType<MeshInstance3D>())
        {
            if (mi.Mesh is not ArrayMesh mesh) continue;
            var near = openings.Where(o => (o.Frame * o.Box).Intersects(mi.GlobalTransform * mesh.GetAabb())).ToArray();
            if (near.Length == 0) continue;
            var surfaces = new List<Godot.Collections.Array>();
            var cuts = new List<object>();
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                var arrays = mesh.SurfaceGetArrays(s);
                surfaces.Add(arrays);
                if (mesh.SurfaceGetMaterial(s)?.ResourceName != "streetlife_walldecal") continue;
                foreach (var opening in near)
                {
                    var xf = opening.Frame.AffineInverse() * mi.GlobalTransform;
                    var lo = opening.Box.Position; var hi = opening.Box.End;
                    double before = Area(arrays);
                    int triangles = QuayNotch.CutSurfaceWith(arrays, xf, tri =>
                    {
                        var (a, b, c) = tri;
                        var n = (b - a).Cross(c - a);
                        return n.LengthSquared() > 1e-12f && Math.Abs(n.Normalized().Y) < .2f;
                    }, new() { p => p.X - lo.X, p => hi.X - p.X, p => p.Y - lo.Y,
                        p => hi.Y - p.Y, p => p.Z - lo.Z, p => hi.Z - p.Z });
                    double removed = before - Area(arrays);
                    if (removed > .000001) cuts.Add(new { door = opening.Name, surface = s, triangles, removedSquareMetres = removed });
                }
            }
            if (cuts.Count == 0) continue;
            if (!seen.Add(mesh.ResourcePath)) throw new InvalidOperationException("Shared decal mesh has multiple placements: " + mesh.ResourcePath);
            string file = ProjectSettings.GlobalizePath(mesh.ResourcePath);
            string originalHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
            string? savedHash = null;
            if (apply)
            {
                string backup = Path.Combine(output, Path.GetFileName(file));
                if (File.Exists(backup)) throw new IOException("Keep existing backup: " + backup);
                var result = new ArrayMesh { ResourceName = mesh.ResourceName };
                foreach (var key in mesh.GetMetaList()) result.SetMeta(key, mesh.GetMeta(key));
                for (int s = 0; s < mesh.GetSurfaceCount(); s++)
                {
                    var arrays = surfaces[s];
                    foreach (var uv in arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array())
                        if (!uv.IsFinite()) throw new InvalidDataException("Nonfinite decal UV");
                    // Keep full-precision cut boundaries; compression would shift them back into the opening.
                    var flags = mesh.SurfaceGetFormat(s) & ~Mesh.ArrayFormat.FlagCompressAttributes;
                    result.AddSurfaceFromArrays(mesh.SurfaceGetPrimitiveType(s), arrays, null, null, flags);
                    result.SurfaceSetMaterial(s, mesh.SurfaceGetMaterial(s));
                    result.SurfaceSetName(s, mesh.SurfaceGetName(s));
                }
                File.Copy(file, backup);
                if (ResourceSaver.Save(result, mesh.ResourcePath, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException(file);
                savedHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
            }
            records.Add(new { mesh = mesh.ResourcePath, originalHash, savedHash, cuts });
            GD.Print($"Doorway decals: {mi.Name}, {cuts.Count} door/surface intersections{(apply ? " repaired" : " found")}");
        }
        File.WriteAllText(Path.Combine(output, "doorway-decals.json"), JsonSerializer.Serialize(new { apply, doors = openings.Count, meshes = records }, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Doorway decals: {openings.Count} openings checked, {records.Count} affected meshes");
    }
}
