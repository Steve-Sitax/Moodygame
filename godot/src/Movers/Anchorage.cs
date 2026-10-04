using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// The ocean steamer at anchor in the Schelde and the lighters that work her cargo (the browser's
/// world/anchorage.ts, same loop, stops and numbers). She rides to her anchor beyond the fairway and sheers a few
/// degrees about her hawse. Two tugs each work a loaded lighter "on the hip" round a fixed loop: alongside her,
/// then in to a berth on the Rijnkaai (the tug walks the lighter in sideways against the wall, and out again),
/// and back. Before they cross a lane they wait until no ship on it will be over their crossing; after a while
/// they take the right of way and the ships stop for them (River reads Obstacles).
/// Not ported yet: stopping for rowing boats (the rowing part is not ported), and the watchdog that makes a tow
/// back off astern when it and a ship have waited on each other for over a minute.
/// </summary>
public sealed class Anchorage
{
    private static readonly (double X, double Z, double Yaw) LinerAt0 = (0, -140, -Math.PI / 2);
    private static readonly (double A, double P, double Ph)[] Sheer = { (0.075, 190, 0.7), (0.03, 71, 2.1) };
    private static readonly (double X, double Z)[] Loop =
    {
        (-25, -128.8), (-5, -130.8), (14, -130.8), (33, -130.8), (52, -129.5), (67, -122), (74.5, -107), (76, -80), (76, -50), (74.5, -33),
        (70, -22), (62, -15), (52, -13), (40, -13), (35, -13), (28, -13), (21, -13), (14.5, -17), (10.5, -23.5), (6.5, -31),
        (5.5, -38), (4.5, -46), (-1, -57), (-12, -67), (-26, -82), (-40, -98), (-52, -111), (-62, -119), (-60, -126), (-46, -128.5),
    };
    private static readonly (double X, double Z) StopA = (14, -130.8), StopQ = (28, -13);
    private const double CrabM = 9.9, CrabT = 40;
    private static readonly (double A, double B) DwellA = (100, 160), DwellQ = (80, 140);
    private const double Cruise = 1.8, Lash = 0.4, Strip = 11, PaceS = 16, PaceMin = 0.5, MergeGap = 30, Accel = 0.12, Brake = 0.35;
    private const double RelaxS = 20, YieldM = 28, WatchdogS = 60, BerthWaitMax = 420, HoldAhead = 22, Keep = 25;
    private static readonly (string Lane, double Z, double XMin)[] LaneZ = { ("up", -84, double.NegativeInfinity), ("down", -100, double.NegativeInfinity), ("near", -36, -55) };

    public struct Obstacle
    {
        public double X, Z, Yaw, Len, Beam, V;
        public bool Soft;
    }

    private sealed class StripT
    {
        public string Lane = "";
        public double S0, S1, X, Z, Ax, Az = 1;
    }

    private sealed class Zone
    {
        public double S0, S1;
        public List<StripT> Strips = new();
    }

    public sealed class Tow
    {
        public TrainPart Lighter = null!, Tug = null!;
        public double Lb, Tb, Width, Len, TugOff, S, V, Dwell, Crab, Waited;
        public int Stop, Committed = -1;
        /// <summary>"run", "in" (walking in to the wall), "dwell", "out".</summary>
        public string Phase = "dwell";
        public string Why = "";
    }

    public readonly Boats.Float Liner = null!;
    public readonly List<Tow> Tows = new();
    public readonly List<Obstacle> Obstacles = new();

    private readonly double hx, hz, Hx, Hz;
    private double sheer;
    private readonly Spline curve;
    private readonly double LEN;
    private readonly int N;
    private readonly (double X, double Z)[] pts;
    private readonly double[] stops;
    private readonly List<Zone> zones = new();
    private readonly Func<double> r;
    private readonly RopeLines lash;
    private readonly bool ok;

