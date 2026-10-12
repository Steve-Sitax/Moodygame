using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativePressPopulationProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-press-population/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data");
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/press-population-1873.json")))!; var q = oracle["queries"]!; var checks = new List<object>();
            void Check(string name, JsonNode? expected, JsonNode? actual) { var normalized = actual == null ? null : JsonNode.Parse(actual.ToJsonString()); string? difference = NativePopulationProof.Difference(expected, normalized, name); checks.Add(new { name, passed = difference == null, difference }); if (difference != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(difference); } }
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            foreach (var item in oracle["cases"]!.AsArray()) {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots"), houseDoors: oracle["doors"]!.AsArray().Select(d => d!.AsObject()).ToArray());
                string Key(params double[] numbers) => string.Join(",", numbers.Select(n => Math.Floor(n * 1000000 + .5).ToString(System.Globalization.CultureInfo.InvariantCulture))); JsonNode? Query(string name, params double[] numbers) { string key = Key(numbers); var dict = q[name]!.AsObject(); if (!dict.ContainsKey(key)) throw new InvalidOperationException("Unrecorded original press query " + name + ":" + key); return dict[key]; }
                population.Snap = (x, z, max) => Query("nearestOpen", x, z, max) is { } p ? (NativeTown.N(p["x"]), NativeTown.N(p["z"])) : null; population.Reachable = (x, z) => Query("reachable", x, z)!.GetValue<bool>(); population.Open = (x, z, radius) => Query("open", x, z, radius)!.GetValue<bool>(); population.Flags = (x, z) => (int)NativeTown.N(Query("flags", x, z));
                uint seed = (uint)NativeTown.N(item?["seed"]); string size = NativeTown.S(item, "size"), label = seed + ":" + size;
                var press = new NativeTownPressPopulation(population); population.Augment.Add(press.Ensure); var actual = population.Rebuild(seed, size);
                Check("original press town " + label, item!["town"], actual); Check("original press state " + label, item["press"], host.Context.World("press"));
                Check("original newsboy/clerk roles " + label, item["roles"], host.Context.Rows("SELECT id,name,role,district,faction FROM npc WHERE id='postclerk' OR role='newsboy' ORDER BY id"));
                var before = population.Snapshot().DeepClone(); press.Ensure(seed); Check("press augmentation is idempotent " + label, before, population.Snapshot());
                var landmarks = new NativeTownLandmarksPopulation(population); landmarks.Ensure(seed); Check("original landmark staff homes " + label, item["landmarked"], population.Snapshot()); Check("original landmark addition record " + label, item["lmState"], host.Context.World("landmarks"));
                before = population.Snapshot().DeepClone(); landmarks.Ensure(seed); Check("landmark augmentation is idempotent " + label, before, population.Snapshot());
                host.Context.Execute("INSERT INTO npc_memory(npc_id,text,source,weight,day) VALUES('postclerk','Existing saved memory','seen',1,1)"); bool guarded = false; try { population.Rebuild(seed + 1, size); } catch (NativeServiceException e) { guarded = e.Status == 409; } Check("active saved population cannot be rebuilt " + label, JsonValue.Create(true), JsonValue.Create(guarded));
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native press population proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
