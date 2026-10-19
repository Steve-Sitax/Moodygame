using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// The hulls' real shape for a swimmer and a rowing boat (2026-10-11, Steve: "hitboxes of some boats seem big", "can't
/// swim under boat, we need to be able to dive"). Each kind's model is measured once, the first time a swimmer comes
/// near one: on a grid of 20 cm in the hull's own frame, the lowest and the highest point of the hull in each column
/// (keel to bulwark; masts, rigging and sails, all above 3 m, are left out). So the bow and the stern taper as drawn,
/// the bilge rounds up under the sides, and a diver who keeps under the keel passes beneath. A column is solid from
/// its lowest point to its highest.
/// </summary>
public partial class Boats
{
    public sealed class HullMap
    {
        public float MinX, MinZ;
        public const float Cell = 0.2f;
        public int Nx, Nz;
        /// <summary>Per column (z * Nx + x): the hull's lowest and highest point, or +inf / -inf where none.</summary>
        public float[] Lo = null!, Hi = null!;
        public float Bottom, Top;
        public int Columns;

        public bool Has(int x, int z) => x >= 0 && x < Nx && z >= 0 && z < Nz && Hi[z * Nx + x] >= Lo[z * Nx + x];
    }

    private readonly Dictionary<string, HullMap?> hullMaps = new();
    /// <summary>Above this (in the hull's frame, metres over her waterline) nothing counts: masts, yards, rigging.</summary>
    private const float HullCap = 3;

    /// <summary>Measure every kind the town has now, while the game loads (not on the first swim near one: a slow frame).</summary>
    public void MeasureHulls()
    {
        ulong t0 = Time.GetTicksUsec();
        var kinds = new HashSet<string>();
        foreach (var r in rows) kinds.Add(r.Kind);
        foreach (var f in floats) kinds.Add(f.Kind);
        foreach (var k in kinds) HullOf(k);
        GD.Print($"boats: {kinds.Count} hull shapes for swimmers in {(Time.GetTicksUsec() - t0) / 1000.0:0} ms");
    }

    /// <summary>The measured shape of a kind's hull (made once; null when there is no model).</summary>
    public HullMap? HullOf(string kind)
    {
        if (hullMaps.TryGetValue(kind, out var have)) return have;
        string? k = KindFor(kind);
        if (k == null) return hullMaps[kind] = null;
        ulong t0 = Time.GetTicksUsec();
        var inner = templates[k].Inner;
        var inv = inner.GlobalTransform.AffineInverse();
        var pts = new List<Vector3>();
        Vector3 lo = new(float.MaxValue, 0, float.MaxValue), hi = new(float.MinValue, 0, float.MinValue);
        foreach (var c in Scheldemist.World.BakedWorld.All(inner))
        {
            if (c is not MeshInstance3D { Mesh: not null } mi) continue;
            if (mi.HasMeta("native_washing")) continue;
            string name = mi.Name.ToString();
            if (name.Contains("rigging") || name.Contains("sail") || name.Contains("flag") || name.Contains("smoke") || name.EndsWith("_cap")) continue;
            var xf = inv * mi.GlobalTransform;
            var f = mi.Mesh.GetFaces();
            for (int i = 0; i + 2 < f.Length; i += 3)
            {
                Vector3 a = xf * f[i], b = xf * f[i + 1], d = xf * f[i + 2];
                if (a.Y > HullCap && b.Y > HullCap && d.Y > HullCap) continue;
                // points over the triangle closer than a cell
                int nu = Math.Max(1, (int)MathF.Ceiling(a.DistanceTo(b) / 0.14f)), nv = Math.Max(1, (int)MathF.Ceiling(a.DistanceTo(d) / 0.14f));
                if ((long)nu * nv > 400000) continue;
                for (int u = 0; u <= nu; u++)
                {
                    float fu = (float)u / nu;
                    int vmax = (int)MathF.Ceiling((1 - fu) * nv);
                    for (int v = 0; v <= vmax; v++)
                    {
                        float fv = Math.Min(1 - fu, (float)v / nv);
                        var p = a + (b - a) * fu + (d - a) * fv;
                        if (p.Y > HullCap) continue;
                        pts.Add(p);
                        lo = new Vector3(Math.Min(lo.X, p.X), 0, Math.Min(lo.Z, p.Z));
                        hi = new Vector3(Math.Max(hi.X, p.X), 0, Math.Max(hi.Z, p.Z));
                    }
                }
            }
        }
        if (pts.Count == 0) return hullMaps[kind] = null;
        var m = new HullMap { MinX = lo.X - HullMap.Cell, MinZ = lo.Z - HullMap.Cell };
        m.Nx = (int)MathF.Ceiling((hi.X - m.MinX) / HullMap.Cell) + 2;
        m.Nz = (int)MathF.Ceiling((hi.Z - m.MinZ) / HullMap.Cell) + 2;
        m.Lo = new float[m.Nx * m.Nz];
        m.Hi = new float[m.Nx * m.Nz];
        Array.Fill(m.Lo, float.PositiveInfinity);
        Array.Fill(m.Hi, float.NegativeInfinity);
        m.Bottom = float.PositiveInfinity;
        m.Top = float.NegativeInfinity;
        foreach (var p in pts)
        {
            int x = (int)((p.X - m.MinX) / HullMap.Cell), z = (int)((p.Z - m.MinZ) / HullMap.Cell);
            int i = z * m.Nx + x;
            m.Lo[i] = Math.Min(m.Lo[i], p.Y);
            m.Hi[i] = Math.Max(m.Hi[i], p.Y);
            m.Bottom = Math.Min(m.Bottom, p.Y);
            m.Top = Math.Max(m.Top, p.Y);
        }
        // a hull is closed from side to side: a column inside her outline that no part touched (between the planks
        // of a big triangle) is as deep and as high as the rest of her across the beam there
        for (int z = 0; z < m.Nz; z++)
        {
            int first = -1, last = -1;
            float deep = float.PositiveInfinity, high = float.NegativeInfinity;
            for (int x = 0; x < m.Nx; x++)
                if (m.Has(x, z))
                {
                    if (first < 0) first = x;
                    last = x;
                    deep = Math.Min(deep, m.Lo[z * m.Nx + x]);
                    high = Math.Max(high, m.Hi[z * m.Nx + x]);
                }
            if (first < 0) continue;
            for (int x = first; x <= last; x++)
            {
                int i = z * m.Nx + x;
                if (!m.Has(x, z)) { m.Lo[i] = deep; m.Hi[i] = high; }
                m.Columns++;
            }
        }
        hullMaps[kind] = m;
        if (Main.I.Loaded) GD.Print($"boats: the hull of a {kind} measured, {m.Columns} columns of 20 cm, keel {m.Bottom:0.00} m, from {pts.Count} points in {(Time.GetTicksUsec() - t0) / 1000.0:0} ms");
        return m;
    }

