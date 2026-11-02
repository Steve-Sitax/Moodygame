using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// The one rope of the town: every rope, line, hawser, shroud and wire rope is a real tube with its own thickness in
/// metres, so it is thin far off and thick close by, as a real one. All of them share the washing lines' hemp material
/// (the laundry pack's rope_sample: a laid three-strand picture repeating along the rope, art-source/tools/blender/
/// laundry/tex.py rope): no new shader kind. The picture runs along the rope (u) at its real lay, about one strand
/// crown per diameter, and once round it (v); the kind of rope gives its thickness and its colour (tarred standing
/// rigging, weathered hemp, iron wire), carried in the vertex colour with its wet: darker within a metre of the water
/// and in the rain. No collision: nobody walks into a rope here (mooring lines lie over the coping's nose at the feet).
/// <see cref="Tube"/> builds tubes into reusable arrays (no allocation while the counts stay the same);
/// <see cref="FromLines"/> turns a model's line set (the old one-pixel rigging) into tubes once.
/// </summary>
public static class Rope
{
    public enum Kind { Hawser, Mooring, Standing, Running, Ratline, Wire, Chain, Leather, Twine, Laundry }

    /// <summary>A rope's diameter in metres: period hemp and manila, wire for the cranes.</summary>
    public static float Diameter(Kind k) => k switch
    {
        Kind.Hawser => 0.040f, Kind.Mooring => 0.032f, Kind.Standing => 0.020f, Kind.Running => 0.014f,
        Kind.Ratline => 0.009f, Kind.Wire => 0.016f, Kind.Chain => 0.018f, Kind.Leather => 0.022f, Kind.Twine => 0.003f, _ => 0.010f,
    };

    /// <summary>The sides round a rope: enough for its silhouette close by.</summary>
    public static int Sides(Kind k) => k switch { Kind.Hawser or Kind.Mooring or Kind.Laundry => 8, Kind.Ratline => 5, Kind.Twine => 4, _ => 6 };

    /// <summary>Times over the hemp picture (already a weathered grey-brown): tarred standing rigging dark, hemp lighter, iron wire grey.</summary>
    public static Color Tint(Kind k) => k switch
    {
        Kind.Hawser or Kind.Mooring => new Color(1.0f, 0.94f, 0.82f),
        Kind.Standing => new Color(0.42f, 0.36f, 0.30f),
        Kind.Ratline => new Color(0.55f, 0.48f, 0.40f),
        Kind.Running => new Color(0.92f, 0.86f, 0.74f),
        Kind.Wire => new Color(0.46f, 0.47f, 0.48f),
        Kind.Chain => new Color(0.30f, 0.27f, 0.25f),
        Kind.Leather => new Color(0.36f, 0.24f, 0.16f),
        Kind.Twine => new Color(1.1f, 1.05f, 0.95f),
        _ => Colors.White,
    };

    /// <summary>The picture's length along the rope in diameters: eight strand crowns, each about 1.1 diameters (the washing line's 10 mm in 88 mm).</summary>
    public const float LayPerDiameter = 8.8f;

    private static Material? material;
    private static bool sought;
    /// <summary>
    /// The hemp material every rope shares: the washing line's (its picture, colour and bump), in its shader kind with
    /// the Rope switch (Render/Psx.cs): never thinner than half a pixel, a far rope a faint line.
    /// </summary>
    public static Material? Material
    {
        get
        {
            if (sought) return material;
            sought = true;
            if (Scheldemist.Models.ModelLibrary.Get("laundry", new Scheldemist.Models.ModelLibrary.Look(TwoSided: true, VertexColor: true)) is { } pack
                && pack.Roots.TryGetValue("rope_sample", out var n) && n is MeshInstance3D { Mesh: not null } mi
                && mi.Mesh.SurfaceGetMaterial(0) is ShaderMaterial hemp && Scheldemist.Render.Psx.KindOf(hemp.Shader) is { } kind)
            {
                var m = (ShaderMaterial)hemp.Duplicate();
                m.Shader = Scheldemist.Render.Psx.ShaderOf(kind with { Rope = true });
                m.ResourceName = "rope";
                material = m;
            }
            if (material == null) GD.PrintErr("rope: the laundry pack's rope_sample material is missing");
            return material;
        }
    }

