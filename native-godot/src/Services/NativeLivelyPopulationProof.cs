using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativeLivelyPopulationProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-lively-population/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data");
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/lively-population.json")))!; var checks = new List<object>();
            void Check(string name, JsonNode? expected, JsonNode? actual) { var normalized = actual == null ? null : JsonNode.Parse(actual.ToJsonString()); string? difference = NativePopulationProof.Difference(expected, normalized, name); checks.Add(new { name, passed = difference == null, difference }); if (difference != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(difference); } }
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            foreach (var test in oracle["cases"]!.AsArray()) {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots"), houseDoors: oracle["doors"]!.AsArray().Select(d => d!.AsObject()).ToArray());
                static double Line(double n) => Math.Abs(n - Math.Floor(n / 45 + .5) * 45);
                static bool Free(double x, double z) => x >= -370 && x <= 240 && z >= 60 && z <= 360 && (Line(x + 366) <= 3 || Line(z - 60) <= 3 || NativeTownBackGeometry.D(x, z, -300, 300) < 8);
                population.Flags = (x, z) => Free(x, z) ? 0 : 1; population.Reachable = Free; population.CanStep = (_, _, _, _) => true;
                population.Open = (x, z, r) => new[] { (0.0, 0.0), (r, 0.0), (-r, 0.0), (0.0, r), (0.0, -r), (r, r), (-r, -r), (r, -r), (-r, r) }.All(p => Free(x + p.Item1, z + p.Item2));
                var info = oracle["info"]!; population.MapInfo = () => (NativeTown.N(info["x0"]), NativeTown.N(info["z0"]), NativeTown.N(info["res"]), (int)NativeTown.N(info["w"]), (int)NativeTown.N(info["h"]));
                population.Snap = (x, z, maximum) => { string key = string.Join(",", new[] { x, z, maximum }.Select(n => Math.Floor(n * 1000000 + .5).ToString(System.Globalization.CultureInfo.InvariantCulture))); var queries = oracle["queries"]!.AsObject(); if (!queries.ContainsKey(key)) throw new InvalidOperationException("Unrecorded original lively snap " + key); return queries[key] is { } q ? (NativeTown.N(q["x"]), NativeTown.N(q["z"])) : null; };
                uint seed = (uint)NativeTown.N(test?["seed"]); string label = seed + ":" + NativeTown.S(test, "size"); var input = test!["input"]!.AsObject(); var before = input.DeepClone();
                Check("all original lively residents and door rounds " + label, test["expected"], new NativeTownLivelyPopulation(population).Generate(seed, input)); Check("existing population stays unchanged " + label, before, input);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native lively population proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
