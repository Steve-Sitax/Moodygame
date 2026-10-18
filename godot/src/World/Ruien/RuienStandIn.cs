using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The stand-in for an area that has no export yet (docs/ruien-native.md): its zones built from their sections, so the
/// shaders, the light, the water and the ways in can be tried and walked before the real models come. A gallery is its
/// section swept along the line (channel bed, channel walls, ledges, walls, a basket vault), a hall its floor, walls,
/// walkways, piers and groin vaults; with the weather in the vertex colour (wet low and under seeps, lime and soot at
/// the crown, moss near daylight) and tiling UVs in the families' tiles. Collision from the same faces.
/// </summary>
public sealed class RuienStandIn
{
    private readonly Dictionary<string, SurfaceTool> tools = new();
    private readonly List<Vector3> solid = new();
    private readonly RuienData.Area area;
    private readonly List<Vector3> daylight = new();
    private readonly List<Vector3> lamps = new();

    public RuienStandIn(RuienData.Area area)
    {
        this.area = area;
        foreach (var s in area.Sources) (s.Kind == "lamp" ? lamps : daylight).Add(s.At);
    }

    private SurfaceTool Tool(string family)
    {
        if (tools.TryGetValue(family, out var st)) return st;
        st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        tools[family] = st;
        return st;
    }

    // the weather at a point (vertex colour): R wet, G lime, B soot, A moss
    private Color Weather(Vector3 p, Vector3 n, RuienData.Section s)
    {
        float wet = Mathf.SmoothStep(s.LedgeY - 0.2f, s.LedgeY - 0.9f, p.Y);
        // seeps: long wet streaks down from the vault
        float seep = Mathf.SmoothStep(0.62f, 0.8f, Noise(p.X * 0.55f + p.Z * 0.31f, 3.1f)) * Mathf.SmoothStep(s.LedgeY, s.Spring + 0.5f, p.Y);
        wet = Math.Max(wet, seep * 0.85f);
        float lime = seep * Mathf.SmoothStep(s.Spring - 0.5f, s.Crown - 0.2f, p.Y) + 0.6f * Mathf.SmoothStep(0.7f, 0.85f, Noise(p.X * 1.3f - p.Z * 0.9f, 7.7f)) * Mathf.SmoothStep(s.Crown - 1.0f, s.Crown - 0.05f, p.Y);
        float soot = 0.45f * Mathf.SmoothStep(s.Crown - 1.4f, s.Crown - 0.05f, p.Y);
        foreach (var l in lamps)
        {
            var d = p - l;
            if (d.Y > -0.2f && d.Y < 2.5f && new Vector2(d.X, d.Z).Length() < 1.2f + d.Y * 0.4f) soot = Math.Max(soot, 0.9f * (1 - d.Y / 2.5f));
        }
        float moss = 0;
        foreach (var g in daylight)
        {
            float dh = new Vector2(p.X - g.X, p.Z - g.Z).Length();
            moss = Math.Max(moss, Mathf.SmoothStep(3.5f, 0.8f, dh) * Mathf.SmoothStep(s.LedgeY + 0.6f, s.LedgeY - 0.3f, p.Y));
        }
        return new Color(Math.Clamp(wet, 0, 1), Math.Clamp(lime, 0, 1), Math.Clamp(soot, 0, 1), Math.Clamp(moss * (0.5f + 0.5f * Noise(p.X * 2.1f, p.Z * 2.3f)), 0, 1));
    }

    private static float Noise(float x, float y)
    {
        float H(float a, float b) { var p = new Vector2(a, b) * new Vector2(127.1f, 311.7f); float s = MathF.Sin(p.X + p.Y) * 43758.547f; return s - MathF.Floor(s); }
        float ix = MathF.Floor(x), iy = MathF.Floor(y), fx = x - ix, fy = y - iy;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        float a = H(ix, iy) + (H(ix + 1, iy) - H(ix, iy)) * fx, b = H(ix, iy + 1) + (H(ix + 1, iy + 1) - H(ix, iy + 1)) * fx;
        return a + (b - a) * fy;
    }