    /// <summary>The rain's wet on every rope now (0-1): the ground's wet (Daylight.Wet).</summary>
    public static float RainWet => Daylight.I?.Wet ?? 0;

    /// <summary>A rope's colour, wet 0-1 (within a metre of the water, or rained on): darker, as soaked hemp.</summary>
    public static Color Wet(Color c, float wet)
    {
        float k = 1 - 0.42f * Math.Clamp(wet, 0, 1);
        return new Color(c.R * k, c.G * k, c.B * k, 1);
    }

    /// <summary>How wet a point of a rope is from the water below it: soaked at the water, dry a metre and a half above.</summary>
    public static float WaterWet(float y, float water) => Math.Clamp(1 - (y - water) / 1.5f, 0, 1);

    /// <summary>
    /// Tubes along paths into reusable arrays, then into a mesh. Rings are carried along each path without twist
    /// (parallel transport); both ends are capped. Begin, Add each rope, Commit.
    /// </summary>
    public sealed class Tube
    {
        private Vector3[] pos = new Vector3[256], nor = new Vector3[256];
        private Vector2[] uv = new Vector2[256], uv2 = new Vector2[256];
        private Color[] col = new Color[256];
        private int[] idx = new int[768];
        private Vector3[] outPos = Array.Empty<Vector3>(), outNor = Array.Empty<Vector3>();
        private Vector2[] outUv = Array.Empty<Vector2>(), outUv2 = Array.Empty<Vector2>();
        private Color[] outCol = Array.Empty<Color>();
        private int[] outIdx = Array.Empty<int>();
        private readonly Godot.Collections.Array arrays = new();
        // (passed every time: left out, Godot's binding makes a new empty array and dictionary for them on each call)
        private static readonly Godot.Collections.Array<Godot.Collections.Array> noBlends = new();
        private static readonly Godot.Collections.Dictionary noLods = new();
        public int Verts { get; private set; }
        public int Indices { get; private set; }

        public Tube() => arrays.Resize((int)Mesh.ArrayType.Max);

        public void Begin() { Verts = 0; Indices = 0; }

        private void Room(int verts, int indices)
        {
            if (Verts + verts > pos.Length)
            {
                int n = Math.Max(pos.Length * 2, Verts + verts);
                Array.Resize(ref pos, n); Array.Resize(ref nor, n); Array.Resize(ref uv, n); Array.Resize(ref uv2, n); Array.Resize(ref col, n);
            }
            if (Indices + indices > idx.Length) Array.Resize(ref idx, Math.Max(idx.Length * 2, Indices + indices));
        }

