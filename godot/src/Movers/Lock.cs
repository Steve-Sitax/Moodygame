using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// The lock of the Petit Bassin (the browser's world/lock.ts and shared/lockfit.ts, same numbers and the same
/// state machine): a lifting bridge over the chamber, two pairs of mitre gates, and a tug with a lighter or a
/// sailing barge that comes in from the river now and then, lies in the dock, and goes out again. A boat asks for
/// the lock 100 m off: the bridge goes up (never under Jef), the chamber is levelled with the boat's side by the
/// sluices, the near gates open, the boat comes in, the gates shut behind it, the chamber goes to the other side's
/// level, the far gates open. Round high water river and dock stand level and both pairs open. The chamber's
/// water is World/Tide.cs ChamberA and ChamberB (the boats and the sheet read them). The gates, their balance
/// beams and the bridge's leaves are solid as they stand.
/// </summary>
[GamePart(41)]
public partial class Lock : Node
{
    public static Lock I { get; private set; } = null!;

    private static readonly (float MinX, float MaxX, float MinZ, float MaxZ) Channel = (104, 116, 0, 46);
    public static readonly Bridges.Rect BridgeRect = new(102, 118, 14, 21);
    private const float Gz0 = 7, Gz1 = 42;
    private static readonly (double A, double B) Interval = (150, 330);
    private const float OpenBridge = -MathF.PI / 2, GateOpenAngle = 75 * MathF.PI / 180;
    private const float LevelWindow = 0.3f, Sluice = 0.25f;
    private const double Hold = 8, AskM = 100, HoldMax = 45, Speed = 1.6, TurnS = 14, TowLine = 9;
    private static readonly (double X, double Z)[] DefaultRoute = { (250, -27), (160, -27), (128, -26), (114, -16), (110, -6), (110, 10), (110, 30), (110, 46), (108, 55), (101, 63), (98, 74), (98, 94) };
    private static readonly string[][] Candidates =
    {
        new[] { "tug", "lighter_loaded" }, new[] { "tug", "lighter" }, new[] { "tug", "hengst" }, new[] { "tug", "rhine_barge" }, new[] { "paddle_tug", "lighter_loaded" },
        new[] { "paddle_tug", "rhine_barge" }, new[] { "tug" }, new[] { "paddle_tug" }, new[] { "hengst_sail" }, new[] { "sloop_sail" }, new[] { "schooner" },
    };

    // shared/lockfit.ts
    private const double HingeInset = 0.3, LeafThick = 0.4, LockMargin = 1.0, LockSideRoom = 0.6;
    private static readonly double Mitre = 15 * Math.PI / 180;
    private static readonly double HalfW = (116 - 104) / 2.0 - HingeInset;
    private static readonly double LeafLen = HalfW / Math.Cos(Mitre);
    private static readonly double MaxBeam = 116 - 104 - 2 * (HingeInset + LeafThick) - 2 * LockSideRoom;

    private static double SweepEnd(double beam)
    {
        double dx = Math.Max(0, HalfW - beam / 2), reach = LeafLen + LeafThick / 2;
        return Gz0 + (dx < reach ? Math.Sqrt(reach * reach - dx * dx) : 0);
    }

    private static (double From, double To, double Length) ChamberSpan(double beam)
    {
        double from = SweepEnd(beam) + LockMargin, to = Gz1 - LockMargin;
        return (from, to, Math.Max(0, to - from));
    }

    private sealed class Gate
    {
        public Node3D Obj = null!;
        public float Closed;
        public int Dir, Pair;
    }

    private sealed class Train
    {
        public string[] Names = Array.Empty<string>();
        public List<Boats.Float> Objs = new();
        public double[] Lens = Array.Empty<double>(), Offs = Array.Empty<double>();
        public double Rear, Beam;
        public bool Fits;
    }

    private Node3D group = null!;
    private DrawBridge? bridge;
    private readonly List<Gate> gates = new();
    private float bridgeAngle;
    private readonly float[] gateOpen = { 0, 0 };
    private readonly bool[] wantGate = new bool[2];
    private bool want, boatWant, inside;
    private float flat = Tide.DockY;
    private Spline curve = null!;
    private double LEN, sG0, sG1;
    private readonly List<(double S, double Z)> zAlong = new();
    private readonly Dictionary<string, Train> trains = new();
    private List<string[]> fitting = new();
    private Train? cur;
    private string state = "river"; // "river", "in", "dock", "out", "turn", "back"
    private double s, wait, held, turnT, lastV;
    private int dir = 1, backFace = 1;
    private string? mode; // "locked", "level"
    private Func<double> r = Mv.Rng(1811);
    private RopeLines lines = null!;
    private readonly List<Boats.Float> bakedBoats = new();

