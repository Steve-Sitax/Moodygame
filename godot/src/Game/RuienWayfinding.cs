using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;

namespace Scheldemist.Game;

/// <summary>Enamel plaques are baked to surveyed walls. This part supplies the live vault lighting
/// when the player first approaches the underground, outside the structural and collision builders.</summary>
[GamePart(122)]
public partial class RuienWayfinding : Node
{
    internal const string Plaques = "res://assets/models/ruien-wayfinding/street-plaques.scn";
    public const string Survey = "res://assets/models/ruien-wayfinding/street-plaques.json";
    public override void _Process(double delta)
    {
        if (!Main.I.Loaded || Ruien.I?.Near == null || Main.I.View.GetCamera3D() is not { } eye || eye.GlobalPosition.Y >= -.25f) return;
        SetProcess(false);
        if (!ResourceLoader.Exists(Plaques)) return;
        using var timing = Dev.StartupTiming.Measure("ruien.street-plaques");
        var root = GD.Load<PackedScene>(Plaques).Instantiate<Node3D>();
        root.Name = "RuienStreetPlaques";
        var blue = Finish(new Color("23465a"), .48f);
        var ivory = Finish(new Color("f2e6c8"), .65f);
        foreach (var sign in root.GetChildren().OfType<MeshInstance3D>())
        {
            sign.SetSurfaceOverrideMaterial(0, blue);
            sign.SetSurfaceOverrideMaterial(1, ivory);
        }
        Main.I.View.AddChild(root);
    }

    private static ShaderMaterial Finish(Color colour, float roughness)
    {
        var material = new ShaderMaterial { Shader = RuienMaterials.MasonryShader };
        material.SetShaderParameter("tint", colour);
        foreach (string key in new[] { "normal_k", "pom", "moss_k", "weather_k", "halo_k", "bake_k" })
            material.SetShaderParameter(key, 0f);
        material.SetShaderParameter("rough_k", roughness);
        return material;
    }
}

/// <summary>Screen-independent paths in world metres, read on first use of the paper map layer.</summary>
internal sealed class RuienMapSurvey
{
    public readonly List<Vector2[]> Passages = new();
    public readonly List<Vector2[]> Rooms = new();
    public readonly List<(Vector2 At, string Street)> Labels = new();
    public readonly List<(Vector2 At, string Route)> RouteNames = new();
    public readonly List<MapMark> Doors = new();

    public RuienMapSurvey(RuienData data)
    {
        var names = data.NetworkRoot.GetProperty("lines").EnumerateArray().ToDictionary(
            l => l.GetProperty("id").GetString()!, l => l.GetProperty("name").GetString()!);
        names["vlietrui"] = "Vlietrui";
        foreach (var area in data.Areas)
        foreach (var zone in area.Zones)
        {
            if (zone.Kind == "room")
            {
                var a = zone.Rect.Position;
                var b = zone.Rect.End;
                Rooms.Add(new[] { a, new Vector2(b.X,a.Y), b, new Vector2(a.X,b.Y) });
            }
            else if (zone.Path.Length >= 2)
            {
                Passages.Add(Simplify(zone.Path));
                if (names.TryGetValue(zone.Id, out var route)) RouteNames.Add((zone.Path[zone.Path.Length / 2], route));
            }
        }
        foreach (var door in RuienEntrance.All)
        {
            Doors.Add(new MapMark(door.Door.X, door.Door.Y, door.Name, "place", "Ruien entrance", "ruien-stair"));
            var access = new List<Vector2> { door.Door };
            foreach (var point in door.Route.Skip(1).Select(door.World).Concat(door.ConnectPath))
                access.Add(new Vector2(point.X, point.Z));
            if (door.ConnectPath.Length == 0 && door.ConnectLength > 0)
            {
                var frame = RuienEntrance.LinkFrame(door);
                var end = frame * new Vector3(0,0,door.ConnectLength);
                access.Add(new Vector2(frame.Origin.X,frame.Origin.Z));
                access.Add(new Vector2(end.X,end.Z));
            }
            if (access.Count >= 2) Passages.Add(Simplify(access));
        }
        if (!Godot.FileAccess.FileExists(RuienWayfinding.Survey)) return;
        using var signs = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienWayfinding.Survey));
        foreach (var sign in signs.RootElement.EnumerateArray())
        {
            var at = sign.GetProperty("at");
            Labels.Add((new Vector2(at[0].GetSingle(), at[2].GetSingle()), sign.GetProperty("street").GetString()!));
        }
    }

    // Keep every corner visible at maximum map zoom. Long straight runs need only two screen vertices.
    private static Vector2[] Simplify(IReadOnlyList<Vector2> points)
    {
        var kept = new List<Vector2> { points[0] };
        void Span(int first, int last)
        {
            float worst = .12f * .12f;
            int corner = -1;
            var a = points[first];
            var ab = points[last] - a;
            float len2 = ab.LengthSquared();
            for (int i = first + 1; i < last; i++)
            {
                float t = len2 > 0 ? Math.Clamp((points[i] - a).Dot(ab) / len2, 0, 1) : 0;
                float error = points[i].DistanceSquaredTo(a + t * ab);
                if (error > worst) { worst = error; corner = i; }
            }
            if (corner >= 0) { Span(first, corner); Span(corner, last); }
            else kept.Add(points[last]);
        }
        Span(0, points.Count - 1);
        return kept.ToArray();
    }
}