        /// <summary>
        /// One rope along `path` (at least two points), `diameter` thick in the mesh's units (the picture's lay follows
        /// it), its colour tint darkened by the water at `water` (world height; NaN: none) and the rain (0-1).
        /// </summary>
        public void Add(ReadOnlySpan<Vector3> path, float diameter, int sides, Color tint, float water = float.NaN, float rain = 0)
        {
            int n = path.Length;
            if (n < 2) return;
            int ring = sides + 1;
            Room(n * ring + 2 * (ring + 1), (n - 1) * sides * 6 + 2 * sides * 3);
            float r = diameter / 2, lay = LayPerDiameter * diameter, along = 0;
            Vector3 side = Vector3.Zero;
            int first = Verts;
            for (int p = 0; p < n; p++)
            {
                var t = path[Math.Min(n - 1, p + 1)] - path[Math.Max(0, p - 1)];
                t = t.LengthSquared() < 1e-12f ? Vector3.Up : t.Normalized();
                if (p == 0)
                {
                    var up = MathF.Abs(t.Y) > 0.9f ? Vector3.Right : Vector3.Up;
                    side = t.Cross(up).Normalized();
                }
                else
                {
                    along += path[p].DistanceTo(path[p - 1]);
                    side = (side - t * side.Dot(t));
                    side = side.LengthSquared() < 1e-10f ? t.Cross(MathF.Abs(t.Y) > 0.9f ? Vector3.Right : Vector3.Up).Normalized() : side.Normalized();
                }
                var b = t.Cross(side);
                float u = along / lay;
                float wet = Math.Max(float.IsNaN(water) ? 0 : WaterWet(path[p].Y, water), rain * 0.8f);
                var c = Wet(tint, wet);
                for (int s = 0; s < ring; s++)
                {
                    float a = MathF.Tau * s / sides;
                    var nrm = side * MathF.Cos(a) + b * MathF.Sin(a);
                    int vi = Verts + p * ring + s;
                    // (uv2: the radius, and 1 for a side the Rope shader may widen to half a pixel far off)
                    pos[vi] = path[p] + nrm * r; nor[vi] = nrm; uv[vi] = new Vector2(u, (float)s / sides); uv2[vi] = new Vector2(r, 1); col[vi] = c;
                }
            }
            for (int p = 0; p < n - 1; p++)
                for (int s = 0; s < sides; s++)
                {
                    int a = first + p * ring + s, bb = a + 1, cc = first + (p + 1) * ring + s + 1, dd = first + (p + 1) * ring + s;
                    // (clockwise from outside: Godot's front)
                    idx[Indices++] = a; idx[Indices++] = cc; idx[Indices++] = bb;
                    idx[Indices++] = a; idx[Indices++] = dd; idx[Indices++] = cc;
                }
            Verts += n * ring;
            Cap(path[0], path[0] - path[1], first, ring, sides, r);
            Cap(path[n - 1], path[n - 1] - path[n - 2], first + (n - 1) * ring, ring, sides, r);
        }

        /// <summary>A flat end: the cut face of the rope, its rim the ring at `rim`.</summary>
        private void Cap(Vector3 at, Vector3 outward, int rim, int ring, int sides, float r)
        {
            var o = outward.LengthSquared() < 1e-12f ? Vector3.Up : outward.Normalized();
            int c0 = Verts;
            pos[c0] = at; nor[c0] = o; uv[c0] = new Vector2(0, 0.5f); uv2[c0] = Vector2.Zero; col[c0] = col[rim];
            for (int s = 0; s < ring; s++)
            {
                int vi = c0 + 1 + s;
                pos[vi] = pos[rim + s]; nor[vi] = o; uv[vi] = new Vector2((pos[rim + s] - at).Length() / r * 0.1f, (float)s / sides); uv2[vi] = Vector2.Zero; col[vi] = col[rim + s];
            }
            // wound so its face looks out along `o` (the end's two directions give opposite windings)
            bool flip = (pos[c0 + 2] - pos[c0 + 1]).Cross(pos[c0 + 1] - at).Dot(o) > 0;
            for (int s = 0; s < sides; s++)
            {
                idx[Indices++] = c0;
                idx[Indices++] = flip ? c0 + 1 + s : c0 + 2 + s;
                idx[Indices++] = flip ? c0 + 2 + s : c0 + 1 + s;
            }
            Verts += ring + 1;
        }

