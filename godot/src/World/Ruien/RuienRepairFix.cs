using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// One of an area's own export repairs (areas.json `repair.fixes`), applied by <see cref="RuienRepair.Convert"/> after
/// the generic passes have found the chunk. Every fix names an `action`, the chunks it touches (`chunks`: parts of the
/// mesh file name, any match; none = every chunk) and the surface families (`families`: exact, `prefix*`, `*suffix`
/// or `*part*`; none = every family). docs/ruien-native.md lists the actions and their numbers.
/// </summary>
public sealed class RuienRepairFix
{
    public string Action = "", Note = "";
    public string[] Chunks = Array.Empty<string>(), Families = Array.Empty<string>();
    public JsonObject Spec = new();
    public int Index;

    public bool Chunk(string file) => Chunks.Length == 0 || Chunks.Any(file.Contains);
    public bool Family(string family) => Families.Length == 0 || Families.Any(p => Match(p, family));
    public bool Applies(string file, string family) => Chunk(file) && Family(family);

    public static bool Match(string pattern, string name)
    {
        bool head = pattern.StartsWith('*'), tail = pattern.EndsWith('*') && pattern.Length > 1;
        string core = pattern.Trim('*');
        return head && tail ? name.Contains(core) : head ? name.EndsWith(core) : tail ? name.StartsWith(core) : name == core;
    }

    /// <summary>Actions run while the export's own triangles are filtered or moved (before the generic weathering).</summary>
    public static readonly string[] Shape = { "keepBelow", "splay", "dropBox" };
    /// <summary>Actions that add native closing pieces to a chunk (after the generic cuts and backings).</summary>
    public static readonly string[] Close = { "addBox", "vaultStrip", "mouthRings" };

    public static List<RuienRepairFix> Read(JsonNode? area)
    {
        var list = new List<RuienRepairFix>();
        if (area?["repair"]?["fixes"] is not JsonArray fixes) return list;
        string[] Strings(JsonNode? n) => n is JsonArray a ? a.Select(x => x!.GetValue<string>()).ToArray() : Array.Empty<string>();
        foreach (var f in fixes)
        {
            var fix = new RuienRepairFix { Action = f!["action"]!.GetValue<string>(), Note = f["note"]?.GetValue<string>() ?? "",
                Chunks = Strings(f["chunks"]), Families = Strings(f["families"]), Spec = f.AsObject(), Index = list.Count };
            if (!Shape.Contains(fix.Action) && !Close.Contains(fix.Action) && fix.Action is not ("dropFamily" or "cutCollision" or "addCollisionFaces"))
                throw new InvalidOperationException($"ruien repair: unknown fix action '{fix.Action}'");
            list.Add(fix);
        }
        return list;
    }

    private float F(string key) => Spec[key]!.GetValue<float>();
    private int I(string key) => Spec[key]!.GetValue<int>();
    private static float F(JsonNode n) => n.GetValue<float>();
    private Vector3 V(string key) => V(Spec[key]!);
    private static Vector3 V(JsonNode n) => new(F(n[0]!), F(n[1]!), F(n[2]!));
    private Color C(string key) { var c = Spec[key]!; return new Color(F(c[0]!), F(c[1]!), F(c[2]!), F(c[3]!)); }