    public bool BridgeClosed => bridgeAngle > -0.01f;
    /// <summary>The bridge's lift, 0 down to 1 up.</summary>
    public float Lift => Mv.Smooth(bridgeAngle / OpenBridge);
    public float GateOpen(int pair) => gateOpen[pair];
    public float Flat => flat;
    public string State => state;
    /// <summary>A rowing boat wants the lock (or lets it go).</summary>
    public void Request(bool on) => boatWant = on;
    /// <summary>Anyone in the way of a gate's balance beam as it swings (the people's part sets it): the gate waits.</summary>
    public Func<int, bool>? SweepBusy;

    private static readonly DrawLeaf[] BridgeLeaves =
    {
        new(104, 17.5f, 0, 6, 3.5f, "draw_leaf_lock", "draw_beam_6", "draw_frame_lock"),
        new(116, 17.5f, MathF.PI, 6, 3.5f, "draw_leaf_lock", "draw_beam_6", "draw_frame_lock"),
    };

    /// <summary>Before the still world is made solid: the gates, the bridge's leaves and the boats move.</summary>
    public static void Claims()
    {
        var g = Mv.Top("lock");
        if (g == null) return;
        foreach (var l in BridgeLeaves)
            foreach (var n in DrawBridge.Find(g, l)) Mv.Claim(n);
        foreach (var c in g.GetChildren())
        {
            string n = Mv.Plain(c);
            if (n == "gate_leaf" || c is MeshInstance3D || (c is Node3D n3 && Mv.Kids(n3, n).Any())) Mv.Claim(c);
        }
    }

    public override void _Ready()
    {
        I = this;
        var g = Mv.Top("lock");
        if (g == null || Boats.I == null)
        {
            SetProcess(false);
            return;
        }
        group = g;
        foreach (var c in group.GetChildren())
            if (c is MeshInstance3D mi) mi.Visible = false; // the bake's chains and tow lines: drawn here now
        bridge = new DrawBridge(group, BridgeLeaves, "lock_bridge");
        lines = new RopeLines("lock_tow_lines", Boats.I.Rope);
        group.AddChild(lines);

        // the gates, in the order the browser made them: the river pair (west leaf, east leaf), the dock pair
        var leaves = Mv.Kids(group, "gate_leaf").ToList();
        foreach (var (pair, z) in new[] { (0, Gz0), (1, Gz1) })
            for (int side = 0; side < 2; side++)
            {
                float x = side == 0 ? Channel.MinX + 0.3f : Channel.MaxX - 0.3f;
                var o = leaves.FirstOrDefault(n => Math.Abs(n.Position.X - x) < 0.2f && Math.Abs(n.Position.Z - z) < 0.2f);
                if (o == null) continue;
                float closed = side == 0 ? -15 * MathF.PI / 180 : MathF.PI + 15 * MathF.PI / 180;
                gates.Add(new Gate { Obj = o, Closed = closed, Dir = side == 0 ? -1 : 1, Pair = pair });
                Mv.Body(o);
            }

        curve = new Spline(DefaultRoute);
        LEN = curve.Length;
        for (int i = 0; i <= 800; i++)
        {
            var p = curve.PointAt(i / 800.0);
            if (p.X > Channel.MinX && p.X < Channel.MaxX && p.Z > Channel.MinZ - 8 && p.Z < Channel.MaxZ + 8) zAlong.Add((i / 800.0 * LEN, p.Z));
        }
        sG0 = SAtZ(Gz0);
        sG1 = SAtZ(Gz1);

        foreach (var c in group.GetChildren())
            if (c is Node3D n && Boats.I.Of(n) is { } f)
            {
                f.Outer.Visible = false;
                bakedBoats.Add(f);
            }
        fitting = Candidates.Where(names => names.All(n => Boats.I.KindFor(n) != null) && Fit(names).Fits).ToList();
        wait = Interval.A * 0.3 + r() * Interval.A * 0.4;
        if (fitting.Count > 0)
        {
            cur = TrainFor(fitting[(int)Math.Floor(r() * fitting.Count)]);
            Show(cur);
            Place(cur!.Offs[^1], 1);
        }
        // Keep the initial train's baked hulls and dice; prepare the remaining variants before play.
        foreach (var names in fitting) TrainFor(names);
        ShowLock(1);
        GD.Print($"lock: {gates.Count} gate leaves, a bridge of {bridge.Leaves} leaves, {fitting.Count} kinds of tow fit the chamber ({string.Join(", ", fitting.Select(f => string.Join("+", f)))})");
        if (MoversTest.On) Probes();
    }

