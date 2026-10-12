using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;

namespace Scheldemist.Native.Recovery;

/// <summary>Recover the sweep at full precision. Mitered ends need projected UVs, not four equal end coordinates.</summary>
public static class RecoveryCoping
{
    public const float LandRadius = 0.012f, UnderRadius = 0.01f;
    private readonly record struct Corner(Vector3 P, Vector3 N, Vector2 Uv);
    public static ArrayMesh Build(RecoveryGlb source, int node, Material material)
    {
        var primitive = source.Json["meshes"]![source.Json["nodes"]![node]!["mesh"]!.GetValue<int>()]!["primitives"]![0]!;
        if (primitive["indices"] != null || (primitive["mode"]?.GetValue<int>() ?? 4) != 4) throw new InvalidDataException("Coping requires the original unindexed triangle sweep.");
        var attributes = primitive["attributes"]!;
        var positions = source.ReadFloats(attributes["POSITION"]!.GetValue<int>(), 3);
        var normals = source.ReadFloats(attributes["NORMAL"]!.GetValue<int>(), 3);
        var uv = source.ReadFloats(attributes["TEXCOORD_0"]!.GetValue<int>(), 2);
        if (positions.Length != normals.Length || positions.Length / 3 != uv.Length / 2 || positions.Length % 18 != 0) throw new InvalidDataException("Invalid coping sweep arrays.");
        var vertices = new List<Vector3>(); var ns = new List<Vector3>(); var uvs = new List<Vector2>();
        var segments = new Dictionary<(int, float, float), (Vector3 origin, Vector3 along, Vector3 landNormal, float scale, int pieces)>();
        int segmentNumber = 0;
        Corner At(int i) => new(new(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]), new(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]), new(uv[i * 2], uv[i * 2 + 1]));
        void Triangle(Corner a, Corner b, Corner c)
        {
            // Godot's front faces are clockwise; glTF's are counterclockwise.
            if ((b.P - a.P).Cross(c.P - a.P).Dot(a.N + b.N + c.N) > 0) (b, c) = (c, b);
            foreach (var p in new[] { a, b, c }) { vertices.Add(p.P); ns.Add(p.N); uvs.Add(p.Uv); }
        }
        for (int i = 0; i < positions.Length / 3; i += 6)
        {
            var points = Enumerable.Range(i, 6).Select(At).DistinctBy(p => p.Uv).ToArray();
            if (points.Length != 4) throw new InvalidDataException("Coping face is not a UV quad.");
            float u0 = points.Min(p => p.Uv.X), u1 = points.Max(p => p.Uv.X), v0 = points.Max(p => p.Uv.Y), v1 = points.Min(p => p.Uv.Y);
            Corner Find(float u, float v) => points.Single(p => p.Uv == new Vector2(u, v));
            var a = Find(u0, v0); var b = Find(u1, v0); var c = Find(u1, v1); var d = Find(u0, v1);
            // Separate quay rings can have identical UV endpoints. The vertical land face begins a new sweep segment.
            if (Math.Abs(a.N.Y) < 0.00001f && Math.Abs(d.N.Y) < 0.00001f && d.P.Y > a.P.Y + 0.01f) segmentNumber++;
            var key = (segmentNumber, u0, u1);
            if (!segments.TryGetValue(key, out var segment))
            {
                var delta = b.P - a.P; delta.Y = 0;
                var along = new Vector3(-a.N.Z, 0, a.N.X).Normalized();
                if (along.Dot(delta) < 0) along = -along;
                float length = delta.Dot(along);
                if (length < 0.001f || u1 <= u0) throw new InvalidDataException("Degenerate coping segment.");
                segment = (a.P, along, new Vector3(a.N.X, 0, a.N.Z).Normalized(), (u1 - u0) / length, Math.Max(1, (int)Math.Ceiling(length / 4)));
                segments.Add(key, segment);
            }
            Corner Projected(Vector3 p, Vector3 n, float v) => new(p, n, new(u0 + (p - segment.origin).Dot(segment.along) * segment.scale, v));
            void Strip(Corner sa, Corner sb, Corner sc, Corner sd)
            {
                Corner Along(Corner start, Corner end, float t, float shift) => new(start.P.Lerp(end.P, t), start.N.Lerp(end.N, t).Normalized(), start.Uv.Lerp(end.Uv, t) - new Vector2(shift, 0));
                for (int column = 0; column < segment.pieces; column++)
                {
                    float t0 = (float)column / segment.pieces, t1 = (float)(column + 1) / segment.pieces;
                    float shift = Mathf.Floor(sa.Uv.Lerp(sb.Uv, t0).X);
                    var aa = Along(sa, sb, t0, shift); var bb = Along(sa, sb, t1, shift); var cc = Along(sd, sc, t1, shift); var dd = Along(sd, sc, t0, shift);
                    Triangle(aa, bb, cc); Triangle(aa, cc, dd);
                }
            }
            bool land = Math.Abs(a.N.Y) < 0.00001f && Math.Abs(d.N.Y) < 0.00001f && d.P.Y > a.P.Y + 0.01f;
            bool top = a.N.Y > 0.999f && d.N.Y > 0.999f;
            bool front = Math.Abs(a.N.Y) < 0.00001f && Math.Abs(d.N.Y) < 0.00001f && d.P.Y < a.P.Y - 0.1f;
            bool underside = a.N.Y < -0.999f && d.N.Y < -0.999f;
            if (land)
            {
                v1 += LandRadius / (d.P.Y - a.P.Y) * (v0 - v1);
                c = c with { P = c.P - Vector3.Up * LandRadius }; d = d with { P = d.P - Vector3.Up * LandRadius };
            }
            if (top)
            {
                var water = -segment.landNormal;
                float width = (d.P - a.P).Dot(water);
                var left = (d.P - a.P) / width; var right = (c.P - b.P) / width;
                float startV = v0 + LandRadius / 0.06f * (1 - v0), endV = v0 + LandRadius / width * (v1 - v0);
                Corner Arc(Corner edge, Vector3 basis, float t)
                {
                    float angle = t * Mathf.Pi / 2;
                    var p = edge.P + basis * (LandRadius * (1 - Mathf.Cos(angle))) - Vector3.Up * (LandRadius * (1 - Mathf.Sin(angle)));
                    return Projected(p, segment.landNormal * Mathf.Cos(angle) + Vector3.Up * Mathf.Sin(angle), Mathf.Lerp(startV, endV, t));
                }
                for (int row = 0; row < 6; row++) Strip(Arc(a, left, row / 6f), Arc(b, right, row / 6f), Arc(b, right, (row + 1) / 6f), Arc(a, left, (row + 1) / 6f));
                a = a with { P = a.P + left * LandRadius }; b = b with { P = b.P + right * LandRadius }; v0 = endV;
            }
            if (front)
            {
                v1 += UnderRadius / (a.P.Y - d.P.Y) * (v0 - v1);
                c = c with { P = c.P + Vector3.Up * UnderRadius }; d = d with { P = d.P + Vector3.Up * UnderRadius };
            }
            if (underside)
            {
                var water = -segment.landNormal;
                float width = (a.P - d.P).Dot(water);
                var left = (a.P - d.P) / width; var right = (b.P - c.P) / width;
                float startV = v0 + UnderRadius / 0.29f * (0.4778882f - v0), endV = v0 + UnderRadius / width * (v1 - v0);
                Corner Arc(Corner edge, Vector3 basis, float t)
                {
                    float angle = t * Mathf.Pi / 2;
                    var p = edge.P - basis * (UnderRadius * (1 - Mathf.Cos(angle))) + Vector3.Up * (UnderRadius * (1 - Mathf.Sin(angle)));
                    return Projected(p, water * Mathf.Cos(angle) - Vector3.Up * Mathf.Sin(angle), Mathf.Lerp(startV, endV, t));
                }
                for (int row = 0; row < 6; row++) Strip(Arc(a, left, row / 6f), Arc(b, right, row / 6f), Arc(b, right, (row + 1) / 6f), Arc(a, left, (row + 1) / 6f));
                a = a with { P = a.P - left * UnderRadius }; b = b with { P = b.P - right * UnderRadius }; v0 = endV;
            }
            float theta0 = Mathf.Acos(Mathf.Clamp(a.N.Y, -1, 1)), theta1 = Mathf.Acos(Mathf.Clamp(d.N.Y, -1, 1));
            bool round = a.N.Y >= -0.00001f && d.N.Y >= -0.00001f && theta1 > theta0 + 0.01f && a.P.Y >= 0.009f && d.P.Y >= 0.009f;
            int rows = round ? 3 : 1;
            Corner Section(Corner upper, Corner lower, float t)
            {
                var p = upper.P.Lerp(lower.P, t); var normal = upper.N.Lerp(lower.N, t).Normalized();
                if (round)
                {
                    float theta = Mathf.Lerp(theta0, theta1, t);
                    var across = lower.P - upper.P; across.Y = 0;
                    var basis = across / (0.05f * (Mathf.Sin(theta1) - Mathf.Sin(theta0)));
                    p = upper.P + basis * (0.05f * (Mathf.Sin(theta) - Mathf.Sin(theta0))) + Vector3.Up * (0.05f * (Mathf.Cos(theta) - Mathf.Cos(theta0)));
                    // The mitre displaces vertices along the quay, but the surface normal still faces across it.
                    var outward = new Vector3(lower.N.X, 0, lower.N.Z).Normalized();
                    normal = outward * Mathf.Sin(theta) + Vector3.Up * Mathf.Cos(theta);
                }
                return Projected(p, normal, Mathf.Lerp(v0, v1, t));
            }
            for (int row = 0; row < rows; row++)
            {
                var sa = Section(a, d, (float)row / rows); var sb = Section(b, c, (float)row / rows);
                var sd = Section(a, d, (float)(row + 1) / rows); var sc = Section(b, c, (float)(row + 1) / rows);
                Strip(sa, sb, sc, sd);
            }
        }
        int corners = RecoveryCopingCorners.Bevel(vertices, ns, uvs, positions, normals);
        var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = vertices.ToArray(); arrays[(int)Mesh.ArrayType.Normal] = ns.ToArray(); arrays[(int)Mesh.ArrayType.TexUV] = uvs.ToArray();
        var mesh = new ArrayMesh { ResourceName = "quay_coping" };
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays); mesh.SurfaceSetMaterial(0, material);
        mesh.SetMeta("native_coping_projection", 3); mesh.SetMeta("native_nose_radius", 0.05f);
        mesh.SetMeta("native_land_radius", LandRadius); mesh.SetMeta("native_under_radius", UnderRadius);
        mesh.SetMeta("native_corner_bevel", RecoveryCopingCorners.Depth); mesh.SetMeta("native_bevelled_corners", corners);
        return mesh;
    }
}
