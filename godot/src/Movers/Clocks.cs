using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// Every clock in the game shows the game's own time (Steve, 2026-09-26): the browser's world/clockHands.ts. The
/// bake holds each dial's hands as one small mesh named clock_hands (the hour hand, the minute hand and the hub),
/// laid at the bake's hour. This part takes them over: once a game minute every dial's hands are laid again, the
/// minute hand jumping a minute like a tower clock's, the hour hand going on with the minutes. A room or a shop
/// that builds its own clock calls Clocks.AddDial. The check: Clocks.I.Report() (printed once at the start).
/// </summary>
[GamePart(20)]
public partial class Clocks : Node
{
    public static Clocks I { get; private set; } = null!;

    private const int HubN = 8;
    private const int Verts = 4 + 4 + 1 + HubN;
    /// <summary>The clock's time before the game has one: ten past ten, as a shop window shows it.</summary>
    private const int IdleMinute = 10 * 60 + 10;

    public sealed class Dial
    {
        public MeshInstance3D Node = null!;
        public ArrayMesh Mesh = null!;
        public Material? Mat;
        public string Kind = "", Where = "";
        /// <summary>Lengths in metres: the hour hand, the minute hand, the hands' width, the hair they stack by.</summary>
        public float Hour, Minute, W, Step;
        /// <summary>The minute of the 12 hours the hands show now (-1: not laid yet).</summary>
        public int Shows = -1;
        public bool Baked;
    }

    private readonly List<Dial> dials = new();
    private int gameMinute = -1;
    private readonly Vector3[] pos = new Vector3[Verts];
    private static readonly Vector3[] Normals = MakeNormals();
    private static readonly int[] Index = MakeIndex();
    private static readonly Vector2[] Uvs = new Vector2[Verts];
    private static readonly Color[] White = MakeWhite();

    public IReadOnlyList<Dial> Dials => dials;

    private static Vector3[] MakeNormals()
    {
        var n = new Vector3[Verts];
        for (int i = 0; i < Verts; i++) n[i] = new Vector3(0, 0, 1);
        return n;
    }

    private static Color[] MakeWhite()
    {
        var c = new Color[Verts];
        for (int i = 0; i < Verts; i++) c[i] = new Color(1, 1, 1);
        return c;
    }

    private static int[] MakeIndex()
    {
        // (three winds its faces the other way round from Godot)
        var idx = new List<int> { 0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6 };
        for (int i = 0; i < HubN; i++)
        {
            idx.Add(8);
            idx.Add(9 + (i + 1) % HubN);
            idx.Add(9 + i);
        }
        return idx.ToArray();
    }

    public override void _Ready()
    {
        I = this;
        foreach (var n in BakedWorld.All(Main.I.World))
        {
            if (n is not MeshInstance3D { Mesh: not null } mi || Mv.Plain(n) != "clock_hands") continue;
            if (mi.Mesh.GetSurfaceCount() < 1) continue;
            var v = mi.Mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            if (v.Length != Verts)
            {
                GD.PrintErr($"clocks: {mi.Name} has {v.Length} points, not the hands' {Verts}: left as baked");
                continue;
            }
            // the dial's sizes, read back from the hands the browser laid (clockHands.ts layHands)
            float hub = new Vector2(v[9].X, v[9].Y).Length();
            var d = new Dial
            {
                Node = mi,
                Mat = mi.Mesh.SurfaceGetMaterial(0),
                Hour = new Vector2(v[2].X, v[2].Y).Length(),
                Minute = new Vector2(v[6].X, v[6].Y).Length(),
                W = hub / 0.55f,
                Step = v[4].Z,
                Kind = "hands on a model's dial",
                Where = WhereOf(mi),
                Baked = true,
            };
            d.Mesh = new ArrayMesh();
            mi.Mesh = d.Mesh;
            // the tide of a far tower: its box never changes much, keep it drawn
            mi.ExtraCullMargin = d.Minute;
            dials.Add(d);
        }
        Tick(true);
        if (MoversTest.On) Probes();
        var rep = Report();
        GD.Print($"clocks: {dials.Count} faces, the game says {Hm(NowMinute())}");
        foreach (var r in rep)
            GD.Print(string.Create(CultureInfo.InvariantCulture, $"clocks:   {r.Where} at ({r.At.X:0.0}, {r.At.Y:0.0}, {r.At.Z:0.0}) shows {r.Shows}, {(r.Running ? "runs" : "DOES NOT RUN")}{(r.Shown ? "" : " (its model is hidden now)")}"));
    }

