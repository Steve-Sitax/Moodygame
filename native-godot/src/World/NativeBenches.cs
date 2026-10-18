using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Play;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// The town's benches (#165). The bake drew its benches as plain boxes inside bigger meshes; each known sleep bench
/// (the engine's list, native-rules.json "benches") has its old parts cut out of those meshes (whole parts only: every
/// connected piece standing wholly within 1.25 m of the bench and reaching above the kerbs) and the new model set
/// in their place, turned as the old one was (its long side, its back). Good quarters get the cast-iron park bench in
/// fresh paint; the docks, the wall and the back lanes the weathered plank bench. The benches authored in the
/// districts' object scenes join the same list. BenchPlaces keeps where each stands for sitting and sleeping.
/// </summary>
public static class NativeBenches
{
    public const string SwapMeta = "native_bench_swap";
    public const string SleepMeta = "sleep_bench";
    public const string LabelMeta = "bench_label";
    private const float Reach = 1.25f, Touch = 1.6f, Above = .25f, Top = 1.25f;
    public static readonly Dictionary<string, string> Assets = new()
    {
        ["bench_park_fine"] = "res://recovered/street-props-20261015/props/park-bench-iron.tres",
        ["bench_park_worn"] = "res://assets/library/park-bench-iron-worn.tres",
        ["bench_plank_fine"] = "res://assets/library/bench.tres",
        ["bench_plank_worn"] = "res://assets/library/bench-worn.tres",
    };
    public static readonly Dictionary<string, string> ModelOfAsset = new()
    {
        ["park-bench-iron"] = "bench_park_fine", ["park-bench-iron-worn"] = "bench_park_worn", ["bench"] = "bench_plank_fine", ["bench-worn"] = "bench_plank_worn",
    };
    // Stops in the good streets get the oiled plank bench; the docks', the market's and the ramparts' the weathered one.
    private static readonly HashSet<string> GoodStops = new() { "grote_markt", "sint_jorispoort", "stadspark", "cathedral", "meir", "sint_jacob", "kipdorppoort", "keizerspoort", "conscienceplein" };

    public static string ModelFor(string id)
    {
        if (id.StartsWith("rond:") || id.StartsWith("park:") || id.StartsWith("green:lijnwaadmarkt")) return "bench_park_fine";
        if (id.StartsWith("green:stjacob_yard")) return "bench_park_worn";
        if (id.StartsWith("stop:")) return GoodStops.Contains(id.Split(':')[1]) ? "bench_plank_fine" : "bench_plank_worn";
        return "bench_plank_worn"; // the Steen, the court green, the wall walk
    }

    public sealed record Result(int Benches, int Swapped, int Triangles, List<string> Notes);
    private sealed record Known(string Id, string Label, float X, float Y, float Z, bool Fine);

    private static List<Known> Read(string rules)
    {
        var list = new List<Known>();
        if (!File.Exists(rules)) return list;
        using var doc = JsonDocument.Parse(File.ReadAllText(rules));
        if (!doc.RootElement.TryGetProperty("benches", out var benches)) return list;
        foreach (var b in benches.EnumerateArray())
            list.Add(new(b.GetProperty("id").GetString()!, b.GetProperty("label").GetString() ?? "a bench", b.GetProperty("x").GetSingle(), b.TryGetProperty("y", out var y) ? y.GetSingle() : 0, b.GetProperty("z").GetSingle(), b.TryGetProperty("fine", out var f) && f.GetBoolean()));
        return list;
    }

