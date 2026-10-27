using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// Houses pulled down after the bake: city_build.json marks them <c>"gone": true, "razed": true</c>. "gone" alone means the bake never
/// built the house; the rest of the game (doors, routing, gutters, gulls, market stalls) already leaves both kinds out. A razed house
/// is still in the town's merged chunks, so its triangles are cut out of them here, before collision and navigation are built from
/// the meshes. The merged chunks give every vertex of one house the same colour alpha; the house's own alpha is the one that covers
/// most of its footprint, and only triangles with that alpha near the footprint go, so a neighbour's wall, cornice or roof that
/// touches it stays. The night window glows carry no house alpha: there a glow goes when it lies on the footprint and does not face
/// out of a standing neighbour (the neighbour's own front on the shared line).
/// </summary>
public static class NativeRazedHouses
{
    public sealed record Result(int Houses, int Triangles, int WindowGlows, IReadOnlyList<string> Notes)
    {
        internal IReadOnlyList<Vector2[]> Razed { get; init; } = Array.Empty<Vector2[]>();
        internal IReadOnlyList<Vector2[]> Standing { get; init; } = Array.Empty<Vector2[]>();
        /// <summary>A point that belonged to a razed house: near one, and nearer to it than to any standing house.</summary>
        public bool Owned(float x, float z) => Razed.Count > 0 && Belongs(new Vector2(x, z), Razed, Standing);
    }

    private sealed record House(int Index, Vector2[] Outline, bool Razed);

    // the house's own parts reach this far past its outline (cornices, sills, eaves, drainpipes)
    private const float Reach = 1.2f;
    // the triangles that name a house's alpha lie at least this far inside its outline
    private const float Inset = 0.4f;
    private static readonly Regex DressingChunk = new("^(lively|streetlife|clutter|posters|litter)_", RegexOptions.Compiled);

    public static Result Cut(Node3D town, string cityBuildPath)
    {
        var notes = new List<string>();
        var houses = Read(cityBuildPath);
        var razed = houses.Where(h => h.Razed).ToList();
        if (razed.Count == 0) return new(0, 0, 0, notes);
        var meshes = BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh).ToList();
        var chunks = meshes.Where(m => m.Name.ToString().StartsWith("city_", StringComparison.Ordinal)).ToList();
        var glows = meshes.Where(m => m.Name.ToString().StartsWith("ambient_windows", StringComparison.Ordinal) || m.GetParent()?.Name.ToString().StartsWith("ambient_windows", StringComparison.Ordinal) == true).ToList();
        var standing = houses.Where(h => !h.Razed && razed.Any(r => Near(h.Outline, r.Outline, Reach + 1))).ToList();

