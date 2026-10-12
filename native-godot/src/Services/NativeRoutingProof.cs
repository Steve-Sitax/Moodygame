using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Native.World;
using Scheldemist.World;

namespace Scheldemist.Native.Services;

/// <summary>Heavy full-population routing must leave clock/state access responsive and return one complete shared plan.</summary>
public partial class NativeRoutingProof : Node3D
{
    public override async void _Ready()
    {
        try {
            var args = OS.GetCmdlineUserArgs(); string output = args.Length > 0 ? args[0] : ProjectSettings.GlobalizePath("res://proof/native-routing/result.json"), data = args.Length > 1 ? args[1] : ProjectSettings.GlobalizePath("res://services/data"); var checks = new List<object>();
            void Check(string name, bool passed, object? evidence = null) { checks.Add(new { name, passed, evidence }); if (!passed) throw new InvalidOperationException(name); }
            using var host = new NativeServiceHost(new NativeServiceOptions(":memory:", data, Path.Combine(Path.GetDirectoryName(output)!, "isolated-saves"))); var town = new NativeTown(host); host.AddModule(town);
            var world = new Node3D { Name = "NativeRouteSupport" }; AddChild(world); world.AddChild(new MeshInstance3D { Name = "ground_quay", Position = new Vector3(10, 0, 10), Mesh = new PlaneMesh { Size = new Vector2(24, 24) } }); Ways.InstallNative(NativeWorldNavigation.Build(world, new Rect2(-2, -2, 24, 24)), (_, _) => false);
            // Parse once before timing route work, as the game's preceding /api/town ask does.
            await host.WithState(_ => town.Model); var first = Task.Run(() => host.Call("GET", "/api/town/ways", null)); var second = Task.Run(() => host.Call("GET", "/api/town/ways", null));
            var timer = Stopwatch.StartNew(); var state = host.Call("GET", "/api/state", null); var completed = await Task.WhenAny(state, Task.Delay(1500));
            Check("state access stays responsive during full town routing", ReferenceEquals(completed, state), new { milliseconds = timer.ElapsedMilliseconds }); await state;
            var routes = JsonNode.Parse(await first)!; Check("full routing reply is valid", routes["ways"] is JsonObject, routes["ways"]?.AsObject().Count); Check("simultaneous request shares the same complete plan", JsonNode.DeepEquals(routes, JsonNode.Parse(await second)));
            var cached = JsonNode.Parse(await host.Call("GET", "/api/town/ways", null)); Check("cached plan stays complete", JsonNode.DeepEquals(routes, cached));
            var selected = JsonNode.Parse(await host.Call("POST", "/api/town/ways", "{\"keys\":[\"0,0>10,10\",\"99999,99999>0,0\",\"bad\"]}"))!;
            Check("native requested way exists", selected["ways"]?["0,0>10,10"] is JsonArray { Count: > 1 }); Check("unreachable request remains explicit null", selected["ways"]!.AsObject().ContainsKey("99999,99999>0,0") && selected["ways"]?["99999,99999>0,0"] == null); Check("invalid key is omitted", !selected["ways"]!.AsObject().ContainsKey("bad"));
            await host.WithState(_ => { town.Clear(); return true; }); Check("reloaded town receives its complete plan", JsonNode.DeepEquals(routes, JsonNode.Parse(await host.Call("GET", "/api/town/ways", null))));
            Directory.CreateDirectory(Path.GetDirectoryName(output)!); File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, checks }, new JsonSerializerOptions { WriteIndented = true })); GD.Print($"native routing proof: {checks.Count} checks passed; {output}"); GetTree().Quit();
        } catch (Exception error) { GD.PushError(error.ToString()); GetTree().Quit(1); }
    }
}
