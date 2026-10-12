using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using Scheldemist.Native.Authoring;

namespace Scheldemist.Native.World;

/// <summary>Attach authored objects to the full native town without copying its scenery or writing player layouts.</summary>
public static class NativeDistrictLayouts
{
    public const string DistrictDirectory = "res://world/districts";
    public const string ReviewedDistrict = "rijnkaai-recovered";
    /// <summary>Authenticated host layouts apply only to this visit. Never save them over the editor's own files.</summary>
    public static IReadOnlyDictionary<string, LayoutDocument>? RemoteLayouts { get; set; }

    public sealed record DistrictState(AuthorDistrict District, Node3D Objects, LayoutStore Store, string LayoutSource)
    {
        public int ObjectCount => Objects.GetChildren().OfType<AuthoredObject>().Count();
    }

    public sealed record Result(IReadOnlyList<DistrictState> Districts)
    {
        public int ObjectCount => Districts.Sum(d => d.ObjectCount);
        public IReadOnlyList<Node3D> Scenes => Districts.Select(d => d.Objects).ToArray();
        public IReadOnlyDictionary<string, string> LayoutSources => Districts.ToDictionary(d => d.District.Id, d => d.LayoutSource);
    }

    public static string ResourcePath(string id)
    {
        if (!LayoutDocument.ValidId(id)) throw new InvalidDataException("Invalid native district id.");
        return id == ReviewedDistrict ? "res://recovered/" + id + "/district.tres" : DistrictDirectory + "/" + id + ".tres";
    }

    public static string LayoutDirectory(string id)
    {
        if (!LayoutDocument.ValidId(id)) throw new InvalidDataException("Invalid native district id.");
        // Retain the old review command's exact folder semantics. A full-town proof can instead supply an isolated root.
        string reviewedOverride = WorkshopSession.Arg("author-dir");
        if (id == ReviewedDistrict && reviewedOverride != "") return reviewedOverride;
        string root = WorkshopSession.Arg("author-root");
        return root != "" ? Path.Combine(root, id) : ProjectSettings.GlobalizePath("user://layouts/" + id);
    }

    public static IReadOnlyList<AuthorDistrict> Available()
    {
        var paths = new List<string> { ResourcePath(ReviewedDistrict) };
        if (DirAccess.DirExistsAbsolute(DistrictDirectory))
            // Exported text resources are remapped; enumerate their logical editor names.
            paths.AddRange(ResourceLoader.ListDirectory(DistrictDirectory)
                .Where(f => f.EndsWith(".tres", StringComparison.Ordinal))
                .OrderBy(f => f, StringComparer.Ordinal).Select(f => DistrictDirectory + "/" + f));
        var result = new List<AuthorDistrict>(); var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (string path in paths)
        {
            var district = ResourceLoader.Load<AuthorDistrict>(path)
                ?? throw new InvalidDataException("Cannot load the native district descriptor: " + path);
            district.Validate();
            if (!ids.Add(district.Id)) throw new InvalidDataException("Duplicate native district id: " + district.Id);
            result.Add(district);
        }
        return result;
    }

