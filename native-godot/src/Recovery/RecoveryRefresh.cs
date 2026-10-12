using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;

namespace Scheldemist.Native.Recovery;

/// <summary>Match persistent identities across exports; recover the old editable anchors from newly merged scenery.</summary>
public static class RecoveryRefresh
{
    public static void Promote(string snapshot, string target)
    {
        if (!LayoutDocument.ValidId(snapshot) || !LayoutDocument.ValidId(target) || snapshot == target) throw new InvalidDataException("Invalid promotion ids.");
        string source = "res://recovered/" + snapshot, destination = "res://recovered/" + target;
        var report = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(source + "/recovery-report.json")))!.AsObject();
        if (report["checks"]!.AsArray().Any(c => !c!["pass"]!.GetValue<bool>())) throw new InvalidDataException("Cannot promote an unchecked recovery.");
        var settings = ResourceLoader.Load<AuthorDistrict>(source + "/district.tres"); settings.Validate();
        var previous = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(destination + "/recovery-report.json")))!;
        var previousScene = ResourceLoader.Load<AuthorDistrict>(destination + "/district.tres").Scene.Instantiate<Node3D>();
        HashSet<string> oldIds;
        try { oldIds = previousScene.GetNode("Objects").GetChildren().OfType<AuthoredObject>().Select(o => o.ObjectId).ToHashSet(); }
        finally { previousScene.Free(); }
        var root = settings.Scene.Instantiate<Node3D>();
        try
        {
            var currentIds = root.GetNode("Objects").GetChildren().OfType<AuthoredObject>().Select(o => o.ObjectId).ToHashSet();
            if (!oldIds.IsSubsetOf(currentIds)) throw new InvalidDataException("Promotion would lose an authored object id.");
        }
        finally { root.Free(); }
        string backup = ProjectSettings.GlobalizePath("res://proof/before-promotion-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(backup);
        foreach (string file in new[] { "district.tres", "district.tscn", "catalog.tres", "recovery-report.json" })
            File.Copy(ProjectSettings.GlobalizePath(destination + "/" + file), Path.Combine(backup, file));
        string previousProps = ProjectSettings.GlobalizePath(destination + "/props");
        Directory.CreateDirectory(Path.Combine(backup, "props"));
        foreach (string asset in Directory.GetFiles(ProjectSettings.GlobalizePath(source + "/props"), "*.tres"))
        {
            string existing = Path.Combine(previousProps, Path.GetFileName(asset));
            if (File.Exists(existing)) File.Copy(existing, Path.Combine(backup, "props", Path.GetFileName(asset)));
            File.Copy(asset, existing, true);
        }
        void Save(Resource resource, string path)
        {
            if (ResourceSaver.Save(resource, path) != Error.Ok) throw new IOException("Cannot promote native resource " + path);
            resource.TakeOverPath(path);
        }
        Save(settings.Scene, destination + "/district.tscn"); Save(settings.Catalog, destination + "/catalog.tres");
        settings.Id = target; Save(settings, destination + "/district.tres");
        report["district"] = target; report["promotedSnapshot"] = snapshot;
        File.WriteAllText(ProjectSettings.GlobalizePath(destination + "/recovery-report.json"), report.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        GD.Print("Native district promoted with persistent ids; previous control files saved in " + backup);
    }
    public sealed record Result(IEnumerable<object> Anchors, object? Evidence);
    private static JsonObject Previous(JsonObject plan) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(plan["refreshFrom"]!.GetValue<string>())))!.AsObject();
    private static string Id(JsonNode pick) => pick["id"]?.GetValue<string>() ?? "town-node-" + pick["index"]!.GetValue<int>();
    private static Transform3D Pose(JsonNode pick) => RecoveryGlb.Transform(new() { ["matrix"] = pick["transform"]!.DeepClone() });

    public static Dictionary<int, string> MatchIdentities(IEnumerable<RecoveryGlb.Pick> picks, JsonObject plan)
    {
        var result = new Dictionary<int, string>();
        if (plan["refreshFrom"] == null) return result;
        var previous = Previous(plan)["selected"]!.AsArray().Where(p => p!["kind"]!.GetValue<string>() == "prop").ToArray();
        foreach (var pick in picks.Where(p => p.Kind == "prop"))
        {
            var matches = previous.Where(p => p!["name"]!.GetValue<string>() == pick.Name && Pose(p).IsEqualApprox(pick.Transform)).ToArray();
            if (matches.Length > 1) throw new InvalidDataException("Ambiguous identity match for source node " + pick.Index);
            if (matches.Length == 1) result.Add(pick.Index, Id(matches[0]!));
        }
        return result;
    }
    public static Result Apply(TownRecovery writer, Node3D district, AuthorCatalog catalog, JsonObject plan, string output)
    {
        if (plan["refreshFrom"] == null) return new(Array.Empty<object>(), null);
        // Imported descriptors replace matching library ids, never matching saved placements by an export index.
        var merged = catalog.Index();
        foreach (var path in plan["catalogs"]!.AsArray())
            foreach (var asset in ResourceLoader.Load<AuthorCatalog>(path!.GetValue<string>()).Assets)
                if (!asset.Scene!.ResourcePath.StartsWith("res://assets/props/")) merged[asset.Id] = asset;
        catalog.Assets = new Godot.Collections.Array<AuthorAsset>(merged.Values);
        var cannon = merged["bollard-cannon"];
        var previous = Previous(plan);
        var objects = district.GetNode<Node3D>("Objects");
        var existing = objects.GetChildren().OfType<AuthoredObject>().Select(o => o.ObjectId).ToHashSet();
        var missing = previous["selected"]!.AsArray().Where(p => p!["kind"]!.GetValue<string>() == "prop" && !existing.Contains(Id(p))).ToArray();
        if (missing.Any(p => p!["name"]!.GetValue<string>() != "bollard")) throw new InvalidDataException("A persistent prop disappeared and needs an explicit migration rule.");
        var model = cannon.Scene!.Instantiate<Node3D>(); Aabb local;
        try { local = TownRecovery.LocalBounds(model); } finally { model.Free(); }
        var boxes = missing.Select(p => (Pose(p!) * local).Grow(0.003f)).ToArray();
        var removed = new int[boxes.Length];
        int changed = 0;
        foreach (var mesh in TownRecovery.Nodes(district.GetNode("Scenery")).OfType<MeshInstance3D>())
        {
            if (mesh.Mesh == null || !mesh.HasMeta("source_name") || !mesh.GetMeta("source_name").AsString().StartsWith("quayfurniture")) continue;
            var pose = RelativePose(mesh, district);
            var replacement = Trim(mesh.Mesh, pose, boxes, removed);
            if (replacement == null) continue;
            mesh.Mesh = replacement; changed++;
            foreach (var shape in TownRecovery.Nodes(mesh).OfType<CollisionShape3D>())
            {
                if (replacement.GetSurfaceCount() == 0) { shape.Shape = null; shape.Disabled = true; mesh.Visible = false; continue; }
                var solid = replacement.CreateTrimeshShape(); solid.BackfaceCollision = true; shape.Shape = solid;
            }
        }
        if (removed.Any(n => n == 0)) throw new InvalidDataException("Could not identify every merged bollard. The previous native district remains unchanged.");
        var restored = new List<object>();
        foreach (var pick in missing)
        {
            string id = Id(pick!);
            var asset = new AuthorAsset { Id = id, Title = "Quay bollard", Category = "Harbour furniture", Scene = cannon.Scene,
                Footprint = cannon.Footprint, FootprintOffset = cannon.FootprintOffset };
            string file = output + "/props/" + id + ".tres";
            if (ResourceSaver.Save(asset, file) != Error.Ok) throw new IOException("Cannot save restored bollard descriptor.");
            asset.TakeOverPath(file); catalog.Assets.Add(asset);
            objects.AddChild(new AuthoredObject { Name = "object_" + id, ObjectId = id, Asset = asset, Transform = Pose(pick!) });
            restored.Add(new { index = -1, name = "bollard", kind = "prop", id, transform = pick!["transform"], geometry = "quayfurniture.glb/bollard_cannon" });
        }
        catalog.Index();
        return new(restored, new { previousSource = previous["source"], previousDistrict = previous["district"],
            preservedIds = objects.GetChildren().OfType<AuthoredObject>().Select(o => o.ObjectId), restoredBollards = missing.Length,
            trimmedMeshes = changed, removedTrianglesPerAnchor = removed,
            importedCatalogs = plan["catalogs"], note = "Merged copies removed before adding editable bollards; saved player layouts are not rewritten." });
    }
    private static Transform3D RelativePose(Node3D node, Node3D root)
    {
        var pose = node.Transform;
        for (var parent = node.GetParent(); parent is Node3D n && n != root; parent = parent.GetParent()) pose = n.Transform * pose;
        return pose;
    }
    private static ArrayMesh? Trim(Mesh source, Transform3D transform, Aabb[] boxes, int[] removed)
    {
        var result = new ArrayMesh(); bool changed = false;
        for (int surface = 0; surface < source.GetSurfaceCount(); surface++)
        {
            var arrays = source.SurfaceGetArrays(surface);
            if (source is not ArrayMesh arrayMesh || arrayMesh.SurfaceGetPrimitiveType(surface) != Mesh.PrimitiveType.Triangles) throw new InvalidDataException("Merged bollard extraction requires triangle geometry.");
            var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var indices = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, vertices.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            var keep = new List<int>(indices.Length);
            for (int i = 0; i < indices.Length; i += 3)
            {
                var a = transform * vertices[indices[i]]; var b = transform * vertices[indices[i + 1]]; var c = transform * vertices[indices[i + 2]];
                int anchor = Array.FindIndex(boxes, box => box.HasPoint(a) && box.HasPoint(b) && box.HasPoint(c));
                if (anchor >= 0) { removed[anchor]++; changed = true; }
                else { keep.Add(indices[i]); keep.Add(indices[i + 1]); keep.Add(indices[i + 2]); }
            }
            if (keep.Count == 0) continue;
            arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
            result.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            result.SurfaceSetMaterial(result.GetSurfaceCount() - 1, source.SurfaceGetMaterial(surface));
        }
        return changed ? result : null;
    }
}
