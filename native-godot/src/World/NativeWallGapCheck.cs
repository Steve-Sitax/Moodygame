using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Dev (--wall-gaps &lt;folder&gt;, isolated --db): which open edges of the town wall's shell can be seen through. Reads
/// &lt;folder&gt;/gaps.json (scripts/wall-gaps.py, #301: each dangling slice end of a wall mesh and the middle of its gap), and for
/// each casts rays from the open air through that middle (SCHELDEMIST_WALL_SHOTS: a JSON list of [x, y, z] or [x, y, z, eye x, y, z] to photograph instead): a ray that passes 0.3 m beyond it without touching anything sees
/// into the hollow wall. Writes see-through.json. With --wall-gaps-shots it also photographs each place it finds.
/// </summary>
public static class NativeWallGapCheck
{
    public static async Task Run(NativeTownGame game, string output)
    {
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        try
        {
            if (!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !game.Flag("no-ai"))
                throw new Exception("Wall gap check requires a disposable database under its output folder and --no-ai.");
            var deadline = DateTime.UtcNow.AddMinutes(10);
            while (!game.Loaded || Loading.Busy || ServerLink.I?.Up != true || !GameState.I.Live)
            { if (DateTime.UtcNow > deadline) throw new Exception("Town load timed out"); await Frames(3); }
            var api = ServerLink.I!.Api!;
            Prefs.Set("benchDone", true); Prefs.Preset("high");
            MainMenu.I!.Start(); Jef.I.TestInput = true; Pause.Clear(); game.Ui.Visible = false;
            GameState.I.Apply(await api.NewGame());
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            await Frames(30);
            var space = game.World.GetWorld3D().DirectSpaceState;
            if (System.Environment.GetEnvironmentVariable("SCHELDEMIST_WALL_SHOTS") is { Length: > 0 } shotFile)
            {
                // photographs each listed place [x, y, z] from the open side, at midday: for before-and-after views of a repair
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" }));
                Daylight.I.SetTime(13); Daylight.I.SetWeather("clear"); Daylight.I.Settle();
                var cam = new Camera3D { Fov = 50, Near = .05f, Far = game.Cam.Far, CullMask = game.Cam.CullMask, Environment = game.Cam.Environment };
                game.World.AddChild(cam);
                int n = 0;
                foreach (var e in JsonNode.Parse(File.ReadAllText(shotFile))!.AsArray())
                {
                    var p = new Vector3((float)e![0]!, (float)e[1]!, (float)e[2]!);
                    Solid.I.Ensure(p, 30); await game.ToSignal(game.GetTree(), SceneTree.SignalName.PhysicsFrame);
                    Vector3 best = p + new Vector3(6, 1, 6); float far = -1;
                    var arr = e.AsArray();
                    if (arr.Count >= 6) { best = new Vector3((float)arr[3]!, (float)arr[4]!, (float)arr[5]!); far = 99; }
                    for (int d = 0; d < 16 && far < 99; d++)
                    {
                        float a = d * Mathf.Tau / 16; var dir = new Vector3(MathF.Cos(a), 0.15f, MathF.Sin(a)).Normalized();
                        var q = PhysicsRayQueryParameters3D.Create(p + dir * 0.6f, p + dir * 9f, Solid.Layer); q.HitFromInside = true;
                        var h = space.IntersectRay(q); float len = h.Count > 0 ? ((Vector3)h["position"]).DistanceTo(p) : 9f;
                        if (len > far) { far = len; best = p + dir * Math.Min(7f, len - 0.4f); }
                    }
                    for (int frame = 0; frame < 30; frame++) { Pause.Clear(); game.Cam.GlobalPosition = best; cam.GlobalPosition = best; cam.LookAt(p); cam.MakeCurrent(); await Frames(1); }
                    await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    using var img = game.GetViewport().GetTexture().GetImage();
                    img.SavePng(Path.Combine(output, $"place_{n++:00}_{p.X:F0}_{p.Z:F0}.png"));
                }
                game.GetTree().Quit();
                return;
            }
            var gaps = JsonNode.Parse(File.ReadAllText(Path.Combine(output, "gaps.json")))!.AsArray();
            bool Hit(Vector3 a, Vector3 b, out Vector3 at)
            {
                var q = PhysicsRayQueryParameters3D.Create(a, b, Solid.Layer); q.HitFromInside = true;
                var h = space.IntersectRay(q); at = h.Count > 0 ? (Vector3)h["position"] : b; return h.Count > 0;
            }
            var seen = new JsonArray();
            int done = 0;
            foreach (var g in gaps)
            {
                var p = new Vector3((float)g!["mx"]!, (float)g["y"]!, (float)g["mz"]!);
                if (done++ % 40 == 0) { Solid.I.Ensure(p, 30); await game.ToSignal(game.GetTree(), SceneTree.SignalName.PhysicsFrame); }
                else Solid.I.Ensure(p, 12);
                int through = 0; Vector3 from = default;
                for (int d = 0; d < 32; d++)
                    foreach (float tilt in new[] { -0.25f, 0f, 0.25f })
                    {
                        float a = d * Mathf.Tau / 32;
                        var dir = new Vector3(MathF.Cos(a), tilt, MathF.Sin(a)).Normalized();
                        var start = p + dir * 4f;
                        // the eye must be in the open air: nothing over it, and above the ground under it
                        if (Hit(start, start + Vector3.Up * 60, out _) || !Hit(start, start + Vector3.Down * 30, out _)) continue;
                        if (Hit(start, p - dir * 0.3f, out var at) && at.DistanceTo(start) < 4.3f - 0.01f) continue;
                        through++; from = start;
                    }
                if (through > 0)
                {
                    var o = g.DeepClone().AsObject(); o["through"] = through;
                    o["from"] = new JsonArray(MathF.Round(from.X, 2), MathF.Round(from.Y, 2), MathF.Round(from.Z, 2));
                    seen.Add(o);
                }
            }
            File.WriteAllText(Path.Combine(output, "see-through.json"), seen.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"wall gaps: {gaps.Count} open edges, {seen.Count} seen through");
            if (game.Flag("wall-gaps-shots"))
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = 13, minute = 0, weather = "clear" }));
                Daylight.I.SetTime(13); Daylight.I.SetWeather("clear"); Daylight.I.Settle();
                var camera = new Camera3D { Fov = 40, Near = .05f, Far = game.Cam.Far, CullMask = game.Cam.CullMask, Environment = game.Cam.Environment };
                game.World.AddChild(camera);
                var taken = new List<Vector3>();
                foreach (var s in seen)
                {
                    var p = new Vector3((float)s!["mx"]!, (float)s["y"]!, (float)s["mz"]!);
                    if (taken.Any(t => t.DistanceTo(p) < 3)) continue;
                    taken.Add(p);
                    var f = s["from"]!.AsArray(); var eye = p + (new Vector3((float)f[0]!, (float)f[1]!, (float)f[2]!) - p).Normalized() * 6f;
                    for (int frame = 0; frame < 30; frame++) { Pause.Clear(); game.Cam.GlobalPosition = eye; camera.GlobalPosition = eye; camera.LookAt(p); camera.MakeCurrent(); await Frames(1); }
                    await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    using var img = game.GetViewport().GetTexture().GetImage();
                    img.SavePng(Path.Combine(output, $"gap_{p.X:F0}_{p.Y:F0}_{p.Z:F0}.png"));
                }
            }
            game.GetTree().Quit();
        }
        catch (Exception e) { File.WriteAllText(Path.Combine(output, "failure.txt"), e.ToString()); GD.PushError(e.ToString()); game.GetTree().Quit(1); }
    }
}
