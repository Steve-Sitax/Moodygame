using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Native.Recovery;

/// <summary>Clip and cap convex vertical quay corners, including the rounded profile above and below them.</summary>
public static class RecoveryCopingCorners
{
    public const float Depth = 0.008f;
    private readonly record struct Point(Vector3 P, Vector3 N, Vector2 Uv);
    private sealed record Edge(Vector3 P, Vector3 N, Vector3 Inside);
    private sealed record Corner(Vector3 P, Vector3 N, List<Point> Boundary);
    public static int Bevel(List<Vector3> vertices, List<Vector3> normals, List<Vector2> uv, float[] rawP, float[] rawN)
    {
        Vector3 Position(int i) => new(rawP[i * 3], rawP[i * 3 + 1], rawP[i * 3 + 2]);
        Vector3 Normal(int i) => new(rawN[i * 3], rawN[i * 3 + 1], rawN[i * 3 + 2]);
        (int, int) Key(Vector3 p, float scale) => ((int)Math.Round(p.X * scale), (int)Math.Round(p.Z * scale));
        var edges = new Dictionary<(int, int), List<Edge>>();
        for (int i = 0; i < rawP.Length / 3; i += 6)
        {
            var points = Enumerable.Range(i, 6).Select(Position).Distinct().ToArray();
            if (points.Length != 4 || points.Min(p => p.Y) > -0.279f || points.Max(p => p.Y) < 0.009f || Math.Abs(Normal(i).Y) > 0.001f) continue;
            var top = points.Where(p => p.Y > 0.009f).ToArray(); if (top.Length != 2) continue;
            foreach (var pair in new[] { (top[0], top[1]), (top[1], top[0]) })
            {
                var p = pair.Item1; p.Y = 0; var inside = pair.Item2 - pair.Item1; inside.Y = 0;
                var key = Key(p, 1000); if (!edges.TryGetValue(key, out var list)) edges[key] = list = new();
                list.Add(new(p, Normal(i).Normalized(), inside));
            }
        }
        var corners = new List<Corner>();
        foreach (var list in edges.Values)
        {
            if (list.Count != 2 || list[0].N.Dot(list[1].N) > 0.99f || list.Any(e => e.Inside.Length() < 0.1f)) continue;
            var n = (list[0].N + list[1].N).Normalized();
            if (list.Any(e => e.Inside.Normalized().Dot(n) >= -0.01f)) continue; // An inside junction has no exposed outside arris.
            corners.Add(new(list[0].P, n, new()));
        }
        var nearby = new Dictionary<(int, int), List<Corner>>();
        foreach (var corner in corners)
        {
            var cell = Key(corner.P, 4);
            for (int x = -1; x <= 1; x++) for (int z = -1; z <= 1; z++)
            { var key = (cell.Item1 + x, cell.Item2 + z); if (!nearby.TryGetValue(key, out var list)) nearby[key] = list = new(); list.Add(corner); }
        }
        var madeP = new List<Vector3>(); var madeN = new List<Vector3>(); var madeUv = new List<Vector2>();
        void Triangle(Point a, Point b, Point c)
        {
            if ((b.P - a.P).Cross(c.P - a.P).Dot(a.N + b.N + c.N) > 0) (b, c) = (c, b);
            foreach (var p in new[] { a, b, c }) { madeP.Add(p.P); madeN.Add(p.N); madeUv.Add(p.Uv); }
        }
        for (int i = 0; i < vertices.Count; i += 3)
        {
            var candidates = new HashSet<Corner>();
            for (int k = i; k < i + 3; k++)
                if (nearby.TryGetValue(Key(vertices[k], 4), out var list))
                    foreach (var corner in list) if (new Vector2(vertices[k].X - corner.P.X, vertices[k].Z - corner.P.Z).LengthSquared() < 0.0144f) candidates.Add(corner);
            if (candidates.Count == 0)
            { for (int k = i; k < i + 3; k++) { madeP.Add(vertices[k]); madeN.Add(normals[k]); madeUv.Add(uv[k]); } continue; }
            var polygon = Enumerable.Range(i, 3).Select(k => new Point(vertices[k], normals[k], uv[k])).ToList();
            foreach (var corner in candidates)
            {
                float Distance(Point p) => (p.P - corner.P).Dot(corner.N) + Depth;
                if (polygon.All(p => Distance(p) <= 0.000001f)) continue;
                var clipped = new List<Point>();
                for (int j = 0; j < polygon.Count; j++)
                {
                    var a = polygon[j]; var b = polygon[(j + 1) % polygon.Count]; float da = Distance(a), db = Distance(b);
                    if (da <= 0) clipped.Add(a);
                    if ((da <= 0) == (db <= 0)) continue;
                    float t = da / (da - db); var p = new Point(a.P.Lerp(b.P, t), a.N.Lerp(b.N, t).Normalized(), a.Uv.Lerp(b.Uv, t));
                    clipped.Add(p); corner.Boundary.Add(p);
                }
                polygon = clipped;
            }
            for (int j = 1; j < polygon.Count - 1; j++) Triangle(polygon[0], polygon[j], polygon[j + 1]);
        }
        int count = 0;
        foreach (var corner in corners.Where(c => c.Boundary.Count >= 3))
        {
            var across = Vector3.Up.Cross(corner.N).Normalized();
            Vector2 Project(Point p) => new((p.P - corner.P).Dot(across), p.P.Y);
            var hull = Geometry2D.ConvexHull(corner.Boundary.Select(Project).ToArray());
            if (hull.Length < 4) continue;
            float referenceU = corner.Boundary[0].Uv.X;
            Point At(Vector2 p)
            {
                var match = corner.Boundary.MinBy(v => Project(v).DistanceSquaredTo(p));
                return match with { N = corner.N, Uv = new(match.Uv.X - Mathf.Round(match.Uv.X - referenceU), match.Uv.Y) };
            }
            for (int i = 1; i < hull.Length - 2; i++) Triangle(At(hull[0]), At(hull[i]), At(hull[i + 1]));
            count++;
        }
        vertices.Clear(); vertices.AddRange(madeP); normals.Clear(); normals.AddRange(madeN); uv.Clear(); uv.AddRange(madeUv);
        return count;
    }
}
