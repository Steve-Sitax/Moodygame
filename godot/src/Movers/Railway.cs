using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// The quay railway at work (the browser's world/railway.ts and railgate.ts, the same line, wagons, speeds and
/// numbers). A short goods train drawn by two heavy horses runs the line of shared/city.json decor "tracks": out of
/// the Werf store through its gate, east along the river quays under the portal cranes, over the vliet and canal
/// bridges and the lock bridge, round the Petit Bassin, and back west into the store. It stops at some of the
/// cranes; the crane swings its jib between a moored ship (or a pile on the quay) and a wagon, a sling of sacks, a
/// cask, a bale or a crate on the hook, so the wagons fill and empty as you watch. Every axle follows the curve,
/// wheels turn, the coupling chains stretch on the bends. The train stops for Jef on the line and before an opening
/// bridge that is not shut; a bridge does not open while the train is on it. Jef cannot walk through a wagon or a
/// horse (bodies that move with them).
///
/// The cranes travel along their runways to another hold, turn and lift; no step is taken that would bring two
/// cranes nearer than the margin (shared/cranes.ts: CraneGeo).
///
/// Not ported yet (the browser has them): the shunter at the horses' heads and the gate's keeper (people), the
/// horses' harness chains, the ships' masts in the cranes' way, a crane making way for another by asking, the
/// dockers' piles the cranes feed, the walkable crane cabin, stopping for townspeople and things left on the rails.
/// </summary>
[GamePart(45)]
public partial class Railway : Node
{
    public static Railway I { get; private set; } = null!;

    // ---------------------------------------------------------------- numbers (railway.ts)
    private const float RHook = 11.51f, HookRest = 4.2f, Travel = 5.2f, Slew = 0.32f, Hoist = 1.3f, Sling = 0.85f;
    private const float Cruise = 1.35f, Creep = 0.6f, Accel = 0.25f, Brake = 0.45f;
    private const float WheelR = 0.5f, RailTop = 0.035f, Floor = 1.12f, LBody = 5.4f, LBuf = 6.3f, Wb = 3.0f, HorseGap = 3.0f, Traces = 3.1f;
    private const float TraceLink = 0.36f;
    private const int TracePieces = 7;
    private static readonly Vector3 Spread = new(0.42f, 0.98f, -1.4f);
    private static readonly (float X, float Z)[] CraneFeet = { (2.2f, 2.6f), (-2.2f, 2.6f), (2.2f, -2.6f), (-2.2f, -2.6f) };
    private const float CraneWheelR = 0.3f, CraneV = 0.42f, CraneGap = 17, GiveUp = 12, TravelHook = 6.8f, HookBlock = 0.66f;
    private static readonly string[] Goods = { "sacks", "casks", "bales", "crates" };
    private static readonly Dictionary<string, float> UnitH = new() { ["sacks"] = 0.56f, ["casks"] = 0.74f, ["bales"] = 0.78f, ["crates"] = 0.86f };
    private static readonly float[] Rows = { 1.55f, 0, -1.55f };
    private static readonly float[] Across = { -0.56f, 0.56f };

    // ---------------------------------------------------------------- the line
    private sealed class Line
    {
        public const float Step = 0.25f;
        public readonly float[] X, Z;
        public readonly float Length;

        public Line(List<(float X, float Z)> pts)
        {
            var xs = new List<float> { pts[0].X };
            var zs = new List<float> { pts[0].Z };
            double carry = 0;
            for (int i = 0; i < pts.Count - 1; i++)
            {
                double ax = pts[i].X, az = pts[i].Z, bx = pts[i + 1].X, bz = pts[i + 1].Z;
                double L = Math.Sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
                double d = Step - carry;
                while (d <= L)
                {
                    xs.Add((float)(ax + (bx - ax) * d / L));
                    zs.Add((float)(az + (bz - az) * d / L));
                    d += Step;
                }
                carry = L - (d - Step);
            }
            X = xs.ToArray();
            Z = zs.ToArray();
            Length = (xs.Count - 1) * Step;
        }

        public Vector2 At(float s)
        {
            float u = Math.Clamp(s, 0, Length) / Step;
            int i = Math.Min(X.Length - 2, (int)MathF.Floor(u));
            float f = u - i;
            return new Vector2(X[i] + (X[i + 1] - X[i]) * f, Z[i] + (Z[i + 1] - Z[i]) * f);
        }

        public float Yaw(float s)
        {
            var a = At(s - 0.6f);
            var b = At(s + 0.6f);
            return MathF.Atan2(b.X - a.X, b.Y - a.Y);
        }

        /// <summary>Arc positions where the line passes within r of (x, z): one per pass.</summary>
        public List<float> Passes(float x, float z, float r)
        {
            var o = new List<float>();
            int best = -1;
            float bd = float.MaxValue;
            for (int i = 0; i < X.Length; i++)
            {
                float d = MathF.Sqrt((X[i] - x) * (X[i] - x) + (Z[i] - z) * (Z[i] - z));
                if (d < r)
                {
                    if (d < bd)
                    {
                        bd = d;
                        best = i;
                    }
                }
                else if (best >= 0)
                {
                    o.Add(best * Step);
                    best = -1;
                    bd = float.MaxValue;
                }
            }
            if (best >= 0) o.Add(best * Step);
            return o;
        }
    }

