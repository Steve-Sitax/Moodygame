using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;

namespace Scheldemist.Native.Recovery;

/// <summary>One-time conversion. The game loads the resulting native resources, never this source GLB.</summary>
public partial class TownRecovery : Node
{
    private string output = "";
    private readonly HashSet<ulong> savedResources = new();
    private int resources, collisions, copies;
    private readonly List<string> notes = new();
    private readonly List<object> checks = new();
    private readonly Dictionary<int, Material> materials = new();
    private readonly Dictionary<ulong, Material> replacements = new();
    private readonly Dictionary<ulong, Texture2D> mipmapped = new();

    public override void _Ready()
    {
        try
        {
            if (Scheldemist.Native.Game.NativeArguments.Arg("promote") != "")
            {
                RecoveryRefresh.Promote(Scheldemist.Native.Game.NativeArguments.Arg("promote"), Scheldemist.Native.Game.NativeArguments.Arg("target-district"));
                GetTree().Quit(); return;
            }
            if (Scheldemist.Native.Game.NativeArguments.Arg("fixture") != "") RecoveryFixture.Write(Scheldemist.Native.Game.NativeArguments.Arg("fixture"), Scheldemist.Native.Game.NativeArguments.Arg("fixture-id"));
            Recover(); GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
    private static Vector3 Vec(JsonNode node) => new(node[0]!.GetValue<float>(), node[1]!.GetValue<float>(), node[2]!.GetValue<float>());
    private void Check(bool pass, string check)
    {
        checks.Add(new { check, pass }); if (!pass) throw new InvalidOperationException("Recovery check failed: " + check);
    }
    public static IEnumerable<Node> Nodes(Node node)
    {
        yield return node;
        foreach (var child in node.GetChildren()) foreach (var descendant in Nodes(child)) yield return descendant;
    }
    private void Save(Resource resource, string path)
    {
        var error = ResourceSaver.Save(resource, path, ResourceSaver.SaverFlags.Compress | ResourceSaver.SaverFlags.ChangePath);
        if (error != Error.Ok) throw new IOException($"Cannot save {path}: {error}");
        resource.TakeOverPath(path);
    }
    private void Externalize(Resource resource)
    {
        if (!savedResources.Add(resource.GetInstanceId())) return;
        if (resource is Material material)
        {
            foreach (var property in material.GetPropertyList())
            {
                if (property["type"].AsInt32() != (int)Variant.Type.Object) continue;
                if (material.Get(property["name"].AsStringName()).AsGodotObject() is Texture2D texture) Externalize(texture);
            }
        }
        if (resource is Mesh mesh)
            for (int i = 0; i < mesh.GetSurfaceCount(); i++) if (mesh.SurfaceGetMaterial(i) is { } surface) Externalize(surface);
        Save(resource, output + "/resources/r" + resources++.ToString("D4") + ".res");
    }
    internal PackedScene Scene(Node root, string path)
    {
        foreach (var node in Nodes(root).Skip(1)) node.Owner = root;
        foreach (var mesh in Nodes(root).OfType<MeshInstance3D>())
        {
            if (mesh.Mesh != null) Externalize(mesh.Mesh);
            if (mesh.MaterialOverride != null) Externalize(mesh.MaterialOverride);
            for (int i = 0; i < mesh.GetSurfaceOverrideMaterialCount(); i++) if (mesh.GetSurfaceOverrideMaterial(i) is { } material) Externalize(material);
        }
        foreach (var collision in Nodes(root).OfType<CollisionShape3D>()) if (collision.Shape != null) Externalize(collision.Shape);
        var packed = new PackedScene(); var result = packed.Pack(root);
        if (result != Error.Ok) throw new IOException("Cannot pack native scene: " + result);
        Save(packed, path); return packed;
    }
    private void ConvertMaterials(RecoveryGlb source, GltfState state, bool standardPack)
    {
        var imported = state.GetMaterials();
        foreach (var pair in source.MaterialMap)
        {
            var original = source.Json["materials"]![pair.Key]!;
            var material = imported[pair.Value]; materials[pair.Key] = material;
            material.SetMeta("legacy_material_index", pair.Key);
            material.SetMeta("legacy_extras_json", original["extras"]?.ToJsonString() ?? "{}");
            var three = original["extras"]?["three"];
            var psx = original["extras"]?["psx"];
            if (three == null && standardPack)
            {
                bool blended = original["alphaMode"]?.GetValue<string>() == "BLEND";
                three = new JsonObject { ["type"] = "Standard glTF", ["side"] = original["doubleSided"]?.GetValue<bool>() == true ? 2 : 0,
                    ["visible"] = true, ["colorWrite"] = true, ["transparent"] = blended, ["depthWrite"] = !blended,
                    ["vertexColors"] = material is BaseMaterial3D importedMaterial && importedMaterial.VertexColorUseAsAlbedo };
                material.SetMeta("native_gltf_material", true);
            }
            if (psx != null) notes.Add($"Material {pair.Key}: browser PSX switches retained as metadata; native StandardMaterial3D appearance is provisional.");
            if (three == null) { material.SetMeta("legacy_unported", true); notes.Add($"Material {pair.Key}: source shader is not described; its mesh is hidden for review."); continue; }
            if (material is not BaseMaterial3D standard) continue;
            foreach (var property in standard.GetPropertyList())
            {
                if (property["type"].AsInt32() != (int)Variant.Type.Object) continue;
                string name = property["name"].AsString();
                if (standard.Get(name).AsGodotObject() is Texture2D texture) standard.Set(name, Mipmapped(texture));
            }
            standard.TextureFilter = BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic;
            standard.CullMode = three["side"]?.GetValue<int>() switch { 1 => BaseMaterial3D.CullModeEnum.Front, 2 => BaseMaterial3D.CullModeEnum.Disabled, _ => BaseMaterial3D.CullModeEnum.Back };
            standard.VertexColorUseAsAlbedo = three["vertexColors"]?.GetValue<bool>() ?? false;
            if (three["visible"]?.GetValue<bool>() == false || three["colorWrite"]?.GetValue<bool>() == false) material.SetMeta("legacy_hidden", true);
            standard.SetMeta("legacy_no_collision", three["transparent"]?.GetValue<bool>() == true || three["depthWrite"]?.GetValue<bool>() == false);
            int atlas = psx?["bake"]?["atlas"]?.GetValue<int>() ?? 0;
            if (atlas > 0)
            {
                if (standard.AlbedoTexture == null) throw new InvalidDataException("Atlas material has no texture: " + pair.Key);
                var native = new ShaderMaterial { Shader = ResourceLoader.Load<Shader>("res://shaders/recovered_atlas.gdshader"), ResourceName = standard.ResourceName };
                native.SetShaderParameter("albedo_tex", standard.AlbedoTexture);
                native.SetShaderParameter("albedo_color", standard.AlbedoColor);
                native.SetShaderParameter("atlas_grid", atlas);
                native.SetShaderParameter("uv_transform", new Vector4(standard.Uv1Scale.X, standard.Uv1Scale.Y, standard.Uv1Offset.X, standard.Uv1Offset.Y));
                native.SetShaderParameter("alpha_cut", three["alphaTest"]?.GetValue<float>() ?? 0);
                native.SetShaderParameter("use_vertex_color", standard.VertexColorUseAsAlbedo);
                foreach (var key in standard.GetMetaList()) native.SetMeta(key, standard.GetMeta(key));
                replacements.Add(standard.GetInstanceId(), native); materials[pair.Key] = native;
                notes.Add($"Material {pair.Key}: UV2 atlas cells recovered with a standalone native atlas shader.");
            }
            else
            {
                var wrap = RecoverySampler.Modes(source.Json, original);
                if (standard.AlbedoTexture != null && (wrap.u != wrap.v || wrap.u == 33648))
                {
                    var native = RecoverySampler.Create(standard, wrap.u, wrap.v);
                    replacements.Add(standard.GetInstanceId(), native); materials[pair.Key] = native;
                    notes.Add($"Material {pair.Key}: independent glTF sampler axes preserved ({wrap.u}, {wrap.v}).");
                }
            }
        }
    }
    private Texture2D Mipmapped(Texture2D texture)
    {
        if (mipmapped.TryGetValue(texture.GetInstanceId(), out var cached)) return cached;
        var image = texture.GetImage();
        if (image == null || image.HasMipmaps()) return mipmapped[texture.GetInstanceId()] = texture;
        if (image.IsCompressed() && image.Decompress() != Error.Ok) throw new IOException("Cannot decompress a recovery texture.");
        if (image.GenerateMipmaps() != Error.Ok) throw new IOException("Cannot generate native texture mipmaps.");
        var made = ImageTexture.CreateFromImage(image); made.ResourceName = texture.ResourceName;
        return mipmapped[texture.GetInstanceId()] = made;
    }
    private bool Solid(MeshInstance3D mesh)
    {
        if (!mesh.Visible || mesh.Mesh == null) return false;
        for (int i = 0; i < mesh.Mesh.GetSurfaceCount(); i++)
        {
            var material = mesh.GetActiveMaterial(i);
            if (material != null && !material.HasMeta("legacy_unported") && !material.HasMeta("legacy_hidden")
                && (!material.HasMeta("legacy_no_collision") || !material.GetMeta("legacy_no_collision").AsBool())) return true;
        }
        return false;
    }
    private void AddCollision(MeshInstance3D mesh, uint layer)
    {
        if (!Solid(mesh) || mesh.Mesh == null || mesh.Mesh.GetFaces().Length == 0) return;
        var body = new StaticBody3D { Name = "Solid", CollisionLayer = layer, CollisionMask = 0 };
        var shape = mesh.Mesh.HasMeta("native_iron_detail") ? RecoveryIron.Collider(mesh.Mesh) : mesh.Mesh.CreateTrimeshShape(); shape.BackfaceCollision = true;
        body.AddChild(new CollisionShape3D { Name = "Shape", Shape = shape }); mesh.AddChild(body); collisions++;
    }
    private void Recover()
    {
        string sourceFile = Path.GetFullPath(Scheldemist.Native.Game.NativeArguments.Arg("source"));
        string planFile = ProjectSettings.GlobalizePath(Scheldemist.Native.Game.NativeArguments.Arg("plan", "res://recovery/rijnkaai.json"));
        var plan = JsonNode.Parse(File.ReadAllText(planFile))!.AsObject();
        string id = plan["id"]!.GetValue<string>();
        if (!LayoutDocument.ValidId(id)) throw new InvalidDataException("Invalid district id.");
        output = "res://recovered/" + id;
        string absolute = ProjectSettings.GlobalizePath(output);
        // Refuse regeneration: it would erase native edits. Use a new district id for another snapshot.
        if (Directory.Exists(absolute)) throw new IOException("The recovered district already exists. Keep its edits and use a new plan id: " + id);
        var info = new FileInfo(sourceFile); long originalLength = info.Length; var originalTime = info.LastWriteTimeUtc;
        var facts = plan["modelPack"]?.GetValue<bool>() == true ? new JsonObject { ["instances"] = new JsonObject() }
            : JsonNode.Parse(File.ReadAllText(Path.ChangeExtension(sourceFile, ".json")))!.AsObject();
        var bounds = plan["bounds"]!;
        var boundary = new Rect2(bounds[0]!.GetValue<float>(), bounds[1]!.GetValue<float>(), bounds[2]!.GetValue<float>(), bounds[3]!.GetValue<float>());
        if (!boundary.Position.IsFinite() || !boundary.Size.IsFinite() || boundary.Size.X <= 0 || boundary.Size.Y <= 0) throw new InvalidDataException("Invalid recovery boundary.");
        using var source = new RecoveryGlb(sourceFile, facts, boundary);
        source.Select(plan);
        // Keep the temporary GLB out of the project's import scan and never write beside the source.
        string temporary = ProjectSettings.GlobalizePath("res://proof/recover-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary); File.WriteAllText(Path.Combine(temporary, ".gdignore"), "");
        string slice = Path.Combine(temporary, "slice.glb"); source.WriteSlice(slice);
        GD.Print($"Recovery: {source.Picks.Count} roots, {new FileInfo(slice).Length / 1048576.0:F1} MB selected from {originalLength / 1048576.0:F1} MB.");
        var document = new GltfDocument();
        var state = new GltfState { HandleBinaryImageMode = GltfState.HandleBinaryImageModeEnum.EmbedAsUncompressed };
        var error = document.AppendFromFile(slice, state);
        if (error != Error.Ok) throw new IOException("Godot could not import the selected GLB: " + error);
        var imported = document.GenerateScene(state) ?? throw new IOException("Godot generated no recovery scene.");
        ConvertMaterials(source, state, plan["modelPack"]?.GetValue<bool>() == true);
        Directory.CreateDirectory(Path.Combine(absolute, "resources")); Directory.CreateDirectory(Path.Combine(absolute, "props"));
        if (id.StartsWith("recovery-fixture-", StringComparison.Ordinal)) File.WriteAllText(Path.Combine(absolute, ".gdignore"), "");
        var district = new Node3D { Name = "Rijnkaai" };
        var scenery = new Node3D { Name = "Scenery" }; var objects = new Node3D { Name = "Objects" };
        district.AddChild(scenery); district.AddChild(objects);
        var working = new Node3D { Name = "RecoveryWork" }; district.AddChild(working);
        var catalog = new AuthorCatalog();
        var definitions = plan["modelAssets"] as JsonArray ?? new JsonArray();
        var definedIds = definitions.Select(a => a!["id"]!.GetValue<string>()).ToHashSet();
        foreach (var asset in ResourceLoader.Load<AuthorCatalog>("res://assets/library/catalog.tres").Assets)
            if (!definedIds.Contains(asset.Id)) catalog.Assets.Add(asset);
        var identities = RecoveryRefresh.MatchIdentities(source.Picks, plan);
        try
        {
            foreach (var pick in source.Picks)
            {
                var model = imported.FindChild("recover_" + pick.Index, true, false) as Node3D;
                if (model == null && imported.Name == "recover_" + pick.Index) model = imported as Node3D;
                if (model == null) throw new IOException("Imported source node is missing: " + pick.Index);
                foreach (var node in Nodes(model)) node.Owner = null;
                model.GetParent()?.RemoveChild(model);
                var root = new Node3D { Name = "source_" + pick.Index, Transform = model.Transform };
                model.Transform = Transform3D.Identity; root.AddChild(model); working.AddChild(root);
                root.SetMeta("source_node_index", pick.Index); root.SetMeta("source_name", pick.Name);
                foreach (int i in source.Descendants(pick.Index))
                {
                    var original = source.Json["nodes"]![i]!;
                    var node = root.FindChild("recover_" + i, true, false) as Node3D;
                    if (node == null) continue;
                    node.SetMeta("source_node_index", i); node.SetMeta("source_name", original["name"]?.GetValue<string>() ?? "");
                    node.SetMeta("legacy_extras_json", original["extras"]?.ToJsonString() ?? "{}");
                    if (original["extras"]?["hidden"]?.GetValue<bool>() == true) node.Visible = false;
                    if (node is not MeshInstance3D mesh || mesh.Mesh == null) continue;
                    for (int surface = 0; surface < mesh.Mesh.GetSurfaceCount(); surface++)
                        if (mesh.Mesh.SurfaceGetMaterial(surface) is { } current && replacements.TryGetValue(current.GetInstanceId(), out var replacement))
                            mesh.Mesh.SurfaceSetMaterial(surface, replacement);
                    if (original["name"]?.GetValue<string>() == "quay_coping")
                    {
                        mesh.Mesh = RecoveryCoping.Build(source, i, mesh.Mesh.SurfaceGetMaterial(0));
                        notes.Add("Coping uses full-precision projected UVs and a 12-strip, 50 mm rounded nose.");
                    }
                    if (original["name"]?.GetValue<string>() is "bollard_cannon" or "bollard_mushroom")
                        mesh.Mesh = RecoveryIron.Build(mesh.Mesh);
                    bool hidden = Enumerable.Range(0, mesh.Mesh.GetSurfaceCount()).Any(s => mesh.Mesh.SurfaceGetMaterial(s)?.HasMeta("legacy_unported") == true);
                    bool invisible = Enumerable.Range(0, mesh.Mesh.GetSurfaceCount()).All(s => mesh.Mesh.SurfaceGetMaterial(s)?.HasMeta("legacy_hidden") == true);
                    mesh.Visible &= !hidden && !invisible;
                    if (source.Instances(i) is { } instances)
                    {
                        ExpandInstances(mesh, instances, boundary, pick.Kind == "ground" ? 1u : 2u);
                        mesh.Visible = false;
                    }
                    else if (pick.Name != "ground_seams" && Nodes(root).Where(n => n == node || n.IsAncestorOf(node)).OfType<Node3D>().All(n => n.Visible))
                        AddCollision(mesh, pick.Kind == "ground" ? 1u : 2u);
                }
                if (pick.Kind != "prop") { working.RemoveChild(root); scenery.AddChild(root); continue; }
                var pose = root.Transform; root.Transform = Transform3D.Identity;
                if (pick.Name == "gas_lamp") AddLamp(root);
                var box = LocalBounds(root);
                var definition = definitions.FirstOrDefault(a => a!["node"]!.GetValue<string>() == pick.Name);
                string assetId = definition?["id"]?.GetValue<string>() ?? identities.GetValueOrDefault(pick.Index, "town-node-" + pick.Index);
                var packed = Scene(root, output + "/props/" + assetId + ".tscn");
                var asset = new AuthorAsset { Id = assetId, Title = definition?["title"]?.GetValue<string>() ?? (pick.Name == "gas_lamp" ? "Recovered gas lamp · " + pick.Index : "Recovered bollard · " + pick.Index),
                    Category = definition?["category"]?.GetValue<string>() ?? "Recovered quay", Scene = packed, Footprint = box.Size.Max(new Vector3(0.1f, 0.1f, 0.1f)),
                    FootprintOffset = new Vector3(box.GetCenter().X, box.Position.Y, box.GetCenter().Z) };
                Save(asset, output + "/props/" + assetId + ".tres"); catalog.Assets.Add(asset);
                var wrapper = new AuthoredObject { Name = "object_" + assetId, ObjectId = assetId, Asset = asset, Transform = pose };
                objects.AddChild(wrapper); root.Free();
            }
            working.Free();
            var refreshed = RecoveryRefresh.Apply(this, district, catalog, plan, output);
            Save(catalog, output + "/catalog.tres");
            var nativeScene = Scene(district, output + "/district.tscn");
            var settings = new AuthorDistrict { Id = id, Title = plan["title"]!.GetValue<string>(), Scene = nativeScene, Catalog = catalog,
                Bounds = boundary, WalkSpawn = Vec(plan["walkSpawn"]!), FlySpawn = Vec(plan["flySpawn"]!),
                FlyYaw = plan["flyYaw"]!.GetValue<float>(), FlyPitch = plan["flyPitch"]!.GetValue<float>() };
            settings.Validate(); Save(settings, output + "/district.tres");
            Check(source.Picks.Count > 0, "source selection contains geometry");
            Check(collisions > 0, "native collision was generated from recovered meshes");
            var reloaded = ResourceLoader.Load<PackedScene>(output + "/district.tscn", cacheMode: ResourceLoader.CacheMode.Ignore).Instantiate<Node3D>();
            try
            {
                Check(reloaded.GetNode<Node3D>("Objects").GetChildren().OfType<AuthoredObject>().Count() == objects.GetChildCount(), "native district reload preserves every authored prop");
                Check(Nodes(reloaded).OfType<MeshInstance3D>().All(m => m.Mesh != null && m.Mesh.ResourcePath.StartsWith(output + "/resources/")), "scenery meshes reference saved native resources");
            }
            finally { reloaded.Free(); }
            var dependencies = Directory.GetFiles(absolute, "*.tscn", SearchOption.AllDirectories).SelectMany(File.ReadLines).ToArray();
            Check(!dependencies.Any(line => line.Contains(".glb") || line.Contains("BakedWorld") || line.Contains("town.json") || line.Contains(temporary)), "saved scenes have no browser or source bake dependency");
            info.Refresh(); Check(info.Length == originalLength && info.LastWriteTimeUtc == originalTime, "source GLB was not modified during recovery");
            using var fingerprint = new FileStream(sourceFile, FileMode.Open, System.IO.FileAccess.Read, FileShare.ReadWrite);
            string hash = Convert.ToHexString(SHA256.HashData(fingerprint)).ToLowerInvariant();
            var report = new { version = 1, district = id, source = new { path = sourceFile, bytes = originalLength, modifiedUtc = originalTime, sha256 = hash, factsMade = facts["made"]?.GetValue<string>() },
                plan, selected = source.Picks.Select(p => new { index = p.Index, name = p.Name, kind = p.Kind,
                    id = p.Kind == "prop" ? identities.GetValueOrDefault(p.Index, definitions.FirstOrDefault(a => a!["node"]!.GetValue<string>() == p.Name)?["id"]?.GetValue<string>() ?? "town-node-" + p.Index) : null,
                    transform = RecoveryGlb.Matrix(p.Transform) }).Cast<object>().Concat(refreshed.Anchors),
                refresh = refreshed.Evidence,
                materials = source.MaterialMap.Keys.Select(i => new { index = i, extras = source.Json["materials"]![i]!["extras"] }),
                instances = source.NodeMap.Keys.Where(i => source.Instances(i) != null).Select(i => new { index = i, data = source.Instances(i) }),
                collisions, copies, resources, checks, notes = source.Notes.Concat(notes).Distinct(),
                remaining = new[] { "Browser-specific PSX, wetness, relief, water and decal effects require native rendering work; PSX-only auxiliary texture references remain metadata in the report, not imported native maps.",
                    "Merged source meshes remain scenery chunks; individual object boundaries cannot be recovered from missing data.",
                    "Scenery intersecting this boundary retains its complete geometry, including parts outside it.",
                    "Rooms, openings, dynamic boats, bridges, actors, navigation and game services are outside this static recovery plan." } };
            File.WriteAllText(Path.Combine(absolute, "recovery-report.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"Recovery PASS: {objects.GetChildCount()} editable props, {collisions} colliders, {resources} native resources. {absolute}");
        }
        finally { district.Free(); imported.Free(); }
    }
    private void ExpandInstances(MeshInstance3D source, JsonObject data, Rect2 bounds, uint layer)
    {
        int count = data["count"]!.GetValue<int>(); var matrices = data["m"]!.AsArray(); var colors = data["c"] as JsonArray;
        if (count < 0 || count > 100000 || matrices.Count != count * 16 || (colors != null && colors.Count != count * 3)) throw new InvalidDataException("Invalid instance data.");
        // Instances are children of a sibling container, so hiding the exported prototype does not hide them.
        var group = new Node3D { Name = source.Name + "_copies", Transform = source.Transform, Visible = source.Visible };
        source.GetParent().AddChild(group);
        for (int i = 0; i < count; i++)
        {
            var m = new JsonArray(matrices.Skip(i * 16).Take(16).Select(n => n!.DeepClone()).ToArray());
            var transform = RecoveryGlb.Transform(new() { ["matrix"] = m });
            var global = group.Transform * transform;
            // Selection already uses full world transforms; here the recovered root may not be in a SceneTree.
            for (Node? parent = group.GetParent(); parent is Node3D ancestor; parent = parent.GetParent()) global = ancestor.Transform * global;
            var box = global * source.Mesh!.GetAabb();
            if (!bounds.Intersects(new Rect2(box.Position.X, box.Position.Z, Math.Max(box.Size.X, 0.001f), Math.Max(box.Size.Z, 0.001f)), true)) continue;
            var copy = new MeshInstance3D { Name = "copy_" + i, Mesh = source.Mesh, Transform = transform };
            copy.SetMeta("source_instance_index", i); group.AddChild(copy);
            if (colors != null)
            {
                var color = new Color(colors[i * 3]!.GetValue<float>(), colors[i * 3 + 1]!.GetValue<float>(), colors[i * 3 + 2]!.GetValue<float>());
                for (int surface = 0; surface < copy.Mesh.GetSurfaceCount(); surface++)
                    if (copy.Mesh.SurfaceGetMaterial(surface)?.Duplicate() is BaseMaterial3D material)
                    { material.AlbedoColor *= color; copy.SetSurfaceOverrideMaterial(surface, material); }
            }
            AddCollision(copy, layer); copies++;
        }
    }
    internal static Aabb LocalBounds(Node3D root)
    {
        Aabb? bounds = null;
        void Visit(Node3D node, Transform3D parent)
        {
            var transform = node == root ? Transform3D.Identity : parent * node.Transform;
            if (node is MeshInstance3D { Mesh: not null } mesh)
            { var b = transform * mesh.Mesh.GetAabb(); bounds = bounds == null ? b : bounds.Value.Merge(b); }
            foreach (var child in node.GetChildren().OfType<Node3D>()) Visit(child, transform);
        }
        Visit(root, Transform3D.Identity); return bounds ?? new Aabb(Vector3.Zero, Vector3.One);
    }
    private static void AddLamp(Node3D root)
    {
        var lamp = new WorkshopLamp { Name = "NativeLamp" }; root.AddChild(lamp);
        lamp.AddChild(new OmniLight3D { Name = "Light", Position = new(0, 3.5f, 0), LightColor = new Color(1, 0.68f, 0.32f), LightEnergy = 2, OmniRange = 9 });
        lamp.AddChild(new MeshInstance3D { Name = "Flame", Position = new(0, 3.5f, 0), Mesh = new SphereMesh { Radius = 0.045f, Height = 0.14f },
            MaterialOverride = new StandardMaterial3D { ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded, AlbedoColor = new Color(1, 0.78f, 0.36f) } });
    }
}