    private static string WhereOf(Node n)
    {
        for (var p = n.GetParent(); p != null && p != Main.I.World; p = p.GetParent())
        {
            string s = p.Name.ToString();
            if (!s.StartsWith('@') && !s.StartsWith('_') && !s.StartsWith("clock") && s != "town") return s;
        }
        return "?";
    }

    /// <summary>
    /// Hands on a dial of a part's own making (a room's wall clock, a shop sign): `at` the middle of the face and
    /// `normal` out of it, in the parent's frame; `radius` to the outer edge of its ring.
    /// </summary>
    public MeshInstance3D AddDial(Node3D parent, Vector3 at, Vector3 normal, float radius, Material mat, string kind, string where = "", float minute = 0.72f, float hour = 0.48f, float width = 0.08f, float lift = -1)
    {
        var n = normal.Normalized();
        if (lift < 0) lift = Math.Max(0.004f, radius * 0.03f);
        var up = Vector3.Up;
        var x = up.Cross(n);
        if (x.LengthSquared() < 1e-8f) x = new Vector3(0, 0, 1).Cross(n);
        x = x.Normalized();
        var y = n.Cross(x);
        var mesh = new ArrayMesh();
        var mi = new MeshInstance3D { Name = "clock_hands", Mesh = mesh, Transform = new Transform3D(new Basis(x, y, n), at + n * lift) };
        parent.AddChild(mi);
        var d = new Dial { Node = mi, Mesh = mesh, Mat = mat, Hour = hour * radius, Minute = minute * radius, W = width * radius, Step = Math.Max(0.0008f, radius * 0.006f), Kind = kind, Where = where != "" ? where : WhereOf(mi) };
        dials.Add(d);
        Lay(d, NowMinute() % 720);
        return mi;
    }

    private int NowMinute() => gameMinute < 0 ? IdleMinute : gameMinute;

