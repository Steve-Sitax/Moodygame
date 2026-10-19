using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World;

/// <summary>The recovered floating scraps are a single frozen mesh. Separate nearby connected parts once,
/// retaining their material and shape, then translate each whole piece with its local water and mud floor.</summary>
[GamePart(31)]
public partial class FloatingLitter : Node
{
    public static FloatingLitter? I { get; private set; }
    private sealed record Piece(MeshInstance3D Node, Vector3 Centre, float Bottom, float Draft, float Ground);
    private readonly List<Piece> pieces = new();
    public int Count => pieces.Count;

    public override void _Ready()
    {
        I = this; ProcessPriority = 46;
        foreach (var source in BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(n => n.Name == "litter_float" && n.Mesh != null).ToArray())
            Separate(source);
        Update();
        GD.Print($"floating litter: {pieces.Count} rigid pieces follow local water and the drawn mud bed");
    }

    private void Separate(MeshInstance3D source)
    {
        var mesh = source.Mesh!;
        // The recovered litter_float resource has one surface. A future multi-material replacement needs
        // grouping across its surfaces, otherwise the parts of one object could acquire different drafts.
        if (mesh.GetSurfaceCount() != 1) { GD.PushWarning("Floating litter requires one combined surface; leaving the authored visual intact"); return; }
        for (int s = 0; s < mesh.GetSurfaceCount(); s++)
        {
            var arrays = mesh.SurfaceGetArrays(s);
            var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var indices = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, vertices.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            var parent = Enumerable.Range(0, vertices.Length).ToArray();
            int Root(int n) { while (parent[n] != n) { parent[n] = parent[parent[n]]; n = parent[n]; } return n; }
            void Join(int a, int b) => parent[Root(a)] = Root(b);
            var welded = new Dictionary<Vector3, int>();
            for (int i = 0; i < vertices.Length; i++)
            {
                // Native compressed vertices at a seam have the same decoded position, even where UVs/normals split.
                if (welded.TryGetValue(vertices[i], out int prior)) Join(i, prior); else welded.Add(vertices[i], i);
            }
            for (int i = 0; i < indices.Length; i += 3) { Join(indices[i], indices[i + 1]); Join(indices[i], indices[i + 2]); }
            var groups = indices.Distinct().GroupBy(Root).Select(g => g.ToArray()).ToArray();
            var boxes = groups.Select(g => Bounds(g.Select(i => source.GlobalTransform * vertices[i]))).ToArray();
            // A crate's boards, a bottle's neck and a scrap's torn corners can be disconnected islands. Their
            // construction gaps are under 10 cm. Join overlapping local bounds before moving anything rigidly.
            for (int i = 0; i < groups.Length; i++)
                for (int j = 0; j < i; j++)
                    if (boxes[i].Grow(.05f).Intersects(boxes[j].Grow(.05f))) Join(groups[i][0], groups[j][0]);
            var byPiece = new Dictionary<int, List<int>>();
            foreach (int i in indices)
            {
                int key = Root(i);
                if (!byPiece.TryGetValue(key, out var list)) byPiece[key] = list = new List<int>();
                list.Add(i);
            }
            foreach (var list in byPiece.Values)
            {
                var own = new Godot.Collections.Array(); own.Resize((int)Mesh.ArrayType.Max);
                own[(int)Mesh.ArrayType.Vertex] = list.Select(i => vertices[i]).ToArray();
                foreach (var channel in new[] { Mesh.ArrayType.Normal, Mesh.ArrayType.TexUV, Mesh.ArrayType.TexUV2, Mesh.ArrayType.Color, Mesh.ArrayType.Tangent })
                {
                    var value = arrays[(int)channel]; if (value.VariantType == Variant.Type.Nil) continue;
                    if (channel == Mesh.ArrayType.Normal) { var a = value.AsVector3Array(); own[(int)channel] = list.Select(i => a[i]).ToArray(); }
                    else if (channel == Mesh.ArrayType.Color) { var a = value.AsColorArray(); own[(int)channel] = list.Select(i => a[i]).ToArray(); }
                    else if (channel == Mesh.ArrayType.Tangent) { var a = value.AsFloat32Array(); own[(int)channel] = list.SelectMany(i => a.Skip(i * 4).Take(4)).ToArray(); }
                    else { var a = value.AsVector2Array(); own[(int)channel] = list.Select(i => a[i]).ToArray(); }
                }
                var part = new ArrayMesh(); part.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, own);
                part.SurfaceSetMaterial(0, source.GetActiveMaterial(s));
                var node = new MeshInstance3D { Name = "FloatingPiece" + pieces.Count, Mesh = part, CastShadow = source.CastShadow, Layers = source.Layers };
                source.AddChild(node);
                var world = list.Select(i => source.GlobalTransform * vertices[i]).ToArray(); var box = Bounds(world);
                float ground = float.NegativeInfinity;
                foreach (var p in world) ground = MathF.Max(ground, BoatGround.MudAt(p.X, p.Z) - (p.Y - box.Position.Y));
                pieces.Add(new Piece(node, box.GetCenter(), box.Position.Y, MathF.Min(.12f, box.Size.Y * .45f), ground));
            }
        }
        // Keep the authored node/transform and its permanent id; only replace its frozen visual with movable children.
        source.Mesh = null;
    }

    private static Aabb Bounds(IEnumerable<Vector3> points)
    {
        using var e = points.GetEnumerator(); e.MoveNext(); var b = new Aabb(e.Current, Vector3.Zero);
        while (e.MoveNext()) b = b.Expand(e.Current);
        return b;
    }
    public override void _Process(double delta) => Update();
    private void Update()
    {
        foreach (var p in pieces)
        {
            float bottom = MathF.Max(Tide.LevelAt(p.Centre.X, p.Centre.Z) - p.Draft, p.Ground);
            // Translation is world vertical, including when the original chunk has an authored transform.
            var transform = p.Node.GlobalTransform;
            float y = p.Node.GetParent<Node3D>().GlobalPosition.Y + bottom - p.Bottom;
            if (MathF.Abs(transform.Origin.Y - y) < .000001f) continue;
            transform.Origin.Y = y;
            p.Node.GlobalTransform = transform;
        }
    }
    public object[] Survey() => pieces.Select(p => (object)new {
        x = p.Centre.X, z = p.Centre.Z, water = Tide.LevelAt(p.Centre.X, p.Centre.Z),
        bottom = p.Bottom + p.Node.GlobalPosition.Y - p.Node.GetParent<Node3D>().GlobalPosition.Y,
        draft = p.Draft, ground = float.IsFinite(p.Ground) ? (float?)p.Ground : null
    }).ToArray();
    public override void _ExitTree() { if (I == this) I = null; }
}
