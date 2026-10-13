using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

/// <summary>
/// The animals' frame-time trace (--animals-trace dir): the camera goes round the old town at a brisk 5 m/s through
/// the cats' and strays' doorsteps for 90 s at 13:00, so animals come into reach and drop away all the time, and every
/// frame records the animals' whole update (Animals.LogicMs: spawning from the pool, their logic, routing and
/// skeletons), how many are about and shown, and the copies made on demand (Animal.ColdMakes). The proof passes when
/// no frame's update reaches 1 ms and no copy is made in front of the player (animals-trace.json).
/// </summary>
[GamePart(899)]
internal partial class AnimalsTrace : Node
{
    public override async void _Ready()
    {
        string arg = Main.I.Arg("animals-trace");
        if (arg == "") { SetProcess(false); return; }
        string dir = Paths.Absolute(arg);
        try
        {
            Directory.CreateDirectory(dir);
            var town = Main.I.GetNode<Town.Townspeople>("Townspeople");
            for (int i = 0; town.Data == null && i < 2400; i++) await Frame();
            for (int i = 0; !Dev.Kit.I.IsReady && i < 1800; i++) await Frame();
            if (town.Data == null || town.Walk == null || !Animal.Ready || Animals.I == null) throw new InvalidOperationException("The animal trace needs the native town and animals.scn.");
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true;
            Main.I.Cam.SetProcess(false);
            await Dev.Kit.I.Light(13, "clear");
            for (int i = 0; i < 120; i++) await Frame();
            // the route: the haunts within 260 m of the Vismarkt, in order round it, then back to the start
            var vis = Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray().First(p => p.GetProperty("place").GetString() == "vismarkt").GetProperty("pos");
            var centre = new Vector2(vis[0].GetSingle(), vis[2].GetSingle());
            var stops = Animals.I.HauntPoints.Where(h => (h - centre).Length() < 260).OrderBy(h => Mathf.Atan2(h.Y - centre.Y, h.X - centre.X)).ToList();
            if (stops.Count < 8) throw new InvalidOperationException("too few haunts for the trace: " + stops.Count);
            stops.Add(stops[0]);
            var path = new List<Vector3>();
            foreach (var h in stops) path.Add(new Vector3(h.X, (float)town.Walk.BaseAt(h.X, h.Y) + 1.7f, h.Y));
            int cold0 = Animal.ColdMakes, pooled0 = Animal.Pooled;
            var rows = new List<double[]>();
            var worst = new List<object>();
            double t = 0, travelled = 0;
            int leg = 0;
            var at = path[0];
            while (t < 90 && leg < path.Count - 1)
            {
                float dt = (float)GetProcessDeltaTime();
                t += dt;
                double step = 5.0 * dt;
                travelled += step;
                while (leg < path.Count - 1 && step > 0)
                {
                    var to = path[leg + 1];
                    float left = at.DistanceTo(to);
                    if (left <= step) { at = to; step -= left; leg++; }
                    else { at = at.MoveToward(to, (float)step); step = 0; }
                }
                var ahead = leg < path.Count - 1 ? path[leg + 1] : path[^1];
                var look = ahead - at;
                look.Y = -0.35f * Math.Max(1f, new Vector2(look.X, look.Z).Length());
                if (look.LengthSquared() < 1e-4f) look = new Vector3(0, -0.3f, 1);
                Main.I.Cam.LookAtFromPosition(at, at + look.Normalized());
                if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
                await Frame();
                var a = Animals.I;
                rows.Add(new[] { Math.Round(t, 3), Math.Round(a.LogicMs, 4), a.Count, a.Shown, Animal.ColdMakes - cold0, Animal.Pooled, Math.Round(dt * 1000, 2) });
                if (a.LogicMs >= 0.6) worst.Add(new { t = Math.Round(t, 2), ms = Math.Round(a.LogicMs, 3), about = a.Count, shown = a.Shown, spawned = a.SpawnedLastFrame, paths = a.PathsLastFrame });
            }
            var ms = rows.Skip(30).Select(r => r[1]).ToList();
            ms.Sort();
            double max = ms.Count > 0 ? ms[^1] : 0, p99 = ms.Count > 0 ? ms[(int)(ms.Count * 0.99)] : 0, mean = ms.Count > 0 ? ms.Average() : 0;
            int over = ms.Count(v => v >= 1.0), cold = Animal.ColdMakes - cold0;
            var report = new Dictionary<string, object>
            {
                ["route"] = new { stops = stops.Count, metres = Math.Round(travelled, 1), seconds = Math.Round(t, 1) },
                ["frames"] = ms.Count,
                ["animalsUpdateMs"] = new { max = Math.Round(max, 4), p99 = Math.Round(p99, 4), mean = Math.Round(mean, 4) },
                ["framesOver1ms"] = over,
                ["coldMakes"] = cold,
                ["pooledAtStart"] = pooled0,
                ["pooledAtEnd"] = Animal.Pooled,
                ["mostAbout"] = rows.Count > 0 ? rows.Max(r => r[2]) : 0,
                ["mostShown"] = rows.Count > 0 ? rows.Max(r => r[3]) : 0,
                ["slowest"] = worst.Take(40).ToList(),
                ["columns"] = new[] { "t", "animalsMs", "about", "shown", "coldMakes", "pooled", "frameMs" },
                ["rows"] = rows,
                ["ok"] = max < 1.0 && cold == 0,
            };
            File.WriteAllText(Path.Combine(dir, "animals-trace.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = false }));
            GD.Print($"animals trace: {ms.Count} frames, max {max:0.000} ms, p99 {p99:0.000} ms, mean {mean:0.000} ms, over 1 ms {over}, cold makes {cold}");
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }

    private async System.Threading.Tasks.Task Frame() => await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
}
