using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// St James's churchyard made larger (Steve, 2026-10-27: the cemetery bigger on one side, premium graves for important people,
/// burial vaults as there were then). world/town/churchyard.json (scripts/churchyard.py) says what stands where; the models are
/// assets/models/churchyard. At load, before collision and the walk map read the town:
/// - the rail between the old east plot and the new ground is taken out of the baked railing, so the two are one yard;
/// - the street's litter, leaves and the razed houses' raised flags go from the new ground, and the paving's drawn faces under
///   its grass (kept as what is walked on and collides);
/// - the ground is cut away where a vault's stair goes down (the paving's triangles clipped along the hole's edges, its solid
///   stand-in faces with them), so the stair is open and nobody's floor runs over it;
/// - the graves, vaults, railing and gravel are set, each with its own collision boxes (Solid leaves their meshes).
/// It stands on the razed houses' ground, so it is set only when the razing is (NativeTown: --keep-razed leaves it out).
/// </summary>
public static class NativeChurchyard
{
    public const string File = "res://world/town/churchyard.json";
    public const string Models = "res://assets/models/churchyard/";
    public const string Meta = "native_churchyard";

    public sealed record RailCut(string Node, float[] Box);
    public sealed record Item(string Id, string Model, float X, float Y, float Z, float Yaw, float Far);
    public sealed record Plan(RailCut? RailCut, float[][] Holes, Item[] Items, float[]? Clear, float[]? Cover, float[]? Sky);
    public sealed record Result(int Items, int Boxes, int RailTriangles, int GroundMeshes, int GroundTriangles, int Cleared, IReadOnlyList<string> Notes);

