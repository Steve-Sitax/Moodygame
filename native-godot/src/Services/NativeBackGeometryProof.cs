using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativeBackGeometryProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-back-geometry/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data");
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/back-geometry.json")))!; var checks = new List<object>();
            void Check(string name, JsonNode? expected, JsonNode? actual) { var normalized = actual == null ? null : JsonNode.Parse(actual.ToJsonString()); string? difference = NativePopulationProof.Difference(expected, normalized, name); checks.Add(new { name, passed = difference == null, difference }); if (difference != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(difference); } }
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots"));
            static double Line(double n) => Math.Abs(n - Math.Floor(n / 45 + .5) * 45);
            static bool Free(double x, double z) => x >= -370 && x <= 240 && z >= 60 && z <= 360 && (Line(x + 366) <= 3 || Line(z - 60) <= 3 || NativeTownBackGeometry.D(x, z, -300, 300) < 8);
            population.Flags = (x, z) => Free(x, z) ? 0 : 1; population.Reachable = Free;
            population.Open = (x, z, r) => new[] { (0.0, 0.0), (r, 0.0), (-r, 0.0), (0.0, r), (0.0, -r), (r, r), (-r, -r), (r, -r), (-r, r) }.All(p => Free(x + p.Item1, z + p.Item2));
            var geometry = new NativeTownBackGeometry(population);
            Check("67 original street corners", oracle["corners"], new JsonArray(geometry.Corners().Select(p => (JsonNode)new JsonObject { ["x"] = p.x, ["z"] = p.z, ["wall"] = p.wall }).ToArray()));
            Check("27 original rampart walking points", oracle["walk"], new JsonArray(geometry.WallWalk().Select(p => (JsonNode)new JsonArray(p.x, p.z)).ToArray()));
            int i = 0; foreach (var test in oracle["rooms"]!.AsArray()) {
                // The original fixture probes two metres to the right of each street intersection.
                var point = geometry.RoomNear(NativeTown.N(test?["x"]) + 2, NativeTown.N(test?["z"]) + 2, NativeTown.N(test?["room"]), NativeTown.N(test?["max"]));
                Check("room near intersection " + i++, test!["at"], point == null ? null : new JsonArray(point.Value.x, point.Value.z)); }
            i = 0; foreach (var test in oracle["lanes"]!.AsArray()) Check("vehicle clearance " + i++, test!["open"], JsonValue.Create(geometry.OffLanes(NativeTown.N(test["x"]), NativeTown.N(test["z"]), .2)));
            foreach (var test in oracle["churches"]!.AsArray()) { var point = geometry.ChurchDoor(NativeTown.S(test, "key")); Check("native church door " + NativeTown.S(test, "key"), test!["door"], point == null ? null : new JsonObject { ["at"] = new JsonArray(point.Value.x, point.Value.z), ["face"] = point.Value.face }); }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native back geometry proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
