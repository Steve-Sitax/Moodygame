using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.People;

/// <summary>
/// #190: the market's fish, one model for each kind everywhere. The stall and trade models still drew their own coarse
/// fish: whole herring and cod painted on the goods atlas (build_stalls.py fish), and the heaps of fish in crates,
/// baskets, buckets and barrows and the bed over the fish tables painted with one blurry fish picture (the detail atlas's
/// "fish" cell, build_trades.py's "fish" cell). Those triangles come out of the models when they are read; in the place
/// of each whole fish lies the herring or the cod model, and each heap becomes the crushed ice of the small goods (`ice`,
/// a 50 x 40 cm bed laid side by side to fill a crate or a table, `ice_round` in a basket or a bucket) with herring laid
/// on it in rows. A spot is in the read model's own frame.
/// </summary>
public static class MarketCatch
{
    /// <summary>A model laid in a stall model's frame: "herring", "cod", "ice" or "ice_round".</summary>
    public readonly record struct Spot(string Model, Transform3D At);

    /// <summary>For the checks: triangles taken out, whole fish replaced, heaps replaced.</summary>
    public static int Taken, WholeFish, Heaps;

    private const float IceL = 0.50f, IceW = 0.40f, IceRound = 0.40f, IceTop = 0.026f, Herring = 0.25f;
    private static Rect2? tradeFish;
    /// <summary>For the checks: the trades atlas's fish cell found (u, v, width, height).</summary>
    public static float[]? TradeCell => tradeFish is { } r ? new[] { r.Position.X, r.Position.Y, r.Size.X, r.Size.Y } : null;
    private static bool tradeLooked;

    /// <summary>The fish models as they lie (the herring and the cod on their sides, the ice flat): library, node, turn.</summary>
    public static (string Source, string Node, Transform3D Turn) Model(string name) => name switch
    {
        "herring" => ("workgoods", "held_fish", Side),
        "cod" => ("smallgoods", "cod", Side),
        "ice_round" => ("smallgoods", "ice_round", Transform3D.Identity),
        _ => ("smallgoods", "ice", Transform3D.Identity),
    };
    private static readonly Transform3D Side = new(new Basis(Vector3.Right, MathF.PI / 2), Vector3.Zero);

    /// <summary>The meshes of a fish model as it lies, each with its place in the model (for a renderer that keeps whole meshes).</summary>
    public static List<(Mesh Mesh, Transform3D Local)> Meshes(string name, ModelLibrary.Look look)
    {
        var found = new List<(Mesh, Transform3D)>();
        var (source, node, turn) = Model(name);
        if (ModelLibrary.Get(source, look)?.Roots.GetValueOrDefault(node) is not { } root) return found;
        void Read(Node n, Transform3D at) { if (n is MeshInstance3D { Mesh: not null } mi) found.Add((mi.Mesh, at)); foreach (var c in n.GetChildren()) Read(c, c is Node3D s ? at * s.Transform : at); }
        Read(root, turn);
        return found;
    }

