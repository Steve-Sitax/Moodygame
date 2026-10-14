using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Game;

namespace Scheldemist.Native.Recovery;

/// <summary>Explicit one-time repair of this snapshot's resources; never rewrites a scene or player layout.</summary>
public partial class NativeSurfaceRepair : Node
{
    public override void _Ready()
    {
        try { Repair(); GetTree().Quit(); }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
    private static void Repair()
    {
        string input = Path.GetFullPath(Scheldemist.Native.Game.NativeArguments.Arg("source"));
        var report = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://recovered/rijnkaai-recovered/recovery-report.json")))!;
        using (var stream = File.OpenRead(input))
            if (Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant() != report["source"]!["sha256"]!.GetValue<string>()) throw new InvalidDataException("The source is not the district's recorded snapshot.");
        string backup = ProjectSettings.GlobalizePath("res://proof/surface-backup-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(backup);
        void Save(Resource resource, string path)
        {
            if (!path.StartsWith("res://recovered/", StringComparison.Ordinal) && !path.StartsWith("res://game/rijnkaai/", StringComparison.Ordinal)) throw new IOException("Repair target is not a native snapshot resource.");
            string file = ProjectSettings.GlobalizePath(path), copy = Path.Combine(backup, path[6..]); Directory.CreateDirectory(Path.GetDirectoryName(copy)!);
            if (File.Exists(file)) File.Copy(file, copy, false);
            resource.TakeOverPath(path);
            if (ResourceSaver.Save(resource, path, ResourceSaver.SaverFlags.Compress) != Error.Ok) throw new IOException("Could not save " + path);
        }
        var old = ResourceLoader.Load<ArrayMesh>("res://recovered/rijnkaai-20261012/resources/r0085.res");
        if (!old.HasMeta("native_coping_projection") || old.GetMeta("native_coping_projection").AsInt32() < 3 || Scheldemist.Native.Game.NativeArguments.Arg("rebuild-coping") == "yes")
        {
            using var source = new RecoveryGlb(input, new JsonObject(), new Rect2(-1000, -1000, 2000, 2000));
            int node = source.Json["nodes"]!.AsArray().Select((n, i) => (n, i)).Single(p => p.n!["name"]?.GetValue<string>() == "quay_coping").i;
            var material = (ShaderMaterial)old.SurfaceGetMaterial(0);
            var game = ResourceLoader.Load<ShaderMaterial>("res://game/rijnkaai/resources/material-7.res");
            string code = ResourceLoader.Load<Shader>("res://shaders/recovered_sampler.gdshader").Code;
            if (material.Shader.Code.Contains("cull_disabled")) code = code.Replace("cull_back", "cull_disabled");
            material.Shader = new Shader { Code = code };
            material.SetShaderParameter("bump_tex", game.GetShaderParameter("bump_map")); material.SetShaderParameter("bump_depth", 0.008f);
            Save(material, material.ResourcePath);
            var mesh = RecoveryCoping.Build(source, node, material); Save(mesh, old.ResourcePath);
            var shape = mesh.CreateTrimeshShape(); shape.BackfaceCollision = true;
            Save(shape, "res://recovered/rijnkaai-20261012/resources/r0164.res");
            if (!game.HasMeta("native_coping_detail") || game.GetMeta("native_coping_detail").AsInt32() < 3) { NativeSurfaceMaterials.Coping(game); Save(game, game.ResourcePath); }
            GD.Print($"Coping: {mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length} full-precision vertices, metric height map, rounded nose.");
        }
        foreach (string id in new[] { "bollard-cannon", "bollard-mushroom" })
        {
            var scene = ResourceLoader.Load<PackedScene>("res://recovered/quay-models-20261012/props/" + id + ".tscn").Instantiate();
            foreach (var instance in TownRecovery.Nodes(scene).OfType<MeshInstance3D>())
                if (instance.Mesh is { } mesh && (!mesh.HasMeta("native_iron_detail") || mesh.GetMeta("native_iron_detail").AsInt32() < 2))
                {
                    var made = RecoveryIron.Build(mesh); Save(made, mesh.ResourcePath);
                    foreach (var collider in TownRecovery.Nodes(instance).OfType<CollisionShape3D>()) if (collider.Shape is { ResourcePath.Length: > 0 } previous) Save(RecoveryIron.Collider(made), previous.ResourcePath);
                    GD.Print(id + ": bevelled cast-iron flange/body, transparent non-solid ground stain.");
                }
            scene.Free();
        }
        GD.Print("Original native resources backed up at " + backup);
    }
}
