using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

public partial class Boats
{
    /// <summary>
    /// The small boats' painters (issues 87, #182). The bake drew them as one mesh ("mooring_ropes", hidden here); now
    /// each small boat at her mooring has a painter from her stem or stern, whichever is nearer, to the nearest ring in
    /// the coping (within 5.5 m), and a stern line from her other end to a second ring when one lies on that side. A
    /// boat moved off a ladder (MooredRespace) ties up where she lies; one taken away at load has none. The rope itself
    /// (real thickness, a hitch round the ring, over the coping's nose, hanging and following her on the tide) is drawn
    /// by ShipLines with the ships' lines; her end is on her stem head, at her measured hull's height there.
    /// </summary>
    private void MooringRopes()
    {
        if (Mv.Top("mooring_ropes") is MeshInstance3D baked) baked.Visible = false;
        var rings = new List<Vector3>();
        foreach (var n in BakedWorld.All(Mv.Town))
            if (n is MultiMeshInstance3D { Multimesh: { } mm } r && n.Name.ToString().Contains("mooringrings"))
                for (int i = 0; i < mm.InstanceCount; i++) rings.Add(r.GlobalTransform * mm.GetInstanceTransform(i).Origin);
        var owners = new List<(Row Row, int I)>();
        int painters = 0, none = 0;
        foreach (var row in rows)
        {
            var d = Dims(row.Kind);
            if (d.Length >= 9) continue;
            var hull = HullOf(row.Kind);
            for (int i = 0; i < row.N; i++)
            {
                var (bx, bz) = MooredRespace.Origin(row.X[i], row.Z[i]);
                if (row.Gone[i] || MooredRespace.Removed(bx, bz)) continue;
                owners.Add((row, i));
                var at = new Vector2(row.X[i], row.Z[i]);
                var axis = new Vector2(MathF.Sin(row.Yaw[i]), MathF.Cos(row.Yaw[i]));
                var near = rings.Where(g => new Vector2(g.X, g.Z).DistanceTo(at) < 5.5f).OrderBy(g => new Vector2(g.X, g.Z).DistanceTo(at)).ToList();
                if (near.Count == 0) { none++; continue; }
                var first = near[0];
                float firstSide = MathF.Sign((new Vector2(first.X, first.Z) - at).Dot(axis));
                var tied = new List<(Vector3 Ring, float End)> { (first, firstSide == 0 ? 1 : firstSide) };
                // a second ring at her other end, at least two metres from the first
                foreach (var g in near.Skip(1))
                {
                    float side = MathF.Sign((new Vector2(g.X, g.Z) - at).Dot(axis));
                    if (side != 0 && side != tied[0].End && new Vector2(g.X, g.Z).DistanceTo(new Vector2(first.X, first.Z)) > 2f) { tied.Add((g, side)); break; }
                }
                var (row0, i0) = (row, i);
                foreach (var (ring, end) in tied)
                {
                    // across the boat from the ring to her middle: the way to the quay's nose; the ring lies on her other side
                    var localX = new Vector2(axis.Y, -axis.X);
                    var across = localX;
                    if ((at - new Vector2(ring.X, ring.Z)).Dot(across) < 0) across = -across;
                    var (stem, stemY, rail, railY) = StemHead(hull, d, end, -MathF.Sign(across.Dot(localX)));
                    Vector3 World(Vector2 l, float y) { var w = at + axis * l.Y + localX * l.X; return new Vector3(w.X, y, w.Y); }
                    // the painter comes over her gunwale on the quay's side by the stem and is made fast round the stem head
                    ShipLines.AddSmall(ring, new Vector3(across.X, 0, across.Y), World(rail, railY), World(stem, stemY), row.X[i], row.Z[i], row.Floor[i],
                        () => !row0.Gone[i0] && !playerHidden.Contains((row0, i0)) && (row0.Node == null || row0.Node.IsVisibleInTree()));
                    painters++;
                }
            }
        }
        ropeOwners = owners.ToArray();
        ropeRise = new float[owners.Count];
        Array.Fill(ropeRise, float.NaN);
        RopesFollowTide();
        GD.Print($"boats: {painters} painters of {owners.Count} small boats at their moorings from {rings.Count} rings ({none} with no ring in reach) drawn as rope that follows the tide (#182)");
    }