    private static Transform3D Frame(Node node, Node town)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n != null && n != town; n = n.GetParent()) if (n is Node3D n3) xf = n3.Transform * xf;
        return xf;
    }

    private sealed class Surface
    {
        public MeshInstance3D Mesh = null!; public int Index; public Vector3[] V = null!; public int[] I = null!; public Transform3D Xf;
        public readonly HashSet<int> Cut = new();
        private Dictionary<(int, int), List<int>>? cells;
        /// <summary>The triangles whose bounds reach into 2 m cells near a point (built once per surface).</summary>
        public IEnumerable<int> Near(Vector2 c, float r)
        {
            if (cells == null)
            {
                cells = new();
                for (int t = 0; t + 2 < I.Length; t += 3)
                {
                    var a = V[I[t]]; var b = V[I[t + 1]]; var d = V[I[t + 2]];
                    int x0 = (int)MathF.Floor(MathF.Min(a.X, MathF.Min(b.X, d.X)) / 2), x1 = (int)MathF.Floor(MathF.Max(a.X, MathF.Max(b.X, d.X)) / 2);
                    int z0 = (int)MathF.Floor(MathF.Min(a.Z, MathF.Min(b.Z, d.Z)) / 2), z1 = (int)MathF.Floor(MathF.Max(a.Z, MathF.Max(b.Z, d.Z)) / 2);
                    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) { x1 = x0; z1 = z0; } // a huge triangle (a ground sheet) is never a bench part
                    for (int x = x0; x <= x1; x++) for (int z = z0; z <= z1; z++) { if (!cells.TryGetValue((x, z), out var l)) cells[(x, z)] = l = new(); l.Add(t); }
                }
            }
            var seen = new HashSet<int>();
            for (int x = (int)MathF.Floor((c.X - r) / 2); x <= (int)MathF.Floor((c.X + r) / 2); x++)
                for (int z = (int)MathF.Floor((c.Y - r) / 2); z <= (int)MathF.Floor((c.Y + r) / 2); z++)
                    if (cells.TryGetValue((x, z), out var l)) foreach (int t in l) if (seen.Add(t)) yield return t;
        }
    }

    /// <summary>Cuts the old benches and sets the new ones; call before collision and navigation read the meshes.</summary>
    public static Result Swap(Node3D town, string rulesPath)
    {
        var notes = new List<string>();
        var known = Read(rulesPath);
        if (known.Count == 0) { notes.Add("no bench list at " + rulesPath); return new(0, 0, 0, notes); }
        var meshes = BakedWorld.All(town).OfType<MeshInstance3D>()
            .Where(m => m.Mesh is ArrayMesh && m.Visible && !m.HasMeta("native_replaced_event_snapshot") && !IsAuthored(m, town) && BenchGroup(m, town))
            .Select(m => (m, xf: Frame(m, town))).Select(p => (p.m, p.xf, box: p.xf * p.m.GetAabb())).ToList();
        var surfaces = new Dictionary<(ulong, int), Surface>();
        int swapped = 0, triangles = 0;
        foreach (var b in known)
        {
            var centre = new Vector2(b.X, b.Z);
            var pieces = new List<Piece>();
            foreach (var (m, xf, box) in meshes)
            {
                if (box.Position.X > b.X + Touch || box.End.X < b.X - Touch || box.Position.Z > b.Z + Touch || box.End.Z < b.Z - Touch || box.Position.Y > b.Y + Top || box.End.Y < b.Y - .1f) continue;
                var mesh = (ArrayMesh)m.Mesh;
                for (int si = 0; si < mesh.GetSurfaceCount(); si++)
                {
                    if (mesh.SurfaceGetPrimitiveType(si) != Mesh.PrimitiveType.Triangles) continue;
                    if (!surfaces.TryGetValue((m.GetInstanceId(), si), out var s))
                    {
                        var arrays = mesh.SurfaceGetArrays(si);
                        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                        var idx = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                        s = surfaces[(m.GetInstanceId(), si)] = new Surface { Mesh = m, Index = si, V = v.Select(p => xf * p).ToArray(), I = idx, Xf = xf };
                    }
                    pieces.AddRange(Pieces(s, centre, b.Y));
                }
            }
            // the seat: flat long pieces at sitting height (planks or slats)
            var seats = pieces.Where(p => p.Inside && p.Max.Y - p.Min.Y < .13f && p.Max.Y > b.Y + .30f && p.Max.Y < b.Y + .62f && new Vector2(p.Max.X - p.Min.X, p.Max.Z - p.Min.Z).Length() > 1.0f).ToList();
            if (seats.Count == 0) { notes.Add($"{b.Id}: no old seat found; left as baked"); continue; }
            var (axis, mid, half, width) = Axis(seats.SelectMany(p => p.Points).ToList());
            var side = new Vector2(-axis.Y, axis.X);
            float seatTop = seats.Max(p => p.Max.Y);
            Vector2 Rel(Vector3 q) { var d = new Vector2(q.X - mid.X, q.Z - mid.Y); return new(d.Dot(axis), d.Dot(side)); }
            bool Within(Vector3 q, float across, float top) { var r = Rel(q); return Math.Abs(r.X) <= half + .1f && Math.Abs(r.Y) <= width / 2 + across && q.Y >= b.Y - .05f && q.Y <= top; }
            // a backrest: a long piece above the seat, just behind it; the wall's own stones beside a stone bench are not one
            var backs = pieces.Where(p => p.Max.Y > seatTop + .2f && p.Points.All(q => Within(q, .35f, b.Y + 1.15f))
                && p.Points.Max(q => Rel(q).X) - p.Points.Min(q => Rel(q).X) > 1.0f).ToList();
            bool back = backs.Count > 0;
            float reach = back ? .35f : .10f, top = back ? b.Y + 1.15f : seatTop + .05f;
            var cut = pieces.Where(p => p.Max.Y > b.Y + .09f && p.Points.All(q => Within(q, reach, top))).ToList();
            int count = cut.Sum(p => p.Tris.Count);
            foreach (var p in cut) foreach (int t in p.Tris) p.S.Cut.Add(t);
            triangles += count;
            // its back: the side the backrest stands on; with none, the side the parapet or wall stands on
            float lean = back ? backs.SelectMany(p => p.Points).Average(q => Rel(q).Y)
                : pieces.Where(p => !cut.Contains(p)).SelectMany(p => p.Points).Where(q => q.Y > b.Y + .8f).Select(Rel)
                    .Where(r => Math.Abs(r.X) < half && Math.Abs(r.Y) < 1.4f).Select(r => r.Y).DefaultIfEmpty(0).Average();
            var front = lean > 0 ? -side : side;
            // a stop's bench faces the way its waiting sitter does (Omnibus)
            if (b.Id.StartsWith("stop:") && Scheldemist.Movers.Omnibus.StopBenchYaw(b.X, b.Z) is { } stopYaw) front = new Vector2(MathF.Sin(stopYaw), MathF.Cos(stopYaw));
            float yaw = MathF.Atan2(front.X, front.Y);
            string model = ModelFor(b.Id);
            if (ResourceLoader.Load<AuthorAsset>(Assets[model]) is not { } asset) { notes.Add("no asset " + Assets[model]); continue; }
            var seat = new AuthoredObject { Name = "bench_" + b.Id.Replace(':', '_'), ObjectId = "bench-" + b.Id.Replace(':', '-'), Asset = asset };
            seat.Position = new Vector3(mid.X, b.Y, mid.Y) + new Vector3(front.X, 0, front.Y) * .03f;
            seat.Rotation = new Vector3(0, yaw, 0);
            seat.SetMeta(SwapMeta, true);
            seat.SetMeta(SleepMeta, b.Id);
            seat.SetMeta(LabelMeta, b.Label);
            town.AddChild(seat);
            swapped++;
            notes.Add($"{b.Id}: {count} triangles from {string.Join(", ", cut.GroupBy(p => p.S.Mesh.Name.ToString()).Select(g => g.Key + " " + g.Sum(p => p.Tris.Count)))}; seat {half * 2:0.00} m{(back ? "" : ", no back")}");
        }
        foreach (var s in surfaces.Values.Where(s => s.Cut.Count > 0).GroupBy(s => s.Mesh))
            Rebuild(s.Key, s.ToList());
        notes.Add($"{swapped} of {known.Count} benches given the new model, {triangles} old triangles cut");
        return new(known.Count, swapped, triangles, notes);
    }

    // The bake drew its benches in these groups only (the squares and greens, the stops' posts, the Steen's
    // promontory, the park, the wall walk); the houses' and the ground's big meshes are never searched.
    private static readonly string[] Groups = { "townplaces", "steenlife", "churches", "town_wall", "town_wall_props" };
    private static bool BenchGroup(Node m, Node town)
    {
        if (m.Name.ToString() == "omnibus_posts") return true;
        for (Node? p = m.GetParent(); p != null && p != town; p = p.GetParent()) if (Array.IndexOf(Groups, p.Name.ToString()) >= 0) return true;
        return m.GetParent() is { } top && top.GetParent() == town && Array.IndexOf(Groups, top.Name.ToString()) >= 0;
    }

    private static bool IsAuthored(Node n, Node town)
    {
        for (Node? p = n; p != null && p != town; p = p.GetParent()) if (p is AuthoredObject || p.HasMeta("native_author_district")) return true;
        return false;
    }

    private sealed class Piece
    {
        public Surface S = null!; public readonly List<int> Tris = new(); public readonly List<Vector3> Points = new();
        public Vector3 Min = Vector3.One * float.MaxValue, Max = Vector3.One * float.MinValue; public bool Inside = true;
    }

    // People, railings and loose goods share the bake's meshes near benches: never theirs to cut.
    private static bool Foreign(string name) => name.Contains("_body") || name.Contains("_lod") || name.Contains("railing") || name.Contains("clutter")
        || name.Contains("goods") || name.Contains("vegetation") || name.Contains("lamp") || name.StartsWith("INST");

    /// <summary>The whole connected pieces of this surface near the bench (sharing corner positions); Inside when all of a
    /// piece stands within Reach of the bench and below Top.</summary>
    private static List<Piece> Pieces(Surface s, Vector2 c, float y)
    {
        if (Foreign(s.Mesh.Name.ToString())) return new();
        var touching = new List<int>();
        foreach (int t in s.Near(c, Touch))
        {
            var a = s.V[s.I[t]]; var b = s.V[s.I[t + 1]]; var d = s.V[s.I[t + 2]];
            if (Flat(a, c) < Touch || Flat(b, c) < Touch || Flat(d, c) < Touch) touching.Add(t);
        }
        if (touching.Count == 0) return new();
        var parent = new int[touching.Count];
        for (int i = 0; i < parent.Length; i++) parent[i] = i;
        int Find(int i) { while (parent[i] != i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
        var at = new Dictionary<(long, long, long), int>();
        for (int k = 0; k < touching.Count; k++)
            for (int j = 0; j < 3; j++)
            {
                var p = s.V[s.I[touching[k] + j]];
                var key = ((long)Math.Round(p.X * 1000), (long)Math.Round(p.Y * 1000), (long)Math.Round(p.Z * 1000));
                if (at.TryGetValue(key, out int other)) { int ra = Find(k), rb = Find(other); if (ra != rb) parent[ra] = rb; }
                else at[key] = k;
            }
        var groups = new Dictionary<int, Piece>();
        for (int k = 0; k < touching.Count; k++)
        {
            int r = Find(k), t = touching[k];
            if (!groups.TryGetValue(r, out var g)) groups[r] = g = new Piece { S = s };
            g.Tris.Add(t);
            for (int j = 0; j < 3; j++)
            {
                var p = s.V[s.I[t + j]];
                g.Points.Add(p); g.Min = g.Min.Min(p); g.Max = g.Max.Max(p);
                if (Flat(p, c) > Reach || p.Y < y - .05f || p.Y > y + Top) g.Inside = false;
            }
        }
        return groups.Values.ToList();
    }

    private static float Flat(Vector3 p, Vector2 c) => new Vector2(p.X - c.X, p.Z - c.Y).Length();

    /// <summary>The seat's long axis (the principal axis of its points), its middle, its half length and its depth.</summary>
    private static (Vector2 axis, Vector2 mid, float half, float width) Axis(List<Vector3> pts)
    {
        float mx = pts.Average(p => p.X), mz = pts.Average(p => p.Z);
        double sxx = 0, szz = 0, sxz = 0;
        foreach (var p in pts) { double dx = p.X - mx, dz = p.Z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
        double angle = .5 * Math.Atan2(2 * sxz, sxx - szz);
        var axis = new Vector2((float)Math.Cos(angle), (float)Math.Sin(angle));
        var side = new Vector2(-axis.Y, axis.X);
        float a0 = float.MaxValue, a1 = float.MinValue, s0 = float.MaxValue, s1 = float.MinValue;
        foreach (var p in pts)
        {
            var d = new Vector2(p.X - mx, p.Z - mz);
            a0 = Math.Min(a0, d.Dot(axis)); a1 = Math.Max(a1, d.Dot(axis)); s0 = Math.Min(s0, d.Dot(side)); s1 = Math.Max(s1, d.Dot(side));
        }
        return (axis, new Vector2(mx, mz) + axis * (a0 + a1) / 2 + side * (s0 + s1) / 2, (a1 - a0) / 2, s1 - s0);
    }

    private static void Rebuild(MeshInstance3D m, List<Surface> cut)
    {
        var src = (ArrayMesh)m.Mesh;
        var mesh = new ArrayMesh { ResourceName = src.ResourceName };
        for (int si = 0; si < src.GetSurfaceCount(); si++)
        {
            var arrays = src.SurfaceGetArrays(si);
            var s = cut.FirstOrDefault(c => c.Index == si);
            if (s != null)
            {
                var keep = new List<int>(s.I.Length);
                for (int t = 0; t + 2 < s.I.Length; t += 3) if (!s.Cut.Contains(t)) { keep.Add(s.I[t]); keep.Add(s.I[t + 1]); keep.Add(s.I[t + 2]); }
                if (keep.Count == 0) continue; // the surface was all bench: it goes
                arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
            }
            mesh.AddSurfaceFromArrays(src.SurfaceGetPrimitiveType(si), arrays, flags: (Mesh.ArrayFormat)((long)src.SurfaceGetFormat(si) & (0xFFFL << 13)));
            int made = mesh.GetSurfaceCount() - 1;
            mesh.SurfaceSetMaterial(made, src.SurfaceGetMaterial(si));
            mesh.SurfaceSetName(made, src.SurfaceGetName(si));
        }
        foreach (var key in src.GetMetaList()) mesh.SetMeta(key, src.GetMeta(key));
        if (mesh.GetSurfaceCount() == 0) { m.Visible = false; m.SetMeta("native_replaced_visual", true); return; }
        m.Mesh = mesh;
    }

    /// <summary>Every bench in the town (the new models of the old ones, and those authored in the districts) into
    /// BenchPlaces, after the layouts are in.</summary>
    public static int Index(Node3D town)
    {
        BenchPlaces.Clear();
        foreach (var o in BakedWorld.All(town).OfType<AuthoredObject>())
        {
            if (o.Asset == null || !ModelOfAsset.TryGetValue(o.Asset.Id, out var model)) continue;
            string id = o.HasMeta(SleepMeta) ? o.GetMeta(SleepMeta).AsString() : o.ObjectId;
            string label = o.HasMeta(LabelMeta) ? o.GetMeta(LabelMeta).AsString() : model.EndsWith("_fine") ? "a bench" : "an old bench";
            BenchPlaces.Set(new(id, model, Frame(o, town), model.EndsWith("_fine"), label));
        }
        return BenchPlaces.All.Count;
    }
}
