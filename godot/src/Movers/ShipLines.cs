using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// Every mooring line in town, drawn as real rope (Rope.cs) that hangs and follows the tide. The big ships' lines along
/// the quays come from the bake (the browser's world/shipLines.ts, D4: the node "ship_lines" carries them in its
/// extras): from the eye over a bollard, its turns and seizing part of the quay's own model, or a ring in the coping, to
/// the ship's rail, and breast lines from an outer ship to the one inside her. The small boats' painters (Boats.Moorings:
/// AddSmall) run from a ring on the coping, with a hitch round it, to the boat's stem or stern. Each line has its length,
/// just taut at the lowest spring ebb; the boat's end rises and falls with her (on the water, or on the mud when it
/// dries), so at high water the line hangs slack, never into the water, and where it comes up from a boat lying low it
/// bears on the coping's nose instead of passing through the stone. A boat taken from her mooring takes her lines away.
/// The lines are made again when a boat has moved a centimetre or the rain's wet has changed, one chunk a frame, into
/// the same arrays: no allocation per frame.
/// </summary>
[GamePart(41)]
public partial class ShipLines : Node
{
    private struct End
    {
        public float X, Y, Z;
        public int V;
    }

    private struct Line
    {
        public End A, B;
        public float Len;
        public bool HasEdge, Hitch, HasTail;
        public Vector3 Edge;
        /// <summary>A painter's end made fast round the stem head: x, z in the world, y over her waterline.</summary>
        public Vector3 Tail;
        public Rope.Kind Kind;
    }

    private struct Carrier
    {
        public float X, Z, Floor;
        public Func<bool>? Shown;
    }

    private sealed class Chunk
    {
        public MeshInstance3D Node = null!;
        public readonly ArrayMesh Mesh = new();
        public readonly Rope.Tube Tube = new();
        public readonly List<int> Lines = new();
        public bool Dirty = true;
    }

    private const int Pts = 24, HitchPts = 11, TailPts = 5;
    private readonly List<Carrier> carriers = new();
    private readonly List<Line> lines = new();
    private readonly List<Chunk> chunks = new();
    private readonly Dictionary<(int, int), Chunk> smallChunks = new();
    private int[][] chunksOf = Array.Empty<int[]>();
    private float[] last = Array.Empty<float>(), now = Array.Empty<float>();
    private bool[] shown = Array.Empty<bool>();
    private readonly Vector3[] ptsBuf = new Vector3[Pts], hitchBuf = new Vector3[HitchPts], tailBuf = new Vector3[TailPts];
    private float drawnWet = -1;
    private bool ready, started;
    private int nShip;
    public int Rebuilds { get; private set; }
    public static ShipLines? I { get; private set; }

    private static readonly List<(Line Line, Carrier Boat, Vector3 Across)> pending = new();

    /// <summary>
    /// A small boat's painter (Boats.Moorings): from the ring at `ring` (with a hitch round it), out `across` over the
    /// coping's nose (found when the lines start), over her gunwale at `boatEnd` and round her stem head at `stem` (x, z
    /// in the world, y over her waterline); she
    /// lies at (x, z) with her floor at `floor` (the mud, when the water is lower); `shown`: whether she is at her mooring.
    /// </summary>
    public static void AddSmall(Vector3 ring, Vector3 across, Vector3 boatEnd, Vector3 stem, float x, float z, float floor, Func<bool> shown)
    {
        var l = new Line
        {
            A = new End { X = ring.X, Y = ring.Y, Z = ring.Z, V = -1 },
            B = new End { X = boatEnd.X, Y = boatEnd.Y, Z = boatEnd.Z, V = 0 },
            Hitch = true, HasTail = true, Tail = stem, Kind = Rope.Kind.Mooring,
        };
        pending.Add((l, new Carrier { X = x, Z = z, Floor = floor, Shown = shown }, across));
    }

