using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World;

/// <summary>A place to climb out of the water: a ladder rung or the edge of a landing (world/quaysteps.ts Exit).</summary>
public sealed class Exit
{
    public bool Ladder;
    /// <summary>Where the swimmer holds on (in the water, in front of the ladder or the landing edge).</summary>
    public float Gx, Gz;
    /// <summary>Out of the wall, toward the swimmer.</summary>
    public float Nx, Nz;
    /// <summary>Where you stand when you are out: the quay, the pier deck or the landing.</summary>
    public float Tx, Tz, Ty;
}

/// <summary>
/// The stone flights down the quay walls and the iron ladders (the browser's world/quaysteps.ts and the list of
/// flights in world/rijnkaai.ts). The stone and iron themselves are in the bake and solid; this knows where a swimmer
/// gets out. The flights come from the same list as the browser's. The ladders are placed by the browser once its
/// boats are in, so they are read back from the baked iron (the mesh "quay_iron"): two stiles that go down below the
/// lowest tide, and the hoop over the edge that tells which way the wall faces.
/// </summary>
public static class QuayExits
{
    // sizes of a flight (quaysteps.ts)
    private const float Tread = 0.32f, Width = 1.3f, Parapet = 0.32f, Landing = 2.4f;
    private const float LandY = Tide.MidY + 0.4f;
    private static readonly int Steps = Math.Max(4, (int)MathF.Round(-LandY / 0.185f));
    private static readonly float FlightLen = Steps * Tread;

    /// <summary>Top of each flight on the quay line, and the way down along the wall (rijnkaai.ts FLIGHTS).</summary>
    private static readonly float[][] FlightList =
    {
        new float[] { -320, 0, -1, 0 }, // the Werf, west of the railing
        new float[] { -110, 0, -1, 0 }, // the Vismarkt quay
        new float[] { -70, 38, 0, 1 }, // the Canal des Brasseurs, east wall
        new float[] { -4, 0, -1, 0 }, // the Rijnkaai, by the start
        new float[] { 50, 0, 1, 0 }, // the Rijnkaai, by the cart stand
        new float[] { 186, 0, 1, 0 }, // the river quay north of the lock
        new float[] { 90, 46, 1, 0 }, // the Petit Bassin, south quay
        new float[] { 116, 110, 1, 0 }, // the Petit Bassin, north quay
    };

    /// <summary>A frame on a quay wall: origin on the wall face, t along the wall (down the flight), n out over the water.</summary>
    public readonly record struct Frame(float Ox, float Oz, float Tx, float Tz, float Nx, float Nz)
    {
        public (float x, float z) On(float s, float u) => (Ox + Tx * s + Nx * u, Oz + Tz * s + Nz * u);
    }

    public sealed class Ladder
    {
        public float X, Z, Top, Nx, Nz;
    }

    public static readonly List<Exit> Exits = new();
    public static readonly List<Frame> Flights = new();
    public static readonly List<Ladder> Ladders = new();
    private static bool built;

    public static void Build(BakedWorld world)
    {
        if (built) return;
        built = true;
        foreach (var f in FlightList)
        {
            float x = f[0], z = f[1], tx = f[2], tz = f[3];
            // the water side of the wall: the normal whose point a metre out lies in the river polygon
            bool left = Water.In(x - tz + tx * 2, z + tx + tz * 2);
            var fr = new Frame(x, z, tx, tz, left ? -tz : tz, left ? tx : -tx);
            Flights.Add(fr);
            float w = Width + Parapet, end = FlightLen + Landing;
            // swimmers climb onto the landing from its open side and its end
            foreach (float s in new[] { FlightLen + 0.5f, FlightLen + Landing / 2, end - 0.5f })
            {
                var (gx, gz) = fr.On(s, w + 0.5f);
                var (ttx, ttz) = fr.On(s, w - 0.6f);
                Exits.Add(new Exit { Gx = gx, Gz = gz, Nx = fr.Nx, Nz = fr.Nz, Tx = ttx, Tz = ttz, Ty = LandY });
            }
        }
        foreach (var n in BakedWorld.All(world))
            if (n is MeshInstance3D mi && mi.Mesh != null && mi.Name.ToString().StartsWith("quay_iron"))
                ReadLadders(mi);
    }

