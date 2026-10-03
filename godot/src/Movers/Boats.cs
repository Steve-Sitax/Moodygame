using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// The boats on the water (the browser's world/boats.ts update): every vessel floats on the level of the water it
/// lies in (the tide, the dock, the lock chamber: World/Tide.cs), heaves and rolls on its own beat, and takes the
/// ground on the mud of the canal and the vliet at low water. Single vessels (the Anna Maria, the barques, the
/// ferry pontoon ...) are a group with the model inside; the moored rows and the small boats are copies of one
/// mesh (a MultiMesh), written a row at a time. Other parts get their boats here: Boats.I.Place (a copy of a baked
/// vessel; this is where the model library takes over), Boats.I.Dims.
/// </summary>
[GamePart(30)]
public partial class Boats : Node
{
    public static Boats I { get; private set; } = null!;

    /// <summary>Heave (m), roll and pitch (rad), period (s): small boats move more and faster (boats.ts MOTION).</summary>
    private static readonly Dictionary<string, float[]> Motion = new()
    {
        ["barque"] = new[] { 0.03f, 0.006f, 0.002f, 8.5f },
        ["steamer"] = new[] { 0.03f, 0.005f, 0.002f, 8.0f },
        ["rhine_barge"] = new[] { 0.025f, 0.006f, 0.002f, 7.0f },
        ["hengst"] = new[] { 0.03f, 0.01f, 0.004f, 6.0f },
        ["lighter"] = new[] { 0.03f, 0.012f, 0.005f, 5.5f },
        ["lighter_loaded"] = new[] { 0.025f, 0.009f, 0.004f, 6.0f },
        ["tug"] = new[] { 0.035f, 0.015f, 0.006f, 4.5f },
        ["paddle_tug"] = new[] { 0.035f, 0.014f, 0.006f, 4.6f },
        ["sloop"] = new[] { 0.04f, 0.02f, 0.008f, 4.0f },
        ["barque_sail"] = new[] { 0.03f, 0.01f, 0.004f, 8.0f },
        ["brig"] = new[] { 0.02f, 0.004f, 0.0015f, 9.0f },
        ["schooner"] = new[] { 0.04f, 0.02f, 0.008f, 5.5f },
        ["sloop_sail"] = new[] { 0.05f, 0.03f, 0.012f, 4.0f },
        ["hengst_sail"] = new[] { 0.04f, 0.02f, 0.008f, 5.0f },
        ["rowboat"] = new[] { 0.05f, 0.035f, 0.015f, 3.0f },
        ["punt"] = new[] { 0.045f, 0.03f, 0.012f, 3.2f },
        ["workboat"] = new[] { 0.045f, 0.03f, 0.012f, 3.3f },
        ["dinghy"] = new[] { 0.055f, 0.04f, 0.018f, 2.8f },
        ["shipsboat"] = new[] { 0.045f, 0.03f, 0.013f, 3.2f },
        ["gig"] = new[] { 0.05f, 0.04f, 0.012f, 3.1f },
        ["bumboat"] = new[] { 0.045f, 0.03f, 0.013f, 3.2f },
        ["eelboat"] = new[] { 0.045f, 0.028f, 0.012f, 3.4f },
        ["oldboat"] = new[] { 0.035f, 0.02f, 0.01f, 3.6f },
        ["lighter_coal"] = new[] { 0.02f, 0.008f, 0.004f, 6.5f },
        ["lighter_sand"] = new[] { 0.02f, 0.008f, 0.004f, 6.5f },
        ["lighter_timber"] = new[] { 0.022f, 0.009f, 0.004f, 6.2f },
        ["pontoon_section"] = new[] { 0.008f, 0.002f, 0.001f, 7.0f },
        ["liner"] = new[] { 0.015f, 0.002f, 0.0008f, 11.0f },
    };
    private static readonly Dictionary<string, float> Heel = new() { ["barque_sail"] = -0.05f, ["schooner"] = -0.07f, ["sloop_sail"] = -0.09f, ["hengst_sail"] = -0.06f };
    /// <summary>The models the bake has no copy of (none sailed at bake time), and what stands in until the model library brings them.</summary>
    private static readonly Dictionary<string, string[]> StandIn = new()
    {
        ["barque_sail"] = new[] { "barque" },
        ["schooner"] = new[] { "sloop_sail", "hengst_sail" },
        ["hengst"] = new[] { "hengst_sail" },
        ["sloop"] = new[] { "sloop_sail" },
        ["lighter"] = new[] { "lighter_loaded" },
        ["punt"] = new[] { "rowboat" },
        ["rowboat"] = new[] { "punt" },
    };
    private static readonly HashSet<string> Steam = new() { "steamer", "paddle_tug", "tug", "liner" };
    public static bool IsSteam(string kind) => Steam.Contains(kind);

