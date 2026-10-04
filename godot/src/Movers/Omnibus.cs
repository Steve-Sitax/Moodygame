using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// The omnibus lines (the browser's shared/omnibusLines.ts, the engine's numbers): three one-way rounds with their
/// stops, and the timetable that follows from the rounds' lengths: each line leaves its terminus at fixed times
/// from 6:00 to 22:00, one omnibus each headway.
/// </summary>
public static class OmnibusLines
{
    public sealed record Line(string Id, string Board, string Name, (float X, float Z)[] Route, int Buses, string Terminus);
    public sealed record Stop(string Id, string Name, string Line, float X, float Z);

    private static readonly (float, float)[] QuayRoute =
    {
        (-305, 29.5f), (-305, 8.3f), (-158, 8.3f), (-152, 7.6f), (-140, 7.6f), (-134, 8.3f), (-90, 8.3f), (-84, 7.8f), (-68, 7.8f),
        (-62, 8.3f), (66, 8.3f), (76, 15), (76, 37), (-54, 37), (-58, 33), (-58, 12), (-62, 8.3f),
        (-134, 8.3f), (-140, 7.6f), (-152, 7.6f), (-158, 8.3f), (-204, 8.3f), (-204, 29.5f),
    };
    private static readonly (float, float)[] TownRoute =
    {
        (-84.5f, 20), (-96, 20), (-96, 38), (-88.8f, 45), (-88.8f, 114), (-149, 114), (-149, 126.2f), (-238, 126.2f), (-238, 70),
        (-280, 70), (-280, 132), (-307.8f, 132), (-307.8f, 150.5f), (-356.5f, 149.8f), (-361, 214), (-358, 249), (-304.5f, 245.5f), (-304.5f, 139),
        (-275, 139), (-265, 129.8f), (-145, 129.8f), (-145, 208.5f), (-84.5f, 208.5f),
    };
    private static readonly (float, float)[] KeizerRoute =
    {
        (-148, 159), (-145, 175), (-145, 344.5f), (-102, 344.5f), (-98, 347), (-60, 349), (19, 344), (63, 342.5f), (60, 290), (40, 245.5f),
        (-19.5f, 197), (-60, 168), (-68.5f, 152), (-84, 154), (-89.5f, 146.5f), (-98, 147), (-118, 155), (-129, 156.5f), (-136, 159),
    };

    public static readonly Line[] Lines =
    {
        new("kaaien", "KAAIEN", "the quay line", QuayRoute, 1, "werf"),
        new("markt", "GROTE MARKT", "the Grote Markt line", TownRoute, 3, "vismarkt"),
        new("keizer", "KEIZERSPOORT", "the Keizerspoort line", KeizerRoute, 2, "keizerspoort"),
    };

    public static readonly Stop[] Stops =
    {
        new("werf", "the Werf", "kaaien", -270, 8.3f), new("steenplein", "the Steenplein", "kaaien", -180, 8.3f), new("vismarkt", "the Vismarkt", "kaaien", -112, 8.3f),
        new("rijnkaai", "the Rijnkaai", "kaaien", 30, 8.3f), new("bassin", "the Petit Bassin", "kaaien", 76, 31), new("rijnkaai_back", "the Rijnkaai", "kaaien", 0, 37),
        new("vismarkt", "the Vismarkt", "markt", -96, 31), new("vleeshuis", "the Vleeshuis", "markt", -118, 114), new("grote_markt", "the Grote Markt", "markt", -257, 70),
        new("sint_jorispoort", "the Sint-Jorispoort", "markt", -335.9f, 150), new("stadspark", "the Stadspark", "markt", -304.5f, 228), new("cathedral", "the Cathedral", "markt", -248, 129.8f),
        new("meir", "the road to the Meir", "markt", -145, 198), new("brouwersvliet", "the Brouwersvliet", "markt", -84.5f, 180),
        new("meir", "the road to the Meir", "keizer", -145, 198), new("sint_jacob", "Sint-Jacob", "keizer", -145, 293.1f), new("kipdorppoort", "the Kipdorppoort", "keizer", -145, 326.1f),
        new("ramparts", "the Ramparts", "keizer", -90.1f, 347.4f), new("keizerspoort", "the Keizerspoort", "keizer", 62, 330), new("sint_paulus", "Sint-Paulus", "keizer", 47.8f, 262.8f),
        new("keizerstraat", "the Keizerstraat", "keizer", -43.4f, 180.3f), new("conscienceplein", "the Conscienceplein", "keizer", -123.5f, 155.75f),
    };

    public const float LoopStep = 0.25f;

    /// <summary>A closed round through the corners, each corner rounded, sampled every 0.25 m (loopPath).</summary>
    public sealed class Loop
    {
        public readonly float[] X, Z, K;
        public readonly float Length;

