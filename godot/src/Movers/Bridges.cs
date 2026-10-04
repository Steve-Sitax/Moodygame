using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>One leaf of a lifting bridge: where it hinges, which way it points (0: toward +x), its length and half width.</summary>
public sealed record DrawLeaf(float Hx, float Hz, float Yaw, float L, float Half, string Leaf, string Beam, string Frame);

/// <summary>
/// A lifting bridge built by the browser's createDrawBridge (world/bridges.ts): for each leaf the leaf and its
/// balance, which turn about the hinge, and chains from the balance to the leaf's nose. The bake has the nodes;
/// this finds them by name and place, gives each leaf a body that moves with it, and lifts them.
/// </summary>
public sealed class DrawBridge
{
    public const float DrawMax = 1.36f; // a lifted leaf stands at 78 degrees
    private static readonly (float Back, float Up) Pivot = (-1.2f, 5.9f);

    private readonly List<(DrawLeaf Spec, Node3D Leaf, Node3D Beam)> parts = new();
    private readonly RopeLines chains;
    private float shown = -1;
    public int Leaves => parts.Count;
    public Vector3 Nose => parts.Count == 0 ? Vector3.Zero : parts[0].Leaf.GlobalTransform * new Vector3(parts[0].Spec.L, 0, 0);
    public Vector3 Hinge => parts.Count == 0 ? Vector3.Zero : parts[0].Leaf.GlobalPosition;

    /// <summary>The nodes a bridge of these leaves moves (to claim them before the still world is made solid).</summary>
    public static IEnumerable<Node3D> Find(Node3D group, DrawLeaf spec)
    {
        var leaf = group.GetChildren().OfType<Node3D>().FirstOrDefault(n => Mv.Plain(n) == spec.Leaf && Math.Abs(n.Position.X - spec.Hx) < 0.3f && Math.Abs(n.Position.Z - spec.Hz) < 0.3f);
        float bx = spec.Hx + Pivot.Back * MathF.Cos(spec.Yaw), bz = spec.Hz - Pivot.Back * MathF.Sin(spec.Yaw);
        var beam = group.GetChildren().OfType<Node3D>().FirstOrDefault(n => Mv.Plain(n) == spec.Beam && Math.Abs(n.Position.X - bx) < 0.3f && Math.Abs(n.Position.Z - bz) < 0.3f);
        if (leaf != null) yield return leaf;
        if (beam != null) yield return beam;
    }

    public DrawBridge(Node3D group, IEnumerable<DrawLeaf> leaves, string name)
    {
        foreach (var spec in leaves)
        {
            var found = Find(group, spec).ToList();
            if (found.Count < 2) continue;
            parts.Add((spec, found[0], found[1]));
            Mv.Body(found[0]);
            Mv.Body(found[1]);
        }
        chains = new RopeLines(name + "_chains", Boats.I?.Rope);
        group.AddChild(chains);
        Set(0);
    }

    /// <summary>Lift the leaves: 0 down (walkable), 1 up at 78 degrees.</summary>
    public void Set(float amount)
    {
        if (Math.Abs(amount - shown) < 1e-5f) return;
        shown = amount;
        float ang = DrawMax * amount;
        chains.Clear();
        foreach (var (spec, leaf, beam) in parts)
        {
            // three's Euler "YZX": the yaw, then the lift about the leaf's own z
            var basis = new Basis(Vector3.Up, spec.Yaw) * new Basis(Vector3.Back, ang);
            leaf.Basis = basis;
            beam.Basis = basis;
            foreach (int side in new[] { -1, 1 })
            {
                var a = beam.Transform * new Vector3(spec.L, 0, side * (spec.Half + 0.05f));
                var b = leaf.Transform * new Vector3(spec.L - 0.3f, 0.1f, side * (spec.Half + 0.02f));
                chains.Add(a + Vector3.Down * 0.15f, b);
            }
        }
        chains.Commit();
    }
}

/// <summary>
/// The opening bridges over the canal and the vliet (the browser's world/bridges.ts, same bridges, routes and
/// rules): a punt or a rowing boat comes up the canal now and then, asks each bridge in its way to open, waits for
/// it, goes up to the head of the water, and later comes back. A bridge never starts to open under Jef (or
/// anything else on its deck: Busy), and shuts again behind the boat. The leaves are solid as they stand.
/// </summary>
[GamePart(42)]
public partial class Bridges : Node
{
    public static Bridges I { get; private set; } = null!;

    public sealed record Rect(float MinX, float MaxX, float MinZ, float MaxZ)
    {
        public bool Has(float x, float z) => x > MinX && x < MaxX && z > MinZ && z < MaxZ;
    }

