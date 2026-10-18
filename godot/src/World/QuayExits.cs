using System;
using System.Collections.Generic;
using System.Linq;
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
    /// <summary>Over a parapet and its handrail: the height the feet must clear (0: none in the way).</summary>
    public float Over;
    /// <summary>A ladder's head on the quay line (where its hoops stand), for the way down it.</summary>
    public float Wx, Wz;
    /// <summary>The ladder itself (its rungs and hoops, for the hands), or null for a landing.</summary>
    public QuayExits.Ladder? Of;
}

/// <summary>
/// The stone flights down the quay walls and the iron ladders (the browser's world/quaysteps.ts and the list of
/// flights in world/rijnkaai.ts). The stone and iron themselves are in the bake and solid; this knows where a swimmer
/// gets out. The flights come from the same list as the browser's. The ladders are placed by the browser once its
/// boats are in, so they are read back from the baked iron (the mesh "quay_iron"): two stiles that go down below the
/// lowest tide, and the hoop over the edge that tells which way the wall faces. The native town replaces those with
/// its own ladder model and hands their places and rung lines over (BakedWorld.NativeQuayLadders, issue 85).
/// </summary>
public static class QuayExits
{
    // sizes of a flight (quaysteps.ts, drawn again 2026-10-11): from the quay's edge stones (y 0.06) 13 risers down to
    // the landing; a top landing level with the quay, 12 treads of 0.31 m, the landing to 6.56 m down the wall. The
    // treads run out from the edge stones' face (0.235) to the parapet (1.6); the flight's face stands 1.9 m out.
    private const float CopeY = 0.06f, Going = 0.31f, Top = 2 * Going, U0 = 0.235f, Width = 1.6f, W = 1.9f, End = 6.56f;
    /// <summary>The handrail on the parapet, over the line of the nosings (quaysteps.ts RAIL_H).</summary>
    private const float RailH = 0.9f;
    private const int Treads = 12;
    private const float LandY = Tide.MidY + 0.4f;
    private const float Rise = (CopeY - LandY) / (Treads + 1);
    private const float FlightLen = Top + Treads * Going;
    /// <summary>The foot pier on the landing: swimmers climb on past it.</summary>
    private const float Foot1 = FlightLen + 0.02f + 0.45f;
    /// <summary>The middle of the walk down (quaysteps.ts floodExit).</summary>
    private const float UMid = (U0 + 0.42f + Width - 0.28f) / 2;
    private const float SLast = Top + (Treads - 0.5f) * Going;

    /// <summary>The browser's walking slope down a flight (quaysteps.ts slopeY), and where on it the height is y.</summary>
    private static float SlopeY(float s)
    {
        if (s >= FlightLen) return LandY;
        if (s <= SLast) return Math.Min(0, CopeY - ((s - Top) / Going + 0.5f) * Rise);
        float y = CopeY - Treads * Rise;
        return y + (LandY - y) * (s - SLast) / (FlightLen - SLast);
    }

    /// <summary>A point on a flight (the residents walking up from a boat at its landing, issue 154): s down the flight from
    /// its head, u out from the wall (Frame), at the height of the treads or the landing there.</summary>
    public static Vector3 OnFlight(Frame f, float s, float u) { var (x, z) = f.On(s, u); return new Vector3(x, SlopeY(s), z); }
    /// <summary>How far down the wall a flight's landing ends, and the middle of its treads out from the wall.</summary>
    public const float FlightEnd = End, FlightMid = UMid, FlightTop = Top;
    /// <summary>The flight whose head is at (x, z) on the quay line, or null.</summary>
    public static Frame? FlightAt(float x, float z) { foreach (var f in Flights) if (MathF.Abs(f.Ox - x) < 1 && MathF.Abs(f.Oz - z) < 1) return f; return null; }

    private static float SlopeS(float y)
    {
        float yLast = CopeY - Treads * Rise;
        if (y >= yLast) return Math.Max(0, Top + ((CopeY - y) / Rise - 0.5f) * Going);
        return SLast + (yLast - y) / (yLast - LandY) * (FlightLen - SLast);
    }

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

    /// <summary>
    /// What the baked ground has to leave free for the Werf flight (FlightList[0]; the water side is -z there): s down the
    /// flight from a little above the landing at its head to a little past the foot landing, u from the edge stones' face
    /// out past the handrail. NativeTown cuts the ground chunk that hangs over it (QuayNotch, issue 68).
    /// </summary>
    public static readonly Frame WerfFrame = new(-320, 0, -1, 0, 0, -1);
    public const float WerfNotchS0 = -0.05f, WerfNotchS1 = End + 0.1f, WerfNotchU0 = U0, WerfNotchU1 = Width + 0.2f;