        public Loop((float X, float Z)[] corners, float radius = 5, int steps = 10)
        {
            var pts = new List<(double X, double Z)>();
            int n = corners.Length;
            for (int i = 0; i < n; i++)
            {
                var p = corners[i];
                var a = corners[(i + n - 1) % n];
                var b = corners[(i + 1) % n];
                double la = Math.Sqrt((a.X - p.X) * (a.X - p.X) + (a.Z - p.Z) * (a.Z - p.Z)), lb = Math.Sqrt((b.X - p.X) * (b.X - p.X) + (b.Z - p.Z) * (b.Z - p.Z));
                double r = Math.Min(radius, Math.Min(la / 2.2, lb / 2.2));
                double sx = p.X + (a.X - p.X) / la * r, sz = p.Z + (a.Z - p.Z) / la * r, ex = p.X + (b.X - p.X) / lb * r, ez = p.Z + (b.Z - p.Z) / lb * r;
                for (int k = 0; k <= steps; k++)
                {
                    double t = k / (double)steps;
                    pts.Add(((1 - t) * (1 - t) * sx + 2 * (1 - t) * t * p.X + t * t * ex, (1 - t) * (1 - t) * sz + 2 * (1 - t) * t * p.Z + t * t * ez));
                }
            }
            pts.Add(pts[0]);
            var xs = new List<float>();
            var zs = new List<float>();
            double carry = 0;
            for (int i = 0; i < pts.Count - 1; i++)
            {
                var (ax, az) = pts[i];
                var (bx, bz) = pts[i + 1];
                double L = Math.Sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
                if (L < 1e-6) continue;
                double d = carry;
                while (d < L)
                {
                    xs.Add((float)(ax + (bx - ax) * d / L));
                    zs.Add((float)(az + (bz - az) * d / L));
                    d += LoopStep;
                }
                carry = d - L;
            }
            X = xs.ToArray();
            Z = zs.ToArray();
            Length = xs.Count * LoopStep;
            int N = X.Length;
            K = new float[N];
            for (int i = 0; i < N; i++)
            {
                int a = (i + N - 4) % N, b = (i + 4) % N;
                float h0 = MathF.Atan2(X[i] - X[a], Z[i] - Z[a]), h1 = MathF.Atan2(X[b] - X[i], Z[b] - Z[i]);
                K[i] = Math.Abs(MathF.Atan2(MathF.Sin(h1 - h0), MathF.Cos(h1 - h0))) / (4 * LoopStep);
            }
        }

        public float Wrap(float s) => (s % Length + Length) % Length;

        public Vector2 At(float s)
        {
            float u = Wrap(s) / LoopStep;
            int i = Math.Min(X.Length - 1, (int)MathF.Floor(u)), j = (i + 1) % X.Length;
            float f = u - i;
            return new Vector2(X[i] + (X[j] - X[i]) * f, Z[i] + (Z[j] - Z[i]) * f);
        }

        public float Yaw(float s)
        {
            var a = At(s - 0.6f);
            var b = At(s + 0.6f);
            return MathF.Atan2(b.X - a.X, b.Y - a.Y);
        }

        public float Curve(float s) => K[Math.Min(K.Length - 1, (int)MathF.Floor(Wrap(s) / LoopStep))];

        /// <summary>Every arc position where the loop passes within r of (x, z).</summary>
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
                    o.Add(best * LoopStep);
                    best = -1;
                    bd = float.MaxValue;
                }
            }
            if (best >= 0) o.Add(best * LoopStep);
            return o;
        }
    }

    public const int ServiceFirst = 6 * 60, ServiceLast = 22 * 60;
    private const double PlanSpeed = 2.5, PlanStopS = 9, RealSPerMin = 2;
    private static readonly Dictionary<string, (int RoundMin, int HeadwayMin)> timings = new();
    private static readonly Dictionary<string, Loop> loops = new();
    private static readonly Dictionary<string, Dictionary<string,int>> offsets = new();

    public static Loop LoopOf(Line l)
    {
        if (!loops.TryGetValue(l.Id, out var lp)) loops[l.Id] = lp = new Loop(l.Route);
        return lp;
    }

    /// <summary>A line's round and headway in game minutes (lineTiming).</summary>
    public static (int RoundMin, int HeadwayMin) Timing(Line line)
    {
        if (timings.TryGetValue(line.Id, out var t)) return t;
        var path = LoopOf(line);
        int calls = 0;
        foreach (var st in Stops)
            if (st.Line == line.Id) calls += path.Passes(st.X, st.Z, 1.5f).Count;
        int roundMin = (int)Math.Floor((path.Length / PlanSpeed + calls * PlanStopS) / RealSPerMin + .5);
        int headway = Math.Max(10, (int)Math.Ceiling(roundMin / (double)line.Buses / 5) * 5);
        return timings[line.Id] = (roundMin, headway);
    }

    /// <summary>The next departure from the terminus at or after `abs` (absolute game minutes).</summary>
    public static double NextSlot(Line line, double abs)
    {
        int h = Timing(line).HeadwayMin;
        double day = Math.Floor(abs / 1440), m = abs - day * 1440;
        if (m <= ServiceFirst) return day * 1440 + ServiceFirst;
        double k = Math.Ceiling((m - ServiceFirst) / h);
        double t = ServiceFirst + k * h;
        return t <= ServiceLast ? day * 1440 + t : (day + 1) * 1440 + ServiceFirst;
    }
    public static double Due(Line line,string stop,double now)
    {
        if(!offsets.TryGetValue(line.Id,out var map))
        {
            var lp=LoopOf(line);
            var calls=Stops.Where(s=>s.Line==line.Id).SelectMany(s=>lp.Passes(s.X,s.Z,1.5f).Select(p=>(S:p,Id:s.Id))).OrderBy(c=>c.S).ToList();
            float start=calls.FirstOrDefault(c=>c.Id==line.Terminus).S;
            map=new(); int i=0;
            foreach(var c in calls.OrderBy(c=>lp.Wrap(c.S-start))) {map.TryAdd(c.Id,(int)Math.Floor((lp.Wrap(c.S-start)/PlanSpeed+i*PlanStopS)/RealSPerMin+.5)); i++;}
            offsets[line.Id]=map;
        }
        return map.TryGetValue(stop,out int off)?NextSlot(line,now-off)+off:double.PositiveInfinity;
    }
}