    /// <summary>A stall or trade model's meshes without their painted fish, with the fish models and the ice in their
    /// place (for a single copy: the porters' fish box). Empty when the model is not there.</summary>
    public static List<(Mesh Mesh, Transform3D Local)> Clean(string source, string root, ModelLibrary.Look look)
    {
        var found = new List<(Mesh, Transform3D)>(); var spots = new List<Spot>();
        if (ModelLibrary.Get(source, look)?.Roots.GetValueOrDefault(root) is not { } model) return found;
        void Read(Node n, Transform3D at)
        {
            if (n is MeshInstance3D { Mesh: not null } mi)
            {
                var mesh = new ArrayMesh { ResourceName = mi.Mesh.ResourceName + "_clean" };
                for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
                {
                    var material = mi.GetActiveMaterial(s);
                    var arrays = Take(source, root, mi.Mesh.SurfaceGetArrays(s), at, material?.ResourceName ?? "", spots);
                    mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays); mesh.SurfaceSetMaterial(s, material);
                }
                found.Add((mesh, at));
            }
            foreach (var c in n.GetChildren()) Read(c, c is Node3D s ? at * s.Transform : at);
        }
        Read(model, Transform3D.Identity);
        foreach (var spot in spots) foreach (var (mesh, local) in Meshes(spot.Model, look)) found.Add((mesh, spot.At * local));
        return found;
    }

    private enum Kind { None, Whole, Heap }

    /// <summary>The trades atlas's fish cell: the open fish box's top (build_trades.py mk_fishbox: its crate's top 0.22 m up is the fish picture).</summary>
    private static Rect2? TradeFishCell()
    {
        if (tradeLooked) return tradeFish;
        tradeLooked = true;
        if (ModelLibrary.Get("trades", new(TwoSided: true, VertexColor: true))?.Roots.GetValueOrDefault("mk_fishbox") is not { } box) return null;
        void Read(Node n, Transform3D at)
        {
            if (n is MeshInstance3D { Mesh: not null } mi)
                for (int s = 0; s < mi.Mesh.GetSurfaceCount(); s++)
                {
                    var a = mi.Mesh.SurfaceGetArrays(s);
                    if (a[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.Nil) continue;
                    var v = a[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var uv = a[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                    var normal = a[(int)Mesh.ArrayType.Normal].VariantType == Variant.Type.Nil ? null : a[(int)Mesh.ArrayType.Normal].AsVector3Array();
                    if (normal == null) continue;
                    var index = a[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : a[(int)Mesh.ArrayType.Index].AsInt32Array();
                    for (int k = 0; k + 2 < index.Length; k += 3)
                    {
                        Vector3 p0 = at * v[index[k]], p1 = at * v[index[k + 1]], p2 = at * v[index[k + 2]];
                        // (facing up: the slat across the box has its underside at the same height)
                        if (new[] { p0, p1, p2 }.Any(p => MathF.Abs(p.Y - 0.22f) > 0.004f) || new[] { index[k], index[k + 1], index[k + 2] }.Any(i => (at.Basis * normal[i]).Normalized().Y < 0.9f)) continue;
                        foreach (int i in new[] { index[k], index[k + 1], index[k + 2] }) tradeFish = tradeFish is { } r ? r.Expand(uv[i]) : new Rect2(uv[i], Vector2.Zero);
                    }
                }
            foreach (var c in n.GetChildren()) Read(c, c is Node3D s ? at * s.Transform : at);
        }
        Read(box, Transform3D.Identity);
        return tradeFish;
    }

    private static Kind Of(string source, string material, Vector2 uv) => source switch
    {
        // the goods atlas's herring and cod cells: the bottom row's first two 32 px cells (u 0-0.5, v 0.75-1 once flipped)
        "stalls" when material == "market_goods" => uv.X < .5f && uv.Y > .75f ? Kind.Whole : Kind.None,
        // the detail atlas's "fish" cell: its first 64 px cell of 256 (u 0-0.25, v 0.75-1 once flipped)
        "stalls" when material == "market_detail" => uv.X < .25f && uv.Y > .75f ? Kind.Heap : Kind.None,
        "trades" when material == "tr_solid" => TradeFishCell() is { } r && r.Grow(.002f).HasPoint(uv) ? Kind.Heap : Kind.None,
        _ => Kind.None,
    };

    /// <summary>A surface of a stall or trade model without its painted fish; what replaces them goes into `spots`
    /// (in the model's frame: `local` takes the surface's vertices there). The arrays come back unchanged when it has none.</summary>
    public static Godot.Collections.Array Take(string source, string root, Godot.Collections.Array arrays, Transform3D local, string material, List<Spot> spots)
    {
        if (source is not ("stalls" or "trades") || arrays[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.Nil) return arrays;
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var index = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        var keep = new List<int>(index.Length); var fish = new List<(int a, int b, int c, Kind kind)>();
        for (int k = 0; k + 2 < index.Length; k += 3)
        {
            Kind a = Of(source, material, uv[index[k]]), b = Of(source, material, uv[index[k + 1]]), c = Of(source, material, uv[index[k + 2]]);
            if (a != Kind.None && a == b && b == c) fish.Add((index[k], index[k + 1], index[k + 2], a));
            else { keep.Add(index[k]); keep.Add(index[k + 1]); keep.Add(index[k + 2]); }
        }
        if (fish.Count == 0) return arrays;
        Taken += fish.Count;
        // the pieces: triangles joined by a corner at the same place (to a millimetre)
        var parent = Enumerable.Range(0, fish.Count).ToArray();
        int Find(int x) { while (parent[x] != x) x = parent[x] = parent[parent[x]]; return x; }
        var corner = new Dictionary<(int, int, int, Kind), int>();
        for (int t = 0; t < fish.Count; t++)
            foreach (int i in new[] { fish[t].a, fish[t].b, fish[t].c })
            {
                var p = local * v[i]; var key = ((int)MathF.Round(p.X * 1000), (int)MathF.Round(p.Y * 1000), (int)MathF.Round(p.Z * 1000), fish[t].kind);
                if (corner.TryGetValue(key, out int o)) parent[Find(t)] = Find(o); else corner[key] = t;
            }
        foreach (var piece in Enumerable.Range(0, fish.Count).GroupBy(Find))
        {
            var pts = piece.SelectMany(t => new[] { fish[t].a, fish[t].b, fish[t].c }).Select(i => local * v[i]).ToList();
            float area = piece.Sum(t => { Vector3 p0 = local * v[fish[t].a], p1 = local * v[fish[t].b], p2 = local * v[fish[t].c]; var n = (p1 - p0).Cross(p2 - p0); return 0.5f * MathF.Abs(n.Y); });
            // (a heap painted with the herring picture is no fish: a fish is long and slim, a heap as wide as its crate)
            var plan = Plan(pts);
            if (fish[piece.Key].kind == Kind.Whole && plan.Width < .35f * plan.Length) Whole(pts, spots); else Heap(pts, area, root, spots);
        }
        var copy = (Godot.Collections.Array)arrays.Duplicate(); copy[(int)Mesh.ArrayType.Index] = keep.ToArray(); return copy;
    }

    /// <summary>The smallest rectangle round points in plan: its middle, its long side's direction, length and width.</summary>
    private static (Vector2 Mid, Vector2 Along, float Length, float Width) Plan(List<Vector3> pts)
    {
        (Vector2 Mid, Vector2 Along, float Length, float Width) best = default; float bestArea = float.MaxValue;
        for (int k = 0; k < 60; k++)
        {
            float a = k * MathF.PI / 120; var u = new Vector2(MathF.Cos(a), MathF.Sin(a)); var w = new Vector2(-u.Y, u.X);
            float u0 = float.MaxValue, u1 = float.MinValue, w0 = float.MaxValue, w1 = float.MinValue;
            foreach (var p in pts) { var q = new Vector2(p.X, p.Z); float s = q.Dot(u), t = q.Dot(w); u0 = MathF.Min(u0, s); u1 = MathF.Max(u1, s); w0 = MathF.Min(w0, t); w1 = MathF.Max(w1, t); }
            float area = (u1 - u0) * (w1 - w0);
            if (area >= bestArea) continue;
            bestArea = area; var mid = u * (u0 + u1) / 2 + w * (w0 + w1) / 2;
            best = u1 - u0 >= w1 - w0 ? (mid, u, u1 - u0, w1 - w0) : (mid, w, w1 - w0, u1 - u0);
        }
        return best;
    }

    /// <summary>A turn about the up axis that lays a model's +X along `along` (in plan x, z).</summary>
    private static Basis Toward(Vector2 along) => new(Vector3.Up, MathF.Atan2(-along.Y, along.X));

    private static void Whole(List<Vector3> pts, List<Spot> spots)
    {
        var (mid, along, length, _) = Plan(pts);
        float lo = pts.Min(p => p.Y), hi = pts.Max(p => p.Y), y = (lo + hi) / 2;
        if (hi - lo > length)
        {
            // a fish hung up by its tail (the dried cod on the stall's front rail): its head down, its flank to the street
            var x = Vector3.Down; var z = new Vector3(along.X, 0, along.Y).Normalized(); if (z.LengthSquared() < .5f) z = Vector3.Back;
            spots.Add(new(hi - lo > .42f ? "cod" : "herring", new Transform3D(new Basis(x, z.Cross(x), z), new Vector3(mid.X, y, mid.Y))));
            WholeFish++;
            return;
        }
        // a fish over 42 cm was a cod; the rest herring (each at its own size: one model of each kind)
        spots.Add(new(length > .42f ? "cod" : "herring", new Transform3D(Toward(along), new Vector3(mid.X, y, mid.Y))));
        WholeFish++;
    }

    private static void Heap(List<Vector3> pts, float area, string root, List<Spot> spots)
    {
        var (mid, along, length, width) = Plan(pts);
        float lo = pts.Min(p => p.Y), hi = pts.Max(p => p.Y);
        // the ice's underside: a little into a heap (the heap's top was its fish), just under a flat picture
        float baseY = hi - lo < .01f ? lo - .004f : lo + .35f * (hi - lo);
        // (the fish table's bed lies on its boards: the fish the market lays there rest on its lumps, not in it)
        if (root == "mk2_fish_table" && length > 1.2f) baseY = lo;
        bool round = length < width * 1.2f && area < .9f * length * width;
        Heaps++;
        Lay(mid, along, length, width, baseY, round, root, spots);
    }

    /// <summary>A box's fill (the carried fish box): crushed ice over its inside, herring on it. `inside`: the box's
    /// inside in its own frame, its floor at the bottom of the box given.</summary>
    public static List<Spot> Box(Aabb inside)
    {
        var spots = new List<Spot>(); var c = inside.GetCenter();
        bool longX = inside.Size.X >= inside.Size.Z;
        Lay(new Vector2(c.X, c.Z), longX ? Vector2.Right : new Vector2(0, 1), MathF.Max(inside.Size.X, inside.Size.Z), MathF.Min(inside.Size.X, inside.Size.Z), inside.End.Y - .03f, false, "box", spots);
        return spots;
    }

    private static void Lay(Vector2 mid, Vector2 along, float length, float width, float baseY, bool round, string root, List<Spot> spots)
    {
        var across = new Vector2(-along.Y, along.X);
        if (round)
        {
            // a basket or a bucket: the round bed, as wide as the heap, and herring across it where they fit
            float d = MathF.Min(length, width) * .96f, k = d / IceRound;
            spots.Add(new("ice_round", new Transform3D(Toward(along).Scaled(new Vector3(k, MathF.Min(1, k), k)), new Vector3(mid.X, baseY, mid.Y))));
            float top = baseY + IceTop * MathF.Min(1, k) + .012f;
            for (float s = -d / 2 + .04f; s <= d / 2 - .04f; s += .062f)
            {
                float chord = 2 * MathF.Sqrt(MathF.Max(0, d * d / 4 - s * s)) - .03f;
                if (chord < Herring) continue;
                var at = mid + along * s;
                spots.Add(new("herring", new Transform3D(Toward(across * (Flip(s) ? -1 : 1)), new Vector3(at.X, top, at.Y))));
            }
            return;
        }
        // a crate, a barrow's load or a table: beds of ice side by side fill it, each fitted to its share
        int nu = Math.Max(1, (int)MathF.Round(length / IceL)), nv = Math.Max(1, (int)MathF.Round(width / IceW));
        float su = length / nu / IceL, sv = width / nv / IceW, sy = MathF.Min(1, MathF.Max(su, sv));
        for (int i = 0; i < nu; i++)
            for (int j = 0; j < nv; j++)
            {
                var at = mid + along * ((i + .5f) / nu - .5f) * length + across * ((j + .5f) / nv - .5f) * width;
                // (every other bed turned end for end: the same lumps do not line up)
                var turn = Toward((i + j) % 2 == 0 ? along : -along);
                spots.Add(new("ice", new Transform3D(turn * Basis.FromScale(new Vector3(su, sy, sv)), new Vector3(at.X, baseY, at.Y))));
            }
        // the fish table's own bed carries the fish the market lays on it (NativeMarket.FishOnTheTable); a crate's or a
        // barrow's ice its herring in rows, heads one way and the other, across it where they fit and else along it
        if (root == "mk2_fish_table" && length > 1.2f) return;
        float y = baseY + IceTop * sy + .012f;
        bool acrossFits = width >= Herring + .03f;
        var row = acrossFits ? along : across; float rowLength = acrossFits ? length : width, fishWay = acrossFits ? width : length;
        if (fishWay < Herring + .02f) return;
        int n = Math.Min(16, (int)((rowLength - .04f) / .062f));
        for (int i = 0; i < n; i++)
        {
            float s = (i + .5f) / n - .5f;
            var at = mid + row * s * (rowLength - .04f);
            var dir = (acrossFits ? across : along) * (i % 2 == 0 ? 1 : -1);
            spots.Add(new("herring", new Transform3D(Toward(dir.Rotated((i * 37 % 7 - 3) * .03f)), new Vector3(at.X, y + (i % 3 == 1 ? .006f : 0), at.Y))));
        }
    }

    private static bool Flip(float s) => ((int)MathF.Round(s * 100) & 1) == 0;
}