    /// <summary>The ladders in a mesh of quay iron (quaysteps.ts addLadder: the sizes below are its own).</summary>
    private static void ReadLadders(MeshInstance3D mi)
    {
        var xf = mi.GlobalTransform;
        var pts = new List<Vector3>();
        for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            foreach (var v in mi.Mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array())
                pts.Add(xf * v);
        // the feet of the stiles stand 0.7 m below the lowest spring tide; nothing else of iron goes so deep
        var feet = new List<(Vector3 sum, int n)>();
        foreach (var p in pts)
        {
            if (p.Y > Tide.LwMin - 0.5f) continue;
            int k = feet.FindIndex(c => new Vector2(c.sum.X / c.n - p.X, c.sum.Z / c.n - p.Z).Length() < 0.9f);
            if (k < 0) feet.Add((p, 1));
            else feet[k] = (feet[k].sum + p, feet[k].n + 1);
        }
        foreach (var (sum, n) in feet)
        {
            var c = new Vector2(sum.X / n, sum.Z / n); // between the stiles, 0.135 m off the wall
            float top = float.NegativeInfinity;
            foreach (var p in pts)
                if (new Vector2(p.X, p.Z).DistanceTo(c) < 0.7f)
                    top = Math.Max(top, p.Y);
            float topY = top - 0.95f; // the hoop over the edge stands this high
            // the hoop reaches 0.36 m in over the stone: away from it is out over the water
            Vector2 back = Vector2.Zero;
            int nb = 0;
            foreach (var p in pts)
            {
                var q = new Vector2(p.X, p.Z);
                float d = q.DistanceTo(c);
                if (p.Y > topY + 0.5f && d > 0.4f && d < 0.7f)
                {
                    back += q;
                    nb++;
                }
            }
            if (nb == 0) continue;
            var nrm = (c - back / nb).Normalized();
            var wall = c - nrm * 0.135f;
            float inset = Math.Abs(topY - LandY) < 0.05f ? 0.8f : 0.9f; // (the ladder off a landing's end: 0.8)
            var g = wall + nrm * 0.55f;
            var t = wall - nrm * inset;
            Exits.Add(new Exit { Ladder = true, Gx = g.X, Gz = g.Y, Nx = nrm.X, Nz = nrm.Y, Tx = t.X, Tz = t.Y, Ty = topY });
            Ladders.Add(new Ladder { X = wall.X, Z = wall.Y, Top = topY, Nx = nrm.X, Nz = nrm.Y });
        }
    }

    /// <summary>M6 tides: where a swimmer finds his feet on a flooded flight: the treads at wading depth.</summary>
    private static Exit? FloodExit(Frame f, float level)
    {
        float deep = level - Tide.Wade; // the tread at this height is where swimming stops
        if (deep <= LandY + 0.05f || deep >= 0) return null;
        float sLine = deep / LandY * FlightLen;
        float sOut = Math.Max(0.3f, (level - 0.55f) / LandY * FlightLen); // knee to thigh deep
        var (gx, gz) = f.On(Math.Min(FlightLen + Landing - 0.4f, sLine + 0.75f), Width / 2);
        var (tx, tz) = f.On(sOut, Width / 2);
        return new Exit { Gx = gx, Gz = gz, Nx = f.Tx, Nz = f.Tz, Tx = tx, Tz = tz, Ty = LandY * sOut / FlightLen };
    }

    /// <summary>The nearest place to climb out within reach at the water level now, or null.</summary>
    public static Exit? Near(float x, float z, float reach)
    {
        Exit? best = null;
        float bd = reach;
        float level = Tide.LevelAt(x, z);
        foreach (var e in Exits)
        {
            // a ladder whose top is under water, or a landing that is too deep or too high to climb onto
            if (e.Ladder ? e.Ty < level + 0.3f : level > e.Ty + Tide.Wade || level < e.Ty - 0.9f) continue;
            float d = MathF.Sqrt((e.Gx - x) * (e.Gx - x) + (e.Gz - z) * (e.Gz - z));
            if (d < bd)
            {
                bd = d;
                best = e;
            }
        }
        if (level > LandY + Tide.Wade)
            foreach (var f in Flights)
            {
                var e = FloodExit(f, level);
                if (e == null) continue;
                float d = MathF.Sqrt((e.Gx - x) * (e.Gx - x) + (e.Gz - z) * (e.Gz - z));
                if (d < bd)
                {
                    bd = d;
                    best = e;
                }
            }
        return best;
    }
}