    /// <summary>The coping's nose out from a ring: the last point, in 4 cm steps across, where the stone is still under it (a ray down).</summary>
    private Vector3? Nose(Vector3 ring, Vector3 across, PhysicsDirectSpaceState3D? space)
    {
        if (space == null) return null;
        var q = new PhysicsRayQueryParameters3D { CollideWithAreas = false };
        Vector3? lastOn = null;
        for (float s = 0.04f; s < 1.8f; s += 0.04f)
        {
            var p = ring + across * s;
            q.From = new Vector3(p.X, ring.Y + 0.8f, p.Z);
            q.To = new Vector3(p.X, ring.Y - 0.5f, p.Z);
            var hit = space.IntersectRay(q);
            if (hit.Count == 0 || hit["position"].AsVector3().Y < ring.Y - 0.3f)
                return lastOn;
            float y = hit["position"].AsVector3().Y;
            if (y > ring.Y + 0.4f) return lastOn; // (a bollard or a wall, not the coping)
            lastOn = new Vector3(p.X, y, p.Z);
        }
        return null;
    }

    public override void _Ready()
    {
        I = this;
        Node3D? root = null;
        foreach (var n in BakedWorld.All(Mv.Town))
            if (n is Node3D g && n.Name.ToString() == "ship_lines" && n.HasMeta("extras") && n.GetMeta("extras").AsGodotDictionary().ContainsKey("shipLines"))
            {
                root = g;
                break;
            }
        if (root == null)
        {
            GD.Print("ship lines: none in the bake");
            return;
        }
        var d = root.GetMeta("extras").AsGodotDictionary()["shipLines"].AsGodotDictionary();
        var vs = d["vessels"].AsGodotArray();
        for (int i = 0; i < vs.Count; i++)
        {
            var v = vs[i].AsGodotArray();
            var (dx, dz) = MooredRespace.At(v[0].AsSingle(), v[1].AsSingle());
            carriers.Add(new Carrier { X = v[0].AsSingle() + dx, Z = v[1].AsSingle() + dz, Floor = v[2].AsSingle() });
        }
        var ls = d["lines"].AsGodotArray();
        static float F(Variant v) => v.VariantType == Variant.Type.Nil ? float.NaN : v.AsSingle();
        var raw = new List<(Vector2 A, Vector2 B)>();
        for (int i = 0; i < ls.Count; i++)
        {
            var q = ls[i].AsGodotArray();
            var l = new Line
            {
                A = new End { X = F(q[0]), Y = F(q[1]), Z = F(q[2]), V = (int)F(q[3]) },
                B = new End { X = F(q[4]), Y = F(q[5]), Z = F(q[6]), V = (int)F(q[7]) },
                Len = F(q[8]), Kind = Rope.Kind.Hawser,
            };
            if (q.Count > 11 && !float.IsNaN(F(q[9])))
            {
                l.HasEdge = true;
                l.Edge = new Vector3(F(q[9]), F(q[10]), F(q[11]));
            }
            raw.Add((new Vector2(F(q[0]), F(q[2])), new Vector2(F(q[4]), F(q[6]))));
            // (issue 98: a boat the bake laid too close to her neighbour is moved, Boats.Respace.cs: her lines' ends on her go with her)
            var vsA = l.A.V >= 0 && l.A.V < vs.Count ? vs[l.A.V].AsGodotArray() : null;
            var vsB = l.B.V >= 0 && l.B.V < vs.Count ? vs[l.B.V].AsGodotArray() : null;
            if (vsA != null) { var (dx, dz) = MooredRespace.At(vsA[0].AsSingle(), vsA[1].AsSingle()); l.A.X += dx; l.A.Z += dz; }
            if (vsB != null) { var (dx, dz) = MooredRespace.At(vsB[0].AsSingle(), vsB[1].AsSingle()); l.B.X += dx; l.B.Z += dz; }
            lines.Add(l);
        }
        nShip = lines.Count;
        // the bake's chunks: which lines each holds (hidden; their meshes were the browser's tubes at bake time)
        foreach (var c in root.GetChildren())
        {
            if (c is not MeshInstance3D mi || !mi.HasMeta("extras")) continue;
            var ex = mi.GetMeta("extras").AsGodotDictionary();
            if (!ex.ContainsKey("lines")) continue;
            var ch = new Chunk();
            foreach (var x in ex["lines"].AsGodotArray()) ch.Lines.Add(x.AsInt32());
            ch.Node = new MeshInstance3D { Name = mi.Name + "_ropes", Mesh = ch.Mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, ExtraCullMargin = 6 };
            mi.GetParent().AddChild(ch.Node);
            mi.Visible = false;
            chunks.Add(ch);
        }
        GD.Print($"ship lines: {lines.Count} lines to {carriers.Count} ships in {chunks.Count} chunks");
    }

