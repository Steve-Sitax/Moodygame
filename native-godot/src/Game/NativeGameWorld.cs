using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Native.Game;

public partial class NativeGameWorld : BakedWorld
{
    private string Visuals => Scheldemist.Main.I.Arg("visuals", "res://game/rijnkaai");
    private Node3D districtScene = null!;
    private AuthorDistrict district = null!;
    private Scheldemist.Town.WalkMap? walk;
    public override Scheldemist.Town.WalkMap? NativeWalk => walk;
    private List<QuayExits.Ladder>? quayLadders;
    public override IReadOnlyList<QuayExits.Ladder>? NativeQuayLadders => quayLadders;
    public override bool ContainsPlayPoint(double x, double z) => district.Bounds.HasPoint(new Vector2((float)x, (float)z));
    public void BuildNavigation() => walk = Scheldemist.Town.WalkMap.FromNative(district.Bounds, GetWorld3D().DirectSpaceState, Solid.Layer);
    public override bool SupportsJob(Scheldemist.Net.Job job)
    {
        // Do not let a district playtest accept work whose destination or required system is absent.
        var task = Scheldemist.Play.JobTask.Of(job);
        bool Spot(string id) => Scheldemist.Play.Spots.All.TryGetValue(id, out var spot) && ContainsPlayPoint(spot.X, spot.Z) && walk?.Free(spot.X, spot.Z) == true;
        return task != null && !task.Cart && task.Kind switch
        {
            "carry" => Spot(task.From) && Spot(task.To),
            "watch" => Spot(task.Post),
            // Deliveries may require ships, recipient spawning and routes outside this district.
            _ => false
        };
    }
    private JsonDocument lights = null!;
    public override JsonDocument? NativeLights => lights;
    public string LayoutSource { get; private set; } = "scene seed";
    public int AuthoredCount => districtScene.GetNode("Objects").GetChildCount();
    /// <summary>How many objects the saved layout in use holds (null: the committed scene seed is in use, which holds 14).</summary>
    public int? LayoutObjects { get; private set; }
    /// <summary>The authored objects that carry a lamp; each one supplies a live game light.</summary>
    public int AuthoredLamps => districtScene.GetNode("Objects").GetChildren().OfType<AuthoredObject>().Count(o => All(o).OfType<WorkshopLamp>().Any(l => l.GetNodeOrNull<OmniLight3D>("Light") != null));
    private readonly Dictionary<int, ShaderMaterial> materials = new();
    private readonly Dictionary<ulong, ShaderMaterial> surfaceMaterials = new();
    private readonly Dictionary<(ShaderMaterial material, string parameter), Variant> bumpValues = new();
    public void SetBumps(bool enabled)
    {
        foreach (var material in materials.Values.Concat(surfaceMaterials.Values))
            foreach (string parameter in new[] { "bump_scale", "relief_bump", "slab_dome", "wall_hk", "surface_depth" })
            {
                if (material.GetShaderParameter(parameter).VariantType == Variant.Type.Nil) continue;
                var key = (material, parameter);
                if (!bumpValues.ContainsKey(key)) bumpValues[key] = material.GetShaderParameter(parameter);
                material.SetShaderParameter(parameter, enabled ? bumpValues[key] : parameter == "wall_hk" ? Variant.From(new Vector4[4]) : Variant.From(0f));
            }
    }

