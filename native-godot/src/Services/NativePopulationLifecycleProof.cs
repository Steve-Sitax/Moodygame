using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

/// <summary>Whole original nineteen-stage fresh towns and persistent settings, with isolated reference navigation only.</summary>
public partial class NativePopulationLifecycleProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-population-lifecycle/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data"); var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/population-lifecycle.json")))!; var checks = new List<object>();
            void Check(string name, JsonNode? expected, JsonNode? actual) { string? difference = NativePopulationProof.Difference(expected, actual == null ? null : JsonNode.Parse(actual.ToJsonString()), name); checks.Add(new { name, passed = difference == null, difference }); if (difference != null) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(difference); } }
            JsonObject Static(string name) => JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/" + name + ".json")))!.AsObject();
            var doors = oracle["doors"]!.DeepClone().AsArray(); for (int i = 0; i < doors.Count; i++) for (int axis = 0; axis < 2; axis++) if (oracle["doorZeroSigns"]![i]![axis]!.GetValue<bool>()) doors[i]!["out"]![axis] = JsonValue.Create(-0.0);
            var info = oracle["info"]!; double x0 = NativeTown.N(info["x0"]), z0 = NativeTown.N(info["z0"]), res = NativeTown.N(info["res"]); int w = (int)NativeTown.N(info["w"]), h = (int)NativeTown.N(info["h"]); var flags = Convert.FromBase64String(oracle["flags"]!.GetValue<string>()); var reachable = Convert.FromBase64String(oracle["reachable"]!.GetValue<string>());
            int Cell(double x, double z) { int row = (int)Math.Floor((x - x0) / res), col = (int)Math.Floor((z - z0) / res); return row < 0 || col < 0 || row >= h || col >= w ? -1 : row * w + col; }
            int Flags(double x, double z) { int cell = Cell(x, z); return cell < 0 ? 6 : flags[cell]; } bool Reachable(double x, double z) { int cell = Cell(x, z); return cell >= 0 && reachable[cell] != 0; }
            bool Open(double x, double z, double radius) { if (Flags(x, z) != 0) return false; for (int i = 0; i < 8; i++) { double angle = i * Math.PI / 4; if (Flags(x + Math.Cos(angle) * radius, z + Math.Sin(angle) * radius) != 0) return false; } return true; }
            foreach (var test in oracle["cases"]!.AsArray()) {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); var population = new NativeTownPopulation(host, town, city: Static("city"), buildings: Static("city_build"), kept: Static("inworld_houses"), spots: Static("spots"), houseDoors: doors.Select(d => d!.AsObject()).ToArray()); var c = host.Context;
                population.Open = Open; population.Reachable = Reachable; population.Flags = Flags; population.MapInfo = () => (x0, z0, res, w, h); population.CanStep = (_, _, _, _) => true;
                population.Snap = (x, z, maximum) => { string key = string.Join(",", new[] { x, z, maximum }.Select(n => Math.Floor(n * 1000000 + .5).ToString(System.Globalization.CultureInfo.InvariantCulture))); var values = oracle["nearest"]!.AsObject(); if (!values.ContainsKey(key)) throw new InvalidOperationException("Unrecorded original lifecycle nearest-open query " + key); return values[key] is { } p ? (NativeTown.N(p["x"]), NativeTown.N(p["z"])) : null; };
                var goods = new NativeGoods(host); var actions = new NativeActions(host, goods); var emigrants = new NativeEmigrants(host, actions); var lifecycle = new NativeTownPopulationLifecycle(population, emigrants); uint seed = (uint)NativeTown.N(test!["seed"]); string size = NativeTown.S(test, "size"), label = seed + ":" + size;
                // Ordinary mount keeps imported people; source-ordered fresh generation starts only on host reset.
                var before = c.Rows("SELECT id,data_json FROM resident ORDER BY id").DeepClone(); host.AddModule(lifecycle); Check("ordinary startup retains saved resident identities " + label, before, c.Rows("SELECT id,data_json FROM resident ORDER BY id"));
                lifecycle.Update(new JsonObject { ["eventSize"] = 50, ["townSize"] = size }); Check("population settings do not rebuild a live town " + label, before, c.Rows("SELECT id,data_json FROM resident ORDER BY id"));
                var stages = new JsonArray(); lifecycle.StageCompleted = (id, count) => stages.Add(new JsonObject { ["id"] = id, ["count"] = count }); lifecycle.NewSeed = () => seed; host.Reset(); var actual = population.Snapshot();
                Check("all nineteen original stage counts " + label, test["stages"], stages); Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(Path.Combine(Path.GetDirectoryName(output)!, "latest-native-town.json"), actual.ToJsonString()); Check("complete original fresh residents and private town " + label, test["town"], actual);
                var world = new JsonObject(); foreach (var pair in test["world"]!.AsObject()) world[pair.Key] = c.World(pair.Key)?.DeepClone(); Check("all original persisted augmentation records " + label, test["world"], world);
                Check("all original NPC metadata " + label, test["npcs"], c.Rows("SELECT id,name,role,district,faction FROM npc ORDER BY id")); Check("original population view after new week " + label, test["view"], lifecycle.View());
                Check("source stage order is explicit " + label, new JsonArray(NativeTownPopulationLifecycle.StageOrder.Select(s => (JsonNode)JsonValue.Create(s)!).ToArray()), new JsonArray(stages.Select(s => s!["id"]!.DeepClone()).ToArray()));
                lifecycle.Update(new JsonObject { ["eventSize"] = 20, ["townSize"] = "large" }); Check("event population takes effect immediately " + label, JsonValue.Create(20), JsonValue.Create(lifecycle.EventPeopleMax())); Check("event count clamps and rounds " + label, new JsonArray(0, 20, 0, 20), new JsonArray(lifecycle.ClampEventCount(-9), lifecycle.ClampEventCount(25), lifecycle.ClampEventCount(double.NaN), lifecycle.ClampEventCount(19.5)));
                Check("next-week town setting preserves current size " + label, JsonValue.Create(size), lifecycle.View()["current"]!["size"]); Check("loaded residents keep current households " + label, actual["residents"], population.Snapshot()["residents"]);
                host.NotifyLoaded(); Check("load preserves people and settings " + label, actual["residents"], population.Snapshot()["residents"]); Check("load keeps next-week size choice " + label, JsonValue.Create("large"), JsonValue.Create(lifecycle.TownSize()));
                foreach (var bad in new[] { new JsonObject { ["eventSize"] = 21 }, new JsonObject { ["eventSize"] = "20" }, new JsonObject { ["eventSize"] = null }, new JsonObject { ["townSize"] = "enormous" }, new JsonObject { ["townSize"] = 20 }, new JsonObject { ["townSize"] = null } }) { bool rejected = false; try { lifecycle.Update(bad); } catch (NativeServiceException error) { rejected = error.Status == 400; } Check("invalid original population setting " + label + " " + bad.ToJsonString(), JsonValue.Create(true), JsonValue.Create(rejected)); }
                c.Execute("INSERT INTO player(id,name,money_c,food,warmth,health,sleep,day,hour,district,rent_paid_until) VALUES(2,'Guest',50,7,7,8,7,1,6,'rijnkaai',0)"); bool denied = false; try { host.Call("POST", "/api/settings/population", "{\"eventSize\":100}", 2).GetAwaiter().GetResult(); } catch (NativeServiceException error) { denied = error.Status == 403; } Check("guest cannot change host population settings " + label, JsonValue.Create(true), JsonValue.Create(denied && lifecycle.EventPeopleMax() == 20));
                GD.Print("native complete population " + label + ": " + actual["residents"]!.AsArray().Count + " residents");
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native population lifecycle proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