    /// <summary>world/tracks.ts smoothLine: the corners of a track rounded with arcs of its radius.</summary>
    private static List<(float X, float Z)> SmoothLine(JsonElement line)
    {
        var pts = line.GetProperty("pts").EnumerateArray().Select(p => (X: p[0].GetDouble(), Z: p[1].GetDouble())).ToList();
        var rEl = line.GetProperty("r");
        var o = new List<(float, float)> { ((float)pts[0].X, (float)pts[0].Z) };
        for (int i = 1; i < pts.Count - 1; i++)
        {
            double r = rEl.ValueKind == JsonValueKind.Array ? (i < rEl.GetArrayLength() ? rEl[i].GetDouble() : 0) : rEl.GetDouble();
            var (ax, az) = pts[i - 1];
            var (bx, bz) = pts[i];
            var (cx, cz) = pts[i + 1];
            double l1 = Math.Sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)), l2 = Math.Sqrt((cx - bx) * (cx - bx) + (cz - bz) * (cz - bz));
            double d1x = (bx - ax) / l1, d1z = (bz - az) / l1, d2x = (cx - bx) / l2, d2z = (cz - bz) / l2;
            double turn = Math.Acos(Math.Max(-1, Math.Min(1, d1x * d2x + d1z * d2z)));
            if (r <= 0 || turn < 1e-3)
            {
                o.Add(((float)bx, (float)bz));
                continue;
            }
            double t = Math.Min(r * Math.Tan(turn / 2), Math.Min(l1 / 2, l2 / 2));
            double rr = t / Math.Tan(turn / 2);
            double side = Math.Sign(d1x * d2z - d1z * d2x);
            double sx = bx - d1x * t, sz = bz - d1z * t;
            double nx = -d1z * side, nz = d1x * side;
            double ox = sx + nx * rr, oz = sz + nz * rr;
            double a0 = Math.Atan2(sz - oz, sx - ox);
            int n = Math.Max(2, (int)Math.Ceiling(rr * turn));
            for (int k = 0; k <= n; k++)
            {
                double a = a0 + side * turn * (k / (double)n);
                o.Add(((float)(ox + Math.Cos(a) * rr), (float)(oz + Math.Sin(a) * rr)));
            }
        }
        o.Add(((float)pts[^1].X, (float)pts[^1].Z));
        return o;
    }

    // ---------------------------------------------------------------- the gate of the Werf store (railgate.ts)
    private sealed class Gate
    {
        public const float Face = -311, OpenS = 1.9f, OpenN = 6.1f, LeafW = (OpenN - OpenS) / 2, Swing = MathF.PI * 0.53f, Reach = LeafW + 0.1f;
        public float Amount;
        public bool WantOpen;
        private readonly Copies? leaves;
        private readonly AnimatableBody3D[] bodies = new AnimatableBody3D[2];
        private float shown = -1;

        public Gate(Node parent)
        {
            var g = Mv.Top("railway_gate");
            if (g != null) leaves = Copies.Find(g, "railwaygateleaves");
            // the leaves as they swing: a thin wall each, turning on its hinge
            for (int i = 0; i < 2; i++)
            {
                var b = new AnimatableBody3D { Name = $"gate_leaf_{i}", SyncToPhysics = false, CollisionLayer = Solid.Layer, CollisionMask = 0 };
                parent.AddChild(b);
                b.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(0.14f, 4.4f, LeafW) }, Position = new Vector3(0, 2.2f, LeafW / 2) });
                bodies[i] = b;
            }
            Place(0);
        }

        private void Place(float amount)
        {
            if (Math.Abs(amount - shown) < 1e-5f) return;
            shown = amount;
            float a = Swing * amount;
            var t0 = new Transform3D(new Basis(Vector3.Up, a), new Vector3(Face + 0.08f, 0.05f, OpenS));
            var t1 = new Transform3D(new Basis(Vector3.Up, MathF.PI - a), new Vector3(Face + 0.08f, 0.05f, OpenN));
            leaves?.Set(0, t0);
            leaves?.Set(1, t1);
            leaves?.Commit();
            bodies[0].Transform = t0;
            bodies[1].Transform = t1;
        }

        public void Update(float dt)
        {
            float target = WantOpen ? 1 : 0;
            var jef = Jef.I;
            bool inSweep = jef != null && jef.X > Face - 0.3f && jef.X < Face + Reach + 0.4f && jef.Z > OpenS - 0.4f && jef.Z < OpenN + 0.4f;
            if (target != Amount && !inSweep)
            {
                float ease = 0.3f + 0.7f * MathF.Sin(MathF.PI * Math.Clamp(Amount, 0.05f, 0.95f));
                float step = 0.22f * ease * Math.Min(dt, 0.1f);
                Amount = target > Amount ? Math.Min(1, Amount + step) : Math.Max(0, Amount - step);
                Place(Amount);
            }
        }
    }

    // ---------------------------------------------------------------- the train
    private sealed class Wagon
    {
        public string Kind = "";
        public string? Goods;
        public bool[] Slots = new bool[6];
        public float Front, X, Z, Yaw;
        public AnimatableBody3D Body = null!;
    }

    private sealed class Stop
    {
        public Crane Crane = null!;
        public float Head;
        public int Wagon, Row;
        public bool In, Queued;
    }

    // ---------------------------------------------------------------- the cranes
    private enum OpT { Hoist, Slew, Wait, Gate, Take, Drop, Done }

    private struct Op
    {
        public OpT T;
        public float V;
        /// <summary>0 ship, 1 pile, 2 wagon.</summary>
        public int Src, W, Slot;
    }

    private sealed class Pile
    {
        public float X, Z, Tx, Tz;
        public string Kind = "";
        public int N, Cap = 4;
        public AnimatableBody3D? Body;
    }

    private sealed class Crane
    {
        public Node3D Obj = null!, Jib = null!;
        public int Index;
        public float X, Z, Yaw;
        /// <summary>Jib angle in the crane's frame (0 = rest) and the hook's height.</summary>
        public float A, Hy = HookRest;
        public string? Carry;
        public List<Op> Ops = new();
        public float OpT, Idle, IdleTo;
        public Func<double> R = null!;
        public float? ShipA;
        public Pile? Pile;
        public string Goods = "";
        /// <summary>'x', 'z' or none: the runway it rolls along, and its ends.</summary>
        public char Axis = ' ';
        public float Lo, Hi, Pos, Speed, Stay, NextA, Along, Stuck, Roll, BlockT;
        public float? Target;
        /// <summary>"berth", "swingIn", "travel", "swingOut".</summary>
        public string Mode = "berth";
        public List<(float P, float A)> Berths = new();
        public bool Reserved, Blocked;
        public List<Crane> Near = new();
        public CraneGeo.Capsule[] Parts = new CraneGeo.Capsule[CraneGeo.PartCount];
        public float PartsPos = float.NaN, PartsA, PartsHy, PartsLoad;
        public int Lifts, Trips;
    }

    private Node3D group = null!;
    private Line line = null!;
    private Gate gate = null!;
    private readonly List<Wagon> wagons = new();
    private readonly List<Crane> cranes = new();
    private float trainLen;
    private Func<double> rnd = Mv.Rng(1873);
    private readonly Dictionary<string, Copies?> bodies = new();
    private Copies? wheels, links, hooks, ropes, slings, craneWheels;
    private readonly Dictionary<string, Copies?> goodsMesh = new();
    private readonly Dictionary<string, int> gcount = new();
    private readonly AnimatableBody3D[] horseBodies = new AnimatableBody3D[2];
    private float gateOutFace = -1, gateOutTip = -1, gateBackFace = -1, gateBackTip = -1, hideX;
    private List<Stop> stops = new();
    private float head, v, shedT, roll, gait;
    private string state = "shed"; // "shed", "run", "work"
    private int stopI;
    private Stop? working;
    private string waitWhy = "";
    private readonly List<CraneGeo.Capsule> trainCaps = new();
    private readonly Dictionary<Bridges.Rect, List<(float A, float B)>> spans = new();
    private bool ok;

    public string State => state;
    public float Speed => v;
    public string WaitWhy => waitWhy;
    public Vector3 HeadAt
    {
        get
        {
            var p = line.At(head - 1.6f);
            return new Vector3(p.X, 0, p.Y);
        }
    }

    /// <summary>Before the still world is made solid: the cranes travel (their portals bring a body that moves).</summary>
    public static void Claims()
    {
        foreach (var c in Mv.Tops("portal_crane")) Mv.Claim(c);
    }

    public override void _Ready()
    {
        I = this;
        var g = Mv.Top("railway");
        string city = Water.CityJson();
        if (g == null || !File.Exists(city))
        {
            GD.PrintErr("railway: no baked railway group or no shared/city.json: the train stays in its shed");
            SetProcess(false);
            return;
        }
        group = g;
        using var doc = JsonDocument.Parse(File.ReadAllText(city));
        var decor = doc.RootElement.GetProperty("decor");
        var T = decor.GetProperty("tracks");
        var a = SmoothLine(T[0]);
        var b = SmoothLine(T[1]);
        const float West = -430;
        var pts = new List<(float, float)> { (West, a[0].Z) };
        pts.AddRange(a);
        pts.AddRange(b);
        pts.Add((West, b[^1].Z));
        line = new Line(pts);

        gate = new Gate(this);
        hideX = Gate.Face - 5.2f;
        for (int i = 0; i < line.X.Length - 1; i++)
        {
            float x0 = line.X[i], x1 = line.X[i + 1], s = i * Line.Step;
            foreach (var (x, tip) in new[] { (Gate.Face, false), (Gate.Face + Gate.Reach, true) })
            {
                if (x0 < x && x1 >= x)
                {
                    if (tip && gateOutTip < 0) gateOutTip = s;
                    if (!tip && gateOutFace < 0) gateOutFace = s;
                }
                if (x0 > x && x1 <= x)
                {
                    if (tip) gateBackTip = s;
                    else gateBackFace = s;
                }
            }
        }

        // the wagons and what they are drawn with
        var layout = new (string, string?)[] { ("open", "sacks"), ("flat", "casks"), ("open", "bales"), ("flat", "crates"), ("van", null) };
        for (int i = 0; i < layout.Length; i++)
        {
            var w = new Wagon { Kind = layout[i].Item1, Goods = layout[i].Item2, Front = HorseGap + Traces + 1.6f + i * (LBuf + 0.02f) };
            w.Body = NewBox($"wagon_{i}", new Vector3(2.64f, w.Kind == "van" ? 3.3f : w.Kind == "open" ? 1.9f : 1.5f, LBuf - 0.2f));
            wagons.Add(w);
        }
        for (int i = 0; i < 2; i++) horseBodies[i] = NewBox($"train_horse_{i}", new Vector3(0.9f, 2.2f, 3.0f));
        trainLen = wagons[^1].Front + LBuf;
        FillRandom();
        foreach (string k in new[] { "open", "flat", "van" }) bodies[k] = Copies.Find(group, "wagon" + k);
        wheels = Copies.Find(group, "wagonwheels");
        links = Copies.Find(group, "wagonchains");
        foreach (string gk in Goods) goodsMesh[gk] = Copies.Find(group, "goods" + gk, 48);
        hooks = Copies.Find(group, "cranehooks");
        ropes = Copies.Find(group, "craneropes");
        slings = Copies.Find(group, "craneslings");
        craneWheels = Copies.Find(group, "cranewheels");
        foreach (var c in bodies.Values) c?.ZeroAll();
        wheels?.ZeroAll();
        links?.ZeroAll();

        MakeCranes(decor.GetProperty("crane_rails"));
        shedT = 4 + (float)rnd() * 10;
        Bridges.Busy.Add(OnDeck);
        ok = true;
        GD.Print($"railway: the line is {line.Length:0} m, {wagons.Count} wagons, {cranes.Count} cranes at work ({cranes.Count(c => c.ShipA != null)} over a hold, {cranes.Count(c => c.Pile != null)} at a pile, {cranes.Count(c => c.Axis != ' ' && c.Berths.Count > 1)} that travel)");
        foreach (var c in cranes)
            GD.Print(string.Create(System.Globalization.CultureInfo.InvariantCulture, $"railway:   crane {c.Index} at ({c.X:0.0}, {c.Z:0.0}) {(c.ShipA != null ? "over a hold" : "at a pile")}, runway {(c.Axis == ' ' ? "none" : $"{c.Axis} {c.Lo:0.0}..{c.Hi:0.0}")}, berths at {string.Join(" ", c.Berths.Select(b => b.P.ToString("0")))}"));
        if (MoversTest.On) Probes();
    }

    private AnimatableBody3D NewBox(string name, Vector3 size)
    {
        var b = new AnimatableBody3D { Name = name, SyncToPhysics = false, CollisionLayer = Solid.Layer, CollisionMask = 0, Position = new Vector3(0, -100, 0) };
        AddChild(b);
        b.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size }, Position = new Vector3(0, size.Y / 2 + 0.1f, 0) });
        return b;
    }

    private void FillRandom()
    {
        foreach (var w in wagons)
        {
            int rows = w.Goods != null ? (int)Math.Floor(rnd() * 3) : 0;
            Array.Fill(w.Slots, false);
            for (int r = 0; r < rows; r++) w.Slots[r * 2] = w.Slots[r * 2 + 1] = true;
        }
    }

    // ---------------------------------------------------------------- cranes: setting up
    private (float X, float Z) SiteAt(Crane c, float p) => c.Axis == 'x' ? (p, c.Z) : c.Axis == 'z' ? (c.X, p) : (c.X, c.Z);

    /// <summary>The jib angle that puts the hook over a hold, for a crane standing at (x, z), or null.</summary>
    private float? HoldAngle(Crane c, float x, float z, int kmax = 14)
    {
        for (int k = 0; k <= kmax; k++)
            foreach (int sgn in k > 0 ? new[] { 1, -1 } : new[] { 1 })
            {
                float ca = sgn * k * 0.09f, wa = c.Yaw + ca;
                if (Boats.I.HullAt(x + MathF.Sin(wa) * RHook, z + MathF.Cos(wa) * RHook)) return ca;
            }
        return null;
    }

    private void MakeCranes(JsonElement rails)
    {
        var sites = Mv.Tops("portal_crane");
        for (int i = 0; i < sites.Count; i++)
        {
            var obj = sites[i];
            var jib = Mv.Kids(obj, "jib").FirstOrDefault();
            if (jib == null) continue;
            var c = new Crane { Obj = obj, Jib = jib, Index = cranes.Count, X = obj.Position.X, Z = obj.Position.Z, Yaw = obj.Rotation.Y, R = Mv.Rng((uint)(i * 7919 + 17)), Goods = Goods[i % Goods.Length] };
            c.Idle = 2 + (float)rnd() * 6;
            c.Stay = 20 + (float)rnd() * 40;
            if (line.Passes(c.X, c.Z, 1.0f).Count == 0) continue;
            c.ShipA = HoldAngle(c, c.X, c.Z);
            if (c.ShipA == null)
            {
                // no ship in reach: a pile on the quay behind it, off the rails
                for (int k = 0; k <= 12 && c.Pile == null; k++)
                    foreach (int sgn in k > 0 ? new[] { 1, -1 } : new[] { 1 })
                    {
                        float ca = MathF.PI + sgn * k * 0.09f, wa = c.Yaw + ca;
                        float hx = c.X + MathF.Sin(wa) * RHook, hz = c.Z + MathF.Cos(wa) * RHook;
                        bool free = !Water.In(hx, hz);
                        for (int j = 0; free && j < line.X.Length; j += 8)
                            if (MathF.Sqrt((line.X[j] - hx) * (line.X[j] - hx) + (line.Z[j] - hz) * (line.Z[j] - hz)) < 3.2f) free = false;
                        if (!free) continue;
                        c.Pile = new Pile { X = hx, Z = hz, Tx = MathF.Cos(wa), Tz = -MathF.Sin(wa), Kind = c.Goods, N = 1 + (int)Math.Floor(rnd() * 3) };
                        c.A = ca;
                        break;
                    }
            }
            else c.A = c.ShipA.Value;
            if (c.ShipA == null && c.Pile == null) continue;
            c.IdleTo = c.A;
            cranes.Add(c);
        }
        foreach (var c in cranes)
        {
            foreach (var r in rails.EnumerateArray())
            {
                float x0 = r[0].GetSingle(), z0 = r[1].GetSingle(), x1 = r[2].GetSingle(), z1 = r[3].GetSingle();
                bool inX = c.X >= Math.Min(x0, x1) - 0.1f && c.X <= Math.Max(x0, x1) + 0.1f;
                bool inZ = c.Z >= Math.Min(z0, z1) - 0.1f && c.Z <= Math.Max(z0, z1) + 0.1f;
                if (Math.Abs(z0 - z1) < 0.01f && inX && Math.Abs(Math.Abs(z0 - c.Z) - 2.6f) < 0.2f)
                {
                    c.Axis = 'x';
                    c.Lo = Math.Min(x0, x1) + 3.2f;
                    c.Hi = Math.Max(x0, x1) - 3.2f;
                }
                else if (Math.Abs(x0 - x1) < 0.01f && inZ && Math.Abs(Math.Abs(x0 - c.X) - 2.6f) < 0.2f)
                {
                    c.Axis = 'z';
                    c.Lo = Math.Min(z0, z1) + 3.2f;
                    c.Hi = Math.Max(z0, z1) - 3.2f;
                }
            }
            if (c.Pile != null) c.Axis = ' '; // a crane that works a pile stays by it
            c.Pos = c.Axis == 'x' ? c.X : c.Z;
            // the Werf runway runs into the railway gatehouse: keep the legs clear of it
            if (c.Axis == 'x' && c.Lo < Gate.Face + 6.5f) c.Lo = Gate.Face + 6.5f;
            // where the train's line leaves the runway (the curve up to the lock bridge) it crosses a leg line: the
            // runway's working range ends short of the crossing
            if (c.Axis == 'x')
                for (int j = 0; j < line.X.Length; j += 4)
                    if (Math.Abs(line.Z[j] - c.Z) > 2.0f && Math.Abs(line.Z[j] - c.Z) < 3.4f && line.X[j] > c.Pos && line.X[j] - 4.5f < c.Hi)
                        c.Hi = Math.Max(c.Pos, line.X[j] - 4.5f);
            if (c.Axis != ' ')
            {
                // its berths: the places along the runway with a hold under the hook, one for each ship (the squarest swing)
                var run = new List<(float P, float A)>();
                int ship = -1;
                void Close()
                {
                    if (run.Count >= 2) c.Berths.Add(run.OrderBy(q => Math.Abs(q.A)).First());
                    run.Clear();
                }
                for (float p = c.Lo; p <= c.Hi + 0.01f; p += 1)
                {
                    var (x, z) = SiteAt(c, p);
                    var h = HoldAngle(c, x, z, 4);
                    int id = h == null ? -1 : Boats.I.HullIdAt(x + MathF.Sin(c.Yaw + h.Value) * RHook, z + MathF.Cos(c.Yaw + h.Value) * RHook);
                    if (id != ship) Close();
                    ship = id;
                    if (h != null) run.Add((p, h.Value));
                }
                Close();
            }
            // the legs: solid, and they go with it
            Mv.Body(c.Obj, "portal", m => m.GetParent() == c.Obj);
            if (c.Pile != null)
            {
                c.Pile.Body = NewBox($"pile_{c.Index}", new Vector3(2.2f, 1.6f, 2.2f));
                PileOn(c.Pile);
            }
        }
        foreach (var c in cranes)
            foreach (var o in cranes)
                if (o != c) c.Near.Add(o); // (RoomOf leaves out those too far to touch)
    }

    private static bool SameRunway(Crane a, Crane b) => a.Axis != ' ' && a.Axis == b.Axis && (a.Axis == 'x' ? Math.Abs(a.Z - b.Z) < 0.5f : Math.Abs(a.X - b.X) < 0.5f) && a.Lo < b.Hi + 40 && b.Lo < a.Hi + 40;

    private void PileOn(Pile p)
    {
        if (p.Body != null) p.Body.Position = p.N > 0 ? new Vector3(p.X, 0, p.Z) : new Vector3(0, -100, 0);
    }

    private float LoadOf(Crane c) => c.Carry != null ? Sling + UnitH[c.Carry] : 0;

    private CraneGeo.Pose PoseOf(Crane c, float pos, float a, float hy)
    {
        var (x, z) = SiteAt(c, pos);
        return new CraneGeo.Pose { X = x, Z = z, Yaw = c.Yaw, A = a, Hy = hy, Load = LoadOf(c) };
    }

    private CraneGeo.Capsule[] PartsOf(Crane c)
    {
        float load = LoadOf(c);
        if (c.PartsPos != c.Pos || c.PartsA != c.A || c.PartsHy != c.Hy || c.PartsLoad != load)
        {
            CraneGeo.Parts(PoseOf(c, c.Pos, c.A, c.Hy), c.Parts);
            c.PartsPos = c.Pos;
            c.PartsA = c.A;
            c.PartsHy = c.Hy;
            c.PartsLoad = load;
        }
        return c.Parts;
    }

    private readonly CraneGeo.Capsule[] tryParts = new CraneGeo.Capsule[CraneGeo.PartCount];
    private readonly double[] after = new double[64], before = new double[64];

    /// <summary>The room to every crane near: for each, the jibs' and cabins' room less the margin, then the portals'.</summary>
    private int RoomOf(Crane c, in CraneGeo.Pose p, double[] o)
    {
        CraneGeo.Parts(p, tryParts);
        int n = 0;
        foreach (var other in c.Near)
        {
            float dx = (float)p.X - other.X, dz = (float)p.Z - other.Z;
            if (dx * dx + dz * dz > (CraneGeo.Reach + 8) * (CraneGeo.Reach + 8))
            {
                o[n++] = 1;
                o[n++] = 1;
                continue;
            }
            o[n++] = CraneGeo.CraneGap(tryParts, PartsOf(other)) - CraneGeo.JibGap;
            o[n++] = CraneGeo.PortalRoom(p, PoseOf(other, other.Pos, other.A, other.Hy)) - CraneGeo.PortalGap;
        }
        return n;
    }

    /// <summary>
    /// Take the step if it keeps every margin, or at least makes nothing worse (so a crane that starts too close can
    /// always back away). The step is tried in pieces of 0.3 m of jib-tip travel.
    /// </summary>
    private bool TryMove(Crane c, float pos, float a, float hy)
    {
        float da = (float)CraneGeo.AngDiff(a, c.A);
        if (pos == c.Pos && da == 0 && hy == c.Hy) return true;
        int n = Math.Max(1, (int)MathF.Ceiling(Math.Max(Math.Abs(da) * 11.6f, Math.Max(Math.Abs(pos - c.Pos), Math.Abs(hy - c.Hy))) / 0.3f));
        bool had = false;
        for (int i = 1; i <= n; i++)
        {
            float f = i / (float)n;
            int m = RoomOf(c, PoseOf(c, c.Pos + (pos - c.Pos) * f, c.A + da * f, c.Hy + (hy - c.Hy) * f), after);
            bool fine = true;
            for (int k = 0; k < m; k++)
                if (after[k] < 0) fine = false;
            if (fine) continue;
            if (!had)
            {
                RoomOf(c, PoseOf(c, c.Pos, c.A, c.Hy), before);
                had = true;
            }
            for (int k = 0; k < m; k++)
                if (after[k] < 0 && after[k] < before[k] - 1e-6)
                {
                    c.Blocked = true;
                    return false;
                }
        }
        bool moved = pos != c.Pos;
        c.Pos = pos;
        c.A = a;
        c.Hy = hy;
        if (moved) PlaceCrane(c);
        return true;
    }

    private void PlaceCrane(Crane c)
    {
        var (x, z) = SiteAt(c, c.Pos);
        c.X = x;
        c.Z = z;
        c.Obj.Position = new Vector3(x, c.Obj.Position.Y, z);
    }

    private bool SlewTo(Crane c, float a, float dt, float rate = Slew)
    {
        float d = (float)CraneGeo.AngDiff(a, c.A);
        if (Math.Abs(d) < 0.003f) return true;
        float na = c.A + Math.Sign(d) * Math.Min(Math.Abs(d), rate * dt * Math.Clamp(Math.Abs(d) / 0.35f, 0.18f, 1));
        if (!TryMove(c, c.Pos, na, c.Hy)) return false;
        return Math.Abs(CraneGeo.AngDiff(a, c.A)) < 0.003;
    }

    private bool HoistTo(Crane c, float y, float dt)
    {
        float d = y - c.Hy;
        if (Math.Abs(d) < 0.01f) return true;
        float ny = c.Hy + Math.Sign(d) * Math.Min(Math.Abs(d), Hoist * dt * Math.Clamp(Math.Abs(d) / 0.6f, 0.25f, 1));
        if (!TryMove(c, c.Pos, c.A, ny)) return false;
        return Math.Abs(y - c.Hy) < 0.01f;
    }

    /// <summary>Another hold to go to: clear of the other cranes on the runway, with the way there free of them.</summary>
    private (float P, float A)? NextBerth(Crane c)
    {
        var good = new List<(float P, float A)>();
        foreach (var b in c.Berths)
        {
            if (Math.Abs(b.P - c.Pos) < 6) continue;
            float lo = Math.Min(c.Pos, b.P) - CraneGap, hi = Math.Max(c.Pos, b.P) + CraneGap;
            bool free = true;
            foreach (var o in cranes)
            {
                if (o == c || !SameRunway(c, o)) continue;
                float op = o.Pos, ot = o.Target ?? o.Pos;
                if ((op > lo && op < hi) || (ot > lo && ot < hi)) free = false;
            }
            if (free) good.Add(b);
        }
        return good.Count == 0 ? null : good[(int)Math.Floor(c.R() * good.Count)];
    }

    private bool TravelStep(Crane c, float dt)
    {
        if (c.Axis == ' ') return false;
        if (c.Mode == "berth")
        {
            if (c.Reserved || c.Ops.Count > 0) return false;
            c.Stay -= dt;
            if (c.Stay <= 0 && c.Berths.Count > 0)
            {
                var b = NextBerth(c);
                if (b is var (p, a))
                {
                    c.Target = p;
                    c.NextA = a;
                    c.Mode = "swingIn";
                    // the jib along the runway for travel (whichever way is nearer)
                    c.Along = Math.Abs(CraneGeo.AngDiff(Math.PI / 2, c.A)) < Math.Abs(CraneGeo.AngDiff(-Math.PI / 2, c.A)) ? MathF.PI / 2 : -MathF.PI / 2;
                }
                else c.Stay = 8 + (float)c.R() * 10;
            }
            return false;
        }
        if (c.Mode == "swingIn")
        {
            if (c.Reserved || c.BlockT > GiveUp)
            {
                c.BlockT = 0;
                c.Target = null;
                c.Mode = "swingOut";
                return true;
            }
            bool s2 = HoistTo(c, TravelHook, dt);
            bool s1 = SlewTo(c, c.Along, dt);
            if (s1 && s2)
            {
                c.Mode = "travel";
                c.Stuck = 0;
            }
            return true;
        }
        if (c.Mode == "travel")
        {
            float t = c.Target ?? c.Pos, dist = Math.Abs(t - c.Pos);
            int dir = Math.Sign(t - c.Pos);
            float want = Math.Min(CraneV, MathF.Sqrt(2 * 0.12f * dist));
            // nobody under the legs: it waits for Jef
            var jef = Jef.I;
            if (jef != null && dist > 0.01f)
            {
                var (nx, nz) = SiteAt(c, c.Pos + dir * 2.5f);
                if (Math.Abs(jef.X - nx) < 4.6f && Math.Abs(jef.Z - nz) < 4.6f && jef.Y < 3)
                {
                    want = 0;
                    c.Speed = Math.Min(c.Speed, 0.05f);
                }
            }
            c.Speed += Math.Clamp(want - c.Speed, -0.4f * dt, 0.15f * dt);
            if (c.Speed < 0.002f && want == 0) c.Speed = 0;
            float step = Math.Min(c.Speed * dt, dist);
            if (step > 0 && TryMove(c, c.Pos + dir * step, c.A, c.Hy))
                c.Roll += (c.Axis == 'x' ? dir * step * MathF.Cos(c.Yaw) : -dir * step * MathF.Sin(c.Yaw)) / CraneWheelR;
            else if (step > 0)
            {
                c.Speed = 0;
                if (c.BlockT > 15)
                {
                    // it cannot get there: it stays here and works the hold under it, if any
                    c.Target = c.Pos;
                    c.NextA = HoldAngle(c, c.X, c.Z) ?? 0;
                }
            }
            if (Math.Abs((c.Target ?? c.Pos) - c.Pos) < 0.005f)
            {
                c.Pos = c.Target ?? c.Pos;
                c.Speed = 0;
                PlaceCrane(c);
                c.ShipA = c.NextA;
                c.Target = null;
                c.Mode = "swingOut";
                c.Trips++;
            }
            return true;
        }
        if ((SlewTo(c, c.ShipA ?? 0, dt) && HoistTo(c, HookRest, dt)) || c.BlockT > GiveUp)
        {
            c.BlockT = 0;
            c.Mode = "berth";
            c.Stay = 25 + (float)c.R() * 35;
            c.Idle = 4 + (float)c.R() * 6;
            c.IdleTo = c.A;
        }
        return true;
    }

    private float AngleTo(Crane c, float x, float z) => (float)CraneGeo.AngDiff(Math.Atan2(x - c.X, z - c.Z), c.Yaw);

    private void UpdateCrane(Crane c, float dt, bool trainStopped)
    {
        if (TravelStep(c, dt)) return;
        if (c.Ops.Count == 0)
        {
            c.Idle -= dt;
            if (c.Idle <= 0)
            {
                float home = c.ShipA ?? AngleTo(c, c.Pile!.X, c.Pile.Z);
                c.Idle = 10 + (float)c.R() * 20;
                c.IdleTo = home + ((float)c.R() * 2 - 1) * 0.5f;
            }
            float d = (float)CraneGeo.AngDiff(c.IdleTo, c.A);
            if (Math.Abs(d) > 1e-4f)
            {
                float na = c.A + Math.Sign(d) * Math.Min(Math.Abs(d), Slew * 0.5f * dt * Math.Clamp(Math.Abs(d) / 0.3f, 0.2f, 1));
                if (!TryMove(c, c.Pos, na, c.Hy))
                {
                    c.IdleTo = c.A;
                    c.Idle = Math.Min(c.Idle, 3 + (float)c.R() * 5);
                }
            }
            float dh = HookRest - c.Hy;
            if (Math.Abs(dh) > 1e-3f) TryMove(c, c.Pos, c.A, Math.Abs(dh) < 0.005f ? HookRest : c.Hy + dh * Math.Min(1, dt * 0.5f));
            return;
        }
        if (c.BlockT > 45)
        {
            // it cannot do this lift: the load is let go and the train goes on
            c.Ops.Clear();
            c.Carry = null;
            c.Reserved = false;
            if (working?.Crane == c)
            {
                working = null;
                stopI++;
                state = "run";
            }
            return;
        }
        var op = c.Ops[0];
        switch (op.T)
        {
            case OpT.Hoist:
            {
                float d = op.V - c.Hy;
                float ease = Math.Clamp(Math.Abs(d) / 0.6f, 0.25f, 1);
                TryMove(c, c.Pos, c.A, c.Hy + Math.Sign(d) * Math.Min(Math.Abs(d), Hoist * ease * dt));
                if (Math.Abs(op.V - c.Hy) < 0.005f)
                {
                    c.Hy = op.V;
                    c.Ops.RemoveAt(0);
                }
                break;
            }
            case OpT.Slew:
            {
                float d = (float)CraneGeo.AngDiff(op.V, c.A);
                float ease = Math.Clamp(Math.Abs(d) / 0.35f, 0.18f, 1);
                TryMove(c, c.Pos, c.A + Math.Sign(d) * Math.Min(Math.Abs(d), Slew * ease * dt), c.Hy);
                if (Math.Abs(CraneGeo.AngDiff(op.V, c.A)) < 0.002)
                {
                    c.A = op.V;
                    c.Ops.RemoveAt(0);
                }
                break;
            }
            case OpT.Wait:
                c.OpT += dt;
                if (c.OpT >= op.V)
                {
                    c.OpT = 0;
                    c.Ops.RemoveAt(0);
                }
                break;
            case OpT.Gate:
                if (trainStopped) c.Ops.RemoveAt(0);
                break;
            case OpT.Take:
                if (op.Src == 2) wagons[op.W].Slots[op.Slot] = false;
                if (op.Src == 1 && c.Pile != null)
                {
                    c.Pile.N = Math.Max(0, c.Pile.N - 1);
                    PileOn(c.Pile);
                }
                c.Carry = op.Src == 2 ? wagons[op.W].Goods : c.Goods;
                c.Ops.RemoveAt(0);
                c.Lifts++;
                break;
            case OpT.Drop:
                if (op.Src == 2) wagons[op.W].Slots[op.Slot] = true;
                if (op.Src == 1 && c.Pile != null)
                {
                    c.Pile.N = Math.Min(c.Pile.Cap, c.Pile.N + 1);
                    PileOn(c.Pile);
                }
                c.Carry = null;
                c.Ops.RemoveAt(0);
                break;
            case OpT.Done:
                c.Ops.RemoveAt(0);
                c.Reserved = false;
                if (working?.Crane == c)
                {
                    working = null;
                    stopI++;
                    state = "run";
                }
                break;
        }
    }

    // ---------------------------------------------------------------- the train: where things are
    private (float X, float Z, float Yaw) WagonAt(Wagon w, float hd)
    {
        float mid = hd - w.Front - LBuf / 2;
        var pa = line.At(mid + Wb / 2);
        var pb = line.At(mid - Wb / 2);
        return ((pa.X + pb.X) / 2, (pa.Y + pb.Y) / 2, MathF.Atan2(pa.X - pb.X, pa.Y - pb.Y));
    }

    private Vector3 SlotAt(Wagon w, int slot, float hd)
    {
        var p = WagonAt(w, hd);
        float along = Rows[slot / 2], across = Across[slot % 2], s = MathF.Sin(p.Yaw), c = MathF.Cos(p.Yaw);
        return new Vector3(p.X + s * along + c * across, Floor, p.Z + c * along - s * across);
    }

    private static Vector3 PileSlot(Pile p, int i)
    {
        float across = i % 2 == 1 ? 0.58f : -0.58f;
        return new Vector3(p.X + p.Tx * across, i / 2 * UnitH[p.Kind], p.Z + p.Tz * across);
    }

    private void PlanTrip()
    {
        stops = new List<Stop>();
        foreach (var c in cranes)
        {
            if (rnd() < 0.3) continue;
            var passes = line.Passes(c.X, c.Z, 1.0f);
            if (passes.Count == 0) continue;
            float pass = passes[(int)Math.Floor(rnd() * passes.Count)];
            int w = wagons.FindIndex(x => x.Goods == c.Goods);
            if (w < 0) continue;
            stops.Add(new Stop { Crane = c, Head = pass, Wagon = w });
        }
        stops.Sort((p, q) => p.Head.CompareTo(q.Head));
    }

    /// <summary>Work out where to stand and what to do, as the train comes up to a crane.</summary>
    private bool Prepare(Stop st)
    {
        var c = st.Crane;
        var w = wagons[st.Wagon];
        if (c.Ops.Count > 0 || c.Mode != "berth") return false;
        var near = line.Passes(c.X, c.Z, 1.0f).Where(q => Math.Abs(q - st.Head) < 120).ToList();
        if (near.Count == 0) return false;
        st.Head = near.OrderBy(q => Math.Abs(q - st.Head)).First();
        var full = new[] { 0, 1, 2 }.Where(r => w.Slots[r * 2] && w.Slots[r * 2 + 1]).ToList();
        var empty = new[] { 0, 1, 2 }.Where(r => !w.Slots[r * 2] && !w.Slots[r * 2 + 1]).ToList();
        if (c.ShipA != null) st.In = !(full.Count >= 2 || (full.Count == 1 && rnd() < 0.4) || empty.Count == 0);
        else
        {
            var p = c.Pile!;
            if (empty.Count > 0 && p.N >= 2 && (rnd() < 0.5 || full.Count == 0)) st.In = true;
            else if (full.Count > 0 && p.N <= p.Cap - 2) st.In = false;
            else return false;
        }
        var rows = st.In ? empty : full;
        if (rows.Count == 0) return false;
        st.Row = rows[(int)Math.Floor(rnd() * rows.Count)];
        float pass = st.Head, off = w.Front + LBuf / 2 - Rows[st.Row];
        var cand = new List<float>();
        foreach (int sgn in new[] { -1, 1 })
        {
            // where the line crosses the hook's circle: the wagon's row stands there
            float lo = sgn < 0 ? pass - RHook - 6 : pass, hi = sgn < 0 ? pass : pass + RHook + 6;
            float D(float s)
            {
                var q = line.At(s);
                return MathF.Sqrt((q.X - c.X) * (q.X - c.X) + (q.Y - c.Z) * (q.Y - c.Z)) - RHook;
            }
            if (Math.Sign(D(lo)) == Math.Sign(D(hi))) continue;
            for (int k = 0; k < 40; k++)
            {
                float m = (lo + hi) / 2;
                if (Math.Sign(D(m)) == Math.Sign(D(lo))) lo = m;
                else hi = m;
            }
            float s0 = (lo + hi) / 2;
            if (Math.Abs(CraneGeo.AngDiff(line.Yaw(s0 + 3.5f), line.Yaw(s0 - 3.5f))) > 0.04) continue;
            if (line.At(s0).X < Gate.Face + 2.5f) continue;
            cand.Add(s0 + off);
        }
        var good = cand.Where(h => h > head + 4).ToList();
        if (good.Count == 0) return false;
        st.Head = good[(int)Math.Floor(rnd() * good.Count)];
        c.Reserved = true;
        return true;
    }

    private void Queue(Stop st)
    {
        var c = st.Crane;
        var w = wagons[st.Wagon];
        float unit = UnitH[w.Goods!];
        float HookFor(float bottom) => bottom + unit + Sling;
        var ops = new List<Op>();
        for (int k = 0; k < 2; k++)
        {
            int slot = st.Row * 2 + k;
            var at = SlotAt(w, slot, st.Head);
            float wagonA = AngleTo(c, at.X, at.Z);
            int src = c.ShipA != null ? 0 : 1;
            float srcA = c.ShipA ?? AngleTo(c, c.Pile!.X, c.Pile.Z);
            float shipY = Tide.LevelAt(c.X, c.Z - 8) + 0.25f;
            float srcY = c.ShipA != null ? shipY : PileSlot(c.Pile!, Math.Max(0, c.Pile!.N - 1 - k)).Y;
            float dstY = c.Pile != null ? PileSlot(c.Pile, Math.Min(c.Pile.Cap - 1, c.Pile.N + k)).Y : shipY;
            if (st.In)
            {
                ops.Add(new Op { T = OpT.Hoist, V = Travel });
                ops.Add(new Op { T = OpT.Slew, V = srcA });
                ops.Add(new Op { T = OpT.Hoist, V = HookFor(srcY) });
                ops.Add(new Op { T = OpT.Wait, V = 1.6f });
                ops.Add(new Op { T = OpT.Take, Src = src });
                ops.Add(new Op { T = OpT.Hoist, V = Travel });
                ops.Add(new Op { T = OpT.Slew, V = wagonA });
                ops.Add(new Op { T = OpT.Gate });
                ops.Add(new Op { T = OpT.Hoist, V = HookFor(Floor) });
                ops.Add(new Op { T = OpT.Wait, V = 1.2f });
                ops.Add(new Op { T = OpT.Drop, Src = 2, W = st.Wagon, Slot = slot });
            }
            else
            {
                ops.Add(new Op { T = OpT.Hoist, V = Travel });
                ops.Add(new Op { T = OpT.Slew, V = wagonA });
                ops.Add(new Op { T = OpT.Gate });
                ops.Add(new Op { T = OpT.Hoist, V = HookFor(Floor) });
                ops.Add(new Op { T = OpT.Wait, V = 1.6f });
                ops.Add(new Op { T = OpT.Take, Src = 2, W = st.Wagon, Slot = slot });
                ops.Add(new Op { T = OpT.Hoist, V = Travel });
                ops.Add(new Op { T = OpT.Slew, V = srcA });
                ops.Add(new Op { T = OpT.Hoist, V = HookFor(dstY) });
                ops.Add(new Op { T = OpT.Wait, V = 1.2f });
                ops.Add(new Op { T = OpT.Drop, Src = src });
            }
        }
        ops.Add(new Op { T = OpT.Hoist, V = Travel });
        ops.Add(new Op { T = OpT.Done });
        c.Ops = ops;
        c.OpT = 0;
        st.Queued = true;
    }

    private void Abandon(Stop st)
    {
        st.Crane.Reserved = false;
        if (!st.Queued) return;
        st.Crane.Ops = new List<Op> { new() { T = OpT.Hoist, V = Travel } };
        st.Crane.Carry = null;
        if (working == st) working = null;
    }

    private void StartTrip()
    {
        head = 0;
        v = 0;
        stopI = 0;
        working = null;
        PlanTrip();
        state = "run";
    }

    private List<(float A, float B)> SpanOf(Bridges.Rect r)
    {
        if (spans.TryGetValue(r, out var l)) return l;
        l = new List<(float, float)>();
        float a = -1, b = -1;
        for (int i = 0; i < line.X.Length; i++)
        {
            bool inside = r.Has(line.X[i], line.Z[i]);
            if (inside)
            {
                if (a < 0) a = i * Line.Step;
                b = i * Line.Step;
            }
            else if (a >= 0)
            {
                l.Add((a, b));
                a = -1;
            }
        }
        if (a >= 0) l.Add((a, b));
        spans[r] = l;
        return l;
    }

    /// <summary>The train is on (or at) this bridge's deck: it does not open under it (bridges.ts busy).</summary>
    private bool OnDeck(Bridges.Rect r)
    {
        if (state == "shed") return false;
        foreach (var (a, b) in SpanOf(r))
            if (head + 2 > a && head - trainLen < b + 1) return true;
        return false;
    }

    /// <summary>How far the head may go now: before the next stop, the gate, an open bridge, Jef.</summary>
    private float Limit()
    {
        float lim = line.Length + 50;
        waitWhy = "";
        while (stopI < stops.Count)
        {
            var st = stops[stopI];
            if (!st.Queued)
            {
                if (st.Head - head > 70) break;
                if (!Prepare(st))
                {
                    stopI++;
                    continue;
                }
                Queue(st);
            }
            if (st.Head < head - 0.5f)
            {
                Abandon(st);
                stopI++;
                continue;
            }
            lim = Math.Min(lim, st.Head);
            break;
        }
        // the gate of the Werf store: asked for as the train comes up to it, shut behind the last wagon
        bool outW = head > gateOutFace - 30 && head - trainLen < gateOutTip + 1;
        bool back = head > gateBackTip - 16 && head - trainLen < gateBackFace + 0.5f;
        gate.WantOpen = state != "shed" && (outW || back);
        if (gate.Amount < 0.99f)
            foreach (float stopAt in new[] { gateOutFace - 0.8f, gateBackTip - 1.5f })
                if (head <= stopAt + 0.01f && head > stopAt - 60 && stopAt < lim)
                {
                    lim = Math.Max(head, stopAt);
                    waitWhy = "gate";
                }
        // an opening bridge ahead that is not shut
        void Bridge(Bridges.Rect rect, bool closed)
        {
            if (closed) return;
            foreach (var (s0, _) in SpanOf(rect))
                if (s0 > head - 0.5f && s0 - head < 40 && s0 - 8 < lim)
                {
                    lim = Math.Max(head, s0 - 8);
                    waitWhy = "bridge";
                }
        }
        if (Bridges.I != null)
            foreach (var br in Bridges.I.List) Bridge(br.Rect, br.Closed);
        if (Lock.I != null) Bridge(Lock.BridgeRect, Lock.I.BridgeClosed);
        // Jef on the line ahead or at the horses' heads
        var jef = Jef.I;
        if (jef != null)
            for (float d = -1; d <= 7; d += 0.5f)
            {
                var pa = line.At(head + d);
                if (MathF.Sqrt((jef.X - pa.X) * (jef.X - pa.X) + (jef.Z - pa.Y) * (jef.Z - pa.Y)) < 1.75f)
                {
                    if (head + d - 7.5f < lim)
                    {
                        lim = Math.Max(head, head + d - 7.5f);
                        waitWhy = "player";
                    }
                    break;
                }
            }
        return lim;
    }

    // ---------------------------------------------------------------- per frame
    public override void _Process(double delta)
    {
        if (!ok) return;
        MoverCost.Begin("railway");
        float dt = (float)MoverClock.Dt;
        if (state == "shed")
        {
            shedT -= dt;
            if (shedT <= 0) StartTrip();
        }
        bool stopped = false;
        if (state != "shed")
        {
            float lim = Limit();
            float room = lim - head;
            float creep = working != null || (stopI < stops.Count && stops[stopI].Head - head < 8) ? Creep : Cruise;
            float want = room <= 0.01f ? 0 : Math.Min(creep, MathF.Sqrt(2 * Brake * Math.Max(0, room)));
            v += Math.Clamp(want - v, -Brake * 2 * dt, Accel * dt);
            if (v < 0.005f && want == 0) v = 0;
            float ds = Math.Min(v * dt, Math.Max(0, room));
            head += ds;
            roll += ds / WheelR;
            gait = (gait + v / 1.35f * dt * 0.95f) % 1;
            stopped = v < 0.02f;
            // at a crane stop: stand while it works
            var st = stopI < stops.Count ? stops[stopI] : null;
            if (state == "run" && st != null && st.Queued && Math.Abs(st.Head - head) < 0.08f && stopped)
            {
                state = "work";
                working = st;
            }
            // off the line's end: back into the store; a new trip after a while
            if (head - trainLen > line.Length - 60)
            {
                state = "shed";
                shedT = 30 + (float)rnd() * 60;
                FillRandom();
            }
        }
        else gate.WantOpen = false;
        gate.Update(dt);
        foreach (var c in cranes) c.Blocked = false;
        foreach (var c in cranes) UpdateCrane(c, dt, state == "work" && stopped && working?.Crane == c);
        foreach (var c in cranes) c.BlockT = c.Blocked ? c.BlockT + dt : 0;
        PlaceTrain();
        Draw();
        MoverCost.End("railway");
    }

    private (float X, float Z, float Yaw) HorseFrame(int i)
    {
        float s = head - 1.6f - i * HorseGap;
        var p = line.At(s);
        return (p.X, p.Y, line.Yaw(s));
    }

    private void PlaceTrain()
    {
        var pool = HorsePool.I;
        float amp = Math.Min(1, v / 0.8f);
        for (int i = 0; i < 2; i++)
        {
            var f = HorseFrame(i);
            if (state == "shed" || f.X < hideX - 1.6f)
            {
                pool?.Hide(i);
                horseBodies[i].Position = new Vector3(0, -100, 0);
                continue;
            }
            pool?.Set(i, f.X, f.Z, f.Yaw, (gait + i * 0.37f) % 1, amp);
            horseBodies[i].Transform = new Transform3D(new Basis(Vector3.Up, f.Yaw), new Vector3(f.X, 0, f.Z));
        }
        foreach (var w in wagons)
        {
            if (state == "shed")
            {
                w.Body.Position = new Vector3(0, -100, 0);
                continue;
            }
            var p = WagonAt(w, head);
            w.X = p.X;
            w.Z = p.Z;
            w.Yaw = p.Yaw;
            w.Body.Transform = new Transform3D(new Basis(Vector3.Up, p.Yaw), new Vector3(p.X, 0, p.Z));
        }
    }

    private void Unit(string g, float x, float y, float z, float yaw)
    {
        var m = goodsMesh.GetValueOrDefault(g);
        if (m == null) return;
        int n = gcount.GetValueOrDefault(g);
        if (n >= m.Count) return;
        m.Put(n, x, y, z, yaw);
        gcount[g] = n + 1;
    }

    private int TraceAt(int i) => i == 0 ? 0 : wagons.Count - 1 + i;

    private void Draw()
    {
        bool hidden = state == "shed";
        foreach (string g in Goods) gcount[g] = 0;
        var idx = new Dictionary<string, int>(3);
        Vector3? prevRear = null;
        for (int i = 0; i < wagons.Count; i++)
        {
            var w = wagons[i];
            int k = idx.GetValueOrDefault(w.Kind);
            idx[w.Kind] = k + 1;
            var body = bodies.GetValueOrDefault(w.Kind);
            float s = MathF.Sin(w.Yaw), c = MathF.Cos(w.Yaw), e = LBody / 2 + 0.3f;
            // in the store, or wholly in the dark behind the gate: not drawn
            if (hidden || w.X < hideX - LBuf / 2)
            {
                body?.Zero(k);
                wheels?.Zero(i * 2);
                wheels?.Zero(i * 2 + 1);
                if (i == 0)
                    for (int q = 0; q < TracePieces; q++) links?.Zero(TraceAt(q));
                else links?.Zero(i);
                prevRear = new Vector3(w.X - s * e, 0.98f, w.Z - c * e);
                continue;
            }
            body?.Put(k, w.X, 0, w.Z, w.Yaw);
            float mid = head - w.Front - LBuf / 2;
            for (int j = 0; j < 2; j++)
            {
                var pa = line.At(mid + (j == 0 ? Wb / 2 : -Wb / 2));
                wheels?.Put(i * 2 + j, pa.X, RailTop + WheelR, pa.Y, w.Yaw, roll);
            }
            var front = new Vector3(w.X + s * e, 0.98f, w.Z + c * e);
            if (prevRear != null && i > 0) links?.Between(i, prevRear.Value, front);
            else if (links != null)
            {
                // the main chain from the spreader behind the rear horse to the first wagon's hook, with a little sag
                var f1 = HorseFrame(1);
                float hc = MathF.Cos(f1.Yaw), hs = MathF.Sin(f1.Yaw);
                var a = new Vector3(f1.X + Spread.Z * hs, Spread.Y + (HorsePool.I?.Bob(1) ?? 0), f1.Z + Spread.Z * hc);
                float len = a.DistanceTo(front);
                int n = Math.Max(1, Math.Min(TracePieces, (int)MathF.Round(len / TraceLink)));
                float sag = Math.Min(0.12f, len * 0.04f);
                var p = a;
                for (int q = 1; q <= n; q++)
                {
                    float t = q / (float)n;
                    var nq = a.Lerp(front, t) + Vector3.Down * sag * MathF.Sin(MathF.PI * t);
                    links.Between(TraceAt(q - 1), p, nq, 0.7f);
                    p = nq;
                }
                for (int q = n; q < TracePieces; q++) links.Zero(TraceAt(q));
            }
            prevRear = new Vector3(w.X - s * e, 0.98f, w.Z - c * e);
            if (w.Goods != null)
                for (int sl = 0; sl < 6; sl++)
                {
                    if (!w.Slots[sl]) continue;
                    float along = Rows[sl / 2], across = Across[sl % 2];
                    Unit(w.Goods, w.X + s * along + c * across, Floor, w.Z + c * along - s * across, w.Yaw + (w.Goods == "casks" ? MathF.PI / 2 : 0));
                }
        }
        // the cranes: hooks, ropes, slings and loads; the piles on the quay
        for (int i = 0; i < cranes.Count; i++)
        {
            var c = cranes[i];
            c.Jib.Rotation = new Vector3(0, c.A, 0);
            float co = MathF.Cos(c.Yaw), si = MathF.Sin(c.Yaw);
            for (int k = 0; k < 8; k++)
            {
                float lx = CraneFeet[k / 2].X + (k % 2 == 0 ? -0.42f : 0.42f), lz = CraneFeet[k / 2].Z;
                craneWheels?.Put(i * 8 + k, c.X + lx * co + lz * si, CraneWheelR + 0.02f, c.Z - lx * si + lz * co, c.Yaw, 0, 1, 1, 1, -c.Roll);
            }
            float wa = c.Yaw + c.A;
            var hk = new Vector3(c.X + MathF.Sin(wa) * RHook, c.Hy, c.Z + MathF.Cos(wa) * RHook);
            var tip = new Vector3(hk.X, (float)CraneGeo.TipY, hk.Z);
            float len = Math.Max(0.1f, tip.Y - (hk.Y + HookBlock));
            ropes?.Put(i, tip.X, tip.Y, tip.Z, wa, 0, 1, len, 1);
            hooks?.Put(i, hk.X, hk.Y, hk.Z, wa);
            if (c.Carry != null)
            {
                slings?.Put(i, hk.X, hk.Y, hk.Z, wa);
                Unit(c.Carry, hk.X, hk.Y - Sling - UnitH[c.Carry], hk.Z, wa + (c.Carry == "casks" ? MathF.PI / 2 : 0));
            }
            else slings?.Zero(i);
            if (c.Pile != null)
            {
                var p = c.Pile;
                float yaw = MathF.Atan2(p.Tx, p.Tz) + MathF.PI / 2;
                for (int k = 0; k < p.N; k++)
                {
                    var q = PileSlot(p, k);
                    Unit(p.Kind, q.X, q.Y, q.Z, yaw + (p.Kind == "casks" ? MathF.PI / 2 : 0));
                }
            }
        }
        foreach (var (g, m) in goodsMesh)
        {
            if (m == null) continue;
            int n = gcount.GetValueOrDefault(g);
            for (int i = n; i < m.Count; i++) m.Zero(i);
            m.Node.Visible = n > 0; // no draw call for goods nobody sees
            m.Commit();
        }
        foreach (var m in bodies.Values) m?.Commit();
        wheels?.Commit();
        links?.Commit();
        hooks?.Commit();
        ropes?.Commit();
        slings?.Commit();
        craneWheels?.Commit();
    }

    // ---------------------------------------------------------------- the self-test
    /// <summary>The self-test: the train is out and on the line a little before this x on its way east.</summary>
    public void TestAt(float x)
    {
        StartTrip();
        for (int i = 0; i < line.X.Length; i++)
            if (line.X[i] >= x)
            {
                head = i * Line.Step;
                break;
            }
        stops.RemoveAll(s => s.Head < head + 20);
        v = Cruise;
    }

    private void Probes()
    {
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "train_on_the_quay",
            Hour = 10,
            Gap = 4,
            MaxWait = 30,
            Start = () => TestAt(-20),
            Ready = () => v > 0.6f,
            Where = () => (HeadAt, head, $"the goods train, {state}, {v:0.00} m/s{(waitWhy != "" ? ", waits for the " + waitWhy : "")}, wagons loaded: {string.Join(" ", wagons.Select(w => w.Slots.Count(s => s)))}"),
            View = () => (HeadAt + new Vector3(9, 4.5f, 12), HeadAt + new Vector3(-9, 1.2f, 0)),
        });
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "train_at_a_crane",
            Hour = 10,
            Gap = 6,
            MaxWait = 240,
            Ready = () => state == "work" && working != null && working.Crane.Ops.Count > 0 && working.Crane.Ops[0].T is OpT.Slew or OpT.Hoist && working.Crane.Carry != null,
            Where = () =>
            {
                var c = working?.Crane ?? cranes[0];
                float wa = c.Yaw + c.A;
                return (new Vector3(c.X + MathF.Sin(wa) * RHook, c.Hy, c.Z + MathF.Cos(wa) * RHook), c.A, $"crane {c.Index} works the train: {c.Ops.Count} steps to go, on the hook: {c.Carry ?? "nothing"}, lifts {c.Lifts}");
            },
            View = () =>
            {
                var c = working?.Crane ?? cranes[0];
                return (new Vector3(c.X + 17, 9, c.Z + 20), new Vector3(c.X, 6, c.Z - 2));
            },
        });
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "rail_gate",
            Hour = 10,
            Gap = 3,
            MaxWait = 60,
            Start = () =>
            {
                StartTrip();
                head = gateOutFace - 29; // (in the dark of the store, coming up to the gate)
            },
            Ready = () => gate.Amount > 0.15f && gate.Amount < 0.8f,
            Where = () => (new Vector3(Gate.Face + MathF.Sin(Gate.Swing * gate.Amount) * Gate.LeafW, 2, Gate.OpenS + MathF.Cos(Gate.Swing * gate.Amount) * Gate.LeafW), gate.Amount, $"the gate of the Werf store, {gate.Amount * 100:0} % open, the train {state} at {head:0} m"),
            View = () => (new Vector3(Gate.Face + 13, 3.2f, 9.5f), new Vector3(Gate.Face, 2.2f, 4)),
        });
        Crane? mover = null;
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "crane_travels",
            Hour = 15,
            Gap = 6,
            MaxWait = 150,
            Start = () =>
            {
                foreach (var c in cranes) c.Stay = Math.Min(c.Stay, 1);
            },
            Ready = () => (mover = cranes.FirstOrDefault(c => c.Mode == "travel" && c.Speed > 0.2f)) != null,
            Where = () => mover == null ? (Vector3.Zero, 0, "no crane travels") : (new Vector3(mover.X, 0, mover.Z), mover.Pos, $"crane {mover.Index} travels along its runway to {mover.Target:0.0} at {mover.Speed:0.00} m/s, jib at {mover.A:0.00}, hook at {mover.Hy:0.0} m; nearest other crane's room {NearestRoom(mover):0.0} m"),
            View = () => mover == null ? (new Vector3(0, 10, 30), new Vector3(0, 5, 4)) : (new Vector3(mover.X + (mover.Axis == 'x' ? 14 : 24), 8, mover.Z + (mover.Axis == 'x' ? 26 : 12)), new Vector3(mover.X, 6, mover.Z)),
        });
        Crane? swinger = null;
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "crane_swings",
            Hour = 15,
            Gap = 4,
            MaxWait = 90,
            Start = () =>
            {
                foreach (var c in cranes) c.Idle = Math.Min(c.Idle, 0.5f);
            },
            Ready = () => (swinger = cranes.FirstOrDefault(c => c.Mode == "berth" && c.Ops.Count == 0 && Math.Abs(CraneGeo.AngDiff(c.IdleTo, c.A)) > 0.15)) != null,
            Where = () => swinger == null ? (Vector3.Zero, 0, "no crane swings") : (new Vector3(swinger.X + MathF.Sin(swinger.Yaw + swinger.A) * RHook, swinger.Hy, swinger.Z + MathF.Cos(swinger.Yaw + swinger.A) * RHook), swinger.A, $"crane {swinger.Index} swings its jib from {swinger.A:0.00} to {swinger.IdleTo:0.00}"),
            View = () => swinger == null ? (new Vector3(0, 10, 30), new Vector3(0, 5, 4)) : (new Vector3(swinger.X + 16, 10, swinger.Z + (swinger.Axis == 'z' ? 4 : 24)), new Vector3(swinger.X, 7, swinger.Z - 3)),
        });
    }

    private double NearestRoom(Crane c)
    {
        double best = 999;
        foreach (var o in c.Near) best = Math.Min(best, CraneGeo.CraneGap(PartsOf(c), PartsOf(o)));
        return best;
    }
}
