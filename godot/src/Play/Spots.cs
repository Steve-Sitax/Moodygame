using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>A named place for jobs (world/rijnkaai.ts Spot, shared/spots.json): where, its words, and the way goods stack away from it.</summary>
public sealed record Spot(string Id, string Label, float X, float Z, float DirX, float DirZ);

/// <summary>A street door of the town's plan (shared/city.json doors): its middle on the wall line, and the way out.</summary>
public sealed record CityDoor(string Id, float X, float Z, float OutX, float OutZ, float Width);

/// <summary>
/// The named places the jobs and the day use, read from the data the browser and the server share:
/// shared/spots.json (the jobs' places) and the doors of shared/city.json. world/rijnkaai.ts SPOTS, BOARD_POS,
/// DOSS_POS; world/city.ts doorSpot.
/// </summary>
public static class Spots
{
    private static Dictionary<string, Spot>? spots;
    private static Dictionary<string, CityDoor>? doors;

    private static string Shared(string file) => Path.Combine(Path.GetDirectoryName(Water.CityJson()) ?? ".", file);

    public static IReadOnlyDictionary<string, Spot> All
    {
        get
        {
            if (spots != null) return spots;
            spots = new Dictionary<string, Spot>();
            string path = Shared("spots.json");
            if (!File.Exists(path))
            {
                GD.PrintErr($"no job places: {path} is missing");
                return spots;
            }
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                if (p.Name.StartsWith('_') || p.Value.ValueKind != JsonValueKind.Object) continue;
                var d = p.Value.GetProperty("dir");
                spots[p.Name] = new Spot(p.Name, p.Value.GetProperty("label").GetString() ?? p.Name, p.Value.GetProperty("x").GetSingle(), p.Value.GetProperty("z").GetSingle(), d[0].GetSingle(), d[1].GetSingle());
            }
            return spots;
        }
    }

    public static Spot? Get(string? id) => id != null && All.TryGetValue(id, out var s) ? s : null;
    /// <summary>The place's words ("the pier head"), or the id when the place is not known.</summary>
    public static string Label(string? id) => Get(id)?.Label ?? id ?? "";

    public static IReadOnlyDictionary<string, CityDoor> Doors
    {
        get
        {
            if (doors != null) return doors;
            doors = new Dictionary<string, CityDoor>();
            string path = Water.CityJson();
            if (!File.Exists(path)) return doors;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (!doc.RootElement.TryGetProperty("doors", out var all)) return doors;
            foreach (var p in all.EnumerateObject())
            {
                var o = p.Value.GetProperty("out");
                doors[p.Name] = new CityDoor(p.Name, p.Value.GetProperty("x").GetSingle(), p.Value.GetProperty("z").GetSingle(), o[0].GetSingle(), o[1].GetSingle(), p.Value.TryGetProperty("width", out var w) ? w.GetSingle() : 1);
            }
            return doors;
        }
    }

    /// <summary>city.ts doorSpot: a point just outside a door, d metres out, `side` metres along the wall.</summary>
    public static (float X, float Z) DoorSpot(string name, float d = 1.5f, float side = 0)
    {
        if (!Doors.TryGetValue(name, out var door)) return (0, 0);
        return (door.X + door.OutX * d - door.OutZ * side, door.Z + door.OutZ * d + door.OutX * side);
    }

    /// <summary>A three.js node's name as Godot's glTF import writes it ("house_shop:bakery_rijn" is house_shop_bakery_rijn).</summary>
    public static string BakedName(string name)
    {
        var b = new System.Text.StringBuilder(name);
        foreach (char c in ".:@/\"%") b.Replace(c, '_');
        return b.ToString();
    }

    /// <summary>The hiring spot: a notice board by the Hessenatie's door.</summary>
    public static (float X, float Z) Board => DoorSpot("hessenatie", 3.2f, 5);
    /// <summary>The doss house step, 1.2 m out in the street.</summary>
    public static (float X, float Z) Doss => DoorSpot("doss", 1.2f);
    /// <summary>The doss house door itself, for looking at it.</summary>
    public static (float X, float Z) DossDoor => DoorSpot("doss", 0.1f);

    /// <summary>runs.ts slot: grid slot i around a spot, two columns, stacking along the spot's dir.</summary>
    public static (float X, float Z) Slot(Spot s, int i, float gap = 0.95f)
    {
        float side = (i % 2 == 1 ? 1 : -1) * 0.5f;
        float along = (float)Math.Floor(i / 2.0) * gap;
        return (s.X + s.DirX * along - s.DirZ * side, s.Z + s.DirZ * along + s.DirX * side);
    }
}