    private static double[] TrainOffsets(double[] lens)
    {
        var o = new double[lens.Length];
        double off = 0;
        for (int i = 0; i < lens.Length; i++)
        {
            if (i > 0) off += lens[i - 1] / 2 + TowLine + lens[i] / 2;
            o[i] = off;
        }
        return o;
    }

    private (bool Fits, double Length, double Beam) Fit(string[] names)
    {
        var lens = names.Select(n => (double)Boats.I.Dims(n).Length).ToArray();
        var offs = TrainOffsets(lens);
        double length = lens[0] / 2 + offs[^1] + lens[^1] / 2;
        double beam = names.Max(n => (double)Boats.I.Dims(n).Beam);
        return (beam <= MaxBeam && length <= ChamberSpan(beam).Length, length, beam);
    }

    private Train? TrainFor(string[] names)
    {
        string key = string.Join("+", names);
        if (trains.TryGetValue(key, out var t)) return t;
        var objs = new List<Boats.Float>();
        foreach (string n in names)
        {
            // the bake's frozen lock boats first, then copies (the model library takes over in Boats.Place)
            var f = bakedBoats.FirstOrDefault(b => b.Kind == n);
            if (f != null) bakedBoats.Remove(f);
            else f = Boats.I.Place(n, group, prepared:true);
            if (f == null) return null;
            f.Outer.Visible = false;
            objs.Add(f);
        }
        var lens = names.Select(n => (double)Boats.I.Dims(n).Length).ToArray();
        var offs = TrainOffsets(lens);
        var fit = Fit(names);
        t = new Train { Names = names, Objs = objs, Lens = lens, Offs = offs, Rear = offs[^1] + lens[^1] / 2, Beam = fit.Beam, Fits = fit.Fits };
        trains[key] = t;
        return t;
    }

    private void Show(Train? t)
    {
        foreach (var tr in trains.Values)
            foreach (var o in tr.Objs)
            {
                o.Outer.Visible = tr == t;
                if (tr == t) Boats.I.Activate(o);
            }
    }

    /// <summary>Route position where the route crosses z in the channel.</summary>
    private double SAtZ(double z)
    {
        for (int i = 1; i < zAlong.Count; i++)
        {
            var (s0, z0) = zAlong[i - 1];
            var (s1, z1) = zAlong[i];
            if ((z0 - z) * (z1 - z) <= 0 && z1 != z0) return s0 + (z - z0) / (z1 - z0) * (s1 - s0);
        }
        if (zAlong.Count == 0) return 0;
        return z <= zAlong[0].Z ? zAlong[0].S : zAlong[^1].S;
    }

    /// <summary>Put the lead at route position sLead, the others behind it, all facing `face` (+1 dock, -1 river); `yaw` turns a lone boat.</summary>
    private void Place(double sLead, int face, double yaw = 0)
    {
        var t = cur;
        if (t == null) return;
        lines.Clear();
        for (int i = 0; i < t.Objs.Count; i++)
        {
            double u = Mv.Clamp((sLead - face * t.Offs[i]) / LEN, 0, 1);
            var pt = curve.PointAt(u);
            var tg = curve.TangentAt(u);
            var o = t.Objs[i].Outer;
            o.Position = new Vector3((float)pt.X, Tide.LevelAt((float)pt.X, (float)pt.Z), (float)pt.Z);
            o.Rotation = new Vector3(0, (float)(Math.Atan2(tg.X * face, tg.Z * face) + yaw), 0);
        }
        for (int i = 0; i + 1 < t.Objs.Count; i++)
        {
            Node3D a0 = t.Objs[i].Outer, b0 = t.Objs[i + 1].Outer;
            float ta = a0.Rotation.Y, wa = b0.Rotation.Y;
            float la = (float)(t.Lens[i] / 2 - 1.5), lb = (float)(t.Lens[i + 1] / 2 - 0.5);
            var a = new Vector3(a0.Position.X - MathF.Sin(ta) * la, a0.Position.Y + 1.3f, a0.Position.Z - MathF.Cos(ta) * la);
            var c = new Vector3(b0.Position.X + MathF.Sin(wa) * lb, b0.Position.Y + 1.1f, b0.Position.Z + MathF.Cos(wa) * lb);
            var m = a.Lerp(c, 0.5f);
            m.Y = Math.Min(a.Y, c.Y) - 0.7f;
            lines.Add(a, m);
            lines.Add(m, c);
        }
        lines.Commit();
    }

