using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.People;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Default-game pictures of actual residents and animals; no exhibit actors or map overrides.</summary>
[GamePart(897)]
public partial class Batch1GameProof : Node
{
    private async Task Frame() => await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    private sealed record Person(Node3D Root, string Kind, bool Newer);
    private Person[] People() => BakedWorld.All(Main.I.View).OfType<Skeleton3D>()
        .Where(s => s.GetBoneCount() is 16 or 64 && s.GetParent() is Node3D r && r.IsVisibleInTree())
        .Select(s => new Person((Node3D)s.GetParent(), s.GetParent().HasMeta("people2_kind")
            ? s.GetParent().GetMeta("people2_kind").AsString() : s.GetParent().Name.ToString(), s.GetBoneCount() == 64)).ToArray();
    private void View(Vector3 from, Vector3 target)
    {
        Main.I.Cam.LookAtFromPosition(from, target);
        if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
    }
    private bool Seen(Vector3 at)
    {
        if (!Main.I.Cam.IsPositionInFrustum(at)) return false;
        Vector3 from = Main.I.Cam.GlobalPosition;
        using var ray = PhysicsRayQueryParameters3D.Create(from, at);
        var hit = Main.I.Cam.GetWorld3D().DirectSpaceState.IntersectRay(ray);
        return hit.Count == 0 || hit["position"].AsVector3().DistanceTo(at) < .5f;
    }
    public override async void _Ready()
    {
        string output = Main.I.Arg("batch1-captures");
        if (output == "") { SetProcess(false); return; }
        try
        {
            output = Paths.Absolute(output); Directory.CreateDirectory(output);
            if (!People2.Enabled || Main.I.Arg("people2-map") != "") throw new InvalidOperationException("Default routing required.");
            var town = Main.I.GetNode<Townspeople>("Townspeople");
            for (int i = 0; (town.Data == null || !Kit.I.IsReady) && i < 2400; i++) await Frame();
            if (town.Data == null || town.Walk == null) throw new InvalidOperationException("Native town not ready.");
            town.ClockRuns = false; Game.GameState.I.PlayingWhen = () => false;
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true; Main.I.Cam.SetProcess(false); Input.MouseMode = Input.MouseModeEnum.Visible;
            var receipts = new List<object>();
            foreach (string place in new[] { "vismarkt", "rijnkaai" })
            foreach (var (tag, hour, weather) in new[] { ("day", 13f, "clear"), ("rain", 13f, "rain"), ("lamps", 19.5f, "clear") })
            {
                await Kit.I.Light(hour, weather);
                var data = Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray().First(p => p.GetProperty("place").GetString() == place);
                var xyz = data.GetProperty("pos"); var centre = new Vector3(xyz[0].GetSingle(), 0, xyz[2].GetSingle());
                View(centre + new Vector3(0, 1.6f, 5), centre + Vector3.Up);
                for (int i = 0; i < 240; i++) await Frame();
                foreach (float metres in new[] { 3f, 8f })
                {
                    var people = People();
                    var animals = Animals.I!.Groups.Where(a => a.IsVisibleInTree()).ToArray();
                    var candidates = people.Where(p => p.Newer && p.Root.GlobalPosition.DistanceSquaredTo(centre) < 2500)
                        .OrderBy(p => p.Root.GlobalPosition.DistanceSquaredTo(centre)).Take(20).ToArray();
                    (Person Person, Vector3 Camera, int Score)? best = null;
                    foreach (var person in candidates)
                    for (int angle = 0; angle < 8; angle++)
                    {
                        var at = person.Root.GlobalPosition;
                        float radians = angle * Mathf.Pi / 4;
                        var from = at + new Vector3(MathF.Sin(radians) * metres, 1.6f, MathF.Cos(radians) * metres);
                        if (!town.Walk.Free(from.X, from.Z)) continue;
                        View(from, at + Vector3.Up);
                        if (!Seen(at + Vector3.Up)) continue;
                        int newer = people.Count(p => p.Newer && Seen(p.Root.GlobalPosition + Vector3.Up));
                        int older = people.Count(p => !p.Newer && Seen(p.Root.GlobalPosition + Vector3.Up));
                        int fauna = animals.Count(a => Seen(a.GlobalPosition + Vector3.Up * .3f));
                        int score = (newer > 0 ? 100 : 0) + (older > 0 ? 100 : 0) + (fauna > 0 ? 100 : 0) + Math.Min(newer + older, 20);
                        if (best == null || score > best.Value.Score) best = (person, from, score);
                    }
                    if (best == null) throw new InvalidOperationException("No clear live default view: " + place);
                    var chosen = best.Value;
                    View(chosen.Camera, chosen.Person.Root.GlobalPosition + Vector3.Up);
                    for (int i = 0; i < 3; i++) await Frame();
                    await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    string name = $"default-{place}-{tag}-{metres:0}m.png";
                    using var image = Main.I.View.GetTexture().GetImage();
                    if (image.SavePng(Path.Combine(output, name)) != Error.Ok) throw new IOException(name);
                    var seen = People().Where(p => Seen(p.Root.GlobalPosition + Vector3.Up)).Select(p => new { p.Kind, p.Newer }).ToArray();
                    var faunaSeen = Animals.I.List.Count(a => a.shown && Seen(new Vector3((float)a.x, .3f, (float)a.z)));
                    receipts.Add(new { file = name, place, hour = Daylight.I.Hour, weather = Daylight.I.Weather, metres,
                        subject = chosen.Person.Kind, camera = chosen.Camera.ToString(), people = seen, animals = faunaSeen, defaultRouting = true });
                    GD.Print($"Default picture {name}: {seen.Count(p => p.Newer)} new, {seen.Count(p => !p.Newer)} original, {faunaSeen} animals");
                }
            }
            File.WriteAllText(Path.Combine(output, "default-game.json"), JsonSerializer.Serialize(new { ok = true, pictures = receipts }, new JsonSerializerOptions { WriteIndented = true }));
            GetTree().Quit();
        }
        catch (Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
}