    /// <summary>The hull map's column test: does a ball at local (x, y, z), radius r, touch the hull?</summary>
    private static bool Touches(HullMap m, Vector3 p, float r, float yLo, float yHi)
    {
        int x0 = (int)MathF.Floor((p.X - r - m.MinX) / HullMap.Cell), x1 = (int)MathF.Floor((p.X + r - m.MinX) / HullMap.Cell);
        int z0 = (int)MathF.Floor((p.Z - r - m.MinZ) / HullMap.Cell), z1 = (int)MathF.Floor((p.Z + r - m.MinZ) / HullMap.Cell);
        if (x1 < 0 || z1 < 0 || x0 >= m.Nx || z0 >= m.Nz) return false;
        float rr = (r + HullMap.Cell * 0.5f) * (r + HullMap.Cell * 0.5f);
        for (int z = Math.Max(0, z0); z <= Math.Min(m.Nz - 1, z1); z++)
            for (int x = Math.Max(0, x0); x <= Math.Min(m.Nx - 1, x1); x++)
            {
                int i = z * m.Nx + x;
                if (m.Hi[i] < m.Lo[i] || m.Hi[i] < yLo || m.Lo[i] > yHi) continue;
                float cx = m.MinX + (x + 0.5f) * HullMap.Cell - p.X, cz = m.MinZ + (z + 0.5f) * HullMap.Cell - p.Z;
                if (cx * cx + cz * cz <= rr) return true;
            }
        return false;
    }

    /// <summary>
    /// Is a hull in the way of an upright body round (x, z), radius r, from height y0 up to y1 (world)? The hull it
    /// touches is in `frame` (to slide along her side). Only drawn hulls count; a boat the player hid does not.
    /// </summary>
    public bool HullIn(float x, float z, float r, float y0, float y1, out Transform3D frame)
    {
        frame = Transform3D.Identity;
        foreach (var row in rows)
        {
            var d = Dims(row.Kind);
            float reach = d.Length / 2 + r + 1;
            for (int i = 0; i < row.N; i++)
            {
                if (Math.Abs(row.X[i] - x) > reach || Math.Abs(row.Z[i] - z) > reach || playerHidden.Contains((row, i))) continue;
                if (Hits(row.Kind, row.World[i], x, z, r, y0, y1)) { frame = row.World[i]; return true; }
            }
        }
        foreach (var f in floats)
        {
            if (!f.Outer.Visible || !f.Outer.IsVisibleInTree()) continue;
            var o = f.Outer.GlobalPosition;
            float reach = Dims(f.Kind).Length / 2 + r + 1;
            if (Math.Abs(o.X - x) > reach || Math.Abs(o.Z - z) > reach) continue;
            var xf = f.Inner.GlobalTransform;
            if (Hits(f.Kind, xf, x, z, r, y0, y1)) { frame = xf; return true; }
        }
        return false;
    }

    private bool Hits(string kind, Transform3D xf, float x, float z, float r, float y0, float y1)
    {
        if (Math.Abs(xf.Basis.Determinant()) < 1e-6f) return false;
        var m = HullOf(kind);
        if (m == null) return false;
        var inv = xf.AffineInverse();
        var a = inv * new Vector3(x, y0, z);
        var b = inv * new Vector3(x, y1, z);
        float s = xf.Basis.Scale.X;
        var mid = (a + b) * 0.5f;
        return Touches(m, mid, r / Math.Max(0.1f, s), Math.Min(a.Y, b.Y), Math.Max(a.Y, b.Y));
    }
}
