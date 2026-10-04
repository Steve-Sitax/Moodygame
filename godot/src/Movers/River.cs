using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>A boat of a train (a tug and its tows, or one ship): the vessel and its hull length.</summary>
public sealed class TrainPart
{
    public Boats.Float Boat = null!;
    public double Len;
    public string PoolKey = "";

    public void Put(double x, double z, double yaw)
    {
        Boat.Outer.Position = new Vector3((float)x, Tide.LevelAt((float)x, (float)z), (float)z);
        Boat.Outer.Rotation = new Vector3(0, (float)yaw, 0);
    }
}

/// <summary>
/// Shipping on the Schelde, 1873 (the browser's world/river.ts, same lanes, kinds, speeds and rules): big ships in
/// the fairway and small craft, out of the fog at one end of the river and into it at the other. At most 8 trains
/// move at once; boats are pooled and reused. They keep station behind a slower ship and give way to the lighters'
/// tows that cross the lanes (Anchorage). The frozen ships of the bake's river_traffic group are the first boats
/// of the pool; more are copies of them (Boats.I.Place: the model library takes over there).
/// </summary>
[GamePart(40)]
public partial class River : Node
{
    public static River I { get; private set; } = null!;

    private static readonly Dictionary<string, (double X, double Z)[]> Lanes = new()
    {
        ["down"] = new[] { (280.0, -100.0), (-430.0, -100.0) },
        ["up"] = new[] { (-430.0, -84.0), (280.0, -84.0) },
        ["near"] = new[] { (-430.0, -84.0), (-150.0, -84.0), (-116.0, -80.0), (-100.0, -56.0), (-84.0, -41.0), (-55.0, -36.0), (280.0, -36.0) },
    };

    private sealed record Kind(string[] Parts, double Speed, float Scale = 1);
    private static readonly (Kind K, double W)[] Big =
    {
        (new Kind(new[] { "tug", "barque" }, 1.7), 2),
        (new Kind(new[] { "barque_sail" }, 2.4), 2),
        (new Kind(new[] { "steamer" }, 3.4), 2),
        (new Kind(new[] { "paddle_tug" }, 3.0, 1.4f), 1.5),
        (new Kind(new[] { "schooner" }, 2.6), 1.5),
    };
    private static readonly (Kind K, double W)[] Small =
    {
        (new Kind(new[] { "sloop_sail" }, 2.2), 3),
        (new Kind(new[] { "hengst_sail" }, 1.8), 2),
        (new Kind(new[] { "rowboat" }, 1.1), 1.5),
        (new Kind(new[] { "tug", "lighter_loaded", "lighter" }, 1.8), 2),
        (new Kind(new[] { "schooner" }, 2.4), 1),
    };
    /// <summary>Hawser between a tug and its tow, and between tows.</summary>
    private const double Gap = 8;
    private const int MaxShips = 8;
    private static readonly (double A, double B) Interval = (16, 40);

    public sealed class Mover
    {
        public int Id;
        public Kind_ K = null!;
        public Route Route = null!;
        public string Lane = "";
        public List<TrainPart> Parts = new();
        public double S, V, Speed, Len, Beam, X, Z, Hx, Hz = 1, Yaw;
        public string Lead = "";
    }
    /// <summary>(a train's kind, for the rest of the game)</summary>
    public sealed class Kind_
    {
        public string[] Parts = Array.Empty<string>();
        public double Speed;
        public float Scale = 1;
    }

    private readonly Dictionary<string, Route> routes = new();
    private readonly List<Mover> movers = new();
    private readonly Dictionary<string, List<TrainPart>> pool = new();
    private Node3D group = null!;
    private Func<double> r = Mv.Rng(1873);
    private double wait = 3;
    private int serial;
    private RopeLines hawsers = null!;
    public Anchorage? Anchorage { get; private set; }

    public IReadOnlyList<Mover> Movers => movers;

