using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The water's sheets (the browser's world/rijnkaai.ts): the river's sheet goes where the eye goes, in whole picture
/// tiles of 4 m so the ripples stay put, and lies under the land: it is the river, the canals, the vlieten and the
/// moat, all at the tide's level (Tide.River). The Petit Bassin, its mouth and the lock chamber have sheets of their
/// own at their own levels (Tide.Dock, the chamber's two ends: it slopes while both pairs of gates stand open); the
/// river's sheet is not drawn under them. The waves, the foam and the dark mirror are the psx water material
/// (Render/Psx.cs, Kind.Water). The tide's mud and marks on the walls stand still in the bake: only the water moves.
/// </summary>
[GamePart(35)]
public partial class Waters : Node
{
    private const float Size = 1200, Tile = 4;
    private MeshInstance3D? river;
    private readonly List<MeshInstance3D> dock = new();
    private MeshInstance3D? chamber;
    private static float level = float.NaN;
    /// <summary>Where the river's sheet lies now (it follows the tide at 0.6 m a second at most).</summary>
    public static float Level => float.IsNaN(level) ? Tide.River : level;

    /// <summary>The river sheet's material (the mirror's part sets its picture on it and on the basins').</summary>
    public static readonly List<ShaderMaterial> Materials = new();

    public override void _Ready()
    {
        ProcessPriority = 45;
        foreach (var n in BakedWorld.All(Main.I.World))
        {
            if (n is not MeshInstance3D mi || mi.Mesh == null || mi.Mesh.GetSurfaceCount() == 0) continue;
            if (mi.Mesh.SurfaceGetMaterial(0) is not ShaderMaterial m || !m.HasMeta("psx_water")) continue;
            if (!Materials.Contains(m)) Materials.Add(m);
            if (m.GetMeta("psx_water").AsInt32() != 1) continue;
            var box = mi.GetAabb();
            if (Math.Max(box.Size.X, box.Size.Y) > 500)
            {
                // the bake's river sheet is cut to the place it was baked at: ours is whole and goes with the eye
                mi.Visible = false;
                var mat = (ShaderMaterial)m.Duplicate();
                mat.SetShaderParameter("river", 1f);
                mat.SetMeta("psx_water", 1);
                Materials.Add(mat);
                var plane = new PlaneMesh { Size = new Vector2(Size, Size), SubdivideWidth = 239, SubdivideDepth = 239, Material = mat };
                // (the waves lift it: never culled by its flat box)
                plane.CustomAabb = new Aabb(new Vector3(-Size / 2, -3, -Size / 2), new Vector3(Size, 6, Size));
                river = new MeshInstance3D { Name = "river_sheet", Mesh = plane, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
                Main.I.View.AddChild(river);
            }
            else if (mi.GlobalPosition.Z < 40) chamber = mi;
            else dock.Add(mi);
        }
        if (river == null) GD.Print("waters: no river sheet in the bake");
    }

    public override void _Process(double delta)
    {
        var cam = Main.I.View.GetCamera3D();
        if (cam == null) return;
        // the water goes to the tide's level at 0.6 m a second at most (a jump of the clock: in a few seconds)
        float d = Tide.River - level;
        level = float.IsNaN(level) ? Tide.River : level + Mathf.Clamp(d, -0.6f * (float)delta, 0.6f * (float)delta);
        if (river != null)
        {
            var p = cam.GlobalPosition;
            river.GlobalPosition = new Vector3(MathF.Round(p.X / Tile) * Tile, level, MathF.Round(p.Z / Tile) * Tile);
        }
        foreach (var s in dock) s.GlobalPosition = new Vector3(s.GlobalPosition.X, Tide.Dock, s.GlobalPosition.Z);
        if (chamber != null)
        {
            // level, or sloping from the river gates (z 7) to the dock gates (z 42)
            chamber.GlobalPosition = new Vector3(chamber.GlobalPosition.X, (Tide.ChamberA + Tide.ChamberB) / 2, chamber.GlobalPosition.Z);
            chamber.Rotation = new Vector3(-MathF.PI / 2 - MathF.Atan((Tide.ChamberB - Tide.ChamberA) / 35), 0, 0);
        }
    }
}
