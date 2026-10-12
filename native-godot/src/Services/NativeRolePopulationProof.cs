using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativeRolePopulationProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-role-population/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data");
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/role-population.json")))!; var checks = new List<object>();
            void Check(string name, JsonNode? expected, JsonNode? actual) { var normalized = actual == null ? null : JsonNode.Parse(actual.ToJsonString()); string? difference = NativePopulationProof.Difference(expected, normalized, name); checks.Add(new { name, passed = difference == null, difference }); if (difference != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(difference); } }
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            foreach (var test in oracle["cases"]!.AsArray()) {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots"), houseDoors: oracle["doors"]!.AsArray().Select(d => d!.AsObject()).ToArray());
                population.Snap = (x, z, maximum) => { string key = string.Join(",", new[] { x, z, maximum }.Select(n => Math.Floor(n * 1000000 + .5).ToString(System.Globalization.CultureInfo.InvariantCulture))); var queries = oracle["queries"]!.AsObject(); if (!queries.ContainsKey(key)) throw new InvalidOperationException("Unrecorded original standing snap " + key); return queries[key] is { } q ? (NativeTown.N(q["x"]), NativeTown.N(q["z"])) : null; };
                uint seed = (uint)NativeTown.N(test?["seed"]); string label = seed + ":" + NativeTown.S(test, "size");
                Check("all original standing officers and thieves " + label, test!["standing"], new NativeTownStandingPopulation(population).Generate(seed, test["input"]!.AsObject()));
                Check("all four original mill workers " + label, test["mills"], new NativeTownMillsPopulation(population).Generate(seed, test["millInput"]!.AsObject()));
                // Existing fixed mill IDs consume the original random stream but are not duplicated.
                var withMills = test["millInput"]!.DeepClone().AsObject(); foreach (var r in test["mills"]!["residents"]!.AsArray()) withMills["residents"]!.AsArray().Add(r!.DeepClone());
                Check("mill identities remain unique " + label, new JsonArray(), new NativeTownMillsPopulation(population).Generate(seed, withMills)["residents"]);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native role population proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
