using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.Game;

/// <summary>
/// The district slice's quay ladders (issue 94): `game.tscn -- --ladder-test &lt;dir&gt;`. Checks that the slice draws the
/// native ladder model (not the bake's boxes), that the climb reads its rung lines, shoots every ladder side-on and
/// from the water, and climbs out by script with the real keys from the water in front of the first ladders.
/// </summary>
public static class NativeLadderProof
{
    public static async Task Run(NativeGame game, string output)
    {
        Directory.CreateDirectory(output);
        var rows = new List<object>(); var climbs = new List<object>(); var ladders = new List<object>(); string? error = null;
        void Check(bool pass, string description, object? detail = null) { rows.Add(new { pass, description, detail }); GD.Print($"ladder-test: {(pass ? "ok" : "FAIL")} {description}"); if (!pass) throw new InvalidOperationException(description); }
        async Task Frames(int count) { for (int i = 0; i < count; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Picture(string name, Vector3 eye, Vector3 target)
        {
            game.Cam.GlobalPosition = eye; game.Cam.LookAt(target);
            await Frames(45);
            await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            if (game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, name + ".png")) != Error.Ok) throw new IOException(name);
        }
        try
        {
            for (int i = 0; i < 200 && !game.Loaded; i++) await Frames(1);
            await Frames(40);
            var world = (NativeGameWorld)game.World;
            Daylight.I.SetTime(13); Daylight.I.SetWeather("clear"); Daylight.I.SetRain(0); Daylight.I.Settle();
            var found = QuayExits.Ladders.ToArray();
            Check(found.Length > 0, "the slice has quay ladders for the climb to use", found.Length);
            // (the slice keeps the town's quay iron whole, so it knows ladders far outside its own boundary: look at the ones inside)
            var local = found.Where(l => world.ContainsPlayPoint(l.X, l.Z)).ToArray();
            Check(local.Length > 0, "the slice's own quay has ladders", local.Length);
            // (and the pier head's, a little beyond the boundary, with its straps to the piles)
            var near = found.Where(a => a.X > -22 && a.X < 70 && a.Z > -26 && a.Z < 72).OrderBy(a => MathF.Abs(a.Top) > 0.1f).ThenBy(a => a.X).Take(8).ToArray();
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            int n = 0;
            foreach (var l in near)
            {
                var normal = new Vector3(l.Nx, 0, l.Nz); var along = new Vector3(l.Nz, 0, -l.Nx);
                var at = new Vector3(l.X, l.Top - 1.0f, l.Z) + normal * l.Rung;
                ladders.Add(new { n, x = l.X, z = l.Z, l.Top, l.Rung, l.Foot });
                // side-on, from the quay: along the wall and a little over its edge, looking down at the hoops, coping and stiles in profile
                var head = new Vector3(l.X, l.Top - 0.5f, l.Z) + normal * l.Rung;
                await Picture($"ladder{n:00}-side-high", head + along * 2.4f + normal * 0.5f + Vector3.Up * 1.3f, head);
                // side-on, from the water: level with the stiles' middle, a metre out and along the wall
                await Picture($"ladder{n:00}-side", at + along * 2.4f + normal * 1.2f, at + normal * 0.1f);
                // close up, level with the second fixing down (a bracket to the wall, or a strap across to a pile on a pier head)
                var low = new Vector3(l.X, l.Top - 1.85f, l.Z) + normal * l.Rung;
                await Picture($"ladder{n:00}-fixing", low + normal * 1.5f + along * 0.5f + Vector3.Up * 0.25f, low);
                await Picture($"ladder{n:00}-fixing-near", low + normal * 0.7f - along * 0.35f + Vector3.Up * 0.1f, low + along * 0.45f);
                // from the water: a swimmer's eye a little out, looking at the rungs
                float level = Water.Level(l.X + l.Nx * 2, l.Z + l.Nz * 2);
                await Picture($"ladder{n:00}-water", new Vector3(l.X, level + 0.9f, l.Z) + normal * 3.2f, new Vector3(l.X, Math.Max(level + 0.9f, l.Top - 1.5f), l.Z) + normal * l.Rung);
                n++;
            }
            // the climb: from open water in front of a ladder whose top is the quay's, W held until he is out
            Jef.I.ToggleFly(); Jef.I.TestInput = true;
            var tried = 0;
            foreach (var l in near.Where(a => MathF.Abs(a.Top) < 0.1f).Take(4))
            {
                float gx = l.X + l.Nx * 2.2f, gz = l.Z + l.Nz * 2.2f;
                Solid.I.Ensure(new Vector3(gx, 0, gz), 25); await Frames(3);
                Jef.I.Place(gx, gz, MathF.Atan2(l.Nx, l.Nz)); await Frames(3);
                if (Jef.I.NearestSwim(gx, gz, 3) is { } free) (gx, gz) = free;
                Jef.I.DropFromBoat(new Vector3(gx, Water.Level(gx, gz) - 0.3f, gz));
                Jef.I.Yaw = MathF.Atan2(l.Nx, l.Nz); Jef.I.Pitch = 0.15f;
                await Frames(80);
                bool was = false, shot = false; float lowest = float.PositiveInfinity, highest = float.NegativeInfinity;
                for (int f = 0; f < 1200; f++)
                {
                    if (Jef.I.Climbing) { was = true; lowest = Math.Min(lowest, Jef.I.Y); highest = Math.Max(highest, Jef.I.Y); }
                    if (!shot && Jef.I.Climbing && Jef.I.Y > l.Top - 1.0f) { shot = true; await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw); game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output, $"climb{tried:00}-on-ladder.png")); }
                    Jef.I.SetKey(Key.W, true);
                    await Frames(1);
                    if (was && !Jef.I.Climbing && Jef.I.Grounded) break;
                }
                Jef.I.ClearKeys(); await Frames(20);
                bool ok = was && !Jef.I.Swimming && Jef.I.Grounded && Math.Abs(Jef.I.Y - l.Top) < 0.2f;
                climbs.Add(new { ladder = new[] { l.X, l.Z }, climbed = was, ok, lowest, highest, end = new[] { Jef.I.X, Jef.I.Y, Jef.I.Z } });
                Check(ok, $"out of the water up the ladder at {l.X:0.0}, {l.Z:0.0} onto the quay", new { Jef.I.Y, l.Top, lowest, highest });
                tried++;
            }
            Check(tried > 0, "at least one quay ladder had open water in front for the climb");
            var holder = BakedWorld.All(world).FirstOrDefault(node => node.Name == "quay_ladders");
            int drawn = holder == null ? 0 : holder.GetChildren().OfType<MeshInstance3D>().Count();
            GD.Print($"ladder-test: {found.Length} ladders, quay_ladders node {(holder == null ? "absent" : "present")} with {drawn} drawn");
            Check(holder != null && drawn == found.Length, "every ladder is the native model (one quay_ladders holder, one mesh per ladder)", new { drawn, climb = found.Length });
            Check(found.All(l => l.Rung >= 0.15f), "the climb's rung line stands clear of the coping, as the native model fits it", found.Select(l => Math.Round(l.Rung, 3)).ToArray());
        }
        catch (Exception caught) { error = caught.ToString(); GD.PrintErr(error); }
        File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { rows, ladders, climbs, error }, new JsonSerializerOptions { WriteIndented = true }));
        GD.Print($"Native ladder proof: {rows.Count} checks, {(error == null ? "PASS" : "FAIL")}");
        game.GetTree().Quit(error == null ? 0 : 1);
    }
}