    /// <summary>The mud beds of the canal and the vlieten: bare at low spring tides (tide.ts).</summary>
    private const float CanalBed = -5.05f;

    public static float BedAt(float x, float z)
    {
        if (x > -83 && x < -69 && z > 1 && z < 206) return CanalBed;
        if (x > -151 && x < -141 && z > 1 && z < 73) return CanalBed;
        return float.NegativeInfinity;
    }

    /// <summary>How deep a boat of this kind sits (m below its waterline), for taking the ground (tide.ts draftOf).</summary>
    public static float DraftOf(string kind) => kind switch
    {
        "rowboat" or "punt" or "workboat" or "dinghy" or "gig" or "eelboat" => 0.25f,
        "shipsboat" or "bumboat" or "oldboat" => 0.3f,
        "lighter" or "hengst" or "sloop" => 0.55f,
        "lighter_loaded" or "lighter_coal" or "lighter_sand" or "lighter_timber" or "rhine_barge" => 0.85f,
        _ => 1.5f,
    };

    /// <summary>A single vessel: the group that is placed (Outer) and the model in it that heaves and rolls (Inner).</summary>
    public sealed class Float
    {
        public string Kind = "";
        public Node3D Outer = null!, Inner = null!;
        public float Draft, List, Heel;
        /// <summary>Her waterline cannot go below this, or NaN: the mud where she lies plus her draft.</summary>
        public float Floor = float.NaN;
        public float[] M = null!;
        public float P0, P1, P2;
    }

    private sealed class Row
    {
        public string Kind = "";
        public List<(MultiMesh Mm, Transform3D Part, float[]? Buf)> Meshes = new();
        public float[] X = null!, Z = null!, Yaw = null!, Floor = null!, List = null!, P0 = null!, P1 = null!, P2 = null!;
        public float[] M = null!;
        public Vector3 Mid;
        public int N;
        public Transform3D[] World = null!;
        public Transform3D B0;
    }

    private readonly List<Float> floats = new();
    private readonly List<Row> rows = new();
    private readonly Dictionary<string, (Node3D Outer, Node3D Inner)> templates = new();
    private readonly Dictionary<string, (float Length, float Beam, float Height)> dims = new();
    private Func<double> rand = Mv.Rng(7);
    /// <summary>The kinds asked for that the bake had no copy of (for the report).</summary>
    public readonly HashSet<string> Missing = new();

    public IReadOnlyList<Float> Floats => floats;
    public int MooredBoats => rows.Sum(r => r.N);

    public override void _Ready()
    {
        I = this;
        ProcessPriority = -50; // the boats' owners (the river, the lock ...) place theirs after this
        Collect(Mv.Town);
        foreach (var top in Mv.Town.GetChildren())
        {
            string n = Mv.Plain(top);
            if (n is "moored" or "small_boats") Rows((Node3D)top);
        }
        GD.Print($"boats: {floats.Count} single vessels, {rows.Count} rows of moored and small boats ({MooredBoats} boats), models in the bake: {string.Join(", ", templates.Keys.OrderBy(k => k))}");
        if (MoversTest.On) Probes();
    }

    /// <summary>Every vessel set down by the browser's place(): a group named after the model with the model of the same name in it.</summary>
    private void Collect(Node n)
    {
        foreach (var c in n.GetChildren())
        {
            if (c is Node3D outer && Motion.ContainsKey(Mv.Plain(c)))
            {
                var inner = Mv.Kids(outer, Mv.Plain(c)).FirstOrDefault();
                if (inner != null)
                {
                    Register(outer, inner, Mv.Plain(c));
                    continue;
                }
            }
            if (c is Node3D) Collect(c);
        }
    }

