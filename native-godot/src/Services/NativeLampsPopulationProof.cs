using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativeLampsPopulationProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-lamps-population/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data");
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/lamps-population.json")))!; var checks = new List<object>();
            void Check(string name, JsonNode? expected, JsonNode? actual) { var normalized = actual == null ? null : JsonNode.Parse(actual.ToJsonString()); string? difference = NativePopulationProof.Difference(expected, normalized, name); checks.Add(new { name, passed = difference == null, difference }); if (difference != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(difference); } }
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            foreach (var test in oracle["cases"]!.AsArray()) {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots")); var info = oracle["info"]!;
                double x0 = NativeTown.N(info["x0"]), z0 = NativeTown.N(info["z0"]), res = NativeTown.N(info["res"]); int w = (int)NativeTown.N(info["w"]), h = (int)NativeTown.N(info["h"]);
                var gates = NativeTownPopulation.A(population.City["decor"]?["rampart"]?["gates"]).Select(g => (cx: (NativeTown.N(g?["posts"]?[0]?[0]) + NativeTown.N(g?["posts"]?[1]?[0])) / 2, cz: (NativeTown.N(g?["posts"]?[0]?[1]) + NativeTown.N(g?["posts"]?[1]?[1])) / 2, ox: NativeTown.N(g?["out"]?[0]), oz: NativeTown.N(g?["out"]?[1]))).ToArray();
                bool Free(double x, double z) { if (x < x0 || z < z0 || x >= x0 + h * res || z >= z0 + w * res) return false; foreach (var g in gates) { double along = (x - g.cx) * g.ox + (z - g.cz) * g.oz, side = (x - g.cx) * -g.oz + (z - g.cz) * g.ox; if (along > 3 && along < 80 && Math.Abs(side) < 6) return false; } return true; }
                population.Flags = (x, z) => Free(x, z) ? 0 : 1; population.Reachable = Free; population.CanStep = (_, _, _, _) => true; population.MapInfo = () => (x0, z0, res, w, h);
                population.Open = (x, z, r) => new[] { (0.0, 0.0), (r, 0.0), (-r, 0.0), (0.0, r), (0.0, -r), (r, r), (-r, -r), (r, -r), (-r, r) }.All(p => Free(x + p.Item1, z + p.Item2));
                population.Snap = (x, z, maximum) => throw new InvalidOperationException("The independently reachable lamp fixture must not need a legacy snap");
                string label = NativeTown.N(test?["seed"]) + ":" + NativeTown.S(test, "size"); var input = test!["input"]!.AsObject(); var before = input.DeepClone(); var actual = new NativeTownLampsPopulation(population).Generate(input);
                Check("all original native-planned lamp rounds " + label, test["expected"], actual); Check("other households stay unchanged " + label, before, input);
                var covered = NativeTownPopulation.A(actual?["state"]?["rounds"]).SelectMany(r => NativeTownPopulation.A(r?["lamps"])).Select(l => NativeTown.S(l, "id")).ToArray(); Check("every lamp is assigned exactly once " + label, JsonValue.Create(141), JsonValue.Create(covered.Distinct().Count()));
            }
            {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots")); var c = host.Context;
                population.MapInfo = () => (-100, -50, .5, 400, 400); population.Flags = (_, _) => 0; population.Open = (_, _, _) => true; population.Reachable = (_, _) => true; population.CanStep = (_, _, _, _) => true; population.Snap = (x, z, _) => (x, z);
                population.Facts["LAMPS"] = new JsonArray(new JsonObject { ["id"] = "town:proof-a", ["x"] = -8, ["z"] = 22, ["hung"] = false }, new JsonObject { ["id"] = "town:proof-b", ["x"] = 5, ["z"] = 22, ["hung"] = false });
                var source = oracle["cases"]![0]!["expected"]!["residents"]!.AsArray(); var metadata = oracle["cases"]![0]!["input"]!.DeepClone().AsObject(); metadata.Remove("residents"); metadata["anchors"] = new JsonObject(); c.Execute("DELETE FROM resident"); c.Execute("DELETE FROM world_state WHERE key IN('townlife_lamps','townlife_lamps:topology')"); c.SetWorld("town", metadata); town.Clear();
                foreach (var r in source) population.AddResident(r!.AsObject()); var module = new NativeTownLampsPopulation(population); var initial = module.Ensure(1873)!; var men = new JsonArray(initial["rounds"]!.AsArray().Select(r => r!["lamplighter"]!.DeepClone()).ToArray()); var beforeRows = population.Snapshot()["residents"]!.DeepClone();
                c.SetWorld("lamps_help", new JsonObject { ["player"] = 1, ["round"] = NativeTown.S(initial["rounds"]![0], "id"), ["held"] = "job:lamp-proof" }); c.Execute("INSERT INTO job(id,day,title,employer_npc,district,task_type,pay_c,risk,tier,pitch,status) VALUES(99901,1,'Preserved lamp work','proof','town','lamp_round',20,'low',1,'Preserved fixture','offered')");
                Check("unchanged lamp topology keeps complete tours", initial, module.Ensure(1873)); Check("unchanged lamp topology keeps resident data", beforeRows, population.Snapshot()["residents"]);
                var lamps = population.Facts["LAMPS"]!.AsArray(); lamps.Add(new JsonObject { ["id"] = "authored:outer/proof-lamp", ["x"] = -3, ["z"] = 24, ["hung"] = false }); var added = module.Ensure(1873)!;
                Check("new authored lamp joins a reachable tour", JsonValue.Create(true), JsonValue.Create(added["rounds"]!.AsArray().SelectMany(r => r!["lamps"]!.AsArray()).Any(l => NativeTown.S(l, "id") == "authored:outer/proof-lamp")));
                Check("changed lamp topology preserves the assigned people", men, new JsonArray(added["rounds"]!.AsArray().Select(r => r!["lamplighter"]!.DeepClone()).ToArray()));
                lamps[2]!["x"] = 8; lamps[2]!["hung"] = true; var moved = module.Ensure(1873)!; var authored = moved["rounds"]!.AsArray().SelectMany(r => r!["lamps"]!.AsArray()).Single(l => NativeTown.S(l, "id") == "authored:outer/proof-lamp");
                Check("moved authored lamp keeps its permanent id and new position", JsonValue.Create(8), authored!["x"]); Check("hung material placement participates in topology", JsonValue.Create(true), c.World("townlife_lamps:topology")!.AsArray().Single(l => l![0]!.GetValue<string>() == "authored:outer/proof-lamp")![3]);
                lamps.RemoveAt(0); var removed = module.Ensure(1873)!; Check("hidden or deleted lamp leaves the tours", JsonValue.Create(false), JsonValue.Create(removed["rounds"]!.AsArray().SelectMany(r => r!["lamps"]!.AsArray()).Any(l => NativeTown.S(l, "id") == "town:proof-a")));
                Check("topology repair preserves held help", JsonValue.Create("job:lamp-proof"), c.World("lamps_help")!["held"]); Check("topology repair preserves existing jobs", JsonValue.Create(1), JsonValue.Create(c.Scalar<int>("SELECT COUNT(*) FROM job WHERE id=99901"))); Check("reopening unchanged authored lamps is idempotent", removed, module.Ensure(1873));
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native lamps population proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
