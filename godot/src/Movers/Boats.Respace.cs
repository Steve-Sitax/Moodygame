using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Movers;

/// <summary>
/// Moored boats the bake laid in the wrong place: too close together (issues 75, 98), on something (issue 109), or in
/// front of a quay ladder or a flight's landing (issue 87). The bake cannot be redone, so each boat's place is moved
/// here, where the row reads it (Boats.Rows), where the mooring lines read their ends (ShipLines) and where her ropes'
/// pieces are (Boats.Moorings): the hull, her lamps, her smoke, her lines and her ground follow together. A boat
/// with no room clear of the ladders is taken off her mooring (Gone). Keyed by the place the bake gave her; the
/// boat's own number in the row is unchanged. The engine's mooring list (NativeTownAssets) is the same list, at the
/// same places: Boats(), PublicBoats() and Transport() give the server the moved and the gone ones the same way.
/// </summary>
public static class MooredRespace
{
    // (what she is, where the bake put her, how far she is moved: x, z)
    private static readonly (string Kind, float X, float Z, float Dx, float Dz)[] Moves =
    {
        // the two Rhine barges alongside the landing stage (issue 109): her mooring chains ran 0.6-0.7 m into their bilges;
        // each lies 0.75 m further out from the stage (WILHELMINA to the east, ST. NIKOLAUS to the west)
        ("rhine_barge", -242.9f, -21.7f, 0.75f, 0f),
        ("rhine_barge", -255.1f, -41.8f, -0.75f, 0f),
        // Issue 87 (Steve 2026-10-17: every boat lay in front of a ladder or stairs; make room so a swimmer can use them):
        // each small boat that held a swimmer off a ladder's rungs or a flight's landing slides along her own length to the
        // nearest place 0.9 m clear of every way out, of the flights and of the other hulls (MoveTest.Ladders.cs, the
        // `ladders` part, made this list). Her own ladder stays next to her: down it, a step across onto her end.
        ("dinghy", 16.17f, -1.14f, -7.17f, 0f), // (between the ladders at x 2 and 16: east of them lies the lighters' berth)
        ("bumboat", 71.3f, 61.4f, 0f, -3.25f),
        ("punt", -81f, 194.1f, 0f, 3.25f),
        ("punt", -71f, 142.6f, 0f, 3.25f),
        ("dinghy", -71.14f, 196.15f, 0f, 3.25f),
        ("punt", -143f, 60.9f, 0f, 3.25f),
        ("dinghy", -101.17f, -1.14f, -3.5f, 0f),
        ("rowboat", -215.1f, -10.57f, 0f, 3.5f),
        ("oldboat", -64.29f, -1.08f, -3.5f, 0f),
        ("eelboat", -80.64f, 54.4f, 0f, 3.5f),
        ("oldboat", -80.92f, 88.25f, 0f, 3.5f),
        ("eelboat", -80.64f, 138.7f, 0f, 3.5f),
        ("eelboat", -71.36f, 54.3f, 0f, 3.5f),
        ("dinghy", -71.14f, 47.21f, 0f, 1.5f),
        ("rowboat", -71.1f, 117.6f, 0f, 3.5f),
        ("rowboat", -148.9f, 31.7f, 0f, 3.5f),
        ("dinghy", 138.17f, 47.14f, -3.75f, 0f),
        ("workboat", -71.26f, 24.8f, 0f, 3.75f),
        ("workboat", -135.2f, -1.3f, -5.4f, 0f), // (with its issue 98 move of 1.4 m: the ship's boat's bow ran into her end)
        ("oldboat", -71.08f, 165.29f, 0f, -4f),
        ("oldboat", -143.08f, 53.65f, 0f, -4f),
        ("rowboat", -94.43f, -1.1f, 4.5f, 0f),
        ("rowboat", -71.1f, 173.43f, 0f, -4.5f),
        ("rowboat", -80.9f, 80.9f, 0f, -4.5f),
        ("rowboat", -80.9f, 164.9f, 0f, -4.5f),
        ("oldboat", -80.92f, 172.25f, 0f, -4f),
        ("rowboat", -71.1f, 16.9f, 0f, -4.5f),
        ("rowboat", -71.1f, 80.9f, 0f, -4.5f),
        ("oldboat", -71.08f, 88.25f, 0f, -4f),
        ("gig", -148.98f, -12.15f, 0f, -5.25f),
        ("punt", -81f, 16.8f, 0f, -5.75f),
        ("rowboat", -80.9f, 24.3f, 0f, -4.5f),
        ("punt", -149f, 15.8f, 0f, -5.75f),
        ("shipsboat", -128.5f, -1.3f, 4.6f, 0f), // (with its issue 98 move of 0.4 m)
        ("rowboat", -80.9f, 108.6f, 0f, -4.5f),
        ("dinghy", -80.86f, 39.55f, 0f, -3.75f),
        ("dinghy", -80.86f, 123.85f, 0f, -3.75f),
        ("dinghy", -71.1f, 135.7f, 0f, -3.8f), // (with its issue 98 move of 0.2 m: her end touched the punt's)
        ("bumboat", -80.7f, 186.8f, 0f, -3.25f),
        ("bumboat", -71.3f, 102.8f, 0f, -3.25f),
        // the households' own boats (the residents row out in them): past the foot of their flight's landing
        ("punt", -73.28f, 43.5f, 0f, 5.5f),
        ("punt", 191.5f, -3.28f, 5.5f, 0f),
        ("rowboat", 55.5f, -3.28f, 5.75f, 2.03f), // (east of the flight, clear of the lighters' berth to the west; in against the wall)
    };