    private Float Register(Node3D outer, Node3D inner, string kind)
    {
        var f = new Float
        {
            Kind = kind,
            Outer = outer,
            Inner = inner,
            Draft = DraftOf(kind),
            List = ((float)rand() - 0.5f) * 0.08f,
            M = Motion.GetValueOrDefault(kind) ?? Motion["lighter"],
            P0 = (float)rand() * MathF.Tau,
            P1 = (float)rand() * MathF.Tau,
            P2 = (float)rand() * MathF.Tau,
            Heel = Heel.GetValueOrDefault(kind),
        };
        if (outer.HasMeta("extras"))
        {
            var ex = outer.GetMeta("extras").AsGodotDictionary();
            if (ex.TryGetValue("floor", out var fl)) f.Floor = (float)fl.AsDouble();
        }
        floats.Add(f);
        templates.TryAdd(kind, (outer, inner));
        return f;
    }

    /// <summary>Is there a model of this kind (or one that stands in for it)?</summary>
    public string? KindFor(string kind)
    {
        if (templates.ContainsKey(kind)) return kind;
        if (StandIn.TryGetValue(kind, out var alts))
            foreach (var a in alts)
                if (templates.ContainsKey(a))
                {
                    Missing.Add(kind);
                    return a;
                }
        Missing.Add(kind);
        return null;
    }

    /// <summary>
    /// A new copy of a vessel under `parent` (the browser's boats.place): it floats and bobs with the rest; its owner
    /// moves the group. Null when the bake has no such model. The model library takes over here: until then a copy
    /// of the frozen baked vessel, or of the nearest kind when the bake has none (Missing lists those).
    /// </summary>
    public Float? Place(string kind, Node parent, float scale = 1)
    {
        string? k = KindFor(kind);
        if (k == null) return null;
        var (src, srcInner) = templates[k];
        var outer = (Node3D)src.Duplicate();
        outer.Name = kind;
        outer.Visible = true;
        outer.Scale = Vector3.One * scale;
        parent.AddChild(outer);
        var inner = (Node3D)outer.GetChild(srcInner.GetIndex());
        var f = Register(outer, inner, kind);
        return f;
    }

    /// <summary>A baked vessel as a float (the parts that take a baked boat over ask for it by its group).</summary>
    public Float? Of(Node3D outer) => floats.FirstOrDefault(f => f.Outer == outer);

    /// <summary>The hull's footprint: length along z (bow to stern), beam along x; parts above 2.4 m do not count (boats.ts dims).</summary>
    public (float Length, float Beam, float Height) Dims(string kind)
    {
        if (dims.TryGetValue(kind, out var d)) return d;
        string? k = KindFor(kind);
        if (k == null) return dims[kind] = (10, 3, 3);
        var inner = templates[k].Inner;
        var inv = inner.GlobalTransform.AffineInverse();
        Vector3 lo = new(float.MaxValue, float.MaxValue, float.MaxValue), hi = new(float.MinValue, float.MinValue, float.MinValue);
        float top = 0;
        foreach (var c in BakedWorld.All(inner))
        {
            if (c is not MeshInstance3D { Mesh: not null } mi) continue;
            var xf = inv * mi.GlobalTransform;
            for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
                foreach (var p in mi.Mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array())
                {
                    var v = xf * p;
                    top = Math.Max(top, v.Y);
                    if (v.Y > 2.4f) continue;
                    lo = lo.Min(v);
                    hi = hi.Max(v);
                }
        }
        return dims[kind] = (hi.Z - lo.Z, hi.X - lo.X, top);
    }

    private Material? rope;
    private bool ropeSought;
    /// <summary>The ropes' material (rigging, hawsers, chains): the one the baked ships' rigging is drawn with.</summary>
    public Material? Rope
    {
        get
        {
            if (ropeSought) return rope;
            ropeSought = true;
            foreach (var n in BakedWorld.All(Mv.Town))
                if (n is MeshInstance3D { Mesh: not null, Visible: true } r && r.Name.ToString().Contains("rigging") && r.Mesh.GetSurfaceCount() > 0 && r.Mesh.SurfaceGetMaterial(0) is ShaderMaterial sm)
                {
                    rope = sm;
                    break;
                }
            return rope;
        }
    }

    private static readonly Regex RowName = new("^INST\\d+_(.+?)(moored|small)_mm$", RegexOptions.Compiled);