    public override void _Ready()
    {
        I = this;
        var g = Mv.Top("river_traffic");
        if (g == null || Boats.I == null)
        {
            SetProcess(false);
            return;
        }
        group = g;
        foreach (var kv in Lanes) routes[kv.Key] = new Route(kv.Value);

        // the bake's line sets (the hawsers, the lashings) are drawn by this part now
        foreach (var c in group.GetChildren())
            if (c is MeshInstance3D mi) mi.Visible = false;
        hawsers = new RopeLines("hawsers", Boats.I.Rope);
        group.AddChild(hawsers);

        // the frozen ships: those of the tows at the liner go to the anchorage, the rest into the pool
        var forAnchorage = new List<Boats.Float>();
        foreach (var c in group.GetChildren())
        {
            if (c is not Node3D n || Boats.I.Of(n) is not { } f) continue;
            string key = "";
            if (n.HasMeta("extras") && n.GetMeta("extras").AsGodotDictionary().TryGetValue("poolKey", out var pk)) key = pk.AsString();
            if (key == "") forAnchorage.Add(f);
            else
            {
                float scale = key.Contains('@') ? key.Split('@')[1].ToFloat() : 1;
                Give(new TrainPart { Boat = f, Len = Boats.I.Dims(f.Kind).Length * scale, PoolKey = key });
            }
        }
        Anchorage = new Anchorage(group, forAnchorage, 1873);
        // Bound the fleet by MaxShips and make every possible model while loading, never at a lane entrance.
        foreach (var (kind, _) in Big.Concat(Small))
            foreach (string name in kind.Parts)
            {
                string key = PoolKey(name, kind.Scale);
                if (!pool.TryGetValue(key, out var free)) pool[key] = free = new List<TrainPart>(MaxShips);
                while (free.Count < MaxShips)
                {
                    var f = Boats.I.Place(name, group, kind.Scale, prepared:true);
                    if (f == null) break;
                    Give(new TrainPart { Boat=f, Len=Boats.I.Dims(name).Length*kind.Scale, PoolKey=key });
                }
            }
        // the river is never empty: a few ships already under way
        for (int i = 0, n = 0; i < 20 && n < Math.Min(5, MaxShips); i++)
            if (Spawn(false)) n++;
        Heads();
        Lay();
        GD.Print($"river: {movers.Count} trains under way at the start ({string.Join(", ", movers.Select(m => string.Join("+", m.K.Parts) + " " + m.Lane))}); stand-ins for models the bake lacks: {(Boats.I.Missing.Count == 0 ? "none" : string.Join(", ", Boats.I.Missing))}");
        if (MoversTest.On) Probes();
    }

    private TrainPart? Take(string name, float scale = 1)
    {
        string key = PoolKey(name, scale);
        if (pool.TryGetValue(key, out var free) && free.Count > 0)
        {
            var p = free[^1];
            free.RemoveAt(free.Count - 1);
            p.Boat.Outer.Visible = true;
            Boats.I.Activate(p.Boat);
            return p;
        }
        return null; // a bounded pool cannot create a model on a playing frame
    }

    private static readonly Dictionary<(string, float), string> poolKeys = new();
    private static string PoolKey(string name, float scale)
    {
        if (!poolKeys.TryGetValue((name, scale), out var key))
            poolKeys[(name, scale)] = key = $"{name}@{scale.ToString(System.Globalization.CultureInfo.InvariantCulture)}";
        return key;
    }

    private void Give(TrainPart p)
    {
        p.Boat.Outer.Visible = false;
        p.Boat.Outer.Position = new Vector3(600, p.Boat.Outer.Position.Y, -400);
        if (!pool.TryGetValue(p.PoolKey, out var l)) pool[p.PoolKey] = l = new List<TrainPart>();
        l.Add(p);
    }

    private static double TrainLength(List<TrainPart> parts, double gap) => parts.Sum(p => p.Len) + gap * Math.Max(0, parts.Count - 1);

    private Kind Pick((Kind K, double W)[] table)
    {
        double sum = table.Sum(t => t.W);
        double x = r() * sum;
        foreach (var (k, w) in table)
            if ((x -= w) <= 0) return k;
        return table[^1].K;
    }

    private bool Spawn(bool atStart)
    {
        if (movers.Count >= MaxShips) return false;
        double roll = r();
        string lane = roll < 0.4 ? "near" : roll < 0.7 ? "down" : "up";
        var kind = lane == "near" || r() < 0.45 ? Pick(Small) : Pick(Big);
        var route = routes[lane];
        var parts = new List<TrainPart>();
        foreach (string n in kind.Parts)
        {
            var p = Take(n, kind.Scale);
            if (p == null)
            {
                parts.ForEach(Give);
                return false;
            }
            parts.Add(p);
        }
        double len = TrainLength(parts, Gap);
        // a new arrival waits till the start of its lane is clear; others start anywhere (at load)
        double s = atStart ? parts[0].Len / 2 : len + r() * (route.Length - len - 40);
        foreach (var m in movers)
            if (m.Route == route && Math.Abs(m.S - s) < m.Len + len + 30)
            {
                parts.ForEach(Give);
                return false;
            }
        double beam = kind.Parts.Max(n => Boats.I.Dims(n).Beam) * kind.Scale;
        movers.Add(new Mover
        {
            Id = serial++, K = new Kind_ { Parts = kind.Parts, Speed = kind.Speed, Scale = kind.Scale }, Route = route, Lane = lane, Parts = parts,
            S = s, V = kind.Speed, Speed = kind.Speed * (0.9 + r() * 0.2), Len = len, Beam = beam, Lead = kind.Parts[0],
        });
        return true;
    }