    private sealed record Def(string Key, Rect Rect, DrawLeaf[] Leaves);

    private static readonly Def[] Defs =
    {
        new("canal_mouth", new Rect(-84, -68, 2, 10), new[] { new DrawLeaf(-82, 6, 0, 6, 4, "draw_leaf_cm_w", "draw_beam_6w", "draw_frame_cm_w"), new DrawLeaf(-70, 6, MathF.PI, 6, 4, "draw_leaf_cm_e", "draw_beam_6w", "draw_frame_cm_e") }),
        new("vliet_mouth", new Rect(-152, -140, 2, 9), new[] { new DrawLeaf(-142, 5.5f, MathF.PI, 8, 3.5f, "draw_leaf_vm", "draw_beam_8", "draw_frame_vm") }),
        new("canal_mid", new Rect(-84, -68, 66, 73), new[] { new DrawLeaf(-82, 69.5f, 0, 6, 3.5f, "draw_leaf_6", "draw_beam_6", "draw_frame"), new DrawLeaf(-70, 69.5f, MathF.PI, 6, 3.5f, "draw_leaf_6", "draw_beam_6", "draw_frame") }),
        new("canal_high", new Rect(-84, -68, 150, 157), new[] { new DrawLeaf(-82, 153.5f, 0, 6, 3.5f, "draw_leaf_6", "draw_beam_6", "draw_frame"), new DrawLeaf(-70, 153.5f, MathF.PI, 6, 3.5f, "draw_leaf_6", "draw_beam_6", "draw_frame") }),
        new("vliet_mid", new Rect(-152, -140, 40, 47), new[] { new DrawLeaf(-142, 43.5f, MathF.PI, 8, 3.5f, "draw_leaf_8", "draw_beam_8", "draw_frame") }),
    };

    public sealed class Ctl
    {
        public string Key = "";
        public Rect Rect = null!;
        public float Amount, Speed = 1 / 20f;
        public int Want;
        public HashSet<string> Boats = new();
        public DrawBridge? Draw;
        /// <summary>The deck lies shut and can be walked on.</summary>
        public bool Closed => Amount <= 1e-4f;
        /// <summary>0 shut, 1 fully open.</summary>
        public float Open => Mv.Smooth(Amount);
        public bool Opening => Want + Boats.Count > 0 || Amount > 1e-4f;
    }

    private sealed class Passage
    {
        public string Name = "";
        public Route Route = null!;
        public string[] Kinds = Array.Empty<string>();
        public (double A, double B) Interval;
        public List<(Ctl Ctl, double A, double B)> Gates = new();
        public HashSet<string> Asked = new();
        public Dictionary<string, TrainPart> Boats = new();
        public TrainPart? Part;
        public string Kind = "";
        /// <summary>"river", "in", "up", "out".</summary>
        public string State = "river";
        public double S, Wait, Speed = 1, V;
    }

    private readonly List<Ctl> ctls = new();
    private readonly Dictionary<string, Passage> passages = new();
    private Node3D group = null!;
    private Func<double> r = Mv.Rng(1865);
    /// <summary>Something else on (or at) a bridge's deck: the goods train, the omnibus. It does not open under them.</summary>
    public static readonly List<Func<Rect, bool>> Busy = new();

    public IReadOnlyList<Ctl> List => ctls;

    /// <summary>Before the still world is made solid: the leaves and their balances move, the passage boats float.</summary>
    public static void Claims()
    {
        var g = Mv.Top("opening_bridges");
        if (g == null) return;
        foreach (var d in Defs)
            foreach (var l in d.Leaves)
                foreach (var n in DrawBridge.Find(g, l)) Mv.Claim(n);
        foreach (var c in g.GetChildren())
            if (c is Node3D n && (Mv.Plain(n) is "punt" or "rowboat" || c is MeshInstance3D)) Mv.Claim(n); // (and the chains' lines)
    }