    /// <summary>The small boats' painters join once every part is ready (Boats registers them in its _Ready).</summary>
    private void Start()
    {
        started = true;
        var space = Mv.Town.GetViewport()?.FindWorld3D()?.DirectSpaceState;
        int noses = 0;
        foreach (var (l0, boat, across) in pending)
        {
            var l = l0;
            l.B.V = carriers.Count;
            var ring = new Vector3(l.A.X, l.A.Y, l.A.Z);
            if (Nose(ring, across, space) is { } e) { l.HasEdge = true; l.Edge = e; noses++; }
            // its length: just taut when she lies lowest (the spring ebb's water or her floor), over the nose when it has one
            var low = new Vector3(l.B.X, MathF.Max(Tide.LwMin, boat.Floor) + l.B.Y, l.B.Z);
            l.Len = (l.HasEdge ? ring.DistanceTo(l.Edge) + l.Edge.DistanceTo(low) : ring.DistanceTo(low)) * 1.01f;
            carriers.Add(boat);
            int li = lines.Count;
            lines.Add(l);
            var cell = ((int)MathF.Floor(l.A.X / 40), (int)MathF.Floor(l.A.Z / 40));
            if (!smallChunks.TryGetValue(cell, out var ch))
            {
                smallChunks[cell] = ch = new Chunk();
                ch.Node = new MeshInstance3D { Name = $"mooring_painters_{cell.Item1}_{cell.Item2}", Mesh = ch.Mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, ExtraCullMargin = 6 };
                Mv.Town.AddChild(ch.Node);
                chunks.Add(ch);
            }
            ch.Lines.Add(li);
        }
        int small = pending.Count;
        pending.Clear();
        // each carrier's chunks, to mark when she moves
        var of = new List<int>[carriers.Count];
        for (int i = 0; i < of.Length; i++) of[i] = new List<int>();
        for (int c = 0; c < chunks.Count; c++)
            foreach (int li in chunks[c].Lines)
            {
                var l = lines[li];
                if (l.A.V >= 0 && l.A.V < of.Length && !of[l.A.V].Contains(c)) of[l.A.V].Add(c);
                if (l.B.V >= 0 && l.B.V < of.Length && !of[l.B.V].Contains(c)) of[l.B.V].Add(c);
            }
        chunksOf = Array.ConvertAll(of, l => l.ToArray());
        last = new float[carriers.Count];
        now = new float[carriers.Count];
        shown = new bool[carriers.Count];
        Array.Fill(last, float.NaN);
        ready = chunks.Count > 0;
        GD.Print($"mooring lines: {nShip} ship lines and {small} small boats' painters ({noses} over a nose found in the stone) as rope, {chunks.Count} chunks");
    }

    private float CarrierY(int i) => MathF.Max(Tide.LevelAt(carriers[i].X, carriers[i].Z), carriers[i].Floor);

    public override void _Process(double delta)
    {
        if (!started) Start();
        if (!ready) return;
        bool first = drawnWet < 0;
        float wet = Rope.RainWet;
        if (MathF.Abs(wet - drawnWet) >= 0.05f) { drawnWet = wet; foreach (var ch in chunks) ch.Dirty = true; }
        for (int i = 0; i < carriers.Count; i++)
        {
            now[i] = CarrierY(i);
            bool s = carriers[i].Shown?.Invoke() ?? true;
            if (!(MathF.Abs(now[i] - last[i]) < 0.01f) || s != shown[i])
            {
                last[i] = now[i];
                shown[i] = s;
                foreach (int c in chunksOf[i]) chunks[c].Dirty = true;
            }
        }
        // one chunk a frame (all of them the first time): the tide moves a centimetre in half a minute or so
        for (int c = 0; c < chunks.Count; c++)
        {
            if (!chunks[c].Dirty) continue;
            Build(chunks[c]);
            if (!first) break;
        }
    }