    /// <summary>A frame on a quay wall: origin on the wall face, t along the wall (down the flight), n out over the water.</summary>
    public readonly record struct Frame(float Ox, float Oz, float Tx, float Tz, float Nx, float Nz)
    {
        public (float x, float z) On(float s, float u) => (Ox + Tx * s + Nx * u, Oz + Tz * s + Nz * u);
    }

    public sealed class Ladder
    {
        /// <summary>X, Z: on the quay line (the wall face under the coping); Top: the ground he steps out onto; N: out over the water.</summary>
        public float X, Z, Top, Nx, Nz;
        /// <summary>How far out from (X, Z) the rungs stand (the browser's ladder: 0.135; the native ladder stands clear of the coping).</summary>
        public float Rung = 0.135f;
        /// <summary>Where he stands when out: this far in from (X, Z).</summary>
        public float Inset = 0.9f;
        /// <summary>The lowest rung (for the checks and a climb down).</summary>
        public float Foot = Tide.LwMin - 0.45f;
        /// <summary>The highest rung, the rise between rungs and how far in from (X, Z) the hoops come down behind the coping (the native ladder's fit).</summary>
        public float TopRung = float.NaN, Pitch = 0.29f, HoopBack = -0.3f;
        /// <summary>Where a hand takes a rung (from the middle), the hoops' bar off the middle and how high they rise over the top rung (NativeQuayLadderModel).</summary>
        public const float GripX = 0.15f, HoopX = 0.252f, HoopRise = 0.62f;
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
            // swimmers climb onto the landing from its open side
            foreach (float s in new[] { Foot1 + 0.3f, (Foot1 + End) / 2, End - 0.5f })
            {
                var (gx, gz) = fr.On(s, W + 0.5f);
                var (ttx, ttz) = fr.On(s, W - 0.6f);
                Exits.Add(new Exit { Gx = gx, Gz = gz, Nx = fr.Nx, Nz = fr.Nz, Tx = ttx, Tz = ttz, Ty = LandY });
            }
            // (2026-10-11, Steve: "for stairs on quay I could not swim over the railing") and over the parapet and its
            // handrail, where the tread behind it lies near the water: up the face, a leg over the rail, onto the step
            for (float s = Top + 0.3f; s < FlightLen - 0.2f; s += 0.5f)
            {
                int k = (int)MathF.Floor((s - Top) / Going);
                float tread = CopeY - (k + 1) * Rise;
                float rail = CopeY - Math.Max(0, s - Top) / Going * Rise + RailH + 0.03f;
                var (gx, gz) = fr.On(s, W + 0.45f);
                var (ttx, ttz) = fr.On(Top + (k + 0.5f) * Going, UMid);
                Exits.Add(new Exit { Gx = gx, Gz = gz, Nx = fr.Nx, Nz = fr.Nz, Tx = ttx, Tz = ttz, Ty = tread, Over = rail });
            }
        }
        // the native town draws its own ladders and says where they are; else they are read back from the baked iron
        if (world.NativeQuayLadders is { } native)
            foreach (var l in native) AddLadder(l);
        else
            foreach (var n in BakedWorld.All(world))
                if (n is MeshInstance3D mi && mi.Mesh != null && mi.Name.ToString().StartsWith("quay_iron"))
                    foreach (var l in FindLadders(mi, mi.GlobalTransform)) AddLadder(l);
    }

    /// <summary>
    /// A ladder's way out of the water: the swimmer takes hold in front of the rungs (his body about 0.3 m off them
    /// while he climbs, Jef.StartClimb) and steps out on the ground behind the hoops.
    /// </summary>
    public static void AddLadder(Ladder l)
    {
        var nrm = new Vector2(l.Nx, l.Nz);
        var wall = new Vector2(l.X, l.Z);
        var g = wall + nrm * (l.Rung + 0.415f);
        var t = wall - nrm * l.Inset;
        Exits.Add(new Exit { Ladder = true, Gx = g.X, Gz = g.Y, Nx = nrm.X, Nz = nrm.Y, Tx = t.X, Tz = t.Y, Ty = l.Top, Wx = wall.X, Wz = wall.Y, Of = l });
        Ladders.Add(l);
    }

    /// <summary>
    /// The ladders in a mesh of quay iron (quaysteps.ts addLadder: the sizes below are its own), `xf` its pose in the
    /// world. The stiles' feet give the line of the wall (their spread runs along it), the hoop over the edge the side
    /// the water is on.
    /// </summary>
    public static List<Ladder> FindLadders(MeshInstance3D mi, Transform3D xf)
    {
        var found = new List<Ladder>();
        var pts = new List<Vector3>();
        for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
            foreach (var v in mi.Mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array())
                pts.Add(xf * v);
        // the feet of the stiles stand 0.7 m below the lowest spring tide; nothing else of iron goes so deep
        var feet = new List<List<Vector3>>();
        var cells = new Dictionary<(int, int), List<Vector3>>();
        foreach (var p in pts)
        {
            var key = ((int)MathF.Floor(p.X), (int)MathF.Floor(p.Z));
            if (!cells.TryGetValue(key, out var cell)) cells[key] = cell = new List<Vector3>();
            cell.Add(p);
            if (p.Y > Tide.LwMin - 0.5f) continue;
            var k = feet.FirstOrDefault(c => new Vector2(c[0].X - p.X, c[0].Z - p.Z).Length() < 0.9f);
            if (k == null) feet.Add(new List<Vector3> { p });
            else k.Add(p);
        }
        foreach (var foot in feet)
        {
            var c = new Vector2(foot.Average(p => p.X), foot.Average(p => p.Z)); // between the stiles, 0.135 m off the wall
            var near = new List<Vector3>();
            for (int cx = (int)MathF.Floor(c.X) - 1; cx <= (int)MathF.Floor(c.X) + 1; cx++)
                for (int cz = (int)MathF.Floor(c.Y) - 1; cz <= (int)MathF.Floor(c.Y) + 1; cz++)
                    if (cells.TryGetValue((cx, cz), out var cell)) near.AddRange(cell);
            float top = float.NegativeInfinity;
            foreach (var p in near)
                if (new Vector2(p.X, p.Z).DistanceTo(c) < 0.7f)
                    top = Math.Max(top, p.Y);
            float topY = top - 0.95f; // the hoop over the edge stands this high
            // the hoop reaches 0.36 m in over the stone: away from it is out over the water
            Vector2 back = Vector2.Zero;
            int nb = 0;
            foreach (var p in near)
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
            var rough = (c - back / nb).Normalized();
            // the line of the stiles: the long axis of the feet's spread (0.5 m along the wall, 0.05 m across it)
            float sxx = 0, sxz = 0, szz = 0;
            foreach (var p in foot)
            {
                float dx = p.X - c.X, dz = p.Z - c.Y;
                sxx += dx * dx; sxz += dx * dz; szz += dz * dz;
            }
            float angle = 0.5f * MathF.Atan2(2 * sxz, sxx - szz);
            var along = new Vector2(MathF.Cos(angle), MathF.Sin(angle));
            var nrm = new Vector2(-along.Y, along.X);
            if (nrm.Dot(rough) < 0) nrm = -nrm;
            if (nrm.Dot(rough) < 0.9f) nrm = rough; // (a foot cloud too round to tell the line: the hoop's way)
            var wall = c - nrm * 0.135f;
            float inset = Math.Abs(topY - LandY) < 0.05f ? 0.8f : 0.9f; // (the ladder off a landing's end: 0.8)
            found.Add(new Ladder { X = wall.X, Z = wall.Y, Top = topY, Nx = nrm.X, Nz = nrm.Y, Inset = inset, Foot = foot.Min(p => p.Y) + 0.25f });
        }
        return found;
    }

    /// <summary>M6 tides: where a swimmer finds his feet on a flooded flight: the treads at wading depth.</summary>
    private static Exit? FloodExit(Frame f, float level)
    {
        float deep = level - Tide.Wade; // the tread at this height is where swimming stops
        if (deep <= LandY + 0.05f || deep >= 0) return null;
        float sLine = SlopeS(deep);
        float sOut = Math.Max(0.3f, SlopeS(level - 0.55f)); // knee to thigh deep
        var (gx, gz) = f.On(Math.Min(End - 0.4f, sLine + 0.75f), UMid);
        var (tx, tz) = f.On(sOut, UMid);
        return new Exit { Gx = gx, Gz = gz, Nx = f.Tx, Nz = f.Tz, Tx = tx, Tz = tz, Ty = SlopeY(sOut) };
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
            // over the parapet: only where the step behind it lies at the waterline (deeper he swims over, higher he cannot reach)
            if (e.Ladder ? e.Ty < level + 0.3f : e.Over > 0 ? e.Ty < level - Tide.Wade - 0.3f || e.Ty > level + 0.15f : level > e.Ty + Tide.Wade || level < e.Ty - 0.9f) continue;
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