    /// <summary>One triangle facing along n (Godot's front face turns clockwise).</summary>
    private void Tri(string fam, RuienData.Section s, Vector3 a, Vector3 b, Vector3 c, Vector2 ua, Vector2 ub, Vector2 uc, Vector3 na, Vector3 nb, Vector3 nc, bool collide = true)
    {
        var st = Tool(fam);
        var face = (na + nb + nc).Normalized();
        if ((b - a).Cross(c - a).Dot(face) > 0) { (b, c) = (c, b); (ub, uc) = (uc, ub); (nb, nc) = (nc, nb); }
        foreach (var (p, uv, n) in new[] { (a, ua, na), (b, ub, nb), (c, uc, nc) })
        {
            st.SetNormal(n);
            st.SetUV(uv);
            st.SetUV2(new Vector2(1, 0));
            st.SetColor(Weather(p, n, s));
            st.AddVertex(p);
        }
        if (collide) { solid.Add(a); solid.Add(b); solid.Add(c); }
    }

    private void Quad(string fam, RuienData.Section s, Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector2 ua, Vector2 ub, Vector2 uc, Vector2 ud, Vector3 n0, Vector3 n1, bool collide = true)
    {
        Tri(fam, s, a, b, c, ua, ub, uc, n0, n0, n1, collide);
        Tri(fam, s, a, c, d, ua, uc, ud, n0, n1, n1, collide);
    }

    /// <summary>A gallery's section: (s across, y), the family, from one side over the vault to the other.</summary>
    private static List<(Vector2 p, string fam)> Profile(RuienData.Section s)
    {
        var pr = new List<(Vector2, string)>();
        float hw = s.Width / 2, hc = s.Channel / 2;
        void Add(float x, float y, string f) => pr.Add((new Vector2(x, y), f));
        Add(-hc, s.Bed, "silt"); Add(hc, s.Bed, "brick_flemish");
        Add(hc, s.LedgeY - 0.25f, "brick_flemish"); Add(hc, s.LedgeY, "bluestone"); Add(hc + 0.5f, s.LedgeY, "brick_stretcher");
        Add(hw, s.LedgeY, "brick_flemish");
        Add(hw, s.Spring, "brick_stretcher");
        float rise = s.Crown - s.Spring;
        for (int i = 1; i < 24; i++)
        {
            float t = i / 24f * MathF.PI;
            Add(hw * MathF.Cos(t), s.Spring + rise * MathF.Sin(t), "brick_stretcher");
        }
        Add(-hw, s.Spring, "brick_flemish");
        Add(-hw, s.LedgeY, "brick_stretcher"); Add(-hc - 0.5f, s.LedgeY, "bluestone"); Add(-hc, s.LedgeY, "brick_flemish");
        Add(-hc, s.LedgeY - 0.25f, "brick_flemish"); Add(-hc, s.Bed, "silt");
        return pr;
    }

    private static Vector2 ProfileNormal(Vector2 a, Vector2 b, RuienData.Section s)
    {
        var d = (b - a).Normalized();
        var n = new Vector2(-d.Y, d.X);
        var mid = (a + b) / 2;
        var inside = new Vector2(0, (s.Bed + s.Crown) / 2);
        if (MathF.Abs(n.Y) > 0.9f && MathF.Abs(a.Y - b.Y) < 1e-3f) return new Vector2(0, 1); // floors face up
        return n.Dot(inside - mid) >= 0 ? n : -n;
    }