    private double TailOff => cur?.Offs[^1] ?? 0;

    /// <summary>Set off: "in" from the river with a new boat, "out" from the dock with the one lying there.</summary>
    public void Start(string d, string[]? names = null)
    {
        if (state is "in" or "out" or "turn" or "back") return;
        if (d == "in" || names != null || (cur != null && !cur.Fits))
        {
            var pick = names ?? (fitting.Count > 0 ? fitting[(int)Math.Floor(r() * fitting.Count)] : null);
            var t = pick != null ? TrainFor(pick) : null;
            if (t == null) return;
            cur = t;
            Show(cur);
        }
        if (cur == null) return;
        dir = d == "in" ? 1 : -1;
        s = d == "in" ? TailOff : LEN - TailOff;
        state = d;
        want = false;
        mode = null;
        inside = false;
        held = 0;
    }

    private void TurnAway()
    {
        want = false;
        mode = null;
        state = cur != null && cur.Objs.Count == 1 ? "turn" : "back";
        backFace = dir;
        turnT = 0;
    }

    /// <summary>The chamber's water (each end follows its open pair), and the bridge and the gates as they stand.</summary>
    private void ShowLock(double dt)
    {
        float endA = gateOpen[0] > 0.02f ? Tide.River : flat, endB = gateOpen[1] > 0.02f ? Tide.Dock : flat;
        float k = (float)Math.Min(1, dt * 2);
        Tide.ChamberA += (endA - Tide.ChamberA) * k;
        Tide.ChamberB += (endB - Tide.ChamberB) * k;
        bridge?.Set(Mv.Smooth(bridgeAngle / OpenBridge));
        foreach (var gt in gates)
            gt.Obj.Rotation = new Vector3(0, gt.Closed + gt.Dir * GateOpenAngle * Mv.Smooth(gateOpen[gt.Pair]), 0);
    }

    private float SideLevel(int i) => i == 0 ? Tide.River : Tide.Dock;

    public override void _Process(double delta)
    {
        MoverCost.Begin("lock");
        Step(MoverClock.Dt);
        MoverCost.End("lock");
    }

