using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativeTransportPopulationProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-transport-population/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data"); var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/transport-population.json")))!; var checks = new List<object>();
            void Check(string name, JsonNode? expected, JsonNode? actual) { string? difference = NativePopulationProof.Difference(expected, actual == null ? null : JsonNode.Parse(actual.ToJsonString()), name); checks.Add(new { name, passed = difference == null, difference }); if (difference != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(difference); } }
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            var doors = oracle["doors"]!.DeepClone().AsArray(); for (int i = 0; i < doors.Count; i++) for (int axis = 0; axis < 2; axis++) if (oracle["doorZeroSigns"]![i]![axis]!.GetValue<bool>()) doors[i]!["out"]![axis] = JsonValue.Create(-0.0);
            foreach (var test in oracle["cases"]!.AsArray()) {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots"), houseDoors: doors.Select(d => d!.AsObject()).ToArray()); var c = host.Context;
                JsonNode? Query(string name, params double[] values) { string key = string.Join(",", values.Select(n => Math.Floor(n * 1000000 + .5).ToString(System.Globalization.CultureInfo.InvariantCulture))); var queries = oracle["queries"]![name]!.AsObject(); if (!queries.ContainsKey(key)) throw new InvalidOperationException("Unrecorded original transport query " + name + ":" + key); return queries[key]; }
                population.Reachable = (x, z) => Query("reachable", x, z)!.GetValue<bool>(); population.Open = (x, z, radius) => Query("open", x, z, radius)!.GetValue<bool>(); population.Snap = (x, z, maximum) => Query("nearestOpen", x, z, maximum) is { } p ? (NativeTown.N(p["x"]), NativeTown.N(p["z"])) : null;
                c.Execute("DELETE FROM resident"); c.Execute("DELETE FROM world_state WHERE key='transport'"); c.SetWorld("town", test!["world"]); c.SetWorld("press", test["press"]); town.Clear(); foreach (var r in test["input"]!["residents"]!.AsArray()) population.AddResident(r!.AsObject()); string label = NativeTown.N(test["seed"]) + ":" + NativeTown.S(test, "size");
                var current = population.Snapshot(); Check("original current-town anchors and residents " + label, test["input"], current); var assets = new NativeTownAssets(population); var transport = new NativeTownTransportPopulation(population, assets);
                Check("original current-town stealables " + label, test["baseAssets"], assets.Generate(current)); Check("original 61 mooring and family boat owners " + label, test["boats"], assets.GenerateRowing(current)["boats"]); Check("original landing watermen " + label, test["watermen"], assets.GenerateRowing(current)["watermen"]); Check("original named boat prompts " + label, test["publicBoats"], assets.PublicBoats());
                Check("original native household transport " + label, test["record"], transport.Generate(current)); Check("original transport migration " + label, test["made"], transport.Ensure((uint)NativeTown.N(test["seed"]))); Check("current extra velocipede owners " + label, test["finalAssets"], assets.Stealables());
                var points = new JsonObject(); foreach (var v in test["record"]!["vehicles"]!.AsArray()) points[NativeTown.S(v, "id")] = transport.TripPoints(NativeTown.S(v, "id")); Check("original current-owner weekly trip points " + label, test["tripPoints"], points);
#if DEBUG
                var vehicleRules = new NativeTransport(host, new NativeGoods(host));
                var heapProof = vehicleRules.VehicleAtHeapProof(test["record"]!.AsObject(), points);
                Check("same vehicle positions with bounded current-owner trip reads " + label, JsonValue.Create(true), heapProof["ok"]);
                checks.Add(new { name = "vehicle position heap comparison " + label, passed = true, detail = heapProof });
#endif
                var errands = new JsonObject(); for (int day = 1; day <= 7; day++) errands[day.ToString()] = transport.Errands(day); Check("original seven-day boat and dray errands " + label, test["errands"], errands);
                Check("transport saved state is preserved " + label, test["record"], transport.Record()); Check("matching transport remains idempotent " + label, new JsonObject { ["made"] = false, ["vehicles"] = test["record"]!["vehicles"]!.AsArray().Count }, transport.Ensure((uint)NativeTown.N(test["seed"])));
                Check("transport does not change household identities " + label, test["input"]!["residents"], population.Snapshot()["residents"]);
                var signed = JsonNode.Parse("{\"zero\":-0.0,\"nested\":[-0,-0.005,0,3.5,true,null,\"literal -0\"],\"ordinary\":{\"text\":\"é\",\"count\":-7}}")!; var originalSigned = signed.ToJsonString(); c.SetWorld("proof:signed-json", signed); c.SetPlayerState(1, "proof:signed-json", signed);
                Check("world JSON matches source negative-zero persistence " + label, JsonValue.Create(true), JsonValue.Create(BitConverter.DoubleToInt64Bits(c.World("proof:signed-json")!["zero"]!.GetValue<double>()) == 0 && BitConverter.DoubleToInt64Bits(c.World("proof:signed-json")!["nested"]![0]!.GetValue<double>()) == 0));
                Check("player JSON matches source negative-zero persistence " + label, c.World("proof:signed-json"), c.PlayerState(1, "proof:signed-json")); Check("ordinary persisted JSON values are unchanged " + label, signed, c.World("proof:signed-json")); Check("JSON persistence preserves in-memory geometry signs " + label, JsonValue.Create(originalSigned), JsonValue.Create(signed.ToJsonString()));
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native transport population proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