    /// <summary>A moored row or the small boats: the copies of each kind's meshes become one row that is written together.</summary>
    private void Rows(Node3D group)
    {
        var byKey = new Dictionary<string, Row>();
        var rope = Rope;
        foreach (var c in group.GetChildren())
        {
            if (c is not MultiMeshInstance3D mmi || mmi.Multimesh == null) continue;
            var m = RowName.Match(mmi.Name.ToString());
            if (!m.Success || mmi.Multimesh.InstanceCount == 0) continue;
            string kind = Motion.Keys.FirstOrDefault(k => k.Replace("_", "") == m.Groups[1].Value) ?? m.Groups[1].Value;
            var mm = mmi.Multimesh;
            var first = mm.GetInstanceTransform(0);
            // the meshes of one kind in one quarter share their boats: same count, same first place
            string key = $"{kind}:{mm.InstanceCount}:{first.Origin.X:0.00}:{first.Origin.Z:0.00}";
            if (!byKey.TryGetValue(key, out var row))
            {
                int n = mm.InstanceCount;
                row = new Row
                {
                    Kind = kind,
                    N = n,
                    M = Motion.GetValueOrDefault(kind) ?? Motion["rowboat"],
                    X = new float[n], Z = new float[n], Yaw = new float[n], Floor = new float[n], List = new float[n],
                    P0 = new float[n], P1 = new float[n], P2 = new float[n], World = new Transform3D[n],
                };
                var r = Mv.Rng((uint)(key.GetHashCode() & 0x7fffffff));
                for (int i = 0; i < n; i++)
                {
                    var t = mm.GetInstanceTransform(i);
                    row.X[i] = t.Origin.X;
                    row.Z[i] = t.Origin.Z;
                    row.Yaw[i] = MathF.Atan2(t.Basis.Z.X, t.Basis.Z.Z);
                    row.Floor[i] = BedAt(t.Origin.X, t.Origin.Z) + DraftOf(kind);
                    row.P0[i] = (float)r() * 6.283f;
                    row.P1[i] = (float)r() * 6.283f;
                    row.P2[i] = (float)r() * 6.283f;
                    row.List[i] = ((float)r() - 0.5f) * 0.1f;
                    row.Mid += t.Origin / n;
                }
                byKey[key] = row;
                rows.Add(row);
            }
            // the part's own place in the model: the same for every boat (nothing for most: the hull is the model's frame)
            if (row.Meshes.Count == 0) row.B0 = first;
            var part = row.Meshes.Count == 0 ? Transform3D.Identity : row.B0.AffineInverse() * first;
            if (part.Origin.Length() < 0.02f && part.Basis.IsEqualApprox(Basis.Identity)) part = Transform3D.Identity;
            row.Meshes.Add((mm, part, mm.UseColors || mm.UseCustomData ? null : new float[mm.InstanceCount * 12]));
            // the tide lifts and lowers them some 5 m: the box of the copies must hold that
            var box = mmi.GetAabb();
            mmi.CustomAabb = new Aabb(box.Position + new Vector3(0, -4, 0), box.Size + new Vector3(0, 8, 0));
        }
        // a row's rigging: the browser draws one line set per kind with the boats' places in its own shader; the bake
        // has the lines once, in the model's frame. Here: one copy per boat.
        foreach (var c in group.GetChildren())
        {
            if (c is not MeshInstance3D { Mesh: not null } lines || !lines.Name.ToString().Contains("_moored_rigging")) continue;
            string kind = lines.Name.ToString().Split("_moored_rigging")[0];
            var row = byKey.Values.FirstOrDefault(r => r.Kind == kind);
            if (row == null || rope == null) continue;
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = lines.Mesh, InstanceCount = row.N };
            var mmi = new MultiMeshInstance3D { Name = kind + "_moored_rigging_mm", Multimesh = mm, MaterialOverride = rope };
            group.AddChild(mmi);
            lines.Visible = false;
            row.Meshes.Add((mm, Transform3D.Identity, new float[row.N * 12]));
        }
        foreach (var row in byKey.Values) Write(row, (float)MoverClock.T);
    }

    /// <summary>boats.ts writeFleet: every boat of the row on its water, heaving and rolling, or on the mud.</summary>
    private void Write(Row f, float t)
    {
        float sea = MoverClock.Sea;
        float h0 = f.M[0], roll0 = f.M[1], pitch0 = f.M[2], w = MathF.Tau / f.M[3];
        float lim = Math.Min(sea, 2.5f);
        for (int i = 0; i < f.N; i++)
        {
            float level = Tide.LevelAt(f.X[i], f.Z[i]);
            float aground = Mv.Clamp01((f.Floor[i] - level) / 0.25f);
            float free = 1 - aground;
            float h = h0 * sea * free, roll = roll0 * lim * free, pitch = pitch0 * lim * free;
            float y = Math.Max(level, f.Floor[i]) + h * MathF.Sin(w * t + f.P0[i]) + h * 0.4f * MathF.Sin(2.3f * w * t + f.P0[i] * 1.7f);
            // three's Euler "YXZ": yaw, then pitch about x, then roll about z
            var basis = new Basis(Vector3.Up, f.Yaw[i]) * new Basis(Vector3.Right, pitch * MathF.Sin(1.13f * w * t + f.P2[i])) * new Basis(Vector3.Back, roll * MathF.Sin(0.83f * w * t + f.P1[i]) + f.List[i] * aground);
            f.World[i] = new Transform3D(basis, new Vector3(f.X[i], y, f.Z[i]));
        }
        foreach (var (mm, part, buf) in f.Meshes)
        {
            bool plain = part == Transform3D.Identity;
            if (buf == null)
            {
                for (int i = 0; i < f.N; i++) mm.SetInstanceTransform(i, plain ? f.World[i] : f.World[i] * part);
                continue;
            }
            for (int i = 0, o = 0; i < f.N; i++, o += 12)
            {
                var x = plain ? f.World[i] : f.World[i] * part;
                buf[o] = x.Basis.X.X; buf[o + 1] = x.Basis.Y.X; buf[o + 2] = x.Basis.Z.X; buf[o + 3] = x.Origin.X;
                buf[o + 4] = x.Basis.X.Y; buf[o + 5] = x.Basis.Y.Y; buf[o + 6] = x.Basis.Z.Y; buf[o + 7] = x.Origin.Y;
                buf[o + 8] = x.Basis.X.Z; buf[o + 9] = x.Basis.Y.Z; buf[o + 10] = x.Basis.Z.Z; buf[o + 11] = x.Origin.Z;
            }
            RenderingServer.MultimeshSetBuffer(mm.GetRid(), buf);
        }
    }

    /// <summary>Rows farther than this from the camera are written every 8th frame, in turns (docs/performance.md).</summary>
    private const float Near = 140;

    public override void _Process(double delta)
    {
        MoverCost.Begin("boats");
        float t = (float)MoverClock.T;
        float sea = MoverClock.Sea, lim = Math.Min(sea, 2.5f);
        for (int i = floats.Count - 1; i >= 0; i--)
        {
            var f = floats[i];
            if (!IsInstanceValid(f.Outer))
            {
                floats.RemoveAt(i);
                continue;
            }
            if (!f.Outer.Visible) continue;
            var o = f.Outer.Position;
            float level = Tide.LevelAt(o.X, o.Z);
            float floor = float.IsNaN(f.Floor) ? BedAt(o.X, o.Z) + f.Draft : f.Floor;
            float aground = Mv.Clamp01((floor - level) / 0.25f);
            float free = 1 - aground;
            o.Y = Math.Max(level, floor);
            f.Outer.Position = o;
            float h = f.M[0] * sea * free, roll = f.M[1] * lim * free, pitch = f.M[2] * lim * free, w = MathF.Tau / f.M[3];
            f.Inner.Position = new Vector3(0, h * MathF.Sin(w * t + f.P0) + h * 0.4f * MathF.Sin(2.3f * w * t + f.P0 * 1.7f), 0);
            f.Inner.Rotation = new Vector3(pitch * MathF.Sin(1.13f * w * t + f.P2), 0, f.Heel + roll * MathF.Sin(0.83f * w * t + f.P1) + f.List * aground);
        }
        var cam = Main.I.Cam?.GlobalPosition ?? Vector3.Zero;
        ulong frame = MoverClock.Frame;
        for (int i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            float dx = r.Mid.X - cam.X, dz = r.Mid.Z - cam.Z;
            if (dx * dx + dz * dz > Near * Near && (frame + (ulong)i) % 8 != 0) continue;
            Write(r, t);
        }
        MoverCost.End("boats");
    }

    /// <summary>Is a moored hull under (x, z)? (The cranes look for a hold under the hook: rijnkaai.ts hullAt.)</summary>
    public bool HullAt(float x, float z) => HullIdAt(x, z) >= 0;

    /// <summary>Which moored hull lies under (x, z): a number of its own, or -1 for open water or the quay.</summary>
    public int HullIdAt(float x, float z)
    {
        static bool In(float px, float pz, float bx, float bz, float yaw, float len, float beam)
        {
            float dx = px - bx, dz = pz - bz, s = MathF.Sin(yaw), c = MathF.Cos(yaw);
            float along = dx * s + dz * c, across = dx * c - dz * s;
            return Math.Abs(along) < len / 2 - 0.5f && Math.Abs(across) < beam / 2 - 0.2f;
        }
        for (int ri = 0; ri < rows.Count; ri++)
        {
            var r = rows[ri];
            var d = Dims(r.Kind);
            if (d.Length < 9) continue; // a small boat has no hold
            for (int i = 0; i < r.N; i++)
                if (In(x, z, r.X[i], r.Z[i], r.Yaw[i], d.Length, d.Beam)) return ri * 1000 + i;
        }
        for (int fi = 0; fi < floats.Count; fi++)
        {
            var f = floats[fi];
            if (f.Kind == "pontoon_section" || !f.Outer.Visible || f.Outer.GetParent() != Mv.Town) continue;
            var d = Dims(f.Kind);
            if (d.Length < 9) continue;
            var o = f.Outer.Position;
            if (In(x, z, o.X, o.Z, f.Outer.Rotation.Y, d.Length, d.Beam)) return 1000000 + fi;
        }
        return -1;
    }

    /// <summary>The live place of boat i of the row nearest to a point (the self-test, life aboard).</summary>
    private (Row Row, int I)? Nearest(Vector3 p, string? kindHas = null)
    {
        (Row, int)? best = null;
        float bd = float.MaxValue;
        foreach (var r in rows)
        {
            if (kindHas != null && !r.Kind.Contains(kindHas)) continue;
            for (int i = 0; i < r.N; i++)
            {
                float d = new Vector2(r.X[i] - p.X, r.Z[i] - p.Z).LengthSquared();
                if (d < bd)
                {
                    bd = d;
                    best = (r, i);
                }
            }
        }
        return best;
    }

    private void Probes()
    {
        // a moored barge at the Rijnkaai, on the flood and at low water; the Anna Maria; a small boat in the canal
        var barge = Nearest(new Vector3(60, 0, -6));
        if (barge is var (row, i))
        {
            foreach (var (hour, tag) in new[] { (9.6, "high"), (16.5, "low") })
                MoversTest.Add(new MoversTest.Probe
                {
                    Name = $"moored_{tag}_water",
                    Hour = hour,
                    Gap = 2.5,
                    MinMove = 0.003,
                    Where = () => (row.World[i].Origin, row.World[i].Basis.GetEuler().Z, $"a moored {row.Kind} at the Rijnkaai, the river at {Tide.River:0.00}"),
                    View = () => (new Vector3(row.X[i] + 16, 3.5f, row.Z[i] - 24), new Vector3(row.X[i], Tide.River + 1.5f, row.Z[i])),
                });
        }
        var brig = floats.FirstOrDefault(f => f.Kind == "brig");
        if (brig != null)
            MoversTest.Add(new MoversTest.Probe
            {
                Name = "anna_maria",
                Hour = 9.6,
                Gap = 3,
                MinMove = 0.002,
                Where = () => (brig.Inner.GlobalPosition, brig.Inner.Rotation.Z, "the Anna Maria (brig) at her berth"),
                View = () => (brig.Outer.GlobalPosition + new Vector3(30, 12, -26), brig.Outer.GlobalPosition + new Vector3(0, 5, 0)),
            });
        var small = Nearest(new Vector3(-76, 0, 40), null);
        foreach (var r in rows)
            if (r.Kind is "punt" or "rowboat" or "dinghy")
                for (int k = 0; k < r.N; k++)
                    if (!float.IsNegativeInfinity(r.Floor[k])) { small = (r, k); goto found; }
        found:
        if (small is var (srow, si))
            MoversTest.Add(new MoversTest.Probe
            {
                Name = "small_boat_canal",
                Hour = 9.6,
                Gap = 2,
                MinMove = 0.003,
                Where = () => (srow.World[si].Origin, srow.World[si].Basis.GetEuler().Z, $"a {srow.Kind} in the canal (it takes the ground at low water)"),
                View = () => (new Vector3(srow.X[si] + 5, 2.2f, srow.Z[si] + 6), new Vector3(srow.X[si], Tide.River + 0.3f, srow.Z[si])),
            });
    }
}