    private void Step(double dt)
    {
        var jef = Jef.I;
        bool occupied = jef != null && BridgeRect.Has(jef.X, jef.Z);
        if (!occupied)
            foreach (var b in Bridges.Busy)
                if (b(BridgeRect))
                {
                    occupied = true;
                    break;
                }
        const float bridgeSpeed = 0.07f, gateSpeed = 0.05f;
        float ease = 0.25f + 0.75f * MathF.Sin(MathF.PI * Mv.Clamp01(bridgeAngle / OpenBridge));
        wantGate[0] = wantGate[1] = false;
        int target = -1;
        int near = dir > 0 ? 0 : 1;
        bool levelGo = want && mode == "level";
        if (levelGo) wantGate[0] = wantGate[1] = true;
        else if (want)
        {
            target = inside ? (near == 0 ? 1 : 0) : near;
            wantGate[target] = true;
        }
        else if (boatWant)
        {
            target = PlayerTarget(Math.Abs(flat - Tide.River) < Math.Abs(flat - Tide.Dock) ? 0 : 1);
            wantGate[target] = true;
        }
        if (want || boatWant)
        {
            if (bridgeAngle > OpenBridge && (bridgeAngle < -0.001f || !occupied)) bridgeAngle = Math.Max(OpenBridge, bridgeAngle - bridgeSpeed * ease * (float)dt);
        }
        else if (gateOpen[0] < 0.3f && gateOpen[1] < 0.3f) bridgeAngle = Math.Min(0, bridgeAngle + bridgeSpeed * ease * (float)dt);
        bool bridgeUp = bridgeAngle < -0.3f;
        for (int i = 0; i < 2; i++)
        {
            int other = i == 0 ? 1 : 0;
            bool level = levelGo || Math.Abs(flat - SideLevel(i)) < 0.04f;
            bool mayOpen = wantGate[i] && bridgeUp && (levelGo || gateOpen[other] < 0.01f) && level;
            bool moving = (mayOpen && gateOpen[i] < 1) || (!wantGate[i] && gateOpen[i] > 0);
            if (moving && SweepBusy != null && SweepBusy(i)) continue;
            if (mayOpen) gateOpen[i] = Math.Min(1, gateOpen[i] + gateSpeed * (float)dt);
            else if (!wantGate[i]) gateOpen[i] = Math.Max(0, gateOpen[i] - gateSpeed * (float)dt);
        }
        if (gateOpen[0] > 0.02f && gateOpen[1] > 0.02f) flat = (Tide.River + Tide.Dock) / 2;
        else if (gateOpen[0] > 0.02f) flat = Tide.River;
        else if (gateOpen[1] > 0.02f) flat = Tide.Dock;
        else if (target >= 0 || levelGo)
        {
            float to = SideLevel(Math.Max(0, target));
            flat += Math.Clamp(to - flat, -Sluice * (float)dt, Sluice * (float)dt);
        }
        ShowLock(dt);

        var t = cur;
        if (t == null) return;
        if (state is "river" or "dock")
        {
            wait -= dt;
            var cam = Main.I.Cam?.GlobalPosition ?? new Vector3(1e6f, 0, 0);
            bool seen = state == "dock" && cam.DistanceTo(new Vector3(98, cam.Y, 94)) < 45;
            if (wait <= 0 && !seen && !boatWant) Start(state == "river" ? "in" : "out");
            else if (state == "dock") Place(LEN, 1);
            else Place(TailOff, 1);
            if (state is "river" or "dock") return;
            t = cur!;
        }
        if (state == "turn")
        {
            turnT += dt;
            Place(s, backFace, Math.PI * Mv.Smooth((float)(turnT / TurnS)));
            lastV = 0.3;
            if (turnT >= TurnS)
            {
                state = "back";
                backFace = -dir;
            }
            return;
        }
        if (state == "back")
        {
            double vb = backFace == dir ? 0.8 : Speed; // a tow goes astern, slowly
            s -= dir * vb * dt;
            lastV = vb;
            Place(s, backFace);
            if ((dir > 0 && s <= TailOff) || (dir < 0 && s >= LEN - TailOff))
            {
                state = dir > 0 ? "river" : "dock";
                s = dir > 0 ? TailOff : LEN;
                wait = Interval.A + r() * (Interval.B - Interval.A);
                Place(s, 1);
            }
            return;
        }

        double bow = s + dir * (t.Lens[0] / 2), stern = s - dir * t.Rear;
        double nearGate = dir > 0 ? sG0 : sG1, farGate = dir > 0 ? sG1 : sG0;
        var span = ChamberSpan(t.Beam);
        double spanFrom = SAtZ(span.From), spanTo = SAtZ(span.To);
        double holdAt = nearGate - dir * Hold; // the bow waits here till the gates stand open
        double stopAt = dir > 0 ? spanTo : spanFrom; // locked through: the bow stops here till the far pair opens
        double toHold = dir > 0 ? holdAt - bow : bow - holdAt;
        bool pastNear = toHold < -0.5;
        if (!want && !pastNear && toHold < AskM)
        {
            if (!t.Fits)
            {
                TurnAway();
                return;
            }
            want = true;
            SoundSignal(t);
            mode = Math.Abs(Tide.River - Tide.Dock) < LevelWindow ? "level" : "locked";
        }
        bool nearOpen = bridgeAngle <= OpenBridge + 0.02f && (mode == "level" ? gateOpen[0] >= 0.98f && gateOpen[1] >= 0.98f : gateOpen[near] >= 0.98f);
        bool farOpen = gateOpen[near == 0 ? 1 : 0] >= 0.98f;
        double v = Speed;
        if (!pastNear && !nearOpen)
        {
            if (dir < 0 && gateOpen[near] < 0.05f && Math.Abs(s - (LEN - TailOff)) < 0.5) v = 0;
            else v = Mv.Clamp(Math.Max(0, toHold) * 0.3, 0, Speed);
        }
        if (pastNear && mode == "locked" && !farOpen)
        {
            double room = dir > 0 ? stopAt - bow : bow - stopAt;
            v = Math.Min(v, Mv.Clamp(room * 0.3, 0, Speed));
        }
        double fromEnd = Math.Min(s, LEN - s);
        v *= Mv.Clamp(0.25 + fromEnd / 20, 0.25, 1);
        double lo = dir > 0 ? TailOff : 0, hi = dir > 0 ? LEN : LEN - TailOff;
        s = Mv.Clamp(s + dir * v * dt, lo, hi);
        lastV = v;
        bool atBerth = dir < 0 && Math.Abs(s - hi) < 0.5;
        if (!pastNear && v < 0.2 && !atBerth)
        {
            held += dt;
            if (held > HoldMax)
            {
                TurnAway();
                return;
            }
        }
        else held = 0;
        if (want && mode == "locked" && !inside && (dir > 0 ? stern >= spanFrom : stern <= spanTo)) inside = true;
        bool clear = dir > 0 ? stern > farGate + Hold : stern < farGate - 3;
        if (clear && want)
        {
            want = false;
            mode = null;
        }
        Place(s, dir);
        if ((dir > 0 && s >= LEN) || (dir < 0 && s <= 0))
        {
            state = dir > 0 ? "dock" : "river";
            wait = Interval.A + r() * (Interval.B - Interval.A);
            want = false;
            mode = null;
        }
    }