    public Anchorage(Node3D group, List<Boats.Float> baked, uint seed)
    {
        r = Mv.Rng(seed ^ 0x51ed);
        curve = new Spline(Loop, true);
        LEN = curve.Length;
        N = (int)Math.Ceiling(LEN);
        pts = new (double, double)[N + 1];
        for (int i = 0; i <= N; i++) pts[i] = curve.PointAt(i / (double)N);
        stops = new[] { SAt(StopA.X, StopA.Z), SAt(StopQ.X, StopQ.Z) };
        lash = new RopeLines("anchorage_lashings", Boats.I.Rope);
        group.AddChild(lash);

        Boats.Float? Next(string kind)
        {
            var f = baked.FirstOrDefault(b => b.Kind == kind);
            if (f != null) baked.Remove(f);
            else f = Boats.I.Place(kind, group);
            return f;
        }
        var liner = Next("liner");
        if (liner == null) return;
        Liner = liner;
        var d = Boats.I.Dims("liner");
        // the hawse: from the model (Blender x, y, z -> local x, z = -y), else the stem
        hx = 0;
        hz = d.Length / 2 - 3;
        if (liner.Inner.HasMeta("extras") && liner.Inner.GetMeta("extras").AsGodotDictionary().TryGetValue("hawse", out var raw))
        {
            try
            {
                var h = JsonSerializer.Deserialize<double[]>(raw.AsString());
                if (h is { Length: >= 2 })
                {
                    hx = h[0];
                    hz = -h[1];
                }
            }
            catch (JsonException) { /* keep the stem */ }
        }
        double cy = Math.Cos(LinerAt0.Yaw), sy = Math.Sin(LinerAt0.Yaw);
        Hx = LinerAt0.X + hx * cy + hz * sy;
        Hz = LinerAt0.Z - hx * sy + hz * cy;

        // lane crossings: runs of the loop inside each lane's strip, merged into one zone when too close to stop between
        var strips = new List<StripT>();
        foreach (var ln in LaneZ)
        {
            StripT? cur = null;
            double xs = 0;
            int n = 0;
            for (int i = 0; i <= N; i++)
            {
                var p = pts[i % N];
                bool inside = Math.Abs(p.Z - ln.Z) < Strip && p.X > ln.XMin;
                double s = i / (double)N * LEN;
                if (inside)
                {
                    cur ??= new StripT { Lane = ln.Lane, S0 = s, S1 = s, Z = ln.Z };
                    cur.S1 = s;
                    xs += p.X;
                    n++;
                }
                else if (cur != null)
                {
                    cur.X = xs / n;
                    strips.Add(cur);
                    cur = null;
                    xs = n = 0;
                }
            }
            if (cur != null)
            {
                cur.X = xs / n;
                strips.Add(cur);
            }
        }
        strips.Sort((a, b) => a.S0.CompareTo(b.S0));
        foreach (var st in strips)
        {
            var t = curve.TangentAt(Wrap((st.S0 + st.S1) / 2) / LEN);
            st.Ax = Math.Abs(t.X);
            st.Az = Math.Abs(t.Z);
            var last = zones.Count > 0 ? zones[^1] : null;
            if (last != null && st.S0 - last.S1 < MergeGap)
            {
                last.S1 = Math.Max(last.S1, st.S1);
                last.Strips.Add(st);
            }
            else zones.Add(new Zone { S0 = st.S0, S1 = st.S1, Strips = { st } });
        }

        // the tows: one waits at the liner, the other against the quay, part way through its wait
        var sets = new[] { ("tug", "lighter_loaded"), ("paddle_tug", "lighter_loaded") };
        for (int i = 0; i < sets.Length; i++)
        {
            var (tugName, lighterName) = sets[i];
            var tug = Next(tugName);
            var lighter = Next(lighterName);
            if (tug == null || lighter == null) continue;
            double tb = Boats.I.Dims(tugName).Beam, lb = Boats.I.Dims(lighterName).Beam;
            double tl = Boats.I.Dims(tugName).Length, ll = Boats.I.Dims(lighterName).Length;
            bool atQuay = i == 1;
            var (d0, d1) = atQuay ? DwellQ : DwellA;
            Tows.Add(new Tow
            {
                Lighter = new TrainPart { Boat = lighter, Len = ll }, Tug = new TrainPart { Boat = tug, Len = tl },
                Lb = lb, Tb = tb, Width = lb + Lash + tb, Len = Math.Max(tl, ll), TugOff = -(lb / 2 + Lash + tb / 2),
                S = stops[atQuay ? 1 : 0], Stop = atQuay ? 1 : 0, Phase = "dwell",
                Dwell = (d0 + r() * (d1 - d0)) * (0.3 + 0.5 * r()), Crab = atQuay ? 1 : 0,
            });
        }
        ok = true;
        PlaceLiner(0);
        PlaceTows();
    }

