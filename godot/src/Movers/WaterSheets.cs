using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// The water's sheets follow the water's levels (the browser's rijnkaai.ts updateTide): the river's big sheet at
/// the tide, the Petit Bassin's and its mouth at the dock's level, the lock chamber's at the chamber's (sloping
/// while both pairs of gates stand open). Only the
/// heights are set here; how the water looks is the look step's.
/// </summary>
[GamePart(25)]
public partial class WaterSheets : Node
{
    public static WaterSheets I { get; private set; } = null!;
    private readonly List<Node3D> river = new(), dock = new();
    private Node3D? chamber;
    private float chamberBase, riverBase, dockBase, chamberTilt0;
    private float shown = float.NaN;
    /// <summary>Where the river's sheet is drawn now.</summary>
    public float RiverShown => float.IsNaN(shown) ? Tide.River : shown;

    public override void _Ready()
    {
        I = this;
        foreach (var c in Mv.Town.GetChildren())
        {
            if (c is not MeshInstance3D { Mesh: not null } mi) continue;
            var box = mi.GlobalTransform * mi.Mesh.GetAabb();
            if (box.Size.Y > 0.06f || box.Position.Y > -0.3f) continue;
            var mid = box.GetCenter();
            if (box.Size.X > 500) river.Add(mi);
            else if (mid.X > 100 && mid.X < 120 && mid.Z > 5 && mid.Z < 41 && box.Size.X < 16) chamber = mi;
            else if (mid.X > 60 && mid.X < 180 && mid.Z > 40 && mid.Z < 120 && box.Size.X > 8) dock.Add(mi);
        }
        riverBase = river.Count > 0 ? river[0].Position.Y : 0;
        dockBase = dock.Count > 0 ? dock[0].Position.Y : 0;
        if (chamber != null)
        {
            chamberBase = chamber.Position.Y;
            chamberTilt0 = chamber.Rotation.X;
        }
        GD.Print($"water sheets: the river {river.Count}, the dock {dock.Count}, the lock chamber {(chamber != null ? 1 : 0)}");
        ProcessPriority = -60;
    }

    public override void _Process(double delta)
    {
        // (the browser eases a jump of the clock at 0.6 m a second; here the sheet, the boats and Jef's swimming all read
        // the one level in World/Tide.cs, so they agree at every moment)
        shown = Tide.River;
        foreach (var s in river) s.Position = s.Position with { Y = shown };
        foreach (var s in dock) s.Position = s.Position with { Y = Tide.Dock };
        if (chamber != null)
        {
            chamber.Position = chamber.Position with { Y = (Tide.ChamberA + Tide.ChamberB) / 2 };
            chamber.Rotation = chamber.Rotation with { X = -MathF.PI / 2 - MathF.Atan((Tide.ChamberB - Tide.ChamberA) / 35f) };
        }
    }
}
