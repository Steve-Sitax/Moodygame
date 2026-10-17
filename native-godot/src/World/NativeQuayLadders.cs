using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// The quay ladders of the native town (issue 85). The bake kept the browser's ladders as plain boxes merged into the
/// quay iron (quay_iron: the flights and the pier; quay_iron2: the wall and boat ladders), standing 0.11 m off the
/// quay line, so their stiles ran through the coping (it overhangs the wall by about 0.235 m) and their hoops went
/// down into the stone. At load this finds each of them in that iron, takes its boxes out of the mesh (the stored
/// scene stays as it is), measures the stone around it (wall face, coping face and top, the quay behind) from the
/// drawn quay meshes, and puts the one ladder model (<see cref="NativeQuayLadderModel"/>) there, clear of the stone.
/// Its triangles are its collision (World/Solid.cs), and its rungs give the climb (QuayExits): one model, one truth.
/// </summary>
public static class NativeQuayLadders
{
    /// <summary>Rung line this far in front of the nearest stone behind it (toe room, as the issue asks: 0.15-0.18 m).</summary>
    public const float Clear = 0.17f;
    /// <summary>The longest strap from a stile sideways to a pile (issue 95).</summary>
    public const float TieReach = 1.6f;
    /// <summary>On the ladders' node: Solid makes no wall of the drawn ladders, their own bodies are their collision.</summary>
    public const string LeaveMeta = "native_quay_ladders";
    /// <summary>What a ladder stands against or on: wall, coping, flights and the pier.</summary>
    private static readonly HashSet<string> Stone = new() { "quay_walls", "quay_coping", "quay_steps", "pier_deck", "pier_timber", "pier_strakes" };
    /// <summary>And the ground behind the edge, for the rays down only.</summary>
    private static readonly HashSet<string> Ground = new() { "ground_quay", "ground_cobble", "ground_flags" };

    public sealed class Result
    {
        public readonly List<QuayExits.Ladder> Ladders = new();
        public int Meshes, RemovedTriangles, CollisionShapes;
        public double Ms;
        public readonly List<string> Notes = new();
    }

    private readonly record struct Frame(Vector3 O, Vector3 T, Vector3 N)
    {
        public Vector3 At(float x, float y, float z) => new(O.X + T.X * x + N.X * z, y, O.Z + T.Z * x + N.Z * z);
        public Basis Basis => new(T, Vector3.Up, N);
    }

    /// <summary>
    /// A node's recovered name: the town keeps its meshes as the root's children under their own names; the district
    /// slice keeps them nested in wrapper nodes and renames them only when the game starts, so the bake's name is in
    /// the node's `source_name` metadata.
    /// </summary>
    private static bool Is(Node node, Func<string, bool> wanted)
        => wanted(node.Name.ToString()) || node.HasMeta("source_name") && wanted(node.GetMeta("source_name").AsString());

    /// <summary>
    /// Replace the baked ladders under `root` (the town's scene, or a district slice's: any depth) with the native
    /// ladder, before the root is in the tree. Returns the ladders for the climb (QuayExits via BakedWorld.NativeQuayLadders).
    /// A mesh that carries its own stored collision (the slice's `Solid` body) gets that shape rebuilt from the
    /// iron that is left, so no solid ladder stands where the old one was.
    /// </summary>
    public static Result Install(Node3D root)
    {
        var town = root;
        var result = new Result();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var irons = BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh != null && Is(m, name => name.StartsWith("quay_iron"))).ToArray();
        if (irons.Length == 0) return result;
        Material? material = null;
        var found = new List<(QuayExits.Ladder L, MeshInstance3D From)>();
        foreach (var iron in irons)
        {
            material ??= iron.Mesh.SurfaceGetMaterial(0);
            foreach (var l in QuayExits.FindLadders(iron, Pose(iron, town))) found.Add((l, iron));
        }
        if (material == null || found.Count == 0) return result;
        var frames = found.Select(f => new Frame(new Vector3(f.L.X, 0, f.L.Z), new Vector3(f.L.Nz, 0, -f.L.Nx), new Vector3(f.L.Nx, 0, f.L.Nz))).ToArray();