    private double SAt(double px, double pz)
    {
        int best = 0;
        double bd = double.MaxValue;
        for (int i = 0; i < N; i++)
        {
            double dd = (pts[i].X - px) * (pts[i].X - px) + (pts[i].Z - pz) * (pts[i].Z - pz);
            if (dd < bd)
            {
                bd = dd;
                best = i;
            }
        }
        return best / (double)N * LEN;
    }

    private double Wrap(double s) => (s % LEN + LEN) % LEN;
    /// <summary>Distance along the loop from a to b, going forward.</summary>
    private double Ahead(double a, double b) => Wrap(b - a);
    private static double Smooth(double e0, double e1, double x)
    {
        double k = Mv.Clamp((x - e0) / (e1 - e0), 0, 1);
        return k * k * (3 - 2 * k);
    }

    private double Reach(Tow tow, StripT st) => tow.Len / 2 * st.Ax + tow.Width / 2 * st.Az + 3;

    /// <summary>Near the liner the loop turns with her: full weight alongside, fading over 40 m.</summary>
    private double Weight(double s)
    {
        double lo = Wrap(stops[0] - 45);
        const double W = 80;
        if (Ahead(lo, s) <= W) return 1;
        double off = Math.Min(Ahead(s, lo), Ahead(Wrap(lo + W), s));
        return 1 - Smooth(0, 40, off);
    }

    private void PlaceLiner(double t)
    {
        sheer = 0;
        foreach (var (a, p, ph) in Sheer) sheer += a * Math.Sin(2 * Math.PI * t / p + ph);
        double yaw = LinerAt0.Yaw + sheer, c = Math.Cos(yaw), s = Math.Sin(yaw);
        // the middle is the hawse minus the rotated hawse offset
        Liner.Outer.Position = new Vector3((float)(Hx - (hx * c + hz * s)), Tide.River, (float)(Hz - (-hx * s + hz * c)));
        Liner.Outer.Rotation = new Vector3(0, (float)yaw, 0);
    }

    private (double Lx, double Lz, double Tx, double Tz, double Yaw) TowPose(Tow tow, double s, double crab, double turn)
    {
        double u = Wrap(s) / LEN;
        var p = curve.PointAt(u);
        var tg = curve.TangentAt(u);
        double yaw = Math.Atan2(tg.X, tg.Z);
        // sideways: the heading turned by +90 degrees (toward the quay at Q, toward the liner at A)
        double nx = Math.Cos(yaw), nz = -Math.Sin(yaw), side = crab * CrabM;
        double lx = p.X + nx * side, lz = p.Z + nz * side;
        double tx = lx + nx * tow.TugOff, tz = lz + nz * tow.TugOff;
        yaw += turn;
        double w = Weight(Wrap(s));
        if (w > 0)
        {
            double a = w * sheer, c = Math.Cos(a), sn = Math.Sin(a);
            (lx, lz) = (Hx + (lx - Hx) * c + (lz - Hz) * sn, Hz - (lx - Hx) * sn + (lz - Hz) * c);
            (tx, tz) = (Hx + (tx - Hx) * c + (tz - Hz) * sn, Hz - (tx - Hx) * sn + (tz - Hz) * c);
            yaw += a;
        }
        return (lx, lz, tx, tz, yaw);
    }

    /// <summary>Seconds for a tow now at speed v to go d metres (speeding up to Cruise on the way).</summary>
    private static double Eta(double dist, double v)
    {
        double up = Math.Max(0, Cruise - v) / Accel;
        double dUp = (v + Cruise) / 2 * up;
        return dist <= dUp ? dist / Math.Max(0.3, (v + Cruise) / 2) : up + (dist - dUp) / Cruise;
    }