        var tags = new Dictionary<int, int>();
        foreach (var house in razed)
        {
            int? tag = OwnAlpha(chunks, house.Outline);
            if (tag == null) { notes.Add($"house {house.Index}: no own alpha found, left as baked"); continue; }
            // a standing neighbour with the same alpha would lose its edge: leave the house rather than cut a neighbour
            var near = standing.Where(n => Near(n.Outline, house.Outline, Reach + 1)).Where(n => OwnAlpha(chunks, n.Outline) == tag).Select(n => n.Index).ToList();
            if (near.Count > 0) { notes.Add($"house {house.Index}: alpha {tag} also on neighbour {string.Join(",", near)}, left as baked"); continue; }
            tags[house.Index] = tag.Value;
        }
        var cut = razed.Where(h => tags.ContainsKey(h.Index)).ToList();
        bool Touches(MeshInstance3D m) => cut.Any(h => Overlaps(WorldOf(m) * m.GetAabb(), h.Outline, Reach));
        chunks = chunks.Where(Touches).ToList(); glows = glows.Where(Touches).ToList();
        int triangles = 0, glowTriangles = 0;
        foreach (var mesh in chunks)
            triangles += Filter(mesh, (a, b, c, alpha) => cut.Any(h => alpha == tags[h.Index] && Within(h.Outline, Centre(a, b, c), Reach)));
        // A chunk's collision stand-ins (the plain boxes Solid takes for its fine stone and drainage, issues #157 #163) carry
        // no alpha: a box goes when it lies near a razed house and nearer to it than to any standing one.
        int standIns = 0;
        foreach (var mesh in chunks)
        {
            if (mesh.Mesh is not ArrayMesh am || !am.HasMeta("native_solid_stand_in")) continue;
            var faces = am.GetMeta("native_solid_stand_in").AsVector3Array(); var xf = WorldOf(mesh); var keptFaces = new List<Vector3>(faces.Length);
            var razedLines = cut.Select(h => h.Outline).ToList(); var standingLines = standing.Select(h => h.Outline).ToList();
            for (int t = 0; t + 2 < faces.Length; t += 3)
            {
                var c = Centre(xf * faces[t], xf * faces[t + 1], xf * faces[t + 2]);
                if (Belongs(new Vector2(c.X, c.Z), razedLines, standingLines)) { standIns++; continue; }
                keptFaces.Add(faces[t]); keptFaces.Add(faces[t + 1]); keptFaces.Add(faces[t + 2]);
            }
            if (keptFaces.Count != faces.Length) am.SetMeta("native_solid_stand_in", keptFaces.ToArray());
        }
        if (standIns > 0) notes.Add($"collision stand-ins at the razed houses: {standIns} triangles");
        // The street dressing the bake merged by kind (shop fronts, street life, clutter, posters, litter) carries no house alpha either:
        // a piece goes when it is near a razed house and nearer to it than to any standing one, so a neighbour's door keeps its baskets.
        int dressingTriangles = 0;
        foreach (var mesh in meshes.Where(m => DressingChunk.IsMatch(m.Name.ToString())).Where(Touches))
            dressingTriangles += Filter(mesh, (a, b, c, _) =>
            {
                var p = Centre(a, b, c);
                return Belongs(new Vector2(p.X, p.Z), cut.Select(h => h.Outline).ToList(), standing.Select(h => h.Outline).ToList());
            });
        if (dressingTriangles > 0) notes.Add($"street dressing at the razed houses: {dressingTriangles} triangles");
        // copies (weeds at the wall foot, goods by the door) standing on or against a razed house: the copy set is rebuilt without them
        int copiesGone = 0;
        var razedOutlines = cut.Select(h => h.Outline).ToList(); var standingOutlines = standing.Select(h => h.Outline).ToList();
        foreach (var copies in BakedWorld.All(town).OfType<MultiMeshInstance3D>().Where(m => m.Multimesh is { InstanceCount: > 0 }))
        {
            var mm = copies.Multimesh; var xf = WorldOf(copies);
            var keep = Enumerable.Range(0, mm.InstanceCount).Where(i => { var at = xf * mm.GetInstanceTransform(i).Origin; return !Belongs(new Vector2(at.X, at.Z), razedOutlines, standingOutlines); }).ToList();
            if (keep.Count == mm.InstanceCount) continue;
            var transforms = keep.Select(mm.GetInstanceTransform).ToList();
            var colours = mm.UseColors ? keep.Select(mm.GetInstanceColor).ToList() : null;
            var custom = mm.UseCustomData ? keep.Select(mm.GetInstanceCustomData).ToList() : null;
            copiesGone += mm.InstanceCount - keep.Count;
            mm.InstanceCount = keep.Count;
            for (int i = 0; i < keep.Count; i++)
            {
                mm.SetInstanceTransform(i, transforms[i]);
                if (colours != null) mm.SetInstanceColor(i, colours[i]);
                if (custom != null) mm.SetInstanceCustomData(i, custom[i]);
            }
        }
        if (copiesGone > 0) notes.Add($"copies at the razed houses: {copiesGone}");
        foreach (var mesh in glows)
            glowTriangles += Filter(mesh, (a, b, c, _) =>
            {
                var centre = Centre(a, b, c);
                if (!cut.Any(h => Within(h.Outline, centre, 0.3f))) return false;
                var normal = (b - a).Cross(c - a);
                var flat = new Vector2(normal.X, normal.Z);
                if (flat.LengthSquared() < 1e-8f) return true;
                // a glow on a standing neighbour's front: its window looks out of that neighbour, into the cleared ground
                foreach (var n in standing)
                    if (Within(n.Outline, centre, 0.3f) && !Inside(n.Outline, new Vector2(centre.X, centre.Z) + flat.Normalized() * 0.5f)) return false;
                return true;
            });
        foreach (var h in cut) notes.Add($"house {h.Index}: razed (alpha {tags[h.Index]})");
        return new(cut.Count, triangles, glowTriangles, notes) { Razed = cut.Select(h => h.Outline).ToList(), Standing = standing.Select(h => h.Outline).ToList() };
    }

    private static bool Belongs(Vector2 q, IReadOnlyList<Vector2[]> razed, IReadOnlyList<Vector2[]> standing)
    {
        float Away(Vector2[] outline) => Inside(outline, q) ? 0 : EdgeDistance(outline, q);
        float razedAt = razed.Min(Away);
        return razedAt <= Reach && standing.All(n => Away(n) > razedAt);
    }

    /// <summary>The bake's light facts (lights.json) for the razed houses go too: their window and door-lantern spill and their lit panes.</summary>
    public static (int Spill, int Panes) DropLights(Result razed, System.Text.Json.Nodes.JsonObject data)
    {
        if (razed.Houses == 0) return (0, 0);
        var spill = data["spill"]!.AsArray();
        var keep = spill.Where(l => l!["kind"]!.GetValue<string>() == "lamp" || !razed.Owned(l["at"]![0]!.GetValue<float>(), l["at"]![2]!.GetValue<float>())).Select(l => l!.DeepClone()).ToArray();
        int spillGone = spill.Count - keep.Length;
        data["spill"] = new System.Text.Json.Nodes.JsonArray(keep);
        // a pane: three corners (x, y, z each), then its hours, tone and kind
        var panes = data["panes"]!.AsArray();
        var kept = new System.Text.Json.Nodes.JsonArray();
        int paneGone = 0;
        foreach (var pane in panes)
        {
            var v = pane!.AsArray();
            float x = (v[0]!.GetValue<float>() + v[3]!.GetValue<float>() + v[6]!.GetValue<float>()) / 3, z = (v[2]!.GetValue<float>() + v[5]!.GetValue<float>() + v[8]!.GetValue<float>()) / 3;
            if (razed.Owned(x, z)) { paneGone++; continue; }
            kept.Add(pane.DeepClone());
        }
        data["panes"] = kept;
        return (spillGone, paneGone);
    }

    /// <summary>Marks the dressing's own nodes: their bodies bring their own collision (Solid leaves them).</summary>
    public const string DressingMeta = "native_razed_dressing";

    // The squares the razing opened (world/town/squares.json): the cathedral's corner (houses 536 and 537) and, since
    // 2026-10-26 (Steve: the houses hugging the churches cleared, the churches free on squares), round Sint-Paulus,
    // Sint-Jacob and Sint-Carolus; also trees on the wide bare earth by the town wall. World x, z; a bench's yaw turns its
    // seat. Each tree is a copy of the town's own trees of its kind (bark and leaves), named as theirs so the trunk is solid.
    public const string SquaresFile = "res://world/town/squares.json";
    private sealed record Tree(string Kind, float X, float Z, float Yaw, float Scale);
    private sealed record Bench(string Id, float X, float Z, float Yaw, string Label, string Asset);
    private sealed record Squares(Tree[] Trees, Bench[] Benches);

    /// <summary>Plants the squares' trees and sets their benches. Returns what was placed.</summary>
    public static IReadOnlyList<string> Dress(Node3D town)
    {
        var placed = new List<string>();
        if (!Godot.FileAccess.FileExists(SquaresFile)) return placed;
        var plan = JsonSerializer.Deserialize<Squares>(Godot.FileAccess.GetFileAsString(SquaresFile), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (plan == null) return placed;
        var copies = town.GetChildren().OfType<MultiMeshInstance3D>().Where(m => m.Multimesh is { InstanceCount: > 0, Mesh: not null }).ToList();
        int next = 9001;
        foreach (var group in plan.Trees.GroupBy(t => t.Kind))
        {
            // the town's trees of the kind: the bark group with the most trees, and its leaves (the next source node)
            var bark = copies.Where(m => Regex.IsMatch(m.Name.ToString(), $@"^INST\d+_tree{group.Key}bark_mm$")).MaxBy(m => m.Multimesh.InstanceCount);
            if (bark == null || !int.TryParse(Regex.Match(bark.Name.ToString(), @"\d+").Value, out int n)
                || copies.FirstOrDefault(m => m.Name.ToString() == $"INST{n + 1}_tree{group.Key}leaves_mm") is not { } leaves) continue;
            var basis = bark.Multimesh.GetInstanceTransform(0).Basis;
            var trees = group.ToArray();
            foreach (var (source, part) in new[] { (bark, "bark"), (leaves, "leaves") })
            {
                var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = source.Multimesh.Mesh, InstanceCount = trees.Length };
                for (int i = 0; i < trees.Length; i++)
                    mm.SetInstanceTransform(i, new Transform3D(basis.Rotated(Vector3.Up, trees[i].Yaw).Scaled(Vector3.One * trees[i].Scale), new Vector3(trees[i].X, 0, trees[i].Z)));
                var copy = new MultiMeshInstance3D { Name = $"INST{next++}_tree{group.Key}{part}_mm", Multimesh = mm };
                foreach (var key in source.GetMetaList()) copy.SetMeta(key, source.GetMeta(key));
                town.AddChild(copy);
            }
            placed.Add($"{trees.Length} {group.Key}");
        }
        foreach (var b in plan.Benches)
        {
            if (ResourceLoader.Load<Scheldemist.Native.Authoring.AuthorAsset>(b.Asset) is not { } bench) continue;
            var seat = new Scheldemist.Native.Authoring.AuthoredObject { Name = "razed_" + b.Id.Replace('-', '_'), ObjectId = b.Id, Asset = bench };
            seat.Position = new Vector3(b.X, 0, b.Z);
            seat.Rotation = new Vector3(0, b.Yaw, 0);
            seat.SetMeta(DressingMeta, true);
            seat.SetMeta(NativeBenches.LabelMeta, b.Label);
            town.AddChild(seat);
        }
        if (plan.Benches.Length > 0) placed.Add($"{plan.Benches.Length} benches");
        return placed;
    }

    private static List<House> Read(string path)
    {
        var result = new List<House>();
        if (!File.Exists(path)) return result;
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        int index = 0;
        foreach (var h in doc.RootElement.GetProperty("houses").EnumerateArray())
        {
            int i = index++;
            bool gone = h.TryGetProperty("gone", out var g) && g.ValueKind == JsonValueKind.True;
            bool razed = h.TryGetProperty("razed", out var r) && r.ValueKind == JsonValueKind.True;
            if (gone && !razed) continue;
            if (!h.TryGetProperty("fp", out var fp) || fp.GetArrayLength() < 3) continue;
            result.Add(new House(i, fp.EnumerateArray().Select(q => new Vector2((float)q[0].GetDouble(), (float)q[1].GetDouble())).ToArray(), razed));
        }
        return result;
    }

    /// <summary>The alpha byte that covers most of a footprint's inner part (by the triangles' plan area and height).</summary>
    private static int? OwnAlpha(List<MeshInstance3D> chunks, Vector2[] outline)
    {
        var area = new Dictionary<int, float>();
        foreach (var mesh in chunks)
        {
            var xf = WorldOf(mesh);
            var box = xf * mesh.GetAabb();
            if (!Overlaps(box, outline, 0)) continue;
            var m = (ArrayMesh)mesh.Mesh;
            for (int s = 0; s < m.GetSurfaceCount(); s++)
            {
                var arrays = m.SurfaceGetArrays(s);
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var colours = arrays[(int)Mesh.ArrayType.Color];
                if (colours.VariantType != Variant.Type.PackedColorArray) continue;
                var col = colours.AsColorArray();
                var index = Indices(arrays, v.Length);
                for (int t = 0; t + 2 < index.Length; t += 3)
                {
                    Vector3 a = xf * v[index[t]], b = xf * v[index[t + 1]], c = xf * v[index[t + 2]];
                    var centre = Centre(a, b, c);
                    var p = new Vector2(centre.X, centre.Z);
                    if (!Inside(outline, p) || EdgeDistance(outline, p) < Inset) continue;
                    int alpha = (int)MathF.Round(col[index[t]].A * 255);
                    area[alpha] = area.GetValueOrDefault(alpha) + (b - a).Cross(c - a).Length() * 0.5f;
                }
            }
        }
        if (area.Count == 0) return null;
        var best = area.MaxBy(kv => kv.Value);
        return best.Value >= area.Values.Sum() * 0.5f ? best.Key : null;
    }

    /// <summary>Drops the triangles a test picks; returns how many went.</summary>
    private static int Filter(MeshInstance3D mesh, Func<Vector3, Vector3, Vector3, int, bool> drop)
    {
        var xf = WorldOf(mesh);
        var source = (ArrayMesh)mesh.Mesh;
        var rebuilt = new ArrayMesh { ResourceName = source.ResourceName };
        // (its metadata too: Solid's stand-in faces and skipped surfaces live there, issue #163)
        foreach (var key in source.GetMetaList()) rebuilt.SetMeta(key, source.GetMeta(key));
        int dropped = 0, empty = 0;
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var arrays = source.SurfaceGetArrays(s);
            var type = source.SurfaceGetPrimitiveType(s);
            if (type == Mesh.PrimitiveType.Triangles)
            {
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var colours = arrays[(int)Mesh.ArrayType.Color];
                var col = colours.VariantType == Variant.Type.PackedColorArray ? colours.AsColorArray() : null;
                var index = Indices(arrays, v.Length);
                var kept = new List<int>(index.Length);
                for (int t = 0; t + 2 < index.Length; t += 3)
                {
                    int alpha = col != null ? (int)MathF.Round(col[index[t]].A * 255) : -1;
                    if (drop(xf * v[index[t]], xf * v[index[t + 1]], xf * v[index[t + 2]], alpha)) { dropped++; continue; }
                    kept.Add(index[t]); kept.Add(index[t + 1]); kept.Add(index[t + 2]);
                }
                // (a surface left without a triangle keeps one of no size: an empty one cannot be built, and the surfaces
                // after it would take the wrong material and the wrong Solid skips)
                if (kept.Count == 0 && index.Length > 0) { empty++; kept.Add(index[0]); kept.Add(index[0]); kept.Add(index[0]); }
                arrays[(int)Mesh.ArrayType.Index] = kept.ToArray();
            }
            rebuilt.AddSurfaceFromArrays(type, arrays, null, null, source.SurfaceGetFormat(s));
            rebuilt.SurfaceSetMaterial(s, source.SurfaceGetMaterial(s));
        }
        // (every triangle gone: the mesh keeps no surface at all, its metadata kept)
        if (dropped > 0 && empty == source.GetSurfaceCount())
        {
            var none = new ArrayMesh { ResourceName = source.ResourceName };
            foreach (var key in source.GetMetaList()) none.SetMeta(key, source.GetMeta(key));
            mesh.Mesh = none;
            return dropped;
        }
        if (dropped > 0) mesh.Mesh = rebuilt;
        return dropped;
    }

    private static int[] Indices(Godot.Collections.Array arrays, int count)
    {
        var index = arrays[(int)Mesh.ArrayType.Index];
        return index.VariantType == Variant.Type.PackedInt32Array && index.AsInt32Array().Length > 0 ? index.AsInt32Array() : Enumerable.Range(0, count).ToArray();
    }

    private static Transform3D WorldOf(Node3D node)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
        return xf;
    }

    private static Vector3 Centre(Vector3 a, Vector3 b, Vector3 c) => (a + b + c) / 3;

    private static bool Within(Vector2[] outline, Vector3 p, float margin)
    {
        var q = new Vector2(p.X, p.Z);
        return Inside(outline, q) || EdgeDistance(outline, q) <= margin;
    }

    private static bool Inside(Vector2[] p, Vector2 q)
    {
        bool inside = false;
        for (int i = 0, j = p.Length - 1; i < p.Length; j = i++)
            if ((p[i].Y > q.Y) != (p[j].Y > q.Y) && q.X < (p[j].X - p[i].X) * (q.Y - p[i].Y) / (p[j].Y - p[i].Y) + p[i].X) inside = !inside;
        return inside;
    }

    private static float EdgeDistance(Vector2[] p, Vector2 q)
    {
        float best = float.MaxValue;
        for (int i = 0, j = p.Length - 1; i < p.Length; j = i++)
        {
            var ab = p[i] - p[j];
            float t = ab.LengthSquared() < 1e-9f ? 0 : Math.Clamp((q - p[j]).Dot(ab) / ab.LengthSquared(), 0, 1);
            best = Math.Min(best, q.DistanceTo(p[j] + ab * t));
        }
        return best;
    }

    private static bool Near(Vector2[] a, Vector2[] b, float distance) => a.Any(p => Inside(b, p) || EdgeDistance(b, p) <= distance) || b.Any(p => Inside(a, p) || EdgeDistance(a, p) <= distance);

    private static bool Overlaps(Aabb box, Vector2[] outline, float margin)
    {
        float x0 = outline.Min(p => p.X) - margin, x1 = outline.Max(p => p.X) + margin, z0 = outline.Min(p => p.Y) - margin, z1 = outline.Max(p => p.Y) + margin;
        return box.Position.X <= x1 && box.End.X >= x0 && box.Position.Z <= z1 && box.End.Z >= z0;
    }
}
