using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

public partial class Boats
{
    /// <summary>
    /// Issue 87: the small boats' mooring ropes are one baked mesh ("mooring_ropes"), each rope a few pieces from the
    /// coping down to her rail. A boat moved off a ladder (MooredRespace) takes her ropes with her, along the wall;
    /// the ropes of a boat taken off her mooring go. Each piece belongs to the boat whose length it lies nearest. Made
    /// once at load, into a mesh of its own: the shared baked mesh is not touched. #182: the boat's end of each rope
    /// rises and falls with her on the tide (RopesFollowTide); the end on the coping stays where it is made fast.
    /// </summary>
    private void MooringRopes()
    {
        if (Mv.Top("mooring_ropes") is not MeshInstance3D ropes || ropes.Mesh == null) return;
        var boats = new List<(Vector2 At, Vector2 Axis, float Half, Vector3 Shift, bool Gone)>();
        var owners = new List<(Row Row, int I)>();
        foreach (var row in rows)
        {
            var d = Dims(row.Kind);
            if (d.Length >= 9) continue;
            for (int i = 0; i < row.N; i++)
            {
                var (bx, bz) = MooredRespace.Origin(row.X[i], row.Z[i]);
                var (dx, dz) = MooredRespace.At(bx, bz);
                // her ropes go with her along the wall; brought in against the wall (across it), they no longer reach and go
                var axis = new Vector2(MathF.Sin(row.Yaw[i]), MathF.Cos(row.Yaw[i])); var shift = new Vector2(dx, dz); float along = shift.Dot(axis);
                bool across = (shift - axis * along).Length() > 0.5f;
                boats.Add((new Vector2(bx, bz), axis, d.Length / 2, new Vector3(axis.X * along, 0, axis.Y * along), MooredRespace.Removed(bx, bz) || across));
                owners.Add((row, i));
            }
        }
        var xf = ropes.GlobalTransform;
        var inv = xf.AffineInverse();
        var mesh = new ArrayMesh();
        int moved = 0, dropped = 0;
        for (int s = 0; s < ropes.Mesh.GetSurfaceCount(); s++)
        {
            var arrays = ropes.Mesh.SurfaceGetArrays(s);
            var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var idx = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            // the pieces: triangles joined by a vertex, or by vertices at one place (a tube's seam)
            var parent = Enumerable.Range(0, v.Length).ToArray();
            int Find(int a) { while (parent[a] != a) a = parent[a] = parent[parent[a]]; return a; }
            for (int i = 0; i + 2 < idx.Length; i += 3) { parent[Find(idx[i + 1])] = Find(idx[i]); parent[Find(idx[i + 2])] = Find(idx[i]); }
            var place = new Dictionary<(int, int, int), int>();
            for (int i = 0; i < v.Length; i++) { var k = ((int)MathF.Round(v[i].X * 200), (int)MathF.Round(v[i].Y * 200), (int)MathF.Round(v[i].Z * 200)); if (place.TryGetValue(k, out int o)) parent[Find(i)] = Find(o); else place[k] = i; }
            var gone = new bool[v.Length];
            var owner = new int[v.Length];
            Array.Fill(owner, -1);
            foreach (var piece in Enumerable.Range(0, v.Length).GroupBy(Find))
            {
                var mid = Vector3.Zero; int n = 0;
                foreach (int i in piece) { mid += xf * v[i]; n++; }
                mid /= n;
                var c = new Vector2(mid.X, mid.Z);
                int best = -1; float bd = 4;
                for (int b = 0; b < boats.Count; b++)
                {
                    var off = c - boats[b].At; float along = Math.Clamp(off.Dot(boats[b].Axis), -boats[b].Half, boats[b].Half);
                    float dist = (off - boats[b].Axis * along).Length();
                    if (dist < bd) { bd = dist; best = b; }
                }
                if (best < 0) continue;
                foreach (int i in piece) owner[i] = best;
                if (boats[best].Gone) { foreach (int i in piece) gone[i] = true; dropped++; }
                else if (boats[best].Shift != Vector3.Zero) { var local = inv.Basis * boats[best].Shift; foreach (int i in piece) v[i] += local; moved++; }
            }
            var keep = new List<int>(idx.Length);
            for (int i = 0; i + 2 < idx.Length; i += 3) if (!gone[idx[i]] && !gone[idx[i + 1]] && !gone[idx[i + 2]]) { keep.Add(idx[i]); keep.Add(idx[i + 1]); keep.Add(idx[i + 2]); }
            if (keep.Count == 0) continue;
            arrays[(int)Mesh.ArrayType.Vertex] = v;
            arrays[(int)Mesh.ArrayType.Index] = keep.ToArray();
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, ropes.Mesh.SurfaceGetMaterial(s));
            ropeSurfaces.Add(new RopeSurface { Arrays = arrays, Base = (Vector3[])v.Clone(), Owner = owner, Weight = new float[v.Length], Material = ropes.Mesh.SurfaceGetMaterial(s) });
        }
        // each boat's ropes run from the coping (their highest point, made fast) down to her rail (their lowest, on her)
        var top = new float[boats.Count]; var low = new float[boats.Count];
        Array.Fill(top, float.NegativeInfinity); Array.Fill(low, float.PositiveInfinity);
        foreach (var rs in ropeSurfaces)
            for (int i = 0; i < rs.Base.Length; i++)
                if (rs.Owner[i] >= 0) { float y = (xf * rs.Base[i]).Y; top[rs.Owner[i]] = MathF.Max(top[rs.Owner[i]], y); low[rs.Owner[i]] = MathF.Min(low[rs.Owner[i]], y); }
        foreach (var rs in ropeSurfaces)
            for (int i = 0; i < rs.Base.Length; i++)
            {
                int b = rs.Owner[i];
                rs.Weight[i] = b < 0 || top[b] - low[b] < 0.2f ? 0 : Math.Clamp((top[b] - (xf * rs.Base[i]).Y) / (top[b] - low[b]), 0, 1);
            }
        ropeOwners = owners.ToArray();
        ropeRise = new float[owners.Count];
        Array.Fill(ropeRise, float.NaN);
        ropeMesh = mesh; ropeNode = ropes;
        ropes.Mesh = mesh;
        // the tide lifts and lowers the boats' ends some 5 m: the drawn box must hold that
        var box = mesh.GetAabb(); ropes.CustomAabb = new Aabb(box.Position + new Vector3(0, -5, 0), box.Size + new Vector3(0, 10, 0));
        RopesFollowTide();
        GD.Print($"boats: mooring ropes of the small boats moved off the ladders: {moved} pieces moved, {dropped} gone with their boats (issue 87); {owners.Count} boats' ropes follow the tide (#182)");
    }

    private sealed class RopeSurface
    {
        public Godot.Collections.Array Arrays = null!;
        public Vector3[] Base = null!;
        public int[] Owner = null!;
        public float[] Weight = null!;
        public Material? Material;
    }
    private readonly List<RopeSurface> ropeSurfaces = new();
    private (Row Row, int I)[] ropeOwners = Array.Empty<(Row, int)>();
    private float[] ropeRise = Array.Empty<float>();
    private ArrayMesh? ropeMesh;
    private MeshInstance3D? ropeNode;
    /// <summary>For checks: how far each moored small boat's rope end has been moved with the tide from where the bake drew it.</summary>
    public IReadOnlyList<float> RopeRise => ropeRise;
    public int RopeRebuilds { get; private set; }

    /// <summary>
    /// #182: every small boat's rope end follows her height on the water (or on the mud), not her bob: rebuilt when one of
    /// them has moved a centimetre, which the tide does a few times a minute.
    /// </summary>
    private void RopesFollowTide()
    {
        if (ropeMesh == null || ropeNode == null || !IsInstanceValid(ropeNode)) return;
        bool changed = false;
        for (int b = 0; b < ropeOwners.Length; b++)
        {
            var (row, i) = ropeOwners[b];
            float rise = MathF.Max(Tide.LevelAt(row.X[i], row.Z[i]), row.Floor[i]) - row.BakeY[i];
            if (float.IsNaN(ropeRise[b]) || MathF.Abs(rise - ropeRise[b]) >= 0.01f) { ropeRise[b] = rise; changed = true; }
        }
        if (!changed) return;
        RopeRebuilds++;
        var up = ropeNode.GlobalTransform.AffineInverse().Basis * Vector3.Up;
        ropeMesh.ClearSurfaces();
        foreach (var rs in ropeSurfaces)
        {
            var v = new Vector3[rs.Base.Length];
            for (int i = 0; i < v.Length; i++) v[i] = rs.Owner[i] < 0 ? rs.Base[i] : rs.Base[i] + up * (ropeRise[rs.Owner[i]] * rs.Weight[i]);
            rs.Arrays[(int)Mesh.ArrayType.Vertex] = v;
            ropeMesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, rs.Arrays);
            if (rs.Material != null) ropeMesh.SurfaceSetMaterial(ropeMesh.GetSurfaceCount() - 1, rs.Material);
        }
    }
}
