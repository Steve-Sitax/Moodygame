using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// `--rope-proof &lt;dir&gt;`: the ropes of the boats, the hawsers and the mooring lines in the real town. Writes rope-proof.json:
/// every mesh drawn as lines (a rope with no thickness), every rope mesh with its thickness, material and texture, and the
/// mooring lines' ends against the quay's bollards. With `--rope-shots &lt;file.json&gt;` (an array of {name, eye:[x,y,z],
/// look:[x,y,z], hour, weather, tide}) it takes those pictures; tide is "low", "high" or a level in metres.
/// </summary>
public static class NativeRopeProof
{
    private sealed record ShotSpec(string name, float[] eye, float[] look, float hour = 13, string weather = "clear", string tide = "clock");

    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output); var facts = new Dictionary<string, object>(); var checks = new List<object>(); string? error = null;
        void Check(bool pass, string name) { checks.Add(new { name, pass }); GD.Print($"rope-proof: {(pass ? "PASS" : "FAIL")} {name}"); }
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Wait(Func<bool> ok, int seconds) { var until = DateTime.UtcNow.AddSeconds(seconds); while (!ok()) { if (DateTime.UtcNow > until) throw new TimeoutException("rope-proof wait"); await Frames(1); } }
        try
        {
            Engine.MaxFps = 30; await Wait(() => game.Loaded && ServerLink.I?.Up == true && GameState.I.Live && !Scheldemist.Menu.Loading.Busy, 160);
            Jef.I.TestInput = true; var api = ServerLink.I!.Api!;
            async Task Clock(float hour, string weather)
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = (int)hour, minute = (int)((hour % 1) * 60), weather }));
                Daylight.I.SetTime(hour); Daylight.I.Settle();
            }
            await Clock(13, "clear"); await Frames(30);
            facts["inventory"] = Inventory(game);
            facts["ropes"] = Scheldemist.Movers.Rope.Report();
            // (not rope: the lightning's bolt, and a piece of furniture's iron wire, f_wire)
            bool NotRope(GeometryInstance3D g) => g.Name.ToString() == "alive_bolt" || (g as MeshInstance3D)?.GetActiveMaterial(0)?.ResourceName == "f_wire";
            facts["notRopeLines"] = Scheldemist.Movers.Rope.LineMeshes(Main.I).Where(NotRope).Select(g => g.GetPath().ToString()).ToArray();
            var flat = Scheldemist.Movers.Rope.LineMeshes(Main.I).Where(g => !NotRope(g)).ToArray();
            facts["flatLines"] = flat.Select(g =>
            {
                Mesh m = (g as MeshInstance3D)?.Mesh ?? ((MultiMeshInstance3D)g).Multimesh!.Mesh!;
                string src = ""; for (Node? q = g; q != null && src == ""; q = q.GetParent()) if (q.HasMeta("source_name")) src = q.HasMeta("source_name") ? q.GetMeta("source_name").AsString() + " @" + q.Name : "";
                var v = m is ArrayMesh am ? am.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array().Take(6).Select(p => g.GlobalTransform * p).Select(p => $"{p.X:0.00},{p.Y:0.00},{p.Z:0.00}").ToArray() : Array.Empty<string>();
                var mat = (g as MeshInstance3D)?.GetActiveMaterial(0);
                return new { path = g.GetPath().ToString(), src, material = mat?.ResourceName, kind = mat is ShaderMaterial sm ? Scheldemist.Render.Psx.KindOf(sm.Shader)?.ToString() : null, v };
            }).ToArray();
            Check(flat.Length == 0, $"no rope is drawn as a line without thickness ({flat.Length} line meshes besides the lightning and a furniture wire)");
            // the mooring lines at low and high water: drawn, over the water, slack at high water and taut at low
            var lines = Scheldemist.Movers.ShipLines.I;
            if (lines != null)
            {
                var tides = new List<object>();
                var sags = new Dictionary<string, float[]>();
                foreach (var (name, level) in new[] { ("low", Tide.LwMin + .2f), ("high", Tide.HwMax - .2f) })
                {
                    Tide.Hold(level);
                    var until = DateTime.UtcNow.AddSeconds(30);
                    while (MathF.Abs(Tide.River - level) > 0.01f && DateTime.UtcNow < until) await Frames(5);
                    await Frames(60);
                    var survey = lines.Survey().ToArray();
                    float clear = survey.Length == 0 ? float.NaN : survey.Min(l => l.Lowest - l.Water);
                    sags[name] = survey.Select(l => l.Sag).ToArray();
                    tides.Add(new { hidden = lines.HiddenCarriers().Select(h => new[] { h.X, h.Y }).ToArray(), name, level, river = Tide.River, lines = survey.Length, small = survey.Count(l => l.Small), lowestOverWater = clear, meanSag = survey.Average(l => l.Sag), rebuilds = lines.Rebuilds,
                        worst = survey.OrderBy(l => l.Lowest - l.Water).Take(3).Select(l => new { l.Line, l.Small, a = new[] { l.A.X, l.A.Y, l.A.Z }, b = new[] { l.B.X, l.B.Y, l.B.Z }, l.Lowest, l.Water }).ToArray() });
                    Check(survey.Length >= lines.ShipLineCount && survey.Count(l => l.Small) >= 40, $"mooring lines drawn at {name} water ({survey.Length}: {lines.ShipLineCount} ship lines, {survey.Count(l => l.Small)} painters)");
                    Check(clear >= 0.02f, $"no mooring line hangs into the water at {name} water (lowest {clear:0.000} m over it)");
                }
                Tide.Hold(null);
                facts["tide"] = tides;
                float lowSag = sags["low"].Average(), highSag = sags["high"].Average();
                Check(highSag > lowSag + 0.05f, $"the lines hang slacker at high water than at low (mean sag {lowSag:0.00} m at low, {highSag:0.00} m at high)");
            }
            string shots = Main.I.Arg("rope-shots");
            if (shots != "")
            {
                var list = JsonSerializer.Deserialize<ShotSpec[]>(File.ReadAllText(shots)) ?? Array.Empty<ShotSpec>();
                string lastWhen = ""; var shotLog = new List<object>(); facts["shots"] = shotLog;
                foreach (var s in list)
                {
                    string when = $"{s.hour}|{s.weather}|{s.tide}";
                    if (when != lastWhen)
                    {
                        await Clock(s.hour, s.weather);
                        Tide.Hold(s.tide switch { "low" => Tide.LwMin + .2f, "high" => Tide.HwMax - .2f, "clock" => null, _ => float.Parse(s.tide, System.Globalization.CultureInfo.InvariantCulture) });
                        var tideUntil = DateTime.UtcNow.AddSeconds(30);
                        while ((Tide.Held is { } h && MathF.Abs(Tide.River - h) > 0.01f) && DateTime.UtcNow < tideUntil) await Frames(5);
                        await Frames(45);
                        lastWhen = when;
                    }
                    if (!Jef.I.Fly) Jef.I.ToggleFly();
                    var eye = new Vector3(s.eye[0], s.eye[1], s.eye[2]); var look = new Vector3(s.look[0], s.look[1], s.look[2]);
                    game.Cam.GlobalPosition = eye; var q = new Transform3D(Basis.Identity, eye).LookingAt(look).Basis.GetRotationQuaternion();
                    if (game.Cam is FlyCam fly) fly.Face(q); else game.Cam.Quaternion = q;
                    await Frames(25); await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    using var image = game.GetViewport().GetTexture().GetImage(); image.SavePng(Path.Combine(output, s.name + ".png"));
                    shotLog.Add(new { s.name, river = Tide.River, held = Tide.Held, water = Waters.Level, hour = GameState.I.HourF, weather = Daylight.I.Weather, wet = Daylight.I.Wet });
                    GD.Print($"rope-proof: shot {s.name} river {Tide.River:0.00} held {Tide.Held} weather {Daylight.I.Weather}");
                }
                Tide.Hold(null);
            }
        }
        catch (Exception e) { error = e.ToString(); GD.PrintErr("rope-proof failed: " + e); }
        bool ok = error == null && checks.All(c => (bool)c.GetType().GetProperty("pass")!.GetValue(c)!);
        try
        {
            // (a boat with no floor under her has -infinity there: written as a name)
            File.WriteAllText(Path.Combine(output, "rope-proof.json"), JsonSerializer.Serialize(new { ok, error, checks, facts },
                new JsonSerializerOptions { WriteIndented = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals }));
        }
        catch (Exception e) { ok = false; GD.PrintErr("rope-proof: report not written: " + e); }
        GD.Print($"rope-proof: {(ok ? "PASS" : "FAIL")} {Path.Combine(output, "rope-proof.json")}");
        game.GetTree().Quit(ok ? 0 : 1);
    }

    private static object Inventory(NativeTownGame game)
    {
        var lineMeshes = Scheldemist.Movers.Rope.LineMeshes(Main.I).Select(g =>
        {
            Mesh m = (g as MeshInstance3D)?.Mesh ?? ((MultiMeshInstance3D)g).Multimesh!.Mesh!;
            var box = g.GlobalTransform * m.GetAabb();
            return new { path = g.GetPath().ToString(), type = g.GetType().Name, visible = g.IsVisibleInTree(), copies = (g as MultiMeshInstance3D)?.Multimesh?.InstanceCount ?? 1,
                verts = Enumerable.Range(0, m.GetSurfaceCount()).Sum(s => Scheldemist.Movers.Rope.Verts(m, s)), at = new[] { box.GetCenter().X, box.GetCenter().Y, box.GetCenter().Z } };
        }).ToArray();
        var named = new List<object>();
        foreach (var n in BakedWorld.All(Main.I))
        {
            if (n is not GeometryInstance3D g) continue;
            string name = n.Name.ToString().ToLowerInvariant();
            if (!(name.Contains("rope") || name.Contains("rigging") || name.Contains("shroud") || name.Contains("hawser") || name.Contains("ship_lines") || name.Contains("_lines") || name.Contains("chain") || name.Contains("mooring"))) continue;
            Mesh? m = (g as MeshInstance3D)?.Mesh ?? (g as MultiMeshInstance3D)?.Multimesh?.Mesh;
            if (m == null || m.GetSurfaceCount() == 0) continue;
            var mat = (g as MeshInstance3D)?.GetActiveMaterial(0) ?? g.MaterialOverride ?? m.SurfaceGetMaterial(0);
            var box = g.GlobalTransform * m.GetAabb();
            named.Add(new { path = n.GetPath().ToString(), type = n.GetType().Name, visible = g.IsVisibleInTree(), primitive = Scheldemist.Movers.Rope.Primitive(m, 0).ToString(), verts = Scheldemist.Movers.Rope.Verts(m, 0),
                material = mat?.ResourceName ?? mat?.GetType().Name, kind = mat is ShaderMaterial sm ? Scheldemist.Render.Psx.KindOf(sm.Shader) : null,
                at = new[] { box.GetCenter().X, box.GetCenter().Y, box.GetCenter().Z }, size = new[] { box.Size.X, box.Size.Y, box.Size.Z } });
        }
        var spots = Scheldemist.Movers.Boats.I!.MooredSpots().Where(s => !s.Gone).ToArray();
        var busiest = spots.Select(s => new { s.X, s.Z, n = spots.Count(o => new Vector2(o.X - s.X, o.Z - s.Z).Length() < 50) }).OrderByDescending(s => s.n).FirstOrDefault();
        var perches = GullPerches.Find(game.World);
        var shipLines = Scheldemist.Movers.ShipLines.I?.Ends().Select(e => new { a = new[] { e.A.X, e.A.Y, e.A.Z }, e.AV, b = new[] { e.B.X, e.B.Y, e.B.Z }, e.BV, e.Len, edge = e.Edge is { } x ? new[] { x.X, x.Y, x.Z } : null }).ToArray();
        var vessels = Scheldemist.Movers.ShipLines.I?.Vessels.Select(v => new[] { v.X, v.Y, v.Z }).ToArray();
        var rings = new List<float[]>();
        foreach (var n in BakedWorld.All(game.World))
            if (n is MultiMeshInstance3D { Multimesh: { } mm } r && n.Name.ToString().Contains("mooringrings"))
                for (int i = 0; i < mm.InstanceCount; i++) { var t = r.GlobalTransform * mm.GetInstanceTransform(i); rings.Add(new[] { t.Origin.X, t.Origin.Y, t.Origin.Z, t.Basis.Z.X, t.Basis.Z.Z }); }
        var small = Scheldemist.Movers.Boats.I!.MooredSpots().Select(s => new { s.Kind, s.X, s.Z, s.Yaw, s.Gone, len = Scheldemist.Movers.Boats.I.Dims(s.Kind).Length }).ToArray();
        return new { shipLines, vessels, rings, small, lineMeshes, named, moored = spots.Length, busiest, bollards = perches.Count, bollardTops = perches.Take(400).Select(p => new[] { p.Top.X, p.Top.Y, p.Top.Z }).ToArray() };
    }
}