    /// <summary>
    /// A small boat's stem head (end +1) or stern post (-1), and her gunwale on one side (+1: her +x) a little in from it:
    /// their places in her frame (x across, y along) and heights over her waterline, from her measured hull.
    /// </summary>
    private static (Vector2 Stem, float StemY, Vector2 Rail, float RailY) StemHead(HullMap? hull, (float Length, float Beam, float Height) d, float end, float side)
    {
        var plain = (new Vector2(0, end * (d.Length / 2 - 0.3f)), 0.45f, new Vector2(side * (d.Beam / 2 - 0.15f), end * (d.Length / 2 - 0.6f)), 0.42f);
        if (hull == null) return plain;
        int cx = (int)((0 - hull.MinX) / HullMap.Cell);
        // the last column on her centre line at that end, then 25 cm in: the stem head's top
        int zEnd = -1;
        if (end > 0) { for (int z = hull.Nz - 1; z >= 0; z--) if (hull.Has(cx, z)) { zEnd = z; break; } }
        else { for (int z = 0; z < hull.Nz; z++) if (hull.Has(cx, z)) { zEnd = z; break; } }
        if (zEnd < 0) return plain;
        int zIn = Math.Clamp(zEnd - (int)MathF.Round(end * 0.25f / HullMap.Cell), 0, hull.Nz - 1);
        float top = float.NegativeInfinity;
        for (int x = cx - 1; x <= cx + 1; x++) if (hull.Has(x, zIn)) top = MathF.Max(top, hull.Hi[zIn * hull.Nx + x]);
        if (!float.IsFinite(top)) top = 0.45f;
        var stem = new Vector2(0, hull.MinZ + (zIn + 0.5f) * HullMap.Cell);
        // the gunwale 60 cm in from the stem: her outermost column on that side, its top
        int zG = Math.Clamp(zEnd - (int)MathF.Round(end * 0.6f / HullMap.Cell), 0, hull.Nz - 1), xG = -1;
        if (side > 0) { for (int x = hull.Nx - 1; x >= 0; x--) if (hull.Has(x, zG)) { xG = x; break; } }
        else { for (int x = 0; x < hull.Nx; x++) if (hull.Has(x, zG)) { xG = x; break; } }
        if (xG < 0) return (stem, top + 0.02f, plain.Item3, top);
        var rail = new Vector2(hull.MinX + (xG + 0.5f) * HullMap.Cell - side * 0.06f, hull.MinZ + (zG + 0.5f) * HullMap.Cell);
        return (stem, top + 0.02f, rail, hull.Hi[zG * hull.Nx + xG] + 0.02f);
    }

    private (Row Row, int I)[] ropeOwners = Array.Empty<(Row, int)>();
    private float[] ropeRise = Array.Empty<float>();
    /// <summary>For checks: how far each moored small boat's rope end has been moved with the tide from where the bake drew it.</summary>
    public IReadOnlyList<float> RopeRise => ropeRise;
    public int RopeRebuilds { get; private set; }

    /// <summary>
    /// #182: how far every small boat's rope end has risen or fallen with her height on the water (or on the mud) from
    /// where the bake drew it: the painters themselves are drawn by ShipLines from the same height.
    /// </summary>
    private void RopesFollowTide()
    {
        bool changed = false;
        for (int b = 0; b < ropeOwners.Length; b++)
        {
            var (row, i) = ropeOwners[b];
            float rise = MathF.Max(Tide.LevelAt(row.X[i], row.Z[i]), row.Floor[i]) - row.BakeY[i];
            if (float.IsNaN(ropeRise[b]) || MathF.Abs(rise - ropeRise[b]) >= 0.01f) { ropeRise[b] = rise; changed = true; }
        }
        if (changed) RopeRebuilds++;
    }
}