    /// <summary>
    /// A shaping action on one surface. keepBelow: keep the triangles whose centre lies below `y` (sets `remove` when
    /// none remain). splay: <see cref="Splay"/> on every vertex, normals carried by its Jacobian. dropBox: drop the
    /// triangles whose centre lies strictly inside `min`..`max`; returns true when the surface is now empty.
    /// </summary>
    public bool ApplyShape(Godot.Collections.Array arrays, ref bool changed, ref bool remove)
    {
        switch (Action)
        {
            case "keepBelow":
            {
                float y = F("y");
                var pos = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var idx = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                var kept = Enumerable.Range(0, idx.Length / 3).Where(t => (pos[idx[t * 3]].Y + pos[idx[t * 3 + 1]].Y + pos[idx[t * 3 + 2]].Y) / 3 < y)
                    .SelectMany(t => new[] { idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2] }).ToArray();
                changed |= kept.Length != idx.Length; remove |= kept.Length == 0; arrays[(int)Mesh.ArrayType.Index] = kept;
                return false;
            }
            case "splay":
            {
                var p = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var normals = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                for (int i = 0; i < p.Length; i++)
                {
                    var before = p[i]; p[i] = Splay(before);
                    if (p[i] == before) continue;
                    changed = true;
                    const float e = .001f;
                    var jacobian = new Basis((Splay(before + Vector3.Right * e) - p[i]) / e, (Splay(before + Vector3.Up * e) - p[i]) / e, (Splay(before + Vector3.Back * e) - p[i]) / e);
                    if (MathF.Abs(jacobian.Determinant()) > 1e-5f) normals[i] = (jacobian.Inverse().Transposed() * normals[i]).Normalized();
                }
                arrays[(int)Mesh.ArrayType.Vertex] = p;
                arrays[(int)Mesh.ArrayType.Normal] = normals;
                return false;
            }
            case "dropBox":
            {
                var lo = V("min"); var hi = V("max");
                changed |= RuienPatch.Drop(arrays, c => c.X > lo.X && c.X < hi.X && c.Z > lo.Z && c.Z < hi.Z && c.Y > lo.Y && c.Y < hi.Y) > 0;
                if (arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length == 0) { changed = true; return true; }
                return false;
            }
        }
        return false;
    }

    /// <summary>
    /// The gate apron (`splay`): inside the box (|x - `x`| up to `halfWidth`, z `z`[0]..`z`[1], y below `top`) the
    /// deep bed rises smoothly towards `bed` (by up to `rise`, fading over z `ramp`), and the channel walls splay out
    /// from `inner` towards `outer` metres off the centre before z `splayZ` (by (splayZ - z) / `splayLength`, at most
    /// `splayMax`), so the gallery meets its outlet without a vertical step.
    /// </summary>
    public Vector3 Splay(Vector3 p)
    {
        float x = F("x"), half = F("halfWidth"), top = F("top"), bed = F("bed"), rise = F("rise"), splayZ = F("splayZ");
        var z = Spec["z"]!; var ramp = Spec["ramp"]!;
        float side = p.X - x;
        if (p.Y > top || p.Z < F(z[0]!) || p.Z > F(z[1]!) || MathF.Abs(side) > half) return p;
        float fade = 1 - Mathf.SmoothStep(F(ramp[0]!), F(ramp[1]!), p.Z);
        p.Y += Math.Clamp((bed - p.Y) / rise, 0, 1) * rise * fade;
        if (p.Z <= splayZ && MathF.Abs(side) >= F("inner"))
            p.X += MathF.Sign(side) * (F("outer") - MathF.Abs(side)) * Math.Clamp((splayZ - p.Z) / F("splayLength"), 0, F("splayMax"));
        return p;
    }

    /// <summary>Whether a collision face's centre lies in the splay's box (its corners are then splayed).</summary>
    public bool InSplay(Vector3 c)
    {
        var z = Spec["z"]!;
        return !(c.Z < F(z[0]!) || c.Z > F(z[1]!) || MathF.Abs(c.X - F("x")) > F("halfWidth") || c.Y > F("top"));
    }

    /// <summary>
    /// A closing action; `once` holds the (fix, part, LOD) keys already added, so a piece goes in one chunk per LOD.
    /// addBox: a bevelled block (`size`, `bevel`, `color`, `ao`, `tile`) at each of `at`, in every chunk that matches.
    /// vaultStrip: an elliptical vault patch (`vault`: `centre` x, `halfSpan`, `rise`, `spring`) `lift` above the
    /// intrados, x from `x`[0] in `x`[2] steps of `x`[1], between consecutive `z` bands. mouthRings: a backing ring for
    /// each of `mouths` (`chunk`, `plane`, `axis`) under the same `vault`, `lift` above it, `across` the span in
    /// `segments`, `depth`[0]..`depth`[1] into the wall.
    /// </summary>
    public bool ApplyClose(Godot.Collections.Array arrays, string file, bool lod0, HashSet<(string, bool)> once)
    {
        switch (Action)
        {
            case "addBox":
            {
                var stone = new RuienPatch.Tris();
                var size = V("size"); float bevel = F("bevel"); var col = C("color"); float ao = F("ao"), tile = F("tile");
                foreach (var at in Spec["at"]!.AsArray())
                    RuienPatch.Box(stone, size, bevel, new Transform3D(Basis.Identity, V(at!)), col, ao, tile);
                RuienPatch.Append(arrays, stone);
                return true;
            }
            case "vaultStrip":
            {
                if (!once.Add(($"fix{Index}", lod0))) return false;
                var vault = Spec["vault"]!; float cx = F(vault["centre"]!), a = F(vault["halfSpan"]!), b = F(vault["rise"]!), spring = F(vault["spring"]!);
                float lift = F("lift"); var col = C("color"); float ao = F("ao");
                var xs = Spec["x"]!; float x0s = F(xs[0]!), step = F(xs[1]!); int steps = xs[2]!.GetValue<int>();
                var zs = Spec["z"]!.AsArray().Select(n => F(n!)).ToArray();
                var strip = new RuienPatch.Tris();
                Vector3 P(float x, float z) { float u = (x - cx) / a; return new Vector3(x, spring + b * MathF.Sqrt(Math.Max(0, 1 - u * u)) + lift, z); }
                Vector3 N(float x) { float u = (x - cx) / a; float y = b * MathF.Sqrt(Math.Max(0, 1 - u * u)); return -new Vector3((x - cx) / (a * a), y / (b * b), 0).Normalized(); }
                for (int i = 0; i < steps; i++)
                {
                    float x0 = x0s + i * step, x1 = x0 + step;
                    for (int k = 0; k + 1 < zs.Length; k++)
                    {
                        float z0 = zs[k], z1 = zs[k + 1];
                        strip.Tri(P(x0, z0), P(x1, z0), P(x1, z1), N((x0 + x1) / 2), col, ao);
                        strip.Tri(P(x0, z0), P(x1, z1), P(x0, z1), N((x0 + x1) / 2), col, ao);
                    }
                }
                RuienPatch.Append(arrays, strip);
                return true;
            }
            case "mouthRings":
            {
                var vault = Spec["vault"]!; float a = F(vault["halfSpan"]!), b = F(vault["rise"]!), spring = F(vault["spring"]!);
                float lift = F("lift"); var col = C("color"); float ao = F("ao"); int segments = I("segments");
                var across = Spec["across"]!; float from = F(across[0]!), width = F(across[1]!) - from;
                var depth = Spec["depth"]!; float d0 = F(depth[0]!), d1 = F(depth[1]!);
                bool any = false;
                var mouths = Spec["mouths"]!.AsArray();
                for (int m = 0; m < mouths.Count; m++)
                {
                    var mouth = mouths[m]!;
                    if (!file.Contains(mouth["chunk"]!.GetValue<string>()) || !once.Add(($"fix{Index}/{m}", lod0))) continue;
                    var plane = V(mouth["plane"]!); var ax = V(mouth["axis"]!);
                    var lat = Vector3.Up.Cross(ax).Normalized(); var ring = new RuienPatch.Tris();
                    Vector3 P(float s, float d) { float u = s / a; return plane + lat * s + ax * d + Vector3.Up * (spring + b * MathF.Sqrt(Math.Max(0, 1 - u * u)) + lift); }
                    Vector3 N(float s) { float u = s / a; float y = b * MathF.Sqrt(Math.Max(0, 1 - u * u)); return -(lat * (s / (a * a)) + Vector3.Up * (y / (b * b))).Normalized(); }
                    for (int i = 0; i < segments; i++)
                    {
                        float s0 = from + i * width / segments, s1 = s0 + width / segments;
                        ring.Tri(P(s0, d0), P(s1, d0), P(s1, d1), N((s0 + s1) / 2), col, ao);
                        ring.Tri(P(s0, d0), P(s1, d1), P(s0, d1), N((s0 + s1) / 2), col, ao);
                    }
                    RuienPatch.Append(arrays, ring); any = true;
                }
                return any;
            }
        }
        return false;
    }

    /// <summary>cutCollision: the convex box `min`..`max` cut out of the collision (a wall boxed over a visible mouth).</summary>
    public List<Func<Vector3, float>> CollisionCut()
    {
        var lo = V("min"); var hi = V("max");
        return new() { p => p.X - lo.X, p => hi.X - p.X, p => p.Z - lo.Z, p => hi.Z - p.Z, p => p.Y - lo.Y, p => hi.Y - p.Y };
    }

    /// <summary>
    /// addCollisionFaces: the source LOD `lod`'s triangles of the matching chunks and families whose centre lies in
    /// `min`..`max` (inclusive) become collision (geometry the simplified collision export left out).
    /// </summary>
    public bool InFaces(Vector3 c)
    {
        var lo = V("min"); var hi = V("max");
        return !(c.Z < lo.Z || c.Z > hi.Z || c.X < lo.X || c.X > hi.X || c.Y < lo.Y || c.Y > hi.Y);
    }
}