    public static Result Apply(Node3D town)
    {
        if (town.HasMeta("native_district_layouts")) throw new InvalidOperationException("District layouts are already attached to this town.");
        // Prepare every district before mutating the town, so a bad saved file cannot leave a partial overlay.
        var prepared = new List<DistrictState>();
        try
        {
            foreach (var district in Available())
            {
                var objects = ReadSeed(district); var assets = district.Catalog.Index();
                try
                {
                    var seed = Capture(district, objects); seed.Validate(district.Id, assets);
                    var store = new LayoutStore(Path.Combine(LayoutDirectory(district.Id), "layout.json"));
                    string source = "scene seed";
                    if (RemoteLayouts is { } remote)
                    {
                        if (!remote.TryGetValue(district.Id, out var shared)) throw new InvalidDataException("The host omitted a district layout: " + district.Id);
                        shared.Validate(district.Id, assets);
                        ReplaceObjects(objects, shared, assets);
                        source = "shared Godot server";
                    }
                    else if (!HasArgument("scene-seed") && store.Read() is { } saved)
                    {
                        saved.Validate(district.Id, assets);
                        ReplaceObjects(objects, saved, assets);
                        source = store.File;
                    }
                    objects.Name = "native_layout_" + district.Id;
                    objects.SetMeta("native_author_district", district.Id);
                    objects.SetMeta("native_author_layout_source", source);
                    foreach (var authored in objects.GetChildren().OfType<AuthoredObject>())
                    {
                        authored.SetMeta("native_author_district", district.Id);
                        authored.SetMeta("native_author_identity", district.Id + "/" + authored.ObjectId);
                    }
                    prepared.Add(new(district, objects, store, source));
                }
                catch { objects.Free(); throw; }
            }
            foreach (var item in prepared) town.AddChild(item.Objects);
            town.SetMeta("native_district_layouts", true);
            return new(prepared);
        }
        catch
        {
            foreach (var item in prepared)
            {
                item.Objects.GetParent()?.RemoveChild(item.Objects);
                item.Objects.Free();
            }
            throw;
        }
    }

    private static bool HasArgument(string flag) => OS.GetCmdlineUserArgs().Any(a => a == "--" + flag);

    private static Node3D ReadSeed(AuthorDistrict district)
    {
        string seedPath = DistrictDirectory + "/" + district.Id + ".objects.tscn";
        if (district.Id != ReviewedDistrict && ResourceLoader.Exists(seedPath))
            return ResourceLoader.Load<PackedScene>(seedPath).Instantiate<Node3D>();
        // The reviewed scene remains canonical. Detach its Objects child and discard its scenery; never save this scene.
        var scene = district.Scene.Instantiate<Node3D>();
        try
        {
            var objects = scene.GetNodeOrNull<Node3D>("Objects")
                ?? throw new InvalidDataException("Native district scene has no Objects node: " + district.Id);
            if (!scene.Transform.IsEqualApprox(Transform3D.Identity) || !objects.Transform.IsEqualApprox(Transform3D.Identity))
                throw new InvalidDataException("District object seeds must use world coordinates: " + district.Id);
            scene.RemoveChild(objects);
            return objects;
        }
        finally { scene.Free(); }
    }

    private static void ReplaceObjects(Node3D root, LayoutDocument document, IReadOnlyDictionary<string, AuthorAsset> assets)
    {
        foreach (var child in root.GetChildren()) { root.RemoveChild(child); child.Free(); }
        foreach (var record in document.Objects)
        {
            var authored = new AuthoredObject { Name = "object_" + record.Id, ObjectId = record.Id, Asset = assets[record.Asset] };
            authored.Pose(record); root.AddChild(authored);
        }
    }

    public static LayoutDocument Capture(AuthorDistrict district, Node3D objects)
    {
        if (objects.GetChildren().Any(n => n is not AuthoredObject))
            throw new InvalidDataException("Only authored object wrappers belong inside a district Objects node: " + district.Id);
        var document = new LayoutDocument { District = district.Id, Objects = objects.GetChildren().OfType<AuthoredObject>().Select(o =>
        {
            if (o.Asset == null) throw new InvalidDataException("An authored object has no library asset: " + o.ObjectId);
            return o.Record();
        }).ToList() };
        document.Validate(district.Id, district.Catalog.Index());
        return document;
    }

    /// <summary>Explicit authoring action only; Apply never calls this. Atomic save retains the previous file.</summary>
    public static void Save(DistrictState state)
    {
        var assets = state.District.Catalog.Index();
        try { state.Store.Read()?.Validate(state.District.Id, assets); }
        catch { state.Store.RefuseWrites(); throw; }
        state.Store.Save(Capture(state.District, state.Objects));
    }
}