/// <summary>
/// The horse omnibuses (the browser's world/omnibus.ts, the same rounds, speeds and rules): pair-horse omnibuses
/// with a driver on the box and a conductor on the back platform, three lines, each omnibus stopping at every stop
/// for a few seconds and leaving its terminus by the timetable (after the last round they stand there till
/// morning). An omnibus stops for Jef in its way, behind another omnibus, before an opening bridge that is not
/// shut and for the goods train on the rails it crosses; a bridge does not open under it. The wheels turn, the
/// fore-carriage steers, the horses walk or trot. Solid for Jef.
///
/// Not ported yet: Jef's ride (game/ride.ts) and the town's trip-owner connection.
/// </summary>
[GamePart(46)]
public partial class Omnibus : Node
{
    public static Omnibus I { get; private set; } = null!;

    private const float Cruise = 3.2f, Lat = 1.0f, Accel = 0.7f, Brake = 1.2f, Dwell = 7, Wheelbase = 2.9f, HorsesAt = 3.1f, RRear = 0.62f, RFront = 0.46f;
    private const float Nose = Wheelbase + HorsesAt + 1.7f, Tail = -2.3f, Z1 = 3.1f;
    private static readonly Vector3[] Lamps = { new(-0.92f, 2.0f, Z1 + 0.11f), new(0.92f, 2.0f, Z1 + 0.11f), new(0, 2.3f, Z1 - 0.24f) };

    public sealed class Bus
    {
        public OmnibusLines.Line Line = null!;
        public OmnibusLines.Loop Loop = null!;
        public List<(float S, OmnibusLines.Stop Stop)> StopAt = new();
        public int Index, NextI;
        public float S, V, DwellT, RollR, RollF, Gait, Yaw, ForeYaw, HorseYaw;
        public float BlockT, BackM;
        public float BlockProbe=float.PositiveInfinity;
        public Godot.Collections.Array<Rid> Exclude=new();
        public OmnibusLines.Stop? At;
        public double? DepartAt;
        public string WaitWhy = "";
        public Vector2 Pa, Pb, Pc;
        public Node3D Frame = null!;
        public Human? Driver, Conductor;
        public AnimatableBody3D Body = null!, Team = null!;
        public List<(float S0, float S1, Bridges.Rect Rect)> Zones = new();
        public Dictionary<Bridges.Rect, List<float>> Spans = new();
        public bool Near;
        public Action<Vector3, float>[] Lights = Array.Empty<Action<Vector3, float>>();
    }

    private readonly List<Bus> buses = new();
    private readonly Dictionary<string, double> lastSlot = new();
    private Copies? bodyM, paintM, rearM, foreM, frontM, interiorM, farGlassM, lampsM;
    private ShaderMaterial? lampMat;
    private static readonly StringName Albedo = "albedo";
    private const int HorseIndex = 2;
    public IReadOnlyList<Bus> Buses => buses;

    public override void _Ready()
    {
        I = this;
        var group = Mv.Top("omnibuses");
        if (group == null)
        {
            SetProcess(false);
            return;
        }
        bodyM = Copies.Find(group, "omnibusbody");
        paintM = Copies.Find(group, "omnibuspaint");
        rearM = Copies.Find(group, "omnibusrearwheels");
        foreM = Copies.Find(group, "omnibusfore");
        frontM = Copies.Find(group, "omnibusfrontwheels");
        interiorM = Copies.Find(group, "omnibusinterior");
        farGlassM = Copies.Find(group, "omnibusfarglass");
        lampsM = Copies.Find(group, "omnibuslamps");
        if (lampsM?.Mm.Mesh.SurfaceGetMaterial(0) is ShaderMaterial lm)
        {
            lampMat = (ShaderMaterial)lm.Duplicate();
            lampsM.Node.MaterialOverride = lampMat;
        }

        // the frames the browser made, one an omnibus, in its order (each with its frozen crew and passengers)
        var frames = group.GetChildren().Where(c => c is Node3D and not MeshInstance3D and not MultiMeshInstance3D).Cast<Node3D>().Take(OmnibusLines.Lines.Sum(l => l.Buses)).ToList();
        SplitBoards(group, frames);
        int fi = 0;
        foreach (var l in OmnibusLines.Lines)
        {
            var loop = OmnibusLines.LoopOf(l);
            var stopAt = new List<(float, OmnibusLines.Stop)>();
            foreach (var st in OmnibusLines.Stops)
                if (st.Line == l.Id)
                    foreach (float s in loop.Passes(st.X, st.Z, 1.5f)) stopAt.Add((s, st));
            stopAt.Sort((a, b) => a.Item1.CompareTo(b.Item1));
            for (int k = 0; k < l.Buses; k++)
            {
                Node3D frame;
                if (fi < frames.Count) frame = frames[fi];
                else
                {
                    frame = new Node3D { Name = $"omnibus_{fi}" };
                    group.AddChild(frame);
                }
                fi++;
                frame.Visible = true;
                // the frozen crew and passengers of the bake go; a driver and a conductor of flesh and blood come
                foreach (var c in frame.GetChildren())
                    if (c is not MeshInstance3D) c.QueueFree();
                var b = new Bus
                {
                    Line = l, Loop = loop, StopAt = stopAt, Index = buses.Count, Frame = frame,
                    S = loop.Wrap(stopAt[0].Item1 - 20 + k * loop.Length / l.Buses), Gait = buses.Count * 0.618f % 1,
                };
                b.Body = NewBox($"omnibus_body_{b.Index}", new Vector3(2.0f, 2.6f, 6.2f));
                b.Team = NewBox($"omnibus_team_{b.Index}", new Vector3(2.2f, 2.0f, 3.2f));
                b.Exclude.Add(b.Body.GetRid()); b.Exclude.Add(b.Team.GetRid());
                Crew(b);
                if (World.Lights.I != null) b.Lights = Enumerable.Range(0, 2).Select(i => World.Lights.I.AddMoving($"omnibus {b.Index} lamp {i}", new Color(1, 0.72f, 0.35f), 0.85f)).ToArray();
                Zones(b);
                FindNext(b);
                Place(b, 0);
                buses.Add(b);
            }
        }
        Bridges.Busy.Add(OnDeck);
        WaitersReady(group);
        foreach(var line in OmnibusLines.Lines)
            foreach(var stop in OmnibusLines.Stops)
                if(stop.Line==line.Id) OmnibusLines.Due(line,stop.Id,NowMin);
        overlap = new MoverOverlap();
        GD.Print($"omnibuses: {buses.Count} on {OmnibusLines.Lines.Length} lines ({string.Join(", ", OmnibusLines.Lines.Select(l => $"{l.Board} {OmnibusLines.LoopOf(l).Length:0} m, every {OmnibusLines.Timing(l).HeadwayMin} min"))})");
        if (MoversTest.On) { Probes(); PeopleProbe(); }
    }

