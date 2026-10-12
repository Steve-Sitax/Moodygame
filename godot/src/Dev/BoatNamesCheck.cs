using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Movers;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>W5 pictures of the actual decoded hulls, with no speed measurement and no town bake.</summary>
[GamePart(95)]
public partial class BoatNamesCheck : Node
{
    private string directory = "";
    private readonly List<(string Name, Boats.Float Boat, Node3D Zone, float Distance)> views = new();
    private int view, frames;
    public override void _Ready()
    {
        directory = Main.I.Arg("boatnames-test");
        if (directory == "") { SetProcess(false); return; }
        Directory.CreateDirectory(directory);
        if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
        Daylight.I.SetTime(13); Daylight.I.SetWeather("clear"); Daylight.I.Settle(); Tide.Hold(-2.8f);
        var group = new Node3D { Name = "name_test_hulls" }; Main.I.World.AddChild(group);
        foreach (var (kind, id, x, z, role) in new[] { ("brig", "anna_maria", 0f, -65f, "bow_p"), ("brig", "anna_maria", 0f, -65f, "stern"), ("paddle_tug", "schelde", -310f, -70f, "box_p") })
        {
            var f = views.FirstOrDefault(v => v.Boat.Kind == kind).Boat ?? Boats.I.Place(kind, group);
            if (f == null) continue;
            f.Outer.Position = new Vector3(x, -2.8f, z); Boats.I.SetVesselName(f, id);
            var zone = BakedWorld.All(f.Inner).OfType<MeshInstance3D>().FirstOrDefault(n => n.Name.ToString().EndsWith("_name_" + role));
            if (zone == null) continue;
            foreach (float distance in new[] { 10f, 40f }) views.Add(($"{role}{distance:0}", f, zone, distance));
        }
        if (views.Count != 6) { GD.PrintErr("boat names: six views require rebuilt models (needs the bake's model refresh)"); GetTree().Quit(1); return; }
        Next();
    }
    private void Next()
    {
        frames = 0;
        var v = views[view];
        var zone = (MeshInstance3D)v.Zone;
        Vector3 target = zone.GlobalTransform * zone.GetAabb().GetCenter();
        var arrays = zone.Mesh.SurfaceGetArrays(0);
        var normals = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
        Vector3 normal = (zone.GlobalTransform.Basis * (normals.Length > 0 ? normals[0] : Vector3.Back)).Normalized();
        var camera = Main.I.Cam; camera.GlobalPosition = target + normal * v.Distance;
        var q = Basis.LookingAt(target - camera.GlobalPosition).GetRotationQuaternion();
        if (camera is Player.FlyCam fly) fly.Face(q); else camera.Quaternion = q;
    }
    public override void _Process(double delta)
    {
        if (directory == "" || ++frames < 180) return;
        var v = views[view];
        Main.I.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(directory, v.Name + ".png"));
        GD.Print($"boat names picture: {v.Name}, {v.Boat.Outer.GetMeta("vesselName")}");
        if (++view < views.Count) { Next(); return; }
        var data = views.Select(v => new { view = v.Name, id = v.Boat.Outer.GetMeta("vesselId").AsString(), name = v.Boat.Outer.GetMeta("vesselName").AsString(), customData = BakedWorld.All(v.Boat.Inner).OfType<MultiMeshInstance3D>().Select(n => new { node = n.Name.ToString(), custom = n.Multimesh.GetInstanceCustomData(0).ToString() }).ToArray() }).ToArray();
        File.WriteAllText(Path.Combine(directory, "names.json"), JsonSerializer.Serialize(new { views = data, needsBake = "Still hulls and their stripped old lettering, new ship placement and refreshed decoded models", speedMeasured = false }, new JsonSerializerOptions { WriteIndented = true }));
        GetTree().Quit(); SetProcess(false);
    }
}
