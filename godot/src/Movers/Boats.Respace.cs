using System;

namespace Scheldemist.Movers;

/// <summary>
/// Moored small boats the bake laid too close together (issues 75, 98): their drawn hulls, with every part's offset
/// (Dev/BoatWaterCheck.cs --boatcheck-spacing), overlapped or touched within 5 cm. The bake cannot be redone for a
/// few centimetres, so each boat's place is moved here, where the row reads it (Boats.Rows) and where the mooring
/// lines read their ends (ShipLines): the hull, her lamps, her smoke, her lines and her ground follow together.
/// Keyed by the place the bake gave her; the boat's own number in the row is unchanged.
/// </summary>
public static class MooredRespace
{
    // (what she is, where the bake put her, how far she is moved: x, z)
    private static readonly (string Kind, float X, float Z, float Dx, float Dz)[] Moves =
    {
        // the Vismarkt row (z -1.3), west to east: workboat, ship's boat, eelboat. The ship's boat's bow ran 0.4 m into the
        // workboat's end; her stern touched the eelboat's. The workboat moves the more: the ladder at -128.5 stays under her.
        ("workboat", -135.2f, -1.3f, -1.4f, 0f),
        ("shipsboat", -128.5f, -1.3f, -0.4f, 0f),
        // the vliet row at x -71: the dinghy's end touched the punt's (4 cm)
        ("dinghy", -71.1f, 135.7f, 0f, 0.2f),
    };

    /// <summary>How far the boat the bake put at (x, z) is moved, or nothing (the bake's places come to 0.1 m).</summary>
    public static (float Dx, float Dz) At(float x, float z)
    {
        foreach (var m in Moves)
            if (MathF.Abs(m.X - x) < 0.08f && MathF.Abs(m.Z - z) < 0.08f) return (m.Dx, m.Dz);
        return (0, 0);
    }
}
