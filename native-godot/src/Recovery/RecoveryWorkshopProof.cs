using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Native.Authoring;

namespace Scheldemist.Native.Recovery;

public static class RecoveryWorkshopProof
{
    public static async Task Run(WorkshopSession session, string directory, string stage)
    {
        Directory.CreateDirectory(directory); var rows = new List<object>(); string? error = null;
        void Check(bool pass, string check) { rows.Add(new { check, pass }); if (!pass) throw new InvalidOperationException(check); }
        async Task Frames(int count = 6) { for (int i = 0; i < count; i++) await session.ToSignal(session.GetTree(), SceneTree.SignalName.PhysicsFrame); }
        try
        {
            await Frames();
            string reportPath = ProjectSettings.GlobalizePath("res://recovered/" + session.DistrictId + "/recovery-report.json");
            var report = JsonNode.Parse(File.ReadAllText(reportPath))!;
            Check(report["checks"]!.AsArray().All(c => c!["pass"]!.GetValue<bool>()), "one-time conversion checks passed");
            Check(!TownRecovery.Nodes(session).Any(n => n.GetType().Name == "BakedWorld"), "runtime contains no BakedWorld loader");
            Check(TownRecovery.Nodes(session.GetNode("District/Scenery")).OfType<StaticBody3D>().Any(), "recovered scenery has native collision");
            if (report["refresh"] is JsonObject refresh)
            {
                Check(refresh["removedTrianglesPerAnchor"]!.AsArray().All(n => n!.GetValue<int>() > 0), "merged bollard copies were removed for every recovered anchor");
                Check(new[] { "bench", "crate", "bollard-cannon", "bollard-mushroom", "capstan", "hand-barrow", "hawser-coil" }
                    .All(id => session.Assets.ContainsKey(id) && !session.Assets[id].Scene!.ResourcePath.StartsWith("res://assets/props/")), "finished model packs supply the editable asset library");
            }
            if (session.DistrictId.StartsWith("recovery-fixture-"))
            {
                var nodes = TownRecovery.Nodes(session.GetNode("District/Scenery")).ToArray();
                var child = nodes.OfType<MeshInstance3D>().Single(n => n.HasMeta("source_node_index") && n.GetMeta("source_node_index").AsInt32() == 2);
                Check(child.GlobalPosition.IsEqualApprox(new Vector3(4, 0, 5.75f)), "nested parent translation and rotation survive conversion and a cold load");
                var hidden = nodes.OfType<Node3D>().Single(n => n.HasMeta("source_node_index") && n.GetMeta("source_node_index").AsInt32() == 3);
                Check(!hidden.Visible && !TownRecovery.Nodes(hidden).OfType<StaticBody3D>().Any(), "hidden source geometry stays hidden and receives no collider");
                var copies = nodes.OfType<MeshInstance3D>().Where(n => n.HasMeta("source_instance_index")).ToArray();
                Check(copies.Length == 1 && copies[0].GlobalPosition.IsEqualApprox(new Vector3(4, 0, 5)), "instance matrices preserve world positions and exclude out-of-bound copies");
                Check(copies[0].GetActiveMaterial(0) is BaseMaterial3D colored && colored.AlbedoColor.IsEqualApprox(new Color(1, 0, 0)), "per-instance colour survives native resource serialization");
                var material = child.GetActiveMaterial(0);
                Check(material.GetMeta("legacy_extras_json").AsString().Contains("\"wet\":true"), "custom material switches remain available as metadata");
                Check(material is BaseMaterial3D native && native.CullMode == BaseMaterial3D.CullModeEnum.Disabled, "source double-sided material becomes a native material setting");
            }
            if (stage == "write")
            {
                var selected = report["selected"]!.AsArray().Where(p => p!["kind"]!.GetValue<string>() == "prop").ToArray();
                Check(session.Document.Objects.Count == selected.Length, "all recovered props enter the editable layout");
                Check(selected.All(p => session.Instances.TryGetValue(p!["id"]?.GetValue<string>() ?? "town-node-" + p["index"]!.GetValue<int>(), out var obj)
                    && obj.Transform.IsEqualApprox(RecoveryGlb.Transform(new() { ["matrix"] = p["transform"]!.DeepClone() }))), "source prop transforms and permanent ids survive recovery");
                var bench = session.Assets["bench"];
                Vector3? spot = null;
                var bounds = session.District.Bounds;
                for (float z = bounds.Position.Y + 3; z < bounds.End.Y - 3 && spot == null; z += 3)
                    for (float x = bounds.Position.X + 3; x < bounds.End.X - 3 && spot == null; x += 3)
                    {
                        var p = new Placement { Id = "proof-bench", Asset = bench.Id, Position = new[] { x, 0f, z }, Rotation = new[] { 0f, 0f, 0f }, Scale = new[] { 1f, 1f, 1f } };
                        if (session.Clear(p, out _)) spot = new Vector3(x, 0, z);
                    }
                Check(spot != null, "recovered ground provides a clear placement surface");
                Check(session.Place("bench", spot!.Value, Vector3.Zero, Vector3.One), "place a new object in the recovered district");
                string placed = session.SelectedId!;
                await Frames();
                Check(!session.Place("crate", spot.Value, Vector3.Zero, Vector3.One), "native recovered layout rejects overlapping placement");
                Check(!session.Place("crate", new(bounds.End.X + 10, 0, bounds.End.Y + 10), Vector3.Zero, Vector3.One), "district boundary rejects outside placement");
                session.Select(placed); session.DeleteSelected(); session.Undo();
                Check(session.Instances.ContainsKey(placed), "undo restores an object in the recovered district");
                session.SetNight(true);
                var lamps = TownRecovery.Nodes(session.GetNode("District/Objects")).OfType<WorkshopLamp>().ToArray();
                Check(lamps.Length == selected.Count(p => p!["name"]!.GetValue<string>() == "gas_lamp") && lamps.All(l => l.Lit), "recovered lamps respond to night mode");
                Check(session.Save(), "recovered district saves independently of the pilot layout");
                File.WriteAllText(Path.Combine(directory, "expected.json"), session.Document.Encode());
                Check(session.ExportScene(Path.Combine(directory, "objects-export.tscn")), "recovered placements export to an editable Godot scene");
                session.SetEditing(false); await Frames(30);
                Check(session.Camera.IsOnFloor() && Math.Abs(session.Camera.Position.Y) < 0.2f, "walking spawn rests on recovered ground collision");
            }
            else if (stage == "reload")
            {
                var expected = LayoutDocument.Decode(File.ReadAllText(Path.Combine(directory, "expected.json")));
                Check(session.Document.Encode() == expected.Encode(), "separate Godot process restores the recovered layout exactly");
                Check(!session.Dirty, "restored recovered layout starts saved");
                var exported = ResourceLoader.Load<PackedScene>(Path.Combine(directory, "objects-export.tscn")).Instantiate<Node3D>();
                Check(exported.GetChildren().OfType<AuthoredObject>().Select(o => o.Record().Id).SequenceEqual(expected.Objects.Select(p => p.Id)), "exported recovered scene preserves ids and resource references");
                exported.Free();
            }
            else throw new ArgumentException("proof-stage must be write or reload");
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr(error); }
        File.WriteAllText(Path.Combine(directory, stage + ".json"), JsonSerializer.Serialize(new { stage, rows, error }, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Recovery workshop {stage}: {rows.Count} checks, {(error == null ? "PASS" : "FAIL")}");
        session.GetTree().Quit(error == null ? 0 : 1);
    }
}
