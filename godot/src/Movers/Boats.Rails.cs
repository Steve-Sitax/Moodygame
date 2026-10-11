using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// The moored and small boats for the gulls (World/Gulls.cs): their live frames, and where a bird stands on one: the
/// rail (gunwale) midships, measured once a kind from the row's own meshes.
/// </summary>
public partial class Boats
{
    private readonly Dictionary<string, (float Y, float HalfBeam, float HalfLength, float MidZ)> rails = new();

    public int RowCount => rows.Count;
    public int RowSize(int row) => rows[row].N;
    public string RowKind(int row) => rows[row].Kind;
    public bool RowGone(int row, int i) => rows[row].Gone[i];
    public Vector2 RowAt(int row, int i) => new(rows[row].X[i], rows[row].Z[i]);
    /// <summary>Boat i of a row now (its waterline frame: heave, roll and pitch included).</summary>
    public Transform3D RowWorld(int row, int i) => rows[row].World[i];

    /// <summary>The rail midships of a row's kind in its frame: its height, half the beam, half the length, the middle along it.</summary>
    public (float Y, float HalfBeam, float HalfLength, float MidZ) RailOf(int row)
    {
        var r = rows[row];
        if (rails.TryGetValue(r.Kind, out var got)) return got;
        var pts = new List<Vector3>();
        foreach (var (mm, part, _) in r.Meshes)
        {
            if (mm.Mesh == null) continue;
            for (int s = 0; s < mm.Mesh.GetSurfaceCount(); s++)
                foreach (var p in mm.Mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array())
                {
                    var q = part * p;
                    if (q.Y > -0.5f && q.Y < 2.4f) pts.Add(q);
                }
        }
        if (pts.Count == 0) return rails[r.Kind] = (0.8f, 1, 4, 0);
        float lo = float.MaxValue, hi = float.MinValue;
        foreach (var q in pts) { lo = Math.Min(lo, q.Z); hi = Math.Max(hi, q.Z); }
        float mid = (lo + hi) / 2, half = (hi - lo) / 2, beam = 0;
        foreach (var q in pts) if (Math.Abs(q.Z - mid) < half * 0.3f) beam = Math.Max(beam, Math.Abs(q.X));
        float top = float.MinValue;
        foreach (var q in pts) if (Math.Abs(q.Z - mid) < half * 0.3f && Math.Abs(q.X) > beam * 0.86f) top = Math.Max(top, q.Y);
        if (top == float.MinValue) top = 0.8f;
        return rails[r.Kind] = (top, beam, half, mid);
    }
}