    /// <summary>Can the tow cross zone z now? level 0: the strict rule; 1: the right of way (after RelaxS); 2: after WatchdogS, ships nearer still must stop.</summary>
    private bool Clear(Tow tow, Zone z, List<River.Mover> traffic, int level)
    {
        bool relaxed = level > 0;
        double yieldM = level > 1 ? YieldM / 2 : YieldM;
        double late = level > 1 ? 0 : 2;
        double half = tow.Len / 2;
        foreach (var st in z.Strips)
        {
            double pad = Math.Max(tow.Width / 2 + 6, Reach(tow, st));
            double tIn = Eta(Math.Max(0, Ahead(tow.S, st.S0) - half - 6), tow.V) - 3;
            double tOut = Eta(Ahead(tow.S, st.S1) + half, tow.V) + 6;
            foreach (var m in traffic)
            {
                if (m.Lane != st.Lane) continue;
                double a = m.X + m.Hx * (m.Parts[0].Len / 2 + 2); // its bow
                double b = m.X - m.Hx * m.Len;
                double lo = Math.Min(a, b), hi = Math.Max(a, b);
                if (relaxed)
                {
                    if (m.V < 0.2)
                    {
                        if (hi > st.X - pad - 3 && lo < st.X + pad + 3) return false;
                        continue;
                    }
                    double u = m.Hx * Math.Max(m.Speed, m.V);
                    double ta = (st.X - pad - hi) / u, tb = (st.X + pad - lo) / u;
                    double t1 = Math.Min(ta, tb), t2 = Math.Max(ta, tb);
                    bool meets = t2 > Math.Max(0, tIn - 2) && t1 < tOut;
                    bool stopsFor = t1 >= tIn + late && (t1 - tIn) * Math.Abs(u) >= yieldM;
                    double dist = Math.Max(0, Ahead(tow.S, st.S0) - half - 6);
                    bool eases = t2 < tIn + PaceS && t2 + 3 <= dist / PaceMin;
                    if (meets && !stopsFor && !eases) return false;
                    continue;
                }
                double uu = m.Hx * Math.Max(m.Speed, m.V);
                if (Math.Abs(uu) < 0.05)
                {
                    if (hi > st.X - pad && lo < st.X + pad) return false;
                    continue;
                }
                double s1 = double.PositiveInfinity, s2 = double.NegativeInfinity;
                for (double k = 1; k >= 0.5; k -= 0.5)
                {
                    double ta = (st.X - pad - hi) / (uu * k), tb = (st.X + pad - lo) / (uu * k);
                    s1 = Math.Min(s1, Math.Min(ta, tb));
                    s2 = Math.Max(s2, Math.Max(ta, tb));
                }
                if (s2 > 0 && s1 < tOut && s2 > tIn) return false;
            }
        }
        return true;
    }

    private void Leave(Tow tow)
    {
        tow.Phase = "run";
        tow.Dwell = 0;
        tow.Crab = 0;
        tow.Stop = tow.Stop == 0 ? 1 : 0;
    }

    /// <summary>Room on the far side of a zone: stopped Keep m off the other tow's stern, this one must be clear of the zone.</summary>
    private bool RoomFor(Tow tow, Zone z)
    {
        foreach (var o in Tows)
        {
            if (o == tow) continue;
            if (Ahead(tow.S, Wrap(o.S - o.Len / 2)) < Ahead(tow.S, z.S1) + tow.Len * 1.5 + Keep + 8) return false;
        }
        return true;
    }

    private int NextZone(Tow tow)
    {
        int best = 0;
        for (int i = 1; i < zones.Count; i++)
            if (Ahead(tow.S, zones[i].S0) < Ahead(tow.S, zones[best].S0)) best = i;
        return best;
    }

    /// <summary>A committed tow's speed so that it comes into each lane only after a ship too near to stop is through.</summary>
    private double Pace(Tow tow, Zone z, List<River.Mover> traffic)
    {
        double best = double.PositiveInfinity, half = tow.Len / 2;
        foreach (var st in z.Strips)
        {
            double dist = Ahead(tow.S, st.S0) - half - 6;
            if (dist <= 0 || dist > 200) continue;
            double pad = Math.Max(tow.Width / 2 + 6, Reach(tow, st));
            foreach (var m in traffic)
            {
                if (m.Lane != st.Lane || m.V < 0.2) continue;
                double bow = m.X + m.Hx * (m.Parts[0].Len / 2 + 2), stern = m.X - m.Hx * m.Len;
                double lo = Math.Min(bow, stern), hi = Math.Max(bow, stern);
                double u = m.Hx * m.V;
                double t1 = Math.Min((st.X - pad - hi) / u, (st.X + pad - lo) / u);
                double t2 = Math.Max((st.X - pad - hi) / u, (st.X + pad - lo) / u);
                if (t2 <= 0) continue;
                if (t1 > 0 && t1 * Math.Abs(u) > YieldM) continue;
                best = Math.Min(best, Math.Max(PaceMin, dist / (t2 + 3)));
            }
        }
        return best;
    }

