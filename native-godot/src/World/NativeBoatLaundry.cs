using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Replace the boats' separate washing cards with the same hung garments as the street lines.
/// Keep hulls and rigging unchanged. New moored MultiMeshes follow the boat's existing motion row.</summary>
public sealed partial class NativeBoatLaundry
{
    private readonly Func<string, string?, Mesh> garment;
    private readonly Mesh peg;
    private sealed record Piece(ArrayMesh Mesh, Transform3D At, string Kind);
    private sealed record Conversion(ArrayMesh Body, Piece[] Clothes);
    private readonly Dictionary<Mesh, Conversion> converted = new();
    // Six authored cards: include a sheet without adding a seventh attachment or moving the line.
    private static readonly string[] Kinds = { "shirt", "shift", "trousers", "apron", "towel", "sheet", "stockings" };
    public NativeBoatLaundry(Func<string, string?, Mesh> garment, Mesh peg) => (this.garment, this.peg) = (garment, peg);

    // Boat motion owns only the original row. These children keep each garment's local Y=0 attachment,
    // which the existing cloth_sway shader needs, then follow the row after Boats has written its frames.
    private sealed partial class RowFollower : Node
    {
        public MultiMeshInstance3D Source = null!;
        public (MultiMesh Mesh, Transform3D Attachment)[] Pieces = Array.Empty<(MultiMesh, Transform3D)>();
        public override void _Process(double delta)
        {
            var source = Source.Multimesh;
            foreach (var piece in Pieces)
            {
                if (piece.Mesh.InstanceCount != source.InstanceCount) piece.Mesh.InstanceCount = source.InstanceCount;
                piece.Mesh.VisibleInstanceCount = source.VisibleInstanceCount;
                for (int i = 0; i < source.InstanceCount; i++)
                    piece.Mesh.SetInstanceTransform(i, source.GetInstanceTransform(i) * piece.Attachment);
            }
        }
    }

    private static bool Helper(Node node, Node root)
    {
        for (Node? p = node; p != null; p = p.GetParent())
        {
            if (Scheldemist.Models.ModelLibrary.IsAside(p.Name.ToString())) return true;
            if (p == root) break;
        }
        return false;
    }

    public void Dress(Node3D root)
    {
        foreach (var n in BakedWorld.All(root).OfType<GeometryInstance3D>().ToArray())
        {
            if (Helper(n, root)) continue; // Hidden _far/_walk/_block prototypes must never acquire a second visible line.
            Mesh? source = n is MeshInstance3D mi ? mi.Mesh : (n as MultiMeshInstance3D)?.Multimesh?.Mesh;
            if (source is not ArrayMesh array || !Enumerable.Range(0, source.GetSurfaceCount()).Any(s => Candidate(source.SurfaceGetMaterial(s)))) continue;
            if (!converted.TryGetValue(source, out var result)) converted[source] = result = Convert(array);
            if (result.Clothes.Length == 0) continue;
            var following = new List<(MultiMesh, Transform3D)>();
            if (n is MultiMeshInstance3D row)
            {
                var body = (MultiMesh)row.Multimesh.Duplicate(); body.Mesh = result.Body; row.Multimesh = body;
            }
            else ((MeshInstance3D)n).Mesh = result.Body;
            for (int i = 0; i < result.Clothes.Length; i++)
            {
                var piece = result.Clothes[i]; GeometryInstance3D clothes;
                if (n is MultiMeshInstance3D moored)
                {
                    var mm = (MultiMesh)moored.Multimesh.Duplicate(); mm.Mesh = piece.Mesh;
                    clothes = new MultiMeshInstance3D { Multimesh = mm };
                    following.Add((mm, piece.At));
                }
                else clothes = new MeshInstance3D { Mesh = piece.Mesh, Transform = piece.At };
                clothes.Name = "boat_laundry_" + i + "_" + piece.Kind;
                clothes.Layers = n.Layers; clothes.CastShadow = n.CastShadow;
                clothes.VisibilityRangeBegin = n.VisibilityRangeBegin; clothes.VisibilityRangeBeginMargin = n.VisibilityRangeBeginMargin;
                clothes.VisibilityRangeEnd = n.VisibilityRangeEnd > 0 ? Math.Min(n.VisibilityRangeEnd, NativeStreetFurniture.Near) : NativeStreetFurniture.Near;
                clothes.VisibilityRangeEndMargin = n.VisibilityRangeEnd > 0 ? n.VisibilityRangeEndMargin : NativeStreetFurniture.Fade;
                clothes.VisibilityRangeFadeMode = n.VisibilityRangeFadeMode;
                NativeWashingVisibility.Attach(clothes);
                // A child inherits the source's hidden state and transform; it is not another Boats.Rows entry.
                n.AddChild(clothes);
                clothes.SetMeta("native_boat_washing_pieces", 1);
                clothes.SetMeta("native_boat_washing_removed_triangles", 2);
                clothes.SetMeta("native_boat_washing_raw_preserved", true);
                clothes.SetMeta("native_boat_washing_kind", piece.Kind);
                clothes.SetMeta("native_boat_washing_local_origin", true);
                clothes.SetMeta("native_washing_first_at", Vector3.Zero);
                clothes.SetMeta("native_washing_first_normal", Vector3.Back);
            }
            if (n is MultiMeshInstance3D original)
            {
                var follow = new RowFollower { Name = "washing_follow", ProcessPriority = -49, Source = original, Pieces = following.ToArray() };
                original.AddChild(follow); follow._Process(0);
            }
        }
    }
    private static bool Candidate(Material? m) => m?.ResourceName is "washing" or "boats_thin";

