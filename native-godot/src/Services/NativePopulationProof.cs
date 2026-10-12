using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

/// <summary>Original generators against recorded navigation fixture inputs; no legacy walk data in production.</summary>
public partial class NativePopulationProof : Node
{
    internal static string? Difference(JsonNode? expected, JsonNode? actual, string path = "town")
    {
        if (expected == null || actual == null) return expected == null && actual == null ? null : path + " expected " + expected + "; actual " + actual;
        if (expected is JsonObject eo && actual is JsonObject ao) { if (eo.Count != ao.Count) return path + " keys " + eo.Count + " != " + ao.Count; foreach (var pair in eo) { if (!ao.ContainsKey(pair.Key)) return path + " missing " + pair.Key; if (Difference(pair.Value, ao[pair.Key], path + "." + pair.Key) is { } diff) return diff; } return null; }
        if (expected is JsonArray ea && actual is JsonArray aa) { if (ea.Count != aa.Count) return path + " lengths " + ea.Count + " != " + aa.Count; for (int i = 0; i < ea.Count; i++) if (Difference(ea[i], aa[i], path + "[" + i + "]") is { } diff) return diff; return null; }
        if (expected is JsonValue ev && actual is JsonValue av && ev.TryGetValue<double>(out var en) && av.TryGetValue<double>(out var an)) return Math.Abs(en - an) < 1e-9 ? null : path + " numbers " + en + " != " + an;
        return JsonNode.DeepEquals(expected, actual) ? null : path + " expected " + expected + "; actual " + actual;
    }
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-population/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data");
            using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host);
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/population-1873.json")))!; var q = oracle["queries"]!;
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots"), houseDoors: oracle["doors"]!.AsArray().Select(d => d!.AsObject()).ToArray());
            string Key(params double[] numbers) => string.Join(",", numbers.Select(n => Math.Floor(n * 1000000 + .5).ToString(System.Globalization.CultureInfo.InvariantCulture)));
            JsonNode? Query(string name, params double[] numbers) { string key = Key(numbers); var dict = q[name]!.AsObject(); if (!dict.ContainsKey(key)) throw new InvalidOperationException("Unrecorded original generator query " + name + ":" + key); return dict[key]; }
            population.Snap = (x, z, max) => Query("nearestOpen", x, z, max) is { } p ? (NativeTown.N(p["x"]), NativeTown.N(p["z"])) : null;
            population.Reachable = (x, z) => Query("reachable", x, z)!.GetValue<bool>(); population.Open = (x, z, radius) => Query("open", x, z, radius)!.GetValue<bool>(); population.Flags = (x, z) => (byte)NativeTown.N(Query("flags", x, z));
            var checks = new List<object>(); foreach (var item in oracle["cases"]!.AsArray()) {
                uint seed = (uint)NativeTown.N(item?["seed"]); string size = NativeTown.S(item, "size"); var generated = JsonNode.Parse(population.Generate(seed, size).ToJsonString())!; var expected = item!["town"]!;
                string? firstPerson = null; int count = Math.Min(generated["residents"]!.AsArray().Count, expected["residents"]!.AsArray().Count); for (int i = 0; i < count && firstPerson == null; i++) firstPerson = Difference(expected["residents"]![i], generated["residents"]![i], "resident[" + i + "]");
                string? diff = Difference(expected, generated); checks.Add(new { seed, size, passed = diff == null, residents = generated["residents"]!.AsArray().Count, difference = diff, firstPersonDifference = firstPerson });
                if (diff != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException("Original native population " + seed + ":" + size + "; " + diff + "; " + firstPerson); }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native population proof: {checks.Count} complete original towns passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