    public void Update(double t, double dt, List<River.Mover> traffic)
    {
        if (!ok) return;
        PlaceLiner(t);
        foreach (var tow in Tows)
        {
            tow.Why = "";
            // at a stop: in to the wall (Q), wait, out again, then off to the other stop
            if (tow.Phase != "run")
            {
                tow.V = 0;
                tow.Waited = 0;
                tow.Why = tow.Stop == 0 ? "alongside the liner" : "at the quay";
                if (tow.Phase == "in")
                {
                    tow.Crab = Math.Min(1, tow.Crab + dt / CrabT);
                    if (tow.Crab >= 1)
                    {
                        tow.Phase = "dwell";
                        tow.Dwell = DwellQ.A + r() * (DwellQ.B - DwellQ.A);
                    }
                }
                else if (tow.Phase == "dwell")
                {
                    tow.Dwell -= dt;
                    if (tow.Dwell <= 0 && tow.Stop == 0 && tow.Dwell > -BerthWaitMax && zones.Count > 0 && !RoomFor(tow, zones[NextZone(tow)]))
                        tow.Why = "alongside the liner (the quay berth is taken)";
                    else if (tow.Dwell <= 0)
                    {
                        if (tow.Stop == 1) tow.Phase = "out";
                        else Leave(tow);
                    }
                }
                else
                {
                    tow.Crab = Math.Max(0, tow.Crab - dt / CrabT);
                    if (tow.Crab <= 0) Leave(tow);
                }
                continue;
            }
            double target = Cruise;
            double sStop = stops[tow.Stop];
            double toStop = Ahead(tow.S, sStop);
            int level = tow.Waited > WatchdogS ? 2 : tow.Waited > RelaxS ? 1 : 0;
            // brake for the stop ahead (a crawl for the last metre)
            if (toStop < 60) target = Math.Min(target, Math.Sqrt(2 * 0.05 * Math.Max(0, toStop - 0.2)) + 0.08);
            // lanes: decide at the last braking point whether to cross; wait at the edge until the lanes are clear
            for (int zi = 0; zi < zones.Count; zi++)
            {
                var z = zones[zi];
                double toZone = Ahead(tow.S, z.S0);
                bool inZone = Ahead(z.S0, tow.S) <= z.S1 - z.S0 + tow.Len;
                if (inZone) continue;
                if (tow.Committed == zi)
                {
                    if (toZone > 60 || (tow.V < 0.2 && toZone > 2)) tow.Committed = -1;
                    else continue;
                }
                double hold = tow.Len / 2 + 12;
                double decide = tow.V * tow.V / (2 * 0.08) + hold + 2;
                if (toZone > decide + 2) continue;
                bool room = RoomFor(tow, z);
                if (room && Clear(tow, z, traffic, level)) tow.Committed = zi;
                else
                {
                    target = Math.Min(target, Math.Sqrt(2 * 0.08 * Math.Max(0, toZone - hold)));
                    tow.Why = room ? "waits for the fairway" : "waits for room";
                }
            }
            // committed: ease in behind a ship that is still going through a lane ahead
            if (tow.Committed >= 0)
            {
                double p = Pace(tow, zones[tow.Committed], traffic);
                if (p < target)
                {
                    target = p;
                    tow.Why = "lets a ship through";
                }
            }
            // the other tow ahead on the loop: keep Keep m off its stern
            foreach (var o in Tows)
            {
                if (o == tow) continue;
                double gap = Ahead(tow.S, o.S) - o.Len / 2 - tow.Len / 2;
                if (gap < 80)
                {
                    double v = Math.Max(0, (gap - Keep) * 0.06);
                    if (v < target)
                    {
                        target = v;
                        if (v < 0.3) tow.Why = "keeps off the other tow";
                    }
                }
            }
            // a ship under way coming across its bow (not once it has decided to cross a lane)
            var head = tow.Lighter.Boat.Outer;
            double fx = Math.Sin(head.Rotation.Y), fz = Math.Cos(head.Rotation.Y);
            bool crossing = tow.Committed >= 0 || Crossing(tow) >= 0;
            if (!crossing)
                foreach (var m in traffic)
                {
                    if (m.V < 0.3) continue;
                    double best = double.PositiveInfinity, bestAlong = 0;
                    for (double k = 0; k <= 1.0001; k += 0.25)
                    {
                        double dx = m.X - m.Hx * m.Len * k - head.Position.X, dz = m.Z - m.Hz * m.Len * k - head.Position.Z;
                        double along = dx * fx + dz * fz, side = Math.Abs(dx * fz - dz * fx);
                        if (along > 0 && side < best)
                        {
                            best = side;
                            bestAlong = along;
                        }
                    }
                    if (double.IsPositiveInfinity(best)) continue;
                    if (bestAlong < 60 && best < (tow.Width + m.Beam) / 2 + 12)
                    {
                        target = Math.Min(target, Math.Max(0, (bestAlong - 30) * 0.06));
                        tow.Why = "gives way";
                    }
                }
            tow.V += Mv.Clamp(target - tow.V, -Brake * dt, Accel * dt);
            tow.V = Math.Max(0, tow.V);
            tow.Waited = tow.V < 0.05 ? tow.Waited + dt : Math.Max(0, tow.Waited - dt * 2);
            if (tow.Waited > WatchdogS && tow.Why == "waits for room")
                foreach (var o in Tows)
                    if (o != tow && o.Phase == "run") o.Waited = Math.Max(o.Waited, RelaxS + 1);
            if (toStop < 3 && tow.V * dt >= toStop - 0.02)
            {
                // made fast at the stop
                tow.S = sStop;
                tow.V = 0;
                tow.Committed = -1;
                if (tow.Stop == 1) tow.Phase = "in";
                else
                {
                    tow.Phase = "dwell";
                    tow.Dwell = DwellA.A + r() * (DwellA.B - DwellA.A);
                }
            }
            else tow.S = Wrap(tow.S + tow.V * dt);
        }
        PlaceTows();
    }

