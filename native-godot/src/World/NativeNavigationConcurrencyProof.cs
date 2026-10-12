using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Town;

namespace Scheldemist.Native.World;

/// <summary>Background routes keep coherent live-body indices while the scene adds, moves and removes bodies.</summary>
public partial class NativeNavigationConcurrencyProof : Node
{
    public override async void _Ready()
    {
        var checks = new List<object>(); var nodes = new List<Node3D>();
        using var stop = new CancellationTokenSource(); Task[] readers = Array.Empty<Task>(); long queries = 0;
        string output = OS.GetCmdlineUserArgs().First();
        void Check(string name, bool passed) { checks.Add(new { name, passed }); if (!passed) throw new InvalidOperationException(name); }
        try {
            var cells = new byte[32 * 32 * 16]; Array.Fill(cells, (byte)1);
            var map = WalkMap.FromNativeData(new Rect2(0, 0, 32, 32), cells, new short[32 * 32 * 4], new short[cells.Length]);
            var box = new Aabb(new Vector3(-.4f, 0, -.4f), new Vector3(.8f, 1.8f, .8f));
            Node3D Add(Vector3 at, bool transit = false) {
                var node = new Node3D { Position = at }; AddChild(node); nodes.Add(node); WalkMap.RegisterBody(node, box, transit); return node;
            }
            var moving = Add(new Vector3(3, 0, 3)); map.RefreshBodies();
            Check("live body blocks its footprint", !map.PathFree(3, 3));
            moving.Position = new Vector3(12, 0, 12); map.RefreshBodies();
            Check("moving body releases old footprint and blocks new one", map.PathFree(3, 3) && !map.PathFree(12, 12));
            moving.Free(); nodes.Clear(); map.RefreshBodies();
            Check("removed body releases footprint", map.PathFree(12, 12));
            Add(new Vector3(3, 0, 3), true); map.RefreshBodies();
            Check("route ignores passing traffic while walking avoids it", map.PathFree(3, 3) && !map.Free(3, 3));
            foreach (var node in nodes) node.Free(); nodes.Clear(); map.RefreshBodies();
            readers = Enumerable.Range(0, 3).Select(worker => Task.Run(() => {
                int tick = worker;
                while (!stop.IsCancellationRequested) {
                    map.PathFree((tick % 31) + .25, ((tick / 31) % 31) + .25);
                    Interlocked.Increment(ref queries); tick++;
                }
            })).ToArray();
            for (int turn = 0; turn < 96; turn++) {
                // Cross both bitset word boundaries; removals also change stored indices.
                int target = turn % 2 == 0 ? 137 : 7;
                while (nodes.Count > target) { nodes[^1].Free(); nodes.RemoveAt(nodes.Count - 1); }
                while (nodes.Count < target) Add(new Vector3(1 + nodes.Count % 28, 0, 1 + nodes.Count / 28));
                for (int i = 0; i < nodes.Count; i++) nodes[i].Position = new Vector3(1 + (i + turn) % 28, 0, 1 + i / 28);
                map.RefreshBodies();
                await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            }
            stop.Cancel(); await Task.WhenAll(readers);
            Check("concurrent live-body churn keeps route indices valid", queries >= 20000);
            foreach (var node in nodes) node.Free(); nodes.Clear(); map.RefreshBodies();
            Check("all removed footprints reopen after concurrent queries", map.PathFree(2, 2) && map.PathFree(12, 12));
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);
            File.WriteAllText(output, JsonSerializer.Serialize(new { passed = true, queries, checks }));
            GD.Print($"Native navigation concurrency: {checks.Count} checks PASS, {queries} background queries"); GetTree().Quit();
        } catch (Exception error) {
            stop.Cancel(); try { await Task.WhenAll(readers); } catch { }
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);
            File.WriteAllText(output, JsonSerializer.Serialize(new { passed = false, error = error.ToString(), queries, checks }));
            GD.PushError(error.ToString()); GetTree().Quit(1);
        }
    }
}
