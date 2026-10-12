using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Game;

namespace Scheldemist.Native.World;

/// <summary>Physical placement, saved identities and scene export across every native district.</summary>
public partial class NativeEditorProof : Node
{
    public override async void _Ready()
    {
        try
        {
            string output = WorkshopSession.Arg("editor-proof");
            string isolated = WorkshopSession.Arg("author-root");
            if (output == "" || isolated == "" || !Path.GetFullPath(isolated).StartsWith(Path.GetFullPath(output) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Supply an isolated --editor-proof directory and its child --author-root.");
            Directory.CreateDirectory(output); NativeGlobals.Ensure();
            var rows = new List<object>();
            foreach (var district in NativeDistrictLayouts.Available())
            {
                var workshop = ResourceLoader.Load<PackedScene>("res://main.tscn").Instantiate<WorkshopSession>();
                workshop.District = district; AddChild(workshop);
                for (int i = 0; i < 3; i++) await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
                if (workshop.Ui == null) throw new InvalidOperationException("Workshop failed to load: " + district.Id);
                string asset = workshop.Assets.ContainsKey("lamp") ? "lamp" : workshop.Assets.Keys.First(id => id.Contains("lamp"));
                Vector3? point = null;
                for (int radius = 0; radius <= 14 && point == null; radius++)
                for (int dx = -radius; dx <= radius && point == null; dx++)
                for (int dz = -radius; dz <= radius && point == null; dz++)
                {
                    if (Math.Max(Math.Abs(dx), Math.Abs(dz)) != radius) continue;
                    Vector3 at = district.WalkSpawn + new Vector3(dx, 0, dz);
                    using var ray = PhysicsRayQueryParameters3D.Create(at + Vector3.Up * 12, at + Vector3.Down * 4, 1);
                    var hit = workshop.GetWorld3D().DirectSpaceState.IntersectRay(ray);
                    if (hit.Count == 0 || hit["normal"].AsVector3().Dot(Vector3.Up) < .7f) continue;
                    var position = hit["position"].AsVector3();
                    var placement = new Placement { Id = "proof", Asset = asset, Position = LayoutDocument.Floats(position), Rotation = new float[3], Scale = new float[] { 1, 1, 1 } };
                    if (workshop.Clear(placement, out _)) point = position;
                }
                if (point == null || !workshop.Place(asset, point.Value, Vector3.Zero, Vector3.One)) throw new InvalidOperationException("No physical place for a lamp near the spawn: " + district.Id);
                string id = workshop.SelectedId!;
                if (!workshop.Save()) throw new InvalidOperationException("Isolated save failed: " + district.Id);
                var saved = workshop.Store.Read()!;
                if (!saved.Objects.Any(p => p.Id == id && p.Position.SequenceEqual(LayoutDocument.Floats(point.Value)))) throw new InvalidOperationException("Saved pose/identity changed: " + district.Id);
                string exported = Path.Combine(output, district.Id + ".tscn");
                if (!workshop.ExportScene(exported)) throw new InvalidOperationException("Export failed: " + district.Id);
                var scene = ResourceLoader.Load<PackedScene>(exported).Instantiate<Node3D>();
                bool hasLamp = scene.GetChildren().OfType<AuthoredObject>().Any(n => n.ObjectId == id && n.Position.IsEqualApprox(point.Value)); scene.Free();
                if (!hasLamp) throw new InvalidOperationException("Export lost the lamp: " + district.Id);
                rows.Add(new { district = district.Id, point, savedAndExported = true });
                RemoveChild(workshop); workshop.Free();
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { passed = true, districts = rows }, new JsonSerializerOptions { WriteIndented = true, IncludeFields = true }));
            GD.Print("native editor proof: " + rows.Count + " districts placed, saved and exported a lamp"); GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
}