    private void Gallery(RuienData.Zone z)
    {
        var s = z.S;
        var pr = Profile(s);
        var pv = new float[pr.Count];
        for (int i = 1; i < pr.Count; i++) pv[i] = pv[i - 1] + pr[i].p.DistanceTo(pr[i - 1].p);
        for (int k = 0; k + 1 < z.Path.Length; k++)
        {
            Vector3 W(int at, Vector2 sp)
            {
                var t = (z.Path[Math.Min(at + 1, z.Path.Length - 1)] - z.Path[Math.Max(at - 1, 0)]).Normalized();
                var nrm = new Vector2(t.Y, -t.X);
                var c = z.Path[at] + nrm * sp.X;
                return new Vector3(c.X, sp.Y, c.Y);
            }
            Vector3 N(int at, Vector2 n2)
            {
                var t = (z.Path[Math.Min(at + 1, z.Path.Length - 1)] - z.Path[Math.Max(at - 1, 0)]).Normalized();
                var nrm = new Vector2(t.Y, -t.X);
                var h = nrm * n2.X;
                return new Vector3(h.X, n2.Y, h.Y).Normalized();
            }
            float u0 = z.Along[k], u1 = z.Along[k + 1];
            for (int i = 0; i + 1 < pr.Count; i++)
            {
                var a = pr[i].p; var b = pr[i + 1].p;
                if (a.DistanceTo(b) < 1e-4f) continue;
                string fam = pr[i].fam;
                var n2 = ProfileNormal(a, b, s);
                var tile = fam.StartsWith("brick") ? new Vector2(4.8f, 2.4f) : fam == "bluestone" ? new Vector2(2.4f, 2.4f) : new Vector2(4f, 4f);
                Quad(fam, s, W(k, a), W(k + 1, a), W(k + 1, b), W(k, b),
                    new Vector2(u0 / tile.X, pv[i] / tile.Y), new Vector2(u1 / tile.X, pv[i] / tile.Y), new Vector2(u1 / tile.X, pv[i + 1] / tile.Y), new Vector2(u0 / tile.X, pv[i + 1] / tile.Y),
                    N(k, n2), N(k, n2));
            }
        }
    }