    public override Error Load(string unused)
    {
        Facts = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(Visuals + "/facts.json")));
        string id = WorkshopSession.Arg("district", "rijnkaai-recovered");
        if (!LayoutDocument.ValidId(id)) throw new InvalidDataException("Invalid district id.");
        var report = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://recovered/" + id + "/recovery-report.json")))!;
        var intake = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(Visuals + "/intake.json")))!;
        if (intake["sourceFingerprint"]?["sha256"]?.GetValue<string>() != report["source"]!["sha256"]!.GetValue<string>())
            throw new InvalidDataException("Game materials belong to a different snapshot. Recover their native visual resources before testing this district.");
        district = ResourceLoader.Load<AuthorDistrict>("res://recovered/" + id + "/district.tres");
        districtScene = district.Scene!.Instantiate<Node3D>();
        string folder = WorkshopSession.Arg("author-dir", ProjectSettings.GlobalizePath("user://layouts/" + district.Id));
        string file = Path.Combine(folder, "layout.json");
        if (!Scheldemist.Main.I.Flag("scene-seed") && File.Exists(file))
        {
            var document = new LayoutStore(file).Read()!; var assets = district.Catalog!.Index(); document.Validate(district.Id, assets);
            var objects = districtScene.GetNode<Node3D>("Objects");
            foreach (var child in objects.GetChildren()) { objects.RemoveChild(child); child.Free(); }
            foreach (var record in document.Objects)
            {
                var authored = new AuthoredObject { Name = "object_" + record.Id, ObjectId = record.Id, Asset = assets[record.Asset] };
                authored.Pose(record); objects.AddChild(authored);
            }
            LayoutSource = file;
            LayoutObjects = document.Objects.Count;
        }
        var table = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(Visuals + "/materials.json")))!.AsObject();
        foreach (var row in table) materials[int.Parse(row.Key)] = ResourceLoader.Load<ShaderMaterial>(row.Value!.GetValue<string>());
        Psx.LoadShared(ProjectSettings.GlobalizePath(Visuals + "/maps"));
        // The bake's quay ladders ran through the coping into the stone (issues 85, 94): the slice draws the town's native ladder too.
        var ladders = Scheldemist.Native.World.NativeQuayLadders.Install(districtScene);
        quayLadders = ladders.Ladders;
        foreach (var note in ladders.Notes) GD.Print("quay ladders: " + note);
        Report["quayLadders"] = ladders.Ladders.Count;
        Report["quayLadderMeshes"] = ladders.Meshes;
        Report["quayLadderOldTriangles"] = ladders.RemovedTriangles;
        Report["quayLadderCollisionShapes"] = ladders.CollisionShapes;
        Report["quayLadderMs"] = ladders.Ms;
        AddChild(districtScene);
        Report["source"] = "native Godot district";
        Report["layout"] = LayoutSource;
        Stage = "done";
        return Error.Ok;
    }

    public override void _Ready()
    {
        var meshes = new Dictionary<ulong, Mesh>();
        foreach (var node in All(districtScene).ToArray())
        {
            if (node.HasMeta("source_name") && node.GetMeta("source_name").AsString() is { Length: > 0 } name) node.Name = name;
            if (node.HasMeta("legacy_extras_json")) node.SetMeta("extras", Godot.Json.ParseString(node.GetMeta("legacy_extras_json").AsString()));
            if (node is StaticBody3D body) { body.CollisionLayer = Solid.Layer; body.CollisionMask = 0; }
            if (node is WorkshopLamp lamp)
            {
                lamp.SetNight(true);
                if (lamp.GetNodeOrNull<OmniLight3D>("Light") is { } light) { light.Visible = false; light.SetMeta("native_preview_only", true); }
            }
            if (node is not MeshInstance3D mesh || mesh.Mesh == null) continue;
            mesh.SetMeta("native_collision", true);
            ulong id = mesh.Mesh.GetInstanceId();
            if (!meshes.TryGetValue(id, out var native)) meshes[id] = native = (Mesh)mesh.Mesh.Duplicate();
            mesh.Mesh = native;
            for (int surface = 0; surface < native.GetSurfaceCount(); surface++)
            {
                var original = native.SurfaceGetMaterial(surface);
                if (original == null) continue;
                if (original is ShaderMaterial detail && original.HasMeta("native_surface_kind") && original.GetMeta("native_surface_kind").AsString() == "cast_iron")
                {
                    if (!surfaceMaterials.TryGetValue(original.GetInstanceId(), out var made)) surfaceMaterials[original.GetInstanceId()] = made = NativeSurfaceMaterials.CastIron(detail);
                    native.SurfaceSetMaterial(surface, made);
                }
                else if (original.HasMeta("legacy_material_index") && !original.HasMeta("native_gltf_material") && materials.TryGetValue(original.GetMeta("legacy_material_index").AsInt32(), out var gameMaterial)) native.SurfaceSetMaterial(surface, gameMaterial);
                else if (original is BaseMaterial3D standard && original.HasMeta("native_gltf_material"))
                {
                    bool blend = IsBlended(standard);
                    native.SurfaceSetMaterial(surface, PsxMaterial(standard, new Psx.Kind(false, blend,
                        standard.Transparency == BaseMaterial3D.TransparencyEnum.AlphaScissor, standard.CullMode == BaseMaterial3D.CullModeEnum.Disabled, !blend, false, 0, standard.VertexColorUseAsAlbedo, false, true), 0, alphaTest: standard.AlphaScissorThreshold));
                }
            }
        }
        // Existing native collision is authoritative. The game's solid service still supplies movement queries.
        Solid.Leave.Add(node => node.HasMeta("native_collision"));
        var river = ResourceLoader.Load<ShaderMaterial>(Visuals + "/river.res");
        var sheet = new MeshInstance3D { Name = "native_river_template", Position = new Vector3(0, Tide.River, 0), Mesh = new PlaneMesh { Size = new Vector2(1200, 1200), Material = river } };
        sheet.SetMeta("native_collision", true); // A water surface is never a solid floor.
        AddChild(sheet);
        BuildLights();
        Report["objects"] = AuthoredCount;
    }

    public static bool IsBlended(BaseMaterial3D material) => material.Transparency is BaseMaterial3D.TransparencyEnum.Alpha or BaseMaterial3D.TransparencyEnum.AlphaDepthPrePass or BaseMaterial3D.TransparencyEnum.AlphaHash;

    private void BuildLights()
    {
        var data = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(Visuals + "/lights.json")))!.AsObject();
        var spill = data["spill"]!.AsArray();
        var template = spill.First(s => s!["kind"]!.GetValue<string>() == "lamp")!.DeepClone();
        data["spill"] = new JsonArray(spill.Where(s => s!["kind"]!.GetValue<string>() != "lamp").Select(s => s!.DeepClone()).ToArray());
        int index = 0;
        foreach (var authored in districtScene.GetNode("Objects").GetChildren().OfType<AuthoredObject>())
        {
            var lamp = All(authored).OfType<WorkshopLamp>().FirstOrDefault();
            if (lamp?.GetNodeOrNull<OmniLight3D>("Light") is not { } light) continue;
            var source = template.DeepClone(); var p = light.GlobalPosition;
            source["at"] = new JsonArray(p.X, p.Y, p.Z); source["label"] = "gas lamp q" + index++;
            data["spill"]!.AsArray().Add(source);
        }
        lights = JsonDocument.Parse(data.ToJsonString());
    }
}
