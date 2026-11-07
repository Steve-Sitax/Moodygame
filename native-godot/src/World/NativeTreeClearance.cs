using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;
using Scheldemist.Movers;

namespace Scheldemist.Native.World;

/// <summary>
/// Dev (--tree-clearance &lt;folder&gt;, isolated --db): how much room each squares.json tree has from everything solid but other
/// trees, at 1, 3.5 and 6 m (room.txt), and for each earth tree whose crown would go through a wall, a gate or a house the
/// nearest bare-earth spot within 8 m with room for it, or none (moves.json, for scripts/paving/squares.py --moves). With
/// SCHELDEMIST_TREE_SHOTS="x,z;x,z" it also photographs those places at midday; with SCHELDEMIST_TREE_SECTION="x0,z0,x1,z1;..."
/// it lists what stands over each point along those lines (section.txt). The town wall is a solid block about 6 m thick
/// with its walk at 6.5 m, the bastions filled to it, and the bare earth runs on under them: hence the overhead check.
/// </summary>
public static class NativeTreeClearance
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        try
        {
            if (!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !game.Flag("no-ai"))
                throw new Exception("Tree clearance requires a disposable database under its output folder and --no-ai.");
            var deadline = DateTime.UtcNow.AddMinutes(10);
            while (!game.Loaded || Loading.Busy || ServerLink.I?.Up != true || !GameState.I.Live)
            { if (DateTime.UtcNow > deadline) throw new Exception("Town load timed out"); await Frames(3); }
            var api = ServerLink.I!.Api!;
            Prefs.Set("benchDone", true); Prefs.Preset("high");
            MainMenu.I!.Start(); Jef.I.TestInput = true; Pause.Clear(); game.Ui.Visible = false;
            GameState.I.Apply(await api.NewGame());
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            await Frames(30);
            await game.ToSignal(game.GetTree(), SceneTree.SignalName.PhysicsFrame);
            var space = game.World.GetWorld3D().DirectSpaceState;
            // crown radius per kind: the leaves copies' mesh, across
            var crown = new Dictionary<string, float>();
            foreach (var mmi in game.World.FindChildren("*", "MultiMeshInstance3D", true, false).OfType<MultiMeshInstance3D>())
            {
                var m = System.Text.RegularExpressions.Regex.Match(mmi.Name.ToString(), @"^INST900\d_tree(\w+)leaves_mm$");
                if (!m.Success || mmi.Multimesh?.Mesh == null) continue;
                var box = mmi.Multimesh.Mesh.GetAabb();
                crown[m.Groups[1].Value] = Math.Max(box.Size.X, box.Size.Z) * 0.5f;
            }
            (float room, string what) Room(Vector3 at, float reach)
            {
                Solid.I.Ensure(at, reach + 4);
                float best = reach; string what = "";
                foreach (float h in new[] { 1.0f, 3.5f, 6f })
                    for (int d = 0; d < 32; d++)
                    {
                        float a = d * Mathf.Tau / 32;
                        var dir = new Vector3(MathF.Cos(a), 0, MathF.Sin(a));
                        var from = at + Vector3.Up * h + dir * 0.45f;
                        var skip = new Godot.Collections.Array<Rid>();
                        for (int tries = 0; tries < 6; tries++)
                        {
                            var q = PhysicsRayQueryParameters3D.Create(from, at + Vector3.Up * h + dir * reach, Solid.Layer, skip);
                            q.HitFromInside = true;
                            var hit = space.IntersectRay(q);
                            if (hit.Count == 0) break;
                            var rid = hit["rid"].AsRid(); string name = Solid.I.NameOf(rid);
                            if (name.Contains("bark", StringComparison.OrdinalIgnoreCase)) { skip.Add(rid); continue; }
                            float dist = ((Vector3)hit["position"] - at).Slide(Vector3.Up).Length();
                            if (dist < best) { best = dist; what = $"{name} at {h} m"; }
                            break;
                        }
                    }
                // and nothing over it lower than its crown: a wall walk or a roof the crown would come up through
                foreach (float r in new[] { 0f, 1f, 2f, 3f, 4f })
                    for (int d = 0; d < (r == 0 ? 1 : 12); d++)
                    {
                        if (r >= best) break;
                        float a = d * Mathf.Tau / 12;
                        var foot = at + new Vector3(MathF.Cos(a), 0, MathF.Sin(a)) * r;
                        var skip = new Godot.Collections.Array<Rid>();
                        for (int tries = 0; tries < 6; tries++)
                        {
                            var q = PhysicsRayQueryParameters3D.Create(foot + Vector3.Up * 0.3f, foot + Vector3.Up * 9.5f, Solid.Layer, skip);
                            q.HitFromInside = true;
                            var hit = space.IntersectRay(q);
                            if (hit.Count == 0) break;
                            var rid = hit["rid"].AsRid(); string name = Solid.I.NameOf(rid);
                            if (name.Contains("bark", StringComparison.OrdinalIgnoreCase)) { skip.Add(rid); continue; }
                            if (r < best) { best = r; what = $"{name} overhead at {((Vector3)hit["position"]).Y:F1} m"; }
                            break;
                        }
                    }
                return (best, what);
            }
            if (System.Environment.GetEnvironmentVariable("SCHELDEMIST_TREE_SECTION") is { Length: > 0 } section)
            {
                var sec = new StringBuilder();
                foreach (var line in section.Split(';'))
                {
                    var v = line.Split(',').Select(t => float.Parse(t, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                    var a0 = new Vector3(v[0], 0, v[1]); var a1 = new Vector3(v[2], 0, v[3]);
                    Solid.I.Ensure((a0 + a1) / 2, a0.DistanceTo(a1) / 2 + 5);
                    await game.ToSignal(game.GetTree(), SceneTree.SignalName.PhysicsFrame);
                    sec.AppendLine($"section {line}");
                    for (float f = 0; f <= 1.0001f; f += 1f / 40)
                    {
                        var p = a0.Lerp(a1, f); var hits = new List<string>(); var skip = new Godot.Collections.Array<Rid>();
                        for (int k2 = 0; k2 < 6; k2++)
                        {
                            var q = PhysicsRayQueryParameters3D.Create(new Vector3(p.X, 30, p.Z), new Vector3(p.X, -6, p.Z), Solid.Layer, skip);
                            var hit = space.IntersectRay(q); if (hit.Count == 0) break;
                            var rid = hit["rid"].AsRid(); skip.Add(rid);
                            hits.Add($"{((Vector3)hit["position"]).Y:F1} {Solid.I.NameOf(rid).Split('/').Last()}");
                        }
                        sec.AppendLine($"  ({p.X:F1}, {p.Z:F1}): {string.Join(" | ", hits)}");
                    }
                }
                File.WriteAllText(Path.Combine(output, "section.txt"), sec.ToString());
            }
            var json = JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(NativeRazedHouses.SquaresFile)))!;
            var trees = json["trees"]!.AsArray();
            var sb = new StringBuilder();
            sb.AppendLine("crowns " + string.Join(", ", crown.Select(c => $"{c.Key} {c.Value:F1}")));
            var rows = new List<(int i, string kind, Vector3 at, float room, float need, bool pit, string what)>();
            for (int i = 0; i < trees.Count; i++)
            {
                var t = trees[i]!;
                string kind = (string)t["kind"]!; float x = (float)t["x"]!, z = (float)t["z"]!, scale = (float)t["scale"]!;
                bool pit = t["pit"] != null;
                var at = new Vector3(x, 0, z);
                float r = crown.TryGetValue(kind, out var c) ? c * scale : 4;
                var (room, what) = Room(at, 8); rows.Add((i, kind, at, room, r, pit, what));
            }
            foreach (var row in rows.OrderBy(r => r.room - r.need))
                sb.AppendLine($"#{row.i} {row.kind}{(row.pit ? " pit" : "")} ({row.at.X:F1}, {row.at.Z:F1}): room {row.room:F2} crown {row.need:F2} {row.what}");
            // every other tree's trunk (the bake's and these), to keep 6 m apart
            var trunks = new List<Vector3>();
            foreach (var mmi in game.World.FindChildren("*", "MultiMeshInstance3D", true, false).OfType<MultiMeshInstance3D>())
                if (System.Text.RegularExpressions.Regex.IsMatch(mmi.Name.ToString(), @"tree\w*bark_mm$") && mmi.Multimesh != null)
                    for (int i = 0; i < mmi.Multimesh.InstanceCount; i++) trunks.Add(mmi.GlobalTransform * mmi.Multimesh.GetInstanceTransform(i).Origin);
            string GroundAt(float x, float z)
            {
                var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x, 0.6f, z), new Vector3(x, -0.6f, z), Solid.Layer));
                return hit.Count == 0 ? "" : Solid.I.NameOf(hit["rid"].AsRid());
            }
            var moves = new JsonObject();
            var placedNow = new List<Vector3>();
            foreach (var row in rows.Where(r => !r.pit && r.room < r.need * 0.75f).OrderBy(r => r.room))
            {
                Vector3? best = null;
                for (float rad = 0.5f; rad <= 8f && best == null; rad += 0.5f)
                    for (int d = 0; d < 32 && best == null; d++)
                    {
                        float a = d * Mathf.Tau / 32;
                        var c = row.at + new Vector3(MathF.Cos(a), 0, MathF.Sin(a)) * rad;
                        if (Water.In(c.X, c.Z) || !GroundAt(c.X, c.Z).Contains("ground_earth")) continue;
                        if (trunks.Concat(placedNow).Any(t => t.DistanceTo(row.at) > 0.2f && new Vector2(t.X - c.X, t.Z - c.Z).Length() < 6f)) continue;
                        if (Room(c, 8).room < row.need * 0.8f) continue;
                        best = c;
                    }
                if (best is { } b) { placedNow.Add(b); moves[row.i.ToString()] = new JsonObject { ["x"] = MathF.Round(b.X, 2), ["z"] = MathF.Round(b.Z, 2) }; sb.AppendLine($"move #{row.i} {row.kind} ({row.at.X:F1}, {row.at.Z:F1}) -> ({b.X:F1}, {b.Z:F1}) {row.at.DistanceTo(b):F1} m"); }
                else { moves[row.i.ToString()] = null; sb.AppendLine($"remove #{row.i} {row.kind} ({row.at.X:F1}, {row.at.Z:F1}): no clear earth within 8 m"); }
            }
            File.WriteAllText(Path.Combine(output, "moves.json"), moves.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            File.WriteAllText(Path.Combine(output, "room.txt"), sb.ToString());
            if (System.Environment.GetEnvironmentVariable("SCHELDEMIST_TREE_SHOTS") is { Length: > 0 } shots)
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" }));
                MoverClock.Hold(13, 1); Daylight.I.SetTime(13); Daylight.I.SetWeather("clear"); Daylight.I.Settle();
                var camera = new Camera3D { Fov = 70, Near = .05f, Far = game.Cam.Far, CullMask = game.Cam.CullMask, Environment = game.Cam.Environment };
                game.World.AddChild(camera);
                foreach (var spot in shots.Split(';'))
                {
                    var xz = spot.Split(',').Select(v => float.Parse(v, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                    var at = new Vector3(xz[0], 0, xz[1]); var eye = at + new Vector3(10, 11, 10);
                    for (int frame = 0; frame < 40; frame++) { Pause.Clear(); game.Cam.GlobalPosition = eye; camera.GlobalPosition = eye; camera.LookAt(at + Vector3.Up * 3); camera.MakeCurrent(); await Frames(1); }
                    await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    using var img = game.GetViewport().GetTexture().GetImage();
                    img.SavePng(Path.Combine(output, $"spot_{xz[0]:F0}_{xz[1]:F0}.png"));
                }
            }
            game.GetTree().Quit();
        }
        catch (Exception e) { File.WriteAllText(Path.Combine(output, "failure.txt"), e.ToString()); GD.PushError(e.ToString()); game.GetTree().Quit(1); }
    }
}