    /// <summary>The self-test: a boat lies in the dock and goes out now (the way in from the river end takes minutes).</summary>
    public void OutNow()
    {
        if (cur == null) return;
        state = "dock";
        Place(LEN, 1);
        Start("out");
    }

    private void Probes()
    {
        string Note() => $"{state}, the bridge {Lift * 100:0} % up, river gates {gateOpen[0] * 100:0} %, dock gates {gateOpen[1] * 100:0} % open, chamber {flat:0.00}, river {Tide.River:0.00}, dock {Tide.Dock:0.00}, the boat at {s:0} m of {LEN:0}";
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "lock_bridge",
            Hour = 14,
            Gap = 3,
            MaxWait = 60,
            Start = () => {bridgeAngle=0; bridge?.Set(0); gateOpen[0]=gateOpen[1]=0; flat=Tide.Dock; want=boatWant=inside=false; mode=null; OutNow();},
            Ready = () => Lift > 0.2f,
            Where = () => (bridge!.Nose, bridgeAngle, Note()),
            View = () => (new Vector3(126, 7, 4), new Vector3(110, 4, 17.5f)),
        });
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "lock_gates",
            Hour = 14,
            Gap = 4,
            MaxWait = 90,
            Ready = () => gateOpen[1] > 0.1f && gateOpen[1] < 0.75f,
            Where = () => (gates.Count > 3 ? gates[2].Obj.GlobalTransform * new Vector3(5, 0, 0) : Vector3.Zero, gateOpen[1], Note()),
            View = () => (new Vector3(119.5f, 5.5f, 30), new Vector3(110, -0.5f, 42)),
        });
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "lock_boat",
            Hour = 14,
            Gap = 4,
            MaxWait = 120,
            Ready = () => state == "out" && lastV > 0.5 && cur != null && cur.Objs[0].Outer.Position.Z < 60,
            Where = () => (cur?.Objs[0].Outer.GlobalPosition ?? Vector3.Zero, s, Note()),
            View = () => ((cur?.Objs[0].Outer.GlobalPosition ?? Vector3.Zero) + new Vector3(15, 8, -18), (cur?.Objs[0].Outer.GlobalPosition ?? Vector3.Zero) + Vector3.Up * 2),
        });
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "lock_chamber_water",
            Hour = 14,
            Gap = 4,
            MaxWait = 240,
            MinMove = 0.2,
            Ready = () => inside && gateOpen[0] < 0.01f && gateOpen[1] < 0.01f && Math.Abs(flat - Tide.River) > 0.6f && Math.Abs(flat - Tide.Dock) > 0.4f,
            Where = () => (new Vector3(110, (Tide.ChamberA + Tide.ChamberB) / 2, 25), flat, Note()),
            View = () => (new Vector3(119.5f, 4.5f, 6), new Vector3(110, -2, 27)),
        });
    }
}
