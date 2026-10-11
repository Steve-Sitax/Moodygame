using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// The mooring lines of the boats that lie in rows along the quays (the browser's world/shipLines.ts, D4): from the
/// eyes over the bollards (or a ring in the coping) to each boat's rail, and breast lines from an outer boat to the one
/// inside her. They move with the tide: each line has its length, just taut at the lowest spring ebb, so at high water
/// it hangs slack (never into the water); where it comes up from a boat lying low it bears on the coping's nose.
/// The bake carries the lines in the extras of the node "ship_lines" (its chunk meshes are the browser's tubes at the
/// moment of the bake): they are hidden here and drawn again from the same sums whenever the water has moved a
/// centimetre, in the baked material. No allocation per frame: the arrays are made once.
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
        public bool HasEdge;
        public Vector3 Edge;
    }

    private sealed class Chunk
    {
        public MeshInstance3D Node = null!;
        public ArrayMesh Mesh = null!;
        public int[] Lines = null!;
        public Vector3[] Pos = null!, Nor = null!;
        public Vector2[] Uv = null!;
        public Color[] Col = null!;
        public int[] Index = null!;
        public Godot.Collections.Array Arrays = null!;
        public Material? Mat;
    }

    private int pts = 14, sides = 6;
    private float radius = 0.028f;
    private Vector4 uvCell;
    private Vector3[] vessels = Array.Empty<Vector3>();
    private Line[] lines = Array.Empty<Line>();
    private readonly List<Chunk> chunks = new();
    private float[] last = Array.Empty<float>();
    private float[] now = Array.Empty<float>();
    private Vector3[] ptsBuf = Array.Empty<Vector3>();
    private bool ready;
    public int Rebuilds { get; private set; }

    public override void _Ready()
    {
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
        pts = d["pts"].AsInt32();
        sides = d["sides"].AsInt32();
        radius = d["r"].AsSingle();
        var uv = d["uv"].AsGodotArray();
        uvCell = new Vector4(uv[0].AsSingle(), uv[1].AsSingle(), uv[2].AsSingle(), uv[3].AsSingle());
        var vs = d["vessels"].AsGodotArray();
        vessels = new Vector3[vs.Count];
        for (int i = 0; i < vs.Count; i++)
        {
            var v = vs[i].AsGodotArray();
            vessels[i] = new Vector3(v[0].AsSingle(), v[1].AsSingle(), v[2].AsSingle());
        }
        var ls = d["lines"].AsGodotArray();
        lines = new Line[ls.Count];
        static float F(Variant v) => v.VariantType == Variant.Type.Nil ? float.NaN : v.AsSingle();
        for (int i = 0; i < ls.Count; i++)
        {
            var q = ls[i].AsGodotArray();
            var l = new Line
            {
                A = new End { X = F(q[0]), Y = F(q[1]), Z = F(q[2]), V = (int)F(q[3]) },
                B = new End { X = F(q[4]), Y = F(q[5]), Z = F(q[6]), V = (int)F(q[7]) },
                Len = F(q[8]),
            };
            if (q.Count > 11 && !float.IsNaN(F(q[9])))
            {
                l.HasEdge = true;
                l.Edge = new Vector3(F(q[9]), F(q[10]), F(q[11]));
            }
            lines[i] = l;
        }
        last = new float[vessels.Length];
        now = new float[vessels.Length];
        Array.Fill(last, float.NaN);
        ptsBuf = new Vector3[pts];
        int ring = sides + 1, per = pts * ring;
        foreach (var c in root.GetChildren())
        {
            if (c is not MeshInstance3D mi || !mi.HasMeta("extras")) continue;
            var ex = mi.GetMeta("extras").AsGodotDictionary();
            if (!ex.ContainsKey("lines")) continue;
            var idx = ex["lines"].AsGodotArray();
            var ch = new Chunk { Lines = new int[idx.Count] };
            for (int i = 0; i < idx.Count; i++) ch.Lines[i] = idx[i].AsInt32();
            int nv = ch.Lines.Length * per;
            ch.Pos = new Vector3[nv];
            ch.Nor = new Vector3[nv];
            ch.Uv = new Vector2[nv];
            ch.Col = new Color[nv];
            var index = new List<int>();
            for (int li = 0; li < ch.Lines.Length; li++)
            {
                int b = li * per;
                for (int p = 0; p < pts; p++)
                    for (int s = 0; s < ring; s++)
                    {
                        int vi = b + p * ring + s;
                        ch.Uv[vi] = new Vector2(uvCell.X + (uvCell.Z - uvCell.X) * s / sides, uvCell.Y + (uvCell.W - uvCell.Y) * (p % 2));
                        ch.Col[vi] = new Color(0.9f, 0.9f, 0.9f);
                    }
                // (the browser's winding, counter-clockwise; Godot draws clockwise as the front: the index turned round)
                for (int p = 0; p < pts - 1; p++)
                    for (int s = 0; s < sides; s++)
                    {
                        int a = b + p * ring + s, bb = a + 1, cc = b + (p + 1) * ring + s + 1, dd = b + (p + 1) * ring + s;
                        index.Add(a); index.Add(cc); index.Add(bb);
                        index.Add(a); index.Add(dd); index.Add(cc);
                    }
            }
            ch.Index = index.ToArray();
            ch.Mat = mi.GetActiveMaterial(0);
            ch.Mesh = new ArrayMesh();
            ch.Arrays = new Godot.Collections.Array();
            ch.Arrays.Resize((int)Mesh.ArrayType.Max);
            ch.Node = new MeshInstance3D { Name = mi.Name + "_tide", Mesh = ch.Mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, ExtraCullMargin = 6 };
            mi.GetParent().AddChild(ch.Node);
            mi.Visible = false;
            chunks.Add(ch);
        }
        ready = chunks.Count > 0;
        GD.Print($"ship lines: {lines.Length} lines to {vessels.Length} boats in {chunks.Count} chunks");
    }

    private static float VesselY(Vector3 v) => MathF.Max(Tide.LevelAt(v.X, v.Y), v.Z);

    public override void _Process(double delta)
    {
        if (!ready) return;
        bool moved = false;
        for (int i = 0; i < vessels.Length; i++)
        {
            now[i] = VesselY(vessels[i]);
            if (!(MathF.Abs(now[i] - last[i]) < 0.01f)) moved = true;
        }
        if (!moved) return;
        Array.Copy(now, last, now.Length);
        Rebuilds++;
        int ring = sides + 1, per = pts * ring;
        foreach (var ch in chunks)
        {
            for (int j = 0; j < ch.Lines.Length; j++)
            {
                var l = lines[ch.Lines[j]];
                float ay = l.A.V < 0 ? l.A.Y : now[l.A.V] + l.A.Y;
                float by = l.B.V < 0 ? l.B.Y : now[l.B.V] + l.B.Y;
                int vv = l.B.V >= 0 ? l.B.V : l.A.V;
                float water = vv >= 0 ? Tide.LevelAt(vessels[vv].X, vessels[vv].Y) : -9;
                LinePoints(l, ay, by, water);
                int b = j * per;
                for (int p = 0; p < pts; p++)
                {
                    var t = (ptsBuf[Math.Min(pts - 1, p + 1)] - ptsBuf[Math.Max(0, p - 1)]).Normalized();
                    var up = MathF.Abs(t.Y) > 0.95f ? Vector3.Right : Vector3.Up;
                    var n1 = t.Cross(up).Normalized();
                    var n2 = n1.Cross(t).Normalized();
                    for (int s = 0; s < ring; s++)
                    {
                        float a = 2 * MathF.PI * s / sides;
                        var n = n1 * MathF.Cos(a) + n2 * MathF.Sin(a);
                        ch.Pos[b + p * ring + s] = ptsBuf[p] + n * radius;
                        ch.Nor[b + p * ring + s] = n;
                    }
                }
            }
            ch.Arrays[(int)Mesh.ArrayType.Vertex] = ch.Pos;
            ch.Arrays[(int)Mesh.ArrayType.Normal] = ch.Nor;
            ch.Arrays[(int)Mesh.ArrayType.TexUV] = ch.Uv;
            ch.Arrays[(int)Mesh.ArrayType.Color] = ch.Col;
            ch.Arrays[(int)Mesh.ArrayType.Index] = ch.Index;
            ch.Mesh.ClearSurfaces();
            ch.Mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, ch.Arrays);
            if (ch.Mat != null) ch.Mesh.SurfaceSetMaterial(0, ch.Mat);
        }
    }

    /// <summary>A hanging rope from p to q, `len` long: n points into ptsBuf from i0 (q included). As shipLines.ts hang.</summary>
    private void Hang(Vector3 p, Vector3 q, float len, float water, int i0, int n)
    {
        float c = p.DistanceTo(q);
        float slack = MathF.Max(0, len - c);
        float h = MathF.Sqrt(3 * MathF.Max(c, 0.01f) * slack / 8);
        for (int k = 1; k < n; k++)
        {
            float f = (float)k / n;
            float room = (p.Y + (q.Y - p.Y) * f - (water + 0.04f)) / (4 * f * (1 - f));
            if (room < h) h = MathF.Max(0, room);
        }
        for (int k = 1; k <= n; k++)
        {
            float f = (float)k / n;
            ptsBuf[i0 + k - 1] = new Vector3(p.X + (q.X - p.X) * f, p.Y + (q.Y - p.Y) * f - h * 4 * f * (1 - f), p.Z + (q.Z - p.Z) * f);
        }
    }

    /// <summary>The line's points now: shipLines.ts linePoints.</summary>
    private void LinePoints(in Line l, float ay, float by, float water)
    {
        var A = new Vector3(l.A.X, ay, l.A.Z);
        var B = new Vector3(l.B.X, by, l.B.Z);
        ptsBuf[0] = A;
        int n = pts - 1;
        if (l.HasEdge)
        {
            var E = l.Edge;
            float tot = MathF.Max(1e-4f, MathF.Sqrt((B.X - A.X) * (B.X - A.X) + (B.Z - A.Z) * (B.Z - A.Z)));
            float te = MathF.Sqrt((E.X - A.X) * (E.X - A.X) + (E.Z - A.Z) * (E.Z - A.Z)) / tot;
            float c = A.DistanceTo(B);
            float slack = MathF.Max(0, l.Len - c);
            float h = MathF.Sqrt(3 * MathF.Max(c, 0.01f) * slack / 8);
            float yFree = A.Y + (B.Y - A.Y) * te - h * 4 * te * (1 - te);
            if (yFree < E.Y)
            {
                ptsBuf[1] = E;
                Hang(E, B, l.Len - A.DistanceTo(E), water, 2, n - 1);
                return;
            }
        }
        Hang(A, B, l.Len, water, 1, n);
    }
}