    private void Build(Chunk ch)
    {
        ch.Dirty = false;
        Rebuilds++;
        ch.Tube.Begin();
        foreach (int li in ch.Lines)
        {
            var l = lines[li];
            if (l.A.V >= 0 && !shown[l.A.V] || l.B.V >= 0 && !shown[l.B.V]) continue;
            float ay = l.A.V < 0 ? l.A.Y : last[l.A.V] + l.A.Y;
            float by = l.B.V < 0 ? l.B.Y : last[l.B.V] + l.B.Y;
            int vv = l.B.V >= 0 ? l.B.V : l.A.V;
            float water = vv >= 0 ? Tide.LevelAt(carriers[vv].X, carriers[vv].Z) : -9;
            float d = Rope.Diameter(l.Kind);
            LinePoints(l, ay, by, water + d / 2 + 0.03f);
            ch.Tube.Add(ptsBuf, d, Rope.Sides(l.Kind), Rope.Tint(l.Kind), water, drawnWet);
            if (l.Hitch) Hitch(ch.Tube, l, d, water);
            if (l.HasTail)
            {
                // over the gunwale to the stem head, lying on her timbers (a little arch over them)
                var g = ptsBuf[Pts - 1];
                var s = new Vector3(l.Tail.X, last[l.B.V] + l.Tail.Y + d / 2, l.Tail.Z);
                for (int k = 0; k < TailPts; k++) { float f = (float)k / (TailPts - 1); tailBuf[k] = g.Lerp(s, f) + Vector3.Up * (0.03f * 4 * f * (1 - f)); }
                ch.Tube.Add(tailBuf, d, Rope.Sides(l.Kind), Rope.Tint(l.Kind), water, drawnWet);
            }
        }
        ch.Tube.Commit(ch.Mesh, Rope.Material);
    }

    /// <summary>The painter's hitch: a turn round the ring's bar on the boat's side, standing up out of the coping.</summary>
    private void Hitch(Rope.Tube tube, in Line l, float d, float water)
    {
        var a = new Vector3(l.A.X, l.A.Y, l.A.Z);
        var toward = new Vector3(ptsBuf[2].X - a.X, 0, ptsBuf[2].Z - a.Z);
        toward = toward.LengthSquared() < 1e-6f ? Vector3.Forward : toward.Normalized();
        var side = toward.Cross(Vector3.Up);
        float r = 0.035f + d / 2;
        var c = a + Vector3.Up * r;
        for (int k = 0; k < HitchPts; k++)
        {
            float t = MathF.Tau * k / (HitchPts - 1);
            // a turn leaning a little to the side, so its two passes lie beside each other
            hitchBuf[k] = c + toward * (MathF.Sin(t) * r) + Vector3.Down * (MathF.Cos(t) * r) + side * (d * 1.1f * k / (HitchPts - 1));
        }
        tube.Add(hitchBuf, d, Rope.Sides(l.Kind), Rope.Tint(l.Kind), water, drawnWet);
    }

    /// <summary>A hanging rope from p to q, `len` long: n points into ptsBuf from i0 (q included), its lowest no lower than `floor`. As shipLines.ts hang.</summary>
    private void Hang(Vector3 p, Vector3 q, float len, float floor, int i0, int n)
    {
        float c = p.DistanceTo(q);
        float slack = MathF.Max(0, len - c);
        // a parabola of the line's length, about a catenary at these sags
        float h = MathF.Sqrt(3 * MathF.Max(c, 0.01f) * slack / 8);
        for (int k = 1; k < n; k++)
        {
            float f = (float)k / n;
            float room = (p.Y + (q.Y - p.Y) * f - floor) / (4 * f * (1 - f));
            if (room < h) h = MathF.Max(0, room);
        }
        for (int k = 1; k <= n; k++)
        {
            float f = (float)k / n;
            ptsBuf[i0 + k - 1] = new Vector3(p.X + (q.X - p.X) * f, p.Y + (q.Y - p.Y) * f - h * 4 * f * (1 - f), p.Z + (q.Z - p.Z) * f);
        }
    }

