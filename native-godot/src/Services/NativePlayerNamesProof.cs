using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.Native.Services;

public partial class NativePlayerNamesProof : Node
{
    public override void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-player-names/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data"); var oracle = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://services/fixtures/player-names.json")))!; var checks = new List<object>();
            void Check(string name, string expected, string actual) { bool passed = expected == actual; checks.Add(new { name, passed, expected, actual }); if (!passed) { Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, checks }, new JsonSerializerOptions { WriteIndented = true })); throw new InvalidOperationException(name); } }
            int i = 0; foreach (var row in oracle["cases"]!.AsArray()) {
                using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var profile = new NativeTownProfile(host); var config = row!["config"]!; var c = host.Context;
                c.Execute("DELETE FROM player_profile"); c.Execute("DELETE FROM mp_player"); c.Execute("DELETE FROM player WHERE id<>1");
                if (config["hostProfile"] != null) profile.Save(1, config["hostProfile"]);
                if (config["player"] != null || config["guestProfile"] != null) c.Execute("INSERT INTO player(id,name,money_c,food,warmth,health,sleep,day,hour,district,rent_paid_until) VALUES(2,$p0,100,50,50,50,50,1,8,'town',0)", config["player"]?.GetValue<string>() ?? "");
                if (config["mp"] != null) c.Execute("INSERT INTO mp_player(id,name,token_hash,created_at)VALUES(2,$p0,'proof-token','proof')", config["mp"]!.GetValue<string>());
                if (config["guestProfile"] != null) profile.Save(2, config["guestProfile"]);
                int player = (int)NativeTown.N(row["player"]); string text = row["text"]!.GetValue<string>(), label = "source names " + i++;
                Check(label + " precedence", row["name"]!.GetValue<string>(), profile.NameOf(player)); Check(label + " shared storage", row["stored"]!.GetValue<string>(), profile.Store(player, text)); Check(label + " guest reading", row["read"]!.GetValue<string>(), profile.Read(player, text));
            }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native player names proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