    private ArrayMesh DressedPiece(Mesh cloth, string kind, float scale)
    {
        var builders = new Dictionary<Material, SurfaceTool>();
        void Append(Mesh mesh, Transform3D at)
        {
            for (int s = 0; s < mesh.GetSurfaceCount(); s++)
            {
                var mat = mesh.SurfaceGetMaterial(s);
                if (!builders.TryGetValue(mat, out var st)) { st = new SurfaceTool(); st.Begin(Mesh.PrimitiveType.Triangles); st.SetMaterial(mat); builders.Add(mat, st); }
                st.AppendFrom(mesh, s, at);
            }
        }
        Append(cloth, Transform3D.Identity);
        foreach (float u in NativeStreetFurniture.PegPositions(kind))
            Append(peg, new Transform3D(Basis.Identity.Scaled(Vector3.One / scale), new Vector3(u, 0, 0)));
        var meshWithPegs = new ArrayMesh(); foreach (var st in builders.Values) { st.Commit(meshWithPegs); st.Dispose(); }
        return meshWithPegs;
    }

    private Conversion Convert(ArrayMesh source)
    {
        var originalSurfaces = (Godot.Collections.Array)source.Get("_surfaces");
        var bodySurfaces = new Godot.Collections.Array(); int removedTriangles = 0;
        var pieces = new List<Piece>();
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var raw = originalSurfaces[s].AsGodotDictionary();
            if (!Candidate(source.SurfaceGetMaterial(s)))
            {
                bodySurfaces.Add(raw); continue;
            }
            var arrays = source.SurfaceGetArrays(s);
            var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var ids = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, vertices.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            var cells = arrays[(int)Mesh.ArrayType.TexUV2].VariantType == Variant.Type.Nil ? Array.Empty<Vector2>() : arrays[(int)Mesh.ArrayType.TexUV2].AsVector2Array();
            bool atlas = source.SurfaceGetMaterial(s).ResourceName == "boats_thin";
            // boats_atlas.json: washing occupies column 6, row 3 in the 8 x 8 atlas.
            // Psx/recovered_atlas decode (UV2 + fract(UV0)) / 8: UV0 is LOCAL,
            // not an atlas coordinate. Imported UV2 cells have small quantization error.
            // The same material also draws cabin curtains. Only the half-tile clothes cards
            // belong outside; the curtains' UV width is .38 and must remain in their windows.
            bool WashingTriangle(int i)
            {
                if (!atlas) return true;
                if (cells.Length != vertices.Length) throw new InvalidOperationException("Boat atlas has no per-vertex UV2 cells.");
                for (int corner = 0; corner < 3; corner++)
                    if (cells[ids[i + corner]].DistanceSquaredTo(new Vector2(6, 3)) > .001f * .001f) return false;
                return true;
            }
            var clothIds = Enumerable.Range(0, ids.Length / 3).Where(t => WashingTriangle(t * 3)).SelectMany(t => ids.Skip(t * 3).Take(3)).ToArray();
            var parent = Enumerable.Range(0, vertices.Length).ToArray();
            int Root(int i) { while (parent[i] != i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
            void Join(int a, int b) => parent[Root(a)] = Root(b);
            var welded = new Dictionary<Vector3, int>();
            foreach (int i in clothIds.Distinct()) { if (welded.TryGetValue(vertices[i], out int old)) Join(i, old); else welded.Add(vertices[i], i); }
            for (int i = 0; i < clothIds.Length; i += 3) { Join(clothIds[i], clothIds[i + 1]); Join(clothIds[i], clothIds[i + 2]); }
            var removed = new HashSet<int>();
            foreach (var group in clothIds.Distinct().GroupBy(Root))
            {
                float uvWidth = group.Max(i => uv[i].X) - group.Min(i => uv[i].X);
                float uvHeight = group.Max(i => uv[i].Y) - group.Min(i => uv[i].Y);
                // washing_line uses one exact half-by-half tile. Curtains use .38 by .38.
                if (MathF.Abs(uvWidth - .5f) > .002f || MathF.Abs(uvHeight - .5f) > .002f) continue;
                var points = group.Select(i => vertices[i]).Distinct().OrderByDescending(p => p.Y).ToArray();
                if (points.Length != 4) throw new InvalidOperationException("Boat washing card does not have four corners.");
                Vector3 a = points[0], b = points[1], x = b - a;
                float span = x.Length(); if (span < .02f) throw new InvalidOperationException("Boat washing has no top edge.");
                x /= span; Vector3 y = (Vector3.Up - x * x.Dot(Vector3.Up)).Normalized();
                var basis = new Basis(x, y, x.Cross(y));
                string kind = Kinds[pieces.Count % Kinds.Length]; var mesh = garment(kind, null);
                float width = mesh.GetAabb().Size.X;
                float scale = Mathf.Clamp(span / MathF.Max(width, .01f), .65f, 1.15f);
                var at = new Transform3D(basis.Scaled(Vector3.One * scale), (a + b) * .5f + Vector3.Up * .03f);
                pieces.Add(new Piece(DressedPiece(mesh, kind, scale), at, kind));
                foreach (int i in group) removed.Add(i);
            }
            if (removed.Count == 0) { bodySurfaces.Add(raw); continue; }
            var keptTriangles = Enumerable.Range(0, ids.Length / 3).Where(t => !(removed.Contains(ids[t * 3]) && removed.Contains(ids[t * 3 + 1]) && removed.Contains(ids[t * 3 + 2]))).ToArray();
            removedTriangles += ids.Length / 3 - keptTriangles.Length;
            if (keptTriangles.Length > 0)
            {
                // Keep the original compressed positions, normals, UVs, colours, bounds and materials byte for byte.
                // Rebuilding from SurfaceGetArrays would quantize every hull/curtain/rigging vertex again.
                // The audited baked/library washing surfaces have indices and no generated LODs.
                if (!raw.ContainsKey("index_data") || raw.ContainsKey("lods"))
                    throw new InvalidOperationException("Boat washing index layout needs an explicit extraction rule.");
                var before = raw["index_data"].AsByteArray(); int stride = before.Length / ids.Length;
                if (stride is not (2 or 4) || before.Length != ids.Length * stride)
                    throw new InvalidOperationException("Boat washing index stride changed.");
                var after = new byte[keptTriangles.Length * 3 * stride];
                for (int i = 0; i < keptTriangles.Length; i++)
                    Buffer.BlockCopy(before, keptTriangles[i] * 3 * stride, after, i * 3 * stride, 3 * stride);
                var changed = raw.Duplicate(); changed["index_data"] = after; changed["index_count"] = keptTriangles.Length * 3;
                bodySurfaces.Add(changed);
            }
        }
        if (removedTriangles != pieces.Count * 2) throw new InvalidOperationException("Boat laundry removed more than the two triangles of each card.");
        if (pieces.Count == 0) return new Conversion(source, Array.Empty<Piece>());
        var body = new ArrayMesh { ResourceName = source.ResourceName, CustomAabb = source.CustomAabb };
        foreach (var key in source.GetMetaList()) body.SetMeta(key, source.GetMeta(key));
        body.Set("_surfaces", bodySurfaces);
        // Read back the actual resource: no silent format conversion or lost material may alter the remaining boat.
        var actual = (Godot.Collections.Array)body.Get("_surfaces");
        if (actual.Count != bodySurfaces.Count) throw new InvalidOperationException("Boat body lost surfaces.");
        for (int s = 0; s < actual.Count; s++)
        {
            var expected = bodySurfaces[s].AsGodotDictionary(); var found = actual[s].AsGodotDictionary();
            foreach (string key in new[] { "vertex_data", "attribute_data", "skin_data", "index_data" })
                if (expected.ContainsKey(key) != found.ContainsKey(key) || expected.ContainsKey(key) && !expected[key].AsByteArray().AsSpan().SequenceEqual(found[key].AsByteArray()))
                    throw new InvalidOperationException("Boat body buffer changed: " + key);
            foreach (string key in new[] { "format", "primitive", "aabb", "uv_scale", "vertex_count", "index_count", "material", "name" })
                if (expected.ContainsKey(key) != found.ContainsKey(key) || expected.ContainsKey(key) && !SameProperty(key, expected[key], found[key]))
                    throw new InvalidOperationException("Boat body property changed: " + key);
        }
        return new Conversion(body, pieces.ToArray());
    }

    private static bool SameProperty(string key, Variant a, Variant b) => key switch
    {
        "aabb" => a.AsAabb() == b.AsAabb(),
        "uv_scale" => a.AsVector4() == b.AsVector4(),
        "material" => a.AsGodotObject().GetInstanceId() == b.AsGodotObject().GetInstanceId(),
        "name" => a.AsString() == b.AsString(),
        _ => a.AsInt64() == b.AsInt64(),
    };
}
