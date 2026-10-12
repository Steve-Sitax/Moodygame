using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativeWorkshopsPopulationProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-workshops-population/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data"); var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/workshops-population.json")))!; var checks = new List<object>();
            void Check(string name, JsonNode? expected, JsonNode? actual) { string? difference = NativePopulationProof.Difference(expected, actual == null ? null : JsonNode.Parse(actual.ToJsonString()), name); checks.Add(new { name, passed = difference == null, difference }); if (difference != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(difference); } }
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            foreach (var test in oracle["cases"]!.AsArray()) {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots"), houseDoors: oracle["doors"]!.AsArray().Select(d => d!.AsObject()).ToArray()); var c = host.Context;
                JsonNode? Query(string name, params double[] values) { string key = string.Join(",", values.Select(n => Math.Floor(n * 1000000 + .5).ToString(System.Globalization.CultureInfo.InvariantCulture))); var queries = oracle["queries"]![name]!.AsObject(); if (!queries.ContainsKey(key)) throw new InvalidOperationException("Unrecorded original workshop query " + name + ":" + key); return queries[key]; }
                population.Reachable = (x, z) => Query("reachable", x, z)!.GetValue<bool>(); population.Open = (x, z, radius) => Query("open", x, z, radius)!.GetValue<bool>();
                population.Snap = (x, z, maximum) => Query("nearestOpen", x, z, maximum) is { } p ? (NativeTown.N(p["x"]), NativeTown.N(p["z"])) : null;
                c.Execute("DELETE FROM resident"); c.Execute("DELETE FROM npc_relationship WHERE npc_id IN('velo_maker','wheelwright')"); c.Execute("DELETE FROM npc WHERE id IN('velo_maker','wheelwright')"); foreach (string key in new[] { "homes", "poesje:door", "veloshop", "cartshop" }) c.Execute("DELETE FROM world_state WHERE key=$p0", key);
                var input = test!["input"]!.DeepClone().AsObject(); var residents = input["residents"]!.DeepClone().AsArray(); input.Remove("residents"); c.SetWorld("town", input); c.SetWorld("press", test["press"]); town.Clear(); foreach (var person in residents) population.AddResident(person!.AsObject());
                var workshops = new NativeTownWorkshopsPopulation(population); uint seed = (uint)NativeTown.N(test["seed"]); string label = seed + ":" + NativeTown.S(test, "size");
                Check("original native bike workshop creation " + label, test["bike"], JsonValue.Create(workshops.EnsureBike(seed))); Check("original native cart workshop creation " + label, test["cart"], JsonValue.Create(workshops.EnsureCart(seed)));
                Check("original bike display and maker " + label, test["bikeShop"], c.World("veloshop")); Check("original cart display and wheelwright " + label, test["cartShop"], c.World("cartshop"));
                Check("original workshop residents " + label, test["residents"], new JsonArray(population.Snapshot()["residents"]!.AsArray().Where(r => NativeTown.S(r, "id") is "velo_maker" or "wheelwright").Select(r => r!.DeepClone()).ToArray()));
                var places = population.Snapshot()["places"]!.AsObject(); Check("original workshop places " + label, test["places"], new JsonObject { ["velo_shop"] = places["velo_shop"]?.DeepClone(), ["cart_shop"] = places["cart_shop"]?.DeepClone() });
                Check("saved workshops are idempotent " + label, JsonValue.Create(true), JsonValue.Create(!workshops.EnsureBike(seed) && !workshops.EnsureCart(seed)));
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native workshops population proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
