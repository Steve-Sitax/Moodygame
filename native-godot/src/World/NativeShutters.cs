using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>
/// Issue #176: the town's window shutters. The bake drew them as flat painted boards in each block's near-detail mesh;
/// those boards are gone (scripts/repair-shutters.py) and every leaf is listed in world/town/facades/shutters.json. Each
/// leaf is a copy of one shutter model per kind (louvred or panelled, assets/models/shutters, scripts/build_shutters.py),
/// fitted to the leaf, painted in its house's colour; a worn house's leaves wear the flaking paint. An open leaf hangs on
/// two strap hinges and pintles and is held by a shutter dog in the wall; a shut leaf shows only its outer face. The
/// copies are MultiMeshes per block and model, shown within the block's near range like the rest of its detail
/// (<see cref="NativeNearDetail"/>). A leaf on a razed house goes with it (NativeRazedHouses rebuilds the copy sets).
/// <c>--shutters-file &lt;json&gt;</c> reads another list (a candidate under review).
/// </summary>
public static class NativeShutters
{
    public const string File = "res://world/town/facades/shutters.json";
    private const string Models = "res://assets/models/shutters/";
    private const string Kept = "res://assets/materials/town-facades-20261018/shutter-paint-kept.tres";
    private const string Worn = "res://assets/materials/town-facades-20261018/shutter-paint-worn.tres";
    /// <summary>A house's alpha (its wear) over which its shutters' paint is flaking.</summary>
    public const float WornFrom = 0.6f;
    private const float WallGap = 0.085f; // an open leaf's face off the wall (build_city.py shutters: d1)

    private sealed record Leaf(string Chunk, string Kind, bool Open, string Bucket, float W, float H, float[] Hinge, float[] Dir, float[] Up, float[] N, float[] Paint, float Alpha, bool Tipped);
    private sealed record Doc(Leaf[] Leaves);

    public static int Install(Node3D town, string? path = null)
    {
        path ??= File;
        if (!Godot.FileAccess.FileExists(path) && !System.IO.File.Exists(path)) return 0;
        string text = path.StartsWith("res://", StringComparison.Ordinal) ? Godot.FileAccess.GetFileAsString(path) : System.IO.File.ReadAllText(path);
        var leaves = JsonSerializer.Deserialize<Doc>(text, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!.Leaves;
        var meshes = new Dictionary<string, Mesh>();
        Mesh Model(string name) => meshes.TryGetValue(name, out var m) ? m : meshes[name] = ResourceLoader.Load<Mesh>(Models + name + ".res");
        var worn = ResourceLoader.Load<Material>(Worn); ResourceLoader.Load<Material>(Kept);
        // per block, per model (and paint): the copies' transforms and colours
        var sets = new Dictionary<(string Chunk, string Model, bool Worn), List<(Transform3D At, Color Colour)>>();
        void Add(string chunk, string model, bool w, Transform3D at, Color c)
        {
            if (!sets.TryGetValue((chunk, model, w), out var list)) sets[(chunk, model, w)] = list = new();
            list.Add((at, c));
        }
        static Vector3 V(float[] a) => new(a[0], a[1], a[2]);
        foreach (var leaf in leaves)
        {
            Vector3 hinge = V(leaf.Hinge), dir = V(leaf.Dir), up = V(leaf.Up), n = V(leaf.N);
            bool right = dir.Cross(up).Dot(n) > 0; // (a right-handed frame as it is; else the model's x is turned round: every model is the same both ways across, or turned upside down)
            string body = $"body_{leaf.Kind}_{leaf.Bucket}";
            var size = Model(body).GetMeta("shutter_size").AsVector3();
            bool isWorn = leaf.Alpha > WornFrom;
            var basis = new Basis((right ? dir : -dir) * (leaf.W / size.X), up * (leaf.H / size.Y), n);
            var paint = new Color(leaf.Paint[0], leaf.Paint[1], leaf.Paint[2]);
            if (isWorn) { float g = paint.R * 0.3f + paint.G * 0.59f + paint.B * 0.11f; paint = paint.Lerp(new Color(g, g, g), 0.25f); }
            Add(leaf.Chunk, body, isWorn, new Transform3D(basis, hinge + dir * (leaf.W / 2) - n * (size.Z / 2)), paint);
            if (!leaf.Open) continue;
            // the iron: a little rust brown on a worn house
            float rust = 0.3f + 0.5f * Math.Clamp(leaf.Alpha, 0, 1), k = 0.95f;
            var iron = new Color(k * (1 + 0.55f * rust), k * (1 + 0.12f * rust), k * (1 - 0.25f * rust));
            var level = new Vector3(dir.X, 0, dir.Z).Normalized(); bool levelRight = level.Cross(Vector3.Up).Dot(n) > 0;
            // a tipped leaf hangs from its top hinge alone (build_city.py: the bottom one has given way)
            // (each strap on a rail: the bottom rail's middle, the top rail's)
            foreach (float y in leaf.Tipped ? new[] { leaf.H - 0.0425f } : new[] { 0.0625f, leaf.H - 0.0425f })
            {
                var at = hinge + up * y;
                Add(leaf.Chunk, "strap", false, new Transform3D(new Basis(dir, right ? up : -up, n), at), iron);
                Add(leaf.Chunk, "pintle", false, new Transform3D(new Basis(levelRight ? level : -level, Vector3.Up, n), at - level * 0.010f), iron);
            }
            if (!leaf.Tipped)
            {
                var wall = hinge + dir * (leaf.W + 0.022f) + Vector3.Up * 0.30f - n * WallGap;
                Add(leaf.Chunk, "holdback", false, new Transform3D(new Basis(level, levelRight ? Vector3.Up : Vector3.Down, n), wall), iron);
            }
        }
        var holder = new Node3D { Name = "facade_shutters" };
        town.AddChild(holder);
        int copies = 0;
        foreach (var ((chunk, model, isWorn), list) in sets.OrderBy(s => s.Key.Chunk).ThenBy(s => s.Key.Model))
        {
            var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, Mesh = Model(model), InstanceCount = list.Count };
            var box = new Aabb(list[0].At.Origin, Vector3.Zero);
            for (int i = 0; i < list.Count; i++) { mm.SetInstanceTransform(i, list[i].At); mm.SetInstanceColor(i, list[i].Colour); box = box.Expand(list[i].At.Origin); }
            var node = new MultiMeshInstance3D
            {
                Name = $"shutters_{chunk}_{model}{(isWorn ? "_worn" : "")}", Multimesh = mm,
                VisibilityRangeEnd = box.Size.Length() * 0.5f + 2f + NativeNearDetail.Near, VisibilityRangeEndMargin = NativeNearDetail.Fade,
                VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self,
            };
            if (isWorn) node.MaterialOverride = worn;
            // (the iron is a few centimetres across: its shadow is not worth a shadow pass's draw)
            if (!model.StartsWith("body_", StringComparison.Ordinal)) node.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
            holder.AddChild(node);
            copies += list.Count;
        }
        return copies;
    }
}
