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
    public const string InteriorDirectory = "res://world/interiors";
    /// <summary>Authenticated host layouts apply only to this visit. Never save them over the editor's own files.</summary>
    public static IReadOnlyDictionary<string, LayoutDocument>? RemoteLayouts { get; set; }
    private static readonly Dictionary<string,AuthorDistrict> descriptors=new(StringComparer.Ordinal);
    private static readonly Dictionary<string,Dictionary<string,AuthorAsset>> libraries=new(StringComparer.Ordinal);
    public static AuthorDistrict Descriptor(string id)
    {
        if(descriptors.TryGetValue(id,out var existing))return existing;
        var district=ResourceLoader.Load<AuthorDistrict>(ResourcePath(id),cacheMode:ResourceLoader.CacheMode.Ignore)
            ??throw new InvalidDataException("Cannot load the native district descriptor: "+id);
        district.Validate();descriptors.Add(id,district);libraries.Add(id,district.Catalog.Index());return district;
    }

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
        return id.StartsWith("room-") ? InteriorDirectory + "/" + id + ".tres" : id == ReviewedDistrict ? "res://recovered/" + id + "/district.tres" : DistrictDirectory + "/" + id + ".tres";
    }

    public static string LayoutDirectory(string id)
    {
        if (!LayoutDocument.ValidId(id)) throw new InvalidDataException("Invalid native district id.");
        // Retain the old review command's exact folder semantics. A full-town proof can instead supply an isolated root.
        string reviewedOverride = Scheldemist.Native.Game.NativeArguments.Arg("author-dir");
        if (id == ReviewedDistrict && reviewedOverride != "") return reviewedOverride;
        string root = Scheldemist.Native.Game.NativeArguments.Arg("author-root");
        return root != "" ? Path.Combine(root, id) : ProjectSettings.GlobalizePath("user://layouts/" + id);
    }

    public static IReadOnlyList<AuthorDistrict> Available()
    {
        var paths = new List<string> { ResourcePath(ReviewedDistrict) };
        if (DirAccess.DirExistsAbsolute(InteriorDirectory))
            paths.AddRange(ResourceLoader.ListDirectory(InteriorDirectory).Where(f => f.EndsWith(".tres", StringComparison.Ordinal) && !f.EndsWith(".catalog.tres", StringComparison.Ordinal)).Order(StringComparer.Ordinal).Select(f => InteriorDirectory + "/" + f));
        if (DirAccess.DirExistsAbsolute(DistrictDirectory))
            // Exported text resources are remapped; enumerate their logical editor names.
            paths.AddRange(ResourceLoader.ListDirectory(DistrictDirectory)
                .Where(f => f.EndsWith(".tres", StringComparison.Ordinal))
                .OrderBy(f => f, StringComparer.Ordinal).Select(f => DistrictDirectory + "/" + f));
        var result = new List<AuthorDistrict>(); var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (string path in paths)
        {
            string id=path.EndsWith("/district.tres",StringComparison.Ordinal)?ReviewedDistrict:Path.GetFileNameWithoutExtension(path);
            var district = Descriptor(id);
            district.Validate();
            if (!ids.Add(district.Id)) throw new InvalidDataException("Duplicate native district id: " + district.Id);
            result.Add(district);
        }
        return result;
    }

    public static Result Apply(Node3D town)
    {
        if (town.HasMeta("native_district_layouts")) throw new InvalidOperationException("District layouts are already attached to this town.");
        return Attach(town, Prepare());
    }

    /// <summary>
    /// Every district read and checked, not yet in a town (the town's start reads them while its scene loads, #230).
    /// Prepare every district before mutating the town, so a bad saved file cannot leave a partial overlay.
    /// </summary>
    public static IReadOnlyList<DistrictState> Prepare()
    {
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
                    else if (!OS.HasFeature("native_standalone")&&!HasArgument("scene-seed")&&(HasArgument("author-root")||HasArgument("author-dir"))&&store.Read() is { } saved)
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
            return prepared;
        }
        catch
        {
            foreach (var item in prepared) item.Objects.Free();
            throw;
        }
    }

    /// <summary>The prepared districts laid into the town: a room's into its room, the rest at the top.</summary>
    public static Result Attach(Node3D town, IReadOnlyList<DistrictState> prepared)
    {
        if (town.HasMeta("native_district_layouts")) throw new InvalidOperationException("District layouts are already attached to this town.");
        try
        {
            // every room node by its id, in one walk of the town (and of what is laid into a room after it)
            var rooms = new Dictionary<string, List<Node3D>>(StringComparer.Ordinal);
            void Index(Node from)
            {
                foreach (var n in Scheldemist.World.BakedWorld.All(from).OfType<Node3D>())
                    if (n.HasMeta("extras") && n.GetMeta("extras").AsGodotDictionary().TryGetValue("room", out var r) && r.AsGodotDictionary()["id"].AsString() is var id)
                        (rooms.TryGetValue(id, out var list) ? list : rooms[id] = new()).Add(n);
            }
            if (prepared.Any(item => item.District.RoomId != "")) Index(town);
            foreach (var item in prepared)
            {
                if (item.District.RoomId != "")
                {
                    var room = rooms.GetValueOrDefault(item.District.RoomId, new List<Node3D>()).Single();
                    HideRecovered(room, item.District);
                    if (item.District.RetainedStructure != null) { var retained = item.District.RetainedStructure.Instantiate<Node3D>(); room.AddChild(retained); Index(retained); }
                    room.AddChild(item.Objects);
                    Index(item.Objects);
                }
                else town.AddChild(item.Objects);
            }
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

    public static Node3D ReadSeed(AuthorDistrict district)
    {
        string seedPath = (district.RoomId != "" ? InteriorDirectory : DistrictDirectory) + "/" + district.Id + ".objects.tscn";
        if (ResourceLoader.Exists(seedPath))
            return ResourceLoader.Load<PackedScene>(seedPath).Instantiate<Node3D>();
        // The reviewed scene remains canonical. Detach its Objects child and discard its scenery; never save this scene.
        var scene = district.Scene.Instantiate<Node3D>();
        if(scene.Name=="Objects")return scene;
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

    public static void HideRecovered(Node root, AuthorDistrict district)
    {
        var ids = district.ReplacedMeshes.ToHashSet();
        foreach (var node in Scheldemist.World.BakedWorld.All(root).OfType<Node3D>())
            if (node.HasMeta("source_node_index") && ids.Contains(node.GetMeta("source_node_index").AsInt32()))
            {
                node.Visible = false;
                foreach (var child in Scheldemist.World.BakedWorld.All(node))
                {
                    child.SetMeta("native_replaced_event_snapshot", true);
                    if(child is CollisionObject3D body)body.CollisionLayer=0;
                    if(child is CollisionShape3D shape)shape.Disabled=true;
                }
            }
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