    /// <summary>Where each train's head is and which way it goes.</summary>
    private void Heads()
    {
        foreach (var m in movers)
        {
            var p = m.Route.Pose(m.S, 1);
            m.X = p.X;
            m.Z = p.Z;
            m.Yaw = p.Yaw;
            m.Hx = Math.Sin(p.Yaw);
            m.Hz = Math.Cos(p.Yaw);
        }
    }

    /// <summary>Put every train on its lane, with its hawsers (route.ts placeTrain).</summary>
    private void Lay()
    {
        hawsers.Clear();
        for (int i = movers.Count - 1; i >= 0; i--)
        {
            var m = movers[i];
            double sp = m.S;
            for (int k = 0; k < m.Parts.Count; k++)
            {
                var p = m.Parts[k];
                if (k > 0) sp -= m.Parts[k - 1].Len / 2 + Gap + p.Len / 2;
                var pose = k == 0 ? (m.X, m.Z, m.Yaw) : m.Route.Pose(sp, 1);
                p.Put(pose.Item1, pose.Item2, pose.Item3);
                if (k == 0) continue;
                Node3D a = m.Parts[k - 1].Boat.Outer, b = p.Boat.Outer;
                float la = (float)(m.Parts[k - 1].Len / 2 - 1.2), lb = (float)(p.Len / 2 - 0.5);
                hawsers.Add(
                    new Vector3(a.Position.X - MathF.Sin(a.Rotation.Y) * la, a.Position.Y + 1.3f, a.Position.Z - MathF.Cos(a.Rotation.Y) * la),
                    new Vector3(b.Position.X + MathF.Sin(b.Rotation.Y) * lb, b.Position.Y + 1.1f, b.Position.Z + MathF.Cos(b.Rotation.Y) * lb));
            }
        }
        hawsers.Commit();
    }

    public override void _Process(double delta)
    {
        MoverCost.Begin("river");
        double dt = MoverClock.Dt, t = MoverClock.T;
        wait -= dt;
        if (wait <= 0)
        {
            Spawn(true);
            wait = Interval.A + r() * (Interval.B - Interval.A);
        }
        Heads();
        // keep station: never run into the stern of a slower ship ahead, on any lane
        var obstacles = Anchorage?.Obstacles;
        foreach (var m in movers)
        {
            double v = m.Speed;
            foreach (var o in movers)
            {
                if (o == m) continue;
                double dx = o.X - m.X, dz = o.Z - m.Z;
                double along = dx * m.Hx + dz * m.Hz;
                double side = Math.Abs(dx * m.Hz - dz * m.Hx);
                if (along <= 0 || side > (m.Beam + o.Beam) / 2 + 4) continue;
                double room = along - (m.Parts[0].Len / 2 + (o.Len - o.Parts[0].Len / 2)) - 12;
                if (room < 40) v = Math.Min(v, Math.Max(0, o.V * Mv.Clamp(room / 40, 0, 1)));
            }
            // the lighters' tows crossing the lanes: hold back till they are past (only a hull that reaches into
            // this ship's way; and the crossing a tow holds while it crosses)
            if (obstacles != null)
                foreach (var o in obstacles)
                {
                    double dx = o.X - m.X, dz = o.Z - m.Z;
                    double along = dx * m.Hx + dz * m.Hz;
                    double side = Math.Abs(dx * m.Hz - dz * m.Hx);
                    double cos = Math.Abs(Math.Sin(o.Yaw) * m.Hx + Math.Cos(o.Yaw) * m.Hz);
                    double sin = Math.Sqrt(Math.Max(0, 1 - cos * cos));
                    double across = o.Len / 2 * sin + o.Beam / 2 * cos;
                    double lengthwise = o.Len / 2 * cos + o.Beam / 2 * sin;
                    if (along <= 0 || side - across > m.Beam / 2 + 3) continue;
                    double room = along - m.Parts[0].Len / 2 - lengthwise - 12;
                    if (o.Soft && room < m.V * 2.5 - 1) continue;
                    double vAlong = Math.Max(0, o.V * (Math.Sin(o.Yaw) * m.Hx + Math.Cos(o.Yaw) * m.Hz));
                    if (room < 40) v = Math.Min(v, Math.Max(0, vAlong * Mv.Clamp(room / 40, 0, 1)));
                }
            m.V += (v - m.V) * Math.Min(1, dt * 0.5);
        }
        for (int i = movers.Count - 1; i >= 0; i--)
        {
            var m = movers[i];
            m.S += m.V * dt;
            if (m.S - m.Len > m.Route.Length)
            {
                m.Parts.ForEach(Give);
                movers.RemoveAt(i);
            }
        }
        Heads();
        Lay();
        Anchorage?.Update(t, dt, movers);
        MoverCost.End("river");
    }