    public override void _Ready()
    {
        I = this;
        var g = Mv.Top("opening_bridges");
        if (g == null)
        {
            SetProcess(false);
            return;
        }
        group = g;
        // the bake's chains (one line set a bridge) are drawn here now
        foreach (var c in group.GetChildren())
            if (c is MeshInstance3D mi) mi.Visible = false;
        foreach (var d in Defs)
            ctls.Add(new Ctl { Key = d.Key, Rect = d.Rect, Draw = new DrawBridge(group, d.Leaves, d.Key) });

        const double canalX = -75.9;
        passages["canal"] = new Passage
        {
            Name = "canal",
            Route = new Route(new[] { (250.0, -21.0), (60.0, -21.0), (-40.0, -21.0), (-62.0, -19.0), (canalX, -8.0), (canalX, 4.0), (canalX, 40.0), (canalX, 110.0), (canalX, 175.0), (canalX, 196.0) }),
            Kinds = new[] { "punt", "rowboat", "punt" }, Interval = (100, 220), Wait = 20 + r() * 60,
        };
        passages["vliet"] = new Passage
        {
            Name = "vliet",
            Route = new Route(new[] { (250.0, -21.0), (40.0, -21.0), (-100.0, -21.0), (-132.0, -19.0), (-146.0, -8.0), (-146.0, 4.0), (-146.0, 30.0), (-147.0, 52.0), (-147.0, 62.0) }),
            Kinds = new[] { "punt", "rowboat" }, Interval = (140, 280), Wait = 70 + r() * 80,
        };
        foreach (var (name, p) in passages)
            foreach (var c in ctls)
            {
                if (!c.Key.StartsWith(name)) continue;
                if (p.Route.Span(c.Rect.MinX, c.Rect.MaxX, c.Rect.MinZ, c.Rect.MaxZ, 1.5) is var (a, b)) p.Gates.Add((c, a, b));
            }
        // the frozen passage boat of the bake is the canal's first
        foreach (var c in group.GetChildren())
            if (c is Node3D n && Boats.I?.Of(n) is { } f)
            {
                f.Outer.Visible = false;
                passages["canal"].Boats.TryAdd(f.Kind, new TrainPart { Boat = f, Len = Boats.I.Dims(f.Kind).Length });
            }
        GD.Print($"bridges: {ctls.Count} opening bridges ({string.Join(", ", ctls.Select(c => $"{c.Key} {c.Draw!.Leaves} leaves"))})");
        if (MoversTest.On) Probes();
    }

    private static readonly Dictionary<string, double> SpeedOf = new() { ["punt"] = 0.8, ["rowboat"] = 1.1, ["lighter"] = 0.7, ["lighter_loaded"] = 0.6, ["hengst"] = 0.8 };

    private TrainPart? BoatFor(Passage p, string kind)
    {
        if (p.Boats.TryGetValue(kind, out var b)) return b;
        var f = Boats.I?.Place(kind, group);
        if (f == null) return null;
        f.Outer.Position = new Vector3(400, Tide.River, -200);
        b = new TrainPart { Boat = f, Len = Boats.I!.Dims(kind).Length };
        p.Boats[kind] = b;
        return b;
    }

    private void Start(Passage p, string dir)
    {
        if (p.State is "in" or "out") return;
        if (dir == "in")
        {
            if (p.State != "river") return;
            foreach (var b in p.Boats.Values) b.Boat.Outer.Visible = false;
            string kind = p.Kinds[(int)Math.Floor(r() * p.Kinds.Length)];
            p.Part = BoatFor(p, kind);
            if (p.Part == null) return;
            p.Part.Boat.Outer.Visible = true;
            p.Speed = SpeedOf.GetValueOrDefault(kind, 0.9);
            p.S = 0;
            p.Kind = kind;
        }
        else
        {
            if (p.State != "up" || p.Part == null) return;
            p.S = p.Route.Length;
        }
        p.State = dir;
    }

    private static void Put(Passage p, double s, int dir)
    {
        var q = p.Route.Pose(s, dir);
        p.Part!.Put(q.X, q.Z, q.Yaw);
    }

    private void Move(Passage p, double dt)
    {
        if (p.Part == null)
        {
            p.Wait -= dt;
            if (p.Wait <= 0) Start(p, "in");
            return;
        }
        var obj = p.Part.Boat.Outer;
        if (p.State is "river" or "up")
        {
            p.Wait -= dt;
            var head = p.Route.Curve.Points[^1];
            var cam = Main.I.Cam?.GlobalPosition ?? new Vector3(1e6f, 0, 0);
            bool seen = p.State == "up" && new Vector2(cam.X - head.X, cam.Z - head.Y).Length() < 35;
            if (p.Wait <= 0 && !seen) Start(p, p.State == "river" ? "in" : "out");
            if (p.State is "river" or "up")
            {
                Put(p, p.State == "river" ? 0 : p.Route.Length, 1);
                if (p.State == "river") obj.Visible = false;
                return;
            }
        }
        int dir = p.State == "in" ? 1 : -1;
        double half = p.Part.Len / 2, bow = p.S + dir * half, stern = p.S - dir * half;
        double v = p.Speed;
        foreach (var (ctl, a, b) in p.Gates)
        {
            double ahead = dir > 0 ? a - bow : bow - b; // from the bow to this bridge
            bool behind = dir > 0 ? stern > b + 2 : stern < a - 2; // the stern is clear of it
            bool need = ahead < 45 && !behind;
            bool asked = p.Asked.Contains(ctl.Key);
            if (need && !asked)
            {
                ctl.Want++;
                p.Asked.Add(ctl.Key);
            }
            else if (!need && asked)
            {
                ctl.Want = Math.Max(0, ctl.Want - 1);
                p.Asked.Remove(ctl.Key);
            }
            if (need && ahead > -1 && ctl.Open < 0.97f) v = Math.Min(v, Mv.Clamp((ahead - 4) * 0.25, 0, p.Speed));
        }
        double fromEnd = Math.Min(p.S, p.Route.Length - p.S);
        v *= Mv.Clamp(0.3 + fromEnd / 15, 0.3, 1);
        p.S = Mv.Clamp(p.S + dir * v * dt, 0, p.Route.Length);
        Put(p, p.S, dir);
        p.V = v;
        if ((dir > 0 && p.S >= p.Route.Length) || (dir < 0 && p.S <= 0))
        {
            p.State = dir > 0 ? "up" : "river";
            p.Wait = p.Interval.A + r() * (p.Interval.B - p.Interval.A);
        }
    }

