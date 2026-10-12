using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativeWallPopulationProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-wall-population/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data");
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/wall-population.json")))!; var checks = new List<object>();
            void Check(string name, JsonNode? expected, JsonNode? actual) { var normalized = actual == null ? null : JsonNode.Parse(actual.ToJsonString()); string? difference = NativePopulationProof.Difference(expected, normalized, name); checks.Add(new { name, passed = difference == null, difference }); if (difference != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(difference); } }
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            foreach (var test in oracle["cases"]!.AsArray()) {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots"), houseDoors: oracle["doors"]!.AsArray().Select(d => d!.AsObject()).ToArray());
                JsonNode? Query(string name, params double[] values) { string key = string.Join(",", values.Select(n => Math.Floor(n * 1000000 + .5).ToString(System.Globalization.CultureInfo.InvariantCulture))); var queries = oracle["queries"]![name]!.AsObject(); if (!queries.ContainsKey(key)) throw new InvalidOperationException("Unrecorded original rampart query " + name + ":" + key); return queries[key]; }
                population.Flags = (x, z) => (int)NativeTown.N(Query("flags", x, z)); population.Reachable = (x, z) => Query("reachable", x, z)!.GetValue<bool>(); population.Open = (x, z, radius) => Query("open", x, z, radius)!.GetValue<bool>();
                uint seed = (uint)NativeTown.N(test?["seed"]); string label = seed + ":" + NativeTown.S(test, "size"); var wall = new NativeTownWallPopulation(population);
                Check("complete original elevated wall population " + label, test!["expected"], wall.Generate(seed, test["input"]!.AsObject()));
                Check("saved fixed wall IDs remain unique " + label, test["partial"], wall.Generate(seed, test["partialInput"]!.AsObject()));
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native wall population proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