        /// <summary>Put what was added into `mesh` as its one surface (none when nothing was added). Exact arrays are
        /// kept while the counts stay the same, so a rope that only moves allocates nothing here.</summary>
        public void Commit(ArrayMesh mesh, Material? mat)
        {
            mesh.ClearSurfaces();
            if (Verts == 0) return;
            if (outPos.Length != Verts) { outPos = new Vector3[Verts]; outNor = new Vector3[Verts]; outUv = new Vector2[Verts]; outUv2 = new Vector2[Verts]; outCol = new Color[Verts]; }
            if (outIdx.Length != Indices) outIdx = new int[Indices];
            Array.Copy(pos, outPos, Verts); Array.Copy(nor, outNor, Verts); Array.Copy(uv, outUv, Verts); Array.Copy(uv2, outUv2, Verts); Array.Copy(col, outCol, Verts);
            Array.Copy(idx, outIdx, Indices);
            arrays[(int)Mesh.ArrayType.Vertex] = outPos;
            arrays[(int)Mesh.ArrayType.Normal] = outNor;
            arrays[(int)Mesh.ArrayType.TexUV] = outUv;
            arrays[(int)Mesh.ArrayType.TexUV2] = outUv2;
            arrays[(int)Mesh.ArrayType.Color] = outCol;
            arrays[(int)Mesh.ArrayType.Index] = outIdx;
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, noBlends, noLods);
            if (mat != null) mesh.SurfaceSetMaterial(0, mat);
        }

