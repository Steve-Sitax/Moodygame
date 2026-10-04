using System.Collections.Generic;
using Godot;
using Scheldemist.Town;

namespace Scheldemist.World;

/// <summary>
/// The walkers' spots for the soft shadows under them (the browser's main.ts updateBlobs): every drawn townsperson of
/// the crowd and Jef himself (not swimming, climbing or flying), half a metre round, handed to Blobs once a frame.
/// Not here yet: the handcarts, the trams and the omnibuses (their parts can hand theirs with Blobs.I.Set).
/// </summary>
[GamePart(36)]
public partial class BlobFeet : Node
{
    private readonly List<Blobs.Spot> spots = new(64);
    private Townspeople? town;

    /// <summary>For a check: the spots handed this frame.</summary>
    public int Count => spots.Count;

    public override void _Ready()
    {
        // (after the people moved, before the blobs are laid)
        ProcessPriority = 55;
    }

    public override void _Process(double delta)
    {
        if (Blobs.I is not { } blobs) return;
        spots.Clear();
        town ??= Main.I.GetNodeOrNull<Townspeople>("Townspeople");
        if (town?.Crowd is { } crowd)
            for (int i = 0; i < crowd.Walking.Count; i++)
            {
                var p = crowd.Walking[i];
                if (!p.Shown || p.Group == null || !GodotObject.IsInstanceValid(p.Group)) continue;
                var at = p.Group.GlobalPosition;
                spots.Add(new Blobs.Spot(at.X, at.Z, at.Y, 0.4f));
            }
        if (Player.Jef.I is { Swimming: false, Climbing: false, Fly: false } jef)
            spots.Add(new Blobs.Spot(jef.X, jef.Z, jef.Y, 0.4f));
        blobs.Set("people", spots);
    }
}
