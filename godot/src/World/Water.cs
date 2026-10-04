using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// Where the water is: the outlines of the river, the docks, the canals and the moat from shared/city.json (`water`
/// rings), as the browser's rijnkaai.ts inWater reads them. The level comes from Tide.
/// </summary>
public static class Water
{
    private static readonly List<float[]> Rings = new();
    private static bool loaded;

    /// <summary>The town's data file: beside the Godot project in the repo, or --city path.</summary>
    public static string CityJson()
    {
        return Paths.City;
    }

    private static void Load()
    {
        loaded = true;
        string path = CityJson();
        if (!File.Exists(path))
        {
            GD.PrintErr($"no water outlines: {path} is missing (pass --city <shared/city.json>)");
            return;
        }
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        foreach (var w in doc.RootElement.GetProperty("water").EnumerateArray())
        {
            var ring = new List<float>();
            foreach (var p in w.GetProperty("outer").EnumerateArray())
            {
                ring.Add(p[0].GetSingle());
                ring.Add(p[1].GetSingle());
            }
            Rings.Add(ring.ToArray());
        }
    }

    /// <summary>Inside the river, the docks, a canal or the moat?</summary>
    public static bool In(float x, float z)
    {
        if (!loaded) Load();
        bool inside = false;
        foreach (var r in Rings)
            for (int i = 0, j = r.Length - 2; i < r.Length; j = i, i += 2)
            {
                float xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
                if (zi > z != zj > z && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
            }
        return inside;
    }

    /// <summary>The water's surface at (x, z) now. (The browser adds the drawn wave, a few centimetres; that comes with the water's own part.)</summary>
    public static float Level(float x, float z) => Tide.LevelAt(x, z);
}