        /// <summary>The colours added (for a static rope that is wetted again later).</summary>
        public Color[] Colours() => col[..Verts];
    }

    // ------------------------------------------------------------------ line sets made into ropes

    private sealed class Static
    {
        public ArrayMesh Mesh = null!;
        public Godot.Collections.Array Arrays = null!;
        public Color[] Dry = null!;
        public Color[] Now = null!;
    }
    private static readonly Dictionary<(ulong, int), ArrayMesh> made = new();
    private static readonly List<Static> statics = new();
    private static float staticWet;
    public static int Converted { get; private set; }

    /// <summary>
    /// A line set (pairs of points, the old one-pixel rigging) as ropes, made once per mesh and scale: lines meeting end
    /// to end in a near straight run become one rope; `kindOf` gives each rope its kind from its ends and length (in
    /// metres). `scale`: the world's metres per mesh unit where it is drawn.
    /// </summary>
    public static ArrayMesh? FromLines(Mesh lines, float scale, Func<Vector3, Vector3, float, Kind> kindOf)
    {
        var key = (lines.GetRid().Id, (int)MathF.Round(scale * 1000));
        if (made.TryGetValue(key, out var had)) return had;
        var segs = new List<(Vector3 A, Vector3 B)>();
        for (int s = 0; s < lines.GetSurfaceCount(); s++)
        {
            var arrays = lines.SurfaceGetArrays(s);
            var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var ix = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? null : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            var prim = Primitive(lines, s);
            int count = ix?.Length ?? v.Length;
            int V(int i) => ix == null ? i : ix[i];
            if (prim == Mesh.PrimitiveType.Lines) for (int i = 0; i + 1 < count; i += 2) segs.Add((v[V(i)], v[V(i + 1)]));
            else if (prim == Mesh.PrimitiveType.LineStrip) for (int i = 0; i + 1 < count; i++) segs.Add((v[V(i)], v[V(i + 1)]));
        }
        var tube = new Tube();
        tube.Begin();
        foreach (var path in Chains(segs))
        {
            float len = 0;
            for (int i = 1; i < path.Count; i++) len += path[i].DistanceTo(path[i - 1]);
            var kind = kindOf(path[0], path[^1], len * scale);
            tube.Add(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(path), Diameter(kind) / scale, Sides(kind), Tint(kind), float.NaN, staticWet);
        }
        if (tube.Verts == 0) return null;
        var mesh = new ArrayMesh { ResourceName = "ropes" };
        tube.Commit(mesh, Material);
        var st = new Static { Mesh = mesh, Arrays = mesh.SurfaceGetArrays(0), Dry = new Color[tube.Verts] };
        // the dry colours: undo the rain's share the tube put in (staticWet is 0 at load)
        Array.Copy(st.Arrays[(int)Mesh.ArrayType.Color].AsColorArray(), st.Dry, st.Dry.Length);
        st.Now = (Color[])st.Dry.Clone();
        statics.Add(st);
        made[key] = mesh;
        return mesh;
    }

    /// <summary>Segments joined end to end (both ends shared by exactly two, bending less than 50 degrees) into runs.</summary>
    private static List<List<Vector3>> Chains(List<(Vector3 A, Vector3 B)> segs)
    {
        static (long, long, long) Q(Vector3 p) => ((long)MathF.Round(p.X * 500), (long)MathF.Round(p.Y * 500), (long)MathF.Round(p.Z * 500));
        var at = new Dictionary<(long, long, long), List<int>>();
        for (int i = 0; i < segs.Count; i++)
        {
            if (segs[i].A.DistanceSquaredTo(segs[i].B) < 1e-8f) continue;
            foreach (var p in new[] { segs[i].A, segs[i].B })
            {
                if (!at.TryGetValue(Q(p), out var l)) at[Q(p)] = l = new List<int>(2);
                l.Add(i);
            }
        }
        var used = new bool[segs.Count];
        var runs = new List<List<Vector3>>();
        int? Next(Vector3 end, Vector3 dir, int from)
        {
            if (!at.TryGetValue(Q(end), out var l) || l.Count != 2) return null;
            int o = l[0] == from ? l[1] : l[0];
            if (used[o]) return null;
            var (a, b) = segs[o];
            var d2 = (Q(a) == Q(end) ? b - a : a - b).Normalized();
            return dir.Dot(d2) > MathF.Cos(Mathf.DegToRad(50)) ? o : null;
        }
        for (int i = 0; i < segs.Count; i++)
        {
            if (used[i] || segs[i].A.DistanceSquaredTo(segs[i].B) < 1e-8f) continue;
            used[i] = true;
            var run = new LinkedList<Vector3>(new[] { segs[i].A, segs[i].B });
            // forward from B, then back from A
            for (int pass = 0; pass < 2; pass++)
            {
                int cur = i;
                while (true)
                {
                    var end = pass == 0 ? run.Last!.Value : run.First!.Value;
                    var prev = pass == 0 ? run.Last.Previous!.Value : run.First.Next!.Value;
                    var nx = Next(end, (end - prev).Normalized(), cur);
                    if (nx is not int o) break;
                    used[o] = true; cur = o;
                    var (a, b) = segs[o];
                    var far = Q(a) == Q(end) ? b : a;
                    if (pass == 0) run.AddLast(far); else run.AddFirst(far);
                }
            }
            runs.Add(run.ToList());
        }
        return runs;
    }

    /// <summary>The rigging of a vessel or crane model by its node's name: the cranes' falls are wire, a gate's balance chain iron; a ship's
    /// shrouds and stays (long) tarred standing rigging, her ratlines (short and level) thin, the rest running rigging.</summary>
    public static Func<Vector3, Vector3, float, Kind> RiggingKinds(string name)
    {
        if (name.Contains("jib_rigging")) return (_, _, _) => Kind.Wire;
        if (name.Contains("gate_leaf") || name.Contains("chains")) return (_, _, _) => Kind.Chain;
        if (name == "angler") return (_, _, _) => Kind.Twine;
        return (a, b, len) =>
        {
            float rise = MathF.Abs(a.Y - b.Y) / MathF.Max(a.DistanceTo(b), 1e-4f);
            if (len < 1.8f && rise < 0.35f) return Kind.Ratline;
            return len > 5f ? Kind.Standing : Kind.Running;
        };
    }

    /// <summary>
    /// Every line set under `root` that is rope or rigging (by its name: "rigging", "chains"; the Steen angler's line) drawn as ropes now: its mesh
    /// swapped for the tubes (shared by every copy of that mesh), drawn in the rope material. Safe to call again: a
    /// swapped node has triangles. Returns how many nodes were swapped.
    /// </summary>
    public static int ConvertAll(Node root)
    {
        int n = 0;
        foreach (var node in BakedWorld.All(root))
        {
            if (node is not GeometryInstance3D g) continue;
            string name = node.Name.ToString();
            // (the angler's line at the Steen: a bare line set in the Steen's life group)
            if (node.GetParent()?.GetParent()?.Name == "steenlife") name = "angler";
            if (!name.Contains("rigging") && !name.Contains("chains") && name != "angler") continue;
            Mesh? m = (g as MeshInstance3D)?.Mesh ?? (g as MultiMeshInstance3D)?.Multimesh?.Mesh;
            if (m == null || m.GetSurfaceCount() == 0 || Primitive(m, 0) is not (Mesh.PrimitiveType.Lines or Mesh.PrimitiveType.LineStrip)) continue;
            if (m is not ArrayMesh) continue; // (a RopeLines' immediate mesh draws itself as tubes)
            float scale = g is MeshInstance3D mi ? mi.GlobalTransform.Basis.Scale.X : 1;
            if (!(scale > 1e-4f)) scale = 1;
            var tubes = FromLines(m, scale, RiggingKinds(name));
            if (tubes == null) continue;
            if (g is MeshInstance3D mesh) mesh.Mesh = tubes;
            else ((MultiMeshInstance3D)g).Multimesh!.Mesh = tubes;
            g.MaterialOverride = null;
            g.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
            n++;
        }
        Converted += n;
        return n;
    }

    /// <summary>The rain on the line sets made into ropes: their colours again when the wet has changed by a tenth.</summary>
    public static void RainOnStatics()
    {
        float wet = RainWet;
        if (MathF.Abs(wet - staticWet) < 0.1f && !(wet == 0 && staticWet > 0)) return;
        staticWet = wet;
        foreach (var st in statics)
        {
            for (int i = 0; i < st.Dry.Length; i++) st.Now[i] = Wet(st.Dry[i], wet * 0.8f);
            st.Arrays[(int)Mesh.ArrayType.Color] = st.Now;
            var mat = st.Mesh.SurfaceGetMaterial(0);
            st.Mesh.ClearSurfaces();
            st.Mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, st.Arrays);
            st.Mesh.SurfaceSetMaterial(0, mat);
        }
    }

    // ------------------------------------------------------------------ checks

    /// <summary>Every visible mesh under `root` drawn as lines (a rope with no thickness).</summary>
    public static List<GeometryInstance3D> LineMeshes(Node root)
    {
        var found = new List<GeometryInstance3D>();
        foreach (var n in BakedWorld.All(root))
        {
            if (n is not GeometryInstance3D g) continue;
            Mesh? m = (g as MeshInstance3D)?.Mesh ?? (g as MultiMeshInstance3D)?.Multimesh?.Mesh;
            if (m == null || !g.IsVisibleInTree()) continue;
            for (int s = 0; s < m.GetSurfaceCount(); s++)
                if (Primitive(m, s) is Mesh.PrimitiveType.Lines or Mesh.PrimitiveType.LineStrip) { found.Add(g); break; }
        }
        return found;
    }

    /// <summary>How a mesh's surface is drawn (ArrayMesh, ImmediateMesh or any other).</summary>
    public static Mesh.PrimitiveType Primitive(Mesh m, int surface) => m is ArrayMesh am ? am.SurfaceGetPrimitiveType(surface)
        : (Mesh.PrimitiveType)RenderingServer.MeshGetSurface(m.GetRid(), surface)["primitive"].AsInt32();

    /// <summary>A surface's vertex count, whatever kind of mesh.</summary>
    public static int Verts(Mesh m, int surface) => m is ArrayMesh am ? am.SurfaceGetArrayLen(surface)
        : RenderingServer.MeshGetSurface(m.GetRid(), surface)["vertex_count"].AsInt32();

    public static object Report() => new
    {
        converted = Converted,
        lineSets = statics.Count,
        lineSetTriangles = statics.Sum(s => s.Arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length / 3),
        material = Material?.ResourceName,
        kinds = Enum.GetValues<Kind>().Select(k => new { kind = k.ToString(), diameter = Diameter(k), sides = Sides(k) }).ToArray(),
        rainWet = staticWet,
    };
}
