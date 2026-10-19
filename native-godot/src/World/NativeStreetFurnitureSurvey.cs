using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Issues #149 #160 #164: measures the real town round the old street furniture for its replacement's plan
/// (scripts/plan_street_furniture.py). <c>--street-furniture-survey &lt;out&gt; --street-furniture-rays &lt;json&gt;</c>:
/// each ray ({id, from, to, skip}) is cast against the town's solid layer; a hit on a part whose name holds one of the
/// ray's skip words (the old pieces themselves) is passed through. Writes survey.json: each ray's first other hit (point,
/// normal, part name). Reads only; a disposable proof save.
/// </summary>
public static class NativeStreetFurnitureSurvey
{
    sealed record Ray(string Id, float[] From, float[] To, string[]? Skip);

    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        string error = ""; var results = new List<object>();
        async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        try
        {
            var end = DateTime.UtcNow.AddSeconds(900);
            while (!(game.Loaded && !Loading.Busy && ServerLink.I?.Up == true) && DateTime.UtcNow < end) await Frames(3);
            await Frames(30);
            var rays = JsonSerializer.Deserialize<Ray[]>(File.ReadAllText(Paths.Absolute(game.Arg("street-furniture-rays"))), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
            var space = game.World.GetWorld3D().DirectSpaceState;
            foreach (var ray in rays)
            {
                var a = new Vector3(ray.From[0], ray.From[1], ray.From[2]); var b = new Vector3(ray.To[0], ray.To[1], ray.To[2]);
                var exclude = new Godot.Collections.Array<Rid>(); object? found = null; var passed = new List<string>();
                for (int k = 0; k < 12; k++)
                {
                    var q = PhysicsRayQueryParameters3D.Create(a, b, Solid.Layer, exclude); q.HitBackFaces = true;
                    var hit = space.IntersectRay(q);
                    if (hit.Count == 0) break;
                    var rid = hit["rid"].AsRid(); string name = Solid.I.NameOf(rid);
                    if (name == "" && hit["collider"].AsGodotObject() is Node node) name = node.GetPath().ToString();
                    if (ray.Skip != null && ray.Skip.Any(s => name.Contains(s, StringComparison.Ordinal))) { exclude.Add(rid); passed.Add(name); continue; }
                    var p = hit["position"].AsVector3(); var n = hit["normal"].AsVector3();
                    found = new { at = new[] { p.X, p.Y, p.Z }, normal = new[] { n.X, n.Y, n.Z }, name };
                    break;
                }
                results.Add(new { id = ray.Id, hit = found, passed });
            }
        }
        catch (Exception ex) { error = ex.ToString(); GD.PushError("street furniture survey: " + ex); }
        finally
        {
            File.WriteAllText(Path.Combine(output, "survey.json"), JsonSerializer.Serialize(new { ok = error == "", error, results }));
            game.GetTree().Quit(error == "" ? 0 : 1);
        }
    }
}
