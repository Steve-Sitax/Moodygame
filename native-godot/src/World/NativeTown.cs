using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Game;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>The whole town loaded from native scenes. Original source files are never consulted.</summary>
public partial class NativeTown : BakedWorld
{
    private const string Root = "res://world/town";
    private Node3D town = null!;
    private JsonDocument lights = null!;
    private Scheldemist.Town.WalkMap? walk;
    private JsonArray attributes = null!;
    public NativeDistrictLayouts.Result Layouts { get; private set; } = null!;
    public JsonArray LampFacts { get; private set; } = new();
    public override JsonDocument? NativeLights => lights;
    private List<QuayExits.Ladder>? quayLadders;
    public override IReadOnlyList<QuayExits.Ladder>? NativeQuayLadders => quayLadders;
    public override Scheldemist.Town.WalkMap? NativeWalk
    {
        get
        {
            if (walk == null) { walk = NativeWorldNavigation.Build(town, new Rect2(-480, -80, 820, 560)); Ways.InstallNative(walk); }
            return walk;
        }
    }
    public override Error Load(string unused)
    {
        Stage = "read";
        Facts = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(Root + "/facts.json"));
        attributes = JsonNode.Parse(Godot.FileAccess.GetFileAsString(Root + "/attributes.json"))!.AsArray();
        var intake = JsonNode.Parse(Godot.FileAccess.GetFileAsString(Root + "/intake.json"))!;
        foreach (var note in intake["unported"]!.AsArray()) Unported.Add(note!.GetValue<string>());
        Psx.LoadShared(Path.Combine(Scheldemist.Paths.NativeDataRoot!, "maps"));
        Stage = "build";
        town = ResourceLoader.Load<PackedScene>(Root + "/scene.tscn").Instantiate<Node3D>();
        Layouts = NativeDistrictLayouts.Apply(town);
        int eventSnapshots = 0;
        foreach (var snapshot in town.GetChildren().OfType<Node3D>().Where(n => n.HasMeta("source_name") && n.GetMeta("source_name").AsString() == "fire_pump"
            && n.HasMeta("source_node_index") && n.GetMeta("source_node_index").AsInt32() == 13360).ToArray())
        {
            snapshot.Visible = false;
            foreach (var child in All(snapshot)) child.SetMeta("native_replaced_event_snapshot", true);
            eventSnapshots++;
        }
        // Active fires construct their own moving pump. Keep the one-time scene snapshot intact on disk.
        if (eventSnapshots > 0) Unported.Remove("Node1476/Mesh2924");
        // The bake was taken while a house front stood scorched: its soot quad (6.4 m wide, the front's height, 6 cm out from the
        // Poesje's door, drawn opaque black without its smoke texture) stayed in the scene as a one-time snapshot, hiding the front's
        // sign, door and windows and standing as a solid sheet across the street door (issues 110, 111). The town's own soot
        // (TownLife.Fire) draws a burned front when a fire has really happened; the snapshot stays on disk but never shows.
        int sootSnapshots = 0;
        // (dev: --keep-soot leaves the snapshot as the bake has it, for a before-and-after)
        foreach (var soot in town.GetChildren().OfType<Node3D>().Where(n => !Scheldemist.Main.I.Flag("keep-soot") && (n.Name == "soot" || n.HasMeta("source_name") && n.GetMeta("source_name").AsString() == "soot")).ToArray())
        {
            soot.Visible = false;
            foreach (var child in All(soot)) child.SetMeta("native_replaced_event_snapshot", true);
            sootSnapshots++;
        }
        // The bake also kept the horse model parts the pool's copies were made from (second "horses" group: whole mesh parts at the
        // origin, legs hanging below the quay). The pool draws its own copies; the template stays on disk but never shows.
        int horseTemplates = 0;
        foreach (var template in town.GetChildren().OfType<Node3D>().Where(n => n.HasMeta("source_name") && n.GetMeta("source_name").AsString() == "horses"
            && n.GetChildren().OfType<MeshInstance3D>().Any(m => m.Name == "horse_body")).ToArray())
        {
            template.Visible = false;
            foreach (var child in All(template)) child.SetMeta("native_replaced_event_snapshot", true);
            horseTemplates++;
        }
        // The Werf's ground chunk hangs a kerb and an apron out over the water, over the inner treads of its stone flight (issue 68).
        // Its footprint is cut out of the mesh, so what is drawn, what is walked on and what is solid agree with the steps.
        // (dev: --no-werf-cut leaves the ground as the bake has it, for a before-and-after)
        int werfCut = Scheldemist.Main.I.Flag("no-werf-cut") ? 0 : QuayNotch.Cut(town, "city_-4_0_3", QuayExits.WerfFrame, QuayExits.WerfNotchS0, QuayExits.WerfNotchS1, QuayExits.WerfNotchU0, QuayExits.WerfNotchU1);
        // The baked quay ladders ran through the coping and into the stone (issue 85): the native ladder replaces them.
        var ladders = Scheldemist.Native.World.NativeQuayLadders.Install(town);
        quayLadders = ladders.Ladders;
        foreach (var note in ladders.Notes) GD.Print("quay ladders: " + note);
        AddChild(town);
        Report["werfStepsCutTriangles"] = werfCut;
        Report["source"] = "complete native Godot town";
        Report["quayLadders"] = ladders.Ladders.Count;
        Report["quayLadderMeshes"] = ladders.Meshes;
        Report["quayLadderOldTriangles"] = ladders.RemovedTriangles;
        Report["quayLadderMs"] = ladders.Ms;
        Report["sourceSha256"] = intake["sourceSha256"]!.GetValue<string>();
        Report["authoredObjects"] = Layouts.ObjectCount;
        Report["districts"] = Layouts.Districts.Count;
        Report["replacedEventSnapshots"] = eventSnapshots;
        Report["hiddenHorseTemplates"] = horseTemplates;
        Report["hiddenSootSnapshots"] = sootSnapshots;
        Stage = "done";
        return Error.Ok;
    }
    public override void _Ready()
    {
        // Authored objects arrive with editor materials, which the game's fog and light never reach (issue 79).
        var authoredMaterials = new NativeTownMaterials(); authoredMaterials.Apply(town);
        Report["authoredMaterialsSwapped"] = authoredMaterials.Swapped; Report["authoredMaterialsLeft"] = authoredMaterials.Left;
        var registered = new HashSet<ulong>();
        foreach (var node in All(town))
        {
            if (node is StaticBody3D body) { body.CollisionLayer = node.HasMeta("native_replaced_event_snapshot") ? 0 : Solid.Layer; body.CollisionMask = 0; }
            if (node is CollisionShape3D shape && node.HasMeta("native_replaced_event_snapshot")) shape.Disabled = true;
            if (node is AuthoredObject authored) authored.SetMeta("native_collision", true);
            if (node is WorkshopLamp lamp)
            {
                lamp.SetNight(true);
                if (lamp.GetNodeOrNull<OmniLight3D>("Light") is { } light) light.Visible = false;
            }
            // Each editable lamp must own its changing glass/flame material, even when all copies share a mesh.
            if (node is AuthoredObject lampObject)
                foreach (var mesh in All(lampObject).OfType<MeshInstance3D>().Where(m => m.Mesh != null))
                    for (int surface = 0; surface < mesh.Mesh!.GetSurfaceCount(); surface++)
                        if (mesh.GetActiveMaterial(surface) is ShaderMaterial material && material.ResourceName is "glass" or "flame")
                            mesh.SetSurfaceOverrideMaterial(surface, (Material)material.Duplicate());
            var nativeMesh = (node as MeshInstance3D)?.Mesh ?? (node as MultiMeshInstance3D)?.Multimesh?.Mesh;
            if (nativeMesh == null) continue;
            if (nativeMesh.GetSurfaceCount() == 0 && node is GeometryInstance3D empty) empty.Visible = false;
            for (int i = 0; i < nativeMesh.GetSurfaceCount(); i++)
            {
                if (nativeMesh.SurfaceGetMaterial(i) is not ShaderMaterial material) continue;
                var shader = material.Shader;
                if (shader.HasMeta("native_psx_kind") && registered.Add(shader.GetInstanceId()))
                    Psx.RegisterNative(shader, JsonSerializer.Deserialize<Psx.Kind>(shader.GetMeta("native_psx_kind").AsString()));
            }
        }
        Solid.Leave.Add(n => n.HasMeta("native_author_district"));
        Solid.Leave.Add(n => n.HasMeta("native_replaced_event_snapshot"));
        Solid.Leave.Add(n => n.HasMeta(Scheldemist.Native.World.NativeQuayLadders.LeaveMeta));
        BuildLights();
    }
    private void BuildLights()
    {
        var data = JsonNode.Parse(Godot.FileAccess.GetFileAsString(Root + "/lights.json"))!;
        var spill = data["spill"]!.AsArray();
        var template = spill.First(s => s!["kind"]!.GetValue<string>() == "lamp")!.DeepClone();
        var review = Layouts.Districts.Single(d => d.District.Id == NativeDistrictLayouts.ReviewedDistrict);
        var bounds = review.District.Bounds;
        // The six source lamps in this reviewed patch were replaced by the authored complete layout.
        data["spill"] = new JsonArray(spill.Where(s => s!["kind"]!.GetValue<string>() != "lamp" || !bounds.HasPoint(new Vector2(s["at"]![0]!.GetValue<float>(), s["at"]![2]!.GetValue<float>()))).Select(s => s!.DeepClone()).ToArray());
        foreach (var district in Layouts.Districts)
            foreach (var authored in district.Objects.GetChildren().OfType<AuthoredObject>())
                if (All(authored).OfType<WorkshopLamp>().FirstOrDefault()?.GetNodeOrNull<OmniLight3D>("Light") is { } light)
                {
                    var source = template.DeepClone(); var p = light.GlobalPosition;
                    source["at"] = new JsonArray(p.X, p.Y, p.Z);
                    source["id"] = "authored:" + district.District.Id + "/" + authored.ObjectId;
                    source["label"] = "authored gas lamp " + district.District.Id + "/" + authored.ObjectId;
                    data["spill"]!.AsArray().Add(source);
                }
        LampFacts = new JsonArray(data["spill"]!.AsArray().Where(s => s!["kind"]!.GetValue<string>() == "lamp")
            .Select(s => {
                string label = s!["label"]!.GetValue<string>();
                string id = s["id"]?.GetValue<string>() ?? (label.StartsWith("gas lamp ", StringComparison.Ordinal) ? label[9..] : "");
                return new JsonObject { ["id"] = id, ["x"] = s["at"]![0]!.DeepClone(), ["z"] = s["at"]![2]!.DeepClone(), ["hung"] = s["power"]!.GetValue<double>() <= 9 };
            }).Where(l => l["id"]!.GetValue<string>() != "").Select(l => (JsonNode)l).ToArray());
        lights = JsonDocument.Parse(data.ToJsonString());
    }
    public override float[]? Attribute(string name, string attr, int nth = 0)
    {
        var row = attributes.FirstOrDefault(n => n!["node"]!.GetValue<string>() == name && n["attribute"]!.GetValue<string>() == attr && n["nth"]!.GetValue<int>() == nth);
        if (row == null) return null;
        var bytes = Godot.FileAccess.GetFileAsBytes(row["path"]!.GetValue<string>());
        var floats = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, floats, 0, bytes.Length); return floats;
    }
}
