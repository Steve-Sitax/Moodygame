using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Menu;

namespace Scheldemist.Native.Services;

public partial class NativeProfileProof : Node
{
    public override async void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-profile/result.json"); string data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data");
            var results = new List<object>(); void Check(string name, bool passed, object? evidence = null) { results.Add(new { name, passed, evidence }); if (!passed) throw new InvalidOperationException("Profile proof failed: " + name + "; " + JsonSerializer.Serialize(evidence)); }
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/profile-1873.json")))!; int index = 0;
            foreach (var row in oracle["profiles"]!.AsArray()) {
                var actual = NativeTownProfile.Check(row?["raw"]); string name = "original character " + index++;
                if (row?["checked"] == null) { Check(name + " invalid object", actual == null); continue; }
                var p = actual!.Value.Profile; var expected = row!["checked"]!;
                Check(name + " clamp", JsonNode.DeepEquals(JsonNode.Parse(Character.ToJson(p)), expected["profile"]) && JsonNode.DeepEquals(new JsonArray(actual.Value.Fixed.Select(f => (JsonNode)JsonValue.Create(f)!).ToArray()), expected["fixed"]), new JsonObject { ["profile"] = JsonNode.Parse(Character.ToJson(p)), ["fixed"] = new JsonArray(actual.Value.Fixed.Select(f => (JsonNode)JsonValue.Create(f)!).ToArray()) });
                string code = NativeTownProfile.Code(p); Check(name + " appearance code", code == row["code"]!.GetValue<string>(), code);
                Check(name + " decoded appearance", JsonNode.DeepEquals(JsonNode.Parse(Character.ToJson(NativeTownProfile.FromCode(code, p.First, p.Last)!)), row["decoded"]));
                Check(name + " look and words", Character.AgeBand(p.Age) == row["band"]!.GetValue<string>() && Character.LookLine(p) == row["look"]!.GetValue<string>() && JsonNode.DeepEquals(NativeTownProfile.Words(p), row["words"]));
                Check(name + " addressed and named prose", NativeTownProfile.About(p, row["text"]!.GetValue<string>()) == row["about"]!.GetValue<string>() && NativeTownProfile.Addressed(p, row["text"]!.GetValue<string>()) == row["addressed"]!.GetValue<string>());
            }
            index = 0; foreach (var row in oracle["gates"]!.AsArray()) {
                var actual = NativeTownDialogueGate.Check(row!["raw"]!.GetValue<string>(), (long)NativeTown.N(row["now"]), (long)NativeTown.N(row["last"])); var expected = row["result"]!;
                Check("original typed gate " + index++, expected["ok"]!.GetValue<bool>() ? actual.reason == null && actual.text == expected["text"]!.GetValue<string>() : actual.reason == expected["reason"]!.GetValue<string>(), actual);
            }
            using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"), () => 100000, () => .5)); var profile = new NativeTownProfile(host); host.AddModule(profile); var arrival = new NativeTownArrival(host); host.AddModule(arrival);
            JsonNode Read(string json) => JsonNode.Parse(json)!;
            Check("missing profile is original Jef", Read(await host.Call("GET", "/api/player/profile", null))["made"]!.GetValue<bool>() == false && profile.Of().First == "Jef");
            var saved = Read(await host.Call("PUT", "/api/player/profile", "{\"profile\":{\"first\":\"Marie\",\"last\":\"De Smet\",\"sex\":\"woman\",\"age\":45}}"));
            Check("creator stores look and player row name", saved["made"]!.GetValue<bool>() && NativeTown.S(host.Player(1), "name") == "Marie" && profile.Stored()?.Sex == "woman");
            var look = Read(await host.Call("GET", "/api/player/1/look", null)); Check("public player look matches stored code", look["code"]!.GetValue<string>() == saved["code"]!.GetValue<string>() && look["first"]!.GetValue<string>() == "Marie");
            Check("new week preserves character", Read(await host.Call("POST", "/api/new-game", "{}"))["player"]?["name"]?.GetValue<string>() == "Marie" && profile.Stored()?.First == "Marie");
            host.Context.SetPlayerState(1, "arrival", new JsonObject { ["stage"] = "ferry", ["creator"] = true, ["log"] = true }); int initialLogs = host.Context.Scalar<int>("SELECT COUNT(*) FROM log WHERE verb='arrived'");
            Check("ferry remembers creator state", arrival.View()["creator"]!.GetValue<bool>()); await host.Call("POST", "/api/arrival/made", "{}"); Check("creator made preserves ferry arrival", arrival.Stage() == "ferry" && !arrival.View()["creator"]!.GetValue<bool>());
            await host.Call("POST", "/api/arrival/ashore", "{}"); await host.Call("POST", "/api/arrival/ashore", "{}"); Check("arrival is idempotent and logs once", arrival.Stage() == "ashore" && host.Context.Scalar<int>("SELECT COUNT(*) FROM log WHERE verb='arrived'") == initialLogs + 1);
            host.Context.Execute("DELETE FROM player_state WHERE key='arrival'"); host.Context.Execute("DELETE FROM world_state WHERE key='arrival'"); Check("old save without arrival is ashore", arrival.Stage() == "ashore");
            bool refused = false; try { await host.Call("POST", "/api/player/new-man", "{}"); } catch (NativeServiceException error) { refused = error.Status == 409; } Check("single-player new man keeps new-week rule", refused);
            Check("appearance decoder rejects malformed codes", NativeTownProfile.FromCode("wrong") == null && NativeTownProfile.FromCode("A!!!!!!!!!!!!!!!!!!!") == null);
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks = results }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native profile proof: {results.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
