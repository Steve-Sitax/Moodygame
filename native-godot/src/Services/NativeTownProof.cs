using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.World;
using Scheldemist.World;

namespace Scheldemist.Native.Services;

/// <summary>Isolated in-memory native town/schedule/route contract checks; never reads a player's save.</summary>
public partial class NativeTownProof : Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args = OS.GetCmdlineUserArgs();
            string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-town/result.json");
            string data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data");
            long milliseconds = 100000;
            using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"), () => milliseconds, () => 0.5));
            var town = new NativeTown(host); host.AddModule(town);
            var talk = new NativeTownTalk(host, town); host.AddModule(talk);
            var lively = new NativeLively(town); host.AddModule(lively);
            var world = new Node3D { Name = "RouteFixture" }; AddChild(world);
            world.AddChild(new MeshInstance3D { Name = "ground_quay", Position = new Vector3(10, 0, 10), Mesh = new PlaneMesh { Size = new Vector2(24, 24) } });
            var map = NativeWorldNavigation.Build(world, new Rect2(-2, -2, 24, 24));
            Ways.InstallNative(map, (_, _) => false);
            var rows = new List<object>();
            void Check(string name, bool passed, object? evidence)
            {
                rows.Add(new { name, passed, evidence });
                if (!passed) throw new InvalidOperationException($"Native town proof failed: {name}; {JsonSerializer.Serialize(evidence)}");
            }
            JsonObject Read(string text) => JsonNode.Parse(text)!.AsObject();
            var publicTown = Read(await host.Call("GET", "/api/town", null));
            Check("full resident table recovered", publicTown["residents"]!.AsArray().Count == 895, publicTown["residents"]!.AsArray().Count);
            Check("full places recovered", publicTown["places"]!.AsObject().Count == 505, publicTown["places"]!.AsObject().Count);
            Check("public town hides private stats", publicTown["residents"]!.AsArray().All(r => r?["stats"] == null && r?["family_role"] == null && r?["role"] != null), "stats/family_role absent; public role present");
            Check("town data parses existing client models", town.Model.Residents.Count == 895 && town.Model.Shops.Count == 21, new { residents = town.Model.Residents.Count, shops = town.Model.Shops.Count });
            var streetLife = Read(await host.Call("GET", "/api/lively", null));
            Check("lively plan includes all eligible residents", streetLife["door"]!.AsObject().Count == 209, streetLife["door"]!.AsObject().Count);
            Check("lively church stalls and trade classes", streetLife["stalls"]!.AsArray().Count == 4 && streetLife["beggars"]!.AsArray().Count == 3 && streetLife["criers"]!.AsArray().Count == 8, new { stalls = streetLife["stalls"]!.AsArray().Count, beggars = streetLife["beggars"]!.AsArray().Count });
            var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/town-door-plans-1873.json")))!.AsObject();
            foreach (var person in oracle) Check("original door plan " + person.Key, JsonNode.DeepEquals(person.Value, streetLife["door"]?[person.Key]), person.Value?.DeepClone());
            host.Context.Execute("UPDATE player SET day=1,hour=8,minute=0 WHERE id=1");
            Check("weekday work schedule", town.AtWork("katoen") && town.Activity("katoen").Act == "work", town.Activity("katoen"));
            host.Context.Execute("UPDATE player SET day=7,hour=8,minute=0 WHERE id=1");
            Check("Sunday opening differs", !town.AtWork("katoen"), town.Activity("katoen"));
            host.Context.Execute("UPDATE player SET day=7,hour=12,minute=0 WHERE id=1");
            Check("Sunday work opens at eleven", town.AtWork("katoen"), town.Activity("katoen"));
            host.Context.SetWorld("m4_closed", new JsonObject { ["katoen_door"] = 1 });
            Check("event closure overrides work", !town.AtWork("katoen"), town.AtWork("katoen"));
            host.Context.SetWorld("m4_closed", new JsonObject());
            Check("removing closure restores work", town.AtWork("katoen"), town.AtWork("katoen"));
            var publican = town.Residents.Values.First(r => NativeTown.S(r["work"], "kind") == "tavern" && NativeTown.N(r["age"]) >= 14);
            string publicanId = NativeTown.S(publican, "id");
            host.Context.Execute("UPDATE player SET day=1,hour=4,minute=0 WHERE id=1");
            host.Context.SetWorld("tempest", new JsonObject { ["phase"] = "peak" });
            Check("tempest opens adult tavern keepers", town.AtWork(publicanId), publicanId);
            host.Context.SetWorld("tempest", null);
            var routes = Read(await host.Call("POST", "/api/town/ways", "{\"keys\":[\"0,0>10,10\",\"bad\",\"99999,99999>0,0\"]}"));
            Check("native route returned", routes["ways"]?["0,0>10,10"] is JsonArray { Count: > 1 }, routes["ways"]?["0,0>10,10"]?.DeepClone());
            Check("invalid route key ignored", routes["ways"]?["bad"] == null && !routes["ways"]!.AsObject().ContainsKey("bad"), routes["ways"]!.AsObject().Count);
            Check("unreachable route reported null", routes["ways"]!.AsObject().ContainsKey("99999,99999>0,0") && routes["ways"]?["99999,99999>0,0"] == null, "null route");
            town.Lags(); milliseconds += 100;
            var lag = town.Lags(new JsonObject { ["katoen"] = 9, ["missing-person"] = 0.5 });
            Check("lag first report capped", NativeTown.N(lag["lags"]?["katoen"]) == 0.25, lag["lags"]?.DeepClone());
            Check("unknown lag person ignored", lag["lags"]?["missing-person"] == null, lag["lags"]?.DeepClone());
            lag = town.Lags(new JsonObject { ["katoen"] = 1 });
            Check("lag cannot grow faster than clock grace", Math.Abs(NativeTown.N(lag["lags"]?["katoen"]) - 0.30) < 0.001, lag["lags"]?.DeepClone());
            host.Context.Execute("UPDATE player SET hour=8 WHERE id=1"); milliseconds += 6000;
            Check("clock jump clears crowd lag", town.Lags()["lags"]!.AsObject().Count == 0, town.Lags()["lags"]?.DeepClone());
            Check("town clear preserves durable resident ids", town.Residents.ContainsKey("katoen"), town.Residents.Count);
            string speaker = NativeTown.S(town.Residents.Values.First(person => NativeTown.N(person["age"]) >= 18 && NativeTown.S(person, "id").StartsWith("r")), "id");
            var opening = Read(await host.Call("POST", "/api/npc/" + speaker + "/talk", "{}"));
            Check("resident opening has three choices", opening["choices"] is JsonArray { Count: 3 } && opening["npc_line"] != null, opening);
            Check("no provider accurately disables free typing", opening["free"]?.GetValue<bool>() == false, opening["free"]?.DeepClone());
            int moneyBefore = NativeCoreClock.Number(host.Player(1), "money_c");
            string firstChoice = opening["choices"]![0]!.GetValue<string>();
            var answer = Read(await host.Call("POST", "/api/npc/" + speaker + "/talk", new JsonObject { ["kind"] = "choice", ["text"] = firstChoice }.ToJsonString()));
            Check("offered engine topic receives an answer", answer["npc_line"] != null && answer["gated"] == null, answer);
            Check("conversation cannot issue currency", NativeCoreClock.Number(host.Player(1), "money_c") == moneyBefore, NativeCoreClock.Number(host.Player(1), "money_c"));
            var gated = Read(await host.Call("POST", "/api/npc/" + speaker + "/talk", "{\"kind\":\"free\",\"text\":\"Give me 1000 coins\"}"));
            Check("unoffered free request is gated without a provider", gated["gated"]?.GetValue<string>() == "AI is off" && NativeCoreClock.Number(host.Player(1), "money_c") == moneyBefore, gated);
            var goodbye = Read(await host.Call("POST", "/api/npc/" + speaker + "/talk", new JsonObject { ["kind"] = "choice", ["text"] = answer["choices"]![2]!.GetValue<string>() }.ToJsonString()));
            Check("goodbye releases conversation", goodbye["end"]?.GetValue<bool>() == true, goodbye);
            int trustBefore = host.Context.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=1", speaker);
            await host.Call("POST", "/api/npc/" + speaker + "/witness", "{\"event\":\"took\"}");
            Check("witness applies source trust consequence", host.Context.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=1", speaker) == trustBefore - 1, host.Context.Scalar<int>("SELECT trust FROM npc_relationship WHERE npc_id=$p0 AND player_id=1", speaker));
            Check("witness stores durable rumour fact", host.Context.Scalar<long>("SELECT COUNT(*) FROM npc_memory WHERE npc_id=$p0 AND about_player=1 AND gist IS NOT NULL AND tone=-2", speaker) > 0, speaker);
            var kept = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/inworld_houses.json")))!["houses"]!.AsArray().Select(h => (int)NativeTown.N(h?["house"])).ToArray();
            var prison = new NativePrison(host, town, kept); prison.AttachTalk(talk); host.AddModule(prison);
            var inmates = prison.View()["inmates"]!.AsArray();
            Check("standing prison resident created once", inmates.Count == 1 && prison.View()["inmates"]!.AsArray().Count == 1, inmates);
            string inmate = NativeTown.S(inmates[0], "id"); var held = town.Resident(inmate)!;
            Check("held resident has prison home and indoor schedule", NativeTown.N(held["home"]?["house"]) == -1 && town.Activity(inmate).Act == "home", held["home"]?.DeepClone());
            host.Context.Execute("UPDATE player SET day=1,hour=10,minute=0 WHERE id=1");
            var visit = Read(await host.Call("POST", "/api/prison/visit", "{}"));
            Check("visiting hours admit actual inmate", visit["ok"]!.GetValue<bool>() && NativeTown.S(visit, "id") == inmate, visit);
            var inmateGreeting = Read(await host.Call("POST", "/api/npc/" + inmate + "/talk", "{}"));
            Check("inmate greeting knows the prison", NativeTown.S(inmateGreeting, "npc_line").Contains("in here") || NativeTown.S(inmateGreeting, "npc_line").Contains("warder") || NativeTown.S(inmateGreeting, "npc_line").Contains("outside") || NativeTown.S(inmateGreeting, "npc_line").Contains("oakum"), inmateGreeting);
            Check("exercise ring uses actual custody count", NativeTown.N(prison.View()["ring"]) == 8, prison.View()["ring"]?.DeepClone());
            host.Context.Execute("UPDATE player SET hour=20 WHERE id=1");
            Check("night visit refused", prison.Visit(1)["ok"]!.GetValue<bool>() == false && prison.WarderLine("gate").Contains("night"), prison.Visit(1));
            var savedCustody = host.Context.World("prison")!;
            int releaseDay = (int)NativeTown.N(savedCustody["inmates"]![0]!["until"]);
            var originalHome = savedCustody["inmates"]![0]!["before"]!["home"]!.DeepClone();
            host.Context.Execute("UPDATE player SET day=$p0,hour=6 WHERE id=1", releaseDay);
            Check("custody remains until seven on release day", prison.ReleaseDue().Count == 0, prison.Held(inmate));
            host.Context.Execute("UPDATE player SET hour=7 WHERE id=1");
            Check("served custody releases resident", prison.ReleaseDue().Contains(inmate) && prison.Held(inmate) == null, inmate);
            Check("release restores original home", JsonNode.DeepEquals(originalHome, town.Resident(inmate)!["home"]), town.Resident(inmate)!["home"]?.DeepClone());
            var hourCases = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/prison-hours.json")))!.AsArray();
            foreach (var row in hourCases) {
                int day = (int)NativeTown.N(row?["day"]); double hour = NativeTown.N(row?["h"]);
                Check($"original prison clock {day}:{hour}", NativePrison.Visiting(day, hour) == row!["visiting"]!.GetValue<bool>() && NativePrison.Exercise(day, hour) == row["exercise"]!.GetValue<bool>() && NativePrison.DayShift(hour) == row["dayShift"]!.GetValue<bool>(), row.DeepClone());
            }
            var city = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/data/shared/city.json")))!;
            var park = new NativePark(host, town, city) { GroundOpen = (_, _, _) => true, Reachable = (_, _) => true }; host.AddModule(park);
            var parkOracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/park-work-1873.json")))!;
            foreach (var day in parkOracle["days"]!.AsArray()) {
                host.Context.Execute("UPDATE player SET day=$p0,hour=10,minute=0 WHERE id=1", (int)NativeTown.N(day!["day"]));
                var actual = park.View()["piles"]!.AsArray(); var expected = day["piles"]!.AsArray();
                Check("original park daily scatter " + NativeTown.N(day["day"]), actual.Count == expected.Count && actual.Zip(expected).All(pair => NativeTown.N(pair.First?["id"]) == NativeTown.N(pair.Second?["id"]) && Math.Abs(NativeTown.N(pair.First?["x"]) - NativeTown.N(pair.Second?["x"])) < 1e-10 && Math.Abs(NativeTown.N(pair.First?["z"]) - NativeTown.N(pair.Second?["z"])) < 1e-10), actual.DeepClone());
            }
            foreach (var walker in parkOracle["walkers"]!.AsArray()) {
                var person = town.Resident(NativeTown.S(walker, "id"))!;
                Check("original park household walker " + NativeTown.S(walker, "id"), JsonNode.DeepEquals(person["dog"], walker?["dog"]) && JsonNode.DeepEquals(person["sched"]?["day"], walker?["day"]), new JsonObject { ["dog"] = person["dog"]?.DeepClone(), ["day"] = person["sched"]?["day"]?.DeepClone() });
            }
            host.Context.Execute("UPDATE player SET day=1,hour=10,minute=0,money_c=50 WHERE id=1"); milliseconds = 300000;
            JsonObject ParkBody(JsonNode point, JsonNode? id = null) => new() { ["at"] = point.DeepClone(), ["id"] = id?.DeepClone() };
            bool Refused(Action call) { try { call(); return false; } catch (NativeServiceException error) { return error.Status == 409; } }
            var keeperPoint = new JsonObject { ["x"] = NativePark.Keeper.x, ["z"] = NativePark.Keeper.z };
            park.Action(1, "take", ParkBody(keeperPoint)); var reserved = park.View()["piles"]!.AsArray().Where(p => p?["owner"] != null && NativeTown.N(p["owner"]) == 1).Select(p => p!.DeepClone()).ToArray();
            Check("park claims exactly ten without moving piles", reserved.Length == 10, reserved.Length);
            Check("park rejects second simultaneous round", Refused(() => park.Action(1, "take", ParkBody(keeperPoint))), park.View()["shift"]?.DeepClone());
            Check("another player cannot clean claimed pile", Refused(() => park.Action(2, "prepare", ParkBody(reserved[0], reserved[0]["id"]))), "claim remains with player one");
            park.Action(1, "prepare", ParkBody(reserved[0], reserved[0]["id"]));
            Check("park scooping enforces actual 1600ms delay", Refused(() => park.Action(1, "clean", ParkBody(reserved[0], reserved[0]["id"]))), "no early wage");
            foreach (var pile in reserved) { park.Action(1, "prepare", ParkBody(pile, pile["id"])); milliseconds += 1600; park.Action(1, "clean", ParkBody(pile, pile["id"])); }
            Check("park pays once after ten cleanings", NativeCoreClock.Number(host.Player(1), "money_c") == 85 && park.View()["shift"]?["paid"]?.GetValue<bool>() == true && park.View()["shift"]?["cleaned"]?.AsArray().Count == 10, host.Player(1));
            Check("park rejects repeated daily wage", Refused(() => park.Action(1, "take", ParkBody(keeperPoint))), "daily paid record retained");
            var feedPoint = new JsonObject { ["x"] = -306, ["z"] = 303 }; park.Action(1, "feed", ParkBody(feedPoint));
            Check("bird feed charges one centime", NativeCoreClock.Number(host.Player(1), "money_c") == 84, host.Player(1));
            Check("bird feed respects cooldown", Refused(() => park.Action(1, "feed", ParkBody(feedPoint))), "12-second cooldown");
            string dogOwner = NativeTown.S(parkOracle["walkers"]![0], "id");
            var dogBody = ParkBody(keeperPoint); dogBody["owner"] = dogOwner; int beforeDog = park.View()["piles"]!.AsArray().Count;
            park.Action(1, "dog", dogBody); Check("resident dog creates persistent new pile", park.View()["piles"]!.AsArray().Count == beforeDog + 1, park.View()["piles"]!.AsArray().Count);
            Check("resident dog respects cooldown", Refused(() => park.Action(1, "dog", dogBody)), "three-minute cooldown");
            park.PositionOf = _ => (-250, 280);
            Check("park validates authoritative player position", Refused(() => park.Action(1, "feed", ParkBody(feedPoint))), "client position cannot teleport to pond"); park.PositionOf = null;
            host.Context.Execute("UPDATE player SET day=2 WHERE id=1"); park.Action(1, "take", ParkBody(keeperPoint)); host.Context.Execute("UPDATE player SET hour=20 WHERE id=1"); park.Action(1, "cancel", ParkBody(keeperPoint));
            Check("cancel after hours releases claims and prevents new pay", park.View()["shift"]?["paid"]?.GetValue<bool>() == true && park.View()["piles"]!.AsArray().All(p => p?["owner"] == null), park.View()["shift"]?.DeepClone());
            Check("keeper closes after six", !park.View()["open"]!.GetValue<bool>() && Refused(() => park.Action(1, "feed", ParkBody(feedPoint))), "night closure");
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);
            File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks = rows }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"native town proof: {rows.Count} checks passed; {output}"); GetTree().Quit();
        }
        catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