        // the browser's boxes out of the iron: everything wholly inside a ladder's own space (its stiles, rungs,
        // brackets and hoops; nothing of a flight comes so near)
        foreach (var iron in irons)
        {
            var mine = Enumerable.Range(0, found.Count).Where(i => found[i].From == iron).ToArray();
            var trimmed = Strip(iron.Mesh, Pose(iron, town), mine.Select(i => (frames[i], found[i].L)).ToArray(), out int removed);
            iron.Mesh = trimmed;
            result.RemovedTriangles += removed;
            // (a stored collision shape was made from the old iron, ladders included)
            foreach (var shape in iron.GetChildren().OfType<StaticBody3D>().SelectMany(b => b.GetChildren().OfType<CollisionShape3D>()).Where(s => s.Shape is ConcavePolygonShape3D))
            {
                shape.Shape = trimmed.GetSurfaceCount() > 0 ? Scheldemist.Native.Recovery.RecoveryIron.Collider(trimmed) : null;
                result.CollisionShapes++;
            }
        }

        var stone = new Triangles(town, frames.Select(f => f.O).ToArray(), Stone);
        var ground = new Triangles(town, frames.Select(f => f.O).ToArray(), Ground);
        var holder = new Node3D { Name = "quay_ladders" };
        holder.SetMeta("native_issue", 85);
        holder.SetMeta(LeaveMeta, true);
        town.AddChild(holder);
        var meshes = new Dictionary<string, (ArrayMesh Mesh, ConcavePolygonShape3D Shape, float[] Rungs)>();
        for (int i = 0; i < found.Count; i++)
        {
            var (l, _) = found[i];
            var f = frames[i];
            // the frame's line on the wall face itself (the baked ladder's line could be a few mm off it)
            float shift = WallShift(stone, f, l);
            f = f with { O = f.O + f.N * shift };
            l.X = f.O.X; l.Z = f.O.Z;
            var fit = Measure(stone, ground, f, l, out string note);
            if (note != "") result.Notes.Add($"ladder at {l.X:0.0}, {l.Z:0.0}: {note}fit {fit.Key}");
            if (!meshes.TryGetValue(fit.Key, out var made)) meshes[fit.Key] = made = (NativeQuayLadderModel.Build(fit, material, out var shape, out var rungs), shape, rungs);
            var mi = new MeshInstance3D { Name = $"quay_ladder_{i}", Mesh = made.Mesh, Transform = new Transform3D(f.Basis, f.O), VisibilityRangeEnd = 160, VisibilityRangeEndMargin = 20 };
            mi.SetMeta("source_name", "quay_ladder");
            // its collision: the same parts, plain (NativeTown puts every static body of the town on the solid layer)
            var body = new StaticBody3D { Name = "collision" };
            body.AddChild(new CollisionShape3D { Shape = made.Shape });
            mi.AddChild(body);
            holder.AddChild(mi);
            l.Rung = fit.RungZ;
            l.Foot = made.Rungs.Length > 0 ? made.Rungs[^1] : NativeQuayLadderModel.FootY;
            l.TopRung = fit.TopRung; l.Pitch = NativeQuayLadderModel.Pitch; l.HoopBack = fit.LegZ;
            result.Ladders.Add(l);
        }
        result.Meshes = meshes.Count;
        result.Ms = Math.Round(clock.Elapsed.TotalMilliseconds);
        return result;
    }

    private static Transform3D Pose(Node3D node, Node root)
    {
        var pose = node.Transform;
        for (var parent = node.GetParent(); parent is Node3D p && p != root; parent = parent.GetParent()) pose = p.Transform * pose;
        return pose;
    }

    private static ArrayMesh Strip(Mesh source, Transform3D xf, (Frame F, QuayExits.Ladder L)[] ladders, out int removed)
    {
        removed = 0;
        var result = new ArrayMesh { ResourceName = source.ResourceName };
        bool Inside(Vector3 p, Frame f, QuayExits.Ladder l)
        {
            var d = p - f.O; float x = d.Dot(f.T), z = d.Dot(f.N);
            return Math.Abs(x) <= 0.3f && z >= -0.42f && z <= 0.2f && p.Y >= l.Foot - 0.4f && p.Y <= l.Top + 1.0f;
        }
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var arrays = source.SurfaceGetArrays(s);
            var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var idx = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            var keep = new List<int>(idx.Length);
            for (int i = 0; i + 2 < idx.Length; i += 3)
            {
                Vector3 a = xf * v[idx[i]], b = xf * v[idx[i + 1]], c = xf * v[idx[i + 2]];
                bool gone = false;
                foreach (var (f, l) in ladders)
                    if (Inside(a, f, l) && Inside(b, f, l) && Inside(c, f, l)) { gone = true; break; }
                if (gone) removed++;
                else { keep.Add(idx[i]); keep.Add(idx[i + 1]); keep.Add(idx[i + 2]); }
            }
            if (keep.Count == 0) continue; // (quay_iron2 held nothing but ladders)
            arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
            result.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            result.SurfaceSetMaterial(result.GetSurfaceCount() - 1, source.SurfaceGetMaterial(s));
        }
        return result;
    }

    /// <summary>How far out from the quay line the face behind the ladder stands a metre under its top (0 when none is near).</summary>
    private static float WallShift(Triangles stone, Frame f, QuayExits.Ladder l)
    {
        var faces = new List<float>();
        foreach (float y in new[] { l.Top - 0.8f, l.Top - 1.2f, l.Top - 1.6f })
            foreach (float x in new[] { -0.2f, 0, 0.2f })
            {
                float d = stone.Ray(f.At(x, y, 2.5f), -f.N, 3.3f);
                if (float.IsFinite(d)) faces.Add(2.5f - d);
            }
        if (faces.Count < 5) return 0;
        faces.Sort();
        float median = faces[faces.Count / 2];
        return Math.Abs(median) < 0.06f ? median : 0;
    }

    private static float Cm(float v) { float r = MathF.Round(v * 100) / 100; return r == 0 ? 0 : r; }

    /// <summary>
    /// The stone at one ladder, by rays against the drawn quay triangles: the outermost face behind the ladder at
    /// any height (on a quay wall: the coping's front), the wall behind each bracket, the top the head rises over,
    /// and the ground behind the edge where the hoops come down.
    /// </summary>
    private static NativeQuayLadderModel.Fit Measure(Triangles stone, Triangles ground, Frame f, QuayExits.Ladder l, out string note)
    {
        note = "";
        float foot = NativeQuayLadderModel.FootY, sx = NativeQuayLadderModel.StileX, hx = NativeQuayLadderModel.HoopX;
        // how far out the face behind the ladder stands at height y, under the given lines across it
        float Face(float y, float[] xs)
        {
            float best = float.NegativeInfinity;
            foreach (float x in xs)
            {
                float d = stone.Ray(f.At(x, y, 2.5f), -f.N, 3.3f);
                if (float.IsFinite(d)) best = Math.Max(best, 2.5f - d);
            }
            return best;
        }
        float[] across = { -0.3f, -0.15f, 0, 0.15f, 0.3f };
        float front = float.NegativeInfinity, copeBottom = float.NaN, below = float.NegativeInfinity;
        for (float y = l.Top + 0.08f; y >= foot; y -= y > l.Top - 0.7f ? 0.04f : 0.1f)
        {
            float u = Face(y, across);
            front = Math.Max(front, u);
            if (y < l.Top - 0.6f) below = Math.Max(below, u);
        }
        if (!float.IsFinite(front)) { front = 0; note += "no stone found behind it; "; }
        front = MathF.Ceiling(front * 100 - 0.3f) / 100; // (whole centimetres, never nearer the stone)
        // where the outermost face (the coping) ends going down: the wall below stands back from it
        bool coping = float.IsFinite(below) && front - below > 0.08f;
        if (coping)
            for (float y = l.Top + 0.05f; y >= l.Top - 0.6f; y -= 0.02f)
                if (Face(y, across) < front - 0.08f) { copeBottom = y; break; }
        float rungZ = front + Clear;
        // the top it stands against: the stone's top just behind the rung line
        float Down(float x, float z)
        {
            var o = f.At(x, l.Top + 1.5f, z);
            float d = Math.Min(stone.Ray(o, Vector3.Down, 3f), ground.Ray(o, Vector3.Down, 3f));
            return float.IsFinite(d) ? o.Y - d : float.NaN;
        }
        float topRung = Down(0, front - 0.06f);
        if (!float.IsFinite(topRung) || Math.Abs(topRung - l.Top) > 0.25f) topRung = l.Top; // (a pier: open to the piles under its deck's edge)
        // the hoops come down on the ground behind the edge, at the quay's height, past a coping's inner arris
        float legZ = float.NaN, legY = l.Top;
        float Ground(float z) => Math.Max(Down(-hx, z), Down(hx, z));
        for (float z = front - 0.05f; z >= front - 1.0f; z -= 0.02f)
        {
            float h = Ground(z);
            if (float.IsFinite(h) && Math.Abs(h - l.Top) < 0.04f) { legZ = Math.Min(z - (coping ? 0.1f : 0.12f), front - 0.5f); break; }
        }
        float hl = float.IsFinite(legZ) ? Ground(legZ) : float.NaN;
        if (float.IsFinite(hl) && Math.Abs(hl - l.Top) < 0.04f) legY = hl;
        else { note += $"no ground for the hoops behind {front:0.00}; "; legZ = front - 0.62f; }
        // brackets: under the coping, then every 1.5 m down to the foot; each stile to the wall behind it
        var brackets = new List<(float, float, float)>();
        var ties = new List<(float, float, float)>();
        float firstY = coping && float.IsFinite(copeBottom) ? copeBottom - 0.2f : topRung - 0.35f;
        int held = 0;
        // a pile's face beside a stile, level with the rung line: how far out (along x, signed) a strap from the stile reaches it
        float Beside(float y, float side)
        {
            float edge = sx + NativeQuayLadderModel.StileThick / 2;
            float d = stone.Ray(f.At(side * edge, y, rungZ), f.T * side, TieReach);
            return float.IsFinite(d) && d > 0.03f ? Cm(side * (edge + d)) : float.NaN;
        }
        for (float y = firstY; y > foot + 0.3f; y -= 1.5f)
        {
            float left = Face(y, new[] { -sx }), right = Face(y, new[] { sx });
            left = float.IsFinite(left) && rungZ - left < 0.9f ? Cm(left) : float.NaN;
            right = float.IsFinite(right) && rungZ - right < 0.9f ? Cm(right) : float.NaN;
            // no wall behind a stile (the pier head, standing on piles): a strap across to the nearest pile beside it (issue 95)
            float tieLeft = float.IsFinite(left) ? float.NaN : Beside(y, -1), tieRight = float.IsFinite(right) ? float.NaN : Beside(y, 1);
            if (float.IsFinite(left) || float.IsFinite(right)) brackets.Add((Cm(y), left, right));
            if (float.IsFinite(tieLeft) || float.IsFinite(tieRight)) ties.Add((Cm(y), tieLeft, tieRight));
            if (float.IsFinite(left) || float.IsFinite(right) || float.IsFinite(tieLeft) || float.IsFinite(tieRight)) held++;
        }
        if (ties.Count > 0) note += $"straps to piles at {string.Join(", ", ties.Select(t => FormattableString.Invariant($"y {t.Item1:0.00} (x {t.Item2:0.00} / {t.Item3:0.00})")))}; ";
        if (held < 2) note +=$"only {held} fixings (brackets to the wall or straps to a pile); ";
        return new NativeQuayLadderModel.Fit(Cm(topRung), Cm(rungZ), Cm(legZ), Cm(legY),
            Tide.RegionAt(l.X + l.Nx * 2, l.Z + l.Nz * 2) == 1, coping ? Cm(front) : 0, brackets.ToArray(), ties.ToArray());
    }

    /// <summary>The drawn quay triangles near the ladders, in a 2 m grid, for rays.</summary>
    private sealed class Triangles
    {
        private const float Cell = 1;
        private readonly Dictionary<(int, int), List<int>> grid = new();
        private readonly List<Vector3> tris = new();
        private int[] stamp = Array.Empty<int>();
        private int rayId;

        public Triangles(Node3D town, Vector3[] near, HashSet<string> names)
        {
            var wanted = new HashSet<(int, int)>();
            foreach (var p in near)
                for (int dx = -1; dx <= 1; dx++)
                    for (int dz = -1; dz <= 1; dz++)
                        wanted.Add(((int)MathF.Floor(p.X / Cell) + dx, (int)MathF.Floor(p.Z / Cell) + dz));
            // (a ladder's rays reach 1 m round it: its cells and their neighbours)
            foreach (var w in wanted.ToArray())
                for (int dx = -1; dx <= 1; dx++)
                    for (int dz = -1; dz <= 1; dz++)
                        wanted.Add((w.Item1 + dx, w.Item2 + dz));
            foreach (var mi in BakedWorld.All(town).OfType<MeshInstance3D>())
            {
                if (mi.Mesh == null || !mi.Visible || !Is(mi, names.Contains)) continue;
                var xf = Pose(mi, town);
                for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
                {
                    var arrays = mi.Mesh.SurfaceGetArrays(s);
                    var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var idx = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? null : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                    int count = idx?.Length ?? v.Length;
                    for (int i = 0; i + 2 < count; i += 3)
                    {
                        Vector3 a = xf * v[idx?[i] ?? i], b = xf * v[idx?[i + 1] ?? i + 1], c = xf * v[idx?[i + 2] ?? i + 2];
                        int x0 = (int)MathF.Floor(Math.Min(a.X, Math.Min(b.X, c.X)) / Cell), x1 = (int)MathF.Floor(Math.Max(a.X, Math.Max(b.X, c.X)) / Cell);
                        int z0 = (int)MathF.Floor(Math.Min(a.Z, Math.Min(b.Z, c.Z)) / Cell), z1 = (int)MathF.Floor(Math.Max(a.Z, Math.Max(b.Z, c.Z)) / Cell);
                        int t = -1;
                        for (int gx = x0; gx <= x1; gx++)
                            for (int gz = z0; gz <= z1; gz++)
                            {
                                if (!wanted.Contains((gx, gz))) continue;
                                if (t < 0) { t = tris.Count; tris.Add(a); tris.Add(b); tris.Add(c); }
                                if (!grid.TryGetValue((gx, gz), out var list)) grid[(gx, gz)] = list = new List<int>();
                                list.Add(t);
                            }
                    }
                }
            }
        }

        /// <summary>Distance along the ray to the nearest triangle within `far`, or +infinity.</summary>
        public float Ray(Vector3 o, Vector3 dir, float far)
        {
            float best = float.PositiveInfinity;
            if (stamp.Length < tris.Count) stamp = new int[tris.Count];
            rayId++;
            int steps = (int)MathF.Ceiling(far / (Cell * 0.5f)) + 1;
            for (int k = 0; k <= steps; k++)
            {
                var p = o + dir * Math.Min(far, k * Cell * 0.5f);
                if (!grid.TryGetValue(((int)MathF.Floor(p.X / Cell), (int)MathF.Floor(p.Z / Cell)), out var list)) continue;
                foreach (int t in list)
                {
                    if (stamp[t] == rayId) continue;
                    stamp[t] = rayId;
                    float d = Hit(o, dir, tris[t], tris[t + 1], tris[t + 2]);
                    if (d < best && d <= far) best = d;
                }
            }
            return best;
        }

        private static float Hit(Vector3 o, Vector3 d, Vector3 a, Vector3 b, Vector3 c)
        {
            var e1 = b - a; var e2 = c - a; var p = d.Cross(e2);
            float det = e1.Dot(p);
            if (Math.Abs(det) < 1e-9f) return float.PositiveInfinity;
            float inv = 1 / det; var s = o - a;
            float u = s.Dot(p) * inv;
            if (u < 0 || u > 1) return float.PositiveInfinity;
            var q = s.Cross(e1);
            float v = d.Dot(q) * inv;
            if (v < 0 || u + v > 1) return float.PositiveInfinity;
            float t = e2.Dot(q) * inv;
            return t >= 0 ? t : float.PositiveInfinity;
        }
    }
}