    public static Result Install(Node3D town)
    {
        var notes = new List<string>();
        if (!Godot.FileAccess.FileExists(File)) return new(0, 0, 0, 0, 0, 0, notes);
        var plan = JsonSerializer.Deserialize<Plan>(Godot.FileAccess.GetFileAsString(File), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (plan == null) return new(0, 0, 0, 0, 0, 0, notes);
        int railTriangles = 0;
        if (plan.RailCut is { } cut)
        {
            if (town.GetNodeOrNull<MeshInstance3D>(cut.Node) is { Mesh: ArrayMesh } rail)
                railTriangles = DropInside(rail, new Rect2(cut.Box[0], cut.Box[1], cut.Box[2] - cut.Box[0], cut.Box[3] - cut.Box[1]), float.MaxValue);
            else notes.Add("no railing " + cut.Node);
        }
        // what the street and the razed houses left in the new ground (litter, leaves, raised flags and kerbs, plinth tops left
        // floating at 0.71 m): it goes, the paving itself stays under the grass (the walk map and collision stand on it)
        int cleared = 0;
        if (plan.Clear is { Length: 4 } c)
        {
            var yard = new Rect2(c[0], c[1], c[2] - c[0], c[3] - c[1]);
            foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh && Ground(m) && !Paving(m)).ToList())
            {
                var box = WorldOf(mesh) * mesh.GetAabb();
                if (box.Position.Y > ClearUnder || !new Rect2(box.Position.X, box.Position.Z, box.Size.X, box.Size.Z).Intersects(yard)) continue;
                cleared += DropInside(mesh, yard, ClearUnder);
            }
        }
        // the paving under the new grass: its drawn faces go (the flags' and kerbs' relief is drawn pulled toward the eye, and
        // showed through the grass); what it supports and what collides (its stand-in faces) stays
        int covered = 0;
        if (plan.Cover is { Length: 4 } cv)
        {
            var under = new Rect2(cv[0], cv[1], cv[2] - cv[0], cv[3] - cv[1]);
            foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh && Paving(m)).ToList())
            {
                var box = WorldOf(mesh) * mesh.GetAabb();
                if (new Rect2(box.Position.X, box.Position.Z, box.Size.X, box.Size.Z).Intersects(under)) covered += Clip(mesh, under, notes, false);
            }
        }
        int groundMeshes = 0, groundTriangles = 0;
        foreach (var h in plan.Holes ?? Array.Empty<float[]>())
        {
            var hole = new Rect2(h[0], h[1], h[2] - h[0], h[3] - h[1]);
            foreach (var mesh in BakedWorld.All(town).OfType<MeshInstance3D>().Where(m => m.Mesh is ArrayMesh && Paving(m)).ToList())
            {
                var box = WorldOf(mesh) * mesh.GetAabb();
                if (!new Rect2(box.Position.X, box.Position.Z, box.Size.X, box.Size.Z).Intersects(hole)) continue;
                int n = Clip(mesh, hole, notes, true);
                if (n > 0) { groundMeshes++; groundTriangles += n; }
            }
        }
        var holder = new Node3D { Name = "churchyard" };
        holder.SetMeta(Meta, true);
        int items = 0, boxes = 0;
        foreach (var item in plan.Items)
        {
            if (ResourceLoader.Load<Mesh>(Models + item.Model + ".res") is not { } mesh) { notes.Add("no model " + item.Model); continue; }
            var node = new Node3D { Name = item.Id.Replace('-', '_'), Position = new Vector3(item.X, item.Y, item.Z), Rotation = new Vector3(0, item.Yaw, 0) };
            var drawn = new MeshInstance3D { Name = "Mesh", Mesh = mesh };
            if (item.Far > 0) { drawn.VisibilityRangeEnd = item.Far; drawn.VisibilityRangeEndMargin = 8; }
            node.AddChild(drawn);
            if (mesh.HasMeta("boxes") && mesh.GetMeta("boxes").AsGodotArray() is { Count: > 0 } list)
            {
                var body = new StaticBody3D { Name = "Solid", CollisionLayer = Solid.Layer, CollisionMask = 0 };
                body.SetMeta("held_by", "the churchyard");
                foreach (var b in list.Select(v => v.AsGodotArray().Select(x => (float)x.AsDouble()).ToArray()))
                {
                    body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(b[3], b[4], b[5]) }, Position = new Vector3(b[0], b[1], b[2]), Rotation = new Vector3(0, b[6], 0) });
                    boxes++;
                }
                node.AddChild(body);
            }
            holder.AddChild(node); items++;
        }
        town.AddChild(holder);
        // the old plots and the new ground lie under houses in the sky map (none stand there): their shadow and dimmed sky go
        if (plan.Sky is { Length: 4 } sky)
            Scheldemist.Render.Psx.ClearRoofs(new Rect2(sky[0], sky[1], sky[2] - sky[0], sky[3] - sky[1]), _ => true);
        notes.Add($"paving under the grass: {covered} triangles cut");
        return new(items, boxes, railTriangles, groundMeshes, groundTriangles, cleared, notes);
    }

    // what lies on the ground over a hole: the paving, and the leaves, litter, stains and floors laid on it
    private static readonly string[] OnTheGround = { "ground_", "litter_", "clutter_decals", "streetlife_", "city_" };

    private static bool Ground(MeshInstance3D m)
    {
        string name = m.HasMeta("source_name") ? m.GetMeta("source_name").AsString() : m.Name.ToString();
        return OnTheGround.Any(p => name.StartsWith(p, StringComparison.Ordinal));
    }

    private static bool Paving(MeshInstance3D m)
    {
        string name = m.HasMeta("source_name") ? m.GetMeta("source_name").AsString() : m.Name.ToString();
        return name.StartsWith("ground_", StringComparison.Ordinal);
    }

    /// <summary>What the razed houses and the street left in the new ground is all under this height (m).</summary>
    private const float ClearUnder = 1.2f;

    /// <summary>Only what lies flat on the street goes (a wall or a post standing in the box is left).</summary>
    private const float Low = 0.12f;

    private static Transform3D WorldOf(Node3D node)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
        return xf;
    }

    private static int[] Indices(Godot.Collections.Array arrays, int count)
    {
        var index = arrays[(int)Mesh.ArrayType.Index];
        return index.VariantType == Variant.Type.PackedInt32Array && index.AsInt32Array().Length > 0 ? index.AsInt32Array() : Enumerable.Range(0, count).ToArray();
    }

    private static ArrayMesh Copy(ArrayMesh source)
    {
        var rebuilt = new ArrayMesh { ResourceName = source.ResourceName };
        foreach (var key in source.GetMetaList()) rebuilt.SetMeta(key, source.GetMeta(key));
        return rebuilt;
    }

    /// <summary>Drops the triangles whose middle lies in the box (world x z) and that lie wholly under <paramref name="under"/>;
    /// returns how many went.</summary>
    private static int DropInside(MeshInstance3D mesh, Rect2 box, float under)
    {
        var xf = WorldOf(mesh); var source = (ArrayMesh)mesh.Mesh; var rebuilt = Copy(source);
        int dropped = 0; bool standIn = false;
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var arrays = source.SurfaceGetArrays(s);
            if (source.SurfaceGetPrimitiveType(s) == Mesh.PrimitiveType.Triangles)
            {
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var index = Indices(arrays, v.Length);
                var kept = new List<int>(index.Length);
                for (int t = 0; t + 2 < index.Length; t += 3)
                {
                    Vector3 a = xf * v[index[t]], b = xf * v[index[t + 1]], c = xf * v[index[t + 2]], m = (a + b + c) / 3;
                    if (box.HasPoint(new Vector2(m.X, m.Z)) && Math.Max(a.Y, Math.Max(b.Y, c.Y)) < under) { dropped++; continue; }
                    kept.Add(index[t]); kept.Add(index[t + 1]); kept.Add(index[t + 2]);
                }
                if (kept.Count == 0) { kept.Add(index[0]); kept.Add(index[0]); kept.Add(index[0]); }
                arrays[(int)Mesh.ArrayType.Index] = kept.ToArray();
            }
            rebuilt.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), arrays, null, null, source.SurfaceGetFormat(s));
            rebuilt.SurfaceSetMaterial(s, source.SurfaceGetMaterial(s));
        }
        // (and their solid stand-in faces, #163: what collides and what the walk map reads)
        if (source.HasMeta("native_solid_stand_in"))
        {
            var faces = source.GetMeta("native_solid_stand_in").AsVector3Array();
            var kept = new List<Vector3>(faces.Length);
            for (int i = 0; i + 2 < faces.Length; i += 3)
            {
                Vector3 a = xf * faces[i], b = xf * faces[i + 1], c = xf * faces[i + 2], m = (a + b + c) / 3;
                if (box.HasPoint(new Vector2(m.X, m.Z)) && Math.Max(a.Y, Math.Max(b.Y, c.Y)) < under) continue;
                kept.Add(faces[i]); kept.Add(faces[i + 1]); kept.Add(faces[i + 2]);
            }
            if (kept.Count != faces.Length) { rebuilt.SetMeta("native_solid_stand_in", kept.ToArray()); standIn = true; }
        }
        if (dropped > 0 || standIn) mesh.Mesh = rebuilt;
        return dropped;
    }

    // ------------------------------------------------------------------------------------------------ the ground's hole
    // A triangle is cut to what lies outside the hole: the parts west of it, east of it, and between those north and south
    // of it, each a convex piece (Sutherland-Hodgman), its corners weights of the triangle's three (every attribute follows).
    private readonly record struct Corner(Vector3 W, float A, float B, float C);

    private static List<Corner> ClipHalf(List<Corner> poly, Func<Vector3, float> side)
    {
        var output = new List<Corner>(poly.Count + 2);
        for (int i = 0; i < poly.Count; i++)
        {
            var p = poly[i]; var q = poly[(i + 1) % poly.Count];
            float sp = side(p.W), sq = side(q.W);
            if (sp >= 0) output.Add(p);
            if ((sp >= 0) != (sq >= 0))
            {
                float t = sp / (sp - sq);
                output.Add(new Corner(p.W.Lerp(q.W, t), Mathf.Lerp(p.A, q.A, t), Mathf.Lerp(p.B, q.B, t), Mathf.Lerp(p.C, q.C, t)));
            }
        }
        return output;
    }

    /// <summary>The pieces of a triangle (its corners in world space) outside the hole, as weight triangles; null when none
    /// of it is in the hole (keep it as it is).</summary>
    private static List<Corner[]>? Outside(Vector3 a, Vector3 b, Vector3 c, Rect2 hole)
    {
        float x0 = hole.Position.X, x1 = hole.End.X, z0 = hole.Position.Y, z1 = hole.End.Y;
        if (Math.Max(a.Y, Math.Max(b.Y, c.Y)) > Low) return null;
        if (Math.Max(a.X, Math.Max(b.X, c.X)) <= x0 || Math.Min(a.X, Math.Min(b.X, c.X)) >= x1
            || Math.Max(a.Z, Math.Max(b.Z, c.Z)) <= z0 || Math.Min(a.Z, Math.Min(b.Z, c.Z)) >= z1) return null;
        var tri = new List<Corner> { new(a, 1, 0, 0), new(b, 0, 1, 0), new(c, 0, 0, 1) };
        var pieces = new List<List<Corner>>
        {
            ClipHalf(tri, p => x0 - p.X),
            ClipHalf(tri, p => p.X - x1),
        };
        var middle = ClipHalf(ClipHalf(tri, p => p.X - x0), p => x1 - p.X);
        pieces.Add(ClipHalf(middle, p => z0 - p.Z));
        pieces.Add(ClipHalf(middle, p => p.Z - z1));
        var result = new List<Corner[]>();
        foreach (var poly in pieces)
            for (int i = 1; i + 1 < poly.Count; i++)
                if ((poly[i].W - poly[0].W).Cross(poly[i + 1].W - poly[0].W).LengthSquared() > 1e-12f) result.Add(new[] { poly[0], poly[i], poly[i + 1] });
        return result;
    }

    /// <summary>Cuts the hole (world x z) out of a ground mesh, and out of its solid stand-in faces when <paramref name="standIn"/>
    /// (else what it supports and what collides stays whole); returns the triangles cut, drawn and stand-in.</summary>
    private static int Clip(MeshInstance3D mesh, Rect2 hole, List<string> notes, bool standIn)
    {
        var xf = WorldOf(mesh); var inv = xf.AffineInverse(); var source = (ArrayMesh)mesh.Mesh; var rebuilt = Copy(source);
        int cut = 0, faceCut = 0;
        for (int s = 0; s < source.GetSurfaceCount(); s++)
        {
            var arrays = source.SurfaceGetArrays(s);
            bool plain = source.SurfaceGetPrimitiveType(s) == Mesh.PrimitiveType.Triangles;
            foreach (var t in new[] { Mesh.ArrayType.Custom0, Mesh.ArrayType.Custom1, Mesh.ArrayType.Custom2, Mesh.ArrayType.Custom3, Mesh.ArrayType.Bones, Mesh.ArrayType.Weights })
                if (arrays[(int)t].VariantType != Variant.Type.Nil) plain = false;
            if (plain)
            {
                var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var index = Indices(arrays, v.Length);
                var vs = new List<Vector3>(v);
                var nrm = arrays[(int)Mesh.ArrayType.Normal].VariantType == Variant.Type.Nil ? null : new List<Vector3>(arrays[(int)Mesh.ArrayType.Normal].AsVector3Array());
                var tan = arrays[(int)Mesh.ArrayType.Tangent].VariantType == Variant.Type.Nil ? null : new List<float>(arrays[(int)Mesh.ArrayType.Tangent].AsFloat32Array());
                var col = arrays[(int)Mesh.ArrayType.Color].VariantType == Variant.Type.Nil ? null : new List<Color>(arrays[(int)Mesh.ArrayType.Color].AsColorArray());
                var uv = arrays[(int)Mesh.ArrayType.TexUV].VariantType == Variant.Type.Nil ? null : new List<Vector2>(arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array());
                var uv2 = arrays[(int)Mesh.ArrayType.TexUV2].VariantType == Variant.Type.Nil ? null : new List<Vector2>(arrays[(int)Mesh.ArrayType.TexUV2].AsVector2Array());
                var kept = new List<int>(index.Length);
                int before = cut;
                for (int t = 0; t + 2 < index.Length; t += 3)
                {
                    int i0 = index[t], i1 = index[t + 1], i2 = index[t + 2];
                    var pieces = Outside(xf * v[i0], xf * v[i1], xf * v[i2], hole);
                    if (pieces == null) { kept.Add(i0); kept.Add(i1); kept.Add(i2); continue; }
                    cut++;
                    foreach (var piece in pieces)
                        foreach (var k in piece)
                        {
                            kept.Add(vs.Count);
                            vs.Add(v[i0] * k.A + v[i1] * k.B + v[i2] * k.C);
                            if (nrm != null) nrm.Add((nrm[i0] * k.A + nrm[i1] * k.B + nrm[i2] * k.C).Normalized());
                            if (tan != null) for (int j = 0; j < 4; j++) tan.Add(tan[i0 * 4 + j] * k.A + tan[i1 * 4 + j] * k.B + tan[i2 * 4 + j] * k.C);
                            if (col != null) col.Add(col[i0] * k.A + col[i1] * k.B + col[i2] * k.C);
                            if (uv != null) uv.Add(uv[i0] * k.A + uv[i1] * k.B + uv[i2] * k.C);
                            if (uv2 != null) uv2.Add(uv2[i0] * k.A + uv2[i1] * k.B + uv2[i2] * k.C);
                        }
                }
                if (cut > before)
                {
                    if (kept.Count == 0) { kept.Add(0); kept.Add(0); kept.Add(0); }
                    arrays[(int)Mesh.ArrayType.Vertex] = vs.ToArray();
                    if (nrm != null) arrays[(int)Mesh.ArrayType.Normal] = nrm.ToArray();
                    if (tan != null) arrays[(int)Mesh.ArrayType.Tangent] = tan.ToArray();
                    if (col != null) arrays[(int)Mesh.ArrayType.Color] = col.ToArray();
                    if (uv != null) arrays[(int)Mesh.ArrayType.TexUV] = uv.ToArray();
                    if (uv2 != null) arrays[(int)Mesh.ArrayType.TexUV2] = uv2.ToArray();
                    arrays[(int)Mesh.ArrayType.Index] = kept.ToArray();
                }
            }
            else notes.Add($"{mesh.Name} surface {s}: not plain triangles, left whole");
            rebuilt.AddSurfaceFromArrays(source.SurfaceGetPrimitiveType(s), arrays, null, null, source.SurfaceGetFormat(s));
            rebuilt.SurfaceSetMaterial(s, source.SurfaceGetMaterial(s));
        }
        // the solid stand-in faces (what collides and what the walk map stands on, #170) lose the hole too
        if (standIn && source.HasMeta("native_solid_stand_in"))
        {
            var faces = source.GetMeta("native_solid_stand_in").AsVector3Array();
            var kept = new List<Vector3>(faces.Length);
            for (int i = 0; i + 2 < faces.Length; i += 3)
            {
                var pieces = Outside(xf * faces[i], xf * faces[i + 1], xf * faces[i + 2], hole);
                if (pieces == null) { kept.Add(faces[i]); kept.Add(faces[i + 1]); kept.Add(faces[i + 2]); continue; }
                foreach (var piece in pieces) foreach (var k in piece) kept.Add(inv * k.W);
                faceCut++;
            }
            rebuilt.SetMeta("native_solid_stand_in", kept.ToArray());
        }
        if (cut > 0 || faceCut > 0) mesh.Mesh = rebuilt;
        return cut + faceCut;
    }
}