    private AnimatableBody3D NewBox(string name, Vector3 size)
    {
        var b = new AnimatableBody3D { Name = name, SyncToPhysics = false, CollisionLayer = Solid.Layer, CollisionMask = 0 };
        AddChild(b);
        b.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size }, Position = new Vector3(0, size.Y / 2 + 0.25f, 0) });
        return b;
    }

    /// <summary>The driver on his box and the conductor on the back platform (People/Human.cs).</summary>
    private static void Crew(Bus b)
    {
        if (!Humans.Ready) return;
        var driverG = new Node3D { Name = "driver", Position = new Vector3(0.1f, 0, 3.45f) };
        var conductorG = new Node3D { Name = "conductor", Position = new Vector3(0.5f, 0.74f, -1.5f), Rotation = new Vector3(0, -0.6f, 0) };
        b.Frame.AddChild(driverG);
        b.Frame.AddChild(conductorG);
        b.Driver = Humans.Make("carter");
        if (b.Driver != null)
        {
            driverG.AddChild(b.Driver.Root);
            Carters.HideBakedCart(b.Driver);
            b.Driver.Start();
            if (b.Driver.CanSit) b.Driver.Play("sit", 0);
            b.Driver.Root.Position = new Vector3(0, 2.28f + b.Driver.SitDrop(0), 0);
        }
        b.Conductor = Humans.Make("porter");
        if (b.Conductor != null)
        {
            conductorG.AddChild(b.Conductor.Root);
            b.Conductor.Start();
            b.Conductor.Play("idle", 0);
        }
    }

    /// <summary>
    /// The destination boards and the advertisements: the bake has them as one mesh for all omnibuses, written in
    /// the world where each stood. Each omnibus gets its own piece, in its own frame, and it rides with the body.
    /// </summary>
    private static void SplitBoards(Node3D group, List<Node3D> frames)
    {
        var boards = group.GetChildren().OfType<MeshInstance3D>().FirstOrDefault(m => m.Name.ToString().StartsWith("omnibus_boards"));
        if (boards?.Mesh == null || frames.Count == 0) return;
        var arr = boards.Mesh.SurfaceGetArrays(0);
        var v = arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var n = arr[(int)Mesh.ArrayType.Normal].AsVector3Array();
        var uv = arr[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var ix = arr[(int)Mesh.ArrayType.Index];
        int per = v.Length / frames.Count;
        if (per * frames.Count != v.Length || per % 3 != 0 || ix.VariantType != Variant.Type.Nil) return; // (not the shape expected: left as baked)
        var mat = boards.Mesh.SurfaceGetMaterial(0);
        for (int i = 0; i < frames.Count; i++)
        {
            var inv = (boards.GlobalTransform.AffineInverse() * frames[i].GlobalTransform).AffineInverse();
            var pv = new Vector3[per];
            var pn = new Vector3[per];
            var pu = new Vector2[per];
            for (int k = 0; k < per; k++)
            {
                pv[k] = inv * v[i * per + k];
                if (n.Length == v.Length) pn[k] = (inv.Basis * n[i * per + k]).Normalized();
                if (uv.Length == v.Length) pu[k] = uv[i * per + k];
            }
            var a = new Godot.Collections.Array();
            a.Resize((int)Mesh.ArrayType.Max);
            a[(int)Mesh.ArrayType.Vertex] = pv;
            if (n.Length == v.Length) a[(int)Mesh.ArrayType.Normal] = pn;
            if (uv.Length == v.Length) a[(int)Mesh.ArrayType.TexUV] = pu;
            var mesh = new ArrayMesh();
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, a);
            mesh.SurfaceSetMaterial(0, mat);
            frames[i].AddChild(new MeshInstance3D { Name = "boards", Mesh = mesh });
        }
        boards.Visible = false;
    }

    private static void FindNext(Bus b)
    {
        float best = float.MaxValue;
        for (int i = 0; i < b.StopAt.Count; i++)
        {
            float d = b.Loop.Wrap(b.StopAt[i].S - b.S);
            if (d > 0.3f && d < best)
            {
                best = d;
                b.NextI = i;
            }
        }
    }

    /// <summary>The stretches of the round on the goods train's rails (railZones).</summary>
    private static void Zones(Bus b)
    {
        var rail = Railway.I;
        if (rail == null || !rail.Running) return;
        var lp = b.Loop;
        int n = lp.X.Length;
        var on = new bool[n];
        int i0 = -1;
        for (int i = 0; i < n; i++)
        {
            on[i] = rail.OnRails(lp.X[i], lp.Z[i]);
            if (!on[i] && i0 < 0) i0 = i;
        }
        if (i0 < 0) return;
        bool open = false;
        float s0 = 0, s1 = 0, minX = 0, maxX = 0, minZ = 0, maxZ = 0;
        for (int k = 0; k <= n; k++)
        {
            int i = (i0 + k) % n;
            if (on[i] && k < n)
            {
                float x = lp.X[i], z = lp.Z[i];
                if (!open)
                {
                    open = true;
                    s0 = i * OmnibusLines.LoopStep;
                    minX = maxX = x;
                    minZ = maxZ = z;
                }
                s1 = i * OmnibusLines.LoopStep;
                minX = Math.Min(minX, x - 1.5f);
                maxX = Math.Max(maxX, x + 1.5f);
                minZ = Math.Min(minZ, z - 1.5f);
                maxZ = Math.Max(maxZ, z + 1.5f);
            }
            else if (open)
            {
                b.Zones.Add((s0, s1, new Bridges.Rect(minX, maxX, minZ, maxZ)));
                open = false;
            }
        }
    }

    private static List<float> SpanOf(Bus b, Bridges.Rect r)
    {
        if (b.Spans.TryGetValue(r, out var l)) return l;
        l = new List<float>();
        bool inside = false;
        for (int i = 0; i < b.Loop.X.Length; i++)
        {
            bool now = r.Has(b.Loop.X[i], b.Loop.Z[i]);
            if (now && !inside) l.Add(i * OmnibusLines.LoopStep);
            inside = now;
        }
        b.Spans[r] = l;
        return l;
    }

    /// <summary>An omnibus is on (or at) this bridge's deck: it does not open under it.</summary>
    private bool OnDeck(Bridges.Rect r)
    {
        foreach (var b in buses)
            if (r.Has(b.Pa.X, b.Pa.Y) || r.Has(b.Pb.X, b.Pb.Y) || r.Has(b.Pc.X, b.Pc.Y)) return true;
        return false;
    }

    /// <summary>How far the omnibus may go now: to its next stop, before an open bridge, the train, Jef, another omnibus.</summary>
    private float Room(Bus b)
    {
        var lp = b.Loop;
        b.WaitWhy = "";
        float queueGap=float.PositiveInfinity;
        float nose = b.S + Nose;
        float lim = lp.Wrap(b.StopAt[b.NextI].S - b.S);
        void Bridge(Bridges.Rect rect, bool closed)
        {
            if (closed) return;
            foreach (float s0 in SpanOf(b, rect))
            {
                float ahead = lp.Wrap(s0 - nose);
                if (ahead < 30 && ahead - 8 < lim)
                {
                    lim = Math.Max(0, ahead - 8);
                    b.WaitWhy = "bridge";
                }
            }
        }
        if (Bridges.I != null)
        {
            var bridges = Bridges.I.List;
            for (int i=0;i<bridges.Count;i++) Bridge(bridges[i].Rect, bridges[i].Closed);
        }
        if (Lock.I != null) Bridge(Lock.BridgeRect, Lock.I.BridgeClosed);
        var rail = Railway.I;
        if (rail != null && rail.Running)
            foreach (var zn in b.Zones)
            {
                float len = lp.Wrap(zn.S1 - zn.S0);
                if (lp.Wrap(nose - zn.S0) < len + (Nose - Tail) + 1) continue; // on it already: go on
                float ahead = lp.Wrap(zn.S0 - nose);
                if (ahead < 30 && rail.Busy(zn.Rect) && ahead - 1.5f < lim)
                {
                    lim = Math.Max(0, ahead - 1.5f);
                    b.WaitWhy = "train";
                }
            }
        var jef = Jef.I;
        if (jef != null)
            for (float dd = -1; dd <= 7; dd += 0.5f)
            {
                var pa = lp.At(nose + dd);
                if (MathF.Sqrt((jef.X - pa.X) * (jef.X - pa.X) + (jef.Z - pa.Y) * (jef.Z - pa.Y)) < 1.7f)
                {
                    lim = Math.Min(lim, Math.Max(0, dd - 7.5f));
                    b.WaitWhy = "player";
                    break;
                }
            }
        // one that catches up waits behind the other, at a stop too
        foreach (var o in buses)
        {
            if (o == b) continue;
            if (o.Line == b.Line)
            {
                float gap = lp.Wrap(o.S + Tail - nose);
                queueGap=Math.Min(queueGap,gap);
                if (gap < 14 && gap - 2.5f < lim)
                {
                    lim = Math.Max(0, gap - 2.5f);
                    b.WaitWhy = "queue";
                }
                continue;
            }
            float tx = o.Pa.X - MathF.Sin(o.Yaw) * -Tail, tz = o.Pa.Y - MathF.Cos(o.Yaw) * -Tail;
            var at = lp.At(nose);
            if (Math.Abs(tx - at.X) > 16 || Math.Abs(tz - at.Y) > 16) continue;
            for (float dd = 0; dd <= 12; dd += 1)
            {
                var pa = lp.At(nose + dd);
                if (MathF.Sqrt((tx - pa.X) * (tx - pa.X) + (tz - pa.Y) * (tz - pa.Y)) < 1.3f)
                {
                    float dy = o.Yaw - lp.Yaw(nose + dd);
                    float turn = Math.Abs(MathF.Atan2(MathF.Sin(dy), MathF.Cos(dy)));
                    if(turn<.8f) queueGap=Math.Min(queueGap,dd);
                    if (turn < 0.8f && dd - 2.5f < lim)
                    {
                        lim = Math.Max(0, dd - 2.5f);
                        b.WaitWhy = "queue";
                    }
                    break;
                }
            }
        }
        foreach(var p in StreetPeople.Walking())
        {
            if(Math.Abs(p.X-b.Pc.X)>5 || Math.Abs(p.Z-b.Pc.Y)>5) continue;
            for(float dd=0;dd<=3;dd+=1)
            {
                var pa=lp.At(nose+dd);
                if(new Vector2((float)p.X-pa.X,(float)p.Z-pa.Y).Length()<1.1f) {lim=Math.Min(lim,Math.Max(0,dd-1.5f)); b.WaitWhy="people"; break;}
            }
        }
        var eye=Main.I.Cam.GlobalPosition;
        if(new Vector2(b.Pc.X-eye.X,b.Pc.Y-eye.Z).LengthSquared()<60*60 || (MoverClock.Frame+(ulong)b.Index)%4==0)
        {
            b.BlockProbe=float.PositiveInfinity;
            foreach(float dd in AheadSamples)
                if(!Free(b,lp.At(nose+dd),.5f)) {b.BlockProbe=dd;break;}
        }
        if(!float.IsPositiveInfinity(b.BlockProbe))
            {
                float dd=b.BlockProbe;
                if(dd<queueGap-.6f) {lim=Math.Min(lim,Math.Max(0,dd-3)); b.WaitWhy="blocked";}
            }
        return lim;
    }

    private MoverOverlap? overlap;
    private static readonly float[] AheadSamples={1.2f,2.6f,4f},BehindSamples={.8f,2f,3.2f};
    private bool Free(Bus b,Vector2 p,float radius)
    {
        return overlap!.Free(b,b.Exclude,p,radius);
    }
    private bool BehindClear(Bus b)
    {
        foreach(float dd in BehindSamples)
        {
            var p=b.Loop.At(b.S+Tail-dd);
            if(!Free(b,p,.6f) || Jef.I is { } j && new Vector2(j.X-p.X,j.Z-p.Y).Length()<1.6f) return false;
        }
        return true;
    }

    private static double NowMin => (Math.Max(1, MoverClock.Day) - 1) * 1440 + MoverClock.HourF * 60;

    /// <summary>At its terminus an omnibus waits for its time (the timetable); elsewhere it goes when its stop is done.</summary>
    private bool OnTime(Bus b)
    {
        if (b.At == null || b.At.Id != b.Line.Terminus) return true;
        double now = NowMin;
        int h = OmnibusLines.Timing(b.Line).HeadwayMin;
        if (b.DepartAt != null && b.DepartAt > OmnibusLines.NextSlot(b.Line, now) + h) b.DepartAt = null;
        if (b.DepartAt == null)
        {
            double last = lastSlot.GetValueOrDefault(b.Line.Id, double.NegativeInfinity);
            if (last > OmnibusLines.NextSlot(b.Line, now) + h) last = double.NegativeInfinity;
            b.DepartAt = OmnibusLines.NextSlot(b.Line, Math.Max(now - h / 2.0, last + 1));
            lastSlot[b.Line.Id] = b.DepartAt.Value;
        }
        if (now < b.DepartAt)
        {
            b.WaitWhy = "timetable";
            return false;
        }
        return true;
    }

    private void Move(Bus b, float dt)
    {
        if (PlayerHeld(b)) return;
        var lp = b.Loop;
        if (b.At != null)
        {
            b.V = 0;
            bool boarding = Boarding(b);
            if(!Alighting(b) && !boarding) b.DwellT -= dt;
            if (b.DwellT <= 0 && !boarding && OnTime(b))
            {
                b.DepartAt = null;
                b.At = null;
                b.NextI = (b.NextI + 1) % b.StopAt.Count;
            }
        }
        else if(b.BackM>0)
        {
            b.V=0; float ds=Math.Min(.9f*dt,b.BackM);
            if(BehindClear(b)) {b.S=lp.Wrap(b.S-ds); b.BackM-=ds; b.RollR-=ds/RRear; b.RollF-=ds/RFront;}
            else b.BackM=0;
            b.WaitWhy="backing";
        }
        else
        {
            float r = Room(b);
            if(r<=.01f && b.WaitWhy is "blocked" or "train") b.BlockT+=dt; else b.BlockT=0;
            bool inRails=false;
            foreach (var z in b.Zones)
                if(lp.Wrap(b.S+Nose-z.S0)<lp.Wrap(z.S1-z.S0)+(Nose-Tail)+1) { inRails=true; break; }
            if(b.BlockT>(inRails?8:b.WaitWhy=="train"?float.PositiveInfinity:60)) {b.BlockT=0; b.BackM=9;}
            float vmax = Cruise;
            for (int dd = 0; dd <= 10; dd += 2)
            {
                float k = lp.Curve(b.S + Wheelbase + dd);
                if (k > 1e-3f) vmax = Math.Min(vmax, MathF.Sqrt(Lat / k) + dd * 0.15f);
            }
            float want = r <= 0.01f ? 0 : Math.Min(vmax, MathF.Sqrt(2 * Brake * r));
            b.V += Math.Clamp(want - b.V, -Brake * 2.5f * dt, Accel * dt);
            if (b.V < 0.01f && want == 0) b.V = 0;
            float ds = Math.Min(b.V * dt, Math.Max(0, r));
            b.S = lp.Wrap(b.S + ds);
            b.RollR += ds / RRear;
            b.RollF += ds / RFront;
            var st = b.StopAt[b.NextI];
            float d = lp.Wrap(st.S - b.S);
            if (d < 0.05f || d > lp.Length - 0.5f)
            {
                b.At = st.Stop;
                b.DwellT = Dwell;
                b.V = 0;
                Arrive(b);
                CallWaiters(b);
            }
        }
        Place(b, dt);
    }

    private bool Boarding(Bus b)
    {
        foreach(var w in waiters) if(w.Bus==b) return true;
        return false;
    }
    private bool Alighting(Bus b)
    {
        var list=Passengers(b);
        for(int i=0;i<list.Count;i++) if(list[i].State=="out") return true;
        return false;
    }

    /// <summary>The pose from the fields (s, v): the frame, the gait, the bodies.</summary>
    private static void Place(Bus b, float dt)
    {
        var lp = b.Loop;
        bool trot = b.V > 1.9f;
        b.Gait = (b.Gait + b.V / (trot ? 2.8f : 1.35f) * dt * (trot ? 1.0f : 0.95f)) % 1;
        b.Pa = lp.At(b.S);
        b.Pb = lp.At(b.S + Wheelbase);
        b.Pc = lp.At(b.S + Wheelbase + HorsesAt);
        b.Yaw = MathF.Atan2(b.Pb.X - b.Pa.X, b.Pb.Y - b.Pa.Y);
        b.ForeYaw = MathF.Atan2(b.Pc.X - b.Pb.X, b.Pc.Y - b.Pb.Y);
        b.HorseYaw = lp.Yaw(b.S + Wheelbase + HorsesAt);
        float go = Math.Min(1, b.V / 2);
        b.Frame.Transform = new Transform3D(
            new Basis(Vector3.Up, b.Yaw) * new Basis(Vector3.Back, MathF.Sin(b.Gait * MathF.Tau * 2) * 0.006f * go),
            new Vector3(b.Pa.X, Math.Abs(MathF.Sin(b.Gait * MathF.Tau)) * 0.012f * go, b.Pa.Y));
        b.Body.Transform = new Transform3D(new Basis(Vector3.Up, b.Yaw), new Vector3(b.Pa.X + MathF.Sin(b.Yaw), 0, b.Pa.Y + MathF.Cos(b.Yaw)));
        b.Team.Transform = new Transform3D(new Basis(Vector3.Up, b.HorseYaw), new Vector3(b.Pc.X, 0, b.Pc.Y));
    }

    public override void _Process(double delta)
    {
        if (buses.Count == 0) return;
        MoverCost.Begin("omnibus");
        float dt = (float)MoverClock.Dt;
        var cam = Main.I.Cam?.GlobalPosition ?? Vector3.Zero;
        float far = (Daylight.I?.FogFar ?? 200) + 30;
        var pool = HorsePool.I;
        bool anyInside = false;
        for (int i = 0; i < buses.Count; i++)
        {
            var b = buses[i];
            Move(b, dt);
            float dist = new Vector2(b.Pa.X - cam.X, b.Pa.Y - cam.Z).Length();
            b.Near = dist < far;
            PeopleStep(b,dt);
            float cy = MathF.Cos(b.HorseYaw), sy = MathF.Sin(b.HorseYaw), amp = Math.Min(1, b.V / 0.8f);
            bool trot = b.V > 1.9f;
            for (int k = 0; k < 2; k++)
            {
                float side = k == 0 ? 0.55f : -0.55f;
                if (b.Near) pool?.Set(HorseIndex + i * 2 + k, b.Pc.X + cy * side, b.Pc.Y - sy * side, b.HorseYaw, (b.Gait + k * 0.08f) % 1, amp, trot);
                else pool?.Hide(HorseIndex + i * 2 + k);
            }
            var xf = b.Frame.Transform;
            bodyM?.Set(i, xf);
            paintM?.Set(i, xf);
            bool inside = dist < 15;
            anyInside |= inside;
            if (inside)
            {
                interiorM?.Set(i, xf);
                farGlassM?.Zero(i);
            }
            else
            {
                interiorM?.Zero(i);
                farGlassM?.Set(i, xf);
            }
            rearM?.Put(i, b.Pa.X, RRear, b.Pa.Y, b.Yaw, b.RollR);
            foreM?.Put(i, b.Pb.X, 0, b.Pb.Y, b.ForeYaw);
            frontM?.Put(i, b.Pb.X, RFront, b.Pb.Y, b.ForeYaw, b.RollF);
            for (int k = 0; k < Lamps.Length; k++)
            {
                var at = xf * Lamps[k];
                lampsM?.Set(i * Lamps.Length + k, new Transform3D(xf.Basis, at));
                if (k < b.Lights.Length) b.Lights[k](at, b.Near ? Daylight.I?.LampsLit ?? 0 : 0);
            }
            b.Frame.Visible = b.Near;
            if (b.Near)
            {
                b.Driver?.Update(dt);
                b.Conductor?.Update(dt);
            }
        }
        if (interiorM != null) interiorM.Node.Visible = anyInside;
        float lit = Daylight.I?.LampsLit ?? 0;
        lampMat?.SetShaderParameter(Albedo, new Color(0.13f + 0.87f * lit, 0.13f + 0.6f * lit, 0.12f + 0.28f * lit));
        bodyM?.Commit();
        paintM?.Commit();
        rearM?.Commit();
        foreM?.Commit();
        frontM?.Commit();
        interiorM?.Commit();
        farGlassM?.Commit();
        lampsM?.Commit();
        WaitersStep(dt);
        MoverCost.End("omnibus");
    }

    private void Probes()
    {
        Bus? pick = null;
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "omnibus_on_its_line",
            Hour = 12,
            Gap = 3,
            MaxWait = 60,
            Start = () =>
            {
                pick = buses[0];
                int s = Enumerable.Range(0, pick.Loop.X.Length).MinBy(i => new Vector2(pick.Loop.X[i] - 10, pick.Loop.Z[i] - 8.3f).LengthSquared());
                pick.S = s * OmnibusLines.LoopStep;
                pick.At = null;
                pick.V = 2;
                FindNext(pick);
                Place(pick, 0);
            },
            Ready = () => pick != null && pick.V > 1.5f,
            Where = () => pick == null ? (Vector3.Zero, 0, "no omnibus is under way") : (new Vector3(pick.Pa.X, 0, pick.Pa.Y), pick.S, $"the {pick.Line.Board} omnibus at {pick.V:0.0} m/s, next stop {pick.StopAt[pick.NextI].Stop.Name}{(pick.WaitWhy != "" ? ", waits: " + pick.WaitWhy : "")}"),
            View = () =>
            {
                if (pick == null) return (new Vector3(-100, 5, 20), new Vector3(-112, 1, 8));
                var f = new Vector3(MathF.Sin(pick.Yaw), 0, MathF.Cos(pick.Yaw));
                var side = new Vector3(f.Z, 0, -f.X);
                var at = new Vector3(pick.Pa.X, 1.4f, pick.Pa.Y) + f * 2.5f;
                return (at + f * 8 - side * 7 + Vector3.Up * 2.2f, at);
            },
        });
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "omnibus_at_a_stop",
            Hour = 12,
            Gap = 9,
            MaxWait = 60,
            MinMove = 0.5,
            Start = () =>
            {
                pick = buses[0];
                var st = pick.StopAt.First(s => s.Stop.Id == "rijnkaai");
                pick.S = pick.Loop.Wrap(st.S - 5);
                pick.At = null;
                pick.V = 2;
                FindNext(pick);
            },
            Ready = () => pick?.At?.Id == "rijnkaai" && pick.DwellT > 5 && !waiters.Any(w=>w.Bus==pick) && !Passengers(pick).Any(p=>p.State=="out"),
            Where = () => pick == null ? (Vector3.Zero, 0, "no omnibus at a stop") : (new Vector3(pick.Pa.X, 0, pick.Pa.Y), pick.S, $"the {pick.Line.Board} omnibus {(pick.At != null ? "stands at " + pick.At.Name : "has left for " + pick.StopAt[pick.NextI].Stop.Name)}"),
            View = () =>
            {
                if (pick == null) return (new Vector3(-100, 5, 20), new Vector3(-112, 1, 8));
                var f = new Vector3(MathF.Sin(pick.Yaw), 0, MathF.Cos(pick.Yaw));
                var side = new Vector3(f.Z, 0, -f.X);
                var at = new Vector3(pick.Pa.X, 1.4f, pick.Pa.Y) + f * 2;
                return (at - f * 6 - side * 9 + Vector3.Up * 2.5f, at);
            },
        });
        AnimatableBody3D? obstacle=null;
        MoversTest.Add(new MoversTest.Probe
        {
            Name="omnibus_backs_off",Hour=12,Gap=3,MaxWait=10,
            Start=()=>
            {
                pick=buses[0]; pick.S=Enumerable.Range(0,pick.Loop.X.Length).MinBy(i=>new Vector2(pick.Loop.X[i]-10,pick.Loop.Z[i]-8.3f).LengthSquared())*OmnibusLines.LoopStep; pick.At=null; pick.V=0; pick.BackM=0; pick.BlockT=60.1f;
                FindNext(pick); Place(pick,0);
                var p=pick.Loop.At(pick.S+Nose+1.2f); obstacle=NewBox("test_lane_obstacle",Vector3.One); obstacle.Position=new Vector3(p.X,0,p.Y);
            },
            Ready=()=>pick?.BackM>8,
            Where=()=> (new Vector3(pick!.Pa.X,0,pick.Pa.Y),pick.S,"the omnibus "+pick.WaitWhy),
            View=()=>{var f=new Vector3(MathF.Sin(pick!.Yaw),0,MathF.Cos(pick.Yaw)); var side=new Vector3(f.Z,0,-f.X); var p=new Vector3(pick.Pa.X,1.4f,pick.Pa.Y)+f*2.5f;return (p+f*8-side*7+Vector3.Up*2.2f,p);},
            Check=()=>pick!.WaitWhy=="backing"?"":"the omnibus did not back off",
            End=()=>{obstacle?.QueueFree();pick!.BackM=0;pick.BlockT=0;}
        });
        MoversTest.Add(new MoversTest.Probe
        {
            Name = "omnibus_night_at_the_terminus",
            Hour = 23.5,
            Gap = 3,
            MaxWait = 5,
            MinMove = -1, MinTurn = -1,
            Start = () =>
            {
                var b = buses[0];
                var st = b.StopAt.First(s => s.Stop.Id == b.Line.Terminus);
                b.S = st.S;
                b.At = st.Stop;
                b.DwellT = 0;
                b.DepartAt = null;
                b.V = 0;
            },
            Ready = () => buses[0].WaitWhy == "timetable",
            Check = () => buses[0].V == 0 && buses[0].DepartAt >= 1440 + OmnibusLines.ServiceFirst ? "" : "the night timetable did not hold the omnibus for morning",
            Where = () => (new Vector3(buses[0].Pa.X, 0, buses[0].Pa.Y), buses[0].S, $"23:30: {buses.Count(b => b.At != null && b.At.Id == b.Line.Terminus)} of {buses.Count} omnibuses stand at their terminus, {buses.Count(b => b.V > 0.1f)} still on the way in"),
            View = () =>
            {
                var b = buses[0];
                return (new Vector3(b.Pa.X - 7, 4.5f, b.Pa.Y - 12), new Vector3(b.Pa.X+2, 1.5f, b.Pa.Y));
            },
        });
    }
}