    /// <summary>Lay the hands at this minute of the 12 hours (0..719), in the face's plane (x right, y up, z out).</summary>
    private void Lay(Dial d, int m12)
    {
        void Hand(int o, float ang, float len, float half, float z)
        {
            float dx = MathF.Sin(ang), dy = MathF.Cos(ang), px = MathF.Cos(ang), py = -MathF.Sin(ang);
            float tail = len * 0.22f, at = len * 0.12f;
            pos[o] = new Vector3(-dx * tail, -dy * tail, z);
            pos[o + 1] = new Vector3(px * half + dx * at, py * half + dy * at, z);
            pos[o + 2] = new Vector3(dx * len, dy * len, z);
            pos[o + 3] = new Vector3(-px * half + dx * at, -py * half + dy * at, z);
        }
        float minuteAng = m12 % 60 / 60f * MathF.Tau;
        float hourAng = m12 / 720f * MathF.Tau;
        Hand(0, hourAng, d.Hour, d.W * 0.62f, 0);
        Hand(4, minuteAng, d.Minute, d.W * 0.45f, d.Step);
        float hub = d.W * 0.55f;
        pos[8] = new Vector3(0, 0, d.Step * 2);
        for (int i = 0; i < HubN; i++)
        {
            float t = i / (float)HubN * MathF.Tau;
            pos[9 + i] = new Vector3(MathF.Cos(t) * hub, MathF.Sin(t) * hub, d.Step * 2);
        }
        var arr = new Godot.Collections.Array();
        arr.Resize((int)Mesh.ArrayType.Max);
        arr[(int)Mesh.ArrayType.Vertex] = pos;
        arr[(int)Mesh.ArrayType.Normal] = Normals;
        arr[(int)Mesh.ArrayType.TexUV] = Uvs;
        arr[(int)Mesh.ArrayType.Color] = White;
        arr[(int)Mesh.ArrayType.Index] = Index;
        d.Mesh.ClearSurfaces();
        d.Mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arr);
        if (d.Mat != null) d.Mesh.SurfaceSetMaterial(0, d.Mat);
        // the hands sweep the whole face: one box for every minute, so the culler never drops them
        d.Mesh.CustomAabb = new Aabb(new Vector3(-d.Minute, -d.Minute, 0), new Vector3(d.Minute * 2, d.Minute * 2, d.Step * 3));
        d.Shows = m12;
    }

    private void Tick(bool force)
    {
        int m = (int)Math.Floor(MoverClock.HourF * 60 + 1e-6);
        if (m == gameMinute && !force) return;
        gameMinute = m;
        int m12 = m % 720;
        for (int i = dials.Count - 1; i >= 0; i--)
        {
            var d = dials[i];
            if (!IsInstanceValid(d.Node))
            {
                dials.RemoveAt(i); // its room or model was thrown away
                continue;
            }
            if (d.Shows != m12) Lay(d, m12);
        }
    }

    public override void _Process(double delta)
    {
        MoverCost.Begin("clocks");
        Tick(false);
        MoverCost.End("clocks");
    }

    /// <summary>The self-test's clocks: the biggest tower dial at a quarter past nine, a small one late in the afternoon.</summary>
    private void Probes()
    {
        var shown = dials.Where(d => d.Node.IsVisibleInTree()).OrderByDescending(d => d.Minute).ToList();
        if (shown.Count == 0) return;
        var picks = new List<(Dial D, double Hour, string Name)> { (shown[0], 9.25, "clock_tower") };
        var small = shown.FirstOrDefault(d => d.Where.Contains("carolus")) ?? shown[^1];
        if (small != shown[0]) picks.Add((small, 16.9, "clock_church"));
        var third = shown.FirstOrDefault(d => d.Where.Contains("oostershuis"));
        if (third != null && third != small && third != shown[0]) picks.Add((third, 21.5, "clock_oostershuis"));
        foreach (var (d, hour, name) in picks)
        {
            MoversTest.Add(new MoversTest.Probe
            {
                Name = name,
                Hour = hour,
                Gap = 4.5,
                Where = () =>
                {
                    var (h, m) = Read(d);
                    return (d.Node.GlobalPosition, m / 60.0 * Math.Tau, $"{d.Where}: the hands show {h}:{m:00}, the game says {Hm((int)Math.Floor(MoverClock.HourF * 60 + 1e-6))}");
                },
                View = () =>
                {
                    var at = d.Node.GlobalPosition;
                    var n = d.Node.GlobalTransform.Basis.Z.Normalized();
                    return (at + n * Math.Max(2.2f, d.Minute * 5.5f) + Vector3.Down * d.Minute * 0.8f, at);
                },
                Check = () =>
                {
                    var (h, m) = Read(d);
                    int game = (int)Math.Floor(MoverClock.HourF * 60 + 1e-6) % 720;
                    int off = Math.Abs(h * 60 + m - game);
                    return Math.Min(off, 720 - off) <= 1 ? "" : $"the hands show {h}:{m:00}, the game says {Hm(game)}";
                },
            });
        }
    }

    private static string Hm(int m) => $"{m / 60}:{m % 60:00}";

    public record struct Row(string Kind, string Where, Vector3 At, Vector3 Facing, bool Shown, string Shows, int OffBy, bool Running);

    /// <summary>The browser's __scheldemist.clocks(): every dial, where, the time it shows against the game's.</summary>
    public List<Row> Report()
    {
        int m12 = (int)Math.Floor(MoverClock.HourF * 60 + 1e-6) % 720;
        var list = new List<Row>();
        foreach (var d in dials)
        {
            if (!IsInstanceValid(d.Node)) continue;
            var (hour,minute)=Read(d); int actual=hour*60+minute;
            int off = Math.Min(((actual - m12) % 720 + 720) % 720, ((m12 - actual) % 720 + 720) % 720);
            list.Add(new Row(d.Kind, d.Where, d.Node.GlobalPosition, d.Node.GlobalTransform.Basis.Z.Normalized(), d.Node.IsVisibleInTree(), Hm(actual), off, d.Shows >= 0 && off <= 1));
        }
        return list;
    }

    /// <summary>The angle of a dial's minute and hour hand as its mesh has them now (read back from the points: the self-test's proof).</summary>
    public (int Hour12, int Minute) Read(Dial d)
    {
        var v = d.Mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        float ha = MathF.Atan2(v[2].X, v[2].Y), ma = MathF.Atan2(v[6].X, v[6].Y);
        if (ha < 0) ha += MathF.Tau;
        if (ma < 0) ma += MathF.Tau;
        int minute = (int)MathF.Round(ma / MathF.Tau * 60) % 60;
        int hour = (int)Math.Floor(ha / MathF.Tau * 12 + 1e-3) % 12;
        return (hour, minute);
    }
}