    private void Probes()
    {
        // the ship nearest to the Rijnkaai's water, from a boat's height beside her
        Mover? pick = null;
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "river_ship",
            Hour = 13,
            Gap = 4,
            Start = () => pick = movers.Where(m => m.S > m.Len + 20 && m.S < m.Route.Length - 60).OrderBy(m => Math.Abs(m.X) + (m.Parts.Count > 1 ? 0 : 150)).FirstOrDefault() ?? movers.FirstOrDefault(),
            Where = () => pick == null ? (Vector3.Zero, 0, "no ship") : (pick.Parts[0].Boat.Outer.GlobalPosition, pick.S, $"{string.Join(" towing ", pick.K.Parts)} on the {pick.Lane} lane at {pick.V:0.0} m/s"),
            View = () =>
            {
                if (pick == null) return (new Vector3(0, 10, -60), new Vector3(0, 0, -90));
                var at = pick.Parts[0].Boat.Outer.GlobalPosition;
                float back = (float)(pick.Len / 2 - pick.Parts[0].Len / 2);
                var mid = at - new Vector3((float)pick.Hx, 0, (float)pick.Hz) * back;
                float d = (float)Math.Max(22, pick.Len * 0.75);
                return (mid + new Vector3(-(float)pick.Hz * d, 9, (float)pick.Hx * d) + new Vector3((float)pick.Hx, 0, (float)pick.Hz) * d * 0.4f, mid + Vector3.Up * 4);
            },
        });
        // a kind the bake has no frozen copy of, made from boats.glb through the model library
        Boats.Float? made = null;
        TrainPart? modelPart = null;
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "ship_from_the_model_file",
            Hour = 13,
            Gap = 3,
            MinMove = 0.002,
            Start = () =>
            {
                modelPart = Take("barque_sail");
                made = modelPart?.Boat;
                if (made != null) made.Outer.Position = new Vector3(30, Tide.River, -62);
                if (made != null) made.Outer.Rotation = new Vector3(0, -MathF.PI / 2, 0);
            },
            Where = () => made == null ? (Vector3.Zero, 0, "boats.glb has no barque_sail") : (made.Inner.GlobalPosition, made.Inner.Rotation.Z, $"a barque under sail from boats.glb ({(Boats.I.Library.Contains("barque_sail") ? "the model library" : "a baked copy")})"),
            View = () => (new Vector3(78, 14, -18), new Vector3(30, 12, -62)),
            End = () => { if (modelPart != null) Give(modelPart); },
        });
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "river_liner_at_anchor",
            Hour = 13,
            Gap = 5,
            MinMove = 0.002, MinTurn = 0.0001,
            Where = () => Anchorage == null ? (Vector3.Zero, 0, "") : (Anchorage.Liner.Outer.GlobalPosition + Anchorage.Liner.Inner.Position, Anchorage.Liner.Outer.Rotation.Y, "the ocean steamer at anchor, sheering about her hawse"),
            View = () => (new Vector3(70, 22, -75), new Vector3(0, 6, -140)),
        });
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "river_tow_of_lighters",
            Hour = 13,
            Gap = 5,
            MaxWait = 200,
            Ready = () => Anchorage != null && Anchorage.Tows.Any(tw => tw.Phase != "dwell"),
            Where = () =>
            {
                var tw = Anchorage!.Tows.FirstOrDefault(x => x.Phase != "dwell") ?? Anchorage.Tows[0];
                return (tw.Lighter.Boat.Outer.GlobalPosition, tw.S + tw.Crab, $"a tug with a lighter on the hip: {tw.Phase}, {tw.Why}");
            },
            View = () =>
            {
                var tw = Anchorage!.Tows.FirstOrDefault(x => x.Phase != "dwell") ?? Anchorage.Tows[0];
                var at = tw.Lighter.Boat.Outer.GlobalPosition;
                return (at + new Vector3(18, 9, 20), at + Vector3.Up * 2);
            },
        });
    }
}