    // Issue 87: no room for these clear of the ladders (the canal's walls have a ladder every 7.5 m): off their moorings.
    // 46 of the town's 61 small boats stay; the residents take the ones that stay out more (ResidentJourneys).
    private static readonly (string Kind, float X, float Z)[] Gone =
    {
        ("eelboat", -120.96f, -1.36f),
        ("eelboat", -148.64f, 23.7f),
        ("workboat", 196.06f, -1.26f),
        ("workboat", -80.74f, 100.84f),
        ("workboat", -80.74f, 32.2f),
        ("workboat", -80.74f, 116.5f),
        ("workboat", -71.26f, 188.8f),
        ("shipsboat", 60.21f, -1.28f),
        ("punt", -71f, 129.25f),
        ("punt", -81f, 46.5f),
        ("punt", -81f, 130.8f),
        ("punt", -81f, 179.5f),
        ("punt", -71f, 95.5f),
        ("punt", -71f, 110.1f),
        ("rowboat", -71.1f, 180.9f),
    };

    private static bool Near(float ax, float az, float bx, float bz) => MathF.Abs(ax - bx) < 0.08f && MathF.Abs(az - bz) < 0.08f;

    /// <summary>How far the boat the bake put at (x, z) is moved, or nothing (the bake's places come to 0.1 m).</summary>
    public static (float Dx, float Dz) At(float x, float z)
    {
        foreach (var m in Moves)
            if (Near(m.X, m.Z, x, z)) return (m.Dx, m.Dz);
        return (0, 0);
    }

    /// <summary>Is the boat the bake put at (x, z) off her mooring?</summary>
    public static bool Removed(float x, float z) => Gone.Any(g => Near(g.X, g.Z, x, z));

    /// <summary>Where the bake put a boat that now lies at (x, z) (her place in this list's terms).</summary>
    public static (float X, float Z) Origin(float x, float z)
    {
        foreach (var m in Moves)
            if (Near(m.X + m.Dx, m.Z + m.Dz, x, z)) return (m.X, m.Z);
        return (x, z);
    }

    private static double N(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out double d) ? d : double.NaN;
    private static void Shift(JsonNode? n, float dx, float dz, string xKey = "x", string zKey = "z")
    {
        if (n is JsonObject o && o[xKey] != null && o[zKey] != null) { o[xKey] = Math.Round(N(o[xKey]) + dx, 3); o[zKey] = Math.Round(N(o[zKey]) + dz, 3); }
    }
    private static void ShiftPair(JsonNode? n, float dx, float dz)
    {
        if (n is JsonArray a && a.Count >= 2) { a[0] = Math.Round(N(a[0]) + dx, 3); a[1] = Math.Round(N(a[1]) + dz, 3); }
    }

    /// <summary>The engine's boats (NativeTownAssets Boats or PublicBoats) as they lie now: the moved ones at their new
    /// place (home, rings and mooring with them), the gone ones left out. The list keeps its order and owners.</summary>
    public static JsonArray Boats(JsonArray boats)
    {
        var result = new JsonArray();
        foreach (var node in boats)
        {
            if (node is not JsonObject b) continue;
            float x = (float)N(b["home"]?["x"] ?? b["x"]), z = (float)N(b["home"]?["z"] ?? b["z"]);
            if (Removed(x, z)) continue;
            var c = b.DeepClone().AsObject();
            var (dx, dz) = At(x, z);
            if (dx != 0 || dz != 0)
            {
                Shift(c, dx, dz); Shift(c["home"], dx, dz); Shift(c["mooring"], dx, dz);
                foreach (var ring in (c["rings"] as JsonArray) ?? new JsonArray()) ShiftPair(ring, dx, dz);
                foreach (var ring in (c["mooring"]?["rings"] as JsonArray) ?? new JsonArray()) ShiftPair(ring, dx, dz);
            }
            result.Add(c);
        }
        return result;
    }

    /// <summary>The households' transport record with their boats' homes where the boats now lie.</summary>
    public static JsonObject Transport(JsonObject record)
    {
        var c = record.DeepClone().AsObject();
        foreach (var v in (c["vehicles"] as JsonArray) ?? new JsonArray())
        {
            if (v?["kind"]?.GetValue<string>() != "boat" || v["home"] is not JsonArray home || home.Count < 2) continue;
            var (dx, dz) = At((float)N(home[0]), (float)N(home[1]));
            if (dx == 0 && dz == 0) continue;
            ShiftPair(home, dx, dz);
            ShiftPair(v["parks"]?["home"], dx, dz);
        }
        return c;
    }
}
