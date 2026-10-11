using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The herring gulls of the river and the quays, and the pigeons of the squares (the browser's world/ambient.ts birds,
/// which the bake froze in mid-air: the "seagull still in the air" of the 2026-10-11 play test). By day the gulls
/// wheel in loose circles over the water near you, follow the fishing boats, stand on the bollards, the roof ridges by
/// the river and the rails of the moored boats, float and bob on the river, and squabble over scraps on the Vismarkt;
/// now and then one takes off and another comes down. At dusk they come down to the water and the roofs: no gull flies
/// at night unless you put it up. Walk or run at them and they go up and away. A flying bird never stops in the air.
/// The model is GullModel (eight parts on a few joints); each part is one MultiMesh for all birds of a kind, posed
/// every frame from C# (a fixed pool, no allocations), with the town's lit psx material of the bats: no new shader.
/// The gull calls of the soundscape come from a gull near you (Caller).
/// </summary>
[GamePart(43)]
public partial class Gulls : Node
{
    public static Gulls? I { get; private set; }

    private const int NGull = 36, NPigeon = 32;
    private enum Mode : byte { Wheel, Fly, Sit, Float }
    private enum Place : byte { Bollard, Ridge, Rail, Water, Market, Quay, Square }

    private sealed class Spot
    {
        public Place Kind;
        public Vector3 P;
        public float Yaw;
        public int Taken = -1;
        /// <summary>A boat's rail: its row and boat in Movers/Boats and the place in its frame.</summary>
        public int Row = -1, Boat;
        public Vector3 Local;
    }

    private sealed class Bird
    {
        public int Id;
        public bool Pigeon;
        public int Flock = -1;
        public float Seed;
        public Color Tint = Colors.White;
        public Mode M = Mode.Sit;
        public int Spot = -1;
        public Vector3 Pos, Prev, Vel, Ground;
        public float Yaw, Pitch, Roll;
        // wheeling round a centre (cx, cz), radius R at height Y0, W radians a second; a fishing boat's stern as the centre
        public float Cx, Cz, R, Y0, W, Th, WheelFor, OffK;
        public Vector3 Off;
        public River.Mover? Boat;
        // a flight from P0 (going V0) to P1 (going V1) in T seconds, K of the way; a hump of Lift metres
        public Vector3 P0, V0, P1, V1;
        public float T, K, Lift, Air, Delay;
        public int Goal = -1;
        public bool ToWheel, Cruising;
        public float CruiseT, Heading, TurnRate;
        // the wings (beat phase, how hard, folded 0..1, the landing's flare) and the legs (tucked 0..1)
        public float Phase, Amp, Fold = 1, Flare, Tuck;
        // standing and floating: what it does now (Act) for how long; the head; a walk; a hop
        public byte Act;
        public float ActT, Next, HY, HP, HR, Hop, HopT, Step, Dip, Call, Spread;
        public Vector3 WalkTo;
        public bool Walking;
        public bool Shown, Posed;
        public readonly Transform3D[] Local = new Transform3D[GullModel.Parts];
    }

    private sealed class Flock
    {
        public float X, Z, R, Up;
        public readonly List<Bird> Birds = new();
    }

    private readonly Bird[] birds = new Bird[NGull + NPigeon];
    private readonly List<Spot> spots = new();
    private readonly List<Flock> flocks = new();
    private readonly List<Vector2> anchors = new();
    private readonly int[] nearAnchor = new int[5];
    private readonly Random rng = new(1873);
    private GullModel.Rig[] rigs = null!;
    private readonly MultiMesh[,] mm = new MultiMesh[2, GullModel.Parts];
    private readonly Rid[,] rid = new Rid[2, GullModel.Parts];
    private readonly float[][][] buf = new float[2][][];
    private readonly int[] drawn = new int[2], shownN = { -1, -1 };
    private bool built;
    private int frameNo;
    private float clock;
    private Vector3 threatPrev;
    private float threatSpeed;
    private int lastFlushSound = -1000;
    private float soundGap;

    // the frame cost (for the checks): mean ms of this part's update, the bytes it allocated last frame
    private double costSum;
    private int costN;
    public long AllocatedLastFrame { get; private set; }
    public double MeanMs => costN > 0 ? costSum / costN : 0;
    private readonly long[] parts = new long[3];
    private long sendTicks, jointTicks;
    /// <summary>The mean ms of the gulls, the pigeons and the drawing.</summary>
    public string CostParts => costN > 0 ? $"gulls {parts[0] * 1000.0 / Stopwatch.Frequency / costN:0.000}, pigeons {parts[1] * 1000.0 / Stopwatch.Frequency / costN:0.000}, draw {parts[2] * 1000.0 / Stopwatch.Frequency / costN:0.000} (sending {sendTicks * 1000.0 / Stopwatch.Frequency / costN:0.000}, joints {jointTicks * 1000.0 / Stopwatch.Frequency / costN:0.000})" : "";

    /// <summary>For a check: the gulls drawn, in the air (flying or wheeling), sitting, floating; the pigeons drawn; the spots.</summary>
    public (int gulls, int air, int sitting, int floating, int pigeons, int spots, int triangles) Info
    {
        get
        {
            int air = 0, sit = 0, fl = 0;
            for (int i = 0; i < NGull; i++)
            {
                var b = birds[i];
                if (b == null) continue;
                if (b.M is Mode.Wheel or Mode.Fly) air++;
                else if (b.M == Mode.Sit) sit++;
                else fl++;
            }
            return (drawn[0], air, sit, fl, drawn[1], spots.Count, rigs?[0].Triangles ?? 0);
        }
    }

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 62;
        rigs = new[] { GullModel.Make(false), GullModel.Make(true) };
        var kind = new Psx.Kind(Unlit: false, Blend: false, Scissor: false, TwoSided: true, DepthWrite: true, Snap: true, Atlas: 0, VertexColor: true, Add: false, Fog: true);
        var mat = BakedWorld.PsxMaterial(new StandardMaterial3D { AlbedoColor = Colors.White, ResourceName = "alive_gulls" }, kind, 0, 1);
        int[] n = { NGull, NPigeon };
        for (int s = 0; s < 2; s++)
        {
            buf[s] = new float[GullModel.Parts][];
            for (int p = 0; p < GullModel.Parts; p++)
            {
                buf[s][p] = new float[n[s] * 16];
                var m = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, Mesh = rigs[s].Mesh[p], InstanceCount = n[s], VisibleInstanceCount = 0 };
                m.CustomAabb = new Aabb(new Vector3(-3000, -100, -3000), new Vector3(6000, 600, 6000));
                mm[s, p] = m;
                rid[s, p] = m.GetRid();
                Main.I.View.AddChild(new MultiMeshInstance3D { Name = (s == 0 ? "gulls_" : "pigeons_") + p, Multimesh = m, MaterialOverride = mat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
            }
        }
        // the bake's frozen birds (ambient.ts: the gulls in mid-air, the pigeons with their wings spread on the squares)
        foreach (var nd in BakedWorld.All(Main.I.World))
            if (nd is GeometryInstance3D g && (g.Name.ToString().EndsWith("ambientbirds_mm") || g.Name.ToString() == "ambient_birds"))
                g.Visible = false;
        Main.I.World.Unported.Remove("ambient_birds");
        // over the river, the Petit Bassin, the canal and the vliet (ambient.ts anchors), and over the quays
        for (int x = -330; x <= 190; x += 26) anchors.Add(new Vector2(x, -16 - (((x * 7919) % 13 + 13) % 13)));
        foreach (var a in new[] { new Vector2(100, 64), new Vector2(140, 92), new Vector2(122, 80), new Vector2(-76, 40), new Vector2(-76, 120), new Vector2(-76, 180), new Vector2(-146, 40) }) anchors.Add(a);
        for (int x = -150; x <= 60; x += 30) anchors.Add(new Vector2(x, 2));
        if (Main.I.Arg("gulltest") is { Length: > 0 }) TestStart();
    }

    private float R01() => rng.NextSingle();
    private float Rand(float a, float b) => a + (b - a) * rng.NextSingle();

    // ------------------------------------------------------------------ the places

    private static float? GroundAt(float x, float z, float from = 80)
    {
        var hit = Main.I.View.FindWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x, from, z), new Vector3(x, -20, z), Solid.Layer));
        return hit.Count > 0 ? hit["position"].AsVector3().Y : null;
    }

    private void Add(Place k, Vector3 p, float yaw) => spots.Add(new Spot { Kind = k, P = p, Yaw = yaw });

    /// <summary>The bollards, the quay beside them, the roof ridges by the river, the boats' rails, the water, the Vismarkt.</summary>
    private void Build()
    {
        built = true;
        // the bollards (rijnkaai.ts): the top of each, facing the river or along it
        foreach (var nd in BakedWorld.All(Main.I.World))
        {
            if (nd is not Node3D n3 || !n3.Name.ToString().StartsWith("bollard") || !n3.IsVisibleInTree()) continue;
            Aabb? box = null;
            foreach (var c in BakedWorld.All(n3))
                if (c is MeshInstance3D mi && mi.Mesh != null)
                {
                    var bb = mi.GlobalTransform * mi.GetAabb();
                    box = box is { } b0 ? b0.Merge(bb) : bb;
                }
            if (box is not { } bx || bx.Size.Y > 2 || bx.Size.X > 1.5f) continue;
            var top = new Vector3(bx.GetCenter().X, bx.End.Y, bx.GetCenter().Z);
            Add(Place.Bollard, top, Rand(-1, 1) + (R01() < 0.5f ? 0 : MathF.PI));
            // the quay beside it: on the land side, where a gull may walk
            for (int k = 0; k < 4; k++)
            {
                float a = k * MathF.PI / 2, x = top.X + MathF.Sin(a) * 1.6f, z = top.Z + MathF.Cos(a) * 1.6f;
                if (Water.In(x, z) || !Air.OpenAt(x, z, 0.5f)) continue;
                if (GroundAt(x, z, top.Y + 3) is { } gy && Math.Abs(gy - (top.Y - bx.Size.Y)) < 0.4f) { Add(Place.Quay, new Vector3(x, gy, z), Rand(0, MathF.Tau)); break; }
            }
        }
        // the roof ridges of the houses by the river (shared/city_build.json): a ray down on the middle of each
        string file = Paths.Shared("city_build.json");
        if (System.IO.File.Exists(file))
        {
            using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(file));
            var ridges = new List<(float d, Vector3 p, float yaw)>();
            foreach (var h in doc.RootElement.GetProperty("houses").EnumerateArray())
            {
                if (h.TryGetProperty("gone", out var gone) && gone.GetBoolean()) continue;
                float sx = 0, sz = 0; int c = 0;
                foreach (var pt in h.GetProperty("fp").EnumerateArray()) { sx += pt[0].GetSingle(); sz += pt[1].GetSingle(); c++; }
                if (c == 0) continue;
                float x = sx / c, z = sz / c;
                if (z < -5 || z > 40 || x < -330 || x > 190) continue;
                if (GroundAt(x, z) is not { } y || y < 6) continue;
                float yaw = 0;
                if (h.TryGetProperty("u", out var u)) yaw = MathF.Atan2(u[0].GetSingle(), u[1].GetSingle());
                ridges.Add((z, new Vector3(x, y, z), yaw));
            }
            ridges.Sort((a, b) => a.d.CompareTo(b.d));
            for (int i = 0; i < ridges.Count && i < 22; i++) Add(Place.Ridge, ridges[i].p, ridges[i].yaw + (R01() < 0.5f ? 0 : MathF.PI) + MathF.PI / 2 * (R01() < 0.3f ? 1 : 0));
        }
        // the rails of the moored and the small boats (two places a boat, midships)
        if (Boats.I is { } boats)
        {
            int railN = 0;
            for (int r = 0; r < boats.RowCount && railN < 28; r++)
            {
                var rail = boats.RailOf(r);
                for (int i = 0; i < boats.RowSize(r) && railN < 28; i += 2)
                {
                    if (boats.RowGone(r, i)) continue;
                    var at = boats.RowAt(r, i);
                    if (at.X < -330 || at.X > 190) continue;
                    float side = R01() < 0.5f ? -1 : 1;
                    spots.Add(new Spot { Kind = Place.Rail, Row = r, Boat = i, Local = new Vector3(side * rail.HalfBeam * 0.96f, rail.Y, rail.MidZ + Rand(-0.3f, 0.3f) * rail.HalfLength), Yaw = R01() < 0.5f ? 0 : MathF.PI });
                    railN++;
                }
            }
        }
        // the water: a few metres off the quay walls along the river, and round the docks' anchors
        for (int x = -320; x <= 180; x += 11)
        {
            float edge = float.NaN;
            for (float z = 6; z > -60; z -= 1) if (Water.In(x, z) && (Ways.Flags(x, z) & Ways.Water) != 0) { edge = z; break; }
            if (float.IsNaN(edge)) continue;
            foreach (float off in new[] { 5f, 14f })
            {
                float z = edge - off + Rand(-2, 2), xx = x + Rand(-3, 3);
                if (!Water.In(xx, z) || Boats.I?.HullAt(xx, z) == true) continue;
                Add(Place.Water, new Vector3(xx, 0, z), Rand(0, MathF.Tau));
            }
        }
        for (int a = 0; a < anchors.Count; a++)
            if (anchors[a].Y > 30)
                for (int k = 0; k < 3; k++)
                {
                    float x = anchors[a].X + Rand(-8, 8), z = anchors[a].Y + Rand(-8, 8);
                    if (Water.In(x, z) && Boats.I?.HullAt(x, z) != true) Add(Place.Water, new Vector3(x, 0, z), Rand(0, MathF.Tau));
                }
        // the Vismarkt: scraps on the stones round the fish benches
        for (int k = 0, got = 0; k < 60 && got < 9; k++)
        {
            float a = R01() * MathF.Tau, d = MathF.Sqrt(R01()) * 7, x = -118 + MathF.Cos(a) * d, z = 30 + MathF.Sin(a) * d;
            if (!Air.OpenAt(x, z, 0.6f) || GroundAt(x, z, 4) is not { } y || y > 1.2f) continue;
            Add(Place.Market, new Vector3(x, y, z), Rand(0, MathF.Tau));
            got++;
        }
        // the gulls: wheeling by day, the rest on their places
        bool day = Awake;
        for (int i = 0; i < NGull; i++)
        {
            var b = birds[i] = new Bird { Id = i, Seed = R01() };
            // one in five a young bird: brown all over, a dark bill (the tint over the adult's colours)
            if (R01() < 0.2f) b.Tint = new Color(0.66f, 0.56f, 0.46f).SrgbToLinear();
            else b.Tint = new Color(1, 1, 1) * Rand(0.94f, 1.0f);
            b.Tint.A = 1;
            b.R = Rand(9, 22);
            b.Y0 = i < 3 ? Rand(20, 28) : Rand(6, 18);
            b.W = Rand(6.5f, 9) / b.R * (R01() < 0.5f ? -1 : 1);
            b.Th = R01() * MathF.Tau;
            b.Phase = R01() * MathF.Tau;
            b.Next = Rand(20, 140);
            if (day && i < 14)
            {
                b.M = Mode.Wheel;
                b.Fold = 0;
                b.Tuck = 1;
                b.WheelFor = Rand(30, 150);
                Anchor(b, Eye, true);
                WheelPoint(b, clock, out b.Pos);
                b.Prev = b.Pos;
            }
            // (four over the fish on the Vismarkt by day, a few on the roofs)
            else if (day && i < 18 && MarketOpen && AnyFree(Place.Market) is { } ms) SitOn(b, ms, true);
            else if (i >= 30 && AnyFree(Place.Ridge) is { } rs) SitOn(b, rs, true);
            else if (FreeSpot(Eye, 400, b) is { } s) SitOn(b, s, true);
            else { b.M = Mode.Wheel; b.Fold = 0; Anchor(b, Eye, true); WheelPoint(b, clock, out b.Pos); }
        }
        // the pigeons on the squares (ambient.ts): the Grote Markt, the Steenplein, the Vismarkt
        float[,] squares = { { -254, 94, 11, 13 }, { -180, 20, 9, 11 }, { -118, 30, 6, 7 } };
        int pi = NGull;
        for (int q = 0; q < squares.GetLength(0); q++)
        {
            var f = new Flock { X = squares[q, 0], Z = squares[q, 1], R = squares[q, 2] };
            flocks.Add(f);
            for (int k = 0; k < (int)squares[q, 3] && pi < NGull + NPigeon; k++)
            {
                if (SquareSpot(f, null) is not { } p) continue;
                var b = birds[pi] = new Bird { Id = pi, Pigeon = true, Flock = q, Seed = R01(), Pos = p, Ground = p, Prev = p, Yaw = R01() * MathF.Tau, Next = R01() * 3, Fold = 1, Phase = R01() * 6 };
                float g = Rand(0.85f, 1.1f);
                b.Tint = R01() < 0.12f ? new Color(1.35f, 1.3f, 1.25f) : R01() < 0.15f ? new Color(0.62f, 0.5f, 0.44f) : new Color(g, g, g * 1.02f);
                f.Birds.Add(b);
                pi++;
            }
        }
        GD.Print($"gulls: {spots.Count} places ({Count(Place.Bollard)} bollards, {Count(Place.Ridge)} ridges, {Count(Place.Rail)} rails, {Count(Place.Water)} on the water, {Count(Place.Quay)} quay, {Count(Place.Market)} market), {NGull} gulls, {pi - NGull} pigeons, {rigs[0].Triangles} and {rigs[1].Triangles} triangles a bird");
    }

    private int Count(Place k) { int n = 0; foreach (var s in spots) if (s.Kind == k) n++; return n; }

    private Spot? AnyFree(Place k)
    {
        int n = 0;
        foreach (var s in spots) if (s.Kind == k && s.Taken < 0) n++;
        if (n == 0) return null;
        int pick = (int)(R01() * n);
        foreach (var s in spots) if (s.Kind == k && s.Taken < 0 && pick-- == 0) return s;
        return null;
    }

    private Vector3? SquareSpot(Flock f, Vector2? awayFrom)
    {
        Vector3? best = null;
        float bestD = -1;
        for (int k = 0; k < (awayFrom == null ? 20 : 8); k++)
        {
            float a = R01() * MathF.Tau, d = MathF.Sqrt(R01()) * f.R, x = f.X + MathF.Cos(a) * d, z = f.Z + MathF.Sin(a) * d;
            if (!Air.OpenAt(x, z, 1)) continue;
            float y = GroundAtCached(x, z);
            var p = new Vector3(x, y, z);
            if (awayFrom == null) return p;
            float dd = new Vector2(x, z).DistanceTo(awayFrom.Value);
            if (dd > bestD) { bestD = dd; best = p; }
        }
        return best;
    }

    /// <summary>The squares and the market are flat: the ground under a flock is measured once a square.</summary>
    private readonly Dictionary<(int, int), float> groundCache = new();
    private float GroundAtCached(float x, float z)
    {
        var key = ((int)MathF.Floor(x / 4), (int)MathF.Floor(z / 4));
        if (groundCache.TryGetValue(key, out var y)) return y;
        y = GroundAt(x, z, 6) ?? 0;
        if (y > 1.5f) y = 0;
        groundCache[key] = y;
        return y;
    }

    /// <summary>Where a spot is now (a boat's rail heaves with it, the water with the tide).</summary>
    private Vector3 SpotAt(Spot s)
    {
        if (s.Kind == Place.Rail && Boats.I is { } boats) return boats.RowWorld(s.Row, s.Boat) * s.Local;
        if (s.Kind == Place.Water) return new Vector3(s.P.X, Water.Level(s.P.X, s.P.Z), s.P.Z);
        return s.P;
    }

    private float SpotYaw(Spot s)
    {
        if (s.Kind == Place.Rail && Boats.I is { } boats)
        {
            var z = boats.RowWorld(s.Row, s.Boat).Basis.Z;
            return MathF.Atan2(z.X, z.Z) + s.Yaw;
        }
        return s.Yaw;
    }

    private bool Awake => Daylight.I is { } d && d.Night < 0.45f && d.Weather != "storm" && d.Storm < 0.3f;

    private static bool MarketOpen => Daylight.I is { } d && d.Hour > 6.5f && d.Hour < 16.5f;

    private Vector3 Eye => Main.I.Cam.GlobalPosition;

    /// <summary>A free place for a gull near a point, by what suits the hour (the water and the roofs at night).</summary>
    private Spot? FreeSpot(Vector3 near, float maxD, Bird b, Vector3? avoid = null)
    {
        bool day = Awake, market = MarketOpen;
        Spot? best = null;
        float bestS = 0;
        for (int i = 0; i < spots.Count; i++)
        {
            var s = spots[i];
            if (s.Taken >= 0 || s.Kind == Place.Square) continue;
            var p = SpotAt(s);
            // (no water left there at low tide: the mud of the canal and the vliet)
            if (s.Kind == Place.Water && p.Y < Boats.BedAt(p.X, p.Z) + 0.4f) continue;
            float d = new Vector2(p.X - near.X, p.Z - near.Z).Length();
            if (d > maxD) continue;
            if (avoid is { } av && new Vector2(p.X - av.X, p.Z - av.Z).Length() < 9) continue;
            float w = s.Kind switch
            {
                Place.Water => day ? 1.2f : 1.6f,
                Place.Ridge => day ? 0.8f : 1.2f,
                Place.Rail => day ? 1.0f : 0.8f,
                Place.Bollard => day ? 1.3f : 0.6f,
                Place.Market => market && day ? 1.6f : 0,
                Place.Quay => day ? 0.9f : 0.2f,
                _ => 0,
            };
            if (w <= 0) continue;
            float sc = w * (0.4f + R01()) / (1 + d / 45);
            if (sc > bestS) { bestS = sc; best = s; }
        }
        return best;
    }

    // ------------------------------------------------------------------ wheeling

    /// <summary>A new circle for a wheeling gull: over the water nearest the point (a fishing boat if one is near and the bird likes boats).</summary>
    private void Anchor(Bird b, Vector3 near, bool now)
    {
        b.Boat = null;
        if (b.Id >= 3 && b.Seed < 0.3f && FishingBoat(near) is { } boat)
        {
            b.Boat = boat;
            b.R = Rand(4.5f, 8);
            b.Y0 = Rand(4.5f, 8);
            b.W = Rand(7, 9) / b.R * (b.Seed < 0.15f ? -1 : 1);
            Stern(b, 0);
            return;
        }
        if (b.Id < 3)
        {
            // three high over the roofs wherever you are
            b.Cx = near.X + (b.Seed - 0.5f) * 40;
            b.Cz = near.Z + ((b.Seed * 3.7f) % 1 - 0.5f) * 40;
            return;
        }
        // the five anchors nearest the point: one of them by the bird's own dice
        for (int k = 0; k < 5; k++) nearAnchor[k] = -1;
        for (int i = 0; i < anchors.Count; i++)
        {
            float d = new Vector2(anchors[i].X - near.X, anchors[i].Y - near.Z).LengthSquared();
            for (int k = 0; k < 5; k++)
                if (nearAnchor[k] < 0 || d < new Vector2(anchors[nearAnchor[k]].X - near.X, anchors[nearAnchor[k]].Y - near.Z).LengthSquared())
                {
                    for (int m = 4; m > k; m--) nearAnchor[m] = nearAnchor[m - 1];
                    nearAnchor[k] = i;
                    break;
                }
        }
        int pick = nearAnchor[(int)(R01() * 5) % 5];
        if (pick < 0) pick = 0;
        b.Cx = anchors[pick].X + (b.Seed - 0.5f) * 16;
        b.Cz = anchors[pick].Y + ((b.Seed * 7.3f) % 1 - 0.5f) * 10;
        b.R = Rand(9, 22);
        b.Y0 = Rand(6, 18);
        b.W = Rand(6.5f, 9) / b.R * (b.W < 0 ? -1 : 1);
    }

    private static River.Mover? FishingBoat(Vector3 near)
    {
        if (River.I == null) return null;
        River.Mover? best = null;
        double bd = 160 * 160;
        var list = River.I.Movers;
        for (int i = 0; i < list.Count; i++)
        {
            var m = list[i];
            if (m.Parts.Count == 0) continue;
            string k = m.K.Parts.Length > 0 ? m.K.Parts[0] : "";
            if (k is not ("sloop_sail" or "hengst_sail" or "rowboat")) continue;
            var o = m.Parts[0].Boat.Outer.Position;
            double d = (o.X - near.X) * (o.X - near.X) + (o.Z - near.Z) * (o.Z - near.Z);
            if (d < bd) { bd = d; best = m; }
        }
        return best;
    }

    /// <summary>The circle's centre behind a fishing boat's stern, ahead by `ahead` seconds.</summary>
    private static void Stern(Bird b, float ahead)
    {
        var m = b.Boat!;
        var o = m.Parts[0].Boat.Outer.Position;
        float len = (float)m.Parts[0].Len;
        b.Cx = o.X - (float)m.Hx * (len * 0.5f + 3) + (float)(m.Hx * m.V) * ahead;
        b.Cz = o.Z - (float)m.Hz * (len * 0.5f + 3) + (float)(m.Hz * m.V) * ahead;
    }

    private static void WheelPoint(Bird b, float t, out Vector3 p)
    {
        float r = b.R * (1 + 0.22f * MathF.Sin(b.Th * 0.5f + b.Seed * 9));
        p = new Vector3(b.Cx + MathF.Cos(b.Th) * r, b.Y0 + 1.6f * MathF.Sin(t * 0.3f + b.Seed * 20), b.Cz + MathF.Sin(b.Th) * r);
    }

    // ------------------------------------------------------------------ flights

    /// <summary>Up and away to wheel again (or to another place when `to` is given), away from `from` if it was put up.</summary>
    private void TakeOff(Bird b, Vector3? from, Spot? to)
    {
        var p = b.Pos + Vector3.Up * (b.M == Mode.Sit ? rigs[b.Pigeon ? 1 : 0].Stand : 0);
        Vector3 away;
        if (from is { } f && new Vector2(p.X - f.X, p.Z - f.Z).LengthSquared() > 1e-4f) away = new Vector3(p.X - f.X, 0, p.Z - f.Z).Normalized();
        else away = new Vector3(MathF.Sin(b.Yaw), 0, MathF.Cos(b.Yaw));
        Release(b);
        if (from == null && to == null && !b.Pigeon && testPhase == "night") ownFlightsAtNight++;
        b.M = Mode.Fly;
        b.P0 = p;
        b.Pos = p;
        b.Prev = p;
        b.V0 = away * (b.Pigeon ? 3.2f : 3.6f) + Vector3.Up * (b.Pigeon ? 3.5f : 2.4f);
        b.Vel = b.V0;
        b.Air = 0;
        b.K = 0;
        b.Walking = false;
        b.Act = 0;
        if (b.Pigeon) return;
        if (to == null)
        {
            Anchor(b, Eye, false);
            PlanWheel(b);
        }
        else PlanLand(b, to);
    }

    // A flight: a steered cruise (its own speed, a limited turn, over the roofs when far), then a short curve to
    // finish: onto the circle (Join) or down onto the place with the flare (Approach). A long curve of one piece
    // overshot and slowed to a stop in the air.
    private const float Cruise = 8.5f, Turn = 1.3f;

    /// <summary>Off to wheel: cruising to the circle, then onto it.</summary>
    private void PlanWheel(Bird b)
    {
        b.ToWheel = true;
        b.Goal = -1;
        b.Cruising = true;
        b.CruiseT = 0;
        b.Lift = 0;
    }

    /// <summary>Off to a place: cruising there, then the approach with the flare.</summary>
    private void PlanLand(Bird b, Spot s)
    {
        b.ToWheel = false;
        b.Boat = null;
        Take(b, s);
        b.Cruising = true;
        b.CruiseT = 0;
        b.Lift = 0;
    }

    /// <summary>The last curve onto the circle: to a point of it a little round from the bird, going its way.</summary>
    private void Join(Bird b)
    {
        b.Cruising = false;
        b.P0 = b.Pos;
        b.V0 = b.Vel;
        // a point far enough round the circle for a smooth curve onto it (about a second and a half away or more)
        float th = MathF.Atan2(b.Pos.Z - b.Cz, b.Pos.X - b.Cx), r = b.R, v1 = 1;
        for (int k = 0; k < 6; k++)
        {
            b.Th = th + MathF.Sign(b.W) * (0.7f + 0.45f * k);
            r = b.R * (1 + 0.22f * MathF.Sin(b.Th * 0.5f + b.Seed * 9));
            v1 = Math.Abs(b.W) * r;
            WheelPoint(b, clock, out var p1);
            b.T = 2 * (p1 - b.P0).Length() / (b.V0.Length() + v1);
            if (b.T > 1.5f) break;
        }
        th = b.Th;
        b.T = Math.Clamp(b.T, 0.8f, 7);
        WheelPoint(b, clock + b.T, out b.P1);
        b.V1 = new Vector3(-MathF.Sin(th), 0, MathF.Cos(th)) * (b.W * r);
        if (b.Boat != null) b.V1 += new Vector3((float)(b.Boat.Hx * b.Boat.V), 0, (float)(b.Boat.Hz * b.Boat.V));
        b.K = 0;
    }

    /// <summary>The last curve down onto the place: slowing over it, the last second a flare with the feet down.</summary>
    private void Approach(Bird b)
    {
        b.Cruising = false;
        b.P0 = b.Pos;
        b.V0 = b.Vel;
        var p1 = SpotAt(spots[b.Goal]);
        var dir = new Vector3(p1.X - b.P0.X, 0, p1.Z - b.P0.Z);
        dir = dir.LengthSquared() > 1e-4f ? dir.Normalized() : new Vector3(MathF.Sin(b.Yaw), 0, MathF.Cos(b.Yaw));
        b.P1 = p1;
        b.V1 = dir * 2.2f + Vector3.Down * 0.4f;
        b.T = Math.Clamp(2 * (p1 - b.P0).Length() / (b.V0.Length() + 2.2f), 1.6f, 6);
        b.K = 0;
    }

    /// <summary>One step of the cruise: turn toward the goal at most Turn radians a second, keep the speed, climb over the roofs.</summary>
    private void CruiseStep(Bird b, float dt)
    {
        var goal = b.ToWheel ? new Vector3(b.Cx, b.Y0, b.Cz) : SpotAt(spots[b.Goal]);
        var h = new Vector2(goal.X - b.Pos.X, goal.Z - b.Pos.Z);
        float dist = h.Length();
        var vh = new Vector2(b.Vel.X, b.Vel.Z);
        float speed = vh.Length();
        float heading = speed > 0.1f ? MathF.Atan2(vh.X, vh.Y) : b.Yaw;
        float want = MathF.Atan2(h.X, h.Y);
        float diff = Mathf.Wrap(want - heading, -MathF.PI, MathF.PI);
        bool facing = MathF.Abs(diff) < 0.6f;
        // finish: within reach and heading its way (else fly on and come round)
        // (and never round and round a place it cannot line up for)
        b.CruiseT += dt;
        bool late = b.CruiseT > 6 + dist / Cruise * 1.5f && dist < 40;
        if (late || (b.ToWheel ? dist < b.R + 14 && MathF.Abs(diff) < 1.2f : dist < 24 && facing)) { if (b.ToWheel) Join(b); else Approach(b); return; }
        if (!(dist < 14 && !facing)) heading += Math.Clamp(diff, -Turn * dt, Turn * dt);
        speed = Mathf.Lerp(speed, Cruise, 1 - MathF.Exp(-dt * 0.9f));
        // over the roofs on the way (the quays' houses are up to 15 m), down to the goal near it
        float y = dist > 34 ? Math.Max(goal.Y + 3, 15) : dist > 12 ? Math.Max(goal.Y + 3, 4) : goal.Y + 3;
        float vy = Math.Clamp((y - b.Pos.Y) * 0.6f, -2.2f, 2.8f);
        if (b.Air < 1.2f) vy = Math.Max(vy, 2.0f);
        b.Vel = new Vector3(MathF.Sin(heading) * speed, vy, MathF.Cos(heading) * speed);
        b.Pos += b.Vel * dt;
    }

    private void Take(Bird b, Spot s)
    {
        b.Goal = spots.IndexOf(s);
        s.Taken = b.Id;
    }

    private void Release(Bird b)
    {
        if (b.Goal >= 0 && spots[b.Goal].Taken == b.Id) spots[b.Goal].Taken = -1;
        if (b.Spot >= 0 && spots[b.Spot].Taken == b.Id) spots[b.Spot].Taken = -1;
        b.Goal = -1;
        b.Spot = -1;
    }

    /// <summary>Straight onto a place (at the start, or the end of a flight).</summary>
    private void SitOn(Bird b, Spot s, bool now)
    {
        if (b.Goal < 0 || spots[b.Goal] != s) { Release(b); Take(b, s); }
        b.Spot = b.Goal;
        b.Goal = -1;
        b.M = s.Kind == Place.Water ? Mode.Float : Mode.Sit;
        b.Ground = SpotAt(s);
        if (now)
        {
            b.Pos = b.Ground;
            b.Prev = b.Pos;
            b.Yaw = SpotYaw(s);
            b.Fold = 1;
            b.Tuck = 0;
            b.Amp = 0;
        }
        b.Vel = Vector3.Zero;
        b.Next = Rand(25, 150);
        b.Act = 0;
        b.ActT = Rand(1, 4);
    }

    private static Vector3 Hermite(Vector3 p0, Vector3 v0, Vector3 p1, Vector3 v1, float T, float k)
    {
        float k2 = k * k, k3 = k2 * k;
        return p0 * (2 * k3 - 3 * k2 + 1) + v0 * (T * (k3 - 2 * k2 + k)) + p1 * (-2 * k3 + 3 * k2) + v1 * (T * (k3 - k2));
    }

    // ------------------------------------------------------------------ every frame

    public override void _Process(double delta)
    {
        if (Daylight.I == null) return;
        long t0 = Stopwatch.GetTimestamp(), a0 = GC.GetAllocatedBytesForCurrentThread();
        float dt = Math.Clamp((float)delta, 0, 0.1f);
        if (!built)
        {
            if (Solid.I != null && !Solid.I.Settled && clock < 4) { clock += dt; return; }
            Build();
            return;
        }
        clock += dt;

        var eye = Eye;
        // who puts them up: Jef, wherever he walks (the free camera does not)
        var threat = testThreat ?? (Player.Jef.I is { } jef ? new Vector3(jef.X, jef.Y, jef.Z) : eye);
        float sp = dt > 0 ? new Vector2(threat.X - threatPrev.X, threat.Z - threatPrev.Z).Length() / dt : 0;
        threatSpeed = sp > 30 ? threatSpeed : Mathf.Lerp(threatSpeed, sp, 1 - MathF.Exp(-dt * 6));
        threatPrev = threat;
        bool awake = Awake;
        float rain = Daylight.I.Rain;
        int wantAir = awake ? (rain > 0.5f ? 5 : 14) : 0;
        int air = 0;
        for (int i = 0; i < NGull; i++) if (birds[i].M is Mode.Wheel or Mode.Fly) air++;
        soundGap -= dt;

        for (int i = 0; i < NGull; i++) StepGull(birds[i], dt, eye, threat, awake, ref air, wantAir);
        long t1 = Stopwatch.GetTimestamp();
        if (Market()) Squabble();
        StepPigeons(dt, threat);
        if (Sheet) PoseSheet();
        TestStep(dt);
        long t2 = Stopwatch.GetTimestamp();
        Draw(eye);
        long t3 = Stopwatch.GetTimestamp();
        parts[0] += t1 - t0; parts[1] += t2 - t1; parts[2] += t3 - t2;
        costSum += (Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency;
        costN++;
        AllocatedLastFrame = GC.GetAllocatedBytesForCurrentThread() - a0;
    }

    private bool Market() => MarketOpen && Awake;

    private void StepGull(Bird b, float dt, Vector3 eye, Vector3 threat, bool awake, ref int air, int wantAir)
    {
        b.Prev = b.Pos;
        switch (b.M)
        {
            case Mode.Wheel:
            {
                // far from you (or a boat gone): off to the water near you
                bool lost = b.Boat != null && (!InRiver(b.Boat) || new Vector2(b.Cx - eye.X, b.Cz - eye.Z).Length() > 200);
                if (b.Id < 3)
                {
                    float k = Math.Min(1, dt * 0.05f);
                    b.Cx += (eye.X + (b.Seed - 0.5f) * 40 - b.Cx) * k;
                    b.Cz += (eye.Z + ((b.Seed * 3.7f) % 1 - 0.5f) * 40 - b.Cz) * k;
                }
                else if (b.Boat != null && !lost) Stern(b, 0);
                b.WheelFor -= dt;
                if (!awake || (b.WheelFor < 0 && air > wantAir - 3))
                {
                    // come down: at dusk to the water or a roof near where it flies
                    var near = awake ? eye : b.Pos;
                    if ((FreeSpot(near, awake ? 120 : 160, b) ?? (awake ? null : FreeSpot(near, 3000, b))) is { } s)
                    {
                        b.P0 = b.Pos; b.V0 = b.Vel; b.M = Mode.Fly; b.K = 0; b.Air = 10;
                        PlanLand(b, s);
                        goto case Mode.Fly;
                    }
                    b.WheelFor = Rand(10, 30);
                }
                if (lost || (b.Id >= 3 && new Vector2(b.Cx - eye.X, b.Cz - eye.Z).Length() > 140))
                {
                    b.P0 = b.Pos; b.V0 = b.Vel; b.M = Mode.Fly; b.K = 0; b.Air = 10;
                    Anchor(b, eye, false);
                    PlanWheel(b);
                    goto case Mode.Fly;
                }
                b.Th += b.W * dt;
                WheelPoint(b, clock, out var p);
                if (b.OffK > 0) { b.OffK = Math.Max(0, b.OffK - dt / 1.6f); p += b.Off * (b.OffK * b.OffK * (3 - 2 * b.OffK)); }
                b.Pos = p;
                Wings(b, dt, false);
                break;
            }
            case Mode.Fly:
            {
                b.Air += dt;
                if (b.Delay > 0) { b.Delay -= dt; break; }
                if (b.Boat != null && b.ToWheel && InRiver(b.Boat)) Stern(b, 0);
                if (b.Cruising)
                {
                    CruiseStep(b, dt);
                    if (b.Cruising) { b.Flare = 0; Wings(b, dt, true); break; }
                }
                // the last curve; a place on a boat or the water moves: its end with it
                if (!b.ToWheel && b.Goal >= 0) b.P1 = SpotAt(spots[b.Goal]);
                float over = Math.Max(0, (b.K + dt / b.T - 1) * b.T);
                b.K = Math.Min(1, b.K + dt / b.T);
                float k = b.K;
                float hump = MathF.Sin(MathF.PI * k);
                b.Pos = Hermite(b.P0, b.V0, b.P1, b.V1, b.T, k) + Vector3.Up * (b.Lift * hump * hump);
                b.Flare = b.ToWheel ? 0 : Math.Clamp((k - (1 - 0.9f / b.T)) / (0.9f / b.T), 0, 1);
                Wings(b, dt, true);
                if (k >= 1)
                {
                    if (b.ToWheel)
                    {
                        b.M = Mode.Wheel;
                        WheelPoint(b, clock, out var w);
                        b.Off = b.Pos - w;
                        b.OffK = 1;
                        // (the rest of the frame already on the circle)
                        b.Th += b.W * over;
                        WheelPoint(b, clock, out var w2);
                        b.Pos = w2 + b.Off;
                        b.WheelFor = Rand(30, 150);
                    }
                    else if (b.Goal >= 0)
                    {
                        air--;
                        SitOn(b, spots[b.Goal], false);
                        b.Pos = b.Ground;
                        b.Flare = 0;
                    }
                    else { b.M = Mode.Wheel; Anchor(b, eye, false); }
                }
                break;
            }
            default:
                Settled(b, dt, threat, awake, ref air, wantAir);
                break;
        }
        // heading, bank and pitch from the way it moves
        if (b.M is Mode.Wheel or Mode.Fly && dt > 0)
        {
            var v = (b.Pos - b.Prev) / dt;
            b.Vel = b.Vel.Lerp(v, 1 - MathF.Exp(-dt * 10));
            float hs = new Vector2(b.Vel.X, b.Vel.Z).Length();
            if (hs > 0.3f && b.Flare < 0.7f)
            {
                float yaw = MathF.Atan2(b.Vel.X, b.Vel.Z);
                float dy = Mathf.Wrap(yaw - b.Yaw, -MathF.PI, MathF.PI);
                // (the turn of the way it flies, not of the bird's smoothed bearing: a coordinated bank, tan = v w / g)
                float rate = Mathf.Wrap(yaw - b.Heading, -MathF.PI, MathF.PI) / dt;
                b.Heading = yaw;
                if (MathF.Abs(rate) < 4) b.TurnRate = Mathf.Lerp(b.TurnRate, rate, 1 - MathF.Exp(-dt * 3));
                b.Yaw += dy * Math.Min(1, dt * 12);
                float roll = Math.Clamp(-MathF.Atan(b.TurnRate * hs / 9.8f), -0.7f, 0.7f);
                b.Roll = Mathf.Lerp(b.Roll, roll, 1 - MathF.Exp(-dt * 4));
            }
            else b.Roll = Mathf.Lerp(b.Roll, 0, 1 - MathF.Exp(-dt * 4));
            float pitch = -MathF.Atan2(b.Vel.Y, hs + 0.5f) * 0.6f - b.Flare * 0.55f;
            b.Pitch = Mathf.Lerp(b.Pitch, pitch, 1 - MathF.Exp(-dt * 5));
            b.HP = Mathf.Lerp(b.HP, 0.7f - b.Flare * 0.5f, 1 - MathF.Exp(-dt * 4));
            b.HY = Mathf.Lerp(b.HY, 0.35f * MathF.Sin(clock * 0.4f + b.Seed * 30) * (1 - b.Flare), 1 - MathF.Exp(-dt * 2));
            b.HR = Mathf.Lerp(b.HR, -b.Roll * 0.6f, 1 - MathF.Exp(-dt * 4));
            b.Tuck = Mathf.Lerp(b.Tuck, b.Flare > 0.05f ? 0 : b.Air < 0.6f && b.M == Mode.Fly ? 0.3f : 1, 1 - MathF.Exp(-dt * (b.Flare > 0 ? 6 : 3)));
        }
    }

    private static bool InRiver(River.Mover m)
    {
        if (River.I == null || m.Parts.Count == 0) return false;
        var list = River.I.Movers;
        for (int i = 0; i < list.Count; i++) if (list[i] == m) return true;
        return false;
    }

    /// <summary>The wings: glide with now and then a few slow beats, beat hard going up and taking off, flare to land.</summary>
    private void Wings(Bird b, float dt, bool flying)
    {
        float bout = Mathf.SmoothStep(0.35f, 0.75f, MathF.Sin(clock * 0.55f + b.Seed * 30));
        float climb = Math.Clamp(b.Vel.Y / 1.5f, 0, 1);
        float amp = 0.06f + 0.72f * bout, freq = 2.6f;
        if (flying)
        {
            float slow = 1 - Math.Clamp(b.Vel.Length() / 6, 0, 1);
            amp = Math.Max(amp, Math.Max(climb * 0.95f, slow * 0.8f));
            if (b.Air < 1.4f && b.M == Mode.Fly) { amp = b.Pigeon ? 1.1f : 1.05f; freq = b.Pigeon ? 6.5f : 3.4f; }
            if (b.Flare > 0) { amp = Mathf.Lerp(amp, 0.65f, b.Flare); freq = Mathf.Lerp(freq, 4.4f, b.Flare); }
            if (b.Pigeon) { amp = Math.Max(amp, 0.8f); freq = Math.Max(freq, 6); }
        }
        b.Amp = Mathf.Lerp(b.Amp, amp, 1 - MathF.Exp(-dt * 4));
        b.Phase += freq * MathF.Tau * dt;
        if (b.Phase > 1000) b.Phase -= MathF.Tau * 100;
        b.Fold = Math.Max(0, b.Fold - dt * 4);
    }

    /// <summary>A gull on its place: looks about, preens, stretches, calls, walks and pecks where it can; goes up when you come at it.</summary>
    private void Settled(Bird b, float dt, Vector3 threat, bool awake, ref int air, int wantAir)
    {
        if (b.Spot < 0) { b.M = Mode.Wheel; b.Fold = 0; Anchor(b, Eye, false); return; }
        var s = spots[b.Spot];
        var at = SpotAt(s);
        // put up: Jef within a few steps (more when he runs); the water birds let him nearer; a boat bearing down
        float d = new Vector2(b.Pos.X - threat.X, b.Pos.Z - threat.Z).Length();
        float r = threatSpeed > 2.4f ? 7.5f : 4.5f;
        if (b.M == Mode.Float) r *= 0.7f;
        bool flush = d < r && Math.Abs(b.Pos.Y - threat.Y) < 5;
        if (!flush && b.M == Mode.Float && River.I != null)
        {
            var list = River.I.Movers;
            for (int i = 0; i < list.Count; i++)
            {
                var m = list[i];
                if (m.Parts.Count == 0) continue;
                var o = m.Parts[0].Boat.Outer.Position;
                if (new Vector2(o.X - b.Pos.X, o.Z - b.Pos.Z).Length() < (float)m.Len * 0.5f + 6) { flush = true; threat = o; break; }
            }
        }
        if (flush)
        {
            Spot? to = awake && air < wantAir + 4 ? null : FreeSpot(b.Pos, 70, b, threat);
            if (!awake && to == null) to = FreeSpot(b.Pos, 200, b, threat);
            TakeOff(b, threat, to);
            air++;
            if (Main.I.Arg("gulltest") is { Length: 0 } && clock - lastFlushSound > 3)
            {
                lastFlushSound = (int)clock;
                Audio.LifeAnimalSounds.Wings(b.Pos.X, b.Pos.Y, b.Pos.Z);
            }
            if (awake && soundGap < 0) { soundGap = 5; Audio.Soundscape.I?.GullsAt(b.Pos, 1.6); }
            return;
        }
        // now and then up on its own by day (to wheel, or over to another place)
        b.Next -= dt;
        if (awake && b.Next < 0)
        {
            b.Next = Rand(30, 150);
            if (air < wantAir) { TakeOff(b, null, null); air++; return; }
            if (R01() < 0.3f && FreeSpot(b.Pos, 60, b) is { } other) { TakeOff(b, null, other); air++; return; }
        }
        // wings folding after a landing; the feet down
        b.Fold = Math.Min(1, b.Fold + dt * 2.2f);
        b.Amp = Mathf.Lerp(b.Amp, 0, 1 - MathF.Exp(-dt * 5));
        b.Phase += 3.2f * MathF.Tau * dt;
        b.Tuck = Mathf.Lerp(b.Tuck, 0, 1 - MathF.Exp(-dt * 8));
        b.Roll = Mathf.Lerp(b.Roll, 0, 1 - MathF.Exp(-dt * 6));
        bool ground = s.Kind is Place.Market or Place.Quay;
        // what it does next
        b.ActT -= dt;
        if (b.ActT <= 0 && b.Act is not (5 or 6))
        {
            float x = R01();
            if (ground && x < 0.32f)
            {
                b.Act = 2;
                float a = R01() * MathF.Tau, dd = Rand(0.4f, 1.8f);
                b.WalkTo = new Vector3(at.X + MathF.Cos(a) * dd, at.Y, at.Z + MathF.Sin(a) * dd);
                if (Water.In(b.WalkTo.X, b.WalkTo.Z) || !Air.OpenAt(b.WalkTo.X, b.WalkTo.Z, 0.3f)) b.WalkTo = at;
                b.ActT = 6;
            }
            else if ((ground || b.M == Mode.Float) && x < 0.55f) { b.Act = 3; b.ActT = Rand(1.2f, 3); }
            else if (x < 0.68f) { b.Act = 1; b.ActT = Rand(2.5f, 6); b.HY = 0; }
            else if (x < 0.74f && awake && b.M == Mode.Sit) { b.Act = 7; b.ActT = 1.6f; }
            else if (x < 0.8f && awake) { b.Act = 4; b.ActT = 2.2f; b.Call = 2.2f; }
            else if (x < 0.86f && !ground && b.M == Mode.Sit) { b.Act = 8; b.ActT = 1.2f; b.WalkTo.X = b.Yaw + Rand(-1.6f, 1.6f); }
            else { b.Act = 0; b.ActT = Rand(1.5f, 5); }
        }
        float hy = 0.9f * MathF.Sin(clock * 0.7f + b.Seed * 40) * MathF.Sin(clock * 0.23f + b.Seed * 7), hp = -0.05f, hr = 0, pitch = -0.06f, dip = 0;
        float spread = 0;
        b.Walking = false;
        switch (b.Act)
        {
            case 1: // preening: the bill into the back and the wing
                hy = (b.Seed < 0.5f ? 1 : -1) * (2.3f + 0.15f * MathF.Sin(clock * 5 + b.Seed));
                hp = 0.75f + 0.25f * MathF.Sin(clock * 7.3f);
                hr = 0.5f * (b.Seed < 0.5f ? 1 : -1);
                break;
            case 2: // walking
            {
                var to = new Vector3(b.WalkTo.X - b.Pos.X, 0, b.WalkTo.Z - b.Pos.Z);
                float l = to.Length();
                if (l < 0.05f) { b.ActT = 0; break; }
                b.Walking = true;
                float yaw = MathF.Atan2(to.X, to.Z);
                b.Yaw += Mathf.Wrap(yaw - b.Yaw, -MathF.PI, MathF.PI) * Math.Min(1, dt * 6);
                float v = 0.5f;
                b.Pos += to / l * Math.Min(l, v * dt);
                b.Step += dt * v / 0.09f;
                hy *= 0.3f;
                break;
            }
            case 3: // pecking at scraps (or dipping at the water)
                hp = 1.25f + 0.3f * MathF.Max(0, MathF.Sin(clock * 9 + b.Seed * 20));
                pitch = b.M == Mode.Float ? 0.15f : 0.5f;
                dip = b.M == Mode.Float ? 0.0f : 0.03f;
                hy = 0.2f * MathF.Sin(clock * 1.3f + b.Seed);
                break;
            case 4: // the long call: the head thrown down, then up and back
            {
                float k = 1 - b.ActT / 2.2f;
                hp = k < 0.3f ? Mathf.Lerp(0, 1.0f, k / 0.3f) : Mathf.Lerp(1.0f, -0.6f, Math.Min(1, (k - 0.3f) / 0.25f));
                hy = 0;
                break;
            }
            case 5: // lunging at another over a scrap: head low, wings half up
            {
                var to = new Vector3(b.WalkTo.X - b.Pos.X, 0, b.WalkTo.Z - b.Pos.Z);
                float l = to.Length();
                if (l > 0.05f)
                {
                    b.Yaw += Mathf.Wrap(MathF.Atan2(to.X, to.Z) - b.Yaw, -MathF.PI, MathF.PI) * Math.Min(1, dt * 10);
                    b.Pos += to / l * Math.Min(l, 1.3f * dt);
                    b.Walking = true;
                    b.Step += dt * 1.3f / 0.09f;
                }
                hp = 0.55f; hy = 0; pitch = 0.3f; spread = 0.5f;
                if (b.ActT <= 0) { b.Act = 0; b.ActT = Rand(1, 3); }
                break;
            }
            case 6: // hopping back from it
            {
                b.HopT += dt;
                float k = Math.Min(1, b.HopT / 0.5f);
                b.Hop = 0.2f * MathF.Sin(MathF.PI * k);
                var to = new Vector3(b.WalkTo.X - b.Pos.X, 0, b.WalkTo.Z - b.Pos.Z);
                float l = to.Length();
                if (l > 0.02f) b.Pos += to / l * Math.Min(l, 1.6f * dt);
                spread = 0.55f;
                hp = -0.2f;
                if (k >= 1) { b.Hop = 0; b.Act = 0; b.ActT = Rand(1, 3); }
                break;
            }
            case 7: // a stretch: both wings up a moment
            {
                float k = 1 - b.ActT / 1.6f;
                spread = MathF.Sin(MathF.PI * Math.Clamp(k, 0, 1)) * 0.85f;
                hp = 0.2f;
                break;
            }
            case 8: // turning round on its place
                b.Yaw += Mathf.Wrap(b.WalkTo.X - b.Yaw, -MathF.PI, MathF.PI) * Math.Min(1, dt * 3);
                b.Step += dt * 4;
                b.Walking = true;
                hy = 0;
                break;
        }
        if (b.Call > 0) b.Call -= dt;
        b.Spread = Mathf.Lerp(b.Spread, spread, 1 - MathF.Exp(-dt * 8));
        b.HY = Mathf.Lerp(b.HY, hy, 1 - MathF.Exp(-dt * (b.Act == 0 ? 3 : 8)));
        b.HP = Mathf.Lerp(b.HP, hp, 1 - MathF.Exp(-dt * 8));
        b.HR = Mathf.Lerp(b.HR, hr, 1 - MathF.Exp(-dt * 6));
        b.Pitch = Mathf.Lerp(b.Pitch, pitch, 1 - MathF.Exp(-dt * 6));
        b.Dip = Mathf.Lerp(b.Dip, dip, 1 - MathF.Exp(-dt * 6));
        // stand on the place (a boat's rail heaves, the water bobs)
        if (ground)
        {
            b.Ground.Y = at.Y;
            if (b.Act is not (2 or 5 or 6) && new Vector2(b.Pos.X - at.X, b.Pos.Z - at.Z).Length() > 3) { b.Act = 2; b.WalkTo = at; b.ActT = 6; }
            b.Pos.Y = at.Y;
        }
        else if (b.M == Mode.Float)
        {
            // drifting a little round its place, riding the ripples
            float dr = 0.8f;
            var c = new Vector3(at.X + MathF.Cos(clock * 0.05f + b.Seed * 6) * dr, at.Y, at.Z + MathF.Sin(clock * 0.05f + b.Seed * 6) * dr);
            b.Pos = b.Pos.Lerp(c, 1 - MathF.Exp(-dt * 0.5f));
            b.Pos.Y = at.Y - 0.035f + 0.018f * MathF.Sin(clock * 1.7f + b.Seed * 11) + 0.01f * MathF.Sin(clock * 2.9f + b.Seed * 3);
            b.Pitch += 0.05f * MathF.Sin(clock * 1.7f + b.Seed * 11 + 1);
            b.Roll = 0.06f * MathF.Sin(clock * 1.3f + b.Seed * 5);
            b.Yaw += 0.04f * dt * MathF.Sin(clock * 0.1f + b.Seed * 9);
        }
        else
        {
            b.Pos = b.Pos.Lerp(at, 1 - MathF.Exp(-dt * 10));
            if (s.Kind == Place.Rail) b.Roll = 0.08f * MathF.Sin(clock * 1.1f + b.Seed * 4);
        }
        if (b.Hop > 0) b.Pos.Y += b.Hop;
    }

    /// <summary>The Vismarkt: now and then two gulls fall out over a scrap; the one comes on, the other hops back.</summary>
    private float squabbleIn = 4;
    private void Squabble()
    {
        squabbleIn -= (float)GetProcessDeltaTime();
        if (squabbleIn > 0) return;
        squabbleIn = Rand(4, 9);
        for (int i = 0; i < NGull; i++)
        {
            var a = birds[i];
            if (a.M != Mode.Sit || a.Spot < 0 || spots[a.Spot].Kind != Place.Market || a.Act is 5 or 6) continue;
            for (int j = 0; j < NGull; j++)
            {
                var b = birds[j];
                if (j == i || b.M != Mode.Sit || b.Spot < 0 || spots[b.Spot].Kind != Place.Market || b.Act is 5 or 6) continue;
                float d = new Vector2(a.Pos.X - b.Pos.X, a.Pos.Z - b.Pos.Z).Length();
                if (d > 3.5f) continue;
                a.Act = 5; a.ActT = 0.9f; a.WalkTo = b.Pos; a.Call = 1;
                var away = new Vector3(b.Pos.X - a.Pos.X, 0, b.Pos.Z - a.Pos.Z);
                away = away.LengthSquared() > 1e-4f ? away.Normalized() : Vector3.Forward;
                b.Act = 6; b.HopT = 0; b.ActT = 0.6f; b.WalkTo = b.Pos + away * 0.8f; b.Call = 1;
                if (soundGap < 0) { soundGap = 4; Audio.Soundscape.I?.GullsAt(a.Pos + Vector3.Up * 0.3f, 1.8); }
                return;
            }
        }
    }

    // ------------------------------------------------------------------ the pigeons (ambient.ts)

    private void StepPigeons(float dt, Vector3 threat)
    {
        bool out_ = Daylight.I!.Night < 0.5f && Daylight.I.Rain < 0.5f;
        float flushR = threatSpeed > 2.2f ? 6.5f : 4;
        foreach (var f in flocks)
        {
            f.Up = Math.Max(0, f.Up - dt);
            bool near = false;
            foreach (var b in f.Birds)
                if (b.M == Mode.Sit && new Vector2(b.Pos.X - threat.X, b.Pos.Z - threat.Z).Length() < flushR && threat.Y < 4) { near = true; break; }
            if (!near || !out_) continue;
            int up = 0;
            foreach (var b in f.Birds)
            {
                if (b.M != Mode.Sit) continue;
                // land again somewhere on the square away from you
                var land = SquareSpot(f, new Vector2(threat.X, threat.Z)) ?? b.Ground;
                TakeOff(b, threat, null);
                b.P1 = land;
                float dist = (land - b.P0).Length();
                b.T = Math.Clamp(dist / 5 + 1.8f, 2.6f, 5) + Rand(0, 0.6f);
                var dir = new Vector3(land.X - b.P0.X, 0, land.Z - b.P0.Z);
                dir = dir.LengthSquared() > 1e-4f ? dir.Normalized() : Vector3.Forward;
                b.V1 = dir * 1.0f + Vector3.Down * 0.3f;
                b.Lift = Rand(3, 6);
                b.ToWheel = false;
                b.Delay = R01() * 0.5f;
                up++;
            }
            if (up > 0) Audio.LifeAnimalSounds.Wings(f.X, 1, f.Z);
        }
        for (int i = NGull; i < NGull + NPigeon; i++)
        {
            var b = birds[i];
            if (b == null) continue;
            b.Prev = b.Pos;
            b.Shown = out_;
            if (b.M == Mode.Fly)
            {
                b.Air += dt;
                if (b.Delay > 0) { b.Delay -= dt; continue; }
                b.K = Math.Min(1, b.K + dt / b.T);
                float hump = MathF.Sin(MathF.PI * b.K);
                b.Pos = Hermite(b.P0, b.V0, b.P1, b.V1, b.T, b.K) + Vector3.Up * (b.Lift * hump * hump);
                b.Flare = Math.Clamp((b.K - (1 - 0.7f / b.T)) / (0.7f / b.T), 0, 1);
                Wings(b, dt, true);
                var v = (b.Pos - b.Prev) / Math.Max(dt, 1e-4f);
                b.Vel = b.Vel.Lerp(v, 1 - MathF.Exp(-dt * 10));
                float hs = new Vector2(b.Vel.X, b.Vel.Z).Length();
                if (hs > 0.3f && b.Flare < 0.7f) b.Yaw += Mathf.Wrap(MathF.Atan2(b.Vel.X, b.Vel.Z) - b.Yaw, -MathF.PI, MathF.PI) * Math.Min(1, dt * 10);
                b.Pitch = Mathf.Lerp(b.Pitch, -MathF.Atan2(b.Vel.Y, hs + 0.5f) * 0.5f - b.Flare * 0.5f, 1 - MathF.Exp(-dt * 6));
                b.HP = 0.5f;
                b.Tuck = b.Flare > 0.05f ? 0 : 1;
                if (b.K >= 1)
                {
                    b.M = Mode.Sit;
                    b.Ground = b.P1;
                    b.Pos = b.P1;
                    b.Flare = 0;
                    b.Act = 0;
                    b.Next = R01() * 2;
                }
                continue;
            }
            // on the ground: walk, peck, turn (a step of about two seconds each)
            b.Fold = Math.Min(1, b.Fold + dt * 3);
            b.Amp = 0;
            b.Tuck = 0;
            b.Pitch = Mathf.Lerp(b.Pitch, 0, 1 - MathF.Exp(-dt * 6));
            b.Next -= dt;
            if (b.Next <= 0)
            {
                b.Next = Rand(1.5f, 2.5f);
                float roll = R01();
                var f = flocks[b.Flock];
                if (roll < 0.45f)
                {
                    float a = R01() * MathF.Tau, d = R01() * 1.2f;
                    float nx = b.Ground.X + MathF.Cos(a) * d, nz = b.Ground.Z + MathF.Sin(a) * d;
                    if (Air.OpenAt(nx, nz, 0.3f) && new Vector2(nx - f.X, nz - f.Z).Length() < f.R) { b.WalkTo = new Vector3(nx, GroundAtCached(nx, nz), nz); b.Walking = true; b.Act = 2; }
                }
                else if (roll < 0.8f) { b.Walking = false; b.Act = 3; b.ActT = Rand(0.8f, 1.9f); }
                else { b.Walking = false; b.Act = 8; b.WalkTo.X = R01() * MathF.Tau; }
            }
            float hp = 0;
            if (b.Act == 2 && b.Walking)
            {
                var to = new Vector3(b.WalkTo.X - b.Pos.X, 0, b.WalkTo.Z - b.Pos.Z);
                float l = to.Length();
                if (l < 0.04f) { b.Walking = false; b.Act = 0; b.Ground = b.Pos; }
                else
                {
                    b.Yaw += Mathf.Wrap(MathF.Atan2(to.X, to.Z) - b.Yaw, -MathF.PI, MathF.PI) * Math.Min(1, dt * 8);
                    b.Pos += to / l * Math.Min(l, 0.32f * dt);
                    b.Pos.Y = b.WalkTo.Y;
                    b.Step += dt * 0.32f / 0.05f;
                    // the pigeon's nod: the head forward and back with each step
                    hp = 0.25f * MathF.Max(0, MathF.Sin(b.Step * MathF.PI));
                }
            }
            else if (b.Act == 3)
            {
                b.ActT -= dt;
                hp = 1.2f * MathF.Max(0, MathF.Sin(clock * 11 + b.Seed * 20));
                b.Pitch = 0.35f;
                if (b.ActT <= 0) b.Act = 0;
            }
            else if (b.Act == 8)
            {
                b.Yaw += Mathf.Wrap(b.WalkTo.X - b.Yaw, -MathF.PI, MathF.PI) * Math.Min(1, dt * 4);
                b.Step += dt * 3;
            }
            b.HP = Mathf.Lerp(b.HP, hp, 1 - MathF.Exp(-dt * 14));
            b.HY = Mathf.Lerp(b.HY, 0.6f * MathF.Sin(clock * 0.9f + b.Seed * 30), 1 - MathF.Exp(-dt * 2));
            b.Walking = b.Act is 2 or 8;
        }
    }

    // ------------------------------------------------------------------ drawing

    private void Draw(Vector3 eye)
    {
        float far = Math.Min(170, Daylight.I!.FogFar * 1.4f + 30);
        frameNo++;
        drawn[0] = drawn[1] = 0;
        var camFw = -Main.I.Cam.GlobalTransform.Basis.Z;
        for (int i = 0; i < NGull + NPigeon; i++)
        {
            var b = birds[i];
            if (b == null) continue;
            int s = b.Pigeon ? 1 : 0;
            if (b.Pigeon && !b.Shown) continue;
            var to = b.Pos - eye;
            float dist = new Vector2(to.X, to.Z).Length();
            if (dist > far) continue;
            // (well behind the camera: not drawn, not even in the river's mirror)
            if (dist > 4 && to.Dot(camFw) < -0.25f * to.Length()) continue;
            // (the pigeons are small: only near)
            if (b.Pigeon && dist > 80) continue;
            Pose(b, s, drawn[s]++, dist);
        }
        sendTicks -= Stopwatch.GetTimestamp();
        for (int s = 0; s < 2; s++)
            for (int p = 0; p < GullModel.Parts; p++)
            {
                if (drawn[s] > 0) RenderingServer.MultimeshSetBuffer(rid[s, p], buf[s][p]);
                if (shownN[s] != drawn[s]) mm[s, p].VisibleInstanceCount = drawn[s];
            }
        shownN[0] = drawn[0]; shownN[1] = drawn[1];
        sendTicks += Stopwatch.GetTimestamp();
    }

    /// <summary>A joint of the left side as the right side's: mirrored in the bird's middle plane (x = 0).</summary>
    private static Transform3D Mirror(in Transform3D t) => new(
        new Basis(new Vector3(t.Basis.X.X, -t.Basis.X.Y, -t.Basis.X.Z), new Vector3(-t.Basis.Y.X, t.Basis.Y.Y, t.Basis.Y.Z), new Vector3(-t.Basis.Z.X, t.Basis.Z.Y, t.Basis.Z.Z)),
        new Vector3(-t.Origin.X, t.Origin.Y, t.Origin.Z));

    // (the turns about one axis, made directly: the bird's joints are posed every frame)
    private static Basis RotX(float a) { float c = MathF.Cos(a), s = MathF.Sin(a); return new Basis(new Vector3(1, 0, 0), new Vector3(0, c, s), new Vector3(0, -s, c)); }
    private static Basis RotY(float a) { float c = MathF.Cos(a), s = MathF.Sin(a); return new Basis(new Vector3(c, 0, -s), new Vector3(0, 1, 0), new Vector3(s, 0, c)); }
    private static Basis RotZ(float a) { float c = MathF.Cos(a), s = MathF.Sin(a); return new Basis(new Vector3(c, s, 0), new Vector3(-s, c, 0), new Vector3(0, 0, 1)); }

    private void Put(int s, int part, int i, in Transform3D x, Color c)
    {
        var bf = buf[s][part];
        int o = i * 16;
        bf[o] = x.Basis.X.X; bf[o + 1] = x.Basis.Y.X; bf[o + 2] = x.Basis.Z.X; bf[o + 3] = x.Origin.X;
        bf[o + 4] = x.Basis.X.Y; bf[o + 5] = x.Basis.Y.Y; bf[o + 6] = x.Basis.Z.Y; bf[o + 7] = x.Origin.Y;
        bf[o + 8] = x.Basis.X.Z; bf[o + 9] = x.Basis.Y.Z; bf[o + 10] = x.Basis.Z.Z; bf[o + 11] = x.Origin.Z;
        bf[o + 12] = c.R; bf[o + 13] = c.G; bf[o + 14] = c.B; bf[o + 15] = c.A;
    }

    /// <summary>
    /// The bird's eight parts: the body from its place and bearing every frame; the joints (the head on the neck, the
    /// wings beating or folded, the legs) worked out every frame near you, every 2nd frame past 40 m and every 4th past
    /// 100 m, kept in the bird's own frame between.
    /// </summary>
    private void Pose(Bird b, int s, int i, float dist)
    {
        var rig = rigs[s];
        float stand = b.M == Mode.Sit ? rig.Stand - b.Dip : 0;
        float walkBob = b.Walking ? 0.008f * MathF.Abs(MathF.Sin(b.Step * MathF.PI)) : 0;
        float sway = b.Walking ? 0.07f * MathF.Sin(b.Step * MathF.PI) : 0;
        var basis = Basis.FromEuler(new Vector3(b.Pitch, b.Yaw, b.Roll + sway), EulerOrder.Yxz);
        var origin = b.Pos + Vector3.Up * (stand + walkBob);
        // (landing: the body comes down onto its feet over the flare)
        if (b.M == Mode.Fly && b.Flare > 0) origin += Vector3.Up * (rig.Stand * b.Flare * (b.Goal >= 0 && spots[b.Goal].Kind == Place.Water ? 0 : 1));
        var B = new Transform3D(basis, origin);
        Put(s, GullModel.Body, i, B, b.Tint);
        // (standing and floating birds move their joints slowly: 30 times a second is enough near you)
        int every = b.M is Mode.Sit or Mode.Float ? (dist < 40 ? 2 : 4) : dist < 40 ? 1 : dist < 100 ? 2 : 4;
        if (!b.Posed || (frameNo + b.Id) % every == 0) { jointTicks -= Stopwatch.GetTimestamp(); Joints(b, rig); jointTicks += Stopwatch.GetTimestamp(); }
        for (int k = 1; k < GullModel.Parts; k++) PutMul(s, k, i, B, b.Local[k], b.Tint);
    }

    /// <summary>Put(B * L) written out: the body's frame times a joint's, straight into the part's buffer.</summary>
    private void PutMul(int s, int part, int i, in Transform3D B, in Transform3D L, Color c)
    {
        var bf = buf[s][part];
        int o = i * 16;
        float b00 = B.Basis.X.X, b01 = B.Basis.Y.X, b02 = B.Basis.Z.X;
        float b10 = B.Basis.X.Y, b11 = B.Basis.Y.Y, b12 = B.Basis.Z.Y;
        float b20 = B.Basis.X.Z, b21 = B.Basis.Y.Z, b22 = B.Basis.Z.Z;
        float l00 = L.Basis.X.X, l01 = L.Basis.Y.X, l02 = L.Basis.Z.X;
        float l10 = L.Basis.X.Y, l11 = L.Basis.Y.Y, l12 = L.Basis.Z.Y;
        float l20 = L.Basis.X.Z, l21 = L.Basis.Y.Z, l22 = L.Basis.Z.Z;
        float ox = L.Origin.X, oy = L.Origin.Y, oz = L.Origin.Z;
        bf[o] = b00 * l00 + b01 * l10 + b02 * l20; bf[o + 1] = b00 * l01 + b01 * l11 + b02 * l21; bf[o + 2] = b00 * l02 + b01 * l12 + b02 * l22;
        bf[o + 3] = b00 * ox + b01 * oy + b02 * oz + B.Origin.X;
        bf[o + 4] = b10 * l00 + b11 * l10 + b12 * l20; bf[o + 5] = b10 * l01 + b11 * l11 + b12 * l21; bf[o + 6] = b10 * l02 + b11 * l12 + b12 * l22;
        bf[o + 7] = b10 * ox + b11 * oy + b12 * oz + B.Origin.Y;
        bf[o + 8] = b20 * l00 + b21 * l10 + b22 * l20; bf[o + 9] = b20 * l01 + b21 * l11 + b22 * l21; bf[o + 10] = b20 * l02 + b21 * l12 + b22 * l22;
        bf[o + 11] = b20 * ox + b21 * oy + b22 * oz + B.Origin.Z;
        bf[o + 12] = c.R; bf[o + 13] = c.G; bf[o + 14] = c.B; bf[o + 15] = c.A;
    }

    private void Joints(Bird b, GullModel.Rig rig)
    {
        b.Posed = true;
        var L = b.Local;
        L[GullModel.Head] = new Transform3D(Basis.FromEuler(new Vector3(b.HP, b.HY, b.HR), EulerOrder.Yxz), rig.Neck);
        // the wings: from the beat (phase, amplitude), the flare and the fold (and the half-open wings of a squabble or a stretch)
        float ph = b.Phase, A = b.Amp, F = b.Flare;
        float f = Math.Clamp(b.Fold - b.Spread, 0, 1);
        float sn = MathF.Sin(ph);
        float a = 0.09f + A * 0.66f * sn + F * (0.5f + 0.35f * sn) + b.Spread * 0.5f;
        float bb = 0.04f + A * 0.12f * MathF.Cos(ph) - F * 0.35f;
        float cc = -0.03f - F * 0.35f;
        float a2 = -0.14f + A * 0.5f * MathF.Sin(ph - 0.7f) + F * 0.2f;
        float b2 = 0.22f + A * 0.35f * MathF.Max(0, -MathF.Sin(ph - 1.0f)) - F * 0.1f;
        float c2 = -0.02f;
        // folded: the arm back along the flank, the hand over the tail with the tips crossed
        a = Mathf.Lerp(a, 0.0f, f); bb = Mathf.Lerp(bb, 1.57f, f); cc = Mathf.Lerp(cc, 1.22f, f);
        a2 = Mathf.Lerp(a2, -0.2f, f); b2 = Mathf.Lerp(b2, 0.12f, f); c2 = Mathf.Lerp(c2, 0.0f, f);
        float sx = Mathf.Lerp(1, 0.5f, f), sz = Mathf.Lerp(1, 0.62f, f), hx = Mathf.Lerp(1, 0.7f, f);
        var armScale = Basis.FromScale(new Vector3(sx, 1, sz));
        var handScale = Basis.FromScale(new Vector3(hx, 1, sz));
        var sh0 = rig.Shoulder.Lerp(rig.ShoulderFolded, f);
        {
            // the left wing (+x); the right is its mirror image (the meshes are mirrored too)
            var armRot = RotZ(a) * RotY(bb) * RotX(cc);
            var arm = new Transform3D(armRot * armScale, sh0);
            var wrist = sh0 + armRot * new Vector3(rig.Arm * sx, 0, 0);
            var hand = new Transform3D(armRot * (RotZ(a2) * RotY(b2) * RotX(c2)) * handScale, wrist);
            L[GullModel.ArmL] = arm;
            L[GullModel.HandL] = hand;
            L[GullModel.ArmR] = Mirror(arm);
            L[GullModel.HandR] = Mirror(hand);
        }
        // the legs: tucked back in flight, forward to land, a step at a time walking, paddling on the water
        float tuck = b.Tuck * 1.45f - F * 0.35f;
        float swing = b.Walking ? 0.42f * MathF.Sin(b.Step * MathF.PI) : 0;
        if (b.M == Mode.Float) { tuck = 0.75f; swing = 0.25f * MathF.Sin(clock * 2.2f + b.Seed * 7); }
        var hip = rig.Hip;
        L[GullModel.LegL] = new Transform3D(RotX(tuck + swing), hip);
        L[GullModel.LegR] = new Transform3D(RotX(tuck - swing), new Vector3(-hip.X, hip.Y, hip.Z));
    }

    // ------------------------------------------------------------------ for the other parts

    /// <summary>
    /// A gull to call now (the soundscape's gull calls come from a bird): an awake gull within reach of the listener,
    /// the nearest in the air or on the market most likely; it throws its head as it calls. Null: none near (at
    /// night, or inland) and so no call.
    /// </summary>
    public Vector3? Caller(Vector3 listener, float reach = 90)
    {
        if (!built || !Awake) return null;
        Bird? best = null;
        float bs = 0;
        for (int i = 0; i < NGull; i++)
        {
            var b = birds[i];
            float d = b.Pos.DistanceTo(listener);
            if (d > reach) continue;
            float sc = (0.3f + R01()) / (1 + d / 30) * (b.M is Mode.Wheel or Mode.Fly ? 1.4f : b.Spot >= 0 && spots[b.Spot].Kind == Place.Market ? 1.6f : 1);
            if (sc > bs) { bs = sc; best = b; }
        }
        if (best == null) return null;
        if (best.M is Mode.Sit or Mode.Float && best.Act is 0 or 1 or 8) { best.Act = 4; best.ActT = 2.2f; best.Call = 2.2f; }
        return best.Pos + Vector3.Up * 0.3f;
    }

    /// <summary>For a test picture (Dev/Snap): from where and at what a view named gull... looks at the nearest bird of its kind.</summary>
    public (Vector3 from, Vector3 at)? ViewTarget(string view, Vector3 cam)
    {
        if (!built) return null;
        // (gullfly2_day: the kind is the name up to a digit or an underscore; gullsheet turned by its digit, in quarters)
        int cut = 0;
        while (cut < view.Length && char.IsLetter(view[cut])) cut++;
        string name = view[..cut];
        Sheet = name == "gullsheet";
        if (Sheet)
        {
            SheetTurn = cut < view.Length && char.IsDigit(view[cut]) ? (view[cut] - '0') * MathF.PI / 2 : 0;
            return null;
        }
        Bird? best = null;
        float bd = float.MaxValue;
        bool sky = name == "gullsky", under = name == "gullunder", fly = name.StartsWith("gullfly") || sky || under, pig = name.StartsWith("pigeon");
        for (int i = 0; i < NGull + NPigeon; i++)
        {
            var b = birds[i];
            if (b == null || b.Pigeon != pig) continue;
            bool ok = fly ? b.M is Mode.Wheel or Mode.Fly && b.Id >= 3
                : name.StartsWith("gullwater") ? b.M == Mode.Float
                : name.StartsWith("gullmarket") ? b.M == Mode.Sit && b.Spot >= 0 && spots[b.Spot].Kind is Place.Market
                : name.StartsWith("gullridge") ? b.M == Mode.Sit && b.Spot >= 0 && spots[b.Spot].Kind is Place.Ridge
                : name.StartsWith("gullrail") ? b.M == Mode.Sit && b.Spot >= 0 && spots[b.Spot].Kind is Place.Rail
                : name.StartsWith("gullperch") ? b.M == Mode.Sit && b.Spot >= 0 && spots[b.Spot].Kind is Place.Bollard
                : pig ? b.M == Mode.Sit && b.Shown : false;
            if (!ok) continue;
            if (watched >= 0 && watchedName == name && b.Id != watched) continue;
            float d = b.Pos.DistanceSquaredTo(cam);
            if (d < bd) { bd = d; best = b; }
        }
        if (best == null) { if (watchedName == name) watched = -1; return null; }
        watched = best.Id;
        watchedName = name;
        var p = best.Pos + Vector3.Up * (best.Pigeon ? 0.1f : 0.2f);
        // (from where the view stands, looking up at it)
        if (sky) return (cam, p);
        if (under) return (p + new Vector3(MathF.Cos(best.Yaw), 0, -MathF.Sin(best.Yaw)) * 1.5f + Vector3.Down * 3.2f, p);
        if (fly)
        {
            // beside and a little behind it, keeping up
            var fw = new Vector3(MathF.Sin(best.Yaw), 0, MathF.Cos(best.Yaw));
            var side = new Vector3(fw.Z, 0, -fw.X);
            return (p - fw * 2.2f + side * 2.4f + Vector3.Up * 0.5f, p);
        }
        var face = new Vector3(MathF.Sin(best.Yaw + 0.9f), 0, MathF.Cos(best.Yaw + 0.9f));
        float dist = best.Pigeon ? 0.9f : name.StartsWith("gullmarket") ? 2.6f : name.StartsWith("gullridge") ? 2.6f : 1.05f;
        return (p + face * dist + Vector3.Up * (best.Pigeon ? 0.25f : name.StartsWith("gullmarket") ? 1.3f : 0.15f), p);
    }

    private int watched = -1;
    private string watchedName = "";

    /// <summary>Dev (a Snap view named gullsheet...): six birds in fixed poses in a row 1.8 m in front of the camera, to judge the model.</summary>
    public bool Sheet;
    public float SheetTurn;

    private void PoseSheet()
    {
        var cam = Main.I.Cam.GlobalTransform;
        var fw = -cam.Basis.Z; fw.Y = 0; fw = fw.Normalized();
        var right = new Vector3(-fw.Z, 0, fw.X);
        var o = cam.Origin + fw * 1.9f + Vector3.Down * 0.35f;
        float camYaw = MathF.Atan2(fw.X, fw.Z);
        for (int k = 0; k < 6; k++)
        {
            var b = birds[k == 5 ? NGull : k];
            b.Pos = o + right * ((k - 2.5f) * 0.62f) + Vector3.Up * (k is 2 or 3 or 4 ? 0.45f : 0);
            b.Prev = b.Pos;
            b.Pitch = 0; b.Roll = 0; b.Dip = 0; b.Spread = 0; b.Flare = 0; b.Walking = false;
            b.HY = 0; b.HP = 0; b.HR = 0;
            b.Yaw = camYaw + MathF.PI + SheetTurn + (k == 0 || k == 5 ? MathF.PI / 2 : k == 1 ? 0.6f : 2.4f);
            if (k is 2 or 3 or 4)
            {
                b.M = Mode.Wheel; b.Fold = 0; b.Tuck = 1; b.Amp = k == 3 ? 0 : 0.85f; b.Phase = k == 2 ? MathF.PI / 2 : -MathF.PI / 2; b.HP = 0.7f;
                b.Pos += Vector3.Down * 0.177f;
            }
            else { b.M = Mode.Sit; b.Fold = 1; b.Tuck = 0; b.Amp = 0; b.Pos += Vector3.Down * (k == 5 ? rigs[1].Stand : rigs[0].Stand); }
            b.Shown = true;
        }
    }

    public override void _ExitTree() { if (I == this) I = null; }
}