    /// <summary>The line's points now: shipLines.ts linePoints. Over the coping's nose when hanging free would take it through the stone.</summary>
    private void LinePoints(in Line l, float ay, float by, float floor)
    {
        var A = new Vector3(l.A.X, ay, l.A.Z);
        var B = new Vector3(l.B.X, by, l.B.Z);
        ptsBuf[0] = A;
        int n = Pts - 1;
        if (l.HasEdge)
        {
            var E = l.Edge;
            float tot = MathF.Max(1e-4f, MathF.Sqrt((B.X - A.X) * (B.X - A.X) + (B.Z - A.Z) * (B.Z - A.Z)));
            float te = MathF.Sqrt((E.X - A.X) * (E.X - A.X) + (E.Z - A.Z) * (E.Z - A.Z)) / tot;
            float c = A.DistanceTo(B);
            float slack = MathF.Max(0, l.Len - c);
            float h = MathF.Sqrt(3 * MathF.Max(c, 0.01f) * slack / 8);
            float yFree = A.Y + (B.Y - A.Y) * te - h * 4 * te * (1 - te);
            if (yFree < E.Y + Rope.Diameter(l.Kind) / 2)
            {
                // the rope's centre lies its half thickness over the stone; the few points up to the nose share its run
                var top = E + Vector3.Up * (Rope.Diameter(l.Kind) / 2);
                int up = Math.Max(1, (int)MathF.Round(n * A.DistanceTo(top) / MathF.Max(0.01f, A.DistanceTo(top) + top.DistanceTo(B))));
                up = Math.Clamp(up, 1, n - 2);
                for (int k = 1; k <= up; k++) ptsBuf[k] = A.Lerp(top, (float)k / up);
                Hang(top, B, l.Len - A.DistanceTo(top), floor, up + 1, n - up);
                return;
            }
        }
        Hang(A, B, l.Len, floor, 1, n);
    }

    // ------------------------------------------------------------------ checks

    /// <summary>For checks: each line's quay end, boat end (carrier index) and length.</summary>
    public IEnumerable<(Vector3 A, int AV, Vector3 B, int BV, float Len, Vector3? Edge)> Ends()
    {
        foreach (var l in lines) yield return (new Vector3(l.A.X, l.A.Y, l.A.Z), l.A.V, new Vector3(l.B.X, l.B.Y, l.B.Z), l.B.V, l.Len, l.HasEdge ? l.Edge : null);
    }
    public IReadOnlyList<Vector3> Vessels { get { var r = new Vector3[carriers.Count]; for (int i = 0; i < r.Length; i++) r[i] = new Vector3(carriers[i].X, carriers[i].Z, carriers[i].Floor); return r; } }
    public int ShipLineCount => nShip;
    /// <summary>For checks: the carriers of small boats' painters that are not shown now (taken away or hidden), their places.</summary>
    public IEnumerable<Vector2> HiddenCarriers() { for (int i = 0; i < carriers.Count; i++) if (!(carriers[i].Shown?.Invoke() ?? true)) yield return new Vector2(carriers[i].X, carriers[i].Z); }
    public int SmallLineCount => lines.Count - nShip;

    /// <summary>
    /// For checks: every drawn line's points now, with its water and whether it is a small boat's: the lowest point
    /// over the water, its ends, how far it dips under the coping's top between the quay end and the nose.
    /// </summary>
    public IEnumerable<(int Line, bool Small, Vector3 A, Vector3 B, float Lowest, float Water, float Sag, float Len)> Survey()
    {
        if (!started) Start();
        for (int li = 0; li < lines.Count; li++)
        {
            var l = lines[li];
            if (l.A.V >= 0 && !(carriers[l.A.V].Shown?.Invoke() ?? true) || l.B.V >= 0 && !(carriers[l.B.V].Shown?.Invoke() ?? true)) continue;
            float ay = l.A.V < 0 ? l.A.Y : CarrierY(l.A.V) + l.A.Y;
            float by = l.B.V < 0 ? l.B.Y : CarrierY(l.B.V) + l.B.Y;
            int vv = l.B.V >= 0 ? l.B.V : l.A.V;
            float water = vv >= 0 ? Tide.LevelAt(carriers[vv].X, carriers[vv].Z) : -9;
            LinePoints(l, ay, by, water + Rope.Diameter(l.Kind) / 2 + 0.03f);
            float lowest = float.PositiveInfinity, sag = 0, len = 0;
            for (int k = 0; k < Pts; k++)
            {
                lowest = MathF.Min(lowest, ptsBuf[k].Y);
                float f = (float)k / (Pts - 1);
                sag = MathF.Max(sag, ptsBuf[0].Lerp(ptsBuf[Pts - 1], f).Y - ptsBuf[k].Y);
                if (k > 0) len += ptsBuf[k].DistanceTo(ptsBuf[k - 1]);
            }
            yield return (li, li >= nShip, ptsBuf[0], ptsBuf[Pts - 1], lowest, water, sag, len);
        }
    }
}
