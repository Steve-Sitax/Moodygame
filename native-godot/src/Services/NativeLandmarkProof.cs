using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;

namespace Scheldemist.Native.Services;

/// <summary>Original TypeScript clock, roster and entered-event oracles against an isolated native database.</summary>
public partial class NativeLandmarkProof : Node
{
    public override async void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-landmarks/result.json"); string data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data"); long now = 100000;
            using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"), () => now, () => .5)); var town = new NativeTown(host); host.AddModule(town); var landmarks = new NativeLandmarks(host, town); host.AddModule(landmarks);
            var results = new List<object>(); void Check(string name, bool passed, object? evidence = null) { results.Add(new { name, passed, evidence }); if (!passed) throw new InvalidOperationException("Landmark proof failed: " + name + "; " + JsonSerializer.Serialize(evidence)); }
            double N(JsonNode? value) => NativeTown.N(value); string S(JsonNode? value, string key) => NativeTown.S(value, key);
            void Clock(int day, double hour) => host.Context.Execute("UPDATE player SET day=$p0,hour=$p1,minute=$p2 WHERE id=1", day, (int)Math.Floor(hour), (int)Math.Round((hour % 1) * 60));
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/landmarks-1873.json")))!;
            foreach (var clock in oracle["clocks"]!.AsArray()) {
                int day = (int)N(clock?["day"]); double hour = N(clock?["h"]);
                Check($"original landmark clock {day}:{hour}", NativeLandmarks.Ids.All(id => NativeLandmarks.Open(id, day, hour) == clock!["open"]![id]!.GetValue<bool>()) && JsonNode.DeepEquals(NativeLandmarks.Mass(day, hour), clock?["mass"]) && NativeLandmarks.ConfessionOpen(day, hour) == clock!["confession"]!.GetValue<bool>() && NativeLandmarks.CivilNow(day, hour) == (clock["civil"] != null) && JsonNode.DeepEquals(NativeLandmarks.Theatre(day, hour), clock["theatre"]));
            }
            foreach (var expected in oracle["rosters"]!.AsArray()) {
                Clock((int)N(expected?["day"]), N(expected?["hour"])); var actual = landmarks.View(S(expected, "id"));
                Check($"original landmark roster {S(expected, "id")}:{N(expected?["day"])}:{N(expected?["hour"])}", JsonNode.DeepEquals(actual, expected), JsonNode.DeepEquals(actual, expected) ? actual["people"]!.AsArray().Count : new JsonObject { ["expected"] = expected!.DeepClone(), ["actual"] = actual });
            }
            foreach (var row in oracle["eventCases"]!.AsArray()) {
                host.Context.Execute("DELETE FROM npc_action"); host.Context.Execute("DELETE FROM town_event"); Clock((int)N(row?["day"]), N(row?["h"]));
                foreach (var e in row!["events"]!.AsArray()) host.Context.Execute("INSERT INTO town_event(id,day,title,template,place,x,z,r,start_m,end_m,stage,stages_json,people_json,leads_json,status,source) VALUES($p0,$p1,$p2,$p3,$p4,0,0,1,$p5,1440,$p6,$p7,$p8,$p9,$p10,'engine')", (int)N(e?["id"]), (int)N(e?["day"]), S(e, "title"), S(e, "template"), S(e, "place"), (int)N(e?["start_m"]), (int)N(e?["stage"]), S(e, "stages_json"), S(e, "people_json"), S(e, "leads_json"), S(e, "status"));
                foreach (var a in row["actions"]!.AsArray()) host.Context.Execute("INSERT INTO npc_action(id,npc_id,event_id,source,status,started,until,phase,data_json,kind) VALUES($p0,$p1,$p2,'event',$p3,0,9999,$p4,$p5,'attend')", (int)N(a?["id"]), S(a, "npc_id"), (int)N(a?["event_id"]), S(a, "status"), S(a, "phase"), S(a, "data_json"));
                var actual = landmarks.View("cathedral"); Check("original entered event " + S(row, "name"), JsonNode.DeepEquals(actual, row["view"]) && JsonNode.DeepEquals(landmarks.Doors(), row["doors"]), new JsonObject { ["expected"] = row["view"]!.DeepClone(), ["actual"] = actual });
                var hall = landmarks.Hall(); var expectedHall = row["hall"]; Check("actual event participants " + S(row, "name"), hall == null && expectedHall == null || hall != null && expectedHall != null && JsonNode.DeepEquals(hall["inside"], expectedHall["inside"]) && S(hall, "kind") == S(expectedHall, "kind") && S(hall, "part") == S(expectedHall, "part") && N(hall["from_m"]) == N(expectedHall["from_m"]) && N(hall["to_m"]) == N(expectedHall["to_m"]));
            }
            host.Context.Execute("DELETE FROM npc_action"); host.Context.Execute("DELETE FROM town_event"); Clock(1, 7.5); host.Context.Execute("UPDATE player SET money_c=50 WHERE id=1");
            landmarks.Chair(); Check("chair price once per actual service", N(landmarks.Chair()["paid_c"]) == 0 && NativeCoreClock.Number(host.Player(1), "money_c") == 49);
            landmarks.Candle(); Check("candle uses engine price and durable log", NativeCoreClock.Number(host.Player(1), "money_c") == 47 && host.Context.Scalar<int>("SELECT COUNT(*) FROM log WHERE verb='lit_candle'") == 1);
            Clock(1, 9); host.Context.Execute("UPDATE player SET money_c=0 WHERE id=1"); Check("poor player can sit without debt", N(landmarks.Chair()["paid_c"]) == 0); host.Context.Execute("UPDATE player SET money_c=50 WHERE id=1"); Check("poor chair is remembered for service", N(landmarks.Chair()["paid_c"]) == 0 && NativeCoreClock.Number(host.Player(1), "money_c") == 50);
            Clock(1, 7); landmarks.SetInside(1, "cathedral"); host.Context.Execute("UPDATE faction_trust SET trust=0 WHERE faction='kerk' AND player_id=1");
            var first = landmarks.Ran(1, JsonValue.Create(1)); Check("running during mass counts and costs trust", N(first["strike"]) == 1 && N(first["delta"]) == -1); Check("running cooldown rejects immediate repeat", landmarks.Ran(1, JsonValue.Create(60))["counted"]!.GetValue<bool>() == false);
            Clock(1, 7.25); var second = landmarks.Ran(1, JsonValue.Create(1)); Clock(1, 7.5); var third = landmarks.Ran(1, JsonValue.Create(1)); Check("third strike bars door with two-trust daily cap", N(second["delta"]) == -1 && N(third["delta"]) == 0 && third["leave"]!.GetValue<bool>() && landmarks.Barred());
            Clock(1, 8.5); Check("cathedral bar expires after one game hour", !landmarks.Barred());
            var begin = JsonNode.Parse(await host.Call("POST", "/api/landmark/confess/begin", "{}"))!; Check("actual curate opens confessional", begin["priest"]!.GetValue<string>() == "lm_curate");
            string secret = "I stole a purse, native private fixture."; int money = NativeCoreClock.Number(host.Player(1), "money_c"); var answer = JsonNode.Parse(await host.Call("POST", "/api/landmark/confess", new JsonObject { ["text"] = secret }.ToJsonString()))!;
            Check("private confession has engine-owned penance", S(answer, "source") == "engine" && S(answer, "penance") == NativeLandmarks.Penance("theft")); Check("confession changes no money or stores no words", money == NativeCoreClock.Number(host.Player(1), "money_c") && host.Context.Scalar<int>("SELECT COUNT(*) FROM world_state WHERE value_json LIKE $p0", "%" + secret + "%") == 0 && host.Context.Scalar<int>("SELECT COUNT(*) FROM npc_memory WHERE text LIKE $p0", "%" + secret + "%") == 0 && host.Context.Scalar<int>("SELECT COUNT(*) FROM log WHERE text LIKE $p0", "%" + secret + "%") == 0);
            answer = JsonNode.Parse(await host.Call("POST", "/api/landmark/confess", "{\"text\":\"I stole a purse\"}"))!; Check("confession shares five-second typed cooldown", S(answer, "gated") == "too fast"); now += 5000;
            landmarks.NarrateAsync = async (_, _, _) => { await Task.Yield(); return new JsonObject { ["line"] = "God is patient. Keep your hands to honest work." }; };
            answer = JsonNode.Parse(await host.Call("POST", "/api/landmark/confess", "{\"text\":\"I lied\"}"))!; Check("async priest answers without locking state", S(answer, "source") == "claude" && S(answer, "penance") == NativeLandmarks.Penance("lies")); now += 5000;
            landmarks.NarrateAsync = (_, _, _) => Task.FromResult<JsonObject?>(new JsonObject { ["line"] = "I will give you 100 centimes." }); answer = JsonNode.Parse(await host.Call("POST", "/api/landmark/confess", "{\"text\":\"I lied\"}"))!; Check("invalid priest promises use engine fallback", S(answer, "source") == "engine" && NativeCoreClock.Number(host.Player(1), "money_c") == money);
            Check("priest guard permits saints and removes Dutch address", NativeLandmarks.CleanPriest("God and Our Lady hear you.") != null && NativeLandmarks.CleanPriest("Ach, jongen, come back.") == "Come back.");
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks = results }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native landmark proof: {results.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