    /// <summary>Place the hulls and the lashings, and the crossings they hold (River reads Obstacles).</summary>
    private void PlaceTows()
    {
        Obstacles.Clear();
        lash.Clear();
        float y = Tide.River;
        foreach (var tow in Tows)
        {
            // walking in: the bow a little toward the wall; out: a little away
            double turn = tow.Phase == "in" ? 0.06 * Math.Sin(Math.PI * tow.Crab) : tow.Phase == "out" ? -0.06 * Math.Sin(Math.PI * tow.Crab) : 0;
            var q = TowPose(tow, tow.S, tow.Crab, turn);
            tow.Lighter.Put(q.Lx, q.Lz, q.Yaw);
            tow.Tug.Put(q.Tx, q.Tz, q.Yaw);
            Obstacles.Add(new Obstacle { X = q.Lx, Z = q.Lz, Yaw = q.Yaw, Len = tow.Lighter.Len, Beam = tow.Lb, V = tow.V });
            Obstacles.Add(new Obstacle { X = q.Tx, Z = q.Tz, Yaw = q.Yaw, Len = tow.Tug.Len, Beam = tow.Tb, V = tow.V });
            double fx = Math.Sin(q.Yaw), fz = Math.Cos(q.Yaw);
            for (double k = 0.4; k >= -0.4; k -= 0.8)
                lash.Add(
                    new Vector3((float)(q.Lx + fx * tow.Lighter.Len * k), y + 1.0f, (float)(q.Lz + fz * tow.Lighter.Len * k)),
                    new Vector3((float)(q.Tx + fx * tow.Tug.Len * k * 0.9), y + 1.3f, (float)(q.Tz + fz * tow.Tug.Len * k * 0.9)));
            int zi = tow.Committed >= 0 ? tow.Committed : Crossing(tow);
            if (zi >= 0 && tow.Phase == "run")
                foreach (var st in zones[zi].Strips)
                {
                    double from = Wrap(st.S0 - tow.Len / 2 - HoldAhead), to = st.S1 + tow.Len / 2 + 2;
                    if (Ahead(from, tow.S) > Wrap(to - from)) continue;
                    double rr = Reach(tow, st);
                    Obstacles.Add(new Obstacle { X = st.X, Z = st.Z, Yaw = 0, Len = Strip * 2, Beam = rr * 2, V = 0, Soft = true });
                }
        }
        lash.Commit();
    }

    private int Crossing(Tow tow)
    {
        for (int i = 0; i < zones.Count; i++)
            if (Ahead(zones[i].S0, tow.S) <= zones[i].S1 - zones[i].S0 + tow.Len) return i;
        return -1;
    }
}