    private void Hall(RuienData.Zone z, JsonElement spec)
    {
        var s = z.S;
        var r = z.Rect;
        float spring = spec.TryGetProperty("spring", out var sp) ? sp.GetSingle() : s.Crown - 1.6f;
        float walk = spec.TryGetProperty("walkway", out var wk) ? wk.GetSingle() : 1.5f;
        var xs = new List<float> { r.Position.X };
        var zs = new List<float> { r.Position.Y };
        if (spec.TryGetProperty("piersX", out var px)) xs.AddRange(px.EnumerateArray().Select(e => e.GetSingle()));
        if (spec.TryGetProperty("piersZ", out var pz)) zs.AddRange(pz.EnumerateArray().Select(e => e.GetSingle()));
        xs.Add(r.End.X); zs.Add(r.End.Y);
        float pier = spec.TryGetProperty("pier", out var pw) ? pw.GetSingle() : 1.1f;
        // the floor (silt) and the walkways along the walls
        Quad("silt", s, new Vector3(r.Position.X, s.Bed, r.Position.Y), new Vector3(r.End.X, s.Bed, r.Position.Y), new Vector3(r.End.X, s.Bed, r.End.Y), new Vector3(r.Position.X, s.Bed, r.End.Y),
            new Vector2(r.Position.X, r.Position.Y) / 4, new Vector2(r.End.X, r.Position.Y) / 4, r.End / 4, new Vector2(r.Position.X, r.End.Y) / 4, Vector3.Up, Vector3.Up);
        // openings in the walls where the area's galleries come in
        var mouths = new List<(int side, float at, float half)>();
        foreach (var g in area.Zones.Where(q => q.Kind == "line"))
            foreach (var end in new[] { g.Path[0], g.Path[^1] })
            {
                if (!r.Grow(1.5f).HasPoint(end)) continue;
                float dx0 = MathF.Abs(end.X - r.Position.X), dx1 = MathF.Abs(end.X - r.End.X), dz0 = MathF.Abs(end.Y - r.Position.Y), dz1 = MathF.Abs(end.Y - r.End.Y);
                float m = Math.Min(Math.Min(dx0, dx1), Math.Min(dz0, dz1));
                int side = m == dz0 ? 0 : m == dz1 ? 1 : m == dx0 ? 2 : 3;
                mouths.Add((side, side < 2 ? end.X : end.Y, g.S.Width / 2));
            }
        // walls: side 0 at z0 and 1 at z1 run along x; 2 at x0 and 3 at x1 along z
        for (int side = 0; side < 4; side++)
        {
            bool alongX = side < 2;
            float fixedC = side switch { 0 => r.Position.Y, 1 => r.End.Y, 2 => r.Position.X, _ => r.End.X };
            float a0 = alongX ? r.Position.X : r.Position.Y, a1 = alongX ? r.End.X : r.End.Y;
            var inward = side switch { 0 => Vector3.Back, 1 => Vector3.Forward, 2 => Vector3.Right, _ => Vector3.Left };
            Vector3 P(float a, float y) => alongX ? new Vector3(a, y, fixedC) : new Vector3(fixedC, y, a);
            var cuts = mouths.Where(m => m.side == side).Select(m => (m.at - m.half, m.at + m.half)).OrderBy(c => c.Item1).ToList();
            var spans = new List<(float, float)>();
            float at = a0;
            foreach (var (c0, c1) in cuts) { if (c0 > at) spans.Add((at, c0)); at = Math.Max(at, c1); }
            if (at < a1) spans.Add((at, a1));
            foreach (var (b0, b1) in spans)
                Quad("brick_flemish", s, P(b0, s.Bed), P(b1, s.Bed), P(b1, s.Crown), P(b0, s.Crown), new Vector2(b0 / 4.8f, s.Bed / 2.4f), new Vector2(b1 / 4.8f, s.Bed / 2.4f), new Vector2(b1 / 4.8f, s.Crown / 2.4f), new Vector2(b0 / 4.8f, s.Crown / 2.4f), inward, inward);
            // above a mouth: the wall over the gallery's vault
            foreach (var (c0, c1) in cuts)
                Quad("brick_flemish", s, P(c0, s.Crown - 0.02f), P(c1, s.Crown - 0.02f), P(c1, spring + 1.2f), P(c0, spring + 1.2f), new Vector2(c0 / 4.8f, 0), new Vector2(c1 / 4.8f, 0), new Vector2(c1 / 4.8f, 0.5f), new Vector2(c0 / 4.8f, 0.5f), inward, inward, false);
            // the walkway along it (its top and its face toward the hall), broken where a gallery comes in
            foreach (var (b0, b1) in spans)
            {
                Vector3 Wk(float a, float off, float y) => P(a, y) + inward * off;
                Quad("brick_stretcher", s, Wk(b0, 0, s.LedgeY), Wk(b1, 0, s.LedgeY), Wk(b1, walk, s.LedgeY), Wk(b0, walk, s.LedgeY), new Vector2(b0, 0) / 4.8f, new Vector2(b1, 0) / 4.8f, new Vector2(b1, walk) / 4.8f, new Vector2(b0, walk) / 4.8f, Vector3.Up, Vector3.Up);
                Quad("bluestone", s, Wk(b0, walk, s.LedgeY), Wk(b1, walk, s.LedgeY), Wk(b1, walk, s.Bed), Wk(b0, walk, s.Bed), new Vector2(b0, s.LedgeY) / 2.4f, new Vector2(b1, s.LedgeY) / 2.4f, new Vector2(b1, s.Bed) / 2.4f, new Vector2(b0, s.Bed) / 2.4f, inward, inward);
            }
        }
        // the piers, where the pier lines cross inside the hall
        for (int i = 1; i + 1 < xs.Count; i++)
            for (int j = 1; j + 1 < zs.Count; j++)
            {
                float h = pier / 2;
                var c = new Vector2(xs[i], zs[j]);
                foreach (var (n, o) in new[] { (Vector3.Back, new Vector2(0, h)), (Vector3.Forward, new Vector2(0, -h)), (Vector3.Right, new Vector2(h, 0)), (Vector3.Left, new Vector2(-h, 0)) })
                {
                    var along = new Vector2(-n.Z, n.X) * h;
                    var p0 = c + o - along; var p1 = c + o + along;
                    Quad("brick_flemish", s, new Vector3(p0.X, s.Bed, p0.Y), new Vector3(p1.X, s.Bed, p1.Y), new Vector3(p1.X, spring, p1.Y), new Vector3(p0.X, spring, p0.Y),
                        new Vector2(0, s.Bed / 2.4f), new Vector2(pier / 4.8f, s.Bed / 2.4f), new Vector2(pier / 4.8f, spring / 2.4f), new Vector2(0, spring / 2.4f), n, n);
                }
            }
        // the groin vaults, bay by bay: the higher of two barrels meeting on the diagonals
        const int G = 14;
        for (int i = 0; i + 1 < xs.Count; i++)
            for (int j = 0; j + 1 < zs.Count; j++)
            {
                float x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
                Vector3 V(int a, int b)
                {
                    float u = a / (float)G * 2 - 1, v = b / (float)G * 2 - 1;
                    float f = Math.Min(MathF.Sqrt(Math.Max(0, 1 - u * u)), MathF.Sqrt(Math.Max(0, 1 - v * v)));
                    return new Vector3(Mathf.Lerp(x0, x1, a / (float)G), spring + (s.Crown - spring) * f, Mathf.Lerp(z0, z1, b / (float)G));
                }
                for (int a = 0; a < G; a++)
                    for (int b = 0; b < G; b++)
                    {
                        Vector3 p00 = V(a, b), p10 = V(a + 1, b), p11 = V(a + 1, b + 1), p01 = V(a, b + 1);
                        var n = -(p10 - p00).Cross(p01 - p00).Normalized();
                        if (n.Y > 0) n = -n;
                        Quad("brick_stretcher", s, p00, p10, p11, p01, new Vector2(p00.X, p00.Z) / 4.8f, new Vector2(p10.X, p10.Z) / 4.8f, new Vector2(p11.X, p11.Z) / 4.8f, new Vector2(p01.X, p01.Z) / 4.8f, n, n);
                    }
            }
    }

