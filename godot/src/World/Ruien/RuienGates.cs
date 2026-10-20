using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The Ruien's gates in the town's quay walls (docs/ruien-native.md): each area's gate opening cut through the wall's
/// meshes it names, at load, before collision and navigation read them (the installed town resources stay as they are).
/// </summary>
public static class RuienGates
{
    public static List<string> Cut(Node3D town)
    {
        var notes = new List<string>();
        var data = RuienData.Load();
        foreach (var area in data.Areas)
            foreach (var g in area.Gates)
            {
                if (g.Opening.Length < 3 || g.Meshes.Length == 0) continue;
                int n = QuayNotch.CutConvex(town, g.Meshes, g.Origin, g.Normal, g.Opening, -0.6f, g.Depth + 0.4f, g.Clear);
                notes.Add($"gate {g.Id} of {area.Id}: {n} triangles cut from {string.Join(", ", g.Meshes)}");
            }
        // the street's holes over the ways down (a grate's shaft, a hatch's stair)
        foreach (var area in data.Areas)
            foreach (var w in area.Ways.Where(w => w.Kind is "ladder" or "grate" or "stair" or "keeper_stair"))
            {
                var hole = RuienSurround.Footprint(w);
                // Remove the whole paving/kerb volume, including upright kerb faces and its collision proxy.
                // The deep new surround fills this cut, and the old kerb terminates against its end stones.
                int n = QuayNotch.CutFloor(town, hole, -.45f, .30f,w.Round,solidCut:true);
                notes.Add($"{w.Kind} {w.Id} of {area.Id}: {n} triangles of the street cut over it");
            }
        return notes;
    }
}