    public override void _Process(double delta)
    {
        MoverCost.Begin("bridges");
        double dt = MoverClock.Dt;
        var jef = Jef.I;
        foreach (var c in ctls)
        {
            bool occupied = jef != null && c.Rect.Has(jef.X, jef.Z);
            if (!occupied)
                foreach (var b in Busy)
                    if (b(c.Rect))
                    {
                        occupied = true;
                        break;
                    }
            float ease = 0.25f + 0.75f * MathF.Sin(MathF.PI * Mv.Clamp01(c.Amount));
            if (c.Want + c.Boats.Count > 0)
            {
                if (c.Amount > 0 || !occupied) c.Amount = Math.Min(1, c.Amount + c.Speed * ease * (float)dt);
            }
            else c.Amount = Math.Max(0, c.Amount - c.Speed * ease * (float)dt);
            c.Draw?.Set(Mv.Smooth(c.Amount));
        }
        Move(passages["canal"], dt);
        Move(passages["vliet"], dt);
        MoverCost.End("bridges");
    }

    /// <summary>Send a boat up (or down, if one is up there) the canal or the vliet now.</summary>
    public void PassNow(string where)
    {
        var p = passages[where];
        if (p.State == "up") Start(p, "out");
        else
        {
            if (p.Part == null) p.Wait = 0;
            Start(p, "in");
        }
    }

    /// <summary>A rowing boat that does not fit under a bridge asks it to open, or lets it go; `who` names the asker.</summary>
    public void Request(string key, string who, bool on)
    {
        var c = ctls.FirstOrDefault(q => q.Key == key);
        if (c != null)
        {
            if (on) c.Boats.Add(who);
            else c.Boats.Remove(who);
        }
        else if (key == "lock_bridge") Lock.I?.Request(on);
    }

    private void Probes()
    {
        var c = ctls[0];
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "bridge_canal_mouth",
            Hour = 11,
            Gap = 4,
            MaxWait = 40,
            Start = () => Request(c.Key, "test", true),
            Ready = () => c.Amount > 0.25f,
            Where = () => (c.Draw!.Nose, c.Open, $"the canal's mouth bridge, {c.Open * 100:0} % open"),
            View = () => (new Vector3(-58, 7, 22), new Vector3(-76, 4, 6)),
            End = () => Request(c.Key, "test", false),
        });
        var p = passages["canal"];
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "bridge_boat_up_the_canal",
            Hour = 11,
            Gap = 4,
            MaxWait = 60,
            Start = () =>
            {
                PassNow("canal");
                // The approach takes minutes; start the picture inside the canal, clear of moored ships.
                if (p.State == "in") p.S = Math.Max(p.S, p.Route.Length - 170);
            },
            Ready = () => p.Part != null && p.State == "in" && p.V > 0.2,
            Where = () => p.Part == null ? (Vector3.Zero, 0, "no boat") : (p.Part.Boat.Outer.GlobalPosition, p.S, $"a {p.Kind} going up the canal at {p.V:0.0} m/s, asked: {string.Join(", ", p.Asked)}"),
            View = () =>
            {
                if(p.Part==null) return (new Vector3(-70,5,0),new Vector3(-76,0,-8));
                var boat=p.Part.Boat.Outer; float yaw=boat.GlobalRotation.Y;
                var side=new Vector3(MathF.Cos(yaw),0,-MathF.Sin(yaw)); if(side.Z>0) side=-side;
                float length=Boats.I.Dims(p.Kind).Length; var at=boat.GlobalPosition+Vector3.Up*1.5f;
                return (at+side*(length*.6f+5)+Vector3.Up*Math.Max(4,length*.18f),at);
            },
        });
    }
}