    /// <summary>The gallery's end at a gate: the faces that close the wall's thickness round the cut opening.</summary>
    private void GateEnds()
    {
        foreach (var g in area.Gates)
        {
            var z = area.Zones.Where(q => q.Kind == "line").OrderBy(q => q.Path[0].DistanceTo(g.Origin)).FirstOrDefault();
            if (z == null) continue;
            var s = z.S;
            var along = new Vector2(-g.Normal.Y, g.Normal.X);
            var into = -new Vector3(g.Normal.X, 0, g.Normal.Y);
            Vector3 P(float a, float y) => new(g.Origin.X + along.X * a, y, g.Origin.Y + along.Y * a);
            float hw = s.Width / 2, hc = s.Channel / 2;
            // under the ledges, and the sill's step down into the channel
            foreach (float sgn in new[] { -1f, 1f })
                Quad("brick_flemish", s, P(sgn * hc, g.Sill), P(sgn * hw, g.Sill), P(sgn * hw, s.LedgeY), P(sgn * hc, s.LedgeY), Vector2.Zero, new Vector2(0.3f, 0), new Vector2(0.3f, 0.6f), new Vector2(0, 0.6f), into, into);
            Quad("bluestone", s, P(-hc, s.Bed), P(hc, s.Bed), P(hc, g.Sill), P(-hc, g.Sill), Vector2.Zero, new Vector2(1.2f, 0), new Vector2(1.2f, 0.4f), new Vector2(0, 0.4f), into, into);
            // the sill itself, a bluestone apron level with the vliet's bed
            Quad("bluestone", s, P(-hw, g.Sill), P(hw, g.Sill), P(hw, g.Sill) - into * 1.2f, P(-hw, g.Sill) - into * 1.2f, Vector2.Zero, new Vector2(2.5f, 0), new Vector2(2.5f, 0.5f), new Vector2(0, 0.5f), Vector3.Up, Vector3.Up);
        }
    }

    public (Node3D node, ConcavePolygonShape3D shape) Build(JsonElement areaSpec)
    {
        var halls = areaSpec.TryGetProperty("zones", out var zs) ? zs.EnumerateArray().ToList() : new List<JsonElement>();
        int zi = 0;
        foreach (var z in area.Zones)
        {
            if (z.Kind == "line") Gallery(z);
            else Hall(z, halls.Count > zi ? halls[zi] : default);
            zi++;
        }
        GateEnds();
        var root = new Node3D { Name = "ruien_" + area.Id + "_standin" };
        foreach (var (fam, st) in tools)
        {
            var mesh = st.Commit();
            mesh.SurfaceSetMaterial(0, RuienMaterials.Get("ruien_" + fam));
            root.AddChild(new MeshInstance3D { Name = fam, Mesh = mesh, Layers = Ruien.Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        }
        var shape = new ConcavePolygonShape3D { Data = solid.ToArray(), BackfaceCollision = true };
        return (root, shape);
    }
}
